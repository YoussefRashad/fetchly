# Fetchly "Lanes" UI redesign — C2 View models (pure, no visuals)

- Date: 2026-11-24. Branch: `feat/lanes-redesign`. File: `docs/plans/2026-11-24-lanes-c2-view-models.md`. Revision r2 (after plan-critique r1: 1 BLOCKING closed by probe PU-1, 13 NON-BLOCKING answered).
- Parent: `docs/plans/2026-11-24-lanes-redesign-architecture.md` (r3, frozen). Its D1–D12, sections 5.1–5.3, the provisional table, the C2 section and 7.1–7.4, 7.6, 7.7 and 7.10 bind this plan.
- Previous component: `docs/plans/2026-11-24-lanes-c1-foundation.md` (r2, frozen); it lands first.
- Class: component plan of a large task. No migration and no saved-state change, so no rollback section.
- The plan lane is read-only and ran nothing. The orchestrator ran one probe, PU-1 (section 5.6). Every other expected value is hand arithmetic from the architecture's rules; the tests decide.
- Sources read: both frozen plans in full; `src/shared/types.ts`; `src/renderer/src/format.ts`, `banners.ts`, `App.tsx`, `components/JobRow.tsx`, `GroupRow.tsx`, `JobList.tsx`; `src/main/jobs/state.ts`; `src/main/jobs/queue.ts:29-59,150-360,455-632`; `tests/helpers.ts`; `tests/renderer/banners.test.ts`, `bannersServer.test.ts`, `status.test.ts`, `format.test.ts`, `columns.test.ts:1-30`, `strings.test.ts:1-30`; `vitest.config.mts`, `tsconfig.node.json`, `tsconfig.web.json`, `eslint.config.mjs`, `package.json`, `.github/workflows/ci.yml`.
- `AGENTS.md`, `.ai/agents/*.md`, `.ai/security-paths.json` and `.ai/tools/git-safe.mjs` do not exist in this worktree. The code, the `package.json` scripts and `docs/` are the source of truth.
- Line numbers are from this worktree, where C1 has not landed.
  - Citations of component files (`App.tsx`, `JobRow.tsx`, `GroupRow.tsx`, `UrlBar.tsx`, `AddDialog.tsx`) are pre-C1 and shift after C1, which adds an `Icon` import to them.
  - The files C2 edits (`format.ts`, `banners.ts`, `types.ts`, `tests/helpers.ts` and the three existing test files) are not touched by C1, so their cited lines hold.

## 1. Context

C2 adds every derivation the new UI needs as pure functions with tests, before any component uses them. C3 to C6 and C9 then only call them. C2 draws nothing.

## 2. Scope

In scope:
- The 5.1 types in `src/shared/types.ts`: `StreamRole`, `JobLive`, and the optional `live` on `Snapshot`.
- `src/shared/progress.ts`: `streamFraction`, `wholeJobFraction` and the three constants (5.2).
- Six new model files under `src/renderer/src/model/`: `lanes.ts`, `summary.ts`, `finished.ts`, `thumbnail.ts`, `rowEqual.ts`, `settingsSection.ts`.
- `format.ts`: new `filterCounts` and `groupView`; `statusParts` gains one part for a paused job that cannot resume.
- `banners.ts`: `Banner` gains `tone` and `opens`.
- Tests for all of the above, and the rewrite of the superseded banner tests.

Out of scope for C2:
- Any component, CSS or string change. No `.tsx` file is edited (orchestrator decision OD-1: `App.tsx` already compiles with the wider `Banner`).
- Any use of the new functions in the window. `GroupRow` keeps its inline flags (`GroupRow.tsx:18-23`) and `App` its own speed sum (`App.tsx:77`) until C3 and C4.
- The `EngineEvent` fields of 5.1, the queue's live map and `snapshot()` (C7). After C2 no `live` entry ever exists.
- `holdHidden`, `holdWaiting`, `dueOnVisible`, `LATE_TOAST_MS` (7.11). C6 adds them to `finished.ts`.
- `taskbarProgress` (7.5, C9), `segmentFill` (7.9, C7), `contrast` and the palette (C1).
- Any amendment of a provisional rule. 5.1 and rows 7 to 11 of 5.2 are implemented exactly as written; only C7's plan may amend them.
- New strings. `S.status.cannotResume` and `S.status.waitingForCheck` exist in both languages (`strings.ts:62-63`, `strings.ar.ts:56-57`).

## 3. Files

### Created

| File | Exports |
|---|---|
| `src/shared/progress.ts` | `W_VIDEO`, `W_AUDIO`, `MERGE_AT`, `streamFraction`, `wholeJobFraction` |
| `src/renderer/src/model/lanes.ts` | `Fill`, `Tone`, `Lane`, `LaneModel`, `laneModel` |
| `src/renderer/src/model/summary.ts` | `Summary`, `summary` |
| `src/renderer/src/model/finished.ts` | `FinishedEvent`, `finishedEvents` |
| `src/renderer/src/model/thumbnail.ts` | `acceptThumbnail`, `rememberThumb`, `thumbFor` |
| `src/renderer/src/model/rowEqual.ts` | `sameRow` |
| `src/renderer/src/model/settingsSection.ts` | `SETTINGS_SECTIONS`, `SettingsSection` |
| `tests/progress.test.ts` | table 5.1 of this plan |
| `tests/renderer/lanes.test.ts` | table 5.2 |
| `tests/renderer/summary.test.ts` | table 5.3 |
| `tests/renderer/listModels.test.ts` | `filterCounts` (5.4) and `groupView` (5.5) |
| `tests/renderer/thumbnail.test.ts` | tables 5.6 |
| `tests/renderer/finished.test.ts` | table 5.7 |
| `tests/renderer/rowEqual.test.ts` | 5.10 |
| `tests/renderer/settingsSection.test.ts` | 5.11 |

### Modified

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `StreamRole` and `JobLive`; `Snapshot` (lines 118-121) gains `live?: Record<string, JobLive>`. Nothing else. |
| `src/renderer/src/format.ts` | Add `filterCounts`, `GroupView`, `groupView`. In `statusParts`, the `paused` case (lines 97-102) pushes `t.cannotResume` after the `waitingForCheck` part when `!job.resumable`. `groupSummary`, `Filter`, `matchesFilter` and every other export are unchanged. |
| `src/renderer/src/banners.ts` | `Banner` gains `tone` and `opens`; the five `push` calls (lines 21-25) set them; the last JSDoc sentence of `banners` (line 17) is replaced as given below, because it stops being true in C3. |
| `tests/helpers.ts` | Add `makeLive` (section 5, "How inputs are built"). `makeJob` and `makeSettings` unchanged. |
| `tests/renderer/banners.test.ts` | Superseded cases rewritten (section 7). |
| `tests/renderer/bannersServer.test.ts` | Superseded cases rewritten, one renamed, cases added for `opens`; the header comment (lines 4-5) lists the five `Banner` fields. |
| `tests/renderer/status.test.ts` | Rows added to the both-languages table (lines 16-35) for the new paused part. No existing row changes. |

Not modified: `src/renderer/src/App.tsx` (OD-1), every component, `styles.css`, `strings*.ts`, `src/main/**`, `tsconfig*.json`, `vitest.config.mts`, `eslint.config.mjs`, `package.json`, `e2e/**`, every doc.

### JSDoc

- `banners.ts:17`: the sentence "The server banner has no button: saving Settings retries." becomes exactly:
  "The server banner has no BannerAction; a port-busy banner names what its button opens in `opens`."
  The rest of that JSDoc (lines 14-17) and the `Banner` and `BannerAction` comments (lines 4, 7) are unchanged.
- The new exports carry no JSDoc promise beyond the comments shown in section 4 (the three `JobLive` field comments and the `opens` comment).
  - The implement lane may add a JSDoc that restates a rule of section 5 in one sentence. It adds no promise that section 5 does not make.
  - The tests lane therefore tests section 5, the four comments of section 4 and the sentence above. Of the `segments` comment, C2 tests only "null = not known" (the L10 rows); its range (0..1) and cell count (1..24) are main's promise, passed through unchanged by C2 (section 9) and tested in C7.

### Imports

| Module | Imports |
|---|---|
| `src/shared/progress.ts` | `import type { Job, JobLive } from './types'` |
| `model/lanes.ts` | `import type { Job, JobLive } from '../../../shared/types'`; `import { streamFraction } from '../../../shared/progress'` |
| `model/summary.ts` | `import type { Job } from '../../../shared/types'` |
| `model/finished.ts` | `import type { Group, Job, Snapshot } from '../../../shared/types'` |
| `model/thumbnail.ts` | `import type { Job } from '../../../shared/types'` |
| `model/rowEqual.ts` | `import type { Job, JobLive } from '../../../shared/types'` |
| `model/settingsSection.ts` | nothing |
| `format.ts`, `banners.ts` | as today (`format.ts:1-2`, `banners.ts:1-2`) |

Rules:
- No file under `src/renderer` or `src/shared` imports from `src/main`. `src/shared` is compiled by both configs (`tsconfig.node.json:21`, `tsconfig.web.json:16`).
- No model file imports `strings.ts` or `format.ts`. Models return codes and numbers, never text (D9).
- `progress.ts` uses no DOM and no Node API, so main (C9) and the renderer can both import it.
- Tests are typechecked under `tsconfig.node.json` (`"tests/**/*"`, line 23), which has no DOM lib (line 6). A model file a test imports is therefore also compiled without DOM types.
  - The only global C2 needs is `URL`, which `@types/node` declares (`types: ["node"]`, line 7) and the DOM lib declares for the web config.
  - No model file may use another DOM global.

## 4. Types and signatures

