import { nativeTheme, type BrowserWindow } from 'electron';
import type { ThemeSetting } from '../shared/i18n';

/** The theme for the whole app; the window's CSS follows it through prefers-color-scheme. */
export function applyTheme(theme: ThemeSetting): void {
  nativeTheme.themeSource = theme;
}

/** The window's background before and around the page: the CSS --bg of the theme in use. */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9';
}

/** Keeps the window's background in step with the theme, so a switch never shows the old colour. */
export function followThemeBackground(win: () => BrowserWindow | null): void {
  nativeTheme.on('updated', () => {
    const w = win();
    if (w && !w.isDestroyed()) w.setBackgroundColor(windowBackground());
  });
}
