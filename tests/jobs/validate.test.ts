import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyQuality, isAbsoluteDir, isLangList, isQuality, isUsableDoneName, normalizeSettings, parseSettings, parseSnapshotFile } from '../../src/main/jobs/validate';
import { Store } from '../../src/main/jobs/store';
import { validateUrl } from '../../src/main/probe';
// Task T1 defines these two in src/shared/protocol.ts; M1's parseJob depends on them. Only the agreement test calls them.
import { isUserAgent, reduceReferer } from '../../src/shared/protocol';
import { HEIGHTS, type Group, type Job, type Quality, type Settings } from '../../src/shared/types';
import { makeJob, makeSettings } from '../helpers';

const group: Group = { id: 'g1', title: 'Course', url: 'https://example.com/list', dir: 'D:\\Dl\\Course', createdAt: 1 };

/** A job as the previous version wrote it: no `interrupted`, no `sourceHeight`. */
function oldJob(over: Record<string, unknown> = {}): Record<string, unknown> {
  const job: Record<string, unknown> = { ...makeJob({ id: 'j1', createdAt: 1 }) };
  delete job['interrupted'];
  delete job['sourceHeight'];
  return { ...job, ...over };
}

const file = (over: Record<string, unknown> = {}) => ({ version: 1, jobs: [oldJob(over)], groups: [] });
const parseOne = (over: Record<string, unknown> = {}): Job | undefined => parseSnapshotFile(file(over))?.jobs[0];

/** A job of kind `file`: its name is required. */
const fileJob = (over: Record<string, unknown> = {}) => oldJob({ kind: 'file', quality: null, baseName: null, fileName: 'a.zip', ...over });

/** Stands for "the key is not there at all" in a table of bad values. */
const MISSING = Symbol('missing');

/** `it.each` spreads an array row into several arguments; this keeps each value as one argument. */
const single = <T>(values: T[]): [T][] => values.map((v) => [v]);

function withField(base: Record<string, unknown>, field: string, value: unknown): Record<string, unknown> {
  const out = { ...base };
  if (value === MISSING) delete out[field];
  else out[field] = value;
  return out;
}