```ts
// src/shared/types.ts (added; Snapshot replaces lines 118-121)
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

// src/shared/progress.ts
export const W_VIDEO = 0.85;
export const W_AUDIO = 0.13;
export const MERGE_AT = 0.98;
export function streamFraction(job: Job): number | null;
export function wholeJobFraction(job: Job, live: JobLive | undefined): number | null;

// src/renderer/src/model/lanes.ts
export type Fill = { kind: 'known'; fraction: number } | { kind: 'unknown' } | { kind: 'empty' } | { kind: 'full' };
export type Tone = 'active' | 'waiting' | 'paused' | 'failed';
export interface Lane { fill: Fill; tone: Tone }
export type LaneModel =
  | { form: 'none' }
  | { form: 'single'; fill: Fill; tone: Tone }
  | { form: 'pair'; video: Lane; audio: Lane }
  | { form: 'merge'; strands: 1 | 2 }
  | { form: 'segments'; cells: number[]; connections: number | null; tone: Tone };
export function laneModel(job: Job, live: JobLive | undefined): LaneModel;

// src/renderer/src/model/summary.ts
export interface Summary {
  speed: number;
  active: number;
  remaining: { bytes: number; approx: boolean } | null;
  eta: { seconds: number; approx: boolean } | null;
}
export function summary(jobs: Job[]): Summary;

// src/renderer/src/model/finished.ts
export type FinishedEvent =
  | { kind: 'job'; job: Job }
  | { kind: 'group'; group: Group; done: number; failed: number; skipped: number };
export function finishedEvents(prev: Snapshot, next: Snapshot): FinishedEvent[];

// src/renderer/src/model/thumbnail.ts
export function acceptThumbnail(raw: unknown): string | null;
export function rememberThumb(map: Map<string, string>, url: string, thumb: unknown, cap?: number): void; // cap = 200
export function thumbFor(map: Map<string, string>, job: Job): string | null;

// src/renderer/src/model/rowEqual.ts
export function sameRow(a: Job, b: Job, liveA: JobLive | undefined, liveB: JobLive | undefined): boolean;

// src/renderer/src/model/settingsSection.ts
export const SETTINGS_SECTIONS = ['appearance', 'downloads', 'browser', 'tools'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

// src/renderer/src/format.ts (added)
export function filterCounts(jobs: Job[]): Record<Filter, number>;
export interface GroupView {
  done: number; total: number; skipped: number; percent: number; speed: number;
  canPause: boolean; canResume: boolean; unfinished: boolean;
}
export function groupView(members: Job[]): GroupView;

// src/renderer/src/banners.ts
export type BannerTone = 'bad' | 'warn';
export type BannerOpens = 'settingsBrowser';
export interface Banner {
  id: 'engine' | 'server' | 'save' | 'cutOff';
  text: string;
  action: BannerAction | null;
  tone: BannerTone;
  /** What the banner's extra button opens. Not a BannerAction: it is never called on window.fetchly. */
  opens: BannerOpens | null;
}
```

Notes on the types:
- `Lane` only names the `{ fill; tone }` shape that 7.1 writes inline twice. `LaneModel` has the same structure.
- `SettingsSection` is the architecture's union, in the same order. `SETTINGS_SECTIONS` is an addition (Q2).
- The banner's tone is named `BannerTone` so it cannot be confused with the lane `Tone`.
- `live` is `JobLive | undefined` everywhere, which is what `snapshot.live?.[job.id]` gives under `noUncheckedIndexedAccess` (`tsconfig.web.json:10`).
- Every function reads the entry with optional chaining and `?? null`, so a missing entry, a missing field and a `null` field behave the same (L10).
- `sameRow` compares every key of the live entry. The architecture's 7.10 says "the same three fields"; comparing every key is a superset of that and gives the same answer for today's three-field `JobLive` (5.10).

## 5. Rules and acceptance tables

### How inputs are built

- Jobs come from `makeJob(over)` (`tests/helpers.ts:5-33`). Its defaults:
  - `id: 'job-<seq>'`, `groupId: null`, `kind: 'media'`, `url: 'https://example.com/watch?v=1'`, `title: 'Video'`;
  - `state: 'queued'`, `reason: null`, `quality: { kind: 'best' }`, `subtitleLangs: []`, `dir: 'D:\\Dl'`;
  - `baseName: 'Video'`, `fileName: null`, `index: null`, `bytesDone: 0`, `bytesTotal: null`, `speed: 0`, `eta: null`;
  - `actualHeight: null`, `resumable: true`, `attempts: 0`, `createdAt: <seq>`, `interrupted: false`, `sourceHeight: null`.
- "media" means the defaults. "file" means `makeJob({ kind: 'file', quality: null, baseName: null, ... })`.
- `50/200` means `bytesDone: 50, bytesTotal: 200`. `MB = 1024 ** 2`.
- Every `makeJob` call gives a new `id` and `createdAt` (`helpers.ts:3,6,8,28`). A test that needs the same job twice builds it once and derives the second with a spread (`{ ...a, state: 'done' }`) or `structuredClone(a)`.
- `live` is `makeLive(over)`, added to `tests/helpers.ts`. "no live" means `undefined`.

  ```ts
  export function makeLive(over: Partial<JobLive> = {}): JobLive {
    return { stream: null, segments: null, connections: null, ...over };
  }
  ```
- A `Snapshot` is the literal `{ jobs, groups }`, with no `live` key. No C2 function reads `Snapshot.live`.
- Playlists use `{ id: 'g1', title: 'Course', url: 'https://example.com/list', dir: 'D:\\Dl\\Course', createdAt: 1 }` and members `makeJob({ groupId: 'g1', index: n, ... })`.
- Rows marked **(+)** are added by this plan to close a gap. Unmarked rows are the architecture's, copied.
- Rows marked **(P)** have a live entry and are PROVISIONAL with 5.1 or rows 7 to 11 of 5.2.

### Bad numbers: one rule (orchestrator decision OD-2)

Main never stores a non-finite or negative count or speed (`queue.ts:29-30,469,472`; `validate.ts:19,178,180`). For a value that reaches the window anyway, every C2 function follows one rule:
- A non-finite byte count (`NaN`, `Infinity`, `-Infinity`) in `bytesDone` or `bytesTotal` is "not known". The job is treated exactly as a job whose `bytesTotal` is null: its fraction is null and it has no known size.
- A non-finite or negative `speed` adds 0 to a total, as `count` does in `queue.ts:29-30`.
- A finite negative `bytesDone` is not covered by this decision and keeps the architecture's behaviour: `streamFraction` clamps the quotient to 0, and `summary` floors only the difference at 0.

### 5.1 `streamFraction` and `wholeJobFraction` (`src/shared/progress.ts`, `tests/progress.test.ts`)

`streamFraction(job)`:
1. `null` when `bytesTotal` is null, not finite, or ≤ 0.
2. `null` when `bytesDone` is not finite (+, OD-2).
3. Otherwise `bytesDone / bytesTotal` clamped to 0..1.

`wholeJobFraction(job, live)`, with `f = streamFraction(job)`, `stream = live?.stream ?? null` and `audio = job.quality?.kind === 'audio'`. First match wins:

| # | Job | Result |
|---|---|---|
| 1 | `done` | 1 |
| 2 | `failed` or `skipped` | `null` |
| 3 | `merging` | `MERGE_AT` |
| 4 | `queued` or `probing`, with `bytesDone === 0` | 0 |
| 5 | `f === null` | `null` |
| 6 | `kind === 'file'` | `f` |
| 7 | media, `audio` (whatever the stream) | `f × (W_VIDEO + W_AUDIO)` |
| 8 | media, stream `muxed` | `f × (W_VIDEO + W_AUDIO)` |
| 9 | media, stream `video` | `f × W_VIDEO` |
| 10 | media, stream `audio` | `W_VIDEO + f × W_AUDIO` |
| 11 | media, stream not known (null, or any other value) | `null` |

Rows 7 to 11 are PROVISIONAL on PL-1.

Test rows:

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
| media, quality audio m4a, downloading 10/40, stream `audio` (P) | 0.25 | 0.245 |
| media downloading 50/200, stream `muxed` (P) | 0.25 | 0.245 |
| media downloading 50/200, stream `video` (P) | 0.25 | 0.2125 |
| media downloading 20/40, stream `audio` (P) | 0.5 | 0.915 |
| media paused 80/200, stream `video` (P) | 0.4 | 0.34 |
| media downloading 50/200, no live; live with `stream: null` (the second is (P)) | 0.25 | null; null |
| (+) file merging 30/40 | 0.75 | 0.98 |
| (+)(P) `done` with stream `video`, 50/200 | 0.25 | 1 |
| (+)(P) media failed 50/200, stream `video` | 0.25 | null |
| (+) media, quality audio mp3, paused 10/40, no live | 0.25 | 0.245 |
| (+)(P) media, quality audio m4a, downloading 10/40, stream `video` | 0.25 | 0.245 |
| (+) media, quality audio m4a, downloading 5/null | null | null |
| (+)(P) media, quality `{ kind: 'max', height: 720 }`, downloading 50/200, stream `video` | 0.25 | 0.2125 |
| (+)(P) media probing 50/200, stream `video` (a new run before its first event, L3) | 0.25 | 0.2125 |
| (+)(P) media probing 0/null, stream `audio` | null | 0 |
| (+) media queued 50/200, reason `retrying (1/3)`, no live | 0.25 | null |
| (+) file paused 0/100 | 0 | 0 |
| (+) media paused 0/null | null | null |
| (+)(P) media downloading 50/200, stream `'subs' as unknown as StreamRole` | 0.25 | null |
| (+)(P) media downloading 50/200, live with segments `[1, 0]`, `stream: null` | 0.25 | null |
| (+) file downloading `NaN`/200; 50/`NaN` | null; null | null; null |
| (+) file downloading 50/`Infinity`; `Infinity`/200 | null; null | null; null |

Assertions:
- `toBeCloseTo` for every product row: 0.245, 0.2125, 0.915, 0.34.
- Exact (`toBe`) for 0, 1, `null`, 0.98 (the constant itself), and plain quotients (0.25, 0.5, 0.75, 0.4): the division gives the same double as the literal.
- `W_VIDEO === 0.85`, `W_AUDIO === 0.13`, `MERGE_AT === 0.98`.
- (+) Property: over all eight states × `kind` × the three quality kinds × live (`undefined`, each role, `stream: null`) × counts (0/null, 50/200, 300/200, −5/200), the result is `null` or lies in 0..1.
- (+) Neither function changes its arguments (the job compared with a `structuredClone` taken before).

