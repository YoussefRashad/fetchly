// A1 Task 2: src/main/atomicFile.ts, the body of Store.writeAtomic moved unchanged (still <path>.tmp).
// tests/jobs/store.test.ts is NOT edited: it must keep passing against the moved code.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAtomic } from '../src/main/atomicFile';
import { Store } from '../src/main/jobs/store';
import type { Settings, Snapshot } from '../src/shared/types';
import { makeSettings } from './helpers';

// A wrapper that keeps the real behaviour, so the direct tests below run the real code and the Store
// tests can see what the Store calls.
vi.mock('../src/main/atomicFile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/atomicFile')>();
  return { ...actual, writeAtomic: vi.fn(actual.writeAtomic) };
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetchly-atomic-'));
  vi.mocked(writeAtomic).mockClear();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeAtomic(dir, path, data)', () => {
  it('writes the data and leaves no .tmp behind', () => {
    const path = join(dir, 'a.json');
    writeAtomic(dir, path, '{"a":1}');
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}');
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(readdirSync(dir)).toEqual(['a.json']);
  });

  it('creates a missing directory, nested ones too', () => {
    const nested = join(dir, 'x', 'y', 'z');
    const path = join(nested, 'a.json');
    writeAtomic(nested, path, 'data');
    expect(readFileSync(path, 'utf8')).toBe('data');
    expect(readdirSync(nested)).toEqual(['a.json']);
  });

  it('works when the directory already exists', () => {
    mkdirSync(join(dir, 'there'));
    const path = join(dir, 'there', 'a.json');
    writeAtomic(join(dir, 'there'), path, 'one');
    expect(readFileSync(path, 'utf8')).toBe('one');
  });

  it('replaces an existing file completely, also with shorter data', () => {
    const path = join(dir, 'a.json');
    writeFileSync(path, 'old old old old old');
    writeAtomic(dir, path, 'new');
    expect(readFileSync(path, 'utf8')).toBe('new');
    writeAtomic(dir, path, '');
    expect(readFileSync(path, 'utf8')).toBe('');
    expect(readdirSync(dir)).toEqual(['a.json']);
  });

  it('writes non-ASCII text as UTF-8', () => {
    const path = join(dir, 'a.json');
    writeAtomic(dir, path, '{"label":"متصفح ✓"}');
    expect(readFileSync(path, 'utf8')).toBe('{"label":"متصفح ✓"}');
  });

  it('writes through the same temp name as before: <path>.tmp', () => {
    // A leftover <path>.tmp (a crash) is reused and replaced, not an error.
    const path = join(dir, 'a.json');
    writeFileSync(`${path}.tmp`, 'leftover from a crash');
    writeAtomic(dir, path, 'fresh');
    expect(readFileSync(path, 'utf8')).toBe('fresh');
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('a failed write leaves the old file intact: the temp name is taken by a directory', () => {
    const path = join(dir, 'a.json');
    writeFileSync(path, 'precious');
    mkdirSync(`${path}.tmp`);
    expect(() => writeAtomic(dir, path, 'new')).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('precious');
  });

  it('a failed write leaves the target intact when the target itself is a directory', () => {
    const path = join(dir, 'a.json');
    mkdirSync(path);
    writeFileSync(join(path, 'inner.txt'), 'inside');
    expect(() => writeAtomic(dir, path, 'new')).toThrow();
    expect(readFileSync(join(path, 'inner.txt'), 'utf8')).toBe('inside');
  });
});

describe('Store goes through atomicFile.writeAtomic (A1: both saves call it)', () => {
  const downloads = 'D:\\Downloads';

  it('saveSettings calls writeAtomic(dataDir, <dir>/settings.json, the settings JSON)', () => {
    const store = new Store(dir, downloads);
    const settings: Settings = makeSettings({ downloadDir: 'D:\\Dl', maxConcurrent: 5 });
    store.saveSettings(settings);
    const calls = vi.mocked(writeAtomic).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(dir);
    expect(calls[0]?.[1]).toBe(join(dir, 'settings.json'));
    expect(JSON.parse(String(calls[0]?.[2]))).toMatchObject({ downloadDir: 'D:\\Dl', maxConcurrent: 5 });
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toMatchObject({ maxConcurrent: 5 });
  });

  it('saveSnapshot calls writeAtomic(dataDir, <dir>/jobs.json, {version:1,...})', () => {
    const store = new Store(dir, downloads);
    const snap: Snapshot = { jobs: [], groups: [] };
    store.saveSnapshot(snap);
    const calls = vi.mocked(writeAtomic).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(dir);
    expect(calls[0]?.[1]).toBe(join(dir, 'jobs.json'));
    expect(JSON.parse(String(calls[0]?.[2]))).toEqual({ version: 1, jobs: [], groups: [] });
    expect(readdirSync(dir).sort()).toEqual(['jobs.json']);
  });

  it('a failing write still throws out of the Store (the queue reports it as a save error)', () => {
    const store = new Store(dir, downloads);
    mkdirSync(join(dir, 'jobs.json.tmp'));
    expect(() => store.saveSnapshot({ jobs: [], groups: [] })).toThrow();
  });
});
