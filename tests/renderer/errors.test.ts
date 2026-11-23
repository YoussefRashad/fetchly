// Task D, item 2: the window turns the error codes of the main process into text of the language in use
// (frozen plan docs/plans/2026-11-23-d-housekeeping.md, "Window rules" and critique pass 2, amendments 1, 3 and 8).
//
// Fields enumerated (src/renderer/src/errors.ts): errorText(ErrorInfo { error, code?, detail? }),
// statusMessage(error variant of EngineStatus { message, code?, detail? } or ServerStatus { message, code?, port? }),
// saveErrorText(text), noticeText(Notice = string | ErrorInfo), settingsOutcome(Result<Settings>).
// "The code is unknown, so the English text is shown" is tested for: absent; inconsistent (not a string, a prototype
// name, a name of `errors` that is not a code, a detail code without a usable detail, a port code in errorText,
// portUnusable without a whole-number port, linkProblem on a status); boundary (empty detail, stray detail on a fixed
// code, a save error that is exactly the prefix, an error or message that is not a string).
import { afterEach, describe, expect, it } from 'vitest';
import { errorText, noticeText, saveErrorText, settingsOutcome, statusMessage, type Notice } from '../../src/renderer/src/errors';
import { S, setLanguage } from '../../src/renderer/src/strings';
import { SAVE_FAILED_PREFIX } from '../../src/shared/errors';
import { fsi } from '../../src/shared/i18n';
import type { ErrorInfo, Result, Settings } from '../../src/shared/types';
import { DETAIL, EXTRA, FIXED, NEW_REASONS, PORT } from '../errorTable';
import { makeSettings } from '../helpers';

afterEach(() => setLanguage('en'));

/** An ErrorInfo or a status as a hostile or old sender could build it: any field may be of any type. */
const info = (o: Record<string, unknown>): ErrorInfo => o as unknown as ErrorInfo;
type StatusIn = Parameters<typeof statusMessage>[0];
const status = (o: Record<string, unknown>): StatusIn => ({ state: 'error', message: 'MSG-AS-SENT', ...o }) as unknown as StatusIn;

/** The "other" text: what the window shows when it has no translation (English as sent; Arabic inside one isolate). */
const other = (text: string): [string, string] => [text, fsi(text)];

/** Runs `read` in English, then in Arabic, and returns both texts. */
function both(read: () => string): [string, string] {
  setLanguage('en');
  const en = read();
  setLanguage('ar');
  const ar = read();
  return [en, ar];
}

const count = (text: string, part: string): number => text.split(part).length - 1;

/** A code field that is not a code: [label, value]. A prototype name, a key of `errors` that is not a code, a non-string. */
const NOT_CODES: [string, unknown][] = [
  ['a number', 5],
  ['null', null],
  ['true', true],
  ['an object that prints as a code', { toString: () => 'badRequest' }],
  ['an array that prints as a code', ['badRequest']],
  ['the empty string', ''],
  ['constructor', 'constructor'],
  ['__proto__', '__proto__'],
  ['toString', 'toString'],
  ['hasOwnProperty', 'hasOwnProperty'],
  ['a name that is no code', 'noSuchCode'],
  ['a code in capitals', 'BADREQUEST'],
  ['a code with a trailing space', 'badRequest '],
  ['other (a key of errors, not a code)', 'other'],
  ['saveFailed (a key of errors, not a code)', 'saveFailed'],
  ['serverAnswered (a key of errors, not a code)', 'serverAnswered'],
];

/** A detail that is not a string. */
const NOT_STRINGS: [string, unknown][] = [
  ['undefined', undefined],
  ['null', null],
  ['a number', 5],
  ['an object', {}],
  ['an array of text', ['x']],
  ['true', true],
];

describe('errorText: a fixed code', () => {
  it.each(FIXED)('%s: the text of the language in use, whatever `error` says', (code, en, ar) => {
    const sent = info({ error: 'whatever main sent', code });
    expect(errorText(sent)).toBe(en);
    setLanguage('ar');
    expect(errorText(sent)).toBe(ar);
  });

  it.each(FIXED)('%s: a stray detail is ignored', (code, en, ar) => {
    const sent = info({ error: 'x', code, detail: 'STRAY-DETAIL' });
    expect(errorText(sent)).toBe(en);
    setLanguage('ar');
    expect(errorText(sent)).toBe(ar);
    expect(ar).not.toContain('STRAY-DETAIL');
  });

  it.each(FIXED)('%s: the text does not depend on `error` being a string', (code, en, ar) => {
    const sent = info({ code });
    expect(errorText(sent)).toBe(en);
    setLanguage('ar');
    expect(errorText(sent)).toBe(ar);
  });
});

