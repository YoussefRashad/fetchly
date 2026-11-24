/**
 * Shared fixtures and the TEST CONTRACT of the A2 specs (tests/extension/**, tests/fakes/fake-chrome.ts).
 *
 * The frozen A2 plan names the modules and most of their members, but not every signature. The specs fix the
 * shapes below; the implementation must match them (the implement lane may not edit the specs). Everything
 * else is as the plan says. Places where the plan is silent and a shape was chosen are marked CHOSEN.
 *
 *   extension/src/lib/pairingInput.ts
 *     normalizePairingString(input: unknown): { port: number; code: string } | null        E2; null = badInput
 *     makeLabel(input: string, fallback: string): string                                    E3
 *     browserName(nav: { userAgent: string; userAgentData?: { brands: readonly { brand: string }[] } }): string   E3  CHOSEN: one navigator-shaped argument
 *     isAppVersion(v: unknown): v is string                                                 E11
 *   extension/src/lib/strings.ts
 *     EN, AR: the 27 keys of plan section 5 and amendment 2 (see strings.test.ts); pick(locale: string | undefined): typeof EN
 *   extension/src/lib/store.ts
 *     type PairingRecord = { v: 1; pairingId; token; port; appVersion; label; pairedAt }
 *     createStore({ idb, setTimer, clearTimer }): Store     idb is the factory { open(name, version) } or undefined
 *     Store = { read(): R<PairingRecord | null>; write(record): R<unknown>; removeIf(pairingId): R<unknown>; clear(): R<unknown> }
 *     R<T> = { ok: true; value: T } | { ok: false; kind: 'storage_blocked' | 'storage_failed' }     CHOSEN: `kind`, like CallResult
 *     "reads as none" is { ok: true, value: null }                                          CHOSEN
 *     Amendment 1 (AM-1): `write`, `removeIf` and `clear` answer
 *       { ok: true; value } | { ok: false; kind: 'storage_blocked' | 'storage_failed' | 'storage_unknown' }; `read` is unchanged.
 *     Amendment 2 (AM2-3): `storage_failed` means a confirmed no-mutation: transaction() threw, onabort fired, an abort() call returned,
 *       or `work` threw synchronously (it queued nothing) and oncomplete then fired. The types are unchanged.
 *   extension/src/lib/client.ts
 *     ERROR_TOKENS: Record<ErrorToken, true>
 *     createClient({ fetch, subtle, getRandomValues, now, wallNow, setTimer, clearTimer, store, limits }): Client
 *     Client = { call(path, body): Promise<CallResult>; callWith(record, path, body): Promise<CallResult>; pair(port, code, label): Promise<PairResult> }
 *     CallResult: plan section 4, plus (Amendment 1, AM-4) { ok: false; kind: 'wrong_shape' }.
 *     PairResult = { ok: true; pairingId; token; appVersion }
 *                | { ok: false; kind: 'wrong_program' | 'app_not_running' }
 *                | { ok: false; kind: 'mismatch'; pairingId; token }
 *                | { ok: false; kind: 'refused'; status: number; token: ErrorToken }     CHOSEN: bad_code, pairing_closed and
 *                                                                                         bad_request "returned as tokens" take the
 *                                                                                         shape of CallResult's `refused`
 *   extension/src/lib/view.ts
 *     viewOf(reply: Reply, t: typeof EN): { title: string; hint: string; showForm: boolean; showUnpair: boolean }     CHOSEN name
 *     Reply = { state: State; paired: boolean; appVersion?: string; note?: 'unpairedLocalOnly' }
 *   extension/src/lib/popupModel.ts                                                                                    CHOSEN API
 *     createPopupModel({ send(msg): Promise<unknown>; setTimer; clearTimer; onChange(state): void }): PopupModel
 *     PopupModel = { open(); checkAgain(); pairAgain(); submit(pairingString, label); unpair(); state(): ModelState }
 *     ModelState = { seq: number; reply: Reply; showCheckAgain: boolean; showPairAgain: boolean; formOpen: boolean }
 *   extension/src/lib/messages.ts                                                                                      CHOSEN name
 *     registerHandlers({ runtime, client, store, nav }): void     adds one listener to runtime.onMessage
 *     runtime = { id, getURL(path), onMessage: { addListener(l) } }
 *
 * Reply.state is one of: checking, notPaired, appNotRunning, wrongProgram, connected, rateLimited, appError,
 * mismatch, slow, storageBlocked, storageFailed, interrupted, badInput, wrongCode, pairingClosed and (amendment 2)
 * operationRunning. The worker never replies `interrupted` (only the popup does, after 30 s). The only note is
 * 'unpairedLocalOnly'.
 *
 * Amendment 1 changes nothing else here: `Reply`, `State`, `PairResult`, the `createClient` deps, the
 * `registerHandlers` deps, the popup model API and `viewOf` are as above. A `checking` reply has the AM-2
 * meaning: "ask for the status now".
 *
 * Amendment 2 (docs/plans/2026-11-23-phase2-a2-amendment-2.md) adds the 16th `State`, `operationRunning`, and the 27th string key of
 * the same name. The worker replies it only to `fetchly:pair` and `fetchly:unpair` that arrive while a pair or an unpair runs (the
 * AM-5 gate), with `paired` from that gate's one read. `checking` keeps the AM-2 meaning; the gate no longer gives it. The `Reply`
 * shape, `viewOf`'s signature and the popup model API are unchanged.
 */
