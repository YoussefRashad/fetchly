import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppStatus, BinName, FetchlyApi, Snapshot } from '../shared/types';

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const call =
  (name: string) =>
  (...args: unknown[]): Promise<never> =>
    ipcRenderer.invoke(`fetchly:${name}`, ...args) as Promise<never>;

// The window gets these functions and nothing else: no Node, no ipcRenderer.
const api: FetchlyApi = {
  probe: call('probe'),
  add: call('add'),
  job: call('job'),
  group: call('group'),
  snapshot: call('snapshot'),
  onChanged: (cb) => subscribe<[Snapshot]>('fetchly:changed', cb),
  getSettings: call('getSettings'),
  setSettings: call('setSettings'),
  pickFolder: call('pickFolder'),
  openFile: call('openFile'),
  openFolder: call('openFolder'),
  binaries: call('binaries'),
  installBinaries: call('installBinaries'),
  onInstallProgress: (cb) => subscribe<[BinName, number]>('fetchly:installProgress', cb),
  updateYtDlp: call('updateYtDlp'),
  startupNotice: call('startupNotice'),
  status: call('status'),
  onStatus: (cb) => subscribe<[AppStatus]>('fetchly:status', cb),
  retryEngines: call('retryEngines'),
  confirmStraysGone: call('confirmStraysGone'),
};

contextBridge.exposeInMainWorld('fetchly', api);
