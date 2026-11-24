import { nativeTheme, type BrowserWindow } from 'electron';
import type { ThemeSetting } from '../shared/i18n';
import { windowBackgroundFor } from '../shared/palette';

/** The theme for the whole app; the window's CSS follows it through prefers-color-scheme. */
export function applyTheme(theme: ThemeSetting): void {
  nativeTheme.themeSource = theme;
}

/** The window's background before and around the page: the CSS --bg of the theme in use (one table, PALETTE). */
export function windowBackground(): string {
  return windowBackgroundFor(nativeTheme.shouldUseDarkColors);
}

/** Keeps the window's background in step with the theme, so a switch never shows the old colour. */
export function followThemeBackground(win: () => BrowserWindow | null): void {
  nativeTheme.on('updated', () => {
    const w = win();
    if (w && !w.isDestroyed()) w.setBackgroundColor(windowBackground());
  });
}
