# Fetchly Phase 2, Component A2: Extension Shell

> **For agentic workers:** work task by task, tests first. Steps use checkbox (`- [ ]`) syntax.

**Contract:** `docs/superpowers/plans/2026-11-22-phase2-architecture.md` ("the frozen plan") and `docs/superpowers/plans/2026-11-23-phase2-a1-server.md` §8, §12, §14 R2-3. Neither is edited. E-numbers mark where this plan is more specific. No wire type, token or status is added.

**Class:** SENSITIVE. The orchestrator stops before git; the owner reviews the diff line by line.

**Gates:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run build:ext`. The repo has no `AGENTS.md` or `.ai/`.

**Probes** (Chrome 158.0.8127.36, Edge 158.0.4370.33, Windows 11; files outside the repository):

| Probe | Result | Used in |
|---|---|---|
| P4 (Edge), P4c c1 (Chrome) | No preflight; body readable; `Host` is `127.0.0.1:<port>`; WebCrypto HMAC works. `cache: 'no-store'` adds one `Pragma` and one `Cache-Control` request header, which A1 accepts. | E4–E8 |
| P4c c2 (both) | `redirect: 'manual'` on a `307`: the fetch **resolves** with `status: 0`, `type: 'opaqueredirect'`, `body === null`. The redirect target received nothing. | E8b |
| P10 (both) | **FAIL** across a browser restart: `setAccessLevel` is not kept with the data, and a content script reads the token. | E9 |
| P10b (both) | **PASS**: a record in IndexedDB of the extension origin survives a worker restart and a browser restart, and no content script can read it. | E9 |

Not probed, covered only by the checklist: a persistent "Load unpacked" install across a browser restart (P10 c7), and "clear site data on close". CI covers unit tests only.

**Blockers:** none. Nothing under `src/**` changes.

## 1. Scope

**In**
- MV3 skeleton and build.
- `lib/client.ts`: hello, proof check, one token request.
- Pairing storage in IndexedDB.
- Service-worker message handlers.
- Popup: status, pairing form, Unpair, "Pair again".
- Arabic and English strings.

**Out (A3–A6)**
- Content script, button, context menu, toast, `/v1/handoff*`, cookies, `webRequest`, `/v1/logins`.
- A2's manifest has no `content_scripts`, `permissions: []` and host `http://127.0.0.1/*` only.
- A port field, a language switch, the Web Store, incognito.

**A2 deviations (PROVISIONAL, owner sign-off)**

| # | Deviation | Why |
|---|---|---|
| DV1 | The pairing record lives in IndexedDB of the extension origin, not `chrome.storage.local` (frozen §2 "Token theft"). | P10 fails; N32 allows the fallback; P10b passes. |
| DV2 | The manifest has `permissions: []`; frozen §4 lists `storage`. A3+ re-adds `storage` only with its own reason. | Nothing uses `chrome.storage`, so there is nothing to restrict. `README.md` states it. |

## 2. Files

| File | Change |
|---|---|
| `extension/manifest.json` (new) | Top-level keys exactly: `manifest_version` (3), `name` ("Fetchly"), `description`, `version` (equal to `package.json`), `action` (`default_popup: "popup.html"`), `background` (`service_worker: "service-worker.js"`, `type: "module"`), `permissions` (`[]`), `host_permissions` (`["http://127.0.0.1/*"]`), `incognito` (`"not_allowed"`). |
| `extension/vite.config.mjs` (new) | Root `extension`, out `extension/dist`. Inputs `popup.html`, `src/service-worker.ts`. `entryFileNames`, `chunkFileNames`: `[name].js`; `assetFileNames`: `[name][extname]`. `minify: false`, `sourcemap: false`, `modulePreload: { polyfill: false }`. An inline plugin emits `manifest.json` unchanged (`emitFile`) and, in `closeBundle`, fails the build if a file the manifest names is missing from `dist`. |
| `extension/popup.html`, `popup.css` (new) | Static markup; no inline script or handler. Inputs: pairing string `maxlength="64"`, label `maxlength="40"`. |
| `extension/src/service-worker.ts` (new) | Wiring only: real `chrome`, `fetch`, `crypto`, `indexedDB`, clocks and timers into the lib. |
| `extension/src/popup.ts` (new) | DOM glue only: feeds events to `popupModel`, renders with `textContent`. |
| `extension/src/lib/client.ts` (new) | Section 4. |
| `extension/src/lib/store.ts` (new) | `PairingRecord`, strict parse, IndexedDB backend (E9). |
| `extension/src/lib/messages.ts` (new) | Message and reply types, sender check, handlers, mutex. |
| `extension/src/lib/pairingInput.ts` (new) | `normalizePairingString`, `makeLabel`, `browserName`, `isAppVersion`. |
| `extension/src/lib/view.ts` (new) | Pure: reply to `{ title, hint, showForm, showUnpair }`. |
| `extension/src/lib/popupModel.ts` (new) | Pure popup state machine (E12). |
| `extension/src/lib/strings.ts` (new) | `EN`, `AR`, `pick(locale)`. |
| `tests/fakes/fake-chrome.ts` (new) | `runtime.id`, `getURL`, `onMessage` with a `dispatch(msg, sender)` helper, `i18n.getUILanguage`. **No storage.** |
| `tests/extension/fakeIdb.ts` (new) | Section 4, "fake". |
| `tests/extension/fakeFetch.ts`, `tests/extension/*.test.ts` (new) | Section 3. `fakeFetch` logs every request and scripts answers, rejections, hangs and stream errors. |
| `tsconfig.ext.json` (new) | Lib `ES2023`, `DOM`, `DOM.Iterable`; `types: ["chrome"]`; includes `extension/src/**/*`, `src/shared/protocol.ts`, `src/shared/text.ts`, `src/shared/i18n.ts`. |
| `package.json`, `package-lock.json` | `build:ext`: `vite build --config extension/vite.config.mjs`. `typecheck` gains `&& tsc --noEmit -p tsconfig.ext.json`. Dev dependency `@types/chrome` (the only one). |
| `.github/workflows/ci.yml` | One step, `npm run build:ext`, after `npm run build`. |
| `eslint.config.mjs` | `ignores` gains `extension/dist/**`. |
| `README.md`, `docs/manual-checklist-phase2.md` | Section 10. |

**Rule (E1):** `lib/*.ts` never names the globals `chrome`, `document`, `window` or `indexedDB`. Each file takes narrow, structurally typed interfaces, so it compiles under `tsconfig.node.json` (no DOM lib) and under `tsconfig.ext.json`, where the real objects must be assignable.

## 3. Tasks

Each task: write the failing tests, run them (FAIL), implement, run again (PASS), then `npm run typecheck` and `npm run lint`. No commit.

### Task 1: skeleton, build, manifest
**Files:** manifest, vite config, `tsconfig.ext.json`, `package.json`, eslint, CI, empty entries, `tests/extension/manifest.test.ts`.
- [ ] **Tests:**
  - The top-level key set and every value are exactly the section 2 row.
  - `popup.html` has no inline `<script>` body and no `on*=` attribute; the two `maxlength` values.
  - No file under `extension/src` contains `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval(`, `new Function`, `DEFAULT_SERVER_PORT`, `chrome.storage`, `localStorage`, `onMessageExternal`, `onConnectExternal` or `console.`.
- [ ] **Run:** `npx vitest run tests/extension/manifest.test.ts`; `npm run build:ext` (dist holds `manifest.json`, `popup.html`, `popup.js`, `service-worker.js`, unminified).

### Task 2: `pairingInput.ts`, `strings.ts`
**Files:** the two libs; `tests/extension/pairingInput.test.ts`, `strings.test.ts`.
- [ ] **Tests, pairing string (E2):**
  - Trimmed; only ASCII `a–z` upper-cased.
  - After the first `-` only: `O` becomes `0`, `I` and `L` become `1`. Then `parsePairingString`.
  - `it.each` null: no dash, port `1023`, `65536`, a leading zero, 7 or 9 symbols, `U`, inner spaces, a letter in the port, `ſ`, `ı`, empty, a non-string.
  - ` 38917-abcdefgh ` parses; `38917-OIL00000` parses as `01100000`.
- [ ] **Tests, label (E3):**
  - `browserName`: brands with `Microsoft Edge` give `Edge`; `Google Chrome` gives `Chrome`; else a UA with `Edg/` gives `Edge`; else `Browser`.
  - `makeLabel(input, fallback)`: every `CONTROL` and `BIDI` code point removed (global regexes built from `.source`; a string with three of each), trimmed, cut to 40 UTF-16 units with no lone surrogate, trimmed again. Empty gives the fallback.
  - `it.each` over hostile inputs: the output passes the real `isLabel` imported from `src/main/server/pairing.ts`.
- [ ] **Tests, `isAppVersion` (E11):** accepts `0.1.0` and a 64-unit string; rejects empty, 65 units, a non-string, a control or bidi character.
- [ ] **Tests, strings:**
  - `AR` has exactly `EN`'s key set; every value is non-empty; each equals its section 5 row.
  - `pick('ar-EG')` is `AR`; `pick('en-US')`, `pick('')`, `pick(undefined)` are `EN`, through `resolveLang('system', locale)`.
- [ ] **Run:** `npx vitest run tests/extension/pairingInput.test.ts tests/extension/strings.test.ts`

### Task 3: `client.ts`
**Files:** `client.ts`; `tests/extension/client.test.ts`, `fakeFetch.ts`. Injected: `fetch`, `subtle`, `getRandomValues`, `now` (monotonic), `wallNow`, `setTimer`, `clearTimer`, `store`, `limits`. The fake server computes proofs with `node:crypto`.
- [ ] **Tests, happy path:**
  - Exactly two requests, hello then the path, both to `http://127.0.0.1:<record.port>`.
  - Hello body is exactly `{ pairingId, nonce }`; the nonce is base64url of the 32 injected bytes; no `Authorization`.
  - The request carries `Authorization: Bearer <token>` and the JSON body.
  - Every request: `method: 'POST'`, `Content-Type: application/json`, `credentials: 'omit'`, `cache: 'no-store'`, `redirect: 'manual'`, `referrerPolicy: 'no-referrer'`.
  - Two calls: two nonces, two hellos.
  - Both `importKey` calls pass `extractable: false`.
- [ ] **Tests, nothing sent with the token** (one log entry, no `Authorization` anywhere):
  - A wrong proof; a right proof for port + 1; a proof for another nonce; 42 characters, padded, or not a string.
  - Hello `200` with an extra key, not JSON, an array, or over 64 KiB.
  - Hello `500`, `400`, `403 bad_origin`, `404 not_found`, a bare `404`: `wrong_program`.
  - Hello `status: 0`, `type: 'opaqueredirect'`, `body: null` (P4c): `wrong_program`.
  - Hello `404 unknown_pairing`: `unpaired`; the record is kept.
  - Hello rejects; hello's body stream errors mid-read: `app_not_running`.
  - Hello hangs: pending at 4999 ms, aborted at 5000 ms, `app_not_running`.
- [ ] **Tests, freshness (E7):**
  - Both clocks at 5000 ms since the nonce: the request is sent.
  - Monotonic 5001 with wall 100; wall 5001 with monotonic 100; wall −1: each `stale_proof`, one log entry.
  - A second `call` never reuses a proof.
- [ ] **Tests, after a right proof:**
  - `200` JSON object: `ok`.
  - `200` not JSON, or over 64 KiB: `refused`, status 200, token null.
  - `it.each` `401 bad_token`, `403 bad_origin`, `429 rate_limited`, `429 busy`, `503 not_ready`, bare `500`, `400 bad_request`, `403 bad_host`, `404 not_found`, `405 method_not_allowed`, `415 bad_content_type`, `413 too_large`: `refused` with that status and token.
  - A token outside the runtime `ERROR_TOKENS` list: token null.
  - Status 0 opaque redirect: `refused`, status 0, token null; no third request.
  - The request rejects, its body stream errors, or it hangs to 5000 ms: `app_not_running`; no retry.
- [ ] **Tests, `call` and the record (E8f):**
  - No record: `not_paired`, nothing sent. A store failure: `storage_blocked`, nothing sent.
  - `401 bad_token` or `403 bad_origin` after a right proof: `store.removeIf(pairingId used)` runs once.
  - The same answer when the stored record now has another `pairingId`: that record stays.
  - `callWith` never removes anything.
- [ ] **Tests, guards (nothing sent):**
  - A path that is `/v1/pair`, `/v1/hello`, or fails `^/v1/[a-z/]+$`: throws a fixed message.
  - A body of `BODY_LIMIT + 1` UTF-8 bytes: `too_large_local`; exactly `BODY_LIMIT` is sent.
  - With `limits: { '/v1/x': 100 }`, 101 bytes to `/v1/x` are refused and another path keeps `BODY_LIMIT`.
  - With a marker token, no thrown or rejected error's message holds the marker, the `pairingId` or the port.
- [ ] **Tests, `pair`:**
  - One request to the given port, body exactly `{ code, label }`, no `Authorization`.
  - `200` valid: `{ ok: true, pairingId, token, appVersion }`.
  - `token` or `pairingId` failing its regex, not JSON, an array, status 0, any other status: `wrong_program`.
  - Valid `token` and `pairingId` but `protocol !== 1`, `appVersion` failing `isAppVersion`, or an extra or missing key: `{ ok: false, kind: 'mismatch', pairingId, token }`.
  - `401 bad_code`, `403 pairing_closed`, `400 bad_request`: returned as tokens.
  - A rejection or a hang: `app_not_running`.
- [ ] **Run:** `npx vitest run tests/extension/client.test.ts`

### Task 4: `view.ts`, `popupModel.ts`
**Files:** the two libs; `tests/extension/view.test.ts`, `popupModel.test.ts`.
- [ ] **Tests, view:** one `it.each` row per section 5 state: title in both languages, `showForm`, `showUnpair` (only when `paired`). "Pair again" is present in every state.
- [ ] **Tests, model (E12, injected timer):**
  - Open sends `status` with sequence 1 and shows `checking`.
  - At 4999 ms no buttons; at 5000 ms **Check again** and **Pair again** show while the wait goes on.
  - A reply for the current sequence renders; a reply for an older sequence is ignored.
  - A rejected send, an `undefined` reply, or no reply at 30 000 ms: `interrupted`.
  - A pair reply `checking` sends a new `status`.
  - "Pair again" shows the form and sends nothing.
- [ ] **Run:** `npx vitest run tests/extension/view.test.ts tests/extension/popupModel.test.ts`

### Task 5: `store.ts` on IndexedDB
**Files:** `store.ts`; `tests/extension/store.test.ts`, `fakeIdb.ts`.
- [ ] **Tests:**
  - The first open creates `kv`; a round trip keeps the exact record.
  - `it.each` reads as none and deletes the key in the same readwrite transaction: `v: 2`; a missing or extra key; a 42-character token; a 21-character id; port `80` or `"38917"`; a 41-unit label; a bad `appVersion`; a non-finite `pairedAt`; an array; a string.
  - `write` resolves only at transaction `oncomplete`: pending after the request's `onsuccess`.
  - `storage_blocked`: factory `undefined`; `open()` throws; `onerror`; `onerror` with `VersionError`; `onblocked`; an open that never settles (pending at 2999 ms, answered at 3000 ms; a late success is closed).
  - `storage_failed`: transaction `onabort` (quota); `transaction()` throws; a transaction that never completes (at 3000 ms `abort()` is called).
  - `onversionchange` closes the connection.
  - `removeIf(id)` removes only when the stored `pairingId` equals `id`, in one transaction. `clear` on an empty store succeeds.
  - The log shows only `fetchly`/`kv`/`pairing`.
- [ ] **Run:** `npx vitest run tests/extension/store.test.ts`

### Task 6: `messages.ts`, `service-worker.ts`, `popup.ts`
**Files:** the three; `tests/extension/messages.test.ts`, `flow.test.ts`.
- [ ] **Tests, sender and shape** (the listener returns `false`, no reply, nothing fetched or stored):
  - `sender.id` differs; `sender.url` is not `getURL('popup.html')`; `sender.tab` is defined.
  - An unknown `type`; an extra key; `pairingString` or `label` not a string; a non-object.
  - An accepted message makes the listener return `true`.
  - A `pairingString` over 64 units or a `label` over 64: accepted, `badInput`, nothing sent.
- [ ] **Tests, secrecy:**
  - With a marker token, the JSON of every reply in every outcome never holds the marker, the `pairingId` or the port.
  - No message type accepts or returns a token.
  - The IDB log shows no key but `pairing`.
- [ ] **Tests, status:** every section 5 row from a scripted fake server, with its record column. A `200` with a wrong `engine`, a bad `appVersion` or an extra key: `mismatch`.
- [ ] **Tests, pair:**
  - The port dialled is the string's, also when a stored record holds another.
  - An unparsable string: `badInput`, nothing sent.
  - A real `store.read()` (open plus a readwrite transaction) runs **before** any fetch; when it fails: `storageBlocked`, nothing sent.
  - Success writes `{ v: 1, pairingId, token, port, appVersion, label, pairedAt }`, then replies `checking`; the reply comes before any other request.
  - A failed write: one best-effort `/v1/unpair` with the new credentials, **then** `storageFailed`.
  - `mismatch` from `pair`: one best-effort `/v1/unpair` with the new credentials, nothing stored, `mismatch`.
  - Replace (E13): no unpair of the old record at pair time. After the next status with a right proof and `200`, exactly one hello and one `/v1/unpair` go to the old record's port, after the reply. A status answering `wrong_program` sends none. A failure there changes nothing.
  - Two pair messages at once run one after the other.
- [ ] **Tests, unpair:**
  - Hello and `/v1/unpair`, then the record is removed.
  - `it.each` removes it whatever the answer (`200`, `401`, wrong proof, rejection, hang); every answer but `200` adds the note `unpairedLocalOnly`.
  - No record: nothing sent, `notPaired`.
- [ ] **Tests, race (N1):** a status in flight on record A; a pair stores record B; A's status then gets `401 bad_token`: B stays.
- [ ] **Tests, restart (`flow.test.ts`):**
  - A new handler set over the same fake IDB answers `connected`.
  - A pair whose reply is never delivered still leaves the record stored.
  - The pair `200` arrives and the write never completes; a new handler set over the same IDB answers `notPaired` without throwing.
- [ ] **Implement, `popup.ts`:** sets `lang` and `dir` on `<html>`; wires `popupModel`; no logic of its own. Manual lines in section 10.
- [ ] **Run:** `npx vitest run tests/extension`

### Task 7: docs and gates
- [ ] `README.md` and `docs/manual-checklist-phase2.md` per section 10.
- [ ] **Run:** `npx vitest run tests/extension`, then the five gates, serially.

## 4. `lib/client.ts` contract

```ts
type CallResult =
  | { ok: true; value: Record<string, unknown> }  // right proof, then 200 with a JSON object
  | { ok: false; kind: 'not_paired' }             // no stored record; nothing sent
  | { ok: false; kind: 'storage_blocked' }        // the record could not be read; nothing sent
  | { ok: false; kind: 'app_not_running' }        // any fetch rejection, stream error or 5 s abort (R2-3)
  | { ok: false; kind: 'wrong_program' }          // hello: not JSON, any status but 200 or 404 unknown_pairing, bad shape, wrong proof
  | { ok: false; kind: 'unpaired' }               // hello 404 { error: 'unknown_pairing' }
  | { ok: false; kind: 'stale_proof' }            // E7; the request was not made
  | { ok: false; kind: 'too_large_local' }        // nothing sent
  | { ok: false; kind: 'refused'; status: number; token: ErrorToken | null };

createClient(deps): {
  call(path: string, body: object): Promise<CallResult>;                           // A3 uses only this
  callWith(record: PairingRecord, path: string, body: object): Promise<CallResult>; // unpair paths only; never deletes
  pair(port: number, code: string, label: string): Promise<PairResult>;
}
```

| # | A2 decision |
|---|---|
| E4 | **One hello per call.** The nonce is 32 bytes of `getRandomValues`, base64url. `const port = record.port` is the only port value for both URLs and `helloInput`. |
| E5 | **Keys (A1 S1, S2).** `importKey('raw', ASCII(token), HMAC-SHA-256, false, ['sign'])`; `sign(PROOF_KEY_LABEL)`; the 32 bytes are imported with `extractable: false`, `['verify']`. Derived per call, never stored. |
| E6 | **Proof check.** A string matching `^[A-Za-z0-9_-]{43}$` that decodes to 32 bytes, then `subtle.verify`. No string compare of MACs. |
| E7 | **Freshness (Q12).** `t0 = now()` and `w0 = wallNow()` are taken when the nonce is made, before the hello is sent. Just before the token request: `now() - t0 > 5000`, or `wallNow() - w0 > 5000`, or `wallNow() - w0 < 0`, gives `stale_proof`. Two clocks, because the monotonic one may stop during sleep. |
| E8 | **Timeout (Q20).** One `AbortController` and a 5000 ms timer per fetch, headers and body. Bodies are read from the stream with a 64 KiB cap; over the cap, or a `null` body, is "not JSON". |
| E8b | **`redirect: 'manual'`** (P4c). A redirect is never followed. Status 0 is "another status": `wrong_program` at hello, `refused` after a proof. |
| E8c | **Token in memory.** Read inside `call`, held in locals. No cache; the one exception is E13. |
| E8d | **Who may call.** Only service-worker code imports `client.ts`. Popup messages: `fetchly:status {}`, `fetchly:pair { pairingString, label }`, `fetchly:unpair {}`. Reply: `{ state, paired, appVersion?, note? }`. The handler requires `sender.id === runtime.id`, `sender.url === getURL('popup.html')`, `sender.tab === undefined` and the exact key set. A3 adds its own types with its own sender rule. |
| E8e | **No retry inside `call`.** |
| E8f | **Deleting on a server answer lives in `call`.** After a right proof, `401 bad_token` or `403 bad_origin` runs `store.removeIf(pairingId used)`. A3 inherits it by using `call`. |
| E8g | **Tokens and limits.** `ERROR_TOKENS: Record<ErrorToken, true>` is the runtime list; the compiler keeps it exhaustive. The body guard reads `deps.limits[path] ?? BODY_LIMIT`; A3 passes `{ '/v1/handoff': LARGE_BODY_LIMIT }`. |
| E11 | **`appVersion` and `engine`** (pair and status alike): `appVersion` is a non-empty string of at most 64 UTF-16 units with no `CONTROL` or `BIDI`; `engine` is `notInstalled`, `starting`, `ready` or `error`. A1 sends `app.getVersion()` with no length rule, so the cap is generous. |

**Storage (E9, N32)**

- Database `fetchly`, version 1, store `kv`, key `pairing`, opened in the service worker only. A content script runs in the page's origin and cannot open it (P10b).
- `createStore({ idb, setTimer, clearTimer })` gives `read`, `write`, `removeIf(pairingId)`, `clear`. Each answers `{ ok: true, value }`, `storage_blocked` (cannot open) or `storage_failed` (transaction did not commit).
- Each operation opens, runs one readwrite transaction and closes. One 3000 ms deadline covers it: before the open settles it answers `storage_blocked`; after, it calls `abort()` and answers `storage_failed`.
- **Fail closed:** when `read` fails, no `/v1/pair` is sent and the popup shows `storageBlocked`.
- **Fake (`fakeIdb.ts`) models only:** `open(name, version)` with `onupgradeneeded`, `onsuccess`, `onerror`, `onblocked`, `result`, `error`; the database's `objectStoreNames.contains`, `createObjectStore`, `transaction(name, mode)`, `close`, `onversionchange`; the transaction's `objectStore`, `oncomplete`, `onabort`, `onerror`, `abort`; the store's `get`, `put(value, key)`, `delete`. Switches for each failure in Task 5, a held `oncomplete`, an operation log, and a backing map shared by instances (a restart).

## 5. Popup states and pairing

Strings are TS tables in `lib/strings.ts`, not `_locales`. The language is `resolveLang('system', chrome.i18n.getUILanguage())`, the direction `dirOf(lang)`; there is no switch. The pairing input and the version are `dir="ltr"`.

| Fact | State | Stored record |
|---|---|---|
| No record, or one of another shape | `notPaired` (form) | The odd shape is removed. |
| Hello or request rejects, or 5 s pass | `appNotRunning` | Kept. |
| Hello `404 unknown_pairing` | `notPaired` (form) | **Kept** (E10). |
| Right proof, then `401 bad_token` or `403 bad_origin` | `notPaired` (form) | Removed if still the same pairing (E8f). |
| Hello not JSON, another status, bad shape, wrong proof | `wrongProgram` | Kept. |
| Right proof, then `200` of exactly `{ app: 'fetchly', protocol: 1, appVersion, engine }` (E11) | `connected` | Kept. |
| `429 rate_limited` | `rateLimited` | Kept. |
| `5xx`; or a right proof then `200` that is not JSON | `appError` | Kept. |
| R2-3: right proof, then `400`, `403 bad_host`, `404`, `405`, `415`, `413`, `429 busy`, status 0, any other status, or a `200` of the wrong shape | `mismatch` | Kept. |
| `stale_proof` | `slow` | Kept. |
| The store cannot be read | `storageBlocked` | Unknown. |
| No reply from the worker in 30 s | `interrupted` | Unknown. |

**E10.** A hello `404` is unauthenticated, so it deletes nothing. The record is replaced only by a successful pair, by Unpair, or after a right proof.

**Pairing** (under the mutex)
1. Normalise the string (E2); null gives `badInput`. The label is `makeLabel(field, browserName())`.
2. `old = store.read()`; a failure gives `storageBlocked`.
3. `pair(port, code, label)`.
4. `200` valid: write the record at once. Reply `checking`; the popup then sends `status`.
5. Results: `bad_code` gives `wrongCode`; `pairing_closed` gives `pairingClosed`; `400` or `mismatch` gives `mismatch`; a rejection gives `appNotRunning`; anything else gives `wrongProgram`.

**E13, replacing a pairing.** The handler set keeps the replaced record in memory. The first status that ends `connected` replies, then makes one best-effort `callWith(old, '/v1/unpair', {})` and forgets it. A listener that only answers a shape-valid `200` therefore cannot make A2 unpair the old browser entry. Residual: the local record is already overwritten, and a worker stop loses the old one; the user unpairs the stale entry in Settings.

**Unpair:** `callWith(record, '/v1/unpair', {})`, then `removeIf`, whatever the answer.

**E12, timing.** Worst case before a reply: status 16 s, unpair 16 s, pair 11 s, or 21 s when the write fails. All are under the popup's 30 s and the worker's 30 s idle limit. The E13 tail (up to 10 s) is best-effort.

**Strings (N14, N26; reused by A3)**

| Key | English | Arabic |
|---|---|---|
| `checking` | Checking… | جارٍ التحقق… |
| `notPaired` | Not paired | غير مربوط |
| `notPairedHint` | In Fetchly, open Settings, press Pair a browser, then type the code here. | في Fetchly افتح الإعدادات واضغط «ربط متصفح»، ثم اكتب الرمز هنا. |
| `appNotRunning` | Fetchly is not running | Fetchly لا يعمل |
| `appNotRunningHint` | Start Fetchly. If you changed its port, pair again. | شغّل Fetchly. إذا غيّرت المنفذ، اربط من جديد. |
| `wrongProgram` | Another program uses this port | برنامج آخر يستخدم هذا المنفذ |
| `connected` | Connected | متصل |
| `version` | Fetchly version | إصدار Fetchly |
| `rateLimited` | Fetchly is busy. Try again in a minute. | Fetchly مشغول. حاول مرة أخرى بعد دقيقة. |
| `busy` (A3 toast only) | Fetchly is showing another link | Fetchly يعرض رابطًا آخر |
| `appError` | Fetchly reported an error | Fetchly أبلغ عن خطأ |
| `mismatch` | This extension and Fetchly do not match. Update both. | هذه الإضافة و Fetchly غير متوافقين. حدّثهما معًا. |
| `slow` | That took too long. Press Check again. | استغرق ذلك وقتًا طويلًا. اضغط «تحقق مرة أخرى». |
| `storageBlocked` | This browser cannot keep the pairing safely | هذا المتصفح لا يستطيع حفظ الربط بأمان |
| `storageFailed` | The pairing could not be saved. Pair again. | تعذّر حفظ الربط. اربط من جديد. |
| `interrupted` | No answer from the extension. If you were pairing, pair again, then remove the extra browser in Fetchly Settings. | لا رد من الإضافة. إذا كنت تربط، اربط من جديد ثم احذف المتصفح الزائد من إعدادات Fetchly. |
| `badInput` | That is not a pairing code. It looks like 38917-ABCD2345. | هذا ليس رمز ربط. شكله مثل 38917-ABCD2345. |
| `wrongCode` | Wrong code. Check it and try again. | الرمز غير صحيح. راجعه وحاول مرة أخرى. |
| `pairingClosed` | No code is open in Fetchly, or it expired. Press Pair a browser again. | لا يوجد رمز مفتوح في Fetchly أو انتهت صلاحيته. اضغط «ربط متصفح» من جديد. |
| `unpairedLocalOnly` | Removed here. If Fetchly still lists this browser, unpair it in Settings. | حُذف هنا. إذا ظل هذا المتصفح في قائمة Fetchly، ألغِ ربطه من الإعدادات. |
| `codeLabel` | Pairing code | رمز الربط |
| `nameLabel` | Browser name | اسم المتصفح |
| `pairButton` | Pair | ربط |
| `pairAgain` | Pair again | ربط من جديد |
| `checkAgain` | Check again | تحقق مرة أخرى |
| `unpair` | Unpair | إلغاء الربط |

`busy` and `rateLimited` are told apart by token, never by status.

**N27, A2's part.** The port comes only from the pairing string and lives only in the record. After a port change in the app, the popup shows `appNotRunning` with its hint.

## 6. Acceptance map

| Requirement | Test |
|---|---|
| Every frozen popup-state row | T4 view, T6 status |
| `429 busy` and `429 rate_limited` told apart by token | T3, T6 |
| Wrong proof, or a right proof for another port: no `Authorization`, no cookies | T3 nothing-sent |
| A proof older than the limit is not reused | T3 freshness |
| The port comes only from the pairing string | T6 pair, T1 grep |
| Token never in a runtime message | T6 secrecy |
| Manifest schema | T1 |
| A1 §8: `403 bad_origin` after a right proof; no response; unpair deletes whatever the answer; label never empty; size | T3, T6, T2 |
| R2-3 rows | T3, T6 status |
| N32 fail closed; record out of reach of content scripts | T5, T6 pair, T1 grep, P10b, checklist 11–12 |
| A2 edge cases (worker restart mid-pairing, folder moved, app closed mid-call) | T6 restart, checklist 8, T3 |

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Worker killed between the `/v1/pair` answer and the write | The token is lost; the popup shows `interrupted`. The app keeps a stale entry until the user unpairs it. |
| Popup closed mid-pair | The worker finishes and stores the record. |
| Extension folder moved | A new id and an empty database: `notPaired`. The old entry is stale. |
| App closed between hello and the request | `appNotRunning`; no retry. Residual as frozen, bounded by Q12. |
| PC sleeps between hello and the request | `stale_proof` by the wall clock (E7). |
| Two popups, or a double click | The mutex; the second pair gets `pairing_closed`. |
| A status in flight while another popup pairs | `removeIf` keeps the newer record (N1). |
| The write fails after a `200` | One best-effort unpair, then `storageFailed`. |
| `/v1/pair` `200` with a bad `appVersion` | One best-effort unpair, nothing stored, `mismatch`. |
| A newer database version (a downgrade) | `storageBlocked`; removing the extension clears it. |
| A hostile listener: huge or slow body, redirect | The 64 KiB cap, the 5 s abort, status 0. |

## 8. Boundaries (one meaning each)

**A1↔A2**

| Value | Meaning on both sides |
|---|---|
| Base URL | `http://127.0.0.1:<port>`, the port of the pairing string, kept in the record. |
| Pairing string | `parsePairingString` after E2. |
| `label` | A1's S20, guaranteed by `makeLabel` and tested with A1's `isLabel`. |
| Bodies | Exact keys; `{}` for status and unpair. |
| `token`, `pairingId`, `nonce`, `proof`, `proofKey` | S1, S2; E4–E6. |
| `appVersion`, `engine` | A1 sends `app.getVersion()` and `EngineStatus['state']`; A2 accepts E11. A longer version is `mismatch`, never a silent loss. |
| Request headers | The browser adds `Origin`, `Pragma`, `Cache-Control`; A1 counts duplicates of `Host`, `Origin`, `Authorization`, `Content-Type` only. |
| `pairing_closed`, `bad_code`, `unknown_pairing`, `bad_token`, `rate_limited`, `bad_request` | The A1 §8 meanings. |
| `403 bad_origin` on a token route | As `401 bad_token`. |
| No response | `app_not_running`. |
| `/v1/unpair` | The local record is removed whatever the answer. |

**A2↔A3**

| A3 consumes | Meaning |
|---|---|
| `call(path, body)` | One hello, at most one token request, no retry. It alone deletes the record (E8f); A3 never deletes. |
| `refused.token` | The server's token: `busy` means the slot is in use; `rate_limited` means over 300 a minute. |
| `limits` | The path-to-limit table (E8g). |
| The record | Read only inside `call`. A content script never gets the token, the `pairingId` or the port. |
| Messages | The `fetchly:` prefix and exact key sets. A2's three types are popup-only (`sender.tab === undefined`). |
| Permissions | A2 ships none; A3 adds its own and does not need `storage` for the record. |
| `busy`, `rateLimited`, `pick()`, `view.ts` | The section 5 texts. |

## 9. Tolerances (all PROVISIONAL owner questions, none 0)

| Rule | Default |
|---|---|
| Proof freshness (Q12) | 5000 ms from the nonce, inclusive, on both clocks |
| Request timeout (Q20) | 5000 ms per fetch |
| Response body cap | 64 KiB |
| IndexedDB operation deadline (new) | 3000 ms, open and transaction together |
| `appVersion` length cap (new) | 64 UTF-16 units |
| Popup "Checking…" before it offers Check again | 5 s; no automatic retry |
| Popup gives up waiting for a reply (new) | 30 s |
| Best-effort unpair | One attempt |

Also open for the owner, decided here: DV1, DV2, E10, E13, the `mismatch` state (alternative: fold into `appError`), freshness counted from the nonce (alternative: from the hello body read), no language switch.

## 10. Docs

**`docs/manual-checklist-phase2.md`, section "A2: extension shell"**
1. `npm run build:ext`; Load unpacked on `extension/dist` in Chrome and Edge. "Not paired" in the browser's language; Arabic is right-to-left.
2. Pair with the string typed in lower case and with `O` for `0`: Connected; the label is listed in Fetchly.
3. A wrong code once: "Wrong code". Five times, then the right code: "No code is open".
4. Close Fetchly: "Fetchly is not running" within 5 s.
5. With Fetchly closed, `python -m http.server <port> --bind 127.0.0.1`: "Another program uses this port"; its log shows no `Authorization`.
6. A listener answering `307` to a second port: "Another program uses this port"; the second port receives nothing.
7. Unpair in the popup: the entry leaves Settings. With Fetchly closed: unpaired here, the entry stays.
8. Move the `extension` folder and load again: "Not paired".
9. Change the port in Fetchly: "not running … pair again"; pairing again works.
10. Restart the browser with the unpacked extension kept: still Connected (the unprobed case).
11. DevTools → Application → Extension storage is empty; the record is under IndexedDB `fetchly`.
12. After A3: from a content-script console, `indexedDB.open('fetchly')` shows no `kv` store.
13. With "clear site data on close" on: note whether the pairing survives a restart.
14. Row 16 of the A1 section (both browsers from one folder).

**`README.md`** (the living doc for DV1 and DV2)
- Build and load steps.
- The extension asks for no permission but `http://127.0.0.1`; the pairing is kept in the extension's own IndexedDB.
- Moving the folder or changing the port means pairing again.
- The token is readable by same-user programs.
- The popup follows the browser's language.
- Stale entries are removed in Settings → Browser.

## 11. Rollback

- Revert the A2 commits; nothing under `src/**` changed.
- Remove the unpacked extension from each browser: that deletes its IndexedDB and token.
- Unpair the leftover entries in Settings → Browser.
- No data migration.

## 12. Critique r1 disposition

| Id | Disposition |
|---|---|
| B1 | Fixed as proposed. E9a removed; no `chrome.storage`, no `setAccessLevel`; Task 5 rewritten for IndexedDB with an injected factory; `fakeIdb.ts` listed; `fake-chrome.ts` has no storage; T1 greps; checklist 10–13. |
| B2 | Fixed: DV1 and DV2 for owner sign-off; README is the living doc; T1 asserts `permissions: []`. |
| B3 | Fixed: E7 uses two clocks from the nonce; tests per clock and for a negative delta. |
| B4 | Fixed: E11, one rule for pair and status; `mismatch` with a best-effort unpair; tests. |
| N1 | Fixed: `removeIf(pairingId)` in one transaction; race test. |
| N2 | Fixed: the rule lives in `call` (E8f), stated in §8. |
| N3 | Fixed: `ERROR_TOKENS` (E8g). |
| N4 | Fixed: global regexes, the real `isLabel`, a second trim. |
| N5 | Fixed: ASCII-only upper-casing; `ſ` and `ı` are null. |
| N6 | Fixed: `sender.tab === undefined`; `true` only when accepted; over-long strings answer `badInput`; `maxlength` set. |
| N7 | Fixed: E13. |
| N8 | Fixed: unpair before `storageFailed`; reply before the old-record unpair; durations in E12. |
| N9 | Answered by P4c (header); tests and checklist row 6 kept. |
| N10 | Answered by P4c in Chrome 158 with the exact init (header). |
| N11 | Fixed: E5. |
| N12 | Fixed: stream-error and over-cap tests in T3. |
| N13 | Fixed: `limits` table (E8g). |
| N14 | Fixed: full table in §5. |
| N15 | Fixed: `popupModel.ts` with tests. |
| N16 | Fixed: `emitFile` plugin, `minify: false`, `modulePreload`, the `closeBundle` check, the exact key list. |
| N17 | Fixed: T6 restart, third case. |
| N18 | Fixed, stricter: no `console.` anywhere under `extension/src`; error-message test in T3. |
## 13. Freeze addendum (critique round 2: no blocking gaps; items carried into the build)

The plan froze after critique round 2 found no blocking gap. These non-blocking findings are part of the contract for the tests and implementation lanes:

| Id | Rule to apply |
|---|---|
| R2-1 | Every reply carries `paired`: "a record is stored after this operation". Per §5 row: the E10 row (hello `404 unknown_pairing`, record kept) is `notPaired` with the form **and** Unpair (`paired: true`); a removal after a right proof gives `paired: false`; `storageBlocked` and `interrupted` give `paired: false`; every row that keeps the record gives `paired: true`. `showUnpair` equals `paired`. T4 and T6 status assert it per row. |
| R2-2 | The `badInput` example code is wrapped in `fsi()` from `src/shared/i18n.ts` in both languages; the strings test asserts the isolate characters around it. Checklist row 1 adds: in Arabic the example reads port first. |
| R2-3 | Task order is 1, 2, 5 (`store.ts`), 3 (`client.ts`), 4, 6. The popup reply type lives in `view.ts` (or a `lib/types.ts`), and `messages.ts` imports it. |
| R2-4 | Narrow IndexedDB handler properties are typed `((ev: never) => unknown) \| null` so the real DOM objects are assignable; if that still fails under `tsconfig.ext.json`, a typed adapter in `service-worker.ts` with no logic is allowed and is not a deviation. |
| R2-5 | Write transactions are opened with `{ durability: 'strict' }`; the fake models the third argument and a test asserts it on `write`, `removeIf` and `clear`. |
| R2-6 | Unpair whose `removeIf` answers `storage_failed` replies `storageFailed` with `paired: true`; one test. |
| R2-7 | The `closeBundle` check also fails the build on an inline `<script>` body or an `on*=` attribute in the emitted `dist/popup.html`, and on a chunk whose name collides with `popup.js` or `service-worker.js`. |
| R2-8 | The E13 old record held in memory is dropped on a second pair, on Unpair and on any `removeIf`, not only after a `connected` status. One test: after an Unpair of the new record, nothing is ever sent to the old record's port. |

Probe record for this freeze (orchestrator, 2026-11-23; files under `%LOCALAPPDATA%\fetchly-probes\p10\` and `p4c\`, outside the repository): Chrome **158.0.8127.36** and Edge **158.0.4370.33** on Windows 11 Pro 10.0.26100, `--headless=new`, CDP `Extensions.loadUnpacked`, one process per case. P10: PASS across a worker restart, FAIL across a browser restart with a re-load. P10b (IndexedDB): PASS across both, unreadable by content scripts. P4c: no preflight in Chrome; `redirect: 'manual'` resolves with status 0 and the target receives nothing, in both browsers.

Owner confirmations still open (PROVISIONAL): DV1, DV2, E10, E13, the `mismatch` state, freshness from the nonce, no language switch, and every §9 tolerance.
