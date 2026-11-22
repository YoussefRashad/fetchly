import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ARIA2_ZIP_SHA256, Binaries, ChecksumMismatch, SOURCES } from '../src/main/binaries';
import type { BinName } from '../src/shared/types';
import { makeZip } from './zip';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const YT = Buffer.from('yt-dlp binary v2');
const FFMPEG_ZIP = makeZip({
  'ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe': 'ffmpeg binary',
  'ffmpeg-master-latest-win64-gpl/bin/ffprobe.exe': 'ffprobe binary',
  'ffmpeg-master-latest-win64-gpl/LICENSE.txt': 'license',
});
const ARIA_ZIP = makeZip({
  'aria2-1.37.0-win-64bit-build1/aria2c.exe': 'aria2 binary',
  'aria2-1.37.0-win-64bit-build1/README.html': 'readme',
});

let binDir: string;
let served: Map<string, Buffer | number>;
let fetched: string[];

const fetchStub = (async (input: Parameters<typeof fetch>[0]) => {
  const url = String(input);
  fetched.push(url);
  const body = served.get(url);
  if (body === undefined) return new Response('missing', { status: 404 });
  if (typeof body === 'number') return new Response('error', { status: body });
  return new Response(new Uint8Array(body), { status: 200, headers: { 'content-length': String(body.length) } });
}) as typeof fetch;

function make(over: { aria2Sha256?: string } = {}): Binaries {
  return new Binaries(binDir, {
    fetchImpl: fetchStub,
    versionOf: async (name) => `${name} 1.0`,
    aria2Sha256: over.aria2Sha256 ?? sha(ARIA_ZIP),
  });
}

function serveAll(): void {
  served.set(SOURCES['yt-dlp'].url, YT);
  served.set(SOURCES['yt-dlp'].checksumsUrl as string, Buffer.from(`${sha('other')}  yt-dlp\n${sha(YT)}  yt-dlp.exe\n`));
  served.set(SOURCES.ffmpeg.url, FFMPEG_ZIP);
  served.set(
    SOURCES.ffmpeg.checksumsUrl as string,
    Buffer.from(`${sha(FFMPEG_ZIP)} *ffmpeg-master-latest-win64-gpl.zip\n${sha('x')}  ffmpeg-master-latest-linux64-gpl.tar.xz\n`),
  );
  served.set(SOURCES.aria2c.url, ARIA_ZIP);
}

const leftovers = () => readdirSync(binDir).filter((n) => !/^(yt-dlp|ffmpeg|aria2c)\.exe$/.test(n));

beforeEach(() => {
  binDir = join(mkdtempSync(join(tmpdir(), 'hammel-bin-')), 'bin');
  served = new Map();
  fetched = [];
  serveAll();
});

