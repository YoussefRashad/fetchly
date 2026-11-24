/**
 * Task 2: extension/src/lib/strings.ts (plan section 5, "Strings"; R2-2).
 *
 * Enumeration: the 27 keys of the section 5 table and amendment 2, in table order. `AR` has exactly `EN`'s keys, every value
 * is non-empty, and each value equals its table row. `badInput` carries its example code inside fsi() (R2-2).
 * `pick(locale)` goes through `resolveLang('system', locale)`.
 *
 * Amendment 2 (docs/plans/2026-11-23-phase2-a2-amendment-2.md): AM2-4 changes the text of `mismatch` (AM2-4); AM2-1 adds the key
 * `operationRunning` (27th). Both Arabic texts are PROVISIONAL for the owner. Arabic uses «تنزيل», never «تحميل», for download,
 * and Western digits.
 */
import { describe, expect, it } from 'vitest';
import { fsi, resolveLang } from '../../src/shared/i18n';
import { AR, EN, pick } from '../../extension/src/lib/strings';

/** key: [English, Arabic], copied from plan section 5; `mismatch` and `operationRunning` are the rows of amendment 2. */
const TABLE: Record<string, [string, string]> = {
  checking: ['Checking…', 'جارٍ التحقق…'],
  notPaired: ['Not paired', 'غير مربوط'],
  notPairedHint: ['In Fetchly, open Settings, press Pair a browser, then type the code here.', 'في Fetchly افتح الإعدادات واضغط «ربط متصفح»، ثم اكتب الرمز هنا.'],
  appNotRunning: ['Fetchly is not running', 'Fetchly لا يعمل'],
  appNotRunningHint: ['Start Fetchly. If you changed its port, pair again.', 'شغّل Fetchly. إذا غيّرت المنفذ، اربط من جديد.'],
  wrongProgram: ['Another program uses this port', 'برنامج آخر يستخدم هذا المنفذ'],
  connected: ['Connected', 'متصل'],
  version: ['Fetchly version', 'إصدار Fetchly'],
  rateLimited: ['Fetchly is busy. Try again in a minute.', 'Fetchly مشغول. حاول مرة أخرى بعد دقيقة.'],
  busy: ['Fetchly is showing another link', 'Fetchly يعرض رابطًا آخر'],
  appError: ['Fetchly reported an error', 'Fetchly أبلغ عن خطأ'],
  mismatch: ['This extension and Fetchly could not communicate. Check that both are up to date.', 'تعذّر الاتصال بين هذه الإضافة و Fetchly. تأكد من أنهما بآخر إصدار.'],
  slow: ['That took too long. Press Check again.', 'استغرق ذلك وقتًا طويلًا. اضغط «تحقق مرة أخرى».'],
  storageBlocked: ['This browser cannot keep the pairing safely', 'هذا المتصفح لا يستطيع حفظ الربط بأمان'],
  storageFailed: ['The pairing could not be saved. Pair again.', 'تعذّر حفظ الربط. اربط من جديد.'],
  interrupted: [
    'No answer from the extension. If you were pairing, pair again, then remove the extra browser in Fetchly Settings.',
    'لا رد من الإضافة. إذا كنت تربط، اربط من جديد ثم احذف المتصفح الزائد من إعدادات Fetchly.',
  ],
  badInput: [`That is not a pairing code. It looks like ${fsi('38917-ABCD2345')}.`, `هذا ليس رمز ربط. شكله مثل ${fsi('38917-ABCD2345')}.`],
  wrongCode: ['Wrong code. Check it and try again.', 'الرمز غير صحيح. راجعه وحاول مرة أخرى.'],
  pairingClosed: ['No code is open in Fetchly, or it expired. Press Pair a browser again.', 'لا يوجد رمز مفتوح في Fetchly أو انتهت صلاحيته. اضغط «ربط متصفح» من جديد.'],
  operationRunning: ['Another operation is running. Try again.', 'عملية أخرى قيد التنفيذ. حاول مرة أخرى.'],
  unpairedLocalOnly: ['Removed here. If Fetchly still lists this browser, unpair it in Settings.', 'حُذف هنا. إذا ظل هذا المتصفح في قائمة Fetchly، ألغِ ربطه من الإعدادات.'],
  codeLabel: ['Pairing code', 'رمز الربط'],
  nameLabel: ['Browser name', 'اسم المتصفح'],
  pairButton: ['Pair', 'ربط'],
  pairAgain: ['Pair again', 'ربط من جديد'],
  checkAgain: ['Check again', 'تحقق مرة أخرى'],
  unpair: ['Unpair', 'إلغاء الربط'],
};
const KEYS = Object.keys(TABLE);

