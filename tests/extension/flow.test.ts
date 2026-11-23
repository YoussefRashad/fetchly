/**
 * Task 6, restart and flow (plan section 3 "Tests, restart", section 7 "Edge cases"): the real store, client and handlers over
 * the fakes, with the disk (the fake IndexedDB backing map) outliving the worker.
 *
 * Enumerations:
 *  - What a restart keeps: the disk (the record). What it loses: everything in memory (the E13 old record, the pair mutex, the store connection).
 *  - Section 7 rows tested here: worker killed between the /v1/pair answer and the write; popup closed mid-pair; extension folder moved
 *    (new id, empty database); a newer database version (a downgrade); a connection closed by onversionchange; two popups.
 *  - Popup model against the real worker: open, submit (pair then the automatic status), unpair, an undelivered reply (interrupted at 30 s),
 *    and (amendment 2, AM2-1) a double submit: the gate answers operationRunning, the model sends no status, Check again gives connected.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { until } from './clock';
import { err } from './fakeFetch';
import { PAIRING_ID, PORT, PORT_B, TOKEN, makeRecord, makeRecordB, type Reply } from './fixtures';
import { newBacking } from './fakeIdb';
import { World, assertWorldClean, makeWorld, pairMsg, statusMsg, unpairMsg } from './world';
import { createPopupModel, type ModelState } from '../../extension/src/lib/popupModel';

const worlds: World[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) assertWorldClean(w);
});
const track1 = (w: World): World => {
  worlds.push(w);
  return w;
};
const mk = (): World => track1(makeWorld());
const REC = makeRecord();

/** A world with a code open on PORT. */
const pairWorld = (): World => {
  const w = mk();
  w.server().openCode('ABCDEFGH');
  w.server().issue = { token: TOKEN, pairingId: PAIRING_ID };
  return w;
};

describe('a worker restart (the disk outlives the worker)', () => {
  it('a new handler set over the same fake IDB answers connected', async () => {
    const first = mk();
    first.install(REC);
    expect(await first.send(statusMsg)).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    const second = track1(first.restart());
    expect(second.chrome).not.toBe(first.chrome);
    expect(second.store).not.toBe(first.store);
    expect(await second.send(statusMsg)).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    // The second worker did its own hello and request, with the stored token.
    const tail = second.net.log.slice(-2);
    expect(tail.map((r) => r.path)).toEqual(['/v1/hello', '/v1/status']);
    expect(tail[1]?.authorization).toBe(`Bearer ${REC.token}`);
  });

  it('a restart also keeps the record when the first worker never ran a message', async () => {
    const first = mk();
    first.install(REC);
    const second = track1(first.restart());
    expect(await second.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
  });

  it('the old worker\'s handlers are not what answers: each handler set answers its own messages', async () => {
    const first = mk();
    first.install(REC);
    const second = track1(first.restart());
    expect(first.chrome.runtime.onMessage.count).toBe(1);
    expect(second.chrome.runtime.onMessage.count).toBe(1);
    await second.send(statusMsg);
    expect(first.replies).toEqual([]);
    expect(second.replies).toHaveLength(1);
  });

  it('the E13 old record is in memory only: after a restart nothing is ever sent to the record a pairing replaced', async () => {
    const first = mk();
    first.install(makeRecordB());
    const s = first.server();
    s.openCode('ABCDEFGH');
    s.issue = { token: TOKEN, pairingId: PAIRING_ID };
    expect(await first.send(pairMsg())).toEqual({ state: 'checking', paired: true });
    const second = track1(first.restart());
    expect(await second.send(statusMsg)).toMatchObject({ state: 'connected' });
    await second.idle();
    expect(second.net.to(PORT_B)).toEqual([]);
    expect(second.server(PORT_B).pairings.has(makeRecordB().pairingId)).toBe(true);
  });

  it('the pair mutex is per worker: a held pair of a dead worker blocks nothing in the new one', async () => {
    const first = pairWorld();
    first.idb.sw.holdAt = 'write';
    void first.dispatch(pairMsg());
    await until(() => first.idb.held.length === 1);
    const second = track1(first.restart());
    second.server().openCode('ABCDEFGH');
    second.server().issue = { token: TOKEN, pairingId: PAIRING_ID };
    expect(await second.send(pairMsg())).toEqual({ state: 'checking', paired: true });
    expect(second.idb.peek()).toMatchObject({ pairingId: PAIRING_ID });
  });
});

describe('the popup closed mid-pair, or its reply never arrives', () => {
  it('a pair whose reply is never delivered still leaves the record stored', async () => {
    const w = pairWorld();
    const d = w.dispatch(pairMsg(`${PORT}-ABCDEFGH`, 'My PC'), { deliver: false });
    expect(d.returned).toBe(true);
    await until(() => d.sent.length === 1);
    // The worker finished the whole job: the record is on disk, committed.
    expect(w.idb.peek()).toEqual({ v: 1, pairingId: PAIRING_ID, token: TOKEN, port: PORT, appVersion: '0.1.0', label: 'My PC', pairedAt: expect.any(Number) });
    expect(d.sent).toEqual([{ state: 'checking', paired: true }]);
    // A restart and a new popup see the pairing.
    const second = track1(w.restart());
    expect(await second.send(statusMsg)).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
  });

  it('a pair whose popup closed before the answer arrived (the reply is sent later) still stores the record', async () => {
    const w = pairWorld();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    w.server().once('/v1/pair', async () => {
      await gate;
      return 'default' as const;
    });
    const d = w.dispatch(pairMsg(), { deliver: false });
    await until(() => w.server().requests('/v1/pair').length === 1);
    release();
    await until(() => w.idb.peek() !== undefined);
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID });
    await until(() => d.sent.length === 1);
  });
});

