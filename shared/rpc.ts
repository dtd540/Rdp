
export interface RpcRequest {
  id: number;
  method: string;
  params?: unknown;
}

export interface RpcError {
  code: number;
  message: string;
}

export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: RpcError;
}

export interface RpcEvent {
  method: string;
  params?: unknown;
}

export type RpcMessage = RpcRequest | RpcResponse | RpcEvent;

export function isResponse(msg: RpcMessage): msg is RpcResponse {
  return 'id' in msg && (msg as RpcResponse).result !== undefined || ('id' in msg && (msg as RpcResponse).error !== undefined);
}

export function isEvent(msg: RpcMessage): msg is RpcEvent {
  return !('id' in msg) && 'method' in msg;
}


export interface AudioEndpointInfo {
  id: string;
  name: string;
  direction: 'render' | 'capture';
  isDefault: boolean;
}

export interface AudioSessionInfo {
  pid: number;
  processName: string;
  displayName: string;
  state: 'active' | 'inactive' | 'expired';
}

export interface AudioSettingsScan {
  scannedAt: string;
  consolePlayback: AudioEndpointInfo | null;
  defaultPlayback: AudioEndpointInfo | null;
  communicationsPlayback: AudioEndpointInfo | null;
  consoleMicrophone: AudioEndpointInfo | null;
  defaultMicrophone: AudioEndpointInfo | null;
  communicationsMicrophone: AudioEndpointInfo | null;
  physicalPlaybackOutputs: AudioEndpointInfo[];
  spotifySessions: Array<{
    pid: number;
    processName: string;
    endpointId: string;
    endpointName: string;
    state: 'active' | 'inactive' | 'expired';
  }>;
  voiceMeeter: { running: boolean; kind: string | null; a1OutputName: string | null; a1MatchesWindowsPlaybackDefault?: boolean };
}

export interface MeterReading {
  endpointId: string;
  peakDb: number;
  timestamp: number;
}


export interface VoiceMeeterState {
  installed: boolean;
  running: boolean;
  kind: string | null;
  dllPath: string | null;
}

export interface VoiceMeeterConfigResult {
  ok: boolean;
  steps: Array<{ name: string; ok: boolean; detail?: string }>;
}

export interface VoiceMeeterRoutingState {
  running: boolean;
  ok?: boolean;
  kind?: string;
  musicEndpoint?: string | null;
  musicStrip?: number;
  b1BusIndex?: number;
  virtualMic?: string | null;
  micToB1?: boolean;
  musicToB1?: boolean;
  musicUnmuted?: boolean;
  b1Unmuted?: boolean;
  a1OutputName?: string | null;
  musicToA1?: boolean;
  a1Unmuted?: boolean;
  monitoringOk?: boolean;
  a1MatchesWindowsPlaybackDefault?: boolean;
  monitoringDetail?: string;
  detail?: string;
}


export type LinkStatus = 'ok' | 'pending' | 'fail';

export interface SetupCheck {
  id:
    | 'voicemeeter-installed'
    | 'voicemeeter-running'
    | 'routing-applied'
    | 'music-signal'
    | 'mic-signal'
    | 'vrchat-detect'
    | 'vrchat-capture';
  label: string;
  status: LinkStatus;
  detail?: string;
}

export type ServiceId = 'spotify' | 'ytmusic';

export interface AudioEndpointRoleBaseline {
  role: number;
  endpointId: string | null;
  endpointName: string | null;
  hasSavedValue: boolean;
}

export interface SpotifyRouteBaseline {
  pid: number;
  processName: string;
  endpoints: AudioEndpointRoleBaseline[];
}

export interface VoiceMeeterBaseline {
  kind: number;
  microphoneDevice: string;
  a1Output: string;
  musicEndpoint: string;
  musicStrip: number;
  micMute: number;
  micA1: number;
  micB1: number;
  micGain: number;
  musicMute: number;
  musicA1: number;
  musicB1: number;
  musicGain: number;
  a1Mute: number;
  b1Mute: number;
}

export interface AudioBaseline {
  capturedAt: string;
  spotifyRoutes: SpotifyRouteBaseline[];
  voiceMeeter: VoiceMeeterBaseline;
  musicVolumeDb: number;
  musicMutedToVrchat: boolean;
  duckingEnabled: boolean;
}

