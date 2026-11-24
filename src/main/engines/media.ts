import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Job } from '../../shared/types';
import { killTree } from '../killTree';
import type { ProbeHeaders } from '../probe';
import { downloadArgs, heightProbeArgs } from '../ytdlp/args';
import { classifyError, parseLine, parseProbe } from '../ytdlp/parse';
import type { Engine, EngineEvent, EngineListener, StartContext } from './engine';

/** How to launch a program: `command` plus arguments that always come first. */
export interface Exe {
  command: string;
  prefixArgs: string[];
}

export interface MediaEngineOptions {
  /** Time limit of the height check before a Best download (ms). Default 30000. */
  probeTimeoutMs?: number;
  /** How long stop() waits for the process to end before it gives up (ms). Default 10000. */
  stopTimeoutMs?: number;
  /** Ends a process tree. Default: taskkill /T /F, falling back to child.kill() when taskkill fails. */
  kill?: (child: ChildProcess) => void;
  /**
   * Bytes of height-check output that are read (default 64 MiB); output beyond it is discarded and the job
   * downloads with no known height. A finite number of 0 or more; not validated (only specs set it).
   */
  probeOutputCap?: number;
}

interface Running {
  /** The process that runs now: the height check first, then the download. */
  child: ChildProcess;
  /** The pending stop. While set, the job's events are suppressed. */
  stopping: Promise<void> | null;
  /** Resolves when the engine released the job. */
  released: Promise<void>;
}

type MediaJob = Job & { baseName: string; quality: NonNullable<Job['quality']> };

const STDERR_CAP = 64 * 1024;
/**
 * The same cap as the link probe: height-check output beyond it is not read. Over it the height check is ended and
 * the job downloads with no known height (the height only chooses the container). Default of `probeOutputCap`.
 */
const PROBE_OUTPUT_CAP = 64 * 1024 * 1024;
const STOP_UNCONFIRMED = 'could not confirm that the download stopped';

/** After `<baseName>`, the rest of a name yt-dlp gives to data that is not a finished download. */
const PARTIAL_RESTS = [
  /^\.(?:f\d+\.)?[a-z0-9]{1,5}(?:\.part(?:-Frag\d+(?:\.part)?)?|\.ytdl|\.part\.ytdl)$/iu,
  /^\.f\d+\.[a-z0-9]{1,5}$/iu,
];

/** After `<baseName>`, the rest of a finished download's name. */
const FINISHED_REST = /^\.(?:mp4|mkv|webm|m4a|mp3|opus|ogg|flac|wav|mov)$/iu;

/** True when `fileName` begins with `baseName`, ignoring letter case (Windows names). */
function startsWithBase(fileName: string, baseName: string): boolean {
  return fileName.length > baseName.length && fileName.slice(0, baseName.length).toLowerCase() === baseName.toLowerCase();
}

/**
 * True when `fileName` is partial data of the job named `baseName`: a stream, a `.part`
 * (with its fragments) or a `.ytdl` file. Ignores letter case. The name of another job that
 * extends this one (`Clip.extra.mp4.part` for `Clip`) is not accepted.
 */
export function isPartialOf(fileName: string, baseName: string): boolean {
  if (!startsWithBase(fileName, baseName)) return false;
  const rest = fileName.slice(baseName.length);
  return PARTIAL_RESTS.some((r) => r.test(rest));
}

const byLowerCase = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * The two headers of a start. Only `referer` and `userAgent` are read: A3's engines never touch `cookies`.
 * headerArgs checks each value again and drops one that is not valid.
 */
function headersOf(ctx: StartContext): ProbeHeaders | null {
  const extras = ctx.extras;
  return extras === null ? null : { referer: extras.referer, userAgent: extras.userAgent };
}

/** The height a height check reports: a number, null for none, or 'unreadable'. */
function readHeight(stdout: string): number | null | 'unreadable' {
  try {
    const probe = parseProbe(stdout);
    // parseProbe keeps only finite heights > 0, highest first.
    return probe.kind === 'media' ? (probe.heights[0] ?? null) : null;
  } catch {
    return 'unreadable';
  }
}

export class MediaEngine implements Engine {
  private readonly running = new Map<string, Running>();
  private readonly listeners: EngineListener[] = [];
  private readonly probeTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly kill: (child: ChildProcess) => void;
  private readonly probeOutputCap: number;

  constructor(
    private readonly ytdlp: Exe,
    private readonly ffmpegPath: string,
    opts: MediaEngineOptions = {},
  ) {
    this.probeTimeoutMs = opts.probeTimeoutMs ?? 30000;
    this.stopTimeoutMs = opts.stopTimeoutMs ?? 10000;
    this.kill = opts.kill ?? killTree;
    this.probeOutputCap = opts.probeOutputCap ?? PROBE_OUTPUT_CAP;
  }

