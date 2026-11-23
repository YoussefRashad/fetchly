/**
 * A fake IndexedDB for the A2 specs (plan section 4, "Fake"). It models only what store.ts may use:
 *
 *   factory      open(name, version): a request with onupgradeneeded, onsuccess, onerror, onblocked, result, error
 *   database     objectStoreNames.contains, createObjectStore, transaction(name, mode, options), close, onversionchange
 *   transaction  objectStore, oncomplete, onabort, onerror, abort
 *   object store get, put(value, key), delete
 *
 * Events arrive asynchronously (microtasks), after the code under test has set its handlers. A transaction
 * commits when its last request is done and no new one was issued from that request's handler, like the real
 * thing; its writes are applied to the backing map only then, and an abort discards them. Readwrite
 * transactions are not serialised (nothing in A2 needs it, and a restart must not wait for an abandoned one).
 *
 * `backing` is a plain map that several instances can share: a second FakeIdb over the same backing is a
 * restarted worker with the same disk. `log` is the operation log; `sw` holds the switches for every failure
 * of Task 5; `releaseHeld()`, `releaseCommitting()`, `settleOpen()` and `triggerVersionChange()` are the controls.
 *
 * Two ways for a transaction not to finish (Amendment 1, AM-1):
 *   holdAt      stuck BEFORE the commit starts: the transaction is listed in `held`, abort() succeeds (it fires
 *               onabort), releaseHeld() starts the commit.
 *   commitHold  stuck IN the commit (the committing phase): the transaction is listed in `committing`, its writes
 *               are not applied yet, and it can no longer be aborted. abort() throws InvalidStateError and logs
 *               { op: 'abortThrow', tx }; objectStore() and a new request throw too. releaseCommitting('complete')
 *               applies the writes and fires oncomplete; releaseCommitting('abort') discards them and fires
 *               onabort (by: 'fake', named `abortName`). A transaction goes through holdAt first and commitHold
 *               second when both are set. abort() on a finished transaction throws and logs abortThrow as well.
 *
 * Handler properties are typed `((ev: never) => unknown) | null` (R2-4), so the real DOM objects are
 * assignable to the lib's narrow interfaces.
 */
import type { Trace } from './clock';

type Handler = ((ev: never) => unknown) | null;
const fire = (h: Handler, type: string, extra: object = {}): void => {
  if (h) (h as (ev: unknown) => unknown)({ type, ...extra });
};

interface DbData {
  version: number;
  stores: Map<string, Map<string, unknown>>;
}
export interface IdbBacking {
  dbs: Map<string, DbData>;
}
export const newBacking = (): IdbBacking => ({ dbs: new Map() });

export type IdbLogEntry =
  | { op: 'open'; name: string; version: number | undefined }
  | { op: 'createObjectStore'; name: string }
  | { op: 'transaction'; tx: number; stores: unknown; mode: unknown; options: unknown }
  | { op: 'get'; tx: number; store: string; key: unknown }
  | { op: 'put'; tx: number; store: string; key: unknown; value: unknown }
  | { op: 'delete'; tx: number; store: string; key: unknown }
  | { op: 'success'; tx: number; request: 'get' | 'put' | 'delete' }
  | { op: 'complete'; tx: number }
  | { op: 'abort'; tx: number; by: 'client' | 'fake'; name: string }
  | { op: 'abortThrow'; tx: number }
  | { op: 'close' }
  | { op: 'versionchange' };

export interface IdbSwitches {
  /** open() throws. */
  openThrows: boolean;
  /** The open request fails with an error of this name ('VersionError', 'UnknownError', ...). */
  openError: string | null;
  /** The open request fires onblocked and never succeeds. */
  openBlocked: boolean;
  /** The open request settles only when settleOpen() is called (then with a success). */
  openHang: boolean;
  /** transaction() throws. */
  transactionThrows: boolean;
  /** At commit the transaction aborts with `abortName`: always ('any') or only when it wrote ('write'). */
  abortAt: 'none' | 'write' | 'any';
  abortName: string;
  /** The commit waits for releaseHeld(): always ('any') or only when the transaction wrote ('write'). */
  holdAt: 'none' | 'write' | 'any';
  /**
   * The commit starts and then never ends until releaseCommitting(): always ('any') or only when the transaction
   * wrote ('write'). While it is stuck, abort() throws InvalidStateError (AM-1).
   */
  commitHold: 'none' | 'write' | 'any';
  /** A request of this kind fails: request.onerror, then transaction.onerror, then the transaction aborts. */
  requestError: null | 'get' | 'put' | 'delete';
}

