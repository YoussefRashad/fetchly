import type { Job, JobState } from '../../shared/types';

export type JobEvent =
  | { type: 'start' }
  | { type: 'firstProgress' }
  | { type: 'merging' }
  | { type: 'done'; fileName: string; actualHeight: number | null }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'retry' }
  | { type: 'fail'; reason: string }
  | { type: 'skip'; reason: string }
  /** Quit stops a running job, merging included. */
  | { type: 'interrupt' }
  /** A new speed limit restarts a running job; it keeps its progress and attempts. */
  | { type: 'requeue' };

export class IllegalTransition extends Error {
  constructor(from: JobState, event: JobEvent['type']) {
    super(`cannot ${event} a job that is ${from}`);
    this.name = 'IllegalTransition';
  }
}

/** States that hold a queue slot: a process is running for the job. */
export const ACTIVE: ReadonlySet<JobState> = new Set<JobState>(['probing', 'downloading', 'merging']);

const TABLE: Record<JobEvent['type'], Partial<Record<JobState, JobState>>> = {
  start: { queued: 'probing' },
  firstProgress: { probing: 'downloading' },
  merging: { probing: 'merging', downloading: 'merging' },
  done: { probing: 'done', downloading: 'done', merging: 'done' },
  pause: { queued: 'paused', probing: 'paused', downloading: 'paused' },
  resume: { paused: 'queued' },
  retry: { failed: 'queued' },
  fail: { queued: 'failed', probing: 'failed', downloading: 'failed', merging: 'failed' },
  skip: { queued: 'skipped', probing: 'skipped', downloading: 'skipped' },
  interrupt: { probing: 'paused', downloading: 'paused', merging: 'paused' },
  requeue: { probing: 'queued', downloading: 'queued' },
};

export function canApply(job: Job, type: JobEvent['type']): boolean {
  return TABLE[type][job.state] !== undefined;
}

export function transition(job: Job, ev: JobEvent): Job {
  const to = TABLE[ev.type][job.state];
  if (to === undefined) throw new IllegalTransition(job.state, ev.type);
  const next: Job = { ...job, state: to };
  switch (ev.type) {
    case 'done':
      return { ...next, fileName: ev.fileName, actualHeight: ev.actualHeight, speed: 0, eta: null, reason: null };
    case 'fail':
    case 'skip':
      return { ...next, reason: ev.reason, speed: 0, eta: null };
    case 'pause':
    case 'interrupt':
      return { ...next, speed: 0, eta: null };
    case 'requeue':
      return { ...next, reason: null, speed: 0, eta: null };
    case 'resume':
      return { ...next, reason: null };
    case 'retry':
      return { ...next, reason: null, attempts: 0 };
    default:
      return next;
  }
}
