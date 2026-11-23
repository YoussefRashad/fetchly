// A1 Task 1: src/shared/text.ts. R2-6: it exports only CONTROL; BIDI lives in src/shared/protocol.ts
// (the section 2 table of the plan still lists BIDI here: the freeze addendum wins, and BIDI is tested in
// tests/server/protocol.test.ts).
//
// Enumeration: the control characters CONTROL covers are U+0000..U+001F and U+007F (the two local copies it
// replaces, in validate.ts and ipc.ts, had exactly this class).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as text from '../src/shared/text';
import { CONTROL } from '../src/shared/text';

const chr = (code: number): string => String.fromCodePoint(code);

describe('CONTROL', () => {
  const CODES = [...Array.from({ length: 0x20 }, (_, i) => i), 0x7f];

  it.each(CODES)('matches U+%i', (code) => {
    expect(CONTROL.test(chr(code))).toBe(true);
  });

  it('matches when the character sits inside a longer string, at either end', () => {
    for (const code of [0x00, 0x1f, 0x7f]) {
      const c = chr(code);
      expect(CONTROL.test(`ab${c}cd`)).toBe(true);
      expect(CONTROL.test(`${c}abcd`)).toBe(true);
      expect(CONTROL.test(`abcd${c}`)).toBe(true);
    }
  });

  it.each([
    ['space', ' '],
    ['U+0080', chr(0x80)],
    ['U+009F', chr(0x9f)],
    ['U+00A0', chr(0xa0)],
    ['DEL minus one, U+007E', '~'],
    ['a URL', 'https://example.com/a?b=c#d'],
    ['a letter', 'a'],
    ['the empty string', ''],
    ['an emoji', '\u{1F600}'],
  ])('does not match %s', (_name, value) => {
    expect(CONTROL.test(value)).toBe(false);
  });

  it('has no g flag and no y flag: two tests in a row agree', () => {
    expect(CONTROL.global).toBe(false);
    expect(CONTROL.sticky).toBe(false);
    expect(CONTROL.flags).not.toMatch(/[gy]/u);
    expect(CONTROL.test('a\u0001b')).toBe(true);
    expect(CONTROL.test('a\u0001b')).toBe(true);
    expect(CONTROL.test('a\u0001b')).toBe(true);
    expect(CONTROL.lastIndex).toBe(0);
    expect(CONTROL.test('clean')).toBe(false);
    expect(CONTROL.test('clean')).toBe(false);
  });

  it('is a unicode-mode expression', () => {
    expect(CONTROL.unicode).toBe(true);
  });
});

describe('the module', () => {
  it('exports only CONTROL (R2-6)', () => {
    expect(Object.keys(text)).toEqual(['CONTROL']);
  });

  it('is imported, not copied, by validate.ts and ipc.ts: no local CONTROL is left', () => {
    for (const file of ['src/main/jobs/validate.ts', 'src/main/ipc.ts']) {
      const source = readFileSync(join(__dirname, '..', file), 'utf8');
      expect(source, file).toMatch(/import\s*\{[^}]*\bCONTROL\b[^}]*\}\s*from\s*'(\.\.\/)+shared\/text'/u);
      expect(source, file).not.toMatch(/\bconst\s+CONTROL\b/u);
    }
  });
});
