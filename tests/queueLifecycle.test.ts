import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EngineHost } from '../src/main/engineHost';
import type { Engine } from '../src/main/engines/engine';
import type { Aria2Daemon } from '../src/main/engines/file';
import type { Queue } from '../src/main/jobs/queue';
import { Store } from '../src/main/jobs/store';
import { createQueueLifecycle, type QueueLifecycle } from '../src/main/queueLifecycle';
import type { EngineStatus, Job, Settings, Snapshot } from '../src/shared/types';
import { makeJob, makeSettings } from './helpers';

const COULD_NOT_START = 'The download tools could not be started: ';
const READY: EngineStatus = { state: 'ready' };
const failed = (message: string): EngineStatus => ({ state: 'error', message: `${COULD_NOT_START}${message}` });

/** Lets every promise that can settle without a timer settle. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Every engine call of the run, in order, over all engines built: `start:<id>`, `stop:<id>`. */
let calls: string[];
/** Engine stops and aria2 stops, in order: `stop:<id>`, `daemon.stop`. */
let stops: string[];

/** The real store, which throws instead of writing while `failing` is on. */
class FlakyStore extends Store {
  failing = false;
  override saveSnapshot(s: Snapshot): void {
    if (this.failing) throw new Error('disk full');
    super.saveSnapshot(s);
  }
}

class FakeEngine implements Engine {
  /** stop rejects: the stop is not confirmed. */
  stopFails = false;
  /** While set, stop waits for it. */
  stopGate: Promise<void> | null = null;
  attached: Aria2Daemon[] = [];
  /** These specs never make an engine report anything. */
  on(): void {
    return;
  }
  start(job: Job): void {
    calls.push(`start:${job.id}`);
  }
  async stop(jobId: string): Promise<void> {
    calls.push(`stop:${jobId}`);
    stops.push(`stop:${jobId}`);
    if (this.stopGate) await this.stopGate;
    if (this.stopFails) throw new Error('the process did not end');
  }
  async discard(): Promise<void> {
    return;
  }
  async setRateLimit(): Promise<boolean> {
    return true;
  }
  attach(daemon: Aria2Daemon): void {
    this.attached.push(daemon);
  }
}

function fakeDaemon(): Aria2Daemon {
  let up = true;
  return {
    rpc: { call: async () => null },
    alive: () => up,
    onExit: () => undefined,
    stop: async () => {
      stops.push('daemon.stop');
      up = false;
    },
  };
}

interface Run {
  host: EngineHost<Queue>;
  life: QueueLifecycle;
  store: FlakyStore;
  /** The engines built for each queue, in order. */
  built: { media: FakeEngine; file: FakeEngine }[];
  daemons: Aria2Daemon[];
  /** What the window was sent, in order. */
  sent: { channel: string; args: unknown[] }[];
  statuses: EngineStatus[];
  saveStates: (string | null)[];
  /** The queues createQueue returned, in order. */
  queues: Queue[];
  control: {
    /** the answer of killStrays */
    strays: boolean;
    /** how many of the next tray attaches throw */
    trayFailures: number;
    /** the stop of the media engine of the next built queue fails */
    mediaStopFails: boolean;
    /** while set, the media engine of the next built queue holds its stops */
    mediaStopGate: Promise<void> | null;
    /** every send to the window throws */
    sendFails: boolean;
    /** every call of deps.onSaveState throws, the one at registration included */
    saveStateFails: boolean;
    /** the store starts failing when the host disposes a queue */
    storeFailsOnDispose: boolean;
  };
  trayAttached: Queue[];
}

let dataDir: string;
let downloads: string;

beforeEach(() => {
  calls = [];
  stops = [];
  dataDir = mkdtempSync(join(tmpdir(), 'hammel-life-data-'));
  downloads = mkdtempSync(join(tmpdir(), 'hammel-life-dl-'));
});

/** A queued video, valid for the stored list. */
const queuedJob = (id = 'v1'): Job => makeJob({ id, state: 'queued', dir: downloads, baseName: id, title: id });

