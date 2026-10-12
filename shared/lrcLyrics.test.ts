import { describe, expect, it } from 'vitest';
import { lyricAtPosition, normaliseLyricCues, parseLrcLyrics } from './lrcLyrics';

describe('local LRC lyric support', () => {
  it('parses sorted timestamps, multiple timestamps per line, fractional precision, and offsets', () => {
    const cues = parseLrcLyrics('[offset:250]\n[00:02.5][01:03.25]Second line\n[00:01:7]First line');
    expect(cues).toEqual([
      { timeMs: 1950, text: 'First line' },
      { timeMs: 2750, text: 'Second line' },
      { timeMs: 63500, text: 'Second line' }
    ]);
  });

  it('ignores metadata and untimed lines and cleans unsafe or empty lyric text', () => {
    expect(parseLrcLyrics('[ti:Song]\n[ar:Artist]\nplain text\n[00:01.00]\u0000  Hello\tworld\n[00:02.00]   ')).toEqual([
      { timeMs: 1000, text: 'Hello world' }
    ]);
  });

  it('returns the active cue at a media position without inventing pre-roll lyrics', () => {
    const cues = parseLrcLyrics('[00:01.00]One\n[00:02.50]Two\n[00:04.00]Three');
    expect(lyricAtPosition(cues, 0)).toBe('');
    expect(lyricAtPosition(cues, 1)).toBe('One');
    expect(lyricAtPosition(cues, 3.9)).toBe('Two');
    expect(lyricAtPosition(cues, 4)).toBe('Three');
    expect(lyricAtPosition(cues, Number.NaN)).toBe('');
    expect(lyricAtPosition(cues, -1)).toBe('');
  });

  it('bounds files and cue counts and normalises imported cue data', () => {
    expect(() => parseLrcLyrics('x'.repeat(2 * 1024 * 1024 + 1))).toThrow('2 MB');
    expect(() => parseLrcLyrics(Array.from({ length: 5001 }, (_, index) => `[${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}]line`).join('\n'))).toThrow('5,000');
    expect(normaliseLyricCues([{ timeMs: 2000, text: ' later ' }, { timeMs: -1, text: 'bad' }, { timeMs: 1000, text: ' first\nline' }])).toEqual([
      { timeMs: 1000, text: 'first line' },
      { timeMs: 2000, text: 'later' }
    ]);
  });
});
