/** A raw `net` client for the HTTP parsing rules: it sends exactly the bytes it is given and parses what comes back. */
import net from 'node:net';
import { waitFor } from '../wait';

export type Header = [name: string, value: string];

export interface RequestSpec {
  method?: string;
  target?: string;
  version?: string;
  headers?: Header[];
  body?: string | Buffer;
}

export function buildRequest(spec: RequestSpec): Buffer {
  const head =
    `${spec.method ?? 'POST'} ${spec.target ?? '/'} ${spec.version ?? 'HTTP/1.1'}\r\n` +
    (spec.headers ?? []).map(([n, v]) => `${n}: ${v}\r\n`).join('') +
    '\r\n';
  const body = spec.body === undefined ? Buffer.alloc(0) : typeof spec.body === 'string' ? Buffer.from(spec.body, 'utf8') : spec.body;
  return Buffer.concat([Buffer.from(head, 'latin1'), body]);
}

export interface RawReply {
  raw: Buffer;
  /** The bytes as latin1 text, for matching. */
  text: string;
  status: number | null;
  /** Lower-cased names; one entry per header line. */
  headers: Map<string, string[]>;
  /** The decoded body (chunked bodies are joined), as UTF-8 text. */
  body: string;
  /** The header block and the whole body have arrived. */
  complete: boolean;
  closed: boolean;
  error: string | null;
}

function dechunk(buf: Buffer): { data: Buffer; done: boolean } {
  const parts: Buffer[] = [];
  let pos = 0;
  for (;;) {
    const eol = buf.indexOf('\r\n', pos, 'latin1');
    if (eol < 0) return { data: Buffer.concat(parts), done: false };
    const size = parseInt(buf.subarray(pos, eol).toString('latin1'), 16);
    if (Number.isNaN(size)) return { data: Buffer.concat(parts), done: false };
    if (size === 0) return { data: Buffer.concat(parts), done: true };
    const start = eol + 2;
    if (buf.length < start + size + 2) return { data: Buffer.concat(parts), done: false };
    parts.push(buf.subarray(start, start + size));
    pos = start + size + 2;
  }
}

export function parseReply(raw: Buffer, closed = false, error: string | null = null): RawReply {
  const text = raw.toString('latin1');
  const sep = raw.indexOf('\r\n\r\n', 0, 'latin1');
  const headers = new Map<string, string[]>();
  let status: number | null = null;
  let body = '';
  let complete = false;
  if (sep >= 0) {
    const lines = raw.subarray(0, sep).toString('latin1').split('\r\n');
    const m = /^HTTP\/1\.[01] (\d{3})/u.exec(lines[0] ?? '');
    status = m ? Number(m[1]) : null;
    for (const line of lines.slice(1)) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const name = line.slice(0, colon).trim().toLowerCase();
      const list = headers.get(name) ?? [];
      list.push(line.slice(colon + 1).trim());
      headers.set(name, list);
    }
    const rest = raw.subarray(sep + 4);
    const te = headers.get('transfer-encoding')?.[0]?.toLowerCase();
    const cl = headers.get('content-length')?.[0];
    if (te === 'chunked') {
      const d = dechunk(rest);
      body = d.data.toString('utf8');
      complete = d.done;
    } else if (cl !== undefined) {
      const n = Number(cl);
      body = rest.subarray(0, n).toString('utf8');
      complete = rest.length >= n;
    } else {
      body = rest.toString('utf8');
      complete = closed;
    }
  }
  return { raw, text, status, headers, body, complete, closed, error };
}

export interface RawOptions {
  /** Give up after this long (default 4000 ms). */
  waitMs?: number;
  /**
   * By default the helper returns 60 ms after the whole answer has arrived, so a server that lingers on
   * purpose (an injected 1 s timer that never fires) does not cost the full wait. With `untilClosed` it
   * waits for the server to close the connection.
   */
  untilClosed?: boolean;
}

