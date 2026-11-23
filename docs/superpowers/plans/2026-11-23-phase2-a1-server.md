# Fetchly Phase 2, Component A1: Local Server, Pairing and Server Proof

> **For agentic workers:** work task by task, tests first. Steps use checkbox (`- [ ]`) syntax.

**Contract:** `docs/superpowers/plans/2026-11-22-phase2-architecture.md` (frozen, "the frozen plan"; never edited). "A1 decision" marks where this plan is more specific. No wire type, token or status is added (section 12).

**Class:** SENSITIVE. The orchestrator stops before git; the owner reviews the diff line by line.

**Gates:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. The repo has no `AGENTS.md` or `.ai/`.

**Probe gate (P4, browser, not run):** Tasks 1–5 do not depend on it. Task 6 onward starts only after P4. P4 gains two cases:
- (a) The extension ID of the same `extension/dist` folder loaded in Chrome and in Edge: equal or different.
- (b) Whether a Private Network Access preflight is sent, and whether it asks for `Access-Control-Allow-Private-Network`.

If P4 shows any preflight, stop: the owner approves the fallback (Q10) and Task 6b runs. No Node probe is load-bearing (S13, S18).

## 1. Scope

**In**
- Loopback listener with the frozen parsing rules and check order.
- `/v1/pair`, `/v1/hello`, `/v1/status`, `/v1/unpair`, and `routes.register`.
- `pairing.json`, `Settings.serverPort`, `AppStatus.server`, the `server` banner.
- IPC `pairingStart`, `pairingCancel`, `pairings`, `unpair`.
- Settings pairing panel and port field.
- `src/main/atomicFile.ts`, `src/shared/text.ts`, A1's part of `src/shared/protocol.ts`.

**Out**
- `extension/**`, `build:ext`, `tsconfig.ext.json` (A2).
- `/v1/handoff*`, `/v1/logins`, `Job` fields, hand-off and login IPC (A3–A6).
- The `tmp/` sweep (A5). A1 only guarantees `main()` awaits the server start at one place, so A5 can sweep before it.
- Any change to `Store.loadSettings`, `Store.loadSnapshot`, `parseJob` or `jobs.json`.

## 2. Files

| File | Change |
|---|---|
| `src/shared/text.ts` (new) | `CONTROL = /[\u0000-\u001f\u007f]/u` and `BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/u`, no `g` flag. |
| `src/shared/protocol.ts` (new) | No Node imports. `PROTOCOL`, `DEFAULT_SERVER_PORT = 38917`, `PORT_MIN`, `PORT_MAX`, `isServerPort`, body limits, `ORIGIN_RE`, `PAIRING_ID_RE`, `NONCE_RE`, `TOKEN_RE`, `CODE_ALPHABET`, `CODE_RE`, `LABEL_MAX = 40`, `MAX_PAIRINGS = 4`, `PROOF_KEY_LABEL`, `helloInput`, `formatPairingString`, `parsePairingString`, the frozen `ErrorToken` union, and the four A1 request/response types. |
| `src/main/atomicFile.ts` (new) | `writeAtomic(dir, path, data)`: the body of `Store.writeAtomic`, unchanged. |
| `src/main/server/pairing.ts` (new) | Code lifecycle, token issue and match, proof, rate window, `pairing.json` load, save, unsaved flag and retry. |
| `src/main/server/routes.ts` (new) | Route table with `register`; the four A1 routes. |
| `src/main/server/server.ts` (new) | Listener, parsing rules, check order, `start`/`ensure`/`stop`, `productionDeps()`. |
| `src/main/jobs/store.ts` | `DEFAULT_SETTINGS.serverPort`; both saves call `atomicFile.writeAtomic`. |
| `src/main/jobs/validate.ts` | Imports `CONTROL`; `SETTING_CHECKS.serverPort`; `normalizeSettings` fallback. |
| `src/main/ipc.ts` | Imports `CONTROL`; `setSettings` port flow; four handlers; new `HandlerDeps` members. |
| `src/main/index.ts` | Composition (Task 9). |
| `src/shared/types.ts` | `Settings.serverPort`, `ServerStatus`, `AppStatus.server`, `PairingInfo`, `PairingsView`, four `FetchlyApi` methods. |
| `src/preload/index.ts`, `banners.ts`, `SettingsDialog.tsx`, `strings.ts` | Four `call(...)` entries; banner `server`; port field and "Browser" panel. |
| `tests/helpers.ts`, `tests/ipc.test.ts`, `tests/renderer/banners.test.ts` | Fixtures only. `tests/jobs/store.test.ts` is **not edited**. |
| `README.md`, `docs/manual-checklist-phase2.md` (new) | A1 facts only (Task 10). |

