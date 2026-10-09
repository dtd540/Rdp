# Publishing VRChat Music Bridge — guide for AI agents

**Read this before making any release.** Every failure mode in [Troubleshooting](#troubleshooting) below
actually happened in this project and cost real time. The happy path is short; the traps are not.

You are publishing a **Windows desktop app** (Electron + a C#/.NET sidecar) that **auto-updates itself
from GitHub Releases**. That updater is the reason half of this document exists.

---

## 1. The two-repository split (do not "simplify" this)

| Repository | Visibility | Holds | Why separate |
| --- | --- | --- | --- |
| `dtd540/Rdp` | **Private** | All source code | Source must not be public. |
| `dtd540/Rdp-releases` | **Public** | Only installers + update metadata | The installed app reads this feed with **no credentials**. |

The app fetches update info from the public releases repo anonymously. If the feed were private,
every user's updater would break. If source lived in the public repo, you'd be publishing your source code.

> **Never** rename, transfer, or make `Rdp-releases` private. Already-shipped builds have the feed URL
> compiled into them; changing it silently breaks updates for every existing install.
> The feed target is pinned in `package.json` → `build.publish`.

**Releases repo must never be empty.** GitHub rejects release creation on a zero-commit repo with
`422 "Repository is empty."` If you ever recreate it, push a README commit to `main` **first**, then
confirm the commit landed *before* triggering a publish run.

---

## 2. One-time setup (already done — verify, don't redo)

A GitHub Actions secret named **`RELEASES_GH_TOKEN`** is used for release uploads.

Required properties — verify by name, never by value:

- **Repository access:** "Only select repositories" → `dtd540/Rdp-releases` **only**
- **Permissions:** `Contents: Read and write` (+ implicit `Metadata: Read-only`)
- Never use a token with broader access than required; never paste or print the secret
- Check expiry and permissions in GitHub settings before release week

### Why scope matters (each was a real failure)

| Token setup | Result |
| --- | --- |
| Missing/invalid Actions secret | Release upload fails with an authentication error; verify `RELEASES_GH_TOKEN` in source-repo Actions secrets |
| `Administration: read/write` but **not** `Contents: read/write` | `403` — `Resource not accessible by personal access token` |
| Correct token, but releases repo had zero commits | `422` — `Repository is empty.` |
| Correct token, run started **before** the README commit existed | `422` again — the run was doomed before the fix landed |

The last one is subtle: a re-run can fail with an error describing a repo state that has since been
fixed. **Always compare the API error timestamp against when you applied the fix.**

### Security rules — non-negotiable

- The token lives **only** in GitHub Actions secrets. Never in app code, `package.json`, or the installer.
- Never commit a token, `.env`, or credential file. `.env` and `.env.*` are already gitignored.
- Never use a token for the private source repo to publish public releases.
- The installed app **never** embeds a token; it reads the public feed anonymously.

---

## 3. Release procedure

### Step 1 — bump the version

```bash
npm version patch        # or: npm version minor | npm version major
```

This updates **both** `package.json` and `package-lock.json` and creates a commit + tag.
(The lockfile has the version in **two** places — `version` and `packages[""].version`.
Hand-editing only one causes a confusing mismatch; let `npm version` handle it.)

### Step 2 — verify locally before tagging anything

```bash
npm run typecheck        # must exit 0
npm test                 # must pass
npm run dist             # local installer only, no publishing
```

A broken build that reaches a tag produces a **failed release run** and, worse, a tag you must delete
and retag. Catch it here.

### Step 3 — push the commit and tag

```bash
git push origin main
git push origin v<version>     # the tag created by npm version
```

Pushing the tag is what actually triggers publishing. Pushing only the commit does nothing.

### Tag rules (both enforced, both verified)

- The tag **must** be exactly `v<package.json version>` — e.g. version `0.2.2` → tag `v0.2.2`.
  The workflow rejects `0.2.2` (missing `v`) and rejects a stale tag like `v0.2.1` against version `0.2.2`.
- The trigger glob is `v*.*.*`, so **all three** segments must be present — `v0.2` will not fire.
- Because `npm version` creates the tag for you, prefer it over hand-made tags: it guarantees the
  two can't drift.

### What happens next

`.github/workflows/publish-release.yml` fires on tags matching `v*.*.*`:

1. Checks out, sets up **Node 22** and **.NET 8**
2. **Fails fast if the tag ≠ `package.json` version** — e.g. tag `v0.2.2` with version `0.2.1` throws
   `Tag v0.2.2 does not match package.json version v0.2.1`
3. `npm ci`, then typecheck + tests
4. `npm run release` → builds the .NET sidecar, builds the NSIS installer, publishes with
   `GH_TOKEN: ${{ secrets.RELEASES_GH_TOKEN }}`

**No manual GitHub step remains.** Commit → tag → push is the whole job.

### Non-blocking warnings you can ignore

- `Node.js 20 is deprecated ... actions/checkout@v4, actions/setup-dotnet@v4, actions/setup-node@v4`
  — GitHub force-runs these on Node 24. Cosmetic. (`checkout@v5` etc. would silence it.)
- `outDir ... is not inside project root and will not be emptied` — expected.
- `default Electron icon is used reason=application icon is not set` — cosmetic.

Do **not** report these as failures. Do **not** suppress them either.

---

## 4. What must exist after publishing

A successful run creates a **published (non-draft, non-prerelease)** release with exactly three assets:

| Asset | Purpose |
| --- | --- |
| `VRChat-Music-Bridge-Setup-<version>.exe` | The installer (~126 MB) |
| `VRChat-Music-Bridge-Setup-<version>.exe.blockmap` | Differential download data |
| `latest.yml` | **The update manifest.** Without it the updater is dead. |

`latest.yml` is the contract electron-updater reads:

```yaml
version: 0.2.1
files:
  - url: VRChat-Music-Bridge-Setup-0.2.1.exe
    sha512: <base64>
    size: 131900825
path: VRChat-Music-Bridge-Setup-0.2.1.exe
sha512: <base64>
releaseDate: '...'
```

Release **tags must be prefixed `v`** and match the app version, or electron-updater won't recognize them.

---

## 5. Verify — do not assume a green run means users can update

Run all four checks. Each one catches a different failure.

```bash
# 1. The run succeeded
#    https://github.com/dtd540/Rdp/actions/runs/<run-id>  → Status: Success

# 2. The release exists with all three assets
curl -s https://api.github.com/repos/dtd540/Rdp-releases/releases/latest \
  | python -c "import sys,json; d=json.load(sys.stdin); print(d['tag_name']); [print(' ', a['name'], a['size']) for a in d['assets']]"

# 3. The manifest is publicly reachable — THIS is what users' apps actually fetch
curl -sL -w '\nHTTP %{http_code}\n' \
  https://github.com/dtd540/Rdp-releases/releases/latest/download/latest.yml

# 4. The installer downloads and its SHA-512 matches the manifest
#    (the exact integrity check electron-updater performs)
cd "$(mktemp -d)"
curl -sLO https://github.com/dtd540/Rdp-releases/releases/latest/download/VRChat-Music-Bridge-Setup-0.2.1.exe
python -c "
import hashlib, base64, re, urllib.request, os
h = hashlib.sha512()
with open('VRChat-Music-Bridge-Setup-0.2.1.exe','rb') as f:
    for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
actual = base64.b64encode(h.digest()).decode()
y = urllib.request.urlopen('https://github.com/dtd540/Rdp-releases/releases/latest/download/latest.yml').read().decode()
print('sha512 matches:', re.search(r'^sha512:\s*(\S+)', y, re.M).group(1) == actual)
print('size matches  :', int(re.search(r'size:\s*(\d+)', y).group(1)) == os.path.getsize('VRChat-Music-Bridge-Setup-0.2.1.exe'))
"
```

**Confirm on a real machine too.** After the run, the installed app should open a TLS connection to
GitHub's release CDN shortly after launch. Resolve the hostname rather than hardcoding an IP — it
rotates across several addresses (a live lookup returned `185.199.108-111.133`):

```powershell
$cdn = (Resolve-DnsName release-assets.githubusercontent.com).IPAddress
Get-NetTCPConnection -RemotePort 443 -State Established |
  Where-Object { $cdn -contains $_.RemoteAddress }
```

A non-empty result means the app really fetched the feed.

### What you still cannot prove without a real 0.2.2

If the installed app is already on the newest version, it correctly reports "up to date" and downloads
nothing. That proves the **check** works but not the **download-and-install** path. To prove that
end-to-end, publish a genuinely newer version and let an older install pull it. Only claim what you tested.

---

## 6. Troubleshooting

Work top-down. In this project, each failure only became visible after the previous one was fixed.

### Release upload authentication error
Confirm the `RELEASES_GH_TOKEN` Actions secret exists in the private source repo
(`Rdp` → Settings → Secrets and variables → Actions) and is scoped to the public releases repo.

### `403` — `Resource not accessible by personal access token`
The token can reach the repo but lacks **Contents: Read and write**.
`Administration: read/write` is **not** a substitute. Edit the token's permissions.

### `422` — `Repository is empty.`
`Rdp-releases` has zero commits. Push an initial README commit to `main`, then confirm it exists:
```bash
curl -s https://api.github.com/repos/dtd540/Rdp-releases/commits | grep -m1 '"sha"'
```
Then **re-run the workflow.** A run started before this commit will fail identically no matter what.

### `Tag v0.2.2 does not match package.json version v0.2.1`
`npm version` wasn't run, or the tag was hand-made. Fix the version, then delete and re-push the tag:
```bash
git tag -d v0.2.2 && git push origin :refs/tags/v0.2.2
```

### Re-running a failed job
GitHub → the run → **Re-run failed jobs**. GitHub's UI is at
`https://github.com/dtd540/Rdp/actions/runs/<run-id>`.

**A re-run may fail with an error describing a state you've already fixed.** Read the error's
`"date":` header in the log and compare it to when you applied your fix. If the error predates the fix,
the run simply needs re-running again.

### Build works locally, fails in CI
`npm run dist` already chains `npm run sidecar:build`, so don't run the sidecar step separately.
If the sidecar is missing or stale, rebuild it with `npm run sidecar:build` — this requires the
**.NET 8 SDK**, which CI installs for you. If you instead see the installer succeed but the app
launch with no audio engine, the sidecar is the likely culprit.

### Reading long CI logs
Scroll the log container and read the tail. On this machine the display is scaled ~150%, and a
non-DPI-aware screenshot crops the right of the window — verify with text, not pixels, when unsure.

---

## 7. Current state (as of the last successful publish)

| Fact | Value |
| --- | --- |
| Source repo | `dtd540/Rdp` (private), branch `main`, remote `https://github.com/dtd540/Rdp.git` |
| Releases repo | `dtd540/Rdp-releases` (public) |
| Published version | `0.2.1` — release live with all 3 assets, SHA-512 verified |
| Tags | `v0.2.0`, `v0.2.1` |
| Stack | Electron `^33.2.1`, electron-updater `^6.8.9`, electron-builder `^25.1.8`, React `^18.3.1`, Vite `^5.4.11`, TypeScript `^5.7.2`, Vitest `^2.1.8` |
| Sidecar | C# `net8.0-windows`, self-contained |
| CI toolchain | Node 22, .NET 8, `windows-latest` |
| Build output | `release/` (gitignored), `out/` (gitignored) |

**Working tree was clean at the last publish.** If you find uncommitted changes, someone left work
in progress — clarify before tagging.

### Signing status

The installer is **unsigned**. Users will see a SmartScreen warning; they must click through.
electron-updater 6.8.9 skips Authenticode verification when no publisher name is configured, but
**still verifies the SHA-512** from `latest.yml`. That is transport integrity, **not** publisher
authentication. To harden: code-sign releases and configure the expected publisher name before
distributing widely.

---

## 8. Bootstrap caveat — be precise about this

Any install that **predates in-app updating** cannot self-update; it must be replaced by a manual
installer download once. After that, every later version arrives in-app.

When telling users about updates, state which builds can self-update. Don't claim a pre-updater
build can update itself.

---

## 9. Quick reference

```bash
npm version patch        # bump version + commit + tag
npm run typecheck        # gate
npm test                 # gate
git push origin main
git push origin v0.2.2   # ← this triggers the release
# then: watch the run, run all four verification checks above
```

**Rules of thumb**
1. Never put a token in code or the installer.
2. Never rename or privatize `Rdp-releases`.
3. Tag and `package.json` version must match exactly, both prefixed `v`.
4. Verify `latest.yml` is publicly reachable — a green CI run does not prove this.
5. Report only what you verified; call out anything you couldn't test.
