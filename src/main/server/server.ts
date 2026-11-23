/**
 * The local server the browser extension talks to: node:http on 127.0.0.1 only, the frozen parsing rules
 * and check order (architecture section 3), and the listener lifecycle (start, ensure, stop).
 *
 * Nothing about a request is logged. The one log line is the handler-failure line: the route path and the
 * error's name (S17).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { TextDecoder } from 'node:util';
import { performance } from 'node:perf_hooks';
import { BODY_LIMIT, ORIGIN_RE, type ErrorToken } from '../../shared/protocol';
import type { ServerStatus } from '../../shared/types';
import type { Pairing, PairingStore } from './pairing';
import { lookup, type Reply } from './routes';

export interface ServerDeps {
  /** Monotonic milliseconds. */
  now(): number;
  randomBytes(n: number): Uint8Array;
  safeEqual(a: Buffer, b: Buffer): boolean;
  /** Every timer the server arms (listen deadline, linger) goes through these. */
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  createServer(options: http.ServerOptions, listener?: http.RequestListener): http.Server;
  pairing: PairingStore;
}

export interface RunningServer {
  /** Never `listening` without a bound socket. */
  status(): ServerStatus;
  /** Listens on `port` unless already listening there; resolves with the new status, never rejects. */
  ensure(port: number): Promise<ServerStatus>;
  /**
   * Closes the listener and every connection, ends a listen attempt still pending (its deadline timer too),
   * cancels the open code and the retry timer, all before the first await. Idempotent.
   */
  stop(): Promise<void>;
}

/** The real clock, random source, compare, timers and node:http. The caller adds `pairing`. */
export function productionDeps(): Omit<ServerDeps, 'pairing'> {
  return {
    now: () => performance.now(),
    randomBytes,
    safeEqual: timingSafeEqual,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    createServer: (options, listener) => http.createServer(options, listener),
  };
}

const MAX_CONNECTIONS = 16;
const LISTEN_DEADLINE_MS = 3000;
const LINGER_MS = 1000;

const START_FAILED_TEXT = 'The browser connection could not start; save Settings to try again';
const BROKEN_TEXT = 'The browser connection stopped working; save Settings to start it again';
const STARTING_TEXT = 'The browser connection is starting';
const STOPPED_TEXT = 'The browser connection is stopped';
const accessText = (port: number): string => `port ${port} cannot be used on this PC; choose another in Settings`;

const JSON_TYPES: ReadonlySet<string> = new Set(['application/json', 'application/json; charset=utf-8']);
/** Fatal on invalid UTF-8; a BOM is kept, so it fails JSON.parse (S19). */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const noop = (): void => undefined;

/** Sockets that carry an answer of ours: Node's error answer must not be appended to them. */
const answered = new WeakSet<object>();
/** Sockets in the 1 s linger after an early answer (S18): only the linger timer ends them. */
const lingering = new WeakSet<object>();

/** Node's own bare answers to a request it cannot parse, as its default clientError handler writes them. */
function bareAnswer(code: string | undefined): string {
  const status = code === 'HPE_HEADER_OVERFLOW' ? 431 : code === 'HPE_CHUNK_EXTENSIONS_OVERFLOW' ? 413 : code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 408 : 400;
  return `HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? ''}\r\nConnection: close\r\n\r\n`;
}

/**
 * Node's default clientError behaviour (a bare 400, 408 or 431 unless an answer is already on the socket, then
 * destroy), except for a socket in the linger: there llhttp can fail after the handler answered (a request with
 * Transfer-Encoding other than chunked), and destroying at once would drop the answer before it is flushed.
 * Node's own answers are only these parser-error ones, written here, plus those the frozen table gives to Node.
 * Node's Host precheck is off (requireHostHeader: false), so a request without Host reaches step 1 and gets the
 * app's answer; checkContinue and checkExpectation go to the normal checks, so Node writes no 100 Continue and no
 * 417. `answered` and `lingering` know of every answer of ours already sent.
 */
function onClientError(err: NodeJS.ErrnoException, socket: Duplex): void {
  if (lingering.has(socket)) return;
  if (socket.writable && !answered.has(socket)) socket.write(bareAnswer(err.code));
  socket.destroy();
}

