# Drawing in StykAnimate

Draw is a workspace preset in the existing editor. It uses the studio tool rail,
Properties inspector, theme, exposure sheet, clipboard, history and exporters.
Entering Draw does not change the animation. The rail's + creates a drawing
layer; otherwise select an existing visible, unlocked drawing layer.

## Workflow

- **B / E:** Brush / Eraser. Ink, Pencil, Soft, Marker, Nib, Airbrush,
  Charcoal and Liner presets are starting points; each defines the whole tip.
  A live preview stroke in Properties reflects the current tip. Size,
  opacity, flow, hardness, pressure curves and smoothing remain editable with
  the same numeric fields and scrubbing used elsewhere. **Tip** sets
  roundness, angle (fixed, following the stroke direction, or following pen
  tilt), spacing, scatter and grain; **Dynamics** maps pressure to size,
  opacity and flow. **Painting** chooses the blend mode (Normal, Behind,
  Multiply, Screen, Overlay, Color) and **Lock alpha**, which recolours
  existing paint without covering empty pixels.
- **Assist:** mirror painting across the stage's vertical and/or horizontal
  centre (Shift+M toggles horizontal). Shift-click draws a straight line from
  the previous stroke's end; Alt-click (Brush, Fill) picks the visible colour;
  Ctrl-drag resizes the brush. **M** flips the view horizontally to check
  proportions; like view rotation it is temporary and never changes pixels.
- **[ / ]:** change brush size. **G:** fill with tolerance, expansion and gap
  closing; optionally sample visible artwork while writing only to this
  drawing.
- **L:** select pixels by lasso, rectangle, ellipse or magic wand (tolerance,
  gap closing and optional all-layer sampling). Shift adds to the selection,
  Alt subtracts; a click without dragging deselects. Brush strokes and fills
  stay inside the selection outline. Ctrl+A selects everything reachable,
  Ctrl+Shift+I inverts, Ctrl+Shift+A deselects and Shift+Backspace fills the
  selection with the current colour. Drag inside the selection to move its
  pixels, set scale/angle in Properties, Enter to apply or Escape to cancel.
  Copy/cut/paste uses the shared clipboard and Delete removes selected pixels
  without touching the clipboard. Timeline focus retains frame clipboard and
  frame deletion routing.
- **V:** transform the whole cel using the existing pose controls. Pixel
  selection and cel pose are distinct. **H / middle mouse / held Space:** pan. Touch pans;
  a recent pen gesture suppresses touch painting/navigation from a palm.
- Brush and Eraser retain independent tip settings. Properties contains tool
  controls; timing actions stay in the timeline. Dynamics and Resolution
  are collapsed until needed.
- New cels default to 2 pixels per scene unit; Resolution offers 1×, 2×
  and 4× and an explicit undoable resample. View rotation is temporary.
  Neither zoom nor stage resizing resamples ink.

All shortcut bindings are configurable in the existing shortcut preferences.
**A** creates a blank at the playhead inside a hold, or a next blank after
its exposure at an existing key. It affects only the active drawing layer in
both Simple and Advanced timelines, including the Animate workspace.
**Shift+A** extends the exposure. There is no additional F5 extension
command. **F7** inserts a blank key; Copy here has no extra default shortcut.
The timeline toolbar offers Blank frame and Next copied drawing; the context
menu offers Blank here and Copy here. Next actions insert one frame by default
and shift later keys on targeted layers. Copy here and Blank preserve later timing. Multi-layer commands validate
all targets before publication. Unrelated layers keep their timing.

Painting anywhere in a hold edits its owning cel. Painting a blank exposure
creates a cel; its creation and first stroke undo together. Painting beyond a
layer end requires an explicit key first. Erasing everything retains the key.
Drawing rows carry a brush icon, DRAW badge and tinted exposure spans; wide
exposures display small cel thumbnails. Existing onion settings apply, with
key mode sampling distinct neighboring drawing exposures. Frame mode keeps
its explicit frame-based sampling.

## Document contract

