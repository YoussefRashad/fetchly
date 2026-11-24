# Fetchly Phase 2, Component A2: Amendment 2 (owner debate outcome)

**Amends:** `docs/plans/2026-11-23-phase2-a2-extension-shell.md` and `docs/plans/2026-11-23-phase2-a2-amendment-1.md` (neither is edited). Where they differ, this file wins.
**Source:** `.superpowers/sdd/a2/debate/SYNTHESIS.md`, with `fable-r2/final.txt` and `codex-r2/final.txt` as evidence.
**Status:** every rule is PROVISIONAL for the owner. No wire change and nothing under `src/**`. It supersedes amendment 1's header line "no new State, string": this amendment adds one `State` and one string. It carries only the four agreed changes (decisions 10, 11, 13e and 5).

## AM2-1 (decision 10): a gated pair or unpair answers `operationRunning`

**Rules**

1. The AM-5 gate stays: not run, not queued, one `store.read()`, nothing sent, nothing mutated. `fetchly:status` is never gated.
2. The gated reply becomes `{ state: 'operationRunning', paired }`, with `paired` from that one read.
   - A failed read still answers `storageBlocked`, `paired: false`.
   - A null read still drops `held`.
   - The gate runs before the pair's input parse (`messages.ts:299`), so a gated pair with bad input also answers `operationRunning`, not `badInput`.
3. `checking` keeps the AM-2 meaning "ask for the status now". It is now given only after a stored pair, for an obsolete status, and by unpair when another pairing is stored. AM-2's "and under AM-5" is superseded.
4. **Popup model.** An `operationRunning` reply settles at once, like any final state (`popupModel.ts:121`, `settle` at `:85-90`):
   - timers are stopped and nothing waits;
   - Check again and Pair again are shown;
   - **no follow-up `fetchly:status` is sent**, and `formOpen` is not changed by the reply.
   - The model does not check which message the reply answers.
   - The only model change is the new member of `STATES`; without it `readReply` gives `interrupted`.
5. **Retry action.** No new button. Unpair shows when `paired` is true, Pair again reopens the form, and Check again reads the status. The user presses one; nothing retries by itself (§9).
6. **Late reply from the running operation.** It belongs to an older sequence and is ignored (`popupModel.ts:116`, unchanged). The popup keeps showing `operationRunning` until the user acts. A running operation from another popup instance never reaches this model.
7. **View.** The title is `t.operationRunning`, the hint is empty, `showForm` is false and `showUnpair` is `reply.paired`.

**Files touched**

- `messages.ts`: the `gated` branch, the header at `:9-10` and the comment at `:135`.
- `view.ts`: `State`, and the comment at `:7` gains "`operationRunning` is replied only to a pair or an unpair".
- `popupModel.ts`: `STATES` and the comment at `:119`.
- `strings.ts`: one key.
- `popup.ts` is unchanged; it tests only `connected` (`:46`).

**Order inside the change**

- The `State` member and the string key land together, because `view.ts:58` indexes `t[reply.state]`.
- The tests lane edits `fixtures.ts` first: `world.ts:145` asserts that every reply is in `ALL_STATES`.

**Existing specs that flip** (`checking` becomes `operationRunning`, same `paired`)

| Spec in `messages.test.ts` | Assertion | Text to reword |
|---|---|---|
| `:763` | `:772` | title, comment `:761-762` |
| helper `gatedWorld` | `:1190` | titles `:1199`, `:1207`; comment `:1157-1162` |
| `:2078` | `:2086` | title |
| `:2098` | `:2106` | title |
| `:2115` | `:2122` | title |
| `:2129` | `:2136` | title |
| `:2282` (timing) | `:2304` | none |
| file header | none | `:26` |

- `view.test.ts:30-32`: 15 becomes 16 states. Its header at `:7-9` becomes "11 + 4 + 1": the 16th state is its own group, "the gate reply (amendment 2)".
- `fixtures.ts:45-47`, `:53-68`, `:71-87` (`State`, `ALL_STATES`) and `:14` (26 becomes 27 keys).
- `strings.test.ts:4`, `:47-48` (27 keys), one new `TABLE` row, and the comment at `:12` names amendment 2.
- Unchanged in `messages.test.ts`: `:2181` (`storageBlocked`), `:2200` (one read), `:2244` with its `:2253` (that pair ran), `:2257`.
- Unchanged: `popupModel.test.ts:344-454`, since unpair can still answer `checking`.
- `flow.test.ts`: no gated assertion (`:77`, `:93`, `:106`, `:157` are stored pairs).

**New specs (acceptance)**

