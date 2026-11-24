/**
 * The injected `fetch` of the A2 client specs. It logs every request and scripts what comes back: a JSON or
 * raw answer, a rejection, a hang (no headers), a hanging body, a body stream that errors, an endless body,
 * a `null` body, and the opaque redirect of probe P4c (status 0, type 'opaqueredirect', body null). The `bytes`
 * answer (Amendment 1, AM-6) sends the given bytes exactly as they are: nothing is encoded or decoded on the way,
 * so a spec can send a body that is not valid UTF-8.
 *
 * The response is a plain object, not a Response: `{ status, ok, type, url, redirected, headers, body }`, where
 * `body` is a real ReadableStream (or null). It has no text(), json() or arrayBuffer(): E8 says bodies are
 * read from the stream with a cap, so a client that calls them fails here.
 *
 * An abort signal in `init.signal` makes a pending fetch reject with an AbortError and makes a pending body
 * stream error, like the real thing. A request without a signal can never be aborted, so a hang stays a hang.
 */
import type { FakeClock, Trace } from './clock';

export interface FakeInit {
  method?: string;
  headers?: unknown;
  body?: unknown;
  signal?: unknown;
  [key: string]: unknown;
}

export interface FakeResponse {
  status: number;
  ok: boolean;
  type: string;
  redirected: boolean;
  url: string;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

export type Answer =
  | { kind: 'json'; status: number; body: unknown; delayMs?: number }
  | { kind: 'text'; status: number; text: string; delayMs?: number }
  | { kind: 'bytes'; status: number; bytes: Uint8Array }
  | { kind: 'reject'; message?: string; delayMs?: number }
  | { kind: 'hang' }
  | { kind: 'hangBody'; status: number; head?: string }
  | { kind: 'streamError'; status: number; head?: string }
  | { kind: 'infinite'; status: number; chunkBytes?: number }
  | { kind: 'nullBody'; status: number }
  | { kind: 'opaqueRedirect' };

export const json = (status: number, body: unknown, delayMs?: number): Answer =>
  delayMs === undefined ? { kind: 'json', status, body } : { kind: 'json', status, body, delayMs };
/** An A1 error answer: `{ error: token }`. */
export const err = (status: number, token: string): Answer => ({ kind: 'json', status, body: { error: token } });
export const text = (status: number, body: string): Answer => ({ kind: 'text', status, text: body });
/** A body of raw bytes, sent as they are (no TextEncoder): for a body that is not valid UTF-8. */
export const bytes = (status: number, u8: Uint8Array): Answer => ({ kind: 'bytes', status, bytes: u8 });
export const reject = (message = 'Failed to fetch'): Answer => ({ kind: 'reject', message });
export const hang = (): Answer => ({ kind: 'hang' });
export const hangBody = (status = 200, head = '{'): Answer => ({ kind: 'hangBody', status, head });
export const streamError = (status = 200, head = '{"pro'): Answer => ({ kind: 'streamError', status, head });
export const infinite = (status = 200, chunkBytes = 1024): Answer => ({ kind: 'infinite', status, chunkBytes });
export const nullBody = (status = 200): Answer => ({ kind: 'nullBody', status });
/** P4c: a 307 with redirect: 'manual' resolves with status 0, type 'opaqueredirect', body null. */
export const opaqueRedirect = (): Answer => ({ kind: 'opaqueRedirect' });

export interface LoggedRequest {
  seq: number;
  url: string;
  /** The port of the URL, NaN when it has none. */
  port: number;
  /** The path of the URL, or '' when the URL does not parse. */
  path: string;
  /** True only for http://127.0.0.1:<port>/<path> with no query and no fragment. */
  loopback: boolean;
  method: string;
  /** Header names are lower-cased; the value of a repeated name is its first. */
  headers: Record<string, string>;
  /** Lower-cased header names in the order given, with repeats. */
  headerNames: string[];
  authorization: string | undefined;
  /** The request body decoded as UTF-8, or null when there is none. */
  bodyText: string | null;
  bodyBytes: number;
  /** The body parsed as JSON; undefined when it is not JSON. */
  bodyJson: unknown;
  init: FakeInit;
  signal: AbortSignal | undefined;
  /** Body chunks the client has pulled from an `infinite` answer. */
  pulled: number;
}

const abortError = (): Error => new DOMException('This operation was aborted', 'AbortError');

function headerPairs(h: unknown): [string, string][] {
  if (h === undefined || h === null) return [];
  if (Array.isArray(h)) return h.map((p) => [String((p as unknown[])[0]), String((p as unknown[])[1])] as [string, string]);
  const maybeEntries = (h as { entries?: () => Iterable<[string, string]> }).entries;
  if (typeof maybeEntries === 'function' && typeof (h as { get?: unknown }).get === 'function') return [...maybeEntries.call(h)];
  return Object.entries(h as Record<string, unknown>).map(([k, v]) => [k, String(v)] as [string, string]);
}

function bodyBytesOf(b: unknown): Uint8Array | null {
  if (b === undefined || b === null) return null;
  if (typeof b === 'string') return new TextEncoder().encode(b);
  if (b instanceof Uint8Array) return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  throw new TypeError('the fake fetch accepts a string or a buffer as a body');
}

/** Rejects when the signal aborts before the promise settles. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Something that answers a logged request. */
export interface Responder {
  answer(req: LoggedRequest): Promise<Answer>;
  /** True when a connection attempt is refused (nothing listens). */
  down?: boolean;
}

export class FakeNet {
  /** Every request, in order, across all servers. */
  readonly log: LoggedRequest[] = [];
  /** What listens on which port. A port with no entry refuses the connection. */
  readonly servers = new Map<number, Responder>();
  private seq = 0;

