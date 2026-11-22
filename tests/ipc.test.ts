import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../src/main/engines/engine';
import { createHandlers, type HandlerDeps } from '../src/main/ipc';
import { Queue } from '../src/main/jobs/queue';
import { ACTIVE } from '../src/main/jobs/state';
import { Store } from '../src/main/jobs/store';
import { InvalidUrl, ProbeError } from '../src/main/probe';
import { parseProbe } from '../src/main/ytdlp/parse';
import type { AddRequest, GroupVerb, Job, JobVerb, ProbeResult, Settings, Snapshot } from '../src/shared/types';
import { makeJob, makeSettings } from './helpers';

let dir: string;
let added: AddRequest[];
let verbs: [string, JobVerb | GroupVerb][];
let snapshot: Snapshot;
let settings: Settings;
let savedSettings: Settings[];
let queueSettings: Settings[];
let opened: string[];
let shown: string[];
let probeImpl: (url: string) => Promise<ProbeResult>;
let queueReady: boolean;
let installed: number;
let installFails: boolean;

const media: ProbeResult = { kind: 'media', title: 'Talk', thumbnail: null, heights: [1080] };
const list: ProbeResult = {
  kind: 'playlist',
  title: 'Course',
  entries: [
    { index: 1, url: 'https://example.com/v/1', title: 'One', unavailable: false, reason: null },
    { index: 2, url: 'https://example.com/v/2', title: 'Two', unavailable: false, reason: null },
  ],
};

function deps(): HandlerDeps {
  return {
    queue: () =>
      queueReady
        ? {
            add: (r) => added.push(r),
            job: async (id, verb) => void verbs.push([id, verb]),
            group: async (id, verb) => void verbs.push([id, verb]),
            snapshot: () => snapshot,
            setSettings: (s) => queueSettings.push(s),
          }
        : null,
    getSettings: () => settings,
    saveSettings: (s) => {
      settings = s;
      savedSettings.push(s);
    },
    validateUrl: (raw) => {
      if (!raw.trim().startsWith('http')) throw new InvalidUrl();
      return raw.trim();
    },
    probe: (url) => probeImpl(url),
    binaries: {
      status: async () => [{ name: 'yt-dlp', installed: true, version: '1' }],
      ensureAll: async (onProgress) => {
        if (installFails) throw new Error('could not download ffmpeg: server answered 404');
        onProgress('ffmpeg', 100);
      },
      updateYtDlp: async () => '2026.11.01',
    },
    onInstallProgress: () => undefined,
    afterInstall: async () => void (installed += 1),
    pickFolder: async () => 'D:\\Picked',
    openPath: async (p) => void opened.push(p),
    showItem: (p) => void shown.push(p),
    startupNotice: () => 'jobs.json.corrupt-1',
  };
}

const request = (over: Partial<AddRequest> = {}): AddRequest => ({
  url: 'https://example.com/v',
  probe: media,
  quality: { kind: 'best' },
  subtitleLangs: [],
  dir,
  selectedIndexes: null,
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hammel-ipc-'));
  added = [];
  verbs = [];
  snapshot = { jobs: [], groups: [] };
  settings = makeSettings({ downloadDir: dir });
  savedSettings = [];
  queueSettings = [];
  opened = [];
  shown = [];
  probeImpl = async () => media;
  queueReady = true;
  installed = 0;
  installFails = false;
});

describe('probe', () => {
  it('returns the probe result', async () => {
    expect(await createHandlers(deps()).probe(' https://example.com/v ')).toEqual({ ok: true, value: media });
  });

  it('explains what a link must look like', async () => {
    expect(await createHandlers(deps()).probe('ftp://x')).toEqual({
      ok: false,
      error: 'Enter a link that starts with http:// or https://',
    });
  });

  it('passes on why a link cannot be downloaded', async () => {
    probeImpl = async () => {
      throw new ProbeError('private');
    };
    expect(await createHandlers(deps()).probe('https://x.y')).toEqual({ ok: false, error: 'private' });
  });

  it('never throws across the boundary', async () => {
    probeImpl = async () => {
      throw new Error('boom');
    };
    expect(await createHandlers(deps()).probe('https://x.y')).toEqual({ ok: false, error: 'Something went wrong: boom' });
  });

  it('rejects a value that is not text', async () => {
    expect(await createHandlers(deps()).probe(42 as unknown as string)).toMatchObject({ ok: false });
  });
});

