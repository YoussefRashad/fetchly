import { describe, expect, it } from 'vitest';
import {
  allowedVerbs,
  formatBytes,
  formatEta,
  formatSpeed,
  groupSummary,
  matchesFilter,
  percent,
  qualityLabel,
  statusText,
  type Filter,
} from '../../src/renderer/src/format';
import type { JobState, JobVerb } from '../../src/shared/types';
import { makeJob } from '../helpers';

describe('formatBytes', () => {
  it.each([
    [18874368, '18.0 MB'],
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [5 * 1024 ** 3, '5.0 GB'],
    [3 * 1024 ** 4, '3072.0 GB'],
  ])('%d -> %s', (n, text) => {
    expect(formatBytes(n)).toBe(text);
  });

  it('shows a dash for an unknown size', () => {
    expect(formatBytes(null)).toBe('—');
  });
});

describe('formatSpeed', () => {
  it('formats bytes per second', () => {
    expect(formatSpeed(3250586)).toBe('3.1 MB/s');
  });

  it('is empty when nothing is moving', () => {
    expect(formatSpeed(0)).toBe('');
  });
});

describe('formatEta', () => {
  it.each([
    [42, '0:42'],
    [0, '0:00'],
    [65, '1:05'],
    [3909, '1:05:09'],
    [41.6, '0:42'],
  ])('%d -> %s', (sec, text) => {
    expect(formatEta(sec)).toBe(text);
  });

  it('is empty when unknown', () => {
    expect(formatEta(null)).toBe('');
  });
});

describe('percent', () => {
  it('is null when the size is unknown', () => {
    expect(percent(makeJob({ bytesDone: 50, bytesTotal: null }))).toBeNull();
  });

  it('is the share downloaded, rounded down', () => {
    expect(percent(makeJob({ bytesDone: 50, bytesTotal: 200 }))).toBe(25);
    expect(percent(makeJob({ bytesDone: 199, bytesTotal: 200 }))).toBe(99);
  });

  it('is 100 for a finished job, whatever the counters say', () => {
    expect(percent(makeJob({ state: 'done', bytesDone: 0, bytesTotal: null }))).toBe(100);
  });

  it('never exceeds 100 or divides by zero', () => {
    expect(percent(makeJob({ bytesDone: 300, bytesTotal: 200 }))).toBe(100);
    expect(percent(makeJob({ bytesDone: 0, bytesTotal: 0 }))).toBeNull();
  });
});

describe('statusText', () => {
  const half = { bytesDone: 50, bytesTotal: 200 };

  it.each([
    [makeJob({ state: 'queued' }), 'queued'],
    [makeJob({ state: 'queued', reason: 'retrying (1/3)' }), 'retrying (1/3)'],
    [makeJob({ state: 'probing' }), 'starting…'],
    [makeJob({ state: 'downloading', ...half, speed: 3250586, eta: 42 }), '25% · 3.1 MB/s · 0:42'],
    [makeJob({ state: 'downloading', ...half, speed: 0, eta: null }), '25%'],
    [makeJob({ state: 'downloading', bytesDone: 1536, bytesTotal: null, speed: 1024, eta: null }), '1.5 KB · 1.0 KB/s'],
    [makeJob({ state: 'downloading', ...half, speed: 0, eta: null, resumable: false }), '25% · cannot resume'],
    [makeJob({ state: 'paused', ...half }), 'paused 25%'],
    [makeJob({ state: 'paused' }), 'paused'],
    [makeJob({ state: 'merging' }), 'finishing…'],
    [makeJob({ state: 'done' }), 'done'],
    [makeJob({ state: 'failed', reason: 'private video' }), 'failed: private video'],
    [makeJob({ state: 'failed', reason: null }), 'failed'],
    [makeJob({ state: 'skipped', reason: 'protected' }), 'skipped: protected'],
  ])('%#', (job, text) => {
    expect(statusText(job)).toBe(text);
  });
});

describe('matchesFilter', () => {
  const cases: [Filter, JobState[]][] = [
    ['all', ['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped']],
    ['downloading', ['queued', 'probing', 'downloading', 'merging']],
    ['paused', ['paused']],
    ['done', ['done']],
    ['failed', ['failed', 'skipped']],
  ];
  const all: JobState[] = ['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped'];

  it.each(cases)('%s shows exactly its states', (filter, expected) => {
    expect(all.filter((state) => matchesFilter(makeJob({ state }), filter))).toEqual(expected);
  });
});

describe('allowedVerbs', () => {
  const cases: [JobState, JobVerb[]][] = [
    ['queued', ['pause', 'cancel']],
    ['probing', ['pause', 'cancel']],
    ['downloading', ['pause', 'cancel']],
    ['merging', ['cancel']],
    ['paused', ['resume', 'cancel']],
    ['failed', ['retry', 'remove']],
    ['skipped', ['remove']],
    ['done', ['remove', 'removeWithFile']],
  ];

  it.each(cases)('%s -> %j', (state, verbs) => {
    expect(allowedVerbs(makeJob({ state }))).toEqual(verbs);
  });
});

describe('groupSummary', () => {
  it('counts finished items out of those that can be downloaded', () => {
    const jobs = [
      makeJob({ state: 'done' }),
      makeJob({ state: 'done' }),
      makeJob({ state: 'downloading', bytesDone: 50, bytesTotal: 100 }),
      makeJob({ state: 'skipped' }),
    ];
    expect(groupSummary(jobs)).toEqual({ done: 2, total: 3, percent: 67 });
  });

  it('is zero for a group with nothing downloadable', () => {
    expect(groupSummary([makeJob({ state: 'skipped' })])).toEqual({ done: 0, total: 0, percent: 0 });
    expect(groupSummary([])).toEqual({ done: 0, total: 0, percent: 0 });
  });
});

describe('qualityLabel', () => {
  it('shows the real height once known', () => {
    expect(qualityLabel(makeJob({ actualHeight: 720, quality: { kind: 'best' } }))).toBe('720p');
  });

  it('shows what was asked for until then', () => {
    expect(qualityLabel(makeJob({ quality: { kind: 'best' } }))).toBe('best');
    expect(qualityLabel(makeJob({ quality: { kind: 'max', height: 1080 } }))).toBe('≤1080p');
    expect(qualityLabel(makeJob({ quality: { kind: 'audio', format: 'mp3' } }))).toBe('mp3');
  });

  it('shows the size for a file', () => {
    expect(qualityLabel(makeJob({ kind: 'file', quality: null, bytesTotal: 18874368 }))).toBe('18.0 MB');
  });
});
