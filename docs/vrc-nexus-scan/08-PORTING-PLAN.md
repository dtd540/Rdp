# 08 — Porting plan

How VRC Nexus 1.2.31's feature set lands in VRChat Music Bridge, in buildable stages.

## Ground rules

1. **Nothing depends on VRC Nexus.** No `api.vrc-nexus.online`, no reading the old install at
   runtime, none of its binaries.
2. **Third-party services are re-wired directly** (see [03-DEPENDENCIES.md](03-DEPENDENCIES.md)).
3. **New UI.** The old layout is not copied; behaviour is the spec.
4. **Original code** everywhere except the four tabs the owner wrote, whose code may be reused.
5. Every stage leaves the app working, typechecked, tested and committed.

## Existing VRChat Music Bridge pieces this builds on

| Existing | Reused for |
|---|---|
| `app/main/ipc.ts` op dispatch | Every new tab's main-process calls |
| `app/preload/index.ts` context bridge | New bridge methods |
| `app/renderer/src/bridge.ts` + browser mock | Dev/preview without Electron |
| `webPreferences.webviewTag: true` | Browser / Movies / Discord webviews |
| Discord webview partition + navigation lockdown | Discord tab (already done) |
| `AppState` persistence | Per-tab settings |
| Sidecar (C#) + VoiceMeeter | Unrelated to these tabs — stays the audio core |

## Stage 0 — Notes *(done)*

Everything in this folder. Committed on `feature/nexus-tabs` so it survives the PC rebuild.

## Stage 1 — Tab shell + Browser + Games

**Tab shell.** Today the sidebar is a hardcoded `<Switch>` over four views. Replace with a
**tab registry**: `id → { label, icon, component, lazy? }`, so tabs can be added without touching
the shell, and a heavy tab only loads when opened. Keep the existing audio tabs (`setup`,
`mixer`, `discord`, `settings`) in the same registry.

**Browser tab.** Port from [04-BROWSER-TAB.md](04-BROWSER-TAB.md). Minimum viable:
multi-tab `<webview>`, address bar with `normalizeUrl`, back/forward/reload/home, Google
search + favicons, per-tab crash card, session restore, zoom, find-in-page. Then omnibox
suggestions, bookmarks/history, drag-to-reorder, tab power menu with pins.

Security: keep the navigation lockdown pattern already used for Discord — allow http/https,
deny everything else, and send external links to the system browser.

**Games tab.** Port from [05-GAMES-TAB.md](05-GAMES-TAB.md). Main process does all Steam work:
read `HKCU\Software\Valve\Steam`, parse `libraryfolders.vdf` and `appmanifest_*.acf`, return
normalised records. Launch via `steam://rungameid/<appid>`; open folder with `shell.open`.
Cover art from the two Steam CDNs with a generated placeholder fallback.

## Stage 2 — Movies + Discord

Movies from [06-MOVIES-TAB.md](06-MOVIES-TAB.md): embedded webview, PiP, and **OSC rich
presence** — poll play state and push "now watching" into VRChat's chatbox. This is the first
new OSC capability in VRChat Music Bridge and the most interesting one.

Discord already exists; bring it onto the shared embedded-site skeleton (welcome → webview,
status line, tuck/expand, height fit) so all three site tabs look and behave the same.

## Stage 3 — VRChat API adapter

Everything social needs one foundation: a **VRChat API client** with session-cookie auth
(login, 2FA, web login, restore) and multi-account storage, plus an **OSC client** (9000 out /
10040 in) with a monitor stream.

Adapter, not a rewrite: one typed module that turns VRChat JSON into our shapes, with the
VRCX-style avatar search fan-out behind it.

## Stage 4 — World and people tabs

`worlds` (search, current instance, create instance, portals), `playerlist` (roster, notes,
live roster), `social` (friends, groups, invites, mass invite).

## Stage 5 — Avatar tabs

`library` (avatars, metadata refresh, deleted-avatar detection, duplicates),
`favourites` (sections, VRChat web + VRCX import), `discover` (providers, user/world search),
`media`/inventory (screenshots, prints, inventory files).

## Stage 6 — Owner and community tabs

`moderation` (members, bans, kicks, roles, audit logs, instance control),
`membership` (device-bound supporter access, keys), `community` + share packs.

## Stage 7 — Power-user tabs

`magicchatbox` (OSC chatbox, typing, avatar parameters), `translator` (+ UI i18n),
`scripts` (script runner with floating GUI + hotkeys), `tools` (AutoDraw, log exports,
diagnostics), `socials`/lyric/player/FPS overlays (in-VR via OpenVR where wanted).

## Stage 8 — New UI pass

Once everything is wired, replace the placeholder tab layouts with one coherent design that
suits the app's existing visual language — dark, violet-accented, dense. Same components across
all tabs, one spacing/type scale, one empty/error/loading treatment.

## Checkpoint discipline

After each stage: `npm run typecheck`, `npm test`, `npm run build`, then commit and push
`feature/nexus-tabs`. Main stays releasable throughout.