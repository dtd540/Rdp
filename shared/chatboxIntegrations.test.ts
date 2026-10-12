import { describe, expect, it } from 'vitest';
import { applyBorder, applyMessageFrame, normaliseBorderStyle, applyChatTextStyle, normaliseChatTextStyle, CHAT_TEXT_STYLES, composeChatIntegrations, normaliseChatIntegrations, composeCycleIntegrations, chatIntegrationValues, chatSourceRequest, formatBytesPerSecond, formatUptime, mediaProgressBar, normaliseLineSeparator, CHAT_BORDER_STYLES, CHAT_MESSAGE_FRAMES, CHAT_INTEGRATIONS, DEFAULT_CHAT_INTEGRATIONS, SOURCE_BACKED_INTEGRATIONS, type ChatIntegrationSetting } from './chatboxIntegrations';
import { normaliseChatboxSettings, cycleOutputs } from './chatboxSettings';
import { renderChatTemplate, type ChatTemplate } from './chatbox';
import { lyricAtPosition, parseLrcLyrics } from './lrcLyrics';

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
  it('converts message text to Unicode style presets while preserving symbols and emoji', () => {
    expect(applyChatTextStyle('Hello 123! 🎵', 'plain')).toBe('Hello 123! 🎵');
    expect(applyChatTextStyle('Hello 123! 🎵', 'serifBold')).toBe('𝐇𝐞𝐥𝐥𝐨 123! 🎵');
    expect(applyChatTextStyle('Hello 123!', 'sansBold')).toBe('𝗛𝗲𝗹𝗹𝗼 𝟭𝟮𝟯!');
    expect(applyChatTextStyle('Hello!', 'italic')).toBe('𝐻𝑒𝑙𝑙𝑜!');
    expect(applyChatTextStyle('Hello 123!', 'monospace')).toBe('𝙷𝚎𝚕𝚕𝚘 𝟷𝟸𝟹!');
    expect(applyChatTextStyle('Hello 123!', 'doubleStruck')).toBe('ℍ𝕖𝕝𝕝𝕠 𝟙𝟚𝟛!');
    expect(normaliseChatTextStyle('unknown')).toBe('plain');
    expect(CHAT_TEXT_STYLES.doubleStruck.label).toBe('Double-struck');
  });
  it('styles composed text and integration lines while leaving frames and symbols intact', () => {
    expect(composeChatIntegrations('Hello', [], {}, { textStyle: 'sansBold' })).toBe('𝗛𝗲𝗹𝗹𝗼');
    expect(composeChatIntegrations('Hi', [], {}, { textStyle: 'plain', frame: 'stars' })).toBe('★ ─────── ★\nHi\n★ ─────── ★');
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
  it('asks the host for network data only when that integration is enabled', () => {
    expect(chatSourceRequest(DEFAULT_CHAT_INTEGRATIONS)).toEqual({ windowTitle: false, media: false, battery: false, network: false, currentWorld: false });
    expect(chatSourceRequest(normaliseChatIntegrations([{ id: 'lyricify_lyrics', enabled: true }])).media).toBe(true);
    const request = chatSourceRequest(normaliseChatIntegrations([
      { id: 'media_status', enabled: true },
      { id: 'component_and_network_stats', enabled: true }
    ]));
    expect(request).toEqual({ windowTitle: false, media: true, battery: false, network: true, currentWorld: false });
    expect(SOURCE_BACKED_INTEGRATIONS).toContain('component_and_network_stats');
    expect(SOURCE_BACKED_INTEGRATIONS).toContain('pc_battery');
  });
  it('reports memory plus network throughput and omits whichever half is missing', () => {
    const base = { context, activeTab: 'Magic Chatbox' };
    expect(chatIntegrationValues({ ...base, memoryUsed: 512, memoryTotal: 1024, receiveBytesPerSecond: 1572864, sendBytesPerSecond: 245760 }).component_and_network_stats).toBe('Memory 50% used · ↓ 1.5 MB/s ↑ 240 KB/s');
    expect(chatIntegrationValues({ ...base, memoryUsed: 512, memoryTotal: 1024 }).component_and_network_stats).toBe('Memory 50% used');
    expect(chatIntegrationValues({ ...base, receiveBytesPerSecond: 512, sendBytesPerSecond: null }).component_and_network_stats).toBe('↓ 512 B/s');
    expect(chatIntegrationValues(base).component_and_network_stats).toBe('');
    expect(formatBytesPerSecond(-5)).toBe('');
    expect(formatBytesPerSecond(Number.NaN)).toBe('');
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
  it('uses local time-coded LRC cues for media playback and hides them when paused by default', () => {
    const cues = parseLrcLyrics('[00:01.00]First lyric\n[00:03.00]Next lyric');
    expect(lyricAtPosition(cues, 2)).toBe('First lyric');
    const playing = chatIntegrationValues({ context, activeTab: 'Magic Chatbox', media: { title: 'Song', status: 'playing', positionSeconds: 2 }, lyricifyLyrics: lyricAtPosition(cues, 2) });
    const paused = chatIntegrationValues({ context, activeTab: 'Magic Chatbox', media: { title: 'Song', status: 'paused', positionSeconds: 2 }, lyricifyLyrics: lyricAtPosition(cues, 2) });
    const pausedAllowed = chatIntegrationValues({ context, activeTab: 'Magic Chatbox', media: { title: 'Song', status: 'paused', positionSeconds: 2 }, lyricifyLyrics: lyricAtPosition(cues, 2), options: { lyricifyOnlyPlaying: false } });
    expect(playing.lyricify_lyrics).toBe('First lyric');
    expect(paused.lyricify_lyrics).toBe('');
    expect(pausedAllowed.lyricify_lyrics).toBe('First lyric');
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
