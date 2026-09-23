# StykAnimate 1.1.0 release verification

Published on 2026-09-23 as the stable [StykAnimate 1.1.0 release](https://github.com/filippocalippo/styk-animate-releases/releases/tag/v1.1.0).

## Source and scope

- Packaged source: 9ddc659f6718c005612d16e2de0233e625dc3188. A detached checkout froze the shipped bytes while unrelated work continued in the main workspace.
- Includes Origins/Bounds selection in Settings (Origins default), Ctrl/Cmd selection toggling, optional edits across selected frames, joined-pivot transforms, drawing exposure extension and paused/nested drawing fixes.
- The user-edited Unreleased section was moved into 1.1.0 without changing its wording. Package/lock versions and both generated release-note files were committed together.
- Built with Node 24.11.0, Python 3.12.9, Electron 39.8.10 and locked npm/Python dependencies. Native scanner, x86/x64 installed-codec helpers, frozen codec and offline encoder were rebuilt and verified.

## Checks

| Check | Result |
| --- | --- |
| JavaScript syntax | 1,288 files; zero errors |
| Full unit suite | 2,874 passed; zero failed; 19 fixture-dependent tests skipped in the isolated checkout |
| Backend suite | All 101 passed using the existing local fixture corpus |
| Frozen-source browser checks | 39 selection, 145 paused drawing, 35 drawing end-to-end checks passed |
| Additional drawing browser suites | Timeline, rendering, save, preparation, publication, preview lifecycle, composite and integrity passed |
| Exact package | 451 web assets and 21 desktop modules matched frozen source; codec/native/encoder hashes verified |
| Packaged desktop | WebGPU startup, frozen codec, native PIV/STK imports, native saves, save/cancel on close passed |
| Desktop updates | Startup notes, progress, unsaved cancellation and save before restart passed |
| Public updater | Packaged app downloaded and verified the real 1.1.0 installer, displayed progress, then reported version 1.1.0 current; no installation into the user app |
| Real installer upgrade | Separate disposable NSIS application downloaded, upgraded from 0.0.1 to 0.0.2 and relaunched |

Drawing tests include held and intentional blank exposures, nested/composite movieclips, opacity, edit/undo/redo, native reopen, SVG/PIV/STK/GIF/APNG/PNG sequence/WebM exports and exact rendered pixel checks. See [drawing verification](DRAWING-1.1-VERIFICATION.md) for before/after regression evidence and dense workload measurements.

## Published artifacts

The draft notes matched release-notes.md and all five asset names, byte lengths and GitHub SHA-256 digests matched the local files before publication. The verified draft was published without uploading replacement assets. The public latest release is v1.1.0.

| Executable | Bytes | SHA-256 |
| --- | ---: | --- |
| StykAnimate-1.1.0-Setup-x64.exe | 128693928 | 2ec944d561deb8f5e9c8c751d2755e3898552ecc649796c4acc979562d21753f |
| StykAnimate-1.1.0-Portable-x64.exe | 128462136 | 177e895a8dc2368a6a260fd78fede205d4a10b6f29534886820ea209cebd09ac |

Package file-manifest SHA-256: 7a3f98708c12846588f243a73fabc2b1265658d3e2746e32be5a3668d3090b42. The local release launcher marker is release/1.1.0/verified-release.json.

## Evidence and limits

Local evidence: artifacts/drawing-release/release-summary.json, artifacts/package-manifest.json, artifacts/desktop-packaged-smoke.json, artifacts/windows-release-1.1.0.json, artifacts/updates/github-smoke.json and artifacts/release-source/1.1.0/artifacts (unit, backend, browser, build and isolated installer logs).

Windows x64 was exercised on the NVIDIA Lovelace adapter; Canvas 2D and GPU scratch fallback also passed browser drawing checks. macOS, Linux, other GPUs and physical pen drivers were not certified here. Windows executables retain the existing unsigned release configuration. The 19 skipped root tests need optional corpus/localization/encoder fixture paths; the full backend corpus was exercised separately. No zero-regression or universal hardware-performance guarantee is implied.
