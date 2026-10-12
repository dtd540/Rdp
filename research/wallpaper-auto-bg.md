# Wallpaper Engine idle-background prototype for SPOTT

## Where Wallpaper Engine lives

- Steam app id: **431960**
- Executable (this PC): `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\wallpaper64.exe`
- Scene wallpaper on this PC: `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\projects\myprojects\iub\scene.json`
  - (Points at `scene.json` via `project.json`, title "iub". Principal artwork lives in `materials/` / `models/` / `shaders/` / `scene.json`.)
- Preview art lives in `projects/myprojects/iub/preview/`.

Wallpaper Engine must already be running to accept `-control` commands. The documented control path is:
  ..\wallpaper_engine\wallpaper64.exe -control openWallpaper -file "<path>" -playInWindow "<name>" -width <w> -height <h> [-x <x> -y <y> -borderless]

## What I verified (against the live Wallpaper Engine)

- `wallpaper64.exe -control openWallpaper -file "...\wallpaper_engine\projects\myprojects\iub\scene.json" -playInWindow "SPOTT Idle Background" -width 1920 -height 400 -borderless -x 0 -y 0` **works**:
  - creates a separate, borderless window titled **"SPOTT Idle Background"**
  - visible window, dims **1920x400** after an explicit `MoveWindow(0,0,1920,400,true)`
- Window is borderless (correct) and moves to screen top via `MoveWindow`. Size is readable back.
- `-borderless` flag produces a borderless modern crop (borderless window), not a true "always-on-top-transparent desktop wallpaper replacement". It still owns its own window frame and Z-order stack in the taskbar area. That's fine for an *idle backdrop* but not the same as replacing the desktop wallpaper.

## So what this means / how to hook it up

### Option A — launch as a borderless pop-out idle background (what we verified works)
Construct a standby shortcut/probe running:

```
"C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\wallpaper64.exe"
   -control openWallpaper
   -file "C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\projects\myprojects\iub\scene.json"
   -playInWindow "SPOTT Idle Background"
   -width 1920 -height 400
   -borderless -x 0 -y 0
```

- `-playInWindow "SPOTT Idle Background"` — unique window name; use it later to close (`-control closeWallpaper -location "SPOTT Idle Background"`).
- `-borderless -x 0 -y 0 -width 1920 -height 400` — borderless, full-width strip at top of desktop.
- Wallpaper Engine must be running first; opening the scene.json does NOT fail, it creates the window.

This is the **documented, supported** route. It produces a separate borderless window. Not a seamless "desktop wallpaper replacement", but it does produce the visual — idle anim behind the app.

### Option B — use Wallpaper Engine's idle/display mode (different mechanism)
Not what we verified. The CLI doc does NOT expose a "use as desktop wallpaper across monitors" control via -control (that's configured through Wallpaper Engine UI: Performance → Application Rules, and desktop display mode). But as an idle backdrop overlay (small borderless window sitting behind/around SPOTT), Option A is the documented path.

### Things that make it cleaner as an SPOTT integration

- **Auto-start Wallpaper Engine if it's not running** before sending `-control`. The CLI requires WE already running. So the binding should:
  - detect if `wallpaper64.exe` is running (Process exists, or check `steam://run/431960` availability),
  - if not, offer to open it first (Steam starts WE), or launch `wallpaper64.exe` directly if Steam is guaranteed.
- **Wallpaper selection UI**: a project browser in SPOTT (list `projects\myprojects` and `projects\defaultprojects` and any `.proj.json` → pick scene.json). Each scene.json can be pointed to by `openWallpaper -file`.
- **Window control**: 
  - open with `-playInWindow "SPOTT Idle Background"` 
  - resize to match SPOTT's desired backdrop zone
  - close via `-control closeWallpaper -location "SPOTT Idle Background"`
- **Audio sync**: nothing time-synced here, but the wallpaper is a static/animated backdrop; can be independent of Spotify audio — that's fine.

## Unresolved / notes

- There is **no documented WebSocket/JSON-RPC control server** for Wallpaper Engine — the developer once publicly said there isn't one (Steam thread, 2019). The official control route is CLI `-control` only. So you cannot "push wallpapers" to WE over a socket; you must shell `wallpaper64.exe -control ...`.
- `MoveWindow` works for repositioning (confirmed RECT readable after move). If you can't get RECT, `MoveWindow` is still usable to place the window.
- On this PC the install path is `(x86)\Steam\steamapps\common\wallpaper_engine`. If Steam moves (other library), use `steam://run/431960` to open it, but fopen the exe path is still the control mechanism — so resolve the install dir from the registry or from `.../steamapps/common/wallpaper_engine` by scanning both Program Files locations.

## What I'd do next (implementation sketch)

1. Add to [App.tsx](app/renderer/src/App.tsx) or a sidebar control a "Wallpaper Engine backdrop" toggle + picker of scenes into a small list. Store choice in app state (e.g. `backgroundPath:` already exists — could reuse for the picked scene path, but rename to avoid confusion with image backgrounds).
2. In main IPC, add an op like `wallpaper.openBackdrop(path, { width, height, x, y })` that:
   - ensures `wallpaper64.exe` is running (launch via `steam://run/431960` or `wallpaper64.exe -control play` if already started but paused), then
   - spawns `wallpaper64.exe -control openWallpaper -file "<scene>" -playInWindow "SPOTT Idle Background" -width W -height H -borderless -x X -y Y` as a separate process (or via `child_process.spawn`), and
   - tracks the window name "SPOTT Idle Background" so it can close it later.
3. Add a `wallpaper.closeBackdrop()` that runs `wallpaper64.exe -control closeWallpaper -location "SPOTT Idle Background"`.
4. Save the last opened backdrop scene into state so relaunch restores it.

That gives SPOTT a wallpapeen idle-background behind it using the documented control path.
