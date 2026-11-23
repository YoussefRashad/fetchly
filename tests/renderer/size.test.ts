import { afterEach, describe, expect, it } from 'vitest';
import { sizeParts, type SizeParts } from '../../src/renderer/src/format';
import { setLanguage } from '../../src/renderer/src/strings';
import type { JobKind, JobState } from '../../src/shared/types';
import { makeJob } from '../helpers';

const KB = 1024;
const MB = 1024 ** 2;
const GB = 1024 ** 3;
const DONE = Math.round(12.4 * MB);
const TOTAL = 310 * MB;

const job = (kind: JobKind, state: JobState, bytesDone: number, bytesTotal: number | null) =>
  makeJob({ kind, state, bytesDone, bytesTotal, quality: kind === 'file' ? null : { kind: 'best' }, baseName: kind === 'file' ? null : 'Video' });

const parts = (done: string | null, total: string | null, unit: string, approx: boolean): SizeParts => ({ done, total, unit, approx });

describe('sizeParts: the table, cell by cell', () => {
  it.each(['downloading', 'paused'] as const)('%s with a known total: done in the total unit, a media total marked approximate', (state) => {
    expect(sizeParts(job('file', state, DONE, TOTAL))).toEqual(parts('12.4', '310', 'MB', false));
    expect(sizeParts(job('media', state, DONE, TOTAL))).toEqual(parts('12.4', '310', 'MB', true));
  });

  it.each(['downloading', 'paused'] as const)('%s with an unknown total: the done figure in its own unit, never approximate', (state) => {
    expect(sizeParts(job('file', state, DONE, null))).toEqual(parts('12.4', null, 'MB', false));
    expect(sizeParts(job('media', state, DONE, null))).toEqual(parts('12.4', null, 'MB', false));
  });

  it.each(['queued', 'probing'] as const)('%s: a file shows its known total alone; otherwise empty', (state) => {
    expect(sizeParts(job('file', state, 0, TOTAL))).toEqual(parts(null, '310', 'MB', false));
    expect(sizeParts(job('file', state, 0, null))).toBeNull();
    expect(sizeParts(job('media', state, 0, TOTAL))).toBeNull();
    expect(sizeParts(job('media', state, 0, null))).toBeNull();
  });

  it('merging is empty for both kinds', () => {
    expect(sizeParts(job('file', 'merging', DONE, TOTAL))).toBeNull();
    expect(sizeParts(job('media', 'merging', DONE, TOTAL))).toBeNull();
  });

  it('done: a file shows its known total alone; a media job and an unknown total are empty', () => {
    expect(sizeParts(job('file', 'done', TOTAL, TOTAL))).toEqual(parts(null, '310', 'MB', false));
    expect(sizeParts(job('file', 'done', DONE, null))).toBeNull();
    expect(sizeParts(job('media', 'done', TOTAL, TOTAL))).toBeNull();
    expect(sizeParts(job('media', 'done', DONE, null))).toBeNull();
  });

  it('failed after some bytes: as downloading, for both kinds', () => {
    expect(sizeParts(job('file', 'failed', DONE, TOTAL))).toEqual(parts('12.4', '310', 'MB', false));
    expect(sizeParts(job('media', 'failed', DONE, TOTAL))).toEqual(parts('12.4', '310', 'MB', true));
    expect(sizeParts(job('file', 'failed', DONE, null))).toEqual(parts('12.4', null, 'MB', false));
    expect(sizeParts(job('media', 'failed', DONE, null))).toEqual(parts('12.4', null, 'MB', false));
  });

  it('failed with no bytes: empty for both kinds, even with a total', () => {
    expect(sizeParts(job('file', 'failed', 0, TOTAL))).toBeNull();
    expect(sizeParts(job('media', 'failed', 0, TOTAL))).toBeNull();
    expect(sizeParts(job('file', 'failed', 0, null))).toBeNull();
  });

  it('skipped is empty for both kinds', () => {
    expect(sizeParts(job('file', 'skipped', DONE, TOTAL))).toBeNull();
    expect(sizeParts(job('media', 'skipped', 0, null))).toBeNull();
  });

  it('a downloading job with nothing yet shows zero, not an empty cell', () => {
    expect(sizeParts(job('file', 'downloading', 0, null))).toEqual(parts('0', null, 'B', false));
    expect(sizeParts(job('media', 'downloading', 0, TOTAL))).toEqual(parts('0.0', '310', 'MB', true));
  });
});

