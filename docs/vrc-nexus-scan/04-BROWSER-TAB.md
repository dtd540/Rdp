# 04 — Browser tab (Nexus Embedded Browser, "NEXBROWSE v2")

Source: `resources/app/dist/assets/nxbrowse.js` (2778 lines, plain readable JS).
This is the **mod** — the header says so explicitly:

```
// ===== Nexus embedded browser (NEXBROWSE v2) =====
// Full multi-tab webview browser for VRC Nexus (modded TEST build).
```

Structure: one IIFE, no framework, direct DOM. It injects itself into the `browser` tab.

## What it is

A real multi-tab browser built on Electron `<webview>` tags — tabs, address bar with
omnibox suggestions, bookmarks, history, find-in-page, zoom, per-tab crash recovery,
session restore, drag-to-reorder, context menus, keyboard shortcuts, an owner override
card in settings, and a "tab power" right-click menu with pins.

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
| Games prefs | `nexus_games:v1` |

## Quick links on the welcome page

VRChat · YouTube · GitHub · Reddit · Discord · Twitch

(The hard-coded starter quick links live in `renderQuickLinks`; the saved quick-links array
comes from `nexbrowse:v2`.)

## Features

**Tabs**
- `createTab(url, activate)` builds the webview + chrome; `destroyTab`, `activateTab`
- Each tab tracks `{id, url, title, active, crashed, muted, playingAudio, pinned}`
- Crash handling: `showCrashCard(tab, reason)` replaces a dead webview with a reload card
  instead of leaving a blank pane
- Session restore: open tabs survive a UI reload or app restart via `nexbrowse:session:v1`
- Tab sleep: inactive tabs are sent to `about:blank` and restored on activate
  (`dataset.sleepUrl`), so only the active webview is really loaded
- Mute per tab via `webview.setAudioMuted`
- Pinned tabs sort to the left; pin state saved under `nexbrowse:tabpower:pins`

**Address bar**
- `normalizeUrl(input)` — turns `"example.com"` into `https://example.com`, leaves real URLs alone,
  local IPs default to `http://`, unknown schemes preserved
- Omnibox suggestions (`buildOmni`/`collect`/`renderOmni`/`pick`) merging history, bookmarks and
  quick links with weights; arrow keys move, Enter picks, Esc dismisses
- `hostOf(u)` strips `www.` for display; `faviconUrl(u)` builds the favicon URL
- Lock icon shows `🔒` for https, `⚠` otherwise
- Star toggles bookmark for the current page

**Navigation** — back / forward / reload / home / stop, with nav-state enable/disable from
`webview.canGoBack()` / `.canGoForward()`. Home here is the NEXBROWSE blank start page, not Google.

**Keyboard shortcuts**
- Ctrl+T new tab, Ctrl+W close tab, Ctrl+R reload, Ctrl+F find, Ctrl+D bookmark,
  Ctrl+H history overlay, Ctrl+B bookmarks overlay, Ctrl++ / Ctrl+- / Ctrl+0 zoom,
  Ctrl+L focus address bar, Ctrl+Shift+T reopen closed tab, Ctrl+Shift+P pin/unpin current tab,
  Alt+Left/Right back/forward, Esc close find, Enter in find input runs find

**Find-in-page**
- `openFind`/`closeFind`/`doFind`, `webview.findInPage` + `stopFindInPage('clearSelection')`,
  hit count shown as `activeMatchOrdinal / matches`

**Bookmarks / history overlay**
- `showOverlay(kind)` builds a panel with favicons, titles, URLs, timestamps for history,
  delete buttons for bookmarks, and a "Clear all history" control

**Tab power menu**
Right-click a tab: Pin / Unpin, Duplicate, Mute / Unmute, Close, Close other tabs,
Close tabs to the right. Right-click empty strip: New tab / Reopen closed tab.
Pins persist under `nexbrowse:tabpower:pins`.

**Drag to reorder**
- `bindDrag` uses pointer events; pinned/unpinned groups stay separate while dragging;
  the strip re-renders and the dragged element is re-grabbed because render replaces nodes

**Window fit**
- `fitBrowser()`/`immersive()` size the webview to the pane, and a poll keeps the height correct
  while the window is resized or the sidebar collapses. Immersive hides the tab strip + toolbar
  when a real page (not the start page) is showing, with a slim floating mini-bar for back/home/reload.

**Input / start page**
- `bindKeys()` for the shortcuts above; `bindWelcome()` wires the big search box and the quick-link
  cards on the start page.

## Settings extras injected by nxbrowse

**Owner Status Override** (Settings → Advanced)
- Toggle from real registry access level to forced owner features, persisted in
  `localStorage` key `nexus_owner_override_off`. The card is re-rendered every time Settings
  activates because the app rebuilds that panel's innerHTML on each visit.
- `window.toggleOwnerStatus()` flips the flag and re-runs `refreshAccessState(true)` if present.

