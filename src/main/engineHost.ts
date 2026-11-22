import type { EngineStatus } from '../shared/types';
import type { Aria2Daemon } from './engines/file';

export interface EngineHostDeps<Q> {
  /** All three tools are present. */
  toolsInstalled(): Promise<boolean>;
  /** true = no leftover tool process is running. Never rejects. */
  killStrays(): Promise<boolean>;
  /** Rejects when aria2 cannot start. */
  startAria2(): Promise<Aria2Daemon>;
  /** Builds the engines and the queue around a running aria2. Synchronous; may throw. */
  createQueue(daemon: Aria2Daemon, straysCleared: boolean): Q;
  /** Hands a restarted aria2 to the file engine that createQueue built. */
  attachDaemon(daemon: Aria2Daemon): void;
  /** Called when the status changes (state or message), not otherwise. */
  onStatus(status: EngineStatus): void;
}

const COULD_NOT_START = 'The download tools could not be started: ';
const SERVICE_STOPPED = 'The file download service stopped';

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function same(a: EngineStatus, b: EngineStatus): boolean {
  if (a.state !== b.state) return false;
  return a.state !== 'error' || a.message === (b as { message: string }).message;
}

/**
 * Starts the download tools and owns the queue built on them (B17).
 * start() and retry() never reject; their outcome is status(). Only one start or
 * restart runs at a time: a call made while one runs waits for that run.
 */
export class EngineHost<Q> {
  private current: EngineStatus = { state: 'starting' };
  private q: Q | null = null;
  /** The running or last started aria2, for quit. */
  private lastDaemon: Aria2Daemon | null = null;
  /** The aria2 whose unexpected exit is reported; null once it exited or was given up. */
  private watched: Aria2Daemon | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: EngineHostDeps<Q>) {}

  /** A copy: later changes do not alter a value already handed out. */
  status(): EngineStatus {
    return { ...this.current };
  }

  queue(): Q | null {
    return this.q;
  }

  daemon(): Aria2Daemon | null {
    return this.lastDaemon;
  }

  /** Starts the engines unless a queue exists. From `error` without a queue it runs like retry(). */
  start(): Promise<void> {
    if (this.running) return this.running;
    if (this.q !== null) return Promise.resolve();
    return this.single(() => this.startAll());
  }

  /** Acts only from `error`: a full start without a queue, an aria2 restart with one. */
  retry(): Promise<void> {
    if (this.current.state !== 'error') return Promise.resolve();
    if (this.running) return this.running;
    return this.single(() => (this.q === null ? this.startAll() : this.restartAria2()));
  }

  private single(run: () => Promise<void>): Promise<void> {
    const p = run()
      .catch(() => undefined)
      .finally(() => {
        if (this.running === p) this.running = null;
      });
    this.running = p;
    return p;
  }

  private set(next: EngineStatus): void {
    if (same(this.current, next)) return;
    this.current = next;
    try {
      this.deps.onStatus({ ...next });
    } catch {
      // A listener that fails does not change what the engines are doing.
    }
  }

  private fail(e: unknown): void {
    this.set({ state: 'error', message: `${COULD_NOT_START}${message(e)}` });
  }

  /** Reports the daemon's state once it is in use: ready, or stopped if it already died. */
  private settle(daemon: Aria2Daemon): void {
    if (daemon.alive()) {
      this.set({ state: 'ready' });
    } else {
      if (this.watched === daemon) this.watched = null;
      this.set({ state: 'error', message: SERVICE_STOPPED });
    }
  }

  private watch(daemon: Aria2Daemon): void {
    this.lastDaemon = daemon;
    this.watched = daemon;
    daemon.onExit(() => {
      // Only the current aria2 counts, once, and only while a queue depends on it.
      if (this.watched !== daemon || this.q === null) return;
      this.watched = null;
      this.set({ state: 'error', message: SERVICE_STOPPED });
    });
  }

  /** Gives up an aria2 this run started: its exit is no longer reported, and it is stopped. */
  private async abandon(daemon: Aria2Daemon): Promise<void> {
    if (this.watched === daemon) this.watched = null;
    try {
      await daemon.stop();
    } catch {
      // The failure itself is what gets reported.
    }
  }

  private async startAll(): Promise<void> {
    let daemon: Aria2Daemon | null = null;
    try {
      if (!(await this.deps.toolsInstalled())) {
        this.set({ state: 'notInstalled' });
        return;
      }
      this.set({ state: 'starting' });
      const straysCleared = await this.deps.killStrays();
      daemon = await this.deps.startAria2();
      this.watch(daemon);
      this.q = this.deps.createQueue(daemon, straysCleared);
    } catch (e) {
      if (daemon) await this.abandon(daemon);
      this.fail(e);
      return;
    }
    this.settle(daemon);
  }

  /** 9.4: a new aria2 for the queue that exists. No stray check: this run's own tools are running. */
  private async restartAria2(): Promise<void> {
    this.set({ state: 'starting' });
    let daemon: Aria2Daemon | null = null;
    try {
      daemon = await this.deps.startAria2();
      this.watch(daemon);
      this.deps.attachDaemon(daemon);
    } catch (e) {
      if (daemon) await this.abandon(daemon);
      this.fail(e);
      return;
    }
    this.settle(daemon);
  }
}
