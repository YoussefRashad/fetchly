import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, type Tray } from 'electron';
import type { Settings } from '../shared/types';
import { Binaries } from './binaries';
import { FileEngine, startAria2 } from './engines/file';
import { MediaEngine } from './engines/media';
import { createHandlers, type Handlers } from './ipc';
import { Queue } from './jobs/queue';
import { Store } from './jobs/store';
import { probeUrl, validateUrl } from './probe';
import { attachQueue, createTray } from './shell';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let queue: Queue | null = null;
let stopAria2: (() => Promise<void>) | null = null;
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

  const binaries = new Binaries(join(userData, 'bin'));

  /** Starts aria2 and both engines. Safe to call once the three tools are installed. */
  const startEngines = async (): Promise<void> => {
    if (queue) return;
    const aria2 = await startAria2(binaries.path('aria2c'), join(userData, 'aria2'));
    stopAria2 = aria2.stop;
    const media = new MediaEngine({ command: binaries.path('yt-dlp'), prefixArgs: [] }, binaries.path('ffmpeg'));
    const file = new FileEngine(aria2.rpc);
    queue = new Queue({ store, media, file, initial: loaded.snapshot, settings });
    queue.onChanged((s) => send('hammel:changed', s));
    if (tray) attachQueue(tray, queue, showWindow);
    if (settings.autoResumeOnStart) queue.resumeAllPaused();
    send('hammel:changed', queue.snapshot());
  };

  const handlers: Handlers = createHandlers({
    queue: () => queue,
    getSettings: () => settings,
    saveSettings: (s) => {
      settings = s;
      store.saveSettings(s);
    },
    validateUrl,
    probe: (url) => probeUrl(url, { command: binaries.path('yt-dlp'), prefixArgs: [] }),
    binaries,
    onInstallProgress: (name, pct) => send('hammel:installProgress', name, pct),
    afterInstall: startEngines,
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
  tray = createTray({ showWindow, queue: () => queue, quit: () => app.quit() });

  const status = await binaries.status();
  if (status.every((b) => b.installed)) {
    try {
      await startEngines();
    } catch (e) {
      notice = `The download tools could not be started: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  void app.whenReady().then(main);

  // Pause what is running so partial files are left in a resumable state, then let the app go.
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    const cap = new Promise<void>((r) => setTimeout(r, 5000));
    const tidy = (async () => {
      await queue?.pauseAll();
      await stopAria2?.();
    })().catch(() => undefined);
    void Promise.race([tidy, cap]).then(() => app.exit(0));
  });
}
