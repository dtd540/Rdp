# 01 — Install layout

Everything in `C:\Users\<you>\Desktop\VRC-Nexus-1.2.31-TEST`. 855 files, 166 directories.

## Top level

| File | Size | What it is |
|---|---|---|
| `VRC Nexus.exe` | 223 MB | The Electron 41.5.0 binary (Chromium + Node), self-contained |
| `resources/` | — | The actual application — everything interesting |
| `locales/` | — | Chromium UI strings (not app logic) |
| `*.pak`, `*.dll`, `icudtl.dat`, `v8_context_snapshot.bin`, `snapshot_blob.bin` | — | Standard Electron runtime files |
| `TEST-BUILD.txt` | 82 B | Marks this as a test build, not the shipped 1.2.31 |
| `MOD-INVENTORY.md` | 3.6 KB | Inventory of the mods layered onto stock |
| `OWNER-*.md` (9 files) | ~90 KB | Notes from an earlier session about patching the app |
| `_main.decoded.js`, `_main.decoded2.js` | 658 KB each | Byte-identical copies of the decoded main bundle |
| `_decoded_table.json` | 58 KB | **The deobfuscated string table — 1833 strings.** The single most useful file here |
| `_harness_full.js`, `_harness_test.js` | 78 KB each | The harness used to decode the string table |
| `debug.log` | 314 B | Last run's debug output |
| `.freebuff/` | — | Freebuff workspace metadata |

The `OWNER-*.md` and `_*.js` files at the root are **artifacts of earlier work**, not part of the app.

## `resources/`

| Entry | What it is |
|---|---|
| `app/` | The unpacked application (electron-builder `asar: false` or an already-unpacked tree) |
| `app.asar.bak` | The pristine original archive, kept for reference |
| `elevate.exe` | UAC elevation helper |
| `native/openvr-overlay/` | OpenVR overlay native module — `openvr_api.dll` + `openvr_overlay.node` + `index.js` |
| `sidecar/` | **Empty** in this build |

## `resources/app/`

`package.json`: name `vrc-nexus`, version `1.2.31`, `"type": "module"`, entry
`dist-electron/electron/main.js`. Runtime dependencies are only **`axios`** and **`vue`** —
everything else is hand-written or vendored.

### Frontend — `dist/` (Vue 3 + Vite build)

| File | Size | What it is |
|---|---|---|
| `index.html` | — | App shell. **This is where the sidebar tab list lives** |
| `assets/main-TOumUbV8.js` | 1.18 MB | The entire Vue application |
| `assets/main-C2siE-8d.css` | 157 KB | All styling |
| `assets/nxbrowse.js` | 125 KB | **Nexus Embedded Browser (NEXBROWSE v2)** — the browser tab |
| `assets/nx-ai.js` | 18 KB | AI bridge client (mod) |
| `assets/nx-system-stats.js` | 9 KB | System stats probe (mod) |
| `assets/future-4oaLa8Fm.js` | 1.01 MB | Large lazily-loaded feature bundle |
| `assets/future-DxcLCXDE.css` | 152 KB | Styles for the above |
| `assets/preload-helper-2WdCpnW9.js` | 6 KB | Vite preload helper |
| `ai-overlay.html` | — | Separate window for the AI overlay |
| `future.html` | — | Separate window for the "future" bundle |
| `assets/vencord/` | — | `browser.js`, `browser.css`, `vencord-preload.js` — Vencord, injected into the embedded browser |

### Main process — `dist-electron/electron/`

| File | Size | What it is |
|---|---|---|
| `main.js` | 692 KB | The Electron main process: windows, IPC, tray, OSC, updates, protocols |
| `preload.cjs` | 30 KB | Context-bridge surface — **the authoritative list of every capability** |
| `games-stats-preview.html` | 12 KB | Preview window used by the games stats feature |

### `electron/preload.cjs`

24 lines. A second copy of the preload — the one actually referenced by the live build is
`dist-electron/electron/preload.cjs`.

### `.backup/`

| File | What it is |
|---|---|
| `index.html.orig` | Stock sidebar, **before the mods**. Shows the 16 original tabs |
| `main.js.orig` | Pre-mod main bundle |
| `nxbrowse.js.pre-games-redesign` | 1864 lines, **readable, hand-written** — the browser before a games redesign pass |

### `native/openvr-overlay/`

`openvr_api.dll` + `openvr_overlay.node` + `index.js`. A Node native addon that draws an overlay
into the VR compositor via OpenVR — used by the lyric island, player overlay and FPS overlay so
they appear **inside VR**, not just on the desktop.

## Obfuscation

The shipped bundles are obfuscated with **javascript-obfuscator**: hex string table, array
rotation, control-flow flattening. `main.js` and `preload.cjs` both start with the same
`_0x354c13=_0xba91;(function(...){...while(!![]){try{...parseInt...` shuffle preamble.

Two consequences:

1. `preload.cjs` still reads well, because the IPC channel names are **plain string literals** —
   only the local variable names are hex. That is why it is the best source of truth (see 02).
2. `_decoded_table.json` holds all 1833 recovered strings — every URL, file name, UI label and
   PowerShell fragment — without needing to run a deobfuscator.

The one exception is `assets/nxbrowse.js` / `.backup/nxbrowse.js.pre-games-redesign`, which is
**plain, commented, hand-written JavaScript**.