// C2 section 5.7: finishedEvents (src/renderer/src/model/finished.ts).
// (+) = a row the plan adds. "derived" = not a table row: it enumerates a rule (every state) or a stated promise.
// A job is written [id, state, groupId]: L = a lone job, M = a playlist member. A snapshot is built from the specs,
// so the same id in `prev` and `next` is the same job (the objects differ, as they do after an IPC push).
import { describe, expect, it } from 'vitest';
import { finishedEvents, type FinishedEvent } from '../../src/renderer/src/model/finished';
import type { Group, Job, JobState, Snapshot } from '../../src/shared/types';
import { makeJob } from '../helpers';

const G1: Group = { id: 'g1', title: 'Course', url: 'https://example.com/list', dir: 'D:\\Dl\\Course', createdAt: 1 };
const G2: Group = { id: 'g2', title: 'Other course', url: 'https://example.com/list2', dir: 'D:\\Dl\\Other', createdAt: 2 };

const STATES: JobState[] = ['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped'];
const UNFINISHED: JobState[] = ['queued', 'probing', 'downloading', 'paused', 'merging'];

type Spec = [id: string, state: JobState, groupId: string | null];
const L = (id: string, state: JobState): Spec => [id, state, null];
const M = (id: string, state: JobState, group = 'g1'): Spec => [id, state, group];

const jobsOf = (specs: Spec[]): Job[] => specs.map(([id, state, groupId]) => makeJob({ id, state, groupId }));
const snap = (specs: Spec[], groups: Group[] = [G1, G2]): Snapshot => ({ jobs: jobsOf(specs), groups });

type Expect = { job: string } | { group: Group; done: number; failed: number; skipped: number };

/** The events a case expects, with the job objects taken from `next` (the plan: "job is the object from next"). */
function eventsFor(next: Snapshot, expected: Expect[]): FinishedEvent[] {
  return expected.map((e): FinishedEvent => {
    if ('job' in e) return { kind: 'job', job: next.jobs.find((j) => j.id === e.job) as Job };
    return { kind: 'group', group: e.group, done: e.done, failed: e.failed, skipped: e.skipped };
  });
}

const group = (g: Group, done: number, failed: number, skipped: number): Expect => ({ group: g, done, failed, skipped });
const job = (id: string): Expect => ({ job: id });

interface Case {
  name: string;
  prev: Spec[];
  next: Spec[];
  groups?: Group[];
  out: Expect[];
}

