# Hammel Phase 1 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every item of the agreed fix list (ledger lines 62-80: B2-B20, Q2, Q4, N1, N2) so the Codex verdict can move from BLOCKING to acceptable-pending-the-manual-checklist. B1 is already committed (`a82a6ac`) and is not part of this plan.

**Architecture:** No new pieces. Ownership becomes explicit in three places: names (one namespace per folder), processes (an engine keeps a job until its stop is confirmed; the queue serializes verbs per job) and state (transition, save, then side effect). One new pure module (`src/main/jobs/validate.ts`) and one new injectable module (`src/main/engineHost.ts`) so that startup logic is testable without Electron.

**Tech Stack:** unchanged (Electron 45, TypeScript 6 strict with `noUncheckedIndexedAccess`, React 19, Vitest 5, ESLint 10). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-22-download-manager-design.md` (authority). Scope source: `.superpowers/sdd/2026-11-22-phase1-app/progress.md` lines 59-81. Where `debate-brief.txt` and the ledger differ, the ledger wins (B2, B3, B5, B7, B13, Q2).

**Gates (run serially, by the owner, after every task):** `npm run typecheck`, `npm run lint`, `npm test`. Baseline: 370 tests pass.

## Global Constraints

- All Global Constraints of the phase 1 plan still hold, with one amendment (B20): **tests use no external network and no real binaries.** A loopback socket to a server the test itself starts is allowed.
- TDD: every step below starts with the named failing test (RED), then the change (GREEN). N2 is met by these tests; there is no separate N2 task.
- A value that crosses main, preload and renderer has exactly the meaning given in "Types and contracts". No other meaning may be attached to it.
- Never delete a file that is not provably the job's own. A leftover beats a deletion.
- An engine releases a job only when its stop is confirmed. The queue frees a slot only when the engine released the job.
- Nothing in this plan runs the real yt-dlp, ffmpeg or aria2. Every statement about their behaviour stays "unverified" and goes to the manual checklist.
- Git: branch `feat/phase1-app`, one commit per task, no push.

## Review Focus

1. **Name ownership:** two jobs (any engine) or a job and a disk file can never share an output or partial-file name, whichever was added first. Tasks 2, 5, 7.8.
2. **Process ownership:** no path marks a job paused, cancelled or retried while its download may still run. Tasks 6, 7.1, 7.2, 7.6.
3. **Stale timers and late verbs:** a retry timer, a notify timer or a queued verb acting on a job whose state moved on. Tasks 7.1, 7.3, 7.6.
4. **Old data files:** a `jobs.json` or `settings.json` written by today's code loads unchanged and is never set aside. Task 4.
5. **Banner truth:** each banner is state, not an event; it disappears only when its cause is gone. Tasks 9, 10.

## Scope

In: B2+B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14, B15, B16, B17, B18, B19, B20, Q2, Q4, N1, N2.

Out of scope:
- Phase 2 and 3 work (extension, logins, courses).
- A per-job staging directory for B2 (`-P temp:`); follow-up after the checklist ran with real tools.
- A native Job Object for B13.
- Anything that needs a real yt-dlp/aria2 run (Q1, Q3, and the real-tool half of Q2).
- Q5 (private-address requests), styled confirmation dialogs, the watch-plus-list link behaviour.
- A client-chosen aria2 gid (it would close the "addUri answer lost" residual in Task 6).
- Dropping only the invalid jobs of a snapshot (B8 as agreed sets the whole file aside).

## Conflicts (need the owner's ruling; the plan states what it assumes)

| # | Conflict | Plan assumes |
| --- | --- | --- |
| C1 | B17 names three engine states (starting, ready, error). "Tools not installed" then has no value, and reusing `starting` for it would be a second meaning. | A fourth state `notInstalled`. The window's setup screen is driven by it instead of by `binaries()`. |
| C2 | B9: debate brief says the save banner is "repeated at most once a minute"; ledger and B17 say one persistent banner. A persistent banner has nothing to repeat. | Persistent, not dismissible, cleared by the next successful save. "Once a minute" becomes the save retry interval (OQ2). |
| C3 | B20: ledger says "the plan wording becomes no external network". `docs/superpowers/plans/2026-11-22-phase1-app.md` is an executed plan. | That plan is treated as frozen and is not edited. The wording goes into this plan's Global Constraints, `README.md` (Develop) and `docs/manual-checklist-phase1.md` (intro). The design doc line 218 ("no network") is the authority and stays as is unless the owner amends it. |
| C4 | B5 defines "dead daemon" but nothing restarts aria2; after it dies every file job fails until the app restarts. | Dead = the aria2 child process exited. On an unexpected exit the engine status becomes `error` and the B17 Retry restarts aria2 (Task 9.4). Drop Task 9.4 if not wanted. |
| C5 | B13 "cleanup succeeds on retry": an in-session retry of `killStrays` would also kill this run's own aria2, yt-dlp and ffmpeg (same folder filter). | No in-session retry. The check runs again at the next app start (before any tool starts) and on B17 Retry while no engine runs. In session the owner can only confirm ("They are gone"). See OQ5 for the alternative. |
| C6 | B13 does not define "cleanup fails". Today the script ignores a process it could not end and still exits 0. | Success = script exits 0 **and** a second query finds no matching process. |
| C7 | Q2 names only "Best". `Up to 1440p/2160p` on a source that is 1080p or lower has the same mismatch (mkv with any codec). | Unchanged for `max`; only `best` uses the real height. Say if `max` should use `min(ceiling, real height)`. |
| C8 | Q2 needs the real height for playlist items, which the flat probe does not give: one extra `yt-dlp -J` run per item, and one new persisted field. Neither is verified against the real tool. | Planned as written in the ledger (pre-probe in the `probing` state). |
| C9 | B2 strict shapes use `f<N>` (digits). Sites with non-numeric format ids, and a merge killed by B12 (`<base>.temp.<ext>`), leave files that Cancel no longer removes. | Strict shapes as agreed; leftovers accepted; checklist line added. See OQ6. |
| C10 | B14: a message with both a sign-in hint and a region text. The ledger fixes "region before generic unavailable" but not login vs region. | Order: DRM, login, region, private, removed ("any message that carries a sign-in hint" wins). |
| C11 | B8 strictness vs old files: today's code can have saved a file name longer than 150 chars or a device name. Validating persisted names with the B16 add-time rule would set an existing list aside. | Persisted names get a structural rule only (Task 4); the strict rule applies at add time (Task 9). |
| C12 | The design contradicts itself on private videos (lines 117-118 vs 193-195). The ledger resolves it (B14); the design text stays contradictory. | Design doc not edited in this change. |

## Types and contracts (single reference; each lands in the task that first needs it)

```ts
// src/shared/types.ts
export interface Job {
  // ...existing fields
  /** B13. true = this job's last run was not confirmed stopped and no check for leftover
   *  tool processes has succeeded or been confirmed since. Invariant: true only while
   *  state === 'paused'. While true, resume is refused. */
  interrupted: boolean;
  /** Q2. Highest video height the site offered when probed; null = not known. */
  sourceHeight: number | null;
}
export type EntryReason = 'private' | 'removed' | 'unavailable';
export interface PlaylistEntry {
  index: number; url: string; title: string; unavailable: boolean;
  /** B15. Non-null exactly when unavailable is true. Copied into Job.reason. */
  reason: EntryReason | null;
}
/** B17 (C1). notInstalled: a tool is missing, no queue. starting: tools present, start or
 *  restart running. ready: queue exists and aria2 runs. error: start failed (no queue) or
 *  aria2 exited (queue exists, file downloads cannot run); Retry applies. */
export type EngineStatus =
  | { state: 'notInstalled' } | { state: 'starting' } | { state: 'ready' }
  | { state: 'error'; message: string };
