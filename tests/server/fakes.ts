/**
 * Fakes and independent crypto helpers for the A1 specs (tests/server/**, tests/ipcPairing.test.ts).
 *
 * TEST CONTRACT. The frozen A1 plan names the modules, the injected members and the behaviour, but not
 * every signature. The specs fix the following shapes; the implementation must match them (the specs
 * may not be edited by the implement lane). Everything else is as the plan says.
 *
 *   src/shared/protocol.ts   PROTOCOL, DEFAULT_SERVER_PORT, PORT_MIN, PORT_MAX, isServerPort(v: unknown),
 *                            ORIGIN_RE, PAIRING_ID_RE, NONCE_RE, TOKEN_RE, CODE_ALPHABET, CODE_RE, LABEL_MAX,
 *                            MAX_PAIRINGS, PROOF_KEY_LABEL, BIDI (R2-6),
 *                            helloInput(pairingId: string, port: number, nonce: string): string,
 *                            formatPairingString(port: number, code: string): string,
 *                            parsePairingString(s: string): { port: number; code: string } | null
 *                            (a throw is accepted as a rejection by the specs), type ErrorToken.
 *   src/shared/text.ts       exports only CONTROL (R2-6).
 *   src/main/atomicFile.ts   writeAtomic(dir: string, path: string, data: string): void
 *   src/main/server/pairing.ts
 *       type Pairing      = { id, origin, port, tokenHash, proofKey, label, pairedAt }   (a pairing.json entry)
 *       type PairingFile  = { version: 1; pairings: Pairing[] }
 *       createPairingStore(deps: PairingDeps, initial: Pairing[]): PairingStore      (a plain object of closures)
 *       PairingDeps = { now(): number; randomBytes(n: number): Uint8Array; safeEqual(a: Buffer, b: Buffer): boolean;
 *                       save(file: PairingFile): void /* may throw *\/; setTimer(fn: () => void, ms: number): unknown;
 *                       clearTimer(handle: unknown): void; serverStatus(): ServerStatus }
 *       PairingStore = {
 *         open(): Result<{ code: string; lifetimeMs: number }>      refused with 4 pairings, or unless listening
 *         cancel(): void;  codeOpen(): boolean
 *         redeem(req: { origin; port; code; label }): { ok: true; pairingId; token } | { ok: false; error: 'pairing_closed' | 'bad_code' }
 *         authenticate(origin: string, token: string): Pairing | null    (S6b; null = 401 bad_token)
 *         hasOrigin(origin: string): boolean                             (S6, step 3 on token routes)
 *         isStored(pairingId: string): boolean                           (S6c)
 *         proof(origin: string, pairingId: string, port: number, nonce: string): string | null   (null = unknown_pairing)
 *         allow(pairing: Pairing): boolean                               (rate window, counts the request)
 *         unpair(pairingId: string): boolean                             (true = it existed)
 *         clear(): void                                                  (port change: empties, writes unconditionally)
 *         list(): PairingInfo[];  view(): PairingsView                   (view = { pairings, codeOpen, unsaved })
 *         flush(): void                                                  (writes when unsaved; never throws)
 *         stopRetry(): void                                              (R2-7: clears the 30 s retry timer; the server's stop() calls it)
 *       }
 *       loadPairingFile(dir: string, effectivePort: number): { pairings: Pairing[]; notice: string | null }
 *       savePairingFile(dir: string, file: PairingFile): void            (writes <dir>/pairing.json; throws on failure)
 *   src/main/server/routes.ts
 *       register(route: Route): void          module-level table; throws on a duplicate path
 *       a1Routes(env: { pairing: PairingStore; appVersion: string; engine(): EngineStatus['state'] }): Route[]
 *                                             the four A1 routes (not registered by themselves)
 *   src/main/server/server.ts
 *       type ServerDeps = { now; randomBytes; safeEqual; setTimer; clearTimer;
 *                           createServer(options: http.ServerOptions, listener?: http.RequestListener): http.Server;
 *                           pairing: PairingStore }
 *       productionDeps(): Omit<ServerDeps, 'pairing'>
 *       start(port: number, deps: ServerDeps): Promise<RunningServer>
 *       Every timer the server and the pairing store arm (listen deadline, linger, retry) goes through
 *       deps.setTimer / deps.clearTimer. Node's own deadlines go through createServer's options.
 *   src/main/ipc.ts   HandlerDeps gains: pairing: PairingStore; server: Pick<RunningServer, 'status' | 'ensure'>;
 *                     confirmPortChange(count: number): Promise<boolean>.
 *                     status() (existing member) now also carries `server`.
 *
 * The specs that start a server load routes.ts and server.ts after vi.resetModules(), so the module-level
 * route table is fresh in each test.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createPairingStore, type Pairing, type PairingFile, type PairingStore } from '../../src/main/server/pairing';
import type { ServerStatus } from '../../src/shared/types';

export const originOf = (letter: string): string => `chrome-extension://${letter.repeat(32)}`;
export const ORIGIN_A = originOf('a');
export const ORIGIN_B = originOf('b');
export const ORIGIN_C = originOf('c');
export const ORIGIN_D = originOf('d');
export const ORIGIN_E = originOf('e');

// ---------------------------------------------------------------------------------------------
// Independent crypto (written from the plan, not from the implementation).

export const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
/** S1: tokenHash = SHA-256(ASCII of the 43-character string), base64url. */
export const tokenHashOf = (token: string): string => b64url(createHash('sha256').update(Buffer.from(token, 'ascii')).digest());
/** S1: proofKey = HMAC-SHA256(key = ASCII of the string, msg = "fetchly-server-proof-v1"). Raw bytes. */
export const proofKeyBytes = (token: string): Buffer => createHmac('sha256', Buffer.from(token, 'ascii')).update('fetchly-server-proof-v1', 'utf8').digest();
export const proofKeyOf = (token: string): string => b64url(proofKeyBytes(token));
/** S2: proof = base64url(HMAC-SHA256(raw proofKey bytes, UTF-8 "fetchly-hello-v1\n<id>\n<port>\n<nonce>")). */
export const expectedProof = (token: string, pairingId: string, port: number, nonce: string): string =>
  b64url(createHmac('sha256', proofKeyBytes(token)).update(Buffer.from(`fetchly-hello-v1\n${pairingId}\n${port}\n${nonce}`, 'utf8')).digest());

