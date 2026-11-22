# Phase 1 Review Fixes: Final Review Addendum

This file goes with `2026-11-22-phase1-review-fixes.md` (frozen at 696ee92), `2026-11-22-phase1-review-fixes-task4-addendum.md` and `2026-11-22-phase1-review-fixes-task9-addendum.md`. It adds F1-F5 to **Task 12** and overrides any earlier row it contradicts (listed under "Supersedes"). It is frozen from its commit on.

**Source:** the Codex final review of the whole branch (thread `01a202d9-93fe-7ff1-947a-db6d2a014bc7`, pass 2 of 3) at 570c878 returned FIX FIRST. The orchestrator verified each finding in the code. The advisor (Fable 5.2, medium) decided them on 2026-11-22:

| Finding | Ruling | Lands in |
|---|---|---|
| B1: `confirmStraysGone()` clears cut-off marks during shutdown | BLOCKING, fix now | F1 |
| B2: a failed wiring after `new Queue` leaves an orphaned running queue; Retry builds a second writer | BLOCKING, fix now | F2 |
| B3: a speed limit aria2 did not confirm is recorded as sent and never resent | BLOCKING, fix now | F3 |
| N1: no spec for a notify timer after shutdown, nor for install cleanup keeping the install error | NON-BLOCKING, same change | F4 |
| N2: checklist check 28 gives the setup screen, not the Retry banner; check 44 has obsolete wording | NON-BLOCKING, same change | F5 |
| 4b: a verb past the `closed` check when `close()` runs | accepted | resume, retry and save-before-start have no await; pause and restart re-read state through `apply()`; `schedule()` refuses starts when closed |
| 4d: raw archive write errors, unguarded checksum `.text()` | accepted | both reach the IPC catch through `install`'s finally; cleanup runs; verification is not bypassed |
| 4e: Task 9 addendum C1-C3 | accepted | implemented, with loader, handler and real Queue/Store specs |

## F1 (B1): no stray confirmation once closing

`Queue.confirmStraysGone()` returns at once when `closed`. It stays `void`, and the IPC handler still answers ok. No other caller needs a guard: `add()` and `setSettings()` while closed only save the true current list, and `pauseAll`, `job`, `group`, `resumeAllPaused`, `schedule()` and `retune()` already refuse.

- **Files:** `src/main/jobs/queue.ts`, `tests/jobs/queue.test.ts`.
- **Spec:** two active jobs. Hold both engine stops, call `shutdown()`, then `confirmStraysGone()`. Confirm one stop and reject the other. The saved job whose stop was rejected still has `interrupted: true`; the one whose stop was confirmed has `interrupted: false`.

## F2 (B2): the host owns a queue from construction to disposal

`EngineHostDeps` gets three queue functions in place of one:

| Dep | Does |
|---|---|
| `createQueue(daemon, straysCleared): Q` | constructs only (engines and `new Queue`); synchronous; may throw |
| `wireQueue(q): void` | all fallible wiring: `onChanged`, `onSaveState`, tray attach, `resumeAllPaused`, the first `send`; synchronous; may throw |
| `disposeQueue(q): Promise<void>` | `queue.shutdown()` |

`startAll` flow:

1. `q = createQueue(daemon, straysCleared)`. If it throws: as today (abandon the daemon, fail).
2. `wireQueue(q)`. On success, set `this.q = q` only then, and settle.
3. If `wireQueue` throws: `await disposeQueue(q)` (a rejection is caught), then `abandon(daemon)`, then `fail(wiringError)`. The queue goes first because its stops need aria2 to confirm them.

All of this runs inside `single()`, so a `retry()` made meanwhile waits for it. There is no time cap on dispose: a shutdown that never settles means no second queue, which is the safe side.

**Stale initial list:** `index.ts` passes `initial: loaded.snapshot`, the list read at app start. After a disposed queue, the next `createQueue` must start from the disposed queue's `snapshot()` taken after its shutdown (set in a `finally`), so the cut-off marks it saved are kept.

**Module:** the three functions move into `src/main/queueLifecycle.ts`, with no Electron import. `index.ts` passes in `send`, the tray attach, and getters for the settings and the file engine. `attachDaemon` keeps working with the file engine of the wired queue.

**Rule the specs prove:** after a failed wiring, no second queue is built before the first one's shutdown has settled, and the second starts from the first one's final list.

