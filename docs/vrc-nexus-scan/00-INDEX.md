# VRC Nexus 1.2.31 TEST — scan notes

Working notes taken from the running `VRC Nexus 1.2.31 TEST` build so the feature set can be
recreated from scratch if the original copy is lost during the move to a flash drive.

These notes are **about** the old app, not a copy of it. Everything here describes *what a
feature does and why it is built the way it is*, so the behaviour can be reimplemented.

## Why this exists

The plan is to move to a flash drive and rebuild the PC. If the only copy of VRC Nexus is on the
disk that gets wiped, these notes are the recovery path. They are committed to the repo on the
`feature/nexus-tabs` branch so they travel with the source.

## Where the original lives

| Thing | Path |
|---|---|
| Install root | `C:\Users\dalto\Desktop\VRC-Nexus-1.2.31-TEST` |
| App code | `resources/app/` (unpacked, not `app.asar`) |
| Original asar | `resources/app.asar.bak` (20.6 MB) |
| Chromium profile | `%APPDATA%\vrc-nexus` |
| App-local data | `%LOCALAPPDATA%\VRC Nexus` |
| Other copies | Desktop `VRC Nexus (Original)`, `VRC Nexus.exe`, Downloads (`1.2.29`, `OldUI`, etc.) |

## Documents

| File | What's in it |
|---|---|
| [01-INSTALL-LAYOUT.md](01-INSTALL-LAYOUT.md) | Every file and folder in the install, and what each one is for |
| [02-FEATURE-INVENTORY.md](02-FEATURE-INVENTORY.md) | All 20 sidebar tabs and every capability behind them |
| [03-DEPENDENCIES.md](03-DEPENDENCIES.md) | Third-party services the app calls, and what has to be re-wired |
| [04-BROWSER-TAB.md](04-BROWSER-TAB.md) | The embedded browser (Nexus Embedded Browser) |
| [05-GAMES-TAB.md](05-GAMES-TAB.md) | Steam library scan and launching |
| [06-MOVIES-TAB.md](06-MOVIES-TAB.md) | Web movies / picture-in-picture |
| [07-APP-SHELL.md](07-APP-SHELL.md) | Window, tray, overlay windows, protocols, updater |
| [08-PORTING-PLAN.md](08-PORTING-PLAN.md) | What moves into VRChat Music Bridge and in what order |

## Reading order for a rebuild

1. `02-FEATURE-INVENTORY.md` — what the thing has to do.
2. `03-DEPENDENCIES.md` — what it has to talk to.
3. The per-tab files for the mechanics of individual features.
4. `08-PORTING-PLAN.md` — the order to build in.

## Ground rules for the rebuild

- **No dependency on VRC Nexus itself.** No calling `api.vrc-nexus.online`, no reading the old
  app's files at runtime, no shipping its binaries.
- **Third-party services are fine, but must work from our app directly** — VRChat API, VRCX-style
  avatar search, lyrics, translation, weather, Steam. See `03-DEPENDENCIES.md`.
- **New UI, new code.** The old UI is not copied. Behaviour is the specification.