const CASES: Case[] = [
  // The architecture's rows.
  { name: 'prev empty, next has A done', prev: [], next: [L('A', 'done')], out: [] },
  { name: 'lone A downloading -> done', prev: [L('A', 'downloading')], next: [L('A', 'done')], out: [job('A')] },
  { name: 'A merging -> done', prev: [L('A', 'merging')], next: [L('A', 'done')], out: [job('A')] },
  { name: 'A probing -> done', prev: [L('A', 'probing')], next: [L('A', 'done')], out: [job('A')] },
  { name: 'A queued -> done', prev: [L('A', 'queued')], next: [L('A', 'done')], out: [job('A')] },
  { name: 'A failed -> done (a retry between two snapshots)', prev: [L('A', 'failed')], next: [L('A', 'done')], out: [job('A')] },
  { name: 'A absent in prev, done in next', prev: [L('B', 'queued')], next: [L('B', 'queued'), L('A', 'done')], out: [] },
  { name: 'A done -> done', prev: [L('A', 'done')], next: [L('A', 'done')], out: [] },
  { name: 'A downloading -> failed', prev: [L('A', 'downloading')], next: [L('A', 'failed')], out: [] },
  { name: 'A downloading -> skipped', prev: [L('A', 'downloading')], next: [L('A', 'skipped')], out: [] },
  {
    name: 'lone A and lone B both -> done in one step: in next.jobs order',
    prev: [L('A', 'downloading'), L('B', 'downloading')],
    next: [L('A', 'done'), L('B', 'done')],
    out: [job('A'), job('B')],
  },
  {
    name: 'a member done while another member is still queued',
    prev: [M('m1', 'queued'), M('m2', 'queued')],
    next: [M('m1', 'done'), M('m2', 'queued')],
    out: [],
  },
  {
    name: 'last unfinished member -> done: [done, queued] -> [done, done]: one group event, no job event',
    prev: [M('m1', 'done'), M('m2', 'queued')],
    next: [M('m1', 'done'), M('m2', 'done')],
    out: [group(G1, 2, 0, 0)],
  },
  {
    name: 'last unfinished member -> failed, another done: [done, queued] -> [done, failed]',
    prev: [M('m1', 'done'), M('m2', 'queued')],
    next: [M('m1', 'done'), M('m2', 'failed')],
    out: [group(G1, 1, 1, 0)],
  },
  {
    name: 'last unfinished member -> skipped, another done: [done, queued] -> [done, skipped]',
    prev: [M('m1', 'done'), M('m2', 'queued')],
    next: [M('m1', 'done'), M('m2', 'skipped')],
    out: [group(G1, 1, 0, 1)],
  },
  { name: 'last unfinished -> failed, the rest failed: no done member', prev: [M('m1', 'failed'), M('m2', 'queued')], next: [M('m1', 'failed'), M('m2', 'failed')], out: [] },
  { name: 'last unfinished -> failed, the rest skipped: no done member', prev: [M('m1', 'skipped'), M('m2', 'queued')], next: [M('m1', 'skipped'), M('m2', 'failed')], out: [] },
  { name: 'last unfinished -> skipped, the rest failed: no done member', prev: [M('m1', 'failed'), M('m2', 'queued')], next: [M('m1', 'failed'), M('m2', 'skipped')], out: [] },
  { name: 'every member skipped (one was queued)', prev: [M('m1', 'skipped'), M('m2', 'queued')], next: [M('m1', 'skipped'), M('m2', 'skipped')], out: [] },
  { name: 'every member skipped, unchanged', prev: [M('m1', 'skipped'), M('m2', 'skipped')], next: [M('m1', 'skipped'), M('m2', 'skipped')], out: [] },
  {
    name: 'last unfinished member removed (cancel), another done: [done, queued] -> [done]',
    prev: [M('m1', 'done'), M('m2', 'queued')],
    next: [M('m1', 'done')],
    out: [group(G1, 1, 0, 0)],
  },
  { name: 'last unfinished member removed, only failed members left', prev: [M('m1', 'failed'), M('m2', 'queued')], next: [M('m1', 'failed')], out: [] },
  { name: 'last member removed, the playlist gone from next', prev: [M('m1', 'queued')], next: [], groups: [], out: [] },
  {
    name: 'all finished in prev (done 1, failed 1); the failed one is done in next',
    prev: [M('m1', 'done'), M('m2', 'failed')],
    next: [M('m1', 'done'), M('m2', 'done')],
    out: [group(G1, 2, 0, 0)],
  },
  { name: 'all finished in both, a done member removed', prev: [M('m1', 'done'), M('m2', 'done')], next: [M('m1', 'done')], out: [] },
  { name: 'playlist absent in prev, complete in next', prev: [L('X', 'queued')], next: [L('X', 'queued'), M('m1', 'done'), M('m2', 'done')], out: [] },

  // (+) rows.
  { name: '(+) lone A paused -> done', prev: [L('A', 'paused')], next: [L('A', 'done')], out: [job('A')] },
  {
    name: '(+) next.jobs = [lone A, member m1, lone B, member m2]: job A, group g1, job B',
    prev: [L('A', 'downloading'), M('m1', 'done'), L('B', 'downloading'), M('m2', 'queued')],
    next: [L('A', 'done'), M('m1', 'done'), L('B', 'done'), M('m2', 'done')],
    out: [job('A'), group(G1, 2, 0, 0), job('B')],
  },
  {
    name: '(+) next.jobs = [m1 (g1), n1 (g2), m2 (g1), n2 (g2)]: group g1, then group g2 (a playlist at its first member)',
    prev: [M('m1', 'done', 'g1'), M('n1', 'done', 'g2'), M('m2', 'queued', 'g1'), M('n2', 'queued', 'g2')],
    next: [M('m1', 'done', 'g1'), M('n1', 'done', 'g2'), M('m2', 'done', 'g1'), M('n2', 'done', 'g2')],
    out: [group(G1, 2, 0, 0), group(G2, 2, 0, 0)],
  },
  {
    name: '(+) the same two playlists with g2 first in next.jobs: group g2, then group g1',
    prev: [M('n1', 'done', 'g2'), M('m1', 'done', 'g1'), M('n2', 'queued', 'g2'), M('m2', 'queued', 'g1')],
    next: [M('n1', 'done', 'g2'), M('m1', 'done', 'g1'), M('n2', 'done', 'g2'), M('m2', 'done', 'g1')],
    out: [group(G2, 2, 0, 0), group(G1, 2, 0, 0)],
  },
  {
    name: '(+) members [done, queued] -> [done, done] but next.groups is []',
    prev: [M('m1', 'done'), M('m2', 'queued')],
    next: [M('m1', 'done'), M('m2', 'done')],
    groups: [],
    out: [],
  },
  { name: '(+) a playlist of one member, queued -> done', prev: [M('m1', 'queued')], next: [M('m1', 'done')], out: [group(G1, 1, 0, 0)] },
  {
    name: '(+) members [done, skipped, queued] -> [done, skipped, done]',
    prev: [M('m1', 'done'), M('m2', 'skipped'), M('m3', 'queued')],
    next: [M('m1', 'done'), M('m2', 'skipped'), M('m3', 'done')],
    out: [group(G1, 2, 0, 1)],
  },
  { name: '(+) members [done, queued] -> [done, paused]', prev: [M('m1', 'done'), M('m2', 'queued')], next: [M('m1', 'done'), M('m2', 'paused')], out: [] },
  { name: '(+) all finished in both, unchanged (done 1, failed 1)', prev: [M('m1', 'done'), M('m2', 'failed')], next: [M('m1', 'done'), M('m2', 'failed')], out: [] },
  { name: '(+) prev equals next: nothing happened', prev: [L('A', 'done'), M('m1', 'done'), M('m2', 'done')], next: [L('A', 'done'), M('m1', 'done'), M('m2', 'done')], out: [] },

  // Derived: stated field rules.
  { name: 'derived: a job whose groupId names a playlist missing from next.groups gives no event (downloading -> done)', prev: [M('m1', 'downloading', 'gX')], next: [M('m1', 'done', 'gX')], out: [] },
  {
    name: 'derived: more done members in next than in prev, with every member finished in prev (a member joined already done)',
    prev: [M('m1', 'done')],
    next: [M('m1', 'done'), M('m2', 'done')],
    out: [group(G1, 2, 0, 0)],
  },
  { name: 'derived: fewer done members in next than in prev, all finished', prev: [M('m1', 'done'), M('m2', 'done'), M('m3', 'failed')], next: [M('m1', 'done'), M('m3', 'failed')], out: [] },
  {
    name: 'derived: two members change in one step, one done and one failed',
    prev: [M('m1', 'queued'), M('m2', 'queued')],
    next: [M('m1', 'done'), M('m2', 'failed')],
    out: [group(G1, 1, 1, 0)],
  },
  {
    name: 'derived: a finished playlist next to a lone job that did not change',
    prev: [L('A', 'done'), M('m1', 'done'), M('m2', 'downloading')],
    next: [L('A', 'done'), M('m1', 'done'), M('m2', 'done')],
    out: [group(G1, 2, 0, 0)],
  },
  {
    name: 'derived: a playlist that finishes while another one is still running',
    prev: [M('m1', 'done', 'g1'), M('m2', 'queued', 'g1'), M('n1', 'done', 'g2'), M('n2', 'queued', 'g2')],
    next: [M('m1', 'done', 'g1'), M('m2', 'done', 'g1'), M('n1', 'done', 'g2'), M('n2', 'queued', 'g2')],
    out: [group(G1, 2, 0, 0)],
  },
  {
    name: 'derived: prev.groups lists the playlist but prev.jobs holds none of its members: no event',
    prev: [L('X', 'queued')],
    next: [L('X', 'queued'), M('m1', 'done'), M('m2', 'done')],
    out: [],
  },
];

