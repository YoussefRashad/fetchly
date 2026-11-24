// A1 Task 8: port states and the server lifecycle (start, ensure, stop) on real sockets, with an injected clock.
// Covers S13 (a new http.Server per ensure that must listen; the old one gets close() and closeAllConnections(),
// not awaited), S16 (listen results), R2-2 (the listen deadline closes the pending server and discards a late
// 'listening'), R2-7 (stop clears the 30 s retry timer) and S23's server half (leaving `listening` cancels a code).
//
// Enumeration (ServerStatus states, architecture section 5): listening { port }, portBusy { port }, error { message }.
// Listen results of S16: EADDRINUSE -> portBusy; EACCES -> error with the fixed port text; any other error, a
// synchronous throw, a createServer that throws, or no answer within 3000 ms -> error with a fixed text.
import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunningServer } from '../../src/main/server/server';
import type { ServerStatus } from '../../src/shared/types';
import { sleep } from '../wait';
import { ORIGIN_A } from './fakes';
import { RawConn, freePort, holdPort, refusesConnections, send, threePorts, twoPorts } from './rawHttp';
import { bootServer, prepareServer, stopAll } from './rig';

afterEach(async () => {
  vi.restoreAllMocks();
  await stopAll();
});

type Listen = (...a: unknown[]) => http.Server;
const setListen = (s: http.Server, fn: Listen): void => {
  (s as unknown as { listen: Listen }).listen = fn;
};
const listenError = (s: http.Server, code: string, message = 'SECRET-DETAIL-ZZ'): Listen => () => {
  process.nextTick(() => s.emit('error', Object.assign(new Error(message), { code })));
  return s;
};

/** Rejects if `p` does not settle within `ms` (so a hang fails fast instead of waiting for the test timeout). */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms))]);
}

describe('start resolves with a decided status', () => {
  it('a free port: listening, with the port the socket really has', async () => {
    const port = await freePort();
    const b = await bootServer({ port });
    expect(b.running.status()).toEqual({ state: 'listening', port });
    const addr = b.servers[0]?.address() as { port: number; address: string };
    expect(addr.port).toBe(port);
    expect(addr.address).toBe('127.0.0.1');
  });

  it('port 0: the listening port is the one the OS gave (from address().port), never the requested 0', async () => {
    const b = await bootServer({ port: 0 });
    const st = b.running.status();
    expect(st.state).toBe('listening');
    const addr = b.servers[0]?.address() as { port: number };
    expect(addr.port).toBeGreaterThan(0);
    expect(st).toEqual({ state: 'listening', port: addr.port });
  });

  it('a held port: portBusy with that port, and no other port is bound', async () => {
    const held = await holdPort();
    try {
      const b = await bootServer({ port: held.port });
      expect(b.running.status()).toEqual({ state: 'portBusy', port: held.port });
      expect(b.servers).toHaveLength(1);
      expect(b.servers.every((s) => !s.listening)).toBe(true);
      expect(b.listenCalls).toHaveLength(1); // one attempt, no fallback to another port, no retry loop
    } finally {
      await held.release();
    }
  });

  it('a held port: no retry loop, even after a long time on the injected clock', async () => {
    const held = await holdPort();
    try {
      const b = await bootServer({ port: held.port });
      b.clock.advance(600_000);
      await sleep(50);
      expect(b.listenCalls).toHaveLength(1);
      expect(b.running.status().state).toBe('portBusy');
    } finally {
      await held.release();
    }
  });

  it('injected EACCES: error with the S16 text naming the port', async () => {
    const b = await bootServer({ port: 38917, onServer: (s) => setListen(s, listenError(s, 'EACCES')) });
    // portUnusable: the English text unchanged, the code, and the requested port for the window to translate.
    expect(b.running.status()).toEqual({
      state: 'error',
      message: 'port 38917 cannot be used on this PC; choose another in Settings',
      code: 'portUnusable',
      port: 38917,
    });
  });

  it('the EACCES text names the requested port, whatever it is', async () => {
    const b = await bootServer({ port: 4242, onServer: (s) => setListen(s, listenError(s, 'EACCES')) });
    expect(b.running.status()).toEqual({
      state: 'error',
      message: 'port 4242 cannot be used on this PC; choose another in Settings',
      code: 'portUnusable',
      port: 4242,
    });
  });

  it.each(['EINVAL', 'EPERM', 'EADDRNOTAVAIL', 'EMFILE', 'EIO'])('injected %s: error with a fixed text that carries no detail of the error', async (code) => {
    const b = await bootServer({ port: 38917, onServer: (s) => setListen(s, listenError(s, code, 'SECRET-DETAIL-ZZ')) });
    const st = b.running.status();
    expect(st.state).toBe('error');
    if (st.state === 'error') {
      expect(st.message.length).toBeGreaterThan(0);
      expect(st.message).not.toContain('SECRET-DETAIL-ZZ');
      expect(st.message).not.toContain(code);
      expect(st.message).not.toBe('port 38917 cannot be used on this PC; choose another in Settings');
    }
    // serverStartFailed: the English text of today and its code; the detail of the error never reaches the status.
    expect(st).toMatchObject({ state: 'error', message: 'The browser connection could not start; save Settings to try again', code: 'serverStartFailed' });
    expect(JSON.stringify(st)).not.toContain('SECRET-DETAIL-ZZ');
    expect(st).not.toHaveProperty('port');
  });

  it('an error without a code is an error with a fixed text', async () => {
    const b = await bootServer({ port: 38917, onServer: (s) => setListen(s, () => (process.nextTick(() => s.emit('error', new Error('SECRET-DETAIL-ZZ'))), s)) });
    const st = b.running.status();
    expect(st.state).toBe('error');
    expect(st.state === 'error' && st.message).not.toContain('SECRET-DETAIL-ZZ');
    expect(st).toMatchObject({ state: 'error', message: 'The browser connection could not start; save Settings to try again', code: 'serverStartFailed' });
  });

  it('never rejects: a listen that throws at once (a port out of range) is an error status', async () => {
    const b = await bootServer({ port: 70000 });
    expect(b.running.status().state).toBe('error');
    expect(b.running.status()).toMatchObject({ message: 'The browser connection could not start; save Settings to try again', code: 'serverStartFailed' });
  });

  it('never rejects: a createServer that throws is an error status', async () => {
    const b = await bootServer({
      createServerOverride: () => {
        throw new Error('SECRET-DETAIL-ZZ');
      },
    });
    const st = b.running.status();
    expect(st.state).toBe('error');
    expect(st.state === 'error' && st.message).not.toContain('SECRET-DETAIL-ZZ');
    expect(st).toMatchObject({ message: 'The browser connection could not start; save Settings to try again', code: 'serverStartFailed' });
  });

  it('a normal start leaves no deadline behind: advancing the clock far past 3000 ms keeps it listening', async () => {
    const b = await bootServer({ port: await freePort() });
    b.clock.advance(60_000);
    await sleep(30);
    expect(b.running.status().state).toBe('listening');
  });

  it('the start answers before the deadline when the listen is quick: nothing waits for 3000 ms', async () => {
    const t0 = Date.now();
    await bootServer({ port: await freePort() });
    expect(Date.now() - t0).toBeLessThan(2500);
  });
});

