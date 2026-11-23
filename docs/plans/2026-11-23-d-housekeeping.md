# Task D: housekeeping — frozen plan (four items, two commits)

Base: `main` 0beea0a, branch `claude/d-housekeeping-34d2c4`.

## Context

Four leftovers from earlier rounds; all four are real.

1. A server that fails between `'listening'` and the handover is reported as `listening`.
2. Errors reach the window as English text only; the UI round deferred this to "error codes".
3. A settings save that succeeds is shown as failed when the queue throws afterwards.
4. A Best download whose pre-probe output passes 64 MB fails the same way on every retry, although the download never needs that output.

## Choices made in this revision (owner not asked)

| # | Choice | Reason |
|---|---|---|
| C1 | Two local commits on one branch: **A** = items 1 and 4, **B** = items 2 and 3. | The three behaviour fixes stay readable; item 3 needs `ErrorInfo` from item 2. |
| C2 | `linkProblem` has no text leaf; codes carry a kind (`fixed`, `detail`, `port`, `reason`). | Removes the table contradiction and keeps `strings.test.ts` unchanged. |
| C3 | App-level notices are stored as values and translated at render. | A save that changes the language must show its warning in the new language. |
| C4 | `src/main/index.ts` is not touched. | Its literal at line 107 never reaches the window. |
| C5 | The `server answered <n>` pattern lives in `renderer/src/errors.ts` only. | It is a link-probe reason; `reasonText`'s promise for job reasons stays true. |
| C6 | New option `probeOutputCap` on `MediaEngineOptions`. | Five new specs would otherwise each move 64 MB. |
| C7 | A non-string `error` or `message` is shown as empty text. | Never the word "undefined"; one guard, one spec. |
| C8 | `EADDRINUSE` in the handover gap keeps the `portBusy` mapping. | One mapping for every listen error; the case is reachable from specs only. |

## Out of scope (all items)

- `extension/`, `package.json`, packager and build config.
- `docs/superpowers/plans/**` and `docs/plans/**` (frozen).
- The HTTP server's JSON error tokens (`ErrorToken` in `src/shared/protocol.ts`, `RedeemResult` in `pairing.ts:61`).
- `src/main/server/pairing.ts`, `src/preload/index.ts`, `src/main/index.ts`: not edited.
- `Job.reason` values (persisted in jobs.json).
- Install and update errors (`ipc.ts:409`, `418`): they stay English; typed install errors are a separate follow-up.
- No on-disk format changes, so rollback is reverting the commit.

## Supersedes (for the owner at freeze)

- **Frozen rule reversed:** `docs/superpowers/plans/2026-11-22-phase1-review-fixes.md:414` ("over the cap … no download"). New rule: D4.1. The frozen file is not edited.
- **Spec replaced:** `tests/engines/media.test.ts:567-575` ("refuses height information one byte over the output cap").
- **JSDoc promise changed:** `ipc.ts:287-294`, the half "if … the queue throws first, retrying that port is still a new port" is removed (item 3).
- **Specs replaced:** `tests/ipcPairing.test.ts:573-666` (comment and three "queue refused" cases).
- F2 (`docs/manual-checklist-phase1-results.md:112-116`) is about the link probe and is cited as an analogy only.
- `docs/manual-checklist-phase1.md:52` (check 40) and `e2e/real/checks.mjs:1461` are link-probe checks and stay correct.

---

# Commit A: items 1 and 4 (no error codes)

## Item 1: an error between `'listening'` and the handover

### Current behaviour

- The `'listening'` listener sets `handover = server` and settles the attempt (`server.ts:333-342`).
- `listenOn` takes the server as `current` only after `await attempt(...)` resumes (`server.ts:381-388`).
- An `'error'` in that gap finds `settled === true` and `server !== current`, so it is ignored (`server.ts:344-359`).
- `listenOn` then sets `status = listening` on a failed server, which breaks "Never `listening` without a bound socket" (`server.ts:31`).

### Decisions

- **D1.1: the gap error takes the listen-error path, not `BROKEN_TEXT`.**
  - `EADDRINUSE` gives `portBusy { port: requested }`, `EACCES` gives `accessText(requested)`, anything else gives `START_FAILED_TEXT`.
  - Reason: no caller ever saw this server listening, so "stopped working" would describe something that never worked.
  - `EADDRINUSE` in the gap would show "in use by another program" although Fetchly held the port. Node does not emit it after a successful bind; only a spec can reach it (C8).
- **D1.2: one mapping function** (`listenFailure(e, requested): ServerStatus`) used by the `!settled` branch and the gap branch.
- **D1.3: no extra `pairing.cancel()`.** `listenOn` already cancelled the code (`server.ts:376`) and none can open before `listening`.

### Rule

- The `'listening'` listener keeps the `Attempt` object it settles with.
- In the `'error'` listener, after the `!settled` branch and the `server === current` branch, a third branch handles `server === handover`:
  - `handover = null`;
  - `shut(server)` in the same tick;
  - on the kept attempt object: `status = listenFailure(e, requested)` and `server = null`.
- `listenOn`'s continuation then reads `current = null` and the failure status, and `ensure` resolves with it.
- `stop()` and the `stopped` check in the continuation are unchanged (`server.ts:383-386`, `416-422`).
- Update the `handover` comment (`server.ts:287-291`).
- `src/main/index.ts:169-173` already pushes the status after any `'error'` through `setImmediate`, which runs after the continuation.

### Edge cases

- A second `'error'` on the revoked server: neither `current` nor `handover`, so it is ignored.
- `stop()` in the gap, then `'error'`: `handover` is already null; status stays `STOPPED_TEXT`.
- **`'error'` in the gap, then `stop()` in the same gap:** `handover` and `current` are both null, so `closing` stays null and stop resolves without awaiting that server's `'close'`. The server was already shut by the error branch. This matches the existing error-then-stop path on `current`. Status ends `STOPPED_TEXT`.
- An error before `'listening'`: unchanged.
- An error once `ensure` resolved: still `BROKEN_TEXT` and the code is cancelled (`port.test.ts:352-364`).
- The first `ensure` inside `start()` behaves like a later move.

