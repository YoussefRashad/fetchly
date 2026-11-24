// A3 Task T3 (plan 3.4): headersFor, noSignIn, composeExtras and ExtrasError. `src/main/extras.ts` has no Electron import,
// and `engines/engine.ts` holds RunExtras and ExtrasError, so this spec runs in plain Node.
import { describe, expect, it, vi } from 'vitest';
import { ExtrasError, type RunExtras } from '../src/main/engines/engine';
import { composeExtras, headersFor, noSignIn, type SignInStep } from '../src/main/extras';
import type { Job } from '../src/shared/types';
import { makeJob } from './helpers';

/** The text the frozen contract gives for a sign-in that was not kept (plan 3.4, DV9). */
const COOKIES_GONE = 'the sign-in sent with this link was not kept; send it again from the browser';
const REFERER = 'https://a.example/watch';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
/** A stand-in for the A5 source; CookieSource is `never` in A3, so the spec casts. */
const SOURCE = { stand: 'in' } as unknown as RunExtras['cookies'];

/** A job whose property reads are recorded, in order, with `events` (shared with a step to see who ran first). */
function spyJob(over: Partial<Job> = {}, events: string[] = []): { job: Job; events: string[]; reads: () => string[] } {
  const target = makeJob(over);
  const job = new Proxy(target, {
    get(t, p, receiver) {
      if (typeof p === 'string') events.push(`read:${p}`);
      return Reflect.get(t, p, receiver) as unknown;
    },
  });
  return { job, events, reads: () => events.filter((e) => e.startsWith('read:')).map((e) => e.slice(5)) };
}

const COMBOS: [string, string | null, string | null][] = [
  ['both null', null, null],
  ['a referer only', REFERER, null],
  ['a User-Agent only', null, UA],
  ['both set', REFERER, UA],
];

describe('ExtrasError', () => {
  it('is an Error that carries its reason, and nothing else is one', () => {
    const e = new ExtrasError('why not');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ExtrasError);
    expect(e.reason).toBe('why not');
    expect(new Error('why not')).not.toBeInstanceOf(ExtrasError);
  });

  it('keeps the reason exactly, whatever it holds', () => {
    for (const reason of ['', ' ', 'a\nb', 'é 😀', 'x'.repeat(5000)]) expect(new ExtrasError(reason).reason).toBe(reason);
  });
});

describe('headersFor', () => {
  it.each(COMBOS)('gives the two stored values for %s', (_name, referer, userAgent) => {
    expect(headersFor(makeJob({ referer, userAgent }))).toStrictEqual({ referer, userAgent });
  });

  it('gives exactly the keys referer and userAgent, never a cookies key', () => {
    expect(Object.keys(headersFor(makeJob({ referer: REFERER, userAgent: UA }))).sort()).toEqual(['referer', 'userAgent']);
  });

  it('does not throw for oneShotLogin true, with or without a group, and gives the same values', () => {
    for (const groupId of [null, 'g1']) {
      const job = makeJob({ oneShotLogin: true, groupId, referer: REFERER, userAgent: UA });
      expect(() => headersFor(job)).not.toThrow();
      expect(headersFor(job)).toStrictEqual({ referer: REFERER, userAgent: UA });
    }
  });

  it('never reads oneShotLogin: it reads the two stored values and nothing else', () => {
    const { job, reads } = spyJob({ oneShotLogin: true, referer: REFERER, userAgent: UA });
    headersFor(job);
    expect(reads().filter((p) => p === 'oneShotLogin')).toEqual([]);
    expect(reads().every((p) => p === 'referer' || p === 'userAgent')).toBe(true);
    expect(reads().sort()).toEqual(['referer', 'userAgent']);
  });

  it('never throws, even where reading oneShotLogin would', () => {
    const job = makeJob({ referer: REFERER, userAgent: UA });
    Object.defineProperty(job, 'oneShotLogin', {
      get() {
        throw new Error('oneShotLogin was read');
      },
    });
    expect(headersFor(job)).toStrictEqual({ referer: REFERER, userAgent: UA });
  });

  it('is pure: the same job gives the same answer and the job is not changed', () => {
    const job = Object.freeze(makeJob({ referer: REFERER, userAgent: UA }));
    expect(headersFor(job)).toStrictEqual(headersFor(job));
    expect(job.referer).toBe(REFERER);
    expect(job.userAgent).toBe(UA);
  });

  it('gives the values as stored, a hostile User-Agent included (the stored list is what is checked)', () => {
    const hostile = 'Mozilla/5.0 "q" \\ %PATH% ^ & | < > ` $(x) ; --output=evil -o x';
    expect(headersFor(makeJob({ userAgent: hostile })).userAgent).toBe(hostile);
  });
});

