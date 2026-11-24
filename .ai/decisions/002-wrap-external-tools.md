# ADR-002: Wrap yt-dlp, ffmpeg and aria2; fetch them at first run

- Status: Accepted
- Evidence: `docs/superpowers/specs/2026-11-22-download-manager-design.md`, "Pieces" and "Two kinds of job";
  `README.md`, "Run it"; enforced in `src/main/binaries.ts`.

## Context
yt-dlp breaks whenever a site changes, so the app must update it without a new app build (design spec,
"Constraints").

## Decision
Fetchly is a window, a queue and a process supervisor. yt-dlp (with ffmpeg to merge streams) handles media jobs;
aria2 over JSON-RPC handles direct-file jobs. The three tools are not bundled in the repository: the app fetches
them at first run from their official release pages into `%APPDATA%\fetchly\bin` and checks them against a
checksum (aria2's is pinned in `src/main/binaries.ts`, `ARIA2_ZIP_SHA256`). Settings offers "Update yt-dlp".

## Alternatives considered
Not recorded.

## Consequences
`%APPDATA%\fetchly\bin` belongs to the app: at start it ends every yt-dlp, ffmpeg or aria2c process running from
that folder (`README.md`, "Where things live"). Tests never run the real tools; they use the stand-ins in
`tests/fakes/`.
