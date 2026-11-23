/**
 * A fake Fetchly server (A1 §3, §4, §8) for the A2 specs, plus the independent crypto helpers.
 *
 * The proof is computed here with node:crypto createHmac (S1, S2), never with the code under test:
 *   proofKey = HMAC-SHA256(key = ASCII token, "fetchly-server-proof-v1")
 *   proof    = base64url(HMAC-SHA256(proofKey raw 32 bytes, UTF-8 helloInput(pairingId, port, nonce)))
 * The `port` in the proof is the port the request arrived on, like A1's `address().port`.
 *
 * It answers the four A1 routes with their real rules (exact body keys, token check, the real `isLabel`)
 * and lets a spec script any answer for any path: `once(path, ...answers)` for the next requests, `always`
 * for all of them. A scripted function may return 'default' to fall through to the real rule.
 */
import { createHmac, randomBytes, webcrypto } from 'node:crypto';
import { isLabel } from '../../src/main/server/pairing';
import {
  CODE_RE,
  NONCE_RE,
  PAIRING_ID_RE,
  PROOF_KEY_LABEL,
  PROTOCOL,
  helloInput,
  type StatusResponse,
} from '../../src/shared/protocol';
import { err, json, type Answer, type LoggedRequest, type Responder } from './fakeFetch';

export const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');

/** S1: the 32 raw bytes of proofKey. */
export const proofKeyBytes = (token: string): Buffer => createHmac('sha256', Buffer.from(token, 'ascii')).update(PROOF_KEY_LABEL, 'utf8').digest();

/** S2: the server proof for this token, pairing, port and nonce. */
export const expectedProof = (token: string, pairingId: string, port: number, nonce: string): string =>
  b64url(createHmac('sha256', proofKeyBytes(token)).update(Buffer.from(helloInput(pairingId, port, nonce), 'utf8')).digest());

export type Scripted = Answer | 'default' | ((req: LoggedRequest) => Answer | 'default' | Promise<Answer | 'default'>);

/** The JSON of `value` followed by ASCII spaces, so that the text has exactly `totalBytes` UTF-8 bytes. */
export const padJson = (value: unknown, totalBytes: number): string => {
  const s = JSON.stringify(value);
  return s + ' '.repeat(totalBytes - Buffer.byteLength(s, 'utf8'));
};

export interface ServerPairing {
  token: string;
  label: string;
}

export class FakeServer implements Responder {
  /** The pairings the server knows: pairingId to token and label. */
  readonly pairings = new Map<string, ServerPairing>();
  /** The open pairing code, if any. */
  code: string | null = null;
  tries = 0;
  down = false;
  appVersion = '0.1.0';
  engine: StatusResponse['engine'] = 'ready';
  /** What the next /v1/pair issues; random when a member is missing. */
  issue: { token?: string; pairingId?: string } = {};
  /** Every request this server saw, in order. */
  readonly log: LoggedRequest[] = [];
  /** How many /v1/pair requests are in flight at once, and the most there ever were. */
  inFlightPair = 0;
  maxInFlightPair = 0;
  private readonly queues = new Map<string, Scripted[]>();
  private readonly fixed = new Map<string, Scripted>();

  constructor(readonly port: number) {}

  /** Every pairingId and token this server ever knew, also after an unpair (for the secrecy checks). */
  readonly ever = new Set<string>();

  /** Seeds a pairing, as if /v1/pair had issued it. */
  addPairing(p: { pairingId: string; token: string; label?: string }): void {
    this.pairings.set(p.pairingId, { token: p.token, label: p.label ?? 'Chrome' });
    this.ever.add(p.pairingId);
    this.ever.add(p.token);
  }

  openCode(code = 'ABCDEFGH'): string {
    this.code = code;
    this.tries = 0;
    return code;
  }

  /** The next requests to `path` get these answers, one each, in order. */
  once(path: string, ...answers: Scripted[]): void {
    const q = this.queues.get(path) ?? [];
    q.push(...answers);
    this.queues.set(path, q);
  }

  /** Every request to `path` gets this answer, unless a once() is queued. */
  always(path: string, a: Scripted): void {
    this.fixed.set(path, a);
  }

  /** Requests to a path, in order. */
  requests(path: string): LoggedRequest[] {
    return this.log.filter((r) => r.path === path);
  }

  /** The proof this server gives for a hello request, with any part replaced (to script a wrong one). */
  proofFor(req: LoggedRequest, over: { token?: string; pairingId?: string; port?: number; nonce?: string } = {}): string {
    const b = req.bodyJson as { pairingId: string; nonce: string };
    const p = this.pairings.get(b.pairingId);
    return expectedProof(over.token ?? p?.token ?? '', over.pairingId ?? b.pairingId, over.port ?? this.port, over.nonce ?? b.nonce);
  }

  async answer(req: LoggedRequest): Promise<Answer> {
    this.log.push(req);
    const isPair = req.path === '/v1/pair';
    if (isPair) {
      this.inFlightPair += 1;
      this.maxInFlightPair = Math.max(this.maxInFlightPair, this.inFlightPair);
    }
    try {
      const queued = this.queues.get(req.path)?.shift();
      const scripted = queued ?? this.fixed.get(req.path) ?? 'default';
      const resolved = typeof scripted === 'function' ? await scripted(req) : scripted;
      if (resolved !== 'default') return resolved;
      if (isPair) return this.pair(req);
      if (req.path === '/v1/hello') return this.hello(req);
      return this.tokenRoute(req);
    } finally {
      if (isPair) this.inFlightPair -= 1;
    }
  }

