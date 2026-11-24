# Fetchly "Lanes" UI redesign: architecture and scope plan

- Date: 2026-11-24. Branch: `feat/lanes-redesign`. File: `docs/plans/2026-11-24-lanes-redesign-architecture.md`.
- Revision: r3.
- Class: large. This plan fixes scope, the component split and the contracts between components. Each component (C1 to C11) then gets its own plan at `docs/plans/2026-11-24-lanes-c<N>-<slug>.md`.
- Sources read: `src/main/**`, `src/shared/**`, `src/renderer/**`, `tests/renderer/*`, `tests/shell.test.ts`, `tests/helpers.ts`, `e2e/real/*`, `docs/superpowers/plans/2026-11-22-phase2-architecture.md`, `docs/manual-checklist-phase1.md`, `docs/manual-checklist-phase2.md`, `.superpowers/design/fetchly-ui-directions.html` (Lanes tokens at lines 153-154, `logoSvg('zip')` at 1574-1580), `.superpowers/design/codex-final.md`.
- Nothing here was run: this lane is read-only. Every contrast figure, bundle size, tool-output shape and Electron behaviour is settled by a test or a probe named below.
- Plans live in `docs/plans/` (the current convention, used by the A2, A3 and D plans); a frozen plan there is never edited. `docs/superpowers/**` holds the older plans and the spec; it is history and is never edited (`phase2-architecture.md:5`). Living docs are `README.md`, `docs/manual-checklist-phase1.md`, `docs/manual-checklist-phase2.md` and the new `docs/manual-checklist-ui-lanes.md`.

**Revision history.** r1 was critiqued with 8 BLOCKING and 15 NON-BLOCKING findings; r2 fixed them and recorded the owner's answers. r2 was critiqued with 1 BLOCKING (B-1, a zero-tolerance "future" rule in 7.11) and 11 NON-BLOCKING findings (N-1 to N-11). r3 fixes those and changes nothing else; every owner decision recorded in r2 stands. The per-finding list is at the end.

## 1. Context

The owner rejected the current admin-table UI and chose the "Lanes" direction with additions: Loom's side rail, playlist bracket and taskbar rule, Current's summary strip, Shelf's thumbnails, and the Zip logo. The redesign must not change how downloads run.

## 2. What exists today

| Topic | Finding | Where |
|---|---|---|
| Media progress | One `bytesDone`/`bytesTotal` pair per job, and it is the current stream only. Nothing says whether that stream is video or audio; the count restarts when the next stream begins. | `src/main/jobs/queue.ts:463-474`, `src/main/ytdlp/args.ts:76-77`, `src/main/ytdlp/parse.ts:68-79` |
| Progress line parsing | Fields are split on whitespace; fewer than 5 fields is not a progress line. A new trailing field must hold no whitespace. | `parse.ts:69-70` |
| Merge | `merging` is entered on a `[Merger]` or `[ExtractAudio]` line, so an audio-only job also passes through it. `merging` does not reset `speed`, so a merging job keeps its last speed. | `parse.ts:90`, `src/main/jobs/state.ts:31,46-67` |
| State table | `done` can follow `probing`, `downloading` or `merging`. `merging` can follow `probing` or `downloading`. A new run always starts `queued → probing`, and the first progress event moves `probing → downloading`. | `state.ts:28-40`, `queue.ts:464-465` |
| aria2 detail | `tellStatus` asks for six keys only; no `bitfield`, `numPieces` or `connections`. Poll every 500 ms. A stall emits one progress event built from the last counts. | `src/main/engines/file.ts:62,278-346` (stall at 299) |
| Push rate | Progress snapshots reach the window at most every 250 ms. A state change (`commit`) pushes at once. | `queue.ts:15,605-632` |
| Queued media size | A queued media job always has `bytesTotal: null`. | `queue.ts:176` |
| Finish announcement | Main announces a lone job when it ends (done, failed or skipped) and a playlist when every member is finished. After a job-level cancel it announces the playlist only when a member is done or failed. A group cancel announces nothing. `Finished` carries `kind, title, failed, skipped`. | `queue.ts:54-59,334-336,544-577` |
| Completion notice | An OS `Notification` from main, text only, raised whatever the window's state. | `src/main/shell.ts:41-48`, `src/main/shellText.ts:8-18` |
| Taskbar progress | Not set anywhere (`setProgressBar` has no match in `src/`). | — |
| Icons | The window has no `icon`. The tray icon is a 32×32 BGRA bitmap drawn in code. | `src/main/index.ts:35-50`, `shellText.ts:27-44`, `shell.ts:33-34` |
| Thumbnail | Only a media probe carries `thumbnail: string \| null`, any non-empty string from yt-dlp, unchecked. Playlist entries, file probes and `Job` carry none. The Add dialog already shows it with `<img src>`. | `src/shared/types.ts:100-103`, `parse.ts:50`, `src/renderer/src/components/AddDialog.tsx:64` |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:`. No `data:` URI is used in `src/`. | `src/renderer/index.html:5-8` |
| Theme | `nativeTheme.themeSource` plus CSS `prefers-color-scheme`. The window background hard-codes the two `--bg` values. | `src/main/appearance.ts:5-12`, `src/renderer/src/styles.css:1-45` |
| Type size | Latin 14px/1.45, Arabic 15px/1.65, with a comment saying why Arabic is larger. | `styles.css:16-23` |
| Window floor | `minWidth: 760`. | `index.ts:39` |
| Saved state | `saveSnapshot` writes `jobs` and `groups` by name, so an extra `Snapshot` field is not persisted. | `src/main/jobs/store.ts:53` |
| Window snapshot | `App` starts from `{ jobs: [], groups: [] }`, never null. Snapshots reach it from two places: the `onChanged` subscription and `refresh()`. `App` itself is not remounted on a language change; only the `key={lang}` subtree is. | `src/renderer/src/App.tsx:16,36,40,81` |
| Settings | Opened by a boolean `showSettings` from a button inside `header.urlbar`. One dialog with `h3` headings (Appearance, Browser, Tools); there is no Downloads heading. | `App.tsx:21,82,120`, `UrlBar.tsx:47`, `SettingsDialog.tsx:100,194,295` |
| Dialog close | A dialog is rendered only while its state is set, so its `.dialog` node leaves the DOM in the commit that closes it. e2e relies on that: several checks click Close and act again at once. | `App.tsx:119-120`, `e2e/real/lib.mjs:341,409,418`, `checks.mjs:155,162` |
| Banners | Four ids (`engine`, `server`, `save`, `cutOff`) plus one transient message. `Banner = { id, text, action }`; the server banner's `action` is `null` (frozen A1 contract). | `src/renderer/src/banners.ts`, `phase2-architecture.md:285` |
| Renderer tests | Vitest runs in `node` with no DOM library; renderer tests are pure-function tests. Dictionary tests enforce EN/AR key parity, no تحميل and Western digits on every new string. | `vitest.config.mts`, `tests/renderer/strings.test.ts:27-62` |
| Test helper | `makeJob(over)` builds a media job: `kind: 'media'`, `quality: { kind: 'best' }`, `state: 'queued'`, `bytesDone: 0`, `bytesTotal: null`, `speed: 0`, `groupId: null`, `resumable: true`. | `tests/helpers.ts:5-33` |
| e2e hooks | `e2e/real` selects by class, attribute and button name (full list in section 8). Two checks read the recorded OS notifications. | `e2e/real/checks.mjs`, `e2e/real/lib.mjs:222-410`, `checks.mjs:1077,1352` |
| Group summary | The playlist percent is the share of finished items, skipped excluded. Pause/resume/cancel flags are computed inline. | `src/renderer/src/format.ts:225-230`, `GroupRow.tsx:18-23` |
| Queue wiring | `wireQueue` runs `onChanged`, `onSaveState`, tray attach, auto-resume, first push, in that fixed order. The tray attach is the `attachTray` closure in `index.ts`. | `src/main/queueLifecycle.ts:64-73`, `index.ts:136-138`, `final-review-addendum.md:32` |

## 3. Scope

In scope: owner items 1 to 9, split into C1 to C11 below.

Small additions that ride along, listed so none is silent:
- `Ctrl+L` focuses the link field (C3).
- `minWidth` goes from 760 to 720 (C3, one line in `index.ts`).
- The port-busy banner gains an "Open settings" button (C3).
- `statusParts` says "cannot resume" for a paused non-resumable job too (C2).
- `data:` is removed from the CSP's `img-src` (C6).
- `Finished` gains a `done` count, and the OS notification is not raised while the window is visible and focused (C11).

Out of scope:
- Any change to queue rules, state transitions, retry, naming, the yt-dlp format choice or aria2 options. C7 and C11 add reporting only.
- Any change to saved state: no new `Job` or `Settings` field and no `jobs.json` change, so no rollback section.
- Blanking a stale speed. Owner decision: speed is shown as today; no tolerance rule exists in this redesign.
- A speed sparkline or chart, Lanes' per-member mini bars in the group head, a tray popover, new tray menu entries.
- An overflow "more" menu on rows, list virtualisation, search, reorder.
- Styling the native `window.confirm` and `dialog.showMessageBox` prompts.
- A thumbnail in the OS notification, thumbnails for playlist entries, a thumbnail cache on disk, a thumbnail check in `parseProbe`.
- An in-app toast for a failed or skipped lone job.
- An `.ico` for a packaged exe; that belongs with the portable build (PR #9) and reuses C8's rasteriser.
- Forced-colours (Windows high contrast) verification.

## 4. Decisions that hold for every component

- D1. Meaning lives in text. Every state keeps its word from `statusParts`; colour, hatch and motion only repeat it.
- D2. Layout uses CSS logical properties only. Progress scales with `transform: scaleX()` from the start edge (`transform-origin` flips under `[dir=rtl]`). The chevron mirrors; play, pause, check, folder, trash and the logo do not.
- D3. Numbers, sizes, speeds, percents, ETA, `2/3` and URLs render inside `<bdi dir="ltr">`; titles use `dir="auto"`. All number formatting stays in `format.ts`.
- D4. Motion uses `transform` and `opacity` only, and one `@media (prefers-reduced-motion: reduce)` block removes every transition and animation.
  - At most one perpetual animation per active row, none on inactive rows.
  - The mockup's other motion is replaced: the merge marker moves with `transform: translateX()` (sign flipped under `[dir=rtl]`) instead of `inset-inline-start`; the "just done" flash is a one-shot opacity fade of an overlay instead of animated `background` and `box-shadow`.
  - Animations pause while the document is hidden: `App` sets `data-hidden` on `<html>` from `visibilitychange`, and one CSS rule sets `animation-play-state: paused` under it. C3 implements both, so they exist before C4's animations land. PROVISIONAL on PV-1.
- D5. Required boundaries (fields, outline buttons, focus ring, empty-lane outline) use `--field` or `--accent` and must reach 3:1; `--line` is for decoration only. No opacity on a fill or label that carries a state: paused and failed fills are a hatch or a solid token at full opacity, not the mockup's `opacity: .75` and `.55`.
- D6. No new test dependency. Logic that needs a test is extracted as a pure function under `src/shared`, `src/renderer/src/model` or `src/main`. Components stay thin; their look is checked by the manual checklist.
- D7. The e2e hooks in section 8 stay valid. A component that must change one edits `e2e/real` in the same change; the known edits are listed in section 8.
- D8. Every component's commit leaves the app usable and the three gates green.
- D9. New strings land in `strings.ts` and `strings.ar.ts` in the same change, by the component that shows them. Pure models return codes and numbers, never text.
- D10. No component interprets a live entry. A component may look up `snapshot.live?.[job.id]` only to pass the entry on unchanged (`JobList` hands it to a row). Rows read it through `laneModel`, aggregates through `wholeJobFraction`, memoisation through `sameRow`. An amendment to a provisional contract then touches those functions and their tests only.
- D11. Delivery: one branch `feat/lanes-redesign`, one commit (or a few) per component, one final PR to `main`. No per-component PRs.
- D12. "Media" and "file" mean `job.kind` everywhere in this plan. If Phase 2 A3 lands first, its `usesYtdlp(job)` decides the engine but not these rules: `stream` comes only from the media engine, `segments` and `connections` only from the file engine, and the UI keys on what the live entry holds.

### Provisional rules and who may amend them

A rule marked PROVISIONAL rests on a probe that has not run. Only the named component plan may amend it, after running the probe. The amendment is written in that component plan (this file is not edited), lists every consumer, and updates their tests in the same component.

| Provisional rule | Probe | Only this plan may amend it |
|---|---|---|
| 5.1 (whole section), the stream-dependent rows of 5.2 (rows 7 to 11), 7.9 | PL-1, PL-2 | C7's component plan |
| Font package names, import paths, `assetsInlineLimit` | PF-1 | C1's |
| `content-visibility` on rows | PC-1 | C4's |
| D4 pause-while-hidden (`data-hidden`) | PV-1 | C3's |
| The toast's "document visible" rule, 7.11's clock | PV-1 | C6's |
| 7.12's window-state inputs | PV-1 | C11's |
| 7.8's sampling rule and alpha form, the tray representation sizes, the window `icon` | PE-2 | C8's |
| The mapping from 7.5's result to `setProgressBar` calls | PE-1 | C9's |

Probe rules: one process per case, probe files outside the repository, and each component plan states which versions were probed. CI runs the vitest gates only, so no probed behaviour is covered by CI. Probes are listed in section 13.

## 5. Shared contracts

These cross component boundaries. A later component plan may not give them another meaning, except through the amendment rule above.

### 5.1 Live detail (types in C2, filled by C7). PROVISIONAL on PL-1 and PL-2

```ts
// src/shared/types.ts
export type StreamRole = 'video' | 'audio' | 'muxed';
export interface JobLive {
  /** What the current media stream is. null = not known. */
  stream: StreamRole | null;
  /** Fill of each map cell, 0..1, in file order, 1..24 cells. null = not known. */
  segments: number[] | null;
  /** Open connections. null = not known. */
  connections: number | null;
}
export interface Snapshot { jobs: Job[]; groups: Group[]; live?: Record<string, JobLive> }
```

The progress `EngineEvent` gains three optional fields: `stream?: StreamRole | null`, `segments?: number[] | null`, `connections?: number | null`.

- L1. Per field, on a progress event: absent (`undefined`) keeps the stored value, `null` clears it, a valid value replaces it. An invalid value counts as absent.
  - Valid `stream`: one of the three roles.
  - Valid `segments`: 1 to 24 finite numbers in 0..1.
  - Valid `connections`: a finite integer ≥ 0.
- L2. The first progress event of a run is the one received while the job is `probing`. On that event an absent field counts as `null`, so a new run never shows the previous run's role or map.
  - A run can also go `probing → merging` with no progress event (`state.ts:31`). A `merging` event received while the job is `probing` removes the entry, for the same reason. If that merge then fails, the row falls back to one lane.
- L3. Between the start of a run and its first progress event the entry is kept. It still matches the stored `bytesDone` and `bytesTotal`, which come from the same last line.
- L4. The media engine sets `stream` only when the line names the role. A missing, `NA` or unreadable field leaves it absent. It never sets the other two.
- L5. The file engine sets `segments` and `connections` on each `active` poll: the value when aria2 gives a usable one, `null` when aria2 answered without one. The stall event (`file.ts:299`) leaves both absent, so a stall does not drop the map. It never sets `stream`.
- L6. The entry is removed when the job becomes `done` or `skipped`, or is removed (remove, remove with file, cancel, group cancel). It is kept through `paused`, `failed`, `queued` (retry wait, speed-limit requeue, resume, manual retry), `probing` and `merging`, except for L2's `probing → merging` case.
- L7. An entry exists only while at least one field is non-null. `snapshot()` omits `live` when there is no entry, so existing snapshot equality tests still hold. Each snapshot carries a fresh copy.
- L8. Never saved. Held in the `Queue` instance: a queue built after an engine restart starts with no entry, and `QueueDeps.initial.live` is ignored.
- L9. A live change travels with the progress push (the 250 ms bound); it adds no push of its own. L2's removal travels with the `merging` commit.
- L10. Consumers treat "no `live`", "no entry" and "null field" the same: not known, use the fallback form.
- Until C7 lands no entry ever exists, so the UI runs entirely on the fallback forms.

### 5.2 Fractions (`src/shared/progress.ts`, C2; used by the renderer and by C9 in main)

- `streamFraction(job: Job): number | null`: `bytesDone / bytesTotal` clamped to 0..1; `null` when `bytesTotal` is null or ≤ 0.
- `wholeJobFraction(job: Job, live: JobLive | undefined): number | null`: the share of the whole job, for aggregates only (taskbar). With `f = streamFraction(job)`, the first matching row wins:

| # | Job | Result |
|---|---|---|
| 1 | `done` | 1 |
| 2 | `failed` or `skipped` | `null` |
| 3 | `merging` | `MERGE_AT` |
| 4 | `queued` or `probing`, with `bytesDone === 0` | 0 |
| 5 | `f === null` | `null` |
| 6 | `kind === 'file'` | `f` |
| 7 | media, `quality.kind === 'audio'` (whatever the stream) | `f × (W_VIDEO + W_AUDIO)` |
| 8 | media, stream `muxed` | `f × (W_VIDEO + W_AUDIO)` |
| 9 | media, stream `video` | `f × W_VIDEO` |
| 10 | media, stream `audio` | `W_VIDEO + f × W_AUDIO` |
| 11 | media, stream not known | `null` |

Constants `W_VIDEO = 0.85`, `W_AUDIO = 0.13`, `MERGE_AT = 0.98` are decided (owner). They never appear as a number on screen. Rows 7 to 11 are PROVISIONAL on PL-1.

Test rows (`toBeCloseTo` for products; "file" = `makeJob({ kind: 'file', quality: null, baseName: null, ... })`, "media" = `makeJob` defaults):

| Input | `streamFraction` | `wholeJobFraction` |
|---|---|---|
| file downloading 50/200 | 0.25 | 0.25 |
| file downloading 5/null; 0/0 | null; null | null; null |
| file downloading 300/200 | 1 | 1 |
| file downloading −5/200 | 0 | 0 |
| any job `done`, 0/null | null | 1 |
| file failed 50/200; media skipped | 0.25; null | null; null |
| media merging 30/40 | 0.75 | 0.98 |
| media queued 0/null; file probing 0/100 | null; 0 | 0; 0 |
| file queued 50/200 (retry wait) | 0.25 | 0.25 |
| media, quality audio m4a, downloading 10/40, no live | 0.25 | 0.245 |
| media, quality audio m4a, downloading 10/40, stream `audio` | 0.25 | 0.245 |
| media downloading 50/200, stream `muxed` | 0.25 | 0.245 |
| media downloading 50/200, stream `video` | 0.25 | 0.2125 |
| media downloading 20/40, stream `audio` | 0.5 | 0.915 |
| media paused 80/200, stream `video` | 0.4 | 0.34 |
| media downloading 50/200, no live; live with `stream: null` | 0.25 | null; null |

### 5.3 Other shared values

- `src/shared/palette.ts` (C1): `PALETTE.light` and `PALETTE.dark`, the Lanes tokens from the mockup. Starting values:

| Token | Light | Dark |
|---|---|---|
| `bg` | `#EDF0F4` | `#0F151C` |
| `chrome` | `#E3E8EE` | `#0B1016` |
| `surface` | `#FFFFFF` | `#161F29` |
| `ink` | `#14202C` | `#E3E9F0` |
| `muted` | `#566375` | `#95A3B5` |
| `line` | `#D3DAE3` | `#26323F` |
| `field` | `#7D8898` | `#647387` |
| `accent` | `#2346C4` | `#8AA4FF` |
| `onAccent` | `#FFFFFF` | `#0B1530` |
| `laneV` | `#2346C4` | `#8AA4FF` |
| `laneA` | `#0B7A6E` | `#3CC4B2` |
| `track` | `#E2E7EE` | `#243040` |
| `ok` | `#17784A` | `#4CC98A` |
| `bad` | `#B3261E` | `#FF7B72` |
| `warn` | `#8F5600` | `#E8B04B` |
| `hover` | `#E8ECF2` | `#1E2935` |
| `tint` | `#EEF2FF` | `#1A2540` |

  CSS custom properties are the kebab-case of the keys (`--on-accent`, `--lane-v`, `--lane-a`). `styles.css` holds the same values in `:root` and its dark `@media` block, and `appearance.ts` reads `PALETTE[mode].bg`.