describe('noSignIn', () => {
  it('is a SignInStep', () => {
    const step: SignInStep = noSignIn;
    expect(typeof step).toBe('function');
  });

  it.each([
    ['a lone job', null],
    ['a group job', 'group-1'],
  ])('throws the frozen text, as an ExtrasError, for oneShotLogin true on %s', (_name, groupId) => {
    const job = makeJob({ oneShotLogin: true, groupId });
    expect(() => noSignIn(job)).toThrow(ExtrasError);
    try {
      noSignIn(job);
    } catch (e) {
      expect(e).toBeInstanceOf(ExtrasError);
      expect((e as ExtrasError).reason).toBe(COOKIES_GONE);
    }
  });

  it('throws although both headers are set, and although none is', () => {
    for (const [, referer, userAgent] of COMBOS) {
      expect(() => noSignIn(makeJob({ oneShotLogin: true, referer, userAgent }))).toThrow(ExtrasError);
    }
  });

  it.each([
    ['a lone job', null],
    ['a group job', 'group-1'],
  ])('returns null for oneShotLogin false on %s', (_name, groupId) => {
    expect(noSignIn(makeJob({ oneShotLogin: false, groupId }))).toBeNull();
  });

  it('returns null (not undefined) for oneShotLogin false whatever the headers are', () => {
    for (const [, referer, userAgent] of COMBOS) {
      const result = noSignIn(makeJob({ oneShotLogin: false, referer, userAgent }));
      expect(result).toBeNull();
      expect(result).not.toBeUndefined();
    }
  });
});

describe('composeExtras with noSignIn', () => {
  const extrasFor = composeExtras(noSignIn);

  it('returns a function of the job', () => {
    expect(typeof extrasFor).toBe('function');
  });

  it('gives null when the referer, the User-Agent and the cookies are all null', () => {
    const result = extrasFor(makeJob({ referer: null, userAgent: null }));
    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });

  it('gives the object with cookies null when one header is set, and for both', () => {
    expect(extrasFor(makeJob({ referer: REFERER, userAgent: null }))).toStrictEqual({ referer: REFERER, userAgent: null, cookies: null });
    expect(extrasFor(makeJob({ referer: null, userAgent: UA }))).toStrictEqual({ referer: null, userAgent: UA, cookies: null });
    expect(extrasFor(makeJob({ referer: REFERER, userAgent: UA }))).toStrictEqual({ referer: REFERER, userAgent: UA, cookies: null });
  });

  it('gives exactly the three RunExtras fields: referer, userAgent and cookies', () => {
    const result = extrasFor(makeJob({ referer: REFERER, userAgent: UA }));
    expect(Object.keys(result ?? {}).sort()).toEqual(['cookies', 'referer', 'userAgent']);
  });

  it('throws for oneShotLogin true although both headers are set, and with no header', () => {
    for (const groupId of [null, 'g1']) {
      for (const [, referer, userAgent] of COMBOS) {
        const job = makeJob({ oneShotLogin: true, groupId, referer, userAgent });
        expect(() => extrasFor(job)).toThrow(ExtrasError);
        try {
          extrasFor(job);
        } catch (e) {
          expect((e as ExtrasError).reason).toBe(COOKIES_GONE);
        }
      }
    }
  });

  it('answers each job by itself: no value of one call reaches the next', () => {
    const a = extrasFor(makeJob({ referer: REFERER, userAgent: UA }));
    const b = extrasFor(makeJob({ referer: null, userAgent: null }));
    const c = extrasFor(makeJob({ referer: 'https://b.example/x', userAgent: null }));
    expect(a).toStrictEqual({ referer: REFERER, userAgent: UA, cookies: null });
    expect(b).toBeNull();
    expect(c).toStrictEqual({ referer: 'https://b.example/x', userAgent: null, cookies: null });
  });

  it('does not change the job', () => {
    const job = Object.freeze(makeJob({ referer: REFERER, userAgent: UA }));
    expect(() => extrasFor(job)).not.toThrow();
  });
});

