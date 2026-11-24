import { createHash } from 'node:crypto';
import type { createWriteStream as CreateWriteStream, rmSync as RmSync } from 'node:fs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ARIA2_ZIP_SHA256, Binaries, ChecksumMismatch, SOURCES } from '../src/main/binaries';
import type { BinName } from '../src/shared/types';
import { sleep, waitFor } from './wait';
import { makeZip } from './zip';

/** Lets a spec make the file written out of an archive (`<name>.exe.new`) fail with a given error code. */
const archiveFault = vi.hoisted(() => ({ code: null as string | null }));
/** While `on`, removing an install's partial files (`<name>.download`, `<name>.exe.new`) throws; `attempts` counts those removals. */
const cleanupFault = vi.hoisted(() => ({ on: false, attempts: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    createWriteStream: (...args: Parameters<typeof CreateWriteStream>) => {
      if (archiveFault.code !== null && String(args[0]).endsWith('.exe.new')) return failingWrite(archiveFault.code)(String(args[0]));
      return actual.createWriteStream(...args);
    },
    rmSync: (...args: Parameters<typeof RmSync>) => {
      if (cleanupFault.on && /\.(download|exe\.new)$/u.test(String(args[0]))) {
        cleanupFault.attempts += 1;
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      }
      return actual.rmSync(...args);
    },
  };
});

/** A write stream that fails on its first write with `code`. */
function failingWrite(code: string, message = 'write failed'): (path: string) => Writable {
  return () =>
    new Writable({
      write(_chunk, _enc, cb) {
        cb(Object.assign(new Error(message), { code }));
      },
    });
}

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
/** URLs whose first answer is this status, once. */
let failOnce = new Map<string, number>();
/** URLs whose body breaks after its first chunk. */
let cutOff = new Set<string>();
/** While set, a request for `url` is answered only after `open` resolves. */
let hold: { url: string; open: Promise<void> } | null = null;

/** Holds every request for `url` until the returned function is called. */
function holdUrl(url: string): () => void {
  let release!: () => void;
  hold = { url, open: new Promise<void>((r) => (release = r)) };
  return release;
}

const fetchStub = (async (input: Parameters<typeof fetch>[0]) => {
  const url = String(input);
  fetched.push(url);
  if (hold?.url === url) await hold.open;
  const once = failOnce.get(url);
  if (once !== undefined) {
    failOnce.delete(url);
    return new Response('error', { status: once });
  }
  const body = served.get(url);
  if (body === undefined) return new Response('missing', { status: 404 });
  if (typeof body === 'number') return new Response('error', { status: body });
  if (cutOff.has(url)) {
    const firstChunk = new Uint8Array(body.subarray(0, 4));
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return controller.error(new Error('socket hang up'));
        sent = true;
        controller.enqueue(firstChunk);
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-length': String(body.length) } });
  }
  return new Response(new Uint8Array(body), { status: 200, headers: { 'content-length': String(body.length) } });
}) as typeof fetch;

