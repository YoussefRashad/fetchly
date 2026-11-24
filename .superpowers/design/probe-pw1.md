# PW-1 results (run 2026-11-24 by the orchestrator)

Environment: Windows 11 (10.0.26100), Electron 45.4.1 (the repository's binary), one display at scale factor 1.5 (no 100% or 125% display available on this machine). One process per case (scratchpad/probes/pw1). Window options as the app's (`index.ts:35-50`: width 1120, height 650, no `useContentSize`, `autoHideMenuBar`, sandbox, contextIsolation) with `minWidth: 720` as C3 plans; `setSize(W, 650)` then read back. A page with an `overflow-y: auto` box taller than its content measures the classic scrollbar.

| Requested outer width | getSize() width | getContentSize() width | innerWidth = clientWidth | `(max-width: 900px)` matches | Scrollbar width |
|---|---|---|---|---|---|
| 1120 (start size) | 1121 | 1106 | 1106 | no | 15 |
| 900 | 901 | 886 | 886 | yes | 15 |
| 760 (today's minWidth) | 761 | 746 | 746 | yes | 15 |
| 720 (C3's minWidth) | 721 | 706 | 706 | yes | 15 |
| 700 (below min) | 721 | 706 | 706 | yes | 15 |

Findings:
1. The page viewport is the outer width minus 15 px at 150% scaling (the outer width also reads 1 px over the request: rounding at 1.5). Media queries and the row arithmetic see the viewport: 1106 px at the start size, 706 px at the minimum window.
2. The classic scrollbar of an overflowing box is 15 px at 150% scaling.
3. "900px" in a media query means a viewport of 900, i.e. an outer window of about 915 here.
4. Not probed: 100% and 125% scaling (no such display); the frame width can differ there by a pixel or two.
