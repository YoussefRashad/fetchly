import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Engine, EngineEvent, EngineListener, StartContext } from '../../src/main/engines/engine';
import { Queue, RETRY_DELAYS_MS, SAVE_RETRY_MS } from '../../src/main/jobs/queue';
import type { Store } from '../../src/main/jobs/store';
import { parseSnapshotFile } from '../../src/main/jobs/validate';
import type { AddRequest, EntryReason, Group, Job, JobState, PlaylistEntry, Settings, Snapshot } from '../../src/shared/types';
import { makeJob, makeSettings } from '../helpers';

/** What the fake engines and the fake store did, in order: 'start', 'stop' and 'save' (one entry per attempt). */
let log: string[];
/** While `on`, the fake store throws `message` instead of keeping the snapshot. */
let saveFails: { on: boolean; message: string };

class FakeEngine implements Engine {
  started: { job: Job; ctx: StartContext }[] = [];
  stopped: string[] = [];
  discarded: string[] = [];
  rateLimits: [string, number | null][] = [];
  /** While set, stop (and discard, which stops first) wait for it. */
  stopGate: Promise<void> | null = null;
  /** stop and discard reject for these jobs: the stop is not confirmed. */
  stopFails = new Set<string>();
  private listener: EngineListener = () => undefined;
  on(l: EngineListener): void {
    this.listener = l;
  }
  start(job: Job, ctx: StartContext): void {
    log.push('start');
    this.started.push({ job, ctx });
  }
  async stop(jobId: string): Promise<void> {
    log.push('stop');
    this.stopped.push(jobId);
    await this.confirmStop(jobId);
  }
  async discard(job: Job): Promise<void> {
    this.discarded.push(job.id);
    await this.confirmStop(job.id);
  }
  /** Records the call; aria2 confirms the limit. */
  async setRateLimit(jobId: string, bytesPerSec: number | null): Promise<boolean> {
    this.rateLimits.push([jobId, bytesPerSec]);
    return true;
  }
  emit(ev: EngineEvent): void {
    this.listener(ev);
  }
  private async confirmStop(jobId: string): Promise<void> {
    if (this.stopGate) await this.stopGate;
    if (this.stopFails.has(jobId)) throw new Error('the process did not end');
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

/** A queue on the fake engines and store, with no listener registered. */
function buildBare(
  settings: Partial<Settings> = {},
  initial: Snapshot = { jobs: [], groups: [] },
  straysCleared = true,
  extra: Pick<ConstructorParameters<typeof Queue>[0], 'markDownloaded'> = {},
): Queue {
  const store = {
    saveSnapshot: (s: Snapshot) => {
      log.push('save');
      if (saveFails.on) throw new Error(saveFails.message);
      saves.push(structuredClone(s));
    },
  } as unknown as Store;
  return new Queue({
    store,
    media,
    file,
    initial,
    settings: makeSettings(settings),
    straysCleared,
    now: () => clock,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    ...extra,
  });
}

function build(settings: Partial<Settings> = {}, initial: Snapshot = { jobs: [], groups: [] }, straysCleared = true): Queue {
  const queue = buildBare(settings, initial, straysCleared);
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

const OK = { ok: true, value: null } as const;
const PAUSE_NOT_CONFIRMED = 'Could not confirm that the download stopped. It is still listed as running; try again.';
const CANCEL_NOT_CONFIRMED = 'Could not confirm that the download stopped, so nothing was deleted. It is still in the list; try again.';
const CLOSING = 'Fetchly is closing';
const CUT_OFF =
  'This download was cut off and Fetchly could not check that its old process is gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then choose "They are gone" in the banner, or restart Fetchly.';
/** The save error a listener is told about when the store throws `reason`. */
const saveMessage = (reason: string): string => `could not save the download list: ${reason}`;
/** SAVE_RETRY_MS as the plan states it (OQ2); one spec checks the exported constant against it. */
const SAVE_RETRY = 60000;

/** Holds every stop and discard of `engine` until the returned function is called. */
function holdStops(engine: FakeEngine = media): () => void {
  let release: () => void = () => undefined;
  engine.stopGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

/** The last save read back the way the stored list is read: null when the list would be set aside. */
const loadedLastSave = (): Snapshot | null => parseSnapshotFile(JSON.parse(JSON.stringify({ version: 1, ...saves.at(-1) })));
const ids = (q: Queue): string[] => q.snapshot().jobs.map((j) => j.id);
const groupAt = (q: Queue, i = 0): Group => {
  const group = q.snapshot().groups[i];
  if (!group) throw new Error(`no group at ${i}`);
  return group;
};
const saveAttempts = (): number => log.filter((entry) => entry === 'save').length;
/** Everything a save-state listener is told from now on (and at once), in order. */
function saveStates(q: Queue): (string | null)[] {
  const told: (string | null)[] = [];
  q.onSaveState((state) => {
    told.push(state);
  });
  return told;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetchly-queue-'));
  log = [];
  saveFails = { on: false, message: 'disk full' };
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

    // B15: each placeholder keeps the reason its entry gave.
    const reasons: EntryReason[] = ['private', 'removed', 'unavailable'];
    const q2 = build();
    q2.add({
      ...playlist(4),
      probe: {
        kind: 'playlist',
        title: 'Reasons',
        entries: [
          { index: 1, url: 'https://example.com/v/1', title: 'Fine', unavailable: false, reason: null },
          ...reasons.map((reason, i) => ({ index: i + 2, url: '', title: `Gone ${i + 2}`, unavailable: true, reason })),
        ],
      },
    });
    expect(states(q2)).toEqual(['probing', 'skipped', 'skipped', 'skipped']);
    expect(q2.snapshot().jobs.map((j) => j.reason)).toEqual([null, 'private', 'removed', 'unavailable']);
    expect(loadedLastSave()).not.toBeNull();
  });

  it('gives a placeholder whose entry names no reason the reason "unavailable", and a listed item no reason at all', () => {
    const q = build();
    q.add({
      ...playlist(3),
      probe: {
        kind: 'playlist',
        title: 'Odd',
        entries: [
          { index: 1, url: '', title: 'No reason given', unavailable: true, reason: null },
          // Inconsistent entry: a reason on an item that can be downloaded. The job is not skipped, so it has none.
          { index: 2, url: 'https://example.com/v/2', title: 'Has a reason', unavailable: false, reason: 'private' },
        ],
      },
    });
    expect(q.snapshot().jobs.map((j) => [j.state, j.reason])).toEqual([
      ['skipped', 'unavailable'],
      ['probing', null],
    ]);
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

  describe('marking finished downloads as from the internet', () => {
    it('marks the finished file with its full path and link, before the window hears it is done', () => {
      const marks: [string, string, string][] = [];
      let queue: Queue | null = null;
      const q = buildBare({}, undefined, true, {
        markDownloaded: (path, url) => void marks.push([path, url, queue?.snapshot().jobs[0]?.state ?? 'none']),
      });
      queue = q;
      q.add(fileReq('setup.exe'));
      const id = jobAt(q, 0).id;
      file.emit(progress(id));
      file.emit(done(id, 'setup.exe'));
      // The job was still listed as downloading while the mark was written.
      expect(marks).toEqual([[join(dir, 'setup.exe'), 'https://example.com/a.zip', 'downloading']]);
      expect(jobAt(q, 0).state).toBe('done');
    });

    it('marks a finished video in its playlist folder', () => {
      const marks: string[] = [];
      const q = buildBare({ maxConcurrent: 1 }, undefined, true, { markDownloaded: (path) => void marks.push(path) });
      q.add(playlist(1));
      const job = jobAt(q, 0);
      media.emit(done(job.id, '01 - Part 1.mp4'));
      expect(marks).toEqual([join(job.dir, '01 - Part 1.mp4')]);
    });

    it('still finishes the download when the mark cannot be written', () => {
      const q = buildBare({}, undefined, true, {
        markDownloaded: () => {
          throw new Error('EINVAL');
        },
      });
      q.add(video());
      media.emit(done(jobAt(q, 0).id, 'Talk.mp4'));
      expect(jobAt(q, 0)).toMatchObject({ state: 'done', fileName: 'Talk.mp4' });
    });

    it('marks nothing for a download that failed or finished without a usable file', () => {
      const marks: string[] = [];
      const q = buildBare({}, undefined, true, { markDownloaded: (path) => void marks.push(path) });
      q.add(video('One'));
      q.add(video('Two'));
      media.emit(error(jobAt(q, 0).id, 'gone', false));
      media.emit({ jobId: jobAt(q, 1).id, type: 'done', fileName: ' . ', actualHeight: null });
      expect(states(q)).toEqual(['failed', 'failed']);
      expect(marks).toEqual([]);
    });
  });

  it('splits the speed limit between the slots, the same share for a video and a file', () => {
    const q = build({ speedLimitKbps: 900, maxConcurrent: 3 });
    q.add(video());
    q.add(fileReq());
    expect(media.started[0]?.ctx.rateLimitBytes).toBe(307200);
    expect(file.started[0]?.ctx.rateLimitBytes).toBe(307200);
  });

  it('starts both kinds unlimited when there is no speed limit', () => {
    const q = build({ speedLimitKbps: 0 });
    q.add(video());
    q.add(fileReq());
    expect(media.started[0]?.ctx.rateLimitBytes).toBeNull();
    expect(file.started[0]?.ctx.rateLimitBytes).toBeNull();
  });

  it('applies new settings: more slots start the jobs that were waiting', () => {
    const q = build({ maxConcurrent: 1 });
    q.add(playlist(3));
    expect(media.started).toHaveLength(1);
    q.setSettings(makeSettings({ maxConcurrent: 3 }));
    expect(media.started).toHaveLength(3);
    expect(states(q)).toEqual(['probing', 'probing', 'probing']);
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

  it('resumeAllPaused queues every paused job', async () => {
    const paused = (id: string): Job => ({ ...structuredClone(seed), id, state: 'paused' });
    const seedQueue = build();
    seedQueue.add(video());
    const seed = jobAt(seedQueue, 0);
    media = new FakeEngine();
    const q = build({ maxConcurrent: 1 }, { jobs: [paused('a'), paused('b')], groups: [] });
    expect(media.started).toHaveLength(0);
    q.resumeAllPaused();
    await tick(); // a verb starts on a later microtask
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

describe('a finished download that names no file (A9)', () => {
  const REASON = 'finished without a file';

  it.each([
    ['media', 'probing'],
    ['media', 'downloading'],
    ['media', 'merging'],
    ['file', 'probing'],
    ['file', 'downloading'],
  ] as const)('fails a %s job that was %s at once, with no retry and no empty name saved', (kind, state) => {
    const q = build();
    q.add(kind === 'media' ? video() : fileReq());
    const engine = kind === 'media' ? media : file;
    const id = jobAt(q, 0).id;
    if (state === 'downloading') engine.emit(progress(id));
    if (state === 'merging') {
      media.emit(progress(id));
      media.emit({ jobId: id, type: 'merging' });
    }
    expect(jobAt(q, 0).state).toBe(state);
    const nameBefore = jobAt(q, 0).fileName;

    engine.emit({ jobId: id, type: 'done', fileName: '', actualHeight: null });

    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: REASON, fileName: nameBefore, speed: 0, eta: null });
    expect(timers.filter((t) => t.ms >= 5000)).toEqual([]);
    fire(5000);
    fire(20000);
    fire(60000);
    expect(jobAt(q, 0).state).toBe('failed');
    expect(engine.started).toHaveLength(1);
    expect(finished).toEqual([{ kind: 'job', title: jobAt(q, 0).title, failed: 1, skipped: 0 }]);
    expect(saves.flatMap((s) => s.jobs).filter((j) => j.fileName === '')).toEqual([]);
    expect(saves.at(-1)?.jobs[0]).toMatchObject({ state: 'failed', reason: REASON });
    expect(parseSnapshotFile(JSON.parse(JSON.stringify(saves.at(-1))))).not.toBeNull();
  });

  it('does not depend on the height the engine reports', () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit({ jobId: id, type: 'done', fileName: '', actualHeight: 720 });
    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: REASON });
    expect(parseSnapshotFile(JSON.parse(JSON.stringify(saves.at(-1))))).not.toBeNull();
  });

  it.each([0, 1, 2])('is not retried even when the job has %d retries behind it and some left', (retries) => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    for (const delay of RETRY_DELAYS_MS.slice(0, retries)) {
      media.emit(error(id, 'HTTP Error 503', true));
      fire(delay);
    }
    expect(jobAt(q, 0)).toMatchObject({ state: 'probing', attempts: retries });
    media.emit({ jobId: id, type: 'done', fileName: '', actualHeight: null });
    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: REASON });
    expect(timers.filter((t) => t.ms >= 5000)).toEqual([]);
    expect(media.started).toHaveLength(retries + 1);
    expect(parseSnapshotFile(JSON.parse(JSON.stringify(saves.at(-1))))).not.toBeNull();
  });

  it('counts as a failure in the summary of its group', () => {
    const q = build();
    q.add(playlist(2));
    const [first, second] = [jobAt(q, 0).id, jobAt(q, 1).id];
    media.emit({ jobId: first, type: 'done', fileName: '', actualHeight: 720 });
    expect(finished).toEqual([]); // the other item is still running
    media.emit(done(second));
    expect(finished).toEqual([{ kind: 'group', title: 'React: Course?', failed: 1, skipped: 0 }]);
    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: REASON });
    expect(jobAt(q, 1).state).toBe('done');
    expect(parseSnapshotFile(JSON.parse(JSON.stringify(saves.at(-1))))).not.toBeNull();
  });

  it('can be retried by hand like any other failure', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit({ jobId: id, type: 'done', fileName: '', actualHeight: null });
    await q.job(id, 'retry');
    expect(jobAt(q, 0)).toMatchObject({ state: 'probing', reason: null, attempts: 0 });
    expect(media.started).toHaveLength(2);
  });

  it('leaves a normal finish alone', () => {
    const q = build();
    q.add(video());
    media.emit(done(jobAt(q, 0).id, 'Talk.mp4'));
    expect(jobAt(q, 0)).toMatchObject({ state: 'done', fileName: 'Talk.mp4', reason: null });
  });
});

