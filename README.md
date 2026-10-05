# VRChat Music Bridge

One Windows app that plays **Spotify or YouTube Music through your microphone in VRChat** — music *and* your voice, mixed, with a wizard that verifies every link.

```
Spotify desktop app ──┐
                      ├──▶ VoiceMeeter Aux Input ── music strip ──A1──▶ your ears
YouTube Music (built-in player) ┘                                   └──B1──┐
                                                                          ▼
your microphone ──▶ VoiceMeeter hardware strip ──────────B1───────────────┤
                                                                          ▼
                                             VoiceMeeter Output = VRChat's mic input

VRChat + game audio stay on your normal speakers → no feedback loop.
```

## How it works

- **VoiceMeeter** (free donationware mixer from VB-Audio) provides the virtual microphone Windows and VRChat see, and mixes your voice with the music. On first run the app offers to fetch the official installer (one consent click — never bundled/redistributed), then applies the complete routing configuration over VoiceMeeter's Remote API.
- **Spotify**: the app routes the real Spotify desktop process to the VoiceMeeter music strip using Windows' per-app routing API (`AudioPolicyConfig.SetPersistedDefaultAudioEndpoint`). If it cannot route, use Windows Settings → System → Sound → Volume mixer and set Spotify's Output device to the VoiceMeeter music input; the app verifies the actual Spotify session endpoint.
- **YouTube Music** plays in an embedded window inside the app whose audio output is pointed straight at the VoiceMeeter music strip — so only this app's audio reaches VRChat.
- **Verification**: live meters on the mic, music input and VoiceMeeter Output; session checks confirm Spotify is on the selected input and VRChat is capturing VoiceMeeter Output.
- **Tray controls**: music volume, *send music to VRChat mic* mute toggle, and voice ducking (music drops 12 dB while you talk).
- **Updates**: the installed Windows app periodically checks the public `dtd540/Rdp-releases` GitHub Releases feed, downloads compatible NSIS updates, and offers a **Restart to update** button. It never embeds a GitHub token. Source stays in the private `dtd540/Rdp` repository.

## Requirements

- Windows 10 (2004+) or Windows 11, x64
- .NET 8 SDK for development/building only. The packaged app self-contains the .NET sidecar runtime.
- Spotify desktop app and/or a YouTube Music account
- VRChat (any build that lets you pick an input device)

## Development

```bash
npm install                 # Electron + toolchain
npm run sidecar:build       # self-contained C#/.NET sidecar → sidecar/publish
npm run dev                 # electron-vite dev (app + HMR)
npm test                    # vitest unit tests
npm run typecheck           # tsconfig.node + tsconfig.web
```

Renderer-only preview in a plain browser (no Electron/audio backend, uses a mock bridge):

```bash
npx vite --config vite.preview.config.ts   # → http://127.0.0.1:5199
```

Sidecar integration tests (real audio stack, JSON-RPC over stdio):

```bash
node route_tone_test.mjs    # routing while a process actively renders audio
node route_matrix_test.mjs  # routing matrix across active/idle/foreign pids
```

## Publishing updates

1. Keep source in the private `dtd540/Rdp` repository. The separate public, empty repository `dtd540/Rdp-releases` hosts only release installers and updater metadata.
2. In the private source repository, add an Actions secret named `RELEASES_GH_TOKEN`. Use a fine-grained PAT scoped only to `Rdp-releases`, with **Contents: Read and write** permission. The secret is used only by GitHub Actions; do not put it in app code or the installer.
3. Bump `version` in `package.json` and commit the matching `package-lock.json` package version (e.g. `0.1.1`). Push the commit to the private repo.
4. Create and push a matching tag, e.g. `git tag v0.1.1 && git push origin v0.1.1`. The workflow runs typecheck/tests, builds the Windows NSIS installer and update metadata, then publishes a release in the public release repo.
5. The updater-enabled app checks the public feed on startup and every six hours, downloads a newer installer, and offers **Restart to update**. The current NSIS installer is unsigned; electron-updater 6.8.9 skips Authenticode verification when no publisher name is configured and still checks the published file's SHA-512 against the update manifest. This is transport-integrity checking, not publisher authentication. For stronger protection, sign releases with Authenticode and configure the expected publisher before distributing the updater-enabled installer.

**Bootstrap requirement:** the already published `0.1.0` installer predates in-app updating. Users on `0.1.0` must install one newer updater-enabled installer manually; after that, later published releases can be installed from inside the app. Do not claim `0.1.0` users can update in-app.

The update publisher configuration is pinned to `dtd540/Rdp-releases` in `package.json`; do not rename or transfer that repository after distributing updater-enabled builds. Never use a private-repo token embedded in the installer.

## Packaging

```bash
npm run dist                # local installer only; release/ output
npm run release             # build and publish via electron-builder (requires GH_TOKEN)
```

Installer artifact: `release/VRChat-Music-Bridge-Setup-<version>.exe`.

## Architecture

| Piece | Tech | Role |
| --- | --- | --- |
| `app/main` | Electron main | sidecar lifecycle, tray, IPC, updater, VoiceMeeter installer download |
| `app/preload` | contextBridge | typed `window.bridge` RPC surface |
| `app/renderer` | React + Vite | setup wizard, service picker, live meters, update status and controls |
| `sidecar/` | C# / .NET 8 | MMDevice endpoints + sessions + WASAPI meters, VoiceMeeter Remote API, per-app router, ducking monitor — JSON-RPC over stdio |
| `shared/` | TypeScript | RPC and update types shared by app layers |

### Notable implementation details

- `SetPersistedDefaultAudioEndpoint` requires the full Windows device-interface path, not the plain MMDevice endpoint id.
- The `AudioPolicyConfig` interface is undocumented; failure falls back to guided Windows Settings routing and session verification.
- Mic auto-selection skips virtual capture devices (VAC / VoiceMeeter / VB-Cable).

## Known limitations

- VRChat's *Input Device* dropdown can't be set programmatically — select `VoiceMeeter Output` in VRChat and confirm audibility with another player.
- VoiceMeeter's installer is downloaded from vb-audio.com on first run; users still need to install its virtual driver and approve its installer prompt.
- The app installer does not include Spotify, service accounts, or the VoiceMeeter driver. The Windows installer is currently unsigned.