describe('parseSnapshotFile', () => {
  it('accepts a job written before this change and fills the new fields', () => {
    const parsed = parseSnapshotFile(file());
    expect(parsed?.jobs[0]).toEqual({ ...oldJob(), interrupted: false, sourceHeight: null });
  });

  it('keeps the new fields when they are there', () => {
    const job = makeJob({ state: 'paused', interrupted: true, sourceHeight: 1080 });
    expect(parseSnapshotFile({ version: 1, jobs: [job], groups: [] })?.jobs).toEqual([job]);
  });

  it('accepts a file job, a group member and a finished job', () => {
    const jobs: Job[] = [
      makeJob({ kind: 'file', quality: null, baseName: null, fileName: 'a.zip', state: 'done' }),
      makeJob({ groupId: 'g1', index: 3, state: 'done', fileName: '03 - Intro.mp4', actualHeight: 720 }),
      makeJob({ state: 'failed', reason: 'disk full', attempts: 3, bytesTotal: 100, eta: 4, speed: 10 }),
    ];
    expect(parseSnapshotFile({ version: 1, jobs, groups: [group] })).toEqual({ jobs, groups: [group] });
  });

  describe('fields that stay strict', () => {
    const STRICT: [string, Record<string, unknown>][] = [
      ['an unknown state', { state: 'finished' }],
      ['a state that is not text', { state: 3 }],
      ['an unknown kind', { kind: 'torrent' }],
      ['an unknown kind with everything else shaped like a file job', { kind: 'torrent', quality: null, baseName: null, fileName: 'a.zip' }],
      ['a kind that is not text', { kind: null }],
      ['an empty id', { id: '' }],
      ['an id that is not a string', { id: 7 }],
      ['a group that is not listed', { groupId: 'ghost' }],
      ['a group id that is not a string', { groupId: 5 }],
      ['a url that is not http', { url: 'file:///C:/x' }],
      ['a url that is not a string', { url: 5 }],
      ['a null url', { url: null }],
      ['an empty url on a queued job', { url: '' }],
      ['a title that is not a string', { title: null }],
      ['a reason that is not a string', { reason: 5 }],
      ['an impossible quality', { quality: { kind: 'max', height: 999 } }],
      ['a media job without a quality', { quality: null }],
      ['a subtitle language that is an option', { subtitleLangs: ['--exec'] }],
      ['subtitle languages that are not a list', { subtitleLangs: 'en' }],
      ['eleven subtitle languages', { subtitleLangs: Array.from({ length: 11 }, () => 'en') }],
      ['a relative folder', { dir: 'relative' }],
      ['a folder that is not a string', { dir: 5 }],
      ['resumable as text', { resumable: 'yes' }],
      ['negative attempts', { attempts: -1 }],
      ['fractional attempts', { attempts: 0.5 }],
      ['attempts as text', { attempts: '3' }],
      ['null attempts', { attempts: null }],
    ];

    it.each(STRICT)('rejects %s', (_name, over) => {
      expect(parseSnapshotFile(file(over))).toBeNull();
    });

    // A skipped placeholder may carry any url (A2), and nothing else about it is looser.
    const URL_ROWS = new Set(['a url that is not http', 'an empty url on a queued job']);
    it.each(STRICT.filter(([name]) => !URL_ROWS.has(name)))('rejects %s on a skipped job too', (_name, over) => {
      expect(parseSnapshotFile(file({ state: 'skipped', reason: 'private', url: '', ...over }))).toBeNull();
    });

    it('accepts ten subtitle languages and zero attempts', () => {
      expect(parseOne({ subtitleLangs: Array.from({ length: 10 }, () => 'en'), attempts: 0 })).toBeDefined();
    });

    it.each(['id', 'groupId', 'kind', 'url', 'title', 'state', 'reason', 'quality', 'subtitleLangs', 'dir', 'baseName', 'fileName', 'index', 'resumable', 'attempts', 'createdAt'])(
      'rejects a job without %s',
      (field) => {
        const job = oldJob();
        delete job[field];
        expect(parseSnapshotFile({ version: 1, jobs: [job], groups: [] })).toBeNull();
      },
    );

    it('rejects a job with only an id and a state', () => {
      expect(parseSnapshotFile({ version: 1, jobs: [{ id: 'j1', state: 'done' }], groups: [] })).toBeNull();
    });

    it('rejects a file job with a quality', () => {
      expect(parseSnapshotFile(file(fileJob({ quality: { kind: 'best' } })))).toBeNull();
    });

    it('rejects a file job with a base name', () => {
      expect(parseSnapshotFile(file(fileJob({ baseName: 'a' })))).toBeNull();
    });

    it('rejects a file job without a file name', () => {
      expect(parseSnapshotFile(file(fileJob({ fileName: null })))).toBeNull();
    });

    it('rejects two jobs with one id', () => {
      expect(parseSnapshotFile({ version: 1, jobs: [oldJob(), oldJob()], groups: [] })).toBeNull();
    });

    it('rejects the whole file when one job of many is bad', () => {
      const jobs = [oldJob({ id: 'a' }), oldJob({ id: 'b', state: 'finished' }), oldJob({ id: 'c' })];
      expect(parseSnapshotFile({ version: 1, jobs, groups: [] })).toBeNull();
    });
  });

  describe('index, attempts and createdAt (A7)', () => {
    it.each<[string, number]>([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['-1', -1],
      ['0', 0],
      ['a fraction', 1.5],
    ])('rejects an index of %s', (_name, index) => {
      expect(parseSnapshotFile(file({ index }))).toBeNull();
    });

    it('rejects an index that is not a number', () => {
      expect(parseSnapshotFile(file({ index: '1' }))).toBeNull();
      expect(parseSnapshotFile(file({ index: {} }))).toBeNull();
    });

    it.each([null, 1, 2, 120])('accepts an index of %s', (index) => {
      expect(parseOne({ index })?.index).toBe(index);
    });

    it.each<[string, number]>([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
    ])('rejects attempts of %s', (_name, attempts) => {
      expect(parseSnapshotFile(file({ attempts }))).toBeNull();
    });

    it.each([0, 1, 3])('accepts attempts of %s', (attempts) => {
      expect(parseOne({ attempts })?.attempts).toBe(attempts);
    });

    it.each<[string, unknown]>([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['text', '5'],
      ['null', null],
      ['missing', MISSING],
    ])('rejects a creation time of %s', (_name, createdAt) => {
      expect(parseSnapshotFile({ version: 1, jobs: [withField(oldJob(), 'createdAt', createdAt)], groups: [] })).toBeNull();
    });

    it.each([0, 1, 1_700_000_000_000])('accepts a creation time of %s', (createdAt) => {
      expect(parseOne({ createdAt })?.createdAt).toBe(createdAt);
    });
  });

  describe('url of a skipped job (A2)', () => {
    it('accepts a skipped placeholder with an empty url', () => {
      expect(parseOne({ state: 'skipped', reason: 'unavailable', url: '' })?.url).toBe('');
    });

    it.each(['opaque-video-id', 'abc123', 'file:///C:/x', 'not a url at all'])('accepts a skipped job with the url %j', (url) => {
      const parsed = parseOne({ state: 'skipped', reason: 'private', url });
      expect(parsed).toMatchObject({ state: 'skipped', url });
    });

    it.each<[string, unknown]>([
      ['null', null],
      ['a number', 5],
      ['missing', MISSING],
    ])('rejects a skipped job whose url is %s', (_name, url) => {
      expect(parseSnapshotFile({ version: 1, jobs: [withField(oldJob({ state: 'skipped' }), 'url', url)], groups: [] })).toBeNull();
    });

    it.each(['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed'] as const)('rejects a %s job with a url that is not http', (state) => {
      const over = { state, fileName: state === 'done' ? 'a.mp4' : null };
      expect(parseSnapshotFile(file({ ...over, url: 'opaque-video-id' }))).toBeNull();
      expect(parseSnapshotFile(file({ ...over, url: '' }))).toBeNull();
      expect(parseSnapshotFile(file({ ...over, url: 'https://example.com/v' }))).not.toBeNull();
    });

    it('rejects a queued job with the bare id a skipped job may carry', () => {
      expect(parseSnapshotFile(file({ state: 'queued', url: 'opaque-video-id' }))).toBeNull();
    });

    it.each(['http://example.com/v', 'https://example.com/watch?v=1', 'HTTPS://EXAMPLE.COM/V', 'http://localhost:8080/x'])('accepts the url %s on a queued job', (url) => {
      expect(parseOne({ state: 'queued', url })?.url).toBe(url);
    });

    it.each(['ftp://example.com/a.zip', 'javascript:alert(1)', 'data:text/plain,hi', 'mailto:a@b.c', 'example.com/v', '//example.com/x', 'https://', 'abc123'])(
      'rejects the url %j on a queued job',
      (url) => {
        expect(parseSnapshotFile(file({ state: 'queued', url }))).toBeNull();
      },
    );
  });

  describe('base name', () => {
    const BAD_BASE_NAMES: [string, string][] = [
      ['a slash', 'a/b'],
      ['a backslash', 'a\\b'],
      ['a colon', 'a:b'],
      ['an asterisk', 'a*b'],
      ['a question mark', 'a?b'],
      ['a double quote', 'a"b'],
      ['a less-than sign', 'a<b'],
      ['a greater-than sign', 'a>b'],
      ['a pipe', 'a|b'],
      ['a null character', 'a\u0000b'],
      ['a tab', 'a\tb'],
      ['a newline', 'a\nb'],
      ['a unit separator', 'a\u001fb'],
      ['a delete character', 'a\u007fb'],
      ['a trailing dot', 'a.'],
      ['only a dot', '.'],
      ['only dots', '..'],
      ['a trailing space', 'a '],
      ['only a space', ' '],
      ['an empty text', ''],
      ['201 characters', 'a'.repeat(201)],
    ];

    it.each(BAD_BASE_NAMES)('rejects a base name with %s', (_name, baseName) => {
      expect(parseSnapshotFile(file({ baseName }))).toBeNull();
    });

    it.each(BAD_BASE_NAMES)('rejects a base name with %s on a skipped job too', (_name, baseName) => {
      expect(parseSnapshotFile(file({ state: 'skipped', reason: 'private', url: '', baseName }))).toBeNull();
    });

    it.each<[string, unknown]>([
      ['a number', 5],
      ['null on a media job', null],
      ['a list', ['a']],
    ])('rejects a base name that is %s', (_name, baseName) => {
      expect(parseSnapshotFile(file({ baseName }))).toBeNull();
    });

    it.each(['a', 'Video', '03 - Intro (2)', 'a.b', ' leading space', 'ملف عربي', 'a'.repeat(200)])('accepts the base name %j', (baseName) => {
      expect(parseOne({ baseName })?.baseName).toBe(baseName);
    });
  });

  describe('stored file name (A1, A7)', () => {
    const FOLDER_ESCAPES: [string, unknown][] = [
      ['an empty name', ''],
      ['a single dot', '.'],
      ['two dots', '..'],
      ['a backslash', 'a\\b'],
      ['a slash', 'a/b'],
      ['a colon', 'a:b'],
      ['an alternate data stream', 'report.txt:payload'],
      ['a path up', '..\\evil.exe'],
      ['a leading slash', '/a'],
      ['a null character', 'a\u0000b'],
      ['a tab', 'a\tb'],
      ['a newline', 'a\nb'],
      ['a unit separator', 'a\u001fb'],
      ['a delete character', 'a\u007fb'],
      ['a number', 5],
      ['a list', ['a']],
    ];
    const kinds: [string, (name: unknown) => Record<string, unknown>][] = [
      ['media', (fileName) => oldJob({ state: 'done', fileName })],
      ['file', (fileName) => fileJob({ fileName })],
      ['skipped', (fileName) => oldJob({ state: 'skipped', reason: 'private', url: '', fileName })],
    ];

    it.each(kinds.flatMap(([kind, make]) => FOLDER_ESCAPES.map(([name, value]) => [kind, name, make, value] as const)))(
      'rejects a %s job whose file name is %s',
      (_kind, _name, make, value) => {
        expect(parseSnapshotFile({ version: 1, jobs: [make(value)], groups: [] })).toBeNull();
      },
    );

    it.each(
      kinds.flatMap(([kind, make]) =>
        [
          ['150 characters, a dot and 150 more', 'a'.repeat(150) + '.' + 'b'.repeat(150)],
          ['255 characters', 'a'.repeat(255)],
          ['256 characters', 'a'.repeat(256)],
          ['1000 characters', 'a'.repeat(1000)],
        ].map(([name, value]) => [kind, name, make, value] as const),
      ),
    )('keeps the file name of a %s job unchanged at %s (no length cap)', (_kind, _name, make, value) => {
      const parsed = parseSnapshotFile({ version: 1, jobs: [make(value)], groups: [] });
      expect(parsed?.jobs[0]?.fileName).toBe(value);
    });

    it.each(['CON', 'nul.txt', 'a.', 'a ', 'a*b?.txt', 'say "hi" <now> | later.mp4', 'report (2).pdf', 'ملف.pdf'])(
      'accepts the persisted name %j (only a name that leaves its folder is refused)',
      (fileName) => {
        expect(parseOne({ id: 'a', kind: 'file', quality: null, baseName: null, fileName })?.fileName).toBe(fileName);
        expect(parseOne({ id: 'b', state: 'done', fileName })?.fileName).toBe(fileName);
      },
    );

    it('accepts a media job without a file name yet', () => {
      expect(parseOne({ fileName: null })?.fileName).toBeNull();
    });

    // Ruling 4a: the stored-name rule did not change. A list written earlier with a name of
    // dots or spaces still loads; only a new `done` event is refused such a name (isUsableDoneName).
    it.each(['...', '....', '   ', '. .', ' . ', ' '])('still loads the stored name %j, so an old list is not set aside (4a)', (fileName) => {
      expect(parseOne({ id: 'a', kind: 'file', quality: null, baseName: null, fileName })?.fileName).toBe(fileName);
      expect(parseOne({ id: 'b', state: 'done', fileName })?.fileName).toBe(fileName);
      expect(parseOne({ id: 'c', state: 'skipped', reason: 'private', url: '', fileName })?.fileName).toBe(fileName);
    });
  });

  describe('meters never invalidate a file (A3)', () => {
    const METERS_OK = { bytesDone: 50, bytesTotal: 100, speed: 7, eta: 9, actualHeight: 720, sourceHeight: 1080 };
    type Meter = keyof typeof METERS_OK;
    const NEUTRAL: Record<Meter, number | null> = { bytesDone: 0, bytesTotal: null, speed: 0, eta: null, actualHeight: null, sourceHeight: null };
    const METERS = Object.keys(METERS_OK) as Meter[];

    const NOT_A_NUMBER: [string, unknown][] = [
      ['missing', MISSING],
      ['null', null],
      ['text', '5'],
      ['empty text', ''],
      ['true', true],
      ['an object', {}],
      ['a list', [5]],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
    ];
    const OUT_OF_RANGE: Record<Meter, [string, unknown][]> = {
      bytesDone: [['-1', -1]],
      speed: [['-1', -1]],
      bytesTotal: [['-1', -1]],
      eta: [['-5', -5]],
      actualHeight: [
        ['0', 0],
        ['-1', -1],
      ],
      sourceHeight: [
        ['0', 0],
        ['-1', -1],
      ],
    };
    const bad = METERS.flatMap((field) => [...NOT_A_NUMBER, ...OUT_OF_RANGE[field]].map(([name, value]) => [field, name, value] as const));

    it.each(bad)('loads %s as its neutral value when it is %s', (field, _name, value) => {
      const parsed = parseSnapshotFile({ version: 1, jobs: [withField(oldJob(METERS_OK), field, value)], groups: [] });
      expect(parsed).not.toBeNull();
      expect(parsed?.jobs[0]).toEqual({ ...oldJob(METERS_OK), interrupted: false, [field]: NEUTRAL[field] });
    });

    it.each<[Meter, number | null]>([
      ['bytesDone', 0],
      ['bytesDone', 1],
      ['bytesDone', 0.5],
      ['bytesDone', Number.MAX_VALUE],
      ['speed', 0],
      ['speed', 1],
      ['speed', 0.5],
      ['speed', Number.MAX_VALUE],
      ['bytesTotal', 0],
      ['bytesTotal', 1],
      ['bytesTotal', null],
      ['eta', 0],
      ['eta', 1],
      ['eta', 0.5],
      ['eta', null],
      ['actualHeight', Number.MIN_VALUE],
      ['actualHeight', 0.5],
      ['actualHeight', 1],
      ['actualHeight', 4320],
      ['actualHeight', null],
      ['sourceHeight', Number.MIN_VALUE],
      ['sourceHeight', 0.5],
      ['sourceHeight', 1],
      ['sourceHeight', 4320],
      ['sourceHeight', null],
    ])('keeps %s at %s', (field, value) => {
      const parsed = parseSnapshotFile({ version: 1, jobs: [withField(oldJob(METERS_OK), field, value)], groups: [] });
      expect(parsed?.jobs[0]).toEqual({ ...oldJob(METERS_OK), interrupted: false, [field]: value });
    });

    const ALL_BAD = { bytesDone: '5', bytesTotal: -2, speed: null, eta: -5, actualHeight: 0, sourceHeight: -1 };
    const ALL_NEUTRAL = { bytesDone: 0, bytesTotal: null, speed: 0, eta: null, actualHeight: null, sourceHeight: null };

    it('loads the examples of the plan: eta -5, actualHeight 0, bytesDone "5", speed null, sourceHeight -1', () => {
      expect(parseOne({ eta: -5 })?.eta).toBeNull();
      expect(parseOne({ actualHeight: 0 })?.actualHeight).toBeNull();
      expect(parseOne({ bytesDone: '5' })?.bytesDone).toBe(0);
      expect(parseOne({ speed: null })?.speed).toBe(0);
      expect(parseOne({ sourceHeight: -1 })?.sourceHeight).toBeNull();
    });

    it.each(['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped'] as const)('normalizes all six meters of a %s job at once', (state) => {
      const parsed = parseOne({ ...ALL_BAD, state, fileName: state === 'done' ? 'a.mp4' : null });
      expect(parsed).toMatchObject({ state, ...ALL_NEUTRAL });
    });

    it('normalizes the meters of a file job too', () => {
      expect(parseSnapshotFile(file(fileJob(ALL_BAD)))?.jobs[0]).toMatchObject(ALL_NEUTRAL);
    });

    it('normalizes in a file without a version', () => {
      const parsed = parseSnapshotFile({ jobs: [oldJob(ALL_BAD)], groups: [] });
      expect(parsed?.jobs[0]).toMatchObject(ALL_NEUTRAL);
    });

    it('normalizes the jobs after the first one as well', () => {
      const jobs = [oldJob({ id: 'a' }), oldJob({ id: 'b', ...ALL_BAD }), oldJob({ id: 'c', eta: -5 })];
      const parsed = parseSnapshotFile({ version: 1, jobs, groups: [] });
      expect(parsed?.jobs.map((j) => [j.id, j.bytesDone, j.eta])).toEqual([
        ['a', 0, null],
        ['b', 0, null],
        ['c', 0, null],
      ]);
    });

    it('still rejects a job whose other fields are bad, whatever its meters are', () => {
      expect(parseSnapshotFile(file({ ...ALL_BAD, attempts: -1 }))).toBeNull();
      expect(parseSnapshotFile(file({ eta: -5, id: '' }))).toBeNull();
      expect(parseSnapshotFile(file({ actualHeight: 0, dir: 'relative' }))).toBeNull();
      expect(parseSnapshotFile(file({ speed: Number.NaN, state: 'finished' }))).toBeNull();
    });
  });

  describe('interrupted (A5)', () => {
    it('reads an absent interrupted as false', () => {
      expect(parseOne()?.interrupted).toBe(false);
    });

    it.each([true, false])('keeps interrupted %s', (interrupted) => {
      expect(parseOne({ state: 'paused', interrupted })?.interrupted).toBe(interrupted);
    });

    it.each<[string, unknown]>([
      ['null', null],
      ['1', 1],
      ['0', 0],
      ['"true"', 'true'],
      ['"false"', 'false'],
      ['an empty text', ''],
      ['a list', []],
      ['an object', {}],
    ])('rejects interrupted as %s', (_name, interrupted) => {
      expect(parseSnapshotFile(file({ interrupted }))).toBeNull();
    });
  });

  describe('Quality is rebuilt from its declared fields (A6)', () => {
    const rows: [string, Record<string, unknown>, Quality][] = [
      ['best with an extra key', { kind: 'best', extra: 123 }, { kind: 'best' }],
      ['best with a height', { kind: 'best', height: 720 }, { kind: 'best' }],
      ['max with an extra key', { kind: 'max', height: 720, extra: 'x' }, { kind: 'max', height: 720 }],
      ['max with a format', { kind: 'max', height: 720, format: 'mp3' }, { kind: 'max', height: 720 }],
      ['audio with an extra key', { kind: 'audio', format: 'm4a', extra: true }, { kind: 'audio', format: 'm4a' }],
      ['audio with a height', { kind: 'audio', format: 'mp3', height: 720 }, { kind: 'audio', format: 'mp3' }],
    ];

    it.each(rows)('in a job: %s', (_name, quality, expected) => {
      expect(parseOne({ quality })?.quality).toStrictEqual(expected);
    });

    it.each(rows)('in the settings: %s', (_name, defaultQuality, expected) => {
      const defaults = makeSettings({ defaultQuality: { kind: 'audio', format: 'm4a' } });
      expect(parseSettings({ defaultQuality }, defaults).defaultQuality).toStrictEqual(expected);
    });

    it('comes back untouched when it has nothing extra', () => {
      for (const quality of [{ kind: 'best' }, { kind: 'max', height: 1080 }, { kind: 'audio', format: 'mp3' }]) {
        expect(parseOne({ quality })?.quality).toStrictEqual(quality);
      }
    });

    it('does not share the quality object with its input', () => {
      const quality = { kind: 'max', height: 720 };
      const parsed = parseOne({ quality });
      quality.height = 360;
      expect(parsed?.quality).toStrictEqual({ kind: 'max', height: 720 });

      const defaultQuality = { kind: 'max', height: 720 };
      const settings = parseSettings({ defaultQuality }, makeSettings());
      defaultQuality.height = 360;
      expect(settings.defaultQuality).toStrictEqual({ kind: 'max', height: 720 });
    });
  });

  describe('what it builds', () => {
    it('drops unknown keys of a job', () => {
      const parsed = parseOne({ mystery: 1, speedKbps: 5 });
      expect(parsed).not.toHaveProperty('mystery');
      expect(parsed).not.toHaveProperty('speedKbps');
      expect(Object.keys(parsed ?? {}).sort()).toEqual(Object.keys(makeJob()).sort());
    });

    it('keeps a referenced group and drops its unknown key (A7)', () => {
      const parsed = parseSnapshotFile({ version: 1, jobs: [oldJob({ groupId: 'g1' })], groups: [{ ...group, extra: true }] });
      expect(parsed).not.toBeNull();
      expect(parsed?.groups).toStrictEqual([group]);
    });

    it('does not keep a reference to what it was given', () => {
      const raw = { version: 1, jobs: [oldJob({ groupId: 'g1', subtitleLangs: ['en'] })], groups: [{ ...group }] };
      const parsed = parseSnapshotFile(raw);
      const rawJob = raw.jobs[0] as Record<string, unknown>;
      rawJob['title'] = 'changed';
      (rawJob['subtitleLangs'] as string[]).push('fr');
      (raw.groups[0] as Group).title = 'changed';
      expect(parsed?.jobs[0]).toMatchObject({ title: 'Video', subtitleLangs: ['en'] });
      expect(parsed?.groups[0]?.title).toBe('Course');
    });

    it('drops a group without members', () => {
      expect(parseSnapshotFile({ version: 1, jobs: [oldJob()], groups: [group] })?.groups).toEqual([]);
    });

    it('keeps a group with members', () => {
      expect(parseSnapshotFile({ version: 1, jobs: [oldJob({ groupId: 'g1' })], groups: [group] })?.groups).toEqual([group]);
    });
  });

  describe('groups', () => {
    /**
     * A bad group must make the file invalid whether or not a job uses it. Checked three ways, because a job
     * that names `g1` would be refused anyway when the bad group no longer has that id.
     */
    function expectGroupRejected(broken: Record<string, unknown>): void {
      expect(parseSnapshotFile({ version: 1, jobs: [oldJob({ groupId: 'g1' })], groups: [broken] }), 'used by a job').toBeNull();
      expect(parseSnapshotFile({ version: 1, jobs: [oldJob()], groups: [broken] }), 'used by no job').toBeNull();
      if (typeof broken['id'] === 'string') {
        expect(parseSnapshotFile({ version: 1, jobs: [oldJob({ groupId: broken['id'] })], groups: [broken] }), 'named by its own id').toBeNull();
      }
    }

    it.each<[string, Record<string, unknown>]>([
      ['an empty id', { id: '' }],
      ['an id that is not a string', { id: 5 }],
      ['a relative folder', { dir: 'Course' }],
      ['a folder that is not a string', { dir: 5 }],
      ['a title that is not a string', { title: 3 }],
      ['a url that is not a string', { url: null }],
      ['a creation time of text', { createdAt: 'x' }],
      ['a creation time of NaN', { createdAt: Number.NaN }],
      ['a creation time of Infinity', { createdAt: Number.POSITIVE_INFINITY }],
      ['a creation time of -Infinity', { createdAt: Number.NEGATIVE_INFINITY }],
      ['a null creation time', { createdAt: null }],
    ])('rejects a group with %s', (_name, over) => {
      expectGroupRejected({ ...group, ...over });
    });

    it.each(['id', 'title', 'url', 'dir', 'createdAt'])('rejects a group without %s', (field) => {
      const broken: Record<string, unknown> = { ...group };
      delete broken[field];
      expectGroupRejected(broken);
    });

    it.each(single<unknown>([null, 'x', 5, []]))('rejects a group that is %j', (broken) => {
      expect(parseSnapshotFile({ version: 1, jobs: [oldJob({ groupId: 'g1' })], groups: [broken] })).toBeNull();
    });

    it('accepts a group with an empty title and url, and a creation time of 0', () => {
      const odd = { ...group, title: '', url: '', createdAt: 0 };
      expect(parseSnapshotFile({ version: 1, jobs: [oldJob({ groupId: 'g1' })], groups: [odd] })?.groups).toEqual([odd]);
    });

    it('rejects two groups with one id', () => {
      expect(parseSnapshotFile({ version: 1, jobs: [oldJob({ groupId: 'g1' })], groups: [group, group] })).toBeNull();
    });

    it('rejects a bad group even when no job uses it', () => {
      expect(parseSnapshotFile({ version: 1, jobs: [oldJob()], groups: [{ ...group, dir: 'relative' }] })).toBeNull();
    });
  });

  it('rejects version 2 and accepts a missing version', () => {
    expect(parseSnapshotFile({ version: 2, jobs: [], groups: [] })).toBeNull();
    expect(parseSnapshotFile({ jobs: [], groups: [] })).toEqual({ jobs: [], groups: [] });
  });

  it.each([0, '1', null, 1.5])('rejects the version %j', (version) => {
    expect(parseSnapshotFile({ version, jobs: [], groups: [] })).toBeNull();
  });

  it.each(
    single<unknown>([null, [], 'x', 5, { jobs: 'nope', groups: [] }, { jobs: [], groups: {} }, { jobs: [null], groups: [] }, { jobs: [[]], groups: [] }, { jobs: [] }, { groups: [] }]),
  )('rejects the shape %j', (raw) => {
    expect(parseSnapshotFile(raw)).toBeNull();
  });
});

