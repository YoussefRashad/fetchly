# Phase 1 checklist: automated run against the real app

Results of running [manual-checklist-phase1.md](manual-checklist-phase1.md) with the opt-in
driver in `e2e/real/` against the built app, real sites and the real tools. Only what the
driver actually ran counts; nothing here is reasoned out by hand. The owner's own pass over the
checklist is separate: no box in the checklist is ticked by this run.

- Date: 2026-11-23
- Windows 11 Pro 10.0.26100; Electron 45.4.1; Node 24.14.1 (driver); playwright-core 1.49.1
- Tools as Settings shows them after the Install of check 1: yt-dlp 2026.10.26,
  ffmpeg N-128970-g11337618b2-20261116, aria2c 1.37.0
- Profile: a scratch profile in `.e2e-real/profile` (`--user-data-dir`), downloads in
  `.e2e-real/downloads`; the real profile in `%APPDATA%\fetchly` was not touched.
- Commands (after `npm run build`), in order; the table keeps the last result of each check:

  ```powershell
  npm run e2e:real -- 1 2 13 15 12 45 48 24 3 5 8 9 10 21 22 23
  node e2e/real/run.mjs --no-retry 26 40 44 37
  node e2e/real/run.mjs 11 33 34 29 28a 28b 30 32 18 17 6 16 4 39 25 27 35 46 47 19 40 36 26 7 20
  node e2e/real/run.mjs 28a 47 27 11 29 32 20
  node e2e/real/run.mjs 10 32 20 11
  node e2e/real/run.mjs 32
  ```

  The later lines re-ran checks after driver fixes (a row locator, the kill of the Electron
  main, the setup-screen wait, loopback on `::1`); see "Driver notes". Without `--no-retry`
  a failed check is re-run alone once, and only a second failure counts.

## How the checks were driven

- Window: Playwright `_electron` clicks the real buttons; values are read from the window
  (`window.fetchly`) and from disk.
- Stubbed, so nothing reached the desktop: `shell.openPath`, `shell.showItemInFolder`,
  `shell.openExternal` (the call is recorded), and `dialog.showMessageBox` (answers Cancel,
  button 1, unless a check sets Open, button 0; `window.confirm` answers OK).
- Tray: menu items run through their own click handlers, not a native click; notifications
  are recorded and their click event is emitted.
- Kills: only by PID, only the app's own Electron main or a tool under
  `.e2e-real/profile/bin`.
- Content: Blender Foundation open movies (YouTube, download.blender.org, video.blender.org),
  example.com, kernel.org, an Ubuntu `.torrent`. Checks 16, 26, 37, 40, 44 and 46 use content
  the driver serves itself on 127.0.0.1 (an RSS feed that yt-dlp reads as a playlist, a page
  with `<video>`, a `.url` file).

## Results

Counts: 38 pass, 4 fail, 7 not run.

