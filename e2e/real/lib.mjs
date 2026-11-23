// Shared helpers for the real-app checks. Every path derives from the repository root or an
// env var; nothing here touches the owner's real profile (%APPDATA%\fetchly).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { _electron } from 'playwright-core';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const E2E_DIR = process.env.FETCHLY_E2E_DIR ? resolve(process.env.FETCHLY_E2E_DIR) : join(ROOT, '.e2e-real');
export const PROFILE = join(E2E_DIR, 'profile');
export const BIN = join(PROFILE, 'bin');
export const DOWNLOADS = join(E2E_DIR, 'downloads');
export const ELECTRON = process.env.FETCHLY_E2E_ELECTRON ?? join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
export const HOOK = join(import.meta.dirname, 'hook.cjs');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A path as it may appear in results: relative to the repository, with forward slashes. */
export function rel(p) {
  if (typeof p !== 'string') return p;
  const r = relative(ROOT, p);
  return r.startsWith('..') ? p : r.split(sep).join('/');
}

/** Replaces every absolute path under the repository in a text with its relative form. */
export function scrub(text) {
  let out = String(text);
  for (const base of [ROOT, ROOT.split(sep).join('/')]) out = out.split(base + (base.includes('/') ? '/' : sep)).join('');
  return out;
}

export const DEFAULT_SETTINGS = {
  askEveryTime: false,
  maxConcurrent: 3,
  speedLimitKbps: 0,
  autoResumeOnStart: false,
  preferMp4Max1080: false,
  defaultQuality: { kind: 'best' },
  subtitleLangs: [],
};

/** Writes settings.json into the scratch profile; downloadDir defaults to .e2e-real/downloads/<dir>. */
export function seedSettings(dir, overrides = {}) {
  mkdirSync(PROFILE, { recursive: true });
  const downloadDir = join(DOWNLOADS, dir);
  mkdirSync(downloadDir, { recursive: true });
  const settings = { downloadDir, ...DEFAULT_SETTINGS, ...overrides };
  writeFileSync(join(PROFILE, 'settings.json'), JSON.stringify(settings, null, 2));
  return settings;
}

/** Empties the download list of the scratch profile (jobs.json only). */
export function clearJobs() {
  for (const f of ['jobs.json', 'jobs.json.tmp']) rmSync(join(PROFILE, f), { force: true });
}

/** A fresh, empty download folder for one check. */
export function freshDownloadDir(dir) {
  const p = join(DOWNLOADS, dir);
  rmSync(p, { recursive: true, force: true });
  mkdirSync(p, { recursive: true });
  return p;
}

export function toolsInstalled() {
  return ['yt-dlp.exe', 'ffmpeg.exe', 'aria2c.exe'].every((f) => existsSync(join(BIN, f)));
}

/**
 * Starts the built app on the scratch profile. Returns { app, page, pid, close }.
 * `confirm` answers window.confirm in the window (true = OK).
 */
export async function launch({ confirm = true, env = undefined } = {}) {
  if (!existsSync(join(ROOT, 'out', 'main', 'index.js'))) throw new Error('out/ is missing: run npm run build first');
  mkdirSync(PROFILE, { recursive: true });
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: ['-r', HOOK, ROOT, `--user-data-dir=${PROFILE}`],
    cwd: ROOT,
    timeout: 30000,
    ...(env ? { env } : {}),
  });
  const proc = app.process();
  const pid = proc.pid;
  const exited = new Promise((r) => proc.once('exit', (code) => r(code)));
  const page = await app.firstWindow();
  const ctx = { app, page, pid, proc, exited, confirmAnswer: confirm, dialogs: [] };
  page.on('dialog', (d) => {
    ctx.dialogs.push({ type: d.type(), message: d.message(), answer: ctx.confirmAnswer });
    void (ctx.confirmAnswer ? d.accept() : d.dismiss()).catch(() => undefined);
  });
  ctx.close = () => quitApp(ctx);
  LIVE.add(ctx);
  void ctx.exited.then(() => LIVE.delete(ctx));
  return ctx;
}

const LIVE = new Set();

/** Quits every app this run started that is still running (the runner calls it after each check). */
export async function closeAll() {
  for (const ctx of [...LIVE]) await quitApp(ctx).catch(() => undefined);
  LIVE.clear();
}