const named = (name: string): { name: string; message: string } => ({ name, message: name });

class FakeRequest<T = unknown> {
  /** Unset until the request succeeds, like the real one. */
  result = undefined as T;
  error: { name: string; message: string } | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
}

class FakeOpenRequest extends FakeRequest<FakeDb> {
  onblocked: Handler = null;
  onupgradeneeded: Handler = null;
}

class FakeObjectStore {
  constructor(
    private readonly tx: FakeTx,
    readonly name: string,
  ) {}

  get(key: string): FakeRequest {
    this.tx.owner.log.push({ op: 'get', tx: this.tx.id, store: this.name, key });
    return this.tx.request('get', () => {
      const v = this.tx.read(this.name, key);
      return v === undefined ? undefined : structuredClone(v);
    });
  }

  put(value: unknown, key?: string): FakeRequest {
    if (this.tx.mode === 'readonly') throw new DOMException('read-only transaction', 'ReadOnlyError');
    if (key === undefined) throw new DOMException('the store has no key path, so a key is required', 'DataError');
    this.tx.owner.log.push({ op: 'put', tx: this.tx.id, store: this.name, key, value: structuredClone(value) });
    this.tx.wrote = true;
    return this.tx.request('put', () => {
      this.tx.write(this.name, key, { value: structuredClone(value) });
      return key;
    });
  }

  delete(key: string): FakeRequest {
    if (this.tx.mode === 'readonly') throw new DOMException('read-only transaction', 'ReadOnlyError');
    this.tx.owner.log.push({ op: 'delete', tx: this.tx.id, store: this.name, key });
    this.tx.wrote = true;
    return this.tx.request('delete', () => {
      this.tx.write(this.name, key, { deleted: true });
      return undefined;
    });
  }
}

type Cell = { value: unknown } | { deleted: true };

class FakeTx {
  oncomplete: Handler = null;
  onabort: Handler = null;
  onerror: Handler = null;
  error: { name: string; message: string } | null = null;
  wrote = false;
  finished = false;
  /** True while the commit is stuck by `sw.commitHold`. */
  committing = false;
  private pending = 0;
  private readonly overlay = new Map<string, Map<string, Cell>>();

  constructor(
    readonly owner: FakeIdb,
    readonly db: FakeDb,
    readonly id: number,
    readonly names: string[],
    readonly mode: string,
  ) {
    queueMicrotask(() => this.settle());
  }

  objectStore(name: string): FakeObjectStore {
    if (this.finished) throw new DOMException('the transaction has finished', 'InvalidStateError');
    if (this.committing) throw new DOMException('the transaction is committing', 'InvalidStateError');
    if (!this.names.includes(name) || !this.db.data.stores.has(name)) throw new DOMException(`no object store ${name}`, 'NotFoundError');
    return new FakeObjectStore(this, name);
  }

  abort(): void {
    if (this.finished || this.committing) {
      this.owner.log.push({ op: 'abortThrow', tx: this.id });
      throw new DOMException(this.finished ? 'the transaction has finished' : 'the transaction is committing', 'InvalidStateError');
    }
    this.doAbort('AbortError', 'client');
  }

  read(store: string, key: string): unknown {
    const cell = this.overlay.get(store)?.get(key);
    if (cell) return 'deleted' in cell ? undefined : cell.value;
    return this.db.data.stores.get(store)?.get(key);
  }

  write(store: string, key: string, cell: Cell): void {
    const m = this.overlay.get(store) ?? new Map<string, Cell>();
    m.set(key, cell);
    this.overlay.set(store, m);
  }

  request(kind: 'get' | 'put' | 'delete', run: () => unknown): FakeRequest {
    if (this.finished) throw new DOMException('the transaction has finished', 'InvalidStateError');
    if (this.committing) throw new DOMException('the transaction is committing', 'TransactionInactiveError');
    const req = new FakeRequest();
    this.pending += 1;
    queueMicrotask(() => {
      if (this.finished) return;
      if (this.owner.sw.requestError === kind) {
        req.error = named('DataError');
        fire(req.onerror, 'error');
        fire(this.onerror, 'error');
        this.doAbort('DataError', 'fake');
        return;
      }
      req.result = run();
      this.owner.log.push({ op: 'success', tx: this.id, request: kind });
      fire(req.onsuccess, 'success');
      this.pending -= 1;
      this.settle();
    });
    return req;
  }

