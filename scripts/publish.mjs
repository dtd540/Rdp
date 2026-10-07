#!/usr/bin/env node
/**
 * Cut a release the way .github/workflows/publish-release.yml expects.
 *
 * That workflow runs on a `v*.*.*` tag and refuses to build unless the tag matches
 * package.json exactly, so the version bump and the tag have to move together. Doing
 * that by hand is where releases go wrong, so it happens here in one step:
 *
 *   node scripts/publish.mjs 0.3.1          # explicit version
 *   node scripts/publish.mjs patch          # or patch | minor | major
 *   node scripts/publish.mjs patch --dry    # show the plan, change nothing
 *
 * Pushing a tag starts a PUBLIC release on the `Rdp-releases` repo, which every
 * installed copy of the app will auto-update from. That is why the tree must be clean
 * and the tests must pass before the tag is created.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const target = args.find((arg) => !arg.startsWith('--'));

function fail(message) {
  console.error(`\n  x ${message}\n`);
  process.exit(1);
}

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim();
}

function npm(...npmArgs) {
  // npm is a .cmd shim on Windows, so let the shell resolve it.
  execFileSync('npm', npmArgs, { cwd: root, stdio: 'inherit', shell: true });
}

if (!target) fail('Name the release: node scripts/publish.mjs <version|patch|minor|major> [--dry]');

const current = JSON.parse(readFileSync(packagePath, 'utf8')).version;

/* ---------- work out the next version ---------- */
const bump = (part) => {
  const [major, minor, patch] = current.split('.').map(Number);
  if ([major, minor, patch].some((n) => Number.isNaN(n))) fail(`package.json version "${current}" is not x.y.z`);
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  fail(`"${part}" is not a version or one of patch|minor|major`);
};

const next = /^\d+\.\d+\.\d+$/.test(target) ? target : bump(target);

if (next === current) fail(`package.json is already ${current}; the workflow needs a different version to publish`);

/* Anything below the current version would publish an older build as an update. */
const asNumber = (v) => v.split('.').map(Number).reduce((acc, n) => acc * 1000 + n, 0);
if (asNumber(next) < asNumber(current)) fail(`${next} is older than the current ${current}`);

/* ---------- preconditions ---------- */
console.log(`\nRelease ${current} -> ${next}${dryRun ? '  (dry run)' : ''}\n`);

const status = git('status', '--porcelain');
if (status) fail(`working tree is not clean; commit or stash first:\n${status}`);

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`on branch "${branch}"; releases are cut from main`);

const existingTags = git('tag', '--list', `v${next}`);
if (existingTags) fail(`tag v${next} already exists; publishing it again would be rejected by the workflow`);

/* The workflow runs `npm ci`, which needs a lockfile that is actually committed. */
git('ls-files', '--error-unmatch', 'package-lock.json');

/* The workflow runs these too, but failing here costs seconds instead of a CI round trip. */
console.log('  running typecheck and tests (the workflow runs these as well)');
npm('run', 'typecheck');
npm('test');

/* ---------- plan ---------- */
console.log(`\n  about to:
    1. set package.json version to ${next}
    2. commit it
    3. create tag v${next}
    4. push ${branch} and the tag

  Pushing the tag publishes a PUBLIC release on Rdp-releases that installed
  copies of the app auto-update from.`);

if (dryRun) {
  console.log('\n  dry run: nothing was written, committed, tagged or pushed.\n');
  process.exit(0);
}

/* ---------- do it ---------- */
// Touch only the version field so the file's formatting survives.
const raw = readFileSync(packagePath, 'utf8');
const bumped = raw.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`);
if (bumped === raw) fail('could not find the version field to rewrite');
writeFileSync(packagePath, bumped);

git('add', 'package.json');
execFileSync('git', ['commit', '-m', `Release ${next}\n\n🤖 Generated with Codebuff\nCo-Authored-By: Codebuff <noreply@codebuff.com>`], { cwd: root, stdio: 'inherit' });
git('tag', `v${next}`);

execFileSync('git', ['push', 'origin', branch], { cwd: root, stdio: 'inherit' });
execFileSync('git', ['push', 'origin', `v${next}`], { cwd: root, stdio: 'inherit' });

console.log(`\n  Tagged v${next} and pushed.
  The release workflow is now building and publishing it.
  Check progress under the repo's Actions tab.\n`);
