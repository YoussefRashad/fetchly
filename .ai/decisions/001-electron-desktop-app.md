# ADR-001: Electron and TypeScript desktop app, plus a browser extension

- Status: Accepted
- Evidence: `docs/superpowers/specs/2026-11-22-download-manager-design.md`, "Approaches considered" (approach 1
  "Picked by the owner"; "Electron over Tauri ... one language (TypeScript) end to end").

## Context
Fetchly replaces a paid Windows download manager. Long playlists need a persistent list, a tray icon, and
downloads that keep running with the browser closed (design spec, "Intent and why", "Goals").

## Decision
A desktop app on Electron with a React renderer, all in TypeScript, plus a Manifest V3 extension for Chrome and
Edge that hands URLs to the app.

## Alternatives considered
From the design spec: a local Node service with a browser page as the UI (no window, no tray), and the extension
popup as the whole UI with a headless helper (too small for an 80-item playlist, no UI with the browser closed).
Tauri was rejected for a single language end to end.

## Consequences
The app is about 150 MB (design spec). Windows only: macOS and Linux builds, a signed installer and app
auto-update are non-goals (design spec, "Non-goals").
