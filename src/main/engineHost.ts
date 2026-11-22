import type { EngineStatus } from '../shared/types';
import type { Aria2Daemon } from './engines/file';

export interface EngineHostDeps<Q> {
  /** All three tools are present. */
  toolsInstalled(): Promise<boolean>;
  /** true = no leftover tool process is running. Never rejects. */
  killStrays(): Promise<boolean>;
  /** Rejects when aria2 cannot start. */
  startAria2(): Promise<Aria2Daemon>;
  /** Constructs only: the engines and the queue around a running aria2. Synchronous; may throw. */
  createQueue(daemon: Aria2Daemon, straysCleared: boolean): Q;
  /**
   * All fallible wiring of a constructed queue: its listeners, the tray, auto-resume and the first
   * push to the window. Synchronous; may throw. The host hands out the queue only once this returned.
   */
  wireQueue(queue: Q): void;
  /** Shuts down a queue whose wiring failed. The host stops aria2 only after this settled. */
  disposeQueue(queue: Q): Promise<void>;
  /** Hands a restarted aria2 to the file engine of the wired queue. */
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
 * Starts the download tools and owns the queue built on them (B17), from construction to
 * disposal: a queue whose wiring fails is shut down before its aria2 is stopped, and before
 * any later start can build another one.
 * start() and retry() never reject; their outcome is status(). Only one start or
 * restart runs at a time: a start or a retry made while one runs waits for that run and
 * starts nothing itself; with no run, a retry acts only from `error`.
 */
export class EngineHost<Q> {
  private current: EngineStatus = { state: 'starting' };
  /** The wired queue; null until wireQueue returned. A queue whose wiring failed is never handed out. */
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

  /** The queue, once built and wired; null before that and after a failed wiring. */
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

  /**
   * While a start or restart runs (a queue dispose included), joins it and resolves when it has
   * settled, so the status is that run's outcome. Otherwise acts only from `error`: a full start
   * without a queue, an aria2 restart with one; in any other state it resolves at once and does nothing.
   */
  retry(): Promise<void> {
    if (this.running) return this.running;
    if (this.current.state !== 'error') return Promise.resolve();
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
    let queue: Q;
    try {
      if (!(await this.deps.toolsInstalled())) {
        this.set({ state: 'notInstalled' });
        return;
      }
      this.set({ state: 'starting' });
      const straysCleared = await this.deps.killStrays();
      daemon = await this.deps.startAria2();
      this.watch(daemon);
      queue = this.deps.createQueue(daemon, straysCleared);
    } catch (e) {
      if (daemon) await this.abandon(daemon);
      this.fail(e);
      return;
    }
    try {
      this.deps.wireQueue(queue);
    } catch (e) {
      // The queue goes first: its stops need aria2 to confirm them. No time cap: a dispose
      // that never settles means no second queue, which is the safe side.
      try {
        await this.deps.disposeQueue(queue);
      } catch {
        // The wiring failure is what gets reported.
      }
      await this.abandon(daemon);
      this.fail(e);
      return;
    }
    this.q = queue;
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
