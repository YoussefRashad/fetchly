/**
 * Task 4: extension/src/lib/popupModel.ts, the pure popup state machine (E12). Injected: send, setTimer, clearTimer, onChange.
 * The API is fixed in fixtures.ts (TEST CONTRACT).
 *
 * Enumerations:
 *  - Model operations (5): open, checkAgain, pairAgain, submit, unpair. The three messages they send: fetchly:status {},
 *    fetchly:pair { pairingString, label }, fetchly:unpair {} (exact key sets).
 *  - Timers per request: 5000 ms (offer Check again and Pair again, the wait goes on) and 30 000 ms (interrupted).
 *  - Ways a request ends: a reply for the current sequence, a reply for an older sequence (ignored), a rejected send,
 *    an `undefined` reply (both: interrupted), no reply at 30 000 ms (interrupted).
 *  - Model state members: seq, reply, showCheckAgain, showPairAgain, formOpen.
 *
 * Amendment 2 (AM2-1) adds, at the end of this file: an `operationRunning` reply to fetchly:unpair, fetchly:pair and fetchly:status
 * settles at once (no follow-up status, no timer, Check again and Pair again, formOpen unchanged), a later reply to an older sequence is
 * ignored, Check again sends exactly one status, and 30 s after the settle it is not interrupted. The `checking` specs of AM-5 above are
 * unchanged: an unpair or a pair can still answer `checking`.
 */
import { describe, expect, it } from 'vitest';
import { FakeClock, flush } from './clock';
import type { Reply } from './fixtures';
import { createPopupModel } from '../../extension/src/lib/popupModel';

interface Pending {
  msg: Record<string, unknown>;
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

function setup() {
  const clock = new FakeClock();
  const pending: Pending[] = [];
  const changes: unknown[] = [];
  const model = createPopupModel({
    send: (msg: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        pending.push({ msg: msg as Record<string, unknown>, resolve, reject });
      }),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onChange: (s: unknown) => {
      changes.push(structuredClone(s));
    },
  });
  return { clock, pending, changes, model };
}
type Rig = ReturnType<typeof setup>;

const connected: Reply = { state: 'connected', paired: true, appVersion: '0.1.0' };
const notPaired: Reply = { state: 'notPaired', paired: false };
const answer = async (r: Rig, i: number, reply: unknown): Promise<void> => {
  r.pending[i]?.resolve(reply);
  await flush();
};

describe('opening the popup', () => {
  it('sends status with sequence 1 and shows checking', () => {
    const { model, pending, changes } = setup();
    model.open();
    expect(pending.map((p) => p.msg)).toEqual([{ type: 'fetchly:status' }]);
    expect(Object.keys(pending[0]?.msg ?? {})).toEqual(['type']);
    expect(model.state().seq).toBe(1);
    expect(model.state().reply.state).toBe('checking');
    expect(model.state().showCheckAgain).toBe(false);
    expect(model.state().showPairAgain).toBe(false);
    expect(model.state().formOpen).toBe(false);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.at(-1)).toEqual(model.state());
  });

  it('shows no buttons at 4999 ms; at 5000 ms Check again and Pair again show while the wait goes on', async () => {
    const r = setup();
    r.model.open();
    r.clock.advance(4999);
    await flush();
    expect(r.model.state().showCheckAgain).toBe(false);
    expect(r.model.state().showPairAgain).toBe(false);
    const before = r.changes.length;
    r.clock.advance(1);
    await flush();
    expect(r.model.state().showCheckAgain).toBe(true);
    expect(r.model.state().showPairAgain).toBe(true);
    // The wait goes on: still checking, still the same request, nothing new sent, not interrupted.
    expect(r.model.state().reply.state).toBe('checking');
    expect(r.model.state().seq).toBe(1);
    expect(r.pending).toHaveLength(1);
    expect(r.changes.length).toBeGreaterThan(before);
    expect(r.changes.at(-1)).toEqual(r.model.state());
  });

  it('the reply of the current request renders, with Pair again present and the timers gone', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, connected);
    expect(r.model.state().reply).toEqual(connected);
    expect(r.model.state().showPairAgain).toBe(true);
    expect(r.model.state().seq).toBe(1);
    const snapshot = JSON.stringify(r.model.state());
    r.clock.advance(60_000);
    await flush();
    expect(JSON.stringify(r.model.state())).toBe(snapshot);
  });

  it('a reply that comes at 4999 ms or at 29 999 ms still renders', async () => {
    for (const ms of [4999, 5000, 29_999]) {
      const r = setup();
      r.model.open();
      r.clock.advance(ms);
      await answer(r, 0, notPaired);
      expect(r.model.state().reply, String(ms)).toEqual(notPaired);
    }
  });

  it.each([
    ['notPaired', { state: 'notPaired', paired: false }],
    ['appNotRunning', { state: 'appNotRunning', paired: true }],
    ['slow', { state: 'slow', paired: true }],
    ['storageBlocked', { state: 'storageBlocked', paired: false }],
    ['connected', connected],
    ['mismatch', { state: 'mismatch', paired: true }],
  ] as [string, Reply][])('after a %s reply, Pair again is shown', async (_n, reply) => {
    const r = setup();
    r.model.open();
    await answer(r, 0, reply);
    expect(r.model.state().showPairAgain).toBe(true);
  });

  it('after a slow reply, Check again is shown (its text says to press it)', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, { state: 'slow', paired: true });
    expect(r.model.state().showCheckAgain).toBe(true);
  });
});

