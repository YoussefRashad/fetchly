// A1 Task 7: the four endpoints /v1/pair, /v1/hello, /v1/status, /v1/unpair on the real server, the real A1
// routes and the real pairing store (injected clock, random source, compare and disk).
//
// Enumeration (S19/S20/S21): the exact keys per endpoint are
//   /v1/pair   { code, label }          /v1/hello  { pairingId, nonce }
//   /v1/status { }                       /v1/unpair { }
// 200 bodies: pair { pairingId, token, protocol, appVersion }, hello { proof }, status { app, protocol, appVersion,
// engine }, unpair { }. A label is 1..40 UTF-16 units without CONTROL or BIDI characters.
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineStatus } from '../../src/shared/types';
import { sleep } from '../wait';
import { ORIGIN_A, ORIGIN_B, expectedProof, nonceOf, originOf } from './fakes';
import { RawConn, buildRequest, send, type RawReply } from './rawHttp';
import { bootServer, stopAll, type Booted } from './rig';

afterEach(async () => {
  await stopAll();
});

let engineState: EngineStatus['state'] = 'ready';

interface Ep {
  b: Booted;
  port: number;
}

async function setup(): Promise<Ep> {
  engineState = 'ready';
  const b = await bootServer({ appVersion: '9.9.9', engine: () => engineState });
  return { b, port: b.port() };
}

const reqSpec = (e: Ep, path: string, body: string, o: { origin?: string | null; token?: string | null } = {}) => ({
  method: 'POST',
  target: path,
  headers: [
    ['Host', `127.0.0.1:${e.port}`],
    ...(o.origin === null ? [] : [['Origin', o.origin ?? ORIGIN_A]]),
    ...(o.token ? [['Authorization', `Bearer ${o.token}`]] : []),
    ['Content-Type', 'application/json'],
    ['Content-Length', String(Buffer.byteLength(body))],
    ['Connection', 'keep-alive'],
  ] as [string, string][],
  body,
});

/** POST a JSON value (or raw text) and return the reply. */
const post = (e: Ep, path: string, body: unknown, o: { origin?: string | null; token?: string | null } = {}): Promise<RawReply> =>
  send(e.port, reqSpec(e, path, typeof body === 'string' ? body : JSON.stringify(body), o));

const json = (reply: RawReply): Record<string, unknown> => JSON.parse(reply.body) as Record<string, unknown>;
const err = (reply: RawReply, status: number, token: string): void => {
  expect(reply.status, reply.text.slice(0, 160)).toBe(status);
  expect(json(reply)).toEqual({ error: token });
};

/** Opens a code in the app and pairs over HTTP. */
async function pairHttp(e: Ep, origin = ORIGIN_A, label = 'Chrome'): Promise<{ pairingId: string; token: string }> {
  const opened = e.b.store.open();
  if (!opened.ok) throw new Error(`open refused: ${opened.error}`);
  const reply = await post(e, '/v1/pair', { code: opened.value.code, label }, { origin });
  expect(reply.status, reply.text.slice(0, 160)).toBe(200);
  const body = json(reply);
  return { pairingId: String(body['pairingId']), token: String(body['token']) };
}

const openCode = (e: Ep): string => {
  const o = e.b.store.open();
  if (!o.ok) throw new Error(`open refused: ${o.error}`);
  return o.value.code;
};

const wrongCode = (code: string): string => `${code.slice(0, 7)}${code.endsWith('0') ? '1' : '0'}`;

// ---------------------------------------------------------------------------------------------------------