/** The app's own quit path (the tray's Quit runs app.quit()), then waits for the process to end. */
export async function quitApp(ctx, timeoutMs = 20000) {
  if (ctx.proc.exitCode !== null && (await appProcesses()).length === 0) return true;
  await ctx.app.evaluate(({ app }) => setTimeout(() => app.quit(), 0)).catch(() => undefined);
  const done = await Promise.race([ctx.exited.then(() => true), sleep(timeoutMs).then(() => false)]);
  if (!done) {
    // Our own Electron processes, by PID only.
    for (const p of await appProcesses()) killPid(p.pid);
    killPid(ctx.pid);
    await Promise.race([ctx.exited, sleep(5000)]);
  }
  return done;
}

const ELECTRON_DIR = resolve(ELECTRON, '..');

/**
 * Electron processes of this run: started from the repository's electron and with the scratch
 * profile on their command line. The process Playwright starts is a launcher; the app's real
 * main process (no --type=) is its child, and the GPU, utility and renderer processes are the
 * main's children.
 */
export async function appProcesses() {
  const needle = `--user-data-dir=${PROFILE}`.toLowerCase();
  return (await processesUnder(ELECTRON_DIR)).filter((p) => p.name.toLowerCase() === 'electron.exe' && p.cmd.toLowerCase().includes(needle));
}

/** The app's real main process: an electron.exe of this run without --type= whose parent is the launcher. */
export async function realMainPid(ctx) {
  const mine = await appProcesses();
  const main = mine.find((p) => p.ppid === ctx.pid && !/--type=/u.test(p.cmd)) ?? mine.find((p) => p.pid === ctx.pid && !/--type=/u.test(p.cmd));
  return main ? main.pid : null;
}

/**
 * Ends the app's real main process by its PID, like "End task" in Task Manager, then the
 * launcher, and waits until no Electron process of this run is left. Never falls back to
 * Playwright's close: that is a clean quit, which saves the list as paused.
 */
export async function killApp(ctx) {
  const t0 = Date.now();
  const main = await realMainPid(ctx);
  if (main === null) throw new Error(`no Electron main process found under launcher ${ctx.pid}`);
  killPid(main);
  killPid(ctx.pid);
  const gone = await waitFor(async () => (await appProcesses()).length === 0, { timeout: 15000, interval: 300, what: 'the app processes to end' }).catch(() => false);
  if (!gone) throw new Error(`Electron processes of this run still running 15 s after ending main ${main}`);
  await Promise.race([ctx.exited, sleep(5000)]);
  return { code: `main ${main} ended`, ms: Date.now() - t0 };
}

/** Ends every Electron process of this run that is still running (by PID; the runner calls it after each check). */
export async function killLeftoverApps() {
  const left = await appProcesses();
  for (const p of left.filter((x) => !/--type=/u.test(x.cmd))) killPid(p.pid);
  await sleep(2000);
  for (const p of await appProcesses()) killPid(p.pid);
  return left;
}

/** Ends one process by PID (never by name). */
export function killPid(pid) {
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

function powershell(command) {
  return new Promise((res, rej) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      err ? rej(err) : res(stdout),
    );
  });
}

/**
 * Processes whose executable sits under `dir` (case-insensitive prefix match on ExecutablePath).
 * `cmd` (the command line) is for in-process checks only; never print it whole (aria2's holds its RPC secret).
 */
export async function processesUnder(dir) {
  const prefix = dir.replace(/[\\/]+$/u, '') + '\\';
  const out = await powershell(
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
  );
  const list = out.trim() === '' ? [] : [JSON.parse(out)].flat();
  return list
    .filter((p) => p.ExecutablePath.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, path: rel(p.ExecutablePath), cmd: p.CommandLine ?? '' }));
}

/** Listening TCP ports and UDP endpoints owned by a PID. */
export async function portsOf(pid) {
  const out = await powershell(
    `$t = @(Get-NetTCPConnection -OwningProcess ${Number(pid)} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State); ` +
      `$u = @(Get-NetUDPEndpoint -OwningProcess ${Number(pid)} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort); ` +
      `@{ tcp = $t; udp = $u } | ConvertTo-Json -Compress -Depth 4`,
  );
  const r = JSON.parse(out);
  const arr = (v) => (v === null || v === undefined ? [] : [v].flat());
  return { tcp: arr(r.tcp).map((c) => ({ ...c, State: typeof c.State === 'number' ? TCP_STATES[c.State] ?? c.State : c.State })), udp: arr(r.udp) };
}
const TCP_STATES = { 1: 'Closed', 2: 'Listen', 3: 'SynSent', 4: 'SynReceived', 5: 'Established', 6: 'FinWait1', 7: 'FinWait2', 8: 'CloseWait', 9: 'Closing', 10: 'LastAck', 11: 'TimeWait', 12: 'DeleteTCB', 100: 'Bound' };

