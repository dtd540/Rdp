import { describe, expect, it } from 'vitest';
import { normaliseGamerPreferences, parseWorldLink, validateChatText, worldUrl } from './gaming';

const ID = 'wrld_12345678-1234-1234-1234-123456789abc';
describe('VRChat world links', () => {
  it('accepts official pages, launch links and bare world ids', () => {
    expect(parseWorldLink(ID)?.worldId).toBe(ID);
    expect(parseWorldLink(`https://vrchat.com/home/world/${ID}`)?.worldId).toBe(ID);
    const link = `https://vrchat.com/home/launch?worldId=${ID}&instanceId=123~private(456)~nonce(abc)`;
    expect(parseWorldLink(link)?.instanceId).toBe('123~private(456)~nonce(abc)');
    expect(parseWorldLink(worldUrl(parseWorldLink(link)!))?.worldId).toBe(ID);
  });
  it('rejects lookalikes, arbitrary schemes, invalid ids and credentials', () => {
    for (const input of [`https://vrchat.com.evil/home/world/${ID}`, `http://vrchat.com/home/world/${ID}`, `https://evil@vrchat.com/home/world/${ID}`, 'javascript:alert(1)', 'wrld_bad', `https://vrchat.com:444/home/world/${ID}`]) expect(parseWorldLink(input)).toBeNull();
  });
  it('rejects unsafe instance values', () => {
    expect(parseWorldLink(`https://vrchat.com/home/launch?worldId=${ID}&instanceId=a%00b`)).toBeNull();
  });
});

describe('chatbox text', () => {
  it('counts Unicode characters instead of UTF-16 code units', () => {
    expect(validateChatText('😀'.repeat(144))).toHaveLength(288);
    expect(() => validateChatText('😀'.repeat(145))).toThrow('144');
  });
  it('allows at most nine lines and refuses empty/control text', () => {
    expect(validateChatText(Array(9).fill('hi').join('\n'))).toContain('hi');
    expect(() => validateChatText(Array(10).fill('hi').join('\n'))).toThrow('9');
    expect(() => validateChatText('   ')).toThrow();
    expect(() => validateChatText('bad\0message')).toThrow();
    expect(() => validateChatText(123)).toThrow();
  });
});

describe('gamer preferences', () => {
  it('normalises imports, drops unexpected data and deduplicates', () => {
    const result = normaliseGamerPreferences({ favouriteGames: ['1', '1', 'not-an-id'], gameNotes: { '1': 'hello', '__proto__': 'bad' }, worlds: [{ url: `https://vrchat.com/home/world/${ID}`, name: 'My world', savedAt: 3 }, { url: 'https://evil.test', name: 'bad' }], accent: 'evil', reducedMotion: true });
    expect(result.favouriteGames).toEqual(['1']);
    expect(result.worlds).toHaveLength(1);
    expect(result.worlds[0].name).toBe('My world');
    expect(result.accent).toBe('violet');
    expect(result.reducedMotion).toBe(true);
  });
  it('keeps intentionally empty quick phrases and bounds notes', () => {
    expect(normaliseGamerPreferences({ chatPresets: [] }).chatPresets).toEqual([]);
    expect(normaliseGamerPreferences({ gameNotes: { '1': 'x'.repeat(2000) } }).gameNotes['1']).toHaveLength(1000);
    expect(normaliseGamerPreferences(null).chatPresets.length).toBeGreaterThan(0);
  });
});
