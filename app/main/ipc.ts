import { ipcMain, shell, app, dialog, BrowserWindow } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import type { AppState, BridgeOpResult } from '@shared/rpc';
import type { OpenDialogOptions } from 'electron';
import type { SidecarClient } from './sidecar';
import { getState, setState } from './state';
import { BACKGROUND_EXTENSIONS, loadBackground, loadStoredBackground } from './background';
import { findSteamPath, launchUrl, scanSteamGames } from './steam';
import { installVoiceMeeter } from './voiceMeeterInstaller';
import { checkForUpdates, getUpdateStatus, installDownloadedUpdate, initializeUpdater } from './updater';

export interface IpcContext {
  sidecar: SidecarClient;
  getWin: () => BrowserWindow | null;
}

const ALLOWED_EXTERNAL = /^(https?:|spotify:|steam:)/i;

export function registerIpc(ctx: IpcContext): void {
  const { sidecar } = ctx;

  initializeUpdater(ctx.getWin);
  ipcMain.handle('updates:getStatus', () => getUpdateStatus());
  ipcMain.handle('updates:check', () => checkForUpdates());
  ipcMain.handle('updates:install', () => installDownloadedUpdate());

  ipcMain.handle('bridge:call', async (_e, method: string, params?: Record<string, unknown>) => {
    // "self" routing: the renderer never knows PIDs; we stamp our own.
    if (method === 'route.app' && params && params.self) {
      const { self: _ignored, ...rest } = params;
      const exe = path.basename(process.execPath).replace(/\.exe$/i, '');
      return sidecar.call('route.app', { ...rest, pid: process.pid, processName: exe });
    }
    return sidecar.call(method, params);
  });

  ipcMain.handle('bridge:getState', () => getState());

  ipcMain.handle('bridge:setState', (_e, patch: Partial<AppState>) => setState(patch));

  ipcMain.handle('bridge:selfInfo', () => ({
    pid: process.pid,
    name: path.basename(process.execPath).replace(/\.exe$/i, ''),
    isPackaged: app.isPackaged
  }));

  ipcMain.handle('bridge:op', async (_e, op: string, arg?: string) => {
    switch (op) {
      case 'installVoiceMeeter':
        return installVoiceMeeter();
      case 'openSoundSettings':
        return sidecar.call('route.settingsDeepLink', { page: 'apps-volume' });
      case 'openExternal':
        if (!arg || !ALLOWED_EXTERNAL.test(arg)) return { ok: false, detail: 'blocked url' };
        await shell.openExternal(arg);
        return { ok: true };
      case 'resetSetup':
        setState({ setupComplete: false, activeService: null, musicEndpointName: null });
        return { ok: true };
      case 'pickBackgroundImage': {
        const options: OpenDialogOptions = {
          title: 'Choose an app background',
          buttonLabel: 'Use this background',
          properties: ['openFile'],
          filters: [{ name: 'Pictures', extensions: BACKGROUND_EXTENSIONS }]
        };
        const win = ctx.getWin();
        const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
        const chosen = picked.canceled ? undefined : picked.filePaths[0];
        if (!chosen) return { ok: false, detail: 'cancelled' } satisfies BridgeOpResult;

        const result = loadBackground(chosen);
        if (!result.ok) return { ok: false, detail: result.detail, image: result.image } satisfies BridgeOpResult;
        // Only remember a picture we can actually paint.
        setState({ backgroundPath: result.image.path });
        return { ok: true, detail: result.image.name, image: result.image } satisfies BridgeOpResult;
      }
      case 'getBackground': {
        const result = loadStoredBackground(getState().backgroundPath);
        if (!result) return { ok: true } satisfies BridgeOpResult;
        if (result.ok) return { ok: true, image: result.image } satisfies BridgeOpResult;
        return { ok: false, detail: result.detail, image: result.image } satisfies BridgeOpResult;
      }
      case 'clearBackground':
        setState({ backgroundPath: null });
        return { ok: true } satisfies BridgeOpResult;
      case 'scanGames': {
        const steamPath = await findSteamPath();
        if (!steamPath) {
          return { ok: false, detail: 'Steam was not found on this PC.' } satisfies BridgeOpResult;
        }
        return { ok: true, games: scanSteamGames(steamPath) } satisfies BridgeOpResult;
      }
      case 'launchGame': {
        // Only a bare Steam app id, so a crafted argument cannot open something else.
        if (!arg || !/^\d{1,12}$/.test(arg)) return { ok: false, detail: 'bad app id' } satisfies BridgeOpResult;
        await shell.openExternal(launchUrl(arg));
        return { ok: true } satisfies BridgeOpResult;
      }
      case 'openGameFolder': {
        const root = await findSteamPath();
        if (!root || !arg || !/^\d{1,12}$/.test(arg)) {
          return { ok: false, detail: 'bad app id' } satisfies BridgeOpResult;
        }
        const game = scanSteamGames(root).find((g) => g.id === arg);
        if (!game?.installDir || !existsSync(game.installDir)) {
          return { ok: false, detail: 'Install folder not found on disk.' } satisfies BridgeOpResult;
        }
        await shell.openPath(game.installDir);
        return { ok: true } satisfies BridgeOpResult;
      }
      default:
        return { ok: false, detail: `unknown op ${op}` };
    }
  });

  // Sidecar events fan out to the renderer.
  sidecar.on('event', (method: string, params: unknown) => {
    ctx.getWin()?.webContents.send('bridge:event', method, params);
  });
  sidecar.on('log', (line: string) => {
    ctx.getWin()?.webContents.send('bridge:event', 'log', { level: 'info', message: line });
  });
  sidecar.on('up', () => ctx.getWin()?.webContents.send('bridge:event', 'sidecar', { up: true }));
  sidecar.on('down', (code: unknown) =>
    ctx.getWin()?.webContents.send('bridge:event', 'sidecar', { up: false, code })
  );
}
