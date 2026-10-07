import { validateChatText } from './gaming';
import { renderChatTemplate, type ChatContext, type ChatTemplate } from './chatbox';

export type ChatIntegrationId =
  | 'personal_status'
  | 'window_activity'
  | 'manager_tab'
  | 'current_time'
  | 'media_status'
  | 'lyricify_lyrics'
  | 'component_and_network_stats'
  | 'system_stats'
  | 'current_world'
  | 'instance_players'
  | 'app_uptime'
  | 'pc_battery'
  | 'current_date';

export interface ChatIntegrationDefinition {
  id: ChatIntegrationId;
  label: string;
  description: string;
  source: 'local' | 'external';
  defaultEnabled: boolean;
  emoji: string;
  format: string;
}

export const CHAT_INTEGRATIONS: ChatIntegrationDefinition[] = [
  { id: 'personal_status', label: 'Personal status', description: 'Write a personal status message that appears in the chatbox.', source: 'local', defaultEnabled: false, emoji: '💭', format: '{emoji} {value}' },
  { id: 'window_activity', label: 'Window activity', description: 'Show the active foreground window title on this PC. Titles can contain private information; enable it only if you are comfortable sharing it nearby.', source: 'local', defaultEnabled: false, emoji: '🪟', format: '{emoji} {value}' },
  { id: 'manager_tab', label: 'Current app tab', description: 'Shows the active tab inside VRChat Music Bridge.', source: 'local', defaultEnabled: false, emoji: '📑', format: '{emoji} {value}' },
  { id: 'current_time', label: 'Current time', description: 'Show the current time on this PC in the chatbox.', source: 'local', defaultEnabled: false, emoji: '🕐', format: '{emoji} {value}' },
  { id: 'media_status', label: 'Media status', description: 'Show the title, artist, and playback progress of your current media session when available.', source: 'local', defaultEnabled: false, emoji: '🎵', format: '{emoji} {value}' },
  { id: 'lyricify_lyrics', label: 'Lyricify lyrics', description: 'Show the live synced lyric line for the song you are playing. No lyrics provider is connected here, so this stays unavailable.', source: 'external', defaultEnabled: false, emoji: '🎤', format: '{emoji} {value}' },
  { id: 'component_and_network_stats', label: 'Component & network stats', description: 'Show memory used by this app as a percentage of available memory.', source: 'local', defaultEnabled: false, emoji: '📊', format: '{emoji} {value}' },
  { id: 'system_stats', label: 'System stats', description: 'Show live CPU and memory usage of your PC.', source: 'local', defaultEnabled: false, emoji: '💻', format: '{emoji} {value}' },
  { id: 'current_world', label: 'Current world', description: 'Show the VRChat world you are currently in. Requires VRChat to be running and a recent local log to have a current world name.', source: 'local', defaultEnabled: false, emoji: '🌍', format: '{emoji} {value}' },
  { id: 'instance_players', label: 'Instance players', description: 'Show how many players are in your current VRChat instance. Live instance occupancy is not exposed by the local reader, so this stays unavailable.', source: 'external', defaultEnabled: false, emoji: '👥', format: '{emoji} {value}' },
  { id: 'app_uptime', label: 'Session uptime', description: 'How long VRChat Music Bridge has been running this session.', source: 'local', defaultEnabled: false, emoji: '⏱️', format: '{emoji} {value}' },
  { id: 'pc_battery', label: 'PC battery', description: 'Show your laptop/PC battery level if available.', source: 'local', defaultEnabled: false, emoji: '🔋', format: '{emoji} {value}' },
  { id: 'current_date', label: 'Current date', description: 'Show the current date in the chatbox.', source: 'local', defaultEnabled: false, emoji: '📅', format: '{emoji} {value}' }
];

export interface ChatIntegrationSetting {
  id: ChatIntegrationId;
  enabled: boolean;
  emoji: string;
  format: string;
  showEmoji: boolean;
}

