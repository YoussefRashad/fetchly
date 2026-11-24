import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, ICONS, MIRRORED_ICONS, type IconName, type IconShape } from '../../src/renderer/src/model/icons';

// ---------------------------------------------------------------------------------------------------------------
// Plan 5.4: the 22 names and their geometry, written out literally. A changed icon is a visible change in this file.

type Shape = { tag: 'path'; d: string } | { tag: 'circle'; cx: number; cy: number; r: number } | { tag: 'rect'; x: number; y: number; width: number; height: number; rx: number };

const path = (d: string): Shape => ({ tag: 'path', d });
const circle = (cx: number, cy: number, r: number): Shape => ({ tag: 'circle', cx, cy, r });
const rect = (x: number, y: number, width: number, height: number, rx: number): Shape => ({ tag: 'rect', x, y, width, height, rx });

const GEOMETRY: Record<IconName, readonly Shape[]> = {
  pause: [path('M9 6v12M15 6v12')],
  play: [path('M8.25 5.25l10.5 6.75-10.5 6.75z')],
  close: [path('M6 6l12 12M18 6l-12 12')],
  retry: [path('M18.75 12a6.75 6.75 0 1 1-1.95-4.8'), path('M18.75 3.75v4.5h-4.5')],
  trash: [path('M4.5 6.75h15'), path('M9.75 6.75V4.5h4.5v2.25'), path('M6.75 6.75l.75 13.5h9l.75-13.5'), path('M10.5 10.5v6M13.5 10.5v6')],
  folder: [path('M3 6.75h6l2.25 2.25H21v9.75H3z')],
  gear: [circle(12, 12, 3.3), path('M12 2.25v3M12 18.75v3M2.25 12h3M18.75 12h3M5.1 5.1l2.1 2.1M16.8 16.8l2.1 2.1M5.1 18.9l2.1-2.1M16.8 7.2l2.1-2.1')],
  chevronDown: [path('M6 9l6 6 6-6')],
  chevronEnd: [path('M9 6l6 6-6 6')],
  check: [path('M5.25 12.75l4.5 4.5 9-10.5')],
  alert: [path('M12 3l9.75 17.25h-19.5z'), path('M12 9.75v5.25M12 18v.3')],
  link: [
    path('M10.5 13.5a4.5 4.5 0 0 0 6.3 0l3-3a4.5 4.5 0 0 0-6.3-6.3l-1.2 1.2'),
    path('M13.5 10.5a4.5 4.5 0 0 0-6.3 0l-3 3A4.5 4.5 0 0 0 10.5 19.8l1.2-1.2'),
  ],
  list: [path('M4.5 6h15M4.5 12h15M4.5 18h15')],
  download: [path('M12 3.75v12.75M6.75 11.25L12 16.5l5.25-5.25M4.5 20.25h15')],
  open: [path('M13.5 3.75h6.75V10.5'), path('M20.25 3.75L11.25 12.75'), path('M18 14.25v6H3.75V6H9.75')],
  film: [rect(3, 4.5, 18, 15, 2.25), path('M7.5 4.5v15M16.5 4.5v15M3 9.75h4.5M16.5 9.75h4.5M3 14.25h4.5M16.5 14.25h4.5')],
  music: [path('M9 18V5.25l10.5-2.25V15'), circle(6.75, 18, 2.25), circle(17.25, 15, 2.25)],
  file: [path('M6 2.25h8.25L18.75 6.75V21.75H6z'), path('M14.25 2.25v4.5h4.5')],
  stack: [rect(3.75, 8.25, 16.5, 12, 2.25), path('M6 5.25h12M8.25 2.7h7.5')],
  palette: [circle(12, 12, 9), circle(8.25, 10.5, 1.05), circle(12, 7.5, 1.05), circle(15.75, 10.5, 1.05)],
  globe: [path('M3 12h18'), circle(12, 12, 9)],
  wrench: [path('M15 3.75a4.5 4.5 0 0 0-4.2 6L3.75 16.8l3.45 3.45 7.05-7.05a4.5 4.5 0 0 0 6-4.2l-2.7 1.8-2.55-2.55z')],
};

const NAMES = Object.keys(GEOMETRY).sort() as IconName[];