export interface AppStatus {
  engine: EngineStatus;
  /** B9. Text of the last failed write of jobs.json; null once a write succeeded. */
  saveError: string | null;
}
export interface HammelApi {
  // ...existing; job() and group() keep Promise<Result<null>> but now carry real errors
  status(): Promise<AppStatus>;
  onStatus(cb: (s: AppStatus) => void): () => void;   // channel hammel:status
  retryEngines(): Promise<Result<null>>;              // channel hammel:retryEngines
  confirmStraysGone(): Promise<Result<null>>;         // channel hammel:confirmStraysGone
}
```

```ts
// src/main/jobs/state.ts: two new events
interrupt: { probing: 'paused', downloading: 'paused', merging: 'paused' }  // shutdown only; speed 0, eta null
requeue:   { probing: 'queued', downloading: 'queued' }                     // limit restart; keeps bytes, attempts; reason null

// src/main/engines/engine.ts
EngineEvent += { type: 'probed'; sourceHeight: number }
Engine.stop(jobId): Promise<void>   // resolves = confirmed stopped; rejects = not confirmed, the engine still owns the job and keeps reporting
Engine.discard(job): Promise<void>  // rejects, deleting nothing, when the stop is not confirmed

// src/main/engines/file.ts
export class Aria2RpcError extends Error { code: number | null }  // aria2 answered with an error
export class Aria2TransportError extends Error {}                 // no usable answer
export interface Aria2Daemon { rpc: Aria2Rpc; alive(): boolean; onExit(cb: () => void): void; stop(): Promise<void> }
new FileEngine(rpc, opts?: { pollMs?: number; daemonAlive?: () => boolean })
FileEngine.setRateLimit(jobId: string, bytesPerSec: number | null): Promise<void>
FileEngine.attach(daemon: Aria2Daemon): void                      // Task 9.4 only
// removed: FileEngine.setGlobalLimit

// src/main/jobs/queue.ts
QueueDeps: file: Engine & { setRateLimit(jobId: string, bytesPerSec: number | null): Promise<void> }; straysCleared: boolean
Queue.job(id, verb): Promise<Result<null>>;  Queue.group(id, verb): Promise<Result<null>>
Queue.shutdown(): Promise<void>;  Queue.confirmStraysGone(): void
Queue.onSaveState(listener: (error: string | null) => void): void

// src/main/naming.ts
sanitizeFileName(raw: string): string            // full Windows leaf: ext <= 16, whole name <= 150
dirKey(dir: string): string                      // win32.resolve(dir).toLowerCase()
nameConflicts(candidate: string, claims: Iterable<string>, disk: Iterable<string>): boolean
freeName(base: string, ext: string, taken: (name: string) => boolean): string   // replaces uniqueName

