import { app, BrowserWindow } from 'electron';
import path from 'path';
import { SidecarClient } from './sidecar';
import { registerIpc } from './ipc';
import { getState, setState } from './state';
import { createTray, rebuildTray } from './tray';

// Keep audio in the browser process so OUR PID owns our audio sessions —
// per-app routing (SetPersistedDefaultAudioEndpoint) keys on the session owner.
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

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

  win.on('closed', () => {
    win = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
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
    sidecar.stop();
  });
}
