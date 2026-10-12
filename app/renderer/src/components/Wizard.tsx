import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import {
  bridge,
  pickMusicEndpoint,
  pickMics,
  pickVmOutput,
  rpc,
  safeRpc,
  type AppState,
  type AudioEndpointInfo,
  type AudioSettingsScan,
  type VoiceMeeterConfigResult,
  type VoiceMeeterRoutingState,
  type VoiceMeeterState
} from '../bridge';
import { DEFAULT_MUSIC_BROWSER, MUSIC_BROWSERS, musicBrowser, musicTargetProcess } from '../musicBrowser';
import { useWindowVisible } from '../useWindowVisible';
import { AudioBaselineControls } from './AudioBaselineControls';

interface Props {
  state: AppState;
  setState: (patch: Partial<AppState>) => Promise<AppState>;
  peaks: Record<string, number>;
}

export const Wizard: FC<Props> = ({ state, setState, peaks }) => {
  const [step, setStep] = useState(0);
  const [vm, setVm] = useState<VoiceMeeterState | null>(null);
  const [eps, setEps] = useState<AudioEndpointInfo[]>([]);
  const [audioScan, setAudioScan] = useState<AudioSettingsScan | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [selectedPlaybackName, setSelectedPlaybackName] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [micName, setMicName] = useState<string | null>(state.micEndpointName);
  const [applyResult, setApplyResult] = useState<VoiceMeeterConfigResult | null>(null);
  const [routingState, setRoutingState] = useState<VoiceMeeterRoutingState | null>(null);
  const [applying, setApplying] = useState(false);
  const [installDetail, setInstallDetail] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [service, setService] = useState<'spotify' | 'ytmusic'>('spotify');
  const [browserId, setBrowserId] = useState(DEFAULT_MUSIC_BROWSER);

  const [routeResult, setRouteResult] = useState<{ ok: boolean; method: string; detail?: string } | null>(null);
  const [liveSession, setLiveSession] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [vrchatSession, setVrchatSession] = useState<boolean | null>(null);
  const [checkingVrchat, setCheckingVrchat] = useState(false);
  const vrchatCheckInFlight = useRef(false);

  const musicEp = useMemo(() => pickMusicEndpoint(eps), [eps]);
  const musicSourceLabel = service === 'spotify' ? 'Spotify' : musicBrowser(browserId).label;
  const vmOutput = useMemo(() => pickVmOutput(eps), [eps]);
  const mics = useMemo(() => pickMics(eps), [eps]);
  const activeMic = micName ?? mics.find((m) => m.isDefault)?.name ?? mics[0]?.name ?? null;
  const windowVisible = useWindowVisible();

  const refreshEps = async () => setEps((await safeRpc<AudioEndpointInfo[]>('endpoints.list')) ?? []);
  const refreshVm = async () => setVm(await safeRpc<VoiceMeeterState>('vm.state'));
  const scanAudio = async () => {
    setScanBusy(true);
    setScanError(null);
    try {
      const [snapshot, endpoints] = await Promise.all([
        safeRpc<AudioSettingsScan>('audio.scanSettings'),
        safeRpc<AudioEndpointInfo[]>('endpoints.list', { force: true })
      ]);
      if (!snapshot) {
        setScanError('Could not read Windows audio settings. Refresh/restart the app and scan again before applying.');
        return null;
      }
      setAudioScan(snapshot);
      if (endpoints) setEps(endpoints);
      const outputs = snapshot.physicalPlaybackOutputs;
      setSelectedPlaybackName((previous) =>
        outputs.some((output) => output.name === previous)
          ? previous
          : outputs.find((output) => output.id === snapshot.defaultPlayback?.id)?.name ?? outputs[0]?.name ?? ''
      );
      return snapshot;
    } catch (error) {
      setScanError((error as Error).message);
      return null;
    } finally {
      setScanBusy(false);
    }
  };

  useEffect(() => {
    if (!windowVisible) return;
    void refreshEps();
    void refreshVm();
    const idVm = window.setInterval(() => void refreshVm(), 3000);
    const idEps = window.setInterval(() => void refreshEps(), 60000);
    return () => {
      window.clearInterval(idVm);
      window.clearInterval(idEps);
    };
  }, [windowVisible]);

  const started = useRef<Set<string>>(new Set());
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
  useEffect(() => {
    if (!windowVisible) return;
    if (musicEp) void startMeter(musicEp.id);
    if (vmOutput) void startMeter(vmOutput.id);
  }, [windowVisible, musicEp?.id, vmOutput?.id]);

  const activeMicEp = eps.find((e) => e.name === activeMic);
  useEffect(() => {
    if (!windowVisible) return;
    if (activeMicEp) void startMeter(activeMicEp.id);
  }, [windowVisible, activeMicEp?.id]);

  useEffect(() => {
    if (!windowVisible) stopAllMeters();
  }, [windowVisible]);

  useEffect(() => () => stopAllMeters(), []);

  const micPeak = activeMicEp ? peaks[activeMicEp.id] ?? null : null;
  const musicPeak = musicEp ? peaks[musicEp.id] ?? null : null;
  const vmOutPeak = vmOutput ? peaks[vmOutput.id] ?? null : null;

  const bar = (label: string, peak: number | null) => (
    <div className="meter" style={{ marginTop: 10 }}>
      <div className="label">
        <b>{label}</b>
        <span className="value">{peak !== null && peak > -99 ? `${Math.round(Math.max(0, Math.min(100, ((peak + 60) / 60) * 100)))}%` : 'no signal'}</span>
      </div>
      <div className="bar">
        <div
          className="fill"
          style={{
            width:
              peak !== null && peak > -99 ? `${Math.max(0, Math.min(100, ((peak + 60) / 60) * 100))}%` : '0%'
          }}
        />
      </div>
    </div>
  );

  const doInstall = async () => {
    setInstallDetail('working…');
    const r = await bridge.op('installVoiceMeeter');
    setInstallDetail(r.detail ?? r.phase ?? 'done');
    setTimeout(() => void refreshVm(), 2500);
  };

  const doLaunch = async () => {
    setLaunching(true);
    try {
      await rpc('vm.launch');
    } catch (err) {
      setInstallDetail((err as Error).message);
    }
    setLaunching(false);
    void refreshVm();
  };

  const doApply = async () => {
    if (!activeMic || !audioScan || !selectedPlaybackName) return;
    setApplying(true);
    setScanError(null);
    try {
      const previousScan = audioScan;
      const latestScan = await scanAudio();
      if (!latestScan) throw new Error('Audio scan failed; no routing changes were applied.');
      const output = latestScan.physicalPlaybackOutputs.find((device) => device.name === selectedPlaybackName);
      if (!output) throw new Error('The selected playback output changed or disappeared. Review the new scan and select an active output.');
      if (previousScan.defaultPlayback?.id !== latestScan.defaultPlayback?.id ||
          previousScan.communicationsPlayback?.id !== latestScan.communicationsPlayback?.id ||
          previousScan.defaultMicrophone?.id !== latestScan.defaultMicrophone?.id ||
          previousScan.communicationsMicrophone?.id !== latestScan.communicationsMicrophone?.id) {
        throw new Error('Windows default audio devices changed since the previous scan. Review the new scan and press Apply again.');
      }
      const r = await rpc<VoiceMeeterConfigResult>('vm.applyConfig', {
        micEndpointName: activeMic,
        speakersEndpointName: output.name
      });
      setApplyResult(r);
      const route = await safeRpc<VoiceMeeterRoutingState>('vm.routingState');
      setRoutingState(route);
      if (r.ok && route?.running && (!route.ok || !route.monitoringOk)) {
        setApplyResult({
          ok: false,
          steps: [...r.steps, { name: route.monitoringOk ? 'vrchat-output' : 'local-monitoring', ok: false, detail: route.monitoringOk ? route.detail ?? 'VoiceMeeter B1 is not reaching the virtual mic.' : route.monitoringDetail ?? 'VoiceMeeter A1 is not verified for local playback.' }]
        });
      }
      await setState({ micEndpointName: activeMic, musicEndpointName: musicEp?.name ?? null });
      await refreshEps();
    } catch (err) {
      setApplyResult({
        ok: false,
        steps: [{ name: 'apply', ok: false, detail: (err as Error).message }]
      });
    }
    setApplying(false);
  };

  const doRoute = async () => {
    if (!musicEp) {
      setRouteResult({
        ok: false,
        method: 'manual',
        detail: 'VoiceMeeter virtual input is not available. Install/start VoiceMeeter, then refresh audio devices.'
      });
      return;
    }
    setRouteResult(null);
    setLiveSession(null);
    const params = { processName: musicTargetProcess(service, browserId), endpointName: musicEp.name };
    const r = await safeRpc<{ ok: boolean; method: string; detail?: string }>('route.app', params);
    setRouteResult(r ?? { ok: false, method: 'manual', detail: 'sidecar call failed' });
    if (service === 'ytmusic') await setState({ activeService: 'ytmusic' });
  };

  const verifyLive = async () => {
    if (!musicEp) return;
    setVerifying(true);
    setLiveSession(null);
    const procName = musicTargetProcess(service, browserId);
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const s = await safeRpc<{ pid: number; state: string } | null>('sessions.findByProcess', {
        endpointId: musicEp.id,
        processName: procName
      });
      if (s && s.pid > 0 && s.state === 'active') {
        setLiveSession(true);
        setVerifying(false);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setLiveSession(false);
    setVerifying(false);
  };

  const checkVrchat = async () => {
    if (!vmOutput || vrchatCheckInFlight.current) return;
    vrchatCheckInFlight.current = true;
    setCheckingVrchat(true);
    try {
      const s = await safeRpc<{ pid: number; state: string } | null>('sessions.findByProcess', {
        endpointId: vmOutput.id,
        processName: 'VRChat'
      });
      setVrchatSession(Boolean(s && s.pid > 0 && s.state === 'active'));
    } finally {
      vrchatCheckInFlight.current = false;
      setCheckingVrchat(false);
    }
  };
  useEffect(() => {
    if (!windowVisible) return;
    if (vrchatSession === null) void checkVrchat();
    const id = window.setInterval(() => void checkVrchat(), 15000);
    return () => window.clearInterval(id);
  }, [windowVisible, vmOutput?.id]);

  const doFinish = async () => {
    await safeRpc('vm.setDucking', {
      enabled: state.duckingEnabled,
      thresholdDb: -42,
      reductionDb: 12
    });
    await safeRpc('vm.setStripGain', { strip: -1, db: state.musicVolumeDb });
    await safeRpc('vm.setMusicToVrchat', { on: !state.musicMutedToVrchat });
    await setState({ setupComplete: true, activeService: service });
  };

  const vmInstalled = Boolean(vm?.installed);
  const vmIsRunning = Boolean(vm?.running);
  const configOk = applyResult?.ok === true && (routingState?.ok ?? true);
  const routeOk = routeResult?.ok === true;
  const vrchatOk = vrchatSession === true;
  const musicLive = musicPeak !== null && musicPeak > -55;

  const vmOutputLive = vmOutPeak !== null && vmOutPeak > -55;
  const canFinish =
    vmIsRunning && configOk && routeOk && liveSession === true && musicLive && vmOutputLive && vrchatOk;

  const names = ['Mixer', 'Devices', 'Music', 'VRChat'];
  const canNext = step === 0 ? vmIsRunning : step === 1 ? configOk : routeOk && liveSession === true;
  return <div className="wizard-root guided-setup">
    <ol className="setup-progress" aria-label="Setup progress">{names.map((name, i) => <li key={name} aria-current={i === step ? 'step' : undefined} className={i === step ? 'current' : i < step ? 'completed' : ''}><span>{i < step ? '✓' : i + 1}</span>{name}</li>)}</ol>
    <div className="setup-mission-ring" aria-hidden="true"><svg viewBox="0 0 200 200"><circle className="hud-orbit" cx="100" cy="100" r="94"/>{names.map((name, i) => <circle key={name} className={`mission-segment ${i === step ? 'active' : i < step ? 'done' : ''}`} cx="100" cy="100" r="82" pathLength="100" strokeDasharray="22 78" transform={`rotate(${i * 90 - 90} 100 100)`} />)}</svg><div><strong>{step + 1}</strong><span>{names[step]}</span></div></div>
    <section className="card setup-card" aria-label={`Step ${step + 1}: ${names[step]}`}>
      <p className="setup-step-label">STEP {step + 1} OF 4</p>
      {step === 0 && <>
        <h2>Start your audio mixer</h2><p className="sub">VoiceMeeter mixes your voice and music.</p>
        <p className="setup-status" role="status">{vmIsRunning ? '✓ VoiceMeeter is ready' : vmInstalled ? 'Open VoiceMeeter to continue' : 'Install VoiceMeeter to continue'}</p>
        {!vmInstalled ? <><button className="primary" onClick={() => void doInstall()}>Install VoiceMeeter</button><p className="hint">Opens the official installer. Approve its Windows prompt.</p><button onClick={() => void refreshVm()}>Check again</button></> : !vmIsRunning ? <button className="primary" disabled={launching} onClick={() => void doLaunch()}>{launching ? 'Starting…' : 'Start VoiceMeeter'}</button> : null}
        {installDetail && <p role="status" className="inline-notice">{installDetail}</p>}
      </>}
      {step === 1 && <>
        <h2>Choose your mic & headphones</h2><p className="sub">Scan devices, choose your outputs, then apply.</p>
        <button disabled={scanBusy || applying} onClick={() => void scanAudio()}>{scanBusy ? 'Scanning…' : audioScan ? 'Rescan devices' : 'Scan devices'}</button>
        <label className="field-label">Your microphone<select value={activeMic ?? ''} disabled={applying} onChange={e => { setMicName(e.target.value); setApplyResult(null); }}>{mics.length === 0 && <option value="">No microphone found</option>}{mics.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</select></label>
        {audioScan && <label className="field-label">Headphones / speakers<select value={selectedPlaybackName} disabled={applying} onChange={e => { setSelectedPlaybackName(e.target.value); setApplyResult(null); }}>{audioScan.physicalPlaybackOutputs.length === 0 && <option value="">No output found</option>}{audioScan.physicalPlaybackOutputs.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}</select></label>}
        <button className="primary" disabled={applying || scanBusy || !activeMic || !audioScan || !selectedPlaybackName} onClick={() => void doApply()}>{applying ? 'Applying…' : 'Apply mix'}</button>
        {configOk && <p className="setup-status" role="status">✓ Mix is ready</p>}
        {scanError && <p className="inline-notice" role="alert">{scanError}</p>}
        {applyResult && !applyResult.ok && <p role="alert" className="inline-notice">{applyResult.steps.filter(s => !s.ok).map(s => s.detail || s.name).join(' · ')}</p>}
        {bar('Voice — say something', micPeak)}
        <details className="connection-details"><summary>Advanced / save settings</summary><AudioBaselineControls state={state} setState={setState} />{applyResult?.steps.map((s,i) => <p key={i} className="hint">{s.ok ? '✓' : '✗'} {s.detail || s.name}</p>)}</details>
      </>}
      {step === 2 && <>
        <h2>Connect your music</h2><p className="sub">Play a song, connect it, then check the signal.</p>
        <div className="tabs" role="tablist" aria-label="Choose music service">{(['spotify','ytmusic'] as const).map(s => <button key={s} role="tab" aria-selected={service === s} className={`tab ${service === s ? 'active' : ''}`} onClick={() => { setService(s); setRouteResult(null); setLiveSession(null); }}>{s === 'spotify' ? 'Spotify' : 'YouTube Music'}</button>)}</div>
        {service === 'ytmusic' && <><label className="field-label">Music browser<select value={browserId} onChange={e => { setBrowserId(e.target.value); setRouteResult(null); setLiveSession(null); }}>{MUSIC_BROWSERS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label><p className="hint">All browser audio is routed. Close other noisy tabs.</p></>}
        <div className="row"><button onClick={() => void bridge.op('openExternal', service === 'spotify' ? 'spotify:' : 'https://music.youtube.com')}>Open music app</button><button className="primary" onClick={() => void doRoute()}>Connect music</button><button disabled={!routeResult || verifying} onClick={() => void verifyLive()}>{verifying ? 'Checking…' : 'Check signal'}</button></div>
        {routeOk && <p className="setup-status">✓ Music connected{liveSession === true ? ' — signal verified' : ''}</p>}
        {routeResult && !routeOk && <div role="alert" className="inline-notice">{routeResult.detail}<button onClick={() => void bridge.op('openSoundSettings')}>Windows sound settings</button></div>}
        {liveSession === false && <p className="inline-notice">Play a song and check again. If it stays silent, press Connect music so {service === 'spotify' ? 'Spotify' : 'the browser'} outputs to the VoiceMeeter AUX input, then check the signal.</p>}
        {!musicEp && <button onClick={() => void refreshEps()}>Refresh devices</button>}
        {bar('Music signal', musicPeak)}
      </>}
      {step === 3 && <>
        <h2>Select your mic in VRChat</h2><p className="sub">Settings → Audio → Input Device</p>
        <div className="setup-device-name">{vmOutput?.name ?? 'VoiceMeeter Output'}</div><p className="hint">Enable your mic. Ask a friend if they hear you.</p>
        <button disabled={checkingVrchat || !vmOutput} onClick={() => void checkVrchat()}>{checkingVrchat ? 'Checking…' : 'Check VRChat'}</button>
        <p className="setup-status" role="status">{vrchatOk ? '✓ VRChat is using the virtual mic' : 'Waiting for VRChat to use this mic'}</p>
        {!vmOutput && <p className="inline-notice">Mic missing? Restart Windows after installing VoiceMeeter.</p>}
        {bar('Voice + music to VRChat', vmOutPeak)}
        {!canFinish && <p className="hint">Keep music playing and your VRChat mic enabled to finish.</p>}
      </>}
    </section>
    <div className="setup-navigation"><button className="ghost" disabled={step === 0 || applying || verifying} onClick={() => setStep(s => s - 1)}>← Back</button>{step < 3 ? <button className="primary" disabled={!canNext || applying || verifying} onClick={() => setStep(s => s + 1)}>Next →</button> : <button className="primary" disabled={!canFinish} onClick={() => void doFinish()}>Finish setup</button>}</div>
  </div>;
};