- **Files:** `src/main/engineHost.ts`, new `src/main/queueLifecycle.ts`, `src/main/index.ts`, `tests/engineHost.test.ts`, new `tests/queueLifecycle.test.ts`.
- **Specs:**
  - **Host with fakes:** wiring throws. Calls run in order `createQueue`, `wireQueue`, `disposeQueue`, daemon stop. The status is `error` with the `COULD_NOT_START` prefix and the wiring message, and `queue()` is null.
  - **Retry during dispose:** a `retry()` made while `disposeQueue` is pending builds nothing until it resolves, then calls `createQueue` exactly once.
  - **Rejecting dispose:** it still ends in the same error, and a later Retry works.
  - **Wiring succeeds:** `queue()` returns the queue only after `wireQueue` returned; the status is `ready`.
  - **Real `Queue` and `Store`** with fake engines and one queued job, wiring throws: the started job gets `stop`, no further `engine.start` follows, and the saved job is paused. It is cut off only if its stop failed.
  - **Second queue:** the second `createQueue` receives that saved list. With `straysCleared` false, a cut-off job is not started.

## F3 (B3): a limit counts as sent only when aria2 confirms it

- `FileEngine.setRateLimit(jobId, bytesPerSec)` returns `Promise<boolean>`. It is true only when aria2 answered `aria2.changeOption` without error. Untracked, released, no gid, or a throw all give false. It still never rejects.
- `Queue.retune()` keeps `limits.set(id, limit)` before the call. On false, a rejection, or a synchronous throw, it runs `if (this.limits.get(id) === limit) this.limits.delete(id)`. The guard keeps a newer value from being wiped by an older late failure.
- Only `=== true` counts as confirmed. Update the `QueueDeps` type, the JSDoc and comments, and the test fakes that resolve `undefined`.
- **Retry owner:** the next settings save, including an identical one, as Task 6 promised. A job start, retry or resume already carries the current share through `addUri`. No timer.
- **Files:** `src/main/engines/file.ts`, `src/main/jobs/queue.ts`, `tests/engines/file.test.ts`, `tests/jobs/queue.test.ts`.
- **Specs:**
  - **Engine:** true on an answer. False on a transport error, on an RPC error, and when untracked, released or without a gid.
  - **Queue, failure:** for each of false, a rejection and a synchronous throw, saving identical settings calls `setRateLimit` again with the same value.
  - **Queue, confirmed:** an identical save does not resend.
  - **Overlap:** L1 pending, L2 confirmed, then L1 resolves false. An identical save does not resend L2.

## F4 (N1): two missing specs

- **Notify timer after shutdown** (`queue.ts` `progressTick`): a progress event arms the notify timer. Then `shutdown()` runs and the timer fires. No `onChanged` call comes from the timer.
- **Install cleanup failure** (`binaries.ts`): an install fails, and its cleanup (removing the partial file) also fails. The rejection carries the original install error, not the cleanup error.
- **Files:** `tests/jobs/queue.test.ts`, `tests/binaries.test.ts`.
- Both should pass against the current code. If either fails, that is a behaviour change: the implementer stops and reports.

## F5 (N2): checklist

`docs/manual-checklist-phase1.md`:

- **Check 28 becomes 28a and 28b:**
  - **28a:** renaming `aria2c.exe` gives the setup screen.
  - **28b:** a startup failure with all three tools present gives the engine banner with Retry. The implementer reads `binaries.status()` and picks a method that keeps `installed` true (for example an empty or broken `aria2c.exe` in place of the real one), then writes the restore and Retry steps.
- **Check 44:** drop "Until a later fix lands (Task 9 addendum C1)" and the "Before the fix" outcome. It becomes a plain check that the list loads with that url.

## Supersedes

- Task 6 and the `file.ts` JSDoc: "Errors are swallowed" on `setRateLimit`. It now reports confirmation as a boolean and still never rejects.
- Task 9 (B17): the `createQueue` contract "builds the engines and the queue around a running aria2". It becomes three steps: construct, wire, dispose.

## Accepted residual risks

- `new Queue` itself throwing halfway through its first `commit()`.
- No time cap on `disposeQueue`.
- A limit aria2 did not confirm is resent only at the next settings save, or at a job start, retry or resume.

## Process

1. One implementer (Claude Opus, high) in a fresh session: specs first, run them and see them fail for the right reason, then the code, for F1-F4 and the F5 edit.
2. The orchestrator runs typecheck, lint, the full tests and build, serially, then reads `startAll` and `retune` adversarially.
3. Codex pass 3 of 3 on thread `01a202d9-93fe-7ff1-947a-db6d2a014bc7`, with this file and the diff.
4. If pass 3 still has a BLOCKING finding, it goes back to the advisor. There is no fourth pass on that thread.

The push and PR hold is unchanged.
