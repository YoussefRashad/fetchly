/**
 * Task 5: extension/src/lib/store.ts, the pairing record in IndexedDB (E9, N32, DV1; R2-5).
 *
 * Enumerations:
 *  - Store operations: read, write, removeIf, clear. Every failure and boundary test runs over all four.
 *  - Keys of a PairingRecord (7): v, pairingId, token, port, appVersion, label, pairedAt. Each one is tested missing, and
 *    each one with an out-of-range or wrong-type value (see INVALID below).
 *  - Result kinds: { ok: true, value } | { ok: false, kind: 'storage_blocked' } (cannot open) | { ok: false, kind: 'storage_failed' }
 *    (the transaction did not commit).
 *  - Fake switches (tests/extension/fakeIdb.ts): openThrows, openError (also VersionError), openBlocked, openHang, transactionThrows,
 *    abortAt, holdAt, requestError, plus a factory that is undefined.
 *  - IndexedDB names the code may log: database `fetchly`, store `kv`, key `pairing`, and nothing else.
 *  - Deadline: 3000 ms, open and transaction together. 2999 pending, 3000 answered.
 *
 * Amendment 1 (AM-1) adds, at the end of this file:
 *  - Result kind `storage_unknown` (write, removeIf and clear only; read answers storage_failed where the rules give unknown).
 *  - Fake switch `commitHold` ('write' | 'any'): the transaction is stuck IN the commit, abort() throws, and releaseCommitting('complete' | 'abort')
 *    ends it. The existing `holdAt` tests above stay as they are: abort() succeeds there.
 *  - Ways a transaction ends: oncomplete (ok), onabort (storage_failed), abort() returning (storage_failed), abort() throwing then a terminal
 *    event inside the 1000 ms grace, or no event (storage_unknown; storage_failed for read). `tx.onerror` alone answers nothing.
 *  - Boundaries: 2999 / 3000 ms (abort() is called) and 3999 / 4000 ms (the grace ends).
 *
 * Amendment 2 (AM2-3, docs/plans/2026-11-23-phase2-a2-amendment-2.md) changes one answer: `storage_failed` means a confirmed no-mutation.
 * When `work` threw synchronously (it returned no getter) and `oncomplete` then fires inside the grace, write, removeIf and clear answer
 * `storage_failed`, not `ok` (read already did). The no-event case stays `storage_unknown` (rule 4). The real fake still gives `ok` when
 * the work finished. The cases are in the describes 'AM-1: work throws and abort() throws too' and 'AM2-3: control on the real fake'.
 */
import { describe, expect, it } from 'vitest';
import { FakeClock, Trace, flush, track } from './clock';
import { FakeIdb, newBacking, type IdbLogEntry } from './fakeIdb';
import { PAIRING_ID, PAIRING_ID_B, TOKEN, makeRecord, makeRecordB, type Rec } from './fixtures';
import { createStore } from '../../extension/src/lib/store';

type Op = 'read' | 'write' | 'removeIf' | 'clear';
const OPS: Op[] = ['read', 'write', 'removeIf', 'clear'];
const REC = makeRecord();

