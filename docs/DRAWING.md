# Drawing in StykAnimate

Draw is a workspace preset in the existing editor. It uses the studio tool rail,
Properties inspector, theme, exposure sheet, clipboard, history and exporters.
Entering Draw does not change the animation. The rail's + creates a drawing
layer; otherwise select an existing visible, unlocked drawing layer.

## Workflow

- **B / E:** Brush / Eraser. Ink, Pencil, Soft and Marker presets are starting
  points; a live preview stroke in Properties reflects the current tip. Size,
  opacity, flow, hardness, pressure curves and smoothing remain editable with
  the same numeric fields and scrubbing used elsewhere.
- **[ / ]:** change brush size. **G:** fill with tolerance, expansion and gap
  closing; optionally sample visible artwork while writing only to this
  drawing.
- **L:** lasso pixels, drag to move, set scale/angle in Properties, Enter to
  apply or Escape to cancel. Copy/cut/paste uses the shared clipboard and
  Delete removes selected pixels without touching the clipboard. Timeline
  focus retains frame clipboard and frame deletion routing.
- **V:** transform the whole cel using the existing pose controls. Pixel
  selection and cel pose are distinct. **H / middle mouse / held Space:** pan. Touch pans;
  a recent pen gesture suppresses touch painting/navigation from a palm.
- Brush and Eraser retain independent tip settings. Properties contains tool
  controls; timing actions stay in the timeline. Dynamics and Resolution
  are collapsed until needed.
- New cels default to 2 pixels per scene unit; Resolution offers 1×, 2×
  and 4× and an explicit undoable resample. Pixel filtering offers Smooth
  and Nearest (pixel art) for resampling, selections and pixel paste. View rotation is temporary.
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
Sparse bounds are validated against the tile format's signed 32-bit tile
coordinates, not a dense image's dimensions. Widely separated marks therefore
remain reopenable without allocating the empty area between them.
Legacy v1 cels keep their full surface until the first pixel edit migrates
them; migration and its stroke are one undo command and pixel positions are
preserved exactly, including rotated and mirrored poses.

Layer IDs identify tracks, key IDs identify exposure boundaries, cel IDs identify
editable pixels, figure type IDs identify sprite definitions. Object UIDs stay
stable within a drawing layer. Copied keys get independent cel/definition IDs.
Copied cels share frozen tiles until an edit diverges them. Copying an evicted
cel also captures its pending undo/redo changes against the published base.
Clipboard capture
forks the store at copy time; a subsequent source edit cannot alter the
captured copy. Runtime values never enter document data. Pixel clipboard data
includes the source tiles and selection's full pixel-to-world affine pose, so
pastes preserve position, rotation and mirroring across different cel poses
without rasterizing the copy and filtering it again on paste. Older dense PNG
packets, including ones with only a world origin, remain readable. New sparse
packets require a current StykAnimate version at the destination. Aligned copies and
right-angle rotations/reflections preserve exact nonzero-alpha RGBA. Scaling
and transformed selections use a shared worker rasterizer. Paste compositing, fill and tile history run in the
drawing worker.
Lasso capture scans occupied tile rows in the pixel worker. Its even-odd polygon
describes empty selected space without a dense mask; one tile-sized coverage
buffer is reused. Fully selected tiles share the immutable cel buffers, while
partial tiles retain separate selected and remaining pixels. Bounds are prepared
in the worker too. Temporary selection surfaces use the same bounded preview
worker, mip and scratch caches as cels and participate in memory accounting,
without entering document publication. Previews never change the cel store.
Applying a selection touches only source and destination tiles; integer
translations preserve exact RGBA. Empty distance and polygon area impose no
pixel-allocation limit. Commands await the transaction, and Escape, seeking or
replacing the document discards stale capture replies and releases temporary
surfaces. Lasso input remains bounded to 8,192 vertices and the working memory
budget.

`drawing-transform.mjs` is the shared affine kernel for selection commits,
paste and resolution changes. It plans output tiles from occupied source
tiles, preflights memory and coordinate bounds, and includes filter footprints
when seeding existing destination tiles. Premultiplied bilinear sampling uses
box-filtered mip levels for reduction; nearest sampling preserves pixel-art
edges. Sampling uses a bounded source window per output tile, with sparse
lookups for extreme reductions. No full drawing rectangle is allocated during
resampling. Exact tile-aligned translations into empty destination tiles copy
bytes directly; overlapping tiles still use the same source-over sampler.
Individual jobs are limited by available working memory. Selection and resample
jobs also retain their 384 MiB ceiling; clipboard jobs use the owner's available
allowance, leaving one scratch budget for previews.

