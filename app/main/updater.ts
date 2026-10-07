import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '@shared/update';

const { autoUpdater } = electronUpdater;

let getWindow: (() => BrowserWindow | null) | null = null;
let initialized = false;
let checkInFlight = false;
let downloadedVersion: string | null = null;
let lastStatus: UpdateStatus | null = null;
let checkTimer: ReturnType<typeof setInterval> | null = null;

function broadcast(status: UpdateStatus): void {
  lastStatus = status;
  const win = getWindow?.();
  if (win && !win.isDestroyed()) win.webContents.send('updates:status', status);
}

export function initializeUpdater(getWin: () => BrowserWindow | null): void {
  getWindow = getWin;
  if (initialized || !app.isPackaged || process.platform !== 'win32') return;
  initialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => broadcast({
    state: 'available',
    version: info.version,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
  }));
  autoUpdater.on('update-not-available', (info) => broadcast({ state: 'not-available', version: info.version }));
  autoUpdater.on('download-progress', (progress) => broadcast({
    state: 'progress',
    percent: progress.percent,
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond
  }));
  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version;
    broadcast({ state: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (error) => {
    checkInFlight = false;
    broadcast({ state: 'error', message: error.message || 'Update check failed.' });
  });

  void checkForUpdates();
  checkTimer = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
  checkTimer.unref?.();
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged || process.platform !== 'win32') {
    return { state: 'error', message: 'Update checks are available in the installed Windows app.' };
  }
  if (downloadedVersion) return { state: 'downloaded', version: downloadedVersion };
  if (checkInFlight) return lastStatus ?? { state: 'checking' };
  checkInFlight = true;
  broadcast({ state: 'checking' });
  try {
    const result = await autoUpdater.checkForUpdates();
    checkInFlight = false;
    if (!result) return lastStatus ?? { state: 'error', message: 'Update check is unavailable.' };
    if (downloadedVersion) return { state: 'downloaded', version: downloadedVersion };
    const currentStatus = lastStatus;
    if (result.isUpdateAvailable) {
      if (currentStatus?.state === 'available' || currentStatus?.state === 'progress') return currentStatus;
      const status = { state: 'available' as const, version: result.updateInfo.version };
      broadcast(status);
      return status;
    }
    const status = { state: 'not-available' as const, version: result.updateInfo.version };
    broadcast(status);
    return status;
  } catch (error) {
    checkInFlight = false;
    const status = { state: 'error' as const, message: (error as Error).message || 'Update check failed.' };
    broadcast(status);
    return status;
  }
}

export function installDownloadedUpdate(): boolean {
  if (!downloadedVersion) return false;
  // The first argument is isSilent: it makes electron-updater pass /S to the NSIS
  // installer, so an update finishes on its own instead of reopening the wizard. The
  // second relaunches the app afterwards.
  autoUpdater.quitAndInstall(true, true);
  return true;
}

export function getUpdateStatus(): UpdateStatus | null {
  return lastStatus;
}

export function disposeUpdater(): void {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = null;
}
