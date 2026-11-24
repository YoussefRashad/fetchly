// C2 section 5.3: summary (src/renderer/src/model/summary.ts).
// (+) = a row the plan adds. "derived" = not a table row: it enumerates a rule (every state) or a stated boundary.
// OD-2: a non-finite byte count is "not known"; a non-finite or negative speed adds 0 to a total.
import { describe, expect, it } from 'vitest';
import { summary, type Summary } from '../../src/renderer/src/model/summary';
import type { Job, JobState } from '../../src/shared/types';
import { makeJob } from '../helpers';

const MB = 1024 ** 2;

const file = (over: Partial<Job> = {}): Job => makeJob({ kind: 'file', quality: null, baseName: null, ...over });
const media = (over: Partial<Job> = {}): Job => makeJob(over);

/** Row 2 of the table, "#2": a file downloading 50/200 MB at 5 MB/s. */
const a = (): Job => file({ state: 'downloading', bytesDone: 50 * MB, bytesTotal: 200 * MB, speed: 5 * MB });

const IDLE: Summary = { speed: 0, active: 0, remaining: null, eta: null };
const exact = (n: number) => ({ bytes: n, approx: false });
const approx = (n: number) => ({ bytes: n, approx: true });
const eta = (seconds: number, isApprox: boolean) => ({ seconds, approx: isApprox });

/** The fields the plan states for a row; the others are not asserted. */
function named(result: Summary, expected: Partial<Summary>): Partial<Summary> {
  const out: Partial<Summary> = {};
  for (const key of Object.keys(expected) as Array<keyof Summary>) Object.assign(out, { [key]: result[key] });
  return out;
}

type Row = [label: string, jobs: Job[], expected: Partial<Summary>];