  private settle(): void {
    if (this.finished || this.pending > 0) return;
    queueMicrotask(() => {
      if (this.finished || this.committing || this.pending > 0) return;
      const sw = this.owner.sw;
      if (sw.holdAt === 'any' || (sw.holdAt === 'write' && this.wrote)) {
        this.owner.held.push(this);
        return;
      }
      this.beginCommit();
    });
  }

  /** The commit starts: stuck in the committing phase when `sw.commitHold` says so, else it ends at once. */
  beginCommit(): void {
    if (this.finished || this.committing) return;
    this.owner.held = this.owner.held.filter((t) => t !== this);
    const sw = this.owner.sw;
    if (sw.commitHold === 'any' || (sw.commitHold === 'write' && this.wrote)) {
      this.committing = true;
      this.owner.committing.push(this);
      this.owner.trace?.push('idb:committing');
      return;
    }
    this.commit();
  }

  commit(): void {
    if (this.finished) return;
    this.owner.held = this.owner.held.filter((t) => t !== this);
    const sw = this.owner.sw;
    if (sw.abortAt === 'any' || (sw.abortAt === 'write' && this.wrote)) {
      this.doAbort(sw.abortName, 'fake');
      return;
    }
    this.complete();
  }

  /** Applies the writes and fires oncomplete. */
  private complete(): void {
    for (const [store, cells] of this.overlay) {
      const target = this.db.data.stores.get(store);
      if (!target) continue;
      for (const [key, cell] of cells) {
        if ('deleted' in cell) target.delete(key);
        else target.set(key, cell.value);
      }
    }
    this.finished = true;
    this.owner.log.push({ op: 'complete', tx: this.id });
    this.owner.trace?.push('idb:commit');
    fire(this.oncomplete, 'complete');
  }

  /** The stuck commit ends: with the writes applied (`complete`) or discarded (`abort`, onabort by the fake). */
  endCommit(how: 'complete' | 'abort'): void {
    if (!this.committing) return;
    this.committing = false;
    this.owner.committing = this.owner.committing.filter((t) => t !== this);
    if (this.finished) return;
    if (how === 'complete') this.complete();
    else this.doAbort(this.owner.sw.abortName, 'fake');
  }

  private doAbort(name: string, by: 'client' | 'fake'): void {
    if (this.finished) return;
    this.finished = true;
    this.error = named(name);
    this.overlay.clear();
    this.owner.held = this.owner.held.filter((t) => t !== this);
    this.owner.log.push({ op: 'abort', tx: this.id, by, name });
    this.owner.trace?.push('idb:abort');
    queueMicrotask(() => fire(this.onabort, 'abort'));
  }
}

class FakeDb {
  onversionchange: Handler = null;
  closed = false;
  inUpgrade = false;
  readonly objectStoreNames = { contains: (n: string): boolean => this.data.stores.has(n) };

  constructor(
    readonly owner: FakeIdb,
    readonly data: DbData,
  ) {}

  createObjectStore(name: string): object {
    if (!this.inUpgrade) throw new DOMException('not in an upgrade', 'InvalidStateError');
    if (this.data.stores.has(name)) throw new DOMException('exists', 'ConstraintError');
    this.owner.log.push({ op: 'createObjectStore', name });
    this.data.stores.set(name, new Map());
    return {};
  }

  transaction(stores: string | string[], mode: string = 'readonly', options?: unknown): FakeTx {
    const id = this.owner.nextTx();
    this.owner.log.push({ op: 'transaction', tx: id, stores, mode, options });
    this.owner.trace?.push(`idb:tx:${mode}`);
    if (this.owner.sw.transactionThrows) throw new DOMException('transaction failed', 'InvalidStateError');
    if (this.closed) throw new DOMException('the connection is closed', 'InvalidStateError');
    return new FakeTx(this.owner, this, id, Array.isArray(stores) ? stores : [stores], mode);
  }

  close(): void {
    this.owner.log.push({ op: 'close' });
    this.closed = true;
  }
}

export class FakeIdb {
  readonly backing: IdbBacking;
  readonly log: IdbLogEntry[] = [];
  readonly trace: Trace | undefined;
  readonly sw: IdbSwitches = {
    openThrows: false,
    openError: null,
    openBlocked: false,
    openHang: false,
    transactionThrows: false,
    abortAt: 'none',
    abortName: 'QuotaExceededError',
    holdAt: 'none',
    commitHold: 'none',
    requestError: null,
  };
  /** Every connection this instance gave out. */
  readonly connections: FakeDb[] = [];
  /** Transactions whose commit is withheld by `sw.holdAt` (before the commit starts; abort() works). */
  held: FakeTx[] = [];
  /** Transactions stuck in the committing phase by `sw.commitHold` (abort() throws). */
  committing: FakeTx[] = [];
  private hungOpens: Array<() => void> = [];
  private txCounter = 0;

