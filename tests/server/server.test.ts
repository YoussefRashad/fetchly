// A1 Task 6: the listener, the HTTP parsing rules and the check order, on real node:http (127.0.0.1) with raw
// `net` sockets. Task 6b (the preflight fallback) is not written: P4 showed no preflight.
//
// Enumeration (header-like things the plan names, section 3):
//  - headers refused when they appear twice, counted in rawHeaders: Host, Origin, Authorization, Content-Type.
//  - headers Node refuses itself (bare 400): duplicate Content-Length, Content-Length with Transfer-Encoding.
//  - headers the app refuses: Transfer-Encoding (any value, any method), a missing Content-Length (POST only).
//  - response headers on every app answer: Content-Type application/json, Cache-Control no-store, Connection close;
//    never any Access-Control-*.
//  - request deadlines and limits: maxHeaderSize 8192, headersTimeout 5000, requestTimeout 10000,
//    connectionsCheckingInterval 1000, maxConnections 16, body limits 65536 and 524288 (per route).
//  - check order rows 1..7 of the plan, each tested with every later step also broken.
import http from 'node:http';
import { createHash, randomBytes as cryptoRandomBytes, timingSafeEqual } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../../src/main/server/routes';
import { sleep } from '../wait';
import { ORIGIN_A, ORIGIN_B, originOf } from './fakes';
import { RawConn, buildRequest, rawRequest, send, type Header, type RawReply, type RequestSpec } from './rawHttp';
import { bootServer, stopAll, type BootOptions, type Booted } from './rig';

afterEach(async () => {
  vi.restoreAllMocks();
  await stopAll();
});

// ---------------------------------------------------------------------------------------------------------
// Fixtures

type Ctx = Parameters<Route['handle']>[0];

function fakeRoutes() {
  const seen: { path: string; ctx: Ctx }[] = [];
  const mk = (path: string, auth: Route['auth'], bodyLimit: number, handle?: Route['handle']): Route => ({
    path,
    auth,
    bodyLimit,
    handle:
      handle ??
      ((ctx) => {
        seen.push({ path, ctx });
        return { status: 200, body: { ok: true } };
      }),
  });
  const routes: Route[] = [
    mk('/v1/test', 'token', 65536),
    mk('/v1/large', 'token', 524288),
    mk('/v1/open', 'none', 65536),
    mk('/v1/boom', 'token', 65536, () => {
      throw new RangeError('SECRET-DETAIL-ZZ');
    }),
    mk('/v1/reject', 'token', 65536, () => Promise.reject(new TypeError('SECRET-DETAIL-ZZ'))),
  ];
  return { routes, seen };
}

interface Rig {
  b: Booted;
  seen: { path: string; ctx: Ctx }[];
  port: number;
  token: string;
  pairingId: string;
}

async function setup(over: BootOptions = {}): Promise<Rig> {
  const fk = fakeRoutes();
  const b = await bootServer({ routes: fk.routes, ...over });
  const p = b.pair({ origin: ORIGIN_A });
  return { b, seen: fk.seen, port: b.port(), token: p.token, pairingId: p.pairingId };
}

interface Mods {
  host?: string | null;
  origin?: string | null;
  /** Raw Authorization header value; null = no header. */
  auth?: string | null;
  contentType?: string | null;
  contentLength?: number | null;
  method?: string;
  target?: string;
  version?: string;
  body?: string | Buffer;
  headers?: Header[];
  keepAlive?: boolean;
}

/** A request the way the extension sends it (P4): exact Host, Origin, Authorization, JSON, Content-Length, keep-alive. */
function spec(r: Rig, m: Mods = {}): RequestSpec {
  const body = m.body ?? '{}';
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const h: Header[] = [];
  const host = m.host === undefined ? `127.0.0.1:${r.port}` : m.host;
  if (host !== null) h.push(['Host', host]);
  const origin = m.origin === undefined ? ORIGIN_A : m.origin;
  if (origin !== null) h.push(['Origin', origin]);
  const auth = m.auth === undefined ? `Bearer ${r.token}` : m.auth;
  if (auth !== null) h.push(['Authorization', auth]);
  const ct = m.contentType === undefined ? 'application/json' : m.contentType;
  if (ct !== null) h.push(['Content-Type', ct]);
  const cl = m.contentLength === undefined ? buf.length : m.contentLength;
  if (cl !== null) h.push(['Content-Length', String(cl)]);
  if (m.keepAlive !== false) h.push(['Connection', 'keep-alive']);
  h.push(...(m.headers ?? []));
  return { method: m.method ?? 'POST', target: m.target ?? '/v1/test', version: m.version, headers: h, body: buf };
}

const call = (r: Rig, m: Mods = {}, waitMs = 4000): Promise<RawReply> => send(r.port, spec(r, m), { waitMs });
/** Like call, but waits for the server to close the connection. */
const callClosed = (r: Rig, m: Mods = {}): Promise<RawReply> => send(r.port, spec(r, m), { untilClosed: true });

function expectAppHeaders(reply: RawReply): void {
  // Exactly one header, exactly this value: writeJsonHead sets it, so a charset suffix or a second copy is a regression.
  expect(reply.headers.get('content-type'), 'content-type').toEqual(['application/json']);
  expect(reply.headers.get('cache-control'), 'cache-control').toEqual(['no-store']);
  expect(reply.headers.get('connection')?.[0]?.toLowerCase(), 'connection').toBe('close');
  for (const name of reply.headers.keys()) expect(name.startsWith('access-control-'), `CORS header ${name}`).toBe(false);
}

function expectError(reply: RawReply, status: number, token: string): void {
  expect(reply.status, reply.text.slice(0, 200)).toBe(status);
  expect(JSON.parse(reply.body)).toEqual({ error: token });
  expectAppHeaders(reply);
}

/** Node's own refusal: a status line and no JSON body. */
function expectBare(reply: RawReply, status: number): void {
  expect(reply.status, reply.text.slice(0, 200)).toBe(status);
  expect(reply.body).toBe('');
  expect(reply.headers.has('content-type')).toBe(false);
}

const jsonBody = (bytes: number, filler = 'a'): string => `{"p":"${filler.repeat(bytes - 8)}"}`; // exactly `bytes` ASCII bytes

// ---------------------------------------------------------------------------------------------------------

describe('a request the extension sends (P4 facts)', () => {
  it('is answered 200 with the handler body and the app headers, and the handler sees body, origin, pairing and port', async () => {
    const r = await setup();
    const reply = await call(r, { body: '{"a":1,"list":[1,2]}' });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ ok: true });
    expectAppHeaders(reply);
    expect(r.seen).toHaveLength(1);
    const ctx = r.seen[0]?.ctx;
    expect(ctx?.body).toEqual({ a: 1, list: [1, 2] });
    expect(ctx?.origin).toBe(ORIGIN_A);
    expect(ctx?.port).toBe(r.port);
    expect(ctx?.pairing?.id).toBe(r.pairingId);
    expect(ctx?.pairing?.origin).toBe(ORIGIN_A);
  });

  it('a route with auth none runs for any extension-shaped origin and gets pairing null', async () => {
    const r = await setup();
    const reply = await call(r, { target: '/v1/open', origin: originOf('p'), auth: null });
    expect(reply.status).toBe(200);
    expect(r.seen[0]?.ctx.pairing).toBeNull();
    expect(r.seen[0]?.ctx.origin).toBe(originOf('p'));
  });

  it('a route with auth none ignores an Authorization header it does not need (no 401)', async () => {
    const r = await setup();
    const reply = await call(r, { target: '/v1/open', auth: 'Bearer not-a-token' });
    expect(reply.status).toBe(200);
  });

  it('accepts the content types of S9, lowercased and trimmed', async () => {
    const r = await setup();
    for (const ct of ['application/json', 'APPLICATION/JSON', 'Application/Json; Charset=UTF-8', 'application/json; charset=utf-8', '  application/json  ']) {
      const reply = await call(r, { contentType: ct });
      expect(reply.status, ct).toBe(200);
    }
  });

  it('answers on an HTTP/1.0 request that names the right Host', async () => {
    const r = await setup();
    const reply = await call(r, { version: 'HTTP/1.0', keepAlive: false });
    expect(reply.status).toBe(200);
  });

  it('closes the connection after the answer, whatever the request asked (no keep-alive)', async () => {
    const r = await setup();
    const reply = await callClosed(r);
    expect(reply.status).toBe(200);
    expect(reply.closed).toBe(true);
    // two requests in one write: only the first is answered
    const one = buildRequest(spec(r));
    const two = await rawRequest(r.port, Buffer.concat([one, one]), { untilClosed: true });
    expect(two.closed).toBe(true);
    expect(two.text.match(/HTTP\/1\.1 \d{3}/gu) ?? []).toHaveLength(1);
  });

  it('listens on 127.0.0.1 only: the address is IPv4 loopback and the listen call names it', async () => {
    const r = await setup();
    const addr = r.b.servers[0]?.address();
    expect(addr).toMatchObject({ address: '127.0.0.1', family: 'IPv4', port: r.port });
    const first = r.b.listenCalls[0] ?? [];
    const named = first.includes('127.0.0.1') || first.some((a) => typeof a === 'object' && a !== null && (a as { host?: string }).host === '127.0.0.1');
    expect(named).toBe(true);
  });
});