### 5.2 `laneModel` (`model/lanes.ts`, `tests/renderer/lanes.test.ts`)

Tone of the job: `paused` → `paused`; `failed` → `failed`; `queued` and `probing` → `waiting`; `downloading` → `active`. The other three states never reach a tone (rules 1 and 2).

Fill of the current stream, with `f = streamFraction(job)`:
- a number gives `{ kind: 'known', fraction: f }`, so 300/200 gives `known 1`, never `full`;
- null gives `unknown` when the job is `downloading`, else `empty`.

Rules, first match wins:
1. `done` or `skipped` → `none`.
2. `merging` → `merge`. 2 strands when `kind === 'media'` and `job.quality?.kind !== 'audio'`, else 1.
3. `live?.segments` is an array (`Array.isArray`) with at least one cell → `segments`.
   - `cells` is that array, unchanged and not copied; the tone is the job's; this holds whatever the state.
   - `connections` is `live.connections ?? null` while `downloading`, else null.
4. `kind === 'media'`, quality not audio, `live?.stream` is `video` or `audio` → `pair`.
   - Stream `video`: the video lane has the current fill and the job's tone. The audio lane is `empty`, with tone `waiting` when the job's tone is `active`, else the job's tone.
   - Stream `audio`: the video lane is `full` with the job's tone. The audio lane has the current fill and the job's tone.
5. Otherwise → `single` with the current fill and the job's tone.

| # | Input | Expected |
|---|---|---|
| 1 (P) | media, downloading, 50/200, stream `video` | pair: video known 0.25 active; audio empty waiting |
| 2 (P) | media, downloading, 30/40, stream `audio` | pair: video full active; audio known 0.75 active |
| 3 | media, downloading, 50/200, no live | single known 0.25 active |
| 4 (P) | media, downloading, 50/200, stream `muxed` | single known 0.25 active |
| 5 (P) | media, quality audio m4a, downloading, 10/40, stream `audio` | single known 0.25 active |
| 6 | media, merging, quality best | merge, strands 2 |
| 7 | media, merging, quality audio mp3 | merge, strands 1 |
| 8 (P) | file, downloading, 50/200, segments `[1,1,0.5,0]`, connections 8 | segments with those cells, connections 8, active |
| 9 | file, downloading, 50/200, no live | single known 0.25 active |
| 10 | file, downloading, 1536/null | single unknown active |
| 11 (P) | media, paused, 80/200, stream `video` | pair: video known 0.4 paused; audio empty paused |
| 12 | media, paused, 80/200, no live | single known 0.4 paused |
| 13 | file, failed, 50/200 | single known 0.25 failed |
| 14 | media, failed, 0/null | single empty failed |
| 15 | queued, 0/null | single empty waiting |
| 16 | queued, reason `retrying (2/3)`, 50/200 | single known 0.25 waiting |
| 17 | file, downloading, 300/200 | single known 1 active |
| 18 | file, downloading, 0/0 | single unknown active |
| 19 | done; skipped (each also with a live entry; those two variants are (P)) | none; none |
| 20 (P) | media, failed, 80/200, stream `video` | pair: video known 0.4 failed; audio empty failed |
| 21 (P) | media, queued, reason `retrying (1/3)`, 30/40, stream `audio` | pair: video full waiting; audio known 0.75 waiting |
| 22 (P) | file, paused, 50/200, segments `[1,0.5,0,0]`, connections 8 | segments with those cells, connections null, paused |
| 23 (P) | file, failed, 50/200, segments `[1,0]` | segments `[1,0]`, connections null, failed |
| 24 (P) | file, downloading, 50/200, segments `[]` | single known 0.25 active |
| 25 (P) | media, downloading, 5/null, stream `video` | pair: video unknown active; audio empty waiting |
| 26 (P) | media, quality audio m4a, downloading, 10/40, stream `video` | single known 0.25 active |
| 27 (P) | file, downloading, 50/200, stream `video` | single known 0.25 active |
| 28 | file, queued, 0/100 | single known 0 waiting |
| 29 | media, probing, 50/200, no live | single known 0.25 waiting |
| 30 | file, merging | merge, strands 1 |
| 31 (P) | media, merging, stream `audio`, segments `[1]` | merge, strands 2 |
| 32 (+)(P) | media, downloading, 50/200, `makeLive()` (all three null) | single known 0.25 active |
| 33 (+)(P) | media, downloading, 50/200, segments `[1,0]`, stream `video` | segments `[1,0]`, connections null, active (rule 3 before rule 4) |
| 34 (+)(P) | file, downloading, 50/200, segments `[0.5]`, connections null | segments `[0.5]`, connections null, active |
| 35 (+)(P) | file, queued, 50/200, segments `[1,0]`, connections 4 | segments `[1,0]`, connections null, waiting |
| 36 (+)(P) | media, quality `{ kind: 'max', height: 720 }`, downloading, 50/200, stream `video` | pair: video known 0.25 active; audio empty waiting |
| 37 (+) | media, quality `{ kind: 'max', height: 720 }`, merging | merge, strands 2 |
| 38 (+)(P) | media, probing, 0/null, stream `audio` | pair: video full waiting; audio empty waiting |
| 39 (+)(P) | media, queued, 0/null, stream `video` | pair: video empty waiting; audio empty waiting |
| 40 (+) | media, paused, 0/null, no live | single empty paused |
| 41 (+) | file, downloading, −5/200 | single known 0 active |
| 42 (+)(P) | media, downloading, 50/200, stream `'subs' as unknown as StreamRole` | single known 0.25 active |
| 43 (+) | media with `quality: null`, merging; the same, downloading 50/200, stream `video` (the second half is (P)) | merge, strands 2; pair as row 1 |
| 44 (+) | file, downloading, `NaN`/200 | single unknown active |
| 45 (+)(P) | file, downloading, 50/200, segments `[1, 0]`, `connections: undefined as unknown as null` | segments `[1,0]`, connections null, active |
| 46 (+) | file, downloading, 50/`Infinity` (OD-2) | single unknown active |

Assertions: `toEqual` on the whole model; the fractions are plain quotients. (+) The job and the entry are unchanged after the call.

### 5.3 `summary` (`model/summary.ts`, `tests/renderer/summary.test.ts`)

A job has a known size when `bytesTotal` is not null, finite and above 0, and `bytesDone` is finite (OD-2). A job's counted speed is its `speed` when that is finite and ≥ 0, else 0 (OD-2).

- `speed`: sum of the counted speed over jobs in `downloading` only.
- `active`: count in `probing`, `downloading`, `merging`.
- `remaining`: counted jobs are `queued`, `probing`, `downloading`.
  - `bytes` is the sum of `max(0, total − done)` over counted jobs with a known size.
  - `remaining` is null when no counted job has a known size.
  - `approx` is true when a counted job is media or has no known size.
- `eta`: looks at jobs in `downloading` only.
  - Null when no downloading job has a known size, or when `speed` is not above 0. The architecture says "`speed` is 0"; the guarded sum is never negative or `NaN`, so the two are the same.
  - Otherwise `seconds = Math.ceil(B / speed)`, where `B` is the sum of `max(0, total − done)` over downloading jobs with a known size.
  - `approx` is true when a downloading job is media or has no known size.

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
| 19 (+) | media paused 10/40 MB only | as #1 |
| 20 (+) | media downloading 10/40 MB at speed 0 only | speed 0, active 1, remaining 30 MB approx, eta null |
| 21 (+) | file probing 0/100 bytes with speed 700 left over | speed 0, active 1, remaining 100 bytes exact, eta null |
| 22 (+) | file queued 0/100 bytes, reason `retrying (1/3)`, speed 700 left over | speed 0, active 0, remaining 100 bytes exact, eta null |
| 23 (+) | file downloading 0/10 bytes at `NaN` (OD-2) | speed 0, active 1, remaining 10 bytes exact, eta null |
| 24 (+) | file downloading −5/10 bytes at 3 B/s | remaining 15 bytes exact, eta 5 s exact (a finite negative count is outside OD-2: the count is not clamped here, only the difference is floored at 0) |
| 25 (+) | #2 listed twice (the same object twice) | speed 10 MB/s, active 2, remaining 300 MB exact, eta 30 s exact |
| 26 (+) | #2 plus file downloading 0/100 MB at speed −5 (OD-2) | speed 5 MB/s, active 2, remaining 250 MB exact, eta 50 s exact |
| 27 (+) | #2 plus file downloading 0/100 MB at speed `Infinity` (OD-2) | speed 5 MB/s, active 2, remaining 250 MB exact, eta 50 s exact |
| 28 (+) | #2 plus file downloading `NaN`/100 MB at 1 MB/s (OD-2) | speed 6 MB/s, active 2, remaining 150 MB approx, eta 25 s approx (as #10) |
| 29 (+) | file downloading 50/`Infinity` bytes at 1 B/s only (OD-2) | speed 1, active 1, remaining null, eta null |

Assertions: `toEqual` on the whole object where every field is stated; on the named fields otherwise. All figures are whole numbers of bytes or seconds, so no `toBeCloseTo`.

### 5.4 `filterCounts` (`format.ts`, `tests/renderer/listModels.test.ts`)

Each count is the number of jobs for which `matchesFilter(job, filter)` is true (`format.ts:188-201`). The result is built as a literal with the five keys, so the type checks that none is missing, and each job is tested through `matchesFilter` itself. No state list is repeated.

| Jobs | Expected |
|---|---|
| `[queued, downloading, merging, paused, done, failed, skipped]` | `{ all: 7, downloading: 3, paused: 1, done: 1, failed: 2 }` |
| `[probing]` | `{ all: 1, downloading: 1, paused: 0, done: 0, failed: 0 }` |
| `[]` | all five zero |
| (+) a playlist of three members (`groupId: 'g1'`): done, done, queued, plus one lone paused job | `{ all: 4, downloading: 1, paused: 1, done: 2, failed: 0 }` (jobs, not playlists) |
| (+) any of the above | `Object.keys(result).sort()` equals `['all', 'done', 'downloading', 'failed', 'paused']` |
| (+) property over the eight states | for each filter, the count equals `jobs.filter((j) => matchesFilter(j, f)).length` |

