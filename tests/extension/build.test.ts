/**
 * Task 1 and R2-7: the real build. extension/vite.config.mjs is run through vite's JS API into a temporary directory (never into
 * extension/dist), and on a mirrored copy of the sources for the negative cases.
 *
 * REQUIREMENT ON THE CONFIG (flagged in the report): the inline plugin must take the project root and the output directory from the
 * RESOLVED vite config (`configResolved`: `config.root`, `config.build.outDir`), not from `process.cwd()`, `import.meta.url` or a literal
 * `extension/dist`, so that an inline `root` and `build.outDir` redirect it. These specs pass those two options.
 *
 * Enumerations:
 *  - Files in a good build (4): manifest.json, popup.html, popup.js, service-worker.js (plus popup.css and shared chunks, nothing else but
 *    .js/.css/.html/.json); never a .map file.
 *  - Config values (section 2 row): root extension, entryFileNames and chunkFileNames [name].js, assetFileNames [name][extname], minify false,
 *    sourcemap false, modulePreload { polyfill: false }, an emitFile plugin with a closeBundle check.
 *  - R2-7 failures (all of that kind the build can see): an inline <script> body in popup.html; an on*= attribute in popup.html; a manifest
 *    that names a file the build did not produce (default_popup, service_worker).
 *  - Chunk-name collisions (Amendment 1, AM-6): rollup renames a colliding chunk (popup2.js) before closeBundle runs, so no input to a real
 *    build can reach a check there. The check is in the plugin `fetchly-extension-shell` (found in the default export's `plugins`), in its
 *    `generateBundle` hook, which uses only `this.error` and `this.emitFile`. The hook is called directly, after `configResolved`, with
 *    synthetic bundles: two entries plus a shared chunk (passes, emits manifest.json); a chunk popup2.js; a chunk service-worker2.js;
 *    popup.js with isEntry false; popup.js with name 'other'; service-worker.js with isEntry false (each throws).
 *  - Every negative case is the control build plus ONE change, and the control must pass first.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONFIG = join(ROOT, 'extension', 'vite.config.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'fetchly-a2-build-'));
afterAll(() => {
  // Only the directory this file created.
  rmSync(TMP, { recursive: true, force: true });
});

const BUILD_TIMEOUT = 120_000;
const names = (dir: string): string[] => (readdirSync(dir, { recursive: true }) as string[]).filter((f) => statSync(join(dir, f)).isFile()).map((f) => f.split('\\').join('/')).sort();
const text = (dir: string, f: string): string => readFileSync(join(dir, f), 'utf8');

/** A build of `root` into `outDir`, silent. */
const run = (root: string | undefined, outDir: string): Promise<unknown> =>
  build({ configFile: CONFIG, ...(root ? { root } : {}), logLevel: 'silent', build: { outDir, emptyOutDir: true } });

/** A mirror of the sources: <mirror>/extension (without dist and node_modules) and <mirror>/src/shared, for the relative imports. */
let mirrorCount = 0;
function mirror(): string {
  mirrorCount += 1;
  const dir = join(TMP, `mirror-${mirrorCount}`);
  mkdirSync(dir, { recursive: true });
  cpSync(join(ROOT, 'extension'), join(dir, 'extension'), {
    recursive: true,
    filter: (src) => !/[\\/](dist|node_modules)([\\/]|$)/u.test(src.slice(join(ROOT, 'extension').length)),
  });
  cpSync(join(ROOT, 'src', 'shared'), join(dir, 'src', 'shared'), { recursive: true });
  return dir;
}

