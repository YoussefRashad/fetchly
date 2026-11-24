<!-- project-setup:begin id=local -->
# src/main/server: local rules

Applies to work under `src/main/server/`, and to `src/shared/protocol.ts`, which defines the wire format these
files serve. The root AGENTS.md still applies.

This is the browser-facing trust boundary: the local HTTP server, its routes and the pairing store. Treat every
change here, and every change to the extension's client side (`extension/src/**`), as **sensitive**: the owner reviews the diff line by line before it is committed.

Rules, each enforced by the code today:

- Bind to `127.0.0.1` only (`server.ts`, `server.listen(requested, '127.0.0.1')`). Never a wildcard address.
- Keep the check order in `handleRequest` (`server.ts`): headers and `Host` equal to `127.0.0.1:<real port>`,
  then `OPTIONS` refused, path, method `POST`, paired `chrome-extension://` origin, content type and size, bearer
  token, rate limit. A cheaper refusal must never come after an authenticated step. Specs:
  `tests/server/server.test.ts`.
- No CORS headers, ever. Responses carry only `Content-Type`, `Cache-Control: no-store`, `Connection: close` and
  `Content-Length`.
- The token is never stored, logged or returned after `/v1/pair`. Only `tokenHash` (SHA-256) and `proofKey`
  (HMAC-SHA256 keyed by the token) are kept (`pairing.ts`). Token and pairing-code comparisons stay constant-time
  (`timingSafeEqual`, no early exit).
- The `/v1/hello` proof binds the pairing id, the real listening port and the client nonce
  (`helloInput` in `src/shared/protocol.ts`). Do not drop the port from it: it is what defeats a relay on another
  port.
- Nothing about a request is logged. The one log line names the route path and a sanitized error name, never a
  message, stack, header or body (`server.ts`).
- Every body is checked for its exact key set (`routes.ts`). New fields are a protocol change: update
  `src/shared/protocol.ts`, `docs/api-conventions.md` and the specs in `tests/server/` together.
- `pairing.json` holds derived key material. Its format is migration-class (see `docs/persistence.md`):
  a format change keeps older files loadable or sets them aside with a notice, and needs the owner's review.
- Changing the listening port clears every pairing (`ipc.ts`, `setSettings`). Keep the port part of the pairing.
- The threat model and the planned routes (hand-off, logins) are in the frozen
  `docs/superpowers/plans/2026-11-22-phase2-architecture.md`, sections 2 and 3. Read it before adding a route;
  do not edit it.

Tests: `tests/server/*.test.ts` and `tests/ipcPairing.test.ts`. Run only the specs you touch; the full suite
runs under the shared lock (root AGENTS.md, Commands).
<!-- project-setup:end id=local -->
