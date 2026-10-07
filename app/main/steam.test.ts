import { describe, expect, it, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  accountLibrary,
  parseOwnedGamesXml,
  scanSteamLibraryResult,
  installUrl,
  launchUrl,
  libraryApps,
  libraryRoots,
  parseVdf,
  scanSteamGames,
  scanSteamLibrary
} from './steam';

const MANIFEST = `"AppState"
{
	"appid"		"431960"
	"universe"		"1"
	"name"		"Team Fortress 2"
	"StateFlags"		"4"
	"installdir"		"Team Fortress 2"
	"LastUpdated"		"1783630791"
	"LastPlayed"		"1700000000"
	"SizeOnDisk"		"19327352845"
	"buildid"		"6500000"
	"InstalledDepots"
	{
		"431961"
		{
			"manifest"		"1234567890123456789"
			"size"		"19327352845"
		}
	}
}
`;

function libraryFoldersVdf(steamPath: string, otherPath: string): string {
  const escape = (p: string) => p.replace(/\\/g, '\\\\');
  return `"libraryfolders"
{
	"0"
	{
		"path"		"${escape(steamPath)}"
		"label"		""
		"contentid"		"4816882806678288127"
		"totalsize"		"0"
		"apps"
		{
			"431960"		"19327352845"
			"1172470"		"10737418240"
			"999999"		"5242880"
		}
	}
	"1"
	{
		"path"		"${escape(otherPath)}"
		"label"		""
		"apps"
		{
			"431960"		"19327352845"
		}
	}
	"contentstatsid"		"-123456789"
}
`;
}

let steamRoot = '';
let secondLibrary = '';
let cacheDir = '';
const scanned = () => scanSteamGames(steamRoot);

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vcmb-steam-'));
  steamRoot = path.join(dir, 'Steam');
  secondLibrary = path.join(dir, 'SteamLibrary');
  cacheDir = path.join(dir, 'cache');
  mkdirSync(path.join(steamRoot, 'steamapps'), { recursive: true });
  mkdirSync(path.join(secondLibrary, 'steamapps'), { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  writeFileSync(
    path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
    libraryFoldersVdf(steamRoot, secondLibrary)
  );
  writeFileSync(path.join(steamRoot, 'steamapps', 'appmanifest_431960.acf'), MANIFEST);
  writeFileSync(
    path.join(secondLibrary, 'steamapps', 'appmanifest_228980.acf'),
    MANIFEST
      .replace('431960', '228980')
      .replace('Team Fortress 2', 'Steamworks Shared')
      .replace('"LastPlayed"\t\t"1700000000"', '"LastPlayed"\t\t"0"')
  );
});

afterAll(() => {
  rmSync(path.dirname(steamRoot), { recursive: true, force: true });
});

describe('parseVdf', () => {
  it('reads quoted keys and values out of an AppState block', () => {
    const parsed = parseVdf(MANIFEST) as { AppState: Record<string, unknown> };
    expect(parsed.AppState.appid).toBe('431960');
    expect(parsed.AppState.name).toBe('Team Fortress 2');
    expect(parsed.AppState.SizeOnDisk).toBe('19327352845');
    expect(parsed.AppState.LastPlayed).toBe('1700000000');
  });

  it('nests blocks', () => {
    const parsed = parseVdf(MANIFEST) as { AppState: { InstalledDepots: Record<string, { size: string }> } };
    expect(parsed.AppState.InstalledDepots['431961'].size).toBe('19327352845');
  });

  it('unescapes doubled backslashes in Windows paths', () => {
    const parsed = parseVdf(
      '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n}\n'
    ) as { libraryfolders: Record<string, { path: string }> };
    expect(parsed.libraryfolders['0'].path).toBe('C:\\Program Files (x86)\\Steam');
  });

  it('survives junk without throwing', () => {
    expect(() => parseVdf('}{ nonsense\n"unclosed')).not.toThrow();
  });
});