describe('sizeParts: units and decimals', () => {
  /** The done figure and unit of a download whose total is unknown. */
  const doneOnly = (n: number) => {
    const p = sizeParts(job('file', 'downloading', n, null));
    return `${p?.done} ${p?.unit}`;
  };
  /** The total and unit of a queued file. */
  const totalOnly = (n: number) => {
    const p = sizeParts(job('file', 'queued', 0, n));
    return `${p?.total} ${p?.unit}`;
  };

  // The done figure keeps the unit's fixed decimals; a total that rounds to a whole number drops them.
  it.each([
    [1023, '1023 B', '1023 B'],
    [1024, '1 KB', '1 KB'],
    [1023 * KB, '1023 KB', '1023 KB'],
    [MB, '1.0 MB', '1 MB'],
    [1023 * MB, '1023.0 MB', '1023 MB'],
    [GB, '1.00 GB', '1 GB'],
  ])('%d bytes -> done %s, total %s (the unit changes at 1024)', (n, expectedDone, expectedTotal) => {
    expect(doneOnly(n)).toBe(expectedDone);
    expect(totalOnly(n)).toBe(expectedTotal);
  });

  it.each([
    [MB - 1, '1.0 MB', '1 MB'],
    [GB - 1, '1.00 GB', '1 GB'],
  ])('%d bytes, which would round to 1024 of the smaller unit, -> done %s, total %s', (n, expectedDone, expectedTotal) => {
    expect(doneOnly(n)).toBe(expectedDone);
    expect(totalOnly(n)).toBe(expectedTotal);
  });

  it('shows a total that is a whole number without a fraction, in MB and GB', () => {
    expect(totalOnly(310 * MB)).toBe('310 MB');
    expect(totalOnly(950 * MB)).toBe('950 MB');
    expect(totalOnly(2 * GB)).toBe('2 GB');
    expect(totalOnly(3 * 1024 * GB)).toBe('3072 GB');
    expect(sizeParts(job('media', 'downloading', DONE, 950 * MB))).toEqual(parts('12.4', '950', 'MB', true));
    expect(sizeParts(job('file', 'downloading', DONE, 2 * GB))).toEqual(parts('0.01', '2', 'GB', false));
  });

  it('drops the fraction of a total that only rounds to a whole number', () => {
    expect(totalOnly(309.96 * MB)).toBe('310 MB'); // 309.96 rounds to 310.0
    expect(totalOnly(309.94 * MB)).toBe('309.9 MB'); // 309.94 rounds to 309.9
    expect(totalOnly(2.004 * GB)).toBe('2 GB'); // 2.004 rounds to 2.00
    expect(totalOnly(2.006 * GB)).toBe('2.01 GB');
    expect(sizeParts(job('media', 'downloading', DONE, 309.96 * MB))).toEqual(parts('12.4', '310', 'MB', true));
  });

  it('keeps the fixed decimals of a total that is not a whole number', () => {
    expect(totalOnly(5.8 * GB)).toBe('5.80 GB'); // a trailing zero is not a zero fraction
    expect(totalOnly(5.5 * GB)).toBe('5.50 GB');
    expect(totalOnly(120.5 * MB)).toBe('120.5 MB');
    expect(totalOnly(1.5 * MB)).toBe('1.5 MB');
    expect(sizeParts(job('file', 'downloading', 1.2 * GB, 5.8 * GB))).toEqual(parts('1.20', '5.80', 'GB', false));
  });

  it('keeps the fixed decimals of the done figure, even when it is a whole number', () => {
    expect(doneOnly(12 * MB)).toBe('12.0 MB');
    expect(doneOnly(2 * GB)).toBe('2.00 GB');
    expect(sizeParts(job('file', 'downloading', 12 * MB, TOTAL))).toEqual(parts('12.0', '310', 'MB', false));
    expect(sizeParts(job('file', 'downloading', 2 * GB, 5.8 * GB))).toEqual(parts('2.00', '5.80', 'GB', false));
  });

  it('gives GB two decimals, MB one, KB and B none', () => {
    expect(doneOnly(5.5 * GB)).toBe('5.50 GB');
    expect(doneOnly(5 * GB + 10 * MB)).toBe('5.01 GB');
    expect(doneOnly(12.44 * MB)).toBe('12.4 MB');
    expect(doneOnly(1536)).toBe('2 KB');
    expect(doneOnly(1500)).toBe('1 KB');
    expect(doneOnly(512)).toBe('512 B');
    expect(doneOnly(3 * 1024 * GB)).toBe('3072.00 GB');
  });

  it('shows the done figure in the total unit, however small it is', () => {
    expect(sizeParts(job('file', 'downloading', 512, TOTAL))).toEqual(parts('0.0', '310', 'MB', false));
    expect(sizeParts(job('file', 'downloading', 300 * MB, 2 * GB))).toEqual(parts('0.29', '2', 'GB', false));
    expect(sizeParts(job('file', 'downloading', 3 * MB, 800 * KB))).toEqual(parts('3072', '800', 'KB', false));
  });

  it('never clamps the done figure to the total', () => {
    expect(sizeParts(job('file', 'downloading', 400 * MB, TOTAL))).toEqual(parts('400.0', '310', 'MB', false));
    expect(sizeParts(job('media', 'paused', 400 * MB, TOTAL))).toEqual(parts('400.0', '310', 'MB', true));
  });

  it('treats a total of 0 like an unknown total, as percent() does', () => {
    expect(sizeParts(job('file', 'downloading', 1536, 0))).toEqual(parts('2', null, 'KB', false));
    expect(sizeParts(job('media', 'downloading', 1536, 0))).toEqual(parts('2', null, 'KB', false));
    expect(sizeParts(job('file', 'queued', 0, 0))).toBeNull();
    expect(sizeParts(job('file', 'done', 0, 0))).toBeNull();
  });

  it('marks a total approximate exactly for a media job that has one', () => {
    expect(sizeParts(job('media', 'downloading', DONE, TOTAL))?.approx).toBe(true);
    expect(sizeParts(job('media', 'downloading', DONE, null))?.approx).toBe(false);
    expect(sizeParts(job('file', 'downloading', DONE, TOTAL))?.approx).toBe(false);
    expect(sizeParts(job('file', 'downloading', DONE, null))?.approx).toBe(false);
  });
});

describe('sizeParts in Arabic', () => {
  afterEach(() => setLanguage('en'));

  it('is the same text, with Western digits and Latin units', () => {
    const en = [sizeParts(job('media', 'downloading', DONE, TOTAL)), sizeParts(job('file', 'queued', 0, 5.5 * GB))];
    setLanguage('ar');
    expect([sizeParts(job('media', 'downloading', DONE, TOTAL)), sizeParts(job('file', 'queued', 0, 5.5 * GB))]).toEqual(en);
  });
});
