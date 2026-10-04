import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { bridge, type AppState } from './bridge';
import packageInfo from '../../../package.json';
import { Wizard } from './components/Wizard';
import { Dashboard } from './components/Dashboard';

export const App: FC = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [activeView, setActiveView] = useState<'setup' | 'mixer'>('setup');
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
    <div className="app-shell">
      <aside className="sidebar">
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
        <div className="sidebar-spacer" />
        <div className="sidebar-help">
          <div className="help-orb">i</div>
          <div><b>No aux cable needed</b><span>All audio stays on this PC.</span></div>
        </div>
        <div className="sidebar-footer">VRCHAT MUSIC BRIDGE <span>v{packageInfo.version} · WINDOWS</span></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-context"><span>YOUR AUDIO</span><span className="crumb-slash">/</span><b>{activeView === 'mixer' ? 'Live mixer' : 'Setup'}</b></div>
          <div className="health-group">
            <span className={`health-chip ${vmRunning ? 'is-ok' : vmRunning === false ? 'is-off' : ''}`}>
              <i /> VoiceMeeter {vmRunning === null ? 'checking' : vmRunning ? 'online' : 'offline'}
            </span>
            <span className={`health-chip ${sidecarUp ? 'is-ok' : 'is-off'}`}>
              <i /> Audio engine {sidecarUp ? 'ready' : 'offline'}
            </span>
          </div>
        </header>
        <div className="content">
          {activeView === 'mixer' ? (
            <Dashboard state={state} setState={patchState} peaks={peaks} />
          ) : (
            <Wizard state={state} setState={patchState} peaks={peaks} />
          )}
        </div>
      </main>
    </div>
  );
};
