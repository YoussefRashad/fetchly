import { describe, expect, it } from 'vitest';
import { EngineHost, type EngineHostDeps } from '../src/main/engineHost';
import type { Aria2Daemon } from '../src/main/engines/file';
import type { EngineStatus } from '../src/shared/types';

const COULD_NOT_START = 'The download tools could not be started: ';
const SERVICE_STOPPED = 'The file download service stopped';

const STARTING: EngineStatus = { state: 'starting' };
const READY: EngineStatus = { state: 'ready' };
const NOT_INSTALLED: EngineStatus = { state: 'notInstalled' };
const failed = (message: string): EngineStatus => ({ state: 'error', message: `${COULD_NOT_START}${message}` });
const stopped: EngineStatus = { state: 'error', message: SERVICE_STOPPED };

/** Lets every promise that can settle without a timer settle. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Gate {
  wait: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/** A running aria2 that tests can end from outside, like the real one. */
class FakeDaemon implements Aria2Daemon {
  rpc = { call: async (): Promise<unknown> => null };
  stops = 0;
  stopFails = false;
  private up = true;
  private ended = false;
  private readonly listeners: (() => void)[] = [];

  /** `log`: where stop() records 'daemon.stop'. */
  constructor(private readonly log: string[] = []) {}

  alive(): boolean {
    return this.up;
  }

  onExit(cb: () => void): void {
    this.listeners.push(cb);
  }

  async stop(): Promise<void> {
    this.log.push('daemon.stop');
    this.stops += 1;
    this.up = false;
    if (this.stopFails) throw new Error('could not stop aria2');
  }

  /** aria2 ends on its own: alive() turns false and the listeners run, once. */
  die(): void {
    this.up = false;
    if (this.ended) return;
    this.ended = true;
    this.fire();
  }

  /** alive() turns false and nobody is told (the exit came before a listener was added). */
  dieQuietly(): void {
    this.up = false;
    this.ended = true;
  }

  /** Runs the listeners whatever alive() says: a late or repeated event. */
  fire(): void {
    for (const cb of [...this.listeners]) cb();
  }
}

interface FakeQueue {
  id: number;
}

/** What the next calls of the fake dependencies do. */
interface Control {
  installed: boolean;
  /** the answer of killStrays */
  strays: boolean;
  /** what the next startAria2 calls do: an Error or a text rejects, 'ok' (and an empty list) starts a daemon */
  starts: (Error | string)[];
  holdTools: Gate | null;
  holdKill: Gate | null;
  holdStart: Gate | null;
  toolsError: unknown;
  killError: unknown;
  createError: unknown;
  /** what wireQueue throws; null = it wires */
  wireError: unknown;
  /** while set, disposeQueue waits for it */
  holdDispose: Gate | null;
  /** what disposeQueue rejects with; null = it resolves */
  disposeError: unknown;
  attachError: unknown;
  /** what happens to the daemon while createQueue runs */
  createKills: 'no' | 'quietly' | 'with an event';
  /** what happens to the daemon while attachDaemon runs (a restart) */
  attachKills: 'no' | 'quietly' | 'with an event';
  stopFails: boolean;
}

function harness() {
  const log: string[] = [];
  const statuses: EngineStatus[] = [];
  const daemons: FakeDaemon[] = [];
  const queues: FakeQueue[] = [];
  const created: { daemon: Aria2Daemon; straysCleared: boolean }[] = [];
  const wired: FakeQueue[] = [];
  const disposed: FakeQueue[] = [];
  const attached: Aria2Daemon[] = [];
  const control: Control = {
    installed: true,
    strays: true,
    starts: [],
    holdTools: null,
    holdKill: null,
    holdStart: null,
    toolsError: null,
    killError: null,
    createError: null,
    wireError: null,
    holdDispose: null,
    disposeError: null,
    attachError: null,
    createKills: 'no',
    attachKills: 'no',
    stopFails: false,
  };
  // Filled in below; the dependencies read the host while they run.
  const seen: {
    atAttach: EngineStatus[];
    atCreate: EngineStatus[];
    atWire: EngineStatus[];
    queueAtAttach: (FakeQueue | null)[];
    queueAtWire: (FakeQueue | null)[];
    daemonAtCreate: (Aria2Daemon | null)[];
    daemonAtAttach: (Aria2Daemon | null)[];
  } = { atAttach: [], atCreate: [], atWire: [], queueAtAttach: [], queueAtWire: [], daemonAtCreate: [], daemonAtAttach: [] };

  const deps: EngineHostDeps<FakeQueue> = {
    toolsInstalled: async () => {
      log.push('toolsInstalled');
      if (control.holdTools) await control.holdTools.wait;
      if (control.toolsError !== null) throw control.toolsError;
      return control.installed;
    },
    killStrays: async () => {
      log.push('killStrays');
      if (control.holdKill) await control.holdKill.wait;
      if (control.killError !== null) throw control.killError;
      return control.strays;
    },
    startAria2: async () => {
      log.push('startAria2');
      if (control.holdStart) await control.holdStart.wait;
      const next = control.starts.shift();
      if (next !== undefined && next !== 'ok') throw next;
      const daemon = new FakeDaemon(log);
      daemon.stopFails = control.stopFails;
      daemons.push(daemon);
      return daemon;
    },
    createQueue: (daemon, straysCleared) => {
      log.push('createQueue');
      created.push({ daemon, straysCleared });
      seen.atCreate.push(host.status());
      seen.daemonAtCreate.push(host.daemon());
      if (control.createError !== null) throw control.createError;
      const fake = daemon as FakeDaemon;
      if (control.createKills === 'quietly') fake.dieQuietly();
      if (control.createKills === 'with an event') fake.die();
      const queue = { id: queues.length };
      queues.push(queue);
      return queue;
    },
    wireQueue: (queue) => {
      log.push('wireQueue');
      seen.atWire.push(host.status());
      seen.queueAtWire.push(host.queue());
      if (control.wireError !== null) throw control.wireError;
      wired.push(queue);
    },
    disposeQueue: async (queue) => {
      log.push('disposeQueue');
      disposed.push(queue);
      if (control.holdDispose) await control.holdDispose.wait;
      log.push('disposed');
      if (control.disposeError !== null) throw control.disposeError;
    },
    attachDaemon: (daemon) => {
      log.push('attachDaemon');
      seen.atAttach.push(host.status());
      seen.queueAtAttach.push(host.queue());
      seen.daemonAtAttach.push(host.daemon());
      if (control.attachError !== null) throw control.attachError;
      if (control.attachKills === 'quietly') (daemon as FakeDaemon).dieQuietly();
      if (control.attachKills === 'with an event') (daemon as FakeDaemon).die();
      attached.push(daemon);
    },
    onStatus: (status) => {
      statuses.push(structuredClone(status));
    },
  };
  const host = new EngineHost<FakeQueue>(deps);
  const calls = (name: string): number => log.filter((l) => l === name).length;
  /** Makes the next call of that step wait until the gate is opened. */
  const hold = (step: 'holdTools' | 'holdKill' | 'holdStart' | 'holdDispose'): Gate => {
    const g = gate();
    control[step] = g;
    return g;
  };
  return { host, deps, log, statuses, daemons, queues, created, wired, disposed, attached, control, seen, calls, hold };
}

