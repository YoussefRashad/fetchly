/**
 * Task 1: the shell's static contract (plan section 2, DV1, DV2, E1, E8d, R2-3). These specs read files; they run nothing of the extension.
 *
 * Enumerations:
 *  - Manifest top-level keys (9): manifest_version, name, description, version, action, background, permissions, host_permissions, incognito.
 *    Keys a manifest could gain that A2 must not have (all of that kind): content_scripts, optional_permissions, optional_host_permissions,
 *    web_accessible_resources, externally_connectable, commands, options_page, options_ui, content_security_policy, side_panel, devtools_page,
 *    declarative_net_request, oauth2, key, update_url; and any extra permission, `storage` above all (DV2).
 *  - Forbidden source tokens under extension/src (10, plan Task 1): innerHTML, outerHTML, insertAdjacentHTML, eval(, new Function,
 *    DEFAULT_SERVER_PORT, chrome.storage, localStorage, onMessageExternal, onConnectExternal, console.
 *  - Globals a lib file never names (4, E1): chrome, document, window, indexedDB.
 *  - Source files the plan creates (9): service-worker.ts, popup.ts, lib/{client,store,messages,pairingInput,view,popupModel,strings}.ts.
 *  - Project wiring (section 2, Task 1 files): package.json build:ext and typecheck, @types/chrome, tsconfig.ext.json, eslint ignores, the CI step.
 *    (README.md and the checklist are Task 7 docs; no test here, so Tasks 1 to 6 are not red because of them.)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const json = (p: string): Record<string, unknown> => JSON.parse(read(p)) as Record<string, unknown>;

const SRC = join(ROOT, 'extension', 'src');
const filesUnder = (dir: string): string[] =>
  existsSync(dir)
    ? (readdirSync(dir, { recursive: true }) as string[])
        .map((f) => join(dir, f))
        .filter((f) => statSync(f).isFile())
        .map((f) => f.slice(ROOT.length).split(sep).join('/'))
        .sort()
    : [];
const SRC_FILES = filesUnder(SRC);
const LIB_FILES = SRC_FILES.filter((f) => /^extension\/src\/lib\/[^/]+\.ts$/u.test(f));

describe('extension/manifest.json (section 2, DV2)', () => {
  const m = json('extension/manifest.json');

  it('has exactly the nine top-level keys', () => {
    expect(Object.keys(m).sort()).toEqual(['action', 'background', 'description', 'host_permissions', 'incognito', 'manifest_version', 'name', 'permissions', 'version']);
  });

  it('has the section 2 value for each key', () => {
    expect(m['manifest_version']).toBe(3);
    expect(m['name']).toBe('Fetchly');
    expect(typeof m['description']).toBe('string');
    expect((m['description'] as string).trim()).not.toBe('');
    expect(m['action']).toEqual({ default_popup: 'popup.html' });
    expect(m['background']).toEqual({ service_worker: 'service-worker.js', type: 'module' });
    expect(m['permissions']).toEqual([]);
    expect(m['host_permissions']).toEqual(['http://127.0.0.1/*']);
    expect(m['incognito']).toBe('not_allowed');
  });

  it('has the version of package.json, and it is a Chrome-valid version (one to four dot-separated integers)', () => {
    expect(m['version']).toBe(json('package.json')['version']);
    expect(String(m['version'])).toMatch(/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/u);
  });

  it('holds no `storage` permission, no content script and none of the other keys A3 to A6 add', () => {
    const text = read('extension/manifest.json');
    for (const key of [
      'content_scripts',
      'optional_permissions',
      'optional_host_permissions',
      'web_accessible_resources',
      'externally_connectable',
      'commands',
      'options_page',
      'options_ui',
      'content_security_policy',
      'side_panel',
      'devtools_page',
      'declarative_net_request',
      'oauth2',
      'key',
      'update_url',
    ]) {
      expect(Object.keys(m), key).not.toContain(key);
      expect(text, key).not.toContain(`"${key}"`);
    }
    expect(text).not.toMatch(/"(storage|unlimitedStorage|cookies|webRequest|tabs|activeTab|scripting|contextMenus|downloads|nativeMessaging)"/u);
    expect(m['permissions']).not.toContain('storage');
  });

  it('is plain JSON with LF line ends and no BOM', () => {
    const text = read('extension/manifest.json');
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).not.toContain('\r');
  });

  it('names files that the sources provide: popup.html next to it, and a service worker entry in src', () => {
    expect(existsSync(join(ROOT, 'extension', 'popup.html'))).toBe(true);
    expect(existsSync(join(ROOT, 'extension', 'src', 'service-worker.ts'))).toBe(true);
  });
});

describe('extension/popup.html (section 2)', () => {
  const html = read('extension/popup.html');
  const tags = [...html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/giu)].map((t) => ({ name: (t[1] ?? '').toLowerCase(), attrs: t[2] ?? '' }));

  it('has no inline <script> body: every script has a src and nothing inside', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)];
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    for (const s of scripts) {
      expect(s[1], 'a script without src').toMatch(/\ssrc\s*=\s*["'][^"']+["']/iu);
      expect((s[2] ?? '').trim(), 'an inline script body').toBe('');
    }
    // An unclosed or self-closed script tag cannot hide a body either.
    expect([...html.matchAll(/<script\b/giu)]).toHaveLength(scripts.length);
  });

  it('loads exactly one script: src/popup.ts as a module', () => {
    const scripts = tags.filter((t) => t.name === 'script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.attrs).toMatch(/\stype\s*=\s*["']module["']/iu);
    expect(scripts[0]?.attrs).toMatch(/\ssrc\s*=\s*["'](\.?\/)?src\/popup\.ts["']/iu);
  });

  it('has no on*= handler attribute on any tag, and no javascript: URL', () => {
    for (const t of tags) expect(t.attrs, `<${t.name}>`).not.toMatch(/(^|[\s"'/])on[a-z]+\s*=/iu);
    expect(html).not.toMatch(/javascript\s*:/iu);
    expect(html).not.toMatch(/\sstyle\s*=\s*["'][^"']*expression\s*\(/iu);
  });

  it('has two inputs with maxlength: 64 (the pairing string) and 40 (the label)', () => {
    const inputs = tags.filter((t) => t.name === 'input');
    const lengths = inputs.map((t) => /\smaxlength\s*=\s*["']?(\d+)["']?/iu.exec(t.attrs)?.[1]);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    expect(lengths.filter((l) => l !== undefined).sort()).toEqual(['40', '64']);
  });

  it('links popup.css and loads nothing from the network', () => {
    expect(html).toMatch(/<link\b[^>]*\shref\s*=\s*["'][^"']*popup\.css["']/iu);
    for (const t of tags) for (const url of t.attrs.matchAll(/\s(?:src|href|action|data)\s*=\s*["']([^"']*)["']/giu)) expect(url[1], `<${t.name}>`).not.toMatch(/^(https?:)?\/\//iu);
  });
});

describe('the sources under extension/src (section 2, Task 1)', () => {
  it('include every file the plan creates (so the greps below are not vacuous)', () => {
    for (const f of [
      'service-worker.ts',
      'popup.ts',
      'lib/client.ts',
      'lib/store.ts',
      'lib/messages.ts',
      'lib/pairingInput.ts',
      'lib/view.ts',
      'lib/popupModel.ts',
      'lib/strings.ts',
    ]) expect(SRC_FILES, f).toContain(`extension/src/${f}`);
  });

  // Each token is searched as written in the plan, with a left boundary where the token starts a word, so that `retrieval(` is not `eval(`.
  const FORBIDDEN: [string, RegExp][] = [
    ['innerHTML', /innerHTML/u],
    ['outerHTML', /outerHTML/u],
    ['insertAdjacentHTML', /insertAdjacentHTML/u],
    ['eval(', /(?<![\w$])eval\s*\(/u],
    ['new Function', /new\s+Function\b/u],
    ['DEFAULT_SERVER_PORT', /DEFAULT_SERVER_PORT/u],
    ['chrome.storage', /chrome\s*\??\.\s*storage|chrome\s*\[\s*['"`]storage/u],
    ['localStorage', /localStorage/u],
    ['onMessageExternal', /onMessageExternal/u],
    ['onConnectExternal', /onConnectExternal/u],
    ['console.', /(?<![\w$])console\s*\??\./u],
  ];
  it.each(FORBIDDEN)('no file contains %s', (_token, re) => {
    expect(SRC_FILES.length).toBeGreaterThan(0);
    const hits = SRC_FILES.filter((f) => re.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('the token patterns catch what they are meant to catch, and only that', () => {
    const hit = (token: string, text: string): boolean => FORBIDDEN.find(([t]) => t === token)?.[1].test(text) ?? false;
    expect(hit('eval(', 'x = eval("1")')).toBe(true);
    expect(hit('eval(', 'x = window.eval ("1")')).toBe(true);
    expect(hit('eval(', 'const retrieval(x)')).toBe(false);
    expect(hit('new Function', 'new  Function("a")')).toBe(true);
    expect(hit('new Function', 'new FunctionHolder()')).toBe(false);
    expect(hit('chrome.storage', 'chrome.storage.local.get')).toBe(true);
    expect(hit('chrome.storage', "chrome['storage']")).toBe(true);
    expect(hit('chrome.storage', 'chrome?.storage')).toBe(true);
    expect(hit('chrome.storage', 'chrome.runtime')).toBe(false);
    expect(hit('console.', 'console.log(1)')).toBe(true);
    expect(hit('console.', 'myconsole.log')).toBe(false);
  });

  describe('E1: a lib file never names chrome, document, window or indexedDB', () => {
    const NAMES = new Set(['chrome', 'document', 'window', 'indexedDB']);
    /** The offending references in a source text: identifiers in expression or type position, `globalThis.x` and `globalThis['x']`. */
    const offenders = (text: string): string[] => {
      const sf = ts.createSourceFile('lib.ts', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      const out: string[] = [];
      const isName = (n: ts.Node): boolean => {
        const p = n.parent;
        return (
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isPropertySignature(p) && p.name === n) ||
          (ts.isPropertyAssignment(p) && p.name === n) ||
          (ts.isPropertyDeclaration(p) && p.name === n) ||
          (ts.isMethodSignature(p) && p.name === n) ||
          (ts.isMethodDeclaration(p) && p.name === n) ||
          (ts.isBindingElement(p) && p.propertyName === n) ||
          (ts.isQualifiedName(p) && p.right === n) ||
          (ts.isEnumMember(p) && p.name === n) ||
          (ts.isGetAccessorDeclaration(p) && p.name === n) ||
          (ts.isSetAccessorDeclaration(p) && p.name === n)
        );
      };
      const visit = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && NAMES.has(n.text) && !isName(n)) out.push(n.text);
        if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && NAMES.has(n.argumentExpression.text)) out.push(n.argumentExpression.text);
        // globalThis.indexedDB and self.chrome name the global through its holder.
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 'globalThis' || n.expression.text === 'self') && NAMES.has(n.name.text)) out.push(n.name.text);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return out;
    };

    it('the checker flags every way of naming a global and nothing else', () => {
      for (const bad of [
        'const x = chrome.runtime;',
        'document.title = "x";',
        'window.addEventListener("a", f);',
        'indexedDB.open("a");',
        'const t = typeof chrome;',
        'const g = globalThis.indexedDB;',
        'const c = globalThis["chrome"];',
        'let k: typeof document;',
        'type P = chrome.runtime.Port;',
        'function f(window: number) { return window; }',
      ]) expect(offenders(bad), bad).not.toEqual([]);
      for (const good of [
        'const o = { chrome: 1, window: 2 };',
        'x.window = 1; y.document;',
        '// chrome, document, window and indexedDB are named here only in a comment',
        "const s = 'chrome document window indexedDB';",
        'interface Deps { idb: IdbFactory; runtime: Runtime }',
        'interface D { document: string; indexedDB(): void }',
      ]) expect(offenders(good), good).toEqual([]);
    });

    it.each(LIB_FILES.length > 0 ? LIB_FILES : ['(no lib files)'])('%s', (f) => {
      expect(LIB_FILES.length).toBeGreaterThan(0);
      expect(offenders(read(f))).toEqual([]);
    });
  });

  describe('E8d: only service-worker code imports client.ts; the popup holds no token logic', () => {
    const importsOf = (f: string): { spec: string; typeOnly: boolean }[] => {
      const sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      const out: { spec: string; typeOnly: boolean }[] = [];
      ts.forEachChild(sf, (n) => {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
          const clause = n.importClause;
          const named = clause?.namedBindings;
          // `import type { A }` and `import { type A }` both erase; a bare `import './x'` does not.
          const erased = !!clause && (clause.phaseModifier === ts.SyntaxKind.TypeKeyword || (!clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)));
          out.push({ spec: n.moduleSpecifier.text, typeOnly: erased });
        }
        if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push({ spec: n.moduleSpecifier.text, typeOnly: n.isTypeOnly });
      });
      return out;
    };
    const importers = (re: RegExp): { file: string; typeOnly: boolean }[] =>
      SRC_FILES.filter((f) => f.endsWith('.ts')).flatMap((f) => importsOf(f).filter((i) => re.test(i.spec)).map((i) => ({ file: f, typeOnly: i.typeOnly })));

    it('client.ts is imported only by service-worker.ts and (as a type) by messages.ts', () => {
      expect(SRC_FILES.length).toBeGreaterThan(0);
      const bad = importers(/(^|\/)client$/u).filter((i) => !(i.file === 'extension/src/service-worker.ts' || (i.file === 'extension/src/lib/messages.ts' && i.typeOnly)));
      expect(bad).toEqual([]);
    });

    it('store.ts and messages.ts are imported by no popup-side file', () => {
      const popupSide = ['extension/src/popup.ts', 'extension/src/lib/view.ts', 'extension/src/lib/popupModel.ts', 'extension/src/lib/strings.ts'];
      const bad = importers(/(^|\/)(store|messages|client)$/u).filter((i) => popupSide.includes(i.file) && !i.typeOnly);
      expect(bad).toEqual([]);
    });

    it('popup.ts holds no request and no secret handling: it names no fetch, crypto, indexedDB or Authorization', () => {
      const text = read('extension/src/popup.ts');
      for (const re of [/(?<![\w$.])fetch\s*\(/u, /\bcrypto\b/u, /\bindexedDB\b/u, /Authorization/u, /\/v1\//u, /\btoken\b/iu, /pairingId/u]) expect(text, String(re)).not.toMatch(re);
    });
  });

  describe('popup.ts and service-worker.ts are glue only', () => {
    it('popup.ts renders with textContent, sets lang and dir on <html>, and wires popupModel and view', () => {
      const text = read('extension/src/popup.ts');
      expect(text).toContain('textContent');
      expect(text).toMatch(/\.lang\s*=|setAttribute\(\s*['"]lang['"]/u);
      expect(text).toMatch(/\.dir\s*=|setAttribute\(\s*['"]dir['"]/u);
      expect(text).toMatch(/from\s+['"]\.\/lib\/popupModel['"]/u);
      expect(text).toMatch(/from\s+['"]\.\/lib\/view['"]/u);
      expect(text).toMatch(/from\s+['"]\.\/lib\/strings['"]/u);
    });

    it('popup.ts sets a text node or textContent for every string it shows: no markup parsing', () => {
      const text = read('extension/src/popup.ts');
      for (const re of [/DOMParser/u, /createContextualFragment/u, /document\.write/u, /srcdoc/u, /\.html\s*=/u]) expect(text, String(re)).not.toMatch(re);
    });

    it('service-worker.ts wires the real globals into the lib and registers the handlers at the top level (MV3: the first turn of the event loop)', () => {
      const text = read('extension/src/service-worker.ts');
      for (const name of ['registerHandlers', 'createClient', 'createStore', 'indexedDB', 'chrome']) expect(text, name).toContain(name);
      const sf = ts.createSourceFile('sw.ts', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      let topLevel = 0;
      const visit = (n: ts.Node, nested: boolean): void => {
        const fn = ts.isFunctionLike(n);
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'registerHandlers' && !nested) topLevel += 1;
        ts.forEachChild(n, (c) => visit(c, nested || fn));
      };
      visit(sf, false);
      expect(topLevel).toBe(1);
      expect(text).not.toMatch(/\bawait\b[^\n]*\n[^]*registerHandlers/u);
    });
  });
});

describe('the project wiring (section 2)', () => {
  it('package.json: build:ext runs vite on the extension config, and typecheck also checks tsconfig.ext.json', () => {
    const pkg = json('package.json') as { scripts: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.scripts['build:ext']).toBe('vite build --config extension/vite.config.mjs');
    expect(pkg.scripts['typecheck']).toContain('tsc --noEmit -p tsconfig.node.json');
    expect(pkg.scripts['typecheck']).toContain('&& tsc --noEmit -p tsconfig.ext.json');
    expect(pkg.devDependencies['@types/chrome']).toBeTypeOf('string');
  });

  it('tsconfig.ext.json: lib ES2023, DOM and DOM.Iterable; types chrome; the extension sources and three shared files', () => {
    const parsed = ts.parseConfigFileTextToJson('tsconfig.ext.json', read('tsconfig.ext.json'));
    expect(parsed.error).toBeUndefined();
    const c = parsed.config as { compilerOptions: { lib: string[]; types: string[] }; include: string[] };
    expect(c.compilerOptions.lib.map((l) => l.toLowerCase()).sort()).toEqual(['dom', 'dom.iterable', 'es2023']);
    expect(c.compilerOptions.types).toEqual(['chrome']);
    for (const inc of ['extension/src/**/*', 'src/shared/protocol.ts', 'src/shared/text.ts', 'src/shared/i18n.ts']) expect(c.include, inc).toContain(inc);
  });

  it('eslint.config.mjs ignores extension/dist/**', () => {
    expect(read('eslint.config.mjs')).toContain('extension/dist/**');
  });

  it('ci.yml runs `npm run build:ext` after `npm run build`', () => {
    const lines = read('.github/workflows/ci.yml').split(/\r?\n/u).map((l) => l.trim());
    const build = lines.indexOf('- run: npm run build');
    const ext = lines.indexOf('- run: npm run build:ext');
    expect(build).toBeGreaterThan(-1);
    expect(ext).toBeGreaterThan(build);
  });
});
