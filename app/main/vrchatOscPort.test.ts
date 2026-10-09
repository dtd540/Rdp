import { describe, expect, it } from 'vitest';
import { selectVrchatOscReceivePort } from './vrchatOscPort';

describe('VRChat OSC receive port detection', () => {
  it('prefers an explicit OSC receive port from the running process', () => {
    expect(selectVrchatOscReceivePort({ running: true, configuredPorts: [9012], boundPorts: [9000, 9001] })).toBe(9012);
  });

  it('uses a single bound OSC endpoint when no launch port is specified', () => {
    expect(selectVrchatOscReceivePort({ running: true, configuredPorts: [], boundPorts: [9123] })).toBe(9123);
  });

  it('refuses to guess when the process, configured ports, or bound endpoints are ambiguous', () => {
    expect(selectVrchatOscReceivePort({ running: false, configuredPorts: [9000], boundPorts: [9000] })).toBeUndefined();
    expect(selectVrchatOscReceivePort({ running: true, configuredPorts: [9000, 9010], boundPorts: [9000] })).toBeUndefined();
    expect(selectVrchatOscReceivePort({ running: true, configuredPorts: [], boundPorts: [9000, 9010] })).toBeUndefined();
  });

  it('ignores malformed and out-of-range port data', () => {
    expect(selectVrchatOscReceivePort({ running: true, configuredPorts: ['9000', 1], boundPorts: [9000, 65536] })).toBe(9000);
    expect(selectVrchatOscReceivePort({ running: true, configuredPorts: [], boundPorts: [1, 65536] })).toBeUndefined();
  });
});
