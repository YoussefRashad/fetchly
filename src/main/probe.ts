import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { ProbeResult } from '../shared/types';
import type { Exe } from './engines/media';
import { killTree } from './killTree';
import { sanitizeFileName } from './naming';
import { probeArgs, sendableHeaders } from './ytdlp/args';
import { classifyError, parseProbe } from './ytdlp/parse';

export class InvalidUrl extends Error {
  constructor() {
    super('not an http(s) link');
    this.name = 'InvalidUrl';
  }
}

/** Why a link cannot be added; `reason` is shown to the user as is. */
const STOPPED_EARLY = 'yt-dlp stopped before it could read the link. Try again.';
/** The fixed text of a result that cannot be read: output that is not usable JSON, or more than the output cap. */
export const UNREADABLE = 'could not read the video information';
const TIMED_OUT = 'timed out reading the link';
const NOT_INSTALLED = 'yt-dlp is not installed';

/** The most yt-dlp output a link probe reads (bytes of stdout); a long playlist is several MB of JSON. */
const PROBE_OUTPUT_CAP = 64 * 1024 * 1024;
/** After a kill, or after `exit`, the longest wait for `close` before the probe settles without it (ms). */
const KILL_GRACE_MS = 5000;
/** The end of yt-dlp's error output that is kept for the classifier's rules (bytes, cut on a character boundary). */
const STDERR_CAP = 64 * 1024;
/** The most of the last line starting with `ERROR:` that is kept, from its start (bytes, whole characters). */
const ERROR_LINE_CAP = 4096;
const ERROR_PREFIX = Buffer.from('ERROR:', 'utf8');
const NEWLINE = 0x0a;

/** The two headers a probe sends; null = that header is not sent. */
export type ProbeHeaders = { referer: string | null; userAgent: string | null };

/** How the probe starts a process; Node's spawn by default. */
export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/** The optional parts of a probe run (plan 3.5). */
export interface ProbeOptions {
  /** Sent to yt-dlp and to the plain-file request; each value is checked again and dropped when not valid. */
  headers?: ProbeHeaders | null;
  /** Aborting it ends the run by one kill, and ends the plain-file request. */
  signal?: AbortSignal;
  /** Ends a process tree. Default: the tree kill. */
  kill?: (child: ChildProcess) => void;
  /** Wait for `close` after a kill or after `exit` (ms). Default 5000. */
  killGraceMs?: number;
  /** Bytes of stdout read; one more ends the run. Default 64 MiB. */
  outputCap?: number;
  /** A test seam. Default: Node's spawn. */
  spawn?: SpawnFn;
}

export class ProbeError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ProbeError';
  }
}

export function validateUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidUrl();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new InvalidUrl();
  return trimmed;
}

/** A run that ended by `close` with no kill and within the output cap. */
interface Ran {
  code: number | null;
  stdout: string;
  /** The last STDERR_CAP bytes of stderr, whole characters only. */
  stderr: string;
  /** The last stderr line that starts with `ERROR:` (a final line without a newline included), its first ERROR_LINE_CAP bytes; null when there is none. */
  errorLine: string | null;
}

const noop = (): void => undefined;

/** Whole characters only: a UTF-8 sequence cut at the end is dropped (StringDecoder keeps it back, and it is never ended). */
function decodeWhole(bytes: Buffer): string {
  return new StringDecoder('utf8').write(bytes);
}

/**
 * Keeps two things of yt-dlp's stderr, both bounded in bytes whatever its length (N1): its last STDERR_CAP bytes, and
 * the last line that starts with `ERROR:`, from its start, at most ERROR_LINE_CAP bytes. Lines may span chunks; a
 * final line without a newline counts once `result` is read.
 */
class StderrKeeper {
  private parts: Buffer[] = [];
  private size = 0;
  /** The kept start of the current line, at most ERROR_LINE_CAP bytes. */
  private line: Buffer[] = [];
  private lineSize = 0;
  private lastError: Buffer | null = null;

  add(chunk: Buffer | string): void {
    const piece = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    if (piece.length === 0) return;
    this.parts.push(piece);
    this.size += piece.length;
    // Compacted at twice the cap, so a stream of small chunks is not copied once per chunk.
    if (this.size > 2 * STDERR_CAP) {
      const all = Buffer.concat(this.parts);
      this.parts = [Buffer.from(all.subarray(all.length - STDERR_CAP))];
      this.size = STDERR_CAP;
    }
    let at = 0;
    while (at < piece.length) {
      const nl = piece.indexOf(NEWLINE, at);
      const end = nl === -1 ? piece.length : nl;
      const room = ERROR_LINE_CAP - this.lineSize;
      if (room > 0 && end > at) {
        // Copied, so a kept piece of a line does not hold its whole chunk.
        const kept = Buffer.from(piece.subarray(at, Math.min(end, at + room)));
        this.line.push(kept);
        this.lineSize += kept.length;
      }
      if (nl === -1) break;
      this.endLine();
      at = nl + 1;
    }
  }

