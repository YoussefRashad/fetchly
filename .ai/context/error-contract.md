# Error contract

Fetchly has three error surfaces. Each has one shape; do not invent a fourth.

## 1. Local server (extension-facing)

- Body: `{"error": <token>}` as JSON (`ErrorBody`, `src/shared/protocol.ts`). Tokens are a closed union
  (`ErrorToken`); add a token there before producing it.
- Tokens produced today, by check (`src/main/server/server.ts`, `routes.ts`):

| Token | Status | When |
|---|---|---|
| `bad_request` | 400 | Duplicated or missing headers, `Transfer-Encoding`, no usable length, a body that is not a JSON object (strict UTF-8, no BOM), or a body with the wrong key set |
| `bad_host` | 403 | `Host` is not `127.0.0.1:<real port>` |
| `preflight_refused` | 403 | Any `OPTIONS` |
| `not_found` | 404 | Unknown path |
| `method_not_allowed` | 405 | Not `POST` |
| `bad_origin` | 403 | Origin is not an extension origin, or not a paired one on token routes |
| `bad_content_type` | 415 | Not `application/json` (optionally `; charset=utf-8`) |
| `too_large` | 413 | Body over the route limit |
| `bad_token` | 401 | Missing or wrong bearer token, or the pairing was removed meanwhile |
| `rate_limited` | 429 | Over 300 requests per 60 s for the pairing |
| `bad_code` | 401 | Wrong pairing code |
| `pairing_closed` | 403 | No live code (none opened, expired, or closed after 5 wrong tries), or 4 pairings already |
| `unknown_pairing` | 404 | `/v1/hello` for an unknown pairing id |

- Declared but not produced on `main` yet: `busy`, `not_ready`, `unknown_request`, `storage_unavailable`,
  `bad_site` (planned Phase 2 routes).
- A handler that throws gets no answer: the socket is destroyed with zero bytes. Node's own parser errors give a
  bare 400, 408, 413 or 431 with no body.

## 2. IPC (renderer-facing)

- Every handler returns `Result<T>` = `{ ok: true, value, warning? }` or `{ ok: false } & ErrorInfo`
  (`src/shared/types.ts`). `ErrorInfo` is `{ error, code?, detail? }`: `error` is the English text, `code` an
  `ErrorCode`, `detail` the raw OS or tool message a detail code puts into its text. `guarded()` in
  `src/main/ipc.ts` turns anything thrown into `{ ok: false }` (`describe`: `invalidLink`, `linkProblem` with the
  probe reason, else `unexpected` with the message as detail). Text without a code is still possible: install
  and yt-dlp update errors (`installBinaries`, `updateYtDlp`) stay English by design, an engine error status may
  carry none, and an unknown pairing-store refusal is passed on as it is.
- Codes live in `src/shared/errors.ts`: `ERROR_CODES` gives each code a kind (`fixed`, `detail`, `port`,
  `reason`) and `ERROR_TEXT` the English text of every code that is not a `reason` (a `reason` code's `error` is
  the reason token), from which main builds those failures. Engine and server error statuses carry the same
  `code` (with `detail` or `port`).
- The window turns them into text in one place, `src/renderer/src/errors.ts` (`errorText`, `statusMessage`,
  `noticeText`), through `S.errors` in English and Arabic; `reason` codes go through `S.reasons`. A code the
  window does not know, or one missing its detail or port, shows the text as it came (English, inside one isolate
  in Arabic).
  `tests/renderer/consumers.test.ts` checks that no other window file reads `.error` or `.message`.
- A new user-visible error: add a code and its kind to `ERROR_CODES`, its English text to `ERROR_TEXT` (no
  `ERROR_TEXT` entry for a `reason` code), and its
  Arabic text to `S.errors` in `strings.ar.ts`. The bare save error of the download list keeps its
  `SAVE_FAILED_PREFIX` and is split by `saveErrorText`.

## 3. In the window

- Persistent banners (`src/renderer/src/banners.ts`): `engine`, `server`, `save`, `cutOff`, in a fixed order, with
  an optional action (`retryEngines`, `confirmStraysGone`). Rendered with `role="alert"`.
- One dismissible message banner (`role="status"`) for the start-up notice and action errors.
- Dialog errors: `<p className="error" role="alert">`.
- Every failed or skipped item carries a reason (`Job.reason`; playlist entries `private`, `removed`,
  `unavailable`), shown as "failed: ..." or "skipped: ...". No silent failures.
