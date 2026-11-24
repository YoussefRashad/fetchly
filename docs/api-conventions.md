# Local server protocol and IPC conventions

Fetchly has no hosted API. It has two internal interfaces: the loopback HTTP server the browser extension calls,
and the IPC bridge the window calls. Errors for both: `.ai/context/error-contract.md`.

## Loopback server (protocol 1)

Source of truth: `src/shared/protocol.ts` (constants, formats, error tokens) and `src/main/server/`. Design and
planned routes: the frozen `docs/superpowers/plans/2026-11-22-phase2-architecture.md`, section 3.

- Address: `127.0.0.1:<port>`, default 38917, configurable 1024 to 65535 in Settings.
- Versioning: the path prefix `/v1/` and `PROTOCOL = 1`, returned by `/v1/pair` and `/v1/status`.
- Every request: `POST`, `Content-Type: application/json` (optionally `; charset=utf-8`), a `Content-Length`,
  exactly one `Host` equal to `127.0.0.1:<port>`, and an `Origin` of the form `chrome-extension://<32 letters a-p>`.
  No `Transfer-Encoding`, no duplicated `Host`, `Origin`, `Authorization` or `Content-Type`.
- Auth: `Authorization: Bearer <token>` on token routes; the token is 43 base64url characters.
- Bodies: a JSON object with exactly the documented keys, strict UTF-8, no BOM. Limit 64 KiB
  (`BODY_LIMIT`); `LARGE_BODY_LIMIT` (512 KiB) is reserved for the planned hand-off and logins routes.
- Responses: JSON, `Cache-Control: no-store`, `Connection: close`. No CORS headers; `OPTIONS` is refused.
- Rate limit: 300 requests per 60 s per pairing, on token routes.

| Route | Auth | Body | Answer |
|---|---|---|---|
| `/v1/pair` | none | `{ code, label }` | `{ pairingId, token, protocol, appVersion }` |
| `/v1/hello` | none | `{ pairingId, nonce }` | `{ proof }` |
| `/v1/status` | token | `{}` | `{ app: 'fetchly', protocol, appVersion, engine }` |
| `/v1/unpair` | token | `{}` | `{}` |

Pairing flow: the user opens a code in **Settings → Browser** (`<port>-<code>`, 5 minutes) and types it into
the extension, which calls `/v1/pair` once and keeps the token. The server proof answered by `/v1/hello` is
`HMAC-SHA256(proofKey, "fetchly-hello-v1\n<pairingId>\n<port>\n<nonce>")` (`helloInput`), where `proofKey` is
`HMAC-SHA256(token, "fetchly-server-proof-v1")` (`PROOF_KEY_LABEL`) and the nonce is 43 base64url characters
chosen by the client. By design (decision D6 in the architecture plan) the extension checks a fresh proof before
it sends the token.

Adding a route: register it in `routes.ts` (paths are unique; `register` throws on a duplicate), add its body
check with exact keys, add any new error token to `ErrorToken`, update this file and `tests/server/`. This is a
sensitive change (`src/main/server/AGENTS.md`).

### The extension's side (`extension/src/lib/client.ts`)

Rules: `extension/AGENTS.md`. Design: the frozen `docs/plans/2026-11-23-phase2-a2-*.md`.

- Pairing: the popup's code is normalized in the service worker before anything is sent
  (`normalizePairingString`, `lib/pairingInput.ts`: trimmed, ASCII letters upper-cased, and after the first `-`
  the letter O read as 0 and I or L as 1), then parsed with the shared `parsePairingString`
  (`src/shared/protocol.ts`). `pair(port, code, label)` calls `/v1/pair` once; the service worker stores the record
  (`lib/messages.ts`).
- Every later call (`call(path, body)`): read the record, send `/v1/hello` with a fresh 32-byte nonce, verify the
  proof with WebCrypto, then send at most one request with the bearer token. A proof older than 5 s on either
  clock, or one checked after a wall clock that went backwards, is not used (`stale_proof`); the request is not
  made.
- Each fetch: `credentials: 'omit'`, `cache: 'no-store'`, `redirect: 'manual'`, `referrerPolicy: 'no-referrer'`,
  aborted after 5 s (headers and body together). At most 64 KiB of a response is read; more counts as not JSON.
- A failed exchange is a `CallResult` kind, not a throw (only a programming error throws a fixed text: a path that
  may not be requested, a body that is not JSON, a port that is not a server port): `not_paired`,
  `storage_blocked`, `app_not_running`, `wrong_program` (hello was not a valid proof), `unpaired` (hello answered
  `unknown_pairing`), `stale_proof`, `too_large_local`, `wrong_shape` or `refused` with the status and error token.
- Of the client's methods only `call` deletes the stored record, and only on `401 bad_token` or `403 bad_origin`
  after a right proof. Outside the client, Unpair removes it (`messages.ts`) and a read drops a record of another
  shape (`store.ts`).
- No retry (`client.ts`, E8e): the popup shows the state and the user presses Check again.

## IPC (window to main)

- Channel names: `fetchly:<method>`, one per `FetchlyApi` method (`src/shared/types.ts`). Push channels:
  `fetchly:changed`, `fetchly:installProgress`, `fetchly:status`.
- Every call returns `Promise<Result<T>>`; nothing throws across IPC.
- Arguments are `unknown` in main and validated there; the renderer is not trusted.
- Pattern for a new channel: `.ai/context/code-patterns.md`, "IPC channel".
