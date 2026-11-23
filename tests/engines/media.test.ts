import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineEvent, StartContext } from '../../src/main/engines/engine';
import { isPartialOf, MediaEngine, type Exe } from '../../src/main/engines/media';
import { heightProbeArgs } from '../../src/main/ytdlp/args';
import type { Job } from '../../src/shared/types';
import { makeJob, makeSettings } from '../helpers';
import { sleep, waitFor } from '../wait';

const FAKE_PATH = resolve('tests/fakes/fake-ytdlp.mjs');
const FAKE: Exe = { command: process.execPath, prefixArgs: [FAKE_PATH] };
const ctx: StartContext = { settings: makeSettings(), rateLimitBytes: null };
/** The existing yt-dlp probe output cap (bytes). */
const PROBE_CAP = 64 * 1024 * 1024;
const UNCONFIRMED = 'could not confirm that the download stopped';

let dir: string;
let engine: MediaEngine;
let events: EngineEvent[];
let running: Job[];
/** Calls of the kill injected by makeEngine, in order. */
let kills: ChildProcess[];
/** When false, the kill injected by makeEngine does nothing (a tree that will not end). */
let killWorks: boolean;

function start(scenario: string, over: Partial<Job> = {}, context: StartContext = ctx): Job {
  process.env['FAKE_YTDLP'] = scenario;
  const job = makeJob({ dir, baseName: 'Clip', ...over });
  running.push(job);
  engine.start(job, context);
  return job;
}

/** Replaces the engine with one whose kill the test watches and can switch off. */
function makeEngine(opts: { probeTimeoutMs?: number; stopTimeoutMs?: number } = {}, exe: Exe = FAKE): MediaEngine {
  engine = new MediaEngine(exe, 'C:\\bin\\ffmpeg.exe', {
    ...opts,
    kill: (child) => {
      kills.push(child);
      if (killWorks) child.kill();
    },
  });
  engine.on((e) => events.push(e));
  return engine;
}

/** Turns on the args log and returns a reader for its lines. */
function argsLog(): () => string[][] {
  const log = join(dir, 'args.log');
  process.env['FAKE_YTDLP_ARGS'] = log;
  return () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter((l) => l !== '')
          .map((l) => JSON.parse(l) as string[])
      : [];
}

const lastLine = (lines: string[][]): string[] => {
  const line = lines.at(-1);
  if (!line) throw new Error('no args line');
  return line;
};
const valueOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

/** A yt-dlp stand-in whose height probe prints `output` verbatim; every other run is the fake. */
function scriptedProbe(output: Buffer | string): Exe {
  const outFile = join(dir, 'probe-output.bin');
  writeFileSync(outFile, output);
  const script = join(dir, 'scripted-ytdlp.mjs');
  writeFileSync(
    script,
    [
      "import { readFileSync } from 'node:fs';",
      'const args = process.argv.slice(2);',
      "if (args.includes('-J') && args.includes('--no-playlist')) process.stdout.write(readFileSync(" +
        JSON.stringify(outFile) +
        '));',
      `else await import(${JSON.stringify(pathToFileURL(FAKE_PATH).href)});`,
    ].join('\n'),
  );
  return { command: process.execPath, prefixArgs: [script] };
}

/** A JSON object of exactly `bytes` bytes whose only format is 720p. */
function paddedProbe(bytes: number): Buffer {
  const head = '{"formats":[{"height":720}],"pad":"';
  const tail = '"}';
  return Buffer.from(head + 'x'.repeat(bytes - head.length - tail.length) + tail);
}

const ended = () => events.find((e) => e.type === 'done' || e.type === 'error');
const probedEvents = () => events.filter((e) => e.type === 'probed');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetchly-media-'));
  engine = new MediaEngine(FAKE, 'C:\\bin\\ffmpeg.exe');
  events = [];
  running = [];
  kills = [];
  killWorks = true;
  engine.on((e) => events.push(e));
});

