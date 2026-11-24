/**
 * Task 4: extension/src/lib/view.ts, a pure function from a worker reply to what the popup shows (R2-1).
 *
 * viewOf(reply, t) returns exactly { title, hint, showForm, showUnpair } (see fixtures.ts, TEST CONTRACT).
 *
 * Enumerations:
 *  - Popup states (16 = 11 + 4 + 1): the 11 of plan section 5 (checking, notPaired, appNotRunning, wrongProgram, connected, rateLimited,
 *    appError, mismatch, slow, storageBlocked, interrupted), the 4 results of a pairing (storageFailed, badInput, wrongCode,
 *    pairingClosed) and, as its own group, the gate reply (amendment 2: operationRunning). One row per state and per `paired` value,
 *    in both languages.
 *  - Key set of the view: title, hint, showForm, showUnpair. "Pair again" is not a field: it is present in every state (the
 *    model, popupModel.test.ts, shows it everywhere but while "Checking…" is young), so nothing here may hide it.
 *  - showForm: true for notPaired and for the three pairing errors that ask for a retyped code (badInput, wrongCode,
 *    pairingClosed); false for every other state. CHOSEN: the plan marks only `notPaired` with "(form)".
 *  - showUnpair equals `paired` in every state (R2-1), also for operationRunning (AM2-1 rule 7: title t.operationRunning, empty hint,
 *    no form, Unpair when a record is stored).
 *  - The note `unpairedLocalOnly` is shown (in the title or the hint) and only when the reply carries it.
 */
import { describe, expect, it } from 'vitest';
import { ALL_STATES, type Reply, type State } from './fixtures';
import { AR, EN } from '../../extension/src/lib/strings';
import { viewOf } from '../../extension/src/lib/view';

const FORM: State[] = ['notPaired', 'badInput', 'wrongCode', 'pairingClosed'];

const rows: [State, boolean][] = ALL_STATES.flatMap((s) => [
  [s, true] as [State, boolean],
  [s, false] as [State, boolean],
]);

