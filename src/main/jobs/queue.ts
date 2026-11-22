import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { AddRequest, Group, GroupVerb, Job, JobVerb, Settings, Snapshot } from '../../shared/types';
import type { Engine, EngineEvent } from '../engines/engine';
import { itemBaseName, sanitizeName, uniqueName } from '../naming';
import { ACTIVE, canApply, transition, type JobEvent } from './state';
import type { Store } from './store';

export const RETRY_DELAYS_MS = [5000, 20000, 60000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;
const NOTIFY_EVERY_MS = 250;
const SAVE_PROGRESS_EVERY_MS = 5000;

export interface Finished {
  kind: 'job' | 'group';
  title: string;
  failed: number;
  skipped: number;
}

export interface QueueDeps {
  store: Store;
  media: Engine;
  file: Engine & { setGlobalLimit(bytesPerSec: number): Promise<void> };
  initial: Snapshot;
  settings: Settings;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

const TERMINAL = new Set(['done', 'failed', 'skipped']);

export class Queue {
  private jobs: Job[];
  private groups: Group[];
  private settings: Settings;
  private readonly store: Store;
  private readonly media: Engine;
  private readonly file: QueueDeps['file'];
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;

  /** Jobs that are queued but must wait for their retry delay. */
  private readonly waiting = new Set<string>();
  private readonly changedListeners: ((s: Snapshot) => void)[] = [];
  private readonly finishedListeners: ((e: Finished) => void)[] = [];
  private lastNotify = 0;
  private notifyPending = false;
  private lastSave = 0;

  constructor(deps: QueueDeps) {
    this.store = deps.store;
    this.media = deps.media;
    this.file = deps.file;
    this.jobs = [...deps.initial.jobs];
    this.groups = [...deps.initial.groups];
    this.settings = deps.settings;
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.media.on((ev) => this.onEngineEvent(ev));
    this.file.on((ev) => this.onEngineEvent(ev));
    this.applyGlobalLimit();
    this.commit();
  }

  snapshot(): Snapshot {
    return { jobs: [...this.jobs], groups: [...this.groups] };
  }

  onChanged(listener: (s: Snapshot) => void): void {
    this.changedListeners.push(listener);
  }

  onFinished(listener: (e: Finished) => void): void {
    this.finishedListeners.push(listener);
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.applyGlobalLimit();
    this.commit();
  }

  add(req: AddRequest): void {
    const createdAt = this.now();
    const base = {
      url: req.url,
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
    };
    const probe = req.probe;

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
        fileName: uniqueName(stem, ext.slice(1), this.takenFileNames(req.dir)),
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
        baseName: uniqueName(itemBaseName(probe.title, null, null), '', this.takenBaseNames(req.dir)),
        index: null,
      });
    } else {
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
          reason: entry.unavailable ? 'unavailable' : null,
          quality: req.quality ?? this.settings.defaultQuality,
          dir: group.dir,
          baseName: uniqueName(itemBaseName(entry.title, entry.index, total), '', this.takenBaseNames(group.dir)),
          index: entry.index,
        });
      }
      if (added > 0) this.groups.push(group);
    }
    this.commit();
  }

  async job(id: string, verb: JobVerb): Promise<void> {
    await this.applyVerb(id, verb);
    this.commit();
  }

  async group(id: string, verb: GroupVerb): Promise<void> {
    const members = this.jobs.filter((j) => j.groupId === id).map((j) => j.id);
    if (verb === 'cancel') {
      await Promise.all(members.map((m) => (this.find(m)?.state === 'done' ? this.applyVerb(m, 'remove') : this.applyVerb(m, 'cancel'))));
      this.groups = this.groups.filter((g) => g.id !== id);
    } else {
      await Promise.all(members.map((m) => this.applyVerb(m, verb)));
    }
    this.commit();
  }

  resumeAllPaused(): void {
    for (const job of this.jobs) if (job.state === 'paused') this.apply(job.id, { type: 'resume' });
    this.commit();
  }

  async pauseAll(): Promise<void> {
    await Promise.all(this.jobs.map((j) => this.applyVerb(j.id, 'pause')));
    this.commit();
  }

  // ---- internals ----

  private async applyVerb(id: string, verb: JobVerb): Promise<void> {
    const job = this.find(id);
    if (!job) return;
    switch (verb) {
      case 'pause': {
        if (!canApply(job, 'pause')) return;
        // Stop first: the engine goes quiet at once, and a quick resume cannot meet a process that is still dying.
        if (ACTIVE.has(job.state)) await this.engineOf(job).stop(id);
        this.waiting.delete(id);
        this.apply(id, { type: 'pause' });
        return;
      }
      case 'resume':
        this.apply(id, { type: 'resume' });
        return;
      case 'retry':
        this.apply(id, { type: 'retry' });
        return;
      case 'cancel':
        if (job.state === 'done') return;
        this.waiting.delete(id);
        await this.engineOf(job).discard(job);
        this.remove(id);
        return;
      case 'remove':
      case 'removeWithFile':
        if (!TERMINAL.has(job.state)) return;
        if (verb === 'removeWithFile' && job.state === 'done' && job.fileName !== null) {
          try {
            rmSync(join(job.dir, job.fileName), { force: true });
          } catch {
            // In use or already gone; the entry is removed either way.
          }
        }
        this.remove(id);
        return;
    }
  }

  private onEngineEvent(ev: EngineEvent): void {
    const job = this.find(ev.jobId);
    if (!job || !ACTIVE.has(job.state)) return; // late event for a job that was paused, cancelled or finished

    switch (ev.type) {
      case 'progress': {
        const stateChanged = job.state === 'probing';
        const next = stateChanged ? transition(job, { type: 'firstProgress' }) : job;
        this.replace({ ...next, bytesDone: ev.bytesDone, bytesTotal: ev.bytesTotal ?? next.bytesTotal, speed: ev.speed, eta: ev.eta });
        if (stateChanged) this.commit();
        else this.progressTick();
        return;
      }
      case 'merging':
        if (canApply(job, 'merging')) {
          this.apply(job.id, { type: 'merging' });
          this.commit();
        }
        return;
      case 'done': {
        const next = transition(job, { type: 'done', fileName: ev.fileName, actualHeight: ev.actualHeight });
        this.replace({ ...next, bytesDone: next.bytesTotal ?? next.bytesDone });
        this.commit();
        this.announce(job);
        return;
      }
      case 'error': {
        if (ev.outcome === 'failed' && ev.retryable && job.attempts < MAX_ATTEMPTS) {
          const attempts = job.attempts + 1;
          this.replace({ ...job, state: 'queued', attempts, reason: `retrying (${attempts}/${MAX_ATTEMPTS})`, speed: 0, eta: null });
          this.waiting.add(job.id);
          this.setTimer(() => {
            if (this.waiting.delete(job.id)) this.commit();
          }, RETRY_DELAYS_MS[attempts - 1] ?? 60000);
          this.commit();
          return;
        }
        const type = ev.outcome === 'skipped' && canApply(job, 'skip') ? 'skip' : 'fail';
        this.apply(job.id, { type, reason: ev.reason });
        this.commit();
        this.announce(job);
        return;
      }
    }
  }

  /** Tells listeners that a lone job, or the whole group of `job`, has nothing left to do. */
  private announce(job: Job): void {
    const current = this.find(job.id);
    if (!current) return;
    let event: Finished;
    if (current.groupId === null) {
      event = { kind: 'job', title: current.title, failed: current.state === 'failed' ? 1 : 0, skipped: current.state === 'skipped' ? 1 : 0 };
    } else {
      const members = this.jobs.filter((j) => j.groupId === current.groupId);
      if (members.some((j) => !TERMINAL.has(j.state))) return;
      const group = this.groups.find((g) => g.id === current.groupId);
      event = {
        kind: 'group',
        title: group?.title ?? current.title,
        failed: members.filter((j) => j.state === 'failed').length,
        skipped: members.filter((j) => j.state === 'skipped').length,
      };
    }
    for (const l of this.finishedListeners) l(event);
  }

  /** Starts queued jobs while slots are free, oldest first. */
  private schedule(): void {
    let active = this.jobs.filter((j) => ACTIVE.has(j.state)).length;
    for (const job of [...this.jobs]) {
      if (active >= this.settings.maxConcurrent) break;
      if (job.state !== 'queued' || this.waiting.has(job.id)) continue;
      const started = transition(job, { type: 'start' });
      this.replace(started);
      active += 1;
      this.engineOf(started).start(started, { settings: this.settings, rateLimitBytes: this.mediaRateLimit() });
    }
  }

  /** After a state change: fill free slots, persist, tell the window. */
  private commit(): void {
    this.schedule();
    this.groups = this.groups.filter((g) => this.jobs.some((j) => j.groupId === g.id));
    this.save();
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
        if (this.notifyPending) this.notify();
      }, NOTIFY_EVERY_MS);
    }
  }

  private save(): void {
    this.lastSave = this.now();
    this.store.saveSnapshot(this.snapshot());
  }

  private notify(): void {
    this.lastNotify = this.now();
    this.notifyPending = false;
    const snap = this.snapshot();
    for (const l of this.changedListeners) l(snap);
  }

  private mediaRateLimit(): number | null {
    const { speedLimitKbps, maxConcurrent } = this.settings;
    return speedLimitKbps === 0 ? null : Math.floor((speedLimitKbps * 1024) / maxConcurrent);
  }

  private applyGlobalLimit(): void {
    // aria2 may not be up yet or may have died; the limit is re-sent on the next settings change.
    this.file.setGlobalLimit(this.settings.speedLimitKbps * 1024).catch(() => undefined);
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
  }

  /** Applies a state-machine event when it is legal for the job's current state; otherwise does nothing. */
  private apply(id: string, ev: JobEvent): void {
    const job = this.find(id);
    if (job && canApply(job, ev.type)) this.replace(transition(job, ev));
  }

  private sameDir(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }

  private takenBaseNames(dir: string): Set<string> {
    return new Set(this.jobs.filter((j) => j.baseName !== null && this.sameDir(j.dir, dir)).map((j) => j.baseName as string));
  }

  private takenFileNames(dir: string): Set<string> {
    const taken = new Set(this.jobs.filter((j) => j.fileName !== null && this.sameDir(j.dir, dir)).map((j) => j.fileName as string));
    try {
      for (const name of readdirSync(dir)) taken.add(name);
    } catch {
      // The folder does not exist yet, so nothing in it is taken.
    }
    return taken;
  }
}
