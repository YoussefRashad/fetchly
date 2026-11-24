/**
 * The Lanes palette: one table for the renderer's CSS custom properties and the window's background.
 * `styles.css` mirrors these values in its `:root` block and its dark `@media` block (a test keeps them equal).
 * Imports nothing, so main and the renderer can both read it.
 */

export type PaletteMode = 'light' | 'dark';

export const PALETTE_KEYS = [
  'bg',
  'chrome',
  'surface',
  'ink',
  'muted',
  'line',
  'field',
  'accent',
  'onAccent',
  'laneV',
  'laneA',
  'track',
  'ok',
  'bad',
  'warn',
  'hover',
  'tint',
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];

export type Palette = Readonly<Record<PaletteKey, string>>;

export const PALETTE: Readonly<Record<PaletteMode, Palette>> = Object.freeze({
  light: Object.freeze({
    bg: '#EDF0F4',
    chrome: '#E3E8EE',
    surface: '#FFFFFF',
    ink: '#14202C',
    muted: '#566375',
    line: '#D3DAE3',
    field: '#7D8898',
    accent: '#2346C4',
    onAccent: '#FFFFFF',
    laneV: '#2346C4',
    laneA: '#0B7A6E',
    track: '#E2E7EE',
    ok: '#167447',
    bad: '#B3261E',
    warn: '#8F5600',
    hover: '#E8ECF2',
    tint: '#EEF2FF',
  }),
  dark: Object.freeze({
    bg: '#0F151C',
    chrome: '#0B1016',
    surface: '#161F29',
    ink: '#E3E9F0',
    muted: '#95A3B5',
    line: '#26323F',
    field: '#647387',
    accent: '#8AA4FF',
    onAccent: '#0B1530',
    laneV: '#8AA4FF',
    laneA: '#3CC4B2',
    track: '#243040',
    ok: '#4CC98A',
    bad: '#FF7B72',
    warn: '#E8B04B',
    hover: '#1E2935',
    tint: '#1A2540',
  }),
});

/** 'onAccent' -> '--on-accent', 'laneV' -> '--lane-v', 'bg' -> '--bg'. */
export function cssVar(key: PaletteKey): string {
  return `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** The window's background for a mode: PALETTE.dark.bg when dark is true, else PALETTE.light.bg. */
export function windowBackgroundFor(dark: boolean): string {
  return dark ? PALETTE.dark.bg : PALETTE.light.bg;
}
