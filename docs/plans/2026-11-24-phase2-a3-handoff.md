# Fetchly Phase 2, Component A3: Hand-off (revision 3)

> **For agentic workers:** work stage by stage, task by task, tests first. Steps use checkbox (`- [ ]`) syntax. A stage starts only after the stage before it has passed its gate run and the owner's review.

**Contract:** `docs/superpowers/plans/2026-11-22-phase2-architecture.md` ("the frozen plan"), `docs/superpowers/plans/2026-11-23-phase2-a1-server.md`, `docs/plans/2026-11-23-phase2-a2-extension-shell.md` and its amendments 1 and 2. None is edited. X-numbers mark where this plan is more specific. No wire type, token or `Outcome` is added.

**Class:** SENSITIVE (owner's choice, DV6). The orchestrator stops before git at the end of every stage; the owner reviews each stage's diff line by line. The migration diffs M1 and M2 (section 2) are reviewed apart from everything else.

**Base:** HEAD `0711a2a` (main `0beea0a`, A1, and A2 committed on its own branch, not yet merged).

**Gates:** `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:ext`, `npx vitest run`. The orchestrator runs all five serially before every commit (four runs: M1, A3a, A3b, A3c). The repo has no `AGENTS.md` or `.ai/`.

**Probes:** PA3-1, PA3-3, PA3-3b, PA3-4, PA3-5, PA3-6 (Node and Electron), PA3-6b, PA3-7 and PA2-G2 are run (section 8). PA3-2 could not be automated and is a set of manual checklist rows. Nothing is pending before the freeze.

## Critique r1 disposition

Task names follow this revision's numbering (T1 to T13, see G12).

| Id | Result | Section | Note |
|---|---|---|---|
| B1 | FIXED | 4.1 | Five new `FetchlyApi` members, as frozen: four calls and one event, each with its signature. `add` gains a field, not a member. |
| B2 | FIXED | 4.2 X19, 4.4, DV8 | The slot normalises `message` (drift DV8). Task T6's "no request value" assertion is narrowed. Tool text in the toast is owner question A3-Q17. |
| B3 | FIXED | 5.2 X15 | One poll in flight per tab, the next 2 s after the reply, a timer-driven stop, late replies ignored. Each is tested. |
| B4 | FIXED | 3.4 X17 | `ExtrasError`, `attempts` unchanged, partial data kept, no engine call, the freed slot rescheduled by a loop with no re-entry. |
| B5 | FIXED | 3.4, 3.2 | A3's sign-in step throws the frozen cookies-gone text for `oneShotLogin: true`. The pre-A3 residual is A3-Q18. |
| N1 | FIXED | 4.2 | Full state-by-event matrix. `peek`, `added` and `close` are refused unless `shown`. |
| N2 | FIXED | Drift | DV5, DV6, DV7 and DV8 added. |
| N3 | FIXED | 2, 3.2 | M1 is A3a's first task and its own diff; the later `ipc.ts` `add` change is M2, also apart. |
| N4 | FIXED | 3.2 | Alternative shown (A3-Q5). `true` with a `groupId` decided (A3-Q16). Fixtures come from main's `saveSnapshot`. `tests/helpers.ts` listed. |
| N5 | FIXED | 4.3 | The slot's probe runs under `tools.shared`. A queue rebuild does not touch a `probing` slot. |
| N6 | FIXED | 3.5 X18 | Timeout timer and abort listener are cleared on `exit`; kill is never called after it. The hole this opened is closed by R2-B1. |
| N7 | FIXED | 3.3, 8 | PA3-6 run. `shell: false` is explicit and asserted. DV4 no longer leans on the alias claim. |
| N8 | FIXED | 8 | One list of probes, versions per probe, PA3-4's pass rule tied to the 3000 ms deadline. Cases not probed are named, each with its cover. |
| N9 | FIXED | 5.2, 7 | http(s) `sender.tab.url` required; per-tab poll throttle; the `track`-after-navigation case accepted (A3-Q19); two-listener test; catch-all row. |
| N10 | FIXED | 7 | No gap was reported; the checked facts are kept in the A2↔A3 table. |
| N11 | FIXED | 3–5, 11 | Both sides of every boundary and the unit of every cap. Task T6's field list is a table. |
| N12 | FIXED | 4.5 | Pure `handoffModel.ts` with specs. |
| N13 | FIXED | 5.2 X10 | Detection of late and resized videos, button position, manual rows. |
| N14 | FIXED | 13 | A2 is committed at `0711a2a`; rollback is a plain revert. |
| N15 | FIXED | 9 | No gap was reported; doc targets stay living docs only. |
| N16 | FIXED | 5.2 X15, 11 | A forward wall-clock jump ends polling early with `stillWorking`; stated as intended. |
| N17 | FIXED | 2 | Staged as A3a, A3b, A3c in this one document. PROVISIONAL. |

No gap is rejected.

## Critique r2 disposition

| Id | Result | Section | Note |
|---|---|---|---|
| R2-B1 | FIXED | 3.5 X18, 11, 12 | One settle timer, armed by the first of a kill or `exit` and cleared only by `close`; `error` settles at once. The named test is in Task T4, with both sides of 5 000 ms. |
| R2-B2 | FIXED | 8 | Every probe names its runtime. PA3-6 and PA3-6b ran under Node 24.14.1 and under Electron 45.4.1 (Node 24.22.3); no residual is left. |
| G1 | FIXED | 5.2 X10, X11, X15, 9, 12 | PA2-G2 measured a page loaded after re-enable. An open page keeps a dead script; a click or poll that hits "Extension context invalidated." removes the button and the toast host. |
| G2 | FIXED | 5.2 X11, 9 row 20 | Manual row for a menu click that wakes a stopped worker; the click listener is registered at the top level, before the menu is rebuilt. |
| G3 | FIXED | 6, 11 (A3-Q17, A3-Q19) | Wording is now "no URL and no query"; a host name or video id may remain, recorded in both questions. |
| G4 | FIXED | 11 (A3-Q25), r1 table | DV7 has its owner question; DV8 is named in the B2 and N2 rows. |
| G5 | FIXED | 2, 3.2 | All gates run before commit 1; M1 holds every `Job` literal, as a mechanical part reviewed apart; "three fixtures"; M2 includes `tests/ipcHandoff.test.ts`. |
| G6 | FIXED | 3.3 | The spawn rule covers only the two starts that carry a header. `binaries.ts`, `strays.ts` and the aria2 start are named as untouched. |
| G7 | FIXED | 3.3, 8 | PA3-6b run: aria2 changes only `"`. The text states what was measured and makes no claim for other bytes. |
| G8 | FIXED | 3.1, 4.1, 4.5 | Paths are `src/renderer/src/…`. Two model rows added: another hand-off dialog open, and the install screen; the native confirm is stated. |
| G9 | FIXED | 3.4, 7, DV9 | Split into `headersFor(job)` and a replaceable sign-in step. The frozen `QueueDeps.extrasFor(job)` and `RunExtras` are unchanged (checked against §5); the early guard is drift DV9, owner question A3-Q27. |
| G10 | FIXED | 7, 5.3 | `wrong_shape` (AM-4) is named in the `mismatch` row. Task T10 reads "five worker-side kinds". |
| G11 | FIXED | Header, 3.6, 4.6 | Five gates in every stage, `build:ext` included. |
| G12 | FIXED | 5.2 X15, 3.1, 4.2, 4.3, tasks | A poll with no reply is a failed poll; the type is `ProbeHeaders`, listed in A3a; quit does not wait for the probe; tasks are T1 to T13. |
| Probe PA3-7 | FIXED | 5.2 X21, 8, 9 row 21 | Run: content scripts are exempt from `style-src`. Styling method decided; a manual strict-CSP row stays. |
| Probe PA3-2b | FIXED | 9 row 20 | Same as G2. |
| Probe PA3-6 on Electron | FIXED | 8 | Same as R2-B2. |
| Probe PA3-6b | FIXED | 3.3, 8 | Same as G7. |

No gap is rejected.

## Drift against the frozen plan (recorded here, not edited there)

| # | Frozen text | This plan |
|---|---|---|
| DR1 | A3 touches `src/main/validate.ts` | The file is `src/main/jobs/validate.ts`. |
| DR2 | A3's file list | Adds `src/shared/protocol.ts`, `src/shared/types.ts`, `src/main/killTree.ts`, `src/main/extras.ts`, `src/main/server/handoffRoutes.ts`, `src/renderer/src/handoffModel.ts`, `AddDialog.tsx`, `strings.ts`, `strings.ar.ts`. |
| DV3 | Host permission `<all_urls>` (§4) | `http://*/*` and `https://*/*` only. PA3-1 shows they are enough. PROVISIONAL. |
| DV4 | `--add-headers`/`--user-agent` (§5 Headers) | Both headers go through `--add-headers`. PA3-6 measured that form byte-identical under both runtimes. PROVISIONAL. |
| DV5 | End row: "window destroyed" ends the slot | True for `ready` and `shown`. While `probing` it changes nothing: no dialog exists yet, and `showWindow()` makes a new window at `ready`. PROVISIONAL. |
| DV6 | A3 class "normal + migration review" | SENSITIVE, the owner's choice: line-by-line review of every stage. |
| DV7 | A2 §2 and R2-7: one `closeBundle` check | The build has two passes. "Every file the manifest names exists" moves to pass 2. R2-7's inline-script, `on*=` and name-collision checks stay in pass 1, and the collision list gains `content.js`. Owner question A3-Q25. |
| DV8 | `probe_failed` `message` is `ProbeError.reason` (§3) | It is that reason only when it passes X19. Otherwise it is the fixed "could not read the video information". |
| DV9 | §6 gives the cookies-gone rule to A5; §5: "A3 supplies the headers, A5 adds the one-shot source" | A3 ships a sign-in step that throws the frozen cookies-gone text for `oneShotLogin: true` (B5). A5 replaces that step. No frozen signature changes: `QueueDeps.extrasFor(job)` and `RunExtras` stay as §5 writes them. Owner question A3-Q27. PROVISIONAL. |

## 1. Scope

**In**
- `/v1/handoff` and `/v1/handoff/result`; the slot (`src/main/handoff.ts`); `handoffTake`, `handoffShown`, `handoffDeclined`, `handoffClose` and the `onHandoff` event.
- Content script, button, context menu, toast, polling.
- `Job.referer`, `Job.userAgent`, `Job.oneShotLogin` (never set to `true` here); `RunExtras`, `extrasFor`.
- Headers for yt-dlp, aria2 and `probeFile`; `--` in `probeArgs`; the probe tree kill.

**Out (A4, A5, A6)**
- `candidates` collection and use, `fallback.ts`, `webRequest`, `no_video` logic.
- `cookies`, probe passes 2 and 3, `oneShot.ts`, `cookieFile.ts`, `usesYtdlp`, plain-file mode, `safeReason`.
- `/v1/logins`, stored logins, `login_expired` logic.
- A change to `store.ts` reads, a language switch, the `storage` permission.

## 2. Staging (PROVISIONAL, A3-Q20)

One document, three stages, four diffs. Each stage has its own files, tests, acceptance, boundary check and gate run.

| Stage | Content | Probes it rests on | App behaviour after it |
|---|---|---|---|
| A3a | Validators, the three `Job` fields (M1), args, engines, `RunExtras`, `extrasFor`, probe tree kill | PA3-5, PA3-6, PA3-6b | Unchanged for the user |
| A3b | Wire types, slot, routes, IPC, preload, renderer (holds M2) | None | The server accepts hand-offs; no browser sends one yet |
| A3c | Content script, menu, toast, manifest, build, docs | PA3-1, PA3-3, PA3-3b, PA3-4, PA3-7, PA2-G2; PA3-2 manual | The feature is complete |

**Order of work and review**
1. A3a Task M1, alone. Gate run (all five). The orchestrator saves its diff (git-ignored file inside the worktree) in two parts, and the owner reviews it. Commit 1.
2. The rest of A3a. Gate run, owner's diff review. Commit 2.
3. A3b. Diff M2 is saved and reviewed apart, then the rest of the stage. Gate run. Commit 3.
4. A3c. Gate run, owner's review. Commit 4. Then one PR for the branch. PROVISIONAL: one PR, opened after A2 merges, or with A2's branch as its base.

**The two parts of M1 (G5)**
- **M1-core:** `jobs/validate.ts`, the `Job` fields in `types.ts`, `QueueAdd` and `Queue.add`, the `ipc.ts` `add` rebuild, the three fixtures, and the specs of Task M1.
- **M1-literals:** every typed `Job` literal in `src/` and `tests/` (`tests/helpers.ts` and the rest) gains `referer: null`, `userAgent: null`, `oneShotLogin: false`, so commit 1 compiles alone. The files are found by `npm run typecheck`, not by a list. The orchestrator checks that every added line in this part is one of those three key-value pairs and that no line is removed.

**M2** is the `ipc.ts` `add` hunk together with `tests/ipcHandoff.test.ts` and the additions to `tests/ipc.test.ts`.

**Migration isolation rule.** After M1, no task edits `jobs/validate.ts`, the three fixtures or `Queue.add`. The only later change to migration-class code is M2. An implementer who needs any other such edit stops and reports. At the end the orchestrator produces the diff again over `validate.ts`, `types.ts` (the `Job` fields), `Queue.add`, the `ipc.ts` `add` rebuild and the fixtures, and checks it equals M1-core plus M2.

Workers run only the specs they touch. Each task: write the failing tests, run (FAIL), implement, run (PASS), then `npm run typecheck` and `npm run lint`. Workers never commit.

## 3. Stage A3a: jobs and engines

### 3.1 Files

| File | Change |
|---|---|
| `src/shared/protocol.ts` | `UA_MAX` 512, `REFERER_MAX` 2048, `reduceReferer(raw)`, `isUserAgent(v)`. |
| `src/shared/types.ts` | Three `Job` fields. |
| `src/main/jobs/validate.ts` | `parseJob`: the three fields (M1). |
| `src/main/jobs/queue.ts` | `QueueAdd` and `add` write the fields (M1); `QueueDeps.extrasFor`; `commit` (X17). |
| `src/main/ipc.ts` | The `add` rebuild passes `referer: null`, `userAgent: null`, `oneShotLogin: false` (M1). |
| `src/main/extras.ts` (new) | `headersFor`, `SignInStep`, `noSignIn`, `composeExtras` (3.4). No Electron import. |
| `src/main/queueLifecycle.ts`, `src/main/index.ts` | Pass `extrasFor`; `index.ts` composes `composeExtras(noSignIn)`. |
| `src/main/engines/engine.ts` | `RunExtras`, `CookieSource`, `ExtrasError`, `StartContext.extras`. |
| `src/main/engines/media.ts`, `file.ts` | Use `ctx.extras` headers; `spawnYtdlp` states `shell: false`. |
| `src/main/ytdlp/args.ts` | `headerArgs`; `probeArgs(url, headers)` with `--`; `heightProbeArgs(url, headers)`; `DownloadOptions.headers`. |
| `src/main/killTree.ts` (new) | `killTree`, moved unchanged from `engines/media.ts`. |
| `src/main/probe.ts` | `run` on `spawn` (X18); headers; `UNREADABLE` and the type `ProbeHeaders = { referer: string \| null; userAgent: string \| null }` exported. |
| `src/renderer/src/strings.ts`, `strings.ar.ts` | Two reason texts (section 10). |
| Every file with a typed `Job` literal | M1-literals (section 2). |
| Tests | `tests/server/protocol.test.ts`, `tests/jobs/{validate,queue,store}.test.ts`, `tests/ipc.test.ts`, `tests/ytdlp/args.test.ts`, `tests/engines/{file,media}.test.ts`, `tests/probe.test.ts`, `tests/extras.test.ts` (new), `tests/binaries.test.ts` (one assertion), `tests/helpers.ts`, `tests/fakes/{fake-ytdlp.mjs,fake-aria2.ts}`, `tests/fixtures/{jobs-phase1,jobs-first-version,jobs-no-version}.json` (all three new). |

### 3.2 The migration, M1 (`jobs.json`, version stays 1)

**`parseJob`**

| Stored value | `referer` | `userAgent` | `oneShotLogin` |
|---|---|---|---|
| Key absent | `null` | `null` | `false` |
| `null` | `null` | `null` | job invalid |
| Valid | kept (`v === reduceReferer(v)`) | kept (`isUserAgent(v)`) | kept (a boolean) |
| Present, invalid (wrong type, a query, a `"`, a control character, too long) | `null` | `null` | job invalid; the file is set aside, as for `interrupted` |

- **A3-Q5 (PROVISIONAL).** The two header fields follow the meters' precedent: a bad one loads as its neutral value. A non-boolean `oneShotLogin` follows `interrupted`: `Store` renames the file to `.corrupt-<ts>` and shows the startup notice; nothing is deleted. The cost is the whole list for a field A3 never acts on. The alternative for the owner: a bad value loads as `false`. That can never send a cookie, but after A5 it would send a sign-in-only file job through aria2 with no sign-in.
- **A3-Q16 (PROVISIONAL).** `oneShotLogin: true` with a non-null `groupId` loads as stored; `parseJob` does not cross-check. The run-time rule in 3.4 stops it at start with the cookies-gone text. Alternative: load it as `false`.
- `Store.loadSnapshot` and `parseSnapshotFile` are not changed.
- **`Queue.add`** writes the three fields for file, media and every playlist item. Group items inherit `referer` and `userAgent` and always get `oneShotLogin: false` (A3-Q6, PROVISIONAL).
- **Fixtures** are generated once with main's `saveSnapshot` (commit `0beea0a`), never written by hand. Each holds a group, a skipped item with `''` as url, a media job and a file job. `jobs-first-version.json` then has `interrupted` and `sourceHeight` removed. `jobs-no-version.json` has no `version` key.
- **An A3 build with a pre-A3 file.** Loads with `null`, `null`, `false` on every job; the next save holds the three keys.
- **A pre-A3 build with an A3 file.** Its `parseJob` builds from known keys, so the file loads, and its next save drops the three keys. A hotlink-protected job then runs without its Referer and may fail; sending the link again in the new build fixes it.
- **An A3 build with an A5 file (B5).** `oneShotLogin: true` is kept and saved back. The job never runs in A3: section 3.4.
- **A pre-A3 build with an A5 file (A3-Q18, PROVISIONAL, recorded for A5).** That build drops `oneShotLogin` and would send such a file job through aria2 with no sign-in; it could save a sign-in page under the job's name. A3 never writes `true`, so A3 alone cannot cause this. Default: A5 states it in the README. Alternative: A5 raises `version` to 2, and an old build then sets the file aside.

- [ ] **Task M1 tests (`validate.test.ts`, `store.test.ts`, `queue.test.ts`, `ipc.test.ts`):**
  - The table above, row by row, per field.
  - All three fixtures load through the real `Store.load`, and save again with the three keys on every job.
  - `Queue.add` writes the fields for file, media and playlist items; no group item has `oneShotLogin: true`.
  - A job with `oneShotLogin: true` and a `groupId` loads and saves unchanged.
  - `ipc` `add` passes `null`, `null`, `false`.
- [ ] **Task M1 literals:** add the three keys to every typed `Job` literal until `npm run typecheck` passes; nothing else changes in those files.
- [ ] **Run:** `npx vitest run tests/jobs tests/ipc.test.ts`, then the five gates (orchestrator).
- [ ] **Stop:** M1-core and M1-literals are saved for the owner's migration review.

### 3.3 Validators, args and engines

**`reduceReferer(raw)` (PA3-6, PA3-6b).** Returns `origin + pathname` of the parsed URL, or `null`. `null` for: a non-string, more than `REFERER_MAX` UTF-16 units, a scheme other than http(s), userinfo, a control character, an unparsable string. The result must match `^[\x21-\x7E]+$` and hold no `"`; otherwise `null`.
- **Measured.** Through yt-dlp the Referer arrived unchanged in every run. Through aria2 (command line and RPC) the characters `|`, `[`, `]`, `'`, `^`, and the escapes `%20` and `%41`, arrived unchanged; `"` arrived as `%22`. `"` is the only change seen, under Node 24.14.1 and under Electron 45.4.1. No run added a header.
- **Rule.** `"` is rejected up front (A3-Q24). No rule compares the sent Referer with the stored one, so nothing depends on bytes that were not measured. The plan claims "no extra header, and `"` never sent", not byte-identity for every character of `\x21-\x7E`.
- The URL parser is expected to serialise a `"` in a path as `%22` already; a unit test pins that on the CI Node versions. The explicit check holds whatever the parser does.

**`isUserAgent(v)`.** `^[\x20-\x7E]{1,512}$`. PA3-6 measured a value with `"`, `\`, `%PATH%`, `^`, `&`, `|`, `<`, `>`, a backtick, `$(x)`, `;` and `--output=evil -o x` byte-identical through yt-dlp, the aria2c command line and aria2 RPC, with no extra argv element or header, under both runtimes. Such a value is therefore accepted.

**Spawn rule (N7, narrowed by G6).** The two starts that put a header on a command line state `shell: false` in their options: `run` in `probe.ts`, and `MediaEngine.spawnYtdlp` in `media.ts` (the download and the height check both go through it). A spec asserts the option on both, and that the command is `exe.command` unchanged.
- Not touched, and not under this rule: `binaries.ts` (version check), `strays.ts`, the aria2 daemon start in `file.ts` (aria2 gets headers over RPC, never on its command line) and `killTree`'s `taskkill`.
- `tests/binaries.test.ts` gains one assertion, with no source edit: `path('yt-dlp')` and `path('aria2c')` end in `.exe`.

- [ ] **Task T1 tests (`protocol.test.ts`):**
  - `reduceReferer`: `https://a.example/p/q?token=1#f` gives `https://a.example/p/q`. `null` for each case listed above. A path holding `"` gives a result with `%22` or `null`, never a raw `"`. PA3-6b's path `/a|b[c]'d^e/f%41g` gives a result that is idempotent and holds no `"`. 2048 units pass, 2049 give `null`.
  - `isUserAgent`: 1 and 512 characters pass; empty, 513, CR, LF, tab, NUL, a non-ASCII letter and a non-string fail. PA3-6's value passes.
- [ ] **Task T2 tests (`args.test.ts`):**
  - `probeArgs(url, null)` ends with `'--', url`; so does a url that starts with `-`.
  - With both headers the argv gains exactly four elements before `--`: `--add-headers`, `Referer:<r>`, `--add-headers`, `User-Agent:<ua>`. The same for `heightProbeArgs` and `downloadArgs`.
  - Rejected values passed straight to `headerArgs` (CR, LF, NUL, tab, a Referer with a query, a Referer with `"`, 513 characters, a non-string): the argv length does not change and no element holds the value.
  - PA3-6's User-Agent: exactly one element `User-Agent:<v>`, byte-identical.
- [ ] **Task T2 tests (`file.test.ts`):** `addUri` options hold `referer` and `user-agent` exactly when non-null; the key `header` never exists; the rejected list adds no key. `extras: null` and an all-null `extras` give identical options.
- [ ] **Task T2 tests (`media.test.ts`, `binaries.test.ts`):** the fake yt-dlp's recorded argv holds the headers for the download and for the height check; the spawn options hold `shell: false`; the `.exe` assertion.
- [ ] **Run:** `npx vitest run tests/server/protocol.test.ts tests/ytdlp/args.test.ts tests/engines tests/binaries.test.ts`

### 3.4 `extrasFor`, its two parts and its throw contract (X17, B4, B5, G9)

```ts
// engines/engine.ts
type CookieSource = never;                       // A5 defines it
interface RunExtras { referer: string | null; userAgent: string | null; cookies: CookieSource | null }
class ExtrasError extends Error { constructor(readonly reason: string) }
// QueueDeps (the frozen name and argument)
extrasFor(job: Job): RunExtras | null;           // synchronous; may throw ExtrasError

// src/main/extras.ts
headersFor(job: Job): ProbeHeaders;                           // pure; never throws; the two stored values
type SignInStep = (job: Job) => CookieSource | null;          // may throw ExtrasError
const noSignIn: SignInStep;                                   // A3's step
composeExtras(signIn: SignInStep): (job: Job) => RunExtras | null;
```

**Frozen contract check (G9).** §5 fixes `StartContext.extras: RunExtras | null`, the shape of `RunExtras`, and "the queue gets it from an injected `QueueDeps.extrasFor(job)`, composed in `index.ts`". All three are unchanged. The split lives behind that function, in the composition §5 itself names. What does differ from the frozen text is who ships the cookies-gone guard first: DV9.

| Rule | Text |
|---|---|
| `headersFor` | Returns `{ referer: job.referer, userAgent: job.userAgent }`. It never reads `oneShotLogin` and never throws. A4, A5 and A6 keep it as it is. |
| `noSignIn` | Throws `ExtrasError("the sign-in sent with this link was not kept; send it again from the browser")` when `job.oneShotLogin` is `true`: A3 holds no cookies. Otherwise it returns `null`. |
| `composeExtras` | Calls `signIn(job)` first; a throw passes through unchanged and `headersFor` is not called. Then `headersFor(job)`. Returns `null` when the referer, the User-Agent and the cookies are all `null`; otherwise the three as one `RunExtras`. |
| Later components | A5 passes its own step to `composeExtras` in `index.ts`: it returns the one-shot source, or throws the same frozen text when none is held. A6 wraps A5's step. Neither edits `headersFor`, `composeExtras` or the queue. |
| Call site | `commit` is the one place an engine starts. It calls `extrasFor(job)` once per start, with the job after its `start` transition, and passes the result as `StartContext.extras`. Start, resume and retry all arrive there. |
| A throw | No engine call for that job. The job becomes `failed` through the `fail` transition. The reason is `ExtrasError.reason`, or "could not start the download" for any other throw (no error text is forwarded). |
| What stays | `attempts` unchanged; no retry timer; partial files and `bytesDone` untouched. The job is announced as failed once. |
| The freed slot | `commit` loops: schedule, save, start. A round in which a start failed is followed by another round. It never calls itself. Each failing round ends at least one job, so the loop ends. One `notify` at the end. |
| Other jobs | Jobs started in the same round still start, each with its own extras. |

- [ ] **Task T3 tests (`tests/extras.test.ts`):**
  - `headersFor` returns the two stored values for every combination, and does not throw for `oneShotLogin: true`.
  - `noSignIn` throws the exact frozen text for a lone job and for a group job; returns `null` for `false`.
  - `composeExtras(noSignIn)`: all-null gives `null`; one header set gives the object with `cookies: null`; `oneShotLogin: true` throws although both headers are set.
  - `composeExtras(step)` with a test step: a step that returns a stand-in source (cast in the spec) gives that value as `cookies` beside both headers; a step that throws a plain `Error` passes it through unchanged; the step is called exactly once per call.
- [ ] **Task T3 tests (`queue.test.ts`, with an injected `extrasFor`):**
  - `extrasFor` is called once per engine start with the started job, for a first start, a resume and a retry.
  - A throw of `ExtrasError`: state `failed` with its reason; `attempts` equal before and after; the fake engine's `start` not called; the partial file still there; one finished event.
  - A plain `Error`: the fixed text, and the error's own text nowhere in the snapshot.
  - `maxConcurrent` 1, two queued jobs, the first throws: the second starts in the same `commit`; the saved snapshot shows both states.
  - Three jobs that all throw: all `failed`, `commit` returns, `notify` called once.
  - Two started in one round, one throws: the other starts with its own extras.
- [ ] **Run:** `npx vitest run tests/extras.test.ts tests/jobs/queue.test.ts`

### 3.5 Probe run (X18)

`probeUrl(url, ytdlp, fetchImpl?, timeoutMs?, opts?)` keeps its first four positions, so today's specs stay untouched. `opts` is `{ headers, signal, kill, killGraceMs, outputCap, spawn }`; `headers` is a `ProbeHeaders`, and `spawn` is a test seam that defaults to Node's.

| Rule | Text |
|---|---|
| Start | `spawn` with `shell: false`, `windowsHide: true`, today's environment. |
| Timeout | 30 s (today's). The timer calls `kill(child)` once, a tree kill (PA3-5: yt-dlp and both children ended; `close` 400 to 418 ms after the kill). The reason is "timed out reading the link". |
| Output cap | 64 MiB of stdout (today's `PROBE_OUTPUT_CAP`), counted in bytes. One byte over calls `kill` once and discards the output. The reason is `UNREADABLE`. **Not probed against the real tool** (PA3-5 names it as untested); covered by a unit test against a fake child with an injected small cap. |
| Abort | `signal` aborted: `kill` once; the promise settles. The same signal ends the `probeFile` request. |
| Settle on `close` | The normal end. `close` clears every timer. |
| Settle timer (R2-B1) | One timer of `killGraceMs` (5 s). It is armed by whichever comes first: a kill (timeout, cap or abort), or `exit`. It is never re-armed and never cleared by `exit`; only `close` clears it. When it fires the promise settles, both output streams are destroyed and their listeners removed, and a later `close` is ignored. A leftover process goes to `killStrays`. |
| Reason at the settle timer | After a kill: that kill's reason, as above. After `exit` with no kill: the gathered output is discarded and the reason is `STOPPED_EARLY`, whatever the exit code; the output may be cut short while another process holds the pipe (A3-Q29, PROVISIONAL). |
| `error` event | Settles at once, without waiting for `close`: "yt-dlp is not installed" for `ENOENT`, `STOPPED_EARLY` otherwise. |
| After `exit` (N6) | The timeout timer and the abort listener are cleared on `exit`. `kill` is never called after `exit`, so a reused PID cannot be hit. |
| Headers | `probeArgs(url, headers)`; `probeFile` sends `Referer` and `User-Agent` when given. |

**Why this holds on any runtime.** The run settles at the first of `close`, `error` or the settle timer. It therefore does not depend on whether a given Node or Electron version fires `close` after `exit` when a grandchild holds stdout (P7d showed that a PID-only kill leaves the Python child running). The longest a probe can take is 30 s plus 5 s.

**N37 (A3-Q13, PROVISIONAL).** The `binaries.ts` version check keeps its PID-only timeout: `--version` does no network I/O.

- [ ] **Task T4 tests (`probe.test.ts`; `fake-ytdlp.mjs` gains the modes "spawn a child and hang", "flood stdout" and "leave a child holding stdout, then exit"):**
  - Timeout: `kill` called once with the child while it is alive; the reason as above.
  - Cap: with `outputCap: 1024`, a child writing 1024 bytes of valid JSON parses; one writing 1025 bytes gets one `kill` and `UNREADABLE`.
  - Abort: one `kill`; settles. Abort during `probeFile`: the fetch's signal is aborted.
  - A `kill` that ends nothing: settles `killGraceMs` after it, with the kill's reason.
  - **R2-B1, fake child through `opts.spawn`, fake timers:** `exit` with code 0 and complete JSON already written, no `close`: still pending at 4 999 ms; at 5 000 ms it rejects with `STOPPED_EARLY`; `kill` was never called; both streams are destroyed; a `close` at 6 000 ms changes nothing.
  - `exit`, then `close` at 4 999 ms: the normal result, and no timer is left.
  - A kill at 30 000 ms, `exit` at 30 400 ms, no `close`: settles at 35 000 ms (5 000 ms after the kill, not after the `exit`) with the time-out reason.
  - `error` with `ENOENT` and no `close`: settles at once.
  - **Real process, `killGraceMs: 300`:** the new fake mode exits while its child holds stdout; the probe settles with `STOPPED_EARLY` and the spec ends the leftover child by the PID the fake wrote to a temp file.
  - Exit at 29 999 ms: no `kill` at 30 000 ms. Abort after exit: no `kill`.
  - `probeFile` sends both headers when given and neither when `null`.
- [ ] **Run:** `npx vitest run tests/probe.test.ts`

### 3.6 A3a acceptance, boundary and gate

| Frozen criterion (§6, row A3) | Test |
|---|---|
| Hostile Referer and UA never add an argv element or an aria2 `header` | Tasks T1, T2; PA3-6, PA3-6b |
| Persisted Referer has no query | Tasks M1, T1 |
| Old `jobs.json` fixtures load | Task M1 |
| A timed-out probe ends through the tree kill | Task T4; PA3-5 |

**Boundary A3a↔A3b (checked by the reviewer of each stage)**

| Value | Produced in A3a | Consumed in A3b |
|---|---|---|
| `QueueAdd.referer`, `.userAgent` | Stored as given; must already satisfy `reduceReferer` and `isUserAgent`, or be `null` | The route reduces and checks them; `add` copies them from `peek`, never from the window |
| `QueueAdd.oneShotLogin` | Stored as given | A3b always passes `false` |
| `probeUrl` `opts.headers` (`ProbeHeaders`), `opts.signal` | Headers go to yt-dlp and `probeFile`; the signal ends the run by a tree kill | The slot passes the hand-off's headers and its own signal |
| A probe's longest run | 35 s: it always settles (X18) | The slot is `probing` for at most 35 s per hand-off |
| `ProbeError.reason` | App text or yt-dlp's last error line, at most 200 units, not filtered | The slot filters it (X19) before it leaves the app |
| `UNREADABLE` | The fixed text | The slot's replacement text |

**Gate run:** all five gates. `build:ext` is included because `src/shared/protocol.ts` is bundled into the extension. Then the owner's review of the A3a diff.

## 4. Stage A3b: server and slot

### 4.1 Files and the API

| File | Change |
|---|---|
| `src/shared/protocol.ts` | `Handoff`, `Candidate`, `WireCookie`, `Outcome`, `OUTCOMES`, `HandoffAccepted`, `HandoffResult`; `REQUEST_ID_RE` (22 base64url); `URL_MAX` 8192, `TITLE_MAX` 512, `CANDIDATES_MAX` 20, `COOKIES_MAX` 300, `MESSAGE_MAX` 300. |
| `src/shared/types.ts` | `AddRequest.handoffId?: string \| null`; `HandoffOffer = { handoffId, url, probe }`; five `FetchlyApi` members. |
| `src/main/handoff.ts` (new) | The slot and the result table. No Electron import. |
| `src/main/server/handoffRoutes.ts` (new) | `a3Routes(env)`: the two routes and their body checks. |
| `src/main/ipc.ts` | `add` with `handoffId` (M2); four hand-off handlers. |
| `src/main/index.ts` | Composes the slot, routes, window events, quit. |
| `src/preload/index.ts` | Five members. |
| `src/renderer/src/handoffModel.ts` (new), `src/renderer/src/App.tsx`, `components/AddDialog.tsx`, `strings.ts`, `strings.ar.ts` | Take, ack, close; one reason text. |
| Tests | `tests/handoff.test.ts`, `tests/server/handoffRoutes.test.ts`, `tests/ipcHandoff.test.ts`, `tests/renderer/handoffModel.test.ts` (new); `tests/server/protocol.test.ts`, `tests/ipc.test.ts` (additions). |

**The five `FetchlyApi` members (B1; frozen §5 names exactly these)**

| Member | Signature | Channel |
|---|---|---|
| `onHandoff` | `(cb: () => void) => () => void`, the shape of the existing `on*` members | event `fetchly:handoff`, no payload |
| `handoffTake` | `() => Promise<HandoffOffer \| null>` | invoke |
| `handoffShown` | `(id: string) => Promise<boolean>` | invoke |
| `handoffDeclined` | `(id: string) => Promise<boolean>` | invoke |
| `handoffClose` | `(id: string) => Promise<boolean>` | invoke |

A non-string `id` answers `false` and changes nothing.

### 4.2 The slot (`src/main/handoff.ts`)

```ts
createHandoff(deps: {
  probe(url: string, headers: ProbeHeaders, signal: AbortSignal): Promise<ProbeResult>;
  hasQueue(): boolean; showWindow(): void; notify(): void;
  randomId(): string; now(): number;                          // now is monotonic
  setTimer(fn: () => void, ms: number): unknown; clearTimer(h: unknown): void;
}): {
  accept(h: ValidHandoff, pairingId: string): { ok: true; requestId: string } | { ok: false; error: 'busy' | 'not_ready' };
  result(requestId: string, pairingId: string): HandoffResult | null;
  take(): HandoffOffer | null;
  shown(id: string): boolean; declined(id: string): boolean; close(id: string): boolean;
  peek(id: string): { url; probe; referer; userAgent } | null;
  added(id: string): boolean;
  windowGone(): void; quit(): void;
}
```

`ProbeHeaders` is the type exported by `probe.ts` in A3a; the global `Headers` is not used (G12).

| # | Rule |
|---|---|
| X1 | **Accept.** `not_ready` when `hasQueue()` is false. Then `busy` when a slot exists, with one `showWindow()`. Else the slot is `probing`, a `pending` result entry is made and the probe starts. `accept` never awaits. |
| X2 | **Ids.** `requestId` (wire) and `handoffId` (IPC) are two separate 128-bit random values, 22 base64url characters. Neither is shown to the other side. |
| X3 | **Probe ends.** Usable result: slot `ready`, `showWindow()`, `notify()`, ack timer started. `ProbeError` with reason `protected`: `protected`. With `login required`: `login_required` and "sign in needed". Any other reason: `probe_failed` with the X19 message. Any other throw: `probe_failed` with `UNREADABLE`. The slot is cleared. |
| X19 | **Message (B2).** The `probe_failed` message is the reason only when it is a string of at most `MESSAGE_MAX` UTF-16 units, matches neither `CONTROL` nor `BIDI`, and holds no `://`. Otherwise it is `UNREADABLE`. So no URL, and no query, leaves the app in a message; a host name or a video id from the tool's text still can (G3, A3-Q17). `message` is `''` where the frozen tables give none. |
| X4 | **Ack (Q22).** `shown(id)` on a `ready` slot: result `opened`, timer cleared, slot `shown`, returns `true`; again on the same live id: `true`. The timer fires at 10 000 ms from `ready`: `app_unresponsive`, slot cleared. `shown` at 9 999 ms wins. |
| X5 | **Take.** Returns the offer while the slot is `ready` or `shown`, the same object each time; `null` otherwise. |
| X7 | **Results.** Keyed by `requestId` and bound to the `pairingId` that made it; another pairing reads `null`. A `done` entry is readable while `now - doneAt < 330 000` ms on the monotonic clock; at exactly 330 000 ms it is gone. A `pending` entry exists exactly as long as its slot. At most 64 entries; the oldest `done` one is dropped first. |

**State by event (N1).** Every way out of a slot leaves a `done` result.

| Event | `probing` | `ready` | `shown` | No slot, or another id |
|---|---|---|---|---|
| Probe usable | to `ready` | n/a | n/a | n/a |
| Probe fails | X3 outcome; cleared | n/a | n/a | n/a |
| `shown(id)` | `false` | `opened`; to `shown`; `true` | `true` | `false` |
| `declined(id)` | `false` | `app_busy`; cleared; `true` | `false` | `false` |
| Ack deadline | n/a | `app_unresponsive`; cleared | n/a (timer cleared) | n/a |
| `peek(id)` | `null` | `null` | the stored values | `null` |
| `added(id)` | `false` | `false` | cleared; result stays `opened`; `true` | `false` |
| `close(id)` | `false` | `false` | cleared; result stays `opened`; `true` | `false` |
| `windowGone()` | nothing (DV5) | `app_unresponsive`; cleared | cleared; stays `opened` | nothing |
| `quit()` | probe aborted; `app_unresponsive`; cleared | `app_unresponsive`; cleared | cleared; stays `opened` | nothing |

Hiding the window is no event. A probe that resolves after `quit` is ignored.

### 4.3 Composition (`index.ts`)

- The slot's probe is `tools.shared(() => probeUrl(url, exe, fetch, 30000, { headers, signal }))`, the same wrapper the pasted-link probe uses, so `killStrays` (exclusive) cannot end it (N5).
- A queue rebuilt while the slot is `probing`: the probe needs only yt-dlp and goes on. `hasQueue()` is read again only by `accept` and by `add`. An `add` with no queue answers today's engine text and keeps the slot.
- Routes are registered after `a1Routes`, before `startServer`.
- `webContents` `render-process-gone` and the window's `closed` call `windowGone()`.
- In `before-quit`: stop the server, then `quit()`, then the queue shutdown.
- **Quit does not wait for the aborted probe (G12).** `quit()` aborts the signal and returns. The tree kill is a separate `taskkill` process that outlives the app, so yt-dlp ends even though nothing awaits it. Manual row 8 checks that no `yt-dlp` process is left.

### 4.4 Routes

Both need a token (A1). Body checks run before the slot is asked.

**`POST /v1/handoff` (limit `LARGE_BODY_LIMIT`, 524 288 bytes).** String caps are in UTF-16 units.

| Field | Accepted | `400 bad_request` |
|---|---|---|
| Key set | exactly the keys of `Handoff` | a key absent; an extra key |
| `url` | a string of 1 to 8192 units, `validateUrl`, no userinfo, no `CONTROL` | 8193 units; `ftp:`; userinfo; a control character; a non-string |
| `source` | `'button'` or `'menu'` | anything else |
| `referer` | `null`; with `menu`, a string of at most 2048 units, stored as `reduceReferer(v)` | `button` with a non-null value; a value whose reduction is `null`; 2049 units |
| `userAgent` | `null`, or `isUserAgent` | 513 characters; a control character; a non-string |
| `pageTitle` | `null`, or a string of 1 to 512 units with no `CONTROL` | 513 units; empty; a control character |
| `candidates` | `[]` | any non-empty array; a non-array (A3-Q7, PROVISIONAL) |
| `cookies` | `null` | anything else (A3-Q7) |

A `menu` hand-off with `referer: null` is accepted. A `menu` referer that has a query is accepted and stored reduced.

**`POST /v1/handoff/result` (limit `BODY_LIMIT`).** Body exactly `{ requestId }`. A `requestId` of 21 or 23 characters, a non-string or a wrong alphabet: `400`. An unknown id, an expired id and another pairing's id: `404 unknown_request`. Else `{ state: 'pending' }` or `{ state: 'done', outcome, message }`.

- [ ] **Task T5 tests (`tests/handoff.test.ts`; injected clock, timers, ids and probe):**
  - Every cell of the state table. After each clearing cell a new `accept` succeeds.
  - X3: each `ProbeError` reason class; a plain throw.
  - X19: a clean reason passes; a reason of 300 units passes and 301 gives `UNREADABLE`; a reason with a control character, with a bidi character, or with `https://a.example/x?token=1` gives `UNREADABLE`.
  - X4: 9 999 ms `pending`; 10 000 ms `app_unresponsive`; `shown` at 9 999 ms wins.
  - X5: three takes return the same object. `notify` as a no-op, then `take` returns the offer.
  - X7: readable at 329 999 ms after `done`, `null` at 330 000 ms; another pairing reads `null`; the 65th entry drops the oldest `done` one and never a `pending` one.
  - `quit` while `probing` aborts the signal and returns without awaiting the probe; the late probe result changes nothing.
- [ ] **Task T6 tests (`tests/server/handoffRoutes.test.ts`, the A1 rig on `127.0.0.1:0`):**
  - The field table, row by row, each boundary on both sides.
  - 524 288 bytes pass the size check; 524 289 give `413`.
  - No queue: `503 not_ready`, the slot untouched. Slot in use: `429 busy`, `showWindow` called once.
  - Result: `pending`, then `done`; the id cases above.
  - No **error** body, and no result body other than `probe_failed`, holds any request value. A `probe_failed` body holds only the X19 message.
- [ ] **Run:** `npx vitest run tests/handoff.test.ts tests/server`

### 4.5 IPC and renderer

**`add` in `ipc.ts` (X9, diff M2).** `handoffId` absent or `null`: M1's path. A non-string, non-null value: refused as any malformed request. A string: `peek(id)`. `null` fails with "This link from the browser is no longer open. Send it again from the browser." and adds nothing. Otherwise the stored url, probe, referer and User-Agent replace the window's; `dir`, `quality` and `selectedIndexes` are checked against the stored probe as today; `queue.add` runs with `oneShotLogin: false`; then `added(id)`. A failed check keeps the slot.

**Renderer model (N12, G8; `src/renderer/src/handoffModel.ts`, pure).** `onOffer(state, offer)` returns one action. Rows are checked from the top.

| State | Offer | Action |
|---|---|---|
| any | `null` | none |
| the same `handoffId` already open | that offer | none |
| the install screen is showing (no main window content) | new | `decline(id)` |
| a hand-off dialog with another `handoffId` is open | new | `replace(offer)`: the old dialog closes without `handoffClose` (its slot has already ended, or a new offer could not exist), then the new one opens |
| the app's own add dialog open (`adding` with no `handoffId`) | new | `decline(id)` |
| a pasted-link probe running, no dialog | new | `open(offer)`; the pasted probe's result is dropped when it arrives and the link stays in the bar |
| Settings open | new | `open(offer)` above it (A3-Q11, PROVISIONAL) |
| idle | new | `open(offer)` |

- The install screen normally cannot meet an offer, because `accept` answers `not_ready` with no queue; the row covers tools lost between the accept and the offer.
- The native confirm (`window.confirm` for the strays banner) blocks the renderer. No model row can run during it: the event is handled when it closes, and if that is over 10 s the ack deadline has already answered `app_unresponsive` (X4), so `handoffTake` returns `null`.

**Glue (X8).** `App` calls `handoffTake()` on mount and on every `onHandoff` event, and applies the model's action. `AddDialog` gets `handoffId`; on mount it calls `handoffShown(id)`, and `false` closes it. Close calls `handoffClose(id)`. A successful `add` only closes. `add` errors pass through `reasonText`.

- [ ] **Task T7 tests (`tests/ipcHandoff.test.ts`):**
  - `add` with a live, shown id uses the stored url, probe, referer and User-Agent although the request holds others.
  - `dir`, `quality` and `selectedIndexes` are checked against the stored probe; a failed check keeps the slot and a second `add` succeeds.
  - An unknown id, an ended id, a reused id and a `ready` but not shown id fail with the fixed text and add nothing. A non-string `handoffId` is refused.
  - `handoffTake` never returns a referer or a User-Agent. The four handlers answer `false` or `null` for a non-string id.
- [ ] **Task T8 tests (`tests/renderer/handoffModel.test.ts`):** every row of the model table, with the row order (the install screen wins over an open dialog); `replace` never yields a `handoffClose`; a pasted probe that resolves after `open` is dropped.
- [ ] **Run:** `npx vitest run tests/ipcHandoff.test.ts tests/ipc.test.ts tests/renderer`
- [ ] **Stop:** the `ipc.ts` `add` hunk, `tests/ipcHandoff.test.ts` and the `tests/ipc.test.ts` additions are saved as diff M2.

### 4.6 A3b acceptance, boundary and gate

| Frozen criterion | Test |
|---|---|
| Take is idempotent; a dropped event is recovered by take on mount | T5 |
| Ack deadline at its boundary gives `app_unresponsive` | T5 |
| `handoffShown` on an ended slot returns `false` | T5 |
| Hide keeps the slot | T5 (no hide method exists); manual row 6 |
| A second hand-off gets `busy` and shows the window | T5, T6 |
| `add` uses the stored url and probe; an unknown or reused id is refused | T7 |
| Each end event clears the slot | T5 |
| Hostile Referer and UA; persisted Referer has no query | T6, with A3a's tests |

**Boundary A3b↔A3c**

| Value | Produced in A3b | Consumed in A3c |
|---|---|---|
| `200` with exactly `{ requestId }` matching `REQUEST_ID_RE` | The hand-off was accepted; a result entry exists for this pairing | Start tracking that id. Any other `200` object is `mismatch`. |
| `{ state: 'pending' }` | The slot still exists and no outcome is set | Poll again |
| `{ state: 'done', outcome, message }` | Final. `opened` means the dialog was shown, not that a job was added. `message` is `''` or the X19 text. | Final toast; stop. `message` is shown only for `probe_failed`, after the toast's own filter. |
| `404 unknown_request` | No live result for this pairing: never existed, expired after 330 s, or the app restarted | `requestLost`; stop |
| `429 busy` | Another hand-off holds the slot; the app window was shown | `busy` text; no tracking |
| `503 not_ready` | No queue | `notReady`; no tracking |
| `referer` | Reduced again at the route; a query is accepted and dropped | The extension sends it already reduced, so no query leaves the browser |
| `400` | The body broke a rule; the body names no field value | `mismatch` |

**Gate run:** all five gates. Then the owner's review, M2 first.

## 5. Stage A3c: extension UI

### 5.1 Files

| File | Change |
|---|---|
| `extension/manifest.json` | `permissions: ["contextMenus"]`; `host_permissions` gains `http://*/*`, `https://*/*`; `content_scripts` (`matches` those two, `js: ["content.js"]`, `all_frames: true`, `run_at: "document_idle"`). |
| `extension/src/content.ts` (new) | DOM glue only: button, toast, timers, styling (X21). |
| `extension/src/lib/handoff.ts` (new) | Worker handlers for the button, the menu and the poll. |
| `extension/src/lib/handoffInput.ts` (new) | Pure: builds a `Handoff`. |
| `extension/src/lib/contentModel.ts` (new) | Pure: poll schedule, toast state, sender check, video choice, send-failure kind. |
| `extension/src/lib/strings.ts`, `src/service-worker.ts` | 18 keys; wiring and `limits: { '/v1/handoff': LARGE_BODY_LIMIT }`. |
| `extension/vite.content.config.mjs` (new), `vite.config.mjs`, `package.json` | X13. |
| Tests | `tests/extension/{handoff,handoffInput,contentModel}.test.ts` (new); `tests/extension/{manifest,build,strings}.test.ts`, `fixtures.ts`, `tests/fakes/fake-chrome.ts`. |
| Docs | `README.md`, `docs/manual-checklist-phase2.md` (section 9). |

Unchanged: `extension/src/lib/{client,store,messages,view,popupModel,pairingInput}.ts`, `popup.ts`.

### 5.2 Behaviour

**Messages (exact key sets; a refused message gets no reply and causes no work)**

| Message | From | Sender rule | Effect |
|---|---|---|---|
| `fetchly:handoff {}` | Any frame's content script | `sender.id === runtime.id`; `sender.tab.id` and `sender.frameId` integers; `sender.tab.url` parses as http(s) (N9) | The worker builds the `Handoff` from `sender.tab.url` and `sender.tab.title` (PA3-1: both present with no `tabs` permission, for top and sub-frames). The message carries no URL. |
| `fetchly:poll { requestId }` | Frame 0 | The same, and `frameId === 0`; `REQUEST_ID_RE`; X20 | One `call('/v1/handoff/result')`. The reply is `{ state: 'pending' }`, `{ state: 'done', outcome, message }` or `{ state: 'stop', toast }`. |
| `fetchly:toast { toast }`, `fetchly:track { requestId }` | Worker, `tabs.sendMessage(tabId, m, { frameId: 0 })` | Content side: `sender.id === runtime.id` and `sender.tab === undefined` | Frame 0 shows a toast or starts polling (PA3-1: only the top frame receives it). |

A2's listener keeps refusing any sender with a `tab`; A3's listener refuses any sender without one. Neither reads `paired`, `held` or `gen`.

| # | Rule |
|---|---|
| X10 | **Button.** One per frame, for the largest `<video>` whose box is at least 200×120 px and inside the viewport. Found by a scan at `document_idle`, a `MutationObserver` on the document (child list, subtree; scans debounced 500 ms), a `ResizeObserver` on each video, and a capturing `loadedmetadata` listener. The host is `position: fixed`, 8 px inside the video's top corner at the inline end, moved on scroll and resize at most once per animation frame, in a closed shadow root. Hidden when no video qualifies and in fullscreen. The click handler requires `event.isTrusted` (PA3-1: a page's `el.click()` gives `false`, real input `true`). After a click the button is disabled until frame 0 shows a toast or 5 s pass. A click in a sub-frame sends the tab's URL; the toast shows in frame 0. **Dead script (G1):** when the click's send fails as `teardown` (X22), the script removes itself. |
| X22 | **A send that fails (G1, G12).** `contentModel.sendFailure(e)` gives one of two kinds. `teardown`: `runtime.sendMessage` threw synchronously, or rejected with a message that includes `Extension context invalidated` (PA3-3b, and the PA2-G2 clarification: this is what an already open page gets after a reload or a disable and enable). `failed`: any other rejection, or a reply of `undefined`. On `teardown`, in any frame: remove the button host and the toast host, disconnect both observers, remove every listener and timer, stop the poll loop; show nothing (A3-Q26, PROVISIONAL). On `failed`: a click does nothing more (the button comes back after 5 s); a poll counts as a failed poll (X15). A browser that words the error differently lands on `failed`; manual row 22 would show it. |
| X11 | **Menu.** One item, id `fetchly-send`, contexts `link`, `video`, `audio`, on http(s) documents. It is made at **every worker start**: `removeAll`, then `create`, at the top level of the service worker. The `contextMenus.onClicked` listener is registered at the top level too, synchronously and before `removeAll`, so a click that wakes a stopped worker is delivered to it (G2; manual row 20, not probed). PA2-G2 measured that module memory resets on disable and enable, and no probe shows that `onInstalled` or `onStartup` fire then, so r1's "made in `onInstalled` and `onStartup`" stays replaced. The menu needs no content script, so it works on a page that was open before a disable and enable. `url = info.linkUrl ?? info.srcUrl`; `referer = reduceReferer(info.frameUrl ?? info.pageUrl)`; `pageTitle` is the tab title. A non-http(s) url (`blob:`, `data:`) shows `badLink` and sends nothing. **PA3-2 could not be automated**: the item's fields and its survival are checked only by manual rows 12 to 15 and 20, which gate nothing in CI. |
| X12 | **Building the `Handoff`.** `candidates: []`, `cookies: null`. The title loses control characters and is cut to 512 units with no lone surrogate; empty gives `null`. `userAgent` is `navigator.userAgent` when `isUserAgent`, else `null`. A URL over `URL_MAX` units: `badLink`. Button: `referer: null`. One hand-off per tab per 3 s: a second one is dropped silently while `now - last < 3000` ms and accepted at 3000 ms; another tab is not affected. |
| X13 | **Build (DV7).** `content.js` is a classic script: a second pass, `vite.content.config.mjs` (IIFE, one input, `emptyOutDir: false`); `build:ext` runs both passes. Pass 2 checks that every file the manifest names exists and fails on `import` or `export` in `content.js`. PA3-1's probe extension loaded its content script in both browsers; this plan's own `content.js` is checked by the build test and manual row 1. |
| X14 | **Polling and the store.** Each poll is one `call`, so one `store.read()` (a readwrite, `durability: 'strict'` transaction). `store.ts` is not changed. PA3-4 measured 60 such reads 2 s apart, with a pair write and an unpair between: max 19 ms (Chrome) and 24 ms (Edge), against the 3000 ms deadline; no read over 250 ms; overlapping readwrite transactions ran in start order across connections. The r1 fallback (readonly reads by an A2 amendment) is not needed. |
| X15 | **Poll loop (content model; B3).** At most one poll in flight. The first is sent at the `track`; the next is sent 2 s after the previous **reply**. A separate stop timer fires 120 000 ms after the `track`, also when a poll is still outstanding, and shows `stillWorking`. A reply that arrives after any stop is ignored. On each tick the loop also stops with `stillWorking` when `Date.now() - startWall >= 120 000`: a forward wall-clock jump (sleep) ends polling early, which is intended (N16); a backward step is ignored. The loop also stops at `done`, at `stop`, on `pagehide`, and on a `teardown` send failure (X22). **Failed polls:** `app_not_running` replies, `stale_proof` replies and `failed` sends (X22: no reply, as when the worker's X20 throttle refused the poll) share one counter; the next poll after a `failed` send goes out 2 s after the failure; any `pending` reply resets the counter; three in a row are tolerated and the fourth stops the loop with its own toast: `appNotRunning`, `tryAgain`, and `tryAgain` for a `failed` send. |
| X20 | **Poll throttle in the worker (N9).** Per tab: no second `call` while one is in flight, and at most one `call` per 1000 ms. A refused poll gets no reply. The content loop never reaches this limit. |
| X16 | **Toast.** One host in frame 0, closed shadow root, text set with `textContent`, `dir` and `lang` from `pick()`. `probe_failed` shows the title and, below it, `message` with `dir="auto"` when it has at most 300 units and matches neither `CONTROL` nor `BIDI`; otherwise the title alone. A final toast hides after 8 s. An `outcome` outside `OUTCOMES`: `mismatch`. A closed shadow root is not a secrecy boundary; toast text is treated as readable by the page. |
| X21 | **Styling (PA3-7; A3-Q28, PROVISIONAL).** PA3-7 measured, on a page served with `style-src 'none'`, that every method a content script used was applied in Chrome 158 and Edge 158, while the same `style=` attribute set by the page's own script was blocked. The plan uses two of the measured methods. **Looks** (colours, font, padding, focus ring, the toast's layout): one constructed `CSSStyleSheet` per host, filled with `replaceSync` and set as the closed shadow root's `adoptedStyleSheets`. **Geometry and visibility of the two hosts** (`position`, `top`, `left`, `z-index`, `display`): CSSOM, `host.style.setProperty(...)`. `content.ts` creates no `<style>` element, sets no `style` attribute through `setAttribute`, assigns no `cssText`, and builds no markup from a string (`innerHTML`, `outerHTML`, `insertAdjacentHTML`): elements come from `createElement` and text from `textContent`. So the script touches no HTML sink that `require-trusted-types-for 'script'` guards. Why this pair although all six passed: neither needs a markup string, and the page cannot reach a sheet held by a closed root. If building or adopting the sheet throws, the host is removed and nothing is shown: no half-styled button. **Not probed:** `require-trusted-types-for` and a CSP sent through `<meta>`; manual row 21 covers both. |

**Worker memory (PA3-3).** The worker stopped 6 times during 60 polls and every poll was still answered; module memory did not survive a stop. No hand-off or poll state is needed between messages: the content script holds the `requestId`. The X12 and X20 throttles live in module memory and reset when the worker restarts. That is accepted (A3-Q21, PROVISIONAL): the single slot and A1's 300 requests a minute are the real bounds, and no `storage` permission is added. Because the slot is single, at most one tab polls a `pending` request at a time.

### 5.3 Tasks

- [ ] **Task T9 tests (`handoffInput.test.ts`):** X12, with both sides of `URL_MAX` and `TITLE_MAX`; a lone surrogate at the cut; a `blob:` url; menu `linkUrl` before `srcUrl`; `frameUrl` before `pageUrl`; a referer with a query is reduced before sending.
- [ ] **Task T10 tests (`handoff.test.ts`, fake chrome):**
  - Sender rules: each failing property gives no reply and no `call`. A `tab.url` of `chrome-extension://…` is refused.
  - Both listeners registered together: each of the five worker-side message kinds (A2's `status`, `pair`, `unpair`; A3's `handoff`, `poll`) is answered exactly once or not at all, never twice.
  - The `CallResult` mapping of section 7, row by row, including `wrong_shape` and the catch-all.
  - Throttles: 2 999 ms dropped and 3 000 ms sent; another tab sent; a fresh module (worker restart) sends. X20: a second poll in flight makes no `call`; 999 ms refused and 1 000 ms sent.
  - Secrecy: with a marker token, no reply and no `tabs.sendMessage` payload holds the marker, the `pairingId` or the port.
  - `tabs.sendMessage` rejecting is swallowed and the hand-off still runs.
  - The menu is created once per module start, after `removeAll`; the `onClicked` listener is added before `removeAll` is called and before any `await`.
- [ ] **Task T11 tests (`contentModel.test.ts`, injected clocks):**
  - X15: the second poll is sent 2 000 ms after the first reply, not after the first send; a reply taking 18 s causes no second poll meanwhile; a poll that never answers ends at 120 000 ms with `stillWorking` (119 999 ms: still running); a late reply after stop changes nothing.
  - Wall clock: a forward jump of 120 000 ms stops at the next tick; a backward step does nothing.
  - Failures: three in a row tolerated; the fourth shows the fourth's toast; mixed kinds, a `failed` send among them, share the counter; a `pending` between them resets it; four `failed` sends show `tryAgain`.
  - X22: a synchronous throw of any error gives `teardown`; a rejection with `Extension context invalidated.` gives `teardown`; a rejection with other text, and a reply of `undefined`, give `failed`. `teardown` during a poll stops the loop and no later tick sends; `teardown` on a click yields the remove action.
  - Toast filter: 300 and 301 units; a control character; a bidi character; an unknown outcome.
  - Video choice: 200×120 qualifies; 199×120 and 200×119 do not; the largest wins.
- [ ] **Task T12 flips:**
  - `manifest.test.ts`: the exact `permissions`, `host_permissions` and `content_scripts` values; `contextMenus` leaves the banned list; `storage`, `cookies`, `webRequest`, `tabs`, `scripting`, `activeTab` stay banned.
  - `build.test.ts`: X13, DV7. X21: the source `extension/src/content.ts` holds none of `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `cssText`, `createElement('style')` (either quote), `setAttribute('style'` (either quote), and holds `adoptedStyleSheets`.
  - `strings.test.ts` and `fixtures.ts`: 45 keys.
- [ ] **Run:** `npx vitest run tests/extension`; `npm run build:ext` (dist gains `content.js`, with no `import` or `export`).
- [ ] **Task T13:** docs (section 9).

### 5.4 A3c acceptance and gate

- Every row of 5.2 has a test in T9 to T12, or a named manual row.
- The A3b↔A3c table of 4.6 is asserted from the extension side in T10.
- Runnable for the whole component: `npx vitest run tests/handoff.test.ts tests/extras.test.ts tests/ytdlp/args.test.ts tests/engines tests/probe.test.ts tests/server tests/ipcHandoff.test.ts tests/jobs tests/renderer tests/extension`.

**Gate run:** all five gates. Then the owner's review, then the manual checklist section "A3".

## 6. Security

| Rule | How |
|---|---|
| A hostile Referer or UA adds no argv element | Checked with the same two functions at the route, in `parseJob` and inside `headerArgs`. Each value is the second half of one element, so it cannot start an option. PA3-6 and PA3-6b measured this with `shell: false`, under Node 24.14.1 and Electron 45.4.1. |
| No aria2 `header` | `FileEngine` writes only the keys `referer` and `user-agent`; a spec asserts the key set. |
| Persisted Referer has no query and no `"` | Reduced in the extension, again at the route, and required by `parseJob`. |
| Token handling | Only `client.call`. No new storage; no new permission that reads data. The content script receives a `requestId` and toast kinds only. |
| Route input | Exact keys; every string without `CONTROL`; `url` through `validateUrl`, no userinfo. |
| What leaves the app | Outcomes and X19 messages only. No URL and no query is echoed. A `probe_failed` message can still hold a host name or a video id from the tool's own text (A3-Q17). |
| Renderer | The event has no payload. For a non-null `handoffId`, main ignores the window's url and probe. |
| Page-driven abuse | `isTrusted` on the click; sender checks; X12 and X20 throttles; A1's rate limit. |
| Injected UI | No markup from strings and no `<style>` element (X21); a spec checks the source. |
| Logging | Handlers never throw request data (A1 S17). No `console.` in `extension/src`. |

## 7. Boundaries with other components

**A2↔A3**

| Value | Meaning on both sides |
|---|---|
| `call(path, body)` | One hello, at most one token request, no retry. One call can take up to 18 s (read 4 s, hello 5 s, request 5 s, `removeIf` 4 s); X15 allows for that. `limits` carries `/v1/handoff`. |
| `not_paired`, `unpaired`, `401 bad_token`, `403 bad_origin` | `pairFirst`. The record is kept or removed by `call` alone (E8f). A removal leaves `held` set; the next status or pair reads null first, so no wrong unpair follows. |
| `storage_blocked` / `app_not_running` / `wrong_program` | `storageBlocked` / `appNotRunning` / `wrongProgram`. |
| `stale_proof` | `tryAgain`. |
| `429 busy` / `429 rate_limited` | `busy` / `rateLimited`, by token. |
| `503 not_ready` / `404 unknown_request` | `notReady` / `requestLost`. |
| Other `5xx`, or `200` that is not JSON | `appError`. |
| `too_large_local` | `badLink`. |
| `wrong_shape` (AM-4: a right proof, then a `200` whose JSON is not a plain object) | `mismatch`, the record kept: the same as a `200` object that fails A3's own shape check, as amendment 1 states. |
| **Anything else** (N9): `400`, `403 bad_host`, `404 not_found`, `405`, `413`, `415`, status 0, a `429` with a null or unknown token, any other status | `mismatch`. |
| `State` (16 members), popup, `view.ts`, `gen`, the gate | Unchanged. `Strings` grows from 27 to 45 keys. |
| Store transactions | One readwrite read per poll (PA3-4). |

**A1↔A3**

| Value | Meaning on both sides |
|---|---|
| `register(route)` | Called once per path before `start`; a duplicate throws. |
| `RouteContext.pairing` | Non-null on token routes; A3 uses only `pairing.id`. |
| `bodyLimit` | `LARGE_BODY_LIMIT` for `/v1/handoff`, `BODY_LIMIT` for the result. 524 289 bytes give `413`. |
| Rate | Each hand-off and each poll counts 1 of 300 a minute; a full poll run is at most 60. Hellos are not counted. |
| `busy`, `not_ready`, `unknown_request` | Decided after the body shape is accepted. |

**A3↔A4 and A3↔A5**

| Value | Meaning |
|---|---|
| `RunExtras` | `StartContext.extras: null` and an all-null object mean the same. |
| `CookieSource` | `never` in A3; A5 defines it. A3's engines never read `cookies`. |
| `QueueDeps.extrasFor(job)` | The frozen entry point, unchanged. It is `composeExtras(step)`, built in `index.ts`. |
| `headersFor(job)` | A3's and final: the two stored headers, for every job, with or without a sign-in. No later component replaces or wraps it. |
| The sign-in step (`SignInStep`) | A3 passes `noSignIn`. **A5 replaces it**, it does not wrap it: A5's step returns the one-shot source, or throws `ExtrasError` with the same frozen text when the cookies are gone. A6 wraps A5's step. The queue and `composeExtras` do not change (DV9). |
| `Job.oneShotLogin` | Never set to `true` by A3. A stored `true` never starts a run in A3. Only A5 sets it, in `add`. |
| `candidates`, `cookies` | A3 accepts only `[]` and `null`. A4 and A5 each relax their own check. |
| `peek(id)` | A4 and A5 extend what the slot stores; `add` reads it only from the slot, and only when `shown`. |
| Probe headers and signal | `probeUrl`'s `opts`. A5 adds the cookie file beside them. |
| X19 | A5's `safeReason` text passes X19 unchanged (fixed app text, no `://`). |
| Outcome texts | The extension has a text for all 8 outcomes, so A4 and A6 add no extension string. |

## 8. Probes (measured 2026-11-24)

One process per case; scripts outside the repository. All on Windows 11 Pro 26100. Other browser versions are covered by the manual checklist only. CI (Node 22 and 24) runs unit tests only; no probe ran on Node 22.

| Probe | Runtime | Result | Rules that rest on it |
|---|---|---|---|
| PA3-1 | Chrome 158.0.8127.36 and Edge 158.0.4370.33, headless over CDP, driven by Node 24.14.1 | PASS, both browsers. `sender.tab.url` (query and hash included) and `sender.tab.title` present with no `tabs` permission; `frameId` 0 for the top frame, non-zero for a sub-frame; `tabs.sendMessage` with `frameId: 0` reached only the top frame; page `el.click()` is untrusted. | DV3, X10, the message table |
| PA3-2 | none | **Not automatable** (headless browsers open no native menu). | X11, by manual rows 12 to 15 and 20 only |
| PA3-3 | as PA3-1 | PASS. 60 polls answered; the worker stopped 6 times; module memory lost at each stop. | X15, worker memory rule |
| PA3-3b | as PA3-1 | PASS. After a reload the old content script's `sendMessage` throws "Extension context invalidated." | X22, X15 |
| PA3-4 | as PA3-1 | PASS. Reads max 19 ms and 24 ms; pair write 14 to 15 ms; unpair 12 ms; readwrite transactions serialised in start order. | X14, A3-Q12 |
| PA2-G2 | as PA3-1 | PASS. Module memory resets on disable and enable. The content script worked on a page **loaded after** re-enable. A page that was already open keeps its old script, whose `sendMessage` throws as in PA3-3b. | X11, X22, README |
| PA3-7 | as PA3-1 | PASS, both browsers. On a `style-src 'none'` page all six content-script styling methods applied; the page's own `style=` was blocked (the control). | X21 |
| PA3-5 | Node 24.14.1 (`spawn` and `taskkill`); yt-dlp 2026.10.26 | PASS. Tree kill ended yt-dlp and both children, stalled and trickling; `close` after 400 and 418 ms; nothing alive after 1 s. | X18 |
| PA3-6 | Node 24.14.1, and Electron 45.4.1 (Node 24.22.3, the version the app ships) under `ELECTRON_RUN_AS_NODE=1`; yt-dlp 2026.10.26, aria2 1.37.0 | PASS, identical under both. User-Agent byte-identical on all three paths; no extra argv or header; aria2 sends `"` in a Referer as `%22`. | `isUserAgent`, `reduceReferer` (rejects `"`), DV4, the spawn rule |
| PA3-6b | as PA3-6 | PASS, six runs. A Referer with `\|`, `[`, `]`, `'`, `^` and `%41` arrived unchanged through yt-dlp, the aria2 command line and aria2 RPC. `"` is the only character aria2 changes. | `reduceReferer`, A3-Q24 |
| Earlier: P4, P4c, P7a, P7d, P10b, P14, P14b | As recorded in the frozen plan | As recorded in the frozen plan. | Loopback POST, `--add-headers`, tree kill, aria2 options |

PA3-5 ran under Node 24.14.1 only. Its result is a property of `taskkill /T /F` and of yt-dlp's process tree, not of Node's argv quoting, and the app's own tree kill is the same `taskkill` call the engines already use under Electron; manual row 8 checks it in the shipped app.

**Not probed, and what covers each**

| Behaviour | Cover |
|---|---|
| Stdout past the size cap, real yt-dlp | Unit test with a fake child and an injected cap (Task T4) |
| `exit` with no `close` in Electron's Node | X18 settles at the first of `close`, `error` or the timer, so no rule depends on it; Task T4 covers the event order on the CI Node versions |
| Context menu fields and survival; a menu click that wakes a stopped worker | Manual rows 12 to 15 and 20 |
| A read that finds the worker stopped (PA3-4 saw 0 cold reads) | PA3-3 shows a cold poll is answered; manual row 17 |
| An open popup sending status while a tab polls | PA3-4's serialisation result; manual row 16 |
| This plan's own `content.js` loading as a classic script | Build test; manual row 1 |
| `require-trusted-types-for`, and a CSP sent through `<meta>` | X21 uses no markup string; manual row 21 |
| The invalidated-context error on a page open across a disable and enable (PA3-3b measured a reload; the PA2-G2 clarification states the same error) | X22's `failed` path if the text differs; manual row 22 |
| Any Referer byte other than those in PA3-6 and PA3-6b | No rule compares the sent Referer; `"` is rejected |

## 9. Docs (living only)

- **`README.md`, "The extension":** the new permissions and why; the button and the menu item; links open the normal add dialog; a sent link keeps its page address without the query, and the browser's User-Agent, in `jobs.json`; one link at a time; after a disable and enable, or an update of the extension, pages that were already open must be reloaded to get a working button back (the menu item works without a reload).
- **`docs/manual-checklist-phase2.md`, new section "A3: hand-off"** (rows are run by the owner in Chrome and Edge; none gates CI):
  1. Button on a YouTube page: the dialog opens, the toast says so.
  2. Menu on a direct file link: several connections.
  3. Menu on a hotlink-protected file: it downloads; `jobs.json` holds the Referer with no query.
  4. A video in an iframe: the button shows in the frame, the toast in the page.
  5. A link sent while the add dialog from a pasted link is open: "another window open".
  6. Fetchly hidden in the tray, then a hand-off: the window comes up with the dialog.
  7. A second link while the first dialog is open: "showing another link".
  8. Quit Fetchly while it reads a link: the app closes at once, and within a few seconds no `yt-dlp` process is left (Task Manager).
  9. Arabic browser: toast and menu in Arabic, right-to-left.
  10. Copy `jobs.json`, start the new build, check the list is unchanged; then start the previous build on the new file.
  11. A2 row 12 is now runnable.
  12. (PA3-2) Menu on a link in the top frame: the link is sent, and the job's Referer is the page.
  13. (PA3-2) Menu on a link inside an iframe: the Referer is the frame's address.
  14. (PA3-2) Menu on a `<video>` with an http(s) source, and on one with a `blob:` source: sent, and "cannot be sent".
  15. (PA3-2) Disable and enable the extension, and separately restart the browser: the menu item is there once, not twice.
  16. Open the popup while a toast says "reading the link": both keep working.
  17. Leave the tab idle 1 minute during a long read, then watch the toast finish.
  18. A page that adds its video after load, and one that enlarges a small video: the button appears.
  19. Scroll and resize: the button stays on the video; fullscreen hides it.
  20. (PA3-2b) Leave the browser untouched for over 30 s so the worker stops, then use the menu item on a link: the link is sent once, and the menu still shows one item.
  21. (PA3-7) Three pages: a site whose response header sets `style-src` without `'unsafe-inline'`; a page with `require-trusted-types-for 'script'`; a local page whose CSP comes through `<meta>`. On each the button and the toast show fully styled and the hand-off works.
  22. (G1) Open a video page, then disable and enable the extension without reloading the page. Click the old button: it disappears and nothing else happens. Use the menu on the same page: it works. Reload the page: the button works again.
- Never edited: anything under `docs/plans/**` or `docs/superpowers/**`.

## 10. Strings (EN/AR; all Arabic PROVISIONAL)

Revision 3 adds no string: a dead script removes its button silently (A3-Q26).

**Extension (`lib/strings.ts`, 18 new keys)**

| Key | English | Arabic |
|---|---|---|
| `sendWithFetchly` (button, menu) | Download with Fetchly | تنزيل بـ Fetchly |
| `sending` | Sending to Fetchly… | جارٍ الإرسال إلى Fetchly… |
| `working` | Fetchly is reading the link… | Fetchly يقرأ الرابط… |
| `opened` | Opened in Fetchly | فُتح في Fetchly |
| `appBusy` | Fetchly has another window open. Close it and try again. | في Fetchly نافذة أخرى مفتوحة. أغلقها وحاول مرة أخرى. |
| `appUnresponsive` | Fetchly did not answer. Open its window and try again. | Fetchly لم يستجب. افتح نافذته وحاول مرة أخرى. |
| `protectedLink` | This video is protected and cannot be downloaded | هذا الفيديو محمي ولا يمكن تنزيله |
| `loginRequired` | This link needs a sign-in | هذا الرابط يحتاج إلى تسجيل الدخول |
| `loginExpired` | The saved sign-in for this site has expired | انتهت صلاحية تسجيل الدخول المحفوظ لهذا الموقع |
| `noVideo` | No downloadable video found on this page | لم يُعثر على فيديو قابل للتنزيل في هذه الصفحة |
| `probeFailed` | Fetchly could not read this link | تعذّر على Fetchly قراءة هذا الرابط |
| `stillWorking` | Still working. See the Fetchly window. | ما زال العمل جاريًا. راجع نافذة Fetchly. |
| `notReady` | Fetchly's download tools are not ready yet | أدوات التنزيل في Fetchly غير جاهزة بعد |
| `badLink` | This link cannot be sent to Fetchly | لا يمكن إرسال هذا الرابط إلى Fetchly |
| `pairFirst` | Pair this browser with Fetchly first. Open the Fetchly icon. | اربط هذا المتصفح بـ Fetchly أولًا. افتح أيقونة Fetchly. |
| `requestLost` | Fetchly no longer has this request. Send it again. | لم يعد هذا الطلب موجودًا في Fetchly. أرسله مرة أخرى. |
| `tryAgain` | That took too long. Try again. | استغرق ذلك وقتًا طويلًا. حاول مرة أخرى. |
| `closeToast` | Close | إغلاق |

Reused unchanged: `busy`, `rateLimited`, `appNotRunning`, `wrongProgram`, `appError`, `mismatch`, `storageBlocked`.

**App (`S.reasons` in `src/renderer/src/strings.ts` and `strings.ar.ts`)**

| Stage | Text sent by main | Arabic |
|---|---|---|
| A3a | the sign-in sent with this link was not kept; send it again from the browser | لم يُحتفظ بتسجيل الدخول المرسل مع هذا الرابط؛ أرسله مرة أخرى من المتصفح |
| A3a | could not start the download | تعذّر بدء التنزيل |
| A3b | This link from the browser is no longer open. Send it again from the browser. | هذا الرابط المرسل من المتصفح لم يعد مفتوحًا. أرسله مرة أخرى من المتصفح. |

The `probe_failed` message is the app's English reason, shown as sent (A3-Q9). `STOPPED_EARLY`, which X18 now also gives after an `exit` with no `close`, is an existing text and keeps its existing translation.

## 11. Tolerances and owner questions (all PROVISIONAL, none 0)

| Rule | Default | Boundary |
|---|---|---|
| Ack deadline (Q22) | 10 000 ms from `ready` | 9 999 ms: `shown` wins. 10 000 ms: `app_unresponsive`. |
| Poll interval (Q18) | 2 s after the previous reply or failed send | n/a |
| Poll stop (Q18) | 120 s on either clock | 119 999 ms runs; 120 000 ms stops |
| Result retention (Q5): an older result is "stale" and answers `unknown_request` | 330 s after `done`, monotonic | 329 999 ms readable; 330 000 ms gone |
| "Future" data | No rule. A3 compares no wall-clock time from the wire. A backward step is ignored; a forward jump ends polling early. | n/a |
| Consecutive failed polls tolerated | 3; the 4th stops | shared counter (replies and `failed` sends), reset by `pending` |
| Hand-offs per tab | One per 3 s | 2 999 ms dropped; 3 000 ms sent |
| Polls per tab in the worker | One in flight; one per 1 000 ms | 999 ms refused; 1 000 ms sent |
| Proof freshness (Q12), request timeout (Q20) | A2's 5 s each, reused | A2's |
| Probe time limit / output cap | 30 s / 64 MiB (bytes) | 1 byte over the cap ends the probe |
| Probe settle after a kill or after `exit`, with no `close` | 5 s (`killGraceMs`), from whichever came first | 4 999 ms pending; 5 000 ms settles |
| Button re-enable without a toast | 5 s | n/a |
| Final toast shown | 8 s | n/a |
| Video scan debounce | 500 ms | n/a |
| Result entries kept | 64 | the 65th drops the oldest `done` |
| `URL_MAX`, `TITLE_MAX`, `UA_MAX`, `REFERER_MAX`, `MESSAGE_MAX` | 8192, 512, 512, 2048, 300 UTF-16 units | each value passes; one more fails |
| Smallest video that gets a button | 200×120 px | 199 or 119 fails |

**Decisions made here (PROVISIONAL)**

| # | Decision | Alternative |
|---|---|---|
| A3-Q1 | DV3: http(s) host patterns (PA3-1) | `<all_urls>` |
| A3-Q2 | DV4: both headers through `--add-headers` (PA3-6) | `--user-agent` |
| A3-Q3 | The button shows only on a frame with a video | On every page |
| A3-Q4 | Menu prefers `linkUrl` over `srcUrl` | The reverse |
| A3-Q5 | A bad stored header loads as `null`; a non-boolean `oneShotLogin` sets the file aside | It loads as `false` |
| A3-Q6 | Group items inherit `referer` and `userAgent` | UA only |
| A3-Q7 | Non-empty `candidates` or non-null `cookies` is `400` in A3 | Ignore them |
| A3-Q8 | Results are bound to the pairing that made them | Any paired browser may read |
| A3-Q9 | `probe_failed` shows the English reason | Move the reasons table to `src/shared` |
| A3-Q10 | No de-duplication of a link sent twice | Refuse a URL already in the list |
| A3-Q11 | Settings open: the hand-off dialog opens above it | Decline with `app_busy` |
| A3-Q12 | `store.ts` reads stay readwrite (PA3-4 passed) | Readonly reads, by an A2 amendment |
| A3-Q13 | The version check keeps its PID-only timeout | Tree kill there too |
| A3-Q14 | A too-early second click is dropped silently | A toast |
| A3-Q15 | `extrasFor` throwing fails the job (X17) | Run without extras |
| A3-Q16 | `oneShotLogin: true` on a group job loads as stored and fails at start | Load it as `false` |
| A3-Q17 | Filtered tool text may reach the page-side toast (X19). It holds no URL and no query, but it can hold a host name or a video id. | Fixed `RULES` texts only |
| A3-Q18 | The pre-A3 build and an A5 file: A5 documents it | A5 raises `version` to 2 |
| A3-Q19 | A `track` or toast may land on a page the tab navigated to after the click. It carries no URL and no query; a `probe_failed` message there can hold a host name or a video id of the earlier page's link. | Target the document with `documentId`, after its own probe |
| A3-Q20 | Three stages, four diffs, one PR | One plan and one diff; or three PRs |
| A3-Q21 | Worker throttles live in module memory and reset with the worker | Add the `storage` permission |
| A3-Q22 | DV5: a window destroyed while `probing` does not end the slot | End it, as the frozen row reads |
| A3-Q23 | The menu is created at every worker start | `onInstalled` and `onStartup` only |
| A3-Q24 | A Referer with `"` is rejected (PA3-6b: the only character aria2 changes) | Store it and accept aria2's `%22` |
| A3-Q25 | DV7: A2's frozen single `closeBundle` check becomes two build passes, with the "every manifest file exists" check in pass 2 | One pass that also emits `content.js`, if a single Vite build can produce an IIFE beside the ES modules |
| A3-Q26 | A dead content script (page open across a reload, or a disable and enable) removes its button silently on the first click | Show a toast "Reload this page to use Fetchly" from the script's own bundled strings (one new EN/AR key) |
| A3-Q27 | DV9: A3 ships the cookies-gone guard as a replaceable sign-in step; `headersFor` is separate; the frozen `extrasFor(job)` is unchanged | A3 supplies headers only, and a stored `oneShotLogin: true` job would run without its sign-in until A5 (the hole B5 named) |
| A3-Q28 | Styling by a constructed sheet in the closed shadow root plus CSSOM on the hosts (PA3-7) | A `<style>` element in the shadow root (also measured as applied) |
| A3-Q29 | A probe settled by the timer after `exit` with no `close` discards its output and reports `STOPPED_EARLY` | Classify whatever output was gathered |

## 12. Edge cases and failure modes

| Case | Behaviour |
|---|---|
| Window hidden in the tray | `showWindow()` at `ready`; the mounted renderer takes and acks. |
| Window destroyed | `showWindow()` makes a new one; take on mount recovers. If it loads in over 10 s: `app_unresponsive`, and the late `handoffShown` returns `false` and closes the dialog. |
| Window destroyed while the link is being read | DV5: nothing ends; the window is made at `ready`. |
| Renderer crashed while the dialog shows | `windowGone`: the slot ends; the result stays `opened`. |
| Dialog closed before it acked | `close` returns `false`; the ack deadline ends the slot. |
| A new offer while another hand-off dialog is still on screen | `replace`: the old dialog closes, the new one opens. |
| The native confirm is open when an offer arrives | The renderer is blocked; over 10 s gives `app_unresponsive`, and nothing opens afterwards. |
| Tab navigated while polling | The content script is gone; polling stops. The hand-off goes on in the app. The result expires by Q5. |
| Tab navigated between the click and the accept | A3-Q19: the new page's frame 0 may show the toast and poll. |
| Page restored from the back/forward cache | `pagehide` already stopped the loop; nothing resumes. |
| Quit with the slot full | The server stops, the probe is aborted by a tree kill that is not awaited, the slot ends. The extension shows `appNotRunning` at the fourth failed poll. Nothing is saved. |
| Same URL sent twice | While the first is open: `429 busy`. After it ended: a new hand-off and, if added, a second job with a free name. |
| Click inside a sub-frame | The tab URL is sent; frame 0 shows the toast. |
| Frame 0 has no content script (page loaded before the extension was installed) | `tabs.sendMessage` rejects and is swallowed; the hand-off still runs; no toast. |
| Page open across a reload, or a disable and enable, of the extension | Its old script is dead. The old button stays visible until it is clicked; that click removes it and sends nothing (X22). A running poll loop stops the same way. The menu item works. A reload of the page restores the button. |
| A frame's script is live but frame 0's is dead (the frame loaded later) | The click is sent and the hand-off runs; the toast message to frame 0 is rejected and swallowed; no toast. |
| A strict-CSP page | The button and toast are styled (PA3-7, X21). If the sheet cannot be made, nothing is shown. |
| Extension page open in a tab | Its messages are refused: `tab.url` is not http(s). |
| Menu on a `blob:` or `data:` source | `badLink`; nothing sent. |
| Menu click that wakes a stopped worker | The top-level listener receives it while the item is rebuilt; the link is sent once (manual row 20). |
| Engines restart while the dialog is open, or while the link is read | `add` answers the engine text; the slot stays until Close. The probe goes on. |
| A probe that never ends | 30 s, the tree kill, at most 5 s for `close`: `probe_failed`. |
| `yt-dlp.exe` ends alone while its child still holds the output | `exit` arms the settle timer; 5 s later the probe settles with `STOPPED_EARLY` and the slot is free. No kill is sent after `exit`; the child is left to `killStrays`. |
| yt-dlp cannot be started | The `error` event settles the probe at once. |
| yt-dlp floods stdout | The cap ends it by a tree kill: `probe_failed` with `UNREADABLE`. |
| yt-dlp's error line holds the link | X19 replaces it with `UNREADABLE`. |
| A poll that never answers | No second poll; the stop timer ends the loop at 120 s. |
| A poll the worker refuses (no reply) | A failed poll; the fourth in a row stops with `tryAgain`. |
| Worker stopped between polls | The next poll wakes it (PA3-3). Throttles reset. |
| App restarted mid-poll | `404 unknown_request`: `requestLost`. |
| PC sleeps mid-poll | The wall clock ends the loop with `stillWorking`, or `stale_proof` is tolerated 3 times. |
| Unpair in Settings mid-poll | The hello answers `404 unknown_pairing`: `pairFirst`; the record is kept (E10). |
| Two tabs click within one probe | The second gets `busy`. |
| A job stored with `oneShotLogin: true` | It fails at start with the cookies-gone text; `attempts` unchanged; the next queued job starts. |
| `extrasFor` throws for every queued job | All fail in one `commit`; no recursion. |

## 13. Rollback

- **Base.** A2 is committed at `0711a2a` and A3 builds on it. No uncommitted A2 file exists, so nothing is saved aside before the lanes start.
- **Code.** Revert the A3 commits in reverse order: A3c, A3b, A3a, M1. Each stage can be reverted alone while the later ones are reverted first. Reverting only A3c leaves a server that accepts hand-offs no browser sends. Reverting A3b as well leaves the app unchanged for the user.
- **A2's files.** A3c edits `manifest.json`, `vite.config.mjs`, `service-worker.ts`, `lib/strings.ts`, their specs, `README.md` and the checklist; the revert restores A2's committed versions. If A2 changes before it merges, A3 is rebased by the owner's decision; never force-pushed.
- **Extension.** Reload the unpacked extension after a revert, then reload open pages: their old content scripts are dead (X22). The pairing record did not change shape; no IndexedDB change.
- **`jobs.json`.** No conversion: the version did not change and no key is required. The previous build loads the file and drops the three keys on its next save (section 3.2). Manual row 10 copies `jobs.json` before the first run of the new build.
- **Other files.** `settings.json` and `pairing.json` are not touched. The slot and results live in memory only.

## Freeze notes (critique r3, folded before freezing)

Critique round 3 found 0 BLOCKING gaps. Its three non-blocking items are settled here and bind every later lane:

- **N1. The probe's longest run is 55 s, not 35 s.**
  - 35 s bounds only the yt-dlp run. `probeUrl` may then run `probeFile`, which has its own 20 s timer, so the slot can stay `probing` for up to 55 s.
  - Wherever this plan says 35 s for the slot's longest `probing` time, read 55 s.
  - No rule changes: 55 s plus the 10 s ack is still under the 120 s poll stop.
- **N2. The M1 review check.**
  - A changed line counts as allowed when its only difference is the three new fields appended. This covers a `Job` literal written on one line.
  - Every other line in M1 is still added-only.
- **N3. The real-process settle spec in Task T4.**
  - The spec asserts that the probe settles with `STOPPED_EARLY` and not before `killGraceMs`. It has no upper bound.
  - A red run on a loaded machine is re-run alone before it counts as a failure.
