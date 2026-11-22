import type { Aria2Rpc } from '../../src/main/engines/file';

export type FakeStatus = Record<string, string>;

/** An in-process stand-in for the aria2 JSON-RPC interface. */
export class FakeAria2 implements Aria2Rpc {
  readonly calls: { method: string; params: unknown[] }[] = [];
  private readonly scripts: FakeStatus[][] = [];
  private readonly byGid = new Map<string, FakeStatus[]>();
  private nextGid = 1;
  failAddUri = false;

  /** Queues the statuses the next added download will report, in order; the last one repeats. */
  script(...statuses: FakeStatus[]): void {
    this.scripts.push(statuses);
  }

  methods(): string[] {
    return this.calls.map((c) => c.method);
  }

  async call(method: string, params: unknown[]): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'aria2.addUri') {
      if (this.failAddUri) throw new Error('connect ECONNREFUSED');
      const gid = `gid${this.nextGid++}`;
      this.byGid.set(gid, this.scripts.shift() ?? [{ status: 'active', completedLength: '0', totalLength: '0', downloadSpeed: '0' }]);
      return gid;
    }
    if (method === 'aria2.tellStatus') {
      const seq = this.byGid.get(params[0] as string);
      if (!seq) throw new Error('GID not found');
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

export const failed = (errorCode: number, errorMessage: string): FakeStatus => ({
  status: 'error',
  completedLength: '10',
  totalLength: '100',
  downloadSpeed: '0',
  errorCode: String(errorCode),
  errorMessage,
});
