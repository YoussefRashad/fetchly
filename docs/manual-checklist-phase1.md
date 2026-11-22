# Phase 1 manual checklist

The automated tests never touch the external network or the real tools. These checks
do, so they are run by hand with real links. Tick each one; note anything
that differs from "Expected".

Start from a clean profile for check 1: quit Hammel from the tray and delete
`%APPDATA%\hammel`.

| # | Do | Expected |
| --- | --- | --- |
| 1 | Start the app on a clean profile and press **Install**. | Setup screen lists three tools with progress, then the empty list appears. Settings shows a version for yt-dlp, ffmpeg and aria2c. |
| 2 | Paste nonsense such as `hello`, press Add. | "Enter a link that starts with http:// or https://" under the bar. Nothing is added. |
| 3 | Add one public YouTube video, **Up to 720p**. | File is `.mp4`, plays with sound, list shows `720p` and `done`. |
| 4 | Add the same video with **Best available**. | A second file named `… (2)`. On a video of 1080p or lower it is `.mp4` (H.264); on a 4K video it is `.mkv` (or `.mp4` if "Always save as mp4" is on). It plays. |
| 5 | Add a video as **Audio only (mp3)**. | An `.mp3` that plays. |
| 6 | Add a playlist of 5 or more, untick two, download. | A folder named after the playlist; files numbered by their playlist position (`01 - …`, `03 - …`); the group row counts `n / total`. |
| 7 | Add a video whose title has Arabic text or characters like `: ? "`. | File is created with a readable name; the Arabic is intact. |
| 8 | Pause a large video at about 30%, wait, resume. | It continues from about 30%, not from 0. |
| 9 | Pause a download, **Quit** from the tray, start the app, resume. | It continues from where it stopped. |
| 10 | While a download runs, end `electron.exe`/Hammel from Task Manager. Start the app. | The job is `paused`. Resume continues it. No `yt-dlp.exe` or `ffmpeg.exe` is left running from before. |
| 11 | Add a large direct file (a public PDF or zip of 100 MB+). | Several connections (noticeably faster than a browser on a throttled server); pause and resume continue; the file opens. |
| 12 | Add the same direct file again while the first is in the list. | The second is named `name (2).ext`. |
| 13 | Paste the address of an ordinary web page that has no video. | "this link is a web page, not a file". Nothing is added. |
| 14 | Turn Wi-Fi off during a download. | `retrying (1/3)` … then `failed` with a reason. Turn Wi-Fi on, press Retry: it continues. |
| 15 | Add a private or deleted video link. | A clear reason in the add bar; no file. |
| 16 | Add a playlist that contains a private or deleted item. | That item shows as `skipped` with its reason; the others download; the finish notification mentions the skipped count. |
| 17 | Set a speed limit of 500 KB/s, start two downloads. | One video and one file together stay near 500 KB/s in total. Changing the limit while they run restarts the video, which continues. |
| 18 | Set "Downloads at the same time" to 1, add a playlist. | One item downloads at a time; the rest are `queued`. |
| 19 | Close the window during a download. | The download continues; the tray icon is there; its tooltip shows the count; a notification appears when it finishes and clicking it opens the window. |
| 20 | Tray menu: Pause all, Resume all, Open, Quit. | Each does what it says. After Quit no Hammel, `aria2c.exe` or `yt-dlp.exe` process remains. Quit during "finishing…" leaves no yt-dlp or ffmpeg process; the job is `paused` at next start and Resume finishes it. |
| 21 | Cancel a half-downloaded video, then look in the folder. | No `.part` or `.ytdl` leftovers for it; other files untouched. |
| 22 | On a finished download: Open, Open folder, Delete file. | Opens in the default player; Explorer shows the file selected; Delete asks first and then removes the file. |
| 23 | Settings → **Update yt-dlp**. | Shows the new version, or a clear error; downloading still works afterwards. |
| 24 | Start the app a second time while it is running. | The existing window comes to the front; no second tray icon. |
| 25 | Add a playlist item with **Best available** (the height check runs first). | The file follows the rule of check 4 for that item's height. Note the delay before the download starts. |
| 26 | Turn on "Always save as mp4", add a video from a source that is not mp4 (for example a webm-only site). | A playable `.mp4` (remux). |
| 27 | Add a video as **Audio only (mp3)** when the output file already exists; then pause one and resume it. | Both give a working `.mp3` (`-x` with the printed path). |
| 28a | Quit the app from the tray, rename `aria2c.exe` in `%APPDATA%\hammel\bin` to `aria2c.exe.bak`, start the app. Then restore the file name and press **Install**. | The setup screen shows, not the engine banner. After Install nothing is downloaded and the list appears. |
| 28b | Quit the app from the tray. In `%APPDATA%\hammel\bin` rename `aria2c.exe` to `aria2c.exe.bak` and create an empty file named `aria2c.exe` in its place (all three tools still count as installed, but aria2 cannot start). Start the app. Then, with the app still running, delete the empty `aria2c.exe`, rename `aria2c.exe.bak` back to `aria2c.exe`, and press **Retry** in the banner. | No setup screen: the engine banner shows with Retry, its text starting "The download tools could not be started". After Retry the banner goes and Add works. |
| 29 | During a file download, end `aria2c.exe` in Task Manager. Then press **Retry** in the banner. | The banner shows and videos keep running. After Retry the banner goes and the file download continues after its own Retry. |
| 30 | End `aria2c.exe` and do not restart it; let queued file downloads run out their retries. Then press **Retry** in the banner. | The queued file downloads fail after their retries (known limit). After the banner's Retry each one needs Retry. |
| 31 | During a download make `%APPDATA%\hammel\jobs.json` unwritable, then writable. Also start the app with the file unwritable. | The save banner appears and downloads continue. Once the file is writable the banner goes within a minute. With the file unwritable at start the banner is there from the start. |
| 32 | Kill Hammel during a download, then start it. Repeat with the leftover-process check made to fail (your choice of method). | First run: no old tool process remains and Resume works. Second run: the cut-off banner shows, Resume is refused, and "They are gone" enables it. |
| 33 | Press Pause all twice quickly, then Resume all, with file downloads running. | Each file download runs once. |
| 34 | Pause a video during its download (no joining step) and look in Task Manager at once. | No `yt-dlp.exe` and no `ffmpeg.exe` from the app's folder remains. The stop counts as confirmed when yt-dlp has closed; an ffmpeg that outlives it is a finding. |
| 35 | Delete file on a finished video that is open in a player. | The row stays with a reason. |
| 36 | Cancel a half-downloaded video from a site other than YouTube, then look in the folder. | Note any leftover files and their names. |
| 37 | Add a playlist with a private item and a deleted item. | Each shows `skipped` with its own reason. |
| 38 | In the packaged app (Electron's own Node), repeat the facts probed on Node 24.14.1: the leftover-process check at start, Delete file on a locked file, a tool install on a full or read-only folder, a file download when aria2 stops answering. | Each behaves as it did in the probe. |
| 39 | Compare a real `yt-dlp -J --no-playlist` run on a 4K video and on a 720p video with what the app chooses for **Best available** (the height check before the download). | The app picks `.mkv` for the 4K video and `.mp4` for the 720p video, matching the height yt-dlp reports. |
| 40 | Add a video whose information is very large (a long playlist page, a live stream archive). | The app reads at most 64 MB of it; past that it reports "could not read the video information". |
| 41 | With `taskkill` not available or failing, pause a video while yt-dlp is running. | Note whether an ffmpeg process from the app's folder outlives yt-dlp. |
| 42 | Make a tool install fail while extracting from the archive with an error other than disk full or a refused folder. | Note the message shown; it is passed through as is. |
| 43 | Cut the connection while the yt-dlp checksum list is being read. | Note the message shown. |
| 44 | Add a playlist where an entry url from yt-dlp starts or ends with a non-ASCII space, then restart the app. | The list loads; it is not set aside as `jobs.json.corrupt-<time>`. |

## Known limits in phase 1

- Videos that need a login (private, age-restricted, Facebook, Instagram,
  paid courses) end as `failed: login required`. Logins come with the
  browser extension in phase 2.
- A video cut off while its parts were being joined can leave a `.temp` file.
- If the file download service stops, waiting file downloads fail after their
  retries; press Retry in the banner, then on each of them.
- The interface is in English.
