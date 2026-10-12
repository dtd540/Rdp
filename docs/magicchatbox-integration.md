# MagicChatbox direct integration assessment

> **Superseded direction:** The user subsequently chose an independent core overhaul of our own chatbox instead of licensed upstream integration. Original priority-based fitting, omission reports, history reuse, and editor improvements are now implemented in our TypeScript/React app. The upstream assessment below is historical research only; upstream code and monitoring remain outside the build.

## Current delivery

The audio save/restore changes were rebuilt, packaged, installed, and the installed Electron app was reopened. The installed app archive and audio sidecar were SHA-256 compared with the rebuilt package and matched. The native renderer exposed `window.bridge` and displayed the save control. VoiceMeeter was offline, so real audio snapshot/restore was not verified.

**MagicChatbox integration is not implemented.** No upstream code has been added to the app's build, no upstream executable has been launched, and no VRChat account IDs have been sent by this work.

## User-approved direction

- Direct licensed integration rather than an independent implementation.
- Smart message fitting as the first feature.
- User explicitly accepted the protected-module and moderation-monitoring requirements after being informed of account-ID transmission.

## Inspected upstream

- Repository: https://github.com/BoiHanny/vrcosc-magicchatbox
- Release tag: `v0.9.226`
- Inspected revision: `bf886d2e3bdf99af25f716f509cf18a2668190e6` (master and release tag matched at inspection).
- Supplied ZIP: `MagicChatbox-0.9.226.zip`, a compiled Windows release, not a source archive.
- Source checkout for inspection: `.freebuff-upstream-magicchatbox/` (not wired into the build or committed).
- License: https://github.com/BoiHanny/vrcosc-magicchatbox/blob/master/License.md
- Terms: https://github.com/BoiHanny/vrcosc-magicchatbox/blob/master/Security.md

## License conditions to retain

The custom source-available license is not MIT or an OSI-approved open-source license. It requires protected monitoring/ban and Pulsoid modules to remain intact and operational in derivatives, unaltered license/TOS documents, a prominent repository origin link, Pulsoid terms/documentation references, and this attribution:

> This product includes software developed by BoiHanny / MagicChatbox, designed to integrate exclusively with the Pulsoid heart rate streaming service.

This assessment is not a legal opinion. Do not assume that copying only the fitting algorithm or adding a companion launcher satisfies these conditions.

## Confirmed behavior and dependencies

`MagicChatboxAPI/Services/AllowedForUsingService.cs` enumerates immediate `usr_*` directories in the user's VRChat OSC folder. It posts extracted account IDs to `https://api.magicchatbox.com/moderation/checkIfClientIsAllowed` and acknowledges bans at the corresponding `acknowledgeBan` endpoint.

`App.xaml.cs` connects ban events to `IBanEnforcementService.ProcessBan`. `Services/BanEnforcementService.cs` shows the ban notification and exits the upstream process with code 1. Keeping the binary on disk, or merely checking that an unrelated companion process exists, does not establish that this enforcement protects an integrated fitting/send path.

`Core/Osc/OscOutputBuilder.cs` is the real fitting engine. It depends on upstream providers, application state, settings providers, display order, and fault tracking. It drops the largest numeric-priority provider until the message fits, clips the last surviving segment if necessary, and returns included/trimmed provider information. Its budget is **144 UTF-16 code units** (`string.Length`), with surrogate-pair protection at clipping boundaries. It is not a word-boundary-fitting algorithm.

Our current TypeScript validation counts Unicode code points, and also enforces nine lines. A direct integration must retain our control-character/line checks and reconcile the stricter upstream UTF-16 budget rather than weakening validation.

## Runtime/build findings

- Upstream application: WPF, `net10.0-windows10.0.26100.0`.
- Upstream API project: `net9.0`.
- Our audio sidecar: `net8.0-windows`.
- Installed SDK found: .NET 8.0.425 only.
- Installed .NET 10 core and Windows Desktop runtimes: 10.0.10.

The supplied app can potentially run with the available desktop runtime, but modifying/rebuilding its source requires a .NET 10 SDK and verification of its restore/build prerequisites. Runtime presence alone is not build support.

## Remaining implementation work

1. Establish a compliant upstream host/fork that retains its complete protected modules and genuine startup/terms/enforcement lifecycle. Do not simulate readiness or bypass first-run consent.
2. Add a narrow local request/response adapter to the actual upstream provider-based fitting engine, with bounded payloads, authentication/access restrictions appropriate to the transport, cancellation and timeout behavior.
3. Bind fitting and fitted sends to genuine upstream readiness and ban/exit enforcement. No fallback may silently substitute a copied standalone algorithm while bypassing the protected lifecycle.
4. Map our text/integration segments to priorities and return omitted-provider information. Preserve ordering, framing, Unicode correctness and the nine-line limit.
5. Add explicit UI enablement, first-run/setup feedback, fitting previews and required legal attribution/documents. Prevent competing OSC broadcasts between apps.
6. Add tests for exact boundaries, non-BMP emoji, framing costs, deterministic priority ties, omitted-line reporting, companion failure/exit and invalid payloads.
7. Test complete first-run startup and protected lifecycle, then smart fitting through the installed UI and local UDP receiver; build and install the final package only after those checks.

## Status

The audio update is applied. Direct MagicChatbox smart-fitting integration remains pending the host/lifecycle implementation and verification above. No integration build or runtime tests have passed because that implementation does not yet exist.
