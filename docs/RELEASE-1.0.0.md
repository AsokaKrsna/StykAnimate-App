# Windows 1.0.0 release verification

Published 2026-09-14 at 00:41:43 UTC as the latest stable release:
https://github.com/filippocalippo/styk-animate-releases/releases/tag/v1.0.0

Application source commit: `8d2af41`, pushed to the private source repository.
Unrelated local design and video files were excluded. The authored release history
and generated notes were committed with both package version files. Unreleased is empty.

## Exact artifacts

Built locally for Windows x64 with Node 24.11.0, Python 3.12.9, locked npm
dependencies, and the pinned Python build dependencies. Native scanner, both VFW
helpers, standalone codec and offline video encoder were rebuilt and verified.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| StykAnimate-1.0.0-Setup-x64.exe | 128340424 | `609f473f45cd496c660ab2dc8494f741d18ef35bb6af4a912a8948b36c1d9cf3` |
| StykAnimate-1.0.0-Portable-x64.exe | 128108642 | `74c3bec3cca72057ce19ce4d0be0d67bad63c6e36d48f92e4e7121f9e5bc4f8c` |

The draft's notes, five asset sizes and GitHub SHA-256 digests matched local files
before publication. Published assets also include the Setup blockmap, latest.yml
and SHA256SUMS.txt. The local verified-release marker identifies the tested package.

## Checks completed

- All 2,067 root unit tests; 948 JavaScript syntax checks; changelog validation and 18 changelog tests; 8 updater/release-asset tests.
- Browser checks for figure colors, eyedropper, clipboard colors, multiple figure transforms, joining, renderer opacity and preview image formats.
- Exact-package verification: 364 web assets and 18 native modules matched source, with zero files synchronized by verification.
- Packaged WebGPU startup, frozen codecs, imports, native saves, cancellation and save-before-close; packaged update dialogs, download progress and save-before-restart behavior.
- Isolated real NSIS fixture installation, update download, installer execution and automatic relaunch passed.
- Public electron-updater download verified version 1.0.0, observed progress and confirmed 1.0.0 is current. This test did not launch the public installer.
- Live HTTPS download page, release catalogue, changelog and authenticated production dashboard passed; no synthetic telemetry or feedback was submitted.
- Rendered playback and packaged welcome screenshots were inspected.

The 1,000-figure, 24-keyframe WebGPU benchmark measured 119.98 warm FPS at a
120 FPS target with zero skipped ticks on this NVIDIA Lovelace machine. Sixty
translation samples retained geometry references and uploaded zero geometry bytes.
These are bounded host measurements, not a guarantee for other scenes or hardware.

Evidence is in ignored artifacts/release-1.0.0-*.log, artifacts/updates/, the
package manifest and smoke reports, and artifacts/renderer-ui-performance-120fps.json.
Windows builds retain the existing unsigned configuration. macOS and Linux were
not built or tested. An existing user installation was not replaced; the actual
installer/relaunch test used its own fixture identity.

## Production diagnostic reset

After publication, the authorized performance-and-problems reset succeeded at
2026-09-14T00:42:13.026Z, advancing diagnostic generation from 1 to 2.
Immediate D1 verification found zero performance, error, timing, gauge or operation
context fields across 391 snapshots and 3 rollups. All 3 feedback entries remained,
and stored-byte accounting matched the remaining payloads. The reset preserves
product activity and uses the existing generation guard against stale queued reports.
The receipt is artifacts/cloudflare/diagnostic-reset-receipt.json. Fresh diagnostics
can accumulate after the reset; older clients can resume on later UTC days.
