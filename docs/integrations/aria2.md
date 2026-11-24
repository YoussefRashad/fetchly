# aria2

Direct-file jobs (`kind: 'file'`). Code: `src/main/engines/file.ts`, `src/main/engineHost.ts`. Specs:
`tests/engines/file.test.ts`, `tests/engineHost.test.ts`, with `tests/fakes/fake-aria2.ts` as an in-process RPC
stand-in.

## Daemon and auth

- `aria2c` from `%APPDATA%\fetchly\bin`, spawned with `stdio: 'ignore'`, working directory
  `%APPDATA%\fetchly\aria2`.
- RPC on `127.0.0.1` only (`--rpc-listen-all=false`), on a free port found by listening on port 0.
- A per-run RPC secret (16 random bytes) is passed as `--rpc-secret` and sent as `token:<secret>` with each call.
  It is never stored or logged.
- Ready when `getVersion` answers: up to 20 tries, 250 ms apart; otherwise the process is killed and the engine
  reports "aria2 did not start".

## Calls

HTTP JSON-RPC `POST http://127.0.0.1:<port>/jsonrpc`, 5 s timeout per call. Status is polled with `tellStatus`
every 500 ms; after 5 unanswered polls the job shows as stalled.

Download options: `--continue=true --auto-save-interval=1`, 8 connections and 8 splits (1M minimum split),
`--auto-file-renaming=false --allow-overwrite=false --max-tries=3 --retry-wait=5`.

Only plain HTTP(S): `--follow-torrent=false --follow-metalink=false`, DHT, DHT6, local peer discovery and peer
exchange off, `--seed-time=0`. A link to a `.torrent` or metalink is saved as a file, never followed.

## Errors, retries and restart

- A fixed set of aria2 error codes is final; any other failure is retryable and follows the queue's retry rule
  (up to 3 times, after 5 s, 20 s, 60 s).
- Retries resume from the `.aria2` control file next to the download. A late aria2 answer never releases a job
  that was restarted, and a job is never added to aria2 twice.
- No automatic daemon restart. When aria2 fails, the `engine` banner offers a retry, which runs
  `EngineHost.retry()` (single-flight); `FileEngine.attach` releases the tracked jobs with a retryable error.

## Stop

Pause runs `forcePause`, then `remove`; partial files are kept. At quit the daemon gets `aria2.shutdown`, then
`child.kill()`, inside the 5 s quit budget.

## Logging

Nothing is logged.