export const DEFAULT_CHAT_INTEGRATIONS: ChatIntegrationSetting[] = CHAT_INTEGRATIONS.map(({ id, defaultEnabled, emoji, format }) => ({ id, enabled: defaultEnabled, emoji, format, showEmoji: true }));

const definitions = new Map(CHAT_INTEGRATIONS.map((item) => [item.id, item]));

export function normaliseChatIntegrations(raw: unknown): ChatIntegrationSetting[] {
  if (!Array.isArray(raw)) return DEFAULT_CHAT_INTEGRATIONS.map((item) => ({ ...item }));
  const saved = new Map<string, Partial<ChatIntegrationSetting>>();
  for (const item of raw.slice(0, CHAT_INTEGRATIONS.length * 2)) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !definitions.has(item.id as ChatIntegrationId)) continue;
    saved.set(item.id, item as Partial<ChatIntegrationSetting>);
  }
  const ordered = [...saved.keys()].map((id) => definitions.get(id as ChatIntegrationId)!).filter(Boolean);
  const allDefinitions = [...ordered, ...CHAT_INTEGRATIONS.filter((definition) => !saved.has(definition.id))];
  return allDefinitions.map((definition) => {
    const item = saved.get(definition.id);
    const format = typeof item?.format === 'string' && item.format.length <= 100 && !/[\r\n\x00-\x1f\x7f]/.test(item.format) && item.format.includes('{value}') ? item.format : definition.format;
    const emoji = typeof item?.emoji === 'string' && Array.from(item.emoji).length <= 8 && !/[\r\n\x00-\x1f\x7f]/.test(item.emoji) ? item.emoji : definition.emoji;
    const showEmoji = item?.showEmoji !== false;
    return { id: definition.id, enabled: item ? item.enabled === true : definition.defaultEnabled, emoji, format, showEmoji };
  });
}

function readable(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 144) : '';
}

export const CHAT_MESSAGE_FRAMES = {
  none: { label: 'None', top: '', bottom: '' },
  lines: { label: 'Lines', top: '━━━━━━━━', bottom: '━━━━━━━━' },
  dots: { label: 'Dots', top: '· · · · · · ·', bottom: '· · · · · · ·' },
  stars: { label: 'Stars', top: '★ ─────── ★', bottom: '★ ─────── ★' },
  sparkles: { label: 'Sparkles', top: '• · • · • · •', bottom: '• · • · • · •' },
  waves: { label: 'Waves', top: '～～～～～～', bottom: '～～～～～～' },
  hearts: { label: 'Hearts', top: '♡ · ♡ · ♡', bottom: '♡ · ♡ · ♡' },
  arrows: { label: 'Arrows', top: '▼ ▼ ▼ ▼ ▼', bottom: '▲ ▲ ▲ ▲ ▲' }
} as const;

export type ChatMessageFrameId = keyof typeof CHAT_MESSAGE_FRAMES | 'custom';

export function normaliseMessageFrame(raw: unknown): ChatMessageFrameId {
  return raw === 'custom' || (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(CHAT_MESSAGE_FRAMES, raw)) ? raw as ChatMessageFrameId : 'none';
}

export type ChatLineSeparator = 'newline' | 'pipe';
export function normaliseLineSeparator(raw: unknown): ChatLineSeparator {
  return raw === 'pipe' ? 'pipe' : 'newline';
}

export const CHAT_BORDER_STYLES = {
  none: { label: 'None', left: '', right: '' },
  brackets: { label: '[ Brackets ]', left: '[ ', right: ' ]' },
  parens: { label: '( Parentheses )', left: '( ', right: ' )' },
  corners: { label: '「 Corners 」', left: '「', right: '」' },
  angles: { label: '‹ Angles ›', left: '‹ ', right: ' ›' },
  stars: { label: '★ Stars ★', left: '★ ', right: ' ★' },
  sparkle: { label: '. Dots.', left: '· ', right: ' ·' },
  hearts: { label: '♡ Hearts ♡', left: '♡ ', right: ' ♡' },
  pipes: { label: '│ Pipes │', left: '│ ', right: ' │' },
  arrow: { label: '» Arrow', left: '» ', right: '' }
} as const;

