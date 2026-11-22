# Phase 1 Review Fixes: Final Review Addendum 2

This file goes with `2026-11-22-phase1-review-fixes.md` (frozen at 696ee92), the Task 4 and Task 9 addenda, and `2026-11-22-phase1-review-fixes-final-review-addendum.md` (62ea7d5). It adds G1-G2 to **Task 12** and overrides any earlier line it contradicts (listed under "Supersedes"). It is frozen from its commit on.

**Source:** Codex pass 3 of 3 on thread `01a202d9-93fe-7ff1-947a-db6d2a014bc7` reviewed the F1-F5 fix (uncommitted on top of 62ea7d5). It returned FIX FIRST: F1, F3, F4 and F5 are closed, and F2 is incomplete. The orchestrator verified both findings in the code. The advisor (Fable 5.2, medium) decided them on 2026-11-22:

| Finding | Ruling | Lands in |
|---|---|---|
| B1: a changed or save-state listener that keeps throwing makes `shutdown()` reject before any engine stop | BLOCKING, fix now | G1 |
| N1: `retry()` during a run resolves at once instead of joining it | fix now | G2 |
| a: the file engine is held in `queueLifecycle.ts` | accepted | |
| d: a quit during a dispose stops aria2 directly | accepted | |
| e: the checklist 28b banner text | accepted | |

## G1 (B1): a failing listener never stops the queue

In `src/main/jobs/queue.ts`, each listener call is wrapped in its own `try/catch`, in each of these three places:

- `notify()`, for the changed listeners
- `setSaveError()`, for the save-state listeners
- `emitFinished()`, for the finished listeners

The error is swallowed with a comment, the same way `EngineHost.set` does it. A failing listener stops neither the queue nor the listeners after it.

- **Why in the queue:** the normal quit calls the same `shutdown()`. Fixing it inside `wireQueue` would leave that path open.
- **Left throwing on purpose:** the call made at registration inside `onSaveState`. That is a wiring failure, and the host must see it.
- **No detach:** isolation is enough. A closed queue reaches its listeners only through `close()`'s own saves and notifies, and those carry the list the next queue starts from.
- **No other change to `close()`:** `transition(interrupt)` is defined for every active state, `save()` guards the store, and a synchronous throw from `engine.stop` is already caught.

**Specs, `tests/jobs/queue.test.ts`:**

- **Throwing changed listener:** it always throws, with active jobs on both engines. `shutdown()` resolves and each job gets `stop`. The first save comes before the first stop in the log. The saved jobs are paused and not cut off.
- **Same, one stop fails:** that job stays cut off, and the other is cleared.
- **Throwing save listener:** it throws on every call after registration, and the store fails at shutdown. `shutdown()` resolves and the stops are attempted.
- **No starving:** for each of the three lists, the first listener throws and the second still gets the value.
- **Outside shutdown:**
  - With a throwing changed listener, `add()` does not throw, and the job is started and saved.
  - With a throwing finished listener, the fake engine's `done` emit does not throw, and the job is done and saved.
- **Registration:** `onSaveState` with a listener that throws at registration still throws to the caller.

**Specs, `tests/queueLifecycle.test.ts`** (real `Queue`, `Store` and `EngineHost`, one queued job):

- **`send` throws on every call:**
  - `start()` resolves.
  - The engine `stop` comes before the daemon stop, and the daemon is stopped once.
  - The saved job is paused and not cut off.
  - `queue()` is null, and the status is the wiring error.
  - Then `send` heals, and Retry builds one queue from that list and goes ready.
- **`deps.onSaveState` throws on every call:** the store fails during close, and the same stop and order assertions hold.

## G2 (N1): retry joins a run in progress

`EngineHost.retry()` checks `this.running` first and returns it. Only after that does it check `state !== 'error'`. With no run, in a state other than `error`, it still resolves at once and does nothing. The JSDoc of `retry()` and the class doc are updated.

Callers: only the IPC `retryEngines` handler, which awaits and then reads the status. It now reports the real outcome instead of "starting".

**Specs, `tests/engineHost.test.ts`:**

- **Retry during a dispose:** the existing spec adds `expect(settled.retry).toBe(false)` before the dispose gate opens.
- **"Resolves at once while a start is running":** rewritten as "waits for the run in progress and starts nothing itself". The retry is not settled while the gate is held, and is settled after it opens. `startAria2` is called once.
- **The "busy" case:** it no longer awaits the retry before the gate opens. It asserts the counts, opens the gate, then awaits both.
- **New:** a retry during a held `restartAria2` joins it, with one `startAria2` for that restart.

## Supersedes

`2026-11-22-phase1-review-fixes.md` line 213, "otherwise resolves at once", in the run-in-progress case only.

## Files

`src/main/jobs/queue.ts`, `src/main/engineHost.ts`, `tests/jobs/queue.test.ts`, `tests/queueLifecycle.test.ts`, `tests/engineHost.test.ts`.

## Process

1. **Write:** one fresh quick-fixes lane session (Opus). It writes the specs first and sees them fail, then the code. It runs only the touched specs.
2. **Gates:** the orchestrator runs typecheck, lint, the full suite and build, serially. It then reads `close()`, `notify()` and `retry()` adversarially.
3. **Review:** a fresh Codex reviewer on a new thread, given the `codex-final-1` and `codex-final-3` findings, both final-review addenda and the diff. Its scope is the closure of B1 and N1 and any regression in F1-F5. It gets at most a first pass and one re-review.
4. **If still BLOCKING:** one fix round in a fresh lane, then the one re-review. If anything is still BLOCKING after that, it goes back to the advisor once. If the advisor cannot close it without a design change, it joins the owner's pre-push queue and nothing is pushed.

The push and PR hold is unchanged.
