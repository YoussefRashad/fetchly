# PV-1 results (run 2026-11-24 by the orchestrator)

Environment: Windows (Version 10.0.26100.8037), Electron 45.4.1 (Chrome 156.0.8078.100), the repository's Electron binary. One process; probe files outside the repository. Window options as the app's (contextIsolation true, nodeIntegration false, sandbox true, default backgroundThrottling), a preload relaying an IPC ping, a page with a CSS rotate animation and the rule `html[data-hidden] #b { animation-play-state: paused }`, `data-hidden` toggled from `visibilitychange`.

| State | isVisible | isMinimized | isFocused | document.visibilityState | data-hidden set by visibilitychange | animation-play-state | animation actually moving | IPC ping to page, round trip |
|---|---|---|---|---|---|---|---|---|
| Shown and focused | true | false | true | visible | no | running | yes | 2 ms |
| Shown, another (larger) app window shown and focused on top of it, covering it | true | false | false | hidden | yes | paused | no (sampled after settle) | 1 ms |
| Fully occluded by an always-on-top window | true | false | false | hidden | yes | paused | no | 0 ms |
| Back on top and focused | true | false | true | visible | no | running | yes | 0 ms |
| Minimised | false | true | false | hidden | yes | paused | no | 0 ms |
| Restored and focused | true | false | true | visible | no | running | yes | 0 ms |
| Hidden with hide() | false | false | false | hidden | yes | paused | no | 0 ms |
| Hidden 5 s later | false | false | false | hidden | yes | paused | no | 1 ms |
| Shown again with show() | true | false | true | visible | no | running | yes | 0 ms |

Findings:
1. `visibilitychange` fires for hide(), minimise, and full occlusion by another window (Windows native occlusion). In every hidden case the CSS rule under `data-hidden` pauses the animation (computed transform stops changing).
2. A window that is fully covered by another app's window reports isVisible() = true but document.visibilityState = 'hidden' and isFocused() = false. So "visible" from main (isVisible) and "visible" from the page (visibilityState) differ under occlusion.
3. IPC messages (webContents.send) reach a hidden page promptly (round trip 0-2 ms), whether hidden by hide(), minimise or occlusion: the page keeps receiving snapshots while hidden.
4. performance.now() keeps advancing while hidden (10066 ms -> 15384 ms over about 5.3 s of wall time while hidden); it is monotonic across the hidden period.
5. Not probed: a genuine partial overlap (the covering window was larger, so it covered fully); behaviour across system sleep (performance.now() across sleep is not measured; treat as unknown).
