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
