import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      out.push(list.slice(start, index));
      start = index + 1;
    }
  }
  out.push(list.slice(start));
  return out.map((part) => part.trim()).filter(Boolean);
}

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1].trim(), body: match[2] }))
  .filter((rule) => rule.selector && !rule.selector.startsWith('@'));

function isTopLevelFor(selector: string, element: string): boolean {
  const compound = selector.split(/[\s>+~]/)[0];
  return compound === element || compound.startsWith(`${element}:`) || compound.startsWith(`${element}[`);
}

const controls = ['input', 'select', 'textarea', 'button'];

describe('theme form controls', () => {
  it.each(controls)('gives %s a dark surface and text colour at the top level', (element) => {
    const surfaces = rules.filter(
      (rule) => selectors(rule.selector).some((selector) => isTopLevelFor(selector, element)) && /(^|;)\s*background(-color)?\s*:/.test(rule.body),
    );
    expect(surfaces.length, `no top-level rule sets a background on ${element}`).toBeGreaterThan(0);
    expect(
      surfaces.some((rule) => /var\(--(bg2|panel2|panel)\)/.test(rule.body) && /(^|;)\s*color\s*:/.test(rule.body)),
      `${element} is not given a themed background and colour`,
    ).toBe(true);
  });

  it('never paints a form control a literal light colour', () => {
    const light = /(^|;)\s*(background(-color)?|color)\s*:\s*(#fff|#ffffff|white|rgb\(25[0-5],\s*25[0-5],\s*25[0-5]\))/i;
    const offenders = rules
      .filter((rule) => controls.some((element) => selectors(rule.selector).some((selector) => isTopLevelFor(selector, element))) && light.test(rule.body))
      .map((rule) => rule.selector);
    expect(offenders).toEqual([]);
  });

  it('renders native widgets in the dark scheme', () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
  });

  it('keeps the Discord webview diagnostic visible over the full-size view', () => {
    expect(css).toMatch(/\.discord-bounds-diagnostic\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.discord-bounds-diagnostic\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.discord-webview-frame\s*\{[^}]*position:\s*relative/);
  });
});
