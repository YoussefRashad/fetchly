// Task D, item 2: a source scan (precedents: tests/ipcPairing.test.ts "the preload has one call(...) entry",
// tests/queueLifecycle.test.ts). Once the window shows errors through src/renderer/src/errors.ts, no component and no
// banner may read `.error` or `.message` of a failed Result or an error status itself: such a read would show the
// English text in an Arabic window. Frozen plan, "Consumers to change" and critique pass 2, amendment 2: the sources
// are scanned with `//` and block comments stripped, against /\.(error|message)\b/u (no `\s*`). A future legitimate
// read belongs in src/renderer/src/errors.ts, which is not scanned.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../src/renderer/src');
const READ = /\.(error|message)\b/u;

/**
 * The source without its comments. Quotes are tracked, so a `//` inside a string (a URL) does not start a comment;
 * a ' or " string ends at the end of its line (a JSX apostrophe cannot swallow the rest of the file).
 */
function withoutComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && (c === '`' || src[j] !== '\n')) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, Math.min(j + 1, src.length));
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** The files the plan names: every .tsx under src/renderer/src, and banners.ts. */
function scanned(): string[] {
  const files = readdirSync(ROOT, { recursive: true, encoding: 'utf8' }).map((f) => f.replaceAll('\\', '/'));
  return files.filter((f) => f.endsWith('.tsx') || f === 'banners.ts').sort();
}

describe('the comment stripper of this scan', () => {
  it.each([
    ['a line comment', 'const a = 1; // res.error', false],
    ['a line comment alone on its line', '// res.message\nconst a = 1;', false],
    ['a block comment', '/* res.error */ const a = 1;', false],
    ['a block comment over several lines', '/*\n * res.message\n * res.error\n */\nconst a = 1;', false],
    ['a JSDoc comment', '/** shows res.error as is */\nfunction f() {}', false],
    ['code before a line comment', 'show(res.error); // why', true],
    ['code after a block comment', '/* why */ show(res.message);', true],
    ['code on the next line after a line comment', '// why\nshow(res.error);', true],
    ['a // inside a single-quoted string is not a comment', "const u = 'http://x'; show(res.error);", true],
    ['a // inside a double-quoted string is not a comment', 'const u = "http://x"; show(res.error);', true],
    ['a // inside a template string is not a comment', 'const u = `http://x`; show(res.message);', true],
    ['a /* inside a string is not a comment', "const u = '/*'; show(res.error); const v = '*/';", true],
    ['an escaped quote does not end its string', "const u = 'it\\'s // here'; show(res.error);", true],
    ['an apostrophe in JSX text ends at the end of its line', "<p>Don't</p>\nshow(res.error);", true],
    ['optional chaining', 'show(res?.error);', true],
    ['a plain word `error` is not a read', 'const error = 1; setError(error);', false],
    ['`.errors` is not `.error`', 'show(list.errors);', false],
    ['`.messages` is not `.message`', 'show(list.messages);', false],
  ])('%s', (_name, src, flagged) => {
    expect(READ.test(withoutComments(src))).toBe(flagged);
  });

  it('keeps the code around a comment', () => {
    expect(withoutComments('a(); // x\nb(); /* y */ c();')).toBe('a(); \nb();   c();');
  });
});

describe('the files that show an error', () => {
  const files = scanned();

  it('the scan finds the components and banners.ts (it cannot pass by scanning nothing)', () => {
    expect(files).toContain('banners.ts');
    expect(files).toContain('App.tsx');
    for (const name of ['UrlBar', 'AddDialog', 'JobRow', 'GroupRow', 'JobList', 'InstallScreen', 'SettingsDialog']) {
      expect(files, name).toContain(`components/${name}.tsx`);
    }
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it('does not scan errors.ts, where such a read is allowed', () => {
    expect(files).not.toContain('errors.ts');
  });

  it.each(files)('%s reads no .error or .message', (file) => {
    const code = withoutComments(readFileSync(join(ROOT, file), 'utf8'));
    const hits = code
      .split(/\r?\n/u)
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => READ.test(line))
      .map(([n, line]) => `${file}:${n}: ${line.trim()}`);
    expect(hits).toEqual([]);
  });
});