| # | Status | How | Evidence (or reason not run) |
| --- | --- | --- | --- |
| 1 | pass | automated | Clean profile: setup screen listed yt-dlp, ffmpeg, aria2c with progress for each; Install took 88 s; then "Nothing here yet"; Settings shows a version for all three. |
| 2 | pass | automated | `hello` -> "Enter a link that starts with http:// or https://"; 0 jobs, 0 files. |
| 3 | pass | automated | Caminandes 3, Up to 720p -> `Caminandes 3 Llamigos.mp4`, h264 1280x720 + aac; first 20 s decode clean; row `720p \| done`. Sound not listened to (the audio stream was decoded). |
| 4 | pass | automated | Same video, Best (source 1080p) -> `Caminandes 3 Llamigos (2).mp4`, h264 1920x1080, decodes clean. The 4K side is check 39. |
| 5 | pass | automated | Audio only (mp3) -> `.mp3`, mp3 48 kHz stereo, 2:30, decodes clean. |
| 6 | pass | automated | Blender playlist, 5 ticked then 2 unticked ("3 of 18 selected"); folder `Blender Open Movies`; files `01 - …`, `09 - …`, `12 - …`; group counter 0 / 3 -> 3 / 3. |
| 7 | pass | automated | Title `"Caminandes 2: Gran Dillama" - Blender Animated Short` -> `Caminandes 2 Gran Dillama - Blender Animated Short.mp4`. Arabic not covered (no openly licensed video with an Arabic title was used). |
| 8 | pass | automated | Paused at 32% (28.2 of 86.2 MB), 10 s wait, Resume: lowest share after it 34%; partial files grew 29.2 -> 35.9 MB. |
| 9 | pass | automated | Paused at 15%, tray Quit -> exit 0, no tool left; next start "paused" at 15%; Resume went on from 15%. |
| 10 | pass | automated | At 11% the Electron main was ended by PID; tools ended with it; next start the job is "paused"; no old tool running; Resume went on (lowest share 19%). See O8. |
| 11 | pass | automated | 121 MB zip from download.blender.org: aria2 used 8 connections; 3929 KB/s vs 3641 KB/s for one plain connection (not noticeably faster: one connection already gets about the same here); paused at 51%, Resume: aria2 at 62 MB right away, window 66% at 3.7 s, done after 22.9 s (continuation ~15 s, restart ~30 s at that rate); zip extracts with every CRC clean. See O1. |
| 12 | pass | automated | Sintel 1080p mkv added twice -> `Sintel.2010.1080p.mkv`, `Sintel.2010.1080p (2).mkv` (both then cancelled). |
| 13 | pass | automated | example.com and kernel.org -> "this link is a web page, not a file"; 0 jobs, 0 files. See O9. |
| 14 | not run | - | Needs Wi-Fi turned off during a download; network adapter changes were not allowed in this run. |
| 15 | pass | automated | Non-existent YouTube id -> bar shows "[youtube] zzzzzzzzzz0: This video is unavailable"; 0 jobs, 0 files. See O6. |
| 16 | fail | automated | Playlist (local feed) of 3 YouTube links, item 2 a non-existent id: items 1 and 3 done; item 2 went `retrying (1/3)` … `(3/3)` then `failed: [youtube] zzzzzzzzzz0: This video is unavailable`, not `skipped`; notification "Playlist finished: … · 1 failed". Same on the re-run. Finding F1. |
| 17 | pass | automated | Limit 500 KB/s: video 167 + file 153 = 319 KB/s over 20 s; changed to 300: the video went downloading -> probing and continued (4.2 -> 5.2 MB); then 100 + 82 = 182 KB/s. See O4. |
| 18 | pass | automated | Same-time downloads = 1, 3 playlist items: at most 1 running, 2 queued; all done. |
| 19 | pass | automated | Window closed during a download: it stays (hidden), download done; tray tooltip "Fetchly · 1 downloading"; notification "Download finished: Elephants Dream"; its click shows the window. |
| 20 | not run | - | First half passed: Pause all -> all paused; Resume all -> all downloading; Open shows a hidden window; Quit -> exit 0, no tool and no Electron process left. Second half not tested: the window was never told "finishing…" (next state after downloading was "done", 3 attempts). See O2. |
| 21 | pass | automated | Cancel at 22%: `Elephants Dream.f136.mp4.part` gone; `keep-me.txt` untouched; no leftovers. |
| 22 | pass | automated | Open -> `shell.openPath(<file>)`; Open folder -> `shell.showItemInFolder(<file>)` (both stubbed); Delete file asked first ("Delete the file of … from disk?"), then the file and the row were gone. |
| 23 | pass | automated | Update yt-dlp -> "yt-dlp is now 2026.10.26" (already newest); a video link still opens the add dialog. |
| 24 | pass | automated | Window hidden, second `electron.exe` on the same profile exited (code 0); the first window became visible and focused; one tray. |
| 25 | pass | automated | Playlist item 11 with Best: height check 1080 -> `11 - Caminandes 3 Llamigos.mp4`, h264 1080p. Delay from Download to first bytes: 6.1 s. |
| 26 | fail | automated | "Always save as mp4", Best, a VP9/Opus `.webm` on a local page: with `<source res="360">` -> playable `.mp4` (VP9/Opus remuxed); with a plain `<source>` (no height) -> `failed: Requested format is not available`. Same on the re-run. Finding F3. |
| 27 | pass | automated | mp3 twice: `Elephants Dream.mp3` and `Elephants Dream (2).mp3`, both decode clean (10:54); the second was paused and resumed. |
| 28a | pass | automated | `aria2c.exe` renamed: the setup screen shows once the tool check settles, no banner; name restored, Install -> list after 1.4 s, no progress, no tool file rewritten. See O3. |
| 28b | pass | automated | Empty `aria2c.exe`: no setup screen, banner "The download tools could not be started: spawn EFTYPE"; file restored, banner Retry -> banner gone; a direct file then downloads. |
| 29 | fail | automated | aria2c ended by PID during a file download (38.2 MB, then 20.1 MB on the re-run): banner "The file download service stopped", the video kept going (~1 MB/s), banner Retry -> banner gone; the file retried by itself but started again from 0.0 MB both times. Finding F4. |
| 30 | pass | automated | aria2c ended and not restarted: a file added went `retrying (1/3)` … `(3/3)` -> `failed: the download service is not running` (85 s); banner Retry -> banner gone, job stayed failed; its own Retry -> done. |
| 31 | not run | - | Needs `jobs.json` made unwritable with ACLs; ACL changes were not allowed in this run. |
| 32 | pass | automated | Kill + normal start: no old tool left, Resume works. Kill again, start with PowerShell off PATH (leftover check cannot run): cut-off banner shown, Resume button hidden, resume over IPC refused with the cut-off text; "They are gone" (confirm answered OK) -> Resume back, went on at 47%. |
| 33 | pass | automated | Two file downloads at 1000 KB/s; tray Pause all twice, Resume all: aria2 holds exactly 2 downloads, each job once. |
| 34 | pass | automated | Pause during a video download: about 1 s after the row showed paused, no yt-dlp or ffmpeg from the profile's tool folder was running. |
| 35 | pass | automated | File held open without sharing by a helper process; Delete file -> row stays (`done`), message "Could not delete the file: EPERM, Permission denied: '.e2e-real\downloads\c35\sintel_trailer-480p.mp4'". See O5. |
| 36 | pass | automated | video.blender.org (PeerTube) "Raising the Steaks - Blender Studio Log 32": during the download `….mp4.part`; after Cancel at 20%: no file left. |
| 37 | pass | automated | Local feed with items titled `[Private video]` and `[Deleted video]` (the titles yt-dlp gives in a flat YouTube playlist; not a real YouTube playlist): dialog shows them disabled with "private" / "removed"; list rows `skipped: private`, `skipped: removed`. |
| 38 | not run | - | Needs the packaged app; phase 1 has no packaged build yet. |
| 39 | pass | automated | Glass Half: `yt-dlp -J` height 2160, app height check 2160, app runs `--merge-output-format mkv`; Elephants Dream: 720 / 720 / `mp4`. |
| 40 | fail | automated | Local feed whose `yt-dlp -J --flat-playlist` output is 70.4 MB: the bar shows "yt-dlp stopped before it could read the link. Try again." instead of "could not read the video information". Same on the re-run. Finding F2. |
| 41 | not run | - | Needs taskkill made unavailable or failing (a system change). |
| 42 | not run | - | Needs a tool install made to fail mid-extract with an unusual error (a system change). |
| 43 | not run | - | Needs the connection cut while the checksum list is read (a network change). |
| 44 | pass | automated | Local feed with entry urls ending in U+00A0 and starting with U+3000 (yt-dlp kept both); 2 rows added, Quit, start: both rows load (paused), no `jobs.json.corrupt-*`. |
| 45 | pass | automated | Sintel trailer: `Zone.Identifier` holds `ZoneId=3` and `HostUrl=https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4`. Explorer Properties not opened (only the stream was read). |
| 46 | pass | automated | `.url` file served from 127.0.0.1: Open asks first, buttons [Open, Cancel], default and cancel = Cancel; Cancel opened nothing; Open called `shell.openPath` once (stubbed). The signed `.exe` half was not run (no small official signed installer used; the Windows prompt cannot appear with Open stubbed). |
| 47 | pass | automated | Ubuntu 26.04 desktop `.torrent` from releases.ubuntu.com -> job done, the 497,716-byte `.torrent` saved (starts `d8:announce`), only that file in the folder; aria2 has nothing active or waiting; it listens only on loopback (its RPC port), no UDP. |
| 48 | pass | automated | Add pressed while the engine state was "starting": the add dialog opened after 3.5 s, no error. |