export const CHAT_BORDER_STYLE_DESCRIPTIONS: Readonly<Record<ChatBorderStyleId, string>> = {
  none: 'No inline border. Each integration line is sent as plain text.',
  brackets: 'Wraps each integration line in [ brackets ] on the left and right.',
  parens: 'Wraps each integration line in ( parentheses ) on the left and right.',
  corners: 'Wraps each integration line in 「 corner brackets 」 on the left and right.',
  angles: 'Wraps each integration line in ‹ angle brackets › on the left and right.',
  stars: 'Wraps each integration line in ★ stars ★ on the left and right.',
  sparkle: 'Wraps each integration line in · dots · on the left and right.',
  hearts: 'Wraps each integration line in ♡ hearts ♡ on the left and right.',
  pipes: 'Wraps each integration line in │ pipes │ on the left and right.',
  arrow: 'Wraps each integration line in » arrow brackets on the left only.',
  custom: 'Uses your own characters for the left and right wrap of each line.'
};

export type ChatBorderStyleId = keyof typeof CHAT_BORDER_STYLES | 'custom';

export function normaliseBorderStyle(raw: unknown): ChatBorderStyleId {
  return raw === 'custom' || (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(CHAT_BORDER_STYLES, raw)) ? raw as ChatBorderStyleId : 'none';
}

export function applyBorder(text: string, style: ChatBorderStyleId, customLeft = '', customRight = ''): string {
  if (!text) return text;
  let left = '';
  let right = '';
  if (style === 'custom') {
    left = readable(customLeft).slice(0, 12);
    right = readable(customRight).slice(0, 12);
  } else {
    const preset = CHAT_BORDER_STYLES[style];
    left = preset?.left ?? '';
    right = preset?.right ?? '';
  }
  if (!left && !right) return text;
  return left + text + right;
}

export function applyMessageFrame(text: string, frame: ChatMessageFrameId, customTop = '', customBottom = ''): string {
  if (!text) return text;
  let top = '';
  let bottom = '';
  if (frame === 'custom') {
    top = readable(customTop).slice(0, 24);
    bottom = readable(customBottom).slice(0, 24);
  } else {
    const preset = CHAT_MESSAGE_FRAMES[frame];
    top = preset?.top ?? '';
    bottom = preset?.bottom ?? '';
  }
  if (!top && !bottom) return text;
  return [top, text, bottom].filter(Boolean).join('\n');
}

export function mediaProgressBar(positionSeconds: number | undefined, durationSeconds: number | undefined, cells = 15): string {
  if (!Number.isFinite(durationSeconds) || (durationSeconds ?? 0) <= 0 || !Number.isFinite(positionSeconds)) return '';
  const ratio = Math.max(0, Math.min(1, (positionSeconds ?? 0) / (durationSeconds ?? 1)));
  const playhead = Math.round(ratio * cells);
  let bar = '';
  for (let index = 0; index <= cells; index += 1) bar += index === playhead ? '●' : index < playhead ? '━' : '─';
  return bar;
}

