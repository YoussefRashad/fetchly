/**
 * A fake `chrome` for the A2 specs. It models only what the lib may touch (plan section 2):
 *
 *   chrome.runtime.id
 *   chrome.runtime.getURL(path)
 *   chrome.runtime.onMessage      addListener, removeListener, hasListener, and the helper dispatch(msg, sender)
 *   chrome.i18n.getUILanguage()
 *
 * There is **no storage** (DV1, E9): `'storage' in chrome` is false, so any code that reaches for
 * chrome.storage throws in the specs.
 *
 * dispatch(msg, sender) calls the listeners like the browser does: with a sendResponse callback, and a
 * listener that returns true keeps the channel open for an asynchronous reply. When the listener returns
 * a falsy value without replying, the reply promise resolves with undefined (what the sender's callback
 * sees when the port closes). dispatch(msg, sender, { deliver: false }) models a popup that has closed:
 * sendResponse is still called (and counted) but nothing is delivered.
 */
import type { Trace } from '../extension/clock';

/** A valid extension id: 32 letters a to p. */
export const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';

export type FakeListener = (message: unknown, sender: unknown, sendResponse: (reply?: unknown) => void) => unknown;

export interface Dispatched {
  /** What the first listener returned. */
  returned: unknown;
  /** The first reply that was delivered; undefined when the listener did not keep the channel open. */
  reply: Promise<unknown>;
  /** Every argument sendResponse was called with, delivered or not. */
  sent: unknown[];
}

export interface FakeChrome {
  runtime: {
    id: string;
    getURL(path: string): string;
    onMessage: {
      addListener(l: FakeListener): void;
      removeListener(l: FakeListener): void;
      hasListener(l: FakeListener): boolean;
      /** The number of listeners. */
      readonly count: number;
      dispatch(message: unknown, sender: unknown, options?: { deliver?: boolean }): Dispatched;
    };
  };
  i18n: { getUILanguage(): string };
}

export function createFakeChrome(opts: { id?: string; uiLanguage?: string; trace?: Trace } = {}): FakeChrome {
  const id = opts.id ?? EXT_ID;
  const listeners: FakeListener[] = [];
  return {
    runtime: {
      id,
      getURL: (path: string): string => `chrome-extension://${id}/${path.replace(/^\//u, '')}`,
      onMessage: {
        addListener: (l) => {
          listeners.push(l);
        },
        removeListener: (l) => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        },
        hasListener: (l) => listeners.includes(l),
        get count() {
          return listeners.length;
        },
        dispatch(message, sender, options = {}) {
          const deliver = options.deliver ?? true;
          const sent: unknown[] = [];
          let resolveReply: (v: unknown) => void = () => undefined;
          const reply = new Promise<unknown>((resolve) => {
            resolveReply = resolve;
          });
          let replied = false;
          const sendResponse = (r?: unknown): void => {
            sent.push(r);
            opts.trace?.push('reply');
            if (deliver && !replied) {
              replied = true;
              resolveReply(r);
            }
          };
          let returned: unknown;
          for (const l of [...listeners]) {
            const r = l(message, sender, sendResponse);
            if (returned === undefined) returned = r;
          }
          if (returned !== true && sent.length === 0) resolveReply(undefined);
          return { returned, reply, sent };
        },
      },
    },
    i18n: { getUILanguage: () => opts.uiLanguage ?? 'en-US' },
  };
}

/** The sender of a message from the extension's own popup. It has no `tab`. */
export function popupSender(chrome: FakeChrome): { id: string; url: string } {
  return { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') };
}