### 5.5 `groupView` (`format.ts`, `tests/renderer/listModels.test.ts`)

- `done`, `total` and `percent` are `groupSummary(members)` (`format.ts:225-230`): `groupView` calls it and does not repeat the rule.
- `skipped`: the number of `skipped` members.
- `speed`: sum over `downloading` members of `speed` when it is finite and ≥ 0, else 0 (OD-2). For every value main can send this is today's `GroupRow.tsx:20`.
- `canPause`: a member is `queued`, `probing` or `downloading` (`GroupRow.tsx:21`).
- `canResume`: a member is `paused` (`GroupRow.tsx:22`).
- `unfinished`: a member is not `done`, `skipped` or `failed` (`GroupRow.tsx:23`).

| Members | Expected |
|---|---|
| done, done, downloading at 1000, skipped | done 2, total 3, skipped 1, percent 67, speed 1000, canPause, not canResume, unfinished |
| skipped, skipped | done 0, total 0, skipped 2, percent 0, speed 0, nothing offered, not unfinished |
| paused, done | canResume, not canPause, unfinished |
| merging only (speed 500 left over) | speed 0, not canPause, not canResume, unfinished |
| done, failed | not canPause, not canResume, not unfinished |
| (+) `[]` | done 0, total 0, skipped 0, percent 0, speed 0, all three flags false |
| (+) paused (speed 300 left over), downloading at 1000, downloading at 500 | speed 1500, canPause, canResume, unfinished |
| (+) queued only; probing only | each: canPause, not canResume, unfinished, speed 0 |
| (+) done, done | done 2, total 2, percent 100, not unfinished |
| (+) paused with `interrupted: true` | canResume true (the flag mirrors today's rule; main refuses the resume, as today) |
| (+) downloading at 1000, downloading at `NaN`, downloading at −5 (OD-2) | speed 1000 |
| (+) property, for each row above | `done`, `total`, `percent` equal `groupSummary(members)` |

Rows 1, 2 and (+) `[]` use `toEqual` on the whole object.

### 5.6 `acceptThumbnail`, `rememberThumb`, `thumbFor` (`model/thumbnail.ts`, `tests/renderer/thumbnail.test.ts`)

`acceptThumbnail(raw)` returns the parsed `href`, or null. It accepts a value that passes all of these, in this order:
1. `typeof raw === 'string'`.
2. `raw === raw.trim()`.
3. `raw.length <= 2048`, counted on the raw string.
4. `new URL(raw)` does not throw (in a `try`/`catch`; no base URL is given).
5. `protocol === 'https:'`, `username === ''` and `password === ''`.
6. The parsed `hostname` is none of:
   - `localhost` or `localhost.`;
   - a name ending in `.localhost` or `.localhost.`;
   - a name starting with `[`;
   - a match of `^\d+\.\d+\.\d+\.\d+$`.

The host rule runs on the parsed `hostname`, which is already lower-case and in dotted form.

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
| (+) `new String('https://example.com/t.jpg')`, `['https://example.com/t.jpg']` | null |
| (+) `https://example.com` | `https://example.com/` |
| (+) `https://LOCALHOST/t.jpg`, `https://a.localhost./t.jpg`, `https://A.B.LocalHost/t.jpg` | null |
| (+) `https://127.0.0.1./t.jpg`, `https://[::ffff:1.2.3.4]/t.jpg`, `https://1.2.3/t.jpg` | null |
| (+) `https://1.2.3.4.example.com/t.jpg` | the same URL (a name, not an address) |
| (+) `https://notlocalhost/t.jpg`, `https://localhost.example.com/t.jpg` | the same URL each |
| (+) `https://example.com:8443/t.jpg` | the same URL (the port is not restricted) |
| (+) `ftp://example.com/t.jpg`, `blob:https://example.com/1`, `wss://example.com/t` | null |
| (+) `'https://exam\nple.com/t.jpg'`, `'https://example.com/a\tb.jpg'` | `https://example.com/t.jpg`; `https://example.com/ab.jpg` (see Q8) |
| (+) `'https://example.com/t.jpg '` (trailing space) | null |

#### Probe PU-1: what the URL parser returns

Ten rows of the table depend on how `new URL()` rewrites its input. The orchestrator ran probe PU-1 on 2026-11-24 before the freeze. Its record is `.superpowers/design/probe-pu1.md` (git-ignored).

- Runtimes probed, on Windows 10.0.26100, one process each, probe files outside the repository:
  - Node v24.14.1, the Node that runs vitest on this machine;
  - the renderer of Electron 45.4.1 (Chrome 156.0.8078.100), `sandbox: true`, `contextIsolation: true`, which is where `acceptThumbnail` runs in the app.
- Result: no input threw, and both runtimes gave the same `protocol`, `hostname` and `href` for every input. Every row holds as the table above states it.

| Input | `hostname` | `href` | Rule that decides |
|---|---|---|---|
| `https://127.0.0.1./t.jpg` | `127.0.0.1` | `https://127.0.0.1/t.jpg` | dotted address → null |
| `https://[::ffff:1.2.3.4]/t.jpg` | `[::ffff:102:304]` | `https://[::ffff:102:304]/t.jpg` | starts with `[` → null |
| `https://1.2.3/t.jpg` | `1.2.0.3` | `https://1.2.0.3/t.jpg` | dotted address → null |
| `'https://exam\nple.com/t.jpg'` | `example.com` | `https://example.com/t.jpg` | accepted, the parsed `href` |
| `'https://example.com/a\tb.jpg'` | `example.com` | `https://example.com/ab.jpg` | accepted, the parsed `href` |
| `https://2130706433/t.jpg` | `127.0.0.1` | `https://127.0.0.1/t.jpg` | dotted address → null |
| `https://0x7f.0.0.1/t.jpg` | `127.0.0.1` | `https://127.0.0.1/t.jpg` | dotted address → null |
| `https://localhost./t.jpg` | `localhost.` | `https://localhost./t.jpg` | `localhost.` → null |
| `https://a.localhost./t.jpg` | `a.localhost.` | `https://a.localhost./t.jpg` | ends in `.localhost.` → null |
| `HTTPS://EXAMPLE.com/t.jpg` | `example.com` | `https://example.com/t.jpg` | accepted, the parsed `href` |

Every row had `protocol` `https:`.

Coverage:
- Probed: Node v24.14.1 and the Electron 45.4.1 renderer.
- Covered only by CI: the Node versions of the CI matrix, `node: [22, 24]` on `windows-latest` (`.github/workflows/ci.yml:18,22`). Node 22 was not probed, and CI's Node 24 may be another patch release than v24.14.1.
- If a thumbnail test fails on a CI Node, the row is reported to the owner. The rule and the frozen table are not adjusted by a lane.

#### `rememberThumb` and `thumbFor`

`rememberThumb(map, url, thumb, cap = 200)`:
- `accepted = acceptThumbnail(thumb)`. When it is null, nothing changes.
- Otherwise `map.delete(url)`, then `map.set(url, accepted)`, so the entry becomes the newest (a `Map` keeps insertion order).
- Then, while `map.size > limit`, delete the first key. `limit` is `cap` when it is an integer ≥ 1, else 200 (+). The fallback is silent: no throw and no log (orchestrator decision OD-4).
- It changes the map in place and returns nothing.

`thumbFor(map, job)` returns `map.get(job.url) ?? null`.

| Case | Expected |
|---|---|
| remember a valid thumb, then `thumbFor` a job with that url | the accepted href |
| remember `http://…` | map unchanged; `thumbFor` null |
| cap 2: remember a, b, c | a gone; b and c present |
| cap 2: remember a, b, a again, c | b gone; a and c present |
| `thumbFor` a job whose url was never stored | null |
| (+) remember `HTTPS://EXAMPLE.com/t.jpg` | the stored value is `https://example.com/t.jpg` |
| (+) remember a valid thumb under `u`, then an invalid one under `u` | the first value is kept |
| (+) remember thumb 1 under `u`, then thumb 2 under `u` | size 1, value is thumb 2 |
| (+) cap 2: a, b, then a again with another thumb, then c | `[...map.keys()]` is `[a, c]` |
| (+) default cap: 201 different urls | size 200; the first is gone; the 2nd and the 201st are present |
| (+) cap 0, cap 1.5, cap `NaN`: 3 urls each | size 3 (the default limit applies), and no call throws |
| (+) cap 1: a, b | only b |
| (+) two jobs with the same `url` | `thumbFor` gives the same href for both |

### 5.7 `finishedEvents` (`model/finished.ts`, `tests/renderer/finished.test.ts`)

`prev` is the last snapshot the page received, starting from `{ jobs: [], groups: [] }`; it is never null. Finished means `done`, `failed` or `skipped`. Members of a playlist are the jobs with its `groupId`.

- Job event: a job with `groupId === null` that is present in `prev` (by `id`) with a state other than `done`, and is `done` in `next`. `job` is the object from `next`.
- Group event, for a playlist `G` listed in `next.groups`, when all of these hold:
  - in `next`, `G` has at least one member, every member is finished, and at least one is `done`;
  - `G` had at least one member in `prev`;
  - in `prev` some member of `G` was not finished, or `G` has more `done` members in `next` than in `prev`.
- The event's `group` is the object from `next.groups`. `done`, `failed` and `skipped` count `next`'s members.
- A playlist member never gives a job event.
- Order: the order of `next.jobs`, a playlist at its first member.
- (+) A job whose `groupId` names a playlist that is not in `next.groups` gives no event of either kind.
- (+) Duplicates, which main never sends because ids are `randomUUID()` (`queue.ts:207,223,235,245`), see Q10:
  - the first occurrence of a job `id` in `prev.jobs` is the one compared;
  - the first lone occurrence of an `id` in `next.jobs` is the only one that can give a job event;
  - the first entry of an `id` in `next.groups` is the one used.
- (+) `prev` and `next` are not changed. `prev.groups` is not read: "had a member in `prev`" is about `prev.jobs`.
- One pass over each list, with maps by `id` and by `groupId`. It runs once per snapshot, up to four times a second (architecture section 2, push rate).

Every group event below states all three counts. Member lists are written `prev` → `next`, in `jobs` order.

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
| last unfinished member → done: `[done, queued]` → `[done, done]` | one group event, done 2, failed 0, skipped 0; no job event |
| last unfinished member → failed, another member done: `[done, queued]` → `[done, failed]` | group event, done 1, failed 1, skipped 0 |
| last unfinished member → skipped, another member done: `[done, queued]` → `[done, skipped]` | group event, done 1, failed 0, skipped 1 |
| last unfinished member → failed, the rest failed or skipped | none |
| every member skipped | none |
| last unfinished member removed (cancel), another member done: `[done, queued]` → `[done]` | group event, done 1, failed 0, skipped 0 |
| last unfinished member removed, only failed members left | none |
| last member removed, playlist gone from `next` | none |
| all finished in `prev` (done 1, failed 1); the failed one is done in `next` | group event, done 2, failed 0, skipped 0 |
| all finished in both, a done member removed | none |
| playlist absent in `prev`, complete in `next` | none |
| (+) lone A paused → done | job A |
| (+) lone A downloading → done: `events[0].job` | is `next`'s object (`toBe`), with state `done` |
| (+) last member → done: `events[0].group` | is `next.groups[0]` (`toBe`) |
| (+) `next.jobs` is `[lone A, member m1, lone B, member m2]`; A and B downloading → done, m1 done in both, m2 queued → done | job A, group g1 (done 2, failed 0, skipped 0), job B |
| (+) `next.jobs` is `[m1 (g1), n1 (g2), m2 (g1), n2 (g2)]`; m1 and n1 done in both, m2 and n2 queued → done | group g1, then group g2, each done 2, failed 0, skipped 0 |
| (+) members `[done, queued]` → `[done, done]`, but `next.groups` is `[]` | none |
| (+) playlist of one member, queued → done | group event, done 1, failed 0, skipped 0 |
| (+) members `[done, skipped, queued]` → `[done, skipped, done]` | group event, done 2, failed 0, skipped 1 |
| (+) members `[done, queued]` → `[done, paused]` | none |
| (+) all finished in both, unchanged (done 1, failed 1) | none |
| (+) `prev.groups` is `[]` but `prev.jobs` holds the members; `[done, queued]` → `[done, done]` | group event, done 2, failed 0, skipped 0 |
| (+) `prev.jobs` lists A twice (downloading, then done); `next` has A done | job A (the first occurrence counts) |
| (+) `next.jobs` lists lone A twice, done; `prev` has A downloading | one job event |
| (+) both arguments compared with a `structuredClone` taken before the call | unchanged |

### 5.8 `banners` (`banners.ts`)

Ids, order, text and `action` are as today (`banners.ts:19-27`). Each banner gains:

| Banner | `action` | `tone` | `opens` |
|---|---|---|---|
| engine | `'retryEngines'` | `bad` | null |
| server, `portBusy` | null | `warn` | `'settingsBrowser'` |
| server, `error` | null | `warn` | null |
| save | null | `bad` | null |
| cutOff | `'confirmStraysGone'` | `warn` | null |

Added assertions (+):
- All four at once: the tones are `['bad', 'warn', 'bad', 'warn']` and `opens` is `[null, 'settingsBrowser', null, null]`.
- Every banner has exactly the keys `action`, `id`, `opens`, `text`, `tone` (`Object.keys(b).sort()`).
- `opens` is non-null only for the `portBusy` banner, in every engine state and with or without a save error or a cut-off job.
- The `portBusy` banner's `action` is null: `opens` is not a `BannerAction`.

The last two assertions are also the tests of the reworded JSDoc sentence (section 3).

### 5.9 `statusParts` (`format.ts`)

A paused job's parts are, in this order: the percent part (`t.paused` or `t.pausedAt(pct)`), then `t.waitingForCheck` when `interrupted`, then `t.cannotResume` when `resumable` is false. Every other state is as today (`format.ts:88-110`).

Rows added to the both-languages table of `tests/renderer/status.test.ts`:

| Job | EN | AR |
|---|---|---|
| paused, 50/200, `resumable: false` | `['paused 25%', 'cannot resume']` | ``[`متوقف مؤقتًا ${fsi('25%')}`, 'لا يدعم الاستئناف']`` |
| paused, 50/200, `interrupted: true`, `resumable: false` | `['paused 25%', 'waiting for a check', 'cannot resume']` | ``[`متوقف مؤقتًا ${fsi('25%')}`, 'في انتظار الفحص', 'لا يدعم الاستئناف']`` |
| paused, 50/200, resumable (already at line 24) | `['paused 25%']` | unchanged |
| (+) paused, 0/null, `resumable: false` | `['paused', 'cannot resume']` | `['متوقف مؤقتًا', 'لا يدعم الاستئناف']` |

(+) One more case: for `queued`, `probing`, `merging`, `done`, `failed` and `skipped`, `statusParts(makeJob({ state, resumable: false }))` equals `statusParts(makeJob({ state }))`.

`statusText` follows, because it joins the parts (`format.ts:114-116`): `'paused 25% · waiting for a check · cannot resume'`.

`allowedVerbs` is not changed. A paused job that is not cut off still gets `['resume', 'cancel']` (`format.ts:214`), whatever `resumable` is. Section 8 names the resulting pairing for the owner.

### 5.10 `sameRow` (`model/rowEqual.ts`, `tests/renderer/rowEqual.test.ts`)

`sameRow(a, b, liveA, liveB)` is true when `a` equals `b` and `liveA` equals `liveB`, by this value comparison:
- two values that are `Object.is`-equal are equal;
- two arrays are equal when they have the same length and equal elements in order;
- two non-array objects are equal when, over the union of their own enumerable keys, each key's two values are equal (a key one side lacks reads as `undefined`);
- anything else (different types, array against object, `null` against an object, entry against `undefined`) is not equal.

The helper takes `unknown`, not `any` (`eslint.config.mjs:7` applies the typescript-eslint recommended rules). It is not exported.

- Comparing every key means a `Job` field added later is covered with no change here.
- The live entry is compared the same way, so a fourth `JobLive` field from a C7 amendment is covered too. This is a superset of 7.10's "the same three fields" (section 4, notes).

Tests:
- `sameRow(job, structuredClone(job), entry, structuredClone(entry))` is true, for a job with `quality: { kind: 'max', height: 720 }`, `subtitleLangs: ['en', 'ar']` and an entry with segments `[1, 0.5]`.
- `sameRow(job, job, undefined, undefined)` is true.
- Changing any one field of `makeJob()` in turn gives false.
  - The test loops over `Object.keys(makeJob())` and takes each key's changed value from a map in the test file.
  - A key with no changed value in the map fails the test, so a new `Job` field cannot go untested.

| Field | Changed to | Field | Changed to |
|---|---|---|---|
| `id` | `'other'` | `index` | `3` |
| `groupId` | `'g1'` | `bytesDone` | `1` |
| `kind` | `'file'` | `bytesTotal` | `10` |
| `url` | `'https://example.com/other'` | `speed` | `1` |
| `title` | `'Other'` | `eta` | `5` |
| `state` | `'paused'` | `actualHeight` | `720` |
| `reason` | `'disk full'` | `resumable` | `false` |
| `quality` | `{ kind: 'audio', format: 'mp3' }` | `attempts` | `1` |
| `subtitleLangs` | `['en']` | `createdAt` | `value + 1` |
| `dir` | `'D:\\Other'` | `interrupted` | `true` |
| `baseName` | `'Other'` | `sourceHeight` | `1080` |
| `fileName` | `'a.mp4'` | | |

- Nested changes give false:
  - `quality` `{ kind: 'max', height: 720 }` against `{ kind: 'max', height: 1080 }`;
  - `{ kind: 'best' }` against `{ kind: 'max', height: 720 }`;
  - `subtitleLangs` `['en', 'ar']` against `['en', 'fr']`, against `['en']`, and against `['ar', 'en']`.
- Live:
  - an entry against `undefined` gives false, in both argument orders;
  - segments `[1, 0]` against `[1, 0.5]` gives false.
- (+) More live rows:
  - `stream` `'video'` against `'audio'` gives false;
  - `connections` 8 against 9 gives false;
  - segments `null` against `[]` gives false; `[1]` against `[1, 0]` gives false;
  - `makeLive()` against `undefined` gives false (see Q5).
- (+) A job with an extra key (`{ ...job, engine: 'x' }` cast to `Job`) against the job without it gives false; against a clone that also has it, true.
- (+) `{ ...job, eta: NaN }` against its clone gives true (`Object.is`).

### 5.11 `settingsSection.ts` (`tests/renderer/settingsSection.test.ts`)

- `SETTINGS_SECTIONS` equals `['appearance', 'downloads', 'browser', 'tools']`, in that order: the order of C5's headings.
- The type is checked by the compiler in one statement whose value is then read, so `no-unused-vars` (`eslint.config.mjs:7`) does not fire:

  ```ts
  const all: SettingsSection[] = ['appearance', 'downloads', 'browser', 'tools'];
  expect(all).toEqual([...SETTINGS_SECTIONS]);
  ```

## 6. Tests

| File | Holds |
|---|---|
| `tests/progress.test.ts` (new) | 5.1 |
| `tests/renderer/lanes.test.ts` (new) | 5.2 |
| `tests/renderer/summary.test.ts` (new) | 5.3 |
| `tests/renderer/listModels.test.ts` (new) | 5.4, 5.5 |
| `tests/renderer/thumbnail.test.ts` (new) | 5.6 |
| `tests/renderer/finished.test.ts` (new) | 5.7 |
| `tests/renderer/rowEqual.test.ts` (new) | 5.10 |
| `tests/renderer/settingsSection.test.ts` (new) | 5.11 |
| `tests/renderer/banners.test.ts` (rewritten cases) | 5.8, engine, save and cut-off banners |
| `tests/renderer/bannersServer.test.ts` (rewritten cases) | 5.8, server banner and the order |
| `tests/renderer/status.test.ts` (rows added) | 5.9 |
| `tests/helpers.ts` | `makeLive` |

- All match the include pattern `tests/**/*.test.ts` (`vitest.config.mts:6`) and run in `node`.
- No test imports a `.tsx` file.
- No test changes the language except `status.test.ts`, which already resets it (`status.test.ts:13`).
- The banner tests expect English text and never set a language, as today.

## 7. Superseded tests

Every line number the architecture gives was checked against the files; all match.

`tests/renderer/banners.test.ts`: each expected object gains `tone` and `opens`.

| Lines | Case | New expected fields |
|---|---|---|
| 26-28 | engine error with Retry | `tone: 'bad', opens: null` |
| 32 | engine error, empty text | `tone: 'bad', opens: null` |
| 43-45 | save error | `tone: 'bad', opens: null` |
| 53 | save error, empty text | `tone: 'bad', opens: null` |
| 59 | save error in every engine state | `tone: 'bad', opens: null` |
| 64 | the `cutOff` constant (used at 76, 81, 85, 91) | `tone: 'warn', opens: null` |
| 102-106 | order engine, save, cut-off | `bad`, `bad`, `warn`; `opens: null` on each |

Untouched there: lines 21-22, 38, 49, 67, 72 (expect `[]` or a boolean) and 101, 110-114 (ids only).

`tests/renderer/bannersServer.test.ts`:

| Lines | Case | New expected fields |
|---|---|---|
| 25-27 | `portBusy` | `tone: 'warn', opens: 'settingsBrowser'`; the title drops "and no button" |
| 32 | `portBusy` names the port | `tone: 'warn', opens: 'settingsBrowser'` |
| 37 | `error`, message as it is | `tone: 'warn', opens: null` |
| 41 | `error`, empty message | `tone: 'warn', opens: null` |
| 57-59 | busy, listening, busy again | `tone: 'warn', opens: 'settingsBrowser'` |
| 67-72 | all four | engine `bad`/null; server `warn`/`'settingsBrowser'`; save `bad`/null; cutOff `warn`/null |
| 90-92 | server banner in every engine state | `tone: 'warn', opens: 'settingsBrowser'` |
| 48-52 | "the banner has no button…" | The assertion still passes (`action` stays null). Renamed to "the server banner has no BannerAction: its button, if any, comes from `opens`". Cases added: `portBusy` has `opens: 'settingsBrowser'`; `error` has `opens: null`. |

Untouched there: lines 45, 55-56, 66, 76, 80, 84, 98.

Why they break: `toEqual` ignores a property that is `undefined`, but `tone: 'bad'` and `opens: null` are neither, so each old literal no longer matches.

Other existing tests, checked for breakage:
- `statusParts`: no existing test has a paused job with `resumable: false`.
  - `resumable: false` appears only at `format.test.ts:91` and `status.test.ts:21`, both `downloading`.
  - `format.test.ts:80-117` and `status.test.ts:16-64` therefore pass unchanged.
- `groupSummary` (`format.test.ts:163-178`) and `matchesFilter` (`format.test.ts:119-132`): the functions are not changed.
- `tests/renderer/columns.test.ts` and `size.test.ts` use `speedText`, `etaText`, `addedText` and `sizeParts`: not changed.
- `tests/renderer/strings.test.ts`: no string is added.
- Snapshot equality tests in `tests/jobs/**`: `live` is optional and nothing sets it, so they hold. Main's saved shape is not touched (architecture L7, L8).
- Superseded history, not edited: `phase1-app.md:510` (the status parts) and the A1 sentence "the server banner has no button" (`phase2-architecture.md:285`, as the architecture cites). The architecture lists both.

## 8. D8: the app after C2 alone

- Usable: no component, style, string, main-process or e2e file changes. The new functions and types have no caller in `src/`.
- `App.tsx` compiles as it is (OD-1). It reads only `id`, `text` and `action` from each banner (`App.tsx:95`), and nowhere builds a `Banner` literal. `banners.ts:21-25` is the only place that builds one.
- One visible change, which the architecture lists in its section 3 ("`statusParts` says 'cannot resume' for a paused non-resumable job too (C2)"):
  - a paused download from a server without range support now shows "paused 25% · cannot resume" in the row and its tooltip (`JobRow.tsx:63-69`);
  - the state is reachable: a file job takes `resumable` from its probe (`queue.ts:218`) and `downloading → paused` is allowed (`state.ts:33`);
  - the pairing the owner sees (orchestrator decision OD-5): that row reads "paused 25% · cannot resume" next to an enabled Resume button, because `allowedVerbs` still offers Resume for a paused job that is not cut off (`format.ts:214`) and C2 does not change it. The architecture decided the text; the pairing is shown to the owner at the C2 commit.
  - Nothing else on screen changes. So "no visuals" in the architecture's C2 title holds for everything but this one text.
- e2e: no hook of the architecture's section 8 is touched, and no check reads "cannot resume" (no match under `e2e/`). The architecture schedules `e2e:real` from C3; C2 does not need a run.
- Gates, run by the orchestrator, serially, from the worktree root (`package.json:16-18`):

  ```bash
  npm run typecheck
  npm run lint
  npm test
  ```

- Extra checks. Each prints nothing. The third runs before the commit, while the change is still in the working tree, so it also shows a new untracked file:

  ```bash
  # no renderer or shared import from the main process
  grep -rnE "from '[./]*/main/" src/renderer src/shared
  # models return no text
  grep -rnE "from '\.\./(strings|format)'" src/renderer/src/model
  # C2 leaves components alone (run after C1's commit; any line printed is then C2's)
  git status --porcelain -- src/renderer/src/App.tsx src/renderer/src/components src/renderer/src/styles.css src/main e2e
  ```

  `.ai/tools/git-safe.mjs` is not on this branch, and `git status` is not one of the commands it replaces.

- Riskiest functions for the orchestrator's adversarial read before review: `acceptThumbnail` (a gate on remote input), `finishedEvents` (it must match main's announcements) and `sameRow` (a wrong "true" leaves a stale row).