  on(listener: EngineListener): void {
    this.listeners.push(listener);
  }

  /**
   * Starts the job unless the engine already owns it. A Best job (not "always mp4") with no
   * known height and no data yet first runs a height check; a height found is reported as
   * `probed` and decides the container. Height-check output over the output cap is not read:
   * the check is ended and the job downloads with no known height (no `probed`, no error).
   */
  start(job: Job, ctx: StartContext): void {
    if (job.baseName === null || job.quality === null) {
      this.emit({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'not a media download', retryable: false });
      return;
    }
    if (this.running.has(job.id)) return;
    const media: MediaJob = { ...job, baseName: job.baseName, quality: job.quality };

    let resolveReleased!: () => void;
    let released = false;
    const entry: Running = {
      child: undefined as unknown as ChildProcess, // set by the spawn below, before anything can read it
      stopping: null,
      released: new Promise((r) => (resolveReleased = r)),
    };
    this.running.set(job.id, entry);

    /** Hands the job back: its final event is emitted unless a stop is pending. */
    const release = (ev: EngineEvent | null): void => {
      if (released) return;
      released = true;
      if (this.running.get(job.id) === entry) this.running.delete(job.id);
      if (ev && entry.stopping === null) this.emit(ev);
      resolveReleased();
    };

    const needsHeight =
      media.quality.kind === 'best' && !ctx.settings.preferMp4Max1080 && media.sourceHeight === null && media.bytesDone === 0;
    if (needsHeight) this.checkHeight(media, ctx, entry, release);
    else this.download(media, ctx, entry, release, media.sourceHeight);
  }