  /** The tail and the last ERROR line; a final line without a newline is ended here. */
  result(): { tail: string; errorLine: string | null } {
    this.endLine();
    let tail = Buffer.concat(this.parts);
    if (tail.length > STDERR_CAP) tail = tail.subarray(tail.length - STDERR_CAP);
    // The cut may fall inside a character: its continuation bytes (10xxxxxx) at the start are dropped.
    let start = 0;
    while (start < tail.length && start < 3 && (tail[start] ?? 0) >> 6 === 0b10) start += 1;
    return {
      tail: decodeWhole(tail.subarray(start)),
      errorLine: this.lastError === null ? null : decodeWhole(this.lastError).replace(/\r$/u, ''),
    };
  }

  private endLine(): void {
    if (this.lineSize > 0) {
      const line = Buffer.concat(this.line);
      if (line.subarray(0, ERROR_PREFIX.length).equals(ERROR_PREFIX)) this.lastError = line;
    }
    this.line = [];
    this.lineSize = 0;
  }
}

/**
 * Runs yt-dlp once (plan 3.5, X18). Resolves on `close` when nothing ended the run; rejects with a ProbeError
 * otherwise. It always settles, at the first of `close`, `error` or the settle timer, so within the time limit plus
 * killGraceMs:
 * - the time limit, the output cap and an abort each call `kill` at most once in all, and never after `exit`;
 * - one settle timer of killGraceMs is armed by the first of a kill or `exit`, and only `close` clears it. When it
 *   fires, the output streams are destroyed and a later `close` is ignored; the reason is the kill's, or
 *   STOPPED_EARLY after an `exit` with no kill (the output may be cut short, so it is not read);
 * - `error` settles at once: NOT_INSTALLED for ENOENT, STOPPED_EARLY otherwise.
 */
