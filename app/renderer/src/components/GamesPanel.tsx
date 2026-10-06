import { useEffect, useMemo, useState, type FC } from 'react';
import { bridge, isElectron, type SteamGame } from '../bridge';

type Sort = 'recent' | 'name' | 'size';

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

function formatPlayed(unixSeconds: number): string {
  if (!unixSeconds) return 'Never played';
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
  if (days <= 0) return 'Played today';
  if (days === 1) return 'Played yesterday';
  if (days < 30) return `Played ${days} days ago`;
  if (days < 365) return `Played ${Math.floor(days / 30)} months ago`;
  return `Played ${Math.floor(days / 365)} years ago`;
}

/** Stable colour per title so a missing cover still looks deliberate. */
function placeholderStyle(name: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return {
    background: `linear-gradient(150deg, hsl(${hue} 42% 26%), hsl(${(hue + 40) % 360} 38% 15%))`
  };
}

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Size' }
];

/**
 * Games tab — the Steam library on this PC. The main process does all the
 * reading (registry, library folders, manifests); this only renders.
 */
export const GamesPanel: FC = () => {
  const [games, setGames] = useState<SteamGame[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<Sort>('recent');
  const [covers, setCovers] = useState<Record<string, 'ok' | 'fail'>>({});

  const scan = async () => {
    setBusy(true);
    setError(null);
    setStatus('Scanning your Steam library…');
    try {
      const result = await bridge.op('scanGames');
      if (!result.ok) {
        setError(result.detail ?? 'Could not read the Steam library.');
        setGames([]);
        return;
      }
      setGames(result.games ?? []);
      setStatus('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGames([]);
    } finally {
      setBusy(false);
    }
  };

  // Scan once on open; the user can rescan after installing something new.
  useEffect(() => {
    void scan();
  }, []);

  const sorted = useMemo(() => {
    const list = [...(games ?? [])];
    if (sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'size') return list.sort((a, b) => b.sizeOnDisk - a.sizeOnDisk);
    return list.sort((a, b) => b.lastPlayed - a.lastPlayed || b.sizeOnDisk - a.sizeOnDisk);
  }, [games, sort]);

  const totalBytes = useMemo(() => (games ?? []).reduce((sum, g) => sum + g.sizeOnDisk, 0), [games]);

  const act = async (op: 'launchGame' | 'openGameFolder', id: string, name: string) => {
    const result = await bridge.op(op, id);
    if (!result.ok) setError(result.detail ?? `Could not ${op === 'launchGame' ? 'start' : 'open'} ${name}.`);
  };

  if (!isElectron) {
    return (
      <div className="games-root">
        <div className="section-heading">
          <div>
            <span className="section-kicker">YOUR LIBRARY</span>
            <h2>Games</h2>
          </div>
        </div>
        <div className="card">
          <h2>Steam lives on your Windows desktop</h2>
          <p className="sub">
            This browser preview can’t read your Steam install. Open the Windows app to scan your
            library and launch games from here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="games-root">
      <div className="section-heading">
        <div>
          <span className="section-kicker">YOUR LIBRARY</span>
          <h2>Games</h2>
        </div>
        <div className="games-tools">
          <div className="tabs games-sorts">
            {SORTS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`tab ${sort === option.id ? 'active' : ''}`}
                onClick={() => setSort(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" className="games-rescan" onClick={() => void scan()} disabled={busy}>
            {busy ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
      </div>

      {status ? <div className="games-status">{status}</div> : null}
      {error ? <div className="games-error">{error}</div> : null}

      {games && games.length === 0 && !busy && !error ? (
        <div className="card">
          <h2>No installed games found</h2>
          <p className="sub">Steam was found, but no installed titles were listed in its manifests.</p>
        </div>
      ) : null}

      {sorted.length > 0 ? (
        <>
          <div className="games-summary">
            <b>{sorted.length}</b> installed · <b>{formatSize(totalBytes)}</b> on disk
          </div>
          <div className="games-grid">
            {sorted.map((game) => (
              <article className="game-card" key={game.id}>
                <div
                  className="game-cover"
                  style={covers[game.id] === 'ok' ? undefined : placeholderStyle(game.name)}
                >
                  {covers[game.id] === 'fail' ? null : (
                    <img
                      src={game.coverUrl}
                      alt=""
                      loading="lazy"
                      onLoad={() => setCovers((prev) => ({ ...prev, [game.id]: 'ok' }))}
                      onError={() => setCovers((prev) => ({ ...prev, [game.id]: 'fail' }))}
                    />
                  )}
                </div>
                <div className="game-copy">
                  <b title={game.name}>{game.name}</b>
                  <span>{formatSize(game.sizeOnDisk)} · {formatPlayed(game.lastPlayed)}</span>
                  <div className="game-actions">
                    <button type="button" className="small primary" onClick={() => void act('launchGame', game.id, game.name)}>
                      Play
                    </button>
                    <button type="button" className="small ghost" onClick={() => void act('openGameFolder', game.id, game.name)}>
                      Folder
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
};