/** Path data as commands and numbers, so spacing and comma style do not matter but every digit does. */
function tokens(d: string): Array<string | number> {
  const re = /[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)/g;
  const leftover = d.replace(re, '').replace(/[\s,]/g, '');
  if (leftover !== '') throw new Error(`unreadable path data: ${JSON.stringify(leftover)} in ${d}`);
  return (d.match(re) ?? []).map((t) => (/[A-Za-z]/.test(t) ? t : Number(t)));
}

const normal = (shape: Shape | IconShape): unknown => (shape.tag === 'path' ? { tag: 'path', tokens: tokens(shape.d) } : { ...shape });

describe('ICON_NAMES and ICONS: the data', () => {
  it('lists the 22 names of the plan, each once', () => {
    expect(NAMES).toHaveLength(22);
    expect(ICON_NAMES).toHaveLength(22);
    expect(new Set(ICON_NAMES).size).toBe(22);
    expect([...ICON_NAMES].sort()).toEqual(NAMES);
  });

  it('has an entry in ICONS for each name and no other', () => {
    expect(Object.keys(ICONS).sort()).toEqual(NAMES);
  });

  it.each(NAMES)('%s has at least one shape', (name) => {
    expect(ICONS[name].length).toBeGreaterThanOrEqual(1);
  });

  it.each(NAMES)('%s has only path, circle and rect shapes, with exactly their own fields (stroke-only: no fill, no stroke)', (name) => {
    const keys: Record<string, string[]> = {
      path: ['d', 'tag'],
      circle: ['cx', 'cy', 'r', 'tag'],
      rect: ['height', 'rx', 'tag', 'width', 'x', 'y'],
    };
    for (const shape of ICONS[name]) {
      expect(Object.keys(keys), `${name}: tag ${shape.tag}`).toContain(shape.tag);
      expect(Object.keys(shape).sort(), `${name}: ${shape.tag}`).toEqual(keys[shape.tag]);
    }
  });

  it.each(NAMES)('%s: every path has non-empty data of the allowed characters only', (name) => {
    for (const shape of ICONS[name]) {
      if (shape.tag !== 'path') continue;
      expect(typeof shape.d, name).toBe('string');
      expect(shape.d.length, name).toBeGreaterThan(0);
      expect(shape.d, name).toMatch(/^[MmLlHhVvAaQqZz0-9 .,-]+$/);
    }
  });

  it.each(NAMES)('%s: every circle and rect number is finite and lies in 0..24', (name) => {
    for (const shape of ICONS[name]) {
      if (shape.tag === 'path') continue;
      const numbers = Object.entries(shape).filter(([key]) => key !== 'tag');
      expect(numbers.length, `${name} ${shape.tag}`).toBe(shape.tag === 'circle' ? 3 : 5);
      for (const [key, value] of numbers) {
        expect(typeof value, `${name} ${shape.tag}.${key}`).toBe('number');
        expect(Number.isFinite(value), `${name} ${shape.tag}.${key} is finite`).toBe(true);
        expect(value as number, `${name} ${shape.tag}.${key} >= 0`).toBeGreaterThanOrEqual(0);
        expect(value as number, `${name} ${shape.tag}.${key} <= 24`).toBeLessThanOrEqual(24);
      }
    }
  });

  // Beyond 7.4's list: the geometry column of 5.4, icon by icon.
  it.each(NAMES)('%s has the geometry of the plan, shape by shape and in order', (name) => {
    expect(ICONS[name].map(normal)).toEqual(GEOMETRY[name].map(normal));
  });

  it('reads path data without caring about spacing, so the geometry check is about the numbers', () => {
    expect(tokens('M9 6v12M15 6v12')).toEqual(tokens('M 9,6 v 12 M 15 6 v 12'));
    expect(tokens('M12 18v.3')).toEqual(['M', 12, 18, 'v', 0.3]);
    expect(tokens('a6.75 6.75 0 1 1-1.95-4.8')).toEqual(['a', 6.75, 6.75, 0, 1, 1, -1.95, -4.8]);
    expect(tokens('M9 6v12')).not.toEqual(tokens('M9 6v13'));
  });
});

