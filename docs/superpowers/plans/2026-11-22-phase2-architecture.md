# Fetchly Phase 2 (extension + local server): Architecture and Scope Plan

**Goal:** A Chrome/Edge MV3 extension hands links, media candidates and (on explicit consent) site cookies to the running app over a paired, mutually authenticated loopback HTTP connection; the app opens its normal add dialog.

**Spec:** `docs/superpowers/specs/2026-11-22-download-manager-design.md`. The spec and `docs/superpowers/plans/**` are history and are never edited. Living docs are `README.md` and the new `docs/manual-checklist-phase2.md`.

**This plan fixes** the shape, the split, every cross-component interface and the order. Each component gets its own plan (max 3 critique rounds). The repo has no `AGENTS.md` or `.ai/`. Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, plus the new `npm run build:ext`.

## 1. Scope

**In:** A1 local server, A2 extension shell, A3 hand-off, A4 media fallback, A5 one-shot cookies, A6 stored logins.

**Out:** Phase 3 courses; DRM bypass; own site clients; anything but `127.0.0.1`; queuing in the extension; Web Store, Firefox, incognito; reading browser cookie databases; login listing or deletion over HTTP; cookies for aria2; stored logins for file jobs; a port field in the popup.

**Deviations from the spec (need owner sign-off, Q10)**

| # | Deviation | Why |
|---|---|---|
| D1 | Every endpoint is `POST` with JSON. | A POST always carries `Origin`; a JSON POST from a web page needs a preflight, which is refused. |
| D2 | Hand-off is asynchronous: accept, then short polls answered at once. | A probe can outlast one request; no dependence on service-worker lifetime. |
| D3 | Several pairings (Chrome and Edge), each bound to its own origin. | The spec names both browsers. |
| D4 | Referer/User-Agent plumbing lands in A3, not A4. | The context menu already sends them. |
| D5 | A file job that needed cookies runs through yt-dlp (`--cookies`, `--use-extractors generic`) on one connection. aria2 never receives a cookie. | aria2 only takes a flat `Cookie` header; yt-dlp's jar matches per request (Q11). Probed: P7d, P7e, P7g, P7h. |
| D6 | New `/v1/hello`: the server proves itself, bound to the dialled port, before the extension sends the token or cookies. | Another process can bind or relay a port. |
| D7 | The Referer kept and sent is origin + path only. | It is saved in `jobs.json` and may hold query tokens. |
| D8 | The port is part of the pairing: the app shows `<port>-<code>`, and changing the port means pairing again. | A free port field lets a relay capture the code and token (Q19). |

## 2. Architecture and trust boundaries

```
web page ──DOM── content script ──runtime msg── service worker ──HTTP POST 127.0.0.1── server (main) ── hand-off/queue ──argv + temp file── yt-dlp
                                     popup ──────┘                                        │ IPC (validated)        └─ aria2 (never cookies)
                                                                                      renderer
```

| Boundary | Receiver validates |
|---|---|
| Page to content script | Nothing is read from page script. The button sits in a closed shadow root; its click handler requires `event.isTrusted`. |
| Content script or popup to service worker | `sender.id === chrome.runtime.id`; message shape. The button message carries no URL: the service worker takes `sender.tab.url` and `sender.tab.title`. The content script never sees the token or cookies. |
| Service worker to server | The server's proof is checked first. Then the server checks host, method, origin, content type, size, token, rate and body shape (section 3). |
| Server to main | Typed, validated values only. Cookies stay in main memory or `safeStorage`. |
| Main to renderer | A payload-free wake-up; the renderer pulls `handoffId`, url and `ProbeResult`. |
| Renderer to main (`add`) | For a non-null `handoffId`, main uses the url and `ProbeResult` it stored and ignores the renderer's. |
| Main to yt-dlp / aria2 | One argv element or RPC option per value, no shell, `--` before every URL. Cookies only in a temp file for yt-dlp. |

**Threat model**

| Threat | Defence | Residual |
|---|---|---|
| Malicious web page | Origin must be a paired `chrome-extension://` origin; `OPTIONS` refused; no CORS headers. | Learns that a port is open. |
| Malicious other extension | Its origin is not paired; pairing needs the code and is closed unless the user opened it. | While pairing is open it can burn the 5 tries. |
| Fake listener on the app's port | Token and cookies are sent only after a fresh proof. Pairing is offered only while the server is `listening`, and the popup dials the port in the pairing string. P13: while the app listens, a same-user binder on `127.0.0.1` fails and a wildcard binder gets no loopback traffic. | A fake that binds first makes the app `portBusy`; nothing is sent to it. The app exits and a fake binds between a proof and its request (bounded by Q12). |
| Relay on another port | The proof's HMAC input holds the port: the extension uses the port it dialled, the server its real listening port. | None known. |
| Other local process, same user | Token check; the app keeps only derived values of the token. | **Not defended:** same-user code can read the extension profile and `pairing.json`. Stated in the README. |
| Other Windows user | Loopback bind, token, port-bound proof; profile ACL on `pairing.json`; DPAPI is per user. | **Not probed:** another user's socket sharing the port while the app listens. If Windows allowed it, a same-port relay would pass the proof. Accepted for a single-user spec; optional probe P13b. |
| Local denial of service | No lockout is keyed on unauthenticated input. | Any local process can fill the 16 connections or hold the port. Availability is not defended. |
| DNS rebinding | Exactly one `Host` header, equal to `127.0.0.1:<port>`. | None known. |
| CSRF from a tab | No ambient auth; bearer header and origin. | None known. |
| Token theft | `chrome.storage.local` restricted to trusted contexts (P10); sent only after a proof; revoked by Unpair. | A same-user process. |
| Cookie leakage | Cookies never reach `Job`, `jobs.json`, IPC, argv or aria2. A run or probe that used cookies reports only fixed reasons (`safeReason`). `-J` output is parsed field by field, never logged or forwarded whole. No `--verbose`. `crashReporter` stays off. A cookie file is deleted after every run and swept. | Crash window until the next start. |
| Cookie sent to the wrong host | yt-dlp's jar matches per request: on a redirect to a non-matching host no cookie was sent (P7e). Main's file probe follows redirects by hand and re-selects with `cookiesFor` per hop (P14b). | **Not probed:** a redirect to a second host for which the jar holds a matching cookie (yt-dlp sends no cookie to `localhost`). Manual-checklist item. |
| Forged or overlaid button click | `isTrusted`; one hand-off per tab per 3 s; single slot. | At worst the add dialog opens and the window takes focus. |
| Header injection | Referer is rebuilt from a parsed http(s) URL; User-Agent is printable ASCII up to 512 characters; one argv element or one aria2 option each, never aria2 `header`. | None known. |
| Page-fed candidate URLs (SSRF) | http(s) only, no userinfo; `new URL(u).hostname` is tested; loopback, private and link-local hosts rejected (Q9). | Names that resolve to private addresses. |

