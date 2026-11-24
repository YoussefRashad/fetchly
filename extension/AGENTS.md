<!-- project-setup:begin id=local -->
# extension: local rules

Applies to work under `extension/` (the Chrome/Edge Manifest V3 extension). The root AGENTS.md still applies.

This is the client side of the browser-facing trust boundary, and it holds the pairing token. Treat every change
under `extension/src/**`, and every change to `extension/manifest.json`, as **sensitive**: the owner reviews the
diff line by line before it is committed. Read `src/main/server/AGENTS.md` too, because both sides share
`src/shared/protocol.ts`.

Rules, each enforced by the code or a spec today:

- Only service-worker code imports `src/lib/client.ts`, the extension's only way to talk to the app. The popup is
  DOM glue: it renders with `textContent` and holds no token logic (`popup.ts`; spec
  `tests/extension/manifest.test.ts`, "E8d").
- The token is read from the store inside a call and held only in locals. It never appears in a `CallResult`, a
  thrown message, a log or a popup reply; only `pair`'s result hands the new token to the service worker, which
  stores it. Replies to the popup carry no token, `pairingId` or port (`client.ts`, `messages.ts`).
- Every call first sends `/v1/hello` with a fresh random nonce and checks the server's proof with WebCrypto
  (`helloInput`), and only then makes one request with `Authorization: Bearer <token>` (`client.ts`).
- The service worker answers messages from the extension's own popup only: the sender's id, `popup.html` URL and
  no tab are all checked (`fromPopup`, `messages.ts`). Three message types: `fetchly:status`, `fetchly:pair`,
  `fetchly:unpair`.
- `lib/` files get `chrome.runtime`, `fetch`, WebCrypto, IndexedDB, the navigator, clocks and timers injected
  (`service-worker.ts` wires them). A lib file never names `chrome`, `document`, `window` or `indexedDB`.
- Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval(`, `new Function`, `DEFAULT_SERVER_PORT`,
  `chrome.storage`, `localStorage`, `onMessageExternal`, `onConnectExternal` or `console` under `extension/src`.
  The spec fails on each of them.
- The pairing record lives in IndexedDB (database `fetchly` v1, store `kv`, key `pairing`, `store.ts`), not in
  the extension storage API. A stored record of another shape reads as none and is deleted, so a change to
  `PairingRecord` un-pairs every installed browser. Treat it like a persisted-file change: specs first and the
  owner's review.
- `manifest.json` keeps `permissions: []`, `host_permissions: ["http://127.0.0.1/*"]` and
  `incognito: "not_allowed"`, with no content scripts, optional permissions or externally connectable pages. It
  stays LF-only (`.gitattributes`). Any new key or permission is a sensitive change with its spec.
- The build (`vite.config.mjs`, `npm run build:ext`) refuses an emitted `popup.html` with an inline script or an
  `on*=` handler attribute, and copies `manifest.json` byte for byte. Do not weaken those checks.
- Popup texts exist in English and Arabic in `src/lib/strings.ts` (`tests/extension/strings.test.ts`).
- The wire protocol is `src/shared/protocol.ts`, shared with the server. A route, body key, limit or error token
  changes both sides and their specs together (`ERROR_TOKENS` in `client.ts` must list every `ErrorToken`).
- The design record is the frozen `docs/plans/2026-11-23-phase2-a2-*.md` (E-, N-, R2- and AM-numbers in comments
  point there). Read them; do not edit them.

Tests: `tests/extension/*.test.ts`, with fakes for fetch, IndexedDB, the server and the clock. They run no browser.
Run only the specs you touch; the full suite runs under the shared lock (root AGENTS.md, Commands).
<!-- project-setup:end id=local -->
