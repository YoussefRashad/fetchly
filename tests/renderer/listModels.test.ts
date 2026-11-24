// C2 sections 5.4 and 5.5: filterCounts and groupView (src/renderer/src/format.ts).
// (+) = a row the plan adds. "derived" = not a table row: it enumerates a rule (every state, every filter).
import { describe, expect, it } from 'vitest';
import { filterCounts, groupSummary, groupView, matchesFilter, type Filter, type GroupView } from '../../src/renderer/src/format';
import type { Job, JobState } from '../../src/shared/types';
import { makeJob } from '../helpers';

const STATES: JobState[] = ['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped'];
const FILTERS: Filter[] = ['all', 'downloading', 'paused', 'done', 'failed'];

const job = (state: JobState, over: Partial<Job> = {}): Job => makeJob({ state, ...over });
const member = (state: JobState, index: number, over: Partial<Job> = {}): Job => makeJob({ state, groupId: 'g1', index, ...over });

describe('filterCounts (5.4)', () => {
  it('counts the seven states: 7 / 3 / 1 / 1 / 2', () => {
    const jobs = ['queued', 'downloading', 'merging', 'paused', 'done', 'failed', 'skipped'].map((s) => job(s as JobState));
    expect(filterCounts(jobs)).toEqual({ all: 7, downloading: 3, paused: 1, done: 1, failed: 2 });
  });

  it('a probing job is a downloading one', () => {
    expect(filterCounts([job('probing')])).toEqual({ all: 1, downloading: 1, paused: 0, done: 0, failed: 0 });
  });

  it('is all zero for no jobs', () => {
    expect(filterCounts([])).toEqual({ all: 0, downloading: 0, paused: 0, done: 0, failed: 0 });
  });

  it('(+) counts jobs, not playlists: three members and one lone job', () => {
    const jobs = [member('done', 1), member('done', 2), member('queued', 3), job('paused')];
    expect(filterCounts(jobs)).toEqual({ all: 4, downloading: 1, paused: 1, done: 2, failed: 0 });
  });

  it('(+) always has exactly the five keys', () => {
    const lists: Job[][] = [
      [],
      [job('probing')],
      ['queued', 'downloading', 'merging', 'paused', 'done', 'failed', 'skipped'].map((s) => job(s as JobState)),
      [member('done', 1), member('queued', 2), job('paused')],
    ];
    for (const jobs of lists) expect(Object.keys(filterCounts(jobs)).sort()).toEqual(['all', 'done', 'downloading', 'failed', 'paused']);
  });

  it('(+) property: for each filter, the count equals the jobs matchesFilter accepts, for every subset of the eight states', () => {
    for (let mask = 0; mask < 1 << STATES.length; mask += 1) {
      const jobs = STATES.filter((_state, i) => (mask & (1 << i)) !== 0).map((state) => job(state));
      const counts = filterCounts(jobs);
      for (const f of FILTERS) expect(counts[f], `${f} for mask ${mask}`).toBe(jobs.filter((j) => matchesFilter(j, f)).length);
    }
  });

  it('(+) property, with each state repeated, so a count is not a yes/no', () => {
    const jobs = STATES.flatMap((state) => [job(state), job(state), job(state)]);
    const counts = filterCounts(jobs);
    for (const f of FILTERS) expect(counts[f]).toBe(jobs.filter((j) => matchesFilter(j, f)).length);
    expect(counts).toEqual({ all: 24, downloading: 12, paused: 3, done: 3, failed: 6 });
  });

  it.each(STATES)('derived: one %s job counts in exactly the filters matchesFilter names', (state) => {
    const counts = filterCounts([job(state)]);
    for (const f of FILTERS) expect(counts[f]).toBe(matchesFilter(job(state), f) ? 1 : 0);
  });

  it('derived: does not change the list', () => {
    const jobs = [job('queued'), job('done'), job('paused', { interrupted: true })];
    const before = structuredClone(jobs);
    filterCounts(jobs);
    expect(jobs).toEqual(before);
  });
});

