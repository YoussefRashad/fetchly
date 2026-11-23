# Code patterns

Copy these patterns; do not introduce a parallel style.

## IPC channel (renderer to main)

A new channel touches four places, always together:

1. `FetchlyApi` in `src/shared/types.ts`: the method signature, returning `Promise<Result<T>>`.
2. `src/preload/index.ts`: `call('<name>')`, which invokes `fetchly:<name>`. Push events use `subscribe()`
   (`fetchly:changed`, `fetchly:installProgress`, `fetchly:status`).
3. `createHandlers` in `src/main/ipc.ts`: a handler taking `unknown` arguments. Validate with hand-written type
   guards (`isObject`, `typeof` checks, allow-lists such as `JOB_VERBS`, `isQuality`, `isAbsoluteDir`, the
   `CONTROL` character check from `src/shared/text.ts`). Rebuild objects from their declared fields; never pass
   a renderer object through.
4. `index.ts` registers every handler in one loop (`ipcMain.handle('fetchly:' + name, ...)`); no extra wiring.

Handlers are wrapped by `guarded()`, so nothing throws across IPC: a thrown error becomes
`{ ok: false, error }`. Dependencies arrive through `HandlerDeps`, which is what the specs inject.

## Errors inside main

Throw typed `Error` subclasses with a set `name` (`InvalidUrl`, `ProbeError`, `IllegalTransition`,
`ChecksumMismatch`, `Aria2RpcError`, `Aria2TransportError`) and convert at the boundary. Type guards are
`isX(v: unknown): v is X`; allow-lists are `readonly` arrays checked with `satisfies`.

## User-facing text

- Window: add the key to `EN` in `src/renderer/src/strings.ts` and to `AR` in `strings.ar.ts` (the `Strings`
  type makes a missing key a type error). Read `S` inside functions only, never in a module-level constant,
  because `setLanguage` swaps it.
- Main process (tray, notifications, dialogs): `src/main/shellStrings.ts`, same EN/AR pair.
- Embedded values in Arabic sentences go through `fsi()` (`src/shared/i18n.ts`). Numbers and paths render in
  `<bdi dir="ltr">`; titles use `dir="auto"`. Dates use `S.dateLocale` (`ar-EG-u-nu-latn` keeps Western digits).

## Persisted files

Read through a strict parser in `src/main/jobs/validate.ts`, write through `writeAtomic`. See
`src/main/jobs/AGENTS.md`.

## Child processes

Build arguments in a pure function (`src/main/ytdlp/args.ts`), one element per value, `--` before the URL, and test
the function directly (`tests/ytdlp/args.test.ts`). Spawn with `windowsHide` and no shell.

## Tests

- Vitest, `environment: 'node'`, specs in `tests/**/*.test.ts` mirroring `src/`. Default timeout 10 s.
- Build data with `makeJob(over)` and `makeSettings(over)` (`tests/helpers.ts`); wait with `waitFor`
  (`tests/wait.ts`), not fixed sleeps.
- Temp directories from `mkdtempSync(join(tmpdir(), ...))`; inject dependencies through the same interfaces the
  code uses (`HandlerDeps`, `QueueLike`).
- No network and no real tools: use `tests/fakes/fake-ytdlp.mjs` (a real child process driven by `FAKE_YTDLP*`
  variables) and `tests/fakes/fake-aria2.ts`. Server specs use `tests/server/{rig,fakes,rawHttp}.ts`.

## Comments

Plain English, explaining why. Many comments carry tags (`S15`, `C2`, `R2-7`) that point at the frozen plans.