function setup(opts: { backing?: ReturnType<typeof newBacking> } = {}) {
  const clock = new FakeClock();
  const trace = new Trace();
  const idb = new FakeIdb({ trace, ...(opts.backing ? { backing: opts.backing } : {}) });
  const store = createStore({ idb: idb.factory, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  return { clock, trace, idb, store };
}
type Store = ReturnType<typeof setup>['store'];

const run = (store: Store, op: Op, rec: Rec = REC): Promise<unknown> => {
  switch (op) {
    case 'read':
      return store.read();
    case 'write':
      return store.write(rec);
    case 'removeIf':
      return store.removeIf(rec.pairingId);
    case 'clear':
      return store.clear();
  }
};

const BLOCKED = { ok: false, kind: 'storage_blocked' };
const FAILED = { ok: false, kind: 'storage_failed' };

/** All transactions in a log. */
const txs = (log: IdbLogEntry[]): Extract<IdbLogEntry, { op: 'transaction' }>[] => log.filter((e): e is Extract<IdbLogEntry, { op: 'transaction' }> => e.op === 'transaction');

describe('opening and the first run', () => {
  it('creating the store opens nothing; every operation opens, runs one readwrite transaction and closes', async () => {
    const { idb, store } = setup();
    expect(idb.log).toEqual([]);
    for (const op of OPS) {
      idb.seed(REC);
      const before = idb.log.length;
      const r = await run(store, op);
      await flush();
      expect(r, op).toMatchObject({ ok: true });
      const mine = idb.log.slice(before);
      expect(mine.filter((e) => e.op === 'open'), op).toEqual([{ op: 'open', name: 'fetchly', version: 1 }]);
      const t = txs(mine);
      expect(t, op).toHaveLength(1);
      expect(t[0]?.mode, op).toBe('readwrite');
      expect(idb.openConnections, op).toBe(0);
    }
  });

  it('the first open creates the store `kv` (once); later opens do not', async () => {
    const { idb, store } = setup();
    expect(await store.read()).toEqual({ ok: true, value: null });
    await flush();
    expect(idb.log.filter((e) => e.op === 'createObjectStore')).toEqual([{ op: 'createObjectStore', name: 'kv' }]);
    expect(idb.backing.dbs.get('fetchly')?.version).toBe(1);
    expect(idb.backing.dbs.get('fetchly')?.stores.has('kv')).toBe(true);
    await store.read();
    await store.write(REC);
    expect(idb.log.filter((e) => e.op === 'createObjectStore')).toHaveLength(1);
    expect(idb.log.filter((e) => e.op === 'open')).toHaveLength(3);
  });

  it('a round trip keeps the exact record, under the key `pairing`', async () => {
    const { idb, store } = setup();
    expect(await store.write(REC)).toMatchObject({ ok: true });
    expect(idb.peek()).toEqual(REC);
    expect(await store.read()).toEqual({ ok: true, value: REC });
    expect(Object.keys((await store.read()) as object).sort()).toEqual(['ok', 'value']);
  });

  it('a restarted store over the same backing map reads the record', async () => {
    const a = setup();
    await a.store.write(REC);
    const b = setup({ backing: a.idb.backing });
    expect(await b.store.read()).toEqual({ ok: true, value: REC });
  });

  it('reads an empty store as none', async () => {
    const { store } = setup();
    expect(await store.read()).toEqual({ ok: true, value: null });
  });

  it('write replaces the record', async () => {
    const { idb, store } = setup();
    await store.write(REC);
    await store.write(makeRecordB());
    expect(idb.peek()).toEqual(makeRecordB());
  });

  it('accepts the boundary values of every rule', async () => {
    const { idb, store } = setup();
    const ok: Rec[] = [
      makeRecord({ label: 'x'.repeat(40) }),
      makeRecord({ label: 'x' }),
      makeRecord({ port: 1024 }),
      makeRecord({ port: 65535 }),
      makeRecord({ appVersion: 'v'.repeat(64) }),
      makeRecord({ appVersion: '1' }),
      makeRecord({ pairedAt: 0 }),
    ];
    for (const rec of ok) {
      idb.seed(rec);
      expect(await store.read(), JSON.stringify(rec)).toEqual({ ok: true, value: rec });
      expect(idb.peek()).toEqual(rec);
    }
  });

  it('accepts a record whose keys come in another order', async () => {
    const { idb, store } = setup();
    const r = makeRecord();
    idb.seed({ pairedAt: r.pairedAt, label: r.label, appVersion: r.appVersion, port: r.port, token: r.token, pairingId: r.pairingId, v: 1 });
    expect(await store.read()).toMatchObject({ ok: true, value: r });
  });
});

describe('strict parse: an odd shape reads as none and is deleted in the same readwrite transaction', () => {
  const base = makeRecord();
  const without = (key: keyof Rec): Record<string, unknown> => {
    const o: Record<string, unknown> = { ...base };
    delete o[key];
    return o;
  };
  const INVALID: [string, unknown][] = [
    ['v: 2', { ...base, v: 2 }],
    ['v: "1"', { ...base, v: '1' }],
    ['v: 0', { ...base, v: 0 }],
    ['missing v', without('v')],
    ['missing pairingId', without('pairingId')],
    ['missing token', without('token')],
    ['missing port', without('port')],
    ['missing appVersion', without('appVersion')],
    ['missing label', without('label')],
    ['missing pairedAt', without('pairedAt')],
    ['an extra key', { ...base, extra: 1 }],
    ['an extra key holding undefined-like null', { ...base, note: null }],
    ['a 42-character token', { ...base, token: 'a'.repeat(42) }],
    ['a 44-character token', { ...base, token: 'a'.repeat(44) }],
    ['a padded token', { ...base, token: `${'a'.repeat(42)}=` }],
    ['a token with a character outside base64url', { ...base, token: `${'a'.repeat(42)}+` }],
    ['a numeric token', { ...base, token: 1 }],
    ['a 21-character id', { ...base, pairingId: 'a'.repeat(21) }],
    ['a 23-character id', { ...base, pairingId: 'a'.repeat(23) }],
    ['an id with a character outside base64url', { ...base, pairingId: `${'a'.repeat(21)}/` }],
    ['a numeric id', { ...base, pairingId: 1 }],
    ['port 80', { ...base, port: 80 }],
    ['port 1023', { ...base, port: 1023 }],
    ['port 65536', { ...base, port: 65536 }],
    ['port "38917"', { ...base, port: '38917' }],
    ['port 38917.5', { ...base, port: 38917.5 }],
    ['port NaN', { ...base, port: NaN }],
    ['port null', { ...base, port: null }],
    ['a 41-unit label', { ...base, label: 'x'.repeat(41) }],
    ['an empty label', { ...base, label: '' }],
    ['a label with a control character', { ...base, label: 'a\u0001b' }],
    ['a label with a bidi character', { ...base, label: 'a‮b' }],
    ['a numeric label', { ...base, label: 5 }],
    ['an empty appVersion', { ...base, appVersion: '' }],
    ['a 65-unit appVersion', { ...base, appVersion: 'v'.repeat(65) }],
    ['an appVersion with a control character', { ...base, appVersion: '0.1\u0000.0' }],
    ['an appVersion with a bidi character', { ...base, appVersion: '0.1‏.0' }],
    ['a numeric appVersion', { ...base, appVersion: 0.1 }],
    ['pairedAt NaN', { ...base, pairedAt: NaN }],
    ['pairedAt Infinity', { ...base, pairedAt: Infinity }],
    ['pairedAt -Infinity', { ...base, pairedAt: -Infinity }],
    ['a string pairedAt', { ...base, pairedAt: '1700000000000' }],
    ['a null pairedAt', { ...base, pairedAt: null }],
    ['an array', []],
    ['an array holding a valid record', [base]],
    ['a string', 'pairing'],
    ['a number', 5],
    ['null', null],
    ['true', true],
    ['an empty object', {}],
  ];

  it.each(INVALID)('%s', async (_name, value) => {
    const { idb, store } = setup();
    idb.seed(value);
    const r = await store.read();
    await flush();
    expect(r).toEqual({ ok: true, value: null });
    // Deleted, and in the same readwrite transaction as the get.
    expect(idb.peek()).toBeUndefined();
    const t = txs(idb.log);
    expect(t).toHaveLength(1);
    expect(t[0]?.mode).toBe('readwrite');
    const id = t[0]?.tx;
    expect(idb.log.filter((e) => e.op === 'get')).toEqual([{ op: 'get', tx: id, store: 'kv', key: 'pairing' }]);
    expect(idb.log.filter((e) => e.op === 'delete')).toEqual([{ op: 'delete', tx: id, store: 'kv', key: 'pairing' }]);
  });

  it('the delete is committed before read answers (a second read finds nothing)', async () => {
    const { idb, store } = setup();
    idb.seed({ ...base, v: 2 });
    await store.read();
    expect(await store.read()).toEqual({ ok: true, value: null });
  });

  it('a valid record is not deleted by read', async () => {
    const { idb, store } = setup();
    idb.seed(base);
    await store.read();
    expect(idb.log.filter((e) => e.op === 'delete')).toEqual([]);
    expect(idb.peek()).toEqual(base);
  });
});

describe('write resolves only at the transaction oncomplete (R2-5: durability strict)', () => {
  it('is pending after the put request has succeeded, and resolves at the commit', async () => {
    const { idb, store } = setup();
    idb.sw.holdAt = 'write';
    const w = track(store.write(REC));
    await flush();
    expect(idb.log).toContainEqual(expect.objectContaining({ op: 'success', request: 'put' }));
    expect(idb.log.some((e) => e.op === 'complete')).toBe(false);
    expect(w.state).toBe('pending');
    expect(idb.peek()).toBeUndefined();
    idb.releaseHeld();
    await flush();
    expect(w.state).toBe('fulfilled');
    expect(w.value).toMatchObject({ ok: true });
    expect(idb.peek()).toEqual(REC);
  });

  it.each(['write', 'removeIf', 'clear'] as const)('%s opens its transaction with { durability: "strict" } on the store kv', async (op) => {
    const { idb, store } = setup();
    idb.seed(REC);
    await run(store, op);
    const t = txs(idb.log);
    expect(t).toHaveLength(1);
    expect(t[0]?.mode).toBe('readwrite');
    expect(t[0]?.options).toEqual({ durability: 'strict' });
    expect([t[0]?.stores].flat()).toEqual(['kv']);
  });

  it('write puts the value with the key `pairing`, as a copy of the record', async () => {
    const { idb, store } = setup();
    await store.write(REC);
    expect(idb.log.filter((e) => e.op === 'put')).toEqual([expect.objectContaining({ op: 'put', store: 'kv', key: 'pairing', value: REC })]);
  });
});

describe('storage_blocked: the database cannot be opened', () => {
  it.each(OPS)('%s with a factory that is undefined', async (op) => {
    const clock = new FakeClock();
    const store = createStore({ idb: undefined, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    expect(await run(store, op)).toEqual(BLOCKED);
    expect(clock.pending()).toEqual([]);
  });

  it.each(OPS)('%s when open() throws', async (op) => {
    const { idb, store, clock } = setup();
    idb.sw.openThrows = true;
    expect(await run(store, op)).toEqual(BLOCKED);
    expect(clock.pending()).toEqual([]);
  });

  it.each(OPS)('%s when the open request fires onerror', async (op) => {
    const { idb, store, clock } = setup();
    idb.sw.openError = 'UnknownError';
    expect(await run(store, op)).toEqual(BLOCKED);
    expect(clock.pending()).toEqual([]);
    expect(txs(idb.log)).toEqual([]);
  });

  it.each(OPS)('%s when the open request fires onerror with a VersionError', async (op) => {
    const { idb, store } = setup();
    idb.sw.openError = 'VersionError';
    expect(await run(store, op)).toEqual(BLOCKED);
  });

  it.each(OPS)('%s against a newer database version (a downgrade)', async (op) => {
    const { idb, store } = setup();
    idb.backing.dbs.set('fetchly', { version: 2, stores: new Map([['kv', new Map([['pairing', structuredClone(REC)]])]]) });
    expect(await run(store, op)).toEqual(BLOCKED);
    // Nothing was changed in the newer database.
    expect(idb.backing.dbs.get('fetchly')?.version).toBe(2);
    expect(idb.peek()).toEqual(REC);
  });

  it.each(OPS)('%s when the open request fires onblocked: answered at once, without waiting for the deadline', async (op) => {
    const { idb, store, clock } = setup();
    idb.sw.openBlocked = true;
    const t = track(run(store, op));
    await flush();
    expect(t.state).toBe('fulfilled');
    expect(t.value).toEqual(BLOCKED);
    expect(clock.pending()).toEqual([]);
  });

  it.each(OPS)('%s when the open never settles: pending at 2999 ms, storage_blocked at 3000 ms', async (op) => {
    const { idb, store, clock } = setup();
    idb.sw.openHang = true;
    const t = track(run(store, op));
    await flush();
    expect(clock.pending()).toEqual([3000]);
    clock.advance(2999);
    await flush();
    expect(t.state).toBe('pending');
    clock.advance(1);
    await flush();
    expect(t.state).toBe('fulfilled');
    expect(t.value).toEqual(BLOCKED);
  });

  it.each(OPS)('%s: a success that arrives after the deadline is closed and never used', async (op) => {
    const { idb, store, clock } = setup();
    idb.sw.openHang = true;
    const t = track(run(store, op));
    await flush();
    clock.advance(3000);
    await flush();
    expect(t.value).toEqual(BLOCKED);
    idb.settleOpen();
    await flush();
    expect(idb.connections).toHaveLength(1);
    expect(idb.connections.every((c) => c.closed)).toBe(true);
    expect(txs(idb.log)).toEqual([]);
    expect(idb.peek()).toBeUndefined();
  });
});

describe('storage_failed: the transaction did not commit', () => {
  it.each(OPS)('%s when the transaction aborts at commit (quota)', async (op) => {
    const { idb, store, clock } = setup();
    idb.seed(REC);
    idb.sw.abortAt = 'any';
    expect(await run(store, op)).toEqual(FAILED);
    await flush();
    // Nothing was committed, the connection is closed, the deadline timer is gone.
    expect(idb.peek()).toEqual(REC);
    expect(idb.openConnections).toBe(0);
    expect(clock.pending()).toEqual([]);
  });

  it('a quota abort leaves no new record behind', async () => {
    const { idb, store } = setup();
    idb.sw.abortAt = 'write';
    expect(await store.write(REC)).toEqual(FAILED);
    expect(idb.peek()).toBeUndefined();
  });

  it.each(OPS)('%s when transaction() throws', async (op) => {
    const { idb, store, clock } = setup();
    idb.sw.transactionThrows = true;
    expect(await run(store, op)).toEqual(FAILED);
    await flush();
    expect(idb.openConnections).toBe(0);
    expect(clock.pending()).toEqual([]);
  });

  it.each(OPS)('%s when a request fails (the transaction onerror, then the abort)', async (op) => {
    const { idb, store } = setup();
    idb.seed(REC);
    // read and removeIf start with a get, write with a put, clear with a delete.
    idb.sw.requestError = op === 'write' ? 'put' : op === 'clear' ? 'delete' : 'get';
    expect(await run(store, op)).toEqual(FAILED);
    await flush();
    expect(idb.openConnections).toBe(0);
  });

  it.each(OPS)('%s when the transaction never completes: pending at 2999 ms, abort() called and storage_failed at 3000 ms', async (op) => {
    const { idb, store, clock } = setup();
    idb.seed(REC);
    idb.sw.holdAt = 'any';
    const t = track(run(store, op));
    await flush();
    expect(clock.pending()).toEqual([3000]);
    clock.advance(2999);
    await flush();
    expect(t.state).toBe('pending');
    expect(idb.log.some((e) => e.op === 'abort')).toBe(false);
    clock.advance(1);
    await flush();
    expect(t.state).toBe('fulfilled');
    expect(t.value).toEqual(FAILED);
    expect(idb.log.filter((e) => e.op === 'abort')).toEqual([expect.objectContaining({ op: 'abort', by: 'client' })]);
    // A late release commits nothing.
    idb.releaseHeld();
    await flush();
    expect(idb.peek()).toEqual(REC);
    expect(idb.openConnections).toBe(0);
  });

  it('one deadline covers the open and the transaction together: 2000 ms to open leaves 1000 ms', async () => {
    const { idb, store, clock } = setup();
    idb.sw.openHang = true;
    idb.sw.holdAt = 'any';
    const t = track(store.write(REC));
    await flush();
    clock.advance(2000);
    await flush();
    idb.settleOpen();
    await flush();
    expect(t.state).toBe('pending');
    expect(clock.pending()).toEqual([1000]);
    clock.advance(999);
    await flush();
    expect(t.state).toBe('pending');
    clock.advance(1);
    await flush();
    expect(t.value).toEqual(FAILED);
    expect(idb.log.some((e) => e.op === 'abort')).toBe(true);
  });

  it('a transaction that commits after 2999 ms is a success', async () => {
    const { idb, store, clock } = setup();
    idb.sw.holdAt = 'write';
    const t = track(store.write(REC));
    await flush();
    clock.advance(2999);
    idb.releaseHeld();
    await flush();
    expect(t.value).toMatchObject({ ok: true });
    expect(clock.pending()).toEqual([]);
  });
});

describe('onversionchange', () => {
  it('closes the connection (another extension version upgrading the database)', async () => {
    const { idb, store } = setup();
    idb.sw.holdAt = 'any';
    const t = track(store.read());
    await flush();
    expect(idb.connections).toHaveLength(1);
    expect(idb.connections[0]?.closed).toBe(false);
    idb.triggerVersionChange();
    expect(idb.connections[0]?.closed).toBe(true);
    idb.releaseHeld();
    await flush();
    expect(t.state).toBe('fulfilled');
  });
});

describe('removeIf(pairingId) and clear', () => {
  it('removes the record only when the stored pairingId equals the id, in one transaction', async () => {
    const { idb, store } = setup();
    idb.seed(REC);
    expect(await store.removeIf(PAIRING_ID)).toMatchObject({ ok: true });
    expect(idb.peek()).toBeUndefined();
    const t = txs(idb.log);
    expect(t).toHaveLength(1);
    const id = t[0]?.tx;
    expect(idb.log.filter((e) => e.op === 'get')).toEqual([{ op: 'get', tx: id, store: 'kv', key: 'pairing' }]);
    expect(idb.log.filter((e) => e.op === 'delete')).toEqual([{ op: 'delete', tx: id, store: 'kv', key: 'pairing' }]);
  });

  it('leaves a record with another pairingId alone', async () => {
    const { idb, store } = setup();
    idb.seed(REC);
    expect(await store.removeIf(PAIRING_ID_B)).toMatchObject({ ok: true });
    expect(idb.peek()).toEqual(REC);
    expect(await store.read()).toEqual({ ok: true, value: REC });
  });

  it('compares the id exactly: a different case, a prefix and an extension all keep the record', async () => {
    const { idb, store } = setup();
    idb.seed(REC);
    for (const id of [PAIRING_ID.toLowerCase(), PAIRING_ID.slice(0, -1), `${PAIRING_ID}x`, '']) {
      await store.removeIf(id);
      expect(idb.peek(), id).toEqual(REC);
    }
  });

  it('succeeds on an empty store, and writes nothing', async () => {
    const { idb, store } = setup();
    expect(await store.removeIf(PAIRING_ID)).toMatchObject({ ok: true });
    expect(idb.peek()).toBeUndefined();
  });

  it('removes a record that was replaced by a newer one only when the id is the newer one', async () => {
    const { idb, store } = setup();
    await store.write(REC);
    await store.write(makeRecordB());
    await store.removeIf(REC.pairingId);
    expect(idb.peek()).toEqual(makeRecordB());
    await store.removeIf(makeRecordB().pairingId);
    expect(idb.peek()).toBeUndefined();
  });

  it('clear on an empty store succeeds', async () => {
    const { idb, store } = setup();
    expect(await store.clear()).toMatchObject({ ok: true });
    expect(idb.peek()).toBeUndefined();
  });

  it('clear removes the record whatever it is', async () => {
    const { idb, store } = setup();
    idb.seed(REC);
    expect(await store.clear()).toMatchObject({ ok: true });
    expect(idb.peek()).toBeUndefined();
    idb.seed({ garbage: true });
    expect(await store.clear()).toMatchObject({ ok: true });
    expect(idb.peek()).toBeUndefined();
  });
});

describe('what the store logs and returns', () => {
  it('the log shows only the database fetchly, the store kv and the key pairing', async () => {
    const { idb, store } = setup();
    await store.read();
    await store.write(REC);
    await store.removeIf(PAIRING_ID);
    await store.write(REC);
    await store.clear();
    idb.seed({ v: 2 });
    await store.read();
    idb.sw.abortAt = 'any';
    await store.write(REC);
    const names = new Set<unknown>();
    const stores = new Set<unknown>();
    const keys = new Set<unknown>();
    for (const e of idb.log) {
      if (e.op === 'open' || e.op === 'createObjectStore') names.add(e.name);
      if (e.op === 'transaction') for (const s of [e.stores].flat()) stores.add(s);
      if (e.op === 'get' || e.op === 'put' || e.op === 'delete') {
        stores.add(e.store);
        keys.add(e.key);
      }
    }
    expect([...names].sort()).toEqual(['fetchly', 'kv']);
    expect([...stores]).toEqual(['kv']);
    expect([...keys]).toEqual(['pairing']);
  });

  it('a failure carries only its kind: no message, no record, no token', async () => {
    const { idb, store } = setup();
    idb.seed(REC);
    idb.sw.abortAt = 'any';
    const r = await store.write(REC);
    expect(r).toEqual(FAILED);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain(PAIRING_ID);
    idb.sw.abortAt = 'none';
    idb.sw.openError = 'UnknownError';
    const b = await store.read();
    expect(b).toEqual(BLOCKED);
    expect(JSON.stringify(b)).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------------------------
// Amendment 1, AM-1: a transaction that is committing cannot be aborted.

const UNKNOWN = { ok: false, kind: 'storage_unknown' };
/** The operations that can answer storage_unknown. */
const MUTATING = ['write', 'removeIf', 'clear'] as const;
type Mutating = (typeof MUTATING)[number];
const MODES = ['write', 'any'] as const;
const GRACE_CASES = MUTATING.flatMap((op) => MODES.map((mode) => [op, mode] as const));
const isAbortThrow = (e: IdbLogEntry): e is Extract<IdbLogEntry, { op: 'abortThrow' }> => e.op === 'abortThrow';
const isClose = (e: IdbLogEntry): boolean => e.op === 'close';
/** What the backing map holds before the operation and after it has committed. */
const backingBefore = (op: Mutating): Rec | undefined => (op === 'write' ? undefined : REC);
const backingAfter = (op: Mutating): Rec | undefined => (op === 'write' ? REC : undefined);

/** A mutating operation whose transaction gets stuck in the commit. */
function stuck(op: Mutating, mode: (typeof MODES)[number]) {
  const s = setup();
  if (op !== 'write') s.idb.seed(REC);
  s.idb.sw.commitHold = mode;
  const t = track(run(s.store, op));
  return { ...s, t };
}

describe('AM-1: the fake commit phase is honest (fakeIdb.ts)', () => {
  it('commitHold write: the transaction is listed in committing (not held), cannot be aborted or used, and its writes wait for the release', async () => {
    const { idb, store } = setup();
    idb.sw.commitHold = 'write';
    const t = track(store.write(REC));
    await flush();
    expect(idb.committing).toHaveLength(1);
    expect(idb.held).toHaveLength(0);
    const tx = idb.committing[0];
    expect(() => tx?.abort()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(() => tx?.objectStore('kv')).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(idb.log.filter(isAbortThrow)).toEqual([{ op: 'abortThrow', tx: txs(idb.log)[0]?.tx }]);
    expect(idb.log.some((e) => e.op === 'abort')).toBe(false);
    expect(idb.peek()).toBeUndefined();
    expect(t.state).toBe('pending');
    idb.releaseCommitting('complete');
    expect(idb.committing).toHaveLength(0);
    expect(idb.peek()).toEqual(REC);
    await flush();
    expect(t.value).toMatchObject({ ok: true });
  });

  it('commitHold write does not hold a transaction that wrote nothing; commitHold any holds a read too', async () => {
    const a = setup();
    a.idb.seed(REC);
    a.idb.sw.commitHold = 'write';
    expect(await a.store.read()).toEqual({ ok: true, value: REC });
    expect(a.idb.committing).toHaveLength(0);
    const b = setup();
    b.idb.seed(REC);
    b.idb.sw.commitHold = 'any';
    const t = track(b.store.read());
    await flush();
    expect(b.idb.committing).toHaveLength(1);
    expect(t.state).toBe('pending');
  });

  it('releaseCommitting abort discards the writes and fires onabort (by: fake); releaseCommitting complete fires oncomplete', async () => {
    const { idb, store } = setup();
    idb.sw.commitHold = 'write';
    const t = track(store.write(REC));
    await flush();
    idb.releaseCommitting('abort');
    await flush();
    expect(idb.peek()).toBeUndefined();
    expect(idb.log.filter((e) => e.op === 'abort')).toEqual([expect.objectContaining({ op: 'abort', by: 'fake' })]);
    expect(t.value).toEqual(FAILED);
    // A transaction that commits for real still ends with oncomplete.
    idb.sw.commitHold = 'none';
    expect(await store.write(REC)).toMatchObject({ ok: true });
    expect(idb.log.filter((e) => e.op === 'complete')).toHaveLength(1);
  });

  it('holdAt keeps its meaning: stuck before the commit, abort() succeeds, and it is not listed in committing', async () => {
    const { idb, store } = setup();
    idb.sw.holdAt = 'write';
    void store.write(REC);
    await flush();
    expect(idb.held).toHaveLength(1);
    expect(idb.committing).toHaveLength(0);
    expect(() => idb.held[0]?.abort()).not.toThrow();
  });
});

describe('AM-1: abort() refused while committing: a 1000 ms grace for the terminal event, then storage_unknown', () => {
  it.each(GRACE_CASES)('%s under commitHold %s: pending at 2999 ms; at 3000 ms abort() throws and is logged once, the result is still pending, the pending timers are [1000]', async (op, mode) => {
    const { idb, clock, t } = stuck(op, mode);
    await flush();
    expect(idb.committing).toHaveLength(1);
    expect(clock.pending()).toEqual([3000]);
    clock.advance(2999);
    await flush();
    expect(t.state).toBe('pending');
    expect(idb.log.filter(isAbortThrow)).toEqual([]);
    clock.advance(1);
    await flush();
    expect(idb.log.filter(isAbortThrow)).toEqual([{ op: 'abortThrow', tx: txs(idb.log)[0]?.tx }]);
    expect(t.state).toBe('pending');
    expect(clock.pending()).toEqual([1000]);
    expect(idb.log.some((e) => e.op === 'abort')).toBe(false);
    expect(idb.peek()).toEqual(backingBefore(op));
  });

  it.each(GRACE_CASES.flatMap(([op, mode]) => ([3000, 3999] as const).map((at) => [op, mode, at] as const)))(
    '%s under commitHold %s: a complete at %i ms gives ok and the backing changed',
    async (op, mode, at) => {
      const { idb, clock, t } = stuck(op, mode);
      await flush();
      clock.advance(3000);
      await flush();
      clock.advance(at - 3000);
      await flush();
      expect(t.state).toBe('pending');
      idb.releaseCommitting('complete');
      await flush();
      expect(t.state).toBe('fulfilled');
      expect(t.value).toMatchObject({ ok: true });
      expect(idb.peek()).toEqual(backingAfter(op));
      expect(idb.openConnections).toBe(0);
      expect(clock.pending(), 'the grace timer is cleared with the answer').toEqual([]);
    },
  );

  it.each(GRACE_CASES.flatMap(([op, mode]) => ([3000, 3999] as const).map((at) => [op, mode, at] as const)))(
    '%s under commitHold %s: an abort at %i ms gives storage_failed and the backing is unchanged',
    async (op, mode, at) => {
      const { idb, clock, t } = stuck(op, mode);
      await flush();
      clock.advance(3000);
      await flush();
      clock.advance(at - 3000);
      await flush();
      expect(t.state).toBe('pending');
      idb.releaseCommitting('abort');
      await flush();
      expect(t.value).toEqual(FAILED);
      expect(idb.peek()).toEqual(backingBefore(op));
      expect(idb.openConnections).toBe(0);
      expect(clock.pending()).toEqual([]);
    },
  );

  it.each(GRACE_CASES)('%s under commitHold %s: pending at 3999 ms, storage_unknown at 4000 ms, no connection left open', async (op, mode) => {
    const { idb, clock, t } = stuck(op, mode);
    await flush();
    clock.advance(3000);
    await flush();
    clock.advance(999);
    await flush();
    expect(t.state, 'at 3999 ms').toBe('pending');
    clock.advance(1);
    await flush();
    expect(t.state, 'at 4000 ms').toBe('fulfilled');
    expect(t.value).toEqual(UNKNOWN);
    expect(idb.openConnections).toBe(0);
    expect(clock.pending()).toEqual([]);
    // It is unknown, not a rollback: nothing was aborted and nothing was applied.
    expect(idb.log.some((e) => e.op === 'abort')).toBe(false);
    expect(idb.peek()).toEqual(backingBefore(op));
  });

  it.each(GRACE_CASES)('%s under commitHold %s: a late complete after storage_unknown changes the backing, throws nothing and does not change the answer', async (op, mode) => {
    const { idb, clock, t } = stuck(op, mode);
    await flush();
    clock.advance(4000);
    await flush();
    expect(t.value).toEqual(UNKNOWN);
    const closes = idb.log.filter(isClose).length;
    expect(() => idb.releaseCommitting('complete')).not.toThrow();
    await flush();
    expect(idb.peek(), 'the commit did happen after all').toEqual(backingAfter(op));
    expect(t.value).toEqual(UNKNOWN);
    expect(idb.log.filter(isClose), 'the connection is not closed a second time').toHaveLength(closes);
    expect(idb.openConnections).toBe(0);
    expect(clock.pending()).toEqual([]);
  });

  it.each(GRACE_CASES)('%s under commitHold %s: a late abort after storage_unknown changes nothing, throws nothing and does not change the answer', async (op, mode) => {
    const { idb, clock, t } = stuck(op, mode);
    await flush();
    clock.advance(4000);
    await flush();
    const closes = idb.log.filter(isClose).length;
    expect(() => idb.releaseCommitting('abort')).not.toThrow();
    await flush();
    expect(idb.peek()).toEqual(backingBefore(op));
    expect(t.value).toEqual(UNKNOWN);
    expect(idb.log.filter(isClose)).toHaveLength(closes);
  });

  it('storage_unknown carries only its kind: no message, no record, no token', async () => {
    const { idb, clock, t } = stuck('write', 'write');
    await flush();
    clock.advance(4000);
    await flush();
    expect(t.value).toStrictEqual(UNKNOWN);
    expect(JSON.stringify(t.value)).not.toContain(TOKEN);
    expect(JSON.stringify(t.value)).not.toContain(PAIRING_ID);
    expect(idb.log.length).toBeGreaterThan(0);
  });

  it('one deadline covers the open, the commit and the grace: 2000 ms to open, abort() throws at 3000 ms, storage_unknown at 4000 ms', async () => {
    const { idb, store, clock } = setup();
    idb.sw.openHang = true;
    idb.sw.commitHold = 'write';
    const t = track(store.write(REC));
    await flush();
    clock.advance(2000);
    await flush();
    idb.settleOpen();
    await flush();
    expect(idb.committing).toHaveLength(1);
    expect(clock.pending()).toEqual([1000]);
    clock.advance(999);
    await flush();
    expect(idb.log.filter(isAbortThrow)).toEqual([]);
    clock.advance(1);
    await flush();
    expect(idb.log.filter(isAbortThrow)).toHaveLength(1);
    expect(t.state).toBe('pending');
    expect(clock.pending()).toEqual([1000]);
    clock.advance(999);
    await flush();
    expect(t.state).toBe('pending');
    clock.advance(1);
    await flush();
    expect(t.value).toEqual(UNKNOWN);
  });

  it('a stuck commit is not a stuck open: before the open settles the deadline still answers storage_blocked, with no abort() call and no grace', async () => {
    const { idb, store, clock } = setup();
    idb.sw.openHang = true;
    idb.sw.commitHold = 'any';
    const t = track(store.write(REC));
    await flush();
    clock.advance(3000);
    await flush();
    expect(t.value).toEqual(BLOCKED);
    expect(idb.log.filter(isAbortThrow)).toEqual([]);
    expect(clock.pending()).toEqual([]);
  });
});

describe('AM-1: read never answers storage_unknown', () => {
  const stuckRead = () => {
    const s = setup();
    s.idb.seed(REC);
    s.idb.sw.commitHold = 'any';
    const t = track(s.store.read());
    return { ...s, t };
  };

  it('under commitHold any: pending at 3999 ms, storage_failed at 4000 ms, no connection left open', async () => {
    const { idb, clock, t } = stuckRead();
    await flush();
    expect(idb.committing).toHaveLength(1);
    clock.advance(3000);
    await flush();
    expect(idb.log.filter(isAbortThrow)).toHaveLength(1);
    expect(clock.pending()).toEqual([1000]);
    clock.advance(999);
    await flush();
    expect(t.state, 'at 3999 ms').toBe('pending');
    clock.advance(1);
    await flush();
    expect(t.value, 'at 4000 ms').toEqual(FAILED);
    expect(idb.openConnections).toBe(0);
    expect(clock.pending()).toEqual([]);
  });

  it('a complete inside the grace gives ok with the record that was read; an abort inside the grace gives storage_failed', async () => {
    const a = stuckRead();
    await flush();
    a.clock.advance(3500);
    await flush();
    expect(a.t.state).toBe('pending');
    a.idb.releaseCommitting('complete');
    await flush();
    expect(a.t.value).toEqual({ ok: true, value: REC });
    const b = stuckRead();
    await flush();
    b.clock.advance(3500);
    await flush();
    b.idb.releaseCommitting('abort');
    await flush();
    expect(b.t.value).toEqual(FAILED);
  });

  it('a late complete after storage_failed throws nothing and does not change the answer', async () => {
    const { idb, clock, t } = stuckRead();
    await flush();
    clock.advance(4000);
    await flush();
    expect(() => idb.releaseCommitting('complete')).not.toThrow();
    await flush();
    expect(t.value).toEqual(FAILED);
    expect(idb.openConnections).toBe(0);
  });
});

describe('AM-1: storage_failed is a confirmed rollback; tx.onerror alone answers nothing', () => {
  it.each(OPS)('%s: a transaction onerror with no onabort after it answers nothing; abort() at the 3000 ms deadline then gives storage_failed', async (op) => {
    const { idb, store, clock } = setup();
    idb.seed(REC);
    idb.sw.holdAt = 'any';
    const t = track(run(store, op));
    await flush();
    const tx = idb.held[0];
    expect(tx).toBeDefined();
    (tx?.onerror as ((ev: unknown) => unknown) | null | undefined)?.({ type: 'error' });
    await flush();
    expect(t.state, 'right after the onerror').toBe('pending');
    expect(idb.log.some((e) => e.op === 'abort')).toBe(false);
    clock.advance(2999);
    await flush();
    expect(t.state, 'at 2999 ms').toBe('pending');
    clock.advance(1);
    await flush();
    expect(t.value).toEqual(FAILED);
    expect(idb.log.filter((e) => e.op === 'abort')).toEqual([expect.objectContaining({ op: 'abort', by: 'client' })]);
    expect(idb.openConnections).toBe(0);
  });

  it.each(OPS)('%s: an onerror followed by the onabort that a real failure brings answers storage_failed at once', async (op) => {
    const { idb, store } = setup();
    idb.seed(REC);
    idb.sw.requestError = op === 'write' ? 'put' : op === 'clear' ? 'delete' : 'get';
    const t = track(run(store, op));
    await flush();
    expect(t.value).toEqual(FAILED);
  });

  it.each(OPS)('%s: an abort() that returns without throwing at the deadline is a confirmed rollback: storage_failed at once, no grace', async (op) => {
    const { idb, store, clock } = setup();
    idb.seed(REC);
    idb.sw.holdAt = 'any';
    const t = track(run(store, op));
    await flush();
    clock.advance(3000);
    await flush();
    expect(t.value).toEqual(FAILED);
    expect(clock.pending()).toEqual([]);
    expect(idb.log.filter(isAbortThrow)).toEqual([]);
  });
});

/**
 * Rule 4 of AM-1: when `work` throws and the abort() that follows throws as well, the same grace applies. The real
 * fake cannot make `work` throw while the transaction is committing, so this is a minimal hand-made factory: the
 * transaction's requests throw, and its abort() throws or not; the spec delivers the terminal events itself.
 * Amendment 2 (AM2-3 rule 1): an `oncomplete` in this situation is no longer `ok`. `work` threw before it returned its getter, so
 * it queued nothing (each work makes one synchronous request call, and that call is the one that threw): a confirmed no-mutation,
 * `storage_failed`, for write, removeIf and clear as for read. The no-event case is unchanged: `storage_unknown` (rule 4).
 */
describe('AM-1: work throws and abort() throws too: the same grace, not a rollback', () => {
  type Ev = ((ev: unknown) => unknown) | null;
  function throwingIdb(abortThrows: boolean, deferOpen = false) {
    /** `kv` lists each request method the store called, in order (AM2-3: every one of them throws, so none queued a request). */
    const calls: { abort: number; close: number; kv: string[] } = { abort: 0, close: 0, kv: [] };
    /** With `deferOpen`, the open succeeds only when the spec calls `deliverOpen()` (so the refused abort() is not at 0 ms). */
    let pendingOpen: (() => void) | null = null;
    const tx: { oncomplete: Ev; onabort: Ev; onerror: Ev; objectStore(): unknown; abort(): void } = {
      oncomplete: null,
      onabort: null,
      onerror: null,
      objectStore: () => kv,
      abort: () => {
        calls.abort += 1;
        if (abortThrows) throw new DOMException('the transaction is committing', 'InvalidStateError');
      },
    };
    const inactive =
      (method: string) =>
      (): never => {
        calls.kv.push(method);
        throw new DOMException('the transaction is not active', 'TransactionInactiveError');
      };
    const kv = { get: inactive('get'), put: inactive('put'), delete: inactive('delete') };
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => ({}),
      transaction: () => tx,
      close: () => {
        calls.close += 1;
      },
      onversionchange: null as Ev,
    };
    const factory = {
      open: () => {
        const req = { result: db, onsuccess: null as Ev, onerror: null as Ev, onblocked: null as Ev, onupgradeneeded: null as Ev };
        pendingOpen = () => req.onsuccess?.({ type: 'success' });
        if (!deferOpen) queueMicrotask(pendingOpen);
        return req;
      },
    };
    return { factory: factory as unknown as NonNullable<Parameters<typeof createStore>[0]['idb']>, tx, calls, deliverOpen: () => pendingOpen?.() };
  }
  const make = (abortThrows: boolean, deferOpen = false) => {
    const clock = new FakeClock();
    const s = throwingIdb(abortThrows, deferOpen);
    const store = createStore({ idb: s.factory, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    return { clock, store, ...s };
  };

  it.each(OPS)('%s: abort() returns: storage_failed at once (a confirmed rollback)', async (op) => {
    const { store, calls, clock } = make(false);
    expect(await run(store, op)).toEqual(FAILED);
    expect(calls.abort).toBeGreaterThanOrEqual(1);
    expect(calls.close).toBe(1);
    expect(clock.pending()).toEqual([]);
  });

  it.each(OPS)('%s: abort() throws: nothing is answered at once, and an onabort inside the grace gives storage_failed', async (op) => {
    const { store, tx, calls, clock } = make(true);
    const t = track(run(store, op));
    await flush();
    expect(calls.abort).toBeGreaterThanOrEqual(1);
    expect(t.state, 'a thrown abort() is not a rollback').toBe('pending');
    clock.advance(500);
    await flush();
    expect(t.state).toBe('pending');
    expect(clock.pending(), 'half of the 1000 ms grace is left, and no 3000 ms deadline').toEqual([500]);
    tx.onabort?.({ type: 'abort' });
    await flush();
    expect(t.value).toEqual(FAILED);
    expect(calls.close).toBe(1);
    expect(clock.pending(), 'the answer clears the grace').toEqual([]);
  });

  it.each(MUTATING)('%s: abort() throws: an oncomplete inside the grace gives storage_failed (AM2-3: work threw, so nothing was queued; it was ok before amendment 2)', async (op) => {
    const { store, tx, calls, clock } = make(true);
    const t = track(run(store, op));
    await flush();
    expect(t.state).toBe('pending');
    clock.advance(500);
    await flush();
    expect(clock.pending(), 'half of the 1000 ms grace is left, and no 3000 ms deadline').toEqual([500]);
    tx.oncomplete?.({ type: 'complete' });
    await flush();
    expect(t.value).toEqual(FAILED);
    expect(calls.close).toBe(1);
    expect(clock.pending(), 'the answer clears the grace').toEqual([]);
  });

  it.each(OPS)('%s: abort() throws: an onabort at 999 ms after the refused abort (the last ms of the grace) still gives storage_failed', async (op) => {
    const { store, tx, calls, clock } = make(true);
    const t = track(run(store, op));
    await flush();
    clock.advance(999);
    await flush();
    expect(t.state, 'at 999 ms').toBe('pending');
    tx.onabort?.({ type: 'abort' });
    await flush();
    expect(t.value).toEqual(FAILED);
    expect(calls.close).toBe(1);
    expect(clock.pending()).toEqual([]);
  });

  it.each(MUTATING)('%s: abort() throws: an oncomplete at 999 ms after the refused abort (the last ms of the grace) still gives storage_failed (AM2-3)', async (op) => {
    const { store, tx, calls, clock } = make(true);
    const t = track(run(store, op));
    await flush();
    clock.advance(999);
    await flush();
    expect(t.state, 'at 999 ms').toBe('pending');
    tx.oncomplete?.({ type: 'complete' });
    await flush();
    expect(t.value).toEqual(FAILED);
    expect(calls.close).toBe(1);
    expect(clock.pending()).toEqual([]);
  });

  // AM2-3 rule 1, the three mutations and the control. The answer does not depend on when inside the grace the oncomplete comes, and a
  // storage_failed here carries only its kind (no message, no record, no token).
  it.each(MUTATING)('AM2-3 %s: an oncomplete at 0, 1, 500 and 999 ms after the refused abort gives storage_failed, never ok and never storage_unknown', async (op) => {
    for (const at of [0, 1, 500, 999]) {
      const { store, tx, calls, clock } = make(true);
      const t = track(run(store, op));
      await flush();
      if (at > 0) {
        clock.advance(at);
        await flush();
      }
      expect(t.state, `at ${at} ms`).toBe('pending');
      tx.oncomplete?.({ type: 'complete' });
      await flush();
      expect(t.value, `at ${at} ms`).toStrictEqual(FAILED);
      expect(JSON.stringify(t.value)).not.toContain(TOKEN);
      expect(calls.close, `at ${at} ms`).toBe(1);
      expect(clock.pending(), `at ${at} ms`).toEqual([]);
    }
  });

  // Rule 2 gives the reason: a synchronous throw queued nothing, because each work's one synchronous request call is the call that threw
  // (write: its put; removeIf: its get, the delete being issued later inside onsuccess; clear: its delete; read: its get). Rule 3: this
  // holds only while each work makes one synchronous request call and nothing can throw after it.
  it.each([
    ['read', ['get']],
    ['write', ['put']],
    ['removeIf', ['get']],
    ['clear', ['delete']],
  ] as [Op, string[]][])('AM2-3 %s: before the throw exactly one request call was made on kv (%j), and it threw, so no request was queued', async (op, methods) => {
    const { store, tx, calls, clock } = make(true);
    const t = track(run(store, op));
    await flush();
    expect(calls.kv, 'one call, the one that threw').toEqual(methods);
    expect(t.state).toBe('pending');
    tx.oncomplete?.({ type: 'complete' });
    await flush();
    expect(t.value).toEqual(FAILED);
    expect(calls.kv, 'nothing was called after the oncomplete').toEqual(methods);
    expect(clock.pending()).toEqual([]);
  });

  // The control that stays: read answered storage_failed before amendment 2 and still does (its completedWithoutValue was FAILED).
  it('AM2-3 read control: an oncomplete inside the grace (at 0, 500 and 999 ms) still answers storage_failed', async () => {
    for (const at of [0, 500, 999]) {
      const { store, tx, calls, clock } = make(true);
      const t = track(run(store, 'read'));
      await flush();
      if (at > 0) {
        clock.advance(at);
        await flush();
      }
      expect(t.state, `at ${at} ms`).toBe('pending');
      tx.oncomplete?.({ type: 'complete' });
      await flush();
      expect(t.value, `at ${at} ms`).toStrictEqual(FAILED);
      expect(calls.close).toBe(1);
      expect(clock.pending()).toEqual([]);
    }
  });

  // AM2-3 rule 4, unchanged and deliberate: with no terminal event inside the grace the answer stays storage_unknown for a mutation, and
  // an oncomplete that comes only after it changes nothing. Only the oncomplete INSIDE the grace is a confirmed no-mutation.
  it.each(MUTATING)('AM2-3 %s: the oncomplete at exactly 1000 ms after the refused abort comes after the grace: the answer is storage_unknown, and it stays', async (op) => {
    const { store, tx, clock } = make(true);
    const t = track(run(store, op));
    await flush();
    clock.advance(1000);
    await flush();
    expect(t.value).toEqual(UNKNOWN);
    tx.oncomplete?.({ type: 'complete' });
    await flush();
    expect(t.value, 'a late oncomplete does not turn it into storage_failed').toEqual(UNKNOWN);
  });

  // abort() returned: a confirmed rollback at once (unchanged); a later oncomplete changes nothing.
  it.each(OPS)('AM2-3 %s: abort() returns: storage_failed at once, and an oncomplete after it changes nothing', async (op) => {
    const { store, tx } = make(false);
    const t = track(run(store, op));
    await flush();
    expect(t.value).toEqual(FAILED);
    tx.oncomplete?.({ type: 'complete' });
    await flush();
    expect(t.value).toEqual(FAILED);
  });

  /**
   * Rule 4, no terminal event (the accepted reading, AM-1): the grace is COMMIT_GRACE_MS = 1000 ms counted from the refused abort() that
   * follows the throw in `work`. It replaces the 3000 ms deadline, which is cleared; it does not wait for it. Here the refused abort() is
   * at 0 ms, so the answer is due at exactly 1000 ms.
   */
  async function noTerminalEvent(op: Op, expected: unknown): Promise<void> {
    const { store, tx, calls, clock } = make(true);
    const t = track(run(store, op));
    await flush();
    expect(clock.pending(), 'only the 1000 ms grace is armed: the 3000 ms deadline is no longer pending').toEqual([1000]);
    const aborts = calls.abort;
    clock.advance(999);
    await flush();
    expect(t.state, 'at 999 ms after the refused abort').toBe('pending');
    expect(calls.close, 'not closed before the answer').toBe(0);
    clock.advance(1);
    await flush();
    expect(t.value, 'at exactly 1000 ms after the refused abort').toEqual(expected);
    expect(calls.close).toBe(1);
    expect(clock.pending(), 'nothing is armed after the answer').toEqual([]);
    // A terminal event after the 1000 ms changes nothing and throws nothing.
    clock.advance(1);
    await flush();
    expect(() => tx.oncomplete?.({ type: 'complete' })).not.toThrow();
    expect(() => tx.onabort?.({ type: 'abort' })).not.toThrow();
    await flush();
    expect(t.value, 'after a late event').toEqual(expected);
    expect(calls.close, 'not closed a second time').toBe(1);
    // The original deadline (3000 ms) and what would follow it (4000 ms) pass: nothing runs, abort() is not called again.
    clock.advance(3999);
    await flush();
    expect(t.value, 'after the original deadline and its would-be grace').toEqual(expected);
    expect(calls.abort, 'the deadline is not pending, so abort() is not called a second time').toBe(aborts);
    expect(calls.close).toBe(1);
  }

  it.each(MUTATING)('%s: abort() throws and no terminal event comes: pending at 999 ms after the refused abort, storage_unknown at exactly 1000 ms, no wait for the 3000 ms deadline, and a late event changes nothing', async (op) => {
    await noTerminalEvent(op, UNKNOWN);
  });

  it('read: abort() throws and no terminal event comes: pending at 999 ms after the refused abort, storage_failed at exactly 1000 ms (read never answers storage_unknown), and a late event changes nothing', async () => {
    await noTerminalEvent('read', FAILED);
  });

  it.each(OPS)('%s: the grace is counted from the refused abort(), not from the start: the open arrives at 700 ms, still pending at 1699 ms, answered at 1700 ms', async (op) => {
    const { store, clock, deliverOpen } = make(true, true);
    const t = track(run(store, op));
    await flush();
    expect(clock.pending(), 'before the open: the 3000 ms deadline only').toEqual([3000]);
    clock.advance(700);
    await flush();
    expect(t.state).toBe('pending');
    deliverOpen();
    await flush();
    expect(clock.pending(), 'the refused abort() is at 700 ms: the grace replaces the deadline, a full 1000 ms').toEqual([1000]);
    clock.advance(999);
    await flush();
    expect(t.state, 'at 1699 ms').toBe('pending');
    clock.advance(1);
    await flush();
    expect(t.value, 'at 1700 ms').toEqual(op === 'read' ? FAILED : UNKNOWN);
  });
});

/**
 * AM2-3, the control on the real fake. The rule that changed is about an oncomplete AFTER `work` threw. When `work` finished (it queued
 * its request and returned its getter) an oncomplete is still `ok`, whether the commit was stuck or not, and the backing map changed.
 * So the two cases differ by what `work` did, not by the event: the hand-made factory above (a throw: storage_failed) and this one.
 */
describe('AM2-3: control on the real fake: a commit stuck in commitHold and then completed is still ok, the backing changed', () => {
  const requests = (log: IdbLogEntry[]): number => log.filter((e) => e.op === 'put' || e.op === 'delete').length;

  it.each(GRACE_CASES)('%s under commitHold %s: releaseCommitting(complete) before any deadline gives ok, the work queued its request, the backing changed', async (op, mode) => {
    const { idb, clock, t } = stuck(op, mode);
    await flush();
    expect(idb.committing).toHaveLength(1);
    expect(requests(idb.log), 'the work queued its request before the commit').toBeGreaterThanOrEqual(1);
    idb.releaseCommitting('complete');
    await flush();
    expect(t.state).toBe('fulfilled');
    expect(t.value).toEqual({ ok: true, value: null });
    expect(idb.peek()).toEqual(backingAfter(op));
    expect(idb.openConnections).toBe(0);
    expect(clock.pending()).toEqual([]);
  });

  it.each(GRACE_CASES)('%s under commitHold %s: releaseCommitting(complete) inside the grace (at 3500 ms) gives ok, never storage_failed', async (op, mode) => {
    const { idb, clock, t } = stuck(op, mode);
    await flush();
    clock.advance(3500);
    await flush();
    expect(idb.log.filter(isAbortThrow)).toHaveLength(1);
    expect(t.state).toBe('pending');
    idb.releaseCommitting('complete');
    await flush();
    expect(t.value).toEqual({ ok: true, value: null });
    expect(idb.peek()).toEqual(backingAfter(op));
    expect(requests(idb.log)).toBeGreaterThanOrEqual(1);
    expect(clock.pending()).toEqual([]);
  });

  it('a read under commitHold any, completed: ok with the record (a read never answered storage_unknown, and its oncomplete after a real get is ok)', async () => {
    const { idb, store, clock } = setup();
    idb.seed(REC);
    idb.sw.commitHold = 'any';
    const t = track(store.read());
    await flush();
    clock.advance(3500);
    await flush();
    idb.releaseCommitting('complete');
    await flush();
    expect(t.value).toEqual({ ok: true, value: REC });
  });
});