describe('the name a done event may save (B1)', () => {
  const REASON = 'finished without a file';

  /** A done event as a tool may send it: the name is whatever it printed, and not always a string. */
  const doneNamed = (jobId: string, fileName: unknown): EngineEvent => ({ jobId, type: 'done', fileName, actualHeight: 720 }) as unknown as EngineEvent;

  /** The stored list must load again whatever the last save holds. */
  const lastSaveLoads = (): void => {
    expect(parseSnapshotFile(JSON.parse(JSON.stringify(saves.at(-1))))).not.toBeNull();
  };

  const UNUSABLE: [string, unknown][] = [
    ['two dots', '..'],
    ['one dot', '.'],
    ['three dots', '...'],
    ['four dots', '....'],
    ['dots and spaces', '. . .'],
    ['spaces only', '   '],
    ['one space', ' '],
    ['a non-breaking space', ' '],
    ['an ideographic space', '　'],
    ['a colon', 'a:b'],
    ['an alternate data stream', 'report.txt:payload'],
    ['a backslash', 'a\\b'],
    ['a path up', '..\\evil.exe'],
    ['a slash', 'a/b'],
    ['a leading slash', '/a.mp4'],
    ['a null character', 'a\u0000b'],
    ['a tab', 'a\tb'],
    ['a newline', 'a\nb'],
    ['a unit separator', 'a\u001fb'],
    ['a delete character', 'a\u007fb'],
    ['an empty name', ''],
    ['undefined', undefined],
    ['null', null],
    ['a number', 5],
    ['true', true],
    ['a list', ['Talk.mp4']],
    ['an object', { name: 'Talk.mp4' }],
  ];
  const KINDS = ['media', 'file'] as const;

  it.each(KINDS.flatMap((kind) => UNUSABLE.map(([label, value]) => [kind, label, value] as const)))(
    'fails a %s job that finishes with %s as its name: no retry, no timer, name kept',
    (kind, _label, value) => {
      const q = build();
      q.add(kind === 'media' ? video() : fileReq());
      const engine = kind === 'media' ? media : file;
      const id = jobAt(q, 0).id;
      engine.emit(progress(id));
      expect(jobAt(q, 0).state).toBe('downloading');
      const nameBefore = jobAt(q, 0).fileName;

      engine.emit(doneNamed(id, value));

      expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: REASON, fileName: nameBefore, speed: 0, eta: null });
      expect(timers).toEqual([]);
      fire(5000);
      fire(20000);
      fire(60000);
      expect(jobAt(q, 0).state).toBe('failed');
      expect(engine.started).toHaveLength(1);
      expect(finished).toEqual([{ kind: 'job', title: jobAt(q, 0).title, failed: 1, skipped: 0 }]);
      if (typeof value === 'string') expect(saves.flatMap((s) => s.jobs).filter((j) => j.fileName === value)).toEqual([]);
      expect(saves.at(-1)?.jobs[0]).toMatchObject({ state: 'failed', reason: REASON, fileName: nameBefore });
      lastSaveLoads();
    },
  );

  it.each([
    ['media', 'probing', '..'],
    ['media', 'merging', '..'],
    ['media', 'probing', '...'],
    ['media', 'merging', 'a:b'],
    ['file', 'probing', '...'],
    ['file', 'downloading', 'a:b'],
  ] as const)('fails a %s job that was %s when it finished with the name %j', (kind, state, name) => {
    const q = build();
    q.add(kind === 'media' ? video() : fileReq());
    const engine = kind === 'media' ? media : file;
    const id = jobAt(q, 0).id;
    if (state !== 'probing') engine.emit(progress(id));
    if (state === 'merging') media.emit({ jobId: id, type: 'merging' });
    expect(jobAt(q, 0).state).toBe(state);
    const nameBefore = jobAt(q, 0).fileName;
    engine.emit(doneNamed(id, name));
    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: REASON, fileName: nameBefore });
    expect(timers).toEqual([]);
    lastSaveLoads();
  });

  it.each([0, 1, 2])('is not retried even when the job has %d retries behind it and some left', (retries) => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    for (const delay of RETRY_DELAYS_MS.slice(0, retries)) {
      media.emit(error(id, 'HTTP Error 503', true));
      fire(delay);
    }
    expect(jobAt(q, 0)).toMatchObject({ state: 'probing', attempts: retries });
    media.emit(doneNamed(id, '...'));
    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: REASON });
    expect(timers).toEqual([]);
    expect(media.started).toHaveLength(retries + 1);
    lastSaveLoads();
  });

  it.each([
    ['two dots', '..'],
    ['a colon', 'a:b'],
    ['an empty name', ''],
    ['spaces only', '   '],
    ['not a string', undefined],
  ])('keeps the file name a media job already had when it finishes with %s', (_label, value) => {
    const old = makeJob({ id: 'old', state: 'queued', fileName: 'Old.mp4', dir, baseName: 'Old' });
    const q = build({}, { jobs: [old], groups: [] });
    expect(jobAt(q, 0).state).toBe('probing');
    media.emit(doneNamed('old', value));
    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: REASON, fileName: 'Old.mp4' });
    expect(timers).toEqual([]);
    expect(saves.at(-1)?.jobs[0]).toMatchObject({ state: 'failed', fileName: 'Old.mp4' });
    lastSaveLoads();
  });

  it('fails an old file job named "..." when the file engine echoes the name back', () => {
    const old = makeJob({ id: 'old-file', kind: 'file', state: 'queued', quality: null, baseName: null, fileName: '...', dir, title: 'old', bytesTotal: 5000 });
    // Ruling 4a: the old list loads as it is; only the new done event is refused.
    expect(parseSnapshotFile(JSON.parse(JSON.stringify({ version: 1, jobs: [old], groups: [] })))).not.toBeNull();
    const q = build({}, { jobs: [old], groups: [] });
    expect(jobAt(q, 0).state).toBe('probing');
    file.emit({ jobId: 'old-file', type: 'done', fileName: '...', actualHeight: null });
    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: REASON, fileName: '...' });
    expect(timers).toEqual([]);
    expect(finished).toEqual([{ kind: 'job', title: 'old', failed: 1, skipped: 0 }]);
    lastSaveLoads();
  });

  it('counts a refused name as a failure in the summary of its group', () => {
    const q = build();
    q.add(playlist(2));
    const [first, second] = [jobAt(q, 0).id, jobAt(q, 1).id];
    media.emit(doneNamed(first, 'a:b'));
    expect(finished).toEqual([]); // the other item is still running
    media.emit(done(second, 'Part 2.mp4'));
    expect(finished).toEqual([{ kind: 'group', title: 'React: Course?', failed: 1, skipped: 0 }]);
    expect(jobAt(q, 0)).toMatchObject({ state: 'failed', reason: REASON, fileName: null });
    expect(jobAt(q, 1)).toMatchObject({ state: 'done', fileName: 'Part 2.mp4' });
    expect(timers).toEqual([]);
    lastSaveLoads();
  });

  it('can be retried by hand like any other failure', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(doneNamed(id, '..'));
    await q.job(id, 'retry');
    expect(jobAt(q, 0)).toMatchObject({ state: 'probing', reason: null, attempts: 0 });
    expect(media.started).toHaveLength(2);
  });

  const USABLE = [
    'Talk.mp4 ',
    'Talk.mp4',
    'a.',
    '.a',
    ' a',
    'a..b',
    '...a',
    'a...',
    'My talk (final) 2.mp4',
    'ملف.mp4',
    'a'.repeat(300),
  ];

  it.each(KINDS.flatMap((kind) => USABLE.map((name) => [kind, name] as const)))('still completes a %s job named %j, exactly as given', (kind, name) => {
    const q = build();
    q.add(kind === 'media' ? video() : fileReq());
    const engine = kind === 'media' ? media : file;
    const id = jobAt(q, 0).id;
    engine.emit(progress(id));
    engine.emit({ jobId: id, type: 'done', fileName: name, actualHeight: null });
    expect(jobAt(q, 0)).toMatchObject({ state: 'done', fileName: name, reason: null });
    expect(finished).toEqual([{ kind: 'job', title: jobAt(q, 0).title, failed: 0, skipped: 0 }]);
    expect(saves.at(-1)?.jobs[0]).toMatchObject({ state: 'done', fileName: name });
    expect(parseSnapshotFile(JSON.parse(JSON.stringify(saves.at(-1))))?.jobs[0]?.fileName).toBe(name);
  });
});

describe('Queue.add keeps no array rule of its own (B2, spec 7.8)', () => {
  const heightsThenHole = new Array<number>(2);
  heightsThenHole[0] = 1080;
  const ROWS: [string, unknown[]][] = [
    ['NaN', [Number.NaN]],
    ['a negative height', [-720]],
    ['zero', [0]],
    ['Infinity', [Number.POSITIVE_INFINITY]],
    ['text', ['1080']],
    ['a null entry', [1080, null]],
    ['a hole', new Array<number>(1)],
    ['a valid height and then a hole', heightsThenHole],
    ['101 heights', Array.from({ length: 101 }, (_, i) => i + 1)],
  ];

  it.each(ROWS)('still adds a video whose probe lists heights with %s: the checks are the handler\'s', (_label, heights) => {
    const q = build();
    const req = { ...video(), probe: { kind: 'media', title: 'Talk', thumbnail: null, heights } } as unknown as AddRequest;
    expect(() => q.add(req)).not.toThrow();
    expect(q.snapshot().jobs).toHaveLength(1);
    expect(jobAt(q, 0)).toMatchObject({ kind: 'media', state: 'probing', title: 'Talk' });
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
  /** A job as the last save holds it: these are the numbers that would be written to disk. */
  const savedJob = (id: string): Job => {
    const job = saves.at(-1)?.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`no saved job ${id}`);
    return job;
  };
  const meters = (j: Job) => ({ bytesDone: j.bytesDone, bytesTotal: j.bytesTotal, speed: j.speed, eta: j.eta, actualHeight: j.actualHeight });
  /** No saved meter is negative or NaN. */
  const expectSound = (j: Job): void => {
    for (const [name, value] of Object.entries(meters(j))) {
      if (value === null) continue;
      expect(Number.isFinite(value), `${name} is finite`).toBe(true);
      expect(value, `${name} is not negative`).toBeGreaterThanOrEqual(0);
    }
  };

  it('never saves a number the stored list would reject', () => {
    const q = build();
    q.add(video());
    q.add(fileReq());
    const [v, f] = [jobAt(q, 0).id, jobAt(q, 1).id];
    media.emit({ jobId: v, type: 'progress', bytesDone: Number.NaN, bytesTotal: -5, speed: Number.NaN, eta: Number.POSITIVE_INFINITY });
    file.emit({ jobId: f, type: 'progress', bytesDone: -1, bytesTotal: Number.NaN, speed: -3, eta: -2 });

    // After a bad number: bytesDone and bytesTotal keep their previous value, speed is 0, eta and actualHeight are null.
    expect(meters(savedJob(v))).toEqual({ bytesDone: 0, bytesTotal: null, speed: 0, eta: null, actualHeight: null });
    expect(meters(savedJob(f))).toEqual({ bytesDone: 0, bytesTotal: 5000, speed: 0, eta: null, actualHeight: null }); // 5000 is the size the probe gave
    expectSound(savedJob(v));
    expectSound(savedJob(f));
    expect(parseSnapshotFile(JSON.parse(JSON.stringify(saves.at(-1))))).not.toBeNull();

    media.emit({ jobId: v, type: 'done', fileName: 'Talk.mp4', actualHeight: Number.POSITIVE_INFINITY });
    file.emit({ jobId: f, type: 'done', fileName: 'a.zip', actualHeight: 0 });

    // A finished job takes bytesDone from bytesTotal, so a bad total would have leaked into it here.
    expect(meters(savedJob(v))).toEqual({ bytesDone: 0, bytesTotal: null, speed: 0, eta: null, actualHeight: null });
    expect(meters(savedJob(f))).toEqual({ bytesDone: 5000, bytesTotal: 5000, speed: 0, eta: null, actualHeight: null });
    expectSound(savedJob(v));
    expectSound(savedJob(f));
    expect(saves.at(-1)?.jobs.map((j) => j.state)).toEqual(['done', 'done']);
    expect(parseSnapshotFile(JSON.parse(JSON.stringify(saves.at(-1))))).not.toBeNull();
  });

  describe('one bad meter at a time (N1)', () => {
    const GOOD = { bytesDone: 10, bytesTotal: 100, speed: 5, eta: 18 };
    const NEXT = { bytesDone: 20, bytesTotal: 200, speed: 7, eta: 9 };
    const FIELDS = ['bytesDone', 'bytesTotal', 'speed', 'eta'] as const;
    /** What a meter becomes when its new number is bad: the old count stays, speed falls to 0, eta to null. */
    const KEPT: Record<(typeof FIELDS)[number], number | null> = { bytesDone: GOOD.bytesDone, bytesTotal: GOOD.bytesTotal, speed: 0, eta: null };
    const BAD_NUMBERS = [Number.NaN, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const KINDS = ['media', 'file'] as const;

    // A media total that is not a count clears the old total; every other bad meter keeps what it had.
    const clearsTotal = (kind: (typeof KINDS)[number], field: (typeof FIELDS)[number]) => kind === 'media' && field === 'bytesTotal';
    const CASES = KINDS.flatMap((kind) =>
      FIELDS.flatMap((field) =>
        BAD_NUMBERS.map(
          (bad) =>
            [
              `a ${kind} job ${clearsTotal(kind, field) ? 'clears its total' : 'keeps what it had'} when ${field} becomes ${String(bad)} and takes the other new numbers`,
              kind,
              field,
              bad,
            ] as const,
        ),
      ),
    );

    it.each(CASES)(
      '%s',
      (_name, kind, field, bad) => {
        const q = build();
        q.add(kind === 'media' ? video() : fileReq());
        const engine = kind === 'media' ? media : file;
        const id = jobAt(q, 0).id;
        engine.emit({ jobId: id, type: 'progress', ...GOOD });
        clock += 5001; // plain progress is saved at most every five seconds
        const next = { ...NEXT, [field]: bad } as typeof NEXT;
        engine.emit({ jobId: id, type: 'progress', ...next });

        // A media total that is not a count is an unknown total, and an unknown media total clears the old one.
        const kept = clearsTotal(kind, field) ? null : KEPT[field];
        const expected = { ...NEXT, [field]: kept, actualHeight: null };
        expect(meters(savedJob(id))).toEqual(expected);
        expectSound(savedJob(id));
        expect(parseSnapshotFile(JSON.parse(JSON.stringify(saves.at(-1))))).not.toBeNull();
      },
    );

    it.each(KINDS.flatMap((kind) => [0, -720, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map((bad) => [kind, bad] as const)))(
      'a %s job that finishes with the height %s saves no height',
      (kind, bad) => {
        const q = build();
        q.add(kind === 'media' ? video() : fileReq());
        const engine = kind === 'media' ? media : file;
        const id = jobAt(q, 0).id;
        engine.emit(progress(id));
        engine.emit({ jobId: id, type: 'done', fileName: 'Talk.mp4', actualHeight: bad });
        expect(savedJob(id)).toMatchObject({ state: 'done', actualHeight: null });
        expectSound(savedJob(id));
      },
    );

    it.each([720, 1, 2160])('keeps the real height %s of a finished job', (height) => {
      const q = build();
      q.add(video());
      const id = jobAt(q, 0).id;
      media.emit(progress(id));
      media.emit({ jobId: id, type: 'done', fileName: 'Talk.mp4', actualHeight: height });
      expect(savedJob(id)).toMatchObject({ state: 'done', actualHeight: height });
    });
  });

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

  it('a notify timer armed before shutdown tells nobody when it fires after it (F4)', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(progress(id, 10)); // the first progress is a state change: notified at once
    media.emit(progress(id, 20)); // within the notify period: the timer is armed
    expect(timers.filter((t) => t.ms === 250)).toHaveLength(1);
    await q.shutdown();
    const before = changes;
    fire(250);
    expect(changes).toBe(before);
  });

  it('hands out snapshots that cannot corrupt its state', () => {
    const q = build();
    q.add(video());
    const snap = q.snapshot();
    snap.jobs.length = 0;
    expect(q.snapshot().jobs).toHaveLength(1);
  });

});

describe('verbs per job in order, with a result (7.1)', () => {
  const VERBS = ['pause', 'resume', 'cancel', 'retry', 'remove', 'removeWithFile'] as const;
  const GROUP_VERBS = ['pause', 'resume', 'cancel'] as const;
  type Verb = (typeof VERBS)[number];

  /** A queue with one job (at `id`) in the given state. For 'queued' a second job holds the only slot. */
  function reach(state: JobState): { q: Queue; id: string } {
    if (state === 'paused') {
      const q = build({}, { jobs: [makeJob({ id: 'p', state: 'paused', dir, baseName: 'p' })], groups: [] });
      return { q, id: 'p' };
    }
    const q = build({ maxConcurrent: state === 'queued' ? 1 : 3 });
    q.add(video('One'));
    if (state === 'queued') q.add(video('Two'));
    const index = state === 'queued' ? 1 : 0;
    const id = jobAt(q, index).id;
    if (state === 'downloading' || state === 'merging') media.emit(progress(id));
    if (state === 'merging') media.emit({ jobId: id, type: 'merging' });
    if (state === 'done') media.emit(done(id));
    if (state === 'failed') media.emit(error(id, 'disk full', false));
    if (state === 'skipped') media.emit(error(id, 'private', false, 'skipped'));
    expect(jobAt(q, index).state).toBe(state);
    return { q, id };
  }

  it('a second pause during a pending stop waits for it', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    const p1 = q.job(id, 'pause');
    const p2 = q.job(id, 'pause');
    await tick();
    expect(jobAt(q, 0).state).toBe('probing');
    expect(media.stopped).toEqual([id]);
    release();
    expect(await Promise.all([p1, p2])).toEqual([OK, OK]);
    expect(jobAt(q, 0).state).toBe('paused');
    expect(media.stopped).toEqual([id]);
  });

  it('a resume issued during a pending pause runs after it', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    const p1 = q.job(id, 'pause');
    const p2 = q.job(id, 'resume');
    await tick();
    expect(jobAt(q, 0).state).toBe('probing');
    expect(media.started).toHaveLength(1);
    release();
    expect(await Promise.all([p1, p2])).toEqual([OK, OK]);
    // stop, then the saves of the two transitions, then the start of the resumed job.
    expect(log.slice(log.lastIndexOf('stop')).join(',')).toMatch(/^stop(,save)+,start$/);
    expect(jobAt(q, 0).state).toBe('probing');
    expect(media.started).toHaveLength(2);
  });

  it('a cancel issued during a pending pause removes the job after the stop', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    const p1 = q.job(id, 'pause');
    const p2 = q.job(id, 'cancel');
    await tick();
    expect(media.discarded).toEqual([]);
    expect(q.snapshot().jobs).toHaveLength(1);
    release();
    expect(await Promise.all([p1, p2])).toEqual([OK, OK]);
    expect(media.stopped).toEqual([id]);
    expect(media.discarded).toEqual([id]);
    expect(q.snapshot().jobs).toEqual([]);
  });

  it('a verb issued during a pending cancel finds the row gone and does nothing', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    const cancel = q.job(id, 'cancel');
    const retry = q.job(id, 'retry');
    await tick();
    release();
    expect(await Promise.all([cancel, retry])).toEqual([OK, OK]);
    expect(q.snapshot().jobs).toEqual([]);
    expect(media.started).toHaveLength(1);
  });

  it.each(VERBS)('a %s for a job that was removed meanwhile does nothing', async (verb) => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(done(id));
    const first = q.job(id, 'remove');
    const second = q.job(id, verb);
    expect(await first).toEqual(OK);
    await expect(second).resolves.toEqual(OK);
    expect(q.snapshot().jobs).toEqual([]);
    expect(media.stopped).toEqual([]);
    expect(media.discarded).toEqual([]);
    expect(media.started).toHaveLength(1);
  });

  it.each(VERBS)('a %s for a job that never existed answers ok and does nothing', async (verb) => {
    const q = build();
    q.add(video());
    const before = q.snapshot();
    expect(await q.job('unknown-id', verb)).toEqual(OK);
    expect(q.snapshot()).toEqual(before);
    expect(media.stopped).toEqual([]);
    expect(media.discarded).toEqual([]);
  });

  it.each(GROUP_VERBS)('a group %s for a group that was removed meanwhile does nothing', async (verb) => {
    const q = build();
    q.add(playlist(1));
    const gid = groupAt(q).id;
    media.emit(done(jobAt(q, 0).id));
    await q.job(jobAt(q, 0).id, 'remove');
    expect(q.snapshot().groups).toEqual([]);
    expect(await q.group(gid, verb)).toEqual(OK);
    expect(media.stopped).toEqual([]);
    expect(media.discarded).toEqual([]);
  });

  const NO_FIT: [JobState, Verb][] = [
    ['queued', 'resume'],
    ['queued', 'retry'],
    ['queued', 'remove'],
    ['queued', 'removeWithFile'],
    ['probing', 'resume'],
    ['probing', 'retry'],
    ['probing', 'remove'],
    ['probing', 'removeWithFile'],
    ['downloading', 'resume'],
    ['downloading', 'retry'],
    ['downloading', 'remove'],
    ['downloading', 'removeWithFile'],
    ['merging', 'pause'],
    ['merging', 'resume'],
    ['merging', 'retry'],
    ['merging', 'remove'],
    ['merging', 'removeWithFile'],
    ['paused', 'pause'],
    ['paused', 'retry'],
    ['paused', 'remove'],
    ['paused', 'removeWithFile'],
    ['done', 'pause'],
    ['done', 'resume'],
    ['done', 'retry'],
    ['done', 'cancel'],
    ['failed', 'pause'],
    ['failed', 'resume'],
    ['skipped', 'pause'],
    ['skipped', 'resume'],
    ['skipped', 'retry'],
  ];

  it.each(NO_FIT)('a verb that does not fit the state answers ok and changes nothing: a %s job, %s', async (state, verb) => {
    const { q, id } = reach(state);
    const before = q.snapshot();
    const engineCalls = (): number[] => [media, file].flatMap((e) => [e.started.length, e.stopped.length, e.discarded.length]);
    const callsBefore = engineCalls();
    expect(await q.job(id, verb)).toEqual(OK);
    expect(q.snapshot()).toEqual(before);
    expect(engineCalls()).toEqual(callsBefore);
  });

  describe('a verb never starts in the tick it is enqueued', () => {
    const ROWS: [Verb, JobState, (q: Queue) => string, string, string][] = [
      ['pause', 'probing', () => String(media.stopped.length), '0', '1'],
      ['cancel', 'probing', () => String(media.discarded.length), '0', '1'],
      ['resume', 'paused', (q) => jobAt(q, 0).state, 'paused', 'probing'],
      ['retry', 'failed', (q) => jobAt(q, 0).state, 'failed', 'probing'],
      ['remove', 'done', (q) => String(q.snapshot().jobs.length), '1', '0'],
      ['removeWithFile', 'done', () => String(existsSync(join(dir, 'x.mp4'))), 'true', 'false'],
    ];

    it.each(ROWS)('%s on a %s job', async (verb, state, observe, before, after) => {
      writeFileSync(join(dir, 'x.mp4'), 'video');
      const { q, id } = reach(state);
      const pending = q.job(id, verb);
      expect(observe(q)).toBe(before);
      expect(await pending).toEqual(OK);
      expect(observe(q)).toBe(after);
    });

    it('a group verb', async () => {
      const q = build();
      q.add(playlist(2));
      const pending = q.group(groupAt(q).id, 'pause');
      expect(media.stopped).toEqual([]);
      expect(await pending).toEqual(OK);
      expect(media.stopped).toHaveLength(2);
    });

    it('pauseAll', async () => {
      const q = build();
      q.add(playlist(2));
      const pending = q.pauseAll();
      expect(media.stopped).toEqual([]);
      await pending;
      expect(media.stopped).toHaveLength(2);
    });
  });

  it('every verb answers ok with null when it does its work', async () => {
    writeFileSync(join(dir, 'x.mp4'), 'video');
    const q = build();
    q.add(video('Active'));
    q.add(video('Failing'));
    q.add(video('Finished'));
    q.add(video('Finished too'));
    const [active, failing, finishedOne, finishedTwo] = ids(q) as [string, string, string, string];
    media.emit(error(failing, 'disk full', false));
    media.emit(done(finishedOne));
    media.emit(done(finishedTwo));
    expect(await q.job(active, 'pause')).toEqual(OK);
    expect(await q.job(active, 'resume')).toEqual(OK);
    expect(await q.job(failing, 'retry')).toEqual(OK);
    expect(await q.job(finishedOne, 'remove')).toEqual(OK);
    expect(await q.job(finishedTwo, 'removeWithFile')).toEqual(OK);
    expect(await q.job(active, 'cancel')).toEqual(OK);
    expect(ids(q)).toEqual([failing]);
  });

  it('a verb for another job is not delayed by a pending stop', async () => {
    const q = build();
    q.add(video());
    q.add(fileReq());
    const [v, f] = ids(q) as [string, string];
    const release = holdStops(media);
    const slow = q.job(v, 'pause');
    const outcome = await Promise.race([q.job(f, 'pause'), tick().then(() => 'delayed')]);
    expect(outcome).toEqual(OK);
    expect(states(q)).toEqual(['probing', 'paused']);
    release();
    await slow;
    expect(states(q)).toEqual(['paused', 'paused']);
  });

  it('a verb for a job that is not stopping is not delayed by a pending stop of another job of the same engine', async () => {
    const q = build({ maxConcurrent: 1 });
    q.add(video('Running'));
    q.add(video('Waiting'));
    const [running, waiting] = ids(q) as [string, string];
    const release = holdStops(media);
    const slow = q.job(running, 'pause');
    const outcome = await Promise.race([q.job(waiting, 'pause'), tick().then(() => 'delayed')]);
    expect(outcome).toEqual(OK);
    expect(jobAt(q, 1).state).toBe('paused');
    expect(jobAt(q, 0).state).toBe('probing');
    release();
    await slow;
  });

  it('a group verb waits behind a pending verb of one of its members', async () => {
    const q = build();
    q.add(playlist(2));
    const [a, b] = ids(q) as [string, string];
    const gid = groupAt(q).id;
    const release = holdStops();
    const single = q.job(a, 'pause');
    const group = q.group(gid, 'pause');
    await tick();
    expect([...media.stopped].sort()).toEqual([a, b].sort()); // b at once, a once
    release();
    expect(await group).toEqual(OK);
    await single;
    expect(states(q)).toEqual(['paused', 'paused']);
    expect(media.stopped).toHaveLength(2);
  });

  it('pauseAll waits behind a pending verb of one of the jobs', async () => {
    const q = build({ maxConcurrent: 1 });
    q.add(playlist(2));
    const [a] = ids(q) as [string, string];
    const release = holdStops();
    const single = q.job(a, 'pause');
    const all = q.pauseAll();
    await tick();
    expect(media.stopped).toEqual([a]);
    expect(jobAt(q, 1).state).toBe('paused'); // a job without a process is not held back
    release();
    await Promise.all([single, all]);
    expect(states(q)).toEqual(['paused', 'paused']);
    expect(media.stopped).toEqual([a]);
    expect(media.started).toHaveLength(1);
  });
});

