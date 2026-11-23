import { describe, expect, it } from 'vitest';
import { shellStrings } from '../src/main/shellStrings';
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

describe('finishedMessage and trayTooltip in Arabic', () => {
  const isolated = (t: string) => `⁨${t}⁩`;

  it('names a finished, failed or skipped download, with the title isolated', () => {
    expect(finishedMessage({ kind: 'job', title: 'Talk', failed: 0, skipped: 0 }, 'ar')).toEqual({ title: 'اكتمل التنزيل', body: isolated('Talk') });
    expect(finishedMessage({ kind: 'job', title: 'Talk', failed: 1, skipped: 0 }, 'ar')).toEqual({ title: 'فشل التنزيل', body: isolated('Talk') });
    expect(finishedMessage({ kind: 'job', title: 'Talk', failed: 0, skipped: 1 }, 'ar')).toEqual({ title: 'تم تخطي التنزيل', body: isolated('Talk') });
  });

  it('adds only the playlist counts that are not zero', () => {
    expect(finishedMessage({ kind: 'group', title: 'Course', failed: 0, skipped: 0 }, 'ar')).toEqual({ title: 'اكتملت قائمة التشغيل', body: isolated('Course') });
    expect(finishedMessage({ kind: 'group', title: 'Course', failed: 2, skipped: 1 }, 'ar').body).toBe(`${isolated('Course')} · فشل 2 · تم تخطي 1`);
  });

  it('counts the running downloads', () => {
    expect(trayTooltip({ jobs: [], groups: [] }, 'ar')).toBe('Fetchly');
    expect(trayTooltip({ jobs: [makeJob({ state: 'downloading' }), makeJob({ state: 'probing' })], groups: [] }, 'ar')).toBe('Fetchly · 2 قيد التنزيل');
  });

  it('is English when asked for English, and by default', () => {
    const e = { kind: 'group', title: 'Course', failed: 1, skipped: 0 } as const;
    expect(finishedMessage(e, 'en')).toEqual(finishedMessage(e));
    expect(finishedMessage(e)).toEqual({ title: 'Playlist finished', body: 'Course · 1 failed' });
    const s = { jobs: [makeJob({ state: 'downloading' })], groups: [] };
    expect(trayTooltip(s, 'en')).toBe(trayTooltip(s));
    expect(trayTooltip(s)).toBe('Fetchly · 1 downloading');
  });
});

describe('shellStrings', () => {
  const path = 'C:\\Users\\me\\AppData\\Roaming\\fetchly\\jobs.json.corrupt-1';

  it('words the start-up notice as before in English', () => {
    expect(shellStrings('en').corruptNotice(path)).toBe(`The saved download list could not be read and was set aside as ${path}. The list starts empty.`);
  });

  it('isolates the path and the file name inside Arabic sentences', () => {
    expect(shellStrings('ar').corruptNotice(path)).toContain(`\u2068${path}\u2069`);
    expect(shellStrings('ar').runnableMessage('setup.exe')).toContain('\u2068setup.exe\u2069');
    expect(shellStrings('en').runnableMessage('setup.exe')).toBe('"setup.exe" can run a program or change this PC when it is opened.');
  });

  it('words the pairing-file notice as A1 did in English, and isolates its path in Arabic', () => {
    const aside = 'C:\\Users\\me\\AppData\\Roaming\\fetchly\\pairing.json.corrupt-1';
    expect(shellStrings('en').pairingNotice(aside)).toBe(
      `The list of paired browsers could not be read and was set aside as ${aside}. Pair your browsers again.`,
    );
    expect(shellStrings('en').pairingNotice(null)).toBe('The list of paired browsers could not be read. Pair your browsers again.');
    expect(shellStrings('ar').pairingNotice(aside)).toContain(`\u2068${aside}\u2069`);
    expect(shellStrings('ar').pairingNotice(null)).not.toContain('\u2068');
  });

  it('words the port-change dialog as A1 did in English, with one or several browsers', () => {
    const en = shellStrings('en');
    expect([en.portChangeTitle, en.portChangeDetail, en.portChangeConfirm, en.portChangeCancel]).toEqual([
      'Change the port?',
      'Each browser has to be paired again on the new port.',
      'Change port',
      'Cancel',
    ]);
    expect(en.portChangeMessage(1)).toBe('Changing the port removes the paired browser.');
    expect(en.portChangeMessage(3)).toBe('Changing the port removes all 3 paired browsers.');
    const ar = shellStrings('ar');
    expect(ar.portChangeMessage(1)).not.toBe(ar.portChangeMessage(3));
    expect(ar.portChangeMessage(3)).toContain('3');
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
