import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { bridge, hasNativeWebviews } from '../bridge';
import { BLANK, faviconUrl, hostOf, normalizeUrl, SEARCH } from '../browserUrl';

/**
 * Embedded browser.
 *
 * The page itself is not rendered here. Each tab is a native WebContentsView owned by
 * the main process (app/main/browserView.ts); this component only draws the chrome and
 * reports the rectangle reserved for the page. That keeps a page's DOM, its session and
 * its navigation history completely out of the renderer, and avoids the deprecated
 * <webview> tag's focus and stacking problems.
 *
 * Only the active tab's view is on screen; the rest stay alive in state and reload from
 * the persisted session on restart, so a dozen tabs are not a dozen painted surfaces.
 */

const HOME = 'https://www.google.com/';
const SESSION_KEY = 'vcmb:browser:session:v1';
const MAX_SESSIONS = 12;

const QUICK_LINKS: Array<{ label: string; url: string; tint: string }> = [
  { label: 'YouTube', url: 'https://www.youtube.com/', tint: '#ff4d4f' },
  { label: 'Twitch', url: 'https://www.twitch.tv/', tint: '#9147ff' },
  { label: 'Reddit', url: 'https://www.reddit.com/', tint: '#ff7043' },
  { label: 'GitHub', url: 'https://github.com/', tint: '#8b95a8' },
  { label: 'VRChat', url: 'https://vrchat.com/', tint: '#1f9cf0' },
  { label: 'VRChat Wiki', url: 'https://vrchat.wiki/', tint: '#5ae0b0' },
  { label: 'booth.pm', url: 'https://booth.pm/', tint: '#ff7ab6' },
  { label: 'VRM models', url: 'https://vrmstore.io/avatars', tint: '#b5a3ff' }
];

interface Tab {
  id: string;
  url: string;
  title: string;
  crashed: boolean;
}

/** Events pushed from main for a specific tab. */
interface BrowserEvent {
  id?: string;
  type?: string;
  url?: string;
  title?: string;
  canBack?: boolean;
  canForward?: boolean;
  loading?: boolean;
  active?: number;
  total?: number;
  detail?: string;
}

function readSession(): Tab[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '[]') as Array<Partial<Tab>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => typeof t.url === 'string')
      .slice(0, MAX_SESSIONS)
      .map((t, i) => ({
        id: typeof t.id === 'string' ? t.id : `restored-${i}`,
        url: t.url as string,
        title: typeof t.title === 'string' ? t.title : '',
        crashed: false
      }));
  } catch {
    return [];
  }
}

let nextId = 0;
const makeTab = (url: string, title = ''): Tab => ({ id: `t${Date.now()}-${nextId++}`, url, title, crashed: false });