- `src/shared/logo.ts` (C1): the Zip geometry in a 256 box and its colours, from `logoSvg('zip')`:
  - plate: rect 8,8 240×240, radius 60, `#1E3AA8`;
  - left strand: path `M84 40 V92 Q84 132 128 152`, stroke 30, round caps, `#FFFFFF`;
  - right strand: path `M172 40 V92 Q172 132 128 152`, stroke 30, round caps, `#4FE0CC`;
  - stem: `M128 150 V176`, stroke 30, round caps, `#FFFFFF`;
  - arrow head: polygon `88,170 168,170 128,220`, `#FFFFFF`.

  The renderer draws it as inline SVG (C3); main rasterises it (C8).
- `Filter` and `matchesFilter` (`format.ts:186-201`) are unchanged and remain the only definition of the five filters.
- `SettingsSection = 'appearance' | 'downloads' | 'browser' | 'tools'` (`src/renderer/src/model/settingsSection.ts`, C2). It crosses the C3/C5 boundary. `'downloads'` has no heading until C5 adds one (see C3).

## 6. Components

Order, one writing lane at a time in the one worktree: C1 → C2 → C3 → C4 → C5 → C6 → C11 → C8 → C9 → C7 → C10.

- C11 must follow C6: before the toast exists, suppressing the OS notification would leave a focused finish with no notice.
- C8, C9 and C11 all edit `index.ts` and `shell.ts`, so they are never parallel with each other.
- C7 is last before the docs: it waits for PL-1 and PL-2, and for A3's shape in `queue.ts`, `engine.ts` and `args.ts`.
- PV-1 runs before C3's component plan freezes, because C3 implements D4's pause-while-hidden. C6's and C11's plans use the same recorded results.

Gates for every component: `npm run typecheck`, `npm run lint`, `npm test`, run by the orchestrator. The orchestrator also runs `npm run e2e:real` alone and serially after C3, C4, C5, C6 and C11, and at the end, so a broken hook is seen in the component that broke it.

### C1. Foundation: tokens, type, icons
- Purpose: palette (light, dark, follow-system), bundled fonts, base controls, focus ring, reduced-motion block, icon set replacing the emoji glyphs.
- Create: `src/shared/palette.ts`, `src/shared/logo.ts`, `src/renderer/src/model/contrast.ts`, `src/renderer/src/components/Icon.tsx`, `tests/renderer/palette.test.ts`.
- Modify: `src/renderer/src/styles.css`, `src/renderer/src/main.tsx`, `src/main/appearance.ts`, the electron-vite config, `package.json`, `README.md` (OFL notice).
- Token rename: `--panel` → `--surface`, `--text` → `--ink`, `--bar` → `--track`, `--accent-text` → `--on-accent`. C1 rewrites every existing rule that uses the old names in the same change. Gate: no `--panel`, `--text`, `--bar` or `--accent-text` left under `src/renderer`.
- Fonts (PROVISIONAL on PF-1):
  - IBM Plex Sans and IBM Plex Sans Arabic, weights 400, 500 and 600, from `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-sans-arabic`. Only the Latin and Arabic subset files are imported.
  - The renderer build sets `assetsInlineLimit: 0`, so no font becomes a `data:` URI that the CSP would block.
  - No network at runtime, no binary in the repository. Fallback stack: `'Segoe UI', Tahoma, sans-serif`.
  - Sizes stay as today: Latin 14px/1.45, Arabic 15px/1.65, `tabular-nums` on metrics. The mockup's 13.5/14.5px is not taken, so the comment at `styles.css:19` stays true.
