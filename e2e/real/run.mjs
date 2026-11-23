// Opt-in driver for docs/manual-checklist-phase1.md against the real built app, real sites
// and real tools. Never part of `npm test` or CI.
//
//   npm run build
//   node e2e/real/run.mjs 2 13 15        (or: all)
//   node e2e/real/run.mjs --no-retry 3   (a failed check is normally re-run alone once)
//
// Writes .e2e-real/results.json (merged with earlier runs, one entry per check id).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKS, ORDER } from './checks.mjs';
import { BIN, E2E_DIR, closeAll, killLeftoverApps, killLeftoverTools, readJson, rel, scrub, sleep, toolProcesses } from './lib.mjs';

const RESULTS = join(E2E_DIR, 'results.json');

function ytdlpVersion() {
  const exe = join(BIN, 'yt-dlp.exe');
  if (!existsSync(exe)) return Promise.resolve(null);
  return new Promise((res) => execFile(exe, ['--version'], { windowsHide: true, timeout: 30000 }, (err, out) => res(err ? null : out.trim())));
}

function withTimeout(promise, ms, id) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`check ${id} took longer than ${Math.round(ms / 60000)} min`)), ms);
    }),
  ]);
}

async function attempt(id) {
  const check = CHECKS[id];
  const started = Date.now();
  let status;
  let evidence;
  try {
    const r = await withTimeout(check.run(), check.timeoutMs ?? 15 * 60000, id);
    status = r.status;
    evidence = r.evidence;
  } catch (e) {
    status = 'fail';
    evidence = `error: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
  } finally {
    await closeAll();
    const apps = await killLeftoverApps().catch(() => []);
    const left = await killLeftoverTools().catch(() => []);
    if (apps.length > 0) evidence = `${evidence ?? ''} [cleanup ended ${apps.length} leftover Electron process(es) of this run by PID]`;
    if (left.length > 0) evidence = `${evidence ?? ''} [cleanup ended leftover tools by PID: ${left.map((p) => `${p.name} ${p.pid}`).join(', ')}]`;
  }
  return { status, evidence: scrub(evidence), started, ended: Date.now() };
}

async function main() {
  const argv = process.argv.slice(2);
  const retry = !argv.includes('--no-retry');
  const ids = argv.filter((a) => !a.startsWith('--'));
  const wanted = ids.length === 0 || ids.includes('all') ? ORDER : ids;
  const unknown = wanted.filter((id) => !CHECKS[id]);
  if (unknown.length > 0) {
    console.error(`unknown check id(s): ${unknown.join(', ')}. Known: ${ORDER.join(' ')}`);
    process.exit(2);
  }
  mkdirSync(E2E_DIR, { recursive: true });
  const before = await toolProcesses();
  if (before.length > 0) {
    console.error(`tools from ${BIN} are already running (${before.map((p) => p.pid).join(', ')}); is another run active? Stop it first.`);
    process.exit(2);
  }

  const results = readJson(RESULTS, { runs: [], checks: {} });
  const run = { startedAt: new Date().toISOString(), command: `node e2e/real/run.mjs ${argv.join(' ')}`.trim(), ytDlp: await ytdlpVersion() };
  results.runs.push(run);
  let first = true;

  for (const id of wanted) {
    const check = CHECKS[id];
    if (check.notRun) {
      results.checks[id] = { id, status: 'not-run', evidence: check.notRun, durationMs: 0, startedAt: null, endedAt: null, ytDlp: run.ytDlp };
      console.log(`${id.padEnd(4)} not-run  ${check.notRun}`);
      continue;
    }
    if (!first) await sleep(check.pauseBeforeMs ?? 4000); // be gentle with the sites
    first = false;
    let r = await attempt(id);
    if (r.status === 'fail' && retry && check.retry !== false) {
      console.log(`${id.padEnd(4)} fail     (first attempt) ${r.evidence}`);
      await sleep(5000);
      const again = await attempt(id);
      again.evidence = `first attempt failed (${r.evidence}); re-run alone: ${again.evidence}`;
      r = again;
    }
    const ytDlp = (await ytdlpVersion()) ?? run.ytDlp;
    results.checks[id] = {
      id,
      status: r.status,
      evidence: r.evidence,
      durationMs: r.ended - r.started,
      startedAt: new Date(r.started).toISOString(),
      endedAt: new Date(r.ended).toISOString(),
      ytDlp,
    };
    console.log(`${id.padEnd(4)} ${r.status.padEnd(8)} ${Math.round((r.ended - r.started) / 1000)}s  ${r.evidence}`);
    writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  }
  run.endedAt = new Date().toISOString();
  writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  const counts = {};
  for (const id of wanted) counts[results.checks[id].status] = (counts[results.checks[id].status] ?? 0) + 1;
  console.log(`\n${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}  ->  ${rel(RESULTS)}`);
}

await main();
