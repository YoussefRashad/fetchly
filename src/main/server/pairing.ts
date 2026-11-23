/**
 * Pairing: the one-time code, the tokens it issues, the server proof, the rate window and pairing.json.
 *
 * Memory is authoritative and the disk follows (S11): every change applies in memory first, then the whole
 * list is written. A failed write sets `unsaved`; it is retried on the next change, every 30 s while
 * unsaved, and by flush() at quit. The token itself is never kept: only tokenHash and proofKey (S1, S2).
 */
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  BIDI,
  CODE_ALPHABET,
  CODE_RE,
  LABEL_MAX,
  MAX_PAIRINGS,
  ORIGIN_RE,
  PAIRING_ID_RE,
  PROOF_KEY_LABEL,
  TOKEN_RE,
  helloInput,
  isServerPort,
} from '../../shared/protocol';
import { CONTROL } from '../../shared/text';
import type { PairingInfo, PairingsView, Result, ServerStatus } from '../../shared/types';
import { writeAtomic } from '../atomicFile';

/** One pairing.json entry. */
export interface Pairing {
  id: string;
  origin: string;
  port: number;
  /** base64url(SHA-256(ASCII token)), 43 characters. */
  tokenHash: string;
  /** base64url(HMAC-SHA256(key = ASCII token, PROOF_KEY_LABEL)), 43 characters. */
  proofKey: string;
  label: string;
  /** Date.now() at pairing, for display only. */
  pairedAt: number;
}

export interface PairingFile {
  version: 1;
  pairings: Pairing[];
}

export interface PairingDeps {
  /** Monotonic milliseconds: the code lifetime and the rate window. */
  now(): number;
  randomBytes(n: number): Uint8Array;
  /** Constant-time compare of two buffers of equal length. */
  safeEqual(a: Buffer, b: Buffer): boolean;
  /** Writes the whole file; may throw. */
  save(file: PairingFile): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** A code is opened only while this is `listening`. */
  serverStatus(): ServerStatus;
}

export type RedeemResult = { ok: true; pairingId: string; token: string } | { ok: false; error: 'pairing_closed' | 'bad_code' };

export interface PairingStore {
  /** Opens a new code (replacing an open one); refused with 4 pairings, or unless the server is listening. */
  open(): Result<{ code: string; lifetimeMs: number }>;
  cancel(): void;
  codeOpen(): boolean;
  /** Checks the code, then creates and saves a pairing, all in one synchronous block. */
  redeem(req: { origin: string; port: number; code: string; label: string }): RedeemResult;
  /** S6b: the pairing whose token this is, if its origin is `origin`; null otherwise (401 bad_token). */
  authenticate(origin: string, token: string): Pairing | null;
  /** S6: some stored pairing has this origin. */
  hasOrigin(origin: string): boolean;
  /** S6c: the pairing is still stored. */
  isStored(pairingId: string): boolean;
  /** The server proof, or null when the id is unknown or paired to another origin (404 unknown_pairing). */
  proof(origin: string, pairingId: string, port: number, nonce: string): string | null;
  /** Counts one token-route request in the pairing's 60 s window; false when over 300 (429 rate_limited). */
  allow(pairing: Pairing): boolean;
  /** Removes one pairing; true when it existed. */
  unpair(pairingId: string): boolean;
  /** Removes every pairing and writes the empty list, always (R2-1). */
  clear(): void;
  list(): PairingInfo[];
  view(): PairingsView;
  /** Writes when unsaved; never throws. */
  flush(): void;
  /** Clears the retry timer and arms no new one (quit). Writes on change and flush() still work. */
  stopRetry(): void;
}

/** 5 minutes, as shown to the user. */
export const CODE_LIFETIME_MS = 300_000;
/** The code stays valid 10 s past what the user is shown (inclusive). */
const CODE_GRACE_MS = 10_000;
const CODE_TRIES = 5;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 300;
const RETRY_MS = 30_000;

export const FOUR_PAIRED_TEXT = 'Four browsers are already paired. Unpair one first.';
export const NOT_LISTENING_TEXT = 'Pairing is possible only while Fetchly is listening for the browser';

const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const tokenHashBytes = (token: string): Buffer => createHash('sha256').update(Buffer.from(token, 'ascii')).digest();
const proofKeyBytes = (token: string): Buffer => createHmac('sha256', Buffer.from(token, 'ascii')).update(PROOF_KEY_LABEL, 'utf8').digest();

