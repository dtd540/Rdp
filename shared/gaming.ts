export interface PcSnapshot {
  sampledAt: string;
  cpuName: string;
  cpuCores: number;
  cpuPercent: number | null;
  memoryUsed: number;
  memoryTotal: number;
  uptimeSeconds: number;
  platform: string;
  drives: Array<{ path: string; free: number; total: number }>;
  running: Array<{ name: string; pid: number }>;
}

export interface RecentWorld {
  worldId: string;
  instanceId?: string;
  name: string;
}

export interface WorldBookmark extends RecentWorld {
  id: string;
  url: string;
  savedAt: number;
}

export interface GamerPreferences {
  favouriteGames: string[];
  gameNotes: Record<string, string>;
  worlds: WorldBookmark[];
  chatPresets: string[];
  compactGames: boolean;
  reducedMotion: boolean;
  accent: 'violet' | 'mint' | 'blue';
}

export const WORLD_ID = /^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseWorldLink(input: string): RecentWorld | null {
  const raw = input.trim();
  if (WORLD_ID.test(raw)) return { worldId: raw, name: raw };
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !['vrchat.com', 'www.vrchat.com'].includes(url.hostname) || url.port || url.username || url.password) return null;
    let worldId = '';
    let instanceId: string | undefined;
    if (url.pathname === '/home/launch') {
      worldId = url.searchParams.get('worldId') ?? '';
      instanceId = url.searchParams.get('instanceId') ?? undefined;
    } else {
      worldId = /^\/home\/world\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? '';
    }
    if (!WORLD_ID.test(worldId)) return null;
    if (instanceId && (instanceId.length > 512 || /[\x00-\x20]/.test(instanceId))) return null;
    return { worldId, instanceId, name: worldId };
  } catch {
    return null;
  }
}

export function worldUrl(world: Pick<RecentWorld, 'worldId' | 'instanceId'>): string {
  if (!WORLD_ID.test(world.worldId)) throw new Error('Invalid VRChat world id.');
  if (!world.instanceId) return `https://vrchat.com/home/world/${world.worldId}`;
  const query = new URLSearchParams({ worldId: world.worldId, instanceId: world.instanceId });
  return `https://vrchat.com/home/launch?${query}`;
}

export function validateChatText(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter a chatbox message.');
  if (Array.from(text).length > 144) throw new Error('VRChat chatbox messages are limited to 144 characters.');
  if (text.split('\n').length > 9) throw new Error('VRChat displays at most 9 chatbox lines.');
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text)) throw new Error('Unsupported control character in message.');
  return text;
}

export const DEFAULT_GAMER_PREFERENCES: GamerPreferences = {
  favouriteGames: [], gameNotes: {}, worlds: [],
  chatPresets: ['Hello! Nice to meet you.', 'My microphone is muted — I’m using chatbox.', 'Taking a quick water break. Back soon!'],
  compactGames: false, reducedMotion: false, accent: 'violet'
};

export function normaliseGamerPreferences(raw: unknown): GamerPreferences {
  const source = raw && typeof raw === 'object' ? raw as Partial<GamerPreferences> : {};
  const strings = (value: unknown, limit: number, length: number): string[] => Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length <= length))].slice(0, limit) : [];
  const notes: Record<string, string> = {};
  if (source.gameNotes && typeof source.gameNotes === 'object') {
    for (const [id, note] of Object.entries(source.gameNotes).slice(0, 1000)) {
      if (/^\d{1,12}$/.test(id) && typeof note === 'string') notes[id] = note.slice(0, 1000);
    }
  }
  const worlds: WorldBookmark[] = [];
  if (Array.isArray(source.worlds)) {
    for (const item of source.worlds.slice(0, 100)) {
      if (!item || typeof item !== 'object' || typeof item.url !== 'string') continue;
      const parsed = parseWorldLink(item.url);
      if (!parsed) continue;
      const url = worldUrl(parsed);
      if (worlds.some((w) => w.url === url)) continue;
      worlds.push({ ...parsed, url, id: url, name: typeof item.name === 'string' ? item.name.slice(0, 100) : parsed.name, savedAt: Number.isFinite(item.savedAt) ? item.savedAt : 0 });
    }
  }
  return {
    favouriteGames: strings(source.favouriteGames, 1000, 12).filter((s) => /^\d+$/.test(s)),
    gameNotes: notes, worlds,
    chatPresets: source.chatPresets === undefined ? DEFAULT_GAMER_PREFERENCES.chatPresets : strings(source.chatPresets, 12, 144).filter((text) => {
      try { validateChatText(text); return true; } catch { return false; }
    }),
    compactGames: source.compactGames === true,
    reducedMotion: source.reducedMotion === true,
    accent: source.accent === 'mint' || source.accent === 'blue' ? source.accent : 'violet'
  };
}
