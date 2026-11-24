// C2 section 5.2: laneModel (src/renderer/src/model/lanes.ts).
// Marks as in the plan: (+) = a row the plan adds; (P) = a row with a live entry (PROVISIONAL with 5.1 and rows 7 to 11).
// "derived" = not a table row: it enumerates a rule (every state, every lane form) or checks a stated promise.
import { describe, expect, it } from 'vitest';
import { laneModel, type Fill, type Lane, type LaneModel, type Tone } from '../../src/renderer/src/model/lanes';
import type { Job, JobLive, JobState, Quality, StreamRole } from '../../src/shared/types';
import { makeJob, makeLive } from '../helpers';

const STATES: JobState[] = ['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped'];
const AUDIO_M4A: Quality = { kind: 'audio', format: 'm4a' };
const AUDIO_MP3: Quality = { kind: 'audio', format: 'mp3' };
const MAX_720: Quality = { kind: 'max', height: 720 };

const media = (over: Partial<Job> = {}): Job => makeJob(over);
const file = (over: Partial<Job> = {}): Job => makeJob({ kind: 'file', quality: null, baseName: null, ...over });
const stream = (role: StreamRole | null): JobLive => makeLive({ stream: role });
const OTHER = 'subs' as unknown as StreamRole;

// The expected model, built as the plan writes it.
const known = (fraction: number): Fill => ({ kind: 'known', fraction });
const UNKNOWN: Fill = { kind: 'unknown' };
const EMPTY: Fill = { kind: 'empty' };
const FULL: Fill = { kind: 'full' };
const lane = (fill: Fill, tone: Tone): Lane => ({ fill, tone });
const single = (fill: Fill, tone: Tone): LaneModel => ({ form: 'single', fill, tone });
const pair = (video: Lane, audio: Lane): LaneModel => ({ form: 'pair', video, audio });
const merge = (strands: 1 | 2): LaneModel => ({ form: 'merge', strands });
const segments = (cells: number[], connections: number | null, tone: Tone): LaneModel => ({ form: 'segments', cells, connections, tone });
const NONE: LaneModel = { form: 'none' };

const dl = { state: 'downloading', bytesDone: 50, bytesTotal: 200 } as const;

type Row = [label: string, job: Job, live: JobLive | undefined, expected: LaneModel];

