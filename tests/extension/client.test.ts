/**
 * Task 3: extension/src/lib/client.ts (E4 to E8g, E11; plan section 4; A1 §8 boundary rows).
 *
 * Enumerations:
 *  - ErrorToken (src/shared/protocol.ts), 18 values: bad_request, bad_host, not_found, preflight_refused, method_not_allowed,
 *    bad_origin, bad_content_type, too_large, bad_token, rate_limited, pairing_closed, bad_code, unknown_pairing, busy, not_ready,
 *    unknown_request, storage_unavailable, bad_site. ERROR_TOKENS must hold exactly these (compile-time `satisfies` below, runtime
 *    list compared here); each one comes back as `refused.token`.
 *  - CallResult kinds (plan section 4): ok, not_paired, storage_blocked, app_not_running, wrong_program, unpaired, stale_proof,
 *    too_large_local, refused. Each has a test below.
 *  - PairResult: ok, wrong_program, app_not_running, mismatch, refused (bad_code, pairing_closed, bad_request).
 *  - Request init members (every request): method, headers (Content-Type; Authorization on the token request only), body, credentials,
 *    cache, redirect, referrerPolicy, signal.
 *  - Clocks: monotonic `now`, wall `wallNow`. Limits: 5000 ms (freshness, fetch timeout), 64 KiB (response cap, BODY_LIMIT).
 *
 * The fake server computes proofs with node:crypto (fakeServer.ts), never with the code under test.
 */
import { describe, expect, it } from 'vitest';
import { BODY_LIMIT, LARGE_BODY_LIMIT, PROOF_KEY_LABEL, helloInput, type ErrorToken } from '../../src/shared/protocol';
import { FakeClock, Trace, flush, track, until } from './clock';
import { FakeNet, bytes, hang, hangBody, infinite, json, nullBody, opaqueRedirect, reject, streamError, text, type Answer, type LoggedRequest } from './fakeFetch';
import { FakeRandom, FakeServer, b64url, bytesOf, expectedProof, makeSpySubtle, proofKeyBytes, type Scripted } from './fakeServer';
import {
  MARKERS,
  PAIRING_ID,
  PAIRING_ID_B,
  PORT,
  PORT_B,
  TOKEN,
  TOKEN_B,
  bodyOfBytes,
  makeRecord,
  makeRecordB,
  secretsOf,
  statusBody,
  type Rec,
} from './fixtures';
import { makeStubStore } from './stubStore';
import { ERROR_TOKENS, createClient } from '../../extension/src/lib/client';

const ALL_TOKENS = {
  bad_request: true,
  bad_host: true,
  not_found: true,
  preflight_refused: true,
  method_not_allowed: true,
  bad_origin: true,
  bad_content_type: true,
  too_large: true,
  bad_token: true,
  rate_limited: true,
  pairing_closed: true,
  bad_code: true,
  unknown_pairing: true,
  busy: true,
  not_ready: true,
  unknown_request: true,
  storage_unavailable: true,
  bad_site: true,
} satisfies Record<ErrorToken, true>;

function rig(opts: { record?: Rec | null; limits?: Record<string, number> } = {}) {
  const clock = new FakeClock();
  const trace = new Trace();
  const net = new FakeNet(clock, trace);
  const record = opts.record === undefined ? makeRecord() : opts.record;
  const server = new FakeServer(record?.port ?? PORT);
  net.servers.set(server.port, server);
  if (record) server.addPairing(record);
  const random = new FakeRandom();
  const spy = makeSpySubtle();
  const store = makeStubStore(record);
  const client = createClient({
    fetch: net.fetch,
    subtle: spy.subtle,
    getRandomValues: random.getRandomValues,
    now: clock.now,
    wallNow: clock.wallNow,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    store,
    limits: opts.limits ?? {},
  });
  return { clock, trace, net, server, random, spy, store, client, record: record ?? makeRecord() };
}
type Rig = ReturnType<typeof rig>;

/** A hello answer: the proof of `token` for the request's own pairingId, port and nonce, each replaceable. */
const helloProof =
  (over: { token?: string; pairingId?: string; port?: number; nonce?: string } = {}) =>
  (req: LoggedRequest): Answer => {
    const b = req.bodyJson as { pairingId: string; nonce: string };
    return json(200, { proof: expectedProof(over.token ?? TOKEN, over.pairingId ?? b.pairingId, over.port ?? PORT, over.nonce ?? b.nonce) });
  };
const rightProofOf = (req: LoggedRequest): string => (helloProof()(req) as { body: { proof: string } }).body.proof;
const nonceOf = (seed: number): string => b64url(Buffer.alloc(32, seed));
const padJson = (value: unknown, totalBytes: number): string => {
  const s = JSON.stringify(value);
  return s + ' '.repeat(totalBytes - Buffer.byteLength(s, 'utf8'));
};

const noAuthorization = (net: FakeNet): boolean => net.log.every((r) => r.authorization === undefined && !r.headerNames.includes('authorization'));
const NOT_FOUND = { ok: false, kind: 'wrong_program' };

/** Fails when the result (or anything else) shows a secret. */
function expectNoSecrets(value: unknown, extra: string[] = []): void {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of [...secretsOf(makeRecord(), makeRecordB()), ...extra]) expect(s).not.toContain(secret);
}

