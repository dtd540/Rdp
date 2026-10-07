/**
 * JSON-RPC protocol shared between Electron main <-> sidecar (stdio)
 * and main <-> renderer (IPC mirrors these shapes).
 *
 * Framing: newline-delimited JSON. One message per line.
 *   Request:  { id, method, params? }
 *   Response: { id, result? , error? }   (exactly one of result/error)
 *   Event:    { method, params }          (no id — sidecar -> main push, e.g. meter ticks)
 */

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

// ---------- Domain types ----------

export interface AudioEndpointInfo {
  /** WASAPI endpoint ID (GUID form), stable across reboots */
  id: string;
  /** Friendly name, e.g. "VoiceMeeter Aux Input" */
  name: string;
  direction: 'render' | 'capture';
  isDefault: boolean;
}

export interface AudioSessionInfo {
  pid: number;
  processName: string;
  /** Display name Windows shows in the volume mixer */
  displayName: string;
  state: 'active' | 'inactive' | 'expired';
}

/** Read-only Windows playback/microphone defaults and Spotify session routes. */
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
  /** Peak level in dBFS, -100..0 */
  peakDb: number;
  timestamp: number;
}

// ---------- VoiceMeeter ----------

export interface VoiceMeeterState {
  installed: boolean;
  running: boolean;
  /** "Voicemeeter" | "Banana" | "Potato" | null */
  kind: string | null;
  dllPath: string | null;
}

export interface VoiceMeeterConfigResult {
  ok: boolean;
  steps: Array<{ name: string; ok: boolean; detail?: string }>;
}

/** Read-back of the exact VoiceMeeter send/bus path feeding the VRChat virtual mic. */
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

// ---------- Setup / verification ----------

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

export interface AppState {
  setupComplete: boolean;
  activeService: ServiceId | null;
  checks: SetupCheck[];
  musicMutedToVrchat: boolean;
  musicVolumeDb: number;
  duckingEnabled: boolean;
  /** Friendly name of the user's microphone (VoiceMeeter HW strip 1 device). */
  micEndpointName: string | null;
  /** Friendly name of the VoiceMeeter virtual input music is routed to. */
  musicEndpointName: string | null;
  /** Absolute path of the picture/GIF painted behind the app, null for the default dark theme. */
  backgroundPath: string | null;
}

// ---------- Appearance ----------

/** A user-chosen app background, resolved from `AppState.backgroundPath`. */
export interface BackgroundImage {
  /** Absolute path on this PC; empty when nothing is picked. */
  path: string;
  /** File name for display, e.g. `city-lights.gif`. */
  name: string;
  /** Data URL ready for CSS `background-image`; empty when `broken`. */
  url: string;
  /** True for animated GIFs, which the UI calls out. */
  animated: boolean;
  /** Set when the file moved, is unsupported, or is too large to read. */
  broken?: boolean;
  /** Why the background can't be shown, when `broken` is set. */
  detail?: string;
}

/** Result of a `bridge:op` call. The background ops also hand back the image. */
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
  currentWorld?: string | null;
  vrchatRunning?: boolean;
  ok: boolean;
  detail?: string;
  phase?: string;
  image?: BackgroundImage;
  /** Set by the games ops. */
  games?: SteamGame[];
  /** Live native browser views after a `browser:sync`, in tab order. */
  browserTabs?: Array<{ id: string; url: string; title: string; canBack: boolean; canForward: boolean; loading: boolean }>;
}

// ---------- Games ----------

/** One Steam title, read off this PC. */
export interface SteamGame {
  /** Steam app id, e.g. `431960`. */
  id: string;
  name: string;
  /** False when the title is in the Steam library but not installed on disk. */
  installed: boolean;
  /** Absolute install folder; empty unless installed. */
  installDir: string;
  sizeOnDisk: number;
  /** Unix seconds; 0 means never played. */
  lastPlayed: number;
  /** The library root this title was found under. */
  libraryPath: string;
  /** Wide store art. */
  coverUrl: string;
  /** Tall store art for the portrait column. */
  coverTallUrl: string;
}

// ---------- Methods (main -> sidecar) ----------

export interface SidecarMethods {
  // Discovery
  'endpoints.list': () => AudioEndpointInfo[];
  'audio.scanSettings': () => AudioSettingsScan;
  'sessions.list': (params: { endpointId: string }) => AudioSessionInfo[];
  'sessions.findByProcess': (params: { endpointId: string; processName: string }) => AudioSessionInfo | null;

  // Meters
  'meter.start': (params: { endpointId: string }) => void;
  'meter.stop': (params: { endpointId: string }) => void;

  // VoiceMeeter
  'vm.state': () => VoiceMeeterState;
  'vm.launch': () => void;
  'vm.applyConfig': (params: { micEndpointName?: string; speakersEndpointName?: string }) => VoiceMeeterConfigResult;
  'vm.routingState': () => VoiceMeeterRoutingState;
  'vm.setStripGain': (params: { strip: number; db: number }) => void;
  'vm.setBusMute': (params: { bus: number; mute: boolean }) => void;
  'vm.setDucking': (params: { enabled: boolean; thresholdDb: number; reductionDb: number }) => void;
  'vm.shutdown': () => void;

  'vm.setMusicToVrchat': (params: { on: boolean }) => boolean;

  // Per-app routing (Spotify etc.)
  'route.app': (params: {
    endpointName: string;
    processName?: string;
    pid?: number;
  }) => { ok: boolean; method: 'api' | 'manual'; detail?: string };
  'route.settingsDeepLink': (params: { page: 'apps-volume' }) => void;

  // Health
  'ping': () => 'pong';
}

// ---------- Events (sidecar -> main) ----------

export interface SidecarEvents {
  'meter.update': MeterReading;
  'log': { level: 'info' | 'warn' | 'error'; message: string };
}