afterEach(async () => {
  killWorks = true;
  for (const job of running) await engine.stop(job.id);
  delete process.env['FAKE_YTDLP'];
  delete process.env['FAKE_YTDLP_ARGS'];
  delete process.env['FAKE_YTDLP_HEIGHTS'];
});

describe('isPartialOf', () => {
  it.each([
    'Clip.mp4.part',
    'Clip.f137.mp4',
    'Clip.f140.m4a.part',
    'Clip.mp4.ytdl',
    'Clip.mp4.part-Frag3',
    'Clip.mp4.part-Frag3.part',
    'clip.MP4.PART',
    'CLIP.f137.MP4',
    'Clip.mp4.part.ytdl',
    'Clip.f137.mp4.part-Frag12',
    'Clip.abcde.part',
  ])('%s belongs to job Clip', (name) => {
    expect(isPartialOf(name, 'Clip')).toBe(true);
  });

  it.each([
    'Clip.extra.mp4.part',
    'Clip.mp4',
    'Clip.en.vtt',
    'Clip 2.mp4.part',
    'Clip.temp.mp4',
    'Clip.f137.x.mp4',
    'Clip.toolongext.part',
    'Clip.abcdef.part',
    'Clip.part',
    'Clip.f.mp4',
    'Clip.mp4.part-Frag',
    'Clip.mp4.partial',
    'Clip.mp4.part.extra',
    'Clip',
    'Cli.mp4.part',
  ])('%s does not belong to job Clip', (name) => {
    expect(isPartialOf(name, 'Clip')).toBe(false);
  });

  it('reads the base name literally, not as a pattern', () => {
    expect(isPartialOf('a+b.mp4.part', 'a+b')).toBe(true);
    expect(isPartialOf('aab.mp4.part', 'a+b')).toBe(false);
    expect(isPartialOf('x.mp4.part', '.')).toBe(false);
  });
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

  it('reports a video yt-dlp calls unavailable as removed and skipped, never retried', async () => {
    start('removed');
    expect(await waitFor(ended)).toMatchObject({ type: 'error', outcome: 'skipped', reason: 'removed', retryable: false });
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
    const args = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').at(-1) ?? '') as string[];
    expect(args[args.indexOf('-f') + 1]).toContain('height<=?720');
    expect(args[args.indexOf('--sub-langs') + 1]).toBe('ar');
    expect(args[args.indexOf('--limit-rate') + 1]).toBe('307200');
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe('C:\\bin\\ffmpeg.exe');
  });

  it('refuses to start a job that has no base name or quality', () => {
    process.env['FAKE_YTDLP'] = 'ok';
    engine.start(makeJob({ dir, baseName: null }), ctx);
    expect(events[0]).toMatchObject({ type: 'error', outcome: 'failed', retryable: false });
  });

  it('says so when yt-dlp is not installed and no height check runs', async () => {
    engine = new MediaEngine({ command: join(dir, 'missing.exe'), prefixArgs: [] }, 'ffmpeg');
    engine.on((e) => events.push(e));
    start('ok', { sourceHeight: 720 });
    expect(await waitFor(ended)).toMatchObject({
      type: 'error',
      outcome: 'failed',
      reason: 'yt-dlp is not installed',
      retryable: false,
    });
  });
});

