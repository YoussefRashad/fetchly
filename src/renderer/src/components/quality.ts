import { HEIGHTS, type Quality } from '../../../shared/types';
import { S } from '../strings';

/** Quality as a <select> value and back. */
export function encodeQuality(q: Quality): string {
  if (q.kind === 'best') return 'best';
  if (q.kind === 'max') return `max:${q.height}`;
  return `audio:${q.format}`;
}

export function decodeQuality(value: string): Quality {
  const [kind, arg] = value.split(':');
  if (kind === 'max') {
    const height = HEIGHTS.find((h) => String(h) === arg);
    if (height !== undefined) return { kind: 'max', height };
  }
  if (kind === 'audio' && (arg === 'm4a' || arg === 'mp3')) return { kind: 'audio', format: arg };
  return { kind: 'best' };
}

/** The choices to offer. `maxHeight` hides ceilings the video cannot reach. */
export function qualityOptions(maxHeight: number | null): { value: string; label: string }[] {
  const heights = HEIGHTS.filter((h) => maxHeight === null || h <= maxHeight);
  return [
    { value: 'best', label: S.qualityBest },
    ...heights.map((h) => ({ value: `max:${h}`, label: S.qualityMax(h) })),
    { value: 'audio:m4a', label: S.qualityAudio('m4a') },
    { value: 'audio:mp3', label: S.qualityAudio('mp3') },
  ];
}

export function parseLangs(text: string): string[] {
  return text
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}
