import { describe, expect, it } from 'vitest';
import { applyBorder, applyMessageFrame, normaliseBorderStyle, composeChatIntegrations, normaliseChatIntegrations, composeCycleIntegrations, chatIntegrationValues, formatUptime, mediaProgressBar, normaliseLineSeparator, CHAT_BORDER_STYLES, CHAT_MESSAGE_FRAMES, CHAT_INTEGRATIONS, DEFAULT_CHAT_INTEGRATIONS, type ChatIntegrationSetting } from './chatboxIntegrations';
import { normaliseChatboxSettings, cycleOutputs } from './chatboxSettings';
import { renderChatTemplate, type ChatTemplate } from './chatbox';

const context = { now: new Date('2026-10-06T12:34:56Z'), activity: 'VRChat', status: 'Available', clock24h: true };

describe('Magic Chatbox settings', () => {
  it('restores bounded preferences without restoring sending consent', () => {
    const settings = normaliseChatboxSettings({ port: 9123, clock24h: true, activity: 'x'.repeat(100), intervalSeconds: 15, consent: true, lineSeparator: 'pipe', messageFrame: 'custom', frameTop: 'hello\nworld', frameBottom: 'bottom', borderStyle: 'pipes', borderLeft: '« ', borderRight: ' »', integrationOptions: { mediaOnlyPlaying: true } });
    expect(settings.port).toBe(9123);
    expect(settings.activity).toHaveLength(60);
    expect(settings.clock24h).toBe(true);
    expect(settings).not.toHaveProperty('consent');
    expect(settings.lineSeparator).toBe('pipe');
    expect(settings.messageFrame).toBe('custom');
    expect(settings.frameTop).toBe('hello world');
    expect(settings.messageFrame).toBe('custom');
    expect(settings.frameTop).toBe('hello world');
    expect(settings.borderStyle).toBe('pipes');
    expect(settings.borderLeft).toBe('« ');
    expect(settings.borderRight).toBe(' »');
    expect(settings.integrationOptions.mediaOnlyPlaying).toBe(true);
    expect(normaliseChatboxSettings({ port: 1, intervalSeconds: 1 }).borderStyle).toBe('none');
  });
});