describe('libraryRoots', () => {
  it('includes the Steam dir itself and every library in libraryfolders.vdf', () => {
    const roots = libraryRoots(steamRoot);
    expect(roots).toContain(steamRoot);
    expect(roots).toContain(secondLibrary);
  });

  it('skips numeric keys that are not library entries', () => {
    const roots = libraryRoots(steamRoot);
    expect(roots).toHaveLength(2);
  });

  it('falls back to just the Steam dir when the vdf is missing', () => {
    const bare = path.join(path.dirname(steamRoot), 'NoSteam');
    mkdirSync(bare, { recursive: true });
    expect(libraryRoots(bare)).toEqual([bare]);
  });
});

describe('scanSteamGames', () => {
  it('finds installed titles across every library', () => {
    expect(scanned().map((g) => g.id).sort()).toEqual(['228980', '431960']);
  });

  it('builds the install path from the library root and installdir', () => {
    const tf2 = scanned().find((g) => g.id === '431960');
    expect(tf2?.installDir).toBe(path.join(steamRoot, 'steamapps', 'common', 'Team Fortress 2'));
    expect(tf2?.sizeOnDisk).toBe(19327352845);
  });

  it('marks everything it returns as installed', () => {
    expect(scanned().every((g) => g.installed)).toBe(true);
  });

  it('sorts recently played first and never-played last', () => {
    const games = scanned();
    expect(games[0].id).toBe('431960');
    expect(games[1].lastPlayed).toBe(0);
  });

  it('points covers at Steam public CDNs', () => {
    const game = scanned()[0];
    expect(game.coverUrl).toBe('https://steamcdn-a.akamaihd.net/steam/apps/431960/header.jpg');
    expect(game.coverTallUrl).toContain('/steam/apps/431960/');
  });
});

describe('libraryApps', () => {
  it('reads locally registered app ids with their size on disk', () => {
    const apps = libraryApps(steamRoot);
    expect([...apps.keys()].sort()).toEqual(['1172470', '431960', '999999']);
    expect(apps.get('1172470')).toBe(10737418240);
  });

  it('returns nothing when Steam has no libraryfolders.vdf', () => {
    expect(libraryApps(path.join(path.dirname(steamRoot), 'NoSteam')).size).toBe(0);
  });
});

describe('scanSteamLibrary', () => {
  const store = {
    '1172470': { success: true, data: { name: 'Deep Rock Galactic', type: 'game' } },
    '999999': { success: true, data: { name: 'Some DLC Pack', type: 'dlc' } }
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns installed titles plus owned-but-not-installed ones', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const id = new URL(url).searchParams.get('appids') ?? '';
      return { json: async () => ({ [id]: store[id as keyof typeof store] }) };
    });

    const games = await scanSteamLibrary(steamRoot, path.join(cacheDir, 'a.json'));
    expect(games.map((g) => g.id).sort()).toEqual(['1172470', '228980', '431960']);
    expect(games.find((g) => g.id === '1172470')?.name).toBe('Deep Rock Galactic');
    expect(games.find((g) => g.id === '1172470')?.installed).toBe(false);
    expect(games.find((g) => g.id === '1172470')?.installDir).toBe('');
  });

  it('never asks the store about a title that is already installed', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      const id = new URL(url).searchParams.get('appids') ?? '';
      return { json: async () => ({ [id]: store[id as keyof typeof store] }) };
    });

    await scanSteamLibrary(steamRoot, path.join(cacheDir, 'b.json'));
    expect(asked.some((url) => url.includes('431960'))).toBe(false);
  });

  it('drops DLC and tools from the library list', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const id = new URL(url).searchParams.get('appids') ?? '';
      return { json: async () => ({ [id]: store[id as keyof typeof store] }) };
    });

    const games = await scanSteamLibrary(steamRoot, path.join(cacheDir, 'c.json'));
    expect(games.map((g) => g.id)).not.toContain('999999');
  });

  it('reuses the on-disk name cache instead of calling the store again', async () => {
    const cacheFile = path.join(cacheDir, 'reuse.json');
    writeFileSync(
      cacheFile,
      JSON.stringify({
        '1172470': { name: 'Deep Rock Galactic', type: 'game' },
        '999999': { name: 'Some DLC Pack', type: 'dlc' }
      }),
      'utf8'
    );
    const fetchSpy = vi.fn(async () => {
      throw new Error('the store must not be called for a cached title');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const games = await scanSteamLibrary(steamRoot, cacheFile);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(games.find((g) => g.id === '1172470')?.name).toBe('Deep Rock Galactic');
  });

  it('persists newly resolved names for the next scan', async () => {
    const cacheFile = path.join(cacheDir, 'fresh.json');
    vi.stubGlobal('fetch', async (url: string) => {
      const id = new URL(url).searchParams.get('appids') ?? '';
      return { json: async () => ({ [id]: store[id as keyof typeof store] }) };
    });

    await scanSteamLibrary(steamRoot, cacheFile);
    const saved = JSON.parse(readFileSync(cacheFile, 'utf8'));
    expect(saved['1172470'].name).toBe('Deep Rock Galactic');
    expect(saved['999999'].type).toBe('dlc');
  });
});