describe('groupView (5.5)', () => {
  const FLAG_KEYS = ['canPause', 'canResume', 'done', 'percent', 'skipped', 'speed', 'total', 'unfinished'];

  it('row 1: done, done, downloading at 1000, skipped', () => {
    const members = [member('done', 1), member('done', 2), member('downloading', 3, { speed: 1000, bytesDone: 50, bytesTotal: 100 }), member('skipped', 4)];
    expect(groupView(members)).toEqual({ done: 2, total: 3, skipped: 1, percent: 67, speed: 1000, canPause: true, canResume: false, unfinished: true });
  });

  it('row 2: skipped, skipped: nothing to download, nothing offered', () => {
    expect(groupView([member('skipped', 1), member('skipped', 2)])).toEqual({
      done: 0,
      total: 0,
      skipped: 2,
      percent: 0,
      speed: 0,
      canPause: false,
      canResume: false,
      unfinished: false,
    });
  });

  it('row 3: paused, done', () => {
    expect(groupView([member('paused', 1), member('done', 2)])).toMatchObject({ canResume: true, canPause: false, unfinished: true });
  });

  it('row 4: merging only, with speed 500 left over', () => {
    expect(groupView([member('merging', 1, { speed: 500 })])).toMatchObject({ speed: 0, canPause: false, canResume: false, unfinished: true });
  });

  it('row 5: done, failed', () => {
    expect(groupView([member('done', 1), member('failed', 2)])).toMatchObject({ canPause: false, canResume: false, unfinished: false });
  });

  it('(+) no members: everything is 0 or false', () => {
    expect(groupView([])).toEqual({ done: 0, total: 0, skipped: 0, percent: 0, speed: 0, canPause: false, canResume: false, unfinished: false });
  });

  it('(+) paused (speed 300 left over), downloading at 1000, downloading at 500', () => {
    const members = [member('paused', 1, { speed: 300 }), member('downloading', 2, { speed: 1000 }), member('downloading', 3, { speed: 500 })];
    expect(groupView(members)).toMatchObject({ speed: 1500, canPause: true, canResume: true, unfinished: true });
  });

  it.each(['queued', 'probing'] as const)('(+) %s only: can pause, cannot resume, unfinished, speed 0', (state) => {
    expect(groupView([member(state, 1, { speed: 700 })])).toMatchObject({ canPause: true, canResume: false, unfinished: true, speed: 0 });
  });

  it('(+) done, done: 2 of 2, 100%, not unfinished', () => {
    expect(groupView([member('done', 1), member('done', 2)])).toMatchObject({ done: 2, total: 2, percent: 100, unfinished: false });
  });

  it('(+) a paused member that is cut off (interrupted) can still be resumed: the flag mirrors today\'s rule', () => {
    expect(groupView([member('paused', 1, { interrupted: true })]).canResume).toBe(true);
  });

  it('(+) downloading at 1000, downloading at NaN, downloading at -5: only the good speed counts (OD-2)', () => {
    const members = [member('downloading', 1, { speed: 1000 }), member('downloading', 2, { speed: Number.NaN }), member('downloading', 3, { speed: -5 })];
    expect(groupView(members).speed).toBe(1000);
  });

  it('derived: Infinity and -Infinity speeds add 0 too, and a speed of 0 is a good speed', () => {
    const members = [
      member('downloading', 1, { speed: 1000 }),
      member('downloading', 2, { speed: Number.POSITIVE_INFINITY }),
      member('downloading', 3, { speed: Number.NEGATIVE_INFINITY }),
      member('downloading', 4, { speed: 0 }),
    ];
    expect(groupView(members).speed).toBe(1000);
    expect(Number.isFinite(groupView(members).speed)).toBe(true);
  });

  /** The members of every row above, for the property. */
  const ROW_MEMBERS: Array<[string, Job[]]> = [
    ['row 1', [member('done', 1), member('done', 2), member('downloading', 3, { speed: 1000 }), member('skipped', 4)]],
    ['row 2', [member('skipped', 1), member('skipped', 2)]],
    ['row 3', [member('paused', 1), member('done', 2)]],
    ['row 4', [member('merging', 1, { speed: 500 })]],
    ['row 5', [member('done', 1), member('failed', 2)]],
    ['empty', []],
    ['mixed', [member('paused', 1, { speed: 300 }), member('downloading', 2, { speed: 1000 }), member('downloading', 3, { speed: 500 })]],
    ['queued', [member('queued', 1)]],
    ['probing', [member('probing', 1)]],
    ['all done', [member('done', 1), member('done', 2)]],
    ['paused interrupted', [member('paused', 1, { interrupted: true })]],
    ['bad speeds', [member('downloading', 1, { speed: 1000 }), member('downloading', 2, { speed: Number.NaN }), member('downloading', 3, { speed: -5 })]],
  ];

  it.each(ROW_MEMBERS)('(+) property: done, total and percent are groupSummary(members): %s', (_label, members) => {
    const view = groupView(members);
    const summary = groupSummary(members);
    expect({ done: view.done, total: view.total, percent: view.percent }).toEqual(summary);
  });

  it('has exactly the eight fields of GroupView', () => {
    expect(Object.keys(groupView([])).sort()).toEqual(FLAG_KEYS);
    expect(Object.keys(groupView([member('downloading', 1)])).sort()).toEqual(FLAG_KEYS);
  });

  describe('derived: every state, one member each', () => {
    it.each<[JobState, boolean, boolean, boolean]>([
      // state, canPause, canResume, unfinished
      ['queued', true, false, true],
      ['probing', true, false, true],
      ['downloading', true, false, true],
      ['paused', false, true, true],
      ['merging', false, false, true],
      ['done', false, false, false],
      ['failed', false, false, false],
      ['skipped', false, false, false],
    ])('%s -> canPause %s, canResume %s, unfinished %s', (state, canPause, canResume, unfinished) => {
      const view: GroupView = groupView([member(state, 1)]);
      expect({ canPause: view.canPause, canResume: view.canResume, unfinished: view.unfinished }).toEqual({ canPause, canResume, unfinished });
    });

    it.each<[JobState, number]>([
      ['queued', 0],
      ['probing', 0],
      ['downloading', 700],
      ['paused', 0],
      ['merging', 0],
      ['done', 0],
      ['failed', 0],
      ['skipped', 0],
    ])('%s with speed 700 adds %i', (state, speed) => {
      expect(groupView([member(state, 1, { speed: 700 })]).speed).toBe(speed);
    });

    it.each(STATES)('%s: skipped counts only skipped members', (state) => {
      expect(groupView([member(state, 1)]).skipped).toBe(state === 'skipped' ? 1 : 0);
    });

    it('skipped counts every skipped member, whatever the others are', () => {
      const members = [member('skipped', 1), member('done', 2), member('skipped', 3), member('failed', 4), member('skipped', 5)];
      expect(groupView(members).skipped).toBe(3);
    });
  });

  it('derived: one flag from one member among many, and the flags do not depend on the order', () => {
    const states: JobState[] = ['done', 'failed', 'skipped', 'paused'];
    expect(groupView(states.map((s, i) => member(s, i + 1)))).toMatchObject({ canResume: true, canPause: false, unfinished: true });
    expect(groupView([...states].reverse().map((s, i) => member(s, i + 1)))).toMatchObject({ canResume: true, canPause: false, unfinished: true });
    const finished: JobState[] = ['done', 'failed', 'skipped'];
    expect(groupView(finished.map((s, i) => member(s, i + 1)))).toMatchObject({ canResume: false, canPause: false, unfinished: false });
  });

  it('derived: does not change the members', () => {
    const members = [member('downloading', 1, { speed: 5 }), member('paused', 2)];
    const before = structuredClone(members);
    groupView(members);
    expect(members).toEqual(before);
  });
});
