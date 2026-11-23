import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, Store } from '../../src/main/jobs/store';
import { normalizeSettings as normalizeSettingsOfValidate } from '../../src/main/jobs/validate';
import type { Group } from '../../src/shared/types';
import { makeJob, makeSettings } from '../helpers';

let dir: string;
const DOWNLOADS = 'C:\\Users\\me\\Downloads';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetchly-store-'));
});

const group: Group = { id: 'g1', title: 'Course', url: 'https://example.com/list', dir: 'D:\\Dl\\Course', createdAt: 1 };

describe('Store', () => {
  it('round-trips jobs and groups', () => {
    const job = makeJob({ state: 'done', fileName: 'a.mp4', groupId: 'g1' });
    new Store(dir, DOWNLOADS).saveSnapshot({ jobs: [job], groups: [group] });
    const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
    expect(snapshot).toEqual({ jobs: [job], groups: [group] });
    expect(recoveredCorrupt).toBeNull();
  });

  it('starts empty with default settings when nothing was saved', () => {
    const loaded = new Store(dir, DOWNLOADS).load();
    expect(loaded.snapshot).toEqual({ jobs: [], groups: [] });
    expect(loaded.settings).toEqual(DEFAULT_SETTINGS(DOWNLOADS));
    expect(loaded.settings.downloadDir).toBe(join(DOWNLOADS, 'Fetchly'));
    expect(loaded.settings.maxConcurrent).toBe(3);
  });

  it.each(['probing', 'downloading', 'merging'] as const)('loads a job saved as %s as paused and cut off', (state) => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSnapshot({ jobs: [makeJob({ state, speed: 900, eta: 12, bytesDone: 50 })], groups: [] });
    const [job] = store.load().snapshot.jobs;
    expect(job).toMatchObject({ state: 'paused', speed: 0, eta: null, bytesDone: 50, interrupted: true });
  });

  it('keeps interrupted on a paused job across a load', () => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSnapshot({ jobs: [makeJob({ state: 'paused', interrupted: true })], groups: [] });
    expect(store.load().snapshot.jobs[0]?.interrupted).toBe(true);
  });

  it('clears interrupted on a job that is not paused', () => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSnapshot({ jobs: [makeJob({ state: 'done', fileName: 'a.mp4', interrupted: true })], groups: [] });
    expect(store.load().snapshot.jobs[0]?.interrupted).toBe(false);
  });

  it('loads a jobs file written by the previous version', () => {
    const old: Record<string, unknown> = { ...makeJob({ state: 'paused', bytesDone: 10 }) };
    delete old['interrupted'];
    delete old['sourceHeight'];
    writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ version: 1, jobs: [old], groups: [] }));
    const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
    expect(recoveredCorrupt).toBeNull();
    expect(snapshot.jobs).toEqual([{ ...old, interrupted: false, sourceHeight: null }]);
  });

  /** A job as the previous version wrote it, as the text of a jobs file. */
  function previousFile(job: Record<string, unknown>): string {
    const old: Record<string, unknown> = { ...job };
    delete old['interrupted'];
    delete old['sourceHeight'];
    return JSON.stringify({ version: 1, jobs: [old], groups: [] });
  }

  describe('file names saved by an earlier version (A1)', () => {
    const LONG_PAIR = 'a'.repeat(150) + '.' + 'b'.repeat(150);

    it('loads a file job whose name is 150 characters, a dot and 150 more, unchanged', () => {
      const job = makeJob({ kind: 'file', quality: null, baseName: null, fileName: LONG_PAIR, state: 'paused', bytesDone: 40, bytesTotal: 100 });
      writeFileSync(join(dir, 'jobs.json'), previousFile({ ...job }));
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(readdirSync(dir).filter((f) => f.includes('.corrupt-'))).toEqual([]);
      expect(snapshot.jobs).toEqual([{ ...job, interrupted: false, sourceHeight: null }]);
    });

    it.each([255, 256, 1000])('round-trips a file job whose name has %d characters', (length) => {
      const job = makeJob({ kind: 'file', quality: null, baseName: null, fileName: 'a'.repeat(length), state: 'done' });
      new Store(dir, DOWNLOADS).saveSnapshot({ jobs: [job], groups: [] });
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs).toEqual([job]);
    });

    it('still sets aside a file whose file name would leave its folder', () => {
      const job = makeJob({ kind: 'file', quality: null, baseName: null, fileName: '..\\evil.exe', state: 'done' });
      writeFileSync(join(dir, 'jobs.json'), previousFile({ ...job }));
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(snapshot.jobs).toEqual([]);
      expect(recoveredCorrupt).not.toBeNull();
    });
  });

  describe('a url with spaces or marks around it, as a file written by HEAD can hold (C1)', () => {
    const URLS: [string, string][] = [
      ['a leading space', ' https://example.com/item'],
      ['a trailing byte order mark', 'https://example.com/item﻿'],
      ['a leading byte order mark', '﻿https://example.com/item'],
      ['a leading non-breaking space', ' https://example.com/item'],
      ['a trailing non-breaking space', 'https://example.com/item '],
      ['a non-breaking space right after the host', 'https://example.com '],
      ['an ideographic space right after the host', 'https://example.com　'],
      ['marks and spaces on both sides', '﻿  https://example.com/item  ﻿'],
      ['line and paragraph separators', ' https://example.com/item '],
      ['a tab and a newline at the edges', '\thttps://example.com/item\n'],
    ];

    it.each(URLS)('loads a hand-written jobs.json whose queued job has %s, with recoveredCorrupt null and the url unchanged', (_name, url) => {
      const job = makeJob({ state: 'queued', url, title: 'Item', index: 1, groupId: 'g1' });
      writeFileSync(join(dir, 'jobs.json'), previousFile({ ...job }).replace('"groups":[]', `"groups":${JSON.stringify([group])}`));
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(readdirSync(dir).filter((f) => f.includes('.corrupt-'))).toEqual([]);
      expect(snapshot.jobs).toEqual([{ ...job, interrupted: false, sourceHeight: null }]);
      expect(snapshot.jobs[0]?.url).toBe(url);
    });

    it('loads the url of the plan, a leading space, from a file with no group', () => {
      const job = makeJob({ state: 'queued', url: ' https://example.com/item' });
      writeFileSync(join(dir, 'jobs.json'), previousFile({ ...job }));
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs[0]?.url).toBe(' https://example.com/item');
    });

    it.each(['paused', 'downloading', 'failed', 'done'] as const)('loads such a url on a job saved as %s', (state) => {
      const url = 'https://example.com/item﻿';
      const job = makeJob({ state, url, fileName: state === 'done' ? 'a.mp4' : null, reason: state === 'failed' ? 'x' : null });
      writeFileSync(join(dir, 'jobs.json'), previousFile({ ...job }));
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs[0]?.url).toBe(url);
    });

    it('loads a file job with such a url', () => {
      const url = ' https://example.com/a.zip﻿';
      const job = makeJob({ kind: 'file', quality: null, baseName: null, fileName: 'a.zip', url, state: 'paused' });
      writeFileSync(join(dir, 'jobs.json'), previousFile({ ...job }));
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs[0]?.url).toBe(url);
    });

    it('keeps the url byte-identical across a save and a load', () => {
      const url = ' https://example.com/item﻿';
      const store = new Store(dir, DOWNLOADS);
      store.saveSnapshot({ jobs: [makeJob({ state: 'queued', url })], groups: [] });
      const first = new Store(dir, DOWNLOADS).load();
      expect(first.recoveredCorrupt).toBeNull();
      expect(first.snapshot.jobs[0]?.url).toBe(url);
      store.saveSnapshot(first.snapshot);
      expect(new Store(dir, DOWNLOADS).load().snapshot.jobs[0]?.url).toBe(url);
    });

    it.each([
      ['a space', ' '],
      ['a space and ftp', ' ftp://x'],
      ['a non-breaking space', ' '],
      ['a mark and ftp', '﻿ftp://x'],
      ['a zero-width space before the link', '​https://example.com/x'],
    ])('still sets the list aside when a queued job has %s as its url', (_name, url) => {
      const content = previousFile({ ...makeJob({ state: 'queued', url }) });
      writeFileSync(join(dir, 'jobs.json'), content);
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(snapshot.jobs).toEqual([]);
      expect(recoveredCorrupt).not.toBeNull();
      expect(readFileSync(recoveredCorrupt as string, 'utf8')).toBe(content);
    });

    it('still takes any string as the url of a skipped placeholder', () => {
      const jobs = [' ', '﻿', ' ftp://x', ''].map((url, i) => makeJob({ id: `s${i}`, state: 'skipped', reason: 'private', url }));
      new Store(dir, DOWNLOADS).saveSnapshot({ jobs, groups: [] });
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs.map((j) => j.url)).toEqual([' ', '﻿', ' ftp://x', '']);
    });

    it('keeps the loader tolerant for old files: a control character inside a url still loads (C3)', () => {
      for (const url of ['https://example.com/a\u0000b', 'https://example.com/a\u001fb', 'https://example.com/a\u007fb']) {
        writeFileSync(join(dir, 'jobs.json'), previousFile({ ...makeJob({ state: 'queued', url }) }));
        const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
        expect(recoveredCorrupt, JSON.stringify(url)).toBeNull();
        expect(snapshot.jobs[0]?.url, JSON.stringify(url)).toBe(url);
      }
    });
  });

  describe('meters never set the list aside (A3)', () => {
    it('loads a file of the previous version with eta -5 and actualHeight 0, both as null', () => {
      const running = { ...makeJob({ id: 'a', state: 'paused', bytesDone: 10 }), eta: -5 };
      const finished = { ...makeJob({ id: 'b', state: 'done', fileName: 'b.mp4' }), actualHeight: 0 };
      writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ version: 1, jobs: [running, finished].map((j) => ({ ...j, interrupted: undefined, sourceHeight: undefined })), groups: [] }));
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs).toHaveLength(2);
      expect(snapshot.jobs[0]).toMatchObject({ id: 'a', eta: null, bytesDone: 10 });
      expect(snapshot.jobs[1]).toMatchObject({ id: 'b', actualHeight: null, fileName: 'b.mp4' });
    });

    it('loads a file saved with NaN and infinite meters, which JSON writes as null', () => {
      const bad = {
        ...makeJob({ state: 'paused' }),
        bytesDone: Number.NaN,
        bytesTotal: Number.NaN,
        speed: Number.POSITIVE_INFINITY,
        eta: Number.NEGATIVE_INFINITY,
        actualHeight: Number.NaN,
        sourceHeight: Number.NaN,
      };
      const store = new Store(dir, DOWNLOADS);
      store.saveSnapshot({ jobs: [bad], groups: [] });
      expect(readFileSync(join(dir, 'jobs.json'), 'utf8')).toContain('"bytesDone":null');
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs[0]).toMatchObject({ bytesDone: 0, bytesTotal: null, speed: 0, eta: null, actualHeight: null, sourceHeight: null });
    });

    it('loads meters of the wrong type or range from a hand-written file', () => {
      const job = { ...makeJob({ state: 'failed', reason: 'x' }), bytesDone: '5', bytesTotal: -2, speed: -3, eta: 'soon', actualHeight: -720, sourceHeight: '1080' };
      writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ version: 1, jobs: [job], groups: [] }));
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs[0]).toMatchObject({ bytesDone: 0, bytesTotal: null, speed: 0, eta: null, actualHeight: null, sourceHeight: null });
    });

    it('still sets the file aside when a meter and another field are bad', () => {
      const job = { ...makeJob({ state: 'paused' }), eta: -5, attempts: -1 };
      writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ version: 1, jobs: [job], groups: [] }));
      expect(new Store(dir, DOWNLOADS).load().recoveredCorrupt).not.toBeNull();
    });

    it('loads a job cut off while running, with a bad eta, as paused with eta null', () => {
      const job = { ...makeJob({ state: 'downloading', speed: 5 }), eta: -5 };
      writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ version: 1, jobs: [job], groups: [] }));
      const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
      expect(recoveredCorrupt).toBeNull();
      expect(snapshot.jobs[0]).toMatchObject({ state: 'paused', eta: null, speed: 0, interrupted: true });
    });
  });

  it('loads a skipped placeholder whose url is a bare video id (A2)', () => {
    const job = makeJob({ state: 'skipped', reason: 'private', url: 'abc123' });
    new Store(dir, DOWNLOADS).saveSnapshot({ jobs: [job], groups: [] });
    const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
    expect(recoveredCorrupt).toBeNull();
    expect(snapshot.jobs).toEqual([job]);
  });

  it('sets aside a file whose queued job has a url that is not http (A2)', () => {
    new Store(dir, DOWNLOADS).saveSnapshot({ jobs: [makeJob({ state: 'queued', url: 'abc123' })], groups: [] });
    expect(new Store(dir, DOWNLOADS).load().recoveredCorrupt).not.toBeNull();
  });

  it('sets aside a file whose job has interrupted: null (A5)', () => {
    const job = { ...makeJob({ state: 'paused' }), interrupted: null };
    writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ version: 1, jobs: [job], groups: [] }));
    expect(new Store(dir, DOWNLOADS).load().recoveredCorrupt).not.toBeNull();
  });

  it('writes a quality without the extra keys a file carried (A6)', () => {
    const job = { ...makeJob({ state: 'paused' }), quality: { kind: 'best', extra: 123 } };
    writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ version: 1, jobs: [job], groups: [] }));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultQuality: { kind: 'audio', format: 'mp3', extra: 1 } }));
    const store = new Store(dir, DOWNLOADS);
    const loaded = store.load();
    expect(loaded.snapshot.jobs[0]?.quality).toStrictEqual({ kind: 'best' });
    expect(loaded.settings.defaultQuality).toStrictEqual({ kind: 'audio', format: 'mp3' });
    store.saveSnapshot(loaded.snapshot);
    expect(readFileSync(join(dir, 'jobs.json'), 'utf8')).not.toContain('extra');
  });

  it('exports the function validate.ts defines for the settings limits (A8)', () => {
    expect(normalizeSettings).toBe(normalizeSettingsOfValidate);
    expect(normalizeSettings(makeSettings({ maxConcurrent: 50, speedLimitKbps: -5 }))).toMatchObject({ maxConcurrent: 8, speedLimitKbps: 0 });
  });

  it('sets aside a jobs file whose job lacks required fields', () => {
    const content = '{"jobs":[{"id":"x","state":"done"}],"groups":[]}';
    writeFileSync(join(dir, 'jobs.json'), content);
    const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
    expect(snapshot.jobs).toEqual([]);
    expect(recoveredCorrupt).not.toBeNull();
    expect(readFileSync(recoveredCorrupt as string, 'utf8')).toBe(content);
  });

  it('falls back per field when settings.json has a wrong field', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ subtitleLangs: {}, maxConcurrent: 5 }));
    expect(new Store(dir, DOWNLOADS).load().settings).toEqual({ ...DEFAULT_SETTINGS(DOWNLOADS), maxConcurrent: 5 });
  });

  it.each(['queued', 'paused', 'done', 'failed', 'skipped'] as const)('keeps a job saved as %s', (state) => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSnapshot({ jobs: [makeJob({ state })], groups: [] });
    expect(store.load().snapshot.jobs[0]?.state).toBe(state);
  });

  it('sets a truncated jobs file aside and starts empty', () => {
    const broken = '{"jobs": [';
    writeFileSync(join(dir, 'jobs.json'), broken);
    const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
    expect(snapshot).toEqual({ jobs: [], groups: [] });
    expect(recoveredCorrupt).toMatch(/jobs\.json\.corrupt-\d+$/);
    expect(readFileSync(recoveredCorrupt as string, 'utf8')).toBe(broken);
    expect(existsSync(join(dir, 'jobs.json'))).toBe(false);
  });

  it('sets aside a jobs file that is valid JSON of the wrong shape', () => {
    writeFileSync(join(dir, 'jobs.json'), '{"version":1,"jobs":"nope","groups":[]}');
    const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
    expect(snapshot.jobs).toEqual([]);
    expect(recoveredCorrupt).not.toBeNull();
  });

  it('leaves no temp file behind after a save', () => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSnapshot({ jobs: [makeJob()], groups: [] });
    store.saveSettings(makeSettings());
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it.each([
    [50, 8],
    [0, 1],
    [-3, 1],
    [4.7, 4],
  ])('clamps maxConcurrent %d to %d', (given, expected) => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSettings(makeSettings({ maxConcurrent: given }));
    expect(store.load().settings.maxConcurrent).toBe(expected);
  });

  it('never stores a negative speed limit', () => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSettings(makeSettings({ speedLimitKbps: -5 }));
    expect(store.load().settings.speedLimitKbps).toBe(0);
  });

  it('ignores unknown settings keys and fills missing ones with defaults', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ maxConcurrent: 5, mystery: true }));
    const { settings } = new Store(dir, DOWNLOADS).load();
    expect(settings).toEqual({ ...DEFAULT_SETTINGS(DOWNLOADS), maxConcurrent: 5 });
  });

  it('falls back to default settings when the settings file is broken', () => {
    writeFileSync(join(dir, 'settings.json'), 'not json');
    expect(new Store(dir, DOWNLOADS).load().settings).toEqual(DEFAULT_SETTINGS(DOWNLOADS));
  });

  it('defaults language and theme to system', () => {
    expect(DEFAULT_SETTINGS(DOWNLOADS)).toMatchObject({ language: 'system', theme: 'system' });
  });

  it('loads a settings file written before language and theme existed, with both on system', () => {
    const old = { ...makeSettings({ downloadDir: 'D:\\Old', maxConcurrent: 5 }) } as Record<string, unknown>;
    delete old['language'];
    delete old['theme'];
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(old));
    expect(new Store(dir, DOWNLOADS).load().settings).toEqual(makeSettings({ downloadDir: 'D:\\Old', maxConcurrent: 5 }));
  });

  it('saves and loads a chosen language and theme', () => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSettings(makeSettings({ language: 'ar', theme: 'dark' }));
    expect(store.load().settings).toMatchObject({ language: 'ar', theme: 'dark' });
  });

  it('creates its data folder when it does not exist yet', () => {
    const nested = join(dir, 'a', 'b');
    new Store(nested, DOWNLOADS).saveSnapshot({ jobs: [], groups: [] });
    expect(existsSync(join(nested, 'jobs.json'))).toBe(true);
  });
});