describe('MIRRORED_ICONS', () => {
  it('is exactly chevronEnd and open', () => {
    expect([...MIRRORED_ICONS].sort()).toEqual(['chevronEnd', 'open']);
  });

  it('is a Set, and the plan says it is read through has()', () => {
    expect(MIRRORED_ICONS).toBeInstanceOf(Set);
    expect(MIRRORED_ICONS.size).toBe(2);
  });

  it.each(NAMES)('%s mirrors under RTL only if it points along the reading direction', (name) => {
    expect(MIRRORED_ICONS.has(name)).toBe(name === 'chevronEnd' || name === 'open');
  });

  it('does not mirror play, pause, check, folder, trash, retry or chevronDown', () => {
    for (const name of ['play', 'pause', 'check', 'folder', 'trash', 'retry', 'chevronDown'] as const) expect(MIRRORED_ICONS.has(name), name).toBe(false);
  });

  it('only names icons that exist', () => {
    for (const name of MIRRORED_ICONS) expect(Object.keys(ICONS)).toContain(name);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Text: no DOM and no JSX setting under tsconfig.node.json, so component sources and the style sheet are read as text.
// Lazy, so a missing file fails only the test that needs it.

const SRC = '../../src/renderer/src/';
const read = (relative: string): string => readFileSync(fileURLToPath(new URL(SRC + relative, import.meta.url)), 'utf8');
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const componentFiles = (): string[] => readdirSync(fileURLToPath(new URL(SRC + 'components/', import.meta.url))).filter((f) => f.endsWith('.tsx')).sort();
/** App.tsx and every components/*.tsx, as paths below src/renderer/src/. */
const rendererFiles = (): string[] => ['App.tsx', ...componentFiles().map((f) => `components/${f}`)];

describe('components/Icon.tsx (text)', () => {
  it('contains <svg, aria-hidden="true" and viewBox="0 0 24 24"', () => {
    const source = stripComments(read('components/Icon.tsx'));
    expect(source).toContain('<svg');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('viewBox="0 0 24 24"');
  });

  it('contains no <span and no JSX.Element', () => {
    const source = read('components/Icon.tsx');
    expect(source).not.toContain('<span');
    expect(source).not.toContain('JSX.Element');
  });

  it('names JSX.Element in no file of App.tsx and components/*.tsx', () => {
    const offenders = rendererFiles().filter((file) => read(file).includes('JSX.Element'));
    expect(offenders).toEqual([]);
  });

  // Beyond 7.4's list: the "Rendering" paragraph of 5.4. Patterns are loose about JSX syntax, not about the values.
  describe('renders what 5.4 says', () => {
    const source = (): string => stripComments(read('components/Icon.tsx'));

    it('is one <svg> with no wrapper, no <title> and no text element', () => {
      expect(source().match(/<svg\b/g) ?? []).toHaveLength(1);
      expect(source()).not.toMatch(/<(div|span|g|title|text|Fragment)\b|<>/);
    });

    it('sets the stroke-only attributes', () => {
      expect(source()).toMatch(/\bfill\s*=\s*["{']+\s*none/);
      expect(source()).toMatch(/\bstroke\s*=\s*["{']+\s*currentColor/);
      expect(source()).toMatch(/\bstrokeWidth\s*=\s*\{?\s*["']?2\.5\b/);
      expect(source()).toMatch(/\bstrokeLinecap\s*=\s*["{']+\s*round/);
      expect(source()).toMatch(/\bstrokeLinejoin\s*=\s*["{']+\s*round/);
      expect(source()).toMatch(/\bfocusable\s*=\s*["{']+\s*false/);
    });

    it('sets width and height from size, which defaults to 16', () => {
      expect(source()).toMatch(/\bsize\s*=\s*16\b/);
      expect(source()).toMatch(/\bwidth\s*=\s*\{\s*size\s*\}/);
      expect(source()).toMatch(/\bheight\s*=\s*\{\s*size\s*\}/);
    });

    it('takes a name of type IconName and exports Icon', () => {
      expect(source()).toMatch(/\bname\s*:\s*IconName\b/);
      expect(source()).toMatch(/export\s+function\s+Icon\s*\(/);
    });

    it('has class icon, plus icon-mirror for the names in MIRRORED_ICONS, plus className', () => {
      expect(source()).toMatch(/['"`]icon[\s'"`$]/);
      expect(source()).toContain('icon-mirror');
      expect(source()).toContain('MIRRORED_ICONS');
      expect(source()).toMatch(/\bclassName\b/);
    });

    it('takes its shapes from the data module', () => {
      expect(source()).toMatch(/from\s+['"]\.\.\/model\/icons['"]/);
      expect(source()).toMatch(/\bICONS\b/);
    });
  });
});

describe('no glyph is used as an icon any more', () => {
  // Today's ⚙ ✕ ❚ ▶ ↻ 🗑 📁 ▾ ▸, written as code points so no literal glyph sits in a regex character class.
  const GLYPHS: ReadonlyArray<readonly [codePoint: number, name: string]> = [
    [0x2699, 'gear'],
    [0x2715, 'multiplication X'],
    [0x275a, 'heavy vertical bar'],
    [0x25b6, 'play triangle'],
    [0x21bb, 'clockwise arrow'],
    [0x1f5d1, 'wastebasket'],
    [0x1f4c1, 'file folder'],
    [0x25be, 'small down triangle'],
    [0x25b8, 'small right triangle'],
  ];

  it('finds App.tsx and every component file, so the checks below are not empty', () => {
    expect(rendererFiles()).toEqual(
      expect.arrayContaining([
        'App.tsx',
        'components/AddDialog.tsx',
        'components/GroupRow.tsx',
        'components/Icon.tsx',
        'components/InstallScreen.tsx',
        'components/JobList.tsx',
        'components/JobRow.tsx',
        'components/SettingsDialog.tsx',
        'components/UrlBar.tsx',
      ]),
    );
  });

  it.each(GLYPHS.map(([cp, name]) => [`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`, name, cp] as const))(
    '%s (%s) is in no file of App.tsx and components/*.tsx',
    (_label, _name, cp) => {
      const glyph = String.fromCodePoint(cp);
      const offenders = rendererFiles().filter((file) => read(file).includes(glyph));
      expect(offenders).toEqual([]);
    },
  );

  it('is checked with a regex of \\u{...} escapes and the u flag as well, for all nine code points', () => {
    const any = /[\u{2699}\u{2715}\u{275A}\u{25B6}\u{21BB}\u{1F5D1}\u{1F4C1}\u{25BE}\u{25B8}]/u;
    const offenders = rendererFiles().filter((file) => any.test(read(file)));
    expect(offenders).toEqual([]);
  });
});

describe('every glyph site now draws its Icon (beyond 7.4: the replacement table of 5.4, button by button)', () => {
  /**
   * The whole <button …>…</button> that holds `anchor`: from the `<button` before it to the next `</button>`.
   * The anchors are code the plan leaves unchanged (handlers and accessible names), so each icon is bound to its own button.
   */
  const buttonWith = (file: string, anchor: string): string => {
    const source = stripComments(read(file));
    const at = source.indexOf(anchor);
    expect(at, `${anchor} is in ${file}`).toBeGreaterThan(-1);
    const start = source.lastIndexOf('<button', at);
    const end = source.indexOf('</button>', at);
    expect(start, `a <button before ${anchor} in ${file}`).toBeGreaterThan(-1);
    expect(end, `a </button> after ${anchor} in ${file}`).toBeGreaterThan(at);
    return source.slice(start, end);
  };
  /** The icon names written inside the <Icon …/> elements of a button (not in its handlers). */
  const names = (button: string): string[] =>
    (button.match(/<Icon\b[^/]*\/>/g) ?? []).flatMap((element) => [...element.matchAll(/['"]([A-Za-z]+)['"]/g)].map((m) => m[1] as string));

  it('App.tsx: the close-message button is an icon button that draws close', () => {
    const button = buttonWith('App.tsx', 'aria-label={S.close}');
    expect(button).toMatch(/<Icon\b/);
    expect(names(button)).toEqual(['close']);
    expect(button).toContain('icon-btn');
    expect(stripComments(read('App.tsx'))).toMatch(/from\s+['"]\.\/components\/Icon['"]/);
  });

  it('UrlBar.tsx: the settings button is an icon button that draws gear', () => {
    const button = buttonWith('components/UrlBar.tsx', 'aria-label={S.settings}');
    expect(button).toMatch(/<Icon\b/);
    expect(names(button)).toEqual(['gear']);
    expect(button).toContain('icon-btn');
  });

  it('JobRow.tsx: ICONS maps each verb to its icon name', () => {
    const source = stripComments(read('components/JobRow.tsx'));
    expect(source).toMatch(/Record<\s*JobVerb\s*,\s*IconName\s*>/);
    expect(source).not.toMatch(/Record<\s*JobVerb\s*,\s*string\s*>/);
    expect(source).toMatch(/\bpause\s*:\s*['"]pause['"]/);
    expect(source).toMatch(/\bresume\s*:\s*['"]play['"]/);
    expect(source).toMatch(/\bcancel\s*:\s*['"]close['"]/);
    expect(source).toMatch(/\bretry\s*:\s*['"]retry['"]/);
    expect(source).toMatch(/\bremove\s*:\s*['"]close['"]/);
    expect(source).toMatch(/\bremoveWithFile\s*:\s*['"]trash['"]/);
  });

  it('JobRow.tsx: the folder button is an icon button that draws folder', () => {
    const button = buttonWith('components/JobRow.tsx', "open('folder')");
    expect(button).toMatch(/<Icon\b/);
    expect(names(button)).toEqual(['folder']);
    expect(button).toContain('icon-btn');
  });

  it('JobRow.tsx: the verb buttons are icon buttons that draw their ICONS entry', () => {
    const button = buttonWith('components/JobRow.tsx', 'act(verb)');
    expect(button).toMatch(/<Icon\b/);
    expect(button).toMatch(/ICONS\s*\[/);
    expect(button).toContain('icon-btn');
  });

  it('JobRow.tsx: the text button that opens the file stays a text button', () => {
    const button = buttonWith('components/JobRow.tsx', '{S.openFile}');
    expect(button).not.toContain('icon-btn');
    expect(button).not.toMatch(/<Icon\b/);
  });

  it.each([
    ["act('pause')", 'pause'],
    ["act('resume')", 'play'],
    ["act('cancel')", 'close'],
  ])('GroupRow.tsx: the %s button is an icon button that draws %s', (anchor, icon) => {
    const button = buttonWith('components/GroupRow.tsx', anchor);
    expect(button).toMatch(/<Icon\b/);
    expect(names(button)).toEqual([icon]);
    expect(button).toContain('icon-btn');
  });

  it('GroupRow.tsx: the twisty draws chevronDown when open and chevronEnd when closed, and keeps only the twisty class', () => {
    const button = buttonWith('components/GroupRow.tsx', 'className="twisty"');
    expect(button).toMatch(/<Icon\b/);
    expect([...names(button)].sort()).toEqual(['chevronDown', 'chevronEnd']);
    expect(button).not.toContain('icon-btn');
    const source = stripComments(read('components/GroupRow.tsx'));
    const classes = [...source.matchAll(/className\s*=\s*["']([^"']*)["']/g)].map((m) => m[1] as string);
    expect(classes.filter((value) => value.split(/\s+/).includes('twisty'))).toEqual(['twisty']);
  });
});

describe('styles.css: mirroring under RTL (text)', () => {
  /** Every plain rule as [selector, body], comments removed. A rule inside @media is matched on its own. */
  const rules = (): Array<[selector: string, body: string]> => {
    const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [(m[1] as string).trim(), m[2] as string]);
  };

  it("has no .twisty[aria-expanded='false'] rule with scaleX", () => {
    const offenders = rules().filter(([selector, body]) => /\.twisty\s*\[\s*aria-expanded\s*=\s*["']?false["']?\s*\]/.test(selector) && /scaleX/i.test(body));
    expect(offenders).toEqual([]);
  });

  it("has a [dir='rtl'] .icon-mirror rule that flips with scaleX(-1), so the icon flips itself once", () => {
    const flips = rules().filter(([selector, body]) => /\[\s*dir\s*=\s*["']?rtl["']?\s*\]\s*\.icon-mirror\b/.test(selector) && /transform\s*:\s*scaleX\(\s*-1\s*\)/.test(body));
    expect(flips).toHaveLength(1);
  });
});
