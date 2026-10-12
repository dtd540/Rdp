import type { ChatTemplate } from './chatbox';

export interface ChatTemplateGroup {
  id: string;
  name: string;
}

export const DEFAULT_CHAT_TEMPLATE_GROUPS: ChatTemplateGroup[] = [
  { id: 'default', name: 'Default' }
];

export function normaliseChatTemplateGroups(raw: unknown): ChatTemplateGroup[] {
  const groups = [...DEFAULT_CHAT_TEMPLATE_GROUPS];
  if (!Array.isArray(raw)) return groups;

  const ids = new Set(groups.map((group) => group.id));
  const names = new Set(groups.map((group) => group.name.toLowerCase()));
  for (const value of raw.slice(0, 60)) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Partial<ChatTemplateGroup>;
    if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    const id = item.id.trim();
    const name = item.name.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 60);
    if (!id || id.length > 100 || /[\x00-\x1f\x7f]/.test(id) || !name || ids.has(id) || names.has(name.toLocaleLowerCase())) continue;
    groups.push({ id, name });
    ids.add(id);
    names.add(name.toLocaleLowerCase());
    if (groups.length >= 30) break;
  }
  return groups;
}

export function chatTemplateGroupId(template: Pick<ChatTemplate, 'groupId'>, groups: ChatTemplateGroup[]): string {
  return typeof template.groupId === 'string' && groups.some((group) => group.id === template.groupId)
    ? template.groupId
    : DEFAULT_CHAT_TEMPLATE_GROUPS[0].id;
}
