import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { bridge, isElectron, type AppState, type BackgroundImage } from './bridge';
import { saveGamerPreferences } from './gamerStore';
import { TABS, type TabId } from './tabs';
import { UpdateBanner } from './components/UpdateBanner';
import { StartupSplash } from './components/StartupSplash';

export const App: FC = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [activeView, setActiveView] = useState<TabId>('setup');
  const [sidecarUp, setSidecarUp] = useState(true);
  const [vmRunning, setVmRunning] = useState<boolean | null>(null);
  const [peaks, setPeaks] = useState<Record<string, number>>({});
  const [splashOpen, setSplashOpen] = useState(true);
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;
  const dismissSplash = useCallback(() => setSplashOpen(false), []);

  useEffect(() => {
    let mounted = true;
    void bridge.getState().then((saved) => {
      if (!mounted) return;
      setState(saved);
      setActiveView('mixer');
    }).catch((error) => console.error('[audio] could not load saved setup:', error));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const flush = window.setInterval(() => setPeaks({ ...peaksRef.current }), 130);
    const unsubscribe = bridge.on((method, params) => {
      if (method === 'meter.update') {
        const update = params as { endpointId: string; peakDb: number };
        peaksRef.current = { ...peaksRef.current, [update.endpointId]: update.peakDb };
      } else if (method === 'sidecar') {
        setSidecarUp(Boolean((params as { up?: boolean }).up));
      }
    });
    return () => {
      window.clearInterval(flush);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    const checkVoiceMeeter = async () => {
      const result = await bridge.call('vm.state')
        .then((value) => value as { running: boolean })
        .catch(() => ({ running: false }));
      if (!stopped) setVmRunning(result.running);
    };
    void checkVoiceMeeter();
    const timer = window.setInterval(() => void checkVoiceMeeter(), 4000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  const patchState = async (patch: Partial<AppState>): Promise<AppState> => {
    const next = await bridge.setState(patch);
    setState(next);
    if (patch.setupComplete) setActiveView('mixer');
    return next;
  };

  const refreshBackground = async (): Promise<void> => {
    const result = await bridge.op('refreshBackground');
    const imagePath = result.image?.path;
    if (result.ok && typeof imagePath === 'string') {
      setState((prev) => (prev ? { ...prev, backgroundPath: imagePath } : prev));
    }
  };

  const backgroundUrl = ((): string | null => {
    if (!state || !state.backgroundPath) return null;
    if (state.backgroundPath.startsWith('(preview)')) {
      return null;
    }
    if (bridge.isElectron) {
      return `asset:///${state.backgroundPath.replace(/^\/[A-Z]:/i, '').replace(/\\/g, '/')}`;
    }
    return null;
  })();

  const splash = splashOpen ? <StartupSplash onDone={dismissSplash} /> : null;

  if (!state) {
    return (
      <>
        <div className="utility-loading"><span className="brand-mark">♫</span><span>Loading SPOTT…</span></div>
        {splash}
      </>
    );
  }

  const activeTab = TABS.find((tab) => tab.id === activeView) ?? TABS[0];

  return (
    <>
    <div className="app-shell neon-shell mark-shell">
      <aside className="neon-sidebar">
        <div className="brand-lockup">
          {/* Secret: the brand mark is the hidden Settings button. */}
          <button
            type="button"
            className="brand-mark"
            aria-label="Open Settings"
            onClick={() => setActiveView('settings')}
          >
            <svg viewBox="0 0 44 44" fill="none" stroke="currentColor">
              <circle cx="22" cy="22" r="14" strokeWidth="2" />
              <path d="M22 12 31 28H13Z" />
              <circle cx="22" cy="22" r="3" fill="currentColor" />
            </svg>
          </button>
          <div className="brand-name">
            SPOTT<span>EXPERIMENTAL</span>
            <small>VRCHAT AUDIO</small>
          </div>
        </div>
        <nav className="neon-nav" aria-label="Audio tools">
          {TABS.filter((tab) => tab.id !== 'settings').map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`nav-item ${activeView === tab.id ? 'active' : ''}`}
              aria-current={activeView === tab.id ? 'page' : undefined}
              onClick={() => setActiveView(tab.id)}
            >
              <span className="nav-icon">{tab.icon}</span>
              <span>{tab.id === 'mixer' ? 'Live' : 'Setup'}</span>
            </button>
          ))}
        </nav>
        <UpdateBanner />
        <div className="neon-status" aria-label="Audio status">
          <span className={`health-chip ${vmRunning ? 'is-ok' : vmRunning === false ? 'is-off' : ''}`}>
            <i /> <span>VoiceMeeter {vmRunning === null ? 'checking' : vmRunning ? 'ready' : 'offline'}</span>
          </span>
          <span className={`health-chip ${sidecarUp ? 'is-ok' : 'is-off'}`}>
            <i /> <span>Audio {sidecarUp ? 'ready' : 'offline'}</span>
          </span>
        </div>
      </aside>

      <main className="workspace neon-workspace">
        <header className="neon-titlebar">
          <span className="title-icon" aria-hidden="true">{activeTab.icon}</span>
          <h1>{activeTab.label}</h1>
          <span className="neon-tag">{isElectron ? 'EXPERIMENTAL' : 'DEMO AUDIO · MOCK ROUTING'}</span>
        </header>

        {/* Background layer: paints the current wallpaper behind everything. */}
        {backgroundUrl ? (
          <div className="app-background" aria-hidden="true">
            <img
              src={backgroundUrl}
              alt=""
              className="app-background-img"
              loading="lazy"
              onError={(event) => {
                const img = event.currentTarget as HTMLImageElement;
                img.style.display = 'none';
              }}
              onLoad={() => {}}
            />
          </div>
        ) : null}

        <div className="content neon-content">
          <div key={activeView} className="view-transition">
            {activeTab.render({ state, patchState, peaks })}
          </div>
        </div>
      </main>
    </div>
    {splash}
    </>
  );
};

export default App;
