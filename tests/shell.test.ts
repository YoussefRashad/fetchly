import { describe, expect, it } from 'vitest';
import { finishedMessage, trayIconBitmap, trayTooltip } from '../src/main/shellText';
import { makeJob } from './helpers';

describe('finishedMessage', () => {
  it('announces a finished download by its title', () => {
    expect(finishedMessage({ kind: 'job', title: 'Talk', failed: 0, skipped: 0 })).toEqual({ title: 'Download finished', body: 'Talk' });
  });

  it('announces a failed download', () => {
    expect(finishedMessage({ kind: 'job', title: 'Talk', failed: 1, skipped: 0 })).toEqual({ title: 'Download failed', body: 'Talk' });
  });

  it('announces a skipped download', () => {
    expect(finishedMessage({ kind: 'job', title: 'Talk', failed: 0, skipped: 1 })).toEqual({ title: 'Download skipped', body: 'Talk' });
  });

  it('announces a clean playlist without counts', () => {
    expect(finishedMessage({ kind: 'group', title: 'Course', failed: 0, skipped: 0 })).toEqual({ title: 'Playlist finished', body: 'Course' });
  });

  it('adds only the counts that are not zero', () => {
    expect(finishedMessage({ kind: 'group', title: 'Course', failed: 2, skipped: 1 }).body).toBe('Course · 2 failed · 1 skipped');
    expect(finishedMessage({ kind: 'group', title: 'Course', failed: 0, skipped: 3 }).body).toBe('Course · 3 skipped');
    expect(finishedMessage({ kind: 'group', title: 'Course', failed: 1, skipped: 0 }).body).toBe('Course · 1 failed');
  });
});

describe('trayTooltip', () => {
  it('is just the name when nothing is running', () => {
    expect(trayTooltip({ jobs: [makeJob({ state: 'paused' }), makeJob({ state: 'done' })], groups: [] })).toBe('Fetchly');
    expect(trayTooltip({ jobs: [], groups: [] })).toBe('Fetchly');
  });

  it('counts the downloads that are running', () => {
    const jobs = [makeJob({ state: 'downloading' }), makeJob({ state: 'probing' }), makeJob({ state: 'queued' }), makeJob({ state: 'paused' })];
    expect(trayTooltip({ jobs, groups: [] })).toBe('Fetchly · 2 downloading');
  });
});

describe('trayIconBitmap', () => {
  it('is a square BGRA bitmap with something drawn on it', () => {
    const { size, data } = trayIconBitmap();
    expect(data.length).toBe(size * size * 4);
    const opaque = data.filter((_, i) => i % 4 === 3 && data[i] === 255).length;
    expect(opaque).toBeGreaterThan(size);
    expect(opaque).toBeLessThan(size * size);
  });
});
