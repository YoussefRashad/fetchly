import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../src/main/engines/engine';
import { createHandlers, type Handlers, type HandlerDeps } from '../src/main/ipc';
import { Queue } from '../src/main/jobs/queue';
import { ACTIVE } from '../src/main/jobs/state';
import { Store } from '../src/main/jobs/store';
import { InvalidUrl, ProbeError, validateUrl as realValidateUrl } from '../src/main/probe';
import { parseProbe } from '../src/main/ytdlp/parse';
import type { AddRequest, EngineStatus, GroupVerb, Job, JobVerb, ProbeResult, Quality, Result, Settings, Snapshot } from '../src/shared/types';
import { makeJob, makeSettings } from './helpers';
import { makeIpcServerFixture, type IpcFixture } from './server/fakes';

let dir: string;
/** A1 fixture: the pairing store, the server and the port-change dialog that HandlerDeps now needs. */
let ipcServer: IpcFixture;
let added: AddRequest[];
let verbs: [string, JobVerb | GroupVerb][];
let snapshot: Snapshot;
let settings: Settings;
let savedSettings: Settings[];
let queueSettings: Settings[];
let opened: string[];
/** The file names the user was asked about before opening, and the answer the fake gives. */
let askedToOpen: string[];
let openAnswer: boolean;
let shown: string[];
let probeImpl: (url: string) => Promise<ProbeResult>;
let probed: string[];
let queueReady: boolean;
let installed: number;
let installFails: boolean;
/** The engine status the fake host reports (9.3). */
let engine: EngineStatus;
let saveError: string | null;
/** What the fake queue answers to job() and group(). */
let verbResult: Result<null>;
let confirmed: number;
let retries: number;
/** What the fake host does when the window asks to retry. */
let retryImpl: () => Promise<void>;
/** What the fake afterInstall does besides counting. */
let afterInstallImpl: () => Promise<void>;

/** What the A1 fixture's fake server reports (status.server in the status answers). */
const LISTENING = { state: 'listening', port: 38917 } as const;

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
            job: async (id, verb) => {
              verbs.push([id, verb]);
              return verbResult;
            },
            group: async (id, verb) => {
              verbs.push([id, verb]);
              return verbResult;
            },
            confirmStraysGone: () => void (confirmed += 1),
            snapshot: () => snapshot,
            setSettings: (s) => queueSettings.push(s),
          }
        : null,
    status: () => ({ engine, saveError, server: ipcServer.state.current }),
    ...ipcServer.deps,
    retryEngines: async () => {
      retries += 1;
      await retryImpl();
    },
    getSettings: () => settings,
    saveSettings: (s) => {
      settings = s;
      savedSettings.push(s);
    },
    validateUrl: (raw) => {
      if (!raw.trim().startsWith('http')) throw new InvalidUrl();
      return raw.trim();
    },
    probe: (url) => {
      probed.push(url);
      return probeImpl(url);
    },
    binaries: {
      status: async () => [{ name: 'yt-dlp', installed: true, version: '1' }],
      ensureAll: async (onProgress) => {
        if (installFails) throw new Error('could not download ffmpeg: server answered 404');
        onProgress('ffmpeg', 100);
      },
      updateYtDlp: async () => '2026.11.01',
    },
    onInstallProgress: () => undefined,
    afterInstall: async () => {
      installed += 1;
      await afterInstallImpl();
    },
    pickFolder: async () => 'D:\\Picked',
    openPath: async (p) => void opened.push(p),
    confirmOpenRunnable: async (name) => {
      askedToOpen.push(name);
      return openAnswer;
    },
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
  dir = mkdtempSync(join(tmpdir(), 'fetchly-ipc-'));
  ipcServer = makeIpcServerFixture();
  added = [];
  verbs = [];
  snapshot = { jobs: [], groups: [] };
  settings = makeSettings({ downloadDir: dir });
  savedSettings = [];
  queueSettings = [];
  opened = [];
  askedToOpen = [];
  openAnswer = false;
  shown = [];
  probeImpl = async () => media;
  probed = [];
  queueReady = true;
  installed = 0;
  installFails = false;
  engine = { state: 'ready' };
  saveError = null;
  verbResult = { ok: true, value: null };
  confirmed = 0;
  retries = 0;
  retryImpl = async () => undefined;
  afterInstallImpl = async () => undefined;
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
    engine = { state: 'notInstalled' };
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

/** The fake engines of the queue specs. */
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
  async setRateLimit(): Promise<boolean> {
    return true;
  }
}

describe('what add accepts loads again from disk', () => {
  const DOWNLOADS = 'C:\\Users\\me\\Downloads';
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fetchly-ipc-data-'));
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
      straysCleared: true,
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
      straysCleared: true,
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
    dataDir = mkdtempSync(join(tmpdir(), 'fetchly-ipc-data-'));
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
      straysCleared: true,
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

  describe('language and theme', () => {
    const LANGUAGES = ['system', 'en', 'ar'] as const;
    const THEMES = ['system', 'light', 'dark'] as const;

    it.each(LANGUAGES.flatMap((language) => THEMES.map((theme) => [language, theme] as const)))(
      'keeps the language %s and the theme %s in the save, the queue and the answer',
      async (language, theme) => {
        const res = await createHandlers(deps()).setSettings(makeSettings({ downloadDir: dir, language, theme }));
        expect(res).toMatchObject({ ok: true, value: { language, theme } });
        expect(savedSettings).toHaveLength(1);
        expect(savedSettings[0]).toMatchObject({ language, theme });
        expect(queueSettings[0]).toMatchObject({ language, theme });
      },
    );

    const BAD: [string, unknown][] = [
      ['missing', undefined],
      ['null', null],
      ['a number', 1],
      ['true', true],
      ['empty text', ''],
      ['an array', ['ar']],
      ['an object', { value: 'ar' }],
      ['unknown', 'auto'],
    ];
    const BAD_LANGUAGE: [string, unknown][] = [...BAD, ['wrong case', 'AR'], ['wrong case', 'System'], ['unknown', 'fr'], ['a theme value', 'dark']];
    const BAD_THEME: [string, unknown][] = [...BAD, ['wrong case', 'Dark'], ['wrong case', 'System'], ['a language value', 'ar']];

    it.each(BAD_LANGUAGE)('refuses a language that is %s (%j) and saves nothing', async (_what, bad) => {
      const sent = { ...makeSettings({ downloadDir: dir, theme: 'dark' }), language: bad } as Record<string, unknown>;
      if (bad === undefined) delete sent['language'];
      expect(await createHandlers(deps()).setSettings(sent as unknown as Settings)).toEqual({ ok: false, error: 'That request is not valid' });
      expect(savedSettings).toEqual([]);
      expect(queueSettings).toEqual([]);
    });

    it.each(BAD_THEME)('refuses a theme that is %s (%j) and saves nothing', async (_what, bad) => {
      const sent = { ...makeSettings({ downloadDir: dir, language: 'ar' }), theme: bad } as Record<string, unknown>;
      if (bad === undefined) delete sent['theme'];
      expect(await createHandlers(deps()).setSettings(sent as unknown as Settings)).toEqual({ ok: false, error: 'That request is not valid' });
      expect(savedSettings).toEqual([]);
      expect(queueSettings).toEqual([]);
    });

    it('refuses before it looks at the other fields', async () => {
      const sent = { ...makeSettings({ downloadDir: 'relative' }), language: 'xx' } as unknown as Settings;
      expect(await createHandlers(deps()).setSettings(sent)).toEqual({ ok: false, error: 'That request is not valid' });
    });
  });
});

