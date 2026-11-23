# Fetchly

<!-- project-setup:begin id=overview -->
Fetchly is a Windows desktop download manager (videos, playlists, direct files) with pause/resume that survives
restarts. It is a window, a queue and a process supervisor around yt-dlp, ffmpeg and aria2, plus a Chrome/Edge
Manifest V3 extension that hands links to the app over a loopback server. Not a backend service: there is no
database and no hosted API. The repository is public.

Stack (from manifests, not guessed): Electron 45.4.1, React 19.3.1, TypeScript 6.0.3 (`strict`,
`noUncheckedIndexedAccess`), electron-vite 6.0.0, Vite 8.3.8, Vitest 5.1.1, ESLint 10.15.0 with typescript-eslint,
yauzl 3, playwright-core 1.49.1 (opt-in real-app checks only). Extension: `extension/` (MV3), built with
`npm run build:ext`; it is on the `feat/phase2-*` branches and not yet on `main`.
Package manager: npm (`package-lock.json`) · Runtime: Node.js 22 or newer (CI runs 22 and 24 on `windows-latest`)
<!-- project-setup:end id=overview -->

<!-- project-setup:begin id=critical-rules -->
## Critical rules (apply to every task, every agent)

- Never read, print, copy, or summarize files matching `.ai/security-paths.json`
  (`.env*`, keys, certificates, `secrets/`, `credentials/`, …) directly or through arbitrary scripts.
  The only environment-template exception is the reviewed project-setup `env-keys.mjs` and
  `apply.mjs` flow for the root `.env.example`. Agents MUST NOT open that file directly.
  Other `.env*` files remain denied. This exception does not authorize arbitrary scripts or
  changes to user-level denies. Reports contain key names and value classifications, never values.
  Read diffs and history only via `node .ai/tools/git-safe.mjs diff|log|show …`.
  Env variable names come from config/validation code or the project-setup `env-keys` script, never from env files.
- Never log or return personal data or secrets. Redact before logging. The app logs one line only (a route path
  and an error name in `src/main/server/server.ts`); keep it that way. Tokens, pairing codes, cookies and full
  tool output are never logged, stored in `jobs.json` or sent over IPC.
- The repository is public: no secrets, personal data, machine names or user-name paths in any committed file.
- Sensitive areas: the local server, pairing, tokens and the `/v1/hello` signed proof (`src/main/server/**`,
  `src/shared/protocol.ts`) and the extension's client side (`extension/src/**`). Read
  `.ai/context/critical-modules.md` and `src/main/server/AGENTS.md` first. The owner reviews every diff here line
  by line before it is committed.
- Every local-server route and every IPC handler validates its input in the main process and enforces its own
  checks explicitly (token and origin for server routes; `unknown` type guards for IPC). Never trust the renderer
  or the extension.
- Child processes get one argv element per value and no shell. URLs are checked to be http(s) first
  (`validateUrl`, `src/main/probe.ts`), and new yt-dlp argument lists put `--` before the URL
  (`src/main/ytdlp/args.ts`).
- Database changes follow the project's own policy: there is no database. Persisted state is versioned JSON in
  `%APPDATA%\fetchly` (`jobs.json`, `settings.json`, `pairing.json`), written atomically and validated strictly on
  load. A change to the shape or version of any of these files is migration-class: older files must still load
  (or be set aside with a notice, never silently lost), the change ships with fixtures and specs, and the owner
  reviews it before commit. See `docs/persistence.md` and `src/main/jobs/AGENTS.md`.
- No retry without proven idempotency. Downloads resume from partial data; see `docs/integrations/`.
- Every user-facing string exists in English and Arabic (`src/renderer/src/strings.ts` + `strings.ar.ts`,
  `src/main/shellStrings.ts`). Arabic says تنزيل for download, never تحميل, and uses Western digits (0-9) only.
  `tests/renderer/strings.test.ts` enforces both.
- Frozen plans are never edited: `docs/plans/**` and `docs/superpowers/plans/**`. Living docs are `README.md`, the
  manual checklists (`docs/manual-checklist-*.md`) and the files under `.ai/context/` and `docs/`.
- Protected (DRM) content is out of scope: never add decryption or key extraction (`.ai/decisions/003-no-drm.md`).
- Do not change unrelated code. Prefer existing patterns and services over new abstractions.
- For authorized external review, follow project-setup's security reference to prevent disclosure.
  MUST use trusted shipped defaults union .ai/security-paths.json patterns plus projectPatterns.
  MUST establish exclusions and coverage from the trusted checkout. MUST NOT run if policy is
  absent, invalid or unreadable, or trusted defaults cannot be located (for example, when
  project-setup is not installed), or payload exclusions or scanning cannot be proven.
  MUST exclude matching paths from actual outgoing content: context, both rename sides and history.
  MUST scan for secret-shaped strings; never print or send matches. Resolve matches before sending.
  An in-range policy edit MUST NOT shrink coverage. On trusted policy or payload change, MUST
  re-establish exclusions and rescan. git-safe and names-only checks do not prove payload coverage.
  MUST NOT use partial coverage. These prerequisites grant no permission to transmit content.
  Canonical reviewer and docs-sync still prohibit transmission.