describe('a listen that never answers (S16, R2-2)', () => {
  /** A server whose listen call is swallowed; `late()` performs the real listen afterwards. */
  async function pending() {
    const port = await freePort();
    let late: () => void = () => undefined;
    let pendingServer: http.Server | null = null;
    let closeSpy: ReturnType<typeof vi.spyOn> | null = null;
    const p = await prepareServer({
      port,
      onServer: (s) => {
        const real = s.listen as unknown as Listen;
        pendingServer = s;
        closeSpy = vi.spyOn(s, 'close');
        // The swallowed call is replayed later with exactly the arguments the code under test gave (a listening
        // callback or not): the code may wait for the callback or for the 'listening' event, either way it is told.
        setListen(s, (...args: unknown[]) => {
          late = () => void real.apply(s, args);
          return s;
        });
      },
    });
    let result: ServerStatus | undefined;
    const started = p.start().then((r) => {
      result = r.status();
      return r;
    });
    return { p, port, started, result: () => result, late: () => late(), server: () => pendingServer, closeSpy: () => closeSpy };
  }

  it('answers with an error at 3000 ms of the injected clock, not before', async () => {
    const x = await pending();
    await sleep(50);
    expect(x.result()).toBeUndefined();
    expect(x.p.clock.pending()).toContain(3000);
    x.p.clock.advance(2999);
    await sleep(30);
    expect(x.result()).toBeUndefined();
    x.p.clock.advance(1);
    const running = await within(x.started, 2000, 'start');
    expect(running.status().state).toBe('error');
    const st = running.status();
    expect(st.state === 'error' && st.message.length).toBeGreaterThan(0);
    // serverStartFailed: the listen deadline gives the start-failed text and code.
    expect(st).toMatchObject({ state: 'error', message: 'The browser connection could not start; save Settings to try again', code: 'serverStartFailed' });
  });

  it('closes the pending server at the deadline and discards a late "listening": no socket is left listening', async () => {
    const x = await pending();
    await sleep(30);
    x.p.clock.advance(3000);
    const running = await within(x.started, 2000, 'start');
    expect(x.closeSpy()).toHaveBeenCalled();
    // the listen finally succeeds, after the deadline
    x.late();
    await sleep(100);
    expect(await refusesConnections(x.port, 3000), 'the late socket must be closed').toBe(true);
    expect(running.status().state).toBe('error');
  });

  it('after the deadline the status stays error, even once the late listen has happened', async () => {
    const x = await pending();
    await sleep(30);
    x.p.clock.advance(3000);
    const running = await within(x.started, 2000, 'start');
    x.late();
    await sleep(150);
    expect(running.status().state).toBe('error');
  });
});

