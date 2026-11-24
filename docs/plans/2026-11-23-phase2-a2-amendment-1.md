# Fetchly Phase 2, Component A2: Amendment 1 (review-sensitive pass 1)

**Amends:** `docs/plans/2026-11-23-phase2-a2-extension-shell.md` (not edited). Where they differ, this file wins.
**Source:** `.superpowers/sdd/a2/review1/final.txt`. All seven findings are accepted; F3 takes the "amend R2-8" branch.
**Status:** every rule is PROVISIONAL for the owner. No wire change, nothing under `src/**`, no new `State`, string or note. A1↔A2 meanings are unchanged.

## AM-1 (F1, BLOCKING): accept. A deadline never reports an unconfirmed outcome as a rollback

**Store (`store.ts`)**

1. `write`, `removeIf` and `clear` answer `{ ok: true }`, `storage_blocked`, `storage_failed` or the new `storage_unknown`. `read` never answers `storage_unknown`; where the rules below give it, `read` answers `storage_failed`.
2. `storage_failed` means a confirmed rollback. It is answered only when:
   - `transaction()` throws, or
   - `onabort` fires, or
   - an `abort()` call returns without throwing.

   `tx.onerror` alone answers nothing; the `onabort` that follows does.
3. The 3000 ms deadline is unchanged. Before the open settles it answers `storage_blocked`. After the transaction exists it calls `abort()` once:
   - no throw: `storage_failed` at once (as today);
   - throw (committing or finished): wait for the terminal event for `COMMIT_GRACE_MS = 1000` more. `oncomplete` gives `ok`, `onabort` gives `storage_failed`, neither by 4000 ms gives `storage_unknown`.
4. The same wait applies when `work` throws and the `abort()` that follows throws.
5. The connection is closed when the answer is given. A terminal event after the answer is ignored and never throws.

**Pair handler, by the result of `store.write(record)`**

- `ok`: as frozen.
- `storage_failed`: as frozen (one best-effort unpair of the new credentials, then `storageFailed`).
- `storage_unknown`: no `/v1/unpair` is ever sent with the new credentials. The handler does the AM-2 final read:
  - it fails: `storageBlocked`, `paired: false`;
  - it holds the new `pairingId`: exactly the success path (`checking`, `paired: true`, `held` set per AM-3);
  - otherwise: `storageFailed` with `paired` from the read, and `held` untouched.

  Residual: the app may keep an unused entry, which the user removes in Settings.

**Unpair and `call`**

- Unpair treats a `removeIf` of `storage_failed` or `storage_unknown` alike: the AM-2 final read decides the reply.
- `call` ignores the `removeIf` result. The `CallResult` is unchanged by it.

**Fake (`fakeIdb.ts`)**

- `holdAt` keeps its meaning: stuck before the commit starts, and `abort()` succeeds.
- New switch `commitHold: 'none' | 'write' | 'any'`. The transaction enters a committing phase and is listed in `idb.committing`.
- In that phase `abort()` throws `InvalidStateError` and logs `{ op: 'abortThrow', tx }`. `objectStore()` and new requests throw.
- `releaseCommitting('complete' | 'abort')` ends it. `complete` applies the writes and fires `oncomplete`. `abort` discards them and fires `onabort` (`by: 'fake'`).

**Tests**

- `store.test.ts`, each of write, removeIf and clear under `commitHold`:
  - pending at 2999 ms; at 3000 ms `abortThrow` is logged, the result is still pending and the pending timers are `[1000]`;
  - `complete` at 3999 ms gives `ok` and the backing changed;
  - `abort` at 3999 ms gives `storage_failed` and the backing is unchanged;
  - pending at 3999 ms, `storage_unknown` at 4000 ms, `openConnections` 0; a late `complete` then changes the backing and throws nothing.
