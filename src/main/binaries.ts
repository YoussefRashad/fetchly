import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import yauzl from 'yauzl';
import type { BinName, BinStatus } from '../shared/types';

export type { BinName, BinStatus };

export class ChecksumMismatch extends Error {
  constructor(name: BinName) {
    super(`the downloaded ${name} does not match its published checksum`);
    this.name = 'ChecksumMismatch';
  }
}

interface Source {
  /** the release asset to download */
  url: string;
  /** file listing `sha256  assetName` lines, published with the release; null when the publisher offers none */
  checksumsUrl: string | null;
  assetName: string;
  /** for archives: the one file to take out of it */
  member: string | null;
}

export const SOURCES: Record<BinName, Source> = {
  'yt-dlp': {
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    checksumsUrl: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS',
    assetName: 'yt-dlp.exe',
    member: null,
  },
  ffmpeg: {
    url: 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip',
    checksumsUrl: 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/checksums.sha256',
    assetName: 'ffmpeg-master-latest-win64-gpl.zip',
    member: 'ffmpeg.exe',
  },
  aria2c: {
    url: 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
    checksumsUrl: null,
    assetName: 'aria2-1.37.0-win-64bit-build1.zip',
    member: 'aria2c.exe',
  },
};

/**
 * SHA-256 of the aria2 1.37.0 Windows zip (2,475,379 bytes). aria2 publishes no
 * checksum file, so the value is pinned here. Computed on 2026-11-22 from the
 * release asset and equal to the value recorded for the same URL by the Scoop
 * Main manifest (aria2 1.37.0-1) and the winget manifest (aria2.aria2 1.37.0, x64).
 *
 * The pin guarantees every install gets these exact bytes. It cannot prove the
 * original build was sound; that rests on the aria2 project and its release page.
 * An empty value makes the app refuse to install aria2.
 */
export const ARIA2_ZIP_SHA256 = '67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288';

const NAMES: BinName[] = ['yt-dlp', 'ffmpeg', 'aria2c'];
const VERSION_FLAG: Record<BinName, string> = { 'yt-dlp': '--version', ffmpeg: '-version', aria2c: '--version' };

function runVersion(name: BinName, path: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(path, [VERSION_FLAG[name]], { timeout: 10000, windowsHide: true }, (err, stdout) => {
      const first = err ? '' : (stdout.split(/\r?\n/u)[0]?.trim() ?? '');
      resolve(first === '' ? null : first);
    });
  });
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** The text for a write failure that people can act on: disk full, or a folder that refuses writes. */
function knownWriteFailure(name: BinName, err: unknown): Error | null {
  const code = errorCode(err);
  if (code === 'ENOSPC') return new Error(`could not install ${name}: disk full`, { cause: err });
  if (code === 'EACCES' || code === 'EPERM') return new Error(`could not install ${name}: cannot write to folder`, { cause: err });
  return null;
}

/** Removes a file and never throws: a failed cleanup must not hide the error that caused it. */
function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // A leftover beats a thrown error that replaces the real one.
  }
}

/**
 * `pipeline` that also says which end failed. Once one stream fails, `pipeline` destroys the others with the
 * same error, so every stream reports it; only the first to report is the one that failed. Resolves with
 * null on success and never rejects. `side` is null when the failure came from neither end.
 */
async function pipeTracked(
  source: Readable,
  middle: Transform[],
  sink: Writable,
): Promise<null | { side: 'read' | 'write' | null; error: unknown }> {
  let side: 'read' | 'write' | null = null;
  source.on('error', () => {
    side ??= 'read';
  });
  sink.on('error', () => {
    side ??= 'write';
  });
  try {
    await pipeline(source, ...middle, sink);
    return null;
  } catch (error) {
    return { side, error };
  }
}

/** Copies one named file out of a zip to `dest`. Nothing else in the archive touches the disk. */
function extractMember(name: BinName, zipPath: string, member: string, dest: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('cannot open archive'));
      let found = false;
      zip.on('error', reject);
      zip.on('end', () => {
        if (!found) resolve(false);
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        const leaf = entry.fileName.split('/').pop();
        if (found || leaf !== member || entry.fileName.endsWith('/')) return zip.readEntry();
        found = true;
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr ?? new Error('cannot read archive entry'));
          pipeTracked(stream, [], createWriteStream(dest)).then((failure) => {
            zip.close();
            if (failure === null) return resolve(true);
            // Only a failed write gets the readable text; a damaged archive keeps its own error.
            const known = failure.side === 'write' ? knownWriteFailure(name, failure.error) : null;
            reject(known ?? (failure.error instanceof Error ? failure.error : new Error(String(failure.error))));
          });
        });
      });
      zip.readEntry();
    });
  });
}

export interface BinariesOptions {
  fetchImpl?: typeof fetch;
  versionOf?: (name: BinName, path: string) => Promise<string | null>;
  aria2Sha256?: string;
  /** Opens the file an asset is downloaded into. Used for the download only, not for a file taken out of an archive. */
  createWrite?: (path: string) => Writable;
}