describe('the plan table (5.7)', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const prev = snap(c.prev);
    const next = snap(c.next, c.groups);
    const prevBefore = structuredClone(prev);
    const nextBefore = structuredClone(next);
    expect(finishedEvents(prev, next)).toEqual(eventsFor(next, c.out));
    // (+) prev and next are not changed.
    expect(prev).toEqual(prevBefore);
    expect(next).toEqual(nextBefore);
  });

  it('(+) prev equals next, as one snapshot and as a clone: no event, even with a complete playlist', () => {
    const s = snap([L('A', 'done'), M('m1', 'done'), M('m2', 'done'), M('m3', 'failed')]);
    expect(finishedEvents(s, s)).toEqual([]);
    expect(finishedEvents(s, structuredClone(s))).toEqual([]);
  });

  it('two empty snapshots give no event', () => {
    expect(finishedEvents({ jobs: [], groups: [] }, { jobs: [], groups: [] })).toEqual([]);
  });

  it('the starting prev (empty) with a running list in next gives no event', () => {
    expect(finishedEvents({ jobs: [], groups: [] }, snap([L('A', 'downloading'), M('m1', 'done'), M('m2', 'queued')]))).toEqual([]);
  });

  it('lone A and lone B both done: the order is next.jobs, not prev.jobs', () => {
    const prev = snap([L('A', 'downloading'), L('B', 'downloading')]);
    const next = snap([L('B', 'done'), L('A', 'done')]);
    expect(finishedEvents(prev, next)).toEqual(eventsFor(next, [job('B'), job('A')]));
  });
});

