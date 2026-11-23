import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { qualityLabel, reasonText, statusParts, statusText } from '../../src/renderer/src/format';
import { EN, setLanguage } from '../../src/renderer/src/strings';
import { fsi } from '../../src/shared/i18n';
import type { EntryReason } from '../../src/shared/types';
import { classifyError } from '../../src/main/ytdlp/parse';
import { makeJob } from '../helpers';

const half = { bytesDone: 50, bytesTotal: 200 };

afterEach(() => setLanguage('en'));

describe('statusParts, every state in both languages', () => {
  it.each([
    [makeJob({ state: 'queued' }), ['queued'], ['في الانتظار']],
    [makeJob({ state: 'queued', reason: 'retrying (2/3)' }), ['retrying (2/3)'], ['إعادة المحاولة (2/3)']],
    [makeJob({ state: 'probing' }), ['starting…'], ['جارٍ البدء…']],
    [makeJob({ state: 'downloading', ...half, speed: 3250586, eta: 42 }), ['25%', '3.1 MB/s', '0:42'], ['25%', '3.1 MB/s', '0:42']],
    [makeJob({ state: 'downloading', ...half, speed: 0, eta: null, resumable: false }), ['25%', 'cannot resume'], ['25%', 'لا يدعم الاستئناف']],
    [makeJob({ state: 'downloading', bytesDone: 1536, bytesTotal: null, speed: 1024, eta: null }), ['1.0 KB/s'], ['1.0 KB/s']],
    [makeJob({ state: 'downloading', bytesDone: 1536, bytesTotal: null, speed: 0, eta: null }), [], []],
    [makeJob({ state: 'paused', ...half }), ['paused 25%'], [`متوقف مؤقتًا ${fsi('25%')}`]],
    [makeJob({ state: 'paused' }), ['paused'], ['متوقف مؤقتًا']],
    [makeJob({ state: 'paused', interrupted: true, bytesDone: 80, bytesTotal: 200 }), ['paused 40%', 'waiting for a check'], [`متوقف مؤقتًا ${fsi('40%')}`, 'في انتظار الفحص']],
    [makeJob({ state: 'paused', interrupted: true }), ['paused', 'waiting for a check'], ['متوقف مؤقتًا', 'في انتظار الفحص']],
    [makeJob({ state: 'merging' }), ['finishing…'], ['جارٍ الإنهاء…']],
    [makeJob({ state: 'done' }), ['done'], ['مكتمل']],
    [makeJob({ state: 'failed', reason: null }), ['failed'], ['فشل']],
    [makeJob({ state: 'failed', reason: 'disk full' }), ['failed: disk full'], [`فشل: ${fsi('القرص ممتلئ')}`]],
    [makeJob({ state: 'failed', reason: 'HTTP Error 403: Forbidden' }), ['failed: HTTP Error 403: Forbidden'], [`فشل: ${fsi('HTTP Error 403: Forbidden')}`]],
    [makeJob({ state: 'skipped', reason: null }), ['skipped'], ['تم التخطي']],
    [makeJob({ state: 'skipped', reason: 'protected' }), ['skipped: protected'], [`تم التخطي: ${fsi('محتوى محمي')}`]],
    [makeJob({ state: 'skipped', reason: 'unavailable' }), ['skipped: unavailable'], [`تم التخطي: ${fsi('غير متاح')}`]],
  ])('%#', (job, en, ar) => {
    expect(statusParts(job)).toEqual(en);
    expect(statusText(job)).toBe(en.join(' · '));
    setLanguage('ar');
    expect(statusParts(job)).toEqual(ar);
    expect(statusText(job)).toBe(ar.join(' · '));
  });

  it('keeps an unknown English reason as it came, without isolates', () => {
    const text = statusText(makeJob({ state: 'failed', reason: 'unable to download video data' }));
    expect(text).toBe('failed: unable to download video data');
    expect(text).not.toMatch(/[⁨⁩]/u);
  });

  it('keeps an unknown reason in Arabic too, isolated once', () => {
    setLanguage('ar');
    const [part] = statusParts(makeJob({ state: 'failed', reason: 'unable to download video data' }));
    expect(part).toContain('⁨unable to download video data⁩');
    expect([...(part ?? '')].filter((c) => c === '⁨')).toHaveLength(1);
  });

  it('never shows the downloaded bytes in the status', () => {
    for (const lang of ['en', 'ar'] as const) {
      setLanguage(lang);
      const parts = statusParts(makeJob({ state: 'downloading', bytesDone: 13002342, bytesTotal: null, speed: 0, eta: null }));
      expect(parts.join(' ')).not.toMatch(/12\.4|MB(?!\/s)/u);
    }
  });
});

