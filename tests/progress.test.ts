// C2 section 5.1: streamFraction and wholeJobFraction (src/shared/progress.ts).
// Rows 7 to 11 of the wholeJobFraction table, and every row with a live entry, are PROVISIONAL on PL-1.
// Marks used below: (+) = a row the plan adds to close a gap; (P) = a row with a live entry (provisional);
// "derived" = not a table row: it follows from the rules' first-match-wins order or from a stated field rule.
import { describe, expect, it } from 'vitest';
import { MERGE_AT, W_AUDIO, W_VIDEO, streamFraction, wholeJobFraction } from '../src/shared/progress';
import type { Job, JobLive, JobState, Quality, StreamRole } from '../src/shared/types';
import { makeJob, makeLive } from './helpers';

const STATES: JobState[] = ['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped'];
const AUDIO_M4A: Quality = { kind: 'audio', format: 'm4a' };
const AUDIO_MP3: Quality = { kind: 'audio', format: 'mp3' };
const MAX_720: Quality = { kind: 'max', height: 720 };
const BEST: Quality = { kind: 'best' };

/** "media" of the plan: the makeJob defaults. */
const media = (over: Partial<Job> = {}): Job => makeJob(over);
/** "file" of the plan. */
const file = (over: Partial<Job> = {}): Job => makeJob({ kind: 'file', quality: null, baseName: null, ...over });
/** A live entry that only has a stream. */
const stream = (role: StreamRole | null): JobLive => makeLive({ stream: role });
/** A stream value that is not one of the three roles (the type forbids it; the window could still get one). */
const OTHER = 'subs' as unknown as StreamRole;

/** The products of the table: compared with toBeCloseTo. Everything else is exact. */
const PRODUCTS = [0.245, 0.2125, 0.915, 0.34];

function expectFraction(actual: number | null, expected: number | null): void {
  if (expected !== null && PRODUCTS.includes(expected)) {
    expect(actual).not.toBeNull();
    expect(actual as number).toBeCloseTo(expected, 10);
  } else {
    expect(actual).toBe(expected);
  }
}

describe('the constants', () => {
  it('are the architecture values', () => {
    expect(W_VIDEO).toBe(0.85);
    expect(W_AUDIO).toBe(0.13);
    expect(MERGE_AT).toBe(0.98);
  });
});

type Row = [label: string, job: Job, live: JobLive | undefined, stream: number | null, whole: number | null];

