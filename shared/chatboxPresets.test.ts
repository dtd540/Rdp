import { describe, expect, it } from 'vitest';
import { applyChatIntegrationPreset, CHAT_INTEGRATION_PRESETS, matchingChatIntegrationPreset } from './chatboxPresets';
import { DEFAULT_CHAT_INTEGRATIONS } from './chatboxIntegrations';

describe('chatbox integration presets', () => {
  it('offers bounded-purpose presets and applies the chosen module set', () => {
    const vrchat = applyChatIntegrationPreset('vrchat', DEFAULT_CHAT_INTEGRATIONS);
    expect(CHAT_INTEGRATION_PRESETS.map(({ id }) => id)).toEqual(['minimal', 'vrchat', 'music', 'pc_stats']);
    expect(vrchat.filter((item) => item.enabled).map((item) => item.id)).toEqual(['personal_status', 'current_time', 'current_world']);
    expect(matchingChatIntegrationPreset(vrchat)).toBe('vrchat');
    const reordered = [...vrchat.slice(1), vrchat[0]];
    expect(matchingChatIntegrationPreset(reordered)).toBe('vrchat');
    expect(applyChatIntegrationPreset('unknown', vrchat)).toBe(vrchat);
  });
});
