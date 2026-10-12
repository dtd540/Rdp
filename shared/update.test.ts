import { describe, expect, it } from 'vitest';
import { normaliseReleaseNotes, shouldShowWhatsNew, whatsNewForVersion } from './update';

describe('normaliseReleaseNotes', () => {
  it('trims plain string release notes, normalises newlines and treats empty notes as missing', () => {
    expect(normaliseReleaseNotes('  Fixed routing.  ', '1.2.3')).toBe('Fixed routing.');
    expect(normaliseReleaseNotes('Fixed\r\n\r\nDetails', '1.2.3')).toBe('Fixed\n\nDetails');
    expect(normaliseReleaseNotes('  ', '1.2.3')).toBeUndefined();
  });

  it('joins only matching and unversioned entries from electron-updater notes', () => {
    expect(normaliseReleaseNotes([
      { version: '1.2.3', note: 'Added the update log.' },
      { note: 'Improved startup.' },
      { version: '1.2.2', note: 'Older release.' },
      { version: '1.2.3', note: '  Fixed a bug.  ' },
      null,
      { version: '1.2.3', note: '' }
    ], '1.2.3')).toBe('Added the update log.\n\nImproved startup.\n\nFixed a bug.');
  });

  it('ignores unrecognized or malformed metadata', () => {
    expect(normaliseReleaseNotes({ note: 'not an array' }, '1.2.3')).toBeUndefined();
    expect(normaliseReleaseNotes([{ version: '1.2.2', note: 'old' }], '1.2.3')).toBeUndefined();
  });
});

describe('one-time What’s New state', () => {
  it('shows once after an upgrade or when an updater notice is pending, but not on first install or after dismissal', () => {
    expect(shouldShowWhatsNew(null, null, '0.3.5')).toBe(false);
    expect(shouldShowWhatsNew(null, null, '0.3.5', null, true)).toBe(true);
    expect(shouldShowWhatsNew('0.3.4', null, '0.3.5')).toBe(true);
    expect(shouldShowWhatsNew(null, null, '0.3.5', '0.3.5')).toBe(true);
    expect(shouldShowWhatsNew('0.3.4', '0.3.5', '0.3.5', '0.3.5', true)).toBe(false);
    expect(shouldShowWhatsNew(null, null, '0.3.5', '0.3.4')).toBe(false);
    expect(shouldShowWhatsNew('v0.3.4', 'v0.3.3', 'v0.3.5')).toBe(true);
    expect(shouldShowWhatsNew('0.3.4', 'v0.3.5', '0.3.5')).toBe(false);
  });

  it('provides known release entries and a safe fallback for uncatalogued versions', () => {
    expect(whatsNewForVersion('0.3.4').releaseNotes).toContain('Save and restore');
    expect(whatsNewForVersion('9.9.9').releaseNotes).toContain('Bug fixes and improvements');
  });
});
