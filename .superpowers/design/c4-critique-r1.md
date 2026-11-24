**Plan-critique of C4 draft r1: 3 BLOCKING, 17 NON-BLOCKING.** Nothing was run (read-only lane); B-1 is argued from the CSS painting rules and B-2 from my knowledge of Chromium's focus scrolling, so both go into one probe.

## BLOCKING

**B-1 — 4.6 `.group-head { z-index: 2 }`, section 12 "With C5", D8: the playlist head paints over open dialogs.**
- `.backdrop` is `position: fixed` with no `z-index` (`styles.css:421-429`), and no plan through C3 gives it one.
- Nothing between the root and `.group-head` creates a stacking context: `main` only has `overflow-y: auto`, and `li.group` is deliberately not contained.
- So the head (`z-index: 2`) and the bracket (`z-index: 1`) sit in the root stacking context above the Settings and Add dialogs, and take their clicks. That includes e2e's `clickButton(dialog, 'Close')` when a playlist is listed.
- Section 12's "C4 sets no z-index above 2" leaves the fix to C5, so C4 alone breaks D8.
- Fix: add `.jobs { isolation: isolate; }` to 4.6, assert it in 6.9, and add a manual check (Settings and Add open over a stuck head, in both languages). Reword the C5 and C6 boundary rows: the list is its own stacking context.

