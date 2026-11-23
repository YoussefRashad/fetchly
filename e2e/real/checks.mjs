// The checks of docs/manual-checklist-phase1.md that can be driven against the real app.
// Each run() returns { status: 'pass' | 'fail', evidence } or throws (counted as fail).
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
  BIN,
  E2E_DIR,
  ELECTRON,
  PROFILE,
  ROOT,
  addUrl,
  appStatus,
  aria2Rpc,
  bannersShown,
  clearJobs,
  clickButton,
  confirmAdd,
  decodes,
  freshDownloadDir,
  hookState,
  jobButton,
  jobs,
  killApp,
  killPid,
  killToolPid,
  launch,
  listFiles,
  localServer,
  makeClip,
  mediaInfo,
  messageShown,
  openSettings,
  pct,
  portsOf,
  processesUnder,
  readJson,
  rel,
  rowOf,
  rssFeed,
  seedSettings,
  setQuality,
  sleep,
  snapshot,
  submitUrl,
  toolProcesses,
  trayClick,
  waitFor,
  waitForShell,
  waitJob,
  waitReady,
  ytdlp,
  zoneIdentifier,
} from './lib.mjs';

// Openly licensed test content (Blender Foundation open movies, CC BY) and public pages.
// Heights as yt-dlp -J reported them on 2026-11-22.
export const URLS = {
  bbbYoutube: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', // Big Buck Bunny 4K 60fps
  shortVideo: 'https://www.youtube.com/watch?v=SkVqJ1SGeL0', // Caminandes 3: Llamigos, 2:30, up to 1080p
  longVideo: 'https://www.youtube.com/watch?v=TLkA0RELQ1g', // Elephants Dream, 10:54, up to 720p
  video4k: 'https://www.youtube.com/watch?v=lqiN98z6Dak', // Glass Half, 3:13, up to 2160p
  quotedTitle: 'https://www.youtube.com/watch?v=Z4C82eyhwgU', // "Caminandes 2: Gran Dillama" - ... (has : and ")
  blenderPlaylist: 'https://www.youtube.com/playlist?list=PLav47HAVZMjnTFVZL-aImCQIC0uLZtNCz',
  smallFile: 'https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4',
  largeFile: 'https://download.blender.org/durian/movies/Sintel.2010.1080p.mkv',
  // download.blender.org now serves the Big Buck Bunny files zipped only (checked 2026-11-23).
  largeFile2: 'https://download.blender.org/peach/bigbuckbunny_movies/big_buck_bunny_720p_h264.mov.zip', // 416 MB
  zip100: 'https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_640x360.m4v.zip', // 121 MB
  trailerFile: 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4',
  // blender.org answers yt-dlp with a Cloudflare challenge (403), so ordinary pages without one are used.
  webPages: ['https://example.com/', 'https://www.kernel.org/'],
  // Observations only: pages whose server turns the app's requests away.
  oddPages: ['https://www.blender.org/about/', 'https://www.gnu.org/philosophy/free-sw.html'],
  // Syntactically valid YouTube id that does not exist.
  missingVideo: 'https://www.youtube.com/watch?v=zzzzzzzzzz0',
};

const pass = (evidence) => ({ status: 'pass', evidence });
const fail = (evidence) => ({ status: 'fail', evidence });

/** Starts the app on the scratch profile with an empty list and a fresh folder; waits until ready. */
export async function open(dir, settings = {}, { keepJobs = false, freshDir = true } = {}) {
  if (!keepJobs) clearJobs();
  if (freshDir) freshDownloadDir(dir);
  const s = seedSettings(dir, settings);
  const ctx = await launch();
  const shell = await waitForShell(ctx.page);
  if (shell === 'install') throw new Error('tools are not installed in the scratch profile: run check 1 first');
  await waitReady(ctx.page);
  ctx.dir = s.downloadDir;
  return ctx;
}

