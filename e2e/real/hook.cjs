/*
 * Loaded into the Electron main process with `-r` before the app's own code (Electron's
 * default_app runs every `-r` module first). Test-only; the app under test is unchanged.
 *
 * - Stubs everything that would reach the owner's desktop: shell.openPath,
 *   shell.showItemInFolder, shell.openExternal and dialog.showMessageBox. Each call is
 *   recorded in globalThis.__e2e.calls; showMessageBox answers globalThis.__e2e.messageBoxResponse
 *   (default 1, the Cancel button of the app's "Open a file that can run a program?" box).
 * - Records the tray's context menu and tooltip, so a check can run a tray menu item's own
 *   click handler (not a native click) and read the tooltip.
 * - Records every Notification shown, and keeps the object so a check can emit its click.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electron = require('electron');

const state = {
  calls: [],
  messageBoxResponse: 1,
  trayMenu: null,
  trayTooltips: [],
  notifications: [],
};
globalThis.__e2e = state;

const record = (name, args) => state.calls.push({ name, args, at: Date.now() });

electron.shell.openPath = async (path) => {
  record('shell.openPath', [path]);
  return '';
};
electron.shell.showItemInFolder = (path) => {
  record('shell.showItemInFolder', [path]);
};
electron.shell.openExternal = async (url) => {
  record('shell.openExternal', [url]);
};
// Electron also routes the window's window.confirm() through dialog.showMessageBox (buttons
// OK, Cancel). Those answer state.confirmResponse (default 0 = OK); the app's own box answers
// state.messageBoxResponse.
state.confirmResponse = 0;
const APP_BOX_TITLE = 'Open a file that can run a program?';
electron.dialog.showMessageBox = async (...args) => {
  const options = args.find((a) => a && typeof a === 'object' && Array.isArray(a.buttons)) ?? {};
  const appBox = options.title === APP_BOX_TITLE;
  const response = appBox ? state.messageBoxResponse : state.confirmResponse;
  record('dialog.showMessageBox', [
    { kind: appBox ? 'app' : 'window.confirm', title: options.title, message: options.message, buttons: options.buttons, defaultId: options.defaultId, cancelId: options.cancelId, response },
  ]);
  return { response, checkboxChecked: false };
};

const setContextMenu = electron.Tray.prototype.setContextMenu;
electron.Tray.prototype.setContextMenu = function (menu) {
  state.trayMenu = menu;
  return setContextMenu.call(this, menu);
};
const setToolTip = electron.Tray.prototype.setToolTip;
electron.Tray.prototype.setToolTip = function (text) {
  state.trayTooltips.push({ text, at: Date.now() });
  if (state.trayTooltips.length > 500) state.trayTooltips.shift();
  return setToolTip.call(this, text);
};

const show = electron.Notification.prototype.show;
electron.Notification.prototype.show = function () {
  state.notifications.push({ title: this.title, body: this.body, at: Date.now(), note: this });
  return show.call(this);
};
