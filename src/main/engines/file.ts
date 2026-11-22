import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { Job } from '../../shared/types';
import type { Engine, EngineEvent, EngineListener, StartContext } from './engine';

export interface Aria2Rpc {
  call(method: string, params: unknown[]): Promise<unknown>;
}

/** aria2 exit/error codes that retrying cannot fix, with the reason shown to the user. */
const FINAL_ERRORS: Record<string, string> = {
  '3': 'file not found on server',
  '9': 'disk full',
  '13': 'file already exists',
  '15': 'cannot write to folder',
  '16': 'cannot write to folder',
  '17': 'cannot write to folder',
  '18': 'cannot write to folder',
  '24': 'login required',
};

const STATUS_KEYS = ['status', 'completedLength', 'totalLength', 'downloadSpeed', 'errorCode', 'errorMessage'];

interface Tracked {
  gid: string | null;
  timer: ReturnType<typeof setInterval> | null;
  stopping: boolean;
  added: Promise<void>;
}

export class FileEngine implements Engine {
  private readonly tracked = new Map<string, Tracked>();
  private readonly listeners: EngineListener[] = [];

  constructor(
    private readonly rpc: Aria2Rpc,
    private readonly pollMs = 500,
  ) {}

  on(listener: EngineListener): void {
    this.listeners.push(listener);
  }

  async setGlobalLimit(bytesPerSec: number): Promise<void> {
    await this.rpc.call('aria2.changeGlobalOption', [{ 'max-overall-download-limit': String(Math.max(0, Math.floor(bytesPerSec))) }]);
  }

  // The speed limit of file jobs is global (setGlobalLimit), so the context is not needed here.
  start(job: Job, _ctx?: StartContext): void {
    void _ctx;
    if (job.fileName === null) {
      this.emit({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'not a file download', retryable: false });
      return;
    }
    if (this.tracked.has(job.id)) return;
    const fileName = job.fileName;
    const entry: Tracked = { gid: null, timer: null, stopping: false, added: Promise.resolve() };
    this.tracked.set(job.id, entry);

    entry.added = this.rpc
      .call('aria2.addUri', [[job.url], { dir: job.dir, out: fileName }])
      .then((gid) => {
        entry.gid = String(gid);
        if (entry.stopping) return;
        entry.timer = setInterval(() => void this.poll(job.id, fileName, entry), this.pollMs);
        void this.poll(job.id, fileName, entry);
      })
      .catch(() => {
        this.finish(job.id, entry, { jobId: job.id, type: 'error', outcome: 'failed', reason: 'the download service is not running', retryable: true });
      });
  }

  async stop(jobId: string): Promise<void> {
    const entry = this.tracked.get(jobId);
    if (!entry) return;
    entry.stopping = true;
    if (entry.timer) clearInterval(entry.timer);
    await entry.added;
    this.tracked.delete(jobId);
    if (entry.gid === null) return;
    // The partial file and its .aria2 control file stay, so a later start continues.
    for (const method of ['aria2.forcePause', 'aria2.remove']) {
      try {
        await this.rpc.call(method, [entry.gid]);
      } catch {
        // Already finished or already gone: nothing left to stop.
      }
    }
  }

  async discard(job: Job): Promise<void> {
    await this.stop(job.id);
    if (job.fileName === null) return;
    const file = join(job.dir, job.fileName);
    const control = `${file}.aria2`;
    // Without a control file the download is complete (or was never ours): leave it alone.
    if (!existsSync(control)) return;
    for (const path of [control, file]) {
      try {
        rmSync(path, { force: true });
      } catch {
        // Still locked by aria2 for a moment; leaving a leftover beats failing the cancel.
      }
    }
  }

  private async poll(jobId: string, fileName: string, entry: Tracked): Promise<void> {
    if (entry.stopping || entry.gid === null) return;
    let st: Record<string, string>;
    try {
      st = (await this.rpc.call('aria2.tellStatus', [entry.gid, STATUS_KEYS])) as Record<string, string>;
    } catch {
      return this.finish(jobId, entry, { jobId, type: 'error', outcome: 'failed', reason: 'the download service stopped', retryable: true });
    }
    if (entry.stopping || this.tracked.get(jobId) !== entry) return;

    const done = Number(st['completedLength'] ?? 0);
    const total = Number(st['totalLength'] ?? 0);
    const speed = Number(st['downloadSpeed'] ?? 0);

    switch (st['status']) {
      case 'active':
        this.emit({
          jobId,
          type: 'progress',
          bytesDone: done,
          bytesTotal: total > 0 ? total : null,
          speed,
          eta: total > 0 && speed > 0 ? Math.ceil((total - done) / speed) : null,
        });
        return;
      case 'complete':
        void this.rpc.call('aria2.removeDownloadResult', [entry.gid]).catch(() => undefined);
        return this.finish(jobId, entry, { jobId, type: 'done', fileName, actualHeight: null });
      case 'error': {
        const final = FINAL_ERRORS[st['errorCode'] ?? ''];
        void this.rpc.call('aria2.removeDownloadResult', [entry.gid]).catch(() => undefined);
        return this.finish(jobId, entry, {
          jobId,
          type: 'error',
          outcome: 'failed',
          reason: final ?? (st['errorMessage']?.trim() || 'download failed'),
          retryable: final === undefined,
        });
      }
      case 'removed':
        return this.finish(jobId, entry, { jobId, type: 'error', outcome: 'failed', reason: 'download was removed', retryable: true });
      default:
        return; // waiting or paused: nothing to report yet
    }
  }

  private finish(jobId: string, entry: Tracked, ev: EngineEvent): void {
    if (entry.timer) clearInterval(entry.timer);
    if (this.tracked.get(jobId) !== entry) return;
    this.tracked.delete(jobId);
    if (!entry.stopping) this.emit(ev);
  }

  private emit(ev: EngineEvent): void {
    for (const l of this.listeners) l(ev);
  }
}

export function createRpcClient(port: number, secret: string, fetchImpl: typeof fetch = fetch): Aria2Rpc {
  let id = 0;
  return {
    async call(method, params) {
      const res = await fetchImpl(`http://127.0.0.1:${port}/jsonrpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: String(++id), method, params: [`token:${secret}`, ...params] }),
      });
      const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) throw new Error(body.error.message ?? 'aria2 error');
      return body.result;
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Starts the aria2 daemon, reachable only from this machine and only with a per-run secret. */
export async function startAria2(exePath: string, dataDir: string): Promise<{ rpc: Aria2Rpc; stop(): Promise<void> }> {
  mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  const secret = randomBytes(16).toString('hex');
  const child = spawn(
    exePath,
    [
      '--enable-rpc',
      '--rpc-listen-all=false',
      `--rpc-listen-port=${port}`,
      `--rpc-secret=${secret}`,
      '--continue=true',
      '--max-connection-per-server=8',
      '--split=8',
      '--min-split-size=1M',
      '--auto-file-renaming=false',
      '--allow-overwrite=false',
      '--max-tries=3',
      '--retry-wait=5',
      '--quiet=true',
    ],
    { windowsHide: true, stdio: 'ignore', cwd: dataDir },
  );
  let spawnError: Error | null = null;
  child.on('error', (e) => (spawnError = e));

  const rpc = createRpcClient(port, secret);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawnError) throw new Error('aria2 is not installed');
    try {
      await rpc.call('aria2.getVersion', []);
      return {
        rpc,
        async stop() {
          try {
            await rpc.call('aria2.shutdown', []);
          } catch {
            // not answering any more
          }
          child.kill();
        },
      };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  child.kill();
  throw new Error('aria2 did not start');
}
