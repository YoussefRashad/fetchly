# Project tree

A map of where things live, not a file list. Dangerous modules are marked ⚠ and covered in
`critical-modules.md`.

## Processes

Electron runs three parts. The renderer never touches Node; it sees only the typed `window.fetchly` bridge.

```
renderer (React, sandboxed) --window.fetchly--> preload --IPC "fetchly:<name>"--> main
main --argv--> yt-dlp (+ ffmpeg)        main --JSON-RPC 127.0.0.1--> aria2 daemon
extension --HTTP POST 127.0.0.1:<port>--> main (local server)
```

## `src/main/` (Node, main process)

| Path | Role |
|---|---|
| `index.ts` | App start: data dir, window (sandbox, context isolation), single-instance lock, server start, IPC registration, quit order |
| `ipc.ts` | ⚠ Every IPC handler (`createHandlers`), argument validation, `Result` wrapping, the port-change flow |
| `server/server.ts` | ⚠ Loopback HTTP listener and the request check order |
| `server/routes.ts` | ⚠ Route table and the four `/v1/*` handlers |
| `server/pairing.ts` | ⚠ Pairing codes, token hashes, server proof, rate limit, `pairing.json` |
| `jobs/state.ts` | Job state machine (transition table) |
| `jobs/queue.ts` | Queue: slots, retries, pause/resume, saving, quit |
| `jobs/store.ts` | ⚠ `jobs.json` and `settings.json` load and save |
| `jobs/validate.ts` | ⚠ Strict load-time validation of persisted files and IPC values |
| `atomicFile.ts` | ⚠ Temp file, fsync, rename |
| `queueLifecycle.ts` | Creates, wires and disposes the queue in one owned order; auto-resume |
| `engineHost.ts` | aria2 daemon start, retry and restart (single-flight) |
| `engines/media.ts` | yt-dlp supervision (spawn, progress, stop, cancel) |
| `engines/file.ts` | aria2 daemon and JSON-RPC client |
| `engines/engine.ts` | Engine interface shared by both |
| `ytdlp/args.ts`, `ytdlp/parse.ts` | yt-dlp argument building and output parsing |
| `probe.ts` | URL validation and "what is this link" probe |
| `binaries.ts` | ⚠ Fetch and checksum-verify the three tools |
| `toolGate.ts` | Serializes stray cleanup, probes and tool updates |
| `strays.ts` | Ends leftover tool processes from `%APPDATA%\fetchly\bin` at start |
| `fileSafety.ts` | ⚠ Mark-of-the-Web, runnable-file confirmation |
| `naming.ts` | Output file names |
| `shell.ts`, `shellText.ts`, `shellStrings.ts` | Tray, notifications, dialogs; EN/AR main-process strings |
| `appearance.ts` | Language and theme from settings and Windows |

## Other source

| Path | Role |
|---|---|
| `src/preload/index.ts` | `contextBridge` exposure of `window.fetchly` (CommonJS: sandboxed preload) |
| `src/shared/types.ts` | Types used by both sides, including `FetchlyApi` and `Result<T>` |
| `src/shared/protocol.ts` | ⚠ Browser wire protocol: limits, formats, error tokens, proof input |
| `src/shared/i18n.ts`, `text.ts` | Language resolution, direction, isolates, control-character checks |
| `src/renderer/src/` | The window: `App.tsx`, `components/`, `strings.ts` + `strings.ar.ts`, `banners.ts`, `format.ts` |
| `extension/` | ⚠ MV3 extension for Chrome and Edge: `manifest.json`, `src/service-worker.ts`, `src/popup.ts`, `src/lib/*`; built into `extension/dist/` |

## Tests and tooling

| Path | Role |
|---|---|
| `tests/` | Vitest specs mirroring `src/main` (`jobs/`, `engines/`, `server/`, `ytdlp/`, `renderer/`) |
| `tests/fakes/` | `fake-ytdlp.mjs` (scripted child process) and `fake-aria2.ts` (in-process RPC stand-in) |
| `tests/helpers.ts`, `tests/wait.ts` | `makeJob`, `makeSettings`, `waitFor`, `sleep` |
| `e2e/real/` | Opt-in Playwright driver for the manual checklist (real sites, real tools) |
| `.github/workflows/ci.yml` | Typecheck, lint, test, build on Windows, Node 22 and 24 |
| `docs/` | Manual checklists (living), screenshots, `superpowers/` design spec and frozen plans |