/** The table of 5.2 in the plan's order (row 19 and row 43 are two rows each). */
const ROWS: Row[] = [
  ['1 (P) media downloading 50/200, stream video', media(dl), stream('video'), pair(lane(known(0.25), 'active'), lane(EMPTY, 'waiting'))],
  ['2 (P) media downloading 30/40, stream audio', media({ state: 'downloading', bytesDone: 30, bytesTotal: 40 }), stream('audio'), pair(lane(FULL, 'active'), lane(known(0.75), 'active'))],
  ['3 media downloading 50/200, no live', media(dl), undefined, single(known(0.25), 'active')],
  ['4 (P) media downloading 50/200, stream muxed', media(dl), stream('muxed'), single(known(0.25), 'active')],
  ['5 (P) media audio m4a downloading 10/40, stream audio', media({ state: 'downloading', quality: AUDIO_M4A, bytesDone: 10, bytesTotal: 40 }), stream('audio'), single(known(0.25), 'active')],
  ['6 media merging, quality best', media({ state: 'merging' }), undefined, merge(2)],
  ['7 media merging, quality audio mp3', media({ state: 'merging', quality: AUDIO_MP3 }), undefined, merge(1)],
  ['8 (P) file downloading 50/200, segments [1,1,0.5,0], connections 8', file(dl), makeLive({ segments: [1, 1, 0.5, 0], connections: 8 }), segments([1, 1, 0.5, 0], 8, 'active')],
  ['9 file downloading 50/200, no live', file(dl), undefined, single(known(0.25), 'active')],
  ['10 file downloading 1536/null', file({ state: 'downloading', bytesDone: 1536, bytesTotal: null }), undefined, single(UNKNOWN, 'active')],
  ['11 (P) media paused 80/200, stream video', media({ state: 'paused', bytesDone: 80, bytesTotal: 200 }), stream('video'), pair(lane(known(0.4), 'paused'), lane(EMPTY, 'paused'))],
  ['12 media paused 80/200, no live', media({ state: 'paused', bytesDone: 80, bytesTotal: 200 }), undefined, single(known(0.4), 'paused')],
  ['13 file failed 50/200', file({ state: 'failed', bytesDone: 50, bytesTotal: 200 }), undefined, single(known(0.25), 'failed')],
  ['14 media failed 0/null', media({ state: 'failed' }), undefined, single(EMPTY, 'failed')],
  ['15 queued 0/null', media({ state: 'queued' }), undefined, single(EMPTY, 'waiting')],
  ['16 queued, reason retrying (2/3), 50/200', media({ state: 'queued', reason: 'retrying (2/3)', bytesDone: 50, bytesTotal: 200 }), undefined, single(known(0.25), 'waiting')],
  ['17 file downloading 300/200', file({ state: 'downloading', bytesDone: 300, bytesTotal: 200 }), undefined, single(known(1), 'active')],
  ['18 file downloading 0/0', file({ state: 'downloading', bytesDone: 0, bytesTotal: 0 }), undefined, single(UNKNOWN, 'active')],
  ['19 done', media({ state: 'done' }), undefined, NONE],
  ['19 skipped', media({ state: 'skipped' }), undefined, NONE],
  ['19 (P) done with a live entry', media({ state: 'done' }), makeLive({ stream: 'video', segments: [1, 0], connections: 4 }), NONE],
  ['19 (P) skipped with a live entry', media({ state: 'skipped' }), makeLive({ stream: 'audio', segments: [1, 0], connections: 4 }), NONE],
  ['20 (P) media failed 80/200, stream video', media({ state: 'failed', bytesDone: 80, bytesTotal: 200 }), stream('video'), pair(lane(known(0.4), 'failed'), lane(EMPTY, 'failed'))],
  ['21 (P) media queued retrying (1/3), 30/40, stream audio', media({ state: 'queued', reason: 'retrying (1/3)', bytesDone: 30, bytesTotal: 40 }), stream('audio'), pair(lane(FULL, 'waiting'), lane(known(0.75), 'waiting'))],
  ['22 (P) file paused 50/200, segments [1,0.5,0,0], connections 8', file({ state: 'paused', bytesDone: 50, bytesTotal: 200 }), makeLive({ segments: [1, 0.5, 0, 0], connections: 8 }), segments([1, 0.5, 0, 0], null, 'paused')],
  ['23 (P) file failed 50/200, segments [1,0]', file({ state: 'failed', bytesDone: 50, bytesTotal: 200 }), makeLive({ segments: [1, 0] }), segments([1, 0], null, 'failed')],
  ['24 (P) file downloading 50/200, segments []', file(dl), makeLive({ segments: [] }), single(known(0.25), 'active')],
  ['25 (P) media downloading 5/null, stream video', media({ state: 'downloading', bytesDone: 5, bytesTotal: null }), stream('video'), pair(lane(UNKNOWN, 'active'), lane(EMPTY, 'waiting'))],
  ['26 (P) media audio m4a downloading 10/40, stream video', media({ state: 'downloading', quality: AUDIO_M4A, bytesDone: 10, bytesTotal: 40 }), stream('video'), single(known(0.25), 'active')],
  ['27 (P) file downloading 50/200, stream video', file(dl), stream('video'), single(known(0.25), 'active')],
  ['28 file queued 0/100', file({ state: 'queued', bytesDone: 0, bytesTotal: 100 }), undefined, single(known(0), 'waiting')],
  ['29 media probing 50/200, no live', media({ state: 'probing', bytesDone: 50, bytesTotal: 200 }), undefined, single(known(0.25), 'waiting')],
  ['30 file merging', file({ state: 'merging' }), undefined, merge(1)],
  ['31 (P) media merging, stream audio, segments [1]', media({ state: 'merging' }), makeLive({ stream: 'audio', segments: [1] }), merge(2)],
  ['32 (+)(P) media downloading 50/200, makeLive() (all null)', media(dl), makeLive(), single(known(0.25), 'active')],
  ['33 (+)(P) media downloading 50/200, segments [1,0], stream video (rule 3 before rule 4)', media(dl), makeLive({ segments: [1, 0], stream: 'video' }), segments([1, 0], null, 'active')],
  ['34 (+)(P) file downloading 50/200, segments [0.5], connections null', file(dl), makeLive({ segments: [0.5], connections: null }), segments([0.5], null, 'active')],
  ['35 (+)(P) file queued 50/200, segments [1,0], connections 4', file({ state: 'queued', bytesDone: 50, bytesTotal: 200 }), makeLive({ segments: [1, 0], connections: 4 }), segments([1, 0], null, 'waiting')],
  ['36 (+)(P) media max 720 downloading 50/200, stream video', media({ ...dl, quality: MAX_720 }), stream('video'), pair(lane(known(0.25), 'active'), lane(EMPTY, 'waiting'))],
  ['37 (+) media max 720 merging', media({ state: 'merging', quality: MAX_720 }), undefined, merge(2)],
  ['38 (+)(P) media probing 0/null, stream audio', media({ state: 'probing' }), stream('audio'), pair(lane(FULL, 'waiting'), lane(EMPTY, 'waiting'))],
  ['39 (+)(P) media queued 0/null, stream video', media({ state: 'queued' }), stream('video'), pair(lane(EMPTY, 'waiting'), lane(EMPTY, 'waiting'))],
  ['40 (+) media paused 0/null, no live', media({ state: 'paused' }), undefined, single(EMPTY, 'paused')],
  ['41 (+) file downloading -5/200', file({ state: 'downloading', bytesDone: -5, bytesTotal: 200 }), undefined, single(known(0), 'active')],
  ['42 (+)(P) media downloading 50/200, stream "subs"', media(dl), stream(OTHER), single(known(0.25), 'active')],
  ['43 (+) media with quality null, merging', media({ state: 'merging', quality: null }), undefined, merge(2)],
  ['43 (+)(P) media with quality null, downloading 50/200, stream video', media({ ...dl, quality: null }), stream('video'), pair(lane(known(0.25), 'active'), lane(EMPTY, 'waiting'))],
  ['44 (+) file downloading NaN/200', file({ state: 'downloading', bytesDone: Number.NaN, bytesTotal: 200 }), undefined, single(UNKNOWN, 'active')],
  ['45 (+)(P) file downloading 50/200, segments [1,0], connections undefined', file(dl), makeLive({ segments: [1, 0], connections: undefined as unknown as null }), segments([1, 0], null, 'active')],
  ['46 (+) file downloading 50/Infinity (OD-2)', file({ state: 'downloading', bytesDone: 50, bytesTotal: Number.POSITIVE_INFINITY }), undefined, single(UNKNOWN, 'active')],
];