const ROWS: Row[] = [
  ['1 no jobs', [], IDLE],
  ['2 file downloading 50/200 MB at 5 MB/s', [a()], { speed: 5 * MB, active: 1, remaining: exact(150 * MB), eta: eta(30, false) }],
  ['3 #2 plus file queued 0/100 MB', [a(), file({ state: 'queued', bytesDone: 0, bytesTotal: 100 * MB })], { remaining: exact(250 * MB), eta: eta(30, false) }],
  [
    '4 #2 plus media downloading 10/40 MB at 1 MB/s',
    [a(), media({ state: 'downloading', bytesDone: 10 * MB, bytesTotal: 40 * MB, speed: 1 * MB })],
    { speed: 6 * MB, active: 2, remaining: approx(180 * MB), eta: eta(30, true) },
  ],
  ['5 file downloading 5 MB/null at 1 MB/s', [file({ state: 'downloading', bytesDone: 5 * MB, bytesTotal: null, speed: 1 * MB })], { speed: 1 * MB, active: 1, remaining: null, eta: null }],
  ['6 #2 plus file queued 0/null', [a(), file({ state: 'queued' })], { remaining: approx(150 * MB), eta: eta(30, false) }],
  ['7 #2 plus file paused 10/100 MB', [a(), file({ state: 'paused', bytesDone: 10 * MB, bytesTotal: 100 * MB })], { speed: 5 * MB, active: 1, remaining: exact(150 * MB), eta: eta(30, false) }],
  [
    '8 #2 plus media merging with speed 500 left over',
    [a(), media({ state: 'merging', speed: 500 })],
    { speed: 5 * MB, active: 2, remaining: exact(150 * MB), eta: eta(30, false) },
  ],
  [
    '9 done, failed, skipped only (with sizes and left-over speeds)',
    [
      file({ state: 'done', bytesDone: 100, bytesTotal: 100, speed: 700 }),
      file({ state: 'failed', bytesDone: 10, bytesTotal: 100, speed: 700 }),
      media({ state: 'skipped', bytesDone: 0, bytesTotal: 100, speed: 700 }),
    ],
    IDLE,
  ],
  [
    '10 #2 plus file downloading 5 MB/null at 1 MB/s',
    [a(), file({ state: 'downloading', bytesDone: 5 * MB, bytesTotal: null, speed: 1 * MB })],
    { speed: 6 * MB, active: 2, remaining: approx(150 * MB), eta: eta(25, true) },
  ],
  ['11 file downloading 50/200 MB at speed 0', [file({ state: 'downloading', bytesDone: 50 * MB, bytesTotal: 200 * MB, speed: 0 })], { speed: 0, active: 1, remaining: exact(150 * MB), eta: null }],
  ['12 media queued 0/null only', [media({ state: 'queued' })], IDLE],
  ['13 #2 plus media queued 0/null', [a(), media({ state: 'queued' })], { remaining: approx(150 * MB), eta: eta(30, false) }],
  ['14 #2 plus media probing 0/null', [a(), media({ state: 'probing' })], { active: 2, remaining: approx(150 * MB), eta: eta(30, false) }],
  ['15 file downloading 300/200 bytes at 5 B/s', [file({ state: 'downloading', bytesDone: 300, bytesTotal: 200, speed: 5 })], { remaining: exact(0), eta: eta(0, false) }],
  ['16 file downloading 5/0 bytes at 1 B/s', [file({ state: 'downloading', bytesDone: 5, bytesTotal: 0, speed: 1 })], { remaining: null, eta: null }],
  ['17 file downloading 0/10 bytes at 3 B/s', [file({ state: 'downloading', bytesDone: 0, bytesTotal: 10, speed: 3 })], { remaining: exact(10), eta: eta(4, false) }],
  ['18 media downloading 10/40 MB at 1 MB/s only', [media({ state: 'downloading', bytesDone: 10 * MB, bytesTotal: 40 * MB, speed: 1 * MB })], { remaining: approx(30 * MB), eta: eta(30, true) }],
  ['19 (+) media paused 10/40 MB only', [media({ state: 'paused', bytesDone: 10 * MB, bytesTotal: 40 * MB })], IDLE],
  ['20 (+) media downloading 10/40 MB at speed 0 only', [media({ state: 'downloading', bytesDone: 10 * MB, bytesTotal: 40 * MB, speed: 0 })], { speed: 0, active: 1, remaining: approx(30 * MB), eta: null }],
  ['21 (+) file probing 0/100 bytes with speed 700 left over', [file({ state: 'probing', bytesDone: 0, bytesTotal: 100, speed: 700 })], { speed: 0, active: 1, remaining: exact(100), eta: null }],
  [
    '22 (+) file queued 0/100 bytes, reason retrying (1/3), speed 700 left over',
    [file({ state: 'queued', reason: 'retrying (1/3)', bytesDone: 0, bytesTotal: 100, speed: 700 })],
    { speed: 0, active: 0, remaining: exact(100), eta: null },
  ],
  ['23 (+) file downloading 0/10 bytes at NaN (OD-2)', [file({ state: 'downloading', bytesDone: 0, bytesTotal: 10, speed: Number.NaN })], { speed: 0, active: 1, remaining: exact(10), eta: null }],
  ['24 (+) file downloading -5/10 bytes at 3 B/s (a finite negative count is not clamped; the difference is)', [file({ state: 'downloading', bytesDone: -5, bytesTotal: 10, speed: 3 })], { remaining: exact(15), eta: eta(5, false) }],
  ['26 (+) #2 plus file downloading 0/100 MB at speed -5 (OD-2)', [a(), file({ state: 'downloading', bytesDone: 0, bytesTotal: 100 * MB, speed: -5 })], { speed: 5 * MB, active: 2, remaining: exact(250 * MB), eta: eta(50, false) }],
  [
    '27 (+) #2 plus file downloading 0/100 MB at speed Infinity (OD-2)',
    [a(), file({ state: 'downloading', bytesDone: 0, bytesTotal: 100 * MB, speed: Number.POSITIVE_INFINITY })],
    { speed: 5 * MB, active: 2, remaining: exact(250 * MB), eta: eta(50, false) },
  ],
  [
    '28 (+) #2 plus file downloading NaN/100 MB at 1 MB/s (OD-2)',
    [a(), file({ state: 'downloading', bytesDone: Number.NaN, bytesTotal: 100 * MB, speed: 1 * MB })],
    { speed: 6 * MB, active: 2, remaining: approx(150 * MB), eta: eta(25, true) },
  ],
  ['29 (+) file downloading 50/Infinity bytes at 1 B/s only (OD-2)', [file({ state: 'downloading', bytesDone: 50, bytesTotal: Number.POSITIVE_INFINITY, speed: 1 })], { speed: 1, active: 1, remaining: null, eta: null }],
];

