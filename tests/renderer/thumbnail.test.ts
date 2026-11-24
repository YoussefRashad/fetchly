// C2 section 5.6: acceptThumbnail, rememberThumb, thumbFor (src/renderer/src/model/thumbnail.ts).
// (+) = a row the plan adds. "derived" = not a table row: it enumerates a rule's inputs or checks a stated promise.
// The rows that depend on how new URL() rewrites its input were probed (PU-1) on Node v24.14.1 and the Electron 45.4.1
// renderer; CI's Node 22 and 24 are covered only by CI. If one of those rows fails on a CI Node, report the row:
// the rule and the table are not adjusted by a lane.
import { describe, expect, it } from 'vitest';
import { acceptThumbnail, rememberThumb, thumbFor } from '../../src/renderer/src/model/thumbnail';
import { makeJob } from '../helpers';

const GOOD = 'https://example.com/t.jpg';

describe('acceptThumbnail: what is accepted', () => {
  it.each([
    ['https://i.ytimg.com/vi/abc/hq.jpg', 'https://i.ytimg.com/vi/abc/hq.jpg'],
    ['HTTPS://EXAMPLE.com/t.jpg', 'https://example.com/t.jpg'],
    ['https://example.com', 'https://example.com/'],
    ['https://1.2.3.4.example.com/t.jpg', 'https://1.2.3.4.example.com/t.jpg'],
    ['https://notlocalhost/t.jpg', 'https://notlocalhost/t.jpg'],
    ['https://localhost.example.com/t.jpg', 'https://localhost.example.com/t.jpg'],
    ['https://example.com:8443/t.jpg', 'https://example.com:8443/t.jpg'],
    ['https://exam\nple.com/t.jpg', 'https://example.com/t.jpg'],
    ['https://example.com/a\tb.jpg', 'https://example.com/ab.jpg'],
    // derived: the query and the fragment are not restricted, and the path keeps its case.
    ['https://example.com/T.JPG?w=100&h=50#x', 'https://example.com/T.JPG?w=100&h=50#x'],
    ['HTTPS://EXAMPLE.com/T.JPG', 'https://example.com/T.JPG'],
  ])('%j gives %j (the parsed href)', (raw, expected) => {
    expect(acceptThumbnail(raw)).toBe(expected);
  });

  it('accepts a string of exactly 2048 characters and refuses 2049, counted on the raw string', () => {
    const base = 'https://example.com/';
    expect(base.length).toBe(20);
    const at2048 = base + 'a'.repeat(2028);
    const at2049 = base + 'a'.repeat(2029);
    expect(at2048).toHaveLength(2048);
    expect(at2049).toHaveLength(2049);
    expect(acceptThumbnail(at2048)).toBe(at2048);
    expect(acceptThumbnail(at2049)).toBeNull();
  });

  it('derived: the length is the raw one, not the parsed one (a tab the parser drops still counts; a space it encodes does not)', () => {
    const base = 'https://example.com/';
    // 2048 raw characters with a tab inside (not at the end: a trailing tab is trimmed text) that the parser removes:
    // accepted, and the href is 2047 long.
    const tabbed2048 = base + 'a'.repeat(1000) + '\t' + 'a'.repeat(1027);
    expect(tabbed2048).toHaveLength(2048);
    expect(acceptThumbnail(tabbed2048)).toBe(base + 'a'.repeat(2027));
    // 2049 raw characters whose parsed href would be only 2047 long: refused, because the raw string is counted.
    const tabbed2049 = base + 'a'.repeat(1000) + '\t\t' + 'a'.repeat(1027);
    expect(tabbed2049).toHaveLength(2049);
    expect(acceptThumbnail(tabbed2049)).toBeNull();
    // A raw string under the limit whose href is far over it (each inner space becomes %20): accepted.
    const spaced = base + 'a' + ' a'.repeat(900);
    expect(spaced.length).toBeLessThanOrEqual(2048);
    const href = acceptThumbnail(spaced);
    expect(href).toBe(base + 'a' + '%20a'.repeat(900));
    expect((href as string).length).toBeGreaterThan(2048);
  });

  it('derived: what comes back is a string, and accepting it again gives the same string', () => {
    for (const raw of ['HTTPS://EXAMPLE.com/t.jpg', 'https://example.com', 'https://example.com/a\tb.jpg', 'https://example.com:8443/t.jpg?x=1#y']) {
      const first = acceptThumbnail(raw);
      expect(typeof first).toBe('string');
      expect(acceptThumbnail(first)).toBe(first);
    }
  });
});