## 3. A1 decisions

| # | Decision |
|---|---|
| S1 | **Token bytes.** `token` is the 43-character base64url string. `tokenHash = SHA-256(ASCII of the string)`. `proofKey = HMAC-SHA256(key = ASCII of the string, msg = "fetchly-server-proof-v1")`. |
| S2 | **Encodings.** `proof`, `tokenHash` and `proofKey` are base64url without padding, 43 characters. The proof key is the 32 raw bytes of `proofKey`; the message is UTF-8 `helloInput(...)`. |
| S3 | **Code.** Alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`; eight random bytes, each `& 31`. Only `CODE_RE` is accepted. |
| S4 | **Several pairings may share one origin** (Chrome and Edge loading one unpacked folder). Pairings are told apart by token, never by origin. A new pair always adds an entry. |
| S5 | **Limit of 4** is enforced at `pairingStart` with "Four browsers are already paired. Unpair one first.". Stale entries are removed by the user with Unpair; nothing is evicted. |
| S6 | **Origin, step 3.** `/v1/pair`, `/v1/hello`: `ORIGIN_RE` only. Token routes: `ORIGIN_RE` and equal to the origin of at least one stored pairing, else `403 bad_origin`. |
| S6b | **Token, step 5.** A value failing `TOKEN_RE` is `401`. Otherwise its hash is compared through `safeEqual` with **every** stored pairing (at most 4), with no early exit. The matched pairing's origin must equal `Origin`. No match, or another origin: `401 bad_token`. |
| S6c | **Re-check.** After the body is read and before `handle`, the matched pairing must still be stored, else `401 bad_token`. |
| S7 | **Order inside step 2** (PROVISIONAL): `OPTIONS` on any path gives `403 preflight_refused`, then path (`404`), then method (`405`). It is the only reading where "`OPTIONS` always" holds. Alternative: path first. |
| S8 | **Step 1** (PROVISIONAL, with S7): any `Transfer-Encoding` is refused for every method. A missing `Content-Length` is refused for `POST` only. |
| S9 | **Content type.** The whole value, trimmed and lowercased, equals `application/json` or `application/json; charset=utf-8`. No prefix match. |
| S10 | **No new token.** (a) A failed `pairing.json` write is not a wire error (S11). (b) A handler that throws (a bug) gets no response: the socket is destroyed. A2 sees it as its frozen "no answer" row. PROVISIONAL; alternative in section 12. |
| S11 | **Memory is authoritative; disk follows.** Every pairing change applies in memory, then writes. A failed write sets `unsaved`. The write is retried on every later change, every 30 s while `unsaved`, and once in `before-quit`. `/v1/pair` and `/v1/unpair` answer `200` either way. |
| S12 | **N27, PROVISIONAL.** A pairing whose port differs from the effective `serverPort` is **ignored** at load and the file is not rewritten. It disappears at the next save, which writes memory only. An unreadable `settings.json` therefore cannot delete pairings by itself. Editing the port back before any save revives the pairing with its own port and token, harmless under D8. Alternative: remove at once. |
| S13 | **Port move.** Each `ensure` that must listen builds a new `http.Server`. The old instance gets `close()` plus `closeAllConnections()` and is not awaited. A port just closed is never re-bound in the same call. `ensure` listens when the requested port differs from the listening port or the state is not `listening`; otherwise it does nothing. Leaving `listening` (stop, `error` event, port move) cancels an open code. Covered by Task 8 on real sockets, so P17 is not needed. |
| S14 | **IPC port validation.** `setSettings` tests the raw value with `isServerPort`, with no `Number(...)` coercion. Refusal text: "Port must be a whole number from 1024 to 65535". |
| S15 | **Port-change flow.** `confirmPortChange(count)` is a main-process dialog, asked only when pairings exist. A second `setSettings` while it is open fails with "Settings are being saved". After confirmation, one synchronous block cancels the code, empties the pairings (S11) and calls `saveSettings`; then `ensure`. If `saveSettings` throws, the pairings stay emptied, the listener is not moved and the call fails. Declined: nothing changes; "Settings were not saved: the port was not changed". |
| S16 | **Listen results.** `EADDRINUSE`: `portBusy`. `EACCES`: `error`, "port <n> cannot be used on this PC; choose another in Settings". Other error, or no result within 3 s: `error` with a fixed text. `listening.port` and the port in the proof, the pairing string and new pairings come from `server.address().port`, never from settings. |
| S17 | **Logging.** No request data in any text. The one allowed call is `console.error` in the handler-throw path, with the registered route path and the error's `name` only. |
| S18 | **Early refusals.** Refusal at steps 1–3, 5 or 6 with a declared `Content-Length` within the limit (64 KiB when no route matched): the body is discarded without buffering to its end, then the response is written. `413`, or no usable length: respond at once, destroy after a 1 s linger. A2 checks sizes itself, so P15 is not needed. |
| S19 | **Body.** Exact byte count; fatal UTF-8 decode with the BOM kept (a BOM fails `JSON.parse`); a JSON object with exactly the endpoint's keys. Anything else: `400 bad_request`. |
| S20 | **`label`.** A string of 1–40 UTF-16 code units with no `CONTROL` and no `BIDI` match. |
| S21 | **`/v1/pair` order.** Body shape (step 7) comes before the code state, so a malformed body is `400` whether or not a code is open, and uses no try. |
| S22 | **Paths.** `req.url` must equal the registered path exactly. |
| S23 | **Sleep.** `powerMonitor` `suspend` cancels an open code, whatever the monotonic clock does across sleep. |

## 4. Interfaces A1 provides

```ts
// types.ts
type ServerStatus = { state: 'listening'; port: number } | { state: 'portBusy'; port: number } | { state: 'error'; message: string };
interface PairingInfo { id: string; label: string; pairedAt: number }   // never origin, tokenHash, proofKey
interface PairingsView { pairings: PairingInfo[]; codeOpen: boolean; unsaved: boolean }
// FetchlyApi
pairingStart(): Promise<Result<{ pairingString: string; lifetimeMs: number }>>;
pairingCancel(): Promise<Result<null>>;
pairings(): Promise<PairingsView>;
unpair(id: string): Promise<Result<null>>;

