# Development rules

## Scope

- Change only what the task needs. Note unrelated problems in `TODO.md` or the task report instead of fixing them.
- Reuse the patterns in `code-patterns.md`.
- Keep the gates green: `npm run typecheck`, `npm run lint`, the specs you touched, `npm run build` (and
  `npm run build:ext` where `extension/` exists). ESLint config: `eslint.config.mjs`; TypeScript is `strict` with
  `noUncheckedIndexedAccess` in both `tsconfig.node.json` and `tsconfig.web.json`.
- Windows is the only target platform. Paths in persisted files and settings are Windows paths.

## Backward compatibility

- Persisted files (`jobs.json`, `settings.json`, `pairing.json`) must keep loading after every change. A shape
  or version change is migration-class (`docs/persistence.md`): explicit migration, fixtures for every older
  shape, owner review before commit.
- The browser wire protocol (`src/shared/protocol.ts`, `PROTOCOL = 1`) is shared with the extension. A change to
  a route, a body key, a limit or an error token changes both sides and their specs together.
- User-facing text changes in English and Arabic together.

## Tests

- Specs live in `tests/` and mirror `src/`. No network and no real tools in specs: use the fakes in
  `tests/fakes/`.
- For each rule "X is invalid, unknown or rejected when Y", tests MUST cover Y absent, Y present
  but inconsistent, and the boundary. Every documented promise MUST have a test that proves it.

## Test-run hygiene

- Agents MUST run only the specs they touch (`npx vitest run <files>`); only one full-suite or
  acceptance run MUST run at a time.
  Timing-sensitive specs can fail under concurrent test load: several specs start real child processes
  (`tests/fakes/fake-ytdlp.mjs`) or race deadlines (stop timeouts, listen deadlines).
- The full suite (`npx vitest run`) and the real-app checks (`npm run e2e:real`) run only while holding the shared
  suite lock: create `.fetchly-suite.lock` in the parent directory of the main clone with an exclusive create
  (fail if it exists), run, then delete it. Every worktree of the repository uses the same lock file. If the lock
  exists, wait; never delete a lock you did not create.
- A red run is loaded only when another test or acceptance run was observably running at the same
  time; focused specs count. Record the red run and the overlap evidence, then rerun it alone.
  The isolated rerun is the counting result. A red isolated rerun is a failure. Without observed
  overlap, do not dismiss a failure as load. Use the same rule in the acceptance record.
- `npm run e2e:real` uses the network and the real tools and writes to `.e2e-real/`. Ask before running it; it
  never runs in CI.

## Documentation

- Living docs: `README.md`, `docs/manual-checklist-*.md`, `.ai/context/*`, `docs/*.md`. Update the ones your
  change makes wrong, in the same change.
- Frozen: `docs/plans/**` and `docs/superpowers/plans/**`. Never edit them; record drift in the living doc.
- The repository is public: no secrets, personal data, machine names or user-name paths in docs, specs, fixtures
  or comments.
