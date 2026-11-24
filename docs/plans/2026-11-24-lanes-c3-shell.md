# Fetchly "Lanes" UI redesign — C3 Shell: rail, summary strip, URL bar, banners, empty states

- Date: 2026-11-24. Branch: `feat/lanes-redesign`. File: `docs/plans/2026-11-24-lanes-c3-shell.md`. Revision r2 (after plan-critique r1: 3 BLOCKING, 19 NON-BLOCKING).
- Parent: `docs/plans/2026-11-24-lanes-redesign-architecture.md` (r3, frozen). Its D1–D12, section 5.3, the C3 section, 7.2, 7.3, 7.10, sections 8 and 9 and the provisional table bind this plan.
- Previous components: `docs/plans/2026-11-24-lanes-c1-foundation.md` (r2, frozen) and `docs/plans/2026-11-24-lanes-c2-view-models.md` (r2, frozen). Both land before C3.
- Class: component plan of a large task. No migration and no saved-state change, so no rollback section.
- The plan lane is read-only and ran nothing. The orchestrator ran three probes:
  - PV-1 (`.superpowers/design/probe-pv1.md`), visibility and pause;
  - PC-1 (`.superpowers/design/probe-pc1.md`);
  - PW-1 (`.superpowers/design/probe-pw1.md`), window width against viewport width.
- Every expected value in section 6 is hand arithmetic from `format.ts`; the tests decide.
- Decisions that bind this revision are listed in section 13.1: the owner's advisor on widths (`.superpowers/design/advisor-c3-width.md`) and the orchestrator's decisions on N-1, N-2, N-5, N-11, Q4 and Q6.
- Sources read:
  - the three frozen plans, the three probe records, the advisor's decision, and the mockup (`fetchly-ui-directions.html:144-148, 165-180, 385-401, 598-603, 1160-1179, 1425-1436, 1549-1559`);
  - `src/renderer/src/App.tsx`, `banners.ts`, `format.ts`, `strings.ts`, `strings.ar.ts`, `styles.css`, `main.tsx`;
  - `components/UrlBar.tsx`, `JobList.tsx`, `GroupRow.tsx`, `SettingsDialog.tsx`, `InstallScreen.tsx`, and the class names of `JobRow.tsx`;
  - `src/main/index.ts:1-100`, `e2e/real/lib.mjs:216-232, 312-421`, the selectors of `e2e/real/checks.mjs`;
  - `docs/manual-checklist-phase2.md`, `docs/manual-checklist-phase1.md` (rows that name Settings), `tests/renderer/strings.test.ts`, `package.json`, `eslint.config.mjs`, `tsconfig.node.json`.
- `AGENTS.md`, `.ai/agents/*.md` and `.ai/security-paths.json` do not exist in this worktree. The code, the `package.json` scripts and `docs/` are the source of truth.
- Line numbers are from this worktree, at the C2 plan commit. C1's and C2's code is not here.
  - `App.tsx`, `UrlBar.tsx` and `styles.css` are cited pre-C1. C1 adds an `Icon` import to the components and rewrites parts of `styles.css`, so those lines shift. Each rule is also named by its selector.
  - `tests/renderer/icons.test.ts` and `tests/renderer/palette.test.ts` are C1's and are not in this worktree. They are cited through C1's plan (its 7.2 and 7.4).
- **Widths in this plan are viewport px** (`window.innerWidth`, what a media query sees) unless a figure is called an outer window size. PW-1 measured the viewport as the outer width minus 15px at 150% scaling.

## 1. Context

C3 builds the new window frame: a rail on the start side with the app mark, the five filters with counts and Settings; a summary strip; the URL bar with `Ctrl+L`; the banners with an icon and tone; the two empty states. It also implements D4's pause-while-hidden and lowers the window's minimum width to 720 (outer). The download rows keep today's look until C4 (D8).

## 2. Scope

In scope:
- `Rail`, `SummaryStrip`, `Banners` and `LogoMark` components, and the `App` layout that holds them.
- Settings moves from `header.urlbar` to the rail. `App` holds `settingsAt` in place of `showSettings`. `SettingsDialog` gains `initialSection`.
- The port-busy banner's "Open settings" button.
- The two empty states in `JobList`.
- `Ctrl+L` focuses the link field.
- `data-hidden` on `<html>` from `visibilitychange`, and its one CSS rule (D4). Section 5 holds the amendment after PV-1.
- `minWidth: 720` in `src/main/index.ts`. `width: 1120` does not change.
- The row grid's breakpoints and name minimums, changed so today's rows, playlist members and playlist heads still fit beside the rail (section 4.9). This is an interim rule until C4.
- One new icon, `errorCircle`, so banner tone is not carried by colour alone (Q4).
- The `e2e/real/lib.mjs` selector and row 1 of `docs/manual-checklist-phase2.md`.

Out of scope for C3:
- Rows, lanes, the bracket, `content-visibility`, `sameRow`, any animation (C4). C3 adds no animation or transition of its own.
- The drawer, the focus trap, Esc, focus return, the Downloads heading, the Add sheet, the install card (C5). `SettingsDialog` changes only by the `initialSection` prop and the heading attributes it needs.
- Toasts, thumbnails, `finishedEvents`, the snapshot receive function (C6). `App.tsx:36,40` keep passing `setSnapshot` directly.
- Any main-process change other than the `minWidth` number. The default width stays 1120 (advisor decision 1).
- Any change to a shared contract: `summary`, `filterCounts`, `Banner`, `SettingsSection`, `Filter`, `matchesFilter`.
- Forced-colours verification (architecture section 3). C3 writes one small forced-colours block and does not verify it (section 13.1, DV-1).
- `docs/manual-checklist-phase1.md`: no row describes where the Settings button or the filters sit. Only lines 12 and 34 name Settings, and neither says where its button is. C10 creates `docs/manual-checklist-ui-lanes.md`.

## 3. Files

### Created

| File | Content |
|---|---|
| `src/renderer/src/components/Rail.tsx` | The `nav.rail` (4.2) |
| `src/renderer/src/components/SummaryStrip.tsx` | The strip (4.3) |
| `src/renderer/src/components/Banners.tsx` | Persistent banners and the transient message (4.5) |
| `src/renderer/src/components/LogoMark.tsx` | The Zip mark as inline SVG (4.2) |
| `src/renderer/src/components/showAllContext.ts` | `ShowAllContext` (4.6). Addition to the architecture's file list (DV-4, DV-6) |
| `src/renderer/src/frame.ts` | Pure shell rules (section 6). Addition to the architecture's file list (DV-4) |
| `tests/renderer/frame.test.ts` | Section 6.1 to 6.6 |
| `tests/renderer/strip.test.ts` | Section 6.7 |
| `tests/renderer/shellSources.test.ts` | Section 6.8, text checks |

### Modified

