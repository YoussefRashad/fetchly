# PE-1 results (run 2026-11-24 by the orchestrator)

Environment: Windows 11 (10.0.26100), Electron 45.4.1, the repository's Electron binary, display 1707x1067 at scale 1.5. One process per case (probe files outside the repository, scratchpad/probes/pe1). Each case: a 360x200 window, shown and focused, `app.setAppUserModelId` unique per case, the call(s) below, a 1.8 s settle, then a screen capture (desktopCapturer) of the taskbar strip, read by eye. No case threw.

Windows 11 draws taskbar progress as a short bar under the app's icon: a coloured fill over a grey track. With no progress, only the normal "running / active" pill shows.

| Case | Call(s) | Seen |
|---|---|---|
| baseline | none | active pill only |
| normal05 | `setProgressBar(0.5)` | blue fill about half, grey track |
| normal099 | `setProgressBar(0.99)` | blue bar that looks full (indistinguishable from 1 at this size) |
| normal1 | `setProgressBar(1)` | blue bar full |
| zero | `setProgressBar(0)` | nothing distinguishable from baseline (no visible track) |
| paused | `0.5, { mode: 'paused' }` | yellow fill about half, grey track |
| error | `0.5, { mode: 'error' }` | red fill about half, grey track |
| indeterminate | `0.5, { mode: 'indeterminate' }` | short moving blue pill (marquee) |
| indet-value0 | `0, { mode: 'indeterminate' }` | same marquee (the value is ignored) |
| clear | `0.5`, then `-1` | cleared, active pill only |
| mode-none | `0.5`, then `0.5, { mode: 'none' }` | cleared, same as `-1` |
| paused-after-normal | `0.7`, then `0.7, { mode: 'paused' }` | yellow about 70%: a mode switch at the same value applies |
| minimized | `0.5`, then `minimize()` | progress kept on the minimised window's button |
| hidden-then-shown | `0.5`, `hide()`, 1.5 s, `show()` | **progress lost** after show |
| hidden-shown-late | as above, captured 4 s after show | **still lost** (not a repaint delay) |
| set-while-hidden | `hide()`, `0.5` while hidden, `show()` | **lost**: a value set while hidden does not survive show |
| hidden-shown-reapply | as hidden-then-shown, then `0.5` again after show | progress shown |
| recreated | `0.5` on window 1, destroy, new window 2 (no call) | **nothing**: progress is per window |
| recreated-reapply | as above, then `0.5` on window 2 | progress shown |

Findings for C9's mapping:
1. Architecture's mapping holds: `none` -> `setProgressBar(-1)` (mode `none` is equivalent); `indeterminate` -> mode `indeterminate` (value ignored, 0 is fine); `normal`, `paused`, `error` -> the value with that mode. Mode changes at an unchanged value apply.
2. The taskbar button loses its progress on `hide()` and does not get it back on `show()`; a value set while hidden is also lost. A new window starts with none. So "call only when the result differs from the last one applied" needs its cache reset (or a forced re-apply) on the window's `show` event and on window creation; otherwise a download running while the window sits in the tray shows no progress after the window is shown again. Minimise keeps progress.
3. 0.99 looks full at Windows 11's bar size, and 0 in `normal` mode shows nothing. The "never show complete while a merge runs" rule still holds in the value sent (MERGE_AT 0.98 < 1), but by eye 0.98 to 1 look alike; the merge stage is only told apart in the app itself.
4. Not probed: Windows 10's full-button progress style; multiple monitors; a taskbar set to combine with labels; Alt+Tab (it shows no progress).
