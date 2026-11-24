import type { Job, Settings } from '../../shared/types';

export type EngineEvent = { jobId: string } & (
  | { type: 'progress'; bytesDone: number; bytesTotal: number | null; speed: number; eta: number | null }
  | { type: 'merging' }
  | { type: 'done'; fileName: string; actualHeight: number | null }
  | { type: 'error'; outcome: 'failed' | 'skipped'; reason: string; retryable: boolean }
  /** Highest video height the site offers, read before the download. Always finite and > 0;
   *  an engine never emits another value (no height known: no event). */
  | { type: 'probed'; sourceHeight: number }
);

/** A sign-in held for one run. A5 defines it; in A3 no value of it exists, so `cookies` is always null. */
export type CookieSource = never;

/**
 * What one run of a job sends besides its link. `StartContext.extras: null` and an object whose three values are all
 * null mean the same. A3's engines read `referer` and `userAgent` only, and never `cookies`.
 */
export interface RunExtras {
  referer: string | null;
  userAgent: string | null;
  cookies: CookieSource | null;
}

/** Thrown by `QueueDeps.extrasFor` when a job cannot start: `reason` is shown to the user as is. */
export class ExtrasError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ExtrasError';
  }
}

export interface StartContext {
  settings: Settings;
  /** bytes per second for this one job, null = unlimited */
  rateLimitBytes: number | null;
  /** The headers (and, from A5, the sign-in) of this one start; null = none. */
  extras: RunExtras | null;
}

export type EngineListener = (ev: EngineEvent) => void;

export interface Engine {
  start(job: Job, ctx: StartContext): void;
  /**
   * Stops the download and keeps its partial data.
   * Resolves = the stop is confirmed: the engine released the job and emits no event for it.
   * Resolves at once when the engine does not own the job.
   * Rejects = the stop is not confirmed: the engine still owns the job, keeps reporting it
   * (progress and its final event), and a later stop tries again.
   */
  stop(jobId: string): Promise<void>;
  /**
   * Stops the download if it is running, then deletes its partial data.
   * Rejects, deleting nothing, when the stop is not confirmed.
   */
  discard(job: Job): Promise<void>;
  on(listener: EngineListener): void;
}