describe('add', () => {
  it('queues a valid request', async () => {
    expect(await createHandlers(deps()).add(request())).toEqual({ ok: true, value: null });
    expect(added).toHaveLength(1);
  });

  it('creates the download folder when it is missing', async () => {
    const target = join(dir, 'new', 'deep');
    await createHandlers(deps()).add(request({ dir: target }));
    expect(existsSync(target)).toBe(true);
    expect(added).toHaveLength(1);
  });

  it('refuses a relative folder', async () => {
    expect(await createHandlers(deps()).add(request({ dir: 'downloads' }))).toMatchObject({ ok: false });
    expect(added).toEqual([]);
  });

  it('reports a folder that cannot be created', async () => {
    writeFileSync(join(dir, 'blocker'), 'a file, not a folder');
    const res = await createHandlers(deps()).add(request({ dir: join(dir, 'blocker', 'sub') }));
    expect(res).toEqual({ ok: false, error: 'cannot write to folder' });
    expect(added).toEqual([]);
  });

  it('asks for at least one playlist item', async () => {
    const res = await createHandlers(deps()).add(request({ probe: list, selectedIndexes: [] }));
    expect(res).toEqual({ ok: false, error: 'Select at least one item' });
  });

  it('refuses a selection that is not in the playlist', async () => {
    expect(await createHandlers(deps()).add(request({ probe: list, selectedIndexes: [1, 7] }))).toMatchObject({ ok: false });
    expect(added).toEqual([]);
  });

  it('accepts a playlist with everything selected', async () => {
    expect(await createHandlers(deps()).add(request({ probe: list, selectedIndexes: [1, 2] }))).toMatchObject({ ok: true });
  });

  it.each([
    ['a non-http link', { url: 'file:///C:/x' }],
    ['a media request without a usable quality', { quality: { kind: 'max', height: 999 } as never }],
    ['a subtitle language that is not a language code', { subtitleLangs: ['en', '--exec calc'] }],
    ['a playlist entry with a non-http link', { probe: { ...list, entries: [{ index: 1, url: 'file:///x', title: 'x', unavailable: false, reason: null }] } }],
    ['a file name that carries a path', { probe: { kind: 'file', fileName: '..\\evil.exe', size: 1, resumable: true } as ProbeResult, quality: null }],
  ])('refuses %s', async (_name, over) => {
    expect(await createHandlers(deps()).add(request(over))).toMatchObject({ ok: false });
    expect(added).toEqual([]);
  });

  it('refuses malformed input instead of throwing', async () => {
    expect(await createHandlers(deps()).add(null as unknown as AddRequest)).toMatchObject({ ok: false });
    expect(await createHandlers(deps()).add({} as AddRequest)).toMatchObject({ ok: false });
  });

  it('says so when the download tools are not installed yet', async () => {
    queueReady = false;
    expect(await createHandlers(deps()).add(request())).toEqual({ ok: false, error: 'Install the download tools first' });
  });
});

/** What a refused request answers: the window cannot add what the stored list would reject (A4). */
const BAD = { ok: false, error: 'That request is not valid' };
const ACCEPTED = { ok: true, value: null };

/** Stands for "the key is not there at all". */
const MISSING = Symbol('missing');

function shaped(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (value === MISSING) delete out[key];
    else out[key] = value;
  }
  return out;
}

const fileRequest = (over: Record<string, unknown> = {}): AddRequest =>
  request({ probe: shaped({ kind: 'file', fileName: 'report.pdf', size: 10, resumable: true }, over) as unknown as ProbeResult, quality: null });

const mediaRequest = (over: Record<string, unknown> = {}): AddRequest =>
  request({ probe: shaped({ kind: 'media', title: 'Talk', thumbnail: null, heights: [1080] }, over) as unknown as ProbeResult });

const entryOf = (over: Record<string, unknown> = {}) =>
  shaped({ index: 1, url: 'https://example.com/v/1', title: 'One', unavailable: false, reason: null }, over);

const listRequest = (entries: unknown[], selectedIndexes: number[] | null = null): AddRequest =>
  request({ probe: { kind: 'playlist', title: 'Course', entries } as unknown as ProbeResult, selectedIndexes });