/** Lower-cased header name to every value, from rawHeaders (req.headers drops and joins duplicates). */
function rawHeaderMap(raw: readonly string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = (raw[i] ?? '').toLowerCase();
    const list = map.get(name) ?? [];
    list.push(raw[i + 1] ?? '');
    map.set(name, list);
  }
  return map;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function writeJsonHead(res: http.ServerResponse, status: number, data: string): void {
  if (res.socket) answered.add(res.socket);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Connection: 'close',
    'Content-Length': Buffer.byteLength(data),
  });
}

/** A complete answer; Node then ends the connection (Connection: close). */
function sendJson(res: http.ServerResponse, status: number, body: object): void {
  const data = JSON.stringify(body);
  writeJsonHead(res, status, data);
  res.end(data);
}

/** The error's name if it is a plain identifier; never its message or stack (S17). */
function errorName(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  return /^[A-Za-z][A-Za-z0-9_]{0,40}$/u.test(name) ? name : 'Error';
}

/** Runs the check order on one request. `port` is the port this listener really has. */
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, deps: ServerDeps, port: number): void {
  req.on('error', noop);
  res.on('error', noop);
  const { pairing } = deps;
  const headers = rawHeaderMap(req.rawHeaders);
  const first = (name: string): string | undefined => headers.get(name)?.[0];
  const route = req.url === undefined ? undefined : lookup(req.url);
  // S18: the limit of the route whose path matches exactly, else 64 KiB, whichever step refuses.
  const limit = route?.bodyLimit ?? BODY_LIMIT;

  // The declared body length; null = no usable length. Without Content-Length, a method other than POST has none.
  const contentLength = headers.get('content-length');
  const transferEncoding = headers.get('transfer-encoding');
  let length: number | null;
  if (transferEncoding !== undefined) length = null;
  else if (contentLength === undefined) length = req.method === 'POST' ? null : 0;
  else if (contentLength.length === 1 && /^\d+$/u.test(contentLength[0] ?? '')) length = Number(contentLength[0]);
  else length = null;

  /**
   * S18. Within the limit: the body is discarded to its end, then the answer is sent and the connection ends.
   * Over the limit or no usable length: the answer is sent at once, the input is still discarded, and the
   * socket is destroyed after a 1 s linger (no FIN before it).
   */
  const refuse = (status: number, token: ErrorToken): void => {
    if (length !== null && length <= limit) {
      req.once('end', () => sendJson(res, status, { error: token }));
      req.resume();
      return;
    }
    const data = JSON.stringify({ error: token });
    const { socket } = req;
    lingering.add(socket);
    writeJsonHead(res, status, data);
    res.write(data);
    req.resume();
    deps.setTimer(() => socket.destroy(), LINGER_MS);
  };

  // Step 1: header rules, then Host.
  for (const name of ['host', 'origin', 'authorization', 'content-type']) {
    if ((headers.get(name)?.length ?? 0) > 1) return refuse(400, 'bad_request');
  }
  if (transferEncoding !== undefined) return refuse(400, 'bad_request');
  if (length === null) return refuse(400, 'bad_request');
  if (first('host') !== `127.0.0.1:${port}`) return refuse(403, 'bad_host');

  // Step 2: OPTIONS on any path (S7), then the exact path (S22), then the method.
  if (req.method === 'OPTIONS') return refuse(403, 'preflight_refused');
  if (!route) return refuse(404, 'not_found');
  if (req.method !== 'POST') return refuse(405, 'method_not_allowed');

  // Step 3: Origin (S6). On token routes some stored pairing must have it.
  const origin = first('origin');
  if (origin === undefined || !ORIGIN_RE.test(origin)) return refuse(403, 'bad_origin');
  if (route.auth === 'token' && !pairing.hasOrigin(origin)) return refuse(403, 'bad_origin');

  // Step 4: content type (S9), then size.
  const contentType = first('content-type');
  if (contentType === undefined || !JSON_TYPES.has(contentType.trim().toLowerCase())) return refuse(415, 'bad_content_type');
  if (length > route.bodyLimit) return refuse(413, 'too_large');

  // Step 5: token (S6b), then step 6: rate, counted once per request before the body is read.
  let matched: Pairing | null = null;
  if (route.auth === 'token') {
    const authorization = first('authorization');
    const token = authorization !== undefined && authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
    matched = token === null ? null : pairing.authenticate(origin, token);
    if (matched === null) return refuse(401, 'bad_token');
    if (!pairing.allow(matched)) return refuse(429, 'rate_limited');
  }

  const declared = length;
  const chunks: Buffer[] = [];
  let received = 0;
  req.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received <= declared) chunks.push(chunk);
  });
  req.once('end', () => {
    if (received !== declared) {
      req.socket.destroy();
      return;
    }
    // S6c: the pairing must still be stored once the body is in.
    if (matched !== null && !pairing.isStored(matched.id)) {
      sendJson(res, 401, { error: 'bad_token' });
      return;
    }
    // Step 7: the body is a JSON object (each route checks its exact keys).
    let body: unknown;
    try {
      body = JSON.parse(UTF8.decode(Buffer.concat(chunks)));
    } catch {
      body = undefined;
    }
    if (!isPlainObject(body)) {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }
    // S10: a handler that throws or rejects gets no answer: the socket is destroyed with zero bytes.
    const failed = (e: unknown): void => {
      console.error(`Fetchly server: the handler of ${route.path} failed (${errorName(e)})`);
      req.socket.destroy();
    };
    let out: Reply | Promise<Reply>;
    try {
      out = route.handle({ body, origin, pairing: matched, port });
    } catch (e) {
      failed(e);
      return;
    }
    Promise.resolve(out).then((reply) => {
      try {
        sendJson(res, reply.status, reply.body);
      } catch (e) {
        failed(e);
      }
    }, failed);
  });
}

