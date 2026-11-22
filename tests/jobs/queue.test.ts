import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Engine, EngineEvent, EngineListener, StartContext } from '../../src/main/engines/engine';
import { Queue, RETRY_DELAYS_MS } from '../../src/main/jobs/queue';
import type { Store } from '../../src/main/jobs/store';
import type { AddRequest, Job, PlaylistEntry, Settings, Snapshot } from '../../src/shared/types';
import { makeSettings } from '../helpers';

class FakeEngine implements Engine {
  started: { job: Job; ctx: StartContext }[] = [];
  stopped: string[] = [];
  discarded: string[] = [];
  limits: number[] = [];
  private listener: EngineListener = () => undefined;
  on(l: EngineListener): void {
    this.listener = l;
  }
  start(job: Job, ctx: StartContext): void {
    this.started.push({ job, ctx });
  }
  async stop(jobId: string): Promise<void> {
    this.stopped.push(jobId);
  }
  async discard(job: Job): Promise<void> {
    this.discarded.push(job.id);
  }
  async setGlobalLimit(n: number): Promise<void> {
    this.limits.push(n);
  }
  emit(ev: EngineEvent): void {
    this.listener(ev);
  }
}

interface Timer {
  fn: () => void;
  ms: number;
}

let dir: string;
let media: FakeEngine;
let file: FakeEngine;
let saves: Snapshot[];
let timers: Timer[];
let clock: number;
let finished: { kind: 'job' | 'group'; title: string; failed: number; skipped: number }[];
let changes: number;

function build(settings: Partial<Settings> = {}, initial: Snapshot = { jobs: [], groups: [] }): Queue {
  const store = { saveSnapshot: (s: Snapshot) => saves.push(structuredClone(s)) } as unknown as Store;
  const queue = new Queue({
    store,
    media,
    file,
    initial,
    settings: makeSettings(settings),
    now: () => clock,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
  });
  queue.onFinished((e) => finished.push(e));
  queue.onChanged(() => (changes += 1));
  return queue;
}

/** Runs and clears the pending timers with this delay. */
function fire(ms: number): void {
  const due = timers.filter((t) => t.ms === ms);
  timers = timers.filter((t) => t.ms !== ms);
  for (const t of due) t.fn();
}

const video = (title = 'Talk', url = 'https://example.com/v'): AddRequest => ({
  url,
  probe: { kind: 'media', title, thumbnail: null, heights: [1080] },
  quality: { kind: 'max', height: 720 },
  subtitleLangs: [],
  dir,
  selectedIndexes: null,
});

const entries = (n: number, unavailable: number[] = []): PlaylistEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    url: `https://example.com/v/${i + 1}`,
    title: `Part ${i + 1}`,
    unavailable: unavailable.includes(i + 1),
    reason: unavailable.includes(i + 1) ? ('unavailable' as const) : null,
  }));

const playlist = (n: number, opts: { unavailable?: number[]; selected?: number[] | null; title?: string } = {}): AddRequest => ({
  url: 'https://example.com/list',
  probe: { kind: 'playlist', title: opts.title ?? 'React: Course?', entries: entries(n, opts.unavailable) },
  quality: { kind: 'best' },
  subtitleLangs: ['en'],
  dir,
  selectedIndexes: opts.selected ?? null,
});

const fileReq = (fileName = 'a.zip', resumable = true): AddRequest => ({
  url: 'https://example.com/a.zip',
  probe: { kind: 'file', fileName, size: 5000, resumable },
  quality: null,
  subtitleLangs: [],
  dir,
  selectedIndexes: null,
});

const states = (q: Queue) => q.snapshot().jobs.map((j) => j.state);
const jobAt = (q: Queue, i: number): Job => {
  const job = q.snapshot().jobs[i];
  if (!job) throw new Error(`no job at ${i}`);
  return job;
};
const progress = (jobId: string, bytesDone = 10): EngineEvent => ({ jobId, type: 'progress', bytesDone, bytesTotal: 100, speed: 5, eta: 18 });
const done = (jobId: string, fileName = 'x.mp4'): EngineEvent => ({ jobId, type: 'done', fileName, actualHeight: 720 });
const error = (jobId: string, reason: string, retryable: boolean, outcome: 'failed' | 'skipped' = 'failed'): EngineEvent => ({
  jobId,
  type: 'error',
  outcome,
  reason,
  retryable,
});
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hammel-queue-'));
  media = new FakeEngine();
  file = new FakeEngine();
  saves = [];
  timers = [];
  clock = 1_000_000;
  finished = [];
  changes = 0;
});

