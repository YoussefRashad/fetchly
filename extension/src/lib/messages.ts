/**
 * The service worker's popup handlers (E8d, E10, E12, E13, N1; R2-1, R2-6, R2-8; AM-1, AM-2, AM-3, AM-5). Three
 * message types, from the extension's own popup only: fetchly:status {}, fetchly:pair { pairingString, label },
 * fetchly:unpair {}. A reply is { state, paired, appVersion?, note? }: it never carries the token, the pairingId
 * or the port.
 *
 * AM-2: `paired` comes from a final store.read() that starts after the handler's last store mutation and last
 * fetch; nothing is awaited between that read and the reply. If it fails the reply is storageBlocked, paired
 * false. AM-5: a pair or unpair that arrives while one runs is not run and not queued (the gate); it answers
 * operationRunning, with `paired` from one store.read() (amendment 2, AM2-1). A status is never gated.
 *
 * Amendment 2 (AM2-2), budgets are conditional:
 * 1. AM-5's 22 s (status, unpair) and 27 s (pair) are sums of configured I/O waits: store deadlines and fetch
 *    timeouts. They assume WebCrypto calls and task scheduling return promptly; the proof check awaits
 *    `subtle` with no timer.
 * 2. The popup's 30 s applies per message. It starts again for the follow-up status after a `checking` reply.
 * 3. A stalled WebCrypto call ends in the popup as `interrupted`. It, or a stalled callWith inside unpair or
 *    inside pair's best-effort unpair, keeps the gate shut: later pairs and unpairs answer operationRunning
 *    until the worker restarts. No token is sent in that state.
 */
import { PROTOCOL } from '../../../src/shared/protocol';
import type { CallResult, Client, Credentials } from './client';
import { browserName, isAppVersion, makeLabel, normalizePairingString, type NavigatorLike } from './pairingInput';
import type { PairingRecord, Store } from './store';
import type { Reply, State } from './view';

type Listener = (message: unknown, sender: unknown, sendResponse: (reply?: unknown) => void) => boolean;

export interface RuntimeLike {
  readonly id: string;
  getURL(path: string): string;
  onMessage: { addListener(listener: Listener): void };
}

export interface HandlerDeps {
  runtime: RuntimeLike;
  client: Pick<Client, 'call' | 'callWith' | 'pair'>;
  store: Pick<Store, 'read' | 'write' | 'removeIf'>;
  nav: NavigatorLike;
}

/** The longest pairingString or label accepted; longer ones answer badInput (N6). */
const FIELD_MAX = 64;
const UNPAIR_PATH = '/v1/unpair';
const STATUS_PATH = '/v1/status';
const ENGINES: readonly unknown[] = ['notInstalled', 'starting', 'ready', 'error'];

type Message = { type: 'status' } | { type: 'unpair' } | { type: 'pair'; pairingString: string; label: string };

/** The reply, and work that runs only after it was sent (E13). */
interface Outcome {
  reply: Reply;
  after?: () => Promise<void>;
}

const done = (reply: Reply): Outcome => ({ reply });
/** AM-2: the store could not be read, so whether a record is stored is not known. */
const blocked = (): Outcome => done({ state: 'storageBlocked', paired: false });

/** E8d: own keys exactly; a key on the prototype does not count. */
function parseMessage(m: unknown): Message | null {
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  const keys = Object.keys(o);
  const type = Object.hasOwn(o, 'type') ? o['type'] : undefined;
  if (type === 'fetchly:status' && keys.length === 1) return { type: 'status' };
  if (type === 'fetchly:unpair' && keys.length === 1) return { type: 'unpair' };
  if (type === 'fetchly:pair' && keys.length === 3 && Object.hasOwn(o, 'pairingString') && Object.hasOwn(o, 'label')) {
    const { pairingString, label } = o;
    if (typeof pairingString === 'string' && typeof label === 'string') return { type: 'pair', pairingString, label };
  }
  return null;
}

/** E11: exactly { app: 'fetchly', protocol: 1, appVersion, engine }. */
function isStatusBody(v: Record<string, unknown>): v is { app: 'fetchly'; protocol: 1; appVersion: string; engine: string } {
  const keys = Object.keys(v);
  return (
    keys.length === 4 &&
    ['app', 'protocol', 'appVersion', 'engine'].every((k) => Object.hasOwn(v, k)) &&
    v['app'] === 'fetchly' &&
    v['protocol'] === PROTOCOL &&
    isAppVersion(v['appVersion']) &&
    ENGINES.includes(v['engine'])
  );
}

/** E8f: the answers on which `call` ran removeIf (whatever that removeIf answered, AM-1). */
function isRemoval(r: CallResult): boolean {
  return r.ok === false && r.kind === 'refused' && ((r.status === 401 && r.token === 'bad_token') || (r.status === 403 && r.token === 'bad_origin'));
}

