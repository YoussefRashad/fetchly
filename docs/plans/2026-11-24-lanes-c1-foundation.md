# Fetchly "Lanes" UI redesign — C1 Foundation: tokens, type, icons

- Date: 2026-11-24. Branch: `feat/lanes-redesign`. File: `docs/plans/2026-11-24-lanes-c1-foundation.md`. Revision r2 (after plan-critique r1: 1 BLOCKING, 17 NON-BLOCKING).
- Parent: `docs/plans/2026-11-24-lanes-redesign-architecture.md` (r3, frozen). Its D1–D12, section 5.3, the C1 section, section 8 and the provisional table bind this plan.
- Class: component plan of a large task. No migration, no saved-state change, so no rollback section.
- Nothing here was run: this lane is read-only. Every contrast figure is hand arithmetic from the WCAG formula, recomputed independently by the critique for the r1 pairs; the tests decide (see 7.1).
- Sources read: the architecture plan, `.superpowers/design/probe-pf1.md`, `.superpowers/design/fetchly-ui-directions.html` (lines 115-154, 628-630, 717-741, 1569-1589), `src/renderer/src/**`, `src/renderer/index.html`, `src/main/appearance.ts`, `src/main/index.ts:1-88`, `electron.vite.config.ts`, `package.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.mts`, `eslint.config.mjs`, `.github/workflows/ci.yml`, `README.md:185-246`, `tests/renderer/strings.test.ts`, `e2e/real/lib.mjs` (hooks), `e2e/real/checks.mjs` (text reads).
- `AGENTS.md`, `.ai/agents/*.md` and `.ai/security-paths.json` do not exist in this worktree; the code, the `package.json` scripts and `docs/` are the source of truth.

## 1. Context

C1 gives the app the Lanes palette, the bundled IBM Plex fonts, an SVG icon set, restyled base controls and the shared `palette.ts` and `logo.ts`, without changing the layout. After C1 the window is today's layout in the new tokens, fonts and icons (D8). C3 to C6 then build the new layout on these tokens only.

## 2. Scope

In scope:
- `PALETTE` in `src/shared/palette.ts` (architecture 5.3, with one adjusted value, see 5.1), mirrored in `styles.css` (`:root` and the dark block) and read by `appearance.ts` through `windowBackgroundFor`.
- The token rename (`--panel`, `--text`, `--bar`, `--accent-text`) across every existing rule.
- IBM Plex Sans and IBM Plex Sans Arabic at 400, 500 and 600, bundled; `assetsInlineLimit: 0`.
- The `Icon` component and its data; every emoji or unicode glyph used as an icon today is replaced.
- Base controls (button, primary button, text field, select, checkbox), the focus ring, the single reduced-motion block (D4), tabular figures, and the D5 boundary rule.
- `src/shared/logo.ts` (data and one helper only).
- `contrast()` and the palette, logo and icon tests.
- The OFL notice in `README.md`.

