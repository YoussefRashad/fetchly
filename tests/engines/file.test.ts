import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineEvent, RunExtras, StartContext } from '../../src/main/engines/engine';
import {
  aria2DaemonArgs,
  Aria2RpcError,
  Aria2TransportError,
  createRpcClient,
  daemonHandle,
  FileEngine,
  type Aria2Daemon,
  type Aria2Rpc,
} from '../../src/main/engines/file';
import type { Job } from '../../src/shared/types';
import { active, complete, failed, FakeAria2, refusalMessage, waiting } from '../fakes/fake-aria2';
import { makeJob, makeSettings } from '../helpers';
import { sleep, waitFor } from '../wait';

const ctx: StartContext = { settings: makeSettings(), rateLimitBytes: null, extras: null };

/** Poll period of the engines built by makeEngine. */
const POLL = 10;
const STOP_FAILED = 'could not confirm that the download stopped';
const SERVICE_STOPPED = 'the download service stopped';
const TELL = 'aria2.tellStatus';

let dir: string;
let rpc: FakeAria2;
let engine: FileEngine;
let events: EngineEvent[];

const fileJob = (over: Partial<Job> = {}): Job =>
  makeJob({ kind: 'file', quality: null, baseName: null, url: 'https://example.com/x.zip', dir, fileName: 'x.zip', ...over });
const ended = () => events.find((e) => e.type === 'done' || e.type === 'error');

type Progress = Extract<EngineEvent, { type: 'progress' }>;
const progress = (): Progress[] => events.filter((e): e is Progress => e.type === 'progress');
/** The event the engine emits for a download that stopped moving: speed 0, no eta. */
const stalls = (): Progress[] => progress().filter((e) => e.speed === 0 && e.eta === null);
const errorsOf = () => events.filter((e) => e.type === 'error');
const count = (method: string, on: FakeAria2 = rpc): number => on.methods().filter((m) => m === method).length;
const tellCalls = (on: FakeAria2 = rpc): number => count(TELL, on);

/** Collects the events of `e` into the array of this test (a later test must never see them). */
function listen(e: FileEngine): void {
  const sink = events;
  e.on((ev) => sink.push(ev));
}

function makeEngine(over: { pollMs?: number; daemonAlive?: () => boolean } = {}, on: Aria2Rpc = rpc): FileEngine {
  const e = new FileEngine(on, { pollMs: POLL, ...over });
  listen(e);
  return e;
}

/** The outcome of a promise that is not awaited at once (no unhandled rejection, can be asked "settled yet?"). */
interface Outcome {
  done: boolean;
  ok: boolean;
  error: string | null;
  settled: Promise<void>;
}
function track(p: Promise<unknown>): Outcome {
  const out: Outcome = { done: false, ok: false, error: null, settled: Promise.resolve() };
  out.settled = p.then(
    () => {
      out.done = true;
      out.ok = true;
    },
    (e: unknown) => {
      out.done = true;
      out.error = e instanceof Error ? e.message : String(e);
    },
  );
  return out;
}

/** An rpc that behaves like `inner` except that the given method gets no answer (Aria2TransportError). */
function silentOn(inner: Aria2Rpc, method: string): Aria2Rpc {
  return { call: (m, p) => (m === method ? Promise.reject(new Aria2TransportError('no answer')) : inner.call(m, p)) };
}

/** An Aria2Daemon the tests control: the engine only reads rpc and alive(). */
function daemonOn(on: Aria2Rpc, alive: () => boolean = () => true): Aria2Daemon {
  return { rpc: on, alive, onExit: () => undefined, stop: async () => undefined };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetchly-file-'));
  rpc = new FakeAria2();
  events = [];
  engine = makeEngine();
});

describe('FileEngine', () => {
  it('adds the download into the job folder under the job file name', async () => {
    rpc.script(complete(100));
    engine.start(fileJob(), ctx);
    await waitFor(ended);
    expect(rpc.calls[0]).toEqual({
      method: 'aria2.addUri',
      params: [['https://example.com/x.zip'], { dir, out: 'x.zip', 'max-download-limit': '0' }],
    });
  });

  it.each([
    [null, '0'],
    [0, '0'],
    [307200, '307200'],
  ])('passes the per-download limit to aria2 (rateLimitBytes %s gives "%s")', async (rateLimitBytes, expected) => {
    rpc.script(complete(100));
    engine.start(fileJob(), { ...ctx, rateLimitBytes });
    await waitFor(ended);
    expect(rpc.calls[0]).toEqual({
      method: 'aria2.addUri',
      params: [['https://example.com/x.zip'], { dir, out: 'x.zip', 'max-download-limit': expected }],
    });
  });

  it('reports progress and then the finished file', async () => {
    rpc.script(active(250, 1000, 250), active(500, 1000, 0), complete(1000));
    const job = fileJob();
    engine.start(job, ctx);
    await waitFor(ended);
    expect(events).toEqual([
      { jobId: job.id, type: 'progress', bytesDone: 250, bytesTotal: 1000, speed: 250, eta: 3 },
      { jobId: job.id, type: 'progress', bytesDone: 500, bytesTotal: 1000, speed: 0, eta: null },
      { jobId: job.id, type: 'done', fileName: 'x.zip', actualHeight: null },
    ]);
  });

  it('reports an unknown size as null', async () => {
    rpc.script(active(250, 0, 100), complete(300));
    engine.start(fileJob(), ctx);
    await waitFor(ended);
    expect(events[0]).toMatchObject({ bytesTotal: null, eta: null });
  });

  it('says nothing while aria2 reports the download as waiting', async () => {
    rpc.script(waiting(), waiting(), complete(10));
    engine.start(fileJob(), ctx);
    await waitFor(ended);
    expect(events.map((e) => e.type)).toEqual(['done']);
  });

  it('stops polling once the download is over', async () => {
    rpc.script(complete(10));
    engine.start(fileJob(), ctx);
    await waitFor(ended);
    const polls = tellCalls();
    await sleep(60);
    expect(tellCalls()).toBe(polls);
  });

  it.each([
    [9, 'disk full'],
    [15, 'cannot write to folder'],
    [16, 'cannot write to folder'],
    [17, 'cannot write to folder'],
    [18, 'cannot write to folder'],
    [3, 'file not found on server'],
    [24, 'login required'],
    [13, 'file already exists'],
  ])('maps aria2 error %d to "%s" without retrying', async (code, reason) => {
    rpc.script(failed(code, 'whatever aria2 said'));
    engine.start(fileJob(), ctx);
    expect(await waitFor(ended)).toMatchObject({ type: 'error', outcome: 'failed', reason, retryable: false });
  });

  it('retries any other aria2 error and passes its message on', async () => {
    rpc.script(failed(2, 'Timeout.'));
    engine.start(fileJob(), ctx);
    expect(await waitFor(ended)).toMatchObject({ type: 'error', outcome: 'failed', reason: 'Timeout.', retryable: true });
  });

  it('reports a retryable failure when aria2 cannot be reached', async () => {
    rpc.failAddUri = true;
    const job = fileJob();
    engine.start(job, ctx);
    expect(await waitFor(ended)).toEqual({
      jobId: job.id,
      type: 'error',
      outcome: 'failed',
      reason: 'the download service is not running',
      retryable: true,
    });
  });

  it('reports aria2 own message, retryable, when addUri is refused', async () => {
    rpc.refuse.add('aria2.addUri');
    const job = fileJob();
    engine.start(job, ctx);
    expect(await waitFor(ended)).toEqual({
      jobId: job.id,
      type: 'error',
      outcome: 'failed',
      reason: refusalMessage('aria2.addUri'),
      retryable: true,
    });
  });

  it('refuses a job without a file name', () => {
    engine.start(fileJob({ fileName: null }), ctx);
    expect(events[0]).toMatchObject({ type: 'error', outcome: 'failed', retryable: false });
  });

  it('stop pauses then removes the download and emits nothing more', async () => {
    rpc.script(active(10, 100, 5));
    const job = fileJob();
    engine.start(job, ctx);
    await waitFor(() => events.length > 0);
    await engine.stop(job.id);
    const seen = events.length;
    await sleep(60);
    expect(events.length).toBe(seen);
    expect(ended()).toBeUndefined();
    expect(rpc.calls.filter((c) => c.method !== TELL)).toEqual([
      { method: 'aria2.addUri', params: [['https://example.com/x.zip'], { dir, out: 'x.zip', 'max-download-limit': '0' }] },
      { method: 'aria2.forcePause', params: ['gid1'] },
      { method: 'aria2.remove', params: ['gid1'] },
    ]);
  });

  it('stop right after start still removes the download', async () => {
    const job = fileJob();
    engine.start(job, ctx);
    await engine.stop(job.id);
    expect(rpc.methods()).toEqual(['aria2.addUri', 'aria2.forcePause', 'aria2.remove']);
    await sleep(60);
    expect(events).toEqual([]);
    expect(tellCalls()).toBe(0);
  });

  it('stopping a job that is not running does nothing', async () => {
    await engine.stop('nobody');
    expect(rpc.calls).toEqual([]);
  });

  it('discard deletes the partial file and its control file', async () => {
    writeFileSync(join(dir, 'x.zip'), 'partial');
    writeFileSync(join(dir, 'x.zip.aria2'), 'control');
    await engine.discard(fileJob());
    expect(existsSync(join(dir, 'x.zip'))).toBe(false);
    expect(existsSync(join(dir, 'x.zip.aria2'))).toBe(false);
  });

  it('discard never deletes a finished file', async () => {
    writeFileSync(join(dir, 'x.zip'), 'finished');
    await engine.discard(fileJob());
    expect(existsSync(join(dir, 'x.zip'))).toBe(true);
  });

  it('has no global speed limit any more', async () => {
    expect((engine as unknown as Record<string, unknown>)['setGlobalLimit']).toBeUndefined();
    rpc.script(active(10, 100, 5));
    const job = fileJob();
    engine.start(job, ctx);
    await waitFor(() => events.length > 0);
    await engine.setRateLimit(job.id, 1000);
    expect(rpc.methods()).not.toContain('aria2.changeGlobalOption');
    await engine.stop(job.id);
  });
});

