import { describe, expect, it } from 'vitest';
import { readBundledReleaseNotes } from './updateNotes';

describe('readBundledReleaseNotes', () => {
  const changelog = [
    '# What’s New',
    '## 0.3.5 (unreleased)',
    '- Future item.',
    '## 0.3.4',
    '- Routing now appears in the update log.',
    '- Chatbox layout improved.',
    '## 0.3.3',
    '- Older release.'
  ].join('\n');

  it('selects all bullets from only the requested version section', () => {
    expect(readBundledReleaseNotes(changelog, '0.3.4')).toBe('Routing now appears in the update log.\nChatbox layout improved.');
  });

  it('supports v-prefixed versions and handles missing versions', () => {
    expect(readBundledReleaseNotes(changelog, 'v0.3.4')).toContain('Chatbox layout improved.');
    expect(readBundledReleaseNotes(changelog, '1.0.0')).toBeUndefined();
  });
});
