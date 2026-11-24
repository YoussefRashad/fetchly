# Persistence

Fetchly has no database. Its state is a few JSON files in the app data folder, `%APPDATA%\fetchly`
(`app.getPath('userData')`, set in `src/main/index.ts`). This file plays the role a database guide plays in a
backend project.

## Files

| File | Owner | Shape | Write | Load |
|---|---|---|---|---|
| `jobs.json` | `src/main/jobs/store.ts` | `{ version: 1, jobs, groups }`, compact JSON | `writeAtomic` on every commit; progress-only changes at most every 5 s | `parseSnapshotFile` (`validate.ts`), all or nothing |
| `settings.json` | `src/main/jobs/store.ts` | `Settings`, pretty-printed, after `normalizeSettings` | `writeAtomic` when Settings are saved | per field, each falling back to its default |
| `pairing.json` | `src/main/server/pairing.ts` | `{ version: 1, pairings: [{ id, origin, port, tokenHash, proofKey, label, pairedAt }] }`, at most 4 | `writeAtomic` on every change; retried on failure | strict, known keys only |
| `bin\*.exe` | `src/main/binaries.ts` | yt-dlp, ffmpeg, aria2c | staged as `.download` / `.exe.new`, then renamed | checked by `-version` |
| `aria2\` | `src/main/engines/file.ts` | aria2's working directory | aria2 | |

Next to the downloads themselves: yt-dlp `.part` / `.ytdl` files and aria2 `.aria2` control files hold the
partial data that resume uses; a `:Zone.Identifier` stream marks every finished file.

`pairing.json` holds key material derived from browser tokens (never the tokens). It lives in the roaming
profile; `README.md`, "Browser connection", tells the user what that means.

## Writing

`writeAtomic` (`src/main/atomicFile.ts`): write `<file>.tmp`, fsync, close, rename over the target. The directory
is not fsynced. A failed `jobs.json` save never throws: it raises the `save` banner and is retried every 60 s.
A failed `pairing.json` write keeps the change in memory and retries on the next change, every 30 s and at quit.

## Loading and recovery

- `jobs.json`: `version` must be absent or 1. One invalid job or group, a duplicate id or a group id with no group
  makes the whole file invalid; it is renamed to `jobs.json.corrupt-<ms>`, the app starts with an empty list and
  says so. Out-of-range meters fall back to 0 or null instead. Empty groups are dropped.
- A job saved in an active state (`probing`, `downloading`, `merging`) loads as `paused` with `interrupted: true`.
- `settings.json`: a missing or unreadable file gives all defaults; each invalid field gives its default.
- `pairing.json`: an invalid or unreadable file is set aside as `pairing.json.corrupt-<ms>` with a notice;
  entries for another port are ignored without rewriting the file.

## Change policy (migration-class)

A change to the shape, keys, meaning or `version` of `jobs.json`, `settings.json` or `pairing.json` is a
migration:

1. A file written by every earlier released version must still load: migrate it explicitly, or set it aside with
   a notice. Never drop a user's download list silently.
2. Add fixtures for each older shape and specs for the absent, inconsistent and boundary cases.
3. Document the new shape here.
4. Stop for the owner's review of the diff before commit.

Never write a non-finite number or a secret (token, cookie, pairing code) into any of these files.
