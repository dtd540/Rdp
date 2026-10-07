import { describe, expect, it } from 'vitest';
import { DEFAULT_MUSIC_BROWSER, MUSIC_BROWSERS, musicBrowser, musicTargetProcess } from './musicBrowser';

describe('music routing target', () => {
  it('routes Spotify to the Spotify app whatever browser is selected', () => {
    for (const browser of MUSIC_BROWSERS) {
      expect(musicTargetProcess('spotify', browser.id)).toBe('Spotify');
    }
    expect(musicTargetProcess('spotify', 'not-a-browser')).toBe('Spotify');
  });

  it('routes YouTube Music to the chosen browser process', () => {
    expect(musicTargetProcess('ytmusic', 'chrome')).toBe('chrome');
    expect(musicTargetProcess('ytmusic', 'edge')).toBe('msedge');
    expect(musicTargetProcess('ytmusic', 'brave')).toBe('brave');
  });

  it('never targets the app itself for YouTube Music', () => {
    expect(musicTargetProcess('ytmusic', DEFAULT_MUSIC_BROWSER)).not.toMatch(/vrchat|music bridge/i);
  });

  it('falls back to the default browser for an unknown id', () => {
    expect(musicBrowser('netscape').processName).toBe('chrome');
    expect(musicTargetProcess('ytmusic', 'netscape')).toBe('chrome');
  });

  it('keeps each browser addressable by a distinct process name', () => {
    const names = MUSIC_BROWSERS.map((browser) => browser.processName);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name, `${name} must be a bare process name`).toBe(name.toLowerCase().replace(/\.exe$/, ''));
    }
  });

  it('has a default that names a real entry', () => {
    expect(MUSIC_BROWSERS.some((browser) => browser.id === DEFAULT_MUSIC_BROWSER)).toBe(true);
  });
});
