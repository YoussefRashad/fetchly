import { isUserAgent, reduceReferer } from '../../shared/protocol';
import type { Quality } from '../../shared/types';
import type { ProbeHeaders } from '../probe';

export const PROGRESS_PREFIX = 'FETCHLY_PROGRESS';
export const FILE_PREFIX = 'FETCHLY_FILE';

/**
 * The headers a start may send, each checked again whatever its source: a Referer only when it equals its own
 * reduction (reduceReferer), a User-Agent only when isUserAgent; any other value, a non-string included, becomes
 * null. Reads `referer` and `userAgent` only. Never throws.
 */
export function sendableHeaders(h: { readonly referer: unknown; readonly userAgent: unknown } | null): ProbeHeaders {
  if (h === null) return { referer: null, userAgent: null };
  const { referer, userAgent } = h;
  return {
    referer: typeof referer === 'string' && reduceReferer(referer) === referer ? referer : null,
    userAgent: isUserAgent(userAgent) ? userAgent : null,
  };
}

/**
 * `--add-headers Referer:<r>`, then `--add-headers User-Agent:<ua>`, for each header that is sendable. Each value is
 * the second half of one element, so it can never start an option. A refused value adds nothing.
 */
export function headerArgs(headers: ProbeHeaders | null): string[] {
  const { referer, userAgent } = sendableHeaders(headers);
  const args: string[] = [];
  if (referer !== null) args.push('--add-headers', `Referer:${referer}`);
  if (userAgent !== null) args.push('--add-headers', `User-Agent:${userAgent}`);
  return args;
}

/** Flat JSON of a link; `--` so a link can never be read as an option. */
export function probeArgs(url: string, headers: ProbeHeaders | null): string[] {
  return ['-J', '--flat-playlist', '--no-warnings', ...headerArgs(headers), '--', url];
}

/** Full JSON of one video, read before a Best download to learn its real height. */
export function heightProbeArgs(url: string, headers: ProbeHeaders | null): string[] {
  return ['-J', '--no-playlist', '--no-warnings', ...headerArgs(headers), '--', url];
}

export interface DownloadOptions {
  url: string;
  quality: Quality;
  preferMp4Max1080: boolean;
  subtitleLangs: string[];
  dir: string;
  baseName: string;
  ffmpegPath: string;
  rateLimitBytes: number | null;
  /** highest height the site offers; null = not known */
  sourceHeight: number | null;
  /** The Referer and User-Agent to send; null = none. */
  headers: ProbeHeaders | null;
}

/**
 * A height ceiling. `<=?` also keeps a format whose height is unknown (a page's plain
 * `<video><source>`); without the `?` such a source has no format left to download.
 */
function maxHeight(height: number): string {
  return `[height<=?${height}]`;
}

/** H.264 + AAC plays everywhere and fits mp4; fall back to whatever exists at that height. */
function mp4Format(height: number): string[] {
  const h = maxHeight(height);
  return ['-f', `bv*${h}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*${h}+ba/b${h}`, '--merge-output-format', 'mp4'];
}

function formatArgs(quality: Quality, preferMp4Max1080: boolean, sourceHeight: number | null): string[] {
  if (quality.kind === 'audio') return ['-f', 'ba/b', '-x', '--audio-format', quality.format];
  if (preferMp4Max1080) {
    // --remux-video turns a format that came as a single non-mp4 file into mp4 too.
    return [...mp4Format(quality.kind === 'max' ? Math.min(quality.height, 1080) : 1080), '--remux-video', 'mp4'];
  }
  if (quality.kind === 'best') {
    // Up to 1080p H.264 in mp4 exists and plays everywhere; above it keep the codec in mkv.
    if (sourceHeight !== null && sourceHeight <= 1080) return mp4Format(1080);
    return ['-f', 'bv*+ba/b', '--merge-output-format', 'mkv'];
  }
  if (quality.height <= 1080) return mp4Format(quality.height);
  // Above 1080p YouTube only has VP9/AV1; keep the codec, never re-encode.
  const h = maxHeight(quality.height);
  return ['-f', `bv*${h}+ba/b${h}`, '--merge-output-format', 'mkv'];
}

export function downloadArgs(o: DownloadOptions): string[] {
  const args = [
    '--no-playlist',
    '--newline',
    '--progress',
    '--no-warnings',
    '--continue',
    '--no-overwrites',
    '--retries',
    '3',
    '--ffmpeg-location',
    o.ffmpegPath,
    '-P',
    o.dir,
    '-o',
    // A literal % in the title must not be read as a template field.
    `${o.baseName.replaceAll('%', '%%')}.%(ext)s`,
    '--progress-template',
    `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s`,
    '--print',
    `after_move:${FILE_PREFIX} %(height)s %(filepath)s`,
    ...formatArgs(o.quality, o.preferMp4Max1080, o.sourceHeight),
  ];
  if (o.subtitleLangs.length > 0) args.push('--write-subs', '--sub-langs', o.subtitleLangs.join(','));
  if (o.rateLimitBytes !== null) args.push('--limit-rate', String(o.rateLimitBytes));
  args.push(...headerArgs(o.headers));
  // `--` so a url can never be read as an option.
  args.push('--', o.url);
  return args;
}
