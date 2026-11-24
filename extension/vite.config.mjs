// The extension build (plan section 2; R2-7): `npm run build:ext` writes extension/dist, which is loaded unpacked.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
const TAG = /<[a-z][a-z0-9-]*\b([^>]*)>/giu;
const HANDLER_ATTR = /(^|[\s"'/])on[a-z]+\s*=/iu;

/** Why an emitted popup.html is unsafe under the extension CSP, or null. */
function htmlProblem(html) {
  const scripts = [...html.matchAll(INLINE_SCRIPT)];
  if ([...html.matchAll(/<script\b/giu)].length !== scripts.length) return 'a script tag without its end';
  for (const s of scripts) {
    if (!/\ssrc\s*=/iu.test(s[1] ?? '')) return 'a script without src';
    if ((s[2] ?? '').trim() !== '') return 'an inline script body';
  }
  for (const t of html.matchAll(TAG)) if (HANDLER_ATTR.test(t[1] ?? '')) return 'an on*= handler attribute';
  return null;
}

/**
 * Emits manifest.json unchanged and checks the result. The root and the output directory come from the
 * resolved config, so an inline `root` or `build.outDir` redirects them.
 */
function extensionShell() {
  let root = HERE;
  let outDir = join(HERE, 'dist');
  return {
    name: 'fetchly-extension-shell',
    config(user) {
      // The two inputs, under whichever root this build uses. Vite resolves the root to its real path
      // (a Windows 8.3 short name is expanded), so the inputs are too, or popup.html lands outside the root.
      const base = realpathSync.native(resolve(user.root ?? HERE));
      return { build: { rolldownOptions: { input: { popup: join(base, 'popup.html'), 'service-worker': join(base, 'src/service-worker.ts') } } } };
    },
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      // R2-7: popup.js and service-worker.js are the two entries; a chunk renamed around them is a collision.
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        const expected = file.fileName === 'popup.js' ? 'popup' : file.fileName === 'service-worker.js' ? 'service-worker' : null;
        if (expected !== null && (!file.isEntry || file.name !== expected)) this.error(`${file.fileName} is not the ${expected} entry`);
        if (/^(popup|service-worker)\d+\.js$/u.test(file.fileName)) this.error(`a chunk collides with an entry name: ${file.fileName}`);
      }
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: readFileSync(join(root, 'manifest.json')) });
    },
    closeBundle() {
      const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
      for (const named of [manifest.action?.default_popup, manifest.background?.service_worker]) {
        if (typeof named !== 'string' || !existsSync(join(outDir, named))) throw new Error(`the manifest names a file the build did not produce: ${String(named)}`);
      }
      const problem = htmlProblem(readFileSync(join(outDir, 'popup.html'), 'utf8'));
      if (problem !== null) throw new Error(`dist/popup.html has ${problem}`);
    },
  };
}

export default defineConfig({
  root: HERE,
  base: './',
  publicDir: false,
  plugins: [extensionShell()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    sourcemap: false,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
