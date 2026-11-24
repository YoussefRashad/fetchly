/**
 * Injected clocks and timers for the A2 specs (tests/extension/**). Nothing here sleeps: the specs move time by
 * calling advance() or skew(), and let promise chains settle with flush().
 */

/** Two independent clocks (E7: monotonic and wall) and one timer queue that runs on the monotonic one. */
export class FakeClock {
  /** The monotonic clock, `now()` of the client. */
  mono = 1_000_000;
  /** The wall clock, `wallNow()` of the client. */
  wall = 1_700_000_000_000;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  readonly now = (): number => this.mono;
  readonly wallNow = (): number => this.wall;

  readonly setTimer = (fn: () => void, ms: number): number => {
    this.seq += 1;
    this.timers.set(this.seq, { at: this.mono + ms, fn });
    return this.seq;
  };

  readonly clearTimer = (handle: unknown): void => {
    if (typeof handle === 'number') this.timers.delete(handle);
  };

  /** Milliseconds until each pending timer fires, soonest first. */
  pending(): number[] {
    return [...this.timers.values()].map((x) => x.at - this.mono).sort((a, b) => a - b);
  }

  /** Moves both clocks by `ms` and runs every timer that falls due, in order (a timer may arm another). */
  advance(ms: number): void {
    const target = this.mono + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, x] of this.timers) {
        if (x.at <= target && x.at < nextAt) {
          nextAt = x.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const timer = this.timers.get(nextId);
      this.timers.delete(nextId);
      const step = Math.max(0, nextAt - this.mono);
      this.mono += step;
      this.wall += step;
      timer?.fn();
    }
    this.wall += target - this.mono;
    this.mono = target;
  }

  /** Moves the clocks without running any timer (a sleep, a clock change). */
  skew(by: { mono?: number; wall?: number }): void {
    this.mono += by.mono ?? 0;
    this.wall += by.wall ?? 0;
  }
}

/** Lets every promise chain and stream callback that can run without a timer run. */
export async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Waits (in real time, 1 ms steps) until `check()` is true. WebCrypto runs on the thread pool, so a chain that
 * includes it cannot be settled with flush(); a spec waits for the event it needs instead. It fails after
 * `limitMs`; on a working run it returns within a few milliseconds.
 */
export async function until(check: () => boolean, limitMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > limitMs) throw new Error('until(): the condition never became true');
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  await flush(1);
}

/** Lets everything that is going to happen without a timer happen, including WebCrypto (a few real milliseconds). */
export async function idle(ms = 15): Promise<void> {
  await flush();
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  await flush();
}

export interface Tracked<T> {
  state: 'pending' | 'fulfilled' | 'rejected';
  value: T | undefined;
  error: unknown;
  /** The promise itself, for awaiting. */
  promise: Promise<T>;
}

/** Watches a promise so a spec can say "still pending" without awaiting it. */
export function track<T>(promise: Promise<T>): Tracked<T> {
  const t: Tracked<T> = { state: 'pending', value: undefined, error: undefined, promise };
  promise.then(
    (v) => {
      t.state = 'fulfilled';
      t.value = v;
    },
    (e: unknown) => {
      t.state = 'rejected';
      t.error = e;
    },
  );
  return t;
}

/** An ordered list of events from several fakes, so a spec can say "this before that". */
export class Trace {
  readonly events: string[] = [];
  push(event: string): void {
    this.events.push(event);
  }
  indexOf(event: string, from = 0): number {
    return this.events.indexOf(event, from);
  }
  /** Events that start with `prefix`, in order. */
  where(prefix: string): string[] {
    return this.events.filter((e) => e.startsWith(prefix));
  }
}
