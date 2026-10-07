import { app, BrowserWindow, session } from 'electron';
import { disposeBrowserViews } from './browserView';
import path from 'path';
import { SidecarClient } from './sidecar';
import { registerIpc } from './ipc';
import { getState, setState } from './state';
import { createTray, rebuildTray } from './tray';
import { disposeUpdater } from './updater';

// Keep audio in the browser process so OUR PID owns our audio sessions —
// per-app routing (SetPersistedDefaultAudioEndpoint) keys on the session owner.
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

// Dev/preview runs must not collide with an installed copy: the packaged app
// owns the shared userData profile and its single-instance lock, which made a
// second (dev) instance quit silently with exit 0. Give unpackaged runs their
// own profile so both can coexist and dev never overwrites release state.
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'vrchat-music-bridge-dev'));
}

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
    await sidecar.tryCall('vm.setMusicToVrchat', { on });
    setState({ musicMutedToVrchat: !on });
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
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: '#0f0e14',
    autoHideMenuBar: true,
    // Drop the stock Windows title bar and let the app's own topbar act as the
    // title bar. On Windows the native min/max/close buttons are re-exposed as an
    // overlay so we keep OS-standard window behaviour (snap layouts, aero shake).
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#0c0e17',
            symbolColor: '#9aa1b8',
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

    // The browser tab no longer attaches a webview — it renders through a main-process
    // WebContentsView (see browserView.ts), which applies the same sandbox rules there.
    // The only webview left is the embedded Discord client.

    // The embedded Discord client: discord.com only.
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

  // Same for the browser tab: no camera, mic, geolocation or notifications.
  session.fromPartition('persist:browser').setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  win.on('closed', () => {
    // Browser views are children of this window; tear them down with it so a
    // hidden renderer process cannot outlive the window.
    disposeBrowserViews();
    win = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Windows has already signalled the first instance to focus itself; make the
  // quit visible in logs instead of exiting silently with no trace.
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

    // Re-apply persistent controls once the sidecar is up.
    const s = getState();
    void sidecar.tryCall('vm.setDucking', {
      enabled: s.duckingEnabled,
      thresholdDb: -42,
      reductionDb: 12
    });

    createTray(trayCtx);
    createWindow();

    // Smoke test: VCB_SMOKE=<seconds> → auto-quit after verifying the sidecar.
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
    // Stay in the tray — the bridge keeps music flowing.
    rebuildTray(trayCtx);
  });

  app.on('before-quit', () => {
    disposeUpdater();
    sidecar.stop();
  });
}
