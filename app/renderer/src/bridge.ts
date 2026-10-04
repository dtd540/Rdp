import type {
  AppState,
  AudioEndpointInfo,
  AudioSessionInfo,
  AudioSettingsScan,
  ServiceId,
  VoiceMeeterConfigResult,
  VoiceMeeterRoutingState,
  VoiceMeeterState
} from '@shared/rpc';

export type {
  AppState,
  AudioEndpointInfo,
  AudioSessionInfo,
  AudioSettingsScan,
  ServiceId,
  VoiceMeeterConfigResult,
  VoiceMeeterRoutingState,
  VoiceMeeterState
};

export interface Bridge {
  call(method: string, params?: unknown): Promise<unknown>;
  getState(): Promise<AppState>;
  setState(patch: Partial<AppState>): Promise<AppState>;
  selfInfo(): Promise<{ pid: number; name: string; isPackaged: boolean }>;
  op(op: string, arg?: string): Promise<{ ok: boolean; detail?: string; phase?: string }>;
  on(cb: (method: string, params: unknown) => void): () => void;
}

declare global {
  interface Window {
    bridge: Bridge;
  }
}

const injected: Bridge | undefined =
  typeof window !== 'undefined' ? (window as { bridge?: Bridge }).bridge : undefined;

export const bridge: Bridge = injected ?? createBrowserMock();

/** True when running inside the real Electron app (preloaded bridge present). */
export const isElectron = Boolean(injected);

/**
 * DEV-ONLY browser mock (no Electron preload). Lets the UI be exercised in a
 * plain browser / live preview: returns realistic simulated audio hardware,
 * simulates VoiceMeeter + routing RPCs, and pushes fake meter ticks so the
 * meters animate. Never used inside the packaged app.
 */