async function thrown(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

/** One request of each kind carries these fixed settings (E8b, N9, N10). */
function expectCommonInit(r: LoggedRequest): void {
  expect(r.loopback, r.url).toBe(true);
  expect(r.method).toBe('POST');
  expect(r.headers['content-type']).toBe('application/json');
  expect(r.init['credentials']).toBe('omit');
  expect(r.init['cache']).toBe('no-store');
  expect(r.init['redirect']).toBe('manual');
  expect(r.init['referrerPolicy']).toBe('no-referrer');
  expect(r.signal).toBeInstanceOf(AbortSignal);
  expect(new Set(r.headerNames).size, 'no repeated header name').toBe(r.headerNames.length);
  for (const forbidden of ['cookie', 'origin', 'host', 'referer']) expect(r.headerNames).not.toContain(forbidden);
}

describe('ERROR_TOKENS (E8g)', () => {
  it('holds exactly the 18 ErrorToken values of protocol.ts, each true', () => {
    expect(Object.keys(ERROR_TOKENS).sort()).toEqual(Object.keys(ALL_TOKENS).sort());
    expect(Object.keys(ERROR_TOKENS)).toHaveLength(18);
    for (const k of Object.keys(ALL_TOKENS)) expect((ERROR_TOKENS as Record<string, unknown>)[k], k).toBe(true);
  });

  it.each(Object.keys(ALL_TOKENS))('a %s answer after a right proof comes back as refused.token', async (token) => {
    const r = rig();
    r.server.once('/v1/x', json(400, { error: token }));
    expect(await r.client.call('/v1/x', {})).toEqual({ ok: false, kind: 'refused', status: 400, token });
  });
});

describe('call: the happy path (E4, E5)', () => {
  it('sends exactly two requests, hello then the path, both to http://127.0.0.1:<record.port>', async () => {
    const r = rig();
    const res = await r.client.call('/v1/status', {});
    expect(res).toEqual({ ok: true, value: statusBody() });
    expect(r.net.log.map((x) => x.path)).toEqual(['/v1/hello', '/v1/status']);
    expect(r.net.log.map((x) => x.url)).toEqual([`http://127.0.0.1:${PORT}/v1/hello`, `http://127.0.0.1:${PORT}/v1/status`]);
    expect(r.net.strays).toEqual([]);
  });

  it('the port of the record is the only port: another port is dialled and used in the proof', async () => {
    const rec = makeRecordB();
    const r = rig({ record: rec });
    const res = await r.client.call('/v1/status', {});
    expect(res).toMatchObject({ ok: true });
    expect(r.net.log.map((x) => x.url)).toEqual([`http://127.0.0.1:${PORT_B}/v1/hello`, `http://127.0.0.1:${PORT_B}/v1/status`]);
    // The fake server computes its proof with the port of the URL: the client's HMAC used the same port.
    const verify = r.spy.calls.verify[0];
    expect(bytesOf(verify?.args[3]).toString('utf8')).toBe(helloInput(rec.pairingId, PORT_B, (r.net.log[0]?.bodyJson as { nonce: string }).nonce));
  });

  it('the hello body is exactly { pairingId, nonce }, the nonce is the base64url of the 32 injected bytes, and there is no Authorization', async () => {
    const r = rig();
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => 200 - i * 3);
    r.random.queueBytes(bytes);
    await r.client.call('/v1/status', {});
    const hello = r.net.log[0];
    expect(hello?.bodyJson).toEqual({ pairingId: PAIRING_ID, nonce: Buffer.from(bytes).toString('base64url') });
    expect(Object.keys(hello?.bodyJson as object).sort()).toEqual(['nonce', 'pairingId']);
    expect((hello?.bodyJson as { nonce: string }).nonce).toHaveLength(43);
    expect(r.random.lengths).toEqual([32]);
    expect(hello?.authorization).toBeUndefined();
  });

  it('the token request carries Authorization: Bearer <token> and the JSON body', async () => {
    const r = rig();
    r.server.once('/v1/x', json(200, { echoed: true }));
    await r.client.call('/v1/x', { a: 1, b: ['é', '€'] });
    const req = r.net.log[1];
    expect(req?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req?.bodyText).toBe(JSON.stringify({ a: 1, b: ['é', '€'] }));
    expect(req?.bodyJson).toEqual({ a: 1, b: ['é', '€'] });
  });

  it('every request: POST, Content-Type, credentials omit, cache no-store, redirect manual, referrerPolicy no-referrer, a signal', async () => {
    const r = rig();
    await r.client.call('/v1/status', {});
    expect(r.net.log).toHaveLength(2);
    for (const req of r.net.log) expectCommonInit(req);
  });

  it('two calls make two nonces and two hellos', async () => {
    const r = rig();
    await r.client.call('/v1/status', {});
    await r.client.call('/v1/status', {});
    expect(r.net.log.map((x) => x.path)).toEqual(['/v1/hello', '/v1/status', '/v1/hello', '/v1/status']);
    const nonces = r.net.log.filter((x) => x.path === '/v1/hello').map((x) => (x.bodyJson as { nonce: string }).nonce);
    expect(new Set(nonces).size).toBe(2);
    expect(r.random.lengths).toEqual([32, 32]);
  });

  it('the proof is checked with WebCrypto as the plan says: two importKey calls with extractable false, one sign, one verify', async () => {
    const r = rig();
    await r.client.call('/v1/status', {});
    const { importKey, sign, verify } = r.spy.calls;
    const alg = (a: unknown): { name: string; hash: string } => {
      const o = typeof a === 'string' ? { name: a } : (a as { name: string; hash?: string | { name: string } });
      const h = (o as { hash?: string | { name: string } }).hash;
      return { name: o.name, hash: typeof h === 'string' ? h : (h?.name ?? '') };
    };
    expect(importKey).toHaveLength(2);
    // E5: the token's ASCII bytes as the HMAC key, for signing; the 32 proof-key bytes, for verifying.
    expect(importKey[0]?.args[0]).toBe('raw');
    expect(bytesOf(importKey[0]?.args[1])).toEqual(Buffer.from(TOKEN, 'ascii'));
    expect(alg(importKey[0]?.args[2])).toEqual({ name: 'HMAC', hash: 'SHA-256' });
    expect(importKey[0]?.args[3]).toBe(false);
    expect(importKey[0]?.args[4]).toEqual(['sign']);
    expect(importKey[1]?.args[0]).toBe('raw');
    expect(bytesOf(importKey[1]?.args[1])).toEqual(proofKeyBytes(TOKEN));
    expect(alg(importKey[1]?.args[2])).toEqual({ name: 'HMAC', hash: 'SHA-256' });
    expect(importKey[1]?.args[3]).toBe(false);
    expect(importKey[1]?.args[4]).toEqual(['verify']);
    // sign(PROOF_KEY_LABEL) derives the proof key; verify(proof) checks the proof, so no MAC is compared as a string (E6).
    expect(sign).toHaveLength(1);
    expect(bytesOf(sign[0]?.args[2]).toString('utf8')).toBe(PROOF_KEY_LABEL);
    expect(verify).toHaveLength(1);
    const hello = r.net.log[0]?.bodyJson as { pairingId: string; nonce: string };
    expect(bytesOf(verify[0]?.args[3]).toString('utf8')).toBe(helloInput(PAIRING_ID, PORT, hello.nonce));
    expect(bytesOf(verify[0]?.args[2])).toEqual(Buffer.from(expectedProof(TOKEN, PAIRING_ID, PORT, hello.nonce), 'base64url'));
    expect(alg(verify[0]?.args[0]).name).toBe('HMAC');
  });

  it('a hello answer of exactly 64 KiB (valid JSON padded with spaces) is accepted', async () => {
    const r = rig();
    r.server.once('/v1/hello', (req) => ({ kind: 'text', status: 200, text: padJson({ proof: rightProofOf(req) }, BODY_LIMIT) }));
    expect(await r.client.call('/v1/status', {})).toMatchObject({ ok: true });
  });

  it('after a call, no timer is left and no signal was aborted (each fetch timer is cleared)', async () => {
    const r = rig();
    await r.client.call('/v1/status', {});
    expect(r.clock.pending()).toEqual([]);
    r.clock.advance(60_000);
    await flush();
    expect(r.net.log.every((x) => x.signal?.aborted === false)).toBe(true);
  });

  it('each fetch has its own 5000 ms timer: 4000 ms for the hello and 4000 ms for the request is fine', async () => {
    const r = rig();
    r.server.once('/v1/hello', (req) => json(200, { proof: rightProofOf(req) }, 4000));
    r.server.once('/v1/status', json(200, statusBody(), 4000));
    const t = track(r.client.call('/v1/status', {}));
    await until(() => r.net.log.length === 1);
    r.clock.advance(4000);
    await until(() => r.net.log.length === 2);
    expect(t.state).toBe('pending');
    r.clock.advance(4000);
    await t.promise;
    expect(t.value).toEqual({ ok: true, value: statusBody() });
  });

  it('reads the store again on every call: nothing is cached (E8c)', async () => {
    const r = rig();
    await r.client.call('/v1/status', {});
    expect(r.store.reads).toBe(1);
    r.store.current = makeRecord({ token: TOKEN_B, pairingId: PAIRING_ID_B });
    r.server.addPairing({ pairingId: PAIRING_ID_B, token: TOKEN_B });
    await r.client.call('/v1/status', {});
    expect(r.store.reads).toBe(2);
    expect(r.net.log[3]?.authorization).toBe(`Bearer ${TOKEN_B}`);
    r.store.current = null;
    expect(await r.client.call('/v1/status', {})).toEqual({ ok: false, kind: 'not_paired' });
    expect(r.store.reads).toBe(3);
  });
});