describe('account ownership discovery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses public owned games, including XML entities and CDATA', () => {
    const games = parseOwnedGamesXml('<games><game><appID>10</appID><name><![CDATA[A & B]]></name></game><game><appID>20</appID><name>C &amp; D</name></game></games>');
    expect(games?.get('10')?.name).toBe('A & B');
    expect(games?.get('20')?.name).toBe('C & D');
    expect(parseOwnedGamesXml('<profile><error>Private</error></profile>')).toBeNull();
    expect(parseOwnedGamesXml('<games/>')?.size).toBe(0);
  });

  it('selects the most recent account and merges public purchases with local games', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vcmb-owned-'));
    try {
      mkdirSync(path.join(root, 'config'), { recursive: true });
      mkdirSync(path.join(root, 'userdata', '2', 'config'), { recursive: true });
      writeFileSync(path.join(root, 'config', 'loginusers.vdf'), '"users" { "76561197960265729" { "MostRecent" "0" "Timestamp" "999" } "76561197960265730" { "MostRecent" "1" "Timestamp" "1" } }');
      writeFileSync(path.join(root, 'userdata', '2', 'config', 'localconfig.vdf'), '"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" { "20" { "LastPlayed" "123" } } } } } }');
      expect(accountLibrary(root).steamId).toBe('76561197960265730');
      expect(accountLibrary(root).apps.get('20')).toBe(123);
      const fetchSpy = vi.fn(async (url: string) => url.includes('steamcommunity')
        ? { ok: true, text: async () => '<games><game><appID>10</appID><name>Never Installed Purchase</name></game></games>' }
        : { json: async () => ({ '20': { success: true, data: { name: 'Local Game', type: 'game' } } }) });
      vi.stubGlobal('fetch', fetchSpy);
      const result = await scanSteamLibraryResult(root);
      expect(result.games.map((g) => g.id).sort()).toEqual(['10', '20']);
      expect(result.detail).toBeUndefined();
      expect(result.games.find((g) => g.id === '10')?.installed).toBe(false);
      expect(fetchSpy.mock.calls.some(([url]) => url.includes('76561197960265730'))).toBe(true);

      vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
      const partial = await scanSteamLibraryResult(root);
      expect(partial.games.map((g) => g.id)).toEqual(['20']);
      expect(partial.detail).toContain('locally known');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not truncate libraries larger than 60 games or hide unresolved titles', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vcmb-large-'));
    try {
      mkdirSync(path.join(root, 'steamapps'), { recursive: true });
      const ids = Array.from({ length: 75 }, (_, i) => String(1000 + i));
      writeFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "0" { "apps" { ${ids.map((id) => `"${id}" "0"`).join(' ')} } } }`);
      const fetchSpy = vi.fn(async (url: string) => {
        const id = new URL(url).searchParams.get('appids') ?? '';
        return { json: async () => ({ [id]: { success: id !== '1074', data: { name: `Game ${id}`, type: 'game' } } }) };
      });
      vi.stubGlobal('fetch', fetchSpy);
      const games = await scanSteamLibrary(root);
      expect(games).toHaveLength(75);
      expect(fetchSpy).toHaveBeenCalledTimes(75);
      expect(games.find((g) => g.id === '1074')?.name).toBe('Steam app 1074');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('launchUrl', () => {
  it('uses Steam run-URI rather than shelling out to an exe', () => {
    expect(launchUrl('431960')).toBe('steam://rungameid/431960');
  });
});

describe('installUrl', () => {
  it('hands an owned title to Steam installer over the URL scheme', () => {
    expect(installUrl('1172470')).toBe('steam://install/1172470');
  });
});