// src/main/strays.ts
killStrays(binDir, run?): Promise<boolean>       // true = ran, exit 0, second query empty
```

Consumers that change with each value:

| Value | Written by | Read by |
| --- | --- | --- |
| `Job.interrupted` | store load (Task 4), `Queue.shutdown`, `Queue` constructor, `confirmStraysGone` (Task 7) | validate.ts, queue resume paths, `format.allowedVerbs`/`statusText`, `banners()`; tray "Resume all" skips such jobs through `resumeAllPaused` |
| `Job.sourceHeight` | `Queue.add` (from `probe.heights`), queue on `probed` | validate.ts, `MediaEngine.start`, `downloadArgs`; not shown in the window |
| `PlaylistEntry.reason` | `parseProbe` | ipc `validProbe`, `Queue.add` (into `Job.reason`), `AddDialog` (label), `strings.ts` |
| `AppStatus` | `EngineHost` + `Queue.onSaveState`, pushed by index.ts | ipc `status`, preload, `App.tsx`, `banners()`, ipc `add/job/group` error text |
| `Result` from `job`/`group` | queue | ipc (passed through), `JobRow`/`GroupRow` (already show `res.error`) |
| per-job rate limit | queue `perJobLimit` | `StartContext.rateLimitBytes` for both engines, `FileEngine.setRateLimit` |

---

### Task 1: Contracts for jobs and the state machine

**Covers:** groundwork for B7, B12, B13, Q2. **Files:** `src/shared/types.ts`, `src/main/jobs/state.ts`, `tests/jobs/state.test.ts`, `tests/helpers.ts`, `src/main/jobs/queue.ts` (two initialisers only).

- [ ] **Step 1 (RED):** `tests/jobs/state.test.ts`
  - extend the transition table: `interrupt` from probing, downloading, merging gives `paused`; `requeue` from probing, downloading gives `queued`.
  - `rejects requeue during the merge`: `transition(merging, {type:'requeue'})` throws `IllegalTransition`.
  - `interrupt stops the meters`: job with speed 900, eta 12 ends with speed 0, eta null, bytesDone kept.
  - `requeue keeps the progress and the attempts`: bytesDone 50, attempts 2 are kept, reason null.
- [ ] **Step 2 (GREEN):** add both events to `TABLE` and `transition`. Add `Job.interrupted`, `Job.sourceHeight`. `makeJob` defaults: `interrupted: false, sourceHeight: null`. `Queue.add` `base`: the same two defaults (real values come in Task 7.8).
- [ ] **Step 3:** Gates. Commit: `feat: job fields and state events for the review fixes`.

**Acceptance:** `npx vitest run tests/jobs/state.test.ts` green; all three gates green.
**Edge cases:** `pause` stays illegal from `merging` (the user's Pause must not kill a merge; only shutdown does).

### Task 2: Names (B2, B3, B16 pure parts)

**Files:** `src/main/naming.ts`, `src/main/probe.ts`, `tests/naming.test.ts`, `tests/probe.test.ts`.

Behaviour:
- `sanitizeFileName(raw)`: last path segment only, then split at the last dot. Stem goes through `sanitizeName` rules. Extension: forbidden characters and whitespace removed, cut to 16. Stem cut so that `stem.ext` is at most 150. No trailing dot or space. Device-name stem (before the first dot) gets `_`. Empty result is `download`. Must be idempotent.
- `dirKey(dir)` = `win32.resolve(dir).toLowerCase()`.
- `nameConflicts(candidate, claims, disk)`, case-insensitive:
  - against a claim `c` (another job's name): `candidate === c`, or one is the other plus `.` plus anything (symmetric dot-prefix).
  - against a disk name `d`: `d === candidate` or `d` starts with `candidate + '.'` (one direction only: an inert file `a` does not block `a.zip`).
- `freeName(base, ext, taken)`: for n = 1, 2, 3... try `base[ (n)].ext`, then the head form `head (n)tail.ext` where `head` is `base` up to its first dot (empty head becomes `_`). First name with `taken(name) === false` wins. The head form is what ends the loop when the conflict is a dot-prefix (`Clip.f137` next to job `Clip` gives `Clip (2).f137`).
- `probe.fileNameFrom` returns `sanitizeFileName(...)`.

- [ ] **Step 1 (RED):** `tests/naming.test.ts`
  - `sanitizeFileName` table, each row also asserted idempotent: `CON` gives `_CON`; `com1.txt` gives `_com1.txt`; `report.txt:payload` has no colon; `a.` gives `a`; `..\..\evil.exe` gives `evil.exe`; `'x'.repeat(150) + '.' + 'y'.repeat(150)` has length at most 150 and an extension of 16; `'.'` and `''` give `download`; an Arabic name is kept.
  - `nameConflicts`: (`Clip`, claims [`clip`]) true; (`Clip.f137`, [`Clip`]) true; (`Clip`, [`Clip.extra`]) true; (`Clip 2`, [`Clip`]) false; (`a.zip`, [`a.pdf`]) false; disk: (`Talk`, disk [`Talk.mp4`]) true; (`a.zip`, disk [`a.zip.aria2`]) true; (`a.zip`, disk [`a`]) false; (`a.zip`, disk [`A.ZIP`]) true.
  - `freeName`: the three existing `uniqueName` cases ported; `freeName('Clip.f137','', n => nameConflicts(n,['Clip'],[]))` is `Clip (2).f137`; `freeName('a.tar','gz', taken by claim 'a')` is `a (2).tar.gz`; terminates when `(2)` and `(3)` are taken.
  - `dirKey('D:\\Dl\\')`, `dirKey('d:/dl')`, `dirKey('D:\\Dl\\x\\..')` are equal.
- [ ] **Step 2 (RED):** `tests/probe.test.ts`
  - `caps a server-chosen name at 150 characters with a 16-character extension`: Content-Disposition with a 150-char stem and 150-char extension; `fileName.length <= 150`.
  - `makes a device name safe`: `filename="CON"` gives `_CON`.
- [ ] **Step 3 (GREEN):** implement; remove `uniqueName` (its callers move in Task 7.8; until then keep a thin `uniqueName` wrapper over `freeName` so the build stays green, deleted in 7.8).
- [ ] **Step 4:** Gates. Commit: `fix: one rule for safe file names and name conflicts`.

**Acceptance:** `npx vitest run tests/naming.test.ts tests/probe.test.ts`.
**Edge cases:** surrogate pair at the cut (existing `truncate`); extension that is empty after cleaning (name has no dot); `dirKey` does not resolve junctions, `subst` drives or 8.3 names (residual, accepted). Visible effect to know: adding "Node.js Tutorial" while a job "Node" is listed in the same folder gives `Node (2).js Tutorial`.

### Task 3: yt-dlp output and arguments (B14, B15, Q2 arguments)

**Files:** `src/shared/types.ts` (`EntryReason`, `PlaylistEntry.reason`), `src/main/ytdlp/parse.ts`, `src/main/ytdlp/args.ts`, `tests/ytdlp/parse.test.ts`, `tests/ytdlp/args.test.ts`, fixtures in `tests/jobs/queue.test.ts` (`entries()`) and `tests/ipc.test.ts` (`list`) gain `reason`.

Behaviour:
- `classifyError` rule order (C10): DRM; login `/sign in|log in|login required|cookies|members-only|confirm your age|age[- ]restricted/i` gives failed `login required`; region; `/private video/i` gives skipped `private`; removed.
- `parseProbe`: every position of `entries` yields an entry. `null`, a non-object or an entry without url: `{ index, url: '', title: title ?? 'Item N', unavailable: true, reason: 'unavailable' }`. Title `[Private video]`: reason `private`. `[Deleted video]`: reason `removed`. Available: `reason: null`.
- `downloadArgs` gets `sourceHeight: number | null`:
  - `best`, not prefer-mp4: `sourceHeight !== null && sourceHeight <= 1080` uses the H.264 path `mp4Format(1080)`; otherwise `-f bv*+ba/b --merge-output-format mkv`.
  - prefer-mp4 (any quality but audio): as today plus `--remux-video mp4`.
  - `max` and `audio`: unchanged (C7).
- New `heightProbeArgs(url)`: `['-J', '--no-playlist', '--no-warnings', '--', url]`.

- [ ] **Step 1 (RED):** `tests/ytdlp/parse.test.ts`
  - change row: `Private video. Sign in if you have been granted access` is failed / `login required`.
  - add rows: `Video unavailable. This video is not available in your country` is skipped / `unavailable in region`; `This video is age-restricted` is failed / `login required`; bare `ERROR: [youtube] x: Private video` is skipped / `private`; `Video unavailable. Sign in ... not available in your country` is failed / `login required`.
  - `reads a playlist...`: expected list gains `{ index: 3, url: '', title: 'Item 3', unavailable: true, reason: 'unavailable' }`, reasons `private` (4), `removed` (5), `unavailable` (6), `null` (1, 2).
  - replace `keeps playlist positions when an entry is missing`: `[null, {url,title:'Two'}]` gives two entries, index 1 unavailable and index 2 available.
  - `keeps a placeholder for an entry that is not an object`: `entries: ['x', 7]` gives two unavailable entries.
- [ ] **Step 2 (RED):** `tests/ytdlp/args.test.ts`
  - `Best takes the H.264 mp4 path when the source is 1080p or lower`: `sourceHeight: 1080` and `720` give `-f AVC_1080`, merge `mp4`.
  - `Best keeps the codec in mkv above 1080p`: `sourceHeight: 2160` gives `bv*+ba/b`, `mkv`.
  - `Best with an unknown height keeps the mkv path`: `sourceHeight: null`.
  - both prefer-mp4 tests: also `valueOf(args,'--remux-video') === 'mp4'`; without prefer-mp4 `--remux-video` is absent.
  - `heightProbeArgs` equals the array above.
- [ ] **Step 3 (GREEN):** implement. `MediaEngine` passes `sourceHeight: job.sourceHeight` (one line; the pre-probe is Task 5).
- [ ] **Step 4:** Gates. Commit: `fix: login and region reasons, playlist placeholders, container by real height`.

**Acceptance:** `npx vitest run tests/ytdlp`.
**Edge cases:** existing row `unable to download webpage` must stay retryable (the word "age"); media test `reports a private video as skipped` (bare message) must still pass unchanged.

### Task 4: Persisted data validation and migration (B8, B13 load flag)

**Files:** new `src/main/jobs/validate.ts`, `src/main/jobs/store.ts`, `tests/jobs/store.test.ts`, new `tests/jobs/validate.test.ts`.

Behaviour:
- `parseSnapshotFile(raw: unknown): Snapshot | null` builds new objects from known keys only (unknown keys dropped). Any invalid job or group returns `null`, and the store sets the file aside as today.
- Job rules:

| Field | Valid when |
| --- | --- |
| `id` | non-empty string, unique |
| `groupId` | null, or the id of a listed group |
| `kind`, `state` | one of the declared literals |
| `url` | string; http(s) by `new URL` unless `state === 'skipped'` (placeholders have `''`) |
| `title` | string |
| `reason` | null or string |
| `quality` | media: valid `Quality`; file: null |
| `subtitleLangs` | array of at most 10 codes matching the ipc language regex |
| `dir` | absolute win32 path |
| `baseName` | media: non-empty, at most 200 chars, none of `\ / : * ? " < > \|` or control chars, no trailing dot or space; file: null |
| `fileName` | null, or a structural leaf: non-empty, at most 255, no `\ / :` or control chars, not `.` or `..`; required for `kind: 'file'` (C11) |
| `index` | null or integer >= 1 |
| `bytesDone`, `speed` | finite, >= 0 |
| `bytesTotal`, `eta` | null or finite >= 0 |
| `actualHeight`, `sourceHeight` | null or finite > 0 |
| `resumable`, `interrupted` | boolean |
| `attempts` | integer >= 0 |
| `createdAt` | finite number |

- Group rules: `id` non-empty unique string; `title`, `url` strings; `dir` absolute; `createdAt` finite. A group without members is dropped, not an error.
- `version`: absent or `1`; anything else sets the file aside.
- After validation, on load: a job in an ACTIVE state becomes `paused`, `speed 0`, `eta null`, `interrupted: true`. `interrupted: true` on a job that is not then `paused` is coerced to `false`.
- `parseSettings(raw, defaults)`: per field, an invalid value falls back to that field's default. `downloadDir` must be an absolute path; `defaultQuality` a valid `Quality`; `subtitleLangs` a valid language list (the whole field falls back, no filtering); booleans must be booleans; numbers finite, then `normalizeSettings`.
- `isQuality` and `isLangList` move from `ipc.ts` to `validate.ts`; ipc imports them (one definition; the edit to ipc is an import line, the rest of ipc is Task 9).

**Migration (see also the section below):** absent `interrupted` reads as `false`; absent `sourceHeight` reads as `null`. No other field is new.

- [ ] **Step 1 (RED):** `tests/jobs/validate.test.ts`
  - `accepts a job written before this change`: a full job object without `interrupted` and `sourceHeight` returns the job with `false` / `null`.
  - `it.each` one row per field of the table with one bad value each (for example `state: 'done'` only plus `id`; `quality: {kind:'max',height:999}`; `groupId: 'ghost'`; `subtitleLangs: ['--exec']`; `dir: 'relative'`; `bytesDone: '5'`; `baseName: 'a/b'`; `fileName: 'a:b'`; duplicate ids; file job with `quality` set; media job with `baseName: null`): each returns null.
  - `accepts a skipped placeholder with an empty url`; `rejects an empty url on a queued job`.
  - `accepts a persisted file name of 300 characters is rejected, 255 accepted` (boundary 255 / 256); `accepts the persisted name CON` (C11).
  - `drops unknown keys`; `drops a group without members`; `rejects version 2`, `accepts a missing version`.
  - settings: `{"subtitleLangs":{}}` gives `[]`; `{"defaultQuality":{"kind":"max","height":7}}` gives the default; `{"downloadDir":"x"}` gives the default dir; `{"maxConcurrent":"4"}` gives 3; a valid old settings file is returned unchanged.
