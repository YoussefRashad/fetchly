# Phase 2 manual checklist

These checks cover what the automated tests cannot: the real app window, real
Windows ports, sleep, and real browsers. Run them on the built app (`npm run
build`, then `npm start`). Tick each one; note anything that differs from
"Expected".

## A1: local server and pairing

The Settings pairing panel has no automated test; rows 1 to 9 and 17 to 19 cover it.

Until the extension exists (A2), a pairing request can be sent from PowerShell.
Replace `<port>` and `<code>` with the two halves of the pairing string, and the
32 letters with any 32 letters from `a` to `p`:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:<port>/v1/pair -ContentType 'application/json' -Headers @{ Origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } -Body '{"code":"<code>","label":"Test"}'
```

| # | Do | Expected |
| --- | --- | --- |
| 1 | Start a program that holds `127.0.0.1:38917` (for example `python -m http.server 38917 --bind 127.0.0.1`), then start Fetchly. | A banner "port 38917 is in use; change it in Settings", with no button. Settings → Browser says the port is in use and **Pair a browser** is disabled. No other port is used. |
| 2 | With the port still held, set another free port in Settings and save. | The banner goes away. Settings → Browser says it listens on the new port and **Pair a browser** is enabled. |
| 3 | In Settings, type a port without saving. | **Pair a browser** is disabled with "Save the new port first, then pair." until Save. |
| 4 | Press **Pair a browser**. | A `<port>-<code>` string with a 5-minute countdown and **Cancel**. The port is the one Fetchly listens on. |
| 5 | Press **Cancel**. Send the pairing request with that code. | The string disappears. The request answers `403` with `pairing_closed`. |
| 6 | Press **Pair a browser** and wait more than 5 minutes 10 seconds. Send the pairing request. | The panel shows "This code has expired". The request answers `403` with `pairing_closed`. |
| 7 | Press **Pair a browser** and send the pairing request with the code. | `200` with a token. The string disappears within about a second, and "Test" appears in the list with the date and time. |
| 8 | Pair four times (rows 4 and 7). Press **Pair a browser** again. | "Four browsers are already paired. Unpair one first." |
| 9 | Press **Unpair** on one entry. | It leaves the list at once; its token gets `403` or `401` on `/v1/status`. |
| 10 | With browsers paired, change the port and save; answer **Cancel** in the dialog. | "Settings were not saved: the port was not changed". The list is unchanged. |
| 11 | Change the port again and confirm the dialog. | The list is empty; Fetchly listens on the new port; the old pairing string is dead. |
| 12 | Change the port with no browser paired. | No dialog; the port changes. |
| 13 | Make `%APPDATA%\fetchly\pairing.json` read-only (Properties → Read-only), then pair or unpair. | The change works at once and Settings shows "Pairing changes are not saved to disk yet". Clear Read-only: within 30 s the line goes away. |
| 14 | Press **Pair a browser**, then put the PC to sleep and wake it. | The code is gone: the string disappears and the pairing request answers `403 pairing_closed`. |
| 15 | Replace `pairing.json` with the text `{ broken`, start Fetchly. | A start-up notice says the list could not be read and was set aside; the file is now `pairing.json.corrupt-<n>`; the list is empty. |
| 16 | After A2: load `extension/dist` unpacked in Chrome and in Edge, and pair both from the same folder. | Both stay paired, each listed with its own label. Unpairing one leaves the other working. |
| 17 | With a browser paired, Settings open and no code shown, make `pairing.json` read-only, then send `POST /v1/unpair` (Origin, `Authorization: Bearer <token>`, body `{}`) from PowerShell. | Within about 2 s the entry leaves the list and "Pairing changes are not saved to disk yet" appears, without touching the panel. |
| 18 | Press **Pair a browser**, then set the Windows clock back one hour, then forward two. | The countdown keeps falling one per second, never shows more than 5:00, and the code stays shown and usable until its real five minutes end. |
| 19 | Make `settings.json` read-only and save a new port (it fails). Type the old port back into the port field without saving, press **Pair a browser** and send the pairing request. Clear Read-only, type the new port again and save. | The dialog asks again; afterwards the list is empty and Fetchly listens on the new port. |

## D: housekeeping

Errors now carry a code, so the Arabic window shows them in Arabic. Rows 1, 2 and 4
need the window in Arabic (Settings → Language → العربية, then Save).

| # | Do | Expected |
| --- | --- | --- |
| 1 | Paste `ftp://x` into the link bar and press **إضافة**. | The error under the bar is Arabic: "أدخل رابطًا يبدأ بـ http:// أو https://", each link reading left to right. |
| 2 | In Settings, set the port to `80` and press **حفظ**. | The dialog's error line is Arabic: "المنفذ يجب أن يكون عددًا صحيحًا من 1024 إلى 65535". Nothing is saved. |
| 3 | On a PC where the download tools are not installed yet, put `"language": "ar"` in `%APPDATA%\fetchly\settings.json`, start Fetchly, disconnect the network and press **تثبيت**. | The install error stays English (for example "could not download …") and reads left to right inside the Arabic screen. |
| 4 | Run `netsh interface ipv4 show excludedportrange protocol=tcp`. If a listed range holds a port of 1024 or more, save one of its ports in Settings. | The banner is Arabic: "لا يمكن استخدام المنفذ … على هذا الكمبيوتر؛ اختر منفذًا آخر من الإعدادات", with the port in Western digits. If no listed range holds such a port, mark this row spec-only (`tests/server/port.test.ts`, `tests/renderer/bannersServer.test.ts`). |
| 5 | (spec-only) | The notice "Settings were saved, but the running downloads did not take them" (`tests/ipcPairing.test.ts`, `tests/renderer/errors.test.ts`) and the Best-quality download that falls back when the height check passes 64 MB (`tests/engines/media.test.ts`) cannot be forced by hand. |