  /**
   * Stops the job's process tree and keeps its partial data. Resolves when the process ended
   * within the stop time limit (the job is released, no event). Rejects with
   * "could not confirm that the download stopped" otherwise: the engine keeps the job and
   * reports it again, and a later stop tries again. A stop while one is pending returns it.
   */
  stop(jobId: string): Promise<void> {
    const entry = this.running.get(jobId);
    if (!entry) return Promise.resolve();
    if (entry.stopping !== null) return entry.stopping;

    const stopping = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (entry.stopping === stopping) entry.stopping = null;
        reject(new Error(STOP_UNCONFIRMED));
      }, this.stopTimeoutMs);
      void entry.released.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    entry.stopping = stopping;
    this.killChild(entry.child);
    return stopping;
  }

  /** Stops the job, then deletes exactly its partial files. Rejects, deleting nothing, when the stop fails. */
  async discard(job: Job): Promise<void> {
    await this.stop(job.id);
    if (job.baseName === null) return;
    let names: string[];
    try {
      names = readdirSync(job.dir);
    } catch {
      return; // the folder is gone, so there is nothing to clean
    }
    for (const name of names) {
      if (!isPartialOf(name, job.baseName)) continue;
      try {
        rmSync(join(job.dir, name), { force: true });
      } catch {
        // A file still locked by a dying process is left behind rather than failing the cancel.
      }
    }
  }

  /** Starts yt-dlp. It carries header values on its command line, so no shell ever reads that line (plan 3.3). */
  private spawnYtdlp(args: string[]): ChildProcess {
    return spawn(this.ytdlp.command, [...this.ytdlp.prefixArgs, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Paths and titles must come back as UTF-8, whatever the console code page is.
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
  }

  private killChild(child: ChildProcess): void {
    try {
      this.kill(child);
    } catch {
      // Not ended: the stop or the time limit decides what follows.
    }
  }

  /**
   * Reads the real height (yt-dlp -J), then downloads. A pending stop wins: no event and no download.
   * Output over the cap is discarded, the check is ended once, and when it has ended the job downloads with
   * no known height, whatever the time limit, the exit code or a signal say. Every other failure ends the
   * job without a download.
   */
  private checkHeight(job: MediaJob, ctx: StartContext, entry: Running, release: (ev: EngineEvent | null) => void): void {
    const child = this.spawnYtdlp(heightProbeArgs(job.url, headersOf(ctx)));
    entry.child = child;

    const chunks: Buffer[] = [];
    let size = 0;
    let overCap = false;
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      // Over the cap the stream keeps flowing (a child blocked on its write would never end); chunks are dropped.
      if (overCap) return;
      size += chunk.length;
      if (size > this.probeOutputCap) {
        overCap = true;
        chunks.length = 0;
        // The download starts on this child's 'close', so one job never has two processes. The time limit stays
        // armed: if this kill does not end the tree, the timer kills again.
        this.killChild(child);
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_CAP);
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.killChild(child);
    }, this.probeTimeoutMs);

    let settled = false;
    const settle = (then: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      then();
    };

    child.on('error', () => {
      // Only a failed spawn ends the job here; a running process ends with 'close'.
      if (child.pid !== undefined) return;
      settle(() => release({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'yt-dlp is not installed', retryable: false }));
    });

    child.on('close', (code) => {
      settle(() => {
        // A stop that is pending wins: no event and no download.
        if (entry.stopping !== null) return release(null);
        // Over the cap: the height is only a container hint, so the job downloads without it.
        if (overCap) return this.download(job, ctx, entry, release, null);
        if (timedOut) {
          return release({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'timed out reading the link', retryable: true });
        }
        if (code !== 0) return release({ jobId: job.id, type: 'error', ...classifyError(stderr) });
        const height = readHeight(Buffer.concat(chunks).toString('utf8'));
        if (height === 'unreadable') {
          return release({
            jobId: job.id,
            type: 'error',
            outcome: 'failed',
            reason: 'could not read the video information',
            retryable: true,
          });
        }
        if (height !== null) this.emit({ jobId: job.id, type: 'probed', sourceHeight: height });
        this.download(job, ctx, entry, release, height);
      });
    });
  }

  private download(
    job: MediaJob,
    ctx: StartContext,
    entry: Running,
    release: (ev: EngineEvent | null) => void,
    sourceHeight: number | null,
  ): void {
    const child = this.spawnYtdlp(
      downloadArgs({
        url: job.url,
        quality: job.quality,
        preferMp4Max1080: ctx.settings.preferMp4Max1080,
        subtitleLangs: job.subtitleLangs,
        dir: job.dir,
        baseName: job.baseName,
        ffmpegPath: this.ffmpegPath,
        rateLimitBytes: ctx.rateLimitBytes,
        sourceHeight,
        headers: headersOf(ctx),
      }),
    );
    entry.child = child;

    let stdoutBuf = '';
    let stderr = '';
    let file: { height: number | null; path: string } | null = null;

    const onLine = (line: string): void => {
      if (entry.stopping !== null) return;
      const parsed = parseLine(line);
      if (parsed.type === 'progress') {
        const { bytesDone, bytesTotal, speed, eta } = parsed;
        this.emit({ jobId: job.id, type: 'progress', bytesDone, bytesTotal, speed, eta });
      } else if (parsed.type === 'merging') this.emit({ jobId: job.id, type: 'merging' });
      else if (parsed.type === 'file') file = { height: parsed.height, path: parsed.path };
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuf += chunk;
      let nl = stdoutBuf.indexOf('\n');
      while (nl !== -1) {
        onLine(stdoutBuf.slice(0, nl));
        stdoutBuf = stdoutBuf.slice(nl + 1);
        nl = stdoutBuf.indexOf('\n');
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_CAP);
    });

    child.on('error', () => {
      // Only a failed spawn ends the job here; a running process ends with 'close'.
      if (child.pid !== undefined) return;
      release({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'yt-dlp is not installed', retryable: false });
    });

    // 'close' fires after the output streams are drained, so no line is lost.
    child.on('close', (code) => {
      if (stdoutBuf !== '') onLine(stdoutBuf);
      if (entry.stopping !== null) return release(null);
      if (code !== 0) return release({ jobId: job.id, type: 'error', ...classifyError(stderr) });
      const done = file ?? this.findFinished(job);
      if (done) return release({ jobId: job.id, type: 'done', fileName: basename(done.path), actualHeight: done.height });
      release({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'finished without a file', retryable: false });
    });
  }

  /**
   * yt-dlp exits cleanly without printing a path when the file was already downloaded.
   * Only a regular file named exactly `<baseName>.<ext>` with a media extension counts
   * (letter case ignored); of several, the first by lower-cased name.
   */
  private findFinished(job: MediaJob): { height: number | null; path: string } | null {
    let names: string[];
    try {
      names = readdirSync(job.dir);
    } catch {
      return null; // the folder is gone
    }
    const candidates = names
      .filter((n) => startsWithBase(n, job.baseName) && FINISHED_REST.test(n.slice(job.baseName.length)))
      .sort(byLowerCase);
    for (const name of candidates) {
      const path = join(job.dir, name);
      try {
        if (statSync(path).isFile()) return { height: null, path };
      } catch {
        // gone since the listing
      }
    }
    return null;
  }

  private emit(ev: EngineEvent): void {
    for (const l of this.listeners) l(ev);
  }
}