describe('MediaEngine partial and finished files', () => {
  it('discard leaves the partial file of a job whose name extends this one', async () => {
    writeFileSync(join(dir, 'Clip.mp4.part'), 'mine');
    writeFileSync(join(dir, 'Clip.extra.mp4.part'), 'job Clip.extra');
    await engine.discard(makeJob({ dir, baseName: 'Clip' }));
    expect(existsSync(join(dir, 'Clip.mp4.part'))).toBe(false);
    expect(readFileSync(join(dir, 'Clip.extra.mp4.part'), 'utf8')).toBe('job Clip.extra');
  });

  it('discard removes partial files whatever their letter case', async () => {
    writeFileSync(join(dir, 'clip.MP4.PART'), 'mine');
    writeFileSync(join(dir, 'CLIP.mp4'), 'finished');
    await engine.discard(makeJob({ dir, baseName: 'Clip' }));
    expect(existsSync(join(dir, 'clip.MP4.PART'))).toBe(false);
    expect(existsSync(join(dir, 'CLIP.mp4'))).toBe(true);
  });

  it('does not take an unrelated file for the finished download', async () => {
    writeFileSync(join(dir, 'Clip.txt'), 'notes');
    start('nofile');
    expect(await waitFor(ended)).toMatchObject({ type: 'error', outcome: 'failed', reason: 'finished without a file', retryable: false });
  });

  it('does not take a folder for the finished download', async () => {
    mkdirSync(join(dir, 'Clip.mp4'));
    start('nofile');
    expect(await waitFor(ended)).toMatchObject({ type: 'error', outcome: 'failed', reason: 'finished without a file', retryable: false });
  });

  it('does not take a stream file or a longer name for the finished download', async () => {
    writeFileSync(join(dir, 'Clip.f137.mp4'), 'stream');
    writeFileSync(join(dir, 'Clip.extra.mp4'), 'another job');
    writeFileSync(join(dir, 'Clip.mp4.part'), 'partial');
    start('nofile');
    expect(await waitFor(ended)).toMatchObject({ type: 'error', reason: 'finished without a file' });
  });

  it('takes the first finished file by lower-cased name', async () => {
    writeFileSync(join(dir, 'Clip.mp4'), 'a');
    writeFileSync(join(dir, 'Clip.MKV'), 'b');
    start('nofile');
    expect(await waitFor(ended)).toMatchObject({ type: 'done', fileName: 'Clip.MKV', actualHeight: null });
  });

  it('sorts by the lower-cased name, not by the raw code units', async () => {
    // Raw order puts "Clip.MP4" first ("M" < "m"); lower-cased order puts "clip.mkv" first.
    writeFileSync(join(dir, 'Clip.MP4'), 'a');
    writeFileSync(join(dir, 'Clip.mkv'), 'b');
    start('nofile');
    expect(await waitFor(ended)).toMatchObject({ type: 'done', fileName: 'Clip.mkv' });
  });

  it('takes a finished file whose base name differs only in letter case', async () => {
    writeFileSync(join(dir, 'CLIP.webm'), 'a');
    start('nofile');
    expect(await waitFor(ended)).toMatchObject({ type: 'done', fileName: 'CLIP.webm' });
  });

  it.each(['mp4', 'mkv', 'webm', 'm4a', 'mp3', 'opus', 'ogg', 'flac', 'wav', 'mov', 'FLAC'])(
    'takes Clip.%s as the finished download',
    async (ext) => {
      writeFileSync(join(dir, `Clip.${ext}`), 'a');
      start('nofile');
      expect(await waitFor(ended)).toMatchObject({ type: 'done', fileName: `Clip.${ext}` });
    },
  );

  it.each(['avi', 'mp44', 'json', 'part'])('does not take Clip.%s as the finished download', async (ext) => {
    writeFileSync(join(dir, `Clip.${ext}`), 'a');
    start('nofile');
    expect(await waitFor(ended)).toMatchObject({ type: 'error', reason: 'finished without a file' });
  });
});

