# C1 validation evidence (orchestrator, 2026-11-24)

## e2e:real (built app, real sites and tools, scratch profile .e2e-real/)
- `npm run e2e:real -- all` (03:13-03:42), Electron from the main checkout (FETCHLY_E2E_ELECTRON, same 45.4.1; the worktree's electron package has no dist/): pass 35, not-run 7 (14, 31, 38, 41, 42, 43 need network/system changes or the packaged app; 20 half-run: the "finishing" state was not caught, as in earlier runs), fail 7.
- The 7 failures (2, 13, 15, 12, 45, 48, 24) all said "tools are not installed: run check 1 first" (ORDER ran them before check 1). Re-run alone after check 1 installed the tools: pass 7 of 7.
- Total: 42 pass, 0 fail, 7 not-run. Logs: .superpowers/design/c1-e2e-real.log, c1-e2e-real-2.log.

## Rendered checks (C1 plan section 10, subset), Playwright on the built app
Window at the start size (viewport 1106), a finished file, a running 18-item playlist (3 downloading, 15 queued) and a queued video, speed limit 300 KB/s. For each of light-en, light-ar, dark-en, dark-ar (setSettings, reload, prefers-color-scheme emulated to match):
- body background: light rgb(237,240,244) = #EDF0F4; dark rgb(15,21,28) = #0F151C.
- dir/lang: ltr/en and rtl/ar.
- Fonts (check 2): body font-family "IBM Plex Sans", "IBM Plex Sans Arabic", "Segoe UI", ...; loaded faces: IBM Plex Sans 400/600 in English, plus IBM Plex Sans Arabic 400/600 in Arabic. No resource request other than file: (none at all to the network).
- Column fit (check 11): no `.job-main > span` other than the name and no `.job-actions` has scrollWidth > clientWidth in any of the four, finished row with "Open", folder, remove, delete included; columns line up by eye in the screenshots.
- Arabic (checks 3 and 4 by eye): RTL layout, the open playlist arrow points down, digits are Latin, sizes and speeds read LTR, progress fills from the start (right) side.
- Focus (check 6, part): Tab through Settings, the five filters, "Open" and "Open folder" in dark Arabic: each matches :focus-visible with `outline: solid 2px rgb(138,164,255)` (#8AA4FF, dark accent); in light the ring is #2346C4.
- Screenshots: scratchpad/probes/render-c1/out/{light,dark}-{en,ar}.png, focus-ar-dark.png.

## Rendered checks, part 2 (Playwright on the built app, English, light)
- Check 5, reduced motion: with prefers-reduced-motion emulated to reduce, no element in the window has a transition duration above 0 or an animation. With no preference, the only transition is the progress fill (`.fill`: width 0.25s, today's rule).
- Check 7, names: every button in the window (21: Add, Settings, the five filters, the playlist arrow, Pause all, Cancel all, and per row Open folder, Pause, Cancel, Remove from list) has a non-empty accessible name from aria-label or text; none contains a glyph character; every icon is an svg with aria-hidden=true. Every icon button has a title equal to its name, except the playlist arrow (named by the playlist title, no title, as today) and the close-message button (not on screen in this run; aria-label and no title, as today).
- Check 8, digit stability: a running row sampled 12 times over 6 s while its size went 0.2 -> 0.7 / ~35.8 MB: the size text's rendered width stayed 94.2px and the speed's 70.7px; both cells have font-variant-numeric: tabular-nums.
- Check 13, skipped entry: Add dialog of a local feed with a "[Private video]" item: the reason "private" is an em with font-style normal and color rgb(86,99,117) = #566375 (muted).
- Screenshot: scratchpad/probes/render-c1/out2/add-dialog-en.png.

## Left to the owner's manual pass (with the reason)
- Check 1, follow-system with a live Windows theme switch while resizing: needs changing the Windows app mode (a system setting). The token values for both modes and the dark background are covered above.
- Check 9, npm run dev: the worktree's electron package has no binary (e2e used the main checkout's), so the dev server cannot start Electron here. The built app's fonts are covered.
- Check 12, Latin-extended, Cyrillic and Greek titles: a known limitation the plan says to report to the owner by eye.
- Screen reader speech (check 7 beyond the markup): no screen reader in this run.
- Check 6 beyond the main window: the Add dialog and Settings controls by keyboard.

Codex review: pass 1 BLOCKING (this evidence), pass 2 BLOCKING (the rest of section 10), pass 3: 0 BLOCKING, ready to commit to the feature branch.