function clockMinutes(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function composeChatIntegrations(
  base: string,
  settings: ChatIntegrationSetting[],
  values: Partial<Record<ChatIntegrationId, string>>,
  options: { separator?: ChatLineSeparator; frame?: ChatMessageFrameId; frameTop?: string; frameBottom?: string; borderStyle?: ChatBorderStyleId; borderLeft?: string; borderRight?: string } = {}
): string {
  const lines = settings.filter((item) => item.enabled).flatMap((item) => {
    const value = readable(values[item.id]);
    if (!value) return [];
    const emojiStr = item.showEmoji === false ? '' : readable(item.emoji);
    let rendered = item.format.includes('{emoji}')
      ? item.format.replaceAll('{emoji}', emojiStr).replaceAll('{value}', value).trim()
      : (emojiStr ? `${emojiStr} ${item.format.replaceAll('{value}', value).trim()}` : item.format.replaceAll('{value}', value).trim());
    rendered = applyBorder(rendered, normaliseBorderStyle(options.borderStyle ?? 'none'), options.borderLeft, options.borderRight);
    return rendered ? [rendered] : [];
  });
  const safeBase = typeof base === 'string' ? base.trim().split('\n').map((line) => line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim()).join('\n') : '';
  const separator = options.separator === 'pipe' ? ' ┆ ' : '\n';
  const joined = [safeBase, ...lines].filter(Boolean).join(separator);
  return applyMessageFrame(joined, normaliseMessageFrame(options.frame ?? 'none'), options.frameTop, options.frameBottom);
}

export function composeCycleIntegrations(
  templates: ChatTemplate[],
  context: ChatContext,
  settings: ChatIntegrationSetting[],
  values: Partial<Record<ChatIntegrationId, string>>,
  options: { separator?: ChatLineSeparator; frame?: ChatMessageFrameId; frameTop?: string; frameBottom?: string; borderStyle?: ChatBorderStyleId; borderLeft?: string; borderRight?: string } = {}
): Array<{ id: string; name: string; text: string }> {
  const cycle = templates.filter((template) => template.cycle);
  if (!cycle.length) throw new Error('Select at least one saved template for the cycle.');
  return cycle.map((template) => {
    const text = composeChatIntegrations(renderChatTemplate(template.text, context), settings, values, options);
    try { validateChatText(text); } catch (error) { throw new Error(`${template.name}: ${error instanceof Error ? error.message : String(error)}`); }
    return { id: template.id, name: template.name, text };
  });
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export interface ChatIntegrationOptions {
  windowQuoted?: boolean;
  mediaOnlyPlaying?: boolean;
  timePrefix?: boolean;
  timeZoneName?: boolean;
  mediaDashFormat?: boolean;
  mediaSource?: boolean;
  mediaProgress?: boolean;
  mediaProgressBar?: boolean;
  lyricifyOnlyPlaying?: boolean;
  worldPrefixed?: boolean;
  playersSuffixed?: boolean;
  uptimePrefixed?: boolean;
  batteryPrefixed?: boolean;
  borderStyle?: ChatBorderStyleId;
  borderLeft?: string;
  borderRight?: string;
}

export const DEFAULT_CHAT_INTEGRATION_OPTIONS: ChatIntegrationOptions = {
  windowQuoted: true, mediaOnlyPlaying: false, timePrefix: true, timeZoneName: false,
  mediaDashFormat: true, mediaSource: false, mediaProgress: false, mediaProgressBar: false,
  worldPrefixed: true, playersSuffixed: true, uptimePrefixed: true, batteryPrefixed: true,
  lyricifyOnlyPlaying: true, borderStyle: 'none', borderLeft: '', borderRight: ''
};

export function normaliseChatIntegrationOptions(raw: unknown): ChatIntegrationOptions {
  const value = raw && typeof raw === 'object' ? raw as Partial<ChatIntegrationOptions> : {};
  return {
    windowQuoted: value.windowQuoted !== false,
    mediaOnlyPlaying: value.mediaOnlyPlaying === true,
    timePrefix: value.timePrefix !== false,
    timeZoneName: value.timeZoneName === true,
    mediaDashFormat: value.mediaDashFormat !== false,
    mediaSource: value.mediaSource === true,
    mediaProgress: value.mediaProgress === true,
    mediaProgressBar: value.mediaProgressBar === true,
    worldPrefixed: value.worldPrefixed !== false,
    playersSuffixed: value.playersSuffixed !== false,
    uptimePrefixed: value.uptimePrefixed !== false,
    batteryPrefixed: value.batteryPrefixed !== false,
    lyricifyOnlyPlaying: value.lyricifyOnlyPlaying !== false,
    borderStyle: normaliseBorderStyle(value.borderStyle),
    borderLeft: typeof value.borderLeft === 'string' ? value.borderLeft.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 12) : '',
    borderRight: typeof value.borderRight === 'string' ? value.borderRight.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 12) : ''
  };
}

