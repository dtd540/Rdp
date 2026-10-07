import { validateChatText } from './gaming';
import type { ChatTemplate } from './chatbox';

function decodeXml(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
    })
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity] ?? '');
}

/** Parse only status records, never resolve entities or execute imported data. */
export function importMagicStatuses(contents: string): { templates: ChatTemplate[]; skipped: number } {
  if (contents.length > 2 * 1024 * 1024) throw new Error('Status imports are limited to 2 MB.');
  const raw = contents.replace(/^\uFEFF/, '').trim();
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error('XML entities and document types are not supported.');
  const records: Array<Record<string, unknown>> = [];
  if (raw.startsWith('<')) {
    // MagicChatbox StatusList.xml records use StatusItem with msg/IsFavorite/UseInCycle.
    for (const match of raw.matchAll(/<(StatusItem|Status|ChatStatus|StatusModel)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
      const field = (names: string[]) => {
        for (const name of names) {
          const found = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(match[2]);
          if (found) return decodeXml(found[1]);
        }
        return '';
      };
      records.push({ text: field(['msg', 'text', 'message', 'Message']), name: field(['name', 'Name']), favourite: /^(true|1|yes)$/i.test(field(['IsFavorite', 'favorite']).trim()), cycle: /^(true|1|yes)$/i.test(field(['UseInCycle', 'useInCycle']).trim()) });
      if (records.length >= 200) break;
    }
    if (!records.length) {
      for (const match of raw.matchAll(/<(msg|string)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
        records.push({ text: decodeXml(match[2]) });
        if (records.length >= 200) break;
      }
    }
  } else {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { templates?: unknown }).templates : undefined;
    if (!Array.isArray(list)) throw new Error('Expected a JSON status array or a templates export.');
    for (const item of list.slice(0, 200)) if (item && typeof item === 'object') records.push(item);
  }
  const templates: ChatTemplate[] = [];
  let skipped = 0;
  for (const record of records) {
    const value = record.text ?? record.msg ?? record.message;
    if (typeof value !== 'string') { skipped++; continue; }
    const text = value.trim();
    try { validateChatText(text); } catch { skipped++; continue; }
    if (templates.some((template) => template.text.toLowerCase() === text.toLowerCase())) { skipped++; continue; }
    templates.push({ id: `import-${templates.length}`, name: typeof record.name === 'string' ? record.name.slice(0, 60) : Array.from(text).slice(0, 40).join(''), text, favourite: record.favourite === true || record.IsFavorite === true || record.favorite === true, cycle: record.cycle === true || record.UseInCycle === true || record.useInCycle === true });
  }
  return { templates, skipped };
}
