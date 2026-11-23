/**
 * Boots the real A1 server (real node:http on 127.0.0.1) with the injected clock, random source, compare and disk.
 * The route table in routes.ts is module-level, so each boot loads routes.ts, server.ts and pairing.ts after
 * vi.resetModules(): every test starts with an empty table.
 */
import http from 'node:http';
import { vi } from 'vitest';
import type { EngineStatus } from '../../src/shared/types';
import type { Pairing } from '../../src/main/server/pairing';
import type { Route } from '../../src/main/server/routes';
import type { RunningServer, ServerDeps } from '../../src/main/server/server';
import { FakeClock, FakeDisk, FakeRandom, SpySafeEqual, ORIGIN_A, type StoreRig } from './fakes';

type RoutesModule = typeof import('../../src/main/server/routes');
type ServerModule = typeof import('../../src/main/server/server');
type PairingModule = typeof import('../../src/main/server/pairing');

export interface BootOptions {
  /** The port to start on; 0 (default) takes a free one. */
  port?: number;
  /** Routes registered before the start (fakes). */
  routes?: Route[];
  /** Register the four real A1 routes (default true). */
  a1?: boolean;
  appVersion?: string;
  engine?: () => EngineStatus['state'];
  /** Scale Node's own deadlines down (headers 300 ms, whole request 600 ms, check every 50 ms) when they are set. */
  shortDeadlines?: boolean;
  initialPairings?: Pairing[];
  /** Called with each http.Server the code under test creates, after the rig's own listen recording. */
  onServer?: (server: http.Server, nth: number) => void;
  /** Replaces what happens when the code under test asks for a server (for example, to throw). */
  createServerOverride?: ServerDeps['createServer'];
}

export interface Prepared {
  clock: FakeClock;
  random: FakeRandom;
  safeEqual: SpySafeEqual;
  disk: FakeDisk;
  store: StoreRig['store'];
  /** null until start() resolved. */
  running: RunningServer | null;
  servers: http.Server[];
  /** The options object of each createServer call, as the code under test passed it. */
  createOptions: http.ServerOptions[];
  /** The arguments of each listen call. */
  listenCalls: unknown[][];
  mods: { routes: RoutesModule; server: ServerModule; pairing: PairingModule };
  deps: ServerDeps;
  /** Calls the code under test's start(port, deps); the returned promise is the code's own. */
  start(): Promise<RunningServer>;
  /** The port the server really listens on (throws if it is not listening). */
  port(): number;
  /** Opens a code and redeems it for `origin` on the real port. */
  pair(o?: { origin?: string; label?: string }): { pairingId: string; token: string; code: string };
  stop(): Promise<void>;
}

/** A started server: `running` is set. */
export type Booted = Prepared & { running: RunningServer };

const active: Prepared[] = [];

/** Stops every server booted by the running spec; call it in afterEach. */
export async function stopAll(): Promise<void> {
  while (active.length > 0) {
    const b = active.pop();
    await Promise.race([b?.stop().catch(() => undefined), new Promise((r) => setTimeout(r, 1500))]);
    // Nothing the spec leaves behind may keep listening, even after a deadline test.
    for (const s of b?.servers ?? []) {
      if (s.listening) s.close();
      s.closeAllConnections();
    }
  }
}

/** Everything except the start: for specs that must watch the start itself (deadlines, injected errors). */
export async function prepareServer(opts: BootOptions = {}): Promise<Prepared> {
  vi.resetModules();
  const routesMod = await import('../../src/main/server/routes');
  const serverMod = await import('../../src/main/server/server');
  const pairingMod = await import('../../src/main/server/pairing');

  const clock = new FakeClock();
  const random = new FakeRandom();
  const safeEqual = new SpySafeEqual();
  const disk = new FakeDisk();
  let running: RunningServer | null = null;

  const store = pairingMod.createPairingStore(
    {
      now: clock.now,
      randomBytes: random.randomBytes,
      safeEqual: safeEqual.fn,
      save: disk.save,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      serverStatus: () => (running ? running.status() : { state: 'error', message: 'not started' }),
    },
    opts.initialPairings ?? [],
  );

  const servers: http.Server[] = [];
  const createOptions: http.ServerOptions[] = [];
  const listenCalls: unknown[][] = [];

  const createServer: ServerDeps['createServer'] =
    opts.createServerOverride ??
    ((options: http.ServerOptions, listener?: http.RequestListener) => {
      createOptions.push(options);
      const eff: http.ServerOptions = opts.shortDeadlines
        ? {
            ...options,
            headersTimeout: options.headersTimeout === undefined ? undefined : 300,
            requestTimeout: options.requestTimeout === undefined ? undefined : 600,
            connectionsCheckingInterval: options.connectionsCheckingInterval === undefined ? undefined : 50,
          }
        : options;
      const s = http.createServer(eff, listener);
      const nth = servers.length;
      servers.push(s);
      const real = s.listen.bind(s) as (...a: unknown[]) => http.Server;
      (s as unknown as { listen: (...a: unknown[]) => http.Server }).listen = (...a: unknown[]) => {
        listenCalls.push(a);
        return real(...a);
      };
      opts.onServer?.(s, nth);
      return s;
    });

  const deps: ServerDeps = {
    ...serverMod.productionDeps(),
    now: clock.now,
    randomBytes: random.randomBytes,
    safeEqual: safeEqual.fn,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    createServer,
    pairing: store,
  };

  for (const r of opts.routes ?? []) routesMod.register(r);
  if (opts.a1 !== false) {
    for (const r of routesMod.a1Routes({ pairing: store, appVersion: opts.appVersion ?? '9.9.9', engine: opts.engine ?? ((): EngineStatus['state'] => 'ready') })) {
      routesMod.register(r);
    }
  }

  const port = (): number => {
    if (!running) throw new Error('the server has not been started');
    const st = running.status();
    if (st.state !== 'listening') throw new Error(`the server is not listening: ${JSON.stringify(st)}`);
    return st.port;
  };

  const prepared: Prepared = {
    clock,
    random,
    safeEqual,
    disk,
    store,
    running: null,
    servers,
    createOptions,
    listenCalls,
    mods: { routes: routesMod, server: serverMod, pairing: pairingMod },
    deps,
    start: async () => {
      const handle = await serverMod.start(opts.port ?? 0, deps);
      running = handle;
      prepared.running = handle;
      return handle;
    },
    port,
    pair(o = {}) {
      const opened = store.open();
      if (!opened.ok) throw new Error(`open was refused: ${opened.error}`);
      const res = store.redeem({ origin: o.origin ?? ORIGIN_A, port: port(), code: opened.value.code, label: o.label ?? 'Chrome' });
      if (!res.ok) throw new Error(`redeem was refused: ${res.error}`);
      return { pairingId: res.pairingId, token: res.token, code: opened.value.code };
    },
    stop: async () => {
      await running?.stop();
    },
  };
  active.push(prepared);
  return prepared;
}

export async function bootServer(opts: BootOptions = {}): Promise<Booted> {
  const prepared = await prepareServer(opts);
  await prepared.start();
  return prepared as Booted;
}
