import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Job } from '../../shared/types';
import { downloadArgs } from '../ytdlp/args';
import { classifyError, parseLine } from '../ytdlp/parse';
import type { Engine, EngineEvent, EngineListener, StartContext } from './engine';

/** How to launch a program: `command` plus arguments that always come first. */
export interface Exe {
  command: string;
  prefixArgs: string[];
}

interface Running {
  child: ChildProcess;
  stopping: boolean;
  exited: Promise<void>;
}

const STDERR_CAP = 64 * 1024;

/** Names yt-dlp gives to data that is not a finished download. */
function isPartial(fileName: string, baseName: string): boolean {
  if (!fileName.startsWith(`${baseName}.`)) return false;
  const rest = fileName.slice(baseName.length);
  return /\.part(-Frag\d+)?$/u.test(rest) || rest.endsWith('.ytdl') || /^\.f\d+\.[^.]+$/u.test(rest);
}

/** Extensions of side files (subtitles, thumbnails, metadata) that are not the download itself. */
const SIDE_FILES = /\.(vtt|srt|ass|lrc|json|jpg|jpeg|png|webp|description)$/iu;

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  // yt-dlp starts ffmpeg; /T takes the children down with it.
  execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (err) => {
    if (err) child.kill();
  });
}

export class MediaEngine implements Engine {
  private readonly running = new Map<string, Running>();
  private readonly listeners: EngineListener[] = [];

  constructor(
    private readonly ytdlp: Exe,
    private readonly ffmpegPath: string,
  ) {}

  on(listener: EngineListener): void {
    this.listeners.push(listener);
  }

  start(job: Job, ctx: StartContext): void {
    if (job.baseName === null || job.quality === null) {
      this.emit({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'not a media download', retryable: false });
      return;
    }
    if (this.running.has(job.id)) return;

    const args = [
      ...this.ytdlp.prefixArgs,
      ...downloadArgs({
        url: job.url,
        quality: job.quality,
        preferMp4Max1080: ctx.settings.preferMp4Max1080,
        subtitleLangs: job.subtitleLangs,
        dir: job.dir,
        baseName: job.baseName,
        ffmpegPath: this.ffmpegPath,
        rateLimitBytes: ctx.rateLimitBytes,
      }),
    ];
    const child = spawn(this.ytdlp.command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Paths and titles must come back as UTF-8, whatever the console code page is.
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });

    let resolveExited!: () => void;
    const entry: Running = { child, stopping: false, exited: new Promise((r) => (resolveExited = r)) };
    this.running.set(job.id, entry);

    let stdoutBuf = '';
    let stderr = '';
    let file: { height: number | null; path: string } | null = null;

    const onLine = (line: string): void => {
      if (entry.stopping) return;
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

    let finished = false;
    const finish = (ev: EngineEvent | null): void => {
      if (finished) return;
      finished = true;
      if (this.running.get(job.id) === entry) this.running.delete(job.id);
      if (ev && !entry.stopping) this.emit(ev);
      resolveExited();
    };

    child.on('error', () => {
      finish({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'yt-dlp is not installed', retryable: false });
    });

    // 'close' fires after the output streams are drained, so no line is lost.
    child.on('close', (code) => {
      if (stdoutBuf !== '') onLine(stdoutBuf);
      if (entry.stopping) return finish(null);
      if (code !== 0) return finish({ jobId: job.id, type: 'error', ...classifyError(stderr) });
      const done = file ?? this.findFinished(job);
      if (done) return finish({ jobId: job.id, type: 'done', fileName: basename(done.path), actualHeight: done.height });
      finish({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'finished without a file', retryable: false });
    });
  }

  async stop(jobId: string): Promise<void> {
    const entry = this.running.get(jobId);
    if (!entry) return;
    entry.stopping = true;
    killTree(entry.child);
    await entry.exited;
  }

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
      if (!isPartial(name, job.baseName)) continue;
      try {
        rmSync(join(job.dir, name), { force: true });
      } catch {
        // A file still locked by a dying process is left behind rather than failing the cancel.
      }
    }
  }

  /** yt-dlp exits cleanly without printing a path when the file was already downloaded. */
  private findFinished(job: Job): { height: number | null; path: string } | null {
    if (job.baseName === null) return null;
    try {
      const base = job.baseName;
      const found = readdirSync(job.dir).find(
        (n) => n.startsWith(`${base}.`) && !n.slice(base.length + 1).includes('.') && !isPartial(n, base) && !SIDE_FILES.test(n),
      );
      return found ? { height: null, path: join(job.dir, found) } : null;
    } catch {
      return null;
    }
  }

  private emit(ev: EngineEvent): void {
    for (const l of this.listeners) l(ev);
  }
}
