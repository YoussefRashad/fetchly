/**
 * The service worker: wiring only. The real chrome, fetch, crypto, indexedDB, clocks and timers go into the
 * lib (E1). The handlers are registered at the top level, in the first turn of the event loop (MV3).
 */
import { createClient } from './lib/client';
import { registerHandlers } from './lib/messages';
import { createStore } from './lib/store';

const setTimer = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);
const clearTimer = (handle: unknown): void => {
  if (typeof handle === 'number') clearTimeout(handle);
};

const store = createStore({ idb: indexedDB, setTimer, clearTimer });

const client = createClient({
  fetch: (url, init) => fetch(url, init),
  subtle: crypto.subtle,
  getRandomValues: (array) => crypto.getRandomValues(array),
  // E7: a monotonic clock and the wall clock.
  now: () => performance.now(),
  wallNow: () => Date.now(),
  setTimer,
  clearTimer,
  store,
  limits: {},
});

registerHandlers({ runtime: chrome.runtime, client, store, nav: navigator });