/**
 * Every spec below counts polls, so they run on a controlled clock: one advance of POLL ms is exactly one
 * interval tick. (A poll answers within microtasks; the fake rpc never uses a timer.)
 */
describe('FileEngine on a controlled clock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }
  /** `n` interval ticks, one at a time. */
  async function tick(n = 1): Promise<void> {
    for (let i = 0; i < n; i += 1) await vi.advanceTimersByTimeAsync(POLL);
  }
  /** Runs until `n` progress events exist (the first poll may or may not run at once). */
  async function untilProgress(n = 1): Promise<void> {
    await flush();
    for (let i = 0; i < 6 && progress().length < n; i += 1) await tick();
    expect(progress().length).toBeGreaterThanOrEqual(n);
  }
  /** `n` polls while the service stays down; each tick must be exactly one poll. */
  async function silentPolls(n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      const before = tellCalls();
      await tick();
      expect(tellCalls()).toBe(before + 1);
    }
  }
  const errorEvent = (job: Job, reason: string) => ({ jobId: job.id, type: 'error', outcome: 'failed', reason, retryable: true });
  const stallEvent = (job: Job, bytesDone: number, bytesTotal: number | null) => ({
    jobId: job.id,
    type: 'progress',
    bytesDone,
    bytesTotal,
    speed: 0,
    eta: null,
  });

  describe('start', () => {
    it.each([
      ['an unreachable service', () => (rpc.failAddUri = true), 'the download service is not running'],
      ['an addUri answered with an error', () => rpc.refuse.add('aria2.addUri'), refusalMessage('aria2.addUri')],
    ])('an addUri failure releases the job: %s', async (_name, arrange, reason) => {
      arrange();
      const job = fileJob();
      engine.start(job, ctx);
      await flush();
      expect(events).toEqual([errorEvent(job, reason)]);
      // released: a stop finds nothing to end, a new start is accepted
      await engine.stop(job.id);
      expect(count('aria2.remove')).toBe(0);
      rpc.failAddUri = false;
      rpc.refuse.clear();
      engine.start(job, ctx);
      await untilProgress();
      expect(count('aria2.addUri')).toBe(2);
    });

    it('uses a poll period of 500 ms and a live daemon when no options are given', async () => {
      rpc.script(active(10, 100, 5));
      const plain = new FileEngine(rpc);
      listen(plain);
      plain.start(fileJob(), ctx);
      await flush();
      const first = tellCalls();
      await vi.advanceTimersByTimeAsync(499);
      expect(tellCalls()).toBe(first);
      await vi.advanceTimersByTimeAsync(1);
      expect(tellCalls()).toBe(first + 1);
      rpc.transportDown = true;
      for (let i = 0; i < 12; i += 1) await vi.advanceTimersByTimeAsync(500);
      expect(ended()).toBeUndefined();
    });

    it('honours the poll period it is given', async () => {
      rpc.script(active(10, 100, 5));
      const slow = new FileEngine(rpc, { pollMs: 25 });
      listen(slow);
      slow.start(fileJob(), ctx);
      await flush();
      const first = tellCalls();
      await vi.advanceTimersByTimeAsync(24);
      expect(tellCalls()).toBe(first);
      await vi.advanceTimersByTimeAsync(1);
      expect(tellCalls()).toBe(first + 1);
    });
  });

  describe('stop', () => {
    it.each(['aria2.forcePause', 'aria2.remove'])('a second stop during a pending stop shares it (held at %s)', async (method) => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      const release = rpc.hold(method);
      const first = track(engine.stop(job.id));
      const second = track(engine.stop(job.id));
      await flush();
      expect(count(method)).toBe(1);
      expect(first.done || second.done).toBe(false);
      release();
      await Promise.all([first.settled, second.settled]);
      expect([first.ok, second.ok]).toEqual([true, true]);
      expect(count('aria2.forcePause')).toBe(1);
      expect(count('aria2.remove')).toBe(1);
      // the stop is over: another one finds nothing
      await engine.stop(job.id);
      expect(count('aria2.remove')).toBe(1);
    });

    it('a second stop shares a stop that fails, and the next stop tries again', async () => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      const release = rpc.hold('aria2.forcePause');
      rpc.transportDown = true;
      const first = track(engine.stop(job.id));
      const second = track(engine.stop(job.id));
      await flush();
      release();
      await Promise.all([first.settled, second.settled]);
      expect([first.error, second.error]).toEqual([STOP_FAILED, STOP_FAILED]);
      expect(count('aria2.forcePause')).toBe(1);
      expect(count('aria2.remove')).toBe(1);
      // not confirmed means not pending any more: a new stop is a new attempt
      rpc.transportDown = false;
      await engine.stop(job.id);
      expect(count('aria2.forcePause')).toBe(2);
      expect(count('aria2.remove')).toBe(2);
    });

    it.each(['aria2.addUri', 'aria2.forcePause', 'aria2.remove'])('keeps the job until its stop is confirmed (stop held at %s)', async (method) => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      let release: () => void;
      if (method === 'aria2.addUri') {
        release = rpc.hold(method);
        engine.start(job, ctx);
        await flush();
      } else {
        engine.start(job, ctx);
        await untilProgress();
        release = rpc.hold(method);
      }
      const pending = track(engine.stop(job.id));
      await flush();
      expect(pending.done).toBe(false);
      engine.start(job, ctx);
      await flush();
      expect(count('aria2.addUri')).toBe(1);
      release();
      await pending.settled;
      expect(pending.ok).toBe(true);
      // confirmed: the engine let the job go, a start is accepted again
      engine.start(job, ctx);
      await flush();
      expect(count('aria2.addUri')).toBe(2);
    });

    it.each(['aria2.forcePause', 'aria2.remove'])('a pending stop stops the polling (held at %s)', async (method) => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      const release = rpc.hold(method);
      const pending = track(engine.stop(job.id));
      await flush();
      const polls = tellCalls();
      const seen = events.length;
      await tick(10);
      expect(tellCalls()).toBe(polls);
      expect(events.length).toBe(seen);
      release();
      await pending.settled;
      expect(pending.ok).toBe(true);
    });

    it('a poll answer that arrives after the stop emits nothing', async () => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      const releasePoll = rpc.hold(TELL);
      engine.start(job, ctx);
      for (let i = 0; i < 3 && tellCalls() === 0; i += 1) await tick();
      expect(tellCalls()).toBe(1);
      const stop = track(engine.stop(job.id));
      await flush();
      releasePoll();
      await stop.settled;
      await tick(3);
      expect(stop.ok).toBe(true);
      expect(events).toEqual([]);
    });

    it.each([
      ['an unreachable service', () => (rpc.failAddUri = true)],
      ['an addUri answered with an error', () => rpc.refuse.add('aria2.addUri')],
    ])('stop before addUri answered: if addUri fails the entry is already released and stop resolves (%s)', async (_name, arrange) => {
      const release = rpc.hold('aria2.addUri');
      const job = fileJob();
      engine.start(job, ctx);
      const stop = track(engine.stop(job.id));
      arrange();
      await flush();
      expect(stop.done).toBe(false);
      release();
      await stop.settled;
      expect(stop.ok).toBe(true);
      expect(rpc.methods()).toEqual(['aria2.addUri']);
      expect(events).toEqual([]);
      // released: a new start is accepted
      rpc.failAddUri = false;
      rpc.refuse.clear();
      engine.start(job, ctx);
      await flush();
      expect(count('aria2.addUri')).toBe(2);
    });

    it('stop after the job ended makes no call, and the job can start again', async () => {
      rpc.script(complete(100));
      const job = fileJob();
      engine.start(job, ctx);
      await flush();
      expect(ended()).toMatchObject({ type: 'done' });
      const calls = rpc.calls.length;
      await engine.stop(job.id);
      expect(rpc.calls.length).toBe(calls);
      rpc.script(complete(100));
      engine.start(job, ctx);
      await flush();
      expect(count('aria2.addUri')).toBe(2);
    });

    it('stop fails and keeps ownership when aria2 does not answer', async () => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      const first = track(engine.stop(job.id));
      await flush();
      expect(first.done).toBe(true);
      expect(first.error).toBe(STOP_FAILED);
      // still ours: a start adds nothing, and the polling went on
      engine.start(job, ctx);
      await flush();
      expect(count('aria2.addUri')).toBe(1);
      await silentPolls(2); // polling restarted, one poll per tick (no second timer)
      expect(ended()).toBeUndefined();
      // the service answers again: progress arrives again, and a second stop works
      rpc.transportDown = false;
      const seen = events.length;
      await tick(2);
      expect(events.slice(seen).some((e) => e.type === 'progress' && e.speed === 5)).toBe(true);
      const second = track(engine.stop(job.id));
      await second.settled;
      expect(second.ok).toBe(true);
      expect(count('aria2.remove')).toBe(2);
      const after = events.length;
      const stillPolling = tellCalls();
      await tick(5);
      expect(events.length).toBe(after);
      expect(tellCalls()).toBe(stillPolling);
    });

    it('a stop that waited for addUri and then failed restarts the polling once', async () => {
      rpc.script(active(10, 100, 5));
      const releaseAdd = rpc.hold('aria2.addUri');
      const releasePause = rpc.hold('aria2.forcePause');
      const job = fileJob();
      engine.start(job, ctx);
      await flush();
      const stop = track(engine.stop(job.id));
      releaseAdd();
      await flush();
      expect(count('aria2.forcePause')).toBe(1); // addUri answered, the stop moved on
      rpc.transportDown = true;
      releasePause();
      await flush();
      expect(stop.error).toBe(STOP_FAILED);
      await silentPolls(3); // one poll per tick: exactly one timer runs
      rpc.transportDown = false;
      await tick(2);
      expect(progress().length).toBeGreaterThanOrEqual(1);
    });

    it.each([
      ['remove', ['aria2.remove']],
      ['pause and remove', ['aria2.forcePause', 'aria2.remove']],
    ])('stop is confirmed when aria2 answers remove with an error (refused: %s)', async (_name, refused) => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      for (const method of refused) rpc.refuse.add(method);
      await engine.stop(job.id);
      const seen = events.length;
      const polls = tellCalls();
      await tick(5);
      expect(events.length).toBe(seen);
      expect(tellCalls()).toBe(polls);
      // released: a start is accepted
      rpc.refuse.clear();
      engine.start(job, ctx);
      await flush();
      expect(count('aria2.addUri')).toBe(2);
    });

    it.each(['an error answer', 'no answer'])('the outcome of the pause is ignored (%s)', async (kind) => {
      let target: Aria2Rpc = rpc;
      if (kind === 'an error answer') rpc.refuse.add('aria2.forcePause');
      else target = silentOn(rpc, 'aria2.forcePause');
      engine = makeEngine({}, target);
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      await engine.stop(job.id);
      expect(count('aria2.remove')).toBe(1);
    });

    it('stop is confirmed when the daemon is dead', async () => {
      engine = makeEngine({ daemonAlive: () => false });
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      await engine.stop(job.id);
      const seen = events.length;
      const polls = tellCalls();
      await tick(5);
      expect(events.length).toBe(seen);
      expect(tellCalls()).toBe(polls);
    });

    it('stop is confirmed the moment the daemon is seen dead, not earlier', async () => {
      let alive = true;
      engine = makeEngine({ daemonAlive: () => alive });
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      const first = track(engine.stop(job.id));
      await flush();
      expect(first.error).toBe(STOP_FAILED);
      alive = false;
      const second = track(engine.stop(job.id));
      await second.settled;
      expect(second.ok).toBe(true);
      expect(errorsOf()).toEqual([]);
    });
  });

  describe('discard', () => {
    const files = () => [join(dir, 'x.zip'), join(dir, 'x.zip.aria2')];
    const writeBoth = () => {
      writeFileSync(join(dir, 'x.zip'), 'partial');
      writeFileSync(join(dir, 'x.zip.aria2'), 'control');
    };

    it('discard deletes nothing when the stop is not confirmed', async () => {
      writeBoth();
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      const out = track(engine.discard(job));
      await flush();
      expect(out.error).toBe(STOP_FAILED);
      for (const f of files()) expect(existsSync(f)).toBe(true);
      // once the service answers, the same discard works
      rpc.transportDown = false;
      await engine.discard(job);
      for (const f of files()) expect(existsSync(f)).toBe(false);
    });

    it('discard waits for a stop that is pending and deletes after it', async () => {
      writeBoth();
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      const release = rpc.hold('aria2.remove');
      const stop = track(engine.stop(job.id));
      const discard = track(engine.discard(job));
      await flush();
      expect(discard.done).toBe(false);
      for (const f of files()) expect(existsSync(f)).toBe(true);
      release();
      await Promise.all([stop.settled, discard.settled]);
      expect([stop.ok, discard.ok]).toEqual([true, true]);
      expect(count('aria2.remove')).toBe(1);
      for (const f of files()) expect(existsSync(f)).toBe(false);
    });

    it('discard deletes the files when aria2 answered remove with an error', async () => {
      writeBoth();
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.refuse.add('aria2.remove');
      await engine.discard(job);
      for (const f of files()) expect(existsSync(f)).toBe(false);
    });

    it('discard deletes the files when the daemon is dead', async () => {
      writeBoth();
      engine = makeEngine({ daemonAlive: () => false });
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      await engine.discard(job);
      for (const f of files()) expect(existsSync(f)).toBe(false);
    });
  });

  describe('poll', () => {
    it('a transport failure with a live daemon does not end the job', async () => {
      engine = makeEngine({ daemonAlive: () => true });
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      await silentPolls(10);
      expect(ended()).toBeUndefined();
      // aria2 is never ended by the app for this
      for (const method of ['aria2.shutdown', 'aria2.forcePause', 'aria2.remove']) expect(count(method)).toBe(0);
      rpc.transportDown = false;
      const seen = events.length;
      await tick(2);
      expect(events.slice(seen).filter((e) => e.type === 'progress' && e.speed === 5).length).toBeGreaterThanOrEqual(1);
      expect(ended()).toBeUndefined();
      expect(count('aria2.addUri')).toBe(1);
    });

    it('shows a stalled download as not moving after five silent polls', async () => {
      rpc.script(active(250, 1000, 250));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      const before = events.length;
      rpc.transportDown = true;
      // failures 1 to 4: nothing new
      for (let failure = 1; failure <= 4; failure += 1) {
        await silentPolls(1);
        expect(events.length).toBe(before);
      }
      // the 5th: one event, speed 0, no eta, the last counts it reported
      await silentPolls(1);
      expect(events.slice(before)).toEqual([stallEvent(job, 250, 1000)]);
      // failures 6 to 12: not a second one
      await silentPolls(7);
      expect(events.length).toBe(before + 1);
      expect(ended()).toBeUndefined();
    });

    it.each([
      ['the latest of several reports', [active(100, 1000, 50), active(300, 1000, 50)], 2, 300, 1000],
      ['a report without a total size', [active(250, 0, 100)], 1, 250, null],
    ])('a stall carries the last reported byte counts (%s)', async (_name, statuses, reports, done, total) => {
      rpc.script(...statuses);
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress(reports);
      const before = events.length;
      rpc.transportDown = true;
      await silentPolls(5);
      expect(events.slice(before)).toEqual([stallEvent(job, done, total)]);
    });

    it.each([
      ['counts of its own', { bytesDone: 40, bytesTotal: 100 }, 40, 100],
      ['no total of its own', { bytesDone: 0, bytesTotal: null }, 0, null],
    ])('a stall before any progress uses the job %s', async (_name, own, done, total) => {
      rpc.script(active(10, 100, 5));
      const release = rpc.hold(TELL);
      const job = fileJob(own);
      engine.start(job, ctx);
      await flush();
      for (let i = 0; i < 3 && tellCalls() === 0; i += 1) await tick();
      expect(tellCalls()).toBe(1);
      rpc.transportDown = true;
      release();
      await flush(); // the held poll is failure 1
      expect(events).toEqual([]);
      await silentPolls(3); // failures 2 to 4
      expect(events).toEqual([]);
      await silentPolls(1); // the 5th
      expect(events).toEqual([stallEvent(job, done, total)]);
    });

    it('reports a second stall after the service answered in between', async () => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      await silentPolls(5);
      expect(stalls()).toHaveLength(1);
      rpc.transportDown = false;
      await tick();
      expect(progress().at(-1)).toMatchObject({ speed: 5 });
      rpc.transportDown = true;
      await silentPolls(4);
      expect(stalls()).toHaveLength(1);
      await silentPolls(1);
      expect(stalls()).toHaveLength(2);
      expect(ended()).toBeUndefined();
    });

    it.each([
      ['an answer that reports progress', [active(10, 100, 5)]],
      ['an answer that reports nothing', [active(10, 100, 5), waiting()]],
    ])('an answer resets the count of silent polls (%s)', async (_name, statuses) => {
      rpc.script(...statuses);
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      await silentPolls(4);
      expect(stalls()).toHaveLength(0);
      rpc.transportDown = false;
      await tick(); // answered
      rpc.transportDown = true;
      await silentPolls(4); // 4 + 4 failures, but never 5 in a row
      expect(stalls()).toHaveLength(0);
      await silentPolls(1);
      expect(stalls()).toHaveLength(1);
    });

    it('gives up at once when the daemon is dead', async () => {
      engine = makeEngine({ daemonAlive: () => false });
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      await tick(); // the first failing poll
      expect(errorsOf()).toEqual([errorEvent(job, SERVICE_STOPPED)]);
      // released and quiet: no more polls, no stall, a start is accepted again
      const polls = tellCalls();
      const seen = events.length;
      await tick(8);
      expect(tellCalls()).toBe(polls);
      expect(events.length).toBe(seen);
      rpc.transportDown = false;
      engine.start(job, ctx);
      await flush();
      expect(count('aria2.addUri')).toBe(2);
    });

    it('gives up as soon as the daemon is seen dead, however few polls failed', async () => {
      let alive = true;
      engine = makeEngine({ daemonAlive: () => alive });
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      await silentPolls(2);
      expect(ended()).toBeUndefined();
      alive = false;
      await tick();
      expect(errorsOf()).toEqual([errorEvent(job, SERVICE_STOPPED)]);
      expect(stalls()).toHaveLength(0);
    });

    it.each([
      ['alive', () => true],
      ['dead', () => false],
    ])('gives up when aria2 no longer knows the download (daemon %s)', async (_name, daemonAlive) => {
      engine = makeEngine({ daemonAlive });
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.refuse.add(TELL);
      await tick();
      expect(errorsOf()).toEqual([errorEvent(job, 'download was removed')]);
      const polls = tellCalls();
      const seen = events.length;
      await tick(8);
      expect(tellCalls()).toBe(polls);
      expect(events.length).toBe(seen);
      // released: a start is accepted again
      rpc.refuse.clear();
      engine.start(job, ctx);
      await flush();
      expect(count('aria2.addUri')).toBe(2);
    });

    it('does not start a poll while one is waiting', async () => {
      rpc.script(active(10, 100, 5));
      const release = rpc.hold(TELL);
      const job = fileJob();
      engine.start(job, ctx);
      await flush();
      await tick(5);
      expect(tellCalls()).toBe(1);
      expect(events).toEqual([]);
      release();
      await flush();
      expect(progress()).toHaveLength(1);
      await tick(3);
      expect(tellCalls()).toBeGreaterThanOrEqual(4);
      expect(progress().length).toBeGreaterThanOrEqual(4);
    });

    it('a poll that failed does not block the next one', async () => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      rpc.transportDown = true;
      await silentPolls(2);
      rpc.transportDown = false;
      const seen = progress().length;
      await tick(2);
      expect(progress().length).toBeGreaterThanOrEqual(seen + 2);
    });
  });

  describe('setRateLimit', () => {
    const changes = () => rpc.calls.filter((c) => c.method === 'aria2.changeOption');

    it('changes the limit of a running download', async () => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      await engine.setRateLimit(job.id, 102400);
      expect(changes()).toEqual([{ method: 'aria2.changeOption', params: ['gid1', { 'max-download-limit': '102400' }] }]);
      await engine.setRateLimit(job.id, null);
      await engine.setRateLimit(job.id, 0);
      expect(changes().map((c) => c.params)).toEqual([
        ['gid1', { 'max-download-limit': '102400' }],
        ['gid1', { 'max-download-limit': '0' }],
        ['gid1', { 'max-download-limit': '0' }],
      ]);
    });

    it('makes no call for a job it does not track', async () => {
      await engine.setRateLimit('nobody', 1000);
      expect(rpc.calls).toEqual([]);
      // nor for one that was stopped
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      await engine.stop(job.id);
      await engine.setRateLimit(job.id, 1000);
      expect(changes()).toEqual([]);
    });

    it('waits for the answer of addUri to know the download', async () => {
      const release = rpc.hold('aria2.addUri');
      const job = fileJob();
      engine.start(job, ctx);
      const pending = track(engine.setRateLimit(job.id, 2048));
      await flush();
      expect(pending.done).toBe(false);
      expect(changes()).toEqual([]);
      release();
      await pending.settled;
      expect(pending.ok).toBe(true);
      expect(changes()).toEqual([{ method: 'aria2.changeOption', params: ['gid1', { 'max-download-limit': '2048' }] }]);
    });

    it('makes no call when addUri failed', async () => {
      rpc.failAddUri = true;
      const job = fileJob();
      engine.start(job, ctx);
      await engine.setRateLimit(job.id, 2048);
      expect(changes()).toEqual([]);
    });

    it.each([
      ['an error answer', () => rpc.refuse.add('aria2.changeOption')],
      ['no answer', () => (rpc.transportDown = true)],
    ])('answers false, never rejects, on a failure of the call (%s) (F3)', async (_name, arrange) => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      arrange();
      await expect(engine.setRateLimit(job.id, 2048)).resolves.toBe(false);
      expect(changes()).toHaveLength(1);
      expect(ended()).toBeUndefined();
    });

    it('answers true when aria2 answered the change (F3)', async () => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      await expect(engine.setRateLimit(job.id, 102400)).resolves.toBe(true);
      await expect(engine.setRateLimit(job.id, null)).resolves.toBe(true);
      expect(changes()).toHaveLength(2);
    });

    it('answers true once a held addUri gave the download its gid (F3)', async () => {
      const release = rpc.hold('aria2.addUri');
      const job = fileJob();
      engine.start(job, ctx);
      const answer = engine.setRateLimit(job.id, 2048);
      await flush();
      release();
      await expect(answer).resolves.toBe(true);
    });

    it('answers false for a job it does not track (F3)', async () => {
      await expect(engine.setRateLimit('nobody', 1000)).resolves.toBe(false);
      expect(rpc.calls).toEqual([]);
    });

    it('answers false for a job whose stop was confirmed (F3)', async () => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      await engine.stop(job.id);
      await expect(engine.setRateLimit(job.id, 1000)).resolves.toBe(false);
      expect(changes()).toEqual([]);
    });

    it('answers false when addUri failed, so the download has no gid (F3)', async () => {
      rpc.failAddUri = true;
      const job = fileJob();
      engine.start(job, ctx);
      await expect(engine.setRateLimit(job.id, 2048)).resolves.toBe(false);
      expect(changes()).toEqual([]);
    });

    it('answers false when the download was released while addUri was pending (F3)', async () => {
      const release = rpc.hold('aria2.addUri');
      const job = fileJob();
      engine.start(job, ctx);
      const answer = engine.setRateLimit(job.id, 2048);
      await flush();
      const b = new FakeAria2();
      engine.attach(daemonOn(b));
      release();
      await expect(answer).resolves.toBe(false);
      expect(changes()).toEqual([]);
      expect(b.methods()).not.toContain('aria2.changeOption');
    });
  });

  describe('attach', () => {
    let b: FakeAria2;
    beforeEach(() => {
      b = new FakeAria2();
    });

    it('attach hands the downloads of the old service back and uses the new one', async () => {
      rpc.script(active(10, 100, 5));
      b.script(active(20, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      const onA = rpc.calls.length;
      engine.attach(daemonOn(b));
      await flush();
      expect(events.filter((e) => e.type !== 'progress')).toEqual([errorEvent(job, SERVICE_STOPPED)]);
      // nothing is polled, stopped or re-added on either service
      await tick(5);
      expect(rpc.calls.length).toBe(onA);
      expect(b.calls).toEqual([]);
      // the queue's retry starts the job again: it reaches the new service only
      engine.start(job, ctx);
      await flush();
      expect(b.calls[0]).toEqual({
        method: 'aria2.addUri',
        params: [['https://example.com/x.zip'], { dir, out: 'x.zip', 'max-download-limit': '0' }],
      });
      await tick(2);
      expect(events.some((e) => e.type === 'progress' && e.bytesDone === 20)).toBe(true);
      expect(rpc.calls.length).toBe(onA);
    });

    it('attach ends every download of the old service', async () => {
      const one = fileJob({ fileName: 'one.zip', url: 'https://example.com/one.zip' });
      const two = fileJob({ fileName: 'two.zip', url: 'https://example.com/two.zip' });
      engine.start(one, ctx);
      engine.start(two, ctx);
      await untilProgress(2);
      engine.attach(daemonOn(b));
      await flush();
      expect(errorsOf()).toHaveLength(2);
      expect(errorsOf()).toEqual(expect.arrayContaining([errorEvent(one, SERVICE_STOPPED), errorEvent(two, SERVICE_STOPPED)]));
      expect(b.calls).toEqual([]);
    });

    it('attach ends a download whose addUri is still waiting, and its late answer does nothing', async () => {
      const release = rpc.hold('aria2.addUri');
      const job = fileJob();
      engine.start(job, ctx);
      await flush();
      engine.attach(daemonOn(b));
      await flush();
      expect(events).toEqual([errorEvent(job, SERVICE_STOPPED)]);
      release();
      await flush();
      await tick(5);
      expect(events).toHaveLength(1);
      expect(tellCalls()).toBe(0);
      expect(b.calls).toEqual([]);
    });

    it('attach ends a download whose addUri then fails without a second event', async () => {
      const release = rpc.hold('aria2.addUri');
      const job = fileJob();
      engine.start(job, ctx);
      await flush();
      engine.attach(daemonOn(b));
      rpc.failAddUri = true;
      release();
      await flush();
      await tick(2);
      expect(events).toEqual([errorEvent(job, SERVICE_STOPPED)]);
    });

    it.each(['aria2.forcePause', 'aria2.remove'])('attach confirms a stop that was pending on the old service (held at %s)', async (method) => {
      rpc.script(active(10, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      const release = rpc.hold(method);
      const stop = track(engine.stop(job.id));
      await flush();
      expect(stop.done).toBe(false);
      const seen = events.length;
      engine.attach(daemonOn(b));
      await flush();
      expect(stop.ok).toBe(true);
      expect(events.length).toBe(seen);
      // the old service answering late changes nothing and never reaches the new one
      release();
      await flush();
      await tick(3);
      expect(events.length).toBe(seen);
      expect(b.calls).toEqual([]);
    });

    it('a late answer of the old stop does not touch the job started again', async () => {
      rpc.script(active(10, 100, 5));
      b.script(active(20, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      const release = rpc.hold('aria2.remove');
      const oldStop = track(engine.stop(job.id));
      await flush();
      engine.attach(daemonOn(b));
      await flush();
      expect(oldStop.ok).toBe(true);
      engine.start(job, ctx);
      await flush();
      expect(count('aria2.addUri', b)).toBe(1);
      release();
      await flush();
      // still ours and still polled
      const seen = progress().length;
      await tick(3);
      expect(progress().length).toBeGreaterThan(seen);
      const stop = track(engine.stop(job.id));
      await stop.settled;
      expect(stop.ok).toBe(true);
      expect(count('aria2.forcePause', b)).toBe(1);
      expect(count('aria2.remove', b)).toBe(1);
    });

    it('after attach a stop and a rate limit go to the new service', async () => {
      rpc.script(active(10, 100, 5));
      b.script(active(20, 100, 5));
      const job = fileJob();
      engine.start(job, ctx);
      await untilProgress();
      engine.attach(daemonOn(b));
      await flush();
      const onA = rpc.calls.length;
      engine.start(job, ctx);
      await flush();
      await tick(2);
      await engine.setRateLimit(job.id, 4096);
      await engine.stop(job.id);
      expect(b.methods().filter((m) => m !== TELL)).toEqual(['aria2.addUri', 'aria2.changeOption', 'aria2.forcePause', 'aria2.remove']);
      expect(b.calls.find((c) => c.method === 'aria2.changeOption')?.params).toEqual(['gid1', { 'max-download-limit': '4096' }]);
      expect(rpc.calls.length).toBe(onA);
    });

    it('after attach the new daemon decides whether the service is alive', async () => {
      b.script(active(20, 100, 5));
      engine.attach(daemonOn(b, () => false)); // the engine itself was built with the default, alive
      const job = fileJob();
      engine.start(job, ctx);
      await flush();
      for (let i = 0; i < 6 && progress().length === 0; i += 1) await tick();
      expect(progress().length).toBeGreaterThanOrEqual(1);
      b.transportDown = true;
      await tick();
      expect(errorsOf()).toEqual([errorEvent(job, SERVICE_STOPPED)]);
    });

    it('after attach the old verdict of daemonAlive no longer counts', async () => {
      engine = makeEngine({ daemonAlive: () => false });
      b.script(active(20, 100, 5));
      engine.attach(daemonOn(b, () => true));
      const job = fileJob();
      engine.start(job, ctx);
      await flush();
      for (let i = 0; i < 6 && progress().length === 0; i += 1) await tick();
      b.transportDown = true;
      for (let i = 0; i < 10; i += 1) await tick();
      expect(ended()).toBeUndefined();
    });

    it('asks the new daemon again at every failure', async () => {
      let up = true;
      b.script(active(20, 100, 5));
      engine.attach(daemonOn(b, () => up));
      const job = fileJob();
      engine.start(job, ctx);
      await flush();
      for (let i = 0; i < 6 && progress().length === 0; i += 1) await tick();
      b.transportDown = true;
      await tick(3);
      expect(ended()).toBeUndefined();
      up = false;
      await tick();
      expect(errorsOf()).toEqual([errorEvent(job, SERVICE_STOPPED)]);
    });
  });
});

describe('createRpcClient', () => {
  let server: Server;
  let received: { method: string; params: unknown[] }[];
  let requests: { verb: string | undefined; url: string | undefined; type: string | undefined }[];
  let reply: (body: { id: string }) => object;
  let status: number;
  let raw: string | null;
  let stall: boolean;

  beforeEach(async () => {
    received = [];
    requests = [];
    status = 200;
    raw = null;
    stall = false;
    reply = (body) => ({ jsonrpc: '2.0', id: body.id, result: 'pong' });
    server = createServer((req, res) => {
      let data = '';
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => {
        const body = JSON.parse(data) as { id: string; method: string; params: unknown[] };
        received.push({ method: body.method, params: body.params });
        requests.push({ verb: req.method, url: req.url, type: req.headers['content-type'] });
        if (stall) {
          // the answer starts and never ends
          res.writeHead(200, { 'content-type': 'application/json' });
          res.write('{"jsonrpc":"2.0","id":"1",');
          return;
        }
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(raw ?? JSON.stringify(reply(body)));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    server.closeAllConnections();
    server.close();
  });

  const port = () => (server.address() as AddressInfo).port;
  const settle = (p: Promise<unknown>): Promise<unknown> => p.then((v) => v, (e: unknown) => e);

  it('sends the secret as the first parameter and returns the result', async () => {
    const client = createRpcClient(port(), 's3cret');
    expect(await client.call('aria2.getVersion', ['a', 1])).toBe('pong');
    expect(received).toEqual([{ method: 'aria2.getVersion', params: ['token:s3cret', 'a', 1] }]);
    expect(requests).toEqual([{ verb: 'POST', url: '/jsonrpc', type: 'application/json' }]);
  });

  it.each([null, 0, '', false])('returns a result that is falsy (%j)', async (result) => {
    reply = (body) => ({ jsonrpc: '2.0', id: body.id, result });
    expect(await createRpcClient(port(), 's').call('aria2.getVersion', [])).toBe(result);
  });

  it.each([200, 400, 401, 500])('rejects with Aria2RpcError for an error answer (HTTP %d)', async (code) => {
    status = code;
    reply = (body) => ({ jsonrpc: '2.0', id: body.id, error: { code: 1, message: 'Unauthorized' } });
    const err = await settle(createRpcClient(port(), 'bad').call('aria2.getVersion', []));
    expect(err).toBeInstanceOf(Aria2RpcError);
    expect(err).not.toBeInstanceOf(Aria2TransportError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ message: 'Unauthorized', code: 1 });
  });

  it('gives an Aria2RpcError without a code the code null', async () => {
    reply = (body) => ({ jsonrpc: '2.0', id: body.id, error: { message: 'No such thing' } });
    const err = await settle(createRpcClient(port(), 's').call('aria2.remove', ['x']));
    expect(err).toBeInstanceOf(Aria2RpcError);
    expect(err).toMatchObject({ message: 'No such thing', code: null });
  });

  it('rejects with Aria2TransportError when nothing listens', async () => {
    const closed = createTcpServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const dead = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const err = await settle(createRpcClient(dead, 's').call('aria2.getVersion', []));
    expect(err).toBeInstanceOf(Aria2TransportError);
    expect(err).not.toBeInstanceOf(Aria2RpcError);
    expect(err).toBeInstanceOf(Error);
  });

  it.each([
    ['an empty body', ''],
    ['text', 'Bad Gateway'],
    ['html', '<html><body>nope</body></html>'],
    ['null', 'null'],
    ['a number', '42'],
    ['an object that is not JSON-RPC', '{"foo":"bar"}'],
    ['an answer with neither result nor error', '{"jsonrpc":"2.0","id":"1"}'],
  ])('rejects with Aria2TransportError for an answer that is not JSON-RPC (%s)', async (_name, body) => {
    raw = body;
    const err = await settle(createRpcClient(port(), 's').call('aria2.getVersion', []));
    expect(err).toBeInstanceOf(Aria2TransportError);
    expect(err).not.toBeInstanceOf(Aria2RpcError);
  });

  it('rejects with Aria2TransportError for an HTTP error without a JSON-RPC body', async () => {
    status = 400;
    raw = 'Bad Request';
    const err = await settle(createRpcClient(port(), 's').call('aria2.getVersion', []));
    expect(err).toBeInstanceOf(Aria2TransportError);
  });

  it.each([
    ['a failed connection', new TypeError('fetch failed')],
    ['an abort', new DOMException('The operation was aborted', 'AbortError')],
    ['an expired time limit', new DOMException('The operation timed out', 'TimeoutError')],
  ])('rejects with Aria2TransportError when fetch fails (%s)', async (_name, failure) => {
    const err = await settle(createRpcClient(1, 's', () => Promise.reject(failure)).call('aria2.getVersion', []));
    expect(err).toBeInstanceOf(Aria2TransportError);
    expect(err).not.toBeInstanceOf(Aria2RpcError);
  });

  it('rejects with Aria2TransportError when the server never answers', async () => {
    const sockets: Socket[] = [];
    const silent: TcpServer = createTcpServer((s) => {
      sockets.push(s);
      s.on('error', () => undefined);
    });
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    try {
      const silentPort = (silent.address() as AddressInfo).port;
      const started = performance.now();
      const err = await Promise.race([settle(createRpcClient(silentPort, 's', fetch, 300).call('aria2.getVersion', [])), sleep(2000).then(() => 'still waiting')]);
      const took = performance.now() - started;
      expect(err).toBeInstanceOf(Aria2TransportError);
      expect(took).toBeGreaterThanOrEqual(250);
      expect(took).toBeLessThan(2000);
    } finally {
      for (const s of sockets) s.destroy();
      silent.close();
    }
  });

  it('rejects with Aria2TransportError when the body of the answer never ends', async () => {
    stall = true;
    const err = await Promise.race([
      settle(createRpcClient(port(), 's', fetch, 300).call('aria2.getVersion', [])),
      sleep(2000).then(() => 'still waiting'),
    ]);
    expect(err).toBeInstanceOf(Aria2TransportError);
  });

  it('gives every call its own time limit of 5 s unless told otherwise', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const answer: typeof fetch = async (_url, init) => {
      seen.push(init?.signal);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'OK' }), { status: 200 });
    };
    const limit = vi.spyOn(AbortSignal, 'timeout');
    const client = createRpcClient(1, 's', answer);
    expect(limit).not.toHaveBeenCalled();
    await client.call('aria2.getVersion', []);
    await client.call('aria2.getVersion', []);
    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenNthCalledWith(1, 5000);
    expect(limit).toHaveBeenNthCalledWith(2, 5000);
    expect(seen[0]).toBe(limit.mock.results[0]?.value);
    expect(seen[1]).toBe(limit.mock.results[1]?.value);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('passes the time limit it is given to every call', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const answer: typeof fetch = async (_url, init) => {
      seen.push(init?.signal);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'OK' }), { status: 200 });
    };
    const limit = vi.spyOn(AbortSignal, 'timeout');
    const client = createRpcClient(1, 's', answer, 1234);
    await client.call('aria2.getVersion', []);
    await client.call('aria2.getVersion', []);
    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenNthCalledWith(1, 1234);
    expect(limit).toHaveBeenNthCalledWith(2, 1234);
    expect(seen[0]).toBe(limit.mock.results[0]?.value);
  });
});