describe('errorText: a detail code', () => {
  it.each(DETAIL)('%s: the detail goes into the text, whatever `error` says', (code, en, ar) => {
    const sent = info({ error: 'whatever main sent', code, detail: 'D-1' });
    expect(errorText(sent)).toBe(en('D-1'));
    setLanguage('ar');
    expect(errorText(sent)).toBe(ar('D-1'));
  });

  it.each(DETAIL)('%s: an empty detail is valid and translated', (code, en, ar) => {
    const sent = info({ error: 'x', code, detail: '' });
    expect(errorText(sent)).toBe(en(''));
    setLanguage('ar');
    expect(errorText(sent)).toBe(ar(''));
  });

  it.each(DETAIL)('%s: the detail is kept as it came', (code, en, ar) => {
    const raw = 'EACCES: C:\\Users\\a b\\x.mp4  (two spaces)\nsecond line';
    const [inEn, inAr] = both(() => errorText(info({ error: 'x', code, detail: raw })));
    expect(inEn).toBe(en(raw));
    expect(inAr).toBe(ar(raw));
  });

  describe.each(DETAIL)('%s without a usable detail shows the English text as sent', (code) => {
    it.each(NOT_STRINGS)('detail is %s', (_name, detail) => {
      const [en, ar] = both(() => errorText(info({ error: 'TEXT-AS-SENT', code, detail })));
      expect([en, ar]).toEqual(other('TEXT-AS-SENT'));
    });

    it('detail is missing altogether', () => {
      const [en, ar] = both(() => errorText(info({ error: 'TEXT-AS-SENT', code })));
      expect([en, ar]).toEqual(other('TEXT-AS-SENT'));
    });
  });
});

describe('errorText: a port code', () => {
  it.each(PORT)('%s: an ErrorInfo has no port, so the text as sent shows', (code) => {
    const [en, ar] = both(() => errorText(info({ error: 'port 38917 cannot be used', code })));
    expect([en, ar]).toEqual(other('port 38917 cannot be used'));
  });

  it.each(PORT)('%s: also with a string detail, and also with a port field', (code) => {
    const [en, ar] = both(() => errorText(info({ error: 'AS-SENT', code, detail: '38917', port: 38917 })));
    expect([en, ar]).toEqual(other('AS-SENT'));
  });
});

describe('errorText: the code is unknown, so the text as sent shows (the English text; Arabic inside one isolate)', () => {
  it('no code at all', () => {
    expect(both(() => errorText(info({ error: 'TEXT-AS-SENT' })))).toEqual(other('TEXT-AS-SENT'));
  });

  it('a code that is undefined', () => {
    expect(both(() => errorText(info({ error: 'TEXT-AS-SENT', code: undefined })))).toEqual(other('TEXT-AS-SENT'));
  });

  it.each(NOT_CODES)('code is %s', (_name, code) => {
    expect(both(() => errorText(info({ error: 'TEXT-AS-SENT', code })))).toEqual(other('TEXT-AS-SENT'));
  });

  it.each(NOT_CODES)('code is %s, with a detail next to it: the detail is not used', (_name, code) => {
    expect(both(() => errorText(info({ error: 'TEXT-AS-SENT', code, detail: 'DETAIL-NOT-SHOWN' })))).toEqual(other('TEXT-AS-SENT'));
  });

  it('the Arabic fallback sits inside exactly one isolate', () => {
    setLanguage('ar');
    const text = errorText(info({ error: 'a raw English message' }));
    expect(count(text, '⁨')).toBe(1);
    expect(count(text, '⁩')).toBe(1);
    expect(text).toBe(fsi('a raw English message'));
  });
});