/** The test rows of 5.1, in the plan's order. */
const ROWS: Row[] = [
  ['file downloading 50/200', file({ state: 'downloading', bytesDone: 50, bytesTotal: 200 }), undefined, 0.25, 0.25],
  ['file downloading 5/null', file({ state: 'downloading', bytesDone: 5, bytesTotal: null }), undefined, null, null],
  ['file downloading 0/0', file({ state: 'downloading', bytesDone: 0, bytesTotal: 0 }), undefined, null, null],
  ['file downloading 300/200', file({ state: 'downloading', bytesDone: 300, bytesTotal: 200 }), undefined, 1, 1],
  ['file downloading -5/200', file({ state: 'downloading', bytesDone: -5, bytesTotal: 200 }), undefined, 0, 0],
  ['file done 0/null', file({ state: 'done' }), undefined, null, 1],
  ['media done 0/null', media({ state: 'done' }), undefined, null, 1],
  ['file failed 50/200', file({ state: 'failed', bytesDone: 50, bytesTotal: 200 }), undefined, 0.25, null],
  ['media skipped', media({ state: 'skipped' }), undefined, null, null],
  ['media merging 30/40', media({ state: 'merging', bytesDone: 30, bytesTotal: 40 }), undefined, 0.75, MERGE_AT],
  ['media queued 0/null', media({ state: 'queued' }), undefined, null, 0],
  ['file probing 0/100', file({ state: 'probing', bytesDone: 0, bytesTotal: 100 }), undefined, 0, 0],
  ['file queued 50/200 (retry wait)', file({ state: 'queued', bytesDone: 50, bytesTotal: 200 }), undefined, 0.25, 0.25],
  ['media audio m4a downloading 10/40, no live', media({ state: 'downloading', quality: AUDIO_M4A, bytesDone: 10, bytesTotal: 40 }), undefined, 0.25, 0.245],
  ['(P) media audio m4a downloading 10/40, stream audio', media({ state: 'downloading', quality: AUDIO_M4A, bytesDone: 10, bytesTotal: 40 }), stream('audio'), 0.25, 0.245],
  ['(P) media downloading 50/200, stream muxed', media({ state: 'downloading', bytesDone: 50, bytesTotal: 200 }), stream('muxed'), 0.25, 0.245],
  ['(P) media downloading 50/200, stream video', media({ state: 'downloading', bytesDone: 50, bytesTotal: 200 }), stream('video'), 0.25, 0.2125],
  ['(P) media downloading 20/40, stream audio', media({ state: 'downloading', bytesDone: 20, bytesTotal: 40 }), stream('audio'), 0.5, 0.915],
  ['(P) media paused 80/200, stream video', media({ state: 'paused', bytesDone: 80, bytesTotal: 200 }), stream('video'), 0.4, 0.34],
  ['media downloading 50/200, no live', media({ state: 'downloading', bytesDone: 50, bytesTotal: 200 }), undefined, 0.25, null],
  ['(P) media downloading 50/200, live with stream null', media({ state: 'downloading', bytesDone: 50, bytesTotal: 200 }), stream(null), 0.25, null],
  ['(+) file merging 30/40', file({ state: 'merging', bytesDone: 30, bytesTotal: 40 }), undefined, 0.75, MERGE_AT],
  ['(+)(P) done with stream video, 50/200', media({ state: 'done', bytesDone: 50, bytesTotal: 200 }), stream('video'), 0.25, 1],
  ['(+)(P) media failed 50/200, stream video', media({ state: 'failed', bytesDone: 50, bytesTotal: 200 }), stream('video'), 0.25, null],
  ['(+) media audio mp3 paused 10/40, no live', media({ state: 'paused', quality: AUDIO_MP3, bytesDone: 10, bytesTotal: 40 }), undefined, 0.25, 0.245],
  ['(+)(P) media audio m4a downloading 10/40, stream video', media({ state: 'downloading', quality: AUDIO_M4A, bytesDone: 10, bytesTotal: 40 }), stream('video'), 0.25, 0.245],
  ['(+) media audio m4a downloading 5/null', media({ state: 'downloading', quality: AUDIO_M4A, bytesDone: 5, bytesTotal: null }), undefined, null, null],
  ['(+)(P) media max 720 downloading 50/200, stream video', media({ state: 'downloading', quality: MAX_720, bytesDone: 50, bytesTotal: 200 }), stream('video'), 0.25, 0.2125],
  ['(+)(P) media probing 50/200, stream video (a new run, L3)', media({ state: 'probing', bytesDone: 50, bytesTotal: 200 }), stream('video'), 0.25, 0.2125],
  ['(+)(P) media probing 0/null, stream audio', media({ state: 'probing' }), stream('audio'), null, 0],
  ['(+) media queued 50/200, reason retrying (1/3), no live', media({ state: 'queued', reason: 'retrying (1/3)', bytesDone: 50, bytesTotal: 200 }), undefined, 0.25, null],
  ['(+) file paused 0/100', file({ state: 'paused', bytesDone: 0, bytesTotal: 100 }), undefined, 0, 0],
  ['(+) media paused 0/null', media({ state: 'paused' }), undefined, null, null],
  ['(+)(P) media downloading 50/200, stream "subs"', media({ state: 'downloading', bytesDone: 50, bytesTotal: 200 }), stream(OTHER), 0.25, null],
  ['(+)(P) media downloading 50/200, segments [1, 0] and stream null', media({ state: 'downloading', bytesDone: 50, bytesTotal: 200 }), makeLive({ segments: [1, 0] }), 0.25, null],
  ['(+) file downloading NaN/200', file({ state: 'downloading', bytesDone: Number.NaN, bytesTotal: 200 }), undefined, null, null],
  ['(+) file downloading 50/NaN', file({ state: 'downloading', bytesDone: 50, bytesTotal: Number.NaN }), undefined, null, null],
  ['(+) file downloading 50/Infinity', file({ state: 'downloading', bytesDone: 50, bytesTotal: Number.POSITIVE_INFINITY }), undefined, null, null],
  ['(+) file downloading Infinity/200', file({ state: 'downloading', bytesDone: Number.POSITIVE_INFINITY, bytesTotal: 200 }), undefined, null, null],
];

