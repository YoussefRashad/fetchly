import { describe, expect, it } from 'vitest';
import { classifyError, parseLine, parseProbe } from '../../src/main/ytdlp/parse';

describe('parseProbe', () => {
  it('reads a playlist, marking entries that cannot be downloaded', () => {
    const json = JSON.stringify({
      _type: 'playlist',
      title: 'React Course',
      entries: [
        { url: 'https://example.com/v/1', title: 'Intro' },
        { webpage_url: 'https://example.com/v/2', title: 'Setup' },
        null,
        { url: 'https://example.com/v/3', title: '[Private video]' },
        { url: 'https://example.com/v/4', title: '[Deleted video]' },
        { title: 'No link' },
      ],
    });
    expect(parseProbe(json)).toEqual({
      kind: 'playlist',
      title: 'React Course',
      entries: [
        { index: 1, url: 'https://example.com/v/1', title: 'Intro', unavailable: false },
        { index: 2, url: 'https://example.com/v/2', title: 'Setup', unavailable: false },
        { index: 4, url: 'https://example.com/v/3', title: '[Private video]', unavailable: true },
        { index: 5, url: 'https://example.com/v/4', title: '[Deleted video]', unavailable: true },
        { index: 6, url: '', title: 'No link', unavailable: true },
      ],
    });
  });

  it('keeps playlist positions when an entry is missing', () => {
    const json = JSON.stringify({ _type: 'playlist', title: 'P', entries: [null, { url: 'https://e.com/2', title: 'Two' }] });
    const probe = parseProbe(json);
    expect(probe.kind === 'playlist' && probe.entries[0]?.index).toBe(2);
  });

  it('reads a single video with its distinct heights, highest first', () => {
    const json = JSON.stringify({
      title: 'Talk',
      thumbnail: 'https://example.com/t.jpg',
      formats: [{ height: 720 }, { height: 1080 }, { height: 1080 }, { height: null }, { height: 360 }, {}],
    });
    expect(parseProbe(json)).toEqual({
      kind: 'media',
      title: 'Talk',
      thumbnail: 'https://example.com/t.jpg',
      heights: [1080, 720, 360],
    });
  });

  it('copes with a video that lists no formats, thumbnail or title', () => {
    expect(parseProbe('{}')).toEqual({ kind: 'media', title: 'untitled', thumbnail: null, heights: [] });
  });

  it('gives a playlist with no title or entries a usable shape', () => {
    expect(parseProbe('{"_type":"playlist"}')).toEqual({ kind: 'playlist', title: 'untitled', entries: [] });
  });

  it('throws on output that is not JSON', () => {
    expect(() => parseProbe('not json')).toThrow();
  });

  it('throws on JSON that is not an object', () => {
    expect(() => parseProbe('null')).toThrow();
  });
});

describe('parseLine', () => {
  it('reads a progress line, using the estimate when the total is unknown', () => {
    expect(parseLine('HAMMEL_PROGRESS 1048576 NA 4194304 250000.5 12')).toEqual({
      type: 'progress',
      bytesDone: 1048576,
      bytesTotal: 4194304,
      speed: 250000.5,
      eta: 12,
    });
  });

  it('prefers the exact total over the estimate', () => {
    expect(parseLine('HAMMEL_PROGRESS 10 100 999 5 1')).toMatchObject({ bytesTotal: 100 });
  });

  it('reads a progress line where everything is unknown', () => {
    expect(parseLine('HAMMEL_PROGRESS NA NA NA NA NA')).toEqual({
      type: 'progress',
      bytesDone: 0,
      bytesTotal: null,
      speed: 0,
      eta: null,
    });
  });

  it('rounds a fractional estimate to whole bytes', () => {
    expect(parseLine('HAMMEL_PROGRESS 10 NA 4194304.7 5 1')).toMatchObject({ bytesTotal: 4194305 });
  });

  it('ignores a progress line with missing fields', () => {
    expect(parseLine('HAMMEL_PROGRESS 10 20')).toEqual({ type: 'other' });
  });

  it('reads the final file line, keeping spaces in the path', () => {
    expect(parseLine('HAMMEL_FILE 1080 D:\\Dl\\03 - My Video.mp4')).toEqual({
      type: 'file',
      height: 1080,
      path: 'D:\\Dl\\03 - My Video.mp4',
    });
  });

  it('reads a file line without a height (audio)', () => {
    expect(parseLine('HAMMEL_FILE NA D:\\Dl\\song.mp3')).toEqual({ type: 'file', height: null, path: 'D:\\Dl\\song.mp3' });
  });

  it('tolerates a trailing carriage return', () => {
    expect(parseLine('HAMMEL_FILE 720 D:\\Dl\\a.mp4\r')).toMatchObject({ path: 'D:\\Dl\\a.mp4' });
  });

  it.each(['[Merger] Merging formats into "x.mp4"', '[ExtractAudio] Destination: x.mp3'])('sees %s as merging', (line) => {
    expect(parseLine(line)).toEqual({ type: 'merging' });
  });

  it('treats anything else as other', () => {
    expect(parseLine('[youtube] Extracting URL')).toEqual({ type: 'other' });
    expect(parseLine('')).toEqual({ type: 'other' });
  });
});

