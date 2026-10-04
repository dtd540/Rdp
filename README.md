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

- **VoiceMeeter** (free donationware mixer from VB-Audio) provides the virtual microphone
  Windows and VRChat see, and mixes your voice with the music. On first run the app offers to
  fetch the official installer (one consent click — never bundled/redistributed), then applies
  the complete routing configuration over VoiceMeeter's Remote API.
- **Spotify**: the app routes the real Spotify desktop process to the VoiceMeeter music strip
  using Windows' per-app routing API (`AudioPolicyConfig.SetPersistedDefaultAudioEndpoint`,
  the same mechanism behind *App volume and device preferences* / EarTrumpet). If the API ever
  declines, the wizard deep-links to the Settings page and verifies the result by enumerating
  audio sessions.
- **YouTube Music** plays in an embedded window inside the app whose audio output is pointed
  straight at the VoiceMeeter music strip — so only this app's audio reaches VRChat.
- **Verification at every link**: live meters on the mic, the music strip, and the final
  VoiceMeeter Output; session detection proves Spotify is on the right endpoint and that
  VRChat is capturing VoiceMeeter Output. The wizard only unlocks when it's actually true.
- **Tray controls**: music volume, *send music to VRChat mic* mute toggle, and voice ducking
  (music drops 12 dB while you talk).

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

## Packaging

```bash
npm run dist                # Electron build + self-contained sidecar + x64 NSIS installer (release/)
```

Installer artifact: `release/VRChat-Music-Bridge-Setup-0.1.0.exe` (unsigned; VoiceMeeter's virtual driver still installs separately).

## Architecture

| Piece | Tech | Role |
| --- | --- | --- |
| `app/main` | Electron main | sidecar lifecycle, tray, IPC, VoiceMeeter installer download |
| `app/preload` | contextBridge | typed `window.bridge` RPC surface |
| `app/renderer` | React + Vite | setup wizard, service picker, live meters, tray tooltips |
| `sidecar/` | C# / .NET 8 | MMDevice endpoints + sessions + WASAPI meters, VoiceMeeter Remote API, per-app router, ducking monitor — JSON-RPC over stdio |
| `shared/rpc.ts` | TypeScript | protocol types shared by all three layers |

### Notable implementation details

- `SetPersistedDefaultAudioEndpoint` requires the **full device-interface path**
  (`\\?\SWD#MMDEVAPI#{0.0.0.00000000}.{guid}#{e6327cad-dcec-4949-ae8a-991e976a79d2}`),
  not the plain MMDevice endpoint id — the plain form fails with `E_INVALIDARG`.
- The `AudioPolicyConfig` interface IID is discovered via `IInspectable.GetIids`
  (last reported IID), matching SoundSwitch's proven selection logic.
- Mic auto-selection skips virtual capture devices (VAC / VoiceMeeter / VB-Cable) so your
  voice — not the music — is what lands on VoiceMeeter's hardware strip.
- The per-app routing API is undocumented; every failure path degrades to the guided manual
  Settings deep-link, verified afterwards via session enumeration.

## Known limitations

- VRChat's *Input Device* dropdown can't be set programmatically — the wizard watches
  VRChat's capture session and shows ✓ once you've picked `VoiceMeeter Output`.
- VoiceMeeter's installer is downloaded from vb-audio.com on first run (never bundled); users still need to install its virtual audio driver and approve its installer prompt.
- The NSIS app installer does not include Spotify, YouTube Music service accounts, or the VoiceMeeter driver. It is self-contained for the app and sidecar runtime, but VoiceMeeter setup remains required.