## 9. Edge cases

| Case | Behaviour | Where |
|---|---|---|
| `bytesTotal` null, 0 or negative | Size unknown: `streamFraction` null; lane `unknown` while downloading, else `empty`; left out of `remaining` and `eta`. | 5.1, 5.2, 5.3 |
| `bytesDone` above `bytesTotal` | Fraction 1 (`known 1`, never `full`); remaining 0. | 5.1, 5.2 row 17, 5.3 row 15 |
| Negative `bytesDone` (finite) | Fraction 0. `summary` does not clamp the count, only the difference. Outside OD-2. Main never stores one (`queue.ts:29-30,469`; `validate.ts:19,178`). | 5.1, 5.3 row 24 |
| Non-finite `bytesDone` or `bytesTotal` (`NaN`, `Infinity`) | Not known, as a null total (OD-2): `streamFraction` null; lane `unknown` while downloading; the job has no known size in `summary`. Main never stores one (`queue.ts:29-30,472`; `validate.ts:180`). | 5.1; 5.2 rows 44, 46; 5.3 rows 28, 29 |
| Non-finite or negative `speed` | Adds 0 to `summary.speed` and `groupView.speed` (OD-2), so neither total is ever `NaN` or negative. | 5.3 rows 23, 26, 27; 5.5 |
| Speed left over on a job that is not downloading | Ignored by `summary.speed` and `groupView.speed`. `merging` keeps its last speed (architecture section 2). | 5.3 rows 8, 21, 22; 5.5 |
| Empty arrays | `summary([])` is idle; `filterCounts([])` all zero; `groupView([])` all zero and false; `finishedEvents` of two empty snapshots is `[]`. | 5.3 to 5.7 |
| Playlist with every member skipped | `groupView`: `0 / 0`, 0%, skipped count, nothing offered, not unfinished. `finishedEvents`: no event. | 5.5, 5.7 |
| Playlist absent from `next.groups` while members remain | No group event and no job event. `JobList` hides such members today too (`JobList.tsx:34-37`). | 5.7 |
| Playlist gone with its last member | No event. Main prunes an empty group in the same commit (`queue.ts:607`). | 5.7 |
| Duplicate ids | First occurrence wins; never two events for one id. `summary` and `filterCounts` count each listed job. | 5.7, 5.3 row 25 |
| Live entry with every field null, or no entry | Same as no live: `single` lane; `wholeJobFraction` by rows 1 to 7, else null. | 5.1, 5.2 row 32 |
| Live entry on a finished or merging job | Ignored (rules 1 and 2). | 5.2 rows 19, 31 |
| `segments: []` | Not a map: falls to the next rule. | 5.2 row 24 |
| A `stream` value outside the three roles | Not known: one lane; whole share null. | 5.1, 5.2 row 42 |
| Media job with `quality: null` | Counts as "not audio". | 5.2 row 43 |
| Segment cells outside 0..1, or more than 24 | Passed on unchanged. L1 makes main the only validator (C7). | 5.2 |
| Thumbnail on a loopback, IP or credentialed URL, or not https | Refused; C6 shows the fallback tile. | 5.6 |
| A `cap` that is not an integer ≥ 1 | The limit is 200, silently (OD-4). | 5.6 |
| The same URL added twice | Both jobs share the remembered thumbnail; the newer add replaces it. | 5.6 |
| A `Job` field added by another branch (A3) | `sameRow` covers it. The field-map test fails until that field gets a changed value, by design. | 5.10 |
| Paused, cut off and not resumable | Three status parts, in the fixed order. | 5.9 |

