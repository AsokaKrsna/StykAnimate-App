# GPU drawing residency and brush

On WebGPU, drawing cels are displayed from GPU-resident tiles and brush and
eraser strokes are rasterized on the GPU in the frame that receives input.
The CPU `TileStore` remains the only authoritative raster: history, saving,
publication, recovery, clipboard, fill, selection and export are unchanged.
`src/drawing-gpu.mjs` owns both halves; the renderer and the drawing
controller use it through narrow calls.

## Display

`DrawingGpu` keeps one storage-buffer pool of 64×64 straight-alpha RGBA8
slots. Committed level-0 tiles are uploaded when their `TileStore` version
changes, so copy-on-write forks that share tile objects share slots. Reduced
levels are exact integer box reductions of the level below, byte-identical to
`drawing-raster.mjs` mips. The display level follows the scratch path's rule
(`floor(-log2(screen pixels per source pixel))`, levels 0–8).

Each visible tile is one instanced quad. The fragment shader premultiplies
and bilinearly filters texels through the tile's 3×3 neighbourhood, so tile
seams never appear at any zoom or rotation. Transparent neighbours of
occupied tiles are drawn as halo instances so filtering fades past the last
tile instead of stopping at its edge. Opacity, hiding, drag offsets,
parallax, clipping and layer order come from the existing retained layout.

The pool grows by doubling up to its budget (512 MiB, capped by the device's
storage-buffer limits, which the renderer requests up to 1 GiB) before it
evicts least-recently-used slots. A slot used by the frame being encoded or
pinned by a stroke is never reused. At most 2,048 tiles upload per frame; a
reduced level whose children are not ready keeps drawing its previous content
and the renderer schedules another frame. An evicted CPU store keeps drawing
its last resident tiles until its decode completes.

`TileStore` keeps a bounded per-consumer log of changed tile keys (set,
delete, in-place `writable()` and `clear()`). The GPU state consumes it each
frame and invalidates only the reduced ancestors of changed tiles; an
overflow or replaced store rebuilds that cel's levels. Presentation refreshes
without pixel changes therefore cost nothing on the GPU path.

The brush, reduction, alpha-bounds and display pipelines compile
asynchronously after the renderer starts, and again ahead of an antialiasing
change; drawing uses the scratch presenter and stroke worker until
`renderer.gpuDrawingReady` settles. Compiling on first use stalled the first
stroke after launch by over 100 ms in Electron.

Onion skins, selection previews, cels with drawable effects and the Canvas 2D
renderer keep the scratch-canvas and worker-preview presenter described in
[DRAWING.md](DRAWING.md). `renderer.setGpuDrawing(false)` switches a WebGPU
renderer to that presenter for diagnostics and fallback tests.

## Brush

`DabRecorder` runs the existing `DrawingStroke` path code — smoothing,
quadratic curve sampling, spacing, pressure curves and texture jitter — and
records dab shapes instead of rasterizing them. `GpuStroke` groups each
frame's dabs by touched tile in order. A compute shader evaluates the CPU
brush formula per pixel over those ordered dabs, carrying coverage between
frames, and writes into private overlay slots that the display reads instead
of the committed tiles. Positions are relative to a stroke origin so single
precision stays exact across unbounded cel coordinates.

At pen-up the remaining dabs are dispatched, a second compute pass finds each
touched tile's nonzero-alpha bounds, and the tiles are read back. Read-back
processing yields to input every 8 ms. It produces the same exact
before/after history records as a worker stroke plus detached replacement
tiles; `adoptDrawingPreparation()` wraps them in the existing validated,
pinned and memory-accounted preparation, so the commit adopts them without a
worker round trip. Committed tiles then take over the overlay slots that
already hold their bytes, so nothing is uploaded again.

Escape, blur, document replacement and lost capture discard the overlay
without history. A GPU failure — including running out of GPU memory
mid-stroke — replays the recorded pixel-space samples (bounded at 65,536) on
the stroke worker, which then commits normally. The stroke worker also
remains the brush for the Canvas 2D renderer.

GPU and CPU brushes differ only in floating-point width: across ink, soft,
textured pencil with pressure opacity, marker, eraser, sub-pixel and
stabilized strokes, every channel matches within one 8-bit step and at most
0.7% of touched pixels differ (`tests/drawing-gpu.browser.mjs`).

## Measurements — 22 September 2026

AMD Ryzen 5 5500, NVIDIA GeForce RTX 4070 SUPER, Windows 11, Node 24.11.0,
headless Chrome 153 at 1440×1000. `tests/drawing-latency.browser.mjs` sends
mouse input at 240 Hz through Chrome's input pipeline along a four-second,
ten-row zigzag. After each render it reads back the stroke region; a sample
counts as visible when its dab centre shows the brush colour. Latency runs
from the event timestamp to that render. Both builds are measured with the
same script after a warm-up stroke; read-back costs apply to both. This is not
display scanout or physical pen latency.

