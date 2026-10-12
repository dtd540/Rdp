import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import path from 'node:path';
import type { AppState } from '@shared/rpc';

export interface TrayContext {
  showWindow: () => void;
  getState: () => AppState;
  setMusicToVrchat: (on: boolean) => Promise<void>;
  setDucking: (on: boolean) => Promise<void>;
  quit: () => void;
}

let tray: Tray | null = null;

export function createTray(ctx: TrayContext): Tray {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'spott-tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('SPOTT Experimental');
  rebuildTray(ctx);
  tray.on('click', () => ctx.showWindow());
  return tray;
}

export function rebuildTray(ctx: TrayContext): void {
  if (!tray) return;
  const s = ctx.getState();
  const menu = Menu.buildFromTemplate([
    { label: 'Open SPOTT Experimental', click: () => ctx.showWindow() },
    { type: 'separator' },
    {
      label: 'Send music to VRChat mic',
      type: 'checkbox',
      checked: !s.musicMutedToVrchat,
      click: (item) => void ctx.setMusicToVrchat(item.checked)
    },
    {
      label: 'Duck music when I talk',
      type: 'checkbox',
      checked: s.duckingEnabled,
      click: (item) => void ctx.setDucking(item.checked)
    },
    { type: 'separator' },
    { label: `v${app.getVersion()}`, enabled: false },
    { label: 'Quit', click: () => ctx.quit() }
  ]);
  tray.setContextMenu(menu);
}