// routes.ts
interface Route {
  path: string; auth: 'none' | 'token'; bodyLimit: number;
  handle(ctx: { body: Record<string, unknown>; origin: string; pairing: Pairing | null; port: number }): Reply | Promise<Reply>;
}
type Reply = { status: number; body: object };
register(route: Route): void;                           // throws on a duplicate path

// server.ts
start(port: number): Promise<RunningServer>;            // never rejects
interface RunningServer { status(): ServerStatus; ensure(port: number): Promise<ServerStatus>; stop(): Promise<void> }
```

`status()` exists only on `RunningServer`, so `appStatus` cannot be built before a decided state exists. `pairedAt` is `Date.now()`, for display only. Deadlines use the injected monotonic `now()`.

## 5. Tasks

Each task: write the failing tests, run them (FAIL), implement, run again (PASS), then `npm run typecheck` and `npm run lint`. No commit.

### Task 1: `text.ts`
**Files:** create `src/shared/text.ts`, `tests/text.test.ts`; modify `validate.ts`, `ipc.ts`.
- [ ] **Tests:**
  - `CONTROL` matches each of U+0000–U+001F and U+007F; not space, U+0080 or a URL.
  - `BIDI` matches each listed code point and not U+200D.
  - Neither has a `g` flag: two tests in a row agree.
- [ ] **Implement:** export both; delete the two local `CONTROL` copies.
- [ ] **Run:** `npx vitest run tests/text.test.ts tests/jobs/validate.test.ts tests/ipc.test.ts`

### Task 2: `atomicFile.ts`
**Files:** create `src/main/atomicFile.ts`, `tests/atomicFile.test.ts`; modify `store.ts`.
- [ ] **Tests:** writes the data and leaves no `.tmp`; creates a missing directory; replaces a file; a failed write (target is a directory) leaves the old file intact.
- [ ] **Run:** `npx vitest run tests/atomicFile.test.ts tests/jobs/store.test.ts` (store spec unedited).

### Task 3: `serverPort` (migration-class, section 9)
**Files:** create `tests/jobs/settingsPort.test.ts`; modify `types.ts`, `protocol.ts`, `store.ts`, `validate.ts`, `tests/helpers.ts`.
- [ ] **Tests:**
  - A file without `serverPort` loads 38917.
  - `it.each` loads the default, not clamped: `1023`, `65536`, `0`, `-1`, `80`, `38917.5`, `"38917"`, `null`, `true`, `[]`, `1e999`.
  - 1024 and 65535 load as given.
  - A bad port leaves the other fields as saved.
  - `normalizeSettings` turns an out-of-range port into the default.
  - Save then load round-trips 40000.
  - A Phase 1 fixture keeps every old value.
- [ ] **Run:** `npx vitest run tests/jobs/settingsPort.test.ts tests/jobs/store.test.ts tests/jobs/validate.test.ts`

### Task 4: `protocol.ts` and pairing core
**Files:** create `pairing.ts`, `tests/server/protocol.test.ts`, `tests/server/pairing.test.ts`. Injected: `now`, `randomBytes`, `safeEqual`, `save`, `setTimer`.
- [ ] **Tests, protocol:**
  - `ORIGIN_RE` accepts 32 letters a–p; rejects 31, 33, `q`, uppercase, a trailing slash, `https://`.
  - `parsePairingString` round-trips `formatPairingString`.
  - It rejects no dash, `1023`, `65536`, a leading zero, 7 or 9 symbols, the letter `O`.