describe('call: nothing is sent with the token (A1 §8: wrong program, wrong proof)', () => {
  const nothingSent = async (r: Rig, expected: unknown, steps = 1): Promise<void> => {
    const res = await r.client.call('/v1/status', {});
    expect(res).toEqual(expected);
    expect(r.net.log, 'one log entry: the hello').toHaveLength(steps);
    expect(r.net.log[0]?.path).toBe('/v1/hello');
    expect(noAuthorization(r.net)).toBe(true);
    expect(r.store.removed).toEqual([]);
    expect(r.store.current).toEqual(makeRecord());
    expectNoSecrets(res);
  };

  const WRONG: [string, Scripted][] = [
    ['a wrong proof (another token)', helloProof({ token: TOKEN_B })],
    ['a right proof for port + 1', helloProof({ port: PORT + 1 })],
    ['a right proof for port - 1', helloProof({ port: PORT - 1 })],
    ['a proof for another nonce', helloProof({ nonce: nonceOf(9) })],
    ['a proof for another pairingId', helloProof({ pairingId: PAIRING_ID_B })],
    ['a proof of 42 characters', (req) => json(200, { proof: rightProofOf(req).slice(0, 42) })],
    ['a padded proof (44 characters)', (req) => json(200, { proof: `${rightProofOf(req)}=` })],
    ['a proof of 43 characters outside the alphabet', json(200, { proof: `${'+'.repeat(43)}` })],
    ['a proof of 43 zero characters', json(200, { proof: 'A'.repeat(43) })],
    ['a proof of 44 characters', (req) => json(200, { proof: `${rightProofOf(req)}A` })],
    ['an empty proof', json(200, { proof: '' })],
    ['a numeric proof', json(200, { proof: 123 })],
    ['a null proof', json(200, { proof: null })],
    ['an array proof', (req) => json(200, { proof: [rightProofOf(req)] })],
    ['an object proof', json(200, { proof: {} })],
    ['a missing proof', json(200, {})],
    ['a 200 with an extra key', (req) => json(200, { proof: rightProofOf(req), extra: 1 })],
    ['a 200 that is not JSON', text(200, 'not json')],
    ['a 200 with an empty body', text(200, '')],
    ['a 200 with an HTML body', text(200, '<html><body>hello</body></html>')],
    ['a 200 with a null body', nullBody(200)],
    ['a 200 holding an array', (req) => json(200, [rightProofOf(req)])],
    ['a 200 holding null', json(200, null)],
    ['a 200 holding a string', (req) => json(200, rightProofOf(req))],
    ['a valid hello of 64 KiB + 1 byte', (req) => ({ kind: 'text', status: 200, text: padJson({ proof: rightProofOf(req) }, BODY_LIMIT + 1) })],
    ['an endless body', infinite(200)],
    ['a 500', json(500, { error: 'not_ready' })],
    ['a bare 500', text(500, '')],
    ['a 400 bad_request', json(400, { error: 'bad_request' })],
    ['a 403 bad_origin', json(403, { error: 'bad_origin' })],
    ['a 404 not_found', json(404, { error: 'not_found' })],
    ['a bare 404', text(404, '')],
    ['an HTML 404', text(404, '<html>404 Not Found</html>')],
    ['a 404 with a null body', nullBody(404)],
    ['a 404 unknown_pairing with an extra key', json(404, { error: 'unknown_pairing', extra: 1 })],
    ['a 404 holding a proof', (req) => ({ ...(helloProof()(req) as object), status: 404 }) as Answer],
    ['a 401 bad_token', json(401, { error: 'bad_token' })],
    ['a 429 rate_limited', json(429, { error: 'rate_limited' })],
    ['a 503', json(503, { error: 'not_ready' })],
    ['a 201 with a right proof', (req) => ({ ...(helloProof()(req) as object), status: 201 }) as Answer],
    ['a 204', nullBody(204)],
    ['a 302 with a right proof', (req) => ({ ...(helloProof()(req) as object), status: 302 }) as Answer],
    ['status 0, type opaqueredirect, body null (P4c)', opaqueRedirect()],
  ];

  it.each(WRONG)('%s: wrong_program', async (_name, scripted) => {
    const r = rig();
    r.server.once('/v1/hello', scripted);
    await nothingSent(r, NOT_FOUND);
  });

  // A WebCrypto stage that rejects means the proof cannot be checked: wrong_program, nothing sent with the token, nothing
  // deleted, and nothing of the rejection (message, name, token, pairingId) in the result.
  const CRYPTO_STAGES: ['importKey' | 'sign' | 'verify', string][] = [
    ['importKey', 'first importKey (the token key)'],
    ['sign', 'sign (the proof key)'],
    ['verify', 'verify (the proof)'],
  ];
  it.each(CRYPTO_STAGES)('a rejecting subtle.%s (%s): wrong_program, only the hello is sent, no Authorization, no removal, no error text', async (stage) => {
    const r = rig();
    const marker = `CRYPTO_REJECTION_MARKER ${TOKEN} ${PAIRING_ID}`;
    const failing = (): Promise<never> => Promise.reject(new Error(marker));
    (r.spy.subtle as Record<string, unknown>)[stage] = failing;
    const res = await r.client.call('/v1/status', {});
    expect(res).toStrictEqual(NOT_FOUND);
    expect(r.net.log, 'one log entry: the hello').toHaveLength(1);
    expect(r.net.log[0]?.path).toBe('/v1/hello');
    expect(noAuthorization(r.net)).toBe(true);
    expect(r.store.removed).toEqual([]);
    expect(r.store.clears).toBe(0);
    expect(r.store.current).toEqual(makeRecord());
    expect(JSON.stringify(res)).not.toContain('CRYPTO_REJECTION_MARKER');
    expectNoSecrets(res);
  });

  it('a rejecting subtle.sign is reached only after importKey succeeded, and subtle.verify is never reached', async () => {
    const r = rig();
    r.spy.subtle.sign = (): Promise<ArrayBuffer> => Promise.reject(new Error('sign failed'));
    expect(await r.client.call('/v1/status', {})).toStrictEqual(NOT_FOUND);
    expect(r.spy.calls.importKey).toHaveLength(1);
    expect(r.spy.calls.verify).toHaveLength(0);
  });

  it('an endless hello body is read for at most a little over 64 KiB, then dropped', async () => {
    const r = rig();
    r.server.once('/v1/hello', infinite(200, 1024));
    expect(await r.client.call('/v1/status', {})).toEqual(NOT_FOUND);
    expect(r.net.log[0]?.pulled).toBeGreaterThan(0);
    expect(r.net.log[0]?.pulled).toBeLessThanOrEqual(70);
  });

  it('a hello 404 { error: "unknown_pairing" } is unpaired, and the record is kept (E10)', async () => {
    const r = rig();
    r.server.pairings.clear();
    await nothingSent(r, { ok: false, kind: 'unpaired' });
  });

  it('a hello 404 unknown_pairing deletes nothing, however often it comes', async () => {
    const r = rig();
    r.server.pairings.clear();
    for (let i = 0; i < 3; i += 1) expect(await r.client.call('/v1/status', {})).toEqual({ ok: false, kind: 'unpaired' });
    expect(r.store.removed).toEqual([]);
    expect(r.store.clears).toBe(0);
    expect(r.store.current).toEqual(makeRecord());
  });

  const NOT_RUNNING: [string, Answer][] = [
    ['rejects', reject()],
    ['rejects with a message that holds the token', reject(`connect ECONNREFUSED ${TOKEN} ${PAIRING_ID} 127.0.0.1:${PORT}`)],
    ['has its body stream error mid-read', streamError(200)],
  ];
  it.each(NOT_RUNNING)('a hello that %s: app_not_running', async (_name, answer) => {
    const r = rig();
    r.server.once('/v1/hello', answer);
    await nothingSent(r, { ok: false, kind: 'app_not_running' });
  });

  it('nothing listens on the port: app_not_running', async () => {
    const r = rig();
    r.net.servers.clear();
    const res = await r.client.call('/v1/status', {});
    expect(res).toEqual({ ok: false, kind: 'app_not_running' });
    expect(noAuthorization(r.net)).toBe(true);
  });

  it.each([
    ['no headers', hang()],
    ['a body that never ends after the headers', hangBody(200)],
  ])('a hello with %s: pending at 4999 ms, aborted at 5000 ms, app_not_running', async (_name, answer) => {
    const r = rig();
    r.server.once('/v1/hello', answer);
    const t = track(r.client.call('/v1/status', {}));
    await flush();
    expect(r.clock.pending()).toEqual([5000]);
    r.clock.advance(4999);
    await flush();
    expect(t.state).toBe('pending');
    expect(r.net.log[0]?.signal?.aborted).toBe(false);
    r.clock.advance(1);
    await flush();
    expect(t.state).toBe('fulfilled');
    expect(t.value).toEqual({ ok: false, kind: 'app_not_running' });
    expect(r.net.log[0]?.signal?.aborted).toBe(true);
    expect(r.net.log).toHaveLength(1);
    expect(noAuthorization(r.net)).toBe(true);
    expect(r.clock.pending()).toEqual([]);
  });
});

