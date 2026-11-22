import type { PlaylistEntry, ProbeResult } from '../../shared/types';
import { FILE_PREFIX, PROGRESS_PREFIX } from './args';

export type MediaProbe = Extract<ProbeResult, { kind: 'media' | 'playlist' }>;

const UNAVAILABLE_TITLES = new Set(['[Private video]', '[Deleted video]']);

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** Parses `yt-dlp -J --flat-playlist` output. Throws when it is not a JSON object. */
export function parseProbe(json: string): MediaProbe {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('probe output is not an object');
  const info = raw as Record<string, unknown>;
  const title = str(info['title']) ?? 'untitled';

  if (info['_type'] === 'playlist') {
    const rawEntries = Array.isArray(info['entries']) ? (info['entries'] as unknown[]) : [];
    const entries: PlaylistEntry[] = [];
    rawEntries.forEach((e, i) => {
      if (typeof e !== 'object' || e === null) return;
      const entry = e as Record<string, unknown>;
      const index = i + 1; // the position in the playlist, kept even when a neighbour is missing
      const url = str(entry['url']) ?? str(entry['webpage_url']) ?? '';
      const entryTitle = str(entry['title']) ?? `Item ${index}`;
      entries.push({ index, url, title: entryTitle, unavailable: url === '' || UNAVAILABLE_TITLES.has(entryTitle) });
    });
    return { kind: 'playlist', title, entries };
  }

  const formats = Array.isArray(info['formats']) ? (info['formats'] as unknown[]) : [];
  const heights = new Set<number>();
  for (const f of formats) {
    const h = typeof f === 'object' && f !== null ? (f as Record<string, unknown>)['height'] : null;
    if (typeof h === 'number' && Number.isFinite(h) && h > 0) heights.add(h);
  }
  return { kind: 'media', title, thumbnail: str(info['thumbnail']), heights: [...heights].sort((a, b) => b - a) };
}

export type Line =
  | { type: 'progress'; bytesDone: number; bytesTotal: number | null; speed: number; eta: number | null }
  | { type: 'file'; height: number | null; path: string }
  | { type: 'merging' }
  | { type: 'other' };

function num(field: string | undefined): number | null {
  if (field === undefined || field === 'NA') return null;
  const n = Number(field);
  return Number.isFinite(n) ? n : null;
}

export function parseLine(rawLine: string): Line {
  const line = rawLine.replace(/\r$/u, '');

  if (line.startsWith(`${PROGRESS_PREFIX} `)) {
    const fields = line.slice(PROGRESS_PREFIX.length + 1).trim().split(/\s+/u);
    if (fields.length < 5) return { type: 'other' };
    const total = num(fields[1]) ?? num(fields[2]);
    return {
      type: 'progress',
      bytesDone: Math.round(num(fields[0]) ?? 0),
      bytesTotal: total === null ? null : Math.round(total),
      speed: num(fields[3]) ?? 0,
      eta: num(fields[4]),
    };
  }

  if (line.startsWith(`${FILE_PREFIX} `)) {
    const rest = line.slice(FILE_PREFIX.length + 1);
    const space = rest.indexOf(' ');
    if (space === -1) return { type: 'other' };
    const path = rest.slice(space + 1);
    if (path === '') return { type: 'other' };
    return { type: 'file', height: num(rest.slice(0, space)), path };
  }

  if (line.startsWith('[Merger]') || line.startsWith('[ExtractAudio]')) return { type: 'merging' };
  return { type: 'other' };
}

export interface Classified {
  outcome: 'failed' | 'skipped';
  reason: string;
  retryable: boolean;
}

/** First match wins, so the order is part of the rule. */
const RULES: [RegExp, 'failed' | 'skipped', string][] = [
  [/\bDRM\b/i, 'skipped', 'protected'],
  [/private video/i, 'skipped', 'private'],
  [/video unavailable|has been removed|account .*terminated|does not exist/i, 'skipped', 'removed'],
  [/not (made this video )?available in your country|geo.?restrict/i, 'skipped', 'unavailable in region'],
  [/sign in|log in|login required|cookies|members-only/i, 'failed', 'login required'],
  [/no space left|ENOSPC|not enough space/i, 'failed', 'disk full'],
  [/permission denied|EACCES|EPERM|unable to open for writing/i, 'failed', 'cannot write to folder'],
  [/unsupported url/i, 'failed', 'unsupported site'],
];

const MAX_REASON = 200;

export function classifyError(stderr: string): Classified {
  for (const [pattern, outcome, reason] of RULES) {
    if (pattern.test(stderr)) return { outcome, reason, retryable: false };
  }
  const errors = stderr
    .split(/\r?\n/u)
    .filter((l) => l.startsWith('ERROR:'))
    .map((l) => l.slice('ERROR:'.length).trim())
    .filter((l) => l !== '');
  const last = errors[errors.length - 1] ?? 'download failed';
  return { outcome: 'failed', reason: last.length > MAX_REASON ? `${last.slice(0, MAX_REASON - 1)}…` : last, retryable: true };
}