- `Icon` renders an `<svg aria-hidden="true">`, never a `span` (section 8 depends on this).
- Extra gate: `npm run build`, then `out/renderer/assets` holds the woff2 files, and `out/` and `src/` contain no `googleapis`, `gstatic` or `url(data:`. C1's plan records the added bundle size.
- Boundary out: token names, `Icon` names, base classes. C3 to C6 use only tokens, never literal colours.

### C2. View models (pure, no visuals)
- Purpose: every derivation the new UI needs, tested before any component uses it.
- Create: `src/shared/progress.ts`; `src/renderer/src/model/lanes.ts`, `summary.ts`, `finished.ts`, `thumbnail.ts`, `rowEqual.ts`, `settingsSection.ts`; tests under `tests/renderer/` and `tests/progress.test.ts`.
- Modify: `src/shared/types.ts` (types of 5.1 only), `src/renderer/src/format.ts` (`filterCounts`, `groupView`, `statusParts`), `src/renderer/src/banners.ts` (`tone`, `opens`), `src/renderer/src/App.tsx` (only so it compiles with the wider `Banner`; no visible change).
- Superseded tests, rewritten by the tests lane with the two new `Banner` fields:
  - `tests/renderer/banners.test.ts`: the `toEqual` cases at lines 26-28, 32, 43-45, 53, 59, 102-106, and the `cutOff` constant at line 64 (used at 76, 81, 85, 91).
  - `tests/renderer/bannersServer.test.ts`: lines 25-27, 32, 37, 41, 57-59, 67-72, 90-92.
  - `bannersServer.test.ts:48-52` still passes (`action` stays null) but its title "the banner has no button" is superseded: the port-busy banner gets a button that is not a `BannerAction`. It is renamed, and a case is added for `opens`.
  - Cases that expect `[]` or compare ids only are untouched.
- `statusParts` extends the behaviour described in `phase1-app.md:510`, which is history and is not edited.
- Boundary in: `Job`, `Snapshot`, `JobLive`. Boundary out: the functions of section 7, consumed by C3 to C6 and C9.

### C3. Shell: rail, summary strip, URL bar, banners, empty states
- Purpose: the new window frame.
- Create: `components/Rail.tsx`, `SummaryStrip.tsx`, `Banners.tsx`, `LogoMark.tsx`.
- Modify: `App.tsx`, `UrlBar.tsx`, `JobList.tsx` (empty states only), `SettingsDialog.tsx` (the `initialSection` prop only), `styles.css`, strings, `src/main/index.ts` (`minWidth: 720`), `e2e/real/lib.mjs`, `docs/manual-checklist-phase2.md`.
- Rail: `<nav class="rail">` on the start side, 148px; app mark, five filters with counts from `filterCounts` (`aria-pressed`, as today), Settings at the foot. Below 900px it becomes a 56px icon rail; each entry keeps its name as `aria-label` and `title` and shows its count as a badge. CSS media query only.
- Settings moves out of `header.urlbar` into the rail.
  - The Settings button carries `aria-label` (`S.settings`, "Settings" in English) at every width, wide rail included; e2e runs at 1120px and selects by it.
  - C3 edits `openSettings` at `e2e/real/lib.mjs:408` to `nav.rail button[aria-label=Settings]` in the same change.
- Pause while hidden (D4): `App` listens to `visibilitychange` and sets or removes `data-hidden` on `<html>`; `styles.css` gets the one `animation-play-state: paused` rule under it. PV-1 runs before C3's plan freezes; C3's plan is the only place allowed to amend this rule.
- Summary strip, from `summary()` (7.2). Four figures; each label must carry the stated meaning in both languages, and C3 may refine the wording but not the meaning:

| Figure | Meaning | Default EN | Default AR |
|---|---|---|---|
| speed | sum over `downloading` | Speed | السرعة |
| active | probing, downloading, merging; not queued | Running | قيد التشغيل |
| remaining | running and queued downloads with a known size | Remaining | المتبقي |
| time | time until the running downloads finish | Running downloads finish in | تنتهي التنزيلات الجارية خلال |

  - "Running" is named differently from the rail's "Downloading" filter, whose count includes queued jobs.
  - Remaining and time show `~` in front when `approx`, and `—` when null.
  - The strip replaces the lone speed figure in the filter bar.
- Banners: the same four persistent banners in the same order and with the same ids, plus the transient message.
  - Each gets an icon and its `tone`. The text stays the first `span` of the `p`; the icon is an `svg`.
  - A banner whose `opens` is `'settingsBrowser'` gets a button "Open settings" (`S.openSettings`).
  - C3 updates row 1 of `docs/manual-checklist-phase2.md`, which says "with no button", in the same change.
- C3/C5 boundary for "open at Browser":
  - `App` replaces `showSettings: boolean` with `settingsAt: { section: SettingsSection | null } | null`. The rail's button sets `{ section: null }`; the banner's button sets `{ section: 'browser' }`.
  - `SettingsDialog` gains an optional prop `initialSection?: SettingsSection | null`. In C3 it does one thing with it: on mount, the heading of that section is scrolled into view and receives focus (`tabIndex={-1}`).
  - When `initialSection` is null, or names a section that has no heading in the dialog, nothing happens. Today's dialog has Appearance, Browser and Tools only (`SettingsDialog.tsx:100,194,295`), so `'downloads'` does nothing until C5 adds that heading.
  - C5 keeps the prop and that behaviour inside the drawer. Nothing else about Settings changes in C3.
- Empty states: no downloads (ghost lanes, `.empty h2` title, hint); no match (text plus "Show all").
- `Ctrl+L` focuses the link field.
- Boundary with C4: `JobList` props stay `{ snapshot, filter, onError }`.