  constructor(
    readonly clock: FakeClock,
    readonly trace?: Trace,
  ) {}

  /** The requests that did not go to http://127.0.0.1:<port>/<path> exactly. */
  get strays(): LoggedRequest[] {
    return this.log.filter((r) => !r.loopback);
  }

  /** The requests to one port. */
  to(port: number): LoggedRequest[] {
    return this.log.filter((r) => r.port === port);
  }

  readonly fetch = (url: string, init: FakeInit = {}): Promise<FakeResponse> => {
    const req = this.record(url, init);
    this.log.push(req);
    this.trace?.push(`fetch:${req.port}:${req.path}`);
    return this.run(req);
  };

  private record(url: string, init: FakeInit): LoggedRequest {
    let port = NaN;
    let path = '';
    let loopback = false;
    try {
      const u = new URL(url);
      port = u.port === '' ? NaN : Number(u.port);
      path = u.pathname;
      loopback = u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.search === '' && u.hash === '' && url === `http://127.0.0.1:${u.port}${u.pathname}`;
    } catch {
      /* a malformed URL stays loopback: false */
    }
    const pairs = headerPairs(init.headers);
    const headers: Record<string, string> = {};
    const headerNames: string[] = [];
    for (const [k, v] of pairs) {
      const name = k.toLowerCase();
      headerNames.push(name);
      if (!(name in headers)) headers[name] = v;
    }
    const raw = bodyBytesOf(init.body);
    let bodyText: string | null = null;
    let bodyJson: unknown;
    if (raw) {
      bodyText = new TextDecoder().decode(raw);
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        bodyJson = undefined;
      }
    }
    this.seq += 1;
    return {
      seq: this.seq,
      url,
      port,
      path,
      loopback,
      method: init.method ?? 'GET',
      headers,
      headerNames,
      authorization: headers['authorization'],
      bodyText,
      bodyBytes: raw ? raw.byteLength : 0,
      bodyJson,
      init,
      signal: init.signal as AbortSignal | undefined,
      pulled: 0,
    };
  }

  private async run(req: LoggedRequest): Promise<FakeResponse> {
    const server = this.servers.get(req.port);
    if (!req.loopback || !server || server.down) throw new TypeError('fetch failed');
    const answer = await raceAbort(server.answer(req), req.signal);
    if (answer.kind === 'reject') {
      if (answer.delayMs) await raceAbort(this.sleep(answer.delayMs), req.signal);
      throw new TypeError(answer.message ?? 'Failed to fetch');
    }
    if (answer.kind === 'hang') {
      await raceAbort(new Promise<never>(() => undefined), req.signal);
    }
    if ((answer.kind === 'json' || answer.kind === 'text') && answer.delayMs) await raceAbort(this.sleep(answer.delayMs), req.signal);
    return this.respond(req, answer);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.clock.setTimer(resolve, ms);
    });
  }

  private respond(req: LoggedRequest, answer: Answer): FakeResponse {
    const make = (status: number, type: string, body: ReadableStream<Uint8Array> | null): FakeResponse => ({
      status,
      ok: status >= 200 && status <= 299,
      type,
      redirected: false,
      url: req.url,
      headers: { get: (name: string): string | null => (name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
      body,
    });
    switch (answer.kind) {
      case 'opaqueRedirect':
        return make(0, 'opaqueredirect', null);
      case 'nullBody':
        return make(answer.status, 'basic', null);
      case 'json':
        return make(answer.status, 'basic', chunked(new TextEncoder().encode(JSON.stringify(answer.body))));
      case 'text':
        return make(answer.status, 'basic', chunked(new TextEncoder().encode(answer.text)));
      case 'bytes':
        return make(answer.status, 'basic', chunked(answer.bytes));
      case 'streamError': {
        const head = new TextEncoder().encode(answer.head ?? '');
        let sent = false;
        return make(
          answer.status,
          'basic',
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sent && head.length > 0) {
                sent = true;
                controller.enqueue(head);
                return;
              }
              controller.error(new TypeError('network error'));
            },
          }),
        );
      }
      case 'hangBody': {
        const head = new TextEncoder().encode(answer.head ?? '');
        let sent = false;
        return make(
          answer.status,
          'basic',
          new ReadableStream<Uint8Array>({
            start(controller) {
              req.signal?.addEventListener('abort', () => controller.error(abortError()), { once: true });
            },
            pull(controller) {
              if (!sent && head.length > 0) {
                sent = true;
                controller.enqueue(head);
                return;
              }
              return new Promise<void>(() => undefined);
            },
          }),
        );
      }
      case 'infinite': {
        const chunk = new Uint8Array(answer.chunkBytes ?? 1024).fill(0x20);
        return make(
          answer.status,
          'basic',
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                req.pulled += 1;
                controller.enqueue(chunk.slice());
              },
            },
            { highWaterMark: 0 },
          ),
        );
      }
      default:
        throw new Error('unreachable');
    }
  }
}

/** A stream that delivers `bytes` in slices of 16 KiB, so a client has to loop. */
function chunked(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const SLICE = 16 * 1024;
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + SLICE));
      at += SLICE;
    },
  });
}
