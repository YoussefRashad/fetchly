/**
 * Keeps the start-up cleanup of leftover tool processes apart from the app's own short tool runs.
 *
 * The cleanup ends every yt-dlp, ffmpeg and aria2c started from the app's tool folder, so a probe,
 * version check or yt-dlp update running at that moment would be ended with it. The cleanup runs
 * `exclusive`: it starts once the `shared` runs already going have ended. A shared run asked for
 * while a cleanup runs or waits starts after it, so a stream of probes cannot hold a cleanup off.
 * A rejection is passed on to its caller and never keeps the gate closed.
 */
export class ToolGate {
  /** Shared runs going now. */
  private active = 0;
  /** Exclusive runs asked for and not yet ended, the running one included. */
  private pendingExclusive = 0;
  /** Settles when the last exclusive run asked for so far has ended. */
  private exclusiveTail: Promise<void> = Promise.resolve();
  private idleWaiters: (() => void)[] = [];

  async shared<T>(run: () => Promise<T>): Promise<T> {
    while (this.pendingExclusive > 0) await this.exclusiveTail;
    this.active += 1;
    try {
      return await run();
    } finally {
      this.active -= 1;
      if (this.active === 0) this.wakeIdle();
    }
  }

  exclusive<T>(run: () => Promise<T>): Promise<T> {
    this.pendingExclusive += 1;
    const result = this.exclusiveTail.then(async () => {
      try {
        await this.idle();
        return await run();
      } finally {
        // Before `result` settles, so a shared run woken by the tail sees this run as ended.
        this.pendingExclusive -= 1;
      }
    });
    this.exclusiveTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private idle(): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private wakeIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const wake of waiters) wake();
  }
}
