/**
 * The extension's only way to talk to the app (plan section 4, E4 to E8g, E11). Only service-worker code
 * imports it (E8d). Every dependency is injected (E1).
 *
 * call(path, body): one hello with a fresh nonce, the server's proof checked with WebCrypto, then at most
 * one request with `Authorization: Bearer <token>`. The token is read from the store inside the call and
 * held only in locals (E8c); it never appears in a result, a thrown message or a log.
 */
import {
  BODY_LIMIT,
  PAIRING_ID_RE,
  PROOF_KEY_LABEL,
  PROTOCOL,
  TOKEN_RE,
  helloInput,
  isServerPort,
  type ErrorToken,
} from '../../../src/shared/protocol';
import { isAppVersion } from './pairingInput';
import type { PairingRecord, Store } from './store';

/** E8g: the runtime list of error tokens; the type keeps it exhaustive. */
export const ERROR_TOKENS: Record<ErrorToken, true> = {
  bad_request: true,
  bad_host: true,
  not_found: true,
  preflight_refused: true,
  method_not_allowed: true,
  bad_origin: true,
  bad_content_type: true,
  too_large: true,
  bad_token: true,
  rate_limited: true,
  pairing_closed: true,
  bad_code: true,
  unknown_pairing: true,
  busy: true,
  not_ready: true,
  unknown_request: true,
  storage_unavailable: true,
  bad_site: true,
};

export type CallResult =
  | { ok: true; value: Record<string, unknown> } // right proof, then 200 with a JSON object
  | { ok: false; kind: 'not_paired' } // no stored record; nothing sent
  | { ok: false; kind: 'storage_blocked' } // the record could not be read; nothing sent
  | { ok: false; kind: 'app_not_running' } // any fetch rejection, stream error or 5 s abort (R2-3)
  | { ok: false; kind: 'wrong_program' } // hello: not JSON, any status but 200 or 404 unknown_pairing, bad shape, wrong proof
  | { ok: false; kind: 'unpaired' } // hello 404 { error: 'unknown_pairing' }
  | { ok: false; kind: 'stale_proof' } // E7; the request was not made
  | { ok: false; kind: 'too_large_local' } // nothing sent
  | { ok: false; kind: 'wrong_shape' } // AM-4: right proof, then a 200 whose JSON is not a plain object
  | { ok: false; kind: 'refused'; status: number; token: ErrorToken | null }; // status 200: a body that is not JSON

export type PairResult =
  | { ok: true; pairingId: string; token: string; appVersion: string }
  | { ok: false; kind: 'wrong_program' | 'app_not_running' }
  | { ok: false; kind: 'mismatch'; pairingId: string; token: string }
  | { ok: false; kind: 'refused'; status: number; token: ErrorToken };

/** What callWith needs of a record: who to prove and where. */
export type Credentials = Pick<PairingRecord, 'pairingId' | 'token' | 'port'>;

export interface Client {
  /** A3 uses only this. It alone deletes the record, on 401 bad_token or 403 bad_origin after a right proof (E8f). */
  call(path: string, body: object): Promise<CallResult>;
  /** Unpair paths only; never deletes anything. */
  callWith(record: Credentials, path: string, body: object): Promise<CallResult>;
  pair(port: number, code: string, label: string): Promise<PairResult>;
}

// A type alias, not an interface, so the injected fakes with an index signature accept it.
export type FetchInit = {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  credentials: 'omit';
  cache: 'no-store';
  redirect: 'manual';
  referrerPolicy: 'no-referrer';
  signal: AbortSignal;
};
export interface BodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  cancel(): Promise<void>;
}
export interface FetchResponse {
  status: number;
  body: { getReader(): BodyReader } | null;
}
type Bytes = Uint8Array<ArrayBuffer>;
export interface SubtleLike {
  importKey(format: 'raw', keyData: Bytes, algorithm: { name: 'HMAC'; hash: 'SHA-256' }, extractable: false, keyUsages: ['sign'] | ['verify']): Promise<unknown>;
  sign(algorithm: 'HMAC', key: unknown, data: Bytes): Promise<ArrayBuffer>;
  verify(algorithm: 'HMAC', key: unknown, signature: Bytes, data: Bytes): Promise<boolean>;
}

