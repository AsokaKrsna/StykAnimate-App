# Desktop architecture

StykAnimate separates the editable Pivot document, background work, and presentation. Changing the renderer or transport should not change file semantics or editor commands.

## Document and commands

`startup-document.mjs` supplies the one-frame Bubble project used by application startup and File → New. Its native rig has a hip root, symmetric limbs, a poseable head, and static attached facial and extremity details. `demo.mjs` retains the separate legacy animation fixture.

`editor.mjs` and its builder/range extensions operate on native figure IDs, object UIDs, segment record order, joins, media tables, and keyframes. History records affected state. Selection, editor visibility/locks, viewport transforms, and renderer caches are distinct from animation data. Shared definition edits propagate through instances and remain undoable. Rig topology traversals avoid recursive stack growth and repeated full-tree scans.

Build Figure presentation lives in `builder-mode.mjs`, `builder-outliner.mjs`, and `builder-workspace.css`. The side toolbar retains its layout, with Chain pen beside Line; commands use the existing dispatcher. `builder-toolbar.mjs` owns the top bar’s native popover menus: bounded viewport placement, focus return, arrow navigation, type-ahead, and dismissal. Its session-scoped listeners are released on exit; commands continue through the existing delegated dispatcher. The bar exposes nine controls, including two direct flip buttons, and adapts labels to its available width. Selection gating and checked menu states remain in the builder controller. `builder-context-menu.mjs` supplies joint, branch, fill and empty-canvas menus shared by canvas and hierarchy right-clicks; the controller bounds targets to the current session and routes fill/branch commands through existing editor methods. Context-menu pages reuse the app menu and restore focus to their source. Builder entry hides the timeline until its footer toggle is expanded; leaving restores the animation layout without overwriting saved panel sizes. The outliner uses iterative hierarchy traversal and fixed 30 px virtual rows, observes viewport resizing, and only replaces row markup when it changes. Canvas selection reveals collapsed ancestors; keyboard navigation, accessible tree state, and keyboard resizing share the same row model. Drag exclusion covers the full descendant set, including malformed cycles.

`src/pivot/` holds the established evaluation, validation, background and geometry semantics. Incremental geometry carries changed object slots without retaining a chain of prior scenes. A live whole-figure drag retains its geometry and changes only per-object GPU translations; the model commits the final coordinates once. Joint/rig edits update affected objects and joined descendants.

Evaluated native segment records also supply the ordered drawable list. Geometry consumers treat these shared records as immutable. Opacity-only frame changes retain exact joints and rebind appearance metadata; renderers can retain opaque group artwork and apply the fade after compositing. Worker packets traverse object groups without flattening the scene. These are derived caches, independent of saved poses and history.

Prepared playback distinguishes worker readiness from GPU readiness. A bounded startup window uploads one packet per animation frame and waits for its GPU queue before advancing. Expensive preparation may increase the window from one tenth to one quarter of a second of animation, capped by the existing core-dependent queue and actual cache residency. Later rendering retains normal cache eviction and exact tick order. Cancelled startup cannot publish a stale queue completion.

Figure insertion, clipboard paste and decoded library drops share the range command planner. Validation and identity allocation finish before publication; undo retains inserted definitions and affected poses rather than the destination library. Published movieclip documents are immutable: clipboard/history copy the figure shell and retain that captured animation. Entering a clip clones its document; committing nested edits publishes a replacement. Imported external documents receive their own copy. Canvas pose commits retain the exact gesture preview when membership and playback settings are unchanged.

Movieclip presence clocks on ordinary layer sheets use a temporary projection containing only instance identities, playback descriptors and continuation records. The existing sheet sampler handles blank spans, remapped native time and frame replacements; the clock never interpolates unrelated joints or builds artwork. The derived index is reused across seeks and invalidated with document edits. Legacy authored channels and inherited movieclip sources retain the general evaluator. `tests/movieclip-membership.test.mjs` compares projected membership with that evaluator and traps reads of unrelated pose arrays.

See [copy/paste and insertion verification](performance/INSERTION-PERFORMANCE.md) for measurements on the dense Akane scene and the remaining verification limits.

Native connector and Smart Stretch relationships use the shared geometry evaluator,
an iterative cached dependency plan and sparse editor commands. Connector midpoint
positions reuse length channels; there is no second pose graph. Build Figure owns
setup UI and a detached pose tester. See [rig contracts and verification](RIG-CONSTRAINTS.md).

## Import and native codec

Electron reads selected source files through its isolated bridge. A persistent loopback codec process uses the supplied PIV/STK readers and writers. The app-specific modern reader bulk-unpacks numeric arrays and omits obsolete scalar-edit binding allocations. Optional `orjson` accelerates large response encoding; the standard-library path remains available. This does not replace the binary grammar.

