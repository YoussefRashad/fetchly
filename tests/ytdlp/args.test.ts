import { describe, expect, it } from 'vitest';
import { downloadArgs, FILE_PREFIX, heightProbeArgs, probeArgs, PROGRESS_PREFIX } from '../../src/main/ytdlp/args';
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
    ...over,
  });
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

const AVC_1080 = 'bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=1080]+ba/b[height<=1080]';

describe('probeArgs', () => {
  it('asks for flat JSON', () => {
    expect(probeArgs(URL)).toEqual(['-J', '--flat-playlist', '--no-warnings', URL]);
  });
});

describe('heightProbeArgs', () => {
  it('asks for the full JSON of one video, url after --', () => {
    expect(heightProbeArgs(URL)).toEqual(['-J', '--no-playlist', '--no-warnings', '--', URL]);
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
    expect(valueOf(args, '-f')).toBe('bv*[height<=480][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=480]+ba/b[height<=480]');
    expect(valueOf(args, '--merge-output-format')).toBe('mp4');
  });

  it('keeps the original codec in mkv above 1080p', () => {
    const args = build({ kind: 'max', height: 2160 });
    expect(valueOf(args, '-f')).toBe('bv*[height<=2160]+ba/b[height<=2160]');
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