type Harness = ReturnType<typeof harness>;

/** A host that went ready once, so a queue and a daemon exist. */
async function readyHost(): Promise<Harness> {
  const h = harness();
  await h.host.start();
  expect(h.host.status()).toEqual(READY);
  return h;
}

describe('EngineHost (9.2)', () => {
  it('is starting before it was asked to start', () => {
    const h = harness();
    expect(h.host.status()).toEqual(STARTING);
    expect(h.host.queue()).toBeNull();
    expect(h.host.daemon()).toBeNull();
    expect(h.statuses).toEqual([]); // the first value is not announced
    expect(h.log).toEqual([]); // and nothing runs before start()
  });

  it('is notInstalled while a tool is missing and starts nothing', async () => {
    const h = harness();
    h.control.installed = false;
    await h.host.start();
    expect(h.host.status()).toEqual(NOT_INSTALLED);
    expect(h.calls('killStrays')).toBe(0);
    expect(h.calls('startAria2')).toBe(0);
    expect(h.calls('createQueue')).toBe(0);
    expect(h.calls('attachDaemon')).toBe(0);
    expect(h.host.queue()).toBeNull();
    expect(h.host.daemon()).toBeNull();
    expect(h.statuses).toEqual([NOT_INSTALLED]);
  });

  it('goes ready and hands out the queue', async () => {
    const h = harness();
    await h.host.start();
    expect(h.statuses).toEqual([READY]);
    expect(h.host.status()).toEqual(READY);
    expect(h.queues).toHaveLength(1);
    expect(h.host.queue()).toBe(h.queues[0]);
    expect(h.host.daemon()).toBe(h.daemons[0]);
    expect(h.daemons).toHaveLength(1);
    expect(h.created).toHaveLength(1);
    expect(h.created[0]?.daemon).toBe(h.daemons[0]);
    expect(h.created[0]?.straysCleared).toBe(true);
    expect(h.calls('attachDaemon')).toBe(0); // attaching is for a restart only
    expect(h.daemons[0]?.stops).toBe(0);
  });

  it('checks the tools, then old processes, then starts aria2, then builds and wires the queue', async () => {
    const h = harness();
    await h.host.start();
    expect(h.log).toEqual(['toolsInstalled', 'killStrays', 'startAria2', 'createQueue', 'wireQueue']);
  });

  it('is starting, with no queue, while the engines come up', async () => {
    const h = harness();
    const startGate = h.hold('holdStart');
    const running = h.host.start();
    await flush();
    expect(h.host.status()).toEqual(STARTING);
    expect(h.host.queue()).toBeNull();
    expect(h.statuses).toEqual([]);
    expect(h.calls('killStrays')).toBe(1);
    expect(h.calls('createQueue')).toBe(0);
    startGate.open();
    await running;
    expect(h.statuses).toEqual([READY]);
  });

  it('builds the queue while it is still starting, and only then goes ready', async () => {
    const h = harness();
    await h.host.start();
    expect(h.seen.atCreate).toEqual([STARTING]);
  });

  it('already hands out the aria2 it started while the queue is being built, for a quit that needs it', async () => {
    const h = harness();
    await h.host.start();
    expect(h.seen.daemonAtCreate).toHaveLength(1);
    expect(h.seen.daemonAtCreate[0]).toBe(h.daemons[0]);
  });

  it('keeps the error and no queue when aria2 cannot start', async () => {
    const h = harness();
    h.control.starts = [new Error('spawn aria2c ENOENT')];
    await expect(h.host.start()).resolves.toBeUndefined();
    expect(h.host.status()).toEqual(failed('spawn aria2c ENOENT'));
    expect(h.host.status()).toEqual({ state: 'error', message: 'The download tools could not be started: spawn aria2c ENOENT' });
    expect(h.host.queue()).toBeNull();
    expect(h.host.daemon()).toBeNull(); // no aria2 was ever started
    expect(h.calls('createQueue')).toBe(0);
    expect(h.statuses).toEqual([failed('spawn aria2c ENOENT')]);
  });

  describe('any throw ends in the error status, and start() still resolves', () => {
    const CASES: [string, (c: Control) => void, string][] = [
      ['toolsInstalled rejects', (c) => void (c.toolsError = new Error('registry unreadable')), 'registry unreadable'],
      ['killStrays rejects, which its contract forbids', (c) => void (c.killError = new Error('script blew up')), 'script blew up'],
      ['startAria2 rejects with an Error', (c) => void c.starts.push(new Error('port in use')), 'port in use'],
      ['startAria2 rejects with a text', (c) => void c.starts.push('port in use'), 'port in use'],
      ['createQueue throws an Error', (c) => void (c.createError = new Error('jobs.json unreadable')), 'jobs.json unreadable'],
      ['createQueue throws a text', (c) => void (c.createError = 'jobs.json unreadable'), 'jobs.json unreadable'],
    ];

    it.each(CASES)('when %s', async (_name, arrange, text) => {
      const h = harness();
      arrange(h.control);
      await expect(h.host.start()).resolves.toBeUndefined();
      expect(h.host.status()).toEqual(failed(text));
      expect(h.host.queue()).toBeNull();
      expect(h.statuses).toEqual([failed(text)]);
    });

    it('does not start aria2 when the stray check threw', async () => {
      const h = harness();
      h.control.killError = new Error('script blew up');
      await h.host.start();
      expect(h.calls('startAria2')).toBe(0);
      expect(h.calls('createQueue')).toBe(0);
    });

    it('does not run the stray check when the tool check threw', async () => {
      const h = harness();
      h.control.toolsError = new Error('registry unreadable');
      await h.host.start();
      expect(h.calls('killStrays')).toBe(0);
    });
  });

  it('stops the aria2 it started when a later step fails', async () => {
    const h = harness();
    h.control.createError = new Error('jobs.json unreadable');
    await h.host.start();
    expect(h.daemons).toHaveLength(1);
    expect(h.daemons[0]?.stops).toBe(1);
    expect(h.host.status()).toEqual(failed('jobs.json unreadable'));
    expect(h.host.queue()).toBeNull();
  });

  it('does not stop anything when aria2 itself could not start', async () => {
    const h = harness();
    h.control.starts = [new Error('spawn aria2c ENOENT')];
    await h.host.start();
    expect(h.daemons).toEqual([]);
  });

  it('still reports the failure when the aria2 it started cannot be stopped', async () => {
    const h = harness();
    h.control.createError = new Error('jobs.json unreadable');
    h.control.stopFails = true;
    await expect(h.host.start()).resolves.toBeUndefined();
    expect(h.daemons[0]?.stops).toBe(1);
    expect(h.host.status().state).toBe('error');
    expect(h.host.queue()).toBeNull();
    expect(h.statuses).toHaveLength(1);
    expect((h.statuses[0] as { message: string }).message.startsWith(COULD_NOT_START)).toBe(true);
  });

  it('does not stop a daemon that is running a good queue', async () => {
    const h = await readyHost();
    expect(h.daemons[0]?.stops).toBe(0);
  });

  describe('passes the result of the stray check to the queue', () => {
    it.each([true, false])('killStrays %s', async (cleared) => {
      const h = harness();
      h.control.strays = cleared;
      await h.host.start();
      expect(h.created).toHaveLength(1);
      expect(h.created[0]?.straysCleared).toBe(cleared);
    });

    it('goes ready all the same when the check failed: the queue cuts the jobs off', async () => {
      const h = harness();
      h.control.strays = false;
      await h.host.start();
      expect(h.statuses).toEqual([READY]);
      expect(h.host.queue()).toBe(h.queues[0]);
    });
  });

  describe('retry', () => {
    it('after an error starts the engines', async () => {
      const h = harness();
      h.control.starts = [new Error('spawn aria2c ENOENT'), 'ok'];
      await h.host.start();
      await expect(h.host.retry()).resolves.toBeUndefined();
      expect(h.statuses).toEqual([failed('spawn aria2c ENOENT'), STARTING, READY]);
      expect(h.host.status()).toEqual(READY);
      expect(h.calls('startAria2')).toBe(2);
      expect(h.host.queue()).toBe(h.queues[0]);
      expect(h.host.daemon()).toBe(h.daemons[0]);
      expect(h.calls('attachDaemon')).toBe(0); // no queue existed: this is a full start, not a restart
    });

    it('after a failed queue build starts the engines', async () => {
      const h = harness();
      h.control.createError = new Error('jobs.json unreadable');
      await h.host.start();
      h.control.createError = null;
      await h.host.retry();
      expect(h.statuses).toEqual([failed('jobs.json unreadable'), STARTING, READY]);
      expect(h.daemons).toHaveLength(2);
      expect(h.daemons[0]?.stops).toBe(1); // the first aria2 was stopped
      expect(h.daemons[1]?.stops).toBe(0);
      expect(h.host.daemon()).toBe(h.daemons[1]);
    });

    it('stays in the error status when the second try fails as well', async () => {
      const h = harness();
      h.control.starts = [new Error('first'), new Error('second')];
      await h.host.start();
      await expect(h.host.retry()).resolves.toBeUndefined();
      expect(h.statuses).toEqual([failed('first'), STARTING, failed('second')]);
      expect(h.host.queue()).toBeNull();
      // and a third try can still work
      await h.host.retry();
      expect(h.host.status()).toEqual(READY);
    });

    it('checks for old processes again when there is no queue (C5)', async () => {
      const h = harness();
      h.control.starts = [new Error('spawn aria2c ENOENT')];
      await h.host.start();
      expect(h.calls('killStrays')).toBe(1);
      await h.host.retry();
      expect(h.calls('killStrays')).toBe(2);
    });

    it('a retry after a failed start checks for old processes again', async () => {
      const h = harness();
      h.control.starts = [new Error('x')];
      await h.host.start();
      await h.host.retry();
      expect(h.log.filter((l) => l !== 'toolsInstalled')).toEqual(['killStrays', 'startAria2', 'killStrays', 'startAria2', 'createQueue', 'wireQueue']);
    });

    it.each([
      [true, false],
      [false, true],
      [false, false],
      [true, true],
    ])('hands the result of the new check to the queue: %s then %s', async (first, second) => {
      const h = harness();
      h.control.strays = first;
      h.control.starts = [new Error('x')];
      await h.host.start();
      h.control.strays = second;
      await h.host.retry();
      expect(h.created).toHaveLength(1);
      expect(h.created[0]?.straysCleared).toBe(second);
    });

    it('checks that the tools are still there', async () => {
      const h = harness();
      h.control.starts = [new Error('x')];
      await h.host.start();
      h.control.installed = false;
      await h.host.retry();
      expect(h.statuses).toEqual([failed('x'), NOT_INSTALLED]);
      expect(h.calls('toolsInstalled')).toBe(2);
      expect(h.calls('startAria2')).toBe(1);
    });

    it('does nothing unless the status is error', async () => {
      // before start(): starting
      const fresh = harness();
      await fresh.host.retry();
      expect(fresh.log).toEqual([]);
      expect(fresh.host.status()).toEqual(STARTING);

      // notInstalled
      const missing = harness();
      missing.control.installed = false;
      await missing.host.start();
      const before = [...missing.log];
      await missing.host.retry();
      expect(missing.log).toEqual(before);
      expect(missing.host.status()).toEqual(NOT_INSTALLED);

      // starting, while a start is running: the retry joins that run (G2) and starts nothing itself
      const busy = harness();
      const startGate = busy.hold('holdStart');
      const running = busy.host.start();
      await flush();
      const joined = busy.host.retry();
      await flush();
      expect(busy.calls('startAria2')).toBe(1);
      expect(busy.calls('killStrays')).toBe(1);
      startGate.open();
      await Promise.all([running, joined]);
      expect(busy.calls('startAria2')).toBe(1);
      expect(busy.calls('killStrays')).toBe(1);

      // ready
      const ready = await readyHost();
      await ready.host.retry();
      expect(ready.calls('startAria2')).toBe(1);
      expect(ready.calls('killStrays')).toBe(1);
      expect(ready.calls('createQueue')).toBe(1);
      expect(ready.calls('attachDaemon')).toBe(0);
      expect(ready.statuses).toEqual([READY]);
      expect(ready.host.daemon()).toBe(ready.daemons[0]);
    });

    it('waits for the run in progress and starts nothing itself', async () => {
      const h = harness();
      const startGate = h.hold('holdStart');
      const running = h.host.start();
      await flush();
      let settled = false;
      const retried = h.host.retry().then(() => {
        settled = true;
      });
      await flush();
      expect(settled).toBe(false);
      startGate.open();
      await running;
      await retried;
      expect(settled).toBe(true);
      expect(h.calls('startAria2')).toBe(1);
      expect(h.host.status()).toEqual(READY);
    });

    it('a retry during a held aria2 restart joins it: one startAria2 for that restart', async () => {
      const h = await readyHost();
      h.daemons[0]?.die();
      const startGate = h.hold('holdStart');
      const restarting = h.host.retry();
      await flush();
      expect(h.host.status()).toEqual(STARTING);
      let settled = false;
      const joined = h.host.retry().then(() => {
        settled = true;
      });
      await flush();
      expect(settled).toBe(false);
      expect(h.calls('startAria2')).toBe(2); // the first start and this restart
      startGate.open();
      await Promise.all([restarting, joined]);
      expect(settled).toBe(true);
      expect(h.calls('startAria2')).toBe(2);
      expect(h.calls('attachDaemon')).toBe(1);
      expect(h.host.status()).toEqual(READY);
      expect(h.statuses).toEqual([READY, stopped, STARTING, READY]);
    });

    it('two retries at once start the engines once', async () => {
      const h = harness();
      h.control.starts = [new Error('x')];
      await h.host.start();
      const startGate = h.hold('holdStart');
      const both = Promise.all([h.host.retry(), h.host.retry()]);
      await flush();
      expect(h.calls('startAria2')).toBe(2); // the first try and one retry, not two retries
      expect(h.calls('killStrays')).toBe(2);
      startGate.open();
      await both;
      expect(h.calls('startAria2')).toBe(2);
      expect(h.calls('killStrays')).toBe(2);
      expect(h.calls('createQueue')).toBe(1);
      expect(h.statuses).toEqual([failed('x'), STARTING, READY]);
    });
  });

  describe('start', () => {
    it('two starts at once start aria2 once', async () => {
      const h = harness();
      const startGate = h.hold('holdStart');
      const a = h.host.start();
      const b = h.host.start();
      await flush();
      expect(h.calls('startAria2')).toBe(1);
      expect(h.calls('killStrays')).toBe(1);
      expect(h.calls('toolsInstalled')).toBe(1);
      startGate.open();
      await Promise.all([a, b]);
      expect(h.calls('startAria2')).toBe(1);
      expect(h.calls('killStrays')).toBe(1);
      expect(h.calls('createQueue')).toBe(1);
      expect(h.daemons).toHaveLength(1);
      expect(h.queues).toHaveLength(1);
      expect(h.statuses).toEqual([READY]);
    });

    it('three starts at once, held at each step in turn, still run once', async () => {
      for (const step of ['holdTools', 'holdKill', 'holdStart'] as const) {
        const h = harness();
        const g = h.hold(step);
        const all = [h.host.start(), h.host.start(), h.host.start()];
        await flush();
        g.open();
        await Promise.all(all);
        expect(h.log, step).toEqual(['toolsInstalled', 'killStrays', 'startAria2', 'createQueue', 'wireQueue']);
        expect(h.statuses, step).toEqual([READY]);
      }
    });

    it('a start while another one runs waits for it, so the status is final when it resolves', async () => {
      const h = harness();
      const startGate = h.hold('holdStart');
      const settled = { first: false, second: false };
      const first = h.host.start().then(() => void (settled.first = true));
      const second = h.host.start().then(() => void (settled.second = true));
      await flush();
      expect(settled).toEqual({ first: false, second: false });
      startGate.open();
      await Promise.all([first, second]);
      expect(settled).toEqual({ first: true, second: true });
      expect(h.host.status()).toEqual(READY);
    });

    it('two starts at once that fail both resolve, with one error', async () => {
      const h = harness();
      h.control.starts = [new Error('x')];
      const startGate = h.hold('holdStart');
      const both = Promise.all([h.host.start(), h.host.start()]);
      await flush();
      startGate.open();
      await expect(both).resolves.toEqual([undefined, undefined]);
      expect(h.calls('startAria2')).toBe(1);
      expect(h.statuses).toEqual([failed('x')]);
    });

    it('a start while a retry runs does not start again', async () => {
      const h = harness();
      h.control.starts = [new Error('x')];
      await h.host.start();
      const startGate = h.hold('holdStart');
      const retrying = h.host.retry();
      const starting = h.host.start();
      await flush();
      startGate.open();
      await Promise.all([retrying, starting]);
      expect(h.calls('startAria2')).toBe(2);
      expect(h.calls('createQueue')).toBe(1);
      expect(h.host.status()).toEqual(READY);
    });

    it('start after an error runs like retry', async () => {
      const h = harness();
      h.control.starts = [new Error('spawn aria2c ENOENT')];
      await h.host.start();
      await expect(h.host.start()).resolves.toBeUndefined();
      expect(h.calls('killStrays')).toBe(2);
      expect(h.statuses).toEqual([failed('spawn aria2c ENOENT'), STARTING, READY]);
      expect(h.host.queue()).toBe(h.queues[0]);
      expect(h.calls('attachDaemon')).toBe(0);
    });

    it('start after the tools were installed goes from notInstalled to ready', async () => {
      const h = harness();
      h.control.installed = false;
      await h.host.start();
      h.control.installed = true;
      await h.host.start();
      expect(h.statuses).toEqual([NOT_INSTALLED, STARTING, READY]);
      expect(h.calls('killStrays')).toBe(1);
      expect(h.host.queue()).toBe(h.queues[0]);
    });

    it('start while the tools are still missing stays notInstalled and announces nothing new', async () => {
      const h = harness();
      h.control.installed = false;
      await h.host.start();
      await h.host.start();
      expect(h.statuses).toEqual([NOT_INSTALLED]);
      expect(h.calls('toolsInstalled')).toBe(2);
      expect(h.calls('startAria2')).toBe(0);
    });

    it('start while a queue exists does nothing', async () => {
      const h = await readyHost();
      const before = [...h.log];
      await expect(h.host.start()).resolves.toBeUndefined();
      expect(h.log).toEqual(before);
      expect(h.statuses).toEqual([READY]);
      expect(h.host.queue()).toBe(h.queues[0]);
      expect(h.daemons).toHaveLength(1);
      expect(h.daemons[0]?.stops).toBe(0);
    });

    it('start while a queue exists and aria2 is down does nothing: only retry restarts', async () => {
      const h = await readyHost();
      h.daemons[0]?.die();
      const before = [...h.log];
      await h.host.start();
      expect(h.log).toEqual(before);
      expect(h.host.status()).toEqual(stopped);
      expect(h.statuses).toEqual([READY, stopped]);
    });
  });

  describe('onStatus', () => {
    it('is called when the status changes, not for the first value and not otherwise', async () => {
      const h = harness();
      h.control.starts = [new Error('x')];
      expect(h.statuses).toEqual([]);
      await h.host.start(); // starting -> starting -> error: only the error is a change
      expect(h.statuses).toEqual([failed('x')]);
      await h.host.retry();
      expect(h.statuses).toEqual([failed('x'), STARTING, READY]);
      await h.host.retry(); // from ready: nothing
      await h.host.start(); // a queue exists: nothing
      expect(h.statuses).toEqual([failed('x'), STARTING, READY]);
    });

    it('is not called again for the same error', async () => {
      const h = await readyHost();
      h.daemons[0]?.die();
      expect(h.statuses).toEqual([READY, stopped]);
      h.daemons[0]?.fire(); // the same event again
      h.daemons[0]?.fire();
      expect(h.statuses).toEqual([READY, stopped]);
    });

    it('announces the same error again after another status came in between', async () => {
      const h = await readyHost();
      h.daemons[0]?.die();
      await h.host.retry();
      h.daemons[1]?.die();
      expect(h.statuses).toEqual([READY, stopped, STARTING, READY, stopped]);
    });

    it('hands out status values that later changes do not alter', async () => {
      const h = await readyHost();
      const whileReady = h.host.status();
      h.daemons[0]?.die();
      expect(whileReady).toEqual(READY);
      expect(h.host.status()).toEqual(stopped);
    });
  });
});