### Specs (new describe in `tests/server/port.test.ts`)

The error is emitted from a `'listening'` listener registered just before the real `listen` (pattern at `port.test.ts:546-558`). In commit A, error statuses are asserted with `toMatchObject({ state, message })`, so commit B can add `code` without rewriting them.

1. Move p1 to p2 with `EIO` in the gap: `ensure` resolves with state `error` and the exact `START_FAILED_TEXT`; `status()` is the same object content.
2. `status()` sampled inside the listener right after the emit is exactly state `error` with `STARTING_TEXT`.
3. `close()` and `closeAllConnections()` were called on that server before the emit returned (spies); `refusesConnections(p2, 3000)` is true.
4. `it.each`:
   - `EADDRINUSE` gives `{ state: 'portBusy', port: p2 }`;
   - `EACCES` gives the port text for p2;
   - `EIO`, `EPERM` and an error with no code give the start-failed text;
   - the message never contains `SECRET-DETAIL-ZZ` (put in the emitted error's message).
5. The same on the first server: `start()` resolves and status is the start-failed error.
6. `store.open().ok` is false and `codeOpen()` is false. Then wait for `refusesConnections(p2, 3000)`, and only then `ensure(p2)` listens on a third server.
7. A second `'error'` on the revoked server, before and after that successful `ensure`, changes nothing.
8. `stop()` in the gap, then `'error'` on that server: stop resolves; status is `STOPPED_TEXT`.
9. `'error'` in the gap, then `stop()` in the same listener: stop resolves; status is `STOPPED_TEXT`; `ensure` resolves with a state other than `listening`; p2 refuses connections.
10. Boundary: `'error'` after `ensure` resolved gives the exact `BROKEN_TEXT`.

## Item 4: the Best pre-probe and the output cap

### The defect

- Over the cap, the output is discarded and later chunks are dropped (`media.ts:220-229`), but the child is not ended.
- On exit 0 the job ends with `could not read the video information`, `retryable: true`, and no download (`media.ts:263-272`).
- The queue re-queues a retryable failure three times (`queue.ts:11`). Each run probes again, because `sourceHeight` is still null and `bytesDone` is 0 (`media.ts:142-143`).
- So the job runs four oversized probes and fails; Retry repeats it. `retryable: true` is not honest.
- The height only chooses mp4 or mkv (`ytdlp/args.ts:48-51`), and `sourceHeight: null` already has a defined path.

### Runtime probe (run by the orchestrator before freeze)

Node v24.14.1, Windows 11, one process per case, probe files outside the repository. A parent spawned a Node child writing 1 MB chunks to stdout, discarded them, and killed the child once more than 64 MB was read.

| Case | `'close'` after the cap | Exit | Notes (3 runs each) |
|---|---|---|---|
| `child.kill()` | 206-210 ms | code null, signal `SIGTERM` | 64.1 MB read; no `'data'` after `'close'` |
| `taskkill /PID <pid> /T /F`, child still writing (3000 MB writer) | 560-637 ms | code 1, signal null | parent drained 695-855 MB until `'close'`; no `'data'` after `'close'` |
| `taskkill`, fast child (200 MB writer) | — | code 0 | the child exited before taskkill landed; taskkill said "process not found"; the fallback `child.kill()` hit an exited child |

What the plan takes from it:

- Over-cap must win over exit code 0, exit code 1 and a signal.
- The stream is drained and discarded until `'close'`.
- Electron 45's runtime is covered only by CI and the real-app e2e, not by this probe. No spec runs production's `taskkill` path (specs inject `kill`), and this plan adds no e2e check that forces an over-cap probe. That gap is accepted.

### Decisions

- **D4.1: over the cap, download with `sourceHeight: null`** (mkv, `bv*+ba/b`). No `probed` event and no error. Reason: the height is a container hint, not a precondition.
- **D4.2: the probe child is ended once, as soon as the cap is passed** (`killChild`). The download starts only on its `'close'`, so one job never has two processes.
- **D4.3: over-cap wins over the time limit, the exit code and a signal.** A pending stop still wins over everything (`media.ts:258`).
- **D4.4: output under the cap but unreadable** (not JSON, not an object) stays a retryable error. Its cause is not known to be permanent.
- **D4.5: the probe timer stays armed after the cap.** If the first kill did not end the tree, the timer kills again.
- **D4.6: new option `probeOutputCap?: number`** on `MediaEngineOptions`. JSDoc: "Bytes of height-check output that are read (default 64 MiB); output beyond it is discarded and the job downloads with no known height. Only specs set it." `PROBE_OUTPUT_CAP` stays the default.

### Rule

In the stdout `'data'` handler, the first chunk that takes `size` over the cap:

- sets `overCap`, empties `chunks`, and calls `killChild(child)` once;
- later chunks are still received and dropped (the stream keeps flowing).

In `'close'` order:

1. A stop is pending: release, no event (unchanged).
2. Over the cap: `download(..., null)`, whatever `timedOut`, `code` or the signal say.
3. Timed out, non-zero exit, unreadable output, height found: unchanged.

Rewrite the `checkHeight` JSDoc (`media.ts:211`), the `PROBE_OUTPUT_CAP` comment (`media.ts:36`) and the `start` JSDoc (`media.ts:111-115`) to state rule 2.

### Edge cases

- Exactly the cap: read; `probed` 720; mp4 path (`media.test.ts:559-565` stays).
- The kill does nothing and the child exits by itself with 0 or 1: the download starts after that exit.
- The kill and the timer kill both do nothing: the job stays in the probe until the child ends or a stop arrives. This is today's rule for the time limit (`media.test.ts:523-534`).
- A stop after the cap and before `'close'`: no download and no event.
- The fallback download fails: its own reason is reported.
- A later run with `bytesDone === 0` probes again and falls back again; with `bytesDone > 0` there is no pre-probe (`media.ts:143`).

### Specs (`tests/engines/media.test.ts`)

New stand-in helper next to `scriptedProbe`: it writes a given output, optionally writes more, then exits with a given code, lingers for N ms, or hangs until killed. Specs 2-8 use `probeOutputCap: 1024`; `makeEngine` passes the option through.

1. **Real cap, cap + 1 byte** (replaces 567-575, 30 s budget): no `probed` event; exactly one download argument line with `--merge-output-format mkv` and `-f bv*+ba/b`; the job ends `done`; no `error` event.
2. Small cap, child hangs after cap + 1: `kills` has length 1 and holds the probe child; that child had ended (`exitCode` or `signalCode` set) before the download line was logged; the job ends `done`.
3. `killWorks = false`, child lingers about 500 ms after cap + 1: `lines()` is empty while the child lives (sampled at about 250 ms); the download runs after it exits.
4. Stop after the cap: `killWorks = false`, child hangs; wait for `kills.length === 1`; set `killWorks = true`; `stop` resolves; `events` is empty; no download line after 200 ms.
5. Cap, then the time limit: `killWorks = false`, `probeTimeoutMs: 300`, child hangs; wait for `kills.length === 2` (cap kill, then timer kill); end the child by hand; the download runs; no `timed out` event.
6. `it.each` with `killWorks = false`, over-cap wins over the exit:
   - the child exits 0 by itself;
   - the child exits 1 with `ERROR: Sign in` on stderr (no `login required` event);
   - with `killWorks = true`, the child ends by signal.
   Each ends `done` with one mkv download line.
7. Draining: `killWorks = false`; the child writes cap + 1, then 4 MB more, then exits 0. The job ends `done`. A parent that stopped reading would block the child and time the spec out.
8. Option boundary: output of exactly `probeOutputCap` bytes is read (`probed` 720).
9. Kept as is: `garbage` and `[1080]` still give the retryable `could not read the video information` (`media.test.ts:536-557`).

---

# Commit B: items 2 and 3

## Item 2: error codes the window can translate

### Wire shape (optional fields only)

`src/shared/types.ts`:

```ts
export interface ErrorInfo { error: string; code?: ErrorCode; detail?: string }
export type Result<T> = { ok: true; value: T; warning?: ErrorInfo } | ({ ok: false } & ErrorInfo);
// EngineStatus error: { state: 'error'; message: string; code?: ErrorCode; detail?: string }
// ServerStatus error: { state: 'error'; message: string; code?: ErrorCode; port?: number }
```

- `error` and `message` keep today's English text.
- The preload passes values through untouched and `FetchlyApi` signatures do not change.
- `warning` is used by item 3 only.

### The code table (`src/shared/errors.ts`, new)

- `ERROR_CODES`: a const object from code to kind. `ErrorCode = keyof typeof ERROR_CODES`.
- Kinds:
  - `fixed`: the text is a string.
  - `detail`: the text is `(detail: string) => string`.
  - `port`: the text is `(port: number) => string`.
  - `reason`: no text; `error` is a reason token.
- `ERROR_TEXT`: the English text for every code whose kind is not `reason`.
- `SAVE_FAILED_PREFIX = 'could not save the download list: '` (used by `queue.ts:640`).
- `EN.errors = { ...ERROR_TEXT, other, saveFailed, serverAnswered }`. The three extras are not codes and are not in `ERROR_CODES`.
- `linkProblem` is the only `reason` code. It is not a key of `EN.errors` or `AR.errors`.

### Decisions

- **D2.1: main builds every coded failure from `ERROR_TEXT`.** English users see the same words as today.
- **D2.2: raw text travels as `detail`.** The fixed part is translated; the detail stays as it came, inside `fsi()` in Arabic.
- **D2.3: probe failures use `linkProblem`.** The window translates `error` with the reasons table.
- **D2.4: `saveError` gets no code.** It is a bare string through `queue.onSaveState`, `queueLifecycle` and `index.ts`. The window splits it on `SAVE_FAILED_PREFIX`. This is one of two text matches (see D2.5).
- **D2.5: `pairing.ts` is not edited.** `ipc.ts` maps `opened.error` by comparing it with the imported `FOUR_PAIRED_TEXT` and `NOT_LISTENING_TEXT` (`pairing.ts:101-102`).
  - A spec pins `ERROR_TEXT.fourPaired` and `ERROR_TEXT.notListening` equal to those constants.
  - An `opened.error` matching neither is forwarded with no code.
- **D2.6: component-local error lines keep their language until the component remounts**, which a language change does (`key={lang}`, `App.tsx:81`). The App-level notice is translated at render (C3), so nothing visible stays in the old language.
- **D2.7: a non-string `error` or `message` is shown as empty text** (C7).

### Codes on `Result.error`

`⁨x⁩` marks `fsi(x)` in the Arabic column.

| Code | Kind | English (unchanged) | Arabic | Built at |
|---|---|---|---|---|
| `badRequest` | fixed | That request is not valid | هذا الطلب غير صالح | `ipc.ts:78` |
| `invalidLink` | fixed | Enter a link that starts with http:// or https:// | أدخل رابطًا يبدأ بـ ⁨http://⁩ أو ⁨https://⁩ | `ipc.ts:104`, `202` |
| `linkProblem` | reason | the reason token | through `S.reasons` | `ipc.ts:105` |
| `unexpected` | detail | Something went wrong: `detail` | حدث خطأ: ⁨detail⁩ | `ipc.ts:106` |
| `toolsNotInstalled` | fixed | Install the download tools first | ثبّت أدوات التنزيل أولًا | `ipc.ts:87` |
| `toolsStarting` | fixed | The download tools are still starting | ما زال تشغيل أدوات التنزيل جاريًا | `ipc.ts:90` |
| `chooseFolder` | fixed | Choose a download folder | اختر مجلدًا للتنزيل | `ipc.ts:214`, `302` |
| `subtitleLangs` | fixed | Subtitle languages must be codes like en or ar | لغات الترجمة يجب أن تكون رموزًا مثل ⁨en⁩ أو ⁨ar⁩ | `ipc.ts:215`, `304` |
| `selectOne` | fixed | Select at least one item | حدّد عنصرًا واحدًا على الأقل | `ipc.ts:229` |
| `cannotWriteFolder` | fixed | cannot write to folder | تعذّرت الكتابة في المجلد | `ipc.ts:236` |
| `portInvalid` | fixed | Port must be a whole number from 1024 to 65535 | المنفذ يجب أن يكون عددًا صحيحًا من ⁨1024⁩ إلى ⁨65535⁩ | `ipc.ts:79` |
| `portChangeDeclined` | fixed | Settings were not saved: the port was not changed | لم تُحفظ الإعدادات: لم يتغيّر المنفذ | `ipc.ts:80` |
| `settingsBusy` | fixed | Settings are being saved | جارٍ حفظ الإعدادات | `ipc.ts:81` |
| `notListening` | fixed | Pairing is possible only while Fetchly is listening for the browser | الربط ممكن فقط أثناء انتظار Fetchly للمتصفح | `ipc.ts:344`, `346` |
| `fourPaired` | fixed | Four browsers are already paired. Unpair one first. | يوجد 4 متصفحات مربوطة بالفعل. ألغِ ربط أحدها أولًا. | `ipc.ts:346` |
| `notPaired` | fixed | This browser is not paired | هذا المتصفح غير مربوط | `ipc.ts:82` |
| `unpairUnsaved` | fixed | Unpaired, but the change is not saved yet; Fetchly keeps trying | أُلغي الربط، لكن التغيير لم يُحفظ بعد؛ يواصل Fetchly المحاولة | `ipc.ts:83` |
| `notFinished` | fixed | This download is not finished | هذا التنزيل لم يكتمل | `ipc.ts:374` |
| `fileGone` | fixed | The file is no longer there | الملف لم يعد موجودًا | `ipc.ts:376` |
| `folderGone` | fixed | The folder is no longer there | المجلد لم يعد موجودًا | `ipc.ts:392` |
| `closing` | fixed | Fetchly is closing | جارٍ إغلاق Fetchly | `queue.ts:20` |
| `pauseNotConfirmed` | fixed | text at `queue.ts:18` | تعذّر التأكد من توقف التنزيل. ما زال مدرجًا كتنزيل جارٍ؛ حاول مرة أخرى. | `queue.ts:354` |
| `cancelNotConfirmed` | fixed | text at `queue.ts:19` | تعذّر التأكد من توقف التنزيل، فلم يُحذف شيء. ما زال في القائمة؛ حاول مرة أخرى. | `queue.ts:392` |
| `cutOff` | fixed | text at `queue.ts:21-22` | انقطع هذا التنزيل، ولم يتمكن Fetchly من التحقق من انتهاء عمليته القديمة. أنهِ yt-dlp و ffmpeg و aria2c من إدارة المهام، ثم اختر «أُنهيت العمليات» في الشريط، أو أعد تشغيل Fetchly. | `queue.ts:367` |
| `deleteFailed` | detail | Could not delete the file: `detail` | تعذّر حذف الملف: ⁨detail⁩ | `queue.ts:410` |
| `savedNotApplied` | detail | Settings were saved, but the running downloads did not take them: `detail`. Save again, or restart Fetchly. | حُفظت الإعدادات، لكن التنزيلات الجارية لم تأخذ بها: ⁨detail⁩. احفظ مرة أخرى، أو أعد تشغيل Fetchly. | `ipc.ts` `setSettings` (warning) |

### Codes on status objects

| Code | Kind | English (unchanged) | Arabic | Built at |
|---|---|---|---|---|
| `toolsStartFailed` | detail | The download tools could not be started: `detail` | تعذّر تشغيل أدوات التنزيل: ⁨detail⁩ | `engineHost.ts:109` |
| `fileServiceStopped` | fixed | The file download service stopped | توقفت خدمة تنزيل الملفات | `engineHost.ts:118`, `129` |
| `serverStartFailed` | fixed | text at `server.ts:58` | تعذّر بدء الاتصال بالمتصفح؛ احفظ الإعدادات للمحاولة من جديد | `server.ts:323`, `362`, `368`, `listenFailure` |
| `serverBroken` | fixed | text at `server.ts:59` | توقف الاتصال بالمتصفح عن العمل؛ احفظ الإعدادات لتشغيله من جديد | `server.ts:355` |
| `serverStarting` | fixed | The browser connection is starting | جارٍ بدء الاتصال بالمتصفح | `server.ts:280`, `380` |
| `serverStopped` | fixed | The browser connection is stopped | الاتصال بالمتصفح متوقف | `server.ts:329`, `408` |
| `portUnusable` | port | port `port` cannot be used on this PC; choose another in Settings | لا يمكن استخدام المنفذ ⁨port⁩ على هذا الكمبيوتر؛ اختر منفذًا آخر من الإعدادات | `listenFailure` |

The engine codes also travel on a `Result` where `engine.message` is forwarded (`ipc.ts:88`, `280`, `406`): `code` and `detail` are copied with it.

### Other new strings

| Key | English | Arabic |
|---|---|---|
| `errors.other(text)` | `text` | ⁨text⁩ |
| `errors.saveFailed(detail)` | could not save the download list: `detail` | تعذّر حفظ قائمة التنزيلات: ⁨detail⁩ |
| `errors.serverAnswered(n)` | server answered `n` | ردّ الخادم بالرمز ⁨n⁩ |
| `reasons['could not reach the server']` | same | تعذّر الوصول إلى الخادم |
| `reasons['this link is a web page, not a file']` | same | هذا الرابط صفحة ويب وليس ملفًا |
| `reasons['yt-dlp stopped before it could read the link. Try again.']` | same | توقف yt-dlp قبل أن يقرأ الرابط. حاول مرة أخرى. |

- The three new reasons come from `probe.ts:112`, `121` and `16`.
- The JSDoc at `strings.ts:66` becomes: "Every reason the main process gives a failed or skipped job, and every fixed reason of the link probe, by its English text."
- Key parity is enforced by `AR: Strings` (typecheck) and `tests/renderer/strings.test.ts:34`. `SAME_IN_BOTH` is not edited: every new leaf differs between the languages.

### Window rules

`src/renderer/src/format.ts`:

- New export `knownReason(reason): string | null`: the reasons-table entry, else the retry pattern, else null.
- `reasonText(reason)` becomes `knownReason(reason) ?? reason`. Its behaviour and JSDoc ("kept as it came") do not change.

`src/renderer/src/errors.ts` (new, pure, reads `S` inside each call). Below, `text` is `error` or `message` when it is a string, else `''`.

- `errorText(info: ErrorInfo)`:
  - `code` is not a string, or not an own key of `ERROR_CODES` (`Object.hasOwn`): `S.errors.other(text)`.
  - `fixed`: `S.errors[code]`; a stray `detail` is ignored.
  - `detail`: `S.errors[code](detail)` when `typeof detail === 'string'`; else `other(text)`.
  - `port`: `other(text)` (an `ErrorInfo` has no port).
  - `reason`: `knownReason(text)`, else `S.errors.serverAnswered(n)` when `text` matches `/^server answered (\d+)$/u`, else `other(text)`.
- `statusMessage(status)` for the error variants of `EngineStatus` and `ServerStatus`: the same rules, except that a `port` code gives `S.errors[code](port)` when `Number.isInteger(port)`, else `other(text)`.
- `saveErrorText(text)`: a text starting with `SAVE_FAILED_PREFIX` gives `S.errors.saveFailed(rest)`; otherwise `other(text)`.
- `type Notice = string | ErrorInfo` and `noticeText(n)`: a string is returned as is (the startup notice is already worded by main); an `ErrorInfo` goes through `errorText`.
- `settingsOutcome(res: Result<Settings>)` returns `{ saved: Settings | null; notice: ErrorInfo | null; error: ErrorInfo | null }`:
  - ok: `saved = value`, `notice = warning ?? null`, `error = null`;
  - failure: `saved = null`, `notice = null`, `error = { error, code, detail }`.

"The code is unknown, so the English text is shown" covers:

- Absent: no `code`.
- Inconsistent:
  - a `code` that is not a string;
  - `'constructor'`, `'__proto__'`, `'toString'` (precedent at `tests/renderer/status.test.ts:87`);
  - `'other'`, `'saveFailed'`, `'serverAnswered'`;
  - a `detail` code with `detail` missing or not a string, in `errorText` and in `statusMessage`;
  - a `port` code in `errorText`, also with a string `detail`;
  - `portUnusable` in `statusMessage` with `port` missing, a string or a fraction;
  - `linkProblem` on a status object.
- Boundary:
  - `detail: ''` is valid and translated;
  - a `fixed` code with a stray `detail` ignores it;
  - a save error that is exactly the prefix gives an empty detail;
  - `error` or `message` not a string gives empty text, never "undefined".

### Consumers to change

Window, `Result` failures (each becomes `errorText(res)` or passes the failure up):

- `UrlBar.tsx:23`, `AddDialog.tsx:56`, `InstallScreen.tsx:22`, `SettingsDialog.tsx:66`, `84`, `185`: local string state set from `errorText(res)`.
- `JobRow.tsx:45`, `50`, `GroupRow.tsx:28`: `onError(res)`. The prop type in `JobRow`, `GroupRow` and `JobList` becomes `onError(info: ErrorInfo)`.
- `App.tsx`: the `message` state becomes `Notice | null`; it is rendered with `noticeText(message)`; line 58 stores the failure; line 46 stores the startup string.
- `SettingsDialog.tsx:172-178`: uses `settingsOutcome` (item 3).

Window, status text:

- `banners.ts:21` and `23`: `statusMessage(...)`; `banners.ts:24`: `saveErrorText(...)`.
- `SettingsDialog.tsx:96`: `statusMessage(server)`.

Main:

- `ipc.ts`: `fail` takes a code (and a detail); `describe` returns an `ErrorInfo`; `statusText` returns an `ErrorInfo` carrying the engine's code and detail; `noQueue`; every `fail(...)` call; `pairingStart` (D2.5).
- `queue.ts:25` and its five failures; `queue.ts:640` uses `SAVE_FAILED_PREFIX`.
- `engineHost.ts:109`, `118`, `129`. `same()` still compares state and message; the code follows from the message.
- `server.ts`: every error-status literal and `listenFailure`.

### Code-to-spec table

Every code is asserted where it is produced. The tests lane reports the case name per row.

| Code | Spec file | Case |
|---|---|---|
| `badRequest` | `tests/ipc.test.ts` | `add` with a non-object request |
| `invalidLink` | `tests/ipc.test.ts` | `probe('ftp://x')` and a non-string |
| `linkProblem` | `tests/ipc.test.ts` | the probe throws `ProbeError('timed out reading the link')` |
| `unexpected` | `tests/ipc.test.ts` | a dep throws `boom`; `detail: 'boom'` (`:182`, `:969`, `:1149-1150`) |
| `toolsNotInstalled` | `tests/ipc.test.ts` | `add` with engine `notInstalled` |
| `toolsStarting` | `tests/ipc.test.ts` | `add` with engine `starting` and no queue |
| `chooseFolder`, `subtitleLangs`, `selectOne`, `cannotWriteFolder` | `tests/ipc.test.ts` | the existing `add` refusals |
| `portInvalid` | `tests/ipcPairing.test.ts` | `setSettings` with port 80 and `"38917"` |
| `portChangeDeclined` | `tests/ipcPairing.test.ts` | the dialog is declined |
| `settingsBusy` | `tests/ipcPairing.test.ts` | a second call during the dialog |
| `notListening` | `tests/ipcPairing.test.ts` | `pairingStart` while `portBusy` |
| `fourPaired` | `tests/ipcPairing.test.ts` | `pairingStart` with four pairings |
| (no code) | `tests/ipcPairing.test.ts` | a store whose `open()` fails with another text: `not.toHaveProperty('code')` |
| `notPaired`, `unpairUnsaved` | `tests/ipcPairing.test.ts` | the existing `unpair` cases |
| `notFinished`, `fileGone`, `folderGone` | `tests/ipc.test.ts` | the existing `openFile` and `openFolder` cases |
| `closing` | `tests/jobs/queue.test.ts` | a verb after close |
| `pauseNotConfirmed`, `cancelNotConfirmed` | `tests/jobs/queue.test.ts` | the engine's stop rejects |
| `cutOff` | `tests/jobs/queue.test.ts` | resume of an interrupted job |
| `deleteFailed` | `tests/jobs/queue.test.ts` | `removeWithFile` with a failing delete; `detail` is the OS message |
| `savedNotApplied` | `tests/ipcPairing.test.ts` | item 3, spec 1 |
| `toolsStartFailed` | `tests/engineHost.test.ts:311`, `tests/queueLifecycle.test.ts:219-328`, `tests/ipc.test.ts:1281` | status and forwarded `Result`, with `detail` |
| `fileServiceStopped` | `tests/engineHost.test.ts:764`, `tests/ipc.test.ts` (`retryEngines`) | status and forwarded `Result` |
| `serverStartFailed` | `tests/server/port.test.ts` | item 1 spec 1; the listen deadline case |
| `serverBroken` | `tests/server/port.test.ts` | item 1 spec 10 |
| `serverStarting` | `tests/server/port.test.ts` | item 1 spec 2 |
| `serverStopped` | `tests/server/port.test.ts` | item 1 specs 8 and 9 |
| `portUnusable` | `tests/server/port.test.ts:84`, `:89` | with `port` |

### Specs

- New `tests/errorCodes.test.ts`:
  - the keys of `EN.errors` are exactly the codes whose kind is not `reason`, plus `other`, `saveFailed`, `serverAnswered`;
  - for each such code, `EN.errors[code]` is `ERROR_TEXT[code]` (`toBe`);
  - `ERROR_TEXT.fourPaired` and `ERROR_TEXT.notListening` equal the `pairing.ts` constants;
  - the save text of `queue.ts` starts with `SAVE_FAILED_PREFIX` (through a failing store);
  - `ERROR_TEXT.cutOff` contains `EN.theyAreGone`, and `AR.errors.cutOff` contains `AR.theyAreGone`.
- New `tests/renderer/errors.test.ts`:
  - every code in both languages, by kind;
  - every case of the absent / inconsistent / boundary list above;
  - `linkProblem`: a known reason, `retrying (2/3)`, `server answered 503`, an unknown text (inside one `fsi()` in Arabic);
  - `saveErrorText`, `noticeText`, `settingsOutcome` (ok, ok with warning, failure);
  - a notice kept as a value, then `setLanguage('ar')`: `noticeText` gives the Arabic text;
  - in Arabic, every `detail` and port sits inside exactly one `fsi()`;
  - in English, `errorText` equals `error` for every coded failure.
- New `tests/renderer/consumers.test.ts` (source scan; precedents at `tests/ipcPairing.test.ts:997`, `tests/queueLifecycle.test.ts:204`): no file under `src/renderer/src/**/*.tsx`, nor `banners.ts`, matches `/\.\s*(error|message)\b/u`.
- `tests/renderer/status.test.ts`: the three new reasons through `reasonText`; `knownReason` returns null for an unknown text and for `server answered 503`.
- `tests/renderer/banners.test.ts`, `bannersServer.test.ts`: translated engine, server and save banners in Arabic; fallback without a code. Kept unchanged because they pass in English: `bannersServer.test.ts:35-42`, `:70`, `banners.test.ts:32`, and a save error with no prefix.
- `tests/renderer/strings.test.ts`: unchanged, must pass.

### Superseded spec shapes

- The tests lane enumerates every `toEqual` or `toStrictEqual` against a failed `Result` or an error status in `tests/ipc.test.ts`, `tests/ipcPairing.test.ts`, `tests/jobs/queue.test.ts`, `tests/engineHost.test.ts`, `tests/queueLifecycle.test.ts` and `tests/server/port.test.ts`. It adds `code` (and `detail` or `port`) to each and reports the full list with line numbers.
- `tests/queueLifecycle.test.ts:16` and `tests/engineHost.test.ts:12-13`: the `failed` and `stopped` helpers gain `code` and `detail`, because they are compared with `toEqual` (`queueLifecycle.test.ts:219`, `258`, `306`, `328`).
- `tests/server/rig.ts:99` and `tests/server/pairing.test.ts:220` build input statuses without a code; they stay valid and unchanged.
- `tests/ipcPairing.test.ts:717`, `:811` are fixture inputs; unchanged.

## Item 3: the save succeeded but the queue threw

### Current behaviour

- `deps.saveSettings(next)` writes settings.json and assigns the in-memory settings (`index.ts:189-191`).
- `deps.queue()?.setSettings(next)` then throws (`ipc.ts:330`); `guarded` returns a failure; `ensure` never runs and `listenerPort` keeps the old port.
- The dialog shows a failure and does not call `onSaved` (`SettingsDialog.tsx:175`), so the window keeps the old language and theme while main already applied the new ones.
- For a port change the pairings are already emptied (`ipc.ts:326-327`).

### Decisions

- **D3.1: the listener still moves.** The queue throw is caught and `ensure(next.serverPort)` runs. Reason: the saved port is what the next start uses and the pairings are already cleared.
- **D3.2: `listenerPort` becomes `next.serverPort`** once `ensure` resolved.
- **D3.3: the answer is a success with a warning**: `{ ok: true, value: next, warning: { error, code: 'savedNotApplied', detail } }`. `detail` is the thrown message, or `String(e)` for a non-`Error`.
- **D3.4: the dialog closes and the warning shows in App's dismissible banner.**
  - `SettingsDialog` gets a required prop `onNotice(info: ErrorInfo)`; `App` passes `setMessage`. Typecheck forces the wiring.
  - `save()` uses `settingsOutcome`: on `error` it sets the local error line; otherwise it calls `onSaved(saved)`, then `onNotice(notice)` when there is one, then `onClose()`.
  - App stores the `ErrorInfo` and renders `noticeText` after `setLanguage` ran, so a save that changes the language shows the warning in the new language.
- **D3.5: the text says "Save again, or restart Fetchly".** Both are true.
- **D3.6: a rejecting `ensure` is unchanged** (a contract breach; pinned at `tests/ipcPairing.test.ts:668`). The answer is `unexpected` with ensure's message as `detail`; the queue's warning is dropped; `listenerPort` is left alone.

### New JSDoc for `setSettings` (replaces `ipc.ts:287-294`); every sentence gets a spec

> Saves the settings. A serverPort other than the port of the last `ensure` that resolved (the listener is on no other port) removes every pairing (after a confirmation when there are any, S15): the code is cancelled and the pairings emptied before the save, and the listener moves after it. A port counts as moved only once `ensure` resolved for it, whatever the status; if the save throws, nothing after it runs and retrying that port is still a new port. A queue that throws after the save does not stop the move: the listener still moves, and the answer is ok with the warning `savedNotApplied`. The same port still calls ensure, so saving retries a busy or failed listener. One call at a time.

### Edge cases

- No queue yet: no warning.
- The queue throws on a same-port save: no confirm, no cancel, no clear; `ensure` is called; ok with the warning.
- The save throws: unchanged.
- `settingsBusy` is released in every case.

### Specs (`tests/ipcPairing.test.ts`, replacing 573-666)

1. Queue refuses on a move to 40000 with one pairing:
   - `ok: true`, `value.serverPort === 40000`, `warning` equals `{ error: <English text>, code: 'savedNotApplied', detail: 'the queue refused the settings' }`;
   - log is `['confirm', 'cancel', 'clear', 'saveSettings', 'ensure:40000']`;
   - the listener is on 40000; pairings are empty.
2. Then 40000 is saved again with the queue working: no confirm, no clear; log is `['saveSettings', 'ensure:40000']`; `expect(res).not.toHaveProperty('warning')`; a pairing made in between (its string starts `40000-`) survives.
3. Then 38917 is saved: a new port (confirm when paired, cancel, clear).
4. Queue refuses on the same port: ok with the warning; log is `['saveSettings', 'ensure:38917']`.
5. Queue refuses twice in a row: each answer carries the warning; `ensure` is called each time.
6. Queue refuses and `ensure` rejects: `ok: false`, code `unexpected`, `detail` is ensure's message (`ensure broke its contract`), not the queue's; no `warning`; the next save of that port is still a new port.
7. A second call during the dialog fails with `settingsBusy`; the call after a queue refusal is accepted.
8. No queue (`deps.queue()` returns null): ok and `not.toHaveProperty('warning')`.
9. The queue throws a string (`throw 'plain'`): `warning.detail === 'plain'`.

The window half is covered by `settingsOutcome`, `noticeText` and the language-switch case in `tests/renderer/errors.test.ts`, by the source scan, and by typecheck (the required `onNotice` prop). The four JSX lines that call them have no component spec; the repository has none.

---

## Files touched

Commit A:

- `src/main/server/server.ts` (handover branch, `listenFailure`, comment)
- `src/main/engines/media.ts`
- `tests/server/port.test.ts`, `tests/engines/media.test.ts`
- `docs/plans/<date>-d-housekeeping.md` (this plan, frozen by the orchestrator)

Commit B, source:

- `src/shared/errors.ts` (new), `src/shared/types.ts`
- `src/main/server/server.ts` (status codes), `src/main/ipc.ts`, `src/main/jobs/queue.ts`, `src/main/engineHost.ts`
- `src/renderer/src/errors.ts` (new), `strings.ts`, `strings.ar.ts`, `format.ts`, `banners.ts`, `App.tsx`
- `src/renderer/src/components/`: `UrlBar.tsx`, `AddDialog.tsx`, `JobRow.tsx`, `GroupRow.tsx`, `JobList.tsx`, `InstallScreen.tsx`, `SettingsDialog.tsx`

Commit B, specs:

- New: `tests/errorCodes.test.ts`, `tests/renderer/errors.test.ts`, `tests/renderer/consumers.test.ts`
- Changed: `tests/ipc.test.ts`, `tests/ipcPairing.test.ts`, `tests/jobs/queue.test.ts`, `tests/engineHost.test.ts`, `tests/queueLifecycle.test.ts`, `tests/server/port.test.ts` (adds `code`), `tests/renderer/status.test.ts`, `tests/renderer/banners.test.ts`, `tests/renderer/bannersServer.test.ts`

Commit B, living docs:

- `docs/manual-checklist-phase2.md`, new section "D: housekeeping":
  - the Arabic UI shows an Arabic error for `ftp://x` and for port 80;
  - an install error shows in English, left to right;
  - the EACCES banner is Arabic: run `netsh interface ipv4 show excludedportrange protocol=tcp`, save a port of 1024 or more from a listed range, and expect "لا يمكن استخدام المنفذ …"; with no such range the check is marked spec-only;
  - the "saved, but not applied" notice and the over-cap fallback cannot be forced by hand and are spec-only.
- `README.md`: no change.

## Order of work

Commit A:

1. Tests lane: item 1 specs, then item 4 specs (the new stand-in helper and the `probeOutputCap` pass-through in `makeEngine`).
2. Implement lane: `server.ts`, then `media.ts`.
3. Orchestrator: gates, then commit.

Commit B:

1. Tests lane: `errorCodes`, `renderer/errors`, `consumers`, banner and status specs; then the shape updates and the code-to-spec rows; then item 3 specs.
2. Implement lane: `shared/errors.ts` and `types.ts`; `server.ts` codes; `engineHost.ts`, `queue.ts`, `ipc.ts` codes; `ipc.ts` `setSettings` and JSDoc; strings, `format.ts`, `renderer/src/errors.ts`, `banners.ts`, components, `App.tsx`; the checklist.
3. Orchestrator: gates, then commit.

Rules for both: the implement lane does not edit specs and stops on any deviation. Workers run only the specs they touch. `tests/engines/media.test.ts` and `tests/server/port.test.ts` are timing-sensitive and run alone.

## Acceptance

- After commit A and again after commit B: `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` all pass.
- Every spec listed under items 1-4 exists and passes; every row of the code-to-spec table has a named case.
- `tests/renderer/strings.test.ts` passes unchanged.
- No diff under `extension/`, `package.json`, build config, `docs/superpowers/plans/`, existing files of `docs/plans/`, `src/main/server/pairing.ts`, `src/shared/protocol.ts`, `src/preload/`, `src/main/index.ts`.

## Runtime assumptions

- Item 1: synchronous `EventEmitter` listener order and microtask-before-`setImmediate` order, both documented and already relied on by `port.test.ts:546-558`. No probe.
- Item 4: the probe above. Node v24.14.1 on Windows 11 was probed; Electron 45's runtime is covered only by CI and the real-app e2e.

## Open questions

None. No rule here rejects "future" or "stale" data.

---

## Critique disposition

1. **FIXED (BLOCKING)** — "The code table": `ERROR_CODES` with kinds, `ErrorCode` derived, `EN.errors = { ...ERROR_TEXT, three extras }`, `linkProblem` has no leaf; the two extra triad cases are in "Window rules" and `renderer/errors.test.ts`.
2. **FIXED** — C1: two commits, A (items 1 and 4, message-only assertions) then B (items 2 and 3); "Order of work".
3. **FIXED** — C4: `src/main/index.ts` is out of scope and in the no-diff list.
4. **FIXED** — D2.4 and D2.5 name both text matches; equality spec in `errorCodes.test.ts`; the no-code row in the code-to-spec table.
5. **FIXED** — `strings.ts:66` JSDoc reworded; `knownReason` returns null; the `server answered` regex lives in `errors.ts` only (C5), so `format.ts:39` stays true.
6. **FIXED** — "Code-to-spec table", including `serverStarting`, `serverStopped`, `toolsStarting`, `closing`, `cutOff`.
7. **FIXED** — "Superseded spec shapes": the tests lane enumerates and reports; `queueLifecycle.test.ts` added (its helper is compared with `toEqual`); `rig.ts:99` and the kept banner cases are listed.
8. **FIXED** — D2.7 / C7: a non-string text gives empty text; boundary case and spec.
9. **FIXED** — `toolsStarting` reworded as suggested; `cutOff` / `theyAreGone` spec in `errorCodes.test.ts`.
10. **FIXED (BLOCKING)** — D3.4 and C3: `onNotice(ErrorInfo)`, App renders `noticeText` at render, pure `settingsOutcome` with specs, a language-switch spec, and a required prop.
11. **FIXED** — item 3 specs 2 (`not.toHaveProperty`), 6 (ensure's message), 8 (no queue), 9 (non-`Error` throw).
12. **FIXED** — `tests/renderer/consumers.test.ts` source scan.
13. **FIXED** — item 1 spec 2 asserts the exact starting status.
14. **FIXED** — item 1 spec 6 waits for `refusesConnections(p2, 3000)` before `ensure(p2)`.
15. **FIXED** — item 1 edge case and spec 9 (error, then stop, in the same gap).
16. **FIXED** — D1.1 and C8 state the `EADDRINUSE` wording and that only specs reach it.
17. **FIXED** — item 4 spec 3 uses a lingering stand-in and samples `lines()` while it lives.
18. **FIXED** — item 4 spec 5 waits for `kills.length === 2`; spec 2 asserts length 1.
19. **FIXED** — D4.6 / C6: the `probeOutputCap` option, its JSDoc, spec 8, and the real-cap pair kept (spec 1 and `media.test.ts:559-565`).
20. **FIXED** — "Supersedes" section; F2 cited as an analogy only; check 40 and `checks.mjs:1461` stated as staying.
21. **FIXED** — "Runtime probe" under item 4 cites the orchestrator's results and their three consequences (item 4 specs 6 and 7, D4.3); the Electron coverage statement is in "Runtime assumptions".
22. **FIXED** — the busy-port check is replaced by the EACCES check with the `netsh` instruction, marked spec-only when no excluded range exists.
---

## Critique pass 2: accepted NON-BLOCKING amendments (binding)

Pass 2 found no BLOCKING gap, so the plan froze here. The orchestrator accepted all eight NON-BLOCKING notes as written below. Where they differ from the text above, these win.

1. `settingsOutcome` returns `{ saved, notice, failure }` (not `error`), so `SettingsDialog.tsx` needs no `.error` read and does not shadow its own `error` state.
2. `tests/renderer/consumers.test.ts` strips `//` and `/* */` comments from each source, then checks it against `/\.(error|message)\b/u` (no `\s*`). A future legitimate `e.message` read belongs in `src/renderer/src/errors.ts`.
3. `statusMessage`: a `reason` code (e.g. `linkProblem` on a status object) gives `S.errors.other(text)`.
4. Code-to-spec table, extra row: `notListening` through D2.5 (`ipc.ts:346`) in `tests/ipcPairing.test.ts`, with a stubbed store `open()` that returns `NOT_LISTENING_TEXT` while the server status is `listening`; the answer carries `code: 'notListening'`.
5. `probeOutputCap` JSDoc adds: "a finite number of 0 or more; not validated (only specs set it)". No spec for invalid values.
6. Item 4 spec 3: wait for `kills.length === 1`, then about 250 ms, then assert `lines()` is empty while the child still lives.
7. Item 4 spec 6: `killWorks` is a column of the `it.each` table (cases: exit 0 with kill off; exit 1 with `ERROR: Sign in` and kill off; ended by signal with kill on).
8. `S.errors.serverAnswered(n: string)` takes the matched digits as a string, so English output equals `error` exactly (e.g. `007`).

## Plan history

- Draft: Fable 5.2 (plan lane), 2026-11-23 18:00-18:08.
- Critique pass 1: 2 BLOCKING, 20 NON-BLOCKING (18:08-18:14).
- Runtime probe for item 4: Node v24.14.1, Windows 11 (results in item 4).
- Revision 1: all 22 fixed (18:15-18:20).
- Critique pass 2: no BLOCKING, 8 NON-BLOCKING accepted above (18:20-18:22). Frozen 2026-11-23.
