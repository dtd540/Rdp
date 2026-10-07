
export const SEARCH = 'https://www.google.com/search?q=';
export const BLANK = 'about:blank';

export function normalizeUrl(input: unknown): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (/^(https?|file):\/\//i.test(raw)) return raw;
  if (/^about:(blank|newtab)?$/i.test(raw)) return BLANK;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/i.test(raw)) {
    return `http://${raw}`;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(:\d+)?(\/|$|\?)/i.test(raw)) return `https://${raw}`;
  return SEARCH + encodeURIComponent(raw);
}

export function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'blank' ? '' : host;
  } catch {
    return url;
  }
}

export function faviconUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (!host || url === BLANK) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
  } catch {
    return '';
  }
}
