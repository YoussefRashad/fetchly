# Decisions

Each ADR names the evidence that establishes it. No evidence, no ADR: describe the technology in `.ai/context/`
and add the missing rationale to `TODO.md` instead.

| ADR | Decision | Status |
|---|---|---|
| [001](001-electron-desktop-app.md) | Electron and TypeScript desktop app, plus a browser extension | Accepted |
| [002](002-wrap-external-tools.md) | Wrap yt-dlp, ffmpeg and aria2; fetch them at first run | Accepted |
| [003](003-no-drm.md) | Protected (DRM) content is out of scope | Accepted |
| [004](004-local-server-protocol.md) | Loopback server: POST-only JSON, port-bound pairing and server proof | Accepted |

The dated plans in `docs/superpowers/plans/` and `docs/plans/` are frozen records of how decisions were made.
Do not edit them; a later change gets a new plan or a new ADR.
