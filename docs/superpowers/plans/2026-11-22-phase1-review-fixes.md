# Hammel Phase 1 Review Fixes Implementation Plan

> **Execution:** by lanes, per the owner's decision of 2026-11-22. For each remaining task a tests lane writes every failing test of the task from this frozen plan only; then an implement lane writes the code and may not edit the tests. Task 8 is the exception (quick-fixes lane). Lanes do not commit and do not run the full suite; the orchestrator runs the gates serially and makes one commit per task.

**Goal:** Close every item of the agreed fix list (ledger lines 62-80: B2-B20, Q2, Q4, N1, N2) so the Codex verdict can move from BLOCKING to acceptable-pending-the-manual-checklist. B1 is already committed (`a82a6ac`) and is not part of this plan.

**Owner rulings:** C1-C12 and OQ1-OQ8 are ruled as suggested in this plan (2026-11-22); none is open. Two more rulings of the same day: every aria2 JSON-RPC call has a 5 s time limit (OQ9), and a media engine stop waits at most 10 s (OQ10). Each ruling is written into the task that implements it.

**Architecture:** No new pieces. Ownership becomes explicit in three places: names (one namespace per folder), processes (an engine keeps a job until its stop is confirmed; the queue serializes verbs per job) and state (transition, save, then side effect). One new pure module (`src/main/jobs/validate.ts`) and one new injectable module (`src/main/engineHost.ts`) so that startup logic is testable without Electron.

**Tech Stack:** unchanged (Electron 45, TypeScript 6 strict with `noUncheckedIndexedAccess`, React 19, Vitest 5, ESLint 10). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-22-download-manager-design.md` (authority). Scope source: `.superpowers/sdd/2026-11-22-phase1-app/progress.md` lines 59-81. Where `debate-brief.txt` and the ledger differ, the ledger wins (B2, B3, B5, B7, B13, Q2).

**Gates (run serially, by the orchestrator only):** `npm run typecheck`, `npm run lint`, `npm test`. Baseline: 532 tests pass (Tasks 1-3 committed, Task 4 in the worktree).

**Status of the tasks:**

| Task | Status |
| --- | --- |
| 1, 2, 3 | committed (`d0cea1a`, `983636b`, `e655c2b`) |
| 4 | implemented, uncommitted; final rules per the Task 4 review; the owner reviews its diff before the commit |
| 5-12 | to do, in the order below |

## Execution order and lanes

| Stage | Tasks | Lanes | Rough time (estimate) |
| --- | --- | --- | --- |
| 0 | 4 (amendment A1-A9) | tests lane, then implement lane; the orchestrator commits Task 4 before stage A starts (Task 6 edits `queue.ts`, which Task 4 also touches) | tests 15-25 min, implement 10-15 min |
| A | 5, 6, 8 in parallel | 5 and 6: tests lane, then implement lane, each. 8: one quick-fixes lane. | tests 10-15 min each; implement 20-30 min each; Task 8 about 20 min |
| B | 7 | tests lane (all of 7.1-7.10 in one pass), then implement lane | tests about 30 min; implement about 45 min |
| C | 9, with 11 (docs lane) alongside | 9: tests lane, then implement lane. 11: docs lane. | 9: tests 20 min, implement 30 min; 11: 10 min |
| D | 10 | tests lane, then implement lane | 10 min, then 15 min |
| E | 12 | orchestrator | gates about 5 min, then the review lane |

Rules for every stage:
- A lane runs only the specs of its own task (`npx vitest run <its spec files>`). It does not run typecheck, lint or the whole suite: in stage A the other lanes' files are half-written.
- After a stage the orchestrator runs the three gates once, serially, then commits one task at a time by path (stage A: Task 5 paths, Task 6 paths, Task 8 paths).
- Stage A file ownership is disjoint: Task 5 owns `engine.ts`, `media.ts`, `media.test.ts`, `fake-ytdlp.mjs`; Task 6 owns `file.ts`, `file.test.ts`, `fake-aria2.ts` and a two-line shim in `queue.ts`; Task 8 owns `binaries.ts`, `binaries.test.ts`. `tests/helpers.ts` and `tests/wait.ts` are read-only for all three.
- Task 10 needs Task 9's `types.ts`, so it runs after Task 9 is committed.
- Task 4 (with amendment A4) closes the window-side hole itself, so nothing waits for Task 9 on that account. The Task 9 tests lane does not rewrite the `refuses ...` specs or the round-trip spec; it only adds `straysCleared: true` to the round-trip Queue.

## Global Constraints

- All Global Constraints of the phase 1 plan still hold, with one amendment (B20): **tests use no external network and no real binaries.** A loopback socket to a server the test itself starts is allowed, and so is a child process of the test's own Node.
- Every test named below is written first and must fail before the code exists (tests lane), then pass (implement lane). N2 is met by these tests; there is no separate N2 task.
- A value that crosses main, preload and renderer has exactly the meaning given in "Types and contracts". No other meaning may be attached to it.
- Never delete a file that is not provably the job's own. A leftover beats a deletion.
- An engine releases a job only when its stop is confirmed. The queue frees a slot only when the engine released the job.
- A number that comes from a tool is stored on a job only when the persisted-data validator would accept it (Task 4 rule; extended to `sourceHeight` in Tasks 5 and 7.8).
- Nothing in this plan runs the real yt-dlp, ffmpeg or aria2. Every statement about their behaviour stays "unverified" and goes to the manual checklist.
- Git: branch `feat/phase1-app`, one commit per task, made by the orchestrator, no push by lanes.

## Probes run before freezing

Run by the orchestrator on 2026-11-22 with Node 24.14.1, one process per case, outside the repository. Electron 45.4.1 bundles its own Node; for it these facts are checklist-only.

| # | Fact | Used by |
| --- | --- | --- |
| P1 | PowerShell through `execFile`: `exit 1` gives code 1. The new stray script exits 0 with no match (1.6 s), exits 1 when the CIM query fails under `$ErrorActionPreference='Stop'`, and ended a real `yt-dlp.exe` running from the given folder with exit 0 (1.7 s). All far below the 15 s limit. | 9.1 |
| P2 | `rmSync(path)` without `recursive` on a non-empty directory throws code `ERR_FS_EISDIR` and leaves the directory intact; on a missing path it throws `ENOENT`. | 7.9 |
| P3 | `pipeline(Readable.fromWeb(body), Transform, Writable failing with code ENOSPC)` rejects with `e.code === 'ENOSPC'` and no unhandled error. With a source that errors mid-way and a real `createWriteStream`, `pipeline` rejects with the source error and an immediate `rmSync(dest, {force:true})` succeeds: no leftover, no unhandled error. | 8 |
| P4 | `fetch` with `AbortSignal.timeout(500)` against a loopback server that never answers rejects with `TimeoutError` after about 515 ms. | 6 |
| P5 | A child spawned with `stdio: 'ignore'` and ended from outside fires `'exit'`. | 6 (`alive()`), 9.4 |

## Review Focus

1. **Name ownership:** two jobs (any engine) or a job and a disk file can never share an output or partial-file name, whichever was added first. Tasks 2, 5, 7.8.
2. **Process ownership:** no path marks a job paused, cancelled or retried while its download may still run. Tasks 5, 6, 7.1, 7.2, 7.6.
3. **Stale timers and late verbs:** a retry timer, a notify timer or a queued verb acting on a job whose state moved on. Tasks 7.1, 7.3, 7.6.
4. **Old data files:** a `jobs.json` or `settings.json` written by today's code loads unchanged and is never set aside; nothing the app saves can make its own next load set the list aside. Tasks 4, 7.2, 7.8, 9.3.
5. **Banner truth:** each banner is state, not an event; it disappears only when its cause is gone. Tasks 7.4, 9, 10.

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
- Holding queued file jobs while aria2 is down (they fail after their retries; see Task 9.4).
- Making a playlist's folder name unique (Task 7.8 states the residual).

## Conflicts (ruled by the owner as "Plan assumes", 2026-11-22)

| # | Conflict | Ruling (as the plan assumed) |
| --- | --- | --- |
| C1 | B17 names three engine states (starting, ready, error). "Tools not installed" then has no value, and reusing `starting` for it would be a second meaning. | A fourth state `notInstalled`. The window's setup screen is driven by it instead of by `binaries()`. |
| C2 | B9: debate brief says the save banner is "repeated at most once a minute"; ledger and B17 say one persistent banner. A persistent banner has nothing to repeat. | Persistent, not dismissible, cleared by the next successful save. "Once a minute" becomes the save retry interval (OQ2). |
| C3 | B20: ledger says "the plan wording becomes no external network". `docs/superpowers/plans/2026-11-22-phase1-app.md` is an executed plan. | That plan is treated as frozen and is not edited. The wording goes into this plan's Global Constraints, `README.md` (Develop) and `docs/manual-checklist-phase1.md` (intro). The design doc line 218 ("no network") is the authority and stays as is unless the owner amends it. |
| C4 | B5 defines "dead daemon" but nothing restarts aria2; after it dies every file job fails until the app restarts. | Dead = the aria2 child process exited. On an unexpected exit the engine status becomes `error` and the B17 Retry restarts aria2 (Task 9.4). |
| C5 | B13 "cleanup succeeds on retry": an in-session retry of `killStrays` would also kill this run's own aria2, yt-dlp and ffmpeg (same folder filter). | No in-session retry. The check runs again at the next app start (before any tool starts) and on B17 Retry while no engine runs. In session the owner can only confirm ("They are gone"). |
| C6 | B13 does not define "cleanup fails". Today the script ignores a process it could not end and still exits 0. | Success = script exits 0 **and** a second query finds no matching process. |
| C7 | Q2 names only "Best". `Up to 1440p/2160p` on a source that is 1080p or lower has the same mismatch (mkv with any codec). | Unchanged for `max`; only `best` uses the real height. |
| C8 | Q2 needs the real height for playlist items, which the flat probe does not give: one extra `yt-dlp -J` run per item, and one new persisted field. Neither is verified against the real tool. | Planned as written in the ledger (pre-probe in the `probing` state). |
| C9 | B2 strict shapes use `f<N>` (digits). Sites with non-numeric format ids, and a merge killed by B12 (`<base>.temp.<ext>`), leave files that Cancel no longer removes. | Strict shapes as agreed; leftovers accepted; checklist line added. |
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
  /** Q2. Highest video height the site offered when probed; null = not known.
   *  When a number: finite and > 0 (the validator's rule). */
  sourceHeight: number | null;
}
export type EntryReason = 'private' | 'removed' | 'unavailable';
export interface PlaylistEntry {
  index: number; url: string; title: string; unavailable: boolean;
  /** B15. Non-null exactly when unavailable is true. Copied into Job.reason. */
  reason: EntryReason | null;
}
/** B17 (C1). notInstalled: a tool is missing, no queue. starting: tools present, start or
 *  restart running (also the value before the first start() call). ready: queue exists and
 *  aria2 runs. error: start failed (no queue) or aria2 exited (queue exists, file downloads
 *  cannot run); Retry applies. */
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
// src/main/jobs/state.ts: two new events (Task 1, committed)
interrupt: { probing: 'paused', downloading: 'paused', merging: 'paused' }  // shutdown only; speed 0, eta null
requeue:   { probing: 'queued', downloading: 'queued' }                     // limit restart; keeps bytes, attempts; reason null

// src/main/engines/engine.ts (Task 5)
EngineEvent += { type: 'probed'; sourceHeight: number }   // always finite and > 0; an engine never emits another value
Engine.stop(jobId): Promise<void>   // resolves = confirmed stopped; rejects = not confirmed: the engine
                                    // still owns the job and keeps reporting. Holds for both engines.
Engine.discard(job): Promise<void>  // rejects, deleting nothing, when the stop is not confirmed

// src/main/engines/media.ts (Task 5)
new MediaEngine(ytdlp: Exe, ffmpegPath: string, opts?: {
  probeTimeoutMs?: number;                 // default 30000 (OQ3)
  stopTimeoutMs?: number;                  // default 10000 (OQ10)
  kill?: (child: ChildProcess) => void;    // default: the existing taskkill /T /F with child.kill() fallback
})
export function isPartialOf(fileName: string, baseName: string): boolean

// src/main/engines/file.ts (Task 6)
export class Aria2RpcError extends Error { code: number | null }  // aria2 answered with an error
export class Aria2TransportError extends Error {}                 // no usable answer, including the time limit
export function createRpcClient(port: number, secret: string, fetchImpl?: typeof fetch, timeoutMs?: number): Aria2Rpc
                                                                  // timeoutMs default 5000 (OQ9)
export interface Aria2Daemon { rpc: Aria2Rpc; alive(): boolean; onExit(cb: () => void): void; stop(): Promise<void> }
export function daemonHandle(child: ChildProcess, rpc: Aria2Rpc): Aria2Daemon   // used by startAria2
export function startAria2(exePath: string, dataDir: string): Promise<Aria2Daemon>
new FileEngine(rpc: Aria2Rpc, opts?: { pollMs?: number; daemonAlive?: () => boolean })
                                                                  // defaults: pollMs 500, daemonAlive () => true
FileEngine.setRateLimit(jobId: string, bytesPerSec: number | null): Promise<void>
FileEngine.attach(daemon: Aria2Daemon): void                      // see Task 6 for its meaning
// removed: FileEngine.setGlobalLimit

// src/main/jobs/queue.ts (Task 7)
export const SAVE_RETRY_MS = 60000                                // OQ2
QueueDeps: file: Engine & { setRateLimit(jobId: string, bytesPerSec: number | null): Promise<void> };
           straysCleared?: boolean   // Task 7: optional, default true (shim); Task 9.5: required
Queue.job(id, verb): Promise<Result<null>>;  Queue.group(id, verb): Promise<Result<null>>
Queue.shutdown(): Promise<void>;  Queue.confirmStraysGone(): void
Queue.onSaveState(listener: (error: string | null) => void): void // calls the listener at once with the
                                                                  // current value, then on every change

// src/main/naming.ts (Task 2, committed)
sanitizeFileName(raw: string): string            // full Windows leaf: ext <= 16, whole name <= 150
dirKey(dir: string): string                      // win32.resolve(dir).toLowerCase()
nameConflicts(candidate: string, claims: Iterable<string>, disk: Iterable<string>): boolean
freeName(base: string, ext: string, taken: (name: string) => boolean): string   // replaces uniqueName

// src/main/strays.ts (Task 9.1)
killStrays(binDir, run?): Promise<boolean>       // true = script ran and exited 0 (second query empty); never rejects

// src/main/engineHost.ts (Task 9.2, 9.4)
export interface EngineHostDeps<Q> {
  toolsInstalled(): Promise<boolean>;            // all three tools present
  killStrays(): Promise<boolean>;                // never rejects
  startAria2(): Promise<Aria2Daemon>;            // rejects when aria2 cannot start
  createQueue(daemon: Aria2Daemon, straysCleared: boolean): Q;   // synchronous; may throw
  attachDaemon(daemon: Aria2Daemon): void;       // 9.4: FileEngine.attach on the engine createQueue built
  onStatus(status: EngineStatus): void;          // called when the status changes (state or message), not otherwise
}
export class EngineHost<Q> {
  constructor(deps: EngineHostDeps<Q>)
  status(): EngineStatus          // { state: 'starting' } before the first start(); that initial value is not announced
  queue(): Q | null               // null unless a queue exists
  daemon(): Aria2Daemon | null    // the running or last started daemon, for quit
  start(): Promise<void>          // single-flight; never rejects; the outcome is status()
  retry(): Promise<void>          // never rejects; acts only from 'error', otherwise resolves at once
}

// src/main/ipc.ts (Task 7 shim, Task 9.3 final)
QueueLike: job(id, verb): Promise<Result<null>>; group(id, verb): Promise<Result<null>>;
           confirmStraysGone(): void             // plus the existing members
           // Task 7 only: job/group typed Promise<unknown> (shim, handlers unchanged); 9.3 makes them Result
HandlerDeps += status(): AppStatus;              // engine status from the host + the last save error
               retryEngines(): Promise<void>;    // host.retry()
               // afterInstall(): Promise<void> stays; it is host.start() and no longer rejects
Handlers += status(): Promise<AppStatus>; retryEngines(): Promise<Result<null>>; confirmStraysGone(): Promise<Result<null>>

// src/renderer/src/banners.ts (Task 10)
export type BannerAction = 'retryEngines' | 'confirmStraysGone';
export interface Banner { id: 'engine' | 'save' | 'cutOff'; text: string; action: BannerAction | null }
export function banners(status: AppStatus, snapshot: Snapshot): Banner[]
```