describe('a stop that is not confirmed (7.2)', () => {
  const KINDS = ['media', 'file'] as const;
  type Kind = (typeof KINDS)[number];
  const engineOf = (kind: Kind): FakeEngine => (kind === 'media' ? media : file);
  const request = (kind: Kind, n: number): AddRequest => (kind === 'media' ? video(`Video ${n}`) : fileReq(`file${n}.zip`));

  /** maxConcurrent 1 and two jobs of the kind: the first runs and holds the only slot, the second waits. */
  function twoJobs(kind: Kind): { q: Queue; first: string; second: string } {
    const q = build({ maxConcurrent: 1 });
    q.add(request(kind, 1));
    q.add(request(kind, 2));
    return { q, first: jobAt(q, 0).id, second: jobAt(q, 1).id };
  }

  it('pause reports failure and keeps the slot when the stop is not confirmed', async () => {
    const { q, first } = twoJobs('media');
    media.stopFails.add(first);
    expect(await q.job(first, 'pause')).toEqual({ ok: false, error: PAUSE_NOT_CONFIRMED });
    expect(states(q)).toEqual(['probing', 'queued']);
    expect(media.started).toHaveLength(1);
  });

  it('pause reports failure and keeps the slot when the stop of a file download is not confirmed', async () => {
    const { q, first } = twoJobs('file');
    file.stopFails.add(first);
    expect(await q.job(first, 'pause')).toEqual({ ok: false, error: PAUSE_NOT_CONFIRMED });
    expect(states(q)).toEqual(['probing', 'queued']);
    expect(file.started).toHaveLength(1);
  });

  it.each(KINDS.flatMap((kind) => (['probing', 'downloading'] as const).map((state) => [kind, state] as const)))(
    'a failed pause leaves a %s job that is %s exactly as it was, and its events still count',
    async (kind, state) => {
      const { q, first } = twoJobs(kind);
      const engine = engineOf(kind);
      if (state === 'downloading') engine.emit(progress(first, 40));
      const before = jobAt(q, 0);
      engine.stopFails.add(first);
      expect((await q.job(first, 'pause')).ok).toBe(false);
      expect(jobAt(q, 0)).toEqual(before);
      // The engine keeps reporting a job whose stop was not confirmed, and the job is still active, so the events apply.
      engine.emit(progress(first, 70));
      expect(jobAt(q, 0)).toMatchObject({ state: 'downloading', bytesDone: 70 });
      engine.emit(done(first, 'x.bin'));
      expect(states(q)).toEqual(['done', 'probing']);
    },
  );

  it.each(KINDS)('a pause that failed can be tried again once the engine can stop the %s job', async (kind) => {
    const { q, first } = twoJobs(kind);
    const engine = engineOf(kind);
    engine.stopFails.add(first);
    expect((await q.job(first, 'pause')).ok).toBe(false);
    engine.stopFails.delete(first);
    expect(await q.job(first, 'pause')).toEqual(OK);
    expect(states(q)).toEqual(['paused', 'probing']); // now the slot is free
  });

  it('cancel keeps the row when the stop is not confirmed', async () => {
    const { q, first } = twoJobs('media');
    media.stopFails.add(first);
    expect(await q.job(first, 'cancel')).toEqual({ ok: false, error: CANCEL_NOT_CONFIRMED });
    expect(media.discarded).toEqual([first]);
    expect(states(q)).toEqual(['probing', 'queued']); // the row stays and so does the slot
    expect(media.started).toHaveLength(1);
  });

  it('cancel keeps the row when the stop of a file download is not confirmed', async () => {
    const { q, first } = twoJobs('file');
    file.stopFails.add(first);
    expect(await q.job(first, 'cancel')).toEqual({ ok: false, error: CANCEL_NOT_CONFIRMED });
    expect(file.discarded).toEqual([first]);
    expect(states(q)).toEqual(['probing', 'queued']);
    expect(file.started).toHaveLength(1);
  });

  it.each(KINDS)('a cancel that failed can be tried again once the engine can stop the %s job', async (kind) => {
    const { q, first, second } = twoJobs(kind);
    const engine = engineOf(kind);
    engine.stopFails.add(first);
    expect((await q.job(first, 'cancel')).ok).toBe(false);
    engine.stopFails.delete(first);
    expect(await q.job(first, 'cancel')).toEqual(OK);
    expect(ids(q)).toEqual([second]);
    expect(states(q)).toEqual(['probing']);
  });

  it('a group pause pauses the members it can and reports the one it could not', async () => {
    const q = build();
    q.add(playlist(3));
    const [a, b, c] = ids(q) as [string, string, string];
    media.stopFails.add(b);
    expect(await q.group(groupAt(q).id, 'pause')).toEqual({ ok: false, error: PAUSE_NOT_CONFIRMED });
    expect(states(q)).toEqual(['paused', 'probing', 'paused']);
    expect([...media.stopped].sort()).toEqual([a, b, c].sort()); // every member was tried
  });

  it('a group pause where every member could not be stopped reports the error and keeps them all running', async () => {
    const q = build();
    q.add(playlist(2));
    for (const id of ids(q)) media.stopFails.add(id);
    expect(await q.group(groupAt(q).id, 'pause')).toEqual({ ok: false, error: PAUSE_NOT_CONFIRMED });
    expect(states(q)).toEqual(['probing', 'probing']);
  });

  it('a group verb answers ok when every member could do it', async () => {
    const q = build();
    q.add(playlist(2));
    const gid = groupAt(q).id;
    expect(await q.group(gid, 'pause')).toEqual(OK);
    expect(await q.group(gid, 'resume')).toEqual(OK);
    expect(await q.group(gid, 'cancel')).toEqual(OK);
  });

  it('pauseAll does not reject when a stop is not confirmed, and that job keeps its slot', async () => {
    const q = build({ maxConcurrent: 1 });
    q.add(playlist(3));
    const [a] = ids(q) as [string, string, string];
    media.stopFails.add(a);
    await q.pauseAll();
    expect(states(q)).toEqual(['probing', 'paused', 'paused']);
    expect(media.started).toHaveLength(1);
  });

  it('a group cancel keeps the group while a member could not be cancelled', async () => {
    const q = build();
    q.add(playlist(2));
    const [a, b] = ids(q) as [string, string];
    const gid = groupAt(q).id;
    media.stopFails.add(b);
    expect(await q.group(gid, 'cancel')).toEqual({ ok: false, error: CANCEL_NOT_CONFIRMED });
    expect(media.discarded.sort()).toEqual([a, b].sort()); // every member was tried
    expect(ids(q)).toEqual([b]);
    expect(jobAt(q, 0).groupId).toBe(gid);
    expect(q.snapshot().groups.map((g) => g.id)).toEqual([gid]);
    expect(saves.at(-1)?.groups.map((g) => g.id)).toEqual([gid]);
    expect(loadedLastSave()).not.toBeNull();
  });

  it('a group cancel keeps the group and every row when no member could be cancelled', async () => {
    const q = build();
    q.add(playlist(2));
    for (const id of ids(q)) media.stopFails.add(id);
    expect((await q.group(groupAt(q).id, 'cancel')).ok).toBe(false);
    expect(q.snapshot().jobs).toHaveLength(2);
    expect(q.snapshot().groups).toHaveLength(1);
    expect(loadedLastSave()).not.toBeNull();
  });

  it('a group cancel removes the finished members rows and keeps the group for the member that stays', async () => {
    const q = build();
    q.add(playlist(3));
    const [a, b, c] = ids(q) as [string, string, string];
    media.emit(done(a));
    media.stopFails.add(c);
    expect((await q.group(groupAt(q).id, 'cancel')).ok).toBe(false);
    expect(ids(q)).toEqual([c]);
    expect(q.snapshot().groups).toHaveLength(1);
    expect(media.discarded.sort()).toEqual([b, c].sort());
    expect(loadedLastSave()).not.toBeNull();
  });

  it('a group cancel that failed can be repeated, and then the group goes with its last member', async () => {
    const q = build();
    q.add(playlist(2));
    const [, b] = ids(q) as [string, string];
    const gid = groupAt(q).id;
    media.stopFails.add(b);
    expect((await q.group(gid, 'cancel')).ok).toBe(false);
    media.stopFails.delete(b);
    expect(await q.group(gid, 'cancel')).toEqual(OK);
    expect(q.snapshot()).toEqual({ jobs: [], groups: [] });
    expect(saves.at(-1)).toEqual({ jobs: [], groups: [] });
  });

  it('a job cancel that failed for the last member of a group keeps the group too', async () => {
    const q = build();
    q.add(playlist(1));
    const only = jobAt(q, 0).id;
    media.stopFails.add(only);
    expect((await q.job(only, 'cancel')).ok).toBe(false);
    expect(q.snapshot().groups).toHaveLength(1);
    expect(loadedLastSave()).not.toBeNull();
  });
});

