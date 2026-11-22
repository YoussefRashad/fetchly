// A scripted stand-in for yt-dlp. The scenario comes from the FAKE_YTDLP env var.
// A height probe (`-J` together with `--no-playlist`) ignores FAKE_YTDLP and follows
// FAKE_YTDLP_HEIGHTS instead: unset or `none`, `hang`, `fail`, `garbage`, or a comma list.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
const progress = (done, total) => out(`HAMMEL_PROGRESS ${done} ${total} NA 1000 5`);
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
      out(`HAMMEL_FILE 1080 ${join(dir, `${base}.mp4`)}`);
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
    case 'probe-hang':
      setInterval(() => {}, 1000);
      break;
    default:
      err(`ERROR: unknown fake scenario ${name}`);
      process.exitCode = 2;
  }
}

if (args.includes('-J') && args.includes('--no-playlist')) heightProbe(process.env.FAKE_YTDLP_HEIGHTS ?? 'none');
else download(scenario);
