import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
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
 * SHA-256 of the aria2 1.37.0 Windows zip. aria2 publishes no checksum file, so the
 * value is pinned here. While it is empty the app refuses to install aria2.
 */
export const ARIA2_ZIP_SHA256 = '';

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

/** Copies one named file out of a zip to `dest`. Nothing else in the archive touches the disk. */
function extractMember(zipPath: string, member: string, dest: string): Promise<boolean> {
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
          pipeline(stream, createWriteStream(dest)).then(
            () => {
              zip.close();
              resolve(true);
            },
            (e: unknown) => {
              zip.close();
              reject(e instanceof Error ? e : new Error(String(e)));
            },
          );
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
}

export class Binaries {
  private readonly fetchImpl: typeof fetch;
  private readonly versionOf: (name: BinName, path: string) => Promise<string | null>;
  private readonly aria2Sha256: string;

  constructor(
    private readonly binDir: string,
    opts: BinariesOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.versionOf = opts.versionOf ?? runVersion;
    this.aria2Sha256 = opts.aria2Sha256 ?? ARIA2_ZIP_SHA256;
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

  /** Installs only what is missing. */
  async ensureAll(onProgress: (name: BinName, pct: number) => void): Promise<void> {
    for (const name of NAMES) {
      if (!existsSync(this.path(name))) await this.install(name, onProgress);
    }
  }

  /** Replaces yt-dlp with the latest release. A failed update leaves the current one in place. */
  async updateYtDlp(): Promise<string> {
    await this.install('yt-dlp', () => undefined);
    return (await this.versionOf('yt-dlp', this.path('yt-dlp'))) ?? 'unknown';
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
        if (!(await extractMember(download, source.member, staged))) {
          throw new Error(`${source.member} was not found in the ${name} archive`);
        }
        renameSync(staged, this.path(name));
      }
      onProgress(name, 100);
    } finally {
      rmSync(download, { force: true });
      rmSync(staged, { force: true });
    }
  }

  /** Streams the asset to disk and returns its SHA-256. */
  private async download(name: BinName, url: string, dest: string, onPct: (pct: number) => void): Promise<string> {
    const res = await this.get(name, url);
    if (!res.body) throw new Error(`could not download ${name}: empty answer`);
    const total = Number(res.headers.get('content-length') ?? 0);
    const hash = createHash('sha256');
    const out = createWriteStream(dest);
    let received = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        received += chunk.length;
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
        if (total > 0) onPct(Math.floor((received / total) * 100));
      }
    } finally {
      await new Promise<void>((r) => out.end(() => r()));
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