## 3. Wire protocol v1

Types, limits and error tokens live in the new `src/shared/protocol.ts`, imported by main and the extension.

**Common rules**
- Base `http://127.0.0.1:<port>`; the extension stores the port with its pairing. Only `POST`. `OPTIONS` always gets `403 preflight_refused` (P4 pending; fallback in section 10).
- Request `Content-Type: application/json`. Responses are JSON with `Cache-Control: no-store` and `Connection: close`.
- Errors are `{ "error": "<token>" }` and never echo input. The client branches on the token, not only the status. Node's own `400`, `431` and `408` (below) have no JSON body; the extension never causes them.
- Token: 32 random bytes, base64url, in `Authorization: Bearer`. The app stores `tokenHash = SHA-256(token)` and `proofKey = HMAC-SHA256(token, "fetchly-server-proof-v1")`. The extension derives `proofKey` with WebCrypto.
- `pairingId`: 16 random bytes, exactly 22 base64url characters. `nonce`: 32 random bytes, exactly 43.
- Origin must match `^chrome-extension://[a-p]{32}$`. On token routes it must equal the origin stored with the pairing.
- Body limit 64 KiB; 512 KiB on `/v1/handoff` and `/v1/logins`.

**HTTP parsing rules (node:http; P12 done)**

| Case | Who refuses | Answer |
|---|---|---|
| More than one `Host`, `Origin`, `Authorization` or `Content-Type` | App, counting in `rawHeaders` (`req.headers` keeps only the first `Host` and `Authorization`, and joins `Origin`) | `400 bad_request` |
| Duplicate `Content-Length`, or `Content-Length` with `Transfer-Encoding` | Node, before the handler | bare `400` |
| No `Content-Length`, or any `Transfer-Encoding` (a chunked body reaches the handler) | App | `400 bad_request` |
| Headers over `maxHeaderSize` 8192 | Node | bare `431` |
| Slow headers or body | Node: `headersTimeout` 5 s, `requestTimeout` 10 s, `connectionsCheckingInterval` 1 s (Q21). Without the interval the header limit is not enforced. | bare `408` |

Also: body bytes are counted while streaming; `maxConnections` 16; no keep-alive; `listen(port, '127.0.0.1')`. `exclusive` is not used: it is a cluster option and changed nothing in P13.

**Rate limits**
- 300 requests a minute per pairing, counted after the token check, so only the token holder can reach it.
- `/v1/hello`: no limit; fixed cost of one HMAC.
- `/v1/pair`: 5 wrong codes close pairing.
- No global limit and no `bad_token` lockout: the token is 256 bits.

**Check order**

| Order | Check | Failure |
|---|---|---|
| 1 | Header rules, Host | `400 bad_request`, `403 bad_host` |
| 2 | Path, method | `404 not_found`, `403 preflight_refused`, `405 method_not_allowed` |
| 3 | Origin | `403 bad_origin` |
| 4 | Content type, size | `415 bad_content_type`, `413 too_large` |
| 5 | Token (not on `/v1/pair`, `/v1/hello`) | `401 bad_token` |
| 6 | Rate (token routes) | `429 rate_limited` |
| 7 | Body shape | `400 bad_request` |

**Endpoints**

| Path | Comp. | Request | 200 response | Own errors |
|---|---|---|---|---|
| `/v1/pair` (no token) | A1 | `{ code, label }` | `{ pairingId, token, protocol: 1, appVersion }` | `403 pairing_closed`, `401 bad_code` |
| `/v1/hello` (no token) | A1 | `{ pairingId, nonce }` | `{ proof }` | `404 unknown_pairing` |
| `/v1/status` | A1 | `{}` | `{ app: "fetchly", protocol: 1, appVersion, engine }` | none |
| `/v1/unpair` | A1 | `{}` | `{}` | none |
| `/v1/handoff` | A3–A5 | `Handoff` | `{ requestId }` | `429 busy`, `503 not_ready` |
| `/v1/handoff/result` | A3 | `{ requestId }` | `{ state: "pending" }` or `{ state: "done", outcome, message }` | `404 unknown_request` |
| `/v1/logins` | A6 | `{ site, cookies }` | `{ site, savedAt, count }` | `503 storage_unavailable`, `400 bad_site` |

- **Server proof.** `proof = HMAC-SHA256(proofKey, "fetchly-hello-v1\n" + pairingId + "\n" + port + "\n" + nonce)`, port in decimal. An unknown `pairingId`, or one paired to another origin, gets `404 unknown_pairing`; nothing secret is hidden by a same-shape answer.
- **Extension rule.** Every token request is preceded by its own `/v1/hello`. A proof covers exactly one request, sent within 5 s (Q12). A failed proof means nothing more is sent. Every request times out after 5 s (Q20).
- **Pairing.** Offered in Settings only while `AppStatus.server.state === 'listening'`. Settings shows `<port>-<code>`; the popup takes the port from that string and has no other port input. The code is 8 symbols of a 32-symbol alphabet (40 bits), compared in constant time. Each pairing records its port. Changing `serverPort` removes all pairings after a confirmation (Q19); at load, a pairing whose port differs from the effective `serverPort` is dropped.
- `label`: browser name shown in Settings, up to 40 characters. `engine` is `EngineStatus['state']`.
- `busy`: the slot is in use (single slot, no queue). Main also shows the window, so the user sees the open dialog.
- `not_ready`: the app has no queue. `EngineStatus` `error` with a queue still accepts hand-offs.
- `/v1/handoff/result` answers at once. The content script of the starting tab polls every 2 s through a runtime message, one hello per poll, and shows the outcome in a toast. It stops after 120 s with "still working, see the Fetchly window" (Q18). Results stay 5 minutes plus 30 s grace after `done` (Q5); this governs polling only.