- [ ] **Step 2 (RED):** `tests/jobs/store.test.ts`
  - `sets aside a jobs file whose job lacks required fields`: content `{"jobs":[{"id":"x","state":"done"}],"groups":[]}`; `recoveredCorrupt` not null, the aside file has the original bytes, list empty.
  - `loads a jobs file written by the previous version`: write JSON by hand without the two new fields; `recoveredCorrupt` null, `interrupted === false`, `sourceHeight === null`.
  - extend `loads a job saved as %s as paused`: also `interrupted: true`.
  - `keeps interrupted on a paused job across a load`; `clears interrupted on a job that is not paused` (hand-written `done` + `interrupted: true`).
  - `falls back per field when settings.json has a wrong field`: `{"subtitleLangs":{},"maxConcurrent":5}` gives defaults with `maxConcurrent: 5`.
- [ ] **Step 3 (GREEN):** implement; `Store.loadSnapshot` and `loadSettings` call the parsers.
- [ ] **Step 4:** Gates. Commit: `fix: validate every persisted field; mark jobs cut off by a crash`.

**Acceptance:** `npx vitest run tests/jobs/store.test.ts tests/jobs/validate.test.ts`.
**Failure modes:** `renameSync` to the aside name failing (existing behaviour: throws at startup; unchanged, noted). One invalid job costs the whole list (agreed); the aside file keeps everything for hand repair.

### Task 5: Media engine (B2 shapes, B3 findFinished, Q2 pre-probe)

**Files:** `src/main/engines/engine.ts` (`probed` event, `stop`/`discard` contract text), `src/main/engines/media.ts`, `tests/engines/media.test.ts`, `tests/fakes/fake-ytdlp.mjs`.

Behaviour:
- `isPartialOf(fileName, baseName)` exported, case-insensitive. After `<baseName>` the rest must match one of:
  `^\.(?:f\d+\.)?[a-z0-9]{1,5}(?:\.part(?:-Frag\d+)?|\.ytdl|\.part\.ytdl)$` or `^\.f\d+\.[a-z0-9]{1,5}$` (flags `iu`).
- `findFinished`: only a name that is exactly `<baseName>.<ext>` with `ext` in `mp4 mkv webm m4a mp3 opus ogg flac wav mov` (case-insensitive) and `statSync(path).isFile()`. Several matches: first in sorted order.
- Pre-probe: `start()` with `quality.kind === 'best'`, `preferMp4Max1080 === false`, `job.sourceHeight === null` and `job.bytesDone === 0` first runs `heightProbeArgs(url)` (30 s limit, the existing probe default), in the same `Running` entry.
  - exit 0 with a height: emit `{ type: 'probed', sourceHeight }`, then spawn the download with that height.
  - exit 0 without any height: no event, download with `sourceHeight: null`.
  - non-zero: emit `classifyError(stderr)` as the job's error, no download.
  - timeout: retryable error `timed out reading the link`.
  - `sourceHeight === null && bytesDone > 0` (a job from before this change, or one whose probe found no height): no pre-probe, mkv path, so its existing partial files keep matching.
- `stop()` on an entry that is already stopping returns the same `exited` promise and kills nothing twice. `stop()` during the pre-probe kills the probe child and no download starts.
- Fake: when `-J` is in the arguments and `FAKE_YTDLP_HEIGHTS` is set: `hang` waits forever; `fail` prints `ERROR: [youtube] x: Sign in to confirm your age` and exits 1; `none` prints `{"formats":[]}`; otherwise a comma list becomes `{"formats":[{"height":n},...]}`. `FAKE_YTDLP_ARGS` logging applies to the probe run too.

- [ ] **Step 1 (RED):** `tests/engines/media.test.ts`
  - `isPartialOf` table: true for `Clip.mp4.part`, `Clip.f137.mp4`, `Clip.f140.m4a.part`, `Clip.mp4.ytdl`, `Clip.mp4.part-Frag3`, `clip.MP4.PART`; false for `Clip.extra.mp4.part`, `Clip.mp4`, `Clip.en.vtt`, `Clip 2.mp4.part`, `Clip.temp.mp4`, `Clip.f137.x.mp4`, `Clip.toolongext.part`.
  - `discard leaves the partial file of a job whose name extends this one`: files `Clip.mp4.part` and `Clip.extra.mp4.part`; discard job `Clip`; the second file still exists (B2 trigger).
  - `does not take an unrelated file for the finished download`: `Clip.txt` present, scenario `nofile`: error `finished without a file`.
  - `does not take a folder for the finished download`: directory `Clip.mp4`, scenario `nofile`: same error.
  - keep `treats a clean exit as done when the finished file is already there` (`Clip.mkv`).
  - `checks the real height before a Best download and reports it`: `FAKE_YTDLP_HEIGHTS=1080,720`, quality best: events start with `{type:'probed', sourceHeight:1080}`; args log has two lines; line 2 `-f` contains `vcodec^=avc1`, merge `mp4`.
  - `uses mkv for a source above 1080p`: heights `2160,1080`: merge `mkv`.
  - `skips the height check when the height is known`: `sourceHeight: 720`: one args line.
  - `skips the height check for a job that already has data`: `bytesDone: 10, sourceHeight: null`: one args line, merge `mkv`.
  - `reports why the height check failed`: `fail`: error failed / `login required`, one args line.
  - `stop during the height check starts no download`: `hang`, `stop()`, then 200 ms: no event, one args line.
  - `a second stop while the first is pending resolves with it`: `hang` scenario, `Promise.all([stop, stop])` resolves; no throw.
- [ ] **Step 2 (GREEN):** implement engine and fake.
- [ ] **Step 3:** Gates. Commit: `fix: strict partial-file ownership and container by real height in the media engine`.

**Acceptance:** `npx vitest run tests/engines/media.test.ts`.
**Edge cases and races:** the folder vanishes during `findFinished` (returns null as today); `stop` between probe exit and download spawn (the `stopping` flag is checked before the second spawn); probe output that is not JSON (retryable `could not read the video information`); non-numeric format ids and `.temp.<ext>` stay on disk after Cancel (C9).

### Task 6: File engine (B4 engine half, B5, B7 engine half)

**Files:** `src/main/engines/file.ts`, `tests/engines/file.test.ts`, `tests/fakes/fake-aria2.ts`.

Behaviour:
- `createRpcClient`: parse the body whatever the HTTP status. A JSON-RPC `error` member throws `Aria2RpcError`. A fetch failure or a body that is not JSON-RPC throws `Aria2TransportError`.
- `startAria2` returns `Aria2Daemon`: `alive()` is false after the child's `exit`; `onExit` listeners run on an exit that `stop()` did not ask for.
- `Tracked` keeps `stop: Promise<void> | null` and stays in the map until the stop is confirmed.
- `stop(jobId)`: no entry resolves. A pending stop is returned as is (shared). Otherwise: stop the poll timer, await `added`, then `aria2.forcePause` and `aria2.remove`.
  - **Confirmed** when aria2 *answered* `aria2.remove` (result, or `Aria2RpcError`: nothing active, waiting or paused under that gid), or when `daemonAlive()` is false. Then the entry is deleted and the promise resolves.
  - **Not confirmed** (`Aria2TransportError` on remove while the daemon is alive): the entry stays, `stop` is reset to null, polling restarts, the promise rejects with `could not confirm that the download stopped`.
