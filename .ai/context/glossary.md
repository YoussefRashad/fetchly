# Glossary

## Domain terms (`src/shared/types.ts` unless noted)

| Term | Meaning |
|---|---|
| Job | One download (`Job`). Key fields: `state`, `reason` (why it failed or was skipped), `baseName` (fixed so resume finds its partial files), `interrupted` (cut off at a crash; resume refused until leftovers are checked), `attempts` |
| Group | A playlist: one `Group`, every item its own job |
| `JobKind` | `media` (yt-dlp, with ffmpeg) or `file` (aria2) |
| `JobState` | `queued`, `probing`, `downloading`, `paused`, `merging`, `done`, `failed`, `skipped`. See `docs/business-rules/job-lifecycle.md` |
| `Quality` | `best`, `max` with a height from `HEIGHTS` (2160 to 360), or `audio` (`m4a` or `mp3`) |
| Probe | Asking yt-dlp (or an HTTP Range request) what a link is: `ProbeResult` is a media item, a playlist or a file |
| `EntryReason` | Why a playlist entry cannot be downloaded: `private`, `removed`, `unavailable` |
| Engine | The supervisor of one tool: media engine (yt-dlp) or file engine (aria2). `EngineStatus`: `notInstalled`, `starting`, `ready`, `error` |
| Engine host | `src/main/engineHost.ts`: single-flight start, retry and restart of the aria2 daemon |
| Strays | Leftover yt-dlp, ffmpeg or aria2c processes from the app's own `bin` folder (`src/main/strays.ts`) |
| Cut off | A job that was running when the app stopped (`interrupted: true`) |
| Tool gate | `src/main/toolGate.ts`: serializes stray cleanup, probes and tool updates |
| Mark-of-the-Web | The `Zone.Identifier` stream written on every finished file (`src/main/fileSafety.ts`) |
| Runnable file | An extension in `RUNNABLE` (`src/main/fileSafety.ts`); opening one asks first |
| Pairing | A browser extension trusted by the app: id, origin, port, `tokenHash`, `proofKey`, label (`pairing.json`) |
| Pairing code / pairing string | 8-character one-time code, shown as `<port>-<code>` |
| Server proof / hello | `/v1/hello` answer proving the app owns the dialled port (HMAC with `proofKey`) |
| `ServerStatus` | `listening`, `portBusy`, `error` |
| `Result<T>` | IPC return shape: `{ ok: true, value }` or `{ ok: false, error }` |
| `FetchlyApi` | The `window.fetchly` bridge the renderer sees |
| Banner | Persistent problem notice in the window: `engine`, `server`, `save`, `cutOff` |

## UI glossary (English and Arabic)

Every user-facing string has an English and an Arabic version. Arabic UI text follows these rules, enforced by
`tests/renderer/strings.test.ts` for both `src/renderer/src/strings.ar.ts` and `src/main/shellStrings.ts`:

| English | Arabic | Rule |
|---|---|---|
| download (noun and verb) | تنزيل (and its forms, such as يُنزِّل) | Never تحميل |
| digits | 0-9 | Western digits only, never ٠-٩ or ۰-۹; dates use `ar-EG-u-nu-latn` |

Values embedded in Arabic sentences are wrapped with `fsi()` (first-strong isolate) so mixed-direction text
reads correctly. Product, tool and protocol names (Fetchly, yt-dlp, ffmpeg, aria2, Chrome, Edge) are not
translated.