describe('adding', () => {
  it('adds a video as one queued media job with a fixed base name', () => {
    const q = build();
    q.add(video('What? A: B'));
    expect(jobAt(q, 0)).toMatchObject({
      kind: 'media',
      title: 'What? A: B',
      baseName: 'What A B',
      groupId: null,
      index: null,
      quality: { kind: 'max', height: 720 },
      dir,
    });
  });

  it('gives the same video added twice two different base names', () => {
    const q = build();
    q.add(video('Talk'));
    q.add(video('talk'));
    expect(q.snapshot().jobs.map((j) => j.baseName)).toEqual(['Talk', 'talk (2)']);
  });

  it('adds a playlist as a group in its own folder with numbered items', () => {
    const q = build();
    q.add(playlist(12));
    const { groups, jobs } = q.snapshot();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: 'React: Course?', dir: join(dir, 'React Course') });
    expect(jobs).toHaveLength(12);
    expect(jobs[2]).toMatchObject({
      groupId: groups[0]?.id,
      index: 3,
      baseName: '03 - Part 3',
      dir: join(dir, 'React Course'),
      url: 'https://example.com/v/3',
      subtitleLangs: ['en'],
    });
  });

  it('pads item numbers to the size of the whole playlist, not the selection', () => {
    const q = build();
    q.add(playlist(120, { selected: [7] }));
    expect(jobAt(q, 0)).toMatchObject({ index: 7, baseName: '007 - Part 7' });
  });

  it('adds only the selected items', () => {
    const q = build();
    q.add(playlist(5, { selected: [2, 4] }));
    expect(q.snapshot().jobs.map((j) => j.index)).toEqual([2, 4]);
  });

  it('shows unavailable items as skipped from the start', () => {
    const q = build();
    q.add(playlist(4, { unavailable: [2], selected: [1, 3, 4] }));
    expect(states(q)).toEqual(['probing', 'skipped', 'probing', 'probing']);
    expect(jobAt(q, 1)).toMatchObject({ reason: 'unavailable', index: 2 });
  });

  it('adds a file job with its size and resume support', () => {
    const q = build();
    q.add(fileReq('a.zip', false));
    expect(jobAt(q, 0)).toMatchObject({ kind: 'file', fileName: 'a.zip', baseName: null, quality: null, bytesTotal: 5000, resumable: false });
    expect(file.started).toHaveLength(1);
    expect(media.started).toHaveLength(0);
  });

  it('gives two downloads of the same file different names', () => {
    const q = build();
    q.add(fileReq());
    q.add(fileReq());
    expect(q.snapshot().jobs.map((j) => j.fileName)).toEqual(['a.zip', 'a (2).zip']);
  });

  it('does not reuse the name of a file already on disk', () => {
    writeFileSync(join(dir, 'A.ZIP'), 'existing');
    const q = build();
    q.add(fileReq());
    expect(jobAt(q, 0).fileName).toBe('a (2).zip');
  });
});