export type State =
  | 'checking'
  | 'notPaired'
  | 'appNotRunning'
  | 'wrongProgram'
  | 'connected'
  | 'rateLimited'
  | 'appError'
  | 'mismatch'
  | 'slow'
  | 'storageBlocked'
  | 'storageFailed'
  | 'interrupted'
  | 'badInput'
  | 'wrongCode'
  | 'pairingClosed'
  | 'operationRunning';

/** Every popup state, in the order of plan section 5 and the pair results; amendment 2 adds `operationRunning` last. */
export const ALL_STATES: readonly State[] = [
  'checking',
  'notPaired',
  'appNotRunning',
  'wrongProgram',
  'connected',
  'rateLimited',
  'appError',
  'mismatch',
  'slow',
  'storageBlocked',
  'storageFailed',
  'interrupted',
  'badInput',
  'wrongCode',
  'pairingClosed',
  'operationRunning',
];

export interface Reply {
  state: State;
  paired: boolean;
  appVersion?: string;
  note?: 'unpairedLocalOnly';
}

export interface Rec {
  v: 1;
  pairingId: string;
  token: string;
  port: number;
  appVersion: string;
  label: string;
  pairedAt: number;
}

/** The secrets of the secrecy specs: a marker token (43 characters) and a marker pairingId (22). */
export const PORT = 38917;
export const TOKEN = `TOKENMARKER_${'abcdefghijklmnopqrstuvwxyz0123456789'.slice(0, 31)}`;
export const PAIRING_ID = 'PAIRIDMARKER_0123456789'.slice(0, 22);
export const TOKEN_B = `TOKENMARKER_B${'abcdefghijklmnopqrstuvwxyz0123456789'.slice(0, 30)}`;
export const PAIRING_ID_B = 'PAIRIDMARKER_B_012345678'.slice(0, 22);
export const PORT_B = 40123;
export const MARKERS = ['TOKENMARKER', 'PAIRIDMARKER'];

export function makeRecord(over: Partial<Rec> = {}): Rec {
  return { v: 1, pairingId: PAIRING_ID, token: TOKEN, port: PORT, appVersion: '0.1.0', label: 'Edge', pairedAt: 1_700_000_000_000, ...over };
}

/** A second, different record on another port. */
export function makeRecordB(over: Partial<Rec> = {}): Rec {
  return makeRecord({ pairingId: PAIRING_ID_B, token: TOKEN_B, port: PORT_B, label: 'Chrome', ...over });
}

export const NAV_EDGE = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36 Edg/158.0.4370.33',
  userAgentData: {
    brands: [
      { brand: 'Not.A/Brand', version: '99' },
      { brand: 'Chromium', version: '158' },
      { brand: 'Microsoft Edge', version: '158' },
    ],
  },
};

export const NAV_CHROME = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36',
  userAgentData: {
    brands: [
      { brand: 'Not.A/Brand', version: '99' },
      { brand: 'Chromium', version: '158' },
      { brand: 'Google Chrome', version: '158' },
    ],
  },
};

/** What /v1/status answers when all is well. */
export function statusBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { app: 'fetchly', protocol: 1, appVersion: '0.1.0', engine: 'ready', ...over };
}

/** A JSON object whose JSON.stringify is exactly `n` UTF-8 bytes, made of 3-byte characters so that the
 *  number of UTF-16 units is far below the number of bytes. */
export function bodyOfBytes(n: number): { pad: string } {
  const overhead = Buffer.byteLength(JSON.stringify({ pad: '' }), 'utf8');
  const room = n - overhead;
  if (room < 0) throw new Error('too small');
  const euros = Math.floor(room / 3);
  const rest = room - euros * 3;
  const body = { pad: '€'.repeat(euros) + 'a'.repeat(rest) };
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') !== n) throw new Error('bodyOfBytes is off');
  return body;
}

/** Every string a reply, error or key may not contain: the markers, the full secrets and the port. */
export function secretsOf(...records: Rec[]): string[] {
  return [...MARKERS, ...records.flatMap((r) => [r.token, r.pairingId, String(r.port)])];
}