/**
 * M1 (A3, plan 3.2 "The migration"): Job gains referer, userAgent and oneShotLogin; jobs.json stays at version 1.
 * Plan lines cited below are in docs/plans/2026-11-24-phase2-a3-handoff.md.
 */
describe('referer, userAgent and oneShotLogin (A3, M1)', () => {
  /** The three fields M1 adds to Job (src/shared/types.ts). */
  const NEW_KEYS = ['referer', 'userAgent', 'oneShotLogin'] as const;
  /**
   * Every field a Job had before M1, as src/shared/types.ts lists them: 23. M1 must add the three above
   * and change how none of these is read.
   */
  const OLD_KEYS = [
    'id',
    'groupId',
    'kind',
    'url',
    'title',
    'state',
    'reason',
    'quality',
    'subtitleLangs',
    'dir',
    'baseName',
    'fileName',
    'index',
    'bytesDone',
    'bytesTotal',
    'speed',
    'eta',
    'actualHeight',
    'resumable',
    'attempts',
    'createdAt',
    'interrupted',
    'sourceHeight',
  ] as const;
  /** What each new key loads as when it is absent (plan line 153). */
  const DEFAULTS = { referer: null, userAgent: null, oneShotLogin: false };

  const R = 'https://a.example/p/q';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/158.0.0.0 Safari/537.36';
  const ORIGIN = 'https://a.example/';

  /** A job as a file written before M1 holds it: the three new keys are not there, whatever makeJob carries. */
  function stored(over: Record<string, unknown> = {}): Record<string, unknown> {
    const job: Record<string, unknown> = { ...makeJob({ id: 'j1', createdAt: 1, sourceHeight: 1080 }) };
    for (const key of NEW_KEYS) delete job[key];
    for (const [key, value] of Object.entries(over)) {
      if (value === MISSING) delete job[key];
      else job[key] = value;
    }
    return job;
  }
  const fileOf = (...jobs: Record<string, unknown>[]) => ({ version: 1, jobs, groups: [] });
  const parsedOf = (over: Record<string, unknown> = {}) => parseSnapshotFile(fileOf(stored(over)));
  const loadedJob = (over: Record<string, unknown> = {}): Job | undefined => parsedOf(over)?.jobs[0];
  const pick = (job: object | undefined, keys: readonly string[]): Record<string, unknown> =>
    Object.fromEntries(keys.map((k) => [k, (job as Record<string, unknown> | undefined)?.[k]]));

  /** U+0000 to U+001F and U+007F: C0 and DEL. */
  const CONTROL_CODES = [...Array.from({ length: 0x20 }, (_, i) => i), 0x7f];
  const codeLabel = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

  // ---- values ----

  // What the URL parser writes for the path of PA3-6b. Idempotent by construction, and the spec checks it: this
  // Node writes %5E for ^, an older one may not, so the stored value is the platform's own reduction.
  const PA36B_RAW = "https://a.example/a|b[c]'d^e/f%41g";
  const PA36B = new URL(PA36B_RAW).origin + new URL(PA36B_RAW).pathname;

  const VALID_REFERERS: [string, string][] = [
    ['an https page', R],
    ['the origin with its slash', ORIGIN],
    ['an http page', 'http://a.example/p'],
    ['a host with a port', 'http://localhost:8080/x'],
    ['an IPv6 host', 'http://[::1]:8080/x'],
    ['a percent-encoded quote, %22', 'https://a.example/a%22b'],
    ['a percent-encoded non-ASCII letter', 'https://a.example/%C3%A9'],
    ['the path of PA3-6b as the URL parser writes it', PA36B],
    ['exactly 2048 UTF-16 units', ORIGIN + 'a'.repeat(2048 - ORIGIN.length)],
  ];

  /**
   * Plan line 155: a stored Referer is kept when v === reduceReferer(v), and reduceReferer (line 180) returns
   * origin + pathname of the parsed URL, or null. So a query, a hash, a quote, a control character, userinfo,
   * another scheme, an unparsable text, and any text that is not already its own reduction, are all "present,
   * invalid" (line 156) and load as null. The file is not set aside for these.
   */
  const BAD_REFERERS: [string, unknown][] = [
    // wrong type
    ['a number', 5],
    ['true', true],
    ['false', false],
    ['an object', {}],
    ['a list', [R]],
    ['an empty list', []],
    // not a URL, or not http(s)
    ['an empty text', ''],
    ['a relative path', '/p/q'],
    ['a host with no scheme', 'a.example/p'],
    ['a bare word', 'x'],
    ['ftp', 'ftp://a.example/p'],
    ['a javascript link', 'javascript:alert(1)'],
    ['a data link', 'data:text/plain,hi'],
    ['a file link', 'file:///C:/x'],
    ['a websocket link', 'ws://a.example/p'],
    // userinfo
    ['userinfo with a name', 'https://user@a.example/p'],
    ['userinfo with a name and a password', 'https://user:pw@a.example/p'],
    // a query
    ['a query', 'https://a.example/p?token=1'],
    ['a bare question mark', 'https://a.example/p?'],
    ['a query on the origin', 'https://a.example/?x'],
    // a hash: reduceReferer keeps origin + pathname only (plan lines 180 and 192), so v !== reduceReferer(v)
    ['a hash', 'https://a.example/p#frag'],
    ['a bare hash mark', 'https://a.example/p#'],
    ['a query and a hash (the example of Task T1)', 'https://a.example/p/q?token=1#f'],
    // a double quote
    ['a double quote in the path', 'https://a.example/a"b'],
    ['a double quote at the end', 'https://a.example/"'],
    ['a double quote around the whole text', '"https://a.example/p"'],
    // `"` is a legal host character for the URL parser, so origin + pathname keeps it raw unless the explicit
    // check rejects it (plan line 182, A3-Q24); a fullwidth quote is mapped to `"` in a host.
    ['a double quote inside the host', 'https://a"b.example/p'],
    ['a double quote at the start of the host', 'https://"a.example/p'],
    ['a double quote at the end of the host', 'https://a.example"/p'],
    ['a fullwidth double quote inside the host', 'https://a＂b.example/p'],
    // valid as a URL, but not its own reduction (v !== reduceReferer(v))
    ['the bare origin, without its slash', 'https://a.example'],
    ['an upper-case host', 'https://A.example/p'],
    ['an upper-case scheme', 'HTTPS://a.example/p'],
    ['an explicit default https port', 'https://a.example:443/p'],
    ['an explicit default http port', 'http://a.example:80/p'],
    ['dot segments', 'https://a.example/a/../b'],
    ['a space in the path', 'https://a.example/a b'],
    ['a leading space', ' https://a.example/p'],
    ['a trailing space', 'https://a.example/p '],
    ['a non-ASCII letter', 'https://a.example/\u00e9'],
    ['an emoji', 'https://a.example/\u{1f600}'],
    // too long: REFERER_MAX is 2048 UTF-16 units
    ['2049 UTF-16 units', ORIGIN + 'a'.repeat(2049 - ORIGIN.length)],
    ['4096 UTF-16 units', ORIGIN + 'a'.repeat(4096 - ORIGIN.length)],
  ];
  const REFERER_WITH_CONTROL: [string, string][] = CONTROL_CODES.flatMap((code) => {
    const c = String.fromCharCode(code);
    const label = codeLabel(code);
    return [
      [`${label} inside the path`, `https://a.example/p${c}q`],
      [`${label} at the end`, `https://a.example/p${c}`],
      [`${label} at the start`, `${c}https://a.example/p`],
    ] as [string, string][];
  });

  /** Plan line 185: ^[\x20-\x7E]{1,512}$, so the value PA3-6 measured is accepted too. */
  const HOSTILE_UA = 'a"b\\c %PATH% ^ & | < > ` $(x) ; --output=evil -o x';
  const PRINTABLE_ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
  const VALID_UAS: [string, string][] = [
    ['a browser string', UA],
    ['one character', 'a'],
    ['exactly 512 characters', 'a'.repeat(512)],
    ['the value PA3-6 measured, with a quote, a backslash and shell characters', HOSTILE_UA],
    ['a single space (U+0020 is inside the class)', ' '],
    ['every printable ASCII character', PRINTABLE_ASCII],
    ['a value that looks like a link', R],
  ];
  const BAD_UAS: [string, unknown][] = [
    ['a number', 5],
    ['true', true],
    ['an object', {}],
    ['a list', [UA]],
    ['an empty list', []],
    ['an empty text', ''],
    ['513 characters', 'a'.repeat(513)],
    ['600 characters', 'a'.repeat(600)],
    ['a letter with an accent', 'Mozilla/5.0 \u00e9'],
    ['Arabic letters', 'متصفح'],
    ['an emoji', 'Mozilla \u{1f600}'],
    ['a C1 control, U+0080', 'a\u0080b'],
    ['a no-break space, U+00A0', 'a\u00a0b'],
    ['a line separator, U+2028', 'a\u2028b'],
    ['a byte order mark, U+FEFF', 'a\ufeffb'],
  ];
  const UA_WITH_CONTROL: [string, string][] = CONTROL_CODES.flatMap((code) => {
    const c = String.fromCharCode(code);
    const label = codeLabel(code);
    return [
      [`${label} inside the text`, `a${c}b`],
      [`${label} at the end`, `ab${c}`],
      [`${label} at the start`, `${c}ab`],
    ] as [string, string][];
  });

  /** Not booleans: oneShotLogin makes the whole job invalid for each (plan line 156), like `interrupted`. */
  const NOT_BOOLEAN: [string, unknown][] = [
    ['null', null],
    ['"true"', 'true'],
    ['"false"', 'false'],
    ['an empty text', ''],
    ['0', 0],
    ['1', 1],
    ['-1', -1],
    ['2', 2],
    ['NaN', Number.NaN],
    ['an empty list', []],
    ['a list holding true', [true]],
    ['an empty object', {}],
    ['an object holding true', { value: true }],
  ];

  it('the platform reduction used as a fixture is its own reduction and holds no quote', () => {
    expect(new URL(PA36B).origin + new URL(PA36B).pathname).toBe(PA36B);
    expect(PA36B).not.toContain('"');
    expect(PA36B).toMatch(/^[\x21-\x7E]+$/u);
  });

  // ---- the table of plan 3.2, row by row ----

  describe('a key that is absent (a file written before M1)', () => {
    it('loads referer and userAgent as null and oneShotLogin as false', () => {
      expect(loadedJob()).toMatchObject(DEFAULTS);
    });

    it.each(NEW_KEYS)('reads %s as its own default when only that key is missing and the others are set', (key) => {
      const set = { referer: R, userAgent: UA, oneShotLogin: true };
      const job = loadedJob({ ...set, [key]: MISSING });
      expect(job).toMatchObject({ ...set, [key]: DEFAULTS[key] });
    });

    it('has an own key for each of the three, not an absent one, so the next save writes them', () => {
      const job = loadedJob();
      for (const key of NEW_KEYS) expect(Object.hasOwn(job ?? {}, key), key).toBe(true);
    });

    it('does not make the file invalid', () => {
      expect(parsedOf()).not.toBeNull();
    });
  });

  describe('null', () => {
    it('loads referer null and userAgent null as null, and the job is valid', () => {
      const parsed = parsedOf({ referer: null, userAgent: null });
      expect(parsed).not.toBeNull();
      expect(parsed?.jobs[0]).toMatchObject({ referer: null, userAgent: null, oneShotLogin: false });
    });

    it('loads referer null beside a valid userAgent, and the reverse', () => {
      expect(loadedJob({ referer: null, userAgent: UA })).toMatchObject({ referer: null, userAgent: UA });
      expect(loadedJob({ referer: R, userAgent: null })).toMatchObject({ referer: R, userAgent: null });
    });

    it('makes the job invalid for oneShotLogin null: the file is rejected', () => {
      expect(parsedOf({ oneShotLogin: null })).toBeNull();
    });

    it('makes the job invalid for oneShotLogin null whatever the other two hold', () => {
      expect(parsedOf({ referer: null, userAgent: null, oneShotLogin: null })).toBeNull();
      expect(parsedOf({ referer: R, userAgent: UA, oneShotLogin: null })).toBeNull();
      expect(parsedOf({ referer: MISSING, userAgent: MISSING, oneShotLogin: null })).toBeNull();
    });
  });

  describe('a valid value is kept', () => {
    it.each(VALID_REFERERS)('keeps the Referer: %s', (_name, referer) => {
      expect(loadedJob({ referer })?.referer).toBe(referer);
    });

    it.each(VALID_UAS)('keeps the User-Agent byte for byte: %s', (_name, userAgent) => {
      expect(loadedJob({ userAgent })?.userAgent).toBe(userAgent);
    });

    it.each([true, false])('keeps oneShotLogin %s', (oneShotLogin) => {
      expect(loadedJob({ oneShotLogin })?.oneShotLogin).toBe(oneShotLogin);
    });

    it('keeps the three together, each under its own name', () => {
      expect(loadedJob({ referer: R, userAgent: UA, oneShotLogin: true })).toMatchObject({ referer: R, userAgent: UA, oneShotLogin: true });
    });

    it('keeps the User-Agent that holds a double quote, which a Referer may not hold', () => {
      expect(loadedJob({ userAgent: HOSTILE_UA, referer: 'https://a.example/a"b' })).toMatchObject({ userAgent: HOSTILE_UA, referer: null });
    });
  });

  describe('a Referer that is present and invalid loads as null; the file is not set aside (A3-Q5)', () => {
    it.each(BAD_REFERERS)('loads a Referer that is %s as null and keeps the job', (_name, referer) => {
      const parsed = parsedOf({ referer, userAgent: UA, oneShotLogin: true });
      expect(parsed).not.toBeNull();
      expect(parsed?.jobs[0]).toMatchObject({ referer: null, userAgent: UA, oneShotLogin: true });
    });

    it.each(REFERER_WITH_CONTROL)('loads a Referer with %s as null and keeps the job', (_name, referer) => {
      const parsed = parsedOf({ referer, userAgent: UA, oneShotLogin: true });
      expect(parsed).not.toBeNull();
      expect(parsed?.jobs[0]).toMatchObject({ referer: null, userAgent: UA, oneShotLogin: true });
    });

    it('never keeps a query, a hash or a raw quote in what it loads', () => {
      for (const [name, referer] of BAD_REFERERS) {
        if (typeof referer !== 'string') continue;
        const kept = loadedJob({ referer })?.referer;
        expect(kept, name).toBeNull();
      }
    });
  });

  describe('a User-Agent that is present and invalid loads as null; the file is not set aside (A3-Q5)', () => {
    it.each(BAD_UAS)('loads a User-Agent that is %s as null and keeps the job', (_name, userAgent) => {
      const parsed = parsedOf({ referer: R, userAgent, oneShotLogin: true });
      expect(parsed).not.toBeNull();
      expect(parsed?.jobs[0]).toMatchObject({ referer: R, userAgent: null, oneShotLogin: true });
    });

    it.each(UA_WITH_CONTROL)('loads a User-Agent with %s as null and keeps the job', (_name, userAgent) => {
      const parsed = parsedOf({ referer: R, userAgent, oneShotLogin: true });
      expect(parsed).not.toBeNull();
      expect(parsed?.jobs[0]).toMatchObject({ referer: R, userAgent: null, oneShotLogin: true });
    });
  });

  describe('oneShotLogin that is not a boolean makes the job invalid, as interrupted does (A3-Q5)', () => {
    it.each(NOT_BOOLEAN)('rejects the file when oneShotLogin is %s', (_name, oneShotLogin) => {
      expect(parsedOf({ oneShotLogin })).toBeNull();
    });

    it.each(NOT_BOOLEAN)('rejects the file when oneShotLogin is %s on a skipped job with no url too', (_name, oneShotLogin) => {
      expect(parsedOf({ state: 'skipped', reason: 'private', url: '', oneShotLogin })).toBeNull();
    });

    it('rejects the whole file when one job of many has a bad oneShotLogin', () => {
      const jobs = [stored({ id: 'a' }), stored({ id: 'b', oneShotLogin: 'true' }), stored({ id: 'c' })];
      expect(parseSnapshotFile(fileOf(...jobs))).toBeNull();
    });

    it('treats interrupted and oneShotLogin alike: the same values reject the file', () => {
      for (const [name, value] of NOT_BOOLEAN) {
        expect(parsedOf({ oneShotLogin: value }) === null, `oneShotLogin ${name}`).toBe(parsedOf({ interrupted: value }) === null);
      }
    });

    it('does not let a valid header rescue a bad oneShotLogin', () => {
      expect(parsedOf({ referer: R, userAgent: UA, oneShotLogin: 1 })).toBeNull();
    });
  });

  describe('the length limits, each at the limit and one past it', () => {
    it('REFERER_MAX is 2048: 2048 units load, 2049 load as null', () => {
      expect(loadedJob({ referer: ORIGIN + 'a'.repeat(2048 - ORIGIN.length) })?.referer).toHaveLength(2048);
      expect(loadedJob({ referer: ORIGIN + 'a'.repeat(2049 - ORIGIN.length) })?.referer).toBeNull();
    });

    it('UA_MAX is 512: 512 characters load, 513 load as null', () => {
      expect(loadedJob({ userAgent: 'a'.repeat(512) })?.userAgent).toHaveLength(512);
      expect(loadedJob({ userAgent: 'a'.repeat(513) })?.userAgent).toBeNull();
    });

    it('the limits are counted per field: a long Referer does not null a User-Agent at its limit', () => {
      const job = loadedJob({ referer: ORIGIN + 'a'.repeat(2049 - ORIGIN.length), userAgent: 'a'.repeat(512) });
      expect(job).toMatchObject({ referer: null, userAgent: 'a'.repeat(512) });
    });
  });

  describe('one field at a time', () => {
    const REFERERS: [string, unknown, string | null][] = [
      ['valid', R, R],
      ['bad (a query)', `${R}?x=1`, null],
      ['absent', MISSING, null],
      ['null', null, null],
    ];
    const AGENTS: [string, unknown, string | null][] = [
      ['valid', UA, UA],
      ['bad (a line feed)', 'a\nb', null],
      ['absent', MISSING, null],
      ['null', null, null],
    ];
    const FLAGS: [string, unknown, boolean][] = [
      ['true', true, true],
      ['false', false, false],
      ['absent', MISSING, false],
    ];
    const rows = REFERERS.flatMap(([rn, rv, re]) =>
      AGENTS.flatMap(([an, av, ae]) => FLAGS.map(([fn, fv, fe]) => [rn, an, fn, { referer: rv, userAgent: av, oneShotLogin: fv }, { referer: re, userAgent: ae, oneShotLogin: fe }] as const)),
    );

    it.each(rows)('referer %s, userAgent %s, oneShotLogin %s: each loads by its own rule', (_r, _a, _f, input, expected) => {
      expect(loadedJob(input)).toMatchObject(expected);
    });

    it('a bad Referer or User-Agent on one job leaves every other job of the file as it was', () => {
      const jobs = [
        stored({ id: 'a', referer: `${R}?token=1`, userAgent: 'a\nb' }),
        stored({ id: 'b', referer: R, userAgent: UA, oneShotLogin: true }),
        stored({ id: 'c' }),
      ];
      const parsed = parseSnapshotFile(fileOf(...jobs));
      expect(parsed?.jobs.map((j) => [j.id, j.referer, j.userAgent, j.oneShotLogin])).toEqual([
        ['a', null, null, false],
        ['b', R, UA, true],
        ['c', null, null, false],
      ]);
    });

    it('does not swap the Referer and the User-Agent', () => {
      const job = loadedJob({ referer: R, userAgent: 'Some Agent/1.0' });
      expect(job?.referer).toBe(R);
      expect(job?.userAgent).toBe('Some Agent/1.0');
    });
  });

  describe('every kind and state of job carries the three fields alike', () => {
    const STATES = ['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped'] as const;

    it.each(STATES)('a %s media job', (state) => {
      const over = { state, fileName: state === 'done' ? 'a.mp4' : null, url: state === 'skipped' ? '' : 'https://example.com/v', referer: R, userAgent: UA, oneShotLogin: true };
      expect(loadedJob(over)).toMatchObject({ state, referer: R, userAgent: UA, oneShotLogin: true });
    });

    it('a file job', () => {
      const over = { kind: 'file', quality: null, baseName: null, fileName: 'a.zip', referer: R, userAgent: UA, oneShotLogin: false };
      expect(loadedJob(over)).toMatchObject({ kind: 'file', referer: R, userAgent: UA, oneShotLogin: false });
    });

    it('a member of a group, with oneShotLogin true: it loads as stored and the group stays (A3-Q16)', () => {
      const job = stored({ groupId: 'g1', index: 1, referer: R, userAgent: UA, oneShotLogin: true });
      const parsed = parseSnapshotFile({ version: 1, jobs: [job], groups: [group] });
      expect(parsed?.jobs[0]).toMatchObject({ groupId: 'g1', oneShotLogin: true, referer: R, userAgent: UA });
      expect(parsed?.groups).toEqual([group]);
    });

    it('a skipped placeholder with no url', () => {
      const over = { state: 'skipped', reason: 'private', url: '', referer: R, userAgent: UA, oneShotLogin: false };
      expect(loadedJob(over)).toMatchObject({ state: 'skipped', url: '', referer: R, userAgent: UA });
    });
  });

  describe('no old field is read differently (all 23 fields of Job before M1)', () => {
    const VARIANTS: [string, Record<string, unknown>][] = [
      ['no new key', {}],
      ['all three valid', { referer: R, userAgent: UA, oneShotLogin: true }],
      ['a bad Referer and a bad User-Agent', { referer: `${R}?x=1`, userAgent: 'a\nb' }],
      ['all three null-ish where allowed', { referer: null, userAgent: null, oneShotLogin: false }],
    ];

    it('lists the 23 old fields and builds a job from exactly those and the three new ones', () => {
      expect(new Set(OLD_KEYS).size).toBe(23);
      const job = loadedJob({ referer: R, userAgent: UA, oneShotLogin: true, mystery: 1 });
      expect(Object.keys(job ?? {}).sort()).toEqual([...OLD_KEYS, ...NEW_KEYS].sort());
      expect(job).not.toHaveProperty('mystery');
    });

    it.each(VARIANTS)('reads every old field as before with %s', (_name, over) => {
      const input = stored(over);
      expect(pick(parsedOf(over)?.jobs[0], OLD_KEYS)).toEqual(pick(input, OLD_KEYS));
    });

    const OLD_BAD: [string, Record<string, unknown>][] = [
      ['an unknown state', { state: 'finished' }],
      ['negative attempts', { attempts: -1 }],
      ['interrupted as null', { interrupted: null }],
      ['resumable as text', { resumable: 'yes' }],
      ['a relative folder', { dir: 'relative' }],
      ['an impossible quality', { quality: { kind: 'max', height: 999 } }],
      ['a queued job with a url that is not http', { url: 'abc123' }],
      ['a job whose group is not listed', { groupId: 'ghost' }],
    ];
    it.each(OLD_BAD.flatMap(([name, bad]) => VARIANTS.map(([variant, over]) => [name, variant, { ...over, ...bad }] as const)))(
      'still rejects the file for %s with %s',
      (_name, _variant, over) => {
        expect(parsedOf(over)).toBeNull();
      },
    );

    it.each(VARIANTS)('still loads a bad meter as its neutral value with %s', (_name, over) => {
      const job = loadedJob({ ...over, eta: -5, actualHeight: 0, bytesDone: '5', speed: null, sourceHeight: -1 });
      expect(job).toMatchObject({ eta: null, actualHeight: null, bytesDone: 0, speed: 0, sourceHeight: null });
    });

    it('still reads an absent interrupted and an absent sourceHeight as their defaults beside the new fields', () => {
      const job = loadedJob({ referer: R, interrupted: MISSING, sourceHeight: MISSING });
      expect(job).toMatchObject({ interrupted: false, sourceHeight: null, referer: R });
    });

    it('still accepts a file with no version beside the new fields', () => {
      const parsed = parseSnapshotFile({ jobs: [stored({ referer: R, userAgent: UA, oneShotLogin: true })], groups: [] });
      expect(parsed?.jobs[0]).toMatchObject({ referer: R, userAgent: UA, oneShotLogin: true });
    });

    it('still rejects version 2', () => {
      expect(parseSnapshotFile({ version: 2, jobs: [stored({ referer: R })], groups: [] })).toBeNull();
    });
  });

  describe('agreement with the shared validators of Task T1 (reduceReferer, isUserAgent)', () => {
    // Needs reduceReferer and isUserAgent from src/shared/protocol.ts: they do not exist before Task T1.
    const REFERER_POOL = [...VALID_REFERERS, ...BAD_REFERERS.filter((e): e is [string, string] => typeof e[1] === 'string'), ...REFERER_WITH_CONTROL].map(([, v]) => v);
    const UA_POOL = [...VALID_UAS, ...BAD_UAS.filter((e): e is [string, string] => typeof e[1] === 'string'), ...UA_WITH_CONTROL].map(([, v]) => v);

    it('keeps a Referer exactly when it is its own reduction (v === reduceReferer(v), plan line 155)', () => {
      for (const referer of REFERER_POOL) {
        const expected = reduceReferer(referer) === referer ? referer : null;
        expect(loadedJob({ referer })?.referer, JSON.stringify(referer).slice(0, 80)).toBe(expected);
      }
    });

    it('keeps a User-Agent exactly when isUserAgent accepts it (plan line 155)', () => {
      for (const userAgent of UA_POOL) {
        const expected = isUserAgent(userAgent) ? userAgent : null;
        expect(loadedJob({ userAgent })?.userAgent, JSON.stringify(userAgent).slice(0, 80)).toBe(expected);
      }
    });

    // M1 rests on reduceReferer (plan line 155). Through parseJob a missing clause in it would go unseen, because
    // v === reduceReferer(v) already fails when the URL parser rewrites the bytes; so the clauses M1 relies on are
    // pinned here as well (Task T1 owns the full table of reduceReferer, lines 180 and 192).
    it('reduceReferer gives null for userinfo, a scheme other than http(s), a non-string and an unparsable text', () => {
      for (const v of ['https://user@a.example/p', 'https://user:pw@a.example/p', 'ftp://a.example/p', 'javascript:alert(1)', 'file:///C:/x', '/p/q', '', 'x']) {
        expect(reduceReferer(v), v).toBeNull();
      }
      for (const v of [5, null, undefined, {}, [], true]) expect(reduceReferer(v), String(v)).toBeNull();
    });

    it('reduceReferer gives null for each C0 character and DEL, wherever it stands', () => {
      for (const [name, v] of REFERER_WITH_CONTROL) expect(reduceReferer(v), name).toBeNull();
    });

    it('reduceReferer keeps origin and pathname only: the query and the hash go', () => {
      expect(reduceReferer('https://a.example/p/q?token=1#f')).toBe('https://a.example/p/q');
      expect(reduceReferer('https://a.example/p?')).toBe('https://a.example/p');
      expect(reduceReferer('https://a.example/p#')).toBe('https://a.example/p');
    });

    it('reduceReferer never returns a raw double quote: %22 or null', () => {
      const urls = ['https://a.example/a"b', 'https://a.example/"', 'https://a.example/a%22b', 'https://a"b.example/p', 'https://"a.example/p', 'https://a.example"/p', 'https://a＂b.example/p'];
      for (const v of urls) {
        const reduced = reduceReferer(v);
        expect(reduced === null || !reduced.includes('"'), v).toBe(true);
      }
    });

    it('reduceReferer: 2048 UTF-16 units pass and 2049 give null', () => {
      expect(reduceReferer(ORIGIN + 'a'.repeat(2048 - ORIGIN.length))).toHaveLength(2048);
      expect(reduceReferer(ORIGIN + 'a'.repeat(2049 - ORIGIN.length))).toBeNull();
    });

    // The cap counts the REDUCED text too (src/shared/protocol.ts, REFERER_MAX), not only the input. The URL parser
    // writes a space, a non-ASCII letter or an emoji of a path as %XX escapes, so a short input can reduce to a
    // longer text. The lengths below are computed here from the characters, never written as a number that holds
    // for one Node version only, and each spec first checks the sizes it relies on.
    describe('the cap on the reduced Referer, not only on the input (REFERER_MAX = 2048)', () => {
      const PREFIX = 'https://a.example/';
      /** Characters the URL parser percent-encodes in a path: 1, 1 and 2 UTF-16 units before, 3, 6 and 12 after. */
      const ENCODED: [string, string][] = [
        ['a space', ' '],
        ['a non-ASCII letter', 'é'],
        ['an emoji (a surrogate pair)', '😀'],
      ];

      interface Sized {
        input: string;
        /** What reduceReferer must make of `input`: the escapes written out, the origin and the path kept. */
        reduced: string;
      }
      /** `count` copies of `ch` and then plain letters, so that the REDUCED text has exactly `units` UTF-16 units. */
      function sizedByReduction(ch: string, count: number, units: number): Sized {
        const escaped = encodeURIComponent(ch);
        const letters = 'a'.repeat(units - PREFIX.length - count * escaped.length);
        return { input: PREFIX + ch.repeat(count) + letters, reduced: PREFIX + escaped.repeat(count) + letters };
      }
      /** `count` copies of `ch` and then plain letters, so that the INPUT has exactly `units` UTF-16 units. */
      function sizedByInput(ch: string, count: number, units: number): Sized {
        const escaped = encodeURIComponent(ch);
        const letters = 'a'.repeat(units - PREFIX.length - count * ch.length);
        return { input: PREFIX + ch.repeat(count) + letters, reduced: PREFIX + escaped.repeat(count) + letters };
      }

      it.each(ENCODED)('%s: an input shorter than 2048 units whose reduction is exactly 2048 is kept, is a fixed point, and loads', (_name, ch) => {
        const { input, reduced } = sizedByReduction(ch, 20, 2048);
        // the sizes this spec relies on
        expect(reduced).toHaveLength(2048);
        expect(input.length).toBeLessThanOrEqual(2048);
        expect(input.length).toBeLessThan(reduced.length);
        expect(reduced).toMatch(/^[\x21-\x7E]+$/u);

        const r = reduceReferer(input);
        expect(r).toBe(reduced);
        expect(r).toHaveLength(2048);
        expect(reduceReferer(r)).toBe(r);
        expect(loadedJob({ referer: r })?.referer).toBe(r);
      });

      it.each(ENCODED)('%s: an input of at most 2048 units whose reduction is 2049 gives null, and so does a job that stores either text', (_name, ch) => {
        const { input, reduced } = sizedByReduction(ch, 20, 2049);
        expect(reduced).toHaveLength(2049);
        expect(input.length).toBeLessThanOrEqual(2048);

        expect(reduceReferer(input)).toBeNull();
        expect(reduceReferer(reduced)).toBeNull();
        expect(loadedJob({ referer: input })?.referer).toBeNull();
        expect(loadedJob({ referer: reduced })?.referer).toBeNull();
      });

      it.each(ENCODED)('%s: an input of exactly 2048 units whose reduction is longer gives null', (_name, ch) => {
        const { input, reduced } = sizedByInput(ch, 1, 2048);
        expect(input).toHaveLength(2048);
        expect(reduced.length).toBeGreaterThan(2048);

        expect(reduceReferer(input)).toBeNull();
        expect(loadedJob({ referer: input })?.referer).toBeNull();
      });

      // The same input, with the escapable character taken out, is a 2048-unit input that reduces to itself:
      // the null above comes from the length of the reduction, not from the length of the input.
      it('an input of exactly 2048 units with nothing to escape is kept, so the null of the spec above is the reduction cap', () => {
        const input = PREFIX + 'a'.repeat(2048 - PREFIX.length);
        expect(input).toHaveLength(2048);
        expect(reduceReferer(input)).toBe(input);
      });

      it.each(ENCODED)('%s: a job stored with the 2048-unit fixed point keeps it across a load, a save and a second load (the real Store)', (_name, ch) => {
        const r = sizedByReduction(ch, 20, 2048).reduced;
        expect(r).toHaveLength(2048);
        expect(reduceReferer(r)).toBe(r);

        const dir = mkdtempSync(join(tmpdir(), 'fetchly-validate-'));
        try {
          const job = makeJob({ id: 'j1', state: 'queued', referer: r, userAgent: null, oneShotLogin: false });
          writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ version: 1, jobs: [job], groups: [] }));

          const store = new Store(dir, 'C:\\Users\\me\\Downloads');
          const first = store.load();
          expect(first.recoveredCorrupt).toBeNull();
          expect(first.snapshot.jobs).toHaveLength(1);
          expect(first.snapshot.jobs[0]?.referer).toBe(r);

          store.saveSnapshot(first.snapshot);
          const saved = JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8')) as { jobs: { referer: unknown }[] };
          expect(saved.jobs[0]?.referer).toBe(r);

          const second = new Store(dir, 'C:\\Users\\me\\Downloads').load();
          expect(second.recoveredCorrupt).toBeNull();
          expect(second.snapshot.jobs).toHaveLength(1);
          expect(second.snapshot.jobs[0]?.referer).toBe(r);
          expect(readdirSync(dir).filter((f) => f.includes('.corrupt-'))).toEqual([]);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    });

    it('whatever reduceReferer returns is printable ASCII with no quote, and is its own reduction', () => {
      for (const v of REFERER_POOL) {
        const reduced = reduceReferer(v);
        if (reduced === null) continue;
        expect(reduced, v).toMatch(/^[\x21-\x7E]+$/u);
        expect(reduced.includes('"'), v).toBe(false);
        expect(reduceReferer(reduced), v).toBe(reduced);
      }
    });

    it('the pools hold both kinds, so the two checks above are not vacuous', () => {
      expect(REFERER_POOL.filter((v) => reduceReferer(v) === v).length).toBeGreaterThan(5);
      expect(REFERER_POOL.filter((v) => reduceReferer(v) !== v).length).toBeGreaterThan(50);
      expect(UA_POOL.filter((v) => isUserAgent(v)).length).toBeGreaterThan(5);
      expect(UA_POOL.filter((v) => !isUserAgent(v)).length).toBeGreaterThan(50);
    });
  });
});