function run(exe: Exe, args: string[], timeoutMs: number, opts: ProbeOptions): Promise<Ran> {
  const signal = opts.signal;
  const kill = opts.kill ?? killTree;
  const killGraceMs = opts.killGraceMs ?? KILL_GRACE_MS;
  const outputCap = opts.outputCap ?? PROBE_OUTPUT_CAP;
  const spawn = opts.spawn ?? nodeSpawn;

  return new Promise((resolve, reject) => {
    // Already aborted: nothing is started, so nothing needs a kill.
    if (signal?.aborted) {
      reject(new ProbeError(STOPPED_EARLY));
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(exe.command, [...exe.prefixArgs, ...args], {
        // Header values are on this command line: no shell ever reads it (plan 3.3).
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
    } catch (e) {
      reject(new ProbeError((e as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? NOT_INSTALLED : STOPPED_EARLY));
      return;
    }
    const { stdout, stderr } = child;

    const chunks: Buffer[] = [];
    let size = 0;
    let overCap = false;
    const errKept = new StderrKeeper();
    /** The reason of the one kill; null while no kill was sent. */
    let killReason: string | null = null;
    let exited = false;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let grace: ReturnType<typeof setTimeout> | null = null;

    /** Clears the time limit and the abort listener: after a kill or an `exit`, neither may act any more. */
    const stopWatching = (): void => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (then: () => void): void => {
      if (settled) return;
      settled = true;
      stopWatching();
      if (grace !== null) clearTimeout(grace);
      grace = null;
      then();
    };
    /** Stops reading: the listeners go and both streams are destroyed, so a child that holds them keeps nothing open here. */
    const detach = (): void => {
      stdout?.removeListener('data', onOut);
      stderr?.removeListener('data', onErr);
      stdout?.destroy();
      stderr?.destroy();
    };
    /** Armed once, by the first of a kill or `exit`; never re-armed. */
    const armGrace = (): void => {
      if (grace !== null || settled) return;
      grace = setTimeout(() => {
        settle(() => {
          detach();
          reject(new ProbeError(killReason ?? STOPPED_EARLY));
        });
      }, killGraceMs);
    };
    const killOnce = (reason: string): void => {
      if (killReason !== null || exited || settled) return;
      killReason = reason;
      stopWatching();
      armGrace();
      try {
        kill(child);
      } catch {
        // Ended nothing: the settle timer decides.
      }
    };
    function onAbort(): void {
      killOnce(STOPPED_EARLY);
    }
    function onOut(chunk: Buffer | string): void {
      if (overCap) return;
      const piece = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      size += piece.length;
      if (size > outputCap) {
        overCap = true;
        chunks.length = 0;
        killOnce(UNREADABLE);
        return;
      }
      chunks.push(piece);
    }
    function onErr(chunk: Buffer | string): void {
      // Read as bytes: the caps count bytes, and a character split between chunks is joined before decoding.
      errKept.add(chunk);
    }

    stdout?.on('data', onOut);
    stdout?.on('error', noop);
    stderr?.on('data', onErr);
    stderr?.on('error', noop);

    timeout = setTimeout(() => killOnce(TIMED_OUT), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('exit', () => {
      if (exited || settled) return;
      exited = true;
      stopWatching();
      armGrace();
    });
    child.on('close', (code: number | null) => {
      settle(() => {
        // A kill decides the reason; output past the cap is never used, even when it ended without a kill.
        const reason = killReason ?? (overCap ? UNREADABLE : null);
        if (reason !== null) {
          reject(new ProbeError(reason));
          return;
        }
        const { tail, errorLine } = errKept.result();
        resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), stderr: tail, errorLine });
      });
    });
    child.on('error', (e: NodeJS.ErrnoException) => {
      settle(() => {
        detach();
        reject(new ProbeError(e.code === 'ENOENT' ? NOT_INSTALLED : STOPPED_EARLY));
      });
    });
  });
}

function fileNameFrom(disposition: string | null, url: string): string {
  let name: string | null = null;
  if (disposition) {
    const star = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/iu.exec(disposition);
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/iu.exec(disposition);
    if (star?.[1]) {
      try {
        name = decodeURIComponent(star[1].trim());
      } catch {
        name = null;
      }
    }
    name ??= plain?.[1] ?? plain?.[2]?.trim() ?? null;
  }
  if (!name) {
    try {
      const last = new URL(url).pathname.split('/').filter(Boolean).pop();
      name = last ? decodeURIComponent(last) : null;
    } catch {
      name = null;
    }
  }
  // A server-chosen name must never carry a path; sanitizeFileName keeps the leaf only.
  return sanitizeFileName(name ?? '');
}

/** Reads a plain file's name and size. `headers` are already sendable; `signal` aborts the request too. */
async function probeFile(url: string, fetchImpl: typeof fetch, headers: ProbeHeaders, signal: AbortSignal | undefined): Promise<ProbeResult> {
  let res: Response;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  const onAbort = (): void => abort.abort();
  if (signal?.aborted) abort.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const sent: Record<string, string> = { Range: 'bytes=0-0' };
  if (headers.referer !== null) sent['Referer'] = headers.referer;
  if (headers.userAgent !== null) sent['User-Agent'] = headers.userAgent;
  try {
    res = await fetchImpl(url, { headers: sent, redirect: 'follow', signal: abort.signal });
  } catch {
    throw new ProbeError('could not reach the server');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  // Only the headers are needed; do not pull a whole file from a server that ignored the range.
  void res.body?.cancel().catch(() => undefined);

  if (res.status !== 200 && res.status !== 206) throw new ProbeError(`server answered ${res.status}`);
  if ((res.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')) {
    throw new ProbeError('this link is a web page, not a file');
  }

  let size: number | null;
  if (res.status === 206) {
    const total = /\/(\d+)\s*$/u.exec(res.headers.get('content-range') ?? '')?.[1];
    size = total === undefined ? null : Number(total);
  } else {
    const length = res.headers.get('content-length');
    size = length !== null && /^\d+$/u.test(length) ? Number(length) : null;
  }
  return {
    kind: 'file',
    fileName: fileNameFrom(res.headers.get('content-disposition'), res.url || url),
    size,
    resumable: res.status === 206,
  };
}

/**
 * Works out what a link is: a video, a playlist, or a plain file. Rejects with a ProbeError whose reason is shown to
 * the user. The yt-dlp run always settles within `timeoutMs` plus `opts.killGraceMs` (run); a plain-file request
 * after it has its own 20 s limit.
 */
export async function probeUrl(
  url: string,
  ytdlp: Exe,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30000,
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const headers = sendableHeaders(opts.headers ?? null);
  // A timeout, an output past the cap (the same every time, so not a "try again"), a missing yt-dlp, an abort and
  // a run that settled without `close` all reject here.
  const ran = await run(ytdlp, probeArgs(url, headers), timeoutMs, opts);

  if (ran.code !== 0) {
    // Ended without an error of its own: stopped from outside (a leftover-process cleanup, the
    // user in Task Manager) or crashed. Nothing about the link is known, so say that, not "download failed".
    if (ran.errorLine === null) throw new ProbeError(STOPPED_EARLY);
    // The last ERROR line goes after the tail, so it is the last one the classifier finds however far back it was.
    const { reason } = classifyError(`${ran.stderr}\n${ran.errorLine}`);
    if (reason === 'unsupported site') return probeFile(url, fetchImpl, headers, opts.signal);
    throw new ProbeError(reason);
  }

  let info: unknown;
  try {
    info = JSON.parse(ran.stdout);
  } catch {
    throw new ProbeError(UNREADABLE);
  }
  if (typeof info === 'object' && info !== null) {
    const o = info as Record<string, unknown>;
    // yt-dlp's generic extractor passes a plain file through; aria2 downloads those better.
    if (o['extractor'] === 'generic' && o['direct'] === true) return probeFile(url, fetchImpl, headers, opts.signal);
  }
  try {
    return parseProbe(ran.stdout);
  } catch {
    throw new ProbeError(UNREADABLE);
  }
}
