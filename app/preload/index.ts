import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, BridgeOpResult } from '@shared/rpc';
import type { UpdateStatus } from '@shared/update';

export interface Unsub {
  (): void;
}

const bridge = {
  call: (method: string, params?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('bridge:call', method, params),

  getState: (): Promise<AppState> => ipcRenderer.invoke('bridge:getState'),

  setState: (patch: Partial<AppState>): Promise<AppState> =>
    ipcRenderer.invoke('bridge:setState', patch),

  selfInfo: (): Promise<{ pid: number; name: string; isPackaged: boolean }> =>
    ipcRenderer.invoke('bridge:selfInfo'),

  op: (op: string, arg?: string): Promise<BridgeOpResult> =>
    ipcRenderer.invoke('bridge:op', op, arg),

  updates: {
    getStatus: (): Promise<UpdateStatus | null> => ipcRenderer.invoke('updates:getStatus'),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('updates:check'),
    install: (): Promise<boolean> => ipcRenderer.invoke('updates:install')
  },

  /** Subscribe to sidecar and updater events (meter.update, updates:status, log, sidecar, …). */
  on: (cb: (method: string, params: unknown) => void): Unsub => {
    const listener = (_e: Electron.IpcRendererEvent, method: string, params: unknown) =>
      cb(method, params);
    ipcRenderer.on('bridge:event', listener);
    const updateListener = (_e: Electron.IpcRendererEvent, status: UpdateStatus) => cb('updates:status', status);
    ipcRenderer.on('updates:status', updateListener);
    return () => {
      ipcRenderer.removeListener('bridge:event', listener);
      ipcRenderer.removeListener('updates:status', updateListener);
    };
  }
};

export type Bridge = typeof bridge;

contextBridge.exposeInMainWorld('bridge', bridge);
