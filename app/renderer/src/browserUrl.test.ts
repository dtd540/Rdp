import { describe, expect, it } from 'vitest';
import { BLANK, SEARCH, faviconUrl, hostOf, normalizeUrl } from './browserUrl';

describe('browser address bar', () => {
  it('keeps real URLs untouched', () => {
    expect(normalizeUrl('https://vrchat.com/home')).toBe('https://vrchat.com/home');
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('file:///C:/notes.txt')).toBe('file:///C:/notes.txt');
  });

  it('treats localhost, loopback and bare IPs as http', () => {
    // A dev server does not speak https; forcing it would make every local preview fail.
    expect(normalizeUrl('localhost:5199')).toBe('http://localhost:5199');
    expect(normalizeUrl('127.0.0.1:63215/@fs/app.html')).toBe('http://127.0.0.1:63215/@fs/app.html');
    expect(normalizeUrl('192.168.1.10')).toBe('http://192.168.1.10');
  });

  it('keeps the start page as about:blank', () => {
    expect(normalizeUrl('about:blank')).toBe(BLANK);
    expect(normalizeUrl('about:newtab')).toBe(BLANK);
    expect(normalizeUrl('about:')).toBe(BLANK);
  });

  it('promotes a host with a real TLD to https', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('booth.pm/items')).toBe('https://booth.pm/items');
    expect(normalizeUrl('youtube.com?q=1')).toBe('https://youtube.com?q=1');
  });

  it('searches for anything that is not a URL', () => {
    expect(normalizeUrl('vrchat avatar worlds')).toBe(`${SEARCH}vrchat%20avatar%20worlds`);
    // A version number is not a host, unlike a loose "contains a dot" test would assume.
    expect(normalizeUrl('3.5')).toBe(`${SEARCH}3.5`);
    // "notes.txt" does look like host.tld and is treated as one — the same call NEXBROWSE
    // makes, kept deliberately so the two browsers agree on what is a URL.
    expect(normalizeUrl('notes.txt')).toBe('https://notes.txt');
  });

  it('returns null for empty input so the caller can pick the start page', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
  });

  it('omits favicons for the start page and strips www for display', () => {
    expect(faviconUrl(BLANK)).toBe('');
    expect(faviconUrl('not a url')).toBe('');
    expect(faviconUrl('https://www.example.com/x')).toContain('example.com');
    expect(hostOf('https://www.example.com/x')).toBe('example.com');
  });
});
