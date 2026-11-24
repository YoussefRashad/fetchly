/**
 * A stub of the store for the client specs: an in-memory record with the same removeIf semantics as the real
 * store (it removes only when the stored pairingId equals the id), a log of every call, and switches that make
 * read or removeIf fail. The store itself is covered by store.test.ts; messages.test.ts and flow.test.ts use the
 * real one over the fake IndexedDB.
 *
 * Amendment 1 (AM-1): write, removeIf and clear may answer `storage_unknown` besides `storage_blocked` and
 * `storage_failed`; read never answers `storage_unknown`. A removeIf that fails changes nothing.
 */
import type { Rec } from './fixtures';

type ReadFailure = 'storage_blocked' | 'storage_failed';
type WriteFailure = 'storage_blocked' | 'storage_failed' | 'storage_unknown';
type Done = { ok: true; value: null } | { ok: false; kind: WriteFailure };

export interface StubStore {
  current: Rec | null;
  reads: number;
  /** The ids removeIf was called with, in order (also when it failed). */
  removed: string[];
  writes: number;
  clears: number;
  failRead: null | ReadFailure;
  /** removeIf answers this failure, and removes nothing. */
  failRemove: null | 'storage_failed' | 'storage_unknown';
  read(): Promise<{ ok: true; value: Rec | null } | { ok: false; kind: ReadFailure }>;
  write(record: Rec): Promise<Done>;
  removeIf(pairingId: string): Promise<Done>;
  clear(): Promise<Done>;
}

export function makeStubStore(initial: Rec | null): StubStore {
  const s: StubStore = {
    current: initial ? { ...initial } : null,
    reads: 0,
    removed: [],
    writes: 0,
    clears: 0,
    failRead: null,
    failRemove: null,
    async read() {
      s.reads += 1;
      if (s.failRead) return { ok: false, kind: s.failRead };
      return { ok: true, value: s.current ? { ...s.current } : null };
    },
    async write(record) {
      s.writes += 1;
      s.current = { ...record };
      return { ok: true, value: null };
    },
    async removeIf(pairingId) {
      s.removed.push(pairingId);
      if (s.failRemove) return { ok: false, kind: s.failRemove };
      if (s.current?.pairingId === pairingId) s.current = null;
      return { ok: true, value: null };
    },
    async clear() {
      s.clears += 1;
      s.current = null;
      return { ok: true, value: null };
    },
  };
  return s;
}