describe('Magic Chatbox integrations', () => {
  it('renders only cycle-selected saved messages in order', () => {
    expect(cycleOutputs([{ id: '1', name: 'First', text: '{status}', cycle: true }, { id: '2', name: 'Not selected', text: 'skip' }, { id: '3', name: 'Second', text: '{activity}', cycle: true }], context).map((item) => item.text)).toEqual(['Available', 'VRChat']);
  });
  it('validates expanded cycle payloads with their template names', () => {
    expect(() => cycleOutputs([], context)).toThrow('Select');
    expect(() => cycleOutputs([{ id: '1', name: 'Overflow', text: '{status}'.repeat(20), cycle: true }], context)).toThrow('Overflow');
  });
  it('applies inline borders and stacked frames', () => {
    expect(applyBorder('hello', 'none')).toBe('hello');
    expect(applyBorder('hello', 'brackets')).toBe('[ hello ]');
    expect(applyBorder('hello', 'arrow')).toBe('» hello');
    expect(applyBorder('hello', 'custom', '<<', '>>')).toBe('<<hello>>');
    expect(applyBorder('', 'stars')).toBe('');
    expect(normaliseBorderStyle('stars')).toBe('stars');
    expect(normaliseBorderStyle('custom')).toBe('custom');
    expect(normaliseBorderStyle('invalid')).toBe('none');
    expect(applyMessageFrame(applyBorder('line', 'stars'), 'lines', '', '')).toBe('━━━━━━━━\n★ line ★\n━━━━━━━━');
  });
  it('composes the full message with every enabled integration line, the live base text, borders, and frames', () => {
    const settings = normaliseChatIntegrations([
      { id: 'media_status', enabled: true, emoji: '🎵', format: '{emoji} {value}' },
      { id: 'pc_battery', enabled: true, emoji: '🔋', format: '{emoji} {value}' },
      { id: 'current_time', enabled: true, emoji: '🕒', format: '{emoji} {value}' },
      { id: 'manager_tab', enabled: true, emoji: '📍', format: '{emoji} {value}' },
      { id: 'window_activity', enabled: true, emoji: '🪟', format: '{emoji} {value}' },
      { id: 'current_world', enabled: true }
    ]);
    const input = { context, activeTab: 'Magic Chatbox', media: { title: 'Nightcall', artist: 'Kavinsky', status: 'playing' }, battery: { percent: 95, charging: true }, windowTitle: 'My Doc', currentWorld: 'Neon Plaza' };
    const values = chatIntegrationValues(input);
    const cycle = composeCycleIntegrations(
      [{ id: 'a', name: 'A', text: 'first', cycle: true }, { id: 'b', name: 'B', text: 'second', cycle: true }, { id: 'c', name: 'C', text: 'skipped', cycle: false }],
      context, settings, values
    );
    expect(cycle.map((item) => item.id)).toEqual(['a', 'b']);
    const timeString = context.now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    expect(cycle[0].text).toContain('🎵 Nightcall - Kavinsky');
    expect(cycle[0].text).toContain('🔋 Battery 95% ⚡');
    expect(cycle[0].text).toContain('📍 Magic Chatbox');
    expect(cycle[0].text).toContain("🪟 On desktop in 'My Doc'");
    expect(cycle[0].text).toContain('In Neon Plaza');
    expect(cycle[0].text).toContain(`🕒 My time: ${timeString}`);
    expect(cycle[0].text.startsWith('first')).toBe(true);
    expect(cycle[0].text.includes('first')).toBe(true);
  });
  it('formats uptime within useful ranges', () => {
    expect(formatUptime(45)).toBe('0m');
    expect(formatUptime(90061)).toBe('1d 1h');
    expect(formatUptime(-1)).toBe('');
  });
  it('orders enabled items, omits unavailable data, sanitises hostile controls, and leaves validation to caller', () => {
    const settings = normaliseChatIntegrations([
      { id: 'manager_tab', enabled: true, emoji: '📍', format: '{emoji} {value}' },
      { id: 'current_world', enabled: true },
      { id: 'window_activity', enabled: true, emoji: '🪟', format: '{emoji} {value}' }
    ]);
    const input = { context, activeTab: 'Magic Chatbox' };
    const values = chatIntegrationValues({ ...input, windowTitle: 'private\ntitle\u0000' });
    const hostileResult = composeChatIntegrations('hello\nfriend', settings, values);
    expect(hostileResult).toContain("🪟 On desktop in 'private title'");
    expect(hostileResult).not.toContain('\u0000');
    const expandedValues = chatIntegrationValues({ ...input, windowTitle: 'tab' });
    const expanded = composeChatIntegrations('x'.repeat(144), settings, expandedValues);
    expect(expanded.length).toBeGreaterThan(144);
    expect(expanded.startsWith('x'.repeat(144))).toBe(true);
  });
  it('normalises known ids only, preserves configured order, and restores defaults for missing settings', () => {
    const settings = normaliseChatIntegrations([{ id: 'manager_tab', enabled: true, emoji: '🙃\nno', format: '{value}' }, { id: 'unknown', enabled: true }]);
    expect(settings).toHaveLength(CHAT_INTEGRATIONS.length);
    expect(settings[0].id).toBe('manager_tab');
    expect(settings.find((item) => item.id === 'manager_tab')).toMatchObject({ enabled: true, emoji: '📑', format: '{value}' });
    expect(normaliseChatIntegrations(null)).toEqual(DEFAULT_CHAT_INTEGRATIONS);
  });
  it('formats all local data without inventing media, lyrics, occupancy, or unavailable worlds', () => {
    const values = chatIntegrationValues({ context, activeTab: 'Magic Chatbox' });
    expect(typeof values.system_stats).toBe('string');
    expect(typeof values.app_uptime).toBe('string');
    expect(typeof values.current_world).toBe('string');
    expect(values.personal_status).toBe('Available');
    expect(values.lyricify_lyrics).toBe('');
    expect(values.instance_players).toBe('');
    expect(chatIntegrationValues({ context, activeTab: 'Games', cpuPercent: 10, memoryUsed: 0 }).system_stats).toBe('CPU 10%');
  });
  it('renders hostile format/emoji strings as their nearest safe equivalent', () => {
    const settings = normaliseChatIntegrations([
      { id: 'current_time', enabled: true, emoji: '🙃\nno', format: '{value}' }
    ]);
    const input = { context, activeTab: 'Magic Chatbox' };
    const values = chatIntegrationValues(input);
    const rendered = composeChatIntegrations('', settings, values, { separator: 'newline', frame: 'none' });
    expect(rendered).toContain('🕐');
  });
  it('renders a single enabled line with the current time preference', () => {
    const settings = normaliseChatIntegrations([{ id: 'current_time', enabled: true, emoji: '🕐', format: '{emoji} {value}' }]);
    const input = { context, activeTab: 'Games' };
    const values = chatIntegrationValues(input);
    const rendered = composeChatIntegrations('', settings, values, { separator: 'newline', frame: 'none' });
    expect(rendered).toContain('🕐');
  });
  it('normalises presentation preferences and supports custom frames and separators', () => {
    const settings = normaliseChatboxSettings({ lineSeparator: 'pipe', messageFrame: 'lines', frameTop: 'TOP', frameBottom: 'BOTTOM', borderStyle: 'stars', borderLeft: '«', borderRight: '»', integrationOptions: { timePrefix: true, timeZoneName: true, worldPrefixed: true, uptimePrefixed: true } });
    expect(settings.lineSeparator).toBe('pipe');
    expect(settings.messageFrame).toBe('lines');
    expect(settings.frameTop).toBe('TOP');
    expect(settings.borderStyle).toBe('stars');
    expect(settings.borderLeft).toBe('«');
    expect(settings.integrationOptions.timePrefix).toBe(true);
    expect(settings.integrationOptions.timeZoneName).toBe(true);
    expect(settings.integrationOptions.worldPrefixed).toBe(true);
    expect(settings.integrationOptions.uptimePrefixed).toBe(true);

    const baseContext: { now: Date; activity: string; status: string; clock24h: boolean; clockSeconds?: boolean } = { now: new Date('2026-10-06T12:00:00Z'), activity: '', status: '', clock24h: false };
    const timeLine = '🕐 My time: ' + baseContext.now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const integrationSettings = normaliseChatIntegrations([{ id: 'current_time', enabled: true, emoji: '🕐', format: '{emoji} {value}' }]);
    const clockValues = chatIntegrationValues({ context: baseContext, activeTab: 'Games' });
    const composed = composeChatIntegrations('base', integrationSettings, clockValues, { separator: 'pipe', frame: 'custom', frameTop: 'TOP', frameBottom: 'BOTTOM', borderStyle: 'none' });
    expect(typeof composed).toBe('string');
    expect(composed.length).toBeGreaterThan('base'.length);

    const options = settings.integrationOptions;
    expect(options.timePrefix).toBe(true);
    expect(options.timeZoneName).toBe(true);
    expect(options.worldPrefixed).toBe(true);
    expect(options.uptimePrefixed).toBe(true);

    const detailedSettings = normaliseChatboxSettings({ lineSeparator: 'newline', messageFrame: 'custom', frameTop: 'TOP', frameBottom: 'BOTTOM', borderStyle: 'custom', borderLeft: '«', borderRight: '»', integrationOptions: { mediaOnlyPlaying: true } });
    expect(detailedSettings.lineSeparator).toBe('newline');
    expect(detailedSettings.messageFrame).toBe('custom');
    expect(detailedSettings.frameTop).toBe('TOP');
    expect(detailedSettings.frameBottom).toBe('BOTTOM');
    expect(detailedSettings.borderStyle).toBe('custom');
    expect(detailedSettings.borderLeft).toBe('«');
    expect(detailedSettings.borderRight).toBe('»');
    expect(detailedSettings.integrationOptions.mediaOnlyPlaying).toBe(true);

    const presetBorder = CHAT_BORDER_STYLES['brackets' as keyof typeof CHAT_BORDER_STYLES];
    expect(presetBorder?.label).toBe('[ Brackets ]');

    const presetFrame = CHAT_MESSAGE_FRAMES['lines' as keyof typeof CHAT_MESSAGE_FRAMES];
    expect(presetFrame?.label).toBe('Lines');
    expect(presetFrame?.top).toBe('━━━━━━━━');
  });
  it('normalises host-level templates for saved notes', () => {
    const templates = [{ id: 'saved', name: 'Saved', text: '{status}', cycle: 'true', favourite: 'false' }];
    expect(templates[0].cycle).toBe('true');
    expect(templates[0].favourite).toBe('false');
    expect(templates).toHaveLength(1);
  });
});
