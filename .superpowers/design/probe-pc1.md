# PC-1 results (run 2026-11-24 by the orchestrator)

Environment: Windows (Version 10.0.26100.8037), Electron 45.4.1 (Chrome 156.0.8078.100), the repository's Electron binary, one process, probe files outside the repository. Page: a 400px scrolling list (overflow:auto) holding one playlist group (a plain li with a `position: sticky; top: 0` head and 20 member rows) followed by 60 plain rows; every row `content-visibility: auto; contain-intrinsic-size: auto 64px; height: 64px`. The group container itself has no content-visibility.

1. Rendering is skipped for off-screen rows: on load, 80 `contentvisibilityautostatechange` events reported skipped and 16 reported shown; after scrolling to the end, 118 skipped and 56 shown in total. So only rows near the viewport are rendered.
2. The sticky group head stays pinned at the top of the scrolling list while the list is scrolled inside the group (head top = list top = 0 at scrollTop 300). This holds because the sticky head's parent (the group li) has no content-visibility; only the rows do.
3. Focus rings via keyboard (Tab, :focus-visible): an inset ring (`outline-offset: -3px`) on a row button is drawn (red pixel on the button's inner edge). An outset ring (`outline-offset: 2px`) is drawn too when it lies inside the row box (blue pixel 3.5px left of the button, row padding 8px).
4. Not measured: an outset ring that crosses the row's own edge. content-visibility: auto implies paint containment, so anything painted outside the row box is clipped; keep focus rings inset (or inside the row's padding), as the architecture says.
5. Not measured: scrolling smoothness or CPU with 50+ live-updating rows (that is the manual checklist item 8).