describe('acceptThumbnail: what is refused', () => {
  it.each([
    ['http, not https', 'http://example.com/t.jpg'],
    ['a data URL', 'data:image/png;base64,AAAA'],
    ['javascript:', 'javascript:alert(1)'],
    ['a file URL', 'file:///C:/t.png'],
    ['a protocol-relative URL', '//cdn.example.com/t.jpg'],
    ['a relative path', 't.jpg'],
    ['the empty string', ''],
    ['user and password', 'https://user:pw@example.com/t.jpg'],
    ['a user alone', 'https://user@example.com/t.jpg'],
    ['a password alone (empty user)', 'https://:pw@example.com/t.jpg'],
    ['localhost', 'https://localhost/t.jpg'],
    ['localhost with a trailing dot', 'https://localhost./t.jpg'],
    ['a name under .localhost', 'https://a.localhost/t.jpg'],
    ['LOCALHOST in capitals', 'https://LOCALHOST/t.jpg'],
    ['a name under .localhost with a trailing dot', 'https://a.localhost./t.jpg'],
    ['a name under .localhost in mixed case', 'https://A.B.LocalHost/t.jpg'],
    ['the IPv4 loopback', 'https://127.0.0.1/t.jpg'],
    ['the IPv4 loopback with a trailing dot', 'https://127.0.0.1./t.jpg'],
    ['the IPv6 loopback', 'https://[::1]/t.jpg'],
    ['an IPv4-mapped IPv6 address', 'https://[::ffff:1.2.3.4]/t.jpg'],
    ['an IPv6 address', 'https://[2001:db8::1]/t.jpg'],
    ['the loopback as one decimal number', 'https://2130706433/t.jpg'],
    ['the loopback in hex', 'https://0x7f.0.0.1/t.jpg'],
    ['three-part address, rewritten to four parts', 'https://1.2.3/t.jpg'],
    ['a private IPv4 address', 'https://10.0.0.1/t.jpg'],
    ['another private IPv4 address', 'https://192.168.1.1/t.jpg'],
    ['a public IPv4 address (every address is refused)', 'https://8.8.8.8/t.jpg'],
    ['a leading space', ' https://example.com/t.jpg'],
    ['a trailing newline', 'https://example.com/t.jpg\n'],
    ['a trailing space', 'https://example.com/t.jpg '],
    ['a leading tab', '\thttps://example.com/t.jpg'],
    ['a trailing carriage return', 'https://example.com/t.jpg\r'],
    ['a leading no-break space', '\u00a0https://example.com/t.jpg'],
    ['a trailing byte-order mark', 'https://example.com/t.jpg\ufeff'],
    ['ftp', 'ftp://example.com/t.jpg'],
    ['blob', 'blob:https://example.com/1'],
    ['wss', 'wss://example.com/t'],
    ['http with a localhost name', 'http://localhost/t.jpg'],
    ['over 2048 characters', 'https://example.com/' + 'a'.repeat(2029)],
    ['a string the parser cannot parse (no host)', 'https://'],
    ['a string the parser cannot parse (a space in the host)', 'https://exa mple.com/t.jpg'],
    ['a string the parser cannot parse (an open bracket)', 'https://[::1/t.jpg'],
    ['text that is not a URL', 'not a url'],
  ])('%s: %j gives null', (_label, raw) => {
    expect(acceptThumbnail(raw)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['NaN', Number.NaN],
    ['a boolean', true],
    ['an empty object', {}],
    ['an empty array', []],
    ['an array holding a good URL', [GOOD]],
    ['a String object holding a good URL', new String(GOOD)],
    ['a URL object', new URL(GOOD)],
    ['an object whose toString gives a good URL', { toString: () => GOOD }],
    ['an object with an href', { href: GOOD }],
    ['a function', () => GOOD],
    ['a bigint', 1n],
    ['a symbol', Symbol('x')],
  ])('a value that is not a string (%s) gives null and does not throw', (_label, raw) => {
    expect(() => acceptThumbnail(raw)).not.toThrow();
    expect(acceptThumbnail(raw)).toBeNull();
  });

  it('never throws, whatever the string', () => {
    for (const raw of ['https://', 'https://[::1/t.jpg', 'https://exa mple.com/', ':', 'https:', '\u0000', 'https://%', 'https://example.com/%zz', '\ud800']) {
      expect(() => acceptThumbnail(raw)).not.toThrow();
    }
  });
});

describe('rememberThumb and thumbFor', () => {
  const A = 'https://example.com/watch?v=a';
  const B = 'https://example.com/watch?v=b';
  const C = 'https://example.com/watch?v=c';
  const thumbOf = (n: number | string): string => `https://img.example.com/${n}.jpg`;
  const jobAt = (url: string) => makeJob({ url });

  it('remembers a valid thumb, and thumbFor gives the accepted href for a job with that url', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf(1));
    expect(thumbFor(map, jobAt(A))).toBe(thumbOf(1));
  });

  it('does not remember an http thumb: the map is unchanged and thumbFor gives null', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, 'http://example.com/t.jpg');
    expect(map.size).toBe(0);
    expect(thumbFor(map, jobAt(A))).toBeNull();
  });

  it('cap 2: a, b, c leaves b and c', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf('a'), 2);
    rememberThumb(map, B, thumbOf('b'), 2);
    rememberThumb(map, C, thumbOf('c'), 2);
    expect(map.has(A)).toBe(false);
    expect(map.has(B)).toBe(true);
    expect(map.has(C)).toBe(true);
    expect(map.size).toBe(2);
  });

  it('cap 2: a, b, a again, c leaves a and c (a became the newest)', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf('a'), 2);
    rememberThumb(map, B, thumbOf('b'), 2);
    rememberThumb(map, A, thumbOf('a'), 2);
    rememberThumb(map, C, thumbOf('c'), 2);
    expect(map.has(B)).toBe(false);
    expect(map.has(A)).toBe(true);
    expect(map.has(C)).toBe(true);
  });

  it('thumbFor gives null for a job whose url was never stored', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf(1));
    expect(thumbFor(map, jobAt(B))).toBeNull();
    expect(thumbFor(new Map(), jobAt(A))).toBeNull();
  });

  it('(+) stores the accepted href, not the raw text', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, 'HTTPS://EXAMPLE.com/t.jpg');
    expect(map.get(A)).toBe('https://example.com/t.jpg');
    expect(thumbFor(map, jobAt(A))).toBe('https://example.com/t.jpg');
  });

  it('(+) an invalid thumb under a url that has one keeps the first value', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf(1));
    rememberThumb(map, A, 'http://example.com/t.jpg');
    rememberThumb(map, A, null);
    expect(map.size).toBe(1);
    expect(map.get(A)).toBe(thumbOf(1));
  });

  it('(+) a second thumb under the same url replaces the first: size 1, the second value', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf(1));
    rememberThumb(map, A, thumbOf(2));
    expect(map.size).toBe(1);
    expect(map.get(A)).toBe(thumbOf(2));
  });

  it('(+) cap 2: a, b, then a again with another thumb, then c: the keys are [a, c]', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf('a1'), 2);
    rememberThumb(map, B, thumbOf('b'), 2);
    rememberThumb(map, A, thumbOf('a2'), 2);
    rememberThumb(map, C, thumbOf('c'), 2);
    expect([...map.keys()]).toEqual([A, C]);
    expect(map.get(A)).toBe(thumbOf('a2'));
  });

  it('(+) the default cap is 200: 201 different urls leave 200, without the first and with the second and the 201st', () => {
    const map = new Map<string, string>();
    const urls = Array.from({ length: 201 }, (_v, i) => `https://example.com/watch?v=${i + 1}`);
    for (const [i, url] of urls.entries()) rememberThumb(map, url, thumbOf(i + 1));
    expect(map.size).toBe(200);
    expect(map.has(urls[0] as string)).toBe(false);
    expect(map.has(urls[1] as string)).toBe(true);
    expect(map.has(urls[200] as string)).toBe(true);
  });

  it('(+) 200 urls fit: nothing is dropped at the cap', () => {
    const map = new Map<string, string>();
    for (let i = 1; i <= 200; i += 1) rememberThumb(map, `https://example.com/watch?v=${i}`, thumbOf(i));
    expect(map.size).toBe(200);
    expect(map.has('https://example.com/watch?v=1')).toBe(true);
  });

  it.each([
    ['0', 0],
    ['1.5', 1.5],
    ['NaN', Number.NaN],
    ['-1', -1],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a numeric string', '2' as unknown as number],
  ])('(+) cap %s is not an integer >= 1: the limit is 200, silently', (_label, cap) => {
    const small = new Map<string, string>();
    expect(() => {
      for (let i = 1; i <= 3; i += 1) rememberThumb(small, `https://example.com/watch?v=${i}`, thumbOf(i), cap);
    }).not.toThrow();
    expect(small.size).toBe(3);

    // The limit is the default 200, not "no limit".
    const big = new Map<string, string>();
    for (let i = 1; i <= 201; i += 1) rememberThumb(big, `https://example.com/watch?v=${i}`, thumbOf(i), cap);
    expect(big.size).toBe(200);
    expect(big.has('https://example.com/watch?v=1')).toBe(false);
    expect(big.has('https://example.com/watch?v=201')).toBe(true);
  });

  it('(+) an undefined cap is the default', () => {
    const map = new Map<string, string>();
    for (let i = 1; i <= 201; i += 1) rememberThumb(map, `https://example.com/watch?v=${i}`, thumbOf(i), undefined);
    expect(map.size).toBe(200);
  });

  it('(+) cap 1: a, b leaves only b', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf('a'), 1);
    rememberThumb(map, B, thumbOf('b'), 1);
    expect([...map.keys()]).toEqual([B]);
  });

  it('(+) two jobs with the same url give the same href', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf(1));
    const first = jobAt(A);
    const second = jobAt(A);
    expect(first.id).not.toBe(second.id);
    expect(thumbFor(map, first)).toBe(thumbOf(1));
    expect(thumbFor(map, second)).toBe(thumbFor(map, first));
  });

  it('derived: an invalid thumb changes nothing, not even the order (it does not make the url the newest)', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf('a'), 2);
    rememberThumb(map, B, thumbOf('b'), 2);
    const before = [...map.entries()];
    for (const bad of ['http://example.com/t.jpg', null, undefined, 42, {}, '', 'https://localhost/t.jpg', 'https://user:pw@example.com/t.jpg']) {
      rememberThumb(map, A, bad, 2);
      expect([...map.entries()]).toEqual(before);
    }
    // a was not refreshed, so it is the one that goes when c arrives.
    rememberThumb(map, C, thumbOf('c'), 2);
    expect([...map.keys()]).toEqual([B, C]);
  });

  it('derived: an invalid thumb never evicts anything, even at the cap', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf('a'), 1);
    rememberThumb(map, B, 'http://example.com/t.jpg', 1);
    expect([...map.keys()]).toEqual([A]);
  });

  it('derived: the oldest entries go until the size is within the cap, not just one', () => {
    const map = new Map<string, string>([
      ['https://example.com/watch?v=1', thumbOf(1)],
      ['https://example.com/watch?v=2', thumbOf(2)],
      ['https://example.com/watch?v=3', thumbOf(3)],
      ['https://example.com/watch?v=4', thumbOf(4)],
      ['https://example.com/watch?v=5', thumbOf(5)],
    ]);
    rememberThumb(map, 'https://example.com/watch?v=6', thumbOf(6), 2);
    expect([...map.keys()]).toEqual(['https://example.com/watch?v=5', 'https://example.com/watch?v=6']);
  });

  it('derived: it changes the map it was given and returns nothing', () => {
    const map = new Map<string, string>();
    const result: unknown = rememberThumb(map, A, thumbOf(1));
    expect(result).toBeUndefined();
    expect(map.size).toBe(1);
  });

  it('derived: the key is the url as given, with no normalising', () => {
    const map = new Map<string, string>();
    rememberThumb(map, 'https://Example.com/watch?v=a', thumbOf(1));
    expect([...map.keys()]).toEqual(['https://Example.com/watch?v=a']);
    expect(thumbFor(map, jobAt('https://example.com/watch?v=a'))).toBeNull();
    expect(thumbFor(map, jobAt('https://Example.com/watch?v=a'))).toBe(thumbOf(1));
  });

  it('derived: thumbFor reads the map and changes nothing (it does not touch the order)', () => {
    const map = new Map<string, string>();
    rememberThumb(map, A, thumbOf('a'), 2);
    rememberThumb(map, B, thumbOf('b'), 2);
    thumbFor(map, jobAt(A));
    thumbFor(map, jobAt(C));
    expect([...map.keys()]).toEqual([A, B]);
    rememberThumb(map, C, thumbOf('c'), 2);
    expect([...map.keys()]).toEqual([B, C]);
  });

  it('derived: thumbFor gives what the map holds, null only for a missing key (map.get(url) ?? null)', () => {
    const map = new Map<string, string>([[A, '']]);
    expect(thumbFor(map, jobAt(A))).toBe('');
    expect(thumbFor(map, jobAt(B))).toBeNull();
  });
});