- [ ] **Tests, code:**
  - `open` returns 8 alphabet symbols from the random source.
  - A right code pairs once; the same code again is `pairing_closed`.
  - Valid at 310 000 ms, closed at 310 001 ms.
  - Four wrong then right pairs.
  - The fifth wrong code answers `bad_code` and closes; a right code after it is `pairing_closed`.
  - `open` again replaces the code and resets the tries.
  - `cancel` closes.
  - `open` is refused with 4 pairings, and while the injected server state is not `listening`.
  - Compares go through `safeEqual` with equal-length buffers.
- [ ] **Tests, token (S4, S6b):**
  - Pair returns a 43-character token and a 22-character id.
  - The record follows S1 and S2 and holds no token.
  - Two pairs from one origin give two entries, and both tokens work.
  - With 4 pairings `safeEqual` is called 4 times, whichever entry matches and when none does.
  - A token whose pairing has another origin fails.
  - A 42-character token fails without a compare.
- [ ] **Tests, proof:**
  - The proof equals an independent HMAC over `fetchly-hello-v1\n<id>\n<port>\n<nonce>`.
  - A proof for port + 1 differs.
  - An unknown id, and an id paired to another origin, is `unknown_pairing`.
  - The right id works with a shared origin.
- [ ] **Tests, unpair and S11:**
  - Unpair removes only that entry; its token and hello fail; a same-origin sibling still works.
  - `save` throwing on pair: the pairing works, `unsaved` is true, and the retry at 30 000 ms writes it and clears the flag.
  - `save` throwing on unpair: revoked at once, `unsaved` true; a later pair retries the write, which holds the new state.
  - `flush()` writes when `unsaved`.
  - A fresh load of the file before the retry still shows the old state (documented residual).
- [ ] **Tests, rate:** request 300 passes and 301 is `rate_limited`; the window resets at 60 000 ms; two pairings of one origin count apart.
- [ ] **Run:** `npx vitest run tests/server/protocol.test.ts tests/server/pairing.test.ts`

### Task 5: `pairing.json`
**Files:** `pairing.ts`; create `tests/server/pairingFile.test.ts`.
- [ ] **Tests:**
  - A missing file loads unpaired with no notice.
  - A round trip keeps the exact shape and key set.
  - Two entries with one origin load.
  - Truncated JSON is set aside as `pairing.json.corrupt-<n>` with its bytes, and a notice is returned.
  - `it.each` sets the whole file aside: version 2; 5 entries; duplicate id; bad origin; a 42-character `tokenHash`; port `80`; a 41-unit label; an empty label; a label with a control or bidi character; a non-finite `pairedAt`.
  - An unknown extra key is not carried into the next save.
  - S12: an entry on another port is not loaded and the file bytes are unchanged; the next save omits it; loading with the matching port again, before any save, returns it.
  - A failing set-aside rename does not throw; the app starts unpaired.
- [ ] **Run:** `npx vitest run tests/server/pairingFile.test.ts`

### Task 6: listener, parsing rules, check order (after P4)
**Files:** create `server.ts`, `routes.ts`, `tests/server/rawHttp.ts` (`net` helper), `tests/server/server.test.ts`. Real `node:http` on `127.0.0.1:0`; a fake token route and a fake 512 KiB route.
- [ ] **Tests, parsing:**
  - `it.each` two of `Host`, `Origin`, `Authorization`, `Content-Type`, in mixed case too: `400 bad_request`.
  - Two `Content-Length`: bare 400. `Content-Length` with `Transfer-Encoding`: bare 400.
  - A chunked POST, and `Transfer-Encoding: identity` on POST and on GET: `400 bad_request`.
  - A POST without `Content-Length`: 400.
  - A 9000-byte header: bare 431.
  - Slow headers, a slow body, and a connection that sends nothing: 408 or closed by the deadline.
  - Production options are 8192, 5000, 10000, 1000, and `connectionsCheckingInterval` reaches `createServer`.
  - `maxConnections` is 16; the bind address is 127.0.0.1.
  - `Expect: 100-continue`: no `100` is written and the normal checks answer.
  - `Upgrade` and `CONNECT`: no `101` or `2xx`, no handler runs, the socket closes.
