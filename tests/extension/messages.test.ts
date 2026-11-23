/**
 * Task 6: extension/src/lib/messages.ts, the service-worker handlers (E8d, E10 to E13, N1; R2-1, R2-6, R2-8).
 * Every test runs the real store over the fake IndexedDB, the real client over a fake server and the real
 * handlers on a fake chrome (tests/extension/world.ts).
 *
 * Enumerations:
 *  - Message types (3): fetchly:status {}, fetchly:pair { pairingString, label }, fetchly:unpair {}. Exact key sets.
 *  - Sender rules (3): sender.id === runtime.id, sender.url === getURL('popup.html'), sender.tab === undefined.
 *  - Reply: { state, paired, appVersion?, note? } and nothing else. Worker states (15): all popup states but `interrupted`.
 *  - Status rows: every row of plan section 5, each with its R2-1 `paired` value (see STATUS_ROWS) and the stored record after it.
 *  - Pair results: badInput, storageBlocked, checking (success), storageFailed, mismatch (from pair and from a 400), wrongCode,
 *    pairingClosed, appNotRunning, wrongProgram, operationRunning (the AM-5 gate, amendment 2).
 *  - Unpair answers: 200, 401, 403, 500, a wrong proof, hello 404, rejections, hangs, stale proof, opaque redirect, nothing listening.
 *  - Secrecy: the reply JSON, the IndexedDB log (assertWorldClean runs after every test).
 *
 * Amendment 1 (docs/plans/2026-11-23-phase2-a2-amendment-1.md) adds, at the end of this file and in the tables above:
 *  - AM-1: the pair, unpair and status handlers over a store whose commit gets stuck (fake `commitHold`): storage_unknown after the 1000 ms
 *    grace. Ways the write ends: no terminal event (4000 ms), complete inside the grace, abort inside the grace, complete released right
 *    after the clock reached 4000 ms. Final read: fails, holds the new pairingId, holds nothing, holds another pairingId.
 *  - AM-2: `paired` comes from a final store.read() after the last mutation and the last fetch. Status rows 1 to 5, the pair paths, the unpair
 *    paths. afterEach checks, for EVERY reply of every test in this file, that `paired` equals "a record is on disk at the moment of the
 *    reply" (see watchReplies). The one exception is `storageBlocked`, whose `paired` is false because the record could not be read.
 *  - AM-3: `held` changes only on a confirmed pair. One failing pair per kind: badInput, wrongCode, pairingClosed, mismatch, appNotRunning,
 *    wrongProgram, storageFailed, storageBlocked.
 *  - AM-4: a 200 JSON that is not an object is `mismatch`; a 200 that is not JSON is `appError`.
 *  - AM-5: pair and unpair are gated, not queued: a second one gets `operationRunning` at once (amendment 2; `checking` before it); status is
 *    never gated.
 *  - AM-6: a response body that is not valid UTF-8 is not JSON.
 *
 * Amendment 2 (docs/plans/2026-11-23-phase2-a2-amendment-2.md) adds, in the AM-5 describe and at the end of this file:
 *  - AM2-1: the gate answers `{ state: 'operationRunning', paired }` with `paired` from its one read (a failed read is still storageBlocked,
 *    a null read still drops held), before the pair's input parse (so a gated pair with bad input is not badInput), never to a status.
 *    `checking` keeps the AM-2 meaning "ask for the status now": after a stored pair, for an obsolete status, and from unpair when another
 *    pairing is stored. Every spec that asserted `checking` from the gate asserts `operationRunning` now.
 *  - AM2-2: a callWith (or a client.pair) that never settles keeps the gate shut: later pairs and unpairs answer operationRunning, status
 *    still answers, nothing is sent. No behaviour change.
 *  - AM2-3: the pair handler over a `store.write` that answers storage_failed (one best-effort unpair with the new credentials, held
 *    untouched), and over an `ok` write whose final read fails (storageBlocked, paired false, held is already set: the next connected
 *    status unpairs the replaced record exactly once).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock, Trace, track, until } from './clock';
import { bytes, err, hang, json, opaqueRedirect, reject, streamError, text, type Answer } from './fakeFetch';
import { FakeIdb } from './fakeIdb';
import type { Scripted } from './fakeServer';
import {
  NAV_CHROME,
  PAIRING_ID,
  PORT,
  PORT_B,
  TOKEN,
  TOKEN_B,
  makeRecord,
  makeRecordB,
  statusBody,
  type Rec,
  type Reply,
} from './fixtures';
import { World, assertWorldClean, makeShared, makeWorld, pairMsg, statusMsg, unpairMsg } from './world';
import { createFakeChrome, popupSender } from '../fakes/fake-chrome';
import type { Client } from '../../extension/src/lib/client';
import { registerHandlers } from '../../extension/src/lib/messages';
import { createStore } from '../../extension/src/lib/store';

/** AM-2: one reply, with whether a record was on disk at the moment it was sent. */
interface ReplyCheck {
  state: string;
  paired: boolean;
  stored: boolean;
}
const checks = new Map<World, ReplyCheck[]>();

/**
 * Records, for every reply the worker sends, `paired` and "a record is on disk right now" (the fake chrome calls the trace at the
 * moment of sendResponse, after the reply was pushed to `sent`). The fake IndexedDB backing map is the disk. Checked in afterEach.
 */
function watchReplies(w: World): void {
  const found: ReplyCheck[] = [];
  checks.set(w, found);
  const dispatched: { sent: unknown[]; seen: number }[] = [];
  const onMessage = w.chrome.runtime.onMessage;
  const realDispatch = onMessage.dispatch;
  onMessage.dispatch = (message, sender, options) => {
    const d = realDispatch(message, sender, options);
    dispatched.push({ sent: d.sent, seen: 0 });
    return d;
  };
  const trace = w.shared.trace;
  const realPush = trace.push.bind(trace);
  trace.push = (event: string): void => {
    realPush(event);
    if (event !== 'reply') return;
    const stored = w.shared.backing.dbs.get('fetchly')?.stores.get('kv')?.get('pairing') !== undefined;
    for (const d of dispatched) {
      while (d.seen < d.sent.length) {
        const reply = d.sent[d.seen] as { state?: unknown; paired?: unknown } | undefined;
        d.seen += 1;
        if (reply && typeof reply.state === 'string' && typeof reply.paired === 'boolean') found.push({ state: reply.state, paired: reply.paired, stored });
      }
    }
  };
}

const worlds: World[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) {
    assertWorldClean(w);
    for (const c of checks.get(w) ?? []) {
      if (c.state === 'storageBlocked') expect(c.paired, 'a storageBlocked reply says paired false').toBe(false);
      else expect(c.paired, `the paired of a ${c.state} reply equals "a record is on disk at reply time"`).toBe(c.stored);
    }
    checks.delete(w);
  }
});
const watch = (w: World): World => {
  watchReplies(w);
  worlds.push(w);
  return w;
};
const mk = (opts: { uiLanguage?: string } = {}): World => watch(makeWorld(opts));
const REC = makeRecord();
/** A world with the pairing REC on disk and in the app. */
const pairedWorld = (): World => {
  const w = mk();
  w.install(REC);
  return w;
};
const cred = (n: number): { token: string; pairingId: string } => ({ token: `TOKENMARKER_${n}`.padEnd(43, 'x'), pairingId: `PAIRIDMARKER_${n}`.padEnd(22, 'y') });
/** A world with no record and a pairing code open in the app. */
const pairWorld = (): World => {
  const w = mk();
  const s = w.server();
  s.openCode('ABCDEFGH');
  s.issue = { token: TOKEN, pairingId: PAIRING_ID };
  return w;
};
const noPuts = (w: World): boolean => !w.idb.log.some((e) => e.op === 'put' || e.op === 'delete');
/** The next request to `path` waits at the app until release() is called, then gets the server's own answer. */
function holdAt(s: ReturnType<World['server']>, path: string): { release(): void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  s.once(path, async () => {
    await gate;
    return 'default' as const;
  });
  return { release: () => release() };
}
/** Waits `ms` of the fake clock inside a scripted answer (the clock must be advanced by the spec). */
const clockDelay = (w: World, ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    w.clock.setTimer(resolve, ms);
  });
const skewHello =
  (w: World, by: { mono?: number; wall?: number }): Scripted =>
  () => {
    w.clock.skew(by);
    return 'default';
  };

// ---------------------------------------------------------------------------------------------

describe('sender and shape: a refused message gets no reply and causes no work', () => {
  const VALID: [string, unknown][] = [
    ['status', { type: 'fetchly:status' }],
    ['unpair', { type: 'fetchly:unpair' }],
    ['pair', { type: 'fetchly:pair', pairingString: '38917-ABCDEFGH', label: 'x' }],
  ];

  const senders = (w: World): [string, unknown][] => {
    const id = w.chrome.runtime.id;
    const url = w.chrome.runtime.getURL('popup.html');
    return [
      ['another extension id', { id: 'p'.repeat(32), url }],
      ['no id', { url }],
      ['another page of this extension', { id, url: w.chrome.runtime.getURL('other.html') }],
      ['popup.html with a query', { id, url: `${url}?x=1` }],
      ['popup.html with a fragment', { id, url: `${url}#x` }],
      ['popup.html in another extension', { id, url: `chrome-extension://${'p'.repeat(32)}/popup.html` }],
      ['a web page', { id, url: 'https://example.com/' }],
      ['no url', { id }],
      ['a tab object (a content script or a page)', { id, url, tab: { id: 1, url: 'https://example.com/' } }],
      ['an empty tab object', { id, url, tab: {} }],
      ['tab null', { id, url, tab: null }],
      ['undefined', undefined],
      ['null', null],
      ['a string', 'popup'],
      ['an array', []],
    ];
  };

  it.each(senders(makeWorld()).map(([n]) => n))('sender: %s', async (name) => {
    for (const [type, msg] of VALID) {
      const w = pairedWorld();
      const sender = senders(w).find(([n]) => n === name)?.[1];
      const d = w.chrome.runtime.onMessage.dispatch(msg, sender);
      expect(d.returned, `${type}: the listener returns false`).toBe(false);
      expect(await d.reply, `${type}: no reply`).toBeUndefined();
      expect(d.sent, `${type}: sendResponse is never called`).toEqual([]);
      await w.idle();
      expect(w.net.log, `${type}: nothing fetched`).toEqual([]);
      expect(w.idb.log.filter((e) => e.op !== 'open' && e.op !== 'createObjectStore' && e.op !== 'close'), `${type}: nothing stored`).toEqual([]);
      expect(w.idb.peek()).toEqual(REC);
    }
  });

  const BAD: [string, unknown][] = [
    ['an unknown type', { type: 'fetchly:other' }],
    ['a type without the prefix', { type: 'status' }],
    ['a type in the wrong case', { type: 'fetchly:Status' }],
    ['a type with a trailing space', { type: 'fetchly:status ' }],
    ['an empty type', { type: '' }],
    ['a numeric type', { type: 1 }],
    ['an array type', { type: ['fetchly:status'] }],
    ['no type', {}],
    ['an extra key on status', { type: 'fetchly:status', extra: 1 }],
    ['a token key on status', { type: 'fetchly:status', token: TOKEN }],
    ['an extra key on unpair', { type: 'fetchly:unpair', extra: 1 }],
    ['a token key on unpair', { type: 'fetchly:unpair', token: TOKEN }],
    ['an extra key on pair', { type: 'fetchly:pair', pairingString: '38917-ABCDEFGH', label: 'x', extra: 1 }],
    ['a token key on pair', { type: 'fetchly:pair', pairingString: '38917-ABCDEFGH', label: 'x', token: TOKEN }],
    ['a port key on pair', { type: 'fetchly:pair', pairingString: '38917-ABCDEFGH', label: 'x', port: 38917 }],
    ['pair without label', { type: 'fetchly:pair', pairingString: '38917-ABCDEFGH' }],
    ['pair without pairingString', { type: 'fetchly:pair', label: 'x' }],
    ['a numeric pairingString', { type: 'fetchly:pair', pairingString: 38917, label: 'x' }],
    ['a null pairingString', { type: 'fetchly:pair', pairingString: null, label: 'x' }],
    ['an array pairingString', { type: 'fetchly:pair', pairingString: ['38917-ABCDEFGH'], label: 'x' }],
    ['an object pairingString', { type: 'fetchly:pair', pairingString: { toString: () => '38917-ABCDEFGH' }, label: 'x' }],
    ['a numeric label', { type: 'fetchly:pair', pairingString: '38917-ABCDEFGH', label: 5 }],
    ['a null label', { type: 'fetchly:pair', pairingString: '38917-ABCDEFGH', label: null }],
    ['an undefined label', { type: 'fetchly:pair', pairingString: '38917-ABCDEFGH', label: undefined }],
    ['an array label', { type: 'fetchly:pair', pairingString: '38917-ABCDEFGH', label: ['x'] }],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'fetchly:status'],
    ['a number', 1],
    ['true', true],
    ['an array', ['fetchly:status']],
    ['an object whose type is inherited', Object.create({ type: 'fetchly:status' }) as object],
  ];

  it.each(BAD)('message: %s', async (_name, msg) => {
    const w = pairedWorld();
    const d = w.chrome.runtime.onMessage.dispatch(msg, { id: w.chrome.runtime.id, url: w.chrome.runtime.getURL('popup.html') });
    expect(d.returned).toBe(false);
    expect(await d.reply).toBeUndefined();
    expect(d.sent).toEqual([]);
    await w.idle();
    expect(w.net.log).toEqual([]);
    expect(w.idb.log.filter((e) => e.op !== 'open' && e.op !== 'createObjectStore' && e.op !== 'close')).toEqual([]);
    expect(w.idb.peek()).toEqual(REC);
  });

  it('an accepted message makes the listener return true, for each of the three types', async () => {
    for (const [type, msg] of VALID) {
      const w = pairWorld();
      w.install(REC);
      const d = w.dispatch(msg);
      expect(d.returned, type).toBe(true);
      expect(await d.reply, type).toBeDefined();
    }
  });

  it('the handlers add exactly one listener, and the fake chrome has no storage (DV1)', () => {
    const w = mk();
    expect(w.chrome.runtime.onMessage.count).toBe(1);
    expect('storage' in w.chrome).toBe(false);
  });

  it('a pairingString over 64 units is accepted and answers badInput, nothing sent; 64 units pairs', async () => {
    const over = pairWorld();
    const d = over.dispatch(pairMsg(`${' '.repeat(26)}${PORT}-ABCDEFGH${' '.repeat(25)}`));
    expect(`${' '.repeat(26)}${PORT}-ABCDEFGH${' '.repeat(25)}`).toHaveLength(65);
    expect(d.returned).toBe(true);
    expect(await d.reply).toEqual({ state: 'badInput', paired: false });
    await over.idle();
    expect(over.net.log).toEqual([]);
    expect(noPuts(over)).toBe(true);

    const exact = pairWorld();
    const s = `${' '.repeat(25)}${PORT}-ABCDEFGH${' '.repeat(25)}`;
    expect(s).toHaveLength(64);
    expect(await exact.send(pairMsg(s))).toEqual({ state: 'checking', paired: true });
    expect(exact.net.log).toHaveLength(1);
  });

  it('a label over 64 units is accepted and answers badInput, nothing sent; 64 units pairs, cut to 40', async () => {
    const over = pairWorld();
    const d = over.dispatch(pairMsg(`${PORT}-ABCDEFGH`, 'a'.repeat(65)));
    expect(d.returned).toBe(true);
    expect(await d.reply).toEqual({ state: 'badInput', paired: false });
    await over.idle();
    expect(over.net.log).toEqual([]);

    const exact = pairWorld();
    expect(await exact.send(pairMsg(`${PORT}-ABCDEFGH`, 'a'.repeat(64)))).toEqual({ state: 'checking', paired: true });
    expect((exact.net.log[0]?.bodyJson as { label: string }).label).toBe('a'.repeat(40));
  });
});

// ---------------------------------------------------------------------------------------------

