# Nexus 1.2.31 TEST: original rewrite parity

## Contract

The target is the same user-visible features and behaviour as the supplied Nexus 1.2.31 TEST, implemented as original readable TypeScript/React in VRChat Music Bridge. Reading the reference establishes interfaces and behaviour; bundled implementation code is not transplanted or mechanically renamed. This document is a progress checklist, not a claim of complete parity.

Reference inspection: supplied index.html, readable nxbrowse.js, decoded main-process inspection, and bounded renderer-bundle excerpts. The reference installation is unchanged.

## Magic Chatbox first

Observed reference behaviour:
- OSC `/chatbox/input` with UTF-8 padded strings, send/draft boolean and notification boolean.
- `/chatbox/typing` boolean, configurable host/port, reusable socket, minimum send spacing (reference: 1,400 ms), and latest-message coalescing.
- Status library with favourites, cycle membership, sorting, editing/deletion and import from MagicChatbox `StatusList.xml` or JSON.
- Named cycles and scheduled status/cycle changes while the app runs.
- Integration composition: personal status, foreground-window activity, current app tab, clock options, Windows media session/progress, lyrics, world details and PC information.
- AFK-triggered override via `/avatar/parameters/AFK`, plus presets and integration ordering.

Original rewrite delivered in this pass:
- Dedicated Magic Chatbox tab with validated live preview and template editor.
- Integration catalogue covering all 13 observed Nexus concepts: personal status, foreground window, active app tab, time, media session, synchronized lyrics, component/network stats, system stats, current world, instance players, app uptime, PC battery, and date.
- Local-only integration settings with per-source enable/disable, order controls, emoji/line formatting, and minimal/VRChat/music/PC-stats presets. User settings persist locally.
- Bounded local source sampling for Windows media metadata (GSMTC), foreground window title, battery, network interface rates, app uptime, CPU/memory and current VRChat world transition. Foreground title is opt-in due privacy; unready/unsupported sources contribute no invented line.
- Integration output is composed before strict OSC validation; excessive expanded length is rejected rather than truncated.
- Manual send, send-versus-draft, notification control, clear and timed typing indicator.
- Configurable **local** destination port. Remote hosts are deliberately not enabled.
- UTF-8 OSC packet encoder, 1,500 ms send spacing, testable transport and real loopback UDP regression test.
- Explicitly started timed broadcasts; selected-template cycling; stored favourite/cycle flags.
- User-selected XML/JSON status import, local JSON export, size limits and duplicate detection.
- Time/date, CPU/RAM, manual activity/status placeholders. PC probes are cached and bounded.

Not yet equivalent:
- No automatic status-file discovery, named cycle editor, schedule library, or AFK receiver.
- Synchronized lyrics and live instance player counts remain visible, explicitly unavailable integrations: lyrics would need a separately configured provider; occupancy is not available from safe local logs. No third-party integration is silently enabled.
- Windows media, active-window and battery probes are best-effort on supported Windows builds; no GPU/per-process sensor telemetry is provided.
- No latest-message queue: overly frequent sends report an error rather than silently coalesce.
- Strict message validation instead of silent truncation; no hidden `egg` control-character suffix.
- Broadcast consent is not restored, and broadcast stops on tab change/error or after one hour.
- No claim of in-game receipt: UDP send completion is not delivery acknowledgement.

## App parity matrix

| Reference area | Rewrite status | Remaining work |
| --- | --- | --- |
| Games / Steam library | Installed manifests, local account/public library merge, Play/Folder, search/sort/filters; added favourites, notes, compact cards | Full private entitlements require additional authenticated design; artwork fallbacks and non-game filtering need further parity work |
| System status | CPU, memory, uptime, drives and recognised running apps | GPU/utilisation, Wi-Fi and exact gauge design |
| Browser | Existing embedded multi-tab browser, restore/reorder/find/zoom; repaired general http(s) navigation | Bookmarks/history, pin/mute/context actions, shortcuts and reference start page |
| Discord | Existing sandboxed embedded client; readable browser-preview fallback | Reference persistence and full interaction parity verification |
| Magic Chatbox | See checklist above | Schedule/AFK parity; lyrics and live instance occupancy need explicit data-source design |
| Worlds | Local bookmarks, official launch links, opt-in bounded recent-world log reader | API-backed world browsing/search and account favourites |
| Dashboard / audio | Existing music/VoiceMeeter bridge plus new gamer hub/session timer | Reference dashboard/account status and VRChat session data |
| Settings | Background picker plus local accent, compact cards and reduced motion | Full reference settings sections and themes/presets |
| Movies | Not implemented | Provider/navigation/PiP parity with legal authorised media sources |
| Avatar library/favourites/discover/inventory | Not implemented | API auth, schemas, provenance and user-authorised downloads/uploads |
| Player list/social/moderation/groups/calendar | Not implemented | Authenticated API integration and permissions; no simulated account data |
| Translator/scripts/community/membership | Not implemented | Explicit requirements and integrations; do not copy owner/access overrides |

## Verification

Automated coverage includes world URL validation, import normalisation, chatbox limits, packet bytes, send/draft flags, typing/clear, rate limiting, log extraction and an isolated real UDP receiver (not VRChat). All source typecheck/tests/build are rerun after final repairs.

Freebuff uses an isolated preview bridge with saved **real** desktop scan results. Navigation, preferences, template rendering and search/filter controls run the actual React components. Native game/Explorer/OSC actions are unavailable there and report that limitation. Desktop-side PC and log scans are separately verified.

## Next parity milestone

Finish Magic Chatbox integration composition and schedule/AFK behaviour before expanding account-backed tabs. Validate each module against a reference screen and interaction checklist; preserve ordinary functionality, never security bypasses or access overrides.
