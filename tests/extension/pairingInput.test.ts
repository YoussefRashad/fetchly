/**
 * Task 2: extension/src/lib/pairingInput.ts (E2 pairing string, E3 label and browser name, E11 appVersion).
 *
 * Enumerations (plan §3 Task 2, taken from the code the rule names):
 *  - CONTROL (src/shared/text.ts): 33 code points, U+0000..U+001F and U+007F. Every one is tested alone.
 *  - BIDI (src/shared/protocol.ts): 11 code points, U+200E, U+200F, U+202A..U+202E, U+2066..U+2069. Every one is tested alone.
 *  - Characters next to those ranges that must NOT be removed: U+0080, U+200D, U+2010, U+2029, U+202F, U+2065, U+206A.
 *  - The pairing-string rejections of the plan: no dash, port 1023, 65536, a leading zero, 7 or 9 symbols, U, inner spaces,
 *    a letter in the port, long s, dotless i, empty, a non-string; plus the O/I/L map applied only after the first dash.
 *  - browserName: the two brand names, the Edg/ user agent, and the fallback.
 *  - isAppVersion: 64 vs 65 UTF-16 units, empty, non-string, control, bidi.
 */
import { describe, expect, it } from 'vitest';
import { isLabel } from '../../src/main/server/pairing';
import { BIDI, LABEL_MAX, parsePairingString } from '../../src/shared/protocol';
import { CONTROL } from '../../src/shared/text';
import { browserName, isAppVersion, makeLabel, normalizePairingString } from '../../extension/src/lib/pairingInput';

const CONTROLS: string[] = [];
for (let c = 0; c <= 0x1f; c += 1) CONTROLS.push(String.fromCharCode(c));
CONTROLS.push('\u007f');
const BIDIS = ['‎', '‏', '‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩'];
const NEIGHBOURS = ['\u0080', '‍', '‐', ' ', ' ', '⁥', '⁪'];

describe('the enumerations match the real regexes', () => {
  it('CONTROL has 33 code points and BIDI has 11, in the lists this spec tests', () => {
    expect(CONTROLS).toHaveLength(33);
    for (const ch of CONTROLS) expect(CONTROL.test(ch)).toBe(true);
    expect(BIDIS).toHaveLength(11);
    for (const ch of BIDIS) expect(BIDI.test(ch)).toBe(true);
    for (const ch of NEIGHBOURS) {
      expect(CONTROL.test(ch)).toBe(false);
      expect(BIDI.test(ch)).toBe(false);
    }
    // No other code point below U+2100 is CONTROL or BIDI.
    let extra = 0;
    for (let c = 0; c < 0x2100; c += 1) {
      const ch = String.fromCharCode(c);
      if ((CONTROL.test(ch) || BIDI.test(ch)) && !CONTROLS.includes(ch) && !BIDIS.includes(ch)) extra += 1;
    }
    expect(extra).toBe(0);
  });
});

