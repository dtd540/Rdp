
export interface MusicBrowser {
  id: string;
  label: string;
  processName: string;
}

export const MUSIC_BROWSERS: MusicBrowser[] = [
  { id: 'chrome', label: 'Google Chrome', processName: 'chrome' },
  { id: 'edge', label: 'Microsoft Edge', processName: 'msedge' },
  { id: 'firefox', label: 'Firefox', processName: 'firefox' },
  { id: 'brave', label: 'Brave', processName: 'brave' }
];

export const DEFAULT_MUSIC_BROWSER = 'chrome';

export function musicBrowser(id: string): MusicBrowser {
  return MUSIC_BROWSERS.find((browser) => browser.id === id) ?? MUSIC_BROWSERS[0];
}

export function musicTargetProcess(service: 'spotify' | 'ytmusic', browserId: string): string {
  return service === 'spotify' ? 'Spotify' : musicBrowser(browserId).processName;
}