describe('identity and shape of the events', () => {
  it('(+) a job event holds next\'s object (toBe), in state done', () => {
    const prev = snap([L('A', 'downloading')]);
    const next = snap([L('A', 'done')]);
    const events = finishedEvents(prev, next);
    expect(events).toHaveLength(1);
    const first = events[0] as FinishedEvent;
    expect(first.kind).toBe('job');
    if (first.kind === 'job') {
      expect(first.job).toBe(next.jobs[0]);
      expect(first.job.state).toBe('done');
    }
  });

  it('(+) a group event holds next.groups[0] (toBe)', () => {
    const prev = snap([M('m1', 'done'), M('m2', 'queued')]);
    const next = snap([M('m1', 'done'), M('m2', 'done')]);
    const events = finishedEvents(prev, next);
    expect(events).toHaveLength(1);
    const first = events[0] as FinishedEvent;
    expect(first.kind).toBe('group');
    if (first.kind === 'group') expect(first.group).toBe(next.groups[0]);
  });

  it('derived: a job event has exactly kind and job; a group event has exactly kind, group, done, failed, skipped', () => {
    const prev = snap([L('A', 'downloading'), M('m1', 'done'), M('m2', 'queued')]);
    const next = snap([L('A', 'done'), M('m1', 'done'), M('m2', 'failed')]);
    const [jobEvent, groupEvent] = finishedEvents(prev, next);
    expect(Object.keys(jobEvent as object).sort()).toEqual(['job', 'kind']);
    expect(Object.keys(groupEvent as object).sort()).toEqual(['done', 'failed', 'group', 'kind', 'skipped']);
  });

  it('derived: a playlist member never gives a job event, whatever its state change', () => {
    for (const from of STATES) {
      for (const to of STATES) {
        const events = finishedEvents(snap([M('m1', from), M('m2', 'queued')]), snap([M('m1', to), M('m2', 'queued')]));
        expect(events.filter((e) => e.kind === 'job')).toEqual([]);
        expect(events).toEqual([]); // m2 stays queued, so the playlist is never complete either
      }
    }
  });
});

describe('lone jobs, every state (derived)', () => {
  it.each(STATES.filter((s) => s !== 'done'))('%s -> done gives one job event', (from) => {
    const next = snap([L('A', 'done')]);
    expect(finishedEvents(snap([L('A', from)]), next)).toEqual(eventsFor(next, [job('A')]));
  });

  it.each(STATES.filter((s) => s !== 'done'))('downloading -> %s gives no event (only done counts)', (to) => {
    expect(finishedEvents(snap([L('A', 'downloading')]), snap([L('A', to)]))).toEqual([]);
  });

  it.each(STATES.filter((s) => s !== 'done'))('queued -> %s gives no event', (to) => {
    expect(finishedEvents(snap([L('A', 'queued')]), snap([L('A', to)]))).toEqual([]);
  });
});