describe('the retry wait token (7.3)', () => {
  const KINDS = ['media', 'file'] as const;
  const request = (kind: (typeof KINDS)[number]): AddRequest => (kind === 'media' ? video() : fileReq());
  const retryable = (id: string): EngineEvent => error(id, 'HTTP Error 503', true);

  it('an old retry timer cannot release a newer wait', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit(retryable(id));
    expect(timers.map((t) => t.ms)).toContain(5000);
    await q.job(id, 'pause');
    await q.job(id, 'resume');
    expect(media.started).toHaveLength(2);
    media.emit(retryable(id));
    expect(jobAt(q, 0)).toMatchObject({ state: 'queued', attempts: 2 });
    expect(timers.map((t) => t.ms)).toContain(20000);

    fire(5000); // the timer of the first wait
    expect(jobAt(q, 0).state).toBe('queued');
    expect(media.started).toHaveLength(2);
    fire(20000);
    expect(jobAt(q, 0).state).toBe('probing');
    expect(media.started).toHaveLength(3);
  });

  it.each(KINDS)('an old retry timer cannot release a newer wait, whichever timer fires first (%s)', async (kind) => {
    const engine = kind === 'media' ? media : file;
    const q = build();
    q.add(request(kind));
    const id = jobAt(q, 0).id;
    engine.emit(retryable(id));
    await q.job(id, 'pause');
    await q.job(id, 'resume');
    engine.emit(retryable(id));
    fire(20000); // the newer timer first: the job starts
    expect(jobAt(q, 0).state).toBe('probing');
    expect(engine.started).toHaveLength(3);
    fire(5000); // then the old one: it must not start the job a second time
    expect(jobAt(q, 0).state).toBe('probing');
    expect(engine.started).toHaveLength(3);
  });

  it.each(KINDS)('the timer of the current wait still releases it (%s)', (kind) => {
    const engine = kind === 'media' ? media : file;
    const q = build();
    q.add(request(kind));
    engine.emit(retryable(jobAt(q, 0).id));
    expect(jobAt(q, 0).state).toBe('queued');
    fire(5000);
    expect(jobAt(q, 0).state).toBe('probing');
    expect(engine.started).toHaveLength(2);
  });

  it.each(KINDS)('a retry timer firing after cancel does nothing (%s)', async (kind) => {
    const engine = kind === 'media' ? media : file;
    const q = build();
    q.add(request(kind));
    const id = jobAt(q, 0).id;
    engine.emit(retryable(id));
    expect(await q.job(id, 'cancel')).toEqual(OK);
    expect(() => fire(5000)).not.toThrow();
    expect(engine.started).toHaveLength(1);
    expect(q.snapshot().jobs).toEqual([]);
  });
});

describe('transition, save, then start; save failures (7.4)', () => {
  const KINDS = ['media', 'file'] as const;
  type Kind = (typeof KINDS)[number];
  const request = (kind: Kind): AddRequest => (kind === 'media' ? video() : fileReq());
  const retryTimers = (): Timer[] => timers.filter((t) => t.ms === SAVE_RETRY);

  /** What the last save held for the starting job at the moment each start of `engine` happened. */
  function watchStarts(engine: FakeEngine): (JobState | undefined)[] {
    const seen: (JobState | undefined)[] = [];
    const original = engine.start.bind(engine);
    engine.start = (job, ctx) => {
      seen.push(saves.at(-1)?.jobs.find((j) => j.id === job.id)?.state);
      original(job, ctx);
    };
    return seen;
  }

  it('writes the started state before starting the engine', () => {
    const q = build();
    log.length = 0;
    q.add(video());
    expect(log).toContain('start');
    expect(log.slice(0, log.indexOf('start')).at(-1)).toBe('save');
    expect(saves.at(-1)?.jobs[0]).toMatchObject({ state: 'probing' });
  });

  describe('whatever starts a job has saved it as started first', () => {
    it('a new video', () => {
      const q = build();
      const seen = watchStarts(media);
      q.add(video());
      expect(seen).toEqual(['probing']);
    });

    it('a new file download', () => {
      const q = build();
      const seen = watchStarts(file);
      q.add(fileReq());
      expect(seen).toEqual(['probing']);
    });

    it('a waiting job that takes the slot of a finished one', () => {
      const q = build({ maxConcurrent: 1 });
      const seen = watchStarts(media);
      q.add(playlist(2));
      media.emit(done(jobAt(q, 0).id));
      expect(seen).toEqual(['probing', 'probing']);
    });

    it('a resumed job', async () => {
      const q = build();
      const seen = watchStarts(media);
      q.add(video());
      await q.job(jobAt(q, 0).id, 'pause');
      await q.job(jobAt(q, 0).id, 'resume');
      expect(seen).toEqual(['probing', 'probing']);
    });

    it('a job paused earlier that resumeAllPaused resumes', async () => {
      const q = build({}, { jobs: [makeJob({ id: 'p', state: 'paused', dir, baseName: 'p' })], groups: [] });
      const seen = watchStarts(media);
      q.resumeAllPaused();
      await tick();
      expect(seen).toEqual(['probing']);
    });

    it('a retried job', async () => {
      const q = build();
      const seen = watchStarts(media);
      q.add(video());
      media.emit(error(jobAt(q, 0).id, 'disk full', false));
      await q.job(jobAt(q, 0).id, 'retry');
      expect(seen).toEqual(['probing', 'probing']);
    });

    it('a job whose retry delay is over', () => {
      const q = build();
      const seen = watchStarts(media);
      q.add(video());
      media.emit(error(jobAt(q, 0).id, 'HTTP Error 503', true));
      fire(5000);
      expect(seen).toEqual(['probing', 'probing']);
    });

    it('a job that a new slot count lets in', () => {
      const q = build({ maxConcurrent: 1 });
      const seen = watchStarts(media);
      q.add(playlist(2));
      q.setSettings(makeSettings({ maxConcurrent: 2 }));
      expect(seen).toEqual(['probing', 'probing']);
    });

    it('a video restarted for a new speed limit', async () => {
      const q = build();
      const seen = watchStarts(media);
      q.add(video());
      q.setSettings(makeSettings({ speedLimitKbps: 300 }));
      await tick();
      expect(seen).toEqual(['probing', 'probing']);
    });
  });

  describe('a save that fails', () => {
    it('does not stop the download and add does not throw', () => {
      const q = build();
      const told = saveStates(q);
      saveFails.on = true;
      expect(() => q.add(video())).not.toThrow();
      expect(media.started).toHaveLength(1);
      expect(jobAt(q, 0).state).toBe('probing');
      expect(told).toEqual([null, saveMessage('disk full')]);
    });

    it.each(KINDS)('does not stop a %s download either, and the window is still told', (kind) => {
      const q = build();
      saveFails.on = true;
      const before = changes;
      expect(() => q.add(request(kind))).not.toThrow();
      expect((kind === 'media' ? media : file).started).toHaveLength(1);
      expect(changes).toBeGreaterThan(before);
    });

    const EVENTS: [string, (id: string) => EngineEvent, JobState][] = [
      ['the first progress', (id) => progress(id), 'downloading'],
      ['merging', (id) => ({ jobId: id, type: 'merging' }), 'merging'],
      ['done', (id) => done(id, 'Talk.mp4'), 'done'],
      ['a retryable error', (id) => error(id, 'HTTP Error 503', true), 'queued'],
      ['a final error', (id) => error(id, 'disk full', false), 'failed'],
      ['a skip', (id) => error(id, 'private', false, 'skipped'), 'skipped'],
      ['a name that cannot be saved', (id) => ({ jobId: id, type: 'done', fileName: '..', actualHeight: null }), 'failed'],
      ['a height', (id) => ({ jobId: id, type: 'probed', sourceHeight: 1080 }), 'probing'],
    ];

    it.each(KINDS.flatMap((kind) => EVENTS.map(([label, make, state]) => [kind, label, make, state] as const)))(
      'inside an engine event is caught: a %s job, %s',
      (kind, _label, make, state) => {
        const q = build();
        q.add(request(kind));
        const id = jobAt(q, 0).id;
        saveFails.on = true;
        expect(() => (kind === 'media' ? media : file).emit(make(id))).not.toThrow();
        expect(jobAt(q, 0).state).toBe(state);
      },
    );

    it('inside a progress tick and inside a retry timer is caught', () => {
      const q = build();
      q.add(video());
      const id = jobAt(q, 0).id;
      media.emit(progress(id));
      saveFails.on = true;
      clock += 5001; // the next plain progress is due for a save
      expect(() => media.emit(progress(id, 50))).not.toThrow();
      expect(jobAt(q, 0).bytesDone).toBe(50);
      media.emit(error(id, 'HTTP Error 503', true));
      expect(() => fire(5000)).not.toThrow();
      expect(jobAt(q, 0).state).toBe('probing');
    });

    it('does not make a verb, a group verb, pauseAll, resumeAllPaused or a settings change fail', async () => {
      const q = build();
      q.add(playlist(2));
      const [a] = ids(q) as [string, string];
      saveFails.on = true;
      expect(await q.job(a, 'pause')).toEqual(OK);
      expect(await q.job(a, 'resume')).toEqual(OK);
      expect(await q.group(groupAt(q).id, 'pause')).toEqual(OK);
      await q.pauseAll();
      q.resumeAllPaused();
      expect(() => q.setSettings(makeSettings({ maxConcurrent: 2 }))).not.toThrow();
      await tick();
      expect(states(q)).toEqual(['probing', 'probing']);
    });
  });

  it('a listener is told the current state when it is added', () => {
    const q = build();
    const told: (string | null)[] = [];
    q.onSaveState((state) => {
      told.push(state);
    });
    expect(told).toEqual([null]);
  });

  it('a save that failed in the constructor reaches a listener added later', () => {
    saveFails.on = true;
    const q = build();
    const told = saveStates(q);
    expect(told).toEqual([saveMessage('disk full')]);
  });

  it('tells listeners once per message, and null after the next good save', () => {
    const q = build();
    const first = saveStates(q);
    saveFails.on = true;
    q.add(video('One')); // fails: the first message
    q.add(video('Two')); // fails with the same message: not told again
    saveFails.message = 'access denied';
    q.add(video('Three')); // a different message: told
    const second = saveStates(q); // added while the error is set: told at once
    saveFails.on = false;
    q.add(video('Four')); // a good save: null
    q.add(video('Five')); // good again: nothing new to tell
    expect(first).toEqual([null, saveMessage('disk full'), saveMessage('access denied'), null]);
    expect(second).toEqual([saveMessage('access denied'), null]);
  });

  describe('retrying the save', () => {
    it('is SAVE_RETRY_MS, 60000 ms', () => {
      expect(SAVE_RETRY_MS).toBe(60000);
    });

    it('leaves exactly one pending retry timer while saves fail, and the timer saves again', () => {
      saveFails.on = true;
      const q = build(); // the first save fails in the constructor
      expect(retryTimers()).toHaveLength(1);
      q.add(video('One'));
      q.add(video('Two')); // more failures while one timer is pending
      expect(retryTimers()).toHaveLength(1);

      const attempts = saveAttempts();
      fire(SAVE_RETRY); // the timer writes; the disk still fails
      expect(saveAttempts()).toBe(attempts + 1);
      expect(retryTimers()).toHaveLength(1); // exactly one waits again

      saveFails.on = false;
      const told = saveStates(q);
      fire(SAVE_RETRY);
      expect(saveAttempts()).toBe(attempts + 2);
      expect(saves).toHaveLength(1); // the first save that worked is the retry
      expect(saves.at(-1)?.jobs.map((j) => j.title)).toEqual(['One', 'Two']);
      expect(told).toEqual([saveMessage('disk full'), null]); // told at once when added, then when the retry worked
      expect(retryTimers()).toEqual([]);
    });

    it('tells the listeners null when the retry works', () => {
      saveFails.on = true;
      const q = build();
      const told = saveStates(q);
      saveFails.on = false;
      fire(SAVE_RETRY);
      expect(told).toEqual([saveMessage('disk full'), null]);
    });

    it('writes nothing else while the disk keeps failing and nothing changes: only the timer writes', async () => {
      saveFails.on = true;
      build();
      const attempts = saveAttempts();
      await tick();
      await tick();
      expect(saveAttempts()).toBe(attempts);
      fire(SAVE_RETRY);
      expect(saveAttempts()).toBe(attempts + 1);
    });

    it('saves the state of the moment the timer fires, not the state of the first failure', () => {
      saveFails.on = true;
      const q = build();
      q.add(video('Late'));
      saveFails.on = false;
      fire(SAVE_RETRY);
      expect(saves.at(-1)?.jobs).toHaveLength(1);
      expect(saves.at(-1)?.jobs[0]).toMatchObject({ title: 'Late', state: 'probing' });
      expect(loadedLastSave()).not.toBeNull();
    });
  });
});

