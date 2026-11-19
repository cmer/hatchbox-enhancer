// Cuts a release:
//   1. checks that the tree is clean, on main, and in sync with origin
//   2. bumps the version in package.json and extension/manifest.json
//   3. moves CHANGELOG.md's "Unreleased" notes under the new version
//   4. builds dist/hatchbox-enhancer-<v>.zip and hatchbox-enhancer.user.js
//   5. commits, tags v<version>, pushes, and creates a GitHub release with both files
//
// Usage: node scripts/release.mjs <patch|minor|major|x.y.z> [--dry-run]
//        node scripts/release.mjs --current    (tag and release the version already in package.json)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const path = (p) => new URL(p, root);
const read = (p) => readFileSync(path(p), 'utf8');
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe' })?.trim();
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const current = args.includes('--current');
const bump = args.find((a) => !a.startsWith('--'));
if (!current && !bump) fail('Usage: node scripts/release.mjs <patch|minor|major|x.y.z> [--dry-run]  (or --current)');

// --- Preflight -------------------------------------------------------------
if (run('git', ['status', '--porcelain'])) fail('Working tree is not clean. Commit or stash changes first.');
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') fail(`Releases are cut from main (you are on ${branch}).`);
run('git', ['fetch', '--quiet', '--tags', 'origin']);
const behind = run('git', ['rev-list', '--count', 'HEAD..origin/main']);
if (behind !== '0') fail(`main is ${behind} commit(s) behind origin/main. Pull first.`);

// --- Version ---------------------------------------------------------------
const pkg = JSON.parse(read('package.json'));
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const [, maj, min, pat] = (pkg.version.match(SEMVER) || fail(`package.json version "${pkg.version}" is not x.y.z`)).map(Number);
let version;
if (current) version = pkg.version;
else if (bump === 'major') version = `${maj + 1}.0.0`;
else if (bump === 'minor') version = `${maj}.${min + 1}.0`;
else if (bump === 'patch') version = `${maj}.${min}.${pat + 1}`;
else if (SEMVER.test(bump)) version = bump;
else fail(`Unknown bump "${bump}". Use patch, minor, major or x.y.z.`);

const tag = `v${version}`;
if (run('git', ['tag', '--list', tag])) fail(`Tag ${tag} already exists.`);
if (!current) {
  const cmp = (a, b) => a.split('.').map(Number).reduce((r, n, i) => r || n - b.split('.').map(Number)[i], 0);
  if (cmp(version, pkg.version) <= 0) fail(`${version} is not greater than the current ${pkg.version}.`);
}

// --- Changelog -------------------------------------------------------------
if (!existsSync(path('CHANGELOG.md'))) fail('CHANGELOG.md is missing.');
let changelog = read('CHANGELOG.md');
let notes;
if (current) {
  const m = changelog.match(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, 'm'));
  if (!m || !m[1].trim()) fail(`CHANGELOG.md has no notes under "## [${version}]".`);
  notes = m[1].trim();
} else {
  const m = changelog.match(/^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/m);
  if (!m) fail('CHANGELOG.md has no "## [Unreleased]" section.');
  notes = m[1].trim();
  if (!notes) fail('The "Unreleased" section of CHANGELOG.md is empty. Describe the changes first.');
  const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
  changelog = changelog.replace(m[0], `## [Unreleased]\n\n## [${version}] - ${date}\n\n${notes}\n\n`);
}

console.log(`\nRelease ${tag}${dryRun ? ' (dry run)' : ''}\n\n${notes}\n`);
if (dryRun) process.exit(0);

// --- Write, build, commit, tag, push, publish ------------------------------
if (!current) {
  pkg.version = version;
  writeFileSync(path('package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const manifest = JSON.parse(read('extension/manifest.json'));
  manifest.version = version;
  writeFileSync(path('extension/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(path('CHANGELOG.md'), changelog);
}

run('node', ['scripts/build.mjs', '--zip'], { inherit: true });
const zip = `dist/hatchbox-enhancer-${version}.zip`;
if (!existsSync(path(zip))) fail(`Build did not produce ${zip}.`);

if (run('git', ['status', '--porcelain'])) {
  run('git', ['add', 'package.json', 'extension/manifest.json', 'CHANGELOG.md', 'hatchbox-enhancer.user.js']);
  run('git', ['commit', '-q', '-m', `Release ${tag}`]);
}
run('git', ['tag', '-a', tag, '-m', `Release ${tag}\n\n${notes}`]);
run('git', ['push', '-q', 'origin', 'main', tag], { inherit: true });

let releaseUrl = '';
try {
  releaseUrl = run('gh', ['release', 'create', tag, zip, 'hatchbox-enhancer.user.js', '--title', tag, '--notes', notes, '--verify-tag']);
} catch (e) {
  console.warn(`\n! Tag pushed, but the GitHub release could not be created (${e.message.split('\n')[0]}).`);
  console.warn(`  Retry with: gh release create ${tag} ${zip} hatchbox-enhancer.user.js --title ${tag} --notes-from-tag`);
}

console.log(`
✓ Released ${tag}
  Chrome Web Store zip: ${new URL(zip, root).pathname}
  GitHub release:       ${releaseUrl || '(not created)'}
  Userscript users get the update automatically from main.

Next: upload the zip at https://chrome.google.com/webstore/devconsole → Hatchbox Enhancer → Package → Upload new package, then Submit for review.`);
