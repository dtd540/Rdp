# 06 — Movies tab (and the Discord tab next door)

Source: `resources/app/dist/assets/nxbrowse.js`, sections *"Movies panel (embedded nepu.io)"*
(~line 1363) and *"OSC Rich Presence: what you're watching in Movies"* (~line 1587).

## What it is

An embedded webview of **nepu.io** — `https://nepu.io/movies` — with two additions that make it
more than a bookmark: a **picture-in-picture** mode and **OSC rich presence**.

## Core mechanics

| Piece | Detail |
|---|---|
| URL | `https://nepu.io/movies` |
| Status line | `wmStatus(t)` writes load/error state into `#nwmStatus` |
| Height fit | `fitWebMovies()` sizes the webview to the pane |
| Tuck/expand | `.nxdc-tucked` class collapses the panel; `wmReveal()` brings it back |
| DOM ids | `nxdcStage`, `nxdcWv`, `nxdcStatus`, `nxdcWelcome`, `nxdcStart`, `nxdc-full` |

## Picture-in-picture

`vrcManager.pipOpen(options)` — pops the movie out into a small always-on-top window so it can
keep playing while you use the app. Backed by `pip:open`.

## OSC rich presence

This is the part worth rebuilding first, because it is the only place the old app reaches into
VRChat from a non-OSC feature.

- `vrcManager.moviesPlayState()` — poll what is currently playing (title, progress)
- `fmtTime(s)` — `h:mm:ss` formatter for the remaining/total time
- `sendChat(text)` — wraps `vrcManager.sendOscChatbox(text)`
- `poll()` — periodically reads play state and pushes a line into VRChat's chatbox, e.g.
  `🎬 Now watching: <title> (12:04 / 1:48:22)`
- `setEnabled(on)` — a toggle so it can be muted
- `rpStart()` — starts the polling loop

Backed by `movies:playstate` and `osc:chatbox`.

**Why this matters for the rebuild:** VRChat Music Bridge already owns the music side of the
world. Being the thing that tells your VRChat friends what you are listening to or watching is a
natural fit, and OSC-to-chatbox is a small, self-contained feature.

## The Discord tab (adjacent, same file)

`// ===== Discord panel (embedded client) =====` (~line 1221)

- URL: `https://discord.com/app`
- `createDiscordWebview()` — builds the webview with Vencord injected
- `openDiscord()` — starts from a welcome screen, then swaps in the webview
- `dcStatus(t)` / `dcHideWelcome()` — same status/welcome pattern as Movies
- `fitDiscord()` + a poll that keeps the height correct while the panel is active
- Tuck/expand with the same `.nxdc-tucked` class

**VRChat Music Bridge already has a Discord tab** (a `partition: 'persist:discord'` webview with
navigation lockdown to `discord.com` only). That implementation is more locked-down than this one
and should be kept as-is.

## Shared pattern to lift

Both panels follow an identical skeleton, which is why they share DOM ids:

```
welcome screen → [start] → webview stage, with status line, tuck/expand, and height-fit poll
```

Any new embedded-site tab in the rebuild should reuse that skeleton rather than reinvent it.