describe('normalizePairingString (E2)', () => {
  it('parses the plain form and returns what parsePairingString returns', () => {
    expect(normalizePairingString('38917-ABCDEFGH')).toEqual({ port: 38917, code: 'ABCDEFGH' });
    expect(normalizePairingString('38917-ABCDEFGH')).toEqual(parsePairingString('38917-ABCDEFGH'));
    expect(normalizePairingString('1024-01234567')).toEqual({ port: 1024, code: '01234567' });
    expect(normalizePairingString('65535-ZZZZZZZZ')).toEqual({ port: 65535, code: 'ZZZZZZZZ' });
  });

  it('trims the string and upper-cases ASCII letters: " 38917-abcdefgh " parses', () => {
    expect(normalizePairingString(' 38917-abcdefgh ')).toEqual({ port: 38917, code: 'ABCDEFGH' });
    expect(normalizePairingString('\t38917-abcdefgh\r\n')).toEqual({ port: 38917, code: 'ABCDEFGH' });
    expect(normalizePairingString('38917-aBcDeFgH')).toEqual({ port: 38917, code: 'ABCDEFGH' });
  });

  it('after the first dash only: O becomes 0, I and L become 1', () => {
    expect(normalizePairingString('38917-OIL00000')).toEqual({ port: 38917, code: '01100000' });
    expect(normalizePairingString('38917-oil00000')).toEqual({ port: 38917, code: '01100000' });
    expect(normalizePairingString('38917-ABCDEFGO')).toEqual({ port: 38917, code: 'ABCDEFG0' });
    expect(normalizePairingString('38917-ABCDEFGI')).toEqual({ port: 38917, code: 'ABCDEFG1' });
    expect(normalizePairingString('38917-ABCDEFGL')).toEqual({ port: 38917, code: 'ABCDEFG1' });
  });

  it('never maps in the port: a letter there is null even when the map would make it a digit', () => {
    expect(normalizePairingString('3891O-ABCDEFGH')).toBeNull();
    expect(normalizePairingString('I8917-ABCDEFGH')).toBeNull();
    expect(normalizePairingString('L8917-ABCDEFGH')).toBeNull();
    expect(normalizePairingString('38o17-ABCDEFGH')).toBeNull();
    expect(normalizePairingString('38917a-ABCDEFGH')).toBeNull();
  });

  it.each<[string, unknown]>([
    ['no dash', '38917ABCDEFGH'],
    ['empty', ''],
    ['only spaces', '   '],
    ['port 1023', '1023-ABCDEFGH'],
    ['port 65536', '65536-ABCDEFGH'],
    ['port 99999', '99999-ABCDEFGH'],
    ['port with 3 digits', '123-ABCDEFGH'],
    ['port with 6 digits', '389170-ABCDEFGH'],
    ['a leading zero', '038917-ABCDEFGH'],
    ['a leading zero on the smallest port', '01024-ABCDEFGH'],
    ['7 symbols', '38917-ABCDEFG'],
    ['9 symbols', '38917-ABCDEFGHJ'],
    ['U in the code', '38917-ABCDEFGU'],
    ['u in the code', '38917-abcdefgu'],
    ['an inner space in the code', '38917-ABCD EFG'],
    ['an inner space before the dash', '38917 -ABCDEFGH'],
    ['an inner space after the dash', '38917- ABCDEFGH'],
    ['an inner space in the port', '389 17-ABCDEFGH'],
    ['a letter in the port', '38A17-ABCDEFGH'],
    ['long s (ſ) in the code', '38917-ABCDEFGſ'],
    ['dotless i (ı) in the code', '38917-ABCDEFGı'],
    ['two dashes', '38917-ABCD-EFG'],
    ['a second dash instead of a symbol', '38917--BCDEFGH'],
    ['an en dash', '38917–ABCDEFGH'],
    ['Arabic-Indic digits in the port', '٣٨٩١٧-ABCDEFGH'],
    ['full-width digits in the port', '３８９１７-ABCDEFGH'],
    ['a decimal port', '38917.5-ABCDEFGH'],
    ['a negative port', '-38917-ABCDEFGH'],
    ['undefined', undefined],
    ['null', null],
    ['a number', 38917],
    ['an array', ['38917-ABCDEFGH']],
    ['an object', { port: 38917, code: 'ABCDEFGH' }],
    ['an object with a toString', { toString: () => '38917-ABCDEFGH' }],
    ['a String object', new String('38917-ABCDEFGH')],
    ['a symbol', Symbol('x')],
  ])('is null for %s', (_name, input) => {
    expect(normalizePairingString(input)).toBeNull();
  });

  it('never throws on any of those', () => {
    for (const v of [undefined, null, 1, {}, [], Symbol('s'), () => 1, 10n]) {
      expect(() => normalizePairingString(v)).not.toThrow();
    }
  });
});

