# Fetchly documentation map

Project rules for the `docs-sync` agent. They add to `.ai/agents/docs-sync.md` and never relax it.

| Change | Doc |
|---|---|
| `jobs.json`, `settings.json` or `pairing.json` shape, version, load or write | `docs/persistence.md`; `.ai/context/configuration.md` for a settings field |
| Server route, body, limit, header rule or error token | `docs/api-conventions.md`, `.ai/context/error-contract.md`, `.ai/context/critical-modules.md` |
| IPC channel added or changed | `docs/api-conventions.md` (IPC), `.ai/context/code-patterns.md` if the pattern changes |
| Job state, transition, queue or retry rule | `docs/business-rules/job-lifecycle.md` |
| yt-dlp, ffmpeg, aria2 or tool-download behaviour | `docs/integrations/yt-dlp.md`, `aria2.md`, `tool-downloads.md` |
| A log line added, removed or changed | `.ai/context/critical-modules.md`, "Logging and redaction" |
| User-visible feature or behaviour | `README.md` |
| Something a person must check on real sites or browsers | `docs/manual-checklist-phase1.md` or `docs/manual-checklist-phase2.md` |
| Arabic UI wording rule | `.ai/context/glossary.md`, "UI glossary" |

Rules:

- Never edit `docs/plans/**` or `docs/superpowers/plans/**`. When a frozen plan records drift, update the living
  doc above instead.
- The repository is public: no secrets, personal data, machine names or user-name paths.
