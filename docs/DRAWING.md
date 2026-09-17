# Drawing in StykAnimate

Draw is a workspace preset in the existing editor. It uses the studio tool rail,
Properties inspector, theme, exposure sheet, clipboard, history and exporters.
Entering Draw does not change the animation. The rail's + creates a drawing
layer; otherwise select an existing visible, unlocked drawing layer.

## Workflow

- **B / E:** Brush / Eraser. Ink, Pencil, Soft and Marker presets are starting
  points; size, opacity, flow, hardness, pressure curves and smoothing remain
  editable with the same numeric fields and scrubbing used elsewhere.
- **[ / ]:** change brush size. **I:** sample the active drawing's color and
  return to Brush. **G:** fill with tolerance, expansion and gap closing;
  optionally sample visible artwork while writing only to this drawing.
- **L:** lasso pixels, drag to move, set scale/angle in Properties, Enter to
  apply or Escape to cancel. Copy/cut/paste uses the shared clipboard. Timeline
  focus retains frame clipboard routing.
- **V:** transform the whole cel using the existing pose controls. Pixel
  selection and cel pose are distinct. **H / middle mouse / held Space:** pan. Touch pans;
  a recent pen gesture suppresses touch painting/navigation from a palm.
- Brush and Eraser retain independent tip settings. Properties contains tool
  controls; timing actions stay in the timeline. Dynamics and Raster quality
  are collapsed until needed.
- New cels default to 2 pixels per scene unit; Raster quality offers 1×, 2×
  and 4×, current pixel dimensions, and an explicit undoable resample.
  View rotation is temporary. Neither zoom nor stage resizing resamples ink.

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
contains `{version, celId, width, height, pixelsPerUnit, origin, crop, revision,
empty}`. Origin is the logical upper-left before posing; crop describes pixel
bounds. Painting grows the uncropped surface around the visible view, with
space for the brush tip. First strokes allocate around the pointer, independently
of stage dimensions. Integer offsets preserve exact pixels and shifted sprite
anchors preserve placement, including rotated and mirrored poses. Growth and
its stroke are one undo command. No paint-boundary rectangle is shown.

This is expandable raster storage, not an infinite tiled canvas. Format limits
are 16,777,216 pixels and 8,192 pixels per axis; the 96 MiB editing cache currently
allows at most 12,582,912 resident pixels including the canvas. When the entire
zoomed-out viewport cannot fit, growth targets the pointer area. A stroke that
would cross the remaining boundary is cancelled with guidance rather than
silently clipped. Oversized history requests preserve existing work.

Layer IDs identify tracks, key IDs identify exposure boundaries, cel IDs identify
editable pixels, figure type IDs identify sprite definitions. Object UIDs stay
stable within a drawing layer. Copied keys get independent cel/definition IDs.
Immutable PNG strings and immutable pending tiles may initially be shared.
Clipboard capture snapshots pending pixels at copy time. A subsequent source
edit cannot alter the captured copy. Runtime values never enter document data.
Pixel clipboard data includes the drawing origin, so expanded cels paste into
blank frames without shifting or cropping artwork. Aligned, unscaled copies
preserve exact RGBA; scaling and transformed selections resample once. Paste
compositing and tile history run in the drawing worker.
Whole-scene paste matches drawing and figure layer kinds, creates missing layers,
and shifts surplus destination layers together in the same undo command.

The persistent carrier is an ordinary PNG image figure. Authored empty cels may
use a valid transparent 1×1 PNG until pixels are published. Metadata, PNG header
sizes, decode bounds and CRCs are validated. Pixel content and initial transforms
hold between keys; pixel morphs and implicit crossfades are not supported.

## Runtime and performance

`drawing-resources.mjs` owns decoded surfaces, pending tile replacements, worker
jobs and disposal for one report. The decoded pixel+canvas cache is limited to
96 MiB; committed pending tiles to 96 MiB. Dirty pixels survive decoded eviction.
Cold requests coalesce into a bounded queue. Thumbnails have one worker, at most
48 queued requests and 256 small cached images. Renderer GPU drawing textures
follow the current layout and are released with it.

`drawing-pixels.mjs` rasterizes real, distance-resampled samples. Stroke opacity
caps the whole stroke, while flow accumulates dabs. Pressure release cannot
remove previously deposited paint. Coalesced events have an ordinary-event
fallback. A cold-start gesture retains at most 256 samples; canvas publication
coalesces into one animation-frame callback. Pointer capture, cancellation,
lost capture, Escape and blur cannot leave a half-committed stroke.

Undo belongs to the editor's chronological history. Before/after RGBA tiles are
exact; uniform tiles use a four-byte color representation. The shared 48 MiB
budget accounts for both undo and redo. Evicted surfaces do not require an
asynchronous history cursor: immutable replacement tiles apply synchronously.
Fill and paint-area growth compute pixels and PNG data in workers. Growth
results are checked against document revision and gesture lifetime; cancelled
or stale growth cannot publish an asset or leave input locked. Lasso preview always uses
the original selection, with one resample when applied.

The encoder receives immutable PNG+tile snapshots, never an actively painted
canvas. Generation, cel and revision checks reject stale results. Failed encoding
retains dirty work for retry. Exact PNG encoding/decoding avoids premultiplication
rounding in saved pixels. Encoding is derived publication, not another edit.

Live drawing textures participate in the normal scene compositor, including
ordering, opacity, erasing, camera and clipping. WebGPU uses affine textured
quads and dirty rectangle uploads; Canvas uses the same drawing resource.
Overlays contain only cursor and selection feedback. Canvas and SVG use smooth
drawing filtering; imported Pivot sprites retain their existing sampling.

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
Browser tests exercise native codec reopening, pixel fidelity, nested scopes,
fill/selection/resample history, clipboard, both renderer paths and encoders.

Mouse/browser checks and deterministic pressure tests do not certify physical
pen drivers, input-to-photon latency or every GPU. Tilt, textured brushes,
vector strokes, resolution-independent drawing and infinite tiled storage are outside
this implementation. Large selections still require a bounded full editing
surface; history rejects a noncompressible edit that exceeds its byte budget.

## Camera zoom quality: recommended next architecture

The current fixes remove nearest-neighbor blocks and offer more source pixels.
Choose resolution before drawing: 2× uses four times the pixels of 1×, and 4×
uses sixteen times as many. For a raster shot, source pixels per scene unit
should cover the maximum camera magnification multiplied by the export scale.
Upscaling an old cel smooths its existing samples; it cannot recover lost detail.
[Canvas image smoothing](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled)
controls filtering, not the amount of source detail.

For deep zooms, the recommended next step is a hybrid drawing layer:

- Store Ink and Pencil as editable pressure-aware vector paths, rasterized or
  tessellated at the required view/export scale in workers. Keep the existing
  layer sheet, cel ownership, commands, clipboard and save pipeline. Bound the
  derived geometry cache by scale and revision. Vector artwork can scale without
  the source-resolution limit of bitmap ink; see [SVG](https://developer.mozilla.org/en-US/docs/Web/SVG).
- Retain Soft and textured paint as raster tiles in sparse world coordinates.
  Allocate occupied tiles, stream visible tiles and export through bounded tiles.
  This supports much larger scenes without allocating empty space between marks.
- Design vector erasing, fill boundaries and mixed vector/raster compositing as
  explicit document semantics, including undo and backward-compatible export.
  Existing PNG cels remain raster; tracing would be an optional, lossy operation.

These are proposed follow-up changes, not capabilities of the current raster cel
format. Implementing a second standalone drawing workspace would lose the shared
editing and animation behavior this integration preserves.