describe('extension/vite.config.mjs (section 2)', () => {
  let cfg = '';
  beforeAll(() => {
    cfg = readFileSync(CONFIG, 'utf8');
  });
  it('states the section 2 values', () => {
    expect(cfg).toMatch(/root\s*:/u);
    expect(cfg).toMatch(/entryFileNames\s*:\s*['"`]\[name\]\.js['"`]/u);
    expect(cfg).toMatch(/chunkFileNames\s*:\s*['"`]\[name\]\.js['"`]/u);
    expect(cfg).toMatch(/assetFileNames\s*:\s*['"`]\[name\]\[extname\]['"`]/u);
    expect(cfg).toMatch(/minify\s*:\s*false/u);
    expect(cfg).toMatch(/sourcemap\s*:\s*false/u);
    expect(cfg).toMatch(/modulePreload\s*:\s*\{\s*polyfill\s*:\s*false\s*\}/u);
    expect(cfg).toContain('emitFile');
    expect(cfg).toContain('closeBundle');
    expect(cfg).toContain('manifest.json');
  });

  it('has the two inputs: popup.html and src/service-worker.ts', () => {
    expect(cfg).toMatch(/popup\.html/u);
    expect(cfg).toMatch(/src\/service-worker\.ts/u);
  });
});

describe('a real build of the extension', () => {
  const out = join(TMP, 'dist');
  beforeAll(async () => {
    await run(undefined, out);
  }, BUILD_TIMEOUT);

  it('holds manifest.json, popup.html, popup.js and service-worker.js, no source map, and nothing but .js .css .html .json', () => {
    const files = names(out);
    for (const f of ['manifest.json', 'popup.html', 'popup.js', 'service-worker.js']) expect(files, f).toContain(f);
    expect(files.filter((f) => f.endsWith('.map'))).toEqual([]);
    expect(files.filter((f) => !/\.(js|css|html|json)$/u.test(f))).toEqual([]);
    // The two entry names are exact: nothing like popup-3f2a.js.
    expect(files.filter((f) => /^(popup|service-worker)[^/]*\.js$/u.test(f)).sort()).toEqual(['popup.js', 'service-worker.js']);
    expect(files.filter((f) => f.includes('/'))).toEqual([]);
  });

  it('emits manifest.json unchanged, byte for byte', () => {
    expect(readFileSync(join(out, 'manifest.json'))).toEqual(readFileSync(join(ROOT, 'extension', 'manifest.json')));
  });

  it('every file the manifest names is in the build', () => {
    const m = JSON.parse(text(out, 'manifest.json')) as { action: { default_popup: string }; background: { service_worker: string } };
    expect(existsSync(join(out, m.action.default_popup))).toBe(true);
    expect(existsSync(join(out, m.background.service_worker))).toBe(true);
  });

  it('is not minified: readable lines, the message names as plain strings', () => {
    for (const f of ['popup.js', 'service-worker.js']) {
      const lines = text(out, f).split('\n');
      expect(lines.length, f).toBeGreaterThan(30);
      expect(Math.max(...lines.map((l) => l.length)), f).toBeLessThan(400);
    }
    expect(text(out, 'service-worker.js')).toContain('fetchly:status');
    expect(text(out, 'popup.js')).toContain('fetchly:');
  });

  it('has no modulepreload polyfill', () => {
    for (const f of names(out).filter((n) => n.endsWith('.js'))) expect(text(out, f), f).not.toContain('relList');
  });

  it('emits a popup.html without an inline script body or an on*= attribute, whose script and stylesheet exist in the build', () => {
    const html = text(out, 'popup.html');
    for (const s of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
      expect(s[1]).toMatch(/\ssrc\s*=/iu);
      expect((s[2] ?? '').trim()).toBe('');
    }
    for (const t of html.matchAll(/<[a-z][a-z0-9-]*\b([^>]*)>/giu)) expect(t[1] ?? '').not.toMatch(/(^|[\s"'/])on[a-z]+\s*=/iu);
    const refs = [...html.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/giu)].map((r) => (r[1] ?? '').replace(/^\.?\//u, ''));
    expect(refs).toContain('popup.js');
    for (const r of refs) expect(existsSync(join(out, r)), r).toBe(true);
  });

  it('keeps the token logic out of the popup bundle and in the worker bundle', () => {
    const popup = names(out)
      .filter((n) => n.endsWith('.js') && n !== 'service-worker.js')
      .map((n) => text(out, n))
      .join('\n');
    for (const s of ['fetchly-server-proof-v1', '/v1/status', '/v1/hello', 'Authorization']) expect(popup, s).not.toContain(s);
    const worker = text(out, 'service-worker.js');
    for (const s of ['fetchly-server-proof-v1', '/v1/hello']) expect(worker, s).toContain(s);
  });

  it('contains no forbidden token in what it emits', () => {
    for (const f of names(out).filter((n) => n.endsWith('.js'))) {
      const t = text(out, f);
      for (const re of [/innerHTML/u, /outerHTML/u, /insertAdjacentHTML/u, /localStorage/u, /chrome\.storage/u, /onMessageExternal/u, /onConnectExternal/u]) expect(t, `${f} ${re}`).not.toMatch(re);
    }
  });
});

describe('the closeBundle check (R2-7): the control passes, and each single change fails the build', () => {
  it('control: an unchanged mirror builds', async () => {
    const m = mirror();
    await run(join(m, 'extension'), join(m, 'out'));
    for (const f of ['manifest.json', 'popup.html', 'popup.js', 'service-worker.js']) expect(existsSync(join(m, 'out', f)), f).toBe(true);
  }, BUILD_TIMEOUT);

  const change = (file: string, edit: (t: string) => string): string => {
    const m = mirror();
    const p = join(m, 'extension', file);
    const before = readFileSync(p, 'utf8');
    const after = edit(before);
    expect(after, `the edit of ${file} changed nothing`).not.toBe(before);
    writeFileSync(p, after);
    return m;
  };
  const fails = async (m: string): Promise<void> => {
    await expect(run(join(m, 'extension'), join(m, 'out'))).rejects.toThrow();
  };

  it('an inline <script> body in popup.html', async () => {
    await fails(change('popup.html', (t) => t.replace(/<\/body\s*>/iu, '<script>void 0;</script></body>')));
  }, BUILD_TIMEOUT);

  it('an on*= attribute in popup.html', async () => {
    await fails(change('popup.html', (t) => t.replace(/<body\b/iu, '<body onload="void 0"')));
  }, BUILD_TIMEOUT);

  it('an onclick= attribute on a button', async () => {
    await fails(change('popup.html', (t) => t.replace(/<button\b/iu, '<button onclick="void 0"')));
  }, BUILD_TIMEOUT);

  it('a manifest whose default_popup names a file the build does not produce', async () => {
    await fails(change('manifest.json', (t) => t.replace('"popup.html"', '"missing.html"')));
  }, BUILD_TIMEOUT);

  it('a manifest whose service_worker names a file the build does not produce', async () => {
    await fails(change('manifest.json', (t) => t.replace('"service-worker.js"', '"worker-missing.js"')));
  }, BUILD_TIMEOUT);
});

// ---------------------------------------------------------------------------------------------
// Amendment 1 (AM-6): the chunk-name collision check, through the plugin's generateBundle hook.

describe('the generateBundle hook of the plugin fetchly-extension-shell (AM-6): chunk-name collisions on synthetic bundles', () => {
  interface ShellPlugin {
    name: string;
    configResolved(config: { root: string; build: { outDir: string } }): void;
    generateBundle(this: unknown, options: unknown, bundle: Record<string, unknown>): void;
  }
  class BundleError extends Error {}
  let plugin: ShellPlugin | undefined;

  beforeAll(async () => {
    const mod = (await import(pathToFileURL(CONFIG).href)) as { default: { plugins?: unknown[] } };
    const all = (mod.default.plugins ?? []).flat(Infinity) as { name?: string }[];
    plugin = all.find((p) => p?.name === 'fetchly-extension-shell') as ShellPlugin | undefined;
  });

  const entry = (fileName: string, name: string, isEntry = true): Record<string, unknown> => ({ type: 'chunk', fileName, name, isEntry });
  const GOOD: Record<string, unknown> = {
    'popup.js': entry('popup.js', 'popup'),
    'service-worker.js': entry('service-worker.js', 'service-worker'),
    'shared.js': entry('shared.js', 'shared', false),
    'popup.css': { type: 'asset', fileName: 'popup.css' },
  };
  const bundleWith = (extra: Record<string, unknown>): Record<string, unknown> => ({ ...GOOD, ...extra });

  /** Runs the hook with only `this.error` (which throws, like rollup's) and `this.emitFile`; returns what it emitted. */
  function run(bundle: Record<string, unknown>): { fileName?: unknown; source?: unknown }[] {
    if (!plugin) throw new Error('the plugin fetchly-extension-shell is not in the default export\'s plugins');
    const emitted: { fileName?: unknown; source?: unknown }[] = [];
    plugin.configResolved({ root: join(ROOT, 'extension'), build: { outDir: 'dist' } });
    plugin.generateBundle.call(
      {
        error: (message: string): never => {
          throw new BundleError(message);
        },
        emitFile: (file: { fileName?: unknown; source?: unknown }): void => {
          emitted.push(file);
        },
      },
      {},
      bundle,
    );
    return emitted;
  }

  it('the plugin is found by its name in the default export\'s plugins, and has the hooks', () => {
    expect(plugin?.name).toBe('fetchly-extension-shell');
    expect(typeof plugin?.configResolved).toBe('function');
    expect(typeof plugin?.generateBundle).toBe('function');
  });

  it('control: two entries plus a shared chunk pass and emit manifest.json (the manifest of the extension folder, unchanged)', () => {
    const emitted = run(GOOD);
    expect(emitted.filter((f) => f.fileName === 'manifest.json')).toHaveLength(1);
    const manifest = emitted.find((f) => f.fileName === 'manifest.json');
    expect(Buffer.from(manifest?.source as Uint8Array)).toEqual(readFileSync(join(ROOT, 'extension', 'manifest.json')));
  });

  it.each([
    ['a chunk popup2.js', bundleWith({ 'popup2.js': entry('popup2.js', 'popup', false) })],
    ['a chunk service-worker2.js', bundleWith({ 'service-worker2.js': entry('service-worker2.js', 'service-worker', false) })],
    ['popup.js with isEntry: false', bundleWith({ 'popup.js': entry('popup.js', 'popup', false) })],
    ['popup.js with name "other"', bundleWith({ 'popup.js': entry('popup.js', 'other') })],
    ['service-worker.js with isEntry: false', bundleWith({ 'service-worker.js': entry('service-worker.js', 'service-worker', false) })],
  ] as [string, Record<string, unknown>][])('%s: the hook throws through this.error', (_n, bundle) => {
    expect(() => run(bundle)).toThrow(BundleError);
  });

  it('every case above is the control bundle plus ONE change: the control still passes after each failing run', () => {
    expect(() => run(bundleWith({ 'popup2.js': entry('popup2.js', 'popup', false) }))).toThrow(BundleError);
    expect(() => run(GOOD)).not.toThrow();
  });
});