describe('production options (Q21)', () => {
  // Review 2, finding 2: Node's Host precheck is off (requireHostHeader: false), so a missing Host on HTTP/1.1 reaches
  // the app's own Host check (403 bad_host) instead of Node's untracked bare 400; see "no Host on HTTP/1.1" below.
  it('createServer gets maxHeaderSize 8192, headersTimeout 5000, requestTimeout 10000, connectionsCheckingInterval 1000 and requireHostHeader false', async () => {
    const r = await setup();
    expect(r.b.createOptions).toHaveLength(1);
    expect(r.b.createOptions[0]).toMatchObject({ maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10000, connectionsCheckingInterval: 1000, requireHostHeader: false });
  });

  it('maxConnections is 16 on the server', async () => {
    const r = await setup();
    expect(r.b.servers[0]?.maxConnections).toBe(16);
  });

  it('a 17th simultaneous connection is dropped while the first 16 stay open', async () => {
    const r = await setup();
    const open = await Promise.all(Array.from({ length: 16 }, () => new RawConn(r.port).connected()));
    await sleep(100);
    const extra = new RawConn(r.port);
    await extra.waitClosed(2000);
    expect(open.every((c) => !c.closed)).toBe(true);
    for (const c of open) c.destroy();
    extra.destroy();
  });

  it('after the busy ones leave, a new connection is served again', async () => {
    const r = await setup();
    const open = await Promise.all(Array.from({ length: 16 }, () => new RawConn(r.port).connected()));
    for (const c of open) c.destroy();
    await sleep(100);
    const reply = await call(r);
    expect(reply.status).toBe(200);
  });
});

