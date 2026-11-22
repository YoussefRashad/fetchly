import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineEvent, StartContext } from '../../src/main/engines/engine';
import { MediaEngine, type Exe } from '../../src/main/engines/media';
import type { Job } from '../../src/shared/types';
import { makeJob, makeSettings } from '../helpers';
import { sleep, waitFor } from '../wait';

const FAKE: Exe = { command: process.execPath, prefixArgs: [resolve('tests/fakes/fake-ytdlp.mjs')] };
const ctx: StartContext = { settings: makeSettings(), rateLimitBytes: null };

let dir: string;
let engine: MediaEngine;
let events: EngineEvent[];
let running: Job[];

function start(scenario: string, over: Partial<Job> = {}, context: StartContext = ctx): Job {
  process.env['FAKE_YTDLP'] = scenario;
  const job = makeJob({ dir, baseName: 'Clip', ...over });
  running.push(job);
  engine.start(job, context);
  return job;
}

const ended = () => events.find((e) => e.type === 'done' || e.type === 'error');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hammel-media-'));
  engine = new MediaEngine(FAKE, 'C:\\bin\\ffmpeg.exe');
  events = [];
  running = [];
  engine.on((e) => events.push(e));
});

afterEach(async () => {
  for (const job of running) await engine.stop(job.id);
  delete process.env['FAKE_YTDLP'];
  delete process.env['FAKE_YTDLP_ARGS'];
});