- `discard(job)`: awaits `stop`; when it rejects, deletes nothing and rejects.
- `poll`:
  - `Aria2RpcError` on `tellStatus` (aria2 no longer knows the gid): finish with retryable `download was removed`.
  - `Aria2TransportError` with `daemonAlive() === false`: finish with retryable `the download service stopped`.
  - `Aria2TransportError` with the daemon alive: keep the gid and keep polling; after 5 consecutive failures emit one `progress` with the last byte counts, `speed: 0`, `eta: null` (OQ1); the counter resets on any answer.
- `start(job, ctx)`: `addUri` options `{ dir, out, 'max-download-limit': String(ctx.rateLimitBytes ?? 0) }`. An `addUri` failure of either kind releases the entry and emits a retryable error (`Aria2RpcError`: its message; transport: `the download service is not running`).
- `setRateLimit(jobId, n)`: awaits `added`; with a gid calls `aria2.changeOption [gid, {'max-download-limit': String(n ?? 0)}]`; untracked job: no call; errors are swallowed (the value is re-sent at the next settings change or start).
- `setGlobalLimit` is deleted.
- Fake: `transportDown: boolean` (every call throws `Aria2TransportError`), `refuse: Set<string>` (those methods throw `Aria2RpcError`), `hold(method): () => void` (calls of that method wait until released), unknown gid on `tellStatus` throws `Aria2RpcError`.

- [ ] **Step 1 (RED):** `tests/engines/file.test.ts`
  - update `adds the download...`: options include `'max-download-limit': '0'`.
  - `passes the per-download limit to aria2`: `rateLimitBytes: 307200` gives `'307200'`.
  - `changes the limit of a running download`: after first progress `setRateLimit(id, 102400)`: call `aria2.changeOption ['gid1', {'max-download-limit':'102400'}]`; `null` gives `'0'`; unknown job: no call.
  - delete `sets the global speed limit, with 0 meaning unlimited`.
  - B4 `a second stop during a pending stop shares it`: `hold('aria2.forcePause')`, `p1 = stop`, `p2 = stop`, release: exactly one `forcePause` and one `remove`; both resolve.
  - B4 `keeps the job until its stop is confirmed`: during the held stop `engine.start(job)` adds no second `aria2.addUri`.
  - B5 `a transport failure with a live daemon does not end the job`: `daemonAlive: () => true`; after first progress `transportDown = true` for 10 polls: no `done`/`error`; set false: progress continues; one `addUri` in total.
  - B5 `shows a stalled download as not moving after five silent polls`: one progress event with `speed: 0` after the 5th failure, none after the 4th.
  - B5 `gives up at once when the daemon is dead`: `daemonAlive: () => false` + `transportDown`: error retryable `the download service stopped`.
  - B5 `gives up when aria2 no longer knows the download`: `refuse.add('aria2.tellStatus')`: error retryable `download was removed`.
  - B5 `stop fails and keeps ownership when aria2 does not answer`: `transportDown`, alive: `stop` rejects; then `transportDown = false`: progress events arrive again; a second `stop` resolves.
  - B5 `stop is confirmed when aria2 answers remove with an error`: `refuse.add('aria2.remove')`: resolves, no further events.
  - B5 `stop is confirmed when the daemon is dead`.
  - B5 `discard deletes nothing when the stop is not confirmed`: both files still exist, `discard` rejects.
  - `createRpcClient`: `rejects with Aria2RpcError for an error answer` (existing loopback server; also when the server answers HTTP 400 with the error body); `rejects with Aria2TransportError when nothing listens` (port of a closed server); `rejects with Aria2TransportError for an answer that is not JSON`.
- [ ] **Step 2 (GREEN):** implement engine, client, daemon handle, fake.
- [ ] **Step 3:** Gates (queue tests still compile: `FakeEngine` there gets `setRateLimit` in Task 7; until then `QueueDeps.file` keeps accepting the old shape through a temporary optional member, removed in 7.5). Commit: `fix: file engine keeps a download until its stop is confirmed`.

**Acceptance:** `npx vitest run tests/engines/file.test.ts`.
**Edge cases and races:**
- `stop` before `addUri` answered: awaits `added`; if `addUri` failed the entry is already released and `stop` resolves.
- Pause racing completion: `remove` is refused because the download finished; the job is paused although the file is complete; Resume then fails `file already exists` (existing behaviour, residual, noted in the checklist).
- `addUri` accepted but its answer lost: a download without a known gid (residual; a client-chosen gid is out of scope).
- Daemon gone vs gid gone are told apart only by `daemonAlive()` and the error class, never by counting failures.
- All statements about what aria2 answers to `remove`/`tellStatus` are unverified against 1.37.0 (Q3, checklist).

### Task 7: Queue (B3, B4, B5, B6, B7, B9, B12, B13, B15, B18, B19, Q2)

**Files:** `src/main/jobs/queue.ts`, `tests/jobs/queue.test.ts`. One file, ten steps, in this order; each step is RED then GREEN and ends with `npx vitest run tests/jobs/queue.test.ts`.

Test helper changes first (no behaviour): `FakeEngine` gains `stopGate: Promise<void> | null` (stop waits for it), `stopFails = new Set<string>()` (stop and discard reject for those ids), `rateLimits: [string, number | null][]`, `setRateLimit`, and a shared `log: string[]` that `start`, `stop` and the fake store's `saveSnapshot` append to. `build()` takes `straysCleared` (default true) and `saveFails: { on: boolean }`. `setGlobalLimit` and `limits` are removed.

- [ ] **7.1 Verbs per job in order, with a result (B4).** `job()` and `group()` return `Result<null>`. Each job has a promise chain; a verb runs when the previous verb of that job has finished and reads the job's state at that moment. Group verbs and `pauseAll` enqueue one verb per member.
  - `a second pause during a pending stop waits for it`: `stopGate` set; `p1 = job(id,'pause')`, `p2 = job(id,'pause')`, tick: state still `probing`, `media.stopped.length === 1`; release: both `{ok:true}`, state `paused`, still one stop.
  - `a resume issued during a pending pause runs after it`: `log` ends `stop, save..., start`; state `probing`; `media.started.length === 2`.
  - `a cancel issued during a pending pause removes the job after the stop`.
  - `a verb for a job that was removed meanwhile does nothing`.
  - existing tests keep passing with `await`.
- [ ] **7.2 A stop that is not confirmed (B5).** Pause: the job stays in its active state and keeps its slot; result `{ok:false, error:'Could not confirm that the download stopped. It is still listed as running; try again.'}`. Cancel: `discard` rejected, row kept, same kind of error. Group verb: every member is tried; the result is the first error, else ok.
  - `pause reports failure and keeps the slot when the stop is not confirmed`: `maxConcurrent: 1`, two jobs, `stopFails` has the first: result not ok, states `['probing','queued']`.
  - `cancel keeps the row when the stop is not confirmed`.
  - `a group pause pauses the members it can and reports the one it could not`.
- [ ] **7.3 Retry wait token (B6).** `waiting: Map<string, number>`; the timer releases the wait only when its token is still the stored one.
  - `an old retry timer cannot release a newer wait`: retryable error (timer 5000), pause, resume, retryable error again (timer 20000), `fire(5000)`: job still `queued`, `media.started.length === 2`; `fire(20000)`: `probing`, length 3.
  - `a retry timer firing after cancel does nothing`: error, cancel, `fire(5000)`: no throw, no start.
- [ ] **7.4 Transition, save, then start; save failures (B9).** `commit()`: apply `start` transitions, prune groups, `save()`, start the engines of the jobs just transitioned, notify. `save()` never throws: a failure sets `saveError = 'could not save the download list: <message>'` and calls `onSaveState` listeners when the text changed; a success after a failure calls them with `null`. While `saveError` is set, one pending timer retries the save (interval: OQ2).
  - `writes the started state before starting the engine`: `log` order `save` then `start`; the saved job is `probing`.
  - `a failing save does not stop the download and add does not throw`: engine started, listener got the message once.
  - `a failing save inside an engine event is caught`: `media.emit(done)` does not throw; state `done`.
  - `tells listeners once per message, and null after the next good save`.
  - `retries the save while it keeps failing`: one timer of the OQ2 interval pending; firing it saves; no second timer while one is pending.
