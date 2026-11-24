import type { ChildProcess } from 'node:child_process';
import { EventEmitter, getEventListeners } from 'node:events';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Exe } from '../src/main/engines/media';
import { InvalidUrl, ProbeError, probeUrl, UNREADABLE, validateUrl } from '../src/main/probe';
import type { ProbeResult } from '../src/shared/types';
import { waitFor } from './wait';

const FAKE: Exe = { command: process.execPath, prefixArgs: [resolve('tests/fakes/fake-ytdlp.mjs')] };
const URL = 'https://example.com/files/report.pdf';

interface Seen {
  url: string;
  range: string | null;
}

function stubFetch(status: number, headers: Record<string, string>, seen: Seen[] = []): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    seen.push({ url: String(input), range: new Headers(init?.headers).get('range') });
    return new Response(null, { status, headers });
  }) as typeof fetch;
}

const neverFetch = (() => {
  throw new Error('fetch must not be called');
}) as unknown as typeof fetch;

function probe(scenario: string, fetchImpl: typeof fetch = neverFetch, timeoutMs?: number, opts?: ProbeOpts) {
  process.env['FAKE_YTDLP'] = scenario;
  return probeUrl(URL, FAKE, fetchImpl, timeoutMs, opts);
}

async function reasonOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProbeError) return e.reason;
    throw e;
  }
  throw new Error('expected a ProbeError');
}

afterEach(() => {
  delete process.env['FAKE_YTDLP'];
});

describe('validateUrl', () => {
  it('trims and returns an http(s) url', () => {
    expect(validateUrl('  https://a.b/c ')).toBe('https://a.b/c');
    expect(validateUrl('http://a.b/c?x=1')).toBe('http://a.b/c?x=1');
  });

  it.each(['file:///C:/x', 'hello', '', 'javascript:alert(1)', 'ftp://a.b/c', '-o https://a.b'])('rejects %j', (raw) => {
    expect(() => validateUrl(raw)).toThrow(InvalidUrl);
  });
});

describe('probeUrl', () => {
  it('recognises a video', async () => {
    expect(await probe('probe-video')).toEqual({ kind: 'media', title: 'Talk', thumbnail: null, heights: [1080, 720] });
  });

  it('recognises a playlist', async () => {
    const result = await probe('probe-playlist');
    expect(result).toMatchObject({ kind: 'playlist', title: 'Course' });
    expect(result.kind === 'playlist' && result.entries.length).toBe(2);
  });

  it('treats a link yt-dlp does not know as a file and checks for resume support', async () => {
    const seen: Seen[] = [];
    const result = await probe('probe-unsupported', stubFetch(206, { 'content-range': 'bytes 0-0/1000' }, seen));
    expect(result).toEqual({ kind: 'file', fileName: 'report.pdf', size: 1000, resumable: true });
    expect(seen).toEqual([{ url: URL, range: 'bytes=0-0' }]);
  });

  it('treats a direct link yt-dlp merely passes through as a file', async () => {
    const result = await probe('probe-direct', stubFetch(206, { 'content-range': 'bytes 0-0/52' }));
    expect(result).toEqual({ kind: 'file', fileName: 'report.pdf', size: 52, resumable: true });
  });

  it('marks a server without range support as not resumable', async () => {
    const result = await probe('probe-unsupported', stubFetch(200, { 'content-length': '2048' }));
    expect(result).toEqual({ kind: 'file', fileName: 'report.pdf', size: 2048, resumable: false });
  });

  it('copes with an unknown size', async () => {
    expect(await probe('probe-unsupported', stubFetch(206, { 'content-range': 'bytes 0-0/*' }))).toMatchObject({ size: null });
    expect(await probe('probe-unsupported', stubFetch(200, {}))).toMatchObject({ size: null, resumable: false });
  });

  it('refuses to save a web page as a file', async () => {
    const p = probe('probe-unsupported', stubFetch(200, { 'content-type': 'text/html; charset=utf-8' }));
    expect(await reasonOf(p)).toBe('this link is a web page, not a file');
  });

  it.each([403, 404, 500])('reports a server answer of %d', async (status) => {
    expect(await reasonOf(probe('probe-unsupported', stubFetch(status, {})))).toBe(`server answered ${status}`);
  });

  it('reports a server that cannot be reached', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await reasonOf(probe('probe-unsupported', failing))).toBe('could not reach the server');
  });

  it('shows why a video cannot be downloaded instead of falling back to a file', async () => {
    expect(await reasonOf(probe('probe-private'))).toBe('private');
  });

  it('takes the name from Content-Disposition and makes it safe', async () => {
    const headers = { 'content-range': 'bytes 0-0/9', 'content-disposition': 'attachment; filename="re:port?.pdf"' };
    expect(await probe('probe-unsupported', stubFetch(206, headers))).toMatchObject({ fileName: 're port.pdf' });
  });

  it('reads an encoded Content-Disposition name', async () => {
    const headers = { 'content-range': 'bytes 0-0/9', 'content-disposition': "attachment; filename*=UTF-8''%D9%85%D9%84%D9%81.pdf" };
    expect(await probe('probe-unsupported', stubFetch(206, headers))).toMatchObject({ fileName: 'ملف.pdf' });
  });

  it('never lets a server-chosen name leave the download folder', async () => {
    const headers = { 'content-range': 'bytes 0-0/9', 'content-disposition': 'attachment; filename="..\\..\\evil.exe"' };
    const result = await probe('probe-unsupported', stubFetch(206, headers));
    expect(result.kind === 'file' && result.fileName).toBe('evil.exe');
  });

  it('caps a server-chosen name at 150 characters with a 16-character extension', async () => {
    const long = `${'s'.repeat(150)}.${'e'.repeat(150)}`;
    const headers = { 'content-range': 'bytes 0-0/9', 'content-disposition': `attachment; filename="${long}"` };
    const result = await probe('probe-unsupported', stubFetch(206, headers));
    const name = result.kind === 'file' ? result.fileName : '';
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.split('.').pop()).toBe('e'.repeat(16));
  });

  it('makes a device name safe', async () => {
    const headers = { 'content-range': 'bytes 0-0/9', 'content-disposition': 'attachment; filename="CON"' };
    expect(await probe('probe-unsupported', stubFetch(206, headers))).toMatchObject({ fileName: '_CON' });
  });

  it('falls back to "download" when the link has no file name', async () => {
    process.env['FAKE_YTDLP'] = 'probe-unsupported';
    const result = await probeUrl('https://example.com/', FAKE, stubFetch(206, { 'content-range': 'bytes 0-0/9' }));
    expect(result).toMatchObject({ fileName: 'download' });
  });

  it('decodes the name in the link', async () => {
    process.env['FAKE_YTDLP'] = 'probe-unsupported';
    const result = await probeUrl('https://example.com/a/My%20File.zip?token=1', FAKE, stubFetch(206, { 'content-range': 'bytes 0-0/9' }));
    expect(result).toMatchObject({ fileName: 'My File.zip' });
  });

  it('says yt-dlp stopped, not that a download failed, when it ends without an error of its own', async () => {
    expect(await reasonOf(probe('probe-killed'))).toBe('yt-dlp stopped before it could read the link. Try again.');
  });

  it('still reports the error yt-dlp gave when it gave one', async () => {
    expect(await reasonOf(probe('probe-private'))).not.toBe('yt-dlp stopped before it could read the link. Try again.');
  });

  it('reports unreadable yt-dlp output', async () => {
    expect(await reasonOf(probe('probe-garbage'))).toBe('could not read the video information');
  });

  describe('the 64 MB limit on video information', () => {
    const CAP = 64 * 1024 * 1024;
    afterEach(() => {
      delete process.env['FAKE_YTDLP_PROBE_BYTES'];
    });

    it('reads video information of exactly the limit', async () => {
      process.env['FAKE_YTDLP_PROBE_BYTES'] = String(CAP);
      expect(await probe('probe-sized')).toMatchObject({ kind: 'media', title: 'Huge', heights: [720] });
    }, 30000);

    it('reports one byte over the limit as unreadable, without "try again"', async () => {
      process.env['FAKE_YTDLP_PROBE_BYTES'] = String(CAP + 1);
      const reason = await reasonOf(probe('probe-sized'));
      expect(reason).toBe('could not read the video information');
      expect(reason).not.toMatch(/try again/iu);
    }, 30000);
  });

  it('gives up on a probe that hangs', async () => {
    expect(await reasonOf(probe('probe-hang', neverFetch, 300))).toBe('timed out reading the link');
  });

  it('says so when yt-dlp is not installed', async () => {
    const p = probeUrl(URL, { command: resolve('tests/fakes/missing.exe'), prefixArgs: [] }, neverFetch);
    expect(await reasonOf(p)).toBe('yt-dlp is not installed');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A3 Task T4 (plan 3.5, X18): the probe run on `spawn`, its kills, its output cap and its settle timer.
// The seam is `opts.spawn`; `opts.kill` is a spy (the default is the tree kill), time is faked, and the "child" is an
// EventEmitter with two streams, so the order of `exit`, `close` and `error` is the spec's, not the machine's.
// ---------------------------------------------------------------------------------------------------------------------
type ProbeOpts = NonNullable<Parameters<typeof probeUrl>[4]>;

const STOPPED_EARLY_TEXT = 'yt-dlp stopped before it could read the link. Try again.';
const UNREADABLE_TEXT = 'could not read the video information';
const TIMED_OUT_TEXT = 'timed out reading the link';
const NOT_INSTALLED_TEXT = 'yt-dlp is not installed';
const VIDEO = { kind: 'media', title: 'Talk', thumbnail: null, heights: [1080, 720] };
const VIDEO_JSON = `${JSON.stringify({ title: 'Talk', thumbnail: null, extractor: 'youtube', formats: [{ height: 1080 }, { height: 720 }] })}\n`;
const REFERER = 'https://a.example/watch';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
/** PA3-6: every character a shell or the tools could treat as special; yt-dlp got it byte for byte. */
const PA3_6_UA = 'Mozilla/5.0 "q" \\ %PATH% ^ & | < > ` $(x) ; --output=evil -o x';
const FOUR = ['--add-headers', `Referer:${REFERER}`, '--add-headers', `User-Agent:${UA}`];

/** What a process is as probe.ts sees it: events `exit`, `close`, `error`; two streams; a pid; the exit state. */
class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  /** ChildProcess#kill. The probe must end the process through opts.kill, never through this. */
  readonly directKills: (NodeJS.Signals | number | undefined)[] = [];
  kill(signal?: NodeJS.Signals | number): boolean {
    this.directKills.push(signal);
    return true;
  }
}

interface Outcome<T> {
  state: 'pending' | 'resolved' | 'rejected';
  value: T | undefined;
  error: unknown;
}
function track<T>(p: Promise<T>): Outcome<T> {
  const out: Outcome<T> = { state: 'pending', value: undefined, error: undefined };
  p.then(
    (v) => {
      out.state = 'resolved';
      out.value = v;
    },
    (e: unknown) => {
      out.state = 'rejected';
      out.error = e;
    },
  );
  return out;
}
const reasonText = (error: unknown): string => (error instanceof ProbeError ? error.reason : `not a ProbeError: ${String(error)}`);

/** Lets timers due now, microtasks, next ticks and stream events run, without moving the clock. */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
};
const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