describe('ensure (S13)', () => {
  it('on the same port while listening builds no server and returns listening', async () => {
    const p1 = await freePort();
    const b = await bootServer({ port: p1 });
    expect(b.servers).toHaveLength(1);
    expect(await b.running.ensure(p1)).toEqual({ state: 'listening', port: p1 });
    expect(b.servers).toHaveLength(1);
    expect(b.createOptions).toHaveLength(1);
    // the same socket still serves
    const reply = await send(p1, { method: 'POST', target: '/nope', headers: [['Host', `127.0.0.1:${p1}`], ['Origin', ORIGIN_A], ['Content-Type', 'application/json'], ['Content-Length', '2']], body: '{}' });
    expect(reply.status).toBe(404);
  });

  it('on the same port while listening does not cancel an open code (it is not leaving listening)', async () => {
    const p1 = await freePort();
    const b = await bootServer({ port: p1 });
    expect(b.store.open().ok).toBe(true);
    await b.running.ensure(p1);
    expect(b.store.codeOpen()).toBe(true);
  });

  it('on a freed busy port gives listening', async () => {
    const held = await holdPort();
    const b = await bootServer({ port: held.port });
    expect(b.running.status()).toEqual({ state: 'portBusy', port: held.port });
    await held.release();
    const st = await within(b.running.ensure(held.port), 3000, 'ensure');
    expect(st).toEqual({ state: 'listening', port: held.port });
    expect(b.running.status()).toEqual({ state: 'listening', port: held.port });
    expect(b.servers).toHaveLength(2);
    const reply = await send(held.port, { method: 'POST', target: '/nope', headers: [['Host', `127.0.0.1:${held.port}`], ['Origin', ORIGIN_A], ['Content-Type', 'application/json'], ['Content-Length', '2']], body: '{}' });
    expect(reply.status).toBe(404);
  });

  it('on a still busy port stays portBusy and builds a new server each time (saving Settings retries)', async () => {
    const held = await holdPort();
    try {
      const b = await bootServer({ port: held.port });
      expect(await within(b.running.ensure(held.port), 3000, 'ensure')).toEqual({ state: 'portBusy', port: held.port });
      expect(b.servers).toHaveLength(2);
      expect(await within(b.running.ensure(held.port), 3000, 'ensure')).toEqual({ state: 'portBusy', port: held.port });
      expect(b.servers).toHaveLength(3);
    } finally {
      await held.release();
    }
  });

  it('with a new port: the old port refuses connections, the new one answers, and an open old connection is destroyed', async () => {
    const [p1, p2] = await twoPorts();
    const b = await bootServer({ port: p1 });
    const oldConn = await new RawConn(p1).connected();
    oldConn.write(`POST /v1/status HTTP/1.1\r\nHost: 127.0.0.1:${p1}\r\n`); // an unfinished request
    await sleep(50);
    const st = await within(b.running.ensure(p2), 3000, 'ensure');
    expect(st).toEqual({ state: 'listening', port: p2 });
    expect(b.running.status()).toEqual({ state: 'listening', port: p2 });
    await oldConn.waitClosed(2000);
    expect(await refusesConnections(p1, 3000)).toBe(true);
    const reply = await send(p2, { method: 'POST', target: '/nope', headers: [['Host', `127.0.0.1:${p2}`], ['Origin', ORIGIN_A], ['Content-Type', 'application/json'], ['Content-Length', '2']], body: '{}' });
    expect(reply.status).toBe(404);
    expect(b.servers).toHaveLength(2);
    expect((b.servers[1]?.address() as { port: number }).port).toBe(p2);
  });

  it('after a move, the Host rule follows the new port: the old port in Host is bad_host', async () => {
    const [p1, p2] = await twoPorts();
    const b = await bootServer({ port: p1 });
    await within(b.running.ensure(p2), 3000, 'ensure');
    const stale = await send(p2, { method: 'POST', target: '/nope', headers: [['Host', `127.0.0.1:${p1}`], ['Origin', ORIGIN_A], ['Content-Type', 'application/json'], ['Content-Length', '2']], body: '{}' });
    expect(stale.status).toBe(403);
    expect(JSON.parse(stale.body)).toEqual({ error: 'bad_host' });
  });

  it('the old instance gets close() and closeAllConnections(), and ensure does not wait for it', async () => {
    const [p1, p2] = await twoPorts();
    const b = await bootServer({ port: p1 });
    const old = b.servers[0];
    if (!old) throw new Error('no server');
    const closeSpy = vi.spyOn(old, 'close');
    const closeAll = vi.spyOn(old, 'closeAllConnections');
    await within(b.running.ensure(p2), 3000, 'ensure');
    expect(closeSpy).toHaveBeenCalled();
    expect(closeAll).toHaveBeenCalled();
  });

  it('is not awaited: a close that never completes does not hold the move up', async () => {
    const [p1, p2] = await twoPorts();
    const b = await bootServer({ port: p1 });
    const old = b.servers[0];
    if (!old) throw new Error('no server');
    (old as unknown as { close: () => http.Server }).close = () => old; // never emits 'close'
    (old as unknown as { closeAllConnections: () => void }).closeAllConnections = () => undefined;
    const st = await within(b.running.ensure(p2), 3000, 'ensure');
    expect(st).toEqual({ state: 'listening', port: p2 });
  });

  it('a busy new port gives portBusy and the old port stays closed (it is not re-bound)', async () => {
    const p1 = await freePort();
    const held = await holdPort();
    try {
      const b = await bootServer({ port: p1 });
      const st = await within(b.running.ensure(held.port), 3000, 'ensure');
      expect(st).toEqual({ state: 'portBusy', port: held.port });
      expect(b.running.status()).toEqual({ state: 'portBusy', port: held.port });
      expect(await refusesConnections(p1, 3000)).toBe(true);
      expect(b.servers).toHaveLength(2);
      expect(b.servers[1]?.listening).toBe(false);
    } finally {
      await held.release();
    }
  });

  it('moving on several times leaves only the last port listening', async () => {
    const [p1, p2, p3] = await threePorts();
    const b = await bootServer({ port: p1 });
    await within(b.running.ensure(p2), 3000, 'ensure');
    await within(b.running.ensure(p3), 3000, 'ensure');
    expect(b.running.status()).toEqual({ state: 'listening', port: p3 });
    expect(await refusesConnections(p1, 3000)).toBe(true);
    expect(await refusesConnections(p2, 3000)).toBe(true);
  });

  it('after a port move, the new listener serves registered routes (the same table)', async () => {
    const [p1, p2] = await twoPorts();
    const b = await bootServer({ port: p1 });
    await within(b.running.ensure(p2), 3000, 'ensure');
    const body = JSON.stringify({ pairingId: 'A'.repeat(22), nonce: 'n'.repeat(43) });
    const reply = await send(p2, { method: 'POST', target: '/v1/hello', headers: [['Host', `127.0.0.1:${p2}`], ['Origin', ORIGIN_A], ['Content-Type', 'application/json'], ['Content-Length', String(body.length)]], body });
    expect(reply.status).toBe(404); // a real route answers
    expect(JSON.parse(reply.body)).toEqual({ error: 'unknown_pairing' });
  });

  it('a move makes the new listener take its port from address().port in the status and the proofs', async () => {
    const [p1, p2] = await twoPorts();
    const b = await bootServer({ port: p1 });
    await within(b.running.ensure(p2), 3000, 'ensure');
    expect(b.port()).toBe(p2);
    const p = b.pair();
    expect(b.disk.last?.pairings.find((x) => x.id === p.pairingId)?.port).toBe(p2);
  });
});

