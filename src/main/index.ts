import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, type Tray } from 'electron';
import type { AppStatus, Settings } from '../shared/types';
import { Binaries } from './binaries';
import { EngineHost } from './engineHost';
import { FileEngine, startAria2 } from './engines/file';
import { MediaEngine } from './engines/media';
import { createHandlers, type Handlers } from './ipc';
import type { Queue } from './jobs/queue';
import { Store } from './jobs/store';
import { probeUrl, validateUrl } from './probe';
import { createQueueLifecycle } from './queueLifecycle';
import { attachQueue, createTray } from './shell';
import { killStrays } from './strays';

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
    title: 'Hammel',
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
  let notice: string | null = loaded.recoveredCorrupt
    ? `The saved download list could not be read and was set aside as ${loaded.recoveredCorrupt}. The list starts empty.`
    : null;

  const binDir = join(userData, 'bin');
  const binaries = new Binaries(binDir);

  /** The last value from queue.onSaveState: the text of the last failed write of jobs.json, or null. */
  let saveError: string | null = null;

  const appStatus = (): AppStatus => ({ engine: engines.status(), saveError });
  const pushStatus = (): void => send('hammel:status', appStatus());

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
      if (tray) attachQueue(tray, queue, showWindow);
    },
    onSaveState: (error) => {
      if (error === saveError) return;
      saveError = error;
      pushStatus();
    },
  });

  const engines = new EngineHost<Queue>({
    toolsInstalled: async () => (await binaries.status()).every((b) => b.installed),
    // A previous run that was killed may have left its tools writing to the partial files.
    killStrays: () => killStrays(binDir),
    startAria2: () => startAria2(binaries.path('aria2c'), join(userData, 'aria2')),
    createQueue: lifecycle.createQueue,
    wireQueue: lifecycle.wireQueue,
    disposeQueue: lifecycle.disposeQueue,
    attachDaemon: lifecycle.attachDaemon,
    onStatus: pushStatus,
  });
  host = engines;

  const handlers: Handlers = createHandlers({
    queue: () => engines.queue(),
    status: appStatus,
    retryEngines: () => engines.retry(),
    getSettings: () => settings,
    saveSettings: (s) => {
      settings = s;
      store.saveSettings(s);
    },
    validateUrl,
    probe: (url) => probeUrl(url, { command: binaries.path('yt-dlp'), prefixArgs: [] }),
    binaries,
    onInstallProgress: (name, pct) => send('hammel:installProgress', name, pct),
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
    showItem: (path) => shell.showItemInFolder(path),
    startupNotice: () => {
      const once = notice;
      notice = null;
      return once;
    },
  });

  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`hammel:${name}`, (_event, ...args: unknown[]) => (handler as (...a: unknown[]) => unknown)(...args));
  }

  showWindow();
  tray = createTray({ showWindow, queue: () => engines.queue(), quit: () => app.quit() });

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