describe('the worker was killed between the /v1/pair answer and the write', () => {
  it('the pair 200 arrives and the write never completes; a new handler set over the same IDB answers notPaired without throwing', async () => {
    const first = pairWorld();
    first.idb.sw.holdAt = 'write';
    const d = first.dispatch(pairMsg(), { deliver: false });
    await until(() => first.idb.held.length === 1);
    expect(first.server().pairings.has(PAIRING_ID)).toBe(true);
    // The worker is gone: nothing commits, nothing replies.
    expect(d.sent).toEqual([]);
    const second = track1(first.restart());
    const reply = await second.send(statusMsg);
    expect(reply).toEqual({ state: 'notPaired', paired: false });
    // The app keeps a stale entry (section 7), and the new worker sent nothing to it: there is no record to use.
    expect(second.net.log.filter((r) => r.path !== '/v1/pair')).toEqual([]);
    expect(second.server().pairings.has(PAIRING_ID)).toBe(true);
    expect(second.idb.peek()).toBeUndefined();
  });

  it('and the new worker can pair again over the same disk', async () => {
    const first = pairWorld();
    first.idb.sw.holdAt = 'write';
    void first.dispatch(pairMsg(), { deliver: false });
    await until(() => first.idb.held.length === 1);
    const second = track1(first.restart());
    second.server().openCode('ABCDEFGH');
    second.server().issue = { token: `TOKENMARKER_2`.padEnd(43, 'x'), pairingId: `PAIRIDMARKER_2`.padEnd(22, 'y') };
    expect(await second.send(pairMsg())).toEqual({ state: 'checking', paired: true });
    expect(await second.send(statusMsg)).toMatchObject({ state: 'connected', paired: true });
  });
});

describe('the extension folder was moved (a new id and an empty database)', () => {
  it('answers notPaired, paired false, with nothing fetched, although the app still lists the pairing', async () => {
    const first = mk();
    first.install(REC);
    expect(await first.send(statusMsg)).toMatchObject({ state: 'connected' });
    const fetched = first.net.log.length;
    const moved = track1(new World({ ...first.shared, backing: newBacking() }, { extensionId: 'q'.repeat(32) }));
    expect(moved.chrome.runtime.id).toBe('q'.repeat(32));
    expect(await moved.send(statusMsg)).toEqual({ state: 'notPaired', paired: false });
    expect(moved.net.log).toHaveLength(fetched);
    expect(moved.server().pairings.has(REC.pairingId)).toBe(true);
    // The old record is still on the old disk: nothing was removed.
    expect(first.idb.peek()).toEqual(REC);
  });

  it('a message from the old extension id is refused by the new worker', async () => {
    const first = mk();
    first.install(REC);
    const moved = track1(new World({ ...first.shared, backing: newBacking() }, { extensionId: 'q'.repeat(32) }));
    const d = moved.chrome.runtime.onMessage.dispatch(statusMsg, { id: first.chrome.runtime.id, url: first.chrome.runtime.getURL('popup.html') });
    expect(d.returned).toBe(false);
    expect(await d.reply).toBeUndefined();
  });
});