describe('daemonHandle', () => {
  let child: ChildProcess;
  let fake: FakeAria2;

  beforeEach(() => {
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    fake = new FakeAria2();
  });

  afterEach(() => {
    child.kill();
  });

  it('is alive until the process ends, then tells its listeners once', async () => {
    const daemon = daemonHandle(child, fake);
    expect(daemon.rpc).toBe(fake);
    expect(daemon.alive()).toBe(true);
    const told: boolean[] = [];
    const toldToo: boolean[] = [];
    daemon.onExit(() => told.push(daemon.alive()));
    daemon.onExit(() => toldToo.push(daemon.alive()));
    expect(told).toEqual([]);
    child.kill();
    await waitFor(() => told.length > 0 && toldToo.length > 0);
    expect(daemon.alive()).toBe(false);
    await sleep(150);
    // once each, and alive() was already false when they ran
    expect(told).toEqual([false]);
    expect(toldToo).toEqual([false]);
  });

  it('does not call a listener that is added after the exit', async () => {
    const daemon = daemonHandle(child, fake);
    child.kill();
    await waitFor(() => !daemon.alive());
    let called = 0;
    daemon.onExit(() => (called += 1));
    await sleep(150);
    expect(called).toBe(0);
    expect(daemon.alive()).toBe(false);
  });

  it('an asked-for stop does not count as an unexpected exit', async () => {
    const daemon = daemonHandle(child, fake);
    let called = 0;
    daemon.onExit(() => (called += 1));
    await daemon.stop();
    await waitFor(() => !daemon.alive());
    await sleep(150);
    expect(called).toBe(0);
    expect(fake.calls).toEqual([{ method: 'aria2.shutdown', params: [] }]);
  });

  it.each([
    ['no answer', () => (fake.transportDown = true)],
    ['an error answer', () => fake.refuse.add('aria2.shutdown')],
  ])('stop still ends the process when shutdown fails (%s)', async (_name, arrange) => {
    arrange();
    const daemon = daemonHandle(child, fake);
    let called = 0;
    daemon.onExit(() => (called += 1));
    await daemon.stop();
    await waitFor(() => !daemon.alive());
    await sleep(150);
    expect(called).toBe(0);
  });

  it('an exit caused by the shutdown call itself is an asked-for one', async () => {
    // aria2 ends on its own while it answers shutdown: the stop must already be marked as asked for
    const exitsDuringCall = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const rpcThatEndsTheProcess: Aria2Rpc = {
      async call(method) {
        if (method === 'aria2.shutdown') {
          child.kill();
          await exitsDuringCall;
          await sleep(20);
        }
        return 'OK';
      },
    };
    const daemon = daemonHandle(child, rpcThatEndsTheProcess);
    let called = 0;
    daemon.onExit(() => (called += 1));
    await daemon.stop();
    await sleep(150);
    expect(daemon.alive()).toBe(false);
    expect(called).toBe(0);
  });
});

