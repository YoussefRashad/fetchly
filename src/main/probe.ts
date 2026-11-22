import { execFile } from 'node:child_process';
import type { ProbeResult } from '../shared/types';
import type { Exe } from './engines/media';
import { sanitizeName } from './naming';
import { probeArgs } from './ytdlp/args';
import { classifyError, parseProbe } from './ytdlp/parse';

export class InvalidUrl extends Error {
  constructor() {
    super('not an http(s) link');
    this.name = 'InvalidUrl';
  }
}

/** Why a link cannot be added; `reason` is shown to the user as is. */
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

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  missing: boolean;
}

function run(exe: Exe, args: string[], timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(
      exe.command,
      [...exe.prefixArgs, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024, // a long playlist is several MB of JSON
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown; killed?: boolean }) | null;
        resolve({
          code: e === null ? 0 : typeof e.code === 'number' ? e.code : null,
          stdout,
          stderr,
          timedOut: e?.killed === true,
          missing: e?.code === 'ENOENT',
        });
      },
    );
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
  if (!name) return 'download';
  // A server-chosen name must never carry a path.
  const leaf = name.split(/[\\/]/u).pop() ?? '';
  const dot = leaf.lastIndexOf('.');
  if (dot <= 0) return sanitizeName(leaf) === 'untitled' ? 'download' : sanitizeName(leaf);
  const ext = sanitizeName(leaf.slice(dot + 1)).replace(/\s+/gu, '');
  return `${sanitizeName(leaf.slice(0, dot))}.${ext}`;
}

async function probeFile(url: string, fetchImpl: typeof fetch): Promise<ProbeResult> {
  let res: Response;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: abort.signal });
  } catch {
    throw new ProbeError('could not reach the server');
  } finally {
    clearTimeout(timer);
  }
  // Only the headers are needed; do not pull a whole file from a server that ignored the range.
  void res.body?.cancel().catch(() => undefined);

  if (res.status !== 200 && res.status !== 206) throw new ProbeError(`server answered ${res.status}`);
  if ((res.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')) {
    throw new ProbeError('this link is a web page, not a file');
  }

  let size: number | null = null;
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

/** Works out what a link is: a video, a playlist, or a plain file. */
export async function probeUrl(url: string, ytdlp: Exe, fetchImpl: typeof fetch = fetch, timeoutMs = 30000): Promise<ProbeResult> {
  const ran = await run(ytdlp, probeArgs(url), timeoutMs);
  if (ran.missing) throw new ProbeError('yt-dlp is not installed');
  if (ran.timedOut) throw new ProbeError('timed out reading the link');

  if (ran.code !== 0) {
    const { reason } = classifyError(ran.stderr);
    if (reason === 'unsupported site') return probeFile(url, fetchImpl);
    throw new ProbeError(reason);
  }

  let info: unknown;
  try {
    info = JSON.parse(ran.stdout);
  } catch {
    throw new ProbeError('could not read the video information');
  }
  if (typeof info === 'object' && info !== null) {
    const o = info as Record<string, unknown>;
    // yt-dlp's generic extractor passes a plain file through; aria2 downloads those better.
    if (o['extractor'] === 'generic' && o['direct'] === true) return probeFile(url, fetchImpl);
  }
  try {
    return parseProbe(ran.stdout);
  } catch {
    throw new ProbeError('could not read the video information');
  }
}
