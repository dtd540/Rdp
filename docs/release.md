# Publishing an update

Releases are driven by a git tag. You do not upload anything by hand, and you do not
need a GitHub token on this PC — the token lives in the repository as a secret.

## The short version

```bash
node scripts/publish.mjs patch     # or minor | major | an exact version like 0.3.1
```

Add `--dry` to see exactly what it would do without changing anything.

That command checks the tree is clean and you are on `main`, confirms the lockfile is
committed, runs typecheck and the test suite, bumps `package.json`, commits, creates the
matching tag, and pushes both.

## Publishing a version that is already committed

`scripts/publish.mjs` *bumps* the version, so it is for the next release. If the version
you want is already in `package.json` and simply has not been tagged yet, tag that commit
directly — no bump needed:

```bash
git tag v0.3.0
git push origin v0.3.0
```

The workflow's version check passes because the tag and `package.json` agree. Pushing the
tag is the entire action; GitHub builds and publishes it. No token is needed on this PC.

## Why a tag, and not `npm run release` locally

`.github/workflows/publish-release.yml` triggers on a `v*.*.*` tag and runs the whole
release on a Windows runner: it verifies the tag matches `package.json`, runs `npm ci`,
typecheck, tests, then `npm run release` with `GH_TOKEN` supplied from the
`RELEASES_GH_TOKEN` repository secret.

Keeping the version bump and the tag in one step is the point — the workflow **refuses to
build unless `v<tag>` matches `package.json` exactly**, which is the single most common
way a release silently produces nothing.

## What actually gets published

- Source code: `dtd540/Rdp` (private)
- The installer and update feed: `dtd540/Rdp-releases` — **public**. Anyone can download
  releases; installed copies fetch the update manifest and installer anonymously. The
  publisher uses the `RELEASES_GH_TOKEN` GitHub Actions secret only to upload assets.

Assets per release: `VRChat-Music-Bridge-Setup-<version>.exe`, its `.blockmap`, and
`latest.yml`. `latest.yml` is the manifest the auto-updater reads, so it must always
ship alongside the `.exe`.

## Feed access

Installed app builds use the public GitHub Releases provider (`private: false`) and need
no local token. The publishing workflow authenticates separately with the repository
Actions secret `RELEASES_GH_TOKEN`; never put that publishing credential in app code or
an installer. Making the feed private would break existing public-feed builds.

## Watching it run

The push prints an Actions URL. The run takes a few minutes (Node, .NET, and an
electron-builder packaging step). When it finishes, `Rdp-releases` has a new release.

## When it goes wrong

| Symptom | Cause |
| --- | --- |
| Workflow fails at "Verify release tag matches package version" | The tag and `package.json` disagree. Delete the tag, fix the version, re-tag. |
| Workflow fails at "Install dependencies" | `package-lock.json` is missing or out of date. Run `npm install` and commit the lockfile. |
| Workflow fails at "Build and publish" with an auth error | The `RELEASES_GH_TOKEN` secret is missing, expired, or lacks `contents: write` on `Rdp-releases`. |
| `npm run release` fails locally with `Access is denied` / `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` | The app is running and locking `release/win-unpacked`. Close it. This only affects local builds; CI is unaffected. |
| Installed users never see the update | The version did not move, so the updater had nothing newer to offer. |
| Update checks fail with a 404 or an auth error | Confirm `Rdp-releases` is still public and the published `latest.yml` is reachable. |

## Building locally without publishing

```bash
npm run dist      # same build, no upload
```

If the app is running, this fails on the locked output folder — close it first. To build
anyway without disturbing a running copy, point the output elsewhere:

```bash
npx electron-builder --win --x64 --publish never --config.directories.output="C:/Temp/vmb-build"
```

## Manual fallback

If CI is unavailable, `npm run release` from a clean `main` does the same work locally.
It needs `GH_TOKEN` in the environment for upload permissions; do not share or embed this
credential. Close the installed app first so it does not lock `release/win-unpacked`.
