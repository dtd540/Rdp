import { DEFAULT_CHAT_INTEGRATIONS, type ChatIntegrationId, type ChatIntegrationSetting } from './chatboxIntegrations';

export interface ChatIntegrationPreset { id: string; label: string; description: string; enabled: ChatIntegrationId[] }
export const CHAT_INTEGRATION_PRESETS: ChatIntegrationPreset[] = [
  { id: 'minimal', label: 'Minimal', description: 'No extra system details.', enabled: [] },
  { id: 'vrchat', label: 'VRChat session', description: 'Show current world, status, and local time.', enabled: ['personal_status', 'current_time', 'current_world'] },
  { id: 'music', label: 'Now playing', description: 'Share current media title and playback state.', enabled: ['personal_status', 'media_status'] },
  { id: 'pc_stats', label: 'PC stats', description: 'Share CPU, memory, and system uptime.', enabled: ['system_stats', 'app_uptime'] }
];
export function applyChatIntegrationPreset(presetId: string, current: ChatIntegrationSetting[]): ChatIntegrationSetting[] {
  const preset = CHAT_INTEGRATION_PRESETS.find((item) => item.id === presetId);
  return preset ? current.map((item) => ({ ...item, enabled: preset.enabled.includes(item.id) })) : current;
}

export function matchingChatIntegrationPreset(settings: ChatIntegrationSetting[]): string {
  const enabled = new Set(settings.filter((item) => item.enabled).map((item) => item.id));
  return CHAT_INTEGRATION_PRESETS.find((preset) => preset.enabled.length === enabled.size && preset.enabled.every((id) => enabled.has(id)))?.id ?? 'custom';
}
