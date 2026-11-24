/**
 * The popup's wire types (R2-3: messages.ts imports them from here) and a pure function from a worker reply
 * to what the popup shows. Popup-side: it imports nothing that knows a request or a secret.
 */
import type { Strings } from './strings';

/**
 * Every popup state. The worker never replies `interrupted`; only the popup sets it, after 30 s.
 * `operationRunning` is replied only to a pair or an unpair (amendment 2, AM2-1: the AM-5 gate).
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

/**
 * E8d: what the worker replies. R2-1: `paired` means "a record is stored after this operation"; AM-2: it comes
 * from a final store read, and is false when that read fails (storageBlocked).
 */
export interface Reply {
  state: State;
  paired: boolean;
  appVersion?: string;
  note?: 'unpairedLocalOnly';
}

/** E8d: the three popup messages, with their exact key sets. */
export type PopupMessage =
  | { type: 'fetchly:status' }
  | { type: 'fetchly:pair'; pairingString: string; label: string }
  | { type: 'fetchly:unpair' };

export interface View {
  title: string;
  hint: string;
  showForm: boolean;
  showUnpair: boolean;
}

/** States that ask for a (retyped) pairing code. */
const FORM_STATES: readonly State[] = ['notPaired', 'badInput', 'wrongCode', 'pairingClosed'];

export function viewOf(reply: Reply, t: Strings): View {
  let hint = '';
  if (reply.note === 'unpairedLocalOnly') hint = t.unpairedLocalOnly;
  else if (reply.state === 'notPaired') hint = t.notPairedHint;
  else if (reply.state === 'appNotRunning') hint = t.appNotRunningHint;
  return {
    title: t[reply.state],
    hint,
    showForm: FORM_STATES.includes(reply.state),
    // R2-1: Unpair whenever a record is stored, also in the E10 row.
    showUnpair: reply.paired,
  };
}