- [ ] **7.5 One budget (B7).** `perJobLimit = speedLimitKbps === 0 ? null : max(1, floor(speedLimitKbps * 1024 / max(maxConcurrent, activeCount)))`. Both engines get it as `ctx.rateLimitBytes`. The queue remembers each active job's value. `setSettings`: for every active job whose value changed: file jobs get `file.setRateLimit`; media jobs in `probing`/`downloading` are restarted through their verb chain (await `stop`, `requeue`, commit); `merging` jobs are left alone. Nothing is recomputed when the active count merely drops. `applyGlobalLimit` is deleted.
  - replace `splits the speed limit...`: limit 900, max 3, add a video and a file: both `ctx.rateLimitBytes === 307200`.
  - replace `starts media jobs unlimited...`: both `null`.
  - replace `applies new settings: limit and slots`: max 1 to 3 starts the two waiting jobs.
  - `a new limit restarts videos that are downloading and re-limits files`: video (after a progress event, `bytesDone: 40`) and file active; `setSettings({speedLimitKbps: 300})`, tick: `media.stopped == [video]`, second media start has `102400` and the job kept `bytesDone: 40`; `file.rateLimits == [[fileId, 102400]]`; `file.stopped == []`.
  - `leaves a merging job alone when the limit changes`.
  - `lowering the slot count with three active changes no limit`: limit 900, max 3, three active; `setSettings({maxConcurrent:1, speedLimitKbps:900})`: no stop, no `setRateLimit` (divisor stays 3).
  - `raising the slot count lowers the running job to its new share`: limit 900, max 1, one active at 921600; max 3: restarted at 307200; every later start 307200.
  - `a pause issued during a limit restart wins`: `stopGate` set, `setSettings`, `job(id,'pause')`, release: final state `paused`.
  - delete `survives a failing global limit call`; add `survives a failing setRateLimit`.
- [ ] **7.6 Shutdown (B12).** `shutdown()`: set `closed`; every job in an ACTIVE state gets `interrupt` and `interrupted: true`; save; call `engine.stop` for each (not through the chains; a stop already pending is shared by the engines); each confirmed stop clears that job's `interrupted`; save again. A rejected stop is ignored and its job stays `interrupted`. While `closed`: `schedule()` starts nothing, engine events and timers do nothing, `job()`/`group()` answer `{ok:false, error:'Hammel is closing'}`.
  - `shutdown stops every active job, including one that is merging`: three jobs, one moved to `merging`: all `paused`, `media.stopped` has all three.
  - `shutdown saves the jobs as cut off before the engines have stopped`: `stopGate` set; before release the last save has `state:'paused', interrupted:true`; after release `interrupted:false`.
  - `a stop that fails during shutdown leaves the job marked as cut off` and `shutdown` still resolves.
  - `nothing starts after shutdown`: queued job present; engine `done` event for another job, `fire(5000)`, `job(id,'resume')`: `media.started` unchanged.
  - `pauseAll` test unchanged (it still skips merging jobs).
- [ ] **7.7 Jobs cut off by a crash (B13).** Constructor: `straysCleared: true` clears `interrupted` on all jobs before the first commit. Otherwise, for a job with `interrupted: true`: `resume` answers `{ok:false, error:'This download was cut off and Hammel could not check that its old process is gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then choose "They are gone" in the banner, or restart Hammel.'}`; `resumeAllPaused` and group resume skip it; cancel is allowed. `confirmStraysGone()` clears every flag and commits.
  - `clears the flag when the check for old processes succeeded`.
  - `refuses to resume a cut-off job when the check failed`: result not ok, state `paused`, no start.
  - `resumeAllPaused skips cut-off jobs and resumes the others`.
  - `a group resume skips its cut-off member`.
  - `after the owner confirms, the job resumes`.
  - `a cut-off job can still be cancelled`.