describe('viewOf: one row per popup state, both languages', () => {
  it('there are 16 states', () => {
    expect(ALL_STATES).toHaveLength(16);
    expect(new Set(ALL_STATES).size).toBe(16);
    expect(ALL_STATES.at(-1)).toBe('operationRunning');
  });

  it.each(rows)('%s with paired %s', (state, paired) => {
    for (const [name, t] of [
      ['EN', EN],
      ['AR', AR],
    ] as const) {
      const reply: Reply = { state, paired };
      const v = viewOf(reply, t);
      expect(Object.keys(v).sort(), name).toEqual(['hint', 'showForm', 'showUnpair', 'title']);
      expect(v.title, name).toBe((t as Record<string, string>)[state]);
      expect(typeof v.hint, name).toBe('string');
      expect(v.showForm, `${name} showForm`).toBe(FORM.includes(state));
      expect(v.showUnpair, `${name} showUnpair`).toBe(paired);
    }
  });

  it('notPaired shows its hint, appNotRunning shows its hint, in both languages', () => {
    for (const t of [EN, AR]) {
      expect(viewOf({ state: 'notPaired', paired: false }, t).hint).toBe(t.notPairedHint);
      expect(viewOf({ state: 'appNotRunning', paired: true }, t).hint).toBe(t.appNotRunningHint);
    }
  });

  it('the English and Arabic titles differ for every state', () => {
    for (const s of ALL_STATES) {
      expect(viewOf({ state: s, paired: true }, EN).title, s).not.toBe(viewOf({ state: s, paired: true }, AR).title);
    }
  });

  it('the E10 row (hello 404 unknown_pairing, record kept) is notPaired with the form and Unpair', () => {
    const v = viewOf({ state: 'notPaired', paired: true }, EN);
    expect(v.showForm).toBe(true);
    expect(v.showUnpair).toBe(true);
    expect(v.title).toBe(EN.notPaired);
  });

  it('after a removal (a right proof, then 401 bad_token) notPaired shows the form and no Unpair', () => {
    const v = viewOf({ state: 'notPaired', paired: false }, EN);
    expect(v.showForm).toBe(true);
    expect(v.showUnpair).toBe(false);
  });

  it('storageBlocked and interrupted have paired false, so no Unpair, and no form', () => {
    for (const s of ['storageBlocked', 'interrupted'] as const) {
      const v = viewOf({ state: s, paired: false }, EN);
      expect(v.showUnpair, s).toBe(false);
      expect(v.showForm, s).toBe(false);
    }
  });

  // AM2-1 rule 7: the gate reply. The title is t.operationRunning, the hint is empty, there is no form, and Unpair shows exactly when
  // a record is stored (`paired`): a gated message reads the store once and the reply says what that read found.
  it.each([
    ['EN', EN, 'Another operation is running. Try again.'],
    ['AR', AR, 'عملية أخرى قيد التنفيذ. حاول مرة أخرى.'],
  ] as const)('AM2-1: operationRunning in %s: the title is the table\'s, the hint is empty, no form, and showUnpair equals paired (true and false)', (_n, t, text) => {
    for (const paired of [true, false]) {
      const v = viewOf({ state: 'operationRunning', paired }, t);
      expect(v.title, `paired ${String(paired)}`).toBe(text);
      expect(v.title, `paired ${String(paired)}`).toBe(t.operationRunning);
      expect(v.hint, `paired ${String(paired)}: empty hint`).toBe('');
      expect(v.showForm, `paired ${String(paired)}: no form`).toBe(false);
      expect(v.showUnpair, `paired ${String(paired)}`).toBe(paired);
      expect(Object.keys(v).sort()).toEqual(['hint', 'showForm', 'showUnpair', 'title']);
    }
  });

  it('AM2-1: operationRunning is not the checking, storageBlocked or notPaired view (its own title, no notPaired hint or form)', () => {
    for (const t of [EN, AR]) {
      const v = viewOf({ state: 'operationRunning', paired: true }, t);
      expect(typeof v.title).toBe('string');
      expect(v.title.length).toBeGreaterThan(0);
      for (const other of ['checking', 'storageBlocked', 'notPaired', 'interrupted', 'slow'] as const) expect(v.title, other).not.toBe(t[other]);
      expect(v.hint).not.toBe(t.notPairedHint);
      expect(v.hint).not.toBe(t.appNotRunningHint);
    }
  });

  it('every row that keeps the record shows Unpair', () => {
    for (const s of ['appNotRunning', 'wrongProgram', 'connected', 'rateLimited', 'appError', 'mismatch', 'slow'] as const) {
      expect(viewOf({ state: s, paired: true }, EN).showUnpair, s).toBe(true);
    }
  });

  it('connected with an appVersion has the same view keys and the Connected title', () => {
    const v = viewOf({ state: 'connected', paired: true, appVersion: '0.1.0' }, EN);
    expect(v.title).toBe('Connected');
    expect(Object.keys(v).sort()).toEqual(['hint', 'showForm', 'showUnpair', 'title']);
  });
});

describe('viewOf: the note unpairedLocalOnly', () => {
  it.each([
    ['EN', EN],
    ['AR', AR],
  ] as const)('is shown in %s when the reply carries it, and only then', (_n, t) => {
    const withNote = viewOf({ state: 'notPaired', paired: false, note: 'unpairedLocalOnly' }, t);
    expect(`${withNote.title}\n${withNote.hint}`).toContain(t.unpairedLocalOnly);
    expect(withNote.title).toBe(t.notPaired);
    expect(withNote.showForm).toBe(true);
    expect(withNote.showUnpair).toBe(false);
    for (const s of ALL_STATES) {
      const without = viewOf({ state: s, paired: false }, t);
      expect(`${without.title}\n${without.hint}`, s).not.toContain(t.unpairedLocalOnly);
    }
  });
});

describe('viewOf: purity', () => {
  it('does not change its input and gives the same answer twice', () => {
    const reply: Reply = { state: 'connected', paired: true, appVersion: '0.1.0' };
    const copy = structuredClone(reply);
    const a = viewOf(reply, EN);
    const b = viewOf(reply, EN);
    expect(reply).toEqual(copy);
    expect(a).toEqual(b);
  });

  it('shows no string that is not from the table it was given', () => {
    const t = { ...EN, notPaired: 'N!', notPairedHint: 'H!' };
    const v = viewOf({ state: 'notPaired', paired: false }, t);
    expect(v.title).toBe('N!');
    expect(v.hint).toBe('H!');
  });
});
