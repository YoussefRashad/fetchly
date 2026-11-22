import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 650,
    minWidth: 760,
    minHeight: 480,
    title: 'Hammel',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

void app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