- `messages.test.ts`:
  - A pair gated by a running unpair, and an unpair gated by a running pair, each answer `operationRunning`. `/v1/pair` and `/v1/unpair` counts do not change, and there are no puts.
  - A gated pair with bad input (`'nonsense'`) answers `operationRunning`, not `badInput`.
  - Status during a held pair still gets its normal reply and never `operationRunning`.
  - After the running job ends, the same Unpair sent again runs and answers `notPaired`.
- `popupModel.test.ts`, for an `operationRunning` reply to `fetchly:unpair`, to `fetchly:pair` and to `fetchly:status`:
  - `pending` does not grow (no status is sent);
  - no timer is left, and `showCheckAgain` and `showPairAgain` are true;
  - `formOpen` is unchanged: false after `submit`, and still true when the form was opened by Pair again before Unpair;
  - a later reply to an older sequence leaves the state unchanged;
  - Check again then sends exactly one status;
  - advancing 30 s after the settle does not give `interrupted`.
- `view.test.ts`: `operationRunning` with `paired` true and false, in both languages: `showUnpair` equals `paired`, no form, empty hint.
- `flow.test.ts`, one addition on the real worker: the first pair is held at the app and a second submit is sent. The model shows `operationRunning` and sends no status. After the first pair ends, Check again gives `connected`.

**Edge cases**

- A first pair is running and no record is stored: `paired: false`, so no Unpair button. It stays hidden after the record is stored, until Check again.
- An unpair is running: Unpair is shown, and pressing it later answers `notPaired`.
- **Double submit.** The first pair's own reply is dropped (`popupModel.ts:116`), so its `wrongCode` or `storageFailed` is never shown. Check again shows the real state. Submitting the same code again after the first pair succeeded gives `pairingClosed` with `paired: true`.
- A null gated read with `held` set: `held` is dropped (pinned by `:1199`).
- A worker built before this amendment cannot run with this popup, because both ship in one `dist`.

**Boundary:** none on the A1 wire. For A3, `State` has 16 members and `Strings` has 27 keys. The architecture plan names no popup state for the gate.

## AM2-2 (decision 11): the budgets are conditional. No behaviour change

**Rules (wording only)**

1. AM-5's 22 s (status, unpair) and 27 s (pair) are sums of configured I/O waits: store deadlines and fetch timeouts. They assume WebCrypto calls and task scheduling return promptly. `proofIsRight` awaits `subtle` with no timer (`client.ts:299-309`).
2. The popup's 30 s applies per message. It starts again for the follow-up status after a `checking` reply.
3. A stalled WebCrypto call ends in the popup as `interrupted`. A stalled WebCrypto call, or a stalled `callWith` inside unpair or inside pair's best-effort unpair, keeps the gate shut. Later pairs and unpairs answer `operationRunning` until the worker restarts. No token is sent in that state.
4. No proof deadline is added. It would have to answer `wrong_program`, which is a worse lie.

**Living docs that carry this wording**

- `README.md`, "The extension (Chrome and Edge)", one new bullet:
  > If the popup keeps saying "Another operation is running" (in Arabic: «عملية أخرى قيد التنفيذ»), an earlier step is stuck. Turn the extension off and on in the browser's extensions page, then open the popup again.
- The header comments of `extension/src/lib/messages.ts` and `extension/src/lib/popupModel.ts`: rules 1 to 3 in two or three lines each.
- Not a target: any file under `docs/plans/**` or `docs/superpowers/plans/**`.

**Specs:** none flip. One new spec in `messages.test.ts`: a `callWith` that never settles inside unpair. A later unpair answers `operationRunning` (not `checking`, not queued), and status still answers.

**Edge cases**

- A worker restart reopens the gate, because `running` is module memory (`messages.ts:128`). Turning the extension off ends the worker.
- Whether the browser by itself stops a worker that holds an unanswered message is not probed, and nothing here claims it.

**Boundary:** none.

## AM2-3 (decision 13e): a completion after `work` threw is not `ok`

**Rules**

1. Amended AM-1 rule 2: `storage_failed` means a **confirmed no-mutation**. It is answered when:
   - `transaction()` throws, or
   - `onabort` fires, or
   - an `abort()` call returns without throwing, or
   - **`work` threw synchronously (it returned no getter: `value === null` at `store.ts:221`) and `oncomplete` then fires.**
2. So `completedWithoutValue` (`store.ts:235`) answers `storage_failed` for every operation:

   | Operation | Why a synchronous throw queued nothing |
   |---|---|
   | `write` | Its work is one `put` (`store.ts:273`), with nothing that can throw after it. |
   | `removeIf` | Its only synchronous request is the `get` (`:279`); the `delete` is issued later, inside `onsuccess`. |
   | `clear` | Its work is one `delete` (`:289`). |
   | `read` | Unchanged (`get` at `:252`). |

   The choice of `storage_failed` over `storage_unknown` for `removeIf` and `clear` is PROVISIONAL.
   - It is provable today, and it is uniform with `write`.
   - Nothing depends on it: unpair ignores the result (`messages.ts:287`), `call` ignores it (`client.ts:372-373`), and `clear` is not in `HandlerDeps` (`messages.ts:29`).