describe('the plan table (5.2)', () => {
  it.each(ROWS)('%s', (_label, job, live, expected) => {
    const jobBefore = structuredClone(job);
    const liveBefore = structuredClone(live);
    expect(laneModel(job, live)).toEqual(expected);
    // (+) The job and the entry are unchanged after the call.
    expect(job).toEqual(jobBefore);
    expect(live).toEqual(liveBefore);
  });
});

describe('the tone of the job (derived: every state)', () => {
  it.each<[JobState, LaneModel]>([
    ['queued', single(known(0.25), 'waiting')],
    ['probing', single(known(0.25), 'waiting')],
    ['downloading', single(known(0.25), 'active')],
    ['paused', single(known(0.25), 'paused')],
    ['failed', single(known(0.25), 'failed')],
    ['merging', merge(2)],
    ['done', NONE],
    ['skipped', NONE],
  ])('a media job in %s with no live entry', (state, expected) => {
    expect(laneModel(media({ state, bytesDone: 50, bytesTotal: 200 }), undefined)).toEqual(expected);
  });

  it.each<[JobState, LaneModel]>([
    ['queued', single(known(0.25), 'waiting')],
    ['probing', single(known(0.25), 'waiting')],
    ['downloading', single(known(0.25), 'active')],
    ['paused', single(known(0.25), 'paused')],
    ['failed', single(known(0.25), 'failed')],
    ['merging', merge(1)],
    ['done', NONE],
    ['skipped', NONE],
  ])('a file job in %s with no live entry', (state, expected) => {
    expect(laneModel(file({ state, bytesDone: 50, bytesTotal: 200 }), undefined)).toEqual(expected);
  });

  it.each<[JobState, Tone]>([
    ['queued', 'waiting'],
    ['probing', 'waiting'],
    ['downloading', 'active'],
    ['paused', 'paused'],
    ['failed', 'failed'],
  ])('the idle audio lane of a pair and the video lane after it: %s -> tone %s', (state, tone) => {
    const idleAudio: Tone = tone === 'active' ? 'waiting' : tone;
    expect(laneModel(media({ state, bytesDone: 50, bytesTotal: 200 }), stream('video'))).toEqual(
      pair(lane(known(0.25), tone), lane(EMPTY, idleAudio)),
    );
    expect(laneModel(media({ state, bytesDone: 50, bytesTotal: 200 }), stream('audio'))).toEqual(
      pair(lane(FULL, tone), lane(known(0.25), tone)),
    );
  });
});

