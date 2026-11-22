import { Aria2RpcError, Aria2TransportError } from '../../src/main/engines/file';
import type { Aria2Rpc } from '../../src/main/engines/file';

export type FakeStatus = Record<string, string>;

/** The text of the Aria2RpcError the fake throws for a method listed in `refuse`. */
export const refusalMessage = (method: string): string => `${method} was refused`;

/** An in-process stand-in for the aria2 JSON-RPC interface. */
export class FakeAria2 implements Aria2Rpc {
  readonly calls: { method: string; params: unknown[] }[] = [];
  private readonly scripts: FakeStatus[][] = [];
  private readonly byGid = new Map<string, FakeStatus[]>();
  private readonly holds = new Map<string, Promise<void>>();
  private nextGid = 1;
  /** addUri throws Aria2TransportError (nobody answers). */
  failAddUri = false;
  /** true: every call throws Aria2TransportError, as when aria2 does not answer at all. */
  transportDown = false;
  /** Methods that throw Aria2RpcError, as when aria2 answers with an error member. */
  readonly refuse = new Set<string>();

  /** Queues the statuses the next added download will report, in order; the last one repeats. */
  script(...statuses: FakeStatus[]): void {
    this.scripts.push(statuses);
  }

  methods(): string[] {
    return this.calls.map((c) => c.method);
  }

  /**
   * Calls of `method` wait until the returned function is called. A call is recorded in `calls`
   * when it arrives; its outcome (transportDown, refuse, the scripted answer) is decided when it
   * is released.
   */
  hold(method: string): () => void {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const previous = this.holds.get(method);
    const combined = previous ? Promise.all([previous, gate]).then(() => undefined) : gate;
    this.holds.set(method, combined);
    return () => {
      open();
      if (this.holds.get(method) === combined) this.holds.delete(method);
    };
  }

  async call(method: string, params: unknown[]): Promise<unknown> {
    this.calls.push({ method, params });
    const gate = this.holds.get(method);
    if (gate) await gate;
    if (this.transportDown) throw new Aria2TransportError('connect ECONNREFUSED');
    if (this.refuse.has(method)) throw new Aria2RpcError(refusalMessage(method), 1);
    if (method === 'aria2.addUri') {
      if (this.failAddUri) throw new Aria2TransportError('connect ECONNREFUSED');
      const gid = `gid${this.nextGid++}`;
      this.byGid.set(gid, this.scripts.shift() ?? [{ status: 'active', completedLength: '0', totalLength: '0', downloadSpeed: '0' }]);
      return gid;
    }
    if (method === 'aria2.tellStatus') {
      const seq = this.byGid.get(params[0] as string);
      if (!seq) throw new Aria2RpcError(`GID ${String(params[0])} is not found`, 1);
      return seq.length > 1 ? seq.shift() : seq[0];
    }
    return 'OK';
  }
}

export const active = (done: number, total: number, speed: number): FakeStatus => ({
  status: 'active',
  completedLength: String(done),
  totalLength: String(total),
  downloadSpeed: String(speed),
});

export const complete = (total: number): FakeStatus => ({
  status: 'complete',
  completedLength: String(total),
  totalLength: String(total),
  downloadSpeed: '0',
});

/** aria2 knows the download but has not started it (or paused it): nothing to report. */
export const waiting = (): FakeStatus => ({
  status: 'waiting',
  completedLength: '0',
  totalLength: '0',
  downloadSpeed: '0',
});

export const failed = (errorCode: number, errorMessage: string): FakeStatus => ({
  status: 'error',
  completedLength: '10',
  totalLength: '100',
  downloadSpeed: '0',
  errorCode: String(errorCode),
  errorMessage,
});
