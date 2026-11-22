import type { Job, JobVerb } from '../../shared/types';

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

export function statusText(job: Job): string {
  const pct = percent(job);
  switch (job.state) {
    case 'queued':
      return job.reason ?? 'queued';
    case 'probing':
      return 'starting…';
    case 'downloading': {
      const parts = [pct === null ? formatBytes(job.bytesDone) : `${pct}%`, formatSpeed(job.speed), formatEta(job.eta)];
      if (!job.resumable) parts.push('cannot resume');
      return parts.filter((p) => p !== '').join(' · ');
    }
    case 'paused':
      return pct === null ? 'paused' : `paused ${pct}%`;
    case 'merging':
      return 'finishing…';
    case 'done':
      return 'done';
    case 'failed':
      return job.reason ? `failed: ${job.reason}` : 'failed';
    case 'skipped':
      return job.reason ? `skipped: ${job.reason}` : 'skipped';
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
      return ['resume', 'cancel'];
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

export function qualityLabel(job: Job): string {
  if (job.kind === 'file') return formatBytes(job.bytesTotal);
  if (job.actualHeight !== null) return `${job.actualHeight}p`;
  const q = job.quality;
  if (q === null) return '';
  if (q.kind === 'best') return 'best';
  if (q.kind === 'max') return `≤${q.height}p`;
  return q.format;
}