- `store.test.ts`: `read` under `commitHold: 'any'` gives `storage_failed` at 4000 ms.
- `store.test.ts`: a fake that fires `onerror` without `onabort` stays pending until the deadline.
- `messages.test.ts`, pair with `commitHold: 'write'`:
  - no terminal event: `storageFailed`, no request to `/v1/unpair`, the server still has the pairing. After `releaseCommitting('complete')` a status answers `connected`.
  - `complete` inside the grace: `checking`.
  - `abort` inside the grace: one unpair, then `storageFailed`.
  - `complete` released synchronously right after `clock.advance` to 4000 ms: `checking`, `paired: true`.

## AM-2 (F2, BLOCKING): accept. `paired` comes from a final read

**Rule for every handler.** `paired` is `read.ok && read.value !== null` of a `store.read()` that starts after the handler's last store mutation and last fetch. Nothing is awaited between that read and the reply. E13's after-reply work is outside it.

- If that final read fails, the reply is `{ state: 'storageBlocked', paired: false }`, whatever happened before.
- If the handler's first read failed and nothing was sent or mutated, that failure is the answer and no second read is made. This covers the pair and unpair opening read, and `call` answering `storage_blocked`.
- If the final read is `null`, `held = null`.

**Generation counter.** `gen` is a counter in the handler set. It is incremented just before `store.write` in pair and just before `store.removeIf` in unpair.

**Status** stays outside the gate of AM-5. It takes `g0 = gen`, then `r = call(...)`, then the final read. The first matching row is the reply:

| # | Condition | Reply |
|---|---|---|
| 1 | `r` is `storage_blocked`, or the final read fails | `storageBlocked`, `paired: false` |
| 2 | The final read is `null` | `notPaired`, `paired: false`. An obsolete `connected` is discarded and no E13 cleanup runs. |
| 3 | `gen !== g0`, or `r` is `not_paired` | `checking`, `paired: true`. The result is obsolete and no E13 cleanup runs. |
| 4 | `r` is the E8f removal (`401 bad_token` or `403 bad_origin`) and the record is still stored | `notPaired`, `paired: true` (form and Unpair, like E10); `held = null`. No new state: the next status tries the removal again. |
| 5 | Anything else | The frozen §5 row with `paired: true`. E13 cleanup only for `connected` with `held` unchanged since the start. |

**Unpair**, after `removeIf`, by the final read:

- `null`: `notPaired`, `paired: false`, with the note as frozen.
- The same `pairingId`: `storageFailed`, `paired: true` (R2-6).
- Another `pairingId`: `checking`, `paired: true`.

**Pair.** Every reply path takes `paired` from the final read. The opening `hadRecord` is no longer used for replies.

**Meaning of a `checking` reply.** "Ask for the status now." It is given after a stored pair, for an obsolete status, and under AM-5.

**Tests (`messages.test.ts`)**

- Valid proof, `401 bad_token`, `removeIf` fails (`abortAt: 'write'`): `notPaired`, `paired: true`; the record is still stored.
- Row 2: the in-flight cases at `:894` and `:904`.
- Row 3: the N1 race at `:1009`.
- The final read fails after a `connected` exchange: `storageBlocked`, `paired: false`, no E13 cleanup.
- Unpair while another pairing was seeded (`:993`): `checking`, `paired: true`.
- For every reply in the file, `paired` equals `idb.peek() !== undefined` at reply time.

## AM-3 (F3): accept, by amending R2-8

