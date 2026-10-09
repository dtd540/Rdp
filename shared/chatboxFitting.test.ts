import { describe, expect, it } from 'vitest';
import { composeChatReport, composeChatIntegrations, composeCycleIntegrations, normaliseChatIntegrations } from './chatboxIntegrations';
import { normaliseChatboxSettings } from './chatboxSettings';
import { validateChatText } from './gaming';

const settings = normaliseChatIntegrations([
  { id: 'media_status', enabled: true, priority: 'high', showEmoji: false, format: '{value}' },
  { id: 'current_time', enabled: true, priority: 'low', showEmoji: false, format: '{value}' }
]);
const values = { media_status: 'song'.repeat(10), current_time: '12:30' };

describe('original chatbox smart fitting', () => {
  it('preserves exact 144-character payloads and reports original size', () => {
    const report = composeChatReport('x'.repeat(144), [], {}, { smartFit: true });
    expect(report).toEqual({ text: 'x'.repeat(144), omitted: [], originalCharacters: 144 });
  });
  it('removes low-priority whole lines before high-priority lines', () => {
    const report = composeChatReport('x'.repeat(100), settings, values, { smartFit: true });
    expect(report.omitted).toEqual(['current_time']);
    expect(report.text).toBe('x'.repeat(100) + '\n' + values.media_status);
    expect(validateChatText(report.text)).toBe(report.text);
  });
  it('keeps earlier lines on equal priorities and never clips the base', () => {
    const equal = settings.map((item) => ({ ...item, priority: 'normal' as const }));
    const report = composeChatReport('x'.repeat(140), equal, values, { smartFit: true });
    expect(report.omitted).toEqual(['current_time', 'media_status']);
    expect(report.text).toBe('x'.repeat(140));
    expect(() => validateChatText(composeChatReport('x'.repeat(145), settings, values, { smartFit: true }).text)).toThrow('144');
  });
  it('accounts for borders, frames and line limits', () => {
    const report = composeChatReport('base', settings, values, { smartFit: true, frame: 'lines', borderStyle: 'stars' });
    expect(report.text).toContain('★');
    expect(report.text).toContain('━━━━━━━━');
    const lines = composeChatReport(Array(9).fill('base').join('\n'), settings, values, { smartFit: true });
    expect(lines.omitted).toHaveLength(2);
    expect(lines.text.split('\n')).toHaveLength(9);
  });
  it('counts Unicode code points consistently with the app validator', () => {
    const report = composeChatReport('🎵'.repeat(144), settings, values, { smartFit: true });
    expect(report.text).toBe('🎵'.repeat(144));
    expect(validateChatText(report.text)).toBe(report.text);
  });
  it('supports strict mode, persisted priorities, and cycle parity', () => {
    expect(normaliseChatboxSettings(null).smartFit).toBe(true);
    expect(normaliseChatboxSettings({ smartFit: false }).smartFit).toBe(false);
    expect(settings[0].priority).toBe('high');
    expect(normaliseChatIntegrations([{ id: 'media_status', priority: 'invalid' }])[0].priority).toBeUndefined();
    const base = 'x'.repeat(140);
    expect(composeChatIntegrations(base, settings, values).length).toBeGreaterThan(144);
    const cycle = composeCycleIntegrations([{ id: 'a', name: 'A', text: base, cycle: true }], { now: new Date(), activity: '', status: '' }, settings, values, { smartFit: true });
    expect(cycle[0].text).toBe(composeChatReport(base, settings, values, { smartFit: true }).text);
  });
});
