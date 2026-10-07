import { describe, expect, it } from 'vitest';
import { chatboxPacket, parseRecentWorlds, sendChatbox } from './gaming';

const ID = 'wrld_12345678-1234-1234-1234-123456789abc';
describe('VRChat local log parser', () => {
  it('extracts transitions and names newest-first, without exposing unrelated lines', () => {
    const text = `[Behaviour] Joining ${ID}:123~private(456)\n[Behaviour] Entering Room: My Hangout\nSecret login token abc\n[Behaviour] Joining wrld_99999999-1234-1234-1234-123456789abc:789\n[Behaviour] Entering Room: Next Place`;
    const worlds = parseRecentWorlds(text);
    expect(worlds).toHaveLength(2);
    expect(worlds[0].name).toBe('Next Place');
    expect(worlds[1].instanceId).toBe('123~private(456)');
    expect(JSON.stringify(worlds)).not.toContain('Secret');
  });
  it('deduplicates and ignores malformed ids and non-transition messages', () => {
    expect(parseRecentWorlds(`[Behaviour] Joining ${ID}:123\n[Behaviour] Joining ${ID}:123\n[Behaviour] Joining wrld_bad\nUser says: ${ID}`)).toHaveLength(1);
  });
  it('bounds returned worlds to 30', () => {
    expect(parseRecentWorlds(Array.from({ length: 40 }, (_, i) => `[Behaviour] Joining ${ID}:${i}`).join('\n'))).toHaveLength(30);
  });
});

describe('OSC chatbox packet', () => {
  it('encodes address, padded type tags, UTF-8 text and boolean notification flag', () => {
    const packet = chatboxPacket('Hello 😀', false);
    expect(packet.length % 4).toBe(0);
    expect(packet.subarray(0, 16).toString()).toBe('/chatbox/input\0\0');
    expect(packet.subarray(16, 24).toString()).toBe(',sTF\0\0\0\0');
    expect(packet.subarray(24).toString()).toContain('Hello 😀\0');
    expect(chatboxPacket('Hello', true).subarray(16, 24).toString()).toContain(',sTT');
  });
  it('validates before opening a UDP socket', async () => {
    expect(() => chatboxPacket('x'.repeat(145), false)).toThrow('144');
    await expect(sendChatbox({ text: 'hello', sound: 'yes' })).rejects.toThrow('notification');
    await expect(sendChatbox({ text: '' })).rejects.toThrow();
    await expect(sendChatbox(null)).rejects.toThrow();
  });
});