describe('scheduling', () => {
  it('runs at most maxConcurrent jobs across all groups', () => {
    const q = build({ maxConcurrent: 3 });
    q.add(playlist(3, { title: 'A' }));
    q.add(playlist(2, { title: 'B' }));
    expect(states(q)).toEqual(['probing', 'probing', 'probing', 'queued', 'queued']);
    expect(media.started).toHaveLength(3);
  });

  it('starts the next job when one finishes', () => {
    const q = build({ maxConcurrent: 3 });
    q.add(playlist(5));
    media.emit(done(jobAt(q, 0).id));
    expect(states(q)).toEqual(['done', 'probing', 'probing', 'probing', 'queued']);
  });

  it('moves a job to downloading on its first progress and records the numbers', () => {
    const q = build();
    q.add(video());
    media.emit(progress(jobAt(q, 0).id, 40));
    expect(jobAt(q, 0)).toMatchObject({ state: 'downloading', bytesDone: 40, bytesTotal: 100, speed: 5, eta: 18 });
  });

  it('follows merging and done, recording the file', () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(progress(id));
    media.emit({ jobId: id, type: 'merging' });
    media.emit({ jobId: id, type: 'merging' });
    expect(jobAt(q, 0).state).toBe('merging');
    media.emit(done(id, 'Talk.mp4'));
    expect(jobAt(q, 0)).toMatchObject({ state: 'done', fileName: 'Talk.mp4', actualHeight: 720 });
  });

  it('splits the speed limit between media slots and sets it globally for files', () => {
    const q = build({ speedLimitKbps: 900, maxConcurrent: 3 });
    q.add(video());
    expect(media.started[0]?.ctx.rateLimitBytes).toBe(307200);
    expect(file.limits).toEqual([921600]);
  });

  it('starts media jobs unlimited when there is no speed limit', () => {
    const q = build({ speedLimitKbps: 0 });
    q.add(video());
    expect(media.started[0]?.ctx.rateLimitBytes).toBeNull();
    expect(file.limits).toEqual([0]);
  });

  it('applies new settings: limit and slots', () => {
    const q = build({ maxConcurrent: 1 });
    q.add(playlist(3));
    expect(media.started).toHaveLength(1);
    q.setSettings(makeSettings({ maxConcurrent: 3, speedLimitKbps: 100 }));
    expect(media.started).toHaveLength(3);
    expect(file.limits).toEqual([0, 102400]);
  });

  it('lowering the slot count kills nothing and starts nothing until below the new limit', () => {
    const q = build({ maxConcurrent: 3 });
    q.add(playlist(5));
    q.setSettings(makeSettings({ maxConcurrent: 1 }));
    expect(media.stopped).toEqual([]);
    media.emit(done(jobAt(q, 0).id));
    media.emit(done(jobAt(q, 1).id));
    expect(media.started).toHaveLength(3);
    media.emit(done(jobAt(q, 2).id));
    expect(media.started).toHaveLength(4);
  });

  it('ignores an engine event for a job that is not running', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    await q.job(id, 'pause');
    media.emit(progress(id));
    media.emit(done(id));
    media.emit(done('unknown-id'));
    expect(jobAt(q, 0).state).toBe('paused');
  });
});

describe('pause and resume', () => {
  it('pausing an active job stops its engine, frees the slot and starts the next', async () => {
    const q = build({ maxConcurrent: 1 });
    q.add(playlist(2));
    const first = jobAt(q, 0).id;
    media.emit(progress(first));
    await q.job(first, 'pause');
    expect(media.stopped).toEqual([first]);
    expect(states(q)).toEqual(['paused', 'probing']);
    expect(jobAt(q, 0)).toMatchObject({ bytesDone: 10, speed: 0 });
  });

  it('resume queues the job instead of starting it past the limit', async () => {
    const q = build({ maxConcurrent: 1 });
    q.add(playlist(2));
    const first = jobAt(q, 0).id;
    await q.job(first, 'pause');
    await q.job(first, 'resume');
    expect(states(q)).toEqual(['queued', 'probing']);
  });

  it('a resumed job starts again when a slot is free', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    await q.job(id, 'pause');
    await q.job(id, 'resume');
    expect(jobAt(q, 0).state).toBe('probing');
    expect(media.started).toHaveLength(2);
  });

  it('pausing a queued job does not touch the engine', async () => {
    const q = build({ maxConcurrent: 1 });
    q.add(playlist(2));
    await q.job(jobAt(q, 1).id, 'pause');
    expect(media.stopped).toEqual([]);
    expect(states(q)).toEqual(['probing', 'paused']);
  });

  it('ignores a verb that does not apply instead of throwing', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(done(id));
    await q.job(id, 'pause');
    await q.job(id, 'resume');
    await q.job(id, 'retry');
    await q.job('unknown-id', 'pause');
    expect(jobAt(q, 0).state).toBe('done');
  });

  it('resumeAllPaused queues every paused job', () => {
    const paused = (id: string): Job => ({ ...structuredClone(seed), id, state: 'paused' });
    const seedQueue = build();
    seedQueue.add(video());
    const seed = jobAt(seedQueue, 0);
    media = new FakeEngine();
    const q = build({ maxConcurrent: 1 }, { jobs: [paused('a'), paused('b')], groups: [] });
    expect(media.started).toHaveLength(0);
    q.resumeAllPaused();
    expect(states(q)).toEqual(['probing', 'queued']);
  });

  it('pauseAll stops everything that is running or waiting', async () => {
    const q = build({ maxConcurrent: 1 });
    q.add(playlist(3));
    await q.pauseAll();
    expect(states(q)).toEqual(['paused', 'paused', 'paused']);
    expect(media.stopped).toHaveLength(1);
  });
});

