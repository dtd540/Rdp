import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, normaliseChatTemplates, renderChatTemplate } from './chatbox';

describe('Magic Chatbox templates', () => {
  it('renders data without dropping unknown placeholders or silently truncating', () => {
    const text = renderChatTemplate('{status} {activity} {cpu} {ram} {unknown}', { now: new Date('2026-10-06T12:30:00Z'), status: 'Hello', activity: 'VRChat', cpuPercent: 23.4, memoryUsed: 1073741824, memoryTotal: 2147483648 });
    expect(text).toBe('Hello VRChat 23% 1.0/2.0 GB {unknown}');
  });
  it('does not invent unavailable PC data', () => {
    expect(renderChatTemplate('{cpu} {ram}', { now: new Date(), status: '', activity: '' })).toBe('unavailable unavailable');
  });
  it('validates saved templates and bounds the list', () => {
    expect(normaliseChatTemplates(null)).toEqual(DEFAULT_TEMPLATES);
    expect(normaliseChatTemplates([])).toEqual([]);
    expect(normaliseChatTemplates([{ id: '1', name: 'Hi', text: 'Hello' }, { id: '1', name: 'Duplicate', text: 'hello' }, { id: '2', name: 'Bad', text: 'x'.repeat(145) }])).toHaveLength(1);
  });
});