describe('reasonText', () => {
  it('translates a known reason and keeps an unknown one', () => {
    expect(reasonText('login required')).toBe('login required');
    setLanguage('ar');
    expect(reasonText('login required')).toBe('يتطلب تسجيل الدخول');
    expect(reasonText('Login required')).toBe('Login required');
    expect(reasonText('login required ')).toBe('login required ');
  });

  it('turns a retry count into words', () => {
    expect(reasonText('retrying (2/3)')).toBe('retrying (2/3)');
    setLanguage('ar');
    expect(reasonText('retrying (2/3)')).toBe('إعادة المحاولة (2/3)');
    expect(reasonText('retrying (10/12)')).toBe('إعادة المحاولة (10/12)');
  });

  it.each(['retrying (2/x)', 'retrying (2/3) ', 'Retrying (2/3)', 'retrying 2/3', 'retrying ()', 'retrying (/3)'])('keeps %j, which is not a retry count', (r) => {
    setLanguage('ar');
    expect(reasonText(r)).toBe(r);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('keeps %j: only the dictionary own keys are reasons', (r) => {
    expect(reasonText(r)).toBe(r);
    setLanguage('ar');
    expect(reasonText(r)).toBe(r);
  });
});

describe('the reasons contract', () => {
  const keys = new Set(Object.keys(EN.reasons));

  it.each([
    ['ERROR: [youtube] abc: This video is DRM protected', 'protected'],
    ['ERROR: [youtube] abc: Sign in to confirm your age', 'login required'],
    ['ERROR: [youtube] abc: The uploader has not made this video available in your country', 'unavailable in region'],
    ['ERROR: [youtube] abc: Private video', 'private'],
    ['ERROR: [youtube] abc: Video unavailable', 'removed'],
    ['ERROR: No space left on device', 'disk full'],
    ['ERROR: unable to open for writing: Permission denied', 'cannot write to folder'],
    ['ERROR: Unsupported URL: https://example.com', 'unsupported site'],
    ['', 'download failed'],
  ])('classifyError(%j) gives %j, a key of EN.reasons', (stderr, reason) => {
    const { reason: got } = classifyError(stderr);
    expect(got).toBe(reason);
    expect(keys.has(got)).toBe(true);
  });

  it('every playlist entry reason is a key', () => {
    const entry: EntryReason[] = ['private', 'removed', 'unavailable'];
    for (const r of entry) expect(keys.has(r), r).toBe(true);
  });

  it('every reason literal written in the main process is a key', () => {
    const root = join(__dirname, '../../src/main');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    const found = new Set<string>();
    for (const f of files) {
      const src = readFileSync(join(root, f), 'utf8');
      for (const m of src.matchAll(/reason: '([^']+)'/gu)) found.add(m[1] as string);
    }
    const file = readFileSync(join(root, 'engines/file.ts'), 'utf8');
    // aria2's final errors and the service messages are reasons too, held in constants.
    for (const m of file.matchAll(/^ {2}'\d+': '([^']+)',$/gmu)) found.add(m[1] as string);
    for (const m of file.matchAll(/^const SERVICE_\w+ = '([^']+)';$/gmu)) found.add(m[1] as string);
    expect(found.size).toBeGreaterThan(10);
    expect([...found].filter((r) => !keys.has(r))).toEqual([]);
  });
});

describe('qualityLabel', () => {
  it('is empty for a file in both languages', () => {
    const file = makeJob({ kind: 'file', quality: null, baseName: null, bytesTotal: 18874368 });
    expect(qualityLabel(file)).toBe('');
    setLanguage('ar');
    expect(qualityLabel(file)).toBe('');
  });

  it('names "best" in the language in use and keeps heights and formats as they are', () => {
    setLanguage('ar');
    expect(qualityLabel(makeJob({ quality: { kind: 'best' } }))).toBe('الأفضل');
    expect(qualityLabel(makeJob({ quality: { kind: 'max', height: 720 } }))).toBe('≤720p');
    expect(qualityLabel(makeJob({ quality: { kind: 'audio', format: 'mp3' } }))).toBe('mp3');
    expect(qualityLabel(makeJob({ actualHeight: 1080 }))).toBe('1080p');
  });
});
