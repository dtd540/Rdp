import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import type { AppState } from '@shared/rpc';

const ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAKWSURBVFhH1Ve/axRBFE5pmTKlf4JNMDNX5Cq7QMAmnZaCjVgdt4eXIoWFYCVXpbAQtZBUIigoChKwiGARwcJYJVx2Z1e86OU0yco3tz9m39vd2xli4Qcf3PLevPfNm9n3bufm/ld0W8GS1/LbJqnPuaK/OFzoSv9GTwYvelLFlRRq2xN+p385ukhjOKG/HM17Qq17Qo1ZslkU4QDCaczG0KUVQcQCW1ALF4drNPZM9GRw3WnXFUQVaY5KIDkNcE68T3MxTMvutvONK2H8Yes43rz5g9lS4iLTnBlwYVzP/PXmr3j33SROMQpOS8Vgc105vERza6BENHBT1uHw20lRhFRbNHeye7fSgyai/dPC887zY+bPqoDmQZ1saALPD659j98/GWsxD2+X3AkRDgoC0MGYkwWpgFn0pDrIkqPbUQdb2goAs2PAYKFGW7oIyDpkT/irzGhJFwHdpeDWtAJ6ynEHG7oIyNozSkGNtnQT4He0ALRfaqzjo85Id7mvO7818Z67CMDMmb4Fi8MFbuS8dzWK97+cFJKVga6rIi5/8iLqCbhHHUyut0PdUpsAQul6SnTd/vLeBUNA/RzAsDGBsmPQgLD9mZxltk+vJmw9JZsHaArUySTOOsXLwU9mh5AU49EZszMKf7UgAIAq5pjQLD8dseDdlSizoxo4MuqTJ1cfaW6NuipgsKSAGFMEztysEH7T9UUBJbtPUTUVMd3McwbwjHJTPL0zYuvz5GQKlsGT4WO2UKr42cYRzcWAStF1eXK1Xbj5VYBTlQhUYvdt/tcrBcpedjeKyaN5mqsW6NUskEFcvCbvvP5AabLzMiRt+g0L2oyfay+cDRAIx9LsfyO+H5M+/y8w/XbwO8k3Y86W37Yt9V/dLzFu6p6EEgAAAABJRU5ErkJggg==';

export interface TrayContext {
  showWindow: () => void;
  getState: () => AppState;
  setMusicToVrchat: (on: boolean) => Promise<void>;
  setDucking: (on: boolean) => Promise<void>;
  quit: () => void;
}

let tray: Tray | null = null;

export function createTray(ctx: TrayContext): Tray {
  const icon = nativeImage.createFromBuffer(Buffer.from(ICON_BASE64, 'base64'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('VRChat Music Bridge');
  rebuildTray(ctx);
  tray.on('click', () => ctx.showWindow());
  return tray;
}

export function rebuildTray(ctx: TrayContext): void {
  if (!tray) return;
  const s = ctx.getState();
  const menu = Menu.buildFromTemplate([
    { label: 'Open VRChat Music Bridge', click: () => ctx.showWindow() },
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