- [ ] **7.8 Adding: one namespace, placeholders, real height (B2, B3, B15, Q2).** `claimsIn(dir)`: names of all listed jobs whose state is not `skipped` and whose `dirKey(dir)` matches (media: `baseName`; file: `fileName`), plus the folder leaf of every group whose parent `dirKey` matches. Disk names: `readdirSync(dir)` (missing folder: none). Every new name is `freeName(base, ext, n => nameConflicts(n, claims, disk))`. `sameDir`, `takenBaseNames`, `takenFileNames` and the `uniqueName` wrapper are deleted. Skipped placeholders take `reason: entry.reason ?? 'unavailable'`. Media jobs take `sourceHeight = max(probe.heights)` or null; playlist items null. On `probed`: store `sourceHeight`, save, notify; the job stays `probing`.
  - `a video does not take the name of a finished file left on disk`: `Talk.mp4` on disk, add `Talk`: `baseName === 'Talk (2)'` (B3 trigger).
  - `a file download and a queued video cannot share a name, in either order`: video `Clip` then file `Clip.mp4` gives `Clip (2).mp4`; fresh queue, file `Clip.mp4` then video `Clip` gives `Clip (2)`.
  - `a video whose title extends another job's name gets its own name, in either order`: `Clip` then `Clip.f137` gives `Clip (2).f137`; reverse order gives `Clip (2)` for the second.
  - `treats two spellings of one folder as the same folder`: second request with `dir` upper-cased and a trailing `\`: names differ.
  - `a stale aria2 control file blocks the name`: `a.zip.aria2` on disk: `a (2).zip`.
  - `a skipped placeholder does not hold a name`.
  - update `shows unavailable items as skipped from the start`: entries with reasons `private`, `removed`, `unavailable` give jobs with exactly those reasons.
  - `records the real height of a single video when it is added`: `heights: [1080, 720]` gives `sourceHeight: 1080`; playlist items `null`.
  - `stores the height the engine found and saves it`: `media.emit({type:'probed', sourceHeight: 2160})`: job `probing`, `sourceHeight: 2160`, a save happened.
  - existing naming tests (`talk (2)`, `a (2).zip`, `A.ZIP` on disk) keep passing.
- [ ] **7.9 Delete file (B18).** `removeWithFile` on a done job: `rmSync(path)` without `force`. `ENOENT`: row removed, ok. Any other error: row kept, `{ok:false, error:'Could not delete the file: <message>'}`.
  - `keeps the row and reports the error when the file cannot be deleted`: a non-empty directory named `Talk.mp4` at the file's path: result not ok, row still listed, directory intact.
  - `removes the row when the file is already gone`.
  - existing `removeWithFile` tests keep passing.
- [ ] **7.10 Group completion after a cancel (B19).** After a job-level cancel of a job that was not terminal: if its group still has members and all are terminal, announce the group once. Not after `remove`/`removeWithFile`, not after a group cancel.
  - `announces the playlist when its last unfinished item is cancelled`: playlist of 2, `done` A, pause B, cancel B: `finished == [{kind:'group', title, failed:0, skipped:0}]`.
  - `does not announce when a finished row is removed`.
  - `does not announce on a group cancel`; `cancelling the only item announces nothing`.
- [ ] **Step 11:** Gates. Commit: `fix: queue owns names, verbs, saves and shutdown`.

**Acceptance:** `npx vitest run tests/jobs/queue.test.ts`; all three gates.
**Edge cases and races:**
- Verbs during an awaited stop queue behind it (7.1); a verb for another job is not delayed.
- An engine `done` arriving while a pause waits for its stop: the file engine suppresses events during a stop; the media engine too. After a failed stop events flow again and the job is still active, so they apply.
- In-flight verbs at shutdown: their `apply` finds the job already `paused` and does nothing; an in-flight cancel still removes its row.
- Limit restart overlap: a slot freed elsewhere can start a job at the new share while a restarted job is still dying at the old one (under a second; accepted).
- Save keeps failing while idle: only the retry timer writes (OQ2).
- `skipped` jobs hold no name, so a job skipped at run time can leave partial files that only the disk rule protects.
- Jobs listed before this change keep names that were never checked against disk (residual for existing lists).

### Task 8: Tool installation (B10, B11)

**Files:** `src/main/binaries.ts`, `tests/binaries.test.ts`.

Behaviour: `ensureAll` and `updateYtDlp` run through one promise chain per `Binaries` instance. `download()` becomes `pipeline(body, hash-and-progress transform, write stream)`. `BinariesOptions.createWrite?: (path: string) => Writable` (default `createWriteStream`). A write failure rejects with `could not install <name>: disk full` (`ENOSPC`), `could not install <name>: cannot write to folder` (`EACCES`, `EPERM`), else `could not install <name>: <message>`. Cleanup in `finally` tolerates its own errors.

- [ ] **Step 1 (RED):**
  - `runs two updates one after the other`: fetch stub holds the first checksum request; start `u1`, wait until the checksum URL was requested, start `u2`: the asset URL was fetched once so far; release: `fetched` order is asset, sums, asset, sums; both resolve; no leftovers.
  - `a second install request waits and then finds everything installed`: two `ensureAll` at once: each asset fetched exactly once.
  - `reports a disk-write failure and keeps the working yt-dlp`: `createWrite` returns a `Writable` whose `_write` fails with `{code:'ENOSPC'}`: `updateYtDlp` rejects with `could not install yt-dlp: disk full`; `yt-dlp.exe` unchanged; no leftovers; the test run reports no unhandled error.
  - `reports a folder that cannot be written`: code `EACCES`.
- [ ] **Step 2 (GREEN):** implement. **Step 3:** Gates. Commit: `fix: serialize tool installs and report disk-write failures`.

**Acceptance:** `npx vitest run tests/binaries.test.ts`.
**Edge cases:** a failed install must not block the next one in the chain (the chain continues after a rejection); the response stream failing mid-way rejects through the same pipeline.

### Task 9: Startup, cleanup status, IPC and preload (B12 quit, B13, B16, B17, B18 result, C4)

**Files:** `src/main/strays.ts`, new `src/main/engineHost.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/shared/types.ts` (`EngineStatus`, `AppStatus`, `HammelApi`), `tests/strays.test.ts`, new `tests/engineHost.test.ts`, `tests/ipc.test.ts`.

- [ ] **9.1 Stray check reports its result (B13, C6).** `killStrays` returns `true` only when the script ran and exited 0. The script queries, stops, waits (OQ4), queries again and exits 1 when a match remains:
  `$f = { <existing Get-CimInstance | Where-Object pipeline> }; & $f | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 500; if (@(& $f).Count -gt 0) { exit 1 }`
  - `reports success when the script ran`: runner resolves: `true`.
  - `reports failure when PowerShell cannot be run or a process survived`: runner rejects: `false` (replaces `never fails startup...`, which still must not throw).
  - `checks again after ending the processes`: script contains `exit 1` and the filter twice; the four existing fragment tests keep passing.
  The script text is not executable in tests: the owner runs it once by hand, non-destructively, before the commit (as was done for the current script).
- [ ] **9.2 Engine host (B17).** `EngineHost` with injected `toolsInstalled`, `killStrays`, `startAria2`, `createQueue(daemon, straysCleared)`, `onStatus`. `start()` is single-flight: `notInstalled` when a tool is missing; else `starting`, stray check, aria2, queue, `ready`. Any throw: stop an aria2 that was started, status `error` with `The download tools could not be started: <message>`, no queue. `retry()` runs `start()` again from `error`. `queue()` is null unless a queue exists.
  - `is notInstalled while a tool is missing and starts nothing`.
  - `goes starting then ready and hands out the queue`: `onStatus` sequence `starting`, `ready`.
  - `keeps the error and no queue when aria2 cannot start`: status `error` with the message; `queue()` null.
  - `retry after an error starts the engines`: second `startAria2` succeeds: `ready`.
  - `two starts at once start aria2 once`.
  - `stops the aria2 it started when a later step fails`: `createQueue` throws: daemon `stop` called once.
  - `passes the result of the stray check to the queue`: `killStrays` false: `createQueue` got `straysCleared === false`.
- [ ] **9.3 IPC and preload.** `QueueLike.job/group` return `Result<null>` and the handlers pass it through. New handlers `status`, `retryEngines`, `confirmStraysGone`. `add`/`job`/`group` without a queue answer by status: `notInstalled`: `Install the download tools first`; `starting`: `The download tools are still starting`; `error`: its message. `validProbe` (B16 and everything that reaches a Job):
  - file: `fileName === sanitizeFileName(fileName)`, `size` null or finite >= 0, `resumable` boolean.
  - media: `title` string, `heights` an array of at most 100 finite positive numbers.
  - playlist: `index` integer >= 1 and unique; `unavailable` boolean; `reason` in `EntryReason` exactly when `unavailable`, else null; url checked when available.
  Preload adds the four methods; `onStatus` subscribes to `hammel:status`.
  - `refuses a device name, a stream name, a trailing dot and an over-long name as file name`: `CON`, `report.txt:payload`, `a.`, a 151-char name: each `BAD_REQUEST`; `report (2).pdf` accepted.
  - `refuses a file probe with a size that is not a number`; `refuses heights that are not numbers`; `refuses an unavailable entry without a reason and an available one with a reason`; `refuses duplicate playlist positions`.
  - `passes on why a verb failed`: fake queue answers `{ok:false,error:'x'}`: handler returns it.
  - `reports the start error instead of asking to install`: status `error`: `add` answers the message; status `starting`: the starting text; `notInstalled`: the install text.
  - `status returns the engine state and the save error`; `retryEngines` calls the host; `confirmStraysGone` calls the queue and fails with the status text when there is no queue.
  - `what add accepts loads again from disk`: for a media, a file and a playlist request (with a placeholder) run the real handler, a real `Queue` (fake engines) and a real `Store` in a temp folder, then `new Store(...).load()`: `recoveredCorrupt === null` and the jobs are equal.
- [ ] **9.4 aria2 exit while running (C4; drop if the owner says no).** `daemon.onExit`: status `error` with `The file download service stopped`; the queue stays and videos keep working. `retryEngines` in that state starts aria2 again (no stray check: this run's tools are running), calls `FileEngine.attach(daemon)` and sets `ready`.
  - `reports an aria2 exit and keeps the queue`; `retry restarts aria2 without the stray check and attaches it`.
- [ ] **9.5 Wiring in `index.ts` (no unit test; typecheck and checklist).** Build the host with the real functions; push `AppStatus` on `hammel:status` whenever the engine status or `queue.onSaveState` changes; `startupNotice` keeps only the corrupt-list message; `installBinaries` calls `host.start()`; `before-quit` runs `await queue?.shutdown()` then `await daemon.stop()` under the existing 5 s cap; the tray gets the queue from the host.
- [ ] **Step 6:** Gates. Commit: `fix: engine status with retry, checked stray cleanup, strict request validation`.

**Acceptance:** `npx vitest run tests/strays.test.ts tests/engineHost.test.ts tests/ipc.test.ts`; all three gates; `npm run build` succeeds.
**Edge cases and races:** the window asks `status()` before or after the push (state, so either order gives the same result); `retryEngines` clicked twice (single-flight); `installBinaries` finishing while startup's own `start()` runs (single-flight); the 5 s quit cap firing before `shutdown` ends (jobs are already saved as `paused` + `interrupted`, so the next start checks for leftovers); a stray check that fails on B17 Retry gives `straysCleared: false` again.

### Task 10: Window (B9, B13, B15, B17, N1)

**Files:** new `src/renderer/src/banners.ts`, `src/renderer/src/format.ts`, `src/renderer/src/strings.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/AddDialog.tsx`, `src/renderer/src/styles.css`, new `tests/renderer/banners.test.ts`, `tests/renderer/format.test.ts`.

Behaviour:
- `banners(status, snapshot): Banner[]`, in this order:
  - engine `error`: text = `status.engine.message`, action `retryEngines`.
  - `saveError !== null`: text = `saveError`, no action.
  - any job with `interrupted`: text `Some downloads were cut off and Hammel could not check that their old processes are gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then confirm.`, action `confirmStraysGone` (button `They are gone`, behind `window.confirm`).
  None of them has a close button. The existing dismissible message banner stays for one-off errors.
- `App`: subscribes `onStatus`, then calls `status()`. Shows the setup screen when `engine.state === 'notInstalled'`; no longer derives readiness from `binaries()`.
- `allowedVerbs`: a `paused` job with `interrupted` offers `['cancel']`. `statusText`: `paused 40% · waiting for a check` (`paused · waiting for a check` without a size).
- `AddDialog`: an unavailable entry shows `S.entryReasons[entry.reason]`.
- `strings.ts`: `entryReasons` (`satisfies Record<EntryReason, string>`), banner texts, `retry`, `theyAreGone`, `confirmStraysGone`; `speedLimitHint` becomes `Changing the limit restarts videos that are downloading; they continue from where they were.`; the top comment (N1) becomes: `Text of the window's own controls and dialogs. Status words, reasons from the main process, tray text and notifications are not collected here yet.`

