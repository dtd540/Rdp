import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetWindowsChatboxCacheForTests, windowsChatboxSources } from './chatboxSources';

afterEach(() => { vi.restoreAllMocks(); resetWindowsChatboxCacheForTests(); });

const source = readFileSync(new URL('./chatboxSources.ts', import.meta.url), 'utf8');
const script = source.match(/const script = String\.raw`([\s\S]*?)`;/)?.[1] ?? '';

describe('local chatbox platform sources', () => {
  it('returns explicit unavailable values on non-Windows hosts', async () => {
    if (process.platform === 'win32') return;
    await expect(windowsChatboxSources({ windowTitle: true })).resolves.toEqual({ windowTitle: null, battery: null, media: null, receiveBytesPerSecond: null, sendBytesPerSecond: null });
  });

  /* PowerShell writes an unassigned .NET return value to the success stream, so a call like
     `$task.Wait(2500)` prepends "True" to stdout. That used to make the JSON.parse of the whole
     stream throw, and the catch swallowed it, so enabling Media status silently reported every
     integration as unavailable. Every value-returning call must discard or assign its result. */
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