**Field meanings (one each)**

```ts
interface Handoff {
  source: 'button' | 'menu';
  url: string;               // button: the tab's URL as the service worker sees it; menu: link or media URL
  pageTitle: string | null;  // title used when a candidate is downloaded instead of url
  referer: string | null;    // menu: URL of the frame holding the link; null for button
  userAgent: string | null;  // the browser's UA, for every request of this job
  candidates: Candidate[];   // A4; [] before A4 and for menu. Max 20.
  cookies: WireCookie[] | null; // A5, menu only: chrome.cookies.getAll({ url }). null = not sent; [] = none exist. Max 300.
}
interface Candidate {
  url: string; kind: 'file' | 'hls' | 'dash';
  referer: string | null;      // Referer the browser sent for this URL
  contentType: string | null;
  size: number | null;         // Content-Length; null = unknown
}
interface WireCookie {
  name: string; value: string; domain: string; hostOnly: boolean;
  path: string; secure: boolean; httpOnly: boolean;
  expires: number | null;      // unix seconds; null = session cookie
}
type Outcome = 'opened' | 'app_busy' | 'app_unresponsive' | 'no_video' | 'protected'
             | 'login_required' | 'login_expired' | 'probe_failed';
```

A probe pass is **blocked** when it is classified `login required`, or when it is the one-shot pass and yields a playlist (section 5).

| Outcome | Meaning |
|---|---|
| `opened` | The renderer confirmed the add dialog is showing. Not that a job exists. |
| `app_busy` | The window had its own add dialog open and declined. |
| `app_unresponsive` | The renderer confirmed nothing within the ack deadline (Q22). |
| `no_video` | `message` is exactly "no downloadable video found on this page". |
| `protected` | The page or every candidate declares DRM. |
| `login_required` | The last probe pass run was blocked and did not use a stored login. `message` is "sign in needed", or the playlist text of section 5. |
| `login_expired` | The last probe pass run was blocked and used a stored login. |
| `probe_failed` | `message` is `ProbeError.reason`; for a pass given a cookie file it is the `safeReason` text (section 5). `probeFile` reasons are app-authored and pass through unchanged. |

**Outcome precedence (first match wins; "result" is that of the last pass run, section 5)**

| Page probe result | Outcome |
|---|---|
| A usable result (section 5: media, a file, or a playlist that is not from pass 2) | `opened`, `app_busy` or `app_unresponsive` |
| `protected` | `protected` |
| Blocked | `login_required` or `login_expired`; candidates are not tried |
| yt-dlp missing, timed out or stopped early | `probe_failed` |
| Any other failure, A3 alone | `probe_failed` (a non-yt-dlp page gives "this link is a web page, not a file") |
| Any other failure, from A4 | Ranked candidates: first usable gives `opened`; all DRM gives `protected`. No usable candidate: `probe_failed` with the page reason when it is `private`, `removed` or `unavailable in region`, else `no_video`. |

- Every string is rejected if it holds a control character. URLs pass `validateUrl`.
- Partitioned cookies are not sent. Any Referer is reduced to origin + path (D7).

**Cookie scope (three terms, never mixed)**

| Term | Definition | Used by |
|---|---|---|
| One-shot set | What the browser would send to the hand-off `url`. | That hand-off's one-shot pass and its one job. |
| `site` | Tab hostname, lowercased, without a leading `www.` (Q8). `/v1/logins` collects `getAll({ url: tabUrl })` plus `getAll({ domain: site })`, de-duplicated. | Key of a stored login. |
| Login match | A run's host equals `site` or ends with `.` + `site`; the longest `site` wins. | yt-dlp only: media jobs, playlist items, candidate jobs, and the stored-login probe pass. Never aria2, never `probeFile`, never plain-file mode. At run time a job with `oneShotLogin: true` uses only the one-shot set; in a probe the order is the passes table. |

The app applies no expiry rule of its own to any cookie (Q13); `cookiesFor` ignores `expires`.

**Popup states** ("Pair again" is offered in every state)

| Fact | State |
|---|---|
| No pairing stored | Not paired (pairing form) |
| Connection refused, or no answer in 5 s | App not running |
| Hello `404 unknown_pairing`; or `401 bad_token` after a right proof | Not paired (pairing form) |
| Hello answer is not JSON, has another status, or the proof is wrong | Another program uses this port |
| Proof right, then `200` | Connected |
| `429 rate_limited` | Busy, try again in a minute (same text in the toast) |
| `429 busy` | Toast only: "Fetchly is showing another link" |
| `5xx` after a right proof | Fetchly reported an error |

## 4. Where things live

```
src/shared/protocol.ts            wire types, limits, error tokens (new)
src/shared/text.ts                the one exported CONTROL regex
src/main/atomicFile.ts            Store.writeAtomic moved unchanged (still <path>.tmp)
src/main/server/server.ts         listener, parsing rules, check order (A1)
src/main/server/pairing.ts        code, tokenHash, proofKey, proof, pairing.json (A1)
src/main/server/routes.ts         route table; later components register here (A1)
src/main/handoff.ts               the single slot and its states, outcome (A3)
src/main/fallback.ts              candidate ranking, DRM classification, host rule (A4)
src/main/logins/oneShot.ts        one-shot cookies by job id, outside Queue (A5)
src/main/logins/cookieFile.ts     WireCookie[] to Netscape temp file, sweep (A5)
src/main/logins/cookiesFor.ts     pure cookiesFor(url, cookies) (A5)
src/main/logins/safeReason.ts     fixed reasons for runs that used cookies (A5)
src/main/logins/store.ts          per-site store on a Sealer interface, logins.json (A6)
extension/manifest.json           MV3, no "key"
extension/src/{service-worker,content,popup}.ts, extension/src/lib/*.ts
tests/server/**, tests/logins/**, tests/extension/**, tests/fakes/fake-chrome.ts
docs/manual-checklist-phase2.md
```

