import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, Store } from '../../src/main/jobs/store';
import type { Group } from '../../src/shared/types';
import { makeJob, makeSettings } from '../helpers';

let dir: string;
const DOWNLOADS = 'C:\\Users\\me\\Downloads';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hammel-store-'));
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
    expect(loaded.settings.downloadDir).toBe(join(DOWNLOADS, 'Hammel'));
    expect(loaded.settings.maxConcurrent).toBe(3);
  });

  it.each(['probing', 'downloading', 'merging'] as const)('loads a job saved as %s as paused', (state) => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSnapshot({ jobs: [makeJob({ state, speed: 900, eta: 12, bytesDone: 50 })], groups: [] });
    const [job] = store.load().snapshot.jobs;
    expect(job).toMatchObject({ state: 'paused', speed: 0, eta: null, bytesDone: 50 });
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

  it('creates its data folder when it does not exist yet', () => {
    const nested = join(dir, 'a', 'b');
    new Store(nested, DOWNLOADS).saveSnapshot({ jobs: [], groups: [] });
    expect(existsSync(join(nested, 'jobs.json'))).toBe(true);
  });
});
