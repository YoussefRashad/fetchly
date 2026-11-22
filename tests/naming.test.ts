import { describe, expect, it } from 'vitest';
import { itemBaseName, sanitizeName, uniqueName } from '../src/main/naming';

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

describe('uniqueName', () => {
  it('uses the plain name when it is free', () => {
    expect(uniqueName('a', 'mp4', new Set())).toBe('a.mp4');
  });

  it('counts up past taken names, ignoring case', () => {
    expect(uniqueName('a', 'mp4', new Set(['A.mp4', 'a (2).mp4']))).toBe('a (3).mp4');
  });

  it('handles a name without an extension', () => {
    expect(uniqueName('download', '', new Set(['download']))).toBe('download (2)');
  });
});
