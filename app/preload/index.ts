import { contextBridge, ipcRenderer } from 'electron';
import type { AppState } from '@shared/rpc';

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

  op: (op: string, arg?: string): Promise<{ ok: boolean; detail?: string; phase?: string }> =>
    ipcRenderer.invoke('bridge:op', op, arg),

  /** Subscribe to sidecar events (meter.update, log, sidecar, …). Returns unsubscribe. */
  on: (cb: (method: string, params: unknown) => void): Unsub => {
    const listener = (_e: Electron.IpcRendererEvent, method: string, params: unknown) =>
      cb(method, params);
    ipcRenderer.on('bridge:event', listener);
    return () => ipcRenderer.removeListener('bridge:event', listener);
  }
};

export type Bridge = typeof bridge;

contextBridge.exposeInMainWorld('bridge', bridge);
