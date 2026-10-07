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
- The installer and update feed: `dtd540/Rdp-releases` — **public as of this writing**,
  so anyone can download a release and installed copies auto-update from it using no
  credential. See *Updating from a private feed* to lock it down.

Assets per release: `VRChat-Music-Bridge-Setup-<version>.exe`, its `.blockmap`, and
`latest.yml`. `latest.yml` is the manifest the auto-updater reads, so it must always
ship alongside the `.exe`.

## Updating from a private feed

The installer must never carry a credential, so the token lives on the machine instead:

```bash
setx GH_TOKEN "<fine-grained PAT, Contents: Read-only, scoped to Rdp-releases>"
```

`setx` writes a user environment variable. Restart the app afterwards, because a running
process keeps the environment it was started with.

What decides whether a build can read a private feed is `resources/app-update.yml`
inside the installed app: `private: true` there makes electron-updater authenticate with
that token, and `private: false` cannot, no matter what is in the environment.

To lock the feed down without stranding yourself, in this order:

1. Release a build that has `private: true` baked in.
2. Install that build by hand on every machine that should keep updating.
3. Set `GH_TOKEN` on each machine and restart the app.
4. Make `Rdp-releases` private.

Step 4 first strands every existing install — including builds you have not replaced yet
— because they cannot authenticate and will silently stop seeing releases.

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
| Update checks fail with a 404 or an auth error after the feed went private | `GH_TOKEN` is missing on that machine, or the installed build predates `private: true`. Set the token and restart; if the build is older, install the current installer by hand once. |

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

If CI is unavailable, `npm run release` from a clean `main` does the same work locally,
but needs `GH_TOKEN` in the environment. Remember the two local gotchas: setting a
variable only in a shell window is temporary (`setx` makes it persist, and a running
terminal keeps the old environment), and the app must be closed first.