describe('playlists, every state (derived)', () => {
  it.each(UNFINISHED)('a member that was %s in prev, finishing as done with the other member done: one group event', (from) => {
    const next = snap([M('m1', 'done'), M('m2', 'done')]);
    expect(finishedEvents(snap([M('m1', 'done'), M('m2', from)]), next)).toEqual(eventsFor(next, [group(G1, 2, 0, 0)]));
  });

  it.each(UNFINISHED)('a member that was %s in prev and ends failed or skipped next to a done member: one group event, though the done count did not grow', (from) => {
    const failed = snap([M('m1', 'done'), M('m2', 'failed')]);
    expect(finishedEvents(snap([M('m1', 'done'), M('m2', from)]), failed)).toEqual(eventsFor(failed, [group(G1, 1, 1, 0)]));
    const skipped = snap([M('m1', 'done'), M('m2', 'skipped')]);
    expect(finishedEvents(snap([M('m1', 'done'), M('m2', from)]), skipped)).toEqual(eventsFor(skipped, [group(G1, 1, 0, 1)]));
    // The unfinished member may also come first in jobs order.
    const first = snap([M('m1', 'failed'), M('m2', 'done')]);
    expect(finishedEvents(snap([M('m1', from), M('m2', 'done')]), first)).toEqual(eventsFor(first, [group(G1, 1, 1, 0)]));
  });

  it.each(UNFINISHED)('a member that is still %s in next: no event, even if the other member just finished', (still) => {
    expect(finishedEvents(snap([M('m1', 'queued'), M('m2', still)]), snap([M('m1', 'done'), M('m2', still)]))).toEqual([]);
    expect(finishedEvents(snap([M('m1', 'done'), M('m2', 'queued')]), snap([M('m1', 'done'), M('m2', still)]))).toEqual([]);
  });

  it.each(['done', 'failed', 'skipped'] as const)('the last member ends as %s next to a done member: the counts follow next', (end) => {
    const next = snap([M('m1', 'done'), M('m2', end)]);
    const counts = { done: end === 'done' ? 2 : 1, failed: end === 'failed' ? 1 : 0, skipped: end === 'skipped' ? 1 : 0 };
    expect(finishedEvents(snap([M('m1', 'done'), M('m2', 'queued')]), next)).toEqual(eventsFor(next, [group(G1, counts.done, counts.failed, counts.skipped)]));
  });

  it('counts every member of next: three done, two failed, one skipped', () => {
    const prev = snap([M('m1', 'done'), M('m2', 'done'), M('m3', 'done'), M('m4', 'failed'), M('m5', 'queued'), M('m6', 'queued')]);
    const next = snap([M('m1', 'done'), M('m2', 'done'), M('m3', 'done'), M('m4', 'failed'), M('m5', 'failed'), M('m6', 'skipped')]);
    expect(finishedEvents(prev, next)).toEqual(eventsFor(next, [group(G1, 3, 2, 1)]));
  });
});

describe('ids and groups that main never sends (Q10)', () => {
  it('(+) a job whose groupId names a playlist missing from next.groups gives no event of either kind', () => {
    const prev = snap([M('m1', 'queued', 'gX'), M('m2', 'queued', 'gX')]);
    const next = snap([M('m1', 'done', 'gX'), M('m2', 'done', 'gX')]);
    expect(finishedEvents(prev, next)).toEqual([]);
  });

  it('(+) prev.jobs lists A twice (downloading, then done); next has A done: job A (the first occurrence counts)', () => {
    const prev: Snapshot = { jobs: [makeJob({ id: 'A', state: 'downloading' }), makeJob({ id: 'A', state: 'done' })], groups: [] };
    const next = snap([L('A', 'done')]);
    expect(finishedEvents(prev, next)).toEqual(eventsFor(next, [job('A')]));
  });

  it('derived: prev.jobs lists A twice (done, then downloading): the first occurrence is done, so no event', () => {
    const prev: Snapshot = { jobs: [makeJob({ id: 'A', state: 'done' }), makeJob({ id: 'A', state: 'downloading' })], groups: [] };
    expect(finishedEvents(prev, snap([L('A', 'done')]))).toEqual([]);
  });

  it('(+) next.jobs lists lone A twice, done; prev has A downloading: one job event, the first object', () => {
    const prev = snap([L('A', 'downloading')]);
    const first = makeJob({ id: 'A', state: 'done' });
    const second = makeJob({ id: 'A', state: 'done' });
    const events = finishedEvents(prev, { jobs: [first, second], groups: [] });
    expect(events).toHaveLength(1);
    const only = events[0] as FinishedEvent;
    expect(only.kind).toBe('job');
    if (only.kind === 'job') expect(only.job).toBe(first);
  });

  it('derived: next.jobs lists lone A twice, the first not done: only the first occurrence can give an event', () => {
    const prev = snap([L('A', 'downloading')]);
    const next: Snapshot = { jobs: [makeJob({ id: 'A', state: 'downloading' }), makeJob({ id: 'A', state: 'done' })], groups: [] };
    expect(finishedEvents(prev, next)).toEqual([]);
  });

  it('derived: next.groups lists a playlist id twice: one event, with the first entry', () => {
    const prev = snap([M('m1', 'done'), M('m2', 'queued')]);
    const duplicate: Group = { ...G1, title: 'Duplicate entry' };
    const next: Snapshot = { jobs: jobsOf([M('m1', 'done'), M('m2', 'done')]), groups: [G1, duplicate] };
    const events = finishedEvents(prev, next);
    expect(events).toHaveLength(1);
    const only = events[0] as FinishedEvent;
    expect(only.kind).toBe('group');
    if (only.kind === 'group') expect(only.group).toBe(G1);
  });
});