function make(over: { aria2Sha256?: string; createWrite?: (path: string) => Writable } = {}): Binaries {
  return new Binaries(binDir, {
    fetchImpl: fetchStub,
    versionOf: async (name) => `${name} 1.0`,
    aria2Sha256: over.aria2Sha256 ?? sha(ARIA_ZIP),
    ...(over.createWrite ? { createWrite: over.createWrite } : {}),
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
  binDir = join(mkdtempSync(join(tmpdir(), 'fetchly-bin-')), 'bin');
  served = new Map();
  fetched = [];
  failOnce = new Map();
  cutOff = new Set();
  hold = null;
  archiveFault.code = null;
  cleanupFault.on = false;
  cleanupFault.attempts = 0;
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

  // A3 (plan 3.3, spawn rule): the header-carrying starts run `exe.command` unchanged, so the path must name the program file.
  it('names the yt-dlp and aria2c programs with the .exe ending, inside the bin folder', () => {
    const bins = make();
    expect(bins.path('yt-dlp')).toBe(join(binDir, 'yt-dlp.exe'));
    expect(bins.path('aria2c')).toBe(join(binDir, 'aria2c.exe'));
    expect(bins.path('yt-dlp').endsWith('.exe')).toBe(true);
    expect(bins.path('aria2c').endsWith('.exe')).toBe(true);
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

const ytAsset = () => SOURCES['yt-dlp'].url;
const ytSums = () => SOURCES['yt-dlp'].checksumsUrl as string;

/** Serves `content` as the latest yt-dlp, with a matching checksum list. */
function serveYtDlp(content: Buffer): void {
  served.set(ytAsset(), content);
  served.set(ytSums(), Buffer.from(`${sha(content)}  yt-dlp.exe\n`));
}

describe('Binaries: one install at a time', () => {
  it('runs two updates one after the other', async () => {
    const bins = make();
    await bins.ensureAll(() => undefined);
    const next = Buffer.from('yt-dlp binary v3');
    serveYtDlp(next);
    fetched = [];
    const release = holdUrl(ytSums());

    const u1 = bins.updateYtDlp();
    await waitFor(() => fetched.includes(ytSums()));
    const u2 = bins.updateYtDlp();
    await sleep(60);
    expect(fetched.filter((u) => u === ytAsset())).toHaveLength(1);
    expect(fetched).toEqual([ytAsset(), ytSums()]);

    release();
    await expect(Promise.all([u1, u2])).resolves.toEqual(['yt-dlp 1.0', 'yt-dlp 1.0']);
    expect(fetched).toEqual([ytAsset(), ytSums(), ytAsset(), ytSums()]);
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(next);
    expect(leftovers()).toEqual([]);
  });

  it('a second install request waits and then finds everything installed', async () => {
    const bins = make();
    await Promise.all([bins.ensureAll(() => undefined), bins.ensureAll(() => undefined)]);
    for (const name of ['yt-dlp', 'ffmpeg', 'aria2c'] as const) {
      expect(fetched.filter((u) => u === SOURCES[name].url)).toHaveLength(1);
    }
    expect(leftovers()).toEqual([]);
  });

  it('a failed install does not block the next one', async () => {
    const bins = make();
    await bins.ensureAll(() => undefined);
    const next = Buffer.from('yt-dlp binary v3');
    serveYtDlp(next);
    failOnce.set(ytAsset(), 500);
    fetched = [];
    // The first request is held so that a second one that did not wait would show up in `fetched`.
    const release = holdUrl(ytAsset());

    const first = bins.updateYtDlp();
    const firstOutcome = expect(first).rejects.toThrow(/yt-dlp.*500/);
    await waitFor(() => fetched.length > 0);
    const second = bins.updateYtDlp();
    await sleep(60);
    expect(fetched).toEqual([ytAsset()]);

    release();
    await firstOutcome;
    await expect(second).resolves.toBe('yt-dlp 1.0');
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(next);
    expect(leftovers()).toEqual([]);
  });

  it('starts the next install with a clean folder after a failed one', async () => {
    const bins = make();
    await bins.ensureAll(() => undefined);
    served.set(ytAsset(), Buffer.from('tampered'));
    const first = bins.updateYtDlp();
    const firstOutcome = expect(first).rejects.toThrow(ChecksumMismatch);
    const second = bins.updateYtDlp();
    await firstOutcome;
    // The second run sees the server as it is now: still the tampered file, so it fails the same way, not on a leftover.
    await expect(second).rejects.toThrow(ChecksumMismatch);
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(YT);
    expect(leftovers()).toEqual([]);
  });

  it('does not queue status() behind an install', async () => {
    const bins = make();
    const release = holdUrl(ytAsset());
    const install = bins.ensureAll(() => undefined);
    await waitFor(() => fetched.includes(ytAsset()));
    await expect(bins.status()).resolves.toEqual([
      { name: 'yt-dlp', installed: false, version: null },
      { name: 'ffmpeg', installed: false, version: null },
      { name: 'aria2c', installed: false, version: null },
    ]);
    release();
    await install;
  });
});

describe('Binaries: failures while writing and downloading', () => {
  /** Installs everything, then makes the server offer a newer yt-dlp. */
  async function installFirst(): Promise<void> {
    await make().ensureAll(() => undefined);
    serveYtDlp(Buffer.from('yt-dlp binary v3'));
  }

  it('reports a disk-write failure and keeps the working yt-dlp', async () => {
    await installFirst();
    const bins = make({ createWrite: failingWrite('ENOSPC') });
    await expect(bins.updateYtDlp()).rejects.toThrow('could not install yt-dlp: disk full');
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(YT);
    expect(leftovers()).toEqual([]);
  });

  it('reports a folder that cannot be written', async () => {
    await installFirst();
    const bins = make({ createWrite: failingWrite('EACCES') });
    await expect(bins.updateYtDlp()).rejects.toThrow('could not install yt-dlp: cannot write to folder');
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(YT);
    expect(leftovers()).toEqual([]);
  });

  it('reports a folder that is locked by the system the same way (EPERM)', async () => {
    await installFirst();
    const bins = make({ createWrite: failingWrite('EPERM') });
    await expect(bins.updateYtDlp()).rejects.toThrow('could not install yt-dlp: cannot write to folder');
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(YT);
  });

  it('gives any other write error its own message', async () => {
    await installFirst();
    const bins = make({ createWrite: failingWrite('EIO', 'the device stopped answering') });
    await expect(bins.updateYtDlp()).rejects.toThrow('could not install yt-dlp: the device stopped answering');
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(YT);
    expect(leftovers()).toEqual([]);
  });

  it('names the binary in a first-time write failure', async () => {
    await expect(make({ createWrite: failingWrite('ENOSPC') }).ensureAll(() => undefined)).rejects.toThrow(
      'could not install yt-dlp: disk full',
    );
    expect(existsSync(join(binDir, 'yt-dlp.exe'))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('a download cut off mid-way leaves no file', async () => {
    const bins = make();
    await bins.ensureAll(() => undefined);
    serveYtDlp(Buffer.from('yt-dlp binary v3, long enough to be cut'));
    cutOff.add(SOURCES['yt-dlp'].url);
    await expect(bins.updateYtDlp()).rejects.toThrow('could not download yt-dlp: the connection was lost');
    expect(readdirSync(binDir)).not.toContain('yt-dlp.download');
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(YT);
    expect(leftovers()).toEqual([]);
  });

  it('a write error is not taken for a lost connection, and the reverse', async () => {
    // The two failures can look alike (both end the pipeline with an error); only the failing side tells them apart.
    await installFirst();
    await expect(make({ createWrite: failingWrite('EIO', 'socket hang up') }).updateYtDlp()).rejects.toThrow(
      'could not install yt-dlp: socket hang up',
    );
    cutOff.add(SOURCES['yt-dlp'].url);
    await expect(make().updateYtDlp()).rejects.toThrow('could not download yt-dlp: the connection was lost');
  });

  it('keeps the install error when removing the partial file fails too (F4)', async () => {
    const bins = make();
    await bins.ensureAll(() => undefined);
    served.set(ytAsset(), Buffer.from('tampered'));
    cleanupFault.on = true;
    const outcome = bins.updateYtDlp();
    await expect(outcome).rejects.toThrow(ChecksumMismatch);
    await expect(outcome).rejects.toThrow('the downloaded yt-dlp does not match its published checksum');
    expect(cleanupFault.attempts).toBeGreaterThan(0); // the cleanup ran and failed
    expect(readdirSync(binDir)).toContain('yt-dlp.download'); // so the partial file is still there
    expect(readFileSync(join(binDir, 'yt-dlp.exe'))).toEqual(YT);
  });

  it.each(['ENOSPC', 'EACCES', 'EPERM'])('reports %s while taking a file out of an archive', async (code) => {
    archiveFault.code = code;
    const text = code === 'ENOSPC' ? 'disk full' : 'cannot write to folder';
    await expect(make().ensureAll(() => undefined)).rejects.toThrow(`could not install ffmpeg: ${text}`);
    expect(existsSync(join(binDir, 'ffmpeg.exe'))).toBe(false);
    expect(leftovers()).toEqual([]);
  });
});