export function chatIntegrationValues(input: {
  context: ChatContext;
  activeTab: string;
  windowTitle?: string | null;
  media?: { title: string; artist?: string; status: string; positionSeconds?: number; durationSeconds?: number; source?: string } | null;
  cpuPercent?: number | null;
  cpuName?: string;
  memoryUsed?: number;
  memoryTotal?: number;
  receiveBytesPerSecond?: number | null;
  sendBytesPerSecond?: number | null;
  currentWorld?: string | null;
  vrchatRunning?: boolean;
  appUptimeSeconds?: number;
  battery?: { percent: number; charging: boolean } | null;
  instanceOccupancy?: number;
  lyricifyLyrics?: string;
  options?: ChatIntegrationOptions;
}): Partial<Record<ChatIntegrationId, string>> {
  const { context } = input;
  const options = { ...DEFAULT_CHAT_INTEGRATION_OPTIONS, ...input.options };
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit', minute: '2-digit',
    second: context.clockSeconds === false ? undefined : '2-digit',
    ...(context.clock24h !== undefined ? { hour12: !context.clock24h } : {}),
    ...(options.timeZoneName ? { timeZoneName: 'short' as const } : {})
  };
  const timeText = context.now.toLocaleTimeString([], timeOptions);
  const media = input.media;
  let mediaText = '';
  if (media && media.title && !(options.mediaOnlyPlaying && media.status !== 'playing')) {
    const artist = media.artist ? (options.mediaDashFormat ? `${media.title} - ${media.artist}` : `${media.artist} — ${media.title}`) : media.title;
    const source = options.mediaSource && media.source ? ` (${media.source})` : '';
    mediaText = artist + source;
    if (options.mediaProgress) {
      const progress = Number.isFinite(media.positionSeconds) || Number.isFinite(media.durationSeconds)
        ? (Number.isFinite(media.durationSeconds) && (media.durationSeconds ?? 0) > 0
          ? `${clockMinutes(media.positionSeconds ?? 0)} / ${clockMinutes(media.durationSeconds ?? 0)}`
          : clockMinutes(media.positionSeconds ?? 0))
        : '';
      if (progress) mediaText += ` ${progress}`;
    }
    if (options.mediaProgressBar) {
      const bar = mediaProgressBar(media.positionSeconds, media.durationSeconds);
      if (bar) mediaText += ` ${bar}`;
    }
  }
  const values: Partial<Record<ChatIntegrationId, string>> = {
    personal_status: context.status,
    window_activity: input.windowTitle ? (options.windowQuoted ? `On desktop in '${String(input.windowTitle).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim()}'` : input.windowTitle) : '',
    manager_tab: input.activeTab ? input.activeTab : '',
    current_time: options.timePrefix ? `My time: ${timeText}` : timeText,
    current_date: context.now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
    current_world: input.currentWorld ? (input.vrchatRunning === false ? '' : (options.worldPrefixed ? `In ${input.currentWorld}` : input.currentWorld)) : '',
    instance_players: input.instanceOccupancy != null ? `${input.instanceOccupancy} in instance` : '',
    lyricify_lyrics: input.lyricifyLyrics ?? '',
    app_uptime: input.appUptimeSeconds == null ? '' : (options.uptimePrefixed ? `Up ${formatUptime(input.appUptimeSeconds)}` : formatUptime(input.appUptimeSeconds)),
    system_stats: (Number.isFinite(input.cpuPercent ?? NaN) ? `CPU ${Math.round(input.cpuPercent ?? 0)}%` : '') + (input.memoryTotal != null && input.memoryUsed != null ? ` · RAM ${Math.round((input.memoryUsed / input.memoryTotal) * 100)}%` : ''),
    component_and_network_stats: input.memoryTotal != null && input.memoryUsed != null ? `Memory ${Math.round((input.memoryUsed / input.memoryTotal) * 100)}% used` : '',
    pc_battery: input.battery ? (options.batteryPrefixed ? `Battery ${input.battery.percent}% ${input.battery.charging ? '⚡' : ''}` : `${input.battery.percent}% ${input.battery.charging ? '⚡' : ''}`) : '',
    media_status: mediaText
  };
  return values;
}
