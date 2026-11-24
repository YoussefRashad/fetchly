import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { Job } from '../../shared/types';
import { sendableHeaders } from '../ytdlp/args';
import type { Engine, EngineEvent, EngineListener, StartContext } from './engine';

export interface Aria2Rpc {
  call(method: string, params: unknown[]): Promise<unknown>;
}

/** aria2 answered, with a JSON-RPC error member. */
export class Aria2RpcError extends Error {
  /** The numeric code of the error member; null when it has none. */
  readonly code: number | null;
  constructor(message: string, code: number | null) {
    super(message);
    this.name = 'Aria2RpcError';
    this.code = code;
  }
}

/** No usable answer from aria2: no connection, the time limit expired, or the body is not JSON-RPC. */
export class Aria2TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Aria2TransportError';
  }
}

/** A running aria2 daemon. */
export interface Aria2Daemon {
  rpc: Aria2Rpc;
  /** false once the process exited, whether asked for or not. */
  alive(): boolean;
  /** Runs `cb` once when the process exits without stop() having asked for it. Not called when added after the exit. */
  onExit(cb: () => void): void;
  /** Asks aria2 to shut down, then ends the process. */
  stop(): Promise<void>;
}

export interface FileEngineOptions {
  /** Poll period in ms. Default 500. */
  pollMs?: number;
  /** false = the aria2 process is gone. Default: always alive. */
  daemonAlive?: () => boolean;
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

/** Consecutive unanswered polls after which a download is shown as not moving (once per outage). */
const STALL_AFTER = 5;
const STOP_FAILED = 'could not confirm that the download stopped';
const SERVICE_STOPPED = 'the download service stopped';
const SERVICE_NOT_RUNNING = 'the download service is not running';

interface Tracked {
  /** The service this download was added to; every call for it goes there. */
  rpc: Aria2Rpc;
  fileName: string;
  gid: string | null;
  timer: ReturnType<typeof setInterval> | null;
  /** The pending stop, shared by every caller; null when no stop is pending. */
  stop: Promise<void> | null;
  /** Settles the pending stop: null resolves it, an error rejects it. */
  settleStop: ((err: Error | null) => void) | null;
  /** A tellStatus of this entry is in flight. */
  polling: boolean;
  added: Promise<void>;
  /** The engine let this entry go; nothing done for it afterwards may act or emit. */
  released: boolean;
  /** Consecutive polls without an answer, and whether this outage was already shown. */
  failures: number;
  stallShown: boolean;
  /** The byte counts last reported (before any report: those of the job given to start). */
  lastDone: number;
  lastTotal: number | null;
}

export class FileEngine implements Engine {
  private readonly tracked = new Map<string, Tracked>();
  private readonly listeners: EngineListener[] = [];
  private readonly pollMs: number;
  private daemonAlive: () => boolean;

  constructor(
    private rpc: Aria2Rpc,
    opts: FileEngineOptions = {},
  ) {
    this.pollMs = opts.pollMs ?? 500;
    this.daemonAlive = opts.daemonAlive ?? (() => true);
  }

  on(listener: EngineListener): void {
    this.listeners.push(listener);
  }

  start(job: Job, ctx: StartContext): void {
    if (job.fileName === null) {
      this.emit({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'not a file download', retryable: false });
      return;
    }
    // Still ours (running, or a stop not yet confirmed): never add it a second time.
    if (this.tracked.has(job.id)) return;
    const jobId = job.id;
    const entry: Tracked = {
      rpc: this.rpc,
      fileName: job.fileName,
      gid: null,
      timer: null,
      stop: null,
      settleStop: null,
      polling: false,
      added: Promise.resolve(),
      released: false,
      failures: 0,
      stallShown: false,
      lastDone: job.bytesDone,
      lastTotal: job.bytesTotal,
    };
    this.tracked.set(jobId, entry);

    const options: Record<string, string> = { dir: job.dir, out: entry.fileName, 'max-download-limit': String(ctx.rateLimitBytes ?? 0) };
    // Only the keys `referer` and `user-agent`, each when its value is sendable; never `header`, and never the cookies.
    const headers = sendableHeaders(ctx.extras);
    if (headers.referer !== null) options['referer'] = headers.referer;
    if (headers.userAgent !== null) options['user-agent'] = headers.userAgent;

    entry.added = entry.rpc
      .call('aria2.addUri', [[job.url], options])
      .then(
        (gid) => {
          if (entry.released) return;
          entry.gid = String(gid);
          // A pending stop takes over from here; it restarts the polling itself if it fails.
          if (entry.stop) return;
          this.startPolling(jobId, entry);
          void this.poll(jobId, entry);
        },
        (e: unknown) => {
          if (entry.released) return;
          const reason = e instanceof Aria2RpcError && e.message.trim() ? e.message : SERVICE_NOT_RUNNING;
          this.finish(jobId, entry, { jobId, type: 'error', outcome: 'failed', reason, retryable: true });
        },
      );
  }

