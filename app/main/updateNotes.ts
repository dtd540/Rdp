import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normaliseReleaseNotes } from '@shared/update';

export function readBundledReleaseNotes(changelog: string, version: string): string | undefined {
  const headings = [...changelog.matchAll(/^##[ \t]+v?(\d+\.\d+\.\d+)(?:[ \t]+[^\r\n]*)?$/gm)];
  const targetVersion = version.replace(/^v/i, '');
  const index = headings.findIndex((heading) => heading[1] === targetVersion);
  if (index < 0) return undefined;
  const start = headings[index].index! + headings[index][0].length;
  const end = headings[index + 1]?.index ?? changelog.length;
  const entry = normaliseReleaseNotes(changelog.slice(start, end), targetVersion);
  return entry?.split('\n').map((line) => line.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).join('\n');
}

export function loadBundledReleaseNotes(appPath: string, version: string): string | undefined {
  try {
    const changelog = readFileSync(path.join(appPath, 'docs', 'CHANGELOG.md'), 'utf8');
    return readBundledReleaseNotes(changelog, version);
  } catch (error) {
    console.error('[updater] could not read bundled release notes:', error);
    return undefined;
  }
}
