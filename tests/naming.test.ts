import { describe, expect, it } from 'vitest';
import { dirKey, freeName, itemBaseName, nameConflicts, sanitizeFileName, sanitizeName } from '../src/main/naming';

describe('sanitizeName', () => {
  it('replaces characters Windows forbids', () => {
    expect(sanitizeName('What? A: "B" <C>|D*')).toBe('What A B C D');
  });

  it('replaces slashes and control characters', () => {
    expect(sanitizeName('a/b\\c\td\u0001e')).toBe('a b c d e');
  });

  it('strips trailing dots and spaces', () => {
    expect(sanitizeName('name... ')).toBe('name');
  });

  it.each(['con', 'CON', 'nul', 'COM1', 'lpt9', 'Aux', 'PRN'])('prefixes the reserved name %s', (name) => {
    expect(sanitizeName(name)).toBe(`_${name}`);
  });

  it('prefixes a reserved name that carries an extension-like suffix', () => {
    expect(sanitizeName('con.part1')).toBe('_con.part1');
  });

  it('leaves names that merely start with a reserved word', () => {
    expect(sanitizeName('Console tricks')).toBe('Console tricks');
  });

  it('falls back to untitled when nothing is left', () => {
    expect(sanitizeName('???')).toBe('untitled');
    expect(sanitizeName('   ')).toBe('untitled');
    expect(sanitizeName('...')).toBe('untitled');
  });

  it('truncates to 150 characters', () => {
    expect(sanitizeName('a'.repeat(300))).toHaveLength(150);
  });

  it('does not end with a space or dot after truncating', () => {
    const name = sanitizeName(`${'a'.repeat(149)} bcd`);
    expect(name).toBe('a'.repeat(149));
  });

  it('does not cut an emoji in half when truncating', () => {
    const name = sanitizeName(`${'a'.repeat(149)}😀😀`);
    expect(name).toBe('a'.repeat(149));
    expect(name.isWellFormed()).toBe(true);
  });

  it('keeps Arabic titles as they are', () => {
    expect(sanitizeName('شرح الدرس الأول')).toBe('شرح الدرس الأول');
  });
});

describe('itemBaseName', () => {
  it('uses the bare title outside a playlist', () => {
    expect(itemBaseName('Intro', null, null)).toBe('Intro');
  });

  it('pads the index to two digits for short playlists', () => {
    expect(itemBaseName('Intro', 3, 40)).toBe('03 - Intro');
    expect(itemBaseName('Intro', 3, 5)).toBe('03 - Intro');
  });

  it('pads to the width of the playlist size', () => {
    expect(itemBaseName('Intro', 3, 120)).toBe('003 - Intro');
  });

  it('sanitizes the title', () => {
    expect(itemBaseName('Q&A: what?', 12, 40)).toBe('12 - Q&A what');
  });
});

describe('sanitizeFileName', () => {
  const long = `${'x'.repeat(150)}.${'y'.repeat(150)}`;
  it.each([
    ['CON', '_CON'],
    ['com1.txt', '_com1.txt'],
    ['report.txt:payload', 'report.txtpayload'],
    ['a.', 'a'],
    ['a..pdf', 'a.pdf'],
    ['..\\..\\evil.exe', 'evil.exe'],
    ['../x/evil.exe', 'evil.exe'],
    ['re:port?.pdf', 're port.pdf'],
    ['.', 'download'],
    ['', 'download'],
    ['???.pdf', 'download.pdf'],
    ['ملف الدرس.pdf', 'ملف الدرس.pdf'],
    ['My File.zip', 'My File.zip'],
    ['.bashrc', '.bashrc'],
    ['x.yyyyyyyyyyyyyyyyyyyyyyyy.', 'x.yyyyyyyyyyyyyyyy'],
  ])('%j becomes %j', (raw, safe) => {
    expect(sanitizeFileName(raw)).toBe(safe);
  });

  it('keeps the whole name within 150 characters and the extension within 16', () => {
    const name = sanitizeFileName(long);
    expect(name).toBe(`${'x'.repeat(133)}.${'y'.repeat(16)}`);
  });

  it('never ends a name with a dot or a space', () => {
    expect(sanitizeFileName(`${'a'.repeat(140)} . .pdf`)).toBe(`${'a'.repeat(140)}.pdf`);
  });

  it.each([
    'CON',
    'com1.txt',
    'report.txt:payload',
    'a.',
    long,
    `x.${'y'.repeat(100)}.`,
    `${'a'.repeat(148)}.b c.d`,
    'con.part1',
    '.bashrc',
    '😀'.repeat(100),
  ])('is idempotent for %j', (raw) => {
    const once = sanitizeFileName(raw);
    expect(sanitizeFileName(once)).toBe(once);
    expect(once.isWellFormed()).toBe(true);
  });
});

describe('nameConflicts', () => {
  it.each([
    ['Clip', ['clip'], true],
    ['Clip.f137', ['Clip'], true],
    ['Clip', ['Clip.extra'], true],
    ['Clip', ['Clip.mp4'], true],
    ['Clip 2', ['Clip'], false],
    ['a.zip', ['a.pdf'], false],
    ['Clipper', ['Clip'], false],
  ] as const)('%j against the jobs %j: %s', (candidate, claims, conflict) => {
    expect(nameConflicts(candidate, claims, [])).toBe(conflict);
  });

  it.each([
    ['Talk', ['Talk.mp4'], true],
    ['Talk', ['talk.MKV'], true],
    ['a.zip', ['a.zip.aria2'], true],
    ['a.zip', ['A.ZIP'], true],
    ['a.zip', ['a'], false],
    ['Talk', ['Talk 2.mp4'], false],
  ] as const)('%j against the files %j: %s', (candidate, disk, conflict) => {
    expect(nameConflicts(candidate, [], disk)).toBe(conflict);
  });
});

describe('freeName', () => {
  const among = (taken: string[]) => (name: string) => taken.some((t) => t.toLowerCase() === name.toLowerCase());

  it('uses the plain name when it is free', () => {
    expect(freeName('a', 'mp4', among([]))).toBe('a.mp4');
  });

  it('counts up past taken names, ignoring case', () => {
    expect(freeName('a', 'mp4', among(['A.mp4', 'a (2).mp4']))).toBe('a (3).mp4');
  });

  it('handles a name without an extension', () => {
    expect(freeName('download', '', among(['download']))).toBe('download (2)');
  });

  it('numbers before the first dot when the whole name extends another job', () => {
    expect(freeName('Clip.f137', '', (n) => nameConflicts(n, ['Clip'], []))).toBe('Clip (2).f137');
  });

  it('numbers before the first dot for a file whose name extends another job', () => {
    expect(freeName('a.tar', 'gz', (n) => nameConflicts(n, ['a'], []))).toBe('a (2).tar.gz');
  });

  it('keeps counting when the first numbers are taken', () => {
    const taken = (n: string) => nameConflicts(n, ['Clip', 'Clip (2)', 'Clip (3)'], []);
    expect(freeName('Clip.f137', '', taken)).toBe('Clip (4).f137');
  });
});

describe('dirKey', () => {
  it('treats spellings of one folder as the same', () => {
    const key = dirKey('D:\\Dl\\');
    expect(dirKey('d:/dl')).toBe(key);
    expect(dirKey('D:\\Dl\\x\\..')).toBe(key);
    expect(dirKey('D:\\Dl\\x')).not.toBe(key);
  });
});
