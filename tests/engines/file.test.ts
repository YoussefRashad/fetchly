import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineEvent, StartContext } from '../../src/main/engines/engine';
import { createRpcClient, FileEngine } from '../../src/main/engines/file';
import { active, complete, failed, FakeAria2 } from '../fakes/fake-aria2';
import { makeJob, makeSettings } from '../helpers';
import { sleep, waitFor } from '../wait';

const ctx: StartContext = { settings: makeSettings(), rateLimitBytes: null };

let dir: string;
let rpc: FakeAria2;
let engine: FileEngine;
let events: EngineEvent[];

const fileJob = (over = {}) =>
  makeJob({ kind: 'file', quality: null, baseName: null, url: 'https://example.com/x.zip', dir, fileName: 'x.zip', ...over });
const ended = () => events.find((e) => e.type === 'done' || e.type === 'error');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hammel-file-'));
  rpc = new FakeAria2();
  engine = new FileEngine(rpc, 10);
  events = [];
  engine.on((e) => events.push(e));
});

describe('FileEngine', () => {
  it('adds the download into the job folder under the job file name', async () => {
    rpc.script(complete(100));
    engine.start(fileJob(), ctx);
    await waitFor(ended);
    expect(rpc.calls[0]).toEqual({ method: 'aria2.addUri', params: [['https://example.com/x.zip'], { dir, out: 'x.zip' }] });
  });

  it('reports progress and then the finished file', async () => {
    rpc.script(active(250, 1000, 250), active(500, 1000, 0), complete(1000));
    const job = fileJob();
    engine.start(job, ctx);
    await waitFor(ended);
    expect(events).toEqual([
      { jobId: job.id, type: 'progress', bytesDone: 250, bytesTotal: 1000, speed: 250, eta: 3 },
      { jobId: job.id, type: 'progress', bytesDone: 500, bytesTotal: 1000, speed: 0, eta: null },
      { jobId: job.id, type: 'done', fileName: 'x.zip', actualHeight: null },
    ]);
  });

  it('reports an unknown size as null', async () => {
    rpc.script(active(250, 0, 100), complete(300));
    engine.start(fileJob(), ctx);
    await waitFor(ended);
    expect(events[0]).toMatchObject({ bytesTotal: null, eta: null });
  });

  it('stops polling once the download is over', async () => {
    rpc.script(complete(10));
    engine.start(fileJob(), ctx);
    await waitFor(ended);
    const polls = rpc.methods().filter((m) => m === 'aria2.tellStatus').length;
    await sleep(60);
    expect(rpc.methods().filter((m) => m === 'aria2.tellStatus').length).toBe(polls);
  });

  it.each([
    [9, 'disk full'],
    [15, 'cannot write to folder'],
    [16, 'cannot write to folder'],
    [17, 'cannot write to folder'],
    [18, 'cannot write to folder'],
    [3, 'file not found on server'],
    [24, 'login required'],
    [13, 'file already exists'],
  ])('maps aria2 error %d to "%s" without retrying', async (code, reason) => {
    rpc.script(failed(code, 'whatever aria2 said'));
    engine.start(fileJob(), ctx);
    expect(await waitFor(ended)).toMatchObject({ type: 'error', outcome: 'failed', reason, retryable: false });
  });

  it('retries any other aria2 error and passes its message on', async () => {
    rpc.script(failed(2, 'Timeout.'));
    engine.start(fileJob(), ctx);
    expect(await waitFor(ended)).toMatchObject({ type: 'error', outcome: 'failed', reason: 'Timeout.', retryable: true });
  });

  it('reports a retryable failure when aria2 cannot be reached', async () => {
    rpc.failAddUri = true;
    engine.start(fileJob(), ctx);
    expect(await waitFor(ended)).toMatchObject({ type: 'error', outcome: 'failed', retryable: true });
  });

  it('refuses a job without a file name', () => {
    engine.start(fileJob({ fileName: null }), ctx);
    expect(events[0]).toMatchObject({ type: 'error', outcome: 'failed', retryable: false });
  });

  it('stop pauses then removes the download and emits nothing more', async () => {
    rpc.script(active(10, 100, 5));
    const job = fileJob();
    engine.start(job, ctx);
    await waitFor(() => events.length > 0);
    await engine.stop(job.id);
    const seen = events.length;
    await sleep(60);
    expect(events.length).toBe(seen);
    expect(ended()).toBeUndefined();
    expect(rpc.methods().filter((m) => m !== 'aria2.tellStatus')).toEqual(['aria2.addUri', 'aria2.forcePause', 'aria2.remove']);
  });

  it('stop right after start still removes the download', async () => {
    const job = fileJob();
    engine.start(job, ctx);
    await engine.stop(job.id);
    expect(rpc.methods()).toContain('aria2.remove');
    await sleep(60);
    expect(events).toEqual([]);
  });

  it('stopping a job that is not running does nothing', async () => {
    await engine.stop('nobody');
    expect(rpc.calls).toEqual([]);
  });

  it('discard deletes the partial file and its control file', async () => {
    writeFileSync(join(dir, 'x.zip'), 'partial');
    writeFileSync(join(dir, 'x.zip.aria2'), 'control');
    await engine.discard(fileJob());
    expect(existsSync(join(dir, 'x.zip'))).toBe(false);
    expect(existsSync(join(dir, 'x.zip.aria2'))).toBe(false);
  });

  it('discard never deletes a finished file', async () => {
    writeFileSync(join(dir, 'x.zip'), 'finished');
    await engine.discard(fileJob());
    expect(existsSync(join(dir, 'x.zip'))).toBe(true);
  });

  it('sets the global speed limit, with 0 meaning unlimited', async () => {
    await engine.setGlobalLimit(512000);
    await engine.setGlobalLimit(0);
    expect(rpc.calls).toEqual([
      { method: 'aria2.changeGlobalOption', params: [{ 'max-overall-download-limit': '512000' }] },
      { method: 'aria2.changeGlobalOption', params: [{ 'max-overall-download-limit': '0' }] },
    ]);
  });
});

describe('createRpcClient', () => {
  let server: Server;
  let received: { method: string; params: unknown[] }[];
  let reply: (body: { id: string }) => object;

  beforeEach(async () => {
    received = [];
    reply = (body) => ({ jsonrpc: '2.0', id: body.id, result: 'pong' });
    server = createServer((req, res) => {
      let data = '';
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => {
        const body = JSON.parse(data) as { id: string; method: string; params: unknown[] };
        received.push({ method: body.method, params: body.params });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(reply(body)));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });

  afterEach(() => {
    server.close();
  });

  const port = () => (server.address() as AddressInfo).port;

  it('sends the secret as the first parameter and returns the result', async () => {
    const client = createRpcClient(port(), 's3cret');
    expect(await client.call('aria2.getVersion', ['a', 1])).toBe('pong');
    expect(received).toEqual([{ method: 'aria2.getVersion', params: ['token:s3cret', 'a', 1] }]);
  });

  it('rejects with the message of an RPC error', async () => {
    reply = (body) => ({ jsonrpc: '2.0', id: body.id, error: { code: 1, message: 'Unauthorized' } });
    await expect(createRpcClient(port(), 'bad').call('aria2.getVersion', [])).rejects.toThrow('Unauthorized');
  });
});