- [ ] **Tests, check order** (each request also breaks every later step; the earlier token wins):
  - `Host` as `localhost:<port>`, another port, or absent on HTTP/1.0: `403 bad_host`.
  - `OPTIONS` on any path: `403 preflight_refused`, no `Access-Control-*`.
  - `/nope`, `/v1/pair?x`, `/v1/pair/`, `//v1/pair` and an absolute-form target: `404`.
  - `GET`, `PUT`, `DELETE`: `405`.
  - No `Origin`, `null`, `https://…`, or an extension origin with no pairing on a token route: `403 bad_origin`.
  - `text/plain`, a missing type, `application/json, text/plain`, `application/jsonx`: `415`.
  - `Content-Length` 65537, and 524289 on the large route: `413`. Exactly 65536 and 524288 pass.
  - No `Authorization`, `Basic`, a 42-character token, a wrong token, another origin's token: `401`.
  - Request 301: `429`.
  - Broken JSON, an array, invalid UTF-8, a BOM, an extra key: `400`.
- [ ] **Tests, responses:**
  - Every app response has `Content-Type: application/json`, `Cache-Control: no-store`, `Connection: close` and only `{ "error": token }`.
  - A marker in the path, headers and body is never echoed.
  - A throwing handler: the socket closes with zero response bytes, and the next request is served.
  - A refusal with a 60 000-byte body still in flight is received in full (S18).
  - An unpair while another request's body is in flight gives `401` (S6c).
  - `register` throws on a duplicate path.
  - `productionDeps()` returns `crypto.timingSafeEqual` and `crypto.randomBytes`.
- [ ] **Run:** `npx vitest run tests/server/server.test.ts`

### Task 6b (only if P4 shows a preflight, after owner approval)
- [ ] **Tests:**
  - `OPTIONS` from any stored origin gives `204` with `Access-Control-Allow-Origin: <origin>`, `Access-Control-Allow-Headers: authorization, content-type` and `Vary: Origin`.
  - `Access-Control-Allow-Private-Network: true` is added only if P4 case (b) needs it.
  - The same on `/v1/pair` from any extension-shaped origin while a code is open.
  - Every `POST` response to those origins, **errors included**, carries the same two headers.
  - Every other origin keeps `403 preflight_refused` with no CORS header.

### Task 7: the four endpoints
**Files:** `routes.ts`; create `tests/server/endpoints.test.ts`.
- [ ] **Tests:**
  - Pair with the right code returns `{ pairingId, token, protocol: 1, appVersion }`.
  - Pair while closed is `403 pairing_closed`.
  - A bad label (41 units, empty, control, bidi, not a string), a malformed code, or an extra key is `400`, uses no try, and is `400` while closed too (S21).
  - Two right-code pairs in flight: exactly one `200`, the other `pairing_closed`, one entry.
  - Hello returns a proof the test verifies with `server.address().port`.
  - A 21-character id or a 42-character nonce is `400`.
  - An unknown id, or another origin's id, is `404 unknown_pairing`.
  - 1000 hellos are all answered.
  - Status returns `{ app: 'fetchly', protocol: 1, appVersion, engine }` for each engine state.
  - Unpair returns `{}`. The same token then gets `403 bad_origin` when it was the origin's only pairing, and `401 bad_token` when a sibling remains.
  - A hello, then an IPC unpair, then the token request: `403` or `401` as above (B5).
  - 100 wrong tokens are all `401`; the right token then gets `200`, and 300 more pass.
  - Pair with a failing save answers `200` (S11).
- [ ] **Run:** `npx vitest run tests/server/endpoints.test.ts`

### Task 8: port states and lifecycle
**Files:** `server.ts`; create `tests/server/port.test.ts`.
- [ ] **Tests:**
  - `start` resolves with a decided status for a free port, a held port (`portBusy`, no other port bound), injected `EACCES` (S16 text) and a listen that never answers (`error` at 3000 ms on the injected clock).
  - `ensure` on the same port while `listening` builds no server.
  - `ensure` on a freed busy port gives `listening`.
  - `ensure` with a new port: the old port refuses connections, the new one answers, and an open old connection is destroyed.
  - A busy new port gives `portBusy` and the old port stays closed.
  - An `error` event after `listening` gives `error` and cancels the open code. So do `stop` and a port move.
  - `stop` during an open request destroys the socket and resolves; `stop` twice resolves.
