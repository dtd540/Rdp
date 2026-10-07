import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import type { BackgroundImage } from '@shared/rpc';

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

export function loadStoredBackground(stored: string | null): BackgroundResult | null {
  if (!stored) return null;
  return loadBackground(stored);
}