function run(initialJobs: Job[], settings: Partial<Settings> = {}): Run {
  const store = new FlakyStore(dataDir, downloads);
  store.saveSnapshot({ jobs: initialJobs, groups: [] });
  const loaded = store.load();
  const current = makeSettings({ downloadDir: downloads, ...settings });
  const r: Omit<Run, 'host' | 'life'> = {
    store,
    built: [],
    daemons: [],
    sent: [],
    statuses: [],
    saveStates: [],
    queues: [],
    control: {
      strays: true,
      trayFailures: 0,
      mediaStopFails: false,
      mediaStopGate: null,
      sendFails: false,
      saveStateFails: false,
      storeFailsOnDispose: false,
    },
    trayAttached: [],
  };
  const life = createQueueLifecycle({
    store,
    initial: loaded.snapshot,
    settings: () => current,
    engines: () => {
      const media = new FakeEngine();
      const file = new FakeEngine();
      media.stopFails = r.control.mediaStopFails;
      media.stopGate = r.control.mediaStopGate;
      r.built.push({ media, file });
      return { media, file };
    },
    send: (channel, ...args) => {
      if (r.control.sendFails) throw new Error('window gone');
      r.sent.push({ channel, args });
    },
    attachTray: (queue) => {
      if (r.control.trayFailures > 0) {
        r.control.trayFailures -= 1;
        throw new Error('tray broke');
      }
      r.trayAttached.push(queue);
    },
    onSaveState: (error) => {
      if (r.control.saveStateFails) throw new Error('save state broke');
      r.saveStates.push(error);
    },
  });
  const host = new EngineHost<Queue>({
    toolsInstalled: async () => true,
    killStrays: async () => r.control.strays,
    startAria2: async () => {
      const d = fakeDaemon();
      r.daemons.push(d);
      return d;
    },
    createQueue: (daemon, straysCleared) => {
      const q = life.createQueue(daemon, straysCleared);
      r.queues.push(q);
      return q;
    },
    wireQueue: (q) => life.wireQueue(q),
    disposeQueue: (q) => {
      if (r.control.storeFailsOnDispose) store.failing = true;
      return life.disposeQueue(q);
    },
    attachDaemon: (daemon) => life.attachDaemon(daemon),
    onStatus: (s) => void r.statuses.push(s),
  });
  return { ...r, host, life };
}

const saved = (store: Store): Snapshot => store.load().snapshot;
const starts = (): string[] => calls.filter((c) => c.startsWith('start:'));

