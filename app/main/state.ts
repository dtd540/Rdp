import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import type { AppState, AudioBaseline, ServiceId } from '@shared/rpc';

const DEFAULT_STATE: AppState = {
  setupComplete: false,
  activeService: null,
  checks: [],
  musicMutedToVrchat: false,
  musicVolumeDb: 0,
  duckingEnabled: true,
  micEndpointName: null,
  musicEndpointName: null,
  backgroundPath: null,
  audioBaseline: null
};

let cache: AppState | null = null;

function stateFile(): string {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path.join(dir, 'state.json');
}

export function getState(): AppState {
  if (cache) return cache;
  try {
    if (existsSync(stateFile())) {
      const raw = JSON.parse(readFileSync(stateFile(), 'utf8')) as Partial<AppState>;
      cache = { ...DEFAULT_STATE, ...raw, audioBaseline: raw.audioBaseline ?? null };
      return cache;
    }
  } catch (err) {
    console.error('[state] failed to read, using defaults:', err);
  }
  cache = { ...DEFAULT_STATE };
  return cache;
}

export function setState(patch: Partial<AppState>): AppState {
  const next = { ...getState(), ...patch };
  cache = next;
  try {
    writeFileSync(stateFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.error('[state] failed to persist:', err);
  }
  return next;
}

export function saveAudioBaseline(baseline: AudioBaseline): AppState {
  return setState({ audioBaseline: baseline });
}

export function resetState(): AppState {
  cache = { ...DEFAULT_STATE };
  return getState();
}

export type { AppState, ServiceId };