describe('classifyError', () => {
  it.each([
    ['ERROR: [x] 1: This video is DRM protected', 'skipped', 'protected'],
    ['ERROR: [youtube] abc: Private video. Sign in if you have been granted access', 'skipped', 'private'],
    ['ERROR: [youtube] abc: Video unavailable', 'skipped', 'removed'],
    ['ERROR: This video has been removed by the uploader', 'skipped', 'removed'],
    ['ERROR: The account associated with this video has been terminated', 'skipped', 'removed'],
    ['ERROR: [x] 9: This page does not exist', 'skipped', 'removed'],
    ['ERROR: The uploader has not made this video available in your country', 'skipped', 'unavailable in region'],
    ['ERROR: This video is geo-restricted', 'skipped', 'unavailable in region'],
    ['ERROR: [youtube] abc: Sign in to confirm you are not a bot', 'failed', 'login required'],
    ['ERROR: [youtube] abc: Sign in to confirm your age', 'failed', 'login required'],
    ['ERROR: [instagram] x: You need to log in to access this content', 'failed', 'login required'],
    ['ERROR: [facebook] 1: login required', 'failed', 'login required'],
    ['ERROR: Join this channel to get access to members-only content', 'failed', 'login required'],
    ['ERROR: Use --cookies-from-browser or --cookies for the authentication', 'failed', 'login required'],
    ['ERROR: unable to write data: [Errno 28] No space left on device', 'failed', 'disk full'],
    ['OSError: ENOSPC', 'failed', 'disk full'],
    ['ERROR: There is not enough space on the disk', 'failed', 'disk full'],
    ["ERROR: unable to open for writing: [Errno 13] Permission denied: 'x.part'", 'failed', 'cannot write to folder'],
    ['Error: EACCES: permission denied', 'failed', 'cannot write to folder'],
    ['Error: EPERM: operation not permitted', 'failed', 'cannot write to folder'],
    ['ERROR: Unsupported URL: https://example.com/page', 'failed', 'unsupported site'],
  ] as const)('%s -> %s: %s, never retried', (stderr, outcome, reason) => {
    expect(classifyError(stderr)).toEqual({ outcome, reason, retryable: false });
  });

  it('retries an unknown error and reports its last ERROR line', () => {
    const stderr = 'WARNING: slow\nERROR: first problem\nERROR: unable to download video data: HTTP Error 503\n';
    expect(classifyError(stderr)).toEqual({
      outcome: 'failed',
      reason: 'unable to download video data: HTTP Error 503',
      retryable: true,
    });
  });

  it('retries with a generic reason when there is no ERROR line', () => {
    expect(classifyError('')).toEqual({ outcome: 'failed', reason: 'download failed', retryable: true });
  });

  it('does not mistake an ordinary word containing "age" for a login wall', () => {
    expect(classifyError('ERROR: unable to download webpage: timed out')).toMatchObject({ retryable: true });
  });

  it('keeps a very long error readable', () => {
    const { reason } = classifyError(`ERROR: ${'x'.repeat(1000)}`);
    expect(reason.length).toBeLessThanOrEqual(200);
  });
});