describe('strings: EN and AR (section 5)', () => {
  it('the table in this spec has the 27 keys of the plan and amendment 2', () => {
    expect(KEYS).toHaveLength(27);
  });

  it('amendment 2: `operationRunning` is a key of both tables, and `Strings` has no other new key', () => {
    expect(Object.keys(EN)).toContain('operationRunning');
    expect(Object.keys(AR)).toContain('operationRunning');
    expect(Object.keys(EN)).toHaveLength(27);
    expect(Object.keys(AR)).toHaveLength(27);
  });

  it('EN has exactly the keys of the section 5 table', () => {
    expect(Object.keys(EN).sort()).toEqual([...KEYS].sort());
  });

  it('AR has exactly EN\'s key set', () => {
    expect(Object.keys(AR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('every value, in both languages, is a non-empty string', () => {
    for (const k of KEYS) {
      for (const table of [EN, AR] as Record<string, unknown>[]) {
        const v = table[k];
        expect(typeof v, k).toBe('string');
        expect((v as string).trim().length, k).toBeGreaterThan(0);
      }
    }
  });

  it.each(KEYS)('%s: English and Arabic equal their section 5 row', (key) => {
    const row = TABLE[key];
    expect(row).toBeDefined();
    expect((EN as Record<string, string>)[key]).toBe(row?.[0]);
    expect((AR as Record<string, string>)[key]).toBe(row?.[1]);
  });

  it('the Arabic table is not the English one, key by key (no key was left untranslated)', () => {
    for (const k of KEYS) {
      if (k === 'busy' || k === 'checking') continue;
      expect((AR as Record<string, string>)[k], k).not.toBe((EN as Record<string, string>)[k]);
    }
    expect(AR.checking).not.toBe(EN.checking);
    expect(AR.busy).not.toBe(EN.busy);
  });

  it('R2-2: the badInput example code is wrapped in the isolate characters in both languages', () => {
    const iso = `⁨${'38917-ABCD2345'}⁩`;
    expect(iso).toBe(fsi('38917-ABCD2345'));
    expect(EN.badInput).toContain(iso);
    expect(AR.badInput).toContain(iso);
    // Exactly one isolate pair, around the example, and the sentence ends after it.
    for (const s of [EN.badInput, AR.badInput]) {
      expect(s.split('⁨')).toHaveLength(2);
      expect(s.split('⁩')).toHaveLength(2);
      expect(s.endsWith(`${iso}.`)).toBe(true);
    }
  });

  it('AM2-4: the old `mismatch` and the Arabic wording rules: no old text, no «تحميل», no Arabic-Indic digits in any Arabic string', () => {
    expect(EN.mismatch).not.toContain('do not match');
    expect(EN.mismatch).not.toContain('Update both');
    expect(AR.mismatch).not.toContain('غير متوافقين');
    expect(AR.mismatch).not.toContain('حدّثهما');
    for (const k of KEYS) {
      const v = (AR as Record<string, string>)[k] ?? '';
      expect(v, k).not.toContain('تحميل');
      expect(v, k).not.toMatch(/[٠-٩۰-۹]/u);
    }
  });

  it('no other string carries isolate or bidi characters', () => {
    for (const k of KEYS) {
      if (k === 'badInput') continue;
      for (const table of [EN, AR] as Record<string, string>[]) expect(table[k], k).not.toMatch(/[‎‏‪-‮⁦-⁩]/u);
    }
  });
});

describe('strings: pick(locale)', () => {
  it('pick("ar-EG") is AR', () => {
    expect(pick('ar-EG')).toBe(AR);
  });

  it('pick("en-US"), pick(""), pick(undefined) are EN', () => {
    expect(pick('en-US')).toBe(EN);
    expect(pick('')).toBe(EN);
    expect(pick(undefined)).toBe(EN);
  });

  it.each(['ar', 'AR', 'ar-SA', 'AR-eg', 'ar_SA', 'ar-001', 'en', 'en-GB', 'fr', 'fr-FR', 'arz', 'ara', 'xar', ' ar', 'ar ', 'he', 'fa-IR', 'zh-CN'])(
    'pick(%j) is whatever resolveLang("system", locale) says',
    (locale) => {
      expect(pick(locale)).toBe(resolveLang('system', locale) === 'ar' ? AR : EN);
    },
  );
});
