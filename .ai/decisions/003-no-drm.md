# ADR-003: Protected (DRM) content is out of scope

- Status: Accepted
- Evidence: `docs/superpowers/specs/2026-11-22-download-manager-design.md`, "Non-goals"; `README.md`
  ("Fetchly never tries to decrypt it and lists such items as `skipped: protected`").

## Context
Some sites serve DRM-protected streams.

## Decision
Fetchly never attempts to decrypt protected content. Such items are listed as skipped, with the reason shown.

## Alternatives considered
Not recorded.

## Consequences
Do not add decryption, key extraction or any DRM workaround, in the app or the extension. A change that would
download a protected stream is out of scope, not a feature request.
