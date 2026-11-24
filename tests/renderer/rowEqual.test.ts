// C2 section 5.10: sameRow (src/renderer/src/model/rowEqual.ts).
// sameRow(a, b, liveA, liveB) is true when a equals b and liveA equals liveB by the plan's value comparison:
// Object.is-equal values are equal; arrays by length and elements; non-array objects over the union of their own
// enumerable keys (a key one side lacks reads as undefined); anything else is not equal.
// (+) = a row the plan adds. "derived" = not a table row: it enumerates a rule or states a boundary of the comparison.
// Every pair below is built from ONE job (makeJob gives each call a new id and createdAt), so only the stated field differs.
import { describe, expect, it } from 'vitest';
import { sameRow } from '../../src/renderer/src/model/rowEqual';
import type { Job, JobLive } from '../../src/shared/types';
import { makeJob, makeLive } from '../helpers';

/** The value each field of makeJob() is changed to: the plan's table. `createdAt` is `value + 1`. */
const CHANGED: Record<string, (current: unknown) => unknown> = {
  id: () => 'other',
  groupId: () => 'g1',
  kind: () => 'file',
  url: () => 'https://example.com/other',
  title: () => 'Other',
  state: () => 'paused',
  reason: () => 'disk full',
  quality: () => ({ kind: 'audio', format: 'mp3' }),
  subtitleLangs: () => ['en'],
  dir: () => 'D:\\Other',
  baseName: () => 'Other',
  fileName: () => 'a.mp4',
  index: () => 3,
  bytesDone: () => 1,
  bytesTotal: () => 10,
  speed: () => 1,
  eta: () => 5,
  actualHeight: () => 720,
  resumable: () => false,
  attempts: () => 1,
  createdAt: (value) => (value as number) + 1,
  interrupted: () => true,
  sourceHeight: () => 1080,
};

/** The three JobLive fields, written out, each with a value that differs from makeLive()'s null. */
const LIVE_CHANGED: Record<keyof JobLive, unknown> = {
  stream: 'video',
  segments: [1, 0],
  connections: 8,
};

/** One job to derive every pair from. */
const BASE: Job = makeJob();
/** A job equal to BASE except for `over`. */
const v = (over: Record<string, unknown>): Job => ({ ...BASE, ...over }) as Job;

/** Both argument orders, because a comparison that is only true one way round would leave a stale row. */
function expectSame(a: Job, b: Job, liveA?: JobLive, liveB?: JobLive): void {
  expect(sameRow(a, b, liveA, liveB)).toBe(true);
  expect(sameRow(b, a, liveB, liveA)).toBe(true);
}
function expectDifferent(a: Job, b: Job, liveA?: JobLive, liveB?: JobLive): void {
  expect(sameRow(a, b, liveA, liveB)).toBe(false);
  expect(sameRow(b, a, liveB, liveA)).toBe(false);
}

describe('sameRow: equal', () => {
  it('a job, a clone of it, an entry and a clone of it: true', () => {
    const job = makeJob({ quality: { kind: 'max', height: 720 }, subtitleLangs: ['en', 'ar'] });
    const entry = makeLive({ stream: 'video', segments: [1, 0.5], connections: 4 });
    expect(sameRow(job, structuredClone(job), entry, structuredClone(entry))).toBe(true);
    expectSame(job, structuredClone(job), entry, structuredClone(entry));
  });

  it('the same job twice, with no live entry: true', () => {
    const job = makeJob();
    expect(sameRow(job, job, undefined, undefined)).toBe(true);
  });

  it('a job and a clone, with no live entry on either side: true', () => {
    const job = makeJob({ state: 'downloading', bytesDone: 5, bytesTotal: 10, speed: 3, eta: 2 });
    expectSame(job, structuredClone(job), undefined, undefined);
  });

  it('(+) eta NaN against its clone is true (Object.is); so are NaN cells in an entry', () => {
    const job = { ...makeJob(), eta: Number.NaN };
    expectSame(job, structuredClone(job));
    const entry = makeLive({ segments: [Number.NaN, 1] });
    expectSame(BASE, BASE, entry, structuredClone(entry));
  });
});

