// A1 Task 3: Settings.serverPort (migration-class, section 9 of the plan). Everything runs through the real
// Store, validate.ts and settings.json on disk: an invalid port falls back to the default, it is never clamped.
//
// Enumeration (the places a Settings field has to be added, section 9 and architecture section 5):
// DEFAULT_SETTINGS, SETTING_CHECKS, normalizeSettings, parseSettings (driven by SETTING_CHECKS) and the rebuild
// in setSettings (tests/ipcPairing.test.ts). The eight Phase 1 fields are listed in PHASE1_KEYS.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, Store, normalizeSettings } from '../../src/main/jobs/store';
import { parseSettings } from '../../src/main/jobs/validate';
import { DEFAULT_SERVER_PORT } from '../../src/shared/protocol';
import { makeSettings } from '../helpers';

const DOWNLOADS = 'C:\\Users\\me\\Downloads';
const PHASE1_KEYS = ['downloadDir', 'askEveryTime', 'maxConcurrent', 'speedLimitKbps', 'autoResumeOnStart', 'preferMp4Max1080', 'defaultQuality', 'subtitleLangs'];

let dir: string;
const file = (): string => join(dir, 'settings.json');
const writeRaw = (text: string): void => writeFileSync(file(), text);
const load = () => new Store(dir, DOWNLOADS).load().settings;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetchly-port-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A Phase 1 settings.json (no serverPort), every value different from its default. */
const PHASE1 = {
  downloadDir: 'E:\\Videos',
  askEveryTime: true,
  maxConcurrent: 6,
  speedLimitKbps: 750,
  autoResumeOnStart: true,
  preferMp4Max1080: true,
  defaultQuality: { kind: 'max', height: 720 },
  subtitleLangs: ['ar', 'en'],
};

describe('the default', () => {
  it('DEFAULT_SETTINGS carries 38917', () => {
    expect(DEFAULT_SETTINGS(DOWNLOADS).serverPort).toBe(38917);
    expect(DEFAULT_SERVER_PORT).toBe(38917);
  });

  it('a missing settings.json loads the default port', () => {
    expect(load().serverPort).toBe(38917);
  });

  it('a file without serverPort loads 38917', () => {
    writeRaw(JSON.stringify(PHASE1));
    expect(load().serverPort).toBe(38917);
  });

  it('an unreadable settings.json loads the default port', () => {
    writeRaw('{ not json');
    expect(load().serverPort).toBe(38917);
  });

  it('a settings.json that is not an object loads the default port', () => {
    for (const text of ['[]', 'null', '12', '"x"']) {
      writeRaw(text);
      expect(load().serverPort, text).toBe(38917);
    }
  });
});

describe('an invalid port loads the default, not a clamped value', () => {
  // [label, the raw JSON text of the value]. 1e999 is valid JSON text and parses to Infinity.
  const BAD: [string, string][] = [
    ['1023', '1023'],
    ['65536', '65536'],
    ['0', '0'],
    ['-1', '-1'],
    ['80', '80'],
    ['38917.5', '38917.5'],
    ['"38917" (a string)', '"38917"'],
    ['null', 'null'],
    ['true', 'true'],
    ['[] (an array)', '[]'],
    ['[38917]', '[38917]'],
    ['{} (an object)', '{}'],
    ['1e999 (Infinity)', '1e999'],
    ['-1e999', '-1e999'],
    ['70000', '70000'],
    ['1e5', '1e5'],
    ['1024.0000001', '1024.0000001'],
    ['"" (an empty string)', '""'],
  ];

  it.each(BAD)('%s', (_label, raw) => {
    writeRaw(`{ "serverPort": ${raw} }`);
    expect(load().serverPort).toBe(38917);
  });

  it.each(BAD)('%s, next to a user value that must survive', (_label, raw) => {
    writeRaw(`{ "downloadDir": "E:\\\\Videos", "maxConcurrent": 6, "serverPort": ${raw}, "askEveryTime": true }`);
    const s = load();
    expect(s.serverPort).toBe(38917);
    expect(s.downloadDir).toBe('E:\\Videos');
    expect(s.maxConcurrent).toBe(6);
    expect(s.askEveryTime).toBe(true);
  });

  it('a bad port leaves every other field as saved', () => {
    writeRaw(JSON.stringify({ ...PHASE1, serverPort: 80 }));
    expect(load()).toStrictEqual({ ...PHASE1, language: 'system', theme: 'system', serverPort: 38917 });
  });

  it('a bad other field does not take the good port down with it', () => {
    writeRaw(JSON.stringify({ ...PHASE1, maxConcurrent: 'many', serverPort: 40000 }));
    const s = load();
    expect(s.serverPort).toBe(40000);
    expect(s.maxConcurrent).toBe(3);
  });
});

