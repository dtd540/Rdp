# 05 — Games tab

Source: `resources/app/dist/assets/nxbrowse.js`, sections *"Games"* (v1, ~line 1766) and
*"Steam Games Library v2"* (~line 2373). The v2 block is the live UI; v1 is kept in the DOM but
inert (`// ---- hide stock Games markup (kept in DOM, just inert) ----`).

## What it is

A Steam library browser: scan the local Steam install, list every game with cover art and install
size, and launch a game or open its install folder.

## How Steam is found

The recovered strings tell the whole story:

| Step | How |
|---|---|
| 1 | Read `HKCU\Software\Valve\Steam` for the Steam path |
| 2 | Look in `…\steamapps` |
| 3 | Parse each library's manifests for installed titles |

Confirmed by the only two Steam strings in the decoded table: `steamapps` and
`HKCU\Software\Valve\Steam`.

## IPC surface

| Call | Purpose |
|---|---|
| `vrcManager.scanSteamGames()` | Scan the machine, returns installed games |
| `vrcManager.steamLibrary()` | Cached library listing |
| `vrcManager.launchSteamGame(id)` | Start a game |
| `vrcManager.openGameFolder(id)` | Reveal its install folder |
| `vrcManager.getProbeSystemStats()` | CPU/GPU/RAM sampling for the stats panel |
| `startProbeSystemStats` / `stopProbeSystemStats` | Live stats while a game runs |

Backed by `games:scan`, `games:library`, `games:launch`, `games:openfolder`, `probe:*`.

## Cover art

Tries two CDNs, with a generated placeholder if neither has it:

- `https://steamcdn-a.akamaihd.net/steam/apps/`
- `https://shared.cloudflare.steamstatic.com/steam/apps/`

`placeholderCover(name)` builds a deterministic coloured tile from the game name so a missing
cover never leaves an empty hole. `coverHtml(g, tall)` renders either art or the placeholder,
including the tall (vertical) variant used in the grid.

## UI behaviour worth keeping

- `setStatus(msg)` / `toast(msg)` for scan progress and errors
- `visible()` — only scans and renders when the Games tab is actually on screen, so switching tabs
  costs nothing
- **Delegated events that survive re-renders** (`// ---- events (delegated, survive re-renders) ----`)
  — the list re-renders often; handlers are bound to the container, not to rows
- Per-tab zoom preferences persisted in `localStorage` via `zoomMap()` / `zoomSave()`
- `fmtSize(bytes)` and `timeAgo(sec)` formatting helpers
- `scrollFix()` for grid scrolling after re-render

## Also in this file: the avatar uploader

Not the Games tab, but adjacent and worth noting, because it reuses the same panel machinery:

`uploadAvatar` (with `onUploadProgress`) · `unityStatus` / `unityBuild` / `unityExtractZip` ·
`sdk:download` · `getAvatarById` / `getFileById` · `onVrmodelsDownloaded`
— a build-an-avatar-bundle-and-upload pipeline with progress reporting.

## Notes for the rebuild

The Games tab needs no VRC Nexus code and no third-party API: Steam is local, and the CDNs are
public image hosts. A faithful rebuild is:

1. Read `HKCU\Software\Valve\Steam` → `SteamPath` (fall back to the default install path).
2. Read `libraryfolders.vdf` for extra library roots, then each `steamapps/appmanifest_*.acf` for
   `appid`, `name`, `installdir`.
3. Return a normalised game record `{ id, name, installDir, sizeOnDisk, lastPlayed, coverUrl }`.
4. Launch via Steam's URL scheme (`steam://rungameid/<appid>`) and open the folder with `shell.open`.

No registry or VDF parsing is needed in the renderer — it all belongs in the main process, where
VRChat Music Bridge already has the `fs` helpers and IPC pattern.