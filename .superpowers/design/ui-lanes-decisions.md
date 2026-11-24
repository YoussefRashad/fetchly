# Lanes redesign: decision ledger (for the owner, 7 AM review)

Branch `feat/lanes-redesign`, worktree D:\ContactRepos\idm\.claude\worktrees\ui-redesign-proposals-f6c9af (plans worktree: .claude\worktrees\lanes-plans, read-only, detached).
Mode: Lanes: large (owner). C8, C9, C11, C10 in Delegation mode (owner, 02:43).

## Decided by the owner (in chat, before 02:47)
- Direction: Lanes + additions + Zip logo. Side rail with filters and Settings at the bottom, Settings as a drawer (owner's idea).
- C7 (main reports stream role and aria2 segments): yes.
- Stale speed blanking: not in this redesign.
- Delivery: one branch, one commit per component, one PR to main.
- Strip time figure: running downloads only, labelled, "~" when approximate.
- Late toasts after showing the window: last 30 s.
- OS notification only when the window is hidden, minimised or not focused.
- Plans in a separate worktree; Delegation for the small components.

## Decided by the orchestrator (small; Fable not needed)
- Plans live in docs/plans/ (current convention).
- r1 recommendations accepted: row actions stay visible, Add as an end-side sheet, minWidth 720, playlist % by finished items, fonts via @fontsource npm packages (subset CSS, woff copies shipped).
- C1: light `ok` #17784A -> #167447 (4.70:1 on the rail's chrome; was 4.46); `open` icon mirrored under RTL; Latin-extended glyphs fall back to Segoe UI (known limitation); `.entries em` no italics; e2e:real once after C1.

- C2: non-finite byte counts are "not known", non-finite/negative speed adds 0 (as queue.ts); App.tsx not edited in C2; rememberThumb bad cap falls back to 200; a paused non-resumable job reads "cannot resume" next to an enabled Resume (architecture's choice, flagged for your eye).
- C2 Q7 (connection count after the job stops; stalled count) deferred to C7's plan, to be answered by the Fable advisor then.
- C2 plan frozen (0df7ed7) after critique pass 2 (0 BLOCKING); the orchestrator applied that pass's 3 NON-BLOCKING wording fixes at freeze (recorded in the plan's freeze note).
- C1 Codex review: 1 BLOCKING = run e2e:real and the rendered checks before commit (running e2e:real all, 03:13). NON-BLOCKING: light field/chrome is 2.91:1, not the plan's 2.92 (pairing is banned anyway; noted in the commit message, frozen plan not edited).

- C3 (orchestrator): the icon rail shows a 0 badge too (as the architecture says), forced-colours block kept and listed as overturnable, strip shows "0 B/s" when something runs at speed 0 (Q2 as recommended).

## Decided by Fable advisor (after 02:47)
- 03:28, C3 window widths (after probe PW-1: page = window - 15px at 150%): keep start width 1120 and minWidth 720; a playlist member's name minimum absorbs its 22px indent (120 -> 98px) so "added" shows at the start size and members fit the 706px viewport; accept the interim speed-column drop below an 800px viewport (C3 only, recorded as a deviation from architecture section 10). Nothing waits for you except: QUEUED FOR YOU before C4 freezes: should the final lane rows keep a third column drop, and which column?

## Probes run
- PF-1 fonts (pass), PV-1 visibility (pass, note: occluded window isVisible=true but page hidden), PC-1 content-visibility (pass), PU-1 URL parser (pass). Results in the worktree's .superpowers/design/probe-*.md.
- PW-1 window: page viewport = outer width - 15px at 150% scaling; scrollbar 15px.
- PE-1 taskbar progress: the mapping holds; progress is LOST on hide()/show() and on a new window, so C9 must re-apply on show and on creation (reset the last-applied cache). 0.99 looks full.
- PE-2 icons: createFromBitmap takes PREMULTIPLIED BGRA; tray and window icon use the 1x representation only (no pick by scale), so C8 should draw the tray at 16 x scale factor and give the window one large (256) image.
- PC-2 (04:15, for C4): Chromium does NOT scroll a focused button out from under the sticky playlist head (Shift+Tab and focus() leave it hidden); fix = scroll-margin-block-start (head + 8px) on the focusables in a playlist body. The sticky head (z-index 2) took clicks over open dialogs; fix = `.jobs { isolation: isolate }`. content-visibility with real-height rows: no scroll jump. A "just done" flash that starts while the window is hidden plays in full when the window shows, however late.

## QUEUED FOR YOU (C4 freezes after your answers)
- Q-C4-1: should the final lane rows drop a third column at the narrowest window, and which? Options V-M / V-S / V-A / V-Q in the C4 plan's 5.5 (only V-A fully matches the architecture; V-M and V-S hide a heading). Plan r2 carries a recommendation; your pick is written in at freeze.
- Q-C4-2 (critique N-6): the green "just done" flash for a job that finished while the window was hidden or the row was off-screen: play it late always, only if the row was visible at the finish, or only within N seconds of the finish (N is yours, never 0).

## Progress (orchestrator)
- 04:03 C1 committed (1656578): gates green (4540 tests), e2e:real 42 pass / 0 fail / 7 not-run, rendered checks in .superpowers/design/c1-validation.md, Codex review pass 3: 0 BLOCKING. Left for your manual pass: live Windows theme switch, npm run dev, Latin-extended titles, screen reader speech, keyboard in Add dialog and Settings.
- Plans frozen: C1 (359e4dd), C2 (0df7ed7), C3 (880cbf2). C4 draft r1 in critique; Q-C4-1 (third column drop for the final rows) waits for you.
- C2 tests lane running.
- 04:30 C4 plan r2 done (Fable, $4.78, 16 turns, ~29k input/turn), saved as lanes-plans/.superpowers/design/c4-plan-draft-r2.md. NEXT: resume critique session c4604057-1400-4bf2-ae73-e38ecc96d73b for pass 2 (lane plan-critique, --read-only). C2 tests lane (bx6g6b3wm) still running; then C2 implement, gates, Codex review, commit.
- 04:30 Orchestrator stopped: usage limit reached.
- 04:33 C2 tests lane finished (result in scratchpad lanes/c2-tests/result.json). Not yet reviewed: spot-check specs, then C2 implement.

## Decided by the owner (08:00, in chat)
- Q-C4-1: **V-M**. At the narrowest viewport (706 to 735px) the speed moves to the end of line two and the Speed heading hides; recorded as DV-9. Write into every [Q-C4-1/n] tag of c4-plan-draft-r2.md as already filled (no Appendix A substitution).
- Q-C4-2: **F-B with FLASH_LATE_MS = 10000** (10 s). A job that finished while the window was hidden flashes on return only within 10 s of the finish. Fill `⟨N⟩` in 6.3 with 10000; the [Q-C4-2/n] tags are already F-B.
- Owner is moving to a new laptop (08:00). Work paused here.

## Handover (08:00): what exists only on THIS laptop
- 12 uncommitted C2 test files in the ui-redesign-proposals-f6c9af worktree (not yet reviewed): tests/helpers.ts, banners/bannersServer/status tests (edited), progress, finished, lanes, listModels, rowEqual, settingsSection, summary, thumbnail (new).
- Git-ignored: lanes-plans/.superpowers/design/c4-plan-draft-r2.md, c4-critique-r1.md, probe-*.md (PC-2, PW-1, PE-1, PE-2), c1-validation.md; scratchpad lane briefs and results; this ledger.
- Next steps, in order: C4 critique pass 2 on draft r2 (fresh or resumed session c4604057), then freeze C4 with the two answers above; review C2 tests, then C2 implement, gates, Codex review, commit; then C3 tests/implement/review; C5, C6 plans; C8/C9/C11 Delegation; C7; C10 docs; Fable readiness check before any PR.
