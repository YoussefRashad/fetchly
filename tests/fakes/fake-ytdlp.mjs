// A scripted stand-in for yt-dlp. The scenario comes from the FAKE_YTDLP env var.
// A height probe (`-J` together with `--no-playlist`) ignores FAKE_YTDLP and follows
// FAKE_YTDLP_HEIGHTS instead: unset or `none`, `hang`, `fail`, `garbage`, or a comma list.
// Three probe scenarios for the process-tree cases (A3, Task T4):
//   probe-tree-hang  starts a child that holds stdout, then hangs;
//   probe-flood      writes stdout without end (16 KiB every millisecond) and hangs;
//   probe-orphan     prints a complete video JSON, starts a child that holds stdout, then exits at once.
// The first and the third write `{"self": <pid>, "child": <pid>}` to the file named by FAKE_YTDLP_PIDFILE once the
// child runs. Every process these scenarios start ends itself after two minutes, so a spec that dies leaks nothing.
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LEAK_GUARD_MS = 120000;
const FLOOD_CHUNK = 'x'.repeat(16 * 1024);

/** Starts a child that inherits stdout (so the reader's pipe stays open while it lives) and records both pids. */
function holdStdoutWithChild() {
  const child = spawn(process.execPath, ['-e', `setInterval(() => {}, 1000); setTimeout(() => process.exit(0), ${LEAK_GUARD_MS});`], {
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
    // Node puts a child in a job object that ends it when this process ends (Windows). Detached leaves that job, so the
    // child lives on as yt-dlp's ffmpeg or Python child does: only a kill of the tree, not of this pid, ends it.
    detached: true,
  });
  // The child must not keep this process alive: the probe-orphan scenario ends while it runs.
  child.unref();
  if (process.env.FAKE_YTDLP_PIDFILE) {
    writeFileSync(process.env.FAKE_YTDLP_PIDFILE, JSON.stringify({ self: process.pid, child: child.pid }));
  }
}

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};

const scenario = process.env.FAKE_YTDLP ?? 'ok';
if (process.env.FAKE_YTDLP_ARGS) appendFileSync(process.env.FAKE_YTDLP_ARGS, `${JSON.stringify(args)}\n`);

const dir = valueOf('-P') ?? '.';
const base = (valueOf('-o') ?? 'out.%(ext)s').replace('.%(ext)s', '').replaceAll('%%', '%');
const out = (line) => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);
const progress = (done, total) => out(`FETCHLY_PROGRESS ${done} ${total} NA 1000 5`);
const part = () => writeFileSync(join(dir, `${base}.mp4.part`), 'partial');

function heightProbe(mode) {
  switch (mode) {
    case 'none':
      out(JSON.stringify({ formats: [] }));
      break;
    case 'hang':
      setInterval(() => {}, 1000);
      break;
    case 'fail':
      err('ERROR: [youtube] x: Sign in to confirm your age');
      process.exitCode = 1;
      break;
    case 'garbage':
      out('this is not json');
      break;
    default:
      out(JSON.stringify({ formats: mode.split(',').map((h) => ({ height: Number(h) })) }));
  }
}

function download(name) {
  switch (name) {
    case 'ok':
      out('[youtube] Extracting URL');
      progress(100, 1000);
      progress(500, 1000);
      progress(1000, 1000);
      out(`[Merger] Merging formats into "${join(dir, `${base}.mp4`)}"`);
      writeFileSync(join(dir, `${base}.mp4`), 'video');
      out(`FETCHLY_FILE 1080 ${join(dir, `${base}.mp4`)}`);
      break;
    case 'drop':
      progress(100, 1000);
      progress(300, 1000);
      part();
      err('ERROR: unable to download video data: HTTP Error 503');
      process.exitCode = 1;
      break;
    case 'private':
      err('ERROR: [youtube] x: Private video');
      process.exitCode = 1;
      break;
    case 'removed':
      // The text yt-dlp gives for a YouTube video that no longer exists.
      err('ERROR: [youtube] zzzzzzzzzz0: This video is unavailable');
      process.exitCode = 1;
      break;
    case 'hang':
      part();
      setInterval(() => progress(100, 1000), 50);
      break;
    case 'nofile':
      break;
    case 'probe-video':
      out(JSON.stringify({ title: 'Talk', thumbnail: null, extractor: 'youtube', formats: [{ height: 1080 }, { height: 720 }] }));
      break;
    case 'probe-playlist':
      out(
        JSON.stringify({
          _type: 'playlist',
          title: 'Course',
          entries: [
            { url: 'https://example.com/v/1', title: 'One' },
            { url: 'https://example.com/v/2', title: 'Two' },
          ],
        }),
      );
      break;
    case 'probe-direct':
      out(JSON.stringify({ title: 'file', extractor: 'generic', direct: true, formats: [{ height: null }] }));
      break;
    case 'probe-unsupported':
      err('ERROR: Unsupported URL: https://example.com/file.zip');
      process.exitCode = 1;
      break;
    case 'probe-private':
      err('ERROR: [youtube] x: Private video');
      process.exitCode = 1;
      break;
    case 'probe-garbage':
      out('this is not json');
      break;
    case 'probe-sized': {
      // A valid video JSON of exactly FAKE_YTDLP_PROBE_BYTES bytes, the newline included.
      const size = Number(process.env.FAKE_YTDLP_PROBE_BYTES);
      const head = '{"title":"Huge","formats":[{"height":720}],"pad":"';
      const tail = '"}';
      out(head + 'x'.repeat(size - head.length - tail.length - 1) + tail);
      break;
    }
    case 'probe-killed':
      // Ended from outside (Stop-Process -Force): no output and no ERROR line of its own.
      process.exitCode = 1;
      break;
    case 'probe-hang':
      setInterval(() => {}, 1000);
      break;
    case 'probe-tree-hang':
      // A process with a child, as yt-dlp has ffmpeg: both hold stdout and neither ends alone.
      holdStdoutWithChild();
      setInterval(() => {}, 1000);
      setTimeout(() => process.exit(0), LEAK_GUARD_MS);
      break;
    case 'probe-flood':
      // Never stops writing, whatever the reader does: only the reader ending the process stops it.
      setInterval(() => process.stdout.write(FLOOD_CHUNK), 1);
      setTimeout(() => process.exit(0), LEAK_GUARD_MS);
      break;
    case 'probe-orphan':
      // Complete, valid output and a clean exit, while a child it started still holds stdout.
      out(JSON.stringify({ title: 'Talk', thumbnail: null, extractor: 'youtube', formats: [{ height: 1080 }, { height: 720 }] }));
      holdStdoutWithChild();
      break;
    default:
      err(`ERROR: unknown fake scenario ${name}`);
      process.exitCode = 2;
  }
}

if (args.includes('-J') && args.includes('--no-playlist')) heightProbe(process.env.FAKE_YTDLP_HEIGHTS ?? 'none');
else download(scenario);