describe('call: freshness of the proof (E7, Q12)', () => {
  const skewDuringHello =
    (r: Rig, by: { mono?: number; wall?: number }): Scripted =>
    () => {
      r.clock.skew(by);
      return 'default';
    };

  it('both clocks at exactly 5000 ms since the nonce: the request is sent', async () => {
    const r = rig();
    r.server.once('/v1/hello', skewDuringHello(r, { mono: 5000, wall: 5000 }));
    expect(await r.client.call('/v1/status', {})).toMatchObject({ ok: true });
    expect(r.net.log).toHaveLength(2);
  });

  it('both clocks at 4999 ms, and both at 0: sent', async () => {
    for (const by of [{ mono: 4999, wall: 4999 }, { mono: 0, wall: 0 }]) {
      const r = rig();
      r.server.once('/v1/hello', skewDuringHello(r, by));
      expect(await r.client.call('/v1/status', {})).toMatchObject({ ok: true });
    }
  });

  it.each([
    ['the monotonic clock at 5001 and the wall clock at 100', { mono: 5001, wall: 100 }],
    ['the wall clock at 5001 and the monotonic clock at 100', { mono: 100, wall: 5001 }],
    ['both at 5001', { mono: 5001, wall: 5001 }],
    ['the wall clock at -1 (set back) and the monotonic clock at 100', { mono: 100, wall: -1 }],
    ['the wall clock far back (a clock change)', { mono: 100, wall: -3_600_000 }],
    ['the monotonic clock at 5001 and the wall clock back', { mono: 5001, wall: -50 }],
    ['the monotonic clock at 1 hour (a sleep it did not count) and the wall clock at 100', { mono: 3_600_000, wall: 100 }],
  ])('%s: stale_proof, one log entry, no Authorization', async (_name, by) => {
    const r = rig();
    r.server.once('/v1/hello', skewDuringHello(r, by));
    const res = await r.client.call('/v1/status', {});
    expect(res).toEqual({ ok: false, kind: 'stale_proof' });
    expect(r.net.log).toHaveLength(1);
    expect(noAuthorization(r.net)).toBe(true);
    expect(r.store.removed).toEqual([]);
    expect(r.store.current).toEqual(makeRecord());
  });

  it('the wall clock at exactly 0 ms and at -1 ms: 0 is fine, -1 is stale', async () => {
    const ok = rig();
    ok.server.once('/v1/hello', skewDuringHello(ok, { mono: 100, wall: 0 }));
    expect(await ok.client.call('/v1/status', {})).toMatchObject({ ok: true });
    const bad = rig();
    bad.server.once('/v1/hello', skewDuringHello(bad, { mono: 100, wall: -1 }));
    expect(await bad.client.call('/v1/status', {})).toEqual({ ok: false, kind: 'stale_proof' });
  });

  it('is counted from the nonce, not from the hello body being read (the time passes before the answer)', async () => {
    const r = rig();
    r.server.once('/v1/hello', async (req) => {
      r.clock.skew({ mono: 5001, wall: 5001 });
      return helloProof()(req);
    });
    expect(await r.client.call('/v1/status', {})).toEqual({ ok: false, kind: 'stale_proof' });
  });

  it('is checked just before the request, after the proof is verified (time passes while verifying)', async () => {
    const r = rig();
    r.spy.hooks.afterVerify = () => r.clock.skew({ mono: 5001, wall: 5001 });
    expect(await r.client.call('/v1/status', {})).toEqual({ ok: false, kind: 'stale_proof' });
    expect(r.net.log).toHaveLength(1);
    expect(noAuthorization(r.net)).toBe(true);
  });

  it('a second call never reuses a proof: it makes a new nonce and a new hello', async () => {
    const r = rig();
    r.server.once('/v1/hello', skewDuringHello(r, { mono: 5001, wall: 5001 }));
    expect(await r.client.call('/v1/status', {})).toEqual({ ok: false, kind: 'stale_proof' });
    expect(await r.client.call('/v1/status', {})).toMatchObject({ ok: true });
    const hellos = r.net.log.filter((x) => x.path === '/v1/hello');
    expect(hellos).toHaveLength(2);
    expect(new Set(hellos.map((h) => (h.bodyJson as { nonce: string }).nonce)).size).toBe(2);
    expect(r.net.log.filter((x) => x.authorization !== undefined)).toHaveLength(1);
  });

  it('an old proof replayed for a new nonce is a wrong proof: no Authorization', async () => {
    const r = rig();
    let first = '';
    r.server.once('/v1/hello', (req) => {
      first = rightProofOf(req);
      return 'default';
    });
    expect(await r.client.call('/v1/status', {})).toMatchObject({ ok: true });
    r.server.once('/v1/hello', () => json(200, { proof: first }));
    expect(await r.client.call('/v1/status', {})).toEqual(NOT_FOUND);
    expect(r.net.log.filter((x) => x.authorization !== undefined)).toHaveLength(1);
  });
});

describe('call: after a right proof', () => {
  it('a 200 JSON object is ok, with that object as the value', async () => {
    const r = rig();
    const value = { a: 1, nested: { b: [1, 2, { c: null }] }, s: 'é€' };
    r.server.once('/v1/x', json(200, value));
    expect(await r.client.call('/v1/x', {})).toEqual({ ok: true, value });
  });

  it('a 200 of exactly 64 KiB is ok; one byte more is refused (the cap counts bytes, not characters)', async () => {
    const ok = rig();
    ok.server.once('/v1/x', { kind: 'text', status: 200, text: padJson({ a: 1 }, BODY_LIMIT) });
    expect(await ok.client.call('/v1/x', {})).toEqual({ ok: true, value: { a: 1 } });
    const over = rig();
    over.server.once('/v1/x', { kind: 'text', status: 200, text: padJson({ a: 1 }, BODY_LIMIT + 1) });
    expect(await over.client.call('/v1/x', {})).toEqual({ ok: false, kind: 'refused', status: 200, token: null });
    const wide = rig();
    wide.server.once('/v1/x', json(200, bodyOfBytes(BODY_LIMIT)));
    expect(await wide.client.call('/v1/x', {})).toMatchObject({ ok: true });
    const wideOver = rig();
    wideOver.server.once('/v1/x', json(200, bodyOfBytes(BODY_LIMIT + 1)));
    expect(await wideOver.client.call('/v1/x', {})).toEqual({ ok: false, kind: 'refused', status: 200, token: null });
  });

  // Amendment 1 (AM-4): `refused` with status 200 and token null now means only a 200 whose body is NOT JSON (no body, over the cap,
  // not valid UTF-8, a syntax error). A 200 whose body is valid JSON but not a plain object is `wrong_shape` (table below).
  it.each([
    ['not JSON', text(200, 'plain text')],
    ['an empty body', text(200, '')],
    ['a null body', nullBody(200)],
    ['an endless body', infinite(200)],
  ])('a 200 with %s: refused, status 200, token null', async (_name, answer) => {
    const r = rig();
    r.server.once('/v1/x', answer);
    const res = await r.client.call('/v1/x', {});
    expect(res).toEqual({ ok: false, kind: 'refused', status: 200, token: null });
    expect(r.net.log).toHaveLength(2);
  });

  // AM-4: a right proof, then a 200 whose body is valid JSON but not a plain object.
  const NOT_OBJECT: [string, unknown][] = [
    ['a JSON array', [1, 2]],
    ['an empty JSON array', []],
    ['a JSON array holding an object', [{ a: 1 }]],
    ['JSON null', null],
    ['a JSON string', 'x'],
    ['an empty JSON string', ''],
    ['a JSON number', 5],
    ['the JSON number 0', 0],
    ['a JSON boolean true', true],
    ['a JSON boolean false', false],
  ];
  it.each(NOT_OBJECT)('a 200 with %s: wrong_shape (and only that: no status, no token), nothing removed, no retry', async (_name, body) => {
    const r = rig();
    r.server.once('/v1/x', json(200, body));
    const res = await r.client.call('/v1/x', {});
    expect(res).toStrictEqual({ ok: false, kind: 'wrong_shape' });
    expect(r.net.log.map((x) => x.path)).toEqual(['/v1/hello', '/v1/x']);
    expect(r.store.removed).toEqual([]);
    expect(r.store.current).toEqual(makeRecord());
    r.clock.advance(60_000);
    await flush();
    expect(r.net.log).toHaveLength(2);
  });

  it('callWith returns wrong_shape too, removes nothing and is not retried', async () => {
    for (const [, body] of NOT_OBJECT) {
      const r = rig();
      r.server.once('/v1/unpair', json(200, body));
      expect(await r.client.callWith(makeRecord(), '/v1/unpair', {})).toStrictEqual({ ok: false, kind: 'wrong_shape' });
      expect(r.net.log).toHaveLength(2);
      expect(r.store.removed).toEqual([]);
      expect(r.store.current).toEqual(makeRecord());
    }
  });

  it('wrong_shape is only for a 200: the same bodies with another status stay refused with that status and token null', async () => {
    for (const status of [201, 400, 401, 403, 429, 500]) {
      for (const [name, body] of NOT_OBJECT) {
        const r = rig();
        r.server.once('/v1/x', json(status, body));
        expect(await r.client.call('/v1/x', {}), `${status} ${name}`).toEqual({ ok: false, kind: 'refused', status, token: null });
      }
    }
  });

  it('wrong_shape is only after a right proof: a hello 200 that is JSON but not an object is still wrong_program, with one log entry', async () => {
    for (const [name, body] of NOT_OBJECT) {
      const r = rig();
      r.server.once('/v1/hello', json(200, body));
      expect(await r.client.call('/v1/status', {}), name).toEqual(NOT_FOUND);
      expect(r.net.log, name).toHaveLength(1);
      expect(noAuthorization(r.net)).toBe(true);
    }
  });

  it('a 200 that is an object is ok whatever its keys, including an empty object and an object with an array inside (the contrast of wrong_shape)', async () => {
    for (const value of [{}, { a: [] }, { 0: 'x' }]) {
      const r = rig();
      r.server.once('/v1/x', json(200, value));
      expect(await r.client.call('/v1/x', {})).toEqual({ ok: true, value });
    }
  });

  it('an endless 200 body is read for at most a little over 64 KiB', async () => {
    const r = rig();
    r.server.once('/v1/x', infinite(200, 1024));
    await r.client.call('/v1/x', {});
    expect(r.net.log[1]?.pulled).toBeLessThanOrEqual(70);
  });

  const REFUSED: [number, string | null, Answer][] = [
    [401, 'bad_token', json(401, { error: 'bad_token' })],
    [403, 'bad_origin', json(403, { error: 'bad_origin' })],
    [429, 'rate_limited', json(429, { error: 'rate_limited' })],
    [429, 'busy', json(429, { error: 'busy' })],
    [503, 'not_ready', json(503, { error: 'not_ready' })],
    [500, null, text(500, '')],
    [500, null, nullBody(500)],
    [400, 'bad_request', json(400, { error: 'bad_request' })],
    [403, 'bad_host', json(403, { error: 'bad_host' })],
    [404, 'not_found', json(404, { error: 'not_found' })],
    [405, 'method_not_allowed', json(405, { error: 'method_not_allowed' })],
    [415, 'bad_content_type', json(415, { error: 'bad_content_type' })],
    [413, 'too_large', json(413, { error: 'too_large' })],
    [429, null, text(429, 'slow down')],
    [418, null, json(418, { nope: true })],
    [404, null, text(404, '<html>')],
  ];
  it.each(REFUSED)('a %i %s answer: refused with that status and token', async (status, token, answer) => {
    const r = rig();
    r.server.once('/v1/x', answer);
    const res = await r.client.call('/v1/x', {});
    expect(res).toEqual({ ok: false, kind: 'refused', status, token });
    expect(r.net.log).toHaveLength(2);
    expectNoSecrets(res);
  });

  it.each([
    ['an unknown word', { error: 'wat' }],
    ['a number', { error: 123 }],
    ['null', { error: null }],
    ['an array', { error: ['busy'] }],
    ['an object', { error: { busy: true } }],
    ['another key name', { err: 'busy' }],
    ['upper case', { error: 'BUSY' }],
    ['a token with a trailing space', { error: 'busy ' }],
    ['constructor (an inherited property)', { error: 'constructor' }],
    ['__proto__', { error: '__proto__' }],
    ['toString', { error: 'toString' }],
    ['hasOwnProperty', { error: 'hasOwnProperty' }],
    ['valueOf', { error: 'valueOf' }],
  ])('an error token outside the runtime list (%s): token null', async (_n, body) => {
    const r = rig();
    r.server.once('/v1/x', json(400, body));
    expect(await r.client.call('/v1/x', {})).toEqual({ ok: false, kind: 'refused', status: 400, token: null });
  });

  it('status 0 (an opaque redirect): refused, status 0, token null, and no third request', async () => {
    const r = rig();
    r.server.once('/v1/x', opaqueRedirect());
    expect(await r.client.call('/v1/x', {})).toEqual({ ok: false, kind: 'refused', status: 0, token: null });
    expect(r.net.log).toHaveLength(2);
    expect(r.net.log.map((x) => x.path)).toEqual(['/v1/hello', '/v1/x']);
  });

  it.each([
    ['rejects', reject()],
    ['has its body stream error', streamError(200)],
  ])('a token request that %s: app_not_running, no retry', async (_n, answer) => {
    const r = rig();
    r.server.once('/v1/x', answer);
    expect(await r.client.call('/v1/x', {})).toEqual({ ok: false, kind: 'app_not_running' });
    expect(r.net.log).toHaveLength(2);
    expect(r.store.removed).toEqual([]);
  });

  it.each([
    ['no headers', hang()],
    ['a body that never ends', hangBody(200)],
  ])('a token request with %s: pending at 4999 ms, aborted at 5000 ms, app_not_running, no retry', async (_n, answer) => {
    const r = rig();
    r.server.once('/v1/x', answer);
    const t = track(r.client.call('/v1/x', {}));
    await until(() => r.net.log.length === 2);
    expect(r.clock.pending()).toEqual([5000]);
    r.clock.advance(4999);
    await flush();
    expect(t.state).toBe('pending');
    r.clock.advance(1);
    await flush();
    expect(t.value).toEqual({ ok: false, kind: 'app_not_running' });
    expect(r.net.log[1]?.signal?.aborted).toBe(true);
    r.clock.advance(60_000);
    await flush();
    expect(r.net.log).toHaveLength(2);
  });
});