The import worker performs fetch/JSON parsing. `document-transport.mjs` transfers bounded document fragments rather than cloning one entire expanded scene into the UI. Its default packet estimate is 256 KiB with a 3 ms preparation budget and receiver acknowledgments. Large strings, pose arrays and records are split; unknown fields and numeric values remain intact. The same transport supplies playback snapshots and native document exports.

The backend source/document cache has 24 entries and a 384 MiB budget. Source imports are limited to 128 MiB; decoded/native documents to 256 MiB. A native document is retained once because it already contains original source bytes. These are cache/input limits, not a promise that total application working set stays under those values. See [backend contract](../backend/README.md).

## WebGPU and prepared playback

`renderer.mjs` compiles root-local line, circle and polygon records into GPU storage buffers. WGSL performs primitive coverage, color gradients, transforms and clipping. Object translation/opacity/visibility are separate records. Cached compatibility textures preserve complex Pivot compositing at the object boundary, including glyph paths, sprites, outlines and isolated opacity. They have a 4,096-pixel dimension cap, so extreme zoom has a finite detail limit. The complete scene is not flattened into one texture.

`playback-worker.mjs` evaluates exact native ticks, compiles typed primitive packets, and rasterizes compatibility objects with OffscreenCanvas. `playback.mjs` and `prepared-frames.mjs` hold bounded CPU and GPU packet LRUs. Their hardware-based retention targets and related pixel-cache allocations are defined in `playback-budget.mjs`; an individual worker packet uses a smaller allowance to leave upload headroom. Each GPU packet uploads once; cached playback binds retained buffers and submits without main-thread scene evaluation or tessellation. Document revisions and resource/device changes invalidate the relevant caches; retained scene geometry is rebuilt for any figure definition a patch replaces, and decoded drawing stores only serve their own revision, so incremental mirror updates never render superseded tiles or bounds. Missing packets hold the transport for preparation rather than silently skipping native output ticks. A crashed playback worker pool is replaced on its next use and reloads the document; one document revision allows two consecutive restarts without a delivered packet, so a scene that reliably crashes the worker reports its error instead of restarting in a loop. Background assets and the editor renderer have separate lifetimes.

Compatibility textures are cropped to the camera-visible stage with a sampling guard, preserving their original pixel grid and individual figure identities. Raster resolution is rounded once, after applying the native camera to the physical viewport scale. Zoom changes update worker view options without retransmitting an unchanged document. Advanced ruler scrubbing keeps one editable preparation in flight through canvas submission and coalesces newer pointer positions to the latest requested tick. The ruler displays the pending pointer target; the editor retains the tick of the scene being prepared. Release forces the exact final seek. Inspector refreshes and thumbnail work wait until scrubbing finishes.

An oversized prepared packet is retried with lower raster detail. The editable renderer also plans its active texture set before allocation; original geometry, handles and image assets remain intact. See [Adaptive preview memory](ADAPTIVE-PREVIEW.md) for source-image copies, cancellation, cache allocations, full-quality export, validation and remaining browser/format limits. A scene that cannot fit even its minimal records or decode through the available runtime can still fail; sampled corpus success does not establish coverage of every frame in a large imported project.

The virtualized timeline draws visible exposures and labels, with a separate playhead. Scrubbing uses cooperative editable geometry and renderer preparation to preserve selection handles and onion skins; frame-local changes can update the playback worker mirror without retransmitting every keyframe. The editor schedules rendering when state changes or playback runs, with no permanent idle rendering loop. See [renderer details and benchmarks](renderer.md).

## Thumbnail worker synchronization

Image-only preview workers use `image-resources.mjs` for encoded sources, crop
selection, decoded variants, byte accounting and disposal. Playback extends
that same image owner with drawing tiles and vector/raster caches in
`playback-resources.mjs`; image decoding does not import the geometry evaluator
or create rendering caches. Diagnostics retain one completed image job, not a
history of requests. `tests/image-resources.browser.mjs` verifies decoding with
the geometry module unavailable, exact pixels, reuse, cancellation and residency.

`thumbnail-renderer.mjs` and playback share the retained-source comparison and
validated patch contract in `playback-patch.mjs`. Unchanged historical poses and
figure definitions remain in the thumbnail worker; edits send source additions,
replacements and deletions with changed native frames and render metadata.
Definition edits explicitly dirty source poses because legacy commands can repair
them in place. Legacy background tables still accompany thumbnail patches.

