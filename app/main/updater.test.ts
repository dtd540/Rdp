import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let testUserData = '';
const electronMock = vi.hoisted(() => ({
  getVersion: vi.fn(() => '0.0.0'),
  getPath: vi.fn(() => ''),
  getAppPath: vi.fn(() => process.cwd()),
  isPackaged: true
}));

const stubs = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => void>(),
  quitAndInstall: vi.fn(),
  checkForUpdates: vi.fn(async () => undefined)
}));

vi.mock('electron', () => ({ app: electronMock, BrowserWindow: class {} }));
vi.mock('electron-updater', () => ({
  default: { autoUpdater: {
    on: (event: string, handler: (...args: never[]) => void) => { stubs.handlers.set(event, handler); },
    quitAndInstall: stubs.quitAndInstall,
    checkForUpdates: stubs.checkForUpdates
  } }
}));

const realPlatform = process.platform;
async function boot() {
  vi.resetModules();
  stubs.handlers.clear();
  stubs.quitAndInstall.mockClear();
  stubs.checkForUpdates.mockReset().mockResolvedValue(undefined);
  electronMock.isPackaged = true;
  electronMock.getVersion.mockReturnValue('0.0.0');
  electronMock.getPath.mockReturnValue(testUserData);
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  const mod = await import('./updater');
  mod.initializeUpdater(() => null);
  return mod;
}

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  if (testUserData) rmSync(testUserData, { recursive: true, force: true });
});

describe('installing a downloaded update', () => {
  beforeEach(() => {
    if (testUserData) rmSync(testUserData, { recursive: true, force: true });
    testUserData = mkdtempSync(path.join(os.tmpdir(), 'vmb-update-test-'));
    electronMock.getPath.mockReturnValue(testUserData);
  });

  it('installs silently and relaunches when downloaded', async () => {
    const mod = await boot();
    stubs.handlers.get('update-downloaded')?.({ version: '9.9.9' } as never);
    expect(mod.installDownloadedUpdate()).toBe(true);
    expect(stubs.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('refuses to install before an update is downloaded', async () => {
    const mod = await boot();
    expect(mod.installDownloadedUpdate()).toBe(false);
    expect(stubs.quitAndInstall).not.toHaveBeenCalled();
  });

  it('persists matching release notes for the installed version and dismisses them once', async () => {
    const mod = await boot();
    stubs.handlers.get('update-downloaded')?.({ version: '0.3.4', releaseNotes: 'Release body.' } as never);
    electronMock.getVersion.mockReturnValue('0.3.4');
    expect(mod.getPendingUpdateNotice()).toEqual({ version: '0.3.4', releaseNotes: 'Release body.' });

    electronMock.getVersion.mockReturnValue('0.3.5');
    expect(mod.getPendingUpdateNotice()).toBeNull();
    electronMock.getVersion.mockReturnValue('0.3.4');
    mod.dismissUpdateNotice();
    expect(mod.getPendingUpdateNotice()).toBeNull();
  });

  it('falls back to known bundled highlights when the release has no notes', async () => {
    const mod = await boot();
    stubs.handlers.get('update-downloaded')?.({ version: '0.3.4' } as never);
    electronMock.getVersion.mockReturnValue('0.3.4');
    expect(mod.getPendingUpdateNotice()?.releaseNotes).toContain('Save and restore');
    expect(mod.getPendingUpdateNotice()?.releaseNotes).toContain('Fit chatbox messages');
  });

  it('loads the bundled changelog when a legacy pending notice has no notes', async () => {
    const mod = await boot();
    writeFileSync(path.join(testUserData, 'pending-update-notice.json'), JSON.stringify({ version: '0.3.4' }));
    electronMock.getVersion.mockReturnValue('0.3.4');
    expect(mod.getPendingUpdateNotice()?.releaseNotes).toContain('VoiceMeeter and Spotify audio routing settings');
  });

  it('retains pending notice when installed version uses the v prefix', async () => {
    const mod = await boot();
    stubs.handlers.get('update-downloaded')?.({ version: 'v0.3.4', releaseNotes: 'Release body.' } as never);
    electronMock.getVersion.mockReturnValue('0.3.4');
    expect(mod.getPendingUpdateNotice()).toEqual({ version: 'v0.3.4', releaseNotes: 'Release body.' });
  });
});