- **Build:** Vite. New script `build:ext`; new `tsconfig.ext.json`; `typecheck` and CI gain both. One new dev dependency, `@types/chrome`.
- **Manifest:** permissions `storage`, `contextMenus`, `webRequest` (A4), `cookies` (A5); host permissions `http://127.0.0.1/*` and `<all_urls>`; content script with `all_frames: true`; no `activeTab`.
- **Loading:** `npm run build:ext`, Load unpacked on `extension/dist`, then Settings, "Pair a browser", and the pairing string is typed in the popup.
- **README:** these steps; "moving the folder or changing the port means pairing again"; the same-user limit; `pairing.json` sits in the roaming profile, which sync and backups copy; "links sent with a sign-in download on one connection".

## 5. Persistence and shared-type changes

| File | Change | Notes |
|---|---|---|
| `settings.json` | New `serverPort`, default `38917` (Q3). A non-integer or a value outside 1024–65535 **falls back to the default; it is not clamped**. | Add in `DEFAULT_SETTINGS`, `SETTING_CHECKS`, `normalizeSettings`, `parseSettings` and the rebuild in `setSettings` (`ipc.ts`), or it is dropped on save. |
| `jobs.json` | New `Job` fields `referer: string \| null`, `userAgent: string \| null`, `oneShotLogin: boolean`. **All land in A3**; `oneShotLogin` stays `false` until A5. | **Migration-class, reviewed once:** `parseJob`, `Queue.add`, the rebuild in `add` (`ipc.ts`). Absent means `null`, `null`, `false`. `version` stays 1. `Store.loadSnapshot` is not changed. Moving `writeAtomic` in A1 must leave the Store specs passing untouched. |
| `pairing.json` (new) | `{ version: 1, pairings: [{ id, origin, port, tokenHash, proofKey, label, pairedAt }] }`, at most 4 (Q7, Q14). | Missing means unpaired; unreadable is set aside. A pairing whose `port` is not the effective `serverPort` is dropped at load. |
| `logins.json` (new) | `{ version: 1, logins: [{ site, savedAt, count, blob }] }`. | Unreadable file: set aside, startup notice. In `main()` (it runs after `ready`; P3: encryption is unavailable before it), before the window is shown, every blob is decrypted once and the plaintext dropped at once. An entry is removed only on a decrypt error while `isEncryptionAvailable()` is true, with "the saved sign-in for <site> could not be read and was removed" (token `login unreadable`), joined into the startup notice. |
| `tmp/` (new, userData) | Cookie files `c-<random>.txt`, created exclusively, one fresh file per yt-dlp process. | Swept in `main()` before the server listens, and inside `tools.exclusive` after each successful `killStrays`. Safe because cookie probes run under `tools.shared` and no job runs until `killStrays` resolved. |

**Hand-off slot (pull model)**

| Step | Rule |
|---|---|
| Accept | Slot `probing`; `requestId` returned. |
| Probe fails | Outcome set; slot cleared. |
| Probe succeeds | Slot `ready`; main calls `showWindow()` and sends the payload-free `fetchly:handoff`. |
| Take | The renderer calls `handoffTake()` on mount and on every event. It returns `{ handoffId, url, probe }` or `null`, the same answer until the slot ends. |
| Ack | `handoffShown(id)` sets `opened`; `handoffDeclined(id)` sets `app_busy` and clears the slot. Neither within 10 s of `ready` (Q22): `app_unresponsive`, slot cleared. `handoffShown` on an ended slot returns `false` and the renderer closes that dialog. |
| End | Exactly one of: `add`, dialog cancel (`handoffClose`), declined, probe failure, ack deadline, `render-process-gone` or window destroyed, quit. Hiding the window does not end the slot. On `add` the cookies move to `oneShot.ts` only when pass 2 produced the result (`oneShotLogin: true`); in every other case, and at every other end event, they are dropped. |
| `handoffId` | 128-bit random, single use. An unknown or ended id makes `add` fail. |

**Probe passes (every probe, handed off or pasted; run in order)**

| Pass | Cookies | Runs when | Tool |
|---|---|---|---|
| 1 | None | Always. | yt-dlp, then `probeFile`, as today |
| 2 | One-shot set (A5) | The hand-off holds a non-empty `cookies`, and pass 1 was yt-dlp `login required` or its `probeFile` failed with anything but "could not reach the server". | The tool that failed in pass 1 |
| 3 | Matching stored login (A6) | A login matches, and the previous pass run was yt-dlp `login required` or was pass 2 yielding a playlist. | yt-dlp only |

- A pass gives a **usable result** when it yields media, a file, or a playlist that is not from pass 2. The first usable result ends the probe.
- Otherwise the **last pass run** decides the outcome through the section 3 tables. Pass 2 yielding a playlist with no pass 3 available gives `login_required` with "playlists behind a sign-in need Use my login for this site".
- Before A5 only pass 1 exists; before A6, passes 1 and 2.

**Rules that cross components**

