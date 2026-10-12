import { useEffect, useMemo, useRef, useState, type CSSProperties, type FC } from 'react';
import { bridge, isElectron, pickMusicEndpoint, pickMics, pickVmOutput, rpc, safeRpc, type AppState, type AudioEndpointInfo, type AudioSettingsScan, type VoiceMeeterRoutingState } from '../bridge';
import { DEFAULT_MUSIC_BROWSER, MUSIC_BROWSERS, musicBrowser, musicTargetProcess } from '../musicBrowser';
import { applyMusicSend } from '@shared/audioControls';
import { MeterBar } from './MeterBar';
import { AudioBaselineControls } from './AudioBaselineControls';
import { useWindowVisible } from '../useWindowVisible';

interface Props {
  state: AppState;
  setState: (patch: Partial<AppState>) => Promise<AppState>;
  peaks: Record<string, number>;
}

const Toggle: FC<{ label: string; sub?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({
  label,
  sub,
  checked,
  disabled = false,
  onChange
}) => (
  <div className="toggle">
    <div>
      <div className="t-label">{label}</div>
      {sub ? <div className="t-sub">{sub}</div> : null}
    </div>
    <label className="switch">
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  </div>
);

export const Dashboard: FC<Props> = ({ state, setState, peaks }) => {
  const [panel, setPanel] = useState<'home' | 'controls' | 'source' | 'devices' | 'signal'>('home');
  const [eps, setEps] = useState<AudioEndpointInfo[]>([]);
  const [tab, setTab] = useState<'spotify' | 'ytmusic'>(state.activeService ?? 'spotify');
  const [routeOk, setRouteOk] = useState<boolean | null>(null);
  const [routeDetail, setRouteDetail] = useState<string | null>(null);
  const [liveSession, setLiveSession] = useState<boolean | null>(null);
  const [misrouteWarning, setMisrouteWarning] = useState<string | null>(null);
  const [vrchatOk, setVrchatOk] = useState<boolean | null>(null);
  const [volume, setVolume] = useState(state.musicVolumeDb);
  const [musicSendBusy, setMusicSendBusy] = useState(false);
  const [musicSendError, setMusicSendError] = useState('');
  const [selectedMic, setSelectedMic] = useState(state.micEndpointName ?? '');
  const [browserId, setBrowserId] = useState(DEFAULT_MUSIC_BROWSER);
  const [configState, setConfigState] = useState<'checking' | 'ready' | 'error'>('checking');
  const [configDetail, setConfigDetail] = useState('Scanning current audio route…');
  const [routingState, setRoutingState] = useState<VoiceMeeterRoutingState | null>(null);
  const [audioScan, setAudioScan] = useState<AudioSettingsScan | null>(null);
  const [selectedPlaybackName, setSelectedPlaybackName] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [applyingConfig, setApplyingConfig] = useState(false);
  const volCommit = useRef<number | null>(null);
  const deviceTrigger = useRef<HTMLButtonElement>(null);
  const deviceClose = useRef<HTMLButtonElement>(null);
  useEffect(() => { setVolume(state.musicVolumeDb); }, [state.musicVolumeDb]);
  useEffect(() => {
    if (panel !== 'devices') return;
    deviceClose.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPanel('home'); window.setTimeout(() => deviceTrigger.current?.focus(), 0); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [panel]);

  const musicEp = useMemo(() => pickMusicEndpoint(eps), [eps]);
  const musicSourceLabel = tab === 'spotify' ? 'Spotify' : musicBrowser(browserId).label;
  const vmOutput = useMemo(() => pickVmOutput(eps), [eps]);
  const mics = useMemo(() => pickMics(eps), [eps]);
  const micEp = useMemo(
    () => mics.find((m) => m.name === selectedMic) ?? mics.find((m) => m.name === state.micEndpointName) ?? mics.find((m) => m.isDefault) ?? mics[0],
    [mics, selectedMic, state.micEndpointName]
  );

  useEffect(() => {
    if (!selectedMic && micEp) setSelectedMic(micEp.name);
  }, [selectedMic, micEp?.name]);

  const started = useRef<Set<string>>(new Set());
  const windowVisible = useWindowVisible();
  const stopAllMeters = () => {
    for (const id of started.current) void safeRpc('meter.stop', { endpointId: id });
    started.current.clear();
  };
  const startMeter = async (id?: string) => {
    if (!id || started.current.has(id)) return;
    started.current.add(id);
    try {
      await rpc('meter.start', { endpointId: id });
    } catch {
      started.current.delete(id);
    }
  };

  const scanAudio = async () => {
    setScanBusy(true);
    setScanError(null);
    try {
      const [snapshot, endpoints] = await Promise.all([
        safeRpc<AudioSettingsScan>('audio.scanSettings'),
        safeRpc<AudioEndpointInfo[]>('endpoints.list', { force: true })
      ]);
      if (!snapshot) {
        setScanError('Could not read Windows audio settings. No routing changes were made.');
        return null;
      }
      setAudioScan(snapshot);
      if (endpoints) setEps(endpoints);
      setSelectedPlaybackName((previous) => snapshot.physicalPlaybackOutputs.some((output) => output.name === previous)
        ? previous
        : snapshot.physicalPlaybackOutputs.find((output) => output.id === snapshot.defaultPlayback?.id)?.name ??
          snapshot.physicalPlaybackOutputs[0]?.name ?? '');
      return snapshot;
    } catch (error) {
      setScanError((error as Error).message);
      return null;
    } finally {
      setScanBusy(false);
    }
  };

  const applyMixerConfig = async () => {
    if (!audioScan || !selectedPlaybackName) {
      setConfigState('error');
      setConfigDetail('Scan audio settings and choose a local A1 playback output before applying.');
      return;
    }
    setApplyingConfig(true);
    setConfigState('checking');
    setConfigDetail('Rechecking the selected playback output before applying VoiceMeeter routing…');
    try {
      let vm = await rpc<{ installed: boolean; running: boolean }>('vm.state');
      if (!vm.installed) throw new Error('VoiceMeeter is not installed yet. Complete setup first.');
      if (!vm.running) {
        setConfigDetail('Starting VoiceMeeter…');
        await rpc('vm.launch');
        const deadline = Date.now() + 12000;
        do {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          vm = await rpc<{ installed: boolean; running: boolean }>('vm.state');
        } while (!vm.running && Date.now() < deadline);
        if (!vm.running) throw new Error('VoiceMeeter did not start. Open it and try again.');
      }
      const previousScan = audioScan;
      const requestedPlaybackName = selectedPlaybackName;
      const latestScan = await scanAudio();
      if (!latestScan) throw new Error('Audio scan failed; no mixer settings were applied.');
      const playbackOutput = latestScan.physicalPlaybackOutputs.find((device) => device.name === requestedPlaybackName);
      if (!playbackOutput) throw new Error('The selected playback device disappeared or changed. Review the scan and select an active output.');
      if (previousScan.defaultPlayback?.id !== latestScan.defaultPlayback?.id ||
          previousScan.communicationsPlayback?.id !== latestScan.communicationsPlayback?.id ||
          previousScan.defaultMicrophone?.id !== latestScan.defaultMicrophone?.id ||
          previousScan.communicationsMicrophone?.id !== latestScan.communicationsMicrophone?.id) {
        throw new Error('Windows default audio devices changed since the previous scan. Review the new scan and press Apply again.');
      }
      const available = eps;
      const availableMics = pickMics(available);
      const micForConfig = selectedMic || state.micEndpointName || micEp?.name || availableMics.find((endpoint) => endpoint.isDefault)?.name || availableMics[0]?.name;
      const availableMusic = pickMusicEndpoint(available);
      const result = await rpc<{ ok: boolean; steps: { name: string; ok: boolean; detail?: string }[] }>(
        'vm.applyConfig',
        { micEndpointName: micForConfig, speakersEndpointName: playbackOutput.name }
      );
      const routeState = await rpc<VoiceMeeterRoutingState>('vm.routingState');
      setRoutingState(routeState);
      const failed = result.steps.filter((step) => !step.ok);
      if (!result.ok || failed.length || !routeState.ok || !routeState.monitoringOk) {
        const detail = failed.map((step) => step.detail || step.name).join(' · ');
        throw new Error(detail || routeState.monitoringDetail || routeState.detail || 'VoiceMeeter B1/A1 routing is not verified.');
      }
      setConfigState('ready');
      setConfigDetail(`VoiceMeeter ${routeState.kind ?? ''}: music strip ${routeState.musicStrip}, B1 = Bus[${routeState.b1BusIndex}]. Local monitoring target: ${routeState.a1OutputName ?? playbackOutput.name}.`);
      const endpoints = await safeRpc<AudioEndpointInfo[]>('endpoints.list');
      if (endpoints) setEps(endpoints);
      await setState({ micEndpointName: micForConfig ?? null, musicEndpointName: availableMusic?.name ?? null });
    } catch (error) {
      setConfigState('error');
      setConfigDetail((error as Error).message);
      const routeState = await safeRpc<VoiceMeeterRoutingState>('vm.routingState');
      if (routeState) setRoutingState(routeState);
    } finally {
      setApplyingConfig(false);
    }
  };

  useEffect(() => {
    if (!windowVisible) return;
    let stopped = false;
    void (async () => {
      const endpoints = (await safeRpc<AudioEndpointInfo[]>('endpoints.list')) ?? [];
      if (stopped) return;
      setEps(endpoints);
      await scanAudio();
      const routeState = await safeRpc<VoiceMeeterRoutingState>('vm.routingState');
      if (routeState) {
        setRoutingState(routeState);
        setConfigState(routeState.ok && routeState.monitoringOk ? 'ready' : 'error');
        setConfigDetail(routeState.monitoringOk
          ? `Existing VoiceMeeter route detected. Local monitoring uses ${routeState.a1OutputName}.`
          : `${routeState.detail ?? 'VoiceMeeter route detected.'} Local monitoring needs attention: ${routeState.monitoringDetail ?? 'A1 output not verified.'}`);
      } else {
        setConfigState('error');
        setConfigDetail('VoiceMeeter is not responding. Scan devices, then start it before applying the mix.');
      }
    })();
    const id = window.setInterval(() => {
      void safeRpc<AudioEndpointInfo[]>('endpoints.list').then((e) => e && !stopped && setEps(e));
    }, 60000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [windowVisible]);

  useEffect(() => {
    if (!windowVisible) return;
    if (musicEp) void startMeter(musicEp.id);
    if (vmOutput) void startMeter(vmOutput.id);
    if (micEp) void startMeter(micEp.id);
  }, [windowVisible, musicEp?.id, vmOutput?.id, micEp?.id]);

  useEffect(() => {
    if (!windowVisible) stopAllMeters();
  }, [windowVisible]);

  useEffect(() => () => stopAllMeters(), []);

  const liveCheckInFlight = useRef(false);
  const vrchatCheckInFlight = useRef(false);
  const checkLive = async () => {
    if (!musicEp || liveCheckInFlight.current) return;
    liveCheckInFlight.current = true;
    try {
      const proc = musicTargetProcess(tab, browserId);
      const s = await safeRpc<{ pid: number; state: string } | null>('sessions.findByProcess', {
        endpointId: musicEp.id,
        processName: proc
      });
      const active = Boolean(s && s.pid > 0 && s.state === 'active');
      setLiveSession(active);
      if (active) {
        setMisrouteWarning(null);
      } else {
        // Music is not on the VoiceMeeter input: see whether it is playing on another output.
        const otherOutput = eps.find((endpoint) => endpoint.direction === 'render' && endpoint.isDefault && endpoint.id !== musicEp.id);
        const elsewhere = otherOutput
          ? await safeRpc<{ pid: number; state: string } | null>('sessions.findByProcess', { endpointId: otherOutput.id, processName: proc })
          : null;
        setMisrouteWarning(otherOutput && elsewhere && elsewhere.pid > 0 && elsewhere.state === 'active'
          ? `${musicSourceLabel} is playing on ${otherOutput.name}, not the VoiceMeeter music input. Press Connect music to route it.`
          : null);
      }
      if (active && configState === 'ready') {
        setRouteOk(true);
        setRouteDetail(`${musicSourceLabel} audio session is active on the VoiceMeeter music input`);
      }
    } finally {
      liveCheckInFlight.current = false;
    }
  };

  const checkVrchat = async () => {
    if (!vmOutput || vrchatCheckInFlight.current) return;
    vrchatCheckInFlight.current = true;
    try {
      const s = await safeRpc<{ pid: number; state: string } | null>('sessions.findByProcess', {
        endpointId: vmOutput.id,
        processName: 'VRChat'
      });
      setVrchatOk(Boolean(s && s.pid > 0 && s.state === 'active'));
    } finally {
      vrchatCheckInFlight.current = false;
    }
  };

  const sessionsBusy = useRef(false);
  useEffect(() => {
    if (!windowVisible) return;
    const poll = () => {
      if (sessionsBusy.current) return;
      sessionsBusy.current = true;
      void Promise.all([checkLive(), checkVrchat()]).finally(() => {
        sessionsBusy.current = false;
      });
    };
    void poll();
    const id = window.setInterval(() => void poll(), 15000);
    return () => window.clearInterval(id);
  }, [windowVisible, musicEp?.id, vmOutput?.id, tab, browserId]);

  const doRoute = async () => {
    if (!musicEp) {
      setRouteOk(false);
      setRouteDetail('VoiceMeeter virtual input not found. Start/install VoiceMeeter, then refresh devices.');
      return;
    }
    setRouteOk(null);
    setRouteDetail(`Routing ${musicSourceLabel} to VoiceMeeter…`);
    const params = { processName: musicTargetProcess(tab, browserId), endpointName: musicEp.name };
    const r = await safeRpc<{ ok: boolean; method: string; detail?: string }>('route.app', params);
    setRouteOk(r?.ok ?? false);
    setRouteDetail(r?.detail ?? 'call failed');
    void setState({ activeService: tab });
    void checkLive();
  };

  const setVolumeDb = (db: number) => {
    setVolume(db);
    if (volCommit.current) window.clearTimeout(volCommit.current);
    volCommit.current = window.setTimeout(() => {
      void safeRpc('vm.setStripGain', { strip: -1, db });
      void setState({ musicVolumeDb: db });
    }, 120);
  };

  const setMuted = async (muted: boolean) => {
    setMusicSendBusy(true);
    setMusicSendError('');
    try {
      await applyMusicSend(!muted, rpc, setState);
    } catch (error) {
      setMusicSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setMusicSendBusy(false);
    }
  };

  const setDucking = async (enabled: boolean) => {
    await safeRpc('vm.setDucking', { enabled, thresholdDb: -42, reductionDb: 12 });
    await setState({ duckingEnabled: enabled });
  };

  const musicPeak = musicEp ? peaks[musicEp.id] ?? null : null;
  const micPeak = micEp ? peaks[micEp.id] ?? null : null;
  const vmPeak = vmOutput ? peaks[vmOutput.id] ?? null : null;
  const meterRing = (label: string, peakDb: number | null, size: 'core' | 'small') => {
    const level = peakDb === null ? 0 : Math.max(0, Math.min(1, (peakDb + 60) / 60));
    const sweep = `${(level * 270).toFixed(1)}deg`;
    const displayLevel = peakDb !== null && peakDb > -99 ? `${Math.round(level * 100)}%` : '—';
    return <div className={`cockpit-gauge cockpit-gauge-${size}`} style={{ '--sweep': sweep } as CSSProperties} role="img" aria-label={`${label}: ${displayLevel}`}>
      <svg className="hud-rings" viewBox="0 0 200 200" aria-hidden="true"><circle className="hud-orbit" cx="100" cy="100" r="98"/><circle className="hud-inner-orbit" cx="100" cy="100" r="76"/><path className="hud-triangle" d="M100 49 144 125H56Z"/></svg>
      <div className="cockpit-gauge-face"><strong>{displayLevel}</strong><span>{label}</span></div>
    </div>;
  };

  return (
    <div className="dashboard-root">
      <div className="section-heading dashboard-section-heading">
        <h2>{panel === 'home' ? 'ϟ Dashboard' : panel === 'controls' ? 'Music & voice controls' : panel === 'source' ? 'Music source' : panel === 'devices' ? 'Audio devices' : 'Live signal'}</h2>
        {panel !== 'home' ? <button type="button" className="small ghost" onClick={() => setPanel('home')}>← Live</button> : !isElectron ? <span className="neon-tag">DEMO AUDIO</span> : null}
      </div>
      {panel === 'home' && <section className="cockpit" aria-label="Live audio cockpit">
        <div className="cockpit-status">
          <span className={`cockpit-status-dot ${configState === 'ready' ? 'is-ready' : ''}`} />
          <b>{configState === 'ready' ? 'Mixer ready' : 'Mixer needs attention'}</b>
          <span className="cockpit-status-separator">·</span>
          <span>{state.musicMutedToVrchat ? 'Mix off' : 'Mix on'}</span>
          <button type="button" className="cockpit-status-link" ref={deviceTrigger} aria-controls="device-drawer" aria-expanded={false} onClick={() => setPanel('devices')}>Devices <i>↗</i></button>
        </div>

        <div className="cockpit-instruments">
          <div className="cockpit-volume">
            <span className="cockpit-kicker">MUSIC LEVEL</span>
            <div className="cockpit-volume-dial" style={{ '--sweep': `${Math.max(0, Math.min(1, (volume + 40) / 46)) * 270}deg` } as CSSProperties}>
              <div className="cockpit-volume-face"><span>♫</span><strong>{Math.round(Math.max(0, Math.min(1, (volume + 40) / 46)) * 100)}<small>%</small></strong></div>
            </div>
            <input type="range" aria-label="Music volume" disabled={configState !== 'ready'} min={-40} max={6} step={1} value={volume} onChange={(event) => setVolumeDb(Number(event.target.value))} />
          </div>
          <div className="cockpit-center-meter">{meterRing('VRCHAT OUTPUT', vmPeak, 'core')}</div>
          <div className="cockpit-side-meters">
            {meterRing('MUSIC', musicPeak, 'small')}
            {meterRing('VOICE', micPeak, 'small')}
          </div>
        </div>

        <div className="cockpit-lower">
          <div className="cockpit-toggle-cluster">
            <Toggle label="Mix" sub="Send music to VRChat" checked={!state.musicMutedToVrchat} disabled={configState !== 'ready' || musicSendBusy} onChange={(on) => void setMuted(!on)} />
            <Toggle label="Duck" sub="Lower music when you speak" checked={state.duckingEnabled} disabled={configState !== 'ready'} onChange={(on) => void setDucking(on)} />
          </div>
          <div className="cockpit-source">
            <div className="cockpit-source-head"><span className="cockpit-kicker">MUSIC SOURCE</span><button type="button" className="cockpit-text-button" onClick={() => setPanel('source')}>More options ↗</button></div>
            <div className="cockpit-source-tabs" role="group" aria-label="Music source">
              <button type="button" aria-pressed={tab === 'spotify'} onClick={() => { setTab('spotify'); setRouteOk(null); setRouteDetail(null); setLiveSession(null); }}>Spotify</button>
              <button type="button" aria-pressed={tab === 'ytmusic'} onClick={() => { setTab('ytmusic'); setRouteOk(null); setRouteDetail(null); setLiveSession(null); }}>YouTube Music</button>
            </div>
            {tab === 'ytmusic' && <label className="cockpit-browser-label">Browser<select aria-label="YouTube Music browser" value={browserId} onChange={(event) => { setBrowserId(event.target.value); setRouteOk(null); setRouteDetail(null); setLiveSession(null); }}>{MUSIC_BROWSERS.map((browser) => <option key={browser.id} value={browser.id}>{browser.label}</option>)}</select></label>}
            <div className="cockpit-source-actions">
              <button type="button" onClick={() => void bridge.op('openExternal', tab === 'spotify' ? 'spotify:' : 'https://music.youtube.com')}>Open</button>
              <button type="button" className="primary" onClick={() => void doRoute()}>{routeOk ? 'Connected ✓' : 'Connect music'}</button>
              <button type="button" className="cockpit-verify" disabled={!musicEp} onClick={() => void checkLive()}>{liveSession ? 'Signal ✓' : 'Verify'}</button>
            </div>
            {routeDetail && <p className={`cockpit-route-message ${routeOk ? 'is-ok' : routeOk === false ? 'is-error' : ''}`} role={routeOk === false ? 'alert' : 'status'}>{routeDetail}</p>}
            {misrouteWarning && <p className="cockpit-route-message is-error" role="alert">{misrouteWarning}</p>}
          </div>
        </div>
        {musicSendError && <p className="inline-notice" role="alert">{musicSendError}</p>}
      </section>}
      {panel === 'signal' && <div className="meters">
        <MeterBar label="Music" peakDb={musicPeak} />
        <MeterBar label="Voice" peakDb={micPeak} />
        <MeterBar label="VRChat" peakDb={vmPeak} right={vrchatOk === false ? 'VRChat not set' : undefined} />
      </div>}

      {panel === 'devices' && <aside className="device-panel hud-device-drawer" id="device-drawer" aria-label="Devices and routing">
      <div className="hud-drawer-heading"><h2>Devices</h2><button ref={deviceClose} aria-label="Close devices" onClick={() => { setPanel('home'); window.setTimeout(() => deviceTrigger.current?.focus(), 0); }}>×</button></div>
      <div className={`card mixer-config-card ${configState === 'ready' ? 'mixer-config-ready' : configState === 'error' ? 'mixer-config-error' : ''}`}>
        <div className="mixer-config-copy">
          <span className="section-kicker">VOICE &amp; MUSIC MIX</span>
          <b>{configState === 'ready' ? 'VoiceMeeter is configured' : configState === 'error' ? 'Mixer needs attention' : 'Preparing your mixer'}</b>
          <span>{configDetail}</span>
          {routingState?.running ? <span className={`route-diagnostic ${routingState.ok && routingState.monitoringOk ? 'diag-ok' : 'diag-fail'}`}>{routingState.ok && routingState.monitoringOk ? '✓' : '⚠'} Music → B1 {routingState.musicToB1 ? 'ON' : 'OFF'} · Music → A1 {routingState.musicToA1 ? 'ON' : 'OFF'} · A1 output {routingState.a1OutputName ?? 'not selected'} · B1 bus {routingState.b1BusIndex} {routingState.b1Unmuted ? 'unmuted' : 'MUTED'} · Virtual mic {routingState.virtualMic ?? 'missing'}</span> : null}
        </div>
        {audioScan ? (
          <div className="inline-notice">
            <details><summary>Audio scan details</summary><b>Read-only audio scan · {new Date(audioScan.scannedAt).toLocaleTimeString()}</b><br />
            Windows playback defaults — media: {audioScan.defaultPlayback?.name ?? 'not found'} · calls: {audioScan.communicationsPlayback?.name ?? 'not found'} · console: {audioScan.consolePlayback?.name ?? 'not found'}<br />
            Windows mic defaults — media: {audioScan.defaultMicrophone?.name ?? 'not found'} · calls: {audioScan.communicationsMicrophone?.name ?? 'not found'} · console: {audioScan.consoleMicrophone?.name ?? 'not found'}<br />
            Spotify session: {audioScan.spotifySessions.map((session) => `${session.endpointName} (${session.state})`).join(', ') || 'no audio session detected'} · A1 matches Windows media default: {audioScan.voiceMeeter.a1MatchesWindowsPlaybackDefault ? 'yes' : 'no'}
            </details><div className="row" style={{ marginTop: 10 }}>
              <label htmlFor="dashboard-a1-output"><b>VoiceMeeter A1 (what you hear)</b></label>
              <select id="dashboard-a1-output" value={selectedPlaybackName} onChange={(event) => setSelectedPlaybackName(event.target.value)}>
                {audioScan.physicalPlaybackOutputs.length === 0 ? <option value="">No active physical playback devices</option> : null}
                {audioScan.physicalPlaybackOutputs.map((output) => <option key={output.id} value={output.name}>{output.name}{output.id === audioScan.defaultPlayback?.id ? ' (Windows default)' : ''}</option>)}
              </select>
            </div>
          </div>
        ) : <p className="hint">Scan current audio devices before changing VoiceMeeter routing.</p>}
        {scanError ? <p className="inline-notice">{scanError}</p> : null}
        <div className="mixer-config-actions">
          <select aria-label="VoiceMeeter microphone input" value={micEp?.name ?? ''} onChange={(event) => setSelectedMic(event.target.value)} disabled={mics.length === 0 || applyingConfig}>
            {mics.length === 0 ? <option value="">No microphone detected</option> : null}
            {mics.map((mic) => <option key={mic.id} value={mic.name}>{mic.name}{mic.isDefault ? ' (default)' : ''}</option>)}
          </select>
          <button type="button" className="ghost" onClick={() => void scanAudio()} disabled={applyingConfig || scanBusy}>
            {scanBusy ? 'Scanning…' : 'Rescan audio'}
          </button>
          <button type="button" className={configState === 'ready' ? 'ghost' : 'primary'} onClick={() => void applyMixerConfig()} disabled={applyingConfig || mics.length === 0 || !audioScan || !selectedPlaybackName || scanBusy}>
            {applyingConfig ? 'Applying…' : configState === 'ready' ? 'Apply mix' : 'Apply VoiceMeeter routing'}
          </button>
        </div>
      </div>

      <details className="connection-details"><summary>Save / restore audio</summary><AudioBaselineControls state={state} setState={setState} /></details>
      </aside>}
      {panel === 'source' && <div className="source-panel">
      <div className="tabs" role="tablist" aria-label="Music service">
        <button type="button" role="tab" aria-selected={tab === 'spotify'} className={`tab ${tab === 'spotify' ? 'active' : ''}`} onClick={() => { setTab('spotify'); setRouteOk(null); setRouteDetail(null); setLiveSession(null); }}>
          Spotify
        </button>
        <button type="button" role="tab" aria-selected={tab === 'ytmusic'} className={`tab ${tab === 'ytmusic' ? 'active' : ''}`} onClick={() => { setTab('ytmusic'); setRouteOk(null); setRouteDetail(null); setLiveSession(null); }}>
          YouTube Music
        </button>
      </div>

      {tab === 'spotify' ? (
        <div className="card service-card">
          <h2>♫ Music source</h2>
          <p className="sub">
            Play a track in Spotify, then connect its audio.
          </p>
          <div className="row">
            <button className="primary" onClick={() => void doRoute()}>
              {routeOk ? 'Re-route output' : 'Route Spotify → bridge'}
            </button>
            <button onClick={() => void bridge.op('openExternal', 'spotify:')}>Open Spotify</button>
            <button onClick={() => void bridge.op('openSoundSettings')}>Windows sound settings</button>
            <button className="small ghost" onClick={() => void checkLive()}>
              Verify
            </button>
          </div>
          <details className="connection-details"><summary>Connection status <span>{vrchatOk && liveSession ? 'Active' : 'Check'}</span></summary><div className="steps">
            <div className={`step ${routeOk ? 'ok' : routeOk === false ? 'fail' : 'pending'}`}>
              <span className="icon">{routeOk ? '✓' : routeOk === false ? '✗' : '…'}</span>
              <div className="grow">
                <div>Spotify → VoiceMeeter virtual input</div>
                {routeDetail ? <div className="detail">{routeDetail}</div> : null}
              </div>
            </div>
            <div className={`step ${liveSession ? 'ok' : liveSession === false ? 'pending' : 'pending'}`}>
              <span className="icon">{liveSession ? '✓' : '…'}</span>
              <div className="grow">
                <div>{liveSession ? 'Spotify session active on VoiceMeeter input' : 'Waiting for Spotify on VoiceMeeter input — play a song'}</div>
              </div>
            </div>
            <div className={`step ${vrchatOk ? 'ok' : 'pending'}`}>
              <span className="icon">{vrchatOk ? '✓' : '…'}</span>
              <div className="grow">
                <div>VRChat capture on VoiceMeeter Output</div>
                <div className="detail">
                  {vrchatOk
                    ? 'VRChat has an active capture session on VoiceMeeter Output'
                    : 'Settings ▸ Audio ▸ Input Device ▸ VoiceMeeter Output'}
                </div>
              </div>
            </div>
          </div></details>
        </div>
      ) : (
        <div className="card service-card">
          <h2>YouTube Music</h2>
          <p className="sub">
            Choose your music browser. All its audio is routed—close other noisy tabs.
          </p>
          <div className="row">
            <label htmlFor="dashboard-music-browser"><b>Browser playing YouTube Music</b></label>
            <select
              id="dashboard-music-browser"
              value={browserId}
              onChange={(event) => {
                setBrowserId(event.target.value);
                setRouteOk(null);
                setRouteDetail(null);
                setLiveSession(null);
              }}
            >
              {MUSIC_BROWSERS.map((browser) => <option key={browser.id} value={browser.id}>{browser.label}</option>)}
            </select>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => void doRoute()}>
              {routeOk ? 'Re-route browser' : 'Route browser → bridge'}
            </button>
            <button onClick={() => void bridge.op('openExternal', 'https://music.youtube.com')}>
              Open YouTube Music
            </button>
            <button className="small ghost" onClick={() => void checkLive()}>
              Verify
            </button>
            {routeDetail ? <span className={`pill ${routeOk ? 'ok' : routeOk === false ? 'fail' : ''}`}>{routeDetail}</span> : null}
            {!isElectron ? <span className="pill">Browser preview — mocked routing</span> : null}
          </div>
        </div>
      )}

      </div>}
      {panel === 'controls' && <div className="card quick-controls">
        <h2>ϟ Quick controls</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>Music volume</span>
          <input
            type="range"
            aria-label="Music volume"
            disabled={configState !== 'ready'}
            min={-40}
            max={6}
            step={1}
            value={volume}
            onChange={(e) => setVolumeDb(Number(e.target.value))}
          />
          <span className="pill">{Math.round(Math.max(0, Math.min(1, (volume + 40) / 46)) * 100)}%</span>
        </div>
        <Toggle
          label="Send music to VRChat mic"
          sub="Your voice stays on."
          checked={!state.musicMutedToVrchat}
          disabled={configState !== 'ready' || musicSendBusy}
          onChange={(on) => void setMuted(!on)}
        />
        {musicSendError && <p className="hint text-warn" role="alert">{musicSendError}</p>}
        <Toggle
          label="Duck music when I talk"
          sub="Lower music while you speak."
          checked={state.duckingEnabled}
          disabled={configState !== 'ready'}
          onChange={(v) => void setDucking(v)}
        />
        <div className="divider" />
        <details className="connection-details"><summary>Save / restore audio</summary><AudioBaselineControls state={state} setState={setState} /></details>
        <div className="row">
          <button
            className="small ghost"
            onClick={() => {
              void bridge.op('resetSetup').then(() => bridge.getState().then(() => location.reload()));
            }}
          >
            Run setup again
          </button>

        </div>
      </div>}
    </div>
  );
};