<!-- project-setup:end id=critical-rules -->

<!-- project-setup:begin id=commands -->
## Commands

Gates (run all before a commit; CI runs the first four on every push and pull request):

- `npm run typecheck`: `tsc --noEmit` for `tsconfig.node.json` and `tsconfig.web.json`.
- `npm run lint`: ESLint over the repository.
- `npx vitest run <spec files>`: the specs you touched. No network, no real tools.
- `npm run build`: electron-vite build of main, preload and renderer into `out/`.
- `npm run build:ext`: builds the extension. Only where `extension/` exists (the Phase 2 branches until merged).
- `npx vitest run` (full suite, same as `npm test`): only under the shared suite lock. One full-suite or
  real-app run per machine at a time: timing-sensitive specs (child processes, deadlines) fail under load.
  Take the lock by creating `.fetchly-suite.lock` in the parent directory of the main clone with an exclusive
  create (it must fail if the file exists, for example
  `node -e "require('fs').closeSync(require('fs').openSync(process.argv[1],'wx'))" <path>`), run the suite, then
  delete the file. Every worktree uses the same lock file. If it exists, wait; never delete another run's lock.

Other scripts:

- `npm install`, then `npm run dev`: the app with the Vite dev server. If Electron reports "Electron uninstall",
  run `node node_modules/electron/install.js` once.
- `npm start`: preview the built app (after `npm run build`).
- `npm run e2e:real -- <check numbers|all>`: drives the built app through `docs/manual-checklist-phase1.md` with
  Playwright, on a scratch profile in `.e2e-real/`. Uses the network and the real tools; never in CI.
  Ask before running, and run it under the suite lock.
<!-- project-setup:end id=commands -->

<!-- project-setup:begin id=navigation -->
## Where to look (read on demand, not all at once)

| Need | Read |
|---|---|
| Module map, dangerous modules | `.ai/context/project-tree.md` |
| Conventions to copy | `.ai/context/code-patterns.md` |
| Error shapes (server tokens, IPC results, banners) | `.ai/context/error-contract.md` |
| Pairing / tokens / persisted state / file safety | `.ai/context/critical-modules.md` |
| Configuration (settings fields, env names only) | `.ai/context/configuration.md` |
| Terms, UI glossary (EN/AR) | `.ai/context/glossary.md` |
| Testing and change hygiene | `.ai/context/development-rules.md` |
| Local server protocol and IPC conventions | `docs/api-conventions.md` |
| Persisted files and their change policy | `docs/persistence.md` |
| Job states and queue rules | `docs/business-rules/job-lifecycle.md` |
| yt-dlp / ffmpeg, aria2, tool downloads | `docs/integrations/` |
| Decisions and their evidence | `.ai/decisions/README.md` |
| Design record and frozen plans | `docs/superpowers/specs/`, `docs/superpowers/plans/`, `docs/plans/` |
| Open questions and known gaps | `TODO.md` |
<!-- project-setup:end id=navigation -->

<!-- project-setup:begin id=local-instructions -->
## Directory-specific instructions

Before changing files under these paths, read the listed file first (tools do not all load them automatically):

- `src/main/server/` and `src/shared/protocol.ts`: read `src/main/server/AGENTS.md`.
- `src/main/jobs/` and `src/main/atomicFile.ts`: read `src/main/jobs/AGENTS.md`.
<!-- project-setup:end id=local-instructions -->

<!-- project-setup:begin id=agents -->
## Shared agents

- `reviewer`: evidence-based review. Definition: `.ai/agents/reviewer.md`.
- `docs-sync`: update docs after merged changes. Definition: `.ai/agents/docs-sync.md`.

Both tools run the same definitions through thin wrappers (`.claude/agents/`, `.codex/agents/`).
When a review or doc sync is requested, use these named agents (`reviewer`; `docs-sync` in Claude, `docs_sync` in
Codex). Do not create an ad-hoc agent for the same job.

When you delegate to `reviewer` or `docs-sync`, state in every brief the session's
original start directory, the repository root and the current directory. Do not invent
a start directory you were not given; say that it is unknown instead.

Text between `<!-- project-setup:begin ... -->` and `<!-- project-setup:end ... -->`
markers in AGENTS.md, CLAUDE.md and .gitignore is managed by project-setup. Every
agent, including a retained project agent that does not load a canonical definition,
MUST NOT add, remove or move these markers, and MUST change text inside a block only
when a code change makes that text wrong. It MUST then name the file and the block
id in its output, because the next project-setup update shows that edit for a keep,
take-new or merge decision and can otherwise replace it.
<!-- project-setup:end id=agents -->