describe('add refuses what the stored list would reject (A4)', () => {
  describe('file probe', () => {
    it('refuses a device name, a stream name, a trailing dot and an over-long name as file name', async () => {
      const h = createHandlers(deps());
      for (const fileName of ['CON', 'report.txt:payload', 'a.', 'a'.repeat(151)]) {
        expect(await h.add(fileRequest({ fileName })), `file name ${fileName.slice(0, 20)}`).toEqual(BAD);
      }
      expect(added).toEqual([]);
      expect(await h.add(fileRequest({ fileName: 'report (2).pdf' }))).toEqual(ACCEPTED);
      expect(added).toHaveLength(1);
    });

    it.each<[string, unknown]>([
      ['an empty name', ''],
      ['a name that is not text', 5],
      ['a missing name', MISSING],
      ['null', null],
      ['a single dot', '.'],
      ['two dots', '..'],
      ['a device name with an extension', 'NUL.txt'],
      ['a device name in lower case', 'com1'],
      ['a name with a slash', 'a/b.pdf'],
      ['a name with a backslash', 'dir\\a.pdf'],
      ['a name with a colon', 'a:b.pdf'],
      ['a name with a forbidden character', 'a*b.pdf'],
      ['a name with a control character', 'a\u0000b.pdf'],
      ['a name with a trailing space', 'a.pdf '],
      ['a name with a double space', 'a  b.pdf'],
      ['an extension of 17 characters', `a.${'e'.repeat(17)}`],
      ['a name of 151 characters with an extension', `${'a'.repeat(147)}.zip`],
    ])('refuses %s as file name', async (_name, fileName) => {
      expect(await createHandlers(deps()).add(fileRequest({ fileName }))).toEqual(BAD);
      expect(added).toEqual([]);
    });

    it.each([
      ['a name of 150 characters', 'a'.repeat(150)],
      ['a name of 150 characters with an extension', `${'a'.repeat(146)}.zip`],
      ['an extension of 16 characters', `a.${'e'.repeat(16)}`],
      ['a name with spaces and brackets', 'My report (final) 2.pdf'],
      ['an Arabic name', 'ملف.pdf'],
    ])('accepts %s as file name', async (_name, fileName) => {
      expect(await createHandlers(deps()).add(fileRequest({ fileName }))).toEqual(ACCEPTED);
      expect(added).toHaveLength(1);
    });

    it('refuses a file probe with a size that is not a number', async () => {
      const h = createHandlers(deps());
      const sizes: [string, unknown][] = [
        ['text', '10'],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['-Infinity', Number.NEGATIVE_INFINITY],
        ['-1', -1],
        ['an object', {}],
        ['true', true],
        ['missing', MISSING],
      ];
      for (const [label, size] of sizes) {
        expect(await h.add(fileRequest({ size })), `size ${label}`).toEqual(BAD);
      }
      expect(await h.add(fileRequest({ resumable: MISSING })), 'resumable missing').toEqual(BAD);
      expect(added).toEqual([]);
    });

    it.each([null, 0, 1, 123_456_789])('accepts a file probe with the size %s', async (size) => {
      expect(await createHandlers(deps()).add(fileRequest({ size }))).toEqual(ACCEPTED);
      expect(added).toHaveLength(1);
    });

    it.each<[string, unknown]>([
      ['text', 'yes'],
      ['1', 1],
      ['0', 0],
      ['null', null],
      ['an object', {}],
      ['missing', MISSING],
    ])('refuses a file probe whose resumable flag is %s', async (_name, resumable) => {
      expect(await createHandlers(deps()).add(fileRequest({ resumable }))).toEqual(BAD);
      expect(added).toEqual([]);
    });

    it.each([true, false])('accepts a file probe whose resumable flag is %s', async (resumable) => {
      expect(await createHandlers(deps()).add(fileRequest({ resumable }))).toEqual(ACCEPTED);
    });
  });

  describe('media probe', () => {
    it('refuses heights that are not numbers', async () => {
      const h = createHandlers(deps());
      const heights: [string, unknown][] = [
        ['text entries', ['1080']],
        ['a null entry', [1080, null]],
        ['an object entry', [{}]],
        ['NaN', [1080, Number.NaN]],
        ['Infinity', [Number.POSITIVE_INFINITY]],
        ['-Infinity', [Number.NEGATIVE_INFINITY]],
        ['zero', [0]],
        ['a negative number', [-720]],
        ['text instead of a list', '1080'],
        ['a number instead of a list', 1080],
        ['null', null],
        ['an object instead of a list', { 0: 1080 }],
        ['missing', MISSING],
        ['101 numbers', Array.from({ length: 101 }, () => 720)],
      ];
      for (const [label, value] of heights) {
        expect(await h.add(mediaRequest({ heights: value })), `heights ${label}`).toEqual(BAD);
      }
      expect(added).toEqual([]);
    });

    it.each([
      ['an empty list', []],
      ['one height', [1080]],
      ['several heights', [2160, 1080, 720, 360]],
      ['a fraction', [1080.5]],
      ['exactly 100 numbers', Array.from({ length: 100 }, () => 720)],
    ])('accepts a media probe with %s', async (_name, heights) => {
      expect(await createHandlers(deps()).add(mediaRequest({ heights }))).toEqual(ACCEPTED);
      expect(added).toHaveLength(1);
    });

    it.each<[string, unknown]>([
      ['a number', 5],
      ['null', null],
      ['an object', {}],
      ['missing', MISSING],
    ])('refuses a media probe whose title is %s', async (_name, title) => {
      expect(await createHandlers(deps()).add(mediaRequest({ title }))).toEqual(BAD);
      expect(added).toEqual([]);
    });

    it('accepts a media probe with an empty title', async () => {
      expect(await createHandlers(deps()).add(mediaRequest({ title: '' }))).toEqual(ACCEPTED);
    });
  });

  describe('playlist probe', () => {
    it('refuses an unavailable entry without a reason and an available one with a reason', async () => {
      const h = createHandlers(deps());
      const entries: [string, Record<string, unknown>][] = [
        ['unavailable with a null reason', entryOf({ unavailable: true, reason: null })],
        ['unavailable with a missing reason', entryOf({ unavailable: true, reason: MISSING })],
        ['unavailable with a reason that is not an EntryReason', entryOf({ unavailable: true, reason: 'gone' })],
        ['unavailable with a reason that is not text', entryOf({ unavailable: true, reason: 5 })],
        ['available with the reason private', entryOf({ unavailable: false, reason: 'private' })],
        ['available with the reason removed', entryOf({ unavailable: false, reason: 'removed' })],
        ['available with the reason unavailable', entryOf({ unavailable: false, reason: 'unavailable' })],
        ['available with a reason that is not an EntryReason', entryOf({ unavailable: false, reason: 'gone' })],
        ['available with a missing reason', entryOf({ unavailable: false, reason: MISSING })],
      ];
      for (const [label, entry] of entries) {
        expect(await h.add(listRequest([entry, entryOf({ index: 2, url: 'https://example.com/v/2' })])), label).toEqual(BAD);
      }
      expect(added).toEqual([]);
    });

    it.each(['private', 'removed', 'unavailable'] as const)('accepts an unavailable entry with the reason %s, whatever its url says', async (reason) => {
      const h = createHandlers(deps());
      for (const url of ['', 'abc123', 'file:///C:/x']) {
        const entries = [entryOf(), entryOf({ index: 2, url, unavailable: true, reason })];
        expect(await h.add(listRequest(entries)), `url ${url}`).toEqual(ACCEPTED);
      }
      expect(added).toHaveLength(3);
    });

    it.each<[string, unknown]>([
      ['null', null],
      ['a number', 5],
      ['missing', MISSING],
    ])('refuses an unavailable entry whose url is %s', async (_name, url) => {
      const entries = [entryOf(), entryOf({ index: 2, url, unavailable: true, reason: 'private' })];
      expect(await createHandlers(deps()).add(listRequest(entries))).toEqual(BAD);
      expect(added).toEqual([]);
    });

    it.each([
      ['an empty url', ''],
      ['a bare id', 'abc123'],
      ['a file link', 'file:///x'],
    ])('refuses an available entry with %s', async (_name, url) => {
      expect(await createHandlers(deps()).add(listRequest([entryOf({ url })]))).toEqual(BAD);
      expect(added).toEqual([]);
    });

    it.each<[string, unknown]>([
      ['text', 'yes'],
      ['1', 1],
      ['0', 0],
      ['null', null],
      ['missing', MISSING],
    ])('refuses an entry whose unavailable flag is %s', async (_name, unavailable) => {
      expect(await createHandlers(deps()).add(listRequest([entryOf({ unavailable })]))).toEqual(BAD);
      expect(added).toEqual([]);
    });

    it.each<[string, unknown]>([
      ['a number', 5],
      ['null', null],
      ['missing', MISSING],
    ])('refuses an entry whose title is %s', async (_name, title) => {
      expect(await createHandlers(deps()).add(listRequest([entryOf({ title })]))).toEqual(BAD);
      expect(added).toEqual([]);
    });

    it('refuses duplicate playlist positions', async () => {
      const h = createHandlers(deps());
      const one = entryOf({ index: 1 });
      const again = entryOf({ index: 1, url: 'https://example.com/v/9', title: 'Nine' });
      expect(await h.add(listRequest([one, again])), 'two available entries').toEqual(BAD);
      expect(await h.add(listRequest([one, entryOf({ index: 1, url: '', unavailable: true, reason: 'removed' })])), 'an unavailable one repeating an available one').toEqual(BAD);
      expect(
        await h.add(listRequest([entryOf({ index: 3, url: '', unavailable: true, reason: 'private' }), entryOf({ index: 3, url: '', unavailable: true, reason: 'private' })])),
        'two unavailable entries',
      ).toEqual(BAD);
      expect(await h.add(listRequest([one, entryOf({ index: 2, url: 'https://example.com/v/2' }), again], [1, 2])), 'with a selection').toEqual(BAD);
      expect(added).toEqual([]);
      expect(await h.add(listRequest([one, entryOf({ index: 2, url: 'https://example.com/v/2' })]))).toEqual(ACCEPTED);
    });

    it('refuses a playlist position that is not a whole number', async () => {
      const h = createHandlers(deps());
      const positions: [string, unknown][] = [
        ['0', 0],
        ['-1', -1],
        ['a fraction', 1.5],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['-Infinity', Number.NEGATIVE_INFINITY],
        ['text', '1'],
        ['null', null],
        ['an object', {}],
        ['missing', MISSING],
      ];
      for (const [label, index] of positions) {
        expect(await h.add(listRequest([entryOf({ index })])), `position ${label}`).toEqual(BAD);
      }
      expect(added).toEqual([]);
      expect(await h.add(listRequest([entryOf({ index: 1 })]))).toEqual(ACCEPTED);
      expect(await h.add(listRequest([entryOf({ index: 7 })]))).toEqual(ACCEPTED);
    });

    it('refuses an unavailable entry at position 0 as well', async () => {
      const entries = [entryOf(), entryOf({ index: 0, url: '', unavailable: true, reason: 'private' })];
      expect(await createHandlers(deps()).add(listRequest(entries))).toEqual(BAD);
    });

    it.each([
      ['a title that is not text', { kind: 'playlist', title: 5, entries: [] }],
      ['entries that are not a list', { kind: 'playlist', title: 'Course', entries: 'x' }],
      ['an entry that is not an object', { kind: 'playlist', title: 'Course', entries: [null] }],
      ['an unknown kind', { kind: 'torrent', title: 'x' }],
      ['no kind', { title: 'x' }],
    ])('refuses a playlist or probe with %s', async (_name, probe) => {
      expect(await createHandlers(deps()).add(request({ probe: probe as unknown as ProbeResult }))).toEqual(BAD);
      expect(added).toEqual([]);
    });
  });
});

