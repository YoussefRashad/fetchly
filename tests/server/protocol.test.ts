// A1 Task 4 (protocol part): src/shared/protocol.ts, shared by main and the extension (no Node imports).
//
// Enumeration (R2-6, S20, section 2): the matchers of this module are ORIGIN_RE, PAIRING_ID_RE, NONCE_RE,
// TOKEN_RE, CODE_RE and BIDI. None has a g or y flag (a stateful regex gives two different answers in a row).
// BIDI covers exactly U+200E, U+200F, U+202A..U+202E and U+2066..U+2069.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BIDI,
  CODE_ALPHABET,
  CODE_RE,
  DEFAULT_SERVER_PORT,
  LABEL_MAX,
  MAX_PAIRINGS,
  NONCE_RE,
  ORIGIN_RE,
  PAIRING_ID_RE,
  PORT_MAX,
  PORT_MIN,
  PROOF_KEY_LABEL,
  PROTOCOL,
  TOKEN_RE,
  formatPairingString,
  helloInput,
  isServerPort,
  parsePairingString,
  type ErrorToken,
} from '../../src/shared/protocol';

const chr = (code: number): string => String.fromCodePoint(code);

/** parsePairingString may return null or throw to reject; both are a rejection. */
function parsed(s: string): { port: number; code: string } | null {
  try {
    return parsePairingString(s);
  } catch {
    return null;
  }
}