describe('MediaEngine height check before a Best download', () => {
  it('checks the real height before a Best download and reports it', async () => {
    const lines = argsLog();
    process.env['FAKE_YTDLP_HEIGHTS'] = '1080,720';
    const job = start('ok');
    await waitFor(ended);
    expect(events[0]).toEqual({ jobId: job.id, type: 'probed', sourceHeight: 1080 });
    expect(probedEvents()).toHaveLength(1);
    expect(lines()).toHaveLength(2);
    expect(lines()[0]).toEqual(heightProbeArgs(job.url));
    const download = lastLine(lines());
    expect(valueOf(download, '-f')).toContain('vcodec^=avc1');
    expect(valueOf(download, '--merge-output-format')).toBe('mp4');
    expect(events.map((e) => e.type)).toEqual(['probed', 'progress', 'progress', 'progress', 'merging', 'done']);
  });

  it('uses mkv for a source above 1080p', async () => {
    const lines = argsLog();
    process.env['FAKE_YTDLP_HEIGHTS'] = '2160,1080';
    const job = start('ok');
    await waitFor(ended);
    expect(events[0]).toEqual({ jobId: job.id, type: 'probed', sourceHeight: 2160 });
    expect(valueOf(lastLine(lines()), '--merge-output-format')).toBe('mkv');
  });

  it('reports the highest height whatever order the site lists them in', async () => {
    process.env['FAKE_YTDLP_HEIGHTS'] = '360,1081,720';
    const job = start('ok');
    await waitFor(ended);
    expect(events[0]).toEqual({ jobId: job.id, type: 'probed', sourceHeight: 1081 });
  });

  it('a default Best job runs the height check and then the download', async () => {
    const lines = argsLog();
    start('ok');
    await waitFor(ended);
    expect(lines()).toHaveLength(2);
    expect(probedEvents()).toHaveLength(0);
    expect(events.map((e) => e.type)).toEqual(['progress', 'progress', 'progress', 'merging', 'done']);
    expect(valueOf(lastLine(lines()), '--merge-output-format')).toBe('mkv');
  });

  it('reports no height when the site offers none above zero', async () => {
    const lines = argsLog();
    process.env['FAKE_YTDLP_HEIGHTS'] = '0';
    start('ok');
    await waitFor(ended);
    expect(probedEvents()).toHaveLength(0);
    expect(lines()).toHaveLength(2);
    expect(valueOf(lastLine(lines()), '--merge-output-format')).toBe('mkv');
  });

  it('reports no height when the height check answers with a playlist', async () => {
    makeEngine({}, scriptedProbe(JSON.stringify({ _type: 'playlist', title: 'L', entries: [{ url: 'https://e.com/1' }] })));
    const lines = argsLog();
    start('ok');
    await waitFor(ended);
    expect(probedEvents()).toHaveLength(0);
    expect(ended()).toMatchObject({ type: 'done' });
    expect(valueOf(lastLine(lines()), '--merge-output-format')).toBe('mkv');
  });

  it('skips the height check when the height is known', async () => {
    const lines = argsLog();
    start('ok', { sourceHeight: 720 });
    await waitFor(ended);
    expect(lines()).toHaveLength(1);
    expect(probedEvents()).toHaveLength(0);
    expect(valueOf(lastLine(lines()), '--merge-output-format')).toBe('mp4');
  });

  it('skips the height check for a job that already has data', async () => {
    const lines = argsLog();
    start('ok', { bytesDone: 10, sourceHeight: null });
    await waitFor(ended);
    expect(lines()).toHaveLength(1);
    expect(valueOf(lastLine(lines()), '--merge-output-format')).toBe('mkv');
  });

  it('runs no height check with "always mp4"', async () => {
    const lines = argsLog();
    start('ok', {}, { settings: makeSettings({ preferMp4Max1080: true }), rateLimitBytes: null });
    await waitFor(ended);
    expect(lines()).toHaveLength(1);
  });

  it('runs no height check for a fixed quality', async () => {
    const lines = argsLog();
    start('ok', { quality: { kind: 'max', height: 720 } });
    await waitFor(ended);
    expect(lines()).toHaveLength(1);
  });

  it('runs no height check for audio', async () => {
    const lines = argsLog();
    start('ok', { quality: { kind: 'audio', format: 'm4a' } });
    await waitFor(ended);
    expect(lines()).toHaveLength(1);
  });

  it('reports why the height check failed', async () => {
    const lines = argsLog();
    process.env['FAKE_YTDLP_HEIGHTS'] = 'fail';
    start('ok');
    expect(await waitFor(ended)).toMatchObject({ type: 'error', outcome: 'failed', reason: 'login required', retryable: false });
    await sleep(200);
    expect(lines()).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('gives up the height check after its time limit', async () => {
    makeEngine({ probeTimeoutMs: 300 });
    const lines = argsLog();
    process.env['FAKE_YTDLP_HEIGHTS'] = 'hang';
    const job = start('ok');
    await sleep(150);
    expect(ended()).toBeUndefined();
    const failure = await waitFor(ended);
    expect(failure).toEqual({ jobId: job.id, type: 'error', outcome: 'failed', reason: 'timed out reading the link', retryable: true });
    // The probe child was killed and had ended before the failure was reported.
    expect(kills).toHaveLength(1);
    const child = kills[0];
    if (!child) throw new Error('the probe was not killed');
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    await sleep(200);
    expect(lines()).toHaveLength(1);
    expect(events).toHaveLength(1);
    await expect(engine.stop(job.id)).resolves.toBeUndefined();
    expect(kills).toHaveLength(1);
  });

  it('reports the time limit only once the probe has really ended', async () => {
    makeEngine({ probeTimeoutMs: 200 });
    killWorks = false;
    argsLog();
    process.env['FAKE_YTDLP_HEIGHTS'] = 'hang';
    const job = start('ok');
    await waitFor(() => kills.length === 1);
    await sleep(200);
    expect(ended()).toBeUndefined();
    kills[0]?.kill();
    expect(await waitFor(ended)).toMatchObject({ jobId: job.id, reason: 'timed out reading the link', retryable: true });
  });

  it('reports unreadable height information as a retryable failure', async () => {
    const lines = argsLog();
    process.env['FAKE_YTDLP_HEIGHTS'] = 'garbage';
    start('ok');
    expect(await waitFor(ended)).toMatchObject({
      type: 'error',
      outcome: 'failed',
      reason: 'could not read the video information',
      retryable: true,
    });
    await sleep(200);
    expect(lines()).toHaveLength(1);
  });

  it('reports height information that is JSON but not an object as unreadable', async () => {
    makeEngine({}, scriptedProbe('[1080]'));
    const lines = argsLog();
    start('ok');
    expect(await waitFor(ended)).toMatchObject({ type: 'error', reason: 'could not read the video information', retryable: true });
    await sleep(200);
    expect(lines()).toHaveLength(0);
  });

  it('reads height information of exactly the output cap', async () => {
    makeEngine({}, scriptedProbe(paddedProbe(PROBE_CAP)));
    const job = start('ok');
    await waitFor(ended, 20000);
    expect(events[0]).toEqual({ jobId: job.id, type: 'probed', sourceHeight: 720 });
    expect(ended()).toMatchObject({ type: 'done' });
  }, 30000);

  it('refuses height information one byte over the output cap', async () => {
    makeEngine({}, scriptedProbe(paddedProbe(PROBE_CAP + 1)));
    const lines = argsLog();
    start('ok');
    expect(await waitFor(ended, 20000)).toMatchObject({ type: 'error', reason: 'could not read the video information', retryable: true });
    expect(probedEvents()).toHaveLength(0);
    await sleep(200);
    expect(lines()).toHaveLength(0);
  }, 30000);

  it('stop during the height check starts no download', async () => {
    const lines = argsLog();
    process.env['FAKE_YTDLP_HEIGHTS'] = 'hang';
    const job = start('ok');
    await waitFor(() => lines().length === 1);
    await expect(engine.stop(job.id)).resolves.toBeUndefined();
    await sleep(200);
    expect(events).toEqual([]);
    expect(lines()).toHaveLength(1);
  });
});

describe('MediaEngine stop and discard', () => {
  it('a second stop while the first is pending resolves with it', async () => {
    makeEngine();
    const job = start('hang');
    await waitFor(() => events.some((e) => e.type === 'progress'));
    const first = engine.stop(job.id);
    const second = engine.stop(job.id);
    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(kills).toHaveLength(1);
  });

  it('stop fails and keeps the job when the process does not end', async () => {
    makeEngine({ stopTimeoutMs: 200 });
    killWorks = false;
    const lines = argsLog();
    const job = start('hang');
    await waitFor(() => events.some((e) => e.type === 'progress'));
    const before = events.length;
    const t0 = Date.now();
    await expect(engine.stop(job.id)).rejects.toThrow(UNCONFIRMED);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
    expect(events.length).toBe(before); // suppressed while the stop was pending
    expect(kills).toHaveLength(1);
    // The engine still owns the job and keeps reporting it.
    await waitFor(() => events.length > before);
    expect(events.slice(before).every((e) => e.type === 'progress')).toBe(true);
    const logged = lines().length;
    engine.start(job, ctx);
    await sleep(300);
    expect(lines()).toHaveLength(logged);
    // A later stop tries again.
    killWorks = true;
    await expect(engine.stop(job.id)).resolves.toBeUndefined();
    expect(kills).toHaveLength(2);
    const seen = events.length;
    await sleep(200);
    expect(events.length).toBe(seen);
    expect(ended()).toBeUndefined();
  });

  it('after a stop that failed, the download reports its own end', async () => {
    makeEngine({ stopTimeoutMs: 200 });
    killWorks = false;
    const lines = argsLog();
    const job = start('hang');
    await waitFor(() => events.some((e) => e.type === 'progress'));
    await expect(engine.stop(job.id)).rejects.toThrow(UNCONFIRMED);
    kills[0]?.kill(); // the process ends by itself, not through a stop
    expect(await waitFor(ended)).toMatchObject({ jobId: job.id, type: 'error', outcome: 'failed', retryable: true });
    // The job is released: it can start again.
    const logged = lines().length;
    process.env['FAKE_YTDLP'] = 'ok';
    engine.start({ ...job, bytesDone: 100 }, ctx);
    await waitFor(() => events.some((e) => e.type === 'done'));
    expect(lines()).toHaveLength(logged + 1);
  });

  it('a stop resolves when the process ends by itself before the time limit', async () => {
    makeEngine({ stopTimeoutMs: 3000 });
    killWorks = false;
    const job = start('hang');
    await waitFor(() => events.some((e) => e.type === 'progress'));
    const stopped = engine.stop(job.id);
    await sleep(100);
    kills[0]?.kill();
    await expect(stopped).resolves.toBeUndefined();
    await sleep(200);
    expect(ended()).toBeUndefined();
  });

  it('a stop during the height check that failed can be tried again', async () => {
    makeEngine({ stopTimeoutMs: 200 });
    killWorks = false;
    const lines = argsLog();
    process.env['FAKE_YTDLP_HEIGHTS'] = 'hang';
    const job = start('ok');
    await waitFor(() => lines().length === 1);
    await expect(engine.stop(job.id)).rejects.toThrow(UNCONFIRMED);
    killWorks = true;
    await expect(engine.stop(job.id)).resolves.toBeUndefined();
    expect(kills).toHaveLength(2);
    await sleep(200);
    expect(events).toEqual([]);
    expect(lines()).toHaveLength(1);
  });

  it('discard deletes nothing when the stop is not confirmed', async () => {
    makeEngine({ stopTimeoutMs: 200 });
    killWorks = false;
    writeFileSync(join(dir, 'Clip.f137.mp4'), 'stream');
    const job = start('hang');
    await waitFor(() => events.some((e) => e.type === 'progress'));
    expect(existsSync(join(dir, 'Clip.mp4.part'))).toBe(true);
    await expect(engine.discard(job)).rejects.toThrow(UNCONFIRMED);
    expect(existsSync(join(dir, 'Clip.mp4.part'))).toBe(true);
    expect(existsSync(join(dir, 'Clip.f137.mp4'))).toBe(true);
    killWorks = true;
    await expect(engine.discard(job)).resolves.toBeUndefined();
    expect(existsSync(join(dir, 'Clip.mp4.part'))).toBe(false);
    expect(existsSync(join(dir, 'Clip.f137.mp4'))).toBe(false);
  });
});
