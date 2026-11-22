import { describe, expect, it } from 'vitest';
import { copyQuality, isAbsoluteDir, isLangList, isQuality, isUsableDoneName, normalizeSettings, parseSettings, parseSnapshotFile } from '../../src/main/jobs/validate';
import { validateUrl } from '../../src/main/probe';
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