describe('parseSettings', () => {
  const defaults: Settings = makeSettings({ downloadDir: 'C:\\Users\\me\\Downloads\\Fetchly' });

  it('returns a valid old settings file unchanged', () => {
    const saved = makeSettings({ maxConcurrent: 5, subtitleLangs: ['ar', 'en'], defaultQuality: { kind: 'max', height: 720 } });
    expect(parseSettings(saved, defaults)).toEqual(saved);
  });

  it.each<[string, Record<string, unknown>, Partial<Settings>]>([
    ['subtitle languages that are an object', { subtitleLangs: {} }, { subtitleLangs: [] }],
    ['a subtitle language that is an option', { subtitleLangs: ['en', '--exec'] }, { subtitleLangs: [] }],
    ['an impossible quality', { defaultQuality: { kind: 'max', height: 7 } }, { defaultQuality: { kind: 'best' } }],
    ['a relative download folder', { downloadDir: 'x' }, { downloadDir: 'C:\\Users\\me\\Downloads\\Fetchly' }],
    ['slots as text', { maxConcurrent: '4' }, { maxConcurrent: 3 }],
    ['an infinite limit', { speedLimitKbps: null }, { speedLimitKbps: 0 }],
    ['a flag as text', { askEveryTime: 'true' }, { askEveryTime: false }],
  ])('falls back for %s, field by field', (_name, raw, expected) => {
    expect(parseSettings({ ...raw, autoResumeOnStart: true }, defaults)).toEqual({ ...defaults, autoResumeOnStart: true, ...expected });
  });

  describe('every field falls back to its own default', () => {
    const own = makeSettings({
      downloadDir: 'C:\\Own\\Folder',
      askEveryTime: true,
      maxConcurrent: 5,
      speedLimitKbps: 200,
      autoResumeOnStart: true,
      preferMp4Max1080: true,
      defaultQuality: { kind: 'audio', format: 'mp3' },
      subtitleLangs: ['ar'],
    });
    const valid = makeSettings({
      downloadDir: 'D:\\Saved',
      askEveryTime: false,
      maxConcurrent: 2,
      speedLimitKbps: 50,
      autoResumeOnStart: false,
      preferMp4Max1080: false,
      defaultQuality: { kind: 'max', height: 480 },
      subtitleLangs: ['fr'],
    });

    it.each<[keyof Settings, unknown]>([
      ['downloadDir', 'relative'],
      ['downloadDir', 5],
      ['downloadDir', null],
      ['askEveryTime', 'no'],
      ['askEveryTime', 0],
      ['askEveryTime', null],
      ['maxConcurrent', Number.NaN],
      ['maxConcurrent', Number.POSITIVE_INFINITY],
      ['maxConcurrent', Number.NEGATIVE_INFINITY],
      ['maxConcurrent', '2'],
      ['maxConcurrent', null],
      ['speedLimitKbps', Number.NaN],
      ['speedLimitKbps', Number.POSITIVE_INFINITY],
      ['speedLimitKbps', '50'],
      ['speedLimitKbps', true],
      ['autoResumeOnStart', 'no'],
      ['autoResumeOnStart', 1],
      ['autoResumeOnStart', null],
      ['preferMp4Max1080', 'no'],
      ['preferMp4Max1080', 1],
      ['preferMp4Max1080', null],
      ['defaultQuality', { kind: 'nope' }],
      ['defaultQuality', null],
      ['defaultQuality', 'best'],
      ['subtitleLangs', ['en', '--exec']],
      ['subtitleLangs', 'en'],
      ['subtitleLangs', {}],
    ])('keeps the default of %s when it is %j', (field, bad) => {
      expect(parseSettings({ ...valid, [field]: bad }, own)).toEqual({ ...valid, [field]: own[field] });
    });

    it.each(Object.keys(valid) as (keyof Settings)[])('keeps the default of %s when it is missing', (field) => {
      const raw: Record<string, unknown> = { ...valid };
      delete raw[field];
      expect(parseSettings(raw, own)).toEqual({ ...valid, [field]: own[field] });
    });

    it('does not hand out the list of the defaults itself', () => {
      const result = parseSettings({}, own);
      result.subtitleLangs.push('de');
      expect(own.subtitleLangs).toEqual(['ar']);
    });
  });

  describe('flags that are text fall back (A7)', () => {
    const flagsOn = makeSettings({ askEveryTime: true, autoResumeOnStart: true, preferMp4Max1080: true });
    const flagsOff = makeSettings({ askEveryTime: false, autoResumeOnStart: false, preferMp4Max1080: false });

    it.each(['autoResumeOnStart', 'preferMp4Max1080'] as const)('%s as "true" falls back to a default of false', (flag) => {
      expect(parseSettings({ [flag]: 'true' }, flagsOff)[flag]).toBe(false);
    });

    it.each(['autoResumeOnStart', 'preferMp4Max1080'] as const)('%s as "no" or "false" falls back to a default of true', (flag) => {
      expect(parseSettings({ [flag]: 'no' }, flagsOn)[flag]).toBe(true);
      expect(parseSettings({ [flag]: 'false' }, flagsOn)[flag]).toBe(true);
    });

    it.each(['autoResumeOnStart', 'preferMp4Max1080'] as const)('%s keeps a real boolean', (flag) => {
      expect(parseSettings({ [flag]: true }, flagsOff)[flag]).toBe(true);
      expect(parseSettings({ [flag]: false }, flagsOn)[flag]).toBe(false);
    });
  });

  it('keeps the whole subtitle list or none of it, with no filtering', () => {
    expect(parseSettings({ subtitleLangs: ['en', 'ar'] }, defaults).subtitleLangs).toEqual(['en', 'ar']);
    expect(parseSettings({ subtitleLangs: ['en', 'a b'] }, makeSettings({ subtitleLangs: ['de'] })).subtitleLangs).toEqual(['de']);
  });

  it('clamps the numbers it keeps', () => {
    expect(parseSettings({ maxConcurrent: 50, speedLimitKbps: -5 }, defaults)).toMatchObject({ maxConcurrent: 8, speedLimitKbps: 0 });
  });

  it('ignores unknown keys', () => {
    expect(parseSettings({ mystery: true }, defaults)).toEqual(defaults);
  });

  it.each(single<unknown>([null, [], 'x', 5, undefined]))('returns the defaults for %j', (raw) => {
    expect(parseSettings(raw, defaults)).toEqual(defaults);
  });

  it('returns the defaults for an empty object', () => {
    expect(parseSettings({}, defaults)).toEqual(defaults);
  });

  describe('language and theme', () => {
    const chosen = makeSettings({ language: 'ar', theme: 'dark', maxConcurrent: 4 });
    const BAD: [string, unknown][] = [
      ['null', null],
      ['a number', 1],
      ['zero', 0],
      ['true', true],
      ['false', false],
      ['empty text', ''],
      ['an array', ['ar']],
      ['an object', { value: 'ar' }],
    ];
    const BAD_LANGUAGE: [string, unknown][] = [...BAD, ['wrong case', 'AR'], ['wrong case', 'En'], ['wrong case', 'System'], ['unknown', 'fr'], ['unknown', 'auto'], ['a theme value', 'dark']];
    const BAD_THEME: [string, unknown][] = [...BAD, ['wrong case', 'Dark'], ['wrong case', 'LIGHT'], ['wrong case', 'System'], ['unknown', 'auto'], ['unknown', 'fr'], ['a language value', 'ar']];

    it.each(BAD_LANGUAGE)('a language that is %s (%j) falls back to system alone', (_what, bad) => {
      expect(parseSettings({ ...chosen, language: bad }, defaults)).toEqual({ ...chosen, language: 'system' });
    });

    it.each(BAD_THEME)('a theme that is %s (%j) falls back to system alone', (_what, bad) => {
      expect(parseSettings({ ...chosen, theme: bad }, defaults)).toEqual({ ...chosen, theme: 'system' });
    });

    it('a missing field falls back to system alone', () => {
      const noLanguage: Record<string, unknown> = { ...chosen };
      delete noLanguage['language'];
      const noTheme: Record<string, unknown> = { ...chosen };
      delete noTheme['theme'];
      expect(parseSettings(noLanguage, defaults)).toEqual({ ...chosen, language: 'system' });
      expect(parseSettings(noTheme, defaults)).toEqual({ ...chosen, theme: 'system' });
    });

    it('both invalid fall back each to its own default and nothing else changes', () => {
      expect(parseSettings({ ...chosen, language: 'Arabic', theme: 'night' }, defaults)).toEqual({ ...chosen, language: 'system', theme: 'system' });
    });

    it.each(['system', 'en', 'ar'] as const)('the language %s round-trips', (language) => {
      const saved = makeSettings({ language, theme: 'light' });
      expect(parseSettings(JSON.parse(JSON.stringify(saved)), defaults)).toEqual(saved);
    });

    it.each(['system', 'light', 'dark'] as const)('the theme %s round-trips', (theme) => {
      const saved = makeSettings({ language: 'en', theme });
      expect(parseSettings(JSON.parse(JSON.stringify(saved)), defaults)).toEqual(saved);
    });

    it('a settings file written before these fields existed loads, with both on system', () => {
      const old = {
        downloadDir: 'D:\\Old',
        askEveryTime: true,
        maxConcurrent: 2,
        speedLimitKbps: 100,
        autoResumeOnStart: true,
        preferMp4Max1080: false,
        defaultQuality: { kind: 'max', height: 720 },
        subtitleLangs: ['ar'],
      };
      expect(parseSettings(old, defaults)).toEqual({ ...old, language: 'system', theme: 'system', serverPort: defaults.serverPort });
    });
  });
});

