# 04 — Browser tab (Nexus Embedded Browser, "NEXBROWSE v2")

Source: `resources/app/dist/assets/nxbrowse.js` (2777 lines, plain readable JS).
This is the **mod** — the header says so explicitly:

```
// ===== Nexus embedded browser (NEXBROWSE v2) =====
// Full multi-tab webview browser for VRC Nexus (modded TEST build).
```

Structure: one IIFE, no framework, direct DOM. It injects itself into the `browser` tab.

## What it is

A real multi-tab browser built on Electron `<webview>` tags — tabs, address bar with
omnibox suggestions, bookmarks, history, find-in-page, zoom, per-tab crash recovery,
session restore, drag-to-reorder, and a "tab power" context menu with pins.

## Configuration

| Setting | Value |
|---|---|
| Home | `https://www.google.com/` |
| Search | `https://www.google.com/search?q=` |
| Favicons | `https://www.google.com/s2/favicons?domain=` |
| Primary store key | `nexbrowse:v2` |
| Session key | `nexbrowse:session:v1` |
| Closed-tab stack | `nexbrowse:tabpower:v1` |
| Pinned menu items | `nexbrowse:tabpower:pins` |

## Quick links on the welcome page

YouTube · Twitch · Reddit · GitHub · VRChat · VRChat Wiki · booth.pm · vrmodels.store

## Features

**Tabs**
- `createTab(url, activate)` builds the webview + chrome; `destroyTab`, `activateTab`
- Each tab tracks `{id, url, title, active, crashed, muted}`
- Crash handling: `showCrashCard(tab, reason)` replaces a dead webview with a reload card
  instead of leaving a blank pane
- Session restore: open tabs survive a UI reload or app restart

**Tab power menu**
Right-click (or the ⋮ button) opens a menu of saved/pinned entries; pins persist under
`nexbrowse:tabpower:pins`. Recently closed stack supports reopening the last closed tab.

**Address bar**
- `normalizeUrl(input)` — turns "example.com" into `https://example.com`, leaves real URLs alone
- Omnibox suggestions (`buildOmni`/`collect`/`renderOmni`/`pick`) merging history, bookmarks and
  quick links with weights
- `hostOf(u)` strips `www.` for display; `faviconUrl(u)` builds the favicon URL
- Star toggles bookmark for the current page

**Navigation** — back / forward / reload / home, with nav-state enable/disable

**Panels** — bookmarks and history overlay (`showOverlay(kind)`), find-in-page bar, zoom in/out

**Window fit** — `fitBrowser()`/`immersive()` size the webview to the pane, and a poll keeps the
height correct while the window is resized or the sidebar collapses

**Input** — `bindKeys()` for Ctrl/Cmd+L (focus address), Ctrl+T (new tab), Ctrl+W (close),
Ctrl+F (find), Ctrl +/- (zoom), Ctrl+Tab, F5; `bindWelcome()` for the start page

## Webview hardening

`hookWebview(wv, prefix)` / `hookAll()` wrap the webview APIs so the app can veto navigation,
read titles, and intercept zoom. Vencord is injected via `vencord:get` so Discord works in a tab.

## Notes for the rebuild

The browser is self-contained and does not need VRC Nexus at all — it only needs `<webview>`
(already enabled in VRChat Music Bridge's `webPreferences`) plus a navigation policy. VRChat Music
Bridge's existing Discord webview already implements most of the hardening pattern.

Port it as: a tab strip, an address bar, and a webview pane, with per-tab crash cards and session
restore. Everything else is polish.