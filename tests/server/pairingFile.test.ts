// A1 Task 5: pairing.json (load, save, set aside). Real files in a temp dir and the real writer; node:fs is
// wrapped only so the set-aside rename can be made to fail.
//
// Enumeration (the fields of one pairing.json entry, architecture section 5): id, origin, port, tokenHash,
// proofKey, label, pairedAt. Each gets its own invalid cases below (absent, wrong type, wrong length, bad
// characters, boundary). Whole-file rules: version 1 only, a pairings array of at most 4, unique ids.
// Valid but not loaded (S12): an entry whose port is not the effective serverPort.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPairingFile, savePairingFile, type Pairing, type PairingFile } from '../../src/main/server/pairing';
import { ORIGIN_A, ORIGIN_B, makeStore, pairOnce, storedPairing } from './fakes';

const hooks = vi.hoisted(() => ({ renameFails: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const renameSync: typeof actual.renameSync = (...args) => {
    if (hooks.renameFails && String(args[1]).includes('.corrupt-')) throw new Error('EPERM: rename failed');
    return actual.renameSync(...args);
  };
  return { ...actual, renameSync, default: { ...actual, renameSync } };
});

let dir: string;
const FILE = (): string => join(dir, 'pairing.json');
const asides = (): string[] => readdirSync(dir).filter((f) => f.startsWith('pairing.json.corrupt-'));
const valid = (n = 2): PairingFile => ({ version: 1, pairings: Array.from({ length: n }, (_, i) => storedPairing({}, i + 1)) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetchly-pairfile-'));
  hooks.renameFails = false;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('load', () => {
  it('a missing file loads unpaired with no notice', () => {
    expect(loadPairingFile(dir, 38917)).toEqual({ pairings: [], notice: null });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a missing directory loads unpaired with no notice', () => {
    expect(loadPairingFile(join(dir, 'nope'), 38917)).toEqual({ pairings: [], notice: null });
  });

  it('loads a saved file with every entry', () => {
    const file = valid(3);
    writeFileSync(FILE(), JSON.stringify(file));
    const loaded = loadPairingFile(dir, 38917);
    expect(loaded.notice).toBeNull();
    expect(loaded.pairings).toEqual(file.pairings);
    expect(asides()).toEqual([]);
  });

  it('two entries with one origin load', () => {
    const file: PairingFile = { version: 1, pairings: [storedPairing({ origin: ORIGIN_A, label: 'Chrome' }, 1), storedPairing({ origin: ORIGIN_A, label: 'Edge' }, 2)] };
    writeFileSync(FILE(), JSON.stringify(file));
    expect(loadPairingFile(dir, 38917).pairings.map((p) => p.label)).toEqual(['Chrome', 'Edge']);
  });

  it('an empty list is a valid file', () => {
    writeFileSync(FILE(), JSON.stringify({ version: 1, pairings: [] }));
    expect(loadPairingFile(dir, 38917)).toEqual({ pairings: [], notice: null });
    expect(asides()).toEqual([]);
  });

  it('loading never rewrites the file', () => {
    const text = JSON.stringify(valid(2), null, 2);
    writeFileSync(FILE(), text);
    loadPairingFile(dir, 38917);
    expect(readFileSync(FILE(), 'utf8')).toBe(text);
  });
});

describe('save and the round trip', () => {
  it('writes <dir>/pairing.json with exactly version and pairings, and seven keys per entry', () => {
    const file = valid(2);
    savePairingFile(dir, file);
    expect(readdirSync(dir)).toEqual(['pairing.json']); // no .tmp left
    const onDisk = JSON.parse(readFileSync(FILE(), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(onDisk).sort()).toEqual(['pairings', 'version']);
    expect(onDisk['version']).toBe(1);
    for (const e of onDisk['pairings'] as Record<string, unknown>[]) {
      expect(Object.keys(e).sort()).toEqual(['id', 'label', 'origin', 'pairedAt', 'port', 'proofKey', 'tokenHash']);
    }
    expect(onDisk['pairings']).toEqual(file.pairings);
  });

  it('save then load returns the same entries, in order, with no notice', () => {
    const file = valid(4);
    savePairingFile(dir, file);
    expect(loadPairingFile(dir, 38917)).toEqual({ pairings: file.pairings, notice: null });
  });

  it('save creates a missing directory', () => {
    const nested = join(dir, 'a', 'b');
    savePairingFile(nested, valid(1));
    expect(existsSync(join(nested, 'pairing.json'))).toBe(true);
  });

  it('save throws when it cannot write (the caller turns that into the unsaved flag)', () => {
    mkdirSync(join(dir, 'pairing.json.tmp'));
    expect(() => savePairingFile(dir, valid(1))).toThrow();
  });

  it('a store writing through savePairingFile leaves a file the loader accepts', () => {
    const rig = makeStore({ save: (f) => savePairingFile(dir, f) });
    const a = pairOnce(rig.store, { origin: ORIGIN_A, label: 'Chrome' });
    const b = pairOnce(rig.store, { origin: ORIGIN_A, label: 'Edge' });
    const loaded = loadPairingFile(dir, 38917);
    expect(loaded.notice).toBeNull();
    expect(loaded.pairings.map((p) => p.id)).toEqual([a.pairingId, b.pairingId]);
  });
});

describe('a file that cannot be read is set aside', () => {
  it('truncated JSON: kept as pairing.json.corrupt-<n> with its bytes, and a notice is returned', () => {
    const text = JSON.stringify(valid(2)).slice(0, 120);
    writeFileSync(FILE(), text);
    const loaded = loadPairingFile(dir, 38917);
    expect(loaded.pairings).toEqual([]);
    expect(typeof loaded.notice).toBe('string');
    expect(loaded.notice?.length).toBeGreaterThan(0);
    expect(existsSync(FILE())).toBe(false);
    const [aside, ...more] = asides();
    expect(more).toEqual([]);
    expect(aside).toBeDefined();
    expect(readFileSync(join(dir, aside ?? ''), 'utf8')).toBe(text);
  });

  it('the notice never carries key material from the file', () => {
    const file = valid(1);
    const text = JSON.stringify({ ...file, version: 2 });
    writeFileSync(FILE(), text);
    const loaded = loadPairingFile(dir, 38917);
    const e = file.pairings[0];
    expect(loaded.notice).not.toContain(e?.tokenHash ?? 'x');
    expect(loaded.notice).not.toContain(e?.proofKey ?? 'x');
  });

  it('a zero-byte file is set aside', () => {
    writeFileSync(FILE(), '');
    const loaded = loadPairingFile(dir, 38917);
    expect(loaded.pairings).toEqual([]);
    expect(loaded.notice).not.toBeNull();
    expect(asides()).toHaveLength(1);
  });

  it('a path that is a directory (unreadable) does not throw and loads unpaired', () => {
    mkdirSync(FILE());
    const loaded = loadPairingFile(dir, 38917);
    expect(loaded.pairings).toEqual([]);
  });

  it('after a set-aside the next save starts a clean pairing.json', () => {
    writeFileSync(FILE(), '{ truncated');
    loadPairingFile(dir, 38917);
    savePairingFile(dir, valid(1));
    expect(loadPairingFile(dir, 38917).notice).toBeNull();
    expect(asides()).toHaveLength(1);
  });

  it('a failing set-aside rename does not throw; the app starts unpaired', () => {
    writeFileSync(FILE(), '{ truncated');
    hooks.renameFails = true;
    let loaded: ReturnType<typeof loadPairingFile> | undefined;
    expect(() => {
      loaded = loadPairingFile(dir, 38917);
    }).not.toThrow();
    expect(loaded?.pairings).toEqual([]);
  });

  it('a failing set-aside rename also does not throw for an invalid (not truncated) file', () => {
    writeFileSync(FILE(), JSON.stringify({ ...valid(1), version: 2 }));
    hooks.renameFails = true;
    let loaded: ReturnType<typeof loadPairingFile> | undefined;
    expect(() => {
      loaded = loadPairingFile(dir, 38917);
    }).not.toThrow();
    expect(loaded?.pairings).toEqual([]);
  });
});

/** The whole file is set aside for each of these. `mutate` gets a valid file object and returns the text to write. */
const INF = '"__INF__"';
const text = (o: unknown): string => JSON.stringify(o).replace(INF, '1e999');
const withEntry = (patch: Record<string, unknown>, drop: string[] = []): ((f: PairingFile) => string) => (f) => {
  const first = { ...(f.pairings[0] as Pairing), ...patch } as Record<string, unknown>;
  for (const k of drop) delete first[k];
  return text({ ...f, pairings: [first, ...f.pairings.slice(1)] });
};

const A_ID = 'A'.repeat(22);
const HASH43 = 'B'.repeat(43);

const INVALID: [string, (f: PairingFile) => string][] = [
  // whole file
  ['version 2', (f) => text({ ...f, version: 2 })],
  ['version 0', (f) => text({ ...f, version: 0 })],
  ['version "1" (a string)', (f) => text({ ...f, version: '1' })],
  ['version absent', (f) => text({ pairings: f.pairings })],
  ['pairings absent', () => text({ version: 1 })],
  ['pairings an object', () => text({ version: 1, pairings: {} })],
  ['pairings null', () => text({ version: 1, pairings: null })],
  ['pairings a string', () => text({ version: 1, pairings: 'x' })],
  ['the file is an array', () => '[]'],
  ['the file is null', () => 'null'],
  ['the file is a number', () => '12'],
  ['the file is a string', () => '"x"'],
  ['the file is {}', () => '{}'],
  ['5 entries', () => text(valid(5))],
  ['6 entries', () => text(valid(6))],
  ['an entry that is null', (f) => text({ ...f, pairings: [null] })],
  ['an entry that is a string', (f) => text({ ...f, pairings: ['x'] })],
  ['an entry that is an array', (f) => text({ ...f, pairings: [[]] })],
  ['a duplicate id', (f) => text({ ...f, pairings: [f.pairings[0], { ...f.pairings[1], id: f.pairings[0]?.id }] })],
  // id
  ['id absent', withEntry({}, ['id'])],
  ['id of 21 characters', withEntry({ id: A_ID.slice(0, 21) })],
  ['id of 23 characters', withEntry({ id: `${A_ID}A` })],
  ['id with a plus sign', withEntry({ id: `${A_ID.slice(0, 21)}+` })],
  ['id that is a number', withEntry({ id: 1234 })],
  ['id null', withEntry({ id: null })],
  // origin
  ['origin absent', withEntry({}, ['origin'])],
  ['origin with 31 letters', withEntry({ origin: `chrome-extension://${'a'.repeat(31)}` })],
  ['origin with 33 letters', withEntry({ origin: `chrome-extension://${'a'.repeat(33)}` })],
  ['origin with the letter q', withEntry({ origin: `chrome-extension://${'a'.repeat(31)}q` })],
  ['origin in uppercase', withEntry({ origin: `chrome-extension://${'A'.repeat(32)}` })],
  ['origin with a trailing slash', withEntry({ origin: `${ORIGIN_A}/` })],
  ['origin https', withEntry({ origin: `https://${'a'.repeat(32)}` })],
  ['origin a number', withEntry({ origin: 5 })],
  // port
  ['port 80', withEntry({ port: 80 })],
  ['port 1023', withEntry({ port: 1023 })],
  ['port 65536', withEntry({ port: 65536 })],
  ['port 38917.5', withEntry({ port: 38917.5 })],
  ['port "38917" (a string)', withEntry({ port: '38917' })],
  ['port absent', withEntry({}, ['port'])],
  ['port null', withEntry({ port: null })],
  // tokenHash
  ['tokenHash of 42 characters', withEntry({ tokenHash: HASH43.slice(0, 42) })],
  ['tokenHash of 44 characters', withEntry({ tokenHash: `${HASH43}B` })],
  ['tokenHash absent', withEntry({}, ['tokenHash'])],
  ['tokenHash with a plus sign', withEntry({ tokenHash: `${HASH43.slice(0, 42)}+` })],
  ['tokenHash padded', withEntry({ tokenHash: `${HASH43.slice(0, 42)}=` })],
  ['tokenHash a number', withEntry({ tokenHash: 7 })],
  // proofKey
  ['proofKey of 42 characters', withEntry({ proofKey: HASH43.slice(0, 42) })],
  ['proofKey of 44 characters', withEntry({ proofKey: `${HASH43}B` })],
  ['proofKey absent', withEntry({}, ['proofKey'])],
  ['proofKey with a slash', withEntry({ proofKey: `${HASH43.slice(0, 42)}/` })],
  ['proofKey null', withEntry({ proofKey: null })],
  // label
  ['a 41-unit label', withEntry({ label: 'a'.repeat(41) })],
  ['a label of 20 emoji and one letter (41 units)', withEntry({ label: `${'\u{1F600}'.repeat(20)}a` })],
  ['an empty label', withEntry({ label: '' })],
  ['label absent', withEntry({}, ['label'])],
  ['label that is a number', withEntry({ label: 5 })],
  ['label null', withEntry({ label: null })],
  ['a label with U+0000', withEntry({ label: 'a\u0000b' })],
  ['a label with U+001F', withEntry({ label: 'a\u001fb' })],
  ['a label with a newline', withEntry({ label: 'a\nb' })],
  ['a label with U+007F', withEntry({ label: 'a\u007fb' })],
  ['a label with U+202E (bidi override)', withEntry({ label: 'a\u202eb' })],
  ['a label with U+200F (bidi mark)', withEntry({ label: 'a\u200fb' })],
  ['a label with U+2066 (bidi isolate)', withEntry({ label: 'a\u2066b' })],
  // pairedAt
  ['pairedAt not finite (1e999)', withEntry({ pairedAt: '__INF__' })],
  ['pairedAt null', withEntry({ pairedAt: null })],
  ['pairedAt a string', withEntry({ pairedAt: '1700000000000' })],
  ['pairedAt absent', withEntry({}, ['pairedAt'])],
  ['pairedAt true', withEntry({ pairedAt: true })],
];

describe('a structurally invalid file is set aside whole', () => {
  it.each(INVALID)('%s', (_name, mutate) => {
    const body = mutate(valid(2));
    writeFileSync(FILE(), body);
    const loaded = loadPairingFile(dir, 38917);
    expect(loaded.pairings).toEqual([]);
    expect(typeof loaded.notice).toBe('string');
    expect(existsSync(FILE())).toBe(false);
    const found = asides();
    expect(found).toHaveLength(1);
    expect(readFileSync(join(dir, found[0] ?? ''), 'utf8')).toBe(body);
  });
});

describe('the boundaries of those rules are valid', () => {
  const VALID: [string, (f: PairingFile) => string][] = [
    ['4 entries', () => text(valid(4))],
    ['a 1-unit label', withEntry({ label: 'a' })],
    ['a 40-unit label', withEntry({ label: 'a'.repeat(40) })],
    ['a label of 20 emoji (40 units)', withEntry({ label: '\u{1F600}'.repeat(20) })],
    ['a label with an inner space and Arabic letters', withEntry({ label: 'متصفح Edge' })],
    ['a label with a zero-width joiner (not bidi)', withEntry({ label: 'a\u200db' })],
    ['port 1024', withEntry({ port: 1024 }) ],
    ['port 65535', withEntry({ port: 65535 }) ],
    ['pairedAt 0', withEntry({ pairedAt: 0 })],
    ['a fractional pairedAt', withEntry({ pairedAt: 1.5 })],
  ];

  it.each(VALID)('%s', (name, mutate) => {
    const body = mutate(valid(2));
    writeFileSync(FILE(), body);
    // the port boundary entries are loaded for their own port; the others for 38917
    const port = name.startsWith('port ') ? Number(name.slice(5)) : 38917;
    const loaded = loadPairingFile(dir, port);
    expect(loaded.notice).toBeNull();
    expect(asides()).toEqual([]);
    expect(loaded.pairings.length).toBeGreaterThan(0);
  });
});

describe('an unknown extra key is dropped, never carried into the next save', () => {
  it('top-level and entry-level extras load and vanish at the next save', () => {
    const f = valid(1);
    const body = JSON.stringify({ ...f, extra: 'top', pairings: [{ ...f.pairings[0], extra: 'entry', origin2: ORIGIN_B }] });
    writeFileSync(FILE(), body);
    const loaded = loadPairingFile(dir, 38917);
    expect(loaded.notice).toBeNull();
    expect(loaded.pairings).toHaveLength(1);
    const rig = makeStore({ initial: loaded.pairings, save: (file) => savePairingFile(dir, file) });
    pairOnce(rig.store, { origin: ORIGIN_B });
    const onDisk = JSON.parse(readFileSync(FILE(), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(onDisk).sort()).toEqual(['pairings', 'version']);
    for (const e of onDisk['pairings'] as Record<string, unknown>[]) {
      expect(Object.keys(e).sort()).toEqual(['id', 'label', 'origin', 'pairedAt', 'port', 'proofKey', 'tokenHash']);
    }
    expect(readFileSync(FILE(), 'utf8')).not.toContain('"extra"');
    expect(readFileSync(FILE(), 'utf8')).not.toContain('origin2');
  });

  it('what the loader returns has the seven known keys only', () => {
    const f = valid(1);
    writeFileSync(FILE(), JSON.stringify({ ...f, pairings: [{ ...f.pairings[0], extra: 'entry' }] }));
    const e = loadPairingFile(dir, 38917).pairings[0];
    expect(Object.keys(e ?? {}).sort()).toEqual(['id', 'label', 'origin', 'pairedAt', 'port', 'proofKey', 'tokenHash']);
  });
});

describe('S12: a pairing on another port is ignored at load, not deleted', () => {
  const mixed = (): PairingFile => ({ version: 1, pairings: [storedPairing({ port: 38917 }, 1), storedPairing({ port: 40000 }, 2)] });

  it('is not loaded, and the file bytes are unchanged', () => {
    const body = JSON.stringify(mixed(), null, 2);
    writeFileSync(FILE(), body);
    const before = readFileSync(FILE());
    const loaded = loadPairingFile(dir, 38917);
    expect(loaded.pairings.map((p) => p.port)).toEqual([38917]);
    expect(readFileSync(FILE()).equals(before)).toBe(true);
    expect(asides()).toEqual([]);
  });

  it('every entry on another port: nothing loaded, nothing set aside, bytes unchanged', () => {
    const body = JSON.stringify({ version: 1, pairings: [storedPairing({ port: 40000 }, 1), storedPairing({ port: 41000 }, 2)] });
    writeFileSync(FILE(), body);
    const loaded = loadPairingFile(dir, 38917);
    expect(loaded.pairings).toEqual([]);
    expect(readFileSync(FILE(), 'utf8')).toBe(body);
    expect(asides()).toEqual([]);
  });

  it('the next save omits the ignored entry (it is not in memory)', () => {
    writeFileSync(FILE(), JSON.stringify(mixed()));
    const loaded = loadPairingFile(dir, 38917);
    const rig = makeStore({ initial: loaded.pairings, save: (file) => savePairingFile(dir, file) });
    const b = pairOnce(rig.store, { origin: ORIGIN_B, port: 38917 });
    const onDisk = JSON.parse(readFileSync(FILE(), 'utf8')) as PairingFile;
    expect(onDisk.pairings.map((p) => p.port)).toEqual([38917, 38917]);
    expect(onDisk.pairings.some((p) => p.port === 40000)).toBe(false);
    expect(onDisk.pairings.at(-1)?.id).toBe(b.pairingId);
  });

  it('loading with the matching port again, before any save, returns it with its own port and token hash', () => {
    const m = mixed();
    writeFileSync(FILE(), JSON.stringify(m));
    loadPairingFile(dir, 38917); // the first start: ignored
    const again = loadPairingFile(dir, 40000);
    expect(again.pairings).toEqual([m.pairings[1]]);
    expect(again.pairings[0]?.port).toBe(40000);
  });

  it('after a save the ignored entry is gone for good: editing the port back does not revive it', () => {
    writeFileSync(FILE(), JSON.stringify(mixed()));
    const loaded = loadPairingFile(dir, 38917);
    const rig = makeStore({ initial: loaded.pairings, save: (file) => savePairingFile(dir, file) });
    rig.store.clear();
    expect(loadPairingFile(dir, 40000).pairings).toEqual([]);
    expect(loadPairingFile(dir, 38917).pairings).toEqual([]);
  });

  it('the 4-entry limit counts ignored entries too: five entries on any ports are an invalid file', () => {
    const five: PairingFile = { version: 1, pairings: Array.from({ length: 5 }, (_, i) => storedPairing({ port: 38917 + (i % 2) }, i + 1)) };
    writeFileSync(FILE(), JSON.stringify(five));
    expect(loadPairingFile(dir, 38917).pairings).toEqual([]);
    expect(asides()).toHaveLength(1);
  });
});
