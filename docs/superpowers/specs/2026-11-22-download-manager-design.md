# Personal download manager: design

Date: 2026-11-22
Status: reviewed once by an independent builder, awaiting owner approval
Working name: **Hammel** (my call; rename freely)

## Intent and why

A Windows download manager for the owner and a few people around them, used
in place of a paid download manager. It downloads single videos, whole
playlists and courses with a chosen quality, takes any direct file link
(PDF, archive, video file), and has a browser extension that puts a download
button on videos. It is not published or sold.

## Goals

1. Paste a video URL, pick a quality, download it.
2. Paste a playlist URL, see its items, pick which ones and one quality,
   download them all into one folder, numbered in playlist order.
3. Paste any direct file URL and download it with several connections.
4. Pause, resume and cancel any download. A paused or interrupted download
   continues from where it stopped, including after the app or the PC
   restarts.
5. A browser extension (Chrome and Edge) that shows a download button over
   videos and a right-click "Download with Hammel" on links, and hands the
   URL to the app.
6. Courses: YouTube course playlists, and courses the user has bought on
   login-gated sites (Udemy named), using the user's own browser session.

## Non-goals

- DRM-protected content (Netflix, Shahid, DRM lectures on Udemy). The app
  never attempts to decrypt; such items are reported as "protected, skipped".
- Mobile app. A later, separate project.
- Publishing to the Chrome Web Store or any store. The extension is loaded
  unpacked.
- Signed installer, auto-update of the app itself, macOS or Linux builds.
- Torrents, scheduling, taking over every browser download automatically.

## Anti-goals (a failure even if it works)

- A download that fails or is skipped without the list saying so and why.
- Losing the partial data of a paused or interrupted download.
- Session cookies leaving the machine, or being sent anywhere but the local
  app.
- A playlist of 80 items that needs 80 clicks.

## Constraints

- Windows 11, single user, runs without admin rights.
- yt-dlp breaks whenever a site changes; the app must be able to update it
  without a new app build.
- Chrome on Windows encrypts cookies so that outside programs cannot read
  them (app-bound encryption), so `--cookies-from-browser chrome` cannot be
  relied on.
- Udemy support in yt-dlp is unreliable (site bot protection) and Udemy's
  terms forbid downloading outside its own apps. Treated as best effort and
  the last phase; the owner knows this.

## Approaches considered

1. **Desktop app (Electron + TypeScript) plus extension.** A real window
   with a download list, tray icon, works with the browser closed. Most
   work, about 150 MB. **Picked by the owner**: closest to the download
   manager they are replacing, and long playlists need a persistent list.
2. **Local Node service with a browser page as the UI, plus extension.**
   Less work, and a phone on the same Wi-Fi could send links. No window, no
   tray, and it does not solve downloading onto the phone.
3. **Extension popup as the whole UI plus a headless helper.** Least work,
   but a popup is too small for an 80-item playlist and there is no UI when
   the browser is closed.

Electron over Tauri is my call: one language (TypeScript) end to end.

## Design

Everything in this section is my call unless marked "owner".

### Pieces

- **Main process (Node, TypeScript):** download queue, job state, process
  supervision, local HTTP endpoint for the extension, settings, persistence.
- **Renderer (React, TypeScript):** the window. Talks to main over typed
  IPC only; no Node access.
- **Binaries, not bundled in the repo:** `yt-dlp.exe`, `ffmpeg.exe`,
  `aria2c.exe`, fetched on first run into the app data folder from their
  official release pages, with a checksum check where the publisher offers
  one. Settings has "Update yt-dlp".
- **Extension (Manifest V3, Chrome and Edge):** content script, context
  menu, small popup for pairing status.

### Two kinds of job

| | Media job | File job |
|---|---|---|
| Used for | URLs yt-dlp recognises (YouTube, Facebook, Instagram, Udemy, ...) | Any other URL |
| Engine | yt-dlp, with ffmpeg to merge video and audio | aria2c over its JSON-RPC interface |
| Pause | stop the process, keep `.part` files | aria2 pause |
| Resume | start the item's process again with `--continue` | aria2 unpause; aria2 session file survives restarts |
| Progress | parsed from yt-dlp's machine-readable progress output | polled from aria2 |

Which kind a URL is: ask yt-dlp to probe it (no download). If it returns
media info, it is a media job; otherwise a file job. A server without
range support downloads on one connection and the list marks it "cannot
resume".

**A playlist or course is a group, and every item in it is its own job**
with its own yt-dlp process, so each item can be paused, cancelled and
retried alone. The queue limit counts items across everything: with a
limit of 3, three items download in total, not three per playlist. Pausing
a group pauses its items. Resuming a group skips items already `done`,
from the saved state.

### Job states

`queued → probing → downloading ⇄ paused → merging → done`, with `failed`
(reason kept, Retry button) and `skipped` (reason kept: protected, removed,
private, unavailable in region). State is written to disk on every
transition, so a crash loses nothing. On start, jobs that were
`downloading` come back as `paused`; a setting can resume them
automatically.

### Options (owner asked for "resume and all these options"; this list is my reading of it)

- Per job: pause, resume, cancel, retry, open file, open folder, remove from
  list (with or without the file).
- Quality: best available, or a ceiling (2160, 1440, 1080, 720, 480, 360);
  audio only (m4a or mp3). If the chosen height does not exist, the nearest
  lower one is used and the list shows the real one.
