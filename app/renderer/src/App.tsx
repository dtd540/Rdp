import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { bridge, isElectron, type AppState } from './bridge';
import packageInfo from '../../../package.json';
import { Wizard } from './components/Wizard';
import { Dashboard } from './components/Dashboard';
import { SettingsPanel } from './components/SettingsPanel';
import { UpdateBanner } from './components/UpdateBanner';

/** Minimal shape of the Electron <webview> tag we drive from React. */
type DiscordWebview = HTMLElement & { reload: () => void };

const DiscordPanel: FC = () => {
  const webviewRef = useRef<DiscordWebview>(null);
  const [reloading, setReloading] = useState(false);

  const reloadDiscord = () => {
    webviewRef.current?.reload();
    setReloading(true);
    window.setTimeout(() => setReloading(false), 1200);
  };

  return (
    <section className="discord-panel" aria-label="Discord">
      <div className="discord-webview-frame">
        {isElectron ? (
          <>
            <webview
              ref={webviewRef}
              className="discord-webview"
              src="https://discord.com/app"
              partition="persist:discord"
              aria-label="Discord text chat"
            />
            <button
              type="button"
              className={`discord-reload ${reloading ? 'is-reloading' : ''}`}
              onClick={reloadDiscord}
              disabled={reloading}
              title="Reload Discord"
              aria-label="Reload Discord"
            >
              ↻
            </button>
          </>
        ) : (
          <div className="discord-preview-placeholder">
            <div className="discord-preview-icon">D</div>
            <h2>Discord text chat</h2>
            <p>The signed-in Discord webview is available in the Windows desktop app. This browser preview can’t embed Discord.</p>
            <button type="button" className="discord-open-link" onClick={() => void bridge.op('openExternal', 'https://discord.com/app')}>
              Open Discord in browser
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

export const App: FC = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [activeView, setActiveView] = useState<'setup' | 'mixer' | 'discord' | 'settings'>('setup');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [sidecarUp, setSidecarUp] = useState(true);
  const [vmRunning, setVmRunning] = useState<boolean | null>(null);
  const [peaks, setPeaks] = useState<Record<string, number>>({});
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;

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
      } else if (method === 'log') {
        const p = params as { message: string };
        if (/voicemeeter|voiceMeeter/i.test(p.message)) {
          // engine transitions are also polled; nothing to do here
        }
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
      if (patch.setupComplete) setActiveView(patch.setupComplete ? 'mixer' : 'setup');
      return next;
    },
    []
  );

  if (!state) {
    return (
      <div className="app">
        <div className="content">
          <div className="hint">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${navCollapsed ? 'nav-collapsed' : ''}`}>
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
        <button type="button" className={`nav-item ${activeView === 'setup' ? 'active' : ''}`} onClick={() => setActiveView('setup')}>
          <span className="nav-icon">⌘</span><span>Setup</span>
          {activeView === 'setup' ? <span className="nav-dot" /> : null}
        </button>
        <button type="button" className={`nav-item ${activeView === 'mixer' ? 'active' : ''}`} onClick={() => setActiveView('mixer')}>
          <span className="nav-icon">▥</span><span>Live mixer</span>
          {activeView === 'mixer' ? <span className="nav-dot" /> : null}
        </button>
        <button type="button" className={`nav-item ${activeView === 'discord' ? 'active' : ''}`} onClick={() => setActiveView('discord')}>
          <span className="nav-icon">◉</span><span>Discord</span>
          {activeView === 'discord' ? <span className="nav-dot" /> : null}
        </button>
        <div className="sidebar-spacer" />
        <button type="button" className={`nav-item ${activeView === 'settings' ? 'active' : ''}`} onClick={() => setActiveView('settings')}>
          <span className="nav-icon">⚙</span><span>Settings</span>
          {activeView === 'settings' ? <span className="nav-dot" /> : null}
        </button>
        <div className="sidebar-help">
          <div className="help-orb">i</div>
          <div><b>No aux cable needed</b><span>All audio stays on this PC.</span></div>
        </div>
        <div className="sidebar-footer">VRCHAT MUSIC BRIDGE <span>v{packageInfo.version} · WINDOWS</span></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-context">
            <span>{activeView === 'discord' ? 'YOUR COMMUNITY' : activeView === 'settings' ? 'YOUR APP' : 'YOUR AUDIO'}</span>
            <span className="crumb-slash">/</span>
            <b>{activeView === 'mixer' ? 'Live mixer' : activeView === 'discord' ? 'Discord' : activeView === 'settings' ? 'Settings' : 'Setup'}</b>
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
        <div className={`content ${activeView === 'discord' ? 'content--immersive' : ''}`}>
          <UpdateBanner />
          {activeView === 'mixer' ? (
            <Dashboard state={state} setState={patchState} peaks={peaks} />
          ) : activeView === 'discord' ? (
            <DiscordPanel />
          ) : activeView === 'settings' ? (
            <SettingsPanel />
          ) : (
            <Wizard state={state} setState={patchState} peaks={peaks} />
          )}
        </div>
      </main>
    </div>
  );
};