describe('FakeAria2 (test support)', () => {
  it('transportDown makes every method throw Aria2TransportError', async () => {
    const fake = new FakeAria2();
    fake.transportDown = true;
    for (const method of ['aria2.addUri', 'aria2.tellStatus', 'aria2.forcePause', 'aria2.remove', 'aria2.changeOption', 'aria2.shutdown']) {
      await expect(fake.call(method, [])).rejects.toBeInstanceOf(Aria2TransportError);
    }
    fake.transportDown = false;
    await expect(fake.call('aria2.shutdown', [])).resolves.toBe('OK');
  });

  it('refuse makes only the listed methods throw Aria2RpcError', async () => {
    const fake = new FakeAria2();
    fake.refuse.add('aria2.remove');
    const err = await fake.call('aria2.remove', ['gid1']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Aria2RpcError);
    expect(err).toMatchObject({ message: refusalMessage('aria2.remove') });
    await expect(fake.call('aria2.forcePause', ['gid1'])).resolves.toBe('OK');
  });

  it('an unknown gid on tellStatus throws Aria2RpcError', async () => {
    const fake = new FakeAria2();
    await expect(fake.call(TELL, ['nope', []])).rejects.toBeInstanceOf(Aria2RpcError);
  });

  it('failAddUri throws Aria2TransportError', async () => {
    const fake = new FakeAria2();
    fake.failAddUri = true;
    await expect(fake.call('aria2.addUri', [['https://example.com/x'], {}])).rejects.toBeInstanceOf(Aria2TransportError);
  });

  it('hold keeps the calls of that method waiting until it is released', async () => {
    const fake = new FakeAria2();
    const release = fake.hold('aria2.getVersion');
    let answered = false;
    const held = fake.call('aria2.getVersion', []).then(() => {
      answered = true;
    });
    await sleep(20);
    expect(fake.calls).toHaveLength(1);
    expect(answered).toBe(false);
    await expect(fake.call('aria2.getGlobalStat', [])).resolves.toBe('OK');
    release();
    await held;
    expect(answered).toBe(true);
    await expect(fake.call('aria2.getVersion', [])).resolves.toBe('OK');
  });

  it('decides the outcome of a held call when it is released', async () => {
    const fake = new FakeAria2();
    const release = fake.hold('aria2.remove');
    const held = fake.call('aria2.remove', ['gid1']).catch((e: unknown) => e);
    fake.transportDown = true;
    release();
    expect(await held).toBeInstanceOf(Aria2TransportError);
  });
});