  stop(jobId: string): Promise<void> {
    const entry = this.tracked.get(jobId);
    if (!entry) return Promise.resolve();
    if (entry.stop) return entry.stop;
    entry.stop = new Promise<void>((resolve, reject) => {
      let settled = false;
      entry.settleStop = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
    });
    this.clearTimer(entry);
    void this.runStop(jobId, entry);
    return entry.stop;
  }

  async discard(job: Job): Promise<void> {
    // Not confirmed: the download may still write, so nothing is deleted.
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

  /**
   * Sets the speed limit of one running download (null = none). Resolves true only when aria2
   * answered `aria2.changeOption` without error; false when the job is not tracked, was released,
   * has no gid, or the call failed. Never rejects.
   */
  async setRateLimit(jobId: string, bytesPerSec: number | null): Promise<boolean> {
    const entry = this.tracked.get(jobId);
    if (!entry) return false;
    try {
      await entry.added;
      if (entry.released || entry.gid === null) return false;
      await entry.rpc.call('aria2.changeOption', [entry.gid, { 'max-download-limit': String(bytesPerSec ?? 0) }]);
      return true;
    } catch {
      // aria2 busy or gone: not confirmed. The queue sends it again at the next settings save.
      return false;
    }
  }

  /**
   * Switches to a new daemon. Precondition: the previous daemon is dead, so every tracked download
   * belongs to a process that no longer exists. Each is released: a pending stop resolves (a dead
   * daemon confirms it), any other download ends with a retryable error. Nothing is re-added.
   */
  attach(daemon: Aria2Daemon): void {
    const old = [...this.tracked];
    this.tracked.clear();
    for (const [, entry] of old) {
      this.clearTimer(entry);
      entry.released = true;
    }
    this.rpc = daemon.rpc;
    this.daemonAlive = () => daemon.alive();
    // Told only after the switch, so a listener that starts the job again reaches the new daemon.
    for (const [jobId, entry] of old) {
      if (entry.stop) entry.settleStop?.(null);
      else this.emit({ jobId, type: 'error', outcome: 'failed', reason: SERVICE_STOPPED, retryable: true });
    }
  }

  private async runStop(jobId: string, entry: Tracked): Promise<void> {
    await entry.added;
    // addUri failed (released by finish) or attach released the entry: nothing left to stop.
    if (entry.released || entry.gid === null) return this.confirmStop(jobId, entry);
    const gid = entry.gid;
    // The partial file and its .aria2 control file stay, so a later start continues.
    try {
      await entry.rpc.call('aria2.forcePause', [gid]);
    } catch {
      // Its outcome is ignored: only the answer to remove decides.
    }
    if (entry.released) return this.confirmStop(jobId, entry);
    let confirmed: boolean;
    try {
      await entry.rpc.call('aria2.remove', [gid]);
      confirmed = true;
    } catch (e) {
      // An error answer means aria2 has nothing active, waiting or paused under that gid.
      confirmed = e instanceof Aria2RpcError || !this.daemonAlive();
    }
    if (entry.released || confirmed) return this.confirmStop(jobId, entry);

    // Not confirmed: the download may still run, so it stays ours and is watched again.
    const settle = entry.settleStop;
    entry.stop = null;
    entry.settleStop = null;
    this.startPolling(jobId, entry);
    settle?.(new Error(STOP_FAILED));
  }

  private confirmStop(jobId: string, entry: Tracked): void {
    this.clearTimer(entry);
    entry.released = true;
    // A late answer must never release a job that was started again since.
    if (this.tracked.get(jobId) === entry) this.tracked.delete(jobId);
    entry.settleStop?.(null);
  }

  private startPolling(jobId: string, entry: Tracked): void {
    if (entry.timer) return;
    entry.timer = setInterval(() => void this.poll(jobId, entry), this.pollMs);
  }

  /** The entry may still act and emit: not released, no stop pending, still the tracked one. */
  private owns(jobId: string, entry: Tracked): boolean {
    return !entry.released && entry.stop === null && this.tracked.get(jobId) === entry;
  }

  private async poll(jobId: string, entry: Tracked): Promise<void> {
    // One poll at a time per entry: a tick that finds one in flight is skipped.
    if (entry.polling || entry.gid === null || !this.owns(jobId, entry)) return;
    entry.polling = true;
    let st: Record<string, string>;
    try {
      st = (await entry.rpc.call('aria2.tellStatus', [entry.gid, STATUS_KEYS])) as Record<string, string>;
    } catch (e) {
      entry.polling = false;
      if (!this.owns(jobId, entry)) return;
      // Gid gone and daemon gone are told apart only by the error class and daemonAlive().
      if (e instanceof Aria2RpcError) {
        return this.finish(jobId, entry, { jobId, type: 'error', outcome: 'failed', reason: 'download was removed', retryable: true });
      }
      if (!this.daemonAlive()) {
        return this.finish(jobId, entry, { jobId, type: 'error', outcome: 'failed', reason: SERVICE_STOPPED, retryable: true });
      }
      // aria2 runs but does not answer: keep the gid and keep polling; show the stall once per outage.
      entry.failures += 1;
      if (entry.failures >= STALL_AFTER && !entry.stallShown) {
        entry.stallShown = true;
        this.emit({ jobId, type: 'progress', bytesDone: entry.lastDone, bytesTotal: entry.lastTotal, speed: 0, eta: null });
      }
      return;
    }
    entry.polling = false;
    if (!this.owns(jobId, entry)) return;
    entry.failures = 0;
    entry.stallShown = false;

    const done = Number(st['completedLength'] ?? 0);
    const total = Number(st['totalLength'] ?? 0);
    const speed = Number(st['downloadSpeed'] ?? 0);

    switch (st['status']) {
      case 'active': {
        const bytesTotal = total > 0 ? total : null;
        entry.lastDone = done;
        entry.lastTotal = bytesTotal;
        this.emit({
          jobId,
          type: 'progress',
          bytesDone: done,
          bytesTotal,
          speed,
          eta: total > 0 && speed > 0 ? Math.ceil((total - done) / speed) : null,
        });
        return;
      }
      case 'complete':
        void entry.rpc.call('aria2.removeDownloadResult', [entry.gid]).catch(() => undefined);
        return this.finish(jobId, entry, { jobId, type: 'done', fileName: entry.fileName, actualHeight: null });
      case 'error': {
        const final = FINAL_ERRORS[st['errorCode'] ?? ''];
        void entry.rpc.call('aria2.removeDownloadResult', [entry.gid]).catch(() => undefined);
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

  /** Releases the entry and emits its final event, unless a stop is pending (then the stop decides, silently). */
  private finish(jobId: string, entry: Tracked, ev: EngineEvent): void {
    this.clearTimer(entry);
    if (entry.released || this.tracked.get(jobId) !== entry) return;
    this.tracked.delete(jobId);
    entry.released = true;
    if (entry.stop === null) this.emit(ev);
  }

  private clearTimer(entry: Tracked): void {
    if (entry.timer) clearInterval(entry.timer);
    entry.timer = null;
  }

  private emit(ev: EngineEvent): void {
    for (const l of this.listeners) l(ev);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e);
}

/** A JSON-RPC client for aria2. Every call has its own time limit (default 5 s), which covers the answer's body too. */
export function createRpcClient(port: number, secret: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Aria2Rpc {
  let id = 0;
  return {
    async call(method, params) {
      let body: unknown;
      try {
        const res = await fetchImpl(`http://127.0.0.1:${port}/jsonrpc`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: String(++id), method, params: [`token:${secret}`, ...params] }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        // Parsed whatever the HTTP status: aria2 sends its error member with 400 and others.
        body = JSON.parse(await res.text()) as unknown;
      } catch (e) {
        throw new Aria2TransportError(`aria2 did not answer: ${describe(e)}`);
      }
      if (!isRecord(body)) throw new Aria2TransportError('aria2 answered with something that is not JSON-RPC');
      const error = body['error'];
      if (isRecord(error)) {
        const message = typeof error['message'] === 'string' && error['message'] ? error['message'] : 'aria2 error';
        const code = typeof error['code'] === 'number' && Number.isFinite(error['code']) ? error['code'] : null;
        throw new Aria2RpcError(message, code);
      }
      if (!('result' in body)) throw new Aria2TransportError('aria2 answered with something that is not JSON-RPC');
      return body['result'];
    },
  };
}

/** Wraps a started aria2 process: whether it lives, who hears of an exit nobody asked for, and how to stop it. */
export function daemonHandle(child: ChildProcess, rpc: Aria2Rpc): Aria2Daemon {
  let exited = child.exitCode !== null || child.signalCode !== null;
  let asked = false;
  const listeners: (() => void)[] = [];
  child.once('exit', () => {
    exited = true;
    const toTell = listeners.splice(0);
    if (asked) return;
    for (const l of toTell) l();
  });
  return {
    rpc,
    alive: () => !exited,
    onExit(cb) {
      if (!exited) listeners.push(cb);
    },
    async stop() {
      // Marked first: aria2 may exit while it answers shutdown.
      asked = true;
      try {
        await rpc.call('aria2.shutdown', []);
      } catch {
        // not answering any more
      }
      child.kill();
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

/**
 * aria2 does plain HTTP(S) downloads only: a link that answers with a .torrent or a metalink is
 * saved as that file, never followed, so no peer-to-peer traffic, listening port or seeding.
 */
export const ARIA2_PLAIN_HTTP_ARGS: readonly string[] = [
  '--follow-torrent=false',
  '--follow-metalink=false',
  '--enable-dht=false',
  '--enable-dht6=false',
  '--bt-enable-lpd=false',
  '--enable-peer-exchange=false',
  '--seed-time=0',
];

/** The aria2 daemon command line: RPC on this machine only, with a per-run secret. */
export function aria2DaemonArgs(port: number, secret: string): string[] {
  return [
    '--enable-rpc',
    '--rpc-listen-all=false',
    `--rpc-listen-port=${port}`,
    `--rpc-secret=${secret}`,
    ...ARIA2_PLAIN_HTTP_ARGS,
    '--continue=true',
    // The .aria2 control file records which bytes are on disk. aria2 saves it on a clean stop
    // and otherwise only every this many seconds (default 60): an aria2 that is ended (Task
    // Manager, a crash) loses everything since the last save, and the restarted download
    // begins again from there. Every second loses at most about a second.
    '--auto-save-interval=1',
    '--max-connection-per-server=8',
    '--split=8',
    '--min-split-size=1M',
    '--auto-file-renaming=false',
    '--allow-overwrite=false',
    '--max-tries=3',
    '--retry-wait=5',
    '--quiet=true',
  ];
}

/** Starts the aria2 daemon, reachable only from this machine and only with a per-run secret. */
export async function startAria2(exePath: string, dataDir: string): Promise<Aria2Daemon> {
  mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  const secret = randomBytes(16).toString('hex');
  const child = spawn(exePath, aria2DaemonArgs(port, secret), { windowsHide: true, stdio: 'ignore', cwd: dataDir });
  let spawnError: Error | null = null;
  child.on('error', (e) => (spawnError = e));

  const rpc = createRpcClient(port, secret);
  const daemon = daemonHandle(child, rpc);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawnError) throw new Error('aria2 is not installed');
    try {
      await rpc.call('aria2.getVersion', []);
      return daemon;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  child.kill();
  throw new Error('aria2 did not start');
}