- [ ] **Run:** `npx vitest run tests/server/port.test.ts`

### Task 9: IPC, status, banner, composition, Settings panel
**Files:** `ipc.ts`, `index.ts`, `preload/index.ts`, `banners.ts`, `SettingsDialog.tsx`, `strings.ts`; create `tests/ipcPairing.test.ts`; fixtures.
- [ ] **Tests, IPC:**
  - A valid `serverPort` stays in the save, the queue and the answer.
  - `it.each` refuses with the S14 text and saves nothing, `"38917"` included.
  - Same port: no confirmation, `ensure` still called (retry).
  - New port, no pairings: no confirmation; code cancelled, saved, moved.
  - Confirmed: the order is cancel code, empty pairings, `saveSettings`, `ensure`.
  - Declined: nothing saved, pairings kept, no `ensure`.
  - `saveSettings` throwing: failure, pairings emptied, no `ensure`.
  - A second `setSettings` during the dialog fails.
  - `pairingStart` fails unless `listening`, and at 4 pairings.
  - `pairingStart` returns `<listening port>-<code>`, also when settings hold another port.
  - `pairings()` returns id, label, pairedAt, `codeOpen` and `unsaved` only.
  - `unpair` with a non-string or unknown id fails.
  - `unpair` with a failing save removes the entry and fails with "Unpaired, but the change is not saved yet; Fetchly keeps trying".
- [ ] **Tests, banners:** `portBusy` shows "port <n> is in use; change it in Settings" with action null; `error` shows its message; `listening` shows none; the order is engine, server, save, cutOff.
- [ ] **Implement, `index.ts`** (order is the rule):
  1. `store.load()`.
  2. Load pairings with the effective port; join a set-aside notice into `notice`.
  3. `const server = await start(settings.serverPort)`.
  4. `createHandlers` and `ipcMain.handle`.
  5. `showWindow()`.
  - `appStatus` reads `server.status()`.
  - `before-quit`: `pairings.flush()` synchronously, then `server.stop()` first in `tidy`.
  - `powerMonitor.on('suspend', …)` cancels an open code.
- [ ] **Implement, Settings:**
  - Port field.
  - "Browser" panel: status line; "Pair a browser", enabled only when `listening` and the draft port equals the listening port.
  - The pairing string with a 5-minute countdown and Cancel.
  - The list with label, date and time, and Unpair.
  - A persistent line while `unsaved`: "Pairing changes are not saved to disk yet".
  - `pairings()` is polled every 1 s while a code is open or `unsaved`.
  - `App.tsx` is not touched.
  - The panel has **no automated test**; it is covered by the manual checklist lines of Task 10.
- [ ] **Run:** `npx vitest run tests/ipcPairing.test.ts tests/ipc.test.ts tests/renderer/banners.test.ts`

### Task 10: docs and gates
- [ ] `README.md`:
  - The port setting, and "changing the port means pairing again".
  - Where `pairing.json` sits.
  - `pairing.json.corrupt-*` and a leftover `pairing.json.tmp` also hold key material.
  - The same-user limit.
  - A pairing change that could not be saved is retried, and until then a restart shows the old list.
- [ ] `docs/manual-checklist-phase2.md`:
  - Port busy.
  - Change the port with and without pairings.
  - A code that expires.
  - Pair Chrome and Edge from one folder: both stay paired.
  - Unpair one.
  - The countdown, Cancel and the `unsaved` line.
  - A sleep while a code is open.
- [ ] **Run:** `npx vitest run tests/server`, then the four gates. Timing specs run serially; a red run under load is re-run alone.

## 6. Acceptance map

| Frozen requirement | Test |
|---|---|
| Check-order rows 1–7 | T6 check order |
| Parsing table, 5 rows | T6 parsing |
| `Connection: close`, `no-store`, no echo | T6 responses |
| Rate: 300 a minute after the token; hello unlimited; no token lockout | T4 rate, T7 |
| Proof with the port; `404` in both cases | T4 proof, T7 |
| Q1: single use, boundary, 5 tries, constant-time compare | T4 code |
| D3/Q7: several pairings, at most 4 | T4 token, T5, T9 |
| Unpair revokes | T4 unpair, T7 |
| Refused while not `listening` | T4 code, T8, T9 |
| Port change removes pairings (Q19) | T9 |
| Another port dropped at load (N27) | T5 |
| Port busy: banner, no other port | T8, T9 |
| Out-of-range port loads the default | T3 |
| `pairing.json` shape; unreadable set aside | T5 |
| `status()` always has a decided `server` | T8 `start`, section 4 types |
| N45 `Vary: Origin` | T6b only |

