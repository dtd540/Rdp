import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const stubs = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => void>(),
  quitAndInstall: vi.fn(),
  checkForUpdates: vi.fn(async () => undefined)
}));

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.0.0' },
  BrowserWindow: class {}
}));

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: (event: string, handler: (...args: never[]) => void) => {
        stubs.handlers.set(event, handler);
      },
      quitAndInstall: stubs.quitAndInstall,
      checkForUpdates: stubs.checkForUpdates
    }
  }
}));

const realPlatform = process.platform;

/** The updater only initialises on a packaged Windows build, so pin both. */
async function boot() {
  vi.resetModules();
  stubs.handlers.clear();
  stubs.quitAndInstall.mockClear();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  const mod = await import('./updater');
  mod.initializeUpdater(() => null);
  return mod;
}

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
});

describe('installing a downloaded update', () => {
  beforeEach(() => {
    stubs.quitAndInstall.mockClear();
  });

  /* A visible installer mid-update is the whole complaint this guards: isSilent must be
     true or electron-updater omits /S and the NSIS wizard reappears. */
  it('installs silently so no wizard opens during an update', async () => {
    const mod = await boot();
    stubs.handlers.get('update-downloaded')?.({ version: '9.9.9' } as never);

    expect(mod.installDownloadedUpdate()).toBe(true);
    expect(stubs.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(stubs.quitAndInstall.mock.calls[0][0]).toBe(true);
  });

  it('relaunches the app once the update is in', async () => {
    const mod = await boot();
    stubs.handlers.get('update-downloaded')?.({ version: '9.9.9' } as never);

    mod.installDownloadedUpdate();

    expect(stubs.quitAndInstall.mock.calls[0][1]).toBe(true);
  });

  it('refuses to install when nothing has been downloaded yet', async () => {
    const mod = await boot();

    expect(mod.installDownloadedUpdate()).toBe(false);
    expect(stubs.quitAndInstall).not.toHaveBeenCalled();
  });
});