describe('one speed budget (7.5)', () => {
  /** Applies the speed limit and slot count; every other setting keeps the helper's default. */
  const set = (q: Queue, kbps: number, max = 3): void => q.setSettings(makeSettings({ speedLimitKbps: kbps, maxConcurrent: max }));
  const limitsOf = (engine: FakeEngine): (number | null | undefined)[] => engine.started.map((s) => s.ctx.rateLimitBytes);

  it('a new limit restarts videos that are downloading and re-limits files', async () => {
    const q = build();
    q.add(video());
    q.add(fileReq());
    const [v, f] = ids(q) as [string, string];
    media.emit(progress(v, 40));
    file.emit(progress(f, 10));
    set(q, 300);
    await tick();
    expect(media.stopped).toEqual([v]);
    expect(media.started).toHaveLength(2);
    expect(media.started[1]?.ctx.rateLimitBytes).toBe(102400);
    expect(media.started[1]?.job.bytesDone).toBe(40);
    expect(jobAt(q, 0)).toMatchObject({ state: 'probing', bytesDone: 40, attempts: 0, reason: null });
    expect(file.rateLimits).toEqual([[f, 102400]]);
    expect(file.stopped).toEqual([]);
    expect(file.started).toHaveLength(1);
  });

  it.each(['probing', 'downloading'] as const)('a new limit restarts a video that is %s, and not in the tick it was set', async (state) => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    if (state === 'downloading') media.emit(progress(id, 40));
    set(q, 300);
    expect(media.stopped).toEqual([]);
    await tick();
    expect(media.stopped).toEqual([id]);
    expect(media.started).toHaveLength(2);
    expect(media.started[1]?.ctx.rateLimitBytes).toBe(102400);
  });

  it('leaves a merging job alone when the limit changes', async () => {
    const q = build();
    q.add(video('Merging'));
    q.add(video('Downloading'));
    const [m, d] = ids(q) as [string, string];
    media.emit(progress(m));
    media.emit({ jobId: m, type: 'merging' });
    media.emit(progress(d));
    set(q, 300);
    await tick();
    expect(media.stopped).toEqual([d]); // the merging video is not touched
    expect(jobAt(q, 0).state).toBe('merging');
    expect(media.started).toHaveLength(3);
    expect(media.started.filter((s) => s.job.id === m)).toHaveLength(1);
  });

  it('lowering the slot count with three active changes no limit', async () => {
    const q = build({ speedLimitKbps: 900, maxConcurrent: 3 });
    q.add(video('A'));
    q.add(video('B'));
    q.add(fileReq());
    expect(limitsOf(media)).toEqual([307200, 307200]);
    expect(limitsOf(file)).toEqual([307200]);
    set(q, 900, 1);
    await tick();
    expect(media.stopped).toEqual([]);
    expect(file.stopped).toEqual([]);
    expect(file.rateLimits).toEqual([]);
    expect(media.started).toHaveLength(2);
  });

  it('raising the slot count lowers the running job to its new share', async () => {
    const q = build({ speedLimitKbps: 900, maxConcurrent: 1 });
    q.add(video('A'));
    const id = jobAt(q, 0).id;
    expect(media.started[0]?.ctx.rateLimitBytes).toBe(921600);
    set(q, 900, 3);
    await tick();
    expect(media.stopped).toEqual([id]);
    expect(media.started[1]?.ctx.rateLimitBytes).toBe(307200);
    q.add(video('B'));
    q.add(video('C'));
    expect(limitsOf(media).slice(1)).toEqual([307200, 307200, 307200]);
    expect(media.started).toHaveLength(4);
  });

  it('raising the slot count lowers a running file download through the file engine', async () => {
    const q = build({ speedLimitKbps: 900, maxConcurrent: 1 });
    q.add(fileReq());
    const id = jobAt(q, 0).id;
    expect(file.started[0]?.ctx.rateLimitBytes).toBe(921600);
    set(q, 900, 3);
    await tick();
    expect(file.rateLimits).toEqual([[id, 307200]]);
    expect(file.stopped).toEqual([]);
    expect(file.started).toHaveLength(1);
    q.add(fileReq());
    expect(file.started[1]?.ctx.rateLimitBytes).toBe(307200);
  });

  it('divides by the number of active jobs when more run than the slot count allows', async () => {
    const q = build({ speedLimitKbps: 900, maxConcurrent: 3 });
    q.add(fileReq());
    q.add(fileReq());
    q.add(fileReq());
    set(q, 600, 2); // three still run: the divisor stays three, not two
    await tick();
    expect(file.rateLimits.map(([, n]) => n)).toEqual([204800, 204800, 204800]);
    expect(new Set(file.rateLimits.map(([id]) => id)).size).toBe(3);
  });

  it('does not raise the share of the running jobs when the active count merely drops', async () => {
    const q = build({ speedLimitKbps: 900, maxConcurrent: 3 });
    q.add(video('A'));
    q.add(video('B'));
    q.add(fileReq());
    const [a] = ids(q) as [string, string, string];
    media.emit(done(a));
    await tick();
    expect(media.stopped).toEqual([]);
    expect(file.rateLimits).toEqual([]);
    q.add(video('D')); // a later start still gets the share of three
    expect(media.started.at(-1)?.ctx.rateLimitBytes).toBe(307200);
  });

  it('lowering the slot count and then finishing jobs does not raise the share of the jobs still running', async () => {
    const q = build({ speedLimitKbps: 900, maxConcurrent: 3 });
    q.add(video('A'));
    q.add(video('B'));
    q.add(fileReq());
    const [a, b, f] = ids(q) as [string, string, string];
    set(q, 900, 1); // three still run: the share stays 307200
    media.emit(done(a)); // dividing by the two that are left would give each 460800
    media.emit(done(b)); // dividing by the one that is left would give 921600
    await tick();
    expect(media.stopped).toEqual([]);
    expect(file.rateLimits).toEqual([]);
    expect(media.started).toHaveLength(2);
    file.emit(done(f, 'a.zip'));
    q.add(video('C')); // alone, with one slot: it gets the whole limit
    expect(media.started.at(-1)?.ctx.rateLimitBytes).toBe(921600);
  });

  it('two quick limit changes restart a video once', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    set(q, 300);
    set(q, 600);
    await tick();
    expect(media.stopped).toEqual([id]); // one stop is pending; the second change waits behind it
    release();
    await tick();
    expect(media.stopped).toEqual([id]);
    expect(media.started).toHaveLength(2);
    expect(media.started[1]?.ctx.rateLimitBytes).toBe(204800); // the share of 600, not of 300
    expect(jobAt(q, 0).state).toBe('probing');
  });

  it('a limit changed and changed back restarts nothing', async () => {
    const q = build({ speedLimitKbps: 600 });
    q.add(video());
    q.add(fileReq());
    set(q, 300);
    set(q, 600);
    await tick();
    expect(media.stopped).toEqual([]);
    expect(media.started).toHaveLength(1);
    // The file download ends up with the limit it started with.
    const effective = file.rateLimits.at(-1)?.[1] ?? file.started[0]?.ctx.rateLimitBytes;
    expect(effective).toBe(204800);
    expect(file.stopped).toEqual([]);
  });

  it('a pause issued during a limit restart wins', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    set(q, 300);
    const pause = q.job(id, 'pause');
    await tick();
    release();
    expect(await pause).toEqual(OK);
    expect(jobAt(q, 0).state).toBe('paused');
  });

  it('a limit restart that is queued behind a pause finds the video paused and does nothing', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    const pause = q.job(id, 'pause');
    await tick();
    set(q, 300);
    release();
    await pause;
    await tick();
    expect(jobAt(q, 0).state).toBe('paused');
    expect(media.stopped).toEqual([id]);
    expect(media.started).toHaveLength(1);
  });

  it('a limit restart whose stop is not confirmed leaves the video running', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.stopFails.add(id);
    set(q, 300);
    await tick();
    expect(jobAt(q, 0).state).toBe('probing');
    expect(media.started).toHaveLength(1);
    expect(media.stopped).toEqual([id]);
    expect(finished).toEqual([]);
  });

  it('the next settings change tries the restart again', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.stopFails.add(id);
    set(q, 300);
    await tick();
    media.stopFails.delete(id);
    set(q, 600);
    await tick();
    expect(media.stopped).toEqual([id, id]);
    expect(media.started).toHaveLength(2);
    expect(media.started[1]?.ctx.rateLimitBytes).toBe(204800);
  });

  it('takes a limit away from running jobs too', async () => {
    const q = build({ speedLimitKbps: 300 });
    q.add(video());
    q.add(fileReq());
    const [v, f] = ids(q) as [string, string];
    set(q, 0);
    await tick();
    expect(media.stopped).toEqual([v]);
    expect(media.started[1]?.ctx.rateLimitBytes).toBeNull();
    expect(file.rateLimits).toEqual([[f, null]]);
  });

  it('does nothing more when the same settings arrive again after they were applied', async () => {
    const q = build();
    q.add(video());
    q.add(fileReq());
    set(q, 300);
    await tick();
    set(q, 300);
    await tick();
    expect(media.stopped).toHaveLength(1);
    expect(media.started).toHaveLength(2);
    expect(file.rateLimits).toHaveLength(1);
  });

  it.each([
    [900, 3, 307200],
    [200, 3, 68266], // 68266.67: cut down, not rounded
    [100, 3, 34133],
    [1, 8, 128],
    [8, 8, 1024],
    [0.0001, 3, 1], // never 0: a limit of 0 bytes means no limit to the engines
  ])('a limit of %s KB/s over %s slots gives each job %s bytes/s, to both engines', (kbps, slots, bytes) => {
    const q = build({ speedLimitKbps: kbps, maxConcurrent: slots });
    q.add(video());
    q.add(fileReq());
    expect(media.started[0]?.ctx.rateLimitBytes).toBe(bytes);
    expect(file.started[0]?.ctx.rateLimitBytes).toBe(bytes);
  });

  it('a resumed job starts at the share of the settings of that moment', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    await q.job(id, 'pause');
    set(q, 300);
    await tick();
    expect(media.stopped).toEqual([id]); // only the pause: a paused job is not restarted
    await q.job(id, 'resume');
    expect(media.started[1]?.ctx.rateLimitBytes).toBe(102400);
  });

  it('survives a failing setRateLimit', async () => {
    file.setRateLimit = async () => {
      throw new Error('aria2 down');
    };
    const q = build();
    q.add(fileReq());
    const id = jobAt(q, 0).id;
    set(q, 100);
    await tick();
    expect(jobAt(q, 0).state).toBe('probing');
    file.emit(done(id, 'a.zip'));
    expect(jobAt(q, 0).state).toBe('done');
  });

  describe('a limit counts as sent only when aria2 confirms it (F3)', () => {
    const FAILURES: [string, () => Promise<boolean>][] = [
      ['resolves false', () => Promise.resolve(false)],
      ['rejects', () => Promise.reject(new Error('aria2 down'))],
      [
        'throws synchronously',
        () => {
          throw new Error('aria2 down');
        },
      ],
    ];

    it.each(FAILURES)('an identical save sends the limit again when setRateLimit %s', async (_name, answer) => {
      const q = build();
      q.add(fileReq());
      const id = jobAt(q, 0).id;
      const calls: [string, number | null][] = [];
      file.setRateLimit = (jobId, n) => {
        calls.push([jobId, n]);
        return answer();
      };
      set(q, 300);
      await tick();
      expect(calls).toEqual([[id, 102400]]);
      set(q, 300);
      await tick();
      expect(calls).toEqual([
        [id, 102400],
        [id, 102400],
      ]);
      expect(jobAt(q, 0).state).toBe('probing');
    });

    it('a value other than true counts as not confirmed', async () => {
      const q = build();
      q.add(fileReq());
      const id = jobAt(q, 0).id;
      const calls: [string, number | null][] = [];
      file.setRateLimit = (jobId, n) => {
        calls.push([jobId, n]);
        return Promise.resolve(undefined as unknown as boolean);
      };
      set(q, 300);
      await tick();
      set(q, 300);
      await tick();
      expect(calls).toEqual([
        [id, 102400],
        [id, 102400],
      ]);
    });

    it('an identical save does not resend a limit aria2 confirmed', async () => {
      const q = build();
      q.add(fileReq());
      const id = jobAt(q, 0).id;
      set(q, 300);
      await tick();
      set(q, 300);
      await tick();
      set(q, 300);
      await tick();
      expect(file.rateLimits).toEqual([[id, 102400]]);
    });

    it('a late failure of an older limit does not wipe a newer confirmed one', async () => {
      const q = build();
      q.add(fileReq());
      const id = jobAt(q, 0).id;
      const calls: [string, number | null][] = [];
      let failFirst: (ok: boolean) => void = () => undefined;
      file.setRateLimit = (jobId, n) => {
        calls.push([jobId, n]);
        if (calls.length === 1) return new Promise<boolean>((resolve) => (failFirst = resolve));
        return Promise.resolve(true);
      };
      set(q, 300); // L1, pending
      set(q, 600); // L2, confirmed
      await tick();
      failFirst(false); // L1 fails late
      await tick();
      set(q, 600);
      await tick();
      expect(calls).toEqual([
        [id, 102400],
        [id, 204800],
      ]);
    });

    it('a failed limit is resent with the share of the settings of the next save', async () => {
      const q = build();
      q.add(fileReq());
      const id = jobAt(q, 0).id;
      const answers = [false, true];
      file.setRateLimit = async (jobId, n) => {
        file.rateLimits.push([jobId, n]);
        return answers.shift() ?? true;
      };
      set(q, 300);
      await tick();
      set(q, 600);
      await tick();
      set(q, 600);
      await tick();
      expect(file.rateLimits).toEqual([
        [id, 102400],
        [id, 204800],
      ]);
    });
  });
});

describe('shutdown (7.6)', () => {
  const VERBS = ['pause', 'resume', 'cancel', 'retry', 'remove', 'removeWithFile'] as const;
  const GROUP_VERBS = ['pause', 'resume', 'cancel'] as const;

  it('shutdown stops every active job, including one that is merging', async () => {
    const q = build();
    q.add(playlist(3));
    const [a, b, c] = ids(q) as [string, string, string];
    media.emit(progress(b));
    media.emit({ jobId: c, type: 'merging' });
    expect(states(q)).toEqual(['probing', 'downloading', 'merging']);
    await q.shutdown();
    expect(states(q)).toEqual(['paused', 'paused', 'paused']);
    expect([...media.stopped].sort()).toEqual([a, b, c].sort());
    expect(q.snapshot().jobs.map((j) => [j.speed, j.eta, j.interrupted])).toEqual([
      [0, null, false],
      [0, null, false],
      [0, null, false],
    ]);
  });

  it('shutdown stops a file download through the file engine', async () => {
    const q = build();
    q.add(fileReq());
    q.add(video());
    const [f, v] = ids(q) as [string, string];
    await q.shutdown();
    expect(file.stopped).toEqual([f]);
    expect(media.stopped).toEqual([v]);
    expect(states(q)).toEqual(['paused', 'paused']);
  });

  it('shutdown leaves queued, paused and finished jobs as they are', async () => {
    const seedJobs = [
      makeJob({ id: 'paused', state: 'paused', dir, baseName: 'paused' }),
      makeJob({ id: 'done', state: 'done', dir, baseName: 'done', fileName: 'done.mp4' }),
      makeJob({ id: 'failed', state: 'failed', dir, baseName: 'failed', reason: 'disk full' }),
      makeJob({ id: 'skipped', state: 'skipped', dir, baseName: 'skipped', reason: 'private' }),
    ];
    const q = build({ maxConcurrent: 1 }, { jobs: seedJobs, groups: [] });
    q.add(video('Running'));
    q.add(video('Waiting'));
    const [running] = ids(q).slice(4) as [string, string];
    const before = q.snapshot().jobs.slice(0, 4);
    await q.shutdown();
    expect(media.stopped).toEqual([running]);
    expect(q.snapshot().jobs.slice(0, 4)).toEqual(before);
    expect(states(q).slice(4)).toEqual(['paused', 'queued']);
    expect(q.snapshot().jobs.map((j) => j.interrupted)).toEqual([false, false, false, false, false, false]);
  });

  it('shutdown with nothing running resolves and stops nothing', async () => {
    const q = build();
    q.add(video());
    media.emit(done(jobAt(q, 0).id));
    await expect(q.shutdown()).resolves.toBeUndefined();
    expect(media.stopped).toEqual([]);
    expect(file.stopped).toEqual([]);
  });

  it('shutdown saves the jobs as cut off before the engines have stopped', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    let resolved = false;
    const shutting = q.shutdown().then(() => {
      resolved = true;
    });
    await tick();
    expect(media.stopped).toEqual([id]);
    expect(log.slice(0, log.indexOf('stop')).at(-1)).toBe('save'); // the cut-off save came before the stop
    expect(saves.at(-1)?.jobs[0]).toMatchObject({ state: 'paused', interrupted: true });
    expect(loadedLastSave()).not.toBeNull();
    expect(resolved).toBe(false); // shutdown waits for the stops
    release();
    await shutting;
    expect(saves.at(-1)?.jobs[0]).toMatchObject({ state: 'paused', interrupted: false });
    expect(jobAt(q, 0)).toMatchObject({ state: 'paused', interrupted: false });
  });

  it.each(['media', 'file'] as const)('a stop that fails during shutdown leaves the %s job marked as cut off and shutdown still resolves', async (kind) => {
    const q = build();
    q.add(kind === 'media' ? video() : fileReq());
    q.add(kind === 'media' ? video('Other') : fileReq('other.zip'));
    const [bad] = ids(q) as [string, string];
    (kind === 'media' ? media : file).stopFails.add(bad);
    await expect(q.shutdown()).resolves.toBeUndefined();
    expect(q.snapshot().jobs.map((j) => [j.state, j.interrupted])).toEqual([
      ['paused', true],
      ['paused', false],
    ]);
    expect(saves.at(-1)?.jobs.map((j) => j.interrupted)).toEqual([true, false]);
    expect(loadedLastSave()).not.toBeNull();
  });

  it('a stop that fails during shutdown does not keep the other jobs marked', async () => {
    const q = build();
    q.add(video('A'));
    q.add(fileReq());
    const [a] = ids(q) as [string, string];
    media.stopFails.add(a);
    await q.shutdown();
    expect(q.snapshot().jobs.map((j) => j.interrupted)).toEqual([true, false]);
  });

  describe('while closed', () => {
    it('nothing starts after shutdown', async () => {
      const q = build({ maxConcurrent: 2 });
      q.add(playlist(3));
      const [a, b] = ids(q) as [string, string, string];
      media.emit(error(b, 'HTTP Error 503', true)); // b waits for its delay; the third item takes the slot
      await q.shutdown();
      const startsAtClose = media.started.length;
      media.emit(done(a)); // a late event for a job that was stopped
      fire(5000);
      expect(media.started).toHaveLength(startsAtClose);
      expect(states(q)).toEqual(['paused', 'queued', 'paused']);
      expect(await q.job(a, 'resume')).toEqual({ ok: false, error: CLOSING });
      expect(await q.job(b, 'resume')).toEqual({ ok: false, error: CLOSING });
      expect(media.started).toHaveLength(startsAtClose);
    });

    it('a retry timer does nothing', async () => {
      const q = build();
      q.add(video());
      media.emit(error(jobAt(q, 0).id, 'HTTP Error 503', true));
      await q.shutdown();
      const attempts = saveAttempts();
      fire(5000);
      expect(media.started).toHaveLength(1);
      expect(jobAt(q, 0).state).toBe('queued');
      expect(saveAttempts()).toBe(attempts);
    });

    it('the save retry timer does nothing', async () => {
      saveFails.on = true;
      const q = build();
      q.add(video());
      await q.shutdown();
      saveFails.on = false;
      const attempts = saveAttempts();
      fire(SAVE_RETRY);
      expect(saveAttempts()).toBe(attempts);
    });

    it('a late engine event changes nothing', async () => {
      const q = build();
      q.add(video());
      const id = jobAt(q, 0).id;
      await q.shutdown();
      const before = q.snapshot();
      const attempts = saveAttempts();
      media.emit(progress(id));
      media.emit(done(id));
      media.emit(error(id, 'disk full', false));
      media.emit({ jobId: id, type: 'probed', sourceHeight: 720 });
      expect(q.snapshot()).toEqual(before);
      expect(saveAttempts()).toBe(attempts);
    });

    it.each(VERBS)('job() answers that Fetchly is closing for %s and changes nothing', async (verb) => {
      const q = build();
      q.add(video());
      media.emit(done(jobAt(q, 0).id));
      q.add(video('Second'));
      await q.shutdown();
      const before = q.snapshot();
      expect(await q.job(jobAt(q, 0).id, verb)).toEqual({ ok: false, error: CLOSING });
      expect(await q.job(jobAt(q, 1).id, verb)).toEqual({ ok: false, error: CLOSING });
      expect(q.snapshot()).toEqual(before);
      expect(media.discarded).toEqual([]);
    });

    it.each(GROUP_VERBS)('group() answers that Fetchly is closing for %s and changes nothing', async (verb) => {
      const q = build();
      q.add(playlist(2));
      const gid = groupAt(q).id;
      await q.shutdown();
      const before = q.snapshot();
      expect(await q.group(gid, verb)).toEqual({ ok: false, error: CLOSING });
      expect(q.snapshot()).toEqual(before);
      expect(media.discarded).toEqual([]);
    });

    it('resumeAllPaused and a slot count that lets more in start nothing', async () => {
      const q = build({ maxConcurrent: 1 }, { jobs: [makeJob({ id: 'p', state: 'paused', dir, baseName: 'p' })], groups: [] });
      q.add(video('Running'));
      q.add(video('Waiting'));
      await q.shutdown();
      const starts = media.started.length;
      q.resumeAllPaused();
      q.setSettings(makeSettings({ maxConcurrent: 4 }));
      await tick();
      expect(media.started).toHaveLength(starts);
      expect(states(q)).not.toContain('probing');
    });

    it('a video added after shutdown is not started', async () => {
      const q = build();
      await q.shutdown();
      q.add(video());
      expect(media.started).toEqual([]);
    });
  });

  it('a resume waiting in the chain when shutdown starts does nothing', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    const pause = q.job(id, 'pause');
    const resume = q.job(id, 'resume');
    await tick();
    const shutting = q.shutdown();
    await tick();
    expect(jobAt(q, 0)).toMatchObject({ state: 'paused', interrupted: true }); // shutdown does not wait for the chain
    release();
    await shutting;
    expect(await pause).toEqual(OK); // the pause was already past its stop
    expect(await resume).toEqual({ ok: false, error: CLOSING });
    expect(jobAt(q, 0).state).toBe('paused');
    expect(media.started).toHaveLength(1);
  });

  it.each(['resume', 'cancel', 'retry', 'remove', 'removeWithFile'] as const)(
    'a %s waiting in the chain when shutdown starts does nothing and answers that Fetchly is closing',
    async (verb) => {
      const q = build();
      q.add(video());
      const id = jobAt(q, 0).id;
      const release = holdStops();
      const pause = q.job(id, 'pause');
      const waiting = q.job(id, verb);
      await tick();
      const shutting = q.shutdown();
      release();
      await shutting;
      await pause;
      expect(await waiting).toEqual({ ok: false, error: CLOSING });
      expect(q.snapshot().jobs).toHaveLength(1);
      expect(jobAt(q, 0).state).toBe('paused');
      expect(media.discarded).toEqual([]);
      expect(media.started).toHaveLength(1);
    },
  );

  it.each(GROUP_VERBS)('a group %s waiting in the chain when shutdown starts does nothing and answers that Fetchly is closing', async (verb) => {
    const q = build();
    q.add(playlist(2));
    const [a, b] = ids(q) as [string, string];
    const gid = groupAt(q).id;
    const release = holdStops();
    const pauses = [q.job(a, 'pause'), q.job(b, 'pause')]; // both members have a verb pending, so the group verb waits behind both
    const waiting = q.group(gid, verb);
    await tick();
    const shutting = q.shutdown();
    release();
    await shutting;
    await Promise.all(pauses);
    expect(await waiting).toEqual({ ok: false, error: CLOSING });
    expect(q.snapshot().jobs).toHaveLength(2);
    expect(media.discarded).toEqual([]);
    expect(states(q)).toEqual(['paused', 'paused']);
  });

  it('a pause already past its stop when shutdown starts finishes: it finds the job already paused', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    const pause = q.job(id, 'pause');
    await tick();
    expect(media.stopped).toEqual([id]); // the pause is waiting for its stop
    const shutting = q.shutdown();
    release();
    expect(await pause).toEqual(OK);
    await shutting;
    expect(jobAt(q, 0)).toMatchObject({ state: 'paused', interrupted: false });
    expect(media.started).toHaveLength(1);
  });

  it('a cancel already in flight at shutdown still removes its row', async () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    const release = holdStops();
    const cancel = q.job(id, 'cancel');
    await tick();
    expect(media.discarded).toEqual([id]); // the cancel is waiting for its discard
    const shutting = q.shutdown();
    release();
    expect(await cancel).toEqual(OK);
    await shutting;
    expect(q.snapshot().jobs).toEqual([]);
    expect(saves.at(-1)?.jobs).toEqual([]);
    expect(loadedLastSave()).not.toBeNull();
  });
});

