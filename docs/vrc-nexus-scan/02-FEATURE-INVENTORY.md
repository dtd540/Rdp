# 02 — Feature inventory

Source of truth: `resources/app/dist-electron/electron/preload.cjs`. It exposes every capability
the UI can reach as a named function, so the IPC channel names below are exhaustive — if a
capability is not in this file, the UI cannot call it.

## The 20 sidebar tabs

Read from the live `dist/index.html`. Stock VRC Nexus has 16; the mods added 4, inserted directly
after Dashboard.

| # | Tab id | Label | Origin |
|---|---|---|---|
| 1 | `dashboard` | Dashboard | stock |
| 2 | `browser` | Browser | **mod** |
| 3 | `discord` | Discord | **mod** |
| 4 | `webmovies` | Movies | **mod** |
| 5 | `games` | Games | **mod** |
| 6 | `library` | Library | stock |
| 7 | `favourites` | Favourites | stock |
| 8 | `discover` | Discover | stock |
| 9 | `worlds` | Worlds | stock |
| 10 | `media` | Inventory | stock |
| 11 | `playerlist` | Player List | stock |
| 12 | `social` | Social | stock |
| 13 | `tools` | Tools | stock |
| 14 | `membership` | Membership | stock |
| 15 | `moderation` | Moderation | stock |
| 16 | `magicchatbox` | Magic Chatbox | stock |
| 17 | `translator` | Translator | stock |
| 18 | `scripts` | Scripts | stock |
| 19 | `community` | Community | stock |
| 20 | `settings` | Settings | stock |

## Right sidebar (not a tab — always present)

- **Account panel** — avatar, display name, status, access level (`Access: user`)
- Login by username/password, **2FA code**, and *"Sign in on VRChat.com"* (Steam/Oculus/SSO/2FA)
- **Account switcher** — multiple stored accounts, switch or remove, merge from username
- **Redeem a supporter key**
- **Instance card** — current instance, hidden when not in one
- **Friends list** — with search-as-you-type and a refresh button

## Capability map by tab

### Dashboard
`gui:get` / `gui:save` (persist panel layout) · `app:info` · `vrchat:status` · `weather:get/set`
· `discordRpc:get/set` · `analytics:friends` + `analytics:clearFriends` · `notifications:list`,
`notifications:accept`, `notifications:hide` · `perf:get/set` · `probe:systemStats`

### Browser (mod)
Embedded multi-tab browser — see [04-BROWSER-TAB.md](04-BROWSER-TAB.md). Loads
`assets/vencord/*` (Vencord) into the webviews so Discord works inside it.

### Discord (mod)
A dedicated Discord tab. VRChat Music Bridge already has a Discord webview tab; the 1.2.31
version is the same idea with Nexus's own chrome. **Verification for this is being added later**,
per the rebuild plan.

### Movies (mod)
`movies:playstate` · `pip:open` — see [06-MOVIES-TAB.md](06-MOVIES-TAB.md)

### Games (mod)
`games:scan` (Steam library) · `games:library` · `games:launch` · `games:openfolder`
· `probe:startSystemStats` / `probe:stopSystemStats` / `probe:systemStats`
See [05-GAMES-TAB.md](05-GAMES-TAB.md)

### Library
`avatars:recent` · `avatar:current` · `avatar:select` · `avatar:addLocal` / `avatar:removeLocal`
`library:refreshMetadata` · `library:cleanupFavourites` · `library:checkDeletedAvatars`
`library:removeDeletedAvatars` · `library:watchlist` · `library:duplicates` (duplicate avatar IDs)
`library:exportIds` · `library:matchingPairs`
Also avatar authoring: `avatar:uploadBundle` (+ `avatar:uploadProgress` events),
`avatar:getById`, `file:getById`, `unity:status`, `unity:build`, `unity:extractzip`, `sdk:download`

### Favourites
`favourites:toggle` · `favourites:createSection` / `renameSection` / `deleteSection` / `moveIds`
`vrcFav:add/ids/remove/addToGroup/addManyToGroup/removeRecords/overview/swap`
Imports: `websiteFavourites:import` (VRChat web favourites) and `vrcxFavourites:import` (VRCX)

### Discover
`discover:providers` / `discover:search` — pluggable search providers
`searchUsers` · `users:basic` · `lookupWornAvatar` · `searchWorlds`

### Worlds
`worlds:search` / `worlds:names` / `worlds:currentInstance` / `worlds:createInstance`
`portals:scan` / `join` / `delete` / `clear` · `players:instances`

### Inventory (media)
`media:screenshots` · `revealMedia` · `inventory:files` / `prints` / `items` / `upload` /
`deleteFile` / `deletePrint` / `download` · `ownAvatars:list` · `ownAvatars:exportCsv`

### Player List
`players:roster` / `instances` / `liveRoster` / `data` / `snapshot` / `setNote`
`scanPublicCachePlayers` · `players:scanPublicCache` — builds a roster by scanning VRChat's
public cache rather than asking the API