Transfers are acknowledged in chunks of at most 64 KiB with a 2 ms construction
target. The worker validates the complete patch before publishing it. The main
thread updates its reference mirror only after the matching revision's ACK;
uncertain source IDs survive cancellation, including an edit undone while its
worker commit is awaiting acknowledgement. Pauses resume staged chunks, while
document edits discard stale staging. Replacement documents, native frame topology
changes, worker failures and idle disposal use the full snapshot fallback.
The existing eight-request bound and filmstrip bitmap cache remain the owners of
queued work and displayed previews. Source mirrors clear when their worker dies.
See [Randombattle measurements](performance/RANDOMBATTLE-PERFORMANCE-2026-09-15.md) and
`tests/thumbnail-patch.test.mjs`, `tests/thumbnail-source-patches.browser.mjs`.

## Saving, recovery and exports

Audio has its own immutable document state, editor commands and bounded mixer
worker. Both timeline views share its clip UI; Web Audio schedules preview and
the existing FFmpeg service muxes an offline mix into video. Prepared scene
snapshots omit recordings. Native project saving retains original audio bytes.
See [Audio architecture and verification](AUDIO.md) for timing, codecs and limits.

`DocumentExporter` receives the live report directly. Calling `editor.serialize()`, `structuredClone(report)`, or `JSON.stringify(report)` first would reintroduce a full UI pause. Bounded snapshots reach a dedicated worker, which normalizes the document, validates it, serializes it, and requests native output. Only derived keyframe-object `runtime_segments` caches are omitted. A revision change or active edit aborts the snapshot; recovery is rescheduled after the next idle period. Native STYK stores original source bytes and digest metadata so unchanged source export remains possible after a backend restart.

The worker returns a Blob. `native-files.mjs` writes or reads it through acknowledged 256 KiB IPC chunks, without whole-file ArrayBuffer/base64 conversion. Desktop main stages output and atomically replaces the destination only after completion. Cancellation preserves the previous file. Recovery uses the fixed desktop profile; browser recovery uses IndexedDB. See [document export contract](document-exports.md).

`ExportFrameRenderer` receives bounded document chunks and evaluates/rasterizes export frames in a worker. Current-frame images, sequences and videos use this shared path, including No smoothing, Smooth edges and supersampled Smooth sprites. SVG retains paths and embedded raster assets. Animation image compression, GIF quantization and ZIP assembly run in an encoding worker with one source frame in flight. Document replacement or cancellation stops the rendering job.

Desktop video streams PNG frames in acknowledged chunks to the bundled FFmpeg encoder. VP9 WebM preserves transparency; MP4/AVI/WMV use Pivot's black matte. The browser has an opaque WebCodecs VP8/VP9 fallback with exact timestamps and a local muxer. Windows AVI can instead stream BGR24 to isolated 32-bit/64-bit helpers using genuine installed VFW compressors and their configuration dialogs. Capability probing describes the actual provider, codecs, alpha behavior and limits; no hosted encoder is required. See [export formats](EXPORT-FORMATS.md), [image exports](image-exports.md) and [installed Windows codecs](WINDOWS-CODECS.md).

## Workspace and desktop boundary

The canvas header contains workspace modes, scene properties and undo/redo. View
controls (guides/grid, VFX, joints, paths and zoom) sit at the bottom-right of the viewport.
Figure effects can isolate joined descendants through a render-only container;
see [Effects and connected figures](VFX.md) for scope, draw-order and timing rules.
The left tool rail has a divided stacking group: normal clicks move to front/back,
and Shift-click moves one step. These use the existing selection-order command.
Normal right-click opens a short menu for the hit figure or an empty-stage menu;
clicking a selected figure preserves multi-selection. More figure actions holds
less frequent commands. Shift + right-drag retains joint bending; Held R handle
editing can use the same modified secondary gesture. Escape closes menus and
returns focus, and pointer-down outside dismisses them before another gesture.

Custom HTML/CSS provides compact editable controls, native keyboard/text behavior and a consistent neutral palette. The animation scene uses the custom GPU canvas. Layers, Properties and Timeline can float, move, resize and redock without changing the document. `initWorkspaceLayout({preferences,onPersist})` restores normalized geometry; settled changes are debounced and asynchronous writes are ordered. `flushPreferences()` lets close/tests await the last write.

Electron uses context isolation, sandboxed renderer code, and no renderer Node globals. Native IPC exposes specific file/stream/window/preference operations, not arbitrary filesystem commands. Workspace preferences live in a fixed, atomically written user-data JSON file capped at 16 KiB. They and recovery survive a restarted process even though its loopback origin changes.