/** Decodes the first `seconds` of a media file with the profile's ffmpeg; true when it decodes without an error. */
export function decodes(file, seconds = 20) {
  return new Promise((res) => {
    execFile(join(BIN, 'ffmpeg.exe'), ['-v', 'error', '-t', String(seconds), '-i', file, '-f', 'null', '-'], { windowsHide: true, timeout: 120000 }, (err, _o, stderr) =>
      res({ ok: !err && String(stderr).trim() === '', error: scrub(String(stderr).trim().split(/\r?\n/u)[0] ?? '') }),
    );
  });
}

/** Text of the persistent banners shown, by id (engine, save, cutOff). */
export async function bannersShown(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('p.banner.persistent')].map((p) => ({
      id: [...p.classList].find((c) => c.startsWith('banner-'))?.slice(7) ?? '',
      text: p.querySelector('span')?.textContent ?? '',
    })),
  );
}

/** The temporary message banner (role=status), or null. */
export const messageShown = (page) => page.evaluate(() => document.querySelector('p.banner[role=status] span')?.textContent ?? null);

/** yt-dlp / ffmpeg / aria2c started from the scratch profile's tool folder. */
export const toolProcesses = () => processesUnder(BIN);

/** Ends a tool process of this run: only a PID whose executable is under the scratch bin folder. */
export async function killToolPid(pid) {
  const mine = await toolProcesses();
  if (!mine.some((p) => p.pid === pid)) throw new Error(`refusing to kill PID ${pid}: not a tool from ${rel(BIN)}`);
  return killPid(pid);
}

/** Ends every leftover tool process of this run (by PID, only from the scratch bin folder). */
export async function killLeftoverTools() {
  const left = await toolProcesses();
  for (const p of left) killPid(p.pid);
  return left;
}

/**
 * Calls the running aria2 daemon of this run over its JSON-RPC. The port and the per-run
 * secret are read from the command line of the aria2c under the scratch bin folder; the
 * secret is never written to results.
 */
export async function aria2Rpc(method, params = []) {
  const prefix = (BIN + '\\').toLowerCase();
  const out = await powershell(
    `Get-CimInstance Win32_Process -Filter "Name='aria2c.exe'" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
  );
  const list = out.trim() === '' ? [] : [JSON.parse(out)].flat();
  const mine = list.find((p) => p.ExecutablePath && p.ExecutablePath.toLowerCase().startsWith(prefix));
  if (!mine) throw new Error('no aria2c from the scratch profile is running');
  const port = /--rpc-listen-port=(\d+)/u.exec(mine.CommandLine)?.[1];
  const secret = /--rpc-secret=([0-9a-f]+)/u.exec(mine.CommandLine)?.[1];
  const res = await fetch(`http://127.0.0.1:${port}/jsonrpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'e2e', method, params: [`token:${secret}`, ...params] }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`aria2 ${method}: ${body.error.message}`);
  return body.result;
}

export async function waitFor(fn, { timeout = 60000, interval = 500, what = 'condition' } = {}) {
  const until = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > until) throw new Error(`timed out after ${Math.round(timeout / 1000)} s waiting for ${what}`);
    await sleep(interval);
  }
}

// ---- window ----

export const snapshot = (page) => page.evaluate(() => window.fetchly.snapshot());
export const appStatus = (page) => page.evaluate(() => window.fetchly.status());
export const binaries = (page) => page.evaluate(() => window.fetchly.binaries());
export const hookState = (app) =>
  app.evaluate(() => {
    const s = globalThis.__e2e;
    return {
      calls: s.calls,
      trayTooltips: s.trayTooltips,
      notifications: s.notifications.map(({ title, body, at }) => ({ title, body, at })),
      trayMenu: s.trayMenu ? s.trayMenu.items.map((i) => i.label).filter(Boolean) : null,
    };
  });