"On a second pair" means on a pair whose write is confirmed (`ok`, or AM-1's confirmed-by-read case). At that moment `held` becomes the record it replaced, or `null` when it replaced none or the same `pairingId`.

A pair that fails for any reason leaves `held` untouched: `badInput`, `wrongCode`, `pairingClosed`, `mismatch`, `appNotRunning`, `wrongProgram`, `storageFailed`, `storageBlocked`. The stored record did not change, so the held one is still the record it replaced, and a mistyped code must not cost a stale entry.

Unpair, the E8f removal and any `null` final read still drop it.

**Test** (replaces the comment at `:924`): A is replaced by B; a pair answers `bad_code`; a status ends `connected`. Exactly one hello and one `/v1/unpair` go to A's port.

## AM-4 (F4): accept. `200` JSON that is not an object is `mismatch`

`CallResult` gains `{ ok: false; kind: 'wrong_shape' }`: a right proof, then a `200` whose body is valid JSON but not a plain object (array, `null`, string, number, boolean).

`{ kind: 'refused', status: 200, token: null }` now means only a `200` whose body is not JSON: no body, over the cap, bad UTF-8, or a syntax error.

- `call` and `callWith` both return it. It removes nothing and is never retried.
- Status handler: `wrong_shape` gives `mismatch`; `refused` with status 200 gives `appError`.
- Unpair: `wrong_shape` is "not `200` ok", so the note is added.
- **A2↔A3 meaning:** `wrong_shape` is a protocol disagreement. A3 treats it exactly like a `200` object that fails A3's own shape check, shows the `mismatch` text, and keeps the record.

**Tests**

- `client.test.ts:530`: the rows array, `null`, string and number, plus a new row `true`, expect `{ ok: false, kind: 'wrong_shape' }`. The rows not JSON, empty, null body and endless stay `refused`.
- `messages.test.ts` status: `200 []`, `200 null` and `200 "x"` give `mismatch`, `paired: true`. `200` plain text gives `appError`.

## AM-5 (F5): accept. No queue; E12 restated

The mutex becomes a gate. A `fetchly:pair` or `fetchly:unpair` that arrives while a pair or unpair is running is not run and not queued. It is answered from one `store.read()`:

- `{ state: 'checking', paired }`, or
- `storageBlocked`, `paired: false` if that read fails.

It sends nothing and mutates nothing. The gate opens when the running job settles, also on a throw. Status is never gated. §7's "the second pair gets `pairing_closed`" is superseded.

**Popup model.** A `checking` reply to `fetchly:pair` or `fetchly:unpair` sends a new `fetchly:status` (new sequence, new 30 s). A `checking` reply to `fetchly:status` settles with Check again and Pair again shown, and sends nothing (§9: no automatic retry).

**E12, worst case from arrival to reply, with no queue time:**

| Operation | Worst case | Made of |
|---|---|---|
| Status | 22 s | read 4, hello 5, request 5, removeIf 4, final read 4 |
| Unpair | 22 s | read 4, exchange 10, removeIf 4, final read 4 |
| Pair | 27 s | read 4, pair 5, write 4, unpair 10, final read 4 |
| Gated message | 4 s | one read |

All are under the popup's 30 s. The E13 tail stays best-effort.

**Tests**

- `messages.test.ts:672` rewritten: pair 1 is held at the app; pair 2 gets `checking` with no clock advance; `/v1/pair` was requested once.
- Unpair during a held pair: `checking`, nothing sent to `/v1/unpair`, the record untouched.
- After pair 1 ends, a new pair runs.
- Timing: a 21 s failed pair, with Unpair sent at 1 s: the Unpair reply comes at once.
- `popupModel.test.ts`: the two `checking` rules above.

## AM-6 (F6): accept both

**Chunk collision.** No config change is required. The plugin named `fetchly-extension-shell` stays findable in the default export's `plugins`. Its `generateBundle` uses only `this.error` and `this.emitFile`.

`build.test.ts` imports the config, calls `configResolved`, then `generateBundle.call({ error: throws, emitFile }, {}, bundle)` with synthetic bundles:

| Bundle | Expect |
|---|---|
| Two entries plus a shared chunk | Passes and emits `manifest.json` |
| A chunk `popup2.js` | Throws |
| A chunk `service-worker2.js` | Throws |
| `popup.js` with `isEntry: false` | Throws |
| `popup.js` with `name: 'other'` | Throws |
| `service-worker.js` with `isEntry: false` | Throws |

The header's "NOT testable" sentence is removed.

**Malformed UTF-8.** `fakeFetch.ts` gains the answer `{ kind: 'bytes'; status; bytes: Uint8Array }` and a helper `bytes(status, u8)`. The body is sent raw.

Tests run for each of `FF`, a lone `C3`, and `ED A0 80`, placed inside a string value so that lenient decoding would still parse:

| Response | Expect |
|---|---|
| Hello `{"proof":"<bad>","proof":"<valid>"}` | `wrong_program`, one log entry, no `Authorization` |
| Pair `200` with `"appVersion":"<bad>","appVersion":"0.1.0"` | `wrong_program` |
| `call` `200` `{"a":"<bad>"}` | `refused`, status 200, token null |
| Status with `"engine":"<bad>","engine":"ready"` | `appError`, `paired: true` |

## AM-7 (F7): accept. README wording

The last bullet of "The extension" becomes:

> A browser entry that no longer works (a moved folder, a removed extension) stays in Fetchly's list until you remove it in **Settings → Browser**. When a new pairing replaces an old one, the extension removes the old entry itself after the first successful connection. The old entry may remain if that check or the removal fails, if the browser stops the extension first, or if saving the pairing failed; remove it the same way.

## Tolerances (PROVISIONAL, none 0)

| Rule | Value |
|---|---|
| IndexedDB operation deadline | 3000 ms (unchanged) |
| Commit grace after a refused `abort()` (new) | 1000 ms |
| Popup gives up | 30 s (unchanged; now holds without queue time) |

## Existing specs that may change

The tests lane edits only these files and lists every changed test. New tests go in the same files.

| File | Allowed change |
|---|---|
| `fakeIdb.ts` | `commitHold`, `committing`, `releaseCommitting`, `abortThrow`; header |
| `fakeFetch.ts` | The `bytes` answer |
| `stubStore.ts` | `failRemove: null \| 'storage_failed' \| 'storage_unknown'`; return types |
| `fixtures.ts` | TEST CONTRACT header only (below) |
| `store.test.ts` | Additions only. The existing `holdAt` deadline tests stay as they are. |
| `client.test.ts` | The `:530` table (AM-4); additions for AM-6 and for a failing `removeIf` leaving the result unchanged |
| `messages.test.ts` | `:672` (AM-5); `:894`, `:904`, `:1009`, `:993` (AM-2); the comment at `:924` (AM-3); any assertion counting store reads or transactions per message, for the final read; additions |
| `flow.test.ts` | Only assertions that contradict AM-2 or AM-5, each listed |
| `popupModel.test.ts` | Additions (AM-5) |
| `build.test.ts` | Header; the new hook tests |
| `world.ts` | Only to expose the new fake controls |

Unchanged: `view.test.ts`, `strings.test.ts`, `manifest.test.ts`, `pairingInput.test.ts`, `clock.ts`, `fakeServer.ts`, `tests/fakes/fake-chrome.ts`.

## TEST CONTRACT signature changes

- `Store`: `write`, `removeIf` and `clear` answer `{ ok: true; value } | { ok: false; kind: 'storage_blocked' | 'storage_failed' | 'storage_unknown' }`. `read` is unchanged.
- `CallResult`: plan §4 plus `{ ok: false; kind: 'wrong_shape' }`.
- Unchanged: `Reply`, `State`, `PairResult`, `createClient` deps, `registerHandlers` deps, the popup model API and `viewOf`. A `checking` reply has the AM-2 meaning.

## Owner confirmations added (PROVISIONAL)

- `storage_unknown` and the 1000 ms grace.
- A final read on every reply, with the E12 figures above.
- `notPaired` with `paired: true` when the E8f removal fails.
- R2-8 as amended in AM-3.
- `wrong_shape`.
- The gate in place of a queue.