## 7. Edge cases and failure modes

| Case | Behaviour |
|---|---|
| Port busy, or held by another session | `portBusy`, banner, pairing disabled, no retry loop; saving Settings retries. |
| Port changed while a code is open | The code is cancelled first; the old string is dead. |
| Two pairs racing | Check, consume, create and save run in one synchronous block after the body read. |
| Clock | Monotonic for the code and the rate window; `suspend` cancels the code (S23). |
| `pairing.json` unreadable | Set aside, notice, unpaired. |
| Write fails on pair or unpair | S11. Residual: until a write succeeds, a restart restores the last saved list, so a revoked pairing can return. The panel line and the IPC text say so. |
| `settings.json` port edited by hand, or unreadable | Pairings on another port are ignored, not deleted (S12). |
| Quit with a pair in flight | A saved, undelivered pairing stays as a stale entry until the user unpairs it. |
| Handler bug | Socket destroyed, no bytes (S10). |
| Server `error` after `listening` | State `error`, banner, code cancelled. |
| Connection flood | `maxConnections` 16; availability is not defended. |

P16 (does `performance.now()` advance across sleep) is informational only.

## 8. Boundary A1↔A2 (one meaning each)

| Value | Meaning on both sides |
|---|---|
| Base URL | `http://127.0.0.1:<port>`, the port of the pairing string. |
| Pairing string | `<port>-<code>`: decimal 1024–65535 with no leading zero, one `-`, 8 alphabet symbols. A2 trims and upper-cases. A2 may map `O` to `0` and `I`/`L` to `1` (its choice, N15). |
| `label` | S20; A2 never sends an empty one. |
| Request bodies | Exactly the listed keys; `{}` where the table says so. |
| `token`, `pairingId`, `nonce`, `proofKey`, `proof` | Formats per S1 and S2. A2 uses the port it dialled; A1 uses `address().port`. |
| Proof freshness | A2 only (Q12). |
| `Origin` | `chrome-extension://<32 a–p>`. Several browsers may share it; each has its own token and `pairingId`. |
| `403 pairing_closed` | No code is open. |
| `401 bad_code` | Well-formed wrong code; one try used. |
| `404 unknown_pairing` | Id unknown or of another origin: "Not paired". |
| `401 bad_token` | Token missing, malformed, matching no pairing, or of another origin. |
| `403 bad_origin` on a token route | No pairing has this origin. It **can** follow a right proof (Unpair in between). A2 treats it as `401 bad_token`: "Not paired". |
| `429 rate_limited` | Over 300 token-route requests in the pairing's 60 s window. |
| `400 bad_request` | A client bug. |
| No response, socket closed | App bug or app quitting: A2's "no answer" row. |
| Size | A2 never sends a body over the route limit; A1's `413` may arrive as a reset. |
| `/v1/unpair` 200 | `{}`; revoked now. A2 deletes its token whatever the answer. |

## 9. Migration-class note (owner review)

- `DEFAULT_SETTINGS` gains `serverPort: DEFAULT_SERVER_PORT`.
- `SETTING_CHECKS` gains `serverPort: isServerPort`. `parseSettings` is driven by it, so its body does not change.
- `normalizeSettings`: an invalid port becomes the default, never clamped.
- The `setSettings` rebuild includes `serverPort`, uncoerced.
- `Store.loadSettings`, `loadSnapshot`, `parseSnapshotFile` and `parseJob` are unchanged; `jobs.json` `version` stays 1.
- `writeAtomic` moves with the same steps and `<path>.tmp` name.
- Old files load: an absent key takes the default, and nothing is rewritten at load. A Phase 1 build ignores the new key.

## 10. Tolerances (all PROVISIONAL)

| Rule | Value |
|---|---|
| Code lifetime (Q1) | 5 minutes plus 10 s grace, inclusive at 310 000 ms |
| Headers and whole-request deadlines (Q21) | 5 s and 10 s, checked every 1 s (up to 1 s late) |
| Rate window | 60 s fixed, 300 requests; up to 600 across an edge |
| Unsaved-pairing retry | Every 30 s, plus each change and quit |
| Listen result deadline | 3 s |
| Linger after an undrained refusal | 1 s |
| Settings poll | 1 s |
| Proof freshness | Not A1 (A2: 5 s) |