const LANGUAGE_MESSAGE = 'Subtitle languages must be codes like en or ar';

/** An array of this length with only the given positions set: the others are holes, not undefined. */
function holey<T>(length: number, set: Record<number, T> = {}): T[] {
  const list = new Array<T>(length);
  for (const [position, value] of Object.entries(set)) list[Number(position)] = value;
  return list;
}

const threeEntries = () => [1, 2, 3].map((i) => entryOf({ index: i, url: `https://example.com/v/${i}`, title: `Item ${i}` }));

/** One of the four arrays that come from the window, with a request built around it. */
interface WindowArray {
  name: string;
  /** The request that carries `list` where this array belongs. */
  make: (list: unknown[]) => AddRequest;
  /** A valid element for place `i` (0-based). */
  valid: (i: number) => unknown;
  /** The longest list the handler lets through, when it has a limit. */
  max: number | null;
  /** What a refused request answers. */
  answer: unknown;
}

const WINDOW_ARRAYS: WindowArray[] = [
  { name: 'subtitleLangs', make: (list) => request({ subtitleLangs: list as string[] }), valid: (i) => ['en', 'ar', 'de'][i] ?? 'fr', max: 10, answer: { ok: false, error: LANGUAGE_MESSAGE } },
  { name: 'probe.heights', make: (list) => mediaRequest({ heights: list }), valid: () => 1080, max: 100, answer: BAD },
  {
    name: 'probe.entries',
    make: (list) => listRequest(list),
    valid: (i) => entryOf({ index: i + 1, url: `https://example.com/v/${i + 1}`, title: `Item ${i + 1}` }),
    max: null,
    answer: BAD,
  },
  { name: 'selectedIndexes', make: (list) => listRequest(threeEntries(), list as number[]), valid: (i) => i + 1, max: null, answer: BAD },
];

