import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { bridge, type AppState, type BackgroundImage } from './bridge';
import packageInfo from '../../../package.json';
import { UpdateBanner } from './components/UpdateBanner';
import { TABS, type TabId } from './tabs';

/**
 * Full-window picture/GIF painted behind the shell. Sits at z-index -1 so the
 * normal flow (sidebar, topbar, content) still stacks above it untouched.
 */
const BackgroundLayer: FC<{ url: string | null }> = ({ url }) => {
  if (!url) return null;
  return <div className="app-bg" style={{ backgroundImage: `url("${url}")` }} aria-hidden="true" />;
};

export const App: FC = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [activeView, setActiveView] = useState<TabId>('setup');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [sidecarUp, setSidecarUp] = useState(true);
  const [vmRunning, setVmRunning] = useState<boolean | null>(null);
  const [peaks, setPeaks] = useState<Record<string, number>>({});
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;
  const [bgInfo, setBgInfo] = useState<BackgroundImage | null>(null);
  // A background that can't be painted (moved, unsupported) is reported, not shown.
  const background = bgInfo && !bgInfo.broken && bgInfo.url ? bgInfo : null;

  // Custom background comes from the main process (a data URL of the picked
  // file), so re-read it whenever Settings changes the pick.
  const refreshBackground = useMemo(
    () => async () => {
      try {
        const result = await bridge.op('getBackground');
        setBgInfo(result.image ?? null);
      } catch {
        setBgInfo(null);
      }
    },
    []
  );

  useEffect(() => {
    void refreshBackground();
  }, [refreshBackground]);

  // Panels turn translucent only while a background is up (see styles.css).
  useEffect(() => {
    document.documentElement.classList.toggle('has-bg', Boolean(background));
    return () => document.documentElement.classList.remove('has-bg');
  }, [background]);

  // Load persisted state.
  useEffect(() => {
    void bridge.getState().then((saved) => {
      setState(saved);
      setActiveView(saved.setupComplete ? 'mixer' : 'setup');
    });
  }, []);

  // Sidecar events: meters (throttled state writes), health.
  useEffect(() => {
    const flush = window.setTimeout(() => setPeaks({ ...peaksRef.current }), 120);
    const unsub = bridge.on((method, params) => {
      if (method === 'meter.update') {
        const p = params as { endpointId: string; peakDb: number };
        peaksRef.current = { ...peaksRef.current, [p.endpointId]: p.peakDb };
      } else if (method === 'sidecar') {
        const p = params as { up: boolean };
        setSidecarUp(p.up);
      }
    });
    return () => {
      window.clearTimeout(flush);
      unsub();
    };
  }, []);

  // Meter flush loop: batch peak updates at ~8 fps for smooth bars.
  useEffect(() => {
    const id = window.setInterval(() => {
      setPeaks((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(peaksRef.current)) return prev;
        return { ...peaksRef.current };
      });
    }, 130);
    return () => window.clearInterval(id);
  }, []);

  // VoiceMeeter health poll (cheap; keeps the header pill honest).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const s = await bridge
        .call('vm.state')
        .then((r) => r as { running: boolean })
        .catch(() => ({ running: false }));
      if (!stop) setVmRunning(s.running);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 4000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  const patchState = useMemo(
    () => async (patch: Partial<AppState>) => {
      const next = await bridge.setState(patch);
      setState(next);
      if (patch.setupComplete) setActiveView('mixer');
      return next;
    },
    []
  );

  if (!state) {
    return (
      <div className="app">
        <BackgroundLayer url={background?.url ?? null} />
        <div className="content">
          <div className="hint">Loading…</div>
        </div>
      </div>
    );
  }

  const activeTab = TABS.find((tab) => tab.id === activeView) ?? TABS[0];
  const workspaceTabs = TABS.filter((tab) => tab.section === 'workspace');
  const systemTabs = TABS.filter((tab) => tab.section === 'system');

  const navItem = (tab: (typeof TABS)[number]) => (
    <button
      key={tab.id}
      type="button"
      className={`nav-item ${activeView === tab.id ? 'active' : ''}`}
      onClick={() => setActiveView(tab.id)}
    >
      <span className="nav-icon">{tab.icon}</span>
      <span>{tab.label}</span>
      {activeView === tab.id ? <span className="nav-dot" /> : null}
    </button>
  );

  return (
    <div className={`app-shell ${navCollapsed ? 'nav-collapsed' : ''}`}>
      <BackgroundLayer url={background?.url ?? null} />
      <aside className="sidebar">
        <button
          type="button"
          className="nav-toggle"
          onClick={() => setNavCollapsed((v) => !v)}
          title={navCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-label={navCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-expanded={!navCollapsed}
        >
          {navCollapsed ? '›' : '‹'}
        </button>
        <div className="brand-lockup">
          <div className="brand-mark"><span>♫</span></div>
          <div className="brand-name">SOUNDBRIDGE<span>VRCHAT AUDIO</span></div>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        {workspaceTabs.map(navItem)}
        <div className="sidebar-spacer" />
        {systemTabs.map(navItem)}
        <div className="sidebar-help">
          <div className="help-orb">i</div>
          <div><b>No aux cable needed</b><span>All audio stays on this PC.</span></div>
        </div>
        <div className="sidebar-footer">VRCHAT MUSIC BRIDGE <span>v{packageInfo.version} · WINDOWS</span></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-context">
            <span>{activeTab.immersive ? 'YOUR COMMUNITY' : activeTab.id === 'settings' ? 'YOUR APP' : 'YOUR AUDIO'}</span>
            <span className="crumb-slash">/</span>
            <b>{activeTab.label}</b>
          </div>
          <div className="health-group">
            <span className={`health-chip ${vmRunning ? 'is-ok' : vmRunning === false ? 'is-off' : ''}`}>
              <i /> VoiceMeeter {vmRunning === null ? 'checking' : vmRunning ? 'online' : 'offline'}
            </span>
            <span className={`health-chip ${sidecarUp ? 'is-ok' : 'is-off'}`}>
              <i /> Audio engine {sidecarUp ? 'ready' : 'offline'}
            </span>
          </div>
        </header>
        <div className={`content ${activeTab.immersive ? 'content--immersive' : ''}`}>
          <UpdateBanner />
          {activeTab.render({ state, patchState, peaks, background: bgInfo, refreshBackground })}
        </div>
      </main>
    </div>
  );
};