/** The frozen section 5 row of a status result, for a record that is still stored (AM-2 row 5). */
function statusRow(r: Exclude<CallResult, { ok: true }>): Reply {
  switch (r.kind) {
    case 'not_paired':
    case 'storage_blocked':
      // Not reachable here: AM-2 rows 1 and 3 answer these first.
      return { state: 'checking', paired: true };
    case 'app_not_running':
      return { state: 'appNotRunning', paired: true };
    case 'wrong_program':
      return { state: 'wrongProgram', paired: true };
    case 'unpaired':
      // E10: an unauthenticated 404 deletes nothing; the form and Unpair both show (R2-1).
      return { state: 'notPaired', paired: true };
    case 'stale_proof':
      return { state: 'slow', paired: true };
    case 'too_large_local':
      // Not reachable: the status body is {}. Nothing was sent and the record is kept.
      return { state: 'mismatch', paired: true };
    case 'wrong_shape':
      // AM-4: a right proof, then a 200 whose JSON is not an object: a protocol disagreement.
      return { state: 'mismatch', paired: true };
    case 'refused':
      // Told apart from 429 busy by the token, never by the status alone.
      if (r.status === 429 && r.token === 'rate_limited') return { state: 'rateLimited', paired: true };
      if (r.status >= 500 && r.status <= 599) return { state: 'appError', paired: true };
      // AM-4: a right proof, then a 200 that is not JSON.
      if (r.status === 200) return { state: 'appError', paired: true };
      // R2-3: 400, 403 bad_host, 404, 405, 415, 413, 429 busy, status 0 and any other status.
      return { state: 'mismatch', paired: true };
  }
}

