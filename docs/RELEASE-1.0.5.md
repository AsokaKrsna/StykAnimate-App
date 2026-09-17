# Windows 1.0.5 release verification

Release source: `993bb6b`. Verified on Windows x64 with Node 24.11.0, Python 3.12.9 and locked build dependencies.

## Checks

- Release history and generated notes validated; Unreleased is empty.
- Source syntax check passed; all 2,127 root unit tests passed.
- Update unit/asset tests and Electron update UI smoke passed, including unsaved cancellation and save-before-restart.
- Twenty browser suites passed: builder appearance, style inheritance, shortcuts; canvas zoom; frame navigation; empty, modern and full layer timeline; hotkeys; import cancellation; playback; VFX clips, clip rendering, interactions, interleaving, key channels, surfaces, translation and connected figures. Inspected VFX inspector and release splash screenshots.
- Updated two older browser tests to use explicit range-navigation bindings and check inserted keys inside an existing span rather than assuming animation duration increases.
- Native VFW helpers and frozen codecs rebuilt. Existing unchanged scanner reused after source/binary hash validation because its DLL was locked against replacement. Sidecar checks passed, including byte-exact sample PIV round trip. Offline video encoder staged and verified.
- VFX vector, interleaved grouping and million-key timeline benchmarks passed. Results are local measurements, not universal speed guarantees.
- Exact versioned package resources verified twice; packaged desktop smoke passed WebGPU, codecs, imports, native saves, save/cancel-on-close. Launcher marker and public release asset validation passed.
- Isolated real NSIS update probe passed download, installation and automatic relaunch (0.0.1 to 0.0.2, separate application identity).

## Exact artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Setup x64 | 128389039 | ae2ee649ec9140959c6ce939bc991beed69a186b9170155bb3470d5034a01ee4 |
| Portable x64 | 128157235 | c98f6a354d253d6285b24836850cc84bab21e4449573f84ab8df2cc5ee929b6c |
| Unpacked executable | 210977280 | 1b27b2608b2ee16c45b3f7f36ec04bc03bb3c411bac38093a664ad5068f25126 |

Evidence is retained in `artifacts/release-1.0.5-*.log`, `artifacts/updates/`, and `release/1.0.5/verified-release.json`.

## Limits

Windows x64 only. The real installer probe uses an isolated fixture; an existing user StykAnimate installation was not replaced. Cloud/admin and video work remain outside this desktop release.

## Publication

Published 2026-09-15 at 13:02:59 UTC: https://github.com/filippocalippo/styk-animate-releases/releases/tag/v1.0.5

GitHub reports `isDraft: false` and all five expected assets: Setup, Portable, Setup blockmap, latest.yml, and SHA256SUMS.txt. Publisher compared GitHub digests against local hashes before publication.

The post-publication packaged updater check passed: the real public installer downloaded with progress and electron-updater checksum verification; the actual packaged version and current public version both report 1.0.5. No installer was launched against the user's existing installation. Evidence: `artifacts/updates/github-smoke.json`.

Private source backup: `git push origin main` failed with HTTP 408 while sending the earlier local `b8bbe6c` media-heavy commit. Release and verification commits remain saved locally. This did not affect public publication or the successful live updater check.
