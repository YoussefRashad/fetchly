import { describe, expect, it } from 'vitest';
import type { ProbeHeaders } from '../../src/main/probe';
import { downloadArgs, FILE_PREFIX, headerArgs, heightProbeArgs, probeArgs, PROGRESS_PREFIX } from '../../src/main/ytdlp/args';
import { reduceReferer } from '../../src/shared/protocol';
import type { Quality } from '../../src/shared/types';

const URL = 'https://example.com/watch?v=1';

function build(quality: Quality, over: Partial<Parameters<typeof downloadArgs>[0]> = {}): string[] {
  return downloadArgs({
    url: URL,
    quality,
    preferMp4Max1080: false,
    subtitleLangs: [],
    dir: 'D:\\Dl',
    baseName: '03 - Intro',
    ffmpegPath: 'C:\\bin\\ffmpeg.exe',
    rateLimitBytes: null,
    sourceHeight: null,
    headers: null,
    ...over,
  });
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

// `<=?` also keeps a format whose height is unknown; a known height stays capped.
const AVC_1080 = 'bv*[height<=?1080][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=?1080]+ba/b[height<=?1080]';

describe('probeArgs', () => {
  it('asks for flat JSON, url after --', () => {
    expect(probeArgs(URL, null)).toEqual(['-J', '--flat-playlist', '--no-warnings', '--', URL]);
  });
});

describe('heightProbeArgs', () => {
  it('asks for the full JSON of one video, url after --', () => {
    expect(heightProbeArgs(URL, null)).toEqual(['-J', '--no-playlist', '--no-warnings', '--', URL]);
  });
});

describe('downloadArgs format', () => {
  it('prefers H.264 in mp4 up to 1080p', () => {
    const args = build({ kind: 'max', height: 1080 });
    expect(valueOf(args, '-f')).toBe(AVC_1080);
    expect(valueOf(args, '--merge-output-format')).toBe('mp4');
    expect(args).not.toContain('--remux-video');
  });

  it('uses the chosen ceiling below 1080p', () => {
    const args = build({ kind: 'max', height: 480 });
    expect(valueOf(args, '-f')).toBe('bv*[height<=?480][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=?480]+ba/b[height<=?480]');
    expect(valueOf(args, '--merge-output-format')).toBe('mp4');
  });

  it('keeps the original codec in mkv above 1080p', () => {
    const args = build({ kind: 'max', height: 2160 });
    expect(valueOf(args, '-f')).toBe('bv*[height<=?2160]+ba/b[height<=?2160]');
    expect(valueOf(args, '--merge-output-format')).toBe('mkv');
  });

  it('caps a 4K request at 1080p mp4 when mp4 is preferred', () => {
    const args = build({ kind: 'max', height: 2160 }, { preferMp4Max1080: true });
    expect(valueOf(args, '-f')).toBe(AVC_1080);
    expect(valueOf(args, '--merge-output-format')).toBe('mp4');
    expect(valueOf(args, '--remux-video')).toBe('mp4');
  });

  it('Best with an unknown height keeps the mkv path', () => {
    const args = build({ kind: 'best' });
    expect(valueOf(args, '-f')).toBe('bv*+ba/b');
    expect(valueOf(args, '--merge-output-format')).toBe('mkv');
    expect(args).not.toContain('--remux-video');
  });

  it.each([1080, 720])('Best takes the H.264 mp4 path when the source is %ip', (sourceHeight) => {
    const args = build({ kind: 'best' }, { sourceHeight });
    expect(valueOf(args, '-f')).toBe(AVC_1080);
    expect(valueOf(args, '--merge-output-format')).toBe('mp4');
  });

  it('Best keeps the codec in mkv above 1080p', () => {
    const args = build({ kind: 'best' }, { sourceHeight: 2160 });
    expect(valueOf(args, '-f')).toBe('bv*+ba/b');
    expect(valueOf(args, '--merge-output-format')).toBe('mkv');
  });

  it('caps Best at 1080p mp4 when mp4 is preferred', () => {
    const args = build({ kind: 'best' }, { preferMp4Max1080: true });
    expect(valueOf(args, '-f')).toBe(AVC_1080);
    expect(valueOf(args, '--merge-output-format')).toBe('mp4');
    expect(valueOf(args, '--remux-video')).toBe('mp4');
  });

  // F3: a source that does not state its height (a page's <video><source>) must still match.
  it.each<[string, Quality, boolean, number | null]>([
    ['always mp4', { kind: 'best' }, true, null],
    ['always mp4 with Up to 720p', { kind: 'max', height: 720 }, true, null],
    ['Up to 480p', { kind: 'max', height: 480 }, false, null],
    ['Up to 2160p', { kind: 'max', height: 2160 }, false, null],
    ['Best with a known source height', { kind: 'best' }, false, 720],
  ])('%s: every height filter also keeps formats of unknown height', (_label, quality, preferMp4Max1080, sourceHeight) => {
    const format = valueOf(build(quality, { preferMp4Max1080, sourceHeight }), '-f') ?? '';
    const filters = format.match(/\[height[^\]]*\]/gu) ?? [];
    expect(filters.length).toBeGreaterThan(0);
    for (const f of filters) expect(f).toMatch(/^\[height<=\?\d+\]$/u);
  });

  it.each(['m4a', 'mp3'] as const)('extracts audio as %s without a merge format', (format) => {
    const args = build({ kind: 'audio', format });
    expect(valueOf(args, '-f')).toBe('ba/b');
    expect(args).toContain('-x');
    expect(valueOf(args, '--audio-format')).toBe(format);
    expect(args).not.toContain('--merge-output-format');
    expect(args).not.toContain('--remux-video');
  });

  it('never remuxes audio, even when mp4 is preferred', () => {
    expect(build({ kind: 'audio', format: 'mp3' }, { preferMp4Max1080: true })).not.toContain('--remux-video');
  });
});

