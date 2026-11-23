import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, Store } from '../../src/main/jobs/store';
import { normalizeSettings as normalizeSettingsOfValidate } from '../../src/main/jobs/validate';
import type { Group } from '../../src/shared/types';
import { makeA3Job, makeJob, makeSettings } from '../helpers';

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

  /**
   * M1 (A3, plan 3.2): Job gains referer, userAgent and oneShotLogin; jobs.json stays at version 1 and no
   * conversion runs. These specs use the real Store and real files, never a mock.
   */
  describe('the M1 migration of jobs.json (A3)', () => {
    const FIXTURES = join(__dirname, '..', 'fixtures');
    const FIXTURE_NAMES = ['jobs-phase1.json', 'jobs-first-version.json', 'jobs-no-version.json'] as const;
    const NEW_KEYS = ['referer', 'userAgent', 'oneShotLogin'] as const;
    const NEUTRAL = { referer: null, userAgent: null, oneShotLogin: false };
    const R = 'https://a.example/p/q';
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/158.0.0.0 Safari/537.36';
    const jobsPath = (): string => join(dir, 'jobs.json');

    interface FileShape {
      version?: number;
      jobs: Record<string, unknown>[];
      groups: Record<string, unknown>[];
    }
    const fixtureText = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
    const fixture = (name: string): FileShape => JSON.parse(fixtureText(name)) as FileShape;
    const savedFile = (): FileShape => JSON.parse(readFileSync(jobsPath(), 'utf8')) as FileShape;
    const corruptFiles = (): string[] => readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    /** What a fixture job must load as: the first-version fields it lacks at their defaults, and the three new ones. */
    const expectedJob = (j: Record<string, unknown>): Record<string, unknown> => ({ interrupted: false, sourceHeight: null, ...j, ...NEUTRAL });

    describe('the three fixtures (generated once by the pre-M1 saveSnapshot, never written by hand)', () => {
      it.each(FIXTURE_NAMES)('%s is a file written before M1: a group, a skipped job with no url, a media job and a file job, and none of the new keys', (name) => {
        const { jobs, groups } = fixture(name);
        expect(groups).toHaveLength(1);
        expect(jobs).toHaveLength(4);
        expect(jobs.filter((j) => j['state'] === 'skipped' && j['url'] === '')).toHaveLength(1);
        expect(jobs.filter((j) => j['kind'] === 'media' && j['state'] !== 'skipped').length).toBeGreaterThanOrEqual(1);
        expect(jobs.filter((j) => j['kind'] === 'file')).toHaveLength(1);
        expect(jobs.filter((j) => j['groupId'] === groups[0]?.['id']).length).toBeGreaterThanOrEqual(1);
        for (const job of jobs) {
          for (const key of NEW_KEYS) expect(Object.hasOwn(job, key), `${job['id']} ${key}`).toBe(false);
        }
      });

      it('jobs-first-version.json has no interrupted and no sourceHeight on any job; the other two have both', () => {
        for (const job of fixture('jobs-first-version.json').jobs) {
          expect(Object.hasOwn(job, 'interrupted')).toBe(false);
          expect(Object.hasOwn(job, 'sourceHeight')).toBe(false);
        }
        for (const name of ['jobs-phase1.json', 'jobs-no-version.json']) {
          for (const job of fixture(name).jobs) {
            expect(Object.hasOwn(job, 'interrupted'), name).toBe(true);
            expect(Object.hasOwn(job, 'sourceHeight'), name).toBe(true);
          }
        }
      });

      it('jobs-no-version.json has no version key; the other two say version 1', () => {
        expect(Object.hasOwn(fixture('jobs-no-version.json'), 'version')).toBe(false);
        expect(fixture('jobs-phase1.json').version).toBe(1);
        expect(fixture('jobs-first-version.json').version).toBe(1);
      });

      it.each(FIXTURE_NAMES)('%s loads through the real Store, nothing is set aside and the file is left as it was', (name) => {
        writeFileSync(jobsPath(), fixtureText(name));
        const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
        expect(recoveredCorrupt).toBeNull();
        expect(corruptFiles()).toEqual([]);
        expect(snapshot.groups).toEqual(fixture(name).groups);
        expect(snapshot.jobs).toEqual(fixture(name).jobs.map(expectedJob));
        expect(readFileSync(jobsPath(), 'utf8')).toBe(fixtureText(name));
      });

      it.each(FIXTURE_NAMES)('%s loads every job with referer null, userAgent null and oneShotLogin false', (name) => {
        writeFileSync(jobsPath(), fixtureText(name));
        const { snapshot } = new Store(dir, DOWNLOADS).load();
        expect(snapshot.jobs).toHaveLength(4);
        for (const job of snapshot.jobs) expect(job, job.id).toMatchObject(NEUTRAL);
        for (const job of snapshot.jobs) {
          for (const key of NEW_KEYS) expect(Object.hasOwn(job, key), `${job.id} ${key}`).toBe(true);
        }
      });

      it.each(FIXTURE_NAMES)('%s saves again with the three keys on every job, still at version 1', (name) => {
        writeFileSync(jobsPath(), fixtureText(name));
        const store = new Store(dir, DOWNLOADS);
        const { snapshot } = store.load();
        store.saveSnapshot(snapshot);
        const saved = savedFile();
        expect(saved.version).toBe(1);
        expect(saved.jobs).toHaveLength(4);
        for (const job of saved.jobs) {
          for (const key of NEW_KEYS) expect(Object.hasOwn(job, key), `${job['id']} ${key}`).toBe(true);
          expect(job, String(job['id'])).toMatchObject(NEUTRAL);
        }
        expect(saved.jobs).toEqual(fixture(name).jobs.map(expectedJob));
        expect(saved.groups).toEqual(fixture(name).groups);
        // and the new file loads again, to the same list
        expect(new Store(dir, DOWNLOADS).load()).toMatchObject({ snapshot, recoveredCorrupt: null });
      });

      it('the phase 1 fixture and its next save differ by exactly the three keys on each job', () => {
        writeFileSync(jobsPath(), fixtureText('jobs-phase1.json'));
        const store = new Store(dir, DOWNLOADS);
        store.saveSnapshot(store.load().snapshot);
        const withoutNew = savedFile().jobs.map((j) => {
          const copy = { ...j };
          for (const key of NEW_KEYS) delete copy[key];
          return copy;
        });
        expect(withoutNew).toEqual(fixture('jobs-phase1.json').jobs);
      });
    });

    describe('values the new fields hold survive a save and a load', () => {
      const group: Group = { id: 'g1', title: 'Course', url: 'https://example.com/list', dir: 'D:\\Dl\\Course', createdAt: 1 };

      it('keeps a Referer, a User-Agent and oneShotLogin true across a save and a load', () => {
        const job = makeA3Job({ referer: R, userAgent: UA, oneShotLogin: true, state: 'queued' });
        new Store(dir, DOWNLOADS).saveSnapshot({ jobs: [job], groups: [] });
        const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
        expect(recoveredCorrupt).toBeNull();
        expect(snapshot.jobs).toEqual([job]);
        expect(savedFile().jobs[0]).toMatchObject({ referer: R, userAgent: UA, oneShotLogin: true });
      });

      it('a job with oneShotLogin true and a groupId loads and saves unchanged (A3-Q16: parseJob does not cross-check)', () => {
        const job = makeA3Job({ id: 'j1', groupId: 'g1', index: 1, state: 'queued', referer: R, userAgent: UA, oneShotLogin: true });
        const content = JSON.stringify({ version: 1, jobs: [job], groups: [group] });
        writeFileSync(jobsPath(), content);
        const store = new Store(dir, DOWNLOADS);
        const { snapshot, recoveredCorrupt } = store.load();
        expect(recoveredCorrupt).toBeNull();
        expect(corruptFiles()).toEqual([]);
        expect(snapshot).toEqual({ jobs: [job], groups: [group] });
        store.saveSnapshot(snapshot);
        expect(savedFile()).toEqual({ version: 1, jobs: [job], groups: [group] });
        expect(readFileSync(jobsPath(), 'utf8')).toBe(content);
      });

      it('a lone job with oneShotLogin true, as an A5 build would write it, loads and saves unchanged (B5)', () => {
        const job = makeA3Job({ id: 'j1', kind: 'file', quality: null, baseName: null, fileName: 'a.zip', state: 'paused', referer: null, userAgent: null, oneShotLogin: true });
        writeFileSync(jobsPath(), JSON.stringify({ version: 1, jobs: [job], groups: [] }));
        const store = new Store(dir, DOWNLOADS);
        const { snapshot, recoveredCorrupt } = store.load();
        expect(recoveredCorrupt).toBeNull();
        expect(snapshot.jobs).toEqual([job]);
        store.saveSnapshot(snapshot);
        expect(savedFile().jobs).toEqual([job]);
      });

      it.each(['probing', 'downloading', 'merging'] as const)('a job saved as %s loads as paused and cut off, and keeps all three fields', (state) => {
        const store = new Store(dir, DOWNLOADS);
        store.saveSnapshot({ jobs: [makeA3Job({ state, speed: 900, eta: 12, referer: R, userAgent: UA, oneShotLogin: true })], groups: [] });
        const [job] = store.load().snapshot.jobs;
        expect(job).toMatchObject({ state: 'paused', interrupted: true, referer: R, userAgent: UA, oneShotLogin: true });
      });

      it('a job that is not paused loses interrupted and keeps all three fields', () => {
        const store = new Store(dir, DOWNLOADS);
        store.saveSnapshot({ jobs: [makeA3Job({ state: 'done', fileName: 'a.mp4', interrupted: true, referer: R, userAgent: UA, oneShotLogin: true })], groups: [] });
        expect(store.load().snapshot.jobs[0]).toMatchObject({ interrupted: false, referer: R, userAgent: UA, oneShotLogin: true });
      });

      it('writes no key of a job it did not read: an unknown key is not carried into the next save', () => {
        const job = { ...makeA3Job({ state: 'queued', referer: R }), mystery: 1, handoffId: 'x' };
        writeFileSync(jobsPath(), JSON.stringify({ version: 1, jobs: [job], groups: [] }));
        const store = new Store(dir, DOWNLOADS);
        store.saveSnapshot(store.load().snapshot);
        const text = readFileSync(jobsPath(), 'utf8');
        expect(text).not.toContain('mystery');
        expect(text).not.toContain('handoffId');
        expect(savedFile().jobs[0]).toMatchObject({ referer: R });
      });
    });

    describe('a bad Referer or User-Agent loads as null: nothing is set aside (A3-Q5)', () => {
      it('loads a Referer with a query as null, and the next save holds no query (a persisted Referer has none)', () => {
        const job = makeA3Job({ state: 'queued', referer: 'https://a.example/p?token=SECRET#frag', userAgent: UA });
        writeFileSync(jobsPath(), JSON.stringify({ version: 1, jobs: [job], groups: [] }));
        const store = new Store(dir, DOWNLOADS);
        const { snapshot, recoveredCorrupt } = store.load();
        expect(recoveredCorrupt).toBeNull();
        expect(corruptFiles()).toEqual([]);
        expect(snapshot.jobs[0]).toMatchObject({ referer: null, userAgent: UA });
        store.saveSnapshot(snapshot);
        const text = readFileSync(jobsPath(), 'utf8');
        expect(text).not.toContain('SECRET');
        expect(text).not.toContain('token=');
        expect(savedFile().jobs[0]).toMatchObject({ referer: null, userAgent: UA });
      });

      it.each([
        ['a Referer with a double quote', { referer: 'https://a.example/a"b' }],
        ['a Referer of the wrong type', { referer: 5 }],
        ['a Referer of 2049 units', { referer: `https://a.example/${'a'.repeat(2049 - 'https://a.example/'.length)}` }],
        ['a Referer with a control character', { referer: 'https://a.example/p\u0001q' }],
        ['a User-Agent of 513 characters', { userAgent: 'a'.repeat(513) }],
        ['a User-Agent with a carriage return', { userAgent: 'Mozilla\r\nX-Evil: 1' }],
        ['a User-Agent of the wrong type', { userAgent: ['Mozilla'] }],
        ['an empty User-Agent', { userAgent: '' }],
      ])('loads %s as null, keeps the job and sets nothing aside', (_name, bad) => {
        // `bad` holds wrong-typed values on purpose, so the job is built as a plain record, not as a Job.
        const jobs = [{ ...makeA3Job({ id: 'a', state: 'queued' }), ...bad }, makeA3Job({ id: 'b', state: 'queued', referer: R, userAgent: UA, oneShotLogin: true })];
        writeFileSync(jobsPath(), JSON.stringify({ version: 1, jobs, groups: [] }));
        const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
        expect(recoveredCorrupt).toBeNull();
        expect(corruptFiles()).toEqual([]);
        const field = Object.keys(bad)[0] as 'referer' | 'userAgent';
        expect(snapshot.jobs.map((j) => j.id)).toEqual(['a', 'b']);
        expect(snapshot.jobs[0]?.[field]).toBeNull();
        expect(snapshot.jobs[1]).toMatchObject({ referer: R, userAgent: UA, oneShotLogin: true });
      });
    });

    describe('a oneShotLogin that is not a boolean sets the file aside, as a bad interrupted does (A3-Q5)', () => {
      const NOT_BOOLEAN: [string, unknown][] = [
        ['null', null],
        ['the text "true"', 'true'],
        ['the number 0', 0],
        ['the number 1', 1],
        ['an empty text', ''],
        ['an empty list', []],
        ['an empty object', {}],
      ];

      /** What a set-aside looks like, for whichever field was bad. */
      function expectSetAside(content: string): void {
        const { snapshot, recoveredCorrupt } = new Store(dir, DOWNLOADS).load();
        expect(snapshot).toEqual({ jobs: [], groups: [] });
        expect(recoveredCorrupt).toMatch(/jobs\.json\.corrupt-\d+$/);
        expect(corruptFiles()).toHaveLength(1);
        expect(readFileSync(recoveredCorrupt as string, 'utf8')).toBe(content);
        expect(existsSync(jobsPath())).toBe(false);
      }

      it.each(NOT_BOOLEAN)('oneShotLogin %s: the file is renamed to .corrupt-<ts>, byte for byte, and the list starts empty', (_name, oneShotLogin) => {
        const content = JSON.stringify({ version: 1, jobs: [{ ...makeA3Job({ state: 'paused' }), oneShotLogin }], groups: [] });
        writeFileSync(jobsPath(), content);
        expectSetAside(content);
      });

      it('the same path as a bad interrupted: both leave the same kind of set-aside file', () => {
        const bad = JSON.stringify({ version: 1, jobs: [{ ...makeA3Job({ state: 'paused' }), interrupted: null }], groups: [] });
        writeFileSync(jobsPath(), bad);
        expectSetAside(bad);
      });

      it('sets the file aside even when every other job in it is fine, and nothing is deleted', () => {
        const jobs = [makeA3Job({ id: 'a', state: 'queued', referer: R }), { ...makeA3Job({ id: 'b', state: 'queued' }), oneShotLogin: 'yes' }, makeA3Job({ id: 'c', state: 'queued' })];
        const content = JSON.stringify({ version: 1, jobs, groups: [] });
        writeFileSync(jobsPath(), content);
        expectSetAside(content);
      });

      it('a later start finds no file, and a save afterwards keeps the set-aside file', () => {
        const content = JSON.stringify({ version: 1, jobs: [{ ...makeA3Job({ state: 'paused' }), oneShotLogin: null }], groups: [] });
        writeFileSync(jobsPath(), content);
        const first = new Store(dir, DOWNLOADS).load();
        const aside = first.recoveredCorrupt as string;
        const store = new Store(dir, DOWNLOADS);
        expect(store.load()).toMatchObject({ snapshot: { jobs: [], groups: [] }, recoveredCorrupt: null });
        store.saveSnapshot({ jobs: [makeA3Job({ state: 'queued' })], groups: [] });
        expect(readFileSync(aside, 'utf8')).toBe(content);
        expect(store.load().recoveredCorrupt).toBeNull();
      });
    });
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