/** S20: 1 to 40 UTF-16 code units, no control and no bidi character. */
export function isLabel(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= LABEL_MAX && !CONTROL.test(v) && !BIDI.test(v);
}

export function createPairingStore(deps: PairingDeps, initial: Pairing[]): PairingStore {
  let pairings: Pairing[] = initial.map(copyPairing);
  let code: { value: string; openedAt: number; tries: number } | null = null;
  const windows = new Map<string, { start: number; count: number }>();
  let unsaved = false;
  let retry: { handle: unknown } | null = null;
  let retryStopped = false;

  const clearRetry = (): void => {
    if (retry) deps.clearTimer(retry.handle);
    retry = null;
  };

  const armRetry = (): void => {
    if (retry || retryStopped) return;
    retry = {
      handle: deps.setTimer(() => {
        retry = null;
        write();
      }, RETRY_MS),
    };
  };

  /** Writes the whole list from memory; never throws. */
  const write = (): void => {
    try {
      deps.save({ version: 1, pairings: pairings.map(copyPairing) });
      unsaved = false;
      clearRetry();
    } catch {
      unsaved = true;
      armRetry();
    }
  };

  const liveCode = (): typeof code => {
    if (code && deps.now() - code.openedAt > CODE_LIFETIME_MS + CODE_GRACE_MS) code = null;
    return code;
  };

  /** One safeEqual per stored pairing, no early exit; then the origin of the match. */
  const authenticate = (origin: string, token: string): Pairing | null => {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const hash = tokenHashBytes(token);
    let match: Pairing | null = null;
    for (const p of pairings) {
      let stored = Buffer.from(p.tokenHash, 'base64url');
      // A loaded hash is always 32 bytes; a stand-in keeps the compare count and never matches by length.
      if (stored.length !== hash.length) stored = Buffer.alloc(hash.length);
      if (deps.safeEqual(hash, stored) && match === null) match = p;
    }
    if (match === null || match.origin !== origin) return null;
    return match;
  };

  return {
    open() {
      if (deps.serverStatus().state !== 'listening') return { ok: false, error: NOT_LISTENING_TEXT };
      if (pairings.length >= MAX_PAIRINGS) return { ok: false, error: FOUR_PAIRED_TEXT };
      const bytes = deps.randomBytes(8);
      let value = '';
      for (let i = 0; i < 8; i += 1) value += CODE_ALPHABET[(bytes[i] ?? 0) & 31];
      code = { value, openedAt: deps.now(), tries: 0 };
      return { ok: true, value: { code: value, lifetimeMs: CODE_LIFETIME_MS } };
    },

    cancel() {
      code = null;
    },

    codeOpen: () => liveCode() !== null,

    redeem(req) {
      const open = liveCode();
      if (!open || pairings.length >= MAX_PAIRINGS) return { ok: false, error: 'pairing_closed' };
      const given = Buffer.from(typeof req.code === 'string' && CODE_RE.test(req.code) ? req.code : '', 'ascii');
      const expected = Buffer.from(open.value, 'ascii');
      // A malformed code never reaches here from the route; it is compared as a wrong code of the right length.
      const right = deps.safeEqual(given.length === expected.length ? given : Buffer.alloc(expected.length), expected) && given.length === expected.length;
      if (!right) {
        open.tries += 1;
        if (open.tries >= CODE_TRIES) code = null;
        return { ok: false, error: 'bad_code' };
      }
      code = null;
      const token = b64url(deps.randomBytes(32));
      const pairingId = b64url(deps.randomBytes(16));
      pairings.push({
        id: pairingId,
        origin: req.origin,
        port: req.port,
        tokenHash: b64url(tokenHashBytes(token)),
        proofKey: b64url(proofKeyBytes(token)),
        label: req.label,
        pairedAt: Date.now(),
      });
      write();
      return { ok: true, pairingId, token };
    },

    authenticate,

    hasOrigin: (origin) => pairings.some((p) => p.origin === origin),

    isStored: (pairingId) => pairings.some((p) => p.id === pairingId),

    proof(origin, pairingId, port, nonce) {
      const p = pairings.find((x) => x.id === pairingId);
      if (!p || p.origin !== origin) return null;
      const key = Buffer.from(p.proofKey, 'base64url');
      return b64url(createHmac('sha256', key).update(Buffer.from(helloInput(pairingId, port, nonce), 'utf8')).digest());
    },

    allow(pairing) {
      const t = deps.now();
      let w = windows.get(pairing.id);
      if (!w || t - w.start >= RATE_WINDOW_MS) {
        w = { start: t, count: 0 };
        windows.set(pairing.id, w);
      }
      if (w.count >= RATE_MAX) return false;
      w.count += 1;
      return true;
    },

    unpair(pairingId) {
      if (typeof pairingId !== 'string') return false;
      const before = pairings.length;
      pairings = pairings.filter((p) => p.id !== pairingId);
      if (pairings.length === before) return false;
      windows.delete(pairingId);
      write();
      return true;
    },

    clear() {
      pairings = [];
      windows.clear();
      write();
    },

    list: () => pairings.map((p) => ({ id: p.id, label: p.label, pairedAt: p.pairedAt })),

    view() {
      return { pairings: pairings.map((p) => ({ id: p.id, label: p.label, pairedAt: p.pairedAt })), codeOpen: liveCode() !== null, unsaved };
    },

    flush() {
      if (unsaved) write();
    },

    stopRetry() {
      retryStopped = true;
      clearRetry();
    },
  };
}