/** A nonce of the right shape: 43 base64url characters. */
export const nonceOf = (seed = 1): string => b64url(Buffer.alloc(32, seed));

// ---------------------------------------------------------------------------------------------
// Injected clock and timers.

export class FakeClock {
  t: number;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  constructor(start = 0) {
    this.t = start;
  }

  readonly now = (): number => this.t;

  readonly setTimer = (fn: () => void, ms: number): number => {
    this.seq += 1;
    this.timers.set(this.seq, { at: this.t + ms, fn });
    return this.seq;
  };

  readonly clearTimer = (handle: unknown): void => {
    if (typeof handle === 'number') this.timers.delete(handle);
  };

  /** Milliseconds until each pending timer fires, soonest first. */
  pending(): number[] {
    return [...this.timers.values()].map((x) => x.at - this.t).sort((a, b) => a - b);
  }

  /** Moves the clock and runs every timer that falls due, in order. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, x] of this.timers) {
        if (x.at <= target && x.at < nextAt) {
          nextAt = x.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const timer = this.timers.get(nextId);
      this.timers.delete(nextId);
      this.t = Math.max(this.t, nextAt);
      timer?.fn();
    }
    this.t = target;
  }
}

// ---------------------------------------------------------------------------------------------
// Injected random source.

export class FakeRandom {
  readonly calls: { size: number; bytes: Buffer }[] = [];
  private readonly queue: Buffer[] = [];
  private counter = 0;

  /** The next calls return these chunks, in order; a chunk must have the size that is asked for. */
  queueBytes(...chunks: number[][]): void {
    for (const c of chunks) this.queue.push(Buffer.from(c));
  }

  readonly randomBytes = (size: number): Buffer => {
    const next = this.queue.shift();
    let bytes: Buffer;
    if (next) {
      if (next.length !== size) throw new Error(`the random source was asked for ${size} bytes but the spec queued ${next.length}`);
      bytes = next;
    } else {
      this.counter += 1;
      bytes = Buffer.alloc(size);
      for (let i = 0; i < size; i += 1) bytes[i] = (this.counter * 53 + i * 7 + 1) & 255;
    }
    this.calls.push({ size, bytes: Buffer.from(bytes) });
    return bytes;
  };

