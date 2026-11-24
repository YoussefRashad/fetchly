**Decisions**

1. **Start size: (c).** Keep 1120 and let a member row's name minimum absorb its 22px indent (120 → 98px), so "added" shows for every row.
2. **Minimum width: (a).** Keep `minWidth: 720`; the same rule makes member rows fit the 706px viewport.
3. **Q5 speed drop: accept**, as an interim rule only, below an 800px viewport.
4. **Nothing waits for 07:00.** One item is queued for the owner before C4 freezes.

**Reasons**

1. The indent is padding on the member `li` (`styles.css:331-334`), so shrinking the name minimum by 22px brings a member down to the lone row's need: 1087px against a 1106px viewport, 19px spare.
   - One way to do it is `minmax(var(--name-min, 120px), 2fr)` with `.group ul .job { --name-min: 98px }`, which covers every breakpoint and closes all three of B-1's ranges.
   - The `index.ts:36` comment stays true and C3 changes no shipped default for a layout that never ships.
   - If the implement lane finds this does not hold, fall back to (b), not (a); the default width is C4's to re-derive.

2. At the minimum, a member needs 719 − 22 = 697px against 706px, 9px spare. That covers the unprobed 100% and 125% scaling, where the frame may differ by a pixel or two.
   - This is inside the draft's permitted remedy (name minimum down to 90px).
   - The plan must state 4.9 and the manual checks in viewport px.
   - C4 must fit a 706px viewport, members included.

3. Without the speed drop, the icon-rail row needs 56 + 696 + 31 = 783px, which cannot fit 706px. Rejecting it would mean a minimum width near 800, against the owner's accepted 720. The summary strip still shows total speed. Record it in the C3 plan as an interim deviation from architecture section 10; the frozen architecture is not edited.

4. Items 1–3 are interim, reversible, and replaced by C4 within the same PR. Queue for the owner: whether the shipped C4 rows keep a third drop, and which column, since section 10 lists only two.

**Not checked:** the playlist head's grid (`auto` arrow + 100px name minimum) against the same figures. The plan revision should add that row to the arithmetic.