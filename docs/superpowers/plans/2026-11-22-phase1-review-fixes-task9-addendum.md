# Phase 1 Review Fixes: Task 9 Addendum

This file goes with `2026-11-22-phase1-review-fixes.md` (frozen at 696ee92) and `2026-11-22-phase1-review-fixes-task4-addendum.md`. It adds C1-C3 to **Task 9** and overrides any Task 9 row it contradicts. It changes nothing in Task 4 or its addendum. It is frozen from its commit on. Every Task 9 lane, and the Task 12 review, gets this path together with the plan and the Task 4 addendum.

**Source:** a fresh Codex reviewer of Task 4 returned FIX FIRST with three findings. The advisor (Fable 5.2, medium) decided them on 2026-11-22:

| Finding | Ruling | Why |
|---|---|---|
| 1 | BLOCKING | yt-dlp can produce it |
| 2 | NON-BLOCKING | needs a buggy or hostile window; completes A6 |
| 3 | NON-BLOCKING | needs a buggy or hostile window |

The advisor chose a third Task 4 loop. The owner decided instead (2026-11-22): **move all three to Task 9 and continue**. Task 4 is committed without them.

**Known risk until Task 9 lands (finding 1):** if yt-dlp ever returns a playlist entry url with a leading or trailing non-ASCII space (for example U+00A0), the queue saves it and the next start sets the whole list aside. Nothing is lost on disk: the file is kept as the set-aside copy. The branch is not pushed before Task 9 anyway.

## C1: the loader checks a url the way IPC does

`isHttpUrl` in `validate.ts` tests `v.trim()`, so the loader accepts exactly what `validateUrl` accepts. The stored url is returned unchanged.

- **Files:** `src/main/jobs/validate.ts`, `tests/jobs/validate.test.ts`, `tests/jobs/store.test.ts`, `tests/ipc.test.ts`.
- **Specs:**
  - A queued job whose url is `" https://example.com/item"` loads, and so does one whose url ends in `﻿`. In both, the url comes back byte-identical.
  - On a queued job, `" "` and `" ftp://x"` are still rejected.
  - **Store:** a hand-written `jobs.json` with that url loads, with `recoveredCorrupt === null`. This is the case of a file written by HEAD.
  - **Round-trip harness** (real handler, `Queue` and `Store`): a playlist whose available entry has that url is added. It reloads with `recoveredCorrupt === null` and the same url.

## C2: quality is rebuilt before it leaves IPC

`copyQuality` is exported from `validate.ts`.

- `add` forwards `copyQuality(req.quality)`, or null for a file probe.
- `setSettings` builds `defaultQuality: copyQuality(s.defaultQuality)` before it calls `saveSettings` and `queue.setSettings`.

- **Files:** `src/main/jobs/validate.ts`, `src/main/ipc.ts`, `tests/jobs/validate.test.ts`, `tests/ipc.test.ts`.
- **Specs:**
  - Each kind (`best`, `max`, `audio`) with `extra: 1n`, and `best` with a circular extra: `queue.add` receives exactly the declared fields (`toStrictEqual`).
  - `setSettings` with an extra key: `saveSettings`, `queue.setSettings` and the returned value all carry the declared fields only.
  - **Real `Queue` and `Store`:** an add with `extra: 1n` answers ok, and a second add also saves. A reload shows both jobs, with `recoveredCorrupt === null`.
  - **Unit rows for `copyQuality`:** one per kind, and it returns a new object.

## C3: a url with a control character never reaches the queue or a spawn

In `ipc.ts`, one helper refuses a url that, after trimming, contains a character in U+0000-U+001F or U+007F. It runs before `mkdirSync`, `deps.probe` and `queue.add`. It applies to:

| Where | Answer |
|---|---|
| The top-level url of `probe` and `add` | the `InvalidUrl` text |
| Every available playlist entry url | `BAD_REQUEST` |

Two things stay as they are:

- Unavailable entries still accept any string url.
- The loader stays tolerant for old files.

- **Files:** `src/main/ipc.ts`, `tests/ipc.test.ts`.
- **Specs:**
  - **Refused:** `add` with `"https://example.com/a\u0000b"`, and with `\u001f` and with `\u007f` inside. In each case `queue.add` is not called and the folder is not created.
  - **Playlist:** an available entry carrying a NUL answers `BAD_REQUEST`. The same url on an unavailable entry is accepted and round-trips.
  - **Still accepted:** `"\thttps://example.com/x\n"`, where the controls are only at the edges.
  - **`probe`** with a NUL answers the `InvalidUrl` text, and `deps.probe` is not called.
  - **Real `Queue`:** after a refused NUL request, the snapshot is unchanged and nothing new is saved.

## Not touched

`queue.ts` and `probe.ts`. `Queue.add` stays tolerant, because Task 7's spec 7.8 relies on that.

## Later tasks

Task 9 writes C1-C3 together with its own `ipc.ts` changes (9.3). Task 12 checks they are in place.

## Files

Added to Task 9's file list: `src/main/jobs/validate.ts`, `tests/jobs/validate.test.ts`, `tests/jobs/store.test.ts` (C1, C2). `ipc.ts` and `tests/ipc.test.ts` are already Task 9 files.

## Process

1. Task 9's tests lane writes these specs in the same pass as 9.1-9.4, and its implement lane makes them pass.
2. The orchestrator runs the gates serially.
3. The Task 9 review also gets the Codex thread `01a20368-2e1c-7050-83f0-21dd1eab5fb6` (pass 2 of 3) with this file: are findings 1-3 closed, and did the fix break anything.

## If a new finding comes up

For findings on C1-C3 in the Task 9 review:

| New finding | What happens |
|---|---|
| A defect in C1-C3 themselves | one quick-fixes pass, then the reviewer's last pass |
| Reachable with the app's own window plus real tool output, or with a file written by an earlier version | goes back to the advisor |
| Needs a hostile window | not blocking for Task 9; listed as "IPC hardening backlog" and checked at Task 12 |

The push and PR hold is unchanged.