  /** The bytes of the latest call that asked for exactly `size` bytes. */
  lastOfSize(size: number): Buffer | undefined {
    for (let i = this.calls.length - 1; i >= 0; i -= 1) {
      const c = this.calls[i];
      if (c && c.size === size) return c.bytes;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Injected constant-time compare: the real one, with a log.

export class SpySafeEqual {
  readonly calls: { a: Buffer; b: Buffer }[] = [];
  readonly fn = (a: Uint8Array, b: Uint8Array): boolean => {
    this.calls.push({ a: Buffer.from(a), b: Buffer.from(b) });
    return timingSafeEqual(a, b); // throws on unequal lengths, like the real one
  };
}

// ---------------------------------------------------------------------------------------------
// Injected save: records every write; can be made to fail.

export class FakeDisk {
  readonly saved: PairingFile[] = [];
  failing = false;
  attempts = 0;

  readonly save = (file: PairingFile): void => {
    this.attempts += 1;
    if (this.failing) throw new Error('disk full');
    this.saved.push(JSON.parse(JSON.stringify(file)) as PairingFile);
  };

  get last(): PairingFile | undefined {
    return this.saved.at(-1);
  }
}

export interface StoreRig {
  clock: FakeClock;
  random: FakeRandom;
  safeEqual: SpySafeEqual;
  disk: FakeDisk;
  /** What the store sees as the server state; change `current` to move it. */
  serverStatus: { current: ServerStatus };
  store: PairingStore;
}

export function makeStore(over: { initial?: Pairing[]; status?: ServerStatus; save?: (file: PairingFile) => void } = {}): StoreRig {
  const clock = new FakeClock();
  const random = new FakeRandom();
  const safeEqual = new SpySafeEqual();
  const disk = new FakeDisk();
  const serverStatus = { current: over.status ?? ({ state: 'listening', port: 38917 } as ServerStatus) };
  const store = createPairingStore(
    {
      now: clock.now,
      randomBytes: random.randomBytes,
      safeEqual: safeEqual.fn,
      save: over.save ?? disk.save,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      serverStatus: () => serverStatus.current,
    },
    over.initial ?? [],
  );
  return { clock, random, safeEqual, disk, serverStatus, store };
}

// ---------------------------------------------------------------------------------------------
// The server-side members of HandlerDeps (src/main/ipc.ts): the pairing store, a fake RunningServer
// (status, ensure) and the port-change dialog. Used by tests/ipcPairing.test.ts and tests/ipc.test.ts.

export interface IpcFixture {
  rig: StoreRig;
  /** The server state the fake server reports; it is the same object the store reads, so they never disagree. */
  state: { current: ServerStatus };
  /** Events in order: 'confirm', 'ensure:<port>' (specs add their own, for example 'saveSettings'). */
  log: string[];
  ensureCalls: number[];
  /** What ensure answers (and then reports) next; null = listening on the requested port. */
  ensureResult: { next: ServerStatus | null };
  confirm: { asked: number[]; answer: boolean; gate: Promise<void> | null };
  deps: {
    pairing: PairingStore;
    server: { status(): ServerStatus; ensure(port: number): Promise<ServerStatus> };
    confirmPortChange(count: number): Promise<boolean>;
  };
}

export function makeIpcServerFixture(storeOpts: Parameters<typeof makeStore>[0] = {}): IpcFixture {
  const rig = makeStore(storeOpts);
  const log: string[] = [];
  const ensureCalls: number[] = [];
  const ensureResult: { next: ServerStatus | null } = { next: null };
  const confirm: IpcFixture['confirm'] = { asked: [], answer: true, gate: null };
  const fx: IpcFixture = {
    rig,
    state: rig.serverStatus,
    log,
    ensureCalls,
    ensureResult,
    confirm,
    deps: {
      pairing: rig.store,
      server: {
        status: () => rig.serverStatus.current,
        ensure: async (port: number): Promise<ServerStatus> => {
          log.push(`ensure:${port}`);
          ensureCalls.push(port);
          const next: ServerStatus = ensureResult.next ?? { state: 'listening', port };
          rig.serverStatus.current = next;
          return next;
        },
      },
      confirmPortChange: async (count: number): Promise<boolean> => {
        log.push('confirm');
        confirm.asked.push(count);
        if (confirm.gate) await confirm.gate;
        return confirm.answer;
      },
    },
  };
  return fx;
}

/** Opens a code and redeems it: one pairing. Throws if the store refuses. */
export function pairOnce(
  store: PairingStore,
  o: { origin?: string; port?: number; label?: string } = {},
): { pairingId: string; token: string; code: string } {
  const opened = store.open();
  if (!opened.ok) throw new Error(`open was refused: ${opened.error}`);
  const res = store.redeem({ origin: o.origin ?? ORIGIN_A, port: o.port ?? 38917, code: opened.value.code, label: o.label ?? 'Chrome' });
  if (!res.ok) throw new Error(`redeem was refused: ${res.error}`);
  return { pairingId: res.pairingId, token: res.token, code: opened.value.code };
}

/** A well-formed stored pairing, for files and `initial`. */
export function storedPairing(over: Partial<Pairing> = {}, n = 1): Pairing {
  const token = b64url(Buffer.alloc(32, n));
  return {
    id: b64url(Buffer.alloc(16, n)),
    origin: ORIGIN_A,
    port: 38917,
    tokenHash: tokenHashOf(token),
    proofKey: proofKeyOf(token),
    label: 'Chrome',
    pairedAt: 1_700_000_000_000 + n,
    ...over,
  };
}
