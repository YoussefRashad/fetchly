# Fetchly "Lanes" UI redesign — C4 Rows: lanes and the playlist bracket

- Date: 2026-11-24. Branch: `feat/lanes-redesign`. File: `docs/plans/2026-11-24-lanes-c4-rows.md`. Revision r2.
- Parent: `docs/plans/2026-11-24-lanes-redesign-architecture.md` (r3, frozen). Its D1–D12, 5.1–5.3, the C4 section, 7.1, 7.4, 7.10 (`sameRow`), sections 8, 9, 10 and the provisional table bind this plan.
- Previous components, all frozen and landing before C4: `…-lanes-c1-foundation.md`, `…-lanes-c2-view-models.md`, `…-lanes-c3-shell.md`.
- Class: component plan of a large task. No migration and no saved-state change, so no rollback section.
- The plan lane is read-only and ran nothing. Every width is hand arithmetic from the CSS and from probe PW-1; every expected value in section 6 is hand-derived from the frozen rules. The tests and the manual checks decide.
- Probes used, all run by the orchestrator on 2026-11-24, Windows 10.0.26100, Electron 45.4.1 (Chrome 156.0.8078.100), one process per case: PC-1 (`.superpowers/design/probe-pc1.md`), PC-2 (`probe-pc2.md`), PW-1 (`probe-pw1.md`), PV-1 (`probe-pv1.md`). No other runtime version was probed. CI runs vitest only, so no probed behaviour is covered by CI.
- Sources read: the four frozen plans; the four probe records; `.superpowers/design/advisor-c3-width.md`; the mockup (`fetchly-ui-directions.html:152-154, 181-239, 402-432, 1056-1204`); `src/renderer/src/components/JobRow.tsx`, `GroupRow.tsx`, `JobList.tsx`, `App.tsx`; `styles.css`, `format.ts`, `strings.ts`, `strings.ar.ts`; `src/shared/types.ts`; `src/main/index.ts:34-50`; `e2e/real/lib.mjs:312-421` and every row selector in `e2e/real/checks.mjs`; `tests/renderer/strings.test.ts`, `columns.test.ts`; `package.json`, `eslint.config.mjs`, `tsconfig.node.json`, `tsconfig.web.json`.
- `AGENTS.md`, `.ai/agents/*.md` and `.ai/security-paths.json` do not exist in this worktree. The code, the `package.json` scripts and `docs/` are the source of truth.
- Line numbers are from this worktree, at the C3 plan commit. C1's, C2's and C3's code is not here, so component and `styles.css` lines are pre-C1 and shift. Each rule is also named by its selector. C1–C3 names (`Icon`, `laneModel`, `groupView`, `sameRow`, `ShowAllContext`, `isDocumentHidden`, `.sr-only`, `--name-min`) are used as their frozen plans give them; a difference in the landed code stops the implement lane.
- **Widths are viewport px** (`window.innerWidth`) unless a figure is called an outer window size (C3 DV-9).
- **Two owner questions are filled in with the plan lane's recommendation and tagged.** `[Q-C4-1/n]` marks the five places that depend on the narrow-window rule, and `[Q-C4-2/n]` the six that depend on the late-flash rule. The owner chooses; the choice is recorded at freeze. Appendices A and B give the exact replacement text for every tagged place under every other option, so the freeze is a substitution. Nothing outside the tagged places changes with either answer.

## 1. Context

C4 replaces today's table rows with the Lanes rows (owner item 1) and gives a playlist its bracket and sticky head (owner item 4). Rows read live detail only through `laneModel`, so until C7 lands every row shows the fallback forms. C4 also replaces C3's interim row grid and owns the row widths from here on.

## 2. Scope

In scope:
- `JobRow`: kind icon, name, quality, size, speed, time left, added, actions on line one; the status on line two; the lanes below. Memoised with `sameRow`.
- `Lanes`: one component that draws every `LaneModel` form.
- `GroupRow`: sticky head from `groupView`, bracket line, collapse.
- `JobList`: one pass over the snapshot, the live lookup (D10), the column headings on the new grid. C3's two empty states and `ShowAllContext` stay as they are.
- The row grid, the two column drops of architecture section 10, and the rule for the narrowest 30px (5.5, owner question Q-C4-1).
- `content-visibility` on rows, after PC-1 and PC-2 (4.8).
- The list as its own stacking context, so the sticky head never paints over a dialog (PC-2).
- A scroll margin on the buttons inside a playlist body, so keyboard focus is never left under the stuck head (PC-2).
- The merge marker, the segment-map sheen and the one-shot "just done" flash (D4), with the late-flash rule (owner question Q-C4-2), and the by-eye check of C3's pause rule (C3 DV-7).
- Removal of `.bar`, which clears the two debts C1 recorded (C1 plan section 2: the `width` transition at `styles.css:405` and the opacity at `styles.css:408-410`).

Out of scope for C4:
- Any change to `laneModel`, `groupView`, `sameRow`, `statusParts`, `allowedVerbs`, `sizeParts`, `speedText`, `etaText`, `addedText`, `isDocumentHidden`. `format.ts` and `frame.ts` are not edited.
- Filling `Snapshot.live` (C7). Pair and segment forms are built and unit-tested here, and first seen on a real job after C7.
- Thumbnails and toasts (C6); the drawer, sheet and install card (C5).
- A row "enter" animation, the mockup's per-member mini bars, a "more" menu, list virtualisation, search, reorder (architecture section 3).
- Any `e2e/real` edit: no hook moves (section 9).
- Any main-process change. `width: 1120` and `minWidth: 720` stay (C3).
- Any `z-index` on `.backdrop` or `.dialog`. The fix for the head-over-dialog problem is on the list side only.
- Blanking a stale speed (architecture Q2). A stalled row's empty speed cell beside the strip's `0 B/s` stays the owner's open point (C3 Q2).

## 3. Files

### Created

| File | Content |
|---|---|
| `src/renderer/src/components/Lanes.tsx` | Draws a `LaneView` (4.3) |
| `src/renderer/src/model/laneView.ts` | Pure: `laneView`, `kindIcon`, the flash rule (6.1–6.3). Codes and numbers only. Addition to the architecture's file list (DV-1) |
| `src/renderer/src/rows.ts` | Pure, with text: `listItems`, `laneTexts`, `groupStatusParts`, `dayStamp`, `sameRowProps` (6.4–6.8). Addition (DV-1) |
| `tests/renderer/laneView.test.ts` | 6.1–6.3 |
| `tests/renderer/rows.test.ts` | 6.4–6.8 |
| `tests/renderer/rowSources.test.ts` | 6.9: text checks, the width budget, four contrast pairs |

### Modified