describe('status: every row of plan section 5, with its R2-1 `paired` value and the record after it', () => {
  interface Row {
    name: string;
    expected: Reply;
    /** What is stored afterwards. */
    after: 'kept' | 'removed';
    /** The request (1 = the hello, 2 = the token request) that hangs, so the clock moves 5000 ms. */
    hangAt?: 1 | 2;
    /** How many requests were made; the default is 2. */
    requests?: 1 | 2;
    setup(w: World): void;
  }
  const hello = (w: World, a: Scripted): void => w.server().once('/v1/hello', a);
  const stat = (w: World, a: Scripted): void => w.server().once('/v1/status', a);
  const wrongProof = (w: World): Scripted => (req) => json(200, { proof: w.server().proofFor(req, { token: TOKEN_B }) });

  const ok = (appVersion = '0.1.0'): Reply => ({ state: 'connected', paired: true, appVersion });
  const kept = (state: Reply['state']): Reply => ({ state, paired: true });

  const ROWS: Row[] = [
    // appNotRunning: the record is kept
    { name: 'hello rejects', expected: kept('appNotRunning'), after: 'kept', requests: 1, setup: (w) => hello(w, reject()) },
    { name: 'nothing listens on the port', expected: kept('appNotRunning'), after: 'kept', requests: 1, setup: (w) => w.net.servers.clear() },
    { name: 'the hello body stream errors', expected: kept('appNotRunning'), after: 'kept', requests: 1, setup: (w) => hello(w, streamError(200)) },
    { name: 'the hello hangs: 5 s pass', expected: kept('appNotRunning'), after: 'kept', requests: 1, hangAt: 1, setup: (w) => hello(w, hang()) },
    { name: 'the request rejects after a right proof (app closed between hello and request)', expected: kept('appNotRunning'), after: 'kept', setup: (w) => stat(w, reject()) },
    { name: 'the request body stream errors', expected: kept('appNotRunning'), after: 'kept', setup: (w) => stat(w, streamError(200)) },
    { name: 'the request hangs: 5 s pass', expected: kept('appNotRunning'), after: 'kept', hangAt: 2, setup: (w) => stat(w, hang()) },
    // notPaired
    { name: 'hello 404 unknown_pairing: the form AND Unpair, the record kept (E10)', expected: { state: 'notPaired', paired: true }, after: 'kept', requests: 1, setup: (w) => w.server().pairings.clear() },
    { name: 'a right proof, then 401 bad_token: removed', expected: { state: 'notPaired', paired: false }, after: 'removed', setup: (w) => stat(w, err(401, 'bad_token')) },
    { name: 'a right proof, then 403 bad_origin: removed', expected: { state: 'notPaired', paired: false }, after: 'removed', setup: (w) => stat(w, err(403, 'bad_origin')) },
    // wrongProgram: not JSON, another status, a bad shape, a wrong proof; the record is kept
    { name: 'hello not JSON', expected: kept('wrongProgram'), after: 'kept', requests: 1, setup: (w) => hello(w, text(200, '<html>hi</html>')) },
    { name: 'hello 500', expected: kept('wrongProgram'), after: 'kept', requests: 1, setup: (w) => hello(w, json(500, { error: 'not_ready' })) },
    { name: 'hello 403 bad_origin', expected: kept('wrongProgram'), after: 'kept', requests: 1, setup: (w) => hello(w, err(403, 'bad_origin')) },
    { name: 'hello 404 not_found', expected: kept('wrongProgram'), after: 'kept', requests: 1, setup: (w) => hello(w, err(404, 'not_found')) },
    { name: 'hello with a bad shape', expected: kept('wrongProgram'), after: 'kept', requests: 1, setup: (w) => hello(w, json(200, { proof: 'short' })) },
    { name: 'hello with a wrong proof', expected: kept('wrongProgram'), after: 'kept', requests: 1, setup: (w) => hello(w, wrongProof(w)) },
    { name: 'hello answers with an opaque redirect (status 0, P4c)', expected: kept('wrongProgram'), after: 'kept', requests: 1, setup: (w) => hello(w, opaqueRedirect()) },
    // connected
    { name: 'a right proof, then 200 of the exact shape (engine ready)', expected: ok(), after: 'kept', setup: () => undefined },
    { name: 'engine notInstalled', expected: ok(), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ engine: 'notInstalled' }))) },
    { name: 'engine starting', expected: ok(), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ engine: 'starting' }))) },
    { name: 'engine error', expected: ok(), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ engine: 'error' }))) },
    { name: 'an appVersion of 64 units', expected: ok('v'.repeat(64)), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ appVersion: 'v'.repeat(64) }))) },
    // rateLimited
    { name: '429 rate_limited', expected: kept('rateLimited'), after: 'kept', setup: (w) => stat(w, err(429, 'rate_limited')) },
    // appError: 5xx, or a right proof then a 200 that is not JSON
    { name: '500 bare', expected: kept('appError'), after: 'kept', setup: (w) => stat(w, text(500, '')) },
    { name: '500 with a body', expected: kept('appError'), after: 'kept', setup: (w) => stat(w, json(500, { oops: true })) },
    { name: '502', expected: kept('appError'), after: 'kept', setup: (w) => stat(w, json(502, {})) },
    { name: '503 not_ready', expected: kept('appError'), after: 'kept', setup: (w) => stat(w, err(503, 'not_ready')) },
    { name: '599 (the last 5xx)', expected: kept('appError'), after: 'kept', setup: (w) => stat(w, json(599, {})) },
    { name: 'a 200 that is not JSON', expected: kept('appError'), after: 'kept', setup: (w) => stat(w, text(200, 'plain text')) },
    { name: 'a 200 with an empty body', expected: kept('appError'), after: 'kept', setup: (w) => stat(w, text(200, '')) },
    // mismatch (R2-3): a right proof, then these
    { name: '400 bad_request', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, err(400, 'bad_request')) },
    { name: '403 bad_host', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, err(403, 'bad_host')) },
    { name: '404 not_found', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, err(404, 'not_found')) },
    { name: '405 method_not_allowed', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, err(405, 'method_not_allowed')) },
    { name: '415 bad_content_type', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, err(415, 'bad_content_type')) },
    { name: '413 too_large', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, err(413, 'too_large')) },
    { name: '429 busy (told apart from rate_limited by the token)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, err(429, 'busy')) },
    { name: '429 with no token', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, text(429, 'slow down')) },
    { name: 'status 0 (an opaque redirect)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, opaqueRedirect()) },
    { name: 'status 418', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(418, {})) },
    { name: 'status 499 (just below 5xx)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(499, {})) },
    { name: 'status 600 (just above 5xx)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(600, {})) },
    { name: 'status 201 with a valid body', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(201, statusBody())) },
    { name: 'a 200 with a wrong engine', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ engine: 'busy' }))) },
    { name: 'a 200 with the engine in upper case', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ engine: 'READY' }))) },
    { name: 'a 200 with a numeric engine', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ engine: 1 }))) },
    { name: 'a 200 with an appVersion of 65 units', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ appVersion: 'v'.repeat(65) }))) },
    { name: 'a 200 with an empty appVersion', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ appVersion: '' }))) },
    { name: 'a 200 with a bad appVersion (a control character)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ appVersion: '0.1\u0007' }))) },
    { name: 'a 200 with a numeric appVersion', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ appVersion: 1 }))) },
    { name: 'a 200 with an extra key', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ extra: 1 }))) },
    { name: 'a 200 with a missing key (no engine)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, { app: 'fetchly', protocol: 1, appVersion: '0.1.0' })) },
    { name: 'a 200 with a missing key (no app)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, { protocol: 1, appVersion: '0.1.0', engine: 'ready' })) },
    { name: 'a 200 of another app', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ app: 'other' }))) },
    { name: 'a 200 with protocol 2', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ protocol: 2 }))) },
    { name: 'a 200 with protocol "1"', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, statusBody({ protocol: '1' }))) },
    { name: 'a 200 of the empty object', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, {})) },
    // Amendment 1 (AM-4): a 200 whose body is valid JSON but not an object is `wrong_shape` for the client, and `mismatch` here. A 200 that
    // is not JSON at all stays `appError` (the rows above: 'a 200 that is not JSON', 'a 200 with an empty body').
    { name: 'a 200 holding a JSON array (wrong_shape)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, [])) },
    { name: 'a 200 holding a JSON array of the status object (wrong_shape)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, [statusBody()])) },
    { name: 'a 200 holding JSON null (wrong_shape)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, null)) },
    { name: 'a 200 holding a JSON string (wrong_shape)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, 'x')) },
    { name: 'a 200 holding a JSON number (wrong_shape)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, 5)) },
    { name: 'a 200 holding JSON true (wrong_shape)', expected: kept('mismatch'), after: 'kept', setup: (w) => stat(w, json(200, true)) },
    // slow
    { name: 'a stale proof (the wall clock passed 5000 ms)', expected: kept('slow'), after: 'kept', requests: 1, setup: (w) => hello(w, skewHello(w, { mono: 100, wall: 5001 })) },
    { name: 'a stale proof (the monotonic clock passed 5000 ms)', expected: kept('slow'), after: 'kept', requests: 1, setup: (w) => hello(w, skewHello(w, { mono: 5001, wall: 100 })) },
  ];

  it.each(ROWS.map((r) => [r.name, r] as [string, Row]))('%s', async (_name, row) => {
    const w = pairedWorld();
    row.setup(w);
    const t = track(w.send(statusMsg));
    if (row.hangAt) {
      await until(() => w.net.log.length >= (row.hangAt ?? 1));
      w.clock.advance(5000);
    }
    const reply = await t.promise;
    expect(reply).toEqual(row.expected);
    await w.idle();
    expect(w.net.log).toHaveLength(row.requests ?? 2);
    if (w.net.log.length === 1) expect(w.net.log.every((r) => r.authorization === undefined)).toBe(true);
    expect(w.idb.peek()).toEqual(row.after === 'kept' ? REC : undefined);
    // Nothing but the status flow touched the app: no unpair, no pair.
    expect(w.net.log.map((r) => r.path).filter((p) => p !== '/v1/hello' && p !== '/v1/status')).toEqual([]);
  });

  it('the rows cover every R2-3 row of the plan: 400, 403 bad_host, 404, 405, 415, 413, 429 busy, status 0, any other status, a 200 of the wrong shape', () => {
    const names = ROWS.map((r) => r.name).join('|');
    for (const needle of ['400 bad_request', '403 bad_host', '404 not_found', '405', '415', '413', '429 busy', 'status 0', 'status 418', 'wrong engine', 'extra key']) expect(names).toContain(needle);
  });

  it('no record: notPaired, paired false, nothing sent', async () => {
    const w = mk();
    expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
    expect(w.net.log).toEqual([]);
  });

  it('a record of another shape is removed and reads as no record', async () => {
    const w = mk();
    w.idb.seed({ ...REC, v: 2 });
    expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
    expect(w.net.log).toEqual([]);
    expect(w.idb.peek()).toBeUndefined();
  });

  it('the store cannot be read: storageBlocked, paired false, nothing sent', async () => {
    for (const set of [
      (w: World) => {
        w.idb.sw.openError = 'UnknownError';
      },
      (w: World) => {
        w.idb.sw.openThrows = true;
      },
      (w: World) => {
        w.idb.sw.openBlocked = true;
      },
      (w: World) => {
        w.idb.sw.abortAt = 'any';
      },
      (w: World) => {
        w.idb.sw.transactionThrows = true;
      },
    ]) {
      const w = pairedWorld();
      set(w);
      expect(await w.send(statusMsg)).toEqual({ state: 'storageBlocked', paired: false });
      expect(w.net.log).toEqual([]);
    }
  });

  it('the store never answers: storageBlocked after the 3000 ms deadline, nothing sent', async () => {
    const w = pairedWorld();
    w.idb.sw.openHang = true;
    const t = track(w.send(statusMsg));
    await w.idle();
    w.clock.advance(2999);
    await w.idle();
    expect(t.state).toBe('pending');
    w.clock.advance(1);
    expect(await t.promise).toEqual({ state: 'storageBlocked', paired: false });
    expect(w.net.log).toEqual([]);
  });

  it('a status never changes the record when it ends in any state but a removal', async () => {
    for (const row of ROWS.filter((r) => r.after === 'kept').slice(0, 10)) {
      const w = pairedWorld();
      row.setup(w);
      const t = track(w.send(statusMsg));
      if (row.hangAt) {
        await until(() => w.net.log.length >= (row.hangAt ?? 1));
        w.clock.advance(5000);
      }
      await t.promise;
      expect(w.idb.peek(), row.name).toEqual(REC);
      expect(w.idb.log.filter((e) => e.op === 'put' || e.op === 'delete'), row.name).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('pair (section 5, "Pairing", under the mutex)', () => {
  it('the port dialled is the pairing string\'s, also when a stored record holds another', async () => {
    const w = pairWorld();
    const old = makeRecordB();
    w.install(old);
    expect(await w.send(pairMsg(`${PORT}-ABCDEFGH`))).toEqual({ state: 'checking', paired: true });
    expect(w.net.to(PORT_B)).toEqual([]);
    expect(w.net.log.map((r) => r.url)).toEqual([`http://127.0.0.1:${PORT}/v1/pair`]);
    expect((w.idb.peek() as Rec).port).toBe(PORT);
  });

  it.each(['', 'hello', '38917', '1023-ABCDEFGH', '65536-ABCDEFGH', '38917-ABCDEFG', '38917-ABCDEFGHJ', '38917-ABCDEFGU', '038917-ABCDEFGH', '38917 ABCDEFGH', 'x'.repeat(30)])(
    'an unparsable string %j: badInput, nothing sent, nothing stored',
    async (s) => {
      const w = pairWorld();
      expect(await w.send(pairMsg(s))).toEqual({ state: 'badInput', paired: false });
      await w.idle();
      expect(w.net.log).toEqual([]);
      expect(noPuts(w)).toBe(true);
    },
  );

  it('normalises the string before it parses: lower case, spaces, and O, I, L after the dash', async () => {
    const w = pairWorld();
    w.server().openCode('01100000');
    expect(await w.send(pairMsg(` ${PORT}-oil00000 `))).toEqual({ state: 'checking', paired: true });
    expect(w.net.log[0]?.bodyJson).toMatchObject({ code: '01100000' });
  });

  it('a real store.read() (open plus a readwrite transaction) runs before any fetch', async () => {
    const w = pairWorld();
    await w.send(pairMsg());
    const ev = w.trace.events;
    const fetchAt = ev.indexOf(`fetch:${PORT}:/v1/pair`);
    expect(fetchAt).toBeGreaterThan(0);
    const openAt = ev.indexOf('idb:open');
    const txAt = ev.indexOf('idb:tx:readwrite');
    expect(openAt).toBeGreaterThanOrEqual(0);
    expect(txAt).toBeGreaterThan(openAt);
    expect(txAt).toBeLessThan(fetchAt);
    expect(ev.indexOf('idb:commit')).toBeLessThan(fetchAt);
  });

  it.each([
    ['open fails', (w: World) => (w.idb.sw.openError = 'UnknownError')],
    ['open throws', (w: World) => (w.idb.sw.openThrows = true)],
    ['open is blocked', (w: World) => (w.idb.sw.openBlocked = true)],
    ['the database is newer', (w: World) => w.idb.backing.dbs.set('fetchly', { version: 2, stores: new Map() })],
    ['the transaction aborts', (w: World) => (w.idb.sw.abortAt = 'any')],
    ['the transaction cannot be created', (w: World) => (w.idb.sw.transactionThrows = true)],
  ] as [string, (w: World) => unknown][])('when the store cannot be read (%s): storageBlocked, paired false, nothing sent', async (_n, set) => {
    const w = pairWorld();
    set(w);
    expect(await w.send(pairMsg())).toEqual({ state: 'storageBlocked', paired: false });
    await w.idle();
    expect(w.net.log).toEqual([]);
    expect(noPuts(w)).toBe(true);
  });

  it('success writes { v: 1, pairingId, token, port, appVersion, label, pairedAt }, then replies checking, before any other request', async () => {
    const w = pairWorld();
    const before = Date.now();
    const reply = await w.send(pairMsg(`${PORT}-ABCDEFGH`, 'My PC'));
    const after = Date.now();
    expect(reply).toEqual({ state: 'checking', paired: true });
    const stored = w.idb.peek() as Rec;
    expect(stored).toEqual({ v: 1, pairingId: PAIRING_ID, token: TOKEN, port: PORT, appVersion: '0.1.0', label: 'My PC', pairedAt: expect.any(Number) });
    expect(Object.keys(stored).sort()).toEqual(['appVersion', 'label', 'pairedAt', 'pairingId', 'port', 'token', 'v']);
    expect(stored.pairedAt).toBeGreaterThanOrEqual(before);
    expect(stored.pairedAt).toBeLessThanOrEqual(after);
    await w.idle();
    const ev = w.trace.events;
    const iReply = ev.indexOf('reply');
    expect(iReply).toBeGreaterThan(-1);
    // The write is committed before the reply is sent.
    expect(ev.lastIndexOf('idb:commit')).toBeLessThan(iReply);
    // No request but the pair itself, before or after the reply.
    expect(ev.filter((e) => e.startsWith('fetch:'))).toEqual([`fetch:${PORT}:/v1/pair`]);
    // The popup sends the next message (status), not the worker.
    expect(w.net.log).toHaveLength(1);
  });

  it('the label sent and stored is makeLabel(field, browserName())', async () => {
    const cases: [string, string][] = [
      ['My PC', 'My PC'],
      ['', 'Edge'],
      ['   ', 'Edge'],
      ['\u0001‮', 'Edge'],
      ['a\u0001b‮c', 'abc'],
      ['x'.repeat(50), 'x'.repeat(40)],
      [`${'a'.repeat(39)}😀`, 'a'.repeat(39)],
      ['  Zoë  ', 'Zoë'],
    ];
    for (const [field, expected] of cases) {
      const w = pairWorld();
      await w.send(pairMsg(`${PORT}-ABCDEFGH`, field));
      expect((w.net.log[0]?.bodyJson as { label: string }).label, JSON.stringify(field)).toBe(expected);
      expect((w.idb.peek() as Rec).label).toBe(expected);
      expect([...w.server().pairings.values()][0]?.label).toBe(expected);
    }
  });

  it('an empty label falls back to the browser name: Chrome for a Chrome browser', async () => {
    const shared = makeShared();
    const w = watch(new World(shared, { nav: NAV_CHROME }));
    w.server().openCode('ABCDEFGH');
    await w.send(pairMsg(`${PORT}-ABCDEFGH`, ''));
    expect((w.net.log[0]?.bodyJson as { label: string }).label).toBe('Chrome');
  });

  it('a failed write: one best-effort /v1/unpair with the new credentials, THEN storageFailed', async () => {
    const w = pairWorld();
    w.idb.sw.abortAt = 'write';
    const reply = await w.send(pairMsg());
    expect(reply).toEqual({ state: 'storageFailed', paired: false });
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair', '/v1/hello', '/v1/unpair']);
    expect(w.net.log[1]?.bodyJson).toMatchObject({ pairingId: PAIRING_ID });
    expect(w.net.log[1]?.url).toBe(`http://127.0.0.1:${PORT}/v1/hello`);
    expect(w.net.log[2]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(w.net.log[2]?.url).toBe(`http://127.0.0.1:${PORT}/v1/unpair`);
    expect(w.idb.peek()).toBeUndefined();
    expect(w.server().pairings.has(PAIRING_ID)).toBe(false);
    // The reply is sent after the unpair, not before.
    const ev = w.trace.events;
    expect(ev.indexOf('reply')).toBeGreaterThan(ev.lastIndexOf(`fetch:${PORT}:/v1/unpair`));
  });

  it('a failed best-effort unpair (the hello hangs) still ends in storageFailed, after 5 s', async () => {
    const w = pairWorld();
    w.idb.sw.abortAt = 'write';
    w.server().once('/v1/hello', hang());
    const t = track(w.send(pairMsg()));
    await until(() => w.net.log.length === 2);
    expect(t.state).toBe('pending');
    w.clock.advance(5000);
    expect(await t.promise).toEqual({ state: 'storageFailed', paired: false });
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair', '/v1/hello']);
    expect(w.net.log.every((r) => r.authorization === undefined)).toBe(true);
  });

  it('a write that never completes: the 3000 ms deadline aborts it, then one best-effort unpair, then storageFailed', async () => {
    const w = pairWorld();
    w.idb.sw.holdAt = 'write';
    const t = track(w.send(pairMsg()));
    await until(() => w.idb.held.length === 1);
    expect(t.state).toBe('pending');
    w.clock.advance(2999);
    await w.idle();
    expect(t.state).toBe('pending');
    w.clock.advance(1);
    expect(await t.promise).toEqual({ state: 'storageFailed', paired: false });
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair', '/v1/hello', '/v1/unpair']);
    expect(w.idb.peek()).toBeUndefined();
  });

  it('mismatch from pair (a bad appVersion): one best-effort /v1/unpair with the new credentials, nothing stored, mismatch', async () => {
    const w = pairWorld();
    w.server().appVersion = 'v'.repeat(65);
    const reply = await w.send(pairMsg());
    expect(reply).toEqual({ state: 'mismatch', paired: false });
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair', '/v1/hello', '/v1/unpair']);
    expect(w.net.log[1]?.bodyJson).toMatchObject({ pairingId: PAIRING_ID });
    expect(w.net.log[2]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(w.idb.peek()).toBeUndefined();
    expect(noPuts(w)).toBe(true);
    expect(w.server().pairings.size).toBe(0);
  });

  it.each([
    ['protocol 2', { pairingId: PAIRING_ID, token: TOKEN, protocol: 2, appVersion: '0.1.0' }],
    ['an extra key', { pairingId: PAIRING_ID, token: TOKEN, protocol: 1, appVersion: '0.1.0', extra: 1 }],
    ['a missing appVersion', { pairingId: PAIRING_ID, token: TOKEN, protocol: 1 }],
  ])('mismatch from pair (%s): unpair with the new credentials, nothing stored', async (_n, body) => {
    const w = pairWorld();
    // The scripted answer bypasses the fake server's own pair(), so the app has to know the pairing it "issued".
    w.server().addPairing({ pairingId: PAIRING_ID, token: TOKEN });
    w.server().once('/v1/pair', json(200, body));
    expect(await w.send(pairMsg())).toEqual({ state: 'mismatch', paired: false });
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair', '/v1/hello', '/v1/unpair']);
    expect(w.net.log[2]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(w.server().pairings.size).toBe(0);
    expect(w.idb.peek()).toBeUndefined();
  });

  it('a 400 from pair is mismatch too, with nothing to unpair and nothing stored', async () => {
    const w = pairWorld();
    w.server().once('/v1/pair', err(400, 'bad_request'));
    expect(await w.send(pairMsg())).toEqual({ state: 'mismatch', paired: false });
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair']);
    expect(noPuts(w)).toBe(true);
  });

  const RESULTS: [string, Reply['state'], (w: World) => void][] = [
    ['a wrong code', 'wrongCode', (w) => w.server().openCode('ZZZZZZZZ')],
    ['no code open', 'pairingClosed', (w) => (w.server().code = null)],
    ['a 401 bad_code', 'wrongCode', (w) => w.server().once('/v1/pair', err(401, 'bad_code'))],
    ['a 403 pairing_closed', 'pairingClosed', (w) => w.server().once('/v1/pair', err(403, 'pairing_closed'))],
    ['a rejection', 'appNotRunning', (w) => w.server().once('/v1/pair', reject())],
    ['nothing listening', 'appNotRunning', (w) => w.net.servers.clear()],
    ['a body stream error', 'appNotRunning', (w) => w.server().once('/v1/pair', streamError(200))],
    ['a 500', 'wrongProgram', (w) => w.server().once('/v1/pair', json(500, {}))],
    ['a 404 not_found', 'wrongProgram', (w) => w.server().once('/v1/pair', err(404, 'not_found'))],
    ['a 403 bad_origin', 'wrongProgram', (w) => w.server().once('/v1/pair', err(403, 'bad_origin'))],
    ['a 200 that is not JSON', 'wrongProgram', (w) => w.server().once('/v1/pair', text(200, 'hello'))],
    ['a 200 with a bad token', 'wrongProgram', (w) => w.server().once('/v1/pair', json(200, { pairingId: PAIRING_ID, token: 'short', protocol: 1, appVersion: '0.1.0' }))],
    ['a 200 with a bad pairingId', 'wrongProgram', (w) => w.server().once('/v1/pair', json(200, { pairingId: 'short', token: TOKEN, protocol: 1, appVersion: '0.1.0' }))],
    ['an opaque redirect', 'wrongProgram', (w) => w.server().once('/v1/pair', opaqueRedirect())],
    ['an endless body', 'wrongProgram', (w) => w.server().once('/v1/pair', { kind: 'infinite', status: 200 } as Answer)],
  ];
  it.each(RESULTS)('%s: %s, nothing stored', async (_n, state, set) => {
    const w = pairWorld();
    set(w);
    expect(await w.send(pairMsg())).toEqual({ state, paired: false });
    expect(w.idb.peek()).toBeUndefined();
    expect(noPuts(w)).toBe(true);
    // Only the pair request was made: no unpair (there are no credentials to unpair).
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair']);
  });

  it.each(RESULTS)('with a record stored, %s: %s with paired true (R2-1), the record untouched', async (_n, state, set) => {
    const w = pairWorld();
    w.install(makeRecordB());
    set(w);
    expect(await w.send(pairMsg())).toEqual({ state, paired: true });
    expect(w.idb.peek()).toEqual(makeRecordB());
    expect(noPuts(w)).toBe(true);
  });

  it('with a record stored: badInput, mismatch and storageFailed also say paired true; storageBlocked says false', async () => {
    const bad = pairWorld();
    bad.install(makeRecordB());
    expect(await bad.send(pairMsg('nonsense'))).toEqual({ state: 'badInput', paired: true });
    expect(bad.net.log).toEqual([]);

    const mismatch = pairWorld();
    mismatch.install(makeRecordB());
    mismatch.server().appVersion = 'v'.repeat(65);
    expect(await mismatch.send(pairMsg())).toEqual({ state: 'mismatch', paired: true });
    expect(mismatch.idb.peek()).toEqual(makeRecordB());

    const failed = pairWorld();
    failed.install(makeRecordB());
    failed.idb.sw.abortAt = 'write';
    expect(await failed.send(pairMsg())).toEqual({ state: 'storageFailed', paired: true });
    expect(failed.idb.peek()).toEqual(makeRecordB());

    const blocked = pairWorld();
    blocked.install(makeRecordB());
    blocked.idb.sw.openError = 'UnknownError';
    expect(await blocked.send(pairMsg())).toEqual({ state: 'storageBlocked', paired: false });
  });

  it('a pair that hangs for 5 s: appNotRunning', async () => {
    const w = pairWorld();
    w.server().once('/v1/pair', hang());
    const t = track(w.send(pairMsg()));
    await until(() => w.net.log.length === 1);
    w.clock.advance(4999);
    await w.idle();
    expect(t.state).toBe('pending');
    w.clock.advance(1);
    expect(await t.promise).toEqual({ state: 'appNotRunning', paired: false });
  });

  it('five wrong codes, then the right one: the code is closed (pairingClosed)', async () => {
    const w = pairWorld();
    for (let i = 0; i < 5; i += 1) expect(await w.send(pairMsg(`${PORT}-ZZZZZZZZ`))).toEqual({ state: 'wrongCode', paired: false });
    expect(await w.send(pairMsg(`${PORT}-ABCDEFGH`))).toEqual({ state: 'pairingClosed', paired: false });
  });

  it('a failure does not touch the record that is stored, and says paired: true (a record is stored after the operation)', async () => {
    const w = pairWorld();
    w.server().openCode('ZZZZZZZZ');
    w.install(makeRecordB());
    expect(await w.send(pairMsg())).toEqual({ state: 'wrongCode', paired: true });
    expect(w.idb.peek()).toEqual(makeRecordB());
    expect(noPuts(w)).toBe(true);
  });

  // Amendment 1 (AM-5), replaces "two pair messages at once run one after the other (the mutex): the second waits, then gets pairingClosed":
  // the mutex is a gate. A second pair arriving while a pair runs is not run and not queued: it is answered at once. Amendment 2 (AM2-1)
  // changes the answer from `checking` to `operationRunning`: `checking` keeps the meaning "ask for the status now", which a gated message
  // must not give (nothing was done, so there is nothing to ask about).
  it('two pair messages at once (AM-5, a gate, not a queue): pair 1 is held at the app, pair 2 gets operationRunning with no clock advance, /v1/pair is requested once', async () => {
    const w = pairWorld();
    const s = w.server();
    const gate = holdAt(s, '/v1/pair');
    const d1 = w.dispatch(pairMsg());
    await until(() => s.requests('/v1/pair').length >= 1);
    const started = w.clock.now();
    const d2 = w.dispatch(pairMsg());
    await until(() => d2.sent.length === 1);
    expect(d2.sent[0]).toEqual({ state: 'operationRunning', paired: false });
    expect(w.clock.now(), 'no clock advance').toBe(started);
    expect(d1.sent, 'pair 1 is still running').toEqual([]);
    expect(s.requests('/v1/pair')).toHaveLength(1);
    expect(w.net.log, 'pair 2 sent nothing').toHaveLength(1);
    expect(noPuts(w), 'pair 2 mutated nothing').toBe(true);
    gate.release();
    expect(await d1.reply).toEqual({ state: 'checking', paired: true });
    await w.idle();
    expect(s.requests('/v1/pair'), 'pair 2 was not queued: it never runs').toHaveLength(1);
    expect(s.maxInFlightPair).toBe(1);
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID });
  });
});

// ---------------------------------------------------------------------------------------------

describe('replacing a pairing (E13, R2-8)', () => {
  const OLD = makeRecordB(); // on PORT_B (40123)

  /** A world holding OLD, with a code open on PORT so a new pairing can replace it. */
  const replaceWorld = (): World => {
    const w = pairWorld();
    w.install(OLD);
    return w;
  };

  it('no unpair of the old record at pair time', async () => {
    const w = replaceWorld();
    expect(await w.send(pairMsg())).toEqual({ state: 'checking', paired: true });
    await w.idle();
    expect(w.net.to(PORT_B)).toEqual([]);
    expect(w.server(PORT_B).pairings.has(OLD.pairingId)).toBe(true);
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID });
  });

  it('after the next status with a right proof and a 200: one hello and one /v1/unpair to the old record\'s port, after the reply', async () => {
    const w = replaceWorld();
    await w.send(pairMsg());
    const reply = await w.send(statusMsg);
    expect(reply).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    await w.idle();
    const toOld = w.net.to(PORT_B);
    expect(toOld.map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    expect(toOld[0]?.bodyJson).toMatchObject({ pairingId: OLD.pairingId });
    expect(toOld[1]?.authorization).toBe(`Bearer ${OLD.token}`);
    expect(w.server(PORT_B).pairings.has(OLD.pairingId)).toBe(false);
    // After the reply, not before.
    const ev = w.trace.events;
    // The trace holds two replies here (pair, status); the status reply is the last one so far.
    expect(ev.filter((e) => e === 'reply')).toHaveLength(2);
    expect(ev.indexOf(`fetch:${PORT_B}:/v1/hello`)).toBeGreaterThan(ev.lastIndexOf('reply'));
    // The new record is untouched.
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID, token: TOKEN });
    // Forgotten: a later connected status sends nothing more to the old port.
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    expect(w.net.to(PORT_B)).toHaveLength(2);
  });

  it('a status that answers wrong_program sends none; a later connected status still does', async () => {
    const w = replaceWorld();
    await w.send(pairMsg());
    w.server().once('/v1/hello', text(200, 'not fetchly'));
    expect(await w.send(statusMsg)).toEqual({ state: 'wrongProgram', paired: true });
    await w.idle();
    expect(w.net.to(PORT_B)).toEqual([]);
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    expect(w.net.to(PORT_B).map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
  });

  it('a listener that answers only a shape-valid 200 cannot make A2 unpair the old entry (no right proof, no unpair)', async () => {
    const w = replaceWorld();
    await w.send(pairMsg());
    // The hello is answered with a wrong proof, and the status request would be answered with a perfect 200.
    w.server().once('/v1/hello', (req) => json(200, { proof: w.server().proofFor(req, { token: TOKEN_B }) }));
    w.server().once('/v1/status', json(200, statusBody()));
    expect(await w.send(statusMsg)).toEqual({ state: 'wrongProgram', paired: true });
    await w.idle();
    expect(w.net.to(PORT_B)).toEqual([]);
    expect(w.net.log.filter((r) => r.path === '/v1/status')).toEqual([]);
  });

  it.each([
    ['429 rate_limited', 'rateLimited', (w: World) => w.server().once('/v1/status', err(429, 'rate_limited'))],
    ['a 500', 'appError', (w: World) => w.server().once('/v1/status', text(500, ''))],
    ['a 200 of the wrong shape', 'mismatch', (w: World) => w.server().once('/v1/status', json(200, statusBody({ engine: 'nope' })))],
    ['a 400', 'mismatch', (w: World) => w.server().once('/v1/status', err(400, 'bad_request'))],
    ['a stale proof', 'slow', (w: World) => w.server().once('/v1/hello', skewHello(w, { mono: 5001, wall: 5001 }))],
    ['the request rejects', 'appNotRunning', (w: World) => w.server().once('/v1/status', reject())],
    ['the hello rejects', 'appNotRunning', (w: World) => w.server().once('/v1/hello', reject())],
    ['hello 404 unknown_pairing', 'notPaired', (w: World) => w.server().pairings.clear()],
  ] as [string, string, (w: World) => void][])('a status that ends %s sends nothing to the old record', async (_n, state, set) => {
    const w = replaceWorld();
    await w.send(pairMsg());
    set(w);
    expect(await w.send(statusMsg)).toMatchObject({ state });
    await w.idle();
    expect(w.net.to(PORT_B)).toEqual([]);
  });

  it('a failure of the old-record unpair changes nothing and is not retried', async () => {
    const w = replaceWorld();
    await w.send(pairMsg());
    w.server(PORT_B).down = true;
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    expect(w.net.to(PORT_B).map((r) => r.path)).toEqual(['/v1/hello']);
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID, token: TOKEN });
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    expect(w.net.to(PORT_B)).toHaveLength(1);
  });

  it('a failure of the old-record unpair after a right proof (a 401) leaves the old entry for the user and the new record intact', async () => {
    const w = replaceWorld();
    await w.send(pairMsg());
    w.server(PORT_B).once('/v1/unpair', err(401, 'bad_token'));
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID });
    expect(w.server(PORT_B).pairings.has(OLD.pairingId)).toBe(true);
  });

  it('R2-8: a second pair drops the first old record; the old one is then the record that was replaced second', async () => {
    const w = mk();
    const A = makeRecordB(); // port 40123
    w.install(A);
    const sB = w.server(40124);
    sB.openCode('ABCDEFGH');
    sB.issue = cred(2);
    const sC = w.server(PORT);
    sC.openCode('ABCDEFGH');
    sC.issue = cred(3);
    expect(await w.send(pairMsg('40124-ABCDEFGH', 'B'))).toEqual({ state: 'checking', paired: true });
    expect(await w.send(pairMsg(`${PORT}-ABCDEFGH`, 'C'))).toEqual({ state: 'checking', paired: true });
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    // B (the record the second pair replaced) is unpaired; A (replaced first) is never contacted.
    expect(w.net.to(PORT_B)).toEqual([]);
    const toB = w.net.to(40124).filter((r) => r.path !== '/v1/pair');
    expect(toB.map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    expect(toB[1]?.authorization).toBe(`Bearer ${cred(2).token}`);
  });

  it('R2-8: after an Unpair of the new record, nothing is ever sent to the old record\'s port', async () => {
    const w = mk();
    w.install(OLD);
    const sB = w.server(40124);
    sB.openCode('ABCDEFGH');
    sB.issue = cred(2);
    await w.send(pairMsg('40124-ABCDEFGH', 'B'));
    expect(await w.send(unpairMsg)).toEqual({ state: 'notPaired', paired: false });
    // A new pairing from an empty store replaces nothing.
    const sD = w.server(PORT);
    sD.openCode('ABCDEFGH');
    sD.issue = cred(4);
    await w.send(pairMsg(`${PORT}-ABCDEFGH`, 'D'));
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    expect(w.net.to(PORT_B)).toEqual([]);
    expect(w.server(PORT_B).pairings.has(OLD.pairingId)).toBe(true);
  });

  it('R2-8: after any removeIf (a 401 bad_token on the new record), nothing is ever sent to the old record\'s port', async () => {
    const w = mk();
    w.install(OLD);
    const sB = w.server(40124);
    sB.openCode('ABCDEFGH');
    sB.issue = cred(2);
    await w.send(pairMsg('40124-ABCDEFGH', 'B'));
    sB.once('/v1/status', err(401, 'bad_token'));
    expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
    const sD = w.server(PORT);
    sD.openCode('ABCDEFGH');
    sD.issue = cred(4);
    await w.send(pairMsg(`${PORT}-ABCDEFGH`, 'D'));
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    expect(w.net.to(PORT_B)).toEqual([]);
  });

  describe('R2-8 where a later pair cannot hide it: a status is in flight while the new record is removed', () => {
    /** OLD replaced by a record on 40124; a status for the new record then waits at the app until `release()`. */
    async function inFlight(): Promise<{ w: World; release: () => void; status: ReturnType<World['dispatch']> }> {
      const w = mk();
      w.install(OLD);
      const sB = w.server(40124);
      sB.openCode('ABCDEFGH');
      sB.issue = cred(2);
      await w.send(pairMsg('40124-ABCDEFGH', 'B'));
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      sB.once('/v1/status', async () => {
        await gate;
        return json(200, statusBody());
      });
      const status = w.dispatch(statusMsg);
      await until(() => sB.requests('/v1/status').length === 1);
      return { w, release, status };
    }

    // Amendment 1 (AM-2 row 2): the status that was in flight ends with the final read null, so its `connected` is obsolete: it is
    // discarded (notPaired, paired false) and no E13 cleanup runs. Before the amendment these two tests expected `connected`.
    it('an Unpair of the new record completes; the status then ends notPaired with paired false (an obsolete connected is discarded): nothing is sent to the old record\'s port', async () => {
      const { w, release, status } = await inFlight();
      expect(await w.send(unpairMsg)).toEqual({ state: 'notPaired', paired: false });
      release();
      expect(await status.reply).toEqual({ state: 'notPaired', paired: false });
      await w.idle();
      expect(w.net.to(PORT_B)).toEqual([]);
      expect(w.server(PORT_B).pairings.has(OLD.pairingId)).toBe(true);
    });

    it('a 401 bad_token removes the new record (any removeIf); the first status then ends notPaired with paired false (discarded): nothing is sent to the old record\'s port', async () => {
      const { w, release, status } = await inFlight();
      w.server(40124).once('/v1/status', err(401, 'bad_token'));
      expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
      expect(w.idb.peek()).toBeUndefined();
      release();
      expect(await status.reply).toEqual({ state: 'notPaired', paired: false });
      await w.idle();
      expect(w.net.to(PORT_B)).toEqual([]);
    });

    it('control: without the removal, the same status ends connected and the old record IS unpaired', async () => {
      const { w, release, status } = await inFlight();
      release();
      expect(await status.reply).toMatchObject({ state: 'connected' });
      await w.idle();
      expect(w.net.to(PORT_B).map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    });
  });

  // Amendment 1 (AM-3), replaces the comment "Not pinned (the plan does not say): whether a pair attempt that FAILS drops the held old
  // record...". The amendment pins it: `held` changes only when a pair is CONFIRMED (at that moment it becomes the record it replaced, or
  // null when it replaced none or the same pairingId). A pair that fails for any reason leaves it untouched. Unpair, the E8f removal and
  // any null final read still drop it.
  describe('AM-3: held changes only on a confirmed pair', () => {
    /** OLD is replaced by a record on 40124 (B): held = OLD, B is stored. */
    async function replacedWorld(): Promise<World> {
      const w = mk();
      w.install(OLD);
      const sB = w.server(40124);
      sB.openCode('ABCDEFGH');
      sB.issue = cred(2);
      expect(await w.send(pairMsg('40124-ABCDEFGH', 'B'))).toEqual({ state: 'checking', paired: true });
      return w;
    }
    const expectOldUnpairedOnce = (w: World): void => {
      const toOld = w.net.to(PORT_B);
      expect(toOld.map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
      expect(toOld[1]?.authorization).toBe(`Bearer ${OLD.token}`);
      expect(w.server(PORT_B).pairings.has(OLD.pairingId)).toBe(false);
    };

    it('A is replaced by B; a pair answers bad_code; a status ends connected: exactly one hello and one /v1/unpair go to A\'s port', async () => {
      const w = await replacedWorld();
      w.server().openCode('ZZZZZZZZ');
      expect(await w.send(pairMsg())).toEqual({ state: 'wrongCode', paired: true });
      expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
      await w.idle();
      expectOldUnpairedOnce(w);
    });

    interface Failure {
      name: string;
      state: Reply['state'];
      paired: boolean;
      /** Scripts the failure; returns the message to send, and what to undo before the status. */
      script(w: World): { msg: unknown; undo?: () => void };
    }
    const FAILURES: Failure[] = [
      { name: 'badInput', state: 'badInput', paired: true, script: () => ({ msg: pairMsg('nonsense') }) },
      { name: 'wrongCode', state: 'wrongCode', paired: true, script: (w) => (w.server().openCode('ZZZZZZZZ'), { msg: pairMsg() }) },
      { name: 'pairingClosed', state: 'pairingClosed', paired: true, script: (w) => ((w.server().code = null), { msg: pairMsg() }) },
      {
        name: 'mismatch',
        state: 'mismatch',
        paired: true,
        script: (w) => {
          w.server().openCode('ABCDEFGH');
          w.server().issue = cred(3);
          w.server().appVersion = 'v'.repeat(65);
          return { msg: pairMsg() };
        },
      },
      { name: 'appNotRunning', state: 'appNotRunning', paired: true, script: () => ({ msg: pairMsg('38999-ABCDEFGH') }) },
      { name: 'wrongProgram', state: 'wrongProgram', paired: true, script: (w) => (w.server().once('/v1/pair', json(500, {})), { msg: pairMsg() }) },
      {
        name: 'storageFailed',
        state: 'storageFailed',
        paired: true,
        script: (w) => {
          w.server().openCode('ABCDEFGH');
          w.server().issue = cred(3);
          w.idb.sw.abortAt = 'write';
          return {
            msg: pairMsg(),
            undo: () => {
              w.idb.sw.abortAt = 'none';
            },
          };
        },
      },
      {
        name: 'storageBlocked',
        state: 'storageBlocked',
        paired: false,
        script: (w) => {
          w.idb.sw.openError = 'UnknownError';
          return {
            msg: pairMsg(),
            undo: () => {
              w.idb.sw.openError = null;
            },
          };
        },
      },
    ];

    it.each(FAILURES.map((f) => [f.name, f] as [string, Failure]))('a pair that fails with %s leaves held untouched: the next connected status still unpairs the replaced record, once', async (_n, f) => {
      const w = await replacedWorld();
      const { msg, undo } = f.script(w);
      expect(await w.send(msg)).toEqual({ state: f.state, paired: f.paired });
      undo?.();
      expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
      await w.idle();
      expectOldUnpairedOnce(w);
    });

    it('a pair that fails changes neither the stored record nor what a later pair replaces: A, then B replaced A, a failed pair, then C replaces B: B is the one unpaired, A is not', async () => {
      const w = await replacedWorld();
      w.server().openCode('ZZZZZZZZ');
      expect(await w.send(pairMsg())).toEqual({ state: 'wrongCode', paired: true });
      const sC = w.server(40125);
      sC.openCode('ABCDEFGH');
      sC.issue = cred(4);
      expect(await w.send(pairMsg('40125-ABCDEFGH', 'C'))).toEqual({ state: 'checking', paired: true });
      expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
      await w.idle();
      expect(w.net.to(PORT_B), 'A was dropped by the confirmed pair of C').toEqual([]);
      expect(w.net.to(40124).filter((r) => r.path !== '/v1/pair').map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    });

    it('a confirmed pair that replaces a record with the SAME pairingId makes held null: nothing is sent to the record held before', async () => {
      const w = await replacedWorld();
      const sB = w.server(40124);
      sB.openCode('ABCDEFGH');
      sB.issue = cred(2);
      expect(await w.send(pairMsg('40124-ABCDEFGH', 'B again'))).toEqual({ state: 'checking', paired: true });
      expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
      await w.idle();
      expect(w.net.to(PORT_B)).toEqual([]);
    });

    it('a null final read drops it: a status that ends with the store empty, then the record back, never unpairs the old record', async () => {
      const w = await replacedWorld();
      const stored = w.idb.peek() as Rec;
      // The record disappears while the status is in flight, without any handler removing it.
      w.server(40124).once('/v1/status', () => {
        w.idb.backing.dbs.get('fetchly')?.stores.get('kv')?.delete('pairing');
        return 'default';
      });
      expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
      w.idb.seed(stored);
      expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
      await w.idle();
      expect(w.net.to(PORT_B)).toEqual([]);
    });

    it('the E8f removal drops it even when removeIf fails (row 4): a later connected status never unpairs the old record', async () => {
      const w = await replacedWorld();
      w.server(40124).once('/v1/status', err(401, 'bad_token'));
      w.idb.sw.abortAt = 'write';
      expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: true });
      w.idb.sw.abortAt = 'none';
      expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
      await w.idle();
      expect(w.net.to(PORT_B)).toEqual([]);
    });

    // Review 2, finding 1 (AM-2, AM-3): EVERY null final read drops `held`, also the two branches that answer from ONE read and do nothing
    // else: the AM-5 gate (a pair or unpair that arrives while one runs; it answers `operationRunning` since amendment 2, AM2-1) and badInput
    // (nothing sent, nothing mutated). Each test replaces A by B (held = A), makes the stored record disappear while the branch answers
    // (paired false), writes B back (the same pairingId) and sends a status that ends connected: nothing may ever go to A's port, no hello
    // and no /v1/unpair. Each branch also has a control whose read is NOT null: held is kept, and the same status unpairs A once. So the
    // rule is pinned both ways.
    describe('every null final read drops held: the gate branch and the badInput branch (AM-2, AM-3)', () => {
      const deleteStored = (w: World): void => {
        w.idb.backing.dbs.get('fetchly')?.stores.get('kv')?.delete('pairing');
      };
      const dbOpens = (w: World): number => w.idb.log.filter((e) => e.op === 'open').length;

      const GATED: [string, unknown][] = [
        ['a pair', pairMsg()],
        ['an unpair', unpairMsg],
      ];

      /**
       * B is stored and held = A. A pair runs and waits at the app (a wrong code, so it ends wrongCode: a failed pair leaves held
       * untouched). While it waits, `msg` arrives and is answered by the gate from one read. With `vanish` the stored record is gone
       * for that read and written back (the same pairingId as B) before the running pair ends, so that pair's own final read is not null.
       */
      async function gatedWorld(vanish: boolean, msg: unknown): Promise<World> {
        const w = await replacedWorld();
        const stored = w.idb.peek() as Rec;
        w.server().openCode('ZZZZZZZZ');
        const gate = holdAt(w.server(), '/v1/pair');
        const running = w.dispatch(pairMsg());
        await until(() => w.server().requests('/v1/pair').length === 1);
        if (vanish) deleteStored(w);
        const opensBefore = dbOpens(w);
        const netBefore = w.net.log.length;
        const gated = w.dispatch(msg);
        await until(() => gated.sent.length === 1);
        expect(gated.sent[0], 'the gate answers from the one read').toEqual({ state: 'operationRunning', paired: !vanish });
        expect(dbOpens(w) - opensBefore, 'exactly one read').toBe(1);
        expect(w.net.log.length, 'the gated message sent nothing').toBe(netBefore);
        if (vanish) w.idb.seed(stored);
        gate.release();
        expect(await running.reply).toEqual({ state: 'wrongCode', paired: true });
        return w;
      }

      it.each(GATED)('gate branch, %s: the read is null (operationRunning, paired false), B is written back, a connected status: nothing is ever sent to A\'s port', async (_n, msg) => {
        const w = await gatedWorld(true, msg);
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expect(w.net.to(PORT_B), 'no hello and no /v1/unpair to A').toEqual([]);
        expect(w.server(PORT_B).pairings.has(OLD.pairingId), 'A is still known to the app').toBe(true);
      });

      it.each(GATED)('gate branch control, %s: the read is NOT null (operationRunning, paired true), the record stays: held is kept, and a connected status unpairs A once', async (_n, msg) => {
        const w = await gatedWorld(false, msg);
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expectOldUnpairedOnce(w);
      });

      const BAD_INPUTS: [string, unknown][] = [
        ['an unparseable pairing string', pairMsg('nonsense')],
        ['a label over 64 units', pairMsg(undefined, 'L'.repeat(65))],
        ['a pairing string over 64 units', pairMsg(`${PORT}-${'A'.repeat(65)}`)],
      ];

      /** B is stored and held = A. A badInput pair answers from its one read, which is null when `vanish`; B is written back after it. */
      async function badInputWorld(vanish: boolean, msg: unknown): Promise<World> {
        const w = await replacedWorld();
        const stored = w.idb.peek() as Rec;
        if (vanish) deleteStored(w);
        const opensBefore = dbOpens(w);
        const netBefore = w.net.log.length;
        expect(await w.send(msg)).toEqual({ state: 'badInput', paired: !vanish });
        expect(dbOpens(w) - opensBefore, 'exactly one read').toBe(1);
        expect(w.net.log.length, 'badInput sent nothing').toBe(netBefore);
        if (vanish) w.idb.seed(stored);
        return w;
      }

      it.each(BAD_INPUTS)('badInput branch, %s: the read is null (paired false), B is written back, a connected status: nothing is ever sent to A\'s port', async (_n, msg) => {
        const w = await badInputWorld(true, msg);
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expect(w.net.to(PORT_B), 'no hello and no /v1/unpair to A').toEqual([]);
        expect(w.server(PORT_B).pairings.has(OLD.pairingId), 'A is still known to the app').toBe(true);
      });

      it.each(BAD_INPUTS)('badInput branch control, %s: the read is NOT null (paired true): held is kept, and a connected status unpairs A once', async (_n, msg) => {
        const w = await badInputWorld(false, msg);
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expectOldUnpairedOnce(w);
      });
    });

    // Amendment 2 review fix 1 (AM2-1.2, AM-3), an addition: a FAILED gated read leaves `held` alone. The gate answers storageBlocked from
    // its one read (paired false); that read says nothing about the stored record, so it drops nothing. The earlier failed-gated-read specs
    // (AM-5 and AM2-1 below) start with no held record, so an accidental `held = null` in the gate's failed-read branch would pass them. Here
    // B is stored and held = A. The running job is a PAIR that waits at the app and ends wrongCode (an unpair would drop held itself, so it
    // cannot be the running job). The gated message's one read fails; the pair ends; a later status that ends connected unpairs A exactly once.
    // The control is the same flow with the gated read succeeding.
    describe('a failed gated read keeps held (AM2-1.2, AM-3): the gate\'s failed-read branch drops nothing', () => {
      const GATED_MSGS: [string, unknown][] = [
        ['a pair', pairMsg()],
        ['an unpair', unpairMsg],
      ];

      /**
       * B is stored and held = A. A pair waits at the app (a wrong code, so it ends wrongCode and a failed pair leaves held untouched).
       * While it waits `msg` arrives and is answered by the gate from one read: with `failRead` that read (the next open) fails, else it
       * works and finds B. The running pair is then released and ends. Nothing else differs between the two flows.
       */
      async function gateWorld(failRead: boolean, msg: unknown): Promise<World> {
        const w = await replacedWorld();
        w.server().openCode('ZZZZZZZZ');
        const gate = holdAt(w.server(), '/v1/pair');
        const running = w.dispatch(pairMsg());
        await until(() => w.server().requests('/v1/pair').length === 1);
        const netBefore = w.net.log.length;
        const opensBefore = opens(w);
        // Counted from here: the gated message's one read is the next open.
        if (failRead) failNthOpen(w, 1);
        const gated = w.dispatch(msg);
        await until(() => gated.sent.length === 1);
        expect(gated.sent[0], 'the gate answers from its one read').toEqual(failRead ? { state: 'storageBlocked', paired: false } : { state: 'operationRunning', paired: true });
        if (!failRead) expect(opens(w) - opensBefore, 'exactly one read').toBe(1);
        expect(w.net.log.length, 'the gated message sent nothing').toBe(netBefore);
        expect(w.net.to(PORT_B), 'and nothing went to A').toEqual([]);
        expect(running.sent, 'the running pair is still running').toEqual([]);
        gate.release();
        expect(await running.reply).toEqual({ state: 'wrongCode', paired: true });
        return w;
      }

      it.each(GATED_MSGS)('%s whose one read fails (storageBlocked, paired false) while a pair runs: held = A is kept, and a connected status unpairs A exactly once', async (_n, msg) => {
        const w = await gateWorld(true, msg);
        expect(w.net.to(PORT_B), 'nothing went to A before the status').toEqual([]);
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expectOldUnpairedOnce(w);
        // Exactly once: the first connected status consumed held, so a second one sends nothing more to A.
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expectOldUnpairedOnce(w);
      });

      it.each(GATED_MSGS)('control, %s: the same flow with the gated read succeeding (operationRunning, paired true) also has a connected status unpair A exactly once', async (_n, msg) => {
        const w = await gateWorld(false, msg);
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expectOldUnpairedOnce(w);
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expectOldUnpairedOnce(w);
      });
    });

    // Amendment 2 review fix 2 (AM2-1.2, AM-3), an addition: the same rule in the three other branches that answer storageBlocked from a
    // FAILED read. `held` is dropped only by a null final read, an unpair or a successful replacement; a failed read says nothing about the
    // stored record, so it never drops it. In each branch B is stored and held = A, that branch's read fails (storageBlocked, paired false,
    // nothing more is read) and a later status that ends connected unpairs A exactly once. An accidental `held = null` next to the
    // `return blocked()` of any of the three fails the first spec of its branch. Each branch also has a control whose read works.
    describe('a failed read keeps held in the three other branches that answer storageBlocked: pair badInput, status first read, status final read (AM2-1.2, AM-3)', () => {
      interface ReadBranch {
        name: string;
        /** The message under test. */
        msg: unknown;
        /** The nth open() of that message fails (1-based). A status reads inside `call` first and once more at the end. */
        failOpen: number;
        /** How many reads the whole message makes when none fails. */
        reads: number;
        /** The paths the message sends to the app when its read fails. */
        failSent: string[];
        /** The paths it sends when every read works, and the reply then. */
        controlSent: string[];
        controlReply: { state: Reply['state']; paired: boolean };
        /**
         * Scripts the control's app. A status that ends connected would unpair A itself, so the control status is answered 500 and ends
         * appError: it reads fine and does not consume held, like the failed one.
         */
        controlScript?: (w: World) => void;
      }
      const STATUS_PATHS = ['/v1/hello', '/v1/status'];
      const appError = (w: World): void => {
        w.server(40124).once('/v1/status', json(500, {}));
      };
      const BRANCHES: ReadBranch[] = [
        {
          name: 'pair badInput: its one read',
          msg: pairMsg('nonsense'),
          failOpen: 1,
          reads: 1,
          failSent: [],
          controlSent: [],
          controlReply: { state: 'badInput', paired: true },
        },
        {
          name: 'status: the first read (inside the call, before anything is sent)',
          msg: statusMsg,
          failOpen: 1,
          reads: 2,
          failSent: [],
          controlSent: STATUS_PATHS,
          controlReply: { state: 'appError', paired: true },
          controlScript: appError,
        },
        {
          name: 'status: the final read (after the exchange with the app)',
          msg: statusMsg,
          failOpen: 2,
          reads: 2,
          failSent: STATUS_PATHS,
          controlSent: STATUS_PATHS,
          controlReply: { state: 'appError', paired: true },
          controlScript: appError,
        },
      ];
      const CASES = BRANCHES.map((b) => [b.name, b] as [string, ReadBranch]);

      /** B is stored and held = A. `b.msg` is sent; with `failRead` its `failOpen`th read fails, else every read works. */
      async function readWorld(b: ReadBranch, failRead: boolean): Promise<World> {
        const w = await replacedWorld();
        if (!failRead) b.controlScript?.(w);
        const netBefore = w.net.log.length;
        const opensBefore = opens(w);
        if (failRead) failNthOpen(w, b.failOpen);
        expect(await w.send(b.msg)).toEqual(failRead ? { state: 'storageBlocked', paired: false } : b.controlReply);
        // A failed open() is not logged by the fake, so a failed read leaves `failOpen - 1` opens and no read after it.
        expect(opens(w) - opensBefore, failRead ? 'the failed read is the last one' : 'every read worked').toBe(failRead ? b.failOpen - 1 : b.reads);
        expect(
          w.net.log.slice(netBefore).map((r) => r.path),
          'what the message sent',
        ).toEqual(failRead ? b.failSent : b.controlSent);
        expect(w.net.to(PORT_B), 'nothing went to A').toEqual([]);
        return w;
      }

      it.each(CASES)('%s fails (storageBlocked, paired false): held = A is kept, and a later connected status unpairs A exactly once', async (_n, b) => {
        const w = await readWorld(b, true);
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expectOldUnpairedOnce(w);
        // Exactly once: the first connected status consumed held, so a second one sends nothing more to A.
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expectOldUnpairedOnce(w);
      });

      it.each(CASES)('control, %s works: the same flow also keeps held, and a later connected status unpairs A exactly once', async (_n, b) => {
        const w = await readWorld(b, false);
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expectOldUnpairedOnce(w);
        expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
        await w.idle();
        expectOldUnpairedOnce(w);
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------

describe('unpair', () => {
  it('hello and /v1/unpair with the stored token, then the record is removed', async () => {
    const w = pairedWorld();
    expect(await w.send(unpairMsg)).toEqual({ state: 'notPaired', paired: false });
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    expect(w.net.log[1]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(w.net.log[1]?.bodyJson).toEqual({});
    expect(w.idb.peek()).toBeUndefined();
    expect(w.server().pairings.size).toBe(0);
  });

  const ANSWERS: [string, (w: World) => void, { hangAt?: 1 | 2 }][] = [
    ['a 401 bad_token', (w) => w.server().once('/v1/unpair', err(401, 'bad_token')), {}],
    ['a 403 bad_origin', (w) => w.server().once('/v1/unpair', err(403, 'bad_origin')), {}],
    ['a 500', (w) => w.server().once('/v1/unpair', json(500, {})), {}],
    ['a 429 rate_limited', (w) => w.server().once('/v1/unpair', err(429, 'rate_limited')), {}],
    ['an opaque redirect', (w) => w.server().once('/v1/unpair', opaqueRedirect()), {}],
    ['a 200 that is not JSON', (w) => w.server().once('/v1/unpair', text(200, 'x')), {}],
    // Amendment 1 (AM-4): wrong_shape is "not 200 ok", so the note is added.
    ['a 200 holding a JSON array (wrong_shape)', (w) => w.server().once('/v1/unpair', json(200, [])), {}],
    ['a 200 holding JSON null (wrong_shape)', (w) => w.server().once('/v1/unpair', json(200, null)), {}],
    ['a 200 holding a JSON string (wrong_shape)', (w) => w.server().once('/v1/unpair', json(200, 'ok')), {}],
    ['a 200 holding a JSON number (wrong_shape)', (w) => w.server().once('/v1/unpair', json(200, 1)), {}],
    ['a wrong proof', (w) => w.server().once('/v1/hello', (req) => json(200, { proof: w.server().proofFor(req, { token: TOKEN_B }) })), {}],
    ['a hello that is not JSON', (w) => w.server().once('/v1/hello', text(200, 'x')), {}],
    ['hello 404 unknown_pairing', (w) => w.server().pairings.clear(), {}],
    ['a stale proof', (w) => w.server().once('/v1/hello', skewHello(w, { mono: 5001, wall: 5001 })), {}],
    ['a rejection of the hello', (w) => w.server().once('/v1/hello', reject()), {}],
    ['a rejection of the request', (w) => w.server().once('/v1/unpair', reject()), {}],
    ['nothing listening', (w) => w.net.servers.clear(), {}],
    ['a hello that hangs', (w) => w.server().once('/v1/hello', hang()), { hangAt: 1 }],
    ['a request that hangs', (w) => w.server().once('/v1/unpair', hang()), { hangAt: 2 }],
  ];
  it.each(ANSWERS)('whatever the answer (%s): the record is removed and the note unpairedLocalOnly is added', async (_n, set, opts) => {
    const w = pairedWorld();
    set(w);
    const t = track(w.send(unpairMsg));
    if (opts.hangAt) {
      await until(() => w.net.log.length >= (opts.hangAt ?? 1));
      w.clock.advance(5000);
    }
    expect(await t.promise).toEqual({ state: 'notPaired', paired: false, note: 'unpairedLocalOnly' });
    expect(w.idb.peek()).toBeUndefined();
  });

  it('a 200 adds no note', async () => {
    const w = pairedWorld();
    const reply = (await w.send(unpairMsg)) as Reply;
    expect(reply.note).toBeUndefined();
    expect('note' in reply).toBe(false);
  });

  it('no record: nothing sent, notPaired', async () => {
    const w = mk();
    expect(await w.send(unpairMsg)).toEqual({ state: 'notPaired', paired: false });
    expect(w.net.log).toEqual([]);
  });

  it('R2-6: when removeIf answers storage_failed the reply is storageFailed with paired true', async () => {
    const w = pairedWorld();
    w.idb.sw.abortAt = 'write';
    const reply = await w.send(unpairMsg);
    expect(reply).toMatchObject({ state: 'storageFailed', paired: true });
    // The app was told, the record is still on disk.
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    expect(w.idb.peek()).toEqual(REC);
  });

  it('removes only the record it unpaired', async () => {
    const w = pairedWorld();
    // While the unpair is in flight another pairing replaces the record on disk.
    const B = makeRecordB();
    w.server().once('/v1/unpair', () => {
      w.idb.seed(B);
      return 'default';
    });
    // Amendment 1 (AM-2): the final read finds another pairingId, so the reply is checking with paired true ("ask for the status now").
    expect(await w.send(unpairMsg)).toEqual({ state: 'checking', paired: true });
    expect(w.idb.peek()).toEqual(B);
  });
});

// ---------------------------------------------------------------------------------------------

describe('race (N1)', () => {
  it('a status in flight on record A; a pair stores record B; A\'s status then gets 401 bad_token: B stays', async () => {
    const w = pairedWorld();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    w.server().once('/v1/status', async () => {
      await gate;
      return err(401, 'bad_token');
    });
    const status = w.dispatch(statusMsg);
    await until(() => w.net.log.length >= 2);
    const B = makeRecordB();
    const sB = w.server(PORT_B);
    sB.openCode('ABCDEFGH');
    sB.issue = { token: B.token, pairingId: B.pairingId };
    const pair = w.dispatch(pairMsg(`${PORT_B}-ABCDEFGH`, 'B'));
    await until(() => (w.idb.peek() as Rec | undefined)?.pairingId === B.pairingId);
    release();
    const [sr, pr] = await Promise.all([status.reply, pair.reply]);
    expect(pr).toEqual({ state: 'checking', paired: true });
    // Amendment 1 (AM-2 row 3): A's result is obsolete (a pair stored B meanwhile), so the reply is checking with paired true.
    // Before the amendment this expected `notPaired`.
    expect(sr).toEqual({ state: 'checking', paired: true });
    await w.idle();
    expect(w.idb.peek()).toMatchObject({ pairingId: B.pairingId, token: B.token, port: PORT_B });
  });
});

// ---------------------------------------------------------------------------------------------

describe('secrecy (A1 §8; E8c, E8d)', () => {
  it('with a marker token, the JSON of every reply in every outcome never holds the marker, the pairingId or the port', async () => {
    const outcomes: [string, (w: World) => Promise<unknown>][] = [
      ['status connected', (w) => w.send(statusMsg)],
      ['status 401', async (w) => (w.server().once('/v1/status', err(401, 'bad_token')), w.send(statusMsg))],
      ['status 429', async (w) => (w.server().once('/v1/status', err(429, 'rate_limited')), w.send(statusMsg))],
      ['status mismatch', async (w) => (w.server().once('/v1/status', json(200, statusBody({ extra: TOKEN }))), w.send(statusMsg))],
      ['status 500 holding the token', async (w) => (w.server().once('/v1/status', json(500, { token: TOKEN, pairingId: PAIRING_ID })), w.send(statusMsg))],
      ['status wrong program', async (w) => (w.server().once('/v1/hello', json(200, { proof: TOKEN })), w.send(statusMsg))],
      ['status app not running', async (w) => (w.server().once('/v1/hello', reject(`ECONNREFUSED ${TOKEN} ${PAIRING_ID} 127.0.0.1:${PORT}`)), w.send(statusMsg))],
      ['unpair 200', (w) => w.send(unpairMsg)],
      ['unpair 401', async (w) => (w.server().once('/v1/unpair', err(401, 'bad_token')), w.send(unpairMsg))],
      ['pair success', async (w) => (w.server().openCode('ABCDEFGH'), w.server().issue = cred(7), w.send(pairMsg()))],
      ['pair wrong code', async (w) => (w.server().openCode('ZZZZZZZZ'), w.send(pairMsg()))],
      ['pair mismatch', async (w) => ((w.server().appVersion = 'v'.repeat(65)), w.server().openCode('ABCDEFGH'), w.send(pairMsg()))],
      ['pair storage failure', async (w) => ((w.idb.sw.abortAt = 'write'), w.server().openCode('ABCDEFGH'), w.send(pairMsg()))],
      ['pair bad input', (w) => w.send(pairMsg('nonsense'))],
    ];
    for (const [name, run] of outcomes) {
      const w = pairedWorld();
      const reply = await run(w);
      const json = JSON.stringify(reply);
      for (const secret of [TOKEN, PAIRING_ID, 'TOKENMARKER', 'PAIRIDMARKER', String(PORT), String(PORT_B)]) expect(json, `${name} holds ${secret}`).not.toContain(secret);
    }
  });

  it('no message type accepts a token: a token key makes every type refuse', async () => {
    for (const msg of [
      { type: 'fetchly:status', token: TOKEN },
      { type: 'fetchly:unpair', token: TOKEN },
      { type: 'fetchly:pair', pairingString: `${PORT}-ABCDEFGH`, label: 'x', token: TOKEN },
      { type: 'fetchly:pair', pairingString: `${PORT}-ABCDEFGH`, label: 'x', pairingId: PAIRING_ID },
      { type: 'fetchly:status', pairingId: PAIRING_ID },
    ]) {
      const w = pairedWorld();
      const d = w.dispatch(msg);
      expect(d.returned).toBe(false);
      await w.idle();
      expect(w.net.log).toEqual([]);
    }
  });

  it('no message type returns a token: the reply has only state, paired, appVersion and note', async () => {
    const w = pairWorld();
    const a = await w.send(pairMsg());
    const b = await w.send(statusMsg);
    const c = await w.send(unpairMsg);
    for (const r of [a, b, c]) {
      expect(Object.keys(r as object).every((k) => ['state', 'paired', 'appVersion', 'note'].includes(k))).toBe(true);
      expect(JSON.stringify(r)).not.toMatch(/token|pairingId|port/iu);
    }
  });

  it('the IndexedDB log shows no key but pairing, in every operation', async () => {
    const w = pairWorld();
    await w.send(statusMsg);
    await w.send(pairMsg());
    await w.send(statusMsg);
    await w.send(unpairMsg);
    const keys = w.idb.log.flatMap((e) => (e.op === 'get' || e.op === 'put' || e.op === 'delete' ? [e.key] : []));
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys)).toEqual(new Set(['pairing']));
  });

  it('a thrown or rejected error never reaches the popup: every outcome is a reply', async () => {
    const w = pairedWorld();
    w.idb.sw.transactionThrows = true;
    expect(await w.send(statusMsg)).toEqual({ state: 'storageBlocked', paired: false });
  });
});

// =============================================================================================
// Amendment 1 (docs/plans/2026-11-23-phase2-a2-amendment-1.md)
// =============================================================================================

const OLD_REC = makeRecordB(); // on PORT_B (40123)
const enc = (s: string): number[] => [...new TextEncoder().encode(s)];
/** Raw bytes from strings and byte lists, in order. */
const raw = (...parts: (string | number[])[]): Uint8Array => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? enc(p) : p)));
const BAD_UTF8: [string, number[]][] = [
  ['FF', [0xff]],
  ['a lone C3', [0xc3]],
  ['ED A0 80 (an encoded surrogate)', [0xed, 0xa0, 0x80]],
];

/** The nth open() of the database (1-based) throws, like a browser that cannot open it; every other open works. */
function failNthOpen(w: World, n: number): void {
  const factory = w.idb.factory;
  const realOpen = factory.open.bind(factory);
  let count = 0;
  factory.open = (name, version) => {
    count += 1;
    if (count === n) throw new DOMException('cannot open', 'SecurityError');
    return realOpen(name, version);
  };
}
const opens = (w: World): number => w.idb.log.filter((e) => e.op === 'open').length;
const toPath = (w: World, path: string): number => w.net.log.filter((r) => r.path === path).length;

describe('AM-1: a pair whose write is stuck in the commit: storage_unknown after the 1000 ms grace, never a rollback', () => {
  /** A world with a code open and every write stuck in the commit; the pair is sent and its write is waiting. */
  async function stuckPair(w: World = pairWorld()) {
    w.idb.sw.commitHold = 'write';
    const t = track(w.send(pairMsg()));
    await until(() => w.idb.committing.length === 1);
    return { w, t };
  }

  it('no terminal event: pending at 3999 ms, storageFailed at 4000 ms, NO request to /v1/unpair, the server still has the pairing; after a late complete a status answers connected', async () => {
    const { w, t } = await stuckPair();
    w.clock.advance(2999);
    await w.idle();
    expect(t.state, 'at 2999 ms').toBe('pending');
    w.clock.advance(1);
    await w.idle();
    expect(t.state, 'at 3000 ms (abort() was refused)').toBe('pending');
    w.clock.advance(999);
    await w.idle();
    expect(t.state, 'at 3999 ms').toBe('pending');
    w.clock.advance(1);
    expect(await t.promise).toEqual({ state: 'storageFailed', paired: false });
    await w.idle();
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair']);
    expect(w.server().pairings.has(PAIRING_ID)).toBe(true);
    expect(w.idb.peek()).toBeUndefined();
    w.idb.releaseCommitting('complete');
    await w.idle();
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID });
    expect(toPath(w, '/v1/unpair'), 'never, also after the late complete').toBe(0);
    expect(await w.send(statusMsg)).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    expect(toPath(w, '/v1/unpair')).toBe(0);
  });

  it('a complete inside the grace: checking, paired true, no unpair', async () => {
    const { w, t } = await stuckPair();
    w.clock.advance(3000);
    await w.idle();
    w.clock.advance(500);
    await w.idle();
    expect(t.state).toBe('pending');
    w.idb.releaseCommitting('complete');
    expect(await t.promise).toEqual({ state: 'checking', paired: true });
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair']);
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID, token: TOKEN });
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
  });

  it('an abort inside the grace: one best-effort unpair with the new credentials, then storageFailed', async () => {
    const { w, t } = await stuckPair();
    w.clock.advance(3000);
    await w.idle();
    w.clock.advance(999);
    await w.idle();
    expect(t.state).toBe('pending');
    w.idb.releaseCommitting('abort');
    expect(await t.promise).toEqual({ state: 'storageFailed', paired: false });
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair', '/v1/hello', '/v1/unpair']);
    expect(w.net.log[2]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(w.server().pairings.has(PAIRING_ID)).toBe(false);
    expect(w.idb.peek()).toBeUndefined();
  });

  it('a complete released synchronously right after the clock reached 4000 ms: checking, paired true, no unpair', async () => {
    const { w, t } = await stuckPair();
    w.clock.advance(4000);
    w.idb.releaseCommitting('complete');
    expect(await t.promise).toEqual({ state: 'checking', paired: true });
    await w.idle();
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair']);
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID });
  });

  it('a complete released right after 4000 ms is exactly the success path: it sets held (the replaced record is unpaired by the next connected status), and still sends no unpair of the new pairing', async () => {
    const w = pairWorld();
    w.install(OLD_REC);
    const { t } = await stuckPair(w);
    w.clock.advance(4000);
    w.idb.releaseCommitting('complete');
    expect(await t.promise).toEqual({ state: 'checking', paired: true });
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    expect(w.net.to(PORT_B).map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    expect(w.net.to(PORT).filter((r) => r.path === '/v1/unpair')).toEqual([]);
  });

  it('storage_unknown and the final read fails: storageBlocked, paired false, no unpair', async () => {
    const { w, t } = await stuckPair();
    w.clock.advance(4000);
    w.idb.sw.openError = 'UnknownError';
    expect(await t.promise).toEqual({ state: 'storageBlocked', paired: false });
    w.idb.sw.openError = null;
    await w.idle();
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair']);
  });

  it('storage_unknown and the final read finds another pairingId: storageFailed with paired true, held untouched, no unpair of the new pairing', async () => {
    const w = pairWorld();
    w.install(OLD_REC);
    const sB = w.server(40124);
    sB.openCode('ABCDEFGH');
    sB.issue = cred(2);
    expect(await w.send(pairMsg('40124-ABCDEFGH', 'B'))).toEqual({ state: 'checking', paired: true });
    const { t } = await stuckPair(w);
    w.clock.advance(4000);
    expect(await t.promise).toEqual({ state: 'storageFailed', paired: true });
    expect(w.net.to(PORT).filter((r) => r.path === '/v1/unpair')).toEqual([]);
    w.idb.releaseCommitting('abort');
    w.idb.sw.commitHold = 'none';
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    expect(w.net.to(PORT_B).map((r) => r.path), 'held was untouched, so the old record is unpaired').toEqual(['/v1/hello', '/v1/unpair']);
  });

  // Amendment 2 review fix 2 (AM2-1.2, AM-3), an addition: a fourth branch that answers storageBlocked from a FAILED read, found by the
  // mutation check of the three branches briefed for this fix (`held = null` next to `return blocked()` in the storage_unknown branch of
  // pair survived every spec). The control is the spec just above: the same flow with the final read working (it finds B, so storageFailed
  // with paired true), where held is kept and the old record is unpaired.
  it('storage_unknown and the final read FAILS with A replaced by B earlier (held = A): storageBlocked, paired false, held is kept, and a connected status unpairs A exactly once', async () => {
    const w = pairWorld();
    w.install(OLD_REC);
    const sB = w.server(40124);
    sB.openCode('ABCDEFGH');
    sB.issue = cred(2);
    expect(await w.send(pairMsg('40124-ABCDEFGH', 'B'))).toEqual({ state: 'checking', paired: true });
    const { t } = await stuckPair(w);
    w.clock.advance(4000);
    w.idb.sw.openError = 'UnknownError';
    expect(await t.promise).toEqual({ state: 'storageBlocked', paired: false });
    w.idb.sw.openError = null;
    expect(w.net.to(PORT).filter((r) => r.path === '/v1/unpair'), 'no unpair of the new pairing').toEqual([]);
    expect(w.net.to(PORT_B), 'nothing went to A yet').toEqual([]);
    w.idb.releaseCommitting('abort');
    w.idb.sw.commitHold = 'none';
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
    await w.idle();
    expect(w.net.to(PORT_B).map((r) => r.path), 'held was kept, so A is unpaired').toEqual(['/v1/hello', '/v1/unpair']);
    expect(w.net.to(PORT_B)[1]?.authorization).toBe(`Bearer ${OLD_REC.token}`);
    // Exactly once: the first connected status consumed held, so a second one sends nothing more to A.
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
    await w.idle();
    expect(w.net.to(PORT_B).map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
  });
});

describe('AM-1: unpair whose removeIf is stuck in the commit: storage_failed and storage_unknown are treated alike, the final read decides', () => {
  async function stuckUnpair(answer?: Answer) {
    const w = pairedWorld();
    if (answer) w.server().once('/v1/unpair', answer);
    w.idb.sw.commitHold = 'write';
    const t = track(w.send(unpairMsg));
    await until(() => w.idb.committing.length === 1);
    return { w, t };
  }

  it('no terminal event: storage_unknown at 4000 ms, the final read finds the same pairingId: storageFailed, paired true (R2-6); the unpair was sent once', async () => {
    const { w, t } = await stuckUnpair();
    w.clock.advance(3999);
    await w.idle();
    expect(t.state).toBe('pending');
    w.clock.advance(1);
    expect(await t.promise).toEqual({ state: 'storageFailed', paired: true });
    expect(w.idb.peek()).toEqual(REC);
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
  });

  it('an abort inside the grace (storage_failed): the final read finds the same pairingId: storageFailed, paired true', async () => {
    const { w, t } = await stuckUnpair();
    w.clock.advance(3500);
    await w.idle();
    w.idb.releaseCommitting('abort');
    expect(await t.promise).toEqual({ state: 'storageFailed', paired: true });
    expect(w.idb.peek()).toEqual(REC);
  });

  it('a complete inside the grace: ok, the final read is null: notPaired, paired false', async () => {
    const { w, t } = await stuckUnpair();
    w.clock.advance(3500);
    await w.idle();
    w.idb.releaseCommitting('complete');
    expect(await t.promise).toEqual({ state: 'notPaired', paired: false });
    expect(w.idb.peek()).toBeUndefined();
  });

  it('a complete released right after 4000 ms (the commit did happen): the final read is null: notPaired, paired false, no note on a 200', async () => {
    const { w, t } = await stuckUnpair();
    w.clock.advance(4000);
    w.idb.releaseCommitting('complete');
    expect(await t.promise).toEqual({ state: 'notPaired', paired: false });
    expect(w.idb.peek()).toBeUndefined();
  });

  it('the same, after an unpair the app refused: notPaired, paired false, with the note as frozen', async () => {
    const { w, t } = await stuckUnpair(err(401, 'bad_token'));
    w.clock.advance(4000);
    w.idb.releaseCommitting('complete');
    expect(await t.promise).toEqual({ state: 'notPaired', paired: false, note: 'unpairedLocalOnly' });
  });
});

describe('AM-1: call ignores a removeIf that is stuck or fails; the E8f removal that did not happen is row 4', () => {
  it('a 401 bad_token and the removal stuck in the commit with no event: at 4000 ms notPaired with paired TRUE (the record is still stored), held dropped; the next status tries the removal again', async () => {
    const w = pairedWorld();
    w.server().once('/v1/status', err(401, 'bad_token'));
    w.server().once('/v1/status', err(401, 'bad_token'));
    w.idb.sw.commitHold = 'write';
    const t = track(w.send(statusMsg));
    await until(() => w.idb.committing.length === 1);
    w.clock.advance(3999);
    await w.idle();
    expect(t.state, 'call waits for the removal outcome').toBe('pending');
    w.clock.advance(1);
    expect(await t.promise).toEqual({ state: 'notPaired', paired: true });
    expect(w.idb.peek()).toEqual(REC);
    w.idb.releaseCommitting('abort');
    w.idb.sw.commitHold = 'none';
    // The next status makes the whole exchange again and the removal now commits.
    expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
    expect(w.idb.peek()).toBeUndefined();
    expect(toPath(w, '/v1/status')).toBe(2);
  });

  it('a 401 bad_token and a complete released right after 4000 ms: the record is gone by the final read: notPaired, paired false', async () => {
    const w = pairedWorld();
    w.server().once('/v1/status', err(401, 'bad_token'));
    w.idb.sw.commitHold = 'write';
    const t = track(w.send(statusMsg));
    await until(() => w.idb.committing.length === 1);
    w.clock.advance(4000);
    w.idb.releaseCommitting('complete');
    expect(await t.promise).toEqual({ state: 'notPaired', paired: false });
    expect(w.idb.peek()).toBeUndefined();
  });
});

describe('AM-2: paired comes from a final read that starts after the last mutation and the last fetch', () => {
  describe('status', () => {
    it.each([
      ['401 bad_token', err(401, 'bad_token')],
      ['403 bad_origin', err(403, 'bad_origin')],
    ] as [string, Answer][])('row 4: a right proof, then %s, and removeIf fails (abortAt write): notPaired with paired TRUE, the record is still stored', async (_n, answer) => {
      const w = pairedWorld();
      w.server().once('/v1/status', answer);
      w.idb.sw.abortAt = 'write';
      expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: true });
      expect(w.idb.peek()).toEqual(REC);
      expect(w.net.log.map((r) => r.path)).toEqual(['/v1/hello', '/v1/status']);
    });

    it('row 4: no new state: the next status tries the removal again, and now it commits', async () => {
      const w = pairedWorld();
      w.server().once('/v1/status', err(401, 'bad_token'));
      w.server().once('/v1/status', err(401, 'bad_token'));
      w.idb.sw.abortAt = 'write';
      expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: true });
      w.idb.sw.abortAt = 'none';
      expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
      expect(w.idb.peek()).toBeUndefined();
    });

    it('row 4 and a removal that works: notPaired with paired false (row 2, the final read is null)', async () => {
      const w = pairedWorld();
      w.server().once('/v1/status', err(401, 'bad_token'));
      expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
    });

    it('row 2: the record disappears while the request is in flight: appNotRunning becomes notPaired with paired false', async () => {
      const w = pairedWorld();
      w.server().once('/v1/hello', () => {
        w.idb.backing.dbs.get('fetchly')?.stores.get('kv')?.delete('pairing');
        return reject();
      });
      expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
    });

    it('row 2: the record disappears while the request is in flight: an obsolete connected is discarded', async () => {
      const w = pairedWorld();
      w.server().once('/v1/status', () => {
        w.idb.backing.dbs.get('fetchly')?.stores.get('kv')?.delete('pairing');
        return 'default';
      });
      expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
    });

    it('row 3: the first read found nothing (not_paired) but a record is there by the final read: checking with paired true, nothing sent', async () => {
      const w = mk();
      w.idb.sw.commitHold = 'any';
      const t = track(w.send(statusMsg));
      await until(() => w.idb.committing.length === 1);
      w.idb.seed(REC);
      w.idb.releaseCommitting('complete');
      await until(() => w.idb.committing.length === 1);
      w.idb.releaseCommitting('complete');
      expect(await t.promise).toEqual({ state: 'checking', paired: true });
      expect(w.net.log).toEqual([]);
    });

    it('row 3: a pair that fails at the write bumps gen but not held: the status in flight ends checking (paired true), and its connected does not unpair the held record; the next status does', async () => {
      const w = pairWorld();
      w.install(OLD_REC);
      const sB = w.server(40124);
      sB.openCode('ABCDEFGH');
      sB.issue = cred(2);
      expect(await w.send(pairMsg('40124-ABCDEFGH', 'B'))).toEqual({ state: 'checking', paired: true });
      const gate = holdAt(sB, '/v1/status');
      const status = w.dispatch(statusMsg);
      await until(() => sB.requests('/v1/status').length === 1);
      w.idb.sw.abortAt = 'write';
      expect(await w.send(pairMsg())).toEqual({ state: 'storageFailed', paired: true });
      w.idb.sw.abortAt = 'none';
      gate.release();
      expect(await status.reply).toEqual({ state: 'checking', paired: true });
      await w.idle();
      expect(w.net.to(PORT_B), 'the obsolete connected unpaired nothing').toEqual([]);
      expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
      await w.idle();
      expect(w.net.to(PORT_B).map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    });

    it('row 3: an unpair whose removeIf failed also bumps gen: the status in flight ends checking (paired true), not connected', async () => {
      const w = pairedWorld();
      const s = w.server();
      // The status answer is scripted: by then the unpair has removed the pairing at the app, whose own answer would be a 401.
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      s.once('/v1/status', async () => {
        await gate;
        return json(200, statusBody());
      });
      const status = w.dispatch(statusMsg);
      await until(() => s.requests('/v1/status').length === 1);
      w.idb.sw.abortAt = 'write';
      expect(await w.send(unpairMsg)).toEqual({ state: 'storageFailed', paired: true });
      w.idb.sw.abortAt = 'none';
      release();
      expect(await status.reply).toEqual({ state: 'checking', paired: true });
      expect(w.idb.peek()).toEqual(REC);
    });

    it('row 5: held changed while the status was in flight (a pair was confirmed after the status began): connected, and the cleanup does not unpair the record this very status proved', async () => {
      const w = pairWorld();
      w.install(OLD_REC);
      const sB = w.server(40124);
      sB.openCode('ABCDEFGH');
      sB.issue = cred(2);
      expect(await w.send(pairMsg('40124-ABCDEFGH', 'B'))).toEqual({ state: 'checking', paired: true });
      // held is OLD_REC. A second pair C is stuck at its write; gen was bumped before it.
      w.idb.sw.holdAt = 'write';
      const pairC = w.dispatch(pairMsg());
      await until(() => w.idb.held.length === 1);
      // The status starts now (held and gen as they are), reads B, and waits at B's app.
      const gate = holdAt(sB, '/v1/status');
      const status = w.dispatch(statusMsg);
      await until(() => sB.requests('/v1/status').length === 1);
      // The write commits: held becomes B, which is not the held record the status started with.
      w.idb.releaseHeld();
      expect(await pairC.reply).toEqual({ state: 'checking', paired: true });
      gate.release();
      expect(await status.reply).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
      await w.idle();
      expect(w.net.to(PORT_B), 'the replaced OLD_REC was not contacted').toEqual([]);
      expect(w.net.to(40124).map((r) => r.path)).toEqual(['/v1/pair', '/v1/hello', '/v1/status']);
    });

    it('row 2 drops held: the record is gone by the final read; when another record is stored later, a connected status sends nothing to the replaced entry', async () => {
      const w = pairWorld();
      w.install(OLD_REC);
      const sB = w.server(40124);
      sB.openCode('ABCDEFGH');
      sB.issue = cred(2);
      await w.send(pairMsg('40124-ABCDEFGH', 'B'));
      const stored = w.idb.peek();
      expect(stored).toBeDefined();
      sB.once('/v1/status', () => {
        w.idb.backing.dbs.get('fetchly')?.stores.get('kv')?.delete('pairing');
        return 'default';
      });
      expect(await w.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
      w.idb.seed(stored as NonNullable<typeof stored>);
      expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
      await w.idle();
      expect(w.net.to(PORT_B)).toEqual([]);
    });

    it('row 1: the final read fails after a connected exchange: storageBlocked, paired false, and no E13 cleanup', async () => {
      const w = pairWorld();
      w.install(OLD_REC);
      const sB = w.server(40124);
      sB.openCode('ABCDEFGH');
      sB.issue = cred(2);
      await w.send(pairMsg('40124-ABCDEFGH', 'B'));
      sB.once('/v1/status', () => {
        w.idb.sw.openError = 'UnknownError';
        return 'default';
      });
      expect(await w.send(statusMsg)).toEqual({ state: 'storageBlocked', paired: false });
      w.idb.sw.openError = null;
      await w.idle();
      expect(w.net.to(PORT_B)).toEqual([]);
    });

    it('row 1: the final read fails after appNotRunning: storageBlocked, paired false', async () => {
      const w = pairedWorld();
      w.server().once('/v1/hello', () => {
        w.idb.sw.openError = 'UnknownError';
        return reject();
      });
      expect(await w.send(statusMsg)).toEqual({ state: 'storageBlocked', paired: false });
    });

    it('the first read failed and nothing was sent: that failure is the answer and no second read is made (status, via call)', async () => {
      const w = pairedWorld();
      w.idb.sw.openError = 'UnknownError';
      expect(await w.send(statusMsg)).toEqual({ state: 'storageBlocked', paired: false });
      expect(opens(w)).toBe(1);
      expect(w.net.log).toEqual([]);
    });

    it('a status with the record intact: paired true comes from a final read after the last fetch; nothing is awaited between that read and the reply', async () => {
      const w = pairedWorld();
      expect(await w.send(statusMsg)).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
      const ev = w.trace.events;
      expect(ev.slice(ev.findLastIndex((e) => e.startsWith('fetch:')) + 1)).toEqual(['idb:open', 'idb:tx:readwrite', 'idb:commit', 'reply']);
    });
  });

  describe('pair', () => {
    it('the first read failed and nothing was sent or mutated: storageBlocked, no second read', async () => {
      const w = pairWorld();
      w.idb.sw.openError = 'UnknownError';
      expect(await w.send(pairMsg())).toEqual({ state: 'storageBlocked', paired: false });
      expect(opens(w)).toBe(1);
      expect(w.net.log).toEqual([]);
    });

    it('badInput with an unreadable store: storageBlocked (the final read fails, whatever happened before), one read, nothing sent', async () => {
      const w = pairWorld();
      w.idb.sw.openError = 'UnknownError';
      expect(await w.send(pairMsg('nonsense'))).toEqual({ state: 'storageBlocked', paired: false });
      expect(opens(w)).toBe(1);
      expect(w.net.log).toEqual([]);
    });

    const OUTCOMES: [string, Reply['state'], Answer][] = [
      ['a wrong code', 'wrongCode', err(401, 'bad_code')],
      ['a closed pairing', 'pairingClosed', err(403, 'pairing_closed')],
      ['a 400', 'mismatch', err(400, 'bad_request')],
      ['a rejection', 'appNotRunning', reject()],
      ['a 500', 'wrongProgram', json(500, {})],
    ];
    it.each(OUTCOMES)('%s: paired comes from the final read, not the opening one: no record at the start, one stored while /v1/pair was in flight: paired true', async (_n, state, answer) => {
      const w = pairWorld();
      w.server().once('/v1/pair', () => {
        w.idb.seed(OLD_REC);
        return answer;
      });
      expect(await w.send(pairMsg())).toEqual({ state, paired: true });
    });

    it.each(OUTCOMES)('%s: a record at the start, gone while /v1/pair was in flight: paired false', async (_n, state, answer) => {
      const w = pairWorld();
      w.install(OLD_REC);
      w.server().once('/v1/pair', () => {
        w.idb.backing.dbs.get('fetchly')?.stores.get('kv')?.delete('pairing');
        return answer;
      });
      expect(await w.send(pairMsg())).toEqual({ state, paired: false });
    });

    it('a confirmed pair whose record is gone by the final read: paired false, from the read and not from the write (held is then null)', async () => {
      const w = pairWorld();
      w.install(OLD_REC);
      // The pair's own transactions are the opening read (commit 1) and the write (commit 2). The record is deleted right after the write.
      let commits = 0;
      const trace = w.shared.trace;
      const realPush = trace.push.bind(trace);
      trace.push = (event: string): void => {
        realPush(event);
        if (event === 'idb:commit') {
          commits += 1;
          if (commits === 2) w.idb.backing.dbs.get('fetchly')?.stores.get('kv')?.delete('pairing');
        }
      };
      expect(await w.send(pairMsg())).toMatchObject({ paired: false });
      // held was dropped by the null final read: a later connected status sends nothing to the replaced entry.
      w.idb.seed(REC);
      expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
      await w.idle();
      expect(w.net.to(PORT_B)).toEqual([]);
    });

    it('mismatch with a best-effort unpair: paired is read after the unpair (a record that vanished during it gives false)', async () => {
      const w = pairWorld();
      w.install(OLD_REC);
      w.server().appVersion = 'v'.repeat(65);
      w.server().once('/v1/unpair', () => {
        w.idb.backing.dbs.get('fetchly')?.stores.get('kv')?.delete('pairing');
        return 'default';
      });
      expect(await w.send(pairMsg())).toEqual({ state: 'mismatch', paired: false });
      expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair', '/v1/hello', '/v1/unpair']);
    });

    it('storageFailed after a refused write: paired is read after the unpair (a record that appeared during it gives true)', async () => {
      const w = pairWorld();
      w.idb.sw.abortAt = 'write';
      w.server().once('/v1/unpair', () => {
        w.idb.seed(OLD_REC);
        return 'default';
      });
      expect(await w.send(pairMsg())).toEqual({ state: 'storageFailed', paired: true });
    });

    it.each([
      ['a stored pair', (w: World) => w.send(pairMsg()), 'checking', 3],
      ['a wrong code', (w: World) => (w.server().openCode('ZZZZZZZZ'), w.send(pairMsg())), 'wrongCode', 2],
    ] as [string, (w: World) => Promise<unknown>, string, number][])('%s: the last events before the reply are a read that started after the last fetch and mutation', async (_n, run, state, txCount) => {
      const w = pairWorld();
      expect(await run(w)).toMatchObject({ state });
      const ev = w.trace.events;
      const after = ev.slice(ev.findLastIndex((e) => e.startsWith('fetch:')) + 1);
      expect(after.slice(-4)).toEqual(['idb:open', 'idb:tx:readwrite', 'idb:commit', 'reply']);
      expect(after.filter((e) => e === 'idb:tx:readwrite')).toHaveLength(txCount - 1);
    });

    it.each([
      ['the pair is stored', (w: World) => failNthOpen(w, 3), (w: World) => w.send(pairMsg())],
      ['a wrong code', (w: World) => failNthOpen(w, 2), (w: World) => (w.server().openCode('ZZZZZZZZ'), w.send(pairMsg()))],
      ['the write is refused', (w: World) => ((w.idb.sw.abortAt = 'write'), failNthOpen(w, 3)), (w: World) => w.send(pairMsg())],
    ] as [string, (w: World) => void, (w: World) => Promise<unknown>][])('the final read fails when %s: storageBlocked, paired false, whatever happened before', async (_n, setup, run) => {
      const w = pairWorld();
      setup(w);
      expect(await run(w)).toEqual({ state: 'storageBlocked', paired: false });
    });
  });

  describe('unpair', () => {
    it('the first read failed and nothing was sent or mutated: storageBlocked, no second read', async () => {
      const w = pairedWorld();
      w.idb.sw.openError = 'UnknownError';
      expect(await w.send(unpairMsg)).toEqual({ state: 'storageBlocked', paired: false });
      expect(opens(w)).toBe(1);
      expect(w.net.log).toEqual([]);
    });

    it('the final read fails after the record was removed: storageBlocked, paired false', async () => {
      const w = pairedWorld();
      failNthOpen(w, 3);
      expect(await w.send(unpairMsg)).toEqual({ state: 'storageBlocked', paired: false });
      expect(w.net.log.map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    });

    it('an unpair drops the held record even when its removeIf fails (storageFailed, paired true): a later connected status sends nothing to the replaced entry', async () => {
      const w = pairWorld();
      w.install(OLD_REC);
      const sB = w.server(40124);
      sB.openCode('ABCDEFGH');
      sB.issue = cred(2);
      await w.send(pairMsg('40124-ABCDEFGH', 'B'));
      // The app keeps B (its unpair request is refused) and the local removal fails: B stays stored and known.
      sB.once('/v1/unpair', reject());
      w.idb.sw.abortAt = 'write';
      expect(await w.send(unpairMsg)).toEqual({ state: 'storageFailed', paired: true });
      w.idb.sw.abortAt = 'none';
      expect(await w.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
      await w.idle();
      expect(w.net.to(PORT_B)).toEqual([]);
    });

    it('another pairing was stored while the unpair was in flight: checking, paired true (the record of the newer pairing stays)', async () => {
      const w = pairedWorld();
      w.server().once('/v1/unpair', () => {
        w.idb.seed(OLD_REC);
        return 'default';
      });
      expect(await w.send(unpairMsg)).toEqual({ state: 'checking', paired: true });
      expect(w.idb.peek()).toEqual(OLD_REC);
    });

    it('the last events before the reply are a read that started after the last fetch and the removal', async () => {
      const w = pairedWorld();
      expect(await w.send(unpairMsg)).toEqual({ state: 'notPaired', paired: false });
      const ev = w.trace.events;
      expect(ev.slice(ev.findLastIndex((e) => e.startsWith('fetch:')) + 1)).toEqual([
        'idb:open',
        'idb:tx:readwrite',
        'idb:commit',
        'idb:open',
        'idb:tx:readwrite',
        'idb:commit',
        'reply',
      ]);
    });
  });
});

describe('AM-4: a 200 that is not JSON is appError, a 200 JSON that is not an object is mismatch (status rows above); the same for malformed UTF-8 (AM-6)', () => {
  it('a 200 of plain text: appError, paired true, the record kept', async () => {
    const w = pairedWorld();
    w.server().once('/v1/status', text(200, 'plain text'));
    expect(await w.send(statusMsg)).toEqual({ state: 'appError', paired: true });
    expect(w.idb.peek()).toEqual(REC);
  });

  it.each([
    ['[]', json(200, [])],
    ['null', json(200, null)],
    ['"x"', json(200, 'x')],
  ] as [string, Answer][])('a 200 %s: mismatch, paired true, the record kept, nothing else sent', async (_n, answer) => {
    const w = pairedWorld();
    w.server().once('/v1/status', answer);
    expect(await w.send(statusMsg)).toEqual({ state: 'mismatch', paired: true });
    expect(w.idb.peek()).toEqual(REC);
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/hello', '/v1/status']);
  });

  it('control: duplicate keys in valid UTF-8 are read like JSON.parse reads them (the last one wins): "engine":"error","engine":"ready" is connected', async () => {
    const w = pairedWorld();
    w.server().once('/v1/status', bytes(200, raw('{"app":"fetchly","protocol":1,"appVersion":"0.1.0","engine":"error","engine":"ready"}')));
    expect(await w.send(statusMsg)).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
  });

  it.each(BAD_UTF8)('a status body with "engine":"<%s>","engine":"ready": appError, paired true, the record kept', async (_n, bad) => {
    const w = pairedWorld();
    w.server().once('/v1/status', bytes(200, raw('{"app":"fetchly","protocol":1,"appVersion":"0.1.0","engine":"', bad, '","engine":"ready"}')));
    expect(await w.send(statusMsg)).toEqual({ state: 'appError', paired: true });
    expect(w.idb.peek()).toEqual(REC);
  });

  it.each(BAD_UTF8)('an unpair answer {"a":"<%s>"} is not a 200 ok: the record is removed and the note is added', async (_n, bad) => {
    const w = pairedWorld();
    w.server().once('/v1/unpair', bytes(200, raw('{"a":"', bad, '"}')));
    expect(await w.send(unpairMsg)).toEqual({ state: 'notPaired', paired: false, note: 'unpairedLocalOnly' });
  });
});

describe('AM-5: pair and unpair are gated, not queued; status is never gated', () => {
  it('an Unpair during a held pair: operationRunning (paired true, a record is stored), nothing sent to /v1/unpair or /v1/hello, the record untouched, nothing queued', async () => {
    const w = pairWorld();
    w.install(OLD_REC);
    const gate = holdAt(w.server(), '/v1/pair');
    const d1 = w.dispatch(pairMsg());
    await until(() => w.server().requests('/v1/pair').length === 1);
    const d2 = w.dispatch(unpairMsg);
    await until(() => d2.sent.length === 1);
    expect(d2.sent[0]).toEqual({ state: 'operationRunning', paired: true });
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair']);
    expect(w.net.to(PORT_B)).toEqual([]);
    expect(w.idb.peek()).toEqual(OLD_REC);
    expect(noPuts(w)).toBe(true);
    gate.release();
    expect(await d1.reply).toEqual({ state: 'checking', paired: true });
    await w.idle();
    expect(toPath(w, '/v1/unpair'), 'the unpair was not queued: it never runs').toBe(0);
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID });
  });

  it('a pair during a held unpair: operationRunning (paired true), nothing sent to /v1/pair, the record untouched until the unpair ends', async () => {
    const w = pairedWorld();
    w.server().openCode('ABCDEFGH');
    const gate = holdAt(w.server(), '/v1/unpair');
    const d1 = w.dispatch(unpairMsg);
    await until(() => w.server().requests('/v1/unpair').length === 1);
    const d2 = w.dispatch(pairMsg());
    await until(() => d2.sent.length === 1);
    expect(d2.sent[0]).toEqual({ state: 'operationRunning', paired: true });
    expect(toPath(w, '/v1/pair')).toBe(0);
    expect(w.idb.peek()).toEqual(REC);
    gate.release();
    expect(await d1.reply).toEqual({ state: 'notPaired', paired: false });
    await w.idle();
    expect(toPath(w, '/v1/pair'), 'the pair was not queued: it never runs').toBe(0);
  });

  it('an Unpair during a held unpair: operationRunning, /v1/unpair requested once', async () => {
    const w = pairedWorld();
    const gate = holdAt(w.server(), '/v1/unpair');
    const d1 = w.dispatch(unpairMsg);
    await until(() => w.server().requests('/v1/unpair').length === 1);
    const d2 = w.dispatch(unpairMsg);
    await until(() => d2.sent.length === 1);
    expect(d2.sent[0]).toEqual({ state: 'operationRunning', paired: true });
    gate.release();
    expect(await d1.reply).toEqual({ state: 'notPaired', paired: false });
    await w.idle();
    expect(toPath(w, '/v1/unpair')).toBe(1);
  });

  it('several gated messages in a row are all answered operationRunning, and none is queued: after the running pair ends nothing else runs', async () => {
    const w = pairWorld();
    const gate = holdAt(w.server(), '/v1/pair');
    const d1 = w.dispatch(pairMsg());
    await until(() => w.server().requests('/v1/pair').length === 1);
    const gated = [w.dispatch(pairMsg()), w.dispatch(unpairMsg), w.dispatch(pairMsg()), w.dispatch(unpairMsg)];
    await until(() => gated.every((d) => d.sent.length === 1));
    for (const d of gated) expect(d.sent[0]).toEqual({ state: 'operationRunning', paired: false });
    gate.release();
    expect(await d1.reply).toEqual({ state: 'checking', paired: true });
    await w.idle();
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair']);
  });

  it('after pair 1 ends, a new pair runs (the gate is open again)', async () => {
    const w = pairWorld();
    expect(await w.send(pairMsg())).toEqual({ state: 'checking', paired: true });
    w.server().openCode('ABCDEFGH');
    w.server().issue = cred(5);
    expect(await w.send(pairMsg())).toEqual({ state: 'checking', paired: true });
    expect(toPath(w, '/v1/pair')).toBe(2);
    expect(w.idb.peek()).toMatchObject({ pairingId: cred(5).pairingId });
  });

  it('after an unpair ends, a pair runs; after a pair ends, an unpair runs', async () => {
    const w = pairedWorld();
    expect(await w.send(unpairMsg)).toEqual({ state: 'notPaired', paired: false });
    w.server().openCode('ABCDEFGH');
    expect(await w.send(pairMsg())).toEqual({ state: 'checking', paired: true });
    expect(await w.send(unpairMsg)).toEqual({ state: 'notPaired', paired: false });
    expect(w.idb.peek()).toBeUndefined();
  });

  it('status is never gated: during a held pair and during a held unpair it gets its own, normal reply', async () => {
    const w = pairedWorld();
    w.server().openCode('ABCDEFGH');
    const gate = holdAt(w.server(), '/v1/pair');
    const d1 = w.dispatch(pairMsg());
    await until(() => w.server().requests('/v1/pair').length === 1);
    expect(await w.send(statusMsg)).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    gate.release();
    expect(await d1.reply).toMatchObject({ state: 'checking' });

    const u = pairedWorld();
    const ugate = holdAt(u.server(), '/v1/unpair');
    const d2 = u.dispatch(unpairMsg);
    await until(() => u.server().requests('/v1/unpair').length === 1);
    expect(await u.send(statusMsg)).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    ugate.release();
    expect(await d2.reply).toMatchObject({ state: 'notPaired' });
  });

  it.each([
    ['a pair', pairMsg()],
    ['an unpair', unpairMsg],
  ])('%s that arrives during a running pair and whose store read fails: storageBlocked, paired false, nothing sent, nothing mutated', async (_n, msg) => {
    const w = pairWorld();
    const gate = holdAt(w.server(), '/v1/pair');
    const d1 = w.dispatch(pairMsg());
    await until(() => w.server().requests('/v1/pair').length === 1);
    // Counted from here: the gated message's one read is the next open.
    failNthOpen(w, 1);
    const d2 = w.dispatch(msg);
    await until(() => d2.sent.length === 1);
    expect(d2.sent[0]).toEqual({ state: 'storageBlocked', paired: false });
    expect(w.net.log).toHaveLength(1);
    expect(noPuts(w)).toBe(true);
    gate.release();
    expect(await d1.reply).toEqual({ state: 'checking', paired: true });
  });

  it.each([
    ['a pair', pairMsg()],
    ['an unpair', unpairMsg],
  ])('%s that arrives during a running pair is answered from exactly one read, started after the previous event', async (_n, msg) => {
    const w = pairWorld();
    const gate = holdAt(w.server(), '/v1/pair');
    const d1 = w.dispatch(pairMsg());
    await until(() => w.server().requests('/v1/pair').length === 1);
    const before = w.trace.events.length;
    const d2 = w.dispatch(msg);
    await until(() => d2.sent.length === 1);
    expect(w.trace.events.slice(before)).toEqual(['idb:open', 'idb:tx:readwrite', 'idb:commit', 'reply']);
    gate.release();
    await d1.reply;
  });

  describe('the gate opens when the running job settles, also on a throw', () => {
    /** The real store over the fake IndexedDB with a client whose first pair or unpair throws; handlers on a fake chrome. */
    function throwingJob(which: 'pair' | 'unpair') {
      const trace = new Trace();
      const clock = new FakeClock();
      const chrome = createFakeChrome({ trace });
      const idb = new FakeIdb({ trace });
      idb.seed(REC);
      const store = createStore({ idb: idb.factory, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
      const calls = { pair: 0, callWith: 0 };
      const client: Client = {
        call: async () => ({ ok: false, kind: 'not_paired' }),
        callWith: async () => {
          calls.callWith += 1;
          if (which === 'unpair' && calls.callWith === 1) throw new Error('boom');
          return { ok: true, value: {} };
        },
        pair: async () => {
          calls.pair += 1;
          if (which === 'pair' && calls.pair === 1) throw new Error('boom');
          return { ok: true, pairingId: PAIRING_ID, token: TOKEN, appVersion: '0.1.0' };
        },
      };
      registerHandlers({ runtime: chrome.runtime, client, store, nav: NAV_CHROME });
      const send = (message: unknown) => chrome.runtime.onMessage.dispatch(message, popupSender(chrome));
      return { calls, send, idb };
    }

    it('a pair that throws: the next pair runs (client.pair is called again) and is not answered by the gate', async () => {
      const { calls, send, idb } = throwingJob('pair');
      const d1 = send(pairMsg());
      expect(d1.returned).toBe(true);
      await until(() => calls.pair === 1);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const d2 = send(pairMsg());
      await until(() => d2.sent.length === 1);
      expect(calls.pair, 'the second pair ran').toBe(2);
      expect(d2.sent[0]).toEqual({ state: 'checking', paired: true });
      expect((idb.peek() as Rec).pairingId).toBe(PAIRING_ID);
    });

    it('an unpair that throws: the next unpair runs (client.callWith is called again) and is not answered by the gate', async () => {
      const { calls, send, idb } = throwingJob('unpair');
      const d1 = send(unpairMsg);
      expect(d1.returned).toBe(true);
      await until(() => calls.callWith === 1);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const d2 = send(unpairMsg);
      await until(() => d2.sent.length === 1);
      expect(calls.callWith, 'the second unpair ran').toBe(2);
      expect(d2.sent[0]).toEqual({ state: 'notPaired', paired: false });
      expect(idb.peek()).toBeUndefined();
    });

    it('a pair that throws, then an unpair: the unpair runs too', async () => {
      const { calls, send, idb } = throwingJob('pair');
      send(pairMsg());
      await until(() => calls.pair === 1);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const d2 = send(unpairMsg);
      await until(() => d2.sent.length === 1);
      expect(calls.callWith).toBe(1);
      expect(idb.peek()).toBeUndefined();
    });
  });

  it('timing: a failed pair that takes ~19 s does not hold an Unpair sent at 1 s: the Unpair reply comes at once, with no clock advance', async () => {
    const w = pairWorld();
    const s = w.server();
    s.once('/v1/pair', async () => {
      await clockDelay(w, 4999);
      return 'default' as const;
    });
    s.once('/v1/hello', async () => {
      await clockDelay(w, 4999);
      return 'default' as const;
    });
    s.once('/v1/unpair', async () => {
      await clockDelay(w, 4999);
      return 'default' as const;
    });
    w.idb.sw.commitHold = 'write';
    const t0 = w.clock.now();
    const pair = w.dispatch(pairMsg());
    await until(() => s.requests('/v1/pair').length === 1);
    w.clock.advance(1000);
    const unpair = w.dispatch(unpairMsg);
    await until(() => unpair.sent.length === 1);
    expect(unpair.sent[0]).toEqual({ state: 'operationRunning', paired: false });
    expect(w.clock.now() - t0, 'the Unpair reply came with no clock advance').toBe(1000);
    expect(pair.sent, 'the pair is still running').toEqual([]);
    // The pair goes on: its answer after 4999 ms, a write that refuses to commit for 3999 ms and is then aborted, a best-effort unpair
    // whose hello and request each take 4999 ms.
    w.clock.advance(3999);
    await until(() => w.idb.committing.length === 1);
    w.clock.advance(3999);
    await w.idle();
    expect(pair.sent).toEqual([]);
    w.idb.releaseCommitting('abort');
    await until(() => toPath(w, '/v1/hello') === 1);
    w.clock.advance(4999);
    await until(() => toPath(w, '/v1/unpair') === 1);
    w.clock.advance(4999);
    expect(await pair.reply).toEqual({ state: 'storageFailed', paired: false });
    expect(w.clock.now() - t0).toBeGreaterThanOrEqual(18_000);
    expect(toPath(w, '/v1/unpair'), 'only the pair\'s own best-effort unpair').toBe(1);
  });
});

// =============================================================================================
// Amendment 2 (docs/plans/2026-11-23-phase2-a2-amendment-2.md)
// =============================================================================================

describe('AM2-1: the gate answers operationRunning, with paired from its one read, and never to a status', () => {
  type Job = 'pair' | 'unpair';
  const PATH: Record<Job, string> = { pair: '/v1/pair', unpair: '/v1/unpair' };
  const MSG: Record<Job, () => unknown> = { pair: () => pairMsg(), unpair: () => unpairMsg };

  /**
   * A pair or an unpair that waits at the app (nothing has been mutated yet). `record`: a record is stored while a pair runs; an unpair
   * always runs on a stored one. A code is open, so a gated pair that ran anyway would succeed and show as a second /v1/pair.
   */
  async function startJob(job: Job, record: boolean) {
    const w = job === 'unpair' ? pairedWorld() : pairWorld();
    if (job === 'unpair') w.server().openCode('ABCDEFGH');
    if (job === 'pair' && record) w.install(OLD_REC);
    const gate = holdAt(w.server(), PATH[job]);
    const first = w.dispatch(MSG[job]());
    await until(() => w.server().requests(PATH[job]).length === 1);
    return { w, gate, first };
  }

  /** [the running job, whether a record is stored, the `paired` the gate's one read finds]. */
  const ROWS: [Job, boolean, boolean][] = [
    ['pair', false, false],
    ['pair', true, true],
    ['unpair', true, true],
  ];
  const GATED: [string, Job][] = [
    ['a pair', 'pair'],
    ['an unpair', 'unpair'],
  ];
  const MATRIX = ROWS.flatMap(([job, record, paired]) => GATED.map(([name, gated]) => [job, record, paired, name, gated] as [Job, boolean, boolean, string, Job]));

  it.each(MATRIX)('a running %s (record stored: %s, the gate reads paired %s): %s that arrives gets operationRunning; nothing is run, sent, mutated or queued', async (job, record, paired, _name, gatedJob) => {
    const { w, gate, first } = await startJob(job, record);
    const before = { net: w.net.log.length, pair: toPath(w, '/v1/pair'), unpair: toPath(w, '/v1/unpair'), opens: opens(w), stored: w.idb.peek() };
    const gated = w.dispatch(MSG[gatedJob]());
    await until(() => gated.sent.length === 1);
    expect(gated.sent[0]).toEqual({ state: 'operationRunning', paired });
    expect(Object.keys(gated.sent[0] as object).sort(), 'the reply has only state and paired').toEqual(['paired', 'state']);
    expect(w.net.log.length, 'nothing was sent').toBe(before.net);
    expect(toPath(w, '/v1/pair'), '/v1/pair count').toBe(before.pair);
    expect(toPath(w, '/v1/unpair'), '/v1/unpair count').toBe(before.unpair);
    expect(opens(w) - before.opens, 'exactly one read').toBe(1);
    expect(noPuts(w), 'no put and no delete').toBe(true);
    expect(w.idb.peek(), 'the record is untouched').toEqual(before.stored);
    expect(first.sent, 'the running job is still running').toEqual([]);
    gate.release();
    expect(await first.reply).toEqual(job === 'pair' ? { state: 'checking', paired: true } : { state: 'notPaired', paired: false });
    await w.idle();
    expect(toPath(w, '/v1/pair'), 'the gated message was not queued: /v1/pair').toBe(job === 'pair' ? 1 : 0);
    expect(toPath(w, '/v1/unpair'), 'the gated message was not queued: /v1/unpair').toBe(job === 'unpair' ? 1 : 0);
  });

  // Rule 2: the gate runs before the pair's input parse (messages.ts:299), so a gated pair with bad input is not badInput. With the gate
  // open the same message IS badInput (the control), and its `paired` is what the record is after the job: a pair stored one, an unpair
  // removed it.
  const BAD: [string, unknown][] = [
    ['nonsense', pairMsg('nonsense')],
    ['an empty pairing string', pairMsg('')],
    ['a label over 64 units', pairMsg(undefined, 'L'.repeat(65))],
    ['a pairing string over 64 units', pairMsg(`${PORT}-${'A'.repeat(65)}`)],
  ];
  const BAD_MATRIX = ROWS.flatMap(([job, record, paired]) => BAD.map(([name, msg]) => [job, record, paired, name, msg] as [Job, boolean, boolean, string, unknown]));

  it.each(BAD_MATRIX)('a running %s (record stored: %s, paired %s): a gated pair with %s answers operationRunning, not badInput, from one read; with the gate open it is badInput', async (job, record, paired, _name, msg) => {
    const { w, gate, first } = await startJob(job, record);
    const netBefore = w.net.log.length;
    const opensBefore = opens(w);
    const gated = w.dispatch(msg);
    await until(() => gated.sent.length === 1);
    expect(gated.sent[0]).toEqual({ state: 'operationRunning', paired });
    expect(opens(w) - opensBefore, 'exactly one read').toBe(1);
    expect(w.net.log.length, 'nothing sent').toBe(netBefore);
    gate.release();
    await first.reply;
    await w.idle();
    expect(await w.send(msg), 'the same message with the gate open').toEqual({ state: 'badInput', paired: job === 'pair' });
  });

  // The earliest boundary of "a job is running": the second message is dispatched in the same tick as the first, before the first has awaited
  // anything. The gate flag is set synchronously, so the second is gated all the same (never run, never queued).
  it.each([
    ['a pair, then a pair', false, 'pair', 'pair'],
    ['a pair, then an unpair', false, 'pair', 'unpair'],
    ['an unpair, then a pair', true, 'unpair', 'pair'],
    ['an unpair, then an unpair', true, 'unpair', 'unpair'],
  ] as [string, boolean, Job, Job][])('dispatched in the same tick (%s): the second gets operationRunning with paired %s from its one read, and only the first runs', async (_n, paired, first, second) => {
    const w = first === 'unpair' ? pairedWorld() : pairWorld();
    if (first === 'unpair') w.server().openCode('ABCDEFGH');
    const d1 = w.dispatch(MSG[first]());
    const d2 = w.dispatch(MSG[second]());
    await until(() => d2.sent.length === 1);
    expect(d2.sent[0]).toEqual({ state: 'operationRunning', paired });
    expect(await d1.reply).toEqual(first === 'pair' ? { state: 'checking', paired: true } : { state: 'notPaired', paired: false });
    await w.idle();
    expect(toPath(w, '/v1/pair'), 'the second was not run or queued: /v1/pair').toBe(first === 'pair' ? 1 : 0);
    expect(toPath(w, '/v1/unpair'), 'the second was not run or queued: /v1/unpair').toBe(first === 'unpair' ? 1 : 0);
  });

  it('a gated pair with bad input whose one read fails answers storageBlocked (paired false), not operationRunning and not badInput', async () => {
    const { w, gate, first } = await startJob('pair', false);
    failNthOpen(w, 1);
    const gated = w.dispatch(pairMsg('nonsense'));
    await until(() => gated.sent.length === 1);
    expect(gated.sent[0]).toEqual({ state: 'storageBlocked', paired: false });
    gate.release();
    expect(await first.reply).toEqual({ state: 'checking', paired: true });
  });

  it.each(GATED)('%s that arrives during a running unpair and whose one read fails answers storageBlocked (paired false), nothing sent', async (_n, gatedJob) => {
    const { w, gate, first } = await startJob('unpair', true);
    const netBefore = w.net.log.length;
    failNthOpen(w, 1);
    const gated = w.dispatch(MSG[gatedJob]());
    await until(() => gated.sent.length === 1);
    expect(gated.sent[0]).toEqual({ state: 'storageBlocked', paired: false });
    expect(w.net.log.length).toBe(netBefore);
    gate.release();
    expect(await first.reply).toEqual({ state: 'notPaired', paired: false });
  });

  // Rule 1: fetchly:status is never gated, so it never gets operationRunning: it answers its own row, during a held pair and a held unpair.
  it.each([
    ['a held pair, no record', 'pair', false, { state: 'notPaired', paired: false }],
    ['a held pair, a record stored', 'pair', true, { state: 'connected', paired: true, appVersion: '0.1.0' }],
    ['a held unpair', 'unpair', true, { state: 'connected', paired: true, appVersion: '0.1.0' }],
  ] as [string, Job, boolean, Reply][])('status during %s still gets its normal reply and never operationRunning', async (_n, job, record, expected) => {
    const { w, gate, first } = await startJob(job, record);
    const reply = (await w.send(statusMsg)) as Reply;
    expect(reply).toEqual(expected);
    expect(reply.state).not.toBe('operationRunning');
    expect(first.sent, 'the running job is still running').toEqual([]);
    gate.release();
    await first.reply;
  });

  it('status during a held pair whose store cannot be read answers storageBlocked, not operationRunning', async () => {
    const { w, gate, first } = await startJob('pair', false);
    w.idb.sw.openError = 'UnknownError';
    expect(await w.send(statusMsg)).toEqual({ state: 'storageBlocked', paired: false });
    w.idb.sw.openError = null;
    gate.release();
    expect(await first.reply).toEqual({ state: 'checking', paired: true });
  });

  // Rule 5 and the edge cases: nothing retries by itself, and the gate opens when the job ends.
  it('after the running pair ends, the same Unpair sent again runs and answers notPaired: hello and /v1/unpair with the new credentials, the replaced record is never contacted', async () => {
    const { w, gate, first } = await startJob('pair', true);
    const gated = w.dispatch(unpairMsg);
    await until(() => gated.sent.length === 1);
    expect(gated.sent[0]).toEqual({ state: 'operationRunning', paired: true });
    expect(toPath(w, '/v1/unpair')).toBe(0);
    gate.release();
    expect(await first.reply).toEqual({ state: 'checking', paired: true });
    expect(await w.send(unpairMsg)).toEqual({ state: 'notPaired', paired: false });
    await w.idle();
    const toNew = w.net.to(PORT).filter((r) => r.path !== '/v1/pair');
    expect(toNew.map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    expect(toNew[1]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(w.idb.peek()).toBeUndefined();
    expect(w.net.to(PORT_B), 'Unpair drops held: the replaced record is never contacted').toEqual([]);
  });

  it('after the running unpair ends, the same Unpair sent again runs and answers notPaired with nothing to remove: no request, no note', async () => {
    const { w, gate, first } = await startJob('unpair', true);
    const gated = w.dispatch(unpairMsg);
    await until(() => gated.sent.length === 1);
    expect(gated.sent[0]).toEqual({ state: 'operationRunning', paired: true });
    gate.release();
    expect(await first.reply).toEqual({ state: 'notPaired', paired: false });
    const netAfterFirst = w.net.log.length;
    expect(await w.send(unpairMsg)).toEqual({ state: 'notPaired', paired: false });
    expect(w.net.log.length, 'nothing is left to unpair, so nothing is sent').toBe(netAfterFirst);
    expect(toPath(w, '/v1/unpair'), 'the first unpair only').toBe(1);
  });

  it('after the running pair ends, the same pair sent again runs (the gate is open): it is answered by the app, not by the gate', async () => {
    const { w, gate, first } = await startJob('pair', false);
    const gated = w.dispatch(pairMsg());
    await until(() => gated.sent.length === 1);
    expect(gated.sent[0]).toEqual({ state: 'operationRunning', paired: false });
    gate.release();
    expect(await first.reply).toEqual({ state: 'checking', paired: true });
    // Double submit: the code is spent, so the app says so; `paired` is true because the first pair stored its record.
    expect(await w.send(pairMsg())).toEqual({ state: 'pairingClosed', paired: true });
    expect(toPath(w, '/v1/pair')).toBe(2);
  });

  it('operationRunning carries no appVersion and no note, in any gated reply', async () => {
    const { w, gate, first } = await startJob('unpair', true);
    const replies = [w.dispatch(pairMsg()), w.dispatch(unpairMsg), w.dispatch(pairMsg('nonsense'))];
    await until(() => replies.every((d) => d.sent.length === 1));
    for (const d of replies) expect(d.sent[0]).toStrictEqual({ state: 'operationRunning', paired: true });
    gate.release();
    await first.reply;
  });
});

describe('AM2-2: a stalled step keeps the gate shut, and no token is sent in that state (no behaviour change)', () => {
  type Stall = 'unpair' | 'bestEffort' | 'pair';
  const STALLS: [string, Stall][] = [
    ['a callWith inside unpair', 'unpair'],
    ['a callWith inside the best-effort unpair of a pair whose write failed', 'bestEffort'],
    ['client.pair (a stalled WebCrypto call inside the pair)', 'pair'],
  ];
  /** What the stub client was asked, and the stub of this spec: the first call of the stalled step never settles. */
  interface Calls {
    pair: number;
    callWith: number;
    call: number;
  }
  function makeClient(calls: Calls, stall: Stall | null): Client {
    const never = (): Promise<never> => new Promise<never>(() => undefined);
    return {
      call: async () => {
        calls.call += 1;
        return { ok: true, value: statusBody() };
      },
      callWith: async () => {
        calls.callWith += 1;
        if ((stall === 'unpair' || stall === 'bestEffort') && calls.callWith === 1) return never();
        return { ok: true, value: {} };
      },
      pair: async () => {
        calls.pair += 1;
        if (stall === 'pair' && calls.pair === 1) return never();
        return { ok: true, pairingId: cred(5).pairingId, token: cred(5).token, appVersion: '0.1.0' };
      },
    };
  }

  /** The real store over the fake IndexedDB (REC stored), the handlers on a fake chrome, and a stub client (the style of `throwingJob`). */
  function stalledWorker(stall: Stall | null) {
    const trace = new Trace();
    const clock = new FakeClock();
    const chrome = createFakeChrome({ trace });
    const idb = new FakeIdb({ trace });
    idb.seed(REC);
    const store = createStore({ idb: idb.factory, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const calls: Calls = { pair: 0, callWith: 0, call: 0 };
    registerHandlers({ runtime: chrome.runtime, client: makeClient(calls, stall), store, nav: NAV_CHROME });
    const send = (message: unknown) => chrome.runtime.onMessage.dispatch(message, popupSender(chrome));
    /** How many times the stalled step was entered. */
    const entered = (): number => (stall === 'pair' ? calls.pair : calls.callWith);
    const mutations = (): number => idb.log.filter((e) => e.op === 'put' || e.op === 'delete').length;
    return { calls, send, idb, store, clock, trace, entered, mutations };
  }

  /** The first message of the stall: an unpair, or a pair (whose write is refused, so that its best-effort unpair runs). */
  async function startStall(stall: Stall) {
    const w = stalledWorker(stall);
    if (stall === 'bestEffort') w.idb.sw.abortAt = 'write';
    const first = w.send(stall === 'unpair' ? unpairMsg : pairMsg());
    await until(() => w.entered() === 1);
    return { w, first };
  }

  it.each(STALLS)('%s never settles: a later unpair, pair and pair with bad input answer operationRunning (not checking, not queued) from one read; nothing is called or mutated', async (_d, stall) => {
    const { w, first } = await startStall(stall);
    expect(first.sent, 'the stalled job has no reply').toEqual([]);
    const callsBefore = { ...w.calls };
    const mutationsBefore = w.mutations();
    for (const [name, msg] of [
      ['an unpair', unpairMsg],
      ['a pair', pairMsg()],
      ['a pair with bad input', pairMsg('nonsense')],
    ] as [string, unknown][]) {
      const d = w.send(msg);
      await until(() => d.sent.length === 1);
      expect(d.sent[0], name).toEqual({ state: 'operationRunning', paired: true });
    }
    expect(w.calls, 'no client call was made again: no token is sent').toEqual(callsBefore);
    expect(w.mutations(), 'nothing was mutated').toBe(mutationsBefore);
    expect(first.sent, 'the stalled job still has no reply').toEqual([]);
  });

  it.each(STALLS)('%s never settles: status still answers (connected, paired true), and the gate stays shut however much time passes', async (_d, stall) => {
    const { w, first } = await startStall(stall);
    const status = w.send(statusMsg);
    await until(() => status.sent.length === 1);
    expect(status.sent[0]).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    expect(w.calls.call, 'status made its own call').toBe(1);
    w.clock.advance(10 * 60_000);
    const later = w.send(unpairMsg);
    await until(() => later.sent.length === 1);
    expect(later.sent[0], 'ten minutes later the gate is still shut: there is no timer on it').toEqual({ state: 'operationRunning', paired: true });
    expect(first.sent).toEqual([]);
  });

  it.each(STALLS)('%s never settles: a worker restart reopens the gate (the flag is module memory), over the disk the stalled job left', async (_d, stall) => {
    const { w } = await startStall(stall);
    const shut = w.send(unpairMsg);
    await until(() => shut.sent.length === 1);
    expect(shut.sent[0]).toEqual({ state: 'operationRunning', paired: true });
    // A new worker over the same disk: new chrome, new handlers, nothing in memory. (The refused write of the best-effort case was the
    // first worker's; the disk of the new one commits.)
    w.idb.sw.abortAt = 'none';
    const chrome2 = createFakeChrome({ trace: w.trace });
    registerHandlers({ runtime: chrome2.runtime, client: makeClient({ pair: 0, callWith: 0, call: 0 }, null), store: w.store, nav: NAV_CHROME });
    const d = chrome2.runtime.onMessage.dispatch(unpairMsg, popupSender(chrome2));
    await until(() => d.sent.length === 1);
    expect(d.sent[0], 'the new worker runs the unpair').toEqual({ state: 'notPaired', paired: false });
  });

  it('control: with no stalled step the same messages run and are answered by their own handlers, never by the gate', async () => {
    const w = stalledWorker(null);
    const one = w.send(unpairMsg);
    await until(() => one.sent.length === 1);
    expect(one.sent[0]).toEqual({ state: 'notPaired', paired: false });
    const two = w.send(pairMsg());
    await until(() => two.sent.length === 1);
    expect(two.sent[0]).toEqual({ state: 'checking', paired: true });
    const three = w.send(pairMsg('nonsense'));
    await until(() => three.sent.length === 1);
    expect(three.sent[0]).toEqual({ state: 'badInput', paired: true });
    expect(w.calls).toEqual({ pair: 1, callWith: 1, call: 0 });
  });
});

describe('AM2-3 in the handlers: a write that answers storage_failed changed nothing; an ok write whose final read fails keeps held', () => {
  /** A is stored (and known to the app); a code is open for B on PORT. */
  const worldWithA = (): World => {
    const w = pairWorld();
    w.install(OLD_REC);
    return w;
  };
  const unpairsTo = (w: World, port: number) => w.net.to(port).filter((r) => r.path === '/v1/unpair');

  const WAYS: [string, (w: World) => void][] = [
    [
      'the transaction aborts (onabort)',
      (w) => {
        w.idb.sw.abortAt = 'write';
      },
    ],
    [
      'store.write answers storage_failed and wrote nothing (the oncomplete-after-a-throw answer of AM2-3)',
      (w) => {
        w.store.write = async () => ({ ok: false, kind: 'storage_failed' }) as const;
      },
    ],
  ];

  it.each(WAYS)('A is stored, B is paired, %s: exactly one /v1/unpair with B\'s credentials, storageFailed with paired true, A still stored; a connected status then sends no /v1/unpair to A', async (_n, setup) => {
    const w = worldWithA();
    setup(w);
    expect(await w.send(pairMsg())).toEqual({ state: 'storageFailed', paired: true });
    await w.idle();
    const toB = unpairsTo(w, PORT);
    expect(toB, 'exactly one /v1/unpair, to B').toHaveLength(1);
    expect(toB[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(w.net.to(PORT).map((r) => r.path)).toEqual(['/v1/pair', '/v1/hello', '/v1/unpair']);
    expect(w.server(PORT).pairings.has(PAIRING_ID), 'B is gone from the app').toBe(false);
    expect(w.idb.peek(), 'A is still stored').toEqual(OLD_REC);
    expect(w.net.to(PORT_B), 'A was not contacted').toEqual([]);
    w.idb.sw.abortAt = 'none';
    expect(await w.send(statusMsg)).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    await w.idle();
    expect(unpairsTo(w, PORT_B), 'a following connected status sends no /v1/unpair to A').toEqual([]);
    expect(w.net.to(PORT_B).map((r) => r.path)).toEqual(['/v1/hello', '/v1/status']);
    expect(w.server(PORT_B).pairings.has(OLD_REC.pairingId), 'A is still known to the app').toBe(true);
    expect(unpairsTo(w, PORT), 'and B was unpaired once, never again').toHaveLength(1);
  });

  // Rule 5: after rule 2, `ok` is always a real oncomplete with the work finished, so `held = replaced` stays set before the final read,
  // also when that read fails. The reply is storageBlocked with paired false; the pair itself is stored.
  it('A is stored, the write answers ok and the final read fails: storageBlocked (paired false); a later connected status unpairs A exactly once', async () => {
    const w = worldWithA();
    failNthOpen(w, 3);
    expect(await w.send(pairMsg())).toEqual({ state: 'storageBlocked', paired: false });
    expect(w.idb.peek(), 'the write did commit').toMatchObject({ pairingId: PAIRING_ID, token: TOKEN });
    expect(w.net.to(PORT_B), 'A is not contacted at pair time').toEqual([]);
    expect(unpairsTo(w, PORT), 'nor is B').toEqual([]);
    expect(await w.send(statusMsg)).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    await w.idle();
    const toA = w.net.to(PORT_B);
    expect(toA.map((r) => r.path)).toEqual(['/v1/hello', '/v1/unpair']);
    expect(toA[1]?.authorization).toBe(`Bearer ${OLD_REC.token}`);
    expect(w.server(PORT_B).pairings.has(OLD_REC.pairingId)).toBe(false);
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    await w.idle();
    expect(w.net.to(PORT_B), 'exactly once').toHaveLength(2);
  });
});