describe('sequence numbers: an older reply is ignored', () => {
  it('Check again sends status again with sequence 2; the reply for sequence 1 is ignored, the one for sequence 2 renders', async () => {
    const r = setup();
    r.model.open();
    r.clock.advance(6000);
    await flush();
    r.model.checkAgain();
    expect(r.pending.map((p) => p.msg)).toEqual([{ type: 'fetchly:status' }, { type: 'fetchly:status' }]);
    expect(r.model.state().seq).toBe(2);
    expect(r.model.state().reply.state).toBe('checking');
    expect(r.model.state().showCheckAgain).toBe(false);
    expect(r.model.state().showPairAgain).toBe(false);
    const before = r.changes.length;
    await answer(r, 0, connected);
    expect(r.model.state().reply.state).toBe('checking');
    expect(r.model.state().seq).toBe(2);
    expect(r.changes).toHaveLength(before);
    await answer(r, 1, notPaired);
    expect(r.model.state().reply).toEqual(notPaired);
  });

  it('the reply for sequence 2 stays when the reply for sequence 1 comes after it', async () => {
    const r = setup();
    r.model.open();
    r.model.checkAgain();
    await answer(r, 1, notPaired);
    await answer(r, 0, connected);
    expect(r.model.state().reply).toEqual(notPaired);
  });

  it('a rejected send or an undefined reply for an older request is ignored too', async () => {
    const r = setup();
    r.model.open();
    r.model.checkAgain();
    r.pending[0]?.reject(new Error('port closed'));
    await flush();
    expect(r.model.state().reply.state).toBe('checking');
    await answer(r, 0, undefined);
    expect(r.model.state().reply.state).toBe('checking');
    await answer(r, 1, connected);
    expect(r.model.state().reply).toEqual(connected);
  });

  it('the 30 s timer of an older request does not interrupt the newer one', async () => {
    const r = setup();
    r.model.open();
    r.clock.advance(6000);
    r.model.checkAgain();
    r.clock.advance(24_000); // 30 s since open, 24 s since Check again
    await flush();
    expect(r.model.state().reply.state).toBe('checking');
    r.clock.advance(5999);
    await flush();
    expect(r.model.state().reply.state).toBe('checking');
    r.clock.advance(1);
    await flush();
    expect(r.model.state().reply.state).toBe('interrupted');
  });
});

