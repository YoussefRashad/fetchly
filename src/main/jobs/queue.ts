import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { extname, join, win32 } from 'node:path';
import type { AddRequest, Group, GroupVerb, Job, JobVerb, Result, Settings, Snapshot } from '../../shared/types';
import type { Engine, EngineEvent } from '../engines/engine';
import { dirKey, freeName, itemBaseName, nameConflicts, sanitizeName } from '../naming';
import { ACTIVE, canApply, transition, type JobEvent } from './state';
import type { Store } from './store';
import { isUsableDoneName } from './validate';

export const RETRY_DELAYS_MS = [5000, 20000, 60000];
/** While the last save failed, the save is tried again after this delay (OQ2). */
export const SAVE_RETRY_MS = 60000;
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;
const NOTIFY_EVERY_MS = 250;
const SAVE_PROGRESS_EVERY_MS = 5000;

const PAUSE_NOT_CONFIRMED = 'Could not confirm that the download stopped. It is still listed as running; try again.';
const CANCEL_NOT_CONFIRMED = 'Could not confirm that the download stopped, so nothing was deleted. It is still in the list; try again.';
const CLOSING = 'Fetchly is closing';
const CUT_OFF =
  'This download was cut off and Fetchly could not check that its old process is gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then choose "They are gone" in the banner, or restart Fetchly.';

const ok = (): Result<null> => ({ ok: true, value: null });
const fail = (error: string): Result<null> => ({ ok: false, error });
const noop = (): void => undefined;

/** A finite, non-negative number, else null. */
function count(v: number | null): number | null {
  return v !== null && Number.isFinite(v) && v >= 0 ? v : null;
}