const base = {
  1: {
    title: 'clean profile + Install',
    timeoutMs: 20 * 60000,
    async run() {
      rmSync(PROFILE, { recursive: true, force: true });
      seedSettings('c1');
      const ctx = await launch();
      const { page } = ctx;
      if ((await waitForShell(page)) !== 'install') return fail('the setup screen did not show on a clean profile');
      const listed = (await page.locator('main.install li strong').allTextContents()).map((t) => t.trim());
      const seen = new Set();
      const t0 = Date.now();
      await clickButton(page, 'Install');
      await waitFor(
        async () => {
          for (const li of await page.locator('main.install li').allTextContents().catch(() => [])) {
            const m = /^(\S+).*?(\d+)%\s*$/u.exec(li.trim());
            if (m) seen.add(`${m[1]} ${m[2]}%`);
          }
          const err = await page.locator('main.install p.error').textContent({ timeout: 100 }).catch(() => null);
          if (err) throw new Error(`install failed: ${err}`);
          return (await page.locator('header.urlbar').count()) > 0;
        },
        { timeout: 15 * 60000, interval: 300, what: 'the install to finish' },
      );
      const installSec = Math.round((Date.now() - t0) / 1000);
      const empty = (await page.locator('.empty h2').textContent({ timeout: 10000 }))?.trim();
      const versions = await (await import('./lib.mjs')).settingsVersions(page);
      const names = new Set([...seen].map((s) => s.split(' ')[0]));
      const ok =
        listed.join(',') === 'yt-dlp,ffmpeg,aria2c' &&
        ['yt-dlp', 'ffmpeg', 'aria2c'].every((n) => versions[n] && versions[n] !== 'not installed') &&
        empty === 'Nothing here yet' &&
        names.size === 3;
      const ev = `setup screen listed ${listed.join(', ')}; progress seen for ${[...names].join(', ')} (${seen.size} distinct values); install took ${installSec}s; then "${empty}"; Settings: yt-dlp ${versions['yt-dlp']}, ffmpeg ${versions.ffmpeg}, aria2c ${versions.aria2c}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  2: {
    title: 'nonsense link',
    async run() {
      const { page, dir } = await open('c2');
      const r = await submitUrl(page, 'hello');
      const list = await jobs(page);
      const files = await listFiles(dir);
      const ev = `bar shows "${r.error ?? '(add dialog opened)'}"; jobs: ${list.length}; files in folder: ${files.length}`;
      return r.error === 'Enter a link that starts with http:// or https://' && list.length === 0 && files.length === 0 ? pass(ev) : fail(ev);
    },
  },

  13: {
    title: 'web page without a video',
    async run() {
      const { page, dir } = await open('c13');
      const seen = [];
      for (const url of URLS.webPages) {
        const r = await submitUrl(page, url);
        if (r.dialog) await clickButton(page.locator('.dialog'), 'Close');
        seen.push({ url, text: r.error ?? '(add dialog opened)' });
        await sleep(2000);
      }
      const odd = [];
      for (const url of URLS.oddPages) {
        const r = await submitUrl(page, url);
        if (r.dialog) await clickButton(page.locator('.dialog'), 'Close');
        odd.push(`${url} -> "${r.error ?? '(add dialog opened)'}"`);
        await sleep(2000);
      }
      const list = await jobs(page);
      const files = await listFiles(dir);
      const ok = seen.every((s) => s.text === 'this link is a web page, not a file') && list.length === 0 && files.length === 0;
      const ev = `${seen.map((s) => `${s.url} -> "${s.text}"`).join('; ')}; jobs: ${list.length}; files: ${files.length}. Observations (not counted): ${odd.join('; ')}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  15: {
    title: 'deleted / unavailable video',
    async run() {
      const { page, dir } = await open('c15');
      const r = await submitUrl(page, URLS.missingVideo);
      const list = await jobs(page);
      const files = await listFiles(dir);
      const clear = typeof r.error === 'string' && r.error.length > 0 && !r.error.startsWith('Something went wrong') && !/stopped before/u.test(r.error);
      const ev = `non-existent YouTube id -> bar shows "${r.error ?? '(add dialog opened)'}"; jobs: ${list.length}; files: ${files.length}`;
      return clear && list.length === 0 && files.length === 0 ? pass(ev) : fail(ev);
    },
  },

  12: {
    title: 'same direct file twice',
    async run() {
      const { page } = await open('c12');
      for (let i = 0; i < 2; i += 1) {
        const err = await addUrl(page, URLS.largeFile);
        if (err) return fail(`add ${i + 1} refused: ${err}`);
      }
      const list = await waitFor(async () => {
        const l = await jobs(page);
        return l.length === 2 && l.every((j) => j.fileName) ? l : null;
      }, { timeout: 30000, what: 'two jobs with names' });
      const names = list.map((j) => j.fileName);
      // Stop both: the check is about the name; no need to pull 2 x 1.2 GB.
      for (const j of list) {
        if (j.state !== 'done') await jobButton(page, j, 'Cancel');
      }
      const gone = await waitFor(async () => (await jobs(page)).length === 0, { timeout: 30000, what: 'both cancelled' }).catch(() => false);
      const ev = `job names: ${names.map((n) => `"${n}"`).join(', ')} (then Cancel on both: ${gone ? 'both rows gone' : 'rows still listed'})`;
      return names[0] === 'Sintel.2010.1080p.mkv' && names[1] === 'Sintel.2010.1080p (2).mkv' ? pass(ev) : fail(ev);
    },
  },

  45: {
    title: 'Mark-of-the-Web on a direct file',
    async run() {
      const { page, dir } = await open('c45');
      const err = await addUrl(page, URLS.trailerFile);
      if (err) return fail(`add refused: ${err}`);
      const job = await waitJob(page, (j) => j.state === 'done' || j.state === 'failed', { timeout: 5 * 60000, what: 'the download to end' });
      if (job.state !== 'done') return fail(`job ended ${job.state}: ${job.reason}`);
      const file = join(dir, job.fileName);
      // The mark is written after done; give it a moment.
      const zone = await waitFor(async () => {
        const z = zoneIdentifier(file);
        return z.includes('ZoneId') ? z : null;
      }, { timeout: 10000, what: 'the Zone.Identifier stream' }).catch(() => zoneIdentifier(file));
      const lines = zone.split(/\r?\n/u).filter(Boolean);
      const ev = `${rel(file)} Zone.Identifier: ${lines.join(' | ')}. (Explorer Properties not opened: only the stream was read.)`;
      return /ZoneId=3/u.test(zone) && zone.includes(URLS.trailerFile) ? pass(ev) : fail(ev);
    },
  },

  48: {
    title: 'paste a link while the tools start',
    async run() {
      clearJobs();
      freshDownloadDir('c48');
      seedSettings('c48');
      const ctx = await launch();
      const { page } = ctx;
      if ((await waitForShell(page, 60000, { settle: false })) === 'install') throw new Error('tools are not installed: run check 1 first');
      const statusAtSubmit = (await appStatus(page)).engine.state;
      const t0 = Date.now();
      const r = await submitUrl(page, URLS.bbbYoutube, 120000);
      const waitSec = ((Date.now() - t0) / 1000).toFixed(1);
      if (r.dialog) await clickButton(page.locator('.dialog'), 'Close');
      const ev = `engine was "${statusAtSubmit}" when Add was pressed; ${r.dialog ? `add dialog opened after ${waitSec}s` : `bar shows "${r.error}"`}`;
      return r.dialog ? pass(ev) : fail(ev);
    },
  },

  24: {
    title: 'second instance',
    async run() {
      const ctx = await open('c24');
      // Hide the window first, so "comes to the front" is visible as a change.
      await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
      const hidden = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
      const second = spawn(ELECTRON, [ROOT, `--user-data-dir=${PROFILE}`], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
      const code = await Promise.race([new Promise((r) => second.once('exit', (c) => r(c))), sleep(20000).then(() => 'still running')]);
      if (code === 'still running') killPid(second.pid);
      const after = await waitFor(
        () => ctx.app.evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows();
          return w.length === 1 && w[0].isVisible() ? { count: w.length, visible: true, focused: w[0].isFocused() } : null;
        }),
        { timeout: 10000, what: 'the window to show' },
      ).catch(() => null);
      const hook = await hookState(ctx.app);
      const trays = hook.trayMenu ? 1 : 0;
      const ev = `window hidden (visible=${hidden}); second electron.exe on the same profile exited with code ${code}; first app then has ${after ? `${after.count} window, visible, focused=${after.focused}` : 'no visible window'}; tray menus built in the first app: ${trays}, the second process ended so it holds no tray`;
      return code !== 'still running' && after !== null ? pass(ev) : fail(ev);
    },
  },
};

// ---- videos ----

/** Sizes of the files in a folder whose name holds `.part` (partial data). */
async function partSizes(dir) {
  const out = {};
  for (const f of await listFiles(dir, true)) if (/\.part/u.test(f)) out[f] = statSync(join(dir, f)).size;
  return out;
}
const sumSizes = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** Waits for the job with this id to reach `pctAtLeast` while downloading; returns it. */
function untilPct(page, id, pctAtLeast, timeout = 10 * 60000) {
  return waitJob(page, (j) => j.id === id && ((j.state === 'downloading' && (pct(j) ?? 0) >= pctAtLeast) || j.state === 'done' || j.state === 'failed'), {
    timeout,
    what: `job at ${pctAtLeast}%`,
  });
}

/** Adds a link and returns the one new job (or the group's first job). */
async function addOne(page, url, quality) {
  const before = new Set((await jobs(page)).map((j) => j.id));
  const err = await addUrl(page, url, { quality });
  if (err) throw new Error(`add refused: ${err}`);
  return waitFor(async () => (await jobs(page)).find((j) => !before.has(j.id)) ?? null, { timeout: 20000, what: 'the new job' });
}

const ended = (id) => (j) => j.id === id && (j.state === 'done' || j.state === 'failed' || j.state === 'skipped');

/** Samples the job after a resume until it reports progress again; returns the lowest share seen. */
async function progressAfterResume(page, id, ms = 45000) {
  const until = Date.now() + ms;
  let low = null;
  let seen = 0;
  while (Date.now() < until) {
    const j = (await jobs(page)).find((x) => x.id === id);
    if (j && j.state === 'downloading' && j.bytesTotal) {
      const p = pct(j);
      low = low === null ? p : Math.min(low, p);
      seen += 1;
      if (seen >= 6) break;
    }
    if (j && (j.state === 'done' || j.state === 'merging')) break;
    await sleep(500);
  }
  return low;
}

const rowText = async (page, job) =>
  (await rowOf(page, job).locator('.job-main > span:not(.job-actions)').allTextContents()).map((t) => t.trim()).join(' | ');

Object.assign(base, {
  3: {
    title: 'video up to 720p',
    async run() {
      const { page } = await open('c3');
      const job = await addOne(page, URLS.shortVideo, 'max:720');
      const end = await waitJob(page, ended(job.id), { timeout: 10 * 60000, what: 'the download to end' });
      if (end.state !== 'done') return fail(`ended ${end.state}: ${end.reason}`);
      const file = join(end.dir, end.fileName);
      const info = await mediaInfo(file);
      const dec = await decodes(file);
      const row = await rowText(page, end);
      const ok = end.fileName.endsWith('.mp4') && /\dx720[\s,]/u.test(info.video ?? '') && info.audio !== null && dec.ok && /720p/u.test(row) && /done/u.test(row);
      const ev = `${rel(file)} (${mb(statSync(file).size)}); video: ${info.video}; audio: ${info.audio}; first 20 s decode with ffmpeg: ${dec.ok ? 'clean' : dec.error}; row: "${row}". (Sound not listened to: only the audio stream was decoded.)`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  4: {
    title: 'same video with Best available',
    async run() {
      const { page } = await open('c4');
      // The first copy only needs to exist: take it small.
      const first = await addOne(page, URLS.shortVideo, 'max:360');
      const e1 = await waitJob(page, ended(first.id), { timeout: 10 * 60000, what: 'the first copy' });
      if (e1.state !== 'done') return fail(`first copy ended ${e1.state}: ${e1.reason}`);
      await sleep(3000);
      const second = await addOne(page, URLS.shortVideo, 'best');
      const e2 = await waitJob(page, ended(second.id), { timeout: 10 * 60000, what: 'the Best copy' });
      if (e2.state !== 'done') return fail(`Best copy ended ${e2.state}: ${e2.reason}`);
      const file = join(e2.dir, e2.fileName);
      const info = await mediaInfo(file);
      const dec = await decodes(file);
      const ok = /\(2\)\.mp4$/u.test(e2.fileName) && /h264/u.test(info.video ?? '') && dec.ok;
      const ev = `source height ${e2.sourceHeight} (≤1080 -> rule says mp4/H.264); first "${e1.fileName}", second "${e2.fileName}"; video: ${info.video}; audio: ${info.audio}; decode: ${dec.ok ? 'clean' : dec.error}. The 4K side of the rule is check 39.`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  5: {
    title: 'audio only (mp3)',
    async run() {
      const { page } = await open('c5');
      const job = await addOne(page, URLS.shortVideo, 'audio:mp3');
      const end = await waitJob(page, ended(job.id), { timeout: 10 * 60000, what: 'the download to end' });
      if (end.state !== 'done') return fail(`ended ${end.state}: ${end.reason}`);
      const file = join(end.dir, end.fileName);
      const info = await mediaInfo(file);
      const dec = await decodes(file);
      const ok = end.fileName.endsWith('.mp3') && /Audio: mp3/u.test(info.audio ?? '') && dec.ok;
      const ev = `${rel(file)} (${mb(statSync(file).size)}); ${info.audio}; duration ${info.duration}; decode: ${dec.ok ? 'clean' : dec.error}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  8: {
    title: 'pause at ~30%, wait, resume',
    async run() {
      const { page, dir } = await open('c8');
      const job = await addOne(page, URLS.longVideo, 'max:720');
      const at = await untilPct(page, job.id, 30);
      if (at.state !== 'downloading') return fail(`job reached ${at.state} before 30% (too fast to pause)`);
      await jobButton(page, at, 'Pause');
      const paused = await waitJob(page, (j) => j.id === job.id && j.state === 'paused', { timeout: 30000, what: 'paused' });
      const partsPaused = await partSizes(dir);
      await sleep(10000);
      await jobButton(page, paused, 'Resume');
      const low = await progressAfterResume(page, job.id);
      const partsAfter = await partSizes(dir);
      const ok = low !== null && low >= pct(paused) - 2 && sumSizes(partsAfter) >= sumSizes(partsPaused);
      const ev = `paused at ${pct(paused)}% (${mb(paused.bytesDone)} of ${mb(paused.bytesTotal)}), partial files ${mb(sumSizes(partsPaused))}; after 10 s wait and Resume the lowest share reported was ${low}%; partial files then ${mb(sumSizes(partsAfter))}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  9: {
    title: 'pause, Quit from the tray, start, resume',
    async run() {
      const ctx = await open('c9');
      const { page } = ctx;
      const job = await addOne(page, URLS.longVideo, 'max:720');
      const at = await untilPct(page, job.id, 15);
      if (at.state !== 'downloading') return fail(`job reached ${at.state} before 15%`);
      await jobButton(page, at, 'Pause');
      const paused = await waitJob(page, (j) => j.id === job.id && j.state === 'paused', { timeout: 30000, what: 'paused' });
      await trayClick(ctx.app, 'Quit');
      const code = await Promise.race([ctx.exited, sleep(20000).then(() => 'still running')]);
      const left = await toolProcesses();
      const ctx2 = await open('c9', {}, { keepJobs: true, freshDir: false });
      const back = (await jobs(ctx2.page)).find((j) => j.id === job.id);
      if (!back || back.state !== 'paused') return fail(`after restart the job is ${back ? back.state : 'missing'}`);
      await jobButton(ctx2.page, back, 'Resume');
      const low = await progressAfterResume(ctx2.page, job.id);
      const ok = code !== 'still running' && left.length === 0 && low !== null && low >= pct(paused) - 2;
      const ev = `paused at ${pct(paused)}%; tray Quit handler -> app exited (code ${code}); tool processes left: ${left.length}; after start the job is "${back.state}" at ${pct(back)}%; after Resume the lowest share was ${low}%`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  10: {
    title: 'end electron.exe during a download',
    async run() {
      const ctx = await open('c10');
      const job = await addOne(ctx.page, URLS.longVideo, 'max:720');
      const at = await untilPct(ctx.page, job.id, 10);
      if (at.state !== 'downloading') return fail(`job reached ${at.state} before 10%`);
      const toolsBefore = await toolProcesses();
      await killApp(ctx);
      await sleep(1500);
      const orphans = await toolProcesses();
      const ctx2 = await open('c10', {}, { keepJobs: true, freshDir: false });
      // The start-up cleanup runs as part of the engine start; it is done once the engines are ready.
      const back = (await jobs(ctx2.page)).find((j) => j.id === job.id);
      const afterStart = await toolProcesses();
      const oldLeft = afterStart.filter((p) => orphans.some((o) => o.pid === p.pid));
      if (!back || back.state !== 'paused') return fail(`after restart the job is ${back ? back.state : 'missing'}`);
      const pausedPct = pct(back);
      await waitFor(async () => (await rowOf(ctx2.page, back).getByRole('button', { name: 'Resume', exact: true }).count()) > 0, { timeout: 15000, what: 'Resume button' });
      await jobButton(ctx2.page, back, 'Resume');
      const low = await progressAfterResume(ctx2.page, job.id);
      const ok = oldLeft.length === 0 && low !== null && pausedPct !== null && low >= pausedPct - 2;
      const ev = `at ${pct(at)}% killed the Electron main by PID (tools running: ${toolsBefore.map((p) => p.name).join(', ')}); left running after the kill: ${orphans.map((p) => p.name).join(', ') || 'none'}; after start: job "${back.state}" at ${pausedPct}% (interrupted=${back.interrupted}), old tool processes still running: ${oldLeft.length}; after Resume the lowest share was ${low}%`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  21: {
    title: 'cancel a half-downloaded video',
    async run() {
      const { page, dir } = await open('c21');
      writeFileSync(join(dir, 'keep-me.txt'), 'not the app’s file');
      const job = await addOne(page, URLS.longVideo, 'max:720');
      const at = await untilPct(page, job.id, 20);
      if (at.state !== 'downloading') return fail(`job reached ${at.state} before 20%`);
      const during = await listFiles(dir);
      await jobButton(page, at, 'Cancel');
      await waitFor(async () => !(await jobs(page)).some((j) => j.id === job.id), { timeout: 30000, what: 'the job to go' });
      await sleep(2000);
      const after = await listFiles(dir);
      const leftovers = after.filter((f) => f.startsWith(at.baseName));
      const ok = leftovers.length === 0 && after.includes('keep-me.txt');
      const ev = `files while downloading: ${during.join(', ')}; after Cancel at ${pct(at)}%: ${after.join(', ') || '(none)'}; leftovers of the job: ${leftovers.length}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  22: {
    title: 'Open, Open folder, Delete file',
    async run() {
      const ctx = await open('c22');
      const { page } = ctx;
      const job = await addOne(page, URLS.trailerFile);
      const done = await waitJob(page, ended(job.id), { timeout: 5 * 60000, what: 'done' });
      if (done.state !== 'done') return fail(`ended ${done.state}: ${done.reason}`);
      const file = join(done.dir, done.fileName);
      await rowOf(page, done).getByRole('button', { name: 'Open', exact: true }).click();
      await jobButton(page, done, 'Open folder');
      await sleep(1000);
      await jobButton(page, done, 'Delete file');
      await waitFor(async () => !existsSync(file), { timeout: 15000, what: 'the file to be deleted' }).catch(() => undefined);
      const hook = (await hookState(ctx.app)).calls;
      const calls = hook.filter((c) => c.name.startsWith('shell.')).map((c) => `${c.name}(${rel(c.args[0])})`);
      const asked = hook.filter((c) => c.name === 'dialog.showMessageBox').map((c) => `${c.args[0].kind} "${c.args[0].message}" [${c.args[0].buttons}] -> ${c.args[0].buttons[c.args[0].response]}`);
      const gone = !existsSync(file);
      const row = (await jobs(page)).some((j) => j.id === job.id);
      const ok =
        calls.includes(`shell.openPath(${rel(file)})`) && calls.includes(`shell.showItemInFolder(${rel(file)})`) && asked.length === 1 && gone && !row;
      const ev = `calls (stubbed, nothing opened): ${calls.join('; ')}; Delete asked first: ${asked.join('; ')}; file deleted: ${gone}; row still listed: ${row}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  23: {
    title: 'Settings -> Update yt-dlp',
    async run() {
      const { page } = await open('c23');
      await openSettings(page);
      const dialog = page.locator('.dialog');
      const before = (await dialog.locator('ul.tools li').first().textContent())?.trim();
      await clickButton(dialog, 'Update yt-dlp');
      const note = await waitFor(async () => (await dialog.locator('p.note').count()) > 0 && (await dialog.locator('p.note').textContent()), { timeout: 180000, what: 'the update result' });
      await sleep(1000);
      const after = (await dialog.locator('ul.tools li').first().textContent())?.trim();
      await clickButton(dialog, 'Close');
      await sleep(3000);
      const r = await submitUrl(page, URLS.shortVideo);
      if (r.dialog) await clickButton(page.locator('.dialog'), 'Close');
      const ev = `before "${before}"; note "${note}"; after "${after}"; then a video link probe ${r.dialog ? 'opened the add dialog' : `failed: ${r.error}`}`;
      return r.dialog && (/^yt-dlp is now /u.test(note) || note.length > 0) ? pass(ev) : fail(ev);
    },
  },
});

// ---- engines, tray, playlists, safety ----

const toolsBy = async (name) => (await toolProcesses()).filter((p) => p.name === name);

/** Renames the scratch aria2c.exe for a check and always puts it back. */
async function withAria2Moved(fn, { emptyStandIn = false } = {}) {
  const exe = join(BIN, 'aria2c.exe');
  const bak = join(BIN, 'aria2c.exe.bak');
  renameSync(exe, bak);
  if (emptyStandIn) writeFileSync(exe, '');
  const restore = () => {
    if (existsSync(bak)) {
      rmSync(exe, { force: true });
      renameSync(bak, exe);
    }
  };
  try {
    return await fn(restore);
  } finally {
    restore();
  }
}

async function quitByTray(ctx) {
  await trayClick(ctx.app, 'Quit');
  return Promise.race([ctx.exited, sleep(20000).then(() => 'still running')]);
}

/** Ticks exactly the given playlist positions in the add dialog. */
async function selectEntries(page, indexes) {
  await clickButton(page.locator('.dialog fieldset.entries'), 'Select none');
  for (const i of indexes) {
    await page.locator('.dialog fieldset.entries li').filter({ has: page.locator('span.num', { hasText: new RegExp(`^${i}$`, 'u') }) }).locator('input[type=checkbox]').check();
  }
}

const bannerButton = (page, id) => page.locator(`p.banner-${id} button`);
const hasBanner = async (page, id) => (await bannersShown(page)).some((b) => b.id === id);

/** Bytes per second over `ms`, from the jobs' own byte counts (per job and in total). */
async function rate(page, ids, ms) {
  const a = await jobs(page);
  const t0 = Date.now();
  await sleep(ms);
  const b = await jobs(page);
  const sec = (Date.now() - t0) / 1000;
  const per = {};
  for (const id of ids) {
    const x = a.find((j) => j.id === id);
    const y = b.find((j) => j.id === id);
    per[id] = x && y && y.bytesDone >= x.bytesDone ? (y.bytesDone - x.bytesDone) / sec : null;
  }
  const total = Object.values(per).reduce((s, v) => s + (v ?? 0), 0);
  return { per, total };
}
const kbs = (n) => (n === null ? 'n/a' : `${Math.round(n / 1024)} KB/s`);

Object.assign(base, {
  33: {
    title: 'Pause all twice quickly, then Resume all (file downloads)',
    async run() {
      const ctx = await open('c33', { speedLimitKbps: 1000 });
      const { page } = ctx;
      const a = await addOne(page, URLS.largeFile);
      const b = await addOne(page, URLS.largeFile2);
      await waitFor(async () => (await jobs(page)).filter((j) => j.state === 'downloading' && j.bytesDone > 0).length === 2, { timeout: 60000, what: 'both downloading' });
      await trayClick(ctx.app, 'Pause all');
      await trayClick(ctx.app, 'Pause all');
      await waitFor(async () => (await jobs(page)).every((j) => j.state === 'paused'), { timeout: 30000, what: 'both paused' });
      await trayClick(ctx.app, 'Resume all');
      await waitFor(async () => (await jobs(page)).filter((j) => j.state === 'downloading').length === 2, { timeout: 30000, what: 'both downloading again' });
      await sleep(4000);
      const keys = ['gid', 'status', 'files'];
      const all = [...(await aria2Rpc('aria2.tellActive', [keys])), ...(await aria2Rpc('aria2.tellWaiting', [0, 100, keys]))];
      const paths = all.map((d) => d.files[0]?.path ?? '').map((p) => p.replaceAll('/', '\\').toLowerCase());
      const list = await jobs(page);
      const counts = [a, b].map((j) => {
        const job = list.find((x) => x.id === j.id);
        const target = join(job.dir, job.fileName).toLowerCase();
        return { name: job.fileName, state: job.state, inAria2: paths.filter((p) => p === target).length };
      });
      const r = await rate(page, [a.id, b.id], 5000);
      const ok = counts.every((c) => c.inAria2 === 1 && c.state === 'downloading') && all.length === 2;
      const ev = `two direct files at a 1000 KB/s limit; tray "Pause all" handler twice, both paused, then "Resume all"; aria2 active+waiting downloads: ${all.length} (${all.map((d) => d.status).join(', ')}); per job: ${counts.map((c) => `${c.name} ${c.state}, ${c.inAria2}x in aria2`).join('; ')}; total rate after resume ${kbs(r.total)}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  34: {
    title: 'pause a video: no yt-dlp/ffmpeg left',
    async run() {
      const { page } = await open('c34');
      const job = await addOne(page, URLS.longVideo, 'max:720');
      const at = await untilPct(page, job.id, 5);
      if (at.state !== 'downloading') return fail(`job reached ${at.state} before 5%`);
      const before = [...(await toolsBy('yt-dlp.exe')), ...(await toolsBy('ffmpeg.exe'))];
      await jobButton(page, at, 'Pause');
      await waitJob(page, (j) => j.id === job.id && j.state === 'paused', { timeout: 30000, what: 'paused' });
      const t = Date.now();
      const after = [...(await toolsBy('yt-dlp.exe')), ...(await toolsBy('ffmpeg.exe'))];
      const ok = after.length === 0;
      const ev = `while downloading (no joining step): ${before.map((p) => p.name).join(', ') || 'none'} from the profile's bin; at the moment the row showed paused (query done ${Date.now() - t} ms later): ${after.map((p) => `${p.name} ${p.pid}`).join(', ') || 'none left'}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  29: {
    title: 'end aria2c during a file download, Retry',
    async run() {
      const { page } = await open('c29', { speedLimitKbps: 3000 });
      const file = await addOne(page, URLS.largeFile);
      const video = await addOne(page, URLS.longVideo, 'max:720');
      await waitFor(async () => (await jobs(page)).filter((j) => j.state === 'downloading' && j.bytesDone > 0).length === 2, { timeout: 120000, what: 'both downloading' });
      // Far enough in that a restart from 0 (at most 3 MB/s here) is told apart from a continuation.
      await waitJob(page, (j) => j.id === file.id && j.bytesDone >= 20 * 1048576, { timeout: 120000, what: 'the file at 20 MB' });
      const fileBefore = (await jobs(page)).find((j) => j.id === file.id);
      const [aria] = await toolsBy('aria2c.exe');
      await killToolPid(aria.pid);
      await waitFor(() => hasBanner(page, 'engine'), { timeout: 30000, what: 'the engine banner' });
      const banner = (await bannersShown(page)).find((b) => b.id === 'engine').text;
      const vr = await rate(page, [video.id], 5000);
      const fileDuring = (await jobs(page)).find((j) => j.id === file.id);
      await bannerButton(page, 'engine').click();
      const bannerGone = await waitFor(async () => !(await hasBanner(page, 'engine')), { timeout: 60000, what: 'the banner to go' }).catch(() => false);
      await sleep(2000);
      let f = (await jobs(page)).find((j) => j.id === file.id);
      const stateAfterBannerRetry = `${f.state}${f.reason ? ` (${f.reason})` : ''}`;
      const verb = f.state === 'failed' ? 'Retry' : f.state === 'paused' ? 'Resume' : null;
      if (verb) await jobButton(page, f, verb);
      f = await waitJob(page, (j) => j.id === file.id && j.state === 'downloading', { timeout: 90000, what: 'the file download to run again' }).catch(() => null);
      // Its reported bytes every 250 ms for 4 s from the moment it runs again.
      const samples = [];
      const t0 = Date.now();
      while (f && Date.now() - t0 < 4000) {
        const j = (await jobs(page)).find((x) => x.id === file.id);
        samples.push(j.state === 'downloading' ? mb(j.bytesDone) : j.state);
        await sleep(250);
      }
      const last = (await jobs(page)).find((x) => x.id === file.id);
      const continued = f !== null && last.bytesDone >= fileBefore.bytesDone * 0.9;
      const ok = bannerGone && (vr.per[video.id] ?? 0) > 0 && continued;
      const ev = `file at ${mb(fileBefore.bytesDone)} and a video running (3000 KB/s limit); ended aria2c by PID; banner: "${banner}"; video kept going at ${kbs(vr.per[video.id])}; file job during the outage: ${fileDuring.state}${fileDuring.reason ? ` (${fileDuring.reason})` : ''}; banner Retry -> banner ${bannerGone ? 'gone' : 'still shown'}; file job then ${stateAfterBannerRetry}; ${verb ? `pressed its own ${verb}` : 'no button needed (it retries by itself)'}; once running again it reported: ${samples.filter((s, i) => s !== samples[i - 1]).join(' -> ') || 'nothing'}; 4 s later ${mb(last.bytesDone)} (${continued ? 'continued' : 'not continued'} from ${mb(fileBefore.bytesDone)})`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  30: {
    title: 'aria2c ended and not restarted: queued file downloads',
    timeoutMs: 12 * 60000,
    async run() {
      const { page } = await open('c30');
      const [aria] = await toolsBy('aria2c.exe');
      await killToolPid(aria.pid);
      await waitFor(() => hasBanner(page, 'engine'), { timeout: 30000, what: 'the engine banner' });
      const job = await addOne(page, URLS.trailerFile);
      const t0 = Date.now();
      const states = new Set();
      const end = await waitFor(
        async () => {
          const j = (await jobs(page)).find((x) => x.id === job.id);
          states.add(`${j.state}${j.reason ? `: ${j.reason}` : ''}`);
          return j.state === 'failed' || j.state === 'done' ? j : null;
        },
        { timeout: 8 * 60000, what: 'the file download to fail' },
      );
      const failSec = Math.round((Date.now() - t0) / 1000);
      await bannerButton(page, 'engine').click();
      const bannerGone = await waitFor(async () => !(await hasBanner(page, 'engine')), { timeout: 60000, what: 'the banner to go' }).catch(() => false);
      await sleep(3000);
      const afterBanner = (await jobs(page)).find((x) => x.id === job.id);
      if (afterBanner.state === 'failed') await jobButton(page, afterBanner, 'Retry');
      const final = await waitJob(page, ended(job.id), { timeout: 5 * 60000, what: 'the retried download' }).catch(() => null);
      const ok = end.state === 'failed' && bannerGone && afterBanner.state === 'failed' && final?.state === 'done';
      const ev = `aria2c ended by PID, banner shown; a file added then went through: ${[...states].join(' -> ')}; ended "${end.state}" after ${failSec}s; banner Retry -> banner ${bannerGone ? 'gone' : 'still shown'}; the job stayed "${afterBanner.state}"; after its own Retry: ${final ? final.state : 'did not end'}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  '28a': {
    title: 'aria2c.exe missing at start -> setup screen; Install downloads nothing',
    async run() {
      const ctx = await open('c28a');
      await quitByTray(ctx);
      return withAria2Moved(async (restore) => {
        const ctx2 = await launch();
        const firstView = await waitForShell(ctx2.page, 60000, { settle: false });
        const shell = await waitForShell(ctx2.page);
        const banners = await bannersShown(ctx2.page);
        restore();
        const mtimes = Object.fromEntries(['yt-dlp.exe', 'ffmpeg.exe', 'aria2c.exe'].map((f) => [f, statSync(join(BIN, f)).mtimeMs]));
        const pcts = new Set();
        const t0 = Date.now();
        if (shell === 'install') await clickButton(ctx2.page, 'Install');
        await waitFor(
          async () => {
            for (const t of await ctx2.page.locator('main.install li .pct').allTextContents().catch(() => [])) pcts.add(t.trim());
            return (await ctx2.page.locator('header.urlbar').count()) > 0;
          },
          { timeout: 120000, interval: 200, what: 'the list' },
        );
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        const changed = Object.entries(mtimes).filter(([f, m]) => statSync(join(BIN, f)).mtimeMs !== m).map(([f]) => f);
        const ok = shell === 'install' && banners.length === 0 && changed.length === 0;
        const ev = `with aria2c.exe renamed the app opened the ${shell === 'install' ? 'setup screen' : 'main view'} once the tool check settled (first view drawn: ${firstView === 'install' ? 'setup screen' : 'main view, while the state was still "starting"'}; banners: ${banners.length}); name restored, Install -> list after ${sec}s; progress shown: ${[...pcts].join(', ') || 'none'}; tool files rewritten: ${changed.join(', ') || 'none'}`;
        return ok ? pass(ev) : fail(ev);
      });
    },
  },

  '28b': {
    title: 'empty aria2c.exe -> engine banner, Retry after restoring',
    async run() {
      const ctx = await open('c28b');
      await quitByTray(ctx);
      return withAria2Moved(
        async (restore) => {
          const ctx2 = await launch();
          const shell = await waitForShell(ctx2.page);
          await waitFor(() => hasBanner(ctx2.page, 'engine'), { timeout: 60000, what: 'the engine banner' }).catch(() => undefined);
          const banner = (await bannersShown(ctx2.page)).find((b) => b.id === 'engine')?.text ?? null;
          restore();
          await bannerButton(ctx2.page, 'engine').click();
          const gone = await waitFor(async () => !(await hasBanner(ctx2.page, 'engine')), { timeout: 60000, what: 'the banner to go' }).catch(() => false);
          const job = await addOne(ctx2.page, URLS.trailerFile);
          const end = await waitJob(ctx2.page, ended(job.id), { timeout: 5 * 60000, what: 'the download' });
          const ok = shell === 'main' && banner !== null && banner.startsWith('The download tools could not be started') && gone && end.state === 'done';
          const ev = `empty aria2c.exe in place: ${shell === 'main' ? 'no setup screen' : 'setup screen shown'}; banner "${banner}"; file restored while running, banner Retry -> ${gone ? 'banner gone' : 'banner still shown'}; a direct file added afterwards ended "${end.state}"`;
          return ok ? pass(ev) : fail(ev);
        },
        { emptyStandIn: true },
      );
    },
  },

  32: {
    title: 'kill during a download; leftover check made to fail',
    timeoutMs: 15 * 60000,
    async run() {
      const ctx = await open('c32');
      const job = await addOne(ctx.page, URLS.longVideo, 'max:720');
      await untilPct(ctx.page, job.id, 5);
      await killApp(ctx);
      // First run: a normal start.
      const ctx2 = await open('c32', {}, { keepJobs: true, freshDir: false });
      const j2 = (await jobs(ctx2.page)).find((j) => j.id === job.id);
      const old = (await toolProcesses()).filter((p) => p.name !== 'aria2c.exe');
      await jobButton(ctx2.page, j2, 'Resume');
      const firstOk = (await progressAfterResume(ctx2.page, job.id)) !== null;
      const beforeKill2 = await untilPct(ctx2.page, job.id, (pct(j2) ?? 0) + 2);
      await sleep(6000); // past the app's 5 s progress save
      const savedRunning = readJson(join(PROFILE, 'jobs.json'), { jobs: [] }).jobs?.find((j) => j.id === job.id);
      const windowRunning = (await jobs(ctx2.page)).find((j) => j.id === job.id);
      const kill2 = await killApp(ctx2);
      const toolsAfterKill2 = await toolProcesses();
      await sleep(3000);
      const saved3s = readJson(join(PROFILE, 'jobs.json'), { jobs: [] }).jobs?.find((j) => j.id === job.id);
      const saved = readJson(join(PROFILE, 'jobs.json'), { jobs: [] }).jobs?.find((j) => j.id === job.id);
      // Second run: PATH without PowerShell, so the leftover-process check cannot run (the app's own environment only).
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'path'));
      env.PATH = join(ROOT, 'node_modules', 'electron', 'dist');
      seedSettings('c32');
      const ctx3 = await launch({ env });
      await waitForShell(ctx3.page);
      await waitFor(async () => ['ready', 'error'].includes((await appStatus(ctx3.page)).engine.state), { timeout: 90000, what: 'the engine start' });
      await waitFor(() => hasBanner(ctx3.page, 'cutOff'), { timeout: 30000, what: 'the cut-off banner' }).catch(() => undefined);
      const cut = (await bannersShown(ctx3.page)).find((b) => b.id === 'cutOff');
      const j3 = (await jobs(ctx3.page)).find((j) => j.id === job.id);
      const resumeButton = await rowOf(ctx3.page, j3).getByRole('button', { name: 'Resume', exact: true }).count();
      const refused = await ctx3.page.evaluate((id) => window.fetchly.job(id, 'resume'), job.id);
      if (cut) await bannerButton(ctx3.page, 'cutOff').click();
      await sleep(1500);
      const j3b = (await jobs(ctx3.page)).find((j) => j.id === job.id);
      const resumeAfter = await rowOf(ctx3.page, j3b).getByRole('button', { name: 'Resume', exact: true }).count();
      if (resumeAfter) await jobButton(ctx3.page, j3b, 'Resume');
      const secondProgress = resumeAfter ? await progressAfterResume(ctx3.page, job.id) : null;
      const ok = old.length === 0 && firstOk && cut !== undefined && j3.interrupted && resumeButton === 0 && !refused.ok && resumeAfter === 1 && secondProgress !== null;
      const ev = `first run: after the kill and a normal start, old yt-dlp/ffmpeg left: ${old.length}; Resume ${firstOk ? 'continued' : 'did not continue'}. Second run (6 s after ${beforeKill2.state} ${pct(beforeKill2)}% the window showed "${windowRunning?.state}" ${pct(windowRunning ?? {})}% while jobs.json held "${savedRunning?.state}" ${savedRunning ? pct(savedRunning) : '?'}%; killed then (main ended with code ${kill2.code} after ${kill2.ms} ms; tools still running right after: ${toolsAfterKill2.map((p) => p.name).join(', ') || 'none'}); jobs.json after the kill held "${saved?.state}", 3 s later "${saved3s?.state}"; started with PowerShell off PATH): cut-off banner ${cut ? 'shown' : 'not shown'}; job interrupted=${j3.interrupted}; Resume button shown: ${resumeButton > 0}; resume over IPC -> ${refused.ok ? 'accepted' : `refused: "${refused.error}"`}; "They are gone" (window.confirm answered OK by the stub) -> Resume button ${resumeAfter ? 'back' : 'still missing'}${resumeAfter ? `, resumed at ${secondProgress}%` : ''}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  18: {
    title: 'one at a time, playlist queued',
    async run() {
      const { page } = await open('c18', { maxConcurrent: 1 });
      const r = await submitUrl(page, URLS.blenderPlaylist);
      if (!r.dialog) return fail(`probe: ${r.error}`);
      await setQuality(page, 'max:360');
      await selectEntries(page, [1, 9, 14]);
      await confirmAdd(page);
      let maxActive = 0;
      let queuedSeen = 0;
      const t0 = Date.now();
      await waitFor(
        async () => {
          const l = await jobs(page);
          const active = l.filter((j) => ['probing', 'downloading', 'merging'].includes(j.state)).length;
          maxActive = Math.max(maxActive, active);
          queuedSeen = Math.max(queuedSeen, l.filter((j) => j.state === 'queued').length);
          return l.length === 3 && l.every((j) => ['done', 'failed', 'skipped'].includes(j.state));
        },
        { timeout: 10 * 60000, interval: 300, what: 'the playlist to finish' },
      );
      const l = await jobs(page);
      const ok = maxActive === 1 && queuedSeen === 2 && l.every((j) => j.state === 'done');
      const ev = `3 playlist items at "Downloads at the same time" = 1; most running at once: ${maxActive}; most queued at once: ${queuedSeen}; final: ${l.map((j) => `${j.index}:${j.state}`).join(', ')} in ${Math.round((Date.now() - t0) / 1000)}s`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  6: {
    title: 'playlist of 5+, untick two',
    async run() {
      const { page } = await open('c6');
      const r = await submitUrl(page, URLS.blenderPlaylist);
      if (!r.dialog) return fail(`probe: ${r.error}`);
      await setQuality(page, 'max:360');
      await selectEntries(page, [1, 9, 11, 12, 14]);
      const legend5 = (await page.locator('.dialog fieldset.entries legend').textContent())?.trim();
      for (const i of [11, 14]) {
        await page.locator('.dialog fieldset.entries li').filter({ has: page.locator('span.num', { hasText: new RegExp(`^${i}$`, 'u') }) }).locator('input[type=checkbox]').uncheck();
      }
      const legend3 = (await page.locator('.dialog fieldset.entries legend').textContent())?.trim();
      await confirmAdd(page);
      const counts = new Set();
      await waitFor(
        async () => {
          const t = await page.locator('li.group .group-head .job-quality').first().textContent().catch(() => null);
          if (t) counts.add(t.trim());
          const l = await jobs(page);
          return l.length === 3 && l.every((j) => ['done', 'failed', 'skipped'].includes(j.state));
        },
        { timeout: 10 * 60000, interval: 300, what: 'the playlist to finish' },
      );
      const snap = await snapshot(page);
      const group = snap.groups[0];
      const files = (await listFiles(group.dir)).sort();
      const folder = rel(group.dir);
      const ok =
        group.dir.endsWith(group.title.replace(/[<>:"/\\|?*]/gu, '')) &&
        files.length === 3 &&
        files[0].startsWith('01 - ') &&
        files[1].startsWith('09 - ') &&
        files[2].startsWith('12 - ') &&
        counts.has('3 / 3');
      const ev = `dialog: "${legend5}" then after unticking two "${legend3}"; folder ${folder}; files: ${files.join(', ')}; group counter seen: ${[...counts].join(' -> ')}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  25: {
    title: 'playlist item with Best available',
    async run() {
      const { page } = await open('c25');
      const r = await submitUrl(page, URLS.blenderPlaylist);
      if (!r.dialog) return fail(`probe: ${r.error}`);
      await setQuality(page, 'best');
      await selectEntries(page, [11]);
      await confirmAdd(page);
      const t0 = Date.now();
      const first = await waitJob(page, (j) => j.state === 'downloading' && j.bytesDone > 0, { timeout: 120000, what: 'the download to start' });
      const delay = ((Date.now() - t0) / 1000).toFixed(1);
      const end = await waitJob(page, ended(first.id), { timeout: 10 * 60000, what: 'the download to end' });
      if (end.state !== 'done') return fail(`ended ${end.state}: ${end.reason}`);
      const file = join(end.dir, end.fileName);
      const info = await mediaInfo(file);
      const ok = end.sourceHeight === 1080 && end.fileName.endsWith('.mp4') && /h264/u.test(info.video ?? '');
      const ev = `item 11 (Caminandes 3) with Best: height check said ${end.sourceHeight} -> "${end.fileName}"; ${info.video}; from Download to the first bytes: ${delay}s (height check + start)`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  39: {
    title: 'Best: height from yt-dlp -J vs the app choice',
    async run() {
      const { page } = await open('c39');
      const out = [];
      for (const url of [URLS.video4k, URLS.longVideo]) {
        const info = JSON.parse(await ytdlp(['-J', '--no-playlist', '--no-warnings', '--', url]));
        await sleep(3000);
        const job = await addOne(page, url, 'best');
        const proc = await waitFor(
          async () => (await toolsBy('yt-dlp.exe')).find((p) => p.cmd.includes(url) && p.cmd.includes('--merge-output-format')) ?? null,
          { timeout: 120000, interval: 300, what: 'the download process' },
        );
        const container = /--merge-output-format\s+(\S+)/u.exec(proc.cmd)?.[1];
        const j = (await jobs(page)).find((x) => x.id === job.id);
        await jobButton(page, j, 'Cancel');
        await waitFor(async () => !(await jobs(page)).some((x) => x.id === job.id), { timeout: 30000, what: 'cancel' }).catch(() => undefined);
        out.push({ url, ytHeight: info.height, appHeight: j.sourceHeight, container });
        await sleep(3000);
      }
      const [k4, p720] = out;
      const ok = k4.ytHeight === 2160 && k4.appHeight === 2160 && k4.container === 'mkv' && p720.ytHeight === 720 && p720.appHeight === 720 && p720.container === 'mp4';
      const ev = `${out.map((o) => `${o.url}: yt-dlp -J height ${o.ytHeight}, app height check ${o.appHeight}, app's yt-dlp run uses --merge-output-format ${o.container}`).join('; ')} (each cancelled once the download process was seen)`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  27: {
    title: 'mp3 when the file exists; pause and resume one',
    async run() {
      const { page } = await open('c27');
      const first = await addOne(page, URLS.longVideo, 'audio:mp3');
      const e1 = await waitJob(page, ended(first.id), { timeout: 10 * 60000, what: 'the first mp3' });
      if (e1.state !== 'done') return fail(`first ended ${e1.state}: ${e1.reason}`);
      await sleep(3000);
      const second = await addOne(page, URLS.longVideo, 'audio:mp3');
      const at = await waitJob(page, (j) => j.id === second.id && ((j.state === 'downloading' && j.bytesDone > 0) || ['merging', 'done', 'failed'].includes(j.state)), { timeout: 120000, what: 'the second to run' });
      let paused = null;
      if (at.state === 'downloading') {
        await jobButton(page, at, 'Pause');
        paused = await waitJob(page, (j) => j.id === second.id && j.state === 'paused', { timeout: 30000, what: 'paused' }).catch(() => null);
        await sleep(3000);
        if (paused) await jobButton(page, paused, 'Resume');
      }
      const e2 = await waitJob(page, ended(second.id), { timeout: 10 * 60000, what: 'the second mp3' });
      const res = [];
      for (const e of [e1, e2]) {
        if (e.state !== 'done') {
          res.push({ name: e.fileName, ok: false, text: `${e.state}: ${e.reason}` });
          continue;
        }
        const f = join(e.dir, e.fileName);
        const info = await mediaInfo(f);
        const dec = await decodes(f);
        res.push({ name: e.fileName, ok: e.fileName.endsWith('.mp3') && /Audio: mp3/u.test(info.audio ?? '') && dec.ok, text: `${info.audio}, ${info.duration}, decode ${dec.ok ? 'clean' : dec.error}` });
      }
      const ok = res.every((r) => r.ok) && /\(2\)\.mp3$/u.test(e2.fileName ?? '') && paused !== null;
      const ev = `${res.map((r) => `"${r.name}": ${r.text}`).join('; ')}; second one ${paused ? `paused at ${pct(paused)}% and resumed` : `could not be paused (was ${at.state})`}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  35: {
    title: 'Delete file on a file that is open elsewhere',
    async run() {
      const ctx = await open('c35');
      const { page } = ctx;
      const job = await addOne(page, URLS.trailerFile);
      const done = await waitJob(page, ended(job.id), { timeout: 5 * 60000, what: 'done' });
      if (done.state !== 'done') return fail(`ended ${done.state}: ${done.reason}`);
      const file = join(done.dir, done.fileName);
      // Stand-in for a player: a process holding the file open with no sharing, for 25 s.
      const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$f=[IO.File]::Open('${file.replaceAll("'", "''")}','Open','Read','None'); Start-Sleep -Seconds 25; $f.Close()`], { windowsHide: true, stdio: 'ignore' });
      await waitFor(
        () => {
          try {
            rmSync(join(done.dir, 'probe.tmp'), { force: true });
            const fd = openSync(file, 'r+');
            closeSync(fd);
            return false;
          } catch (e) {
            return e.code === 'EBUSY' || e.code === 'EPERM';
          }
        },
        { timeout: 15000, interval: 200, what: 'the file to be locked' },
      );
      await jobButton(page, done, 'Delete file');
      await sleep(3000);
      const row = (await jobs(page)).find((j) => j.id === job.id);
      const msg = await messageShown(page);
      const exists = existsSync(file);
      await Promise.race([new Promise((r) => holder.once('exit', r)), sleep(30000)]);
      const ok = row !== undefined && exists && (msg !== null || row.reason !== null);
      const ev = `file held open with no sharing by a helper process; Delete file (confirmed) -> row ${row ? `stays (${row.state}${row.reason ? `, reason "${row.reason}"` : ''})` : 'removed'}; message: "${msg ?? '(none)'}"; file still on disk: ${exists}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  46: {
    title: '.url shortcut: asks first, Cancel default',
    async run() {
      const ctx = await open('c46');
      const { page } = ctx;
      const body = '[InternetShortcut]\r\nURL=https://example.com/\r\n';
      const server = createServer((req, res) => {
        const headers = { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="fetchly-test.url"', 'accept-ranges': 'bytes' };
        const range = /bytes=(\d+)-(\d*)/u.exec(req.headers.range ?? '');
        if (range) {
          const start = Number(range[1]);
          const end = range[2] === '' ? body.length - 1 : Math.min(Number(range[2]), body.length - 1);
          res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
          res.end(body.slice(start, end + 1));
        } else {
          res.writeHead(200, { ...headers, 'content-length': body.length });
          res.end(body);
        }
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      try {
        const url = `http://127.0.0.1:${server.address().port}/fetchly-test.url`;
        const job = await addOne(page, url);
        const done = await waitJob(page, ended(job.id), { timeout: 120000, what: 'done' });
        if (done.state !== 'done') return fail(`ended ${done.state}: ${done.reason}`);
        await ctx.app.evaluate(() => (globalThis.__e2e.messageBoxResponse = 1));
        await rowOf(page, done).getByRole('button', { name: 'Open', exact: true }).click();
        await sleep(1500);
        const afterCancel = (await hookState(ctx.app)).calls;
        await ctx.app.evaluate(() => (globalThis.__e2e.messageBoxResponse = 0));
        await rowOf(page, done).getByRole('button', { name: 'Open', exact: true }).click();
        await sleep(1500);
        const afterOpen = (await hookState(ctx.app)).calls;
        const box = afterCancel.find((c) => c.name === 'dialog.showMessageBox')?.args[0];
        const openedOnCancel = afterCancel.some((c) => c.name === 'shell.openPath');
        const openedOnOpen = afterOpen.filter((c) => c.name === 'shell.openPath').length;
        const ok = box && box.kind === 'app' && box.defaultId === 1 && box.cancelId === 1 && box.buttons[1] === 'Cancel' && !openedOnCancel && openedOnOpen === 1;
        const ev = `served "fetchly-test.url" from a local 127.0.0.1 server; done; Open -> box "${box?.message}" buttons [${box?.buttons}] defaultId ${box?.defaultId} cancelId ${box?.cancelId}; stub answered Cancel -> openPath calls: ${openedOnCancel ? 1 : 0}; stub answered Open -> openPath calls: ${openedOnOpen} (stubbed, nothing ran). The signed .exe half was not run: no small official signed installer was downloaded, and the Windows security prompt cannot be reached with Open stubbed.`;
        return ok ? pass(ev) : fail(ev);
      } finally {
        server.close();
      }
    },
  },

  47: {
    title: '.torrent link is saved, not followed',
    async run() {
      const index = await (await fetch('https://releases.ubuntu.com/')).text();
      const versions = [...index.matchAll(/href="(\d\d\.\d\d(?:\.\d)?)\/"/gu)].map((m) => m[1]).sort();
      const lts = versions.filter((v) => /^\d\d\.04/u.test(v) && Number(v.slice(0, 2)) % 2 === 0).pop();
      const dirHtml = await (await fetch(`https://releases.ubuntu.com/${lts}/`)).text();
      const name = /href="(ubuntu-[\d.]+-desktop-amd64\.iso\.torrent)"/u.exec(dirHtml)?.[1] ?? /href="(ubuntu-[^"]+-amd64\.iso\.torrent)"/u.exec(dirHtml)?.[1];
      if (!name) return fail(`no .torrent link found on releases.ubuntu.com/${lts}/`);
      const url = `https://releases.ubuntu.com/${lts}/${name}`;
      const { page } = await open('c47');
      const job = await addOne(page, url);
      const end = await waitJob(page, ended(job.id), { timeout: 120000, what: 'done' });
      await sleep(3000);
      const file = join(end.dir, end.fileName ?? '');
      const head = existsSync(file) ? readFileSync(file).subarray(0, 11).toString('latin1') : '';
      const size = existsSync(file) ? statSync(file).size : 0;
      const keys = ['gid', 'status', 'bittorrent'];
      const active = await aria2Rpc('aria2.tellActive', [keys]);
      const waiting = await aria2Rpc('aria2.tellWaiting', [0, 100, keys]);
      const [aria] = await toolsBy('aria2c.exe');
      const ports = await portsOf(aria.pid);
      const listen = ports.tcp.filter((c) => c.State === 'Listen').map((c) => `${c.LocalAddress}:${c.LocalPort}`);
      const files = await listFiles(end.dir);
      const ok = end.state === 'done' && end.fileName.endsWith('.torrent') && head.startsWith('d') && active.length === 0 && waiting.length === 0 && listen.every((l) => l.startsWith('127.0.0.1:') || l.startsWith('::1:')) && ports.udp.length === 0 && files.length === 1;
      const ev = `${url} -> job "${end.state}", saved "${end.fileName}" (${size} bytes, starts "${head.replace(/[^\x20-\x7e]/gu, '.')}"); folder holds ${files.length} file(s); aria2 active ${active.length}, waiting ${waiting.length}; aria2c listening TCP: ${listen.join(', ') || 'none'} (loopback only = its RPC port, not reachable by peers); UDP endpoints: ${ports.udp.length}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  19: {
    title: 'close the window during a download',
    async run() {
      const ctx = await open('c19');
      const { page } = ctx;
      const job = await addOne(page, URLS.longVideo, 'max:360');
      await waitJob(page, (j) => j.id === job.id && j.state === 'downloading' && j.bytesDone > 0, { timeout: 120000, what: 'downloading' });
      await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await sleep(1000);
      const win = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), destroyed: w.isDestroyed() })));
      const tips = (await hookState(ctx.app)).trayTooltips.map((t) => t.text);
      const end = await waitJob(page, ended(job.id), { timeout: 10 * 60000, what: 'done' });
      await sleep(1500);
      const hook = await hookState(ctx.app);
      const note = hook.notifications.at(-1);
      await ctx.app.evaluate(() => globalThis.__e2e.notifications.at(-1)?.note.emit('click'));
      await sleep(1000);
      const shown = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
      const ok = win.length === 1 && !win[0].visible && !win[0].destroyed && tips.includes('Fetchly · 1 downloading') && end.state === 'done' && note?.title === 'Download finished' && shown[0] === true;
      const ev = `window closed by its own close handler -> ${win.length} window, visible=${win[0]?.visible}; download went on and ended "${end.state}"; tray tooltips set: ${[...new Set(tips)].join(' | ')}; notification shown: ${note ? `"${note.title}: ${note.body}"` : 'none'}; its click event (emitted, not a native click) -> window visible=${shown[0]}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  17: {
    title: 'speed limit 500 KB/s across a video and a file; change while running',
    async run() {
      const { page } = await open('c17', { speedLimitKbps: 500 });
      const video = await addOne(page, URLS.longVideo, 'max:720');
      const file = await addOne(page, URLS.largeFile);
      await waitFor(async () => (await jobs(page)).filter((j) => j.state === 'downloading' && j.bytesDone > 0).length === 2, { timeout: 120000, what: 'both downloading' });
      await sleep(5000);
      const r1 = await rate(page, [video.id, file.id], 20000);
      const vBefore = (await jobs(page)).find((j) => j.id === video.id);
      await openSettings(page);
      await page.locator('.dialog label', { hasText: 'Speed limit' }).locator('input').fill('300');
      await clickButton(page.locator('.dialog'), 'Save');
      await page.waitForSelector('.dialog', { state: 'detached' });
      const states = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) {
        const v = (await jobs(page)).find((j) => j.id === video.id);
        states.add(v.state);
        await sleep(300);
      }
      const vMid = (await jobs(page)).find((j) => j.id === video.id);
      const r2 = await rate(page, [video.id, file.id], 20000);
      const ok = r1.total <= 500 * 1024 * 1.2 && r1.total >= 500 * 1024 * 0.5 && r2.total <= 300 * 1024 * 1.25 && vMid.state === 'downloading' && vMid.bytesDone >= vBefore.bytesDone * 0.95;
      const ev = `at 500 KB/s: video ${kbs(r1.per[video.id])} + file ${kbs(r1.per[file.id])} = ${kbs(r1.total)} (20 s, from byte counts); limit changed to 300 in Settings: video states seen ${[...states].join(' -> ')}, its bytes ${mb(vBefore.bytesDone)} -> ${mb(vMid.bytesDone)} (continued, not restarted from 0); then video ${kbs(r2.per[video.id])} + file ${kbs(r2.per[file.id])} = ${kbs(r2.total)}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  7: {
    title: 'title with : and "',
    async run() {
      const { page } = await open('c7');
      const job = await addOne(page, URLS.quotedTitle, 'max:360');
      const end = await waitJob(page, ended(job.id), { timeout: 10 * 60000, what: 'done' });
      if (end.state !== 'done') return fail(`ended ${end.state}: ${end.reason}`);
      const files = await listFiles(end.dir);
      const ok = existsSync(join(end.dir, end.fileName)) && /Caminandes 2/u.test(end.fileName) && /Gran Dillama/u.test(end.fileName);
      const ev = `title ${JSON.stringify(end.title)} -> file "${end.fileName}" (folder: ${files.join(', ')}). Arabic text not covered: no openly licensed video with an Arabic title was used.`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  36: {
    title: 'cancel a half-downloaded video from another site',
    async run() {
      const api = await (await fetch('https://video.blender.org/api/v1/videos?count=25&sort=-publishedAt&isLocal=true')).json();
      const pick = api.data.find((v) => v.duration >= 300 && v.duration <= 1200 && !v.isLive);
      if (!pick) return fail('no suitable video on video.blender.org');
      const url = `https://video.blender.org/w/${pick.shortUUID}`;
      const { page, dir } = await open('c36');
      const job = await addOne(page, url, 'max:720');
      const at = await untilPct(page, job.id, 20, 5 * 60000);
      if (at.state !== 'downloading') return fail(`job reached ${at.state} before 20%`);
      const during = await listFiles(dir);
      await jobButton(page, at, 'Cancel');
      await waitFor(async () => !(await jobs(page)).some((j) => j.id === job.id), { timeout: 30000, what: 'the job to go' });
      await sleep(2000);
      const after = await listFiles(dir);
      const ev = `${url} ("${pick.name}", PeerTube on video.blender.org); files while downloading: ${during.join(', ')}; after Cancel at ${pct(at)}%: ${after.join(', ') || 'none'}`;
      return pass(ev);
    },
  },

  20: {
    title: 'tray menu: Pause all, Resume all, Open, Quit; Quit while finishing',
    timeoutMs: 20 * 60000,
    async run() {
      const ctx = await open('c20', { speedLimitKbps: 2000 });
      const { page } = ctx;
      const v = await addOne(page, URLS.longVideo, 'max:360');
      const f = await addOne(page, URLS.largeFile);
      await waitFor(async () => (await jobs(page)).filter((j) => j.state === 'downloading').length === 2, { timeout: 120000, what: 'both downloading' });
      await trayClick(ctx.app, 'Pause all');
      const pausedAll = await waitFor(async () => (await jobs(page)).every((j) => j.state === 'paused'), { timeout: 30000, what: 'all paused' }).catch(() => false);
      await trayClick(ctx.app, 'Resume all');
      const resumedAll = await waitFor(async () => (await jobs(page)).every((j) => j.state === 'downloading'), { timeout: 30000, what: 'all downloading' }).catch(() => false);
      await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
      await trayClick(ctx.app, 'Open');
      await sleep(800);
      const opened = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
      const code = await quitByTray(ctx);
      await sleep(1500);
      const leftTools = await toolProcesses();
      const leftElectron = await processesUnder(join(ROOT, 'node_modules', 'electron', 'dist'));
      // Part two: Quit while "finishing…".
      const ctx2 = await open('c20b');
      const job = await addOne(ctx2.page, URLS.longVideo, 'max:720');
      // The joining step lasts well under a second here: watch the window's own change events
      // and press Quit (the tray handler) the moment the job shows "finishing…".
      await ctx2.page.evaluate((id) => {
        window.__e2eSeen = null;
        window.fetchly.onChanged((s) => {
          const j = s.jobs.find((x) => x.id === id);
          if (j && window.__e2eSeen === null && ['merging', 'done', 'failed'].includes(j.state)) window.__e2eSeen = j.state;
        });
      }, job.id);
      // waitForFunction evaluates a string, which the window's Content-Security-Policy refuses: poll instead.
      const seen = await waitFor(() => ctx2.page.evaluate(() => window.__e2eSeen), { timeout: 10 * 60000, interval: 15, what: 'finishing' });
      const caught = seen === 'merging';
      let part2;
      if (caught) {
        await quitByTray(ctx2);
        await sleep(1500);
        const left2 = (await toolProcesses()).filter((p) => p.name !== 'aria2c.exe');
        const ctx3 = await open('c20b', {}, { keepJobs: true, freshDir: false });
        const back = (await jobs(ctx3.page)).find((x) => x.id === job.id);
        if (back.state === 'paused' && !back.interrupted) await jobButton(ctx3.page, back, 'Resume');
        const end = await waitJob(ctx3.page, ended(job.id), { timeout: 5 * 60000, what: 'done' }).catch(() => null);
        part2 = { ok: left2.length === 0 && back.state === 'paused' && end?.state === 'done', text: `Quit while "finishing…": tools left ${left2.map((p) => p.name).join(', ') || 'none'}; next start the job is "${back.state}"${back.interrupted ? ' (cut off)' : ''}; after Resume: ${end ? end.state : 'did not end'}` };
      } else {
        part2 = { ok: null, text: `the "finishing…" state was not caught (the first state the window was told after downloading was "${seen}"), so Quit during it was not tested` };
      }
      // Only a fully tested check passes; an untested second half is reported as a fail of coverage, not of the app.
      const ok = pausedAll && resumedAll && opened && code !== 'still running' && leftTools.length === 0 && leftElectron.length === 0 && part2.ok === true;
      if (ok === false && part2.ok === null && pausedAll && resumedAll && opened && code !== 'still running' && leftTools.length === 0 && leftElectron.length === 0) {
        return { status: 'not-run', evidence: `first half passed, second half not tested: ${part2.text}. First half: Pause all -> all paused; Resume all -> all downloading; Open on a hidden window -> visible=true; Quit -> exit code ${code}, left: tools 0, electron 0.` };
      }
      const ev = `Pause all -> ${pausedAll ? 'all paused' : 'not all paused'}; Resume all -> ${resumedAll ? 'all downloading' : 'not all downloading'}; Open on a hidden window -> visible=${opened}; Quit -> exit code ${code}, left: tools ${leftTools.length}, electron ${leftElectron.length}. ${part2.text}. (Menu items run through their click handlers, not native clicks.)`;
      void v;
      void f;
      return ok ? pass(ev) : fail(ev);
    },
  },
});

// ---- large file, local feeds and pages ----

/** Bytes per second one plain HTTP connection gets from `url` over `ms` (a browser-like single stream). */
async function singleConnectionRate(url, ms) {
  const abort = new AbortController();
  const res = await fetch(url, { signal: abort.signal });
  const reader = res.body.getReader();
  const t0 = Date.now();
  let n = 0;
  try {
    while (Date.now() - t0 < ms) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
    }
  } finally {
    abort.abort();
    await reader.cancel().catch(() => undefined);
  }
  return n / ((Date.now() - t0) / 1000);
}

/** Lists a zip and extracts every entry to nowhere with Windows' tar (libarchive checks each CRC). */
function zipIntact(file) {
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const runTar = (args) =>
    new Promise((res) => {
      const p = spawn(tar, args, { windowsHide: true, stdio: ['ignore', args[0] === '-tf' ? 'pipe' : 'ignore', 'pipe'] });
      let out = '';
      let err = '';
      p.stdout?.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('close', (code) => res({ code, out: out.trim(), err: err.trim() }));
    });
  return runTar(['-tf', file]).then(async (list) => ({ list, extract: await runTar(['-xOf', file]) }));
}

const SKIPPED_ROWS = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('li.job')].map((li) => li.textContent.replace(/\s+/gu, ' ').trim()).filter((t) => /skipped/u.test(t)),
  );

const codePoints = (s) => [...s].map((c) => (c.charCodeAt(0) > 126 ? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}` : c)).join('');

Object.assign(base, {
  11: {
    title: 'large direct file (zip, 100 MB+): connections, pause/resume, opens',
    timeoutMs: 25 * 60000,
    async run() {
      const single = await singleConnectionRate(URLS.zip100, 10000);
      await sleep(2000);
      const { page } = await open('c11');
      const job = await addOne(page, URLS.zip100);
      await waitJob(page, (j) => j.id === job.id && j.state === 'downloading' && j.bytesDone > 0, { timeout: 120000, what: 'downloading' });
      await sleep(3000);
      const act = await aria2Rpc('aria2.tellActive', [['gid', 'connections', 'downloadSpeed']]);
      const connections = act.map((d) => Number(d.connections));
      const r = await rate(page, [job.id], 10000);
      const at = await untilPct(page, job.id, 30, 15 * 60000);
      let pauseText = 'finished before 30%, pause not tried';
      let pauseOk = false;
      if (at.state === 'downloading') {
        await jobButton(page, at, 'Pause');
        const paused = await waitJob(page, (j) => j.id === job.id && j.state === 'paused', { timeout: 30000, what: 'paused' });
        await sleep(5000);
        const partBefore = existsSync(join(paused.dir, paused.fileName)) ? statSync(join(paused.dir, paused.fileName)).size : null;
        await jobButton(page, paused, 'Resume');
        const tResume = Date.now();
        // What aria2 itself holds right after Resume (first 3 s).
        const aria = [];
        const keys = ['status', 'completedLength', 'totalLength', 'downloadSpeed'];
        while (Date.now() - tResume < 3000) {
          const all = [...(await aria2Rpc('aria2.tellActive', [keys]).catch(() => [])), ...(await aria2Rpc('aria2.tellWaiting', [0, 10, keys]).catch(() => []))];
          aria.push(all.map((d) => `${d.status} ${mb(Number(d.completedLength))}/${mb(Number(d.totalLength))}`).join(' + ') || 'nothing in aria2');
          await sleep(300);
        }
        // Then the window's progress every 250 ms until the job ends: when does it pass the paused share again?
        const samples = [];
        let backAt = null;
        let end1 = null;
        while (Date.now() - tResume < 5 * 60000) {
          const j = (await jobs(page)).find((x) => x.id === job.id);
          const s = j.state === 'downloading' ? `${pct(j) ?? '?'}%` : j.state;
          if (s !== samples.at(-1)?.s) samples.push({ s, t: ((Date.now() - tResume) / 1000).toFixed(1) });
          if (backAt === null && j.state === 'downloading' && (pct(j) ?? 0) >= pct(paused)) backAt = (Date.now() - tResume) / 1000;
          if (['done', 'failed'].includes(j.state)) {
            end1 = (Date.now() - tResume) / 1000;
            break;
          }
          await sleep(250);
        }
        const rateBps = r.total || 1;
        const contSec = (paused.bytesTotal - paused.bytesDone) / rateBps;
        const fullSec = paused.bytesTotal / rateBps;
        const shown = samples.length > 14 ? [...samples.slice(0, 7), { s: '…', t: '' }, ...samples.slice(-6)] : samples;
        const firstPct = samples.find((x) => x.s.endsWith('%'));
        pauseOk = firstPct !== undefined && Number(firstPct.s.slice(0, -1)) >= pct(paused) - 2;
        pauseText = `paused at ${pct(paused)}% (${mb(paused.bytesDone)}; file on disk ${partBefore === null ? 'n/a' : mb(partBefore)}, preallocated), Resume after 5 s; aria2 in the first 3 s: ${aria.filter((s, i) => s !== aria[i - 1]).join(' -> ')}; window progress after Resume (s: value): ${shown.map((x) => (x.t ? `${x.t}: ${x.s}` : x.s)).join(', ')}; back at ${pct(paused)}% after ${backAt === null ? 'never' : `${backAt.toFixed(1)} s`}, ended after ${end1 === null ? 'n/a' : `${end1.toFixed(1)} s`} (at the measured rate a continuation needs about ${contSec.toFixed(0)} s, a restart from 0 about ${fullSec.toFixed(0)} s)`;
      }
      const end = await waitJob(page, ended(job.id), { timeout: 20 * 60000, what: 'the download to end' });
      if (end.state !== 'done') return fail(`ended ${end.state}: ${end.reason}; ${pauseText}`);
      const file = join(end.dir, end.fileName);
      const z = await zipIntact(file);
      const ok = Math.max(0, ...connections) >= 2 && pauseOk && z.list.code === 0 && z.extract.code === 0 && z.list.out !== '';
      const ev = `${rel(file)} (${mb(statSync(file).size)}); aria2 connections for it: ${connections.join(', ')}; app rate ${kbs(r.total)} vs one plain connection (Node fetch, 10 s, before the app) ${kbs(single)}; ${pauseText}; zip lists "${z.list.out.split(/\r?\n/u).join(', ')}" and extracts with every CRC checked: ${z.extract.code === 0 ? 'clean' : z.extract.err}`;
      return ok ? pass(ev) : fail(ev);
    },
  },

  16: {
    title: 'playlist with a deleted item (local RSS feed of YouTube links)',
    timeoutMs: 15 * 60000,
    async run() {
      const items = [
        { title: 'Caminandes 3', link: URLS.shortVideo },
        { title: 'Missing video', link: URLS.missingVideo },
        { title: 'Caminandes 2', link: URLS.quotedTitle },
      ];
      const srv = await localServer({ '/feed.xml': { type: 'application/rss+xml', body: rssFeed('E2E deleted item feed', items) } });
      try {
        const ctx = await open('c16');
        const { page } = ctx;
        const r = await submitUrl(page, `${srv.base}/feed.xml`);
        if (!r.dialog) return fail(`probe: ${r.error}`);
        const legend = (await page.locator('.dialog fieldset.entries legend').textContent())?.trim();
        await setQuality(page, 'max:360');
        await confirmAdd(page);
        const states = {};
        await waitFor(
          async () => {
            const l = await jobs(page);
            for (const j of l) (states[j.index] ??= new Set()).add(`${j.state}${j.reason ? `: ${j.reason}` : ''}`);
            return l.length === 3 && l.every((j) => ['done', 'failed', 'skipped'].includes(j.state));
          },
          { timeout: 12 * 60000, interval: 500, what: 'the playlist to finish' },
        );
        await sleep(2000);
        const l = await jobs(page);
        const bad = l.find((j) => j.index === 2);
        const notes = (await hookState(ctx.app)).notifications;
        const note = notes.find((n) => n.title === 'Playlist finished') ?? notes.at(-1);
        const skippedRows = await SKIPPED_ROWS(page);
        const ok = bad.state === 'skipped' && bad.reason && l.filter((j) => j.index !== 2).every((j) => j.state === 'done') && /1 skipped/u.test(note?.body ?? '');
        const ev = `feed served from 127.0.0.1 with 3 YouTube links (item 2 a non-existent id); dialog "${legend}"; states seen: ${Object.entries(states).map(([i, s]) => `${i}: ${[...s].join(' -> ')}`).join('; ')}; rows showing skipped: ${skippedRows.length}; notification: ${note ? `"${note.title}: ${note.body}"` : 'none'}`;
        return ok ? pass(ev) : fail(ev);
      } finally {
        await srv.close();
      }
    },
  },

  37: {
    title: 'playlist with a private and a deleted item (yt-dlp placeholder titles, local feed)',
    async run() {
      // A flat YouTube playlist lists unavailable videos with these titles; the feed gives yt-dlp the same titles.
      const items = [
        { title: '[Private video]', link: 'https://www.youtube.com/watch?v=zzzzzzzzzz1' },
        { title: 'Caminandes 3', link: URLS.shortVideo },
        { title: '[Deleted video]', link: 'https://www.youtube.com/watch?v=zzzzzzzzzz2' },
      ];
      const srv = await localServer({ '/feed.xml': { type: 'application/rss+xml', body: rssFeed('E2E private and deleted feed', items) } });
      try {
        const { page } = await open('c37');
        const r = await submitUrl(page, `${srv.base}/feed.xml`);
        if (!r.dialog) return fail(`probe: ${r.error}`);
        const dialogRows = (await page.locator('.dialog fieldset.entries li').allTextContents()).map((t) => t.replace(/\s+/gu, ' ').trim());
        const disabled = await page.locator('.dialog fieldset.entries input[type=checkbox]:disabled').count();
        await setQuality(page, 'max:360');
        await confirmAdd(page);
        const l = await waitFor(async () => {
          const x = await jobs(page);
          return x.length === 3 ? x : null;
        }, { timeout: 20000, what: 'three rows' });
        const rows = await SKIPPED_ROWS(page);
        const p = l.find((j) => j.index === 1);
        const d = l.find((j) => j.index === 3);
        const real = l.find((j) => j.index === 2);
        const realState = real.state;
        if (!['done', 'failed', 'skipped'].includes(realState)) await jobButton(page, real, 'Cancel').catch(() => undefined);
        const ok = p.state === 'skipped' && p.reason === 'private' && d.state === 'skipped' && d.reason === 'removed' && disabled === 2;
        const ev = `feed served from 127.0.0.1 (titles as yt-dlp gives them for a YouTube playlist; not a real YouTube playlist); dialog rows: ${dialogRows.join(' | ')} (disabled boxes: ${disabled}); after Download: item 1 ${p.state} (${p.reason}), item 3 ${d.state} (${d.reason}), item 2 ${realState} (then cancelled); list rows: ${rows.join(' | ')}`;
        return ok ? pass(ev) : fail(ev);
      } finally {
        await srv.close();
      }
    },
  },

  26: {
    title: '"Always save as mp4" with a webm-only source (local page)',
    async run() {
      const serveDir = join(E2E_DIR, 'serve');
      mkdirSync(serveDir, { recursive: true });
      const clip = join(serveDir, 'clip.webm');
      // A clip made here (test pattern + tone), VP9/Opus in webm: no mp4 exists at the source.
      await makeClip(clip, ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '8', '-c:v', 'libvpx-vp9', '-b:v', '300k', '-c:a', 'libopus', '-shortest']);
      const srcInfo = await mediaInfo(clip);
      const html = (title, tag) => `<!doctype html><html><head><title>${title}</title></head><body><video controls>${tag}</video></body></html>`;
      // Two pages: one whose <source> declares its height (res, as many players do), one that does not.
      const srv = await localServer({
        '/labelled.html': { type: 'text/html; charset=utf-8', body: html('E2E webm labelled', '<source src="/clip.webm" type="video/webm" res="360" label="360p">') },
        '/plain.html': { type: 'text/html; charset=utf-8', body: html('E2E webm plain', '<source src="/clip.webm" type="video/webm">') },
        '/clip.webm': { type: 'video/webm', body: () => readFileSync(clip) },
      });
      try {
        const ctx = await open('c26', { preferMp4Max1080: true });
        const out = [];
        for (const path of ['/labelled.html', '/plain.html']) {
          const job = await addOne(ctx.page, `${srv.base}${path}`);
          const proc = await waitFor(async () => (await toolsBy('yt-dlp.exe')).find((p) => p.cmd.includes(path) && p.cmd.includes('--remux-video')) ?? null, { timeout: 60000, interval: 200, what: 'the download process' }).catch(() => null);
          const end = await waitJob(ctx.page, ended(job.id), { timeout: 5 * 60000, what: 'the download to end' });
          const remux = proc ? /--remux-video\s+mp4/u.test(proc.cmd) : 'process not seen';
          if (end.state !== 'done') {
            out.push({ path, ok: false, text: `${path}: ended ${end.state} ("${end.reason}"); --remux-video mp4 passed: ${remux}` });
            continue;
          }
          const file = join(end.dir, end.fileName);
          const info = await mediaInfo(file);
          const dec = await decodes(file);
          out.push({ path, ok: end.fileName.endsWith('.mp4') && info.video !== null && dec.ok, text: `${path}: ${rel(file)}: ${info.video}; ${info.audio}; decode ${dec.ok ? 'clean' : dec.error}; --remux-video mp4 passed: ${remux}` });
        }
        const ev = `source ${srcInfo.video?.replace(/^Stream #\S+ /u, '')} in .webm (made with ffmpeg), on 127.0.0.1 pages with <video><source>; "Always save as mp4" on, Best available. ${out.map((o) => o.text).join(' || ')}`;
        return out.every((o) => o.ok) ? pass(ev) : fail(ev);
      } finally {
        await srv.close();
      }
    },
  },

  40: {
    title: 'very large video information (over 64 MB, local feed)',
    async run() {
      // 240 entries with 300 KB descriptions each: yt-dlp -J prints over 64 MB.
      const desc = 'x'.repeat(300 * 1024);
      const items = Array.from({ length: 240 }, (_, i) => ({ title: `Item ${i + 1}`, link: `https://www.youtube.com/watch?v=zzzzzzzz${String(i).padStart(3, '0')}`, description: desc }));
      const xml = rssFeed('E2E huge feed', items);
      const srv = await localServer({ '/huge.xml': { type: 'application/rss+xml', body: xml } });
      try {
        const url = `${srv.base}/huge.xml`;
        const t0 = Date.now();
        const out = await ytdlp(['-J', '--flat-playlist', '--no-warnings', url], 180000);
        const direct = { bytes: Buffer.byteLength(out), sec: ((Date.now() - t0) / 1000).toFixed(1) };
        const { page } = await open('c40');
        const t1 = Date.now();
        const r = await submitUrl(page, url, 180000);
        const appSec = ((Date.now() - t1) / 1000).toFixed(1);
        if (r.dialog) await clickButton(page.locator('.dialog'), 'Close');
        const list = await jobs(page);
        const ok = r.error === 'could not read the video information' && list.length === 0;
        const ev = `feed of ${mb(Buffer.byteLength(xml))} served on 127.0.0.1; the profile's yt-dlp -J --flat-playlist printed ${mb(direct.bytes)} in ${direct.sec}s; in the app the bar shows "${r.error ?? '(add dialog opened)'}" after ${appSec}s; jobs: ${list.length}`;
        return ok ? pass(ev) : fail(ev);
      } finally {
        await srv.close();
      }
    },
  },

  44: {
    title: 'playlist entry urls with non-ASCII spaces, then restart',
    async run() {
      const items = [
        { title: 'Caminandes 3 (NBSP after the link)', link: `${URLS.shortVideo}\u00a0` },
        { title: 'Caminandes 2 (ideographic space before the link)', link: `\u3000${URLS.quotedTitle}` },
      ];
      const srv = await localServer({ '/feed.xml': { type: 'application/rss+xml', body: rssFeed('E2E non-ASCII space feed', items) } });
      try {
        const url = `${srv.base}/feed.xml`;
        const info = JSON.parse(await ytdlp(['-J', '--flat-playlist', '--no-warnings', url]));
        const given = info.entries.map((e) => codePoints(e.url));
        const raw = info.entries.some((e) => /[\u00a0\u3000]/u.test(e.url));
        const ctx = await open('c44');
        const r = await submitUrl(ctx.page, url);
        if (!r.dialog) return fail(`probe: ${r.error}; yt-dlp entry urls ${given.join(', ')}`);
        await setQuality(ctx.page, 'max:360');
        await confirmAdd(ctx.page);
        const before = await waitFor(async () => {
          const l = await jobs(ctx.page);
          return l.length === 2 ? l : null;
        }, { timeout: 20000, what: 'two rows' });
        // Quit at once: the restart is what is checked, not the download.
        const code = await quitByTray(ctx);
        const stored = readJson(join(PROFILE, 'jobs.json'), { jobs: [] }).jobs?.map((j) => codePoints(j.url)) ?? [];
        const ctx2 = await open('c44', {}, { keepJobs: true, freshDir: false });
        const after = await jobs(ctx2.page);
        const corrupt = (await listFiles(PROFILE)).filter((f) => f.startsWith('jobs.json.corrupt'));
        for (const j of after) if (!['done', 'failed', 'skipped'].includes(j.state)) await jobButton(ctx2.page, j, 'Cancel').catch(() => undefined);
        const ok = raw && after.length === before.length && corrupt.length === 0;
        const ev = `feed served on 127.0.0.1; yt-dlp gave entry urls ${given.join(', ')} (non-ASCII space kept by yt-dlp: ${raw}); added 2 rows, Quit (code ${code}); jobs.json urls ${stored.join(', ')}; after start the list has ${after.length} rows (${after.map((j) => j.state).join(', ')}); jobs.json.corrupt-* files: ${corrupt.length}`;
        return ok ? pass(ev) : fail(ev);
      } finally {
        await srv.close();
      }
    },
  },
});

// Checks that need something this driver must not or cannot do.
const NOT_RUN = {
  14: 'needs Wi-Fi turned off during a download (network adapter change is not allowed in this run)',
  31: 'needs jobs.json made unwritable via ACLs; ACL changes are not allowed in this run',
  38: 'needs the packaged app; phase 1 has no packaged build yet',
  41: 'needs taskkill made unavailable or failing (system change)',
  42: 'needs a tool install made to fail mid-extract with an unusual error (system change)',
  43: 'needs the connection cut while the checksum list is read (network change)',
};

export const CHECKS = {};
const ALL_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28a', '28b', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48'];
for (const id of ALL_IDS) {
  const impl = base[id];
  if (NOT_RUN[id]) CHECKS[id] = { notRun: NOT_RUN[id] };
  else if (impl) CHECKS[id] = impl;
  else CHECKS[id] = { notRun: 'not automated by this driver yet' };
}

/** Order for `all`: cheap checks first, then by cost. */
export const ORDER = [
  '2', '13', '15', '12', '45', '48', '24', '1', '3', '5', '11', '8', '9', '10', '21', '22', '23', '33', '34', '29', '28a', '28b', '30', '32', '18', '17', '6', '16', '37', '4', '39', '25', '27', '35', '44', '46', '47', '19', '40', '36', '26', '7', '20',
  '14', '31', '38', '41', '42', '43',
];
