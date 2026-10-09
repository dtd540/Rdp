import type {
  AppState,
  AudioBaseline,
  AudioEndpointInfo,
  AudioSessionInfo,
  AudioSettingsScan,
  BackgroundImage,
  BridgeOpResult,
  ServiceId,
  SteamGame,
  VoiceMeeterConfigResult,
  VoiceMeeterRoutingState,
  VoiceMeeterState
} from '@shared/rpc';
import type { UpdateStatus } from '@shared/update';

export type { UpdateStatus };

export type {
  AppState,
  AudioBaseline,
  AudioEndpointInfo,
  AudioSessionInfo,
  AudioSettingsScan,
  BackgroundImage,
  BridgeOpResult,
  ServiceId,
  SteamGame,
  VoiceMeeterConfigResult,
  VoiceMeeterRoutingState,
  VoiceMeeterState
};

export interface Bridge {
  call(method: string, params?: unknown): Promise<unknown>;
  getState(): Promise<AppState>;
  setState(patch: Partial<AppState>): Promise<AppState>;
  selfInfo(): Promise<{ pid: number; name: string; isPackaged: boolean }>;
  op(op: string, arg?: string): Promise<BridgeOpResult>;
  on(cb: (method: string, params: unknown) => void): () => void;
  updates: {
    getStatus(): Promise<UpdateStatus | null>;
    check(): Promise<UpdateStatus>;
    install(): Promise<boolean>;
  };
}

declare global {
  interface Window {
    bridge: Bridge;
    __freebuffPreview?: boolean;
  }
}

const injected: Bridge | undefined =
  typeof window !== 'undefined' ? (window as { bridge?: Bridge }).bridge : undefined;

export const bridge: Bridge = injected ?? createBrowserMock();

export const isElectron = Boolean(injected);
export const hasNativeWebviews = isElectron && !window.__freebuffPreview;

