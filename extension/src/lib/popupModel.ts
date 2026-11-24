/**
 * The popup's state machine (E12). Pure: the message channel, the timers and the renderer are injected.
 *
 * Each request gets the next sequence number; a reply, a failure or a timer of an older request is ignored.
 * At 5 s of waiting Check again and Pair again show while the wait goes on; at 30 s, or on a failed send or
 * an empty reply, the popup shows `interrupted`. There is no automatic retry.
 *
 * Amendment 2 (AM2-2), budgets: the 30 s applies per message, and starts again for the follow-up status after
 * a `checking` reply. The worker's 22 s (status, unpair) and 27 s (pair) are sums of configured I/O waits (store
 * deadlines, fetch timeouts) that assume WebCrypto calls and task scheduling return promptly. A stalled
 * WebCrypto call ends here as `interrupted`. While it, or a stalled callWith inside unpair or inside pair's
 * best-effort unpair, keeps the worker's gate shut, later pairs and unpairs answer `operationRunning` until the
 * worker restarts.
 */
import type { PopupMessage, Reply, State } from './view';

export interface ModelState {
  seq: number;
  reply: Reply;
  showCheckAgain: boolean;
  showPairAgain: boolean;
  formOpen: boolean;
}

export interface PopupModel {
  open(): void;
  checkAgain(): void;
  pairAgain(): void;
  submit(pairingString: string, label: string): void;
  unpair(): void;
  state(): ModelState;
}

export interface PopupModelDeps {
  send(msg: PopupMessage): Promise<unknown>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onChange(state: ModelState): void;
}

/** Plan section 9: "Checking…" before Check again is offered. */
const OFFER_MS = 5000;
/** Plan section 9: the popup gives up waiting for the worker. */
const GIVE_UP_MS = 30_000;

const STATES: readonly State[] = [
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

const interrupted = (): Reply => ({ state: 'interrupted', paired: false });

/** A copy of a well-formed reply with only the known keys; null for anything else. */
function readReply(v: unknown): Reply | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const state = r['state'];
  if (typeof state !== 'string' || !(STATES as readonly string[]).includes(state)) return null;
  if (typeof r['paired'] !== 'boolean') return null;
  const out: Reply = { state: state as State, paired: r['paired'] };
  if (typeof r['appVersion'] === 'string') out.appVersion = r['appVersion'];
  if (r['note'] === 'unpairedLocalOnly') out.note = 'unpairedLocalOnly';
  return out;
}

export function createPopupModel(deps: PopupModelDeps): PopupModel {
  let current: ModelState = { seq: 0, reply: { state: 'checking', paired: false }, showCheckAgain: false, showPairAgain: false, formOpen: false };
  /** The sequence number of the request still waiting for its answer; 0 when none waits. */
  let waiting = 0;
  let timers: unknown[] = [];

  const snapshot = (): ModelState => ({ ...current, reply: { ...current.reply } });
  const emit = (): void => deps.onChange(snapshot());
  const stopTimers = (): void => {
    for (const t of timers) deps.clearTimer(t);
    timers = [];
  };

  const settle = (reply: Reply): void => {
    stopTimers();
    waiting = 0;
    current = { ...current, reply, showCheckAgain: true, showPairAgain: true };
    emit();
  };

  function request(msg: PopupMessage): void {
    stopTimers();
    const seq = current.seq + 1;
    waiting = seq;
    current = { ...current, seq, reply: { state: 'checking', paired: false }, showCheckAgain: false, showPairAgain: false };
    timers = [
      deps.setTimer(() => {
        if (waiting !== seq) return;
        current = { ...current, showCheckAgain: true, showPairAgain: true };
        emit();
      }, OFFER_MS),
      deps.setTimer(() => {
        if (waiting === seq) settle(interrupted());
      }, GIVE_UP_MS),
    ];
    emit();
    let sent: Promise<unknown>;
    try {
      sent = deps.send(msg);
    } catch (e) {
      sent = Promise.reject(e instanceof Error ? e : new Error('send failed'));
    }
    sent.then(
      (value) => {
        if (waiting !== seq) return;
        const reply = readReply(value);
        if (reply === null) settle(interrupted());
        // AM-2: `checking` to a pair or an unpair means "ask for the status now". To a status it settles (no retry).
        // Amendment 2 (AM2-1): every other state settles at once, `operationRunning` included: no follow-up status.
        else if (msg.type !== 'fetchly:status' && reply.state === 'checking') request({ type: 'fetchly:status' });
        else settle(reply);
      },
      () => {
        if (waiting === seq) settle(interrupted());
      },
    );
  }

  return {
    open: () => request({ type: 'fetchly:status' }),
    checkAgain: () => request({ type: 'fetchly:status' }),
    pairAgain: () => {
      current = { ...current, formOpen: true };
      emit();
    },
    submit: (pairingString, label) => {
      current = { ...current, formOpen: false };
      request({ type: 'fetchly:pair', pairingString, label });
    },
    unpair: () => request({ type: 'fetchly:unpair' }),
    state: snapshot,
  };
}