- Container and codec: never re-encode (too slow). Up to 1080p, prefer
  H.264 video with AAC audio in mp4, which plays everywhere. Above 1080p
  YouTube only offers VP9 or AV1, so the file keeps that codec and is saved
  as mkv. A setting "always prefer mp4-compatible (max 1080p)" exists for
  people who play files on a TV.
- Playlist: checkbox list with select all, one quality for all, files named
  `NN - title`, one folder named after the playlist.
- Optional subtitles (pick languages) saved beside the video.
- Queue: at most 3 jobs at once (setting 1 to 8); global speed limit;
  automatic retry 3 times with backoff.
- Download folder: default `Downloads\Hammel`, changeable, "ask every time"
  switch.
- Windows notification when a job or a whole playlist finishes.
- Tray icon; closing the window keeps downloads running.

### Window (sketch)

```
+--------------------------------------------------------------------+
| [ Paste URL here ........................................ ] [Add]  |
+--------------------------------------------------------------------+
| All | Downloading | Paused | Done | Failed          Speed: 4.2 MB/s|
+--------------------------------------------------------------------+
| v React Course (playlist)   12 / 40           30%   [||] [x]       |
|     01 - Intro.mp4          1080p   done                            |
|     02 - Setup.mp4          1080p   64%  3.1 MB/s  0:42  [||] [x]   |
|     03 - JSX.mp4            1080p   queued                          |
|   report.pdf                18 MB   paused 40%           [>] [x]    |
|   lecture.mp4               720p    failed: private video [Retry]   |
+--------------------------------------------------------------------+
```

Adding a URL opens a dialog: title, thumbnail, quality, folder, and for a
playlist the checkbox list.

### Extension to app

- The app listens on `127.0.0.1` only, on a fixed port (configurable).
- Pairing: the app shows a one-time code, typed once into the extension
  popup; the extension then holds a token sent on every request. Requests
  without it are refused, and the origin is checked against the extension's
  id.
- The content script draws a small button on `<video>` elements above a
  minimum size. A click sends the **page URL** (yt-dlp works from page
  URLs); the app then shows its normal add dialog.
- **Sites yt-dlp does not recognise** (owner: the button must work on any
  video, not only YouTube). The extension watches the tab's network
  requests for media: direct video files and HLS/DASH manifests (`.m3u8`,
  `.mpd`). Along with the page URL it sends the candidates it saw, with
  the Referer and User-Agent. If the yt-dlp probe of the page fails, the
  app downloads the best candidate instead (yt-dlp handles a bare manifest
  URL). If there is no candidate either, the button answers "no
  downloadable video found on this page"; the page's HTML is never saved
  as a file. A manifest that declares DRM is reported as protected.
- Context menu on links and media sends that URL, with the Referer and
  User-Agent. The right-click is the consent for that one request: the
  cookies for that URL's site go with it, are used for that one job, and
  are not stored. This is what makes links behind a login (Drive, file
  hosts, portals) work.
- App not running: the popup says so; nothing is queued in the extension.

### Logins (phase 2) and courses (phase 3)

- A media item that needs a login (private or age-restricted YouTube,
  Facebook, Instagram, a bought course) fails in phase 1 with
  `failed: login required`. From phase 2 the login handoff below fixes it.
- In the extension popup, on a site the user is logged in to, "Use my login
  for this site" sends that one site's cookies to the app over the paired
  local connection. Explicit click, per site, never automatic.
- The app stores them per site in its data folder, protected with Windows
  DPAPI through Electron `safeStorage`, writes a temporary cookie file for
  the yt-dlp run and deletes it afterwards. Settings lists stored logins
  with a Delete button.
- A course is a playlist: chapters become subfolders, lectures are numbered.
- Protected lectures are marked `skipped: protected`. No attempt to bypass.
- **Finish line for Udemy and other gated course sites:** the login is
  passed to yt-dlp, whatever it can list and fetch is downloaded into
  chapter folders, and everything else is reported with its reason. If
  yt-dlp cannot read a site at all, the app says so. Writing our own
  client for Udemy or any other site is out of scope.

### Persistence

One JSON file for jobs and one for settings in the app data folder,
written atomically (write to temp, rename). No database.

### Testing

- Unit tests (no network, no real binaries): job state machine, queue
  limits, yt-dlp argument building, progress-line parsing, quality fallback,
  file naming, pairing and token check, cookie store.
- A fake yt-dlp and a fake aria2 process for integration tests of pause,
  resume, crash recovery and retry.
- A short manual checklist with real URLs per phase, run by the owner.

## Phases

1. **App:** single video, playlist, qualities, direct files, pause and
   resume, queue, settings, tray. Public content only.
2. **Extension:** pairing, video button with the media fallback, context
   menu, "Use my login for this site" and the app's login store.
3. **Courses:** chapter folders, lecture numbering, skip reporting on
   gated course sites.

Each phase gets its own plan and is usable on its own.

Distribution: the owner installs the app and the unpacked extension on the
other people's PCs. Each phase adds its steps to a short setup README
(Windows SmartScreen prompt, loading the extension in developer mode,
pairing).

## Left to the builder

- Folder layout, IPC channel names, React component breakdown, styling.
- Exact yt-dlp format selector strings and progress template.
- Test runner and bundler (electron-vite and Vitest suggested).
- Packaging for phase 1: a portable unpacked build is enough.
