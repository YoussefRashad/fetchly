# Job lifecycle

Code: `src/main/jobs/state.ts` (transition table), `src/main/jobs/queue.ts` (slots, retries, pause, quit),
`src/main/queueLifecycle.ts` (auto-resume). Specs: `tests/jobs/state.test.ts`, `tests/jobs/queue.test.ts`,
`tests/queueLifecycle.test.ts`.

## States and events

```
queued -start-> probing -firstProgress-> downloading -merging-> merging -done-> done
```

| Event | From | To |
|---|---|---|
| `start` | queued | probing |
| `firstProgress` | probing | downloading |
| `merging` | probing, downloading | merging |
| `done` | probing, downloading, merging | done |
| `pause` | queued, probing, downloading | paused |
| `resume` | paused | queued |
| `retry` | failed | queued (resets `attempts` to 0) |
| `fail` | queued, probing, downloading, merging | failed |
| `skip` | queued, probing, downloading | skipped |
| `interrupt` | probing, downloading, merging | paused |
| `requeue` | probing, downloading | queued |

Anything else throws `IllegalTransition`; the queue checks `canApply` first and ignores an event that does not
apply. `probing`, `downloading` and `merging` are active: they hold a queue slot.

## Queue rules

- At most `maxConcurrent` active jobs (1 to 8, default 3), counted across all playlists, not per playlist.
- A playlist is a group whose items are separate jobs: each can be paused, cancelled and retried alone. A group
  verb (`pause`, `resume`, `cancel`, `Queue.group`) runs the same verb on every item of the group.
- Automatic retry: a retryable failure with fewer than 3 attempts goes back to `queued` with reason
  "retrying (n/3)", after 5 s, 20 s, then 60 s. A final error fails the job with its reason.
- Pause frees the slot only after the engine confirms the stop; otherwise the user is told the pause was not
  confirmed and the job keeps its slot.
- A finished file gets Mark-of-the-Web before the job shows as `done`.
- At quit, active jobs are saved as interrupted before their engines stop.

## After a crash

A job that was active loads as `paused` with `interrupted: true` (cut off). If the leftover-process cleanup
succeeded at start, the mark is cleared. Otherwise resume is refused with the cut-off message until the user
confirms the processes are gone (`confirmStraysGone`, offered by the `cutOff` banner). Auto-resume at start
(`autoResumeOnStart`) passes over cut-off jobs.

## Every failure says why

A failed or skipped job always carries a `reason`. Playlist entries that cannot be downloaded become skipped jobs
with `private`, `removed` or `unavailable`. A yt-dlp error mentioning DRM skips the job with reason `protected`
(`src/main/ytdlp/parse.ts`).
