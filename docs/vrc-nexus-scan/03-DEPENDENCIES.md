# 03 — Dependencies

Every external service VRC Nexus 1.2.31 talks to, recovered from `_decoded_table.json`.

**The rule for the rebuild:** nothing may keep calling `api.vrc-nexus.online` or reading the old
app's files. Everything else on this page is a third-party service and may be called directly
from VRChat Music Bridge — but each one needs its own handling, failure mode and fallback.

## Must be replaced — their own backend

| Endpoint | Used for | Replacement |
|---|---|---|
| `https://api.vrc-nexus.online` | Share packs, community catalogue, supporter keys, possibly auth | Build against VRChat's API directly, or ship the feature against local storage |

This is the one hard "do not reuse" item.

## Core — VRChat

| Endpoint | Used for |
|---|---|
| `https://api.vrchat.cloud` | The VRChat API: auth, users, worlds, avatars, groups, moderation |

`api.vrchat.cloud` is a community-operated front for VRChat's API. It needs no token for public
data; authenticated calls ride a session cookie obtained from login/2FA/web-login. Auth lives in
`electron_session.json`, encrypted with Electron `safeStorage`.

Also reads VRChat's local install directly:
- `%LOCALAPPDATA%Low\VRChat\VRChat\output_log` — visited worlds, captured video, instance events
- VRChat's `config.json` (`vrchatConfig:read` / `save`)

## Avatar search — several interchangeable providers

1.2.31 tries more than one and falls back:

| Endpoint | Notes |
|---|---|
| `https://api.avtrdb.com/v2/avatar/search` | AvtrDB |
| `https://vrcx.avtr.zip/` | VRCX-compatible |
| `https://vrcx.vrcdb.com/avatars/Avatar/VRCX` | vrcdb |
| `https://avtr.zuxi.dev/search` | Community |
| `https://avatarwbvrcxsearch.worldbalancer.com/vrcx_search` | Community |
| `https://vrcavatarsearch.nekosunevr.co.uk/vrcx_search` | Community |

All speak the VRCX search response shape, so one adapter covers them.

## Lyrics

| Endpoint | Used for |
|---|---|
| `https://music.163.com/api/search/get?s=` | Song search (NetEase Cloud Music) |
| `https://music.163.com/api/song/lyric/v1?id=` | Lyrics |
| `https://lrclib.net/api/search?artist_name=` | LRC lyric search |
| `https://lrclib.net/api/get?artist_name=` | Single lyric fetch |

NetEase is the primary source; LRC-lib is the fallback.

## Translation

| Endpoint | Used for |
|---|---|
| `https://translate.googleapis.com/translate_a/single?client=gtx&sl=…` | Google's unofficial translate endpoint, unauthenticated |

Used by both the Translator tab and the whole-UI `i18n` layer.

## Weather and location

| Endpoint | Used for |
|---|---|
| `https://api.open-meteo.com/v1/forecast?latitude=…` | Forecast |
| `https://geocoding-api.open-meteo.com/v1/search?name=…` | Place search |
| `https://ipapi.co/json/` | Coarse location by IP |

No API keys — all free tiers.

## Updates and shared content

| Endpoint | Used for |
|---|---|
| `https://api.github.com/repos/` | Update checks |
| `https://raw.githubusercontent.com/` | Release manifests, share packs |
| `/contents/update-manifest.json?ref=main` | The update manifest itself |

## Browser tab

| Endpoint | Used for |
|---|---|
| `https://www.google.com/`, `https://www.google.com/search?q=` | Home page and search |

Vencord (`assets/vencord/*`) is injected into the embedded webviews.

## Locally sourced (no network)

- **Steam** — library scan, launching, opening install folders (`games:*`)
- **OpenVR** — `openvr_api.dll` / `openvr_overlay.node` for in-VR overlays
- **VRChat's log and config** — worlds, video, config editing
- **Screen capture** — AutoDraw's region picker
- **Windows audio** — not used here; that is VRChat Music Bridge's own domain

## What this means for the port

The rebuild needs its own thin adapters for: VRChat API, VRCX-style avatar search, lyrics,
translate, weather, GitHub updates, and Steam. Each should degrade to "feature unavailable"
rather than throwing — the old app's own pattern of trying several providers is worth keeping.