describe('POST /v1/pair', () => {
  it('with the right code returns { pairingId, token, protocol: 1, appVersion }', async () => {
    const e = await setup();
    const code = openCode(e);
    const reply = await post(e, '/v1/pair', { code, label: 'Chrome' });
    expect(reply.status).toBe(200);
    const body = json(reply);
    expect(Object.keys(body).sort()).toEqual(['appVersion', 'pairingId', 'protocol', 'token']);
    expect(body['protocol']).toBe(1);
    expect(body['appVersion']).toBe('9.9.9');
    expect(String(body['pairingId'])).toHaveLength(22);
    expect(String(body['token'])).toHaveLength(43);
  });

  it('stores the pairing with the origin of the request, the label and the real listening port', async () => {
    const e = await setup();
    const code = openCode(e);
    await post(e, '/v1/pair', { code, label: 'Edge' }, { origin: ORIGIN_B });
    const rec = e.b.disk.last?.pairings[0];
    expect(rec).toMatchObject({ origin: ORIGIN_B, label: 'Edge', port: e.port });
    expect(e.b.store.list().map((p) => p.label)).toEqual(['Edge']);
  });

  it('the token it returns works on a token route at once', async () => {
    const e = await setup();
    const { token } = await pairHttp(e);
    const status = await post(e, '/v1/status', {}, { token });
    expect(status.status).toBe(200);
  });

  it('works for any extension-shaped origin and needs no Authorization', async () => {
    const e = await setup();
    const code = openCode(e);
    const reply = await post(e, '/v1/pair', { code, label: 'x' }, { origin: originOf('p') });
    expect(reply.status).toBe(200);
  });

  it('while no code is open is 403 pairing_closed', async () => {
    const e = await setup();
    err(await post(e, '/v1/pair', { code: '01234567', label: 'Chrome' }), 403, 'pairing_closed');
    expect(e.b.store.list()).toHaveLength(0);
  });

  it('after the right code was used, the same code again is 403 pairing_closed', async () => {
    const e = await setup();
    const code = openCode(e);
    expect((await post(e, '/v1/pair', { code, label: 'Chrome' })).status).toBe(200);
    err(await post(e, '/v1/pair', { code, label: 'Chrome' }), 403, 'pairing_closed');
    expect(e.b.store.list()).toHaveLength(1);
  });

  it('a well-formed wrong code is 401 bad_code and uses one try', async () => {
    const e = await setup();
    const code = openCode(e);
    err(await post(e, '/v1/pair', { code: wrongCode(code), label: 'Chrome' }), 401, 'bad_code');
    expect(e.b.store.codeOpen()).toBe(true);
    expect((await post(e, '/v1/pair', { code, label: 'Chrome' })).status).toBe(200);
  });

  it('four wrong codes then the right one pairs; five wrong close pairing and a right one is then pairing_closed', async () => {
    const e = await setup();
    const code = openCode(e);
    for (let i = 0; i < 4; i += 1) err(await post(e, '/v1/pair', { code: wrongCode(code), label: 'Chrome' }), 401, 'bad_code');
    expect((await post(e, '/v1/pair', { code, label: 'Chrome' })).status).toBe(200);

    const e2 = await setup();
    const code2 = openCode(e2);
    for (let i = 0; i < 5; i += 1) err(await post(e2, '/v1/pair', { code: wrongCode(code2), label: 'Chrome' }), 401, 'bad_code');
    err(await post(e2, '/v1/pair', { code: code2, label: 'Chrome' }), 403, 'pairing_closed');
    expect(e2.b.store.list()).toHaveLength(0);
  });

  describe('a bad body is 400 bad_request, uses no try, and is 400 while closed too (S21)', () => {
    const emoji = (n: number): string => '\u{1F600}'.repeat(n);
    const BAD: [string, (code: string) => unknown][] = [
      ['a 41-unit label', (code) => ({ code, label: 'a'.repeat(41) })],
      ['21 emoji (42 units)', (code) => ({ code, label: emoji(21) })],
      ['an empty label', (code) => ({ code, label: '' })],
      ['a label with U+0001', (code) => ({ code, label: 'a\u0001b' })],
      ['a label with a newline', (code) => ({ code, label: 'a\nb' })],
      ['a label with U+007F', (code) => ({ code, label: 'a\u007fb' })],
      ['a label with U+202E (bidi override)', (code) => ({ code, label: 'a\u202eb' })],
      ['a label with U+200F (bidi mark)', (code) => ({ code, label: 'a\u200fb' })],
      ['a label with U+2069 (bidi isolate)', (code) => ({ code, label: 'a\u2069b' })],
      ['a label that is a number', (code) => ({ code, label: 5 })],
      ['a label that is null', (code) => ({ code, label: null })],
      ['a label that is an array', (code) => ({ code, label: ['x'] })],
      ['a label that is an object', (code) => ({ code, label: {} })],
      ['a missing label', (code) => ({ code })],
      ['a lowercase code', (code) => ({ code: code.toLowerCase().replace(/[0-9]/gu, 'a'), label: 'Chrome' })],
      ['a 7-symbol code', (code) => ({ code: code.slice(0, 7), label: 'Chrome' })],
      ['a 9-symbol code', (code) => ({ code: `${code}0`, label: 'Chrome' })],
      ['a code with the letter O', (code) => ({ code: `${code.slice(0, 7)}O`, label: 'Chrome' })],
      ['a code with the letter I', (code) => ({ code: `${code.slice(0, 7)}I`, label: 'Chrome' })],
      ['a code with the letter L', (code) => ({ code: `${code.slice(0, 7)}L`, label: 'Chrome' })],
      ['a code with the letter U', (code) => ({ code: `${code.slice(0, 7)}U`, label: 'Chrome' })],
      ['a code with a trailing space', (code) => ({ code: `${code} `, label: 'Chrome' })],
      ['a code that is a number', () => ({ code: 12345678, label: 'Chrome' })],
      ['a code that is null', () => ({ code: null, label: 'Chrome' })],
      ['an empty code', () => ({ code: '', label: 'Chrome' })],
      ['a missing code', () => ({ label: 'Chrome' })],
      ['an extra key', (code) => ({ code, label: 'Chrome', extra: 1 })],
      // Whatever its place in an alphabetical order of the keys: before, between or after the real ones.
      ['an extra key that sorts before the real ones', (code) => ({ aaa: 1, code, label: 'Chrome' })],
      ['an extra key that sorts between the real ones', (code) => ({ code, d: 1, label: 'Chrome' })],
      ['an extra key that sorts after the real ones', (code) => ({ code, label: 'Chrome', zzz: 1 })],
      ['an extra key that is a duplicate of a real one in another case', (code) => ({ code, label: 'Chrome', Label: 'x' })],
      ['an empty object', () => ({})],
      ['a pairing string in place of the code', (code) => ({ code: `38917-${code}`, label: 'Chrome' })],
    ];

    it.each(BAD)('%s, with a code open', async (_name, make) => {
      const e = await setup();
      const code = openCode(e);
      err(await post(e, '/v1/pair', make(code)), 400, 'bad_request');
      expect(e.b.store.codeOpen()).toBe(true);
      expect(e.b.store.list()).toHaveLength(0);
    });

    it.each(BAD)('%s, with no code open', async (_name, make) => {
      const e = await setup();
      err(await post(e, '/v1/pair', make('ABCDEFGH')), 400, 'bad_request');
    });

    it('an extra key __proto__ is refused as an extra key', async () => {
      const e = await setup();
      const code = openCode(e);
      err(await post(e, '/v1/pair', `{"code":"${code}","label":"Chrome","__proto__":{}}`), 400, 'bad_request');
      expect(e.b.store.list()).toHaveLength(0);
    });

    it('twenty malformed bodies use no try: four wrong codes still leave the code open, and the right one pairs', async () => {
      const e = await setup();
      const code = openCode(e);
      for (let i = 0; i < 20; i += 1) {
        const [, make] = BAD[i % BAD.length] ?? BAD[0] ?? ['', () => ({})];
        expect((await post(e, '/v1/pair', make(code))).status).toBe(400);
      }
      for (let i = 0; i < 4; i += 1) err(await post(e, '/v1/pair', { code: wrongCode(code), label: 'Chrome' }), 401, 'bad_code');
      expect(e.b.store.codeOpen()).toBe(true);
      expect((await post(e, '/v1/pair', { code, label: 'Chrome' })).status).toBe(200);
    });
  });

  describe('labels at the boundary pair', () => {
    it.each<[string, string]>([
      ['40 units', 'a'.repeat(40)],
      ['20 emoji (40 units)', '\u{1F600}'.repeat(20)],
      ['one unit', 'a'],
      ['U+0080 (above CONTROL)', 'a\u0080b'],
      ['a zero-width joiner (not BIDI)', 'a\u200db'],
      ['Arabic letters and a space', 'متصفح Edge'],
      ['a tab-free punctuation label', 'Chrome (work) #1'],
    ])('%s', async (_name, label) => {
      const e = await setup();
      const code = openCode(e);
      const reply = await post(e, '/v1/pair', { code, label });
      expect(reply.status, reply.text.slice(0, 160)).toBe(200);
      expect(e.b.store.list()[0]?.label).toBe(label);
    });
  });

  it('two right-code pairs in flight: exactly one is 200, the other pairing_closed, and there is one entry', async () => {
    const e = await setup();
    const code = openCode(e);
    const bodyA = JSON.stringify({ code, label: 'Chrome' });
    const bodyB = JSON.stringify({ code, label: 'Edge' });
    const mk = async (origin: string, body: string): Promise<RawConn> => {
      const conn = await new RawConn(e.port).connected();
      const full = buildRequest(reqSpec(e, '/v1/pair', body, { origin }));
      conn.write(full.subarray(0, full.length - 6)); // the head and most of the body
      return conn;
    };
    const [a, b] = await Promise.all([mk(ORIGIN_A, bodyA), mk(ORIGIN_B, bodyB)]);
    await sleep(100);
    // both bodies finish in the same tick
    a.write(bodyA.slice(-6));
    b.write(bodyB.slice(-6));
    const [ra, rb] = await Promise.all([a.complete(3000), b.complete(3000)]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 403]);
    const loser = ra.status === 403 ? ra : rb;
    expect(JSON.parse(loser.body)).toEqual({ error: 'pairing_closed' });
    expect(e.b.store.list()).toHaveLength(1);
    a.destroy();
    b.destroy();
  });

  it('answers 200 when saving pairing.json fails (S11), and the pairing works', async () => {
    const e = await setup();
    e.b.disk.failing = true;
    const { token } = await pairHttp(e);
    expect(e.b.store.view().unsaved).toBe(true);
    expect((await post(e, '/v1/status', {}, { token })).status).toBe(200);
    e.b.disk.failing = false;
    e.b.clock.advance(30_000);
    expect(e.b.store.view().unsaved).toBe(false);
  });

  it('records the real listening port in the pairing, not a settings value', async () => {
    const e = await setup();
    await pairHttp(e);
    const addr = e.b.servers[0]?.address() as { port: number };
    expect(e.b.disk.last?.pairings[0]?.port).toBe(addr.port);
  });

  it('never returns the origin, tokenHash or proofKey', async () => {
    const e = await setup();
    const code = openCode(e);
    const reply = await post(e, '/v1/pair', { code, label: 'Chrome' });
    expect(reply.body).not.toMatch(/origin|tokenHash|proofKey|chrome-extension/u);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('POST /v1/hello', () => {
  const portOf = (e: Ep): number => (e.b.servers[0]?.address() as { port: number }).port;

  it('returns a proof the test verifies with server.address().port', async () => {
    const e = await setup();
    const { pairingId, token } = await pairHttp(e);
    const nonce = nonceOf(3);
    const reply = await post(e, '/v1/hello', { pairingId, nonce });
    expect(reply.status).toBe(200);
    const body = json(reply);
    expect(Object.keys(body)).toEqual(['proof']);
    expect(body['proof']).toBe(expectedProof(token, pairingId, portOf(e), nonce));
    expect(String(body['proof'])).toHaveLength(43);
  });

  it('a proof computed for another port does not verify', async () => {
    const e = await setup();
    const { pairingId, token } = await pairHttp(e);
    const nonce = nonceOf(4);
    const body = json(await post(e, '/v1/hello', { pairingId, nonce }));
    expect(body['proof']).not.toBe(expectedProof(token, pairingId, portOf(e) + 1, nonce));
    expect(body['proof']).not.toBe(expectedProof(token, pairingId, 38917 === portOf(e) ? 38918 : 38917, nonce));
  });

  it('needs no token: no Authorization header', async () => {
    const e = await setup();
    const { pairingId } = await pairHttp(e);
    expect((await post(e, '/v1/hello', { pairingId, nonce: nonceOf() }, { token: null })).status).toBe(200);
  });

  it('answers with a fresh proof for each nonce', async () => {
    const e = await setup();
    const { pairingId } = await pairHttp(e);
    const a = json(await post(e, '/v1/hello', { pairingId, nonce: nonceOf(1) }))['proof'];
    const b = json(await post(e, '/v1/hello', { pairingId, nonce: nonceOf(2) }))['proof'];
    expect(a).not.toBe(b);
  });

  describe('a body that is not exactly { pairingId (22), nonce (43) } is 400 bad_request', () => {
    const ID = 'A'.repeat(22);
    const NONCE = 'n'.repeat(43);
    it.each<[string, unknown]>([
      ['a 21-character id', { pairingId: ID.slice(0, 21), nonce: NONCE }],
      ['a 23-character id', { pairingId: `${ID}A`, nonce: NONCE }],
      ['an id with a plus sign', { pairingId: `${ID.slice(0, 21)}+`, nonce: NONCE }],
      ['an id with padding', { pairingId: `${ID.slice(0, 21)}=`, nonce: NONCE }],
      ['an id that is a number', { pairingId: 1234, nonce: NONCE }],
      ['a missing id', { nonce: NONCE }],
      ['a 42-character nonce', { pairingId: ID, nonce: NONCE.slice(0, 42) }],
      ['a 44-character nonce', { pairingId: ID, nonce: `${NONCE}n` }],
      ['a nonce with a slash', { pairingId: ID, nonce: `${NONCE.slice(0, 42)}/` }],
      ['a nonce that is null', { pairingId: ID, nonce: null }],
      ['a missing nonce', { pairingId: ID }],
      ['an extra key', { pairingId: ID, nonce: NONCE, extra: 1 }],
      ['an extra key that sorts before the real ones', { aaa: 1, nonce: NONCE, pairingId: ID }],
      ['an extra key that sorts between the real ones', { nonce: NONCE, o: 1, pairingId: ID }],
      ['an extra key that sorts after the real ones', { nonce: NONCE, pairingId: ID, zzz: 1 }],
      ['an empty object', {}],
      ['an array', [ID, NONCE]],
      ['the id and the nonce swapped', { pairingId: NONCE, nonce: ID }],
    ])('%s', async (_name, body) => {
      const e = await setup();
      err(await post(e, '/v1/hello', body), 400, 'bad_request');
    });

    it('exactly 22 and 43 are well-formed (an unknown id answers 404, not 400)', async () => {
      const e = await setup();
      err(await post(e, '/v1/hello', { pairingId: ID, nonce: NONCE }), 404, 'unknown_pairing');
    });
  });

  it('an unknown id is 404 unknown_pairing', async () => {
    const e = await setup();
    await pairHttp(e);
    err(await post(e, '/v1/hello', { pairingId: 'B'.repeat(22), nonce: nonceOf() }), 404, 'unknown_pairing');
  });

  it('another origin’s id is 404 unknown_pairing, and so is the same body from an origin with no pairing', async () => {
    const e = await setup();
    const { pairingId } = await pairHttp(e, ORIGIN_A);
    err(await post(e, '/v1/hello', { pairingId, nonce: nonceOf() }, { origin: ORIGIN_B }), 404, 'unknown_pairing');
    err(await post(e, '/v1/hello', { pairingId, nonce: nonceOf() }, { origin: originOf('p') }), 404, 'unknown_pairing');
  });

  it('with a shared origin each id gets its own proof (Chrome and Edge from one folder)', async () => {
    const e = await setup();
    const chrome = await pairHttp(e, ORIGIN_A, 'Chrome');
    const edge = await pairHttp(e, ORIGIN_A, 'Edge');
    const nonce = nonceOf(6);
    const pc = json(await post(e, '/v1/hello', { pairingId: chrome.pairingId, nonce }))['proof'];
    const pe = json(await post(e, '/v1/hello', { pairingId: edge.pairingId, nonce }))['proof'];
    expect(pc).toBe(expectedProof(chrome.token, chrome.pairingId, portOf(e), nonce));
    expect(pe).toBe(expectedProof(edge.token, edge.pairingId, portOf(e), nonce));
    expect(pc).not.toBe(pe);
  });

  it('1000 hellos are all answered, and the token routes still work afterwards (no limit, no shared quota)', async () => {
    const e = await setup();
    const { pairingId, token } = await pairHttp(e);
    let ok = 0;
    for (let i = 0; i < 1000; i += 6) {
      const batch = await Promise.all(Array.from({ length: Math.min(6, 1000 - i) }, (_, k) => post(e, '/v1/hello', { pairingId, nonce: nonceOf(((i + k) % 250) + 1) })));
      ok += batch.filter((r) => r.status === 200).length;
    }
    expect(ok).toBe(1000);
    expect((await post(e, '/v1/status', {}, { token })).status).toBe(200);
  }, 30_000);

  it('after an unpair the same hello is 404 unknown_pairing', async () => {
    const e = await setup();
    const { pairingId, token } = await pairHttp(e);
    expect((await post(e, '/v1/hello', { pairingId, nonce: nonceOf() })).status).toBe(200);
    expect((await post(e, '/v1/unpair', {}, { token })).status).toBe(200);
    err(await post(e, '/v1/hello', { pairingId, nonce: nonceOf() }), 404, 'unknown_pairing');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('POST /v1/status', () => {
  it.each<EngineStatus['state']>(['notInstalled', 'starting', 'ready', 'error'])('returns { app, protocol, appVersion, engine } for engine state %s', async (state) => {
    const e = await setup();
    const { token } = await pairHttp(e);
    engineState = state;
    const reply = await post(e, '/v1/status', {}, { token });
    expect(reply.status).toBe(200);
    expect(json(reply)).toEqual({ app: 'fetchly', protocol: 1, appVersion: '9.9.9', engine: state });
    expect(Object.keys(json(reply)).sort()).toEqual(['app', 'appVersion', 'engine', 'protocol']);
  });

  it('follows the engine as it changes between calls', async () => {
    const e = await setup();
    const { token } = await pairHttp(e);
    engineState = 'starting';
    expect(json(await post(e, '/v1/status', {}, { token }))['engine']).toBe('starting');
    engineState = 'ready';
    expect(json(await post(e, '/v1/status', {}, { token }))['engine']).toBe('ready');
  });

  it('needs the token: without one it is 401 bad_token', async () => {
    const e = await setup();
    await pairHttp(e);
    err(await post(e, '/v1/status', {}, { token: null }), 401, 'bad_token');
  });

  it.each<[string, unknown]>([
    ['an extra key', { extra: 1 }],
    ['an extra key that sorts first', { aaa: 1 }],
    ['an extra key that sorts last', { zzz: 1 }],
    ['an array', []],
    ['null', null],
    ['a string', 'x'],
  ])('a body that is %s is 400 bad_request', async (_name, body) => {
    const e = await setup();
    const { token } = await pairHttp(e);
    err(await post(e, '/v1/status', body, { token }), 400, 'bad_request');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('POST /v1/unpair', () => {
  it('returns {} and revokes: the same token then gets 403 bad_origin when it was the origin’s only pairing', async () => {
    const e = await setup();
    const { token, pairingId } = await pairHttp(e);
    const reply = await post(e, '/v1/unpair', {}, { token });
    expect(reply.status).toBe(200);
    expect(json(reply)).toEqual({});
    expect(e.b.store.isStored(pairingId)).toBe(false);
    err(await post(e, '/v1/status', {}, { token }), 403, 'bad_origin');
  });

  it('the same token gets 401 bad_token when a sibling of the same origin remains', async () => {
    const e = await setup();
    const chrome = await pairHttp(e, ORIGIN_A, 'Chrome');
    const edge = await pairHttp(e, ORIGIN_A, 'Edge');
    expect((await post(e, '/v1/unpair', {}, { token: chrome.token })).status).toBe(200);
    err(await post(e, '/v1/status', {}, { token: chrome.token }), 401, 'bad_token');
    expect((await post(e, '/v1/status', {}, { token: edge.token })).status).toBe(200);
    expect(e.b.store.list().map((p) => p.label)).toEqual(['Edge']);
  });

  it('removes only the caller’s pairing, not those of other origins', async () => {
    const e = await setup();
    const a = await pairHttp(e, ORIGIN_A, 'Chrome');
    const b = await pairHttp(e, ORIGIN_B, 'Edge');
    await post(e, '/v1/unpair', {}, { token: a.token, origin: ORIGIN_A });
    expect((await post(e, '/v1/status', {}, { token: b.token, origin: ORIGIN_B })).status).toBe(200);
  });

  it('a hello, then an IPC unpair, then the token request: 403 when it was the only pairing (B5)', async () => {
    const e = await setup();
    const { pairingId, token } = await pairHttp(e);
    expect((await post(e, '/v1/hello', { pairingId, nonce: nonceOf() })).status).toBe(200);
    e.b.store.unpair(pairingId); // what the IPC unpair does
    err(await post(e, '/v1/status', {}, { token }), 403, 'bad_origin');
  });

  it('a hello, then an IPC unpair, then the token request: 401 when a sibling remains (B5)', async () => {
    const e = await setup();
    const chrome = await pairHttp(e, ORIGIN_A, 'Chrome');
    await pairHttp(e, ORIGIN_A, 'Edge');
    expect((await post(e, '/v1/hello', { pairingId: chrome.pairingId, nonce: nonceOf() })).status).toBe(200);
    e.b.store.unpair(chrome.pairingId);
    err(await post(e, '/v1/status', {}, { token: chrome.token }), 401, 'bad_token');
  });

  it('answers 200 and revokes at once when saving pairing.json fails (S11)', async () => {
    const e = await setup();
    const { token } = await pairHttp(e);
    e.b.disk.failing = true;
    const reply = await post(e, '/v1/unpair', {}, { token });
    expect(reply.status).toBe(200);
    expect(json(reply)).toEqual({});
    expect(e.b.store.view().unsaved).toBe(true);
    err(await post(e, '/v1/status', {}, { token }), 403, 'bad_origin');
  });

  it.each<[string, unknown]>([
    ['a key', { id: 'x' }],
    ['a key that sorts first', { aaa: 1 }],
    ['a key that sorts last', { zzz: 1 }],
    ['an array', []],
    ['null', null],
    ['a string', 'x'],
  ])('a body that is %s is 400 and removes nothing', async (_name, body) => {
    const e = await setup();
    const { token } = await pairHttp(e);
    err(await post(e, '/v1/unpair', body, { token }), 400, 'bad_request');
    expect(e.b.store.list()).toHaveLength(1);
    expect((await post(e, '/v1/status', {}, { token })).status).toBe(200);
  });

  it('needs the token: without one it is 401 and removes nothing', async () => {
    const e = await setup();
    await pairHttp(e);
    err(await post(e, '/v1/unpair', {}, { token: null }), 401, 'bad_token');
    expect(e.b.store.list()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('tokens and the rate limit end to end', () => {
  it('100 wrong tokens are all 401; the right token then gets 200, and passes 300 times; the 301st is 429', async () => {
    const e = await setup();
    const { token } = await pairHttp(e);
    // the right token is never locked out by wrong ones, which do not use the quota either
    for (let i = 0; i < 100; i += 6) {
      const n = Math.min(6, 100 - i);
      const batch = await Promise.all(Array.from({ length: n }, (_, k) => post(e, '/v1/status', {}, { token: Buffer.alloc(32, ((i + k) % 250) + 1).toString('base64url') })));
      for (const r of batch) err(r, 401, 'bad_token');
    }
    for (let i = 0; i < 300; i += 6) {
      const n = Math.min(6, 300 - i);
      const batch = await Promise.all(Array.from({ length: n }, () => post(e, '/v1/status', {}, { token })));
      for (const r of batch) expect(r.status).toBe(200);
    }
    err(await post(e, '/v1/status', {}, { token }), 429, 'rate_limited');
    e.b.clock.advance(60_000);
    expect((await post(e, '/v1/status', {}, { token })).status).toBe(200);
  }, 30_000);

  it('a wrong token between right ones changes nothing', async () => {
    const e = await setup();
    const { token } = await pairHttp(e);
    for (let i = 0; i < 5; i += 1) {
      expect((await post(e, '/v1/status', {}, { token })).status).toBe(200);
      err(await post(e, '/v1/status', {}, { token: 'A'.repeat(43) }), 401, 'bad_token');
    }
  });

  it('Chrome and Edge from one folder (S4): both stay paired, each with its own token, and unpairing one leaves the other', async () => {
    const e = await setup();
    const chrome = await pairHttp(e, ORIGIN_A, 'Chrome');
    const edge = await pairHttp(e, ORIGIN_A, 'Edge');
    expect(chrome.pairingId).not.toBe(edge.pairingId);
    expect(chrome.token).not.toBe(edge.token);
    expect((await post(e, '/v1/status', {}, { token: chrome.token })).status).toBe(200);
    expect((await post(e, '/v1/status', {}, { token: edge.token })).status).toBe(200);
    await post(e, '/v1/unpair', {}, { token: edge.token });
    expect((await post(e, '/v1/status', {}, { token: chrome.token })).status).toBe(200);
    err(await post(e, '/v1/status', {}, { token: edge.token }), 401, 'bad_token');
  });

  it('the whole flow: pair, hello, status, unpair', async () => {
    const e = await setup();
    const { pairingId, token } = await pairHttp(e);
    const nonce = nonceOf(9);
    const hello = json(await post(e, '/v1/hello', { pairingId, nonce }));
    expect(hello['proof']).toBe(expectedProof(token, pairingId, e.port, nonce));
    expect(json(await post(e, '/v1/status', {}, { token }))['app']).toBe('fetchly');
    expect(json(await post(e, '/v1/unpair', {}, { token }))).toEqual({});
    expect(e.b.store.list()).toEqual([]);
  });
});
