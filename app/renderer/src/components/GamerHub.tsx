import { useEffect, useRef, useState, type FC } from 'react';
import { formatBytesPerSecond } from '@shared/chatboxIntegrations';
import type { PcSnapshot } from '@shared/gaming';
import { bridge } from '../bridge';

const QUICK_ACTIONS = [
  { label: 'VRChat', detail: 'Meet your people', op: 'launchGame', arg: '438100', glyph: '◈' },
  { label: 'SteamVR', detail: 'Wake up your headset', op: 'launchGame', arg: '250820', glyph: '⌁' },
  { label: 'Steam library', detail: 'Your next adventure', op: 'openExternal', arg: 'steam://open/games', glyph: '▶' },
  { label: 'Game Mode', detail: 'Windows gaming settings', op: 'openGameMode', arg: undefined, glyph: '⚙' }
];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
}

interface SessionState { startedAt: number; stoppedAt: number | null; breakMinutes: number }
const SESSION_KEY = 'vcmb:gaming-session:v1';
function readSession(): SessionState | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    return value && Number.isFinite(value.startedAt) && value.startedAt > 0 && (value.stoppedAt === null || Number.isFinite(value.stoppedAt)) && [30, 45, 60, 90].includes(value.breakMinutes) ? value : null;
  } catch { return null; }
}

