import type { Quality } from '../../shared/types';

export const PROGRESS_PREFIX = 'HAMMEL_PROGRESS';
export const FILE_PREFIX = 'HAMMEL_FILE';

export function probeArgs(url: string): string[] {
  return ['-J', '--flat-playlist', '--no-warnings', url];
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
}

/** H.264 + AAC plays everywhere and fits mp4; fall back to whatever exists at that height. */
function mp4Format(height: number): string[] {
  const h = `[height<=${height}]`;
  return ['-f', `bv*${h}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*${h}+ba/b${h}`, '--merge-output-format', 'mp4'];
}

function formatArgs(quality: Quality, preferMp4Max1080: boolean): string[] {
  if (quality.kind === 'audio') return ['-f', 'ba/b', '-x', '--audio-format', quality.format];
  if (preferMp4Max1080) return mp4Format(quality.kind === 'max' ? Math.min(quality.height, 1080) : 1080);
  if (quality.kind === 'best') return ['-f', 'bv*+ba/b', '--merge-output-format', 'mkv'];
  if (quality.height <= 1080) return mp4Format(quality.height);
  // Above 1080p YouTube only has VP9/AV1; keep the codec, never re-encode.
  const h = `[height<=${quality.height}]`;
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
    ...formatArgs(o.quality, o.preferMp4Max1080),
  ];
  if (o.subtitleLangs.length > 0) args.push('--write-subs', '--sub-langs', o.subtitleLangs.join(','));
  if (o.rateLimitBytes !== null) args.push('--limit-rate', String(o.rateLimitBytes));
  // `--` so a url can never be read as an option.
  args.push('--', o.url);
  return args;
}
