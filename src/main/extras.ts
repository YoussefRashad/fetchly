import type { Job } from '../shared/types';
import { ExtrasError, type CookieSource, type RunExtras } from './engines/engine';
import type { ProbeHeaders } from './probe';

/** The frozen text for a job whose one-run sign-in is gone (plan 3.4, DV9). */
const SIGN_IN_NOT_KEPT = 'the sign-in sent with this link was not kept; send it again from the browser';

/**
 * Supplies the sign-in of one start: a cookie source, or null for none. May throw ExtrasError, whose reason fails the
 * job. A3 passes noSignIn; A5 replaces it with its own step, and A6 wraps A5's.
 */
export type SignInStep = (job: Job) => CookieSource | null;

/** The two stored headers of a job. Pure; never throws; never reads `oneShotLogin`. */
export function headersFor(job: Job): ProbeHeaders {
  return { referer: job.referer, userAgent: job.userAgent };
}

/** A3's sign-in step: A3 holds no cookies, so a job stored with `oneShotLogin: true` cannot start. */
export const noSignIn: SignInStep = (job) => {
  if (job.oneShotLogin) throw new ExtrasError(SIGN_IN_NOT_KEPT);
  return null;
};

/**
 * Builds `QueueDeps.extrasFor`. The step runs first, and a throw passes through unchanged before any header is read.
 * Returns null when the referer, the User-Agent and the cookies are all null; otherwise the three as one RunExtras.
 */
export function composeExtras(signIn: SignInStep): (job: Job) => RunExtras | null {
  return (job) => {
    const cookies = signIn(job);
    const { referer, userAgent } = headersFor(job);
    if (referer === null && userAgent === null && cookies === null) return null;
    return { referer, userAgent, cookies };
  };
}