/** Every way a list can have a hole, built for one array; `max` adds the edge of its length limit. */
function holeyShapes(a: WindowArray): [string, unknown[]][] {
  const shapes: [string, unknown[]][] = [
    ['Array(1)', new Array<unknown>(1)],
    ['Array(2)', new Array<unknown>(2)],
    ['a valid value and then a hole', holey<unknown>(2, { 0: a.valid(0) })],
    ['a hole and then a valid value', holey<unknown>(2, { 1: a.valid(1) })],
    ['a hole between valid values', holey<unknown>(3, { 0: a.valid(0), 2: a.valid(2) })],
  ];
  if (a.max !== null) {
    const body = Object.fromEntries(Array.from({ length: a.max - 1 }, (_, i) => [i, a.valid(i)]));
    shapes.push(['the longest list with a hole in the last place', holey<unknown>(a.max, body)]);
    shapes.push(['the longest list made only of holes', new Array<unknown>(a.max)]);
  }
  return shapes;
}

describe('add checks every place of the arrays from the window (B2)', () => {
  const target = () => join(dir, 'new', 'deep');

  const REFUSED = WINDOW_ARRAYS.flatMap((a) =>
    holeyShapes(a).flatMap(([shape, list]) =>
      [false, true].map((cloned) => [a.name, shape, cloned ? 'after a structured clone (as it arrives over IPC)' : 'as given', a, list, cloned] as const),
    ),
  );

  it.each(REFUSED)('refuses %s with %s, %s: nothing is added and no folder is made', async (_array, _shape, _how, a, list, cloned) => {
    const req = { ...a.make(cloned ? structuredClone(list) : list), dir: target() };
    expect(await createHandlers(deps()).add(req)).toEqual(a.answer);
    expect(added).toEqual([]);
    expect(existsSync(target())).toBe(false);
  });

  it.each(WINDOW_ARRAYS.map((a) => [a.name, a] as const))('refuses %s with an undefined in it, which is not a hole but is just as wrong', async (_name, a) => {
    const req = { ...a.make([a.valid(0), undefined]), dir: target() };
    expect(await createHandlers(deps()).add(req)).toEqual(a.answer);
    expect(added).toEqual([]);
    expect(existsSync(target())).toBe(false);
  });

  it.each(WINDOW_ARRAYS.map((a) => [a.name, a] as const))('still accepts %s without a hole, and makes the folder', async (_name, a) => {
    const req = { ...a.make([a.valid(0), a.valid(2)]), dir: target() };
    expect(await createHandlers(deps()).add(req)).toEqual(ACCEPTED);
    expect(added).toHaveLength(1);
    expect(existsSync(target())).toBe(true);
  });

  it.each([
    ['Array(1)', new Array<string>(1)],
    ['a valid code and then a hole', holey(2, { 0: 'en' })],
    ['a hole and then a valid code', holey(2, { 1: 'en' })],
    ['a hole between valid codes', holey(3, { 0: 'en', 2: 'ar' })],
    ['ten places with a hole in the last one', holey(10, Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, 'en'])))],
  ])('refuses new settings whose subtitleLangs is %s, whole and after a structured clone', async (_name, langs) => {
    const h = createHandlers(deps());
    for (const list of [langs, structuredClone(langs)]) {
      expect(await h.setSettings(makeSettings({ downloadDir: dir, subtitleLangs: list }))).toEqual({ ok: false, error: LANGUAGE_MESSAGE });
    }
    expect(savedSettings).toEqual([]);
    expect(queueSettings).toEqual([]);
  });

  it('still saves new settings with a subtitleLangs that has no hole', async () => {
    const res = await createHandlers(deps()).setSettings(makeSettings({ downloadDir: dir, subtitleLangs: structuredClone(['en', 'ar']) }));
    expect(res).toMatchObject({ ok: true, value: { subtitleLangs: ['en', 'ar'] } });
    expect(savedSettings).toHaveLength(1);
    expect(queueSettings).toHaveLength(1);
  });
});