describe('interrupted (E12: no answer from the worker)', () => {
  it('a rejected send gives interrupted at once', async () => {
    const r = setup();
    r.model.open();
    r.pending[0]?.reject(new Error('Could not establish connection. Receiving end does not exist.'));
    await flush();
    expect(r.model.state().reply).toEqual({ state: 'interrupted', paired: false });
    expect(r.model.state().showPairAgain).toBe(true);
  });

  it('an undefined reply gives interrupted at once', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, undefined);
    expect(r.model.state().reply).toEqual({ state: 'interrupted', paired: false });
  });

  it('no reply: still checking at 29 999 ms, interrupted at 30 000 ms', async () => {
    const r = setup();
    r.model.open();
    r.clock.advance(29_999);
    await flush();
    expect(r.model.state().reply.state).toBe('checking');
    expect(r.model.state().showCheckAgain).toBe(true);
    r.clock.advance(1);
    await flush();
    expect(r.model.state().reply).toEqual({ state: 'interrupted', paired: false });
    expect(r.model.state().showPairAgain).toBe(true);
    expect(r.changes.at(-1)).toEqual(r.model.state());
  });

  it('a pair that gets no reply is interrupted at 30 s too', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, notPaired);
    r.model.submit('38917-ABCDEFGH', 'x');
    r.clock.advance(30_000);
    await flush();
    expect(r.model.state().reply.state).toBe('interrupted');
  });
});

describe('pairing from the popup', () => {
  it('submit sends fetchly:pair with exactly { pairingString, label } and sequence 2', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, notPaired);
    r.model.submit(' 38917-abcdefgh ', 'My PC');
    expect(r.pending[1]?.msg).toEqual({ type: 'fetchly:pair', pairingString: ' 38917-abcdefgh ', label: 'My PC' });
    expect(Object.keys(r.pending[1]?.msg ?? {}).sort()).toEqual(['label', 'pairingString', 'type']);
    expect(r.model.state().seq).toBe(2);
    expect(r.model.state().reply.state).toBe('checking');
  });

  it('a pair reply of checking sends a new status (once), then the status reply renders', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, notPaired);
    r.model.submit('38917-ABCDEFGH', 'x');
    await answer(r, 1, { state: 'checking', paired: true });
    expect(r.pending.map((p) => p.msg.type)).toEqual(['fetchly:status', 'fetchly:pair', 'fetchly:status']);
    expect(r.pending[2]?.msg).toEqual({ type: 'fetchly:status' });
    expect(r.model.state().seq).toBe(3);
    expect(r.model.state().reply.state).toBe('checking');
    await flush();
    expect(r.pending).toHaveLength(3);
    await answer(r, 2, connected);
    expect(r.model.state().reply).toEqual(connected);
    expect(r.pending).toHaveLength(3);
  });

  it.each([
    ['badInput', { state: 'badInput', paired: false }],
    ['wrongCode', { state: 'wrongCode', paired: false }],
    ['pairingClosed', { state: 'pairingClosed', paired: false }],
    ['appNotRunning', { state: 'appNotRunning', paired: false }],
    ['wrongProgram', { state: 'wrongProgram', paired: false }],
    ['mismatch', { state: 'mismatch', paired: false }],
    ['storageBlocked', { state: 'storageBlocked', paired: false }],
    ['storageFailed', { state: 'storageFailed', paired: false }],
  ] as [string, Reply][])('a pair reply of %s renders and sends nothing more', async (_n, reply) => {
    const r = setup();
    r.model.open();
    await answer(r, 0, notPaired);
    r.model.submit('38917-ABCDEFGH', 'x');
    await answer(r, 1, reply);
    expect(r.model.state().reply).toEqual(reply);
    expect(r.pending).toHaveLength(2);
  });

  it('a reply of checking to anything but a pair does not send a status', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, { state: 'checking', paired: false });
    expect(r.pending).toHaveLength(1);
  });
});

