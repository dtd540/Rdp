import { describe, expect, it } from 'vitest';
import { networkRatesBetween } from './netStats';

const base = { receivedBytes: 1000, sentBytes: 500, sampledAtMs: 1_000_000 };

describe('network throughput sampling', () => {
  it('derives per-second rates from two cumulative counter reads', () => {
    const later = { receivedBytes: 1000 + 1_572_864, sentBytes: 500 + 245_760, sampledAtMs: 1_010_000 };
    expect(networkRatesBetween(base, later)).toEqual({ receiveBytesPerSecond: 157286.4, sendBytesPerSecond: 24576 });
  });

  it('reports nothing until there are two samples to compare', () => {
    expect(networkRatesBetween(null, base)).toEqual({ receiveBytesPerSecond: null, sendBytesPerSecond: null });
  });

  it('refuses to guess when time stands still or an adapter resets its counters', () => {
    expect(networkRatesBetween(base, base)).toEqual({ receiveBytesPerSecond: null, sendBytesPerSecond: null });
    expect(networkRatesBetween(base, { ...base, sampledAtMs: 999_000 })).toEqual({ receiveBytesPerSecond: null, sendBytesPerSecond: null });
    const reset = { receivedBytes: 10, sentBytes: 20, sampledAtMs: 1_010_000 };
    expect(networkRatesBetween(base, reset)).toEqual({ receiveBytesPerSecond: null, sendBytesPerSecond: null });
  });

  it('keeps a usable half when only one direction moved backwards', () => {
    const mixed = { receivedBytes: 1000 + 2048, sentBytes: 10, sampledAtMs: 1_002_000 };
    expect(networkRatesBetween(base, mixed)).toEqual({ receiveBytesPerSecond: 1024, sendBytesPerSecond: null });
  });
});
