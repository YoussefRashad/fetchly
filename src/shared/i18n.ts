/** A language the app has text for. */
export type Lang = 'en' | 'ar';
/** The language setting: 'system' follows the Windows display language. */
export type LanguageSetting = 'system' | Lang;
/** The theme setting: 'system' follows the Windows app mode. */
export type ThemeSetting = 'system' | 'light' | 'dark';

const LANGUAGE_SETTINGS: readonly unknown[] = ['system', 'en', 'ar'] satisfies LanguageSetting[];
const THEME_SETTINGS: readonly unknown[] = ['system', 'light', 'dark'] satisfies ThemeSetting[];

/** Exactly one of the three values, in lower case; anything else is invalid. */
export function isLanguageSetting(v: unknown): v is LanguageSetting {
  return LANGUAGE_SETTINGS.includes(v);
}

/** Exactly one of the three values, in lower case; anything else is invalid. */
export function isThemeSetting(v: unknown): v is ThemeSetting {
  return THEME_SETTINGS.includes(v);
}

/**
 * The language to show. An explicit 'en' or 'ar' wins; 'system' gives 'ar' for a locale whose
 * language is Arabic (ar, ar-EG, AR-eg, ar_SA), and 'en' for any other, empty or missing locale.
 */
export function resolveLang(setting: LanguageSetting, locale: string | undefined): Lang {
  if (setting !== 'system') return setting;
  return typeof locale === 'string' && /^ar(?:[-_]|$)/iu.test(locale) ? 'ar' : 'en';
}

export function dirOf(lang: Lang): 'ltr' | 'rtl' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/** Wraps text in a first-strong isolate (U+2068 … U+2069), so a title or path keeps its own direction inside a sentence. */
export function fsi(s: string): string {
  return `⁨${s}⁩`;
}