describe('opening files', () => {
  const doneJob = () => makeJob({ id: 'j1', state: 'done', dir, fileName: 'Talk.mp4' });

  it('opens the finished file of a job', async () => {
    writeFileSync(join(dir, 'Talk.mp4'), 'video');
    snapshot = { jobs: [doneJob()], groups: [] };
    expect(await createHandlers(deps()).openFile('j1')).toEqual({ ok: true, value: null });
    expect(opened).toEqual([join(dir, 'Talk.mp4')]);
    expect(askedToOpen).toEqual([]);
  });

  describe('a file that can run a program', () => {
    const runnable = (fileName: string) => {
      writeFileSync(join(dir, fileName), 'x');
      snapshot = { jobs: [makeJob({ id: 'j1', state: 'done', dir, fileName })], groups: [] };
    };

    it.each(['setup.exe', 'Invoice.pdf.lnk', 'site.url', 'run.HTA', 'disk.iso', 'tool.exe.'])('asks before opening %s, and opens nothing on Cancel', async (name) => {
      runnable(name);
      openAnswer = false;
      expect(await createHandlers(deps()).openFile('j1')).toEqual({ ok: true, value: null });
      expect(askedToOpen).toEqual([name]);
      expect(opened).toEqual([]);
    });

    it('opens it once the user says Open', async () => {
      runnable('setup.exe');
      openAnswer = true;
      expect(await createHandlers(deps()).openFile('j1')).toEqual({ ok: true, value: null });
      expect(askedToOpen).toEqual(['setup.exe']);
      expect(opened).toEqual([join(dir, 'setup.exe')]);
    });

    it('does not ask about a file that is gone', async () => {
      snapshot = { jobs: [makeJob({ id: 'j1', state: 'done', dir, fileName: 'setup.exe' })], groups: [] };
      expect(await createHandlers(deps()).openFile('j1')).toEqual({ ok: false, error: 'The file is no longer there' });
      expect(askedToOpen).toEqual([]);
    });

    it('turns a failing question into an error, opening nothing', async () => {
      runnable('setup.exe');
      const d = deps();
      d.confirmOpenRunnable = async () => {
        throw new Error('no window');
      };
      expect(await createHandlers(d).openFile('j1')).toEqual({ ok: false, error: 'Something went wrong: no window' });
      expect(opened).toEqual([]);
    });

    it('never asks before showing it in its folder', async () => {
      runnable('setup.exe');
      await createHandlers(deps()).openFolder('j1');
      expect(shown).toEqual([join(dir, 'setup.exe')]);
      expect(askedToOpen).toEqual([]);
    });
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

const INSTALL_TEXT = 'Install the download tools first';
const STARTING_TEXT = 'The download tools are still starting';
const INVALID_URL_TEXT = 'Enter a link that starts with http:// or https://';
const START_FAILED: EngineStatus = { state: 'error', message: 'The download tools could not be started: spawn aria2c ENOENT' };
const SERVICE_STOPPED: EngineStatus = { state: 'error', message: 'The file download service stopped' };
const READY: EngineStatus = { state: 'ready' };

/** Every engine status a window can meet, and the text a handler answers when the status has no queue behind it. */
const NO_QUEUE: [string, EngineStatus, string][] = [
  ['notInstalled', { state: 'notInstalled' }, INSTALL_TEXT],
  ['starting', { state: 'starting' }, STARTING_TEXT],
  ['error after a failed start', START_FAILED, 'The download tools could not be started: spawn aria2c ENOENT'],
  ['error after an aria2 exit', SERVICE_STOPPED, 'The file download service stopped'],
];

/** The four handlers that need a queue. */
const NEEDS_A_QUEUE: [string, (h: Handlers) => Promise<Result<null>>][] = [
  ['add', (h) => h.add(request())],
  ['job', (h) => h.job('j1', 'pause')],
  ['group', (h) => h.group('g1', 'pause')],
  ['confirmStraysGone', (h) => h.confirmStraysGone()],
];

const flushPromises = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** U+0000-U+001F and U+007F: what C3 keeps out of a link. */
const CONTROL_CODES: number[] = [...Array.from({ length: 0x20 }, (_, i) => i), 0x7f];
const codeLabel = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
const chr = (code: number): string => String.fromCharCode(code);

function circular(): Record<string, unknown> {
  const o: Record<string, unknown> = { deep: 1 };
  o['self'] = o;
  return o;
}

/** Every kind of Quality, as the window sends it and as it must come out. */
const KINDS: [string, Record<string, unknown>, Quality][] = [
  ['best', { kind: 'best' }, { kind: 'best' }],
  ['max', { kind: 'max', height: 720 }, { kind: 'max', height: 720 }],
  ['audio', { kind: 'audio', format: 'mp3' }, { kind: 'audio', format: 'mp3' }],
];

/** An extra key a window could send: it may not be writable as JSON, or it just does not belong. */
const EXTRAS: [string, (q: Record<string, unknown>) => unknown][] = [
  ['a bigint', () => 1n],
  ['a circular object', () => circular()],
  ['the quality itself', (q) => q],
  ['text', () => 'x'],
  ['a nested object', () => ({ a: { b: 1 } })],
  ['undefined', () => undefined],
];

function withExtra(base: Record<string, unknown>, make: (q: Record<string, unknown>) => unknown): Record<string, unknown> {
  const quality: Record<string, unknown> = { ...base };
  quality['extra'] = make(quality);
  return quality;
}

/** One row per kind and per extra: the kind, the extra, the base, the extra's maker, what must come out. */
const QUALITY_ROWS = KINDS.flatMap(([kind, base, declared]) => EXTRAS.map(([extra, make]) => [kind, extra, base, make, declared] as const));

describe('job and group results (9.3)', () => {
  const JOB_VERBS_ALL: JobVerb[] = ['pause', 'resume', 'cancel', 'retry', 'remove', 'removeWithFile'];
  const GROUP_VERBS_ALL: GroupVerb[] = ['pause', 'resume', 'cancel'];

  it('passes on why a verb failed', async () => {
    verbResult = { ok: false, error: 'x' };
    const h = createHandlers(deps());
    expect(await h.job('j1', 'pause')).toEqual({ ok: false, error: 'x' });
    expect(await h.group('g1', 'cancel')).toEqual({ ok: false, error: 'x' });
  });

  it.each(JOB_VERBS_ALL)('passes on a failed job verb %s with its own text', async (verb) => {
    verbResult = { ok: false, error: `could not ${verb}: the download did not stop` };
    expect(await createHandlers(deps()).job('j1', verb)).toEqual({ ok: false, error: `could not ${verb}: the download did not stop` });
    expect(verbs).toEqual([['j1', verb]]);
  });

  it.each(GROUP_VERBS_ALL)('passes on a failed group verb %s with its own text', async (verb) => {
    verbResult = { ok: false, error: `could not ${verb}: the download did not stop` };
    expect(await createHandlers(deps()).group('g1', verb)).toEqual({ ok: false, error: `could not ${verb}: the download did not stop` });
    expect(verbs).toEqual([['g1', verb]]);
  });

  it('passes on the text of a queue that is closing', async () => {
    verbResult = { ok: false, error: 'Fetchly is closing' };
    expect(await createHandlers(deps()).job('j1', 'resume')).toEqual({ ok: false, error: 'Fetchly is closing' });
  });

  it.each(JOB_VERBS_ALL)('answers ok for a job verb %s that worked', async (verb) => {
    expect(await createHandlers(deps()).job('j1', verb)).toEqual({ ok: true, value: null });
  });

  it.each(GROUP_VERBS_ALL)('answers ok for a group verb %s that worked', async (verb) => {
    expect(await createHandlers(deps()).group('g1', verb)).toEqual({ ok: true, value: null });
  });

  it('does not turn a failed result into ok because the queue answered', async () => {
    const h = createHandlers(deps());
    verbResult = { ok: false, error: 'first' };
    expect(await h.job('j1', 'pause')).toMatchObject({ ok: false });
    verbResult = { ok: true, value: null };
    expect(await h.job('j1', 'pause')).toMatchObject({ ok: true });
    verbResult = { ok: false, error: 'second' };
    expect(await h.group('g1', 'pause')).toEqual({ ok: false, error: 'second' });
  });

  it('still never throws across the boundary when the queue itself throws', async () => {
    const throwing = { ...deps(), queue: () => ({ add: () => undefined, job: async () => Promise.reject(new Error('boom')), group: async () => Promise.reject(new Error('boom')), confirmStraysGone: () => undefined, snapshot: () => snapshot, setSettings: () => undefined }) };
    const h = createHandlers(throwing);
    expect(await h.job('j1', 'pause')).toEqual({ ok: false, error: 'Something went wrong: boom' });
    expect(await h.group('g1', 'pause')).toEqual({ ok: false, error: 'Something went wrong: boom' });
  });
});

describe('without a queue the handlers say why (9.3)', () => {
  it('reports the start error instead of asking to install', async () => {
    queueReady = false;
    const h = createHandlers(deps());
    engine = START_FAILED;
    expect(await h.add(request())).toEqual({ ok: false, error: 'The download tools could not be started: spawn aria2c ENOENT' });
    engine = { state: 'starting' };
    expect(await h.add(request())).toEqual({ ok: false, error: 'The download tools are still starting' });
    engine = { state: 'notInstalled' };
    expect(await h.add(request())).toEqual({ ok: false, error: 'Install the download tools first' });
  });

  it.each(NEEDS_A_QUEUE.flatMap(([handler, run]) => NO_QUEUE.map(([state, status, text]) => [handler, state, run, status, text] as const)))(
    '%s answers the status text while the engine is %s',
    async (_handler, _state, run, status, text) => {
      queueReady = false;
      engine = status;
      expect(await run(createHandlers(deps()))).toEqual({ ok: false, error: text });
      expect(added).toEqual([]);
      expect(verbs).toEqual([]);
      expect(confirmed).toBe(0);
    },
  );

  it.each(NEEDS_A_QUEUE)('%s reads the status again on every call', async (_handler, run) => {
    queueReady = false;
    const h = createHandlers(deps());
    for (const [, status, text] of [...NO_QUEUE, ...[...NO_QUEUE].reverse()]) {
      engine = status;
      expect(await run(h), text).toEqual({ ok: false, error: text });
    }
  });

  it('does not make the download folder when there is no queue', async () => {
    queueReady = false;
    engine = { state: 'starting' };
    const target = join(dir, 'new', 'deep');
    expect(await createHandlers(deps()).add(request({ dir: target }))).toEqual({ ok: false, error: STARTING_TEXT });
    expect(existsSync(target)).toBe(false);
    expect(probed).toEqual([]);
  });

  it.each([
    ['notInstalled', { state: 'notInstalled' }],
    ['starting', { state: 'starting' }],
    ['ready', READY],
    ['error after a failed start', START_FAILED],
    ['error after an aria2 exit', SERVICE_STOPPED],
  ] as [string, EngineStatus][])('with a queue every handler works while the engine is %s', async (_state, status) => {
    engine = status;
    const h = createHandlers(deps());
    expect(await h.add(request())).toEqual(ACCEPTED);
    expect(await h.job('j1', 'pause')).toEqual(ACCEPTED);
    expect(await h.group('g1', 'resume')).toEqual(ACCEPTED);
    expect(await h.confirmStraysGone()).toEqual(ACCEPTED);
    expect(added).toHaveLength(1);
    expect(verbs).toEqual([
      ['j1', 'pause'],
      ['g1', 'resume'],
    ]);
    expect(confirmed).toBe(1);
  });

  it('does not need a queue to probe, to read settings or to show the snapshot', async () => {
    queueReady = false;
    engine = { state: 'notInstalled' };
    const h = createHandlers(deps());
    expect(await h.probe('https://example.com/v')).toEqual({ ok: true, value: media });
    expect(await h.getSettings()).toBe(settings);
    expect(await h.snapshot()).toEqual({ jobs: [], groups: [] });
  });
});

describe('status, retryEngines and confirmStraysGone (9.3)', () => {
  const ENGINES: [string, EngineStatus][] = [
    ['notInstalled', { state: 'notInstalled' }],
    ['starting', { state: 'starting' }],
    ['ready', READY],
    ['error', START_FAILED],
    ['error after an aria2 exit', SERVICE_STOPPED],
  ];
  const SAVE_ERRORS: [string, string | null][] = [
    ['no save error', null],
    ['a save error', 'could not save the download list: EACCES: permission denied'],
  ];

  it.each(ENGINES.flatMap(([name, status]) => SAVE_ERRORS.map(([label, error]) => [name, label, status, error] as const)))(
    'status returns the engine state and the save error: %s, %s',
    async (_engine, _label, status, error) => {
      engine = status;
      saveError = error;
      expect(await createHandlers(deps()).status()).toStrictEqual({ engine: status, saveError: error, server: LISTENING });
    },
  );

  it('status answers with or without a queue', async () => {
    engine = START_FAILED;
    saveError = 'could not save the download list: disk full';
    for (const ready of [true, false]) {
      queueReady = ready;
      expect(await createHandlers(deps()).status()).toStrictEqual({
        engine: START_FAILED,
        saveError: 'could not save the download list: disk full',
        server: LISTENING,
      });
    }
  });

  it('status follows the engine and the save error as they change', async () => {
    const h = createHandlers(deps());
    expect(await h.status()).toStrictEqual({ engine: READY, saveError: null, server: LISTENING });
    engine = SERVICE_STOPPED;
    expect(await h.status()).toStrictEqual({ engine: SERVICE_STOPPED, saveError: null, server: LISTENING });
    saveError = 'could not save the download list: disk full';
    expect(await h.status()).toStrictEqual({
      engine: SERVICE_STOPPED,
      saveError: 'could not save the download list: disk full',
      server: LISTENING,
    });
    engine = READY;
    saveError = null;
    expect(await h.status()).toStrictEqual({ engine: READY, saveError: null, server: LISTENING });
  });

  describe('retryEngines calls the host and answers by the status afterwards', () => {
    const AFTER: [string, EngineStatus, Result<null>][] = [
      ['ready', READY, { ok: true, value: null }],
      ['error', { state: 'error', message: 'The download tools could not be started: port in use' }, { ok: false, error: 'The download tools could not be started: port in use' }],
      ['error after an aria2 exit', SERVICE_STOPPED, { ok: false, error: 'The file download service stopped' }],
      ['starting', { state: 'starting' }, { ok: false, error: STARTING_TEXT }],
      ['notInstalled', { state: 'notInstalled' }, { ok: false, error: INSTALL_TEXT }],
    ];

    it.each(AFTER)('the status afterwards is %s', async (_name, after, expected) => {
      engine = SERVICE_STOPPED;
      retryImpl = async () => {
        engine = after;
      };
      expect(await createHandlers(deps()).retryEngines()).toEqual(expected);
      expect(retries).toBe(1);
    });

    it('answers ok when the engines were ready already and stay ready', async () => {
      expect(await createHandlers(deps()).retryEngines()).toEqual({ ok: true, value: null });
      expect(retries).toBe(1);
    });

    it('does not answer ok because of the status from before the call', async () => {
      engine = READY;
      retryImpl = async () => {
        engine = START_FAILED;
      };
      expect(await createHandlers(deps()).retryEngines()).toEqual({ ok: false, error: 'The download tools could not be started: spawn aria2c ENOENT' });
    });

    it('waits for the host before it answers', async () => {
      let finish: () => void = () => undefined;
      retryImpl = () =>
        new Promise<void>((resolve) => {
          finish = () => {
            engine = READY;
            resolve();
          };
        });
      engine = SERVICE_STOPPED;
      let answer: Result<null> | null = null;
      const pending = createHandlers(deps())
        .retryEngines()
        .then((r) => {
          answer = r;
        });
      await flushPromises();
      expect(retries).toBe(1);
      expect(answer).toBeNull();
      finish();
      await pending;
      expect(answer).toEqual({ ok: true, value: null });
    });

    it('calls the host once for every click', async () => {
      const h = createHandlers(deps());
      await h.retryEngines();
      await h.retryEngines();
      expect(retries).toBe(2);
    });

    it('works with a queue and without one', async () => {
      for (const ready of [true, false]) {
        queueReady = ready;
        retries = 0;
        expect(await createHandlers(deps()).retryEngines()).toEqual({ ok: true, value: null });
        expect(retries).toBe(1);
      }
    });
  });

  describe('confirmStraysGone', () => {
    it('confirmStraysGone calls the queue', async () => {
      const h = createHandlers(deps());
      expect(await h.confirmStraysGone()).toEqual({ ok: true, value: null });
      expect(confirmed).toBe(1);
      expect(await h.confirmStraysGone()).toEqual({ ok: true, value: null });
      expect(confirmed).toBe(2);
    });

    it.each(NO_QUEUE)('fails with the status text when there is no queue: %s', async (_name, status, text) => {
      queueReady = false;
      engine = status;
      expect(await createHandlers(deps()).confirmStraysGone()).toEqual({ ok: false, error: text });
      expect(confirmed).toBe(0);
    });
  });

  describe('installBinaries reports an engine start error', () => {
    it('answers the message when afterInstall leaves the status at error', async () => {
      afterInstallImpl = async () => {
        engine = START_FAILED;
      };
      expect(await createHandlers(deps()).installBinaries()).toEqual({
        ok: false,
        error: 'The download tools could not be started: spawn aria2c ENOENT',
      });
      expect(installed).toBe(1);
    });

    it.each([
      ['ready', READY],
      ['starting', { state: 'starting' }],
      ['notInstalled', { state: 'notInstalled' }],
    ] as [string, EngineStatus][])('answers ok when the status after afterInstall is %s', async (_name, after) => {
      afterInstallImpl = async () => {
        engine = after;
      };
      expect(await createHandlers(deps()).installBinaries()).toEqual({ ok: true, value: null });
    });

    it('reads the status after afterInstall, not before', async () => {
      engine = START_FAILED;
      afterInstallImpl = async () => {
        engine = READY;
      };
      expect(await createHandlers(deps()).installBinaries()).toEqual({ ok: true, value: null });
    });

    it('answers the message of an aria2 that stopped as well', async () => {
      afterInstallImpl = async () => {
        engine = SERVICE_STOPPED;
      };
      expect(await createHandlers(deps()).installBinaries()).toEqual({ ok: false, error: 'The file download service stopped' });
    });

    it('still reports a failed download as it did, and does not look at the engine', async () => {
      installFails = true;
      engine = START_FAILED;
      expect(await createHandlers(deps()).installBinaries()).toEqual({ ok: false, error: 'could not download ffmpeg: server answered 404' });
      expect(installed).toBe(0);
    });
  });
});

/** The real Queue and Store of the round-trip specs, behind the real handlers. */
const REAL_DOWNLOADS = 'C:\\Users\\me\\Downloads';

/** What a load does to a job found running: paused, no speed, no eta, cut off. */
const asLoaded = (j: Job): Job => (ACTIVE.has(j.state) ? { ...j, state: 'paused', speed: 0, eta: null, interrupted: true } : j);

describe('with the real handlers, Queue and Store (C1, C2, C3)', () => {
  let realData: string;

  beforeEach(() => {
    realData = mkdtempSync(join(tmpdir(), 'fetchly-ipc-real-'));
  });
  afterEach(() => {
    rmSync(realData, { recursive: true, force: true });
  });

  function real(over: Partial<HandlerDeps> = {}) {
    const store = new Store(realData, REAL_DOWNLOADS);
    const saves = vi.spyOn(store, 'saveSnapshot'); // it still calls the real Store
    const queue = new Queue({
      store,
      media: new FakeEngine(),
      file: new FakeEngine(),
      initial: { jobs: [], groups: [] },
      settings: makeSettings({ downloadDir: dir }),
      straysCleared: true,
      setTimer: () => undefined,
    });
    const saveErrors: (string | null)[] = [];
    queue.onSaveState((e) => saveErrors.push(e));
    const handlers = createHandlers({ ...deps(), queue: () => queue, saveSettings: (s) => store.saveSettings(s), ...over });
    return { store, saves, queue, handlers, saveErrors };
  }

  const reload = () => new Store(realData, REAL_DOWNLOADS).load();

  describe('C1: the loader checks a url the way IPC does', () => {
    const ITEM_URLS: [string, string][] = [
      ['a leading space', ' https://example.com/item'],
      ['a trailing space', 'https://example.com/item '],
      ['a trailing byte order mark', 'https://example.com/item\uFEFF'],
      ['a leading byte order mark', '\uFEFFhttps://example.com/item'],
      ['a leading non-breaking space', '\u00a0https://example.com/item'],
      ['a trailing non-breaking space', 'https://example.com/item\u00a0'],
      ['a non-breaking space right after the host', 'https://example.com\u00a0'],
      ['an ideographic space right after the host', 'https://example.com\u3000'],
      ['marks and spaces on both sides', '\uFEFF https://example.com/item \uFEFF'],
      ['line and paragraph separators', '\u2028https://example.com/item\u2029'],
      ['ideographic spaces', '\u3000https://example.com/item\u3000'],
      ['a tab and a newline at the edges', '\thttps://example.com/item\n'],
    ];

    it.each(ITEM_URLS)('a playlist whose available entry has %s reloads with recoveredCorrupt null and the same url', async (_name, url) => {
      const h = real({ validateUrl: realValidateUrl });
      const entries = [entryOf({ index: 1, url, title: 'One' }), entryOf({ index: 2, url: 'https://example.com/v/2', title: 'Two' })];
      expect(await h.handlers.add(listRequest(entries))).toEqual(ACCEPTED);
      const inQueue = h.queue.snapshot();
      expect(inQueue.jobs.find((j) => j.index === 1)?.url).toBe(url);
      const { snapshot, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(readdirSync(realData).filter((f) => f.includes('.corrupt-'))).toEqual([]);
      expect(snapshot.jobs.find((j) => j.index === 1)?.url).toBe(url);
      expect(snapshot.jobs).toEqual(inQueue.jobs.map(asLoaded));
      expect(snapshot.groups).toEqual(inQueue.groups);
    });

    it('does the same with the validator of these specs', async () => {
      const h = real();
      const url = 'https://example.com/item\uFEFF';
      expect(await h.handlers.add(listRequest([entryOf({ index: 1, url }), entryOf({ index: 2, url: 'https://example.com/v/2' })]))).toEqual(ACCEPTED);
      const { snapshot, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs.find((j) => j.index === 1)?.url).toBe(url);
    });

    it.each(ITEM_URLS)('a single link with %s is added trimmed and reloads', async (_name, url) => {
      const h = real({ validateUrl: realValidateUrl });
      expect(await h.handlers.add(request({ url }))).toEqual(ACCEPTED);
      const { snapshot, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs).toHaveLength(1);
      expect(snapshot.jobs[0]?.url).toBe(url.trim());
    });

    it('keeps the placeholders of a playlist next to such an entry', async () => {
      const h = real({ validateUrl: realValidateUrl });
      const url = '\u00a0https://example.com/item\uFEFF';
      await h.handlers.add(listRequest([entryOf({ index: 1, url }), entryOf({ index: 2, url: '', unavailable: true, reason: 'private' }), entryOf({ index: 3, url: 'abc123', unavailable: true, reason: 'removed' })]));
      const { snapshot, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs.map((j) => [j.index, j.url, j.state === 'skipped'])).toEqual([
        [1, url, false],
        [2, '', true],
        [3, 'abc123', true],
      ]);
    });
  });

  describe('C2: quality is rebuilt before it leaves IPC', () => {
    it.each(QUALITY_ROWS)('an add whose %s quality carries %s answers ok, a second add saves too, and a reload shows both jobs', async (_kind, _extra, base, make, declared) => {
      const h = real();
      const bad = withExtra(base, make) as unknown as Quality;
      expect(await h.handlers.add(request({ quality: bad }))).toEqual(ACCEPTED);
      const savesAfterFirst = h.saves.mock.calls.length;
      expect(await h.handlers.add(request({ url: 'https://example.com/second', quality: { kind: 'best' } }))).toEqual(ACCEPTED);
      expect(h.saves.mock.calls.length).toBeGreaterThan(savesAfterFirst);
      expect(h.saveErrors).toEqual([null]); // no save ever failed

      const { snapshot, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs).toHaveLength(2);
      expect(snapshot.jobs.map((j) => j.quality)).toStrictEqual([declared, { kind: 'best' }]);
      expect(snapshot.jobs).toEqual(h.queue.snapshot().jobs.map(asLoaded));
    });

    it.each(QUALITY_ROWS)('a second add with the same %s quality and %s also saves', async (_kind, _extra, base, make, declared) => {
      const h = real();
      expect(await h.handlers.add(request({ quality: withExtra(base, make) as unknown as Quality }))).toEqual(ACCEPTED);
      expect(await h.handlers.add(request({ url: 'https://example.com/second', quality: withExtra(base, make) as unknown as Quality }))).toEqual(ACCEPTED);
      expect(h.saveErrors).toEqual([null]);
      const { snapshot, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs.map((j) => j.quality)).toStrictEqual([declared, declared]);
    });

    it.each(QUALITY_ROWS)('a playlist whose %s quality carries %s is saved and reloads', async (_kind, _extra, base, make, declared) => {
      const h = real();
      const req = { ...listRequest([entryOf({ index: 1 }), entryOf({ index: 2, url: 'https://example.com/v/2' })]), quality: withExtra(base, make) as unknown as Quality };
      expect(await h.handlers.add(req)).toEqual(ACCEPTED);
      expect(h.saveErrors).toEqual([null]);
      const { snapshot, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs.map((j) => j.quality)).toStrictEqual([declared, declared]);
    });

    it('a file add with a junk quality saves no quality at all', async () => {
      const h = real();
      const req = { ...fileRequest(), quality: { kind: 'best', extra: 1n } as unknown as Quality };
      expect(await h.handlers.add(req)).toEqual(ACCEPTED);
      expect(h.saveErrors).toEqual([null]);
      const { snapshot, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs.map((j) => j.quality)).toEqual([null]);
    });

    it.each(QUALITY_ROWS)('setSettings with a %s default quality that carries %s saves through the real Store', async (_kind, _extra, base, make, declared) => {
      const h = real();
      const res = await h.handlers.setSettings(makeSettings({ downloadDir: dir, defaultQuality: withExtra(base, make) as unknown as Quality }));
      expect(res).toMatchObject({ ok: true });
      expect(h.saveErrors).toEqual([null]);
      const loaded = reload();
      expect(loaded.settings.defaultQuality).toStrictEqual(declared);
      expect(loaded.settings).toStrictEqual({ ...makeSettings({ downloadDir: dir }), defaultQuality: declared });
    });
  });

  describe('C3: a url with a control character never reaches the queue or a spawn', () => {
    const REFUSED_REAL: [string, () => AddRequest, unknown][] = [
      ['a url with a NUL', () => request({ url: 'https://example.com/a\u0000b' }), { ok: false, error: INVALID_URL_TEXT }],
      ['a url with U+001F', () => request({ url: 'https://example.com/a\u001fb' }), { ok: false, error: INVALID_URL_TEXT }],
      ['a url with U+007F', () => request({ url: 'https://example.com/a\u007fb' }), { ok: false, error: INVALID_URL_TEXT }],
      ['a url that ends in a NUL', () => request({ url: 'https://example.com/a\u0000' }), { ok: false, error: INVALID_URL_TEXT }],
      ['a file request with a NUL in its url', () => ({ ...fileRequest(), url: 'https://example.com/a\u0000b.pdf' }), { ok: false, error: INVALID_URL_TEXT }],
      ['a playlist whose available entry has a NUL', () => listRequest([entryOf({ url: 'https://example.com/v/1\u0000' }), entryOf({ index: 2, url: 'https://example.com/v/2' })]), BAD],
      ['a playlist whose last available entry has U+001F', () => listRequest([entryOf(), entryOf({ index: 2, url: 'https://example.com/v/2\u001f' })]), BAD],
      ['a playlist whose available entry has U+007F', () => listRequest([entryOf({ url: 'https://example.com/\u007fv/1' }), entryOf({ index: 2, url: 'https://example.com/v/2' })]), BAD],
      ['a playlist whose NUL entry is not selected', () => listRequest([entryOf({ url: 'https://example.com/v/1\u0000' }), entryOf({ index: 2, url: 'https://example.com/v/2' })], [2]), BAD],
    ];

    it.each(REFUSED_REAL)('%s is refused, and the snapshot, the saves and jobs.json stay unchanged', async (_name, make, answer) => {
      const h = real();
      expect(await h.handlers.add(request())).toEqual(ACCEPTED); // a job to protect
      const before = h.queue.snapshot();
      const savesBefore = h.saves.mock.calls.length;
      const fileBefore = readFileSync(join(realData, 'jobs.json'), 'utf8');
      const target = join(dir, 'new', 'deep');

      expect(await h.handlers.add({ ...make(), dir: target })).toEqual(answer);

      expect(h.queue.snapshot()).toEqual(before);
      expect(h.saves.mock.calls.length).toBe(savesBefore);
      expect(readFileSync(join(realData, 'jobs.json'), 'utf8')).toBe(fileBefore);
      expect(existsSync(target)).toBe(false);
      expect(h.saveErrors).toEqual([null]);

      // The next good request works, and the list still loads.
      expect(await h.handlers.add(request({ url: 'https://example.com/other' }))).toEqual(ACCEPTED);
      const { snapshot: loaded, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(loaded.jobs).toHaveLength(before.jobs.length + 1);
    });

    it('accepts a placeholder whose url holds any control character, and round-trips it', async () => {
      const h = real({ validateUrl: realValidateUrl });
      const entries = [
        entryOf({ index: 1 }),
        ...CONTROL_CODES.map((code, i) => entryOf({ index: i + 2, url: `abc${String.fromCharCode(code)}def`, title: `Hidden ${i + 2}`, unavailable: true, reason: 'private' })),
      ];
      expect(await h.handlers.add(listRequest(entries))).toEqual(ACCEPTED);
      const inQueue = h.queue.snapshot();
      const { snapshot, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs).toEqual(inQueue.jobs.map(asLoaded));
      const skipped = snapshot.jobs.filter((j) => j.state === 'skipped');
      expect(skipped.map((j) => j.url)).toEqual(CONTROL_CODES.map((code) => `abc${String.fromCharCode(code)}def`));
    });

    it('accepts a link with a tab and a newline only at its edges, and round-trips it', async () => {
      const h = real({ validateUrl: realValidateUrl });
      expect(await h.handlers.add(request({ url: '\thttps://example.com/x\n' }))).toEqual(ACCEPTED);
      const { snapshot, recoveredCorrupt } = reload();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs[0]?.url).toBe('https://example.com/x');
    });
  });
});

describe('C2: quality is rebuilt before it leaves IPC (handlers with fakes)', () => {
  it.each(QUALITY_ROWS)('a %s quality with %s: queue.add receives the declared fields only', async (_kind, _extra, base, make, declared) => {
    const bad = withExtra(base, make);
    expect(await createHandlers(deps()).add(request({ quality: bad as unknown as Quality }))).toEqual(ACCEPTED);
    expect(added).toHaveLength(1);
    expect(added[0]?.quality).toStrictEqual(declared);
    expect(added[0]?.quality).not.toBe(bad);
    expect(added[0]).toStrictEqual({ url: 'https://example.com/v', probe: media, quality: declared, subtitleLangs: [], dir, selectedIndexes: null });
  });

  it.each(QUALITY_ROWS)('a %s quality with %s on a playlist request: queue.add receives the declared fields only', async (_kind, _extra, base, make, declared) => {
    const bad = withExtra(base, make) as unknown as Quality;
    expect(await createHandlers(deps()).add({ ...listRequest([entryOf()]), quality: bad })).toEqual(ACCEPTED);
    expect(added[0]?.quality).toStrictEqual(declared);
  });

  it.each(QUALITY_ROWS)('a file probe never forwards a quality, even when the request carries a %s quality with %s', async (_kind, _extra, base, make) => {
    const bad = withExtra(base, make) as unknown as Quality;
    expect(await createHandlers(deps()).add({ ...fileRequest(), quality: bad })).toEqual(ACCEPTED);
    expect(added[0]?.quality).toBeNull();
  });

  it('forwards a clean quality as an equal object, not the one it was given', async () => {
    const quality: Quality = { kind: 'max', height: 1080 };
    await createHandlers(deps()).add(request({ quality }));
    expect(added[0]?.quality).toStrictEqual({ kind: 'max', height: 1080 });
    expect(added[0]?.quality).not.toBe(quality);
  });

  it.each([
    ['best with the fields of the other kinds', { kind: 'best', height: 720, format: 'mp3' }, { kind: 'best' }],
    ['max with the format of audio', { kind: 'max', height: 1080, format: 'mp3' }, { kind: 'max', height: 1080 }],
    ['audio with the height of max', { kind: 'audio', format: 'm4a', height: 1080 }, { kind: 'audio', format: 'm4a' }],
  ])('drops the fields of other kinds: %s', async (_name, sent, declared) => {
    expect(await createHandlers(deps()).add(request({ quality: sent as unknown as Quality }))).toEqual(ACCEPTED);
    expect(added[0]?.quality).toStrictEqual(declared);
    const res = await createHandlers(deps()).setSettings(makeSettings({ downloadDir: dir, defaultQuality: sent as unknown as Quality }));
    expect(res.ok && res.value.defaultQuality).toStrictEqual(declared);
    expect(savedSettings[0]?.defaultQuality).toStrictEqual(declared);
    expect(queueSettings[0]?.defaultQuality).toStrictEqual(declared);
  });

  it('still refuses a quality that is not one', async () => {
    expect(await createHandlers(deps()).add(request({ quality: { kind: 'max', height: 999, extra: 1n } as never }))).toEqual(BAD);
    expect(added).toEqual([]);
  });

  it.each(QUALITY_ROWS)('setSettings with a %s default quality that carries %s: saveSettings, queue.setSettings and the answer carry the declared fields only', async (_kind, _extra, base, make, declared) => {
    const bad = withExtra(base, make) as unknown as Quality;
    const res = await createHandlers(deps()).setSettings(makeSettings({ downloadDir: dir, defaultQuality: bad }));
    const expected = { ...makeSettings({ downloadDir: dir }), defaultQuality: declared };
    expect(res).toEqual({ ok: true, value: expected });
    expect(savedSettings).toHaveLength(1);
    expect(queueSettings).toHaveLength(1);
    expect(savedSettings[0]).toStrictEqual(expected);
    expect(queueSettings[0]).toStrictEqual(expected);
    expect(res.ok && res.value).toStrictEqual(expected);
    expect(savedSettings[0]?.defaultQuality).not.toBe(bad);
    expect(queueSettings[0]?.defaultQuality).not.toBe(bad);
    expect(() => JSON.stringify(savedSettings[0])).not.toThrow();
  });

  it('setSettings with an extra key on the settings themselves carries the declared fields only', async () => {
    const res = await createHandlers(deps()).setSettings({ ...makeSettings({ downloadDir: dir }), mystery: 1n } as Settings);
    const expected = makeSettings({ downloadDir: dir });
    expect(res).toEqual({ ok: true, value: expected });
    expect(savedSettings[0]).toStrictEqual(expected);
    expect(queueSettings[0]).toStrictEqual(expected);
  });

  it('setSettings still refuses a default quality that is not one', async () => {
    const res = await createHandlers(deps()).setSettings(makeSettings({ downloadDir: dir, defaultQuality: { kind: 'max', height: 999, extra: 1n } as never }));
    expect(res).toEqual(BAD);
    expect(savedSettings).toEqual([]);
    expect(queueSettings).toEqual([]);
  });
});

describe('C3: a url with a control character never reaches the queue or a spawn (handlers with fakes)', () => {
  const VALIDATORS: [string, Partial<HandlerDeps>][] = [
    ['the validator of these specs', {}],
    ['the real validateUrl', { validateUrl: realValidateUrl }],
  ];
  const target = () => join(dir, 'new', 'deep');

  describe.each(VALIDATORS)('with %s', (_name, over) => {
    const handlers = () => createHandlers({ ...deps(), ...over });

    it('add refuses a control character inside the url, whichever it is: nothing is added and no folder is made', async () => {
      const h = handlers();
      for (const code of CONTROL_CODES) {
        const res = await h.add(request({ url: `https://example.com/a${chr(code)}b`, dir: target() }));
        expect(res, codeLabel(code)).toEqual({ ok: false, error: INVALID_URL_TEXT });
      }
      expect(added).toEqual([]);
      expect(existsSync(target())).toBe(false);
    });

    it.each([0x00, 0x1f, 0x7f])('add refuses %i wherever it sits: after the scheme, in the path, the query, the fragment and at the end', async (code) => {
      const h = handlers();
      const c = chr(code);
      const urls = [`https://${c}example.com/x`, `https://example.com/${c}x`, `https://example.com/x?q=${c}`, `https://example.com/x#${c}f`, `https://example.com/x${c}`, `${c}https://example.com/x`];
      for (const url of urls) {
        expect(await h.add(request({ url, dir: target() })), `${codeLabel(code)} in ${JSON.stringify(url)}`).toEqual({ ok: false, error: INVALID_URL_TEXT });
      }
      expect(added).toEqual([]);
      expect(existsSync(target())).toBe(false);
    });

    it('add refuses a control character that trimming does not remove, even at the edges', async () => {
      const h = handlers();
      // tab, line feed, vertical tab, form feed and carriage return are whitespace: trim takes them. These are not.
      for (const code of [0x00, 0x01, 0x08, 0x0e, 0x1c, 0x1f, 0x7f]) {
        expect(await h.add(request({ url: `https://example.com/x${chr(code)}`, dir: target() })), `${codeLabel(code)} at the end`).toEqual({ ok: false, error: INVALID_URL_TEXT });
      }
      expect(added).toEqual([]);
      expect(existsSync(target())).toBe(false);
    });

    it('add refuses with the same text for the two forms of a bad link', async () => {
      const h = handlers();
      const control = await h.add(request({ url: 'https://example.com/a\u0000b' }));
      const scheme = await h.add(request({ url: 'ftp://example.com/a' }));
      expect(control).toEqual(scheme);
      expect(control).toEqual({ ok: false, error: INVALID_URL_TEXT });
    });

    it.each([
      ['a tab and a newline at the edges', '\thttps://example.com/x\n'],
      ['a carriage return and a line feed at both edges', '\r\nhttps://example.com/x\r\n'],
      ['a vertical tab and a form feed', '\vhttps://example.com/x\f'],
      ['spaces, tabs and controls together at the edges', ' \t https://example.com/x \v\f'],
      ['only a leading tab', '\thttps://example.com/x'],
      ['only a trailing newline', 'https://example.com/x\n'],
    ])('add still accepts a link with %s, trimmed', async (_label, url) => {
      expect(await handlers().add(request({ url, dir: target() }))).toEqual(ACCEPTED);
      expect(added).toHaveLength(1);
      expect(added[0]?.url).toBe('https://example.com/x');
      expect(existsSync(target())).toBe(true);
    });

    it.each([
      ['U+0020, the first character above the controls', 0x20],
      ['U+007E, the last one below U+007F', 0x7e],
      ['U+0080, the first one above U+007F', 0x80],
      ['U+009F, the end of the other control block', 0x9f],
      ['U+00A0, a non-breaking space', 0xa0],
    ])('add accepts %s inside the url', async (_label, code) => {
      const url = `https://example.com/a${chr(code)}b`;
      expect(await handlers().add(request({ url, dir: target() }))).toEqual(ACCEPTED);
      expect(added).toHaveLength(1);
      expect(added[0]?.url).toBe(url);
      expect(existsSync(target())).toBe(true);
    });

    it('probe refuses a control character inside the url, whichever it is: nothing is probed', async () => {
      const h = handlers();
      for (const code of CONTROL_CODES) {
        const res = await h.probe(`https://example.com/a${chr(code)}b`);
        expect(res, codeLabel(code)).toEqual({ ok: false, error: INVALID_URL_TEXT });
      }
      expect(probed).toEqual([]);
    });

    it('probe with a NUL answers the InvalidUrl text, and deps.probe is not called', async () => {
      expect(await handlers().probe('https://example.com/a\u0000b')).toEqual({ ok: false, error: INVALID_URL_TEXT });
      expect(await handlers().probe('https://example.com/a\u0000')).toEqual({ ok: false, error: INVALID_URL_TEXT });
      expect(probed).toEqual([]);
    });

    it.each([0x1c, 0x1f, 0x7f])('probe refuses %i at the end of the url, where trimming does not remove it', async (code) => {
      expect(await handlers().probe(`https://example.com/x${chr(code)}`)).toEqual({ ok: false, error: INVALID_URL_TEXT });
      expect(probed).toEqual([]);
    });

    it.each([
      ['a tab and a newline at the edges', '\thttps://example.com/x\n'],
      ['spaces and controls that trim removes', ' \r\n https://example.com/x \v\f'],
    ])('probe still accepts a link with %s, and probes it trimmed', async (_label, url) => {
      expect(await handlers().probe(url)).toEqual({ ok: true, value: media });
      expect(probed).toEqual(['https://example.com/x']);
    });

    it.each([0x20, 0x7e, 0x80, 0xa0])('probe accepts %i inside the url', async (code) => {
      const url = `https://example.com/a${chr(code)}b`;
      expect(await handlers().probe(url)).toEqual({ ok: true, value: media });
      expect(probed).toEqual([url]);
    });

    it('an available playlist entry with a control character answers BAD_REQUEST, whichever it is', async () => {
      const h = handlers();
      for (const code of CONTROL_CODES) {
        const entries = [entryOf({ url: `https://example.com/v/1${chr(code)}x` }), entryOf({ index: 2, url: 'https://example.com/v/2' })];
        expect(await h.add({ ...listRequest(entries), dir: target() }), codeLabel(code)).toEqual(BAD);
      }
      expect(added).toEqual([]);
      expect(existsSync(target())).toBe(false);
    });

    it.each([0x00, 0x1f, 0x7f])('an available entry with %i answers BAD_REQUEST wherever it is in the playlist and whether or not it is selected', async (code) => {
      const h = handlers();
      const bad = entryOf({ index: 2, url: `https://example.com/v/2${chr(code)}` });
      const good = (i: number) => entryOf({ index: i, url: `https://example.com/v/${i}` });
      const lists: [string, AddRequest][] = [
        ['first', listRequest([entryOf({ url: `https://example.com/v/1${chr(code)}` }), good(2), good(3)])],
        ['middle', listRequest([good(1), bad, good(3)])],
        ['last', listRequest([good(1), good(3), entryOf({ index: 4, url: `https://example.com/v/4${chr(code)}` })])],
        ['not selected', listRequest([good(1), bad, good(3)], [1, 3])],
        ['alone', listRequest([bad])],
      ];
      for (const [where, req] of lists) {
        expect(await h.add({ ...req, dir: target() }), where).toEqual(BAD);
      }
      expect(added).toEqual([]);
      expect(existsSync(target())).toBe(false);
    });

    it('an available entry with a control character only at its edges is accepted', async () => {
      const entries = [entryOf({ url: '\thttps://example.com/v/1\n' }), entryOf({ index: 2, url: 'https://example.com/v/2' })];
      expect(await handlers().add(listRequest(entries))).toEqual(ACCEPTED);
      expect(added).toHaveLength(1);
    });

    it('an unavailable entry still accepts any string url, whatever control characters it holds', async () => {
      const h = handlers();
      for (const code of CONTROL_CODES) {
        const url = `abc${chr(code)}def`;
        const entries = [entryOf(), entryOf({ index: 2, url, unavailable: true, reason: 'private' })];
        expect(await h.add(listRequest(entries)), codeLabel(code)).toEqual(ACCEPTED);
        const sent = added.at(-1)?.probe;
        expect(sent?.kind === 'playlist' && sent.entries[1]?.url, codeLabel(code)).toBe(url);
      }
      expect(added).toHaveLength(CONTROL_CODES.length);
    });

    it('an unavailable entry with a NUL url next to an available entry with a NUL url is still refused for the available one', async () => {
      const entries = [entryOf({ url: 'https://example.com/v/1\u0000' }), entryOf({ index: 2, url: 'a\u0000b', unavailable: true, reason: 'removed' })];
      expect(await handlers().add(listRequest(entries))).toEqual(BAD);
      expect(added).toEqual([]);
    });
  });
});

describe('cleanup', () => {
  it('leaves the temp folder removable', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
  });
});