describe('leaving `listening` cancels an open code', () => {
  it('an error event after listening gives error and cancels the open code', async () => {
    const p1 = await freePort();
    const b = await bootServer({ port: p1 });
    expect(b.store.open().ok).toBe(true);
    expect(b.store.codeOpen()).toBe(true);
    b.servers[0]?.emit('error', Object.assign(new Error('SECRET-DETAIL-ZZ'), { code: 'EIO' }));
    const st = b.running.status();
    expect(st.state).toBe('error');
    expect(st.state === 'error' && st.message.length).toBeGreaterThan(0);
    expect(st.state === 'error' && st.message).not.toContain('SECRET-DETAIL-ZZ');
    expect(st).toMatchObject({ message: 'The browser connection stopped working; save Settings to start it again', code: 'serverBroken' });
    expect(b.store.codeOpen()).toBe(false);
    expect(b.store.open().ok).toBe(false); // not listening: pairing is offered no more
  });

  it('after an error event, ensure with another port listens again', async () => {
    const [p1, p2] = await twoPorts();
    const b = await bootServer({ port: p1 });
    b.servers[0]?.emit('error', Object.assign(new Error('x'), { code: 'EIO' }));
    expect(b.running.status().state).toBe('error');
    expect(await within(b.running.ensure(p2), 3000, 'ensure')).toEqual({ state: 'listening', port: p2 });
  });

  it('stop cancels the open code', async () => {
    const p1 = await freePort();
    const b = await bootServer({ port: p1 });
    expect(b.store.open().ok).toBe(true);
    await within(b.running.stop(), 3000, 'stop');
    expect(b.store.codeOpen()).toBe(false);
  });

  it('a port move cancels the open code', async () => {
    const [p1, p2] = await twoPorts();
    const b = await bootServer({ port: p1 });
    expect(b.store.open().ok).toBe(true);
    await within(b.running.ensure(p2), 3000, 'ensure');
    expect(b.store.codeOpen()).toBe(false);
  });

  it('a move to a busy port cancels it too (it left listening)', async () => {
    const p1 = await freePort();
    const held = await holdPort();
    try {
      const b = await bootServer({ port: p1 });
      expect(b.store.open().ok).toBe(true);
      await within(b.running.ensure(held.port), 3000, 'ensure');
      expect(b.store.codeOpen()).toBe(false);
    } finally {
      await held.release();
    }
  });

  it('pairing cannot be opened again until the server is listening: portBusy refuses', async () => {
    const held = await holdPort();
    try {
      const b = await bootServer({ port: held.port });
      expect(b.store.open().ok).toBe(false);
    } finally {
      await held.release();
    }
  });
});

