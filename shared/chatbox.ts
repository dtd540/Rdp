import { validateChatText } from './gaming';

export interface ChatTemplate { id: string; name: string; text: string; favourite?: boolean; cycle?: boolean }
export interface ChatContext { now: Date; cpuPercent?: number | null; memoryUsed?: number; memoryTotal?: number; activity: string; status: string; clock24h?: boolean; clockSeconds?: boolean }
export const CHAT_TOKENS = ['{time}', '{date}', '{cpu}', '{ram}', '{activity}', '{status}'] as const;
export const DEFAULT_TEMPLATES: ChatTemplate[] = [
  { id: 'hello', name: 'Say hello', text: 'Hello! Nice to meet you ✨' },
  { id: 'status', name: 'My status', text: '{status}\n{activity} · {time}' },
  { id: 'pc', name: 'PC stats', text: '🖥 CPU {cpu} · RAM {ram}\n{time}' },
  { id: 'break', name: 'Water break', text: '💧 Taking a water break. Back soon!' }
];

export function renderChatTemplate(template: string, context: ChatContext): string {
  const values: Record<string, string> = {
    time: context.now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(context.clockSeconds ? { second: '2-digit' } : {}), ...(context.clock24h !== undefined ? { hour12: !context.clock24h } : {}) }),
    date: context.now.toLocaleDateString(),
    cpu: context.cpuPercent == null ? 'unavailable' : `${Math.round(context.cpuPercent)}%`,
    ram: context.memoryUsed == null || !context.memoryTotal ? 'unavailable' : `${(context.memoryUsed / 1073741824).toFixed(1)}/${(context.memoryTotal / 1073741824).toFixed(1)} GB`,
    activity: context.activity,
    status: context.status
  };
  return template.replace(/\{(time|date|cpu|ram|activity|status)\}/g, (_, token: string) => values[token]);
}

export function normaliseChatTemplates(raw: unknown): ChatTemplate[] {
  if (!Array.isArray(raw)) return DEFAULT_TEMPLATES;
  const templates: ChatTemplate[] = [];
  for (const item of raw.slice(0, 30)) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.text !== 'string') continue;
    try { validateChatText(item.text); } catch { continue; }
    if (!item.id || item.id.length > 100 || templates.some((t) => t.id === item.id)) continue;
    templates.push({ id: item.id, name: item.name.slice(0, 60) || 'Untitled', text: item.text, favourite: item.favourite === true, cycle: item.cycle === true });
  }
  return templates;
}