describe('a valid port loads as given', () => {
  it.each([1024, 1025, 38917, 40000, 65534, 65535])('%i', (port) => {
    writeRaw(JSON.stringify({ serverPort: port }));
    expect(load().serverPort).toBe(port);
  });
});

describe('parseSettings (through SETTING_CHECKS)', () => {
  const defaults = makeSettings({ serverPort: 38917 });

  it.each([1024, 65535, 50000])('takes %i', (port) => {
    expect(parseSettings({ serverPort: port }, defaults).serverPort).toBe(port);
  });

  it.each<[string, unknown]>([
    ['1023', 1023],
    ['65536', 65536],
    ['a string', '40000'],
    ['null', null],
    ['absent', undefined],
    ['a fraction', 40000.5],
    ['NaN', NaN],
  ])('keeps the caller default for %s', (_name, bad) => {
    const own = makeSettings({ serverPort: 45000 });
    const raw: Record<string, unknown> = { serverPort: bad };
    expect(parseSettings(raw, own).serverPort).toBe(45000);
  });
});

describe('normalizeSettings', () => {
  it.each<[string, number]>([
    ['1023', 1023],
    ['65536', 65536],
    ['0', 0],
    ['-5', -5],
    ['80', 80],
    ['a fraction', 40000.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('turns an out-of-range or non-integer port (%s) into the default, never a clamp', (_name, port) => {
    expect(normalizeSettings(makeSettings({ serverPort: port })).serverPort).toBe(38917);
  });

  it.each([1024, 38917, 65535])('keeps %i', (port) => {
    expect(normalizeSettings(makeSettings({ serverPort: port })).serverPort).toBe(port);
  });

  it('still clamps the other numeric settings next to a bad port', () => {
    const s = normalizeSettings(makeSettings({ serverPort: 80, maxConcurrent: 50, speedLimitKbps: -5 }));
    expect(s).toMatchObject({ serverPort: 38917, maxConcurrent: 8, speedLimitKbps: 0 });
  });
});

describe('save and load', () => {
  it('a saved 40000 loads as 40000', () => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSettings(makeSettings({ downloadDir: 'E:\\Videos', serverPort: 40000 }));
    expect(JSON.parse(readFileSync(file(), 'utf8')).serverPort).toBe(40000);
    expect(new Store(dir, DOWNLOADS).load().settings.serverPort).toBe(40000);
  });

  it('saving a bad port writes the default (normalizeSettings runs in saveSettings)', () => {
    const store = new Store(dir, DOWNLOADS);
    store.saveSettings(makeSettings({ downloadDir: 'E:\\Videos', serverPort: 80 }));
    expect(JSON.parse(readFileSync(file(), 'utf8')).serverPort).toBe(38917);
  });

  it('the boundaries 1024 and 65535 survive a round trip', () => {
    for (const port of [1024, 65535]) {
      const store = new Store(dir, DOWNLOADS);
      store.saveSettings(makeSettings({ downloadDir: 'E:\\Videos', serverPort: port }));
      expect(new Store(dir, DOWNLOADS).load().settings.serverPort).toBe(port);
    }
  });
});

describe('a Phase 1 fixture', () => {
  it('keeps every old value and gains the default port', () => {
    writeRaw(JSON.stringify(PHASE1, null, 2));
    const s = load();
    for (const key of PHASE1_KEYS) expect(s[key as keyof typeof s], key).toStrictEqual(PHASE1[key as keyof typeof PHASE1]);
    expect(s.serverPort).toBe(38917);
    expect(Object.keys(s).sort()).toEqual([...PHASE1_KEYS, 'language', 'theme', 'serverPort'].sort());
  });

  it('nothing is rewritten at load: the file bytes stay as they were', () => {
    const text = JSON.stringify(PHASE1, null, 2);
    writeRaw(text);
    load();
    expect(readFileSync(file(), 'utf8')).toBe(text);
  });

  it('the next save writes the port next to the old values', () => {
    writeRaw(JSON.stringify(PHASE1));
    const store = new Store(dir, DOWNLOADS);
    store.saveSettings(store.load().settings);
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ ...PHASE1, language: 'system', theme: 'system', serverPort: 38917 });
  });
});
