---
name: release
description: Cut a new release of Hatchbox Enhancer — update CHANGELOG.md from the commits since the last tag, bump the version, build the Chrome Web Store zip and the userscript, tag, push, and create the GitHub release. Use when the user asks to release, publish, ship, or bump the version.
---

# Release Hatchbox Enhancer

`scripts/release.mjs` (also `npm run release -- <bump>`) does the mechanical part: preflight checks, version bump in `package.json` and `extension/manifest.json`, moving the changelog's Unreleased notes under the new version, building, committing `Release vX.Y.Z`, tagging `vX.Y.Z`, pushing, and creating a GitHub release with the zip and the userscript attached. Your job is the changelog and the version choice.

Invoking this skill is the user's go-ahead to commit, tag, push and create the GitHub release. Uploading to the Chrome Web Store stays manual.

## Steps

1. **Preflight.** Run `git status --porcelain` and `git log origin/main..HEAD --oneline`. If there are uncommitted changes, ask whether to commit them as part of the release or stop. The script refuses a dirty tree.

2. **Collect changes.** `git describe --tags --abbrev=0` gives the last tag (if none, use all history). Read `git log <last-tag>..HEAD --format='%h %s%n%b'`, and the diff (`git diff <last-tag>..HEAD -- src extension`) when commit messages are vague. If there are no user-facing changes since the last tag, say so and stop.

3. **Write the changelog.** Under `## [Unreleased]` in `CHANGELOG.md`, add entries grouped by `### Added`, `### Changed`, `### Fixed`, `### Removed`. Write for users of the extension, not developers: what they'll notice, in plain sentences. Leave out refactors, build tweaks and README edits unless they change behavior. Keep any entries already under Unreleased. Commit it: `git commit -am "Update changelog"`.

4. **Pick the bump.** Default `patch` for fixes only, `minor` when anything is added or changed, `major` only for breaking changes to saved settings or if the user asks. Use the user's explicit choice if they gave one.

5. **Dry run, then release.**
   ```sh
   node scripts/release.mjs <bump> --dry-run   # prints version and notes, changes nothing
   node scripts/release.mjs <bump>
   ```
   If it fails partway, read the error: before the commit, `git checkout -- .` restores the tree; after the tag is pushed, don't re-tag — fix forward or create the GitHub release with the command it prints.

6. **Report** the version, the zip path (`dist/hatchbox-enhancer-<version>.zip`, clickable absolute path), the GitHub release URL, and the manual last step: Chrome Web Store Developer Dashboard → Hatchbox Enhancer → **Package** → **Upload new package** → **Submit for review**. Userscript users update automatically from `main`.

## Notes

- The store takes the `.zip`, never a `.crx`; Google signs it.
- The store rejects a version that isn't higher than the published one, so never reuse or lower a version.
- `node scripts/release.mjs --current` tags and releases the version already in `package.json` using its existing changelog section (used for the first release, 1.0.0).
