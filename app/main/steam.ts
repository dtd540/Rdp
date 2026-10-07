import { execFile } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import type { SteamGame } from '@shared/rpc';

/**
 * Local Steam library.
 *
 * Everything here is read off this PC — the registry for the install path,
 * `libraryfolders.vdf` for extra library roots, and one `appmanifest_*.acf`
 * per installed title. Public Steam Community data fills in uninstalled
 * purchases when visible; private profiles fall back to local account records.
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

/**
 * Apps registered in local library folders, not the account's ownership list.
 * These are only one fallback source; uninstalled purchases are not listed here.
 */
export function libraryApps(steamPath: string): Map<string, number> {
  const apps = new Map<string, number>();
  const vdf = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (!existsSync(vdf)) return apps;

  try {
    const parsed = parseVdf(readFileSync(vdf, 'utf8')) as {
      libraryfolders?: Record<string, { apps?: Record<string, string> } | undefined>;
    };
    for (const entry of Object.values(parsed.libraryfolders ?? {})) {
      for (const [appId, size] of Object.entries(entry?.apps ?? {})) {
        if (!/^\d+$/.test(appId)) continue;
        const bytes = Number(size) || 0;
        // Keep the largest figure — a title can be listed by several libraries.
        if (!apps.has(appId) || bytes > (apps.get(appId) ?? 0)) apps.set(appId, bytes);
      }
    }
  } catch (err) {
    console.error('[steam] could not read library apps:', err);
  }
  return apps;
}

/** Select one Steam account, never merge another user's library into it. */
export function accountLibrary(steamPath: string): { steamId?: string; apps: Map<string, number> } {
  const apps = new Map<string, number>();
  try {
    const parsed = parseVdf(readFileSync(path.join(steamPath, 'config', 'loginusers.vdf'), 'utf8'));
    const users = parsed.users as Record<string, Record<string, string>> | undefined;
    const selected = Object.entries(users ?? {})
      .filter(([id]) => /^\d{17}$/.test(id))
      .sort(([, a], [, b]) => Number(b.MostRecent ?? 0) - Number(a.MostRecent ?? 0) || Number(b.Timestamp ?? 0) - Number(a.Timestamp ?? 0))[0];
    if (!selected) return { apps };
    const steamId = selected[0];
    const accountId = String(BigInt(steamId) - 76561197960265728n);
    try {
      const local = parseVdf(readFileSync(path.join(steamPath, 'userdata', accountId, 'config', 'localconfig.vdf'), 'utf8'));
      const root = local.UserLocalConfigStore as Record<string, unknown> | undefined;
      const software = root?.Software as Record<string, unknown> | undefined;
      const valve = software?.Valve as Record<string, unknown> | undefined;
      const steam = valve?.Steam as Record<string, unknown> | undefined;
      const records = steam?.apps as Record<string, Record<string, string>> | undefined;
      for (const [id, record] of Object.entries(records ?? {})) {
        if (/^[1-9]\d*$/.test(id)) apps.set(id, Number(record.LastPlayed ?? 0) || 0);
      }
    } catch (err) {
      console.warn('[steam] account local cache unavailable:', err);
    }
    return { steamId, apps };
  } catch {
    return { apps };
  }
}

function xmlText(text: string): string {
  return text.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, key: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[key] ?? '');
}

/** Public Steam Community owned-games XML; no API key or login token needed. */
export function parseOwnedGamesXml(xml: string): Map<string, StoreEntry> | null {
  if (!/<games(?:\s[^>]*)?\s*\/>/.test(xml) && !/<games(?:\s[^>]*)?>[\s\S]*<\/games>/.test(xml)) return null;
  const games = new Map<string, StoreEntry>();
  for (const match of xml.matchAll(/<game>([\s\S]*?)<\/game>/g)) {
    const id = /<appID>(\d+)<\/appID>/.exec(match[1])?.[1];
    const name = /<name>([\s\S]*?)<\/name>/.exec(match[1])?.[1];
    if (id && name) games.set(id, { name: xmlText(name), type: 'game' });
  }
  return games;
}

