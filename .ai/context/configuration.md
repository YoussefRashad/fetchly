# Configuration

Names only, never values. Fetchly has no `.env` file and reads no secrets from the environment.

## User settings (`%APPDATA%\fetchly\settings.json`)

Defaults: `src/main/jobs/store.ts`. Validation and clamping: `src/main/jobs/validate.ts`. Type: `Settings` in
`src/shared/types.ts`. Each invalid or missing field falls back to its own default.

| Field | Type | Default | Check |
|---|---|---|---|
| `language` | `'system' \| 'en' \| 'ar'` | `system` | `isLanguageSetting` (exact lower case) |
| `theme` | `'system' \| 'light' \| 'dark'` | `system` | `isThemeSetting` |
| `downloadDir` | string | `<Downloads>\Fetchly` | absolute Windows path |
| `askEveryTime` | boolean | `false` | |
| `maxConcurrent` | number | 3 | finite; clamped to 1 to 8 |
| `speedLimitKbps` | number | 0 (no limit) | finite; at least 0 |
| `autoResumeOnStart` | boolean | `false` | |
| `preferMp4Max1080` | boolean | `false` | |
| `defaultQuality` | `Quality` | `{ kind: 'best' }` | `isQuality` |
| `subtitleLangs` | string[] | `[]` | at most 10 language codes |
| `serverPort` | integer | 38917 (`DEFAULT_SERVER_PORT`) | 1024 to 65535; an invalid value becomes the default, never clamped |

Changing `serverPort` clears every pairing after a confirmation (`setSettings`, `src/main/ipc.ts`).

## Environment variables

| Variable | Required | Secret | Used by | Purpose |
|---|---|---|---|---|
| `ELECTRON_RENDERER_URL` | no | no | `src/main/index.ts` | Set by electron-vite in `npm run dev`; loads the dev server instead of the built page |
| `PYTHONIOENCODING`, `PYTHONUTF8` | no (set by the app) | no | `src/main/engines/media.ts`, `src/main/probe.ts` | Set for yt-dlp child processes so its output is UTF-8 |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | no | no | `.github/workflows/ci.yml` | CI does not fetch the Electron binary |
| `FETCHLY_E2E_DIR` | no | no | `e2e/real/lib.mjs` | Output root of the real-app checks (default `.e2e-real`) |
| `FETCHLY_E2E_ELECTRON` | no | no | `e2e/real/lib.mjs` | Overrides the Electron executable path |
| `FAKE_YTDLP`, `FAKE_YTDLP_ARGS`, `FAKE_YTDLP_HEIGHTS`, `FAKE_YTDLP_PROBE_BYTES` | no | no | `tests/fakes/fake-ytdlp.mjs` | Script the yt-dlp stand-in in tests |

No build-time defines: `electron.vite.config.ts` has no `define`, and `import.meta.env` is not used.

## Fixed constants worth knowing

- aria2 checksum: `ARIA2_ZIP_SHA256` in `src/main/binaries.ts` (pinned; empty refuses the install).
- Server limits: `src/shared/protocol.ts` (`BODY_LIMIT` 64 KiB, `MAX_PAIRINGS` 4, port range).
- Retry delays: `RETRY_DELAYS_MS` in `src/main/jobs/queue.ts` (5 s, 20 s, 60 s).
