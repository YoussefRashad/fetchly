/**
 * The whole worker, assembled from the real lib modules over the fakes: the real store over the fake IndexedDB,
 * the real client over the fake fetch and a fake server, the real handlers on a fake chrome. Used by
 * messages.test.ts and flow.test.ts.
 *
 * `restart()` gives a new worker over the same disk (the same IndexedDB backing map), the same network, the
 * same clocks and the same random source: new chrome, new store, new client, new handlers, nothing in memory.
 */
import { expect } from 'vitest';
import { createFakeChrome, popupSender, type Dispatched, type FakeChrome } from '../fakes/fake-chrome';
import { FakeClock, Trace, idle, until } from './clock';
import { FakeNet } from './fakeFetch';
import { FakeIdb, newBacking, type IdbBacking } from './fakeIdb';
import { FakeRandom, FakeServer, makeSpySubtle } from './fakeServer';
import { ALL_STATES, MARKERS, NAV_EDGE, PORT, PORT_B, type Rec } from './fixtures';
import { createClient } from '../../extension/src/lib/client';
import { registerHandlers } from '../../extension/src/lib/messages';
import { createStore } from '../../extension/src/lib/store';

export interface Shared {
  clock: FakeClock;
  trace: Trace;
  net: FakeNet;
  random: FakeRandom;
  spy: ReturnType<typeof makeSpySubtle>;
  backing: IdbBacking;
  servers: Map<number, FakeServer>;
}

export function makeShared(): Shared {
  const clock = new FakeClock();
  const trace = new Trace();
  return { clock, trace, net: new FakeNet(clock, trace), random: new FakeRandom(), spy: makeSpySubtle(), backing: newBacking(), servers: new Map() };
}

export class World {
  readonly clock: FakeClock;
  readonly trace: Trace;
  readonly net: FakeNet;
  readonly random: FakeRandom;
  readonly spy: ReturnType<typeof makeSpySubtle>;
  readonly idb: FakeIdb;
  readonly chrome: FakeChrome;
  readonly store: ReturnType<typeof createStore>;
  readonly client: ReturnType<typeof createClient>;
  /** The JSON of every reply delivered through send(). */
  readonly replies: string[] = [];

  constructor(
    readonly shared: Shared,
    opts: { uiLanguage?: string; extensionId?: string; nav?: typeof NAV_EDGE } = {},
  ) {
    this.clock = shared.clock;
    this.trace = shared.trace;
    this.net = shared.net;
    this.random = shared.random;
    this.spy = shared.spy;
    this.idb = new FakeIdb({ trace: shared.trace, backing: shared.backing });
    this.chrome = createFakeChrome({ trace: shared.trace, ...(opts.uiLanguage ? { uiLanguage: opts.uiLanguage } : {}), ...(opts.extensionId ? { id: opts.extensionId } : {}) });
    this.store = createStore({ idb: this.idb.factory, setTimer: this.clock.setTimer, clearTimer: this.clock.clearTimer });
    this.client = createClient({
      fetch: this.net.fetch,
      subtle: this.spy.subtle,
      getRandomValues: this.random.getRandomValues,
      now: this.clock.now,
      wallNow: this.clock.wallNow,
      setTimer: this.clock.setTimer,
      clearTimer: this.clock.clearTimer,
      store: this.store,
      limits: {},
    });
    registerHandlers({ runtime: this.chrome.runtime, client: this.client, store: this.store, nav: opts.nav ?? NAV_EDGE });
  }

  /** The fake server on a port, created on first use. */
  server(port = PORT): FakeServer {
    let s = this.shared.servers.get(port);
    if (!s) {
      s = new FakeServer(port);
      this.shared.servers.set(port, s);
      this.net.servers.set(port, s);
    }
    return s;
  }

  /** A pairing as an earlier worker left it: the record on disk and the matching entry in the app. */
  install(record: Rec): void {
    this.idb.seed(record);
    this.server(record.port).addPairing(record);
  }

  /** A message from the popup; resolves with the reply. */
  async send(message: unknown): Promise<unknown> {
    return this.dispatch(message).reply;
  }

  /** A message from the popup, not awaited. */
  dispatch(message: unknown, options?: { deliver?: boolean }): Dispatched {
    const d = this.chrome.runtime.onMessage.dispatch(message, popupSender(this.chrome), options);
    void d.reply.then((r) => this.replies.push(JSON.stringify(r)));
    return d;
  }

  /** A new worker over the same disk and network. */
  restart(opts: { uiLanguage?: string } = {}): World {
    return new World(this.shared, opts);
  }

  /** Waits until `n` requests were made (WebCrypto runs on the thread pool, so time cannot be flushed). */
  async untilRequests(n: number): Promise<void> {
    await until(() => this.net.log.length >= n);
  }

  /** Lets everything that can happen without a timer happen. */
  async idle(): Promise<void> {
    await idle();
  }
}

export function makeWorld(opts: { uiLanguage?: string } = {}): World {
  return new World(makeShared(), opts);
}

const REPLY_KEYS = ['state', 'paired', 'appVersion', 'note'];

/**
 * The checks every worker test gets for free (call it from afterEach):
 *  - Secrecy: the JSON of every reply holds no marker, no pairingId or token any server ever knew, and no port.
 *  - Reply shape (E8d): an object with `state` and a boolean `paired`, and no key but appVersion and note besides;
 *    the worker never replies `interrupted` (only the popup does).
 *  - The IndexedDB log names only the database fetchly, the store kv and the key pairing.
 */
export function assertWorldClean(w: World): void {
  const secrets = new Set<string>([...MARKERS, ...[PORT, PORT_B, 40124].map(String)]);
  for (const s of w.shared.servers.values()) for (const v of s.ever) secrets.add(v);
  const kept = w.idb.peek();
  if (typeof kept === 'object' && kept !== null) for (const v of [(kept as Rec).token, (kept as Rec).pairingId]) if (typeof v === 'string') secrets.add(v);
  for (const json of w.replies) {
    if (typeof json !== 'string') continue;
    for (const secret of secrets) expect(json, `a reply holds ${secret.slice(0, 8)}…`).not.toContain(secret);
    const reply: unknown = JSON.parse(json);
    if (typeof reply !== 'object' || reply === null) continue;
    for (const k of Object.keys(reply)) expect(REPLY_KEYS, `reply key ${k}`).toContain(k);
    expect(typeof (reply as { paired?: unknown }).paired).toBe('boolean');
    expect(ALL_STATES).toContain((reply as { state: string }).state);
    expect((reply as { state: string }).state).not.toBe('interrupted');
  }
  for (const e of w.idb.log) {
    if (e.op === 'open' || e.op === 'createObjectStore') expect(['fetchly', 'kv']).toContain(e.name);
    if (e.op === 'get' || e.op === 'put' || e.op === 'delete') {
      expect(e.key).toBe('pairing');
      expect(e.store).toBe('kv');
    }
  }
}

export const statusMsg = { type: 'fetchly:status' };
export const unpairMsg = { type: 'fetchly:unpair' };
export const pairMsg = (pairingString = `${PORT}-ABCDEFGH`, label = 'My PC'): { type: string; pairingString: string; label: string } => ({
  type: 'fetchly:pair',
  pairingString,
  label,
});