describe('a failing listener never stops the queue (G1)', () => {
  const thrower = (): never => {
    throw new Error('listener broke');
  };

  /** A queue with an active video and an active file download: [video id, file id]. */
  function twoActive(): { q: Queue; v: string; f: string } {
    const q = build();
    q.add(video());
    q.add(fileReq());
    const v = q.snapshot().jobs.find((j) => j.kind === 'media')?.id;
    const f = q.snapshot().jobs.find((j) => j.kind === 'file')?.id;
    if (v === undefined || f === undefined) throw new Error('no active jobs');
    expect(states(q)).toEqual(['probing', 'probing']);
    return { q, v, f };
  }

  describe('during shutdown', () => {
    it('a changed listener that always throws: shutdown resolves, each job gets its stop, saved first, then paused and not cut off', async () => {
      const { q, v, f } = twoActive();
      q.onChanged(thrower);
      const from = log.length;
      await expect(q.shutdown()).resolves.toBeUndefined();
      expect(media.stopped).toEqual([v]);
      expect(file.stopped).toEqual([f]);
      const during = log.slice(from);
      expect(during.indexOf('save')).toBeGreaterThanOrEqual(0);
      expect(during.indexOf('save')).toBeLessThan(during.indexOf('stop'));
      expect(saves.at(-1)?.jobs.map((j) => [j.id, j.state, j.interrupted])).toEqual([
        [v, 'paused', false],
        [f, 'paused', false],
      ]);
      expect(loadedLastSave()).not.toBeNull();
    });

    it('the same with one stop that fails: that job stays cut off and the other is cleared', async () => {
      const { q, v, f } = twoActive();
      q.onChanged(thrower);
      media.stopFails.add(v);
      await expect(q.shutdown()).resolves.toBeUndefined();
      expect(media.stopped).toEqual([v]);
      expect(file.stopped).toEqual([f]);
      expect(saves.at(-1)?.jobs.map((j) => [j.id, j.state, j.interrupted])).toEqual([
        [v, 'paused', true],
        [f, 'paused', false],
      ]);
      expect(q.snapshot().jobs.map((j) => j.interrupted)).toEqual([true, false]);
    });

    it('a save listener that throws on every call after registration, with the store failing: shutdown resolves and the stops are attempted', async () => {
      const { q, v, f } = twoActive();
      let registered = false;
      q.onSaveState(() => {
        if (registered) throw new Error('listener broke');
      });
      registered = true;
      saveFails.on = true;
      await expect(q.shutdown()).resolves.toBeUndefined();
      expect(media.stopped).toEqual([v]);
      expect(file.stopped).toEqual([f]);
      expect(q.snapshot().jobs.map((j) => [j.state, j.interrupted])).toEqual([
        ['paused', false],
        ['paused', false],
      ]);
    });
  });

  describe('no starving: the first listener throws and the second still gets the value', () => {
    it('changed listeners', () => {
      const q = buildBare();
      const got: Snapshot[] = [];
      q.onChanged(thrower);
      q.onChanged((s) => void got.push(s));
      q.add(video());
      expect(got).toHaveLength(1);
      expect(got[0]?.jobs).toHaveLength(1);
      expect(got[0]?.jobs[0]?.state).toBe('probing');
    });

    it('save-state listeners', () => {
      const q = buildBare();
      const got: (string | null)[] = [];
      let registered = false;
      q.onSaveState(() => {
        if (registered) throw new Error('listener broke');
      });
      registered = true;
      q.onSaveState((e) => void got.push(e));
      saveFails.on = true;
      q.add(video());
      expect(got).toEqual([null, saveMessage('disk full')]);
    });

    it('finished listeners', () => {
      const q = buildBare();
      const got: { kind: 'job' | 'group'; title: string; failed: number; skipped: number }[] = [];
      q.onFinished(thrower);
      q.onFinished((e) => void got.push(e));
      q.add(video('Talk'));
      media.emit(done(jobAt(q, 0).id));
      expect(got).toEqual([{ kind: 'job', title: 'Talk', failed: 0, skipped: 0 }]);
    });
  });

  describe('outside shutdown', () => {
    it('with a throwing changed listener, add does not throw, and the job is started and saved', () => {
      const q = build();
      q.onChanged(thrower);
      expect(() => q.add(video())).not.toThrow();
      expect(states(q)).toEqual(['probing']);
      expect(media.started).toHaveLength(1);
      expect(saves.at(-1)?.jobs.map((j) => j.state)).toEqual(['probing']);
    });

    it("with a throwing finished listener, the engine's done event does not throw, and the job is done and saved", () => {
      const q = build();
      q.onFinished(thrower);
      q.add(video());
      const id = jobAt(q, 0).id;
      expect(() => media.emit(done(id))).not.toThrow();
      expect(jobAt(q, 0).state).toBe('done');
      expect(saves.at(-1)?.jobs.map((j) => j.state)).toEqual(['done']);
    });
  });

  it('onSaveState with a listener that throws at registration still throws to the caller', () => {
    const q = build();
    expect(() =>
      q.onSaveState(() => {
        throw new Error('wiring broke');
      }),
    ).toThrow('wiring broke');
  });
});

describe('jobs cut off by a crash (7.7)', () => {
  const KINDS = ['media', 'file'] as const;
  type Kind = (typeof KINDS)[number];
  const cutOffMedia = (id: string, over: Partial<Job> = {}): Job => makeJob({ id, state: 'paused', interrupted: true, dir, baseName: id, ...over });
  const cutOffFile = (id: string, over: Partial<Job> = {}): Job =>
    makeJob({ id, kind: 'file', quality: null, baseName: null, fileName: `${id}.zip`, title: id, state: 'paused', interrupted: true, dir, bytesTotal: 5000, ...over });
  const cutOff = (kind: Kind, id: string, over: Partial<Job> = {}): Job => (kind === 'media' ? cutOffMedia(id, over) : cutOffFile(id, over));
  const seedOf = (jobs: Job[], groups: Group[] = []): Snapshot => ({ jobs, groups });
  const listGroup = (id: string): Group => ({ id, title: 'List', url: 'https://example.com/list', dir: join(dir, 'List'), createdAt: 1 });
  const interrupted = (q: Queue): boolean[] => q.snapshot().jobs.map((j) => j.interrupted);

  it('clears the flag when the check for old processes succeeded', async () => {
    const q = build({}, seedOf([cutOffMedia('m'), cutOffFile('f'), cutOffMedia('p', { interrupted: false })]), true);
    expect(interrupted(q)).toEqual([false, false, false]);
    expect(saves[0]?.jobs.map((j) => j.interrupted)).toEqual([false, false, false]); // before the first commit saved anything
    expect(states(q)).toEqual(['paused', 'paused', 'paused']);
    expect(media.started).toHaveLength(0);
    expect(await q.job('m', 'resume')).toEqual(OK);
    expect(await q.job('f', 'resume')).toEqual(OK);
    expect(states(q)).toEqual(['probing', 'probing', 'paused']);
  });

  it('clears the flag on every job, not only on paused ones', () => {
    const odd = makeJob({ id: 'odd', state: 'queued', interrupted: true, dir, baseName: 'odd' });
    const q = build({}, seedOf([odd, cutOffMedia('m')]), true);
    expect(interrupted(q)).toEqual([false, false]);
    expect(saves[0]?.jobs.map((j) => j.interrupted)).toEqual([false, false]);
  });

  it.each(KINDS)('refuses to resume a cut-off %s job when the check failed', async (kind) => {
    const q = build({}, seedOf([cutOff(kind, 'x')]), false);
    expect(await q.job('x', 'resume')).toEqual({ ok: false, error: CUT_OFF });
    expect(jobAt(q, 0)).toMatchObject({ state: 'paused', interrupted: true });
    expect((kind === 'media' ? media : file).started).toHaveLength(0);
    expect(saves.at(-1)?.jobs[0]).toMatchObject({ state: 'paused', interrupted: true }); // the saved list still says so
  });

  it('keeps the flag in the first save when the check failed', () => {
    build({}, seedOf([cutOffMedia('m'), cutOffFile('f')]), false);
    expect(saves[0]?.jobs.map((j) => j.interrupted)).toEqual([true, true]);
  });

  it('refuses to resume again after a refusal, and nothing about the job changed', async () => {
    const q = build({}, seedOf([cutOffMedia('m')]), false);
    const before = q.snapshot();
    await q.job('m', 'resume');
    await q.job('m', 'resume');
    expect(q.snapshot()).toEqual(before);
  });

  it('a paused job without the flag resumes although the check failed', async () => {
    const q = build({}, seedOf([cutOffMedia('m', { interrupted: false })]), false);
    expect(await q.job('m', 'resume')).toEqual(OK);
    expect(states(q)).toEqual(['probing']);
  });

  it('resumeAllPaused skips cut-off jobs and resumes the others', async () => {
    const q = build({ maxConcurrent: 3 }, seedOf([cutOffMedia('cut'), cutOffMedia('a', { interrupted: false }), cutOffFile('b', { interrupted: false })]), false);
    q.resumeAllPaused();
    await tick();
    expect(states(q)).toEqual(['paused', 'probing', 'probing']);
    expect(jobAt(q, 0).interrupted).toBe(true);
    expect(media.started.map((s) => s.job.id)).toEqual(['a']);
    expect(file.started.map((s) => s.job.id)).toEqual(['b']);
  });

  it('resumeAllPaused resumes every job when the check succeeded', async () => {
    const q = build({ maxConcurrent: 3 }, seedOf([cutOffMedia('cut'), cutOffMedia('a', { interrupted: false })]), true);
    q.resumeAllPaused();
    await tick();
    expect(states(q)).toEqual(['probing', 'probing']);
  });

  it('a group resume skips its cut-off member', async () => {
    const jobs = [
      cutOffMedia('cut', { groupId: 'g', index: 1 }),
      cutOffMedia('ok1', { groupId: 'g', index: 2, interrupted: false }),
      cutOffMedia('ok2', { groupId: 'g', index: 3, interrupted: false }),
    ];
    const q = build({}, seedOf(jobs, [listGroup('g')]), false);
    await q.group('g', 'resume');
    expect(states(q)).toEqual(['paused', 'probing', 'probing']);
    expect(jobAt(q, 0).interrupted).toBe(true);
    expect(media.started.map((s) => s.job.id)).toEqual(['ok1', 'ok2']);
  });

  it('after the owner confirms, the job resumes', async () => {
    const q = build({}, seedOf([cutOffMedia('m'), cutOffFile('f')]), false);
    expect((await q.job('m', 'resume')).ok).toBe(false);
    const savesBefore = saves.length;
    const changesBefore = changes;
    q.confirmStraysGone();
    expect(interrupted(q)).toEqual([false, false]); // every flag, both kinds
    expect(saves.length).toBeGreaterThan(savesBefore); // committed
    expect(saves.at(-1)?.jobs.map((j) => j.interrupted)).toEqual([false, false]);
    expect(changes).toBeGreaterThan(changesBefore);
    expect(states(q)).toEqual(['paused', 'paused']); // confirming resumes nothing by itself
    expect(media.started).toHaveLength(0);
    expect(await q.job('m', 'resume')).toEqual(OK);
    expect(await q.job('f', 'resume')).toEqual(OK);
    expect(states(q)).toEqual(['probing', 'probing']);
  });

  it('confirming when nothing is cut off changes nothing', () => {
    const q = build({}, seedOf([cutOffMedia('m', { interrupted: false })]), false);
    const before = q.snapshot();
    expect(() => q.confirmStraysGone()).not.toThrow();
    expect(q.snapshot()).toEqual(before);
  });

  it('a confirmation made while closing clears no mark: a job whose stop failed stays cut off (F1)', async () => {
    const q = build();
    q.add(video('A'));
    q.add(video('B'));
    const [a, b] = ids(q) as [string, string];
    const release = holdStops();
    media.stopFails.add(b);
    const shutting = q.shutdown();
    await tick();
    expect([...media.stopped].sort()).toEqual([a, b].sort()); // both stops are pending
    const savesBefore = saves.length;
    q.confirmStraysGone();
    expect(saves.length).toBe(savesBefore); // returned at once: nothing saved
    expect(interrupted(q)).toEqual([true, true]);
    release();
    await shutting;
    expect(saves.at(-1)?.jobs.map((j) => [j.id, j.state, j.interrupted])).toEqual([
      [a, 'paused', false],
      [b, 'paused', true],
    ]);
    expect(interrupted(q)).toEqual([false, true]);
  });

  it('a confirmation after shutdown has settled clears no mark either (F1)', async () => {
    const q = build();
    q.add(video('A'));
    const [a] = ids(q) as [string];
    media.stopFails.add(a);
    await q.shutdown();
    const savesBefore = saves.length;
    q.confirmStraysGone();
    expect(saves.length).toBe(savesBefore);
    expect(interrupted(q)).toEqual([true]);
    expect(saves.at(-1)?.jobs[0]?.interrupted).toBe(true);
  });

  it('a resume reads the flag when it runs, so a confirmation made right after it still counts', async () => {
    const q = build({}, seedOf([cutOffMedia('m')]), false);
    const resume = q.job('m', 'resume');
    q.confirmStraysGone();
    expect(await resume).toEqual(OK);
    expect(states(q)).toEqual(['probing']);
  });

  it.each(KINDS)('a cut-off %s job can still be cancelled', async (kind) => {
    const q = build({}, seedOf([cutOff(kind, 'x')]), false);
    expect(await q.job('x', 'cancel')).toEqual(OK);
    expect((kind === 'media' ? media : file).discarded).toEqual(['x']);
    expect(q.snapshot().jobs).toEqual([]);
  });

  it('cancelling a cut-off member of a group removes it, and a group cancel takes all of them', async () => {
    const jobs = [cutOffMedia('cut', { groupId: 'g', index: 1 }), cutOffMedia('ok', { groupId: 'g', index: 2, interrupted: false })];
    const q = build({}, seedOf(jobs, [listGroup('g')]), false);
    expect(await q.group('g', 'cancel')).toEqual(OK);
    expect(q.snapshot()).toEqual({ jobs: [], groups: [] });
  });
});

