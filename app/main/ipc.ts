import { ipcMain, shell, app, dialog, BrowserWindow } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import type { AppState, BridgeOpResult } from '@shared/rpc';
import type { OpenDialogOptions } from 'electron';
import type { SidecarClient } from './sidecar';
import { getState, setState } from './state';
import { BACKGROUND_EXTENSIONS, loadBackground, loadStoredBackground } from './background';
import { findSteamPath, installUrl, launchUrl, scanSteamGames, scanSteamLibraryResult } from './steam';
import { appUptimeSeconds, pcSnapshot, recentVrchatWorlds, sendChatbox, vrchatIsRunning, vrchatLogFolder } from './gaming';
import { windowsChatboxSources } from './chatboxSources';
import { chatboxSender } from './osc';
import { parseWorldLink } from '@shared/gaming';
import { installVoiceMeeter } from './voiceMeeterInstaller';
import { browserTabAction, disposeBrowserViews, findInBrowserTab, hideBrowserView, initializeBrowserViews, navigateBrowserTab, setBrowserBounds, stopFindInBrowserTab, syncBrowserTabs, zoomBrowserTab } from './browserView';
import { checkForUpdates, getUpdateStatus, installDownloadedUpdate, initializeUpdater } from './updater';

export interface IpcContext {
  sidecar: SidecarClient;
  getWin: () => BrowserWindow | null;
}

const ALLOWED_EXTERNAL = /^(https?:|spotify:|steam:)/i;

function readJson<T>(arg: string | undefined): T {
  try {
    return JSON.parse(arg ?? '{}') as T;
  } catch {
    return {} as T;
  }
}