| File | Change |
|---|---|
| `src/renderer/src/App.tsx` | Layout (4.1); `settingsAt`; the `visibilitychange` effect; `Rail`, `SummaryStrip`, `Banners`; `ShowAllContext`. `FILTERS` (line 13), `totalSpeed` (line 77), `actionLabels` (line 78), the `nav.filters` block (84-93) and both banner blocks (95-113) go. On line 10 only `formatSpeed` leaves the import; `type Filter` stays. |
| `src/renderer/src/components/UrlBar.tsx` | The Settings button (lines 47-49) and the `onOpenSettings` prop (line 7) go; `Ctrl+L` (4.4). |
| `src/renderer/src/components/JobList.tsx` | The two empty states only (lines 15-22 and 41). Props unchanged. |
| `src/renderer/src/components/SettingsDialog.tsx` | `initialSection` prop; `data-section` and `tabIndex={-1}` on the three `h3` (lines 100, 194, 295); one mount effect (4.7). |
| `src/renderer/src/format.ts` | Add `StripFigure`, `StripFigures`, `stripFigures` (6.7). Nothing else. |
| `src/renderer/src/model/icons.ts` | Append `errorCircle` to `ICON_NAMES` and add its entry to `ICONS` (4.5). |
| `src/renderer/src/styles.css` | Section 4.8 and 4.9, including the two comments at lines 221-225 and 289. |
| `src/renderer/src/strings.ts`, `strings.ar.ts` | Section 4.10. |
| `src/main/index.ts` | Line 39: `minWidth: 760` becomes `minWidth: 720`. Lines 36-37 (the comment and `width: 1120`) are not edited; the comment stays true (4.9). |
| `e2e/real/lib.mjs` | Line 408 (section 8). |
| `docs/manual-checklist-phase2.md` | Row 1, line 22 (section 8). |
| `tests/renderer/icons.test.ts` (C1's) | The name list goes from 22 to 23 (section 9). |

Not modified: `banners.ts`, every file under `src/renderer/src/model/` except `icons.ts`, `src/shared/**`, `JobRow.tsx`, `GroupRow.tsx`, `AddDialog.tsx`, `InstallScreen.tsx`, `src/renderer/index.html`, `e2e/real/checks.mjs`, `package.json`, and every frozen plan.

### Imports

| Module | Imports |
|---|---|
| `frame.ts` | Type-only: `Filter` from `./format`; `BannerOpens`, `BannerTone` from `./banners`; `IconName` from `./model/icons`; `SettingsSection` from `./model/settingsSection` |
| `format.ts` | Adds `import type { Summary } from './model/summary'` |

- `frame.ts` sits beside `banners.ts` and `format.ts`, not under `model/`. A file under `model/` may not import `../format` (C2's extra check, its section 8), and `RAIL_ENTRIES` needs the `Filter` type.
- `frame.ts` uses no DOM global and no React. Tests are compiled under `tsconfig.node.json`, which has no DOM lib (lines 6, 23). Its key rule takes a structural type, not `KeyboardEvent`.
- No component has a return-type annotation and none names `JSX.Element` (C1 plan 5.4).

## 4. Design

### 4.1 `App` layout and state

DOM, in this order:

```
div.app  (key={lang})
├─ nav.rail                          Rail
├─ div.frame
│  ├─ header.urlbar                  UrlBar
│  ├─ section.strip                  SummaryStrip
│  ├─ div.banners                    Banners (rendered only when there is a banner or a message)
│  └─ main                           JobList, inside ShowAllContext
├─ AddDialog                         when adding is set (as App.tsx:119)
└─ SettingsDialog                    when settingsAt is not null
```

- The dialogs are `position: fixed` (`.backdrop`, `styles.css:421-429`), so they take no grid cell.
- `main.install` (`InstallScreen.tsx:26`) is unchanged and still replaces the whole frame (`App.tsx:65-75`). No rail shows on the install screen.

State changes:

```ts
const [settingsAt, setSettingsAt] = useState<{ section: SettingsSection | null } | null>(null);
```

- The rail's button calls `setSettingsAt({ section: null })`.
- The banner's button calls `setSettingsAt({ section: sectionForOpens(opens) })`. It never goes through `runBannerAction`, which calls `window.fetchly[action]` (`App.tsx:53-62`).
- `SettingsDialog` renders when `settingsAt !== null`, with `initialSection={settingsAt.section}` and `onClose={() => setSettingsAt(null)}`. The `.dialog` node still leaves the DOM in the commit that closes it.

Derived per render, replacing `App.tsx:77`:

```ts
const counts = filterCounts(snapshot.jobs);      // C2, format.ts
const totals = summary(snapshot.jobs);           // C2, model/summary.ts
```

`showAll`, passed through `ShowAllContext`:

```ts
const showAll = useCallback(() => {
  setFilter('all');
  document.querySelector<HTMLElement>('nav.rail .rail-item')?.focus();
}, []);
```

- It sets the filter to `'all'`, then focuses the first `nav.rail .rail-item` (the All button), so a keyboard user is not left on a removed button.
- `useCallback` with no dependency keeps the context value the same on every render, so `JobList` is not re-rendered by the context alone.
- It sits with the other top-level hooks, before the early returns at `App.tsx:64-65`.

The `visibilitychange` effect is in section 5. It also sits before the early returns, and outside the `key={lang}` subtree.

### 4.2 `Rail` and `LogoMark`

```ts
// components/Rail.tsx
interface Props {
  filter: Filter;
  counts: Record<Filter, number>;
  onFilter(f: Filter): void;
  onOpenSettings(): void;
}
export function Rail({ filter, counts, onFilter, onOpenSettings }: Props)

// components/LogoMark.tsx
interface Props { size?: number; className?: string }   // size = 24
export function LogoMark({ size = 24, className }: Props)
```

DOM:

```html
<nav class="rail" aria-label={S.railLabel}>
  <div class="rail-brand">
    <svg class="logo-mark" …/>                       <!-- LogoMark -->
    <span class="rail-name">{S.appName}</span>
  </div>
  <div class="rail-filters" role="group" aria-label={S.filterGroup}>
    <!-- one per RAIL_ENTRIES entry -->
    <button type="button" class="rail-item" aria-pressed={f === filter}
            aria-label={S.filters[f]} title={S.filters[f]}
            aria-describedby={`rail-count-${f}`}>
      <svg class="icon"/>                             <!-- Icon name={entry.icon} -->
      <span class="rail-label">{S.filters[f]}</span>
      <span class="rail-count metric" aria-hidden="true"><bdi dir="ltr">{countText(n)}</bdi></span>
      <span class="sr-only" id={`rail-count-${f}`}>{S.railCount(n)}</span>
    </button>
  </div>
  <button type="button" class="rail-item rail-settings" aria-label={S.settings} title={S.settings}>
    <svg class="icon"/>                               <!-- Icon name="gear" -->
    <span class="rail-label">{S.settings}</span>
  </button>
</nav>
```

- The DOM is the same at every width. The 56px form is CSS only (4.8).
- Each filter keeps its name as `aria-label` and `title` at every width, as the architecture says. The count is the button's description, through `aria-describedby`, and holds the exact number (Q11).
- The visible badge shows `countText(n)` and is `aria-hidden`. It shows at every value, 0 included, in both rail forms, as the architecture says ("shows its count as a badge"). There is no `is-zero` class.
- The Settings button's `aria-label` is exactly `S.settings` at every width. e2e selects `nav.rail button[aria-label=Settings]`.
- Ids are `rail-count-all`, `rail-count-downloading`, and so on. No CSS rule selects by id (C1 plan section 9, the hex-pattern trap).
- `LogoMark` draws `LOGO_SHAPES` in order inside `<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false">`, with `width` and `height` set to `size`.
  - A rect becomes `<rect>` with `rx={radius}`.
  - A stroke becomes `<path d={strokePath(s)} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round">`.
  - A polygon becomes `<polygon points="x,y x,y x,y">`.
  - Colours come from the shapes, not from tokens. The mark does not mirror under RTL (D2).

### 4.3 `SummaryStrip`

```ts
interface Props { summary: Summary }
export function SummaryStrip({ summary }: Props)
```

DOM, with `figs = stripFigures(summary)` and the four keys in the order `speed`, `active`, `remaining`, `eta`:

```html
<section class="strip" aria-label={S.summaryTitle}>
  <dl>
    <div class="strip-fig" title={S.summaryHints[key]}>
      <dt>{S.summary[key]}</dt>
      <dd class="metric">
        <!-- value known -->
        {fig.approx && <span class="sr-only">{S.about} </span>}
        <bdi dir="ltr">{fig.approx && <span aria-hidden="true">~</span>}{fig.value}</bdi>
        <!-- value null -->
        <span aria-hidden="true">—</span><span class="sr-only">{S.notKnown}</span>
      </dd>
    </div>
  </dl>
</section>
```

- What is seen is exactly `fig.text` (6.7): `~` in front when approximate, `—` when not known.
- A screen reader hears "about" in place of `~` and "not known" in place of `—`.
- The strip is not a live region. It changes up to four times a second.
- The strip replaces the lone speed figure of `App.tsx:90-92`.
- Labels are the architecture's defaults, unchanged (4.10). "Running" stays a different word from the rail's "Downloading".

### 4.4 `UrlBar` and `Ctrl+L`

```ts
interface Props {
  onProbed(url: string, probe: ProbeResult): void;
  /** False while a dialog is open: Ctrl+L then does nothing. */
  shortcutEnabled: boolean;
}
```

- `header.urlbar` keeps its `form`, the `input`, `button[type=submit]` and `p.error` (`UrlBar.tsx:29-56`). The Settings button goes.
- The input gains a ref and `aria-keyshortcuts="Control+L"`. `autoFocus` stays.
- A `<kbd aria-hidden="true">Ctrl+L</kbd>` sits between the input and the Add button. It is a key name, written as a literal like the language names at `SettingsDialog.tsx:202-205`, not a dictionary entry (Q8).
- One `keydown` listener on `window`, added in an effect and removed in its cleanup. When `shortcutEnabled && !e.defaultPrevented && isFocusLinkKey(e)`, it calls `e.preventDefault()`, then `focus()` and `select()` on the input.
- `App` passes `shortcutEnabled={adding === null && settingsAt === null}`.
- The listener does not exist on the install screen, where `UrlBar` is not mounted.

### 4.5 `Banners`

```ts
interface Props {
  banners: Banner[];
  pending: BannerAction | null;
  message: string | null;
  onAction(action: BannerAction): void;
  onOpenSettings(section: SettingsSection): void;
  onCloseMessage(): void;
}
export function Banners(props: Props)
```

The transient message shows only when `message` is truthy, as today (`App.tsx:106`): null and the empty string both show nothing. `Banners` returns `null` when `banners` is empty and `message` is not truthy. Otherwise:

```html
<div class="banners">
  <!-- per banner, in the order given -->
  <p class="banner persistent banner-{id} tone-{tone}" role="alert">
    <svg class="icon banner-icon"/>                    <!-- Icon name={bannerIcon(tone)} size 18 -->
    <span dir="auto">{text}</span>
    {action !== null && <button type="button" disabled={pending !== null}>{label of action}</button>}
    {opens !== null && <button type="button">{S.openSettings}</button>}
  </p>
  <!-- the transient message, last, only when message is truthy -->
  <p class="banner" role="status">
    <span dir="auto">{message}</span>
    <button type="button" class="icon-btn" aria-label={S.close}><svg class="icon"/></button>
  </p>
</div>
```

- Ids, order, text, `role` and the `persistent` and `banner-<id>` classes are as today (`App.tsx:95-113`).
- The text is the first `span` of the `p`. The icon is an `svg`, and no `span` comes before the text. `lib.mjs:226` and `lib.mjs:232` read that first `span`.
- A banner has at most one button. C2's table gives `opens` only to the port-busy banner, whose `action` is null. `p.banner-<id> button` (`checks.mjs:554`) therefore still matches one element.
- The action labels stay `{ retryEngines: S.retry, confirmStraysGone: S.theyAreGone }` (`App.tsx:78`). The map moves into `Banners`.
- The "Open settings" button is not disabled by `pending`. It calls no `window.fetchly` method.
- The transient message has no icon and keeps its `--bad` edge, as today (`styles.css:178`) (Q10).
- New icon in `model/icons.ts`: `errorCircle` is circle 12,12 r 9 plus path `M9 9l6 6M15 9l-6 6`. It is stroke-only like the rest and is not mirrored.
  - It is appended as the last entry of `ICON_NAMES`, and its `ICONS` entry is added last.
  - C1's frozen plan is not edited. From C3 on, `icons.ts` is the source of the name list (DV-5).
- Tone is carried three ways: icon shape (circle with a cross for `bad`, triangle for `warn`), edge colour, and the text itself (D1).

### 4.6 Empty states (`JobList`)

Props stay `{ snapshot, filter, onError }`.

No downloads (replaces `JobList.tsx:15-22`):

```html
<div class="empty">
  <div class="ghost" aria-hidden="true"><i/><i/></div>
  <h2>{S.emptyTitle}</h2>
  <p>{S.emptyHint}</p>
</div>
```

No match (replaces `JobList.tsx:41`):

```html
<div class="empty empty-filter">
  <p>{S.emptyFilter}</p>
  {showAll !== null && <button type="button" onClick={showAll}>{S.showAll}</button>}
</div>
```

- `.empty h2` keeps the text of `S.emptyTitle`, which `checks.mjs:123-129` compares with "Nothing here yet".
- The ghost lanes are static. C3 adds no animation.
- `showAll` comes from context, because the props are frozen at the C4 boundary (DV-6):

  ```ts
  // components/showAllContext.ts
  import { createContext } from 'react';
  /** Sets the filter to "all". null outside App: the button is then not rendered. */
  export const ShowAllContext = createContext<(() => void) | null>(null);
  ```

  `App` wraps `<JobList>` in `<ShowAllContext value={showAll}>` (React 19, `package.json:22`). `JobList` reads it with `useContext`. The value is the memoised function of 4.1.

### 4.7 `SettingsDialog` and `initialSection`

```ts
interface Props {
  settings: Settings;
  onSaved(s: Settings): void;
  onClose(): void;
  initialSection?: SettingsSection | null;
}
```

- The three headings gain `data-section` and `tabIndex={-1}`: `appearance` (line 194), `browser` (line 100, inside `BrowserPanel`), `tools` (line 295).
- The `.dialog` node (line 191) gains a ref.
- One effect that runs on mount only:
  1. When `initialSection` is null or undefined, it does nothing.
  2. It looks up `[data-section="<initialSection>"]` inside the dialog. When there is none, it does nothing. `'downloads'` has no heading until C5.
  3. It calls `scrollIntoView({ block: 'start' })` on the heading, then `focus({ preventScroll: true })`. No smooth scrolling is used, so nothing moves under reduced motion either.
- A later change of the prop while the dialog is open does nothing (Q13).
- Nothing else in the dialog changes. Its fields, save behaviour and class names are as today.
- The repository has no react-hooks lint rule (`eslint.config.mjs:6-7`), so the mount-only effect needs no suppression comment.

### 4.8 CSS

Tokens are C1's names only. No `#hex` appears outside C1's two palette blocks. No palette name is declared again. No second reduced-motion block is added. Rules removed:
- `.app` flex column (`styles.css:114-118`), replaced below.
- `.filters`, `.filters button`, `.filters button.active`, `.filters .speed` (`styles.css:145-168`).
- `.banner`, `.banner.persistent`, `.banner.persistent button`, `.banner-cutOff` (`styles.css:170-193`), replaced below.
- `.empty` (`styles.css:201-205`), replaced below.

Rules added:

```css
.sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* Frame: the rail on the start side, the rest beside it. Grid columns follow the page direction. */
.app { display: grid; grid-template-columns: 148px minmax(0, 1fr); height: 100%; }
.frame { display: flex; flex-direction: column; min-width: 0; min-height: 0; }

.rail {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px 4px; min-height: 0; overflow-y: auto;
  background: var(--chrome); border-inline-end: 1px solid var(--line);
}
.rail-brand { display: flex; align-items: center; gap: 8px; padding: 0 8px; font-weight: 600; }
.rail-filters { display: grid; gap: 2px; align-content: start; flex: 1; }
/* Borderless: --field may not be a boundary on --chrome (C1 plan 5.3). */
.rail-item {
  position: relative; display: flex; align-items: center; gap: 6px;
  width: 100%; min-height: 34px; padding: 6px 8px;
  border: 0; border-radius: 8px; background: transparent; text-align: start;
}
.rail-item:hover:not(:disabled) { background: var(--hover); }
.rail-item[aria-pressed='true'] { background: var(--surface); font-weight: 600; }
.rail-item[aria-pressed='true']::before {
  content: ''; position: absolute; inset-block: 6px; inset-inline-start: 0;
  width: 3px; border-radius: 2px; background: var(--accent);
}
/* The rail scrolls, so the ring is drawn inside the button. */
.rail-item:focus-visible { outline-offset: -2px; }
.rail-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-count { color: var(--muted); font-size: 12px; }

.strip { padding: 8px 14px; background: var(--surface); border-bottom: 1px solid var(--line); }
.strip dl { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 0; }
.strip-fig { min-width: 0; }
.strip dt { color: var(--muted); font-size: 12px; }
:lang(ar) .strip dt { font-size: 13px; }
.strip dd { margin: 0; font-size: 16px; font-weight: 600; white-space: nowrap; }

.urlbar kbd {
  align-self: center; padding: 0 6px; font: inherit; font-size: 12px;
  color: var(--muted); border: 1px solid var(--line); border-radius: 5px;
}

.banners { display: grid; gap: 6px; padding: 8px 14px 0; max-height: 40vh; overflow-y: auto; }
.banner {
  display: flex; align-items: center; gap: 10px; margin: 0; padding: 8px 10px;
  background: var(--surface); border: 1px solid var(--line);
  border-inline-start: 3px solid var(--bad); border-radius: 8px;
}
.banner.tone-warn { border-inline-start-color: var(--warn); }
.banner-icon { color: var(--bad); }
.tone-warn .banner-icon { color: var(--warn); }
.banner > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.banner button { flex: none; }

.empty {
  display: grid; justify-items: center; gap: 10px;
  padding: 60px 20px; text-align: center; color: var(--muted);
}
.empty h2 { margin: 0; color: var(--ink); font-size: 20px; }
.empty p { margin: 0; max-width: 42ch; }
.ghost { display: grid; gap: 6px; width: min(360px, 100%); margin-bottom: 10px; }
.ghost i { display: block; height: 10px; border-radius: 3px; border: 1px dashed var(--field); }
.ghost i:nth-child(2) { width: 70%; }

/* D4: nothing animates while the document is hidden. App sets the attribute (section 5). */
html[data-hidden] *,
html[data-hidden] *::before,
html[data-hidden] *::after { animation-play-state: paused !important; }

/* The icon rail. Media query only; the DOM does not change. */
@media (width < 900px) {
  .app { grid-template-columns: 56px minmax(0, 1fr); }
  .rail-brand { justify-content: center; padding: 0; }
  .rail-name, .rail-label { display: none; }
  .rail-item { justify-content: center; min-height: 40px; padding: 6px 0; }
  .rail-count {
    position: absolute; inset-block-start: 2px; inset-inline-end: 2px;
    min-width: 16px; padding: 0 4px; border-radius: 8px;
    background: var(--surface); color: var(--ink); border: 1px solid var(--line);
    font-size: 11px; line-height: 16px; text-align: center;
  }
  .urlbar kbd { display: none; }
}

/* Not verified (architecture section 3). System colours are the only literals allowed here (DV-1). */
@media (forced-colors: active) {
  .rail-item[aria-pressed='true'] { outline: 2px solid Highlight; outline-offset: -2px; }
  .rail-item[aria-pressed='true']:focus-visible { outline-width: 4px; }
}
```

Notes:
- Breakpoint: `width < 900px` is a viewport width. It gives the icon rail at 899 and the wide rail at 900 (architecture section 9, check 9). At 150% scaling that is an outer window of about 915 (PW-1 finding 3). Chromium 156 supports the range syntax.
- RTL: every offset is a logical property (`inset-inline-start`, `border-inline-end`, `text-align: start`), and the grid's first column is on the start side in both directions. No `[dir=rtl]` rule is needed. The icons used in the rail and the banners (`list`, `download`, `pause`, `check`, `alert`, `gear`, `errorCircle`, `close`) are not in `MIRRORED_ICONS`.
- Focus: the global `:focus-visible` ring (C1 plan 5.3) applies everywhere. Only its offset changes, on rail items.
- Reduced motion: C3 adds no transition or animation, so C1's single block needs no addition.
- The pressed marker is a `::before`, not a transparent border. A transparent border would become visible on every entry in forced-colours mode.
- `.rail-item` (0,1,0) outranks C1's base `button` rule (0,0,1), so the rail buttons are borderless.
- The label is `display: none` below 900px. The accessible name comes from `aria-label`, so it is not lost.
- The badge shows at 0 in both rail forms. No rule hides it.
- The forced-colours block is the one exception to the architecture's "tokens only" rule, and it is a recorded deviation (DV-1). C1's palette test does not see system colours (C1 plan 7.2).
- Wide-rail label room, estimated and not measured:
  - The item is about 139px wide (148, less the 1px edge and 8px of rail padding). Less 16px of its own padding, a 16px icon, two 6px gaps and a one-digit count of about 7px, the label has about 88px.
  - "Downloading" at 14px was estimated at about 82px in Segoe UI. Plex is wider.
  - Manual check 15 decides. Permitted remedy if "Downloading" or "متوقف مؤقتًا" is cut with a one-digit count: lower the rail's inline padding from 4px to 2px, the item's inline padding from 8px to 6px, and the item's gap from 6px to 4px, in that order, and report the values. The 148px width and the font size do not change. If the label is still cut, stop and report.
  - With a four-character badge (`999+`) the label may be cut with an ellipsis. That is accepted; `title` holds the full name.

### 4.9 Interim row grid: name minimums and breakpoints

All widths here are viewport px. PW-1 measured, at 150% scaling: the start size (outer 1120) gives a 1106px viewport, the minimum (outer 720) gives 706px, and a classic scrollbar is 15px.

What a row's grid needs, from `styles.css:226-240, 266-270`:

| Columns shown | Lone row or column headings | Sum |
|---|---|---|
| All eight | `120 + 56 + 136 + 80 + 76 + 80 + 100 + 156` = 804, seven 10px gaps, 20px padding, 2px border | 896 |
| Without "added" | 100px and one gap less | 786 |
| Without "added" and "time left" | 80px and one gap less | 696 |
| Without "speed" too | 76px and one gap less | 610 |

Two kinds of row need more than that today:
- A playlist member has 22px of start padding on its `li` (`styles.css:331-334`), so it needs 22px more.
- A playlist head has the arrow first (`styles.css:237-240`): eight gaps, a name minimum of 100px, and the arrow's own width `t`. After C1 the arrow is a 16px icon in a button with `padding: 0 4px`, so `t` is about 24px. The head needs `t − 10` more than a lone row, about 14px.

C3 makes all three kinds need the same width, by letting the name minimum absorb the difference (advisor decision 1, and the head row the advisor asked to be added):

| Row | Name minimum today | Name minimum in C3 | Need against a lone row |
|---|---|---|---|
| Lone row, column headings | 120px | 120px | equal |
| Playlist member | 120px | 98px | `98 + 22 = 120`: equal |
| Playlist head | 100px | 76px | `76 + t + 10`: 10px less at `t = 24`; equal or less while `t ≤ 34` |

- A minimum only bites when the row has no free width. At wider sizes the name column takes its `2fr` share as today, so the rows look as they do today.
- The head's 76px is this plan's choice, made because the advisor's arithmetic did not cover the head (Q14). Without it a head needs 711px at the minimum window against 706px, and overflows at viewports 1096 to 1100 as well.

The frame around the rows takes: the rail (148px, or 56px below 900px), `main`'s padding (28px, `styles.css:198`; 16px at or below 800px) and the scrollbar (15px). Today's thresholds (1000px and 880px, `styles.css:290, 305`) would let rows overflow, and `.jobs > li` clips them (`styles.css:218`). C3 changes the two thresholds and adds one:

| Query | Today | C3 | Effect |
|---|---|---|---|
| Drop "added" | `max-width: 1000px` | `max-width: 1095px` | Same rules as `styles.css:291-302`, with the new name minimums |
| Drop "time left" | `max-width: 880px` | `max-width: 985px` | Same rules as `styles.css:306-317`, with the new name minimums |
| Drop "speed" | none | `max-width: 800px` | New, below. An interim deviation from architecture section 10 (DV-2) |

Every range fits, for a lone row, a member and a head alike:

| Viewport | Rail | Columns shown | Row needs | Frame takes | Total | Spare at the range's narrowest |
|---|---|---|---|---|---|---|
| 1096 and wider | 148 | all | 896 | 148 + 28 + 15 | 1087 | 9px at 1096; 19px at the 1106 start size |
| 986 to 1095 | 148 | no "added" | 786 | 191 | 977 | 9px at 986 |
| 900 to 985 | 148 | no "added", no "time left" | 696 | 191 | 887 | 13px at 900 |
| 801 to 899 | 56 | the same | 696 | 56 + 28 + 15 | 795 | 6px at 801 |
| 706 to 800 | 56 | no "speed" either | 610 | 56 + 16 + 15 | 697 | 9px at the 706 minimum |

- At the start size "added" shows for every row, members included, so the comment at `index.ts:36` stays true and is not edited.
- The two wide-rail thresholds (1095, 985) sit 9px above the exact need; the 800px threshold leaves 6px at 801 and 9px at 706. This leaves room for the unprobed scaling factors (section 14).
- The drops are monotonic: a column dropped at a wider width never comes back at a narrower one.
- Between two whole pixels (a viewport of 800.5px, possible at 150% scaling) the wider range's rule applies, with half a pixel less spare.

The rules, replacing `styles.css:221-240` (templates and the comment only; the other declarations stay) and `styles.css:289-318`:

```css
/*
 * One set of columns for the headings, the rows and the playlist heads:
 * name, quality, size, status, speed, time left, added, actions.
 * The name and the status share the free width (2:1). A lone row's name keeps at least 120px;
 * a playlist member's 98px (its 22px indent makes up the rest) and a playlist head's 76px
 * (its arrow makes up the rest), so all three fit the same width.
 */
.jobs-head, .job-main, .group-head {
  grid-template-columns: minmax(var(--name-min, 120px), 2fr) 56px 136px minmax(80px, 1fr) 76px 80px 100px auto;
}
.group-head {
  grid-template-columns: auto minmax(76px, 2fr) 56px 136px minmax(80px, 1fr) 76px 80px 100px auto;
}
.group ul .job { --name-min: 98px; }

/* A narrow window drops the date added first, then the time left, then the speed; the name keeps its room. */
@media (max-width: 1095px) {
  .jobs-head, .job-main { grid-template-columns: minmax(var(--name-min, 120px), 2fr) 56px 136px minmax(80px, 1fr) 76px 80px auto; }
  .group-head { grid-template-columns: auto minmax(76px, 2fr) 56px 136px minmax(80px, 1fr) 76px 80px auto; }
  .job-added { display: none; }
}
@media (max-width: 985px) {
  .jobs-head, .job-main { grid-template-columns: minmax(var(--name-min, 120px), 2fr) 56px 136px minmax(80px, 1fr) 76px auto; }
  .group-head { grid-template-columns: auto minmax(76px, 2fr) 56px 136px minmax(80px, 1fr) 76px auto; }
  .job-eta { display: none; }
}
@media (max-width: 800px) {
  .jobs-head, .job-main { grid-template-columns: minmax(var(--name-min, 120px), 2fr) 56px 136px minmax(80px, 1fr) auto; }
  .group-head { grid-template-columns: auto minmax(76px, 2fr) 56px 136px minmax(80px, 1fr) auto; }
  .job-speed { display: none; }
  main { padding-inline: 8px; }
}
```

- `--name-min` is set on the member's `li.job` (`JobRow.tsx:54`) and inherited by its `.job-main` (`JobRow.tsx:55`). `.group-head` is a sibling of the members' `ul` (`GroupRow.tsx:33, 77`), not an ancestor, so the head does not inherit it. `.jobs-head` and lone rows use the 120px fallback.
- `--name-min` is a layout variable, not a palette name. C1's palette test checks palette names only (C1 plan 7.2).
- `.job-speed` exists on rows, the column headings and playlist heads (`JobRow.tsx:71`, `GroupRow.tsx:47`, `JobList.tsx:51`). A hidden cell keeps its text. e2e runs at the start size, where every column shows.
- Below 801px the total speed is still shown by the summary strip.
- This is interim. C4 rebuilds the row grid and owns the name minimums and the three queries afterwards.

Permitted remedies. Anything else stops and reports:
1. If manual check 6 shows a member row clipped at the start size (1106px) with the 98px minimum: keep 1120 and drop "added" for members only. Add a query at `max-width: 1117px` (a member at 120px needs `1087 + 22 = 1109`, plus the same 9px) that gives `.group ul .job-main` the "no added" template and hides `.group ul .job-added`. Members' cells then no longer line up with the column headings and the playlist head, which still show "added"; that misalignment is expected, not a defect. Report it. The default width is never raised (advisor decision 1).
2. If manual check 6 shows overflow at the 706px minimum: lower the three name minimums by the measured overflow, at most 16px each (to 104px, 82px and 60px), inside the 800px query only. Report the values.
3. If C1's manual check 11 raised `.job-actions` `min-width` above 156px, every "row needs" figure grows by that amount. The implement lane recomputes the two wide-rail thresholds as `exact need + 9 − 1` and reports them; the 800px threshold stays unless the spare at 801 or at 706 goes negative (a wider action column fits at 801 up to 6px and at 706 up to 9px). If "added" then cannot show at 1106px, remedy 1 applies.

### 4.10 Strings

Added to `strings.ts` (`EN`) and `strings.ar.ts` (`AR`), the same keys in both:

| Key | EN | AR |
|---|---|---|
| `railLabel` | `Filters and settings` | `التصفية والإعدادات` |
| `filterGroup` | `Filter downloads` | `تصفية التنزيلات` |
| `railCount(n)` | `` `Downloads: ${n}` `` | `` `التنزيلات: ${n}` `` |
| `summaryTitle` | `Summary` | `الملخّص` |
| `summary.speed` | `Speed` | `السرعة` |
| `summary.active` | `Running` | `قيد التشغيل` |
| `summary.remaining` | `Remaining` | `المتبقي` |
| `summary.eta` | `Running downloads finish in` | `تنتهي التنزيلات الجارية خلال` |
| `summaryHints.speed` | `Total speed of the downloads running now.` | `إجمالي سرعة التنزيلات الجارية الآن.` |
| `summaryHints.active` | `Downloads that are starting, downloading or finishing. Queued ones are not counted.` | `التنزيلات التي تبدأ أو يجري تنزيلها أو إنهاؤها. لا تُحتسب التنزيلات المنتظرة.` |
| `summaryHints.remaining` | `Left to download in running and queued downloads whose size is known. ~ means the figure is approximate.` | `المتبقي تنزيله في التنزيلات الجارية والمنتظرة المعروف حجمها. العلامة ~ تعني أن الرقم تقريبي.` |
| `summaryHints.eta` | `Time until the downloads running now finish; queued ones are not included. ~ means the figure is approximate.` | `الوقت حتى تنتهي التنزيلات الجارية الآن، دون المنتظرة. العلامة ~ تعني أن الرقم تقريبي.` |
| `about` | `about` | `نحو` |
| `notKnown` | `not known` | `غير معروف` |
| `openSettings` | `Open settings` | `فتح الإعدادات` |
| `showAll` | `Show all` | `عرض الكل` |

- `railCount` takes a number and returns a string. `strings.test.ts:21` calls every function with `'7', '8'`, which both forms accept.
- Every Arabic text says تنزيل and none says تحميل. None holds an Eastern digit.
- No new leaf is the same in both languages, so `SAME_IN_BOTH` (`strings.test.ts:24`) does not change.
- No existing string changes. `S.settings`, `S.filters`, `S.emptyTitle`, `S.emptyHint`, `S.emptyFilter`, `S.close`, `S.retry` and `S.theyAreGone` keep their text, so the e2e button names of architecture section 8 hold.
- "Open settings" does not collide with the e2e name "Open": every e2e button lookup is `exact: true` (`lib.mjs:352, 403`).

## 5. Pause while hidden: PV-1 result and the amendment to D4

Probed (`probe-pv1.md`, run 2026-11-24 by the orchestrator): Windows 10.0.26100.8037, Electron 45.4.1 (Chrome 156.0.8078.100), one process, window options as the app's. CI runs vitest only, so none of this is covered by CI.

PV-1's findings, by the probe file's own numbers:
1. `visibilitychange` fires on `hide()`, on minimise and on full occlusion by another window. In every hidden case the rule under `data-hidden` pauses the animation.
2. A fully covered window reports `isVisible() === true` in main while the page reports `document.visibilityState === 'hidden'`.
3. IPC reaches a hidden page in 0 to 2 ms.
4. `performance.now()` keeps advancing while hidden.
5. Not probed: a partial overlap, and behaviour across system sleep.

Amendment (the only one C3 may make). D4's rule is confirmed and made exact:

| D4 as frozen | Rule after C3 |
|---|---|
| "`App` sets `data-hidden` on `<html>` from `visibilitychange`" | `<html>` has the attribute `data-hidden` exactly while `isDocumentHidden(document.visibilityState)` is true (6.6). It is set once when `App` mounts, from the state at that moment, and again on every `visibilitychange`. |
| "one CSS rule sets `animation-play-state: paused` under it" | The rule in 4.8. It covers every element and both pseudo-elements, with `!important`, so a later `animation` shorthand cannot switch it back. |
| PROVISIONAL on PV-1 | The attribute and the event are no longer provisional for the three probed cases. The exact CSS rule is still to be seen working (below). |

- "Hidden" means the page's `visibilityState`, not main's `isVisible()`. It therefore includes a window fully covered by another app (finding 2).
- Only animations pause. Transitions are not touched; D4 never asked for that.
- The rule is state-based. It uses no clock, so it has no tolerance and rejects nothing as "future" or "stale".
- An unknown `visibilityState` value counts as visible. A wrongly running animation costs some CPU; a wrongly paused one would freeze a visible row.
- **What PV-1 did not cover.** PV-1 probed the narrower rule `html[data-hidden] #b { animation-play-state: paused }`. The universal selector, the two pseudo-elements and `!important` were not probed, and C3 has no animation to watch. The exact rule is first verified by eye in C4, on its first animated row (orchestrator decision, DV-7). In C3, manual check 12 verifies the attribute only.

Implementation in `App`:

```ts
useEffect(() => {
  const apply = () => document.documentElement.toggleAttribute('data-hidden', isDocumentHidden(document.visibilityState));
  apply();
  document.addEventListener('visibilitychange', apply);
  return () => document.removeEventListener('visibilitychange', apply);
}, []);
```

- The effect has no dependency and lives outside the `key={lang}` subtree, so a language change does not touch it.
- `main.tsx:9` renders in `StrictMode`. The cleanup makes the double mount in development harmless.
- The cleanup does not remove the attribute. `App` never unmounts in the running app.

Consumers of the rule, and what changes for each:

| Consumer | Change |
|---|---|
| C4 (row animations) | It may assume the attribute and the rule exist, and it adds no pause rule of its own. Its manual checks include: an animated row stops while the window is minimised, hidden to the tray and fully covered. If the rule does not pause it, C4 stops and reports. |
| C6 (toasts) | None to C3's rule. C6 extends this one effect to drive its queues; its own rule and 7.11's clock stay C6's to amend. PV-1 finding 2 means a covered window holds its toasts. |
| C11 (OS notification) | None to C3's rule. PV-1 finding 2 is the input for C11's decision on 7.12. |
| Tests | `isDocumentHidden` has its table in 6.6. No other test reads the rule. |

No existing test or consumer changes meaning because of this amendment.

## 6. Pure parts and their acceptance tables

Vitest runs in `node` with no DOM (`vitest.config.mts`), and tests are compiled without a `jsx` setting. So no test imports a `.tsx` file. Component structure is checked as text (6.8), and the look is a manual check (section 10).

```ts
// src/renderer/src/frame.ts
export interface RailEntry { filter: Filter; icon: IconName }
export const RAIL_ENTRIES: readonly RailEntry[];
export function countText(n: number): string;
export function bannerIcon(tone: BannerTone): IconName;
export function sectionForOpens(opens: BannerOpens): SettingsSection;
export interface KeyLike {
  key: string; code: string;
  ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean;
  isComposing?: boolean;
}
export function isFocusLinkKey(e: KeyLike): boolean;
export function isDocumentHidden(visibilityState: string): boolean;

// src/renderer/src/format.ts (added)
export interface StripFigure {
  /** The figure without its marker; null when it is not known. */
  value: string | null;
  /** True when the figure is an estimate. Always false when value is null. */
  approx: boolean;
  /** What the strip shows: "~" before an estimate, "—" when not known. */
  text: string;
}
export interface StripFigures { speed: StripFigure; active: StripFigure; remaining: StripFigure; eta: StripFigure }
export function stripFigures(s: Summary): StripFigures;
```

The three JSDoc comments on `StripFigure`, and the two on `ShowAllContext` (4.6) and `shortcutEnabled` (4.4), are promises. The tests lane tests each of the first three; the other two are in components and are covered by 6.8 and the manual checks.

### 6.1 `RAIL_ENTRIES`

The five filters in today's order (`App.tsx:13`), each with its icon:

| # | `filter` | `icon` |
|---|---|---|
| 1 | `all` | `list` |
| 2 | `downloading` | `download` |
| 3 | `paused` | `pause` |
| 4 | `done` | `check` |
| 5 | `failed` | `alert` |

Assertions:
- `RAIL_ENTRIES` equals that list, in that order (`toEqual`).
- The filters, sorted, equal `Object.keys(filterCounts([])).sort()`, so a sixth filter cannot be missed.
- Every icon is in `ICON_NAMES`.
- No filter appears twice.

### 6.2 `countText`

The badge text. A count that is not finite counts as 0. Otherwise `m = max(0, floor(n))`; the result is `String(m)` when `m ≤ 999`, else `'999+'`.

| Input | Expected |
|---|---|
| 0 | `'0'` |
| 1 | `'1'` |
| 7 | `'7'` |
| 999 | `'999'` |
| 1000 | `'999+'` |
| 1001 | `'999+'` |
| 123456 | `'999+'` |
| 3.9 | `'3'` |
| −1 | `'0'` |
| `NaN`, `Infinity`, `-Infinity` | `'0'` each |

Property: for every integer 0 to 1200 the result matches `/^(\d{1,3}|999\+)$/`.

### 6.3 `bannerIcon`

| Tone | Icon |
|---|---|
| `bad` | `errorCircle` |
| `warn` | `alert` |

Assertions:
- The two icons differ, and both are in `ICON_NAMES`.
- `(['bad', 'warn', 'bad', 'warn'] as const).map(bannerIcon)` equals `['errorCircle', 'alert', 'errorCircle', 'alert']`. The tone list is a literal; the test builds no `AppStatus`.

### 6.4 `sectionForOpens`

| `opens` | Section |
|---|---|
| `'settingsBrowser'` | `'browser'` |

Assertion: the result is in `SETTINGS_SECTIONS`. The function is a `switch` with no default, so a new `BannerOpens` value fails the typecheck until it gets a section.

### 6.5 `isFocusLinkKey`

Rule, first match wins:
1. `isComposing` true → false.
2. `ctrlKey` false, or any of `altKey`, `shiftKey`, `metaKey` true → false.
3. `k = key.toLowerCase()`. `k === 'l'` → true.
4. `k` is a single letter `a` to `z` → false (another Latin letter was typed, whatever the physical key).
5. Otherwise → `code === 'KeyL'` (a non-Latin layout, such as Arabic, on the L key).

Rows give only the fields that differ from `{ key: 'l', code: 'KeyL', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }`:

| # | Input | Expected |
|---|---|---|
| 1 | the base event | true |
| 2 | `key: 'L'` (Caps Lock) | true |
| 3 | `key: 'م'` (Arabic layout, same key) | true |
| 4 | `key: 'l'`, `code: 'KeyP'` (another Latin layout) | true |
| 5 | `key: 'l'`, `code: ''` | true |
| 6 | `key: 'n'`, `code: 'KeyL'` (Dvorak: the L key types n) | false |
| 7 | `key: 'k'`, `code: 'KeyK'` | false |
| 8 | `ctrlKey: false` | false |
| 9 | `shiftKey: true` | false |
| 10 | `altKey: true` (AltGr reports Ctrl and Alt together) | false |
| 11 | `metaKey: true` | false |
| 12 | `isComposing: true` | false |
| 13 | `isComposing: false` | true |
| 14 | `key: 'م'`, `code: 'KeyK'` | false |
| 15 | `key: 'Control'`, `code: 'ControlLeft'` | false |
| 16 | `key: 'Dead'`, `code: 'KeyL'` | true |
| 17 | `key: '1'`, `code: 'Digit1'` | false |

The function does not change its argument.

### 6.6 `isDocumentHidden`

Rule: true exactly when the value is the string `'hidden'`.

| Input | Expected |
|---|---|
| `'hidden'` | true |
| `'visible'` | false |
| `'prerender'` | false |
| `''` | false |
| `'Hidden'`, `' hidden'` | false |
| `undefined as unknown as string`, `null as unknown as string` | false |

### 6.7 `stripFigures` (`tests/renderer/strip.test.ts`)

Rules:
- `speed`: value is `formatSpeed(s.speed)` when `s.speed > 0`; `'0 B/s'` when the speed is not above 0 and `s.active > 0`; null when both are 0. Never approximate (Q2).
- `active`: value is `String(s.active)`. Never null, never approximate.
- `remaining`: null when `s.remaining` is null; else value `formatBytes(s.remaining.bytes)` and its `approx`.
- `eta`: null when `s.eta` is null; else value `formatEta(s.eta.seconds)` and its `approx`.
- `text` is `(approx ? '~' : '') + (value ?? '—')`. The dash is U+2014, the one `formatBytes(null)` returns (`format.ts:7`).

Inputs are `Summary` literals, so the test does not depend on `summary()`. `MB = 1024 ** 2`, `GB = 1024 ** 3`. `exact` means `approx: false`.

| # | `speed` | `active` | `remaining` | `eta` | Expected `text`: speed, active, remaining, eta |
|---|---|---|---|---|---|
| 1 | 0 | 0 | null | null | `—`, `0`, `—`, `—` |
| 2 | 5 MB | 1 | 150 MB exact | 30 exact | `5.0 MB/s`, `1`, `150.0 MB`, `0:30` |
| 3 | 6 MB | 2 | 180 MB approx | 30 approx | `6.0 MB/s`, `2`, `~180.0 MB`, `~0:30` |
| 4 | 1 MB | 1 | null | null | `1.0 MB/s`, `1`, `—`, `—` |
| 5 | 5 MB | 1 | 150 MB approx | 30 exact | `5.0 MB/s`, `1`, `~150.0 MB`, `0:30` |
| 6 | 0 | 1 | 150 MB exact | null | `0 B/s`, `1`, `150.0 MB`, `—` |
| 7 | 5 | 1 | 0 exact | 0 exact | `5 B/s`, `1`, `0 B`, `0:00` |
| 8 | 3 | 1 | 10 exact | 4 exact | `3 B/s`, `1`, `10 B`, `0:04` |
| 9 | 0 | 2 | null | null | `0 B/s`, `2`, `—`, `—` |
| 10 | 2 GB | 1234 | 5 GB approx | 3661 approx | `2.0 GB/s`, `1234`, `~5.0 GB`, `~1:01:01` |
| 11 | 1 MB | 1 | 2000 GB exact | 360000 exact | `1.0 MB/s`, `1`, `2000.0 GB`, `100:00:00` |
| 12 | 1536 | 1 | 1536 exact | 59 exact | `1.5 KB/s`, `1`, `1.5 KB`, `0:59` |
| 13 | 1 MB | 1 | 30 MB approx | 3600 approx | `1.0 MB/s`, `1`, `~30.0 MB`, `~1:00:00` |

Also asserted:
- Row 1: `speed`, `remaining` and `eta` each equal `{ value: null, approx: false, text: '—' }` (`toEqual`), and `active` equals `{ value: '0', approx: false, text: '0' }`.
- Row 3: `remaining` equals `{ value: '180.0 MB', approx: true, text: '~180.0 MB' }`.
- For every row and every figure: `approx` is false when `value` is null; `text` starts with `~` exactly when `approx` is true; `text` is `'—'` exactly when `value` is null.
- `stripFigures(summary([]))` equals row 1's result, which ties the function to C2's idle summary.
- The input is unchanged after the call (compared with a `structuredClone`).
- The language does not matter: after `setLanguage('ar')` row 3 gives the same four texts. The test resets the language in `afterEach`, as `strings.test.ts:65` does.

### 6.8 Text checks (`tests/renderer/shellSources.test.ts`)

Files are read as text with `readFileSync(fileURLToPath(new URL(…, import.meta.url)), 'utf8')`, as C1's 7.2 does. CSS comments are removed with `/\/\*[\s\S]*?\*\//g` before the CSS checks.

| File | Assertion |
|---|---|
| `components/Rail.tsx` | Contains `<nav`, `className="rail"`, `aria-pressed`, `aria-label={S.settings}`, `aria-describedby`, `RAIL_ENTRIES` and `countText`. Contains no `is-zero`. |
| `components/Banners.tsx` | Contains `role="alert"`, `role="status"`, `persistent`, `banner-`, `bannerIcon` and `S.openSettings`. The first `<span` in the file comes after the first `<Icon`. |
| `components/UrlBar.tsx` | Contains `className="urlbar"`, `type="submit"`, `isFocusLinkKey`, `aria-keyshortcuts="Control+L"` and `shortcutEnabled`; contains no `onOpenSettings` and no `S.settings`. |
| `components/JobList.tsx` | Contains `<h2>{S.emptyTitle}</h2>`, `ShowAllContext` and `S.showAll`. The text between `interface Props {` and its closing `}` names exactly `snapshot`, `filter` and `onError`. |
| `components/SummaryStrip.tsx` | Contains `stripFigures`, `S.about` and `S.notKnown`; contains no `aria-live`. |
| `components/SettingsDialog.tsx` | Contains `initialSection`, `data-section="appearance"`, `data-section="browser"`, `data-section="tools"` and `tabIndex={-1}`. |
| `components/LogoMark.tsx` | Contains `viewBox="0 0 256 256"` and `aria-hidden="true"`; contains no `#` followed by six hex digits. |
| `components/showAllContext.ts` | Contains `createContext` and `null`. |
| `App.tsx` | Contains `visibilitychange`, `data-hidden`, `isDocumentHidden`, `settingsAt`, `sectionForOpens`, `ShowAllContext`, `filterCounts` and `summary(`; contains no `showSettings`, no `className="filters"` and no `formatSpeed`. |
| `styles.css` | Exactly one match of `prefers-reduced-motion`. Contains `html[data-hidden]`, and that rule's body holds `animation-play-state: paused`. Contains `(width < 900px)`, `grid-template-columns: 148px minmax(0, 1fr)` and `grid-template-columns: 56px minmax(0, 1fr)`. Contains `minmax(var(--name-min, 120px), 2fr)`, `--name-min: 98px`, `minmax(76px, 2fr)`, `(max-width: 1095px)`, `(max-width: 985px)` and `(max-width: 800px)`. No match of `(max-width: 1000px)`, `(max-width: 880px)`, `minmax(120px, 2fr)`, `minmax(100px, 2fr)`, `is-zero` or `/\.filters\b/`. No match of `/\b(left|right)\s*:/` and none of `/(margin|padding|border)-(left|right)/` (checked on the whole file; today's file has none either). |
| `src/main/index.ts` | Contains `minWidth: 720` and `width: 1120`; contains no `minWidth: 760`. |
| `e2e/real/lib.mjs` | Contains `nav.rail button[aria-label=Settings]`; contains no `header.urlbar button[aria-label`. |

- The whitespace inside the quoted CSS strings follows the repository's formatting of `styles.css`. The tests lane normalises runs of whitespace to one space before matching.
- If a permitted remedy of 4.8 or 4.9 changes a figure (a threshold or a name minimum), the implement lane stops and reports; the orchestrator has the matching assertion updated by a tests lane. The implement lane does not edit the test.
- These guard the e2e hooks and the D2 and D4 rules cheaply. They do not prove the layout.

## 7. Accessibility

- Landmarks: one `nav` (the rail, named by `S.railLabel`), one `header` (the URL bar), one `main` (the list). The strip is a `section` named by `S.summaryTitle`. The install screen keeps its own `main`.
- Filters are buttons with `aria-pressed`, as today (`App.tsx:86`). Exactly one is pressed.
- Names at every width: each filter's name is its `aria-label`, and Settings is `S.settings`. Below 900px the visible label is hidden, and the `title` shows the name on hover.
- Counts: the visible badge is `aria-hidden` and shows at every value, 0 included. The count is the button's description, for example "Downloading, toggle button, pressed, Downloads: 3". The description holds the exact number even when the badge shows `999+`.
- Strip: a screen reader hears the label, then "about" for an estimate, or "not known" for a dash. The `title` hint is extra; nothing depends on it.
- Banners: persistent ones keep `role="alert"` and the transient one `role="status"`. The icon is `aria-hidden` (C1's `Icon`). The close button keeps `aria-label={S.close}`.
- Focus order: the rail (five filters, Settings), the link field, Add, any banner buttons, then the list. `autoFocus` still puts the caret in the link field at start (`UrlBar.tsx:41`), and `Ctrl+L` returns to it from anywhere (Q9).
- "Show all" moves focus to the All filter when it removes itself.
- The Settings heading that receives focus has `tabIndex={-1}`, so it is not a Tab stop.
- Meaning is never by colour alone:
  - the active filter has `aria-pressed`, weight 600, a start-side bar and a different background;
  - banner tone has an icon shape as well as a colour, and the text says what is wrong (D1);
  - `~` and `—` are text.

Contrast, from C1's tested figures (C1 plan 7.2; light, dark):

| Pair | Where | Ratio | Needs |
|---|---|---|---|
| `ink` on `chrome` | rail labels, brand | 13.39, 15.62 | 4.5 |
| `ink` on `hover` | hovered rail item | 13.92, 12.07 | 4.5 |
| `ink` on `surface` | active rail item, strip values, banner text, icon-rail badge | 16.50, 13.61 | 4.5 |
| `muted` on `chrome` | counts in the wide rail | 4.96, 7.44 | 4.5 |
| `muted` on `hover` | count on a hovered item | 5.15, 5.75 | 4.5 |
| `muted` on `surface` | count on the active item, strip labels, the `kbd` hint | 6.11, 6.48 | 4.5 |
| `muted` on `bg` | empty-state text | 5.34, 7.15 | 4.5 |
| `ink` on `bg` | empty-state title | 14.43, 15.01 | 4.5 |
| `accent` on `surface` | the pressed bar; the focus ring on the active item | 7.65, 7.00 | 3 |
| `accent` on `chrome` | the focus ring in the rail | 6.21, 8.03 | 3 |
| `bad` on `surface` | banner icon and edge | 6.54, 6.60 | 3 |
| `warn` on `surface` | banner icon and edge | 6.00, 8.51 | 3 |
| `field` on `bg` | ghost-lane outline | 3.14, 3.80 | 3 |
| `field` on `surface` | banner buttons' outline | 3.59, 3.44 | 3 |

- No `--field` boundary sits on `--chrome`: the rail's buttons are borderless (C1 plan 5.3).
- `--line` is used only as decoration: the rail's edge, the strip's rule, the banner's box, the `kbd` box, the badge's edge.

## 8. e2e and manual checklist edits

`e2e/real/lib.mjs`, line 408:

```js
// before
  await page.locator('header.urlbar button[aria-label=Settings]').click();
// after
  await page.locator('nav.rail button[aria-label=Settings]').click();
```

No other selector moves. Checked against architecture section 8:

| Hook | Used at | After C3 |
|---|---|---|
| `main.install`, `header.urlbar` | `lib.mjs:321, 324, 326`, `checks.mjs:118, 714` | `header.urlbar` still exists, now inside `div.frame`. The selector has no parent, so it matches. |
| `header.urlbar input`, `button[type=submit]`, `p.error` | `lib.mjs:338, 340, 341` | Unchanged. The header holds one `input`. |
| `.empty h2` | `checks.mjs:123` | Kept, same text. |
| `p.banner.persistent`, `banner-<id>`, the first `span` | `lib.mjs:224-226` | Kept. The icon is an `svg`. |
| `p.banner[role=status] span` | `lib.mjs:232` | Kept. The message `span` is the first. |
| `p.banner-<id> button` | `checks.mjs:554` | One button per banner. |
| Button names, exact | `lib.mjs:352, 403` | No English text of an existing button changes. The new names are "Open settings", "Show all" and the filter names with their counts moved to a description. None equals an e2e name. |
| `.dialog` present while open, gone on close | `lib.mjs:409, 418` | Unchanged. |

- e2e runs at the start size, a 1106px viewport, where every column shows (4.9).
- `e2e/real/checks.mjs` needs no edit. The orchestrator runs `npm run e2e:real` alone and serially after C3 (architecture section 6).

`docs/manual-checklist-phase2.md`, line 22 (row 1), the "Expected" cell:

```
before: A banner "port 38917 is in use; change it in Settings", with no button. Settings → Browser says the port is in use and **Pair a browser** is disabled. No other port is used.
after:  A banner "port 38917 is in use; change it in Settings", with an **Open settings** button. The button opens Settings scrolled to **Browser**, which says the port is in use, and **Pair a browser** is disabled. No other port is used.
```

The "Do" cell and every other row are unchanged. Rows 2 to 19 name "Settings" without saying where its button is. This checklist is a living document; no frozen plan is a target of any edit in C3.

## 9. Superseded tests and gates

Superseded:
- `tests/renderer/icons.test.ts` (C1's; not in this worktree, so no line number can be given). C1 plan 7.4 describes two assertions that fix the name list at 22: "`ICON_NAMES`, sorted, equals the 22 names" and "`Object.keys(ICONS)`, sorted, equals the same list". Both lists gain `errorCircle`. C1's boundary row allows it: "a later component may add a name to `icons.ts` with its test row". The tests lane finds the two lines and reports them.
- History: none is superseded by C3.
  - `phase2-architecture.md:285` says the server banner's `Banner.action` is null. That stays true: the new button comes from `opens`.
  - The sentence "The server banner has no button" is the comment at `banners.ts:17`, which C2 rewords (C2 plan section 3). C3 does not touch it.

Checked and not broken:
- `tests/renderer/strings.test.ts`: key parity, non-empty leaves, translation, no تحميل and Western digits all hold for the 16 new leaves (4.10). No line changes. Line 76 reads `S.filters.done`, which keeps its text.
- `tests/renderer/banners.test.ts`, `bannersServer.test.ts`: `banners.ts` is not edited.
- `tests/renderer/format.test.ts`, `columns.test.ts`, `size.test.ts`, `status.test.ts`: `format.ts` only gains exports.
- C2's new tests: no C2 function changes.
- C1's `palette.test.ts`: `styles.css` gains no `#hex`, redeclares no palette name and touches neither palette block (C1 plan 7.2).
- C1's glyph check on `App.tsx` and `components/*.tsx`: the new components use none of the nine code points. `—` (U+2014) and `~` are not among them.
- No test under `tests/` names `urlbar`, `minWidth`, `showSettings` or the CSS class `filters` (searched). The only `filters` in a test is the dictionary key above.

Gates, run by the orchestrator, serially, from the worktree root (`package.json:14-18`):

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

C3's extra checks (Git Bash). Each prints nothing, except the two that say otherwise:

```bash
# the old Settings selector is gone from e2e
grep -rn "header.urlbar button\[aria-label" e2e
# no trace of the old filter bar's markup or the boolean (S.filters is still used, so no ".filters" here)
grep -rnE "showSettings|className=\"filters\"" src/renderer/src
# the old filter-bar rules are gone from the stylesheet
grep -nE "\.filters\b" src/renderer/src/styles.css
# the zero badge is not hidden
grep -rn "is-zero" src/renderer/src
# the old row thresholds are gone
grep -nE "\(max-width: (1000|880)px\)" src/renderer/src/styles.css
# C2's rule still holds: models import no text
grep -rnE "from '\.\./(strings|format)'" src/renderer/src/model
# no literal colour in the new components
grep -nE "#[0-9a-fA-F]{6}\b|rgb\(|hsl\(" src/renderer/src/components/Rail.tsx src/renderer/src/components/SummaryStrip.tsx src/renderer/src/components/Banners.tsx src/renderer/src/components/LogoMark.tsx
# prints 1: still one reduced-motion block
grep -c "prefers-reduced-motion" src/renderer/src/styles.css
# prints one line
grep -n "minWidth: 720" src/main/index.ts
```

Then `npm run e2e:real`, alone and serially. A red run on a loaded machine is re-run alone before it counts.

Riskiest new code for the orchestrator's adversarial read before review: `isFocusLinkKey` (a wrong "true" steals a keystroke), `stripFigures` (the `~` and `—` rules), the `Banners` markup (the first-`span` hook), and the four grid templates of 4.9 (a wrong minimum clips a row).

## 10. D8 and manual checks for C3

After C3 alone the app is usable: every control that existed is still reachable, the rows look as they do after C1, and every gate is green.

Manual checks on the built app (`npm run build`, then `npm start`), in English and Arabic, light and dark.

How to set a width: every width below is a viewport width. Open DevTools in a separate window and resize the app until `window.innerWidth` reads the value. At 150% scaling the outer window is about 15px wider (PW-1). The start size (outer 1120) is a 1106px viewport, and the minimum window (outer 720) is 706px; report the two figures if they read differently on the test machine.

1. Arabic: the rail is on the right and its pressed bar is on the rail's outer edge; English mirrors. Counts, speeds, sizes and times read left to right in both (architecture 9.1).
2. Viewports 1400, 1106 (start size), 900, 899, 801, 800, 746 (the old minimum) and 706 (the minimum): the rail is 148px down to 900 and 56px from 899. No horizontal scroll at any width. The window cannot be made narrower than the minimum (9.9).
3. Icon rail: each entry shows its icon and a badge; a zero count shows a `0` badge; hovering shows the name; a screen reader says the name and the count. The wide rail shows `0` too.
4. Keyboard only: Tab goes through the rail, the link field, Add, banner buttons, then the rows. The focus ring is fully visible on every rail item, at both rail widths. `Ctrl+L` focuses and selects the link field from the list and from the rail, with the Arabic keyboard layout too. It does nothing while Settings or the Add dialog is open (9.11).
5. Summary strip (9.16): with nothing running it shows `—`, `0`, `—`, `—`. With a video running, the remaining and time figures show `~`. With only queued jobs, time shows `—`. With a playlist running, time keeps showing while items are queued. A stalled download shows `0 B/s` in the strip while its own row's speed cell is empty (Q2).
6. Row fit, with a lone download, and a playlist of 50+ members so the list scrolls. At each viewport no row, member row or playlist head is clipped at its end edge, and every action button is fully visible:

   | Viewport | Columns that show |
   |---|---|
   | 1106 (start size) | all, "added" included, on lone rows, members and the playlist head |
   | 1096 | all |
   | 1095 | no "added" |
   | 986 | no "added" |
   | 985 | no "added", no "time left" |
   | 900 and 899 | no "added", no "time left" |
   | 801 | no "added", no "time left" |
   | 800 | no "speed" either |
   | 706 (minimum) | no "speed" either |

   Report the spare width seen at 1106 and at 706 (the gap between the action buttons and the row's end edge is enough). A clipped row triggers the remedies of 4.9 and nothing else.
7. Banners (9.17): all four persistent ones and the transient message at once stay separately readable, and the list is still visible at the minimum height of 480px. A very long engine message wraps and its button stays whole. The transient message closes.
8. Port busy (`docs/manual-checklist-phase2.md` row 1): "Open settings" opens Settings scrolled to Browser, with the Browser heading focused. The rail's Settings button opens it at the top.
9. Empty states: a clean profile shows the ghost lanes, "Nothing here yet" and the hint. With downloads but none paused, the Paused filter shows the text and "Show all", which returns to All and moves focus to the All filter.
10. Counts of 1000+ (a seeded `jobs.json`): the wide rail shows `999+` without breaking the rail; the label may be cut with an ellipsis; the description gives the exact number.
11. Very long Arabic and English titles: the rail and the strip keep their widths; the rows behave as before C3.
12. Pause while hidden, the attribute only: with DevTools in a separate window, run `setInterval(() => console.log(document.documentElement.hasAttribute('data-hidden')), 1000)`. It logs `true` while the main window is minimised, closed to the tray or fully covered, and `false` when it is back. That an animation actually stops under the exact rule is first checked in C4 (section 5).
13. Windows "Animation effects" off: nothing in the shell moves (C3 adds no motion) (9.4).
14. Windows high contrast on: the pressed filter is still told apart. Not a gate (architecture section 3); report what is seen (DV-1).
15. Wide-rail labels, at a 1106px viewport, English and Arabic: with one-digit counts every label is whole, "Downloading" and "متوقف مؤقتًا" included. If one is cut, apply the remedy of 4.8 and report the values.

## 11. Edge cases

| Case | Behaviour |
|---|---|
| 0 jobs | Ghost-lane empty state. The strip shows `—`, `0`, `—`, `—`. Every rail count is 0 and shows as `0`, in the wide rail and as a badge in the icon rail. |
| 0 jobs and a filter other than All | The no-downloads state shows, not the no-match state (`JobList.tsx:15` is tested first, as today). |
| 50+ jobs | The shell does two passes over the jobs per render (`filterCounts`, `summary`), at most four times a second. Rows are C4's. |
| Counts of 1000+ | Badge `999+` (6.2). The accessible description holds the exact number. The strip's Running figure is not capped: `1234`. |
| Very long titles | The shell shows no title. The rail label is one line with an ellipsis; `.frame` has `min-width: 0`, so a long row cannot widen the frame. |
| Long rail label in Arabic at 15px | One line, cut with an ellipsis; `title` holds the full name. Checked by eye (check 15). |
| Minimum window (706px viewport) | Icon rail; the speed column is dropped and `main` has 8px padding. Rows, members and heads fit with 9px spare (4.9). |
| Start size (1106px viewport) | Wide rail; every column shows on every kind of row, with 19px spare. |
| Viewport exactly 900px and 899px | 900 is the wide rail, 899 the icon rail. |
| Row columns between the start size and the minimum | "Added" drops at 1095, "time left" at 985, "speed" at 800 (4.9). |
| A playlist member's name when the row is tight | It may shrink to 98px, where a lone row's stops at 120px. The member's start edge is 22px in, so both end at the same place. |
| A playlist head's name when the row is tight | It may shrink to 76px (today 100px). With free width it takes its share as today. |
| A viewport between two whole pixels (150% scaling) | The wider range's rule applies; the spare is half a pixel less. |
| Reduced motion | No change is needed: C3 has no motion. The heading scroll is instant. |
| High contrast | The pressed filter gets an outline through system colours. Unverified (DV-1). |
| A banner with a long message | The text wraps (`overflow-wrap: anywhere`); the icon and the button keep their size. |
| All four banners and a message at once | Five boxes with a 6px gap, in the fixed order, the message last. Past 40% of the window height the banner area scrolls, so the list stays visible. |
| Transient message is the empty string | Nothing is shown, as today (`App.tsx:106`). |
| Engine message in English while the window is Arabic | The text `span` has `dir="auto"` and reads left to right. |
| Settings opened from the banner at Browser | The dialog mounts, scrolls the Browser heading to the top and focuses it. |
| "Open settings" pressed while Settings is already open (reachable by Tab until C5 traps focus) | Nothing: the effect runs on mount only (Q13). |
| `initialSection` is `'downloads'` | Nothing happens until C5 adds the heading. No banner asks for it. |
| Language change with Settings open | Saving closes the dialog (`SettingsDialog.tsx:176-177`); the subtree remounts in the new language with `settingsAt` already null. |
| `Ctrl+L` while a dialog is open | Ignored (`shortcutEnabled` is false). |
| `Ctrl+L` on the install screen | No listener exists. |
| `Ctrl+Shift+L`, `AltGr+L` | Ignored (6.5 rows 9 and 10). |
| Window starts hidden | `data-hidden` is set on mount from the current state. |
| Window fully covered by another app | `data-hidden` is set, although main's `isVisible()` is true (PV-1 finding 2). |
| Speed 0 with a download running (stall) | The strip shows `0 B/s`, not a dash. The row's own speed cell is empty (`speedText`, `format.ts:48-50`) (Q2). |
| Merging job with a left-over speed | Not counted: `summary.speed` sums `downloading` jobs only (C2 5.3). Today's figure counted it (`App.tsx:77`). |
| A playlist member whose playlist is missing from `groups` | `JobList` hides it, as today (`JobList.tsx:37`). The rail still counts it, because `filterCounts` counts jobs. The list can then show the no-match state beside a non-zero count. Main prunes groups with their jobs, so this is not expected. |

## 12. Boundary check

### With C2 (previous): every value consumed

| Value | Meaning in C2 | C3's reading |
|---|---|---|
| `filterCounts(jobs)` | Jobs per filter by `matchesFilter`; a playlist member counts once; always five keys. | The rail's counts, one per `RAIL_ENTRIES` entry. Passed through `countText` for the badge and whole to `S.railCount`. Shown at every value, 0 included. |
| `summary.speed` | Bytes per second over `downloading` jobs; finite and ≥ 0. | The Speed figure. 0 shows `0 B/s` when something is active, else `—`. |
| `summary.active` | Count of probing, downloading, merging. | The Running figure, as a plain number. Used also to choose between `0 B/s` and `—`. |
| `summary.remaining` | Bytes left over queued, probing and downloading jobs with a known size; null when none; `approx` when a counted job is media or has no known size. | `formatBytes`, `~` when `approx`, `—` when null. Label "Remaining". |
| `summary.eta` | Whole seconds until the downloading jobs with a known size finish; null when none or the speed is not above 0; `approx` likewise. | `formatEta`, `~` when `approx`, `—` when null. The label says "running downloads". |
| `Banner.tone` | `bad` for engine and save, `warn` for server and cut-off. A code. | Class `tone-<tone>` and `bannerIcon(tone)`. |
| `Banner.opens` | `'settingsBrowser'` on the port-busy banner only. Not a `BannerAction`. | A button that sets `settingsAt` through `sectionForOpens`. Never `runBannerAction`. |
| `Banner.id`, `text`, `action` | As today. | As today. |
| `SettingsSection`, `SETTINGS_SECTIONS` | The four ids; `'downloads'` has no heading yet. | The type of `settingsAt.section` and `initialSection`. |
| `IconName`, `Icon`, `ICON_NAMES` (C1) | 22 names; one `svg`, no `span`. | Rail and banner icons. C3 appends a 23rd name and renames or removes none. |
| `LOGO_SHAPES`, `strokePath` (C1) | Paint order back to front; 256 box. | `LogoMark` draws them in that order. |
| Tokens and base classes (C1) | 17 tokens; `.icon`, `.icon-btn`, `.metric`, `:focus-visible`. | Used as they are. `--name-min` is a layout variable, not a token. |

C3 changes no C2 file and gives no C2 value another meaning. `App.tsx` is first edited after C1 by C3, as C2's OD-1 expects.

### With C4 (next)

`JobList` props stay `{ snapshot, filter, onError }`. What C4 may assume about the shell, and what C4 must do:

| Shell fact | For C4 |
|---|---|
| `JobList` is rendered inside `<main>`, the only scroll container of the list (`overflow-y: auto`). | A sticky playlist head sticks to `main`'s top edge. |
| The list's width is the viewport minus the rail (148px, or 56px below a 900px viewport), minus `main`'s padding, minus a 15px scrollbar when the list scrolls. | C4's row grid replaces 4.9's templates, name minimums and three queries, and owns them from then on. It may remove `--name-min`. |
| The viewport is narrower than the outer window: 1106px at the start size and 706px at the minimum (PW-1, 150% scaling). | **C4's rows must fit a 706px viewport, playlist members and playlist heads included**, with the scrollbar showing. C4 states its widths in viewport px. |
| The start size stays an outer 1120. | The default width is C4's to re-derive if its rows need it; C3 does not raise it. |
| Below an 801px viewport C3 drops the speed column, a third drop that architecture section 10 does not list (DV-2). | C4 does not inherit it as decided. Whether the shipped rows keep a third drop, and of which column, is the owner's question (Q15), to be answered before C4's plan is frozen. |
| `html[data-hidden]` pauses every animation, by the universal rule of 4.8. That rule was not probed in this exact form. | C4 adds no pause rule. C4 is where the rule is first verified by eye, on its first animated row, in the three hidden cases (section 5). |
| `ShowAllContext` and the two empty states live in `JobList.tsx` (DV-6). | C4 keeps both blocks and `.empty h2`. |
| The rail's counts come from `App`, not from `JobList`. | `JobList` needs no count. |
| `.sr-only` exists. | Reusable. |
| The strip shows the total speed, and `0 B/s` for a stall. | A row's own speed column is still needed while it shows. Whether a stalled row shows `0 B/s` too is Q2. |
| `ghost` is the class of the empty-state lanes. | C4 names its real lanes differently. |
| `onError` is `setMessage`, a stable function (`App.tsx:116`). | Still true after C3: `App` passes `setMessage` itself. |

C3 passes `snapshot.live` nowhere and reads it nowhere (D10).

### With C5

| Value | Meaning in C3 | C5's reading |
|---|---|---|
| `settingsAt` | `null` is closed. `{ section }` is open; `section` is null for the rail's button and `'browser'` for the banner's. A new object on each open. | C5 keeps the state and its two openers. |
| `initialSection` | On mount only: scroll the section's heading into view and focus it; null or a section with no heading does nothing. | The same inside the drawer. With the Downloads heading added, `'downloads'` works. |
| `data-section` and `tabIndex={-1}` on headings | The lookup key for `initialSection`. | C5 keeps them and adds `data-section="downloads"`. |
| The opener | C3 records none. | For "focus returns to the control that opened it", C5 reads `document.activeElement` when the drawer opens. Both openers are real buttons. |
| Rail width | 148px; 56px below a 900px viewport. | The drawer comes from the rail's side at `min(470px, 100vw − 56px)`; the 56 matches the icon rail. At the 706px minimum that is 470px. |
| `shortcutEnabled` | False while `adding` or `settingsAt` is set. | Still correct with a drawer and a stacked sheet. |

### With C6 and C11

- C6 uses "the listener C3 added" (architecture C6). That is the one effect of section 5. C6 extends its handler; it does not add a second listener for the attribute.
- "Visible" for C6 is `!isDocumentHidden(document.visibilityState)`.
- For C11: main's `isVisible()` is true for a fully covered window while the page is hidden (PV-1 finding 2). C3 changes nothing in main beyond `minWidth`.

## 13. Decisions, deviations and open questions

### 13.1 Decisions and deviations recorded at freeze

No frozen plan is edited. Each deviation is recorded here only.

| # | Decision | Decided by | Deviates from |
|---|---|---|---|
| DV-1 | The forced-colours block stays, with the two system colours (`Highlight`). It is not verified. The owner may overturn it; dropping the block is a four-line change. | Orchestrator (critique N-1) | Architecture line 245, "only tokens, never literal colours", and section 3, forced colours out of scope |
| DV-2 | The speed column drops at or below an 800px viewport, as an interim rule until C4. Without it a row beside the icon rail needs `56 + 696 + 31 = 783px` and cannot fit 706px. | Owner's advisor, decision 3 | Architecture section 10, "columns drop in today's order (added, then time left)" |
| DV-3 | The start size stays an outer 1120 and `minWidth` is 720. A playlist member's name minimum is 98px, through `--name-min`, so "added" shows for every row at the start size and members fit 706px. Fallback if that does not hold: drop "added" for members at the start size; never raise the default width. | Owner's advisor, decisions 1 and 2 | Nothing; D8 is kept by it |
| DV-4 | Files outside the architecture's C3 list: `frame.ts`, `showAllContext.ts`, the three test files, and changes to `format.ts`, `model/icons.ts` and C1's `icons.test.ts`. | Plan, accepted as the critique allows (Q1) | The architecture's C3 file list (its line 262) |
| DV-5 | `errorCircle` is appended to `icons.ts`; the list goes from 22 to 23. C1's plan is not edited. | Orchestrator (Q4) | C1 plan 7.4's count; C1's boundary row allows the addition |
| DV-6 | "Show all" reaches `JobList` through `ShowAllContext`; the props stay `{ snapshot, filter, onError }`. Overturnable in C4's plan. | Orchestrator (Q6) | Nothing; listed because it adds a channel beside the frozen props |
| DV-7 | The exact pause rule (universal, both pseudo-elements, `!important`) is first verified by eye in C4. PV-1 is not re-run for C3. | Orchestrator (critique N-11) | Nothing; narrows what C3's amendment to D4 claims |
| DV-8 | The icon rail shows the count badge at every value, 0 included. r1's `.is-zero` hiding is dropped. | Orchestrator (critique N-2) | Nothing; this conforms to the architecture |
| DV-9 | "900px", "800px" and every other width in C3 mean viewport px. The architecture's "720" is the outer `minWidth`, a 706px viewport at 150% scaling. | PW-1 | Nothing; makes the architecture's figures exact |
| DV-10 | A playlist head's name minimum is 76px at every width (Q14), so heads fit 706px and the 1096 threshold. | Plan, accepted by the orchestrator at freeze (critique r2, R2-N2) | Nothing; an interim C3 layout value that C4 re-derives |

### 13.2 Open questions

None blocks the tests lane. Each, except Q15, has a recommendation that the plan already follows; Q15 has none by design.

| # | Question | Recommendation |
|---|---|---|
| Q1 | The architecture's file list for C3 does not name `frame.ts`, `showAllContext.ts`, the three test files, or the changes to `format.ts` (`stripFigures`), `model/icons.ts` (`errorCircle`) and C1's `tests/renderer/icons.test.ts`. | Keep them (DV-4). D6 asks for pure, testable logic outside components. No contract changes meaning. |
| Q2 | What does the Speed figure show at speed 0? `formatSpeed(0)` is `''` (`format.ts:17-19`). **For the owner:** the strip then shows `0 B/s` for a stalled download while that download's own row shows an empty speed cell (`speedText`, `format.ts:48-50`). The two do not say the same thing in the same way. | Decided for C3: `0 B/s` when something is active, so a stall is visible; `—` when nothing is. The owner may instead ask for `—` in the strip whenever the speed is 0, or for `0 B/s` in the row too, which is C4's cell. |
| Q3 | Should the rail badge cap at `999+`? | Yes, so the 148px rail never breaks; the exact number stays in the description. The alternative is the full number with a smaller label. |
| Q4 | A new icon `errorCircle`, so `bad` and `warn` banners differ by shape. | Decided (DV-5). Without it both tones use `alert` and differ by colour only. |
| Q5 | The interim row rules: thresholds at 1095 and 985, a third drop (speed) at 800, and the name minimums of Q14. All in viewport px, derived in 4.9 from PW-1. | Decided until C4 (DV-2, DV-3). The owner may prefer another column to drop below 801px; the arithmetic of 4.9 then needs that column's width in place of 86px. |
| Q6 | "Show all" needs a callback, and `JobList`'s props are frozen. | Decided (DV-6): a context. The alternative is an optional `onShowAll` prop, which would change the C4 boundary. |
| Q7 | The strip labels are the architecture's defaults; four hint tooltips are added. | Keep the defaults. The owner may drop or reword the hints. |
| Q8 | The `Ctrl+L` hint is a literal `<kbd>`, not a dictionary entry. | Keep it literal: it is a key name, the same in both languages, like the language names in Settings. Making it a string needs one more entry in `SAME_IN_BOTH` (`strings.test.ts:24`). |
| Q9 | Tab order starts in the rail, before the link field. | Keep the DOM order nav, header, main. The caret still starts in the link field, and `Ctrl+L` returns to it. |
| Q10 | The transient message keeps its red edge and gets no icon. | Keep today's look. It carries both action errors and start-up notices, and has no tone to draw. |
| Q11 | The count is the filter button's description (`aria-describedby`), not part of its `aria-label`. | Keep. The architecture says each entry "keeps its name as `aria-label`", so the name is exact and the count is still read. The alternative is one label such as "Downloading, 3". |
| Q12 | The forced-colours block is written but not verified. | Decided (DV-1): keep it and report what manual check 14 shows. |
| Q13 | "Open settings" while Settings is already open does nothing. | Accept until C5 traps focus, after which the banner cannot be reached. |
| Q14 | A playlist head's name minimum goes from 100px to 76px at every width. The advisor decided the member's 98px and asked for the head to be added to the arithmetic; the head then turned out not to fit (711px against 706px at the minimum, and 1101px against a 1096px threshold). | Keep 76px: it makes the head need no more than a lone row while its arrow is 34px or narrower, and it only shows when the row is tight. The alternative is to raise the three thresholds by about 14px and drop the speed for heads earlier, which leaves about 5px at the start size. |
| Q15 | **Queued for the owner before C4's plan is frozen:** do the shipped C4 rows keep a third column drop, and of which column? Architecture section 10 lists only two. | No recommendation from C3; it is C4's design. C3's drop is interim and does not decide it. |

Rules that reject future or stale data: C3 has none. `data-hidden` follows a state, not a clock, and the strip shows whatever `summary` returns. The architecture's owner decision Q2 stands: a stale speed is not blanked. There is no tolerance to set, and C3 sets none to zero by default.

## 14. Risks

- Nothing was run by this lane. The expected texts of 6.7 are hand-derived from `format.ts:6-28`. Where the tests lane's scratch reference disagrees, the lane reports the row and does not bend the rule.
- C1's and C2's code is not in this worktree. `Icon`, `ICON_NAMES`, `LOGO_SHAPES`, `summary`, `filterCounts` and the `Banner` fields are used by the names and signatures of their frozen plans. A difference in the landed code stops the implement lane.
- The row arithmetic of 4.9 rests on four inputs:
  - PW-1's frame (15px) and scrollbar (15px), measured at 150% scaling only. 100% and 125% were not probed. If the frame is a pixel or two wider and the scrollbar is 17px there, each spare falls by about 2px and the viewport by 1 to 2px; the smallest spare (6px at 801) stays positive. This is an expectation, not a measurement.
  - C1's 156px action column (remedy 3 covers a larger one).
  - The playlist arrow's width, taken as 24px from C1's 16px icon and `padding: 0 4px`. The head fits while it is 34px or narrower.
  - The grid's 2px border and 20px padding, read from `styles.css:213-234`.
  Manual check 6 decides at every boundary, and the remedies are stated.
- The wide rail is tight for "Downloading" and "متوقف مؤقتًا". The label room is an estimate (4.8); manual check 15 decides and has a remedy.
- No DOM tests exist. The layout, RTL, the focus ring and the icon rail are covered only by section 10 and e2e.
- The text checks of 6.8 fix exact CSS strings. A permitted remedy that changes a figure needs the matching assertion updated by a tests lane.
- The first-`span` hook of the banners depends on markup order. 6.8 guards it as text, and `e2e:real` proves it.
- `aria-describedby` is announced after a pause, and its handling differs between screen readers. Manual check 3 covers Narrator.
- Programmatic focus on the Settings heading may or may not draw the focus ring, depending on the last input device. The scroll happens either way.
- The A3 branch edits `App.tsx` in parallel. C3 rewrites its render block (lines 77-121), so whichever merges second rebases there.
- The exact pause rule is unverified until C4 (DV-7). If the universal rule does not pause an animation, C4 finds it, not C3.
- PV-1 did not probe a partial overlap or sleep. A partly covered window is expected to count as visible; if it does not, animations pause while part of the window shows.
- The change from `totalSpeed` to `summary.speed` can lower the shown figure slightly, because merging left-overs are no longer counted. That is C2's stated meaning.

## Changes from r1

BLOCKING:
- **B-1** — fixed. 4.9 is re-derived for all three kinds of row. A member's name minimum is 98px through `--name-min` (advisor decision 1), so a member needs exactly what a lone row needs at every breakpoint; the range table shows the spare in each range. The playlist head's row is added to the arithmetic as the advisor asked. It did not fit (711px against 706px, and 1101px against the 1096px threshold), so its name minimum goes from 100px to 76px, recorded as Q14 for the owner. The start-size claim is restated for a member row: 1087px against 1106px, 19px spare.
- **B-2** — fixed with PW-1. 4.9, every threshold, section 10 and section 11 are in viewport px (1106px at the start size, 706px at the minimum, 15px scrollbar). Thresholds are now 1095, 985 and 800. Width 1120 and `minWidth` 720 are kept (advisor decisions 1 and 2), with the advisor's fallback as remedy 1: drop "added" for members, never raise the default width. Manual check 2 says which width it means and how to set it. The unprobed scaling factors are a stated risk.
- **B-3** — fixed. The gate is split: `showSettings|className="filters"` runs on the directory, and `\.filters\b` runs on `styles.css` only.

NON-BLOCKING:
- **N-1** — kept by orchestrator decision, recorded as DV-1, a deviation the owner may overturn.
- **N-2** — fixed by conforming to the architecture (orchestrator decision, DV-8): the badge shows at every value, 0 included. `.is-zero` and its class are gone from 4.2 and 4.8; 6.8, the extra checks, manual check 3 and the edge cases follow.
- **N-3** — fixed. Q5 is rewritten on the PW-1 arithmetic. The speed drop is recorded as an interim deviation from architecture section 10 (DV-2), and the question of a third drop in C4 is queued for the owner (Q15).
- **N-4** — fixed. Q1 and DV-4 name `format.ts`, `model/icons.ts` and C1's `icons.test.ts` as well.
- **N-5** — fixed. Q2 names the pairing for the owner: `0 B/s` in the strip beside an empty speed cell in the row. It is also in manual check 5, the edge cases and the C4 boundary.
- **N-6** — fixed. Section 2 cites lines 12 and 34 only.
- **N-7** — fixed. Section 9 says no test names the CSS class `filters`, and notes `strings.test.ts:76` reads `S.filters.done`, which is kept.
- **N-8** — fixed. Section 9 says no history is superseded by C3, gives what `phase2-architecture.md:285` really says, and attributes the quoted sentence to `banners.ts:17`, which C2 rewords.
- **N-9** — fixed. Section 5 lists PV-1's findings by the probe file's numbers; the occlusion finding is 2 everywhere.
- **N-10** — fixed. Section 3 says only `formatSpeed` leaves the import on line 10 and `type Filter` stays.
- **N-11** — fixed as decided (DV-7). Section 5 says what PV-1 did not cover, that the exact rule is first verified by eye in C4, and that manual check 12 covers the attribute only. The C4 boundary and the risks repeat it.
- **N-12** — fixed. 6.3 maps the literal tone list `['bad', 'warn', 'bad', 'warn']`.
- **N-13** — fixed. 6.8 asserts `grid-template-columns: 56px minmax(0, 1fr)`, and the 148px form likewise.
- **N-14** — fixed. 6.8 adds checks for `isFocusLinkKey`, `aria-keyshortcuts` and `shortcutEnabled` in `UrlBar.tsx`; `data-section` and `initialSection` in `SettingsDialog.tsx`; `ShowAllContext` in `JobList.tsx`; `stripFigures` in `SummaryStrip.tsx`; `isDocumentHidden`, `settingsAt` and others in `App.tsx`.
- **N-15** — fixed. 4.5 says `errorCircle` is appended last, C1's plan is not edited, and `icons.ts` is the source of the list from C3 on (DV-5).
- **N-16** — fixed. 4.5 keeps today's truthiness rule: null and the empty string show nothing. An edge-case row is added.
- **N-17** — fixed. 4.1 gives `showAll` as a `useCallback` with no dependency, placed before the early returns.
- **N-18** — fixed. The comments at `styles.css:221-225` and `styles.css:289` are rewritten in 4.9. The comment at `index.ts:36` stays true, because "added" shows at the start size, so it is not edited; 3 and 4.9 say so.
- **N-19** — fixed. The rail's inline padding is 4px and the item gap 6px, which gives the label about 88px by estimate. Manual check 15 is added with a stated remedy (padding and gap only, never the 148px or the font size), and the risk note is reworded.

Decisions applied that were not critique items:
- **Advisor, "playlist head unchecked"** — the head row is in 4.9's arithmetic, with the result in Q14.
- **Advisor, C4 must fit 706px** — stated in the C4 boundary, members and heads included.
- **Q4 and Q6** — accepted as the critique allows; recorded as DV-5 and DV-6 and marked overturnable.
- **6.8 and remedies** — because 6.8 now fixes exact thresholds and minimums, a remedy that changes a figure stops the implement lane so a tests lane updates the assertion. This is new in r2.

## Freeze note

Frozen 2026-11-24 after plan-critique r2 (0 BLOCKING). The orchestrator applied that pass's four NON-BLOCKING wording fixes at freeze: R2-N1 (the 800px threshold's spare), R2-N2 (DV-10 for the head's 76px minimum), R2-N3 (remedy 1's expected misalignment), R2-N4 (Q15 has no recommendation).