describe('stop', () => {
  it('during an open request destroys the socket and resolves; the port is released', async () => {
    const p1 = await freePort();
    const b = await bootServer({ port: p1 });
    const conn = await new RawConn(p1).connected();
    conn.write(`POST /v1/status HTTP/1.1\r\nHost: 127.0.0.1:${p1}\r\nContent-Length: 10\r\n\r\n{`);
    await sleep(50);
    await within(b.running.stop(), 3000, 'stop');
    await conn.waitClosed(2000);
    expect(await refusesConnections(p1, 3000)).toBe(true);
  });

  it('twice resolves', async () => {
    const p1 = await freePort();
    const b = await bootServer({ port: p1 });
    await within(b.running.stop(), 3000, 'stop');
    await within(b.running.stop(), 3000, 'second stop');
  });

  it('on a server that never listened (portBusy) resolves', async () => {
    const held = await holdPort();
    try {
      const b = await bootServer({ port: held.port });
      await within(b.running.stop(), 3000, 'stop');
      await within(b.running.stop(), 3000, 'second stop');
    } finally {
      await held.release();
    }
  });

  it('clears the 30 s retry timer (R2-7): no write is attempted after it', async () => {
    const p1 = await freePort();
    const b = await bootServer({ port: p1 });
    b.disk.failing = true;
    b.pair(); // the write fails: unsaved, a 30 s retry is armed
    expect(b.store.view().unsaved).toBe(true);
    expect(b.clock.pending()).toContain(30_000);
    await within(b.running.stop(), 3000, 'stop');
    b.disk.failing = false;
    const attempts = b.disk.attempts;
    b.clock.advance(120_000);
    expect(b.disk.attempts).toBe(attempts);
  });

  it('then flush() still writes what was unsaved (the quit order of R2-7: stop first, flush after)', async () => {
    const p1 = await freePort();
    const b = await bootServer({ port: p1 });
    b.disk.failing = true;
    b.pair();
    await within(b.running.stop(), 3000, 'stop');
    b.disk.failing = false;
    b.store.flush();
    expect(b.disk.last?.pairings).toHaveLength(1);
    expect(b.store.view().unsaved).toBe(false);
  });

  // Review 1, F4. While an ensure's listen is pending, `current` is already null, so stop() found nothing to close
  // and left the 3000 ms listen deadline armed. stop() must cancel the pending attempt in its synchronous block:
  // settle it (which clears the deadline), then close() and closeAllConnections() that server.
  it('while a listen is pending (F4): closes that server and clears its 3000 ms deadline in the same tick, and the ensure resolves', async () => {
    const [p1, p2] = await twoPorts();
    let late: () => void = () => undefined;
    const spies: { close: ReturnType<typeof vi.spyOn> | null; closeAll: ReturnType<typeof vi.spyOn> | null } = { close: null, closeAll: null };
    const b = await bootServer({
      port: p1,
      onServer: (s, nth) => {
        if (nth !== 1) return;
        // The second server's listen is swallowed (as in pending()); `late()` performs it afterwards with the same arguments.
        const real = s.listen as unknown as Listen;
        spies.close = vi.spyOn(s, 'close');
        spies.closeAll = vi.spyOn(s, 'closeAllConnections');
        setListen(s, (...args: unknown[]) => {
          late = () => void real.apply(s, args);
          return s;
        });
      },
    });
    expect(b.running.status()).toEqual({ state: 'listening', port: p1 });

    const moving = b.running.ensure(p2);
    await sleep(30);
    expect(b.servers, 'the listener for p2 was created and is waiting').toHaveLength(2);
    expect(b.clock.pending()).toContain(3000);
    expect(spies.close).not.toHaveBeenCalled();

    const stopping = b.running.stop(); // not awaited: everything up to the next await is one synchronous block
    expect(spies.close, 'close() on the pending server').toHaveBeenCalled();
    expect(spies.closeAll, 'closeAllConnections() on the pending server').toHaveBeenCalled();
    expect(b.clock.pending(), 'the listen deadline is cleared').not.toContain(3000);
    expect(b.running.status().state).toBe('error');

    const [moved] = await within(Promise.all([moving, stopping]), 2000, 'the pending ensure and stop');
    expect(moved.state).not.toBe('listening');
    expect(b.running.status().state).toBe('error');

    // The swallowed listen finally happens: the late 'listening' is discarded and nothing keeps the port.
    late();
    await sleep(100);
    expect(await refusesConnections(p2, 3000), 'the late socket must be closed').toBe(true);
    const after = b.running.status();
    b.clock.advance(3000);
    await sleep(30);
    expect(b.running.status()).toEqual(after);
    expect(b.store.open().ok).toBe(false); // nothing is listening, so no code can be opened
  });

  // Review 2, finding 3. The 'listening' callback settles the attempt (so there is nothing left to cancel), but the
  // continuation of ensure, which makes the server `current`, runs a microtask later. A stop() in between found no
  // server to close, so the bound server got no close() before stop's first await. The server stays owned until
  // `current` has it, and stop() closes it in its own synchronous block and awaits its 'close'.
  it("listening emitted, stop before ensure's continuation: the bound server gets close() and closeAllConnections() before stop's first await", async () => {
    const [p1, p2] = await twoPorts();
    const spies: { close: ReturnType<typeof vi.spyOn> | null; closeAll: ReturnType<typeof vi.spyOn> | null } = { close: null, closeAll: null };
    const run: { current: RunningServer | null } = { current: null };
    const seen: { stopping: Promise<void> | null; closeCalled: boolean; closeAllCalled: boolean; state: string | null; deadlineArmed: boolean | null } = {
      stopping: null,
      closeCalled: false,
      closeAllCalled: false,
      state: null,
      deadlineArmed: null,
    };
    let boundClosed = false;
    const b = await bootServer({
      port: p1,
      onServer: (s, nth) => {
        if (nth !== 1) return; // the second server: the one the move to p2 binds
        spies.close = vi.spyOn(s, 'close');
        spies.closeAll = vi.spyOn(s, 'closeAllConnections');
        s.once('close', () => {
          boundClosed = true;
        });
        const real = s.listen as unknown as Listen;
        setListen(s, (...args: unknown[]) => {
          // Added just before the real listen, so it is registered after the app's own 'listening' listener and runs
          // right after it: the attempt is already settled, the continuation of ensure has not run yet.
          s.once('listening', () => {
            seen.stopping = run.current?.stop() ?? null;
            // Right after stop() returned, still inside the 'listening' emit: stop's first await has not happened.
            seen.closeCalled = (spies.close?.mock.calls.length ?? 0) > 0;
            seen.closeAllCalled = (spies.closeAll?.mock.calls.length ?? 0) > 0;
            seen.state = run.current?.status().state ?? null;
            seen.deadlineArmed = b.clock.pending().includes(3000);
          });
          return real.apply(s, args);
        });
      },
    });
    run.current = b.running;
    expect(b.running.status()).toEqual({ state: 'listening', port: p1 });

    const moving = b.running.ensure(p2);
    const moved = await within(moving, 3000, 'ensure');
    expect(seen.stopping, 'the spec stopped the server from the listening listener').not.toBeNull();
    expect(seen.closeCalled, "close() on the bound server, before stop's first await").toBe(true);
    expect(seen.closeAllCalled, "closeAllConnections() on the bound server, before stop's first await").toBe(true);
    expect(seen.state).toBe('error');
    expect(seen.deadlineArmed, 'the listen deadline is cleared').toBe(false);

    if (!seen.stopping) throw new Error('stop was never called');
    await within(seen.stopping, 2000, 'stop');
    expect(boundClosed, "stop resolves once the bound server emitted 'close'").toBe(true);
    expect(moved.state).not.toBe('listening');
    expect(b.running.status().state).toBe('error');
    expect(await refusesConnections(p2, 3000), 'nothing keeps the new port').toBe(true);
    expect(b.store.open().ok).toBe(false); // nothing is listening, so no code can be opened
  });

  // The same interleaving, for the promise that comes with the synchronous close: stop() resolves only once the bound
  // server has emitted 'close'. Node emits 'close' on a nextTick, before any microtask, so the spec defers the real
  // close() by 40 ms; a stop() that does not await the bound server then settles in a microtask, long before it.
  // (Mutation survivor of the first version of this spec: "stop() does not await the close of a handover server".)
  it("listening emitted, stop before ensure's continuation: stop resolves only after the bound server emitted 'close'", async () => {
    const [p1, p2] = await twoPorts();
    const run: { current: RunningServer | null } = { current: null };
    const seen: { stopping: Promise<void> | null } = { stopping: null };
    let stopSettled = false;
    let closeEmitted = false;
    const b = await bootServer({
      port: p1,
      onServer: (s, nth) => {
        if (nth !== 1) return;
        const realClose = s.close.bind(s) as (cb?: (err?: Error) => void) => http.Server;
        (s as unknown as { close: (cb?: (err?: Error) => void) => http.Server }).close = (cb) => {
          setTimeout(() => realClose(cb), 40);
          return s;
        };
        s.once('close', () => {
          closeEmitted = true;
        });
        const real = s.listen as unknown as Listen;
        setListen(s, (...args: unknown[]) => {
          s.once('listening', () => {
            seen.stopping =
              run.current?.stop().then(() => {
                stopSettled = true;
              }) ?? null;
          });
          return real.apply(s, args);
        });
      },
    });
    run.current = b.running;

    await within(b.running.ensure(p2), 3000, 'ensure');
    expect(seen.stopping, 'the spec stopped the server from the listening listener').not.toBeNull();
    expect(closeEmitted, 'the deferred close() has not happened yet').toBe(false);
    expect(stopSettled, "stop() waits for the bound server's 'close'").toBe(false);

    if (!seen.stopping) throw new Error('stop was never called');
    await within(seen.stopping, 2000, 'stop');
    expect(closeEmitted).toBe(true);
    expect(await refusesConnections(p2, 3000)).toBe(true);
  });

  // The quit path after a listener is gone: stop() must still resolve once `current` is null (a move that ended
  // portBusy, an error event on the listener). `handover` is cleared once `current` has the server, so there is
  // nothing to wait for. These pin the behaviour; they cannot tell a stale `handover` from a cleared one, because
  // Node emits 'close' again on a repeated close() (probed on 24.14.1), so a stale reference would not hang either.
  it('after a move to a busy port, stop resolves', async () => {
    const p1 = await freePort();
    const held = await holdPort();
    try {
      const b = await bootServer({ port: p1 });
      expect(await within(b.running.ensure(held.port), 3000, 'ensure')).toEqual({ state: 'portBusy', port: held.port });
      await within(b.running.stop(), 2000, 'stop');
      expect(b.running.status().state).toBe('error');
    } finally {
      await held.release();
    }
  });

  it('after an error event on the listener (current is gone), stop resolves', async () => {
    const p1 = await freePort();
    const b = await bootServer({ port: p1 });
    b.servers[0]?.emit('error', Object.assign(new Error('x'), { code: 'EIO' }));
    expect(b.running.status().state).toBe('error');
    await within(b.running.stop(), 2000, 'stop');
  });

  // R2-7 and the quit order: stop(), then flush() in the same tick. Everything stop() has to do happens before its
  // first await, so a flush that follows it sees the final state.
  it('does its work before the first await: spies, code and retry timer are done in the same tick, and a flush right after writes', async () => {
    const p1 = await freePort();
    const b = await bootServer({ port: p1 });
    const server = b.servers[0];
    if (!server) throw new Error('no server');
    const closeSpy = vi.spyOn(server, 'close');
    const closeAll = vi.spyOn(server, 'closeAllConnections');
    b.disk.failing = true;
    b.pair(); // the write fails: unsaved, a 30 s retry is armed
    expect(b.store.open().ok).toBe(true); // a code is open
    expect(b.store.codeOpen()).toBe(true);
    expect(b.clock.pending()).toContain(30_000);

    const stopping = b.running.stop(); // not awaited
    expect(closeSpy).toHaveBeenCalled();
    expect(closeAll).toHaveBeenCalled();
    expect(b.store.codeOpen()).toBe(false);
    expect(b.clock.pending()).not.toContain(30_000);
    expect(b.running.status().state).not.toBe('listening');

    b.disk.failing = false;
    b.store.flush(); // still the same tick
    expect(b.disk.last?.pairings).toHaveLength(1);
    expect(b.store.view().unsaved).toBe(false);

    await within(stopping, 3000, 'stop');
    expect(await refusesConnections(p1, 3000)).toBe(true);
  });
});