| File | Change |
|---|---|
| `src/renderer/src/components/JobRow.tsx` | Props gain `live` and `today`; kind icon; `Lanes` replaces `.bar` (lines 92-96); the flash; `memo` (4.2) |
| `src/renderer/src/components/GroupRow.tsx` | `groupView` replaces lines 18-23; head markup; bracket list; props gain `live` and `today` (4.4) |
| `src/renderer/src/components/JobList.tsx` | Lines 24-39 become `listItems`; live lookup; headings without Status (4.1). Props unchanged |
| `src/renderer/src/styles.css` | 4.6: row grid, lanes, bracket, sticky head, stacking isolation, scroll margin, containment, focus offset; C3's interim templates and queries replaced; `.bar` rules removed |
| `src/renderer/src/strings.ts`, `strings.ar.ts` | 4.5: `lanes`, `group`, `listSeparator` added; `columns.status` removed |
| `tests/renderer/columns.test.ts` | Line 82 (section 9) |
| `tests/renderer/shellSources.test.ts` (C3's) | The `styles.css` row (section 9) |

Not modified: `App.tsx`, `format.ts`, `banners.ts`, `frame.ts`, `model/lanes.ts`, `model/rowEqual.ts`, `model/icons.ts`, `src/shared/**`, `src/main/**`, `e2e/**`, `package.json`, every doc, every frozen plan.

### Imports

| Module | Imports |
|---|---|
| `model/laneView.ts` | Types only: `Job`, `JobState` from `../../../shared/types`; `IconName` from `./icons`; `Fill`, `LaneModel`, `Tone` from `./lanes` |
| `rows.ts` | `S` from `./strings`; `matchesFilter`, `type Filter`, `type GroupView` from `./format`; `sameRow` from `./model/rowEqual`; types from `./model/laneView` and `../../shared/types` |

- `model/laneView.ts` imports neither `strings` nor `format` (C2's rule, its section 8). `rows.ts` sits beside `format.ts` and `frame.ts` because it needs both.
- Neither file uses a DOM global or React. The flash rule takes "hidden" and elapsed time as arguments. Tests compile under `tsconfig.node.json`, which has no DOM lib (lines 6, 23), and reach these files through imports.
- No component has a return-type annotation and none names `JSX.Element` (C1 plan 5.4).

## 4. Design

### 4.1 `JobList`

```ts
interface Props { snapshot: Snapshot; filter: Filter; onError(message: string): void }   // unchanged
```

- C3's two empty-state blocks and the `ShowAllContext` read stay. The no-match test becomes `items.length === 0`.
- `const items = listItems(snapshot, filter)` (6.4) replaces the loop at `JobList.tsx:24-39`.
- `const today = dayStamp(Date.now())` (6.7).
- A lone job renders `<JobRow key={job.id} job={job} live={snapshot.live?.[job.id]} today={today} onError={onError} />`.
- A playlist renders `<GroupRow key={group.id} group={group} members={members} visible={visible} live={snapshot.live} today={today} onError={onError} />`.
- D10: `JobList` and `GroupRow` only look the entry up and pass it on. No component reads a field of it.

Headings, `aria-hidden` as today (`JobList.tsx:46`):

```html
<div class="jobs-head" aria-hidden="true">
  <span class="job-name">{c.name}</span>
  <span class="job-quality">{c.quality}</span>
  <span class="job-size">{c.size}</span>
  <span class="job-speed">{c.speed}</span>
  <span class="job-eta">{c.timeLeft}</span>
  <span class="job-added">{c.added}</span>
  <span class="job-actions"></span>
</div>
<ul class="jobs">…</ul>
```

The Status heading (`JobList.tsx:50`) goes, because the status is no longer a column (DV-2). This is a visible change the owner is shown at the C4 commit (13.4).

### 4.2 `JobRow`

```ts
interface Props {
  job: Job;
  /** The job's live entry, passed on unchanged. Read only through laneModel. */
  live: JobLive | undefined;
  /** dayStamp of the render; a new day re-renders the row so the date-added text is current. */
  today: number;
  onError(message: string): void;
}
export const JobRow = memo(JobRowView, sameRowProps);
```

DOM:

```html
<li class="job state-{state}[ in-group]" onDoubleClick=…>           <!-- as JobRow.tsx:54 -->
  <div class="job-main">
    <svg class="icon job-kind"/>                                    <!-- Icon name={kindIcon(job)} -->
    <span class="job-name" title={job.title}><bdi dir="auto" class="job-name-text">{name}</bdi></span>
    <span class="job-quality">…</span>
    <span class="job-size">…</span>                                 <!-- SizeCell, unchanged -->
    <span class="job-status" title={statusText(job)}>…</span>       <!-- parts joined by " · ", unchanged -->
    <span class="job-speed">…</span>
    <span class="job-eta">…</span>
    <span class="job-added" title=…>…</span>
    <span class="job-actions">…</span>                              <!-- buttons, names and order unchanged -->
  </div>
  <div class="lanes lanes-{form}">…</div>                           <!-- Lanes; always rendered -->
  {flash && <i class="job-flash" aria-hidden="true"/>}
</li>
```

- The children of `.job-main` keep today's order and text (`JobRow.tsx:56-90`). CSS places `.job-status` on line two; the DOM does not move.
- The kind icon is an `svg` and the first child of `.job-main`, a sibling of `.job-name`. `.job-name` holds nothing but the name.
- `Lanes` receives `laneView(laneModel(job, live), job)`.
- The lanes block is rendered for every form, `none` included, with a fixed height, so every row has the same height (architecture C4).
- `JobRowView` does not destructure `today`; it exists for the comparison only.
- `sameRowProps` (6.8) compares `job` and `live` with `sameRow`, and `today` and `onError` by identity. C2's note on a stale handler is closed by comparing `onError`.

The flash. Common to every answer of Q-C4-2:
- `const [flash, setFlash] = useState(false)` and a ref holding the previous state. An effect on `job.state` asks `flashStart` (6.3) what to do, then stores the state.
- A row that mounts already done never flashes. The overlay stays in the DOM after its animation, invisible (4.7).
- A row that is off-screen (skipped by `content-visibility`) when its job finishes mounts the overlay like any other row. PC-2: its animation finishes unseen, and scrolling the row in later shows no flash. No code is needed for this, and no option of Q-C4-2 changes it.

**[Q-C4-2/1]** The flash when the window is hidden at the finish. Option recorded at freeze: **F-B** (play late only within a bound).
- The effect calls `flashStart(prev, job.state, isDocumentHidden(document.visibilityState))`, with `isDocumentHidden` from `../frame` (C3).
- `'play'`: `setFlash(true)`.
- `'hold'`: the row stores `performance.now()` in a ref and sets a `held` state. The overlay is not mounted yet.
- While `held`, an effect listens to `visibilitychange` on `document`. On the first event where the document is no longer hidden it clears `held`, and calls `setFlash(true)` only when `flashLate(performance.now() - heldAt, FLASH_LATE_MS)` is true. The listener is removed when `held` clears or the row unmounts.
- `performance.now()` is used because it never runs backwards, so no "finish in the future" case exists and nothing is rejected for it.
- No timer is used. Timers in a hidden window are throttled and could let a flash play after the bound.

### 4.3 `Lanes`

```ts
interface Props { view: LaneView }
export function Lanes({ view }: Props)
```

It renders `<div class="lanes lanes-{view.form}">` and one child per `view.rows` entry. Texts come from `laneTexts(row)` (6.5).

Bar (forms `single` and `pair`):

```html
<div class="lane lane-{color} tone-{tone} fill-{fill}">
  <span class="lane-label" aria-hidden="true">{texts.label}</span>
  <span class="lane-track" role="progressbar" aria-label={texts.label}
        aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={fill === 'unknown' ? undefined : (percent ?? 0)}
        aria-valuetext={texts.aria}>
    <i class="lane-fill" style={{ '--f': scale }}/>
  </span>
  <span class="lane-value metric" aria-hidden="true">{texts.value !== '' && <bdi dir="ltr">{texts.value}</bdi>}</span>
</div>
```

Merge (form `merge`):

```html
<div class="lane lane-merge lane-{color}">
  <span class="lane-label" aria-hidden="true">{texts.label}</span>
  <span class="lane-track" role="progressbar" aria-label={texts.label}>   <!-- no value: indeterminate -->
    <!-- strands 2 --> <i class="lane-fill lane-merge-v"/><i class="lane-fill lane-merge-a"/>
    <!-- strands 1 --> <i class="lane-fill"/>
    <i class="lane-zip"/>
  </span>
  <span class="lane-value"></span>
</div>
```

Map (form `segments`):

```html
<div class="lane lane-map tone-{tone}">
  <span class="lane-label" aria-hidden="true"><bdi>{texts.label}</bdi></span>
  <span class="segs" role="img" aria-label={texts.aria}>
    <span class="seg"><i style={{ '--f': scales[i] }}/></span> …        <!-- one per cell, in order -->
    {view.motion === 'sheen' && <i class="segs-sheen"/>}
  </span>
  <span class="lane-value metric" aria-hidden="true"><bdi dir="ltr">{texts.value}</bdi></span>
</div>
```

- Every cell `laneModel` returns is drawn; none is cut. Values are clamped in `laneView`, and the array is not mutated (C2 section 10).
- `style` carries one custom property: `{ '--f': n } as CSSProperties`.
- No lane element is focusable. None is inside `.job-main`, so `.job-main > span` (`checks.mjs:323`) does not see them.

What each form looks like:

| Form | Look | Text that carries the meaning (D1) |
|---|---|---|
| `single` | One lane, centred in the block. Label by job: "File", "Audio" (audio-only quality) or "Current part" (other media) | The row's status word; the lane's percent |
| `pair` | Video lane over audio lane, `--lane-v` and `--lane-a` | "Video" and "Audio" labels, each with its percent |
| `merge`, 2 strands | One lane, start half `--lane-v`, end half `--lane-a`, a marker travelling from start to end | Label "Merging"; status "finishing…" |
| `merge`, 1 strand | One solid lane with the marker | Label "Finishing" |
| `segments` | A row of cells, each filled by its own share; one sheen over the map while active | Label "Connections: 8" or "File"; value `13/24` |
| `none` | Empty block of the same height | Status "done" or "skipped" |

The map's label when there is no connection count is "File" for every job, a media job included (C2 row 33, provisional). This is accepted under D12: segments come only from the file engine, and "the UI keys on what the live entry holds". A job whose entry holds segments is being fetched as one file in parts, whatever its `job.kind`, so "File" names what the map shows. The label is not keyed on `job.kind`.

Fills and tones:

| | Look |
|---|---|
| fill `known` | The fill scaled to the fraction from the start side |
| fill `full` | The fill at full width; value `100%` |
| fill `unknown` | A static dashed line in the lane colour across the track, square at the end side; value `—` |
| fill `empty` | No fill; the track is a 1px `--field` outline on a clear ground (D5) |
| tone `active` | Solid lane colour |
| tone `waiting` | Solid `--muted` |
| tone `paused` | 45° hatch of `--muted`, full opacity (D5) |
| tone `failed` | Solid `--bad`, full opacity (D5) |

### 4.4 `GroupRow`

```ts
interface Props {
  group: Group;
  /** every job of the group, for the head */
  members: Job[];
  /** the members that pass the current filter */
  visible: Job[];
  /** The snapshot's live map, passed on unchanged; a member's entry is live?.[job.id]. */
  live: Record<string, JobLive> | undefined;
  today: number;
  onError(message: string): void;
}
```

`const view = groupView(members)` replaces `GroupRow.tsx:18-23`. This also removes the local named `summary` that C2 flagged (its section 13).

```html
<li class="group" data-open={open ? '' : undefined}>
  <div class="group-head">
    <button type="button" class="twisty" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={group.title}>
      <svg class="icon"/>                                           <!-- chevronDown open, chevronEnd closed -->
    </button>
    <span class="job-name" title={group.title}><bdi dir="auto" class="job-name-text">{group.title}</bdi></span>
    <span class="job-quality"><bdi dir="ltr">{S.items(view.done, view.total)}</bdi></span>
    <span class="job-status">…</span>                               <!-- groupStatusParts(view), joined by " · ", each in <bdi> -->
    <span class="job-speed">{speed !== '' && <bdi dir="ltr">{speed}</bdi>}</span>   <!-- formatSpeed(view.speed) -->
    <span class="job-added" title=…><bdi>{addedText(group.createdAt)}</bdi></span>
    <span class="job-actions">…</span>
    <div class="group-lane" role="progressbar" aria-label={S.group.progress}
         aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}
         aria-valuetext={S.group.progressText(view.done, view.total)}>
      <i class="lane-fill" style={{ '--f': view.percent / 100 }}/>
    </div>
  </div>
  {open && <ul class="group-members" id={id}>…JobRow per visible member…</ul>}
</li>
```

- `.group-head .job-quality` holds exactly `S.items(done, total)`, for example `2 / 3` (`checks.mjs:845-862`). The skipped count goes in `.job-status`, never there.
- Actions, in this order: Pause all when `view.canPause`; Resume all when `view.canResume`; then the last button, named `S.groupVerbs.cancel` when `view.unfinished`, else `S.verbs.remove`. Names, titles and the confirm are today's (`GroupRow.tsx:25-29, 53-70`).
- The percent keeps today's meaning: the share of finished items (architecture Q14).
- `.group-lane` is today's playlist bar (`GroupRow.tsx:73-75`) drawn as one lane inside the head, so it stays visible while the head is stuck. It is not the mockup's per-member mini bars.
- The head has no size and no time-left cell; its grid areas for them stay empty.
- `id` comes from `useId()`. No CSS rule selects by id (C1 plan section 9).
- `open` stays local state, as today (`GroupRow.tsx:17`).

### 4.5 Strings

Added to `strings.ts` (`EN`) and `strings.ar.ts` (`AR`), the same keys in both:

| Key | EN | AR |
|---|---|---|
| `lanes.video` | `Video` | `فيديو` |
| `lanes.audio` | `Audio` | `صوت` |
| `lanes.file` | `File` | `ملف` |
| `lanes.part` | `Current part` | `الجزء الحالي` |
| `lanes.merge` | `Merging` | `دمج` |
| `lanes.finish` | `Finishing` | `إنهاء` |
| `lanes.connections(n)` | `` `Connections: ${n}` `` | `` `الاتصالات: ${n}` `` |
| `lanes.parts(done, total)` | `` `Parts complete: ${done} of ${total}` `` | `` `الأجزاء المكتملة: ${done} من ${total}` `` |
| `lanes.waiting` | `waiting` | `في الانتظار` |
| `lanes.complete` | `complete` | `مكتمل` |
| `lanes.notStarted` | `not started` | `لم يبدأ` |
| `lanes.sizeUnknown` | `size not known` | `الحجم غير معروف` |
| `group.skipped(n)` | `` `${n} skipped` `` | `` `تم تخطي ${n}` `` |
| `group.progress` | `Finished items` | `العناصر المكتملة` |
| `group.progressText(done, total)` | `` `${done} of ${total}` `` | `` `${done} من ${total}` `` |
| `listSeparator` | `, ` (comma, space) | `، ` (Arabic comma, space) |

Removed from both: `columns.status` (`strings.ts:45`, `strings.ar.ts:38`).

- No Arabic text says تحميل; none holds an Eastern digit. The count forms ("Connections: 8", "تم تخطي 3") avoid Arabic number agreement.
- `strings.test.ts:21` calls every function with `'7', '8'`; each new function accepts that.
- No new leaf is the same in both languages, so `SAME_IN_BOTH` (`strings.test.ts:24`) does not change.
- No existing text changes. `S.verbs`, `S.groupVerbs`, `S.openFile`, `S.openFolder` and `S.items` keep their English text, so the button names of architecture section 8 hold.
- The tone words reuse `S.status.downloading`, `S.status.paused` and `S.status.failed` (`strings.ts:53, 56, 60`).

### 4.6 CSS

Tokens are C1's names only; no `#hex`, no palette name declared again, no second reduced-motion block. The custom properties `--name-min`, `--row-h`, `--head-h`, `--lane-c` and `--f` are layout values, not palette names, and are declared outside the two palette blocks (C1 plan 5.1).

Removed, each named by selector:
- `.bar`, `.bar .fill`, `.bar .fill.unknown`, the two state rules (`styles.css:397-419`).
- `overflow: hidden` on `.jobs > li` (`styles.css:218`); it moves to `.job`.
- C3's interim templates, the `.group-head` template with its 76px minimum, and the row parts of its three queries (C3 plan 4.9). The `main { padding-inline: 8px; }` rule of C3's 800px query stays.
- Any remedy rule C3 landed under its 4.9: a `(max-width: 1117px)` members query (its remedy 1) and any lowered name minimums inside the 800px query (its remedy 2). The implement lane reports each one it removes.
- `.twisty` padding (`styles.css:320-324`) and `.group ul .job` (`styles.css:331-334`), replaced below.

Kept as they are: `.jobs-head` type rules (`styles.css:243-263`), `.job-name`, `.job-name-text` (336-349), `.job-quality`, `.job-size`, `.size-done` (351-377), the done and failed status colours (379-385), `.job-actions` and its button padding (387-395), the 156px action minimum (266-270), and C1's `.job-actions .icon-btn`.

Added:

```css
/* One grid for the headings, the rows and the playlist heads. Line one: kind, name, quality, size,
   speed, time left, added, actions. Line two: the status. Only the name is flexible. A lone row's and
   a head's name keep at least 120px; a member's 98px, because its 22px indent makes up the rest. */
.jobs-head, .job-main, .group-head {
  display: grid;
  grid-template-columns: 24px minmax(var(--name-min, 120px), 1fr) 56px 136px 76px 80px 100px auto;
  grid-template-areas:
    'kind name quality size speed eta added actions'
    '.    status status status status status status .';
  column-gap: 10px; row-gap: 2px; align-items: center; padding: 8px 10px;
}
.jobs-head { row-gap: 0; }
.job-kind, .twisty { grid-area: kind; justify-self: center; }
.job-name { grid-area: name; }
.job-quality { grid-area: quality; }
.job-size { grid-area: size; }
.job-speed { grid-area: speed; }
.job-eta { grid-area: eta; }
.job-added { grid-area: added; }
.job-actions { grid-area: actions; }
.job-status {
  grid-area: status; min-width: 0; font-size: 13px; line-height: 20px;
  /* colour, ellipsis and nowrap as today (styles.css:351-358) */
}
:lang(ar) .job-status { font-size: 14px; line-height: 24px; }
.job-kind { color: var(--muted); }
.state-done .job-kind { color: var(--ok); }
.twisty { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; }
/* Every action button is 28px tall in both languages, so line one is 28px in every row. Without the
   line-height an Arabic text button ("فتح", 15px at 1.65) is about 30.75px and a done row grows. */
.job-actions button { line-height: 20px; min-height: 28px; }

/* Architecture section 10: the date added drops first, then the time left. */
@media (max-width: 1039px) {
  .jobs-head, .job-main, .group-head {
    grid-template-columns: 24px minmax(var(--name-min, 120px), 1fr) 56px 136px 76px 80px auto;
    grid-template-areas:
      'kind name quality size speed eta actions'
      '.    status status status status status .';
  }
  .job-added { display: none; }
}
@media (max-width: 929px) {
  .jobs-head, .job-main, .group-head {
    grid-template-columns: 24px minmax(var(--name-min, 120px), 1fr) 56px 136px 76px auto;
    grid-template-areas:
      'kind name quality size speed actions'
      '.    status status status status .';
  }
  .job-eta { display: none; }
}
/* The block for (max-width: 735px) is given in section 5.5 [Q-C4-1/1]. It follows the 929px block. */

/* The list is its own stacking context (PC-2). The head's z-index 2 and the bracket's 1 are compared
   only inside the list, so a fixed layer outside it (a dialog's backdrop) paints over rows and heads. */
.jobs { isolation: isolate; --row-h: 108px; --head-h: 76px; }
:lang(ar) .jobs { --row-h: 116px; --head-h: 80px; }

/* Rows. PC-1: only rows are contained, never the playlist li or its head. --row-h is the row's content
   height (without its borders); PC-2: keep it at the real height, or the scrollbar length drifts. */
.job { position: relative; overflow: hidden; content-visibility: auto; contain-intrinsic-size: auto var(--row-h); }
/* Rows are clipped at their own box, so every focus ring is drawn inside it. */
.job :focus-visible, .group-head :focus-visible { outline-offset: -2px; }

/* Lanes. The block has one height for every form, "none" included. */
.lanes { display: grid; align-content: center; gap: 2px; height: 34px; margin-bottom: 8px; padding-inline: 44px 10px; }
:lang(ar) .lanes { height: 38px; }
.lane {
  display: grid; grid-template-columns: minmax(0, 104px) minmax(0, 1fr) 44px; column-gap: 8px;
  align-items: center; height: 16px; font-size: 12px; line-height: 16px; color: var(--muted);
}
:lang(ar) .lane { height: 18px; font-size: 13px; line-height: 18px; }
.lane-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lane-value { text-align: end; }
.lane-v { --lane-c: var(--lane-v); }
.lane-a { --lane-c: var(--lane-a); }
.lane-track { position: relative; height: 6px; border-radius: 3px; background: var(--track); overflow: hidden; }
/* D2: fills grow from the start side. */
.lane-fill {
  position: absolute; inset: 0; border-radius: 3px; background: var(--lane-c, var(--lane-v));
  transform: scaleX(var(--f, 0)); transform-origin: 0 50%; transition: transform 0.25s linear;
}
[dir='rtl'] .lane-fill { transform-origin: 100% 50%; }
.tone-waiting .lane-fill { background: var(--muted); }
.tone-paused .lane-fill { background: repeating-linear-gradient(-45deg, var(--muted) 0 3px, transparent 3px 6px); }
.tone-failed .lane-fill { background: var(--bad); }
.fill-empty .lane-track { background: transparent; box-shadow: inset 0 0 0 1px var(--field); }
.fill-unknown .lane-track { background: transparent; border-start-end-radius: 0; border-end-end-radius: 0; }
.fill-unknown .lane-fill { border-radius: 0; background: repeating-linear-gradient(90deg, var(--lane-c) 0 6px, transparent 6px 12px); }

/* Merge: two strands meet; the marker runs from start to end. Its resting place is mid-track.
   The marker's body is the row's ground colour with an ink edge, so it reads on both lane colours. */
.lane-merge .lane-track { overflow: visible; }
.lane-merge .lane-fill { transform: none; transition: none; }
.lane-merge-v { inset-inline: 0 50%; background: var(--lane-v); border-start-end-radius: 0; border-end-end-radius: 0; }
.lane-merge-a { inset-inline: 50% 0; background: var(--lane-a); border-start-start-radius: 0; border-end-start-radius: 0; }
.lane-zip { position: absolute; inset: 0; pointer-events: none; transform: translateX(calc(50% - 5px)); animation: lane-zip 2.4s cubic-bezier(0.45, 0, 0.3, 1) infinite; }
.lane-zip::before {
  content: ''; position: absolute; inset-block-start: -2px; inset-inline-start: 0; width: 10px; height: 10px;
  border-radius: 2px; background: var(--surface); box-shadow: inset 0 0 0 2px var(--ink); transform: rotate(45deg);
}
[dir='rtl'] .lane-zip { transform: translateX(calc(-50% + 5px)); animation-name: lane-zip-rtl; }
@keyframes lane-zip { 0% { transform: translateX(0); opacity: 1; } 85% { transform: translateX(calc(100% - 10px)); opacity: 1; } 100% { transform: translateX(calc(100% - 10px)); opacity: 0; } }
@keyframes lane-zip-rtl { 0% { transform: translateX(0); opacity: 1; } 85% { transform: translateX(calc(-100% + 10px)); opacity: 1; } 100% { transform: translateX(calc(-100% + 10px)); opacity: 0; } }

/* Segment map: cells in file order from the start side; one sheen for the whole map. */
.segs { position: relative; display: flex; gap: 2px; height: 10px; overflow: hidden; }
.seg { position: relative; flex: 1 1 0; min-width: 0; border-radius: 2px; background: var(--track); overflow: hidden; }
.seg > i { position: absolute; inset: 0; background: var(--lane-v); transform: scaleX(var(--f, 0)); transform-origin: 0 50%; transition: transform 0.25s linear; }
[dir='rtl'] .seg > i { transform-origin: 100% 50%; }
.tone-waiting .seg > i { background: var(--muted); }
.tone-paused .seg > i { background: repeating-linear-gradient(-45deg, var(--muted) 0 3px, transparent 3px 6px); }
.tone-failed .seg > i { background: var(--bad); }
.segs-sheen {
  position: absolute; inset: 0; pointer-events: none; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--surface) 45%, transparent), transparent);
  animation: lane-sheen 1.6s linear infinite;
}
[dir='rtl'] .segs-sheen { transform: translateX(100%); animation-name: lane-sheen-rtl; }
@keyframes lane-sheen { to { transform: translateX(100%); } }
@keyframes lane-sheen-rtl { to { transform: translateX(-100%); } }

/* "Just done": a one-shot fade of an overlay (D4). Its resting style is invisible. */
.job-flash {
  position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background: color-mix(in srgb, var(--tint) 60%, transparent); box-shadow: inset 0 0 0 2px var(--ok);
  animation: job-flash 1.8s ease-out;
}
@keyframes job-flash { from { opacity: 1; } to { opacity: 0; } }

/* Playlist: sticky head, bracket on the start side. The li is not clipped, or the head could not stick. */
.group-head { position: sticky; top: 0; z-index: 2; background: var(--tint); border-radius: 7px 7px 0 0; font-weight: 600; }
.group:not([data-open]) .group-head { border-radius: 7px; }
.group-lane { grid-column: 1 / -1; grid-row: 3; position: relative; height: 4px; margin-top: 4px; border-radius: 2px; background: var(--track); overflow: hidden; }
.group-members { position: relative; }
.group-members::before {
  content: ''; position: absolute; z-index: 1; pointer-events: none;
  inset-block: 6px; inset-inline-start: 8px; width: 8px;
  border: 2px solid var(--accent); border-inline-end: 0;
  border-start-start-radius: 3px; border-end-start-radius: 3px;
}
.group-members .job { --name-min: 98px; padding-inline-start: 22px; border-top: 1px solid var(--line); }
.group-members .job:last-child { border-end-start-radius: 7px; border-end-end-radius: 7px; }
/* PC-2: the browser does not scroll a focused button that the stuck head covers. With this margin,
   keyboard and programmatic focus bring it 8px clear of the head. */
.group-members button { scroll-margin-block-start: calc(var(--head-h) + 8px); }
```

Notes:
- RTL: offsets, radii and paddings are logical. Three things cannot be: the `transform-origin` of the fills, and the direction of the two travelling animations. Each has one `[dir='rtl']` rule. The hatch and the sheen band are symmetric.
- Members are indented 22px, the bracket sits in that indent, and every fixed column still lines up with the headings because the columns are anchored at the end side.
- The kind column is 24px in rows and heads alike, so the twisty and the kind icon share it and names line up. C3's 76px head minimum (its DV-10) is gone: a head needs exactly what a lone row needs.
- The sticky head sticks to `main`, the only scroll container (C3 plan section 12). `.jobs-head` is not sticky.
- **Stacking (PC-2).** Without `isolation`, the head (`z-index: 2`) and the bracket (`z-index: 1`) sat in the root stacking context above `.backdrop`, which is `position: fixed` with no `z-index` (`styles.css:421-429`). PC-2 confirmed the head took clicks inside and outside a dialog. With `.jobs { isolation: isolate; }` the dialog and its backdrop take them. `.backdrop` is not edited.
- **Heights.** These are hand sums, not measured.

  | Box | English | Arabic |
  |---|---|---|
  | Line one | 28px (every action button is 28px) | 28px |
  | Status line | 20px | 24px |
  | `.job-main` (16px padding, 2px row gap) | 66px | 70px |
  | Lanes block (with its 8px margin) | 42px | 46px |
  | Row content height, `--row-h` | 108px | 116px |
  | Lone row, outer (1px border top and bottom, `styles.css:215`) | 110px | 118px |
  | Member row, outer (1px top border) | 109px | 117px |
  | Head, `--head-h` (16px padding, line one, status, two 2px gaps, 8px lane) | 76px | 80px |

  `contain-intrinsic-size` sets the size of the content box, and the borders are added by layout, so `--row-h` is the content height. This reading is from the CSS specification, not from a probe. Manual check 4 reports the outer heights; remedy 2 covers a difference.
- **Focus under the head (PC-2).** Member rows hold only buttons as focusable elements, so `.group-members button` covers every focusable element in a playlist body. The margin is `--head-h` plus 8px: 84px in English and 88px in Arabic. PC-2 found this the smallest jump; `scroll-padding` on the scroller also works but moved focus about 210px further.
- **Merge marker (critique N-7).** Its colour changed from `--ink`, which reached only about 2.16 and 1.94 against `--lane-v` and 3.16 and 1.77 against `--lane-a` (light, dark). The body is now `--surface` with a 2px `--ink` edge. `--surface` against both lane colours is 5.22 or more in both themes, and `--ink` against `--surface` is 13.61 or more; C1's palette test already covers all of these pairs (section 7). The marker is still not the carrier of meaning: the label "Merging" or "Finishing" and the status "finishing…" are.
- The marker's box and the sheen move past their track; `.job { overflow: hidden }` clips them at the row.
- `color-mix()` derives from a token and adds no literal colour. It was not probed; Chromium has had it since version 111.
- The paused hatch is scaled with its fill, as in the mockup (`fetchly-ui-directions.html:217`), so its stripes narrow at low percents. Checked by eye.

### 4.7 Motion (D4) and the pause-while-hidden check (C3 DV-7)

| Motion | Kind | Properties | When |
|---|---|---|---|
| Fill growth (`.lane-fill`, `.seg > i`) | transition, 0.25s linear, the push interval (architecture section 2) | `transform` | On each value change |
| Merge marker (`.lane-zip`) | perpetual | `transform`, `opacity` | Form `merge` |
| Map sheen (`.segs-sheen`) | perpetual | `transform` | Form `segments` with tone `active` |
| Just-done flash (`.job-flash`) | one-shot, 1.8s | `opacity` | A mounted row becomes done, as 6.3 decides |

- At most one perpetual animation per row: `laneView.motion` is `'zip'`, `'sheen'` or `'none'`, and the two forms exclude each other. A row that is not probing, downloading or merging has none.
- An `unknown` lane is static, as architecture section 10 says. A plain lane has no sheen.
- The merge marker loops, where the mockup's ran once (`fetchly-ui-directions.html:225-226`): a merge has no known length, and a marker resting at the end would read as finished (Q7).
- Reduced motion: C1's single block removes every animation and transition. Each resting style is the readable state: fills at their value, the marker mid-track, the sheen off the map, the flash invisible. C4 adds no second block.
- Hidden window: C4 adds no pause rule. C3's `html[data-hidden]` rule covers these elements.
- Rows skipped by `content-visibility` are not painted. PC-2: an animation's timeline still advances in a skipped row, so a one-shot animation started there finishes unseen and does not play when the row scrolls in. r1's sentence that skipped rows "do not run their animations" is withdrawn.
- PC-2, hidden document: a one-shot animation started under `html[data-hidden]` stays paused at its first frame, and plays in full when the attribute is removed, however long ago it started. Q-C4-2 decides what C4 does about that (4.2, 6.3).

DV-7 check, by eye, in manual check 9 (section 10). The exact rule (universal selector, both pseudo-elements, `!important`) was not probed by PV-1; PC-2 ran it on a one-shot animation and saw it pause. C4 is where it is first seen on the app's own perpetual animations.
- If an animation keeps running in any of the three hidden cases, C4 stops and reports. C4 does not add a rule of its own.

### 4.8 PC-1 and PC-2 results, and the amendment to the `content-visibility` rule

PC-1 (`probe-pc1.md`), 20 member rows under a sticky head plus 60 plain rows, each `content-visibility: auto; contain-intrinsic-size: auto 64px; height: 64px`:
1. Off-screen rows are skipped (80 skipped and 16 shown on load).
2. The sticky head stays pinned, because its parent `li` has no `content-visibility`.
3. An inset focus ring (`outline-offset: -3px`) is drawn; an outset ring is drawn only when it lies inside the row box.
4. Not measured: a ring that crosses the row's edge, and smoothness or CPU with 50+ live rows.

PC-2 (`probe-pc2.md`), 30 member rows under a 48px sticky head with `z-index: 2`, plus 30 lone rows, in a 500px scroller, rows with `content-visibility: auto; contain-intrinsic-size: auto 108px`:

| Question | Result | What C4 does |
|---|---|---|
| Does the browser scroll a focused button out from under the stuck head? | No. After Shift+Tab, and after a programmatic `focus()`, the button stayed at 2..30px under the 0..48px head, with no scroll at all | r1's two sentences that said it does are corrected (sections 7 and 11) |
| `scroll-margin-block-start: 56px` (head + 8px) on the buttons | The button lands at 56..84px, clear of the head, for both keyboard and programmatic focus | Adopted, sized from `--head-h` (4.6) |
| `scroll-padding-block-start: 56px` on the scroller | Also clear, but the button lands at 264..292px | Not used: a much larger jump |
| Sticky head with `z-index: 2` against a fixed backdrop with no `z-index` | The head is the hit target inside and outside the dialog | — |
| The same with `.jobs { isolation: isolate }` | The dialog and the backdrop are the hit targets | Adopted (4.6) |
| Rows with content height under `content-visibility: auto` | `scrollTop` set to 400, 1200, 2400, 3600, 1800, 600 reads back equal, at once and after 300ms: no jump. The head stays pinned inside its playlist and scrolls away past its end | Confirms C4's content-height rows, which PC-1 had not covered |
| The same, scrollbar length | `scrollHeight` drifted from 6424 to 6054 as rows were measured, because the 108px placeholder was larger than the probe's real rows | `--row-h` is kept at the real content height, per language; remedy 2 corrects it from a measurement |
| One-shot animation in a skipped row | `finished` after 3s; no flash when scrolled in | 4.2, 4.7 |
| One-shot animation in a `data-hidden` document | Paused at its start after 3s; plays from the start once the attribute is removed | Q-C4-2 |

Not probed by PC-2:
- The scroll margin on rows with content height (the fix was probed on 64px rows only).
- Focus moving into a row that `content-visibility` is skipping.
- Whether the head still sticks with `isolation: isolate` on the list. The probe checked hit targets in that case, not the pinning.

Manual checks 5, 14 and 15 cover these.

Amendment (the only one C4 may make):

| Architecture, as frozen | Rule after C4 |
|---|---|
| "Rows use `content-visibility: auto` with `contain-intrinsic-size`. PROVISIONAL on PC-1." | Confirmed for `li.job` only: lone rows and playlist members. `li.group` and `.group-head` never get it, and `li.group` is not clipped. |
| "focus rings are drawn inside the row box" | `outline-offset: -2px` on every focusable element inside `.job` and `.group-head`; ring colour and width are C1's. |
| "no effect paints outside it" | Rows also carry `overflow: hidden`, so the look is the same with or without containment. |

- **The shorthand is kept** (critique N-17): `contain-intrinsic-size: auto var(--row-h)`. It is the form both probes ran. It also sets the inline axis, which has no effect here: a row is a block-level `li` that fills its container's width, so its inline size never comes from its contents. `contain-intrinsic-block-size` would say the same thing more exactly but was not probed.
- C4's rows have no fixed `height`; they take their height from content, with `--row-h` as the placeholder until a row is first rendered. PC-2 confirmed there is no scroll jump in that case.
- Fallback, as the architecture states: if the sticky head, a focus ring, scrolling or an e2e locator misbehaves, remove the two declarations `content-visibility` and `contain-intrinsic-size` from `.job`, keep the memoisation and everything else, and report (remedy 3, section 5.6).
- Consumers of the rule: C4 only. No test changes meaning.

## 5. Widths

### 5.1 Inputs

- PW-1, at 150% scaling: viewport = outer width − 15px; start size (outer 1120) = 1106px; minimum (outer 720) = 706px; classic scrollbar 15px. 100% and 125% were not probed.
- Frame around a row: rail 148px, or 56px below a 900px viewport (C3 plan 4.8); `main` padding 28px (`styles.css:198`), or 16px at or below 800px (C3 plan 4.9); scrollbar 15px, counted always.

| Rail | Viewport | Frame takes |
|---|---|---|
| wide | 900 and wider | 148 + 28 + 15 = 191 |
| icon | 801 to 899 | 56 + 28 + 15 = 99 |
| icon | 800 and narrower | 56 + 16 + 15 = 87 |

- Row constants: 2px border, 20px padding, 10px gaps; columns 24 (kind), name minimum `N`, 56, 136, 76, 80, 100, and 156 (the action minimum, `styles.css:266-270`).

### 5.2 What a row needs

| Columns on line one | Fixed columns + N | Gaps | Border and padding | Need | At N = 120 |
|---|---|---|---|---|---|
| all eight | 628 + N | 70 | 22 | 720 + N | 840 |
| without "added" | 528 + N | 60 | 22 | 610 + N | 730 |
| without "added" and "time left" | 448 + N | 50 | 22 | 520 + N | 640 |
| and without "speed" on line one | 372 + N | 40 | 22 | 434 + N | 554 |

- The status adds nothing: it is on line two, spans fixed tracks and the name, and has `min-width: 0`.
- All three kinds of row need the same:
  - lone row and column headings: N = 120;
  - playlist member: 22px indent + N = 98, so `22 + 98 = 120`;
  - playlist head: the twisty is in the 24px kind column, N = 120.
- For comparison, C3's interim row needed 896 with all columns (C3 plan 4.9). The status left line one (−90) and the kind column came in (+34).

### 5.3 Thresholds

Each threshold is "exact need + frame + 9 − 1", the same 9px margin C3 used.

| Query | Effect | At the first width above it |
|---|---|---|
| `max-width: 1039px` | "added" drops | 1040: 840 + 191 = 1031, 9 spare |
| `max-width: 929px` | "time left" drops | 930: 730 + 191 = 921, 9 spare |
| `max-width: 735px` | the rule of 5.5 | 736: 640 + 87 = 727, 9 spare |

- Drops are monotonic: a column dropped at a wider width never returns at a narrower one. "Time left" could fit again from 838 to 899 beside the icon rail; it stays dropped.
- With only the two drops of architecture section 10, rows fit every viewport from 736px up. Only the last 30px, 706 to 735, need a third rule. That is the owner's question (5.5).
- At the start size "added" shows on every kind of row, so the comment at `index.ts:36` stays true and is not edited.

### 5.4 The four widths

Row width available = viewport − frame. Name width = N + spare, because the name is the only flexible column.

| Viewport | Rail | Available | Columns on line one | Need | Spare | Name: lone / member / head |
|---|---|---|---|---|---|---|
| 1106 (start size) | 148 | 915 | all | 840 | 75 | 195 / 173 / 195 |
| 900 | 148 | 709 | no "added", no "time left" | 640 | 69 | 189 / 167 / 189 |
| 899 | 56 | 800 | the same | 640 | 160 | 280 / 258 / 280 |
| 800 | 56 | 713 | the same | 640 | 73 | 193 / 171 / 193 |
| 736 | 56 | 649 | the same | 640 | 9 | 129 / 107 / 129 |
| 706 (minimum) | 56 | 619 | see 5.5 | see 5.5 | see 5.5 | see 5.5 |

At 800px nothing depends on the owner's answer.

### 5.5 Owner question Q-C4-1: the rule from 706 to 735

**The variant is chosen by the owner and recorded here at freeze.** Architecture section 10 lists two drops; C3 used a third (speed below 801, its DV-2) only as an interim, and its frozen boundary row says the question is answered before C4's plan is frozen. With C4's grid the question covers only the 30px between the minimum window and a 736px viewport, where a row with two drops needs 727px.

The four options, with the arithmetic at the 706px minimum (available 619):

| Option | Line one | Need | Spare | Name: lone / member / head | What changes for the user | Against the frozen architecture |
|---|---|---|---|---|---|---|
| **V-M** | kind, name, quality, size, actions | 554 | 65 | 185 / 163 / 185 | The speed moves to the end of line two, under the actions. The Speed heading is hidden, so the figure has no heading. The status line ends 166px before the row's end (the action column and its gap) | Deviates: the architecture says headings "drop with their columns", and here a heading goes while its cell stays. No column's data is dropped |
| **V-S** | kind, name, quality, size, actions | 554 | 65 | 185 / 163 / 185 | A row's own speed is not shown below 736px; the strip still shows the total. The status line is the same length as under V-M | Deviates: a third drop that section 10 does not list |
| **V-A** | kind, name, quality, size, speed, actions | 610 | 9 | 99 / 77 / 99 | Nothing moves or hides. Names are short: about 10 characters for a member. No room is left if the action column grows (5.6, remedy 1) | Conforms fully: two drops, every heading with its column |
| **V-Q** | kind, name, size, speed, actions | 574 | 45 | 165 / 143 / 165 | The quality is not shown on rows. The head must keep its `2 / 3` (an e2e hook), so head and rows stop lining up | Deviates: a third drop that section 10 does not list |

Not offered: dropping the size (the row's main figure) and raising the minimum width (owner decision Q10 fixed 720).

The plan lane's recommendation is V-M. Reasons: it is the only option besides V-A that keeps every figure on the row, and it leaves names 185px where V-A leaves 99px with no slack. Its cost is an unlabelled speed figure in an unusual place and a recorded deviation. V-A is the choice if conformity with section 10 matters more than name room.

**[Q-C4-1/1]** Variant recorded at freeze: **V-M**.

```css
@media (max-width: 735px) {
  .jobs-head, .job-main, .group-head {
    grid-template-columns: 24px minmax(var(--name-min, 120px), 1fr) 56px 136px auto;
    grid-template-areas:
      'kind name quality size actions'
      '.    status status status speed';
  }
  .jobs-head .job-speed { display: none; }
}
```

- At 706px: line one is kind, name, quality, size, actions; need 554; spare 65; names 185 / 163 / 185.
- The playlist head follows the rows: its combined speed sits at the end of its line two.
- Recorded as DV-9.

Strings, components, the DOM and every test outside the tagged places are the same for all four options.

### 5.6 Permitted remedies

Anything else stops and reports. A remedy that changes a string asserted in 6.9 stops the implement lane, and a tests lane updates the assertion.

1. If the landed `.job-actions` minimum `A` is not 156px (C1's manual check 11 may have raised it): thresholds become `883 + A`, `773 + A` and `579 + A`. Report the values. Bounds:
   - "added" still shows at the start size while `A ≤ 222` (`684 + A + 191 ≤ 1106 − 9`);
   - the two-drop row fits 801px while `A ≤ 209` (`484 + A + 99 ≤ 801 − 9`);
   - the 706px minimum fits while `A ≤ 212` under V-M or V-S (`398 + A + 87 ≤ 697`), `A ≤ 192` under V-Q (`418 + A + 87 ≤ 697`), and `A ≤ 156` under V-A (`454 + A + 87 ≤ 697`, no slack).
   - Past a bound, stop and report.
2. If a row's measured content height (its outer height minus its borders) differs from `--row-h` (108px, Arabic 116px): set `--row-h` to the measured value. Report it.
3. If `content-visibility` misbehaves (4.8): remove its two declarations from `.job` and report.
4. If a lane label is cut at 104px in English or Arabic: widen the label column, up to 128px. Report it.
5. If manual check 6 shows a row clipped at a boundary: raise that threshold by the measured overflow plus 9px. Report it.
6. If manual check 4 still shows rows of different heights in one language (for example a done row taller because of its text button): add `grid-template-rows: 28px auto;` to `.job-main`, so line one has a fixed height. Report it.
7. If the measured head height differs from `--head-h` (76px, Arabic 80px): set `--head-h` to the measured value. Report it.
8. If manual check 8 shows stutter with segment maps on 10 active rows (up to 24 cells each, every one with a `transform` transition every 250ms): remove the `transition` from `.seg > i`, so cells jump to their value. Report it.

If manual check 15 shows a focused member button still under the head after remedy 7, stop and report; no further remedy is permitted here.

## 6. Pure parts and their acceptance tables

Vitest runs in `node` with no DOM, and tests are compiled without a `jsx` setting, so no test imports a `.tsx` file. Structure is checked as text (6.9); the look is a manual check (section 10).

- Jobs come from `makeJob` and live entries from `makeLive` (`tests/helpers.ts`, C2 plan section 5). "media" is the default; "file" is `makeJob({ kind: 'file', quality: null, baseName: null, … })`.
- Lane models in 6.1 are literals, so the tests do not depend on `laneModel`; one property row ties the two together.
- Text tests run in English and, after `setLanguage('ar')`, in Arabic, and reset the language in `afterEach` (as `strings.test.ts:65`).

```ts
// src/renderer/src/model/laneView.ts
export type LaneLabel = 'video' | 'audio' | 'file' | 'part';
export type LaneColor = 'v' | 'a';
export interface BarView {
  kind: 'bar';
  label: LaneLabel;
  color: LaneColor;
  tone: Tone;
  fill: Fill['kind'];
  /** scaleX of the fill, 0..1: the clamped fraction for known, 1 for full and unknown, 0 for empty. */
  scale: number;
  /** Whole percent: floor(scale × 100) for known, 100 for full, null for unknown and empty. */
  percent: number | null;
}
export interface MergeView { kind: 'merge'; strands: 1 | 2; label: 'merge' | 'finish'; color: LaneColor }
export interface MapView {
  kind: 'map';
  tone: Tone;
  /** One scale per cell of the model, in order, each clamped to 0..1; a non-finite cell is 0. A new array. */
  scales: number[];
  /** The number of cells whose scale is 1. */
  complete: number;
  connections: number | null;
}
export type LaneRow = BarView | MergeView | MapView;
export interface LaneView {
  form: LaneModel['form'];
  rows: LaneRow[];
  /** The row's one perpetual animation, if any. */
  motion: 'none' | 'zip' | 'sheen';
}
export function laneView(model: LaneModel, job: Job): LaneView;
export function kindIcon(job: Job): IconName;
// the flash rule's exports are in 6.3

// src/renderer/src/rows.ts
export type ListItem =
  | { kind: 'job'; job: Job }
  | { kind: 'group'; group: Group; members: Job[]; visible: Job[] };
export function listItems(snapshot: Snapshot, filter: Filter): ListItem[];
export interface LaneTexts { label: string; value: string; aria: string }
export function laneTexts(row: LaneRow): LaneTexts;
export function groupStatusParts(view: GroupView): string[];
export function dayStamp(ms: number): number;
export interface RowProps { job: Job; live: JobLive | undefined; today: number; onError(message: string): void }
export function sameRowProps(a: RowProps, b: RowProps): boolean;
```

The JSDoc comments above and in 6.3 are promises; the tests lane tests each.

### 6.1 `laneView`

Rules:
- `none` → no rows, motion `none`.
- `single` → one bar from the model's fill and tone. Label and colour by job: `kind === 'file'` → `file`, `v`; media with `quality?.kind === 'audio'` → `audio`, `a`; any other media → `part`, `v`.
- `pair` → two bars, in this order: `video`, `v` from `model.video`; `audio`, `a` from `model.audio`.
- `merge` → one merge row with the model's `strands`. Two strands: label `merge`, colour `v`. One strand: label `finish`, colour `v` for a file job, else `a`. Motion `zip`.
- `segments` → one map row. Motion `sheen` when the tone is `active`, else `none`.
- A bar's `scale` and `percent`: `known` → the fraction, where a non-finite fraction (`NaN`, `+Infinity`, `−Infinity`) is 0 and any other is clamped to 0..1, and `Math.floor(scale * 100)`; `full` → 1 and 100; `unknown` → 1 and null; `empty` → 0 and null.
- The non-finite test comes before the clamp, for bars and for map cells. `+Infinity` is therefore 0, not 1.
- Neither argument is changed.

| # | Model | Job | Expected |
|---|---|---|---|
| 1 | `none` | any | `{ form: 'none', rows: [], motion: 'none' }` |
| 2 | single, known 0.25, active | file | one bar: `file`, `v`, active, known, scale 0.25, percent 25; motion `none` |
| 3 | single, known 0.25, active | media | bar `part`, `v`, 0.25, 25 |
| 4 | single, known 0.25, active | media, quality audio m4a | bar `audio`, `a`, 0.25, 25 |
| 5 | single, unknown, active | file | bar `file`, `v`, unknown, scale 1, percent null |
| 6 | single, empty, waiting | media | bar `part`, `v`, waiting, empty, scale 0, percent null |
| 7 | single, known 0.4, paused | media | bar paused, 0.4, 40 |
| 8 | single, known 0.25, failed | file | bar failed, 0.25, 25 |
| 9 | single, known 1, active | file | fill `known`, scale 1, percent 100 |
| 10 | single, known 29/100, active | file, 29/100 | `percent` equals `percent(job)` from `format.ts` (the same float expression, `format.ts:34`) |
| 11 | pair: video known 0.25 active; audio empty waiting | media | bars `[video v active known 0.25 25]`, `[audio a waiting empty 0 null]`; motion `none` |
| 12 | pair: video full active; audio known 0.75 active | media | `[video v active full 1 100]`, `[audio a active known 0.75 75]` |
| 13 | pair: video known 0.4 paused; audio empty paused | media | both bars paused; 0.4 and 40; 0 and null |
| 14 | pair: video unknown active; audio empty waiting | media | `[video … unknown 1 null]`, `[audio … empty 0 null]` |
| 15 | merge, strands 2 | media | `{ kind: 'merge', strands: 2, label: 'merge', color: 'v' }`; motion `zip` |
| 16 | merge, strands 1 | media, quality audio mp3 | label `finish`, colour `a`; motion `zip` |
| 17 | merge, strands 1 | file | label `finish`, colour `v` |
| 18 | segments `[1, 1, 0.5, 0]`, connections 8, active | file | map: scales `[1, 1, 0.5, 0]`, complete 2, connections 8; motion `sheen` |
| 19 | segments `[1, 0.5, 0, 0]`, connections null, paused | file | complete 1, connections null; motion `none` |
| 20 | segments `[1.5, -0.2, NaN, 0.5]`, active | file | scales `[1, 0, 0, 0.5]`, complete 1 |
| 21 | segments of 30 cells, each 1, active | file | 30 scales, complete 30: nothing is cut |
| 22 | single, known `NaN`; known 1.7; known −0.5 (each cast) | file | scale 0, percent 0; scale 1, percent 100; scale 0, percent 0 |
| 23 | row 18 again | file | `rows[0].scales` is not the model's `cells` array (`not.toBe`); model and job equal a `structuredClone` taken before |
| 24 | media with `quality: null`; single known 0.25 active | — | bar `part`, `v` |
| 25 | single, known `Infinity`; known `-Infinity` (each cast) | file | scale 0, percent 0, each |
| 26 | segments `[Infinity, 1, -Infinity]`, active | file | scales `[0, 1, 0]`, complete 1 |
| 27 | segments `[1, 0]`, connections null, active | media (C2 row 33) | one map row; `laneTexts` gives the label `File` (4.3, D12) |

Property: over the eight states × `kind` × the three quality kinds × live (`undefined`, each role, a segments entry), with `v = laneView(laneModel(job, live), job)`:
- `v.rows.length` is 0 for `none`, 2 for `pair`, else 1;
- `v.motion` is `'zip'` exactly for `merge`, and `'sheen'` exactly for `segments` with tone `active`;
- every bar's `scale` lies in 0..1.

### 6.2 `kindIcon`

First match wins: `done` → `check`; `kind === 'file'` → `file`; `quality?.kind === 'audio'` → `music`; else `film`.

| Job | Expected |
|---|---|
| any kind, `done` | `check` |
| file, downloading; file, failed | `file`; `file` |
| media, quality best; quality `{ kind: 'max', height: 720 }`; `quality: null` | `film` each |
| media, quality audio mp3, downloading | `music` |
| media, quality audio mp3, `done` | `check` |
| media, skipped | `film` |

Every result is in `ICON_NAMES`. None is in `MIRRORED_ICONS`.

### 6.3 The flash rule

**[Q-C4-2/2]** Option recorded at freeze: **F-B**.

```ts
// src/renderer/src/model/laneView.ts
/**
 * How long after a finish that happened while the window was hidden the flash may still play, in ms.
 * The owner's value (Q-C4-2).
 */
export const FLASH_LATE_MS = ⟨N⟩;   // the owner's value, written here at freeze; this plan sets none
export type FlashStart = 'none' | 'play' | 'hold';
/** What a mounted row does when its job's state changes from prev to next. */
export function flashStart(prev: JobState, next: JobState, hidden: boolean): FlashStart;
/** True exactly when elapsedMs is not NaN and elapsedMs <= boundMs. The bound itself still plays. */
export function flashLate(elapsedMs: number, boundMs: number): boolean;
```

`flashStart`: `'none'` unless `prev !== 'done'` and `next === 'done'`. Then `'play'` when `hidden` is false and `'hold'` when it is true.

| `prev` → `next` | `hidden` | Expected |
|---|---|---|
| downloading → done; merging → done; paused → done; failed → done; queued → done | false | `'play'` each |
| the same five | true | `'hold'` each |
| done → done | false; true | `'none'`; `'none'` |
| done → failed; downloading → failed; queued → queued; downloading → skipped | false; true | `'none'` each |

`flashLate`, with `B = FLASH_LATE_MS` and also with the literal bound 1000:

| `elapsedMs`, `boundMs` | Expected |
|---|---|
| 0, B | true |
| B − 1, B | true |
| B, B | true (the boundary plays) |
| B + 1, B | false |
| `NaN`, B | false |
| `Infinity`, B | false |
| −5, B | true (a monotonic clock cannot give this; it is not rejected) |

Also: `FLASH_LATE_MS` is exactly `⟨N⟩`, a finite number greater than 0. A bound of 0 is not this option; it is option F-V, which the owner picks by name.

### 6.4 `listItems`

The rule of `JobList.tsx:24-39`, unchanged:
- Jobs are walked in `snapshot.jobs` order.
- A job with `groupId === null` gives a `job` item when `matchesFilter(job, filter)`.
- A playlist appears once, at its first member. `members` are all jobs with that `groupId`, in order; `visible` are the members that match the filter.
- No item when the playlist is missing from `snapshot.groups`, or when `visible` is empty.
- `snapshot.live` is not read. Nothing is changed. The `job` and `group` in an item are the snapshot's own objects.

Playlist `g1` and members as in C2 plan section 5.

| Snapshot (`jobs` order) | Filter | Expected |
|---|---|---|
| `[]` | all | `[]` |
| lone A queued, lone B done | all | `[job A, job B]` |
| the same | done | `[job B]` |
| m1 (g1) done, lone A downloading, m2 (g1) queued; groups `[g1]` | all | `[group g1 (members m1, m2; visible m1, m2), job A]` |
| the same | done | `[group g1 (members m1, m2; visible m1)]` |
| the same | paused | `[]` |
| the same members, groups `[]` | all | `[job A]` |
| m1 (g1), n1 (g2), m2 (g1), n2 (g2); groups `[g1, g2]` | all | `[group g1, group g2]`, each with its two members |
| m1, m2 both skipped; groups `[g1]` | failed | `[group g1 (visible m1, m2)]` |
| the fourth row plus `live: { [m1.id]: makeLive({ stream: 'video' }) }` | all | equal to the fourth row's result |
| the fourth row | all | `items[0].group` is `snapshot.groups[0]` and `items[1].job` is the snapshot's A (`toBe`); the snapshot equals a `structuredClone` taken before |

### 6.5 `laneTexts`

- Bar: `label` is `S.lanes[row.label]`. `value` is `` `${percent}%` `` when `percent` is not null, `'—'` (U+2014) for `unknown`, `''` for `empty`.
- Bar `aria`: `S.lanes.complete` for `full`. Otherwise the fill part and the tone word joined by `S.listSeparator`.
  - Fill part: `` `${percent}%` `` for `known`; `S.lanes.sizeUnknown` for `unknown`; `S.lanes.notStarted` for `empty`.
  - Tone word: `S.status.downloading` (active), `S.lanes.waiting`, `S.status.paused`, `S.status.failed`.
- Merge: `label` and `aria` are `S.lanes.merge` (two strands) or `S.lanes.finish`; `value` is `''`.
- Map: `label` is `S.lanes.connections(n)` when `connections` is not null, else `S.lanes.file`, whatever the job's kind (4.3). `value` is `` `${complete}/${scales.length}` ``. `aria` joins, by `S.listSeparator`: `S.lanes.parts(complete, scales.length)`, the connections text when not null, and the tone word.

| Row | EN `label`, `value`, `aria` | AR `label`, `value`, `aria` |
|---|---|---|
| bar video, active, known, 25 | `Video`, `25%`, `25%, downloading` | `فيديو`, `25%`, `25%، جارٍ التنزيل` |
| bar audio, waiting, empty | `Audio`, `''`, `not started, waiting` | `صوت`, `''`, `لم يبدأ، في الانتظار` |
| bar video, active, full, 100 | `Video`, `100%`, `complete` | `فيديو`, `100%`, `مكتمل` |
| bar file, active, unknown | `File`, `—`, `size not known, downloading` | `ملف`, `—`, `الحجم غير معروف، جارٍ التنزيل` |
| bar part, paused, known, 40 | `Current part`, `40%`, `40%, paused` | `الجزء الحالي`, `40%`, `40%، متوقف مؤقتًا` |
| bar file, failed, known, 25 | `File`, `25%`, `25%, failed` | `ملف`, `25%`, `25%، فشل` |
| bar part, failed, empty | `Current part`, `''`, `not started, failed` | `الجزء الحالي`, `''`, `لم يبدأ، فشل` |
| bar video, paused, full | `Video`, `100%`, `complete` | `فيديو`, `100%`, `مكتمل` |
| merge, 2 strands | `Merging`, `''`, `Merging` | `دمج`, `''`, `دمج` |
| merge, 1 strand | `Finishing`, `''`, `Finishing` | `إنهاء`, `''`, `إنهاء` |
| map, 4 cells, complete 2, connections 8, active | `Connections: 8`, `2/4`, `Parts complete: 2 of 4, Connections: 8, downloading` | `الاتصالات: 8`, `2/4`, `الأجزاء المكتملة: 2 من 4، الاتصالات: 8، جارٍ التنزيل` |
| map, 4 cells, complete 1, connections null, paused | `File`, `1/4`, `Parts complete: 1 of 4, paused` | `ملف`, `1/4`, `الأجزاء المكتملة: 1 من 4، متوقف مؤقتًا` |

No text holds an Eastern digit, in either language. The input is unchanged.

### 6.6 `groupStatusParts`

`` [`${view.percent}%`] ``, followed by `S.group.skipped(view.skipped)` when `view.skipped > 0`.

| `GroupView` (other fields as `groupView` gives them) | EN | AR |
|---|---|---|
| percent 67, skipped 1 | `['67%', '1 skipped']` | `['67%', 'تم تخطي 1']` |
| percent 0, skipped 2 (every member skipped) | `['0%', '2 skipped']` | `['0%', 'تم تخطي 2']` |
| percent 100, skipped 0 | `['100%']` | `['100%']` |
| percent 0, skipped 0 | `['0%']` | `['0%']` |

Tie to C2: `groupStatusParts(groupView([done, done, downloading, skipped]))` is `['67%', '1 skipped']`.

### 6.7 `dayStamp`

The local calendar day as `year × 10000 + (month + 1) × 100 + day`.

| Input | Expected |
|---|---|
| `new Date(2026, 10, 23, 23, 59, 59).getTime()` | 20261123 |
| `new Date(2026, 10, 24, 0, 0, 0).getTime()` | 20261124 |
| `new Date(2026, 0, 1, 12).getTime()` | 20260101 |
| two times on the same local day | equal |

This rejects nothing. It only decides when a row re-renders (section 13.3).

### 6.8 `sameRowProps`

True exactly when `a.today === b.today`, `a.onError === b.onError` and `sameRow(a.job, b.job, a.live, b.live)`.

| Case | Expected |
|---|---|
| `b` is `a` with `job` and `live` replaced by `structuredClone`s | true |
| `today` differs by 1 | false |
| `onError` is another function with the same body | false |
| `job.bytesDone` differs | false |
| `live` is an entry on one side and `undefined` on the other | false |
| `live.segments` `[1, 0]` against `[1, 0.5]` | false |

### 6.9 Text checks, width budget and contrast (`tests/renderer/rowSources.test.ts`)

Files are read as text, as C1's 7.2 does. CSS comments are removed first, and runs of whitespace are normalised to one space before matching. "The rule whose selector is X" means a rule whose whole selector text, after normalising, is X; when several rules share a selector, any of them may hold the declaration.

| File | Assertion |
|---|---|
| `components/JobRow.tsx` | Contains `className="job-main"`, `className="job-name"`, `className="job-status"`, `kindIcon(`, `laneModel(`, `laneView(`, `<Lanes`, `memo(` and `sameRowProps`. The first `<Icon` comes before the first `className="job-name"`. Between `className="job-name"` and the next `</span>` there is no `<Icon` and no `sr-only`. Contains no `className="bar"`. |
| `components/JobRow.tsx`, the flash **[Q-C4-2/3]** | Contains `flashStart(`, `flashLate(`, `FLASH_LATE_MS`, `isDocumentHidden(`, `visibilitychange` and `performance.now()`. |
| `components/GroupRow.tsx` | Contains `className="group"`, `className="group-head"`, `className="job-quality"`, `S.items(`, `groupView(`, `groupStatusParts(`, `aria-expanded`, `className="group-members"`, `role="progressbar"`. Contains no `groupSummary`, no `className="bar"`. Between `className="job-quality"` and the next `</span>` there is no `skipped`. |
| `components/JobList.tsx` | C3's assertions hold (C3 plan 6.8). Also contains `listItems(`, `dayStamp(` and `snapshot.live`. Contains no `c.status` and no `S.columns.status`. |
| `components/Lanes.tsx` | Contains `role="progressbar"`, `role="img"`, `aria-valuetext`, `laneTexts(`, `lane-zip`, `segs-sheen`. Contains no `job-main`, no `<button` and no `tabIndex`. |
| `components/*.tsx` | The text `.live` appears only in `JobList.tsx` and `GroupRow.tsx` (D10). |
| `model/laneView.ts` | Contains no `../strings`, no `../format`, no `document` and no `performance`. |
| `styles.css`, structure | Contains `content-visibility: auto`, `contain-intrinsic-size: auto var(--row-h)`, `position: sticky`, `(max-width: 1039px)`, `(max-width: 929px)`, `(max-width: 735px)`, `(max-width: 800px)`, `--name-min: 98px`, `minmax(var(--name-min, 120px), 1fr)` and `outline-offset: -2px`. The rule whose selector is `.job` holds `content-visibility`; no rule whose selector contains `.group` holds it. |
| `styles.css`, stacking (PC-2) | The rule whose selector is `.jobs` holds `isolation: isolate`. `isolation` appears exactly once in the file. No rule whose selector contains `.backdrop` or `.dialog` holds `z-index`. |
| `styles.css`, focus under the head (PC-2) | The rule whose selector is `.group-members button` holds `scroll-margin-block-start: calc(var(--head-h) + 8px)`. The file contains `--head-h: 76px` and `--head-h: 80px`. It contains no `scroll-padding`. |
| `styles.css`, row height | The rule whose selector is `.job-actions button` holds `line-height: 20px` and `min-height: 28px`. The file contains `--row-h: 108px` and `--row-h: 116px`. |
| `styles.css`, merge marker | The rule whose selector is `.lane-zip::before` holds `background: var(--surface)` and `var(--ink)`. |
| `styles.css`, removed | No match of `/\.bar\b/`, `(max-width: 1095px)`, `(max-width: 985px)`, `(max-width: 1117px)`, `minmax(76px, 2fr)`, `2fr`. |
| `styles.css`, motion | Exactly one `prefers-reduced-motion`. Exactly one `animation-play-state` (C3's rule). The `@keyframes` names are exactly `lane-zip`, `lane-zip-rtl`, `lane-sheen`, `lane-sheen-rtl`, `job-flash`. Every declaration inside a `@keyframes` block is `transform` or `opacity`. Every `transition:` value, after a trailing `!important` is removed, names `transform` or `none` only (C1's reduced-motion block uses `none !important`). |
| `styles.css`, direction | C3's two patterns still find nothing: `/\b(left|right)\s*:/` and `/(margin|padding|border)-(left|right)/`. |
| `styles.css`, the 735px block **[Q-C4-1/2]** | Inside the `(max-width: 735px)` block: the areas line `'. status status status speed'`; the rule whose selector is `.jobs-head .job-speed` holds `display: none`; no other rule in the block hides `.job-speed`. |

Width budget. The templates read are the `grid-template-columns` values of the rule whose selector is `.jobs-head, .job-main, .group-head`, in the base rules and inside each query. No other rule's template is read (`.lane` and the app frame have their own).

`need(template, nameMin = 120)` sums a template: an `Npx` token counts N, `minmax(var(--name-min, 120px), 1fr)` counts `nameMin`, `auto` counts 156; add 10 per gap and 22.

| Template | `need` | Budget |
|---|---|---|
| base | 840 | `840 + 191 ≤ 1040 − 9` |
| inside `(max-width: 1039px)` | 730 | `730 + 191 ≤ 930 − 9` |
| inside `(max-width: 929px)` | 640 | `640 + 191 ≤ 900 − 9`, `640 + 99 ≤ 801 − 9`, `640 + 87 ≤ 736 − 9` |
| the minimum **[Q-C4-1/3]** | `need` of the template inside `(max-width: 735px)` is 554 | `554 + 87 ≤ 706 − 9` |

Contrast, with C1's `contrast` and `PALETTE`, both modes, each `≥ 3`:

| Pair | Where | Hand value, light, dark |
|---|---|---|
| `muted` on `track` | waiting fill, paused hatch | about 4.92, 5.20 |
| `bad` on `track` | failed fill | about 5.26, 5.30 |
| `field` on `tint` | outline buttons on the playlist head | 3.21, 3.14 (C1 plan 7.2, measured, not asserted there) |
| `laneV` on `tint` | the playlist lane's fill beside the head | same hue as `accent`: 6.84, 6.39 |

If a pair computes under 3, the tests lane stops and reports; no lane adjusts a token.

Checked by eye, not by a test: the layout at every width, RTL mirroring, the hatch and dash patterns, the marker and sheen, the sticky head, dialogs over the head, focus under the head, row heights, the focus ring.

## 7. Accessibility

- Meaning in text (D1): every row keeps its status words from `statusParts`, on line two. Each lane also says what it is and how far it is:
  - a bar is a `progressbar` named by its label ("Video", "Audio", "File", "Current part"), with `aria-valuenow` and an `aria-valuetext` such as "25%, downloading" or "not started, waiting";
  - an unknown-size bar has no `aria-valuenow` (indeterminate) and says "size not known, downloading";
  - a merge lane is an indeterminate `progressbar` named "Merging" or "Finishing";
  - the segment map is one `img` named, for example, "Parts complete: 13 of 24, Connections: 8, downloading";
  - the playlist lane is a `progressbar` named "Finished items", valued by the percent, with the text "2 of 3".
- The visible lane label and value are `aria-hidden`, so nothing is read twice. Colour, hatch, dashes and motion only repeat what the text says.
- No lane is a live region. Values change up to four times a second.
- Action names, unchanged:
  - row: Open (`S.openFile`), Open folder (`S.openFolder`), Pause, Resume, Cancel, Retry, Remove from list, Delete file (`S.verbs`, `strings.ts:23-33`);
  - head: Pause all, Resume all, Cancel all (`S.groupVerbs`, `strings.ts:31`), or Remove from list when nothing is unfinished;
  - collapse: named by the playlist title, with `aria-expanded` and `aria-controls` (`GroupRow.tsx:34`).
- Every icon is `aria-hidden` (C1's `Icon`); icon buttons keep `aria-label` and `title`.
- Focus order follows the DOM. In a lone row: Open (when done), Open folder, then the verbs. In a playlist: the collapse button, Pause all or Resume all, Cancel all, then each member's buttons. Lanes, headings and the bracket are not focusable.
- The focus ring is C1's (`2px solid var(--accent)`), drawn 2px inside each control, so the row's clip never cuts it.
- **Focus is never left under the stuck head.** The browser does not scroll a focused button that the sticky head covers (PC-2: no scroll at all after Shift+Tab or `focus()`), which would hide the focus indicator (WCAG 2.4.11). Every button in a playlist body therefore has `scroll-margin-block-start` of the head's height plus 8px, and PC-2 showed that brings it clear for keyboard and programmatic focus. Manual check 15 verifies it in the app.
- **Dialogs are never covered by the head.** The list is its own stacking context, so the Settings and Add dialogs and their backdrop receive every click over a stuck head (PC-2). Manual check 14 verifies it.
- The column headings stay `aria-hidden`, as today (`JobList.tsx:46`).
- Numbers, percents, `2 / 3` and `13/24` sit in `<bdi dir="ltr">`; titles use `dir="auto"` (D3).

Contrast, from C1's tested figures (C1 plan 7.2):

| Pair | Where | Light | Dark | Needs |
|---|---|---|---|---|
| `ink` on `surface` | names, the size's done figure, the merge marker's edge | 16.50 | 13.61 | 4.5 |
| `muted` on `surface` | status, metrics, lane labels and values, kind icon | 6.11 | 6.48 | 4.5 |
| `ok` on `surface` | "done" status, the check icon | 5.80 | 7.95 | 4.5 |
| `bad` on `surface` | "failed" status | 6.54 | 6.60 | 4.5 |
| `laneV` on `track` | video lane, file lane, map cells | 6.16 | 5.62 | 3 |
| `laneV` on `surface` | the same beside the row ground; the merge marker's body on the video strand | 7.65 | 7.00 | 3 |
| `laneA` on `track` | audio lane | 4.20 | 6.19 | 3 |
| `laneA` on `surface` | the same beside the row ground; the merge marker's body on the audio strand | 5.22 | 7.71 | 3 |
| `field` on `surface` | empty-lane outline, button outlines | 3.59 | 3.44 | 3 |
| `accent` on `surface` | bracket line, focus ring | 7.65 | 7.00 | 3 |
| `ink` on `tint` | playlist head text | 14.76 | 12.43 | 4.5 |
| `muted` on `tint` | playlist head status and metrics | 5.46 | 5.92 | 4.5 |
| `accent` on `tint` | focus ring on the head | 6.84 | 6.39 | 3 |
| `muted`, `bad` on `track`; `field`, `laneV` on `tint` | 6.9's new assertions | see 6.9 | see 6.9 | 3 |

- The merge marker reaches 3:1 against everything it crosses: its `surface` body against both strands, and its `ink` edge against the row ground. r1's solid `ink` marker did not (about 1.77 to 3.16 against the strands).
- `--line` is decoration only: row and playlist borders, the member separators.

## 8. Performance with 10+ active and 50+ listed

- Memoisation: `JobRow` is `memo` with `sameRowProps`. Each snapshot is a fresh clone (IPC), and `sameRow` compares by value, so only rows whose job or live entry changed re-render: about the active ones, at most four times a second (architecture section 2).
- D10's lookup: `snapshot.live?.[job.id]` is one property read per row. C7 sends a fresh copy of each entry per snapshot (L7); value comparison absorbs that.
- `JobList` does one pass (`listItems`). `GroupRow` re-renders per snapshot, but its head is a few text nodes and one `groupView` pass; its member rows are memoised.
- `content-visibility: auto` skips style, layout and paint for rows away from the viewport. PC-1 saw 80 of 96 rows skipped on load. Animation timelines in skipped rows still advance (PC-2); nothing is painted for them.
- Rows are contained and clipped, their metric columns are fixed and tabular, and the lanes block has a fixed height. A changing number moves nothing outside its cell, and a job that finishes does not change its row's height.
- Every animation and transition is `transform` or `opacity`, so none causes layout. There are at most 10 perpetual animations with 10 active rows, and none while the document is hidden.
- Segment maps are the heaviest case: up to 24 cells per row, each with a `transform` transition restarted every 250ms, so up to 240 running transitions with 10 active file rows. This cannot be seen before C7. Manual check 8 names it, and remedy 8 (drop the cell transition) is permitted.
- `React` re-uses the fill elements; a value change writes one custom property.
- Not measured by any probe: smoothness and CPU with 50+ live rows (PC-1 point 4). Manual check 8 decides.

## 9. Superseded tests, gates and e2e

Superseded:

| File and line | Why | New expectation |
|---|---|---|
| `tests/renderer/columns.test.ts:82` | `columns.status` is removed (DV-2) | `['name', 'quality', 'size', 'speed', 'timeLeft', 'added']`. Lines 83-86 pass unchanged |
| `tests/renderer/shellSources.test.ts`, the `styles.css` row (C3's; not in this worktree, so no line number; C3 plan 6.8) | C4 replaces the interim grid | Remove the expectations of `minmax(var(--name-min, 120px), 2fr)`, `minmax(76px, 2fr)`, `(max-width: 1095px)` and `(max-width: 985px)`, and any expectation a tests lane added for a C3 remedy rule that landed (a `(max-width: 1117px)` query, or lowered name minimums inside the 800px query). Keep `--name-min: 98px`, `(max-width: 800px)`, the "no `(max-width: 1000px)`, `(max-width: 880px)`, `minmax(120px, 2fr)`, `minmax(100px, 2fr)`" checks, and everything about the rail, `data-hidden` and direction. The tests lane finds the lines and reports them |

Checked and not broken:
- `tests/renderer/strings.test.ts`: key parity, non-empty leaves, translation, no تحميل and Western digits hold for the new leaves and the removed one (4.5). No line changes.
- `tests/renderer/format.test.ts`, `size.test.ts`, `status.test.ts`: `format.ts` is not edited. `groupSummary` stays (`format.test.ts:163-178`); `groupView` still calls it.
- C2's tests (`lanes`, `listModels`, `rowEqual`): no C2 function changes.
- C1's `palette.test.ts`: no `#hex`, no palette name declared again, the palette blocks untouched. C1's `icons.test.ts`: no glyph is added; `—` (U+2014) is not on its list.
- The other rows of C3's `shellSources.test.ts`: `JobList`'s props, `<h2>{S.emptyTitle}</h2>`, `ShowAllContext` and `S.showAll` all stay. `App.tsx` is not edited, so its `visibilitychange` row holds.
- No test names `JobRow`, `GroupRow`, `.bar` or `job-main` (searched `tests/`).

History superseded, not edited: architecture choice R7 ("the column headings stay") in one part, the Status heading (DV-2).

Checks that earlier plans deferred to C4:

| Deferred by | What | Where in this plan |
|---|---|---|
| C1 Q7 | Whether the row icons (stroke 2.5 on a 24 box, at 16px) look heavy beside 15px Arabic text | Manual check 16 |
| C3 DV-7 | The exact pause rule, seen on a running animation | Manual check 9 |
| C3 Q15 | The third column drop | Q-C4-1, 5.5 |

e2e hooks, checked against architecture section 8. No `e2e/real` file is edited:

| Hook | Used at | After C4 |
|---|---|---|
| `li.job`; its text holds the state word | `lib.mjs:390`, `checks.mjs:1252` | Kept. The status span is inside `li.job`. No lane text contains "skipped", and a skipped row has no lanes |
| `.job-name` whose text is exactly the shown name | `lib.mjs:390` | Kept. The kind icon is a sibling `svg`; nothing else is inside |
| `.job-main > span:not(.job-actions)` holding the quality and the status word | `checks.mjs:323, 337` | Kept. Both are still direct `span` children; the lanes are outside `.job-main` |
| `li.group .group-head .job-quality` | `checks.mjs:845, 862` | Kept, with exactly `n / total` |
| Button names on rows: Open, Open folder, Delete file, Pause, Resume, Cancel, Retry | `lib.mjs:402-405`, `checks.mjs:202, 387-391, 442, 480-483, 785-791, 976, 1014-1018` | Unchanged names; the lookup is `exact: true` |
| `clickButton(dialog, 'Close')` with a playlist listed | the dialog checks | Kept working by `.jobs { isolation: isolate }`: without it a stuck head over the button would take the click (PC-2) |

- e2e runs at the start size, a 1106px viewport, where every column shows.
- Rows skipped by `content-visibility` stay in the DOM and the accessibility tree, and e2e lists are short. If a locator still fails on a row, remedy 3 applies.

Gates, run by the orchestrator, serially, from the worktree root (`package.json:14-18`):

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

C4's extra checks (Git Bash). Each prints nothing unless it says otherwise:

```bash
# the old bar is gone
grep -rn 'className="bar"' src/renderer/src
grep -nE '\.bar\b' src/renderer/src/styles.css
# C3's interim thresholds and remedy query are gone
grep -nE '\(max-width: (1095|985|1117)px\)' src/renderer/src/styles.css
# D10: only the list and the playlist look a live entry up (prints lines of JobList.tsx and GroupRow.tsx only)
grep -rnE '\.live\b' src/renderer/src/components
# C2's rule still holds: models import no text
grep -rnE "from '\.\./(strings|format)'" src/renderer/src/model
# no literal colour in the new or changed components
grep -nE '#[0-9a-fA-F]{6}\b|rgb\(|hsl\(' src/renderer/src/components/Lanes.tsx src/renderer/src/components/JobRow.tsx src/renderer/src/components/GroupRow.tsx
# prints 1: still one reduced-motion block
grep -c 'prefers-reduced-motion' src/renderer/src/styles.css
# prints 1: C4 added no pause rule
grep -c 'animation-play-state' src/renderer/src/styles.css
# prints 1 each: the list's stacking context and the focus margin
grep -c 'isolation: isolate' src/renderer/src/styles.css
grep -c 'scroll-margin-block-start' src/renderer/src/styles.css
```

Then `npm run e2e:real`, alone and serially (architecture section 6). A red run on a loaded machine is re-run alone before it counts. The checks that exercise rows: 3 (the row text, `checks.mjs:322-337`), the playlist counter (836-862), pause, resume and cancel (387-460), Open, Open folder and Delete file (480-483, 976, 1014-1018), the skipped rows (1250-1253, 1354, 1386).

Riskiest new code for the orchestrator's adversarial read before review: `laneView` (non-finite before clamp, the one-motion rule), `sameRowProps` (a wrong "true" leaves a stale row), `listItems` (it must match today's rule), the flash handling in `JobRow` (the listener's removal, the clock), the grid templates, and the three stacking and scrolling declarations (`isolation`, `z-index`, `scroll-margin-block-start`).

## 10. D8 and manual checks for C4

After C4 alone the app is usable: every control that existed is still there under the same name, every state is readable, dialogs open over the list and take their clicks, and every gate is green. Until C7 every row shows one lane, or the merge lane.

Manual checks on the built app (`npm run build`, then `npm start`), in English and Arabic, light and dark. Widths are viewport px, set as C3's section 10 describes.

1. (9.1) Arabic: lanes fill from the right, the bracket is on the right, the collapsed arrow points left, map cells run from the right. English mirrors. Sizes, speeds, percents, `2 / 3` and times read left to right in both.
2. (9.5) Each state on a real job: queued, starting, downloading with a known size, downloading with an unknown size (dashed lane, `—`, no percent, empty time left), `~` on a video's size, finishing (the marker runs, and reads on both strand colours), paused with its percent (hatch), done (check icon, Open, Open folder, double-click), failed with its reason (red lane), skipped, retrying 2/3, cannot resume (downloading and paused), cut off.
3. (9.6, the part before C7) A video, an audio-only download and a file each show one lane with the right label ("Current part", "Audio", "File"). A merge shows "Merging"; an audio-only finish shows "Finishing".
4. Row height: within one language, rows of every state have the same height, a done row included (its "Open" or "فتح" button is 28px tall, like the icon buttons), and a row does not change height when it finishes. Report the outer heights of a lone row, a member row and a playlist head in English and Arabic. Expected: 110, 109, 76 and 118, 117, 80. A difference triggers remedy 2, 6 or 7.
5. Playlist: the head shows the title, `n / total`, the percent, "1 skipped" when an item is skipped, the combined speed, and Pause all, Resume all, Cancel all. Collapse hides the members. While scrolling inside a playlist of 20+ the head stays at the top of the list and members pass under it; the bracket binds the members; past the playlist's end the head scrolls away.
6. Row fit, with a lone download and a playlist of 50+ so the list scrolls. At each viewport no row, member or head is clipped at its end edge, and every action button is whole:

   | Viewport | Line one shows |
   |---|---|
   | 1106 (start size), 1040 | all columns, on lone rows, members and the head |
   | 1039, 930 | no "added" |
   | 929, 900, 899, 801, 800, 736 | no "added", no "time left" |
   | 735, 706 (minimum) **[Q-C4-1/4]** | kind, name, quality, size, actions. The speed shows at the end of line two, under the actions, on rows, members and the head. There is no Speed heading |

   Report the spare seen at 1106, 736 and 706. A clipped row triggers the remedies of 5.6 and nothing else.
7. (9.10) Very long Arabic and English titles, in a lone row, a member and a head: one line, cut at the reading end, full title in the tooltip. A three-part status ("paused 25% · waiting for a check · cannot resume") fits line two at 1106 and is cut with an ellipsis, with its tooltip, at 706.
8. (9.8) 10 active and 50+ listed: smooth scrolling, no jump of the scrollbar while scrolling and no visible change of its length after the first pass over the list, no shift when numbers change, the focus ring whole on every row, CPU near idle while the window is hidden. After C7, repeat with 10 active file downloads showing segment maps; stutter there triggers remedy 8.
9. Pause while hidden (C3 DV-7). With DevTools in a separate window, run `setInterval(() => console.log(document.getAnimations().map((a) => [a.playState, Math.round(a.currentTime)])), 1000)`.
   - While a real video is merging, or after adding a marker to a paused row with `document.querySelector('.lane-track').insertAdjacentHTML('beforeend', '<i class="lane-zip"></i>')`, the log shows a running animation whose time advances.
   - Minimise the window, close it to the tray, and cover it fully with another app: in each case the state reads `paused` and the time stops. It runs again when the window is back.
   - If it keeps running in any case, stop and report.
10. (9.4) Windows "Animation effects" off: the marker rests mid-track, fills jump, no flash; every state is still readable.
11. (9.11, part) Keyboard only: Tab reaches the collapse button and every row and head button, in order; the ring is always visible; Enter and Space work on each.
12. The flash **[Q-C4-2/4]**:
    - A download finishing while its row is on screen and the window is visible: one short flash, then the done look.
    - A row that is already done when the window opens does not flash.
    - A download finishing while its row is scrolled out of view: scrolling to it afterwards shows no flash.
    - Minimise the window, let a download finish, and restore the window within `FLASH_LATE_MS`: the row flashes once on return.
    - The same, restoring after more than `FLASH_LATE_MS`: no flash; the row shows the done look.
    - Repeat the last two with the window closed to the tray and with it fully covered by another app.
13. Filters: a playlist with no member matching the filter is hidden; with some matching, only those show under its head.
14. Dialogs over a stuck head (PC-2), in English and Arabic. Scroll inside a playlist of 20+ so its head is stuck, then open Settings, and separately the Add dialog:
    - the dialog and its backdrop cover the head and the bracket completely; no part of the head shows through or above them;
    - every control of the dialog that lies over the head's position works by mouse, Close included;
    - a click on the backdrop over the head's position does what a backdrop click does elsewhere, and never presses a head button;
    - after closing, the head is still stuck and its buttons work.
15. Focus under the stuck head (PC-2), in English and Arabic. In a playlist of 20+, scroll until a member row lies under the stuck head and the next member is just below it:
    - focus a button of the lower member, then press Shift+Tab until focus moves into the covered row: the list scrolls so the focused button and its whole ring are visible below the head, with a small gap;
    - Tab forward through the playlist to its end and Shift+Tab back to its start: the focused button is never under the head;
    - in DevTools, call `focus()` on a button of a row that lies under the head (pick it with `document.querySelectorAll('.group-members button')`): the list scrolls it clear;
    - the jump is small (about one row), not half a screen;
    - repeat once after scrolling far down and back, so the target row has been skipped by `content-visibility`.
16. Icon weight (C1 Q7): in Arabic, at the start size, the kind icons and the action icons do not look heavier than the 15px text beside them, in light and dark. If they do, report it; the stroke is C1's, and C4 changes no icon.
17. `npm run e2e:real` passes.

After C7, the orchestrator re-runs checks 1, 3 and 8 for the pair and the segment map (architecture 9.6, 9.7); that belongs to C7's plan.

## 11. Edge cases

| Case | Behaviour |
|---|---|
| Unknown size | Lane `unknown`: static dashes, value `—`, no `aria-valuenow`, "size not known". Status says "downloading"; the size cell shows only the done figure; time left is empty |
| Approximate totals | `~` before a media total, from `sizeParts.approx` (`JobRow.tsx:29`), unchanged |
| No separate audio stream | `laneModel` gives `single`; label "Current part". No merge lane unless the job enters `merging` |
| Audio only | One lane in the audio colour, labelled "Audio"; the merge lane has one strand, labelled "Finishing" |
| Merge fails | The job is failed with its reason on line two. The lanes are whatever `laneModel` returns for it: the pair in the failed tone if the entry was kept, else one lane |
| A media job whose entry holds segments (C2 row 33) | The map, labelled "File" or "Connections: n" (4.3, D12) |
| Playlist with skipped members | Skipped rows show "skipped: reason" and an empty lanes block. The head counts without them and adds "1 skipped". All skipped: `0 / 0`, `0% · 2 skipped`, no Pause all or Resume all |
| Filter hides every member | The playlist is not listed (`listItems`) |
| A playlist missing from `groups` | Its members are not listed, as today (`JobList.tsx:37`) |
| 50+ jobs | Section 8 |
| Very long titles | One line, ellipsis at the reading end, `title` tooltip; the name column never pushes the fixed columns |
| Missing live data (`live` absent, no entry, all-null entry) | One lane; nothing is shown as missing (L10) |
| Live data arrives late | The next snapshot re-renders the row: one lane becomes two, the label changes from "Current part" to "Video" and "Audio". The row's height does not change |
| Live entry removed mid-run (L2, L6) | The row falls back to one lane on that snapshot |
| A role the UI does not know, more than 24 cells, cells outside 0..1 | `laneModel` falls back to one lane for an unknown role. Every cell given is drawn; values are clamped for drawing only |
| Fraction above 1 or below 0 | Clamped by C2; `known 1` shows `100%` |
| A non-finite fraction or cell, `+Infinity` included | Drawn as 0 |
| Reduced motion | 4.7 |
| Window hidden | No animation runs (C3's rule, verified in check 9) |
| 706px | Section 5.5 |
| Between two whole pixels (150% scaling) | The wider range's rule applies; half a pixel less spare |
| A job finishes while its row is off-screen and the window is visible | The overlay's animation finishes unseen (PC-2). Scrolling the row in later shows the done look and no flash |
| A job finishes while the window is hidden **[Q-C4-2/5]** | The row holds the flash. If the window is shown again within `FLASH_LATE_MS` of the finish, the flash plays once, in full; at exactly the bound it still plays. After the bound it does not play |
| Several jobs finish while the window is hidden | Each row decides for itself by the rule above; those that play, play together on return |
| A held flash and the row unmounts (filter, collapse, language) | The hold is dropped with the row; no flash later |
| Row remounted (filter change, language change, collapse) | No flash; the collapse state and the flash are local and reset |
| A job becomes done twice while its row stays mounted | Not reachable today: a done job has no verb that restarts it. If it happened, the row would flash once |
| Midnight passes | The first snapshot of the new day re-renders every row once, so "09:05" becomes "23 Nov" |
| Stalled download (speed 0) | The row's speed cell is empty, as today (`format.ts:48-50`), while the strip shows `0 B/s` (C3 Q2, the owner's) |
| Paused and cannot resume | "paused 25% · cannot resume" on line two, beside an enabled Resume (C2 OD-5, the owner's) |
| Head stuck over a focused member button | The browser alone would leave it hidden (PC-2). The scroll margin on member buttons brings it 8px clear of the head on keyboard and programmatic focus (check 15) |
| A member button near the top of the list while its head has already scrolled away (the playlist's last rows) | The margin still applies, so focus may scroll the list by up to 84px (Arabic 88px) though nothing covered the button. Accepted: a small, harmless jump |
| A mouse click on a button under the head | Not possible: the head covers it and takes the click |
| A dialog open over a stuck head | The dialog and backdrop paint over the head and take every click (check 14) |
| A playlist of one member | Head plus one member; the bracket is a short mark |
| Collapsed playlist | Head only, with all four corners rounded |

## 12. Boundary check

### With C2 (previous): every value consumed

| Value | Meaning in C2 | C4's reading |
|---|---|---|
| `laneModel(job, live)` | The lane form for one row; `live` passed on unchanged | The only reader of a live entry. `JobRow` calls it and hands the result to `laneView` |
| `Fill` `known` | `fraction` in 0..1, the current stream's share | `scaleX(fraction)`; percent `floor(fraction × 100)`, the same number the status shows |
| `Fill` `full` | An earlier stream that is complete | Full lane, `100%`, "complete" |
| `Fill` `unknown` | Running with no known size | Static dashed track, `—`, indeterminate |
| `Fill` `empty` | Nothing to show yet | `--field` outline, no fill, "not started" |
| `Tone` | The job's; the idle audio lane of a running pair is `waiting` | Colour or hatch only (4.3). It never drives motion on a bar |
| `merge.strands` | 2 for a video job, 1 for audio-only or file | Two half fills or one; label "Merging" or "Finishing" |
| `segments.cells` | The stored array, unchanged, not validated | Drawn cell for cell; clamped copies for drawing; the array is not mutated |
| `segments.connections` | The count while downloading, else null | Null means the label is "File" and no count is shown |
| `segments` on a media job (row 33, provisional) | Rule 3 before rule 4: the map wins | Drawn as any map; the label does not depend on `job.kind` (D12) |
| `groupView(members)` | `done`, `total`, `percent` as `groupSummary`; `skipped`; `speed` over downloading members; three flags | The head. `percent` is the share of finished items. `canResume` is true for a cut-off member too, as today |
| `sameRow(a, b, liveA, liveB)` | Value equality of two jobs and two entries; callbacks not compared | Inside `sameRowProps`, which also compares `onError` and `today` |
| `statusParts(job)` | Up to three parts for a paused job | Line two, with the full text in the tooltip |
| `streamFraction` | The current stream's share | Not called by C4; `laneModel` already used it |

C4 changes no C2 file and gives no C2 value another meaning.

### With C1

- `Icon`: one `svg`, no wrapper. C4 places it in the grid itself, in the `kind` area (C1 plan section 9).
- `MIRRORED_ICONS`: `chevronEnd` flips itself; C4 does not flip the twisty. `film`, `music`, `file` and `check` do not mirror.
- `.icon-btn` and `.job-actions .icon-btn`: unchanged, 30px wide and at least 28px tall. C4 adds `line-height` and `min-height` to `.job-actions button` so text buttons match that height; an icon button's size does not change.
- The focus ring: only its offset changes, as C1's boundary row allows.
- Tokens only. Lanes sit on `--track` inside a `--surface` row, the tested ground (C1 plan section 9). The playlist lane sits on `--track` inside a `--tint` head; 6.9 adds its pair. The merge marker uses `--surface` and `--ink`, both tested pairs.
- Weights 400, 500, 600 only; no italic.
- C1 Q7's deferred eye check is manual check 16.

### With C3 (shell)

| Shell fact | C4 |
|---|---|
| `JobList` props `{ snapshot, filter, onError }` | Unchanged |
| `ShowAllContext` and the two empty states live in `JobList.tsx` (C3 DV-6) | Both kept; `.empty h2` kept |
| `main` is the only scroll container | The head sticks to it with `top: 0`. Focus scrolling happens in it; the scroll margin is on the buttons, so `main` gets no `scroll-padding` |
| `.backdrop` is `position: fixed` with no `z-index` (C3 plan line 116) | Not edited. The list is isolated instead, so the backdrop paints over it |
| Rail 148px, or 56px below 900px; `main` padding 28px, or 16px at or below 800px; 15px scrollbar | The inputs of section 5 |
| C3's interim templates, the 98px and 76px minimums, the queries at 1095, 985 and 800, and any remedy rule that landed | Replaced: one grid; 120, 98 and 120; queries at 1039, 929 and 735. `--name-min` and the member's 98px stay. C3's 800px `main` padding stays; its speed drop there goes |
| C3 DV-2, the interim speed drop, and Q15, "to be answered before C4's plan is frozen" | Not inherited. Answered by the owner at freeze and recorded in 5.5 and DV-9 |
| C3 DV-10, the head's 76px name minimum | Gone: the head needs what a lone row needs. (`--head-h: 76px` is the head's height, a different value) |
| `html[data-hidden]` pauses every animation (C3 DV-7) | C4 adds no pause rule and verifies C3's by eye (check 9). PC-2 saw the exact rule pause a one-shot animation |
| `isDocumentHidden(visibilityState)`: true exactly for `'hidden'` (C3 6.6) | `JobRow` uses it for the flash, with the same meaning. `data-hidden` is set from the same function, so the flash rule and the pause rule agree on "hidden" |
| `.sr-only` exists | Not needed by C4 |
| `ghost` names the empty-state lanes | C4's classes are `lanes`, `lane`, `lane-*`, `segs`, `seg` |
| `onError` is `setMessage`, stable | Still compared by identity in `sameRowProps` |
| A fits-706 requirement, members and heads included | Met by the variant recorded in 5.5, with the arithmetic there |

### With C5

- C4 exports nothing C5 must use (architecture: "Out: none").
- C5's install rows may reuse `.lane-track` and `.lane-fill` with `--f`. That is a convenience, not a contract.
- **The list is its own stacking context.** `.jobs { isolation: isolate }` keeps the head's `z-index: 2` and the bracket's `z-index: 1` inside the list. They mean "above the member rows" and nothing else.
  - Seen from outside, the whole list paints as one layer at the level of `z-index: 0`, in DOM order.
  - A fixed or positioned layer that comes after the list in the DOM (today's `.backdrop`; C5's scrim, drawer and sheet if placed like it) paints over rows and heads with no `z-index` of its own. PC-2 confirmed this for the backdrop.
  - A layer placed before the list in the DOM needs a positive `z-index` to cover it. That is C5's to state if it does so.
- C5 must not remove the `isolation` declaration; 6.9 asserts it.

### With C6

- Rows show no thumbnail and no toast.
- C6's toasts are outside the list. By the stacking rule above they paint over rows and stuck heads when they come after the list in the DOM, or with a positive `z-index`.
- The row flash and C6's toast are two separate notices of a finish. They share no value: the flash is local to a mounted row, and it also plays for each playlist member.
- "Hidden" has one meaning for both: C6's "visible" is `!isDocumentHidden(document.visibilityState)` (C3 plan line 1106), the same function the flash rule uses.
- C6 does not change `JobList`'s props.

### With C7

- 5.1 is provisional on PL-1 and PL-2. C4 draws exactly what `laneModel` returns and reads no field of an entry.
- An amendment that changes only `laneModel`'s rules needs no C4 change.
- An amendment that adds a form or a field to `LaneModel` fails the typecheck in `laneView`'s switch; C7's plan then updates `laneView`, `Lanes` and their tests.
- The pair, the segment map and the sheen are first seen on real jobs after C7; C7's manual checks cover them (architecture 9.6, 9.7), and the segment-map part of check 8 with remedy 8.
- C2's Q7 (how long the connection count stays) is settled before C7's plan freezes. C4 shows the count when it is not null and nothing otherwise, whatever the answer.

## 13. Decisions, deviations and open questions

### 13.1 Deviations recorded at freeze

No frozen plan is edited. Each is recorded here and may be overturned by the owner.

| # | Deviation | From |
|---|---|---|
| DV-1 | Files outside the architecture's C4 list: `model/laneView.ts`, `rows.ts`, three test files, and edits to `columns.test.ts` and C3's `shellSources.test.ts` | The architecture's C4 file list (its line 295). D6 asks for pure logic outside components |
| DV-2 | The status is always on line two, the Status heading is not drawn, and `columns.status` is removed | Architecture R7, "the column headings stay", for that one heading. The architecture allows the second line (its C4 section). Shown to the owner at the commit (13.4) |
| DV-3 | The merge marker loops | The mockup's one-shot marker |
| DV-4 | The lane's end figure is the percent | The mockup's per-stream size, which no contract carries |
| DV-5 | A plain lane has no sheen; only the segment map and the merge lane move | The mockup has none on plain lanes either; stated because D4 would allow one |
| DV-6 | The head keeps one progress lane | Nothing; it is today's playlist bar, not the excluded mini bars |
| DV-7 | `JobRow` gains `live` and `today`; `GroupRow` gains `live` and `today` | Nothing; `JobList`'s props are the frozen boundary and do not change |
| DV-8 | The head's background is `--tint` | Nothing; taken from the Loom bracket (`fetchly-ui-directions.html:428`) |
| DV-9 **[Q-C4-1/5]** | V-M, chosen by the owner: below a 736px viewport the speed cell moves to the end of line two and the Speed heading is hidden, although its cell stays. No third column is dropped | Architecture C4, headings "drop with their columns" (its line 301) |
| DV-10 | The merge marker is `--surface` with an `--ink` edge | The mockup's solid marker; changed to reach 3:1 on both strands (critique N-7) |
| DV-11 | `.jobs` is an isolated stacking context, and member buttons carry a scroll margin | Nothing; added after PC-2 so the sticky head neither covers dialogs nor hides focus |

### 13.2 Questions for the owner, answered at freeze

Both are filled in with the plan lane's recommendation and tagged. The owner's answer replaces the tagged text by Appendix A or B.

**Q-C4-1: the rule from a 706px to a 735px viewport.** The four options, their arithmetic and what each costs are in 5.5.

| Option | In one line |
|---|---|
| V-M | The speed moves to line two; its heading goes. Nothing is hidden; deviates on the heading |
| V-S | The row's speed is hidden; deviates with a third drop |
| V-A | Nothing moves; names shrink to 99 / 77 / 99px with no slack; conforms fully |
| V-Q | The quality is hidden on rows; head and rows stop lining up; deviates with a third drop |

Filled in: V-M (the plan lane's recommendation; reasons in 5.5).

**Q-C4-2: a download that finishes while the window is hidden.** PC-2 found that a flash started in a hidden window waits at its first frame and plays in full when the window is shown, however long ago the job finished. A row that is merely scrolled out of view is not part of this question: its flash finishes unseen under every option.

| Option | Behaviour | Cost |
|---|---|---|
| F-L: play late, always | Every job that finished while the window was hidden flashes when the window returns, after a minute or after a night | No code beyond r1's. Returning after a long absence, many rows may flash at once for something that happened hours ago |
| F-V: play only if the window was visible at the finish | A job that finishes while the window is hidden never flashes | One condition. A user who looked away for a few seconds gets no flash. This is the same as a bound of zero, which is why it is not filled in by default |
| F-B: play late only within a bound | The flash plays on return if the window is shown within N seconds of the finish; otherwise not | One constant, one listener per waiting row. Needs the owner's N |

Filled in: F-B (the plan lane's recommendation), because it is the only option that keeps the cue for a short look away and drops it for a long absence. F-L and F-V are its two limits.

- The bound is the named constant `FLASH_LATE_MS`. **Its value is the owner's and this plan sets none.** If F-B is chosen, the plan cannot be frozen until the value is written into 6.3.
- A starting point the owner may accept or change: 30 seconds (`30000`). It is a suggestion only.
- The bound is measured from the finish to the moment the window is shown, on a clock that cannot run backwards.

### 13.3 Other open questions

Each has a recommendation that the plan already follows.

| # | Question | Recommendation |
|---|---|---|
| Q2 | Status on line two and no Status heading (DV-2). As a column it would need 90px more: `930 + 191 = 1121`, over the 1106px start size, so "added" could not show; and a three-part status cannot fit 80px | Keep line two. Shown to the owner at the commit (13.4). If overturned, `columns.status` returns and the widths of section 5 are redone |
| Q3 | The label of a single media lane whose role is not known: "Current part" / "الجزء الحالي" | Keep. It matches the size cell's hint (`strings.ts:91`). "Video" would be wrong while the audio stream runs |
| Q4 | Done rows reserve the lanes block, about 42px of empty height each, because the architecture fixes one height for every form | Keep, as frozen. It prevents a shift at finish. A compact done row would need the owner to change the architecture's rule |
| Q5 | The kind icon becomes a check when the job is done, as in the mockup, so a finished row no longer shows whether it was a video or a file | Keep. The file name and quality still tell them apart |
| Q6 | The just-done flash is in; a row "enter" animation is not | Keep. D4 names the flash; nothing names an enter animation |
| Q7 | The merge marker loops (DV-3) | Keep. The alternative is one pass that rests at the end |
| Q8 | `today` re-renders rows after midnight (C2's note on `addedText`) | Keep. It costs one number per row and keeps today's behaviour |
| Q9 | The Open action stays a text button | Keep. It is the primary action of a done row, and the 156px column already holds it |
| Q10 | The collapse button is named by the playlist title, as today | Keep. `aria-expanded` gives the state |
| Q11 | A stalled row shows an empty speed cell while the strip shows `0 B/s` (C3 Q2) | Unchanged by C4; still the owner's |
| Q12 | The head is `--tint` (DV-8) | Keep; the alternative is `--surface` with a bottom rule |
| Q13 | "Show all" stays on `ShowAllContext` (C3 DV-6, overturnable here) | Keep; `JobList`'s props stay frozen |
| Q14 | A media job's segment map is labelled "File" (critique N-15) | Keep, under D12 (4.3). The alternative keys the label on `job.kind` and would call a file fetched in parts "Current part" |

Rules that reject future or stale data **[Q-C4-2/6]**:
- C4 has one: a flash held for a finish that happened while the window was hidden is dropped when the window is shown later than `FLASH_LATE_MS` after the finish. The tolerance is that constant. Its value is the owner's (Q-C4-2); this plan sets no value and does not default it to zero.
- The rule rejects nothing as "future": elapsed time comes from `performance.now()`, which never runs backwards, and `flashLate` accepts a negative value.
- `dayStamp` only decides when a row re-renders. It drops nothing.
- `laneModel` rule 3 hides a stored connection count once the job is not downloading. That is C2's frozen rule, and its duration is the owner's open question C2 Q7 (C2 plan section 11). C4 shows whatever the model returns.
- The architecture's owner decision Q2 stands: a stale speed is not blanked.

### 13.4 Visible changes shown to the owner at the C4 commit

The orchestrator lists these to the owner with the commit, as C2 did with OD-5. Each can be overturned.

1. The Status column heading is gone, and the dictionary key `columns.status` with it (DV-2). The status itself is on every row's second line.
2. The narrow-window rule recorded as DV-9.
3. Rows are about twice as tall as today's, and done rows keep the empty lanes block (Q4).
4. A done row's kind icon is a check (Q5).
5. The late-flash behaviour recorded for Q-C4-2.

## 14. Risks

- Nothing was run by this lane. Section 5's arithmetic rests on PW-1 at 150% scaling only, on C1's 156px action column, and on the CSS constants read from `styles.css:213-270`. At 100% or 125% the frame and scrollbar may differ by a pixel or two; each threshold carries 9px. Manual check 6 decides, and the remedies are stated.
- Row and head heights (4.6) are hand sums in a font this lane could not measure. Remedies 2, 6 and 7 cover a difference. A wrong `--row-h` only makes the scrollbar length drift (PC-2); a wrong `--head-h` could leave part of a focused button under the head, which check 15 would show.
- That `contain-intrinsic-size` sizes the content box, so that `--row-h` excludes borders, is read from the specification and not probed. If the placeholder turns out to be the outer height, the error is 1 or 2px per unmeasured row, and remedy 2 corrects it.
- C1's, C2's and C3's code is not in this worktree. Names and signatures are from their frozen plans.
- PC-2 probed the scroll margin on 64px rows, not on content-height rows, and did not probe focus moving into a row that `content-visibility` is skipping. Check 15 covers both. A failure there stops C4 after remedy 7.
- PC-2 checked hit targets under `isolation: isolate`, not that the head still sticks. Nothing in the stacking rules suggests it would not; check 5 confirms.
- PC-2 ran on one runtime: Electron 45.4.1 on Windows 10.0.26100. No other version is covered, and CI covers none of it.
- The exact pause rule was seen pausing a one-shot animation in PC-2, but is unverified on the app's perpetual animations until check 9. If it fails, C4 stops; the fix belongs to C3's rule.
- The flash under F-B depends on `visibilitychange` firing when the window returns, in the three hidden cases. PV-1 covered the event for hide, minimise and occlusion. If the event were missed, a held flash would never play: the failure is a missing cue, never a late one.
- Before C7 the only perpetual animation is the merge marker, and a real merge can last under a second. Check 9 gives a way to hold one on screen.
- The pair, the map and the sheen cannot be seen on a real job until C7. Their drawing is covered by unit tests of `laneView` and `laneTexts` and by text checks only. The cost of up to 240 cell transitions is unknown until then (remedy 8).
- No DOM tests exist. The layout, RTL, the sticky head, the bracket's stacking over contained rows, dialogs over the head, focus under the head and the focus ring are covered only by section 10 and e2e.
- The paused hatch is scaled with its fill, and the dashed unknown lane is a new pattern. Both are judged by eye; neither carries meaning alone.
- `color-mix()` and the marker's `translateX(calc(100% - 10px))` were not probed. If either misbehaves in Electron 45, the implement lane stops and reports.
- The text checks of 6.9 fix exact CSS strings. A permitted remedy that changes one needs a tests lane.
- The owner's answers arrive at freeze. If either differs from the filled-in recommendation, the substitution of Appendix A or B must be applied to every tagged place; a missed place would leave the plan inconsistent. The tags are counted: five for Q-C4-1, six for Q-C4-2.
- The A3 branch adds `Job` fields. `sameRow` covers them, and `JobRow` reads none of them.
- Removing `columns.status` is easy to reverse, but a later component that wants the word must add it back with its test line.
- Row height roughly doubles against today's rows, so fewer rows fit a window. That is the chosen design; Q4 records its cost for done rows.

## Appendix A. If the owner picks another variant for Q-C4-1

Replace the text at each tagged place with the text below. Nothing else in the plan changes. The option table and the recommendation paragraph in 5.5, the per-variant bounds in remedy 1 and the summary in 13.2 already cover all four and stay.

### V-S (the speed drops)

| Tag | Replacement text |
|---|---|
| `[Q-C4-1/1]` (5.5) | Variant recorded at freeze: **V-S**. CSS: `@media (max-width: 735px) { .jobs-head, .job-main, .group-head { grid-template-columns: 24px minmax(var(--name-min, 120px), 1fr) 56px 136px auto; grid-template-areas: 'kind name quality size actions' '.    status status status .'; } .job-speed { display: none; } }`. At 706px: line one is kind, name, quality, size, actions; need 554; spare 65; names 185 / 163 / 185. The playlist head follows the rows: its combined speed is hidden too; the strip still shows the total. Recorded as DV-9. |
| `[Q-C4-1/2]` (6.9, the 735px block) | Inside the `(max-width: 735px)` block: the rule whose selector is `.job-speed` holds `display: none`; the block's areas contain no `speed`. |
| `[Q-C4-1/3]` (6.9, budget) | `need` of the template inside `(max-width: 735px)` is 554. Budget: `554 + 87 ≤ 706 − 9`. |
| `[Q-C4-1/4]` (check 6, last row) | 735, 706 (minimum): kind, name, quality, size, actions. No speed on rows, members or the head, and no Speed heading; the strip still shows the total speed. |
| `[Q-C4-1/5]` (DV-9) | Deviation: V-S, chosen by the owner: at or below a 735px viewport the speed column drops, a third drop. From: architecture section 10, "columns drop in today's order (added, then time left)". |

### V-A (no third rule; the name minimum falls)

| Tag | Replacement text |
|---|---|
| `[Q-C4-1/1]` (5.5) | Variant recorded at freeze: **V-A**. CSS: `@media (max-width: 735px) { .jobs-head, .jobs > .job, .group-head { --name-min: 90px; } .group-members .job { --name-min: 68px; } }`. The block holds no template; the 929px template stays in force. At 706px: line one is kind, name, quality, size, speed, actions; need 610; spare 9; names 99 / 77 / 99. A member needs the same as a lone row: `22 + 68 = 90`. No deviation: DV-9 is not used. |
| `[Q-C4-1/2]` (6.9, the 735px block) | Inside the `(max-width: 735px)` block: `--name-min: 90px` and `--name-min: 68px`; the block holds no `grid-template-columns` and no `display: none`. |
| `[Q-C4-1/3]` (6.9, budget) | `need(the template inside (max-width: 929px), 90)` is 610. Budget: `610 + 87 ≤ 706 − 9`. |
| `[Q-C4-1/4]` (check 6, last row) | 735, 706 (minimum): the same columns as at 736 (no "added", no "time left"); the speed stays in its column under its heading. Names are short: at 706 about 99px on lone rows and heads and 77px on members. Report the spare at 706 (expected 9px). |
| `[Q-C4-1/5]` (DV-9) | Not used: V-A, chosen by the owner, conforms to architecture section 10 (two drops, every heading with its column). |

Also under V-A, one sentence outside the tags reads differently and needs no edit: remedy 1 already states that V-A has no slack for a wider action column.

### V-Q (the quality drops on rows)

| Tag | Replacement text |
|---|---|
| `[Q-C4-1/1]` (5.5) | Variant recorded at freeze: **V-Q**. CSS: `@media (max-width: 735px) { .jobs-head, .job-main { grid-template-columns: 24px minmax(var(--name-min, 120px), 1fr) 136px 76px auto; grid-template-areas: 'kind name size speed actions' '.    status status status .'; } .group-head { grid-template-columns: 24px minmax(var(--name-min, 120px), 1fr) 56px 76px auto; grid-template-areas: 'kind name quality speed actions' '.    status status status .'; } .jobs-head .job-quality, .job-main .job-quality { display: none; } }`. At 706px: a row's line one is kind, name, size, speed, actions; need 574; spare 45; names 165 / 143 / 165. The head keeps its `2 / 3` (an e2e hook) and has no size cell, so it needs 494 and its columns no longer line up with the rows'. Recorded as DV-9. |
| `[Q-C4-1/2]` (6.9, the 735px block) | Inside the `(max-width: 735px)` block: the rule whose selector is `.jobs-head, .job-main` holds the template `24px minmax(var(--name-min, 120px), 1fr) 136px 76px auto`; the rule whose selector is `.group-head` holds `24px minmax(var(--name-min, 120px), 1fr) 56px 76px auto`; the rule whose selector is `.jobs-head .job-quality, .job-main .job-quality` holds `display: none`; no rule in the block hides `.group-head .job-quality`. |
| `[Q-C4-1/3]` (6.9, budget) | Inside `(max-width: 735px)` the budget reads two rules: `need` of the `.jobs-head, .job-main` template is 574 and of the `.group-head` template is 494. Budget: `574 + 87 ≤ 706 − 9` and `494 + 87 ≤ 706 − 9`. |
| `[Q-C4-1/4]` (check 6, last row) | 735, 706 (minimum): rows and members show kind, name, size, speed, actions, with no quality and no Quality heading. The head shows its `2 / 3` and its speed; its columns do not line up with the rows', which is expected. |
| `[Q-C4-1/5]` (DV-9) | Deviation: V-Q, chosen by the owner: at or below a 735px viewport the quality column drops on rows and headings, a third drop; the playlist head keeps its count and stops lining up with the rows. From: architecture section 10, "columns drop in today's order (added, then time left)", and the one grid for rows and heads. |

## Appendix B. If the owner picks another option for Q-C4-2

Replace the text at each tagged place with the text below. Nothing else in the plan changes. The option table in 13.2 covers all three and stays; its "Filled in" line names the chosen option.

### F-L (play late, always)

| Tag | Replacement text |
|---|---|
| `[Q-C4-2/1]` (4.2) | The flash when the window is hidden at the finish. Option recorded at freeze: **F-L** (play late, always). The effect calls `flashStart(prev, job.state)` and, on `'play'`, `setFlash(true)`, whether or not the window is hidden. In a hidden window C3's rule holds the animation at its first frame, and it plays in full when the window is shown (PC-2), however long ago the job finished. `JobRow` reads no visibility state and no clock. |
| `[Q-C4-2/2]` (6.3) | Option recorded at freeze: **F-L**. Exports: `export type FlashStart = 'none' \| 'play';` and `/** What a mounted row does when its job's state changes from prev to next. */ export function flashStart(prev: JobState, next: JobState): FlashStart;`. There is no `FLASH_LATE_MS` and no `flashLate`. Rule: `'play'` exactly when `prev !== 'done'` and `next === 'done'`, else `'none'`. Table: downloading → done, merging → done, paused → done, failed → done, queued → done give `'play'` each; done → done gives `'none'`; done → failed, downloading → failed, queued → queued, downloading → skipped give `'none'` each. |
| `[Q-C4-2/3]` (6.9) | `components/JobRow.tsx`, the flash: contains `flashStart(`. Contains no `FLASH_LATE_MS`, no `flashLate(`, no `visibilitychange` and no `isDocumentHidden(`. |
| `[Q-C4-2/4]` (check 12) | The flash: (a) a download finishing while its row is on screen and the window is visible: one short flash, then the done look; (b) a row that is already done when the window opens does not flash; (c) a download finishing while its row is scrolled out of view: scrolling to it afterwards shows no flash; (d) minimise the window, let a download finish, wait at least a minute and restore: the row flashes once on return; (e) repeat (d) with the window closed to the tray and with it fully covered by another app. |
| `[Q-C4-2/5]` (section 11) | A job finishes while the window is hidden: the flash waits at its first frame and plays once, in full, when the window is next shown, however long ago the job finished. |
| `[Q-C4-2/6]` (13.3) | C4 has no rule that rejects future or stale data, and sets no tolerance: under F-L, chosen by the owner, a flash plays however late the window returns, and the flash uses no clock. |

Under F-L the rows of section 11 "Several jobs finish while the window is hidden" and "A held flash and the row unmounts" read: every such row flashes together on return; a row that unmounts loses its flash. The F-B risk about `visibilitychange` in section 14 does not apply.

### F-V (play only if the window was visible at the finish)

| Tag | Replacement text |
|---|---|
| `[Q-C4-2/1]` (4.2) | The flash when the window is hidden at the finish. Option recorded at freeze: **F-V** (play only if the window was visible at the finish). The effect calls `flashStart(prev, job.state, isDocumentHidden(document.visibilityState))`, with `isDocumentHidden` from `../frame` (C3), and on `'play'` calls `setFlash(true)`. When the window is hidden at the finish the result is `'none'`: no overlay is mounted and the row never flashes for that finish. `JobRow` reads no clock and adds no listener. |
| `[Q-C4-2/2]` (6.3) | Option recorded at freeze: **F-V**. Exports: `export type FlashStart = 'none' \| 'play';` and `/** What a mounted row does when its job's state changes from prev to next. */ export function flashStart(prev: JobState, next: JobState, hidden: boolean): FlashStart;`. There is no `FLASH_LATE_MS` and no `flashLate`. Rule: `'play'` exactly when `prev !== 'done'`, `next === 'done'` and `hidden` is false, else `'none'`. Table: downloading → done, merging → done, paused → done, failed → done, queued → done give `'play'` each with `hidden` false and `'none'` each with `hidden` true; done → done gives `'none'` for both; done → failed, downloading → failed, queued → queued, downloading → skipped give `'none'` each for both. |
| `[Q-C4-2/3]` (6.9) | `components/JobRow.tsx`, the flash: contains `flashStart(` and `isDocumentHidden(`. Contains no `FLASH_LATE_MS`, no `flashLate(` and no `visibilitychange`. |
| `[Q-C4-2/4]` (check 12) | The flash: (a) a download finishing while its row is on screen and the window is visible: one short flash, then the done look; (b) a row that is already done when the window opens does not flash; (c) a download finishing while its row is scrolled out of view: scrolling to it afterwards shows no flash; (d) minimise the window, let a download finish and restore at once: no flash, the row shows the done look; (e) repeat (d) with the window closed to the tray and with it fully covered by another app. |
| `[Q-C4-2/5]` (section 11) | A job finishes while the window is hidden: no flash, then or later. The row shows the done look when the window returns. |
| `[Q-C4-2/6]` (13.3) | C4 has one such rule: a finish that happens while the window is hidden gets no flash, however soon the window returns. That is a tolerance of zero for a late flash. It is not a default of this plan: the owner chose it by name (F-V) over a bounded delay (F-B) and over no bound (F-L). The rule uses no clock and rejects nothing as "future". |

Under F-V the rows of section 11 "Several jobs finish while the window is hidden" and "A held flash and the row unmounts" read: none of them flashes; there is no held flash. The F-B risk about `visibilitychange` in section 14 does not apply.

## Changes from r1

BLOCKING:
- **B-1 (the head paints over dialogs)** — fixed. `.jobs { isolation: isolate; }` added in 4.6, asserted in 6.9 (with "no `z-index` on `.backdrop` or `.dialog`"), counted by a grep in section 9, and checked by the new manual check 14 in both languages. PC-2's result is in 4.6 and 4.8. The C5 and C6 boundary rows now say the list is its own stacking context and what that means for a layer before or after it in the DOM. An e2e row for `clickButton(dialog, 'Close')` was added. Recorded as DV-11.
- **B-2 (focus under the stuck head)** — fixed with PC-2. The two r1 sentences that said the browser scrolls focus clear (section 7 and the section 11 row) are corrected: it does not scroll at all. `.group-members button { scroll-margin-block-start: calc(var(--head-h) + 8px); }` is added, with `--head-h` 76px (Arabic 80px) as the head's height token. It is asserted in 6.9, verified by the new manual check 15, and remedy 7 covers a head whose measured height differs. `scroll-padding` is recorded as probed and not used (a much larger jump) and asserted absent. What PC-2 did not cover is listed in 4.8 and section 14.
- **B-3 (frozen with Q-C4-1 open)** — fixed as the orchestrator decided. 5.5 states the variant is chosen by the owner and recorded at freeze. The recommended variant (V-M) is written into every place that depends on it, each tagged `[Q-C4-1/1]` to `[Q-C4-1/5]`. Appendix A gives the replacement text for V-S, V-A and V-Q at each tag. The "orchestrator names the variant in the briefs" and "answered after the tests" paths, and the matching risk, are deleted. C3's Q15 boundary row now reads "answered by the owner at freeze".

NON-BLOCKING:
- **N-1** — accepted. V-M is no longer called conforming: 5.5 says it deviates (a heading goes while its cell stays), "nothing is lost" is replaced by what actually changes, the shorter status line is stated for both V-M and V-S, and only V-A is described as fully conforming. V-M is recorded as DV-9. The four options are presented in one neutral table; the recommendation is a separate paragraph marked as the plan lane's.
- **N-2** — accepted. `need(template, nameMin = 120)`; V-A's budget is the 929px template with 90 (Appendix A).
- **N-3** — accepted. V-Q's head template uses `minmax(var(--name-min, 120px), 1fr)` (Appendix A).
- **N-4** — accepted. Remedy 1's bounds are corrected to `A ≤ 222` (start size) and `A ≤ 209` (801px), with the arithmetic shown, and V-A (`A ≤ 156`) and V-Q (`A ≤ 192`) added beside V-M and V-S (`A ≤ 212`).
- **N-5** — accepted. DV-2 is listed in the new 13.4, "Visible changes shown to the owner at the C4 commit", and 4.1, DV-2 and Q2 point to it.
- **N-6** — made an owner question (Q-C4-2) as the orchestrator decided, using PC-2. r1's "harmless" row is replaced. PC-2 corrected one part of the critique: an off-screen row's flash finishes unseen and does not play on scroll-in, so only the hidden-window case is a choice. Options F-L, F-V and F-B are presented neutrally in 13.2. F-B is filled in at six places tagged `[Q-C4-2/1]` to `[Q-C4-2/6]`, with the bound as `FLASH_LATE_MS`, whose value is the owner's and is not set here (30 s is offered as a suggestion only). Appendix B gives the replacement text for F-L and F-V. `justFinished` is replaced by `flashStart` and `flashLate` (6.3). 13.3 now names this as C4's one rule that rejects stale data, with no zero default.
- **N-7** — fixed by changing the colour, not by calling it decoration. The marker is `--surface` with a 2px `--ink` edge: `surface` against both lane colours is 5.22 or more and `ink` against `surface` 13.61 or more, in both themes, all pairs C1 already tests. The contrast table in section 7 is restructured with separate light and dark columns and carries the marker's pairs; 6.9 asserts the two tokens. Recorded as DV-10. The text equivalent ("Merging", "finishing…") still carries the meaning.
- **N-8** — accepted. Chosen in the CSS: `.job-actions button { line-height: 20px; min-height: 28px; }`, so every action button is 28px tall in both languages. A fixed line-one height (`grid-template-rows: 28px auto`) is the permitted remedy 6. Check 4 names the done row.
- **N-9** — accepted, with PC-2. 4.6 has a table of hand-summed heights: `--row-h` is the content height (108px, Arabic 116px), and the outer heights are 110 and 109 (Arabic 118 and 117). The plan states that `contain-intrinsic-size` sizes the content box, that this is from the specification and not probed, and remedy 2 now says "outer height minus borders". PC-2's scrollbar-length drift is the stated reason to keep the token at the real height; check 8 watches for it.
- **N-10** — accepted. C1 Q7's eye check is manual check 16, and section 9 has a table of the checks earlier plans deferred to C4 (C1 Q7, C3 DV-7, C3 Q15).
- **N-11** — accepted. 4.6's "Removed" list, the `shellSources` row in section 9, 6.9's "removed" row and a grep name C3's remedy rules (the `(max-width: 1117px)` query and lowered minimums in the 800px query).
- **N-12** — accepted. The width budget reads only the rule whose selector is `.jobs-head, .job-main, .group-head`.
- **N-13** — accepted. The `transition:` check strips a trailing `!important` first.
- **N-14** — accepted. Rows 25 and 26 add `+Infinity` and `−Infinity` for a fraction and for cells; the rule now says the non-finite test comes before the clamp.
- **N-15** — the plan lane's choice: "File" is kept under D12 and the label is not keyed on `job.kind`. Reason: segments come only from the file engine and D12 says the UI keys on what the entry holds, so a job fetched as one file in parts is named by that. Stated in 4.3, 6.5, row 27, the edge cases, the C2 boundary and Q14.
- **N-16** — accepted. Section 8 names the 240-transition case, check 8 repeats it after C7, and remedy 8 permits dropping the cell transition.
- **N-17** — the probed shorthand `contain-intrinsic-size: auto var(--row-h)` is kept. Reason: both probes ran it, and its inline value has no effect on a block-level `li` that fills its container. `contain-intrinsic-block-size` was not probed. Stated in 4.8 and asserted in 6.9.

From PC-2, beyond the items above:
- 4.7's last bullet ("skipped rows do not run their animations") is withdrawn: timelines advance in skipped rows, and only painting is skipped. Section 8 is reworded to match.
- 4.8 gains the full PC-2 table, including content-height rows (no scroll jump, head stays pinned), which closes r1's stated difference from PC-1.
- PC-2 is added to the header's probe list with its runtime; no other runtime is covered, and CI covers none.

Other changes that follow from the above:
- Manual checks 14 to 16 are new; the e2e check moved from 14 to 17. Checks 4, 5, 8 and 12 are extended.
- DV-9 is filled in; DV-10 and DV-11 are new.
- `JobRow` now uses C3's `isDocumentHidden`; the C3 and C6 boundary rows record that "hidden" has one meaning for the pause rule, the flash and C6.
- Q7's cross-reference in 4.7 is corrected (r1 pointed to Q8).