describe('Pair again, Check again and Unpair', () => {
  it('Pair again shows the form and sends nothing', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, connected);
    const sent = r.pending.length;
    const before = r.changes.length;
    r.model.pairAgain();
    expect(r.model.state().formOpen).toBe(true);
    expect(r.pending).toHaveLength(sent);
    expect(r.model.state().seq).toBe(1);
    expect(r.changes.length).toBeGreaterThan(before);
    expect(r.model.state().reply).toEqual(connected);
  });

  it('Pair again while the wait goes on (after 5 s) shows the form and sends nothing; the reply still renders', async () => {
    const r = setup();
    r.model.open();
    r.clock.advance(5000);
    r.model.pairAgain();
    expect(r.model.state().formOpen).toBe(true);
    expect(r.pending).toHaveLength(1);
    await answer(r, 0, connected);
    expect(r.model.state().reply).toEqual(connected);
  });

  it('Check again sends status with the next sequence number and shows checking', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, { state: 'slow', paired: true });
    r.model.checkAgain();
    expect(r.pending.map((p) => p.msg)).toEqual([{ type: 'fetchly:status' }, { type: 'fetchly:status' }]);
    expect(r.model.state().seq).toBe(2);
    expect(r.model.state().reply.state).toBe('checking');
    await answer(r, 1, connected);
    expect(r.model.state().reply).toEqual(connected);
  });

  it('Unpair sends fetchly:unpair {} with the next sequence number; its reply renders with the note', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, connected);
    r.model.unpair();
    expect(r.pending[1]?.msg).toEqual({ type: 'fetchly:unpair' });
    expect(Object.keys(r.pending[1]?.msg ?? {})).toEqual(['type']);
    expect(r.model.state().seq).toBe(2);
    expect(r.model.state().reply.state).toBe('checking');
    const reply: Reply = { state: 'notPaired', paired: false, note: 'unpairedLocalOnly' };
    await answer(r, 1, reply);
    expect(r.model.state().reply).toEqual(reply);
  });

  // ---------------------------------------------------------------------------------------------
  // Amendment 1 (AM-5): a `checking` reply means "ask for the status now". The existing test above, 'a reply of checking to anything but a
  // pair does not send a status', only covers a status (open); its title predates AM-5, which also makes an unpair's `checking` ask.

  it('AM-5: a checking reply to fetchly:unpair sends a new fetchly:status with the next sequence number (once), then the status reply renders', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, connected);
    r.model.unpair();
    await answer(r, 1, { state: 'checking', paired: true });
    expect(r.pending.map((p) => p.msg)).toEqual([{ type: 'fetchly:status' }, { type: 'fetchly:unpair' }, { type: 'fetchly:status' }]);
    expect(Object.keys(r.pending[2]?.msg ?? {})).toEqual(['type']);
    expect(r.model.state().seq).toBe(3);
    expect(r.model.state().reply.state).toBe('checking');
    expect(r.model.state().showCheckAgain).toBe(false);
    expect(r.model.state().showPairAgain).toBe(false);
    await flush();
    expect(r.pending).toHaveLength(3);
    await answer(r, 2, notPaired);
    expect(r.model.state().reply).toEqual(notPaired);
    expect(r.pending).toHaveLength(3);
  });

  it('AM-5: the status that follows a checking reply gets a NEW 30 s: not interrupted at 29 999 ms after it was sent, interrupted at 30 000 ms; the old timers are gone', async () => {
    for (const first of ['pair', 'unpair'] as const) {
      const r = setup();
      r.model.open();
      await answer(r, 0, notPaired);
      if (first === 'pair') r.model.submit('38917-ABCDEFGH', 'x');
      else r.model.unpair();
      r.clock.advance(20_000);
      await flush();
      await answer(r, 1, { state: 'checking', paired: true });
      expect(r.model.state().seq, first).toBe(3);
      r.clock.advance(29_999);
      await flush();
      expect(r.model.state().reply.state, `${first}: 29 999 ms after the status was sent`).toBe('checking');
      r.clock.advance(1);
      await flush();
      expect(r.model.state().reply, `${first}: 30 000 ms after the status was sent`).toEqual({ state: 'interrupted', paired: false });
    }
  });

  it('AM-5: the status that follows a checking reply gets a new 5 s: no buttons at 4999 ms after it was sent, Check again and Pair again at 5000 ms', async () => {
    for (const first of ['pair', 'unpair'] as const) {
      const r = setup();
      r.model.open();
      await answer(r, 0, notPaired);
      if (first === 'pair') r.model.submit('38917-ABCDEFGH', 'x');
      else r.model.unpair();
      r.clock.advance(20_000);
      await flush();
      await answer(r, 1, { state: 'checking', paired: true });
      r.clock.advance(4999);
      await flush();
      expect(r.model.state().showCheckAgain, first).toBe(false);
      expect(r.model.state().showPairAgain, first).toBe(false);
      r.clock.advance(1);
      await flush();
      expect(r.model.state().showCheckAgain, first).toBe(true);
      expect(r.model.state().showPairAgain, first).toBe(true);
      expect(r.model.state().reply.state, 'the wait goes on').toBe('checking');
    }
  });

  it('AM-5: a checking reply of an unpair that is still pending when a newer status has completed is ignored (an older sequence): no status is asked for, nothing renders', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, connected);
    r.model.unpair(); // pending[1]: the unpair, sequence 2, never answered until the end
    r.clock.advance(5000);
    await flush();
    r.model.checkAgain(); // pending[2]: a distinct, newer status, sequence 3
    expect(r.pending.map((p) => p.msg)).toEqual([{ type: 'fetchly:status' }, { type: 'fetchly:unpair' }, { type: 'fetchly:status' }]);
    expect(r.model.state().seq).toBe(3);
    await answer(r, 2, notPaired);
    expect(r.model.state().reply).toEqual(notPaired);
    const settled = JSON.stringify(r.model.state());
    const changes = r.changes.length;
    await answer(r, 1, { state: 'checking', paired: true }); // the old unpair answers late: it would ask for a status if it counted
    expect(JSON.stringify(r.model.state())).toBe(settled);
    expect(r.changes, 'the late reply caused no render').toHaveLength(changes);
    expect(r.pending, 'and no status was asked for').toHaveLength(3);
    expect(r.model.state().seq).toBe(3);
    expect(r.clock.pending()).toEqual([]);
  });

  it('AM-5: a checking reply to fetchly:status settles with Check again and Pair again shown, sends nothing, and keeps no timer: there is no automatic retry', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, { state: 'checking', paired: true });
    expect(r.pending).toHaveLength(1);
    expect(r.model.state().reply).toEqual({ state: 'checking', paired: true });
    expect(r.model.state().showCheckAgain).toBe(true);
    expect(r.model.state().showPairAgain).toBe(true);
    expect(r.model.state().seq).toBe(1);
    expect(r.clock.pending(), 'no timer is left: the wait is over').toEqual([]);
    r.clock.advance(120_000);
    await flush();
    expect(r.pending, 'still nothing more sent after two minutes').toHaveLength(1);
    expect(r.model.state().reply.state, 'not interrupted: it settled').toBe('checking');
    expect(r.model.state().seq).toBe(1);
  });

  it('AM-5: a checking reply to a status that follows a pair (or an unpair) settles in the same way, and does not ask again', async () => {
    for (const first of ['pair', 'unpair'] as const) {
      const r = setup();
      r.model.open();
      await answer(r, 0, notPaired);
      if (first === 'pair') r.model.submit('38917-ABCDEFGH', 'x');
      else r.model.unpair();
      await answer(r, 1, { state: 'checking', paired: true });
      expect(r.pending).toHaveLength(3);
      await answer(r, 2, { state: 'checking', paired: true });
      expect(r.pending, first).toHaveLength(3);
      expect(r.model.state().reply, first).toEqual({ state: 'checking', paired: true });
      expect(r.model.state().showCheckAgain, first).toBe(true);
      expect(r.model.state().showPairAgain, first).toBe(true);
      expect(r.clock.pending(), first).toEqual([]);
      r.clock.advance(120_000);
      await flush();
      expect(r.pending, first).toHaveLength(3);
    }
  });

  it('AM-5: a checking reply to Check again (a status) settles too, and pressing Check again sends one new status', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, { state: 'slow', paired: true });
    r.model.checkAgain();
    await answer(r, 1, { state: 'checking', paired: true });
    expect(r.pending).toHaveLength(2);
    expect(r.model.state().showCheckAgain).toBe(true);
    r.model.checkAgain();
    expect(r.pending.map((p) => p.msg)).toEqual([{ type: 'fetchly:status' }, { type: 'fetchly:status' }, { type: 'fetchly:status' }]);
    expect(r.model.state().seq).toBe(3);
  });

  it('every message the model sends is one of the three types with its exact key set', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, notPaired);
    r.model.submit('38917-ABCDEFGH', 'x');
    await answer(r, 1, { state: 'wrongCode', paired: false });
    r.model.checkAgain();
    await answer(r, 2, connected);
    r.model.unpair();
    const shapes = r.pending.map((p) => Object.keys(p.msg).sort().join(','));
    expect(shapes).toEqual(['type', 'label,pairingString,type', 'type', 'type']);
    expect(r.pending.map((p) => p.msg['type'])).toEqual(['fetchly:status', 'fetchly:pair', 'fetchly:status', 'fetchly:unpair']);
    expect(JSON.stringify(r.pending.map((p) => p.msg))).not.toMatch(/token/iu);
  });
});

