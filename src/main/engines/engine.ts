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

export interface StartContext {
  settings: Settings;
  /** bytes per second for this one job, null = unlimited */
  rateLimitBytes: number | null;
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