describe('Binaries', () => {
  it('ships with the aria2 archive checksum pinned', () => {
    // Cross-checked on 2026-11-22: the release asset, the Scoop manifest and the winget manifest all give this value.
    expect(ARIA2_ZIP_SHA256).toBe('67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288');
  });

  it('checks aria2 against the built-in pin and rejects any other archive', async () => {
    const bins = new Binaries(binDir, { fetchImpl: fetchStub, versionOf: async () => '1' });
    // The stub serves a different archive than the real one, so the built-in pin must reject it.
    await expect(bins.ensureAll(() => undefined)).rejects.toThrow(ChecksumMismatch);
    expect(fetched).toContain(SOURCES.aria2c.url);
  });

  it('uses only https release assets', () => {
    for (const source of Object.values(SOURCES)) {
      expect(source.url).toMatch(/^https:\/\/github\.com\//);
      if (source.checksumsUrl) expect(source.checksumsUrl).toMatch(/^https:\/\/github\.com\//);
    }
  });

  it('installs all three, verified, leaving nothing else behind', async () => {
    const progress: [BinName, number][] = [];
    await make().ensureAll((name, pct) => progress.push([name, pct]));
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(YT);
    expect(readFileSync(join(binDir, 'ffmpeg.exe'), 'utf8')).toBe('ffmpeg binary');
    expect(readFileSync(join(binDir, 'aria2c.exe'), 'utf8')).toBe('aria2 binary');
    expect(leftovers()).toEqual([]);
    for (const name of ['yt-dlp', 'ffmpeg', 'aria2c'] as const) {
      expect(progress.filter(([n]) => n === name).at(-1)).toEqual([name, 100]);
    }
  });

  it('reports what is installed', async () => {
    const bins = make();
    expect(await bins.status()).toEqual([
      { name: 'yt-dlp', installed: false, version: null },
      { name: 'ffmpeg', installed: false, version: null },
      { name: 'aria2c', installed: false, version: null },
    ]);
    await bins.ensureAll(() => undefined);
    expect(await bins.status()).toEqual([
      { name: 'yt-dlp', installed: true, version: 'yt-dlp 1.0' },
      { name: 'ffmpeg', installed: true, version: 'ffmpeg 1.0' },
      { name: 'aria2c', installed: true, version: 'aria2c 1.0' },
    ]);
  });

  it('downloads nothing when everything is already there', async () => {
    const bins = make();
    await bins.ensureAll(() => undefined);
    fetched = [];
    await bins.ensureAll(() => undefined);
    expect(fetched).toEqual([]);
  });

  it('installs only what is missing', async () => {
    const bins = make();
    await bins.ensureAll(() => undefined);
    writeFileSync(join(binDir, 'ffmpeg.exe'), 'kept');
    fetched = [];
    const { rmSync } = await import('node:fs');
    rmSync(join(binDir, 'aria2c.exe'));
    await bins.ensureAll(() => undefined);
    expect(fetched).toEqual([SOURCES.aria2c.url]);
    expect(readFileSync(join(binDir, 'ffmpeg.exe'), 'utf8')).toBe('kept');
  });

  it('rejects a yt-dlp download whose checksum does not match', async () => {
    served.set(SOURCES['yt-dlp'].url, Buffer.from('tampered'));
    await expect(make().ensureAll(() => undefined)).rejects.toThrow(ChecksumMismatch);
    expect(existsSync(join(binDir, 'yt-dlp.exe'))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('rejects a download whose checksum list does not mention it', async () => {
    served.set(SOURCES['yt-dlp'].checksumsUrl as string, Buffer.from(`${sha(YT)}  something-else.exe\n`));
    await expect(make().ensureAll(() => undefined)).rejects.toThrow(ChecksumMismatch);
    expect(existsSync(join(binDir, 'yt-dlp.exe'))).toBe(false);
  });

  it('rejects an ffmpeg archive whose checksum does not match', async () => {
    served.set(SOURCES.ffmpeg.url, makeZip({ 'x/bin/ffmpeg.exe': 'tampered' }));
    await expect(make().ensureAll(() => undefined)).rejects.toThrow(ChecksumMismatch);
    expect(existsSync(join(binDir, 'ffmpeg.exe'))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('rejects an aria2 archive that differs from the pinned one', async () => {
    await expect(make({ aria2Sha256: sha('a different build') }).ensureAll(() => undefined)).rejects.toThrow(ChecksumMismatch);
    expect(existsSync(join(binDir, 'aria2c.exe'))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('refuses to install aria2 when no checksum is pinned', async () => {
    await expect(make({ aria2Sha256: '' }).ensureAll(() => undefined)).rejects.toThrow(/aria2c.*not pinned/);
    expect(fetched).not.toContain(SOURCES.aria2c.url);
  });

  it('names the binary when the server refuses', async () => {
    served.set(SOURCES.ffmpeg.url, 404);
    await expect(make().ensureAll(() => undefined)).rejects.toThrow(/ffmpeg.*404/);
  });

  it('fails clearly when an archive does not contain the program', async () => {
    const zip = makeZip({ 'x/README.txt': 'nothing here' });
    served.set(SOURCES.aria2c.url, zip);
    await expect(make({ aria2Sha256: sha(zip) }).ensureAll(() => undefined)).rejects.toThrow(/aria2c\.exe/);
    expect(leftovers()).toEqual([]);
  });

  it('updates yt-dlp and reports the new version', async () => {
    const bins = make();
    await bins.ensureAll(() => undefined);
    const next = Buffer.from('yt-dlp binary v3');
    served.set(SOURCES['yt-dlp'].url, next);
    served.set(SOURCES['yt-dlp'].checksumsUrl as string, Buffer.from(`${sha(next)}  yt-dlp.exe\n`));
    expect(await bins.updateYtDlp()).toBe('yt-dlp 1.0');
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(next);
  });

  it('keeps the working yt-dlp when an update fails its checksum', async () => {
    const bins = make();
    await bins.ensureAll(() => undefined);
    served.set(SOURCES['yt-dlp'].url, Buffer.from('tampered'));
    await expect(bins.updateYtDlp()).rejects.toThrow(ChecksumMismatch);
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(YT);
    expect(leftovers()).toEqual([]);
  });

  it('keeps the working yt-dlp when the update server is unreachable', async () => {
    const bins = make();
    await bins.ensureAll(() => undefined);
    served.set(SOURCES['yt-dlp'].url, 503);
    await expect(bins.updateYtDlp()).rejects.toThrow(/yt-dlp.*503/);
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(YT);
  });
});