**B-2 — section 7 and section 11 ("Head stuck over a focused member button"): an unprobed engine claim that I expect to be false.**
- The plan says the browser scrolls a focused button out from under the stuck head. As far as I know, Chromium treats an element inside the scrollport as already in view even when a sticky box covers it. Shift+Tab inside a scrolled 20+ playlist would then leave focus hidden.
- That fails manual checks 8 and 11 and architecture 9.8 and 9.11, and 5.6 has no remedy for it.
- Fix: run probe PC-2 before the freeze (one process per case, files outside the repo, Electron 45.4.1):
  1. Shift+Tab to a member button under a stuck head: does it scroll clear?
  2. The same with `scroll-margin-block-start` on the member buttons, or `scroll-padding-block-start` on `main`.
  3. A sticky head with `z-index: 2` against a fixed backdrop, with and without `isolation: isolate` on the list (confirms B-1).
  4. Rows with content height (not PC-1's fixed 64px) under `content-visibility: auto`: head still pinned, no scrollbar jump.
  5. A one-shot animation in a skipped row and in a `data-hidden` document: when does it play? (Backs 4.7's last bullet and N-6.)
- Then write the result and the chosen CSS into 4.6 and 4.8, and correct the two sentences.

**B-3 — 5.5, 13.1 DV-9, section 14: the plan lets itself be frozen with Q-C4-1 open.**
- 5.5 says "the orchestrator names the variant in the briefs" and allows the answer after the tests are written.
- C3's frozen C4 boundary row says the question is "to be answered before C4's plan is frozen". Tests are written from the frozen plan only, and a frozen plan is never edited, so a variant that lives in a brief has no frozen source.
- Fix: at freeze, 5.5 states the chosen variant and who chose it. 6.9's two assertions, manual check 6's last row and DV-9 are filled in or deleted. Drop the "answered after the tests" path, or say a later change is an owner-approved amendment in a new file.
- The per-answer arithmetic itself is correct (see "Verified" below).

## NON-BLOCKING

**Q-C4-1 options (5.5, 5.6, 6.9)**
- **N-1 — V-M is not a clean "conforms to section 10".** It hides the Speed heading, and architecture C4 says headings "drop with their columns". "Nothing is lost" overstates it, and the "86px shorter" status line applies equally to V-S. Only V-A fully conforms. Fix: record a deviation for V-M too and describe it neutrally to the owner.
- **N-2 — V-A's budget cannot be computed by `need()` as defined.** It always counts the name as 120, and V-A has no template in the 735 block. Fix: `need(template, nameMin)`; for V-A, the 929 template with 90.
- **N-3 — V-Q's head template uses `minmax(120px, 1fr)`,** which `need()` has no token rule for. Fix: use the `var(--name-min, 120px)` form.
- **N-4 — Remedy 1 has two wrong bounds.**
  - "Added" at 1106 holds while `A ≤ 222`, not 214: `684 + A + 191 ≤ 1097`.
  - 801 fits while `A ≤ 209`, not 200: `484 + A + 99 ≤ 792`.
  - The 9px was subtracted twice in both; the 212 for V-M and V-S is right.
  - V-A (`A ≤ 156`, no slack) and V-Q (`A ≤ 192`) are missing.

**Decisions that belong on the owner's list (13.2)**
- **N-5 — Q2 / DV-2 removes a PR #8 heading (Status) and a dictionary key.** It is recorded and can be overturned, but it is filed as "already followed". Fix: list it as a visible change shown to the owner at the C4 commit, as C2 did with OD-5.
- **N-6 — The "just done" flash can play long after the finish.** It plays when a skipped row scrolls into view, and for every job that finished while the window was hidden (the animation is paused at opacity 1, then all play on return). Calling it "harmless" hides a choice. Fix: make it an open question — play late, or only if the row was rendered and visible at the finish — with any time bound left to the owner, none defaulting to zero.

**Accessibility and contrast (4.6, section 7)**
- **N-7 — The merge marker's pair is missing from the contrast table.**

  | `--ink` on | Light | Dark |
  |---|---|---|
  | `--lane-v` | about 2.16 | about 1.94 |
  | `--lane-a` | about 3.16 | about 1.77 |

  Fix: state that it is decoration under D1, or change its colour.

**Row height (4.6, 5.6, check 4)**
- **N-8 — An Arabic done row comes out about 2.75px taller.** "فتح" at 15px/1.65 with `2px 8px` padding is about 30.75px against the 28px icon buttons. That breaks check 4, and remedy 2 only allows changing `--row-h`. Fix: fix line one's height, or give the Open button a `line-height`, as a permitted remedy.
- **N-9 — `--row-h` omits borders.** By the plan's own CSS a lone row is 110px and a member 109px, not 108px.

**Boundary with C1 and C3 (sections 3, 4.6, 9, 10)**
- **N-10 — C1's Q7 deferred an eye check to C4** (icon stroke weight beside 15px Arabic text). No C4 check covers it.
- **N-11 — C3's permitted remedies may have landed** (a `max-width: 1117px` members query, or lowered minimums inside the 800 query). 4.6's "Removed" list and the `shellSources` edits should say "and any remedy rule C3 landed".

**Tests and CSS detail (4.3, 4.6, 6.1, 6.9)**
- **N-12 — 6.9's width budget** should name the selector whose `grid-template-columns` it reads (`.jobs-head, .job-main, .group-head`); `.lane` and `.app` have templates too.
- **N-13 — 6.9's "every `transition:` value names `transform` or `none`"** must tolerate C1's `none !important`.
- **N-14 — 6.1:** add a `+Infinity` fraction and cell to the table. The rule gives 0, where clamping first would give 1.
- **N-15 — 4.6, 4.3:** a media job with a segments entry (C2 row 33) gets the label "File". State that this is accepted under D12, or key the label on `job.kind`.
- **N-16 — Section 8:** up to 24 cells × 10 rows each run a `transform` transition every 250ms. Name it under check 8, with dropping the cell transition as a permitted remedy.
- **N-17 — 4.6:** `contain-intrinsic-size: auto var(--row-h)` sets both axes. `contain-intrinsic-block-size` says what is meant; PC-1 probed the shorthand, so this is optional.

## Verified, no finding

- **File:line claims (item 1):** every checked citation in `JobRow`, `GroupRow`, `JobList`, `styles.css`, `strings*.ts`, `format.ts`, `columns.test.ts:82`, `strings.test.ts`, `lib.mjs`, `checks.mjs`, `index.ts:36`, `package.json:14-18` and the mockup lines 217, 225-226 and 428 is correct.
- **Section 6 tables (item 2):** every row of 6.1–6.8 follows from its rule and from C2. That includes row 10 (29/100 gives 28 in both functions), the `groupView` tie `['67%', '1 skipped']` and all Arabic texts.
- **Writability (item 3):** exports, paths, signatures and builders are complete, apart from N-2, N-3 and N-12.
- **Boundaries (item 4):** C2 meanings, C1 tokens and icons, C3's frame figures, `--name-min`, `ShowAllContext` and DV-7 all match. DV-1 to DV-8 need no frozen-plan edit.
- **Widths (item 5):** needs 840 / 730 / 640 / 554, thresholds 1039 / 929 / 735 and all rows of 5.4 recompute. So do the four Q-C4-1 options at 706:

  | Option | Need | Spare |
  |---|---|---|
  | V-M, V-S | 554 | 65 |
  | V-A | 610 | 9 |
  | V-Q | 574 (head 494) | 45 |

- **D8 and e2e (item 6):** the two superseded tests are the right ones. All five section-8 hooks hold, and no lane text contains "skipped".
- **Contrast (item 7):** the four new pairs recompute to about 4.92/5.20, 5.26/5.30, 3.21/3.14 and 6.84/6.39.
- **Motion and performance (items 7, 8):** fills start from the start side in RTL; animations are transform and opacity only. The `width` transition is removed with `.bar` and asserted gone.
- **Strings (item 9):** parity, non-empty, translated, no تحميل, Western digits; `SAME_IN_BOTH` is unchanged.
- **Stale rules and documents (items 11, 12):** there is no rejecting rule and no zero tolerance; no follow-up edits a document, frozen or living.

**BLOCKING count: 3.** After B-1 and B-2 are fixed (PC-2 run and written in), the plan can be frozen once the owner's Q-C4-1 answer is written into 5.5 as B-3 requires.