| Rule | Statement |
|---|---|
| `oneShotLogin` | `true` only when pass 2 produced the job's `ProbeResult`. Passes 1 and 3 never set it. |
| File probe cookie pass | `redirect: 'manual'`, at most 10 hops, `cookiesFor` per hop. `probeFile` keeps Node's global `fetch` (undici; P14, P14b), never Chromium `net.fetch`. If a future Electron changes what P14b showed: `probeFile` uses `node:http(s)`; `cookiesFor`, the 10-hop limit and the Headers rule do not change. |
| Group jobs | Never carry one-shot cookies. A playlist from pass 3 runs its items with the stored login by login match. |
| One-shot cookies on a job | Held in `oneShot.ts` by job id until the job is `done` or removed, or the app quits (Q6). They survive a rebuilt queue. |
| Cookies gone | Starting, resuming or retrying a job with `oneShotLogin: true` and no cookies held starts no run. The job becomes `failed` with "the sign-in sent with this link was not kept; send it again from the browser". No automatic retry; `attempts` unchanged; partial data kept. A new hand-off creates a new job (Q17). |
| Engine choice | One helper `usesYtdlp(job)`: `kind === 'media'`, or `kind === 'file'` with `oneShotLogin`. It replaces the `job.kind` tests in `engineOf` (start, stop, discard, shutdown), `retune` and `restartVerb` in `queue.ts`. `claimsIn` is unchanged: plain-file jobs hold `fileName`. |
| Plain-file mode | `MediaEngine` for `kind: 'file'`: the `start` guard requires `fileName` and cookies instead of `baseName` and `quality`; no height check. New `plainFileArgs`: `--use-extractors generic` (P7g: without it an HTML page's embedded video is extracted), `--cookies`, exact `-o`, `--continue`, `--fixup never`; never `--no-part` (P7d: a rerun on a finished file then ends in a 416 and exit 1); no format, merge or post-processing args. `discard` deletes exactly `<fileName>.part` and `.ytdl`; `findFinished` accepts exactly `fileName`. An HTML answer at run time ends as `unsupported site` from `RULES` and is shown as "this link is a web page, not a file"; nothing is saved. |
| Ending yt-dlp | Every yt-dlp probe and engine run is ended by a tree kill; killing only the `yt-dlp.exe` PID leaves its Python child running (P7d). Engine runs already do this: `MediaEngine.stop`, `discard` and the height-check time limit use `killTree` (`taskkill /T /F`), so plain-file mode needs nothing new. `probe.ts` `run` does not (its `execFile` `timeout` signals one PID): A3 gives it the same tree kill. |
| Cookie file | Written fresh from memory for each yt-dlp process of a run or probe pass: `#HttpOnly_` prefix for `httpOnly`, expiry `0` for `expires: null` (P7c). Deleted after that process, whatever the result, once `close` confirmed the tree ended; never read back or reused, because yt-dlp rewrites it (P7c). With no confirmed end the file is left to the sweep. |
| Headers | `Job.referer` and `Job.userAgent` reach yt-dlp as `--add-headers`/`--user-agent` (P7a), aria2 as the per-download options `referer` and `user-agent` of `addUri` (never `header`), and `probeFile` as request headers (P14, P14b). |
| `safeReason` | For any run or probe given a cookie file (one-shot or stored), the reason is a fixed `RULES` output from `ytdlp/parse.ts`, or "download failed (details hidden because a sign-in was used)" with `retryable: true`, as today's fallback. aria2 messages are unaffected (Q16). |
| `login expired` | Only: a yt-dlp run or probe that used a stored login and was classified `login required`. aria2 code 24 and one-shot runs keep `login required`. A decrypt failure at run time removes the entry (same condition as at startup) and the run goes without it. |

**Other shared types**
- `AppStatus.server`: `{ state: 'listening'; port }`, `{ state: 'portBusy'; port }` or `{ state: 'error'; message }`. `banners.ts` gains id `server` ("port <n> is in use; change it in Settings"); `Banner.action` is `null`.
- `AddRequest.handoffId: string | null`.
- `StartContext.extras: RunExtras | null`, `RunExtras = { referer, userAgent, cookies: CookieSource | null }`. The queue gets it from an injected `QueueDeps.extrasFor(job)`, composed in `index.ts`: A3 supplies the headers, A5 adds the one-shot source, A6 adds the stored-login source. A5 and A6 do not change the queue for it.
- `FetchlyApi` gains `pairingStart`, `pairingCancel`, `pairings`, `unpair`, `onHandoff`, `handoffTake`, `handoffShown`, `handoffDeclined`, `handoffClose`, `logins`, `deleteLogin`.

## 6. Components

| | Purpose | Class | Provides | Consumes |
|---|---|---|---|---|
| A1 | Server, pairing, proof | SENSITIVE | `/v1/pair`, `/v1/hello`, `/v1/status`, `/v1/unpair`; `routes.register`; `AppStatus.server`; `atomicFile.ts`, `text.ts` | `Settings.serverPort` |
| A2 | Extension shell | SENSITIVE | Popup states; `lib/client.ts` (`call(path, body)`, hello inside, error token returned); token and port storage | A1 endpoints |
| A3 | Hand-off | normal + migration review | `/v1/handoff`, `/result`; slot; content script, button, context menu, toast; headers for yt-dlp, aria2 and `probeFile`; `extrasFor`; probe tree kill; the three `Job` fields | A1, A2, `probeUrl`, `Queue.add` |
| A4 | Media fallback | normal, adversarial read | `candidates` collection and use; `no_video`, `protected` | A3 |
| A5 | One-shot cookies | SENSITIVE | `cookies` field; passes 1–2; `oneShot`, `cookieFile`, `cookiesFor`, `safeReason`; `usesYtdlp`, plain-file mode; cookies-gone rule | A3 |
| A6 | Stored logins | SENSITIVE | `/v1/logins`; store; pass 3; Settings list with Delete; `login expired`, `login unreadable` | A5, `safeStorage` |

Boundary checks: A1↔A2, A2↔A3, A3↔A4, A3↔A5, A5↔A6, and A4↔A5 for `RunExtras`.

**Existing files touched** (the A5 and A6 rows are completed in their plans; section 11, N40 and N41)

| | Files |
|---|---|
| A1 | `index.ts`, `ipc.ts`, `validate.ts`, `jobs/store.ts`, `types.ts`, `preload/index.ts`, `banners.ts`, `SettingsDialog.tsx`, `strings.ts` |
| A2 | `extension/**` only |
| A3 | `probe.ts`, `ytdlp/args.ts` (also add `--` to `probeArgs`), `engines/media.ts`, `engines/file.ts`, `engines/engine.ts`, `jobs/queue.ts`, `queueLifecycle.ts`, `validate.ts`, `ipc.ts`, `index.ts`, `preload/index.ts`, `App.tsx`, `extension/**` |
| A4 | `probe.ts`, extension service worker |
| A5 | `engines/media.ts`, `jobs/queue.ts`, `queueLifecycle.ts`, `probe.ts`, `ytdlp/args.ts`, `ytdlp/parse.ts` consumers, `index.ts` |
| A6 | `SettingsDialog.tsx`, `ipc.ts`, `index.ts`, `engines/media.ts`, `probe.ts` |

**Acceptance (the gates, plus)**

| | Runnable criteria |
|---|---|
| A1 | `npx vitest run tests/server`. Table test for every row of the check order and the parsing table (raw sockets). Pairing: single use, lifetime boundary, 5 wrong tries close it, constant-time compares, unpair revokes, refused while not `listening`, port change removes pairings, a pairing with another port is dropped at load. Hello: right proof; a proof computed for another port does not verify; unknown id and wrong-origin id give `404`; 100 wrong tokens lock nothing. Port busy: banner, no other port. Out-of-range `serverPort` loads as the default. |
| A2 | `npx vitest run tests/extension`. Every popup-state row, `429 busy` and `429 rate_limited` told apart by token. With a wrong proof, or a right proof for another port, no request with `Authorization` or cookies is made (fake fetch log). A proof older than the limit is not reused. The port comes only from the pairing string. Token never in a runtime message. Manifest schema test. |
| A3 | `tests/handoff.test.ts`, `tests/ytdlp/args.test.ts`, `tests/engines/file.test.ts`, probe spec. Take is idempotent; a dropped event is recovered by take on mount; the ack deadline at its boundary gives `app_unresponsive`; `handoffShown` after it returns `false`; hide keeps the slot; second hand-off gets `busy` and shows the window; `add` uses the stored url and probe; unknown or reused id refused; each end event clears the slot; hostile Referer and UA never add an argv element or an aria2 `header`; persisted Referer has no query; old `jobs.json` fixtures load; a timed-out probe ends through the tree kill. |
| A4 | `tests/fallback.test.ts`. Every precedence row, including a `private` page with no usable candidate keeping its reason. DRM markers give `protected`; AES-128 HLS does not. Host rule on decimal, hex, IPv6 and userinfo forms. HTML is never saved. |
| A5 | `tests/logins/*.test.ts`, queue and media specs. Pass order: a public link sent with cookies gets `oneShotLogin: false` and survives a restart; pass 2 runs only after a `login required` or failed file pass; a pass-2 playlist gives `login_required` with the playlist text. Netscape output per field (session expiry `0`, `#HttpOnly_`); tab or newline rejected; `cookiesFor` per attribute and per hop (no expiry case: it ignores `expires`, Q13); file gone after done, fail, cancel, stop, and although the fake rewrote it; plain-file argv holds `--use-extractors generic` and no `--no-part`; plain-file start, stop, discard (`.part` removed), retune restart and already-finished detection; `safeReason` never returns tool text; aria2 argv and RPC bodies never hold a cookie; cookies-gone rule on resume, retry, auto-resume and after a rebuilt queue. |
| A6 | `tests/logins/store.test.ts`, probe spec. Round trip through a fake `Sealer`; unavailable sealer refuses, writes nothing and removes nothing; delete removes the blob; undecryptable blob removed at startup with the notice, but not while the sealer is unavailable; `login expired` only from a stored-login yt-dlp run; aria2 code 24 stays `login required`. **Menu on a private playlist:** with a valid stored login, pass 2 yields a playlist, pass 3 runs, the outcome is `opened` and no item has `oneShotLogin`; with a rejected stored login, `login_expired`; with none, `login_required`. One-shot `login required` followed by a working stored login gives `opened`. |

**Edge cases the component plans must answer** (see also section 11)

| | Cases |
|---|---|
| A1 | Port held by another session; two pair requests racing; monotonic clock for the code lifetime; port changed while a pairing code is open; `settings.json` port edited by hand. |
| A2 | Service worker restarted mid-pairing; extension folder moved; app closed between hello and the request. |
| A3 | Window hidden in tray or destroyed; tab navigated while polling; quit with the slot full; same URL sent twice; click inside a sub-frame. |
| A4 | Candidate seen in a sub-frame; segment floods (collect manifests only); tab navigated between request and click. |
| A5 | Automatic retry reuses held cookies; restart; redirect to another host; the server answers HTML at download time; whether an `unsupported site` page gets a yt-dlp cookie pass (N30). |
| A6 | Login saved while a job runs; transient `safeStorage` failure (N33); `safeStorage` unavailable. |

## 7. Testing strategy

| Layer | How |
|---|---|
| Server, pairing, proof | Real `node:http` on `127.0.0.1:0`, raw-socket requests, injected clock and random source. |
| Cookie store | `Sealer` faked; real `safeStorage` only in P3 and the manual checklist. |
| `cookieFile`, `cookiesFor`, `safeReason`, args, ranking | Pure functions. |
| yt-dlp and aria2 integration | `tests/fakes/fake-ytdlp.mjs` records argv, reads the cookie file and rewrites it as yt-dlp does; the fake aria2 records RPC options. |
| Extension logic | `fake-chrome.ts`. |
| Leak tests | A marker cookie value appears nowhere but the temp file. |

**Manual checklist (owner):**
- Load unpacked in Chrome and Edge; pair; wrong code five times; unpair; port busy; change the port and pair again.
- A fake listener on the port with the app closed gives "another program uses this port".
- Button on YouTube and on a non-yt-dlp HLS site; DRM site.
- Context menu on a public file (several connections), a login-gated file (one connection) and a hotlink-protected file (reduced Referer, D7).
- A login-gated file that redirects to a second host (CDN): it downloads, and stop leaves no `yt-dlp` process.
- A hand-off while the window is hidden in the tray.
- A partitioned-cookie site.
- "Use my login" on an age-restricted video; right-click on a private playlist link; Delete; `login expired`.
- Temp folder empty after each run.

Workers run only the specs they touch; the orchestrator runs the full suite serially.

## 8. Order and staging

| Stage | Delivers | Usable alone |
|---|---|---|
| A1 | Server, proof, Settings pairing panel | App runs as before. |
| A2 | Popup pairs and shows status | Pairing end to end. |
| A3 | Button and menu open the add dialog | Public content on yt-dlp sites and direct links. |
| A4 | Button works on other sites | Public content. |
| A5 | Menu works behind logins | `cookies` stays `null` until this ships. |
| A6 | Stored logins | Fixes `failed: login required`. |

One feature branch per component off `feat/phase2-extension`. A1, A2, A5 and A6 stop before git for the owner's line-by-line review; so does A3's `jobs.json` loader change.

## 9. Open questions for the owner (all PROVISIONAL)

| # | Question | Provisional default |
|---|---|---|
| Q1 | Pairing code | Single use, 8 symbols, valid 5 minutes plus 10 s grace on the monotonic clock. 5 wrong tries close pairing. Token valid until Unpair. |
| Q2 | Origin | Bound to the origin that completed pairing; no manifest `key`. |
| Q3 | Port | Fixed `38917`, changeable in Settings only. Busy gives a banner, never a fallback. |
| Q4 | Stored logins | Kept until deleted, saved date shown. No age rule; expiry is only reported from the site's rejection. |
| Q5 | Hand-off result retention | 5 minutes plus 30 s grace after `done`. Polling only. |
| Q6 | One-shot cookies | In memory until the job is done or removed, or quit. No age limit. |
| Q7 | Pairings | Up to 4. |
| Q8 | `site` key and collection | Hostname without `www.`; no public-suffix list; the union in section 3. |
| Q9 | Candidate hosts | Loopback, private and link-local rejected. |
| Q10 | Deviations D1–D8 | As listed. Includes the P4 fallback of section 10, if it is ever needed. |
| Q11 | Cookie-carrying file jobs | Through yt-dlp on one connection (D5). Alternatives: main's own one-connection downloader reusing `cookiesFor`; or an aria2 header behind a hard redirect gate. |
| Q12 | Proof freshness | One proof per request, used within 5 s. Never 0. |
| Q13 | Cookie expiry tolerance | No app-side check; yt-dlp's jar decides (P7c: it does not send an expired cookie). If a check is wanted: drop only when expired more than 5 minutes ago. |
| Q14 | `proofKey` at rest | Plain in `pairing.json` under the profile ACL, with the README note. The alternative is sealing with `safeStorage`. |
| Q15 | Cookie use | Cookie-less pass first for every probe; then one-shot, then a stored login, as in section 5. |
| Q16 | Reasons for cookie runs | Fixed strings only; detail is lost. |
| Q17 | Re-sending a link whose sign-in was lost | New job; the old partial stays until removed. |
| Q18 | Poll | Every 2 s, stop after 120 s. |
| Q19 | Port change while paired | Pairings are removed after a confirmation; pair again. The alternative is a port field in the popup, safe only because the proof holds the port. |
| Q20 | Extension request timeout | 5 s per request, then "App not running". Never 0. |
| Q21 | Server deadlines | Headers 5 s, whole request 10 s, checked every 1 s (so up to 1 s late). Never 0. |
| Q22 | Hand-off ack deadline | 10 s from `ready`, then `app_unresponsive`. Never 0. |

## 10. Risks and probes

One process per case. Files go in `%LOCALAPPDATA%\fetchly-probes\<probe>\<case>\`, outside the repository and not under `%TEMP%`. Each browser case uses its own `--user-data-dir`. CI (Node 22 and 24) covers unit tests only; Node 22 was not probed.

**Done** (Windows 11 Pro 10.0.26100; Node 24.14.1; Electron 45.4.1 = Node 24.22.3, run as `ELECTRON_RUN_AS_NODE` except P3 and P14b; yt-dlp 2026.10.26; aria2c 1.37.0)

| # | Result | Used in |
|---|---|---|
| P3 | PASS. `safeStorage.isEncryptionAvailable()` is false before `ready`, true after; round trip works. | §5 `logins.json` |
| P7a | PASS. `--add-headers` Referer and User-Agent are sent on a bare `.m3u8`/`.mpd` manifest and on every segment. | Headers rule |
| P7b | PASS. A DRM manifest (FairPlay SAMPLE-AES with `KEYFORMAT`, Widevine `ContentProtection`) gives `ERROR: [generic] <id>: This video is DRM protected`, exit 1; the existing `RULES` entry maps it to `protected`. AES-128 HLS and SAMPLE-AES without `KEYFORMAT` download. | A4 |
| P7c | PASS. The cookie file is deletable right after exit. yt-dlp **rewrites** it (CRLF, `#HttpOnly_` prefix dropped). A session cookie written with expiry `0` and a `#HttpOnly_` cookie are sent; an expired cookie is not. This also answers P7f. | Cookie file rule, Q13 |
| P7d | PASS. `--cookies <f> -o <exact path> --continue [--no-part]` uses the generic extractor and saves exactly at `-o` (any or no extension), sha256 identical. Resume after a tree kill sends `Range: bytes=<n>-` and ends identical. **Finding:** killing only the `yt-dlp.exe` PID leaves its Python child downloading to the end. Side note: in `--no-part` mode a rerun on a finished file gets a 416 and exit 1. | Ending yt-dlp, plain-file mode |
| P7e | PASS, partial. On a 302 from `127.0.0.1` to `localhost` no cookie went to the non-matching host. A redirect to a second host with a matching cookie is untested. | §2 residual, manual checklist |
| P7g | Without `--use-extractors generic`, plain-file mode extracts an embedded `<video>` from an HTML page. With it: `ERROR: Unsupported URL`, exit 1, nothing saved. 401/403 HTML pages save nothing in every variant; direct files still download; no variant saved an HTML file. | Plain-file mode |
| P7h | PASS. An `.mp4` through plain-file mode: no Fixup or Merger, sha256 identical (default, `--fixup never`, `--use-extractors generic`). | D5 |
| P12 | Identical on both runtimes. Duplicate `Host` or `Authorization`: 200, `req.headers` keeps the first, duplicates only in `rawHeaders`. Duplicate `Origin`: joined `a, b`. Duplicate `Content-Length`, or with `Transfer-Encoding`: Node's 400. Chunked without `Content-Length`: reaches the handler. Header over 8192: 431. `headersTimeout` 2000 with the default 30 s check interval: not enforced; with interval 250: 408 at about 2 s. | §3 parsing table |
| P13 | App on `127.0.0.1:<port>`. Second Node process on `127.0.0.1`: `EADDRINUSE`; on `0.0.0.0` or `::` it binds but loopback requests still reach the app, whichever bound first. .NET socket with `SO_REUSEADDR`, same user: after the app, `127.0.0.1` fails AccessDenied; `0.0.0.0` binds without taking traffic. If the fake binds `127.0.0.1` first, the app gets `EADDRINUSE` and traffic goes to the fake. `exclusive` changed nothing. | §2 threat rows |
| P14 | PASS. aria2 `addUri` options `referer` and `user-agent` are sent as given. Node 24 and Electron 45 `fetch` (undici) send a caller-set Referer and User-Agent as given. Chromium `net.fetch` was not probed and is not used. | Headers rule |
| P14b | PASS, identical on both runtimes: Node 24.14.1 and the real Electron 45.4.1 main process (not `ELECTRON_RUN_AS_NODE`). Global `fetch` with `redirect: 'manual'` and caller-set `Cookie`, `Referer` and `User-Agent`: status 302 readable, `type` is `basic` (not opaque), `Location` readable, `redirected` false, the redirect not followed (the second server got no request), and all three headers arrived as given. | File probe cookie pass, Headers rule, §2 wrong-host row |

D5 holds: P7d, P7g and P7h passed, P7e passed for the case probed. The file probe cookie pass holds on the probed runtimes (P14b); its `node:http(s)` fallback in section 5 is the rule if a later Electron or Node behaves differently.

**Not run; gates for component plans, not for this freeze** (browser needed: Edge 158 with `--load-extension`, Chrome 158 loaded by hand in a fresh profile)

| # | Behaviour | Gates | Cross-component interface and fallback |
|---|---|---|---|
| P4 | A service-worker JSON POST with `Authorization` to `127.0.0.1:<port>`: exact `Origin` and `Host`; carries `Content-Length`; no preflight; no permission prompt or block; `crypto.subtle` HMAC works. | A1, A2 | §3 common rules. If a preflight is sent: `OPTIONS` gets `204` with `Access-Control-Allow-Origin` set to the request origin and `Access-Control-Allow-Headers: authorization, content-type`, only for a paired extension origin (or any extension-shaped origin on `/v1/pair` while pairing is open); the `POST` responses to those origins carry the same `Access-Control-Allow-Origin`, or the extension cannot read them; every other origin keeps `403 preflight_refused` and gets no CORS header. Paths, bodies, tokens and `call()` do not change. It amends D1 and the §2 "no CORS headers" defence, so it needs the owner (Q10). Any other P4 failure returns the plan to the owner. |
| P6 | Non-blocking `webRequest` with `extraHeaders` exposes Referer and sees MSE and worker media requests. | A4 | `Candidate.referer` is nullable. Fallback: it is the tab URL (reduced, D7). |
| P10 | `storage.local.setAccessLevel('TRUSTED_CONTEXTS')` hides the token from content scripts and survives a service-worker restart. | A2 | None: storage is inside A2. Fallback in the A2 plan (N32). |
| P13b | Optional: a binder under another Windows user while the app listens. | none | §2 residual stays as stated. |

## 11. Deferred to component plans

Each row is answered in the named component plan. None changes a wire type, an `Outcome`, the passes table or `RunExtras`.

| Id | Plan | What that plan must state |
|---|---|---|
| N26 | A2, A3 | Final wording of the `429 busy` and `429 rate_limited` texts. |
| N27 | A1, A2 | Port-in-pairing details, including whether a pairing dropped at load for a port mismatch is removed from `pairing.json` or only ignored. |
| N30 | A5 | Whether an `unsupported site` page gets a yt-dlp cookie pass. |
| N32 | A2 | The P10 fallback. |
| N33 | A6 | Handling of a transient `safeStorage` failure. |
| N36 | A3, A5 | `heightProbeArgs` also gets the headers (A3) and the cookie file (A5), each yt-dlp process with its own fresh file. |
| N37 | A3 | The yt-dlp version check in `binaries.ts` is outside the "Ending yt-dlp" rule as written; A3 says whether it also gets the tree kill. |
| N38 | A4 | `protected` for a candidate is only yt-dlp's `RULES` result and `fallback.ts` only aggregates; acceptance gains the SAMPLE-AES-without-`KEYFORMAT` case (it downloads, P7b). |
| N40 | A5 | `RULES` is private to `ytdlp/parse.ts` and `classifyError` does not say whether a rule matched, so A5 changes `parse.ts` itself, not only its consumers. |
| N41 | A5, A6 | Files touched: A5 adds `extension/**` (`cookies` permission, `chrome.cookies.getAll`), `ipc.ts` (`add` sets `oneShotLogin`) and `handoff.ts`; A6 adds `extension/**` (the popup's "Use my login"). |
| r4-adv-1 | A4 | One line on the residual: a page can have a subdomain of a logged-in site offered as a candidate; cookies go only where the browser would send them. |
| r4-adv-2 | A3 | The toast renders `message` with `textContent` inside the closed shadow root. |

## 12. Critique r4 disposition

All round-1 to round-3 gaps (B1–B17, N1–N33) are closed; those deferred to component plans are listed in section 11.

| Id | Disposition |
|---|---|
| B18 | Closed by probe P14b, run before the freeze in Node 24.14.1 and in the real Electron 45.4.1 main process: PASS (§10). The `node:http(s)` fallback is kept in the §5 "File probe cookie pass" rule for a future runtime change. |
| N34 | Fixed: precedence row 1 reads "A usable result (section 5)", so a pass-2 playlist falls to "Blocked". |
| N35 | Fixed in §3 (`probe_failed`): the fixed text applies to a pass given a cookie file; `probeFile` reasons pass through unchanged. |
| N36 | Wording fixed in §5 ("one fresh file per yt-dlp process", never reused). `heightProbeArgs` deferred to A3/A5 (§11). |
| N37 | Fixed: the rule is narrowed to probes and engine runs. The `binaries.ts` version check is deferred to A3 (§11). |
| N38 | Deferred to A4 (§11). |
| N39 | Fixed: the P4 fallback names `Access-Control-Allow-Origin` on the `POST` responses and the amended §2 defence. Still needs the owner (Q10). |
| N40 | Deferred to A5 (§11). |
| N41 | Deferred to A5/A6 (§11). |
| N42 | Fixed: `cookiesFor` ignores `expires` (§3, A5 acceptance); no expiry test case, no tolerance of zero. |
| N43 | Fixed in §5 (slot "End" row): cookies move to `oneShot.ts` only when pass 2 produced the result, and are dropped otherwise. |