export async function applyMusicSend(
  on: boolean,
  call: (method: string, params: { on: boolean }) => Promise<unknown>,
  persist: (patch: { musicMutedToVrchat: boolean }) => unknown | Promise<unknown>
): Promise<void> {
  const applied = await call('vm.setMusicToVrchat', { on });
  if (applied !== true) {
    throw new Error('VoiceMeeter did not apply the music-to-VRChat change. Apply VoiceMeeter routing again, then retry.');
  }
  await persist({ musicMutedToVrchat: !on });
}
