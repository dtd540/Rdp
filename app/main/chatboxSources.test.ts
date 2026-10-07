import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatboxSourcePayload, resetWindowsChatboxCacheForTests, windowsChatboxSources, type WindowsChatboxSources } from './chatboxSources';

afterEach(() => { vi.restoreAllMocks(); resetWindowsChatboxCacheForTests(); });

const source = readFileSync(new URL('./chatboxSources.ts', import.meta.url), 'utf8');
const script = source.match(/const script = String\.raw`([\s\S]*?)`;/)?.[1] ?? '';

describe('local chatbox platform sources', () => {
  it('returns explicit unavailable values on non-Windows hosts', async () => {
    if (process.platform === 'win32') return;
    await expect(windowsChatboxSources({ windowTitle: true })).resolves.toEqual({ windowTitle: null, battery: null, media: null });
  });

  it('does not probe the network counters through PowerShell', () => {
    expect(script).not.toContain('Win32_PerfFormattedData');
    expect(source).not.toContain('WantNetwork');
  });

  it('keeps the embedded PowerShell probe free of stray stdout output', () => {
    expect(script).not.toBe('');
    const leaks = script
      .split('\n')
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /\.Wait\s*\(/.test(line))
      .filter(({ line }) => !/^\[void\]/.test(line) && !/^(\$[\w.\[\]]+|return)\s*=/.test(line));
    expect(leaks, `unassigned Wait() call leaks "True" onto stdout at line(s) ${leaks.map((l) => l.number).join(', ')}`).toEqual([]);
  });

  it('narrows stdout to the JSON object before parsing', () => {
    expect(source).toMatch(/JSON\.parse\(\s*stdout\.slice\(/);
  });
});

describe('chatbox source response payload', () => {
  const sources: WindowsChatboxSources = {
    windowTitle: 'My Doc',
    battery: { percent: 90, charging: false },
    media: { title: 'Nightcall', status: 'playing' }
  };
  const rates = { receiveBytesPerSecond: 100, sendBytesPerSecond: 50 };

  it('returns only the fields the caller asked for', () => {
    expect(chatboxSourcePayload({}, sources, rates)).toEqual({});
    expect(chatboxSourcePayload({ windowTitle: true }, sources, rates)).toEqual({ windowTitle: 'My Doc' });
    expect(chatboxSourcePayload({ network: true }, sources, rates)).toEqual({ receiveBytesPerSecond: 100, sendBytesPerSecond: 50 });
    expect(chatboxSourcePayload({ battery: true }, sources, rates)).toEqual({ battery: { percent: 90, charging: false } });
  });

  it('keeps unrequested fields out so the world poll cannot null out the source poll', () => {
    const worldPoll = {};
    const payload = chatboxSourcePayload(worldPoll, { windowTitle: null, battery: null, media: null }, { receiveBytesPerSecond: null, sendBytesPerSecond: null });
    expect(payload).toEqual({});
    expect(Object.keys(payload)).not.toContain('windowTitle');
    expect(Object.keys(payload)).not.toContain('media');
    const merged = { windowTitle: 'My Doc', media: sources.media, ...payload };
    expect(merged.windowTitle).toBe('My Doc');
    expect(merged.media).toEqual(sources.media);
  });
});