describe('normalizeSettings (A8)', () => {
  it.each<[number, number]>([
    [50, 8],
    [9, 8],
    [8, 8],
    [4.7, 4],
    [1, 1],
    [0.9, 1],
    [0, 1],
    [-3, 1],
    [Number.NaN, 3],
    [Number.POSITIVE_INFINITY, 3],
    [Number.NEGATIVE_INFINITY, 3],
  ])('turns %s slots into %s', (given, expected) => {
    expect(normalizeSettings(makeSettings({ maxConcurrent: given })).maxConcurrent).toBe(expected);
  });

  it.each<[number, number]>([
    [100, 100],
    [100.9, 100],
    [1, 1],
    [0, 0],
    [-5, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ])('turns a limit of %s into %s', (given, expected) => {
    expect(normalizeSettings(makeSettings({ speedLimitKbps: given })).speedLimitKbps).toBe(expected);
  });

  it('leaves every other field as it is', () => {
    const s = makeSettings({ downloadDir: 'D:\\X', askEveryTime: true, autoResumeOnStart: true, defaultQuality: { kind: 'max', height: 720 }, subtitleLangs: ['en'] });
    expect(normalizeSettings(s)).toEqual({ ...s, maxConcurrent: 3, speedLimitKbps: 0 });
  });

  it('does not change what it was given', () => {
    const s = makeSettings({ maxConcurrent: 50, speedLimitKbps: -5 });
    normalizeSettings(s);
    expect(s).toMatchObject({ maxConcurrent: 50, speedLimitKbps: -5 });
  });
});

describe('isQuality, isLangList and isAbsoluteDir', () => {
  it('accept exactly the qualities the app offers', () => {
    expect(isQuality({ kind: 'best' })).toBe(true);
    expect(isQuality({ kind: 'max', height: 1440 })).toBe(true);
    expect(isQuality({ kind: 'audio', format: 'mp3' })).toBe(true);
    expect(isQuality({ kind: 'audio', format: 'm4a' })).toBe(true);
    expect(isQuality({ kind: 'audio', format: 'flac' })).toBe(false);
    expect(isQuality([])).toBe(false);
  });

  it.each(HEIGHTS)('accepts a maximum height of %s', (height) => {
    expect(isQuality({ kind: 'max', height })).toBe(true);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['text', 'best'],
    ['no kind', {}],
    ['an unknown kind', { kind: 'worst' }],
    ['a height the app does not offer', { kind: 'max', height: 1081 }],
    ['a height of 0', { kind: 'max', height: 0 }],
    ['a height of NaN', { kind: 'max', height: Number.NaN }],
    ['a height as text', { kind: 'max', height: '720' }],
    ['no height', { kind: 'max' }],
    ['no format', { kind: 'audio' }],
    ['a format as a list', { kind: 'audio', format: ['mp3'] }],
  ])('refuses %s as a quality', (_name, value) => {
    expect(isQuality(value)).toBe(false);
  });

  it('accept language codes only, at most 10', () => {
    expect(isLangList(['en', 'pt-BR'])).toBe(true);
    expect(isLangList(Array.from({ length: 10 }, () => 'en'))).toBe(true);
    expect(isLangList(Array.from({ length: 11 }, () => 'en'))).toBe(false);
    expect(isLangList(['e n'])).toBe(false);
  });

  it.each(single<string[]>([[], ['en'], ['ar', 'en', 'pt-BR'], ['zh-Hans'], ['eng']]))('accepts the list %j', (list) => {
    expect(isLangList(list)).toBe(true);
  });

  describe('a list with a hole (B2)', () => {
    /** An array of this length with only the given positions set: the others are holes, not undefined. */
    const holey = (length: number, set: Record<number, string> = {}): string[] => {
      const list = new Array<string>(length);
      for (const [position, code] of Object.entries(set)) list[Number(position)] = code;
      return list;
    };
    const tenWithLastHole = (): string[] => holey(10, Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, 'en'])));

    const HOLEY: [string, () => string[]][] = [
      ['Array(1)', () => new Array<string>(1)],
      ['Array(2)', () => new Array<string>(2)],
      ['a valid code and then a hole', () => holey(2, { 0: 'en' })],
      ['a hole and then a valid code', () => holey(2, { 1: 'en' })],
      ['a hole between valid codes', () => holey(3, { 0: 'en', 2: 'ar' })],
      ['ten places, the last one a hole', tenWithLastHole],
      ['ten holes', () => new Array<string>(10)],
    ];

    it.each(HOLEY)('refuses %s', (_name, make) => {
      expect(isLangList(make())).toBe(false);
    });

    it.each(HOLEY)('refuses %s after a structured clone, which is how a list arrives over IPC', (_name, make) => {
      const arrived = structuredClone(make());
      expect(arrived.length).toBe(make().length); // the clone keeps the length; only the holes stay empty
      expect(isLangList(arrived)).toBe(false);
    });

    it.each<[string, unknown[]]>([
      ['a valid code and then undefined', ['en', undefined]],
      ['undefined and then a valid code', [undefined, 'en']],
      ['a valid code and then null', ['en', null]],
    ])('refuses %s as well', (_name, value) => {
      expect(isLangList(value)).toBe(false);
    });

    it('still accepts ten codes with no hole, and a hole-free list after a clone', () => {
      expect(isLangList(Array.from({ length: 10 }, () => 'en'))).toBe(true);
      expect(isLangList(structuredClone(['en', 'pt-BR']))).toBe(true);
    });

    it('makes parseSettings fall back to the default list, like any other bad list', () => {
      const defaults = makeSettings({ subtitleLangs: ['ar'] });
      expect(parseSettings({ subtitleLangs: holey(1) }, defaults).subtitleLangs).toEqual(['ar']);
      expect(parseSettings({ subtitleLangs: holey(2, { 0: 'en' }) }, defaults).subtitleLangs).toEqual(['ar']);
      expect(parseSettings({ subtitleLangs: ['en'] }, defaults).subtitleLangs).toEqual(['en']);
    });
  });

  it.each<[string, unknown]>([
    ['an option', ['--exec']],
    ['a code that ends in a dash', ['en-']],
    ['a code of one letter', ['e']],
    ['a code of four letters', ['engl']],
    ['an empty code', ['']],
    ['a code with a space', ['en ']],
    ['a code with a separator', ['en;ls']],
    ['a code with a comma', ['en,ar']],
    ['an entry that is not text', [5]],
    ['a null entry', [null]],
    ['text instead of a list', 'en'],
    ['null', null],
    ['an object', {}],
  ])('refuses %s as a language list', (_name, value) => {
    expect(isLangList(value)).toBe(false);
  });

  it.each(['D:\\Dl', 'C:\\', 'C:\\Users\\me\\Downloads\\Fetchly', '\\\\server\\share\\x'])('accepts %j as an absolute folder', (value) => {
    expect(isAbsoluteDir(value)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['a relative path', 'downloads'],
    ['a drive-relative path', 'C:downloads'],
    ['a dot path', '.\\x'],
    ['an empty text', ''],
    ['a number', 5],
    ['null', null],
    ['a list', ['D:\\Dl']],
  ])('refuses %s as an absolute folder', (_name, value) => {
    expect(isAbsoluteDir(value)).toBe(false);
  });
});