describe('sameRow: every field of a Job', () => {
  it('the table has a changed value for every key of makeJob() and nothing else, so a new Job field cannot go untested', () => {
    expect(Object.keys(CHANGED).sort()).toEqual(Object.keys(makeJob()).sort());
    for (const key of Object.keys(makeJob())) expect(CHANGED, `no changed value for ${key}`).toHaveProperty(key);
  });

  it.each(Object.keys(makeJob()))('changing %s alone gives false', (key) => {
    const record = BASE as unknown as Record<string, unknown>;
    const changeTo = CHANGED[key];
    expect(changeTo, `no changed value for ${key}`).toBeTypeOf('function');
    const changed = (changeTo as (current: unknown) => unknown)(record[key]);
    expect(Object.is(changed, record[key]), `the changed value of ${key} must differ from the default`).toBe(false);
    expectDifferent(BASE, v({ [key]: changed }));
  });

  it.each(Object.keys(makeJob()))('changing %s alone gives false also when both sides carry the same live entry', (key) => {
    const record = BASE as unknown as Record<string, unknown>;
    const changed = (CHANGED[key] as (current: unknown) => unknown)(record[key]);
    const entry = makeLive({ stream: 'audio', segments: [1], connections: 2 });
    expectDifferent(BASE, v({ [key]: changed }), entry, structuredClone(entry));
  });

  it('a copy that differs in no field, only in identity (new arrays, new objects), is the same', () => {
    const base = makeJob({ subtitleLangs: ['en', 'ar'], quality: { kind: 'max', height: 720 } });
    const copy: Job = { ...base, subtitleLangs: [...base.subtitleLangs], quality: { kind: 'max', height: 720 } };
    expect(copy).not.toBe(base);
    expect(copy.subtitleLangs).not.toBe(base.subtitleLangs);
    expectSame(base, copy);
  });

  describe('nested values', () => {
    it('quality max 720 against max 1080 gives false', () => {
      expectDifferent(v({ quality: { kind: 'max', height: 720 } }), v({ quality: { kind: 'max', height: 1080 } }));
      expectSame(v({ quality: { kind: 'max', height: 720 } }), v({ quality: { kind: 'max', height: 720 } }));
    });

    it('quality best against max 720 gives false', () => {
      expectDifferent(v({ quality: { kind: 'best' } }), v({ quality: { kind: 'max', height: 720 } }));
    });

    it('derived: quality audio m4a against audio mp3 gives false; null against an object gives false; null against null is the same', () => {
      expectDifferent(v({ quality: { kind: 'audio', format: 'm4a' } }), v({ quality: { kind: 'audio', format: 'mp3' } }));
      expectDifferent(v({ quality: null }), v({ quality: { kind: 'best' } }));
      expectSame(v({ quality: null }), v({ quality: null }));
    });

    it.each([
      [['en', 'ar'], ['en', 'fr']],
      [['en', 'ar'], ['en']],
      [['en', 'ar'], ['ar', 'en']],
      [[], ['en']],
    ])('subtitleLangs %j against %j gives false', (left, right) => {
      expectDifferent(v({ subtitleLangs: left }), v({ subtitleLangs: right }));
    });

    it('subtitleLangs [en, ar] against another [en, ar] (two arrays) gives true; so do two empty ones', () => {
      expectSame(v({ subtitleLangs: ['en', 'ar'] }), v({ subtitleLangs: ['en', 'ar'] }));
      expectSame(v({ subtitleLangs: [] }), v({ subtitleLangs: [] }));
    });
  });

  describe('(+) keys the other side lacks, and unlike types', () => {
    it('a job with an extra key against the job without it gives false; against a clone that also has it, true', () => {
      const extra = v({ engine: 'x' });
      expectDifferent(BASE, extra);
      expectSame(extra, structuredClone(extra));
    });

    it('a key that is undefined on one side and absent on the other is the same (a lacking key reads as undefined)', () => {
      expectSame(BASE, v({ extra: undefined }));
      const entry = makeLive();
      expectSame(BASE, BASE, entry, { ...entry, extra: undefined } as unknown as JobLive);
    });

    it('null against undefined is not the same (they are not Object.is-equal and are not objects)', () => {
      expectDifferent(BASE, v({ extra: null }));
    });

    it('an array against an object with the same (no) keys gives false', () => {
      expectDifferent(v({ subtitleLangs: [] }), v({ subtitleLangs: {} }));
    });

    it('an array against an array-like object gives false', () => {
      expectDifferent(v({ subtitleLangs: ['en'] }), v({ subtitleLangs: { 0: 'en', length: 1 } }));
    });

    it('null against an empty object gives false, in both orders', () => {
      expectDifferent(v({ quality: null }), v({ quality: {} }));
    });

    it('values of different types are not the same: 1 and "1", 1 and true, 0 and false, "" and null', () => {
      expectDifferent(v({ bytesDone: 1 }), v({ bytesDone: '1' }));
      expectDifferent(v({ bytesDone: 1 }), v({ bytesDone: true }));
      expectDifferent(v({ bytesDone: 0 }), v({ bytesDone: false }));
      expectDifferent(v({ bytesDone: '' }), v({ bytesDone: null }));
    });

    it('a nested object with an extra key gives false', () => {
      expectDifferent(v({ quality: { kind: 'best' } }), v({ quality: { kind: 'best', extra: 1 } }));
    });
  });
});