export const GamerHub: FC = () => {
  const [pc, setPc] = useState<PcSnapshot | null>(null);
  const [rates, setRates] = useState<{ receiveBytesPerSecond: number | null; sendBytesPerSecond: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [session, setSession] = useState<SessionState | null>(readSession);
  const [intervalMinutes, setIntervalMinutes] = useState(45);
  const [now, setNow] = useState(Date.now());
  const [dismissedBreak, setDismissedBreak] = useState(0);
  const alive = useRef(true);
  const pending = useRef(false);

  const refresh = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await bridge.op('pcSnapshot');
      if (!alive.current) return;
      if (!result.ok || !result.pc) throw new Error(result.detail ?? 'PC status is unavailable in this preview.');
      setPc(result.pc);
    } catch (error) {
      if (alive.current) setNote(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 12000);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let stop = false;
    const sample = async () => {
      try {
        const result = await bridge.op('networkRates');
        if (!stop && result.ok) setRates({ receiveBytesPerSecond: result.receiveBytesPerSecond ?? null, sendBytesPerSecond: result.sendBytesPerSecond ?? null });
        else if (!stop) setRates(null);
      } catch { if (!stop) setRates(null); }
    };
    void sample();
    const timer = window.setInterval(() => { if (!document.hidden) void sample(); }, 5000);
    return () => { stop = true; window.clearInterval(timer); };
  }, []);

  const updateSession = (next: SessionState | null) => {
    try {
      if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next)); else localStorage.removeItem(SESSION_KEY);
      setSession(next);
      setDismissedBreak(0);
    } catch (error) { setNote(`Could not save session: ${String(error)}`); }
  };
  const elapsed = session ? Math.max(0, ((session.stoppedAt ?? now) - session.startedAt) / 1000) : 0;
  const breakNumber = session && !session.stoppedAt ? Math.floor(elapsed / (session.breakMinutes * 60)) : 0;
  const breakDue = breakNumber > dismissedBreak;
  const netDown = formatBytesPerSecond(rates?.receiveBytesPerSecond);
  const netUp = formatBytesPerSecond(rates?.sendBytesPerSecond);
  const act = async (op: string, arg?: string) => {
    try {
      const result = await bridge.op(op, arg);
      setNote(result.ok ? 'Opened on your desktop.' : result.detail ?? 'Could not open this action.');
    } catch (error) { setNote(String(error)); }
  };

  return <div className="gamer-hub">
    <div className="gamer-hero">
      <div><span className="section-kicker">YOUR GAMING COMMAND CENTRE</span><h1>Ready for your next <em>session?</em></h1><p>Your games, your headset, your PC. No account required, no background optimiser, no mystery tweaks.</p></div>
      <span className="gamer-hero-orbit" aria-hidden="true">◈</span>
    </div>
    <div className="gamer-quick-grid">{QUICK_ACTIONS.map((action) => <button className="gamer-quick" key={action.label} onClick={() => void act(action.op, action.arg)}><span>{action.glyph}</span><div><b>{action.label}</b><small>{action.detail}</small></div><i>↗</i></button>)}</div>
    {note && <div className="inline-notice" role="status">{note}</div>}
    <div className="section-heading"><div><span className="section-kicker">READ-ONLY PC STATUS</span><h2>Know your rig</h2></div><button className="small" disabled={busy} onClick={() => void refresh()}>{busy ? 'Sampling…' : 'Refresh'}</button></div>
    <div className="gamer-stat-grid">
      <div className="gamer-stat"><span>CPU load</span><strong>{pc?.cpuPercent == null ? '—' : `${Math.round(pc.cpuPercent)}%`}</strong><progress max={100} value={pc?.cpuPercent ?? 0} /><small>{pc ? `${pc.cpuCores} logical cores · ${pc.cpuName}` : 'Waiting for desktop data'}</small></div>
      <div className="gamer-stat"><span>Memory in use</span><strong>{pc ? formatBytes(pc.memoryUsed) : '—'}</strong><progress max={pc?.memoryTotal || 1} value={pc?.memoryUsed ?? 0} /><small>{pc ? `${formatBytes(pc.memoryTotal)} total · system-wide, not just games` : 'No simulated numbers'}</small></div>
      <div className="gamer-stat"><span>System uptime</span><strong>{pc ? `${Math.floor(pc.uptimeSeconds / 3600)}h ${Math.floor(pc.uptimeSeconds / 60) % 60}m` : '—'}</strong><small>{pc?.platform ?? 'Windows desktop required'}</small><small>Sampled {pc ? new Date(pc.sampledAt).toLocaleTimeString() : '—'}</small></div>
      <div className="gamer-stat"><span>Network throughput</span><strong>{netDown || netUp ? `↓ ${netDown || '—'}` : '—'}</strong><small>{netDown || netUp ? `↓ ${netDown || '—'} · ↑ ${netUp || '—'}` : 'Waiting for two samples'}</small><small>Physical adapters only · tunnels excluded</small></div>
    </div>
    <div className="gamer-columns">
      <div className="card"><h2>Gaming apps running</h2><p className="sub">A read-only check of VRChat, Steam, VR, Discord, OBS, Spotify and VoiceMeeter.</p><div className="running-apps">{pc?.running.length ? pc.running.map((app) => <span className="running-app" key={app.pid}><i />{app.name}<small>#{app.pid}</small></span>) : <p className="hint">{pc ? 'None of the recognised gaming apps are running.' : 'Desktop process scan unavailable.'}</p>}</div><div className="divider" /><h2>Storage headroom</h2>{pc?.drives.map((drive) => <div className="drive-row" key={drive.path}><b>{drive.path}</b><progress max={drive.total || 1} value={drive.total - drive.free} /><span className={drive.free / drive.total < .1 ? 'text-warn' : ''}>{formatBytes(drive.free)} free</span></div>)}</div>
      <div className="card session-card"><span className="section-kicker">TAKE CARE OF THE PLAYER</span><h2>Session & water breaks</h2><div className="session-clock">{formatDuration(elapsed)}</div><label className="field-label">Break reminder<select value={intervalMinutes} disabled={!!session && !session.stoppedAt} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>{[30, 45, 60, 90].map((value) => <option value={value} key={value}>Every {value} minutes</option>)}</select></label><div className="row">{!session || session.stoppedAt ? <button className="primary" onClick={() => updateSession({ startedAt: Date.now(), stoppedAt: null, breakMinutes: intervalMinutes })}>Start session</button> : <button onClick={() => updateSession({ ...session, stoppedAt: Date.now() })}>End session</button>}{session && <button className="ghost" onClick={() => updateSession(null)}>Reset</button>}</div>{breakDue && <div className="break-notice" role="status"><b>Time for a quick break</b><p>Drink water, look away from the screen, and stretch. Your next match can wait a minute.</p><button className="small" onClick={() => setDismissedBreak(breakNumber)}>I took a break</button></div>}<p className="hint">Timer survives tab switches and restarts. Reminders appear here; no notification permissions needed.</p></div>
    </div>
  </div>;
};