describe('failures', () => {
  it('retries a retryable failure after a delay, without holding a slot', () => {
    const q = build({ maxConcurrent: 1 });
    q.add(playlist(2));
    const first = jobAt(q, 0).id;
    media.emit(error(first, 'HTTP Error 503', true));
    expect(jobAt(q, 0)).toMatchObject({ state: 'queued', reason: 'retrying (1/3)', attempts: 1 });
    expect(jobAt(q, 1).state).toBe('probing'); // the slot went to the next job
    expect(timers.map((t) => t.ms)).toContain(5000);
    media.emit(done(jobAt(q, 1).id));
    expect(jobAt(q, 0).state).toBe('queued'); // still waiting for its delay
    fire(5000);
    expect(jobAt(q, 0).state).toBe('probing');
  });

  it('uses growing delays and gives up after the third retry', () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    for (const delay of RETRY_DELAYS_MS) {
      media.emit(error(id, 'HTTP Error 503', true));
      expect(timers.map((t) => t.ms)).toContain(delay);
      fire(delay);
    }
    expect(RETRY_DELAYS_MS).toEqual([5000, 20000, 60000]);
    media.emit(error(id, 'HTTP Error 503', true));
    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: 'HTTP Error 503', attempts: 3 });
    expect(media.started).toHaveLength(4);
  });

  it.each(['disk full', 'cannot write to folder', 'login required'])('fails at once on "%s"', (reason) => {
    const q = build();
    q.add(video());
    media.emit(error(jobAt(q, 0).id, reason, false));
    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason });
    expect(timers.filter((t) => t.ms >= 5000)).toEqual([]);
  });

  it('a skipped item does not stop its siblings', () => {
    const q = build();
    q.add(playlist(3));
    media.emit(error(jobAt(q, 0).id, 'private', false, 'skipped'));
    expect(states(q)).toEqual(['skipped', 'probing', 'probing']);
    expect(jobAt(q, 0).reason).toBe('private');
  });

  it('pausing a job that waits for its retry cancels the retry', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(error(id, 'HTTP Error 503', true));
    await q.job(id, 'pause');
    fire(5000);
    expect(jobAt(q, 0).state).toBe('paused');
    expect(media.started).toHaveLength(1);
  });

  it('manual retry of a failed job starts it afresh', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(error(id, 'disk full', false));
    await q.job(id, 'retry');
    expect(jobAt(q, 0)).toMatchObject({ state: 'probing', reason: null, attempts: 0 });
  });
});

describe('cancel and remove', () => {
  it('cancel discards the partial data and removes the job', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    await q.job(id, 'cancel');
    expect(media.discarded).toEqual([id]);
    expect(q.snapshot().jobs).toEqual([]);
  });

  it('cancel of a file job goes to the file engine', async () => {
    const q = build();
    q.add(fileReq());
    const id = jobAt(q, 0).id;
    await q.job(id, 'cancel');
    expect(file.discarded).toEqual([id]);
  });

  it('cancel does nothing to a finished job', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(done(id));
    await q.job(id, 'cancel');
    expect(media.discarded).toEqual([]);
    expect(q.snapshot().jobs).toHaveLength(1);
  });

  it('remove takes a finished job off the list and keeps its file', async () => {
    writeFileSync(join(dir, 'Talk.mp4'), 'video');
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(done(id, 'Talk.mp4'));
    await q.job(id, 'remove');
    expect(q.snapshot().jobs).toEqual([]);
    expect(existsSync(join(dir, 'Talk.mp4'))).toBe(true);
  });

  it('remove does nothing to a job that is still in progress', async () => {
    const q = build();
    q.add(video());
    await q.job(jobAt(q, 0).id, 'remove');
    expect(q.snapshot().jobs).toHaveLength(1);
  });

  it('removeWithFile deletes the file of a finished job', async () => {
    writeFileSync(join(dir, 'Talk.mp4'), 'video');
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(done(id, 'Talk.mp4'));
    await q.job(id, 'removeWithFile');
    expect(existsSync(join(dir, 'Talk.mp4'))).toBe(false);
    expect(q.snapshot().jobs).toEqual([]);
  });

  it('removeWithFile on a failed job deletes nothing', async () => {
    writeFileSync(join(dir, 'Talk.mp4'), 'someone else');
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(error(id, 'disk full', false));
    await q.job(id, 'removeWithFile');
    expect(existsSync(join(dir, 'Talk.mp4'))).toBe(true);
    expect(q.snapshot().jobs).toEqual([]);
  });

  it('removes a group when its last job is removed', async () => {
    const q = build();
    q.add(playlist(1));
    await q.job(jobAt(q, 0).id, 'cancel');
    expect(q.snapshot().groups).toEqual([]);
  });
});