function copyPairing(p: Pairing): Pairing {
  return { id: p.id, origin: p.origin, port: p.port, tokenHash: p.tokenHash, proofKey: p.proofKey, label: p.label, pairedAt: p.pairedAt };
}

// ---------------------------------------------------------------------------------------------------------
// pairing.json

const B64_43 = /^[A-Za-z0-9_-]{43}$/u;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseEntry(v: unknown): Pairing | null {
  if (!isPlainObject(v)) return null;
  const { id, origin, port, tokenHash, proofKey, label, pairedAt } = v;
  if (typeof id !== 'string' || !PAIRING_ID_RE.test(id)) return null;
  if (typeof origin !== 'string' || !ORIGIN_RE.test(origin)) return null;
  if (!isServerPort(port)) return null;
  if (typeof tokenHash !== 'string' || !B64_43.test(tokenHash)) return null;
  if (typeof proofKey !== 'string' || !B64_43.test(proofKey)) return null;
  if (!isLabel(label)) return null;
  if (typeof pairedAt !== 'number' || !Number.isFinite(pairedAt)) return null;
  // Known keys only, so nothing unknown is carried into the next save.
  return { id, origin, port, tokenHash, proofKey, label, pairedAt };
}

/** The entries of a pairing.json, or null when any rule fails (the whole file is then set aside). */
function parseFile(raw: unknown): Pairing[] | null {
  if (!isPlainObject(raw) || raw['version'] !== 1 || !Array.isArray(raw['pairings'])) return null;
  const list: unknown[] = raw['pairings'];
  if (list.length > MAX_PAIRINGS) return null;
  const out: Pairing[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < list.length; i += 1) {
    const p = parseEntry(list[i]);
    if (!p || ids.has(p.id)) return null;
    ids.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Reads <dir>/pairing.json. Missing: unpaired, no notice. Unreadable or invalid: set aside as
 * pairing.json.corrupt-<n> (a failing rename is ignored), unpaired, and a notice for the window.
 * An entry whose port is not `effectivePort` is ignored and the file is not rewritten (S12). Never throws.
 */
export function loadPairingFile(dir: string, effectivePort: number): { pairings: Pairing[]; notice: string | null } {
  const path = join(dir, 'pairing.json');
  if (!existsSync(path)) return { pairings: [], notice: null };
  let entries: Pairing[] | null;
  try {
    entries = parseFile(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    entries = null;
  }
  if (entries) return { pairings: entries.filter((p) => p.port === effectivePort), notice: null };
  const aside = `${path}.corrupt-${Date.now()}`;
  try {
    renameSync(path, aside);
  } catch {
    return { pairings: [], notice: 'The list of paired browsers could not be read. Pair your browsers again.' };
  }
  return { pairings: [], notice: `The list of paired browsers could not be read and was set aside as ${aside}. Pair your browsers again.` };
}

/** Writes <dir>/pairing.json through writeAtomic; throws on failure. */
export function savePairingFile(dir: string, file: PairingFile): void {
  const data: PairingFile = { version: 1, pairings: file.pairings.map(copyPairing) };
  writeAtomic(dir, join(dir, 'pairing.json'), JSON.stringify(data, null, 2));
}