describe('the plan table (5.3)', () => {
  it.each(ROWS)('%s', (_label, jobs, expected) => {
    expect(named(summary(jobs), expected)).toEqual(expected);
  });

  it('rows 1, 2 and 12 give the whole object (every field is stated)', () => {
    expect(summary([])).toEqual(IDLE);
    expect(summary([a()])).toEqual({ speed: 5 * MB, active: 1, remaining: exact(150 * MB), eta: eta(30, false) });
    expect(summary([media({ state: 'queued' })])).toEqual(IDLE);
  });

  it('row 25 (+): the same object listed twice counts twice (speed 10 MB/s, active 2, remaining 300 MB, eta 30 s)', () => {
    const one = a();
    expect(summary([one, one])).toEqual({ speed: 10 * MB, active: 2, remaining: exact(300 * MB), eta: eta(30, false) });
  });

  it('summary does not change the list or its jobs, and a second call gives the same answer', () => {
    const jobs = [a(), file({ state: 'queued', bytesDone: 0, bytesTotal: 100 * MB }), media({ state: 'merging', speed: 500 })];
    const before = structuredClone(jobs);
    const first = summary(jobs);
    expect(jobs).toEqual(before);
    expect(summary(jobs)).toEqual(first);
  });
});

describe('every state, one job each (derived)', () => {
  const sized = (state: JobState): Job => file({ state, bytesDone: 0, bytesTotal: 100, speed: 700 });

  it.each<[JobState, number]>([
    ['queued', 0],
    ['probing', 1],
    ['downloading', 1],
    ['paused', 0],
    ['merging', 1],
    ['done', 0],
    ['failed', 0],
    ['skipped', 0],
  ])('active: %s counts %i', (state, active) => {
    expect(summary([sized(state)]).active).toBe(active);
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
  ])('speed: %s adds %i', (state, speed) => {
    expect(summary([sized(state)]).speed).toBe(speed);
  });

  it.each<[JobState, Summary['remaining']]>([
    ['queued', exact(100)],
    ['probing', exact(100)],
    ['downloading', exact(100)],
    ['paused', null],
    ['merging', null],
    ['done', null],
    ['failed', null],
    ['skipped', null],
  ])('remaining: %s gives %j', (state, remaining) => {
    expect(summary([sized(state)]).remaining).toEqual(remaining);
  });

  it.each<[JobState, Summary['remaining']]>([
    ['queued', approx(100)],
    ['probing', approx(100)],
    ['downloading', approx(100)],
    ['paused', null],
    ['merging', null],
    ['done', null],
    ['failed', null],
    ['skipped', null],
  ])('remaining of a media job: %s gives %j (a counted media job is approximate)', (state, remaining) => {
    expect(summary([media({ state, bytesDone: 0, bytesTotal: 100, speed: 700 })]).remaining).toEqual(remaining);
  });

  it.each<[JobState, Summary['eta']]>([
    ['queued', null],
    ['probing', null],
    ['downloading', eta(1, false)],
    ['paused', null],
    ['merging', null],
    ['done', null],
    ['failed', null],
    ['skipped', null],
  ])('eta: a file in %s alone, with speed 700 and 100 bytes left, gives %j', (state, expected) => {
    // Only a downloading job has a counted speed and a place in the eta; the others leave it null.
    // 100 / 700 rounds up to 1 second.
    expect(summary([sized(state)]).eta).toEqual(expected);
  });

  it('eta looks at downloading jobs only: queued and paused sizes do not lengthen it', () => {
    const jobs = [a(), file({ state: 'queued', bytesDone: 0, bytesTotal: 1000 * MB }), file({ state: 'paused', bytesDone: 0, bytesTotal: 1000 * MB })];
    expect(summary(jobs).eta).toEqual(eta(30, false));
    expect(summary(jobs).remaining).toEqual(exact(1150 * MB));
  });
});