describe('add accepts what parseProbe returns (B3)', () => {
  const output = (count: number) => JSON.stringify({ title: 'Talk', formats: Array.from({ length: count }, (_, i) => ({ height: i + 1 })) });
  const expectedHeights = (count: number) => Array.from({ length: Math.min(count, 100) }, (_, i) => count - i);

  it.each([0, 1, 99, 100, 101, 150, 1000])('answers ok for the real probe output of %d distinct heights, and passes on at most 100 of them', async (count) => {
    const probe = parseProbe(output(count));
    expect(await createHandlers(deps()).add(request({ probe }))).toEqual(ACCEPTED);
    expect(added).toHaveLength(1);
    const sent = added[0]?.probe;
    expect(sent?.kind === 'media' && sent.heights).toEqual(expectedHeights(count));
  });

  it('answers ok for the same probe after a structured clone', async () => {
    const probe = structuredClone(parseProbe(output(101)));
    expect(await createHandlers(deps()).add(request({ probe }))).toEqual(ACCEPTED);
  });

  it('still refuses a list of 101 heights that was not made by parseProbe', async () => {
    const heights = Array.from({ length: 101 }, (_, i) => 101 - i);
    expect(await createHandlers(deps()).add(mediaRequest({ heights }))).toEqual(BAD);
    expect(added).toEqual([]);
  });
});

/** The fake engines of the queue specs; the file engine carries both limit calls from the start. */
class FakeEngine implements Engine {
  started: Job[] = [];
  on(): void {
    return; // these specs never make an engine report anything
  }
  start(job: Job): void {
    this.started.push(job);
  }
  async stop(): Promise<void> {
    return;
  }
  async discard(): Promise<void> {
    return;
  }
  async setGlobalLimit(): Promise<void> {
    return;
  }
  async setRateLimit(): Promise<void> {
    return;
  }
}

describe('what add accepts loads again from disk', () => {
  const DOWNLOADS = 'C:\\Users\\me\\Downloads';
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'hammel-ipc-data-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  const hostile = `CON ${'x'.repeat(500)}. `;
  const takenName = `${'a'.repeat(146)}.zip`;
  const placeholders = () => [
    entryOf({ index: 1, url: 'https://example.com/v/1', title: 'One' }),
    entryOf({ index: 2, url: '', title: 'Two', unavailable: true, reason: 'private' }),
    entryOf({ index: 3, url: 'abc123', title: 'Three', unavailable: true, reason: 'removed' }),
    entryOf({ index: 4, url: 'https://example.com/v/4', title: 'Four' }),
  ];

  const cases: [string, () => void, () => AddRequest][] = [
    ['a video', () => undefined, () => request()],
    ['a video with a very long, awkward title', () => undefined, () => mediaRequest({ title: hostile, heights: [] })],
    ['a video with a quality and subtitles', () => undefined, () => request({ quality: { kind: 'max', height: 720 }, subtitleLangs: ['en', 'pt-BR'] })],
    ['a file', () => undefined, () => fileRequest()],
    ['a file whose name is taken in the folder', () => writeFileSync(join(dir, takenName), 'old'), () => fileRequest({ fileName: takenName })],
    ['a playlist with a placeholder without a link and one with a bare id', () => undefined, () => listRequest(placeholders())],
    ['a playlist with some items selected', () => undefined, () => listRequest(placeholders(), [4])],
  ];

  it.each(cases)('%s', async (_name, prepare, make) => {
    prepare();
    const store = new Store(dataDir, DOWNLOADS);
    const queue = new Queue({
      store,
      media: new FakeEngine(),
      file: new FakeEngine(),
      initial: { jobs: [], groups: [] },
      settings: makeSettings({ downloadDir: dir }),
      setTimer: () => undefined,
    });
    const handlers = createHandlers({ ...deps(), queue: () => queue });

    expect(await handlers.add(make())).toEqual(ACCEPTED);

    const inQueue = queue.snapshot();
    expect(inQueue.jobs.length).toBeGreaterThan(0);
    const { snapshot, recoveredCorrupt } = new Store(dataDir, DOWNLOADS).load();
    expect(recoveredCorrupt).toBeNull();
    expect(snapshot.groups).toEqual(inQueue.groups);
    // What a load does to a job found running: paused, no speed, no eta, cut off.
    const found = inQueue.jobs.map((j): Job => (ACTIVE.has(j.state) ? { ...j, state: 'paused', speed: 0, eta: null, interrupted: true } : j));
    expect(snapshot.jobs).toEqual(found);
  });

  it('keeps the placeholders of a playlist with their own urls', async () => {
    const store = new Store(dataDir, DOWNLOADS);
    const queue = new Queue({
      store,
      media: new FakeEngine(),
      file: new FakeEngine(),
      initial: { jobs: [], groups: [] },
      settings: makeSettings({ downloadDir: dir }),
      setTimer: () => undefined,
    });
    await createHandlers({ ...deps(), queue: () => queue }).add(listRequest(placeholders()));
    const { snapshot } = new Store(dataDir, DOWNLOADS).load();
    expect(snapshot.jobs.filter((j) => j.state === 'skipped').map((j) => [j.index, j.url])).toEqual([
      [2, ''],
      [3, 'abc123'],
    ]);
  });
});