`report._styk.layers.byId[id].drawing` is `{version: 1}`. Drawing layers contain
at most one drawing image object per exposure. `_styk.drawing` on its figure
contains `{version, celId, pixelsPerUnit, revision, bounds}` at version 2, or
`{version: 1, celId, width, height, pixelsPerUnit, origin, crop, revision,
empty}` for unmigrated cels. Version 2 pixels live in a sparse 64×64 tile store
with unbounded coordinates; the store is the single authoritative raster and
`bounds` is the occupied-pixel bounding box. Painting allocates only touched
tiles; strokes may cross the stage edge and negative coordinates freely.
Legacy v1 cels keep their full surface until the first pixel edit migrates
them; migration and its stroke are one undo command and pixel positions are
preserved exactly, including rotated and mirrored poses.

Layer IDs identify tracks, key IDs identify exposure boundaries, cel IDs identify
editable pixels, figure type IDs identify sprite definitions. Object UIDs stay
stable within a drawing layer. Copied keys get independent cel/definition IDs.
Copied cels share frozen tiles until an edit diverges them. Clipboard capture
forks the store at copy time; a subsequent source edit cannot alter the
captured copy. Runtime values never enter document data. Pixel clipboard data
includes the selection's world origin, so pastes land at the same world
position. Aligned, unscaled copies preserve exact RGBA; scaling and transformed
selections resample once. Paste compositing, fill and tile history run in the
drawing worker.
Whole-scene paste matches drawing and figure layer kinds, creates missing layers,
and shifts surplus destination layers together in the same undo command.

The persistent carrier is an ordinary PNG image figure so pose, anchor and
transform tooling keep working. Authored v2 cels carry a transparent 1×1 PNG;
committed pixels publish as a `styk_tiles` data URL holding a bounded blob of
per-tile PNGs, plus a derived `data_url` PNG over the occupied bounds for
legacy consumers. Unmigrated v1 cels still publish a full `data_url` PNG.
Metadata, PNG header sizes, decode bounds and CRCs are validated. Pixel content
and initial transforms hold between keys; pixel morphs and implicit crossfades
are not supported.

## Runtime and performance

`drawing-resources.mjs` owns sparse tile stores, worker jobs and disposal for
one report. Resident tiles are limited by a budget scaled from device memory
(192–768 MiB; the hard ceiling for unpublished work is at least 768 MiB);
accounting deduplicates
pixel buffers, so copy-on-write forks share counted bytes until they diverge.
New work reserves before it is rejected: presenter scratches free first, then
derived mip levels, then published-clean stores (which re-decode on demand),
while unpublished work is never evicted. A presenter asked for an evicted cel
kicks its re-decode itself — real failures back off behind `decodeError`
instead of retrying every frame — and v2 renderers keep their last texture or
draw nothing rather than flashing the stale 1×1 placeholder. Cold requests
coalesce into a bounded queue: at most two decodes wait, and a newer seek
supersedes the oldest. Once publication finishes, clean stores above the
budget are trimmed farthest from the playhead first — distance over every
drawing layer, measured circularly because playback and scrubbing loop — then
least recently used, keeping the cel at the playhead. Reserving room for new
work evicts in the same order. Strokes
adopt tiles without reserving, so this is what bounds memory after painting.
A cold decode is split across a small pool of codec workers by 8×8-tile blocks;
each block owns its mip tiles up to level 3, so every shard also builds its
mip levels and the cel arrives display-ready at any zoom.
Seeking prefetches the two unique neighbouring cels on each side of the
playhead plus the current one, queued last so it wins eviction. Thumbnails
have one worker, at most 48 queued requests and 256 small cached images;
their pump pauses while a stroke or a scrub owns the thread. Renderer GPU
drawing textures follow the current layout and are released with it.

The selection is a pixel mask on one cel (the outline). It clips stroke
coverage in the worker and confines fills; moving, scaling or rotating
selected pixels floats them into a separate preview derived from the outline,
committed as one undo step. An untransformed float shows the exact stored
pixels, and the transformed preview composites on a CPU-backed canvas so
repeated previews are byte-identical.