/** Runs the click handler of a tray menu item by its label (the app's own handler; not a native click). */
export async function trayClick(app, label) {
  const ok = await app.evaluate((_e, l) => {
    const item = globalThis.__e2e.trayMenu?.items.find((i) => i.label === l);
    if (!item) return false;
    item.click();
    return true;
  }, label);
  if (!ok) throw new Error(`tray menu has no item "${label}"`);
}

/**
 * Waits until the window shows either the install screen or the main view. The engine state
 * starts as "starting" (main view) before the app has looked for the tools, so by default this
 * also waits until the state has settled (notInstalled, ready or error); `settle: false` returns
 * at the first view, for a check that acts while the tools start.
 */
export async function waitForShell(page, timeout = 60000, { settle = true } = {}) {
  await page.waitForSelector('main.install, header.urlbar', { timeout });
  if (settle) {
    await waitFor(async () => (await appStatus(page)).engine.state !== 'starting', { timeout, interval: 200, what: 'the tool check at start' });
    await page.waitForSelector('main.install, header.urlbar', { timeout: 10000 });
  }
  return (await page.locator('main.install').count()) > 0 ? 'install' : 'main';
}

/** Waits until the engines are ready (status ready). */
export const waitReady = (page, timeout = 60000) =>
  waitFor(async () => (await appStatus(page)).engine.state === 'ready', { timeout, what: 'the download tools to be ready' });

/**
 * Types a link in the add bar and presses Add. Resolves to { dialog: true } when the add
 * dialog opened, or { error } with the text shown under the bar.
 */
export async function submitUrl(page, url, timeout = 90000) {
  const input = page.locator('header.urlbar input');
  await input.fill(url);
  await page.locator('header.urlbar button[type=submit]').click();
  const handle = await page.waitForSelector('.dialog, header.urlbar p.error', { timeout });
  const cls = await handle.evaluate((el) => el.className);
  if (cls.includes('dialog')) return { dialog: true };
  return { error: (await handle.textContent()).trim() };
}

export async function setQuality(page, value) {
  await page.locator('.dialog select').first().selectOption(value);
}

export async function clickButton(scope, name) {
  await scope.getByRole('button', { name, exact: true }).click();
}

/** Presses Download in the add dialog and waits until it closes. */
export async function confirmAdd(page) {
  await page.locator('.dialog .dialog-actions button.primary').click();
  await page.waitForSelector('.dialog', { state: 'detached', timeout: 30000 });
}

/** Probes, picks a quality (if given) and adds; returns the error text or null. */
export async function addUrl(page, url, { quality = null, timeout = 90000 } = {}) {
  const r = await submitUrl(page, url, timeout);
  if (r.error) return r.error;
  if (quality) await setQuality(page, quality);
  await confirmAdd(page);
  return null;
}

export const jobs = async (page) => (await snapshot(page)).jobs;

/** Waits for a job matching `pred` (given the job list) and returns it. */
export function waitJob(page, pred, { timeout = 300000, what = 'a job' } = {}) {
  return waitFor(
    async () => {
      const list = await jobs(page);
      return list.find((j) => pred(j, list)) ?? null;
    },
    { timeout, what, interval: 500 },
  );
}

export const pct = (j) => (j.bytesTotal ? Math.floor((j.bytesDone / j.bytesTotal) * 100) : null);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Rows whose shown name is exactly the job's (the name JobRow.tsx shows). */
function rowsNamed(page, job) {
  const name = job.fileName ?? (job.index !== null && job.baseName ? job.baseName : job.title);
  return page.locator('li.job').filter({ has: page.locator('.job-name', { hasText: new RegExp(`^${escapeRe(name)}$`, 'u') }) });
}

/** The row of a job in the list (by its shown name), for reading it. */
export function rowOf(page, job) {
  return rowsNamed(page, job).first();
}

/**
 * Clicks a button on the job's row. Two jobs of one video share a shown title while they run,
 * so among rows of that name the one that has this button is taken.
 */
export async function jobButton(page, job, label) {
  const button = (scope) => scope.getByRole('button', { name: label, exact: true });
  await button(rowsNamed(page, job).filter({ has: button(page) }).first()).click();
}

export async function openSettings(page) {
  await page.locator('header.urlbar button[aria-label=Settings]').click();
  await page.waitForSelector('.dialog');
}