describe('add refuses an array with a hole and leaves the real queue and its file as they were (B2)', () => {
  const DOWNLOADS = 'C:\\Users\\me\\Downloads';
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'hammel-ipc-data-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  const CASES: [string, () => AddRequest, unknown][] = [
    ['a playlist with a valid entry and then a hole', () => listRequest(holey<unknown>(2, { 0: entryOf() })), BAD],
    ['a playlist with a hole and then a valid entry', () => listRequest(holey<unknown>(2, { 1: entryOf({ index: 2, url: 'https://example.com/v/2' }) })), BAD],
    ['a playlist that is one hole', () => listRequest(new Array<unknown>(1)), BAD],
    ['a selection that is one hole', () => listRequest(threeEntries(), new Array<number>(1)), BAD],
    ['a selection of a valid position and then a hole', () => listRequest(threeEntries(), holey(2, { 0: 1 })), BAD],
    ['a video whose subtitle languages are one hole', () => request({ subtitleLangs: new Array<string>(1) }), { ok: false, error: LANGUAGE_MESSAGE }],
    ['a video with a valid language and then a hole', () => request({ subtitleLangs: holey(2, { 0: 'en' }) }), { ok: false, error: LANGUAGE_MESSAGE }],
    ['a video whose heights are one hole', () => mediaRequest({ heights: new Array<number>(1) }), BAD],
    ['a video with a valid height and then a hole', () => mediaRequest({ heights: holey(2, { 0: 1080 }) }), BAD],
  ];

  it.each(CASES)('%s: refused, and the snapshot, the saves and jobs.json stay unchanged', async (_name, make, answer) => {
    const store = new Store(dataDir, DOWNLOADS);
    const save = vi.spyOn(store, 'saveSnapshot'); // it still calls the real Store
    const queue = new Queue({
      store,
      media: new FakeEngine(),
      file: new FakeEngine(),
      initial: { jobs: [], groups: [] },
      settings: makeSettings({ downloadDir: dir }),
      setTimer: () => undefined,
    });
    const handlers = createHandlers({ ...deps(), queue: () => queue });
    expect(await handlers.add(request())).toEqual(ACCEPTED); // a job to protect

    const before = queue.snapshot();
    const savesBefore = save.mock.calls.length;
    const fileBefore = readFileSync(join(dataDir, 'jobs.json'), 'utf8');

    expect(await handlers.add(make())).toEqual(answer);

    expect(queue.snapshot()).toEqual(before);
    expect(save.mock.calls.length).toBe(savesBefore);
    expect(readFileSync(join(dataDir, 'jobs.json'), 'utf8')).toBe(fileBefore);

    // The next good request works, and the list still loads: nothing poisoned the next save.
    expect(await handlers.add(request({ url: 'https://example.com/other' }))).toEqual(ACCEPTED);
    const { snapshot: loaded, recoveredCorrupt } = new Store(dataDir, DOWNLOADS).load();
    expect(recoveredCorrupt).toBeNull();
    expect(loaded.jobs).toHaveLength(before.jobs.length + 1);
  });
});