describe('the fill of the current stream (derived: every state, every way a size is not known)', () => {
  it.each<[JobState, Fill]>([
    ['queued', EMPTY],
    ['probing', EMPTY],
    ['downloading', UNKNOWN],
    ['paused', EMPTY],
    ['failed', EMPTY],
  ])('%s with no known size is %j', (state, fill) => {
    const totals: Array<number | null> = [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const bytesTotal of totals) {
      const model = laneModel(file({ state, bytesDone: 5, bytesTotal }), undefined);
      expect(model).toMatchObject({ form: 'single', fill });
    }
    // A count that is not a number is not known either (OD-2).
    for (const bytesDone of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(laneModel(file({ state, bytesDone, bytesTotal: 200 }), undefined)).toMatchObject({ form: 'single', fill });
    }
  });

  it.each<[JobState, Tone]>([
    ['queued', 'waiting'],
    ['probing', 'waiting'],
    ['downloading', 'active'],
    ['paused', 'paused'],
    ['failed', 'failed'],
  ])('%s with a size is "known", never "full" (also above 100%%)', (state, tone) => {
    expect(laneModel(file({ state, bytesDone: 0, bytesTotal: 200 }), undefined)).toEqual(single(known(0), tone));
    expect(laneModel(file({ state, bytesDone: 200, bytesTotal: 200 }), undefined)).toEqual(single(known(1), tone));
    expect(laneModel(file({ state, bytesDone: 300, bytesTotal: 200 }), undefined)).toEqual(single(known(1), tone));
    expect(laneModel(file({ state, bytesDone: -5, bytesTotal: 200 }), undefined)).toEqual(single(known(0), tone));
  });

  it('the current stream of a pair has the same fill rule: unknown while downloading, else empty', () => {
    expect(laneModel(media({ state: 'downloading' }), stream('video'))).toEqual(pair(lane(UNKNOWN, 'active'), lane(EMPTY, 'waiting')));
    expect(laneModel(media({ state: 'downloading' }), stream('audio'))).toEqual(pair(lane(FULL, 'active'), lane(UNKNOWN, 'active')));
    expect(laneModel(media({ state: 'paused' }), stream('audio'))).toEqual(pair(lane(FULL, 'paused'), lane(EMPTY, 'paused')));
    expect(laneModel(media({ state: 'failed' }), stream('video'))).toEqual(pair(lane(EMPTY, 'failed'), lane(EMPTY, 'failed')));
  });
});