// ---------------------------------------------------------------------------------------------
// Amendment 2 (AM2-1, docs/plans/2026-11-23-phase2-a2-amendment-2.md): an `operationRunning` reply is a final state, like any other. It
// settles at once: the timers stop, Check again and Pair again show, NO follow-up fetchly:status is sent (unlike `checking`, which keeps
// the AM-2 meaning "ask for the status now"), and `formOpen` is not changed by the reply. The model does not look at which message the
// reply answers. A late reply of an older sequence is ignored (unchanged). The only model change is the new member of STATES: without it
// readReply gives `interrupted`.

describe('AM2-1: an operationRunning reply settles, with no follow-up status', () => {
  type Kind = 'unpair' | 'pair' | 'status';
  const KINDS: Kind[] = ['unpair', 'pair', 'status'];
  const PAIRED: boolean[] = [true, false];
  /** The reply is tested for each message it can answer (the worker sends it only to a pair or an unpair; the model must not care), with
   *  both `paired` values and with the form closed or open before the request. */
  const CASES = KINDS.flatMap((k) => PAIRED.flatMap((paired) => [false, true].map((open) => [k, paired, open] as [Kind, boolean, boolean])));
  const gateReply = (paired: boolean): Reply => ({ state: 'operationRunning', paired });

  /** Sends one request of `kind`; the model had settled on `connected` (or `notPaired` before a pair). */
  function sendOne(r: Rig, kind: Kind): void {
    if (kind === 'pair') r.model.submit('38917-ABCDEFGH', 'x');
    else if (kind === 'unpair') r.model.unpair();
    else r.model.checkAgain();
  }

  /** The model after open() and its answer; the request of `kind` is sent and waits (pending index 1). */
  async function waiting(kind: Kind, formOpenBefore: boolean): Promise<Rig> {
    const r = setup();
    r.model.open();
    await answer(r, 0, kind === 'pair' ? notPaired : connected);
    if (formOpenBefore) r.model.pairAgain();
    sendOne(r, kind);
    expect(r.pending).toHaveLength(2);
    return r;
  }

  it.each(CASES)('to %s (paired %s, form open before: %s): it renders, nothing more is sent, the sequence stays, no timer is left, Check again and Pair again show', async (kind, paired, open) => {
    const r = await waiting(kind, open);
    const seq = r.model.state().seq;
    expect(r.clock.pending(), 'the two request timers are armed while it waits').toHaveLength(2);
    await answer(r, 1, gateReply(paired));
    await flush();
    expect(r.model.state().reply).toEqual(gateReply(paired));
    expect(r.pending, 'no fetchly:status follows').toHaveLength(2);
    expect(r.model.state().seq, 'no new request').toBe(seq);
    expect(r.model.state().showCheckAgain).toBe(true);
    expect(r.model.state().showPairAgain).toBe(true);
    expect(r.clock.pending(), 'no timer is left: nothing waits').toEqual([]);
    expect(r.changes.at(-1)).toEqual(r.model.state());
  });

  it.each(CASES)('to %s (paired %s, form open before: %s): formOpen is not changed by the reply (false after a submit, otherwise what it was)', async (kind, paired, open) => {
    const r = await waiting(kind, open);
    // A submit closes the form before it sends; the other two requests leave it as it was.
    const expected = kind === 'pair' ? false : open;
    expect(r.model.state().formOpen, 'while it waits').toBe(expected);
    await answer(r, 1, gateReply(paired));
    expect(r.model.state().reply, 'the reply is the one that was sent').toEqual(gateReply(paired));
    expect(r.model.state().formOpen, 'after the reply').toBe(expected);
  });

  it.each(CASES)('to %s (paired %s, form open before: %s): 30 s after the settle it is not interrupted, and nothing is sent', async (kind, paired, open) => {
    const r = await waiting(kind, open);
    await answer(r, 1, gateReply(paired));
    const snapshot = JSON.stringify(r.model.state());
    for (const ms of [29_999, 1, 90_000]) {
      r.clock.advance(ms);
      await flush();
      expect(r.model.state().reply, `after ${ms} ms more`).toEqual(gateReply(paired));
    }
    expect(JSON.stringify(r.model.state())).toBe(snapshot);
    expect(r.pending).toHaveLength(2);
  });

  it.each(CASES)('to %s (paired %s, form open before: %s): Check again then sends exactly one status, with the next sequence number', async (kind, paired, open) => {
    const r = await waiting(kind, open);
    await answer(r, 1, gateReply(paired));
    expect(r.model.state().reply, 'settled on operationRunning, not interrupted').toEqual(gateReply(paired));
    const seq = r.model.state().seq;
    r.model.checkAgain();
    expect(r.pending).toHaveLength(3);
    expect(r.pending[2]?.msg).toEqual({ type: 'fetchly:status' });
    expect(Object.keys(r.pending[2]?.msg ?? {})).toEqual(['type']);
    expect(r.model.state().seq).toBe(seq + 1);
    expect(r.model.state().reply.state).toBe('checking');
    expect(r.model.state().showCheckAgain).toBe(false);
    await flush();
    expect(r.pending, 'exactly one').toHaveLength(3);
    await answer(r, 2, connected);
    expect(r.model.state().reply).toEqual(connected);
    expect(r.pending).toHaveLength(3);
  });

  it.each(KINDS)('Pair again after an operationRunning reply to %s reopens the form and sends nothing', async (kind) => {
    const r = await waiting(kind, false);
    await answer(r, 1, gateReply(true));
    const sent = r.pending.length;
    const seq = r.model.state().seq;
    r.model.pairAgain();
    expect(r.model.state().formOpen).toBe(true);
    expect(r.pending).toHaveLength(sent);
    expect(r.model.state().seq).toBe(seq);
    expect(r.model.state().reply).toEqual(gateReply(true));
  });

  // The running operation's own reply belongs to an older sequence: it is ignored (popupModel.ts:116, unchanged) and the popup keeps
  // showing operationRunning until the user acts. The double submit is the case the amendment names: the first pair's wrongCode or
  // storageFailed is never shown.
  const LATE: [string, (r: Rig) => Promise<void>][] = [
    ['a wrongCode', (r) => answer(r, 1, { state: 'wrongCode', paired: false })],
    ['a storageFailed', (r) => answer(r, 1, { state: 'storageFailed', paired: true })],
    ['a connected', (r) => answer(r, 1, connected)],
    ['a checking (which would otherwise ask for the status)', (r) => answer(r, 1, { state: 'checking', paired: true })],
    ['an undefined reply', (r) => answer(r, 1, undefined)],
    [
      'a rejected send',
      async (r) => {
        r.pending[1]?.reject(new Error('port closed'));
        await flush();
      },
    ],
  ];
  const LATE_CASES = KINDS.flatMap((k) => LATE.map(([name, late]) => [k, name, late] as [Kind, string, (r: Rig) => Promise<void>]));

  it.each(LATE_CASES)('after a double %s the gated second request settles and a later %s of the first one changes nothing: the state, the buttons and the timers stay', async (kind, _name, late) => {
    const r = setup();
    r.model.open();
    await answer(r, 0, kind === 'pair' ? notPaired : connected);
    sendOne(r, kind);
    sendOne(r, kind);
    // pending: [open, first (the running operation), second (gated)]
    expect(r.pending).toHaveLength(3);
    expect(r.model.state().seq).toBe(3);
    await answer(r, 2, gateReply(kind !== 'pair'));
    const settled = JSON.stringify(r.model.state());
    const changes = r.changes.length;
    await late(r);
    expect(JSON.stringify(r.model.state())).toBe(settled);
    expect(r.model.state().reply.state).toBe('operationRunning');
    expect(r.changes, 'the late reply caused no render').toHaveLength(changes);
    expect(r.pending, 'and no status').toHaveLength(3);
    expect(r.clock.pending()).toEqual([]);
  });

  it('the running operation\'s reply is ignored whether it comes before or after the gate reply: operationRunning is what the popup ends on', async () => {
    const before = setup();
    before.model.open();
    await answer(before, 0, notPaired);
    before.model.submit('38917-ABCDEFGH', 'x');
    before.model.submit('38917-ABCDEFGH', 'x');
    await answer(before, 1, { state: 'wrongCode', paired: false });
    expect(before.model.state().reply.state, 'the first reply is older: ignored, the second request still waits').toBe('checking');
    expect(before.model.state().showCheckAgain).toBe(false);
    await answer(before, 2, gateReply(false));
    expect(before.model.state().reply).toEqual(gateReply(false));
    expect(before.pending).toHaveLength(3);

    const after = setup();
    after.model.open();
    await answer(after, 0, notPaired);
    after.model.submit('38917-ABCDEFGH', 'x');
    after.model.submit('38917-ABCDEFGH', 'x');
    await answer(after, 2, gateReply(false));
    await answer(after, 1, { state: 'wrongCode', paired: false });
    expect(after.model.state().reply).toEqual(gateReply(false));
    expect(after.pending).toHaveLength(3);
  });

  it.each(['unpair', 'pair'] as const)('contrast: a `checking` reply to %s asks for the status (AM-2) and an `operationRunning` reply does not', async (kind) => {
    const asked = await waiting(kind, false);
    await answer(asked, 1, { state: 'checking', paired: true });
    expect(asked.pending.map((p) => p.msg['type']).at(-1), 'checking: one fetchly:status follows').toBe('fetchly:status');
    expect(asked.pending).toHaveLength(3);
    const settled = await waiting(kind, false);
    await answer(settled, 1, gateReply(true));
    expect(settled.model.state().reply, 'operationRunning is rendered as it is').toEqual(gateReply(true));
    expect(settled.pending, 'operationRunning: nothing follows').toHaveLength(2);
  });

  it.each([
    ['without paired', { state: 'operationRunning' }],
    ['with a string paired', { state: 'operationRunning', paired: 'yes' }],
    ['with a null paired', { state: 'operationRunning', paired: null }],
    ['with the state in another case', { state: 'OperationRunning', paired: true }],
    ['with a trailing space', { state: 'operationRunning ', paired: true }],
  ] as [string, unknown][])('a malformed operationRunning reply (%s) is interrupted, like any malformed reply', async (_n, reply) => {
    const r = setup();
    r.model.open();
    await answer(r, 0, connected);
    r.model.unpair();
    await answer(r, 1, reply);
    expect(r.model.state().reply).toEqual({ state: 'interrupted', paired: false });
    expect(r.pending).toHaveLength(2);
  });

  it('only the known keys are kept, as for any reply: an operationRunning reply keeps its appVersion, drops an unknown note and an extra key, and asks for no status', async () => {
    const r = setup();
    r.model.open();
    await answer(r, 0, connected);
    r.model.unpair();
    await answer(r, 1, { state: 'operationRunning', paired: true, appVersion: '0.1.0', note: 'other', extra: 1 });
    expect(r.model.state().reply).toEqual({ state: 'operationRunning', paired: true, appVersion: '0.1.0' });
    expect(r.pending).toHaveLength(2);
  });
});