describe('HTTP parsing rules (P12)', () => {
  describe('a header that appears twice is 400 bad_request, counted in rawHeaders', () => {
    // [header, the value the second copy carries]: the same value, and a different one.
    const DUP: [string, string[]][] = [
      ['Host', ['same', 'evil.example']],
      ['Origin', ['same', ORIGIN_B]],
      ['Authorization', ['same', 'Bearer other']],
      ['Content-Type', ['same', 'text/plain']],
    ];
    const CASES = [
      ['the same case', (n: string) => [n, n]],
      ['lower then canonical', (n: string) => [n.toLowerCase(), n]],
      ['upper then lower', (n: string) => [n.toUpperCase(), n.toLowerCase()]],
    ] as const;

    for (const [header, values] of DUP) {
      for (const [caseName, names] of CASES) {
        for (const second of values) {
          it(`${header}, ${caseName}, second copy ${second === 'same' ? 'with the same value' : 'with another value'}`, async () => {
            const r = await setup();
            const base = spec(r);
            const headers = (base.headers ?? []).map((h): Header => h.slice() as Header);
            const idx = headers.findIndex(([n]) => n.toLowerCase() === header.toLowerCase());
            const [first, secondName] = names(header);
            const firstValue = headers[idx]?.[1] ?? '';
            headers[idx] = [first ?? header, firstValue];
            headers.push([secondName ?? header, second === 'same' ? firstValue : second]);
            const reply = await send(r.port, { ...base, headers });
            expectError(reply, 400, 'bad_request');
            expect(r.seen).toHaveLength(0);
          });
        }
      }
    }

    it('a duplicate wins over a wrong Host (the header rules come first)', async () => {
      const r = await setup();
      const reply = await call(r, { host: 'localhost:1', headers: [['host', 'localhost:2']] });
      expectError(reply, 400, 'bad_request');
    });

    it('a duplicate of any other header is fine', async () => {
      const r = await setup();
      const reply = await call(r, { headers: [['X-Test', 'a'], ['X-Test', 'b'], ['Accept', 'a'], ['Accept', 'b']] });
      expect(reply.status).toBe(200);
    });
  });

  it('two Content-Length headers: a bare 400 from Node', async () => {
    const r = await setup();
    const reply = await call(r, { headers: [['Content-Length', '2']] });
    expectBare(reply, 400);
    expect(r.seen).toHaveLength(0);
  });

  it('two Content-Length headers with different values: a bare 400 as well', async () => {
    const r = await setup();
    const reply = await call(r, { headers: [['Content-Length', '5']] });
    expectBare(reply, 400);
  });

  it('Content-Length with Transfer-Encoding: a bare 400 from Node', async () => {
    const r = await setup();
    const reply = await call(r, { headers: [['Transfer-Encoding', 'chunked']], body: '2\r\n{}\r\n0\r\n\r\n', contentLength: 2 });
    expectBare(reply, 400);
    expect(r.seen).toHaveLength(0);
  });

  describe('Transfer-Encoding is refused for every method (S8): 400 bad_request', () => {
    it('a chunked POST (it reaches the handler in Node)', async () => {
      const r = await setup();
      const reply = await call(r, { contentLength: null, headers: [['Transfer-Encoding', 'chunked']], body: '2\r\n{}\r\n0\r\n\r\n' });
      expectError(reply, 400, 'bad_request');
      expect(r.seen).toHaveLength(0);
    });

    it('Transfer-Encoding: identity on a POST', async () => {
      const r = await setup();
      const reply = await call(r, { contentLength: null, headers: [['Transfer-Encoding', 'identity']] });
      expectError(reply, 400, 'bad_request');
      expect(r.seen).toHaveLength(0);
    });

    it('Transfer-Encoding: identity on a GET', async () => {
      const r = await setup();
      const reply = await call(r, { method: 'GET', contentLength: null, body: '', headers: [['Transfer-Encoding', 'identity']] });
      expectError(reply, 400, 'bad_request');
    });

    it('Transfer-Encoding on an OPTIONS is 400 as well (step 1 comes before the preflight answer)', async () => {
      const r = await setup();
      const reply = await call(r, { method: 'OPTIONS', contentLength: null, body: '', headers: [['Transfer-Encoding', 'identity']] });
      expectError(reply, 400, 'bad_request');
    });
  });

  describe('Content-Length (S8)', () => {
    it('a POST without Content-Length is 400 bad_request', async () => {
      const r = await setup();
      const reply = await call(r, { contentLength: null, body: '' });
      expectError(reply, 400, 'bad_request');
      expect(r.seen).toHaveLength(0);
    });

    it('a GET without Content-Length is not refused at step 1: it is 405', async () => {
      const r = await setup();
      const reply = await call(r, { method: 'GET', contentLength: null, body: '' });
      expectError(reply, 405, 'method_not_allowed');
    });

    it('an OPTIONS without Content-Length gets the preflight answer', async () => {
      const r = await setup();
      const reply = await call(r, { method: 'OPTIONS', contentLength: null, body: '' });
      expectError(reply, 403, 'preflight_refused');
    });

    it('a POST with Content-Length: 0 is read as an empty body: 400 bad_request from the body rule', async () => {
      const r = await setup();
      const reply = await call(r, { contentLength: 0, body: '' });
      expectError(reply, 400, 'bad_request');
    });

    // Review 1, coverage gap. The values below were probed one process per case on node 24.14.1 and on Electron
    // 45.4.1 (node 24.22.3, ELECTRON_RUN_AS_NODE), with maxHeaderSize 8192: identical on both.
    //  - a value that is not digits only (and the 20-digit one, which overflows Node's own limit): Node raises
    //    clientError HPE_INVALID_CONTENT_LENGTH before any handler runs; onClientError answers its bare 400
    //    (a status line and Connection: close, no JSON body) and destroys the socket. The 20-digit value is a bare
    //    400, not the 413 the size rule would give: it never reaches the app's own check.
    //  - spaces around a valid number: Node trims them, the handler sees "2", the request is served as usual.
    describe('a malformed value (the header sent as the only Content-Length)', () => {
      const MALFORMED: [string, string][] = [
        ['letters', 'abc'],
        ['a negative number', '-1'],
        ['a plus sign', '+5'],
        ['an exponent', '1e3'],
        ['hex', '0x10'],
        ['an empty value', ''],
        ['two numbers', '5 5'],
        ['twenty digits (not a 413)', '99999999999999999999'],
      ];

      it.each(MALFORMED)('%s (%j): a bare 400 from Node, exactly one answer, the socket closes, no handler runs', async (_name, value) => {
        const r = await setup();
        const reply = await send(r.port, spec(r, { contentLength: null, headers: [['Content-Length', value]] }), { untilClosed: true, waitMs: 3000 });
        expectBare(reply, 400);
        expect(reply.text.match(/HTTP\/1\.[01] \d{3}/gu) ?? [], 'status lines').toHaveLength(1);
        expect(reply.text).not.toContain('bad_request'); // Node's answer, not the app's JSON
        expect(reply.closed).toBe(true);
        expect(r.seen).toHaveLength(0);
        // and the server is still serving
        expect((await call(r)).status).toBe(200);
      });
    });

    describe('a valid number with spaces around it (Node trims them)', () => {
      it.each([
        ['a trailing space', '2 '],
        ['a leading space', ' 2'],
      ])('%s (%j): served like Content-Length: 2', async (_name, value) => {
        const r = await setup();
        const reply = await send(r.port, spec(r, { contentLength: null, headers: [['Content-Length', value]] }), { waitMs: 3000 });
        expect(reply.status).toBe(200);
        expect(JSON.parse(reply.body)).toEqual({ ok: true });
        expectAppHeaders(reply);
        expect(reply.text.match(/HTTP\/1\.[01] \d{3}/gu) ?? [], 'status lines').toHaveLength(1);
        expect(r.seen).toHaveLength(1);
        expect(r.seen[0]?.ctx.body).toEqual({});
      });
    });
  });

  describe('header size', () => {
    it('a 9000-byte header is a bare 431', async () => {
      const r = await setup();
      const reply = await call(r, { headers: [['X-Pad', 'a'.repeat(9000)]] });
      expectBare(reply, 431);
      expect(r.seen).toHaveLength(0);
    });

    it('a request whose headers total about 7900 bytes is served', async () => {
      const r = await setup();
      const reply = await call(r, { headers: [['X-Pad', 'a'.repeat(7000)]] });
      expect(reply.status).toBe(200);
    });
  });

  describe('slow clients get the deadline of Node (headers, whole request, idle), with the check interval set', () => {
    // Node's own timers cannot take the injected clock: the rig scales the production values down
    // (300 ms, 600 ms, every 50 ms) but only for the options the code under test actually set.
    it('slow headers: 408, or the connection is closed', async () => {
      const r = await setup({ shortDeadlines: true });
      const reply = await rawRequest(r.port, `POST /v1/test HTTP/1.1\r\nHost: 127.0.0.1:${r.port}\r\n`, { waitMs: 2000 });
      expect(reply.status === 408 || (reply.closed && reply.status === null)).toBe(true);
      expect(reply.closed).toBe(true);
      expect(r.seen).toHaveLength(0);
    });

    it('a slow body: 408, or the connection is closed', async () => {
      const r = await setup({ shortDeadlines: true });
      const head = buildRequest({ ...spec(r), body: '', headers: [...(spec(r).headers ?? []).filter(([n]) => n !== 'Content-Length'), ['Content-Length', '100']] });
      const reply = await rawRequest(r.port, Buffer.concat([head, Buffer.from('{"a"')]), { waitMs: 2500 });
      expect(reply.closed).toBe(true);
      expect(reply.status === 408 || reply.status === null).toBe(true);
      expect(r.seen).toHaveLength(0);
    });

    it('a connection that sends nothing is closed by the deadline', async () => {
      const r = await setup({ shortDeadlines: true });
      const conn = new RawConn(r.port);
      await conn.waitClosed(2500);
      const reply = conn.reply();
      expect(reply.status === 408 || reply.status === null).toBe(true);
    });

    it('a client that is quick is not cut off by the short deadlines', async () => {
      const r = await setup({ shortDeadlines: true });
      expect((await call(r)).status).toBe(200);
    });
  });

  describe('Expect: 100-continue', () => {
    it('no 100 is written: a valid request is answered by the normal handler', async () => {
      const r = await setup();
      const reply = await call(r, { headers: [['Expect', '100-continue']] });
      expect(reply.status).toBe(200);
      expect(reply.text).not.toMatch(/100 Continue/iu);
      expect(reply.text.match(/HTTP\/1\.1 \d{3}/gu) ?? []).toHaveLength(1);
      expect(r.seen).toHaveLength(1);
    });

    it('no 100 is written and the normal checks answer: a bad content type is 415', async () => {
      const r = await setup();
      const reply = await call(r, { contentType: 'text/plain', headers: [['Expect', '100-continue']] });
      expectError(reply, 415, 'bad_content_type');
      expect(reply.text).not.toMatch(/100 Continue/iu);
    });

    it('no 100 is written for a refusal at step 3 either', async () => {
      const r = await setup();
      const reply = await call(r, { origin: null, headers: [['Expect', '100-continue']] });
      expectError(reply, 403, 'bad_origin');
      expect(reply.text).not.toMatch(/100 Continue/iu);
    });
  });

  // Review 1, F3. Node answers an Expect value it does not know with its own bare 417, before any handler runs and
  // outside `answered`, so a later parser error appended a second (bare 400) response. The server registers
  // `checkExpectation` with the same handler as `checkContinue`: the value is ignored and the normal checks answer.
  describe('Expect: any other value', () => {
    /** Exactly one status line, and neither Node's 417 nor a 100 Continue anywhere in what came back. */
    const expectOneAnswer = (text: string): void => {
      expect(text.match(/HTTP\/1\.[01] \d{3}/gu) ?? [], 'status lines').toHaveLength(1);
      expect(text).not.toMatch(/\b417\b/u);
      expect(text).not.toMatch(/Expectation Failed/iu);
      expect(text).not.toMatch(/100 Continue/iu);
    };
    /** Like callClosed, but a connection Node keeps open (its own answer) costs 2 s, not the default 4 s. */
    const closed = (r: Rig, m: Mods): Promise<RawReply> => send(r.port, spec(r, m), { untilClosed: true, waitMs: 2000 });
    const expectHeader = (value: string): Header[] => [['Expect', value]];

    it('with a wrong Host: 403 bad_host with the app headers, one answer, the socket closes, no handler runs', async () => {
      const r = await setup();
      const reply = await closed(r, { host: `evil.example:${r.port}`, headers: expectHeader('unexpected') });
      expectError(reply, 403, 'bad_host');
      expectOneAnswer(reply.text);
      expect(reply.closed).toBe(true);
      expect(r.seen).toHaveLength(0);
    });

    it('on a valid request: 200 from the handler, with the app headers and exactly one answer', async () => {
      const r = await setup();
      const reply = await closed(r, { headers: expectHeader('unexpected') });
      expect(reply.status).toBe(200);
      expect(JSON.parse(reply.body)).toEqual({ ok: true });
      expectAppHeaders(reply);
      expectOneAnswer(reply.text);
      expect(reply.closed).toBe(true);
      expect(r.seen).toHaveLength(1);
      expect(r.seen[0]?.ctx.body).toEqual({});
    });

    it.each(['', 'foo=bar', '200-ok'])('the value %j is ignored too: a valid request is 200 and a bad content type is 415', async (value) => {
      const r = await setup();
      const ok = await closed(r, { headers: expectHeader(value) });
      expect(ok.status).toBe(200);
      expectOneAnswer(ok.text);
      const bad = await closed(r, { contentType: 'text/plain', headers: expectHeader(value) });
      expectError(bad, 415, 'bad_content_type');
      expectOneAnswer(bad.text);
      expect(r.seen).toHaveLength(1);
    });

    it('a refusal at step 3 is answered by the normal check, not by Node (no Origin: 403 bad_origin)', async () => {
      const r = await setup();
      const reply = await closed(r, { origin: null, headers: expectHeader('unexpected') });
      expectError(reply, 403, 'bad_origin');
      expectOneAnswer(reply.text);
      expect(r.seen).toHaveLength(0);
    });

    // A request llhttp refuses AFTER the handler answered (Transfer-Encoding other than chunked) must still hold
    // one response: the answer is in the linger, so the clientError that follows may not write a second one.
    describe('with Transfer-Encoding: identity and no Content-Length (the parser fails after the answer)', () => {
      const CASES: [string, string, boolean][] = [
        ['Expect: unexpected', 'unexpected', false],
        ['Expect: 100-continue (the checkContinue path, for comparison)', '100-continue', false],
        ['Expect: unexpected and a wrong Host (step 1 order: still 400 bad_request)', 'unexpected', true],
        ['Expect: 100-continue and a wrong Host (step 1 order: still 400 bad_request)', '100-continue', true],
      ];

      it.each(CASES)('%s: one 400 bad_request, then the socket closes at 1000 ms of the injected clock', async (_name, value, wrongHost) => {
        const r = await setup();
        const conn = await new RawConn(r.port, { allowHalfOpen: true }).connected();
        const base = spec(r, {
          host: wrongHost ? `evil.example:${r.port}` : undefined,
          contentLength: null,
          body: '',
          headers: [['Transfer-Encoding', 'identity'], ['Expect', value]],
        });
        conn.write(buildRequest(base));
        const reply = await conn.complete(3000);
        expectError(reply, 400, 'bad_request');
        expect(r.b.clock.pending(), 'the linger is armed on the injected timer').toContain(1000);
        await sleep(150);
        expect(conn.serverDone, 'the server keeps the socket during the linger').toBe(false);
        r.b.clock.advance(1000);
        await conn.waitEnded(3000);
        expect(conn.serverDone).toBe(true);
        expectOneAnswer(conn.reply().text);
        expect(r.seen).toHaveLength(0);
      });
    });
  });

  // Review 2, finding 2. Node's default `requireHostHeader: true` answers an HTTP/1.1 request without Host with its own
  // bare 400 BEFORE the Expect branch and the 'request' event: that answer is not in `answered`, no handler runs, and a
  // parser error after it (Transfer-Encoding other than chunked) appended a second bare 400. With the option off the
  // app's own Host check answers, as it already does for HTTP/1.0 (the check-order row "step 1: no Host on HTTP/1.0").
  // Probed one process per case on node 24.14.1 and on Electron 45.4.1 (node 24.22.3, ELECTRON_RUN_AS_NODE), with the
  // app's options plus requireHostHeader: false and the same listeners: identical on both.
  //  P1 HTTP/1.1 POST, no Host, Content-Length 2: the handler runs; one status line, 403 bad_host; no clientError.
  //  P2 P1 + Expect: unexpected: checkExpectation leads to the handler; one 403 bad_host, no 417.
  //  P3 P1 + Expect: 100-continue: checkContinue leads to the handler; one 403 bad_host, no 100 Continue.
  //  P4 HTTP/1.1, no Host, Transfer-Encoding: identity, no Content-Length: the handler answers 400 bad_request (step 1
  //     rules Transfer-Encoding before Host); then llhttp fails (clientError HPE_INVALID_TRANSFER_ENCODING) and the
  //     linger keeps onClientError from writing a second answer; one status line, the linger closes the socket.
  //  P5 P4 + Expect: unexpected: the same as P4.
  //  Without the option, P1 got Node's bare 400 with no handler call and P5 got two bare 400 status lines.
  describe('no Host on HTTP/1.1 (the app answers, not Node)', () => {
    /** Exactly one status line, and neither a 417 nor a 100 Continue anywhere in what came back. */
    const expectOneAnswer = (text: string): void => {
      expect(text.match(/HTTP\/1\.[01] \d{3}/gu) ?? [], 'status lines').toHaveLength(1);
      expect(text).not.toMatch(/\b417\b/u);
      expect(text).not.toMatch(/Expectation Failed/iu);
      expect(text).not.toMatch(/100 Continue/iu);
    };

    const WITH_LENGTH: [string, Header[]][] = [
      ['P1', []],
      ['P2: Expect: unexpected', [['Expect', 'unexpected']]],
      ['P3: Expect: 100-continue', [['Expect', '100-continue']]],
    ];

    it.each(WITH_LENGTH)('%s: 403 bad_host with the app headers, one answer, the socket closes, no handler runs', async (_name, extra) => {
      const r = await setup();
      const reply = await send(r.port, spec(r, { host: null, headers: extra }), { untilClosed: true, waitMs: 3000 });
      expectError(reply, 403, 'bad_host');
      expectOneAnswer(reply.text);
      expect(reply.closed).toBe(true);
      expect(r.seen).toHaveLength(0);
      // and the server is still serving
      expect((await call(r)).status).toBe(200);
    });

    const WITHOUT_LENGTH: [string, Header[]][] = [
      ['P4: Transfer-Encoding: identity, no Content-Length', []],
      ['P5: the same with Expect: unexpected', [['Expect', 'unexpected']]],
    ];

    it.each(WITHOUT_LENGTH)('%s: one 400 bad_request (Transfer-Encoding before Host), then the socket closes at 1000 ms of the injected clock', async (_name, extra) => {
      const r = await setup();
      const conn = await new RawConn(r.port, { allowHalfOpen: true }).connected();
      conn.write(buildRequest(spec(r, { host: null, contentLength: null, body: '', headers: [['Transfer-Encoding', 'identity'], ...extra] })));
      const reply = await conn.complete(3000);
      expectError(reply, 400, 'bad_request');
      expect(r.b.clock.pending(), 'the linger is armed on the injected timer').toContain(1000);
      await sleep(150);
      expect(conn.serverDone, 'the server keeps the socket during the linger').toBe(false);
      r.b.clock.advance(1000);
      await conn.waitEnded(3000);
      expect(conn.serverDone).toBe(true);
      expectOneAnswer(conn.reply().text);
      expect(r.seen).toHaveLength(0);
    });
  });

  describe('Upgrade and CONNECT', () => {
    it('a fully valid POST that asks to upgrade: no 101 and no 2xx, no handler runs', async () => {
      const r = await setup();
      const reply = await callClosed(r, { headers: [['Connection', 'Upgrade'], ['Upgrade', 'websocket']], keepAlive: false });
      expect(reply.status === null || reply.status >= 300).toBe(true);
      expect(reply.text).not.toMatch(/101 Switching/iu);
      expect(reply.closed).toBe(true);
      expect(r.seen).toHaveLength(0);
    });

    it('a websocket handshake (GET): no 101 and no 2xx, no handler runs, the socket closes', async () => {
      const r = await setup();
      const reply = await send(r.port, {
        method: 'GET',
        target: '/v1/test',
        headers: [
          ['Host', `127.0.0.1:${r.port}`],
          ['Origin', ORIGIN_A],
          ['Connection', 'Upgrade'],
          ['Upgrade', 'websocket'],
          ['Sec-WebSocket-Key', 'dGhlIHNhbXBsZSBub25jZQ=='],
          ['Sec-WebSocket-Version', '13'],
        ],
      }, { untilClosed: true });
      expect(reply.status === null || reply.status >= 300).toBe(true);
      expect(reply.closed).toBe(true);
      expect(r.seen).toHaveLength(0);
    });

    it('CONNECT: no 2xx, no handler runs, the socket closes', async () => {
      const r = await setup();
      const reply = await send(r.port, { method: 'CONNECT', target: '127.0.0.1:80', headers: [['Host', '127.0.0.1:80']] }, { untilClosed: true });
      expect(reply.status === null || reply.status >= 300).toBe(true);
      expect(reply.closed).toBe(true);
      expect(r.seen).toHaveLength(0);
    });

    it('the server still serves the next request after an upgrade attempt', async () => {
      const r = await setup();
      await call(r, { headers: [['Connection', 'Upgrade'], ['Upgrade', 'websocket']], keepAlive: false });
      expect((await call(r)).status).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('check order (one row per step; each request also breaks every later step, the earlier token wins)', () => {
  const BROKEN_BODY = '{"a":';
  const exhaust = (r: Rig): void => {
    const p = r.b.store.authenticate(ORIGIN_A, r.token);
    if (!p) throw new Error('pairing lost');
    for (let i = 0; i < 300; i += 1) r.b.store.allow(p);
  };

  interface Row {
    name: string;
    status: number;
    token: string;
    mods: (r: Rig) => Mods;
    exhaust?: boolean;
  }
  const ROWS: Row[] = [
    // Row 1 holds the header rules (400) before the Host rule (403): a header rule wins over a bad Host.
    {
      name: 'step 1: a POST without Content-Length, with a bad Host and every later step broken',
      status: 400,
      token: 'bad_request',
      exhaust: true,
      mods: (r) => ({ host: `localhost:${r.port}`, contentLength: null, origin: null, contentType: 'text/plain', auth: null, body: '' }),
    },
    {
      name: 'step 1: Transfer-Encoding, with a bad Host and every later step broken',
      status: 400,
      token: 'bad_request',
      exhaust: true,
      mods: (r) => ({ host: `localhost:${r.port}`, contentLength: null, headers: [['Transfer-Encoding', 'identity']], origin: null, contentType: 'text/plain', auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 1: Transfer-Encoding on an OPTIONS, with a bad Host',
      status: 400,
      token: 'bad_request',
      exhaust: true,
      mods: (r) => ({ host: `localhost:${r.port}`, method: 'OPTIONS', target: '/nope', contentLength: null, headers: [['Transfer-Encoding', 'identity']], origin: null, auth: null, body: '' }),
    },
    {
      name: 'step 1: Content-Type twice, with a bad Host and every later step broken',
      status: 400,
      token: 'bad_request',
      exhaust: true,
      mods: (r) => ({ host: `localhost:${r.port}`, headers: [['Content-Type', 'text/plain']], origin: null, contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 1: Host twice',
      status: 400,
      token: 'bad_request',
      exhaust: true,
      mods: (r) => ({ headers: [['Host', `127.0.0.1:${r.port}`]], method: 'OPTIONS', target: '/nope', origin: null, contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 1: Host localhost:<port>',
      status: 403,
      token: 'bad_host',
      exhaust: true,
      mods: (r) => ({ host: `localhost:${r.port}`, method: 'OPTIONS', target: '/nope', origin: null, contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 1: Host with another port',
      status: 403,
      token: 'bad_host',
      exhaust: true,
      mods: (r) => ({ host: `127.0.0.1:${r.port + 1}`, method: 'GET', target: '/nope', origin: null, contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 1: no Host on HTTP/1.0',
      status: 403,
      token: 'bad_host',
      exhaust: true,
      mods: () => ({ host: null, version: 'HTTP/1.0', keepAlive: false, method: 'OPTIONS', target: '/nope', origin: null, contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 2: OPTIONS on a known path',
      status: 403,
      token: 'preflight_refused',
      exhaust: true,
      mods: () => ({ method: 'OPTIONS', origin: null, contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 2: OPTIONS on an unknown path (S7: OPTIONS before path)',
      status: 403,
      token: 'preflight_refused',
      exhaust: true,
      mods: () => ({ method: 'OPTIONS', target: '/nope', origin: null, contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 2: unknown path with a GET (path before method)',
      status: 404,
      token: 'not_found',
      exhaust: true,
      mods: () => ({ method: 'GET', target: '/nope', origin: null, contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 2: unknown path with a POST',
      status: 404,
      token: 'not_found',
      exhaust: true,
      mods: () => ({ target: '/nope', origin: null, contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 2: GET on a known path',
      status: 405,
      token: 'method_not_allowed',
      exhaust: true,
      mods: () => ({ method: 'GET', origin: null, contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 3: no Origin',
      status: 403,
      token: 'bad_origin',
      exhaust: true,
      mods: () => ({ origin: null, contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 4: text/plain (type before size)',
      status: 415,
      token: 'bad_content_type',
      exhaust: true,
      mods: () => ({ contentType: 'text/plain', contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 4: too large',
      status: 413,
      token: 'too_large',
      exhaust: true,
      mods: () => ({ contentLength: 70000, auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 5: no token',
      status: 401,
      token: 'bad_token',
      exhaust: true,
      mods: () => ({ auth: null, body: BROKEN_BODY }),
    },
    {
      name: 'step 6: rate (300 used)',
      status: 429,
      token: 'rate_limited',
      exhaust: true,
      mods: () => ({ body: BROKEN_BODY }),
    },
    {
      name: 'step 7: broken body',
      status: 400,
      token: 'bad_request',
      mods: () => ({ body: BROKEN_BODY }),
    },
  ];

  it.each(ROWS)('$name -> $status $token', async (row) => {
    const r = await setup();
    if (row.exhaust) exhaust(r);
    const mods = row.mods(r);
    // the declared length is bigger than what is sent: the refusals before the body must not wait for it
    const reply = await call(r, mods, 3000);
    expectError(reply, row.status, row.token);
    expect(r.seen).toHaveLength(0);
  });

  describe('step 1: Host', () => {
    it.each<[string, (port: number) => string]>([
      ['localhost:<port>', (p) => `localhost:${p}`],
      ['the address without a port', () => '127.0.0.1'],
      ['another port', (p) => `127.0.0.1:${p + 1}`],
      ['port 0', () => '127.0.0.1:0'],
      ['an IPv6 loopback', (p) => `[::1]:${p}`],
      ['a trailing dot', (p) => `127.0.0.1.:${p}`],
      ['a leading zero in the port', (p) => `127.0.0.1:0${p}`],
      ['two ports', (p) => `127.0.0.1:${p}:${p}`],
      ['a foreign name', (p) => `example.com:${p}`],
      ['a name that starts like the address', (p) => `127.0.0.1.evil.example:${p}`],
      ['the address in uppercase hex form', (p) => `0x7f.0.0.1:${p}`],
      ['the decimal form of the address', (p) => `2130706433:${p}`],
      ['an empty value', () => ''],
    ])('%s is 403 bad_host', async (_name, host) => {
      const r = await setup();
      expectError(await call(r, { host: host(r.port) }), 403, 'bad_host');
      expect(r.seen).toHaveLength(0);
    });

    it('the exact value 127.0.0.1:<port> passes', async () => {
      const r = await setup();
      expect((await call(r, { host: `127.0.0.1:${r.port}` })).status).toBe(200);
    });
  });

  describe('step 2: OPTIONS, path, method', () => {
    it.each(['/v1/test', '/v1/open', '/nope', '/', '*', '/v1/pair', '/v1/status', '/v1/hello', '/v1/unpair'])('OPTIONS %s is 403 preflight_refused with no CORS header', async (target) => {
      const r = await setup();
      const reply = await send(r.port, { method: 'OPTIONS', target, headers: [['Host', `127.0.0.1:${r.port}`]] });
      expectError(reply, 403, 'preflight_refused');
    });

    it('a browser preflight (Origin and Access-Control-Request-* headers) is refused and gets no CORS header', async () => {
      const r = await setup();
      const reply = await send(r.port, {
        method: 'OPTIONS',
        target: '/v1/test',
        headers: [
          ['Host', `127.0.0.1:${r.port}`],
          ['Origin', ORIGIN_A],
          ['Access-Control-Request-Method', 'POST'],
          ['Access-Control-Request-Headers', 'authorization, content-type'],
          ['Access-Control-Request-Private-Network', 'true'],
        ],
      });
      expectError(reply, 403, 'preflight_refused');
      expect(reply.text.toLowerCase()).not.toContain('access-control');
      expect(reply.headers.has('vary')).toBe(false);
    });

    it.each<[string, string]>([
      ['an unknown path', '/nope'],
      ['a query string', '/v1/test?x'],
      ['a trailing slash', '/v1/test/'],
      ['a doubled leading slash', '//v1/test'],
      ['an absolute-form target', 'ABS'],
      ['another case', '/V1/TEST'],
      ['a prefix match (/v1/testx)', '/v1/testx'],
      ['a longer path', '/v1/test/extra'],
      ['a shorter path', '/v1'],
      ['a fragment', '/v1/test#frag'],
      ['an encoded slash', '/v1%2ftest'],
      ['an empty path segment', '/v1//test'],
      ['the root', '/'],
    ])('POST to %s is 404 not_found', async (_name, target) => {
      const r = await setup();
      const t = target === 'ABS' ? `http://127.0.0.1:${r.port}/v1/test` : target;
      expectError(await call(r, { target: t }), 404, 'not_found');
      expect(r.seen).toHaveLength(0);
    });

    it('the exact registered path passes', async () => {
      const r = await setup();
      expect((await call(r, { target: '/v1/test' })).status).toBe(200);
    });

    it.each(['GET', 'PUT', 'DELETE', 'PATCH'])('%s on a known path is 405 method_not_allowed', async (method) => {
      const r = await setup();
      expectError(await call(r, { method, contentLength: method === 'GET' ? null : undefined, body: method === 'GET' ? '' : '{}' }), 405, 'method_not_allowed');
      expect(r.seen).toHaveLength(0);
    });

    it('GET on a route with auth none is 405 too', async () => {
      const r = await setup();
      expectError(await call(r, { method: 'GET', target: '/v1/open', contentLength: null, body: '' }), 405, 'method_not_allowed');
    });
  });

  describe('step 3: Origin (S6)', () => {
    it.each<[string, string | null]>([
      ['no Origin', null],
      ['null', 'null'],
      ['https://example.com', 'https://example.com'],
      ['the loopback page itself', 'http://127.0.0.1:1234'],
      ['31 letters', originOf('a').slice(0, -1)],
      ['33 letters', `${originOf('a')}a`],
      ['the letter q', `chrome-extension://${'a'.repeat(31)}q`],
      ['uppercase', `chrome-extension://${'A'.repeat(32)}`],
      ['a trailing slash', `${ORIGIN_A}/`],
      ['a different scheme', `moz-extension://${'a'.repeat(32)}`],
      ['an empty value', ''],
    ])('%s on a token route is 403 bad_origin', async (_name, origin) => {
      const r = await setup();
      expectError(await call(r, { origin }), 403, 'bad_origin');
      expect(r.seen).toHaveLength(0);
    });

    it('an extension origin with no pairing on a token route is 403 bad_origin, even with another origin’s right token', async () => {
      const r = await setup();
      expectError(await call(r, { origin: ORIGIN_B }), 403, 'bad_origin');
    });

    it.each<[string, string | null]>([
      ['no Origin', null],
      ['null', 'null'],
      ['https://example.com', 'https://example.com'],
      ['31 letters', originOf('a').slice(0, -1)],
      ['uppercase', `chrome-extension://${'A'.repeat(32)}`],
    ])('%s on a route with auth none is 403 bad_origin too', async (_name, origin) => {
      const r = await setup();
      expectError(await call(r, { target: '/v1/open', origin, auth: null }), 403, 'bad_origin');
    });

    it('an extension-shaped origin with no pairing passes on a route with auth none', async () => {
      const r = await setup();
      expect((await call(r, { target: '/v1/open', origin: originOf('p'), auth: null })).status).toBe(200);
    });
  });

  describe('step 4: content type and size', () => {
    it.each<[string, string | null]>([
      ['text/plain', 'text/plain'],
      ['a missing type', null],
      ['application/json, text/plain', 'application/json, text/plain'],
      ['application/jsonx', 'application/jsonx'],
      ['a charset without the space (the whole value is compared, S9)', 'application/json;charset=utf-8'],
      ['another charset', 'application/json; charset=utf-16'],
      ['an extra parameter', 'application/json; charset=utf-8; boundary=x'],
      ['a trailing semicolon', 'application/json;'],
      ['multipart', 'multipart/form-data; boundary=x'],
      ['text/json', 'text/json'],
      ['*/*', '*/*'],
      ['a structured suffix', 'application/vnd+json'],
      ['an empty type', ''],
    ])('%s is 415 bad_content_type', async (_name, contentType) => {
      const r = await setup();
      expectError(await call(r, { contentType }), 415, 'bad_content_type');
      expect(r.seen).toHaveLength(0);
    });

    it('Content-Length 65537 is 413 too_large on a 64 KiB route, with no body sent', async () => {
      const r = await setup();
      expectError(await call(r, { contentLength: 65537, body: '' }), 413, 'too_large');
      expect(r.seen).toHaveLength(0);
    });

    it('Content-Length 524289 is 413 on the large route; 524288 passes', async () => {
      const r = await setup();
      expectError(await call(r, { target: '/v1/large', contentLength: 524289, body: '' }), 413, 'too_large');
      const ok = await call(r, { target: '/v1/large', body: jsonBody(524288) }, 8000);
      expect(ok.status).toBe(200);
      expect(r.seen).toHaveLength(1);
    });

    it('exactly 65536 bytes pass on a 64 KiB route', async () => {
      const r = await setup();
      const reply = await call(r, { body: jsonBody(65536) });
      expect(reply.status).toBe(200);
      expect(Object.keys(r.seen[0]?.ctx.body ?? {})).toEqual(['p']);
    });

    it('the limit is the route’s: 524288 bytes are 413 on a 64 KiB route', async () => {
      const r = await setup();
      expectError(await call(r, { contentLength: 524288, body: '' }), 413, 'too_large');
    });

    it('the limit counts bytes, not characters: 65536 bytes of two-byte characters pass, 65537 do not', async () => {
      const r = await setup();
      const n = 32764; // 6 + 2n + 2 = 65536
      const ok = Buffer.from(`{"p":"${'é'.repeat(n)}"}`, 'utf8');
      expect(ok.length).toBe(65536);
      expect((await call(r, { body: ok })).status).toBe(200);
      expectError(await call(r, { contentLength: 65537, body: '' }), 413, 'too_large');
    });

    it('a body longer than it declared is not read past Content-Length: the handler never sees the extra bytes', async () => {
      const r = await setup();
      const reply = await rawRequest(r.port, Buffer.concat([buildRequest({ ...spec(r), body: '{}' }), Buffer.from('{"smuggled":1}')]));
      // What Node does with the stray bytes (a bare 400 for a bad "next request", or the answer first) is its own
      // business and depends on timing; the rule is that the declared bytes are the whole body.
      expect([200, 400, null]).toContain(reply.status);
      expect(reply.text).not.toContain('smuggled');
      expect(r.seen.length).toBeLessThanOrEqual(1);
      for (const s of r.seen) expect(s.ctx.body).toEqual({});
    });
  });

  describe('step 5: token', () => {
    it.each<[string, (r: Rig) => string | null]>([
      ['no Authorization header', () => null],
      ['Basic credentials', () => 'Basic dXNlcjpwYXNz'],
      ['an empty bearer', () => 'Bearer '],
      ['the word Bearer alone', () => 'Bearer'],
      ['a wrong token of 43 characters', () => `Bearer ${'A'.repeat(43)}`],
      ['the right token with its last character changed', (r) => `Bearer ${r.token.slice(0, -1)}${r.token.endsWith('A') ? 'B' : 'A'}`],
      ['a token of 44 characters', (r) => `Bearer ${r.token}A`],
      ['a token with characters outside base64url', (r) => `Bearer ${r.token.slice(0, 20)}+${r.token.slice(21)}`],
      ['the token without the scheme', (r) => r.token],
    ])('%s is 401 bad_token', async (_name, auth) => {
      const r = await setup();
      expectError(await call(r, { auth: auth(r) }), 401, 'bad_token');
      expect(r.seen).toHaveLength(0);
    });

    it('a 42-character token is 401 bad_token and is never compared', async () => {
      const r = await setup();
      const before = r.b.safeEqual.calls.length;
      expectError(await call(r, { auth: `Bearer ${r.token.slice(0, 42)}` }), 401, 'bad_token');
      expect(r.b.safeEqual.calls.length).toBe(before);
    });

    it('another origin’s token is 401 bad_token (that origin has a pairing of its own)', async () => {
      const r = await setup();
      const other = r.b.pair({ origin: ORIGIN_B, label: 'Edge' });
      expectError(await call(r, { origin: ORIGIN_B }), 401, 'bad_token'); // A's token from B
      expectError(await call(r, { origin: ORIGIN_A, auth: `Bearer ${other.token}` }), 401, 'bad_token'); // B's token from A
      expect((await call(r, { origin: ORIGIN_B, auth: `Bearer ${other.token}` })).status).toBe(200);
    });

    it('a token whose pairing has been removed is 401 bad_token while a sibling keeps the origin', async () => {
      const r = await setup();
      r.b.pair({ origin: ORIGIN_A, label: 'Edge' });
      r.b.store.unpair(r.pairingId);
      expectError(await call(r), 401, 'bad_token');
    });

    it('the right token passes', async () => {
      const r = await setup();
      expect((await call(r)).status).toBe(200);
    });

    it('every check of the token goes through the injected safeEqual, once per stored pairing', async () => {
      const r = await setup();
      r.b.pair({ origin: ORIGIN_B, label: 'Edge' });
      r.b.safeEqual.calls.length = 0;
      await call(r);
      expect(r.b.safeEqual.calls).toHaveLength(2);
    });
  });

  describe('step 6: rate', () => {
    it('request 300 passes and request 301 is 429 rate_limited', async () => {
      const r = await setup();
      const p = r.b.store.authenticate(ORIGIN_A, r.token);
      if (!p) throw new Error('pairing lost');
      for (let i = 0; i < 299; i += 1) r.b.store.allow(p);
      expect((await call(r)).status).toBe(200);
      expectError(await call(r), 429, 'rate_limited');
      expect(r.seen).toHaveLength(1);
    });

    it('the window resets at 60 000 ms on the injected clock', async () => {
      const r = await setup();
      const p = r.b.store.authenticate(ORIGIN_A, r.token);
      if (!p) throw new Error('pairing lost');
      for (let i = 0; i < 300; i += 1) r.b.store.allow(p);
      expectError(await call(r), 429, 'rate_limited');
      r.b.clock.advance(60_000);
      expect((await call(r)).status).toBe(200);
    });

    it('a refusal before the token check does not use the quota', async () => {
      const r = await setup();
      for (let i = 0; i < 20; i += 1) await call(r, { auth: null });
      const p = r.b.store.authenticate(ORIGIN_A, r.token);
      if (!p) throw new Error('pairing lost');
      for (let i = 0; i < 299; i += 1) r.b.store.allow(p); // 299 used: the next real request is the 300th
      expect((await call(r)).status).toBe(200);
    });

    it('a route with auth none is not rate limited', async () => {
      const r = await setup();
      for (let i = 0; i < 40; i += 1) expect((await call(r, { target: '/v1/open', auth: null })).status).toBe(200);
    });
  });

  describe('step 7: body shape', () => {
    const BAD_BODIES: [string, string | Buffer][] = [
      ['broken JSON', '{"a":'],
      ['an array', '[]'],
      ['an array of objects', '[{}]'],
      ['null', 'null'],
      ['a string', '"s"'],
      ['a number', '1'],
      ['true', 'true'],
      ['an empty body', ''],
      ['only whitespace', '   '],
      ['invalid UTF-8 inside a string', Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])],
      ['an overlong UTF-8 sequence', Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc0, 0xaf, 0x22, 0x7d])],
      ['an encoded lone surrogate', Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x7d])],
      ['a truncated UTF-8 sequence at the end of a string', Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xe2, 0x82, 0x22, 0x7d])],
      ['a byte order mark before the object', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')])],
      ['a UTF-16 byte order mark', Buffer.from([0xff, 0xfe, 0x7b, 0x00, 0x7d, 0x00])],
      ['text after the object', '{} x'],
      ['two objects', '{}{}'],
    ];

    it.each(BAD_BODIES)('%s is 400 bad_request and no handler runs', async (_name, body) => {
      const r = await setup();
      expectError(await call(r, { body }), 400, 'bad_request');
      expect(r.seen).toHaveLength(0);
    });

    it('a JSON object reaches the handler with its keys and values', async () => {
      const r = await setup();
      await call(r, { body: '{"a":1,"b":"two","c":[true,null],"d":{"e":1}}' });
      expect(r.seen[0]?.ctx.body).toEqual({ a: 1, b: 'two', c: [true, null], d: { e: 1 } });
    });

    it('multi-byte text is decoded as UTF-8', async () => {
      const r = await setup();
      await call(r, { body: '{"label":"متصفح ✓ \u{1F600}"}' });
      expect(r.seen[0]?.ctx.body).toEqual({ label: 'متصفح ✓ \u{1F600}' });
    });

    it('an extra key on a real A1 route is 400 bad_request (the endpoint’s exact keys)', async () => {
      const r = await setup();
      expectError(await call(r, { target: '/v1/status', body: '{"extra":1}' }), 400, 'bad_request');
      expectError(await call(r, { target: '/v1/unpair', body: '{"extra":1}' }), 400, 'bad_request');
      expect((await call(r, { target: '/v1/status', body: '{}' })).status).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('responses', () => {
  it('a 200 carries the same headers and exactly the handler body', async () => {
    const r = await setup();
    const reply = await call(r);
    expect(reply.status).toBe(200);
    expectAppHeaders(reply);
    expect(reply.body).toBe('{"ok":true}');
  });

  it('a marker in the path, headers and body is never echoed', async () => {
    const r = await setup();
    const M = 'ZZMARKERZZ';
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map((k) => vi.spyOn(console, k as 'log').mockImplementation(() => undefined));
    const all: Mods[] = [
      { target: `/nope-${M}` },
      { target: `/v1/test?${M}=1` },
      { origin: `https://${M}.example` },
      { origin: `chrome-extension://${M}` },
      { auth: `Bearer ${M}${M}${M}` },
      { auth: `Basic ${M}` },
      { contentType: `text/${M}` },
      { host: `${M}.example:${r.port}` },
      { body: `{"x":"${M}"` },
      { headers: [['X-Marker', M]], body: `[${M}]` },
      { headers: [['Host', `${M}:1`]] },
      { headers: [['Origin', M]] },
      { headers: [['Authorization', M]] },
      { method: 'GET', headers: [['X-Marker', M]], contentLength: null, body: '' },
      { contentLength: 70000, body: '', headers: [['X-Marker', M]] },
    ];
    const replies: RawReply[] = [];
    for (let i = 0; i < all.length; i += 5) replies.push(...(await Promise.all(all.slice(i, i + 5).map((m) => call(r, m)))));
    for (const reply of replies) {
      expect(reply.text).not.toContain(M);
      expect(reply.text).not.toContain(Buffer.from(M).toString('base64'));
    }
    // S17: nothing about a request is logged either
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it('every error answer carries exactly one key, error', async () => {
    const r = await setup();
    for (const mods of [{ auth: null }, { origin: null }, { target: '/nope' }, { method: 'GET', contentLength: null, body: '' }, { body: '[]' }, { contentType: 'x/y' }]) {
      const reply = await call(r, mods as Mods);
      const parsed = JSON.parse(reply.body) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(['error']);
      expect(typeof parsed['error']).toBe('string');
    }
  });

  it('no response ever carries an Access-Control header or Vary', async () => {
    const r = await setup();
    const replies = [await call(r), await call(r, { auth: null }), await call(r, { method: 'OPTIONS', contentLength: null, body: '' }), await call(r, { origin: null })];
    for (const reply of replies) {
      for (const name of reply.headers.keys()) expect(name.startsWith('access-control-'), name).toBe(false);
      expect(reply.headers.has('vary')).toBe(false);
    }
  });

  describe('a handler that fails (S10, R2-5, S17)', () => {
    it.each([
      ['throws', '/v1/boom', 'RangeError'],
      ['returns a rejected promise', '/v1/reject', 'TypeError'],
    ])('%s: the socket closes with zero response bytes, and the next request is served', async (_name, target, errName) => {
      const r = await setup();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const others = ['log', 'info', 'warn', 'debug'].map((k) => vi.spyOn(console, k as 'log').mockImplementation(() => undefined));
      const reply = await call(r, { target });
      expect(reply.raw.length).toBe(0);
      expect(reply.closed).toBe(true);
      // S17: at most one console.error, with the route path and the error name only
      expect(errors.mock.calls.length).toBeLessThanOrEqual(1);
      for (const args of errors.mock.calls) {
        const line = args.map((a) => String(a)).join(' ');
        expect(line).toContain(target);
        expect(line).toContain(errName);
        expect(line).not.toContain('SECRET-DETAIL-ZZ');
        expect(line).not.toMatch(/\bat .*\(.*:\d+:\d+\)/u);
        expect(line).not.toContain(r.token);
      }
      for (const spy of others) expect(spy).not.toHaveBeenCalled();
      const next = await call(r);
      expect(next.status).toBe(200);
    });

    it('two failing requests in a row do not stop the server', async () => {
      const r = await setup();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await call(r, { target: '/v1/boom' });
      await call(r, { target: '/v1/reject' });
      expect((await call(r)).status).toBe(200);
    });
  });

  describe('register (routes.ts)', () => {
    it('throws on a duplicate path, and a different path is fine', async () => {
      const r = await setup();
      const { register } = r.b.mods.routes;
      const handle: Route['handle'] = () => ({ status: 200, body: {} });
      expect(() => register({ path: '/v1/test', auth: 'token', bodyLimit: 10, handle })).toThrow();
      expect(() => register({ path: '/v1/other', auth: 'token', bodyLimit: 10, handle })).not.toThrow();
      expect(() => register({ path: '/v1/other', auth: 'none', bodyLimit: 10, handle })).toThrow();
    });

    it('throws when it is asked to register a path of the A1 routes again', async () => {
      const r = await setup();
      const handle: Route['handle'] = () => ({ status: 200, body: {} });
      for (const path of ['/v1/pair', '/v1/hello', '/v1/status', '/v1/unpair']) {
        expect(() => r.b.mods.routes.register({ path, auth: 'token', bodyLimit: 10, handle }), path).toThrow();
      }
    });

    it('a route registered after the server started is served', async () => {
      const r = await setup();
      r.b.mods.routes.register({ path: '/v1/late', auth: 'token', bodyLimit: 1024, handle: () => ({ status: 200, body: { late: true } }) });
      const reply = await call(r, { target: '/v1/late' });
      expect(JSON.parse(reply.body)).toEqual({ late: true });
    });

    it('a route’s own status and body are sent as they are (a handler can answer 404 unknown_pairing)', async () => {
      const r = await setup();
      r.b.mods.routes.register({ path: '/v1/own', auth: 'token', bodyLimit: 1024, handle: () => ({ status: 404, body: { error: 'unknown_pairing' } }) });
      expectError(await call(r, { target: '/v1/own' }), 404, 'unknown_pairing');
    });
  });

  describe('productionDeps()', () => {
    it('hands out crypto.timingSafeEqual and node:crypto randomBytes', async () => {
      const r = await setup();
      const deps = r.b.mods.server.productionDeps();
      expect(deps.safeEqual).toBe(timingSafeEqual);
      expect(deps.randomBytes).toBe(cryptoRandomBytes);
    });

    it('the compare really is constant-time-capable: equal buffers match, different ones do not, lengths must agree', async () => {
      const r = await setup();
      const { safeEqual } = r.b.mods.server.productionDeps();
      expect(safeEqual(Buffer.from('abcdefgh'), Buffer.from('abcdefgh'))).toBe(true);
      expect(safeEqual(Buffer.from('abcdefgh'), Buffer.from('abcdefgx'))).toBe(false);
    });

    it('its clock is monotonic, not the wall clock', async () => {
      const r = await setup();
      const { now } = r.b.mods.server.productionDeps();
      const a = now();
      const b = now();
      expect(b).toBeGreaterThanOrEqual(a);
      expect(a).toBeLessThan(1e12); // a wall clock is about 1.7e12
    });

    it('its timers fire and clear', async () => {
      const r = await setup();
      const { setTimer, clearTimer } = r.b.mods.server.productionDeps();
      let fired = 0;
      setTimer(() => (fired += 1), 15);
      const cancelled = setTimer(() => (fired += 10), 15);
      clearTimer(cancelled);
      await sleep(120);
      expect(fired).toBe(1);
    });

    it('its createServer makes a node:http server', async () => {
      const r = await setup();
      const s = r.b.mods.server.productionDeps().createServer({ maxHeaderSize: 8192 });
      expect(s).toBeInstanceOf(http.Server);
      expect(s.listening).toBe(false);
    });

    it('it has no `pairing`: the caller supplies it', async () => {
      const r = await setup();
      expect(Object.keys(r.b.mods.server.productionDeps())).not.toContain('pairing');
    });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('refusals with a body in flight (S18)', () => {
  /** Sends the head, then `total` bytes in chunks with short pauses, and reads the answer. */
  async function withBody(r: Rig, m: Mods, total = 60000): Promise<{ conn: RawConn; reply: RawReply }> {
    const base = spec(r, { ...m, body: '' });
    const headers = (base.headers ?? []).filter(([n]) => n.toLowerCase() !== 'content-length');
    if (m.contentLength !== null) headers.push(['Content-Length', String(m.contentLength ?? total)]);
    const conn = await new RawConn(r.port).connected();
    conn.write(buildRequest({ ...base, headers }));
    const chunk = Buffer.alloc(10000, 0x61);
    for (let sent = 0; sent < total; sent += chunk.length) {
      if (conn.closed) break;
      conn.write(chunk.subarray(0, Math.min(chunk.length, total - sent)));
      await sleep(8);
    }
    const reply = await conn.complete(4000);
    return { conn, reply };
  }

  const KINDS: [string, number, string, (r: Rig) => Mods][] = [
    ['step 1: bad Host', 403, 'bad_host', (r) => ({ host: `localhost:${r.port}` })],
    ['step 2: unknown path (64 KiB when no route matched)', 404, 'not_found', () => ({ target: '/nope' })],
    ['step 2: method not allowed', 405, 'method_not_allowed', () => ({ method: 'PUT' })],
    ['step 3: bad Origin', 403, 'bad_origin', () => ({ origin: null })],
    ['step 4: bad content type (R2-4)', 415, 'bad_content_type', () => ({ contentType: 'text/plain' })],
    ['step 5: bad token', 401, 'bad_token', () => ({ auth: `Bearer ${'A'.repeat(43)}` })],
  ];

  it.each(KINDS)('%s: a 60 000-byte body still in flight is discarded and the answer is received in full', async (_name, status, token, mods) => {
    const r = await setup();
    const { conn, reply } = await withBody(r, mods(r));
    expectError(reply, status, token);
    expect(conn.error).toBeNull();
    conn.destroy();
    expect(r.seen).toHaveLength(0);
  });

  it('step 6: rate limited, with the body in flight', async () => {
    const r = await setup();
    const p = r.b.store.authenticate(ORIGIN_A, r.token);
    if (!p) throw new Error('pairing lost');
    for (let i = 0; i < 300; i += 1) r.b.store.allow(p);
    const { conn, reply } = await withBody(r, {});
    expectError(reply, 429, 'rate_limited');
    expect(conn.error).toBeNull();
    conn.destroy();
  });

  it('a refusal on the large route drains up to 512 KiB-limit bodies too (a 415 with 200 000 bytes)', async () => {
    const r = await setup();
    const { conn, reply } = await withBody(r, { target: '/v1/large', contentType: 'text/plain' }, 200000);
    expectError(reply, 415, 'bad_content_type');
    expect(conn.error).toBeNull();
    conn.destroy();
  });

  it('a refusal within the limit is answered only once the whole body has arrived (drained), and the connection then ends without any linger timer', async () => {
    const r = await setup();
    const total = 40000;
    const base = spec(r, { origin: null, body: '' }); // step 3: bad_origin, with 40 000 declared bytes
    const headers = (base.headers ?? []).filter(([n]) => n !== 'Content-Length').concat([['Content-Length', String(total)]]);
    const conn = await new RawConn(r.port, { allowHalfOpen: true }).connected();
    conn.write(buildRequest({ ...base, headers }));
    conn.write(Buffer.alloc(10000, 0x61));
    await sleep(250);
    expect(conn.receivedBytes, 'nothing is answered while the body is still arriving').toBe(0);
    conn.write(Buffer.alloc(total - 10000, 0x61));
    const reply = await conn.complete(3000);
    expectError(reply, 403, 'bad_origin');
    await conn.waitEnded(3000); // the server ends the connection by itself: no timer of the injected clock is needed
    expect(r.b.clock.pending()).not.toContain(1000);
    conn.destroy();
  });

  describe('413 and no usable length: answered at once, the socket destroyed after a 1 s linger on the injected timer', () => {
    it('413: the answer arrives with only the headers sent; the socket closes after 1000 ms of the injected clock', async () => {
      const r = await setup();
      const conn = await new RawConn(r.port, { allowHalfOpen: true }).connected();
      conn.write(buildRequest({ ...spec(r), body: '', headers: (spec(r).headers ?? []).filter(([n]) => n !== 'Content-Length').concat([['Content-Length', '65537']]) }));
      const reply = await conn.complete(3000);
      expectError(reply, 413, 'too_large');
      expect(r.b.clock.pending(), 'the linger is armed on the injected timer').toContain(1000);
      await sleep(150);
      expect(conn.serverDone, 'the server keeps the socket during the linger (no FIN, no close)').toBe(false);
      r.b.clock.advance(999);
      await sleep(100);
      expect(conn.serverDone, 'still open at 999 ms').toBe(false);
      r.b.clock.advance(1);
      await conn.waitEnded(3000);
      expect(conn.serverDone).toBe(true);
    });

    it('a chunked POST (no usable length): 400 at once, destroyed after the linger', async () => {
      const r = await setup();
      const conn = await new RawConn(r.port, { allowHalfOpen: true }).connected();
      conn.write(buildRequest({ ...spec(r), body: '5\r\n{"a":\r\n', headers: (spec(r).headers ?? []).filter(([n]) => n !== 'Content-Length').concat([['Transfer-Encoding', 'chunked']]) }));
      const reply = await conn.complete(3000);
      expectError(reply, 400, 'bad_request');
      expect(r.b.clock.pending(), 'the linger is armed on the injected timer').toContain(1000);
      await sleep(150);
      expect(conn.serverDone, 'the server keeps the socket during the linger').toBe(false);
      r.b.clock.advance(1000);
      await conn.waitEnded(3000);
      expect(conn.serverDone).toBe(true);
    });

    it('an unknown path with a body over 64 KiB (no route matched): 404 at once, then the linger', async () => {
      const r = await setup();
      const conn = await new RawConn(r.port, { allowHalfOpen: true }).connected();
      conn.write(buildRequest({ ...spec(r), target: '/nope', body: '', headers: (spec(r).headers ?? []).filter(([n]) => n !== 'Content-Length').concat([['Content-Length', '70000']]) }));
      const reply = await conn.complete(3000);
      expectError(reply, 404, 'not_found');
      expect(r.b.clock.pending(), 'the linger is armed on the injected timer').toContain(1000);
      await sleep(150);
      expect(conn.serverDone, 'the server keeps the socket during the linger').toBe(false);
      r.b.clock.advance(1000);
      await conn.waitEnded(3000);
      expect(conn.serverDone).toBe(true);
    });

    it('a 413 whose client does send everything still gets the answer, and the linger ends the connection', async () => {
      const r = await setup();
      const conn = await new RawConn(r.port, { allowHalfOpen: true }).connected();
      conn.write(buildRequest(spec(r, { body: Buffer.alloc(65537, 0x61) }))); // Content-Length 65537 and all 65537 bytes sent
      const reply = await conn.complete(3000);
      expectError(reply, 413, 'too_large');
      r.b.clock.advance(1000);
      await conn.waitEnded(3000);
      expect(conn.serverDone).toBe(true);
    });
  });
});

describe('an unpair while another request’s body is in flight (S6c)', () => {
  it('is 401 bad_token and no handler runs', async () => {
    const r = await setup();
    r.b.pair({ origin: ORIGIN_A, label: 'Edge' }); // a sibling keeps step 3 true whatever the timing
    const body = '{"padding":"abcdefghijklmnop"}';
    const base = spec(r, { body: '' });
    const headers = (base.headers ?? []).filter(([n]) => n !== 'Content-Length').concat([['Content-Length', String(body.length)]]);
    const conn = await new RawConn(r.port).connected();
    conn.write(buildRequest({ ...base, headers }));
    conn.write(body.slice(0, 5));
    await sleep(150); // the server has read the head, checked the token and is waiting for the body
    expect(r.b.store.unpair(r.pairingId)).toBe(true);
    conn.write(body.slice(5));
    const reply = await conn.complete(3000);
    expectError(reply, 401, 'bad_token');
    expect(r.seen).toHaveLength(0);
    conn.destroy();
  });

  it('a pairing that is still stored runs the handler after a slow body', async () => {
    const r = await setup();
    const body = '{"padding":"abcdefghijklmnop"}';
    const base = spec(r, { body: '' });
    const headers = (base.headers ?? []).filter(([n]) => n !== 'Content-Length').concat([['Content-Length', String(body.length)]]);
    const conn = await new RawConn(r.port).connected();
    conn.write(buildRequest({ ...base, headers }));
    conn.write(body.slice(0, 5));
    await sleep(100);
    conn.write(body.slice(5));
    const reply = await conn.complete(3000);
    expect(reply.status).toBe(200);
    conn.destroy();
  });
});

describe('the hash of a token never appears in a response', () => {
  it('a wrong token answer does not hint at the stored hash', async () => {
    const r = await setup();
    const hash = createHash('sha256').update(Buffer.from(r.token, 'ascii')).digest('base64url');
    const reply = await call(r, { auth: `Bearer ${'A'.repeat(43)}` });
    expect(reply.text).not.toContain(hash);
    expect(reply.text).not.toContain(r.token);
  });
});