describe('call and the record (E8f, E10)', () => {
  it('no record: not_paired, nothing sent', async () => {
    const r = rig({ record: null });
    expect(await r.client.call('/v1/status', {})).toEqual({ ok: false, kind: 'not_paired' });
    expect(r.net.log).toEqual([]);
  });

  it.each(['storage_blocked', 'storage_failed'] as const)('a store that fails with %s: storage_blocked, nothing sent', async (kind) => {
    const r = rig();
    r.store.failRead = kind;
    expect(await r.client.call('/v1/status', {})).toEqual({ ok: false, kind: 'storage_blocked' });
    expect(r.net.log).toEqual([]);
  });

  it.each([
    [401, 'bad_token'],
    [403, 'bad_origin'],
  ])('a %i %s after a right proof runs store.removeIf(the pairingId used) once', async (status, token) => {
    const r = rig();
    r.server.once('/v1/x', json(status, { error: token }));
    expect(await r.client.call('/v1/x', {})).toEqual({ ok: false, kind: 'refused', status, token });
    expect(r.store.removed).toEqual([PAIRING_ID]);
    expect(r.store.current).toBeNull();
    expect(r.store.clears).toBe(0);
  });

  it('removeIf runs after the answer, not before the request', async () => {
    const r = rig();
    let removedWhenAsked: string[] | null = null;
    r.server.once('/v1/x', () => {
      removedWhenAsked = [...r.store.removed];
      return json(401, { error: 'bad_token' });
    });
    await r.client.call('/v1/x', {});
    expect(removedWhenAsked).toEqual([]);
  });

  it('the same answer when the stored record now has another pairingId: that record stays', async () => {
    const r = rig();
    r.server.once('/v1/x', () => {
      r.store.current = makeRecordB();
      return json(401, { error: 'bad_token' });
    });
    expect(await r.client.call('/v1/x', {})).toMatchObject({ ok: false, kind: 'refused', status: 401 });
    expect(r.store.removed).toEqual([PAIRING_ID]);
    expect(r.store.current).toEqual(makeRecordB());
  });

  // Amendment 1 (AM-1): `call` ignores the result of removeIf; a failing removeIf (a rollback, or unknown) leaves the CallResult as it was.
  it.each([
    ['storage_failed', 401, 'bad_token'],
    ['storage_failed', 403, 'bad_origin'],
    ['storage_unknown', 401, 'bad_token'],
    ['storage_unknown', 403, 'bad_origin'],
  ] as const)('a removeIf that answers %s after a %i %s: the CallResult is unchanged, removeIf ran once, the record stays, no retry', async (kind, status, token) => {
    const r = rig();
    r.store.failRemove = kind;
    r.server.once('/v1/x', json(status, { error: token }));
    expect(await r.client.call('/v1/x', {})).toEqual({ ok: false, kind: 'refused', status, token });
    expect(r.store.removed).toEqual([PAIRING_ID]);
    expect(r.store.current).toEqual(makeRecord());
    expect(r.net.log.map((x) => x.path)).toEqual(['/v1/hello', '/v1/x']);
  });

  it('a removeIf that answers storage_failed does not turn into storage_blocked, wrong_program or anything else for the caller', async () => {
    for (const kind of ['storage_failed', 'storage_unknown'] as const) {
      const r = rig();
      r.store.failRemove = kind;
      r.server.once('/v1/x', json(401, { error: 'bad_token' }));
      const res = await r.client.call('/v1/x', {});
      expect(JSON.stringify(res)).not.toContain('storage');
      // A second call still reads the record and goes through the whole exchange.
      r.server.once('/v1/x', json(200, { fine: true }));
      expect(await r.client.call('/v1/x', {})).toEqual({ ok: true, value: { fine: true } });
    }
  });

  it('only those two answers delete: every other refusal, failure and success leaves the record', async () => {
    const others: Answer[] = [
      json(429, { error: 'rate_limited' }),
      json(429, { error: 'busy' }),
      json(503, { error: 'not_ready' }),
      text(500, ''),
      json(400, { error: 'bad_request' }),
      json(403, { error: 'bad_host' }),
      json(404, { error: 'not_found' }),
      json(405, { error: 'method_not_allowed' }),
      json(415, { error: 'bad_content_type' }),
      json(413, { error: 'too_large' }),
      json(401, { error: 'rate_limited' }),
      json(403, { error: 'bad_token' }),
      opaqueRedirect(),
      reject(),
      streamError(200),
      text(200, 'x'),
      json(200, { fine: true }),
    ];
    for (const answer of others) {
      const r = rig();
      r.server.once('/v1/x', answer);
      await r.client.call('/v1/x', {});
      expect(r.store.removed, JSON.stringify(answer)).toEqual([]);
      expect(r.store.current, JSON.stringify(answer)).toEqual(makeRecord());
    }
  });

  it('callWith never removes anything, even on a 401 bad_token or a 403 bad_origin', async () => {
    for (const [status, token] of [
      [401, 'bad_token'],
      [403, 'bad_origin'],
    ] as const) {
      const r = rig();
      r.server.once('/v1/unpair', json(status, { error: token }));
      expect(await r.client.callWith(makeRecord(), '/v1/unpair', {})).toEqual({ ok: false, kind: 'refused', status, token });
      expect(r.store.removed).toEqual([]);
      expect(r.store.clears).toBe(0);
      expect(r.store.writes).toBe(0);
      expect(r.store.current).toEqual(makeRecord());
    }
  });

  it('callWith uses the record it is given (its token, id and port), not the stored one', async () => {
    const r = rig({ record: makeRecord() });
    const other = makeRecordB();
    const serverB = new FakeServer(PORT_B);
    serverB.addPairing(other);
    r.net.servers.set(PORT_B, serverB);
    const res = await r.client.callWith(other, '/v1/status', {});
    expect(res).toMatchObject({ ok: true });
    expect(r.net.to(PORT)).toEqual([]);
    expect(r.net.to(PORT_B).map((x) => x.path)).toEqual(['/v1/hello', '/v1/status']);
    expect(r.net.to(PORT_B)[0]?.bodyJson).toMatchObject({ pairingId: PAIRING_ID_B });
    expect(r.net.to(PORT_B)[1]?.authorization).toBe(`Bearer ${TOKEN_B}`);
  });

  it('callWith has the same guards, proof and results as call', async () => {
    const r = rig();
    r.server.once('/v1/hello', helloProof({ token: TOKEN_B }));
    expect(await r.client.callWith(makeRecord(), '/v1/unpair', {})).toEqual(NOT_FOUND);
    expect(noAuthorization(r.net)).toBe(true);
    r.server.pairings.clear();
    expect(await r.client.callWith(makeRecord(), '/v1/unpair', {})).toEqual({ ok: false, kind: 'unpaired' });
    const g = rig();
    expect(await thrown(() => g.client.callWith(makeRecord(), '/v1/pair', {}))).toBeInstanceOf(Error);
    expect(g.net.log).toEqual([]);
    expect(await g.client.callWith(makeRecord(), '/v1/x', bodyOfBytes(BODY_LIMIT + 1))).toEqual({ ok: false, kind: 'too_large_local' });
    expect(g.net.log).toEqual([]);
  });
});

