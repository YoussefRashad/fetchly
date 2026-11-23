# Tool downloads (GitHub releases)

The one-time setup and "Update yt-dlp". Code: `src/main/binaries.ts`, `src/renderer/src/components/InstallScreen.tsx`.
Specs: `tests/binaries.test.ts`, using `tests/zip.ts` for test archives.

## Sources

Release assets on github.com only:

| Tool | Release | Checksum |
|---|---|---|
| yt-dlp | `yt-dlp/yt-dlp`, latest | the published `SHA2-256SUMS` |
| ffmpeg | `yt-dlp/FFmpeg-Builds`, latest | the published `checksums.sha256` |
| aria2 | `aria2/aria2`, 1.37.0 | none published: pinned `ARIA2_ZIP_SHA256`; an empty value refuses the install |

No credentials are used.

## Verification and install

- SHA-256 is computed while streaming and compared before anything is extracted; a mismatch throws
  `ChecksumMismatch`.
- From a zip, yauzl extracts only the one named file.
- The result is staged (`<name>.download`, `<name>.exe.new`) and renamed into `%APPDATA%\fetchly\bin`.
- Installs run one at a time through a promise chain that never rejects.
- The installed version is checked with `-version` (10 s timeout).

## Timeouts and retries

No fetch timeout and no automatic retry (see `TODO.md`). A failed download reports "no connection" or the server
status; the user starts the setup again.

## Changing a pinned version

Bumping aria2 means changing the release URL and `ARIA2_ZIP_SHA256` together, from a checksum you computed on the
official asset. Never disable the check to make an install pass.
