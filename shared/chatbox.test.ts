import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, filterChatTemplates, hasUnsavedChatTemplateChanges, hasUnsavedNewChatTemplateChanges, normaliseChatTemplates, renderChatTemplate } from './chatbox';
import { chatTemplateGroupId, DEFAULT_CHAT_TEMPLATE_GROUPS, normaliseChatTemplateGroups } from './chatboxGroups';

describe('Magic Chatbox templates', () => {
  it('renders data without dropping unknown placeholders or silently truncating', () => {
    const text = renderChatTemplate('{status} {activity} {cpu} {ram} {unknown}', { now: new Date('2026-10-06T12:30:00Z'), status: 'Hello', activity: 'VRChat', cpuPercent: 23.4, memoryUsed: 1073741824, memoryTotal: 2147483648 });
    expect(text).toBe('Hello VRChat 23% 1.0/2.0 GB {unknown}');
  });
  it('does not invent unavailable PC data', () => {
    expect(renderChatTemplate('{cpu} {ram}', { now: new Date(), status: '', activity: '' })).toBe('unavailable unavailable');
  });
  it('correctly identifies clean and dirty new versus saved drafts', () => {
    expect(hasUnsavedNewChatTemplateChanges('My template', '')).toBe(false);
    expect(hasUnsavedNewChatTemplateChanges('New template', '')).toBe(false);
    expect(hasUnsavedNewChatTemplateChanges('Greeting', '')).toBe(true);
    expect(hasUnsavedNewChatTemplateChanges('New template', 'Hello')).toBe(true);
    expect(hasUnsavedChatTemplateChanges({ id: 'one', name: 'Greeting', text: 'Hello' }, 'Greeting', 'Hello', false)).toBe(false);
    expect(hasUnsavedChatTemplateChanges({ id: 'one', name: 'Greeting', text: 'Hello' }, 'Greeting', 'Updated', false)).toBe(true);
    expect(hasUnsavedChatTemplateChanges({ id: 'one', name: 'Greeting', text: 'Hello', groupId: 'default' }, 'Greeting', 'Hello', false, 'friends')).toBe(true);
    expect(hasUnsavedChatTemplateChanges({ id: 'one', name: 'Greeting', text: 'Hello', cycle: true }, 'Greeting', 'Hello', false)).toBe(true);
  });

  it('normalises legacy templates into the Default set and filters by set and search', () => {
    const templates = normaliseChatTemplates([
      { id: 'old', name: 'Old greeting', text: 'Hello' },
      { id: 'new', name: 'World status', text: 'In world', groupId: 'friends' }
    ]);
    const groups = normaliseChatTemplateGroups([{ id: 'friends', name: 'Friends' }]);
    expect(chatTemplateGroupId(templates[0], groups)).toBe('default');
    expect(groups).toEqual([...DEFAULT_CHAT_TEMPLATE_GROUPS, { id: 'friends', name: 'Friends' }]);
    expect(filterChatTemplates(templates, 'WORLD', 'friends').map((template) => template.id)).toEqual(['new']);
    expect(filterChatTemplates(templates, '', 'default').map((template) => template.id)).toEqual(['old']);
    expect(filterChatTemplates(templates, '', 'all')).toHaveLength(2);
  });

  it('rejects duplicate, malformed and oversized status groups', () => {
    const groups = normaliseChatTemplateGroups([
      { id: 'default', name: 'Overwritten' },
      { id: 'friends', name: 'Friends' },
      { id: 'other', name: 'friends' },
      { id: 'bad', name: '  ' },
      { id: 'long', name: 'x'.repeat(80) }
    ]);
    expect(groups).toEqual([...DEFAULT_CHAT_TEMPLATE_GROUPS, { id: 'friends', name: 'Friends' }, { id: 'long', name: 'x'.repeat(60) }]);
  });

  it('validates saved templates and bounds the list', () => {
    expect(normaliseChatTemplates(null)).toEqual(DEFAULT_TEMPLATES);
    expect(normaliseChatTemplates([])).toEqual([]);
    expect(normaliseChatTemplates([{ id: '1', name: 'Hi', text: 'Hello' }, { id: '1', name: 'Duplicate', text: 'hello' }, { id: '2', name: 'Bad', text: 'x'.repeat(145) }])).toHaveLength(1);
  });
});
