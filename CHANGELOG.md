# Changelog

All notable changes to Hatchbox Enhancer (the Chrome extension and the userscript) are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-19

### Added

- Groups you create, rename, reorder and collapse.
- Prefix rules that put matching apps into a group automatically, including apps created later.
- Staging, QA and other environments nested under their production app, folded by default. The fold state is remembered per project.
- Environment inferred from the cluster when an app name has no suffix.
- Drag-and-drop ordering of projects and groups, plus a ⋯ menu to move projects between groups.
- Failing and deploying counts in group headers, and a red dot on folded environments whose last deploy failed.
- Sync across machines: browser account sync in the extension, private GitHub Gist sync in the userscript.
- JSON import and export.
- Light and dark mode, and an "Original view" toggle back to the stock Hatchbox list.
