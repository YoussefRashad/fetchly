# Task D: amendment 1 to the frozen plan (after Codex review 1)

Frozen plan: `docs/plans/2026-11-23-d-housekeeping.md` (not edited). This file records the owner-delegated decision (Fable 5.2, decision advisor, 2026-11-23 19:54) on the Codex review of record (run 2; run 1 failed with an MCP violation and is not a review).

## Amendment 9 (replaces the `reason` bullet of "Window rules > errorText", plan line 307)

> `reason`: when `text` matches `/^retrying \((\d+)\/(\d+)\)$/u` and either number is not canonical decimal (`0|[1-9]\d{0,14}`: no leading zero, at most 15 digits), `other(text)`; otherwise `knownReason(text)`, else `S.errors.serverAnswered(n)` when `text` matches `/^server answered (\d+)$/u`, else `other(text)`.

Reason: plan line 402 promises that in English `errorText` equals `error` for every coded failure; a raw yt-dlp line such as `retrying (02/03)` would otherwise be shown as `retrying (2/3)`. `knownReason`, `reasonText` and `format.ts` stay unchanged, so job reasons behave as before. The `reasonOf` JSDoc in `src/renderer/src/errors.ts` is updated in the same change.

Specs (`tests/renderer/errors.test.ts`, `linkProblem`):
- `retrying (02/03)`, `retrying (2/03)`, `retrying (9007199254740993/3)`: unchanged in English; `fsi(text)` via `other` in Arabic.
- `retrying (2/3)`: still translated in Arabic, unchanged in English.
- `retrying (0/3)` and a 15-digit value: still translated; a 16-digit value is kept as it came.
- `reasonText('retrying (02/03)')` still gives `retrying (2/3)` (job-reason path pinned).

## Amendment 10: item 4 spec 5 asserts the order (review finding 2)

- `probeTimeoutMs` about 3000; wait for `kills.length === 1` and assert the elapsed time since `start()` is below `probeTimeoutMs`, with no download line and no events (the first kill is the cap kill).
- Wait for `kills.length === 2`; assert the elapsed time is at least `probeTimeoutMs` and `kills[1]` is `kills[0]`.
- Then as before: end the child by hand, `done`, no `timed out` event, mkv fallback. A red run on a loaded machine is re-run alone before it counts.

## Amendment 11: item 4 edge cases get specs (review finding 3)

- 3a, the fallback fails: over-cap probe, then a download that fails with its own reason; exactly one `error` event with that reason (not `could not read the video information`, `timed out reading the link` or `login required`); no `probed`; one mkv download line; one kill.
- 3b, a second run with `bytesDone === 0`: after 3a, start the same job again; a second `-J` child is spawned and killed at the cap, a different child from the first; a second mkv download line; no `probed`. If not covered yet, the counterpart: `bytesDone > 0` spawns no `-J` child.

If a new spec of amendments 10 or 11 goes red against the current implementation, the tests lane stops and reports; the implementation is not patched there.