describe('rule 2: merge strands (derived)', () => {
  it.each<[string, Partial<Job>, 1 | 2]>([
    ['media best', { kind: 'media', quality: { kind: 'best' } }, 2],
    ['media max 720', { kind: 'media', quality: MAX_720 }, 2],
    ['media quality null', { kind: 'media', quality: null }, 2],
    ['media audio m4a', { kind: 'media', quality: AUDIO_M4A }, 1],
    ['media audio mp3', { kind: 'media', quality: AUDIO_MP3 }, 1],
    ['file (quality null)', { kind: 'file', quality: null }, 1],
    ['file that carries a best quality', { kind: 'file', quality: { kind: 'best' } }, 1],
    ['file that carries a max quality', { kind: 'file', quality: MAX_720 }, 1],
  ])('%s merges with %i strand(s), whatever the counts and the live entry', (_label, over, strands) => {
    for (const live of [undefined, stream('video'), stream('audio'), makeLive({ segments: [1, 0], connections: 3 })]) {
      expect(laneModel(makeJob({ ...over, state: 'merging', bytesDone: 50, bytesTotal: 200 }), live)).toEqual(merge(strands));
      expect(laneModel(makeJob({ ...over, state: 'merging' }), live)).toEqual(merge(strands));
    }
  });
});

describe('rule 3: segments (derived, with the promises of the plan)', () => {
  it('cells is the stored array itself: not copied and not changed', () => {
    const cells = [1, 0.5, 0];
    const entry = makeLive({ segments: cells, connections: 2 });
    const model = laneModel(file(dl), entry);
    expect(model.form).toBe('segments');
    if (model.form !== 'segments') return;
    expect(model.cells).toBe(cells);
    expect(cells).toEqual([1, 0.5, 0]);
    expect(entry.segments).toBe(cells);
  });

  it('cells are passed on unchanged: outside 0..1, and more than 24', () => {
    const wild = [2, -1, 0.5];
    const thirty = Array.from({ length: 30 }, (_v, i) => i / 30);
    for (const cells of [wild, thirty]) {
      const model = laneModel(file(dl), makeLive({ segments: cells }));
      expect(model).toEqual(segments(cells, null, 'active'));
      if (model.form === 'segments') expect(model.cells).toBe(cells);
    }
  });

  it('one cell is enough; no cell is not a map', () => {
    expect(laneModel(file(dl), makeLive({ segments: [0] }))).toEqual(segments([0], null, 'active'));
    expect(laneModel(file(dl), makeLive({ segments: [] }))).toEqual(single(known(0.25), 'active'));
  });

  it('a segments value that is not an array is not a map: the next rule decides', () => {
    const notArrays: unknown[] = [null, undefined, 'abc', 5, true, { length: 2, 0: 1, 1: 0 }, { 0: 1 }];
    for (const value of notArrays) {
      const entry = makeLive({ segments: value as number[] | null });
      expect(laneModel(file(dl), entry)).toEqual(single(known(0.25), 'active'));
      expect(laneModel(media(dl), { ...entry, stream: 'video' })).toEqual(pair(lane(known(0.25), 'active'), lane(EMPTY, 'waiting')));
    }
  });

  it('a missing segments field is the same as null (L10)', () => {
    expect(laneModel(file(dl), {} as JobLive)).toEqual(single(known(0.25), 'active'));
    expect(laneModel(file(dl), { connections: 4 } as JobLive)).toEqual(single(known(0.25), 'active'));
  });

  it.each<[JobState, Tone]>([
    ['queued', 'waiting'],
    ['probing', 'waiting'],
    ['downloading', 'active'],
    ['paused', 'paused'],
    ['failed', 'failed'],
  ])('holds in %s, with the job tone; the count is kept only while downloading', (state, tone) => {
    const connections = state === 'downloading' ? 8 : null;
    for (const make of [file, media]) {
      const entry = makeLive({ segments: [1, 0], connections: 8 });
      expect(laneModel(make({ state, bytesDone: 50, bytesTotal: 200 }), entry)).toEqual(segments([1, 0], connections, tone));
      // It does not need a size.
      expect(laneModel(make({ state }), entry)).toEqual(segments([1, 0], connections, tone));
    }
  });

  it('rule 3 comes before rule 4 for both streams, for a video job and for an audio job', () => {
    for (const role of ['video', 'audio', 'muxed'] as const) {
      const entry = makeLive({ stream: role, segments: [1, 0] });
      expect(laneModel(media(dl), entry)).toEqual(segments([1, 0], null, 'active'));
      expect(laneModel(media({ ...dl, quality: AUDIO_M4A }), entry)).toEqual(segments([1, 0], null, 'active'));
    }
  });

  it('rule 2 comes before rule 3: merging, done and skipped ignore the segments', () => {
    const entry = makeLive({ segments: [1, 0], connections: 4 });
    expect(laneModel(media({ state: 'merging' }), entry)).toEqual(merge(2));
    expect(laneModel(file({ state: 'merging' }), entry)).toEqual(merge(1));
    expect(laneModel(file({ state: 'done' }), entry)).toEqual(NONE);
    expect(laneModel(file({ state: 'skipped' }), entry)).toEqual(NONE);
  });

  it('connections: the number is kept while downloading (0 stays 0), null and a missing field give null', () => {
    const connectionsOf = (connections: number | null | undefined): number | null | 'not segments' => {
      const model = laneModel(file(dl), makeLive({ segments: [1], connections: connections as number | null }));
      return model.form === 'segments' ? model.connections : 'not segments';
    };
    expect(connectionsOf(8)).toBe(8);
    expect(connectionsOf(1)).toBe(1);
    expect(connectionsOf(0)).toBe(0);
    expect(connectionsOf(null)).toBeNull();
    expect(connectionsOf(undefined)).toBeNull();
  });
});