// Task D, item 1 (frozen plan docs/plans/2026-11-23-d-housekeeping.md, "Item 1").
// An 'error' between 'listening' (which settles the attempt and sets `handover`) and the continuation of ensure
// (which makes the server `current`) used to be ignored: ensure then reported `listening` for a failed server. Now the
// gap error takes the listen-error path (EADDRINUSE -> portBusy, EACCES -> the port text, anything else -> the
// start-failed text), the failed server is shut in the same tick and the attempt ends as that failure.
// Error statuses are asserted with toMatchObject({ state, message, code }): commit B added the `code` of each.
const START_FAILED = 'The browser connection could not start; save Settings to try again';
const BROKEN = 'The browser connection stopped working; save Settings to start it again';
const STARTING = 'The browser connection is starting';
const STOPPED = 'The browser connection is stopped';
const portText = (port: number): string => `port ${port} cannot be used on this PC; choose another in Settings`;

/**
 * Runs `act(s)` from a 'listening' listener added just before the real listen call (pattern of the F4 specs above).
 * It is registered after the app's own 'listening' listener, so it runs right after it: the attempt is settled and
 * `handover` is set, but the continuation of ensure has not run yet. This is the handover gap.
 */
function inGap(s: http.Server, act: (s: http.Server) => void): void {
  const real = s.listen as unknown as Listen;
  setListen(s, (...args: unknown[]) => {
    s.once('listening', () => act(s));
    return real.apply(s, args);
  });
}

/** An error with the given `code` (none when undefined) and a message that must never reach a status. */
const gapError = (code?: string | number, message = 'SECRET-DETAIL-ZZ'): Error => Object.assign(new Error(message), code === undefined ? {} : { code });

/**
 * A server listening on p1 whose NEXT server (the one a move to p2 builds) runs `act(server, running)` in the gap.
 * Nothing moves until the spec calls `ensure(p2)`.
 */
async function bootForGap(act: (s: http.Server, running: RunningServer) => void) {
  const [p1, p2] = await twoPorts();
  const box: { running: RunningServer | null } = { running: null };
  const b = await bootServer({
    port: p1,
    onServer: (s, nth) => {
      if (nth !== 1) return; // the second server: the one the move to p2 binds
      inGap(s, (server) => {
        if (box.running) act(server, box.running);
      });
    },
  });
  box.running = b.running;
  expect(b.running.status(), 'the first server listens normally').toEqual({ state: 'listening', port: p1 });
  return { b, p1, p2 };
}

