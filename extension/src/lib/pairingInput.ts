/**
 * What the popup's two fields become before anything is sent (E2, E3), and the appVersion rule (E11).
 * Pure; no browser global is named here (E1).
 */
import { BIDI, LABEL_MAX, parsePairingString } from '../../../src/shared/protocol';
import { CONTROL } from '../../../src/shared/text';

/** E11: the longest appVersion A2 accepts, in UTF-16 code units. */
export const APP_VERSION_MAX = 64;

// Global copies built from the shared sources, so every occurrence is removed, not only the first (E3).
const CONTROL_ALL = new RegExp(CONTROL.source, 'gu');
const BIDI_ALL = new RegExp(BIDI.source, 'gu');

/**
 * E2: trimmed; only ASCII a-z upper-cased (so `ſ` and `ı` stay and fail); after the first `-` only,
 * O becomes 0 and I, L become 1. Then the shared parsePairingString. Null means badInput. Never throws.
 */
export function normalizePairingString(input: unknown): { port: number; code: string } | null {
  if (typeof input !== 'string') return null;
  const upper = input.trim().replace(/[a-z]/gu, (c) => c.toUpperCase());
  const dash = upper.indexOf('-');
  if (dash < 0) return null;
  const code = upper.slice(dash + 1).replace(/[OIL]/gu, (c) => (c === 'O' ? '0' : '1'));
  return parsePairingString(upper.slice(0, dash + 1) + code);
}

/**
 * E3: every CONTROL and BIDI code point removed, trimmed, cut to LABEL_MAX UTF-16 units without leaving a
 * lone high surrogate, trimmed again. Empty gives the fallback. The result passes A1's isLabel (S20).
 */
export function makeLabel(input: string, fallback: string): string {
  let s = input.replace(CONTROL_ALL, '').replace(BIDI_ALL, '').trim();
  if (s.length > LABEL_MAX) {
    s = s.slice(0, LABEL_MAX);
    const last = s.charCodeAt(s.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
    s = s.trim();
  }
  return s === '' ? fallback : s;
}

/** The part of a navigator that browserName reads. */
export interface NavigatorLike {
  userAgent: string;
  userAgentData?: { brands: readonly { brand: string }[] } | undefined;
}

/** E3: the label fallback. The brands win; then `Edg/` in the user agent; else Browser. */
export function browserName(nav: NavigatorLike): string {
  const brands = nav.userAgentData?.brands ?? [];
  if (brands.some((b) => b.brand === 'Microsoft Edge')) return 'Edge';
  if (brands.some((b) => b.brand === 'Google Chrome')) return 'Chrome';
  if (nav.userAgent.includes('Edg/')) return 'Edge';
  return 'Browser';
}

/** E11: a non-empty string of at most 64 UTF-16 units with no CONTROL or BIDI character. */
export function isAppVersion(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= APP_VERSION_MAX && !CONTROL.test(v) && !BIDI.test(v);
}

/** A1's S20 label rule, for the stored record: 1 to LABEL_MAX units, no CONTROL, no BIDI. */
export function isLabelText(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= LABEL_MAX && !CONTROL.test(v) && !BIDI.test(v);
}