/** One request on one connection: write, read until the answer is complete, the server closes or `waitMs` passes. */
export function rawRequest(port: number, data: Buffer | string, opts: RawOptions = {}): Promise<RawReply> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    let error: string | null = null;
    let closed = false;
    let settled = false;
    let grace: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      resolve(parseReply(Buffer.concat(chunks), closed, error));
      socket.destroy();
    };
    const timer = setTimeout(finish, opts.waitMs ?? 4000);
    socket.on('data', (d: Buffer) => {
      chunks.push(d);
      if (!opts.untilClosed && grace === undefined && parseReply(Buffer.concat(chunks)).complete) grace = setTimeout(finish, 60);
    });
    socket.on('error', (e: NodeJS.ErrnoException) => {
      error = e.code ?? e.message;
    });
    socket.on('close', () => {
      closed = true;
      finish();
    });
    socket.write(data);
  });
}

export const send = (port: number, spec: RequestSpec, opts: RawOptions = {}): Promise<RawReply> => rawRequest(port, buildRequest(spec), opts);

/** A connection the spec drives by hand: partial writes, waiting, and observing the close. */
export class RawConn {
  readonly socket: net.Socket;
  private readonly chunks: Buffer[] = [];
  closed = false;
  ended = false;
  error: string | null = null;

  constructor(port: number, opts: { allowHalfOpen?: boolean } = {}) {
    this.socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen: opts.allowHalfOpen ?? false });
    this.socket.on('data', (d: Buffer) => this.chunks.push(d));
    this.socket.on('end', () => {
      this.ended = true;
    });
    this.socket.on('error', (e: NodeJS.ErrnoException) => {
      this.error = e.code ?? e.message;
    });
    this.socket.on('close', () => {
      this.closed = true;
    });
  }

  /** Resolves once the connection is established. */
  async connected(): Promise<this> {
    if (this.socket.connecting) await new Promise<void>((r) => this.socket.once('connect', () => r()));
    return this;
  }

  write(data: Buffer | string): void {
    this.socket.write(data);
  }

  reply(): RawReply {
    return parseReply(Buffer.concat(this.chunks), this.closed, this.error);
  }

  get receivedBytes(): number {
    return Buffer.concat(this.chunks).length;
  }

  /** Waits until the whole response (headers and body) has arrived. */
  async complete(ms = 3000): Promise<RawReply> {
    return waitFor(() => {
      const r = this.reply();
      return r.complete ? r : undefined;
    }, ms);
  }

  async waitClosed(ms = 3000): Promise<void> {
    await waitFor(() => this.closed, ms);
  }

  /** Waits until the server has ended (FIN) or closed its side; with allowHalfOpen the client never closes by itself. */
  async waitEnded(ms = 3000): Promise<void> {
    await waitFor(() => this.ended || this.closed, ms);
  }

  /** True once the server has ended or closed its side. */
  get serverDone(): boolean {
    return this.ended || this.closed;
  }

  destroy(): void {
    this.socket.destroy();
  }
}

/** True when nothing accepts connections on the port any more (polls up to `ms`). */
export async function refusesConnections(port: number, ms = 2000): Promise<boolean> {
  const probe = (): Promise<boolean> =>
    new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => {
        s.destroy();
        resolve(false);
      });
      s.on('error', () => resolve(true));
    });
  const deadline = Date.now() + ms;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A free loopback port (found by binding port 0 and closing again). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

/** `n` distinct free loopback ports (all held at once while they are picked, then released). */
export async function freePorts(n: number): Promise<number[]> {
  const held = await Promise.all(Array.from({ length: n }, () => holdPort()));
  const ports = held.map((h) => h.port);
  await Promise.all(held.map((h) => h.release()));
  return ports;
}

export async function twoPorts(): Promise<[number, number]> {
  const [a = 0, b = 0] = await freePorts(2);
  return [a, b];
}

export async function threePorts(): Promise<[number, number, number]> {
  const [a = 0, b = 0, c = 0] = await freePorts(3);
  return [a, b, c];
}

/** Holds a loopback port, like another program would. */
export async function holdPort(port = 0): Promise<{ port: number; release(): Promise<void> }> {
  const s = net.createServer();
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject);
    s.listen(port, '127.0.0.1', resolve);
  });
  const addr = s.address();
  const held = typeof addr === 'object' && addr ? addr.port : 0;
  return { port: held, release: () => new Promise<void>((r) => s.close(() => r())) };
}