## 10. Boundary check

### With C1 (previous)

C1's plan says C1 and C2 exchange no value (its section 9). Confirmed:
- C1 does not touch `Job`, `Snapshot`, strings, `format.ts` or `banners.ts`. C2 reads no token, palette, icon or logo.
- Shared folder `src/renderer/src/model/`: C1 creates `contrast.ts` and `icons.ts`; C2 creates `lanes`, `summary`, `finished`, `thumbnail`, `rowEqual`, `settingsSection`. No name clash.
- Shared folder `src/shared/`: C1 creates `palette.ts` and `logo.ts`; C2 creates `progress.ts`. No clash.
- `tests/renderer/`: C1 creates `contrast`, `palette` and `icons` tests. No clash with section 6.
- `App.tsx`: C1 edits lines 109-111 and adds an `Icon` import. C2 edits nothing there (OD-1). C1's boundary row says C2 edits `App.tsx` "only so the wider `Banner` compiles"; OD-1 records the deviation, and no value crosses.
- C1's text tests read `styles.css`, `appearance.ts`, `Icon.tsx`, `App.tsx` and `components/*.tsx` (its 7.2 and 7.4). C2 changes none of them.

### With C3 (next)

| Value | Meaning in C2 | C3's reading |
|---|---|---|
| `filterCounts(jobs)` | Jobs per filter by `matchesFilter`; a playlist member counts once; always all five keys. | Rail counts. `downloading` includes queued jobs, so it can exceed `summary.active`. |
| `summary.speed` | Bytes per second, summed over `downloading` jobs only; always finite and ≥ 0 (OD-2). | The strip's Speed. Today's figure sums every job's `speed` (`App.tsx:77`), merging left-overs included, so the number can differ slightly when C3 swaps it. `formatSpeed(0)` is `''` (`format.ts:17-19`); what an idle strip shows is C3's choice. |
| `summary.active` | Count of probing, downloading, merging. | "Running". |
| `summary.remaining` | Bytes still to fetch over queued, probing and downloading jobs with a known size. Null when none has one. `approx` when a counted job is media or has no known size. | `~` when `approx`, `—` when null. Formatting stays in `format.ts` (D3). |
| `summary.eta` | Whole seconds until the downloading jobs with a known size finish at the total downloading speed. Null when none has a known size or the speed is not above 0. | The label must say "running downloads", not the whole queue. |
| `Banner.tone` | `bad` for engine and save, `warn` for server and cut-off. A code, not a colour. | Icon and colour. The text stays the first `span`. |
| `Banner.opens` | `'settingsBrowser'` on the `portBusy` banner only, else null. Not a `BannerAction`. | A button that sets `settingsAt = { section: 'browser' }`. It must not go through `runBannerAction`, which calls `window.fetchly[action]` (`App.tsx:53-62`). The code-to-section mapping is C3's. |
| `Banner.action` | Unchanged; null for the server banner. | As today. |
| `SettingsSection` | The four ids. `'downloads'` has no heading until C5. | `initialSection` prop. |
| `App.tsx` | Not edited by C2 (OD-1). | C3 is the first component after C1 to edit it. |