export interface AppState {
  setupComplete: boolean;
  audioBaseline: AudioBaseline | null;
  activeService: ServiceId | null;
  checks: SetupCheck[];
  musicMutedToVrchat: boolean;
  musicVolumeDb: number;
  duckingEnabled: boolean;
  micEndpointName: string | null;
  musicEndpointName: string | null;
  backgroundPath: string | null;
}


export interface BackgroundImage {
  path: string;
  name: string;
  url: string;
  animated: boolean;
  /** Wallpaper Engine video wallpapers stream from disk instead of a data URL. */
  video?: boolean;
  broken?: boolean;
  detail?: string;
}

/** One wallpaper found in the local Wallpaper Engine library. */
export interface WallpaperEntry {
  /** Workshop item id, or the folder name for your own projects. */
  id: string;
  source: 'workshop' | 'mine';
  title: string;
  /** Raw Wallpaper Engine type: 'video', 'scene', 'web', ... */
  type: string;
  /** What SPOTT can show: a playing video, a still/preview image, or nothing. */
  backgroundKind: 'video' | 'image' | 'none';
  previewPath: string | null;
  targetPath: string | null;
  /** Decorated per environment: wallpaper:// URL in Electron, /wallpaper-file in preview. */
  previewUrl: string | null;
  targetUrl: string | null;
}

export interface BridgeOpResult {
  pc?: import('./gaming').PcSnapshot;
  worlds?: import('./gaming').RecentWorld[];
  windowTitle?: string | null;
  media?: { title: string; artist?: string; status: string; source?: string; positionSeconds?: number; durationSeconds?: number } | null;
  battery?: { percent: number; charging: boolean } | null;
  instanceOccupancy?: number;
  lyricifyLyrics?: string;
  receiveBytesPerSecond?: number | null;
  sendBytesPerSecond?: number | null;
  appUptimeSeconds?: number;
  port?: number;
  currentWorld?: string | null;
  vrchatRunning?: boolean;
  ok: boolean;
  detail?: string;
  phase?: string;
  image?: BackgroundImage;
  wallpapers?: WallpaperEntry[];
  games?: SteamGame[];
  browserTabs?: Array<{ id: string; url: string; title: string; canBack: boolean; canForward: boolean; loading: boolean }>;
}


export interface SteamGame {
  id: string;
  name: string;
  installed: boolean;
  installDir: string;
  sizeOnDisk: number;
  lastPlayed: number;
  libraryPath: string;
  coverUrl: string;
  coverTallUrl: string;
}


export interface SidecarMethods {
  'endpoints.list': () => AudioEndpointInfo[];
  'audio.scanSettings': () => AudioSettingsScan;
  'audio.captureBaseline': () => AudioBaseline;
  'audio.restoreBaseline': (params: { baseline: AudioBaseline }) => VoiceMeeterConfigResult;
  'sessions.list': (params: { endpointId: string }) => AudioSessionInfo[];
  'sessions.findByProcess': (params: { endpointId: string; processName: string }) => AudioSessionInfo | null;

  'meter.start': (params: { endpointId: string }) => void;
  'meter.stop': (params: { endpointId: string }) => void;

  'vm.state': () => VoiceMeeterState;
  'vm.launch': () => void;
  'vm.applyConfig': (params: { micEndpointName?: string; speakersEndpointName?: string }) => VoiceMeeterConfigResult;
  'vm.routingState': () => VoiceMeeterRoutingState;
  'vm.setStripGain': (params: { strip: number; db: number }) => void;
  'vm.setBusMute': (params: { bus: number; mute: boolean }) => void;
  'vm.setDucking': (params: { enabled: boolean; thresholdDb: number; reductionDb: number }) => void;
  'vm.shutdown': () => void;

  'vm.setMusicToVrchat': (params: { on: boolean }) => boolean;

  'route.app': (params: {
    endpointName: string;
    processName?: string;
    pid?: number;
  }) => { ok: boolean; method: 'api' | 'manual'; detail?: string };
  'route.settingsDeepLink': (params: { page: 'apps-volume' }) => void;

  'ping': () => 'pong';
}


export interface SidecarEvents {
  'meter.update': MeterReading;
  'log': { level: 'info' | 'warn' | 'error'; message: string };
}
