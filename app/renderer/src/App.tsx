import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { bridge, isElectron, type AppState, type BackgroundImage } from './bridge';
import packageInfo from '../../../package.json';
import { Wizard } from './components/Wizard';
import { Dashboard } from './components/Dashboard';
import { SettingsPanel } from './components/SettingsPanel';
import { UpdateBanner } from './components/UpdateBanner';

/** Minimal shape of the Electron <webview> tag we drive from React. */
type DiscordWebview = HTMLElement & { reload: () => void };

/**
 * Full-window picture/GIF painted behind the shell. Sits at z-index -1 so the
 * normal flow (sidebar, topbar, content) still stacks above it untouched.
 */
const BackgroundLayer: FC<{ url: string | null }> = ({ url }) => {
  if (!url) return null;
  return <div className="app-bg" style={{ backgroundImage: `url("${url}")` }} aria-hidden="true" />;
};

/** Official Discord mark, used for the Discord tab. */
const DiscordMark: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3c-.2.36-.43.84-.59 1.226a18.27 18.27 0 0 0-5.487 0A12.64 12.64 0 0 0 9.21 3a19.74 19.74 0 0 0-4.435 1.37C1.98 8.573 1.22 12.63 1.6 16.628a19.9 19.9 0 0 0 6.073 3.056c.49-.667.926-1.374 1.3-2.116a12.9 12.9 0 0 1-2.05-.983c.172-.126.34-.257.5-.392 3.956 1.84 8.25 1.84 12.163 0 .163.14.33.27.5.392a12.8 12.8 0 0 1-2.05.983c.375.742.81 1.45 1.3 2.116a19.87 19.87 0 0 0 6.072-3.056c.44-4.63-.75-8.63-3.085-12.259ZM8.68 14.17c-1.19 0-2.164-1.09-2.164-2.43 0-1.34.956-2.43 2.164-2.43 1.207 0 2.185 1.1 2.164 2.43 0 1.34-.957 2.43-2.164 2.43Zm6.64 0c-1.19 0-2.164-1.09-2.164-2.43 0-1.34.956-2.43 2.164-2.43 1.207 0 2.185 1.1 2.164 2.43 0 1.34-.955 2.43-2.164 2.43Z"
    />
  </svg>
);

/** Microphone glyph for the Live mixer tab. */
const MicrophoneMark: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
    />
  </svg>
);

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
        <BackgroundLayer url={background?.url ?? null} />
        <div className="content">
          <div className="hint">Loading…</div>
        </div>
      </div>
    );
  }

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
        <button type="button" className={`nav-item ${activeView === 'setup' ? 'active' : ''}`} onClick={() => setActiveView('setup')}>
          <span className="nav-icon">⌘</span><span>Setup</span>
          {activeView === 'setup' ? <span className="nav-dot" /> : null}
        </button>
        <button type="button" className={`nav-item ${activeView === 'mixer' ? 'active' : ''}`} onClick={() => setActiveView('mixer')}>
          <span className="nav-icon"><MicrophoneMark /></span><span>Live mixer</span>
          {activeView === 'mixer' ? <span className="nav-dot" /> : null}
        </button>
        <button type="button" className={`nav-item ${activeView === 'discord' ? 'active' : ''}`} onClick={() => setActiveView('discord')}>
          <span className="nav-icon"><DiscordMark /></span><span>Discord</span>
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
            <SettingsPanel background={bgInfo} refreshBackground={refreshBackground} />
          ) : (
            <Wizard state={state} setState={patchState} peaks={peaks} />
          )}
        </div>
      </main>
    </div>
  );
};