describe('rule 4: pair (derived)', () => {
  it('a video job on the video stream and on the audio stream', () => {
    expect(laneModel(media(dl), stream('video'))).toEqual(pair(lane(known(0.25), 'active'), lane(EMPTY, 'waiting')));
    expect(laneModel(media(dl), stream('audio'))).toEqual(pair(lane(FULL, 'active'), lane(known(0.25), 'active')));
  });

  it.each([AUDIO_M4A, AUDIO_MP3])('an audio-only job (%j) is one lane on every stream value', (quality) => {
    for (const live of [undefined, stream(null), stream('video'), stream('audio'), stream('muxed'), stream(OTHER)]) {
      expect(laneModel(media({ ...dl, quality }), live)).toEqual(single(known(0.25), 'active'));
    }
  });

  it('a file is one lane on every stream value', () => {
    for (const live of [undefined, stream(null), stream('video'), stream('audio'), stream('muxed'), stream(OTHER)]) {
      expect(laneModel(file(dl), live)).toEqual(single(known(0.25), 'active'));
    }
  });

  it.each<StreamRole | null>([null, 'muxed', OTHER, '' as unknown as StreamRole, 'Video' as unknown as StreamRole, 'AUDIO' as unknown as StreamRole])(
    'a stream that is not video or audio (%j) gives one lane',
    (role) => {
      expect(laneModel(media(dl), stream(role))).toEqual(single(known(0.25), 'active'));
    },
  );

  it('an entry with no stream field is one lane (L10)', () => {
    expect(laneModel(media(dl), {} as JobLive)).toEqual(single(known(0.25), 'active'));
    expect(laneModel(media(dl), { connections: 3 } as JobLive)).toEqual(single(known(0.25), 'active'));
  });

  it('the pair works for every quality that is not audio, and for a missing quality', () => {
    for (const quality of [{ kind: 'best' } as Quality, MAX_720, null]) {
      expect(laneModel(media({ ...dl, quality }), stream('video'))).toEqual(pair(lane(known(0.25), 'active'), lane(EMPTY, 'waiting')));
    }
  });

  it('the audio lane waits only when the job is active: probing, queued, paused, failed keep their own tone', () => {
    const idle = (state: JobState): Tone | undefined => {
      const model = laneModel(media({ state }), stream('video'));
      return model.form === 'pair' ? model.audio.tone : undefined;
    };
    expect(idle('downloading')).toBe('waiting');
    expect(idle('queued')).toBe('waiting');
    expect(idle('probing')).toBe('waiting');
    expect(idle('paused')).toBe('paused');
    expect(idle('failed')).toBe('failed');
  });
});