describe('call: guards (nothing sent)', () => {
  const BAD_PATHS: unknown[] = [
    '/v1/pair',
    '/v1/hello',
    '/v1/',
    '/v1',
    'v1/status',
    '/v2/status',
    '/V1/status',
    '/v1/Status',
    '/v1/status?x=1',
    '/v1/status#h',
    '/v1/sta tus',
    '/v1/status\n',
    '/v1/status/\u0000',
    '',
    '/v1/a-b',
    '/v1/a_b',
    '/v1/a1',
    '/v1/a.b',
    '/v1/../x',
    '/v1/ä',
    'http://127.0.0.1:38917/v1/status',
    '//evil.example/v1/status',
    undefined,
    null,
    5,
    {},
    ['/v1/status'],
  ];

  it.each(BAD_PATHS.map((p) => [typeof p === 'string' ? JSON.stringify(p) : String(p), p]))('the path %s throws a fixed message and sends nothing', async (_n, p) => {
    const r = rig();
    const e = await thrown(() => r.client.call(p as string, {}));
    expect(e).toBeInstanceOf(Error);
    const message = (e as Error).message;
    expect(typeof message).toBe('string');
    if (typeof p === 'string' && p.length > 0) expect(message).not.toContain(p);
    expectNoSecrets(message);
    expect(r.net.log).toEqual([]);
    const w = await thrown(() => r.client.callWith(makeRecord(), p as string, {}));
    expect(w).toBeInstanceOf(Error);
    expect(r.net.log).toEqual([]);
  });

  it('the message is the same for every bad path (it is fixed)', async () => {
    const r = rig();
    const messages = new Set<string>();
    for (const p of ['/v1/pair', '/v1/hello', '/nope', 'x']) messages.add(((await thrown(() => r.client.call(p, {}))) as Error).message);
    expect(messages.size).toBe(1);
  });

  it.each(['/v1/status', '/v1/x', '/v1/a/b', '/v1/handoff', '/v1/unpair', '/v1/abcdefghijklmnopqrstuvwxyz', '/v1/a//b', '/v1/pairs', '/v1/hello/x', '/v1/pair/x'])('the path %s is allowed and is requested', async (path) => {
    const r = rig();
    await r.client.call(path, {});
    expect(r.net.log.map((x) => x.path)).toEqual(['/v1/hello', path]);
  });

  it('a body of BODY_LIMIT + 1 UTF-8 bytes: too_large_local, nothing sent; exactly BODY_LIMIT is sent', async () => {
    const over = rig();
    expect(await over.client.call('/v1/x', bodyOfBytes(BODY_LIMIT + 1))).toEqual({ ok: false, kind: 'too_large_local' });
    expect(over.net.log).toEqual([]);
    const exact = rig();
    await exact.client.call('/v1/x', bodyOfBytes(BODY_LIMIT));
    expect(exact.net.log.map((x) => x.path)).toEqual(['/v1/hello', '/v1/x']);
    expect(exact.net.log[1]?.bodyBytes).toBe(BODY_LIMIT);
    const small = rig();
    await small.client.call('/v1/x', bodyOfBytes(BODY_LIMIT - 1));
    expect(small.net.log).toHaveLength(2);
  });

  it('the size is counted in UTF-8 bytes of the JSON, not in UTF-16 units', async () => {
    const r = rig();
    const body = bodyOfBytes(BODY_LIMIT + 1);
    expect(JSON.stringify(body).length).toBeLessThan(BODY_LIMIT);
    expect(await r.client.call('/v1/x', body)).toEqual({ ok: false, kind: 'too_large_local' });
    expect(r.net.log).toEqual([]);
  });

  it('with limits { "/v1/x": 100 }, 101 bytes to /v1/x are refused and 100 are sent; another path keeps BODY_LIMIT', async () => {
    const r = rig({ limits: { '/v1/x': 100 } });
    expect(await r.client.call('/v1/x', bodyOfBytes(101))).toEqual({ ok: false, kind: 'too_large_local' });
    expect(r.net.log).toEqual([]);
    await r.client.call('/v1/x', bodyOfBytes(100));
    expect(r.net.log.map((x) => x.path)).toEqual(['/v1/hello', '/v1/x']);
    await r.client.call('/v1/y', bodyOfBytes(101));
    expect(r.net.log.map((x) => x.path)).toEqual(['/v1/hello', '/v1/x', '/v1/hello', '/v1/y']);
    expect(await r.client.call('/v1/y', bodyOfBytes(BODY_LIMIT + 1))).toEqual({ ok: false, kind: 'too_large_local' });
  });

  it('with limits { "/v1/handoff": LARGE_BODY_LIMIT }, that path takes a large body and no other does', async () => {
    const r = rig({ limits: { '/v1/handoff': LARGE_BODY_LIMIT } });
    await r.client.call('/v1/handoff', bodyOfBytes(LARGE_BODY_LIMIT));
    expect(r.net.log.map((x) => x.path)).toEqual(['/v1/hello', '/v1/handoff']);
    expect(r.net.log[1]?.bodyBytes).toBe(LARGE_BODY_LIMIT);
    expect(await r.client.call('/v1/handoff', bodyOfBytes(LARGE_BODY_LIMIT + 1))).toEqual({ ok: false, kind: 'too_large_local' });
    expect(await r.client.call('/v1/x', bodyOfBytes(BODY_LIMIT + 1))).toEqual({ ok: false, kind: 'too_large_local' });
    expect(r.net.log).toHaveLength(2);
  });

  it('a limit for a path does not leak to the paths of the Object prototype or to a prefix', async () => {
    const r = rig({ limits: { '/v1/x': 100 } });
    expect(await r.client.call('/v1/xy', bodyOfBytes(101))).toMatchObject({ ok: false, kind: 'refused' });
    expect(await r.client.call('/v1/x/y', bodyOfBytes(101))).toMatchObject({ ok: false, kind: 'refused' });
  });

  it('with a marker token stored, no thrown or rejected error message holds the marker, the pairingId or the port', async () => {
    const r = rig();
    const errors: unknown[] = [];
    for (const p of ['/v1/pair', '/v1/hello', '/nope', undefined]) {
      errors.push(await thrown(() => r.client.call(p as string, {})));
      errors.push(await thrown(() => r.client.callWith(makeRecord(), p as string, {})));
    }
    expect(errors.every((e) => e instanceof Error)).toBe(true);
    for (const e of errors) {
      const m = (e as Error).message;
      for (const secret of [...MARKERS, TOKEN, PAIRING_ID, String(PORT), `${PORT}`]) expect(m).not.toContain(secret);
      expect(String((e as Error).stack ?? '').split('\n')[0]).not.toContain(TOKEN);
    }
  });

  it('no call ever rejects for a network or server reason: every such outcome is a result', async () => {
    const answers: Answer[] = [reject(`boom ${TOKEN}`), streamError(200), text(200, 'x'), opaqueRedirect(), json(500, {}), nullBody(200)];
    for (const a of answers) {
      const r = rig();
      r.server.once('/v1/hello', a);
      await expect(r.client.call('/v1/x', {})).resolves.toBeTypeOf('object');
      const q = rig();
      q.server.once('/v1/x', a);
      await expect(q.client.call('/v1/x', {})).resolves.toBeTypeOf('object');
    }
  });
});

