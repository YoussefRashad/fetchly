// Task D, item 2: the code table of src/shared/errors.ts against the dictionaries and the text matches that remain
// (frozen plan docs/plans/2026-11-23-d-housekeeping.md, "The code table", D2.4, D2.5 and "Specs").
//
// Enumeration: ERROR_CODES (code -> kind fixed | detail | port | reason), ERROR_TEXT (every non-reason code),
// EN.errors / AR.errors (the same keys plus other, saveFailed, serverAnswered), SAVE_FAILED_PREFIX, and the two texts
// of pairing.ts that ipc.ts still compares by value (FOUR_PAIRED_TEXT, NOT_LISTENING_TEXT).
import { describe, expect, it } from 'vitest';
import type { Engine } from '../src/main/engines/engine';
import { Queue } from '../src/main/jobs/queue';
import type { Store } from '../src/main/jobs/store';
import { FOUR_PAIRED_TEXT, NOT_LISTENING_TEXT } from '../src/main/server/pairing';
import { EN } from '../src/renderer/src/strings';
import { AR } from '../src/renderer/src/strings.ar';
import { ERROR_CODES, ERROR_TEXT, SAVE_FAILED_PREFIX } from '../src/shared/errors';
import { DETAIL, FIXED, KINDS, NON_REASON_CODES, PORT } from './errorTable';
import { makeSettings } from './helpers';

const EXTRAS = ['other', 'saveFailed', 'serverAnswered'];
const asRecord = (o: unknown): Record<string, unknown> => o as Record<string, unknown>;

describe('ERROR_CODES', () => {
  it('holds exactly the codes of the plan, each with its kind', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual(Object.keys(KINDS).sort());
    expect({ ...ERROR_CODES }).toEqual(KINDS);
  });

  it('has four kinds, and linkProblem is the only reason', () => {
    expect(new Set(Object.values(ERROR_CODES))).toEqual(new Set(['fixed', 'detail', 'port', 'reason']));
    expect(Object.entries(ERROR_CODES).filter(([, kind]) => kind === 'reason')).toEqual([['linkProblem', 'reason']]);
  });

  it('has 27 fixed codes, 4 detail codes, 1 port code and 1 reason code', () => {
    const kinds = Object.values(ERROR_CODES);
    expect(kinds.filter((k) => k === 'fixed')).toHaveLength(27);
    expect(kinds.filter((k) => k === 'detail')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'port')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'reason')).toHaveLength(1);
  });

  it('the spec table lists every non-reason code once', () => {
    expect([...NON_REASON_CODES].sort()).toEqual(Object.keys(ERROR_CODES).filter((c) => c !== 'linkProblem').sort());
    expect(new Set(NON_REASON_CODES).size).toBe(NON_REASON_CODES.length);
  });
});

describe('ERROR_TEXT', () => {
  it('has a text for every code that is not a reason, and for no other key', () => {
    expect(Object.keys(ERROR_TEXT).sort()).toEqual([...NON_REASON_CODES].sort());
  });

  it.each(FIXED)('%s: a string, the English text of today', (code, en) => {
    expect(asRecord(ERROR_TEXT)[code]).toBe(en);
  });

  it.each(DETAIL)('%s: a function of the detail, the English text of today', (code, en) => {
    const text = asRecord(ERROR_TEXT)[code] as (detail: string) => string;
    expect(typeof text).toBe('function');
    expect(text('D-1')).toBe(en('D-1'));
    expect(text('')).toBe(en(''));
  });

  it.each(PORT)('%s: a function of the port, the English text of today', (code, en) => {
    const text = asRecord(ERROR_TEXT)[code] as (port: number) => string;
    expect(typeof text).toBe('function');
    expect(text(38917)).toBe(en(38917));
  });

  it('has no text for linkProblem: its text is the reason token', () => {
    expect(Object.hasOwn(ERROR_TEXT, 'linkProblem')).toBe(false);
  });
});