### With C4

| Value | Meaning in C2 | C4's reading |
|---|---|---|
| `laneModel(job, live)` | The lane form for one row; `live` is the entry passed on unchanged (D10). | Rows render from it only. |
| `Fill` `known` | `fraction` in 0..1, the current stream's share. | `scaleX(fraction)`. |
| `Fill` `full` | An earlier stream that is complete (the video lane once audio runs). Never produced from a number. | A full lane. |
| `Fill` `unknown` | Running with no known size. | The static open-ended track; the state word carries the meaning (D1). |
| `Fill` `empty` | Nothing to show yet. | The empty-lane outline (`--field`, D5). |
| `Tone` | `active`, `waiting`, `paused`, `failed`: the job's, except the idle audio lane of a running pair, which is `waiting`. | Colour or hatch only. At most one perpetual animation per `active` row (D4). |
| `merge.strands` | 2 for a video job, 1 for an audio-only or file job. | The merge marker. |
| `segments.cells` | The stored array, unchanged and not validated. | C4 must not assume 0..1 or at most 24 beyond L1's promise; clamping in CSS is safe. It must not mutate the array. |
| `segments.connections` | The stored count while downloading, else null. A stalled job is still `downloading`, so its last count stays (Q7). | Null means "show no count". |
| `groupView` | `done`, `total`, `percent` as `groupSummary` (share of finished items, whole percent 0..100); `speed` in bytes per second, finite and ≥ 0; three flags with today's meaning. | Replaces `GroupRow.tsx:18-23`. `canResume` is true for a cut-off member too, as today. |
| `sameRow(a, b, liveA, liveB)` | Value equality of two jobs and two entries. It does not look at callbacks. | `React.memo`'s comparison. See the two notes below. |
| `statusParts` | The paused case can now have three parts. | The status cell may need the second line the architecture allows. |

Notes for C4 on `sameRow`:
- `JobRow` also takes `onError` (`JobRow.tsx:15-18`). `App` passes `setMessage`, which is stable (`App.tsx:116`); C4 must keep it stable or the memo hides a changed handler.
- `addedText` depends on today's date (`format.ts:61-72`). A memoised row that never changes keeps yesterday's time-of-day form after midnight. C4's plan decides whether that matters.

### With C6

| Value | Meaning in C2 | C6's reading |
|---|---|---|
| `finishedEvents(prev, next)` | The finishes main announces with `done ≥ 1`: a lone job that became done, and a playlist with nothing left and at least one done member. `prev` is never null. | Called once per received snapshot, before the state is set. C6 stamps `seenAt`. |
| `FinishedEvent.job`, `.group` | The objects from `next`. | The toast text and `thumbFor(map, event.job)`. |
| Group `done`, `failed`, `skipped` | Counts over `next`'s members. | Toast wording. `done` matches C11's `Finished.done` for a playlist. |
| `finished.ts` | Holds `finishedEvents` and `FinishedEvent` after C2. | C6 adds 7.11's exports to the same file and changes neither. |
| `acceptThumbnail(raw)` | The parsed `href` of an acceptable https URL, else null. | The only gate before `<img src>`. |
| `rememberThumb(map, url, thumb)` | Stores the accepted href under `url`; changes the map in place. | Called when a media add succeeds. |
| `thumbFor(map, job)` | Looks up `job.url`. | See the note below. |

Note for C6 on the key:
- The window probes with the typed link and passes the same string on (`UrlBar.tsx:21-25`).
- `AddDialog.tsx:46-47` passes its `url` prop straight to `window.fetchly.add`.
- The queue stores `req.url` as `job.url` (`queue.ts:170`).
- So the key matches unless the IPC handler rewrites the URL. That handler is the only part of the path not read for this plan; C6's plan confirms it.

### With C9

| Value | Meaning in C2 | C9's reading |
|---|---|---|
| `wholeJobFraction(job, live)` | The share of the whole job in 0..1, or null when not known. Not rounded. `live` is `snapshot.live?.[job.id]`. | `taskbarProgress` (7.5). A downloading job with null makes the bar indeterminate. |
| `1` | A `done` job, or a file at 100%. | `done` is not pending. C9 caps the mean at 0.99. |
| `MERGE_AT` | 0.98 for any merging job. | 7.5 rows 5 and 6. |
| `src/shared/progress.ts` | No DOM, no Node API, type imports only. | Imported from `src/main/taskbar.ts`. |

### With C7

- C7 fills `Snapshot.live`; C2 only declares it.
- An amendment of 5.1 or rows 7 to 11 of 5.2 touches `laneModel`, `wholeJobFraction`, `sameRow` and their tests only (D10). In this plan those are the (P) rows of 5.1 and 5.2, and the live rows of 5.10.
- `sameRow` compares every key of an entry, so a new `JobLive` field needs no change there.
- Q7's answer is taken before C7's plan freezes. Options (b) and (c) are C7 amendments (section 11).

## 11. Rules that drop stale data

- C2 has no clock-based rule. Nothing in C2 rejects a value as "future" or "too old", so there is no time tolerance to set.
- One rule drops a stored value by state: `laneModel` rule 3 gives `connections: null` as soon as the job is not `downloading` ("a stored count is stale once nothing runs", architecture 7.1).
  - The count disappears on the first snapshot that shows a state other than `downloading`. This is the frozen 7.1 rule, not a default chosen by C2.
  - A stall is the opposite case. A stalled job stays `downloading`, so rule 3 keeps its last count with no limit (L5).
- Both points are open questions for the owner (Q7, orchestrator decision OD-3). C2 implements the frozen rule as written and does not wait for the answer.

Q7, part 1: how long does the connection count stay once the job is no longer `downloading`?

| Option | Rule | Cost |
|---|---|---|
| (a) | As frozen: hidden on the first snapshot whose state is not `downloading`. | None. C2 implements this. |
| (b) | Kept until the live entry is removed. | A C7 amendment: `laneModel` rule 3 stops looking at the state, and C7's rule for removing an entry decides how long the count shows. Touches `laneModel` and its (P) rows only (D10). |
| (c) | Kept for N seconds after the job stops downloading. The owner chooses N and the clock (main's or the window's). | A C7 amendment, and the largest one: neither `Job` nor `JobLive` carries a "stopped at" time, so it needs a new `JobLive` field or a `now` argument to `laneModel`. No value of N is proposed here, and none defaults to zero. |

Q7, part 2, asked separately: should a stalled job's count ever be hidden? Today's rules keep it as long as the job is `downloading`. Hiding it needs a rule for "stalled" and, if it is time-based, a tolerance the owner sets.

Deadline: the answer is taken before C7's plan freezes, by the owner, or by the Fable advisor in the owner's absence.

- The architecture's owner decision Q2 stands: a stale speed is not blanked and no tolerance rule exists for it.

## 12. Orchestrator decisions and open questions

### Orchestrator decisions (final for C2)