## 11. Rollback

- Revert the A1 commits. No data migration to undo.
- The old loader ignores `serverPort` and drops it at the next save.
- Delete `pairing.json`, `pairing.json.tmp` and `pairing.json.corrupt-*` from userData by hand: they hold key material.

## 12. Amendments

**None.** The frozen wire contract is unchanged: no new token, status or field.

Advisor decisions, **owner to confirm**:

| Item | Decided | Alternative |
|---|---|---|
| S10/S11 | No `500`. Disk failure is retried and shown in the app; a handler bug closes the socket. | Amend the contract with `500 internal_error`; A2 would show "Fetchly reported an error", and on `/v1/pair` the form with that text. |
| S7/S8 | `OPTIONS` before path; `Content-Length` required for `POST` only. | Path first. |
| S12 | Ignore at load. | Remove at once. |
| S5 | Refuse at 4. | Evict the oldest. |

A2's plan must carry the section 8 rows for `403 bad_origin` after a right proof and for "no response".

## 13. Critique r1 disposition

| Id | Disposition |
|---|---|
| B1 | Fixed as proposed: S4, S6, S6b; T4, T5, T7; P4 case (a). Limit stays 4. |
| B2 | Fixed without a contract change: S10, S11, section 12. |
| B3 | Fixed: S11 (unsaved flag; retry on change, every 30 s, at quit), IPC text, panel line, residual test. |
| B4 | Fixed: `start` is awaited before the handlers and the window; `RunningServer` type; 3 s listen deadline; T8. |
| B5 | Fixed: section 8 row, T7 test. |
| B6 | Fixed by rule: S13 and S18 make P17 and P15 not load-bearing; S23 covers P16. |
| N1 | Decided, PROVISIONAL (S7, S8); `Transfer-Encoding` refused for every method. |
| N2 | S21 and test. |
| N3 | S22 and tests. |
| N4 | Moved to T4, T8 and T9; the cancel rule is in S13. |
| N5 | S6c and test. |
| N6 | S15, S16 and T9 tests. `saveSettings` in `index.ts` is unchanged. |
| N7 | S14 and test. |
| N8 | `productionDeps()` test; port from `address().port`. |
| N9 | T6 tests; S19. |
| N10 | S9 and tests. |
| N11 | S20; S19 refuses unknown keys. |
| N12 | Decided, PROVISIONAL: S12, stricter than the proposal and without a `Store` change. |
| N13 | T6b covers error responses; PNA is P4 case (b); "any stored origin". P4 gates Task 6 onward; it is a manual browser run, so 6b stays conditional. |
| N14 | README and rollback. |
| N15 | Noted for A2 in section 8. |
| N16 | Stated in Task 9; manual lines in Task 10. |
## 14. Freeze addendum (critique round 2: no blocking gaps; items carried into the build)

The plan froze after critique round 2 found no blocking gap. These non-blocking findings are part of the contract for the tests and implementation lanes:

| Id | Rule to apply |
|---|---|
| R2-1 | Every port-change flow writes `pairing.json` unconditionally, even when the in-memory list is empty. T9 gets a test: a failed `pairing.json` write during a port change, a restart, and a change back to the first port never revives the removed pairings. |
| R2-2 | S16: at the 3 s listen deadline the pending server is closed and a late `listening` is discarded; T8's "never answers" case asserts no socket is left listening. |
| R2-3 | For A2's plan (not built here): any `fetch` rejection (refused, reset, abort, timeout) is "App not running"; A2 also defines rows for `400`, `403 bad_host`, `404`, `405` and `415` after a right proof. |
| R2-4 | S18: a `415` whose body is within the limit is drained like the other early answers; one test. |
| R2-5 | S10(b): "a handler throws or returns a rejected promise" closes the socket; test both. |
| R2-6 | `BIDI` lives in `src/shared/protocol.ts`, not `text.ts`, so `text.ts` exports only `CONTROL`. |
| R2-7 | Quit order: stop the listener first, then `flush()`; `stop` clears the 30 s retry timer. |
| R2-8 | P4 (browser) has not run at freeze. Tasks 1-5 may start; Task 6 onward waits for the P4 result, and Task 6b stays conditional on it. |

Owner confirmations still open (section 12, PROVISIONAL): S10/S11 no `500`; S7/S8 `OPTIONS` before path and `Content-Length` for `POST` only; S12 ignore mismatched pairings at load; S5 refuse a fifth pairing.
