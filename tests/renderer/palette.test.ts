import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrast } from '../../src/renderer/src/model/contrast';
import { PALETTE, PALETTE_KEYS, cssVar, windowBackgroundFor, type PaletteKey, type PaletteMode } from '../../src/shared/palette';

const MODES: readonly PaletteMode[] = ['light', 'dark'];

/** Plan 5.1, written out literally: 17 keys in two modes, 34 values. A changed token is a visible change in this file. */
const EXPECTED: Record<PaletteMode, Record<PaletteKey, string>> = {
  light: {
    bg: '#EDF0F4',
    chrome: '#E3E8EE',
    surface: '#FFFFFF',
    ink: '#14202C',
    muted: '#566375',
    line: '#D3DAE3',
    field: '#7D8898',
    accent: '#2346C4',
    onAccent: '#FFFFFF',
    laneV: '#2346C4',
    laneA: '#0B7A6E',
    track: '#E2E7EE',
    ok: '#167447',
    bad: '#B3261E',
    warn: '#8F5600',
    hover: '#E8ECF2',
    tint: '#EEF2FF',
  },
  dark: {
    bg: '#0F151C',
    chrome: '#0B1016',
    surface: '#161F29',
    ink: '#E3E9F0',
    muted: '#95A3B5',
    line: '#26323F',
    field: '#647387',
    accent: '#8AA4FF',
    onAccent: '#0B1530',
    laneV: '#8AA4FF',
    laneA: '#3CC4B2',
    track: '#243040',
    ok: '#4CC98A',
    bad: '#FF7B72',
    warn: '#E8B04B',
    hover: '#1E2935',
    tint: '#1A2540',
  },
};

const KEYS = Object.keys(EXPECTED.light).sort() as PaletteKey[];

/** The CSS custom property of each key (plan 5.1: the kebab case of the key). */
const CSS_NAMES: Record<PaletteKey, string> = {
  bg: '--bg',
  chrome: '--chrome',
  surface: '--surface',
  ink: '--ink',
  muted: '--muted',
  line: '--line',
  field: '--field',
  accent: '--accent',
  onAccent: '--on-accent',
  laneV: '--lane-v',
  laneA: '--lane-a',
  track: '--track',
  ok: '--ok',
  bad: '--bad',
  warn: '--warn',
  hover: '--hover',
  tint: '--tint',
};

