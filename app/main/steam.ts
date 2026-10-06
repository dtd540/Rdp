import { execFile } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import type { SteamGame } from '@shared/rpc';

/**
 * Local Steam library.
 *
 * Everything here is read off this PC — the registry for the install path,
 * `libraryfolders.vdf` for extra library roots, and one `appmanifest_*.acf`
 * per installed title. No Steam Web API, so no key and nothing leaves the
 * machine.
 */

/** Steam's CDN serves the store art; no auth, no rate limit worth worrying about. */
function coverUrls(appId: string): Pick<SteamGame, 'coverUrl' | 'coverTallUrl'> {
  return {
    coverUrl: `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/header.jpg`,
    coverTallUrl: `https://shared.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`
  };
}

/** `reg query` is the only way to read HKCU without a native dependency. */
function regQuery(key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', key, '/v', value],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve(null);
        // "    SteamPath    REG_SZ    c:/program files (x86)/steam"
        const line = String(stdout)
          .split(/\r?\n/)
          .find((l) => l.trim().toLowerCase().startsWith(value.toLowerCase()));
        const parts = line ? line.trim().split(/\s{2,}/) : [];
        resolve(parts.length >= 3 ? parts[parts.length - 1] : null);
      }
    );
  });
}

type VdfToken = { type: 'open' | 'close' | 'word'; value: string };

/** Split Valve KeyValues text into bare tokens: quoted strings and braces. */
function tokenizeVdf(text: string): VdfToken[] {
  const tokens: VdfToken[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|([{}])|([^\s{}"]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const [, quoted, brace, bare] = match;
    if (brace) {
      tokens.push({ type: brace === '{' ? 'open' : 'close', value: brace });
      continue;
    }
    tokens.push({ type: 'word', value: unescapeVdf(quoted ?? bare) });
  }
  return tokens;
}

/**
 * Tolerant Valve KeyValues reader.
 *
 * The format has no delimiter between a key and its value, so the only thing
 * that distinguishes them is what comes next: a word followed by `{` is a block
 * key, anything else is a value for the key before it.
 */
export function parseVdf(text: string): Record<string, unknown> {
  const tokens = tokenizeVdf(text);
  const root: Record<string, unknown> = {};
  const stack: Record<string, unknown>[] = [root];
  let pendingKey: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === 'open') {
      const child: Record<string, unknown> = {};
      const parent = stack[stack.length - 1];
      if (pendingKey !== null) {
        parent[pendingKey] = child;
        pendingKey = null;
      }
      stack.push(child);
      continue;
    }
    if (token.type === 'close') {
      if (stack.length > 1) stack.pop();
      pendingKey = null;
      continue;
    }
    if (tokens[i + 1]?.type === 'open') {
      pendingKey = token.value;
      continue;
    }
    if (tokens[i + 1]?.type === 'word') {
      // Two words in a row are always a key/value pair — there is no delimiter.
      stack[stack.length - 1][token.value] = tokens[i + 1].value;
      i++;
      continue;
    }
    const parent = stack[stack.length - 1];
    if (pendingKey !== null) {
      parent[pendingKey] = token.value;
      pendingKey = null;
    } else {
      parent[token.value] = '';
    }
  }
  return root;
}

function unescapeVdf(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}

/** Steam path from the registry, with the default install path as a fallback. */
export async function findSteamPath(): Promise<string | null> {
  const fromRegistry = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  const candidates = [
    fromRegistry,
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    path.join(process.env.LOCALAPPDATA ?? '', 'Steam')
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    const dir = path.resolve(candidate);
    if (existsSync(path.join(dir, 'steamapps'))) return dir;
  }
  return null;
}

/** Every library root: the Steam dir itself, plus each entry in libraryfolders.vdf. */
export function libraryRoots(steamPath: string): string[] {
  const roots = new Set<string>([steamPath]);
  const vdf = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (!existsSync(vdf)) return [...roots];

  try {
    const parsed = parseVdf(readFileSync(vdf, 'utf8')) as {
      libraryfolders?: Record<string, { path?: string } | undefined>;
    };
    const folders = parsed.libraryfolders ?? {};
    for (const entry of Object.values(folders)) {
      // Newer files number their entries; skip the numeric size keys.
      if (entry && typeof entry === 'object' && typeof entry.path === 'string') {
        roots.add(path.resolve(entry.path));
      }
    }
  } catch (err) {
    console.error('[steam] could not read libraryfolders.vdf:', err);
  }
  return [...roots];
}

function readManifest(file: string, libraryPath: string): SteamGame | null {
  try {
    const parsed = parseVdf(readFileSync(file, 'utf8')) as {
      AppState?: Record<string, string | undefined>;
    };
    const app = parsed.AppState;
    if (!app) return null;

    const id = String(app.appid ?? '');
    const name = String(app.name ?? '');
    if (!id || !name) return null;

    const installDir = String(app.installdir ?? '');
    return {
      id,
      name,
      installDir: installDir ? path.join(libraryPath, 'steamapps', 'common', installDir) : '',
      sizeOnDisk: Number(app.SizeOnDisk ?? 0) || 0,
      lastPlayed: Number(app.LastPlayed ?? 0) || 0,
      libraryPath,
      ...coverUrls(id)
    };
  } catch (err) {
    console.error(`[steam] bad manifest ${file}:`, err);
    return null;
  }
}

/** Scan every library and return the installed titles, newest-played first. */
export function scanSteamGames(steamPath: string): SteamGame[] {
  const games: SteamGame[] = [];
  const seen = new Set<string>();

  for (const libraryPath of libraryRoots(steamPath)) {
    const steamapps = path.join(libraryPath, 'steamapps');
    if (!existsSync(steamapps)) continue;

    let files: string[];
    try {
      files = readdirSync(steamapps).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch (err) {
      console.error(`[steam] cannot list ${steamapps}:`, err);
      continue;
    }

    for (const file of files) {
      const game = readManifest(path.join(steamapps, file), libraryPath);
      // The same title can appear in more than one library; keep the first.
      if (game && !seen.has(game.id)) {
        seen.add(game.id);
        games.push(game);
      }
    }
  }

  // Never-played titles sort last, then by size so the big ones lead.
  return games.sort((a, b) => b.lastPlayed - a.lastPlayed || b.sizeOnDisk - a.sizeOnDisk);
}

/** Total bytes across a library — cheap because Steam already reports it per title. */
export function totalSize(games: SteamGame[]): number {
  return games.reduce((sum, game) => {
    if (game.sizeOnDisk > 0) return sum + game.sizeOnDisk;
    try {
      return game.installDir ? sum + statSync(game.installDir).size : sum;
    } catch {
      return sum;
    }
  }, 0);
}

/** Steam's URL scheme — no shell argument quoting games can mangle. */
export function launchUrl(appId: string): string {
  return `steam://rungameid/${appId}`;
}