describe('the url of a job is checked the way IPC does (C1)', () => {
  /** What the window may send and validateUrl takes: trimmed, then an http(s) link. */
  const ACCEPTED_URLS: [string, string][] = [
    ['a leading space', ' https://example.com/item'],
    ['a trailing space', 'https://example.com/item '],
    ['a trailing byte order mark', 'https://example.com/item\uFEFF'],
    ['a leading byte order mark', '\uFEFFhttps://example.com/item'],
    ['a leading non-breaking space', '\u00a0https://example.com/item'],
    ['a trailing non-breaking space', 'https://example.com/item\u00a0'],
    ['a non-breaking space right after the host', 'https://example.com\u00a0'],
    ['an ideographic space right after the host', 'https://example.com\u3000'],
    ['a line separator right after the host', 'https://example.com\u2028'],
    ['marks and spaces on both sides', '\uFEFF \u00a0https://example.com/item \u00a0\uFEFF'],
    ['line and paragraph separators', '\u2028https://example.com/item\u2029'],
    ['ideographic spaces', '\u3000https://example.com/item\u3000'],
    ['em spaces', '\u2003https://example.com/item\u2003'],
    ['a tab and a newline at the edges', '\thttps://example.com/x\n'],
    ['a vertical tab and a form feed at the edges', '\vhttps://example.com/x\f'],
  ];

  /** Nothing is left of these once trimmed, or what is left is not an http(s) link. */
  const REJECTED_URLS: [string, string][] = [
    ['a space', ' '],
    ['a non-breaking space', '\u00a0'],
    ['a byte order mark', '\uFEFF'],
    ['spaces and marks only', ' \u00a0 \uFEFF '],
    ['an empty text', ''],
    ['a space and ftp', ' ftp://x'],
    ['a mark and ftp', '\uFEFFftp://x'],
    ['a trailing space after ftp', 'ftp://x '],
    ['a file link with spaces', ' file:///C:/x '],
    ['a script link after a non-breaking space', '\u00a0javascript:alert(1)'],
    ['a scheme with no host', ' https:// '],
    ['a link with no scheme', ' //example.com/x '],
    ['a bare id with spaces', ' abc123 '],
    ['a zero-width space, which trimming does not remove, before the link', '\u200bhttps://example.com/x'],
  ];

  it('loads a queued job whose url starts with a space, and returns the url as it was', () => {
    expect(parseOne({ state: 'queued', url: ' https://example.com/item' })?.url).toBe(' https://example.com/item');
  });

  it('loads a queued job whose url ends in a byte order mark, and returns the url as it was', () => {
    expect(parseOne({ state: 'queued', url: 'https://example.com/item\uFEFF' })?.url).toBe('https://example.com/item\uFEFF');
  });

  it.each(ACCEPTED_URLS)('loads a queued job whose url has %s, byte-identical', (_name, url) => {
    const parsed = parseSnapshotFile(file({ state: 'queued', url }));
    expect(parsed).not.toBeNull();
    expect(parsed?.jobs[0]?.url).toBe(url);
  });

  it.each(['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed'] as const)('loads a %s job whose url has marks and spaces around it', (state) => {
    const url = '\u00a0https://example.com/item\uFEFF';
    const parsed = parseSnapshotFile(file({ state, url, fileName: state === 'done' ? 'a.mp4' : null }));
    expect(parsed?.jobs[0]?.url).toBe(url);
  });

  it('loads a file job whose url has marks and spaces around it', () => {
    const url = ' https://example.com/a.zip\uFEFF';
    expect(parseSnapshotFile(file(fileJob({ url })))?.jobs[0]?.url).toBe(url);
  });

  it('loads a job of a group whose url has marks and spaces around it', () => {
    const url = 'https://example.com/v/1\uFEFF';
    const parsed = parseSnapshotFile({ version: 1, jobs: [oldJob({ groupId: 'g1', url, index: 1 })], groups: [group] });
    expect(parsed?.jobs[0]?.url).toBe(url);
  });

  it('still rejects ` ` and ` ftp://x` on a queued job', () => {
    expect(parseSnapshotFile(file({ state: 'queued', url: ' ' }))).toBeNull();
    expect(parseSnapshotFile(file({ state: 'queued', url: ' ftp://x' }))).toBeNull();
  });

  it.each(REJECTED_URLS)('rejects a queued job whose url is %s', (_name, url) => {
    expect(parseSnapshotFile(file({ state: 'queued', url }))).toBeNull();
  });

  it.each(['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed'] as const)('rejects a %s job whose url is only spaces or not http', (state) => {
    const over = { state, fileName: state === 'done' ? 'a.mp4' : null };
    for (const [name, url] of REJECTED_URLS) {
      expect(parseSnapshotFile(file({ ...over, url })), name).toBeNull();
    }
  });

  it('rejects a file job whose url is only spaces or not http', () => {
    for (const [name, url] of REJECTED_URLS) {
      expect(parseSnapshotFile(file(fileJob({ url }))), name).toBeNull();
    }
  });

  it('still takes any string on a skipped job, spaces and marks included', () => {
    for (const url of [' ', '\uFEFF', ' ftp://x', '\u00a0', 'abc123', '', ' https://example.com/item\uFEFF']) {
      expect(parseOne({ state: 'skipped', reason: 'private', url })?.url, JSON.stringify(url)).toBe(url);
    }
  });

  it('still rejects a url that is not a string, whatever its spaces', () => {
    for (const url of [null, 5, undefined, {}, [' https://example.com/x']]) {
      expect(parseSnapshotFile(file({ url })), String(url)).toBeNull();
    }
  });

  it('accepts exactly what validateUrl, the check the window goes through, accepts', () => {
    const urls = [
      ...ACCEPTED_URLS.map(([, url]) => url),
      ...REJECTED_URLS.map(([, url]) => url),
      'https://example.com/a\u0000b',
      'https://example.com/a\u001fb',
      'https://example.com/a\u007fb',
      '\u0000https://example.com/x',
      'https://example.com/x\u0000',
      'HTTPS://EXAMPLE.COM',
      'http://localhost:8080/x',
      'https://exa mple.com/x',
      'https:example.com',
      'https://example.com:99999/x',
      'ws://example.com/x',
      '  \t\n',
      'https://example.com/\u00a0x',
    ];
    for (const url of urls) {
      let windowAccepts = true;
      try {
        validateUrl(url);
      } catch {
        windowAccepts = false;
      }
      const loaderAccepts = parseSnapshotFile(file({ state: 'queued', url })) !== null;
      expect(loaderAccepts, `the url ${JSON.stringify(url)}`).toBe(windowAccepts);
    }
  });

  it('keeps the loader tolerant for old files: a control character inside a queued url still loads (C3)', () => {
    for (const url of ['https://example.com/a\u0000b', 'https://example.com/a\u001fb', 'https://example.com/a\u007fb', 'https://example.com/a\tb']) {
      expect(parseOne({ state: 'queued', url })?.url, JSON.stringify(url)).toBe(url);
    }
  });
});