describe('PALETTE: shape', () => {
  it('lists exactly the 17 keys of the plan, each once', () => {
    expect(PALETTE_KEYS).toHaveLength(17);
    expect(new Set(PALETTE_KEYS).size).toBe(17);
    expect([...PALETTE_KEYS].sort()).toEqual(KEYS);
    expect(KEYS).toHaveLength(17);
  });

  it('has exactly the two modes', () => {
    expect(Object.keys(PALETTE).sort()).toEqual(['dark', 'light']);
  });

  it.each(MODES)('has exactly the 17 keys in %s, no more and no fewer', (mode) => {
    expect(Object.keys(PALETTE[mode]).sort()).toEqual(KEYS);
  });

  it.each(MODES)('writes every %s value as an uppercase #RRGGBB string', (mode) => {
    const bad = PALETTE_KEYS.filter((key) => !/^#[0-9A-F]{6}$/.test(PALETTE[mode][key]));
    expect(bad).toEqual([]);
  });
});

describe('PALETTE: values', () => {
  it.each(MODES.flatMap((mode) => KEYS.map((key) => [mode, key] as const)))('%s %s', (mode, key) => {
    expect(PALETTE[mode][key]).toBe(EXPECTED[mode][key]);
  });

  it.each(MODES)('equals the literal %s block of the plan', (mode) => {
    expect(PALETTE[mode]).toEqual(EXPECTED[mode]);
  });

  it('has 34 literal values and the light "ok" is the adjusted one, not the architecture value', () => {
    expect(Object.values(EXPECTED.light).length + Object.values(EXPECTED.dark).length).toBe(34);
    expect(PALETTE.light.ok).toBe('#167447');
    expect(PALETTE.light.ok).not.toBe('#17784A');
  });
});

describe('cssVar', () => {
  it.each(Object.entries(CSS_NAMES) as Array<[PaletteKey, string]>)('turns %s into %s', (key, name) => {
    expect(cssVar(key)).toBe(name);
  });

  it('is checked for all 17 keys and the names are distinct', () => {
    const names = PALETTE_KEYS.map(cssVar);
    expect(names).toHaveLength(17);
    expect(new Set(names).size).toBe(17);
    expect([...names].sort()).toEqual(Object.values(CSS_NAMES).sort());
  });

  it('gives --bg, --on-accent, --lane-v and --lane-a for bg, onAccent, laneV and laneA', () => {
    expect(cssVar('bg')).toBe('--bg');
    expect(cssVar('onAccent')).toBe('--on-accent');
    expect(cssVar('laneV')).toBe('--lane-v');
    expect(cssVar('laneA')).toBe('--lane-a');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// styles.css and appearance.ts are read as text (no DOM, and the file is not importable). Lazy, so a missing file
// fails only the test that needs it.

const readSource = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const readStyles = (): string => readSource('../../src/renderer/src/styles.css');

interface CssBlocks {
  /** The comment-free text of the whole file. */
  text: string;
  light: { body: string; start: number; end: number } | null;
  dark: { body: string; start: number; end: number } | null;
  /** The comment-free text with the two palette bodies removed. */
  rest: string;
}

function parseStyles(): CssBlocks {
  const text = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
  const find = (re: RegExp): CssBlocks['light'] => {
    const m = re.exec(text);
    if (m === null) return null;
    const body = m[1] ?? '';
    // Both patterns end with the closing brace right after the captured body.
    const end = m.index + m[0].length - 1;
    return { body, start: end - body.length, end };
  };
  const light = find(/(?:^|\})\s*:root\s*\{([^}]*)\}/);
  const dark = find(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/);
  let rest = text;
  for (const range of [light, dark].filter((r) => r !== null).sort((a, b) => b.start - a.start)) {
    rest = rest.slice(0, range.start) + rest.slice(range.end);
  }
  return { text, light, dark, rest };
}

/** Every custom-property declaration of a block body, with its trimmed value. The trailing semicolon is required. */
function declarations(body: string): Array<[name: string, value: string]> {
  return [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]);
}

describe('windowBackgroundFor', () => {
  it('gives the light background for false and the dark one for true', () => {
    expect(windowBackgroundFor(false)).toBe('#EDF0F4');
    expect(windowBackgroundFor(false)).toBe(PALETTE.light.bg);
    expect(windowBackgroundFor(true)).toBe('#0F151C');
    expect(windowBackgroundFor(true)).toBe(PALETTE.dark.bg);
  });

  it('gives a different colour for each mode', () => {
    expect(windowBackgroundFor(true)).not.toBe(windowBackgroundFor(false));
  });

  it.each([
    ['light', false],
    ['dark', true],
  ] as const)('is the --bg of the %s block of styles.css, whatever the letter case', (mode, dark) => {
    const blocks = parseStyles();
    const block = mode === 'light' ? blocks.light : blocks.dark;
    expect(block).not.toBeNull();
    const bg = declarations(block?.body ?? '').find(([name]) => name === '--bg');
    expect(bg, `--bg in the ${mode} block`).toBeDefined();
    expect((bg?.[1] ?? '').toLowerCase()).toBe(windowBackgroundFor(dark).toLowerCase());
  });
});

describe('contrast ratios of the palette (architecture 7.10)', () => {
  const ratio = (mode: PaletteMode, a: PaletteKey, b: PaletteKey): number => contrast(PALETTE[mode][a], PALETTE[mode][b]);

  const TEXT: readonly PaletteKey[] = ['ink', 'muted', 'ok', 'bad', 'warn', 'accent'];

  describe.each(MODES)('%s', (mode) => {
    // 1. text tokens on the page and on a card: 4.5
    for (const token of TEXT) {
      for (const surface of ['bg', 'surface'] as const) {
        it(`${token} on ${surface} is at least 4.5`, () => {
          expect(ratio(mode, token, surface), `${mode} ${token}/${surface}`).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    // 2. the label on the primary fill: 4.5
    it('onAccent on accent is at least 4.5', () => {
      expect(ratio(mode, 'onAccent', 'accent')).toBeGreaterThanOrEqual(4.5);
    });

    // 3. boundaries: 3
    for (const token of ['field', 'accent'] as const) {
      for (const surface of ['bg', 'surface'] as const) {
        it(`${token} on ${surface} is at least 3`, () => {
          expect(ratio(mode, token, surface), `${mode} ${token}/${surface}`).toBeGreaterThanOrEqual(3);
        });
      }
    }

    // 4. lane fills on their track and on a card: 3
    for (const lane of ['laneV', 'laneA'] as const) {
      for (const surface of ['track', 'surface'] as const) {
        it(`${lane} on ${surface} is at least 3`, () => {
          expect(ratio(mode, lane, surface), `${mode} ${lane}/${surface}`).toBeGreaterThanOrEqual(3);
        });
      }
    }

    // Extra (Q3): every text token on the three surfaces C3 and C5 put text on: 4.5. 36 assertions over both modes.
    for (const token of TEXT) {
      for (const surface of ['chrome', 'hover', 'tint'] as const) {
        it(`${token} on ${surface} is at least 4.5`, () => {
          expect(ratio(mode, token, surface), `${mode} ${token}/${surface}`).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  });

  it('keeps the margin that motivated the light "ok" adjustment: the old value fails on chrome, the new one passes', () => {
    expect(contrast('#17784A', PALETTE.light.chrome)).toBeLessThan(4.5);
    expect(contrast(PALETTE.light.ok, PALETTE.light.chrome)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('styles.css: the palette blocks equal PALETTE', () => {
  const NAMES = PALETTE_KEYS.map(cssVar);

  it('has both blocks: the first top-level :root rule and the :root inside the dark prefers-color-scheme media query', () => {
    const { light, dark } = parseStyles();
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
  });

  describe.each(MODES)('%s block', (mode) => {
    const body = (): string => {
      const blocks = parseStyles();
      return (mode === 'light' ? blocks.light : blocks.dark)?.body ?? '';
    };

    it('holds exactly 17 custom-property declarations, so a duplicated name fails whatever its value', () => {
      expect(declarations(body())).toHaveLength(17);
    });

    it('holds exactly the 17 palette names: none extra and none missing', () => {
      expect(declarations(body()).map(([name]) => name).sort()).toEqual([...NAMES].sort());
    });

    it('ends every declaration with a semicolon, the last one too', () => {
      expect(body().trimEnd().endsWith(';')).toBe(true);
    });

    it('writes every value as the full six-digit #RRGGBB form, either case', () => {
      const bad = declarations(body()).filter(([, value]) => !/^#[0-9A-Fa-f]{6}$/.test(value));
      expect(bad).toEqual([]);
    });

    it('gives each token the value of PALETTE, whatever the letter case', () => {
      const found = new Map(declarations(body()));
      for (const key of PALETTE_KEYS) {
        const value = found.get(cssVar(key));
        expect(value, `${mode} ${cssVar(key)}`).toBeDefined();
        expect((value ?? '').toLowerCase(), `${mode} ${cssVar(key)}`).toBe(PALETTE[mode][key].toLowerCase());
      }
    });
  });

  describe('outside the two blocks', () => {
    it('has no #hex colour at all', () => {
      expect(parseStyles().rest.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    });

    it.each(NAMES)('does not declare %s anywhere else (not in a later :root, :root:lang(ar), body or any other rule)', (name) => {
      const declared = new RegExp('(?<![\\w-])' + name + '\\s*:');
      expect(parseStyles().rest.match(declared)).toBeNull();
    });

    it('still uses the tokens: a var() of a palette name has no colon and is not a declaration', () => {
      // A guard for the pattern above: the file reads --bg, --ink and --surface through var().
      const { rest } = parseStyles();
      for (const name of ['--bg', '--ink', '--surface']) expect(rest).toContain(`var(${name})`);
    });
  });

  it('no longer uses the old token names --panel, --text, --bar or --accent-text anywhere in the file', () => {
    expect(readStyles().match(/--(panel|text|bar|accent-text)\b/g)).toBeNull();
  });
});

describe('appearance.ts: the window background', () => {
  const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('takes its background from windowBackgroundFor(nativeTheme.shouldUseDarkColors)', () => {
    const source = stripComments(readSource('../../src/main/appearance.ts'));
    expect(source).toMatch(/windowBackgroundFor\(\s*nativeTheme\.shouldUseDarkColors\s*\)/);
  });

  it('holds no #RRGGBB colour literal', () => {
    expect(readSource('../../src/main/appearance.ts').match(/#[0-9a-fA-F]{6}\b/g)).toBeNull();
  });

  // Beyond the plan's pattern, which sees only six digits: no #RGB, #RGBA or #RRGGBBAA literal in code either.
  it('holds no short or long #hex colour literal in code', () => {
    expect(stripComments(readSource('../../src/main/appearance.ts')).match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });
});