describe('sameRow: the live entry', () => {
  it('an entry against undefined gives false, in both argument orders', () => {
    const entry = makeLive({ stream: 'video' });
    expect(sameRow(BASE, BASE, entry, undefined)).toBe(false);
    expect(sameRow(BASE, BASE, undefined, entry)).toBe(false);
  });

  it('segments [1, 0] against [1, 0.5] gives false', () => {
    expectDifferent(BASE, BASE, makeLive({ segments: [1, 0] }), makeLive({ segments: [1, 0.5] }));
  });

  it('(+) stream video against audio gives false', () => {
    expectDifferent(BASE, BASE, makeLive({ stream: 'video' }), makeLive({ stream: 'audio' }));
  });

  it('(+) connections 8 against 9 gives false', () => {
    expectDifferent(BASE, BASE, makeLive({ connections: 8 }), makeLive({ connections: 9 }));
  });

  it('(+) segments null against [] gives false; [1] against [1, 0] gives false', () => {
    expectDifferent(BASE, BASE, makeLive({ segments: null }), makeLive({ segments: [] }));
    expectDifferent(BASE, BASE, makeLive({ segments: [1] }), makeLive({ segments: [1, 0] }));
  });

  it('(+) makeLive() (all null) against undefined gives false (Q5: an entry is not "no entry")', () => {
    expectDifferent(BASE, BASE, makeLive(), undefined);
    expectSame(BASE, BASE, makeLive(), makeLive());
  });

  it.each(Object.keys(LIVE_CHANGED) as Array<keyof JobLive>)('derived: %s alone changed gives false; the same value in both gives true', (key) => {
    const left = makeLive();
    const right = makeLive({ [key]: LIVE_CHANGED[key] } as Partial<JobLive>);
    expectDifferent(BASE, BASE, left, right);
    expectSame(BASE, BASE, right, makeLive({ [key]: structuredClone(LIVE_CHANGED[key]) } as Partial<JobLive>));
  });

  it('derived: segments in another order, with a different last cell, or with NaN, compare by element', () => {
    expectDifferent(BASE, BASE, makeLive({ segments: [1, 0] }), makeLive({ segments: [0, 1] }));
    expectDifferent(BASE, BASE, makeLive({ segments: [0, 0, 0] }), makeLive({ segments: [0, 0, 1] }));
    expectSame(BASE, BASE, makeLive({ segments: [0, 0, 0] }), makeLive({ segments: [0, 0, 0] }));
    expectSame(BASE, BASE, makeLive({ segments: [Number.NaN] }), makeLive({ segments: [Number.NaN] }));
  });

  it('derived: connections 0 against null gives false (a count of 0 is not "not known")', () => {
    expectDifferent(BASE, BASE, makeLive({ connections: 0 }), makeLive({ connections: null }));
  });

  it('derived: every key of an entry is compared, including one JobLive does not have today (a C7 field)', () => {
    const plain = makeLive({ stream: 'video' });
    const extended = { ...plain, bytesPerSecond: 5 } as unknown as JobLive;
    expectDifferent(BASE, BASE, plain, extended);
    expectSame(BASE, BASE, extended, structuredClone(extended));
    expectDifferent(BASE, BASE, extended, { ...extended, bytesPerSecond: 6 } as unknown as JobLive);
  });

  it('derived: an entry with a missing field against an entry with that field undefined is the same; against null it is not', () => {
    const missing = { stream: 'video' } as JobLive;
    const undefinedFields = { stream: 'video', segments: undefined, connections: undefined } as unknown as JobLive;
    expectSame(BASE, BASE, missing, undefinedFields);
    expectDifferent(BASE, BASE, missing, makeLive({ stream: 'video' }));
  });

  it('the job and the entry are both compared: a change in either alone gives false', () => {
    const job = makeJob({ state: 'downloading' });
    const entry = makeLive({ stream: 'video', segments: [1] });
    expect(sameRow(job, { ...job, speed: 1 }, entry, structuredClone(entry))).toBe(false);
    expect(sameRow(job, structuredClone(job), entry, makeLive({ stream: 'audio', segments: [1] }))).toBe(false);
    expect(sameRow(job, structuredClone(job), entry, structuredClone(entry))).toBe(true);
  });
});

describe('sameRow: derived promises', () => {
  it('returns a boolean, not a truthy value', () => {
    expect(typeof sameRow(BASE, BASE, undefined, undefined)).toBe('boolean');
    expect(typeof sameRow(BASE, v({ id: 'x' }), undefined, undefined)).toBe('boolean');
  });

  it('changes none of its arguments', () => {
    const job = makeJob({ quality: { kind: 'max', height: 720 }, subtitleLangs: ['en', 'ar'] });
    const other = { ...structuredClone(job), speed: 9 };
    const entry = makeLive({ stream: 'video', segments: [1, 0.5], connections: 3 });
    const other2 = makeLive({ stream: 'audio', segments: [1], connections: 3 });
    const before = structuredClone([job, other, entry, other2]);
    sameRow(job, other, entry, other2);
    sameRow(job, structuredClone(job), entry, structuredClone(entry));
    expect([job, other, entry, other2]).toEqual(before);
  });

  it('two jobs that differ only in id are different: the id is a field like the others', () => {
    expectDifferent(BASE, v({ id: 'job-other' }));
  });
});