describe('the plan table (5.1)', () => {
  it.each(ROWS)('streamFraction: %s', (_label, job, _live, expected) => {
    expectFraction(streamFraction(job), expected);
  });

  it.each(ROWS)('wholeJobFraction: %s', (_label, job, live, _stream, expected) => {
    expectFraction(wholeJobFraction(job, live), expected);
  });
});

describe('streamFraction', () => {
  it.each([
    ['null', null],
    ['0', 0],
    ['-1', -1],
    ['-0.5', -0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('is null when bytesTotal is %s (rule 1)', (_label, bytesTotal) => {
    expect(streamFraction(file({ state: 'downloading', bytesDone: 5, bytesTotal }))).toBeNull();
    expect(streamFraction(file({ state: 'downloading', bytesDone: 0, bytesTotal }))).toBeNull();
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('is null when bytesDone is %s (rule 2, OD-2)', (_label, bytesDone) => {
    expect(streamFraction(file({ state: 'downloading', bytesDone, bytesTotal: 200 }))).toBeNull();
  });

  it('is a plain quotient clamped to 0..1 (rule 3), with the boundaries kept', () => {
    const f = (bytesDone: number, bytesTotal: number): number | null => streamFraction(file({ state: 'downloading', bytesDone, bytesTotal }));
    expect(f(0, 200)).toBe(0);
    expect(f(1, 200)).toBe(0.005);
    expect(f(199, 200)).toBe(0.995);
    expect(f(200, 200)).toBe(1);
    expect(f(201, 200)).toBe(1);
    expect(f(1e12, 200)).toBe(1);
    expect(f(-1, 200)).toBe(0);
    expect(f(-1e12, 200)).toBe(0);
    expect(f(1, 1)).toBe(1);
    expect(f(0, 1)).toBe(0);
  });

  it.each(STATES)('does not look at the state: %s gives the same quotient and the same null', (state) => {
    expect(streamFraction(media({ state, bytesDone: 50, bytesTotal: 200 }))).toBe(0.25);
    expect(streamFraction(file({ state, bytesDone: 50, bytesTotal: 200 }))).toBe(0.25);
    expect(streamFraction(media({ state, bytesDone: 0, bytesTotal: null }))).toBeNull();
    expect(streamFraction(file({ state, bytesDone: 0, bytesTotal: null }))).toBeNull();
  });

  it.each([BEST, MAX_720, AUDIO_M4A, AUDIO_MP3, null])('does not look at the quality (%j)', (quality) => {
    expect(streamFraction(media({ state: 'downloading', quality, bytesDone: 50, bytesTotal: 200 }))).toBe(0.25);
  });
});

describe('wholeJobFraction: rows 1 to 4 and their order (derived from "first match wins")', () => {
  const COUNTS: Array<[string, number, number | null]> = [
    ['0/null', 0, null],
    ['50/200', 50, 200],
    ['300/200', 300, 200],
    ['NaN/NaN', Number.NaN, Number.NaN],
  ];
  const LIVES: Array<[string, JobLive | undefined]> = [
    ['no live', undefined],
    ['stream null', stream(null)],
    ['stream video', stream('video')],
    ['stream audio', stream('audio')],
    ['stream muxed', stream('muxed')],
    ['segments', makeLive({ stream: 'audio', segments: [1, 0], connections: 4 })],
  ];
  const JOBS: Array<[string, (over: Partial<Job>) => Job]> = [
    ['file', file],
    ['media', media],
    ['media audio', (over) => media({ quality: AUDIO_M4A, ...over })],
  ];

  function everywhere(state: JobState, check: (job: Job, live: JobLive | undefined) => void): void {
    for (const [, make] of JOBS) {
      for (const [, bytesDone, bytesTotal] of COUNTS) {
        for (const [, live] of LIVES) check(make({ state, bytesDone, bytesTotal }), live);
      }
    }
  }

  it('row 1: done is 1 whatever the counts, kind, quality and stream', () => {
    everywhere('done', (job, live) => expect(wholeJobFraction(job, live)).toBe(1));
  });

  it.each(['failed', 'skipped'] as const)('row 2: %s is null whatever the counts, kind, quality and stream', (state) => {
    everywhere(state, (job, live) => expect(wholeJobFraction(job, live)).toBeNull());
  });

  it('row 3: merging is MERGE_AT whatever the counts, kind, quality and stream (even with no known size)', () => {
    everywhere('merging', (job, live) => expect(wholeJobFraction(job, live)).toBe(MERGE_AT));
  });

  it.each(['queued', 'probing'] as const)('row 4: %s with bytesDone 0 is 0, before rows 5 to 11', (state) => {
    const totals: Array<number | null> = [null, 100, 0, -1, Number.NaN, Number.POSITIVE_INFINITY];
    for (const bytesTotal of totals) {
      for (const [, make] of JOBS) {
        for (const [, live] of LIVES) {
          expect(wholeJobFraction(make({ state, bytesDone: 0, bytesTotal }), live)).toBe(0);
        }
      }
    }
  });

  it.each(['queued', 'probing'] as const)('row 4 is only for bytesDone 0: %s with a count above 0 goes on to rows 5 to 11', (state) => {
    expect(wholeJobFraction(media({ state, bytesDone: 5, bytesTotal: null }), stream('video'))).toBeNull();
    expect(wholeJobFraction(file({ state, bytesDone: 50, bytesTotal: 200 }), undefined)).toBe(0.25);
    expect(wholeJobFraction(media({ state, bytesDone: 50, bytesTotal: 200 }), stream('video'))).toBeCloseTo(0.2125, 10);
    expect(wholeJobFraction(media({ state, bytesDone: 50, bytesTotal: 200 }), undefined)).toBeNull();
    // NaN is not 0: it is not row 4, and row 5 gives null.
    expect(wholeJobFraction(file({ state, bytesDone: Number.NaN, bytesTotal: 100 }), undefined)).toBeNull();
  });

  it.each(['queued', 'probing'] as const)('row 4 is for a count of exactly 0: %s with a negative count goes on to rows 5 to 11', (state) => {
    // -5/200 on the audio stream: the fraction is clamped to 0, so row 10 gives the video share (W_VIDEO), not row 4's 0.
    expect(wholeJobFraction(media({ state, bytesDone: -5, bytesTotal: 200 }), stream('audio'))).toBeCloseTo(0.85, 10);
    expect(wholeJobFraction(media({ state, bytesDone: -5, bytesTotal: 200 }), stream('video'))).toBe(0);
    // No known size, so row 5 gives null, not row 4's 0.
    expect(wholeJobFraction(media({ state, bytesDone: -5, bytesTotal: null }), stream('video'))).toBeNull();
    expect(wholeJobFraction(file({ state, bytesDone: -5, bytesTotal: null }), undefined)).toBeNull();
  });

  it('row 4 is not for the other running states: 0/200 on the audio stream is the audio share, not 0', () => {
    for (const state of ['downloading', 'paused'] as const) {
      expect(wholeJobFraction(media({ state, bytesDone: 0, bytesTotal: 200 }), stream('audio'))).toBeCloseTo(0.85, 10);
    }
    for (const state of ['downloading', 'paused'] as const) {
      expect(wholeJobFraction(media({ state, bytesDone: 0, bytesTotal: 200 }), stream('video'))).toBe(0);
    }
  });
});

describe('wholeJobFraction: rows 5 and 6', () => {
  it.each(['queued', 'probing', 'downloading', 'paused'] as const)('row 5: %s with no known size is null, for a file and for every stream', (state) => {
    const lives: Array<JobLive | undefined> = [undefined, stream(null), stream('video'), stream('audio'), stream('muxed')];
    const sizes: Array<[number, number | null]> = [
      [5, null],
      [5, 0],
      [5, -3],
      [5, Number.NaN],
      [5, Number.POSITIVE_INFINITY],
      [Number.NaN, 200],
      [Number.POSITIVE_INFINITY, 200],
    ];
    for (const [bytesDone, bytesTotal] of sizes) {
      for (const live of lives) {
        expect(wholeJobFraction(file({ state, bytesDone, bytesTotal }), live)).toBeNull();
        expect(wholeJobFraction(media({ state, bytesDone, bytesTotal }), live)).toBeNull();
        expect(wholeJobFraction(media({ state, quality: AUDIO_M4A, bytesDone, bytesTotal }), live)).toBeNull();
      }
    }
  });

  it('row 5 comes before row 6: a file downloading 0/null is null, not 0', () => {
    expect(wholeJobFraction(file({ state: 'downloading', bytesDone: 0, bytesTotal: null }), undefined)).toBeNull();
    expect(wholeJobFraction(file({ state: 'paused', bytesDone: 0, bytesTotal: null }), undefined)).toBeNull();
  });

  it.each(['queued', 'downloading', 'paused'] as const)('row 6: a file in %s is its own fraction whatever the stream', (state) => {
    for (const live of [undefined, stream(null), stream('video'), stream('audio'), stream('muxed'), stream(OTHER)]) {
      expect(wholeJobFraction(file({ state, bytesDone: 50, bytesTotal: 200 }), live)).toBe(0.25);
    }
  });

  it('row 6 comes before row 7: a file that carries an audio quality is still its own fraction', () => {
    expect(wholeJobFraction(file({ state: 'downloading', quality: AUDIO_M4A, bytesDone: 10, bytesTotal: 40 }), undefined)).toBe(0.25);
    expect(wholeJobFraction(file({ state: 'downloading', quality: AUDIO_M4A, bytesDone: 10, bytesTotal: 40 }), stream('audio'))).toBe(0.25);
  });
});

describe('wholeJobFraction: rows 7 to 11 (PROVISIONAL on PL-1)', () => {
  const STREAMS: Array<[string, JobLive | undefined]> = [
    ['no live', undefined],
    ['stream null', stream(null)],
    ['stream video', stream('video')],
    ['stream audio', stream('audio')],
    ['stream muxed', stream('muxed')],
    ['stream "subs"', stream(OTHER)],
    ['an entry with no fields', {} as JobLive],
  ];

  it.each([AUDIO_M4A, AUDIO_MP3])('row 7: an audio-only job (%j) is the fraction times W_VIDEO + W_AUDIO, whatever the stream', (quality) => {
    for (const [, live] of STREAMS) {
      const result = wholeJobFraction(media({ state: 'downloading', quality, bytesDone: 10, bytesTotal: 40 }), live);
      expect(result).toBeCloseTo(0.25 * (W_VIDEO + W_AUDIO), 10);
      expect(result).toBeCloseTo(0.245, 10);
    }
  });

  it.each([BEST, MAX_720, null])('row 8: muxed (quality %j) is the fraction times W_VIDEO + W_AUDIO', (quality) => {
    const result = wholeJobFraction(media({ state: 'downloading', quality, bytesDone: 50, bytesTotal: 200 }), stream('muxed'));
    expect(result).toBeCloseTo(0.25 * (W_VIDEO + W_AUDIO), 10);
  });

  it.each([BEST, MAX_720, null])('row 9: the video stream (quality %j) is the fraction times W_VIDEO', (quality) => {
    expect(wholeJobFraction(media({ state: 'downloading', quality, bytesDone: 50, bytesTotal: 200 }), stream('video'))).toBeCloseTo(0.25 * W_VIDEO, 10);
  });

  it.each([BEST, MAX_720, null])('row 10: the audio stream (quality %j) is W_VIDEO plus the fraction times W_AUDIO', (quality) => {
    expect(wholeJobFraction(media({ state: 'downloading', quality, bytesDone: 20, bytesTotal: 40 }), stream('audio'))).toBeCloseTo(W_VIDEO + 0.5 * W_AUDIO, 10);
  });

  it.each([null, OTHER, '' as unknown as StreamRole, 'Video' as unknown as StreamRole])('row 11: a stream that is not known (%j) gives null for a video job', (role) => {
    expect(wholeJobFraction(media({ state: 'downloading', bytesDone: 50, bytesTotal: 200 }), stream(role))).toBeNull();
  });

  it('row 11: no live and an entry with a missing stream field give null too (L10: absent = null)', () => {
    const job = media({ state: 'downloading', bytesDone: 50, bytesTotal: 200 });
    expect(wholeJobFraction(job, undefined)).toBeNull();
    expect(wholeJobFraction(job, {} as JobLive)).toBeNull();
    expect(wholeJobFraction(job, { segments: [1, 0] } as JobLive)).toBeNull();
  });

  it('applies to every state that reaches rows 7 to 11: queued and probing (with a count), downloading, paused', () => {
    for (const state of ['queued', 'probing', 'downloading', 'paused'] as const) {
      const base = { state, bytesDone: 50, bytesTotal: 200 };
      expect(wholeJobFraction(media(base), stream('video'))).toBeCloseTo(0.2125, 10);
      expect(wholeJobFraction(media({ ...base, bytesDone: 20, bytesTotal: 40 }), stream('audio'))).toBeCloseTo(0.915, 10);
      expect(wholeJobFraction(media(base), stream('muxed'))).toBeCloseTo(0.245, 10);
      expect(wholeJobFraction(media(base), undefined)).toBeNull();
    }
  });

  it('reaches W_VIDEO at the end of the video stream and W_VIDEO + W_AUDIO at the end of the audio stream; the boundaries 0 and 1 are kept', () => {
    const at = (bytesDone: number, role: StreamRole): number | null =>
      wholeJobFraction(media({ state: 'downloading', bytesDone, bytesTotal: 200 }), stream(role));
    expect(at(200, 'video')).toBeCloseTo(0.85, 10);
    expect(at(0, 'video')).toBe(0);
    expect(at(0, 'audio')).toBeCloseTo(0.85, 10);
    expect(at(200, 'audio')).toBeCloseTo(0.98, 10);
    expect(at(300, 'audio')).toBeCloseTo(0.98, 10);
    expect(at(200, 'muxed')).toBeCloseTo(0.98, 10);
  });

  it('reads only the stream: segments and connections in the entry change nothing', () => {
    const job = media({ state: 'downloading', bytesDone: 50, bytesTotal: 200 });
    expect(wholeJobFraction(job, makeLive({ stream: 'video', segments: [1, 1, 0], connections: 8 }))).toBeCloseTo(0.2125, 10);
    expect(wholeJobFraction(job, makeLive({ stream: 'video' }))).toBeCloseTo(0.2125, 10);
  });
});

describe('both functions, every combination', () => {
  const lives: Array<JobLive | undefined> = [
    undefined,
    stream(null),
    stream('video'),
    stream('audio'),
    stream('muxed'),
    makeLive({ stream: 'video', segments: [1, 0], connections: 3 }),
  ];
  const counts: Array<[number, number | null]> = [
    [0, null],
    [50, 200],
    [300, 200],
    [-5, 200],
  ];
  const qualities: Array<Quality | null> = [BEST, MAX_720, AUDIO_M4A, null];

  function forEveryInput(visit: (job: Job, live: JobLive | undefined) => void): void {
    for (const state of STATES) {
      for (const kind of ['media', 'file'] as const) {
        for (const quality of qualities) {
          for (const live of lives) {
            for (const [bytesDone, bytesTotal] of counts) {
              visit(makeJob({ state, kind, quality, bytesDone, bytesTotal }), live);
            }
          }
        }
      }
    }
  }

  it('the result is null or lies in 0..1 (+ property)', () => {
    let seen = 0;
    forEveryInput((job, live) => {
      for (const result of [streamFraction(job), wholeJobFraction(job, live)]) {
        seen += 1;
        if (result !== null) {
          expect(Number.isFinite(result)).toBe(true);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(1);
        }
      }
    });
    expect(seen).toBe(2 * 8 * 2 * 4 * 6 * 4);
  });

  it('neither function changes its arguments (+)', () => {
    forEveryInput((job, live) => {
      const jobBefore = structuredClone(job);
      const liveBefore = structuredClone(live);
      streamFraction(job);
      wholeJobFraction(job, live);
      expect(job).toEqual(jobBefore);
      expect(live).toEqual(liveBefore);
    });
  });

  it('gives the same answer for the same input (no hidden state)', () => {
    forEveryInput((job, live) => {
      expect(wholeJobFraction(job, live)).toBe(wholeJobFraction(job, live));
      expect(streamFraction(job)).toBe(streamFraction(job));
    });
  });
});