/** close() and closeAllConnections(), not awaited; never throws. */
function shut(server: http.Server): void {
  try {
    server.close();
  } catch {
    // already closed
  }
  try {
    server.closeAllConnections();
  } catch {
    // nothing to close
  }
}

interface Attempt {
  status: ServerStatus;
  /** The listening instance; null unless status is listening. */
  server: http.Server | null;
}

/**
 * The status of a listen that failed on `requested`: EADDRINUSE is portBusy, EACCES the port text, anything else the
 * start-failed text. Used before 'listening' and in the handover gap (no caller ever saw that server listening).
 */
function listenFailure(e: NodeJS.ErrnoException, requested: number): ServerStatus {
  if (e.code === 'EADDRINUSE') return { state: 'portBusy', port: requested };
  if (e.code === 'EACCES') return { state: 'error', message: accessText(requested) };
  return { state: 'error', message: START_FAILED_TEXT };
}

/** Starts listening on 127.0.0.1:`port`. Never rejects: the status says how it went (S16). */
export async function start(port: number, deps: ServerDeps): Promise<RunningServer> {
  let status: ServerStatus = { state: 'error', message: STARTING_TEXT };
  let current: http.Server | null = null;
  let stopped = false;
  let closing: Promise<void> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  /** Ends the listen attempt still waiting for 'listening' (one at a time); null when none is pending. */
  let cancelPending: (() => void) | null = null;
  /**
   * The server whose 'listening' settled the attempt, until the continuation of ensure takes it (it becomes
   * `current`, or is shut if stopped). stop() in that gap closes it; an 'error' in that gap shuts it and turns the
   * attempt into a listen failure (the continuation then reads no server). null outside the gap.
   */
  let handover: http.Server | null = null;

  /** One new http.Server listening on `requested` (S13); a late 'listening' after the deadline is closed (R2-2). */
  const attempt = (requested: number): Promise<Attempt> =>
    new Promise<Attempt>((resolve) => {
      let settled = false;
      let timer: unknown = null;
      const at = { port: 0 };
      /** The result 'listening' settled with; an 'error' in the handover gap rewrites it before ensure reads it. */
      let listened: Attempt | null = null;
      const settle = (result: Attempt): boolean => {
        if (settled) return false;
        settled = true;
        cancelPending = null;
        if (timer !== null) deps.clearTimer(timer);
        resolve(result);
        return true;
      };

      let server: http.Server;
      try {
        server = deps.createServer(
          { maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10000, connectionsCheckingInterval: 1000, requireHostHeader: false },
          (req, res) => handleRequest(req, res, deps, at.port),
        );
        server.maxConnections = MAX_CONNECTIONS;
        // No 100 Continue and no 417: any Expect value is ignored and the normal checks answer.
        server.on('checkContinue', (req: http.IncomingMessage, res: http.ServerResponse) => handleRequest(req, res, deps, at.port));
        server.on('checkExpectation', (req: http.IncomingMessage, res: http.ServerResponse) => handleRequest(req, res, deps, at.port));
        // No upgrade and no tunnel: the socket is closed with zero bytes and no handler runs.
        server.on('upgrade', (_req: http.IncomingMessage, socket: Duplex) => socket.destroy());
        server.on('connect', (_req: http.IncomingMessage, socket: Duplex) => socket.destroy());
        server.on('clientError', onClientError);
      } catch {
        settle({ status: { state: 'error', message: START_FAILED_TEXT }, server: null });
        return;
      }

      // stop() while this attempt waits: it settles now (the deadline timer is cleared) and the server is closed.
      cancelPending = () => {
        settle({ status: { state: 'error', message: STOPPED_TEXT }, server: null });
        shut(server);
      };

      server.on('listening', () => {
        if (settled) {
          shut(server);
          return;
        }
        const address = server.address();
        at.port = typeof address === 'object' && address !== null ? address.port : 0;
        handover = server;
        listened = { status: { state: 'listening', port: at.port }, server };
        settle(listened);
      });

      server.on('error', (e: NodeJS.ErrnoException) => {
        if (!settled) {
          shut(server);
          settle({ status: listenFailure(e, requested), server: null });
          return;
        }
        // An error after listening: this listener is gone; leaving `listening` cancels the code.
        if (server === current) {
          current = null;
          status = { state: 'error', message: BROKEN_TEXT };
          deps.pairing.cancel();
          shut(server);
          return;
        }
        // An error in the handover gap: no caller saw this server listening, so it is a listen failure. The settled
        // result is rewritten before the continuation of ensure reads it; the code was cancelled when the move began.
        if (server === handover && listened !== null) {
          handover = null;
          shut(server);
          listened.status = listenFailure(e, requested);
          listened.server = null;
        }
      });

      timer = deps.setTimer(() => {
        if (settle({ status: { state: 'error', message: START_FAILED_TEXT }, server: null })) shut(server);
      }, LISTEN_DEADLINE_MS);

      try {
        server.listen(requested, '127.0.0.1');
      } catch {
        if (settle({ status: { state: 'error', message: START_FAILED_TEXT }, server: null })) shut(server);
      }
    });

  const listenOn = async (requested: number): Promise<ServerStatus> => {
    if (stopped) return status;
    if (status.state === 'listening' && current !== null && status.port === requested) return status;
    // Leaving `listening` (or never there): the open code is cancelled; the old instance is not awaited.
    deps.pairing.cancel();
    const old = current;
    current = null;
    if (old) shut(old);
    status = { state: 'error', message: STARTING_TEXT };
    const result = await attempt(requested);
    handover = null;
    if (stopped) {
      if (result.server) shut(result.server);
      return status;
    }
    current = result.server;
    status = result.status;
    return status;
  };

  /** One listen at a time, in call order. */
  const ensure = (requested: number): Promise<ServerStatus> => {
    const next = queue.then(() => listenOn(requested));
    queue = next.catch(noop);
    return next;
  };

  await ensure(port);

  return {
    status: () => status,
    ensure,
    async stop() {
      if (!stopped) {
        // Everything here runs before the first await, so the quit path can flush right after.
        stopped = true;
        status = { state: 'error', message: STOPPED_TEXT };
        deps.pairing.cancel();
        deps.pairing.stopRetry();
        // A listen still pending (a port move in progress, current is null) is ended too; a late 'listening'
        // is closed by its own guard. A server that is listening but not yet `current` (the handover) is closed here.
        const pending = cancelPending;
        cancelPending = null;
        pending?.();
        const last = current ?? handover;
        current = null;
        handover = null;
        if (last) {
          closing = new Promise<void>((resolve) => last.once('close', () => resolve()));
          shut(last);
        }
      }
      await closing;
    },
  };
}
