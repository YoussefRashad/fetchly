<!-- project-setup:begin id=local -->
# src/main/jobs: local rules

Applies to work under `src/main/jobs/` and to `src/main/atomicFile.ts`. The root AGENTS.md still applies.

These files own the job state machine and the two persisted files `jobs.json` and `settings.json`. A user's
download list must survive every upgrade, crash and bad write.

Rules, each enforced by the code today:

- Every state change goes through the table in `state.ts`. `transition()` throws `IllegalTransition` for anything
  else; `Queue.apply` checks `canApply` first. Add a transition to the table, never a direct state write. The one
  exception is the automatic retry in `queue.ts` (a retryable failure with fewer than 3 attempts goes back to
  `queued`); keep it there, not scattered.
- Writes go through `writeAtomic` (`src/main/atomicFile.ts`): temp file, fsync, rename. Never write these files
  in place.
- Loading is strict (`validate.ts`): jobs are rebuilt from known keys only, and one invalid job, a duplicate id or
  a missing group makes the whole `jobs.json` invalid. An invalid file is renamed to `jobs.json.corrupt-<ms>` and
  reported, never deleted or overwritten. `settings.json` falls back per field to its default.
- `jobs.json` carries `version: 1`. Any other version makes the file invalid today. A shape or version change is
  migration-class: keep older files loadable through an explicit migration, add fixtures for each older shape
  and specs for absent, inconsistent and boundary values, and stop for the owner's review before commit.
- A job saved while running loads as `paused` with `interrupted: true`. Resume stays refused until the check for
  leftover tool processes has run or the user confirms they are gone (`confirmStraysGone`). Do not weaken this:
  it prevents two processes writing one partial file.
- `save()` never throws: a failed save becomes a save error banner and is retried. Keep failures visible, never
  silent.
- An invalid server port in settings falls back to the default port; it is never clamped.

Tests: `tests/jobs/*.test.ts`, `tests/queueLifecycle.test.ts`, `tests/atomicFile.test.ts`. Run only the specs
you touch; the full suite runs under the shared lock (root AGENTS.md, Commands). Details:
`docs/persistence.md`, `docs/business-rules/job-lifecycle.md`.
<!-- project-setup:end id=local -->
