import { describe, expect, it } from 'vitest';
import { bridge, pickMusicEndpoint, pickMics, pickVmOutput } from './bridge';
import type { AudioSettingsScan } from './bridge';
import type { AudioEndpointInfo } from './bridge';

const eps: AudioEndpointInfo[] = [
  { id: '{r}.1', name: 'Speakers (Realtek)', direction: 'render', isDefault: true },
  { id: '{r}.2', name: 'VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)', direction: 'render', isDefault: false },
  { id: '{r}.3', name: 'VoiceMeeter Aux Input (VB-Audio VoiceMeeter VAIO AUX)', direction: 'render', isDefault: false },
  { id: '{c}.1', name: 'Line 1 (Virtual Audio Cable)', direction: 'capture', isDefault: true },
  { id: '{c}.2', name: 'Microphone Array (Intel SST)', direction: 'capture', isDefault: false },
  { id: '{c}.3', name: 'VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)', direction: 'capture', isDefault: false },
  { id: '{c}.4', name: 'CABLE Output (VB-Audio CABLE)', direction: 'capture', isDefault: false }
];

describe('pickMusicEndpoint', () => {
  it('prefers the VoiceMeeter Aux Input strip', () => {
    expect(pickMusicEndpoint(eps)?.id).toBe('{r}.3');
  });

  it('falls back to VoiceMeeter Input when Aux is absent', () => {
    const withoutAux = eps.filter((e) => !/Aux/i.test(e.name));
    expect(pickMusicEndpoint(withoutAux)?.id).toBe('{r}.2');
  });

  it('returns undefined when VoiceMeeter is not installed', () => {
    expect(pickMusicEndpoint([eps[0]])).toBeUndefined();
  });
});

describe('pickVmOutput', () => {
  it('finds the VoiceMeeter Output capture endpoint (VRChat mic)', () => {
    expect(pickVmOutput(eps)?.id).toBe('{c}.3');
  });

  it('never matches render endpoints', () => {
    expect(pickVmOutput(eps.filter((e) => e.direction === 'render'))).toBeUndefined();
  });
});

describe('pickMics', () => {
  it('excludes every virtual cable so voice wins over the music device', () => {
    const mics = pickMics(eps);
    expect(mics.map((m) => m.id)).toEqual(['{c}.2']);
  });
});

describe('browser mock bridge (preview mode)', () => {
  it('serves mock endpoints and VoiceMeeter state', async () => {
    const endpoints = (await bridge.call('endpoints.list')) as AudioEndpointInfo[];
    expect(endpoints.length).toBeGreaterThan(0);
    const vm = (await bridge.call('vm.state')) as { running: boolean; kind: string };
    expect(vm.running).toBe(true);
    expect(vm.kind).toBe('Potato');
  });

  it('provides a read-only audio settings snapshot before applying', async () => {
    const scan = (await bridge.call('audio.scanSettings')) as AudioSettingsScan;
    expect(scan.defaultPlayback?.name).toContain('Speakers');
    expect(scan.defaultMicrophone?.name).toContain('Microphone');
    expect(scan.physicalPlaybackOutputs).toHaveLength(1);
    expect(scan.spotifySessions[0].endpointName).toContain('VoiceMeeter Aux Input');
    expect(scan.voiceMeeter.a1OutputName).toContain('Speakers');
  });

  it('reports all-healthy config steps with the documented step names', async () => {
    const res = (await bridge.call('vm.applyConfig', {})) as {
      ok: boolean;
      steps: { name: string; ok: boolean }[];
    };
    expect(res.ok).toBe(true);
    expect(res.steps.map((s) => s.name)).toEqual([
      'engine',
      'a1-output-scan',
      'music-endpoint',
      'mic-device',
      'a1-output',
      'strip-routing',
      'buses'
    ]);
    expect(res.steps.every((s) => s.ok)).toBe(true);
  });

  it('returns route results in the shared { ok, method } shape', async () => {
    const res = (await bridge.call('route.app', { endpointName: 'VoiceMeeter Aux Input' })) as {
      ok: boolean;
      method?: string;
    };
    expect(res.ok).toBe(true);
    expect(res.method).toBe('api');
  });

  it('persists state patches across reads', async () => {
    const next = await bridge.setState({ musicMutedToVrchat: true });
    expect(next.musicMutedToVrchat).toBe(true);
    expect((await bridge.getState()).musicMutedToVrchat).toBe(true);
    await bridge.setState({ musicMutedToVrchat: false });
  });

  it('pushes simulated meter ticks to subscribers', async () => {
    const events: { endpointId: string; peakDb: number }[] = [];
    const off = bridge.on((_m, params) => events.push(params as { endpointId: string; peakDb: number }));
    await new Promise((r) => setTimeout(r, 400));
    off();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].endpointId).toContain('{');
    expect(events[0].peakDb).toBeLessThanOrEqual(-3);
  });

  it('reports no app background until one is picked', async () => {
    const cleared = await bridge.op('clearBackground');
    expect(cleared.ok).toBe(true);
    const read = await bridge.op('getBackground');
    expect(read.ok).toBe(true);
    expect(read.image).toBeUndefined();
    expect((await bridge.getState()).backgroundPath).toBeNull();
  });

  it('says the preview cannot open a native file dialog instead of throwing', async () => {
    const picked = await bridge.op('pickBackgroundImage');
    expect(picked.ok).toBe(false);
    expect(picked.detail).toMatch(/desktop app/i);
    expect(picked.image).toBeUndefined();
  });
});