describe('the known-size rule and its boundaries (derived)', () => {
  const dl = (bytesDone: number, bytesTotal: number | null, speed = 1 * MB): Job => file({ state: 'downloading', bytesDone, bytesTotal, speed });

  it.each([
    ['null', null],
    ['0', 0],
    ['-1', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('bytesTotal %s is not a size: no remaining, no eta, and the job is "unknown" for approx', (_label, bytesTotal) => {
    expect(named(summary([dl(5, bytesTotal)]), { remaining: null, eta: null })).toEqual({ remaining: null, eta: null });
    // Next to a sized job it makes the answer approximate and adds nothing.
    const result = summary([a(), dl(5, bytesTotal)]);
    expect(result.remaining).toEqual(approx(150 * MB));
    expect(result.eta).toEqual(eta(25, true));
  });

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('bytesDone %s with a good total is not a size either (OD-2)', (_label, bytesDone) => {
    expect(named(summary([dl(bytesDone, 200)]), { remaining: null, eta: null })).toEqual({ remaining: null, eta: null });
  });

  it('the smallest size is a size: bytesTotal 1', () => {
    expect(summary([dl(0, 1, 1)])).toEqual({ speed: 1, active: 1, remaining: exact(1), eta: eta(1, false) });
  });

  it('a count that is finished or beyond gives remaining 0, never negative', () => {
    expect(summary([dl(200, 200)]).remaining).toEqual(exact(0));
    expect(summary([dl(201, 200)]).remaining).toEqual(exact(0));
    expect(summary([dl(201, 200)]).eta).toEqual(eta(0, false));
  });

  it('eta is rounded up to a whole second', () => {
    expect(summary([dl(0, 10, 3)]).eta).toEqual(eta(4, false));
    expect(summary([dl(0, 9, 3)]).eta).toEqual(eta(3, false));
    expect(summary([dl(0, 1, 1e9)]).eta).toEqual(eta(1, false));
    expect(summary([dl(0, 7, 2)]).eta).toEqual(eta(4, false));
  });

  it('a speed that is 0, negative, NaN or infinite adds 0 and leaves eta null when it is all there is (OD-2)', () => {
    for (const speed of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = summary([dl(0, 100, speed)]);
      expect(result.speed).toBe(0);
      expect(result.active).toBe(1);
      expect(result.remaining).toEqual(exact(100));
      expect(result.eta).toBeNull();
    }
  });

  it('a speed of 0 is the boundary of "above 0": a tiny positive speed gives an eta', () => {
    expect(summary([dl(0, 100, 1e-9)]).eta).not.toBeNull();
    expect(summary([dl(0, 100, 0)]).eta).toBeNull();
    expect(summary([dl(0, 100, -0)]).eta).toBeNull();
  });

  it('speed and eta are never NaN or negative, whatever the speeds', () => {
    const speeds = [0, 1, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e300];
    for (const s1 of speeds) {
      for (const s2 of speeds) {
        const result = summary([dl(0, 100, s1), dl(0, 50, s2)]);
        expect(Number.isFinite(result.speed)).toBe(true);
        expect(result.speed).toBeGreaterThanOrEqual(0);
        if (result.eta !== null) {
          expect(Number.isFinite(result.eta.seconds)).toBe(true);
          expect(result.eta.seconds).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('approx (derived)', () => {
  it('remaining is approximate when a counted job is media, even with a size', () => {
    expect(summary([a(), media({ state: 'queued', bytesDone: 0, bytesTotal: 100 * MB })]).remaining).toEqual(approx(250 * MB));
    expect(summary([a(), media({ state: 'probing', bytesDone: 0, bytesTotal: 100 * MB })]).remaining).toEqual(approx(250 * MB));
  });

  it('eta is not made approximate by a queued media job: only downloading jobs count for it', () => {
    expect(summary([a(), media({ state: 'queued', bytesDone: 0, bytesTotal: 100 * MB })]).eta).toEqual(eta(30, false));
    expect(summary([a(), media({ state: 'probing', bytesDone: 0, bytesTotal: 100 * MB })]).eta).toEqual(eta(30, false));
  });

  it('a downloading media job makes both approximate; a media job in another state makes neither', () => {
    const withMedia = (state: JobState): Summary => summary([a(), media({ state, bytesDone: 10 * MB, bytesTotal: 40 * MB, speed: 1 * MB })]);
    expect(withMedia('downloading').remaining?.approx).toBe(true);
    expect(withMedia('downloading').eta?.approx).toBe(true);
    for (const state of ['paused', 'merging', 'done', 'failed', 'skipped'] as const) {
      expect(withMedia(state).remaining).toEqual(exact(150 * MB));
      expect(withMedia(state).eta).toEqual(eta(30, false));
    }
  });

  it('a counted job with no size makes remaining approximate; with no downloading job without a size, eta stays exact', () => {
    expect(summary([a(), file({ state: 'queued', bytesDone: 0, bytesTotal: null })]).remaining).toEqual(approx(150 * MB));
    expect(summary([a(), file({ state: 'queued', bytesDone: 0, bytesTotal: null })]).eta).toEqual(eta(30, false));
  });

  it('with no downloading job that has a size, eta is null even when queued jobs have sizes', () => {
    const jobs = [file({ state: 'downloading', bytesDone: 5, bytesTotal: null, speed: 1 }), file({ state: 'queued', bytesDone: 0, bytesTotal: 100 })];
    expect(summary(jobs)).toEqual({ speed: 1, active: 1, remaining: approx(100), eta: null });
  });
});