interface Run {
  child: FakeChild;
  kill: Mock<(child: ChildProcess) => void>;
  spawn: Mock;
  outcome: Outcome<ProbeResult>;
}

/** Starts probeUrl on a fake child. `over` goes into opts; the default kill is a spy that ends nothing. */
async function start(over: Partial<ProbeOpts> = {}, call: { url?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<Run> {
  const child = new FakeChild();
  const kill = vi.fn<(child: ChildProcess) => void>();
  const spawn = vi.fn(() => child as unknown as ChildProcess);
  const outcome = track(probeUrl(call.url ?? URL, FAKE, call.fetchImpl ?? neverFetch, call.timeoutMs, { spawn, kill, ...over } as ProbeOpts));
  await flush();
  return { child, kill, spawn, outcome };
}

/** The process ends the way Node reports it: `exit`, then its streams end, then `close`. */
async function finish(child: FakeChild, code: number | null, signal: NodeJS.Signals | null = null): Promise<void> {
  child.exitCode = code;
  child.signalCode = signal;
  child.emit('exit', code, signal);
  await flush();
  child.stdout.end();
  child.stderr.end();
  await flush();
  child.emit('close', code, signal);
  await flush();
}

/** `exit` alone: the case where a child still holds the pipes and `close` does not come. */
async function exitOnly(child: FakeChild, code: number | null, signal: NodeJS.Signals | null = null): Promise<void> {
  child.exitCode = code;
  child.signalCode = signal;
  child.emit('exit', code, signal);
  await flush();
}

async function write(child: FakeChild, data: string | Buffer): Promise<void> {
  child.stdout.write(data);
  await flush();
}

/** A video JSON of exactly `bytes` bytes (padding is ASCII), whose title may hold multi-byte characters. */
function videoOfBytes(bytes: number, title = 'Talk'): Buffer {
  const head = `{"title":"${title}","formats":[{"height":720}],"pad":"`;
  const tail = '"}';
  const pad = bytes - Buffer.byteLength(head) - Buffer.byteLength(tail);
  if (pad < 0) throw new Error('too small');
  return Buffer.from(head + 'x'.repeat(pad) + tail);
}

/** `args` without the contiguous `run`, or `args` itself when it holds none. */
function without(args: string[], run: string[]): string[] {
  for (let i = 0; i + run.length <= args.length; i += 1) {
    if (run.every((v, k) => args[i + k] === v)) return [...args.slice(0, i), ...args.slice(i + run.length)];
  }
  return args;
}

describe('probe exports (A3)', () => {
  it('exports UNREADABLE, the fixed text of an unreadable result', () => {
    expect(UNREADABLE).toBe(UNREADABLE_TEXT);
  });
});

describe('probeUrl on a fake process (X18)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env['FETCHLY_PROBE_MARKER'];
  });

  describe('the start', () => {
    it('spawns exe.command with its prefix and the probe arguments, shell false, hidden, in today’s environment', async () => {
      process.env['FETCHLY_PROBE_MARKER'] = 'kept';
      const r = await start({ headers: { referer: REFERER, userAgent: UA } });
      expect(r.spawn).toHaveBeenCalledTimes(1);
      const [command, args, options] = r.spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
      expect(command).toBe(FAKE.command);
      expect(args.slice(0, FAKE.prefixArgs.length)).toEqual(FAKE.prefixArgs);
      const probe = args.slice(FAKE.prefixArgs.length);
      expect(without(probe, FOUR)).toEqual(['-J', '--flat-playlist', '--no-warnings', '--', URL]);
      expect(probe).toHaveLength(5 + 4);
      expect(options['shell']).toBe(false);
      expect(options['windowsHide']).toBe(true);
      expect(options['env']).toMatchObject({ FETCHLY_PROBE_MARKER: 'kept', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
    });

    it('sends no header when none is given: opts left out, headers left out, and two null values', async () => {
      for (const over of [{}, { headers: undefined }, { headers: { referer: null, userAgent: null } }] as Partial<ProbeOpts>[]) {
        const r = await start(over);
        const args = (r.spawn.mock.calls[0] as unknown as [string, string[]])[1];
        expect(args.slice(FAKE.prefixArgs.length)).toEqual(['-J', '--flat-playlist', '--no-warnings', '--', URL]);
      }
    });

    it('adds no argv element for a hostile or unfit header, and none holds its text', async () => {
      const r = await start({ headers: { referer: 'https://a.example/p?token=1', userAgent: 'x\r\nX-Evil: 1' } });
      const args = (r.spawn.mock.calls[0] as unknown as [string, string[]])[1].slice(FAKE.prefixArgs.length);
      expect(args).toEqual(['-J', '--flat-playlist', '--no-warnings', '--', URL]);
      for (const a of args) expect(a.includes('token=1') || a.includes('X-Evil')).toBe(false);
    });

    it("passes PA3-6's User-Agent as exactly one element, byte for byte", async () => {
      const r = await start({ headers: { referer: null, userAgent: PA3_6_UA } });
      const args = (r.spawn.mock.calls[0] as unknown as [string, string[]])[1].slice(FAKE.prefixArgs.length);
      expect(args).toHaveLength(5 + 2);
      expect(args.filter((a) => a === `User-Agent:${PA3_6_UA}`)).toHaveLength(1);
      expect(without(args, ['--add-headers', `User-Agent:${PA3_6_UA}`])).toEqual(['-J', '--flat-playlist', '--no-warnings', '--', URL]);
    });

    it('keeps a link that starts with a dash after --', async () => {
      const r = await start({ headers: { referer: REFERER, userAgent: UA } }, { url: '-o https://a.b' });
      const args = (r.spawn.mock.calls[0] as unknown as [string, string[]])[1];
      expect(args.slice(-2)).toEqual(['--', '-o https://a.b']);
    });
  });

  describe('the normal end', () => {
    it('settles with the result when the process closes, and leaves no timer behind', async () => {
      const r = await start();
      await write(r.child, VIDEO_JSON);
      await finish(r.child, 0);
      expect(r.outcome.state).toBe('resolved');
      expect(r.outcome.value).toEqual(VIDEO);
      expect(vi.getTimerCount()).toBe(0);
      expect(r.kill).not.toHaveBeenCalled();
      expect(r.child.directKills).toEqual([]);
    });

    it('reads the result when the output comes in several pieces', async () => {
      const r = await start();
      const half = Math.floor(VIDEO_JSON.length / 2);
      await write(r.child, VIDEO_JSON.slice(0, half));
      await write(r.child, VIDEO_JSON.slice(half));
      await finish(r.child, 0);
      expect(r.outcome.value).toEqual(VIDEO);
    });

    it('still reports the error yt-dlp gave, and "stopped" when it gave none', async () => {
      const a = await start();
      a.child.stderr.write('ERROR: [youtube] x: Private video\n');
      await flush();
      await finish(a.child, 1);
      expect(reasonText(a.outcome.error)).toBe('private');
      const b = await start();
      await finish(b.child, 1);
      expect(reasonText(b.outcome.error)).toBe(STOPPED_EARLY_TEXT);
    });

    it('exit, then close at 4 999 ms: the normal result, and no timer is left', async () => {
      const r = await start();
      await write(r.child, VIDEO_JSON);
      await exitOnly(r.child, 0);
      await advance(4999);
      expect(r.outcome.state).toBe('pending');
      r.child.stdout.end();
      r.child.stderr.end();
      r.child.emit('close', 0, null);
      await flush();
      expect(r.outcome.state).toBe('resolved');
      expect(r.outcome.value).toEqual(VIDEO);
      expect(vi.getTimerCount()).toBe(0);
      await advance(120000);
      expect(r.kill).not.toHaveBeenCalled();
    });

    it('close at once after exit gives the result even with the settle timer armed by exit', async () => {
      const r = await start();
      await write(r.child, VIDEO_JSON);
      await exitOnly(r.child, 0);
      r.child.emit('close', 0, null);
      await flush();
      expect(r.outcome.state).toBe('resolved');
      await advance(10000);
      expect(r.outcome.state).toBe('resolved');
      expect(r.outcome.value).toEqual(VIDEO);
    });
  });

  describe('the time limit', () => {
    it('does not kill at 29 999 ms; kills once at 30 000 ms, with the child, while it is alive', async () => {
      const aliveAtKill: boolean[] = [];
      const killSpy = vi.fn<(child: ChildProcess) => void>((c) => void aliveAtKill.push((c as unknown as FakeChild).exitCode === null));
      const r = await start({ kill: killSpy });
      await advance(29999);
      expect(killSpy).not.toHaveBeenCalled();
      await advance(1);
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(r.child);
      expect(aliveAtKill).toEqual([true]);
      expect(r.child.directKills).toEqual([]);
    });

    it('settles with the time-out reason when the process closes after the kill, and never kills twice', async () => {
      const r = await start();
      await advance(30000);
      expect(r.kill).toHaveBeenCalledTimes(1);
      expect(r.kill).toHaveBeenCalledWith(r.child);
      await finish(r.child, null, 'SIGTERM');
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(TIMED_OUT_TEXT);
      await advance(120000);
      expect(r.kill).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    // Plan 3.5 says what a kill that ends nothing does; a kill that throws ends nothing too (the same guard as
    // MediaEngine.killChild). A throw out of a timer callback would be an uncaught exception in the main process.
    it('a kill that throws ends nothing as well: the throw does not escape, and the run settles killGraceMs later with the kill’s reason', async () => {
      const kill = vi.fn<(child: ChildProcess) => void>(() => {
        throw new Error('taskkill could not be started');
      });
      const r = await start({ kill });
      await advance(30000); // an escaping throw surfaces here
      expect(kill).toHaveBeenCalledTimes(1);
      await advance(4999);
      expect(r.outcome.state).toBe('pending');
      await advance(1);
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(TIMED_OUT_TEXT);
      expect(kill).toHaveBeenCalledTimes(1);
    });

    it('uses the time limit it is given', async () => {
      const r = await start({}, { timeoutMs: 1500 });
      await advance(1499);
      expect(r.kill).not.toHaveBeenCalled();
      await advance(1);
      expect(r.kill).toHaveBeenCalledTimes(1);
    });

    it('a kill that ends nothing: settles killGraceMs after it, with the kill’s reason (4 999 ms pending, 5 000 ms settled)', async () => {
      const r = await start();
      await advance(30000);
      expect(r.kill).toHaveBeenCalledTimes(1);
      await advance(4999);
      expect(r.outcome.state).toBe('pending');
      await advance(1);
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(TIMED_OUT_TEXT);
      expect(r.kill).toHaveBeenCalledTimes(1);
    });

    it('uses killGraceMs when it is given', async () => {
      const r = await start({ killGraceMs: 1234 });
      await advance(30000);
      await advance(1233);
      expect(r.outcome.state).toBe('pending');
      await advance(1);
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(TIMED_OUT_TEXT);
    });

    it('a kill at 30 000 ms, exit at 30 400 ms and no close: settles at 35 000 ms (5 000 ms after the kill, not after the exit)', async () => {
      const r = await start();
      await advance(30000);
      expect(r.kill).toHaveBeenCalledTimes(1);
      await advance(400);
      await exitOnly(r.child, null, 'SIGTERM');
      await advance(4599); // 34 999 ms
      expect(r.outcome.state).toBe('pending');
      await advance(1); // 35 000 ms
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(TIMED_OUT_TEXT);
      expect(r.kill).toHaveBeenCalledTimes(1);
    });

    it('destroys both streams and removes their listeners when the settle timer settles, and ignores a later close', async () => {
      const r = await start();
      await advance(30000);
      await advance(5000);
      expect(r.outcome.state).toBe('rejected');
      expect(r.child.stdout.destroyed).toBe(true);
      expect(r.child.stderr.destroyed).toBe(true);
      expect(r.child.stdout.listenerCount('data')).toBe(0);
      expect(r.child.stderr.listenerCount('data')).toBe(0);
      const first = r.outcome.error;
      r.child.emit('close', null, 'SIGTERM');
      r.child.emit('exit', null, 'SIGTERM');
      await advance(60000);
      expect(r.outcome.error).toBe(first);
      expect(r.kill).toHaveBeenCalledTimes(1);
    });
  });

  describe('exit with no close (R2-B1)', () => {
    it('exit 0 with complete JSON written: pending at 4 999 ms, STOPPED_EARLY at 5 000 ms, no kill, streams destroyed, a later close changes nothing', async () => {
      const r = await start();
      await write(r.child, VIDEO_JSON);
      await exitOnly(r.child, 0);
      await advance(4999);
      expect(r.outcome.state).toBe('pending');
      await advance(1);
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(STOPPED_EARLY_TEXT);
      expect(r.kill).not.toHaveBeenCalled();
      expect(r.child.directKills).toEqual([]);
      expect(r.child.stdout.destroyed).toBe(true);
      expect(r.child.stderr.destroyed).toBe(true);
      expect(r.child.stdout.listenerCount('data')).toBe(0);
      expect(r.child.stderr.listenerCount('data')).toBe(0);
      const error = r.outcome.error;
      await advance(1000); // 6 000 ms
      r.child.emit('close', 0, null);
      await flush();
      expect(r.outcome.state).toBe('rejected');
      expect(r.outcome.error).toBe(error);
      expect(r.kill).not.toHaveBeenCalled();
    });

    it.each([
      ['exit code 0 and valid output', 0, null, VIDEO_JSON, ''],
      ['exit code 1 and an ERROR line of its own', 1, null, '', 'ERROR: [youtube] x: Private video\n'],
      ['an exit by signal', null, 'SIGKILL' as NodeJS.Signals, '', ''],
      ['exit code 2 and output that is not JSON', 2, null, 'not json\n', ''],
    ])('gives STOPPED_EARLY after %s, whatever the exit code and the output', async (_name, code, signal, out, err) => {
      const r = await start();
      if (out) await write(r.child, out);
      if (err) {
        r.child.stderr.write(err);
        await flush();
      }
      await exitOnly(r.child, code, signal);
      await advance(5000);
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(STOPPED_EARLY_TEXT);
      expect(r.kill).not.toHaveBeenCalled();
    });

    it('settles killGraceMs after the exit when killGraceMs is given', async () => {
      const r = await start({ killGraceMs: 700 });
      await exitOnly(r.child, 0);
      await advance(699);
      expect(r.outcome.state).toBe('pending');
      await advance(1);
      expect(r.outcome.state).toBe('rejected');
    });

    it('the settle timer is armed once by exit and is not re-armed by a second exit', async () => {
      const r = await start();
      await exitOnly(r.child, 0);
      await advance(3000);
      r.child.emit('exit', 0, null);
      await advance(1999);
      expect(r.outcome.state).toBe('pending');
      await advance(1); // 5 000 ms after the first exit
      expect(r.outcome.state).toBe('rejected');
    });

    it('an exit at 29 999 ms clears the time limit: no kill at 30 000 ms, and the settle at 34 999 ms is STOPPED_EARLY', async () => {
      const r = await start();
      await advance(29999);
      await exitOnly(r.child, 0);
      await advance(1);
      expect(r.kill).not.toHaveBeenCalled();
      await advance(4998);
      expect(r.outcome.state).toBe('pending'); // 34 998 ms
      await advance(1);
      expect(r.outcome.state).toBe('rejected'); // 34 999 ms
      expect(reasonText(r.outcome.error)).toBe(STOPPED_EARLY_TEXT);
      await advance(120000);
      expect(r.kill).not.toHaveBeenCalled();
    });

    // Plan 3.5 (N6): "The timeout timer and the abort listener are cleared on exit". Nothing but the settle timer is left.
    it('exit clears the time limit and the abort listener: the settle timer is the one timer left pending', async () => {
      const controller = new AbortController();
      const r = await start({ signal: controller.signal });
      await exitOnly(r.child, 0);
      expect(vi.getTimerCount()).toBe(1);
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      await advance(5000);
      expect(r.outcome.state).toBe('rejected');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('an exit at 29 999 ms followed by a close gives the normal result, and no kill is ever sent', async () => {
      const r = await start();
      await write(r.child, VIDEO_JSON);
      await advance(29999);
      await exitOnly(r.child, 0);
      await advance(1);
      r.child.stdout.end();
      r.child.stderr.end();
      r.child.emit('close', 0, null);
      await flush();
      expect(r.outcome.value).toEqual(VIDEO);
      await advance(120000);
      expect(r.kill).not.toHaveBeenCalled();
    });
  });

  describe('the output cap', () => {
    it('reads a result of exactly the cap (1 024 bytes) and kills nothing', async () => {
      const r = await start({ outputCap: 1024 });
      const body = videoOfBytes(1024);
      expect(body).toHaveLength(1024);
      await write(r.child, body);
      expect(r.kill).not.toHaveBeenCalled();
      await finish(r.child, 0);
      expect(r.outcome.state).toBe('resolved');
      expect(r.outcome.value).toMatchObject({ kind: 'media', title: 'Talk', heights: [720] });
      expect(r.kill).not.toHaveBeenCalled();
    });

    it('one byte over (1 025 bytes of valid JSON): one kill, UNREADABLE, and the output is not used', async () => {
      const r = await start({ outputCap: 1024 });
      await write(r.child, videoOfBytes(1025));
      expect(r.kill).toHaveBeenCalledTimes(1);
      expect(r.kill).toHaveBeenCalledWith(r.child);
      await finish(r.child, 0); // the killed process "ends cleanly" with a complete-looking result
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(UNREADABLE_TEXT);
      expect(r.kill).toHaveBeenCalledTimes(1);
    });

    it('calls kill once however much output comes after the cap', async () => {
      const r = await start({ outputCap: 1024 });
      await write(r.child, Buffer.alloc(1025, 120));
      for (let i = 0; i < 5; i += 1) await write(r.child, Buffer.alloc(4096, 120));
      expect(r.kill).toHaveBeenCalledTimes(1);
      await finish(r.child, null, 'SIGTERM');
      expect(reasonText(r.outcome.error)).toBe(UNREADABLE_TEXT);
      expect(r.kill).toHaveBeenCalledTimes(1);
    });

    it('counts bytes, not pieces: 1 024 one-byte pieces are fine and the 1 025th is one over', async () => {
      const r = await start({ outputCap: 1024 });
      const body = videoOfBytes(1024);
      for (const byte of body) r.child.stdout.write(Buffer.from([byte]));
      await flush();
      expect(r.kill).not.toHaveBeenCalled();
      r.child.stdout.write(Buffer.from('x'));
      await flush();
      expect(r.kill).toHaveBeenCalledTimes(1);
    });

    it('counts bytes, not characters: 513 two-byte characters are 1 026 bytes', async () => {
      const r = await start({ outputCap: 1024 });
      await write(r.child, 'é'.repeat(513));
      expect(r.kill).toHaveBeenCalledTimes(1);
      await finish(r.child, null, 'SIGTERM');
      expect(reasonText(r.outcome.error)).toBe(UNREADABLE_TEXT);
    });

    it('reads multi-byte text exactly at the cap, also when a character is split between two pieces', async () => {
      const title = 'é'.repeat(30) + '😀';
      const r = await start({ outputCap: 1024 });
      const body = videoOfBytes(1024, title);
      expect(body).toHaveLength(1024);
      const first = body.indexOf(0xc3) + 1; // between the two bytes of the first é
      const second = body.indexOf(Buffer.from('😀')) + 2; // and inside the emoji's four bytes
      await write(r.child, body.subarray(0, first));
      await write(r.child, body.subarray(first, second));
      await write(r.child, body.subarray(second));
      expect(r.kill).not.toHaveBeenCalled();
      await finish(r.child, 0);
      expect(r.outcome.value).toMatchObject({ kind: 'media', title });
    });

    it('a kill that ends nothing after the cap settles killGraceMs later with UNREADABLE', async () => {
      const r = await start({ outputCap: 1024 });
      await write(r.child, Buffer.alloc(1025, 120));
      await advance(4999);
      expect(r.outcome.state).toBe('pending');
      await advance(1);
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(UNREADABLE_TEXT);
      expect(r.child.stdout.destroyed).toBe(true);
      expect(r.kill).toHaveBeenCalledTimes(1);
    });

    it('the cap is 64 MiB of stdout when none is given: 64 MiB are read, one byte more is one over', async () => {
      const MIB = 1024 * 1024;
      const r = await start();
      const piece = Buffer.alloc(MIB, 120);
      for (let i = 0; i < 64; i += 1) await write(r.child, piece);
      expect(r.kill).not.toHaveBeenCalled();
      await write(r.child, Buffer.from('x'));
      expect(r.kill).toHaveBeenCalledTimes(1);
      expect(r.kill).toHaveBeenCalledWith(r.child);
    });
  });

  describe('abort', () => {
    it('kills once with the child, and settles when the process closes', async () => {
      const controller = new AbortController();
      const r = await start({ signal: controller.signal });
      expect(r.kill).not.toHaveBeenCalled();
      controller.abort();
      await flush();
      expect(r.kill).toHaveBeenCalledTimes(1);
      expect(r.kill).toHaveBeenCalledWith(r.child);
      await finish(r.child, null, 'SIGTERM');
      expect(r.outcome.state).toBe('rejected');
      expect(r.outcome.error).toBeInstanceOf(Error);
      expect(r.child.directKills).toEqual([]);
    });

    it('a kill that ends nothing: settles killGraceMs later (4 999 ms pending, 5 000 ms settled), with no second kill', async () => {
      const controller = new AbortController();
      const r = await start({ signal: controller.signal });
      controller.abort();
      await flush();
      await advance(4999);
      expect(r.outcome.state).toBe('pending');
      await advance(1);
      expect(r.outcome.state).toBe('rejected');
      await advance(120000);
      expect(r.kill).toHaveBeenCalledTimes(1);
    });

    it('a signal that was aborted before the call: the run settles and kills at most the one process it started', async () => {
      const controller = new AbortController();
      controller.abort();
      const r = await start({ signal: controller.signal });
      if (r.spawn.mock.calls.length > 0) {
        expect(r.kill).toHaveBeenCalledTimes(1);
        await finish(r.child, null, 'SIGTERM');
      }
      await advance(5000);
      expect(r.outcome.state).toBe('rejected');
      expect(r.kill.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('after exit: no kill, and the result is still the normal one', async () => {
      const controller = new AbortController();
      const r = await start({ signal: controller.signal });
      await write(r.child, VIDEO_JSON);
      await advance(100);
      await exitOnly(r.child, 0);
      await advance(100);
      controller.abort();
      await flush();
      expect(r.kill).not.toHaveBeenCalled();
      r.child.stdout.end();
      r.child.stderr.end();
      r.child.emit('close', 0, null);
      await flush();
      expect(r.outcome.state).toBe('resolved');
      expect(r.outcome.value).toEqual(VIDEO);
    });

    it('after close: no kill', async () => {
      const controller = new AbortController();
      const r = await start({ signal: controller.signal });
      await write(r.child, VIDEO_JSON);
      await finish(r.child, 0);
      controller.abort();
      await flush();
      expect(r.kill).not.toHaveBeenCalled();
      expect(r.outcome.state).toBe('resolved');
    });

    it('after the settle timer settled: no kill', async () => {
      const controller = new AbortController();
      const r = await start({ signal: controller.signal });
      await exitOnly(r.child, 0);
      await advance(5000);
      expect(r.outcome.state).toBe('rejected');
      controller.abort();
      await flush();
      expect(r.kill).not.toHaveBeenCalled();
    });

    it('aborting ends the request of probeFile too: the fetch gets the signal, and it is aborted', async () => {
      const controller = new AbortController();
      let seen: AbortSignal | null | undefined;
      const hangingFetch = (async (_input: unknown, init?: RequestInit) => {
        seen = init?.signal;
        await new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }) as unknown as typeof fetch;
      const r = await start({ signal: controller.signal }, { fetchImpl: hangingFetch });
      r.child.stderr.write('ERROR: Unsupported URL: https://example.com/file.zip\n');
      await flush();
      await finish(r.child, 1);
      expect(seen).toBeTruthy();
      expect(seen?.aborted).toBe(false);
      expect(r.outcome.state).toBe('pending');
      controller.abort();
      await flush();
      expect(seen?.aborted).toBe(true);
      await flush();
      expect(r.outcome.state).toBe('rejected');
    });
  });

  describe('the error event', () => {
    const enoent = (): Error => Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' });

    it('ENOENT with no close: settles at once with "yt-dlp is not installed"', async () => {
      const r = await start();
      r.child.emit('error', enoent());
      await flush();
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(NOT_INSTALLED_TEXT);
    });

    it.each([
      ['EACCES', 'EACCES'],
      ['EPERM', 'EPERM'],
      ['no code', undefined],
    ])('any other error (%s) with no close: settles at once with STOPPED_EARLY', async (_name, code) => {
      const r = await start();
      r.child.emit('error', Object.assign(new Error('spawn failed'), code === undefined ? {} : { code }));
      await flush();
      expect(r.outcome.state).toBe('rejected');
      expect(reasonText(r.outcome.error)).toBe(STOPPED_EARLY_TEXT);
    });

    it('ignores a close that comes after it', async () => {
      const r = await start();
      r.child.emit('error', enoent());
      await flush();
      const error = r.outcome.error;
      r.child.emit('close', null, null);
      await advance(60000);
      expect(r.outcome.error).toBe(error);
    });
  });
});

describe('probeFile headers (A3)', () => {
  const seen: { headers: Headers }[] = [];
  const recordingFetch = (async (_input: unknown, init?: RequestInit) => {
    seen.push({ headers: new Headers(init?.headers) });
    return new Response(null, { status: 206, headers: { 'content-range': 'bytes 0-0/10' } });
  }) as unknown as typeof fetch;

  beforeEach(() => {
    seen.length = 0;
  });

  it('sends Referer and User-Agent with the Range request when both are given', async () => {
    process.env['FAKE_YTDLP'] = 'probe-unsupported';
    await probeUrl(URL, FAKE, recordingFetch, undefined, { headers: { referer: REFERER, userAgent: UA } } as ProbeOpts);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.get('referer')).toBe(REFERER);
    expect(seen[0]?.headers.get('user-agent')).toBe(UA);
    expect(seen[0]?.headers.get('range')).toBe('bytes=0-0');
  });

  it('sends neither when both are null, and when the headers are left out', async () => {
    process.env['FAKE_YTDLP'] = 'probe-unsupported';
    await probeUrl(URL, FAKE, recordingFetch, undefined, { headers: { referer: null, userAgent: null } } as ProbeOpts);
    await probeUrl(URL, FAKE, recordingFetch);
    await probeUrl(URL, FAKE, recordingFetch, undefined, {} as ProbeOpts);
    expect(seen).toHaveLength(3);
    for (const s of seen) {
      expect(s.headers.has('referer')).toBe(false);
      expect(s.headers.has('user-agent')).toBe(false);
      expect(s.headers.get('range')).toBe('bytes=0-0');
    }
  });

  it('sends only the one that is set', async () => {
    process.env['FAKE_YTDLP'] = 'probe-unsupported';
    await probeUrl(URL, FAKE, recordingFetch, undefined, { headers: { referer: REFERER, userAgent: null } } as ProbeOpts);
    await probeUrl(URL, FAKE, recordingFetch, undefined, { headers: { referer: null, userAgent: UA } } as ProbeOpts);
    expect(seen[0]?.headers.get('referer')).toBe(REFERER);
    expect(seen[0]?.headers.has('user-agent')).toBe(false);
    expect(seen[1]?.headers.has('referer')).toBe(false);
    expect(seen[1]?.headers.get('user-agent')).toBe(UA);
  });
});

describe('probeUrl on a real process (A3)', () => {
  let dir: string;
  const leftovers: number[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fetchly-probe-'));
  });
  afterEach(() => {
    for (const pid of leftovers.splice(0)) {
      try {
        process.kill(pid);
      } catch {
        // already gone
      }
    }
    delete process.env['FAKE_YTDLP_PIDFILE'];
    delete process.env['FAKE_YTDLP_ARGS'];
  });

  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  /** The pids the fake wrote once its child ran. */
  async function pidsOf(file: string): Promise<{ self: number; child: number }> {
    const found = await waitFor(() => {
      if (!existsSync(file)) return null;
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as { self: number; child: number };
      } catch {
        return null; // half written
      }
    }, 15000);
    leftovers.push(found.self, found.child);
    return found;
  }

  it('hands the headers to the real tool as arguments, the hostile User-Agent byte for byte, and the result is read', async () => {
    const log = join(dir, 'args.log');
    process.env['FAKE_YTDLP_ARGS'] = log;
    const result = await probe('probe-video', neverFetch, undefined, { headers: { referer: REFERER, userAgent: PA3_6_UA } } as ProbeOpts);
    expect(result).toMatchObject({ kind: 'media', title: 'Talk' });
    const lines = readFileSync(log, 'utf8').split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(1);
    const args = JSON.parse(lines[0] ?? '[]') as string[];
    expect(without(args, ['--add-headers', `Referer:${REFERER}`, '--add-headers', `User-Agent:${PA3_6_UA}`])).toEqual([
      '-J',
      '--flat-playlist',
      '--no-warnings',
      '--',
      URL,
    ]);
    expect(args.filter((a) => a === `User-Agent:${PA3_6_UA}`)).toHaveLength(1);
  });

  it('sends no header argument when it has no header, to the real tool too', async () => {
    const log = join(dir, 'args.log');
    process.env['FAKE_YTDLP_ARGS'] = log;
    await probe('probe-video');
    const args = JSON.parse(readFileSync(log, 'utf8').split('\n')[0] ?? '[]') as string[];
    expect(args).toEqual(['-J', '--flat-playlist', '--no-warnings', '--', URL]);
  });

  it('a timed-out probe ends the whole tree: the child that holds stdout is gone when it settles', async () => {
    const pidFile = join(dir, 'pids.json');
    process.env['FAKE_YTDLP_PIDFILE'] = pidFile;
    const reason = await reasonOf(probe('probe-tree-hang', neverFetch, 3000));
    expect(reason).toBe(TIMED_OUT_TEXT);
    const pids = await pidsOf(pidFile);
    await waitFor(() => !alive(pids.child), 2000);
    expect(alive(pids.self)).toBe(false);
    expect(alive(pids.child)).toBe(false);
  }, 30000);

  it('an abort ends the whole tree by one kill', async () => {
    const pidFile = join(dir, 'pids.json');
    process.env['FAKE_YTDLP_PIDFILE'] = pidFile;
    process.env['FAKE_YTDLP'] = 'probe-tree-hang';
    const { killTree } = await import('../src/main/killTree');
    const kill = vi.fn((child: ChildProcess) => killTree(child));
    const controller = new AbortController();
    const settled = track(probeUrl(URL, FAKE, neverFetch, 30000, { signal: controller.signal, kill } as ProbeOpts));
    const pids = await pidsOf(pidFile);
    controller.abort();
    await waitFor(() => settled.state !== 'pending', 15000);
    expect(settled.state).toBe('rejected');
    await waitFor(() => !alive(pids.child), 2000);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(alive(pids.self)).toBe(false);
  }, 40000);

  it('stdout without end: one kill at the cap, UNREADABLE, and the process is gone', async () => {
    const { killTree } = await import('../src/main/killTree');
    const kill = vi.fn((child: ChildProcess) => killTree(child));
    process.env['FAKE_YTDLP'] = 'probe-flood';
    const reason = await reasonOf(probeUrl(URL, FAKE, neverFetch, 30000, { outputCap: 4096, kill } as ProbeOpts));
    expect(reason).toBe(UNREADABLE_TEXT);
    expect(kill).toHaveBeenCalledTimes(1);
  }, 30000);

  // Freeze note N3: this spec has a lower bound only. A red run on a loaded machine is re-run alone.
  it('a process that exits while its child holds stdout: settles with STOPPED_EARLY, not before killGraceMs, and kills nothing', async () => {
    const pidFile = join(dir, 'pids.json');
    process.env['FAKE_YTDLP_PIDFILE'] = pidFile;
    process.env['FAKE_YTDLP'] = 'probe-orphan';
    const kill = vi.fn();
    const t0 = performance.now();
    const reason = await reasonOf(probeUrl(URL, FAKE, neverFetch, 30000, { killGraceMs: 300, kill } as ProbeOpts));
    const elapsed = performance.now() - t0;
    const pids = await pidsOf(pidFile);
    expect(reason).toBe(STOPPED_EARLY_TEXT);
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(kill).not.toHaveBeenCalled();
    // The probe did not end the leftover child: it is left to killStrays. The spec ends it here (afterEach).
    expect(alive(pids.child)).toBe(true);
  }, 30000);
});

// ---------------------------------------------------------------------------------------------------------------------
// A3a review, N1: what the probe keeps of yt-dlp's stderr. Before A3a the whole of it (up to the 64 MiB buffer) went to
// the classifier, so `ERROR: Unsupported URL: ...` was found however much diagnostic text came after it. The decision:
// the last line that starts with `ERROR:` is kept apart from the tail, at most 4096 bytes of it, and the tail is the
// last 65 536 BYTES (not UTF-16 units), cut on a character boundary. The classifier sees the same evidence as before.
// The text the classifier receives is observable only through a spy on `classifyError`; the rest goes through the
// result of the probe.
// ---------------------------------------------------------------------------------------------------------------------
describe('the probe keeps the error line and a bounded tail of stderr (N1)', () => {
  const FILE = { kind: 'file', fileName: 'report.pdf', size: 1000, resumable: true };
  const TAIL_BYTES = 65_536;
  const LINE_BYTES = 4_096;
  const bytesOf = (text: string): number => Buffer.byteLength(text, 'utf8');
  const fileFetch = (seen: Seen[] = []): typeof fetch => stubFetch(206, { 'content-range': 'bytes 0-0/1000' }, seen);

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** At least `bytes` bytes of ordinary diagnostic lines: no line starts with ERROR: and no word a rule looks for. */
  function diagnostics(bytes: number, eol = '\n'): string {
    const parts: string[] = [];
    let size = 0;
    for (let n = 0; size < bytes; n += 1) {
      const line = `[debug] diagnostic line ${n}: nothing a rule looks for${eol}`;
      parts.push(line);
      size += line.length; // ASCII
    }
    return parts.join('');
  }
  /** At least `bytes` bytes of lines made of `unit` repeated 8 times. */
  function unitLines(unit: string, bytes: number): string {
    const line = `${unit.repeat(8)}\n`;
    return line.repeat(Math.ceil(bytes / bytesOf(line)));
  }
  /** The process writes `text` to stderr in pieces of `chunkBytes` bytes (a piece may end inside a character). */
  async function feed(child: FakeChild, text: string, chunkBytes = 16 * 1024): Promise<void> {
    const bytes = Buffer.from(text, 'utf8');
    for (let at = 0; at < bytes.length; at += chunkBytes) {
      child.stderr.write(bytes.subarray(at, at + chunkBytes));
      await flush();
    }
  }
  /** One probe whose process writes `stderr`, exits with code 1 and closes. */
  async function failWith(stderr: string, over: { chunkBytes?: number; fetchImpl?: typeof fetch } = {}): Promise<Outcome<ProbeResult>> {
    const r = await start({}, over.fetchImpl === undefined ? {} : { fetchImpl: over.fetchImpl });
    await feed(r.child, stderr, over.chunkBytes);
    await finish(r.child, 1);
    await flush();
    return r.outcome;
  }

  describe('an error line followed by more diagnostic text than the tail holds', () => {
    const UNSUPPORTED = `ERROR: Unsupported URL: ${URL}`;

    it.each<[string, () => string]>([
      ['nothing', () => ''],
      ['a short diagnostic (control)', () => diagnostics(1_000)],
      ['at least 65 536 bytes of diagnostic', () => diagnostics(TAIL_BYTES)],
      ['at least 65 537 bytes of diagnostic', () => diagnostics(TAIL_BYTES + 1)],
      ['70 000 bytes of diagnostic', () => diagnostics(70_000)],
      ['one megabyte of diagnostic', () => diagnostics(1_000_000)],
      ['CRLF lines', () => diagnostics(100_000, '\r\n')],
      ['one long line without an end', () => `[debug] ${'x'.repeat(100_000)}`],
      ['multibyte lines (300 000 bytes, over 65 536 UTF-16 units)', () => unitLines('日', 300_000)],
    ])('Unsupported URL followed by %s: the same result as with no tail, the plain-file probe', async (_name, tail) => {
      const seen: Seen[] = [];
      const outcome = await failWith(`${UNSUPPORTED}\n${tail()}`, { fetchImpl: fileFetch(seen) });
      expect(outcome.state, reasonText(outcome.error)).toBe('resolved');
      expect(outcome.value).toEqual(FILE);
      expect(seen).toEqual([{ url: URL, range: 'bytes=0-0' }]);
    });

    it('the error line arrives in tiny pieces, split inside words and inside a multibyte character, then a large diagnostic', async () => {
      const line = 'ERROR: [generic] 日本語のエラー: boom\n';
      const r = await start();
      await feed(r.child, line, 5);
      await feed(r.child, diagnostics(100_000));
      await finish(r.child, 1);
      await flush();
      expect(reasonText(r.outcome.error)).toBe('[generic] 日本語のエラー: boom');
    });

    it('the last ERROR line decides, not an earlier one', async () => {
      const outcome = await failWith(`ERROR: first problem\nERROR: second problem\n${diagnostics(100_000)}`);
      expect(reasonText(outcome.error)).toBe('second problem');
    });

    it('an ERROR line that ends the output without a newline is still the one reported', async () => {
      const outcome = await failWith(`${diagnostics(100_000)}ERROR: [generic] x: boom`);
      expect(reasonText(outcome.error)).toBe('[generic] x: boom');
    });

    it('stderr with no ERROR line at all is still "stopped", however long it is', async () => {
      const outcome = await failWith(diagnostics(100_000));
      expect(reasonText(outcome.error)).toBe(STOPPED_EARLY_TEXT);
    });
  });

  describe('an ERROR line longer than 4096 bytes still classifies by its prefix', () => {
    const LONG = 'x'.repeat(199);
    it.each<[string, string, string]>([
      ['4 095 bytes', `ERROR: ${'x'.repeat(LINE_BYTES - 1 - 7)}`, `${LONG}…`],
      ['4 096 bytes', `ERROR: ${'x'.repeat(LINE_BYTES - 7)}`, `${LONG}…`],
      ['4 097 bytes', `ERROR: ${'x'.repeat(LINE_BYTES + 1 - 7)}`, `${LONG}…`],
      ['100 000 bytes', `ERROR: ${'x'.repeat(100_000)}`, `${LONG}…`],
      ['210 000 bytes of multibyte text (70 000 UTF-16 units)', `ERROR: ${'日'.repeat(70_000)}`, `${'日'.repeat(199)}…`],
    ])('a line of %s, with and without a newline after it: the start of its text is the reason', async (_name, errorLine, reason) => {
      for (const end of ['', '\n']) {
        const outcome = await failWith(`${errorLine}${end}`);
        expect(reasonText(outcome.error)).toBe(reason);
        expect(reasonText(outcome.error)).not.toContain('�');
      }
    });

    it('a line of 100 000 bytes followed by a large diagnostic: the same reason', async () => {
      const outcome = await failWith(`ERROR: ${'x'.repeat(100_000)}\n${diagnostics(100_000)}`);
      expect(reasonText(outcome.error)).toBe(`${'x'.repeat(199)}…`);
    });

    it('a line of 100 000 bytes that names an unsupported link in its first words: the plain-file probe', async () => {
      const seen: Seen[] = [];
      const outcome = await failWith(`ERROR: Unsupported URL: ${URL} ${'a'.repeat(100_000)}\n`, { fetchImpl: fileFetch(seen) });
      expect(outcome.state, reasonText(outcome.error)).toBe('resolved');
      expect(outcome.value).toEqual(FILE);
      expect(seen).toHaveLength(1);
    });

    it('an earlier long ERROR line does not hide the last short one', async () => {
      const outcome = await failWith(`ERROR: ${'x'.repeat(100_000)}\nERROR: second problem`);
      expect(reasonText(outcome.error)).toBe('second problem');
    });
  });

  // A rule word that sits further from the end than the tail holds is not seen; one inside the tail is. With 3-byte
  // characters 65 536 UTF-16 units are 196 608 bytes, so a tail counted in units would still hold the first marker.
  describe('the tail is counted in bytes, not in UTF-16 units', () => {
    const marker = (): string => 'WARNING: this stream uses DRM\n';

    it('a marker 100 000 bytes before the end of multibyte text is outside the tail: it classifies nothing', async () => {
      const outcome = await failWith(`${marker()}${unitLines('日', 100_000)}ERROR: boom\n`, { chunkBytes: 7_001 });
      expect(reasonText(outcome.error)).toBe('boom');
    });

    it('a marker 60 000 bytes before the end of multibyte text is inside the tail: the rule finds it (control)', async () => {
      const outcome = await failWith(`${marker()}${unitLines('日', 60_000)}ERROR: boom\n`, { chunkBytes: 7_001 });
      expect(reasonText(outcome.error)).toBe('protected');
    });

    it('a marker 60 000 bytes before the end of ASCII text is inside the tail: the rule finds it (control)', async () => {
      const outcome = await failWith(`${marker()}${diagnostics(60_000)}ERROR: boom\n`);
      expect(reasonText(outcome.error)).toBe('protected');
    });

    it('a marker 100 000 bytes before the end of ASCII text is outside the tail', async () => {
      const outcome = await failWith(`${marker()}${diagnostics(100_000)}ERROR: boom\n`);
      expect(reasonText(outcome.error)).toBe('boom');
    });
  });

  // What the classifier is handed: at most 65 536 bytes of tail plus the last ERROR line (4096 bytes), whole characters only.
  describe('the text handed to the classifier', () => {
    /** The bytes of the diagnostic lines in `text` (every line but the ERROR line), each with its newline. */
    const fillerBytes = (text: string): number =>
      text
        .split('\n')
        .filter((l) => l !== '' && !l.startsWith('ERROR:'))
        .reduce((sum, l) => sum + bytesOf(l) + 1, 0);

    it.each<[string, string]>([
      ['3-byte characters (the cut falls inside one)', '日'],
      ['2-byte characters', 'é'],
      ['4-byte characters, two UTF-16 units each', '😀'],
      ['an ASCII letter and a 4-byte character (5 bytes, the cut falls inside one)', 'a😀'],
    ])('%s: at most 65 536 bytes of them, almost all 65 536, no broken character', async (_name, unit) => {
      const parse = await import('../src/main/ytdlp/parse');
      const spy = vi.spyOn(parse, 'classifyError');
      await failWith(`${unitLines(unit, 3 * TAIL_BYTES)}ERROR: boom\n`, { chunkBytes: 7_001 });
      expect(spy).toHaveBeenCalledTimes(1);
      const text = spy.mock.calls[0]?.[0] ?? '';
      expect(text).not.toContain('�');
      expect(/\p{Surrogate}/u.test(text), 'no half of a surrogate pair').toBe(false);
      const kept = fillerBytes(text);
      expect(kept).toBeLessThanOrEqual(TAIL_BYTES);
      // Only whole characters are dropped at the cut (and, at most, the first partial line): not a smaller tail.
      expect(kept).toBeGreaterThanOrEqual(TAIL_BYTES - 128);
      expect(text).toContain('ERROR: boom');
    });

    it('a one-megabyte ERROR line: the classifier gets the line from its prefix, in at most 65 536 + 4 096 bytes (plus a separator)', async () => {
      const parse = await import('../src/main/ytdlp/parse');
      const spy = vi.spyOn(parse, 'classifyError');
      const outcome = await failWith(`ERROR: Unsupported URL: ${'x'.repeat(1_000_000)}\n`, { fetchImpl: fileFetch() });
      expect(outcome.value).toEqual(FILE);
      expect(spy).toHaveBeenCalledTimes(1);
      const text = spy.mock.calls[0]?.[0] ?? '';
      expect(/^ERROR:/mu.test(text)).toBe(true);
      expect(bytesOf(text)).toBeLessThanOrEqual(TAIL_BYTES + LINE_BYTES + 16);
    });

    it('a multibyte ERROR line longer than 4096 bytes is cut on a character boundary, from its start', async () => {
      const parse = await import('../src/main/ytdlp/parse');
      const spy = vi.spyOn(parse, 'classifyError');
      // 8 bytes before the first 3-byte character: 4096 bytes end two bytes into a character.
      await failWith(`ERROR: x${'日'.repeat(50_000)}\n${diagnostics(100_000)}`, { chunkBytes: 7_001 });
      expect(spy).toHaveBeenCalledTimes(1);
      const text = spy.mock.calls[0]?.[0] ?? '';
      expect(text).not.toContain('�');
      expect(/\p{Surrogate}/u.test(text)).toBe(false);
      expect(/^ERROR: x日/mu.test(text)).toBe(true);
    });
  });
});