describe('makeLabel (E3)', () => {
  it('keeps an ordinary label, trimmed', () => {
    expect(makeLabel('My laptop', 'Edge')).toBe('My laptop');
    expect(makeLabel('   My laptop  ', 'Edge')).toBe('My laptop');
    expect(makeLabel('متصفحي', 'Edge')).toBe('متصفحي');
    expect(makeLabel('Zoë 🙂', 'Edge')).toBe('Zoë 🙂');
  });

  it.each(CONTROLS.map((c) => [`U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`, c]))('removes the control character %s', (_n, ch) => {
    expect(makeLabel(`a${ch}b`, 'F')).toBe('ab');
  });

  it.each(BIDIS.map((c) => [`U+${c.charCodeAt(0).toString(16)}`, c]))('removes the bidi character %s', (_n, ch) => {
    expect(makeLabel(`a${ch}b`, 'F')).toBe('ab');
  });

  it.each(NEIGHBOURS.map((c) => [`U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`, c]))('keeps the neighbour %s, which is neither CONTROL nor BIDI', (_n, ch) => {
    expect(makeLabel(`a${ch}b`, 'F')).toBe(`a${ch}b`);
  });

  it('removes every one of three control and three bidi characters, not only the first', () => {
    expect(makeLabel('\u0001a\u0002b\u0003c', 'F')).toBe('abc');
    expect(makeLabel('‎X‪Y⁩Z', 'F')).toBe('XYZ');
    expect(makeLabel('\u0001a‎b\u0002c‪d\u0003e⁩f', 'F')).toBe('abcdef');
    expect(makeLabel('\u0007\u0007\u0007‮‮‮text', 'F')).toBe('text');
  });

  it('removes controls and bidi characters before it trims', () => {
    expect(makeLabel('\u0001 a \u0001', 'F')).toBe('a');
    expect(makeLabel('‮  a  ⁩', 'F')).toBe('a');
  });

  it('cuts to 40 UTF-16 units: 40 stays, 41 is cut, 39 stays', () => {
    expect(LABEL_MAX).toBe(40);
    expect(makeLabel('a'.repeat(39), 'F')).toBe('a'.repeat(39));
    expect(makeLabel('a'.repeat(40), 'F')).toBe('a'.repeat(40));
    expect(makeLabel('a'.repeat(41), 'F')).toBe('a'.repeat(40));
    expect(makeLabel('a'.repeat(500), 'F')).toBe('a'.repeat(40));
  });

  it('never leaves a lone surrogate when the cut falls inside a pair', () => {
    // 39 units, then a 2-unit emoji: the 40th unit would be its high surrogate.
    const cut = makeLabel(`${'a'.repeat(39)}😀`, 'F');
    expect(cut).toBe('a'.repeat(39));
    expect(cut).not.toMatch(/[\ud800-\udbff]$/u);
    // 38 units and the emoji are exactly 40 units: kept whole.
    expect(makeLabel(`${'a'.repeat(38)}😀`, 'F')).toBe(`${'a'.repeat(38)}😀`);
    // 21 emoji are 42 units: cut to 20 emoji.
    expect(makeLabel('😀'.repeat(21), 'F')).toBe('😀'.repeat(20));
    expect(makeLabel('😀'.repeat(30), 'F')).toBe('😀'.repeat(20));
  });

  it('trims again after the cut (a space at unit 40, also after a dropped surrogate)', () => {
    expect(makeLabel(`${'a'.repeat(39)} b`, 'F')).toBe('a'.repeat(39));
    expect(makeLabel(`${'a'.repeat(38)}  b`, 'F')).toBe('a'.repeat(38));
    expect(makeLabel(`${'a'.repeat(38)} 😀`, 'F')).toBe('a'.repeat(38));
  });

  it.each([
    ['empty', ''],
    ['spaces', '    '],
    ['a tab', '\t'],
    ['a no-break space', ' '],
    ['one control character', '\u0000'],
    ['only controls', '\u0001\u0002\u0003'],
    ['one bidi character', '‎'],
    ['only bidi characters', '‪‫⁩'],
    ['controls, bidi and spaces', ' \u0001 ‎ \u0002 '],
  ])('gives the fallback for %s', (_n, input) => {
    expect(makeLabel(input, 'Edge')).toBe('Edge');
    expect(makeLabel(input, 'Chrome')).toBe('Chrome');
    expect(makeLabel(input, 'Browser')).toBe('Browser');
  });

  const hostile: [string, string][] = [
    ['empty', ''],
    ['one space', ' '],
    ['a NUL', '\u0000'],
    ['100 letters', 'x'.repeat(100)],
    ['a bidi override', '‮evil‬'],
    ['an isolate', '⁦x⁩'],
    ['controls in the middle', 'a\u0000\u0001\u001f\u007fb'],
    ['30 emoji', '😀'.repeat(30)],
    ['39 letters and an emoji', `${'a'.repeat(39)}😀`],
    ['an emoji at every position near the cut', `${'a'.repeat(37)}😀😀`],
    ['a space then an emoji at the cut', `${'a'.repeat(38)} 😀`],
    ['bidi characters around Arabic', '‏متصفح‎'],
    ['a newline', 'line one\nline two'],
    ['only whitespace of many kinds', ' \t\n\r  '],
    ['a long Arabic text', 'ا'.repeat(80)],
  ];
  it.each(hostile)('the output for %s passes the real isLabel (S20)', (_n, input) => {
    const out = makeLabel(input, 'Browser');
    expect(isLabel(out)).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it('every fallback browserName can give passes isLabel too', () => {
    for (const f of ['Edge', 'Chrome', 'Browser']) expect(isLabel(makeLabel('', f))).toBe(true);
  });
});

describe('browserName (E3)', () => {
  const ua = (extra = ''): string => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36${extra}`;
  const brands = (...names: string[]): { brand: string; version: string }[] => names.map((brand) => ({ brand, version: '158' }));

  it('Microsoft Edge in the brands gives Edge', () => {
    expect(browserName({ userAgent: ua(), userAgentData: { brands: brands('Not.A/Brand', 'Chromium', 'Microsoft Edge') } })).toBe('Edge');
  });

  it('Google Chrome in the brands gives Chrome', () => {
    expect(browserName({ userAgent: ua(), userAgentData: { brands: brands('Not.A/Brand', 'Chromium', 'Google Chrome') } })).toBe('Chrome');
  });

  it('the brands win over the user agent', () => {
    expect(browserName({ userAgent: ua(' Edg/158.0.4370.33'), userAgentData: { brands: brands('Chromium', 'Google Chrome') } })).toBe('Chrome');
    expect(browserName({ userAgent: ua(), userAgentData: { brands: brands('Chromium', 'Microsoft Edge') } })).toBe('Edge');
  });

  it('without a matching brand, a user agent with Edg/ gives Edge', () => {
    expect(browserName({ userAgent: ua(' Edg/158.0.4370.33') })).toBe('Edge');
    expect(browserName({ userAgent: ua(' Edg/158.0.4370.33'), userAgentData: { brands: [] } })).toBe('Edge');
    expect(browserName({ userAgent: ua(' Edg/158.0.4370.33'), userAgentData: { brands: brands('Not.A/Brand', 'Chromium') } })).toBe('Edge');
  });

  it('otherwise it gives Browser', () => {
    expect(browserName({ userAgent: ua() })).toBe('Browser');
    expect(browserName({ userAgent: ua(), userAgentData: { brands: [] } })).toBe('Browser');
    expect(browserName({ userAgent: ua(), userAgentData: { brands: brands('Chromium', 'Brave') } })).toBe('Browser');
    expect(browserName({ userAgent: '' })).toBe('Browser');
    // Old Edge and Edge for Android are not "Edg/".
    expect(browserName({ userAgent: ua(' Edge/18.19041') })).toBe('Browser');
    expect(browserName({ userAgent: ua(' EdgA/158.0.0.0') })).toBe('Browser');
  });
});

describe('isAppVersion (E11)', () => {
  it('accepts 0.1.0 and any 1 to 64 unit string without a control or bidi character', () => {
    expect(isAppVersion('0.1.0')).toBe(true);
    expect(isAppVersion('1')).toBe(true);
    expect(isAppVersion('1.2.3-beta.4+build.5')).toBe(true);
    expect(isAppVersion('v'.repeat(64))).toBe(true);
    expect(isAppVersion('😀'.repeat(32))).toBe(true);
  });

  it('rejects 65 units, and the empty string', () => {
    expect(isAppVersion('v'.repeat(65))).toBe(false);
    expect(isAppVersion('😀'.repeat(32) + 'a')).toBe(false);
    expect(isAppVersion('v'.repeat(500))).toBe(false);
    expect(isAppVersion('')).toBe(false);
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['a number', 1],
    ['the number 0.1', 0.1],
    ['a boolean', true],
    ['an array', ['0.1.0']],
    ['an object', { v: '0.1.0' }],
    ['a String object', new String('0.1.0')],
  ])('rejects %s', (_n, v) => {
    expect(isAppVersion(v)).toBe(false);
  });

  it.each(CONTROLS.map((c) => [`U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`, c]))('rejects the control character %s at the start, the middle and the end', (_n, ch) => {
    expect(isAppVersion(`${ch}0.1.0`)).toBe(false);
    expect(isAppVersion(`0.${ch}1.0`)).toBe(false);
    expect(isAppVersion(`0.1.0${ch}`)).toBe(false);
  });

  it.each(BIDIS.map((c) => [`U+${c.charCodeAt(0).toString(16)}`, c]))('rejects the bidi character %s at the start, the middle and the end', (_n, ch) => {
    expect(isAppVersion(`${ch}0.1.0`)).toBe(false);
    expect(isAppVersion(`0.${ch}1.0`)).toBe(false);
    expect(isAppVersion(`0.1.0${ch}`)).toBe(false);
  });

  it.each(NEIGHBOURS.map((c) => [`U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`, c]))('accepts the neighbour %s', (_n, ch) => {
    expect(isAppVersion(`0.${ch}.0`)).toBe(true);
  });

  it('agrees with the real CONTROL and BIDI regexes on every character below U+2100', () => {
    for (let c = 0; c < 0x2100; c += 1) {
      const ch = String.fromCharCode(c);
      if (c >= 0xd800 && c <= 0xdfff) continue;
      expect(isAppVersion(`1${ch}2`), `U+${c.toString(16)}`).toBe(!CONTROL.test(ch) && !BIDI.test(ch));
    }
  });
});
