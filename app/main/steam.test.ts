import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { launchUrl, libraryRoots, parseVdf, scanSteamGames } from './steam';

/** Real-shaped AppState block from a Steam appmanifest_*.acf. */
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

/** libraryfolders.vdf mixes numbered entries with non-entry keys like contentid. */
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
		}
	}
	"1"
	{
		"path"		"${escape(otherPath)}"
		"label"		""
	}
	"contentstatsid"		"-123456789"
}
`;
}

let steamRoot = '';
let secondLibrary = '';
/** Scanned lazily — steamRoot only exists once beforeAll has run. */
const scanned = () => scanSteamGames(steamRoot);

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vcmb-steam-'));
  steamRoot = path.join(dir, 'Steam');
  secondLibrary = path.join(dir, 'SteamLibrary');
  mkdirSync(path.join(steamRoot, 'steamapps'), { recursive: true });
  mkdirSync(path.join(secondLibrary, 'steamapps'), { recursive: true });

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

describe('launchUrl', () => {
  it('uses Steam run-URI rather than shelling out to an exe', () => {
    expect(launchUrl('431960')).toBe('steam://rungameid/431960');
  });
});