describe('EngineHost: aria2 exits while running (9.4)', () => {
  it('reports an aria2 exit and keeps the queue', async () => {
    const h = await readyHost();
    const queue = h.host.queue();
    h.daemons[0]?.die();
    expect(h.host.status()).toEqual(stopped);
    expect(h.host.status()).toEqual({ state: 'error', message: 'The file download service stopped' });
    expect(h.host.queue()).toBe(queue);
    expect(h.host.queue()).not.toBeNull();
    expect(h.host.daemon()).toBe(h.daemons[0]); // still there for quit
    expect(h.statuses).toEqual([READY, stopped]);
    expect(h.calls('createQueue')).toBe(1);
  });

  it('does not stop or restart anything by itself when aria2 exits', async () => {
    const h = await readyHost();
    const before = [...h.log];
    h.daemons[0]?.die();
    await flush();
    expect(h.log).toEqual(before);
    expect(h.daemons).toHaveLength(1);
  });

  it('retry restarts aria2 without the stray check and attaches it', async () => {
    const h = await readyHost();
    const queue = h.host.queue();
    h.daemons[0]?.die();
    await expect(h.host.retry()).resolves.toBeUndefined();
    expect(h.calls('killStrays')).toBe(1); // still once in total: this run's tools are running
    expect(h.calls('startAria2')).toBe(2);
    expect(h.calls('createQueue')).toBe(1); // still once in total
    expect(h.calls('attachDaemon')).toBe(1);
    expect(h.attached[0]).toBe(h.daemons[1]);
    expect(h.host.daemon()).toBe(h.daemons[1]);
    expect(h.host.queue()).toBe(queue);
    expect(h.statuses).toEqual([READY, stopped, STARTING, READY]);
    expect(h.statuses.slice(-2)).toEqual([STARTING, READY]);
  });

  it('starts aria2, attaches it, and only then goes ready', async () => {
    const h = await readyHost();
    h.daemons[0]?.die();
    h.log.length = 0;
    await h.host.retry();
    expect(h.log).toEqual(['startAria2', 'attachDaemon']);
    expect(h.seen.atAttach).toEqual([STARTING]);
  });

  it('already hands out the restarted aria2 while it is being attached', async () => {
    const h = await readyHost();
    h.daemons[0]?.die();
    await h.host.retry();
    expect(h.seen.daemonAtAttach).toHaveLength(1);
    expect(h.seen.daemonAtAttach[0]).toBe(h.daemons[1]);
  });

  it('keeps the queue available while it restarts', async () => {
    const h = await readyHost();
    const queue = h.host.queue();
    h.daemons[0]?.die();
    const startGate = h.hold('holdStart');
    const restarting = h.host.retry();
    await flush();
    expect(h.host.status()).toEqual(STARTING);
    expect(h.host.queue()).toBe(queue);
    expect(h.seen.queueAtAttach).toEqual([]);
    startGate.open();
    await restarting;
    expect(h.seen.queueAtAttach).toEqual([queue]);
  });

  it('a failed restart keeps the queue and the error', async () => {
    const h = await readyHost();
    const queue = h.host.queue();
    h.daemons[0]?.die();
    h.control.starts = [new Error('spawn aria2c ENOENT')];
    await expect(h.host.retry()).resolves.toBeUndefined();
    expect(h.host.status()).toEqual(failed('spawn aria2c ENOENT'));
    expect(h.host.queue()).toBe(queue);
    expect(h.calls('attachDaemon')).toBe(0);
    expect(h.calls('killStrays')).toBe(1);
    expect(h.calls('createQueue')).toBe(1);
    expect(h.statuses).toEqual([READY, stopped, STARTING, failed('spawn aria2c ENOENT')]);
  });

  it('can be retried again after a failed restart', async () => {
    const h = await readyHost();
    const queue = h.host.queue();
    h.daemons[0]?.die();
    h.control.starts = [new Error('first')];
    await h.host.retry();
    await h.host.retry();
    expect(h.host.status()).toEqual(READY);
    expect(h.host.queue()).toBe(queue);
    expect(h.calls('killStrays')).toBe(1);
    expect(h.calls('createQueue')).toBe(1);
    expect(h.calls('attachDaemon')).toBe(1);
    expect(h.statuses).toEqual([READY, stopped, STARTING, failed('first'), STARTING, READY]);
  });

  it('a failed attach keeps the queue and the error, and stops the aria2 it started', async () => {
    const h = await readyHost();
    const queue = h.host.queue();
    h.daemons[0]?.die();
    h.control.attachError = new Error('attach broke');
    await expect(h.host.retry()).resolves.toBeUndefined();
    expect(h.host.status()).toEqual(failed('attach broke'));
    expect(h.host.queue()).toBe(queue);
    expect(h.daemons[1]?.stops).toBe(1);
  });

  it('reports a second exit after a restart', async () => {
    const h = await readyHost();
    h.daemons[0]?.die();
    await h.host.retry();
    expect(h.host.status()).toEqual(READY);
    h.daemons[1]?.die();
    expect(h.host.status()).toEqual(stopped);
    expect(h.host.queue()).toBe(h.queues[0]);
    await h.host.retry();
    expect(h.host.status()).toEqual(READY);
    expect(h.attached).toEqual([h.daemons[1], h.daemons[2]]);
    expect(h.calls('killStrays')).toBe(1);
    expect(h.calls('createQueue')).toBe(1);
  });

  it('two retries at once restart once', async () => {
    const h = await readyHost();
    h.daemons[0]?.die();
    const startGate = h.hold('holdStart');
    const both = Promise.all([h.host.retry(), h.host.retry()]);
    await flush();
    expect(h.calls('startAria2')).toBe(2);
    startGate.open();
    await both;
    expect(h.calls('startAria2')).toBe(2);
    expect(h.calls('attachDaemon')).toBe(1);
    expect(h.daemons).toHaveLength(2);
    expect(h.statuses).toEqual([READY, stopped, STARTING, READY]);
  });

  it('ignores the exit of a daemon that is not the current one', async () => {
    const h = await readyHost();
    h.daemons[0]?.die();
    await h.host.retry();
    expect(h.host.status()).toEqual(READY);
    h.daemons[0]?.fire(); // a late event of the old aria2
    expect(h.host.status()).toEqual(READY);
    expect(h.statuses).toEqual([READY, stopped, STARTING, READY]);
  });

  it('ignores a late exit of an aria2 the host stopped itself after a failed start', async () => {
    const h = harness();
    h.control.createError = new Error('jobs.json unreadable');
    await h.host.start();
    expect(h.host.status()).toEqual(failed('jobs.json unreadable'));
    h.daemons[0]?.fire();
    expect(h.host.status()).toEqual(failed('jobs.json unreadable'));
    expect(h.statuses).toEqual([failed('jobs.json unreadable')]);
  });

  describe('an aria2 that died during startup is reported, not hidden by ready', () => {
    it('when it was gone by the time createQueue returned', async () => {
      const h = harness();
      h.control.createKills = 'quietly';
      await h.host.start();
      expect(h.host.status()).toEqual(stopped);
      expect(h.host.queue()).toBe(h.queues[0]);
      expect(h.host.queue()).not.toBeNull();
      expect(h.host.daemon()).toBe(h.daemons[0]);
      expect(h.statuses).toEqual([stopped]);
    });

    it('when its exit event came while the queue was being built', async () => {
      const h = harness();
      h.control.createKills = 'with an event';
      await h.host.start();
      expect(h.host.status()).toEqual(stopped);
      expect(h.host.queue()).toBe(h.queues[0]);
      expect(h.statuses.some((s) => s.state === 'ready')).toBe(false);
      expect(h.statuses.at(-1)).toEqual(stopped);
    });

    it.each(['quietly', 'with an event'] as const)('and a retry restarts it without a second stray check (%s)', async (how) => {
      const h = harness();
      h.control.createKills = how;
      await h.host.start();
      h.control.createKills = 'no';
      await h.host.retry();
      expect(h.host.status()).toEqual(READY);
      expect(h.calls('killStrays')).toBe(1);
      expect(h.calls('createQueue')).toBe(1);
      expect(h.attached).toEqual([h.daemons[1]]);
      expect(h.host.queue()).toBe(h.queues[0]);
    });

    it('is not stopped again by the host: it is already gone', async () => {
      const h = harness();
      h.control.createKills = 'quietly';
      await h.host.start();
      expect(h.daemons[0]?.stops).toBe(0);
    });
  });

  describe('a restarted aria2 that died during the restart is reported, not hidden by ready', () => {
    it.each(['quietly', 'with an event'] as const)('when it was gone by the time it was attached (%s)', async (how) => {
      const h = await readyHost();
      const queue = h.host.queue();
      h.daemons[0]?.die();
      h.control.attachKills = how;
      await h.host.retry();
      expect(h.host.status()).toEqual(stopped);
      expect(h.host.queue()).toBe(queue);
      expect(h.host.daemon()).toBe(h.daemons[1]);
      expect(h.statuses).toEqual([READY, stopped, STARTING, stopped]);
    });

    it('and the next retry restarts it again', async () => {
      const h = await readyHost();
      h.daemons[0]?.die();
      h.control.attachKills = 'quietly';
      await h.host.retry();
      h.control.attachKills = 'no';
      await h.host.retry();
      expect(h.host.status()).toEqual(READY);
      expect(h.attached).toEqual([h.daemons[1], h.daemons[2]]);
      expect(h.calls('killStrays')).toBe(1);
      expect(h.calls('createQueue')).toBe(1);
    });
  });
});