## Findings

**F1 (check 16): a deleted video in a playlist ends `failed`, not `skipped`.** Reproduce:
add a playlist whose entry is a YouTube video that no longer exists (the run used an RSS feed
on 127.0.0.1 with `https://www.youtube.com/watch?v=zzzzzzzzzz0` as item 2), Download.
The item is retried three times (`retrying (1/3)` … `(3/3)`) and ends
`failed: [youtube] zzzzzzzzzz0: This video is unavailable`; the notification counts it as
"1 failed", not skipped. The other items download. yt-dlp's text is "This video is
unavailable"; the removed rule in `src/main/ytdlp/parse.ts` looks for "video unavailable"
(not verified by a run of the rule itself).

**F2 (check 40): video information over 64 MB gives the wrong message.** Reproduce: add a
link whose `yt-dlp -J --flat-playlist` output is over 64 MB (the run served a 70 MB RSS feed
on 127.0.0.1; yt-dlp printed 70.4 MB in 2.5 s). The bar shows "yt-dlp stopped before it could
read the link. Try again." after 2.4 s; the checklist expects "could not read the video
information". Telling the user to try again is wrong here: it fails the same way every time.

**F3 (check 26): "Always save as mp4" fails on a source that does not state its height.**
Reproduce: turn on "Always save as mp4", add a page whose `<video><source>` points to a
`.webm` and has no height attribute. The job ends
`failed: Requested format is not available` after its retries. The same `.webm` with
`res="360"` on the `<source>` downloads and is remuxed into a playable `.mp4`. The format
filter `[height<=1080]` leaves out formats whose height is unknown; "Up to Np" uses the same
filter, so it likely fails on such sources too (not run).

