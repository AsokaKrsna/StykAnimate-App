# Windows 1.0.1 hotfix verification

Published as the latest stable version at 2026-09-14T01:05:59Z:
https://github.com/filippocalippo/styk-animate-releases/releases/tag/v1.0.1

Source commit `cc7b684` was pushed to the private repository. Unrelated local
design, video and announcement files were excluded. Unreleased is empty.

The hotfix moves Color palette to a collapsed final section in figure Properties,
removes its helper copy, and restricts parallax to layer Properties. The welcome
dialog keeps Donate and close/start controls visible while categorized notes scroll.
Recent releases loads public changelogs into the same version selector, with bounded
main-process networking, retry and offline access to installed notes.

## Verification

- All 2,070 root unit tests passed on the confirmation run. The initial run had one local HTTP ECONNRESET in the unchanged zero-frame PIV test; its targeted retry and the full confirmation suite passed without code changes.
- 952 JavaScript files passed syntax checks; 18 changelog tests, 3 release-history tests and 8 updater/release-asset tests passed.
- Browser tests covered palette placement and editing, layer-only parallax, categorized notes, loading failure/retry, inert remote text, long-list scrolling, light/dark/compact layouts, donation and close controls. Screenshots were inspected.
- The packaged app loaded real historical releases through the new IPC endpoint and displayed 1.0.0 alongside its installed 1.0.1 notes.
- Exact-package verification matched 365 web assets and 19 native modules with zero files synchronized. Packaged WebGPU, imports, native saving, save-before-close and update-dialog checks passed.
- All five draft asset sizes and GitHub SHA-256 digests matched local files before publication; notes matched the generated release payload.
- The public electron-updater download verified 1.0.1, displayed progress, and confirmed the packaged version is current. The public installer was not launched over an existing user installation.
- The live download page, release catalogue, changelog and authenticated dashboard passed after a targeted release-cache refresh. No diagnostic history was reset for this hotfix.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| StykAnimate-1.0.1-Setup-x64.exe | 128341040 | `4dffe7f472c379d844ed43be89c4b02b2beb261bcf548547d8274376d333255c` |
| StykAnimate-1.0.1-Portable-x64.exe | 128109345 | `59cb475205f47aba8ab07cef6346c26680b90f4b15734876a94bdade8415d53e` |

Builds used Node 24.11.0, the existing locked dependencies and unchanged verified
Python 3.12.9/native codec outputs from 1.0.0. Windows remains unsigned; macOS and
Linux were not built or tested. Evidence is under ignored artifacts/release-1.0.1-*,
artifacts/updates/, and release/1.0.1/verified-release.json.