| Scenario | Baseline p50 / p95 / p99 | GPU p50 / p95 / p99 | Pen-up to commit |
| --- | ---: | ---: | ---: |
| 8 px brush, blank 1080p cel at 2× | 22 / 43 / 89 ms | 6.5 / 16 / 33 ms | 64 → 68 ms |
| 48 px brush, dense 1080p cel at 2× (2,040 tiles) | 30 / 71 / 173 ms | 6.6 / 18 / 71 ms | 101 → 85 ms |
| 300 px brush, same dense cel | 1,632 / 3,180 / 3,269 ms (54% shown) | 7.1 / 11 / 16 ms | 7,309 → 102 ms |
| 48 px brush, dense 4K cel at 2×, 25% zoom (8,160 tiles) | 66 / 152 / 197 ms | 7.8 / 14 / 21 ms | 298 → 142 ms |
| 8 px brush over 500 figures | 25 / 42 / 115 ms | 7.5 / 16 / 20 ms | 96 → 103 ms |

Headless Chrome paced frames at about 70 Hz, so one frame is about 14 ms. In
this matched run the GPU build recorded mid-stroke main-thread tasks of 77 ms
(blank cel) and 74–113 ms (dense 48 px), which explain its 71 ms p99; the
baseline recorded none. They coincide with the benchmark's per-frame canvas
read-back, which waits for the GPU. Two immediate repeats of both scenarios,
and CPU profiles of the same strokes without read-back, recorded no task over
50 ms (p50 6.2–8.3 ms, p99 11–22 ms). Their cause is not otherwise confirmed.

`tests/drawing-gpu.desktop.mjs` repeats the latency method in the Electron
39.8.10 runtime (Chromium 142) from a clean profile, after one warm-up stroke:
all 602 samples of a 2.5-second, 240 Hz stroke appeared, at p50 7.7 ms, p95
12.7 ms and p99 15.5 ms, with frames paced at about 8 ms; the stroke committed
through the GPU brush without the worker fallback
(`artifacts/drawing-gpu/desktop-result.json`).

The Canvas 2D fallback keeps the worker brush and measured within run-to-run
variation of the baseline: p50 23 / 36 / 55 ms against 24 / 36 / 50 ms for the
blank, dense and 500-figure scenarios. Raw results are in
`artifacts/drawing-latency/final/`.

### Animation workflow

`tests/drawing-workflow-latency.browser.mjs` builds a 24-frame 1080p drawing
layer at 2× (25 pressure strokes per cel, about 1,000 tiles each) with a
per-frame marker colour, and times each command until a render shows that
frame. Both builds ran back to back on a loaded workstation, so absolute times
are higher than in quieter runs; see `artifacts/drawing-workflow/`.

| WebGPU | Baseline | GPU residency |
| --- | ---: | ---: |
| Flip to a resident drawing, p50 / p95 | 249 / 451 ms | 23 / 47 ms |
| Flip to an evicted drawing, p50 / p95 | 968 / 1,112 ms | 23 / 33 ms |
| Scrub at 24 fps: frames shown before the next seek | 2% | 100% |
| Undo / redo of a 300 px stroke | 122 / 163 ms | 75 / 91 ms |
| Fill click on a frame evicted by memory pressure | click ignored | 337 ms to commit |

An evicted cel is shown from its still-resident GPU tiles while its CPU store
decodes; the retained image is discarded if history changes that cel first.
When memory pressure evicts a published store, the GPU notes the slots that
hold its exact tiles. Reopening that cel for editing reads them back instead
of decoding PNGs, keeps each tile's published PNG bytes, and re-adopts the
slots, provided every slot is still intact and the published base revision
matches; deferred history then applies as usual. Otherwise the cel decodes,
now with the in-place tile inflater described in [DRAWING.md](DRAWING.md).
A load that a pointer is waiting on overtakes queued display and prefetch
decodes and is never superseded by them; only the decode already running
finishes first. In the cold-edit measurement this took the fill from 843 ms to
337 ms after the click (297 ms on Canvas 2D).
A saturated pool — here 24 dense cels filled the 512 MiB budget — evicts
full-resolution tiles first, so restores favour recently shown cels. Three alternating 12-frame Canvas 2D runs measured warm
flips of 224–267 ms against 265–347 ms for the baseline and cold flips of
820–962 ms against 952–1,178 ms, so the fallback did not regress.

The workflow benchmark also exposed a controller defect present in the
baseline: a click or tap released while its cel was still loading was
discarded, because the browser's routine loss of pointer capture after
release was treated as a cancellation. Fill clicks on evicted cels did
nothing. Only a cancellation before release now abandons the pending gesture.

Profiling the pen-up window found and removed four costs that would otherwise
stall after every stroke: re-uploading tiles already on the GPU, rebuilding
every reduced level after a presentation-only refresh, hashing the published
tile blob as shared renderer artwork on each relayout, and re-rasterizing the
Properties brush preview whenever the inspector refreshed.

## Limits

Headless measurements on one workstation do not establish behaviour on other
GPUs, drivers or physical tablets. The pool's upper bound is GPU memory in
addition to the CPU drawing budgets. The GPU brush's pixels can differ from
the worker brush by one 8-bit step, so the renderer in use can change the
least significant bit of committed paint; history, saving and reopening
preserve whichever bytes were committed exactly. Publication, playback
preparation and cold cel decoding still run through the existing workers;
editing an evicted cel waits for its decode.