| # | Decision | Closes |
|---|---|---|
| OD-1 | `App.tsx` is not edited in C2. It compiles unchanged: `App.tsx:95` reads three fields and no `Banner` literal exists outside `banners.ts:21-25`. This deviates from the architecture's C2 file list (its line 250, "`App.tsx` (only so it compiles with the wider `Banner`)") and from C1's boundary row that repeats it. Neither frozen plan is edited; the deviation is recorded here. If typecheck disagrees, the implement lane stops and reports. | Q1, N-10 |
| OD-2 | One rule for bad numbers: a non-finite byte count (`NaN`, `Infinity`) is "not known" (null fraction, as for a null total); a non-finite or negative speed adds 0 to totals, as `queue.ts:29-30` does. Applied in 5.1, 5.2 row 46, 5.3 and 5.5. | Q4, N-4 |
| OD-3 | Q7 is restated with options (a), (b), (c) and a separate question on stalled jobs (section 11). (b) and (c) are C7 amendments. The answer is taken before C7's plan freezes, by the Fable advisor in the owner's absence. C2 implements the frozen rule and does not wait. | Q7, N-2 |
| OD-4 | `rememberThumb` keeps the silent fallback to 200 for a `cap` that is not an integer ≥ 1. It does not throw, unlike C1's `contrast` and C8's `logoBitmap` on bad input: the map stays bounded and the feature keeps working. | Q9, N-11 |
| OD-5 | The visible-change item shown to the owner at the C2 commit names the pairing: "paused 25% · cannot resume" next to an enabled Resume button (section 8). | Q6, N-3 |

### Open questions

None blocks the tests lane; each has a recommendation the plan already follows. Q1, Q4, Q6, Q7 and Q9 are settled or framed by the decisions above.

| # | Question | Recommendation |
|---|---|---|
| Q1 | The architecture lists `App.tsx` under C2's modified files "only so it compiles with the wider `Banner`". It compiles unchanged. | Decided, OD-1: not edited in C2. |
| Q2 | `SETTINGS_SECTIONS` (a const tuple) is not in the architecture; only the type is. | Add it. The type is derived from it and is the same union; C5 can render its headings from it. |
| Q3 | `makeLive` in `tests/helpers.ts`, or a local helper in each test file? | In `tests/helpers.ts`: C7's and C9's tests need the same builder. |
| Q4 | `streamFraction` and the totals when a count or a speed is not a usable number. The architecture defines only null and ≤ 0 totals. | Decided, OD-2. Main never sends such a value, so no valid input changes. |
| Q5 | `sameRow`: is an entry with three nulls equal to no entry? Is an absent key equal to `undefined`? | The entry against `undefined` is not equal (the architecture's wording); the cost is one extra render. Absent and `undefined` are equal: both read the same. |
| Q6 | The one visible change in C2: a paused non-resumable job says "cannot resume", next to an enabled Resume button. | Keep the text, as the architecture's section 3 lists it. The owner sees the pairing at the C2 commit (OD-5). Whether Resume should stay offered for such a job is the owner's; C2 does not change `allowedVerbs`. |
| Q7 | Owner: (1) how long the connection count stays once the job stops downloading: (a) as frozen, (b) until the entry is removed, (c) N seconds with N and the clock to choose; (2) separately, whether a stalled job's count should ever be hidden. | No recommendation on a duration. C2 implements (a), the frozen rule. (b) and (c) are C7 amendments. Answer needed before C7's plan freezes (OD-3, section 11). |
| Q8 | `acceptThumbnail` accepts a string with a tab or newline inside, because the URL parser removes them, and returns the cleaned `href`. | Implement as written. PU-1 confirmed the behaviour on Node v24.14.1 and the Electron 45.4.1 renderer. The returned URL is always the parsed one, so nothing unparsed reaches `<img>`. Refusing such strings would narrow the frozen rule; the owner can ask for it. |
| Q9 | `rememberThumb` with a `cap` that is not an integer ≥ 1. | Decided, OD-4: use 200, silently. C6 calls it with the default. |
| Q10 | `finishedEvents` with duplicate ids. | First occurrence wins, one event per id. Main cannot produce duplicates. |
| Q11 | Should `filterCounts` and `groupView` tests go into the existing `format.test.ts`? | A new file, `listModels.test.ts`, so no existing test file is edited beyond the superseded ones. |
| Q12 | `segments.cells` is the stored array, not a copy. | No copy: one allocation less per row per push. C4 must not mutate it (section 10). |

## 13. Risks

- Apart from PU-1, nothing was run. A wrong expected value in a table is caught only when the tests lane's scratch reference disagrees. The lane then reports the row and does not bend the rule.
- The thumbnail rows that depend on the URL parser were probed on Node v24.14.1 and in the Electron 45.4.1 renderer, and the two agree on every input (5.6).
  - CI's Node 22 and Node 24 (`.github/workflows/ci.yml:22`) are covered only by CI.
  - A later Electron upgrade changes the window's parser. The unit tests run in Node and would not show a difference; the probe is repeated if such a difference is suspected.
- The provisional rows (P) can change after PL-1 and PL-2. D10 confines that to three functions and their tests.
- Q7 may change `laneModel` rule 3 through a C7 amendment. Option (c) also changes `JobLive` or `laneModel`'s signature.
- The A3 branch adds `Job` fields and edits `types.ts` in parallel. `sameRow` needs no change, but its field-map test fails until the new fields get a changed value. That is the intent, and whichever branch merges second sees it.
- Two detectors decide a finish: main's announcement and `finishedEvents`. They agree by rule only. No test crosses the process boundary until C11 adds `done` to `Finished`.
- `statusParts` can now return three parts for one paused job. The status column may cut the text until C4 restyles the row; the tooltip carries the full text (`JobRow.tsx:63`).
- A paused job that cannot resume shows an enabled Resume button beside "cannot resume" until the owner decides otherwise (Q6).
- `tsconfig.node.json` names `format.ts` alone (line 22). The new model files reach that config only through test imports, so a DOM global in a model file fails typecheck there. That is the wanted effect.
- `summary` and the local `summary` in `GroupRow.tsx:18` share a name. C4 removes the local when it adopts `groupView`.

---

## Changes from r1

- **B-1** — fixed: PU-1's results are written into 5.6.
  - The new subsection gives the probed runtimes (Node v24.14.1; Electron 45.4.1 renderer, Chrome 156.0.8078.100), the ten probed inputs with `hostname`, `href` and the deciding rule, and the note that both runtimes agree and every row holds.
  - The † marks and the "tests lane confirms each † row" text are gone.
  - CI's matrix (`node: [22, 24]`, `windows-latest`) is stated as covered only by CI, in 5.6 and in section 13.
  - The header line "Nothing here was run", Q8 and the section 13 risks are updated to match.
- **N-1** — fixed: the header says component-file citations are pre-C1 and shift after C1, and that C1 does not touch the files C2 edits. The C1 boundary note also mentions the `Icon` import.
- **N-2** — fixed (OD-3): section 11 and Q7 restate the question with options (a), (b), (c) and their costs, plus the separate stalled-job question. The stall case is corrected: a stalled job stays `downloading` and keeps its count. (b) and (c) are named as C7 amendments, the deadline is before C7's plan freezes (Fable advisor in the owner's absence), and C2 does not wait. One line each was added to the C4 and C7 boundary notes and to the risks.
- **N-3** — fixed (OD-5): section 8, Q6, the end of 5.9 and a risk line name the pairing "paused 25% · cannot resume" next to an enabled Resume button, with `format.ts:214` as the cause. `allowedVerbs` is unchanged.
- **N-4** — fixed (OD-2): the single rule is stated before 5.1 and applied throughout.
  - 5.1: `streamFraction` returns null for a non-finite `bytesDone` or `bytesTotal`. The 50/`Infinity` row is now null/null, and `Infinity`/200 was added.
  - 5.2: row 46 added (50/`Infinity` gives `unknown`).
  - 5.3: "known size" and "counted speed" are defined. Row 23 now gives speed 0. Rows 26 to 29 were added for negative speed, `Infinity` speed, a `NaN` count and an `Infinity` total.
  - 5.5: `groupView.speed` uses the same guard, with one row added.
  - Q4, the edge-case table and the C3 and C4 boundary rows follow.
  - Row 24 (−5/10) keeps its value. The decision covers non-finite counts and bad speeds, not a finite negative count, so the architecture's `max(0, total − done)` stands and the row says so. This is the one place where "update rows 23-24 accordingly" was read as "no value change"; the orchestrator confirmed it at freeze (plan-critique r2, R2-N1).
- **N-5** — fixed: 5.11 uses the critique's two-line form, so no unused constant remains.
- **N-6** — fixed: section 3 has a "JSDoc" subsection with the exact replacement sentence for `banners.ts:17`. It states that the new exports carry no JSDoc promise beyond section 4's comments, and that the implement lane may only restate section 5. 5.8 notes which assertions test the sentence.
- **N-7** — fixed: 5.2 rows 19 (live variants), 42 and 43 (second half) are marked (P). By the same definition, row 32 and the unmarked live rows of 5.1 are also marked (`done` and failed with a stream, `'subs'`, segments with `stream: null`, the `stream: null` variant). No expected value changed.
- **N-8** — fixed: every group-event row in 5.7 states its member lists and all three counts (the cancel row is done 1, failed 0, skipped 0). The two ordering rows state their fixtures.
- **N-9** — fixed: extra check 3 is `git status --porcelain -- <the same paths>`, run before the commit. The plan notes that git-safe is not on this branch.
- **N-10** — fixed (OD-1): recorded as an orchestrator decision and a deviation from the architecture's file list and C1's boundary row. Sections 2, 3, 8 and 10 cite it.
- **N-11** — fixed (OD-4): the silent fallback to 200 is kept and recorded as a decision. 5.6 says it neither throws nor logs, the cap test row asserts no throw, and an edge-case row was added.
- **N-12** — fixed: the C6 note cites `AddDialog.tsx:46-47` and says only the IPC handler remains unread.
- **N-13** — fixed: one line under "Notes on the types", and a pointer in 5.10, say that comparing every key is a superset of 7.10's "the same three fields".

Also changed, wording only: two first-person sentences (section 7 and the C6 note) are now in neutral voice, as the brief requires.

## Freeze note

Frozen 2026-11-24 after plan-critique r2 (0 BLOCKING). The orchestrator applied the three NON-BLOCKING wording fixes of that pass at freeze: R2-N1 (row 24 confirmed, drafting note removed), R2-N2 (which part of the `segments` comment C2 tests), R2-N3 (extra check 3 runs after C1's commit).
