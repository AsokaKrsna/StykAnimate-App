# Export experience and high-resolution verification

For the September 13 direct-worker export optimization, Akane benchmark,
compression comparisons and current validation, see
[Export performance verification](performance/EXPORT-PERFORMANCE.md).

The export panel groups existing commands into Video, Animated image, Frames &
sequences, and Editable file. `src/export-panel.mjs` owns presentation; capability
probing and the existing application commands remain responsible for providers,
codecs, rendering and saving. Resolution presets preserve the document's shape
and orientation; custom dimensions still support unlocking the aspect ratio.
The summary reports output pixels, selected frame count, duration and frame rate.
Current-frame output shows the source frame number. Labels and status replace
introductory copy and repeated descriptions; irrelevant options are hidden.
Invalid dimensions, memory plans, ranges, GIF rates and active
quality/bitrate inputs disable submission with an inline explanation.
Video quality defaults to Recommended, with Smaller file and Higher quality
choices. Native encoders select bitrate from scene complexity; the browser
calculates a target from the final dimensions and frame rate. Manual bitrate and
codec selectors are available under Advanced video settings. See the
[quality-control contract](EXPORT-FORMATS.md) for mappings and verification.

`src/export-progress.mjs` owns transient progress only, with no document or pixel
cache. Rendering notifications advance the rendered/remaining counters after
validated frame delivery. Encoder acknowledgments advance the bar. Source frame
numbers respect the selected range; GIF exposes two passes with the real frame
count in each. Elapsed time never manufactures progress. The estimate uses
completed work and elapsed time, appears after three acknowledged frames, and
does not estimate final encoding or file-system latency. The last 5% is reserved
for finalization and saving; the UI never reports 100% before saving succeeds.
Cancellation, dialog replacement and failure dispose progress timers and panel
observers. The existing save layer still stages and atomically replaces files.

Software export surfaces, tiled supersampling, hard image allowances and editor
GPU-loss recovery are described in [export sampling](export-sampling.md). RAM
tiers are conservative allowances, not measurements of free memory. Driver/OS
termination, arbitrary document complexity and process-wide exhaustion cannot
be guaranteed away. These changes do not silently reduce output resolution.

## September 10, 2026 source verification

- `node tests/export-experience.browser.mjs`: 18 checks for presets, summaries,
  inline rejection, format visibility, balanced columns, 1100×680 and 540×700
  layouts, actual 4K APNG output, live counts, two-pass GIF and cancellation.
  Light, dark and compact screenshots were visually inspected.
- `node tests/export-throughput.browser.mjs --before`, then the same command
  without the flag: 100 visible outlined figures, 3840×2160, Smooth sprites,
  256 MiB working-pixel allowance, three repeated frames. Median render wall
  time changed from **20,845.8 ms to 450.4 ms** (about **46×**). Before/after
  output SHA-256 was identical. This is an isolated fixture on one machine,
  not end-to-end video speed or a low-end hardware benchmark. Baseline flag
  labels the captured run; reproducing a baseline requires the prior source.
- `node tests/export-4k.desktop.mjs`: actual sandboxed Electron renderer, worker,
  native IPC/FFmpeg and staged save. MP4 with Smooth sprites, WebM with Smooth
  edges, and MP4 with No smoothing each saved 3840×2160 files. Independent
  FFmpeg decoding produced every expected frame (12 per export), with changing
  image hashes. Recommended quality reached the native encoder without a fixed
  bitrate. The document/revision survived and the live GPU device stayed
  connected. Total measured export plus independent verification time was
  4.63, 3.64 and 3.56 seconds respectively. Electron launch required execution
  outside the tool's restrictive process sandbox.
- `node tests/export-memory.browser.mjs`: twenty repeated frames under a
  constrained 32 MiB pixel allowance, tiled pixel comparison, injected canvas
  loss, resource release and a successful retry.
- `node tests/export-device-isolation.browser.mjs`: repeated 1080p exports in all
  sampling modes, stable software scratch-context count, actual WebM decode,
  injected editor GPU device loss, automatic software recovery, successful
  concurrent export, preserved editing and undo.
- `node tests/export-sampling.browser.mjs`: 164 worker/encoder checks; actual-app
  companion `node tests/export-sampling-app.browser.mjs`: 25 checks. The
  browser WebM decode/playback/error/cancellation suite also passed.
- Focused unit/native service checks passed for frame accounting, pending
  encoder windows, resource rejection, timeout cleanup, codecs, native output
  decoding, VFW, streaming limits and cancellation.

Artifacts are under `artifacts/export-experience`, `export-throughput`,
`export-4k`, `export-memory`, `export-device-isolation`, and `export-sampling`.
The full root unit run reported **1,600 passed / 9 failed**. Failures are in
untouched animation target/key insertion, onion-skin sampling, property channel
authoring and native-document materialization tests; their import paths do not
include the changed renderer/UI/encoder modules. The complete output is
`artifacts/export-experience/root-unit-tests.log`. This task does not certify
the full dirty workspace or a packaged release.

Encoder options follow the [FFmpeg codec documentation](https://ffmpeg.org/ffmpeg-codecs.html)
and [WebCodecs queue/flush contract](https://www.w3.org/TR/webcodecs/).