describe('EN.errors and AR.errors', () => {
  it('EN.errors has exactly the non-reason codes plus other, saveFailed and serverAnswered', () => {
    expect(Object.keys(EN.errors).sort()).toEqual([...NON_REASON_CODES, ...EXTRAS].sort());
  });

  it('AR.errors has the same keys', () => {
    expect(Object.keys(AR.errors).sort()).toEqual(Object.keys(EN.errors).sort());
  });

  it('linkProblem is not a key of either', () => {
    expect(Object.hasOwn(EN.errors, 'linkProblem')).toBe(false);
    expect(Object.hasOwn(AR.errors, 'linkProblem')).toBe(false);
  });

  it('the three extras are not codes', () => {
    for (const key of EXTRAS) expect(Object.hasOwn(ERROR_CODES, key), key).toBe(false);
  });

  it.each(NON_REASON_CODES.map((code) => [code]))('EN.errors.%s is the very value of ERROR_TEXT (toBe)', (code) => {
    expect(asRecord(EN.errors)[code as string]).toBe(asRecord(ERROR_TEXT)[code as string]);
  });

  it.each(FIXED)('AR.errors.%s is the Arabic text of the plan', (code, _en, ar) => {
    expect(asRecord(AR.errors)[code]).toBe(ar);
  });

  it.each(DETAIL)('AR.errors.%s is the Arabic text of the plan, the detail isolated', (code, _en, ar) => {
    const text = asRecord(AR.errors)[code] as (detail: string) => string;
    expect(text('D-1')).toBe(ar('D-1'));
    expect(text('')).toBe(ar(''));
  });

  it.each(PORT)('AR.errors.%s is the Arabic text of the plan, the port isolated', (code, _en, ar) => {
    const text = asRecord(AR.errors)[code] as (port: number) => string;
    expect(text(38917)).toBe(ar(38917));
  });

  it('every kind of an ERROR_CODES entry matches the shape of its text in both languages', () => {
    for (const [code, kind] of Object.entries(ERROR_CODES)) {
      if (kind === 'reason') continue;
      for (const [name, dict] of [['ERROR_TEXT', ERROR_TEXT], ['EN.errors', EN.errors], ['AR.errors', AR.errors]] as const) {
        expect(typeof asRecord(dict)[code], `${name}.${code}`).toBe(kind === 'fixed' ? 'string' : 'function');
      }
    }
  });

  it('the cut-off text names the banner button of its own language', () => {
    expect(ERROR_TEXT.cutOff).toContain(EN.theyAreGone);
    expect(AR.errors.cutOff).toContain(AR.theyAreGone);
  });
});

describe('the two texts ipc.ts still matches by value (D2.5)', () => {
  it('ERROR_TEXT.fourPaired is the text of pairing.ts', () => {
    expect(ERROR_TEXT.fourPaired).toBe(FOUR_PAIRED_TEXT);
    expect(FOUR_PAIRED_TEXT).toBe('Four browsers are already paired. Unpair one first.');
  });

  it('ERROR_TEXT.notListening is the text of pairing.ts', () => {
    expect(ERROR_TEXT.notListening).toBe(NOT_LISTENING_TEXT);
    expect(NOT_LISTENING_TEXT).toBe('Pairing is possible only while Fetchly is listening for the browser');
  });
});

describe('the save error (D2.4): the second text match', () => {
  /** An engine that does nothing: the queue only has to try to save. */
  const idle: Engine & { setRateLimit(jobId: string, bytes: number | null): Promise<boolean> } = {
    start: () => undefined,
    stop: async () => undefined,
    discard: async () => undefined,
    on: () => undefined,
    setRateLimit: async () => true,
  };

  /** A queue whose store throws `thrown` on every save, and what its save-state listener is told. */
  function failingQueue(thrown: unknown): { told: (string | null)[]; queue: Queue } {
    const store = {
      saveSnapshot: () => {
        throw thrown;
      },
    } as unknown as Store;
    const queue = new Queue({
      store,
      media: idle,
      file: idle,
      initial: { jobs: [], groups: [] },
      settings: makeSettings(),
      straysCleared: true,
      setTimer: () => undefined,
      extrasFor: () => null,
    });
    const told: (string | null)[] = [];
    queue.onSaveState((state) => told.push(state));
    return { told, queue };
  }

  it('the text the queue reports starts with SAVE_FAILED_PREFIX and ends with the OS message', () => {
    const { told } = failingQueue(new Error('EACCES: permission denied'));
    const last = told.at(-1);
    expect(last).not.toBeNull();
    expect(last?.startsWith(SAVE_FAILED_PREFIX)).toBe(true);
    expect(last).toBe(`${SAVE_FAILED_PREFIX}EACCES: permission denied`);
  });

  it('a thrown value that is not an Error is written with String()', () => {
    const { told } = failingQueue('plain text');
    expect(told.at(-1)).toBe(`${SAVE_FAILED_PREFIX}plain text`);
  });

  it('the prefix is the English text of today, with its colon and space', () => {
    expect(SAVE_FAILED_PREFIX).toBe('could not save the download list: ');
  });

  it('EN.errors.saveFailed(detail) is the prefix and the detail', () => {
    expect(EN.errors.saveFailed('disk full')).toBe(`${SAVE_FAILED_PREFIX}disk full`);
  });
});