export function registerHandlers(deps: HandlerDeps): void {
  const { runtime, client, store, nav } = deps;

  /**
   * E13: the record a confirmed pair replaced, kept in memory only. AM-3: it changes only on a confirmed pair;
   * Unpair, the E8f removal and a null final read drop it.
   */
  let held: PairingRecord | null = null;
  /** AM-2: incremented just before store.write in pair and just before store.removeIf in unpair. */
  let gen = 0;
  /** AM-5: true while a pair or an unpair runs. */
  let running = false;

  /**
   * AM-5: run `job` when nothing else runs; otherwise answer operationRunning (amendment 2) from one read,
   * sending and mutating nothing.
   */
  async function gated(job: () => Promise<Outcome>): Promise<Outcome> {
    if (running) {
      const r = await store.read();
      if (!r.ok) return blocked();
      // AM-2/AM-3: this one read is the final read, so a null read drops held.
      if (r.value === null) held = null;
      // Amendment 2 (AM2-1): the gate's own state, not `checking`; the popup settles on it with no follow-up status.
      return done({ state: 'operationRunning', paired: r.value !== null });
    }
    running = true;
    try {
      return await job();
    } finally {
      running = false;
    }
  }

  /** E8d: the extension's own popup, by id and exact URL, and not a tab (a content script or a page). */
  function fromPopup(sender: unknown): boolean {
    if (typeof sender !== 'object' || sender === null) return false;
    const s = sender as Record<string, unknown>;
    return s['id'] === runtime.id && s['url'] === runtime.getURL('popup.html') && s['tab'] === undefined;
  }

  /** Best effort, one attempt: its result changes nothing. */
  async function unpairQuietly(cred: Credentials): Promise<void> {
    try {
      await client.callWith(cred, UNPAIR_PATH, {});
    } catch {
      // Best effort only.
    }
  }

  /** AM-2: the reply `state` with `paired` from a final read; a null read drops `held`. */
  async function withFinalRead(state: State): Promise<Outcome> {
    const fin = await store.read();
    if (!fin.ok) return blocked();
    if (fin.value === null) held = null;
    return done({ state, paired: fin.value !== null });
  }

  async function status(): Promise<Outcome> {
    const g0 = gen;
    const heldAtStart = held;
    const r = await client.call(STATUS_PATH, {});
    // AM-2 row 1: the first read failed and nothing was sent: that is the answer, with no second read.
    if (!r.ok && r.kind === 'storage_blocked') return blocked();
    const fin = await store.read();
    if (!fin.ok) return blocked();
    if (fin.value === null) {
      // Row 2: an obsolete connected is discarded; no E13 cleanup.
      held = null;
      return done({ state: 'notPaired', paired: false });
    }
    // Row 3: the result is obsolete ("ask for the status now"); no E13 cleanup.
    if (gen !== g0 || (!r.ok && r.kind === 'not_paired')) return done({ state: 'checking', paired: true });
    if (!r.ok) {
      if (isRemoval(r)) {
        // Row 4: the E8f removal did not happen (the record is still stored); the next status tries it again.
        held = null;
        return done({ state: 'notPaired', paired: true });
      }
      return done(statusRow(r));
    }
    // Row 5.
    if (!isStatusBody(r.value)) return done({ state: 'mismatch', paired: true });
    const reply: Reply = { state: 'connected', paired: true, appVersion: r.value.appVersion };
    // E13: only a status that ends connected unpairs the replaced record, once, after the reply; and only if
    // nothing dropped or replaced it since the start (R2-8, AM-3).
    const old = held;
    if (old !== null && old === heldAtStart) {
      held = null;
      return { reply, after: () => unpairQuietly(old) };
    }
    return done(reply);
  }

  async function pair(pairingString: string, labelField: string): Promise<Outcome> {
    const parsed = pairingString.length <= FIELD_MAX && labelField.length <= FIELD_MAX ? normalizePairingString(pairingString) : null;
    if (parsed === null) {
      // Nothing is sent or mutated: this one read is the final read (R2-1, AM-2).
      const r = await store.read();
      if (!r.ok) return blocked();
      // AM-2/AM-3: a null final read drops held.
      if (r.value === null) held = null;
      return done({ state: 'badInput', paired: r.value !== null });
    }
    // N32: fail closed. The store must be readable before anything is sent.
    const old = await store.read();
    if (!old.ok) return blocked();
    const label = makeLabel(labelField, browserName(nav));
    // The port is the pairing string's, never a stored one (N27).
    const res = await client.pair(parsed.port, parsed.code, label);
    if (res.ok) {
      const record: PairingRecord = {
        v: 1,
        pairingId: res.pairingId,
        token: res.token,
        port: parsed.port,
        appVersion: res.appVersion,
        label,
        pairedAt: Date.now(),
      };
      // AM-3: the record this pair replaces; null when it replaced none or the same pairingId.
      const replaced = old.value !== null && old.value.pairingId !== record.pairingId ? old.value : null;
      gen += 1;
      const written = await store.write(record);
      if (written.ok) {
        // E13: no unpair of the replaced record now; AM-3: the confirmed pair sets held. Amendment 2 (AM2-3
        // rule 5): `ok` is always a real oncomplete with the write done, so held is set before the final read,
        // also when that read fails.
        held = replaced;
        return withFinalRead('checking');
      }
      if (written.kind === 'storage_unknown') {
        // AM-1: the write may have committed, so no unpair with the new credentials; the final read decides.
        const fin = await store.read();
        if (!fin.ok) return blocked();
        if (fin.value !== null && fin.value.pairingId === record.pairingId) {
          held = replaced;
          return done({ state: 'checking', paired: true });
        }
        if (fin.value === null) held = null;
        return done({ state: 'storageFailed', paired: fin.value !== null });
      }
      // storage_failed, a confirmed no-mutation (amendment 2, AM2-3 rule 1): the app holds a pairing nobody can
      // use. One best-effort unpair with the new credentials, then the reply; held is untouched (AM-3).
      await unpairQuietly(record);
      return withFinalRead('storageFailed');
    }
    switch (res.kind) {
      case 'mismatch':
        // E11: valid credentials in an answer of another shape: unpair them, store nothing.
        await unpairQuietly({ pairingId: res.pairingId, token: res.token, port: parsed.port });
        return withFinalRead('mismatch');
      case 'refused':
        if (res.token === 'bad_code') return withFinalRead('wrongCode');
        if (res.token === 'pairing_closed') return withFinalRead('pairingClosed');
        if (res.token === 'bad_request') return withFinalRead('mismatch');
        return withFinalRead('wrongProgram');
      case 'app_not_running':
        return withFinalRead('appNotRunning');
      case 'wrong_program':
        return withFinalRead('wrongProgram');
    }
  }

  async function unpair(): Promise<Outcome> {
    // R2-8: whatever happens next, the held record is never contacted.
    held = null;
    const r = await store.read();
    if (!r.ok) return blocked();
    // Nothing was sent or mutated: this read is the final read (AM-2).
    if (r.value === null) return done({ state: 'notPaired', paired: false });
    const rec = r.value;
    const res = await client.callWith(rec, UNPAIR_PATH, {});
    // A1 §8: the local record goes whatever the answer; removeIf keeps a record a newer pairing wrote.
    gen += 1;
    // AM-1: storage_failed and storage_unknown alike: the final read decides.
    await store.removeIf(rec.pairingId);
    const fin = await store.read();
    if (!fin.ok) return blocked();
    if (fin.value === null) return done(res.ok ? { state: 'notPaired', paired: false } : { state: 'notPaired', paired: false, note: 'unpairedLocalOnly' });
    // R2-6: the removal did not happen.
    if (fin.value.pairingId === rec.pairingId) return done({ state: 'storageFailed', paired: true });
    // A newer pairing is stored: "ask for the status now".
    return done({ state: 'checking', paired: true });
  }

  function handle(m: Message): Promise<Outcome> {
    if (m.type === 'status') return status();
    if (m.type === 'pair') return gated(() => pair(m.pairingString, m.label));
    return gated(unpair);
  }

  runtime.onMessage.addListener((message, sender, sendResponse) => {
    // A refused message gets no reply and causes no work.
    if (!fromPopup(sender)) return false;
    const m = parseMessage(message);
    if (m === null) return false;
    void handle(m)
      .then(async (outcome) => {
        try {
          sendResponse(outcome.reply);
        } catch {
          // The popup is gone; the work is done either way.
        }
        if (outcome.after) await outcome.after();
      })
      // An unexpected throw sends no reply and no error text; the popup then shows `interrupted`.
      .catch(() => undefined);
    return true;
  });
}
