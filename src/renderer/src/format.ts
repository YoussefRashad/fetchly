import type { Job, JobVerb } from '../../shared/types';
import { S, type Strings } from './strings';

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

export function formatBytes(n: number | null): string {
  if (n === null) return '—';
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : '';
}

export function formatEta(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '';
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Share downloaded, 0..100, or null when the size is not known. */
export function percent(job: Job): number | null {
  if (job.state === 'done') return 100;
  if (job.bytesTotal === null || job.bytesTotal <= 0) return null;
  return Math.min(100, Math.floor((job.bytesDone / job.bytesTotal) * 100));
}

const RETRYING = /^retrying \((\d+)\/(\d+)\)$/u;

/** A reason from the main process in the language in use; one without a translation is kept as it came. */
export function reasonText(reason: string): string {
  if (Object.hasOwn(S.reasons, reason)) return S.reasons[reason as keyof Strings['reasons']];
  const retry = RETRYING.exec(reason);
  if (retry) return S.status.retrying(Number(retry[1]), Number(retry[2]));
  return reason;
}

/**
 * The parts of a job's status, shown joined by " · ". The downloaded bytes are not among them:
 * the size column shows those.
 */
export function statusParts(job: Job): string[] {
  const pct = percent(job);
  const t = S.status;
  switch (job.state) {
    case 'queued':
      return [job.reason === null ? t.queued : reasonText(job.reason)];
    case 'probing':
      return [t.starting];
    case 'downloading': {
      const parts = [pct === null ? '' : `${pct}%`, formatSpeed(job.speed), formatEta(job.eta)];
      if (!job.resumable) parts.push(t.cannotResume);
      return parts.filter((p) => p !== '');
    }
    case 'paused': {
      const parts = [pct === null ? t.paused : t.pausedAt(pct)];
      // A cut-off job cannot resume until its old processes are known to be gone.
      if (job.interrupted) parts.push(t.waitingForCheck);
      return parts;
    }
    case 'merging':
      return [t.finishing];
    case 'done':
      return [t.done];
    case 'failed':
      return [job.reason ? t.failedWith(reasonText(job.reason)) : t.failed];
    case 'skipped':
      return [job.reason ? t.skippedWith(reasonText(job.reason)) : t.skipped];
  }
}

export function statusText(job: Job): string {
  return statusParts(job).join(' · ');
}

export interface SizeParts {
  /** Downloaded so far, in `unit`; null when only the total is shown. */
  done: string | null;
  /** The size, in `unit`; null when it is not known. */
  total: string | null;
  unit: string;
  /** True exactly for a media job with a total: that total is the current stream's size only. */
  approx: boolean;
}

type Unit = 0 | 1 | 2 | 3;
/** Decimals per unit: B 0, KB 0, MB 1, GB 2. */
const DECIMALS = [0, 0, 1, 2] as const;

const inUnit = (n: number, unit: Unit): string => (n / 1024 ** unit).toFixed(DECIMALS[unit]);

/** A total in `unit`: fixed decimals, but none when the rounded value is a whole number ("310", not "310.0"). */
function totalInUnit(n: number, unit: Unit): string {
  const text = inUnit(n, unit);
  return /^\d+\.0+$/u.test(text) ? text.slice(0, text.indexOf('.')) : text;
}

/** The unit of `n` (base 1024), moved up when rounding would show 1024 of it. */
function unitOf(n: number): Unit {
  let unit: Unit = 0;
  while (unit < 3 && Number(inUnit(n, unit)) >= 1024) unit = (unit + 1) as Unit;
  return unit;
}

/**
 * The size column: what was downloaded and the size, both in the size's unit (the done figure's
 * own unit while the size is unknown). null = an empty cell. A size of 0 counts as unknown, as
 * in percent(). The done figure is never clamped to the size, and keeps the unit's fixed decimals
 * (it changes every second and must not change width); a size that rounds to a whole number drops them.
 */
export function sizeParts(job: Job): SizeParts | null {
  const total = job.bytesTotal !== null && job.bytesTotal > 0 ? job.bytesTotal : null;
  const media = job.kind === 'media';
  const totalOnly = (): SizeParts | null => {
    if (media || total === null) return null;
    const unit = unitOf(total);
    return { done: null, total: totalInUnit(total, unit), unit: UNITS[unit], approx: false };
  };
  const progress = (): SizeParts => {
    const unit = unitOf(total ?? job.bytesDone);
    return {
      done: inUnit(job.bytesDone, unit),
      total: total === null ? null : totalInUnit(total, unit),
      unit: UNITS[unit],
      approx: media && total !== null,
    };
  };
  switch (job.state) {
    case 'downloading':
    case 'paused':
      return progress();
    case 'failed':
      return job.bytesDone > 0 ? progress() : null;
    case 'queued':
    case 'probing':
    case 'done':
      return totalOnly();
    case 'merging':
    case 'skipped':
      return null;
  }
}

export type Filter = 'all' | 'downloading' | 'paused' | 'done' | 'failed';

export function matchesFilter(job: Job, f: Filter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'downloading':
      return job.state === 'queued' || job.state === 'probing' || job.state === 'downloading' || job.state === 'merging';
    case 'paused':
      return job.state === 'paused';
    case 'done':
      return job.state === 'done';
    case 'failed':
      return job.state === 'failed' || job.state === 'skipped';
  }
}

/** The actions offered for a job, in the order the buttons are shown. */
export function allowedVerbs(job: Job): JobVerb[] {
  switch (job.state) {
    case 'queued':
    case 'probing':
    case 'downloading':
      return ['pause', 'cancel'];
    case 'merging':
      return ['cancel'];
    case 'paused':
      // A cut-off job is refused resume until the check succeeds or is confirmed.
      return job.interrupted ? ['cancel'] : ['resume', 'cancel'];
    case 'failed':
      return ['retry', 'remove'];
    case 'skipped':
      return ['remove'];
    case 'done':
      return ['remove', 'removeWithFile'];
  }
}

/** Progress of a playlist: skipped items cannot be downloaded, so they do not count. */
export function groupSummary(jobs: Job[]): { done: number; total: number; percent: number } {
  const countable = jobs.filter((j) => j.state !== 'skipped');
  const done = countable.filter((j) => j.state === 'done').length;
  const total = countable.length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** The quality column; empty for a file, whose size has its own column. */
export function qualityLabel(job: Job): string {
  if (job.kind === 'file') return '';
  if (job.actualHeight !== null) return `${job.actualHeight}p`;
  const q = job.quality;
  if (q === null) return '';
  if (q.kind === 'best') return S.qualityBestShort;
  if (q.kind === 'max') return `≤${q.height}p`;
  return q.format;
}
