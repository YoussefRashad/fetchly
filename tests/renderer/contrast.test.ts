import { describe, expect, it } from 'vitest';
import { contrast } from '../../src/renderer/src/model/contrast';

/** A value of any type passed where the signature wants a string (the tests are typechecked). */
const asString = (value: unknown): string => value as string;

/** Two-decimal figures compare through toFixed, as the plan says; the raw ratio is never rounded. */
const twoDecimals = (a: string, b: string): number => Number(contrast(a, b).toFixed(2));

describe('contrast: the formula', () => {
  it.each([
    ['#000000', '#FFFFFF'],
    ['#FFFFFF', '#000000'],
    ['#ffffff', '#000000'],
    ['#FfFfFf', '#000000'],
  ])('is 21 for %s against %s', (a, b) => {
    expect(contrast(a, b)).toBeCloseTo(21, 10);
  });

  it.each([['#2346C4'], ['#2346c4'], ['#000000'], ['#FFFFFF'], ['#7D8898'], ['#010101']])('is exactly 1 for %s against itself', (colour) => {
    expect(contrast(colour, colour)).toBe(1);
  });

  it('is exactly 1 for the same colour in different letter cases', () => {
    expect(contrast('#2346c4', '#2346C4')).toBe(1);
    expect(contrast('#2346C4', '#2346c4')).toBe(1);
    expect(contrast('#abcdef', '#ABCDEF')).toBe(1);
  });

  // [a, b, expected to two decimals]: the plan's table. Palette rows carry the token names.
  const ROWS: ReadonlyArray<readonly [string, string, number]> = [
    ['#767676', '#FFFFFF', 4.54],
    ['#777777', '#FFFFFF', 4.48],
    ['#FF0000', '#FFFFFF', 4.0],
    ['#0000FF', '#FFFFFF', 8.59],
    ['#8F5600', '#EDF0F4', 5.25], // light warn on light bg
    ['#0B7A6E', '#E2E7EE', 4.2], // light laneA on light track
    ['#7D8898', '#FFFFFF', 3.59], // light field on light surface
    ['#2346C4', '#FFFFFF', 7.65], // light accent on white
    ['#E3E9F0', '#161F29', 13.61], // dark ink on dark surface
    ['#3CC4B2', '#243040', 6.19], // dark laneA on dark track
    ['#8AA4FF', '#0B1530', 7.59], // dark accent on dark onAccent
    ['#E8B04B', '#161F29', 8.51], // dark warn on dark surface
  ];

  it.each(ROWS)('%s against %s is %f to two decimals', (a, b, expected) => {
    expect(twoDecimals(a, b)).toBe(expected);
  });

  it.each(ROWS)('%s against %s gives the same figure with the arguments swapped (%f)', (a, b, expected) => {
    expect(twoDecimals(b, a)).toBe(expected);
    expect(contrast(b, a)).toBe(contrast(a, b));
  });

  it('gives each channel its own weight: 0.2126 red, 0.7152 green, 0.0722 blue', () => {
    // At full intensity the linear value is exactly 1, so the ratio is (weight + 0.05) / 0.05.
    expect(contrast('#FF0000', '#000000')).toBeCloseTo(5.252, 10);
    expect(contrast('#00FF00', '#000000')).toBeCloseTo(15.304, 10);
    expect(contrast('#0000FF', '#000000')).toBeCloseTo(2.444, 10);
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 10);
  });

  it('reads the red, green and blue digits from their own positions', () => {
    // Colours whose channels all differ, so a swapped or shifted channel changes the figure.
    expect(contrast('#123456', '#FEDCBA')).toBeCloseTo(9.786558997, 8);
    expect(contrast('#563412', '#BADCFE')).toBeCloseTo(7.784402397, 8);
  });

  it('uses the linear branch for dark channels and the power branch above 0.03928', () => {
    // 1/255 and 10/255 (<= 0.03928, so c / 12.92), then 11/255 .. 13/255 (> 0.03928, so the power curve), each against black.
    expect(contrast('#010101', '#000000')).toBeCloseTo(1.00607054, 8);
    expect(contrast('#0A0A0A', '#000000')).toBeCloseTo(1.060705397, 8);
    expect(contrast('#0B0B0B', '#000000')).toBeCloseTo(1.066930715, 8);
    expect(contrast('#0C0C0C', '#000000')).toBeCloseTo(1.073530147, 8);
    expect(contrast('#0D0D0D', '#000000')).toBeCloseTo(1.08049434, 8);
    // The order of the arguments does not matter here either.
    expect(contrast('#000000', '#010101')).toBeCloseTo(1.00607054, 8);
  });

  it('follows the WCAG formula for every grey level against black and white', () => {
    const linear = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    for (let v = 0; v <= 255; v += 1) {
      const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
      const lum = linear(v); // all three channels are equal, so L = (0.2126 + 0.7152 + 0.0722) * linear = linear
      expect(contrast(hex, '#000000'), `${hex} on black`).toBeCloseTo((lum + 0.05) / 0.05, 9);
      expect(contrast(hex, '#FFFFFF'), `${hex} on white`).toBeCloseTo(1.05 / (lum + 0.05), 9);
    }
  });

  it('returns the raw ratio: nothing is rounded inside', () => {
    const ratio = contrast('#767676', '#FFFFFF');
    expect(ratio).not.toBe(Number(ratio.toFixed(2)));
    expect(ratio).not.toBe(Number(ratio.toFixed(3)));
    expect(ratio).toBeCloseTo(4.54222496, 7);
    // So a threshold test is exact on either side of 4.5.
    expect(contrast('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#777777', '#FFFFFF')).toBeLessThan(4.5);
  });

  it('is never below 1 and does not depend on the argument order', () => {
    const colours = ['#000000', '#FFFFFF', '#2346C4', '#8AA4FF', '#0B7A6E', '#7D8898', '#EDF0F4', '#161F29', '#010101', '#FF0000', '#00FF00'];
    for (const a of colours) {
      for (const b of colours) {
        const ratio = contrast(a, b);
        expect(ratio, `${a} / ${b}`).toBeGreaterThanOrEqual(1);
        expect(contrast(b, a), `${b} / ${a}`).toBe(ratio);
      }
    }
  });
});

