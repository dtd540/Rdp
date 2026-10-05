import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { bridge, isElectron, pickMusicEndpoint, pickMics, pickVmOutput, rpc, safeRpc, type AppState, type AudioEndpointInfo, type AudioSettingsScan, type VoiceMeeterRoutingState } from '../bridge';
import { MeterBar } from './MeterBar';
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
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  </div>
);

export const Dashboard: FC<Props> = ({ state, setState, peaks }) => {
  const [eps, setEps] = useState<AudioEndpointInfo[]>([]);
  const [tab, setTab] = useState<'spotify' | 'ytmusic'>(state.activeService ?? 'spotify');
  const [routeOk, setRouteOk] = useState<boolean | null>(null);
  const [routeDetail, setRouteDetail] = useState<string | null>(null);
  const [liveSession, setLiveSession] = useState<boolean | null>(null);
  const [vrchatOk, setVrchatOk] = useState<boolean | null>(null);
  const [volume, setVolume] = useState(state.musicVolumeDb);
  const [selectedMic, setSelectedMic] = useState(state.micEndpointName ?? '');
  const [selfName, setSelfName] = useState('app');
  const [configState, setConfigState] = useState<'checking' | 'ready' | 'error'>('checking');
  const [configDetail, setConfigDetail] = useState('Scanning current audio route…');
  const [routingState, setRoutingState] = useState<VoiceMeeterRoutingState | null>(null);
  const [audioScan, setAudioScan] = useState<AudioSettingsScan | null>(null);
  const [selectedPlaybackName, setSelectedPlaybackName] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [applyingConfig, setApplyingConfig] = useState(false);
  const volCommit = useRef<number | null>(null);

  const musicEp = useMemo(() => pickMusicEndpoint(eps), [eps]);
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
      setSelfName((await bridge.selfInfo()).name);
      // Startup scan is read-only: never move A1 or reconfigure audio without an explicit action.
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

  // Release the capture clients when this view goes away or the window is hidden:
  // an open WASAPI client on the microphone is a real, ongoing audio cost.
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
      const proc = tab === 'spotify' ? 'Spotify' : selfName;
      const s = await safeRpc<{ pid: number; state: string } | null>('sessions.findByProcess', {
        endpointId: musicEp.id,
        processName: proc
      });
      const active = Boolean(s && s.pid > 0 && s.state === 'active');
      setLiveSession(active);
      // An active session on the selected VoiceMeeter virtual input confirms the
      // application's audio has arrived at the mixer, even after navigating back
      // to this screen and losing its transient route-button state.
      if (active && configState === 'ready') {
        setRouteOk(true);
        setRouteDetail('Spotify audio session is active on the VoiceMeeter music input');
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

  // Session scans are the most expensive call we make (WASAPI session
  // enumeration can take seconds on machines with many virtual devices), so poll
  // on a slow cadence, never overlap a slow scan with the next tick, and stop
  // entirely while the window is hidden.
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
  }, [windowVisible, musicEp?.id, vmOutput?.id, tab, selfName]);

  const doRoute = async () => {
    if (!musicEp) {
      setRouteOk(false);
      setRouteDetail('VoiceMeeter virtual input not found. Start/install VoiceMeeter, then refresh devices.');
      return;
    }
    setRouteOk(null);
    setRouteDetail('Routing music app to VoiceMeeter…');
    const params =
      tab === 'spotify'
        ? { processName: 'Spotify', endpointName: musicEp.name }
        : { self: true, endpointName: musicEp.name };
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
    await safeRpc('vm.setMusicToVrchat', { on: !muted });
    await setState({ musicMutedToVrchat: muted });
  };

  const setDucking = async (enabled: boolean) => {
    await safeRpc('vm.setDucking', { enabled, thresholdDb: -42, reductionDb: 12 });
    await setState({ duckingEnabled: enabled });
  };

  const musicPeak = musicEp ? peaks[musicEp.id] ?? null : null;
  const micPeak = micEp ? peaks[micEp.id] ?? null : null;
  const vmPeak = vmOutput ? peaks[vmOutput.id] ?? null : null;

  return (
    <div className="dashboard-root">
      <div className="section-heading dashboard-section-heading"><div><span className="section-kicker">MONITOR YOUR CONNECTION</span><h2>Signal &amp; controls</h2></div></div>
      <div className="meters">
        <MeterBar label="♪ Music → VoiceMeeter input" peakDb={musicPeak} />
        <MeterBar label="🎙 Your microphone" peakDb={micPeak} />
        <MeterBar label="B1 virtual mic → VRChat" peakDb={vmPeak} right={vrchatOk === false ? 'VRChat not set' : undefined} />
      </div>

      <div className={`card mixer-config-card ${configState === 'ready' ? 'mixer-config-ready' : configState === 'error' ? 'mixer-config-error' : ''}`}>
        <div className="mixer-config-copy">
          <span className="section-kicker">VOICE &amp; MUSIC MIX</span>
          <b>{configState === 'ready' ? 'VoiceMeeter is configured' : configState === 'error' ? 'Mixer needs attention' : 'Preparing your mixer'}</b>
          <span>{configDetail}</span>
          {routingState?.running ? <span className={`route-diagnostic ${routingState.ok && routingState.monitoringOk ? 'diag-ok' : 'diag-fail'}`}>{routingState.ok && routingState.monitoringOk ? '✓' : '⚠'} Music → B1 {routingState.musicToB1 ? 'ON' : 'OFF'} · Music → A1 {routingState.musicToA1 ? 'ON' : 'OFF'} · A1 output {routingState.a1OutputName ?? 'not selected'} · B1 bus {routingState.b1BusIndex} {routingState.b1Unmuted ? 'unmuted' : 'MUTED'} · Virtual mic {routingState.virtualMic ?? 'missing'}</span> : null}
        </div>
        {audioScan ? (
          <div className="inline-notice">
            <b>Read-only audio scan · {new Date(audioScan.scannedAt).toLocaleTimeString()}</b><br />
            Windows playback defaults — media: {audioScan.defaultPlayback?.name ?? 'not found'} · calls: {audioScan.communicationsPlayback?.name ?? 'not found'} · console: {audioScan.consolePlayback?.name ?? 'not found'}<br />
            Windows mic defaults — media: {audioScan.defaultMicrophone?.name ?? 'not found'} · calls: {audioScan.communicationsMicrophone?.name ?? 'not found'} · console: {audioScan.consoleMicrophone?.name ?? 'not found'}<br />
            Spotify session: {audioScan.spotifySessions.map((session) => `${session.endpointName} (${session.state})`).join(', ') || 'no audio session detected'} · A1 matches Windows media default: {audioScan.voiceMeeter.a1MatchesWindowsPlaybackDefault ? 'yes' : 'no'}
            <div className="row" style={{ marginTop: 10 }}>
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

      <div className="tabs" role="tablist" aria-label="Music service">
        <button type="button" role="tab" aria-selected={tab === 'spotify'} className={`tab ${tab === 'spotify' ? 'active' : ''}`} onClick={() => { setTab('spotify'); setRouteOk(null); setRouteDetail(null); setLiveSession(null); }}>
          Spotify
        </button>
        <button type="button" role="tab" aria-selected={tab === 'ytmusic'} className={`tab ${tab === 'ytmusic' ? 'active' : ''}`} onClick={() => { setTab('ytmusic'); setRouteOk(null); setRouteDetail(null); setLiveSession(null); }}>
          YouTube Music
        </button>
      </div>

      {tab === 'spotify' ? (
        <div className="card">
          <h2>Spotify</h2>
          <p className="sub">
            Music plays in the Spotify desktop app; we route its output into the bridge. Keep Spotify on
            this computer (any account tier).
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
          <div className="steps">
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
          </div>
        </div>
      ) : (
        <div className="card">
          <h2>YouTube Music</h2>
          <p className="sub">
            Sign in to YouTube Music here. Its app audio is routed to the VoiceMeeter music input; only that audio is mixed into the VRChat mic.
          </p>
          <div className="row" style={{ marginBottom: 12 }}>
            <button className="primary" onClick={() => void doRoute()}>
              {routeOk ? 'Re-route this app' : 'Connect YouTube Music → bridge'}
            </button>
            <button className="small ghost" onClick={() => void checkLive()}>
              Verify
            </button>
            {routeDetail ? <span className={`pill ${routeOk ? 'ok' : routeOk === false ? 'fail' : ''}`}>{routeDetail}</span> : null}
            {!isElectron ? <span className="pill">Browser preview — mocked routing</span> : null}
          </div>
          <div className="yt-host">
            {isElectron ? (
              <webview
                src="https://music.youtube.com"
                partition="persist:ytmusic"
                allowpopups
                // eslint-disable-next-line react/no-unknown-property
                useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
              />
            ) : (
              <div className="yt-placeholder">
                <span className="icon">▶</span>
                <div>
                  YouTube Music player lives inside the desktop app.
                  <div className="detail">Browser preview — UI and mock audio stack only.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Controls</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>Music volume</span>
          <input
            type="range"
            disabled={configState !== 'ready'}
            min={-40}
            max={6}
            step={1}
            value={volume}
            onChange={(e) => setVolumeDb(Number(e.target.value))}
          />
          <span className="pill">{volume > 0 ? `+${volume}` : volume} dB</span>
        </div>
        <Toggle
          label="Send music to VRChat mic"
          sub="Off = music only in your ears; your voice still reaches VRChat."
          checked={!state.musicMutedToVrchat}
          disabled={configState !== 'ready'}
          onChange={(on) => void setMuted(!on)}
        />
        <Toggle
          label="Duck music when I talk"
          sub="Music drops 12 dB while your mic hears you speaking."
          checked={state.duckingEnabled}
          disabled={configState !== 'ready'}
          onChange={(v) => void setDucking(v)}
        />
        <div className="divider" />
        <div className="row">
          <button
            className="small ghost"
            onClick={() => {
              void bridge.op('resetSetup').then(() => bridge.getState().then(() => location.reload()));
            }}
          >
            Run setup again
          </button>
          <span className="hint">
            Mic: {state.micEndpointName ?? 'default'} · Music strip: {state.musicEndpointName ?? '?'}
          </span>
        </div>
      </div>
    </div>
  );
};