  /** The IDBFactory the code under test gets. */
  readonly factory: { open(name: string, version?: number): FakeOpenRequest };

  constructor(opts: { backing?: IdbBacking; trace?: Trace } = {}) {
    this.backing = opts.backing ?? newBacking();
    this.trace = opts.trace;
    this.factory = { open: (name, version) => this.open(name, version) };
  }

  nextTx(): number {
    this.txCounter += 1;
    return this.txCounter;
  }

  private open(name: string, version?: number): FakeOpenRequest {
    this.log.push({ op: 'open', name, version });
    this.trace?.push('idb:open');
    if (this.sw.openThrows) throw new DOMException('the factory cannot open', 'SecurityError');
    const req = new FakeOpenRequest();
    const deliver = (): void => {
      if (this.sw.openBlocked) {
        fire(req.onblocked, 'blocked');
        return;
      }
      if (this.sw.openError) {
        req.error = named(this.sw.openError);
        fire(req.onerror, 'error');
        return;
      }
      let data = this.backing.dbs.get(name);
      const requested = version ?? data?.version ?? 1;
      if (data && requested < data.version) {
        req.error = named('VersionError');
        fire(req.onerror, 'error');
        return;
      }
      let oldVersion = data?.version ?? 0;
      let upgrade = false;
      if (!data) {
        data = { version: requested, stores: new Map() };
        this.backing.dbs.set(name, data);
        upgrade = true;
      } else if (requested > data.version) {
        oldVersion = data.version;
        data.version = requested;
        upgrade = true;
      }
      const db = new FakeDb(this, data);
      this.connections.push(db);
      req.result = db;
      if (upgrade) {
        db.inUpgrade = true;
        try {
          fire(req.onupgradeneeded, 'upgradeneeded', { oldVersion, newVersion: requested });
        } finally {
          db.inUpgrade = false;
        }
      }
      fire(req.onsuccess, 'success');
    };
    queueMicrotask(() => {
      if (this.sw.openHang) this.hungOpens.push(deliver);
      else deliver();
    });
    return req;
  }

  /** Starts the commit of every transaction held by `sw.holdAt` (it may then be stuck by `sw.commitHold`). */
  releaseHeld(): void {
    for (const t of [...this.held]) t.beginCommit();
  }

  /**
   * Ends every stuck commit (`sw.commitHold`): `complete` applies the writes and fires oncomplete, `abort`
   * discards them and fires onabort. A late call, after the code under test has given its answer, is how a spec
   * delivers a terminal event that nobody waits for any more.
   */
  releaseCommitting(how: 'complete' | 'abort'): void {
    for (const t of [...this.committing]) t.endCommit(how);
  }

  /** Answers every open() that `sw.openHang` left pending, with a success. */
  settleOpen(): void {
    const pending = this.hungOpens;
    this.hungOpens = [];
    const hang = this.sw.openHang;
    this.sw.openHang = false;
    for (const deliver of pending) deliver();
    this.sw.openHang = hang;
  }

  /** Fires onversionchange on every open connection, as another tab upgrading the database would. */
  triggerVersionChange(): void {
    for (const c of this.connections) {
      if (c.closed) continue;
      this.log.push({ op: 'versionchange' });
      fire(c.onversionchange, 'versionchange', { oldVersion: 1, newVersion: 2 });
    }
  }

  /** The value under fetchly/kv/pairing in the backing map (what a restarted worker would read). */
  peek(): unknown {
    const v = this.backing.dbs.get('fetchly')?.stores.get('kv')?.get('pairing');
    return v === undefined ? undefined : structuredClone(v);
  }

  /** Writes a value straight into the backing map, as if an earlier worker had stored it. */
  seed(value: unknown): void {
    let data = this.backing.dbs.get('fetchly');
    if (!data) {
      data = { version: 1, stores: new Map() };
      this.backing.dbs.set('fetchly', data);
    }
    let kv = data.stores.get('kv');
    if (!kv) {
      kv = new Map();
      data.stores.set('kv', kv);
    }
    kv.set('pairing', structuredClone(value));
  }

  /** Connections that were opened and not closed. */
  get openConnections(): number {
    return this.connections.filter((c) => !c.closed).length;
  }
}
