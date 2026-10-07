import type { SidecarClient } from './sidecar';

export interface NetworkCounters {
  receivedBytes: number;
  sentBytes: number;
  sampledAtMs: number;
}

export interface NetworkRates {
  receiveBytesPerSecond: number | null;
  sendBytesPerSecond: number | null;
}

export const UNKNOWN_NETWORK_RATES: NetworkRates = { receiveBytesPerSecond: null, sendBytesPerSecond: null };

let previous: NetworkCounters | null = null;

export function networkRatesBetween(earlier: NetworkCounters | null, later: NetworkCounters): NetworkRates {
  if (!earlier) return UNKNOWN_NETWORK_RATES;
  const seconds = (later.sampledAtMs - earlier.sampledAtMs) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return UNKNOWN_NETWORK_RATES;
  const receive = (later.receivedBytes - earlier.receivedBytes) / seconds;
  const send = (later.sentBytes - earlier.sentBytes) / seconds;
  return {
    receiveBytesPerSecond: receive >= 0 ? receive : null,
    sendBytesPerSecond: send >= 0 ? send : null
  };
}

function isCounters(raw: unknown): raw is NetworkCounters {
  if (!raw || typeof raw !== 'object') return false;
  const value = raw as Partial<NetworkCounters>;
  return Number.isFinite(value.receivedBytes) && Number.isFinite(value.sentBytes) && Number.isFinite(value.sampledAtMs);
}

export async function sampleNetworkRates(sidecar: SidecarClient): Promise<NetworkRates> {
  const raw = await sidecar.tryCall<NetworkCounters>('net.stats');
  if (!isCounters(raw)) {
    previous = null;
    return UNKNOWN_NETWORK_RATES;
  }
  const rates = networkRatesBetween(previous, raw);
  previous = raw;
  return rates;
}

export function resetNetworkCounters(): void {
  previous = null;
}
