/**
 * Address-bar rules for the embedded browser.
 *
 * Ported to match the behaviour of VRC Nexus 1.2.31's NEXBROWSE v2 (its `normalizeUrl`),
 * because the distinctions matter: a LAN address must become http (a dev server does not
 * speak https), `about:blank` has to survive as the new-tab start page, and only a real
 * host-and-TLD shape should be treated as a URL rather than a search.
 */

export const SEARCH = 'https://www.google.com/search?q=';
export const BLANK = 'about:blank';

/** Returns the URL to load, or null when the input carries no destination. */
export function normalizeUrl(input: unknown): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (/^(https?|file):\/\//i.test(raw)) return raw;
  if (/^about:(blank|newtab)?$/i.test(raw)) return BLANK;
  // localhost / loopback / a bare IP with an optional port is a local server, so http.
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/i.test(raw)) {
    return `http://${raw}`;
  }
  // Any other explicit scheme (vrchat:, steam:, spotify:) is left for the OS to handle.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  // Only a host with a real TLD is a URL; "3.5" or "my.file" must fall through to search.
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(:\d+)?(\/|$|\?)/i.test(raw)) return `https://${raw}`;
  return SEARCH + encodeURIComponent(raw);
}

/** Display host, minus the `www.` noise. */
export function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'blank' ? '' : host;
  } catch {
    return url;
  }
}

/** Empty for the start page, so a blank tab shows no broken favicon request. */
export function faviconUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (!host || url === BLANK) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
  } catch {
    return '';
  }
}
