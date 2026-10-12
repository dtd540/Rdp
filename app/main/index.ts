import { app, BrowserWindow, session, dialog } from 'electron';
import { applyMusicSend } from '@shared/audioControls';
import { disposeBrowserViews } from './browserView';
import path from 'path';
import { SidecarClient } from './sidecar';
import { registerIpc } from './ipc';
import { getState, setState } from './state';
import { createTray, rebuildTray } from './tray';
import { disposeUpdater } from './updater';

app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

app.setName('SPOTT Experimental');
app.setPath('userData', path.join(app.getPath('appData'), app.isPackaged ? 'spott-experimental' : 'spott-experimental-dev'));

const sidecar = new SidecarClient();
let win: BrowserWindow | null = null;

const trayCtx = {
  showWindow: () => {
    if (!win || win.isDestroyed()) return createWindow();
    win.show();
    win.focus();
  },
  getState,
  setMusicToVrchat: async (on: boolean) => {
    try {
      await applyMusicSend(on, (method, params) => sidecar.call(method, params), setState);
    } catch (error) {
      dialog.showErrorBox('Music routing change failed', error instanceof Error ? error.message : String(error));
    }
    rebuildTray(trayCtx);
  },
  setDucking: async (on: boolean) => {
    await sidecar.tryCall('vm.setDucking', {
      enabled: on,
      thresholdDb: -42,
      reductionDb: 12
    });
    setState({ duckingEnabled: on });
    rebuildTray(trayCtx);
  },
  quit: () => app.quit()
};

function createWindow(): void {
  win = new BrowserWindow({
    title: 'SPOTT Experimental',
    icon: path.join(app.getAppPath(), 'build', 'spott.png'),
    width: 1120,
    height: 760,
    minWidth: 560,
    minHeight: 480,
    backgroundColor: '#080204',
    autoHideMenuBar: true,
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#100509',
            symbolColor: '#ffbf2f',
            height: 61
          }
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const url = new URL(params.src || 'about:blank');


    if (url.protocol !== 'https:' || url.hostname !== 'discord.com') {
      event.preventDefault();
      return;
    }
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.preload = undefined;
    webPreferences.partition = 'persist:discord';
  });

  win.webContents.on('did-attach-webview', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const allowDiscordNavigation = (event: Electron.Event, url: string) => {
      try {
        const target = new URL(url);
        const browser = contents.session === session.fromPartition('persist:browser');
        if (browser ? target.protocol !== 'https:' && target.protocol !== 'http:' : target.protocol !== 'https:' || target.hostname !== 'discord.com') {
          event.preventDefault();
        }
      } catch {
        event.preventDefault();
      }
    };
    contents.on('will-navigate', allowDiscordNavigation);
    contents.on('will-redirect', allowDiscordNavigation);
  });

  session.fromPartition('persist:discord').setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  session.fromPartition('persist:browser').setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  win.on('closed', () => {
    disposeBrowserViews();
    win = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error('[app] another instance already holds the single-instance lock — quitting this one.');
  app.quit();
} else {
  app.on('second-instance', () => trayCtx.showWindow());

  app.whenReady().then(() => {
    registerIpc({ sidecar, getWin: () => win });

    try {
      sidecar.start();
      sidecar.on('log', (line: string) => console.log('[sidecar]', line));
    } catch (err) {
      console.error('[sidecar] failed to start:', err);
    }

    const s = getState();
    void sidecar.tryCall('vm.setDucking', {
      enabled: s.duckingEnabled,
      thresholdDb: -42,
      reductionDb: 12
    });

    createTray(trayCtx);
    createWindow();

    if (process.env.VCB_SMOKE) {
      const secs = Number(process.env.VCB_SMOKE) || 8;
      setTimeout(async () => {
        try {
          const pong = await sidecar.call('ping');
          const eps = await sidecar.call('endpoints.list');
          const st = await sidecar.call('vm.state');
          console.log(
            `[SMOKE] ping=${JSON.stringify(pong)} endpoints=${Array.isArray(eps) ? eps.length : '??'} vm=${JSON.stringify(st)}`
          );
          console.log('[SMOKE] OK');
        } catch (err) {
          console.error('[SMOKE] FAIL', err);
        }
        app.quit();
      }, secs * 1000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else trayCtx.showWindow();
    });
  });

  app.on('window-all-closed', () => {
    rebuildTray(trayCtx);
  });

  app.on('before-quit', () => {
    disposeUpdater();
    sidecar.stop();
  });
}