export class Binaries {
  private readonly fetchImpl: typeof fetch;
  private readonly versionOf: (name: BinName, path: string) => Promise<string | null>;
  private readonly aria2Sha256: string;
  private readonly createWrite: (path: string) => Writable;
  /** Tail of the install requests; never rejects. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly binDir: string,
    opts: BinariesOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.versionOf = opts.versionOf ?? runVersion;
    this.aria2Sha256 = opts.aria2Sha256 ?? ARIA2_ZIP_SHA256;
    this.createWrite = opts.createWrite ?? ((path) => createWriteStream(path));
  }

  path(name: BinName): string {
    return join(this.binDir, `${name}.exe`);
  }

  async status(): Promise<BinStatus[]> {
    return Promise.all(
      NAMES.map(async (name) => {
        const installed = existsSync(this.path(name));
        return { name, installed, version: installed ? await this.versionOf(name, this.path(name)) : null };
      }),
    );
  }

  /**
   * Runs `task` after every earlier install request has finished. The chain itself never rejects, so a failed
   * run does not block the next one; the caller still gets the failure.
   */
  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Installs only what is missing. Requests run one at a time; a later one sees what an earlier one installed. */
  ensureAll(onProgress: (name: BinName, pct: number) => void): Promise<void> {
    return this.serialized(async () => {
      for (const name of NAMES) {
        if (!existsSync(this.path(name))) await this.install(name, onProgress);
      }
    });
  }

  /** Replaces yt-dlp with the latest release. A failed update leaves the current one in place. */
  updateYtDlp(): Promise<string> {
    return this.serialized(async () => {
      await this.install('yt-dlp', () => undefined);
      return (await this.versionOf('yt-dlp', this.path('yt-dlp'))) ?? 'unknown';
    });
  }

  private async install(name: BinName, onProgress: (name: BinName, pct: number) => void): Promise<void> {
    const source = SOURCES[name];
    if (source.checksumsUrl === null && this.aria2Sha256 === '') {
      throw new Error(`the ${name} checksum is not pinned, so it cannot be verified`);
    }
    mkdirSync(this.binDir, { recursive: true });
    const download = join(this.binDir, `${name}.download`);
    const staged = join(this.binDir, `${name}.exe.new`);

    try {
      const actual = await this.download(name, source.url, download, (pct) => onProgress(name, Math.min(99, pct)));
      const expected = source.checksumsUrl === null ? this.aria2Sha256 : await this.publishedChecksum(name, source);
      if (expected === null || expected.toLowerCase() !== actual) throw new ChecksumMismatch(name);

      if (source.member === null) {
        renameSync(download, this.path(name));
      } else {
        if (!(await extractMember(name, download, source.member, staged))) {
          throw new Error(`${source.member} was not found in the ${name} archive`);
        }
        renameSync(staged, this.path(name));
      }
      onProgress(name, 100);
    } finally {
      removeQuietly(download);
      removeQuietly(staged);
    }
  }

  /** Streams the asset to disk and returns its SHA-256. */
  private async download(name: BinName, url: string, dest: string, onPct: (pct: number) => void): Promise<string> {
    const res = await this.get(name, url);
    if (!res.body) throw new Error(`could not download ${name}: empty answer`);
    const total = Number(res.headers.get('content-length') ?? 0);
    const hash = createHash('sha256');
    let received = 0;
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        received += chunk.length;
        if (total > 0) onPct(Math.floor((received / total) * 100));
        callback(null, chunk);
      },
    });
    const source = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
    const failure = await pipeTracked(source, [measure], this.createWrite(dest));
    if (failure !== null) {
      if (failure.side === 'read') throw new Error(`could not download ${name}: the connection was lost`, { cause: failure.error });
      if (failure.side === 'write') {
        const message = failure.error instanceof Error ? failure.error.message : String(failure.error);
        throw knownWriteFailure(name, failure.error) ?? new Error(`could not install ${name}: ${message}`, { cause: failure.error });
      }
      throw failure.error;
    }
    return hash.digest('hex');
  }

  private async publishedChecksum(name: BinName, source: Source): Promise<string | null> {
    const text = await (await this.get(name, source.checksumsUrl as string)).text();
    for (const line of text.split(/\r?\n/u)) {
      const [hash, file] = line.trim().split(/\s+/u);
      if (hash && file && file.replace(/^\*/u, '') === source.assetName && /^[0-9a-f]{64}$/iu.test(hash)) return hash;
    }
    return null;
  }

  private async get(name: BinName, url: string): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { redirect: 'follow' });
    } catch {
      throw new Error(`could not download ${name}: no connection`);
    }
    if (!res.ok) throw new Error(`could not download ${name}: server answered ${res.status}`);
    return res;
  }
}
