# Phase 1 Review Fixes: Task 4 Addendum

Companion to `2026-11-22-phase1-review-fixes.md` (frozen at 696ee92). This addendum overrides any Task 4 row it contradicts; rulings 4a and 4c below stand. It is committed with Task 4 and frozen from then on. Every later lane gets this path together with the plan, Tasks 7 and 9 in particular.

**Source:** the Codex re-review of Task 4 (third pass, FIX FIRST: B1-B3 BLOCKING, N1), decided by the advisor (Fable 5.2, medium) on 2026-11-22. All four are accepted.

## Rulings

- **4a:** the stored-name rule (`isStoredFileName`) is unchanged; old files whose names are all dots (for example `...`) still load. Unusable names are refused only on new `done` events (B1).
- **4b:** fixed by B3.
- **4c:** an available playlist entry needs `reason === null`, and an unavailable entry needs a string url. Both stand as implemented.

## B1: the name a `done` event may save

The queue accepts `ev.fileName` on a `done` event only when it passes `isStoredFileName` and is not made only of whitespace and dots (`/^[\s.]*$/u`). Any other value, including a non-string, takes A9's path for both engines:

- the job becomes `failed` with reason `finished without a file`;
- it is not retried and no timer is set;
- the failure is announced;
- the job's previous `fileName` is kept.

The reason `finished without a file` now means "no usable file name".

- The predicate is one exported function in `validate.ts` (for example `isUsableDoneName`). `isStoredFileName` does not change.
- The guard lives only in `queue.ts`. `media.ts` belongs to Task 5 and is not touched.
- **Files:** `src/main/jobs/validate.ts`, `src/main/jobs/queue.ts`, `tests/jobs/validate.test.ts`, `tests/jobs/queue.test.ts`.
- **Specs:** one per name: `..`, `.`, `...`, `'   '`, `a:b`, `a\b`, `a/b`, a name with a control character, and `''`. Each spec asserts:
  - the job is `failed` with that reason;
  - no timer is pending;
  - the previous `fileName` is kept;
  - the last save passes `parseSnapshotFile`.

  Also add a file-engine case, and a positive case: `Talk.mp4 ` (with a trailing space) still completes.

## B2: arrays that cross IPC are checked position by position

Every array that comes from the window is checked one position at a time, with an index loop or `for...of`, never `every`, `some` or `map`. A hole then reads as `undefined` and fails the check. One shared helper exported from `validate.ts` does this.

- **Arrays covered:**
  - `isLangList`, which covers both `add` and `setSettings`;
  - `probe.heights`;
  - `probe.entries`;
  - `selectedIndexes`.
- All checks run before `mkdirSync` and before `queue.add`.
- `Queue.add` itself does not change and stays tolerant: Task 7 spec 7.8 calls it directly with bad heights.
- **Files:** `src/main/jobs/validate.ts`, `src/main/ipc.ts`, `tests/jobs/validate.test.ts`, `tests/ipc.test.ts`.
- **Specs:**
  - For each of the four arrays, `Array(1)` and a valid value followed by a hole. Each answers `BAD_REQUEST` (or the language message) and `queue.add` is not called.
  - `setSettings` with a `subtitleLangs` that has a hole.
  - With the real `Queue` from the round-trip harness, a playlist with a hole: the snapshot is unchanged and nothing new is saved.

## B3: the probe returns at most 100 heights

`parseProbe` returns at most `MAX_HEIGHTS` (100) heights. It sorts them highest first and then cuts, so `heights[0]` is still the maximum. Task 5 relies on that.

- `MAX_HEIGHTS` is exported from `parse.ts`. `ipc.ts` imports it and drops its own copy.
- Touching `parse.ts` inside Task 4 is fine: it belongs to Task 3, which is committed, and no later task owns it.
- **Files:** `src/main/ytdlp/parse.ts`, `tests/ytdlp/parse.test.ts`, `src/main/ipc.ts`, `tests/ipc.test.ts`.
- **Specs:**
  - 100 distinct heights are all kept.
  - 101 distinct heights give 100, with the maximum first and the lowest dropped.
  - In `tests/ipc.test.ts`, the real `parseProbe` output for 101 heights, passed to the real `add` handler, answers ok.

## N1: the queue's meter guard is proven directly

In `never saves a number the stored list would reject`, read the meters of `saves.at(-1)` directly for both jobs, after the progress events and again after `done`. A guard that works leaves these values:

| Meter | Saved value after a bad number |
|---|---|
| `bytesDone`, `bytesTotal` | the previous value |
| `speed` | 0 |
| `eta` | null |
| `actualHeight` | null |

No saved meter is negative or NaN. Removing any single `count()` guard must make the spec fail.

- **File:** `tests/jobs/queue.test.ts` only.

## Task 4 file list, extended

On top of the plan's Task 4 files: `src/main/ytdlp/parse.ts` and `tests/ytdlp/parse.test.ts`.

## Later tasks

- **Task 6:** its only `queue.ts` change is the `setGlobalLimit?` shim. The file engine echoes `job.fileName`, so an old file job named `...` now ends `failed` instead of `done`. That is intended.
- **Task 7:** it rewrites `queue.ts` and its tests. It keeps the B1 guard and its specs, and keeps `Queue.add` tolerant (spec 7.8).
- **Task 9:** it keeps the B2 hole checks and the `MAX_HEIGHTS` import when it edits `ipc.ts`. It does not rewrite the `refuses ...` specs or the round-trip spec.

## Process

1. The tests lane writes the specs.
2. The implement lane makes them pass.
3. The orchestrator runs the gates serially.
4. A fresh Codex review session (read-only, through the relay) reviews the result. It gets the diff, this addendum and all three findings files (`codex-task4-1`, `-2`, `-3`).

This is the last fix and review loop the protocol allows. If a BLOCKING finding remains, it goes back to the advisor and is queued for the owner.