3. Invariant, kept as a comment on `Outcomes`: rule 1 is sound only while each `work` makes one synchronous request call and nothing can throw after it. An operation whose `work` can issue a request and then throw synchronously must set `completedWithoutValue` to `storage_unknown`. The field stays per operation for that reason.
4. Unchanged, and deliberate: the same throw with a refused `abort()` and **no** terminal event inside the grace still answers `storage_unknown` for mutations (`store.test.ts:1077`), although nothing was queued. The owner approved only the `oncomplete` case. The cost is one stale entry in the app (AM-1's residual). A commit that is truly uncertain is never `storage_failed`.
5. The pair handler's logic is unchanged. After rule 2, `ok` is always a real `oncomplete` with the work finished, so `held = replaced` stays set before the final read (`messages.ts:237-240`), also when that read fails. AM-1's "`ok`: as frozen" and AM-3 stand as written.

**Files touched**

- `store.ts`: `forMutation`, the `Outcomes` comments (`:126-129`) and the header at `:8-11` ("a confirmed rollback only" becomes rule 1).
- `messages.ts`: only the comment at `:253`.
- `fixtures.ts`: one amendment 2 line after `:19-22`, giving the new meaning of `storage_failed`.

**Existing specs that flip**

- `store.test.ts:998` and `:1027`: for write, removeIf and clear, an `oncomplete` inside the grace (at 500 ms and at 999 ms) gives `storage_failed`. Titles change. `close` is 1 and no timer is pending.
- The AM-1 rule 4 note at `store.test.ts:922-926` gains one sentence for rule 1.
- `messages.test.ts`: none. The hand-made factory lives only in `store.test.ts`. `:1910` is unchanged, and `:1555` and `:1565` already cover the `storage_unknown` rows.

**New specs (acceptance)**

- `store.test.ts`:
  - Control on the real fake: `commitHold` with `releaseCommitting('complete')` still gives `ok` and the backing changed.
  - With the hand-made factory, the `kv` call count is 0 before the throw.
  - `read` control: an `oncomplete` inside the grace still answers `storage_failed`.
- `messages.test.ts`:
  - A is stored and `store.write` answers `storage_failed`: exactly one `/v1/unpair` with B's credentials, the reply is `storageFailed`, `paired: true`, and A is still stored. A following `connected` status sends no `/v1/unpair` to A.
  - A is stored, the write answers `ok` and the final read fails: `storageBlocked`, `paired: false`. A later `connected` status unpairs A exactly once. This pins rule 5.

**Edge cases**

- The rule 1 trigger (a throw, a refused `abort()`, then `oncomplete`) is synthetic. An empty transaction commits nothing by specification, so no browser probe is needed.
- If the best-effort unpair of B fails, B stays as a stale entry: AM-1's residual.

**Boundary:** none. The `Store` result types are unchanged.

## AM2-4 (decision 5): `mismatch` keeps its state and gets new text

**Rules:** the state, its triggers and `viewOf` are unchanged. Only the two strings change. Arabic uses تنزيل and never تحميل for download, and Western digits; neither occurs in these strings.

**Files touched:** `strings.ts:22` and `:53`.

**Existing specs that flip:** `strings.test.ts:25` (the `mismatch` row). **New specs:** none beyond the pinned rows. The KEYS-driven checks (`:59`, `:76`, `:98`) cover both strings.

**Edge cases:** the text is also shown for an unauthenticated `400 bad_request` at pair time and for status 0; the new wording fits both.

**Boundary:** A3 reuses the key and shows the new text. Nothing changes on the wire.

## Strings added or changed (replaces or extends the plan §5 rows)

| Key | English | Arabic |
|---|---|---|
| `mismatch` (changed) | This extension and Fetchly could not communicate. Check that both are up to date. | تعذّر الاتصال بين هذه الإضافة و Fetchly. تأكد من أنهما بآخر إصدار. |
| `operationRunning` (new) | Another operation is running. Try again. | عملية أخرى قيد التنفيذ. حاول مرة أخرى. |

The table has 27 keys. `operationRunning` is placed after `pairingClosed` by convention only; no spec enforces key order (`strings.test.ts:52` sorts). Both Arabic texts are PROVISIONAL for the owner.

## Tolerances

None changes and none is 0. The 3000 ms deadline, 1000 ms grace, 5 s fetch, 5 s offer and 30 s per message are as in amendment 1. No timer is added.

## TEST CONTRACT changes

- `State` gains `'operationRunning'` (16 members), in `view.ts` and `fixtures.ts`; `ALL_STATES` gains it last.
- `Strings`, `EN` and `AR` gain the key `operationRunning` (27 keys).
- `Reply`: same shape. The worker may now reply `operationRunning`, and only to `fetchly:pair` and `fetchly:unpair`.
- `storage_failed` means a confirmed no-mutation (AM2-3 rule 1). The types are unchanged.
- Unchanged: `Store`, `CallResult`, `PairResult`, the `createClient` and `registerHandlers` deps, the popup model API, the `viewOf` signature, `fakeIdb.ts` and `world.ts`.
- Files the tests lane may edit: `fixtures.ts` (first), `messages.test.ts`, `store.test.ts`, `popupModel.test.ts`, `view.test.ts`, `strings.test.ts`, and `flow.test.ts` (the one AM2-1 addition, plus any listed contradiction).

## Rollback

A2 is uncommitted, so there is no commit to revert. Before the lanes start, the orchestrator saves a diff of `extension/src/lib/{messages,store,view,popupModel,strings}.ts`, `README.md` and the specs above to a git-ignored file; rollback is restoring it. There is no stored-record change, no migration and no wire change, so an old and a new build read the same IndexedDB record.

## Out of scope (open for the owner, from SYNTHESIS.md)

1. Rows 10 and 13 as release conditions, with a pass rule for row 13.
2. The four-slot recovery path (`pairing.ts:171`).
3. A real-browser probe of transaction order (`fakeIdb.ts:12`).
4. Reads as readwrite transactions (`store.ts:213`), before A3's polling.
5. The destructive read of an unknown shape (`store.ts:253-258`).
6. The `storageBlocked` wording (`strings.ts:24`).
7. **13e pick B** (set `held` only when the final read matches the new `pairingId`). SYNTHESIS lists it as "still open", not approved.
   - Adopting it would supersede AM-1's "`ok`: as frozen" and AM-3's "on a pair whose write is confirmed (`ok`…)".
   - It would change three signed-off outcomes after an `ok` write:
     - read fails: `held` is lost;
     - null read: `checking` becomes `storageFailed`;
     - another `pairingId`: `checking` becomes `storageFailed`, with `held` untouched.
   - None of today's rows causes a wrong revocation or a wrong `paired`, so correctness does not need it.

Also not here: a proof deadline, a queue, a language switch, the N26 texts, a manual-checklist row for a stalled gate, and the drifted line references in OWNER-REVIEW.md.

## Owner confirmations added (PROVISIONAL)

- `operationRunning`, its two texts, and "settle, no follow-up status".
- The conditional-budget wording and its README bullet.
- `storage_failed` for all three mutations when `oncomplete` follows a synchronous throw, with the no-event case left at `storage_unknown`.
- Pick B left out of this amendment.
- The `mismatch` texts.

## Critique r1 disposition

| Item | Decision | What changed |
|---|---|---|
| B1 | Fixed, option (a) | Pick B moved to "Out of scope" item 7: it was not approved, and no row needs it for correctness. AM2-3 rule 5 keeps `held = replaced` before the final read, and the read-fails spec is added. |
| B2 | Fixed | `:2304` added. The flip table lists each assertion with the titles and comments to reword (`:761-762`, `:1157-1162`, `:2129`, `:26`, `messages.ts:135`). |
| N1 | Fixed | Rule 1 states the code condition (`value === null`). Rule 3 carries the invariant. "Files touched" adds `store.ts:8-11`, `messages.ts:253` and `fixtures.ts:19-22`. |
| N2 | Fixed | Rule 4 says the two answers are deliberate, gives the reason and the cost, and no longer calls that case an uncertain commit. |
| N3 | Fixed | "`formOpen` is unchanged", with a case where the form is open before Unpair. |
| N4 | Fixed | The double-submit effect and the stale `paired` cases are edge cases. One `flow.test.ts` spec is added. |
| N5 | Fixed | "Order inside the change" is added. The 16th state is its own group (11 + 4 + 1). The `view.ts:7` comment is listed. |
| N6 | Fixed | The `:922-926` label is corrected. `:1910`, `:1555` and `:1565` are listed as unchanged. Pinning `storageFailed` at `:1910` is dropped with pick B. |
| N7 | Fixed in part | The sentence now claims only "a worker restart". The README bullet quotes both languages. The manual-checklist row is rejected: the stall needs a patched build, and the softened text depends on no unprobed behaviour. |
| N8 | Fixed | Key order is stated as a convention. The `strings.test.ts:12` comment is listed. |
| N9 | Fixed | All four are added: the gated pair with bad input, `operationRunning` to a status, the `read` control, and the read-fails row after `ok`. |