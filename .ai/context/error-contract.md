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

- Every handler returns `Result<T>` = `{ ok: true, value }` or `{ ok: false, error: string }`
  (`src/shared/types.ts`). `guarded()` in `src/main/ipc.ts` turns anything thrown into `{ ok: false }`.
- `error` texts are English constants in `ipc.ts` (`BAD_REQUEST`, `statusText`, `describe`). The renderer shows
  them as they are, except job reasons, which `reasonText` translates through `S.reasons` (keyed by the English
  text). A new user-visible error that is not a job reason is therefore not translated: see `TODO.md`.

## 3. In the window

- Persistent banners (`src/renderer/src/banners.ts`): `engine`, `server`, `save`, `cutOff`, in a fixed order, with
  an optional action (`retryEngines`, `confirmStraysGone`). Rendered with `role="alert"`.
- One dismissible message banner (`role="status"`) for the start-up notice and action errors.
- Dialog errors: `<p className="error" role="alert">`.
- Every failed or skipped item carries a reason (`Job.reason`; playlist entries `private`, `removed`,
  `unavailable`), shown as "failed: ..." or "skipped: ...". No silent failures.