describe('aria2 daemon command line', () => {
  const args = aria2DaemonArgs(6800, 'abc');

  it.each([
    '--follow-torrent=false',
    '--follow-metalink=false',
    '--enable-dht=false',
    '--enable-dht6=false',
    '--bt-enable-lpd=false',
    '--enable-peer-exchange=false',
    '--seed-time=0',
  ])('does plain HTTP only: %s', (flag) => {
    expect(args).toContain(flag);
  });

  it('never turns torrent, metalink or peer-to-peer back on', () => {
    expect(args.filter((a) => /^--(follow-torrent|follow-metalink|enable-dht6?|bt-enable-lpd|enable-peer-exchange)=(?!false$)/u.test(a))).toEqual([]);
  });

  // F4: aria2 saves the .aria2 control file only every --auto-save-interval seconds (default 60)
  // and when it stops; an aria2 that is ended loses everything since the last save, so a
  // restarted aria2 starts the file again from the last save (from 0 within the first minute).
  it('saves the control file every second, so a download continues after aria2 is ended', () => {
    expect(args).toContain('--auto-save-interval=1');
    expect(args).toContain('--continue=true');
    expect(args.filter((a) => a.startsWith('--auto-save-interval='))).toHaveLength(1);
    expect(args.some((a) => /^--remove-control-file(=true)?$/u.test(a))).toBe(false);
  });

  it('keeps RPC on this machine with the per-run secret', () => {
    expect(args).toEqual(expect.arrayContaining(['--enable-rpc', '--rpc-listen-all=false', '--rpc-listen-port=6800', '--rpc-secret=abc']));
  });
});

