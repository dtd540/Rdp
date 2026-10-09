import { describe, expect, it } from 'vitest';
import { formatBytes } from './GamerHub';

describe('GamerHub byte formatting', () => {
  it('scales through GB, MB and KB so a nearly full drive never reads as 0.0 GB', () => {
    expect(formatBytes(16 * 1024 ** 3)).toBe('16.0 GB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(400 * 1024 ** 2)).toBe('400 MB');
    expect(formatBytes(1024 ** 2)).toBe('1 MB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(0)).toBe('0 KB');
  });

  it('never prints a byte count it does not have', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