**F4 (check 29): after aria2c is ended, the file download starts again from 0.** Reproduce:
start a large direct file (the run used Sintel 1080p, 3000 KB/s limit) next to a video, end
`aria2c.exe` at 20 MB or more, press Retry in the banner. The banner goes and the video is
unaffected, but the file job, which retries by itself (no Retry press was needed), reports
0.0 MB -> 0.6 MB -> 1.2 MB …, so the bytes from before are downloaded again (38.2 MB lost on
the first attempt, 20.1 MB on the re-run). The checklist expects it to continue.

## Observations (not counted as fails)

- **O1 (11):** in 4 earlier attempts of check 11 this session (an older measurement), the
  window reported the file at 0% after Resume; in the 2 that sampled for 8 s it stayed at 0%
  the whole time, and aria2 had no active download with a known length then. Each time the
  job still finished and the zip was intact. The last run, which first watched aria2 for 3 s, saw aria2 at 62 MB right after
  Resume and the window at 66% from 3.7 s. Worth a look: a resumed file can show 0% for a while.
- **O2 (20):** a 720p two-stream YouTube download (merged by ffmpeg) never showed
  "finishing…" to the window in 3 attempts (the next state after downloading was "done"), so
  Quit during it could not be tested.
- **O3 (28a):** before the setup screen, the window first draws the main view while the
  state is still "starting".
- **O4 (17):** both totals stayed under the limit but well below it (319 KB/s at 500,
  182 KB/s at 300).
- **O5 (35):** the reason shows in the message under the bar; the row itself stays `done`
  with no reason.
- **O6 (15):** the reason is yt-dlp's own text, with the extractor prefix
  (`[youtube] zzzzzzzzzz0: This video is unavailable`).
- **O7 (1):** Settings shows ffmpeg's whole first line, copyright included.
- **O8 (10):** after the kill at 11% the restarted list showed the job at 0% (progress is
  saved every 5 s); Resume went on from about 19%. The tools ended together with the killed
  main, so "no old process left" held trivially here.
- **O9 (13):** www.blender.org answered 403 (Cloudflare challenge) and www.gnu.org timed
  out; the bar showed yt-dlp's raw message for both. Those two pages were not counted.

## Driver notes

- `npm run e2e:real -- <ids>` or `all`; results go to `.e2e-real/results.json` (git-ignored).
- The process Playwright starts is a launcher; the app's real main process is its child.
  The driver ends that child for "end the app in Task Manager" (an earlier version ended only
  the launcher, after which the app quit cleanly; checks 10 and 32 were re-run after the fix).
- download.blender.org now serves the Big Buck Bunny files zipped only; the driver uses
  `BigBuckBunny_640x360.m4v.zip` (121 MB) for check 11 and the 720p `.mov.zip` for check 33.