async function publicAccountGames(steamId?: string): Promise<Map<string, StoreEntry> | null> {
  if (!steamId) return null;
  try {
    const response = await fetch(`https://steamcommunity.com/profiles/${steamId}/games?tab=all&xml=1`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return null;
    return parseOwnedGamesXml(await response.text());
  } catch (err) {
    console.warn('[steam] public owned library unavailable:', err);
    return null;
  }
}

/** One name lookup from Valve, cached on disk so a rescan costs nothing. */
interface StoreEntry {
  name: string;
  type: string;
}

type NameCache = Record<string, StoreEntry>;

function readNameCache(file: string | undefined): NameCache {
  if (!file || !existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as NameCache;
  } catch {
    return {};
  }
}

/**
 * Resolve names for library-only titles.
 *
 * Installed titles already carry a name from their manifest, so this only hits
 * the network for what is owned but not installed. Requests are capped and
 * cached, with bounded concurrency rather than truncating large libraries.
 */
async function resolveStoreNames(ids: string[], cacheFile?: string): Promise<NameCache> {
  const cache = readNameCache(cacheFile);
  // An entry without a name is a half-written or stale cache hit — ask again.
  const missing = ids.filter((id) => !cache[id]?.name);
  let dirty = false;
  let next = 0;

  // Resolve every id, with four workers and a bounded wait for each request.
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (next < missing.length) {
      const id = missing[next++];
      try {
        const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}`, {
          headers: { 'user-agent': 'VRChatMusicBridge/1.0' },
          signal: AbortSignal.timeout(8000)
        });
        const body = (await res.json()) as Record<string, { success: boolean; data?: { name?: string; type?: string } }>;
        const entry = body[id];
        if (entry?.success && entry.data?.name) {
          cache[id] = { name: entry.data.name, type: entry.data.type ?? 'game' };
          dirty = true;
        }
      } catch (err) {
        console.error(`[steam] store lookup failed for ${id}:`, err);
      }
    }
  }));

  if (dirty && cacheFile) {
    try {
      writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
    } catch (err) {
      console.error('[steam] could not write the name cache:', err);
    }
  }
  return cache;
}

/**
 * The full picture: everything installed, plus everything else the account
 * owns. Titles Steam reports as DLC or a tool are dropped — this is a games
 * list, not an entitlement dump.
 */
export async function scanSteamLibrary(steamPath: string, cacheFile?: string): Promise<SteamGame[]> {
  return (await scanSteamLibraryResult(steamPath, cacheFile)).games;
}

export async function scanSteamLibraryResult(steamPath: string, cacheFile?: string): Promise<{ games: SteamGame[]; detail?: string }> {
  const installed = scanSteamGames(steamPath);
  const library = libraryApps(steamPath);
  const account = accountLibrary(steamPath);
  for (const id of account.apps.keys()) if (!library.has(id)) library.set(id, 0);
  const owned = await publicAccountGames(account.steamId);
  for (const id of owned?.keys() ?? []) if (!library.has(id)) library.set(id, 0);
  const installedById = new Map(installed.map((game) => [game.id, game]));

  const missingIds = [...library.keys()].filter((id) => !installedById.has(id));
  const names = await resolveStoreNames(missingIds.filter((id) => !owned?.has(id)), cacheFile);

  const libraryOnly: SteamGame[] = [];
  for (const [id, size] of library) {
    if (installedById.has(id)) continue;
    const entry = owned?.get(id) ?? names[id];
    // Known DLC/tools are excluded, but failed lookups must not hide games.
    if (entry?.type && entry.type !== 'game') continue;
    libraryOnly.push({
      id,
      name: entry?.name ?? `Steam app ${id}`,
      installed: false,
      installDir: '',
      sizeOnDisk: size,
      lastPlayed: account.apps.get(id) ?? 0,
      libraryPath: steamPath,
      ...coverUrls(id)
    });
  }

  const all = [...installed, ...libraryOnly];
  return {
    games: all.sort((a, b) => b.lastPlayed - a.lastPlayed || b.sizeOnDisk - a.sizeOnDisk),
    detail: owned ? undefined : 'Showing all locally known Steam titles. The full owned library could not be read; sign into Steam and make your Steam profile and Game details public, then Rescan. Private, hidden, and Family Sharing titles may be absent.'
  };
}
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
      installed: true,
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

/** Hands an owned-but-not-installed title to Steam's own installer. */
export function installUrl(appId: string): string {
  return `steam://install/${appId}`;
}