describe('job and group actions', () => {
  it('forwards a known verb', async () => {
    const h = createHandlers(deps());
    expect(await h.job('j1', 'pause')).toEqual({ ok: true, value: null });
    expect(await h.group('g1', 'cancel')).toEqual({ ok: true, value: null });
    expect(verbs).toEqual([
      ['j1', 'pause'],
      ['g1', 'cancel'],
    ]);
  });

  it('refuses an unknown verb', async () => {
    const h = createHandlers(deps());
    expect(await h.job('j1', 'explode' as JobVerb)).toMatchObject({ ok: false });
    expect(await h.group('g1', 'remove' as GroupVerb)).toMatchObject({ ok: false });
    expect(verbs).toEqual([]);
  });

  it('gives an empty snapshot before the queue exists', async () => {
    queueReady = false;
    expect(await createHandlers(deps()).snapshot()).toEqual({ jobs: [], groups: [] });
  });
});

describe('settings', () => {
  it('clamps, saves and applies new settings', async () => {
    const res = await createHandlers(deps()).setSettings(makeSettings({ downloadDir: dir, maxConcurrent: 99 }));
    expect(res).toMatchObject({ ok: true, value: { maxConcurrent: 8 } });
    expect(savedSettings[0]?.maxConcurrent).toBe(8);
    expect(queueSettings[0]?.maxConcurrent).toBe(8);
  });

  it('refuses a relative download folder', async () => {
    expect(await createHandlers(deps()).setSettings(makeSettings({ downloadDir: 'here' }))).toMatchObject({ ok: false });
    expect(savedSettings).toEqual([]);
  });

  it('refuses a broken default quality or subtitle list', async () => {
    const h = createHandlers(deps());
    expect(await h.setSettings(makeSettings({ downloadDir: dir, defaultQuality: { kind: 'nope' } as never }))).toMatchObject({ ok: false });
    expect(await h.setSettings(makeSettings({ downloadDir: dir, subtitleLangs: ['-x'] }))).toMatchObject({ ok: false });
  });

  it('saves settings even before the queue exists', async () => {
    queueReady = false;
    expect(await createHandlers(deps()).setSettings(makeSettings({ downloadDir: dir }))).toMatchObject({ ok: true });
    expect(savedSettings).toHaveLength(1);
  });
});

describe('opening files', () => {
  const doneJob = () => makeJob({ id: 'j1', state: 'done', dir, fileName: 'Talk.mp4' });

  it('opens the finished file of a job', async () => {
    writeFileSync(join(dir, 'Talk.mp4'), 'video');
    snapshot = { jobs: [doneJob()], groups: [] };
    expect(await createHandlers(deps()).openFile('j1')).toEqual({ ok: true, value: null });
    expect(opened).toEqual([join(dir, 'Talk.mp4')]);
  });

  it('says so when the file is gone', async () => {
    snapshot = { jobs: [doneJob()], groups: [] };
    expect(await createHandlers(deps()).openFile('j1')).toEqual({ ok: false, error: 'The file is no longer there' });
    expect(opened).toEqual([]);
  });

  it('does not open anything for an unfinished or unknown job', async () => {
    snapshot = { jobs: [makeJob({ id: 'j2', state: 'downloading', dir })], groups: [] };
    const h = createHandlers(deps());
    expect(await h.openFile('j2')).toMatchObject({ ok: false });
    expect(await h.openFile('nope')).toMatchObject({ ok: false });
    expect(opened).toEqual([]);
  });

  it('shows the finished file in its folder', async () => {
    writeFileSync(join(dir, 'Talk.mp4'), 'video');
    snapshot = { jobs: [doneJob()], groups: [] };
    await createHandlers(deps()).openFolder('j1');
    expect(shown).toEqual([join(dir, 'Talk.mp4')]);
  });

  it('opens the folder itself when there is no finished file yet', async () => {
    snapshot = { jobs: [makeJob({ id: 'j2', state: 'downloading', dir })], groups: [] };
    expect(await createHandlers(deps()).openFolder('j2')).toEqual({ ok: true, value: null });
    expect(opened).toEqual([dir]);
  });

  it('says so when the folder is gone', async () => {
    snapshot = { jobs: [makeJob({ id: 'j2', state: 'paused', dir: join(dir, 'gone') })], groups: [] };
    expect(await createHandlers(deps()).openFolder('j2')).toEqual({ ok: false, error: 'The folder is no longer there' });
  });
});

describe('download tools', () => {
  it('installs and then starts the engines', async () => {
    expect(await createHandlers(deps()).installBinaries()).toEqual({ ok: true, value: null });
    expect(installed).toBe(1);
  });

  it('reports a failed install and does not start the engines', async () => {
    installFails = true;
    expect(await createHandlers(deps()).installBinaries()).toEqual({
      ok: false,
      error: 'could not download ffmpeg: server answered 404',
    });
    expect(installed).toBe(0);
  });

  it('updates yt-dlp and returns the version', async () => {
    expect(await createHandlers(deps()).updateYtDlp()).toEqual({ ok: true, value: '2026.11.01' });
  });

  it('passes the startup notice on', async () => {
    expect(await createHandlers(deps()).startupNotice()).toBe('jobs.json.corrupt-1');
  });
});

describe('cleanup', () => {
  it('leaves the temp folder removable', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
  });
});