What `start()`, `retry()`, `retryEngines` and `installBinaries` return:
- `EngineHost.start()` and `retry()` always resolve. Failure is the `error` status.
- ipc `retryEngines`: awaits `deps.retryEngines()`, then answers `{ok:true}` when `deps.status().engine.state === 'ready'`, else `{ok:false, error: <status text>}`.
- ipc `installBinaries`: `ensureAll`, then `afterInstall()`, then `{ok:false, error: message}` when the engine status is `error`, else `{ok:true}`. An `ensureAll` rejection is reported as today.
- Status text (one function in `ipc.ts`): `notInstalled`: `Install the download tools first`; `starting`: `The download tools are still starting`; `error`: its message.

Consumers that change with each value:

| Value | Written by | Read by |
| --- | --- | --- |
| `Job.interrupted` | store load (Task 4), `Queue.shutdown`, `Queue` constructor, `confirmStraysGone` (Task 7) | validate.ts, queue resume paths, `format.allowedVerbs`/`statusText`, `banners()`; tray "Resume all" skips such jobs through `resumeAllPaused` |
| `Job.sourceHeight` | `Queue.add` (from `probe.heights`), queue on `probed`; both only when finite > 0 | validate.ts, `MediaEngine.start`, `downloadArgs`; not shown in the window |
| `probed.sourceHeight` | `MediaEngine` from `parseProbe(...).heights[0]` (Task 5) | queue 7.8 (re-checks finite > 0) |
| `PlaylistEntry.reason` | `parseProbe` | ipc `validProbe`, `Queue.add` (into `Job.reason`), `AddDialog` (label), `strings.ts` |
| `AppStatus` | `EngineHost` + `Queue.onSaveState`, composed and pushed by index.ts | ipc `status`, preload, `App.tsx`, `banners()`, ipc `add/job/group` error text |
| `Result` from `job`/`group` | queue | ipc (passed through from 9.3), `JobRow`/`GroupRow` (already show `res.error`) |
| per-job rate limit (bytes/s, null = none) | queue `perJobLimit` | `StartContext.rateLimitBytes` for both engines, `FileEngine.setRateLimit` |
| `Aria2Daemon` | `startAria2` (Task 6) | `EngineHost` (9.2, 9.4), `FileEngine.attach`, index.ts quit (9.5) |
| `QueueDeps.straysCleared` | `EngineHost` from `killStrays` (9.1, 9.2) | queue constructor (7.7) |

---

### Task 1: Contracts for jobs and the state machine

**Status: committed `d0cea1a`.** Kept for reference.

**Covers:** groundwork for B7, B12, B13, Q2. **Files:** `src/shared/types.ts`, `src/main/jobs/state.ts`, `tests/jobs/state.test.ts`, `tests/helpers.ts`, `src/main/jobs/queue.ts` (two initialisers only).

- [x] Tests in `tests/jobs/state.test.ts`:
  - extend the transition table: `interrupt` from probing, downloading, merging gives `paused`; `requeue` from probing, downloading gives `queued`.
  - `rejects requeue during the merge`: `transition(merging, {type:'requeue'})` throws `IllegalTransition`.
  - `interrupt stops the meters`: job with speed 900, eta 12 ends with speed 0, eta null, bytesDone kept.
  - `requeue keeps the progress and the attempts`: bytesDone 50, attempts 2 are kept, reason null.
- [x] Code: both events in `TABLE` and `transition`; `Job.interrupted`, `Job.sourceHeight`; `makeJob` defaults `interrupted: false, sourceHeight: null`; `Queue.add` `base` the same two defaults (real values come in Task 7.8).