describe('pair (E4, E8, E11)', () => {
  const pairRig = (): Rig => {
    const r = rig({ record: null });
    r.server.openCode('ABCDEFGH');
    return r;
  };
  const pairBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    pairingId: PAIRING_ID,
    token: TOKEN,
    protocol: 1,
    appVersion: '0.1.0',
    ...over,
  });

  it('sends one request to the given port with the body exactly { code, label } and no Authorization', async () => {
    const r = pairRig();
    const res = await r.client.pair(PORT, 'ABCDEFGH', 'My laptop');
    expect(res).toMatchObject({ ok: true });
    expect(r.net.log).toHaveLength(1);
    const req = r.net.log[0];
    expect(req?.url).toBe(`http://127.0.0.1:${PORT}/v1/pair`);
    expect(req?.bodyJson).toEqual({ code: 'ABCDEFGH', label: 'My laptop' });
    expect(Object.keys(req?.bodyJson as object).sort()).toEqual(['code', 'label']);
    expect(req?.authorization).toBeUndefined();
    if (req) expectCommonInit(req);
    expect(r.clock.pending()).toEqual([]);
  });

  it('dials the port it is given, whatever the port of any stored record', async () => {
    const r = rig({ record: makeRecord() });
    const other = new FakeServer(PORT_B);
    other.openCode('ABCDEFGH');
    r.net.servers.set(PORT_B, other);
    expect(await r.client.pair(PORT_B, 'ABCDEFGH', 'x')).toMatchObject({ ok: true });
    expect(r.net.to(PORT)).toEqual([]);
    expect(r.net.log[0]?.url).toBe(`http://127.0.0.1:${PORT_B}/v1/pair`);
  });

  it('a 200 with valid fields is { ok: true, pairingId, token, appVersion } and stores nothing itself', async () => {
    const r = pairRig();
    r.server.issue = { token: TOKEN, pairingId: PAIRING_ID };
    expect(await r.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual({ ok: true, pairingId: PAIRING_ID, token: TOKEN, appVersion: '0.1.0' });
    expect(r.store.writes).toBe(0);
    expect(r.store.reads).toBe(0);
  });

  it('a 200 of exactly 64 KiB is accepted; one byte more is wrong_program', async () => {
    const ok = pairRig();
    ok.server.once('/v1/pair', { kind: 'text', status: 200, text: padJson(pairBody(), BODY_LIMIT) });
    expect(await ok.client.pair(PORT, 'ABCDEFGH', 'x')).toMatchObject({ ok: true });
    const over = pairRig();
    over.server.once('/v1/pair', { kind: 'text', status: 200, text: padJson(pairBody(), BODY_LIMIT + 1) });
    expect(await over.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual(NOT_FOUND);
  });

  it('appVersion of 64 units is accepted, 65 is a mismatch', async () => {
    const ok = pairRig();
    ok.server.once('/v1/pair', json(200, pairBody({ appVersion: 'v'.repeat(64) })));
    expect(await ok.client.pair(PORT, 'ABCDEFGH', 'x')).toMatchObject({ ok: true, appVersion: 'v'.repeat(64) });
    const bad = pairRig();
    bad.server.once('/v1/pair', json(200, pairBody({ appVersion: 'v'.repeat(65) })));
    expect(await bad.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual({ ok: false, kind: 'mismatch', pairingId: PAIRING_ID, token: TOKEN });
  });

  const WRONG_PROGRAM: [string, Answer][] = [
    ['a 42-character token', json(200, pairBody({ token: 'a'.repeat(42) }))],
    ['a 44-character token', json(200, pairBody({ token: 'a'.repeat(44) }))],
    ['a token outside the alphabet', json(200, pairBody({ token: `${'a'.repeat(42)}+` }))],
    ['a numeric token', json(200, pairBody({ token: 1 }))],
    ['a missing token', json(200, { pairingId: PAIRING_ID, protocol: 1, appVersion: '0.1.0' })],
    ['a 21-character pairingId', json(200, pairBody({ pairingId: 'a'.repeat(21) }))],
    ['a 23-character pairingId', json(200, pairBody({ pairingId: 'a'.repeat(23) }))],
    ['a pairingId outside the alphabet', json(200, pairBody({ pairingId: `${'a'.repeat(21)}=` }))],
    ['a missing pairingId', json(200, { token: TOKEN, protocol: 1, appVersion: '0.1.0' })],
    ['a body that is not JSON', text(200, 'hello')],
    ['an empty body', text(200, '')],
    ['a null body', nullBody(200)],
    ['a JSON array', json(200, [pairBody()])],
    ['JSON null', json(200, null)],
    ['an endless body', infinite(200)],
    ['status 0 (an opaque redirect)', opaqueRedirect()],
    ['a 500', json(500, { error: 'not_ready' })],
    ['a bare 500', text(500, '')],
    ['a 404 not_found', json(404, { error: 'not_found' })],
    ['a bare 404', text(404, '')],
    ['a 403 bad_origin', json(403, { error: 'bad_origin' })],
    ['a 401 bad_token', json(401, { error: 'bad_token' })],
    ['a 429 rate_limited', json(429, { error: 'rate_limited' })],
    ['a 503 not_ready', json(503, { error: 'not_ready' })],
    ['a 405', json(405, { error: 'method_not_allowed' })],
    ['a 415', json(415, { error: 'bad_content_type' })],
    ['a 413', json(413, { error: 'too_large' })],
    ['a 201 with valid fields', json(201, pairBody())],
    ['a 204', nullBody(204)],
    ['a 302 with valid fields', json(302, pairBody())],
  ];
  it.each(WRONG_PROGRAM)('%s: wrong_program', async (_n, answer) => {
    const r = pairRig();
    r.server.once('/v1/pair', answer);
    expect(await r.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual(NOT_FOUND);
    expect(r.net.log).toHaveLength(1);
  });

  const MISMATCH: [string, Record<string, unknown>][] = [
    ['protocol 2', pairBody({ protocol: 2 })],
    ['protocol 0', pairBody({ protocol: 0 })],
    ['protocol "1"', pairBody({ protocol: '1' })],
    ['protocol missing', { pairingId: PAIRING_ID, token: TOKEN, appVersion: '0.1.0' }],
    ['an empty appVersion', pairBody({ appVersion: '' })],
    ['a 65-unit appVersion', pairBody({ appVersion: 'v'.repeat(65) })],
    ['an appVersion with a control character', pairBody({ appVersion: '0.1\u0000' })],
    ['an appVersion with a bidi character', pairBody({ appVersion: '0.1‮' })],
    ['a numeric appVersion', pairBody({ appVersion: 0.1 })],
    ['an appVersion missing', { pairingId: PAIRING_ID, token: TOKEN, protocol: 1 }],
    ['an extra key', pairBody({ extra: 1 })],
    ['an extra key called app', pairBody({ app: 'fetchly' })],
  ];
  it.each(MISMATCH)('valid token and pairingId but %s: mismatch, carrying the new credentials', async (_n, body) => {
    const r = pairRig();
    r.server.once('/v1/pair', json(200, body));
    expect(await r.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual({ ok: false, kind: 'mismatch', pairingId: PAIRING_ID, token: TOKEN });
    expect(r.net.log).toHaveLength(1);
  });

  it.each([
    [401, 'bad_code'],
    [403, 'pairing_closed'],
    [400, 'bad_request'],
  ])('%i %s is returned as its token', async (status, token) => {
    const r = pairRig();
    r.server.once('/v1/pair', json(status, { error: token }));
    expect(await r.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual({ ok: false, kind: 'refused', status, token });
  });

  it('a wrong code and a closed pairing come from the real fake-server rules', async () => {
    const r = pairRig();
    expect(await r.client.pair(PORT, 'ZZZZZZZZ', 'x')).toEqual({ ok: false, kind: 'refused', status: 401, token: 'bad_code' });
    const closed = rig({ record: null });
    expect(await closed.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual({ ok: false, kind: 'refused', status: 403, token: 'pairing_closed' });
    const bad = pairRig();
    expect(await bad.client.pair(PORT, 'ABCDEFGH', 'a\u0001b')).toEqual({ ok: false, kind: 'refused', status: 400, token: 'bad_request' });
  });

  it.each([
    ['rejects', reject()],
    ['has its body stream error', streamError(200)],
  ])('a request that %s: app_not_running', async (_n, answer) => {
    const r = pairRig();
    r.server.once('/v1/pair', answer);
    expect(await r.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual({ ok: false, kind: 'app_not_running' });
    expect(r.net.log).toHaveLength(1);
  });

  it.each([
    ['no headers', hang()],
    ['a body that never ends', hangBody(200)],
  ])('a request with %s: pending at 4999 ms, aborted at 5000 ms, app_not_running', async (_n, answer) => {
    const r = pairRig();
    r.server.once('/v1/pair', answer);
    const t = track(r.client.pair(PORT, 'ABCDEFGH', 'x'));
    await flush();
    r.clock.advance(4999);
    await flush();
    expect(t.state).toBe('pending');
    r.clock.advance(1);
    await flush();
    expect(t.value).toEqual({ ok: false, kind: 'app_not_running' });
    expect(r.net.log[0]?.signal?.aborted).toBe(true);
    expect(r.net.log).toHaveLength(1);
  });

  it('nothing listens on the port: app_not_running', async () => {
    const r = pairRig();
    r.net.servers.clear();
    expect(await r.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual({ ok: false, kind: 'app_not_running' });
  });

  // Amendment 1 (AM-4): a pair 200 that is JSON but not an object is NOT wrong_shape (that is for call and callWith after a right
  // proof); at pair it stays wrong_program, like any 200 that does not hold the pairing.
  it.each([
    ['JSON null', json(200, null)],
    ['a JSON string', json(200, 'x')],
    ['a JSON number', json(200, 5)],
    ['JSON true', json(200, true)],
    ['an empty JSON array', json(200, [])],
  ])('a 200 with %s: wrong_program, not wrong_shape', async (_n, answer) => {
    const r = pairRig();
    r.server.once('/v1/pair', answer);
    expect(await r.client.pair(PORT, 'ABCDEFGH', 'x')).toStrictEqual({ ok: false, kind: 'wrong_program' });
    expect(r.net.log).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Amendment 1 (AM-6): a body that is not valid UTF-8 is not JSON, even where a lenient decoder would still parse it. Each bad sequence
// sits inside a string value that a later duplicate key overrides, so a lenient decode (U+FFFD) followed by JSON.parse would accept the
// body and take the LAST value; only a strict decode refuses it. The bytes go out raw (fakeFetch `bytes`), never through a TextEncoder.

describe('malformed UTF-8 in a response body (AM-6)', () => {
  const enc = (s: string): number[] => [...new TextEncoder().encode(s)];
  /** Raw bytes from strings and byte lists, in order. */
  const raw = (...parts: (string | number[])[]): Uint8Array => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? enc(p) : p)));
  const BAD_UTF8: [string, number[]][] = [
    ['FF', [0xff]],
    ['a lone C3', [0xc3]],
    ['ED A0 80 (an encoded surrogate)', [0xed, 0xa0, 0x80]],
  ];

  it.each(BAD_UTF8)('control: %s is invalid UTF-8, and a lenient decode of the bodies below would still parse them', (_n, bad) => {
    const body = raw('{"a":"', bad, '","a":"ok"}');
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(body)).toThrow();
    expect(JSON.parse(new TextDecoder().decode(body))).toEqual({ a: 'ok' });
    expect(bytes(200, body)).toEqual({ kind: 'bytes', status: 200, bytes: body });
  });

  it('control: the same bodies with valid UTF-8 are accepted (so a refusal below is the bad bytes, not the shape)', async () => {
    const hello = rig();
    hello.server.once('/v1/hello', (req) => bytes(200, raw('{"proof":"x","proof":"', rightProofOf(req), '"}')));
    hello.server.once('/v1/x', bytes(200, raw('{"a":"é€"}')));
    expect(await hello.client.call('/v1/x', {})).toEqual({ ok: true, value: { a: 'é€' } });
    const pair = rig({ record: null });
    pair.server.once('/v1/pair', bytes(200, raw('{"pairingId":"', PAIRING_ID, '","token":"', TOKEN, '","protocol":1,"appVersion":"9","appVersion":"0.1.0"}')));
    expect(await pair.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual({ ok: true, pairingId: PAIRING_ID, token: TOKEN, appVersion: '0.1.0' });
  });

  it.each(BAD_UTF8)('hello {"proof":"<%s>","proof":"<valid>"}: wrong_program, one log entry, no Authorization', async (_n, bad) => {
    const r = rig();
    r.server.once('/v1/hello', (req) => bytes(200, raw('{"proof":"', bad, '","proof":"', rightProofOf(req), '"}')));
    expect(await r.client.call('/v1/status', {})).toEqual(NOT_FOUND);
    expect(r.net.log).toHaveLength(1);
    expect(noAuthorization(r.net)).toBe(true);
    expect(r.store.removed).toEqual([]);
  });

  it.each(BAD_UTF8)('hello 404 {"error":"<%s>","error":"unknown_pairing"}: wrong_program, not unpaired', async (_n, bad) => {
    const r = rig();
    r.server.once('/v1/hello', bytes(404, raw('{"error":"', bad, '","error":"unknown_pairing"}')));
    expect(await r.client.call('/v1/status', {})).toEqual(NOT_FOUND);
    expect(r.net.log).toHaveLength(1);
  });

  it.each(BAD_UTF8)('pair 200 with "appVersion":"<%s>","appVersion":"0.1.0": wrong_program', async (_n, bad) => {
    const r = rig({ record: null });
    r.server.once('/v1/pair', bytes(200, raw('{"pairingId":"', PAIRING_ID, '","token":"', TOKEN, '","protocol":1,"appVersion":"', bad, '","appVersion":"0.1.0"}')));
    expect(await r.client.pair(PORT, 'ABCDEFGH', 'x')).toEqual(NOT_FOUND);
    expect(r.net.log).toHaveLength(1);
  });

  it.each(BAD_UTF8)('call 200 {"a":"<%s>"}: refused, status 200, token null (not ok, not wrong_shape)', async (_n, bad) => {
    const r = rig();
    r.server.once('/v1/x', bytes(200, raw('{"a":"', bad, '"}')));
    expect(await r.client.call('/v1/x', {})).toEqual({ ok: false, kind: 'refused', status: 200, token: null });
    expect(r.net.log).toHaveLength(2);
  });

  it.each(BAD_UTF8)('callWith 200 {"a":"<%s>"}: refused, status 200, token null', async (_n, bad) => {
    const r = rig();
    r.server.once('/v1/unpair', bytes(200, raw('{"a":"', bad, '"}')));
    expect(await r.client.callWith(makeRecord(), '/v1/unpair', {})).toEqual({ ok: false, kind: 'refused', status: 200, token: null });
  });

  it.each(BAD_UTF8)('401 {"error":"<%s>","error":"bad_token"}: refused with token null, and the record is NOT removed', async (_n, bad) => {
    const r = rig();
    r.server.once('/v1/x', bytes(401, raw('{"error":"', bad, '","error":"bad_token"}')));
    expect(await r.client.call('/v1/x', {})).toEqual({ ok: false, kind: 'refused', status: 401, token: null });
    expect(r.store.removed).toEqual([]);
    expect(r.store.current).toEqual(makeRecord());
  });
});