The stroke path (stabilization, curve joining and dab spacing) runs on the
main thread in `StrokePath`, so every dab's extent is known before dispatch:
each batch seeds the stroke worker with exactly the tiles its dabs reach, and
the worker refuses a dab outside its seeded tiles rather than painting over a
blank guess. Symmetry feeds each mirrored sample into its own path so mirrored
strokes keep even spacing while sharing one coverage buffer and undo step.
At most one dab batch is in flight: while the stroke worker is busy, dabs
accumulate and leave with its reply, so a brush slower than the pointer never
queues stale work. Samples arrive through `pointerrawupdate` where available,
and an idle worker takes a batch immediately instead of at the next frame.
Dabs accumulate stroke coverage only; colour is composited once per batch over
each tile's dirty span, since it depends only on final coverage, the pixels
the stroke first saw and the blend mode. Soft falloff uses a per-stroke
lookup table indexed by squared distance.
`drawing-pixels.mjs` rasterizes real, distance-resampled samples. Stroke opacity
caps the whole stroke, while flow accumulates dabs. Pressure release cannot
remove previously deposited paint. Stabilization is a distance-windowed
weighted average of the raw path — a linear-ramp centroid over
`stabilization × 48` source pixels of trailing path length — so every input
sample yields output with no dead zone and the finish drains the tail to the
exact endpoint. Pushed points, raw or smoothed, are joined by quadratic
midpoint segments sampled by arc length, which keeps corners smooth at zero
lag. Coalesced events have an ordinary-event
fallback. A gesture queued behind a closing stroke retains every sample;
canvas publication coalesces into one animation-frame callback. Pointer
capture, cancellation,
lost capture, Escape and blur cannot leave a half-committed stroke.

Undo belongs to the editor's chronological history. Before/after tile records
are exact; absent sides are `null` and uniform tiles use a four-byte color
representation. The shared 48 MiB budget accounts for both undo and redo. An
edit larger than the remaining budget evicts the oldest commands until it
fits; only an edit larger than the whole budget is rejected before mutation.
Evicted stores do not require an asynchronous history cursor: records apply
synchronously to whatever store the cel resolves to. Fill, paste, resample and
thumbnails compute in workers over bounded tile regions. Lasso preview always
uses the original selection, with one resample when applied.

The pixel worker keeps a bounded per-cel cache of encoded tile PNGs. Each
publication sends pixels only for tiles whose PNG is not already trusted,
plus the ordered key list the blob must carry; cached PNGs fill the rest, and
missing cache entries trigger exactly one resend. Blob assembly happens in
the worker; large publications are encoded in parallel by the codec pool and
adopted into that cache. Tiles are PNG-encoded synchronously by
`zlib-sync.mjs` (greedy LZ77 with one dynamic-Huffman block; plain or
adaptively filtered rows, whichever LZ77 can reuse more of), and decoded with
its table-driven inflate; per-tile compression streams cost more in setup than
the work itself. Larger images keep the native streams. The blob format and
PNG bytes stay standard, so older files and other readers are unaffected. Generation, cel and revision checks reject stale results. Failed
encoding retains dirty work for retry, and the publication debounce yields to
active strokes and scrubbing. A gesture's pin on its tile store ends inside
the commit, before the change broadcast — the playback/export barriers that
broadcast triggers always see the committed tiles, and pixel commits reach
the playback worker as sparse figure updates instead of full snapshots.
Exact PNG encoding/decoding avoids
premultiplication rounding in saved pixels. Encoding is derived publication,
not another edit.

Live drawing textures participate in the normal scene compositor, including
ordering, opacity, erasing, camera and clipping. Tiles are painted into
tile-anchored scratch canvases; each presenter keeps a bounded LRU of them,
and a request contained in an already-painted cover reuses it without
repainting, so zooming inside a painted region and alternating WebGPU/Canvas
anchors never share or thrash one canvas. Each scratch tracks its own pending
dirty rect; WebGPU uploads those dirty regions and Canvas draws the scratch
once. Mip levels escalate to 8 (256×) so coverage of any span fits the
texture limit, and the scratch clamps to that limit around the visible span
as a final guarantee — a drawing is never rejected for size. Overlays contain only cursor and selection
feedback. Canvas and SVG use smooth drawing filtering; imported Pivot sprites
retain their existing sampling.