- [ ] **Step 1 (RED):** `tests/renderer/banners.test.ts`: `shows nothing when all is well`; `shows the engine error with Retry`; `shows no engine banner while starting or ready`; `shows the save error without a button`; `shows the cut-off banner only while a job is cut off`; `orders engine, save, cut-off`. `tests/renderer/format.test.ts`: `a cut-off job offers only Cancel`; `says a cut-off job waits for a check`.
- [ ] **Step 2 (GREEN):** implement. **Step 3:** Gates and `npm run build`. Commit: `feat: persistent banners for engine, save and cut-off downloads`.

**Acceptance:** `npx vitest run tests/renderer`; gates; the rendered banners themselves are checked by the manual checklist (no DOM tests exist in this project).
**Edge cases:** all three banners at once; the engine banner while the setup screen shows (not rendered there: setup has its own error line); a Retry that fails again replaces the text.

### Task 11: Documents (B20, Q2, Q4, checklist)

**Files:** `README.md`, `docs/manual-checklist-phase1.md`. Not edited: `docs/superpowers/plans/2026-11-22-phase1-app.md` (frozen, C3) and the design doc.

- [ ] `README.md`
  - Develop: "The tests use no **external** network and no real tools; some start a server on 127.0.0.1 and talk to it."
  - Where things live (Q4): "`%APPDATA%\hammel\bin` belongs to the app alone. At start Hammel ends every yt-dlp, ffmpeg or aria2c process running from that folder. Do not start these copies by hand."
  - First start: the aria2 sentence now says the checksum is pinned.
- [ ] `docs/manual-checklist-phase1.md`
  - intro: "never touch the external network".
  - change 4: Best on a video of 1080p or lower gives `.mp4` (H.264); on a 4K video gives `.mkv`.
  - change 17: one video and one file together stay near the limit in total; changing the limit while they run restarts the video, which continues.
  - change 20: Quit during "finishing…" leaves no yt-dlp or ffmpeg process; the job is `paused` at next start and Resume finishes it.
  - new lines:
    - Best on a playlist item (the height check runs first; note the delay).
    - "Always save as mp4" on a source that is not mp4 gives a playable `.mp4` (remux).
    - Audio only with an existing output and after pause/resume (Q2: `-x` with the printed path).
    - Break aria2 (rename `aria2c.exe` while the app is closed), start: the banner shows with Retry; restore the file, Retry: the banner goes and Add works.
    - Make `%APPDATA%\hammel\jobs.json` unwritable during a download: the save banner appears, downloads continue; make it writable: the banner goes within a minute.
    - Kill Hammel during a download, then start it: no old tool process remains and Resume works. With the check made to fail (owner's choice of method): the cut-off banner shows, Resume is refused, "They are gone" enables it.
    - Pause all twice quickly, then Resume all: each file download runs once.
    - Delete file on a finished video that is open in a player: the row stays with a reason.
    - Cancel a half-downloaded video from a site other than YouTube: note any leftover files and their names (C9).
    - A playlist with a private and a deleted item: each shows `skipped` with its own reason.
  - Known limits: remove the speed-limit line; add "A video cut off while its parts were being joined can leave a `.temp` file".
- [ ] Ledger (`.superpowers/.../progress.md`, not in git): one line per fix, RED to GREEN, with the test names. Commit: `docs: review-fix wording, checklist lines, tool folder note`.

**Acceptance:** `npm run lint` (if it covers markdown; otherwise read-through), links resolve.

### Task 12: Close

- [ ] Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, serially. Expected: all exit 0, more than 370 tests, none skipped.
- [ ] Read `queue.ts` `shutdown`, `file.ts` `stop` and `validate.ts` once more against the Review Focus.
- [ ] Hand the diff to the remaining Codex re-review pass (thread `01a202d9-93fe-7ff1-947a-db6d2a014bc7`), with new untracked files listed separately.

## Migration of existing data files

`jobs.json` (written by today's code, `version: 1`):

| Field | Absent in old files | Read as |
| --- | --- | --- |
| `Job.interrupted` | yes | `false`; then `true` for a job found in an ACTIVE state at this load |
| `Job.sourceHeight` | yes | `null` |
| everything else | no | unchanged |

- The file keeps `version: 1`; the next save writes the two new fields.
- Old files pass the new validation: urls were checked at add time, placeholders (`skipped`, url `''`) are allowed, persisted file names get the structural rule only (C11), `baseName` of today's code is at most about 165 chars (limit 200).
- An old paused "Best" job with data (`bytesDone > 0`) keeps the mkv path, so its partial files stay usable. An old "Best" job with no data yet gets the height check on its next start.
- Jobs already listed keep their names; the new namespace applies to names given from now on.
- Rollback: the previous build reads a file written by this one (its check is looser and ignores extra fields). No conversion in either direction.

`settings.json`: no new field. A valid old file loads unchanged. A wrong field falls back alone to its default: `downloadDir` `Downloads\Hammel`, `askEveryTime` false, `maxConcurrent` 3, `speedLimitKbps` 0, `autoResumeOnStart` false, `preferMp4Max1080` false, `defaultQuality` `{kind:'best'}`, `subtitleLangs` `[]`.

Per the owner's rule, the Task 4 diff (validation and migration) is reviewed by the owner before its commit.

## Open questions for the owner

| # | Question | Suggested |
| --- | --- | --- |
| OQ1 | aria2 alive but not answering: after how many consecutive silent polls is the job shown as not moving, and is aria2 ever ended by the app for it? | 5 polls (2.5 s) zero the shown speed; never end aria2 automatically (quit and restart recovers) |
| OQ2 | While `jobs.json` cannot be written: how often to retry, and may the banner be closed? | retry every 60 s; not closable; goes away on the first good save (C2) |
| OQ3 | Time limit of the per-item height check (Q2). | 30 s, the existing probe default; on expiry a retryable `timed out reading the link` |
| OQ4 | Wait between ending leftover processes and the second query. | 500 ms |
| OQ5 | In-session "Check again" for B13 needs a rule that spares this run's own tools: by process creation time (needs a clock tolerance: which?) or by process tree (yt-dlp's own child layout is unverified). | not in this change; restart or "They are gone" (C5) |
| OQ6 | Add `.temp.<ext>` and non-numeric `f<id>` to the shapes Cancel may delete? | no until the checklist shows the real names (C9) |
| OQ7 | B19: a playlist whose remaining items are all `skipped` after the cancel: still announce "Playlist finished"? | announce only when at least one remaining item is `done` or `failed` |
| OQ8 | C1, C4, C7: confirm the fourth engine state, the aria2 restart on Retry, and `max` qualities staying as they are. | yes, yes, yes |

## Still unverified after this plan

Q1 and Q3 in full; for Q2 the real format selection, `--remux-video` on a precombined input and the height check's output; what aria2 1.37.0 answers to `remove` and `tellStatus` for a finished or unknown gid; `max-download-limit` through `changeOption` on a running download; the PowerShell text of the stray check; every banner on screen. All are lines in `docs/manual-checklist-phase1.md`.