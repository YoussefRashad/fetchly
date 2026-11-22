# Phase 1 manual checklist

The automated tests never touch the network or the real tools. These checks
do, so they are run by hand with real links. Tick each one; note anything
that differs from "Expected".

Start from a clean profile for check 1: quit Hammel from the tray and delete
`%APPDATA%\hammel`.

| # | Do | Expected |
| --- | --- | --- |
| 1 | Start the app on a clean profile and press **Install**. | Setup screen lists three tools with progress, then the empty list appears. Settings shows a version for yt-dlp, ffmpeg and aria2c. |
| 2 | Paste nonsense such as `hello`, press Add. | "Enter a link that starts with http:// or https://" under the bar. Nothing is added. |
| 3 | Add one public YouTube video, **Up to 720p**. | File is `.mp4`, plays with sound, list shows `720p` and `done`. |
| 4 | Add the same video with **Best available**. | A second file named `… (2)`. It is `.mkv` (or `.mp4` if "Always save as mp4" is on) and plays. |
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
| 17 | Set a speed limit of 500 KB/s, start two downloads. | Total speed stays near 500 KB/s. |
| 18 | Set "Downloads at the same time" to 1, add a playlist. | One item downloads at a time; the rest are `queued`. |
| 19 | Close the window during a download. | The download continues; the tray icon is there; its tooltip shows the count; a notification appears when it finishes and clicking it opens the window. |
| 20 | Tray menu: Pause all, Resume all, Open, Quit. | Each does what it says. After Quit no Hammel, `aria2c.exe` or `yt-dlp.exe` process remains. |
| 21 | Cancel a half-downloaded video, then look in the folder. | No `.part` or `.ytdl` leftovers for it; other files untouched. |
| 22 | On a finished download: Open, Open folder, Delete file. | Opens in the default player; Explorer shows the file selected; Delete asks first and then removes the file. |
| 23 | Settings → **Update yt-dlp**. | Shows the new version, or a clear error; downloading still works afterwards. |
| 24 | Start the app a second time while it is running. | The existing window comes to the front; no second tray icon. |

## Known limits in phase 1

- Videos that need a login (private, age-restricted, Facebook, Instagram,
  paid courses) end as `failed: login required`. Logins come with the
  browser extension in phase 2.
- A new speed limit reaches a video that is already downloading only when it
  is next started.
- The interface is in English.
