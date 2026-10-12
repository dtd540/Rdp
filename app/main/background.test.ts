import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  BACKGROUND_EXTENSIONS,
  MAX_BACKGROUND_BYTES,
  isSupportedImage,
  loadBackground,
  loadStoredBackground,
  type BackgroundResult
} from './background';

const TINY_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

let dir = '';

function makeFile(name: string, contents: Buffer | string): string {
  const file = path.join(dir, name);
  writeFileSync(file, contents);
  return file;
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'vcmb-bg-'));
});

function expectRejected(result: BackgroundResult): Extract<BackgroundResult, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected the background to be rejected');
  return result;
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isSupportedImage', () => {
  it('accepts every extension the picker offers, case-insensitively', () => {
    for (const ext of BACKGROUND_EXTENSIONS) {
      expect(isSupportedImage(`C:\\pics\\wallpaper.${ext}`)).toBe(true);
      expect(isSupportedImage(`/home/me/wallpaper.${ext.toUpperCase()}`)).toBe(true);
    }
  });

  it('rejects anything Chromium cannot paint as a background', () => {
    expect(isSupportedImage('/home/me/song.mp3')).toBe(false);
    expect(isSupportedImage('/home/me/clip.webm')).toBe(false);
    expect(isSupportedImage('/home_me/no-extension')).toBe(false);
  });
});

describe('loadBackground', () => {
  it('reads an animated GIF into a data URL the renderer can paint', () => {
    const file = makeFile('loops.gif', Buffer.from(TINY_GIF_BASE64, 'base64'));
    const result = loadBackground(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.name).toBe('loops.gif');
    expect(result.image.url.startsWith('data:image/gif;base64,')).toBe(true);
    expect(result.image.url.slice('data:image/gif;base64,'.length)).toBe(TINY_GIF_BASE64);
    expect(result.image.animated).toBe(true);
    expect(result.image.broken).toBeUndefined();
  });

  it('marks a still image as not animated', () => {
    const result = loadBackground(makeFile('still.png', Buffer.from(TINY_GIF_BASE64, 'base64')));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.animated).toBe(false);
    expect(result.image.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('explains a file that has moved or been deleted', () => {
    const rejected = expectRejected(loadBackground(path.join(dir, 'deleted.gif')));
    expect(rejected.image.broken).toBe(true);
    expect(rejected.image.url).toBe('');
    expect(rejected.detail).toContain('deleted.gif');
  });

  it('refuses a real file that is not a picture', () => {
    const rejected = expectRejected(loadBackground(makeFile('notes.txt', 'hello')));
    expect(rejected.detail).toContain('not a supported picture');
  });

  it('refuses a background too large to hold in memory', () => {
    const file = makeFile('huge.gif', '');
    truncateSync(file, MAX_BACKGROUND_BYTES + 1);
    expect(expectRejected(loadBackground(file)).detail).toContain('25 MB');
  });
});

describe('loadStoredBackground', () => {
  it('returns null when no background is persisted', async () => {
    await expect(loadStoredBackground(null)).resolves.toBeNull();
    await expect(loadStoredBackground('')).resolves.toBeNull();
  });

  it('re-checks the stored path so a moved file is reported, not silently blank', async () => {
    const result = await loadStoredBackground(path.join(dir, 'was-here.gif'));
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.ok).toBe(false);
    expect(result.image.broken).toBe(true);
  });
});