describe('queueLifecycle with a real Queue and Store (F2)', () => {
  it('imports nothing from Electron', () => {
    const source = readFileSync(join(__dirname, '../src/main/queueLifecycle.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"]electron['"]/u);
    expect(source).not.toMatch(/require\(['"]electron['"]\)/u);
  });

  describe('wiring throws', () => {
    it.each([
      ['confirmed', false, false],
      ['not confirmed', true, true],
    ])('the started job is stopped, nothing else starts, and it is saved paused; its stop %s', async (_name, stopFails, cutOff) => {
      const r = run([queuedJob('v1')]);
      r.control.trayFailures = 1;
      r.control.mediaStopFails = stopFails;
      await r.host.start();
      expect(calls).toEqual(['start:v1', 'stop:v1']);
      expect(r.host.status()).toEqual(failed('tray broke'));
      expect(r.host.queue()).toBeNull();
      const job = saved(r.store).jobs[0];
      expect(job).toMatchObject({ id: 'v1', state: 'paused' });
      // The stored list marks it cut off only when its stop failed (load keeps a paused job's mark).
      expect(job?.interrupted).toBe(cutOff);
      expect(r.queues[0]?.snapshot().jobs[0]).toMatchObject({ state: 'paused', interrupted: cutOff });
      await flush();
      expect(starts()).toEqual(['start:v1']);
    });

    it('stops aria2 only after the queue has stopped its job', async () => {
      const r = run([queuedJob('v1')]);
      r.control.trayFailures = 1;
      let release: () => void = () => undefined;
      r.control.mediaStopGate = new Promise<void>((resolve) => (release = resolve));
      const running = r.host.start();
      await flush();
      expect(calls).toEqual(['start:v1', 'stop:v1']);
      expect(r.daemons[0]?.alive()).toBe(true);
      release();
      await running;
      expect(r.daemons[0]?.alive()).toBe(false);
    });

    it('builds no second queue before the first one has stopped', async () => {
      const r = run([queuedJob('v1')]);
      r.control.trayFailures = 1;
      let release: () => void = () => undefined;
      r.control.mediaStopGate = new Promise<void>((resolve) => (release = resolve));
      const first = r.host.start();
      await flush();
      const meanwhile = [r.host.retry(), r.host.start()];
      await flush();
      expect(r.queues).toHaveLength(1);
      r.control.mediaStopGate = null;
      release();
      await Promise.all([first, ...meanwhile]);
      expect(r.queues).toHaveLength(1);
      expect(r.host.status()).toEqual(failed('tray broke'));
      await r.host.retry();
      expect(r.queues).toHaveLength(2);
      expect(r.host.status()).toEqual(READY);
      expect(r.host.queue()).toBe(r.queues[1]);
    });

    it('the second queue starts from the list the first one saved: a cut-off job is not started while the stray check fails', async () => {
      const r = run([queuedJob('v1')], { autoResumeOnStart: true });
      r.control.trayFailures = 1;
      r.control.mediaStopFails = true;
      await r.host.start();
      const afterDispose = saved(r.store);
      expect(afterDispose.jobs[0]).toMatchObject({ id: 'v1', state: 'paused', interrupted: true });
      r.control.strays = false;
      r.control.mediaStopFails = false;
      await r.host.retry();
      expect(r.host.status()).toEqual(READY);
      const second = r.host.queue();
      expect(second).toBe(r.queues[1]);
      expect(second?.snapshot()).toEqual(afterDispose);
      await flush();
      expect(starts()).toEqual(['start:v1']); // only the first queue's start
      expect(saved(r.store).jobs[0]).toMatchObject({ id: 'v1', state: 'paused', interrupted: true });
    });

    it('the second queue keeps a job the first one stopped cleanly paused, not queued', async () => {
      const r = run([queuedJob('v1')]);
      r.control.trayFailures = 1;
      await r.host.start();
      await r.host.retry();
      expect(r.host.status()).toEqual(READY);
      expect(r.host.queue()?.snapshot().jobs[0]).toMatchObject({ id: 'v1', state: 'paused', interrupted: false });
      await flush();
      expect(starts()).toEqual(['start:v1']);
    });
  });

  describe('a listener of the wiring that keeps throwing never stops the dispose (G1)', () => {
    it('send throws on every call: the job is stopped before aria2, which is stopped once; saved paused, not cut off; then Retry builds one queue and goes ready', async () => {
      const r = run([queuedJob('v1')]);
      r.control.sendFails = true;
      await expect(r.host.start()).resolves.toBeUndefined();
      expect(stops).toEqual(['stop:v1', 'daemon.stop']);
      const job = saved(r.store).jobs[0];
      expect(job).toMatchObject({ id: 'v1', state: 'paused' });
      expect(job?.interrupted).toBe(false);
      expect(r.host.queue()).toBeNull();
      expect(r.host.status()).toEqual(failed('window gone'));
      const afterDispose = saved(r.store);

      r.control.sendFails = false;
      await r.host.retry();
      expect(r.queues).toHaveLength(2);
      expect(r.host.status()).toEqual(READY);
      expect(r.host.queue()).toBe(r.queues[1]);
      expect(r.queues[1]?.snapshot()).toEqual(afterDispose);
      await flush();
      expect(starts()).toEqual(['start:v1']); // the paused job is not started again
    });

    it('deps.onSaveState throws on every call and the store fails during close: the job is stopped before aria2, which is stopped once', async () => {
      const r = run([queuedJob('v1')]);
      r.control.saveStateFails = true;
      r.control.storeFailsOnDispose = true;
      await expect(r.host.start()).resolves.toBeUndefined();
      expect(r.store.failing).toBe(true);
      expect(stops).toEqual(['stop:v1', 'daemon.stop']);
      expect(r.queues[0]?.snapshot().jobs[0]).toMatchObject({ id: 'v1', state: 'paused', interrupted: false });
      expect(r.host.queue()).toBeNull();
      expect(r.host.status()).toEqual(failed('save state broke'));
    });
  });

  describe('wiring succeeds', () => {
    it('sends the list, attaches the tray and the save state, and goes ready', async () => {
      const r = run([queuedJob('v1')]);
      await r.host.start();
      const q = r.host.queue();
      expect(q).toBe(r.queues[0]);
      expect(r.host.status()).toEqual(READY);
      expect(r.trayAttached).toEqual([q]);
      expect(r.saveStates).toEqual([null]);
      expect(r.sent.at(-1)).toEqual({ channel: 'hammel:changed', args: [q?.snapshot()] });
      expect(calls).toEqual(['start:v1']);
    });

    it('pushes later changes of the queue to the window', async () => {
      const r = run([]);
      await r.host.start();
      const before = r.sent.length;
      r.host.queue()?.confirmStraysGone();
      expect(r.sent.length).toBeGreaterThan(before);
      expect(r.sent.at(-1)?.channel).toBe('hammel:changed');
    });

    it('resumes paused jobs when autoResumeOnStart is on', async () => {
      const paused = makeJob({ id: 'p', state: 'paused', dir: downloads, baseName: 'p', title: 'p' });
      const r = run([paused], { autoResumeOnStart: true });
      await r.host.start();
      await flush();
      expect(starts()).toEqual(['start:p']);
    });

    it('hands a restarted aria2 to the file engine of the wired queue', async () => {
      const r = run([]);
      await r.host.start();
      const d = fakeDaemon();
      r.life.attachDaemon(d);
      expect(r.built[0]?.file.attached).toEqual([d]);
    });
  });

  it('attachDaemon throws before any queue was wired', () => {
    const r = run([]);
    expect(() => r.life.attachDaemon(fakeDaemon())).toThrow('the file engine is not running');
  });

  it('attachDaemon after a failed wiring and a good retry reaches the second queue only', async () => {
    const r = run([]);
    r.control.trayFailures = 1;
    await r.host.start();
    expect(() => r.life.attachDaemon(fakeDaemon())).toThrow('the file engine is not running');
    await r.host.retry();
    const d = fakeDaemon();
    r.life.attachDaemon(d);
    expect(r.built[0]?.file.attached).toEqual([]);
    expect(r.built[1]?.file.attached).toEqual([d]);
  });

  it('disposeQueue resolves after the shutdown of that queue and keeps its final list for the next build', async () => {
    const r = run([queuedJob('v1')]);
    const d = fakeDaemon();
    const q = r.life.createQueue(d, true);
    expect(calls).toEqual(['start:v1']);
    await r.life.disposeQueue(q);
    expect(calls).toEqual(['start:v1', 'stop:v1']);
    const next = r.life.createQueue(d, true);
    expect(next.snapshot()).toEqual(q.snapshot());
    expect(next.snapshot().jobs[0]).toMatchObject({ state: 'paused' });
    expect(starts()).toEqual(['start:v1']);
  });
});