describe('EngineHost: the host owns a queue from construction to disposal (F2)', () => {
  /** The calls from the queue build on: construct, wire, dispose, and the daemon stop. */
  const queueSteps = (h: Harness): string[] => h.log.slice(h.log.indexOf('createQueue'));

  describe('wiring throws', () => {
    it.each([
      ['an Error', new Error('tray broke'), 'tray broke'],
      ['a text', 'tray broke', 'tray broke'],
    ])('disposes the queue, then stops aria2, then reports the wiring error (%s)', async (_name, thrown, text) => {
      const h = harness();
      h.control.wireError = thrown;
      await expect(h.host.start()).resolves.toBeUndefined();
      expect(queueSteps(h)).toEqual(['createQueue', 'wireQueue', 'disposeQueue', 'disposed', 'daemon.stop']);
      expect(h.disposed).toEqual([h.queues[0]]);
      expect(h.host.status()).toEqual(failed(text));
      expect(h.statuses).toEqual([failed(text)]);
      expect(h.host.queue()).toBeNull();
      expect(h.daemons[0]?.stops).toBe(1);
    });

    it('stops aria2 only once the dispose has settled', async () => {
      const h = harness();
      h.control.wireError = new Error('tray broke');
      const disposing = h.hold('holdDispose');
      const running = h.host.start();
      await flush();
      expect(h.calls('disposeQueue')).toBe(1);
      expect(h.daemons[0]?.stops).toBe(0);
      expect(h.host.status()).toEqual(STARTING);
      expect(h.host.queue()).toBeNull();
      disposing.open();
      await running;
      expect(h.daemons[0]?.stops).toBe(1);
      expect(h.host.status()).toEqual(failed('tray broke'));
    });

    it('a dispose that rejects still ends in the wiring error, and a later Retry works', async () => {
      const h = harness();
      h.control.wireError = new Error('tray broke');
      h.control.disposeError = new Error('shutdown broke');
      await expect(h.host.start()).resolves.toBeUndefined();
      expect(queueSteps(h)).toEqual(['createQueue', 'wireQueue', 'disposeQueue', 'disposed', 'daemon.stop']);
      expect(h.host.status()).toEqual(failed('tray broke'));
      expect(h.statuses).toEqual([failed('tray broke')]);
      expect(h.host.queue()).toBeNull();
      h.control.wireError = null;
      h.control.disposeError = null;
      await h.host.retry();
      expect(h.host.status()).toEqual(READY);
      expect(h.calls('createQueue')).toBe(2);
      expect(h.host.queue()).toBe(h.queues[1]);
      expect(h.host.daemon()).toBe(h.daemons[1]);
      expect(h.wired).toEqual([h.queues[1]]);
    });

    it('still ends in the wiring error when the aria2 it stops cannot be stopped', async () => {
      const h = harness();
      h.control.wireError = new Error('tray broke');
      h.control.stopFails = true;
      await expect(h.host.start()).resolves.toBeUndefined();
      expect(h.host.status()).toEqual(failed('tray broke'));
      expect(h.host.queue()).toBeNull();
    });

    it('builds no second queue while the first one is being disposed; Retry then builds exactly one', async () => {
      const h = harness();
      h.control.wireError = new Error('tray broke');
      const disposing = h.hold('holdDispose');
      const settled = { start: false, retry: false, again: false };
      const first = h.host.start().then(() => void (settled.start = true));
      await flush();
      expect(h.calls('disposeQueue')).toBe(1);
      h.control.wireError = null;
      // A Retry and a start made meanwhile.
      const retried = h.host.retry().then(() => void (settled.retry = true));
      const again = h.host.start().then(() => void (settled.again = true));
      await flush();
      expect(h.calls('createQueue')).toBe(1);
      expect(h.calls('startAria2')).toBe(1);
      expect(h.calls('killStrays')).toBe(1);
      expect(settled.again).toBe(false); // a start waits for the run that disposes
      expect(settled.retry).toBe(false); // and so does a Retry (G2)
      disposing.open();
      h.control.holdDispose = null;
      await Promise.all([first, retried, again]);
      expect(settled).toEqual({ start: true, retry: true, again: true });
      // Nothing was built before the dispose settled: the first run ends in its error.
      expect(h.calls('createQueue')).toBe(1);
      expect(h.host.status()).toEqual(failed('tray broke'));
      expect(h.host.queue()).toBeNull();
      // The Retry the banner then offers builds exactly one queue.
      await Promise.all([h.host.retry(), h.host.retry()]);
      expect(h.calls('createQueue')).toBe(2);
      expect(h.log.indexOf('createQueue', h.log.indexOf('disposed'))).toBeGreaterThan(h.log.indexOf('disposed'));
      expect(h.host.status()).toEqual(READY);
      expect(h.host.queue()).toBe(h.queues[1]);
    });

    it('an aria2 exit while the queue is disposed is not reported over the wiring error', async () => {
      const h = harness();
      h.control.wireError = new Error('tray broke');
      const disposing = h.hold('holdDispose');
      const running = h.host.start();
      await flush();
      h.daemons[0]?.die();
      disposing.open();
      await running;
      expect(h.statuses).toEqual([failed('tray broke')]);
    });
  });

  it('a createQueue that throws disposes nothing and wires nothing', async () => {
    const h = harness();
    h.control.createError = new Error('jobs.json unreadable');
    await h.host.start();
    expect(h.calls('wireQueue')).toBe(0);
    expect(h.calls('disposeQueue')).toBe(0);
    expect(h.daemons[0]?.stops).toBe(1);
  });

  describe('wiring succeeds', () => {
    it('hands out the queue only after wireQueue returned, and goes ready', async () => {
      const h = harness();
      await h.host.start();
      expect(h.seen.queueAtWire).toEqual([null]);
      expect(h.seen.atWire).toEqual([STARTING]);
      expect(h.wired).toEqual([h.queues[0]]);
      expect(h.host.queue()).toBe(h.queues[0]);
      expect(h.host.status()).toEqual(READY);
      expect(h.calls('disposeQueue')).toBe(0);
      expect(h.daemons[0]?.stops).toBe(0);
    });

    it('wires the queue that createQueue built, with the aria2 it was built on still running', async () => {
      const h = harness();
      await h.host.start();
      expect(h.created[0]?.daemon).toBe(h.daemons[0]);
      expect(h.wired[0]).toBe(h.queues[0]);
    });

    it('an aria2 that died while the queue was wired is reported, not hidden by ready', async () => {
      const h = harness();
      h.deps.wireQueue = (queue) => {
        h.log.push('wireQueue');
        h.daemons[0]?.die();
        h.wired.push(queue);
      };
      await h.host.start();
      expect(h.host.status()).toEqual(stopped);
      expect(h.host.queue()).toBe(h.queues[0]);
    });
  });
});
