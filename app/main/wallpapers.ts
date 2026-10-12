import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { WallpaperEntry } from '@shared/rpc';
import { libraryRoots, findSteamPath } from './steam';

const WORKSHOP_APPID = '4319690';
const USER_DATA_CACHE = 'wallpaper-engine-library.json';
const PREVIEW_TARGET = 'preview-target.png';
const PREVIEW_PREFIX = 'preview-';

/** Resolve the Steam workshop content folder for Wallpaper Engine, if Steam is installed. */
export async function resolveWorkshopDir(): Promise<string | null> {
  const steamPath = await findSteamPath();
  if (!steamPath) return null;
  const roots = libraryRoots(steamPath);
  for (const root of roots) {
    const candidate = path.join(root, 'workshop', 'content', WORKSHOP_APPID);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Build a wallpaper:// URL only when a Steam workshop dir is available. */
export function wallpaperFileUrl(filePath: string, workshopDir: string | null): string {
  const workshopDirVal = workshopDir;
  if (!workshopDirVal) return filePath;
  const rel = path.relative(workshopDirVal, filePath);
  if (!rel || rel.startsWith('..')) return filePath;
  return `wallpaper://${rel.replace(/\\/g, '/')}`;
}

/** Only allow Wallpaper Engine videos that live inside the workshop content folder. */
export function isAllowedWallpaperFile(filePath: string, workshopDir: string | null): boolean {
  const workshopDirVal = workshopDir;
  if (!workshopDirVal) return false;
  const rel = path.relative(workshopDirVal, filePath);
  if (!rel || rel.startsWith('..')) return false;
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv']);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);

function extnameLower(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/** A Wallpaper Engine folder can be a video wallpaper, scene, or WEB wallpaper. */
function classifyFolder(dirName: string, folderPath: string): {
  type: string;
  previewPath: string | null;
  targetPath: string | null;
  backgroundKind: 'video' | 'image' | 'none';
} {
  const candidateImage = [
    'preview.png',
    'preview.jpg',
    'preview.webp',
    'preview.gif',
    'thumbnail.png',
    'thumbnail.jpg',
    'thumbnail.webp',
  ].map((name) => path.join(folderPath, name)).find(existsSync);

  const imagePath = candidateImage ?? findFirstImage(folderPath);

  if (hasVideoFile(folderPath)) {
    return {
      type: 'video',
      previewPath: imagePath ?? null,
      targetPath: null,
      backgroundKind: 'video',
    };
  }

  if (imagePath) {
    return {
      type: 'image',
      previewPath: imagePath,
      targetPath: null,
      backgroundKind: 'image',
    };
  }

  return {
    type: 'scene',
    previewPath: null,
    targetPath: null,
    backgroundKind: 'none',
  };
}

function hasVideoFile(folderPath: string): boolean {
  try {
    for (const entry of listDir(folderPath)) {
      const name = entry.name.toLowerCase();
      if (entry.isDirectory) continue;
      if (VIDEO_EXTENSIONS.has(extnameLower(entry.name))) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function findFirstImage(folderPath: string): string | null {
  try {
    for (const entry of listDir(folderPath)) {
      if (entry.isDirectory) continue;
      if (IMAGE_EXTS.has(extnameLower(entry.name))) {
        return path.join(folderPath, entry.name);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function* listDir(dir: string): Generator<{ name: string; isDirectory: boolean }> {
  const entries = existsSync(dir) ? requireDir(dir) : [];
  for (const name of entries) {
    yield { name, isDirectory: true };
  }
}

function requireDir(dir: string): string[] {
  try {
    return require('fs').readdirSync(dir);
  } catch {
    return [];
  }
}

interface CachedWallpaper {
  source: 'workshop' | 'mine';
  title: string;
  type: string;
  backgroundKind: 'video' | 'image' | 'none';
  previewPath: string | null;
  targetPath: string | null;
  workshopFolder?: string;
}

interface CachedLibrary {
  version: number;
  scannedAt: string;
  workshopFolder: string | null;
  items: Array<{ id: string; folderName: string; cached: CachedWallpaper }>;
}

const CACHE_VERSION = 1;

function cachePath(userData: string): string {
  return path.join(userData, USER_DATA_CACHE);
}

export interface ScanOptions {
  userData: string;
}

/**
 * Scan the local Wallpaper Engine library.
 *
 * Workshop wallpapers are read from Steam's workshop content folder. Your own
 * projects are read from `%LOCALAPPDATA%\Wallpaper Engine\projects`.
 *
 * Results are cached to `{userData}/wallpaper-engine-library.json` so the
 * renderer picker does not re-scan on every open. The cache is refreshed when
 * the Steam workshop folder moves, or when the caller passes `cacheAgeMs` small
 * enough that the cache is considered stale.
 */
export async function listWallpapers(opts: ScanOptions): Promise<WallpaperEntry[] | null> {
  const { userData } = opts;
  const workshopDir = await resolveWorkshopDir();
  const cache = readCache(cachePath(userData));

  const freshWorkshopFolder =
    workshopDir && (!cache || cache.workshopFolder !== workshopDir);
  if (!cache || freshWorkshopFolder) {
    const items = await buildLibrary(workshopDir);
    const fresh: CachedLibrary = {
      version: CACHE_VERSION,
      scannedAt: new Date().toISOString(),
      workshopFolder: workshopDir,
      items,
    };
    writeCache(cachePath(userData), fresh);
    return items.map((item) => flattenEntry(item.id, item.cached, item.folderName));
  }

  if (!cache || cache.items.length === 0) {
    return [];
  }

  return cache.items.map((item) => flattenEntry(item.id, item.cached, item.folderName));
}

export async function refreshWallpapers(opts: ScanOptions): Promise<WallpaperEntry[]> {
  const { userData } = opts;
  const workshopDir = await resolveWorkshopDir();
  const items = await buildLibrary(workshopDir);
  const fresh: CachedLibrary = {
    version: CACHE_VERSION,
    scannedAt: new Date().toISOString(),
    workshopFolder: workshopDir,
    items,
  };
  writeCache(cachePath(userData), fresh);
  return items.map((item) => flattenEntry(item.id, item.cached, item.folderName));
}

export function wallpaperTargetPath(entry: WallpaperEntry): string | null {
  return entry.targetPath;
}

export function wallpaperPreviewUrl(entry: WallpaperEntry, userData: string): string | null {
  if (!entry.previewPath) return null;
  const rel = path.relative(userData, entry.previewPath);
  if (!rel || rel.startsWith('..')) return null;
  return `asset:///${rel.replace(/\\/g, '/')}`;
}

/**
 * For the app background, a Wallpaper Engine video is streamed from the
 * wallpaper:// protocol in Electron; a still Wallpaper Engine wallpaper is
 * exported once to {userData}/preview-target.png and then loaded as a data URL.
 */
export function wallpaperAsBackgroundTarget(
  entry: WallpaperEntry,
  userData: string,
  isElectron: boolean,
): { targetPath: string | null; previewUrl: string | null; kind: 'video' | 'image' | 'none' } {
  if (entry.backgroundKind === 'none' || !entry.targetPath && !entry.previewPath) {
    return { targetPath: null, previewUrl: null, kind: 'none' };
  }

  if (entry.backgroundKind === 'video' && entry.targetPath && isElectron) {
    return { targetPath: entry.targetPath, previewUrl: null, kind: 'video' };
  }

  // Still image: use the preview as the exported target.
  if (entry.backgroundKind === 'image' && entry.previewPath) {
    const target = path.join(userData, PREVIEW_TARGET);
    return { targetPath: target, previewUrl: null, kind: 'image' };
  }

  return { targetPath: null, previewUrl: null, kind: 'none' };
}

function buildLibrary(workshopDir: string | null): Promise<Array<{ id: string; folderName: string; cached: CachedWallpaper }>> {
  return new Promise((resolve) => {
    const items: Array<{ id: string; folderName: string; cached: CachedWallpaper }> = [];

    if (workshopDir) {
      const workshopEntries = readDirNames(workshopDir);
      for (const folderName of workshopEntries) {
        if (!/^\d+$/.test(folderName)) continue;
        const folderPath = path.join(workshopDir, folderName);
        const classified = classifyFolder(folderName, folderPath);
        items.push({
          id: folderName,
          folderName,
          cached: {
            source: 'workshop',
            title: readableTitle(folderName, classified),
            type: classified.type,
            backgroundKind: classified.backgroundKind,
            previewPath: classified.previewPath,
            targetPath: null,
            workshopFolder: folderName,
          },
        });
      }
    }

    const mineDir = getUserWallpaperEngineProjectsDir();
    if (mineDir) {
      const mineEntries = readDirNames(mineDir);
      for (const folderName of mineEntries) {
        if (!folderName || folderName.startsWith('.')) continue;
        const folderPath = path.join(mineDir, folderName);
        const classified = classifyFolder(folderName, folderPath);
        items.push({
          id: folderName,
          folderName,
          cached: {
            source: 'mine',
            title: readableTitle(folderName, classified),
            type: classified.type,
            backgroundKind: classified.backgroundKind,
            previewPath: classified.previewPath,
            targetPath: null,
            workshopFolder: undefined,
          },
        });
      }
    }

    resolve(items);
  });
}

function readableTitle(folderName: string, classified: { type: string; backgroundKind: 'video' | 'image' | 'none' }): string {
  if (classified.backgroundKind === 'none') {
    return folderName;
  }
  return folderName.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function readDirNames(dir: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    return        readFileSync(dir, 'utf8').length > 0
      ? require('fs').readdirSync(dir).filter((n: string) => !n.startsWith('.'))
      : [];
  } catch {
    return [];
  }
}

function getUserWallpaperEngineProjectsDir(): string | null {
  const base = process.env.LOCALAPPDATA;
  if (!base) return null;
  const candidate = path.join(base, 'Wallpaper Engine', 'projects');
  return existsSync(candidate) ? candidate : null;
}

function readCache(filePath: string): CachedLibrary | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as CachedLibrary;
    if (!parsed || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.items)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(filePath: string, cache: CachedLibrary): void {
  try {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('[wallpapers] could not write cache:', err);
  }
}

function flattenEntry(id: string, cached: CachedWallpaper, folderName: string): WallpaperEntry {
  return {
    id,
    source: cached.source,
    title: cached.title,
    type: cached.type,
    backgroundKind: cached.backgroundKind,
    previewPath: cached.previewPath,
    targetPath: cached.targetPath,
    previewUrl: null,
    targetUrl: null,
  };
}