describe('groups', () => {
  it('pauses and resumes all members that can be', async () => {
    const q = build({ maxConcurrent: 2 });
    q.add(playlist(4));
    const gid = q.snapshot().groups[0]?.id as string;
    media.emit(done(jobAt(q, 0).id));
    await q.group(gid, 'pause');
    expect(states(q)).toEqual(['done', 'paused', 'paused', 'paused']);
    await q.group(gid, 'resume');
    expect(states(q)).toEqual(['done', 'probing', 'probing', 'queued']);
  });

  it('cancel discards unfinished members, keeps finished files and removes the group', async () => {
    const q = build();
    q.add(playlist(3));
    const gid = q.snapshot().groups[0]?.id as string;
    const [a, b, c] = q.snapshot().jobs.map((j) => j.id);
    media.emit(done(a as string));
    await q.group(gid, 'cancel');
    expect(media.discarded.sort()).toEqual([b, c].sort());
    expect(q.snapshot()).toEqual({ jobs: [], groups: [] });
  });

  it('announces a finished playlist once, with its counts', () => {
    const q = build();
    q.add(playlist(4, { unavailable: [4], selected: [1, 2, 3] }));
    const ids = q.snapshot().jobs.map((j) => j.id);
    media.emit(done(ids[0] as string));
    media.emit(error(ids[1] as string, 'disk full', false));
    expect(finished).toEqual([]);
    media.emit(done(ids[2] as string));
    expect(finished).toEqual([{ kind: 'group', title: 'React: Course?', failed: 1, skipped: 1 }]);
  });

  it('does not announce a playlist that still has a paused item', async () => {
    const q = build();
    q.add(playlist(2));
    const ids = q.snapshot().jobs.map((j) => j.id);
    await q.job(ids[1] as string, 'pause');
    media.emit(done(ids[0] as string));
    expect(finished).toEqual([]);
  });

  it('announces a lone job when it is done or has finally failed, not while it retries', () => {
    const q = build();
    q.add(video('One'));
    q.add(video('Two'));
    const [one, two] = q.snapshot().jobs.map((j) => j.id);
    media.emit(done(one as string));
    media.emit(error(two as string, 'HTTP Error 503', true));
    expect(finished).toEqual([{ kind: 'job', title: 'One', failed: 0, skipped: 0 }]);
    media.emit(error(two as string, 'ignored: not running', false));
    fire(5000);
    media.emit(error(two as string, 'disk full', false));
    expect(finished[1]).toEqual({ kind: 'job', title: 'Two', failed: 1, skipped: 0 });
  });
});

describe('persistence and notifications', () => {
  it('saves on every state change', () => {
    const q = build();
    q.add(video());
    const before = saves.length;
    expect(before).toBeGreaterThan(0);
    media.emit(progress(jobAt(q, 0).id));
    expect(saves.length).toBe(before + 1); // probing -> downloading
    expect(saves.at(-1)?.jobs[0]?.state).toBe('downloading');
    media.emit(done(jobAt(q, 0).id));
    expect(saves.at(-1)?.jobs[0]?.state).toBe('done');
  });

  it('saves plain progress at most every five seconds', () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(progress(id, 10));
    const before = saves.length;
    media.emit(progress(id, 20));
    media.emit(progress(id, 30));
    expect(saves.length).toBe(before);
    clock += 5001;
    media.emit(progress(id, 40));
    expect(saves.length).toBe(before + 1);
    expect(saves.at(-1)?.jobs[0]?.bytesDone).toBe(40);
  });

  it('throttles change notifications for progress and always delivers the last one', () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(progress(id, 10));
    const before = changes;
    media.emit(progress(id, 20));
    media.emit(progress(id, 30));
    expect(changes).toBe(before);
    fire(250);
    expect(changes).toBe(before + 1);
    expect(jobAt(q, 0).bytesDone).toBe(30);
  });

  it('hands out snapshots that cannot corrupt its state', () => {
    const q = build();
    q.add(video());
    const snap = q.snapshot();
    snap.jobs.length = 0;
    expect(q.snapshot().jobs).toHaveLength(1);
  });

  it('survives a failing global limit call', async () => {
    file.setGlobalLimit = async () => {
      throw new Error('aria2 down');
    };
    const q = build({ speedLimitKbps: 100 });
    q.add(video());
    await tick();
    expect(jobAt(q, 0).state).toBe('probing');
  });
});