describe('adding: one namespace, placeholders, real height (7.8)', () => {
  const names = (q: Queue): (string | null)[] => q.snapshot().jobs.map((j) => j.baseName ?? j.fileName);
  const videoIn = (title: string, where: string): AddRequest => ({ ...video(title), dir: where });
  const fileIn = (fileName: string, where: string): AddRequest => ({ ...fileReq(fileName), dir: where });
  const videoWith = (heights: number[]): AddRequest => ({ ...video(), probe: { kind: 'media', title: 'Talk', thumbnail: null, heights } });
  const onDisk = (...files: string[]): void => {
    for (const name of files) writeFileSync(join(dir, name), 'existing');
  };
  /** An array with holes: a value where one is given, a hole where `undefined` is. */
  const sparse = (...values: (number | undefined)[]): number[] => {
    const list = new Array<number>(values.length);
    values.forEach((v, i) => {
      if (v !== undefined) list[i] = v;
    });
    return list;
  };

  describe('names taken from the disk', () => {
    it('a video does not take the name of a finished file left on disk', () => {
      onDisk('Talk.mp4');
      const q = build();
      q.add(video('Talk'));
      expect(jobAt(q, 0).baseName).toBe('Talk (2)');
    });

    it.each([
      [['Talk.mp4'], 'Talk (2)'],
      [['talk.MP4'], 'Talk (2)'],
      [['Talk.f137.mp4.part'], 'Talk (2)'],
      [['Talk.temp.mp4'], 'Talk (2)'],
      [['Talk'], 'Talk (2)'],
      [['Talk.mp4', 'Talk (2).mp4'], 'Talk (3)'],
      [['Talk2.mp4'], 'Talk'],
      [['Talkative.mp4'], 'Talk'],
      [['Tal.mp4'], 'Talk'],
      [[], 'Talk'],
    ])('a video called Talk next to %j on disk is named %s', (files, expected) => {
      onDisk(...files);
      const q = build();
      q.add(video('Talk'));
      expect(jobAt(q, 0).baseName).toBe(expected);
    });

    it('a stale aria2 control file blocks the name', () => {
      onDisk('a.zip.aria2');
      const q = build();
      q.add(fileReq('a.zip'));
      expect(jobAt(q, 0).fileName).toBe('a (2).zip');
    });

    it.each([
      [['a.zip'], 'a (2).zip'],
      [['A.ZIP'], 'a (2).zip'],
      [['a.zip.aria2'], 'a (2).zip'],
      [['a.zip.part'], 'a (2).zip'],
      [['a.zip', 'a (2).zip'], 'a (3).zip'],
      [['a.zipper'], 'a.zip'],
      [['a.txt'], 'a.zip'],
      [['b.zip'], 'a.zip'],
      [[], 'a.zip'],
    ])('a download of a.zip next to %j on disk is named %s', (files, expected) => {
      onDisk(...files);
      const q = build();
      q.add(fileReq('a.zip'));
      expect(jobAt(q, 0).fileName).toBe(expected);
    });

    it('a playlist item does not take a name that is on disk in its own folder', () => {
      const folder = join(dir, 'React Course');
      mkdirSync(folder);
      writeFileSync(join(folder, '01 - Part 1.mp4'), 'existing');
      const q = build();
      q.add(playlist(2));
      expect(q.snapshot().jobs.map((j) => j.baseName)).toEqual(['01 - Part 1 (2)', '02 - Part 2']);
    });

    it('a folder that does not exist yet holds no names, and adding into it does not throw', () => {
      const q = build();
      expect(() => q.add(videoIn('Talk', join(dir, 'not', 'there')))).not.toThrow();
      expect(jobAt(q, 0).baseName).toBe('Talk');
    });
  });

  describe('names taken by the listed jobs', () => {
    it('a file download and a queued video cannot share a name, in either order', () => {
      const q = build();
      q.add(video('Clip'));
      q.add(fileReq('Clip.mp4'));
      expect(names(q)).toEqual(['Clip', 'Clip (2).mp4']);

      media = new FakeEngine();
      file = new FakeEngine();
      const fresh = build();
      fresh.add(fileReq('Clip.mp4'));
      fresh.add(video('Clip'));
      expect(names(fresh)).toEqual(['Clip.mp4', 'Clip (2)']);
    });

    it("a video whose title extends another job's name gets its own name, in either order", () => {
      const q = build();
      q.add(video('Clip'));
      q.add(video('Clip.f137'));
      expect(names(q)).toEqual(['Clip', 'Clip (2).f137']);

      const reversed = build();
      reversed.add(video('Clip.f137'));
      reversed.add(video('Clip'));
      expect(names(reversed)).toEqual(['Clip.f137', 'Clip (2)']);
    });

    it('two videos with different names that merely start alike share nothing', () => {
      const q = build();
      q.add(video('Clip'));
      q.add(video('Clips'));
      q.add(video('Clip 2'));
      expect(names(q)).toEqual(['Clip', 'Clips', 'Clip 2']);
    });

    it('treats two spellings of one folder as the same folder', () => {
      const q = build();
      q.add(video('Talk'));
      q.add(videoIn('Talk', `${dir.toUpperCase()}\\`));
      q.add(videoIn('Talk', `${dir}\\sub\\..`));
      expect(names(q)).toEqual(['Talk', 'Talk (2)', 'Talk (3)']);
    });

    it('treats two spellings of one folder as the same folder for file downloads', () => {
      const q = build();
      q.add(fileReq('a.zip'));
      q.add(fileIn('a.zip', `${dir.toUpperCase()}\\`));
      expect(names(q)).toEqual(['a.zip', 'a (2).zip']);
    });

    it('does not share names between two different folders', () => {
      const q = build();
      q.add(video('Talk'));
      q.add(videoIn('Talk', join(dir, 'other')));
      q.add(fileReq('a.zip'));
      q.add(fileIn('a.zip', join(dir, 'other')));
      expect(names(q)).toEqual(['Talk', 'Talk', 'a.zip', 'a.zip']);
    });

    it.each(['done', 'failed', 'paused', 'queued'] as const)('a %s job holds its name', (state) => {
      const held = makeJob({ id: 'held', state, dir, baseName: 'Held', fileName: state === 'done' ? 'Held.mp4' : null });
      const heldFile = makeJob({ id: 'heldFile', kind: 'file', quality: null, baseName: null, fileName: 'kept.zip', title: 'kept.zip', state, dir });
      const q = build({ maxConcurrent: 1 }, { jobs: [held, heldFile], groups: [] });
      q.add(video('Held'));
      q.add(fileReq('kept.zip'));
      expect(names(q).slice(2)).toEqual(['Held (2)', 'kept (2).zip']);
    });

    it('a skipped job holds no name, neither a placeholder nor a file download', () => {
      const placeholder = makeJob({ id: 's', state: 'skipped', dir, baseName: 'Skipped', reason: 'private', url: '' });
      const skippedFile = makeJob({ id: 'sf', kind: 'file', quality: null, baseName: null, fileName: 'g.zip', title: 'g.zip', state: 'skipped', dir });
      const q = build({}, { jobs: [placeholder, skippedFile], groups: [] });
      q.add(video('Skipped'));
      q.add(fileReq('g.zip'));
      expect(names(q).slice(2)).toEqual(['Skipped', 'g.zip']);
    });

    it('a skipped placeholder does not hold a name', () => {
      const q = build();
      q.add(playlist(2, { unavailable: [1] }));
      expect(q.snapshot().jobs.map((j) => [j.state, j.baseName])).toEqual([
        ['skipped', '01 - Part 1'],
        ['probing', '02 - Part 2'],
      ]);
      q.add(playlist(2)); // the same folder: item 1 may take the placeholder's name, item 2 may not take the live job's
      expect(q.snapshot().jobs.slice(2).map((j) => j.baseName)).toEqual(['01 - Part 1', '02 - Part 2 (2)']);
    });

    it('a playlist folder holds its name against a video in the same folder', () => {
      const q = build();
      q.add(playlist(1, { title: 'React: Course?' })); // the folder is "React Course"
      q.add(video('React Course'));
      expect(names(q).slice(1)).toEqual(['React Course (2)']);
    });

    it('a playlist folder holds its name against a file download in the same folder', () => {
      const q = build();
      q.add(playlist(1, { title: 'React: Course?' }));
      q.add(fileReq('React Course.zip'));
      expect(names(q).slice(1)).toEqual(['React Course (2).zip']);
    });

    it('a playlist folder holds its name however the parent folder is spelled', () => {
      const q = build();
      q.add(playlist(1, { title: 'React: Course?' }));
      q.add(videoIn('React Course', `${dir.toUpperCase()}\\`));
      expect(names(q).slice(1)).toEqual(['React Course (2)']);
    });

    it('a playlist folder loaded with another spelling of its parent still holds its name', () => {
      const parent = dir.replace(/\\/gu, '/'); // forward slashes: the same folder
      const member = makeJob({ id: 'm', groupId: 'g', index: 1, state: 'done', dir: `${parent}/React Course`, baseName: '01 - Part 1', fileName: '01 - Part 1.mp4' });
      const group: Group = { id: 'g', title: 'React: Course?', url: 'https://example.com/list', dir: `${parent}/React Course`, createdAt: 1 };
      const q = build({}, { jobs: [member], groups: [group] });
      q.add(video('React Course'));
      expect(names(q).slice(1)).toEqual(['React Course (2)']);
    });

    it('a playlist folder holds nothing in another parent folder', () => {
      const q = build();
      q.add(playlist(1, { title: 'React: Course?' }));
      q.add(videoIn('React Course', join(dir, 'elsewhere')));
      expect(names(q).slice(1)).toEqual(['React Course']);
    });

    it('a playlist keeps its own folder name, and the item names stay distinct, when it is added twice', () => {
      const q = build();
      q.add(playlist(2));
      q.add(playlist(2));
      const { groups, jobs } = q.snapshot();
      expect(groups.map((g) => g.dir)).toEqual([join(dir, 'React Course'), join(dir, 'React Course')]);
      expect(jobs.map((j) => j.baseName)).toEqual(['01 - Part 1', '02 - Part 2', '01 - Part 1 (2)', '02 - Part 2 (2)']);
    });

    it('a playlist keeps its own folder name even when a video holds that name', () => {
      const q = build();
      q.add(video('React Course'));
      q.add(playlist(1, { title: 'React: Course?' }));
      expect(groupAt(q).dir).toBe(join(dir, 'React Course'));
    });

    it('two playlist items with the same title get different names in one add', () => {
      const q = build();
      q.add({
        ...playlist(2),
        probe: {
          kind: 'playlist',
          title: 'Same',
          entries: [
            { index: 1, url: 'https://example.com/v/1', title: 'Same', unavailable: false, reason: null },
            { index: 2, url: 'https://example.com/v/2', title: 'Same', unavailable: false, reason: null },
            // Two entries with one index and one title: only the claims of this very call can tell them apart.
            { index: 2, url: 'https://example.com/v/3', title: 'Same', unavailable: false, reason: null },
          ],
        },
      });
      expect(q.snapshot().jobs.map((j) => j.baseName)).toEqual(['01 - Same', '02 - Same', '02 - Same (2)']);
    });

    it('three entries with one index and one title get three names in one add', () => {
      const q = build();
      q.add({
        ...playlist(2),
        probe: {
          kind: 'playlist',
          title: 'Dots',
          entries: [
            { index: 1, url: 'https://example.com/v/1', title: 'A', unavailable: false, reason: null },
            { index: 1, url: 'https://example.com/v/2', title: 'A', unavailable: false, reason: null },
            { index: 1, url: 'https://example.com/v/3', title: 'A', unavailable: false, reason: null },
          ],
        },
      });
      expect(q.snapshot().jobs.map((j) => j.baseName)).toEqual(['01 - A', '01 - A (2)', '01 - A (3)']);
    });
  });

  describe('the real height (Q2)', () => {
    const ROWS: [string, number[], number | null][] = [
      ['one height', [1080], 1080],
      ['two heights, the larger first', [1080, 720], 1080],
      ['three heights, the largest in the middle', [720, 2160, 1080], 2160],
      ['no height', [], null],
      ['zero, NaN and a negative number', [0, Number.NaN, -5], null],
      ['NaN and then a good height', [Number.NaN, 720], 720],
      ['Infinity and then a good height', [Number.POSITIVE_INFINITY, 480], 480],
      ['only Infinity', [Number.POSITIVE_INFINITY], null],
      ['minus Infinity and a good height', [Number.NEGATIVE_INFINITY, 360], 360],
      ['zero and one', [0, 1], 1],
      ['text', ['1080' as unknown as number], null],
      ['null and a good height', [null as unknown as number, 720], 720],
      ['a hole', sparse(undefined), null],
      ['a good height and then a hole', sparse(1080, undefined), 1080],
      ['a hole and then a good height', sparse(undefined, 1080), 1080],
    ];

    it('records the real height of a single video when it is added', () => {
      const q = build();
      q.add({ ...video(), probe: { kind: 'media', title: 'Talk', thumbnail: null, heights: [1080, 720] } });
      expect(jobAt(q, 0).sourceHeight).toBe(1080);
      expect(saves.at(-1)?.jobs[0]?.sourceHeight).toBe(1080);
    });

    it('gives playlist items and file downloads no height', () => {
      const q = build();
      q.add(playlist(2));
      q.add(fileReq());
      expect(q.snapshot().jobs.map((j) => j.sourceHeight)).toEqual([null, null, null]);
    });

    it.each(ROWS)('takes the largest height that can be stored from the probe: %s', (_label, heights, expected) => {
      const q = build();
      q.add(videoWith(heights));
      expect(jobAt(q, 0).sourceHeight).toBe(expected);
      expect(saves.at(-1)?.jobs[0]?.sourceHeight).toBe(expected);
      expect(loadedLastSave()?.jobs[0]?.sourceHeight).toBe(expected); // the stored list keeps exactly what was saved
    });

    it('ignores heights that could not be stored', () => {
      const q = build();
      q.add(videoWith([0, Number.NaN, -5]));
      q.add(videoWith([Number.NaN, 720]));
      expect(q.snapshot().jobs.map((j) => j.sourceHeight)).toEqual([null, 720]);
    });

    it('stores the height the engine found and saves it', () => {
      const q = build();
      q.add(videoWith([]));
      const id = jobAt(q, 0).id;
      const savesBefore = saves.length;
      const changesBefore = changes;
      media.emit({ jobId: id, type: 'probed', sourceHeight: 2160 });
      expect(jobAt(q, 0)).toMatchObject({ state: 'probing', sourceHeight: 2160 });
      expect(saves).toHaveLength(savesBefore + 1);
      expect(saves.at(-1)?.jobs[0]).toMatchObject({ state: 'probing', sourceHeight: 2160 });
      expect(changes).toBeGreaterThan(changesBefore);
      expect(loadedLastSave()?.jobs[0]?.sourceHeight).toBe(2160);
    });

    it('replaces the height of the probe with the height the engine found', () => {
      const q = build();
      q.add(videoWith([1080]));
      media.emit({ jobId: jobAt(q, 0).id, type: 'probed', sourceHeight: 2160 });
      expect(jobAt(q, 0).sourceHeight).toBe(2160);
    });

    it.each([1, 4320, 0.5])('stores the height %s the engine found', (height) => {
      const q = build();
      q.add(videoWith([]));
      media.emit({ jobId: jobAt(q, 0).id, type: 'probed', sourceHeight: height });
      expect(jobAt(q, 0).sourceHeight).toBe(height);
      expect(loadedLastSave()?.jobs[0]?.sourceHeight).toBe(height);
    });

    it('stores a height that arrives while the job is already downloading, and keeps its state', () => {
      const q = build();
      q.add(videoWith([]));
      const id = jobAt(q, 0).id;
      media.emit(progress(id));
      media.emit({ jobId: id, type: 'probed', sourceHeight: 720 });
      expect(jobAt(q, 0)).toMatchObject({ state: 'downloading', sourceHeight: 720 });
    });

    it('ignores a height that arrives for a job that is not running any more', async () => {
      const q = build();
      q.add(videoWith([]));
      const id = jobAt(q, 0).id;
      await q.job(id, 'pause');
      const savesBefore = saves.length;
      media.emit({ jobId: id, type: 'probed', sourceHeight: 720 });
      media.emit({ jobId: 'unknown-id', type: 'probed', sourceHeight: 720 });
      expect(jobAt(q, 0).sourceHeight).toBeNull();
      expect(saves).toHaveLength(savesBefore);
    });

    const BAD: [string, unknown][] = [
      ['0', 0],
      ['NaN', Number.NaN],
      ['-1', -1],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['text', '1080'],
      ['null', null],
      ['undefined', undefined],
    ];

    it.each(BAD)('never stores a height the stored list would reject: %s', (_label, bad) => {
      const q = build();
      q.add(videoWith([]));
      q.add(videoWith([1080]));
      const [unknown, known] = ids(q) as [string, string];
      const savesBefore = saves.length;
      media.emit({ jobId: unknown, type: 'probed', sourceHeight: bad } as unknown as EngineEvent);
      media.emit({ jobId: known, type: 'probed', sourceHeight: bad } as unknown as EngineEvent);
      expect(q.snapshot().jobs.map((j) => j.sourceHeight)).toEqual([null, 1080]); // nothing stored, the earlier value is kept
      expect(saves).toHaveLength(savesBefore);
      expect(loadedLastSave()).not.toBeNull();
    });
  });
});