describe('composeExtras with a step of the test', () => {
  it('gives the step’s source as cookies, beside both headers', () => {
    const step = vi.fn<SignInStep>(() => SOURCE);
    const result = composeExtras(step)(makeJob({ referer: REFERER, userAgent: UA }));
    expect(result).toStrictEqual({ referer: REFERER, userAgent: UA, cookies: SOURCE });
    expect(result?.cookies).toBe(SOURCE);
  });

  it('gives an object, not null, when only the cookies are set', () => {
    const step = vi.fn<SignInStep>(() => SOURCE);
    const result = composeExtras(step)(makeJob({ referer: null, userAgent: null }));
    expect(result).toStrictEqual({ referer: null, userAgent: null, cookies: SOURCE });
  });

  it('gives null when the step gives null and both headers are null', () => {
    expect(composeExtras(() => null)(makeJob({ referer: null, userAgent: null }))).toBeNull();
  });

  it('gives the headers with cookies null when the step gives null', () => {
    expect(composeExtras(() => null)(makeJob({ referer: REFERER, userAgent: null }))).toStrictEqual({
      referer: REFERER,
      userAgent: null,
      cookies: null,
    });
  });

  it('passes a plain Error from the step through unchanged (the same object)', () => {
    const boom = new Error('step broke');
    const extrasFor = composeExtras(() => {
      throw boom;
    });
    let caught: unknown;
    try {
      extrasFor(makeJob({ referer: REFERER, userAgent: UA }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
  });

  it('passes an ExtrasError from the step through unchanged (the same object)', () => {
    const gone = new ExtrasError('gone');
    let caught: unknown;
    try {
      composeExtras(() => {
        throw gone;
      })(makeJob());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(gone);
  });

  it('passes a thrown value that is not an Error through unchanged too', () => {
    const value = { not: 'an error' };
    let caught: unknown = 'nothing was thrown';
    try {
      composeExtras(() => {
        throw value;
      })(makeJob());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(value);
  });

  it('calls the step exactly once per call, with the job', () => {
    const step = vi.fn<SignInStep>(() => null);
    const extrasFor = composeExtras(step);
    const first = makeJob({ referer: REFERER });
    const second = makeJob({ userAgent: UA });
    extrasFor(first);
    expect(step).toHaveBeenCalledTimes(1);
    expect(step).toHaveBeenLastCalledWith(first);
    extrasFor(second);
    expect(step).toHaveBeenCalledTimes(2);
    expect(step).toHaveBeenLastCalledWith(second);
  });

  it('calls the step once even when both headers are null and the cookies are null', () => {
    const step = vi.fn<SignInStep>(() => null);
    composeExtras(step)(makeJob({ referer: null, userAgent: null }));
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('calls the step before it reads the headers', () => {
    const events: string[] = [];
    const { job } = spyJob({ referer: REFERER, userAgent: UA }, events);
    composeExtras(() => {
      events.push('step');
      return null;
    })(job);
    expect(events[0]).toBe('step');
    expect(events.filter((e) => e === 'step')).toHaveLength(1);
    expect(events.some((e) => e === 'read:referer')).toBe(true);
    expect(events.some((e) => e === 'read:userAgent')).toBe(true);
  });

  it('does not read the headers when the step throws (headersFor is not called)', () => {
    const events: string[] = [];
    const { job } = spyJob({ referer: REFERER, userAgent: UA }, events);
    expect(() =>
      composeExtras(() => {
        events.push('step');
        throw new ExtrasError('gone');
      })(job),
    ).toThrow(ExtrasError);
    expect(events).toEqual(['step']);
  });

  it('does not read the headers when noSignIn throws either', () => {
    const { job, reads } = spyJob({ oneShotLogin: true, referer: REFERER, userAgent: UA });
    expect(() => composeExtras(noSignIn)(job)).toThrow(ExtrasError);
    expect(reads()).not.toContain('referer');
    expect(reads()).not.toContain('userAgent');
  });

  it('is still correct for oneShotLogin true when the step does not throw (the guard belongs to the step)', () => {
    const step = vi.fn<SignInStep>(() => SOURCE);
    const job = makeJob({ oneShotLogin: true, referer: REFERER, userAgent: UA });
    expect(composeExtras(step)(job)).toStrictEqual({ referer: REFERER, userAgent: UA, cookies: SOURCE });
  });
});
