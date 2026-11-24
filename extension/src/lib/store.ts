/**
 * The pairing record in IndexedDB of the extension origin (E9, N32, DV1). Database `fetchly` v1, store `kv`,
 * key `pairing`. The factory is injected (E1); nothing here names a browser global, and the extension
 * storage API is not used at all (DV1).
 *
 * Every operation opens, runs one readwrite transaction and closes. One 3000 ms deadline covers the open and
 * the transaction: before the open settles it answers storage_blocked, after it the transaction is aborted.
 * A success is given only at the transaction's oncomplete after `work` returned its getter (R2-5). storage_failed
 * is a confirmed no-mutation only (AM-1, amended by amendment 2 AM2-3 rule 1): transaction() threw, onabort
 * fired, an abort() call returned without throwing, or `work` threw synchronously (it returned no getter) and
 * oncomplete then fired. An abort() that throws (the commit has started) waits COMMIT_GRACE_MS for the
 * terminal event; with none, the answer is storage_unknown (storage_failed for read, which never answers
 * storage_unknown).
 */
import { PAIRING_ID_RE, TOKEN_RE, isServerPort } from '../../../src/shared/protocol';
import { isAppVersion, isLabelText } from './pairingInput';

export interface PairingRecord {
  v: 1;
  pairingId: string;
  token: string;
  port: number;
  appVersion: string;
  label: string;
  pairedAt: number;
}

/** A failure of `read`: it never answers storage_unknown (AM-1). */
export type ReadFailure = { ok: false; kind: 'storage_blocked' | 'storage_failed' };
/** AM-1: storage_unknown = the outcome of the commit was not confirmed either way. */
export type StoreFailure = ReadFailure | { ok: false; kind: 'storage_unknown' };
export type StoreResult<T> = { ok: true; value: T } | StoreFailure;
export type ReadResult = { ok: true; value: PairingRecord | null } | ReadFailure;

export interface Store {
  /** The record, or null for none. A record of another shape reads as none and is deleted in the same transaction. */
  read(): Promise<ReadResult>;
  write(record: PairingRecord): Promise<StoreResult<null>>;
  /** Removes the record only when its pairingId equals `pairingId` (N1), in one transaction. */
  removeIf(pairingId: string): Promise<StoreResult<null>>;
  clear(): Promise<StoreResult<null>>;
}

// R2-4: handler properties typed so that the real DOM objects are assignable.
type Handler = ((ev: never) => unknown) | null;

export interface IdbRequestLike {
  readonly result: unknown;
  onsuccess: Handler;
  onerror: Handler;
}
export interface IdbObjectStoreLike {
  get(key: string): IdbRequestLike;
  put(value: unknown, key: string): IdbRequestLike;
  delete(key: string): IdbRequestLike;
}
export interface IdbTransactionLike {
  objectStore(name: string): IdbObjectStoreLike;
  oncomplete: Handler;
  onabort: Handler;
  onerror: Handler;
  abort(): void;
}
export interface IdbDatabaseLike {
  readonly objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
  transaction(storeNames: string, mode: 'readwrite', options: { durability: 'strict' }): IdbTransactionLike;
  close(): void;
  onversionchange: Handler;
}
export interface IdbOpenRequestLike {
  readonly result: IdbDatabaseLike;
  onsuccess: Handler;
  onerror: Handler;
  onblocked: Handler;
  onupgradeneeded: Handler;
}
export interface IdbFactoryLike {
  open(name: string, version: number): IdbOpenRequestLike;
}

export interface StoreDeps {
  /** The IndexedDB factory of the extension origin; undefined when the browser has none. */
  idb: IdbFactoryLike | undefined;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const DB_NAME = 'fetchly';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const KEY = 'pairing';
/** One deadline for the open and the transaction together (plan section 9). */
const DEADLINE_MS = 3000;
/** AM-1: how long a refused abort() waits for oncomplete or onabort. */
const COMMIT_GRACE_MS = 1000;

const BLOCKED: ReadFailure = { ok: false, kind: 'storage_blocked' };
const FAILED: ReadFailure = { ok: false, kind: 'storage_failed' };
const UNKNOWN: StoreFailure = { ok: false, kind: 'storage_unknown' };

const RECORD_KEYS = ['appVersion', 'label', 'pairedAt', 'pairingId', 'port', 'token', 'v'];

/** Strict parse: exactly the seven keys, each valid; anything else is null. */
export function parseRecord(raw: unknown): PairingRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const keys = Object.keys(raw).sort();
  if (keys.length !== RECORD_KEYS.length || keys.some((k, i) => k !== RECORD_KEYS[i])) return null;
  const { v, pairingId, token, port, appVersion, label, pairedAt } = raw as Record<string, unknown>;
  if (v !== 1) return null;
  if (typeof pairingId !== 'string' || !PAIRING_ID_RE.test(pairingId)) return null;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  if (!isServerPort(port)) return null;
  if (!isAppVersion(appVersion)) return null;
  if (!isLabelText(label)) return null;
  if (typeof pairedAt !== 'number' || !Number.isFinite(pairedAt)) return null;
  return { v: 1, pairingId, token, port, appVersion, label, pairedAt };
}

/**
 * The work of one operation, run inside its readwrite transaction. It issues its requests on `kv` and
 * returns a getter for the value, read at oncomplete.
 */
type Work<T> = (kv: IdbObjectStoreLike, abort: () => void) => () => T;

/**
 * How one operation answers when `work` did not finish (AM-1; amendment 2, AM2-3).
 *
 * Invariant (AM2-3 rule 3): `completedWithoutValue` = storage_failed is sound only while each `work` makes one
 * synchronous request call and nothing can throw after it, so a synchronous throw means nothing was queued.
 * An operation whose `work` can issue a request and then throw synchronously must set `completedWithoutValue`
 * to storage_unknown. The field stays per operation for that reason.
 */