describe('copyQuality (C2)', () => {
  /** An extra key that cannot be written as JSON, or just does not belong. */
  const circular = (): Record<string, unknown> => {
    const o: Record<string, unknown> = { deep: 1 };
    o['self'] = o;
    return o;
  };
  const EXTRAS: [string, (q: Record<string, unknown>) => unknown][] = [
    ['a bigint', () => 1n],
    ['a circular object', () => circular()],
    ['the quality itself', (q) => q],
    ['text', () => 'x'],
    ['undefined', () => undefined],
    ['a nested object', () => ({ a: { b: 1 } })],
  ];
  const KINDS: [string, Record<string, unknown>, string[]][] = [
    ['best', { kind: 'best' }, ['kind']],
    ['max', { kind: 'max', height: 720 }, ['kind', 'height']],
    ['audio', { kind: 'audio', format: 'mp3' }, ['kind', 'format']],
  ];

  const CLEAN: Quality[] = [
    { kind: 'best' },
    ...HEIGHTS.map((height): Quality => ({ kind: 'max', height })),
    { kind: 'audio', format: 'm4a' },
    { kind: 'audio', format: 'mp3' },
  ];

  it.each(CLEAN.map((q) => [JSON.stringify(q), q] as const))('returns a new object equal to %s', (_label, quality) => {
    const copy = copyQuality(quality);
    expect(copy).toStrictEqual(quality);
    expect(copy).not.toBe(quality);
  });

  it.each(KINDS.flatMap(([kind, base, keys]) => EXTRAS.map(([extra, make]) => [kind, extra, base, make, keys] as const)))(
    'rebuilds a %s quality that carries %s from its declared fields only',
    (_kind, _extra, base, make, keys) => {
      const quality: Record<string, unknown> = { ...base };
      quality['extra'] = make(quality);
      const copy = copyQuality(quality as unknown as Quality);
      expect(copy).toStrictEqual(base);
      expect(Object.keys(copy)).toEqual(keys);
      expect(copy).not.toBe(quality);
      expect(() => JSON.stringify(copy)).not.toThrow();
    },
  );

  it.each([
    ['best with the fields of the other kinds', { kind: 'best', height: 720, format: 'mp3' }, { kind: 'best' }],
    ['max with the format of audio', { kind: 'max', height: 1080, format: 'm4a' }, { kind: 'max', height: 1080 }],
    ['audio with the height of max', { kind: 'audio', format: 'mp3', height: 1080 }, { kind: 'audio', format: 'mp3' }],
  ])('drops the fields of the other kinds: %s', (_name, sent, expected) => {
    expect(copyQuality(sent as unknown as Quality)).toStrictEqual(expected);
  });

  it('builds a plain object, whatever the input was', () => {
    class Odd {
      kind = 'best' as const;
      extra = 1n;
    }
    const copy = copyQuality(new Odd());
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(copy).toStrictEqual({ kind: 'best' });
  });

  it('does not share anything with its input', () => {
    const quality: Quality = { kind: 'max', height: 720 };
    const copy = copyQuality(quality);
    (quality as { height: number }).height = 360;
    expect(copy).toStrictEqual({ kind: 'max', height: 720 });
    (copy as { height: number }).height = 480;
    expect(quality.height).toBe(360);
  });

  it('gives a new object every time', () => {
    const quality: Quality = { kind: 'best' };
    expect(copyQuality(quality)).not.toBe(copyQuality(quality));
  });

  it('returns what isQuality accepts', () => {
    for (const quality of CLEAN) expect(isQuality(copyQuality(quality))).toBe(true);
  });
});