`drawing-clipboard.mjs` owns the version-2 sparse pixel packet. It transports
64×64 PNG tiles through the existing bounded native clipboard wire protocol,
reuses published PNG bytes, and encodes partial selections in the pixel worker.
The index and affine matrix seed only relevant destination tiles, including the
filter footprint, without decoding PNGs on the UI thread. Decode validates PNG
dimensions before inflation, limits concurrent streams to eight, preserves index
order and settles in-flight streams before reporting failure. No sparse-copy
limit depends on bounding-box area or distance between occupied tiles.

The exact PNG decoder feeds IDAT byte views directly to the decompression
stream, awaits input backpressure and releases both stream endpoints on failure.
Reconstruction stays in its bounded scan buffer; unfiltered RGBA rows use byte
copies and never pass through a premultiplied canvas. All five PNG filters and
8-bit RGB/RGBA remain supported. Drawing PNGs, tile blobs and native containers
share byte/base64 helpers with a portable fallback for older runtimes. File
formats, checksum checks, expected dimensions and allocation limits are unchanged.

Packet bounds remain explicit: at most 32,768 tiles, 128 MiB of PNG text and
64 KiB of encoded data per tile. Actual jobs may hit the available pixel working
budget earlier. Native wire transfers retain their 256 MiB limit and 256 KiB
chunks; the shared wire decoder has a separate 512 MiB resident allowance.
These are component allocation bounds, not a whole-process RSS guarantee.
Legacy dense clipboard PNGs retain their original 16 MP / 8192-pixel limits.

Cut publishes the complete clipboard before removing pixels. Failed writes
preserve the selection, artwork and undo cursor. Cancellation covers native
reads/writes, worker work and the final revision check; a cancelled transfer
cannot commit a cut or paste. If cancellation arrives after native publication,
the new clipboard may already be visible, but the artwork remains intact.

Fill, copy, paste, resample, selection capture and commits share one pixel transaction
gate. Save and editing commands await publication; a following pointer gesture
retains its samples until the preceding operation commits. Escape cancels the
worker, discards its late result and releases reservations. Input copying yields
every 128 tiles so preparing a large job does not monopolize the UI thread.
Whole-scene paste matches drawing and figure layer kinds, creates missing layers,
and shifts surplus destination layers together in the same undo command.

The persistent carrier is an ordinary PNG image figure so pose, anchor and
transform tooling keep working. Authored v2 cels carry a transparent 1×1 PNG;
committed pixels publish as a `styk_tiles` data URL holding a bounded blob of
per-tile PNGs. Legacy exporters flatten source tiles on demand. Unmigrated v1 cels still publish a full `data_url` PNG.
Metadata, PNG header sizes, decode bounds and CRCs are validated. Pixel content
and initial transforms hold between keys; pixel morphs and implicit crossfades
are not supported.

## Runtime and performance

`drawing-resources.mjs` owns sparse tile stores, worker jobs and disposal for
one report. Resident tiles have a 192 MiB retention target and a 768 MiB hard
working ceiling by default; accounting deduplicates
pixel buffers, so copy-on-write forks share counted bytes until they diverge.
New work reserves before it is rejected: presenter scratches free first, then
derived mip levels, then published-clean stores (which re-decode on demand),
while unpublished work is never evicted. A presenter asked for an evicted cel
kicks its re-decode itself — real failures back off behind `decodeError`
instead of retrying every frame — and v2 renderers keep their last texture or
draw nothing rather than flashing the stale 1×1 placeholder. Cold requests
coalesce into a bounded queue: at most two decodes wait, and a newer seek
supersedes the oldest.
Seeking prefetches the two unique neighbouring cels on each side of the
playhead plus the current one, queued last so it wins eviction. Thumbnails
have one worker, at most 48 queued requests and 256 small cached images;
their pump pauses while a stroke or a scrub owns the thread. Renderer GPU
drawing textures follow the current layout and are released with it.

