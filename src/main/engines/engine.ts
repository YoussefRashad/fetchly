import type { Job, Settings } from '../../shared/types';

export type EngineEvent = { jobId: string } & (
  | { type: 'progress'; bytesDone: number; bytesTotal: number | null; speed: number; eta: number | null }
  | { type: 'merging' }
  | { type: 'done'; fileName: string; actualHeight: number | null }
  | { type: 'error'; outcome: 'failed' | 'skipped'; reason: string; retryable: boolean }
);

export interface StartContext {
  settings: Settings;
  /** bytes per second for this one job, null = unlimited */
  rateLimitBytes: number | null;
}

export type EngineListener = (ev: EngineEvent) => void;

export interface Engine {
  start(job: Job, ctx: StartContext): void;
  /** Stops the download and keeps its partial data. No event is emitted for a stopped job. */
  stop(jobId: string): Promise<void>;
  /** Stops the download if it is running, then deletes its partial data. */
  discard(job: Job): Promise<void>;
  on(listener: EngineListener): void;
}
