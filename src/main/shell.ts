import { Menu, nativeImage, Notification, Tray } from 'electron';
import type { Queue } from './jobs/queue';
import { finishedMessage, trayIconBitmap, trayTooltip } from './shellText';

export interface ShellActions {
  showWindow(): void;
  /** null until the engines are running */
  queue(): Queue | null;
  quit(): void;
}

/** Creates the tray icon with its menu. Keep the returned object referenced or the icon disappears. */
export function createTray(actions: ShellActions): Tray {
  const { size, data } = trayIconBitmap();
  const tray = new Tray(nativeImage.createFromBitmap(data, { width: size, height: size }));
  tray.setToolTip('Fetchly');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: () => actions.showWindow() },
      { type: 'separator' },
      { label: 'Pause all', click: () => void actions.queue()?.pauseAll() },
      { label: 'Resume all', click: () => actions.queue()?.resumeAllPaused() },
      { type: 'separator' },
      { label: 'Quit', click: () => actions.quit() },
    ]),
  );
  tray.on('click', () => actions.showWindow());
  return tray;
}

/** Keeps the tooltip current and shows a notification when a download or playlist finishes. */
export function attachQueue(tray: Tray, queue: Queue, showWindow: () => void): void {
  queue.onChanged((s) => tray.setToolTip(trayTooltip(s)));
  queue.onFinished((e) => {
    if (!Notification.isSupported()) return;
    const note = new Notification(finishedMessage(e));
    note.on('click', showWindow);
    note.show();
  });
}