### Social
`friends:list` / `profile` / `sendRequest` / `massInviteRequest` / `discords` (finds friends'
Discord handles)
`groups:list` / `details` / `join` / `leave` / `listMine` / `members` / `invite`
`groups:posts` / `createPost` / `autoAcceptRequests`
`inviteMessages:list` / `update`
`socials:get` / `set` / `test` / `startReposition` (in-VR status overlays) + `social:event` push

### Tools
`autodraw:pick` / `pickFont` / `analyze` / `analyzeRGBA` / `filebytes` / `start` / `stop` (+ `autodraw:done`)
— picks a region of the screen, analyses its colours, and drives it from an image/GIF
`logs:extractRecent` · `logs:exportWorldsCsv` · `logs:exportVideosCsv` — reads VRChat's
`output_log` for visited worlds and captured video
`diagnostics:export` · `manager:exportJson` / `backup` / `migrateLocalData` / `importIds`
`vrchat:status` · `vrchat:launchNewWindow`

### Membership
`access:register` / `state` / `redeemKey` / `listKeys` / `revokeKey`
`access:devices` / `updateLevel` / `blacklist` / `unblacklist` / `delete` / `setMinimumVersion` /
`setAnnouncement` — device-bound supporter access with a signed-in device allowlist.

### Moderation
`mod:membersDetailed` / `bans` / `kick` / `instanceKick` / `groupInstances` / `closeInstance`
`mod:auditLogs` / `roles` / `assignRole` / `removeRole` / `presenceLog` / `ban` / `unban`

### Magic Chatbox
`osc:chatbox` (write into VRChat's chatbox via OSC) · `osc:typing` · `osc:voicePulse`
`osc:fast` (fire-and-forget) · `osc:listAvatarParameters` · `osc:setAvatarParameter`
`osc:startMonitor` / `stopMonitor` (+ `osc-monitor` push)
`magic:snapshot` / `importMagicStatuses` — saved status snippets

### Translator
`translator:translate` / `get` / `set` (+ `translator:ptt` push-to-talk, `translator:openLangPicker`)
`i18n:get` / `set` / `translate` / `cache` — the whole UI is localisable

### Scripts
`scripts:list` / `read` / `save` / `delete` — a Python script runner
`scriptGui:show` / `hide` / `toggle` / `clear` / `close` / `bindHotkey` / `set` / `event` / `request`
(+ `scriptgui:event` and `scriptgui:render` pushes) — scripts get a floating GUI panel with hotkeys

### Community
`community:catalog` / `publish` / `edit` / `like` / `delete` / `applyMedia`
`sharePack:export` / `import` / `importUrl` / `buildForPublish` / `applyCommunityPayload`

### Settings
`appConfig:read` / `save` · `vrchatConfig:read` / `save`
`tray:get` / `set` · `background:get` / `set` / `clear` / `pick` (custom background — same idea as
the one just built into VRChat Music Bridge)
`updates:check` / `install` (+ `updates:progress`) · `adblock:toggle` / `state`
`protections:get` / `set` (+ `protections:event`) · `perf:get` / `set`
`system:openExternal` · `system:openDataFolder`
Discord/Vencord: `vencord:get`

### Cross-cutting: overlays
Several features are **separate always-on-top windows**, optionally drawn into VR through the
OpenVR overlay module:

| Overlay | IPC | Purpose |
|---|---|---|
| Lyric Island | `lyricIsland:get/set/feed/startReposition` (+ `lyric-island-data`, `lyric-island-tick`) | Current song + lyrics beside the avatar |
| Player Overlay | `playerOverlay:get/set/feed/startReposition/setInteractive` (+ `player-overlay-data`, `player-overlay-scroll`) | Who is in the instance |
| FPS Overlay | `fpsOverlay:get/set/toggle` (+ `fpsOverlay:vrchatState`) | Performance counter |
| Socials | `socials:startReposition` (+ `social:event`, `social-notify`) | Friend online/party notifications |
| AI overlay | `ai:overlay:show/hide/toggle/state/setOpacity/setPinned` (+ `ai:overlay:focused`) | Chat assistant HUD |

All overlays share `overlayApi.finishReposition({save})` so a dragged position can be persisted.

### AI bridge (mod)
`ai:chat` · `ai:models` · `ai:config:get` / `save` — a separate `nexusAi` context bridge, with its
own overlay window (`ai-overlay.html`).

## Accounts and auth

`auth:restore` · `auth:login` · `auth:verify2fa` · `auth:webLogin` · `auth:logout`
`accounts:list` / `switch` / `remove` / `merge` / `mergeFromUsername`
Stored in `vrchat_accounts.json`, session cookies in `electron_session.json` (encrypted with
Electron `safeStorage`).

## Data files it owns

`config.json` · `gui_state.json` · `favourites.json` · `avatars.json` · `session.json`
`vrchat_accounts.json` · `electron_config.json` · `electron_session.json` · `perf.json`
`player_history.json` · `friend_online_history.json` · `github_token.txt` · `crash.log` ·
`update.log`