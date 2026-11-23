import { afterEach, describe, expect, it } from 'vitest';
import { addedText, addedTitle, etaText, speedText } from '../../src/renderer/src/format';
import { EN, S, setLanguage } from '../../src/renderer/src/strings';
import type { JobState } from '../../src/shared/types';
import { makeJob } from '../helpers';

afterEach(() => setLanguage('en'));

const ALL: JobState[] = ['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped'];
/** Arabic-Indic and Eastern Arabic-Indic digits: the window never shows them. */
const NON_WESTERN_DIGITS = /[٠-٩۰-۹]/u;

describe('speed and time-left columns', () => {
  it('show the speed and the time left of a downloading job', () => {
    const job = makeJob({ state: 'downloading', speed: 3250586, eta: 42 });
    expect(speedText(job)).toBe('3.1 MB/s');
    expect(etaText(job)).toBe('0:42');
  });

  it('stay empty while the tool gives no speed or no estimate yet', () => {
    const job = makeJob({ state: 'downloading', speed: 0, eta: null });
    expect(speedText(job)).toBe('');
    expect(etaText(job)).toBe('');
  });

  it.each(ALL.filter((s) => s !== 'downloading'))('stay empty for a %s job, whatever figures it kept', (state) => {
    const job = makeJob({ state, speed: 3250586, eta: 42 });
    expect(speedText(job)).toBe('');
    expect(etaText(job)).toBe('');
  });

  it('read the same in Arabic (figures and units are left to right)', () => {
    setLanguage('ar');
    const job = makeJob({ state: 'downloading', speed: 3250586, eta: 3725 });
    expect(speedText(job)).toBe('3.1 MB/s');
    expect(etaText(job)).toBe('1:02:05');
  });
});

describe('date-added column', () => {
  const now = new Date(2026, 10, 23, 18, 30).getTime();

  it('shows the time for today, the day and month for this year, and the year otherwise', () => {
    expect(addedText(new Date(2026, 10, 23, 9, 5).getTime(), now)).toBe('09:05');
    expect(addedText(new Date(2026, 10, 3, 9, 5).getTime(), now)).toBe('3 Nov');
    expect(addedText(new Date(2025, 10, 3, 9, 5).getTime(), now)).toBe('3 Nov 2025');
  });

  it('counts yesterday at 23:59 as another day, and today at 00:00 as today', () => {
    expect(addedText(new Date(2026, 10, 22, 23, 59).getTime(), now)).toBe('22 Nov');
    expect(addedText(new Date(2026, 10, 23, 0, 0).getTime(), now)).toBe('00:00');
  });

  it('counts the same day and month of last year as another year', () => {
    expect(addedText(new Date(2025, 10, 23, 9, 5).getTime(), now)).toBe('23 Nov 2025');
  });

  it('uses Arabic month names with Western digits in Arabic', () => {
    setLanguage('ar');
    const texts = [
      addedText(new Date(2026, 10, 23, 9, 5).getTime(), now),
      addedText(new Date(2026, 10, 3, 9, 5).getTime(), now),
      addedText(new Date(2025, 10, 3, 9, 5).getTime(), now),
    ];
    expect(texts[0]).toBe('09:05');
    expect(texts[1]).toBe('3 نوفمبر');
    expect(texts[2]).toBe('3 نوفمبر 2025');
    for (const t of texts) expect(t).not.toMatch(NON_WESTERN_DIGITS);
  });

  it('gives the full date and time in the tooltip, in both languages', () => {
    const at = new Date(2026, 10, 3, 9, 5).getTime();
    expect(addedTitle(at)).toBe('3 November 2026 at 09:05');
    setLanguage('ar');
    expect(addedTitle(at)).toBe('3 نوفمبر 2026 في 09:05');
    expect(addedTitle(at)).not.toMatch(NON_WESTERN_DIGITS);
  });
});

describe('column headings', () => {
  it('name every column in both languages', () => {
    expect(Object.keys(S.columns)).toEqual(['name', 'quality', 'size', 'status', 'speed', 'timeLeft', 'added']);
    expect(EN.columns.name).toBe('File name');
    setLanguage('ar');
    expect(S.columns.name).toBe('اسم الملف');
    for (const heading of Object.values(S.columns)) expect(heading).not.toBe('');
  });
});
