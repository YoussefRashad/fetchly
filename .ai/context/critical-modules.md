# Critical modules

Fetchly has no money flows. Its critical areas are the browser trust boundary, the user's persisted download list,
the tools it downloads and runs, and the files it hands to the user. Changes in the first area are
**sensitive** (line-by-line owner review before commit); persisted-format changes are **migration-class**.

## 1. Local server, pairing and the signed proof (sensitive)

Files: `src/main/server/{server,routes,pairing}.ts`, `src/shared/protocol.ts`, the pairing handlers in
`src/main/ipc.ts`. Local rules: `src/main/server/AGENTS.md`.

Invariants:
- Listens on `127.0.0.1` only; default port 38917, allowed 1024 to 65535. A busy port gives status `portBusy`;
  saving Settings retries.
- Four routes, all `POST`: `/v1/pair` and `/v1/hello` (no token), `/v1/status` and `/v1/unpair` (bearer token).
  Bodies are checked for their exact key set; limit 64 KiB.
- Check order in `handleRequest`: header shape and `Host` = `127.0.0.1:<real port>`; `OPTIONS` refused; path;
  method; origin is a `chrome-extension://` id (and, for token routes, a paired origin); content type and size;
  token; rate limit (300 requests per 60 s per pairing).
- No CORS headers. Responses: `Content-Type`, `Cache-Control: no-store`, `Connection: close`, `Content-Length`.
- Pairing code: 8 characters from a 32-symbol alphabet, 300 s plus 10 s grace, 5 wrong tries close it, at most 4
  pairings. The app shows `<port>-<code>`.
- Token: 32 random bytes, base64url. Stored only as `tokenHash` (SHA-256) and `proofKey` (HMAC-SHA256 keyed by
  the token). Comparisons use `timingSafeEqual` with no early exit; the matched pairing's origin must equal the
  request origin.
- Signed proof: `/v1/hello` answers HMAC-SHA256(`proofKey`, `fetchly-hello-v1\n<pairingId>\n<port>\n<nonce>`), so a
  relay on another port cannot pass. The server stores no nonces and checks no timestamp (see `TODO.md`).
- Changing the port clears every pairing after a confirmation. Entries for another port are ignored at load.
- Pairing writes: memory is authoritative; a failed write is retried on the next change, every 30 s and at quit.
- Not defended, by design and stated in `README.md`: same-user programs reading `pairing.json` or the extension's
  storage; local denial of service.

Threat model and planned routes (hand-off, logins, cookies): the frozen
`docs/superpowers/plans/2026-11-22-phase2-architecture.md`, sections 2 and 3.

Extension (`extension/src/**`, Phase 2 branches until merged): the client side of the same boundary; it holds the
token. Same review class as the server. Its rules are not documented here yet (`TODO.md`).

## 2. Persisted state (migration-class)

Files: `src/main/jobs/{store,validate}.ts`, `src/main/atomicFile.ts`, `src/main/server/pairing.ts`. Local rules:
`src/main/jobs/AGENTS.md`. Details: `docs/persistence.md`.

Invariants: atomic writes; strict validation from known keys; an invalid file is set aside as
`<name>.corrupt-<ms>` with a notice, never silently dropped; a job running at a crash loads as paused and
`interrupted`; `save()` never throws.

## 3. Tool downloads and process supervision

Files: `src/main/binaries.ts`, `src/main/strays.ts`, `src/main/toolGate.ts`, `src/main/engines/*`,
`src/main/engineHost.ts`. Details: `docs/integrations/`.

Invariants:
- Tools come only from their GitHub release pages and are SHA-256 checked before extraction (aria2 against the
  pinned `ARIA2_ZIP_SHA256`; an empty value refuses the install). Installs are serialized.
- Pause counts only after the process has really stopped (`taskkill /T /F` for yt-dlp and ffmpeg); otherwise the
  user sees that the pause was not confirmed.
- At start, leftover yt-dlp, ffmpeg and aria2c processes running from `%APPDATA%\fetchly\bin` are ended. If that
  check cannot run, the app still starts and resume stays refused for cut-off jobs until the user confirms.
- aria2's RPC listens locally with a per-run secret; torrents, metalinks, DHT and peer exchange are off.

## 4. Files handed to the user

File: `src/main/fileSafety.ts`. Every finished file gets a `Zone.Identifier` stream (zone 3, host URL without
credentials) before the job is shown as done. Opening a runnable type (the `RUNNABLE` list: programs, scripts,
shortcuts, disk images) asks first.

## 5. Window

File: `src/main/index.ts`, `src/renderer/index.html`. `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`; new windows denied (http(s) links open externally); navigation prevented; a CSP meta
tag with `script-src 'self'`. Do not loosen any of these.

## Logging and redaction

There is no logger. The only log line is the server's handler-failure line (route path and a sanitized error
name). Error reasons shown to the user are capped at 200 characters. Never log tokens, codes, cookies, URLs with
credentials or full tool output.