describe('the database', () => {
  it('a newer database version (a downgrade): storageBlocked, paired false, nothing sent; the data is not touched', async () => {
    const w = mk();
    w.install(REC);
    const data = w.idb.backing.dbs.get('fetchly');
    if (!data) throw new Error('the spec seeded no database');
    data.version = 2;
    for (const msg of [statusMsg, unpairMsg, pairMsg()]) expect(await w.send(msg)).toEqual({ state: 'storageBlocked', paired: false });
    expect(w.net.log).toEqual([]);
    expect(w.idb.peek()).toEqual(REC);
    expect(data.version).toBe(2);
  });

  it('a record of an odd shape is removed in the same transaction as it is read, and then reads as none', async () => {
    const w = mk();
    for (const odd of [{ ...REC, v: 2 }, { ...REC, extra: 1 }, 'not a record', 42, null, [REC], { ...REC, port: 80 }, { ...REC, token: 'short' }]) {
      w.idb.seed(odd);
      expect(await w.send(statusMsg), JSON.stringify(odd)).toEqual({ state: 'notPaired', paired: false });
      expect(w.idb.peek(), JSON.stringify(odd)).toBeUndefined();
    }
    expect(w.net.log).toEqual([]);
  });

  it('onversionchange closes the connection, and the next message opens a new one', async () => {
    const w = mk();
    w.install(REC);
    await w.send(statusMsg);
    w.idb.triggerVersionChange();
    expect(w.idb.openConnections).toBe(0);
    expect(await w.send(statusMsg)).toMatchObject({ state: 'connected' });
    expect(w.idb.openConnections).toBe(0);
  });

  it('every operation opens and closes its own connection: none stays open between messages', async () => {
    const w = pairWorld();
    await w.send(statusMsg);
    expect(w.idb.openConnections).toBe(0);
    await w.send(pairMsg());
    expect(w.idb.openConnections).toBe(0);
    await w.send(statusMsg);
    await w.send(unpairMsg);
    expect(w.idb.openConnections).toBe(0);
  });
});

describe('two popups', () => {
  it('two status messages at once both answer, with one hello each', async () => {
    const w = mk();
    w.install(REC);
    const [a, b] = await Promise.all([w.send(statusMsg), w.send(statusMsg)]);
    expect(a).toMatchObject({ state: 'connected' });
    expect(b).toMatchObject({ state: 'connected' });
    expect(w.net.log.filter((r) => r.path === '/v1/hello')).toHaveLength(2);
    const nonces = w.net.log.filter((r) => r.path === '/v1/hello').map((r) => (r.bodyJson as { nonce: string }).nonce);
    expect(new Set(nonces).size).toBe(2);
  });

  it('a status and an unpair at once end with the record removed and both answered', async () => {
    const w = mk();
    w.install(REC);
    const [a, b] = await Promise.all([w.send(statusMsg), w.send(unpairMsg)]);
    expect(b).toMatchObject({ state: 'notPaired', paired: false });
    // Amendment 1 (AM-2): the status may also end `checking` (row 3: the unpair bumped `gen` while the status was in flight, and the record
    // was not yet gone at its final read). Before the amendment only `connected` and `notPaired` were possible.
    expect(['connected', 'notPaired', 'checking']).toContain((a as Reply).state);
    expect(w.idb.peek()).toBeUndefined();
  });
});

