# StykAnimate 0.5.6 Windows release verification

Source commit: `28cd6f9cf7033954fd131544276c1483a1f3afca` (private `filippocalippo/StykAnimate-App`).
Release: https://github.com/filippocalippo/styk-animate-releases/releases/tag/v0.5.6
Published 2026-09-11T02:21:26Z as the latest stable GitHub release. All five public assets match local SHA-256 digests and byte lengths, and public notes match the generated notes. The packaged production updater downloaded and verified the public 0.5.6 installer, displayed progress, and reported the actual packaged version as current. No production installer was launched over the user’s app.

## Scope and provenance

The application, codec, release tooling, and related tests and documentation are committed together. Separate website/cloud changes, video projects, and their deletions remain outside this app release. The unrelated launch-video note remains in Unreleased; all shipped app entries moved into 0.5.6. The existing 0.5.5 changelog section was preserved.

Built locally on Windows x64 with Node 24.11.0, Python 3.12.9, Electron 39.8.10, locked npm dependencies installed with npm ci, and pinned Python build dependencies. Rebuilt the native PIV scanner, x86/x64 VFW helpers, frozen codec, and offline video encoder. Packaged telemetry provenance is external (`internal: false`).

## Verification

- JavaScript syntax: 761 files, zero errors; root unit suite: 1,663 passed.
- Python backend/codec suite: 72 passed; standalone codec health, native scanning, and byte-exact PIV import passed.
- Changelog tests: 18 passed; update/release-asset tests: 8 passed; generated notes and both package versions agree.
- Browser suites passed: export experience, adaptive preview, theme, VFX, expanded VFX, renderer recovery, playback preview pressure, playback cache pressure, compatibility canvas, timeline key selection, and movieclip extension. A real 4K browser export completed. Theme and packaged welcome screenshots were visually inspected.
- Exact package verification: 282 web assets and 17 native modules match source. Desktop smoke passed WebGPU startup, context isolation, native imports, native save, save cancellation, and save-before-close.
- Packaged update UI passed splash lifecycle, export panel, support link, download progress, restart cancellation with unsaved edits, and saving before installer invocation. Updated the obsolete export-donation expectation to the redesigned export panel and the existing Help support action.
- Public GitHub update check passed through production electron-updater: downloaded version 0.5.6, verified installer, observed download progress, and current-version check 0.5.6. Evidence: `artifacts/updates/github-smoke.json`.
- Real NSIS download/install/relaunch passed using isolated fixture versions 0.0.1 and 0.0.2 and a unique app identity. This did not replace the user's installed app.
- Dense PIV benchmark completed all 1,872 display ticks at requested 120 FPS, with zero reduced-quality packets and no reported errors. Observed mean presentation was 68.09 FPS in this single workstation run. Pan, pose, timeline scrub, and a 150-frame replay completed. This is a source-run observation, not a hardware-wide performance guarantee.
- Setup, Portable, updater metadata, and blockmap passed the release verifier. The exact package was marked as the local launcher's verified release.

Package manifest SHA-256: `1900a62c4f10f0ac4a389c209d454990323e7d360d3e182066c07fcc710215ae`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| win-unpacked/StykAnimate.exe | 210977280 | `8ca61c32074a1acb9ce6ff20b4d857bbe171ea349567dc2f2d2bbdb62ef6b122` |
| StykAnimate-0.5.6-Setup-x64.exe | 127461225 | `b5808a63e7b00df2d72833ec94ec7ec2ad48644f84671fcd0532e0c840cc9371` |
| StykAnimate-0.5.6-Portable-x64.exe | 127229512 | `b74f561eb4d3fd5e0e7ac6e5669b32de2fb7b52a8909b4071330124ec1f0f902` |

## Evidence and limitations

Local evidence is under `artifacts/release-0.5.6-*`, `artifacts/updates/`, `artifacts/playback-interactions/release-0.5.6/`, `artifacts/package-manifest.json`, and `release/0.5.6/verified-release.json`. These logs and private source are not release attachments.

Windows x64 is the verified and shipped platform. The existing build configuration is unsigned. macOS/Linux were not built or executed. The NSIS fixture verifies real installation; it does not certify replacement of a real existing StykAnimate installation. Website deployment is outside this app release.