describe('errorText: an error that is not a string is empty text, never the word "undefined"', () => {
  it.each(NOT_STRINGS)('error is %s, no code', (_name, error) => {
    const [en, ar] = both(() => errorText(info({ error })));
    expect([en, ar]).toEqual(other(''));
    for (const text of [en, ar]) expect(text).not.toMatch(/undefined|null|\[object|true|5/u);
  });

  it('error is missing altogether', () => {
    expect(both(() => errorText(info({})))).toEqual(other(''));
  });

  it.each(NOT_STRINGS)('error is %s, with a code that has a translation: the translation still shows', (_name, error) => {
    const [fixed] = FIXED;
    const [detail] = DETAIL;
    if (!fixed || !detail) throw new Error('the code table is empty');
    expect(both(() => errorText(info({ error, code: fixed[0] })))).toEqual([fixed[1], fixed[2]]);
    expect(both(() => errorText(info({ error, code: detail[0], detail: 'D-1' })))).toEqual([detail[1]('D-1'), detail[2]('D-1')]);
  });

  it.each(NOT_STRINGS)('error is %s, with linkProblem: empty text', (_name, error) => {
    expect(both(() => errorText(info({ error, code: 'linkProblem' })))).toEqual(other(''));
  });
});

describe('errorText: linkProblem carries a reason token', () => {
  it.each(NEW_REASONS)('the new reason %j is translated', (reason, ar) => {
    const [en, inAr] = both(() => errorText(info({ error: reason, code: 'linkProblem' })));
    expect(en).toBe(reason);
    expect(inAr).toBe(ar);
  });

  it.each([
    ['timed out reading the link', 'انتهت مهلة قراءة الرابط'],
    ['yt-dlp is not installed', 'الأداة yt-dlp غير مثبّتة'],
    ['could not read the video information', 'تعذّرت قراءة معلومات الفيديو'],
    ['private', 'خاص'],
    ['login required', 'يتطلب تسجيل الدخول'],
    ['download failed', 'فشل التنزيل'],
  ])('a known reason %j', (reason, ar) => {
    expect(both(() => errorText(info({ error: reason, code: 'linkProblem' })))).toEqual([reason, ar]);
  });

  it('a retry count is turned into words', () => {
    expect(both(() => errorText(info({ error: 'retrying (2/3)', code: 'linkProblem' })))).toEqual(['retrying (2/3)', 'إعادة المحاولة (2/3)']);
  });

  it('"server answered 503" is turned into words, the number inside an isolate', () => {
    const [en, ar] = both(() => errorText(info({ error: 'server answered 503', code: 'linkProblem' })));
    expect(en).toBe('server answered 503');
    expect(ar).toBe(`ردّ الخادم بالرمز ${fsi('503')}`);
  });

  it('the digits of "server answered" stay a text: English equals the error, leading zeros included (amendment 8)', () => {
    expect(errorText(info({ error: 'server answered 007', code: 'linkProblem' }))).toBe('server answered 007');
    setLanguage('ar');
    expect(errorText(info({ error: 'server answered 007', code: 'linkProblem' }))).toBe(`ردّ الخادم بالرمز ${fsi('007')}`);
  });

  it('an unknown text is shown as it came, inside one isolate in Arabic', () => {
    const [en, ar] = both(() => errorText(info({ error: 'something no table knows', code: 'linkProblem' })));
    expect(en).toBe('something no table knows');
    expect(ar).toBe(fsi('something no table knows'));
    expect(count(ar, '⁨')).toBe(1);
  });

  it.each([
    'server answered 503 ',
    ' server answered 503',
    'Server answered 503',
    'server answered ',
    'server answered',
    'server answered 50x',
    'server answered -1',
    'server answered 5 0',
    'server answered 503\n',
    'the server answered 503',
    'server answered 503 and more',
  ])('%j is not a "server answered" reason: shown as it came', (text) => {
    expect(both(() => errorText(info({ error: text, code: 'linkProblem' })))).toEqual(other(text));
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('%j is not a reason: only the dictionary own keys are', (text) => {
    expect(both(() => errorText(info({ error: text, code: 'linkProblem' })))).toEqual(other(text));
  });

  it.each(['retrying (2/x)', 'retrying (2/3) ', 'Retrying (2/3)', 'retrying 2/3'])('%j is not a retry count: shown as it came', (text) => {
    expect(both(() => errorText(info({ error: text, code: 'linkProblem' })))).toEqual(other(text));
  });

  it('a detail next to linkProblem is not used', () => {
    expect(both(() => errorText(info({ error: 'private', code: 'linkProblem', detail: 'DETAIL-NOT-SHOWN' })))).toEqual(['private', 'خاص']);
  });
});

describe('statusMessage', () => {
  it.each(FIXED)('%s: the fixed text, whatever `message` says', (code, en, ar) => {
    const sent = status({ code });
    expect(statusMessage(sent)).toBe(en);
    setLanguage('ar');
    expect(statusMessage(sent)).toBe(ar);
  });

  it.each(FIXED)('%s: a stray detail or port is ignored', (code, en, ar) => {
    const sent = status({ code, detail: 'STRAY-DETAIL', port: 38917 });
    expect(both(() => statusMessage(sent))).toEqual([en, ar]);
  });

  it.each(DETAIL)('%s: the detail goes into the text', (code, en, ar) => {
    const sent = status({ code, detail: 'spawn aria2c ENOENT' });
    expect(both(() => statusMessage(sent))).toEqual([en('spawn aria2c ENOENT'), ar('spawn aria2c ENOENT')]);
  });

  it.each(DETAIL)('%s: an empty detail is valid and translated', (code, en, ar) => {
    expect(both(() => statusMessage(status({ code, detail: '' })))).toEqual([en(''), ar('')]);
  });

  describe.each(DETAIL)('%s without a usable detail shows the message as sent', (code) => {
    it.each(NOT_STRINGS)('detail is %s', (_name, detail) => {
      expect(both(() => statusMessage(status({ code, detail })))).toEqual(other('MSG-AS-SENT'));
    });

    it('detail is missing altogether', () => {
      expect(both(() => statusMessage(status({ code })))).toEqual(other('MSG-AS-SENT'));
    });
  });

  describe.each(PORT)('%s', (code, en, ar) => {
    it.each([1024, 38917, 65535])('port %i is translated, the port inside one isolate in Arabic', (port) => {
      const [inEn, inAr] = both(() => statusMessage(status({ code, port })));
      expect(inEn).toBe(en(port));
      expect(inAr).toBe(ar(port));
      expect(count(inAr, fsi(String(port)))).toBe(1);
      expect(count(inAr, String(port))).toBe(1);
    });

    it.each<[string, unknown]>([
      ['missing', undefined],
      ['null', null],
      ['text', '38917'],
      ['a fraction', 38917.5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['true', true],
      ['an array of a whole number', [38917]],
    ])('a port that is %s shows the message as sent', (_name, port) => {
      expect(both(() => statusMessage(status({ code, port })))).toEqual(other('MSG-AS-SENT'));
    });

    it('a text detail does not stand in for the port', () => {
      expect(both(() => statusMessage(status({ code, detail: '38917' })))).toEqual(other('MSG-AS-SENT'));
    });
  });

  it('a reason code on a status gives the message as sent, not a reason translation (amendment 3)', () => {
    expect(both(() => statusMessage(status({ code: 'linkProblem', message: 'timed out reading the link' })))).toEqual(
      other('timed out reading the link'),
    );
    expect(both(() => statusMessage(status({ code: 'linkProblem', message: 'server answered 503' })))).toEqual(other('server answered 503'));
  });

  it('no code: the message as sent', () => {
    expect(both(() => statusMessage(status({})))).toEqual(other('MSG-AS-SENT'));
    expect(both(() => statusMessage(status({ code: undefined })))).toEqual(other('MSG-AS-SENT'));
  });

  it.each(NOT_CODES)('code is %s: the message as sent', (_name, code) => {
    expect(both(() => statusMessage(status({ code, detail: 'DETAIL-NOT-SHOWN', port: 38917 })))).toEqual(other('MSG-AS-SENT'));
  });

  it.each(NOT_STRINGS)('message is %s: empty text, never "undefined"', (_name, message) => {
    const [en, ar] = both(() => statusMessage(status({ message })));
    expect([en, ar]).toEqual(other(''));
    for (const text of [en, ar]) expect(text).not.toMatch(/undefined|null|\[object|true|5/u);
  });

  it('works for an engine status and a server status alike', () => {
    expect(statusMessage({ state: 'error', message: 'The file download service stopped', code: 'fileServiceStopped' })).toBe(
      'The file download service stopped',
    );
    expect(statusMessage({ state: 'error', message: 'x', code: 'serverStopped' })).toBe('The browser connection is stopped');
  });
});

describe('saveErrorText', () => {
  it('a text that starts with the prefix gives the translated sentence with the rest as its detail', () => {
    const text = `${SAVE_FAILED_PREFIX}EACCES: permission denied`;
    expect(both(() => saveErrorText(text))).toEqual([text, `تعذّر حفظ قائمة التنزيلات: ${fsi('EACCES: permission denied')}`]);
  });

  it('English equals the text it was given', () => {
    expect(saveErrorText('could not save the download list: disk full')).toBe('could not save the download list: disk full');
  });

  it('a text that is exactly the prefix gives an empty detail', () => {
    const [en, ar] = both(() => saveErrorText(SAVE_FAILED_PREFIX));
    expect(en).toBe(SAVE_FAILED_PREFIX);
    expect(ar).toBe(`تعذّر حفظ قائمة التنزيلات: ${fsi('')}`);
  });

  it('the prefix is the English start of the sentence, with its colon and space', () => {
    expect(SAVE_FAILED_PREFIX).toBe('could not save the download list: ');
  });

  it.each([
    ['no prefix', 'disk full'],
    ['an empty text', ''],
    ['the prefix without its trailing space', 'could not save the download list:'],
    ['the prefix in capitals', 'Could not save the download list: disk full'],
    ['the prefix in the middle', 'x could not save the download list: disk full'],
    ['a leading space', ' could not save the download list: disk full'],
  ])('%s: the text as sent', (_name, text) => {
    expect(both(() => saveErrorText(text))).toEqual(other(text));
  });

  it('the detail of a save error is kept as it came, the isolate around it only once', () => {
    setLanguage('ar');
    const text = saveErrorText(`${SAVE_FAILED_PREFIX}C:\\Users\\a b\\jobs.json: EBUSY`);
    expect(count(text, '⁨')).toBe(1);
    expect(count(text, '⁩')).toBe(1);
    expect(text).toContain(fsi('C:\\Users\\a b\\jobs.json: EBUSY'));
  });
});

describe('noticeText', () => {
  it('a string is returned as it is, in both languages (the startup notice is worded by main)', () => {
    const text = 'The saved download list could not be read; a copy was kept as jobs.json.corrupt-1';
    expect(both(() => noticeText(text))).toEqual([text, text]);
  });

  it('an empty string stays empty', () => {
    expect(both(() => noticeText(''))).toEqual(['', '']);
  });

  it.each(FIXED)('an ErrorInfo with the code %s goes through errorText', (code, en, ar) => {
    expect(both(() => noticeText(info({ error: 'x', code })))).toEqual([en, ar]);
  });

  it('an ErrorInfo without a code shows its text as sent', () => {
    expect(both(() => noticeText({ error: 'TEXT-AS-SENT' }))).toEqual(other('TEXT-AS-SENT'));
  });

  it('a notice kept as a value is translated when it is rendered: setLanguage moves it to Arabic', () => {
    const kept: Notice = { error: 'English text main sent', code: 'savedNotApplied', detail: 'the queue refused the settings' };
    setLanguage('en');
    expect(noticeText(kept)).toBe('Settings were saved, but the running downloads did not take them: the queue refused the settings. Save again, or restart Fetchly.');
    setLanguage('ar');
    expect(noticeText(kept)).toBe(`حُفظت الإعدادات، لكن التنزيلات الجارية لم تأخذ بها: ${fsi('the queue refused the settings')}. احفظ مرة أخرى، أو أعد تشغيل Fetchly.`);
    setLanguage('en');
    expect(noticeText(kept)).toContain('Settings were saved, but');
  });
});

describe('settingsOutcome', () => {
  const next: Settings = makeSettings({ serverPort: 40000 });

  it('ok: the saved settings, no notice, no failure', () => {
    const res: Result<Settings> = { ok: true, value: next };
    const out = settingsOutcome(res);
    expect(out).toEqual({ saved: next, notice: null, failure: null });
    expect(out.saved).toBe(next);
  });

  it('ok with a warning: the warning is the notice', () => {
    const warning: ErrorInfo = { error: 'English text', code: 'savedNotApplied', detail: 'the queue refused the settings' };
    const out = settingsOutcome({ ok: true, value: next, warning });
    expect(out).toEqual({ saved: next, notice: warning, failure: null });
  });

  it('failure: nothing saved, no notice, and the failure keeps error, code and detail', () => {
    const out = settingsOutcome({ ok: false, error: 'Port must be a whole number from 1024 to 65535', code: 'portInvalid', detail: 'D-1' });
    expect(out).toEqual({ saved: null, notice: null, failure: { error: 'Port must be a whole number from 1024 to 65535', code: 'portInvalid', detail: 'D-1' } });
  });

  it('failure without a code or a detail', () => {
    const out = settingsOutcome({ ok: false, error: 'some text' });
    expect(out).toEqual({ saved: null, notice: null, failure: { error: 'some text' } });
    expect(out.failure?.code).toBeUndefined();
  });

  it('the failure is named `failure`, not `error` (amendment 1): the outcome has exactly saved, notice and failure', () => {
    expect(Object.keys(settingsOutcome({ ok: true, value: next })).sort()).toEqual(['failure', 'notice', 'saved']);
    expect(Object.keys(settingsOutcome({ ok: false, error: 'x' })).sort()).toEqual(['failure', 'notice', 'saved']);
  });

  it('a failure goes through errorText to the dialog line, in the language in use', () => {
    const out = settingsOutcome({ ok: false, error: 'x', code: 'portChangeDeclined' });
    if (!out.failure) throw new Error('no failure');
    expect(both(() => errorText(out.failure as ErrorInfo))).toEqual(['Settings were not saved: the port was not changed', 'لم تُحفظ الإعدادات: لم يتغيّر المنفذ']);
  });
});

describe('every detail and port sits inside exactly one isolate in Arabic', () => {
  it.each(DETAIL)('%s', (code) => {
    setLanguage('ar');
    const text = errorText(info({ error: 'x', code, detail: 'ZZ-DETAIL-1' }));
    expect(count(text, fsi('ZZ-DETAIL-1'))).toBe(1);
    expect(count(text, 'ZZ-DETAIL-1')).toBe(1);
    expect(count(text, '⁨')).toBe(1);
    expect(count(text, '⁩')).toBe(1);
  });

  it.each(PORT)('%s', (code) => {
    setLanguage('ar');
    const text = statusMessage(status({ code, port: 38917 }));
    expect(count(text, fsi('38917'))).toBe(1);
    expect(count(text, '38917')).toBe(1);
  });

  it('the save-error detail, the "other" text and the server-answered number too', () => {
    setLanguage('ar');
    expect(count(saveErrorText(`${SAVE_FAILED_PREFIX}ZZ-SAVE-1`), fsi('ZZ-SAVE-1'))).toBe(1);
    expect(count(errorText(info({ error: 'ZZ-OTHER-1' })), fsi('ZZ-OTHER-1'))).toBe(1);
    expect(count(errorText(info({ error: 'server answered 503', code: 'linkProblem' })), fsi('503'))).toBe(1);
  });
});

describe('in English, errorText equals the English `error` of every coded failure', () => {
  it.each(FIXED)('%s', (code, en) => {
    expect(errorText(info({ error: en, code }))).toBe(en);
  });

  it.each(DETAIL)('%s', (code, en) => {
    const raw = 'something with: colons, “quotes” and C:\\paths';
    expect(errorText(info({ error: en(raw), code, detail: raw }))).toBe(en(raw));
  });

  it.each(['timed out reading the link', 'retrying (2/3)', 'server answered 503', 'server answered 007', 'a text no table knows'])(
    'linkProblem with %j',
    (reason) => {
      expect(errorText(info({ error: reason, code: 'linkProblem' }))).toBe(reason);
    },
  );

  it.each(PORT)('%s, as a status message', (code, en) => {
    expect(statusMessage(status({ code, message: en(38917), port: 38917 }))).toBe(en(38917));
  });

  it.each(FIXED)('%s (fixed), as a status message', (code, en) => {
    expect(statusMessage(status({ code, message: en }))).toBe(en);
  });

  it.each(DETAIL)('%s, as a status message', (code, en) => {
    expect(statusMessage(status({ code, message: en('spawn aria2c ENOENT'), detail: 'spawn aria2c ENOENT' }))).toBe(en('spawn aria2c ENOENT'));
  });
});

describe('the strings it reads', () => {
  it('S.errors holds the three entries that are not codes', () => {
    expect(S.errors.other('x')).toBe(EXTRA.other[0]('x'));
    expect(S.errors.saveFailed('x')).toBe(EXTRA.saveFailed[0]('x'));
    expect(S.errors.serverAnswered('007')).toBe(EXTRA.serverAnswered[0]('007'));
    setLanguage('ar');
    expect(S.errors.other('x')).toBe(EXTRA.other[1]('x'));
    expect(S.errors.saveFailed('x')).toBe(EXTRA.saveFailed[1]('x'));
    expect(S.errors.serverAnswered('007')).toBe(EXTRA.serverAnswered[1]('007'));
  });

  it('errorText reads S at every call, so a language change takes effect at once', () => {
    const sent = info({ error: 'x', code: 'badRequest' });
    const first = errorText(sent);
    setLanguage('ar');
    const second = errorText(sent);
    setLanguage('en');
    expect([first, second, errorText(sent)]).toEqual(['That request is not valid', 'هذا الطلب غير صالح', 'That request is not valid']);
  });
});
