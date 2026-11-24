# yt-dlp and ffmpeg

Media jobs (`kind: 'media'`). Code: `src/main/engines/media.ts`, `src/main/ytdlp/args.ts`,
`src/main/ytdlp/parse.ts`, `src/main/probe.ts`. Specs: `tests/engines/media.test.ts`, `tests/ytdlp/*`,
`tests/probe.test.ts`, with `tests/fakes/fake-ytdlp.mjs` standing in for the real tool.

## Auth

None by the app. Phase 2 plans cookies from the browser session for login-gated sites; nothing on `main` sends
cookies yet.

## Calls

| Call | Arguments | Timeout |
|---|---|---|
| Link probe (`probeArgs`) | `-J --flat-playlist --no-warnings <url>`, run with `execFile`, 64 MB output buffer | 30 s; on "unsupported site" or a generic direct link, falls back to an HTTP Range probe (20 s) |
| Height probe (`heightProbeArgs`) | `-J --no-playlist --no-warnings -- <url>`, before a Best download with no known height | 30 s |
| Download (`downloadArgs`) | `--no-playlist --newline --progress --no-warnings --continue --no-overwrites --retries 3`, `--ffmpeg-location`, `-P <dir> -o <base>.%(ext)s`, a `FETCHLY_PROGRESS` progress template, `--print after_move:FETCHLY_FILE ...`, format and merge flags, optional subtitles and `--limit-rate`, then `-- <url>` | none (stopped by the user or the queue) |

Spawned with `windowsHide`, no shell, stdin ignored, and `PYTHONIOENCODING=utf-8`, `PYTHONUTF8=1`. stderr is kept
up to 64 KB.

ffmpeg is never called for media directly: yt-dlp uses it through `--ffmpeg-location` to merge, extract audio or
remux. Video above 1080p is never re-encoded. The app runs `ffmpeg -version` only to check the install.

## Output parsing

`parseLine` reads the progress lines, the final file line and `[Merger]` / `[ExtractAudio]` lines (shown as
merging). If yt-dlp exits 0 without printing a path, the engine looks for `<base>.<media ext>` in the folder.

## Errors and retries

- An ordered table of patterns (`parse.ts`) marks known errors as final (not retryable). Any other error is
  retryable; its reason is the last `ERROR:` line, capped at 200 characters.
- yt-dlp retries itself (`--retries 3`). The queue then retries a retryable failure up to 3 times, after 5 s,
  20 s and 60 s (`RETRY_DELAYS_MS`, `src/main/jobs/queue.ts`).
- Retry and resume reuse the partial data: `--continue`, a fixed `baseName`, and the height probe is skipped once
  bytes have arrived. A stop keeps the partial files. This is resume from the same output name, not a proven
  idempotent operation against the site; a site change between attempts can still fail the job.

## Stop and cancel

Stop runs `taskkill /T /F` on the process tree (yt-dlp and its ffmpeg), falling back to `child.kill()`, and waits
up to 10 s for the exit. Cancel deletes only the job's own partial files (`isPartialOf`), and only after the stop
is confirmed.

## Logging and redaction

Nothing is logged. Tool output is parsed line by line, never forwarded whole; only the capped reason reaches the
window.

## Updating

Settings → "Update yt-dlp" replaces the binary through `src/main/binaries.ts` (see `tool-downloads.md`).