describe('downloadArgs options', () => {
  const args = build({ kind: 'best' });

  it('always downloads one item, resumably, without overwriting', () => {
    for (const flag of ['--no-playlist', '--newline', '--progress', '--no-warnings', '--continue', '--no-overwrites']) {
      expect(args).toContain(flag);
    }
    expect(valueOf(args, '--retries')).toBe('3');
  });

  it('writes into the folder under the given base name', () => {
    expect(valueOf(args, '-P')).toBe('D:\\Dl');
    expect(valueOf(args, '-o')).toBe('03 - Intro.%(ext)s');
    expect(valueOf(args, '--ffmpeg-location')).toBe('C:\\bin\\ffmpeg.exe');
  });

  it('escapes percent signs of the title in the output template', () => {
    expect(valueOf(build({ kind: 'best' }, { baseName: '100% real' }), '-o')).toBe('100%% real.%(ext)s');
  });

  it('asks for machine-readable progress and the final path', () => {
    expect(valueOf(args, '--progress-template')).toBe(
      `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s`,
    );
    expect(valueOf(args, '--print')).toBe(`after_move:${FILE_PREFIX} %(height)s %(filepath)s`);
  });

  it('puts the url last, after a -- separator', () => {
    expect(args.slice(-2)).toEqual(['--', URL]);
  });

  it('adds subtitles only when languages are given', () => {
    expect(args).not.toContain('--write-subs');
    const withSubs = build({ kind: 'best' }, { subtitleLangs: ['ar', 'en'] });
    expect(withSubs).toContain('--write-subs');
    expect(valueOf(withSubs, '--sub-langs')).toBe('ar,en');
  });

  it('adds a rate limit only when one is given', () => {
    expect(args).not.toContain('--limit-rate');
    expect(valueOf(build({ kind: 'best' }, { rateLimitBytes: 500000 }), '--limit-rate')).toBe('500000');
  });
});

