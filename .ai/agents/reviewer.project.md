# Fetchly review rules

Project rules for the `reviewer` agent. They add to `.ai/agents/reviewer.md` and never relax it.

1. **Sensitive paths.** A change under `src/main/server/**`, `src/shared/protocol.ts` or `extension/src/**`
   (pairing, tokens, the `/v1/hello` proof, request checks) is sensitive. Check it against
   `src/main/server/AGENTS.md`, and state in the summary that the owner must review the diff line by line before
   commit. Findings here include: a refusal check moved after an authenticated step, a CORS header, a token or
   code that is stored, logged or compared without `timingSafeEqual`, the port dropped from the proof input, a
   body accepted with extra or missing keys, a new error token not in `ErrorToken`.
2. **Persisted formats are migration-class.** A change to the shape, keys, meaning or `version` of `jobs.json`,
   `settings.json` or `pairing.json` needs: older files still loading (or set aside with a notice), fixtures for
   each older shape, specs for absent, inconsistent and boundary values, and a note that the owner must review it.
   Anything missing is a finding. A write that bypasses `writeAtomic` is a finding.
3. **State machine.** A job state written directly instead of through `state.ts` (other than the existing
   automatic retry in `queue.ts`) is a finding.
4. **Child processes.** A shell, a concatenated argument string, or a URL that can reach a tool without the
   http(s) check is a finding. New yt-dlp argument lists put `--` before the URL.
5. **No new logging of request data, tokens, codes, cookies, credentials in URLs or whole tool output.** No secret
   in `jobs.json`, IPC payloads or argv.
6. **Window hardening.** Loosening `sandbox`, `contextIsolation`, `nodeIntegration`, the window-open and navigation
   handlers or the CSP in `src/renderer/index.html` is a finding.
7. **IPC.** A new channel must appear in `FetchlyApi`, the preload and `createHandlers`, take `unknown` arguments,
   validate them in main and return `Result<T>`.
8. **Text.** A user-facing string without both English and Arabic, Arabic تحميل for download, or Eastern Arabic
   digits is a finding.
9. **Frozen plans and public repository.** An edit to `docs/plans/**` or `docs/superpowers/plans/**` is a finding.
   So is a secret, personal data, a machine name or a user-name path in any committed file.
10. **Tests.** Specs must not use the network or the real tools. A spec that only passes when run alone, or
    depends on wall-clock timing without `waitFor`, is a finding.