describe('the popup model against the real worker', () => {
  function rig(w: World, opts: { deliver?: boolean } = {}) {
    const changes: ModelState[] = [];
    const model = createPopupModel({
      send: (msg) => (opts.deliver === false ? w.dispatch(msg, { deliver: false }).reply : w.send(msg)),
      setTimer: w.clock.setTimer,
      clearTimer: w.clock.clearTimer,
      onChange: (s) => {
        changes.push(structuredClone(s));
      },
    });
    return { model, changes };
  }

  it('opening with a record: checking, then connected with Unpair available (paired true)', async () => {
    const w = mk();
    w.install(REC);
    const { model, changes } = rig(w);
    model.open();
    expect(model.state().reply.state).toBe('checking');
    await until(() => model.state().reply.state === 'connected');
    expect(model.state().reply).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    expect(changes.at(0)?.reply.state).toBe('checking');
    expect(changes.at(-1)).toEqual(model.state());
  });

  it('opening with no record: checking, then notPaired with paired false (the form, no Unpair)', async () => {
    const w = mk();
    const { model } = rig(w);
    model.open();
    await until(() => model.state().reply.state === 'notPaired');
    expect(model.state().reply).toEqual({ state: 'notPaired', paired: false });
  });

  it('submitting a pairing string: the worker answers checking, the model then asks for the status and ends connected', async () => {
    const w = pairWorld();
    const { model, changes } = rig(w);
    model.open();
    await until(() => model.state().reply.state === 'notPaired');
    model.submit(`${PORT}-ABCDEFGH`, 'My PC');
    await until(() => model.state().reply.state === 'connected');
    expect(model.state().reply).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    // The worker saw: status (none), pair, then the popup's status request; the reply to pair came before any other request.
    const paths = w.net.log.map((r) => r.path);
    expect(paths).toEqual(['/v1/pair', '/v1/hello', '/v1/status']);
    // Three requests: status, pair, status. The sequence number grew with each.
    expect(model.state().seq).toBe(3);
    expect(changes.map((c) => c.reply.state)).toContain('checking');
  });

  it('a wrong code shows wrongCode with the form still usable; a second try with the right code connects', async () => {
    const w = pairWorld();
    w.server().openCode('ZZZZZZZZ');
    const { model } = rig(w);
    model.submit(`${PORT}-ABCDEFGH`, '');
    await until(() => model.state().reply.state === 'wrongCode');
    expect(model.state().reply).toEqual({ state: 'wrongCode', paired: false });
    w.server().openCode('ABCDEFGH');
    model.submit(`${PORT}-ABCDEFGH`, '');
    await until(() => model.state().reply.state === 'connected');
  });

  it('unpair: ends notPaired with paired false and no note on a 200; the record is gone', async () => {
    const w = mk();
    w.install(REC);
    const { model } = rig(w);
    model.unpair();
    await until(() => model.state().reply.state === 'notPaired');
    expect(model.state().reply).toEqual({ state: 'notPaired', paired: false });
    expect(w.idb.peek()).toBeUndefined();
  });

  it('an unpair the app refuses ends notPaired with the note unpairedLocalOnly', async () => {
    const w = mk();
    w.install(REC);
    w.server().once('/v1/unpair', err(401, 'bad_token'));
    const { model } = rig(w);
    model.unpair();
    await until(() => model.state().reply.state === 'notPaired');
    expect(model.state().reply).toEqual({ state: 'notPaired', paired: false, note: 'unpairedLocalOnly' });
  });

  it('a reply that never arrives: interrupted at 30 000 ms, not before; the worker finished its job; a new popup connects', async () => {
    const w = pairWorld();
    const { model } = rig(w, { deliver: false });
    model.submit(`${PORT}-ABCDEFGH`, 'My PC');
    await until(() => w.idb.peek() !== undefined);
    w.clock.advance(29_999);
    await w.idle();
    expect(model.state().reply.state).toBe('checking');
    // From 5 s on the model offers Check again and Pair again.
    expect(model.state().showCheckAgain).toBe(true);
    w.clock.advance(1);
    await until(() => model.state().reply.state === 'interrupted');
    expect(model.state().reply).toEqual({ state: 'interrupted', paired: false });
    // The pairing is there: a popup opened afterwards sees it.
    const again = rig(track1(w.restart()));
    again.model.open();
    await until(() => again.model.state().reply.state === 'connected');
  });

  it('a late reply of an older request is ignored: after Check again only the newer answer shows', async () => {
    const w = mk();
    w.install(REC);
    // The first status hangs on its request; the second one is answered at once.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    w.server().once('/v1/status', async () => {
      await gate;
      return err(401, 'bad_token');
    });
    const { model } = rig(w);
    model.open();
    await until(() => w.net.log.length >= 2);
    model.checkAgain();
    await until(() => model.state().reply.state === 'connected');
    release();
    await w.idle();
    // The first request's 401 would have shown notPaired; the model kept the newer answer.
    expect(model.state().reply.state).toBe('connected');
    expect(model.state().seq).toBe(2);
  });

  // Amendment 2 (AM2-1), the double submit on the real worker. The first pair is held at the app; a second submit reaches the worker while
  // it runs and is answered by the gate: operationRunning, paired false (no record yet). The model settles on it and sends no status.
  // The first pair's own reply belongs to an older sequence and is dropped, so its result is never shown; Check again shows the real state.
  it('AM2-1, a double submit: the first pair is held at the app, the second submit gets operationRunning and no status is sent; after the first pair ends, Check again gives connected', async () => {
    const w = pairWorld();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    w.server().once('/v1/pair', async () => {
      await gate;
      return 'default' as const;
    });
    const sentTypes: string[] = [];
    const changes: ModelState[] = [];
    const model = createPopupModel({
      send: (msg) => {
        sentTypes.push((msg as { type: string }).type);
        return w.send(msg);
      },
      setTimer: w.clock.setTimer,
      clearTimer: w.clock.clearTimer,
      onChange: (s) => {
        changes.push(structuredClone(s));
      },
    });
    model.submit(`${PORT}-ABCDEFGH`, 'My PC');
    await until(() => w.server().requests('/v1/pair').length === 1);
    model.submit(`${PORT}-ABCDEFGH`, 'My PC');
    await until(() => model.state().reply.state === 'operationRunning');
    expect(model.state().reply).toEqual({ state: 'operationRunning', paired: false });
    expect(model.state().showCheckAgain).toBe(true);
    expect(model.state().showPairAgain).toBe(true);
    expect(model.state().formOpen).toBe(false);
    expect(model.state().seq).toBe(2);
    expect(sentTypes, 'no status was sent after the gate reply').toEqual(['fetchly:pair', 'fetchly:pair']);
    expect(w.net.log.map((r) => r.path), 'the app saw one /v1/pair and nothing else').toEqual(['/v1/pair']);
    expect(w.idb.peek(), 'nothing is stored yet, so no Unpair button either').toBeUndefined();
    // The first pair ends. Its reply is for sequence 1: the model drops it and keeps showing operationRunning until the user acts.
    release();
    await until(() => w.idb.peek() !== undefined);
    await w.idle();
    expect(w.idb.peek()).toMatchObject({ pairingId: PAIRING_ID });
    expect(model.state().reply).toEqual({ state: 'operationRunning', paired: false });
    expect(sentTypes, 'still no status: nothing retries by itself').toEqual(['fetchly:pair', 'fetchly:pair']);
    expect(new Set(changes.map((c) => c.reply.state)), 'the popup showed only checking and operationRunning: the first pair\'s own reply was dropped').toEqual(new Set(['checking', 'operationRunning']));
    // Check again reads the status: the pairing the first submit made.
    model.checkAgain();
    await until(() => model.state().reply.state === 'connected');
    expect(model.state().reply).toEqual({ state: 'connected', paired: true, appVersion: '0.1.0' });
    expect(sentTypes).toEqual(['fetchly:pair', 'fetchly:pair', 'fetchly:status']);
    expect(w.net.log.map((r) => r.path)).toEqual(['/v1/pair', '/v1/hello', '/v1/status']);
    // Submitting the same code again after the first pair succeeded: the app has closed it, and a record is stored.
    model.submit(`${PORT}-ABCDEFGH`, 'My PC');
    await until(() => model.state().reply.state === 'pairingClosed');
    expect(model.state().reply).toEqual({ state: 'pairingClosed', paired: true });
  });
});
