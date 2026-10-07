import { useEffect, useMemo, useState, type FC } from 'react';
import { saveGamerPreferences, useGamerPreferences } from '../gamerStore';
import { bridge, isElectron, type SteamGame } from '../bridge';

export const SteamMark: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
  </svg>
);

const GamesHeading: FC = () => (
  <div className="games-heading">
    <span className="games-steam-mark"><SteamMark /></span>
    <div><span className="section-kicker">STEAM LIBRARY</span><h2>Games</h2></div>
  </div>
);

type Sort = 'recent' | 'name' | 'size';
/** The library filter selects titles not installed on this PC. */
type Filter = 'all' | 'installed' | 'library' | 'favourites';

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

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'library', label: 'Not installed' },
  { id: 'favourites', label: 'Favourites' }
];

/**
 * Games tab — every Steam title this account owns.
 *
 * The main process does all the reading (registry, library folders, manifests,
 * plus a cached store lookup for what is owned but not installed); this only
 * renders.
 */
export const GamesPanel: FC = () => {
  const preferences = useGamerPreferences();
  const [selected, setSelected] = useState<SteamGame | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const savePreferences = (patch: Parameters<typeof saveGamerPreferences>[0]) => {
    try { saveGamerPreferences(patch); } catch (err) { setError(`Could not save preferences: ${String(err)}`); }
  };
  const toggleFavourite = (id: string) => savePreferences({ favouriteGames: preferences.favouriteGames.includes(id) ? preferences.favouriteGames.filter((item) => item !== id) : [...preferences.favouriteGames, id] });
  const [games, setGames] = useState<SteamGame[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('recent');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
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
      setNotice(result.detail ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGames([]);
    } finally {
      setStatus('');
      setBusy(false);
    }
  };

  // Scan once on open; the user can rescan after installing something new.
  useEffect(() => {
    void scan();
  }, []);

  const installed = useMemo(() => (games ?? []).filter((g) => g.installed), [games]);
  const libraryOnly = useMemo(() => (games ?? []).filter((g) => !g.installed), [games]);
  const installedBytes = useMemo(
    () => installed.reduce((sum, g) => sum + g.sizeOnDisk, 0),
    [installed]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = games ?? [];
    if (filter === 'installed') list = list.filter((g) => g.installed);
    if (filter === 'library') list = list.filter((g) => !g.installed);
    if (filter === 'favourites') list = list.filter((g) => preferences.favouriteGames.includes(g.id));
    if (needle) list = list.filter((g) => g.name.toLowerCase().includes(needle));
    return [...list];
  }, [games, filter, query, preferences.favouriteGames]);

  const sorted = useMemo(() => {
    // Library-only titles have no play history, so they sort by name there.
    if (sort === 'name') return visible.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'size') return visible.sort((a, b) => b.sizeOnDisk - a.sizeOnDisk);
    return visible.sort(
      (a, b) => b.lastPlayed - a.lastPlayed || b.sizeOnDisk - a.sizeOnDisk || a.name.localeCompare(b.name)
    );
  }, [visible, sort]);

  const act = async (op: 'launchGame' | 'openGameFolder', id: string, name: string) => {
    setError(null);
    setPending(id);
    try {
      const result = await bridge.op(op, id);
      if (!result.ok) setError(result.detail ?? `Could not ${VERB[op]} ${name}.`);
      else setStatus(op === 'launchGame' ? `Sent ${name} to Steam. Steam will offer installation if needed.` : `Opened ${name} in File Explorer.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  if (!isElectron) {
    return (
      <div className="games-root">
        <div className="section-heading">
          <GamesHeading />
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
        <GamesHeading />
        <div className="games-tools">
          <input
            type="search"
            aria-label="Search your Steam library"
            className="games-search"
            placeholder="Search your library"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />
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
          <button type="button" className="games-rescan" aria-pressed={preferences.compactGames} onClick={() => savePreferences({ compactGames: !preferences.compactGames })}>{preferences.compactGames ? 'Roomy view' : 'Compact view'}</button>
          <button type="button" className="games-rescan" onClick={() => void scan()} disabled={busy}>
            {busy ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
      </div>

      {status ? <div className="games-status" role="status">{status}</div> : null}
      {notice ? <div className="games-status" role="status">{notice}</div> : null}
      {error ? <div className="games-error">{error}</div> : null}

      {games && games.length === 0 && !busy && !error ? (
        <div className="card">
          <h2>No games found</h2>
          <p className="sub">Steam was found, but no titles were available from its library records.</p>
        </div>
      ) : null}

      {games && games.length > 0 ? (
        <>
          <div className="games-summary">
            <b>{installed.length}</b> installed · <b>{libraryOnly.length}</b> other library titles · <b>{formatSize(installedBytes)}</b> on disk
          </div>
          <div className="tabs games-filters">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`tab ${filter === option.id ? 'active' : ''}`}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {visible.length === 0 && games && games.length > 0 ? (
        <div className="card">
          <h2>Nothing here</h2>
          <p className="sub">
            {query.trim()
              ? `No title in your Steam library matches “${query.trim()}”.`
              : 'No titles in this part of your library yet.'}
          </p>
        </div>
      ) : null}

      {selected && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="game-detail card" role="dialog" aria-modal="true" aria-label={selected.name} onKeyDown={(event) => { if (event.key === 'Escape') setSelected(null); }}><div className="section-heading"><h2>{selected.name}</h2><button autoFocus aria-label="Close game details" className="small" onClick={() => setSelected(null)}>×</button></div><p className="hint">Steam app {selected.id} · {selected.installed ? 'Installed' : 'Not installed'}</p><p className="hint">{selected.installDir || 'No install folder yet.'}</p><label className="field-label">Personal notes<textarea rows={5} maxLength={1000} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Controller setup, launch options to remember, friends to play with…" /></label><div className="row"><button className="primary" onClick={() => { savePreferences({ gameNotes: { ...preferences.gameNotes, [selected.id]: noteDraft } }); setSelected(null); }}>Save notes</button><button onClick={() => void bridge.op('openExternal', `https://store.steampowered.com/app/${selected.id}`).then((result) => { if (!result.ok) setError(result.detail ?? 'Could not open Steam store.'); }).catch((error) => setError(String(error)))}>Steam store ↗</button></div><p className="hint">Notes stay on this device. They do not change your game files.</p></section></div>}
      {sorted.length > 0 ? (
        <div className={`games-grid${preferences.compactGames ? ' is-compact' : ''}`}>
          {sorted.map((game) => (
            <article className={`game-card${game.installed ? '' : ' is-library'}`} key={game.id}>
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
                {game.installed ? null : <span className="game-badge">Not installed</span>}
                <button className={`game-favourite${preferences.favouriteGames.includes(game.id) ? ' is-saved' : ''}`} aria-label={`${preferences.favouriteGames.includes(game.id) ? 'Unfavourite' : 'Favourite'} ${game.name}`} aria-pressed={preferences.favouriteGames.includes(game.id)} onClick={() => toggleFavourite(game.id)}>★</button>
              </div>
              <div className="game-copy">
                <b title={game.name}>{game.name}</b>
                <span>
                  {game.installed
                    ? `${formatSize(game.sizeOnDisk)} · ${formatPlayed(game.lastPlayed)}`
                    : `In your Steam library · ${formatSize(game.sizeOnDisk)}`}
                </span>
                <div className="game-actions">
                  <button
                    type="button"
                    className="small primary"
                    disabled={pending !== null}
                    title={game.installed ? `Play ${game.name}` : `Open ${game.name} in Steam to install and play`}
                    onClick={() => void act('launchGame', game.id, game.name)}
                  >
                    Play
                  </button>
                  <button
                    type="button"
                    className="small ghost"
                    disabled={!game.installed || !game.installDir || pending !== null}
                    title={game.installed && game.installDir ? game.installDir : 'Install this game first — no folder exists yet'}
                    onClick={() => void act('openGameFolder', game.id, game.name)}
                  >
                    Folder
                  </button>
                  <button className="small ghost" aria-label={`Details for ${game.name}`} onClick={() => { setSelected(game); setNoteDraft(preferences.gameNotes[game.id] ?? ''); }}>Info</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const VERB: Record<'launchGame' | 'openGameFolder', string> = {
  launchGame: 'start',
  openGameFolder: 'open'
};