export function registerIpc(ctx: IpcContext): void {
  const { sidecar } = ctx;

  initializeUpdater(ctx.getWin);
  initializeBrowserViews(ctx.getWin);
  ipcMain.handle('updates:getStatus', () => getUpdateStatus());
  ipcMain.handle('updates:check', () => checkForUpdates());
  ipcMain.handle('updates:install', () => installDownloadedUpdate());

  ipcMain.handle('bridge:call', async (_e, method: string, params?: Record<string, unknown>) => {
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
      case 'pcSnapshot':
        return { ok: true, pc: await pcSnapshot() } satisfies BridgeOpResult;
      case 'recentWorlds':
        return { ok: true, ...recentVrchatWorlds() } satisfies BridgeOpResult;
      case 'chatboxContext': {
        try {
          const requested = JSON.parse(arg ?? '{}') as { windowTitle?: unknown; media?: unknown; battery?: unknown; network?: unknown; currentWorld?: unknown };
          const sources = await windowsChatboxSources({ windowTitle: requested.windowTitle === true, media: requested.media === true, battery: requested.battery === true, network: requested.network === true });
          const pc = requested.currentWorld === true ? await pcSnapshot() : undefined;
          const vrchatRunning = pc ? vrchatIsRunning(pc) : false;
          const latestWorld = vrchatRunning ? recentVrchatWorlds().worlds[0]?.name ?? null : null;
          return { ok: true, ...sources, ...(requested.currentWorld === true ? { currentWorld: latestWorld, vrchatRunning } : {}), appUptimeSeconds: appUptimeSeconds() } satisfies BridgeOpResult;
        } catch (error) {
          return { ok: false, detail: error instanceof Error ? error.message : String(error), appUptimeSeconds: appUptimeSeconds() } satisfies BridgeOpResult;
        }
      }
      case 'setChatboxTyping': {
        try {
          await chatboxSender.typing(JSON.parse(arg ?? '{}'));
          return { ok: true, detail: 'Typing indicator packet sent locally; VRChat receipt cannot be confirmed.' };
        } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : String(error) }; }
      }
      case 'sendChatbox': {
        try {
          await sendChatbox(JSON.parse(arg ?? '{}'));
          return { ok: true, detail: 'OSC packet sent to this PC. UDP cannot confirm VRChat received it.' } satisfies BridgeOpResult;
        } catch (error) {
          return { ok: false, detail: error instanceof Error ? error.message : String(error) } satisfies BridgeOpResult;
        }
      }
      case 'openVrchatLogs': {
        const folder = vrchatLogFolder();
        if (!existsSync(folder)) return { ok: false, detail: 'VRChat log folder was not found.' };
        const error = await shell.openPath(folder);
        return { ok: !error, detail: error || undefined };
      }
      case 'joinVrchatWorld': {
        const world = parseWorldLink(arg ?? '');
        if (!world?.instanceId) return { ok: false, detail: 'A VRChat launch link with an instance id is required to join.' };
        const query = new URLSearchParams({ id: `${world.worldId}:${world.instanceId}` });
        await shell.openExternal(`vrchat://launch?${query}`);
        return { ok: true };
      }
      case 'openGameMode':
        await shell.openExternal('ms-settings:gaming-gamemode');
        return { ok: true };
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
        const cacheFile = path.join(app.getPath('userData'), 'steam-name-cache.json');
        return { ok: true, ...await scanSteamLibraryResult(steamPath, cacheFile) } satisfies BridgeOpResult;
      }
      case 'launchGame': {
        if (!arg || !/^\d{1,12}$/.test(arg)) return { ok: false, detail: 'bad app id' } satisfies BridgeOpResult;
        await shell.openExternal(launchUrl(arg));
        return { ok: true } satisfies BridgeOpResult;
      }
      case 'installGame': {
        if (!arg || !/^\d{1,12}$/.test(arg)) return { ok: false, detail: 'bad app id' } satisfies BridgeOpResult;
        await shell.openExternal(installUrl(arg));
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
        const error = await shell.openPath(game.installDir);
        return { ok: !error, detail: error || undefined } satisfies BridgeOpResult;
      }
      case 'browser:sync': {
        const payload = readJson<{ tabs?: Array<{ id?: unknown; url?: unknown }>; activeId?: unknown }>(arg);
        return { ok: true, browserTabs: syncBrowserTabs(payload).tabs } satisfies BridgeOpResult;
      }
      case 'browser:bounds': {
        const box = readJson<{ x?: number; y?: number; width?: number; height?: number }>(arg);
        setBrowserBounds({ x: Number(box.x) || 0, y: Number(box.y) || 0, width: Number(box.width) || 0, height: Number(box.height) || 0 });
        return { ok: true } satisfies BridgeOpResult;
      }
      case 'browser:navigate': {
        const { id, url } = readJson<{ id?: string; url?: string }>(arg);
        if (!id || !url) return { ok: false, detail: 'navigate needs a tab id and url' } satisfies BridgeOpResult;
        return { ok: navigateBrowserTab(id, url) } satisfies BridgeOpResult;
      }
      case 'browser:action': {
        const { id, action } = readJson<{ id?: string; action?: string }>(arg);
        if (!id || !action) return { ok: false, detail: 'action needs a tab id and action' } satisfies BridgeOpResult;
        return { ok: browserTabAction(id, action) } satisfies BridgeOpResult;
      }
      case 'browser:zoom': {
        const { id, factor } = readJson<{ id?: string; factor?: number }>(arg);
        if (!id) return { ok: false, detail: 'zoom needs a tab id' } satisfies BridgeOpResult;
        return { ok: true, detail: String(zoomBrowserTab(id, Number(factor) || 1)) } satisfies BridgeOpResult;
      }
      case 'browser:find': {
        const { id, text, forward, findNext } = readJson<{ id?: string; text?: string; forward?: boolean; findNext?: boolean }>(arg);
        if (!id) return { ok: false, detail: 'find needs a tab id' } satisfies BridgeOpResult;
        return { ok: findInBrowserTab(id, String(text ?? ''), forward !== false, findNext === true) } satisfies BridgeOpResult;
      }
      case 'browser:findStop': {
        const { id, action } = readJson<{ id?: string; action?: string }>(arg);
        if (id) stopFindInBrowserTab(id, action === 'keepSelection' ? 'keepSelection' : 'clearSelection');
        return { ok: true } satisfies BridgeOpResult;
      }
      case 'browser:hide':
        hideBrowserView();
        return { ok: true } satisfies BridgeOpResult;
      case 'browser:dispose':
        disposeBrowserViews();
        return { ok: true } satisfies BridgeOpResult;
      default:
        return { ok: false, detail: `unknown op ${op}` };
    }
  });

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