// A3 Task T2 (plan 3.3, section 6): the aria2 `addUri` options. `referer` and `user-agent` are the only header keys
// and each exists exactly when its value is non-null and valid; the key `header` never exists; `cookies` is never read.
describe('FileEngine headers (A3)', () => {
  const REFERER = 'https://a.example/watch';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  /** PA3-6: every character a shell could treat as special, accepted and passed byte for byte. */
  const PA3_6 = 'Mozilla/5.0 "q" \\ %PATH% ^ & | < > ` $(x) ; --output=evil -o x';
  /** The only keys an addUri of A3 may hold: the three of today and the two header options. */
  const ALLOWED_KEYS = ['dir', 'max-download-limit', 'out', 'referer', 'user-agent'];
  const extrasOf = (referer: unknown, userAgent: unknown): RunExtras => ({ referer, userAgent, cookies: null }) as unknown as RunExtras;
  const withExtras = (extras: RunExtras | null): StartContext => ({ ...ctx, extras });

  /** The options object of the addUri call number `n` (the first by default). */
  function addUriOptions(n = 0): Record<string, unknown> {
    const calls = rpc.calls.filter((c) => c.method === 'aria2.addUri');
    const params = calls[n]?.params;
    if (!params) throw new Error(`no addUri call number ${n}`);
    return params[1] as Record<string, unknown>;
  }
  /** Every key of every object anywhere inside `value`. */
  function keysDeep(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(keysDeep);
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)]);
    }
    return [];
  }
  async function addWith(extras: RunExtras | null, over: Partial<Job> = {}): Promise<Record<string, unknown>> {
    rpc.script(complete(100));
    const before = events.length;
    engine.start(fileJob(over), withExtras(extras));
    await waitFor(() => events.slice(before).some((e) => e.type === 'done' || e.type === 'error'));
    return addUriOptions(rpc.calls.filter((c) => c.method === 'aria2.addUri').length - 1);
  }

  it('holds referer and user-agent exactly, beside the options of today, when both are set', async () => {
    const options = await addWith(extrasOf(REFERER, UA));
    expect(options).toEqual({ dir, out: 'x.zip', 'max-download-limit': '0', referer: REFERER, 'user-agent': UA });
    expect(Object.keys(options).sort()).toEqual(ALLOWED_KEYS);
  });

  it('holds only the key of the header that is non-null: no key at all for a null one', async () => {
    const referer = await addWith(extrasOf(REFERER, null));
    expect(Object.keys(referer).sort()).toEqual(['dir', 'max-download-limit', 'out', 'referer']);
    expect(referer['referer']).toBe(REFERER);
    const ua = await addWith(extrasOf(null, UA));
    expect(Object.keys(ua).sort()).toEqual(['dir', 'max-download-limit', 'out', 'user-agent']);
    expect(ua['user-agent']).toBe(UA);
  });

  it('adds no key for null values (a key holding null, undefined or an empty string is a key)', async () => {
    const options = await addWith(extrasOf(null, null));
    expect(Object.keys(options).sort()).toEqual(['dir', 'max-download-limit', 'out']);
    expect('referer' in options).toBe(false);
    expect('user-agent' in options).toBe(false);
  });

  it('gives the same options for extras null and for extras with two null values', async () => {
    const none = await addWith(null);
    const allNull = await addWith(extrasOf(null, null));
    expect(allNull).toStrictEqual(none);
    expect(none).toStrictEqual({ dir, out: 'x.zip', 'max-download-limit': '0' });
  });

  it('never has the key header, whatever the extras are, and no other key outside the five', async () => {
    const combos = [null, extrasOf(null, null), extrasOf(REFERER, null), extrasOf(null, UA), extrasOf(REFERER, UA), extrasOf(REFERER, PA3_6)];
    for (const extras of combos) {
      const options = await addWith(extras);
      expect('header' in options).toBe(false);
      expect('headers' in options).toBe(false);
      for (const key of Object.keys(options)) expect(ALLOWED_KEYS).toContain(key);
    }
    // And in no call to aria2 at all.
    expect(keysDeep(rpc.calls.map((c) => c.params)).filter((k) => /^headers?$/iu.test(k))).toEqual([]);
  });

  it("passes PA3-6's User-Agent whole, as the value of user-agent, and as nothing else", async () => {
    const options = await addWith(extrasOf(null, PA3_6));
    expect(options['user-agent']).toBe(PA3_6);
    expect(Object.keys(options).sort()).toEqual(['dir', 'max-download-limit', 'out', 'user-agent']);
    expect(Object.values(options).filter((v) => typeof v === 'string' && v.includes('--output=evil'))).toEqual([PA3_6]);
  });

  it.each([
    ['CR', 'https://a.example/p\rq'],
    ['LF', 'https://a.example/p\nq'],
    ['CR LF and a second header', 'https://a.example/p\r\nX-Evil: 1'],
    ['NUL', 'https://a.example/p\u0000q'],
    ['a tab', 'https://a.example/p\tq'],
    ['a query', 'https://a.example/p?token=1'],
    ['a double quote', 'https://a.example/p"q'],
    ['2049 units', `https://a.example/${'a'.repeat(2049 - 'https://a.example/'.length)}`],
    ['a number', 5],
    ['an object', { toString: () => 'https://a.example/' }],
    ['an array', ['https://a.example/']],
  ])('adds no key for a Referer that is %s, and no value holds it', async (_name, bad) => {
    const options = await addWith(extrasOf(bad, null));
    expect('referer' in options).toBe(false);
    expect(Object.keys(options).sort()).toEqual(['dir', 'max-download-limit', 'out']);
    for (const v of Object.values(options)) expect(typeof v === 'string' && typeof bad === 'string' && v.includes(bad)).toBe(false);
  });

  it.each([
    ['CR', 'Mozilla\r5.0'],
    ['LF', 'Mozilla\n5.0'],
    ['CR LF and a second header', 'Mozilla\r\nX-Evil: 1'],
    ['NUL', 'Mozilla\u00005.0'],
    ['a tab', 'Mozilla\t5.0'],
    ['513 characters', 'a'.repeat(513)],
    ['a non-ASCII letter', 'Mozilla é'],
    ['a number', 7],
    ['an object', { toString: () => 'Mozilla' }],
  ])('adds no key for a User-Agent that is %s, and no value holds it', async (_name, bad) => {
    const options = await addWith(extrasOf(null, bad));
    expect('user-agent' in options).toBe(false);
    expect(Object.keys(options).sort()).toEqual(['dir', 'max-download-limit', 'out']);
    for (const v of Object.values(options)) expect(typeof v === 'string' && typeof bad === 'string' && v.includes(bad)).toBe(false);
  });

  it('still sends the header that is valid when the other is refused', async () => {
    const a = await addWith(extrasOf('https://a.example/p?token=1', UA));
    expect(a['user-agent']).toBe(UA);
    expect('referer' in a).toBe(false);
    const b = await addWith(extrasOf(REFERER, 'x\r\ny'));
    expect(b['referer']).toBe(REFERER);
    expect('user-agent' in b).toBe(false);
  });

  it('sends a User-Agent of 512 characters and a Referer of 2048 units, the longest accepted', async () => {
    const longReferer = `https://a.example/${'a'.repeat(2048 - 'https://a.example/'.length)}`;
    const options = await addWith(extrasOf(longReferer, 'a'.repeat(512)));
    expect(options['referer']).toBe(longReferer);
    expect(options['user-agent']).toBe('a'.repeat(512));
  });

  it('never reads cookies: a source that throws when touched changes nothing, and no cookie key exists', async () => {
    const touched = new Proxy(
      {},
      {
        get: () => {
          throw new Error('cookies was read');
        },
        has: () => {
          throw new Error('cookies was read');
        },
        ownKeys: () => {
          throw new Error('cookies was read');
        },
        getOwnPropertyDescriptor: () => {
          throw new Error('cookies was read');
        },
      },
    );
    const plain = await addWith(extrasOf(REFERER, UA));
    const options = await addWith({ referer: REFERER, userAgent: UA, cookies: touched } as unknown as RunExtras);
    expect(options).toStrictEqual(plain);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    for (const key of keysDeep(rpc.calls.map((c) => c.params))) expect(/cookie/iu.test(key)).toBe(false);
  });

  it('gives each start the headers of its own context: none leaks to a later start, a restart gets what it is given', async () => {
    const first = await addWith(extrasOf(REFERER, UA));
    expect(first['referer']).toBe(REFERER);
    const second = await addWith(extrasOf(null, null), { id: 'job-second', fileName: 'y.zip' });
    expect('referer' in second).toBe(false);
    expect('user-agent' in second).toBe(false);

    // The same job stopped and started again with other headers.
    const job = fileJob({ id: 'job-again', fileName: 'z.zip' });
    rpc.script(active(10, 100, 5));
    engine.start(job, withExtras(extrasOf(REFERER, null)));
    await waitFor(() => rpc.calls.filter((c) => c.method === 'aria2.addUri').length === 3);
    await engine.stop(job.id);
    rpc.script(complete(100));
    engine.start(job, withExtras(extrasOf(null, UA)));
    await waitFor(() => rpc.calls.filter((c) => c.method === 'aria2.addUri').length === 4);
    expect(Object.keys(addUriOptions(2)).sort()).toEqual(['dir', 'max-download-limit', 'out', 'referer']);
    expect(Object.keys(addUriOptions(3)).sort()).toEqual(['dir', 'max-download-limit', 'out', 'user-agent']);
  });

  it('keeps the other options of the call (dir, out, the limit) when headers are given', async () => {
    rpc.script(complete(100));
    engine.start(fileJob(), { ...withExtras(extrasOf(REFERER, UA)), rateLimitBytes: 307200 });
    await waitFor(ended);
    expect(addUriOptions()).toEqual({ dir, out: 'x.zip', 'max-download-limit': '307200', referer: REFERER, 'user-agent': UA });
  });

  it('sends the link alone in the first parameter and no header anywhere but the options', async () => {
    await addWith(extrasOf(REFERER, UA));
    const params = rpc.calls[0]?.params ?? [];
    expect(params).toHaveLength(2);
    expect(params[0]).toEqual(['https://example.com/x.zip']);
  });

  it('a speed change after a start sends the limit only, no header, whatever the start carried', async () => {
    rpc.script(active(10, 100, 5));
    const job = fileJob();
    engine.start(job, withExtras(extrasOf(REFERER, UA)));
    await waitFor(() => rpc.calls.some((c) => c.method === 'aria2.addUri'));
    expect(await engine.setRateLimit(job.id, 1024)).toBe(true);
    const change = rpc.calls.find((c) => c.method === 'aria2.changeOption');
    expect(change?.params[1]).toEqual({ 'max-download-limit': '1024' });
    await engine.stop(job.id);
  });
});