describe('an error between "listening" and the handover (Task D, item 1)', () => {
  it('1. a move whose new server fails in the gap: ensure resolves with the start-failed error, and status() says the same', async () => {
    const { b, p2 } = await bootForGap((s) => {
      s.emit('error', gapError('EIO'));
    });
    const st = await within(b.running.ensure(p2), 3000, 'ensure');
    expect(st).toMatchObject({ state: 'error', message: START_FAILED, code: 'serverStartFailed' });
    expect(b.running.status()).toEqual(st);
    expect(b.running.status()).toMatchObject({ state: 'error', message: START_FAILED, code: 'serverStartFailed' });
  });

  it('2. inside the gap, right after the error, status() is still the starting error (never listening)', async () => {
    const seen: { status: ServerStatus | null } = { status: null };
    const { b, p2 } = await bootForGap((s, running) => {
      s.emit('error', gapError('EIO'));
      seen.status = running.status();
    });
    await within(b.running.ensure(p2), 3000, 'ensure');
    expect(seen.status).not.toBeNull();
    expect(seen.status).toMatchObject({ state: 'error', message: STARTING, code: 'serverStarting' });
  });

  it('3. the failed server is shut in the same tick (close() and closeAllConnections() before the emit returns), and its port is released', async () => {
    const seen = { closeCalls: -1, closeAllCalls: -1 };
    const { b, p2 } = await bootForGap((s) => {
      const close = vi.spyOn(s, 'close');
      const closeAll = vi.spyOn(s, 'closeAllConnections');
      s.emit('error', gapError('EIO'));
      seen.closeCalls = close.mock.calls.length;
      seen.closeAllCalls = closeAll.mock.calls.length;
    });
    await within(b.running.ensure(p2), 3000, 'ensure');
    expect(seen.closeCalls, 'close() on the failed server, before the emit returned').toBeGreaterThanOrEqual(1);
    expect(seen.closeAllCalls, 'closeAllConnections() on the failed server, before the emit returned').toBeGreaterThanOrEqual(1);
    expect(await refusesConnections(p2, 3000), 'nothing keeps the new port').toBe(true);
    expect(b.servers[1]?.listening).toBe(false);
  });

  // The mapping is the listen-error one (D1.1), not BROKEN_TEXT: no caller ever saw this server listening.
  it.each<[string, string | number | undefined, (port: number) => object]>([
    ['EADDRINUSE: portBusy with the requested port', 'EADDRINUSE', (port) => ({ state: 'portBusy', port })],
    ['EACCES: the port text naming the requested port', 'EACCES', (port) => ({ state: 'error', message: portText(port), code: 'portUnusable', port })],
    ['EIO: the start-failed text', 'EIO', () => ({ state: 'error', message: START_FAILED, code: 'serverStartFailed' })],
    ['EPERM: the start-failed text', 'EPERM', () => ({ state: 'error', message: START_FAILED, code: 'serverStartFailed' })],
    ['an error with no code: the start-failed text', undefined, () => ({ state: 'error', message: START_FAILED, code: 'serverStartFailed' })],
    ['a lower-case "eaddrinuse" is not EADDRINUSE: the start-failed text', 'eaddrinuse', () => ({ state: 'error', message: START_FAILED, code: 'serverStartFailed' })],
    ['a numeric code is not a known code: the start-failed text', 98, () => ({ state: 'error', message: START_FAILED, code: 'serverStartFailed' })],
  ])('4. %s', async (_name, code, want) => {
    const { b, p2 } = await bootForGap((s) => {
      s.emit('error', gapError(code));
    });
    const st = await within(b.running.ensure(p2), 3000, 'ensure');
    expect(st).toMatchObject(want(p2));
    expect(b.running.status()).toEqual(st);
    expect(JSON.stringify(st), 'no detail of the error reaches the status').not.toContain('SECRET-DETAIL-ZZ');
  });

  it('5. the same on the first server: start() resolves with the start-failed error, not listening', async () => {
    const p1 = await freePort();
    const p = await prepareServer({
      port: p1,
      onServer: (s) => {
        inGap(s, (server) => {
          server.emit('error', gapError('EIO'));
        });
      },
    });
    const running = await within(p.start(), 3000, 'start');
    expect(running.status()).toMatchObject({ state: 'error', message: START_FAILED, code: 'serverStartFailed' });
    expect(p.store.open().ok, 'pairing is not offered on a failed server').toBe(false);
    expect(await refusesConnections(p1, 3000), 'nothing keeps the port').toBe(true);
  });

  it('6. no code can be opened on the failed server, and once its port is released ensure listens on a third server', async () => {
    const { b, p2 } = await bootForGap((s) => {
      s.emit('error', gapError('EIO'));
    });
    expect(b.store.open().ok, 'a code is open on p1 before the move').toBe(true);
    const failed = await within(b.running.ensure(p2), 3000, 'ensure');
    expect(failed.state).toBe('error');
    expect(b.store.codeOpen(), 'the move cancelled the code').toBe(false);
    expect(b.store.open().ok, 'pairing is not offered while the status is error').toBe(false);
    expect(b.store.codeOpen()).toBe(false);
    // The failed server's close is not awaited: wait for the port before asking for it again.
    expect(await refusesConnections(p2, 3000), 'the failed server released p2').toBe(true);
    expect(await within(b.running.ensure(p2), 3000, 'ensure')).toEqual({ state: 'listening', port: p2 });
    expect(b.servers).toHaveLength(3);
    expect(b.servers[2]?.listening).toBe(true);
    expect(b.store.open().ok, 'listening again: pairing is offered').toBe(true);
  });

  it('7a. a second error on the revoked server in the same gap changes nothing: it is shut once, not again', async () => {
    const seen = { closeCalls: -1 };
    const { b, p2 } = await bootForGap((s) => {
      const close = vi.spyOn(s, 'close');
      s.emit('error', gapError('EIO'));
      s.emit('error', gapError('EACCES'));
      seen.closeCalls = close.mock.calls.length;
    });
    const st = await within(b.running.ensure(p2), 3000, 'ensure');
    expect(st).toMatchObject({ state: 'error', message: START_FAILED, code: 'serverStartFailed' }); // the first error decided, the second is ignored
    expect(seen.closeCalls, 'the revoked server is not shut a second time').toBe(1);
  });

  it('7b. a second error on the revoked server, before and after a successful ensure, changes nothing', async () => {
    const { b, p2 } = await bootForGap((s) => {
      s.emit('error', gapError('EIO'));
    });
    const failed = await within(b.running.ensure(p2), 3000, 'ensure');
    expect(failed).toMatchObject({ state: 'error', message: START_FAILED, code: 'serverStartFailed' });
    const revoked = b.servers[1];
    if (!revoked) throw new Error('no second server');

    // Before: the status is the failure, and a late error does not turn it into BROKEN_TEXT or anything else.
    revoked.emit('error', gapError('EIO'));
    expect(b.running.status()).toEqual(failed);

    expect(await refusesConnections(p2, 3000), 'the failed server released p2').toBe(true);
    expect(await within(b.running.ensure(p2), 3000, 'ensure')).toEqual({ state: 'listening', port: p2 });
    const live = b.servers[2];
    if (!live) throw new Error('no third server');
    expect(b.store.open().ok).toBe(true);

    // After: the live listener, its status and the open code are untouched.
    revoked.emit('error', gapError('EIO'));
    revoked.emit('error', gapError('EADDRINUSE'));
    expect(b.running.status()).toEqual({ state: 'listening', port: p2 });
    expect(live.listening).toBe(true);
    expect(b.store.codeOpen(), 'the open code is not cancelled by an error of a revoked server').toBe(true);
    const reply = await send(p2, { method: 'POST', target: '/nope', headers: [['Host', `127.0.0.1:${p2}`], ['Origin', ORIGIN_A], ['Content-Type', 'application/json'], ['Content-Length', '2']], body: '{}' });
    expect(reply.status).toBe(404);
  });

  // The third branch is for `server === handover` only: an error of an older, revoked server that arrives while another
  // server is in its gap must not take that gap's `handover` away (stop() would then not close the bound server).
  it('7c. an error on an older revoked server during a later gap leaves that gap alone: stop() still closes the server in it', async () => {
    const [p1, p2] = await twoPorts();
    const box: { running: RunningServer | null; revoked: http.Server | null } = { running: null, revoked: null };
    const seen = { closeCalls: -1, closeAllCalls: -1, stopping: null as Promise<void> | null };
    const b = await bootServer({
      port: p1,
      onServer: (s, nth) => {
        if (nth === 1) {
          box.revoked = s;
          inGap(s, (server) => {
            server.emit('error', gapError('EIO'));
          });
        }
        if (nth === 2) {
          inGap(s, (server) => {
            const close = vi.spyOn(server, 'close');
            const closeAll = vi.spyOn(server, 'closeAllConnections');
            box.revoked?.emit('error', gapError('EIO')); // the stray error of the first, failed server
            seen.stopping = box.running?.stop() ?? null;
            seen.closeCalls = close.mock.calls.length;
            seen.closeAllCalls = closeAll.mock.calls.length;
          });
        }
      },
    });
    box.running = b.running;
    expect((await within(b.running.ensure(p2), 3000, 'ensure')).state, 'the first move fails in its gap').toBe('error');
    expect(await refusesConnections(p2, 3000), 'the failed server released p2').toBe(true);
    const second = await within(b.running.ensure(p2), 3000, 'ensure');
    if (!seen.stopping) throw new Error('the second server never reached its gap');
    expect(seen.closeCalls, "close() on the bound server, before stop's first await").toBeGreaterThanOrEqual(1);
    expect(seen.closeAllCalls, "closeAllConnections() on the bound server, before stop's first await").toBeGreaterThanOrEqual(1);
    expect(second.state).not.toBe('listening');
    await within(seen.stopping, 2000, 'stop');
    expect(b.running.status()).toMatchObject({ state: 'error', message: STOPPED, code: 'serverStopped' });
    expect(await refusesConnections(p2, 3000), 'nothing keeps the new port').toBe(true);
  });

  it('8. stop() in the gap, then an error on that server: stop resolves and the status is the stopped text', async () => {
    const seen: { stopping: Promise<void> | null } = { stopping: null };
    const { b, p2 } = await bootForGap((s, running) => {
      seen.stopping = running.stop();
      s.emit('error', gapError('EIO'));
    });
    const moved = await within(b.running.ensure(p2), 3000, 'ensure');
    expect(moved.state).not.toBe('listening');
    if (!seen.stopping) throw new Error('stop was never called');
    await within(seen.stopping, 2000, 'stop');
    expect(b.running.status()).toMatchObject({ state: 'error', message: STOPPED, code: 'serverStopped' });
    expect(await refusesConnections(p2, 3000), 'nothing keeps the new port').toBe(true);
    expect(b.store.open().ok).toBe(false);
  });

  it('9. an error in the gap, then stop() in the same listener: stop resolves, the status is the stopped text, p2 is released', async () => {
    const seen: { stopping: Promise<void> | null } = { stopping: null };
    const { b, p2 } = await bootForGap((s, running) => {
      s.emit('error', gapError('EIO'));
      seen.stopping = running.stop();
    });
    const moved = await within(b.running.ensure(p2), 3000, 'ensure');
    expect(moved.state).not.toBe('listening');
    if (!seen.stopping) throw new Error('stop was never called');
    await within(seen.stopping, 2000, 'stop');
    expect(b.running.status()).toMatchObject({ state: 'error', message: STOPPED, code: 'serverStopped' });
    expect(await refusesConnections(p2, 3000), 'nothing keeps the new port').toBe(true);
    expect(b.store.open().ok).toBe(false);
  });

  // Edge case of the plan: after the error branch `handover` and `current` are both null, so stop() has no server to
  // await and resolves without waiting for that server's 'close'. The spec defers the real close() by 40 ms (the
  // pattern of the spec above that pins the opposite case); a stop() that still held the failed server as `handover`
  // would wait for it and settle only after the 'close'.
  it("9b. an error in the gap, then stop() in the same listener: stop does not wait for the failed server's 'close'", async () => {
    const seen = { stopSettled: false, closeEmitted: false, stopping: null as Promise<void> | null };
    const { b, p2 } = await bootForGap((s, running) => {
      const realClose = s.close.bind(s) as (cb?: (err?: Error) => void) => http.Server;
      (s as unknown as { close: (cb?: (err?: Error) => void) => http.Server }).close = (cb) => {
        setTimeout(() => realClose(cb), 40);
        return s;
      };
      s.once('close', () => {
        seen.closeEmitted = true;
      });
      s.emit('error', gapError('EIO'));
      seen.stopping = running.stop().then(() => {
        seen.stopSettled = true;
      });
    });
    await within(b.running.ensure(p2), 3000, 'ensure');
    if (!seen.stopping) throw new Error('stop was never called');
    await within(seen.stopping, 2000, 'stop');
    expect(seen.closeEmitted, 'the deferred close() has not happened yet').toBe(false);
    expect(seen.stopSettled, "stop() did not wait for the failed server's 'close'").toBe(true);
    expect(b.running.status()).toMatchObject({ state: 'error', message: STOPPED, code: 'serverStopped' });
    expect(await refusesConnections(p2, 3000), 'the failed server still gets closed').toBe(true);
  });

  it('10. boundary: an error after ensure resolved is still the broken text, and cancels the open code', async () => {
    const [p1, p2] = await twoPorts();
    const b = await bootServer({ port: p1 });
    expect(await within(b.running.ensure(p2), 3000, 'ensure')).toEqual({ state: 'listening', port: p2 });
    expect(b.store.open().ok).toBe(true);
    b.servers[1]?.emit('error', gapError('EIO'));
    expect(b.running.status()).toMatchObject({ state: 'error', message: BROKEN, code: 'serverBroken' });
    expect(JSON.stringify(b.running.status())).not.toContain('SECRET-DETAIL-ZZ');
    expect(b.store.codeOpen()).toBe(false);
    expect(await refusesConnections(p2, 3000), 'the broken server is shut').toBe(true);
  });
});