`drawing-pixels.mjs` rasterizes real, distance-resampled samples. Stroke opacity
caps the whole stroke, while flow accumulates dabs. Pressure release cannot
remove previously deposited paint. Stabilization is a distance-windowed
weighted average of the raw path — a linear-ramp centroid over
`stabilization × 48` screen pixels of trailing path length, converted through
the cel pose and zoom at stroke start — so every input
sample yields output with no dead zone and the finish drains the tail to the
exact endpoint. Pushed points, raw or smoothed, are joined by quadratic
midpoint segments sampled by arc length, which keeps corners smooth at zero
lag. Coalesced events have an ordinary-event
fallback. Running distance and weighted sums replace repeated tail scans;
Distance sampling follows the pressure-adjusted tip diameter, including
pressure ramps, so a light stroke does not become a row of separated dabs.
the smoothing window retains at most 4,096 samples, including stationary pen
input, and release drains it in linear time. This limit affects only the
smoothing history, not the input samples sent for painting. A stroke snapshots
its pixel transform once. At most two sample batches are posted to its worker;
acknowledgments release pending real samples before the final end message.
Seed regions include the preceding curve and smoothing margin so inter-batch
movement preserves existing pixels and exact undo records.
Posted batches contain at most 512 samples, with at most two outstanding.
Input queues retain at most 65,536 samples; exceeding the working limit cancels
and rolls back the transaction. Stroke seeding follows inflated quadratic
coverage rather than the batch bounding rectangle.
A gesture queued behind a closing stroke retains its samples within that bound;
canvas publication coalesces into one animation-frame callback. Pointer
capture, cancellation,
lost capture, Escape and blur cannot leave a half-committed stroke.
Frame and structural commands wait for the closing stroke's pixel commit;
view-only navigation does not discard its final worker reply. The completed
stroke still belongs to the exposure where it started.

Pixel transactions with more than 1 MiB of expanded replacement tiles prepare
those tiles in the pixel worker before committing. The owner reserves the
complete replacement set plus one 1 MiB input batch, protects its source stores
from eviction, and validates every returned tile and its alpha bounds. The
editor then adopts the prepared buffers in one synchronous transaction. History
keeps separate, unchanged before/after buffers. Cancellation, a newer edit,
worker failure or document disposal discards the prepared set and releases its
reservation. A closing stroke retains its visible preview while preparation is
pending; saving and the next gesture wait for that transaction. Resampling
adopts the worker's already-complete pixel buffers directly.

The preparation worker reuses its transferred full-tile buffers; it expands
only compact uniform colors. The main thread's original history arrays stay
unchanged. Its lightweight entry point loads codecs and other pixel operations
on demand in the same worker, keeping their caches for later requests. A module
load failure releases that worker and rejects all pending requests so retrying
can start a fresh one. This adds no extra worker or queue.

Undo belongs to the editor's chronological history. Before/after tile records
are exact; absent sides are `null` and uniform tiles use a four-byte color
representation. Where workers and IndexedDB are available, records of at least
64 KiB move to a session-owned disk tier. Its dedicated worker encodes, hashes
and optionally compresses chunks of at most 1 MiB. Partial manifests and chunks
commit together; only a completed manifest allows RAM eviction. The hot tier
retains 16 MiB by default, and disk writes stop at 512 MiB of stored chunks.
Queued writes and pinned replays can exceed the hot retention target, but their
resident bytes and worker scratch count against the owner's working-memory
limit. A failed write preserves the exact RAM records and restores their shared
history weight. Subsequent edits use RAM history for that session.

The shared 48 MiB budget counts command metadata and records without disk
backing, across undo and redo. The existing 80-command limit still applies. An
oversized newest command remains undoable; allocation checks reject work before
changing authoritative pixels. Small warm undo stays synchronous. Cold or large
undo/redo returns a promise, pins all children of the command, loads any cold
pixel data and prepares all large replacements before applying any child.
Retired history buffers remain accounted while an outstanding replay uses them.
Cancelled or damaged reads, failed preparation and
intervening edits leave both pixels and the history cursor unchanged. Canvas,
timeline and audio shortcuts share the drawing transaction gate so saving and
the next pen gesture wait for asynchronous replay. Deferred changes on evicted cel stores
retain their own accounted pixel bytes until those stores are reconstructed.

Disk history is temporary, not a dependency of saved documents. A main-thread
Web Lock protects each session across worker restarts; new sessions reclaim
abandoned sessions only after acquiring their locks. Interrupted writes in the
same session are reclaimed when its worker reopens the database. Without Web
Locks, only explicit disposal deletes a session. Closing a document releases
its cache and worker. Native saving and recovery remain self-contained.
Desktop startup additionally clears temporary IndexedDB storage in its own
Chromium workspace session before opening the editor, because its loopback
origin changes between launches. Desktop preferences, recovery and library
data use native files; they must not be placed in this temporary database tier.

Fill, paste, resample and
thumbnails compute in workers over bounded tile regions. Lasso preview always
uses the original selection, with one resample when applied.