describe('prev.groups is not read (+)', () => {
  it('prev.groups is [] but prev.jobs holds the members: [done, queued] -> [done, done] gives the group event', () => {
    const prev: Snapshot = { jobs: jobsOf([M('m1', 'done'), M('m2', 'queued')]), groups: [] };
    const next = snap([M('m1', 'done'), M('m2', 'done')]);
    expect(finishedEvents(prev, next)).toEqual(eventsFor(next, [group(G1, 2, 0, 0)]));
  });

  it('prev.groups lists the playlist but prev.jobs has no member of it: the playlist had no member in prev, so no event', () => {
    const prev: Snapshot = { jobs: jobsOf([L('X', 'queued')]), groups: [G1] };
    const next = snap([L('X', 'queued'), M('m1', 'done'), M('m2', 'done')]);
    expect(finishedEvents(prev, next)).toEqual([]);
  });
});

describe('one pass over each list (derived from the plan\'s cost rule)', () => {
  /** Counts every property read on the jobs it wraps. */
  function counting(jobs: Job[], counter: { reads: number }): Job[] {
    return jobs.map(
      (j) =>
        new Proxy(j, {
          get(target, prop, receiver) {
            counter.reads += 1;
            return Reflect.get(target, prop, receiver);
          },
        }),
    );
  }

  it('reads each job a bounded number of times: 1500 jobs, 100 playlists, no per-job or per-playlist scan of the other list', () => {
    const LONE = 500;
    const GROUPS = 100;
    const PER_GROUP = 10;
    const groups: Group[] = Array.from({ length: GROUPS }, (_v, g) => ({ ...G1, id: `g${g}`, title: `Course ${g}` }));
    const build = (loneState: JobState, memberState: JobState): Job[] => [
      ...Array.from({ length: LONE }, (_v, i) => makeJob({ id: `lone-${i}`, state: loneState })),
      ...groups.flatMap((g, gi) => Array.from({ length: PER_GROUP }, (_w, m) => makeJob({ id: `m-${gi}-${m}`, groupId: g.id, state: memberState }))),
    ];
    const counter = { reads: 0 };
    const prev: Snapshot = { jobs: counting(build('downloading', 'queued'), counter), groups: [] };
    const next: Snapshot = { jobs: counting(build('done', 'done'), counter), groups };

    const events = finishedEvents(prev, next);

    expect(events.filter((e) => e.kind === 'job')).toHaveLength(LONE);
    expect(events.filter((e) => e.kind === 'group')).toHaveLength(GROUPS);
    const jobCount = 2 * (LONE + GROUPS * PER_GROUP);
    // A one-pass implementation reads a handful of fields per job per list. A scan of one list for every job,
    // or of the jobs for every playlist, reads on the order of 100 times the jobs, far above this bound.
    expect(counter.reads).toBeLessThanOrEqual(20 * jobCount);
  });
});
