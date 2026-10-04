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

interface Props {
  state: AppState;
  setState: (patch: Partial<AppState>) => Promise<AppState>;
  peaks: Record<string, number>;
}

type StepStatus = 'ok' | 'fail' | 'pending';

const Step: FC<{ status: StepStatus; label: string; detail?: string; action?: React.ReactNode }> = ({
  status,
  label,
  detail,
  action
}) => (
  <div className={`step ${status}`}>
    <span className="icon">{status === 'ok' ? '✓' : status === 'fail' ? '✗' : '…'}</span>
    <div className="grow">
      <div>{label}</div>
      {detail ? <div className="detail">{detail}</div> : null}
    </div>
    {action}
  </div>
);

const busy = (v: boolean) => ({ opacity: v ? 0.6 : 1, pointerEvents: v ? ('none' as const) : ('auto' as const) });

export const Wizard: FC<Props> = ({ state, setState, peaks }) => {
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

  const [routeResult, setRouteResult] = useState<{ ok: boolean; method: string; detail?: string } | null>(null);
  const [liveSession, setLiveSession] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [selfName, setSelfName] = useState('app');

  const [vrchatSession, setVrchatSession] = useState<boolean | null>(null);
  const [checkingVrchat, setCheckingVrchat] = useState(false);

  const musicEp = useMemo(() => pickMusicEndpoint(eps), [eps]);
  const vmOutput = useMemo(() => pickVmOutput(eps), [eps]);
  const mics = useMemo(() => pickMics(eps), [eps]);
  const activeMic = micName ?? mics.find((m) => m.isDefault)?.name ?? mics[0]?.name ?? null;

  const refreshEps = async () => setEps((await safeRpc<AudioEndpointInfo[]>('endpoints.list')) ?? []);
  const refreshVm = async () => setVm(await safeRpc<VoiceMeeterState>('vm.state'));
  const scanAudio = async () => {
    setScanBusy(true);
    setScanError(null);
    try {
      const [snapshot, endpoints] = await Promise.all([
        safeRpc<AudioSettingsScan>('audio.scanSettings'),
        safeRpc<AudioEndpointInfo[]>('endpoints.list')
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

  // Bootstrap: endpoints, VM state, self name. Poll VM until installed+running.
  useEffect(() => {
    void refreshEps();
    void refreshVm();
    void bridge.selfInfo().then((i) => setSelfName(i.name));
    const id = window.setInterval(() => {
      void refreshVm().then(() => void refreshEps());
    }, 3000);
    return () => window.clearInterval(id);
  }, []);

  // Meters: music endpoint + VoiceMeeter Output as soon as known; mic follows selection.
  const started = useRef<Set<string>>(new Set());
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
    if (musicEp) void startMeter(musicEp.id);
    if (vmOutput) void startMeter(vmOutput.id);
  }, [musicEp?.id, vmOutput?.id]);

  const activeMicEp = eps.find((e) => e.name === activeMic);
  useEffect(() => {
    if (activeMicEp) void startMeter(activeMicEp.id);
  }, [activeMicEp?.id]);

  const micPeak = activeMicEp ? peaks[activeMicEp.id] ?? null : null;
  const musicPeak = musicEp ? peaks[musicEp.id] ?? null : null;
  const vmOutPeak = vmOutput ? peaks[vmOutput.id] ?? null : null;

  const bar = (label: string, peak: number | null) => (
    <div className="meter" style={{ marginTop: 10 }}>
      <div className="label">
        <b>{label}</b>
        <span className="value">{peak !== null && peak > -99 ? `${peak.toFixed(0)} dB` : 'no signal'}</span>
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

  // ---- actions ----
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
      // Re-scan immediately before applying, but never silently switch the chosen output.
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
    const params =
      service === 'spotify'
        ? { processName: 'Spotify', endpointName: musicEp.name }
        : { self: true, endpointName: musicEp.name };
    const r = await safeRpc<{ ok: boolean; method: string; detail?: string }>('route.app', params);
    setRouteResult(r ?? { ok: false, method: 'manual', detail: 'sidecar call failed' });
    if (service === 'ytmusic') await setState({ activeService: 'ytmusic' });
  };

  const verifyLive = async () => {
    if (!musicEp) return;
    setVerifying(true);
    setLiveSession(null);
    const procName = service === 'spotify' ? 'Spotify' : selfName;
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
    if (!vmOutput) return;
    setCheckingVrchat(true);
    const s = await safeRpc<{ pid: number; state: string } | null>('sessions.findByProcess', {
      endpointId: vmOutput.id,
      processName: 'VRChat'
    });
    setVrchatSession(Boolean(s && s.pid > 0 && s.state === 'active'));
    setCheckingVrchat(false);
  };
  useEffect(() => {
    if (vrchatSession === null) void checkVrchat();
    const id = window.setInterval(() => void checkVrchat(), 5000);
    return () => window.clearInterval(id);
  }, [vmOutput?.id]);

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

  // Do not call setup complete just because routing was configured. Require a live
  // Spotify session on the VoiceMeeter input, actual signal on that input and on
  // the VoiceMeeter virtual mic output, and an active VRChat capture session.
  const vmOutputLive = vmOutPeak !== null && vmOutPeak > -55;
  const canFinish =
    vmIsRunning && configOk && routeOk && liveSession === true && musicLive && vmOutputLive && vrchatOk;

  return (
    <div className="wizard-root">
      <section className="page-hero">
        <div className="eyebrow"><span className="eyebrow-pulse" /> PRIVATE AUDIO ROUTE <span>·</span> THIS PC ONLY</div>
        <div className="hero-copy">
          <div>
            <h1>Bring your music<br /><em>into the world.</em></h1>
            <p>Send Spotify through a virtual mic into VRChat. No aux cord, no second device—just a clean software route on this PC.</p>
          </div>
          <div className="hero-badge"><span className="hero-badge-icon">♫</span><span>YOUR AUDIO<br /><b>YOUR CONTROL</b></span></div>
        </div>
        <div className="route-visual" aria-label="Audio route: Spotify through VoiceMeeter to VRChat">
          <div className={`route-node ${routeOk && liveSession ? 'route-node-live' : ''}`}>
            <div className="route-node-icon spotify-icon">◉</div>
            <div className="route-node-copy"><small>SOURCE</small><b>Spotify</b><span>Desktop app</span></div>
            <span className={`route-node-status ${routeOk && liveSession ? 'status-live' : ''}`} />
          </div>
          <div className={`route-wire ${routeOk && liveSession ? 'wire-live' : ''}`}><span /><span /><span /></div>
          <div className={`route-node ${configOk ? 'route-node-live' : ''}`}>
            <div className="route-node-icon mixer-icon">▤</div>
            <div className="route-node-copy"><small>MIXER</small><b>VoiceMeeter</b><span>Virtual audio</span></div>
            <span className={`route-node-status ${configOk ? 'status-live' : ''}`} />
          </div>
          <div className={`route-wire ${vrchatOk && vmOutputLive ? 'wire-live' : ''}`}><span /><span /><span /></div>
          <div className={`route-node ${vrchatOk && vmOutputLive ? 'route-node-live' : ''}`}>
            <div className="route-node-icon vrchat-icon">◈</div>
            <div className="route-node-copy"><small>VIRTUAL MIC</small><b>VRChat</b><span>VoiceMeeter Output</span></div>
            <span className={`route-node-status ${vrchatOk && vmOutputLive ? 'status-live' : ''}`} />
          </div>
        </div>
        <div className="route-footnote"><span className="route-footnote-icon">↗</span> Your real microphone is mixed in too, so you can still talk.</div>
      </section>

      <div className="section-heading"><div><span className="section-kicker">LET’S GET YOU CONNECTED</span><h2>Setup your audio route</h2></div><span className="setup-count">04 <i>/</i> STEPS</span></div>

      {/* ---------- Step 1: VoiceMeeter ---------- */}
      <div className="card setup-card setup-card-engine">
        <div className="card-step-number">01</div>
        <h2>1 · VoiceMeeter audio mixer</h2>
        <p className="sub">
          VoiceMeeter provides the virtual microphone that VRChat listens to, and mixes your voice with
          the music. It's free donationware from VB-Audio — this app sets it up for you.
        </p>
        {!vmInstalled ? (
          <div style={busy(launching)}>
            <div className="row">
              <button className="primary" onClick={() => void doInstall()}>
                Install VoiceMeeter
              </button>
              <span className="hint">Downloads/launches the official installer — approve its UAC prompt.</span>
            </div>
            {installDetail ? <p className="hint">{installDetail}</p> : null}
            <div className="spacer8" />
            <button className="small" onClick={() => void refreshVm()}>
              I installed it — rescan
            </button>
          </div>
        ) : !vmIsRunning ? (
          <div style={busy(launching)}>
            <div className="row">
              <button className="primary" onClick={() => void doLaunch()}>
                {launching ? 'Starting…' : 'Launch VoiceMeeter'}
              </button>
              <span className="hint">Installed ({vm?.kind ?? 'edition unknown'}) — start it.</span>
            </div>
          </div>
        ) : (
          <div className="steps">
            <Step status="ok" label={`VoiceMeeter ${vm?.kind ?? ''} is running`} detail={vm?.dllPath ?? undefined} />
          </div>
        )}
        {installDetail && vmInstalled ? <p className="hint">{installDetail}</p> : null}
      </div>

      {/* ---------- Step 2: mic + routing config ---------- */}
      <div className="card setup-card" style={vmIsRunning ? undefined : { opacity: 0.5, pointerEvents: 'none' }}>
        <div className="card-step-number">02</div>
        <h2>2 · Your microphone &amp; routing</h2>
        <p className="sub">
          We point Hardware Strip 1 at your mic (so your voice reaches VRChat), send the music strip to{' '}
          <b>A1</b> (your ears) and <b>B1</b> (VRChat's mic), and keep game audio completely out of the
          loop.
        </p>
        <div className="row">
          <select value={activeMic ?? ''} onChange={(e) => setMicName(e.target.value)}>
            {mics.length === 0 ? <option value="">no microphones found</option> : null}
            {mics.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
                {m.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <button className="small ghost" onClick={() => void scanAudio()} disabled={scanBusy || applying}>
            {scanBusy ? 'Scanning…' : audioScan ? 'Rescan audio settings' : 'Scan audio settings'}
          </button>
          <button className="primary" onClick={() => void doApply()} disabled={applying || !activeMic || !audioScan || !selectedPlaybackName || scanBusy}>
            {applying ? 'Applying…' : 'Apply routing'}
          </button>
        </div>
        {audioScan ? (
          <div className="inline-notice">
            <b>Read-only audio scan · {new Date(audioScan.scannedAt).toLocaleTimeString()}</b><br />
            Windows playback defaults — media: {audioScan.defaultPlayback?.name ?? 'not found'} · calls: {audioScan.communicationsPlayback?.name ?? 'not found'} · console: {audioScan.consolePlayback?.name ?? 'not found'}<br />
            Windows microphone defaults — media: {audioScan.defaultMicrophone?.name ?? 'not found'} · calls: {audioScan.communicationsMicrophone?.name ?? 'not found'} · console: {audioScan.consoleMicrophone?.name ?? 'not found'}<br />
            Spotify currently renders on: {audioScan.spotifySessions.length
              ? audioScan.spotifySessions.map((session) => `${session.endpointName} (${session.state})`).join(', ')
              : 'no Spotify audio session detected'}<br />
            VoiceMeeter A1 currently outputs to: {audioScan.voiceMeeter.a1OutputName || 'not selected'} · matches Windows media default: {audioScan.voiceMeeter.a1MatchesWindowsPlaybackDefault ? 'yes' : 'no'} · Windows defaults will not be changed.
            <div className="row" style={{ marginTop: 10 }}>
              <label htmlFor="a1-output-select"><b>VoiceMeeter A1 (what you hear)</b></label>
              <select id="a1-output-select" value={selectedPlaybackName} onChange={(event) => setSelectedPlaybackName(event.target.value)}>
                {audioScan.physicalPlaybackOutputs.length === 0 ? <option value="">No active physical playback devices</option> : null}
                {audioScan.physicalPlaybackOutputs.map((output) => (
                  <option key={output.id} value={output.name}>
                    {output.name}{output.id === audioScan.defaultPlayback?.id ? ' (Windows default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : <p className="hint">Scan your audio settings first. This only reads Windows device defaults and Spotify’s current output; it makes no changes.</p>}
        {scanError ? <p className="inline-notice">{scanError}</p> : null}
        {bar('Microphone signal — say something', micPeak)}
        {applyResult ? (
          <div className="steps">
            {applyResult.steps.map((s, i) => (
              <Step key={i} status={s.ok ? 'ok' : 'fail'} label={s.name} detail={s.detail} />
            ))}
            {routingState?.running ? (
              <Step
                status={routingState.ok ? 'ok' : 'fail'}
                label={routingState.ok ? 'VoiceMeeter B1 is feeding the virtual mic' : 'VoiceMeeter B1 is not feeding the virtual mic'}
                detail={`${routingState.detail ?? ''} · music → B1: ${routingState.musicToB1 ? 'on' : 'off'} · B1 bus: ${routingState.b1Unmuted ? 'unmuted' : 'muted'}`}
              />
            ) : null}
            {routingState?.running ? (
              <Step
                status={routingState.monitoringOk ? 'ok' : 'fail'}
                label={routingState.monitoringOk ? 'Local audio monitoring is connected' : 'Local audio monitoring needs attention'}
                detail={routingState.monitoringDetail ?? `A1 output: ${routingState.a1OutputName ?? 'not selected'}`}
              />
            ) : null}
          </div>
        ) : null}
        {musicEp ? bar(`Music entering ${musicEp.name}`, musicPeak) : null}
      </div>

      {/* ---------- Step 3: service ---------- */}
      <div className="card setup-card">
        <div className="card-step-number">03</div>
        <h2>3 · Connect your music</h2>
        <p className="sub">Connect Spotify to the virtual music input. You can set the route now; apply the VoiceMeeter mixer configuration above before testing playback.</p>
        <div className="tabs" role="tablist" aria-label="Choose music service">
          <button type="button" role="tab" aria-selected={service === 'spotify'} className={`tab ${service === 'spotify' ? 'active' : ''}`} onClick={() => setService('spotify')}>
            Spotify
          </button>
          <button type="button" role="tab" aria-selected={service === 'ytmusic'} className={`tab ${service === 'ytmusic' ? 'active' : ''}`} onClick={() => setService('ytmusic')}>
            YouTube Music
          </button>
        </div>

        {!musicEp ? <div className="inline-notice">VoiceMeeter’s virtual input is not detected yet. You can still press Connect to see the next step; install or start VoiceMeeter, then refresh audio devices.</div> : null}
        <div className="row">
          <button className="primary" onClick={() => void doRoute()}>
            {routeOk ? 'Re-connect' : 'Connect'} {service === 'spotify' ? 'Spotify' : 'YouTube Music'}
          </button>
          {service === 'spotify' ? (
            <button onClick={() => void bridge.op('openExternal', 'spotify:')}>Open Spotify</button>
          ) : null}
          {!musicEp ? <button className="small ghost" onClick={() => void refreshEps()}>Refresh audio devices</button> : null}
          {routeResult && !routeOk ? (
            <button onClick={() => void bridge.op('openSoundSettings')}>
              Open Windows sound settings
            </button>
          ) : null}
        </div>

        <div className="steps">
          {routeResult ? (
            <Step
              status={routeResult.ok ? 'ok' : 'pending'}
              label={
                routeResult.ok
                  ? `Output device routed to ${musicEp?.name ?? ''} (automatic)`
                  : 'Could not route automatically — set the app’s output device in Windows'
              }
              detail={
                routeResult.ok
                  ? routeResult.detail
                  : `${routeResult.detail ?? ''} → Settings ▸ System ▸ Sound ▸ App volume and device preferences ▸ ${
                      service === 'spotify' ? 'Spotify' : 'VRChat Music Bridge'
                    } output = ${musicEp?.name ?? 'VoiceMeeter Aux Input'}`
              }
            />
          ) : null}
          {routeOk || routeResult ? (
            <Step
              status={liveSession === true ? 'ok' : liveSession === false ? 'fail' : 'pending'}
              label="Live audio session on the music strip"
              detail={
                liveSession === true
                  ? 'verified — music is flowing into the bridge'
                  : liveSession === false
                    ? 'no session yet — press Play in the app, then Verify'
                    : undefined
              }
              action={
                <button className="small" onClick={() => void verifyLive()} disabled={verifying}>
                  {verifying ? 'watching…' : 'Verify'}
                </button>
              }
            />
          ) : null}
        </div>
        {musicEp && musicLive && routeOk ? (
          <p className="hint">
            ✓ Music signal detected on {musicEp.name}; verify the VoiceMeeter Output meter and active VRChat capture below.
          </p>
        ) : null}
        {musicEp && routeOk && !musicLive ? (
          <p className="inline-notice">Spotify is assigned to VoiceMeeter, but there is no signal on its virtual input yet. Start a track; if it remains silent, open Windows sound settings and confirm Spotify’s output is VoiceMeeter Aux Input.</p>
        ) : null}
        {routeOk && musicLive && routingState?.running && !routingState.musicToB1 ? (
          <p className="inline-notice">Spotify reaches VoiceMeeter, but its music strip is not assigned to B1 (the VRChat virtual mic bus). Press Apply routing in step 2 and verify this status turns on.</p>
        ) : null}
      </div>

      {/* ---------- Step 4: VRChat ---------- */}
      <div className="card setup-card" style={configOk ? undefined : { opacity: 0.5, pointerEvents: 'none' }}>
        <div className="card-step-number">04</div>
        <h2>4 · VRChat microphone</h2>
        <p className="sub">
          In VRChat: <span className="kbd">Esc</span> ▸ Settings ▸ Audio ▸{' '}
          <b>Input Device</b> ▸          <b>{vmOutput?.name ?? 'VoiceMeeter Output'}</b>.
          We watch for an active VRChat capture session; a trusted friend in-world should confirm audibility.
        </p>
        {!vmOutput ? (
          <div className="steps">
            <Step
              status="pending"
              label="VoiceMeeter Output device not visible to Windows yet"
              detail="Right after installing VoiceMeeter a reboot is usually required before the virtual mic appears."
            />
          </div>
        ) : (
          <>
            <div className="steps">
              <Step
                status={vrchatOk ? 'ok' : 'pending'}
                label={vrchatOk ? 'VRChat has an active capture session on VoiceMeeter Output' : 'Waiting for VRChat to actively capture this mic'}
                detail={vrchatOk ? 'Active capture detected; confirm other players can hear you in-world.' : 'Join VRChat, open audio settings, select VoiceMeeter Output, and enable your mic.'}
                action={
                  <button className="small" onClick={() => void checkVrchat()} disabled={checkingVrchat}>
                    {checkingVrchat ? 'checking…' : 'Check again'}
                  </button>
                }
              />
            </div>
            {bar('What VRChat will hear (voice + music)', vmOutPeak)}
          </>
        )}
      </div>

      {/* ---------- Finish ---------- */}
      <div className="card finish-card">
        <div className="finish-card-copy"><span className="section-kicker">READY WHEN YOU ARE</span><b>Test the complete path</b><span>Play Spotify, confirm both meters, and make sure VRChat is actively capturing the virtual mic.</span></div>
        <div className="row">
          <button className="primary finish-button" onClick={() => void doFinish()} disabled={!canFinish}>
            Finish setup
          </button>
          <span className="hint">
            {canFinish
              ? 'Local audio path verified: music is active on VoiceMeeter, its virtual mic output has signal, and VRChat is capturing it. Confirm audibility in-world with a trusted friend.'
              : !configOk
                ? 'First apply the microphone and VoiceMeeter mixer routing in step 2. You can connect Spotify above at any time.'
                : 'Play Spotify, confirm its active session and music meter, then select VoiceMeeter Output in VRChat and confirm active capture plus output signal.'}
          </span>
        </div>
      </div>
    </div>
  );
};