`desktop/web-host.cjs` owns the desktop's loopback origin. It streams public web
assets asynchronously while `desktop/backend.cjs` starts the Python codec in
parallel. `/api/` requests use the same origin and stream through a bounded
16-request proxy with backpressure and four separate cancellation slots; pending
requests do not buffer their uploads.
Closing a client releases its proxy slot, and quitting aborts both pending codec
startup and the running child. Codec failure leaves WebGPU editing, Undo/Redo,
native project saving and local native reopening available. Pivot/STK conversion
still requires the codec. Import/export controllers own an opaque job identity
and send cancellation independently of their worker. The proxy also cancels
disconnected requests over a separate bounded control connection pool. Python
admits one heavy request at a time before reading its body, with at most 16
active/queued requests; health and cancellation bypass that queue. Cooperative
checks in decode, validation, fingerprint and writer loops release cancelled
work, and source-cache publication is ordered against cancellation. Individual
native/standard-library operations finish before the next check. Browser development
continues to use the Python server's static host.

Windows source execution and packaged snapshots are verified. A distributable includes the frozen codec sidecar, current web assets, source grammar, and licenses. Rebuild and verify the package after source changes; earlier smoke reports do not certify newer bytes. macOS/Linux targets require their own builds and actual platform verification.

## Canvas guides and grid

`src/canvas-guides.mjs` owns a fixed-size DOM overlay and a popover. It does not
modify document poses, history, renderer caches or export surfaces. The vertical
X and horizontal Y guides have independent visibility, scene-pixel inputs,
edge-handle dragging, arrow-key nudges (Shift: 10 pixels), Escape cancellation,
and a shared lock. Positions are clamped to the scene and stored as proportions
in editor preferences, so they adapt when a different canvas size is loaded;
these are workspace aids rather than per-project animation data. Numeric fields
reuse `PropertyControls` for drag adjustment (Shift/Alt for finer steps), direct
typing and Escape rollback. Live previews stay local; release commits preferences.

The grid clips to the visible stage and uses CSS gradients. Its configured cell
size stays in scene pixels; at low zoom the displayed step doubles until at least
eight screen pixels apart. Rendering uses a constant number of DOM elements,
skips inactive aids, and skips unchanged layout writes. Aids hide during playback
and preview. Grid spacing, opacity, guide visibility, positions and locking use
the existing normalized settings persistence. Guide edits do not dirty projects.
See `tests/canvas-guides.browser.mjs` for UI verification.

## Reproducible evidence

| Concern | Command | Report |
| --- | --- | --- |
| Prepared UI playback/drag | `node tests/renderer-ui-performance.mjs --fps=60` | `artifacts/renderer-ui-performance-60fps.json` |
| Native imported-rig edits | `node tests/renderer-edit-profile.mjs "path/to/project.piv"` | `artifacts/renderer-edit-profile/report.json` |
| Whole-app edit/autosave scheduling | `node tests/edit-freeze-profile.mjs "path/to/project.piv"` | `artifacts/edit-freeze-<project>/report.json` |
| Source-bearing save/restart/export | `node tests/document-export-browser.mjs "path/to/project.piv"` | `artifacts/document-export-browser*.json` |
| Exact native file streaming | `npm run test:streams:desktop` | `artifacts/native-streams-smoke.json` |
| Workspace process restart | `npm run test:preferences:desktop` | `artifacts/desktop-preferences-smoke.json` |
| Sampled prepared raster corpus | `node tests/renderer-corpus.mjs --prepared` | `artifacts/renderer-corpus-prepared/summary.json` |

The UI tests use the local development server; profile scripts accept `STYK_URL`. Artifacts name the fixture, phase, timing scope, and observed limitations. Long-task absence, total job duration, CPU submission, GPU completion, and display latency are separate measurements.

## Interface scale and settings

Settings → Animation → Playback includes “Fit view when playback starts”, enabled
by default. Disabling it preserves the current canvas zoom and pan on transport
start. The preference persists through the existing editor settings store.

`src/ui-scale.mjs` owns the 75%–200% presentation range, five-percent steps,
normalization, and application through the narrow desktop `setUIScale` preload
API. `EditorSettings` persists `uiScale` through the existing editor preferences
store and reapplies it at startup. Old or invalid preferences default to 100%.
Electron uses native page zoom so layout, pointer coordinates, viewport sizing,
and device-pixel ratio stay in the same coordinate system. No document data,
canvas view scale, undo history, or export dimensions are changed.

