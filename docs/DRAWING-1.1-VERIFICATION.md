# Drawing verification for StykAnimate 1.1

The release fixes distant drawing-key exposure timing and paused drawing presentation.
It uses the existing timeline planner, resource owner and bounded renderer caches.
No recursive document scan was added to interactive rendering.

## Reproduced defects

- A distant blank key inserted an extra blank at the preceding exposure end. The unit test failed with keys [0, 8, 12] and passes with [0, 12]. Copied keys and intentional blank holds also have coverage.
- With renderer/controller modules from 5f588c46, the paused browser regression loses the drawing at frame 3 of the 2,000-segment scene. The fixed implementation retains its pixels.
- Nested drawing-only clips lacked a resource owner; composite clips retained empty compatibility rasters after decoding. Reusing a parent resource could also overwrite a changed child publication. Tests cover each path and undo/redo.
- Direct GPU tiles and scratch textures omitted movieclip opacity. Pixel checks now agree with Canvas rendering.

## Behavioral evidence

- tests/drawing-scrub.browser.mjs: 145 checks across WebGPU tiles, WebGPU scratch fallback and Canvas 2D. Covers normal/dense/nested/composite scenes, held and blank frames, two-cel decode reuse, opacity, nested edits, undo/redo, exact exported pixels and native import without an extra seek. No uncaught browser errors.
- The drawing end-to-end suite passes pointer painting, undo, copying, erasing, fill, cancellation, resampling, native STYK round trips, and SVG, PIV, STK, GIF, APNG, PNG sequence and WebM export paths.
- Timeline, render, save, preparation, publication, preview lifecycle, composite and integrity browser suites pass. Timeline checks retain bounded decode queues and report no scrubbing long tasks above 50 ms on this host.
- Unit tests cover superseded decode cancellation, immutable nested definitions, distant copied keys, and raster leases protecting the old scene until publication.
- Rendered Settings and paused drawing screenshots were inspected.

## Performance comparison

Same Chrome 153.0.8010.53, 1440×1000 viewport, WebGPU, fifty drawing frames and a dense 8.4 MP cel; four-second hover, stroke and idle samples. Baseline 5f588c46 and fixed modules were served with identical cache policy. Raw profiles/results are under artifacts/drawing-release/perf-before and perf-after.

| Dense stroke metric | Before | After |
| --- | ---: | ---: |
| Renderer CPU p95 | 0.6 ms | 0.6 ms |
| Overlay CPU p95 | 0.1 ms | 0.1 ms |
| Event loop interval p95 | 9.4 ms | 9.4 ms |
| Cursor scheduling p95 | 6.6 ms | 7.1 ms |
| Resident source tiles | 34.94 MiB | 34.94 MiB |

Both runs stop scene and overlay rendering while idle and report no browser errors. The cursor difference is a single-run scheduling measurement, not input-to-photon latency. Heap samples vary with garbage collection and do not establish a memory improvement. These checks do not certify every GPU, pen driver or operating system; package and updater evidence is recorded separately for the shipped artifact.