### C4. Lanes rows and playlist bracket
- Purpose: owner items 1 and 4.
- Create: `components/Lanes.tsx`. Modify: `JobRow.tsx`, `GroupRow.tsx`, `JobList.tsx`, `styles.css`, strings.
- Row: kind icon, name, quality, size, status, speed, time left, added (PR #8's columns), actions, then the lanes from `laneModel` below `.job-main`. Every row reserves the same height whatever the lane form.
- Markup kept for e2e:
  - `li.job`; `.job-main` whose `span` children hold name, quality, size, status, speed, time left and added.
  - `span.job-status` stays a direct `span` child of `.job-main`. CSS may place it on a second line; the DOM does not move.
  - The kind icon is an `svg` sibling of `.job-name`, never inside it, so `.job-name`'s text stays exactly the shown name.
- Column headings (`.jobs-head`) stay, restyled and aligned to the row grid, and drop with their columns.
- Actions stay visible icon buttons with the current accessible names.
- Bracket: sticky head with title, `done/total` inside `.group-head .job-quality`, percent, skipped count when above 0, combined speed, Pause all / Resume all / Cancel all, collapse; a bracket line on the start side binds the members. All from `groupView`. The percent keeps today's meaning: share of finished items.
- Cost: `JobRow` is memoised with `sameRow`. `JobList` looks up `snapshot.live?.[job.id]` and passes it to the row unchanged (D10).
  - Rows use `content-visibility: auto` with `contain-intrinsic-size`. PROVISIONAL on PC-1.
  - Because that implies paint containment, focus rings are drawn inside the row box (`outline-offset` negative) and no effect paints outside it.
  - If PC-1 shows a problem with the sticky head or the focus ring, C4's plan drops `content-visibility` and keeps the memoisation.
- Boundary in: `laneModel`, `groupView`, `sameRow`, C1 tokens. Out: none.

### C5. Settings drawer, Add sheet, install screen
- Purpose: owner items 2 (drawer) and 9.
- Modify: `SettingsDialog.tsx`, `AddDialog.tsx`, `InstallScreen.tsx`, `App.tsx`, `styles.css`, strings.
- Settings: a modal drawer from the rail's side, `min(470px, 100vw − 56px)`, with a light scrim so the list stays visible but inert.
  - Focus is trapped, Esc closes, focus returns to the control that opened it.
  - One scrolling column with section headings (Appearance, Downloads, Browser, Tools); Save and Close pinned at the foot. Fields, validation and save behaviour are unchanged.
  - `initialSection` behaves as C3 defined; with the Downloads heading added, `'downloads'` now scrolls and focuses like the others.
- Add: a sheet from the end side with a thumbnail and title header; the quality `<select>` (still the first `select` in `.dialog`), subtitle field, playlist checklist and folder row keep their behaviour.
- Both keep the root class `dialog` (`.dialog.drawer`, `.dialog.sheet`), with `.dialog-actions` and `button.primary` as today.
  - The `.dialog` node exists only while the dialog is open. On close it leaves the DOM in the same React commit that closes it, as today (`App.tsx:119-120`). It has an enter animation only, no exit animation.
  - An exit effect, if wanted, runs on a separate element that carries no `dialog` class (the scrim). A closing dialog is therefore never matched by `.dialog`, and e2e may click Close and act again at once (`lib.mjs:341,409,418`, `checks.mjs:155,162`).
- The Add sheet still renders whenever `adding` is set, including while the drawer is open. It stacks above the drawer and takes the focus trap; closing it returns focus to the drawer. A3's `opened` ("the add dialog is showing") therefore keeps its meaning.
- Install: a card with the mark and three tool rows, each a lane driven by `onInstallProgress`, with its percent. No "verified" stage is shown; the events do not carry one.
- Boundary with C6: C5 leaves the thumbnail as today's `<img>`; C6 replaces it with `Thumb`.

### C6. Thumbnails and the completion toast
- Purpose: owner item 6.
- Create: `components/Thumb.tsx`, `Toasts.tsx`. Modify: `AddDialog.tsx`, `App.tsx`, `index.html` (CSP), strings.
- How the image reaches the screen:
  - The probe's `thumbnail` string goes through `acceptThumbnail` (7.6).
  - An accepted URL is rendered as `<img referrerpolicy="no-referrer" loading="lazy" decoding="async" alt="">` inside a fixed 16:9 box.
  - The main process never fetches it and nothing is written to disk.
  - A rejected URL or a load error shows a tile with the kind icon.
- CSP: C6 removes `data:` from `img-src`. Gate: `npm run build`, then `out/renderer` contains no `url(data:` and no `src="data:` (the same narrow patterns as C1, so a library's own strings do not trip it).
- Toast: in-app, bottom corner on the end side, `role="status"`. Up to 3 visible, 6 s each, paused on hover or focus; more wait in a queue.
- Where the events are computed:
  - `App` receives every snapshot through one function, used by both the `onChanged` subscription and `refresh()` (`App.tsx:36,40`). For each message it runs `finishedEvents(prevRef.current, next)` once, stores `next` in the ref, stamps the events with `seenAt` (7.11), and only then sets the state.
  - It is not computed in a render or an effect: React can batch two snapshots into one render, and the diff would skip the middle one.
  - The previous-snapshot ref (starting from the empty snapshot), the toast queue and the held list all live in `App`, outside the `key={lang}` subtree, so a language change loses none of them. `Toasts` receives them as props.
- Visibility, using the listener C3 added:
  - While the document is visible an event goes to the toast queue: shown at once if fewer than 3 are on screen, else it waits, keeping its `seenAt`.
  - While it is hidden, events are held with their `seenAt` (`holdHidden`).
  - When the document becomes hidden: toasts on screen are removed and are not held; toasts still waiting, never shown, move to the held list with their own `seenAt` (`holdWaiting`).
  - When it becomes visible: the held events seen in the last 30 seconds go to the toast queue and the older ones are dropped (owner's tolerance; `dueOnVisible`, 7.11). The held list is then cleared.
- The thumbnail comes from a session map filled when a media add succeeds (`rememberThumb`, keyed by the job's URL, cap 200). A job with no remembered thumbnail (after a restart, playlist members, files) gets the fallback tile.
- No toast for a failed or skipped lone job; the row and the OS notification say it.
- Boundary in: `acceptThumbnail`, `finishedEvents`, `holdHidden`, `holdWaiting`, `dueOnVisible`, `rememberThumb`, `thumbFor`. Boundary with C11: 7.12.

### C7. MAIN/SHARED CHANGE: live detail (stream role, aria2 segments)
- Purpose: fill 5.1 so media rows show a video lane and an audio lane, and file rows a segment map. In scope by owner decision; the UI is built on the fallback first.
- Modify:
  - `src/main/ytdlp/args.ts`: the progress template gains trailing fields naming the stream.
  - `parse.ts`: the progress line carries `stream`.
  - `src/main/engines/engine.ts`: the three optional fields of 5.1.
  - `media.ts`: pass through.
  - `file.ts`: three more `tellStatus` keys, `segmentFill`.
  - `src/main/jobs/queue.ts`: session map, rules L1 to L9, `snapshot()` adds `live`.
  - Tests: `tests/ytdlp/*`, `tests/engines/*`, `tests/jobs/queue.test.ts` (including L2's `probing → merging` removal), `tests/jobs/store.test.ts` (a snapshot with `live` saves the same bytes), `tests/fakes/*`.
- It does not change which formats are chosen, how processes start or stop, any state transition, or anything saved. The five existing progress fields keep their positions.
- PL-1 and PL-2 must run before this component's plan freezes. That plan is the only place allowed to amend 5.1, rows 7 to 11 of 5.2, and 7.9.
- Boundary with C4: exactly 5.1 through `laneModel`. With C9: `wholeJobFraction`.

### C8. MAIN CHANGE: Zip logo for the tray and window
- Purpose: owner item 7.
- Create: `src/main/logoBitmap.ts`, `tests/logoBitmap.test.ts`.
- Modify: `shell.ts` (the tray image gets 16, 20, 24 and 32px representations), `index.ts` (`icon` for the window), `shellText.ts` (remove `trayIconBitmap`), `tests/shell.test.ts`.
- Superseded test: `tests/shell.test.ts:110-118` (`trayIconBitmap`) and its import at line 3. `trayIconBitmap` is executed history, replaced by `logoBitmap`.
- The icon stays drawn in code: no binary asset, one geometry source shared with the in-app mark, and the drawing is testable.
- C8's plan reads `e2e/real/hook.cjs` before changing how the tray image is built, because the hook records tray calls.

### C9. MAIN CHANGE: taskbar progress
- Purpose: owner item 5. The app sets none today; this adds it.
- Create: `src/main/taskbar.ts`, `tests/taskbar.test.ts`. Modify: `index.ts`.
- Wiring: inside the `attachTray` closure in `index.ts` (it already receives each new queue), subscribe with `queue.onChanged`. The order inside `wireQueue` is not changed. Also apply on engine status change (`pushStatus`) and on window creation; clear on quit.
- When no queue exists the input is `{ jobs: [], groups: [] }`.
- `setProgressBar` is called only when the result differs from the last one applied, with the value rounded to two decimals. Mapping, PROVISIONAL on PE-1: `none` → `-1`; `indeterminate` → mode `indeterminate`; `normal`, `paused`, `error` → the value with that mode.
- Boundary in: `wholeJobFraction` (5.2), `Snapshot`, `EngineStatus['state']`.

### C10. Docs and real-app checks
- Modify: `README.md` (screenshots, font licence), `docs/screenshots/*`, `docs/manual-checklist-phase1.md` and `docs/manual-checklist-phase2.md` (every row that describes the old UI and was not already updated by C3 or C11), `e2e/real/*` where a hook moved and was not already edited.
- Create: `docs/manual-checklist-ui-lanes.md` from section 9.
- `docs/superpowers/**` and frozen plans under `docs/plans/**` are not edited. `docs/manual-checklist-phase1-results.md` is a dated record of a past run and is left as it is.

### C11. MAIN CHANGE: when the OS notification is raised
- Purpose: owner decision. While the window is visible and focused, a finish shows only the in-app toast; the OS notification is raised only when the window is hidden, minimised or not focused.
- Modify:
  - `src/main/jobs/queue.ts`: `Finished` gains `done: number`, set in `announce` and `emitGroup`. For a lone job it is 1 when the job is done, else 0. For a playlist it is the number of done members.
  - `src/main/shellText.ts`: `raiseOsNotification`, 7.12.
  - `src/main/shell.ts`: `attachQueue` takes a fifth argument `windowState: () => WindowState | null` and asks the rule before building the `Notification`.
  - `src/main/index.ts`: passes a closure that reads `win`.
  - Tests: `tests/shell.test.ts`, `tests/jobs/queue.test.ts`.
  - `e2e/real/checks.mjs` (the check at 1352, below) and `docs/manual-checklist-phase1.md` (row 16, below).
- Superseded tests: every `Finished` literal in `tests/shell.test.ts` (lines 8-26, 46-64) needs `done`, and every `toEqual` on a finished event in `tests/jobs/queue.test.ts`; C11's plan lists the latter by line. `finishedMessage`'s output does not change.
- The `done` count is reporting only: no rule decides differently because of it, and nothing is saved.
- e2e: the playlist check that reads the "Playlist finished … 1 skipped" notification (`checks.mjs:1352`) would depend on window focus. C11 edits it in the same change to hide the window before the playlist ends, as check 19 already does, and then read the notification.
- Living doc, updated in the same change: `docs/manual-checklist-phase1.md`.
  - Row 16 (playlist with a private or deleted item) expects "the finish notification mentions the skipped count". With the window focused there is now a toast and no notification. C11 rewords the row: the notification and its skipped count are checked with another app focused or the window hidden; with the window focused a toast appears instead.
  - Row 19 (close the window during a download) stays true as written: a closed window is hidden, so the notification is raised. C11 leaves its wording and confirms it in its report.
- History this supersedes, none of it edited:
  - the spec's line 142 (`docs/superpowers/specs/2026-11-22-download-manager-design.md`), "Windows notification when a job or a whole playlist finishes": now only when the window is hidden, minimised or not focused, or nothing was done;
  - `phase1-app.md:394`, "fire `onFinished` once with the counts": still fired once; the counts gain `done`. The `Finished` shape is only extended, so its frozen meaning holds;
  - `phase1-app.md:547`, "Clicking a notification opens the window": still true whenever one is raised.
- Boundary with C6: main suppresses only events with `done ≥ 1`, and the window toasts exactly those (7.7). A focused finish therefore gets a toast, with one accepted exception recorded in section 12 (a toast still waiting when the window is hidden for more than 30 seconds). A failed or skipped lone job and a playlist with no done member raise the OS notification as today.

## 7. Acceptance criteria (pure functions)

Jobs are `makeJob({...})` from `tests/helpers.ts`; fields not named keep its defaults. "media" means the defaults; "file" means `makeJob({ kind: 'file', quality: null, baseName: null, ... })`. `50/200` means `bytesDone: 50, bytesTotal: 200`. MB = 1024². `live` is the entry for that job, or `undefined`.

### 7.1 `laneModel` (C2)

Module `src/renderer/src/model/lanes.ts`. `export function laneModel(job: Job, live: JobLive | undefined): LaneModel`.

```ts
export type Fill = { kind: 'known'; fraction: number } | { kind: 'unknown' } | { kind: 'empty' } | { kind: 'full' };
export type Tone = 'active' | 'waiting' | 'paused' | 'failed';
export type LaneModel =
  | { form: 'none' }
  | { form: 'single'; fill: Fill; tone: Tone }
  | { form: 'pair'; video: { fill: Fill; tone: Tone }; audio: { fill: Fill; tone: Tone } }
  | { form: 'merge'; strands: 1 | 2 }
  | { form: 'segments'; cells: number[]; connections: number | null; tone: Tone };
```

Tone of the job: `paused` → paused; `failed` → failed; `queued` and `probing` → waiting; `downloading` → active.

Fill of the current stream, with `f = streamFraction(job)`: a number gives `known f` (so 300/200 gives `known 1`, never `full`); null gives `unknown` when the job is `downloading`, else `empty`.

Rules, first match wins:
1. `done` or `skipped` → `none`.
2. `merging` → `merge`; 2 strands when `kind === 'media'` and the quality is not audio, else 1.
3. `live.segments` is an array with at least one cell → `segments` with those cells and the job's tone, whatever the state. `connections` is `live.connections` while `downloading`, else null (a stored count is stale once nothing runs).
4. `kind === 'media'`, quality not audio, `live.stream` is `video` or `audio` → `pair`.
   - Stream `video`: the video lane has the current fill and the job's tone. The audio lane is `empty`, with tone `waiting` when the job's tone is `active`, else the job's tone.
   - Stream `audio`: the video lane is `full` with the job's tone. The audio lane has the current fill and the job's tone.
5. Otherwise → `single` with the current fill and the job's tone.

| # | Input | Expected |
|---|---|---|
| 1 | media, downloading, 50/200, stream `video` | pair: video known 0.25 active; audio empty waiting |
| 2 | media, downloading, 30/40, stream `audio` | pair: video full active; audio known 0.75 active |
| 3 | media, downloading, 50/200, no live | single known 0.25 active |
| 4 | media, downloading, 50/200, stream `muxed` | single known 0.25 active |
| 5 | media, quality audio m4a, downloading, 10/40, stream `audio` | single known 0.25 active |
| 6 | media, merging, quality best | merge, strands 2 |
| 7 | media, merging, quality audio mp3 | merge, strands 1 |
| 8 | file, downloading, 50/200, segments `[1,1,0.5,0]`, connections 8 | segments with those cells, connections 8, active |
| 9 | file, downloading, 50/200, no live | single known 0.25 active |
| 10 | file, downloading, 1536/null | single unknown active |
| 11 | media, paused, 80/200, stream `video` | pair: video known 0.4 paused; audio empty paused |
| 12 | media, paused, 80/200, no live | single known 0.4 paused |
| 13 | file, failed, 50/200 | single known 0.25 failed |
| 14 | media, failed, 0/null | single empty failed |
| 15 | queued, 0/null | single empty waiting |
| 16 | queued, reason `retrying (2/3)`, 50/200 | single known 0.25 waiting |
| 17 | file, downloading, 300/200 | single known 1 active |
| 18 | file, downloading, 0/0 | single unknown active |
| 19 | done; skipped (each also with a live entry) | none; none |
| 20 | media, failed, 80/200, stream `video` | pair: video known 0.4 failed; audio empty failed |
| 21 | media, queued, reason `retrying (1/3)`, 30/40, stream `audio` | pair: video full waiting; audio known 0.75 waiting |
| 22 | file, paused, 50/200, segments `[1,0.5,0,0]`, connections 8 | segments with those cells, connections null, paused |
| 23 | file, failed, 50/200, segments `[1,0]` | segments `[1,0]`, connections null, failed |
| 24 | file, downloading, 50/200, segments `[]` | single known 0.25 active |
| 25 | media, downloading, 5/null, stream `video` | pair: video unknown active; audio empty waiting |
| 26 | media, quality audio m4a, downloading, 10/40, stream `video` | single known 0.25 active |
| 27 | file, downloading, 50/200, stream `video` | single known 0.25 active |
| 28 | file, queued, 0/100 | single known 0 waiting |
| 29 | media, probing, 50/200, no live | single known 0.25 waiting |
| 30 | file, merging | merge, strands 1 |
| 31 | media, merging, stream `audio`, segments `[1]` | merge, strands 2 |

Rows with a live entry are PROVISIONAL with 5.1.

### 7.2 `summary` (C2)

Module `src/renderer/src/model/summary.ts`. `export function summary(jobs: Job[]): Summary`.

```ts
export interface Summary {
  speed: number;
  active: number;
  remaining: { bytes: number; approx: boolean } | null;
  eta: { seconds: number; approx: boolean } | null;
}
```

A job has a known total when `bytesTotal` is not null and above 0.

- `speed`: sum of `speed` over jobs in `downloading` only.
- `active`: count in `probing`, `downloading`, `merging` (the tray tooltip's rule).
- `remaining`, as r1: counted jobs are `queued`, `probing`, `downloading`; merging and paused bytes are excluded.
  - `bytes` is the sum of `max(0, total − done)` over counted jobs with a known total; `remaining` is null when none has one.
  - `approx` is true when a counted job is media or has no known total.
- `eta` is the time until the running downloads finish (owner decision). It looks at jobs in `downloading` only; queued, probing, paused and merging jobs do not count.
  - It is null only when no downloading job has a known total, or `speed` is 0.
  - Otherwise `seconds = ceil(B / speed)`, where `B` is the sum of `max(0, total − done)` over downloading jobs with a known total.
  - `approx` is true when a downloading job is media (its total is the current stream only) or has no known total.
- `eta` is no longer `remaining / speed`. The two figures cover different sets (running and queued against running only), and the labels in C3 say so. That is the only change B5 makes to `remaining`'s reading; its rule is r1's.

| # | Jobs | Expected |
|---|---|---|
| 1 | none | speed 0, active 0, remaining null, eta null |
| 2 | file downloading 50/200 MB at 5 MB/s | speed 5 MB/s, active 1, remaining 150 MB exact, eta 30 s exact |
| 3 | #2 plus file queued 0/100 MB | remaining 250 MB exact, eta 30 s exact |
| 4 | #2 plus media downloading 10/40 MB at 1 MB/s | speed 6 MB/s, active 2, remaining 180 MB approx, eta 30 s approx |
| 5 | file downloading 5 MB/null at 1 MB/s | speed 1 MB/s, active 1, remaining null, eta null |
| 6 | #2 plus file queued 0/null | remaining 150 MB approx, eta 30 s exact |
| 7 | #2 plus file paused 10/100 MB | same as #2 |
| 8 | #2 plus media merging with speed 500 left over | speed 5 MB/s, active 2, remaining 150 MB exact, eta 30 s exact |
| 9 | done, failed, skipped only | as #1 |
| 10 | #2 plus file downloading 5 MB/null at 1 MB/s | speed 6 MB/s, active 2, remaining 150 MB approx, eta 25 s approx |
| 11 | file downloading 50/200 MB at speed 0 | speed 0, active 1, remaining 150 MB exact, eta null |
| 12 | media queued 0/null only | speed 0, active 0, remaining null, eta null |
| 13 | #2 plus media queued 0/null (a playlist waiting) | remaining 150 MB approx, eta 30 s exact |
| 14 | #2 plus media probing 0/null | active 2, remaining 150 MB approx, eta 30 s exact |
| 15 | file downloading 300/200 bytes at 5 B/s | remaining 0 exact, eta 0 s exact |
| 16 | file downloading 5/0 bytes at 1 B/s | remaining null, eta null |
| 17 | file downloading 0/10 bytes at 3 B/s | remaining 10 bytes exact, eta 4 s exact |
| 18 | media downloading 10/40 MB at 1 MB/s only | remaining 30 MB approx, eta 30 s approx |

### 7.3 `filterCounts` (C2)

Module `src/renderer/src/format.ts`. `export function filterCounts(jobs: Job[]): Record<Filter, number>`, each count being the number of jobs for which `matchesFilter` is true.

`[queued, downloading, merging, paused, done, failed, skipped]` → `{ all: 7, downloading: 3, paused: 1, done: 1, failed: 2 }`. `[probing]` → `downloading: 1`. `[]` → all zero. Counts are jobs, not playlists; a playlist member counts once.

### 7.4 `groupView` (C2)

Module `src/renderer/src/format.ts`. `export function groupView(members: Job[]): GroupView`, with `GroupView = { done: number; total: number; skipped: number; percent: number; speed: number; canPause: boolean; canResume: boolean; unfinished: boolean }`.

- `done`, `total` and `percent` equal `groupSummary(members)`.
- `speed` sums `speed` over `downloading` members.
- `canPause`: a member is queued, probing or downloading. `canResume`: a member is paused. `unfinished`: a member is not done, skipped or failed.

| Members | Expected |
|---|---|
| done, done, downloading at 1000, skipped | done 2, total 3, skipped 1, percent 67, speed 1000, canPause, not canResume, unfinished |
| skipped, skipped | done 0, total 0, skipped 2, percent 0, speed 0, nothing offered, not unfinished |
| paused, done | canResume, not canPause, unfinished |
| merging only (speed 500 left over) | speed 0, not canPause, not canResume, unfinished |
| done, failed | not canPause, not canResume, not unfinished |

### 7.5 `taskbarProgress` (C9)

Module `src/main/taskbar.ts`. `export function taskbarProgress(snapshot: Snapshot, engineState: EngineStatus['state']): TaskbarProgress`, with `TaskbarProgress = { mode: 'none' } | { mode: 'indeterminate' } | { mode: 'normal' | 'paused' | 'error'; value: number }`. The value is not rounded here; C9 rounds when applying.

Pending = jobs in `queued`, `probing`, `downloading`, `merging`, `paused`. For each, `w = wholeJobFraction(job, snapshot.live?.[job.id])`.

`V` is null when a `downloading` job has `w === null`, or when no pending job has a known `w`. Otherwise `V` is the mean of `w` over the pending jobs whose `w` is known, capped at 0.99. A paused, queued or probing job with an unknown share is left out of the mean; a running one makes the whole bar unknown.

1. No pending → none.
2. Engine state `error` → error with `V`, or with 0.99 when `V` is null.
3. Every pending job paused → paused with `V`; none when `V` is null.
4. Otherwise normal with `V`; indeterminate when `V` is null.

| # | Input (engine `ready` unless said) | Expected |
|---|---|---|
| 1 | no jobs; or done and failed only | none |
| 2 | file downloading 50/200 | normal 0.25 |
| 3 | #2 plus file queued 0/null | normal 0.125 |
| 4 | file downloading 200/200 | normal 0.99 |
| 5 | media merging | normal 0.98 |
| 6 | media merging plus three done | normal 0.98 |
| 7 | file downloading 5/null | indeterminate |
| 8 | media downloading 50/200, stream `video` | normal 0.2125 |
| 9 | media downloading 20/40, stream `audio` | normal 0.915 |
| 10 | media downloading 50/200, no live | indeterminate |
| 11 | file paused 50/200 | paused 0.25 |
| 12 | file paused 50/200 plus file downloading 100/200 | normal 0.375 |
| 13 | file paused 5/null | none |
| 14 | engine `error`, file paused 50/200 | error 0.25 |
| 15 | engine `error`, no pending | none |
| 16 | engine `error`, media merging plus file downloading 5/null | error 0.99 |
| 17 | file downloading 100/200 plus media paused 80/200, no live | normal 0.5 |
| 18 | media paused 80/200, no live, alone | none |
| 19 | file downloading 50/200 plus media downloading 50/200, no live | indeterminate |
| 20 | engine `error`, file downloading 200/200 | error 0.99 |
| 21 | file downloading 100/200 plus media queued `retrying (1/3)` 50/200, no live | normal 0.5 |
| 22 | engine `starting` or `notInstalled`, empty snapshot | none |

Values use `toBeCloseTo`. Property test: for any snapshot and any engine state, a result that has a `value` has `0 ≤ value ≤ 0.99`, so the bar is never full, in a merge or otherwise. Rows 8 to 10 and 17 to 21 are PROVISIONAL with 5.2.

### 7.6 `acceptThumbnail`, `rememberThumb`, `thumbFor` (C2)

Module `src/renderer/src/model/thumbnail.ts`.

`export function acceptThumbnail(raw: unknown): string | null`. Accepts a string that:
- equals its own trim;
- is at most 2048 characters, counted on the raw string;
- parses with `new URL(raw)` to protocol `https:` with no username or password;
- has a parsed `hostname` that is not `localhost`, `localhost.`, a name ending in `.localhost` or `.localhost.`, or an IP literal (it starts with `[`, or matches `^\d+\.\d+\.\d+\.\d+$` after parsing).

It returns the parsed `href`. The host rule is applied after parsing because the URL parser turns numeric hosts into dotted form. Reason for the IP rule: the address comes from a remote site's metadata, and the window would otherwise send a request to a loopback or LAN service chosen by that site. Thumbnail hosts are CDN names, so nothing real is lost.

| Input | Expected |
|---|---|
| `https://i.ytimg.com/vi/abc/hq.jpg` | the same URL |
| `HTTPS://EXAMPLE.com/t.jpg` | `https://example.com/t.jpg` |
| `http://example.com/t.jpg` | null |
| `data:image/png;base64,AAAA`, `javascript:alert(1)`, `file:///C:/t.png` | null |
| `//cdn.example.com/t.jpg`, `t.jpg`, `''` | null |
| `null`, `undefined`, `42`, `{}` | null |
| `https://user:pw@example.com/t.jpg`, `https://user@example.com/t.jpg` | null |
| `https://localhost/t.jpg`, `https://localhost./t.jpg`, `https://a.localhost/t.jpg` | null |
| `https://127.0.0.1/t.jpg`, `https://[::1]/t.jpg`, `https://2130706433/t.jpg`, `https://0x7f.0.0.1/t.jpg` | null |
| `' https://example.com/t.jpg'`, `'https://example.com/t.jpg\n'` | null |
| `'https://example.com/' + 'a'.repeat(2028)` (2048 characters); with 2029 (2049) | accepted; null |

`export function rememberThumb(map: Map<string, string>, url: string, thumb: unknown, cap = 200): void`. It stores `acceptThumbnail(thumb)` under `url` when that is not null, and otherwise does nothing. Storing an existing `url` again makes it the newest. Past `cap` the oldest entry is dropped.

`export function thumbFor(map: Map<string, string>, job: Job): string | null` returns the entry for `job.url`, or null.

| Case | Expected |
|---|---|
| remember a valid thumb, then `thumbFor` a job with that url | the accepted href |
| remember `http://…` | map unchanged; `thumbFor` null |
| cap 2: remember a, b, c | a gone; b and c present |
| cap 2: remember a, b, a again, c | b gone; a and c present |
| `thumbFor` a job whose url was never stored | null |

### 7.7 `finishedEvents` (C2)

Module `src/renderer/src/model/finished.ts`. `export function finishedEvents(prev: Snapshot, next: Snapshot): FinishedEvent[]`.

```ts
export type FinishedEvent =
  | { kind: 'job'; job: Job }
  | { kind: 'group'; group: Group; done: number; failed: number; skipped: number };
```

`prev` is the last snapshot this page received, starting from `{ jobs: [], groups: [] }`; it is never null. Finished = `done`, `failed` or `skipped`. Members of a playlist are the jobs with its `groupId`.

- Job event: a job with `groupId === null` that is present in `prev` with a state other than `done`, and is `done` in `next`. `job` is the one from `next`.
- Group event, for a playlist `G` listed in `next.groups`, when all of these hold:
  - in `next`, `G` has at least one member, every member is finished, and at least one is `done`;
  - `G` had at least one member in `prev`;
  - in `prev` some member of `G` was not finished, or `G` has more `done` members in `next` than in `prev`.

  The counts are taken from `next`.
- A playlist member never gives a job event.
- Order: the order of `next.jobs`, a playlist at its first member.
- These are exactly the announcements main makes with `done ≥ 1` (C11): a lone job that is done, and a playlist that has nothing left with at least one done member, including after a job-level cancel.

Playlists in tests use `{ id: 'g1', title: 'Course', url: 'https://example.com/list', dir: 'D:\\Dl\\Course', createdAt: 1 }` and members `makeJob({ groupId: 'g1', index: n, ... })`.

| Case | Expected |
|---|---|
| `prev` empty, `next` has A done | none |
| `prev` equals `next` | none |
| lone A downloading → done | job A |
| A merging → done; A probing → done; A queued → done | job A each |
| A failed → done (a retry between two snapshots) | job A |
| A absent in `prev`, done in `next` | none |
| A done → done | none |
| A downloading → failed; A downloading → skipped | none; none |
| lone A and lone B both → done in one step | job A, job B, in `next.jobs` order |
| member done while another member is still queued | none |
| last unfinished member → done | one group event with its counts, no job event |
| last unfinished member → failed, another member done | group event, done 1, failed 1 |
| last unfinished member → skipped, another member done | group event, done 1, skipped 1 |
| last unfinished member → failed, the rest failed or skipped | none |
| every member skipped | none |
| last unfinished member removed (cancel), another member done | group event |
| last unfinished member removed, only failed members left | none |
| last member removed, playlist gone from `next` | none |
| all finished in `prev` (done 1, failed 1); the failed one is done in `next` | group event, done 2, failed 0 |
| all finished in both, a done member removed | none |
| playlist absent in `prev`, complete in `next` | none |

### 7.8 `logoBitmap` (C8)

Module `src/main/logoBitmap.ts`. `export function logoBitmap(size: number): { size: number; data: Buffer }`, BGRA, `data.length === size × size × 4`. `size` must be an integer from 16 to 512; anything else (15, 513, 16.5, `NaN`) throws `RangeError`.

The sampling rule (pixel centre or coverage) and the alpha form (straight or premultiplied) are PROVISIONAL on PE-2 and set in C8's plan. Every pixel tested below lies wholly inside one shape or wholly outside the plate, so the expectations hold under either choice.

| Size | Pixel (x, y) | Expected B, G, R, A |
|---|---|---|
| 16 | (0, 0) | alpha 0 |
| 16 | (7, 11) and (8, 11), arrow head | FF FF FF FF |
| 16 | (5, 3), left strand | FF FF FF FF |
| 16 | (10, 3), right strand | CC E0 4F FF |
| 16 | (7, 3), plate between the strands | A8 3A 1E FF |
| 32 | (0, 0) | alpha 0 |
| 32 | (16, 24), arrow head | FF FF FF FF |
| 32 | (10, 7), left strand | FF FF FF FF |
| 32 | (21, 7), right strand | CC E0 4F FF |
| 32 | (16, 7), plate between the strands | A8 3A 1E FF |
| 256 | (0, 0) | alpha 0 |
| 256 | (128, 196), arrow head | FF FF FF FF |
| 256 | (84, 60), left strand | FF FF FF FF |
| 256 | (172, 60), right strand | CC E0 4F FF |
| 256 | (128, 60), plate between the strands | A8 3A 1E FF |

Also, at 16, 32 and 256: alpha is mirror-symmetric (`alpha(x, y) === alpha(size − 1 − x, y)`), and two calls return equal buffers.

### 7.9 `segmentFill` (C7). PROVISIONAL on PL-2

Module `src/main/engines/file.ts`. `export function segmentFill(bitfieldHex: string, numPieces: number, maxCells = 24): number[] | null`.

- The hex is read case-insensitively; the highest bit of the first digit is piece 0.
- Bits beyond `numPieces` (pad bits, or a longer string) are ignored.
- The cell count is `min(maxCells, numPieces)`. Piece `i` belongs to cell `floor(i × cells / numPieces)`, and a cell's value is the share of its pieces that are present.
- Null when the hex is empty or has a non-hex character, when `numPieces` or `maxCells` is not an integer ≥ 1, or when the hex holds fewer than `numPieces` bits.

| Input | Expected |
|---|---|
| `'f0'`, 8, 4 | `[1, 1, 0, 0]` |
| `'F0'`, 8, 4 | `[1, 1, 0, 0]` |
| `'a0'`, 4, 4 | `[1, 0, 1, 0]` |
| `'e0'`, 3, 24 | `[1, 1, 1]` |
| `'c0'`, 4, 2 | `[1, 0]` |
| `'80'`, 4, 2 | `[0.5, 0]` |
| `'a0'`, 3, 2 (not divisible) | `[0.5, 1]` |
| `'ff'`, 5, 5 (pad bits set) | `[1, 1, 1, 1, 1]` |
| `'ffff'`, 8, 4 (longer hex) | `[1, 1, 1, 1]` |
| `'zz'`, 8; `''`, 8; `'ff'`, 16; `'ff'`, 0; `'ff'`, 1.5; `'ff'`, 8, 0 | null |

### 7.10 Smaller ones

- `contrast(a: string, b: string): number` (C1, `src/renderer/src/model/contrast.ts`): the WCAG contrast ratio of two `#RRGGBB` colours. `#000000` against `#FFFFFF` is 21; equal colours give 1; the order of arguments does not matter.
- `tests/renderer/palette.test.ts` asserts, for both modes:
  - `ink`, `muted`, `ok`, `bad`, `warn`, `accent` against `bg` and `surface` ≥ 4.5;
  - `onAccent` against `accent` ≥ 4.5;
  - `field` and `accent` against `bg` and `surface` ≥ 3;
  - `laneV` and `laneA` against `track` and `surface` ≥ 3;
  - every token in `styles.css` (the `:root` block and the dark block, read as text) equals `PALETTE`.

  A token that fails is adjusted in C1 and the change listed for the owner.
- `banners(status: AppStatus, snapshot: Snapshot): Banner[]` (C2). `Banner` becomes `{ id; text; action: BannerAction | null; tone: 'bad' | 'warn'; opens: 'settingsBrowser' | null }`. Ids, order, text and `action` are as today; the server banner's `action` stays null.

| Banner | `action` | `tone` | `opens` |
|---|---|---|---|
| engine | `'retryEngines'` | `bad` | null |
| server, `portBusy` | null | `warn` | `'settingsBrowser'` |
| server, `error` | null | `warn` | null |
| save | null | `bad` | null |
| cutOff | `'confirmStraysGone'` | `warn` | null |

- `statusParts(job: Job): string[]` (C2). A paused job's parts are, in this order: the percent part, then `S.status.waitingForCheck` when `interrupted`, then `S.status.cannotResume` when `resumable` is false. Existing rows are unchanged.
  - paused, 50/200, `resumable: false` → `['paused 25%', 'cannot resume']`.
  - paused, 50/200, `interrupted: true`, `resumable: false` → three parts in that order.
  - paused, 50/200, resumable → `['paused 25%']`.
- `sameRow(a: Job, b: Job, liveA: JobLive | undefined, liveB: JobLive | undefined): boolean` (C2, `src/renderer/src/model/rowEqual.ts`).
  - True when the two jobs are equal by value over every key either one has, and the two live entries are equal by value (both `undefined`, or the same three fields).
  - `quality`, `subtitleLangs` and `segments` compare by content, never by reference: IPC clones every snapshot.
  - Comparing every key means a field added later (A3 adds three) is covered without a change here.
  - Tests: a `structuredClone` of the job and the entry gives true. Changing any one field of `makeJob()` in turn gives false, including `createdAt`, `kind`, `index`, `baseName`, `quality.kind`, `quality.height` and one element of `subtitleLangs`. An entry against `undefined` gives false; `segments` `[1, 0]` against `[1, 0.5]` gives false.

### 7.11 Late toasts (C6). Clock PROVISIONAL on PV-1

Module `src/renderer/src/model/finished.ts`.

```ts
export const LATE_TOAST_MS = 30_000;
export interface HeldFinish { event: FinishedEvent; seenAt: number }
export function holdHidden(held: HeldFinish[], events: FinishedEvent[], seenAt: number, cap = 20): HeldFinish[];
export function holdWaiting(held: HeldFinish[], waiting: HeldFinish[], cap = 20): HeldFinish[];
export function dueOnVisible(held: HeldFinish[], now: number, windowMs = LATE_TOAST_MS): HeldFinish[];
```

How the 30 seconds are measured:
- Both times come from one clock in one process: the window's `performance.now()`.
- `seenAt` is read when the window receives the snapshot that shows the finish, whatever the document's visibility. An event keeps that one stamp for its whole life: in the toast queue, in the held list, and when it passes from one to the other.
- `now` is read in the `visibilitychange` handler that reports `visible`.
- The finish time is therefore "when the window learned of it". Main pushes a state change at once, so it trails the real finish by the IPC delay only. No time from main's clock is compared, and `Job` gains no finish time.

Rules:
- `holdHidden` returns the held list followed by the new events stamped `seenAt`, keeping only the newest `cap`.
- `holdWaiting` returns the held list followed by the `waiting` entries, each with its own `seenAt` unchanged, keeping only the newest `cap` (the last `cap` entries). The caller passes the toasts that were queued and never shown.
- `dueOnVisible` returns, in order, the entries with `now − seenAt ≤ windowMs`, each with its `seenAt` unchanged. There is no lower bound: a negative difference counts as 0 and the event is shown. Both stamps come from one monotonic clock, so the case is not expected, and no finish is ever dropped for being "in the future". After calling it the caller clears the held list.

| `seenAt` | `now` | Shown |
|---|---|---|
| 1000 | 1000 (0 s) | yes |
| 1000 | 30 000 (29 s) | yes |
| 1000 | 31 000 (30 s) | yes |
| 1000 | 31 001 | no |
| 1000 | 32 000 (31 s) | no |
| 1000 | 999 (clock earlier) | yes |
| held `[seen 0, seen 5000]` | 32 000 | only the second |
| held `[]` | any | `[]` |

Every returned entry has the `seenAt` it was held with.

`holdHidden`: adding 2 events to an empty list gives 2 entries with that `seenAt`; adding a 21st entry at cap 20 drops the oldest; adding `[]` returns an equal list.

`holdWaiting`:

| `held` | `waiting` | `cap` | Expected |
|---|---|---|---|
| `[]` | `[a seen 100, b seen 200]` | 20 | `[a seen 100, b seen 200]` |
| `[x seen 50]` | `[a seen 100]` | 20 | `[x seen 50, a seen 100]` |
| `[x seen 50]` | `[a seen 100, b seen 200]` | 2 | `[a seen 100, b seen 200]` |
| `[x seen 50]` | `[]` | 20 | a list equal to `held` |

Round trip: an entry returned by `dueOnVisible`, passed back through `holdWaiting` and then to `dueOnVisible` with a `now` more than 30 s after its original `seenAt`, is not returned. A second hide does not extend the window.

### 7.12 `raiseOsNotification` (C11). Inputs PROVISIONAL on PV-1

Module `src/main/shellText.ts`.

```ts
export interface WindowState { visible: boolean; minimized: boolean; focused: boolean }
export function raiseOsNotification(e: Finished, w: WindowState | null): boolean;
```

`w` is null when there is no window or it is destroyed; otherwise it is `isVisible()`, `isMinimized()` and `isFocused()` of the window. The function returns false only when `w` is visible, not minimised and focused, and `e.done ≥ 1`. Everything else returns true.

`Finished` literals in tests are `{ kind, title: 'Talk', failed, skipped, done }`.

| `e` | `w` | Result |
|---|---|---|
| job, done 1 | visible, not minimised, focused | false |
| group, done 2, failed 1, skipped 1 | visible, not minimised, focused | false |
| job, done 0, failed 1 | visible, not minimised, focused | true |
| job, done 0, skipped 1 | visible, not minimised, focused | true |
| group, done 0, failed 3 | visible, not minimised, focused | true |
| job, done 1 | visible, not minimised, not focused | true |
| job, done 1 | visible, minimised, focused | true |
| job, done 1 | not visible, not minimised, focused | true |
| job, done 1 | not visible, minimised, not focused | true |
| job, done 1 | null | true |

What the user sees, by case:
- Focused and visible: the toast only.
- Visible but not focused: the toast and the OS notification.
- Hidden or minimised: the OS notification; a toast too if the window is shown within 30 seconds.

`tests/jobs/queue.test.ts` gains cases for `done`: a lone job done → 1; failed → 0; skipped → 0; a playlist of two done and one failed → 2; a playlist announced after a cancel with one done member → 1.

## 8. e2e hooks that must stay (D7)

| Hook | Used at | Kept by |
|---|---|---|
| `main.install` with `li strong`, `li .pct`, `p.error`; button Install | `checks.mjs:106-116,109,713` | C5 |
| `header.urlbar` with `input`, `button[type=submit]`, `p.error` | `lib.mjs:321,338-341` | C3 |
| Settings button | `lib.mjs:408` | C3 changes it to `nav.rail button[aria-label=Settings]` and edits `lib.mjs:408` in the same change; the `aria-label` is present at every width |
| `.empty h2` | `checks.mjs:123` | C3 |
| `.dialog`: present while a dialog is open, gone from the DOM in the commit that closes it | `lib.mjs:341,358,409,418`, `checks.mjs:155,162,1100` | C5: no exit animation on the `.dialog` node |
| `.dialog select` (the first is quality); `.dialog .dialog-actions button.primary` | `lib.mjs:348,357` | C5 |
| `.dialog fieldset.entries` with `legend`, `li`, `span.num`, `input[type=checkbox]`, `input[type=checkbox]:disabled` | `checks.mjs:548-550,836-840,1378-1379` | C5 |
| `.dialog ul.tools li`; `.dialog p.note` | `lib.mjs:415-417`, `checks.mjs:503-507` | C5 |
| `.dialog label` containing "Speed limit" with a nested `input` | `checks.mjs:1098` | C5 |
| `li.job`; its text contains the state word | `lib.mjs:390`, `checks.mjs:1252` | C4 |
| `.job-name` whose text is exactly the shown name | `lib.mjs:390` | C4: the kind icon sits outside `.job-name` |
| `.job-main > span:not(.job-actions)` holding the quality and the status word | `checks.mjs:323,337` | C4: `span.job-status` stays a direct child of `.job-main` |
| `li.group .group-head .job-quality` | `checks.mjs:845` | C4 |
| `p.banner.persistent`, `p.banner-<id>`; its first `span` is the text; its `button` | `lib.mjs:224-226`, `checks.mjs:554` | C3: the icon is an `svg`, never a leading `span` |
| `p.banner[role=status] span` | `lib.mjs:232` | C3 |
| Button names, English, exact: Install, Close, Save, Open, Open folder, Delete file, Pause, Resume, Cancel, Retry, Update yt-dlp, Select none | `checks.mjs` (`clickButton`, `jobButton`) | C3 to C5: the English text of `S.verbs`, `S.openFile`, `S.openFolder` and these labels is not changed |
| Recorded OS notifications | `checks.mjs:1077,1352` | C11 edits the check at 1352 (section 6, C11); check 19 hides the window already |
| Tray calls recorded by `hook.cjs` | `lib.mjs:292-311` | C8 reads `hook.cjs` first |

## 9. Manual checklist (eye or real app only)

1. Arabic: rail on the right, drawer from the right, bracket on the right, lanes fill from the right; English mirrors. Sizes, speeds, percents, ETA, `2/3` and URLs read left to right in both.
2. Light, dark and follow-system; switching the Windows mode updates the window with no flash of the old background.
3. Network off: fonts render as IBM Plex in both scripts.
4. Windows "Animation effects" off: no motion anywhere; every state still readable.
5. Each state on a real job: queued, probing, downloading (known and unknown size, `~` on media totals), merging, paused with percent, done (Open, Open folder, double-click), failed with reason, skipped, retrying 2/3, cannot resume (downloading and paused), cut off.
6. A real video with separate streams: video lane, then audio lane, then merge, then done (after C7). Audio-only and single-file video show one lane. Pause and resume it: the lanes never show the earlier run's role.
7. A real file: the segment map moves (after C7) and stays through a stall; a server without range support shows "cannot resume".
8. 10 active and 50+ listed: smooth scrolling, no layout shift when numbers change, the focus ring fully visible on every row, CPU near idle while the window is hidden.
9. Widths 1400, 1120, 900, 899, 760 and 720: rail collapse, no horizontal scroll, drawer and sheet fit.
10. Very long Arabic and English titles, alone and in a playlist head: one line, cut at the reading end, full title in the tooltip.
11. Keyboard only: reach and use every control; focus ring always visible; drawer and sheet trap focus, close on Esc and return focus; `Ctrl+L` reaches the link field.
12. Taskbar: fills during a download, never full (in a merge or otherwise), cleared when everything is finished, paused colour when all are paused, red on an engine error.
13. Tray at 100%, 125%, 150% and 200% scaling on light and dark taskbars; the window and Alt+Tab icon.
14. Add sheet with a thumbnail, with none, and with a broken image URL; toast with and without a thumbnail.
15. Finish notices:
    - window focused → the toast only, no OS notification;
    - another app focused → both;
    - window minimised or closed to the tray → the OS notification; opening the window within 30 seconds shows the toast, later than that shows none;
    - a failed download while focused → the OS notification, no toast;
    - five downloads finishing together while focused, then minimise at once and reopen within 30 seconds → the toasts that had not been shown yet appear.
16. Summary strip: the time figure is labelled as the running downloads' time in both languages, shows `~` with a video running, shows `—` with only queued jobs, and keeps showing a time while a playlist has queued items behind a running one.
17. Banners: all four persistent ones and the transient message at once stay separately readable; the transient message closes; with the port busy, "Open settings" opens Settings at Browser.
18. First-run install screen: per-tool progress, error and retry.
19. An extension hand-off (after A3) while the Settings drawer is open: the Add sheet shows above it.
20. `npm run e2e:real` passes.

## 10. Edge cases and failure modes

| Case | Behaviour | Component |
|---|---|---|
| Unknown size | Lane `unknown` (static open-ended track, state word shown); no percent; row ETA empty; taskbar indeterminate while it runs; left out of the strip's figures. | C2, C4, C9 |
| Approximate totals | Media sizes keep `~` (`sizeParts.approx`); summary remaining and time carry `approx`. | C2, C3, C4 |
| Playlist with queued items | Strip time covers the running items only and still shows; remaining is `approx`. | C2, C3 |
| Everything running has no known size, or total speed 0 | Strip time shows `—`. | C2, C3 |
| No separate audio stream | Stream `muxed` → one lane; no merge stage unless yt-dlp reports one. | C2, C7 |
| Audio-only download | One lane; `merging` shows one strand ("finishing"); taskbar share known without a live entry. | C2 |
| Merge fails | The job becomes failed with its reason; lanes keep their last form in the failed tone; retry shows `retrying (n/3)`. After a run that merged with no progress event the entry is gone (L2), so the row shows one lane. | C4, C7 |
| Stream role unknown or yt-dlp output changed | One lane; taskbar indeterminate while that job runs; it is left out of the mean when it is paused or queued. | C2, C7, C9 |
| Progress line without the role mid-run | The stored role is kept (L1); the pair does not flicker. | C7 |
| aria2 stall | The map is kept (L5); speed shows as today. | C7 |
| New run after pause, retry or speed-limit restart | The entry is kept until the first progress event, which replaces it whole (L2, L3). A run that goes straight to `merging` removes it instead. | C7 |
| Engine restart | A new queue has no live entries; rows fall back to one lane. | C7 |
| Playlist with skipped members | Skipped excluded from `total`, shown as a count; all skipped → `0 / 0`, 0%. | C2, C4 |
| Filter hides every member | The playlist is hidden (as today). | C4 |
| 0 jobs | Empty state; summary idle; taskbar none. | C3, C9 |
| 50+ jobs | Memoised rows, `content-visibility` if PC-1 allows, at most 4 updates per second, no perpetual animation on inactive rows. | C4 |
| Very long titles | Ellipsis, `dir="auto"`, `title` tooltip, `min-width: 0` on the name cell. | C4 |
| Missing or refused thumbnail, load error | Fallback tile; fixed box, no layout shift. | C6 |
| Narrow window | Icon rail below 900px; columns drop in today's order (added, then time left). | C3, C4 |
| Reduced motion | D4. | C1 |
| Restart while paused | No live entry → single lane at the stored percent. | C2 |
| Many jobs finish at once | Toasts queue, 3 visible; a playlist gives one toast. | C6 |
| Finish while hidden | Held; toast if shown within 30 s, else none. The OS notification was raised at the finish. | C6, C11 |
| Window hidden while toasts wait | Toasts on screen are removed. Waiting ones are held with their original time and shown if the window returns within 30 s of it. | C6 |
| Two snapshots arrive before one render | Each is diffed against the one before it in the receive function, so no finish is skipped. | C6 |
| Group cancel | Main announces nothing. A toast could appear only if a snapshot showed the playlist finished with a done member mid-cancel; done rows are removed first, so this is not expected. An extra toast would be harmless. | C6 |
| Failed or skipped lone job, playlist with no done member | No toast; the OS notification is raised whatever the focus. | C6, C11 |
| Window focused but fully covered by another window | If the document counts as hidden there, the toast waits for the 30 s rule and no OS notification is raised. PV-1 measures it; C11's plan decides whether the rule needs the document's state. | C11 |
| Engine error, no queue | Banner; taskbar none (empty snapshot). | C3, C9 |
| Engine error with work pending | Taskbar error at the known share, or 0.99 when unknown; never full. | C9 |
| Window closed to tray or recreated | Taskbar value re-applied when a window exists. | C9 |
| `bytesDone` above `bytesTotal` | Fraction clamped to 1; the size text is not clamped (as today). | C2 |
| Port busy | Banner with "Open settings"; Settings opens at Browser. A server `error` banner has no button. | C2, C3 |
| Close a dialog, act again at once | The `.dialog` node is already gone; the next `.dialog` matched is the new one. | C5 |

## 11. Open questions

None blocks freezing. Everything the owner was asked is decided:

| # | Decision (owner, final) |
|---|---|
| Q1 | C7 is in scope. The UI is built on the fallback first. |
| Q2 | Stale speed is not part of this redesign; speed is shown as today. No tolerance rule. |
| Q3 | No in-app toast for a failed or skipped job. |
| Q4 | No thumbnail in the OS notification. |
| Q5 | Taskbar weights: video 0.85, audio 0.13, merge at 0.98. |
| Q6 | Fonts through `@fontsource` npm packages. |
| Q7 | Row actions stay visible; no "more" menu. |
| Q8 | The Add dialog is an end-side sheet. |
| Q9 | The port-busy banner gets "Open settings", through a separate `opens` field; `Banner.action` stays null for the server banner. |
| Q10 | `minWidth` 720. |
| Q11 | `docs/superpowers/**` is history and is never edited. |
| Q12 | One branch, one commit (or a few) per component, one final PR to `main`. |
| Q13 | `parseProbe` does not filter thumbnails now; the window's check is the gate. |
| Q14 | Playlist percent stays the share of finished items. |
| B5 | The strip's time is the time until the running downloads finish (7.2). |
| B6 | Late toasts: 30 seconds (7.11). |
| N5 | OS notification only when the window is hidden, minimised or not focused (7.12). |
| B7 | Probes run before their component's plan freezes; the rules they back are provisional (section 4). |

Orchestrator decisions recorded in r3 (final):

| # | Decision |
|---|---|
| O1 | Plans live in `docs/plans/`: this plan at `docs/plans/2026-11-24-lanes-redesign-architecture.md`, component plans at `docs/plans/2026-11-24-lanes-c<N>-<slug>.md`. Older plans under `docs/superpowers/` are history and are never edited. |
| O2 | C3 implements D4's pause-while-hidden (`data-hidden` on `<html>`); PV-1 runs before C3's component plan freezes. |

Choices made in r2 and r3 to close critique findings, each of which the owner can overturn when reviewing this plan:

| # | Choice | Where |
|---|---|---|
| R1 | A paused, queued or probing job with an unknown share is left out of the taskbar mean; a running one makes the bar indeterminate. | 7.5 |
| R2 | An engine error with an unknown share shows the error bar at 0.99, not full. | 7.5 |
| R3 | The 30 s are measured on the window's clock from when the window learned of the finish. | 7.11 |
| R4 | `Finished` gains `done`, so main and the window agree on which finishes get a toast. A playlist that ended with failures but at least one done member counts as a finish (toast only while focused). | C11, 7.7, 7.12 |
| R5 | Only the port-busy banner gets the button; a server `error` banner does not. | 7.10 |
| R6 | Type sizes stay 14px and 15px. | C1 |
| R7 | The column headings stay. | C4 |
| R8 | Thumbnails on IP-literal and localhost hosts are refused. | 7.6 |
| R9 | The summary time divides by the total speed of all running downloads, including ones with no known size, and is then marked `~`. | 7.2 |
| R10 | A toast that was on screen when the window was hidden counts as shown and is not held; only toasts never shown are held. | C6, 7.11 |
| R11 | A held toast keeps its original time, so hiding the window twice does not extend the 30 s. | 7.11 |
| R12 | A run that goes `probing → merging` with no progress event drops the live entry. | 5.1 L2 |
| R13 | Dialogs have no exit animation on the `.dialog` node. | C5 |

## 12. Risks

- The Phase 2 A3 branch changes `types.ts`, `queue.ts`, `args.ts`, `engine.ts` and `App.tsx` in parallel, and adds `Job` fields.
  - C7 and C11 touch `queue.ts`, C7 touches `engine.ts` and `args.ts`, C2, C3, C5 and C6 touch `App.tsx`.
  - Whichever branch merges second rebases; C7 is planned after A3's shape is known.
  - `sameRow` compares every key, so new `Job` fields need no change. `makeJob` gains A3's fields on merge.
- yt-dlp's template fields can differ between versions, and the app updates yt-dlp itself. Mitigated by "absent keeps, first event of a run replaces" (L1, L2) and PL-1.
- The provisional contracts can change after their probes. D10 confines the change to `laneModel`, `wholeJobFraction`, `sameRow` and their tests.
- The mockup's palette was not measured here. `--line` on `--surface` is far below 3:1, so D5 keeps it decorative. C1's test decides the rest and may shift a few tokens.
- No DOM tests exist, so a layout or RTL regression is caught only by the manual checklist and e2e.
- e2e selectors break if a hook is dropped. Section 8 is the contract, and `e2e:real` runs after C3, C4, C5, C6 and C11. It needs the network and the real tools, so a red run is re-run alone before it counts.
- Two detectors decide a finish: main's announcement and the window's snapshot diff. They are aligned by rule (7.7 against C11's `done ≥ 1`).
  - A window that never saw the job before it finished (created in the same instant) shows no toast for it while main, seeing it focused, raises no notification.
  - Accepted: the window is created at start, before any job can finish.
- One focused finish can still end with no notice: four or more downloads finish together while the window is focused (main raises no notification), the window is hidden before the waiting toasts get their turn, and it stays hidden for more than 30 seconds. The waiting toasts are then dropped by the owner's 30 s rule. Accepted: it needs several finishes within seconds and a hide within 6 seconds, and the rows still show the result.
- `performance.now()` may not count time the PC spends asleep. A finish just before sleep could then toast after waking. PV-1 records the behaviour; an extra toast is harmless.
- The taskbar value can step back when a job finishes, because the mean is over pending jobs only. Accepted; the alternative needs session state.
- 16px tray legibility of the Zip mark is only an eye check; the fallback is a tray variant without the plate, drawn by the same function.
- Thumbnails are requested from the site's CDN when shown, as the Add dialog already does. No referrer is sent and nothing is stored.
- A new npm dependency for fonts; C1's plan confirms licence and size.
- The drawer's focus trap and inert background must work with the `.dialog` hook, the stacked Add sheet and the language switch that remounts the subtree.

## 13. Probes

One process per case, files outside the repository. Each records the Windows build plus the versions below. None has run.

| Probe | Before this plan freezes | Records | Cases |
|---|---|---|---|
| PL-1 | C7's | `yt-dlp --version` (self-updating), ffmpeg build | Separate video and audio; muxed; `-x` audio; with subtitles; resume with the video part complete; fragmented stream with `NA` totals; a run that reaches the merge with no progress line. Confirm the field values hold no whitespace (`parse.ts:69`). |
| PL-2 | C7's | aria2 1.37.0 (`binaries.ts:44`) | Known size; unknown size; no range support; `waiting` and `paused`; a multi-GB file (bitfield length). |
| PE-1 | C9's | Electron 45.4.1 | `setProgressBar` in each mode; 0.99; −1; on a hidden window then shown; on a recreated window. |
| PE-2 | C8's | Electron 45.4.1 | `createFromBitmap` alpha handling (straight or premultiplied); `addRepresentation` with a raw buffer per `scaleFactor` 1, 1.25, 1.5, 2; which one the tray picks; `icon` in the taskbar and Alt+Tab. |
| PC-1 | C4's | Chromium of Electron 45.4.1 | `content-visibility` with a sticky head, an inset focus ring, and 50+ rows. |
| PV-1 | C3's (run once, then used by C6's and C11's) | Electron 45.4.1 | `document.visibilityState` and the `visibilitychange` event under `hide()`, minimise and full occlusion; whether CSS animations stop under `animation-play-state: paused` set from that event; whether `fetchly:changed` reaches a hidden page promptly; `performance.now()` across a hidden period and across sleep; `isVisible()`, `isMinimized()`, `isFocused()` in each of those states and with another app focused. |
| PF-1 | C1's | electron-vite 6, Vite 8 | Package names and subset file paths exist; woff2 lands in `out/renderer/assets`; no `data:` URI with `assetsInlineLimit: 0`; fonts load under the CSP from `file://`. |

---

## Changes from r2

**BLOCKING**

- **B-1** — fixed: `dueOnVisible` now returns the entries with `now − seenAt ≤ windowMs`, with no lower bound; a negative difference counts as 0 and the toast is shown. The row "1000 | 999 (clock earlier)" is now "yes". 7.11 states that no finish is dropped for being "in the future".

**NON-BLOCKING**

- **N-1** — fixed, with one part rejected.
  - Fixed: toasts that were queued and never shown move to the held list with their own `seenAt` when the document becomes hidden. This needed three contract changes in 7.11: a new pure function `holdWaiting` with a test table; `seenAt` is now stamped on every event at receipt, whatever the visibility; `dueOnVisible` returns `HeldFinish[]` instead of `FinishedEvent[]`, so a re-queued toast keeps its original time (choice R11, round-trip test).
  - Rejected: holding a toast that was on screen for less than its 6 s. It was shown, so the finish had a notice; holding it would show the same finish twice (choice R10).
  - Residual, recorded in section 12 and in C11's boundary: a waiting toast is still dropped if the window stays hidden past the owner's 30 s.
- **N-2** — fixed: C5 no longer says "within 300 ms". The `.dialog` node leaves the DOM in the commit that closes it, as today, with no exit animation; an exit effect may run only on an element without the `dialog` class (choice R13). I confirmed the cited call sites (`lib.mjs:341,409,418`, `checks.mjs:155,162`) and added them to sections 2, 8 and 10.
- **N-3** — fixed: C6 states that `finishedEvents` runs once per message in one receive function, before the state is set, never in a render or effect. `App.tsx` has two snapshot sources (`onChanged` at line 40, `refresh()` at line 36), so both go through it. The previous-snapshot ref, the toast queue and the held list live in `App`, outside the `key={lang}` subtree.
- **N-4** — fixed as decided: C3 implements `data-hidden` and its CSS rule. The provisional table gives that rule to C3's plan and leaves the toast's visibility rule and 7.11's clock with C6's. PV-1 runs before C3's plan freezes (sections 4, 6, 13) and gains a case for `animation-play-state`.
- **N-5** — fixed: C11 now names both rows of `docs/manual-checklist-phase1.md` and edits the file in the same change. Row 16 is reworded (the notification is checked with the window hidden or unfocused; focused gives a toast). Row 19 stays true as written, because a closed window is hidden; I checked its text. C11 also lists the history it supersedes without editing it: the spec's line 142 and `phase1-app.md:394,547`. C10's wording now excludes rows C3 or C11 already updated.
- **N-6** — fixed: L2 gains the rule that a `merging` event received while `probing` removes the entry (`state.ts:31` confirms `probing → merging`; choice R12). L6 and L9 reference it, C7's test list names it, the "Merge fails" and "New run" edge rows are updated, and PL-1 gains a case for a run that merges with no progress line.
- **N-7** — fixed: C3 and section 8 state that the Settings button carries `aria-label` at every width, wide rail included.
- **N-8** — fixed: C6's gate is now "no `url(data:` and no `src="data:` in `out/renderer`".
- **N-9** — fixed: C3 states that an `initialSection` that is null or names a section with no heading does nothing. Today's dialog has only Appearance, Browser and Tools (`SettingsDialog.tsx:100,194,295`, confirmed); C5 adds the Downloads heading, and its bullet says `'downloads'` then works. Section 2's Settings row carries the corrected line numbers.
- **N-10** — fixed: D10 now reads "no component interprets a live entry"; a component may look the entry up only to pass it on, and C4 says `JobList` does exactly that.
- **N-11** — fixed as decided: this plan's path is `docs/plans/2026-11-24-lanes-redesign-architecture.md` and component plans go to `docs/plans/2026-11-24-lanes-c<N>-<slug>.md` (header, decision O1). The header and C10 state that frozen plans under `docs/plans/**` are never edited, alongside `docs/superpowers/**`.

**Beyond the findings**

- Section 2 gains two facts found while verifying N-2 and N-3 (dialog close, the two snapshot sources) and the `probing → merging` transition for N-6.
- Section 9 item 15 gains one line for N-1's case, and section 10 gains three rows (waiting toasts, batched snapshots, close-then-act).
- Section 11 records the two orchestrator decisions (O1, O2) and choices R10 to R13.
- `docs/plans/` does not exist in this worktree yet; the first frozen plan creates it.