describe('invariants over every combination (derived)', () => {
  const lives: Array<JobLive | undefined> = [
    undefined,
    makeLive(),
    stream('video'),
    stream('audio'),
    stream('muxed'),
    stream(OTHER),
    makeLive({ segments: [1, 0.5], connections: 3 }),
    makeLive({ segments: [], connections: 3 }),
    makeLive({ stream: 'video', segments: [1], connections: 0 }),
    makeLive({ stream: 'audio', segments: null, connections: 5 }),
  ];
  const counts: Array<[number, number | null]> = [
    [0, null],
    [50, 200],
    [300, 200],
    [-5, 200],
    [Number.NaN, 200],
    [50, Number.POSITIVE_INFINITY],
  ];
  const qualities: Array<Quality | null> = [{ kind: 'best' }, MAX_720, AUDIO_M4A, null];

  function forEveryInput(visit: (job: Job, live: JobLive | undefined) => void): void {
    for (const state of STATES) {
      for (const kind of ['media', 'file'] as const) {
        for (const quality of qualities) {
          for (const live of lives) {
            for (const [bytesDone, bytesTotal] of counts) visit(makeJob({ state, kind, quality, bytesDone, bytesTotal }), live);
          }
        }
      }
    }
  }

  const TONES: Tone[] = ['active', 'waiting', 'paused', 'failed'];
  const TONE_OF: Partial<Record<JobState, Tone>> = { queued: 'waiting', probing: 'waiting', downloading: 'active', paused: 'paused', failed: 'failed' };

  it('the form follows the rules, each lane has a valid fill and tone, and nothing is changed', () => {
    let seen = 0;
    forEveryInput((job, live) => {
      seen += 1;
      const jobBefore = structuredClone(job);
      const liveBefore = structuredClone(live);
      const model = laneModel(job, live);
      expect(job).toEqual(jobBefore);
      expect(live).toEqual(liveBefore);

      if (job.state === 'done' || job.state === 'skipped') {
        expect(model).toEqual(NONE);
        return;
      }
      if (job.state === 'merging') {
        expect(model).toEqual(merge(job.kind === 'media' && job.quality?.kind !== 'audio' ? 2 : 1));
        return;
      }
      const tone = TONE_OF[job.state] as Tone;
      const cells = live?.segments;
      const hasMap = Array.isArray(cells) && cells.length >= 1;
      const canPair = job.kind === 'media' && job.quality?.kind !== 'audio' && (live?.stream === 'video' || live?.stream === 'audio');
      const fills: Fill[] = [];
      if (hasMap) {
        expect(model.form).toBe('segments');
        if (model.form === 'segments') {
          expect(model.cells).toBe(cells);
          expect(model.tone).toBe(tone);
          expect(model.connections).toBe(job.state === 'downloading' ? (live?.connections ?? null) : null);
        }
      } else if (canPair) {
        expect(model.form).toBe('pair');
        if (model.form === 'pair') {
          fills.push(model.video.fill, model.audio.fill);
          for (const l of [model.video, model.audio]) expect(TONES).toContain(l.tone);
        }
      } else {
        expect(model.form).toBe('single');
        if (model.form === 'single') {
          fills.push(model.fill);
          expect(model.tone).toBe(tone);
        }
      }
      for (const fill of fills) {
        expect(['known', 'unknown', 'empty', 'full']).toContain(fill.kind);
        if (fill.kind === 'known') {
          expect(fill.fraction).toBeGreaterThanOrEqual(0);
          expect(fill.fraction).toBeLessThanOrEqual(1);
        }
      }
    });
    expect(seen).toBe(8 * 2 * 4 * 10 * 6);
  });

  it('"full" is never made from a number: only the video lane of a pair on the audio stream is full', () => {
    forEveryInput((job, live) => {
      const model = laneModel(job, live);
      if (model.form === 'single') expect(model.fill.kind).not.toBe('full');
      if (model.form === 'pair') {
        expect(model.audio.fill.kind).not.toBe('full');
        if (model.video.fill.kind === 'full') expect(live?.stream).toBe('audio');
      }
    });
  });
});