The pixel worker keeps a bounded per-cel cache of encoded tile PNGs. Each
publication sends pixels only for tiles whose PNG is not already trusted.
Transfers run after the synchronous editor commit in batches of at most 1 MiB,
with one batch in flight and its capacity reserved against working memory.
Partial worker replies cache exact tile PNGs; the final ordered key list
assembles the complete blob in the worker. The document's saved asset changes
only after that complete revision is ready. Missing worker-cache entries
trigger one bounded resend of retained PNGs. A legacy PNG with ancillary data
larger than a batch is re-encoded from its exact 64×64 pixels instead.
Generation, cel, revision and store-mutation checks reject stale results
between batches. Cancellation, document disposal and worker failure release
the transfer reservation. Failed
encoding retains dirty work for retry, and the publication debounce yields to
active strokes and scrubbing. A gesture's pin on its tile store ends inside
the commit, before the change broadcast — the playback/export barriers that
broadcast triggers always see the committed tiles, and pixel commits reach
the playback worker as sparse figure updates instead of full snapshots.
Exact PNG encoding/decoding avoids
premultiplication rounding in saved pixels. Encoding is derived publication,
not another edit.

The resource owner retains each cel's published blob and bounds independently
of figure snapshots. Undo/redo can replace those snapshots while encoding is
in flight. Publications reconnect to the current definition by cel identity;
save barriers and cold decode restore the same published base, including after
resampling and eviction. Uncommitted preview bounds never enter this snapshot.

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

The retained WebGPU layout refreshes drawing entries by pixel stamp and view,
including empty and previously offscreen cels, without rebuilding unrelated
scene geometry. Effects bypass views are idempotent, so render preparation
does not wrap an already prepared view and invalidate the scene each frame.
The camera's dotted outline clips its path before Canvas expands the dashes;
offscreen perimeter length therefore cannot dominate drawing at deep zoom.
See [zoom performance verification](DRAWING-PERFORMANCE.md).

Dense live cels (more than 64 tiles) use a separate preview worker. Its source
cache keeps one viewport's tiles and mip chain; tile versions identify changed
inputs. The main thread copies source tiles in bounded chunks and submits only
changed tiles on later revisions. At most three cel requests wait behind the
active job. Completed ImageBitmaps share the scratch budget; eviction and
disposal close them. Stale replies are discarded, and a failed source revision
backs off until pixels change. WebGPU retains an existing texture while its
replacement is prepared. Small cels use the synchronous dirty-region path.
Cold previews may take longer in wall time than synchronous rasterization,
but input is not blocked by their mip calculation. Worker source/preview working
sets are included in resource reservations. Source tiles, resident drawing
history and deferred pixel records share the owner reservation limit. Encoded
document strings, other editor history, browser overhead and GPU allocations
remain separate memory categories; these budgets are not a process-RSS limit.

Thumbnail mip generation also runs in the worker. Playback/export providers
count source tiles, mip tiles and scratch canvases in their retained bytes and
release derived resources on eviction. Decode rejects tile counts beyond the
available provider memory before allocating pixel buffers.

## Saving, reuse and exports

Native save, recovery, close/save, shared clipboard, library capture, playback,
thumbnail snapshots and exports wait for committed pixel publication. Existing
revision checks and atomic file replacement remain authoritative. Recovery
captures committed work; active uncommitted gestures are not recovery entries.
Nested movieclip scope changes flush before snapshotting and dispose child
runtime resources on exit. Replacing a document disposes abandoned workers.

STYK keeps editable drawing metadata, layers, timing and exact raster pixels.
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
`tests/drawing-stroke.browser.mjs` covers the worker stroke pipeline,
`tests/drawing-render.browser.mjs` covers visible-tile rendering and seams,
`tests/drawing-save.browser.mjs` covers save/reload/recovery fidelity and
`tests/drawing-timeline.browser.mjs` covers cache bounding and the
drawing-free-document overhead contract.
Browser tests exercise native codec reopening, pixel fidelity, nested scopes,
fill/selection/resample history, clipboard, both renderer paths and encoders.

Mouse/browser checks and deterministic pressure tests do not certify physical
pen drivers, input-to-photon latency or every GPU. Tilt, vector strokes and
resolution-independent drawing are outside this implementation. Fill regions
are bounded to 64 megapixels and follow stage plus artwork bounds, independently
of zoom. Scanline fill keeps tiled source/output pixels, bounded masks and a
bounded span stack, with a fast path for uniform regions. Cancellation terminates
the worker and the next operation starts a fresh worker. New clipboard packets,
sparse lasso capture, resampling and transformed paste output are bounded by
occupied tiles and available memory instead of a
dense bounding-box limit. The embedded tile-blob and native-container limits
remain separate persistence constraints.

The September implementation audit, measured changes and remaining parity
gaps are recorded in [the audit follow-up](DRAWING-IMPLEMENTATION-AUDIT.md).

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