describe('MediaEngine', () => {
  it('reports progress, the merge, then the finished file', async () => {
    const job = start('ok');
    await waitFor(ended);
    expect(events.map((e) => e.type)).toEqual(['progress', 'progress', 'progress', 'merging', 'done']);
    expect(events[1]).toEqual({ jobId: job.id, type: 'progress', bytesDone: 500, bytesTotal: 1000, speed: 1000, eta: 5 });
    expect(events[4]).toEqual({ jobId: job.id, type: 'done', fileName: 'Clip.mp4', actualHeight: 1080 });
  });

  it('names the file from the base name fixed on the job', async () => {
    start('ok', { baseName: '03 - Intro' });
    const done = await waitFor(ended);
    expect(done).toMatchObject({ type: 'done', fileName: '03 - Intro.mp4' });
    expect(existsSync(join(dir, '03 - Intro.mp4'))).toBe(true);
  });

  it('passes a base name containing a percent sign through intact', async () => {
    start('ok', { baseName: '100% real' });
    expect(await waitFor(ended)).toMatchObject({ type: 'done', fileName: '100% real.mp4' });
  });

  it('reports a dropped connection as a retryable failure and keeps the partial file', async () => {
    start('drop');
    expect(await waitFor(ended)).toMatchObject({
      type: 'error',
      outcome: 'failed',
      retryable: true,
      reason: 'unable to download video data: HTTP Error 503',
    });
    expect(existsSync(join(dir, 'Clip.mp4.part'))).toBe(true);
  });

  it('reports a private video as skipped', async () => {
    start('private');
    expect(await waitFor(ended)).toMatchObject({ type: 'error', outcome: 'skipped', reason: 'private', retryable: false });
  });

  it('stops a running download quietly and keeps the partial file', async () => {
    const job = start('hang');
    await waitFor(() => events.some((e) => e.type === 'progress'));
    const t0 = Date.now();
    await engine.stop(job.id);
    expect(Date.now() - t0).toBeLessThan(3000);
    const seen = events.length;
    await sleep(200);
    expect(events.length).toBe(seen); // the process is gone: no more progress
    expect(ended()).toBeUndefined();
    expect(existsSync(join(dir, 'Clip.mp4.part'))).toBe(true);
  });

  it('can start the same job again after a stop', async () => {
    const job = start('hang');
    await waitFor(() => events.some((e) => e.type === 'progress'));
    await engine.stop(job.id);
    process.env['FAKE_YTDLP'] = 'ok';
    engine.start(job, ctx);
    expect(await waitFor(ended)).toMatchObject({ type: 'done' });
  });

  it('stopping a job that is not running does nothing', async () => {
    await expect(engine.stop('nobody')).resolves.toBeUndefined();
  });

  it('discard removes only the partial files of that job', async () => {
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    writeFileSync(join(dir, 'Clip.mp4'), 'finished earlier');
    writeFileSync(join(dir, 'Clip.f137.mp4'), 'video stream');
    writeFileSync(join(dir, 'Clip.f140.m4a.part'), 'audio stream');
    writeFileSync(join(dir, 'Clip.mp4.ytdl'), 'state');
    writeFileSync(join(dir, 'Clip 2.mp4.part'), 'another job');
    const job = start('hang');
    await waitFor(() => events.some((e) => e.type === 'progress'));
    await engine.discard(job);
    expect(existsSync(join(dir, 'Clip.mp4.part'))).toBe(false);
    expect(existsSync(join(dir, 'Clip.f137.mp4'))).toBe(false);
    expect(existsSync(join(dir, 'Clip.f140.m4a.part'))).toBe(false);
    expect(existsSync(join(dir, 'Clip.mp4.ytdl'))).toBe(false);
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('mine');
    expect(readFileSync(join(dir, 'Clip.mp4'), 'utf8')).toBe('finished earlier');
    expect(existsSync(join(dir, 'Clip 2.mp4.part'))).toBe(true);
    expect(ended()).toBeUndefined();
  });

  it('discard copes with a download folder that no longer exists', async () => {
    await expect(engine.discard(makeJob({ dir: join(dir, 'gone'), baseName: 'Clip' }))).resolves.toBeUndefined();
  });

  it('fails when the process ends cleanly without producing a file', async () => {
    start('nofile');
    expect(await waitFor(ended)).toMatchObject({
      type: 'error',
      outcome: 'failed',
      reason: 'finished without a file',
      retryable: false,
    });
  });

  it('treats a clean exit as done when the finished file is already there', async () => {
    writeFileSync(join(dir, 'Clip.mkv'), 'already downloaded');
    writeFileSync(join(dir, 'Clip.en.vtt'), 'subtitles');
    start('nofile');
    expect(await waitFor(ended)).toMatchObject({ type: 'done', fileName: 'Clip.mkv', actualHeight: null });
  });

  it('says so when yt-dlp is not installed', async () => {
    engine = new MediaEngine({ command: join(dir, 'missing.exe'), prefixArgs: [] }, 'ffmpeg');
    engine.on((e) => events.push(e));
    start('ok');
    expect(await waitFor(ended)).toMatchObject({
      type: 'error',
      outcome: 'failed',
      reason: 'yt-dlp is not installed',
      retryable: false,
    });
  });

  it('passes the quality, subtitles and rate limit to yt-dlp', async () => {
    const log = join(dir, 'args.log');
    process.env['FAKE_YTDLP_ARGS'] = log;
    start(
      'ok',
      { quality: { kind: 'max', height: 720 }, subtitleLangs: ['ar'] },
      { settings: makeSettings({ preferMp4Max1080: true }), rateLimitBytes: 307200 },
    );
    await waitFor(ended);
    const args = JSON.parse(readFileSync(log, 'utf8').trim()) as string[];
    expect(args[args.indexOf('-f') + 1]).toContain('height<=720');
    expect(args[args.indexOf('--sub-langs') + 1]).toBe('ar');
    expect(args[args.indexOf('--limit-rate') + 1]).toBe('307200');
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe('C:\\bin\\ffmpeg.exe');
  });

  it('refuses to start a job that has no base name or quality', () => {
    process.env['FAKE_YTDLP'] = 'ok';
    engine.start(makeJob({ dir, baseName: null }), ctx);
    expect(events[0]).toMatchObject({ type: 'error', outcome: 'failed', retryable: false });
  });
});
