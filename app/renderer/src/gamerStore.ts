import { useSyncExternalStore } from 'react';
import { DEFAULT_GAMER_PREFERENCES, normaliseGamerPreferences, type GamerPreferences } from '@shared/gaming';

const KEY = 'vcmb:gamer-preferences:v1';
let current: GamerPreferences = DEFAULT_GAMER_PREFERENCES;
let storageError = '';
try {
  current = normaliseGamerPreferences(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
} catch (error) {
  storageError = `Could not load saved preferences: ${error instanceof Error ? error.message : String(error)}`;
}
const listeners = new Set<() => void>();

export function saveGamerPreferences(patch: Partial<GamerPreferences>): void {
  const next = normaliseGamerPreferences({ ...current, ...patch });
  localStorage.setItem(KEY, JSON.stringify(next));
  current = next;
  storageError = '';
  listeners.forEach((listener) => listener());
}

export function useGamerPreferences(): GamerPreferences {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => current);
}

export function gamerStorageError(): string { return storageError; }

window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return;
  try {
    current = normaliseGamerPreferences(JSON.parse(event.newValue ?? '{}'));
    listeners.forEach((listener) => listener());
  } catch (error) { storageError = String(error); }
});