// A3 Task T2 (plan 3.3): the header arguments, and `--` before the link, in every builder that carries a header.
// Superseded by this contract, left as they were: `probeArgs asks for flat JSON` above (it expects no `--`).
describe('header arguments (A3)', () => {
  const REFERER = 'https://a.example/p/q';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  /** PA3-6: every character the shell or the tools could treat as special, accepted and passed byte for byte. */
  const PA3_6 = 'Mozilla/5.0 "q" \\ %PATH% ^ & | < > ` $(x) ; --output=evil -o x';
  const FOUR = ['--add-headers', `Referer:${REFERER}`, '--add-headers', `User-Agent:${UA}`];
  const BOTH: ProbeHeaders = { referer: REFERER, userAgent: UA };
  const NONE: ProbeHeaders = { referer: null, userAgent: null };

  /** headerArgs on a value the type would not allow (a stored list is checked, but the function does not trust it). */
  const hdr = (h: unknown): string[] => headerArgs(h as ProbeHeaders | null);
  const withReferer = (referer: unknown): string[] => hdr({ referer, userAgent: null });
  const withUa = (userAgent: unknown): string[] => hdr({ referer: null, userAgent });

  /** Where `run` starts in `args` as a contiguous run, or -1. */
  function runAt(args: string[], run: string[]): number {
    for (let i = 0; i + run.length <= args.length; i += 1) if (run.every((v, k) => args[i + k] === v)) return i;
    return -1;
  }
  /** `args` without the contiguous `run`; `args` itself when it holds none. */
  function without(args: string[], run: string[]): string[] {
    const at = runAt(args, run);
    return at === -1 ? args : [...args.slice(0, at), ...args.slice(at + run.length)];
  }

  // Every builder that carries a header onto a yt-dlp command line (the aria2 start has its own spec, file.test.ts).
  const BUILDERS: [string, (headers: ProbeHeaders | null, url?: string) => string[]][] = [
    ['probeArgs', (headers, url = URL) => probeArgs(url, headers)],
    ['heightProbeArgs', (headers, url = URL) => heightProbeArgs(url, headers)],
    ['downloadArgs', (headers, url = URL) => build({ kind: 'best' }, { headers, url })],
  ];

  describe('headerArgs', () => {
    it('gives nothing for null and for two null values', () => {
      expect(hdr(null)).toEqual([]);
      expect(hdr(NONE)).toEqual([]);
    });

    it('gives --add-headers Referer:<r>, then --add-headers User-Agent:<ua>, in that order, as four elements', () => {
      expect(hdr(BOTH)).toEqual(FOUR);
    });

    it('gives two elements for one header and none for the other', () => {
      expect(withReferer(REFERER)).toEqual(['--add-headers', `Referer:${REFERER}`]);
      expect(withUa(UA)).toEqual(['--add-headers', `User-Agent:${UA}`]);
    });

    it('does not change the headers it is given and answers the same every time', () => {
      const given: ProbeHeaders = { referer: REFERER, userAgent: UA };
      const first = hdr(given);
      expect(hdr(given)).toEqual(first);
      expect(given).toEqual({ referer: REFERER, userAgent: UA });
    });

    it("passes PA3-6's User-Agent as exactly one element, byte for byte, and never as an option", () => {
      const args = withUa(PA3_6);
      expect(args).toEqual(['--add-headers', `User-Agent:${PA3_6}`]);
      expect(args.filter((a) => a.includes(PA3_6))).toHaveLength(1);
      for (const a of args) expect(a === '--output=evil' || a.startsWith('--output') || a === '-o').toBe(false);
    });

    it('accepts a User-Agent of 1 and of 512 characters and refuses 513', () => {
      expect(withUa('a')).toHaveLength(2);
      expect(withUa('a'.repeat(512))).toEqual(['--add-headers', `User-Agent:${'a'.repeat(512)}`]);
      expect(withUa('a'.repeat(513))).toEqual([]);
    });

    it('accepts a Referer of 2048 units and refuses 2049', () => {
      const referer = (units: number): string => `https://a.example/${'a'.repeat(units - 'https://a.example/'.length)}`;
      expect(withReferer(referer(2048))).toEqual(['--add-headers', `Referer:${referer(2048)}`]);
      expect(withReferer(referer(2049))).toEqual([]);
    });

    it("sends PA3-6b's path (as its own reduction) and a Referer that is already %22", () => {
      const reduced = reduceReferer("https://a.example/a|b[c]'d^e/f%41g");
      expect(reduced).not.toBeNull();
      expect(withReferer(reduced)).toEqual(['--add-headers', `Referer:${reduced}`]);
      expect(withReferer('https://a.example/p%22q')).toEqual(['--add-headers', 'Referer:https://a.example/p%22q']);
    });

    // The value is rejected: the argv has the length it has with no header, and no element holds the value.
    it.each([
      ['CR', 'https://a.example/p\rq'],
      ['LF', 'https://a.example/p\nq'],
      ['CR LF and a second header', 'https://a.example/p\r\nX-Evil: 1'],
      ['NUL', 'https://a.example/p\u0000q'],
      ['a tab', 'https://a.example/p\tq'],
      ['a query', 'https://a.example/p?token=1'],
      ['a fragment', 'https://a.example/p#frag'],
      ['a double quote', 'https://a.example/p"q'],
      ['a double quote and nothing else', '"'],
      ['userinfo', 'https://user:secret@a.example/p'],
      ['a scheme that is not http(s)', 'ftp://a.example/p'],
      ['a text that is not an address', 'not a url'],
      ['an upper-case host (not its own reduction)', 'https://A.example/p'],
      ['a default port (not its own reduction)', 'https://a.example:443/p'],
      ['an option', '--output=evil'],
      ['the empty string', ''],
      ['2049 units', `https://a.example/${'a'.repeat(2049 - 'https://a.example/'.length)}`],
    ])('refuses a Referer with %s', (_name, value) => {
      const args = withReferer(value);
      expect(args).toHaveLength(0);
      for (const a of args) expect(a.includes(value)).toBe(false);
    });

    it.each([
      ['CR', 'Mozilla\r5.0'],
      ['LF', 'Mozilla\n5.0'],
      ['CR LF and a second header', 'Mozilla\r\nX-Evil: 1'],
      ['NUL', 'Mozilla\u00005.0'],
      ['a tab', 'Mozilla\t5.0'],
      ['DEL', 'Mozilla\u007f5.0'],
      ['513 characters', 'a'.repeat(513)],
      ['a non-ASCII letter', 'Mozilla é 5.0'],
      ['an emoji', 'Mozilla 😀'],
      ['the empty string', ''],
    ])('refuses a User-Agent with %s', (_name, value) => {
      const args = withUa(value);
      expect(args).toHaveLength(0);
      for (const a of args) expect(a.includes(value)).toBe(false);
    });

    it.each<[string, unknown]>([
      ['a number', 5],
      ['a boolean', true],
      ['an object', { toString: () => 'x' }],
      ['an array', ['https://a.example/p']],
      ['a symbol', Symbol('x')],
      ['undefined', undefined],
    ])('refuses a non-string (%s) as either header, and does not throw', (_name, value) => {
      expect(withReferer(value)).toEqual([]);
      expect(withUa(value)).toEqual([]);
    });

    it('still sends the header that is valid when the other is refused', () => {
      expect(hdr({ referer: 'https://a.example/p?token=1', userAgent: UA })).toEqual(['--add-headers', `User-Agent:${UA}`]);
      expect(hdr({ referer: REFERER, userAgent: 'bad\r\nX: y' })).toEqual(['--add-headers', `Referer:${REFERER}`]);
    });
  });

  describe.each(BUILDERS)('%s', (_name, make) => {
    // Built inside each spec, so a missing export fails that spec and not the whole file.
    const base = (): string[] => make(null);

    it('ends with -- and the link, and has only one --', () => {
      expect(base().slice(-2)).toEqual(['--', URL]);
      expect(base().filter((a) => a === '--')).toHaveLength(1);
      expect(base()).not.toContain('--add-headers');
    });

    it('gives the same argv for null and for two null values', () => {
      expect(make(NONE)).toEqual(base());
    });

    it('gains exactly four elements, together and in order, before --, for both headers', () => {
      const args = make(BOTH);
      expect(args).toHaveLength(base().length + 4);
      const at = runAt(args, FOUR);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at + 4).toBeLessThanOrEqual(args.indexOf('--'));
      expect(without(args, FOUR)).toEqual(base());
      expect(args.slice(-2)).toEqual(['--', URL]);
    });

    it('gains two elements for one header, and its pair is --add-headers then the value', () => {
      const one = make({ referer: REFERER, userAgent: null });
      expect(one).toHaveLength(base().length + 2);
      expect(without(one, FOUR.slice(0, 2))).toEqual(base());
      const two = make({ referer: null, userAgent: UA });
      expect(two).toHaveLength(base().length + 2);
      expect(without(two, FOUR.slice(2))).toEqual(base());
    });

    it('never puts a header after --: only the link follows it', () => {
      const args = make(BOTH);
      expect(args.slice(args.indexOf('--') + 1)).toEqual([URL]);
    });

    it.each(['-o https://a.b', '--exec=calc', '-', '--', '-J'])('keeps a link that starts with a dash (%s) after --, as the last element', (url) => {
      const args = make(BOTH, url);
      expect(args.slice(-2)).toEqual(['--', url]);
      // Nothing but the four header elements differs from the same call with no header.
      expect(without(args, FOUR)).toEqual(make(null, url));
      expect(args.slice(0, -2)).not.toContain('--');
    });

    it("passes PA3-6's User-Agent as exactly one element, byte for byte, and adds no other element", () => {
      const args = make({ referer: null, userAgent: PA3_6 });
      expect(args).toHaveLength(base().length + 2);
      expect(args.filter((a) => a === `User-Agent:${PA3_6}`)).toHaveLength(1);
      expect(args.filter((a) => a.includes('--output=evil'))).toHaveLength(1);
      expect(without(args, ['--add-headers', `User-Agent:${PA3_6}`])).toEqual(base());
    });

    it.each([
      ['a Referer with CR LF', { referer: 'https://a.example/p\r\nX: y', userAgent: null }],
      ['a Referer with a query', { referer: 'https://a.example/p?token=1', userAgent: null }],
      ['a Referer with a double quote', { referer: 'https://a.example/p"q', userAgent: null }],
      ['a User-Agent with LF', { referer: null, userAgent: 'a\nb' }],
      ['a User-Agent with NUL', { referer: null, userAgent: 'a\u0000b' }],
      ['a User-Agent with a tab', { referer: null, userAgent: 'a\tb' }],
      ['a User-Agent of 513 characters', { referer: null, userAgent: 'a'.repeat(513) }],
      ['a User-Agent that is not a string', { referer: null, userAgent: 7 as unknown as string }],
    ])('adds no element for %s', (_label, headers) => {
      expect(make(headers as ProbeHeaders)).toEqual(base());
    });

    it('does not change the headers it is given', () => {
      const given: ProbeHeaders = { referer: REFERER, userAgent: UA };
      make(given);
      expect(given).toEqual({ referer: REFERER, userAgent: UA });
    });
  });

  describe('downloadArgs keeps every other option when headers are given', () => {
    it('adds only the four header elements to a full option set', () => {
      const over = { subtitleLangs: ['ar'], rateLimitBytes: 500000, sourceHeight: 720 };
      const plain = build({ kind: 'max', height: 720 }, { ...over, headers: null });
      const headed = build({ kind: 'max', height: 720 }, { ...over, headers: BOTH });
      expect(without(headed, FOUR)).toEqual(plain);
    });
  });
});