interface Outcomes<T, F extends StoreFailure> {
  /** No terminal event within the grace: storage_unknown, or storage_failed for read. */
  unknown: F;
  /**
   * oncomplete after `work` threw before it returned its getter: storage_failed, a confirmed no-mutation
   * (AM2-3 rule 1), for every operation today.
   */
  completedWithoutValue: { ok: true; value: T } | F;
}

export function createStore(deps: StoreDeps): Store {
  function run<T, F extends StoreFailure>(work: Work<T>, outcomes: Outcomes<T, F>): Promise<{ ok: true; value: T } | ReadFailure | F> {
    type Result = { ok: true; value: T } | ReadFailure | F;
    return new Promise<Result>((resolve) => {
      const factory = deps.idb;
      if (factory === undefined) {
        resolve(BLOCKED);
        return;
      }
      let settled = false;
      let db: IdbDatabaseLike | null = null;
      let tx: IdbTransactionLike | null = null;
      let grace: unknown = null;
      /** Inside `work`: a throw there aborts; if abort() itself throws, the deadline still stands. */
      const abortTx = (): void => {
        try {
          tx?.abort();
        } catch {
          // The commit has started or ended: the terminal event or the deadline decides.
        }
      };
      /** AM-1: true when abort() returned, a confirmed rollback. */
      const abortReturned = (): boolean => {
        try {
          tx?.abort();
          return true;
        } catch {
          return false;
        }
      };
      const finish = (result: Result): void => {
        if (settled) return;
        settled = true;
        deps.clearTimer(timer);
        if (grace !== null) deps.clearTimer(grace);
        try {
          db?.close();
        } catch {
          // Closing is best effort; the result stands.
        }
        resolve(result);
      };
      /** AM-1 rules 3 and 4: abort() was refused, so wait COMMIT_GRACE_MS for oncomplete or onabort. */
      const awaitTerminal = (): void => {
        deps.clearTimer(timer);
        grace = deps.setTimer(() => finish(outcomes.unknown), COMMIT_GRACE_MS);
      };
      const timer = deps.setTimer(() => {
        if (tx === null) {
          finish(BLOCKED);
          return;
        }
        if (abortReturned()) finish(FAILED);
        else awaitTerminal();
      }, DEADLINE_MS);

      let request: IdbOpenRequestLike;
      try {
        request = factory.open(DB_NAME, DB_VERSION);
      } catch {
        finish(BLOCKED);
        return;
      }
      request.onupgradeneeded = () => {
        const upgrading = request.result;
        if (!upgrading.objectStoreNames.contains(STORE_NAME)) upgrading.createObjectStore(STORE_NAME);
      };
      // A newer version (VersionError), any open error, or another connection blocking the open: fail closed.
      request.onerror = () => finish(BLOCKED);
      request.onblocked = () => finish(BLOCKED);
      request.onsuccess = () => {
        const opened = request.result;
        if (settled) {
          // A success after the deadline or after onblocked: closed and never used.
          opened.close();
          return;
        }
        db = opened;
        opened.onversionchange = () => opened.close();
        let created: IdbTransactionLike;
        try {
          created = opened.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
        } catch {
          finish(FAILED);
          return;
        }
        tx = created;
        let value: (() => T) | null = null;
        // A terminal event after the answer is ignored by finish (AM-1 rule 5).
        created.oncomplete = () => finish(value === null ? outcomes.completedWithoutValue : { ok: true, value: value() });
        created.onabort = () => finish(FAILED);
        // AM-1: tx.onerror alone answers nothing; the onabort that follows does.
        try {
          value = work(created.objectStore(STORE_NAME), abortTx);
        } catch {
          if (abortReturned()) finish(FAILED);
          else awaitTerminal();
        }
      };
    });
  }

  const forRead: Outcomes<PairingRecord | null, ReadFailure> = { unknown: FAILED, completedWithoutValue: FAILED };
  // AM2-3 rule 2: write (one put), removeIf (one get; the delete is issued later, in onsuccess) and clear (one
  // delete) each queue nothing when `work` throws synchronously.
  const forMutation: Outcomes<null, StoreFailure> = { unknown: UNKNOWN, completedWithoutValue: FAILED };

  /** Runs `next` from a request's success handler; a throw there aborts the transaction. */
  const guarded =
    (abort: () => void, next: () => void): (() => void) =>
    () => {
      try {
        next();
      } catch {
        abort();
      }
    };

  return {
    read: () =>
      run((kv, abort) => {
        let record: PairingRecord | null = null;
        const get = kv.get(KEY);
        get.onsuccess = guarded(abort, () => {
          if (get.result === undefined) return;
          record = parseRecord(get.result);
          // E9: a record of another shape is removed in the same transaction.
          if (record === null) kv.delete(KEY);
        });
        return () => record;
      }, forRead),

    write: (record) =>
      run((kv) => {
        const copy: PairingRecord = {
          v: 1,
          pairingId: record.pairingId,
          token: record.token,
          port: record.port,
          appVersion: record.appVersion,
          label: record.label,
          pairedAt: record.pairedAt,
        };
        kv.put(copy, KEY);
        return () => null;
      }, forMutation),

    removeIf: (pairingId) =>
      run((kv, abort) => {
        const get = kv.get(KEY);
        get.onsuccess = guarded(abort, () => {
          // N1: only the record this pairing wrote; a newer one stays.
          if (parseRecord(get.result)?.pairingId === pairingId) kv.delete(KEY);
        });
        return () => null;
      }, forMutation),

    clear: () =>
      run((kv) => {
        kv.delete(KEY);
        return () => null;
      }, forMutation),
  };
}
