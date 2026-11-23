import { Menu, nativeImage, Notification, Tray } from 'electron';
import type { Lang } from '../shared/i18n';
import type { Queue } from './jobs/queue';
import { shellStrings } from './shellStrings';
import { finishedMessage, trayIconBitmap, trayTooltip } from './shellText';

export interface ShellActions {
  showWindow(): void;
  /** null until the engines are running */
  queue(): Queue | null;
  quit(): void;
}

/** Builds the tray menu and tooltip again in `lang`; called at creation and after a language change. */
export function refreshTray(tray: Tray, actions: ShellActions, lang: Lang): void {
  const t = shellStrings(lang);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t.trayOpen, click: () => actions.showWindow() },
      { type: 'separator' },
      { label: t.trayPauseAll, click: () => void actions.queue()?.pauseAll() },
      { label: t.trayResumeAll, click: () => actions.queue()?.resumeAllPaused() },
      { type: 'separator' },
      { label: t.trayQuit, click: () => actions.quit() },
    ]),
  );
  const queue = actions.queue();
  tray.setToolTip(queue ? trayTooltip(queue.snapshot(), lang) : t.tooltipIdle);
}

/** Creates the tray icon with its menu. Keep the returned object referenced or the icon disappears. */
export function createTray(actions: ShellActions, lang: () => Lang): Tray {
  const { size, data } = trayIconBitmap();
  const tray = new Tray(nativeImage.createFromBitmap(data, { width: size, height: size }));
  refreshTray(tray, actions, lang());
  tray.on('click', () => actions.showWindow());
  return tray;
}

/** Keeps the tooltip current and shows a notification when a download or playlist finishes. */
export function attachQueue(tray: Tray, queue: Queue, showWindow: () => void, lang: () => Lang): void {
  queue.onChanged((s) => tray.setToolTip(trayTooltip(s, lang())));
  queue.onFinished((e) => {
    if (!Notification.isSupported()) return;
    const note = new Notification(finishedMessage(e, lang()));
    note.on('click', showWindow);
    note.show();
  });
}
