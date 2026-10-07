import { describe, expect, it } from 'vitest';
import { importMagicStatuses } from './magicImport';

describe('MagicChatbox status import interoperability', () => {
  it('reads StatusItem XML text, entities, favourite and cycle flags', () => {
    const imported = importMagicStatuses('<StatusList><StatusItem><msg>Hello &amp; welcome 😀</msg><IsFavorite>true</IsFavorite><UseInCycle>true</UseInCycle></StatusItem><StatusItem><msg><![CDATA[Coffee <3]]></msg></StatusItem></StatusList>');
    expect(imported.templates).toHaveLength(2);
    expect(imported.templates[0]).toMatchObject({ text: 'Hello & welcome 😀', favourite: true, cycle: true });
    expect(imported.templates[1].text).toBe('Coffee <3');
  });
  it('reads legacy string lists and truthy XML flags', () => {
    expect(importMagicStatuses('<ArrayOfString><string>Hello</string><string>Goodbye</string></ArrayOfString>').templates).toHaveLength(2);
    expect(importMagicStatuses('<StatusItem><msg>Hello</msg><IsFavorite>yes</IsFavorite><UseInCycle>1</UseInCycle></StatusItem>').templates[0]).toMatchObject({ favourite: true, cycle: true });
  });
  it('reads JSON exports and legacy status arrays', () => {
    expect(importMagicStatuses(JSON.stringify([{ msg: 'hello', IsFavorite: true, UseInCycle: true }])).templates[0]).toMatchObject({ text: 'hello', favourite: true, cycle: true });
    expect(importMagicStatuses(JSON.stringify({ templates: [{ text: 'Hi', name: 'Greeting' }] })).templates[0].name).toBe('Greeting');
  });
  it('rejects entities, oversized files and invalid records without truncating messages', () => {
    expect(() => importMagicStatuses('<!DOCTYPE data><StatusList/>')).toThrow('document');
    expect(() => importMagicStatuses('x'.repeat(2 * 1024 * 1024 + 1))).toThrow('2 MB');
    expect(importMagicStatuses(JSON.stringify([{ text: 'x'.repeat(145) }, { text: 'Hello' }, { text: 'hello' }]))).toMatchObject({ skipped: 2 });
  });
});