export const BrowserPanel: FC = () => {
  const [tabs, setTabs] = useState<Tab[]>([makeTab(HOME, 'New tab')]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id);
  const [address, setAddress] = useState(HOME);
  const [editing, setEditing] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ label: string; sub: string; url: string }>>([]);
  const [zoom, setZoom] = useState(1);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [findHits, setFindHits] = useState<{ active: number; total: number } | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const [nav, setNav] = useState({ canBack: false, canForward: false, loading: false });
  const [dragId, setDragId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(() => tabs.find((t) => t.id === activeId) ?? tabs[0], [tabs, activeId]);
  /** The event listener below subscribes once, so it reads the live tab id from a ref. */
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // Restore the previous session once, on mount.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = readSession();
    if (saved.length === 0) return;
    setTabs(saved);
    setActiveId(saved[0].id);
    setAddress(saved[0].url);
  }, []);

  // Persist as soon as the tab list settles, not on every keystroke.
  useEffect(() => {
    if (!restored.current) return;
    const payload = tabs.filter((t) => t.url && t.url !== HOME).map(({ id, url, title }) => ({ id, url, title }));
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } catch {
      /* storage full or blocked — session restore is a convenience, not a requirement */
    }
  }, [tabs]);

  const patch = useCallback((id: string, changes: Partial<Tab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)));
  }, []);

  // Reconcile the native views whenever the set of tabs, their URLs, or which one is
  // showing changes. Titles stream in from events, so they deliberately do not trigger this.
  const tabSignature = `${tabs.map((t) => `${t.id}:${t.url}`).join('|')}::${activeId}::${active.crashed ? 'crashed' : 'live'}`;
  useEffect(() => {
    void bridge.op('browser:sync', JSON.stringify({ tabs: tabs.map(({ id, url }) => ({ id, url })), activeId }));
    // tabSignature is the deliberate dependency; tabs/activeId are read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabSignature]);

  // Hand main the rectangle to paint the page into. Everything that can move the stage —
  // a window resize, a tab switch, or the workspace scrolling — funnels through here.
  const lastBounds = useRef('');
  const pushBounds = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rounded = { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
    const serialised = JSON.stringify(rounded);
    if (serialised === lastBounds.current) return;
    lastBounds.current = serialised;
    void bridge.op('browser:bounds', serialised);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let frame = 0;
    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        pushBounds();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    window.addEventListener('resize', schedule);
    // Capture phase: the workspace is its own scroll container, not the document.
    document.addEventListener('scroll', schedule, true);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
    };
  }, [pushBounds, tabSignature]);

  // State for every tab arrives on one channel from main.
  useEffect(() => {
    return bridge.on((method, params) => {
      if (method !== 'browser') return;
      const event = params as BrowserEvent;
      const id = event.id;
      if (!id) return;
      switch (event.type) {
        case 'state': {
          setNav({ canBack: event.canBack === true, canForward: event.canForward === true, loading: event.loading === true });
          patch(id, { url: event.url ?? '', title: event.title ?? '', crashed: false });
          if (id === activeIdRef.current) setAddress(event.url ?? '');
          break;
        }
        case 'title':
          patch(id, { title: event.title ?? '' });
          break;
        case 'found':
          setFindHits({ active: event.active ?? 0, total: event.total ?? 0 });
          break;
        case 'fail':
        case 'gone':
          patch(id, { crashed: true });
          break;
        default:
          break;
      }
    });
  }, [patch]);

  // The native view paints above the app, so it must go away with this component.
  useEffect(() => {
    return () => {
      void bridge.op('browser:hide');
    };
  }, []);

  const navigate = useCallback(
    (input: string, id = activeId) => {
      // An empty omnibox goes to the start page rather than searching for nothing.
      const url = normalizeUrl(input) ?? BLANK;
      patch(id, { url, crashed: false });
      setAddress(url === BLANK ? '' : url);
      setVisited((prev) => (url === BLANK ? prev : [url, ...prev.filter((u) => u !== url)].slice(0, 50)));
      void bridge.op('browser:navigate', JSON.stringify({ id, url }));
    },
    [activeId, patch]
  );

  const act = (action: 'back' | 'forward' | 'reload' | 'stop') => {
    void bridge.op('browser:action', JSON.stringify({ id: activeId, action }));
  };

  const addTab = (url = HOME, activate = true) => {
    const tab = makeTab(url);
    setTabs((prev) => [...prev, tab]);
    if (activate) {
      setActiveId(tab.id);
      setAddress(tab.url);
      setEditing(true);
    }
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      if (prev.length === 1) {
        const fresh = makeTab(HOME, 'New tab');
        setActiveId(fresh.id);
        setAddress(HOME);
        return [fresh];
      }
      const next = prev.filter((t) => t.id !== id);
      if (id === activeId) {
        const fallback = next[Math.max(0, prev.findIndex((t) => t.id === id) - 1)] ?? next[0];
        setActiveId(fallback.id);
        setAddress(fallback.url);
      }
      return next;
    });
  };

  // Omnibox: history first, then quick links, then a Google search fallback.
  const suggest = (query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setSuggestions(QUICK_LINKS.map((l) => ({ label: l.label, sub: hostOf(l.url), url: l.url })));
      return;
    }
    const out: Array<{ label: string; sub: string; url: string }> = [];
    for (const url of visited) {
      if (hostOf(url).includes(q) || url.toLowerCase().includes(q)) {
        out.push({ label: url, sub: 'Visited', url });
      }
      if (out.length >= 4) break;
    }
    for (const link of QUICK_LINKS) {
      if (link.label.toLowerCase().includes(q)) out.push({ label: link.label, sub: hostOf(link.url), url: link.url });
      if (out.length >= 8) break;
    }
    out.push({ label: query, sub: 'Search with Google', url: SEARCH + encodeURIComponent(query) });
    setSuggestions(out);
  };

  const applyZoom = (next: number) => {
    const clamped = Math.min(3, Math.max(0.5, Number(next.toFixed(2))));
    setZoom(clamped);
    void bridge.op('browser:zoom', JSON.stringify({ id: activeId, factor: clamped }));
  };

  const runFind = (forward: boolean) => {
    if (!findText.trim()) return;
    void bridge.op('browser:find', JSON.stringify({ id: activeId, text: findText, forward, findNext: forward }));
  };

  const stopFind = () => {
    setFindHits(null);
    void bridge.op('browser:findStop', JSON.stringify({ id: activeId, action: 'clearSelection' }));
  };

  if (!hasNativeWebviews) {
    return (
      <div className="browser-root">
        <div className="card">
          <h2>The browser needs the desktop app</h2>
          <p className="sub">
            Embedded web pages are a native Electron feature, so this browser tab only works in the
            Windows app. Use these links to open official sites in your browser instead.
          </p>
          <div className="gamer-quick-grid">{QUICK_LINKS.map((link) => <button key={link.url} onClick={() => void bridge.op('openExternal', link.url)}>{link.label} ↗</button>)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="browser-root">
      <div className="browser-chrome">
        <div className="browser-tabstrip">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`browser-tab ${tab.id === activeId ? 'is-active' : ''}`}
              draggable
              onDragStart={() => setDragId(tab.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!dragId || dragId === tab.id) return;
                setTabs((prev) => {
                  const next = [...prev];
                  const from = next.findIndex((t) => t.id === dragId);
                  const to = next.findIndex((t) => t.id === tab.id);
                  if (from < 0 || to < 0) return prev;
                  next.splice(to, 0, next.splice(from, 1)[0]);
                  return next;
                });
                setDragId(null);
              }}
              onClick={() => {
                setActiveId(tab.id);
                setAddress(tab.url);
              }}
              title={tab.title || tab.url}
            >
              {faviconUrl(tab.url) ? <img className="browser-tab-favicon" src={faviconUrl(tab.url)} alt="" /> : null}
              <span className="browser-tab-title">{tab.title || hostOf(tab.url) || 'New tab'}</span>
              <button
                type="button"
                className="browser-tab-close"
                aria-label={`Close ${tab.title || 'tab'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="browser-newtab" onClick={() => addTab()} aria-label="New tab">
            +
          </button>
        </div>

        <div className="browser-nav">
          <button type="button" onClick={() => act('back')} disabled={!nav.canBack} aria-label="Back">‹</button>
          <button type="button" onClick={() => act('forward')} disabled={!nav.canForward} aria-label="Forward">›</button>
          <button
            type="button"
            onClick={() => act(nav.loading ? 'stop' : 'reload')}
            aria-label={nav.loading ? 'Stop' : 'Reload'}
          >
            {nav.loading ? '×' : '↻'}
          </button>
          <button type="button" onClick={() => navigate(HOME)} aria-label="Home">⌂</button>

          <div className="browser-address">
            <input
              value={address}
              placeholder="Search or enter address"
              spellCheck={false}
              onFocus={() => {
                setEditing(true);
                suggest('');
              }}
              onBlur={() => window.setTimeout(() => setEditing(false), 150)}
              onChange={(e) => {
                setAddress(e.target.value);
                if (editing) suggest(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  navigate(address);
                  setEditing(false);
                }
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            {editing && suggestions.length > 0 ? (
              <ul className="browser-omni">
                {suggestions.map((s, i) => (
                  <li key={`${s.url}-${i}`}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => navigate(s.url)}>
                      <b>{s.label}</b>
                      <span>{s.sub}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="browser-zoom">
            <button type="button" onClick={() => applyZoom(zoom - 0.1)} aria-label="Zoom out">−</button>
            <button type="button" className="browser-zoom-value" onClick={() => applyZoom(1)} title="Reset zoom">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => applyZoom(zoom + 0.1)} aria-label="Zoom in">+</button>
          </div>
          <button
            type="button"
            className={findOpen ? 'is-on' : ''}
            onClick={() => {
              setFindOpen((v) => !v);
              stopFind();
            }}
            aria-label="Find in page"
          >
            ⌕
          </button>
        </div>

        {findOpen ? (
          <div className="browser-find">
            <input
              value={findText}
              placeholder="Find in page"
              autoFocus
              onChange={(e) => setFindText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runFind(!e.shiftKey);
                if (e.key === 'Escape') {
                  setFindOpen(false);
                  stopFind();
                }
              }}
            />
            <button type="button" onClick={() => runFind(false)}>↑</button>
            <button type="button" onClick={() => runFind(true)}>↓</button>
            {findHits ? (
              <span className="browser-find-count">
                {findHits.total === 0 ? 'No results' : `${findHits.active}/${findHits.total}`}
              </span>
            ) : null}
            <button type="button" onClick={() => setFindOpen(false)}>Done</button>
          </div>
        ) : null}
      </div>

      {active.crashed ? (
        <div className="browser-stage">
          <div className="browser-crash">
            <h2>This page stopped responding</h2>
            <p>{hostOf(active.url)} crashed. Reloading usually fixes it.</p>
            <button
              type="button"
              className="primary"
              onClick={() => {
                patch(active.id, { crashed: false });
                act('reload');
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      ) : (
        /* The native page is drawn by main directly over this reserved rectangle. */
        <div className="browser-stage" ref={stageRef} />
      )}
    </div>
  );
};