/** The tool versions as the Settings dialog shows them. */
export async function settingsVersions(page) {
  await openSettings(page);
  await page.waitForSelector('.dialog ul.tools li');
  await waitFor(async () => (await page.locator('.dialog ul.tools li').count()) === 3, { timeout: 15000, what: 'three tools in Settings' });
  const items = await page.locator('.dialog ul.tools li').allTextContents();
  await clickButton(page.locator('.dialog'), 'Close');
  const out = {};
  for (const t of items) {
    const [name, ...rest] = t.trim().split(/\s+/u);
    out[name] = rest.join(' ');
  }
  return out;
}

export function readJson(p, fallback = null) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Files in a folder (non-recursive unless asked), as names relative to it. */
export async function listFiles(dir, recursive = false) {
  const { readdirSync, statSync } = await import('node:fs');
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d, prefix) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const isDir = statSync(full).isDirectory();
      if (isDir && recursive) walk(full, `${prefix}${name}/`);
      else out.push(`${prefix}${name}${isDir ? '/' : ''}`);
    }
  };
  walk(dir, '');
  return out;
}

/** ffprobe is not installed by the app; ffmpeg -i prints the streams of a file. */
export function mediaInfo(file) {
  return new Promise((res) => {
    execFile(join(BIN, 'ffmpeg.exe'), ['-hide_banner', '-i', file], { windowsHide: true, timeout: 30000 }, (_err, _out, stderr) => {
      const lines = String(stderr)
        .split(/\r?\n/u)
        .filter((l) => /Stream #|Duration:|Input #/u.test(l))
        .map((l) => scrub(l.trim()));
      res({
        lines,
        video: lines.find((l) => /Video:/u.test(l)) ?? null,
        audio: lines.find((l) => /Audio:/u.test(l)) ?? null,
        duration: /Duration: ([\d:.]+)/u.exec(lines.join(' '))?.[1] ?? null,
      });
    });
  });
}

/** Runs the scratch profile's yt-dlp (never the owner's) and returns stdout. */
export function ytdlp(args, timeout = 120000) {
  return new Promise((res, rej) => {
    execFile(join(BIN, 'yt-dlp.exe'), args, { windowsHide: true, timeout, maxBuffer: 128 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } }, (err, stdout, stderr) =>
      err ? rej(new Error(`${err.message}\n${stderr}`)) : res(stdout),
    );
  });
}

/**
 * A throwaway HTTP server on 127.0.0.1 for content made by the check itself (a feed, a page,
 * a small file). `routes` maps a path to { type, body } (body: string, Buffer or a function
 * returning one); Range requests are answered. Resolves to { base, hits, close }.
 */
export async function localServer(routes) {
  const { createServer } = await import('node:http');
  const hits = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    hits.push({ method: req.method, path, range: req.headers.range ?? null });
    const route = routes[path];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const raw = typeof route.body === 'function' ? route.body() : route.body;
    const body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
    const headers = { 'content-type': route.type, 'accept-ranges': 'bytes', ...(route.headers ?? {}) };
    const range = /bytes=(\d+)-(\d*)/u.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] === '' ? body.length - 1 : Math.min(Number(range[2]), body.length - 1);
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
      res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
    } else {
      res.writeHead(200, { ...headers, 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    hits,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** An RSS feed; yt-dlp's generic extractor reads each item as a playlist entry (link -> url, title -> title). */
export function rssFeed(title, items) {
  const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const body = items
    .map((i) => `<item><title>${esc(i.title)}</title><link>${esc(i.link)}</link>${i.description ? `<description>${esc(i.description)}</description>` : ''}</item>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(title)}</title><link>http://127.0.0.1/</link><description>e2e feed</description>\n${body}\n</channel></rss>\n`;
}

/** Makes a short test clip with the profile's ffmpeg (lavfi test pattern + tone); resolves to the path. */
export function makeClip(out, args) {
  return new Promise((res, rej) => {
    execFile(join(BIN, 'ffmpeg.exe'), ['-hide_banner', '-v', 'error', '-y', ...args, out], { windowsHide: true, timeout: 180000 }, (err, _o, stderr) =>
      err ? rej(new Error(`ffmpeg: ${String(stderr).trim().split(/\r?\n/u)[0]}`)) : res(out),
    );
  });
}

export function zoneIdentifier(file) {
  try {
    return readFileSync(`${file}:Zone.Identifier`, 'utf8');
  } catch (e) {
    return `(no Zone.Identifier stream: ${e.code ?? e.message})`;
  }
}
