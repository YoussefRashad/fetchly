import { afterEach, describe, expect, it } from 'vitest';
import { SHELL_STRINGS } from '../../src/main/shellStrings';
import { AR } from '../../src/renderer/src/strings.ar';
import { EN, S, setLanguage } from '../../src/renderer/src/strings';

type Leaf = string | ((...args: never[]) => unknown);

/** Every leaf of a dictionary by its dotted path; arrays count as objects (path parts are indexes). */
function leaves(dict: unknown, prefix = ''): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  for (const [key, value] of Object.entries(dict as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string' || typeof value === 'function') out.set(path, value as Leaf);
    else if (typeof value === 'object' && value !== null) for (const [p, v] of leaves(value, path)) out.set(p, v);
    else out.set(path, value as never);
  }
  return out;
}

/** A leaf as text: a function is called with sample arguments (every function here takes strings or numbers). */
const text = (leaf: Leaf): unknown => (typeof leaf === 'function' ? (leaf as (...a: unknown[]) => unknown)('7', '8') : leaf);

/** Leaves that are the same in both languages on purpose: names and figures. */
const SAME_IN_BOTH = new Set(['appName', 'items', 'installTools.0.0', 'installTools.1.0', 'installTools.2.0']);
const SHELL_SAME_IN_BOTH = new Set(['tooltipIdle']);

describe.each([
  ['window', EN, AR, SAME_IN_BOTH],
  ['main process', SHELL_STRINGS.en, SHELL_STRINGS.ar, SHELL_SAME_IN_BOTH],
] as const)('%s dictionaries', (_name, en, ar, same) => {
  const enLeaves = leaves(en);
  const arLeaves = leaves(ar);

  it('have the same keys, nested ones included', () => {
    expect([...arLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it('have only non-empty strings, or functions that return one, as leaves', () => {
    for (const [path, leaf] of [...enLeaves, ...arLeaves]) {
      const value = text(leaf);
      expect(typeof value, path).toBe('string');
      expect((value as string).length, path).toBeGreaterThan(0);
    }
  });

  it('translate every leaf except the names and figures on the allow-list', () => {
    const untranslated = [...enLeaves].filter(([path, leaf]) => arLeaves.has(path) && text(arLeaves.get(path) as Leaf) === text(leaf)).map(([path]) => path);
    expect(untranslated.sort()).toEqual([...same].sort());
  });
});

describe('the Arabic text', () => {
  const all = [...leaves(AR).values(), ...leaves(SHELL_STRINGS.ar).values()].map((l) => String(text(l)));

  it('says تنزيل for download, never تحميل', () => {
    expect(all.filter((s) => s.includes('تحميل'))).toEqual([]);
  });

  it('uses Western digits only', () => {
    expect(all.filter((s) => /[٠-٩۰-۹]/u.test(s))).toEqual([]);
  });
});

describe('setLanguage', () => {
  afterEach(() => setLanguage('en'));

  it('starts in English', () => {
    expect(leaves(S)).toEqual(leaves(EN));
  });

  it('puts the Arabic text into S, nested values included', () => {
    setLanguage('ar');
    for (const [path, leaf] of leaves(AR)) expect(text(leaves(S).get(path) as Leaf), path).toBe(text(leaf));
    expect(S.status.queued).toBe(AR.status.queued);
    expect(S.reasons['disk full']).toBe(AR.reasons['disk full']);
    expect(S.filters.done).toBe(AR.filters.done);
  });

  it('restores every English value after Arabic, nested ones included', () => {
    const before = [...leaves(S)].map(([path, leaf]) => [path, text(leaf)]);
    setLanguage('ar');
    setLanguage('en');
    expect([...leaves(S)].map(([path, leaf]) => [path, text(leaf)])).toEqual(before);
    expect(S.status.queued).toBe('queued');
    expect(S.reasons['disk full']).toBe('disk full');
  });

  it('never changes the dictionaries themselves', () => {
    const en = [...leaves(EN)].map(([path, leaf]) => [path, text(leaf)]);
    const ar = [...leaves(AR)].map(([path, leaf]) => [path, text(leaf)]);
    setLanguage('ar');
    setLanguage('en');
    setLanguage('ar');
    expect([...leaves(EN)].map(([path, leaf]) => [path, text(leaf)])).toEqual(en);
    expect([...leaves(AR)].map(([path, leaf]) => [path, text(leaf)])).toEqual(ar);
  });
});