describe('contrast: accepted input', () => {
  it.each([['#000000'], ['#FFFFFF'], ['#ffffff'], ['#abcdef'], ['#ABCDEF'], ['#AbCdEf'], ['#012345'], ['#6789aB'], ['#00000f'], ['#f00000']])(
    '%s is a colour',
    (colour) => {
      expect(() => contrast(colour, '#FFFFFF')).not.toThrow();
      expect(() => contrast('#000000', colour)).not.toThrow();
    },
  );
});

describe('contrast: rejected input', () => {
  const REJECTED: ReadonlyArray<readonly [string, string]> = [
    // wrong length
    ['#FFF', 'three digits'],
    ['#12345', 'five digits'],
    ['#1234567', 'seven digits'],
    ['#FFFFFFFF', 'eight digits'],
    ['#', 'a bare hash'],
    // no hash
    ['FFFFFF', 'no hash'],
    ['0xFFFFFF', 'a 0x prefix'],
    ['##FFFFF', 'two hashes'],
    ['@FFFFFF', 'the wrong sigil'],
    // not hex
    ['#GGGGGG', 'not hex'],
    ['#GFFFFF', 'first digit not hex'],
    ['#FFFFFG', 'last digit not hex'],
    ['#FFGFFF', 'a digit in the middle not hex'],
    ['#/00000', 'the character before 0'],
    ['#:00000', 'the character after 9'],
    ['#@00000', 'the character before A'],
    ['#G00000', 'the character after F'],
    ['#`00000', 'the character before a'],
    ['#g00000', 'the character after f'],
    ['#00000/', 'the character before 0, last position'],
    ['#00000g', 'the character after f, last position'],
    ['#ＦＦＦＦＦＦ', 'full-width F'],
    ['#FFFF-F', 'a minus sign inside'],
    ['#FFFF F', 'a space inside'],
    // whitespace or empty
    [' #FFFFFF', 'a leading space'],
    ['#FFFFFF ', 'a trailing space'],
    ['#FFFFFF\n', 'a trailing newline'],
    ['\n#FFFFFF', 'a leading newline'],
    ['#FFF\nFFF', 'a newline inside'],
    ['\t#FFFFFF', 'a leading tab'],
    ['#FFFFFF\u0000', 'a trailing NUL'],
    [' #FFFFFF', 'a leading no-break space'],
    ['', 'an empty string'],
    [' ', 'a space only'],
    // other colour syntax
    ['white', 'a colour name'],
    ['rgb(0,0,0)', 'rgb()'],
    ['rgb(0 0 0)', 'rgb() with spaces'],
    ['hsl(0, 0%, 0%)', 'hsl()'],
    ['#FFFFFF80', 'hex with alpha'],
    ['transparent', 'transparent'],
  ];

  const NOT_STRINGS: ReadonlyArray<readonly [unknown, string]> = [
    [null, 'null'],
    [undefined, 'undefined'],
    [0, '0'],
    [0xffffff, 'a number that looks like a colour'],
    [NaN, 'NaN'],
    [true, 'true'],
    [{}, 'an empty object'],
    [[], 'an empty array'],
    [['#FFFFFF'], 'an array that coerces to a valid string'],
    [new String('#FFFFFF'), 'a String object that coerces to a valid string'],
    [Object('#FFFFFF'), 'a boxed string'],
    [{ toString: () => '#FFFFFF' }, 'an object whose toString gives a valid string'],
    [{ valueOf: () => '#FFFFFF' }, 'an object whose valueOf gives a valid string'],
    [() => '#FFFFFF', 'a function'],
  ];

  it.each(REJECTED)('%j (%s) throws a TypeError in the first position', (bad) => {
    expect(() => contrast(bad, '#FFFFFF')).toThrow(TypeError);
  });

  it.each(REJECTED)('%j (%s) throws a TypeError in the second position', (bad) => {
    expect(() => contrast('#FFFFFF', bad)).toThrow(TypeError);
  });

  it.each(REJECTED)('%j (%s) throws a TypeError when both are bad', (bad) => {
    expect(() => contrast(bad, bad)).toThrow(TypeError);
    expect(() => contrast(bad, '###')).toThrow(TypeError);
  });

  it.each(NOT_STRINGS)('%j (%s) throws a TypeError in the first position', (bad) => {
    expect(() => contrast(asString(bad), '#FFFFFF')).toThrow(TypeError);
  });

  it.each(NOT_STRINGS)('%j (%s) throws a TypeError in the second position', (bad) => {
    expect(() => contrast('#FFFFFF', asString(bad))).toThrow(TypeError);
  });

  it('checks the type before any pattern test: a non-string that coerces to a valid colour still throws', () => {
    const coerces = ['#FFFFFF'] as unknown;
    expect(String(coerces)).toBe('#FFFFFF');
    expect(() => contrast(asString(coerces), '#000000')).toThrow(TypeError);
    expect(() => contrast('#000000', asString(coerces))).toThrow(TypeError);
    const boxed = new String('#FFFFFF');
    expect(`${boxed}`).toBe('#FFFFFF');
    expect(() => contrast(asString(boxed), '#000000')).toThrow(TypeError);
    expect(() => contrast('#000000', asString(boxed))).toThrow(TypeError);
  });

  it('throws for a bad second value even when the first is fine and the same colour', () => {
    expect(() => contrast('#2346C4', '#2346C')).toThrow(TypeError);
    expect(() => contrast('#2346C', '#2346C4')).toThrow(TypeError);
  });

  it('throws a TypeError and not another kind of error', () => {
    for (const [bad] of REJECTED) {
      let caught: unknown;
      try {
        contrast(bad, '#FFFFFF');
      } catch (e) {
        caught = e;
      }
      expect(caught, JSON.stringify(bad)).toBeInstanceOf(TypeError);
    }
  });
});