**Ad Blocker** (Settings → Advanced)
- `renderAdblockCard`/`updateAdblockCard`/`toggleAdblock` use `vrcManager.adblockState()` and
  `vrcManager.adblockToggle()`. Takes effect on new page loads, applies to embedded webviews only.

## Games tab wiring inside nxbrowse

There is a second big chunk in the same file: **Steam Games Library v2**.

- `renderGames(games)` and `renderLibrary(games)` are separate grids.
- `scanGames()` calls both `vrcManager.scanSteamGames()` and `vrcManager.steamLibrary()`,
  then renders each grid from the result.
- `renderLibrary()` prefers a per-game `installed` flag; if the payload lacks it, it falls back
  to name-matching against the installed grid.
- Covers: tries a `cover` field if present, then cloudflare `library_600x900.jpg`, then cloudflare
  `header.jpg`, then an inline SVG fallback.
- Click a game -> status text + `vrcManager.launchSteamGame(appid)` -> status update.
- Installed cards show a green "✓"-style pill; library cards show "no"-style pill and a "not installed"
  meta line.
- Toolbar has search, view mode (grid/list), sort chips, filter chips, and a rescan button.
- View/sort/filter prefs persist under `nexus_games:v1`.

So nxbrowse already contains the "installed + owned-but-not-installed" games UI pattern, not just
the browser.

## Discord + Movies wiring inside nxbrowse

**Discord panel**
- Embeds `https://discord.com/app` in a webview with partition `persist:discord`,
  `allowpopups=false`, a Chrome/131-style useragent, and a special preload that injects Vencord.
- Notification shim replaces `window.Notification` inside the webview so Discord's web notifications
  don't throw.
- "Pop" button hands off to the browser tab and loads the Discord URL.
- Reload + start buttons; height-fit polling.

**Movies panel (nepu.io)**
- Embeds `https://nepu.io/movies` in a webview with partition `persist:webmovies`.
- Reload / home / open buttons; height-fit logic; fullscreen enter/leave handling.
- PiP button: asks the webview for the current `<video>`, pauses it, reads currentTime, then calls
  `vrcManager.pipOpen({ url, t })` and expects the main process to open a mini window and pipe the
  stream.
- OSC rich presence: polls `vrcManager.moviesPlayState()` every 5s, cleans the nepu.io page title
  with a set of regexes, formats `title — HH:MM:SS` when playing, and sends to VRChat chatbox via
  `vrcManager.sendOscChatbox({ text })`. Toggle button "🎬 RP", persisted in `nx_rp_enabled`.

## Webview hardening

`hookWebview(wv, prefix)` / `hookAll()` wrap the webview APIs so the app can veto navigation,
read titles, and intercept zoom.

## Preload bridge nxbrowse expects from main

From the preload scripts in the TEST build (`dist-electron/electron/preload.cjs` and
`app/electron/preload.cjs`, plus the Vencord preload), nxbrowse uses these on `window.vrcManager`:

- `scanSteamGames()` -> `{ ok, games }`
- `steamLibrary()` -> `{ ok, games }`
- `launchSteamGame(appid)` -> `{ ok, error? }`
- `openGameFolder(appid)` -> `{ ok, error? }`
- `moviesPlayState()` -> `{ ok, state: { hasVideo, playing, cur, title } }`
- `sendOscChatbox({ text })` -> promise
- `pipOpen({ url, t })` -> `{ ok, error? }`
- `adblockState()` -> `{ on, blocked? }` or bool
- `adblockToggle()` -> same shape
- `getVencord()` -> `{ ok, css, js }` (used only by the Discord webview preload)

The Discord webview preload (`dist/assets/vencord/vencord-preload.js`) uses
`webFrame.executeJavaScript` to inject Vencord CSS + JS into the Discord webview's main world.
It resolves the Vencord dir by walking up from the preload's `__dirname` looking for
`dist/assets/vencord/browser.js`.

## Notes for the rebuild

nxbrowse is self-contained on the renderer side. It does **not** need VRC Nexus's backends; it only
needs:
- `<webview>` (already available in VRChat Music Bridge's `webPreferences`)
- an IPC bridge that exposes the small set above for Steam + movies + OSC + PiP + adblock + Vencord
- optional: Vencord's web build files if we want Discord to behave like the TEST build

Port priority for VRChat Music Bridge:
1. Browser tab: tab strip, address bar, omnibox, session restore, crash card, find-in-page, zoom,
   keyboard shortcuts. Bookmarks/history overlay and tab power menu are polish.
2. Movies tab: nepu.io embed + PiP + OSC rich presence.
3. Games tab: nxbrowse already does the installed + library split; this app can match that behavior
   in its own UI.
4. Discord tab: either plain embedded Discord here, or Vencord-injected if we decide to package it.

Do **not** port VRC Nexus's main-process backends or the `api.vrc-nexus.online` dependency.
