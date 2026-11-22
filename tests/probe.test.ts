import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Exe } from '../src/main/engines/media';
import { InvalidUrl, ProbeError, probeUrl, validateUrl } from '../src/main/probe';

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

function probe(scenario: string, fetchImpl: typeof fetch = neverFetch, timeoutMs?: number) {
  process.env['FAKE_YTDLP'] = scenario;
  return probeUrl(URL, FAKE, fetchImpl, timeoutMs);
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

  it('reports unreadable yt-dlp output', async () => {
    expect(await reasonOf(probe('probe-garbage'))).toBe('could not read the video information');
  });

  it('gives up on a probe that hangs', async () => {
    expect(await reasonOf(probe('probe-hang', neverFetch, 300))).toBe('timed out reading the link');
  });

  it('says so when yt-dlp is not installed', async () => {
    const p = probeUrl(URL, { command: resolve('tests/fakes/missing.exe'), prefixArgs: [] }, neverFetch);
    expect(await reasonOf(p)).toBe('yt-dlp is not installed');
  });
});