## Saving, reuse and exports

Native save, recovery, close/save, shared clipboard, library capture, playback,
thumbnail snapshots and exports wait for committed pixel publication. Existing
revision checks and atomic file replacement remain authoritative. Recovery
captures committed work; active uncommitted gestures are not recovery entries.
Nested movieclip scope changes flush before snapshotting and dispose child
runtime resources on exit. Replacing a document disposes abandoned workers.

STYK keeps editable drawing metadata, layers, timing and exact PNG bytes.
PIV/STK provide visual sprite compatibility, not editable drawing-layer semantics.
SVG embeds raster artwork. Image sequences, GIF, APNG and WebM use the existing
frame renderer and encoders. External images remain images; there is no implicit
rig conversion or vector tracing.

## Evidence and limits

Run `node --test tests/drawing.test.mjs`, `node tests/drawing.browser.mjs` and
`node scripts/benchmark-drawing.mjs` with the local app at port 47839 (or set
`STYK_URL`). See [verification report](../artifacts/drawing/VERIFICATION.md).
The pan, expansion and shortcut refinements have a separate regression suite:
`node tests/drawing-ux.browser.mjs`; see its [report](../artifacts/drawing-ux/VERIFICATION.md).
`tests/drawing-tools.browser.mjs` covers selection shapes and modes, clipped
painting and fills, the magic wand, symmetry, straight lines, colour picking,
brush resizing, view flipping and alpha lock through real input,
`tests/drawing-stroke.browser.mjs` covers the worker stroke pipeline,
`tests/drawing-render.browser.mjs` covers visible-tile rendering and seams,
`tests/drawing-save.browser.mjs` covers save/reload/recovery fidelity and
`tests/drawing-timeline.browser.mjs` covers cache bounding and the
drawing-free-document overhead contract.
Browser tests exercise native codec reopening, pixel fidelity, nested scopes,
fill/selection/resample history, clipboard, both renderer paths and encoders.

Mouse/browser checks and deterministic pressure tests do not certify physical
pen drivers, input-to-photon latency or every GPU. Pen tilt steers tilt-mode
tips only; vector strokes and resolution-independent drawing are outside this
implementation. Fill regions
are bounded to 16 megapixels; history rejects a noncompressible edit that
exceeds its byte budget.

## Camera zoom quality and the road to vector ink

The sparse tile engine keeps scene dimensions, drawing resolution, editor zoom
and camera zoom as separate contracts. Choose resolution before drawing: 2×
uses four times the pixels of 1×, and 4× uses sixteen times as many. For a
raster shot, source pixels per scene unit should cover the maximum camera
magnification multiplied by the export scale. Upscaling an old cel smooths its
existing samples; it cannot recover lost detail.
[Canvas image smoothing](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled)
controls filtering, not the amount of source detail. Exports always render
the authoritative source tiles at output resolution; preview mip levels never
substitute for them.

Raster tiles — including the sparse allocation, copy-on-write cel sharing,
visible-tile streaming and bounded caches the format now provides — remain
the right representation for Soft and textured paint. For arbitrarily deep
zooms, the recommended next step is a hybrid drawing layer:

- Store Ink and Pencil as editable pressure-aware vector paths, rasterized or
  tessellated at the required view/export scale in workers. Keep the existing
  layer sheet, cel ownership, commands, clipboard and save pipeline. Bound the
  derived geometry cache by scale and revision. Vector artwork can scale without
  the source-resolution limit of bitmap ink; see [SVG](https://developer.mozilla.org/en-US/docs/Web/SVG).
- Keep Soft and textured paint as raster tiles alongside the vector layer,
  sharing the same sparse world coordinates and streaming path.
- Design vector erasing, fill boundaries and mixed vector/raster compositing as
  explicit document semantics, including undo and backward-compatible export.
  Existing cels remain raster; tracing would be an optional, lossy operation.

These are proposed follow-up changes, not capabilities of the current raster cel
format. Implementing a second standalone drawing workspace would lose the shared
editing and animation behavior this integration preserves.