export interface ClientDeps {
  fetch(url: string, init: FetchInit): Promise<FetchResponse>;
  subtle: SubtleLike;
  getRandomValues(array: Bytes): unknown;
  /** Monotonic milliseconds. */
  now(): number;
  /** Wall-clock milliseconds. */
  wallNow(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  store: Pick<Store, 'read' | 'removeIf'>;
  /** E8g: the body limit of a path, when it is not BODY_LIMIT. */
  limits: Readonly<Record<string, number>>;
}

/** Q20: per fetch, headers and body together. */
const FETCH_TIMEOUT_MS = 5000;
/** Q12: from the nonce, inclusive, on both clocks. */
const PROOF_FRESH_MS = 5000;
/** The most of any response body that is read; more is "not JSON". */
const RESPONSE_CAP = 64 * 1024;
const NONCE_BYTES = 32;
const HELLO_PATH = '/v1/hello';
const PAIR_PATH = '/v1/pair';
const PATH_RE = /^\/v1\/[a-z/]+$/u;
/** S2: 32 bytes, base64url without padding. */
const PROOF_RE = /^[A-Za-z0-9_-]{43}$/u;
const HMAC = { name: 'HMAC', hash: 'SHA-256' } as const;

// Fixed texts: a thrown message never carries the path, the record or the token.
const BAD_PATH = 'fetchly client: this path may not be requested';
const BAD_BODY = 'fetchly client: the body is not JSON';
const BAD_PORT = 'fetchly client: not a server port';

const NOT_PAIRED: CallResult = { ok: false, kind: 'not_paired' };
const STORAGE_BLOCKED: CallResult = { ok: false, kind: 'storage_blocked' };
const APP_NOT_RUNNING = { ok: false, kind: 'app_not_running' } as const;
const WRONG_PROGRAM = { ok: false, kind: 'wrong_program' } as const;
const UNPAIRED: CallResult = { ok: false, kind: 'unpaired' };
const STALE_PROOF: CallResult = { ok: false, kind: 'stale_proof' };
const TOO_LARGE_LOCAL: CallResult = { ok: false, kind: 'too_large_local' };
const WRONG_SHAPE: CallResult = { ok: false, kind: 'wrong_shape' };

/** A response, or none: rejected, its stream errored, or 5 s passed. */
type Exchange = { answered: true; status: number; bytes: Uint8Array | null } | { answered: false };
const NO_ANSWER: Exchange = { answered: false };
const TIMEOUT = Symbol('timeout');
const NOT_JSON = Symbol('not json');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64url(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET.charAt((acc >> bits) & 63);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET.charAt((acc << (6 - bits)) & 63);
  return out;
}

/** The 32 bytes of a string that already matched PROOF_RE. */
function proofBytes(proof: string): Bytes {
  const out = new Uint8Array(32);
  let acc = 0;
  let bits = 0;
  let j = 0;
  for (const ch of proof) {
    acc = (acc << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j] = (acc >> bits) & 255;
      j += 1;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

const utf8 = (s: string): Bytes => new TextEncoder().encode(s);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Exactly these own keys, nothing more. */
function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
}

/** The JSON value of a body, or NOT_JSON (no body, over the cap, not UTF-8, not JSON). */
function parseJson(bytes: Uint8Array | null): unknown {
  if (bytes === null) return NOT_JSON;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return NOT_JSON;
  }
}

/** The token of an A1 error body `{ error }`, when it is on the runtime list (E8g); else null. */
function errorTokenOf(body: unknown): ErrorToken | null {
  if (!isObject(body) || !hasExactKeys(body, ['error'])) return null;
  const t = body['error'];
  return typeof t === 'string' && Object.hasOwn(ERROR_TOKENS, t) ? (t as ErrorToken) : null;
}

/** E8f: the two answers after a right proof that mean the app no longer knows this pairing. */
function removesRecord(r: CallResult): boolean {
  return r.ok === false && r.kind === 'refused' && ((r.status === 401 && r.token === 'bad_token') || (r.status === 403 && r.token === 'bad_origin'));
}

export function createClient(deps: ClientDeps): Client {
  /**
   * One POST to http://127.0.0.1:<port><path> (E8, E8b). One AbortController and one 5000 ms timer cover
   * the headers and the body; the body is read from the stream up to the cap.
   */
  async function post(port: number, path: string, payload: string, bearer?: string): Promise<Exchange> {
    const controller = new AbortController();
    let expire: () => void = () => undefined;
    const deadline = new Promise<typeof TIMEOUT>((resolve) => {
      expire = () => resolve(TIMEOUT);
    });
    const timer = deps.setTimer(() => {
      controller.abort();
      expire();
    }, FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (bearer !== undefined) headers['Authorization'] = `Bearer ${bearer}`;
      const response = await Promise.race([
        deps.fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
          headers,
          body: payload,
          credentials: 'omit',
          cache: 'no-store',
          // P4c: a redirect resolves as status 0 and is never followed.
          redirect: 'manual',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        }),
        deadline,
      ]);
      if (response === TIMEOUT) return NO_ANSWER;
      const bytes = await readCapped(response.body, deadline);
      if (bytes === TIMEOUT) return NO_ANSWER;
      return { answered: true, status: response.status, bytes };
    } catch {
      // A rejection or a stream error: no answer (R2-3). The error itself is dropped, never shown.
      return NO_ANSWER;
    } finally {
      deps.clearTimer(timer);
    }
  }

  /** The body up to RESPONSE_CAP bytes; null for no body or over the cap. Throws on a stream error. */
  async function readCapped(body: FetchResponse['body'], deadline: Promise<typeof TIMEOUT>): Promise<Uint8Array | null | typeof TIMEOUT> {
    if (body === null) return null;
    const reader = body.getReader();
    const stop = (): void => {
      reader.cancel().catch(() => undefined);
    };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const step = await Promise.race([reader.read(), deadline]);
      if (step === TIMEOUT) {
        stop();
        return TIMEOUT;
      }
      if (step.done) break;
      const chunk = step.value;
      if (chunk === undefined) continue;
      total += chunk.byteLength;
      if (total > RESPONSE_CAP) {
        stop();
        return null;
      }
      chunks.push(chunk);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }

  /** E5, E6: the proof is checked with subtle.verify on keys that are not extractable; no MAC is compared as a string. */
  async function proofIsRight(rec: Credentials, port: number, nonce: string, proof: string): Promise<boolean> {
    try {
      const tokenKey = await deps.subtle.importKey('raw', utf8(rec.token), HMAC, false, ['sign']);
      const proofKey = new Uint8Array(await deps.subtle.sign('HMAC', tokenKey, utf8(PROOF_KEY_LABEL)));
      const verifyKey = await deps.subtle.importKey('raw', proofKey, HMAC, false, ['verify']);
      return await deps.subtle.verify('HMAC', verifyKey, proofBytes(proof), utf8(helloInput(rec.pairingId, port, nonce)));
    } catch {
      // A proof that cannot be checked is not a right proof: nothing is sent with the token.
      return false;
    }
  }

  /** The path and size guards (nothing sent). Returns the JSON body, or null when it is over the path's limit. */
  function guard(path: unknown, body: unknown): string | null {
    if (typeof path !== 'string' || !PATH_RE.test(path) || path === PAIR_PATH || path === HELLO_PATH) throw new Error(BAD_PATH);
    let payload: string | undefined;
    try {
      payload = JSON.stringify(body);
    } catch {
      throw new Error(BAD_BODY);
    }
    if (typeof payload !== 'string') throw new Error(BAD_BODY);
    const limit = Object.hasOwn(deps.limits, path) ? (deps.limits[path] ?? BODY_LIMIT) : BODY_LIMIT;
    return utf8(payload).byteLength > limit ? null : payload;
  }

  /** E4: one hello, the proof, the freshness check, then the one request. No retry (E8e). */
  async function exchange(rec: Credentials, path: string, payload: string): Promise<CallResult> {
    // E4: this one value is the port of both URLs and of helloInput.
    const port = rec.port;
    const nonceBytes = new Uint8Array(NONCE_BYTES);
    deps.getRandomValues(nonceBytes);
    const nonce = toBase64url(nonceBytes);
    // E7: both clocks start when the nonce is made, before the hello is sent.
    const t0 = deps.now();
    const w0 = deps.wallNow();

    const hello = await post(port, HELLO_PATH, JSON.stringify({ pairingId: rec.pairingId, nonce }));
    if (!hello.answered) return APP_NOT_RUNNING;
    const helloBody = parseJson(hello.bytes);
    // E10: unauthenticated, so the caller deletes nothing on it.
    if (hello.status === 404 && isObject(helloBody) && hasExactKeys(helloBody, ['error']) && helloBody['error'] === 'unknown_pairing') return UNPAIRED;
    if (hello.status !== 200 || !isObject(helloBody) || !hasExactKeys(helloBody, ['proof'])) return WRONG_PROGRAM;
    const proof = helloBody['proof'];
    if (typeof proof !== 'string' || !PROOF_RE.test(proof)) return WRONG_PROGRAM;
    if (!(await proofIsRight(rec, port, nonce, proof))) return WRONG_PROGRAM;

    // E7: checked just before the request; the monotonic clock may stop during sleep, the wall clock may jump.
    const sinceMono = deps.now() - t0;
    const sinceWall = deps.wallNow() - w0;
    if (sinceMono > PROOF_FRESH_MS || sinceWall > PROOF_FRESH_MS || sinceWall < 0) return STALE_PROOF;

    const res = await post(port, path, payload, rec.token);
    if (!res.answered) return APP_NOT_RUNNING;
    const body = parseJson(res.bytes);
    if (res.status === 200) {
      if (body === NOT_JSON) return { ok: false, kind: 'refused', status: 200, token: null };
      // AM-4: valid JSON that is not a plain object; it removes nothing and is not retried.
      return isObject(body) ? { ok: true, value: body } : WRONG_SHAPE;
    }
    // E8b: status 0 (an opaque redirect) is one more status here.
    return { ok: false, kind: 'refused', status: res.status, token: errorTokenOf(body) };
  }

  return {
    async call(path, body) {
      const payload = guard(path, body);
      if (payload === null) return TOO_LARGE_LOCAL;
      const read = await deps.store.read();
      if (!read.ok) return STORAGE_BLOCKED;
      if (read.value === null) return NOT_PAIRED;
      const rec = read.value;
      const result = await exchange(rec, path, payload);
      // E8f: removeIf, so a record that a newer pairing wrote meanwhile stays (N1). AM-1: its result changes nothing here.
      if (removesRecord(result)) await deps.store.removeIf(rec.pairingId);
      return result;
    },

    async callWith(record, path, body) {
      const payload = guard(path, body);
      if (payload === null) return TOO_LARGE_LOCAL;
      return exchange(record, path, payload);
    },

    async pair(port, code, label) {
      if (!isServerPort(port)) throw new Error(BAD_PORT);
      const res = await post(port, PAIR_PATH, JSON.stringify({ code, label }));
      if (!res.answered) return APP_NOT_RUNNING;
      const body = parseJson(res.bytes);
      if (res.status !== 200) {
        const t = errorTokenOf(body);
        if ((res.status === 401 && t === 'bad_code') || (res.status === 403 && t === 'pairing_closed') || (res.status === 400 && t === 'bad_request')) {
          return { ok: false, kind: 'refused', status: res.status, token: t };
        }
        return WRONG_PROGRAM;
      }
      if (!isObject(body)) return WRONG_PROGRAM;
      const { pairingId, token, protocol, appVersion } = body;
      if (typeof token !== 'string' || !TOKEN_RE.test(token) || typeof pairingId !== 'string' || !PAIRING_ID_RE.test(pairingId)) return WRONG_PROGRAM;
      // E11: valid credentials in an answer of another shape: the caller unpairs them and stores nothing.
      if (!hasExactKeys(body, ['pairingId', 'token', 'protocol', 'appVersion']) || protocol !== PROTOCOL || !isAppVersion(appVersion)) {
        return { ok: false, kind: 'mismatch', pairingId, token };
      }
      return { ok: true, pairingId, token, appVersion };
    },
  };
}
