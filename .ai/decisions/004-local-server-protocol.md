# ADR-004: Loopback server for the extension: POST-only JSON, port-bound pairing and server proof

- Status: Accepted
- Evidence: `docs/superpowers/plans/2026-11-22-phase2-architecture.md`, section 1, decisions D1, D3, D6 and D8,
  and section 2 (threat model); enforced in `src/main/server/server.ts`, `src/main/server/pairing.ts` and
  `src/shared/protocol.ts`.

## Context
The extension hands URLs to the app over `127.0.0.1`. Web pages, other extensions and other local processes can
reach the same port.

## Decision
- Every endpoint is `POST` with JSON (D1): a POST always carries `Origin`, and a JSON POST from a page needs a
  preflight, which is refused.
- Several pairings (Chrome and Edge), each bound to its own extension origin (D3).
- `/v1/hello`: the server proves itself, bound to the dialled port, before the extension sends its token (D6).
- The port is part of the pairing: the app shows `<port>-<code>`, and changing the port means pairing again (D8).

## Alternatives considered
Not recorded beyond the reasons in the plan's decision table.

## Consequences
Same-user code can read `pairing.json` and the extension's storage; that is not defended and is stated in
`README.md`. Availability (a local process filling the connections or holding the port) is not defended.