function createBrowserMock(): Bridge {
  const endpoints: AudioEndpointInfo[] = [
    { id: '{0.0.0.00000000}.{mock-speakers}', name: 'Speakers (Realtek High Definition Audio)', direction: 'render', isDefault: true },
    { id: '{0.0.0.00000000}.{mock-vm-aux}', name: 'VoiceMeeter Aux Input (VB-Audio VoiceMeeter VAIO AUX)', direction: 'render', isDefault: false },
    { id: '{0.0.0.00000000}.{mock-vm-out}', name: 'VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)', direction: 'capture', isDefault: false },
    { id: '{0.0.0.00000000}.{mock-mic}', name: 'Microphone (USB Audio Device)', direction: 'capture', isDefault: true }
  ];

  let state: AppState = {
    setupComplete: false,
    audioBaseline: null,
    activeService: null,
    checks: [],
    musicMutedToVrchat: false,
    musicVolumeDb: 0,
    duckingEnabled: true,
    micEndpointName: 'Microphone (USB Audio Device)',
    musicEndpointName: 'VoiceMeeter Aux Input (VB-Audio VoiceMeeter VAIO AUX)',
    backgroundPath: null
  };

  let mockBackground: BackgroundImage | null = null;

  async function pickFileAsDataUrl(): Promise<{ name: string; url: string }> {
    if (typeof document === 'undefined') {
      throw new Error('File picking needs the desktop app — this browser preview cannot open a file dialog.');
    }
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif';
      input.style.display = 'none';
      document.body.appendChild(input);

      const finish = (): void => {
        window.removeEventListener('focus', onRefocus);
        input.remove();
      };
      const onRefocus = (): void => {
        window.setTimeout(() => {
          if (input.files?.length) return;
          finish();
          reject(new Error('cancelled'));
        }, 250);
      };

      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0];
          finish();
          if (!file) {
            reject(new Error('cancelled'));
            return;
          }
          const reader = new FileReader();
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
          reader.onload = () =>
            resolve({
              name: file.name,
              url: `${reader.result}`
            });
          reader.readAsDataURL(file);
        },
        { once: true }
      );
      input.addEventListener('cancel', () => {
        finish();
        reject(new Error('cancelled'));
      }, { once: true });
      window.addEventListener('focus', onRefocus, { once: true });
      input.click();
    });
  }

  const listeners = new Set<(method: string, params: unknown) => void>();
  let meterTimer: ReturnType<typeof setInterval> | null = null;

  function startMeters(): void {
    if (meterTimer) return;
    const levels = new Map<string, number>(endpoints.map((e) => [e.id, -60]));
    meterTimer = setInterval(() => {
      for (const ep of endpoints) {
        const idle = ep.direction === 'capture' && !/USB/.test(ep.name) ? -60 : -30;
        const prev = levels.get(ep.id) ?? -60;
        const target = Math.random() < 0.08 ? -12 + Math.random() * 8 : idle + Math.random() * 10;
        const next = Math.max(-60, Math.min(-3, prev + (target - prev) * 0.35));
        levels.set(ep.id, next);
        for (const cb of listeners) cb('meter.update', { endpointId: ep.id, peakDb: next });
      }
    }, 140);
  }

  let mockBaseline: AudioBaseline | null = null;

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
        case 'audio.captureBaseline':
          mockBaseline = { capturedAt: new Date().toISOString(), spotifyRoutes: [{ pid: 4242, processName: 'Spotify', endpoints: [{ role: 0, endpointId: endpoints[0].id, endpointName: endpoints[0].name, hasSavedValue: true }, { role: 1, endpointId: endpoints[0].id, endpointName: endpoints[0].name, hasSavedValue: true }, { role: 2, endpointId: endpoints[0].id, endpointName: endpoints[0].name, hasSavedValue: true }] }], voiceMeeter: { kind: 3, microphoneDevice: 'Microphone (USB Audio Device)', a1Output: 'Speakers (Realtek High Definition Audio)', musicEndpoint: endpoints[2].name, musicStrip: 6, micMute: 0, micA1: 0, micB1: 1, micGain: 0, musicMute: 0, musicA1: 1, musicB1: 1, musicGain: 0, a1Mute: 0, b1Mute: 0 }, musicVolumeDb: state.musicVolumeDb, musicMutedToVrchat: state.musicMutedToVrchat, duckingEnabled: state.duckingEnabled };
          return mockBaseline;
        case 'audio.restoreBaseline':
          return mockBaseline ? { ok: true, steps: [{ name: 'voicemeeter', ok: true, detail: 'Saved VoiceMeeter settings restored.' }, { name: 'spotify-routing', ok: true, detail: 'Saved Spotify route restored.' }] } : { ok: false, steps: [{ name: 'restore', ok: false, detail: 'No saved audio settings.' }] };
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
        case 'vm.setMusicToVrchat':
          return true;
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
    updates: {
      getStatus: async () => null,
      check: async () => ({ state: 'error', message: 'Updates are only available in the installed Windows app.' }),
      install: async () => false
    },
    op: async (op, arg) => {
      if (op === 'saveAudioBaseline') {
        const baseline = await bridge.call('audio.captureBaseline') as AudioBaseline;
        mockBaseline = baseline;
        await bridge.setState({ audioBaseline: baseline });
        return { ok: true, detail: 'Mock audio settings saved in this browser preview.' };
      }
      if (op === 'restoreAudioBaseline') {
        if (!mockBaseline) return { ok: false, detail: 'No saved audio settings.' };
        return { ok: true, detail: 'Mock saved audio settings restored.' };
      }
      if (op === 'openExternal' && arg) {
        try {
          window.open(arg, '_blank', 'noopener');
        } catch {
        }
      }
      if (op === 'pickBackgroundImage') {
        try {
          const picked = await pickFileAsDataUrl();
          mockBackground = {
            path: `(preview) ${picked.name}`,
            name: picked.name,
            url: picked.url,
            animated: /\.gif$/i.test(picked.name)
          };
          state = { ...state, backgroundPath: mockBackground.path };
          return { ok: true, detail: mockBackground.name, image: mockBackground };
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          if (/cancelled/i.test(detail)) return { ok: false, detail: 'cancelled' };
          return { ok: false, detail };
        }
      }
      if (op === 'detectVrchatOscPort') {
        return { ok: false, detail: 'This browser preview cannot inspect running Windows processes. Use the installed app while VRChat is open.' };
      }
      if (op === 'getBackground') {
        return mockBackground ? { ok: true, image: mockBackground } : { ok: true };
      }
      if (op === 'clearBackground') {
        mockBackground = null;
        state = { ...state, backgroundPath: null };
        return { ok: true };
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
