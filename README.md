# Hammel

A personal download manager for Windows. Paste a link and it downloads a
video, a whole playlist, or any direct file (PDF, zip, video file), with a
choice of quality and pause/resume that survives closing the app.

It is a window and a queue around three free tools that do the real work:

| Tool | Job |
| --- | --- |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | reads video sites and downloads the streams |
| [ffmpeg](https://github.com/yt-dlp/FFmpeg-Builds) | joins video and audio into one file |
| [aria2](https://github.com/aria2/aria2) | downloads ordinary files over several connections |

Protected (DRM) content is not supported and is reported as `skipped: protected`.

## Run it

Requires Node.js 22 or newer.

```powershell
npm install
```

```powershell
npm run dev
```

If the app refuses to start with "Electron uninstall", the Electron runtime
was not fetched during `npm install`. Fetch it once:

```powershell
node node_modules/electron/install.js
```

On first start the app shows a one-time setup screen and downloads the three
tools from their official GitHub release pages. yt-dlp and ffmpeg are checked
against the checksums published with each release. aria2 publishes none, so
its checksum is pinned in `src/main/binaries.ts` (`ARIA2_ZIP_SHA256`); while
that value is empty the setup refuses to install aria2.

A build that runs without the dev server:

```powershell
npm run build
```

```powershell
npm start
```

Windows SmartScreen may warn the first time, because the app is not signed.

## Where things live

| What | Where |
| --- | --- |
| Downloads | `Downloads\Hammel` (change it in Settings) |
| Download list and settings | `%APPDATA%\hammel\jobs.json`, `settings.json` |
| The three tools | `%APPDATA%\hammel\bin` |

Closing the window keeps downloads running; the app lives in the tray, and
**Quit** is in the tray menu.

## Develop

```powershell
npm run typecheck
```

```powershell
npm run lint
```

```powershell
npm test
```

The tests use no network and no real tools: `tests/fakes` holds a scripted
stand-in for yt-dlp and an in-process stand-in for aria2. What only real
sites can prove is in [docs/manual-checklist-phase1.md](docs/manual-checklist-phase1.md).

Design: [docs/superpowers/specs/2026-11-22-download-manager-design.md](docs/superpowers/specs/2026-11-22-download-manager-design.md)

## Layout

```
src/shared/types.ts      types used by both sides
src/main/jobs/           state machine, persistence, queue
src/main/engines/        yt-dlp and aria2 supervision
src/main/ytdlp/          argument building and output parsing
src/main/binaries.ts     fetch and verify the tools
src/main/ipc.ts          what the window may ask for
src/preload/             the bridge exposed as window.hammel
src/renderer/            the window (React)
```
