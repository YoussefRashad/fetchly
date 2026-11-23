import { describe, expect, it } from 'vitest';
import { dirOf, fsi, isLanguageSetting, isThemeSetting, resolveLang } from '../src/shared/i18n';

describe('resolveLang', () => {
  it.each([
    ['ar', 'ar'],
    ['ar-EG', 'ar'],
    ['AR-eg', 'ar'],
    ['ar_SA', 'ar'],
    ['en-US', 'en'],
    ['fr', 'en'],
    ['', 'en'],
    [undefined, 'en'],
    // The language is the first subtag only: a locale that merely starts with the letters "ar" is not Arabic.
    ['arn-CL', 'en'],
    ['es-AR', 'en'],
  ] as const)('system with the locale %j gives %s', (locale, lang) => {
    expect(resolveLang('system', locale)).toBe(lang);
  });

  it.each(['ar', 'ar-EG', 'en-US', 'fr', '', undefined])('an explicit setting wins over the locale %j', (locale) => {
    expect(resolveLang('en', locale)).toBe('en');
    expect(resolveLang('ar', locale)).toBe('ar');
  });
});

describe('dirOf', () => {
  it('is rtl for Arabic and ltr for English', () => {
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });
});

describe('fsi', () => {
  it('wraps the text exactly once in a first-strong isolate', () => {
    expect(fsi('Talk')).toBe('⁨Talk⁩');
    expect(fsi('')).toBe('⁨⁩');
    const wrapped = fsi('محاضرة 4');
    expect([...wrapped].filter((c) => c === '⁨')).toHaveLength(1);
    expect([...wrapped].filter((c) => c === '⁩')).toHaveLength(1);
    expect(wrapped.slice(1, -1)).toBe('محاضرة 4');
  });
});

describe('isLanguageSetting / isThemeSetting', () => {
  it('accept exactly their three values', () => {
    for (const v of ['system', 'en', 'ar']) expect(isLanguageSetting(v)).toBe(true);
    for (const v of ['system', 'light', 'dark']) expect(isThemeSetting(v)).toBe(true);
  });

  it.each([undefined, null, 0, 1, true, false, '', 'AR', 'En', 'System', 'fr', 'auto', 'light', ['ar'], { lang: 'ar' }])('language refuses %j', (v) => {
    expect(isLanguageSetting(v)).toBe(false);
  });

  it.each([undefined, null, 0, 1, true, false, '', 'Dark', 'LIGHT', 'System', 'auto', 'ar', ['dark'], { theme: 'dark' }])('theme refuses %j', (v) => {
    expect(isThemeSetting(v)).toBe(false);
  });
});