function createBrowserMock(): Bridge {
  const endpoints: AudioEndpointInfo[] = [
    { id: '{0.0.0.00000000}.{mock-speakers}', name: 'Speakers (Realtek High Definition Audio)', direction: 'render', isDefault: true },
    { id: '{0.0.0.00000000}.{mock-vm-aux}', name: 'VoiceMeeter Aux Input (VB-Audio VoiceMeeter VAIO AUX)', direction: 'render', isDefault: false },
    { id: '{0.0.0.00000000}.{mock-vm-out}', name: 'VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)', direction: 'capture', isDefault: false },
    { id: '{0.0.0.00000000}.{mock-mic}', name: 'Microphone (USB Audio Device)', direction: 'capture', isDefault: true }
  ];

  let state: AppState = {
    setupComplete: false,
    activeService: null,
    checks: [],
    musicMutedToVrchat: false,
    musicVolumeDb: 0,
    duckingEnabled: true,
    micEndpointName: 'Microphone (USB Audio Device)',
    musicEndpointName: 'VoiceMeeter Aux Input (VB-Audio VoiceMeeter VAIO AUX)'
  };

  const listeners = new Set<(method: string, params: unknown) => void>();
  let meterTimer: ReturnType<typeof setInterval> | null = null;

  /** Animate the meters like real audio until something asks to stop them. */
  function startMeters(): void {
    if (meterTimer) return;
    const levels = new Map<string, number>(endpoints.map((e) => [e.id, -60]));
    meterTimer = setInterval(() => {
      for (const ep of endpoints) {
        // Random-walk with occasional louder bursts (speech on the mic, music on the strip).
        const idle = ep.direction === 'capture' && !/USB/.test(ep.name) ? -60 : -30;
        const prev = levels.get(ep.id) ?? -60;
        const target = Math.random() < 0.08 ? -12 + Math.random() * 8 : idle + Math.random() * 10;
        const next = Math.max(-60, Math.min(-3, prev + (target - prev) * 0.35));
        levels.set(ep.id, next);
        for (const cb of listeners) cb('meter.update', { endpointId: ep.id, peakDb: next });
      }
    }, 140);
  }

  return {
    call: async (method: string) => {
      switch (method) {
        case 'endpoints.list':
          return endpoints;
        case 'audio.scanSettings':
          return {
            scannedAt: new Date().toISOString(),
            consolePlayback: endpoints[0],
            defaultPlayback: endpoints[0],
            communicationsPlayback: endpoints[0],
            consoleMicrophone: endpoints[3],
            defaultMicrophone: endpoints[3],
            communicationsMicrophone: endpoints[3],
            physicalPlaybackOutputs: [endpoints[0]],
            spotifySessions: [{
              pid: 4242,
              processName: 'Spotify',
              endpointId: endpoints[1].id,
              endpointName: endpoints[1].name,
              state: 'active'
            }],
            voiceMeeter: { running: true, kind: 'Potato', a1OutputName: 'Speakers (Realtek High Definition Audio)', a1MatchesWindowsPlaybackDefault: true }
          };
        case 'vm.state':
          return {
            installed: true,
            running: true,
            kind: 'Potato',
            dllPath: 'C:\\Program Files (x86)\\VB\\Voicemeeter\\VoicemeeterRemote64.dll'
          } satisfies VoiceMeeterState;
        case 'vm.applyConfig':
          return {
            ok: true,
            steps: [
              { name: 'engine', ok: true, detail: 'Voicemeeter Potato 3.1.2.2' },
              { name: 'a1-output-scan', ok: true, detail: 'Windows playback target: Speakers (Realtek); VoiceMeeter A1 can select it' },
              { name: 'music-endpoint', ok: true, detail: 'VoiceMeeter Aux Input' },
              { name: 'mic-device', ok: true, detail: 'Microphone (USB Audio Device)' },
              { name: 'a1-output', ok: true, detail: 'A1 monitoring output: Speakers (Realtek High Definition Audio)' },
              { name: 'strip-routing', ok: true, detail: 'Mic strip 0 -> B1; music strip 6 -> A1+B1' },
              { name: 'buses', ok: true, detail: 'Potato B1 = Bus[5] -> VoiceMeeter Output (VRChat mic)' }
            ]
          } satisfies VoiceMeeterConfigResult;
        case 'vm.routingState':
          return {
            running: true,
            ok: true,
            kind: 'Potato',
            musicEndpoint: endpoints[1].name,
            musicStrip: 6,
            b1BusIndex: 5,
            virtualMic: endpoints[2].name,
            micToB1: true,
            musicToB1: true,
            musicUnmuted: true,
            b1Unmuted: true,
            a1OutputName: 'Speakers (Realtek High Definition Audio)',
            musicToA1: true,
            a1Unmuted: true,
            monitoringOk: true,
            a1MatchesWindowsPlaybackDefault: true,
            monitoringDetail: 'music → A1: on; output selected'
          } satisfies VoiceMeeterRoutingState;
        case 'sessions.list':
        case 'sessions.findByProcess':
          return { pid: 4242, processName: 'Spotify', displayName: 'SpotifyAB.SpotifyMusic', state: 'active' } satisfies AudioSessionInfo;
        case 'route.app':
          return { ok: true, method: 'api', detail: 'SetPersistedDefaultAudioEndpoint succeeded' };
        case 'route.openAppSettings':
        case 'route.showSoundSettings':
        case 'meter.start':
        case 'meter.stop':
        case 'meter.refresh':
        case 'vm.shutdown':
        case 'state.get':
        case 'state.set':
          return { ok: true };
        case 'diagnostics.tone':
          return { ok: true, started: true };
        case 'vm.muteMusicToVrchat':
          return { ok: true, muted: true };
        case 'vm.setMusicVolume':
        case 'vm.setDucking':
          return { ok: true };
        case 'diagnostics.info':
          return { platform: 'browser-preview', note: 'Mock data — no real audio stack' };
        default:
          throw new Error(`bridge unavailable (browser mock has no '${method}')`);
      }
    },
    getState: async () => state,
    setState: async (patch) => {
      state = { ...state, ...patch };
      return state;
    },
    selfInfo: async () => ({ pid: 0, name: 'browser-preview', isPackaged: false }),
    op: async (op, arg) => {
      if (op === 'openExternal' && arg) {
        try {
          window.open(arg, '_blank', 'noopener');
        } catch {
          /* ignore */
        }
      }
      return { ok: true, detail: `${op} (mock)` };
    },
    on: (cb) => {
      listeners.add(cb);
      startMeters();
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && meterTimer) {
          clearInterval(meterTimer);
          meterTimer = null;
        }
      };
    }
  };
}

/** Type-safe sidecar call helper. */
export async function rpc<T>(method: string, params?: unknown): Promise<T> {
  return (await bridge.call(method, params)) as T;
}

export async function safeRpc<T>(method: string, params?: unknown): Promise<T | null> {
  try {
    return await rpc<T>(method, params);
  } catch {
    return null;
  }
}

/** Endpoints for the three wizard/dashboard meters + music routing. */
export function pickMusicEndpoint(eps: AudioEndpointInfo[]): AudioEndpointInfo | undefined {
  const render = eps.filter((e) => e.direction === 'render');
  return (
    render.find((e) => /VoiceMeeter Aux Input/i.test(e.name)) ??
    render.find((e) => /VoiceMeeter Input/i.test(e.name))
  );
}

export function pickVmOutput(eps: AudioEndpointInfo[]): AudioEndpointInfo | undefined {
  return eps.find((e) => e.direction === 'capture' && /VoiceMeeter Output/i.test(e.name));
}

export function pickMics(eps: AudioEndpointInfo[]): AudioEndpointInfo[] {
  return eps.filter(
    (e) =>
      e.direction === 'capture' &&
      !/VoiceMeeter|Virtual Audio Cable|VB-Audio|^CABLE/i.test(e.name)
  );
}
