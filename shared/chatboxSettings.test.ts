import { describe, expect, it } from 'vitest';
import { applyBorder, applyMessageFrame, normaliseBorderStyle } from './chatboxIntegrations';
import { cycleOutputs, normaliseChatboxSettings, randomCycleIndex, SETTINGS_VERSION } from './chatboxSettings';
const context = { now: new Date('2026-10-06T12:34:56Z'), activity: 'VRChat', status: 'Available', clock24h: true };
describe('Magic Chatbox improvements', () => {
  it('restores bounded preferences without restoring sending consent', () => {
    const settings = normaliseChatboxSettings({ port: 9123, clock24h: true, activity: 'x'.repeat(100), intervalSeconds: 15, consent: true, lineSeparator: 'pipe', messageFrame: 'custom', frameTop: 'hello\nworld', frameBottom: 'bottom', borderStyle: 'pipes', borderLeft: '« ', borderRight: ' »', integrationOptions: { mediaOnlyPlaying: true } });
    expect(settings.port).toBe(9123);
    expect(settings.activity).toHaveLength(60);
    expect(settings.clock24h).toBe(true);
    expect(settings).not.toHaveProperty('consent');
    expect(settings.lineSeparator).toBe('pipe');
    expect(settings.messageFrame).toBe('custom');
    expect(settings.frameTop).toBe('hello world');
    expect(settings.textStyle).toBe('plain');
    expect(normaliseChatboxSettings({ textStyle: 'monospace' }).textStyle).toBe('monospace');
    expect(normaliseChatboxSettings({ textStyle: 'not-a-style' }).textStyle).toBe('plain');
    expect(settings.borderStyle).toBe('pipes');
    expect(settings.borderLeft).toBe('« ');
    expect(settings.borderRight).toBe(' »');
    expect(settings.integrationOptions.mediaOnlyPlaying).toBe(true);
    expect(settings.randomCycle).toBe(false);
    expect(normaliseChatboxSettings({ intervalSeconds: 5 }).intervalSeconds).toBe(5);
    expect(normaliseChatboxSettings({ intervalSeconds: 10, randomCycle: true })).toMatchObject({ intervalSeconds: 10, randomCycle: true });
    expect(normaliseChatboxSettings({ intervalSeconds: 7 }).intervalSeconds).toBe(30);
    expect(normaliseChatboxSettings({ port: 1, intervalSeconds: 1 }).borderStyle).toBe('none');
  });

  it('chooses bounded random cycle indices without repeating the previous item when possible', () => {
    expect(randomCycleIndex(0, 0, () => 0.5)).toBe(-1);
    expect(randomCycleIndex(1, 0, () => 0.9)).toBe(0);
    expect(randomCycleIndex(3, 1, () => 0.5)).not.toBe(1);
    expect(randomCycleIndex(3, 1, () => -10)).toBe(0);
    expect(randomCycleIndex(3, 1, () => 10)).toBe(2);
  });
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
});