describe('deleting the file (7.9)', () => {
  const KINDS = ['media', 'file'] as const;
  type Kind = (typeof KINDS)[number];

  /** A finished job of the kind whose file is `Talk.mp4` (or `Talk.zip`) in the download folder; the file itself is not created. */
  function finishedJob(kind: Kind): { q: Queue; id: string; name: string } {
    const q = build();
    const name = kind === 'media' ? 'Talk.mp4' : 'Talk.zip';
    q.add(kind === 'media' ? video('Talk') : fileReq(name));
    const id = jobAt(q, 0).id;
    (kind === 'media' ? media : file).emit(done(id, name));
    expect(jobAt(q, 0)).toMatchObject({ state: 'done', fileName: name });
    return { q, id, name };
  }

  /** What the platform says when this path is removed without `recursive`: a directory with content is refused (P2). */
  function refusal(path: string): string {
    try {
      rmSync(path);
    } catch (e) {
      return (e as Error).message;
    }
    return '';
  }

  it('keeps the row and reports the error when the file cannot be deleted', async () => {
    const { q, id, name } = finishedJob('media');
    const target = join(dir, name);
    mkdirSync(target);
    writeFileSync(join(target, 'inner.txt'), 'keep me');
    const reason = refusal(target);
    expect(reason).not.toBe('');
    const result = await q.job(id, 'removeWithFile');
    expect(result).toEqual({ ok: false, error: `Could not delete the file: ${reason}` });
    expect(result.ok === false && result.error.startsWith('Could not delete the file: ')).toBe(true);
    expect(q.snapshot().jobs.map((j) => [j.id, j.state])).toEqual([[id, 'done']]);
    expect(existsSync(join(target, 'inner.txt'))).toBe(true);
  });

  it.each(['failed', 'skipped'] as const)('a %s job loses its row but never a file, even one of the name it was to get', async (state) => {
    const fileJob = makeJob({ id: 'f', kind: 'file', quality: null, baseName: null, fileName: 'a.zip', title: 'a.zip', state, reason: 'x', dir });
    const mediaJob = makeJob({ id: 'm', state, reason: 'x', dir, baseName: 'Talk', fileName: 'Talk.mp4' });
    writeFileSync(join(dir, 'a.zip'), 'someone else');
    writeFileSync(join(dir, 'Talk.mp4'), 'someone else');
    const q = build({}, { jobs: [fileJob, mediaJob], groups: [] });
    expect(await q.job('f', 'removeWithFile')).toEqual(OK);
    expect(await q.job('m', 'removeWithFile')).toEqual(OK);
    expect(q.snapshot().jobs).toEqual([]);
    expect(existsSync(join(dir, 'a.zip'))).toBe(true);
    expect(existsSync(join(dir, 'Talk.mp4'))).toBe(true);
  });

  it('a job that is not finished keeps its row and its file', async () => {
    const paused = makeJob({ id: 'p', state: 'paused', dir, baseName: 'Talk', fileName: 'Talk.mp4' });
    writeFileSync(join(dir, 'Talk.mp4'), 'partial');
    const q = build({}, { jobs: [paused], groups: [] });
    expect(await q.job('p', 'removeWithFile')).toEqual(OK);
    expect(q.snapshot().jobs).toHaveLength(1);
    expect(existsSync(join(dir, 'Talk.mp4'))).toBe(true);
  });

  it('keeps the row and reports the error when the file of a download cannot be deleted', async () => {
    const { q, id, name } = finishedJob('file');
    const target = join(dir, name);
    mkdirSync(target);
    writeFileSync(join(target, 'inner.txt'), 'keep me');
    const result = await q.job(id, 'removeWithFile');
    expect(result.ok).toBe(false);
    expect(q.snapshot().jobs).toHaveLength(1);
    expect(existsSync(join(target, 'inner.txt'))).toBe(true);
  });

  it('touches nothing else in the folder when the file cannot be deleted', async () => {
    const { q, id, name } = finishedJob('media');
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, 'inner.txt'), 'keep me');
    writeFileSync(join(dir, 'other.txt'), 'other');
    await q.job(id, 'removeWithFile');
    expect(existsSync(join(dir, 'other.txt'))).toBe(true);
    expect(existsSync(join(dir, name, 'inner.txt'))).toBe(true);
  });

  it('a group member whose file cannot be deleted stays with its group', async () => {
    const q = build();
    q.add(playlist(1));
    const id = jobAt(q, 0).id;
    media.emit(done(id, 'Part 1.mp4'));
    const target = join(jobAt(q, 0).dir, 'Part 1.mp4');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'inner.txt'), 'keep me');
    expect((await q.job(id, 'removeWithFile')).ok).toBe(false);
    expect(q.snapshot().jobs).toHaveLength(1);
    expect(q.snapshot().groups).toHaveLength(1);
    expect(loadedLastSave()).not.toBeNull();
  });

  it('the row can be removed once the file no longer blocks it', async () => {
    const { q, id, name } = finishedJob('media');
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, 'inner.txt'), 'keep me');
    expect((await q.job(id, 'removeWithFile')).ok).toBe(false);
    rmSync(join(dir, name), { recursive: true });
    expect(await q.job(id, 'removeWithFile')).toEqual(OK);
    expect(q.snapshot().jobs).toEqual([]);
  });

  it.each(KINDS)('removes the row when the file of a %s job is already gone', async (kind) => {
    const { q, id } = finishedJob(kind);
    expect(await q.job(id, 'removeWithFile')).toEqual(OK);
    expect(q.snapshot().jobs).toEqual([]);
  });

  it('removes the row and the file when the file is there', async () => {
    const { q, id, name } = finishedJob('media');
    writeFileSync(join(dir, name), 'video');
    writeFileSync(join(dir, 'other.mp4'), 'someone else');
    expect(await q.job(id, 'removeWithFile')).toEqual(OK);
    expect(existsSync(join(dir, name))).toBe(false);
    expect(existsSync(join(dir, 'other.mp4'))).toBe(true);
    expect(q.snapshot().jobs).toEqual([]);
  });
});

describe('a group is announced after a cancel (7.10)', () => {
  const GROUP_TITLE = 'React: Course?';

  it('announces the playlist when its last unfinished item is cancelled', async () => {
    const q = build();
    q.add(playlist(2));
    const [a, b] = ids(q) as [string, string];
    media.emit(done(a));
    await q.job(b, 'pause');
    expect(finished).toEqual([]);
    expect(await q.job(b, 'cancel')).toEqual(OK);
    expect(finished).toEqual([{ kind: 'group', title: GROUP_TITLE, failed: 0, skipped: 0 }]);
  });

  it.each(['queued', 'probing', 'downloading', 'merging', 'paused'] as const)('announces the playlist when its last item is cancelled while it is %s', async (state) => {
    const q = build();
    q.add(playlist(2));
    const [a, b] = ids(q) as [string, string];
    media.emit(done(a));
    if (state === 'queued') media.emit(error(b, 'HTTP Error 503', true));
    if (state === 'downloading' || state === 'merging') media.emit(progress(b));
    if (state === 'merging') media.emit({ jobId: b, type: 'merging' });
    if (state === 'paused') await q.job(b, 'pause');
    expect(jobAt(q, 1).state).toBe(state);
    expect(finished).toEqual([]);
    expect(await q.job(b, 'cancel')).toEqual(OK);
    expect(finished).toEqual([{ kind: 'group', title: GROUP_TITLE, failed: 0, skipped: 0 }]);
  });

  it('does not announce when every remaining item is skipped', async () => {
    const q = build();
    q.add(playlist(3, { unavailable: [1, 2] }));
    expect(states(q)).toEqual(['skipped', 'skipped', 'probing']);
    expect(await q.job(jobAt(q, 2).id, 'cancel')).toEqual(OK);
    expect(q.snapshot().jobs).toHaveLength(2);
    expect(finished).toEqual([]);
  });

  it('announces when a remaining item failed', async () => {
    const q = build();
    q.add(playlist(3, { unavailable: [3] }));
    const [a, b] = ids(q) as [string, string, string];
    media.emit(error(b, 'disk full', false));
    expect(finished).toEqual([]); // the first item is still running
    expect(await q.job(a, 'cancel')).toEqual(OK);
    expect(finished).toEqual([{ kind: 'group', title: GROUP_TITLE, failed: 1, skipped: 1 }]);
  });

  it('announces when a remaining item is done and another was skipped', async () => {
    const q = build();
    q.add(playlist(3, { unavailable: [3] }));
    const [a, b] = ids(q) as [string, string, string];
    media.emit(done(a));
    expect(await q.job(b, 'cancel')).toEqual(OK);
    expect(finished).toEqual([{ kind: 'group', title: GROUP_TITLE, failed: 0, skipped: 1 }]);
  });

  it('does not announce while another item is still unfinished', async () => {
    const q = build();
    q.add(playlist(3));
    const [a, b, c] = ids(q) as [string, string, string];
    media.emit(done(a));
    await q.job(b, 'pause');
    expect(await q.job(c, 'cancel')).toEqual(OK);
    expect(states(q)).toEqual(['done', 'paused']);
    expect(finished).toEqual([]);
  });

  it('announces at the cancel that leaves nothing unfinished, once, and not before', async () => {
    const q = build();
    q.add(playlist(3));
    const [a, b, c] = ids(q) as [string, string, string];
    media.emit(done(a));
    await q.job(b, 'cancel'); // c is still running
    expect(finished).toEqual([]);
    await q.job(c, 'cancel');
    expect(finished).toHaveLength(1);
  });

  it.each(['failed', 'skipped'] as const)('does not announce when the cancelled item had already %s', async (outcome) => {
    const q = build();
    q.add(playlist(3));
    const [a, b, c] = ids(q) as [string, string, string];
    media.emit(done(a));
    media.emit(outcome === 'failed' ? error(b, 'disk full', false) : error(b, 'private', false, 'skipped'));
    media.emit(done(c)); // the playlist is over: announced once, by the engine event
    expect(finished).toHaveLength(1);
    await q.job(b, 'cancel');
    expect(q.snapshot().jobs).toHaveLength(2);
    expect(finished).toHaveLength(1);
  });

  it('does not announce when a finished row is removed', async () => {
    const jobs = ['a', 'b', 'c'].map((id, i) => makeJob({ id, groupId: 'g', index: i + 1, state: 'done', dir, baseName: id, fileName: `${id}.mp4` }));
    const group: Group = { id: 'g', title: GROUP_TITLE, url: 'https://example.com/list', dir, createdAt: 1 };
    const q = build({}, { jobs, groups: [group] });
    expect(await q.job('a', 'remove')).toEqual(OK);
    expect(await q.job('b', 'removeWithFile')).toEqual(OK);
    expect(ids(q)).toEqual(['c']);
    expect(finished).toEqual([]);
  });

  it('does not announce on a group cancel', async () => {
    const q = build();
    q.add(playlist(3));
    const [a] = ids(q) as [string, string, string];
    media.emit(done(a));
    expect(await q.group(groupAt(q).id, 'cancel')).toEqual(OK);
    expect(q.snapshot()).toEqual({ jobs: [], groups: [] });
    expect(finished).toEqual([]);
  });

  it('does not announce on a group cancel that removes a running item before a failed one', async () => {
    const q = build();
    q.add(playlist(2));
    const [a, b] = ids(q) as [string, string];
    media.emit(error(b, 'disk full', false)); // b has failed and stays listed until its own cancel; a still runs
    expect(finished).toEqual([]);
    expect(await q.group(groupAt(q).id, 'cancel')).toEqual(OK);
    expect(media.discarded).toContain(a);
    expect(q.snapshot()).toEqual({ jobs: [], groups: [] });
    expect(finished).toEqual([]);
  });

  it('does not announce on a group cancel that leaves a member behind', async () => {
    const q = build();
    q.add(playlist(3));
    const [a, , c] = ids(q) as [string, string, string];
    media.emit(done(a));
    media.stopFails.add(c);
    expect((await q.group(groupAt(q).id, 'cancel')).ok).toBe(false);
    expect(finished).toEqual([]);
  });

  it('cancelling the only item announces nothing', async () => {
    const q = build();
    q.add(playlist(1));
    await q.job(jobAt(q, 0).id, 'cancel');
    expect(finished).toEqual([]);
    q.add(video());
    await q.job(jobAt(q, 0).id, 'cancel');
    expect(finished).toEqual([]);
  });

  it('cancelling a lone job announces nothing', async () => {
    const q = build();
    q.add(video('One'));
    q.add(video('Two'));
    media.emit(done(jobAt(q, 0).id));
    expect(finished).toEqual([{ kind: 'job', title: 'One', failed: 0, skipped: 0 }]);
    await q.job(jobAt(q, 1).id, 'cancel');
    expect(finished).toHaveLength(1);
  });

  it('the announcement after an engine event still fires when every member ended skipped', () => {
    const q = build();
    q.add(playlist(2));
    const [a, b] = ids(q) as [string, string];
    media.emit(error(a, 'private', false, 'skipped'));
    expect(finished).toEqual([]);
    media.emit(error(b, 'removed', false, 'skipped'));
    expect(finished).toEqual([{ kind: 'group', title: GROUP_TITLE, failed: 0, skipped: 2 }]);
  });
});

describe('the total of a media download (UI spec 2b)', () => {
  const total = (q: Queue) => jobAt(q, 0).bytesTotal;

  it('clears a media total when a progress event says the total is unknown', () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit({ jobId: id, type: 'progress', bytesDone: 10, bytesTotal: 100, speed: 5, eta: 18 });
    expect(total(q)).toBe(100);
    media.emit({ jobId: id, type: 'progress', bytesDone: 20, bytesTotal: null, speed: 5, eta: null });
    expect(total(q)).toBeNull();
    expect(jobAt(q, 0).bytesDone).toBe(20);
  });

  it('takes the next stream total once it is known again', () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit({ jobId: id, type: 'progress', bytesDone: 10, bytesTotal: 100, speed: 5, eta: 18 });
    media.emit({ jobId: id, type: 'progress', bytesDone: 0, bytesTotal: null, speed: 0, eta: null });
    media.emit({ jobId: id, type: 'progress', bytesDone: 3, bytesTotal: 40, speed: 1, eta: 37 });
    expect(total(q)).toBe(40);
  });

  it('keeps a file total when a progress event says the total is unknown', () => {
    const q = build();
    q.add(fileReq());
    const id = jobAt(q, 0).id;
    expect(total(q)).toBe(5000); // the size the probe gave
    file.emit({ jobId: id, type: 'progress', bytesDone: 10, bytesTotal: null, speed: 5, eta: null });
    expect(total(q)).toBe(5000);
    file.emit({ jobId: id, type: 'progress', bytesDone: 20, bytesTotal: 6000, speed: 5, eta: null });
    file.emit({ jobId: id, type: 'progress', bytesDone: 30, bytesTotal: null, speed: 5, eta: null });
    expect(total(q)).toBe(6000);
  });

  it('a media download that finishes after an unknown total keeps its done bytes', () => {
    const q = build();
    q.add(video());
    const id = jobAt(q, 0).id;
    media.emit({ jobId: id, type: 'progress', bytesDone: 10, bytesTotal: 100, speed: 5, eta: 18 });
    media.emit({ jobId: id, type: 'progress', bytesDone: 70, bytesTotal: null, speed: 5, eta: null });
    media.emit({ jobId: id, type: 'done', fileName: 'Talk.mp4', actualHeight: 720 });
    expect(jobAt(q, 0)).toMatchObject({ state: 'done', bytesDone: 70, bytesTotal: null });
  });
});