**Edge cases:** `pause` stays illegal from `merging` (the user's Pause must not kill a merge; only shutdown does).

### Task 2: Names (B2, B3, B16 pure parts)

**Status: committed `983636b`.** Kept for reference.

**Files:** `src/main/naming.ts`, `src/main/probe.ts`, `tests/naming.test.ts`, `tests/probe.test.ts`.

Behaviour:
- `sanitizeFileName(raw)`: last path segment only, then split at the last dot. Stem goes through `sanitizeName` rules. Extension: forbidden characters and whitespace removed, cut to 16. Stem cut so that `stem.ext` is at most 150. No trailing dot or space. Device-name stem (before the first dot) gets `_`. Empty result is `download`. Must be idempotent.
- `dirKey(dir)` = `win32.resolve(dir).toLowerCase()`.
- `nameConflicts(candidate, claims, disk)`, case-insensitive:
  - against a claim `c` (another job's name): `candidate === c`, or one is the other plus `.` plus anything (symmetric dot-prefix).
  - against a disk name `d`: `d === candidate` or `d` starts with `candidate + '.'` (one direction only: an inert file `a` does not block `a.zip`).
- `freeName(base, ext, taken)`: for n = 1, 2, 3... try `base[ (n)].ext`, then the head form `head (n)tail.ext` where `head` is `base` up to its first dot (empty head becomes `_`). First name with `taken(name) === false` wins. The head form is what ends the loop when the conflict is a dot-prefix (`Clip.f137` next to job `Clip` gives `Clip (2).f137`).
- `probe.fileNameFrom` returns `sanitizeFileName(...)`.

- [x] Tests in `tests/naming.test.ts`:
  - `sanitizeFileName` table, each row also asserted idempotent: `CON` gives `_CON`; `com1.txt` gives `_com1.txt`; `report.txt:payload` has no colon; `a.` gives `a`; `..\..\evil.exe` gives `evil.exe`; `'x'.repeat(150) + '.' + 'y'.repeat(150)` has length at most 150 and an extension of 16; `'.'` and `''` give `download`; an Arabic name is kept.
  - `nameConflicts`: (`Clip`, claims [`clip`]) true; (`Clip.f137`, [`Clip`]) true; (`Clip`, [`Clip.extra`]) true; (`Clip 2`, [`Clip`]) false; (`a.zip`, [`a.pdf`]) false; disk: (`Talk`, disk [`Talk.mp4`]) true; (`a.zip`, disk [`a.zip.aria2`]) true; (`a.zip`, disk [`a`]) false; (`a.zip`, disk [`A.ZIP`]) true.
  - `freeName`: the three existing `uniqueName` cases ported; `freeName('Clip.f137','', n => nameConflicts(n,['Clip'],[]))` is `Clip (2).f137`; `freeName('a.tar','gz', taken by claim 'a')` is `a (2).tar.gz`; terminates when `(2)` and `(3)` are taken.
  - `dirKey('D:\\Dl\\')`, `dirKey('d:/dl')`, `dirKey('D:\\Dl\\x\\..')` are equal.
- [x] Tests in `tests/probe.test.ts`:
  - `caps a server-chosen name at 150 characters with a 16-character extension`: Content-Disposition with a 150-char stem and 150-char extension; `fileName.length <= 150`.
  - `makes a device name safe`: `filename="CON"` gives `_CON`.
- [x] Code: implemented. A thin `uniqueName` wrapper over `freeName` stays until Task 7.8 deletes it.

**Edge cases:** surrogate pair at the cut (existing `truncate`); extension that is empty after cleaning (name has no dot); `dirKey` does not resolve junctions, `subst` drives or 8.3 names (residual, accepted). Visible effect to know: adding "Node.js Tutorial" while a job "Node" is listed in the same folder gives `Node (2).js Tutorial`.

### Task 3: yt-dlp output and arguments (B14, B15, Q2 arguments)

**Status: committed `e655c2b`.** Kept for reference.

**Files:** `src/shared/types.ts` (`EntryReason`, `PlaylistEntry.reason`), `src/main/ytdlp/parse.ts`, `src/main/ytdlp/args.ts`, `tests/ytdlp/parse.test.ts`, `tests/ytdlp/args.test.ts`, fixtures in `tests/jobs/queue.test.ts` (`entries()`) and `tests/ipc.test.ts` (`list`) gain `reason`.

Behaviour:
- `classifyError` rule order (C10): DRM; login `/sign in|log in|login required|cookies|members-only|confirm your age|age[- ]restricted/i` gives failed `login required`; region; `/private video/i` gives skipped `private`; removed.
- `parseProbe`: every position of `entries` yields an entry. `null`, a non-object or an entry without url: `{ index, url: '', title: title ?? 'Item N', unavailable: true, reason: 'unavailable' }`. Title `[Private video]`: reason `private`. `[Deleted video]`: reason `removed`. Available: `reason: null`. For a single video, `heights` holds only finite numbers > 0, highest first.
- `downloadArgs` gets `sourceHeight: number | null`:
  - `best`, not prefer-mp4: `sourceHeight !== null && sourceHeight <= 1080` uses the H.264 path `mp4Format(1080)`; otherwise `-f bv*+ba/b --merge-output-format mkv`.
  - prefer-mp4 (any quality but audio): as today plus `--remux-video mp4`.
  - `max` and `audio`: unchanged (C7).
- `heightProbeArgs(url)`: `['-J', '--no-playlist', '--no-warnings', '--', url]`.

- [x] Tests in `tests/ytdlp/parse.test.ts`:
  - changed row: `Private video. Sign in if you have been granted access` is failed / `login required`.
  - added rows: `Video unavailable. This video is not available in your country` is skipped / `unavailable in region`; `This video is age-restricted` is failed / `login required`; bare `ERROR: [youtube] x: Private video` is skipped / `private`; `Video unavailable. Sign in ... not available in your country` is failed / `login required`.
  - `reads a playlist...`: expected list gains `{ index: 3, url: '', title: 'Item 3', unavailable: true, reason: 'unavailable' }`, reasons `private` (4), `removed` (5), `unavailable` (6), `null` (1, 2).
  - `keeps playlist positions when an entry is missing`: `[null, {url,title:'Two'}]` gives two entries, index 1 unavailable and index 2 available.
  - `keeps a placeholder for an entry that is not an object`: `entries: ['x', 7]` gives two unavailable entries.
- [x] Tests in `tests/ytdlp/args.test.ts`:
  - `Best takes the H.264 mp4 path when the source is 1080p or lower`: `sourceHeight: 1080` and `720` give `-f AVC_1080`, merge `mp4`.
  - `Best keeps the codec in mkv above 1080p`: `sourceHeight: 2160` gives `bv*+ba/b`, `mkv`.
  - `Best with an unknown height keeps the mkv path`: `sourceHeight: null`.
  - both prefer-mp4 tests: also `valueOf(args,'--remux-video') === 'mp4'`; without prefer-mp4 `--remux-video` is absent.
  - `heightProbeArgs` equals the array above.
- [x] Code: implemented. `MediaEngine` passes `sourceHeight: job.sourceHeight` (the pre-probe is Task 5).

**Edge cases:** existing row `unable to download webpage` must stay retryable (the word "age"); media test `reports a private video as skipped` (bare message) must still pass unchanged.

### Task 4: Persisted data validation and migration (B8, B13 load flag)

**Status: implemented, uncommitted; amended by the Task 4 review.** Codex (gpt-6-astra xhigh) reviewed the implementation: FIX FIRST, T4-1..T4-4 BLOCKING, T4-5..T4-7 NON-BLOCKING. In the debate it accepted every author fix below; with them implemented and verified its verdict is COMMIT. The amendment ("Task 4 amendment" below) overrides any row of this task it contradicts. Remaining work: the tests lane writes the amendment specs, the implement lane changes the code, the orchestrator runs the gates and commits locally; the owner reviews the diff before any push.

**Files:** new `src/main/jobs/validate.ts`, `src/main/jobs/store.ts`, `src/main/ipc.ts` (validators and `validProbe`, amendment A4), `src/main/jobs/queue.ts` (`count()` guard), `tests/jobs/store.test.ts`, new `tests/jobs/validate.test.ts`, `tests/jobs/queue.test.ts` (one spec), `tests/ipc.test.ts` (amendment A4).

Behaviour:
- `parseSnapshotFile(raw: unknown): Snapshot | null` builds new objects from known keys only (unknown keys dropped). Any invalid job or group returns `null`, and the store sets the file aside as today.
- Job rules:

| Field | Valid when |
| --- | --- |
| `id` | non-empty string, unique |
| `groupId` | null, or the id of a listed group |
| `kind`, `state` | one of the declared literals |
| `url` | string; http(s) by `new URL` unless `state === 'skipped'`, where any string is accepted (A2) |
| `title` | string |
| `reason` | null or string |
| `quality` | media: valid `Quality`; file: null |
| `subtitleLangs` | array of at most 10 codes matching the ipc language regex |
| `dir` | absolute win32 path |
| `baseName` | media: non-empty, at most 200 chars, none of `\ / : * ? " < > \|` or control chars, no trailing dot or space; file: null |
| `fileName` | null, or a structural leaf: non-empty, no length cap (A1), no `\ / :` or control chars, not `.` or `..`; required for `kind: 'file'` (C11) |
| `index` | null or integer >= 1 |
| `bytesDone`, `speed` | normalized, never rejecting (A3): finite >= 0, else 0 |
| `bytesTotal`, `eta` | normalized (A3): null or finite >= 0, else null |
| `actualHeight`, `sourceHeight` | normalized (A3): null or finite > 0, else null |
| `resumable`, `interrupted` | boolean |
| `attempts` | integer >= 0 |
| `createdAt` | finite number |

- Group rules: `id` non-empty unique string; `title`, `url` strings; `dir` absolute; `createdAt` finite. A group without members is dropped, not an error.
- `version`: absent or `1`; anything else sets the file aside.
- After validation, on load: a job in an ACTIVE state becomes `paused`, `speed 0`, `eta null`, `interrupted: true`. `interrupted: true` on a job that is not then `paused` is coerced to `false`.
- `parseSettings(raw, defaults)`: per field, an invalid value falls back to that field's default. `downloadDir` must be an absolute path; `defaultQuality` a valid `Quality`; `subtitleLangs` a valid language list (the whole field falls back, no filtering); booleans must be booleans; numbers finite, then `normalizeSettings`.
- `isQuality`, `isLangList` and `isAbsoluteDir` live in `validate.ts`; ipc imports them (one definition).
- **Rule added during implementation (the `count()` guard), now part of the plan:** the queue stores a number reported by an engine only when the table above accepts it, so a bad tool number can never make the next load set the list aside.
  - `progress`: `bytesDone` and `bytesTotal` are replaced only by a finite value >= 0, otherwise the job's previous value stays; `speed` that is not finite >= 0 is stored as `0`; `eta` that is not finite >= 0 is stored as `null`.
  - `done`: `actualHeight` is stored only when finite and > 0, otherwise `null`.
  - The same rule covers `sourceHeight` from Task 5 (`probed`) and Task 7.8 (`probe.heights`): stored only when finite and > 0.
  - Spec (exists): `never saves a number the stored list would reject`.

**Migration (see also the section below):** absent `interrupted` reads as `false`; absent `sourceHeight` reads as `null`. No other field is new.

- [x] Tests in `tests/jobs/validate.test.ts`:
  - `accepts a job written before this change`: a full job object without `interrupted` and `sourceHeight` returns the job with `false` / `null`.
  - `it.each` one row per field of the table with one bad value each (for example `state: 'done'` only plus `id`; `quality: {kind:'max',height:999}`; `groupId: 'ghost'`; `subtitleLangs: ['--exec']`; `dir: 'relative'`; `baseName: 'a/b'`; `fileName: 'a:b'`; duplicate ids; file job with `quality` set; media job with `baseName: null`): each returns null.
  - `accepts a skipped placeholder with an empty url`; `rejects an empty url on a queued job`.
  - `accepts the persisted name CON` (C11). (The 255/256 rows are replaced by A1.)
  - `drops unknown keys`; `drops a group without members`; `rejects version 2`, `accepts a missing version`.
  - settings: `{"subtitleLangs":{}}` gives `[]`; `{"defaultQuality":{"kind":"max","height":7}}` gives the default; `{"downloadDir":"x"}` gives the default dir; `{"maxConcurrent":"4"}` gives 3; a valid old settings file is returned unchanged.
- [x] Tests in `tests/jobs/store.test.ts`:
  - `sets aside a jobs file whose job lacks required fields`: content `{"jobs":[{"id":"x","state":"done"}],"groups":[]}`; `recoveredCorrupt` not null, the aside file has the original bytes, list empty.
  - `loads a jobs file written by the previous version`: JSON written by hand without the two new fields; `recoveredCorrupt` null, `interrupted === false`, `sourceHeight === null`.
  - `loads a job saved as %s as paused`: also `interrupted: true`.
  - `keeps interrupted on a paused job across a load`; `clears interrupted on a job that is not paused` (hand-written `done` + `interrupted: true`).
  - `falls back per field when settings.json has a wrong field`: `{"subtitleLangs":{},"maxConcurrent":5}` gives defaults with `maxConcurrent: 5`.
- [x] Code: implemented; `Store.loadSnapshot` and `loadSettings` call the parsers.
- [ ] Orchestrator, after the Task 4 review and the owner's diff review: gates, then commit `fix: validate every persisted field; mark jobs cut off by a crash`.

#### Task 4 amendment (agreed in the Task 4 review and debate, 2026-11-22)

- **A1 (T4-1) stored file names:** `fileName` gets the structural rule only, with **no length cap**: non-empty, not `.` or `..`, none of `\ / :` or control characters. The 150/16 caps apply at add time only (Task 2 `sanitizeFileName`, A4). Spec: a file job whose name is `'a'.repeat(150) + '.' + 'b'.repeat(150)` (what the previous `probe.fileNameFrom` could produce) loads unchanged through `Store`; a 1000-char name is accepted by `parseSnapshotFile`. The 255/256 boundary spec is removed.
- **A2 (T4-2) url of a skipped job:** a job in state `skipped` may have **any string** url; every other state needs http(s). Specs: a skipped job with url `opaque-video-id` loads; a queued job with that url is rejected.
- **A3 (T4-3) meters never invalidate a file:** `bytesDone`, `bytesTotal`, `speed`, `eta`, `actualHeight`, `sourceHeight` are normalized at load, in every version: a value that is missing, not a number, non-finite or out of range becomes its neutral value (`bytesDone` 0, `speed` 0, `bytesTotal` null, `eta` null, `actualHeight` null, `sourceHeight` null). In range: `bytesDone`, `speed` finite >= 0; `bytesTotal`, `eta` finite >= 0; heights finite > 0. All other job fields stay strict. The `count()` guard in the queue stays. Specs: a job with `eta: -5` loads with `eta: null`; `actualHeight: 0` loads as null; `bytesDone: "5"` loads as 0; `speed: null` loads as 0; `sourceHeight: -1` loads as null. The per-field rejection rows for these six fields are replaced by normalization rows.
- **A4 (T4-4) the window cannot add what the loader rejects:** the `validProbe` rules and the `tests/ipc.test.ts` specs listed in Task 9.3 under "validProbe" move here: file `fileName === sanitizeFileName(fileName)`, `size` null or finite >= 0, `resumable` boolean; media `title` string, `heights` an array of at most 100 finite positive numbers; playlist `index` integer >= 1 and unique, `unavailable` boolean, `reason` in `EntryReason` exactly when `unavailable` else null, url validated only when available (an unavailable entry may carry any string url, A2). Specs (from 9.3): `refuses a device name, a stream name, a trailing dot and an over-long name as file name`; `refuses a file probe with a size that is not a number` (also -1, and a missing `resumable`); `refuses heights that are not numbers`; `refuses an unavailable entry without a reason and an available one with a reason`; `refuses duplicate playlist positions`; `refuses a playlist position that is not a whole number` (also 0). And the round-trip spec `what add accepts loads again from disk` as written in 9.3, using the `Queue` as it is at Task 4 (no `straysCleared` yet; Task 7 adds it with default true). Its fake file engine carries both `setGlobalLimit` and `setRateLimit` from the start, so the spec typechecks before and after Task 7.5 without being edited.
- **A5 (T4-5):** only an **absent** `interrupted` reads as `false`; `interrupted: null` (or any non-boolean) is rejected. Spec.
- **A6 (T4-6):** `Quality` is rebuilt from its declared fields in both `parseSnapshotFile` and `parseSettings`: `{kind:"best", extra:123}` comes back as `{kind:"best"}`. Specs for both parsers.
- **A7 (T4-7) missing rows:** non-finite `attempts`, `createdAt` and `index`; `fileName` empty, `.`, containing `\`, `/` or a control character; `baseName` containing each of `* ? " < > |`, and with a trailing space; `autoResumeOnStart` and `preferMp4Max1080` as text fall back; a referenced group with an extra key keeps the group and drops the key.
- **A8 (critic):** `normalizeSettings` moves into `validate.ts`; `store.ts` imports it from there and keeps exporting it for its existing callers (`ipc.ts`, tests), so `validate.ts` no longer imports `store.ts`.
- **A9 (critic N4, final per critique pass 3):** the queue treats a `done` event whose `fileName` is empty as a **not retryable** failure, the same meaning the media engine already gives this reason: the job becomes `failed` with reason `finished without a file`, no retry timer, announced like any other failure, and an empty name is never saved. Spec in `tests/jobs/queue.test.ts`: `media.emit({type:'done', fileName:'', actualHeight: null})` leaves the job `failed` with that reason, no pending timer, and the last save passes `parseSnapshotFile`.

**Acceptance:** `npx vitest run tests/jobs/store.test.ts tests/jobs/validate.test.ts tests/jobs/queue.test.ts tests/ipc.test.ts`.
**Failure modes:** `renameSync` to the aside name failing (existing behaviour: throws at startup; unchanged, noted). One invalid job costs the whole list (agreed); the aside file keeps everything for hand repair. A `done` event with an empty `fileName` is guarded by A9.

### Task 5: Media engine (B2 shapes, B3 findFinished, Q2 pre-probe, confirmed stop)

**Stage A, parallel with 6 and 8.**
**Files:** `src/main/engines/engine.ts` (`probed` event, `stop`/`discard` contract text), `src/main/engines/media.ts`, `tests/engines/media.test.ts`, `tests/fakes/fake-ytdlp.mjs`.

Behaviour:
- `isPartialOf(fileName, baseName)` exported, case-insensitive. After `<baseName>` the rest must match one of (flags `iu`):
  - `^\.(?:f\d+\.)?[a-z0-9]{1,5}(?:\.part(?:-Frag\d+(?:\.part)?)?|\.ytdl|\.part\.ytdl)$`
  - `^\.f\d+\.[a-z0-9]{1,5}$`
- `findFinished`: only a name that is exactly `<baseName>.<ext>` with `ext` in `mp4 mkv webm m4a mp3 opus ogg flac wav mov` (case-insensitive) and `statSync(path).isFile()`. Several matches: the first after sorting the names by their lower-cased form with plain code-unit comparison (no locale).
- Constructor: `new MediaEngine(ytdlp, ffmpegPath, opts?)` with `probeTimeoutMs` (default 30000, OQ3), `stopTimeoutMs` (default 10000, OQ10) and `kill` (default: today's `taskkill /PID <pid> /T /F`, falling back to `child.kill()` when taskkill fails).
- Pre-probe: `start()` with `quality.kind === 'best'`, `ctx.settings.preferMp4Max1080 === false`, `job.sourceHeight === null` and `job.bytesDone === 0` first runs `heightProbeArgs(url)` as a spawned child in the same `Running` entry (so `stop` can reach it), stdout collected up to the existing 64 MB probe cap.
  - exit 0: the height is `parseProbe(stdout).heights[0]` when the result is of kind `media` (G3: one definition of "height": finite, > 0, the highest). With a height: emit `{ type: 'probed', sourceHeight }`, then spawn the download with that height. Without one (no formats, no positive height, or a playlist result): no event, download with `sourceHeight: null`.
  - exit 0 with output `parseProbe` cannot read (not JSON, not an object, over the cap): retryable error `could not read the video information`, no download.
  - non-zero exit: emit `classifyError(stderr)` as the job's error, no download.
  - time limit reached: the probe child is killed, retryable error `timed out reading the link`, no download.
  - spawn error: `yt-dlp is not installed`, not retryable (as for the download).
  - `sourceHeight === null && bytesDone > 0` (a job from before this change, or one whose probe found no height): no pre-probe, mkv path, so its existing partial files keep matching.
  - No pre-probe for prefer-mp4, `max` or `audio`.
- `stop(jobId)` (OQ10, the same contract as the file engine):
  - no entry: resolves.
  - an entry that is already stopping returns the same pending promise and kills nothing twice.
  - otherwise: events are suppressed, the tree is killed through `kill`, and the engine waits for the child's `close`.
  - **Confirmed:** `close` arrives within `stopTimeoutMs`. The entry is released, the promise resolves, no event.
  - **Not confirmed:** `stopTimeoutMs` passes without `close`. The promise rejects with `could not confirm that the download stopped`; the entry stays; the stopping mark is cleared, so the engine keeps reporting the job (progress and its final event) and a later `stop` tries again.
  - `stop()` during the pre-probe kills the probe child and no download starts.
- `discard(job)`: awaits `stop`; when it rejects, deletes nothing and rejects. Otherwise deletes exactly the names `isPartialOf` accepts.
- Fake (`fake-ytdlp.mjs`): the height-probe mode applies when the arguments contain both `-J` and `--no-playlist` (the link probe uses `--flat-playlist` and is not affected). In that mode `FAKE_YTDLP` is ignored and `FAKE_YTDLP_HEIGHTS` decides:
  - unset or `none`: prints `{"formats":[]}`, exit 0 (G1: so every existing spec with a default Best job still reaches its download scenario).
  - `hang`: waits forever.
  - `fail`: prints `ERROR: [youtube] x: Sign in to confirm your age` on stderr, exit 1.
  - `garbage`: prints `this is not json`, exit 0.
  - otherwise a comma list of numbers becomes `{"formats":[{"height":n},...]}`.
  - `FAKE_YTDLP_ARGS` logging applies to the probe run too, so **a default Best job logs two argument lines** (probe, then download). Existing specs that read the log read its last line.

#### Tests (tests lane): `tests/engines/media.test.ts`

- `isPartialOf` table: true for `Clip.mp4.part`, `Clip.f137.mp4`, `Clip.f140.m4a.part`, `Clip.mp4.ytdl`, `Clip.mp4.part-Frag3`, `Clip.mp4.part-Frag3.part`, `clip.MP4.PART`; false for `Clip.extra.mp4.part`, `Clip.mp4`, `Clip.en.vtt`, `Clip 2.mp4.part`, `Clip.temp.mp4`, `Clip.f137.x.mp4`, `Clip.toolongext.part`.
- `discard leaves the partial file of a job whose name extends this one`: files `Clip.mp4.part` and `Clip.extra.mp4.part`; discard job `Clip`; the second file still exists (B2 trigger).
- `does not take an unrelated file for the finished download`: `Clip.txt` present, scenario `nofile`: error `finished without a file`.
- `does not take a folder for the finished download`: directory `Clip.mp4`, scenario `nofile`: same error.
- `takes the first finished file by lower-cased name`: `Clip.mp4` and `Clip.MKV` present, scenario `nofile`: `done` with `Clip.MKV`.
- keep `treats a clean exit as done when the finished file is already there` (`Clip.mkv`).
- `checks the real height before a Best download and reports it`: `FAKE_YTDLP_HEIGHTS=1080,720`, quality best: events start with `{type:'probed', sourceHeight:1080}`; args log has two lines; line 2 `-f` contains `vcodec^=avc1`, merge `mp4`.
- `uses mkv for a source above 1080p`: heights `2160,1080`: `probed` 2160, merge `mkv`.
- `a default Best job runs the height check and then the download`: variable unset, scenario `ok`: two args lines, no `probed` event, the usual `progress, progress, progress, merging, done`.
- `reports no height when the site offers none above zero`: heights `0`: no `probed` event, merge `mkv` (G3).
- `skips the height check when the height is known`: `sourceHeight: 720`: one args line.
- `skips the height check for a job that already has data`: `bytesDone: 10, sourceHeight: null`: one args line, merge `mkv`.
- `runs no height check with "always mp4"`: context with `preferMp4Max1080: true`: one args line.
- `runs no height check for a fixed quality`: `quality: {kind:'max', height: 720}`: one args line.
- `runs no height check for audio`: `quality: {kind:'audio', format:'m4a'}`: one args line.
- `reports why the height check failed`: `fail`: error failed / `login required`, one args line.
- `gives up the height check after its time limit`: engine with `probeTimeoutMs: 300`, `hang`: error failed, retryable, `timed out reading the link`; one args line; a later `stop` resolves.
- `reports unreadable height information as a retryable failure`: `garbage`: error retryable `could not read the video information`, one args line.
- `stop during the height check starts no download`: `hang`, `stop()`, then 200 ms: no event, one args line.
- `a second stop while the first is pending resolves with it`: scenario `hang`, `Promise.all([stop, stop])` resolves; the injected `kill` was called once.
- `stop fails and keeps the job when the process does not end`: engine with `stopTimeoutMs: 200` and a `kill` the test can switch off; scenario `hang`, after the first progress `stop()` rejects with `could not confirm that the download stopped`; progress events arrive again afterwards; `engine.start(job)` again spawns nothing (args log unchanged); with the kill switched on a second `stop()` resolves and events end.
- `discard deletes nothing when the stop is not confirmed`: same setup with `Clip.mp4.part` on disk: `discard` rejects and the file still exists.
- Existing specs keep passing; those reading the args log read its last line.

#### Code (implement lane)

Implement the engine and the fake as above. `engine.ts`: add the `probed` member and rewrite the `stop`/`discard` JSDoc to the contract in "Types and contracts". Do not edit the tests.

**Commit (orchestrator):** `fix: strict partial-file ownership, confirmed stop and container by real height in the media engine`.
**Acceptance:** `npx vitest run tests/engines/media.test.ts`.
**Edge cases and races:**
- The folder vanishes during `findFinished` (returns null as today).
- `stop` between probe exit and download spawn: the stopping mark is checked before the second spawn.
- The child closes by itself while a stop is pending: the stop resolves, no event (as today).
- After a failed stop the child ends by itself: its normal final event is emitted.
- Residual, accepted and on the checklist: when `taskkill` fails and the fallback `child.kill()` ends yt-dlp alone, `close` still arrives and the stop counts as confirmed although an ffmpeg child may live a moment longer. A check of the whole tree needs a process query that is out of scope (B13 Job Object).
- Non-numeric format ids and `.temp.<ext>` stay on disk after Cancel (C9).

### Task 6: File engine (B4 engine half, B5, B7 engine half, RPC time limit)

**Stage A, parallel with 5 and 8.**
**Files:** `src/main/engines/file.ts`, `tests/engines/file.test.ts`, `tests/fakes/fake-aria2.ts`, and `src/main/jobs/queue.ts` for one named shim only (below).

Behaviour:
- `createRpcClient(port, secret, fetchImpl = fetch, timeoutMs = 5000)` (OQ9):
  - every call passes `signal: AbortSignal.timeout(timeoutMs)`; the limit covers the answer's body too. P4: such a fetch rejects with `TimeoutError`.
  - the body is parsed whatever the HTTP status. A JSON-RPC `error` member throws `Aria2RpcError` (message and `code` from the member).
  - a fetch failure, an expired time limit, or a body that is not JSON-RPC throws `Aria2TransportError`.
- `daemonHandle(child, rpc)` builds the `Aria2Daemon`; `startAria2` returns it.
  - `alive()` is false after the child's `exit` (P5: `exit` fires for a child with `stdio: 'ignore'` ended from outside).
  - `onExit` listeners run once on an exit that `stop()` did not ask for. A listener added after the exit is not called; callers check `alive()`.
  - `stop()`: as today (`aria2.shutdown`, then `child.kill()`), and it marks the exit as asked for.
- Constructor: `new FileEngine(rpc, opts?)`, `pollMs` default 500, `daemonAlive` default `() => true`.
- `Tracked` keeps `stop: Promise<void> | null` and `polling: boolean`, and stays in the map until the stop is confirmed.
- `stop(jobId)`: no entry resolves. A pending stop is returned as is (shared). Otherwise: stop the poll timer, await `added`, then `aria2.forcePause` (its outcome is ignored) and `aria2.remove`.
  - **Confirmed** when aria2 *answered* `aria2.remove` (a result, or `Aria2RpcError`: nothing active, waiting or paused under that gid), or when `daemonAlive()` is false. Then the entry is deleted and the promise resolves.
  - **Not confirmed** (`Aria2TransportError` on remove while the daemon is alive): the entry stays, `stop` is reset to null, polling restarts, the promise rejects with `could not confirm that the download stopped`.
  - With the 5 s limit a stop ends within about 15 s at worst (`added`, `forcePause`, `remove`), so a verb chain in Task 7.1 can never block for good.
- `discard(job)`: awaits `stop`; when it rejects, deletes nothing and rejects.
- `poll`:
  - no new poll starts while one of the same entry is in flight (`polling`); the interval tick is skipped.
  - `Aria2RpcError` on `tellStatus` (aria2 no longer knows the gid): finish with retryable `download was removed`.
  - `Aria2TransportError` with `daemonAlive() === false`: finish with retryable `the download service stopped`.
  - `Aria2TransportError` with the daemon alive: keep the gid and keep polling. After 5 consecutive failures emit **one** `progress` with `speed: 0`, `eta: null` and the last byte counts this run reported (before any progress: the `bytesDone` and `bytesTotal` of the job given to `start`). It is emitted once per outage: the counter and the once-mark reset on any answer (OQ1). aria2 is never ended by the app for this.
- `start(job, ctx)`: `addUri` options `{ dir, out, 'max-download-limit': String(ctx.rateLimitBytes ?? 0) }`. An `addUri` failure of either kind releases the entry and emits a retryable error (`Aria2RpcError`: its message; transport: `the download service is not running`).
- `setRateLimit(jobId, n)`: awaits `added`; with a gid calls `aria2.changeOption [gid, {'max-download-limit': String(n ?? 0)}]`; untracked job: no call; errors are swallowed (the value is re-sent at the next settings change or start).
- `setGlobalLimit` is deleted.
- `attach(daemon)` (G5; called by Task 9.4 after the old daemon exited):
  - precondition: the previous daemon is dead. Every entry still tracked therefore belongs to a process that no longer exists.
  - each tracked entry is ended first: its timer stops; an entry with a pending stop is released and that stop resolves (a dead daemon confirms it); any other entry is released with the retryable error `the download service stopped`.
  - then the engine's rpc becomes `daemon.rpc` and `daemonAlive` becomes `daemon.alive`. Nothing is re-added to the new daemon: the queue's retry starts those jobs again through `start`.
- Fake (`fake-aria2.ts`): `transportDown: boolean` (every call throws `Aria2TransportError`); `refuse: Set<string>` (those methods throw `Aria2RpcError`); `hold(method): () => void` (calls of that method wait until released); an unknown gid on `tellStatus` throws `Aria2RpcError`; `failAddUri` stays and throws `Aria2TransportError`.
- **Shim in `queue.ts` (named, removed in 7.5):** `QueueDeps.file` becomes `Engine & { setGlobalLimit?(bytesPerSec: number): Promise<void> }` and `applyGlobalLimit` calls it only when present. No other line of `queue.ts` changes in this task; the existing queue specs keep passing.

#### Tests (tests lane): `tests/engines/file.test.ts`

- update `adds the download...`: options include `'max-download-limit': '0'`; constructor calls move to the options object.
- `passes the per-download limit to aria2`: `rateLimitBytes: 307200` gives `'307200'`.
- `changes the limit of a running download`: after first progress `setRateLimit(id, 102400)`: call `aria2.changeOption ['gid1', {'max-download-limit':'102400'}]`; `null` gives `'0'`; unknown job: no call.
- delete `sets the global speed limit, with 0 meaning unlimited`.
- B4 `a second stop during a pending stop shares it`: `hold('aria2.forcePause')`, `p1 = stop`, `p2 = stop`, release: exactly one `forcePause` and one `remove`; both resolve.
- B4 `keeps the job until its stop is confirmed`: during the held stop `engine.start(job)` adds no second `aria2.addUri`.
- B5 `a transport failure with a live daemon does not end the job`: `daemonAlive: () => true`; after first progress `transportDown = true` for 10 polls: no `done`/`error`; set false: progress continues; one `addUri` in total.
- B5 `shows a stalled download as not moving after five silent polls`: no extra event after the 4th failure; after the 5th one `progress` with `speed: 0`, `eta: null` and the last reported byte counts; no second such event after the 10th failure.
- B5 `a stall before any progress uses the job's own counts`: job with `bytesDone: 40, bytesTotal: 100`, `transportDown` on from the first poll (hold the fake `aria2.tellStatus` after a successful `addUri`, set `transportDown = true`, release it): the stall event carries 40 and 100.
- B5 `reports a second stall after the service answered in between`: fail 5, answer once, fail 5: two stall events.
- G4 `does not start a poll while one is waiting`: `hold('aria2.tellStatus')`, wait 5 poll periods: one `tellStatus` call; release: polling goes on.
- B5 `gives up at once when the daemon is dead`: `daemonAlive: () => false`; after the first progress set `transportDown = true`: error retryable `the download service stopped`.
- B5 `gives up when aria2 no longer knows the download`: `refuse.add('aria2.tellStatus')`: error retryable `download was removed`.
- B5 `stop fails and keeps ownership when aria2 does not answer`: alive; after the first progress set `transportDown = true`: `stop` rejects with `could not confirm that the download stopped`; then `transportDown = false`: progress events arrive again; a second `stop` resolves.
- B5 `stop is confirmed when aria2 answers remove with an error`: `refuse.add('aria2.remove')`: resolves, no further events.
- B5 `stop is confirmed when the daemon is dead`.
- B5 `discard deletes nothing when the stop is not confirmed`: both files still exist, `discard` rejects.
- G5 `attach hands the downloads of the old service back and uses the new one`: job running on fake A; `attach` a daemon built on fake B: one error event, retryable, `the download service stopped`; `engine.start(job)` again: `aria2.addUri` reaches B, A gets no further call.
- G5 `attach confirms a stop that was pending on the old service`: `hold('aria2.remove')` on A, `stop` pending, `attach(B)`: the stop resolves, no event.
- G5 `after attach the new daemon decides whether the service is alive`: B with `alive: () => false`; after the job's first progress set `transportDown = true`: the job ends with `the download service stopped`.
- `createRpcClient`:
  - `rejects with Aria2RpcError for an error answer` (existing loopback server; also when the server answers HTTP 400 with the error body).
  - `rejects with Aria2TransportError when nothing listens` (port of a closed server).
  - `rejects with Aria2TransportError for an answer that is not JSON`.
  - G4 `rejects with Aria2TransportError when the server never answers`: loopback server that accepts and stays silent, `createRpcClient(port, 's', fetch, 300)`: rejects with `Aria2TransportError` within 2 s.
- `daemonHandle` (child = this Node running `setInterval(() => {}, 1000)`, `stdio: 'ignore'`; rpc = `FakeAria2`):
  - `is alive until the process ends, then tells its listeners once`: `alive()` true; the test ends the child; `alive()` false and the `onExit` listener ran once.
  - `an asked-for stop does not count as an unexpected exit`: `stop()`: the child ends, `alive()` false, the listener did not run.

#### Code (implement lane)

Implement client, daemon handle, engine, fake and the `queue.ts` shim. Do not edit the tests.

**Commit (orchestrator):** `fix: file engine keeps a download until its stop is confirmed`.
**Acceptance:** `npx vitest run tests/engines/file.test.ts`.
**Edge cases and races:**
- `stop` before `addUri` answered: awaits `added`; if `addUri` failed the entry is already released and `stop` resolves.
- Pause racing completion: `remove` is refused because the download finished; the job is paused although the file is complete; Resume then fails `file already exists` (existing behaviour, residual, noted in the checklist).
- `addUri` accepted but its answer lost (including by the time limit): a download without a known gid (residual; a client-chosen gid is out of scope).
- Daemon gone vs gid gone are told apart only by `daemonAlive()` and the error class, never by counting failures.
- `startAria2` waits through its 20 readiness tries as today; a daemon that accepts connections but never answers makes each try last the 5 s limit, so the status can stay `starting` for up to about 105 s before `error` (residual).
- All statements about what aria2 answers to `remove`/`tellStatus` are unverified against 1.37.0 (Q3, checklist).

### Task 7: Queue (B3, B4, B5, B6, B7, B9, B12, B13, B15, B18, B19, Q2)

**Stage B, after 5, 6 and 8 are committed.**
**Files:** `src/main/jobs/queue.ts`, `tests/jobs/queue.test.ts`, and `src/main/ipc.ts` for one named shim only.

The task has ten parts. They are rules and their tests, not steps: the tests lane writes the tests of all ten parts in one pass, then the implement lane writes all of the code.

Shims so that the typecheck gate passes with `index.ts` untouched (G6):
- `QueueDeps.straysCleared?: boolean`, default `true`. No spec relies on the default (`build()` always passes a value). Task 9.5 makes it required.
- `ipc.ts` `QueueLike.job` and `QueueLike.group` are typed `Promise<unknown>`; the two handlers stay as they are (`await`, then `ok(null)`). Task 9.3 replaces the type with `Promise<Result<null>>` and passes the result through.
- The Task 6 shim (`setGlobalLimit?`) is removed here (7.5).

Test helper changes (no behaviour): `FakeEngine` gains `stopGate: Promise<void> | null` (stop waits for it), `stopFails = new Set<string>()` (stop and discard reject for those ids), `rateLimits: [string, number | null][]`, `setRateLimit`, and a shared `log: string[]` that `start`, `stop` and the fake store's `saveSnapshot` append to. `build()` takes `straysCleared` (default true, always passed) and `saveFails: { on: boolean }`. `setGlobalLimit` and `limits` are removed.

**7.1 Verbs per job in order, with a result (B4).** `job()` and `group()` return `Result<null>`. Each job has a promise chain; a verb runs when the previous verb of that job has finished and reads the job's state at that moment. Group verbs and `pauseAll` enqueue one verb per member. A verb never starts in the tick it is enqueued: it begins on a later microtask, so a change made and undone in the same tick (7.5 `a limit changed and changed back restarts nothing`) runs no stop. A verb that finds nothing to do (the job was removed meanwhile, or the verb is not legal in the job's state) answers `{ok:true, value:null}`.
- `a second pause during a pending stop waits for it`: `stopGate` set; `p1 = job(id,'pause')`, `p2 = job(id,'pause')`, tick: state still `probing`, `media.stopped.length === 1`; release: both `{ok:true}`, state `paused`, still one stop.
- `a resume issued during a pending pause runs after it`: `log` ends `stop, save..., start`; state `probing`; `media.started.length === 2`.
- `a cancel issued during a pending pause removes the job after the stop`.
- `a verb for a job that was removed meanwhile does nothing`: result `{ok:true}`, no throw.
- `a verb that does not fit the state answers ok and changes nothing`: `retry` on a `queued` job.
- existing tests keep passing with `await`.

**7.2 A stop that is not confirmed (B5).** Either engine can reject a stop (Tasks 5 and 6).
- Pause: the job stays in its active state and keeps its slot; result `{ok:false, error:'Could not confirm that the download stopped. It is still listed as running; try again.'}`.
- Cancel: `discard` rejected, row kept; result `{ok:false, error:'Could not confirm that the download stopped, so nothing was deleted. It is still in the list; try again.'}`.
- Group verb: every member is tried; the result is the first error, else ok.
- Group cancel no longer deletes the group record itself: the prune in `commit()` removes a group only when it has no member left (G7). A kept row therefore never points at a missing group.
- `pause reports failure and keeps the slot when the stop is not confirmed`: `maxConcurrent: 1`, two jobs, `stopFails` has the first: result not ok with the pause text, states `['probing','queued']`.
- `cancel keeps the row when the stop is not confirmed`: result not ok with the cancel text.
- `a group pause pauses the members it can and reports the one it could not`.
- `a group cancel keeps the group while a member could not be cancelled`: playlist of 2, `stopFails` has one member: result not ok; one row left with its `groupId`; the group is still in the snapshot; `parseSnapshotFile({version: 1, ...lastSave}) !== null`.

**7.3 Retry wait token (B6).** `waiting: Map<string, number>`; the timer releases the wait only when its token is still the stored one.
- `an old retry timer cannot release a newer wait`: retryable error (timer 5000), pause, resume, retryable error again (timer 20000), `fire(5000)`: job still `queued`, `media.started.length === 2`; `fire(20000)`: `probing`, length 3.
- `a retry timer firing after cancel does nothing`: error, cancel, `fire(5000)`: no throw, no start.

**7.4 Transition, save, then start; save failures (B9, OQ2).** `commit()`: apply `start` transitions, prune groups, `save()`, start the engines of the jobs just transitioned, notify.
- `save()` never throws: a failure sets `saveError = 'could not save the download list: <message>'`; a success sets it to `null`.
- `onSaveState(listener)` calls the listener at once with the current value, then whenever the value changes (G8). The constructor's own first save can already have failed before any listener exists; the immediate call is what delivers it.
- While `saveError` is set, exactly one pending timer of `SAVE_RETRY_MS` (60000 ms, OQ2) retries the save. The banner is not closable and goes away on the first good save (C2).
- `writes the started state before starting the engine`: `log` order `save` then `start`; the saved job is `probing`.
- `a failing save does not stop the download and add does not throw`: engine started; the listener got the message once.
- `a failing save inside an engine event is caught`: `media.emit(done)` does not throw; state `done`.
- `a listener is told the current state when it is added`: with good saves the listener's first call is `null`.
- `a save that failed in the constructor reaches a listener added later`: `saveFails.on = true` before `build()`; `onSaveState(l)` afterwards: `l` was called once, with the message.
- `tells listeners once per message, and null after the next good save`.
- `retries the save while it keeps failing`: in a queue with no job waiting for a retry (so no other 60000 ms timer exists, N12), a failed save leaves exactly one pending timer of `SAVE_RETRY_MS`; firing it saves; a second failure while one is pending adds no second timer.

**7.5 One budget (B7).** `perJobLimit = speedLimitKbps === 0 ? null : max(1, floor(speedLimitKbps * 1024 / max(maxConcurrent, activeCount)))`. Both engines get it as `ctx.rateLimitBytes`. The queue remembers the value each active job was started with.
- `setSettings`: for every active job whose share changed: a file job gets `file.setRateLimit` (and the remembered value is updated); a media job in `probing`/`downloading` gets a restart verb on its chain; a `merging` job is left alone.
- The restart verb, when it runs, looks again (N9): if the job is no longer `probing`/`downloading`, or its remembered value already equals the current share, it does nothing. Otherwise: await `stop`, `requeue`, commit. If the stop is not confirmed the job keeps running at its old value and nothing is reported; the next settings change tries again.
- Nothing is recomputed when the active count merely drops. `applyGlobalLimit`, `mediaRateLimit` and the `setGlobalLimit?` shim are deleted.
- replace `splits the speed limit...`: limit 900, max 3, add a video and a file: both `ctx.rateLimitBytes === 307200`.
- replace `starts media jobs unlimited...`: both `null`.
- replace `applies new settings: limit and slots`: max 1 to 3 starts the two waiting jobs.
- `a new limit restarts videos that are downloading and re-limits files`: video (after a progress event, `bytesDone: 40`) and file active; `setSettings({speedLimitKbps: 300})`, tick: `media.stopped == [video]`, second media start has `102400` and the job kept `bytesDone: 40`; `file.rateLimits == [[fileId, 102400]]`; `file.stopped == []`.
- `leaves a merging job alone when the limit changes`.
- `lowering the slot count with three active changes no limit`: limit 900, max 3, three active; `setSettings({maxConcurrent:1, speedLimitKbps:900})`: no stop, no `setRateLimit` (divisor stays 3).
- `raising the slot count lowers the running job to its new share`: limit 900, max 1, one active at 921600; max 3: restarted at 307200; every later start 307200.
- `two quick limit changes restart a video once`: `stopGate` set; `setSettings(300)`, `setSettings(600)`, release, tick: `media.stopped.length === 1`; the second start carries the share of 600.
- `a limit changed and changed back restarts nothing`: `setSettings(300)` then the original settings before any tick: `media.stopped == []`.
- `a pause issued during a limit restart wins`: `stopGate` set, `setSettings`, `job(id,'pause')`, release: final state `paused`.
- `a limit restart whose stop is not confirmed leaves the video running`: `stopFails` has the video: state unchanged, one start in total.
- delete `survives a failing global limit call`; add `survives a failing setRateLimit`.

**7.6 Shutdown (B12).** `shutdown()`: set `closed`; every job in an ACTIVE state gets `interrupt` and `interrupted: true`; save; call `engine.stop` for each (not through the chains; a stop already pending is shared by the engines); each confirmed stop clears that job's `interrupted`; save again. A rejected stop is ignored and its job stays `interrupted`.
- While `closed`: `schedule()` starts nothing; engine events and timers do nothing; `job()`/`group()` answer `{ok:false, error:'Hammel is closing'}`.
- A verb that was already waiting in a chain when `closed` was set does nothing and answers the same error (N10). A verb already past its own `stop`/`discard` await finishes: a pause finds the job already `paused`; a cancel still removes its row.
- `shutdown stops every active job, including one that is merging`: three jobs, one moved to `merging`: all `paused`, `media.stopped` has all three.
- `shutdown saves the jobs as cut off before the engines have stopped`: `stopGate` set; before release the last save has `state:'paused', interrupted:true`; after release `interrupted:false`.
- `a stop that fails during shutdown leaves the job marked as cut off` and `shutdown` still resolves.
- `nothing starts after shutdown`: queued job present; engine `done` event for another job, `fire(5000)`, `job(id,'resume')`: `media.started` unchanged; the resume answers `Hammel is closing`.
- `a resume waiting in the chain when shutdown starts does nothing`: `stopGate` set; `job(id,'pause')`, `job(id,'resume')`, `shutdown()`, release: state `paused`, `media.started.length === 1`, the resume's result is not ok.
- `a cancel already in flight at shutdown still removes its row`.
- `pauseAll` test unchanged (it still skips merging jobs).

**7.7 Jobs cut off by a crash (B13).** Constructor: `straysCleared: true` clears `interrupted` on all jobs before the first commit. Otherwise, for a job with `interrupted: true`: `resume` answers `{ok:false, error:'This download was cut off and Hammel could not check that its old process is gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then choose "They are gone" in the banner, or restart Hammel.'}`; `resumeAllPaused` and group resume skip it; cancel is allowed. `confirmStraysGone()` clears every flag and commits.
- `clears the flag when the check for old processes succeeded`.
- `refuses to resume a cut-off job when the check failed`: result not ok, state `paused`, no start.
- `resumeAllPaused skips cut-off jobs and resumes the others`.
- `a group resume skips its cut-off member`.
- `after the owner confirms, the job resumes`.
- `a cut-off job can still be cancelled`.

**7.8 Adding: one namespace, placeholders, real height (B2, B3, B15, Q2).**
- `claimsIn(dir)`: names of all listed jobs whose state is not `skipped` and whose `dirKey(dir)` matches (media: `baseName`; file: `fileName`), plus the folder leaf of every group whose parent `dirKey` matches.
- Disk names: `readdirSync(dir)` (missing folder: none), read once per target folder per `add` call; each name given during that call joins the claims for the next item of the same call.
- Every new job name is `freeName(base, ext, n => nameConflicts(n, claims, disk))`. `sameDir`, `takenBaseNames`, `takenFileNames` and the `uniqueName` wrapper are deleted.
- A playlist's own folder name is not made unique, as today: adding the same playlist twice puts both in one folder, and the item names stay distinct through the claims. Residual, accepted: a new playlist whose folder name equals an existing file job's name or a disk file in the parent folder.
- Skipped placeholders take `reason: entry.reason ?? 'unavailable'`.
- Media jobs take `sourceHeight` = the largest value of `probe.heights` that is finite and > 0, or null when there is none; playlist items null.
- On `probed`: when `sourceHeight` is finite and > 0, store it, save, notify; the job stays `probing`. Any other value is ignored: nothing stored, no save (G3; the Task 4 rule).
- `a video does not take the name of a finished file left on disk`: `Talk.mp4` on disk, add `Talk`: `baseName === 'Talk (2)'` (B3 trigger).
- `a file download and a queued video cannot share a name, in either order`: video `Clip` then file `Clip.mp4` gives `Clip (2).mp4`; fresh queue, file `Clip.mp4` then video `Clip` gives `Clip (2)`.
- `a video whose title extends another job's name gets its own name, in either order`: `Clip` then `Clip.f137` gives `Clip (2).f137`; reverse order gives `Clip (2)` for the second.
- `treats two spellings of one folder as the same folder`: second request with `dir` upper-cased and a trailing `\`: names differ.
- `a stale aria2 control file blocks the name`: `a.zip.aria2` on disk: `a (2).zip`.
- `a skipped placeholder does not hold a name`.
- `two playlist items with the same title get different names in one add`.
- update `shows unavailable items as skipped from the start`: entries with reasons `private`, `removed`, `unavailable` give jobs with exactly those reasons.
- `records the real height of a single video when it is added`: `heights: [1080, 720]` gives `sourceHeight: 1080`; playlist items `null`.
- `ignores heights that could not be stored`: `heights: [0, NaN, -5]` gives `sourceHeight: null`; `heights: [NaN, 720]` gives 720.
- `stores the height the engine found and saves it`: `media.emit({type:'probed', sourceHeight: 2160})`: job `probing`, `sourceHeight: 2160`, a save happened.
- `never stores a height the stored list would reject`: `probed` with `0`, `NaN`, `-1` and `Infinity`: `sourceHeight` stays null, no extra save, and `parseSnapshotFile({version: 1, ...lastSave}) !== null`.
- existing naming tests (`talk (2)`, `a (2).zip`, `A.ZIP` on disk) keep passing.

**7.9 Delete file (B18).** `removeWithFile` on a done job: `rmSync(path)` without `force` and without `recursive`. `ENOENT`: row removed, ok. Any other error: row kept, `{ok:false, error:'Could not delete the file: <message>'}`. P2: on a non-empty directory the error code is `ERR_FS_EISDIR` and the directory stays intact.
- `keeps the row and reports the error when the file cannot be deleted`: a non-empty directory named `Talk.mp4` at the file's path: result not ok with an error starting `Could not delete the file: `, row still listed, directory and its content intact.
- `removes the row when the file is already gone`: result ok.
- existing `removeWithFile` tests keep passing.

**7.10 Group completion after a cancel (B19, OQ7).** After a job-level cancel of a job that was not terminal: if its group still has members, all of them are terminal, **and at least one of them is `done` or `failed`**, announce the group once. Not after `remove`/`removeWithFile`, not after a group cancel. The rule applies to this cancel path only; the existing announcement after an engine event is unchanged.
- `announces the playlist when its last unfinished item is cancelled`: playlist of 2, `done` A, pause B, cancel B: `finished == [{kind:'group', title, failed:0, skipped:0}]`.
- `does not announce when every remaining item is skipped`: playlist of 3 with two unavailable entries, cancel the third: `finished == []`.
- `announces when a remaining item failed`: one `failed`, one `skipped`, cancel the last active one: one group announcement with `failed: 1, skipped: 1`.
- `does not announce when a finished row is removed`.
- `does not announce on a group cancel`; `cancelling the only item announces nothing`.

#### Tests (tests lane): `tests/jobs/queue.test.ts`

All tests named in 7.1-7.10 and the helper changes, in one pass, from this plan only.

#### Code (implement lane)

All of 7.1-7.10 in `queue.ts`, plus the two-line `QueueLike` shim in `ipc.ts`. Do not edit the tests.

**Commit (orchestrator):** `fix: queue owns names, verbs, saves and shutdown`.
**Acceptance:** `npx vitest run tests/jobs/queue.test.ts`; all three gates.
**Edge cases and races:**
- Verbs during an awaited stop queue behind it (7.1); a verb for another job is not delayed.
- An engine `done` arriving while a pause waits for its stop: both engines suppress events during a stop. After a failed stop events flow again and the job is still active, so they apply.
- Limit restart overlap: a slot freed elsewhere can start a job at the new share while a restarted job is still dying at the old one (under a second; accepted).
- Save keeps failing while idle: only the retry timer writes (OQ2).
- A media stop can take up to 10 s and a file stop up to about 15 s before it rejects; the row shows its active state for that long.
- `skipped` jobs hold no name, so a job skipped at run time can leave partial files that only the disk rule protects.
- Jobs listed before this change keep names that were never checked against disk (residual for existing lists).

### Task 8: Tool installation (B10, B11)

**Stage A, parallel with 5 and 6. Runs in the quick-fixes lane:** one implementer writes the tests below first, sees them fail, then writes the code. No separate tests lane.
**Files:** `src/main/binaries.ts`, `tests/binaries.test.ts`.

Behaviour:
- `ensureAll` and `updateYtDlp` run through one promise chain per `Binaries` instance. A failed run does not block the next one: the chain continues after a rejection.
- `download()` becomes `pipeline(Readable.fromWeb(res.body), hash-and-progress Transform, write stream)`.
- `BinariesOptions.createWrite?: (path: string) => Writable` (default `createWriteStream`). It is used for the asset download only; taking a file out of an archive keeps `createWriteStream`.
- Errors of the download step:
  - the write stream failed: `could not install <name>: disk full` (`ENOSPC`), `could not install <name>: cannot write to folder` (`EACCES`, `EPERM`), else `could not install <name>: <message>`. P3: the pipeline keeps the error's `code`.
  - the response failed mid-way: `could not download <name>: the connection was lost`.
  - which stream failed is known from an `error` listener on the write stream, not from the message.
- A write error with one of the three codes while taking the file out of an archive gets the same `could not install` texts.
- Cleanup in `finally` tolerates its own errors. P3: after a rejected pipeline an immediate `rmSync(dest, {force:true})` succeeds on Windows.

Tests (written first by the same lane), `tests/binaries.test.ts`:
- `runs two updates one after the other`: fetch stub holds the first checksum request; start `u1`, wait until the checksum URL was requested, start `u2`: the asset URL was fetched once so far; release: `fetched` order is asset, sums, asset, sums; both resolve; no leftovers.
- `a second install request waits and then finds everything installed`: two `ensureAll` at once: each asset fetched exactly once.
- `a failed install does not block the next one`: the first `updateYtDlp` meets a server answering 500 and rejects; a second one started right after it resolves with the new version.
- `reports a disk-write failure and keeps the working yt-dlp`: `createWrite` returns a `Writable` whose `_write` fails with `{code:'ENOSPC'}`: `updateYtDlp` rejects with `could not install yt-dlp: disk full`; `yt-dlp.exe` unchanged; no leftovers; the test run reports no unhandled error.
- `reports a folder that cannot be written`: code `EACCES`: `could not install yt-dlp: cannot write to folder`.
- `a download cut off mid-way leaves no file`: the stub's response body errors after its first chunk, real write stream: rejects with `could not download yt-dlp: the connection was lost`; no `yt-dlp.download` in the folder; `yt-dlp.exe` unchanged.

**Commit (orchestrator):** `fix: serialize tool installs and report disk-write failures`.
**Acceptance:** `npx vitest run tests/binaries.test.ts`.
**Edge cases:** an install queued behind a failed one starts with a clean folder (the failed run's `finally` ran first); `status()` is not serialized (read-only).

### Task 9: Startup, cleanup status, IPC and preload (B12 quit, B13, B16, B17, B18 result, C4)

**Stage C, after Task 7 is committed; Task 11 runs alongside.**
**Files:** `src/main/strays.ts`, new `src/main/engineHost.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/jobs/queue.ts` (`straysCleared` becomes required: one line), `src/shared/types.ts` (`EngineStatus`, `AppStatus`, `HammelApi`), `tests/strays.test.ts`, new `tests/engineHost.test.ts`, `tests/ipc.test.ts`. `file.ts` is not touched: `FileEngine.attach` and `Aria2Daemon` come from Task 6.

**9.1 Stray check reports its result (B13, C6, OQ4).** `killStrays` returns `true` only when the script ran and exited 0; a rejected runner gives `false`; it never rejects. The script queries, ends, waits 500 ms (OQ4), queries again and exits 1 when a match remains. Exact text, with the two existing pipeline stages unchanged inside `$f`:

```
$ErrorActionPreference='Stop'; $f = { Get-CimInstance Win32_Process -Filter "Name='yt-dlp.exe' OR Name='ffmpeg.exe' OR Name='aria2c.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('<prefix>', [System.StringComparison]::OrdinalIgnoreCase) } }; & $f | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 500; if (@(& $f).Count -gt 0) { exit 1 }
```

- The filter is written once, in `$f`, and invoked twice.
- `$ErrorActionPreference='Stop'` makes a failed query end the script with a non-zero code instead of reading as "none left". `Stop-Process` keeps `-ErrorAction SilentlyContinue`: a process that already ended is not a failure; the second query decides.
- P1 (probed 2026-11-22, see the table): this text exits 0 with no match, exits 1 on a failed query, ended a real matching process and exited 0, each in under 2 s against the 15 s limit. No hand run is needed before the commit; the run inside the packaged app is a checklist line.
- Tests, `tests/strays.test.ts`:
  - `reports success when the script ran`: runner resolves: `true`.
  - `reports failure when PowerShell cannot be run or a process survived`: runner rejects: `false`, no throw (replaces `never fails startup...`).
  - `stops on a failed query instead of reporting success`: the script starts with `$ErrorActionPreference='Stop';`.
  - `checks again after ending the processes`: the script contains `& $f` exactly twice, `Start-Sleep -Milliseconds 500`, and ends with `if (@(& $f).Count -gt 0) { exit 1 }`.
  - `does not fail on a process that is already gone`: contains `Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue`.
  - the four existing fragment tests and `runs the script through PowerShell without a profile` keep passing unchanged.

**9.2 Engine host (B17).** `EngineHost<Q>` exactly as in "Types and contracts".
- `status()` is `{state:'starting'}` before the first `start()`; that value is not announced through `onStatus`.
- `start()` is single-flight and never rejects. Called while the status is `error` and there is no queue (for example `installBinaries` after a failed start), it runs exactly like `retry()`. `toolsInstalled()` false: `notInstalled`, nothing else runs. Otherwise `starting`, `killStrays()`, `startAria2()`, `createQueue(daemon, straysCleared)`, then `ready` if `daemon.alive()`, else the 9.4 error.
- Any throw: stop an aria2 that was started, status `error` with `The download tools could not be started: <message>`, no queue.
- `start()` while a queue exists does nothing.
- `retry()` acts only from `error`: without a queue it runs the full `start()` (the stray check runs again: no engine is running, C5); with a queue it is the 9.4 restart.
- `onStatus` is called when the status changes in state or message, and not otherwise.
- Tests, `tests/engineHost.test.ts`:
  - `is starting before it was asked to start`.
  - `is notInstalled while a tool is missing and starts nothing`: `killStrays`, `startAria2`, `createQueue` not called; `queue()` null.
  - `goes ready and hands out the queue`: statuses seen through `onStatus`: `[ready]`; `queue()` is what `createQueue` returned; `daemon()` is the started daemon.
  - `keeps the error and no queue when aria2 cannot start`: status `error` with `The download tools could not be started: <message>`; `queue()` null; `start()` resolved.
  - `retry after an error starts the engines`: second `startAria2` succeeds: statuses `[error, starting, ready]`.
  - `retry does nothing unless the status is error`: from `ready`: no second `startAria2`.
  - `two starts at once start aria2 once`.
  - `stops the aria2 it started when a later step fails`: `createQueue` throws: daemon `stop` called once; status `error`.
  - `passes the result of the stray check to the queue`: `killStrays` false: `createQueue` got `straysCleared === false`.
  - `a retry after a failed start checks for old processes again`: `killStrays` called twice.
  - `start after an error runs like retry`: first `startAria2` rejects, then `start()` again: `killStrays` called twice, statuses `[error, starting, ready]`.

**9.3 IPC and preload.**
- `QueueLike.job/group` return `Promise<Result<null>>` and the handlers pass the result through (the Task 7 shim is removed). `QueueLike.confirmStraysGone(): void`. `HandlerDeps` gains `status()` and `retryEngines()`.
- New handlers `status`, `retryEngines`, `confirmStraysGone`; their results are defined under "Types and contracts".
- `add`/`job`/`group`/`confirmStraysGone` without a queue answer the status text: `notInstalled`: `Install the download tools first`; `starting`: `The download tools are still starting`; `error`: its message. With a queue they work in every status (after an aria2 exit the queue stays).
- `installBinaries`: after `afterInstall()` answers `{ok:false, error}` when the engine status is `error`.
- `validProbe` (B16 and everything that reaches a Job): **moved to Task 4 (amendment A4); already in place when Task 9 starts.** Kept here for reference only:
  - file: `fileName === sanitizeFileName(fileName)`, `size` null or finite >= 0, `resumable` boolean.
  - media: `title` string, `heights` an array of at most 100 finite positive numbers.
  - playlist: `index` integer >= 1 and unique; `unavailable` boolean; `reason` in `EntryReason` exactly when `unavailable`, else null; url checked when available. For an unavailable entry the url rule is the Task 4 row for a skipped job (as planned there: any string).
- Preload adds the four methods; `onStatus` subscribes to `hammel:status`.
- Tests, `tests/ipc.test.ts` (the `refuses ...` specs and `what add accepts loads again from disk` are written in Task 4, A4; Task 9 only adds `straysCleared: true` to that spec's Queue):
  - `refuses a device name, a stream name, a trailing dot and an over-long name as file name`: `CON`, `report.txt:payload`, `a.`, a 151-char name: each `BAD_REQUEST`; `report (2).pdf` accepted.
  - `refuses a file probe with a size that is not a number`; `refuses heights that are not numbers`; `refuses an unavailable entry without a reason and an available one with a reason`; `refuses duplicate playlist positions`; `refuses a playlist position that is not a whole number`.
  - `passes on why a verb failed`: fake queue answers `{ok:false,error:'x'}`: the `job` and `group` handlers return it.
  - `reports the start error instead of asking to install`: status `error`, no queue: `add` answers the message; status `starting`: the starting text; `notInstalled`: the install text.
  - `status returns the engine state and the save error`.
  - `retryEngines calls the host and answers by the status afterwards`: `ready` gives ok; `error` gives its message.
  - `confirmStraysGone calls the queue`, and fails with the status text when there is no queue.
  - `installBinaries reports an engine start error`: `afterInstall` resolves with the status at `error`: `{ok:false, error: message}`.
  - `what add accepts loads again from disk`: for a media request, a file request and a playlist request (with one placeholder whose url is `''` and one whose url is the bare id `abc123`), run the real handler, a real `Queue` (fake engines, `straysCleared: true`) and a real `Store` in a temp folder, then `new Store(...).load()`. Expected: `recoveredCorrupt === null`; the groups are equal; the loaded jobs equal the queue's jobs after mapping every job that was in an ACTIVE state to `{...job, state: 'paused', speed: 0, eta: null, interrupted: true}` (what a load does to a job found running, G12).

**9.4 aria2 exit while running (C4, ruled yes).** The host registers `daemon.onExit`. On an unexpected exit of the current daemon while a queue exists: status `error` with `The file download service stopped`; the queue stays and videos keep working. `retry()` in that state: `starting`, `startAria2()` (no stray check: this run's tools are running), `deps.attachDaemon(daemon)`, then `ready`; a failed restart gives `error` with `The download tools could not be started: <message>` and the queue still stays.
- Accepted limit (N14): while aria2 is down, queued file jobs start, fail with `the download service is not running`, use up their three retries (about 85 s) and end `failed`; after the banner's Retry each needs its own Retry. Known limits and a checklist line carry this.
- Tests, `tests/engineHost.test.ts`:
  - `reports an aria2 exit and keeps the queue`: the fake daemon's exit listener is fired: status `error` / `The file download service stopped`; `queue()` unchanged.
  - `retry restarts aria2 without the stray check and attaches it`: `killStrays` still called once in total; `attachDaemon` got the new daemon; `createQueue` called once in total; statuses end `starting, ready`.
  - `a failed restart keeps the queue and the error`.
  - `an aria2 that died during startup is reported, not hidden by ready`: the daemon's `alive()` is false when `createQueue` returns: final status `error` / `The file download service stopped`, queue kept.

**9.5 Wiring in `index.ts` (no unit test; typecheck, build and checklist).**
- Build the host with the real functions: `toolsInstalled` from `binaries.status()`; `killStrays(binDir)`; `startAria2(...)`; `createQueue` builds `MediaEngine`, `FileEngine(daemon.rpc, { daemonAlive: daemon.alive })` and the `Queue` with `straysCleared`, attaches the tray and the `changed` push, and applies `autoResumeOnStart` (which skips cut-off jobs); `attachDaemon` calls `fileEngine.attach`.
- `QueueDeps.straysCleared` becomes required (the Task 7 shim ends).
- `AppStatus` is `{ engine: host.status(), saveError }`, where `saveError` is the last value from `queue.onSaveState`. It is pushed on `hammel:status` whenever either part changes, and returned by `deps.status()`.
- `startupNotice` keeps only the corrupt-list message. `afterInstall` is `host.start()`; `retryEngines` is `host.retry()`.
- `before-quit`: `await host.queue()?.shutdown()` then `await host.daemon()?.stop()` under the existing 5 s cap. The tray gets the queue from the host.

#### Tests (tests lane)

All tests named in 9.1-9.4, in `tests/strays.test.ts`, `tests/engineHost.test.ts` and `tests/ipc.test.ts`.

#### Code (implement lane)

9.1-9.5. Do not edit the tests.

**Commit (orchestrator):** `fix: engine status with retry and checked stray cleanup`.
**Acceptance:** `npx vitest run tests/strays.test.ts tests/engineHost.test.ts tests/ipc.test.ts`; all three gates; `npm run build` succeeds.
**Edge cases and races:**
- The window asks `status()` before or after the push (state, so either order gives the same result).
- `retryEngines` clicked twice, or `installBinaries` finishing while startup's own `start()` runs: single-flight.
- The 5 s quit cap firing before `shutdown` ends (a media stop may take 10 s, a file stop 15 s): the jobs are already saved as `paused` + `interrupted`, so the next start checks for leftovers.
- A stray check that fails on B17 Retry gives `straysCleared: false` again.

### Task 10: Window (B9, B13, B15, B17, N1)

**Stage D, after Task 9 is committed** (it needs Task 9's `types.ts`).
**Files:** new `src/renderer/src/banners.ts`, `src/renderer/src/format.ts`, `src/renderer/src/strings.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/AddDialog.tsx`, `src/renderer/src/styles.css`, new `tests/renderer/banners.test.ts`, `tests/renderer/format.test.ts`.

Behaviour:
- `banners(status, snapshot): Banner[]` (shape in "Types and contracts"), in this order:
  - engine `error`: `{ id: 'engine', text: status.engine.message, action: 'retryEngines' }`.
  - `saveError !== null`: `{ id: 'save', text: saveError, action: null }`.
  - any job with `interrupted`: `{ id: 'cutOff', text: 'Some downloads were cut off and Hammel could not check that their old processes are gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then confirm.', action: 'confirmStraysGone' }` (button `They are gone`, behind `window.confirm`).
  None of them has a close button. The existing dismissible message banner stays for one-off errors.
- `App`: subscribes `onStatus`, then calls `status()`. Shows the setup screen when `engine.state === 'notInstalled'`; no longer derives readiness from `binaries()`. A banner's button calls the `HammelApi` method named by its `action` and shows a failed `Result` in the message banner.
- `allowedVerbs`: a `paused` job with `interrupted` offers `['cancel']`. `statusText`: `paused 40% · waiting for a check` (`paused · waiting for a check` without a size).
- `AddDialog`: an unavailable entry shows `S.entryReasons[entry.reason]`.
- `strings.ts`: `entryReasons` (`satisfies Record<EntryReason, string>`), banner texts, `retry`, `theyAreGone`, `confirmStraysGone`; `speedLimitHint` becomes `Changing the limit restarts videos that are downloading; they continue from where they were.`; the top comment (N1) becomes: `Text of the window's own controls and dialogs. Status words, reasons from the main process, tray text and notifications are not collected here yet.`

#### Tests (tests lane)

- `tests/renderer/banners.test.ts`: `shows nothing when all is well`; `shows the engine error with Retry` (id `engine`, action `retryEngines`, text = the message); `shows no engine banner while starting, ready or not installed`; `shows the save error without a button` (action null); `shows the cut-off banner only while a job is cut off` (action `confirmStraysGone`); `orders engine, save, cut-off` (ids in that order with all three causes present).
- `tests/renderer/format.test.ts`: `a cut-off job offers only Cancel`; `says a cut-off job waits for a check` (with and without a size).

#### Code (implement lane)

As above. Do not edit the tests.

**Commit (orchestrator):** `feat: persistent banners for engine, save and cut-off downloads`.
**Acceptance:** `npx vitest run tests/renderer`; gates and `npm run build`; the rendered banners themselves are checked by the manual checklist (no DOM tests exist in this project).
**Edge cases:** all three banners at once; the engine banner while the setup screen shows (not rendered there: setup has its own error line); a Retry that fails again replaces the text.

### Task 11: Documents (B20, Q2, Q4, checklist)

**Stage C, docs lane, alongside Task 9** (its files are disjoint from Tasks 9 and 10).
**Files:** `README.md`, `docs/manual-checklist-phase1.md`. Not edited: `docs/superpowers/plans/2026-11-22-phase1-app.md` (frozen, C3) and the design doc. The ledger is not part of this task (it moved to Task 12).

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
    - End `aria2c.exe` in Task Manager during a file download: the banner shows, videos keep running; Retry: the banner goes and the file download continues after its own Retry.
    - With aria2 ended and not restarted, queued file downloads fail after their retries (known limit); after the banner's Retry each one needs Retry.
    - Make `%APPDATA%\hammel\jobs.json` unwritable during a download: the save banner appears, downloads continue; make it writable: the banner goes within a minute. Also start the app with the file unwritable: the banner is there from the start.
    - Kill Hammel during a download, then start it: no old tool process remains and Resume works. With the check made to fail (owner's choice of method): the cut-off banner shows, Resume is refused, "They are gone" enables it.
    - Pause all twice quickly, then Resume all: each file download runs once.
    - Pause a video during its merge-free download and look at Task Manager at once: no yt-dlp and no ffmpeg from the app's folder remains (the stop counts as confirmed when yt-dlp closed; an ffmpeg that outlives it is a finding).
    - Delete file on a finished video that is open in a player: the row stays with a reason.
    - Cancel a half-downloaded video from a site other than YouTube: note any leftover files and their names (C9).
    - A playlist with a private and a deleted item: each shows `skipped` with its own reason.
    - The facts probed on Node 24.14.1 hold in the packaged app (Electron's own Node): the leftover-process check at start, Delete file on a locked file, a tool install on a full or read-only folder, a file download when aria2 stops answering.
  - Known limits: remove the speed-limit line; add "A video cut off while its parts were being joined can leave a `.temp` file" and "If the file download service stops, waiting file downloads fail after their retries; press Retry in the banner, then on each of them".

**Commit (orchestrator):** `docs: review-fix wording, checklist lines, tool folder note`.
**Acceptance:** `npm run lint` (if it covers markdown; otherwise read-through), links resolve.

### Task 12: Close (orchestrator)

- [ ] Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, serially. Expected: all exit 0, more than 532 tests, none skipped.
- [ ] Read `queue.ts` `shutdown`, `file.ts` `stop`, `media.ts` `stop` and `validate.ts` once more against the Review Focus.
- [ ] Ledger (`.superpowers/sdd/2026-11-22-phase1-app/progress.md`, not in git): one line per fix, with the final test names and counts. This is the orchestrator's entry, written here because it needs the final results.
- [ ] Hand the diff to the remaining Codex re-review pass (thread `01a202d9-93fe-7ff1-947a-db6d2a014bc7`), with new untracked files listed separately.

## Migration of existing data files

`jobs.json` (written by today's code, `version: 1`):

| Field | Absent in old files | Read as |
| --- | --- | --- |
| `Job.interrupted` | yes | `false`; then `true` for a job found in an ACTIVE state at this load |
| `Job.sourceHeight` | yes | `null` |
| everything else | no | unchanged |

- The file keeps `version: 1`; the next save writes the two new fields.
- Old files pass the new validation: urls were checked at add time, a skipped job may carry any url string (A2), persisted file names get the structural rule only with no length cap (A1), meters out of range are normalized instead of rejected (A3), `baseName` of today's code is at most about 165 chars (limit 200).
- An old paused "Best" job with data (`bytesDone > 0`) keeps the mkv path, so its partial files stay usable. An old "Best" job with no data yet gets the height check on its next start.
- Jobs already listed keep their names; the new namespace applies to names given from now on.
- Rollback: the previous build reads a file written by this one (its check is looser and ignores extra fields). No conversion in either direction.

`settings.json`: no new field. A valid old file loads unchanged. A wrong field falls back alone to its default: `downloadDir` `Downloads\Hammel`, `askEveryTime` false, `maxConcurrent` 3, `speedLimitKbps` 0, `autoResumeOnStart` false, `preferMp4Max1080` false, `defaultQuality` `{kind:'best'}`, `subtitleLangs` `[]`.

Per the owner's rule the owner reviews the Task 4 diff (validation and migration). Per the owner's instruction of 2026-11-22 (never block on the owner) the orchestrator commits it locally after the gates and the Task 4 review verdict; nothing is pushed and no PR is opened until the owner has reviewed it.

## Owner rulings on the open questions (closed 2026-11-22)

| # | Question | Ruling | Lands in |
| --- | --- | --- | --- |
| OQ1 | aria2 alive but not answering: after how many consecutive silent polls is the job shown as not moving, and is aria2 ever ended by the app for it? | 5 polls zero the shown speed, once per outage; never end aria2 automatically (quit and restart recovers) | Task 6 |
| OQ2 | While `jobs.json` cannot be written: how often to retry, and may the banner be closed? | retry every 60000 ms; not closable; goes away on the first good save (C2) | Tasks 7.4, 10 |
| OQ3 | Time limit of the per-item height check (Q2). | 30 s, the existing probe default; on expiry a retryable `timed out reading the link` | Task 5 |
| OQ4 | Wait between ending leftover processes and the second query. | 500 ms | Task 9.1 |
| OQ5 | In-session "Check again" for B13. | not in this change; restart or "They are gone" (C5) | Tasks 7.7, 10 |
| OQ6 | Add `.temp.<ext>` and non-numeric `f<id>` to the shapes Cancel may delete? | no until the checklist shows the real names (C9) | Tasks 5, 11 |
| OQ7 | B19: a playlist whose remaining items are all `skipped` after the cancel: still announce "Playlist finished"? | announce only when at least one remaining item is `done` or `failed` | Task 7.10 |
| OQ8 | C1, C4, C7: the fourth engine state, the aria2 restart on Retry, and `max` qualities staying as they are. | yes, yes, yes | Tasks 9.2, 9.4, 3 |
| OQ9 | Time limit of one aria2 JSON-RPC call (critique G4). | 5 s through `AbortSignal.timeout`; expiry is an `Aria2TransportError` | Task 6 |
| OQ10 | How long a media engine stop waits (critique N1). | at most 10 s for the yt-dlp process to end; past that the stop rejects with `could not confirm that the download stopped`, the engine keeps the job and keeps reporting, like the file engine | Tasks 5, 7.2 |

## Still unverified after this plan

Q1 and Q3 in full; for Q2 the real format selection, `--remux-video` on a precombined input and the height check's output; what aria2 1.37.0 answers to `remove` and `tellStatus` for a finished or unknown gid; `max-download-limit` through `changeOption` on a running download; whether an ffmpeg child can outlive a confirmed media stop; every banner on screen. Probes P1-P5 hold for Node 24.14.1 only; under Electron 45.4.1's own Node they are checklist lines. All are lines in `docs/manual-checklist-phase1.md`.

## Revision log

| Gap | Change made or reason rejected |
| --- | --- |
| G1 | Task 5: the fake's height-probe mode is keyed on `-J` with `--no-playlist`; with the variable unset it behaves as `none`; "a default Best job logs two argument lines" stated, with a spec. |
| G2 | Task 5: `MediaEngine` options `probeTimeoutMs`, `stopTimeoutMs`, `kill`; fake mode `garbage`; specs for the time limit, unreadable output, and no pre-probe for prefer-mp4, `max` and `audio`. |
| G3 | Task 5 reads the height through `parseProbe(...).heights[0]`; 7.8 stores `probed` and `probe.heights` only when finite > 0, with specs; the `count()` guard is written into Task 4 as a rule and into the Global Constraints. |
| G4 | Task 6: `createRpcClient(..., timeoutMs = 5000)` with `AbortSignal.timeout` (owner: 5 s, OQ9); expiry is `Aria2TransportError`; no poll while one is in flight; specs for a silent loopback server and for stacked polls. |
| G5 | `FileEngine.attach` moved to Task 6 with its meaning for tracked entries and three specs; constructor default `daemonAlive = () => true` stated. |
| G6 | Named shims: `straysCleared?` (default true, required from 9.5) and `QueueLike.job/group: Promise<unknown>` in `ipc.ts` (Task 7 files; final type in 9.3). |
| G7 | 7.2: a group cancel leaves removal to the prune in `commit()`; spec ends with `parseSnapshotFile(lastSave) !== null`. |
| G8 | 7.4: `onSaveState` calls a new listener at once with the current value; spec for a save that failed in the constructor. |
| G9 | 7.10 carries the OQ7 rule with two specs; 60000 ms (`SAVE_RETRY_MS`) written into 7.4; one line near the top says C1-C12 and OQ1-OQ8 are ruled. |
| G10 | 9.1: exact script with `$ErrorActionPreference='Stop'`; specs assert `& $f` twice, `exit 1`, the prefix and the `SilentlyContinue` fragment; P1 results recorded. |
| G11 | "Types and contracts" gains `EngineHostDeps`/`EngineHost` (signatures, status getter, never-rejecting `start`/`retry`, initial `starting`, `attachDaemon`), the `HandlerDeps`/`QueueLike` additions with handler results, and `Banner`/`BannerAction`. |
| G12 | 9.3: the round-trip comparison is stated (jobs found active map to paused, speed 0, eta null, interrupted true). |
| N1 | Fixed by owner ruling OQ10: media stop waits at most 10 s, then rejects and keeps the job; specs in Task 5; the taskkill-fallback case stays a stated residual on the checklist. |
| N2 | Fixed: `(?:\.part)?` after `-Frag<N>` in the shape, with a table row. |
| N3 | Fixed: sort by lower-cased name, plain code-unit comparison; spec added. |
| N4 | Fixed: Task 6 lists `queue.ts` and names its shim (`setGlobalLimit?`), removed in 7.5. |
| N5 | Fixed: once per outage; counts are the last reported ones, else the job's own; three specs. |
| N6 | Fixed: `daemonHandle` exported with two specs for `alive()`/`onExit`; checklist line "end aria2c.exe during a file download". |
| N7 | Fixed: a verb that does nothing answers ok (7.1), with specs. |
| N8 | Fixed: cancel's error text given in 7.2. |
| N9 | Fixed: the restart verb re-checks state and remembered limit when it runs; two specs. |
| N10 | Fixed: verbs waiting in a chain do nothing once closed, an in-flight cancel still removes its row; two specs in 7.6. |
| N11 | Fixed: 7.8 says the playlist folder name is not made unique (residual stated), the folder is read once per add, and names given in one add join the claims. |
| N12 | Fixed: the save-retry spec runs with no retry timer pending and uses `SAVE_RETRY_MS`. |
| N13 | Fixed: `createWrite` covers the asset download only; specs for "a failed install does not block the next" and a download cut off mid-way with the real write stream. |
| N14 | Rejected: holding queued file jobs while aria2 is down is a new queue rule outside the agreed fix list; stated as a known limit in 9.4, README known limits and the checklist. |
| N15 | Fixed: Task 10 runs after Task 9 is committed (execution table). |
| N16 | Fixed: baseline is 532 tests. |
| N17 | Fixed: every remaining task has "Tests (tests lane)" and "Code (implement lane)" sections; Task 7's parts are rules, written and implemented in one pass each. |
| Section 5 | The ledger bullet moved from Task 11 to the orchestrator in Task 12; parallel rules written into "Execution order and lanes". |
| Section 7 | Task 4 described as implemented with final rules per the Task 4 review; rule table kept; `count()` guard added as a rule; the placeholder-url rule and the import cycle are left to that review; the "do not ship between Task 4 and Task 9" note added; 9.3's round trip includes a bare-id placeholder per the Task 4 table row. |
| Owner | Task 8 runs in the quick-fixes lane; commits are one per task by the orchestrator; C4 kept as ruled (9.4 no longer optional). |