  /** The body is a JSON object with exactly these keys, or null. */
  private exact(req: LoggedRequest, keys: string[]): Record<string, unknown> | null {
    const b = req.bodyJson;
    if (typeof b !== 'object' || b === null || Array.isArray(b)) return null;
    const own = Object.keys(b);
    if (own.length !== keys.length || !keys.every((k) => Object.prototype.hasOwnProperty.call(b, k))) return null;
    return b as Record<string, unknown>;
  }

  private pair(req: LoggedRequest): Answer {
    const body = this.exact(req, ['code', 'label']);
    if (!body) return err(400, 'bad_request');
    const { code, label } = body;
    if (typeof code !== 'string' || !CODE_RE.test(code) || !isLabel(label)) return err(400, 'bad_request');
    if (this.code === null) return err(403, 'pairing_closed');
    if (code !== this.code) {
      this.tries += 1;
      if (this.tries >= 5) this.code = null;
      return err(401, 'bad_code');
    }
    this.code = null;
    const token = this.issue.token ?? b64url(randomBytes(32));
    const pairingId = this.issue.pairingId ?? b64url(randomBytes(16));
    this.pairings.set(pairingId, { token, label });
    this.ever.add(pairingId);
    this.ever.add(token);
    return json(200, { pairingId, token, protocol: PROTOCOL, appVersion: this.appVersion });
  }

  private hello(req: LoggedRequest): Answer {
    const body = this.exact(req, ['pairingId', 'nonce']);
    if (!body) return err(400, 'bad_request');
    const { pairingId, nonce } = body;
    if (typeof pairingId !== 'string' || !PAIRING_ID_RE.test(pairingId) || typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return err(400, 'bad_request');
    const p = this.pairings.get(pairingId);
    if (!p) return err(404, 'unknown_pairing');
    return json(200, { proof: expectedProof(p.token, pairingId, this.port, nonce) });
  }

  private tokenRoute(req: LoggedRequest): Answer {
    const m = /^Bearer (.+)$/u.exec(req.authorization ?? '');
    const entry = m && [...this.pairings.entries()].find(([, p]) => p.token === m[1]);
    if (!entry) return err(401, 'bad_token');
    const [pairingId] = entry;
    if (req.path === '/v1/status') {
      if (!this.exact(req, [])) return err(400, 'bad_request');
      return json(200, { app: 'fetchly', protocol: PROTOCOL, appVersion: this.appVersion, engine: this.engine });
    }
    if (req.path === '/v1/unpair') {
      if (!this.exact(req, [])) return err(400, 'bad_request');
      this.pairings.delete(pairingId);
      return json(200, {});
    }
    return err(404, 'not_found');
  }
}

// ---------------------------------------------------------------------------------------------
// Injected random source: getRandomValues(array) fills the array and returns it.

export class FakeRandom {
  /** The length of every array it was asked to fill. */
  readonly lengths: number[] = [];
  /** The bytes of every call. */
  readonly filled: Uint8Array[] = [];
  private readonly queue: Uint8Array[] = [];
  private counter = 0;

  /** The next calls give these bytes, in order. */
  queueBytes(...chunks: Uint8Array[]): void {
    this.queue.push(...chunks);
  }

  readonly getRandomValues = <T extends ArrayBufferView>(array: T): T => {
    const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    this.lengths.push(view.length);
    const next = this.queue.shift();
    if (next) {
      if (next.length !== view.length) throw new Error(`asked for ${view.length} random bytes, the spec queued ${next.length}`);
      view.set(next);
    } else {
      this.counter += 1;
      for (let i = 0; i < view.length; i += 1) view[i] = (this.counter * 37 + i * 11 + 5) & 255;
    }
    this.filled.push(view.slice());
    return array;
  };
}

// ---------------------------------------------------------------------------------------------
// Injected WebCrypto: the real node one, with a log of what the client did with it.

export interface SubtleCall {
  args: unknown[];
}

export function makeSpySubtle(): {
  subtle: {
    importKey: (...args: unknown[]) => Promise<CryptoKey>;
    sign: (...args: unknown[]) => Promise<ArrayBuffer>;
    verify: (...args: unknown[]) => Promise<boolean>;
  };
  calls: { importKey: SubtleCall[]; sign: SubtleCall[]; verify: SubtleCall[] };
  /** afterVerify runs when a verify() has computed its answer and before the client sees it (time passing). */
  hooks: { afterVerify?: () => void };
} {
  const real = webcrypto.subtle;
  const calls = { importKey: [] as SubtleCall[], sign: [] as SubtleCall[], verify: [] as SubtleCall[] };
  const hooks: { afterVerify?: () => void } = {};
  const subtle = {
    importKey: (...args: unknown[]): Promise<CryptoKey> => {
      calls.importKey.push({ args });
      return (real.importKey as (...a: unknown[]) => Promise<CryptoKey>).apply(real, args);
    },
    sign: (...args: unknown[]): Promise<ArrayBuffer> => {
      calls.sign.push({ args });
      return (real.sign as (...a: unknown[]) => Promise<ArrayBuffer>).apply(real, args);
    },
    verify: async (...args: unknown[]): Promise<boolean> => {
      calls.verify.push({ args });
      const ok = await (real.verify as (...a: unknown[]) => Promise<boolean>).apply(real, args);
      hooks.afterVerify?.();
      return ok;
    },
  };
  return { subtle, calls, hooks };
}

/** The bytes of any BufferSource a spec finds in a logged WebCrypto call. */
export function bytesOf(v: unknown): Buffer {
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  throw new Error('not a buffer');
}