describe('isUsableDoneName (B1)', () => {
  it.each(single(['Talk.mp4', 'Talk.mp4 ', 'a', 'a.', '.a', ' a', 'a ', 'a..b', '...a', 'a...', '. a', 'My talk (final) 2.mp4', 'ملف.mp4', 'CON', 'a*b?.txt', 'a'.repeat(300)]))(
    'accepts %j',
    (name) => {
      expect(isUsableDoneName(name)).toBe(true);
    },
  );

  it.each<[string, unknown]>([
    ['an empty name', ''],
    ['one dot', '.'],
    ['two dots', '..'],
    ['three dots', '...'],
    ['four dots', '....'],
    ['dots and spaces', '. . .'],
    ['dots around a space', ' . '],
    ['one space', ' '],
    ['spaces only', '   '],
    ['a non-breaking space', ' '],
    ['an ideographic space', '　'],
    ['a byte order mark', '﻿'],
    ['a colon', 'a:b'],
    ['an alternate data stream', 'report.txt:payload'],
    ['a backslash', 'a\\b'],
    ['a path up', '..\\evil.exe'],
    ['a slash', 'a/b'],
    ['a leading slash', '/a.mp4'],
    ['a null character', 'a\u0000b'],
    ['a tab', 'a\tb'],
    ['a newline', 'a\nb'],
    ['a unit separator', 'a\u001fb'],
    ['a delete character', 'a\u007fb'],
    ['undefined', undefined],
    ['null', null],
    ['a number', 5],
    ['true', true],
    ['a list', ['Talk.mp4']],
    ['an object', { name: 'Talk.mp4' }],
  ])('refuses %s', (_name, value) => {
    expect(isUsableDoneName(value)).toBe(false);
  });

  it('is the stored-name rule plus a ban on names made only of whitespace and dots', () => {
    const candidates: unknown[] = [
      '', '.', '..', '...', ' ', '   ', '\t', ' ', '　', '﻿', ' . ', '. .',
      'a', 'a.', '.a', ' a', 'a ', 'Talk.mp4 ', 'a:b', 'a\\b', 'a/b', 'a\u0000b', 'a\u007fb', 'a\u001fb', 'a\nb',
      'CON', 'a*b', 'a'.repeat(300), 5, null, undefined, ['a'], {}, true,
    ];
    for (const name of candidates) {
      // The real stored-name rule, read through the loader: a file job needs a name that passes it.
      const stored = parseSnapshotFile(file(fileJob({ fileName: name }))) !== null;
      const blank = typeof name === 'string' && /^[\s.]*$/u.test(name);
      expect(isUsableDoneName(name), `name ${JSON.stringify(name)}`).toBe(stored && !blank);
    }
  });
});
