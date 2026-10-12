import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import type { BackgroundImage } from '@shared/rpc';
import { VIDEO_EXTENSIONS, wallpaperFileUrl, isAllowedWallpaperFile, resolveWorkshopDir } from './wallpapers';
export { resolveWorkshopDir } from './wallpapers';

const SUPPORTED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif']);

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
};

export const MAX_BACKGROUND_BYTES = 25 * 1024 * 1024;

export type BackgroundResult =
  | { ok: true; image: BackgroundImage }
  | { ok: false; detail: string; image: BackgroundImage };

export function isSupportedImage(filePath: string): boolean {
  return SUPPORTED_EXT.has(path.extname(filePath).toLowerCase());
}

export const BACKGROUND_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];

export function loadBackground(filePath: string): BackgroundResult {
  const name = path.basename(filePath);
  const broken = (detail: string): BackgroundResult => ({
    ok: false,
    detail,
    image: { path: filePath, name, url: '', animated: false, broken: true, detail }
  });

  if (!filePath || !existsSync(filePath)) {
    return broken(`That file is gone — pick it again. (${filePath || 'no file'})`);
  }
  if (!isSupportedImage(filePath)) {
    return broken(`${name} is not a supported picture. Use PNG, JPG, WEBP or GIF.`);
  }

  let bytes: number;
  try {
    bytes = statSync(filePath).size;
  } catch (err) {
    console.error('[background] stat failed:', err);
    return broken(`${name} could not be read. Pick it again.`);
  }
  if (bytes > MAX_BACKGROUND_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    return broken(`${name} is ${mb} MB. Pick a background under 25 MB.`);
  }

  try {
    const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const url = `data:${mime};base64,${readFileSync(filePath).toString('base64')}`;
    return {
      ok: true,
      image: { path: filePath, name, url, animated: /\.gif$/i.test(filePath) }
    };
  } catch (err) {
    console.error('[background] read failed:', err);
    return broken(`${name} could not be read. Pick it again.`);
  }
}

/**
 * Wallpaper Engine videos stream over the wallpaper:// protocol instead of a
 * data URL. Static Wallpaper Engine stills are exported to a temporary target
 * under the app's user data folder so they can be loaded like any other image.
 */
function loadVideoBackground(filePath: string, workshopDir: string | null): BackgroundResult {
  const name = path.basename(filePath);
  const broken = (detail: string): BackgroundResult => ({
    ok: false,
    detail,
    image: { path: filePath, name, url: '', animated: false, broken: true, detail }
  });
  if (!filePath || !existsSync(filePath)) {
    return broken(`That wallpaper file is gone — pick it again. (${filePath || 'no file'})`);
  }
  if (!isAllowedWallpaperFile(filePath, workshopDir)) {
    return broken(`${name} is outside the Wallpaper Engine library.`);
  }
  return {
    ok: true,
    image: { path: filePath, name, url: wallpaperFileUrl(filePath, workshopDir), animated: true, video: true }
  };
}

/**
 * Load a background that was previously persisted as `backgroundPath`.
 *
 * A stored path can be a user-picked image, a Wallpaper Engine video, or a
 * Wallpaper Engine still that was exported to the user data folder.
 */
export async function loadStoredBackground(
  stored: string | null,
  workshopDir: string | null = null,
): Promise<BackgroundResult | null> {
  const workshopDirVal = workshopDir ?? (await resolveWorkshopDir());
  if (!stored) return null;
  if (VIDEO_EXTENSIONS.has(path.extname(stored).toLowerCase())) {
    // Heuristic: a wallpaper:// URL is only valid for files inside the workshop
    // content folder, so pass the workshop dir so the loader can verify it.
    return loadVideoBackground(stored, workshopDirVal);
  }
  return loadBackground(stored);
}