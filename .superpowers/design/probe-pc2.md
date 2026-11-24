# Probe PC-2: sticky playlist head vs focus, dialogs, content-visibility, late one-shot animations

Electron 45.4.1 (D:/ContactRepos/idm/node_modules/electron/dist/electron.exe), Windows 11, one process per case.
Script: scratchpad/probes/pc2/main.cjs. Page: `main{height:500px;overflow-y:auto}`, sticky `.group-head{position:sticky;top:0;height:48px;z-index:2}`,
30 member rows + 30 lone rows (64px, or content-height "tall" rows), `content-visibility:auto;contain-intrinsic-size:auto 108px` on rows.

## B-2: focus under the stuck head
Setup: member 10 placed directly under the stuck head, so member 9's button (top 2, bottom 30) sits under the head (0..48) but inside the scroller's box.

| case | Shift+Tab b10 -> b9: b9 after | hidden under head | programmatic focus() of a button under the head |
|---|---|---|---|
| no fix | 2..30 (no scroll at all) | YES | YES (2..30) |
| `.group .act{scroll-margin-block-start:56px}` | 56..84 | no | no (56..84) |
| `main{scroll-padding-block-start:56px}` | 264..292 | no | no (264..292, scrolls much further) |
| tall rows (content height), no fix | 0..28 | YES | no (row geometry differed) |

Result: the browser does NOT scroll a focused element that is already inside the scroller's box, even when the sticky head covers it fully (WCAG 2.4.11 failure). `scroll-margin-block-start` = head height + 8 on the focusables inside a playlist body fixes both keyboard and programmatic focus with the smallest jump. `scroll-padding` on the scroller also works but moves much further. Recommendation: scroll-margin on every focusable inside a group body, sized from the head's height token.

## B-1: sticky head vs fixed backdrop
| case | elementFromPoint inside dialog, over the head | outside dialog, over the head |
|---|---|---|
| head z-index 2, backdrop no z-index | head (`gh`) | head (`gh`) |
| + `.jobs{isolation:isolate}` | dialog (`dlg`) | backdrop (`bd`) |

Result: confirmed. The head paints over (and takes clicks from) a dialog whose backdrop has no z-index. `isolation:isolate` on the list fixes it.

## content-visibility with content-height rows (cv-tall)
scrollTop set to 400/1200/2400/3600/1800/600: read back equal immediately and after 300 ms (no jump). scrollHeight drifts down as rows get measured (6424 -> 6054) because the 108px placeholder is larger than real rows. Head stays pinned at the scroller top while inside its group; at 3600 (group ends at 3008) it scrolls away as expected.
Note: keep contain-intrinsic-size close to the real row height to limit the scrollbar drift (C4 N-17).

## Late one-shot animation
- Row skipped by content-visibility (off-screen), flash added: after 3 s the animation is `finished` (opacity 1); scrolling it in later shows no flash. The timeline runs while skipped.
- Window hidden (`html[data-hidden] *{animation-play-state:paused !important}`), flash added: after 3 s it is `paused` at t=0 (opacity 0); after removing data-hidden it plays from the start (t=189 ms after 200 ms). So a flash started while hidden plays late when the window shows, however long ago it began. That is the owner question N-6 (a time bound; no zero default).
