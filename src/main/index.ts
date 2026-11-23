import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, type Tray } from 'electron';
import { resolveLang, type Lang } from '../shared/i18n';
import type { AppStatus, Settings } from '../shared/types';
import { applyTheme, followThemeBackground, windowBackground } from './appearance';
import { Binaries } from './binaries';
import { EngineHost } from './engineHost';
import { FileEngine, startAria2 } from './engines/file';
import { MediaEngine } from './engines/media';
import { markFromInternet } from './fileSafety';
import { createHandlers, type Handlers } from './ipc';
import type { Queue } from './jobs/queue';
import { Store } from './jobs/store';
import { probeUrl, validateUrl } from './probe';
import { createQueueLifecycle } from './queueLifecycle';
import { attachQueue, createTray, refreshTray, type ShellActions } from './shell';
import { shellStrings } from './shellStrings';
import { killStrays } from './strays';
import { ToolGate } from './toolGate';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Starts the tools and owns the queue; null until main() ran. */
let host: EngineHost<Queue> | null = null;
let quitting = false;

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1000,
    height: 650,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: windowBackground(),
    title: 'Fetchly',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The window shows only the app itself; links open in the real browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//u.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  // Closing the window only hides it: downloads keep running, and Quit lives in the tray menu.
  w.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    w.hide();
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void w.loadURL(devUrl);
  else void w.loadFile(join(__dirname, '../renderer/index.html'));
  return w;
}

function showWindow(): void {
  if (!win || win.isDestroyed()) win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

async function main(): Promise<void> {
  const userData = app.getPath('userData');
  const store = new Store(userData, app.getPath('downloads'));
  const loaded = store.load();
  let settings: Settings = loaded.settings;
  applyTheme(settings.theme);
  followThemeBackground(() => win);
  const lang = (): Lang => resolveLang(settings.language, app.getLocale());
  /** The set-aside jobs file; the notice is worded when the window asks, in the language of that moment. */
  let setAside: string | null = loaded.recoveredCorrupt;

  const binDir = join(userData, 'bin');
  const binaries = new Binaries(binDir);
  // The start-up cleanup ends every tool started from binDir; the window's own tool runs
  // (probe, version check, yt-dlp update) wait for it instead of being ended by it.
  const tools = new ToolGate();

  /** The last value from queue.onSaveState: the text of the last failed write of jobs.json, or null. */
  let saveError: string | null = null;

  const appStatus = (): AppStatus => ({ engine: engines.status(), saveError });
  const pushStatus = (): void => send('fetchly:status', appStatus());

  // Construct, wire and dispose the queue (F2). After a queue whose wiring failed, the next one
  // starts from that queue's final list, not from the list read at start.
  const lifecycle = createQueueLifecycle({
    store,
    initial: loaded.snapshot,
    settings: () => settings,
    engines: (daemon) => ({
      media: new MediaEngine({ command: binaries.path('yt-dlp'), prefixArgs: [] }, binaries.path('ffmpeg')),
      file: new FileEngine(daemon.rpc, { daemonAlive: () => daemon.alive() }),
    }),
    send,
    attachTray: (queue) => {
      if (tray) attachQueue(tray, queue, showWindow, lang);
    },
    onSaveState: (error) => {
      if (error === saveError) return;
      saveError = error;
      pushStatus();
    },
    markDownloaded: (path, url) => void markFromInternet(path, url),
  });

  const engines = new EngineHost<Queue>({
    toolsInstalled: async () => (await binaries.status()).every((b) => b.installed),
    // A previous run that was killed may have left its tools writing to the partial files.
    killStrays: () => tools.exclusive(() => killStrays(binDir)),
    startAria2: () => startAria2(binaries.path('aria2c'), join(userData, 'aria2')),
    createQueue: lifecycle.createQueue,
    wireQueue: lifecycle.wireQueue,
    disposeQueue: lifecycle.disposeQueue,
    attachDaemon: lifecycle.attachDaemon,
    onStatus: pushStatus,
  });
  host = engines;

  const trayActions: ShellActions = { showWindow, queue: () => engines.queue(), quit: () => app.quit() };
  const handlers: Handlers = createHandlers({
    queue: () => engines.queue(),
    status: appStatus,
    retryEngines: () => engines.retry(),
    getSettings: () => settings,
    saveSettings: (s) => {
      settings = s;
      store.saveSettings(s);
      applyTheme(s.theme);
      if (tray) refreshTray(tray, trayActions, lang());
    },
    validateUrl,
    probe: (url) => tools.shared(() => probeUrl(url, { command: binaries.path('yt-dlp'), prefixArgs: [] })),
    binaries: {
      status: () => tools.shared(() => binaries.status()),
      ensureAll: (onProgress) => binaries.ensureAll(onProgress),
      updateYtDlp: () => tools.shared(() => binaries.updateYtDlp()),
    },
    onInstallProgress: (name, pct) => send('fetchly:installProgress', name, pct),
    afterInstall: () => engines.start(),
    pickFolder: async () => {
      if (!win) return null;
      const picked = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    openPath: async (path) => {
      const error = await shell.openPath(path);
      if (error !== '') throw new Error(error);
    },
    confirmOpenRunnable: async (fileName) => {
      if (!win) return false;
      const t = shellStrings(lang());
      const answer = await dialog.showMessageBox(win, {
        type: 'warning',
        title: t.runnableTitle,
        message: t.runnableMessage(fileName),
        detail: t.runnableDetail,
        buttons: [t.runnableOpen, t.runnableCancel],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      return answer.response === 0;
    },
    showItem: (path) => shell.showItemInFolder(path),
    startupNotice: () => {
      const once = setAside;
      setAside = null;
      return once === null ? null : shellStrings(lang()).corruptNotice(once);
    },
  });

  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`fetchly:${name}`, (_event, ...args: unknown[]) => (handler as (...a: unknown[]) => unknown)(...args));
  }

  showWindow();
  tray = createTray(trayActions, lang);

  // Never rejects: a missing tool or a failed start is the engine status the window shows.
  await engines.start();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  void app.whenReady().then(main);

  // Stop what is running so partial files are left in a resumable state, then let the app go.
  // A job whose stop is not confirmed in time is already saved as cut off; the next start checks.
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    const cap = new Promise<void>((r) => setTimeout(r, 5000));
    const tidy = (async () => {
      try {
        await host?.queue()?.shutdown();
      } finally {
        await host?.daemon()?.stop();
      }
    })().catch(() => undefined);
    void Promise.race([tidy, cap]).then(() => app.exit(0));
  });
}
