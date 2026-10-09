import { describe, expect, it, vi } from 'vitest';
import { applyMusicSend } from './audioControls';

describe('music-to-VRChat control acknowledgement', () => {
  it.each([false, null, undefined, { ok: true }])('does not persist an unacknowledged result: %j', async (result) => {
    const persist = vi.fn();
    await expect(applyMusicSend(false, async () => result, persist)).rejects.toThrow('Apply VoiceMeeter routing');
    expect(persist).not.toHaveBeenCalled();
  });
  it('does not persist when the RPC throws', async () => {
    const persist = vi.fn();
    await expect(applyMusicSend(true, async () => { throw new Error('sidecar offline'); }, persist)).rejects.toThrow('offline');
    expect(persist).not.toHaveBeenCalled();
  });
  it.each([true, false])('persists only after success for on=%s', async (on) => {
    const call = vi.fn(async () => true);
    const persist = vi.fn();
    await applyMusicSend(on, call, persist);
    expect(call).toHaveBeenCalledWith('vm.setMusicToVrchat', { on });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({ musicMutedToVrchat: !on });
  });
});