The browser preview keeps browser-native zoom controls; it does not substitute
CSS transforms that would desynchronize interactive editor coordinates.
`src/settings.css` owns the panel presentation, including scrollable content and
compact navigation at narrow logical viewport widths. Native slider keyboard
behavior, labeled outputs, tab navigation, and Escape dismissal are preserved.
Verify with `node --test tests/ui-scale.test.mjs` and
`node tests/settings-scale.desktop.mjs` (isolated profile, process restart,
canvas pointer alignment, light/dark and compact screenshots).

`settings.css` also owns shortcut-editor styles; `HotkeySettings` must not inject
CSS into the settings stylesheet link. Shortcut state and binding validation stay
in `hotkey-settings.mjs` / `hotkeys.mjs`, with persistence owned by `EditorSettings`.
Settings feedback actions forward their category to the shared `FeedbackUI` draft;
the sidebar Donate action uses the existing `openDonate` desktop bridge. Neither
is part of tab navigation. `node tests/settings-tabs.desktop.mjs` verifies shortcut
editing, canvas controls, feedback categories, the donation callback, and responsive
light/dark layouts without submitting feedback or visiting payment pages.

### Construction gestures

`builder-construction.mjs` owns the transient chain draft and a figure-scoped spatial index. Joint and sampled-midpoint candidates use a balanced k-d tree; sorted coordinate/length tables supply axis and equal-length targets. Tolerance stays in screen pixels, with point hysteresis and an Alt bypass. Rig gestures snapshot the index once and exclude the edited branch. Snapping changes position, not connectivity: starting at a native joint attaches the new branch; snapping an endpoint onto another joint does not weld handles or introduce cycles.

New builder segments inherit colour and thickness from their native parent handle, including per-instance style edits; explicit thickness arguments take precedence. Chain links carry these values forward. Origin-attached segments retain the default thickness of 8 and the figure's first segment colour (new figures use purple).

Drawing previews snapshot inherited colour and world-space width at gesture start and scale with canvas zoom; zero-width construction lines retain a thin guide. Builder Edit and joint context menus copy the primary selected joint’s displayed paint (including gradients and opacity) and thickness into an app-local clipboard. Paste reuses the existing selection/branch style command as one undo step, preserving topology, shape, rig properties and draw order. Explicit multi-selection targets only those joints.

The chain pen creates no document commands while clicking. Enter, double-click or Finish calls `Editor.addSegments` once. Backspace removes the last point; Escape, tool/session changes, external document edits and the chain context menu cancel the draft. Preview paths rebuild only when points or zoom change. The persisted `builderSmartSnapping` preference is UI state, absent from exported artwork.

Append and rig commands use sparse definition snapshots: history contains appended records or explicitly changed segment indices, plus the existing affected source-pose journal. Unchanged segment references exist only during the synchronous command and never enter its history payload. Origin-support figures retain the full topology repair path. New-figure creation journals a definition splice rather than copying the complete definition table. Geometry invalidation retains unrelated objects while rebuilding every instance and joined dependent of the edited definition; IK, movieclip and slot-remapping cases retain conservative invalidation.

`builder-duplicate-preview.mjs` caches a high-contrast branch silhouette, including circle and polygon fills, in one bitmap capped at 2048 × 2048 pixels. Pointer movement translates the bitmap and queries its joint index. Placement preserves the existing duplicate command's native topology and undo behavior; cancellation drops the bitmap and index. See `docs/performance/BUILDER-PERFORMANCE.md` for measurements and limits.

Builder node selection uses transient native handle IDs scoped to one object UID; Shift-click toggles those IDs in the canvas and hierarchy. Explicit multi-selection style edits target exactly those segments, with a single undo entry; single-node branch editing retains its existing scope. Builder Delete dispatches to segment/branch or selected-fill commands even under Select, so it cannot accidentally remove and recreate the session object. Selection is restored with command history and does not enter the saved figure format.

`builder-fill.mjs` caches directed-edge region discovery by evaluated geometry in a WeakMap. Polyfill Shift-click uses closed line/curve outlines whose native endpoints coincide; dangling strokes are removed from face discovery. Crossings without joints do not create boundary connections, and compound holes are not generated. A preview shows the exact proposed region before committing one native `addPolygon` command. Direct interior clicks select the topmost visible fill in the builder figure, with joints taking precedence; fill color, opacity, order and deletion reuse the existing polygon commands.

## Raster drawing integration

Drawing layers use the ordinary layer-sheet and image-figure contracts.
`editor-drawing.mjs` supplies commands; `drawing-resources.mjs` owns transient
surfaces and worker publication; `drawing-controller.mjs` owns pointer gestures.
`drawing-view.mjs` extends the shared inspector primitives and tool rail.
Pixel history participates in the existing command stream and its shared
undo/redo byte budget. See [drawing ownership and workflow](DRAWING.md).