Out of scope for C1 (the app keeps today's layout):
- Rail, summary strip, new banners, empty states, `Ctrl+L`, `minWidth`, `data-hidden` (C3).
- Lane rows, the bracket, `content-visibility`, replacing `.bar` (C4). Two known debts stay until C4 removes the bar:
  - `.bar .fill { transition: width … }` (`styles.css:405`) is not a `transform`/`opacity` motion (D4).
  - `.bar .fill.unknown { opacity: 0.35 }` (`styles.css:408-410`) is an opacity on a state fill (D5).
- Drawer, sheet, install card, the scrim colour `rgb(0 0 0 / 45%)` (`styles.css:424`) (C5).
- Thumbnails, toasts, CSP change (C6). The CSP is not touched: PF-1 point 4 shows the fonts load under today's policy.
- Drawing the logo anywhere: `LogoMark.tsx` is C3, the rasteriser is C8. C1 ships the data only.
- New strings: C1 adds none, so `strings.ts` and `strings.ar.ts` are untouched.
- `e2e/real/**`: no hook changes (section 8 below).
- Forced-colours verification (architecture section 3).
- Other font subsets (`latin-ext`, Cyrillic, Greek): the architecture fixes Latin and Arabic only (section 6 and 11).

## 3. Files

### Created

| File | Content |
|---|---|
| `src/shared/palette.ts` | `PALETTE`, key list, types, `cssVar`, `windowBackgroundFor` (5.1) |
| `src/shared/logo.ts` | Zip geometry and colours, `strokePath` (5.6) |
| `src/renderer/src/model/contrast.ts` | `contrast(a, b)` (7.1) |
| `src/renderer/src/model/icons.ts` | Icon names, geometry, mirrored set (5.4). Addition to the architecture's file list, see Q1 |
| `src/renderer/src/components/Icon.tsx` | The `<svg>` renderer (5.4) |
| `tests/renderer/contrast.test.ts` | 7.1 |
| `tests/renderer/palette.test.ts` | 7.2 |
| `tests/renderer/icons.test.ts` | 7.4 |
| `tests/logo.test.ts` | 7.3 |

### Modified

| File | Change |
|---|---|
| `package.json`, `package-lock.json` | `devDependencies`: `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-sans-arabic`, both pinned to exactly `5.3.0` (the probed version). Installed by the orchestrator, not by a worker (section 8). CI installs with `npm ci` (`ci.yml:32`). |
| `electron.vite.config.ts` | `renderer.build` gains `assetsInlineLimit: 0` next to `rollupOptions` (line 23). |
| `src/renderer/src/main.tsx` | Six font CSS imports before `./styles.css` (5.2). |
| `src/renderer/src/styles.css` | Palette blocks, rename, font stack, base controls, icon classes, reduced-motion block (5.1, 5.3, 5.5). |
| `src/main/appearance.ts` | `windowBackground()` returns `windowBackgroundFor(nativeTheme.shouldUseDarkColors)`; no colour literal left (5.1). |
| `src/renderer/src/App.tsx` | Line 110: `✕` becomes `<Icon name="close" />`; the button gets `className="icon-btn"`. |
| `src/renderer/src/components/UrlBar.tsx` | Line 48: `⚙` becomes `<Icon name="gear" />`; `icon-btn`. |
| `src/renderer/src/components/JobRow.tsx` | Lines 6-13: the `ICONS` map becomes `Record<JobVerb, IconName>`; line 83 `📁` and line 87 render `<Icon>`; those buttons get `icon-btn`. |
| `src/renderer/src/components/GroupRow.tsx` | Lines 35, 55, 60, 69: glyphs become `<Icon>` (5.4). The three action buttons (lines 54, 59, 63-68) get `icon-btn`; the twisty (line 34) keeps only `twisty`. |
| `README.md` | Font licence sentence in the License section (line 242-246), see 5.2. |

Not modified: `src/renderer/index.html`, `src/main/index.ts` (it already calls `windowBackground()` at line 41 and `followThemeBackground` at line 87), `strings*.ts`, `e2e/real/**`, `AddDialog.tsx`, `SettingsDialog.tsx`, `InstallScreen.tsx`, `JobList.tsx`.

## 4. PF-1 result and the amendment to the provisional rules

Probed (from `probe-pf1.md`, run 2026-11-24 by the orchestrator):
- Windows 10.0.26100.8037, Electron 45.4.1 (Chrome 156.0.8078.100), Vite 8.3.8.
- `@fontsource/ibm-plex-sans` 5.3.0 and `@fontsource/ibm-plex-sans-arabic` 5.3.0, both OFL-1.1.
- The probe used plain Vite 8.3.8 with `base: './'` in a scratch project, one process.

Not probed, covered only by C1's build gate: electron-vite 6.0.0's own renderer build. `npm run dev` is covered only by a manual check.

Amendment (the only one C1 may make):

| Provisional rule | Result | Rule after C1 |
|---|---|---|
| Package names | Confirmed | `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-sans-arabic`, exactly `5.3.0` |
| Import paths | Confirmed | `latin-400.css`, `latin-500.css`, `latin-600.css`; `arabic-400.css`, `arabic-500.css`, `arabic-600.css` |
| `assetsInlineLimit` | Confirmed | `0`; each font is emitted as its own hashed file, the CSS holds no `data:` |

No rule changes meaning, so there are no consumers to update.

## 5. Design

### 5.1 Palette, tokens and follow-system

`src/shared/palette.ts`:

```ts
export type PaletteMode = 'light' | 'dark';
export const PALETTE_KEYS = [
  'bg', 'chrome', 'surface', 'ink', 'muted', 'line', 'field', 'accent', 'onAccent',
  'laneV', 'laneA', 'track', 'ok', 'bad', 'warn', 'hover', 'tint',
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Readonly<Record<PaletteKey, string>>;
export const PALETTE: Readonly<Record<PaletteMode, Palette>>;
/** 'onAccent' -> '--on-accent', 'laneV' -> '--lane-v', 'bg' -> '--bg'. */
export function cssVar(key: PaletteKey): string;
/** The window's background for a mode: PALETTE.dark.bg when dark is true, else PALETTE.light.bg. */
export function windowBackgroundFor(dark: boolean): string;
```

Values are the architecture's 5.3 table, written as uppercase `#RRGGBB`, with one adjustment (decided by the orchestrator, listed for the owner in section 12):

| Token | Mode | Architecture 5.3 | C1 | Why |
|---|---|---|---|---|
| `ok` | light | `#17784A` | `#167447` | `#17784A` is 4.46 on `--chrome`, under the 4.5 the extended text assertions need (7.2). `#167447` gives 4.70 on `chrome`, 5.07 on `bg`, 5.80 on `surface`, 4.89 on `hover`, 5.18 on `tint`. |

The other 33 values are unchanged. The architecture plan is frozen and is not edited; from C1 on, `palette.ts` is the source of the values.

`styles.css`, the two palette blocks in full:

```css
:root {
  color-scheme: light dark;
  --bg: #EDF0F4;
  --chrome: #E3E8EE;
  --surface: #FFFFFF;
  --ink: #14202C;
  --muted: #566375;
  /* Decoration only (D5): never the only boundary of a control. */
  --line: #D3DAE3;
  /* Required boundaries: fields and outline buttons, 3:1 against --bg and --surface. Never on --chrome. */
  --field: #7D8898;
  --accent: #2346C4;
  --on-accent: #FFFFFF;
  --lane-v: #2346C4;
  --lane-a: #0B7A6E;
  --track: #E2E7EE;
  --ok: #167447;
  --bad: #B3261E;
  --warn: #8F5600;
  --hover: #E8ECF2;
  --tint: #EEF2FF;
  font: 14px/1.45 'IBM Plex Sans', 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0F151C;
    --chrome: #0B1016;
    --surface: #161F29;
    --ink: #E3E9F0;
    --muted: #95A3B5;
    --line: #26323F;
    --field: #647387;
    --accent: #8AA4FF;
    --on-accent: #0B1530;
    --lane-v: #8AA4FF;
    --lane-a: #3CC4B2;
    --track: #243040;
    --ok: #4CC98A;
    --bad: #FF7B72;
    --warn: #E8B04B;
    --hover: #1E2935;
    --tint: #1A2540;
  }
}
```

Rules for these blocks, which the test enforces (7.2):
- The first top-level `:root { }` rule and the `:root` rule inside the dark `@media` each hold exactly 17 custom-property declarations: these 17 names, each once, no other.
- Each value is the full six-digit `#RRGGBB` form (either case) and each declaration ends with `;`, the last one too. The three-digit shorthand is deliberately not accepted.
- None of the 17 names is declared anywhere else in the file: not in a later `:root`, not in `:root:lang(ar)`, not on `body` or any other selector.
- A later component that needs a non-colour custom property puts it in another rule, not in these two.
- Outside these two blocks `styles.css` holds no `#hex` colour.

Rename, every existing rule that changes:

| `styles.css` line | Rule | Old | New |
|---|---|---|---|
| 4, 33 | definitions | `--panel` | `--surface` |
| 5, 34 | definitions | `--text` | `--ink` |
| 11, 39 | definitions | `--accent-text` | `--on-accent` |
| 15, 43 | definitions | `--bar` | `--track` |
| 8 | comment "3:1 against the panel" | — | reworded to the comment above |
| 60 | `body` colour | `--text` | `--ink` |
| 71 | `button` background | `--panel` | `--surface` |
| 90 | `button.primary` colour | `--accent-text` | `--on-accent` |
| 97 | fields background | `--panel` | `--surface` |
| 122 | `.urlbar` background | `--panel` | `--surface` |
| 159 | `.filters button.active` background | `--panel` | `--surface` |
| 177 | `.banner` background | `--panel` | `--surface` |
| 214 | `.jobs > li` background | `--panel` | `--surface` |
| 375 | `.job-size .size-done` colour | `--text` | `--ink` |
| 399 | `.bar` background | `--bar` | `--track` |
| 432 | `.dialog` background | `--panel` | `--surface` |

No other file under `src/`, `tests/`, `e2e/` or `docs/` (apart from the architecture plan's own text) uses the old names.

Follow-system today:
- `applyTheme` sets `nativeTheme.themeSource` to `system`, `light` or `dark` (`appearance.ts:5-7`), at start (`index.ts:86`) and on a settings save (`index.ts:192`).
- The page follows through `color-scheme: light dark` and the `prefers-color-scheme` block (`styles.css:2,30`).
- The window background is set at creation (`index.ts:41`) and on every `nativeTheme` `updated` event (`appearance.ts:15-20`), from two hard-coded `--bg` values (`appearance.ts:11`).

What C1 changes there: only line 11 and the import.
- `windowBackground()` returns `windowBackgroundFor(nativeTheme.shouldUseDarkColors)`.
- The choice of mode and of the `bg` key lives in the pure `windowBackgroundFor` in `palette.ts` (D6), which the test calls directly. `appearance.ts` only passes Electron's flag.
- `applyTheme`, `followThemeBackground` and their callers are unchanged.
- The window colour and the CSS `--bg` now come from one table, and the test proves they are equal per mode.

### 5.2 Fonts

Decision (Q2, accepted): import the six subset CSS files as they are (PF-1 "option A"); the woff copies ship.
- Every step of this route was probed: the files exist, the build emits hashed files, nothing is inlined, and the fonts load from `file://` under the app's CSP.
- The woff2-only route needs the app's own `@font-face` rules with URLs into the package's `files/` folder. The probe did not test how Vite resolves such a URL, and it did not record the Arabic file names, so this plan does not rest on it.
- Cost: about 208 kB of `.woff` copies on disk that Chromium 156 never requests, because woff2 is listed first.

`main.tsx`, before `import './styles.css'`:

```ts
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
```

`src/renderer/src/css.d.ts:1` already declares `*.css`, so typecheck needs nothing more.

- Family names, as the probe checked them: `'IBM Plex Sans'` and `'IBM Plex Sans Arabic'`.
- Stack, the same in both languages: `'IBM Plex Sans', 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif`. This is the architecture's fallback stack; today's `system-ui` (`styles.css:16`) is dropped.
- Sizes stay: 14px/1.45, and Arabic 15px/1.65 (`styles.css:19-23`, rule and comment unchanged).
- Weights in use are 400, 500 and 600 only. C1 adds `strong, b, h1, h2, h3 { font-weight: 600; }` so no element asks for 700.
- C1 adds `.entries em { font-style: normal; }`, because no italic face is bundled (Arabic is already covered at `styles.css:26-28`).
  - This is a visible change in English: the reason beside an unavailable playlist entry (`AddDialog.tsx:118`) loses its italics and keeps only its muted colour.
  - Decided to keep. It is listed for the owner in section 12, who may overturn it; the alternative is Chromium's synthesised slant of the upright face.
- Packages go in `devDependencies`: the renderer is bundled at build time and nothing reads them at runtime.
- Subsets: Latin and Arabic only, as the architecture fixes. A character outside both falls back per glyph (section 6).

Bundle size to record:

| Files | Size (PF-1) |
|---|---|
| woff2: Latin 400/500/600 | 22.6 + 24.2 + 24.3 kB |
| woff2: Arabic 400/500/600 | 42.8 + 45.3 + 45.7 kB |
| woff2 total | about 205 kB |
| woff copies | about 208 kB |
| Added to `out/renderer/assets` | about 413 kB, 12 files |

The orchestrator measures the real build (section 8) and puts the measured figure in the C1 commit message, since this file is frozen.

`README.md`, appended to the License section:

> The window's typefaces, IBM Plex Sans and IBM Plex Sans Arabic (© IBM Corp.), are bundled at build time from the `@fontsource` packages under the SIL Open Font License 1.1.

### 5.3 Base controls, focus ring, motion, figures (D4, D5)

```css
button {
  background: var(--surface);
  border: 1px solid var(--field);      /* was --line: an outline button's boundary must reach 3:1 */
  border-radius: 8px;
  padding: 5px 12px;
  cursor: pointer;
}
button:hover:not(:disabled) { border-color: var(--accent); }   /* as today */
button:disabled { opacity: 0.5; cursor: default; }             /* as today */
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
input[type='text'], input[type='number'], select {
  background: var(--surface);
  border: 1px solid var(--field);
  border-radius: 8px;
  padding: 6px 10px;
  min-width: 0;
}
input[type='checkbox'] { accent-color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }   /* unchanged */
.filters button.active { background: var(--surface); border-color: var(--field); font-weight: 600; }
.metric { font-variant-numeric: tabular-nums; }
.install .pct { color: var(--muted); font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
```

- D5 as CSS: the boundary of a button, field or select is `--field`, and the focus ring and primary fill are `--accent`. Both reach 3:1 on `--bg` and `--surface` in both modes (7.2).
- `--field` is never a boundary on `--chrome`: light `field` on `chrome` is 2.92, under D5's 3:1. Light `field` on `hover` is 3.03, which passes with almost no margin. In C1 no control sits on `--chrome` (the token is unused until C3). Section 9 carries the rule for C3 and C5.
- `--line` stays on decoration only: row cards (`styles.css:215`), the dialog edge (433), the playlist fieldset (483) and separators (123, 150, 332).
- `button:disabled` keeps `opacity: 0.5`. D5's opacity rule is about fills and labels that carry a job state; a disabled control is not one.
- `.filters button` and `.twisty` keep their transparent or absent border (`styles.css:153-156, 320-324`); they are ghost controls with a text or `aria-expanded` state.
- The reduced-motion block replaces `styles.css:551-555` and is the only one in the file. Later components add no second block, and the static style of any element must already be its readable final state.
- Tabular figures stay on every metric that has them today (`styles.css:167, 277, 354, 364, 511`). `.metric` is the base class for new metrics in C3 to C6.

### 5.4 Icons

Data lives in `src/renderer/src/model/icons.ts` (pure, so a node test can read it); `Icon.tsx` only renders.

```ts
// model/icons.ts
export const ICON_NAMES = [ /* the 22 names below */ ] as const;
export type IconName = (typeof ICON_NAMES)[number];
export type IconShape =
  | { tag: 'path'; d: string }
  | { tag: 'circle'; cx: number; cy: number; r: number }
  | { tag: 'rect'; x: number; y: number; width: number; height: number; rx: number };
export const ICONS: Readonly<Record<IconName, readonly IconShape[]>>;
/** Icons that point along the reading direction (D2). */
export const MIRRORED_ICONS: ReadonlySet<IconName>;   // { 'chevronEnd', 'open' }

// components/Icon.tsx
interface Props { name: IconName; size?: number; className?: string }
export function Icon({ name, size = 16, className }: Props) { /* … */ }
```

`Icon` has no return-type annotation, like every existing component (`App.tsx:15`, `JobRow.tsx:36`, `UrlBar.tsx:10`). `@types/react` 19 (`package.json:29`) has no global `JSX` namespace and `tsconfig.web.json:7` sets `types: []`, so `: JSX.Element` would fail typecheck with TS2503. No file in C1 names `JSX.Element`.

Rendering:
- One `<svg>`, never a `span` and with no wrapper.
- Attributes: `viewBox="0 0 24 24"`, `width` and `height` set to `size`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2.5}`, `strokeLinecap="round"`, `strokeLinejoin="round"`, `aria-hidden="true"`, `focusable="false"`.
- Class `icon`, plus `icon-mirror` when the name is in `MIRRORED_ICONS`, plus `className`.
- No `<title>`. The name of a control always comes from its `aria-label` or its text.
- Every icon is stroke-only; none is filled.
- Default size is 16px in both languages.

Geometry: inline, no icon package. The paths are the mockup's set (`fetchly-ui-directions.html:718-740`, a 16-unit box at stroke 1.7) scaled by 1.5 to a 24-unit box. Stroke 2.5 keeps the same weight (the exact scale is 2.55). `trash` and `chevronEnd` are not in the mockup and are drawn here.

| Name | Shapes (24 box) | Used in C1 |
|---|---|---|
| `pause` | path `M9 6v12M15 6v12` | yes |
| `play` | path `M8.25 5.25l10.5 6.75-10.5 6.75z` | yes |
| `close` | path `M6 6l12 12M18 6l-12 12` | yes |
| `retry` | path `M18.75 12a6.75 6.75 0 1 1-1.95-4.8`; path `M18.75 3.75v4.5h-4.5` | yes |
| `trash` | path `M4.5 6.75h15`; path `M9.75 6.75V4.5h4.5v2.25`; path `M6.75 6.75l.75 13.5h9l.75-13.5`; path `M10.5 10.5v6M13.5 10.5v6` | yes |
| `folder` | path `M3 6.75h6l2.25 2.25H21v9.75H3z` | yes |
| `gear` | circle 12,12 r 3.3; path `M12 2.25v3M12 18.75v3M2.25 12h3M18.75 12h3M5.1 5.1l2.1 2.1M16.8 16.8l2.1 2.1M5.1 18.9l2.1-2.1M16.8 7.2l2.1-2.1` | yes |
| `chevronDown` | path `M6 9l6 6 6-6` | yes |
| `chevronEnd` | path `M9 6l6 6-6 6` (mirrored under RTL) | yes |
| `check` | path `M5.25 12.75l4.5 4.5 9-10.5` | C3+ |
| `alert` | path `M12 3l9.75 17.25h-19.5z`; path `M12 9.75v5.25M12 18v.3` | C3+ |
| `link` | path `M10.5 13.5a4.5 4.5 0 0 0 6.3 0l3-3a4.5 4.5 0 0 0-6.3-6.3l-1.2 1.2`; path `M13.5 10.5a4.5 4.5 0 0 0-6.3 0l-3 3A4.5 4.5 0 0 0 10.5 19.8l1.2-1.2` | C3+ |
| `list` | path `M4.5 6h15M4.5 12h15M4.5 18h15` | C3+ |
| `download` | path `M12 3.75v12.75M6.75 11.25L12 16.5l5.25-5.25M4.5 20.25h15` | C3+ |
| `open` | path `M13.5 3.75h6.75V10.5`; path `M20.25 3.75L11.25 12.75`; path `M18 14.25v6H3.75V6H9.75` (mirrored under RTL) | C4+ |
| `film` | rect 3,4.5 18×15 rx 2.25; path `M7.5 4.5v15M16.5 4.5v15M3 9.75h4.5M16.5 9.75h4.5M3 14.25h4.5M16.5 14.25h4.5` | C4+ |
| `music` | path `M9 18V5.25l10.5-2.25V15`; circle 6.75,18 r 2.25; circle 17.25,15 r 2.25 | C4+ |
| `file` | path `M6 2.25h8.25L18.75 6.75V21.75H6z`; path `M14.25 2.25v4.5h4.5` | C4+ |
| `stack` | rect 3.75,8.25 16.5×12 rx 2.25; path `M6 5.25h12M8.25 2.7h7.5` | C4+ |
| `palette` | circle 12,12 r 9; circles 8.25,10.5 / 12,7.5 / 15.75,10.5, each r 1.05 | C5 |
| `globe` | path `M3 12h18`; circle 12,12 r 9 | C5 |
| `wrench` | path `M15 3.75a4.5 4.5 0 0 0-4.2 6L3.75 16.8l3.45 3.45 7.05-7.05a4.5 4.5 0 0 0 6-4.2l-2.7 1.8-2.55-2.55z` | C5 |

The mockup's `more` icon is not taken: the overflow menu is out of scope (architecture section 3).

Every glyph in `src/renderer/src/**` used as an icon today, and its replacement:

| Where | Glyph | Icon | Accessible name (unchanged) | `title` today |
|---|---|---|---|---|
| `UrlBar.tsx:48` | ⚙ | `gear` | `aria-label={S.settings}` (line 47) | yes |
| `App.tsx:110` | ✕ | `close` | `aria-label={S.close}` (line 109) | none |
| `JobRow.tsx:7` | ❚❚ | `pause` | `S.verbs.pause` (line 86) | yes |
| `JobRow.tsx:8` | ▶ | `play` | `S.verbs.resume` | yes |
| `JobRow.tsx:9` | ✕ | `close` | `S.verbs.cancel` | yes |
| `JobRow.tsx:10` | ↻ | `retry` | `S.verbs.retry` | yes |
| `JobRow.tsx:11` | ✕ | `close` | `S.verbs.remove` | yes |
| `JobRow.tsx:12` | 🗑 | `trash` | `S.verbs.removeWithFile` | yes |
| `JobRow.tsx:83` | 📁 | `folder` | `aria-label={S.openFolder}` (line 82) | yes |
| `GroupRow.tsx:35` | ▾ (open) | `chevronDown` | `aria-label={group.title}` (line 34) | none |
| `GroupRow.tsx:35` | ▸ (closed) | `chevronEnd` | same | none |
| `GroupRow.tsx:55` | ❚❚ | `pause` | `S.groupVerbs.pause` (line 54) | yes |
| `GroupRow.tsx:60` | ▶ | `play` | `S.groupVerbs.resume` (line 59) | yes |
| `GroupRow.tsx:69` | ✕ | `close` | `S.groupVerbs.cancel` or `S.verbs.remove` (lines 66-67) | yes |

C1 adds no `title`: the close-message button and the twisty have none today and keep none.

Non-ASCII characters that are text and stay as they are:
- the em dash at `InstallScreen.tsx:32` and `format.ts:7`;
- the ` · ` separator at `JobRow.tsx:66` and `format.ts:115` (and in the comment at `format.ts:81`);
- `≤` at `format.ts:239`;
- `العربية` at `SettingsDialog.tsx:205`;
- in `strings.ts`: `…` (U+2026) at lines 17, 52, 54, 102, 137, 151, 163, and `’` (U+2019) at line 156. Both are inside the Latin subset;
- everything in `strings.ar.ts`.

`banners.ts` and `components/quality.ts` hold no non-ASCII character.

RTL (D2, and Q8 as decided):
- `chevronEnd` and `open` mirror, through `[dir='rtl'] .icon-mirror { transform: scaleX(-1); }`. `open` is an arrow toward the top end, and the common RTL convention mirrors it. It is not rendered in C1.
- Play, pause, check, folder, trash, retry and every other icon do not mirror.
- The rule at `styles.css:326-329` (`[dir='rtl'] .twisty[aria-expanded='false']` flipping the button) is deleted in the same change. Left in, it would flip the already flipped icon back.

CSS added:

```css
.icon { display: block; flex: none; }
[dir='rtl'] .icon-mirror { transform: scaleX(-1); }
.icon-btn { display: inline-grid; place-items: center; min-width: 30px; min-height: 28px; padding: 2px 6px; }
/* Over `.job-actions button` (0,1,1): an icon button is the same 30px in a row and outside one. */
.job-actions .icon-btn { padding: 2px 6px; }
```

Padding inside rows:
- `.job-actions button { padding: 2px 8px }` (`styles.css:393-395`, specificity 0,1,1) beats a bare `.icon-btn` (0,1,0). `.job-actions .icon-btn` (0,2,0) is added so the icon button's own padding wins.
- An icon button is therefore 30px wide everywhere: 16px icon, 12px padding, 2px border.
- The text button "Open" in a row keeps `2px 8px` from the existing rule.
- Widest set of row actions (a finished download, `format.ts:219-220`): "Open", folder, remove, delete file. Three icon buttons and three 4px gaps take 102px, which leaves 54px of the column's `min-width: 156px` (`styles.css:266-270`) for "Open" or "فتح". Whether that word fits in 54px in Plex is not known without the font (section 10, check 11).

Why no section-8 hook breaks:
- Each swapped button keeps its accessible name (`aria-label`), and keeps its `title` where it has one today. So `getByRole('button', { name, exact: true })` (`lib.mjs:352,403`) and `header.urlbar button[aria-label=Settings]` (`lib.mjs:408`) still match.
- The icon is an `svg`, so the first `span` of a banner is still its text (`lib.mjs:226,232`).
- `.job-name` is not touched (`lib.mjs:390`), and no `span` is added to `.job-main`.
- An `svg` has no text, so a row's `textContent` only loses the glyph characters; the one check that reads it looks for the word "skipped" (`checks.mjs:1252`).
- The text button "Open" (`JobRow.tsx:78-80`) is unchanged.

### 5.5 `styles.css`, other edits

- The palette blocks, rename and font stack of 5.1.
- The base controls, `.metric`, `.install .pct` and the reduced-motion block of 5.3.
- The icon rules of 5.4 (four rules), and the deletion of lines 326-329.
- `strong, b, h1, h2, h3 { font-weight: 600; }` and `.entries em { font-style: normal; }`.
- Nothing else: every layout rule (grids, media queries at 1000px and 880px, `.bar`, `.backdrop`, `.dialog`) keeps its geometry. The one permitted exception is the remedy in section 10, check 11.

### 5.6 `logo.ts`

```ts
export type LogoPoint = readonly [x: number, y: number];
export type LogoSegment =
  | { kind: 'line'; to: LogoPoint }
  | { kind: 'quad'; control: LogoPoint; to: LogoPoint };
export interface LogoRect { kind: 'rect'; x: number; y: number; width: number; height: number; radius: number; fill: string }
export interface LogoStroke { kind: 'stroke'; start: LogoPoint; segments: readonly LogoSegment[]; width: number; cap: 'round'; color: string }
export interface LogoPolygon { kind: 'polygon'; points: readonly LogoPoint[]; fill: string }
export type LogoShape = LogoRect | LogoStroke | LogoPolygon;

export const LOGO_BOX = 256;
export const LOGO_COLORS = { plate: '#1E3AA8', strand: '#FFFFFF', strandAlt: '#4FE0CC' } as const;
export const LOGO: {
  readonly plate: LogoRect;
  readonly left: LogoStroke;
  readonly right: LogoStroke;
  readonly stem: LogoStroke;
  readonly head: LogoPolygon;
};
/** Paint order, back to front: plate, left, right, stem, head. */
export const LOGO_SHAPES: readonly LogoShape[];
/** SVG path data of a stroke: 'M x y', then 'L x y' or 'Q cx cy x y' per segment, joined by one space. */
export function strokePath(s: LogoStroke): string;
```

- Strokes are held as points, not as an SVG string, so C8's rasteriser needs no path parser. C3 gets the `d` attribute from `strokePath`.
- `strokePath` writes the vertical run as `L84 92` where 5.3 writes `V92`. The geometry is the same.
- The colours are fixed in both modes and are not palette tokens.
- The file imports nothing and uses no DOM or Node API, so the renderer and main can both import it.

## 6. Edge cases

| Case | Behaviour |
|---|---|
| Arabic text with Latin digits | The stack is the same in both languages with IBM Plex Sans first. Digits and Latin punctuation come from IBM Plex Sans, Arabic letters from IBM Plex Sans Arabic. Metric columns therefore have the same digit widths in both languages. |
| A character outside both subsets (for example `≤` in `≤720p`, `format.ts:239`) | It falls through the stack to Segoe UI. Checked by eye (section 10). |
| A title with Latin-extended, Cyrillic, Greek or other letters (for example "Łódź") | Fallback is per glyph: `Ł`, `ó`… Here `ó` and `d` are in the Latin subset and come from IBM Plex Sans, while `Ł` and `ź` come from Segoe UI, so one word mixes two fonts. A fully Cyrillic or Greek title renders wholly in Segoe UI. This is a known limitation of the architecture's subset choice (section 11); adding `latin-ext` is an owner decision, not a PF-1 amendment. Checked by eye (section 10, check 12). |
| A font file fails to load | The package CSS declares `font-display: swap` (PF-1 point 2): text shows at once in Segoe UI or Tahoma and stays there. Nothing blocks and no error is shown. |
| Unused weight | It is never loaded (PF-1 point 4). |
| Light/dark switch | `nativeTheme` `updated` sets the window background to `windowBackgroundFor(dark)`, the same value as the CSS `--bg`, so no old colour shows around or before the page. |
| Theme set to light or dark while Windows is in the other mode | `themeSource` drives both `shouldUseDarkColors` and the page's `prefers-color-scheme`, as today. |
| Reduced motion | The one block removes every transition and animation, including the old bar's width transition. |
| RTL, collapsed playlist | The `chevronEnd` icon mirrors once and points left. |
| `tabular-nums` not honoured by the bundled subset | Not known until seen. Checked by eye; if digits shift, C1 reports it and the owner decides (Q4). |
| Plex is wider than Segoe UI in the fixed metric columns | Not known until seen (section 10, check 11; section 11). |
| Forced colours | Out of scope (architecture section 3). |

## 7. Acceptance criteria

Tests are written from this section before any code. Vitest runs in `node` with no DOM (`vitest.config.mts`), and test files are typechecked under `tsconfig.node.json`, which has no `jsx` setting. So no test imports a `.tsx` file; component sources are read as text.

### 7.1 `contrast`

Module `src/renderer/src/model/contrast.ts`. `export function contrast(a: string, b: string): number`.

- Accepted input: a value whose `typeof` is `'string'` and which is exactly `#` followed by six hex digits, either case.
- The type is checked first, before any pattern test: a value whose `typeof` is not `'string'` throws, even when it would coerce to a valid string.
- Rejected input, each throws `TypeError`:
  - wrong length: `#FFF`, `#12345`, `#1234567`, `#FFFFFFFF`;
  - no `#`: `FFFFFF`;
  - not hex: `#GGGGGG`;
  - whitespace or empty: `' #FFFFFF'`, `'#FFFFFF '`, `'#FFFFFF\n'`, `''`;
  - other colour syntax: `'white'`, `'rgb(0,0,0)'`;
  - not a string: `null`, `undefined`, `0`, `['#FFFFFF']`, `new String('#FFFFFF')`.
  
  A bad value in either position throws.
- Tests are typechecked, so each non-string row is passed with a cast: `value as unknown as string`.
- Formula (WCAG 2.x):
  - each channel `c = v / 255`;
  - linear value is `c / 12.92` when `c ≤ 0.03928`, else `((c + 0.055) / 1.055) ** 2.4`;
  - `L = 0.2126 R + 0.7152 G + 0.0722 B`;
  - the result is `(Lmax + 0.05) / (Lmin + 0.05)`.
- No rounding inside: the result is the raw ratio, so a threshold test is exact. The result is always ≥ 1 and the argument order does not matter.

| `a` | `b` | Expected |
|---|---|---|
| `#000000` | `#FFFFFF` | 21 (`toBeCloseTo(21, 10)`) |
| `#FFFFFF` | `#000000` | 21 (`toBeCloseTo(21, 10)`) |
| `#ffffff` | `#000000` | 21 (`toBeCloseTo(21, 10)`) |
| `#2346C4` | `#2346C4` | exactly 1 |
| `#2346c4` | `#2346C4` | exactly 1 |
| `#767676` | `#FFFFFF` | 4.54 |
| `#777777` | `#FFFFFF` | 4.48 |
| `#FF0000` | `#FFFFFF` | 4.00 |
| `#0000FF` | `#FFFFFF` | 8.59 |
| `#8F5600` (light `warn`) | `#EDF0F4` (light `bg`) | 5.25 |
| `#0B7A6E` (light `laneA`) | `#E2E7EE` (light `track`) | 4.20 |
| `#7D8898` (light `field`) | `#FFFFFF` (light `surface`) | 3.59 |
| `#2346C4` (light `accent`) | `#FFFFFF` | 7.65 |
| `#E3E9F0` (dark `ink`) | `#161F29` (dark `surface`) | 13.61 |
| `#3CC4B2` (dark `laneA`) | `#243040` (dark `track`) | 6.19 |
| `#8AA4FF` (dark `accent`) | `#0B1530` (dark `onAccent`) | 7.59 |
| `#E8B04B` (dark `warn`) | `#161F29` (dark `surface`) | 8.51 |

- The three "21" rows use the same tolerance, because the float result need not be exactly 21. The "exactly 1" rows are exact: both sides of the division are the same number.
- Two-decimal rows compare `Number(contrast(a, b).toFixed(2))`.
- Every palette row is also asserted with its arguments swapped.
- The palette rows are hand arithmetic (the critique's recomputation agrees to the second decimal). Before pinning them, the tests lane recomputes each with its scratch reference implementation of the formula above. Where the second decimal differs, the formula wins and the lane reports the row.

### 7.2 `tests/renderer/palette.test.ts`

Shape:
- `PALETTE_KEYS` is exactly the 17 keys of 5.1.
- `PALETTE.light` and `PALETTE.dark` each have exactly those keys.
- Every value matches `/^#[0-9A-F]{6}$/`.
- `cssVar` gives `--bg`, `--on-accent`, `--lane-v`, `--lane-a` for `bg`, `onAccent`, `laneV`, `laneA`.

Values: both modes equal the two palette blocks of 5.1 of this plan (architecture 5.3 with light `ok` = `#167447`), written out literally in the test (34 values). A changed token is therefore a visible test change for the owner.

`windowBackgroundFor`:
- `windowBackgroundFor(false) === '#EDF0F4'` and equals `PALETTE.light.bg`.
- `windowBackgroundFor(true) === '#0F151C'` and equals `PALETTE.dark.bg`.
- Each equals the `--bg` value collected from the matching `styles.css` block (below), compared case-insensitively.

Ratios, architecture 7.10, each for `light` and `dark`:
1. `ink`, `muted`, `ok`, `bad`, `warn`, `accent` against `bg` and against `surface` ≥ 4.5.
2. `onAccent` against `accent` ≥ 4.5.
3. `field` and `accent` against `bg` and against `surface` ≥ 3.
4. `laneV` and `laneA` against `track` and against `surface` ≥ 3.

Hand-computed values of every required pair (all pass):

| Pair | Light | Dark | Needs |
|---|---|---|---|
| `ink` / `bg`, `surface` | 14.43, 16.50 | 15.01, 13.61 | 4.5 |
| `muted` / `bg`, `surface` | 5.34, 6.11 | 7.15, 6.48 | 4.5 |
| `ok` / `bg`, `surface` | 5.07, 5.80 | 8.76, 7.95 | 4.5 |
| `bad` / `bg`, `surface` | 5.72, 6.54 | 7.28, 6.60 | 4.5 |
| `warn` / `bg`, `surface` | 5.25, 6.00 | 9.39, 8.51 | 4.5 |
| `accent` / `bg`, `surface` | 6.69, 7.65 | 7.72, 7.00 | 4.5 (and 3) |
| `onAccent` / `accent` | 7.65 | 7.59 | 4.5 |
| `field` / `bg`, `surface` | 3.14, 3.59 | 3.80, 3.44 | 3 |
| `laneV` / `track`, `surface` | 6.16, 7.65 | 5.62, 7.00 | 3 |
| `laneA` / `track`, `surface` | 4.20, 5.22 | 6.19, 7.71 | 3 |

- The light `ok` row is for `#167447`. The smallest margins among the required pairs are light `field` on `bg` (3.14 against 3) and light `ok` on `bg` (5.07 against 4.5).
- `--line` on `--surface` is about 1.4 in light mode. No assertion covers it; it is decoration (D5).

Extra assertions beyond 7.10 (Q3, decided): every text token (`ink`, `muted`, `ok`, `bad`, `warn`, `accent`) against `chrome`, `hover` and `tint` ≥ 4.5, in both modes. That is 36 assertions. C3 and C5 put text on those surfaces.

Hand-computed values (all pass with light `ok` = `#167447`):

| Token | Light: `chrome`, `hover`, `tint` | Dark: `chrome`, `hover`, `tint` |
|---|---|---|
| `ink` | 13.39, 13.92, 14.76 | 15.62, 12.07, 12.43 |
| `muted` | 4.96, 5.15, 5.46 | 7.44, 5.75, 5.92 |
| `ok` | 4.70, 4.89, 5.18 | 9.12, 7.04, 7.25 |
| `bad` | 5.30, 5.51, 5.85 | 7.57, 5.85, 6.02 |
| `warn` | 4.87, 5.06, 5.37 | 9.77, 7.55, 7.77 |
| `accent` | 6.21, 6.45, 6.84 | 8.03, 6.21, 6.39 |

- These are asserted only as "≥ 4.5", never pinned to a value. Four of them sit near a rounding edge in my arithmetic (light `bad`/`tint` 5.846, dark `warn`/`hover` 7.545, dark `accent`/`hover` 6.205, dark `accent`/`surface` 6.9999); none is near its threshold.
- The tightest are light `ok` on `chrome` (4.70), light `warn` on `chrome` (4.87) and light `ok` on `hover` (4.89).
- With the architecture's `#17784A`, light `ok` on `chrome` is 4.46 and fails; that is the reason for the adjustment in 5.1.

`field` is not asserted against `chrome`, `hover` or `tint` (decided). Measured, for the record:

| | Light: `chrome`, `hover`, `tint` | Dark: `chrome`, `hover`, `tint` |
|---|---|---|
| `field` | 2.92, 3.03, 3.21 | 3.95, 3.05, 3.14 |

Light `field` on `chrome` is under 3, so the rule "no `--field` boundary on `--chrome`" stands in 5.3 and section 9 instead of a test.

If the real computation puts any asserted pair under its threshold, the tests lane stops and reports it. The architecture lets C1 adjust the token and list it for the owner; a further adjustment goes through the orchestrator, not the lane.

"Every token in `styles.css` equals `PALETTE`":
- Read the file as text: `readFileSync(fileURLToPath(new URL('../../src/renderer/src/styles.css', import.meta.url)), 'utf8')`.
- Remove comments with `/\/\*[\s\S]*?\*\//g`.
- Light block: the body of the first rule whose selector is exactly `:root`, matched by `/(?:^|\})\s*:root\s*\{([^}]*)\}/`. `:root:lang(ar)` does not match.
- Dark block: the body captured by `/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/`.
- In each body, collect declarations with `/(--[\w-]+)\s*:\s*([^;]+);/g`, trimming the value. The name pattern takes digits and capitals, so an extra `--z1` is seen. The trailing `;` is required: a last declaration without it is not collected and the block fails as incomplete.
- Assert, per mode:
  - both blocks are found;
  - exactly 17 declarations are collected, so a duplicated name fails whatever its values;
  - the set of collected names equals `PALETTE_KEYS.map(cssVar)` exactly, with no extra and no missing name;
  - each value equals `PALETTE[mode][key]`, compared case-insensitively. The shorthand `#FFF` for `#FFFFFF` fails here; that is deliberate.
- "Rest of the file" is the comment-free text with each of the two captured bodies replaced by the empty string. Assert on it:
  - no match of `/#[0-9a-fA-F]{3,8}\b/`;
  - for every name in `PALETTE_KEYS.map(cssVar)`, no declaration of it: no match of `new RegExp('(?<![\\w-])' + name + '\\s*:')`. A use such as `var(--bg)` has no colon after the name and does not match; `--line` does not match inside a longer name. This catches a later `:root { --bg: … }`, `body { --accent: … }` and `:root:lang(ar) { --bg: … }`.
- Assert the old names are gone: no match of `/--(panel|text|bar|accent-text)\b/` in the whole file.

What the `styles.css` assertions do not prove:
- The hex assertion sees only `#hex`. A literal `rgb()`, `hsl()` or named colour passes; `styles.css:424` is one today (C5 owns it). Review, not this test, holds "tokens only" for those forms.
- The hex pattern also matches an ID selector that starts with 3 to 8 hex letters, such as `#add`, `#feed`, `#bad` or `#added`. `#root` (`styles.css:53`) does not match. C3 to C6 style by class, or pick an id that does not start that way (section 9).

Window background in `src/main/appearance.ts`, read as text the same way:
- it matches `/windowBackgroundFor\(\s*nativeTheme\.shouldUseDarkColors\s*\)/`;
- it has no match of `/#[0-9a-fA-F]{6}\b/`.

The module imports `electron`, which no test in this repository loads, so it is checked as text and not imported. The choice of value is proved by the direct `windowBackgroundFor` tests above.

### 7.3 `tests/logo.test.ts`

- `LOGO_BOX === 256`; `LOGO_COLORS` equals `{ plate: '#1E3AA8', strand: '#FFFFFF', strandAlt: '#4FE0CC' }`.
- `LOGO.plate` equals `{ kind: 'rect', x: 8, y: 8, width: 240, height: 240, radius: 60, fill: '#1E3AA8' }`.
- `LOGO.left`: start `[84, 40]`; segments line to `[84, 92]`, then quad control `[84, 132]` to `[128, 152]`; width 30, cap `round`, colour `#FFFFFF`.
- `LOGO.right`: start `[172, 40]`; line to `[172, 92]`; quad control `[172, 132]` to `[128, 152]`; width 30, `round`, `#4FE0CC`.
- `LOGO.stem`: start `[128, 150]`; line to `[128, 176]`; width 30, `round`, `#FFFFFF`.
- `LOGO.head`: points `[[88, 170], [168, 170], [128, 220]]`, fill `#FFFFFF`.
- `LOGO_SHAPES` is `[plate, left, right, stem, head]`, the same objects in that order.
- `strokePath(LOGO.left) === 'M84 40 L84 92 Q84 132 128 152'`.
- `strokePath(LOGO.right) === 'M172 40 L172 92 Q172 132 128 152'`.
- `strokePath(LOGO.stem) === 'M128 150 L128 176'`.
- Mirror property: for every point of `left`, `[256 − x, y]` is the matching point of `right`.

### 7.4 `tests/renderer/icons.test.ts`

Data (imports `model/icons.ts`):
- `ICON_NAMES`, sorted, equals the 22 names of 5.4, sorted; there are no duplicates.
- `Object.keys(ICONS)`, sorted, equals the same list.
- Every icon has at least one shape.
- Every `path` has a non-empty `d` matching `/^[MmLlHhVvAaQqZz0-9 .,-]+$/`.
- Every `circle` and `rect` number is finite and lies in 0..24.
- `[...MIRRORED_ICONS].sort()` equals `['chevronEnd', 'open']`.

Text, read as in 7.2:
- `components/Icon.tsx` contains `<svg`, `aria-hidden="true"` and `viewBox="0 0 24 24"`, and contains no `<span` and no `JSX.Element`.
- `App.tsx` and every `components/*.tsx` contain none of the code points U+2699, U+2715, U+275A, U+25B6, U+21BB, U+1F5D1, U+1F4C1, U+25BE, U+25B8 (today's ⚙ ✕ ❚ ▶ ↻ 🗑 📁 ▾ ▸).
  - The test file writes them as numbers, not as literal glyphs: `source.includes(String.fromCodePoint(0x1F5D1))` per code point, or one regex with `\u{…}` escapes and the `u` flag.
  - A literal emoji inside a regex character class without the `u` flag fails `npm run lint` (`no-misleading-character-class`).
- `styles.css` contains no `.twisty[aria-expanded='false']` rule with `scaleX`.

"Every name used in components exists" is a typecheck guarantee, not a vitest case:
- `Icon`'s `name` prop is `IconName`, and `npm run typecheck` compiles `src/renderer/src/**` (`tsconfig.web.json:16`). A misspelt or removed name fails the gate.
- `JobRow`'s map is `Record<JobVerb, IconName>`, so a verb with no icon also fails the gate.
- The tests lane states this in its report and adds no runtime test for it.

### 7.5 Not testable in vitest (manual checklist, section 10)

Font rendering, per-glyph fallback, `tabular-nums` in the real font, column fit in the wider font, the look of the controls, RTL mirroring on screen, and no flash on a theme switch.

## 8. Gates

The orchestrator runs these itself, serially, from the worktree root.

Before the tests lane starts, the orchestrator installs the two font packages. Workers do not install packages; a worker sandbox may have no registry access.

```bash
npm install --save-dev --save-exact @fontsource/ibm-plex-sans@5.3.0 @fontsource/ibm-plex-sans-arabic@5.3.0
```

- `package.json` and `package-lock.json` change by this command only and are committed with C1.
- The install needs the npm registry and changes `node_modules` by exactly two folders under `node_modules/@fontsource`. The orchestrator's before and after listing should show only those.

The three standing gates:

```bash
npm run typecheck
npm run lint
npm test
```

C1's extra gates, Git Bash:

```bash
npm run build

# 1. Six woff2 files were emitted (prints 6)
ls out/renderer/assets/*.woff2 | wc -l

# 2. No remote font host and no inlined asset (prints nothing; exit status 1)
grep -rIlE "googleapis|gstatic|url\(data:" out src

# 3. No old token name under src/renderer (prints nothing; exit status 1)
grep -rnE -e "--(panel|text|bar|accent-text)\b" src/renderer

# 4. Size to record in the commit message (last line is the total in bytes)
du -cb out/renderer/assets/*.woff2 out/renderer/assets/*.woff | tail -1

# 5. No data: URI of any form in the built CSS (prints nothing; exit status 1)
grep -l "data:" out/renderer/assets/*.css
```

The same in PowerShell:

```powershell
npm run build

# 1. prints 6
(Get-ChildItem out/renderer/assets -Filter *.woff2).Count

# 2. prints nothing (font binaries are skipped, as grep -I skips them)
Get-ChildItem out, src -Recurse -File | Where-Object { $_.Extension -notin '.woff', '.woff2' } | Select-String -Pattern 'googleapis|gstatic|url\(data:' -List | ForEach-Object { $_.Path }

# 3. prints nothing
Get-ChildItem src/renderer -Recurse -File | Select-String -CaseSensitive -Pattern '--(panel|text|bar|accent-text)\b' | ForEach-Object { "$($_.Path):$($_.LineNumber)" }

# 4. total bytes
(Get-ChildItem out/renderer/assets -Include *.woff2, *.woff -Recurse | Measure-Object Length -Sum).Sum

# 5. prints nothing
Select-String -Path out/renderer/assets/*.css -Pattern 'data:' -List | ForEach-Object { $_.Path }
```

- Gate 1 expects the file names of PF-1 point 3: `ibm-plex-sans-latin-<weight>-normal-<hash>.woff2` and the Arabic equivalents.
- Gate 2 is the architecture's wording and does not match the quoted form `url("data:…")`. Gate 5 covers it: it is what PF-1 measured (no `data:` in the CSS bundle at all).
- If gate 2 or gate 5 hits a string inside a library bundle, the orchestrator reports the file and line and does not loosen the pattern on its own.

End-to-end (Q6, accepted): after the gates pass, the orchestrator runs `npm run e2e:real` once, alone and serially. C1 changes the markup inside the buttons that e2e clicks, and a break is cheapest to find here. The architecture's own schedule (from C3) is unchanged.

## 9. Boundary check

| Value that crosses | Meaning in C1 | Consumer and its reading |
|---|---|---|
| `src/renderer/src/model/` | Created by C1 with `contrast.ts` and `icons.ts` | **C2** adds its model files to the same folder. No name clash: C2 creates `lanes`, `summary`, `finished`, `thumbnail`, `rowEqual`, `settingsSection`. |
| `App.tsx` | C1 edits lines 109-111 only (the close glyph) | **C2** edits it only so the wider `Banner` compiles. Different lines; C2 runs after C1 in the same worktree. |
| `Job`, `Snapshot`, strings, `format.ts`, `banners.ts` | Not touched by C1 | **C2** owns them. C1 and C2 exchange no value. |
| Token names (17 CSS custom properties) | Kebab-case of the `PALETTE` keys; values per mode from 5.1 of this plan | **C3–C6** use tokens only, never a literal colour. The 7.2 test fails on any `#hex` outside the palette blocks, on any extra custom property inside them, and on a palette name declared anywhere else. It does not see `rgb()`, `hsl()` or named colours; review holds those. |
| Light `ok` | `#167447`, not the architecture's `#17784A` | **C3–C6** read `--ok` and `PALETTE`, never the architecture table's literal. |
| ID selectors in `styles.css` | The hex assertion also matches an id that starts with 3 to 8 hex letters (`#add`, `#feed`, `#bad`) | **C3–C6** style by class, or choose an id that does not start that way. |
| `--line` against `--field` and `--accent` | `--line` is decoration; a required boundary is `--field` or `--accent` | **C3–C6**: the empty-lane outline, drawer fields and outline buttons use `--field`, as D5 says. |
| `--field` on `--chrome` | Not allowed: light `field`/`chrome` is 2.92, under 3:1. No test asserts it | **C3** and **C5**: no field, select or outline button sits directly on `--chrome`. A control on chrome is borderless (as the mockup's rail), or sits on a `--surface` or `--bg` panel, or takes `--accent` as its boundary (6.21 on light chrome). Light `field`/`hover` is 3.03: allowed, with almost no margin. |
| `--lane-v`, `--lane-a`, `--track` | Lane fills and their track; 3:1 against `--track` and `--surface` is tested | **C4** draws lanes on `--track` inside a `--surface` row. A lane on any other background is not covered by a test. |
| `--chrome`, `--hover`, `--tint` | Defined, unused in C1. Every text token reaches 4.5 on each, in both modes, and the test asserts it | **C3** (rail, strip, hover states) and **C5** may put `ink`, `muted`, `ok`, `bad`, `warn` or `accent` text on them. |
| `windowBackgroundFor(dark)` | The window background, equal to CSS `--bg` of that mode | **`appearance.ts`** in C1. **C8** and **C9** do not read the palette. |
| `IconName` and the 22 names | A name never changes meaning or geometry owner. A later component may add a name to `icons.ts` with its test row, but never renames or removes one | **C3** (rail and banner icons), **C4** (kind and action icons), **C5** (section icons, install rows), **C6** (fallback tile). |
| `Icon` output | One `<svg aria-hidden="true">`, no `span`, no text, no wrapper | **C3** banners (`p.banner` first `span` stays the text) and **C4** rows. Both section-8 rows rely on this. |
| `Icon` in a grid | `.icon { display: block; flex: none }` gives no grid placement. `.job-main` and `.group-head` are grids (`styles.css:226-240`), so an `svg` placed as a sibling of `.job-name` becomes its own grid cell | **C4** places the kind icon itself: inside an existing cell, or with its own column. C1 puts no icon directly into those grids (the twisty's icon is inside its button). |
| `MIRRORED_ICONS` | `chevronEnd` and `open` flip under RTL, and the icon flips itself | **C4**'s collapse control and its "open" action must not flip their buttons as well. `retry` does not flip. |
| Base classes | `.icon`, `.icon-mirror`, `.icon-btn`, `.metric`, `button.primary`; the element styles of `button`, text and number `input`, `select`, checkbox; `:focus-visible` | **C3–C6** reuse them. An icon button is 30px wide; a container rule of specificity above 0,1,0 that sets button padding needs its own `.icon-btn` override, as `.job-actions` has. **C4** may set a negative `outline-offset` on rows for PC-1 without changing the ring's colour or width. |
| Reduced-motion block | The only one; removes all animation and transition | **C3–C6** add no second block and design each animated element so its static style is the readable final state. **C3**'s `data-hidden` rule is separate and unaffected. |
| Font stack and sizes | One stack for both languages; 14px/1.45 and 15px/1.65 | **C3–C6** set no `font-family` (the pairing code's inline `monospace` at `SettingsDialog.tsx:107` is C5's to keep or change). |
| Font weights and styles | 400, 500, 600 are bundled; 700 and italic are not | **C3–C6** use only those three weights and no italic. |
| Font subsets | Latin and Arabic only; other scripts fall back per glyph to Segoe UI | **C3–C6** fix no width or height that assumes Plex metrics for user-supplied text (titles, file names). |
| `LOGO`, `LOGO_SHAPES`, `LOGO_BOX`, `LOGO_COLORS`, `strokePath` | 256-unit geometry of 5.3, back-to-front paint order, round caps, stroke width 30 | **C3** `LogoMark` draws `LOGO_SHAPES` in order as inline SVG with `viewBox="0 0 256 256"`. **C8** `logoBitmap` rasterises the same list in the same order. The pixel table in architecture 7.8 assumes that order: at 256, (128, 196) is the head and (172, 60) the teal strand. Both sides read colours from the shapes, not from the palette. |

## 10. Manual checks for C1

A subset of architecture section 9, on the built app (`npm run build`, then `npm start`):

1. (9.2) Light, dark and follow-system from Settings. Switching the Windows mode with "system" selected updates the window with no flash of the old background, including while resizing the window edge.
2. (9.3) Network off: text renders in IBM Plex Sans in English and in IBM Plex Sans Arabic in Arabic. DevTools, Computed, "Rendered Fonts" names them. The Network panel shows no request other than local files.
3. (9.1, part) Arabic: a collapsed playlist's arrow points left and an open one points down. Play, pause, folder, retry and trash look the same as in English. Sizes, speeds and percents read left to right.
4. Arabic row with a size, speed and `2/3`: digits are Latin and match the English digits in shape and width. `≤720p` shows a readable `≤`.
5. (9.4) Windows "Animation effects" off: the progress bar jumps and does not glide; nothing else moves.
6. (9.11, part) Keyboard only: Tab reaches every button, field and select of the main window, the Add dialog and Settings. The focus ring is visible on each, on the primary button too, in both modes.
7. Every icon button (Settings, close message, folder, pause, resume, cancel, retry, remove, delete file, playlist pause, resume and cancel, the arrow) is announced by its name, not by a glyph. Each one that has a tooltip today still shows it: all of them except the close-message button and the playlist arrow, which have no `title`.
8. A running download: the digits in the size and speed columns do not shift sideways as they change.
9. `npm run dev`: the fonts also load from the dev server (not probed by PF-1).
10. Both modes: outline buttons and fields have a clearly visible edge on the header and on the dialog.
11. Column fit in the wider font, at the default window width (1120px, `index.ts:37`), in English and in Arabic, with a running download, a finished one and a playlist:
    - size, speed, quality, time left and added are not cut and do not overlap (the columns are fixed at 56, 136, 76, 80 and 100px, `styles.css:230`, and `.job-size` is never cut);
    - the action buttons of a finished row ("Open", folder, remove, delete file) fit the 156px column, so the columns of every row and of the headings still line up.
    - If the actions do not fit, the one permitted remedy inside C1 is to raise `min-width` at `styles.css:269` to the measured width; the orchestrator reports the new value to the owner. If a metric column does not fit, C1 stops and reports; column widths are an owner decision.
12. A download whose title has Latin-extended letters (for example "Łódź") and one with Cyrillic or Greek: the text is readable; the mixed fonts inside a word are the known limitation of section 11. Report how it looks to the owner.
13. English, Add dialog with a playlist that has an unavailable entry: the reason is upright and muted (it was italic). Shown to the owner (section 12).

## 11. Risks

- The contrast figures are hand arithmetic. If the real test finds a failing pair, C1 adjusts that token and lists it for the owner, as the architecture allows. The tightest pairs are named in 7.2.
- electron-vite 6's renderer build was not probed. Gates 1, 2 and 5 catch a difference.
- `tabular-nums` and the fallback for characters outside the subsets are known only after an eye check.
- Known limitation: only the Latin and Arabic subsets are bundled, as the architecture fixes. A title in Latin-extended, Cyrillic, Greek or another script falls back per glyph to Segoe UI, and a word such as "Łódź" mixes two fonts. Adding a subset is an owner decision and a new plan item.
- IBM Plex Sans is wider than Segoe UI, and the row grid has fixed columns sized for Segoe UI (`styles.css:230`). A metric may be cut or a row's actions may outgrow 156px. Manual check 11 decides; its remedy is stated there.
- The swap from glyphs to 16px icons changes button widths. Each icon button is 30px (5.4), so three of them and their gaps take 102px of `.job-actions`' `min-width: 156px` (`styles.css:266-270`), leaving 54px for the "Open" text button. Whether that is enough in Plex is confirmed by eye (check 11).
- Text tests on source files (7.2, 7.4) are sensitive to formatting. No formatter is configured in this repository, and the regular expressions tolerate whitespace.
- The `styles.css` test does not see `rgb()`, `hsl()` or named colours, and it trips on an ID selector that starts with hex letters (7.2).
- Pinning the font packages to an exact version means updates are manual. That is intended: the file paths are a probed contract.
- The app does not ship a built binary yet. When PR #9 (portable build) does, the OFL text must travel with the font files (Q5).
- A3 edits `App.tsx` in parallel. C1's edit there is three lines, so a rebase conflict is trivial.

## 12. Decisions and items listed for the owner

Decisions (recorded as decided by the orchestrator, 2026-11-24):

| # | Question | Decision |
|---|---|---|
| Q1 | The architecture's file list for C1 has no `model/icons.ts`, and names one test file. This plan adds `icons.ts` and three test files. | Proceeds as recommended in r1; the critique found it sound. D6 asks for testable data outside components, and a node test cannot import `Icon.tsx`. No contract changes meaning. |
| Q2 | Fonts: ship the woff copies (about 208 kB unused), or write own `@font-face` rules to woff2 only? | Decided: import the subset CSS as is; the woff copies ship. Revisit with PR #9 if download size matters. |
| Q3 | Add text-contrast assertions for `chrome`, `hover` and `tint`? | Decided: yes, for every text token (`ink`, `muted`, `ok`, `bad`, `warn`, `accent`), ≥ 4.5, both modes. Light `ok` becomes `#167447` so they pass. `field` gets no assertion on those surfaces; the rule "no `--field` boundary on `--chrome`" is written in 5.3 and section 9. |
| Q4 | If the bundled subset does not honour `tabular-nums`, what then? | Decided: keep Plex for text and let the owner choose between accepting the shift and a fixed-width digit fallback. Decide only if the eye check fails. |
| Q5 | Where does the OFL licence text ship? | Decided: a README notice now (5.2). Add the licence files to the packaged output in PR #9. |
| Q6 | Run `npm run e2e:real` after C1? | Decided: once after C1, alone and serially (section 8). |
| Q7 | Icon stroke 2.5 on a 24 box, default size 16px, taken from the mockup's weight. | Decided: accept; adjust by eye in C4 if the row icons look heavy at 15px Arabic text. |
| Q8 | Do `retry` and `open` mirror under RTL? | Decided: `open` mirrors, following the common RTL icon convention; `retry` does not. `MIRRORED_ICONS` is `chevronEnd` and `open`. |
| — | Who installs the font packages? | Decided: the orchestrator, before the tests lane, with the command in section 8; `package.json` and `package-lock.json` are committed with C1. |
| — | How is the window background tested? | Decided: the pure `windowBackgroundFor(dark)` in `src/shared/palette.ts`, tested directly; `appearance.ts` calls it. |

Listed for the owner (each may be overturned; none blocks C1):

| Item | What changed | Where |
|---|---|---|
| Token adjustment | Light `ok`: `#17784A` → `#167447`. The architecture allows C1 to adjust a token and list it. The architecture's 5.3 table keeps the old value because that file is frozen. | 5.1, 7.2 |
| Visible change in English | Unavailable-entry reasons in the Add dialog lose their italics (`.entries em { font-style: normal }`), because no italic face is bundled and Arabic has none. | 5.2, check 13 |
| Known limitation | Latin and Arabic subsets only; other scripts fall back per glyph. | 6, 11, check 12 |
| Possible layout remedy | `.job-actions` `min-width` may be raised if the finished row's buttons do not fit in Plex. | check 11 |

## Changes from r1

- **B1** — fixed: `Icon` has no return-type annotation, like the existing components; 5.4 says why (`@types/react` 19, `types: []`, TS2503), and 7.4 asserts `Icon.tsx` holds no `JSX.Element`.
- **N1** — fixed: verified by search. 5.4 now lists `…` (`strings.ts:17, 52, 54, 102, 137, 151, 163`) and `’` (`strings.ts:156`) as text that stays; the "no non-ASCII" sentence covers only `banners.ts` and `components/quality.ts`.
- **N2** — fixed by rewording, with no new `title`: verified `App.tsx:109` and `GroupRow.tsx:34` have none. The glyph table has a "`title` today" column, the hook paragraph says "keeps its accessible name, and its `title` where it has one", and manual check 7 excludes those two buttons.
- **N3** — fixed as decided: the subsets stay Latin and Arabic. Added the edge-case row ("Łódź"), manual check 12, a known-limitation entry in section 11 and section 12, an out-of-scope line, and a boundary row.
- **N4** — fixed as decided: the extra assertions cover all six text tokens on `chrome`, `hover` and `tint`; light `ok` becomes `#167447`. I recomputed the orchestrator's figures and they hold: 4.70 chrome, 5.07 bg, 5.80 surface, 4.89 hover, 5.18 tint. The `field`-never-on-`chrome` rule (2.92) is in 5.3, the CSS comment and the boundary table, with light `field`/`hover` 3.03 noted and no assertion.
- **N5** — fixed: all three "21" rows use `toBeCloseTo(21, 10)`; added rejects `#12345`, `#1234567`, `'#FFFFFF\n'`, `['#FFFFFF']`, `new String('#FFFFFF')`; `typeof !== 'string'` throws before any pattern test; non-string rows use `as unknown as string`.
- **N6** — fixed: the test asserts no palette name is declared outside the two blocks (regex given, with the `var(--bg)` and prefix cases explained). The boundary claim is reworded to "any `#hex`", and 7.2 says `rgb()`, `hsl()` and named colours are not seen (`styles.css:424`).
- **N7** — fixed: name pattern `--[\w-]+`; exactly 17 declarations per block; the trailing `;` is required; the `#FFF` shorthand failing is stated as deliberate; the ID-selector trap is noted in 7.2, section 9 and section 11.
- **N8** — fixed as decided: `windowBackgroundFor(dark: boolean): string` in `src/shared/palette.ts`, tested directly and against the CSS `--bg` per mode; `appearance.ts` calls it and the text check matches that call.
- **N9** — fixed: 7.4 names the code points by number and requires `String.fromCodePoint` or `\u{…}` with the `u` flag, citing `no-misleading-character-class`.
- **N10** — fixed: manual check 11 (1120px, verified at `index.ts:37`, both languages), an edge-case row and a risk entry. I added a stated remedy so a failure does not become an unplanned deviation.
- **N11** — fixed: verified `.job-actions button` (`styles.css:393-395`) outranks `.icon-btn`. Added `.job-actions .icon-btn { padding: 2px 6px; }`, so an icon button is 30px everywhere. The 156px claim is redone as arithmetic (102px for three icon buttons, 54px left for "Open") and handed to check 11. To make that arithmetic hold for playlists, the plan now says `GroupRow`'s three action buttons get `icon-btn` and the twisty does not; r1 left this unstated.
- **N12** — fixed as decided: the rule stays; 5.2, section 12 and manual check 13 list it as a visible English change the owner may overturn.
- **N13** — fixed: gate 5 (no `data:` at all in `out/renderer/assets/*.css`) in both shells; the PowerShell gate 2 now skips `.woff` and `.woff2`, as `grep -I` does.
- **N14** — fixed as decided: section 8 gives the exact install command, run by the orchestrator before the tests lane; workers do not install; both package files are committed with C1.
- **N15** — fixed: a boundary row says `.icon` gives no grid placement and that `.job-main` and `.group-head` are grids, so C4 places the kind icon itself.
- **N16** — fixed as decided: `open` mirrors, `retry` does not; `MIRRORED_ICONS` is `['chevronEnd', 'open']` in 5.4, 7.4 (compared sorted), the RTL list and the boundary row.
- **N17** — fixed with N4: Q3 is recorded as decided with the failing pairs visible (old `ok` 4.46 on chrome, `field` 2.92 on chrome), and the full 36-figure table is in 7.2.

Notes at freeze:
- The 36 extra-pair figures and the `field` row are hand arithmetic, confirmed by the critique and by the orchestrator's own computation; the tests compute the real values. They are asserted only as "≥ 4.5", so no test pins them; the tightest is 4.70.
- Q1 was not in the orchestrator's decision list. It proceeds on the r1 recommendation, which the orchestrator accepts.
