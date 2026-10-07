import { renderChatTemplate, type ChatContext, type ChatTemplate } from './chatbox';
import { validateChatText } from './gaming';
import { normaliseChatIntegrationOptions, normaliseChatIntegrations, normaliseLineSeparator, normaliseMessageFrame, normaliseBorderStyle, type ChatBorderStyleId, type ChatIntegrationSetting, type ChatIntegrationOptions, type ChatLineSeparator, type ChatMessageFrameId } from './chatboxIntegrations';

export const SETTINGS_VERSION = 2;

export interface ChatboxSettings {
  version: number;
  activity: string;
  status: string;
  port: number;
  sound: boolean;
  sendImmediately: boolean;
  intervalSeconds: number;
  clock24h: boolean;
  clockSeconds: boolean;
  integrations: ChatIntegrationSetting[];
  integrationOptions: ChatIntegrationOptions;
  lineSeparator: ChatLineSeparator;
  messageFrame: ChatMessageFrameId;
  frameTop: string;
  frameBottom: string;
  borderStyle: ChatBorderStyleId;
  borderLeft: string;
  borderRight: string;
}
export const DEFAULT_CHATBOX_SETTINGS: ChatboxSettings = {
  version: SETTINGS_VERSION,
  activity: 'Hanging out in VRChat', status: 'Available to chat', port: 9000,
  sound: false, sendImmediately: true, intervalSeconds: 30, clock24h: false, clockSeconds: false, integrations: normaliseChatIntegrations(null),
  integrationOptions: normaliseChatIntegrationOptions(null), lineSeparator: 'newline', messageFrame: 'none', frameTop: '', frameBottom: '',
  borderStyle: 'none', borderLeft: '', borderRight: ''
};
export function normaliseChatboxSettings(raw: unknown): ChatboxSettings {
  const value = raw && typeof raw === 'object' ? raw as Partial<ChatboxSettings> : {};
  const integrations = normaliseChatIntegrations(value.integrations);
  const poisonedEmojiFlags = value.version !== SETTINGS_VERSION;
  return {
    version: SETTINGS_VERSION,
    activity: typeof value.activity === 'string' ? value.activity.slice(0, 60) : DEFAULT_CHATBOX_SETTINGS.activity,
    status: typeof value.status === 'string' ? value.status.slice(0, 60) : DEFAULT_CHATBOX_SETTINGS.status,
    port: Number.isInteger(value.port) && value.port! >= 1024 && value.port! <= 65535 ? value.port! : 9000,
    sound: value.sound === true, sendImmediately: value.sendImmediately !== false,
    intervalSeconds: [15, 30, 60, 120].includes(value.intervalSeconds ?? 0) ? value.intervalSeconds! : 30,
    clock24h: value.clock24h === true, clockSeconds: value.clockSeconds === true,
    integrations: poisonedEmojiFlags ? integrations.map((item) => ({ ...item, showEmoji: true })) : integrations,
    integrationOptions: normaliseChatIntegrationOptions(value.integrationOptions),
    lineSeparator: normaliseLineSeparator(value.lineSeparator),
    messageFrame: normaliseMessageFrame(value.messageFrame),
    frameTop: typeof value.frameTop === 'string' ? value.frameTop.slice(0, 24).replace(/[\r\n\x00-\x1f\x7f]/g, ' ') : '',
    frameBottom: typeof value.frameBottom === 'string' ? value.frameBottom.slice(0, 24).replace(/[\r\n\x00-\x1f\x7f]/g, ' ') : '',
    borderStyle: normaliseBorderStyle(value.borderStyle),
    borderLeft: typeof value.borderLeft === 'string' ? value.borderLeft.slice(0, 12).replace(/[\r\n\x00-\x1f\x7f]/g, ' ') : '',
    borderRight: typeof value.borderRight === 'string' ? value.borderRight.slice(0, 12).replace(/[\r\n\x00-\x1f\x7f]/g, ' ') : ''
  };
}

export function cycleOutputs(templates: ChatTemplate[], context: ChatContext): Array<{ id: string; name: string; text: string }> {
  const cycle = templates.filter((template) => template.cycle);
  if (!cycle.length) throw new Error('Select at least one saved template for the cycle.');
  return cycle.map((template) => {
    const text = renderChatTemplate(template.text, context);
    try { validateChatText(text); } catch (error) {
      throw new Error(`${template.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { id: template.id, name: template.name, text };
  });
}