describe('constants', () => {
  it('has the frozen values', () => {
    expect(PROTOCOL).toBe(1);
    expect(DEFAULT_SERVER_PORT).toBe(38917);
    expect(PORT_MIN).toBe(1024);
    expect(PORT_MAX).toBe(65535);
    expect(LABEL_MAX).toBe(40);
    expect(MAX_PAIRINGS).toBe(4);
    expect(PROOF_KEY_LABEL).toBe('fetchly-server-proof-v1');
  });

  it('CODE_ALPHABET is the 32 symbols of S3, without I, L, O and U', () => {
    expect(CODE_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const c of 'ILOU') expect(CODE_ALPHABET.includes(c)).toBe(false);
  });

  it('the A1 error tokens are all in the ErrorToken union (compile-time check, tsc)', () => {
    const tokens = [
      'bad_request',
      'bad_host',
      'not_found',
      'preflight_refused',
      'method_not_allowed',
      'bad_origin',
      'bad_content_type',
      'too_large',
      'bad_token',
      'rate_limited',
      'pairing_closed',
      'bad_code',
      'unknown_pairing',
    ] satisfies ErrorToken[];
    expect(new Set(tokens).size).toBe(13);
  });

  it('has no Node imports: the extension bundles this file', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'shared', 'protocol.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]node:/u);
    expect(source).not.toMatch(/\brequire\s*\(/u);
    expect(source).not.toMatch(/from\s+['"](fs|path|crypto|http|net|os|buffer)['"]/u);
  });
});

describe('isServerPort', () => {
  it.each([1024, 1025, 38917, 40000, 65534, 65535])('accepts %i', (v) => {
    expect(isServerPort(v)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['one below the range', 1023],
    ['one above the range', 65536],
    ['zero', 0],
    ['negative', -1],
    ['a privileged port', 80],
    ['a fraction', 38917.5],
    ['a numeric string', '38917'],
    ['null', null],
    ['undefined', undefined],
    ['true', true],
    ['an empty array', []],
    ['an array holding a port', [38917]],
    ['an object', {}],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['Number.MAX_VALUE', Number.MAX_VALUE],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a bigint', 38917n],
    ['a Number object', new Number(38917)],
    ['the empty string', ''],
    ['a float that is whole', 38917.0000001],
  ])('refuses %s', (_name, v) => {
    expect(isServerPort(v)).toBe(false);
  });
});

describe('the matchers carry no g or y flag', () => {
  it.each([
    ['ORIGIN_RE', ORIGIN_RE],
    ['PAIRING_ID_RE', PAIRING_ID_RE],
    ['NONCE_RE', NONCE_RE],
    ['TOKEN_RE', TOKEN_RE],
    ['CODE_RE', CODE_RE],
    ['BIDI', BIDI],
  ])('%s', (_name, re) => {
    expect(re.global).toBe(false);
    expect(re.sticky).toBe(false);
  });

  it('two tests in a row agree', () => {
    const origin = `chrome-extension://${'a'.repeat(32)}`;
    expect(ORIGIN_RE.test(origin)).toBe(true);
    expect(ORIGIN_RE.test(origin)).toBe(true);
    expect(CODE_RE.test('01234567')).toBe(true);
    expect(CODE_RE.test('01234567')).toBe(true);
    expect(BIDI.test('\u202e')).toBe(true);
    expect(BIDI.test('\u202e')).toBe(true);
  });
});

describe('ORIGIN_RE', () => {
  const ext = (id: string): string => `chrome-extension://${id}`;

  it.each([
    ['32 letters a to p, all a', 'a'.repeat(32)],
    ['32 letters a to p, all p', 'p'.repeat(32)],
    ['32 letters a to p, mixed', 'abcdefghijklmnop'.repeat(2)],
  ])('accepts %s', (_name, id) => {
    expect(ORIGIN_RE.test(ext(id))).toBe(true);
  });

  it.each([
    ['31 letters', ext('a'.repeat(31))],
    ['33 letters', ext('a'.repeat(33))],
    ['the letter q last', ext(`${'a'.repeat(31)}q`)],
    ['the letter q first', ext(`q${'a'.repeat(31)}`)],
    ['the letter z in the middle', ext(`${'a'.repeat(15)}z${'a'.repeat(16)}`)],
    ['uppercase', ext('A'.repeat(32))],
    ['one uppercase letter', ext(`${'a'.repeat(31)}A`)],
    ['a digit', ext(`${'a'.repeat(31)}1`)],
    ['a trailing slash', `${ext('a'.repeat(32))}/`],
    ['a path', `${ext('a'.repeat(32))}/popup.html`],
    ['a trailing newline', `${ext('a'.repeat(32))}\n`],
    ['a leading space', ` ${ext('a'.repeat(32))}`],
    ['https instead of chrome-extension', `https://${'a'.repeat(32)}`],
    ['moz-extension', `moz-extension://${'a'.repeat(32)}`],
    ['the string null', 'null'],
    ['the empty string', ''],
    ['no scheme', 'a'.repeat(32)],
    ['a different host with the id as subdomain', `https://${'a'.repeat(32)}.example.com`],
    ['two origins joined', `${ext('a'.repeat(32))}, ${ext('b'.repeat(32))}`],
  ])('rejects %s', (_name, value) => {
    expect(ORIGIN_RE.test(value)).toBe(false);
  });
});

describe('PAIRING_ID_RE (22 base64url characters)', () => {
  const b64 = (n: number): string => 'Ab3_-'.repeat(10).slice(0, n);

  it('accepts exactly 22', () => {
    expect(PAIRING_ID_RE.test(b64(22))).toBe(true);
    expect(PAIRING_ID_RE.test(Buffer.alloc(16, 7).toString('base64url'))).toBe(true);
  });

  it.each([
    ['21 characters', b64(21)],
    ['23 characters', b64(23)],
    ['0 characters', ''],
    ['43 characters', b64(43)],
    ['a plus sign', `${b64(21)}+`],
    ['a slash', `${b64(21)}/`],
    ['padding', `${b64(21)}=`],
    ['a space', `${b64(21)} `],
    ['a trailing newline', `${b64(22)}\n`],
    ['a leading newline', `\n${b64(22)}`],
  ])('rejects %s', (_name, v) => {
    expect(PAIRING_ID_RE.test(v)).toBe(false);
  });
});

describe.each([
  ['NONCE_RE', NONCE_RE],
  ['TOKEN_RE', TOKEN_RE],
])('%s (43 base64url characters)', (_name, re) => {
  const b64 = (n: number): string => 'Zy9_-'.repeat(10).slice(0, n);

  it('accepts exactly 43', () => {
    expect(re.test(b64(43))).toBe(true);
    expect(re.test(Buffer.alloc(32, 9).toString('base64url'))).toBe(true);
  });

  it.each([
    ['42 characters', b64(42)],
    ['44 characters', b64(44)],
    ['22 characters', b64(22)],
    ['the empty string', ''],
    ['a plus sign', `${b64(42)}+`],
    ['a slash', `${b64(42)}/`],
    ['padding', `${b64(42)}=`],
    ['an inner space', `${b64(21)} ${b64(21)}`],
    ['a trailing newline', `${b64(43)}\n`],
    ['a non-ASCII letter', `${b64(42)}é`],
  ])('rejects %s', (_n, v) => {
    expect(re.test(v)).toBe(false);
  });
});

describe('CODE_RE (8 symbols of CODE_ALPHABET)', () => {
  it.each(['01234567', 'ABCDEFGH', 'ZZZZZZZZ', '00000000', 'JKMNPQRS', 'TVWXYZ01'])('accepts %s', (code) => {
    expect(CODE_RE.test(code)).toBe(true);
  });

  it('accepts a code made of every alphabet symbol in turn', () => {
    for (let i = 0; i < CODE_ALPHABET.length; i += 8) {
      const code = (CODE_ALPHABET + CODE_ALPHABET).slice(i, i + 8);
      expect(CODE_RE.test(code), code).toBe(true);
    }
  });

  it.each([
    ['7 symbols', '0123456'],
    ['9 symbols', '012345678'],
    ['lowercase', 'abcdefgh'],
    ['one lowercase symbol', '0123456a'],
    ['the letter I', '0123456I'],
    ['the letter L', '0123456L'],
    ['the letter O', '0123456O'],
    ['the letter U', '0123456U'],
    ['a space', '0123456 '],
    ['a dash', '0123-567'],
    ['a trailing newline', '01234567\n'],
    ['the empty string', ''],
    ['a non-ASCII digit', '0123456٣'],
  ])('rejects %s', (_name, code) => {
    expect(CODE_RE.test(code)).toBe(false);
  });
});

describe('formatPairingString and parsePairingString', () => {
  it('format gives <port>-<code>', () => {
    expect(formatPairingString(38917, 'ABCDEFGH')).toBe('38917-ABCDEFGH');
    expect(formatPairingString(1024, '01234567')).toBe('1024-01234567');
  });

  it.each([1024, 1025, 38917, 40000, 65535])('parse round-trips format for port %i', (port) => {
    expect(parsePairingString(formatPairingString(port, 'ABCDEFGH'))).toEqual({ port, code: 'ABCDEFGH' });
  });

  it.each(['01234567', 'ZZZZZZZZ', 'JKMNPQRS'])('parse round-trips the code %s', (code) => {
    expect(parsePairingString(formatPairingString(38917, code))).toEqual({ port: 38917, code });
  });

  it.each<[string, string]>([
    ['no dash', '38917ABCDEFGH'],
    ['only the code', 'ABCDEFGH'],
    ['only the port', '38917'],
    ['the port below the range, 1023', '1023-ABCDEFGH'],
    ['the port above the range, 65536', '65536-ABCDEFGH'],
    ['the port zero', '0-ABCDEFGH'],
    ['a leading zero', '038917-ABCDEFGH'],
    ['a leading zero on a short port', '01024-ABCDEFGH'],
    ['an empty port', '-ABCDEFGH'],
    ['a 7-symbol code', '38917-ABCDEFG'],
    ['a 9-symbol code', '38917-ABCDEFGHJ'],
    ['the letter O in the code', '38917-ABCDEFGO'],
    ['the letter I in the code', '38917-ABCDEFGI'],
    ['a lowercase code (A2 upper-cases before parsing)', '38917-abcdefgh'],
    ['two dashes', '38917--ABCDEFGH'],
    ['a second dash and more', '38917-ABCDEFGH-1'],
    ['a leading space', ' 38917-ABCDEFGH'],
    ['a trailing space', '38917-ABCDEFGH '],
    ['a trailing newline', '38917-ABCDEFGH\n'],
    ['a fractional port', '38917.5-ABCDEFGH'],
    ['an exponent port', '1e4-ABCDEFGH'],
    ['a plus sign on the port', '+38917-ABCDEFGH'],
    ['a hex port', '0x9805-ABCDEFGH'],
    ['a space inside the port', '38 917-ABCDEFGH'],
    ['a negative port', '-38917-ABCDEFGH'],
    ['a huge port', '99999999999999999999-ABCDEFGH'],
    ['the empty string', ''],
  ])('rejects %s', (_name, s) => {
    expect(parsed(s)).toBeNull();
  });

  it('accepts the boundary ports 1024 and 65535 and rejects their neighbours', () => {
    expect(parsed('1024-ABCDEFGH')).toEqual({ port: 1024, code: 'ABCDEFGH' });
    expect(parsed('65535-ABCDEFGH')).toEqual({ port: 65535, code: 'ABCDEFGH' });
    expect(parsed('1023-ABCDEFGH')).toBeNull();
    expect(parsed('65536-ABCDEFGH')).toBeNull();
  });
});

describe('helloInput', () => {
  it('is fetchly-hello-v1, then the id, the decimal port and the nonce, one per line', () => {
    const id = 'A'.repeat(22);
    const nonce = 'n'.repeat(43);
    expect(helloInput(id, 38917, nonce)).toBe(`fetchly-hello-v1\n${id}\n38917\n${nonce}`);
  });

  it('changes with each of the three inputs', () => {
    const base = helloInput('A'.repeat(22), 38917, 'n'.repeat(43));
    expect(helloInput('B'.repeat(22), 38917, 'n'.repeat(43))).not.toBe(base);
    expect(helloInput('A'.repeat(22), 38918, 'n'.repeat(43))).not.toBe(base);
    expect(helloInput('A'.repeat(22), 38917, 'm'.repeat(43))).not.toBe(base);
  });
});

describe('BIDI (R2-6: it lives in protocol.ts)', () => {
  const LISTED = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];

  it.each(LISTED)('matches U+%i', (code) => {
    expect(BIDI.test(chr(code))).toBe(true);
    expect(BIDI.test(`abc${chr(code)}def`)).toBe(true);
  });

  it.each([
    ['U+200D zero-width joiner', 0x200d],
    ['U+200B zero-width space', 0x200b],
    ['U+200C zero-width non-joiner', 0x200c],
    ['U+2010 hyphen', 0x2010],
    ['U+2029 paragraph separator', 0x2029],
    ['U+202F narrow no-break space', 0x202f],
    ['U+2065 unassigned, just below the isolates', 0x2065],
    ['U+206A deprecated format character, just above the isolates', 0x206a],
    ['U+0020 space', 0x20],
    ['U+061C Arabic letter mark (not listed)', 0x061c],
  ])('does not match %s', (_name, code) => {
    expect(BIDI.test(chr(code))).toBe(false);
  });

  it('does not match Arabic or Hebrew letters themselves', () => {
    expect(BIDI.test('متصفح')).toBe(false);
    expect(BIDI.test('שלום')).toBe(false);
  });
});
