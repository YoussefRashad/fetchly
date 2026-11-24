import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineEvent, RunExtras, StartContext } from '../../src/main/engines/engine';
import { isPartialOf, MediaEngine, type Exe } from '../../src/main/engines/media';
import { heightProbeArgs } from '../../src/main/ytdlp/args';
import type { Job } from '../../src/shared/types';
import { makeJob, makeSettings } from '../helpers';
import { sleep, waitFor } from '../wait';

// A3: every process the engine starts goes through this spy, which runs the real spawn, so a spec can read the options
// a start was given (the spawn rule of plan 3.3: `shell: false` is stated, not left to the default).
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const FAKE_PATH = resolve('tests/fakes/fake-ytdlp.mjs');
const FAKE: Exe = { command: process.execPath, prefixArgs: [FAKE_PATH] };
const ctx: StartContext = { settings: makeSettings(), rateLimitBytes: null, extras: null };
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

/**
 * Replaces the engine with one whose kill the test watches and can switch off. `probeOutputCap` (Task D, item 4) is
 * passed through to the engine with the rest of `opts`.
 */
function makeEngine(opts: { probeTimeoutMs?: number; stopTimeoutMs?: number; probeOutputCap?: number } = {}, exe: Exe = FAKE): MediaEngine {
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

/** How the height check of `overCapProbe` ends. */
type ProbeEnd =
  | 'hang' // stays until it is killed
  | { exit: number } // exits with this code at once
  | { exit: number; holdUntil: string }; // exits with this code once that file exists: the spec releases it

interface ProbeScript {
  /** The height-check output, written first in one piece. */
  output: Buffer | string;
  /** Further bytes written after `output` (default none), a megabyte at a time. */
  more?: number;
  /** Written to stderr before the end. */
  stderr?: string;
  end: ProbeEnd;
}

/**
 * A yt-dlp stand-in for the over-cap specs; every run that is not the height check is the fake. Its height check
 * writes `output` in one piece, then `more` further bytes (each write finished before the next starts, so a parent
 * that stops reading blocks it), then `stderr`, then ends as `end` says. `holdUntil` is the lingering child without a
 * clock: it lives exactly until the spec creates the file. `aliveAtDownload()` has, for each download that started,
 * whether the height check's process was still alive when that download began (false = it had already ended).
 */
function overCapProbe(script: ProbeScript): { exe: Exe; aliveAtDownload: () => boolean[] } {
  const outFile = join(dir, 'overcap-output.bin');
  const cfgFile = join(dir, 'overcap-config.json');
  const pidFile = join(dir, 'overcap-probe.pid');
  const aliveLog = join(dir, 'overcap-alive.log');
  writeFileSync(outFile, script.output);
  writeFileSync(cfgFile, JSON.stringify({ more: script.more ?? 0, stderr: script.stderr ?? '', end: script.end }));
  const file = join(dir, 'overcap-ytdlp.mjs');
  writeFileSync(
    file,
    [
      "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
      'const args = process.argv.slice(2);',
      'const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));',
      "if (args.includes('-J') && args.includes('--no-playlist')) {",
      `  const cfg = JSON.parse(readFileSync(${JSON.stringify(cfgFile)}, 'utf8'));`,
      `  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      '  const write = (data, stream = process.stdout) => new Promise((resolve) => stream.write(data, () => resolve()));',
      `  await write(readFileSync(${JSON.stringify(outFile)}));`,
      '  if (cfg.more > 0) await pause(30);', // a later write is a later chunk, most of the time
      '  for (let left = cfg.more; left > 0; left -= 1048576) await write(Buffer.alloc(Math.min(left, 1048576), 0x79));',
      "  if (cfg.stderr !== '') await write(cfg.stderr, process.stderr);",
      "  if (cfg.end === 'hang') setInterval(() => {}, 1000);",
      '  else {',
      '    while (cfg.end.holdUntil !== undefined && !existsSync(cfg.end.holdUntil)) await pause(20);',
      '    process.exit(cfg.end.exit);',
      '  }',
      '} else {',
      '  let alive = true;',
      `  try { process.kill(Number(readFileSync(${JSON.stringify(pidFile)}, 'utf8')), 0); } catch { alive = false; }`,
      `  appendFileSync(${JSON.stringify(aliveLog)}, (alive ? 'alive' : 'ended') + '\\n');`,
      `  await import(${JSON.stringify(pathToFileURL(FAKE_PATH).href)});`,
      '}',
    ].join('\n'),
  );
  return {
    exe: { command: process.execPath, prefixArgs: [file] },
    aliveAtDownload: () =>
      existsSync(aliveLog)
        ? readFileSync(aliveLog, 'utf8')
            .split('\n')
            .filter((l) => l !== '')
            .map((l) => l === 'alive')
        : [],
  };
}

/** Best with no known height: the one download line has the mkv format and is not a height check. */
function expectMkvFallback(lines: string[][]): void {
  expect(lines).toHaveLength(1);
  const download = lastLine(lines);
  expect(download).not.toContain('-J');
  expect(valueOf(download, '-f')).toBe('bv*+ba/b');
  expect(valueOf(download, '--merge-output-format')).toBe('mkv');
}

const ended = () => events.find((e) => e.type === 'done' || e.type === 'error');
const probedEvents = () => events.filter((e) => e.type === 'probed');
const errorEvents = () => events.filter((e) => e.type === 'error');

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
      { settings: makeSettings({ preferMp4Max1080: true }), rateLimitBytes: 307200, extras: null },
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
    expect(lines()[0]).toEqual(heightProbeArgs(job.url, null));
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
    start('ok', {}, { settings: makeSettings({ preferMp4Max1080: true }), rateLimitBytes: null, extras: null });
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

  // Task D, item 4, spec 1 (replaces "refuses height information one byte over the output cap"): over the cap the
  // height is only a container hint, so the job downloads with no known height instead of failing and being retried.
  it('downloads with no known height when the height information is one byte over the output cap', async () => {
    makeEngine({}, scriptedProbe(paddedProbe(PROBE_CAP + 1)));
    const lines = argsLog();
    start('ok');
    expect(await waitFor(ended, 20000)).toMatchObject({ type: 'done' });
    expect(probedEvents()).toHaveLength(0);
    expect(errorEvents()).toEqual([]);
    expectMkvFallback(lines());
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

// Task D, item 4 (frozen plan docs/plans/2026-11-23-d-housekeeping.md, "Item 4"). A height check whose output passes
// the cap ends its child once (killChild) and the job downloads with no known height (mkv, `bv*+ba/b`), whatever the
// time limit, the exit code or a signal say; a pending stop still wins. The download starts only on the child's
// 'close'. Specs 2-8 use a 1 KiB cap (`probeOutputCap`), so none of them moves 64 MiB. Amendment 10 makes spec 5 assert the kill
// order; amendment 11 adds specs 10 and 11 for the failing fallback and the second run (docs/plans/2026-11-23-d-housekeeping-amendment-1.md).
describe('MediaEngine height check over the output cap (Task D, item 4)', () => {
  const SMALL_CAP = 1024;
  const OVER = paddedProbe(SMALL_CAP + 1);
  /** Waits on a condition; the generous limit only matters when a spec fails. */
  const LONG = 10_000;
  const BUDGET = 30_000;

  it('2. the child hangs after cap + 1: it is killed once and has ended before the download starts, and the job is done', async () => {
    const probe = overCapProbe({ output: OVER, end: 'hang' });
    makeEngine({ probeOutputCap: SMALL_CAP }, probe.exe);
    const lines = argsLog();
    start('ok');
    await waitFor(() => lines().length === 1, LONG);
    // Sampled the moment the download line is visible.
    const child = kills[0];
    const endedAtDownload = child !== undefined && (child.exitCode !== null || child.signalCode !== null);
    expect(kills).toHaveLength(1);
    expect(child?.spawnargs, 'the one kill is the height check').toContain('-J');
    expect(endedAtDownload, 'the height check had ended before the download line was logged').toBe(true);
    expect(await waitFor(ended, LONG)).toMatchObject({ type: 'done' });
    expect(probe.aliveAtDownload()).toEqual([false]);
    expect(probedEvents()).toHaveLength(0);
    expect(errorEvents()).toEqual([]);
    expectMkvFallback(lines());
    expect(kills, 'no second kill').toHaveLength(1);
  }, BUDGET);

  it('3. the kill does nothing and the child lives on: no download while it lives, the download once it has exited', async () => {
    killWorks = false;
    const release = join(dir, 'release.flag');
    const probe = overCapProbe({ output: OVER, end: { exit: 0, holdUntil: release } });
    makeEngine({ probeOutputCap: SMALL_CAP }, probe.exe);
    const lines = argsLog();
    start('ok');
    await waitFor(() => kills.length === 1, LONG);
    await sleep(250);
    // The stand-in cannot exit before the file exists, so it lives at this sample whatever the machine's load.
    const child = kills[0];
    expect(child?.exitCode).toBeNull();
    expect(child?.signalCode).toBeNull();
    expect(lines(), 'no download while the height check lives').toEqual([]);
    expect(events).toEqual([]);
    writeFileSync(release, '');
    expect(await waitFor(ended, LONG)).toMatchObject({ type: 'done' });
    expect(child?.exitCode, 'it ended by itself').toBe(0);
    expect(probe.aliveAtDownload(), 'the download began after the height check had ended').toEqual([false]);
    expect(probedEvents()).toHaveLength(0);
    expect(errorEvents()).toEqual([]);
    expectMkvFallback(lines());
    expect(kills).toHaveLength(1);
  }, BUDGET);

  it('4. a stop after the cap and before the child ends: no download and no event', async () => {
    killWorks = false;
    const probe = overCapProbe({ output: OVER, end: 'hang' });
    makeEngine({ probeOutputCap: SMALL_CAP }, probe.exe);
    const lines = argsLog();
    const job = start('ok');
    await waitFor(() => kills.length === 1, LONG);
    expect(lines()).toEqual([]);
    killWorks = true;
    await expect(engine.stop(job.id)).resolves.toBeUndefined();
    expect(events).toEqual([]);
    await sleep(200);
    expect(lines()).toEqual([]);
    expect(events).toEqual([]);
    expect(probe.aliveAtDownload()).toEqual([]);
    expect(kills, 'the cap kill, then the stop').toHaveLength(2);
    expect(kills[1]).toBe(kills[0]);
  }, BUDGET);

  // Amendment 10 (review finding 2): spec 5 asserts the order. The first kill is the cap kill and comes before the time limit; the
  // second is the timer's, at or after it, and kills the same child. Elapsed time is the one clock the plan allows here. A red run
  // on a loaded machine is re-run alone before it counts.
  it('5. the cap kills first, before the time limit; the timer then kills the same child again; over-cap still wins over the time limit', async () => {
    const TIME_LIMIT = 3000;
    killWorks = false;
    const probe = overCapProbe({ output: OVER, end: 'hang' });
    makeEngine({ probeOutputCap: SMALL_CAP, probeTimeoutMs: TIME_LIMIT }, probe.exe);
    const lines = argsLog();
    const t0 = Date.now();
    start('ok');
    await waitFor(() => kills.length >= 1, LONG);
    const firstKillAfter = Date.now() - t0;
    expect(kills, 'only the first kill so far').toHaveLength(1);
    expect(firstKillAfter, 'the first kill is the cap kill: it comes before the time limit').toBeLessThan(TIME_LIMIT);
    expect(kills[0]?.spawnargs, 'the first kill is the height check').toContain('-J');
    expect(lines()).toEqual([]);
    expect(events).toEqual([]);
    await waitFor(() => kills.length >= 2, LONG);
    const secondKillAfter = Date.now() - t0;
    expect(secondKillAfter, 'the second kill is the timer: it comes at or after the time limit').toBeGreaterThanOrEqual(TIME_LIMIT);
    expect(kills[1], 'the timer kills the same child').toBe(kills[0]);
    expect(lines()).toEqual([]);
    expect(events).toEqual([]);
    kills[0]?.kill(); // the tree finally ends, by hand
    expect(await waitFor(ended, LONG)).toMatchObject({ type: 'done' });
    expect(errorEvents(), 'no "timed out reading the link"').toEqual([]);
    expect(probe.aliveAtDownload()).toEqual([false]);
    expect(probedEvents()).toHaveLength(0);
    expectMkvFallback(lines());
    expect(kills).toHaveLength(2);
  }, BUDGET);

  // Over-cap wins over the exit code and over a signal: no `login required`, no `could not read ...`, no timeout.
  it.each<{ name: string; killOn: boolean; end: ProbeEnd; stderr: string; exitCode: number | null; signal: boolean }>([
    { name: 'the child exits 0 by itself and the kill does nothing', killOn: false, end: { exit: 0 }, stderr: '', exitCode: 0, signal: false },
    {
      name: 'the child exits 1 with "ERROR: Sign in" on stderr and the kill does nothing',
      killOn: false,
      end: { exit: 1 },
      stderr: 'ERROR: Sign in\n',
      exitCode: 1,
      signal: false,
    },
    { name: 'the kill works and the child ends by signal', killOn: true, end: 'hang', stderr: '', exitCode: null, signal: true },
  ])('6. $name: the job is done with one mkv download', async ({ killOn, end, stderr, exitCode, signal }) => {
    killWorks = killOn;
    const probe = overCapProbe({ output: OVER, stderr, end });
    makeEngine({ probeOutputCap: SMALL_CAP }, probe.exe);
    const lines = argsLog();
    start('ok');
    expect(await waitFor(ended, LONG)).toMatchObject({ type: 'done' });
    expect(errorEvents(), 'no login required, no unreadable, no timeout').toEqual([]);
    expect(probedEvents()).toHaveLength(0);
    expectMkvFallback(lines());
    expect(probe.aliveAtDownload()).toEqual([false]);
    expect(kills, 'the cap kill, once').toHaveLength(1);
    const child = kills[0];
    expect(child?.exitCode).toBe(exitCode);
    expect(child?.signalCode !== null, 'ended by a signal').toBe(signal);
  }, BUDGET);

  it('7. the stream keeps flowing after the cap: 4 MB more are drained and the job is done', async () => {
    killWorks = false;
    const probe = overCapProbe({ output: OVER, more: 4 * 1024 * 1024, end: { exit: 0 } });
    makeEngine({ probeOutputCap: SMALL_CAP }, probe.exe);
    const lines = argsLog();
    start('ok');
    // A parent that stopped reading would block the child on its write and never see it end.
    expect(await waitFor(ended, LONG)).toMatchObject({ type: 'done' });
    expect(errorEvents()).toEqual([]);
    expect(probedEvents()).toHaveLength(0);
    expectMkvFallback(lines());
    expect(probe.aliveAtDownload()).toEqual([false]);
    expect(kills[0]?.exitCode, 'the child wrote everything and ended by itself').toBe(0);
  }, BUDGET);

  it('8. boundary: output of exactly probeOutputCap bytes is read, with the height and the mp4 format', async () => {
    const probe = overCapProbe({ output: paddedProbe(SMALL_CAP), end: { exit: 0 } });
    makeEngine({ probeOutputCap: SMALL_CAP }, probe.exe);
    const lines = argsLog();
    const job = start('ok');
    expect(await waitFor(ended, LONG)).toMatchObject({ type: 'done' });
    expect(events[0]).toEqual({ jobId: job.id, type: 'probed', sourceHeight: 720 });
    expect(errorEvents()).toEqual([]);
    expect(kills, 'under or at the cap nothing is killed').toHaveLength(0);
    expect(lines()).toHaveLength(1);
    expect(valueOf(lastLine(lines()), '--merge-output-format')).toBe('mp4');
  }, BUDGET);

  it('8b. boundary: the cap counts the whole output, so one more byte in a later write is over it', async () => {
    const probe = overCapProbe({ output: paddedProbe(SMALL_CAP), more: 1, end: { exit: 0 } });
    makeEngine({ probeOutputCap: SMALL_CAP }, probe.exe);
    const lines = argsLog();
    start('ok');
    expect(await waitFor(ended, LONG)).toMatchObject({ type: 'done' });
    expect(errorEvents()).toEqual([]);
    expect(probedEvents()).toHaveLength(0);
    expectMkvFallback(lines());
  }, BUDGET);

  it('8c. boundary: a cap of 0 is a cap (not the default): any output is over it', async () => {
    const probe = overCapProbe({ output: OVER, end: { exit: 0 } });
    makeEngine({ probeOutputCap: 0 }, probe.exe);
    const lines = argsLog();
    start('ok');
    expect(await waitFor(ended, LONG)).toMatchObject({ type: 'done' });
    expect(errorEvents()).toEqual([]);
    expect(probedEvents()).toHaveLength(0);
    expectMkvFallback(lines());
  }, BUDGET);

  it('9. kept: output under the cap that cannot be read stays a retryable failure, with no download', async () => {
    const probe = overCapProbe({ output: 'this is not json', end: { exit: 0 } });
    makeEngine({ probeOutputCap: SMALL_CAP }, probe.exe);
    const lines = argsLog();
    start('ok');
    expect(await waitFor(ended, LONG)).toMatchObject({ type: 'error', outcome: 'failed', reason: 'could not read the video information', retryable: true });
    await sleep(200);
    expect(lines()).toEqual([]);
    expect(kills).toHaveLength(0);
  }, BUDGET);

  // Amendment 11 (review finding 3), edge cases of the plan's "Edge cases" list that had no spec.
  // The fallback download ends with the stand-in's own failure: 'private' (outcome skipped, not retryable). It is not one of the
  // reasons the height check itself could give (unreadable, time limit, login required), so a mix-up of the two shows.
  const FALLBACK_FAILURE = { type: 'error', outcome: 'skipped', reason: 'private', retryable: false } as const;
  // The one job-wide fact both specs rely on: the job is not probed again only when it has data (bytesDone > 0). That counterpart
  // is covered by 'skips the height check for a job that already has data' in 'MediaEngine height check' above.

  // 3a: the fallback fails. Its own reason is the one error; no probed event, one mkv download line, one kill.
  it.each<{ name: string; killOn: boolean; end: ProbeEnd; stderr: string }>([
    { name: 'the kill ends the child by signal', killOn: true, end: 'hang', stderr: '' },
    { name: 'the child exits 0 by itself and the kill does nothing', killOn: false, end: { exit: 0 }, stderr: '' },
    {
      name: 'the child exits 1 with "ERROR: Sign in" on stderr and the kill does nothing',
      killOn: false,
      end: { exit: 1 },
      stderr: 'ERROR: Sign in\n',
    },
  ])('10. (amendment 11, 3a) the fallback download fails, $name: its own reason is the one error', async ({ killOn, end, stderr }) => {
    killWorks = killOn;
    const probe = overCapProbe({ output: OVER, stderr, end });
    makeEngine({ probeOutputCap: SMALL_CAP }, probe.exe);
    const lines = argsLog();
    const job = start('private');
    expect(await waitFor(ended, LONG)).toEqual({ jobId: job.id, ...FALLBACK_FAILURE });
    await sleep(200); // nothing follows the failure
    // Exactly this one event: not "could not read the video information", "timed out reading the link" or "login required",
    // no second error, no probed.
    expect(events).toEqual([{ jobId: job.id, ...FALLBACK_FAILURE }]);
    expectMkvFallback(lines());
    expect(probe.aliveAtDownload()).toEqual([false]);
    expect(kills, 'the cap kill, once').toHaveLength(1);
    expect(kills[0]?.spawnargs, 'the one kill is the height check').toContain('-J');
  }, BUDGET);

  it('10b. (amendment 11, 3a) the fallback download fails after the time limit also fired: still its own reason, not "timed out reading the link"', async () => {
    killWorks = false;
    const probe = overCapProbe({ output: OVER, end: 'hang' });
    makeEngine({ probeOutputCap: SMALL_CAP, probeTimeoutMs: 300 }, probe.exe);
    const lines = argsLog();
    const job = start('private');
    await waitFor(() => kills.length >= 2, LONG); // the cap kill and the timer kill; neither ends the child
    expect(lines()).toEqual([]);
    kills[0]?.kill(); // the tree finally ends, by hand
    expect(await waitFor(ended, LONG)).toEqual({ jobId: job.id, ...FALLBACK_FAILURE });
    await sleep(200);
    expect(events).toEqual([{ jobId: job.id, ...FALLBACK_FAILURE }]);
    expectMkvFallback(lines());
    expect(probe.aliveAtDownload()).toEqual([false]);
    expect(kills).toHaveLength(2);
    expect(kills[1]).toBe(kills[0]);
  }, BUDGET);

  // 3b: a second run of the same job (bytesDone is still 0) is probed again, cut at the cap again and falls back again.
  it('11. (amendment 11, 3b) a second run with bytesDone 0 spawns a second height check, kills it at the cap, and downloads again with no known height', async () => {
    const probe = overCapProbe({ output: OVER, end: 'hang' });
    makeEngine({ probeOutputCap: SMALL_CAP }, probe.exe);
    const lines = argsLog();
    const job = start('private');
    expect(await waitFor(ended, LONG)).toEqual({ jobId: job.id, ...FALLBACK_FAILURE });
    expect(job.bytesDone, 'the job to run again has no data').toBe(0);
    expect(job.sourceHeight).toBeNull();
    expect(kills).toHaveLength(1);
    expectMkvFallback(lines());

    engine.start(job, ctx); // the same job again, as a re-queue does
    await waitFor(() => errorEvents().length >= 2, LONG);
    await sleep(200); // nothing follows the second failure
    expect(kills, 'one kill for each run').toHaveLength(2);
    const [first, second] = kills;
    expect(second, 'a different child from the first').not.toBe(first);
    expect(second?.pid).not.toBe(first?.pid);
    expect(first?.spawnargs).toContain('-J');
    expect(second?.spawnargs, 'the second run spawned its own height check').toContain('-J');
    expect(probe.aliveAtDownload(), 'each download began after its height check had ended').toEqual([false, false]);
    const all = lines();
    expect(all, 'a second download line').toHaveLength(2);
    for (const line of all) expectMkvFallback([line]);
    expect(events, 'two failures of its own, no probed').toEqual([
      { jobId: job.id, ...FALLBACK_FAILURE },
      { jobId: job.id, ...FALLBACK_FAILURE },
    ]);
  }, BUDGET);
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

// A3 Task T2 (plan 3.3, section 6): the headers of ctx.extras on the two yt-dlp starts, `shell: false`, and the promise
// that A3's engines never read `cookies`.
describe('MediaEngine headers (A3)', () => {
  const REFERER = 'https://a.example/watch';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  /** PA3-6: every character a shell could treat as special, accepted and passed byte for byte. */
  const PA3_6 = 'Mozilla/5.0 "q" \\ %PATH% ^ & | < > ` $(x) ; --output=evil -o x';
  const FOUR = ['--add-headers', `Referer:${REFERER}`, '--add-headers', `User-Agent:${UA}`];
  const extrasOf = (referer: string | null, userAgent: string | null): RunExtras => ({ referer, userAgent, cookies: null });
  const withExtras = (extras: RunExtras | null): StartContext => ({ ...ctx, extras });
  const spawnCalls = (): [string, string[], Record<string, unknown>][] =>
    vi.mocked(spawn).mock.calls as unknown as [string, string[], Record<string, unknown>][];

  /** `args` without the contiguous `run`, or `args` itself when it holds none. */
  function without(args: string[], run: string[]): string[] {
    for (let i = 0; i + run.length <= args.length; i += 1) {
      if (run.every((v, k) => args[i + k] === v)) return [...args.slice(0, i), ...args.slice(i + run.length)];
    }
    return args;
  }
  /** The headers in `args` as their `--add-headers <value>` pairs, in order. */
  const headerValues = (args: string[]): string[] => args.flatMap((a, i) => (a === '--add-headers' ? [args[i + 1] ?? ''] : []));

  /** Runs a default Best job (so a height check runs first) and returns its two argument lists. */
  async function runBest(extras: RunExtras | null, over: Partial<Job> = {}): Promise<{ check: string[]; download: string[] }> {
    const lines = argsLog();
    const before = events.length;
    start('ok', over, withExtras(extras));
    await waitFor(() => events.slice(before).some((e) => e.type === 'done' || e.type === 'error'));
    const all = lines();
    return { check: all[all.length - 2] ?? [], download: all[all.length - 1] ?? [] };
  }

  beforeEach(() => {
    vi.mocked(spawn).mockClear();
  });

  it('puts both headers on the height check and on the download: four elements before --, nothing else changed', async () => {
    const headed = await runBest(extrasOf(REFERER, UA));
    expect(headed.check.slice(-2)).toEqual(['--', 'https://example.com/watch?v=1']);
    expect(headed.download.slice(-2)).toEqual(['--', 'https://example.com/watch?v=1']);
    for (const args of [headed.check, headed.download]) {
      const at = args.findIndex((_a, i) => FOUR.every((v, k) => args[i + k] === v));
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at + 4).toBeLessThanOrEqual(args.indexOf('--'));
    }
    const plain = await runBest(null);
    expect(without(headed.check, FOUR)).toEqual(plain.check);
    expect(without(headed.download, FOUR)).toEqual(plain.download);
    expect(plain.check).toEqual(heightProbeArgs('https://example.com/watch?v=1', null));
  });

  it('carries the headers of a download that has no height check as well', async () => {
    const lines = argsLog();
    start('ok', { sourceHeight: 720 }, withExtras(extrasOf(REFERER, UA)));
    await waitFor(ended);
    expect(lines()).toHaveLength(1);
    expect(headerValues(lastLine(lines()))).toEqual([`Referer:${REFERER}`, `User-Agent:${UA}`]);
  });

  it.each([
    ['a Referer only', extrasOf(REFERER, null), [`Referer:${REFERER}`]],
    ['a User-Agent only', extrasOf(null, UA), [`User-Agent:${UA}`]],
  ])('sends %s, and only that header, on both starts', async (_name, extras, expected) => {
    const { check, download } = await runBest(extras);
    expect(headerValues(check)).toEqual(expected);
    expect(headerValues(download)).toEqual(expected);
  });

  it('sends no header for extras null and for extras with two null values: the same argument lists', async () => {
    const none = await runBest(null);
    const allNull = await runBest(extrasOf(null, null));
    expect(allNull).toEqual(none);
    expect(headerValues(none.check)).toEqual([]);
    expect(headerValues(none.download)).toEqual([]);
    expect(none.check).not.toContain('--add-headers');
    expect(none.download).not.toContain('--add-headers');
  });

  it("passes PA3-6's User-Agent as exactly one element on each start, byte for byte, and adds no other element", async () => {
    const headed = await runBest(extrasOf(null, PA3_6));
    const plain = await runBest(null);
    for (const [got, base] of [
      [headed.check, plain.check],
      [headed.download, plain.download],
    ] as const) {
      expect(got.filter((a) => a === `User-Agent:${PA3_6}`)).toHaveLength(1);
      expect(got).toHaveLength(base.length + 2);
      expect(without(got, ['--add-headers', `User-Agent:${PA3_6}`])).toEqual(base);
    }
  });

  it.each([
    ['a Referer with CR LF', extrasOf('https://a.example/p\r\nX: y', null)],
    ['a Referer with a query', extrasOf('https://a.example/p?token=1', null)],
    ['a Referer with a double quote', extrasOf('https://a.example/p"q', null)],
    ['a User-Agent with LF', extrasOf(null, 'a\nb')],
    ['a User-Agent with NUL', extrasOf(null, 'a\u0000b')],
    ['a User-Agent of 513 characters', extrasOf(null, 'a'.repeat(513))],
    ['a User-Agent that is not a string', extrasOf(null, 7 as unknown as string)],
  ])('adds no element for %s, even handed straight to the engine', async (_name, extras) => {
    const plain = await runBest(null);
    const got = await runBest(extras);
    expect(got).toEqual(plain);
  });

  it('starts every process with shell false stated, the command of the exe unchanged and its prefix first', async () => {
    await runBest(extrasOf(REFERER, UA));
    const calls = spawnCalls();
    expect(calls).toHaveLength(2); // the height check and the download
    for (const [command, args, options] of calls) {
      expect(command).toBe(FAKE.command);
      expect(args.slice(0, FAKE.prefixArgs.length)).toEqual(FAKE.prefixArgs);
      expect(options['shell']).toBe(false);
      expect(options['windowsHide']).toBe(true);
    }
  });

  it('states shell false for the download that has no height check too', async () => {
    start('ok', { sourceHeight: 720 }, withExtras(extrasOf(REFERER, UA)));
    await waitFor(ended);
    const calls = spawnCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[2]['shell']).toBe(false);
    expect(calls[0]?.[0]).toBe(FAKE.command);
  });

  it('never reads cookies: a source that throws when touched changes nothing, and no cookie argument exists', async () => {
    const touched = new Proxy(
      {},
      {
        get: () => {
          throw new Error('cookies was read');
        },
        has: () => {
          throw new Error('cookies was read');
        },
        ownKeys: () => {
          throw new Error('cookies was read');
        },
        getOwnPropertyDescriptor: () => {
          throw new Error('cookies was read');
        },
      },
    );
    const extras = { referer: REFERER, userAgent: UA, cookies: touched } as unknown as RunExtras;
    const plain = await runBest(extrasOf(REFERER, UA));
    const got = await runBest(extras);
    expect(got).toEqual(plain);
    expect(events.at(-1)).toMatchObject({ type: 'done' }); // the run with the untouchable source finished as usual
    for (const a of [...got.check, ...got.download]) expect(/cookie/iu.test(a)).toBe(false);
  });

  it('gives each start the headers of its own context: a later job with none gets none, and a restart gets what it is given', async () => {
    const first = await runBest(extrasOf(REFERER, UA));
    expect(headerValues(first.download)).toHaveLength(2);
    const second = await runBest(null);
    expect(headerValues(second.download)).toEqual([]);
    expect(headerValues(second.check)).toEqual([]);

    // The same job stopped and started again with other headers.
    const lines = argsLog();
    const seen = lines().length; // the log is shared with the two runs above
    process.env['FAKE_YTDLP'] = 'hang';
    const job = makeJob({ dir, baseName: 'Again', sourceHeight: 720 });
    running.push(job);
    engine.start(job, withExtras(extrasOf(REFERER, null)));
    await waitFor(() => lines().length >= seen + 1);
    await engine.stop(job.id);
    process.env['FAKE_YTDLP'] = 'ok';
    engine.start(job, withExtras(extrasOf(null, UA)));
    await waitFor(() => lines().length >= seen + 2);
    expect(headerValues(lines()[seen] ?? [])).toEqual([`Referer:${REFERER}`]);
    expect(headerValues(lines()[seen + 1] ?? [])).toEqual([`User-Agent:${UA}`]);
  });

  it('a hostile User-Agent through the real process arrives whole: the log of the process holds it as one argument', async () => {
    const { download } = await runBest(extrasOf(REFERER, PA3_6));
    expect(download.filter((a) => a === `User-Agent:${PA3_6}`)).toHaveLength(1);
    expect(download.filter((a) => a.startsWith('--output'))).toEqual([]);
  });
});