/** A height the stored list accepts: a finite number > 0. */
function isHeight(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** The largest storable height of a probe's list, or null. Tolerant of any value: the checks are the handler's. */
function largestHeight(list: unknown): number | null {
  if (!Array.isArray(list)) return null;
  let best: number | null = null;
  // An index loop: a hole reads as undefined and is skipped.
  for (let i = 0; i < list.length; i += 1) {
    const v: unknown = list[i];
    if (isHeight(v) && (best === null || v > best)) best = v;
  }
  return best;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface Finished {
  kind: 'job' | 'group';
  title: string;
  failed: number;
  skipped: number;
}

export interface QueueDeps {
  store: Store;
  media: Engine;
  /** setRateLimit resolves true only when aria2 confirmed the limit; any other outcome counts as not sent. */
  file: Engine & { setRateLimit(jobId: string, bytesPerSec: number | null): Promise<boolean> };
  initial: Snapshot;
  settings: Settings;
  /** true = the check for tool processes left by an earlier run succeeded, so no job is cut off. */
  straysCleared: boolean;
  /**
   * Called with the full path and the link of each download that finished, before it is listed as
   * done: marks the file as coming from the internet. Best effort; anything it throws is ignored.
   */
  markDownloaded?: (path: string, url: string) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

/**
 * What Queue.add takes: an AddRequest the caller has checked, plus three fields only main supplies. All three
 * are required, so no caller can forget them. referer and userAgent are stored as given: they must already
 * satisfy reduceReferer (equal to their own reduction) and isUserAgent, or be null.
 */
export interface QueueAdd extends AddRequest {
  referer: string | null;
  userAgent: string | null;
  /** Stored as given on a lone job; a playlist item always gets false. */
  oneShotLogin: boolean;
}

const TERMINAL = new Set(['done', 'failed', 'skipped']);

/** The names already used in one folder during one `add` call. */
interface FolderNames {
  claims: string[];
  disk: string[];
}

export class Queue {
  private jobs: Job[];
  private groups: Group[];
  private settings: Settings;
  private readonly store: Store;
  private readonly media: Engine;
  private readonly file: QueueDeps['file'];
  private readonly markDownloaded: (path: string, url: string) => void;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;

  /** Jobs that are queued but must wait for their retry delay, with the token of that wait. */
  private readonly waiting = new Map<string, number>();
  private waitToken = 0;
  /** Jobs whose cancel is waiting for the engine: never started meanwhile. */
  private readonly cancelling = new Set<string>();
  /** Per job, the tail of its verb chain. */
  private readonly chains = new Map<string, Promise<void>>();
  /**
   * Per active job, the rate limit (bytes/s, null = none) it runs with: the one it started with, or
   * one sent since that aria2 has not refused. A file job's limit that aria2 did not confirm is
   * removed, so the next settings save sends it again.
   */
  private readonly limits = new Map<string, number | null>();
  private readonly changedListeners: ((s: Snapshot) => void)[] = [];
  private readonly finishedListeners: ((e: Finished) => void)[] = [];
  private readonly saveListeners: ((error: string | null) => void)[] = [];
  private lastNotify = 0;
  private notifyPending = false;
  private lastSave = 0;
  private saveError: string | null = null;
  private saveRetryPending = false;
  private closed = false;
  private closing: Promise<void> | null = null;

  constructor(deps: QueueDeps) {
    this.store = deps.store;
    this.media = deps.media;
    this.file = deps.file;
    this.markDownloaded = deps.markDownloaded ?? (() => undefined);
    this.jobs = [...deps.initial.jobs];
    if (deps.straysCleared) this.jobs = this.jobs.map((j) => (j.interrupted ? { ...j, interrupted: false } : j));
    this.groups = [...deps.initial.groups];
    this.settings = deps.settings;
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.media.on((ev) => this.onEngineEvent(ev));
    this.file.on((ev) => this.onEngineEvent(ev));
    this.commit();
  }

  snapshot(): Snapshot {
    return { jobs: [...this.jobs], groups: [...this.groups] };
  }

  /** A throw from the listener is swallowed: it stops neither the queue nor the other listeners. */
  onChanged(listener: (s: Snapshot) => void): void {
    this.changedListeners.push(listener);
  }

  /** A throw from the listener is swallowed: it stops neither the queue nor the other listeners. */
  onFinished(listener: (e: Finished) => void): void {
    this.finishedListeners.push(listener);
  }

  /**
   * Calls the listener at once with the current save error (null = the last save worked), then on every change.
   * A throw from that first call reaches the caller (a wiring failure); a throw from a later call is swallowed.
   */
  onSaveState(listener: (error: string | null) => void): void {
    this.saveListeners.push(listener);
    listener(this.saveError);
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.commit();
    this.retune();
  }

  add(req: QueueAdd): void {
    const createdAt = this.now();
    const base = {
      url: req.url,
      referer: req.referer,
      userAgent: req.userAgent,
      oneShotLogin: req.oneShotLogin,
      state: 'queued' as const,
      reason: null,
      subtitleLangs: req.subtitleLangs,
      fileName: null,
      bytesDone: 0,
      bytesTotal: null,
      speed: 0,
      eta: null,
      actualHeight: null,
      resumable: true,
      attempts: 0,
      createdAt,
      interrupted: false,
      sourceHeight: null,
    };
    const probe = req.probe;
    const folders = new Map<string, FolderNames>();
    /** A free name in `dir`; when `claim`, it joins the claims for the next item of this call. */
    const name = (dir: string, stem: string, ext: string, claim = true): string => {
      const key = dirKey(dir);
      let names = folders.get(key);
      if (!names) {
        names = { claims: this.claimsIn(key), disk: this.diskNames(dir) };
        folders.set(key, names);
      }
      const known = names;
      const free = freeName(stem, ext, (n) => nameConflicts(n, known.claims, known.disk));
      if (claim) known.claims.push(free);
      return free;
    };

    if (probe.kind === 'file') {
      const ext = extname(probe.fileName);
      const stem = ext === '' ? probe.fileName : probe.fileName.slice(0, -ext.length);
      this.jobs.push({
        ...base,
        id: randomUUID(),
        groupId: null,
        kind: 'file',
        title: probe.fileName,
        quality: null,
        subtitleLangs: [],
        dir: req.dir,
        baseName: null,
        fileName: name(req.dir, stem, ext.slice(1)),
        index: null,
        bytesTotal: probe.size,
        resumable: probe.resumable,
      });
    } else if (probe.kind === 'media') {
      this.jobs.push({
        ...base,
        id: randomUUID(),
        groupId: null,
        kind: 'media',
        title: probe.title,
        quality: req.quality ?? this.settings.defaultQuality,
        dir: req.dir,
        baseName: name(req.dir, itemBaseName(probe.title, null, null), ''),
        index: null,
        sourceHeight: largestHeight(probe.heights),
      });
    } else {
      // The folder name is not made unique: adding a playlist twice puts both in one folder.
      const group: Group = { id: randomUUID(), title: probe.title, url: req.url, dir: join(req.dir, sanitizeName(probe.title)), createdAt };
      const selected = req.selectedIndexes === null ? null : new Set(req.selectedIndexes);
      // Pad by the size of the whole playlist so numbers match the site whatever was selected.
      const total = probe.entries.reduce((max, e) => Math.max(max, e.index), 0);
      let added = 0;
      for (const entry of probe.entries) {
        if (!entry.unavailable && selected !== null && !selected.has(entry.index)) continue;
        added += 1;
        this.jobs.push({
          ...base,
          id: randomUUID(),
          groupId: group.id,
          kind: 'media',
          url: entry.url,
          title: entry.title,
          // Shown in the list so nobody wonders where item N went.
          state: entry.unavailable ? 'skipped' : 'queued',
          reason: entry.unavailable ? (entry.reason ?? 'unavailable') : null,
          quality: req.quality ?? this.settings.defaultQuality,
          dir: group.dir,
          // A skipped placeholder holds no name.
          baseName: name(group.dir, itemBaseName(entry.title, entry.index, total), '', !entry.unavailable),
          index: entry.index,
          // Items inherit referer and userAgent from base; a sign-in held for one run is never given to a group.
          oneShotLogin: false,
        });
      }
      if (added > 0) this.groups.push(group);
    }
    this.commit();
  }

  /** Runs the verb after the job's earlier verbs; ok when it did its work or had nothing to do. */
  job(id: string, verb: JobVerb): Promise<Result<null>> {
    if (this.closed) return Promise.resolve(fail(CLOSING));
    return this.enqueue(id, () => this.runVerb(id, verb, false));
  }

  /** One verb per member, each on its member's chain; the first error, else ok. */
  async group(id: string, verb: GroupVerb): Promise<Result<null>> {
    if (this.closed) return fail(CLOSING);
    const members = this.jobs.filter((j) => j.groupId === id).map((j) => j.id);
    const results = await Promise.all(members.map((m) => this.enqueue(m, () => this.runVerb(m, verb, true))));
    return results.find((r) => !r.ok) ?? ok();
  }

  /** Resumes every paused job that was not cut off. */
  resumeAllPaused(): void {
    if (this.closed) return;
    for (const job of this.jobs) {
      if (job.state === 'paused') void this.enqueue(job.id, () => this.resumeVerb(job.id, true));
    }
  }

  async pauseAll(): Promise<void> {
    await Promise.all(this.jobs.map((j) => this.enqueue(j.id, () => this.pauseVerb(j.id))));
  }

  /**
   * Quit: every active job is marked paused and cut off and saved so, then its engine is
   * stopped; each confirmed stop clears the mark. Resolves when every stop has settled.
   */
  shutdown(): Promise<void> {
    this.closing ??= this.close();
    return this.closing;
  }

  /**
   * The owner confirmed that no tool process of an earlier run is left: no job is cut off any more.
   * Does nothing once closing: the marks shutdown sets are about this run's own stops.
   */
  confirmStraysGone(): void {
    if (this.closed) return;
    this.jobs = this.jobs.map((j) => (j.interrupted ? { ...j, interrupted: false } : j));
    this.commit();
  }

  // ---- verbs ----

  /** Chains `run` behind the job's earlier verbs. It starts on a later microtask, never in this tick. */
  private enqueue(id: string, run: () => Promise<Result<null>>): Promise<Result<null>> {
    const previous = this.chains.get(id) ?? Promise.resolve();
    // A verb still waiting when closing started does nothing.
    const result = previous.then(() => (this.closed ? fail(CLOSING) : run()));
    const tail = result.then(noop, noop);
    this.chains.set(id, tail);
    void tail.then(() => {
      if (this.chains.get(id) === tail) this.chains.delete(id);
    });
    return result;
  }

  private runVerb(id: string, verb: JobVerb, inGroup: boolean): Promise<Result<null>> {
    switch (verb) {
      case 'pause':
        return this.pauseVerb(id);
      case 'resume':
        return this.resumeVerb(id, inGroup);
      case 'retry':
        return this.retryVerb(id);
      case 'cancel':
        // A group cancel removes finished members' rows and keeps their files; it announces nothing.
        if (inGroup && this.find(id)?.state === 'done') return this.removeVerb(id, false);
        return this.cancelVerb(id, !inGroup);
      case 'remove':
        return this.removeVerb(id, false);
      case 'removeWithFile':
        return this.removeVerb(id, true);
      default:
        return Promise.resolve(ok());
    }
  }

  private async pauseVerb(id: string): Promise<Result<null>> {
    const job = this.find(id);
    if (!job || !canApply(job, 'pause')) return ok();
    if (ACTIVE.has(job.state)) {
      // Stop first: the slot is freed only once the engine has released the job.
      try {
        await this.engineOf(job).stop(id);
      } catch {
        return fail(PAUSE_NOT_CONFIRMED);
      }
    }
    this.waiting.delete(id);
    this.apply(id, { type: 'pause' });
    this.commit();
    return ok();
  }

  /** `skipCutOff`: a group resume and resumeAllPaused pass over a cut-off job instead of refusing. */
  private async resumeVerb(id: string, skipCutOff: boolean): Promise<Result<null>> {
    const job = this.find(id);
    if (!job || !canApply(job, 'resume')) return ok();
    if (job.interrupted) return skipCutOff ? ok() : fail(CUT_OFF);
    this.apply(id, { type: 'resume' });
    this.commit();
    return ok();
  }

  private async retryVerb(id: string): Promise<Result<null>> {
    const job = this.find(id);
    if (!job || !canApply(job, 'retry')) return ok();
    this.apply(id, { type: 'retry' });
    this.commit();
    return ok();
  }

  private async cancelVerb(id: string, announce: boolean): Promise<Result<null>> {
    const job = this.find(id);
    if (!job || job.state === 'done') return ok();
    const wasTerminal = TERMINAL.has(job.state);
    this.cancelling.add(id);
    try {
      await this.engineOf(job).discard(job);
    } catch {
      this.cancelling.delete(id);
      // The row stays; a queued job held back meanwhile may take a free slot again.
      if (this.find(id)?.state === 'queued') this.commit();
      return fail(CANCEL_NOT_CONFIRMED);
    }
    this.cancelling.delete(id);
    this.waiting.delete(id);
    this.remove(id);
    this.commit();
    if (announce && !wasTerminal) this.announceGroupAfterCancel(job.groupId);
    return ok();
  }

  private async removeVerb(id: string, withFile: boolean): Promise<Result<null>> {
    const job = this.find(id);
    if (!job || !TERMINAL.has(job.state)) return ok();
    if (withFile && job.state === 'done' && job.fileName !== null) {
      try {
        // No force and no recursive: a folder in the file's place is refused and left intact.
        rmSync(join(job.dir, job.fileName));
      } catch (e) {
        if ((e as NodeJS.ErrnoException | null)?.code !== 'ENOENT') return fail(`Could not delete the file: ${messageOf(e)}`);
      }
    }
    this.remove(id);
    this.commit();
    return ok();
  }

  /** A limit restart, queued by setSettings. It looks again when it runs; a stop that is not confirmed leaves the job running. */
  private async restartVerb(id: string): Promise<Result<null>> {
    const job = this.find(id);
    if (!job || job.kind !== 'media' || (job.state !== 'probing' && job.state !== 'downloading')) return ok();
    if (this.limits.get(id) === this.share()) return ok();
    try {
      await this.media.stop(id);
    } catch {
      return ok(); // keeps its old limit; the next settings change tries again
    }
    this.apply(id, { type: 'requeue' });
    this.commit();
    return ok();
  }

  // ---- internals ----

  private async close(): Promise<void> {
    this.closed = true;
    const active = this.jobs.filter((j) => ACTIVE.has(j.state));
    for (const job of active) this.replace({ ...transition(job, { type: 'interrupt' }), interrupted: true });
    // Saved as cut off before any stop: a crash from here on still finds them marked.
    this.save();
    this.notify();
    await Promise.all(
      active.map(async (job) => {
        try {
          await this.engineOf(job).stop(job.id);
        } catch {
          return; // not confirmed: the job stays cut off
        }
        const current = this.find(job.id);
        if (current?.interrupted) this.replace({ ...current, interrupted: false });
      }),
    );
    this.save();
    this.notify();
  }

  private onEngineEvent(ev: EngineEvent): void {
    if (this.closed) return;
    const job = this.find(ev.jobId);
    if (!job || !ACTIVE.has(job.state)) return; // late event for a job that was paused, cancelled or finished

    switch (ev.type) {
      case 'progress': {
        const stateChanged = job.state === 'probing';
        const next = stateChanged ? transition(job, { type: 'firstProgress' }) : job;
        // A tool's number that is not a finite count is not stored: the list must load again.
        this.replace({
          ...next,
          bytesDone: count(ev.bytesDone) ?? next.bytesDone,
          // A media total is the current stream's size: an unknown one clears it. A file keeps its probed size.
          bytesTotal: count(ev.bytesTotal) ?? (job.kind === 'media' ? null : next.bytesTotal),
          speed: count(ev.speed) ?? 0,
          eta: count(ev.eta),
        });
        if (stateChanged) this.commit();
        else this.progressTick();
        return;
      }
      case 'probed':
        // Only a height the stored list accepts is kept; anything else is ignored, unsaved.
        if (!isHeight(ev.sourceHeight)) return;
        this.replace({ ...job, sourceHeight: ev.sourceHeight });
        this.save();
        this.notify();
        return;
      case 'merging':
        if (canApply(job, 'merging')) {
          this.apply(job.id, { type: 'merging' });
          this.commit();
        }
        return;
      case 'done': {
        // Only a usable name is saved (isUsableDoneName): one the stored list loads
        // again, not made only of whitespace and dots. Anything else, a non-string
        // included, is "finished without a file" (no usable file name), not retried,
        // and the job keeps its previous name. The media engine reports a missing
        // file as the same not-retryable failure.
        if (!isUsableDoneName(ev.fileName)) {
          this.onFailure(job, { outcome: 'failed', reason: 'finished without a file', retryable: false });
          return;
        }
        const height = (count(ev.actualHeight) ?? 0) > 0 ? ev.actualHeight : null;
        const next = transition(job, { type: 'done', fileName: ev.fileName, actualHeight: height });
        // Marked before the window can list it as done, so it is never opened unmarked.
        try {
          this.markDownloaded(join(job.dir, ev.fileName), job.url);
        } catch {
          // best effort: a drive that cannot hold the mark never fails the download
        }
        this.replace({ ...next, bytesDone: next.bytesTotal ?? next.bytesDone });
        this.commit();
        this.announce(job);
        return;
      }
      case 'error':
        this.onFailure(job, ev);
        return;
    }
  }

  /** A job's engine gave up on it: retried after a delay when it may be, else failed or skipped and announced. */
  private onFailure(job: Job, ev: { outcome: 'failed' | 'skipped'; reason: string; retryable: boolean }): void {
    if (ev.outcome === 'failed' && ev.retryable && job.attempts < MAX_ATTEMPTS) {
      const attempts = job.attempts + 1;
      this.replace({ ...job, state: 'queued', attempts, reason: `retrying (${attempts}/${MAX_ATTEMPTS})`, speed: 0, eta: null });
      this.waitToken += 1;
      const token = this.waitToken;
      this.waiting.set(job.id, token);
      // Only the timer of the current wait releases it: an older wait's timer finds another token.
      this.setTimer(() => {
        if (this.closed || this.waiting.get(job.id) !== token) return;
        this.waiting.delete(job.id);
        this.commit();
      }, RETRY_DELAYS_MS[attempts - 1] ?? 60000);
      this.commit();
      return;
    }
    const type = ev.outcome === 'skipped' && canApply(job, 'skip') ? 'skip' : 'fail';
    this.apply(job.id, { type, reason: ev.reason });
    this.commit();
    this.announce(job);
  }

  /** Tells listeners that a lone job, or the whole group of `job`, has nothing left to do. */
  private announce(job: Job): void {
    const current = this.find(job.id);
    if (!current) return;
    if (current.groupId === null) {
      this.emitFinished({ kind: 'job', title: current.title, failed: current.state === 'failed' ? 1 : 0, skipped: current.state === 'skipped' ? 1 : 0 });
      return;
    }
    const members = this.jobs.filter((j) => j.groupId === current.groupId);
    if (members.some((j) => !TERMINAL.has(j.state))) return;
    this.emitGroup(current.groupId, members, current.title);
  }

  /**
   * After a job-level cancel of an unfinished job: the group is announced once when it still has
   * members, all of them are finished, and at least one is done or failed (not all skipped).
   */
  private announceGroupAfterCancel(groupId: string | null): void {
    if (groupId === null) return;
    const members = this.jobs.filter((j) => j.groupId === groupId);
    if (members.length === 0 || members.some((j) => !TERMINAL.has(j.state))) return;
    if (!members.some((j) => j.state === 'done' || j.state === 'failed')) return;
    this.emitGroup(groupId, members, members[0]?.title ?? '');
  }

  private emitGroup(groupId: string, members: Job[], fallbackTitle: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    this.emitFinished({
      kind: 'group',
      title: group?.title ?? fallbackTitle,
      failed: members.filter((j) => j.state === 'failed').length,
      skipped: members.filter((j) => j.state === 'skipped').length,
    });
  }

  private emitFinished(event: Finished): void {
    for (const l of this.finishedListeners) {
      try {
        l(event);
      } catch {
        // A listener that fails stops neither the queue nor the listeners after it.
      }
    }
  }

  /** Moves queued jobs to probing while slots are free, oldest first. Returns their ids; nothing while closed. */
  private schedule(): string[] {
    if (this.closed) return [];
    let active = this.jobs.filter((j) => ACTIVE.has(j.state)).length;
    const started: string[] = [];
    for (const job of [...this.jobs]) {
      if (active >= this.settings.maxConcurrent) break;
      if (job.state !== 'queued' || this.waiting.has(job.id) || this.cancelling.has(job.id)) continue;
      this.replace(transition(job, { type: 'start' }));
      active += 1;
      started.push(job.id);
    }
    return started;
  }

  /** After a state change: transition, prune empty groups, save, then start the engines and tell the window. */
  private commit(): void {
    const started = this.schedule();
    this.groups = this.groups.filter((g) => this.jobs.some((j) => j.groupId === g.id));
    this.save();
    if (started.length > 0) {
      const limit = this.share();
      for (const id of started) {
        const job = this.find(id);
        if (!job) continue;
        this.limits.set(id, limit);
        this.engineOf(job).start(job, { settings: this.settings, rateLimitBytes: limit });
      }
    }
    this.notify();
  }

  /** After a progress-only change: persist and notify at a bounded rate. */
  private progressTick(): void {
    if (this.now() - this.lastSave >= SAVE_PROGRESS_EVERY_MS) this.save();
    if (this.now() - this.lastNotify >= NOTIFY_EVERY_MS) {
      this.notify();
    } else if (!this.notifyPending) {
      this.notifyPending = true;
      this.setTimer(() => {
        if (this.notifyPending && !this.closed) this.notify();
      }, NOTIFY_EVERY_MS);
    }
  }

  /** Writes the list. Never throws: a failure is the save error, retried every SAVE_RETRY_MS until a save works. */
  private save(): void {
    this.lastSave = this.now();
    try {
      this.store.saveSnapshot(this.snapshot());
    } catch (e) {
      this.setSaveError(`could not save the download list: ${messageOf(e)}`);
      this.armSaveRetry();
      return;
    }
    this.setSaveError(null);
  }

  private armSaveRetry(): void {
    if (this.saveRetryPending) return;
    this.saveRetryPending = true;
    this.setTimer(() => {
      this.saveRetryPending = false;
      if (this.closed || this.saveError === null) return;
      this.save();
    }, SAVE_RETRY_MS);
  }

  private setSaveError(error: string | null): void {
    if (error === this.saveError) return;
    this.saveError = error;
    for (const l of this.saveListeners) {
      try {
        l(error);
      } catch {
        // A listener that fails stops neither the queue nor the listeners after it.
      }
    }
  }

  private notify(): void {
    this.lastNotify = this.now();
    this.notifyPending = false;
    const snap = this.snapshot();
    for (const l of this.changedListeners) {
      try {
        l(snap);
      } catch {
        // A listener that fails stops neither the queue nor the listeners after it (a quit still stops every job).
      }
    }
  }

  /** One speed budget: each active job's share in bytes/s, null = no limit. Never 0. */
  private share(): number | null {
    const { speedLimitKbps, maxConcurrent } = this.settings;
    if (speedLimitKbps === 0) return null;
    const active = this.jobs.filter((j) => ACTIVE.has(j.state)).length;
    return Math.max(1, Math.floor((speedLimitKbps * 1024) / Math.max(maxConcurrent, active)));
  }

  /**
   * After a settings save: a file job whose share changed, or whose last limit aria2 did not confirm,
   * is re-limited; a video still probing or downloading is restarted.
   */
  private retune(): void {
    if (this.closed) return;
    const limit = this.share();
    for (const job of this.jobs) {
      if (!ACTIVE.has(job.state) || this.limits.get(job.id) === limit) continue;
      if (job.kind === 'file') this.sendLimit(job.id, limit);
      else if (job.state !== 'merging') void this.enqueue(job.id, () => this.restartVerb(job.id));
    }
  }

  /**
   * Records the limit as sent, then sends it. When aria2 does not confirm it (false, a rejection or a
   * throw), the record is removed so the next settings save, even an identical one, sends it again.
   * The removal is guarded: a newer limit recorded meanwhile is not wiped by this older failure.
   */
  private sendLimit(id: string, limit: number | null): void {
    this.limits.set(id, limit);
    const forget = (): void => {
      if (this.limits.get(id) === limit) this.limits.delete(id);
    };
    let answer: Promise<boolean>;
    try {
      answer = this.file.setRateLimit(id, limit);
    } catch {
      forget();
      return;
    }
    void answer.then((confirmed) => {
      if (confirmed !== true) forget();
    }, forget);
  }

  /** Names held in the folder with this key: every listed job that is not skipped, and every playlist folder in it. */
  private claimsIn(key: string): string[] {
    const claims: string[] = [];
    for (const j of this.jobs) {
      if (j.state === 'skipped' || dirKey(j.dir) !== key) continue;
      const held = j.kind === 'media' ? j.baseName : j.fileName;
      if (held !== null) claims.push(held);
    }
    for (const g of this.groups) {
      if (dirKey(win32.dirname(g.dir)) === key) claims.push(win32.basename(g.dir));
    }
    return claims;
  }

  private diskNames(dir: string): string[] {
    try {
      return readdirSync(dir);
    } catch {
      return []; // the folder does not exist yet, so nothing in it is taken
    }
  }

  private engineOf(job: Job): Engine {
    return job.kind === 'media' ? this.media : this.file;
  }

  private find(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  private replace(next: Job): void {
    this.jobs = this.jobs.map((j) => (j.id === next.id ? next : j));
  }

  private remove(id: string): void {
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.limits.delete(id);
  }

  /** Applies a state-machine event when it is legal for the job's current state; otherwise does nothing. */
  private apply(id: string, ev: JobEvent): void {
    const job = this.find(id);
    if (job && canApply(job, ev.type)) this.replace(transition(job, ev));
  }
}
