# Layers and frames

The **Audio** icon opens shared [audio editing](AUDIO.md), hidden by default.
Advanced places sound tracks under animation layers with one ruler, playhead,
zoom and scroll area. Its footer follows the selected animation cell or audio
clip. Simple opens an Audio tab in the filmstrip area. Closing audio editing
restores animation space while sound keeps playing. The existing timeline resize
handle and Expand control provide more room in either mode.

Waveform clips support source trimming, split/copy/paste, volume, fades and
mute/solo. Audio uses seconds and snaps to the current frame rate. Explicit
Ripple follows whole-scene time insertion/removal; single-layer pose edits
leave audio timing intact. Drag clips between tracks (Shift preserves time),
or drop onto the new-track row to create a destination in the same undo step.

The Advanced timeline is an exposure sheet. Each row is a persistent user layer; each cell is one output frame. A scene frame is the complete vertical column. The Simple filmstrip displays the combined scene at the union of layer key times. Switching views changes no animation data and creates no working-frame or property-channel overlay.

Camera's disclosure collapses its motion lanes while retaining the camera keyframe row. A collapsed Camera shows the motion count. The control supports Enter/Space and Left/Right; collapsing affects only the view and survives edits and undo. Selecting a motion reveals its lanes again.

Select a layer to keep its contents selected while scrubbing, including when its contents change or disappear. Add or paste figures into that layer. Multiple figures and movieclips can share a layer. Layer order controls stacking. Rename by double-clicking the name; drag names or use the arrows to reorder. Eye and lock controls affect visibility and editability. Deleting a layer removes its contents and is undoable.

| Action | Shortcut |
| --- | --- |
| Previous / next frame (scene frame in Simple) | , / . |
| Jump to previous / next keyframe on the selected layer (scene frame in Simple) | Shift+, / Shift+. |
| Extend keyframe by one output frame | Shift+A |
| Remove selected frames | Shift+F5 |
| Insert a pose key | F6 |
| Duplicate current pose into the following cell | Ctrl+Enter |
| Clear key boundary | Shift+F6 |
| Delete selected frames | Delete |
| Copy / cut / paste layer frames | Ctrl+C / X / V |

Click a cell to select it; Shift extends the selection. Double-click a held or empty cell to insert a key, or use the inline plus on the selected cell. Double-click a key to select its exposure. Drag from an unselected cell, including a key, to select a range. Drag an already selected range to retime it; Alt copies. Drag the exposure's right edge to change its duration. Drag between rows to transfer a frame range. Pasting replaces the destination range; Simple Paste inserts a complete scene range. Same-layer frame copies retain figure identities. Cross-layer or cross-project copies allocate distinct instance identities once per copied range. External attachment parents are not accidentally copied as new figures.

A Hold span displays one pose. Editing a held cell edits its preceding key; press A first to make a new pose. Choose “Insert blank keyframe” in the frame menu to intentionally clear the layer. Add Frame inserts a key at the selected cell; when every selected layer already holds a key there, it instead duplicates the current pose into the following cell and shifts later keys. A key placed beyond a layer's end carries its last exposure forward to reach it. Blank cells draw as outlined spans with open-circle keys. Simple mode duplicates all scene layers, including Camera and Scene. Each duplication is one undo step. Choose Linear or an easing curve to interpolate between keys. An edit within a tween creates a key at the playhead. Camera and Scene tracks are always visible above the figure layers, each with its own color and icon. Frame menus contain frame operations; layer menus contain naming, visibility, locking and layer operations. Delete and Cut remove time rather than authoring blank cells.

Simple Add frame copies the current complete scene to the end. The green slider below each preview changes its inbetweens. The Inbetweens field applies to all selected scene frames, and Tweening (or a double-click on a preview) opens the easing controls, including editable Bezier curves. These edits change all layers together. Edits made in either view are visible immediately in the other.

Apply camera to figures preserves the projected pose at the selected sheet keys.
Those new poses participate in the layer's interpolation, so neighboring tweens
can change. Native save and Pivot export reproduce the resulting sheet animation.

## Document and compatibility

**Settings > Animation > Timeline > Replace keyframes on drop** is enabled by
default and saved with editor preferences. Turning it off blocks occupied
destinations when dragging or Alt-dragging keys within a layer.

Dragging selected keys onto existing keys replaces keys at their exact landing
frames on the same layer. Incoming poses and easing win; intervening keys survive.
Alt-drag copies follow the same rule. Overlapping selections are captured before
replacement, and one Undo restores both source and overwritten keys. This follows
[Adobe Premiere's keyframe replacement behavior](https://helpx.adobe.com/sa_en/premiere/desktop/add-video-effects/control-effects-and-transitions-using-keyframes/edit-keyframes-graphs.html).

`_styk.layerSheet` owns the duration and every layer's ordered key sequence. Keys have stable cell IDs and either a retained pose reference (or explicit blank) or an imported source time. Figure `unique_id`, layer ID, cell ID, and pose-source ID are different identities. Changing time never allocates a figure identity.

Imported spans are evaluated through an immutable compatibility baseline, retaining native holds, automatic easing and old authored curves. Only affected endpoints are captured when a span changes. This avoids copying a whole imported animation for one edit. Old native poses, unknown fields, and legacy curve data remain available for reading and native-project saving. They are not a second authoring surface.

The former property-row Advanced component, per-figure movieclip bars, old Simple component, and separate authored-key navigation strip have been removed. The public timeline module names now export the replacement components. Legacy reader/projection regression fixtures live under tests and are not loaded by the app.

Every edit plans and validates its result before publication, then records one undoable change. Clipboard transfers and movieclip commands group their constituent changes. Rendering, playback, thumbnails, SVG/image/video export and Pivot materialization sample `evaluatedFrame`. Native STYK files retain editable layer data. Pivot export samples the resulting scene in the export worker because Pivot has one scene-wide frame sequence.

The grid renders visible rows and columns only. Pose history stores affected sources and shares unchanged tracks. Imported source evaluation is shared between layers sampling the same time. The Fig 107 diagnostic (`scripts/verify-layer-import.mjs`, using the local decoded fixture) checks duplicate identities, geometry evaluation and exact undo on 194 imported native frames / 3,782 historical instance IDs.

Filmstrip cards own their event listeners and preview markers. Eviction releases
both, prunes queued work, and rejects late results for replaced cards. Hidden
mounts defer preview work and reveal the selected frame at their first visible
layout; subsequent renders preserve deliberate scrolling. The focused regression
is `node tests/sheet-filmstrip.browser.mjs`.

The timeline uses the studio's icons, fields, menus and color tokens. Figure and movieclip Properties include a Layer selector. Scrubbing coalesces pointer positions to one seek per display frame, paints the playhead separately, and retains the grid and layer DOM. Unchanged imported poses retain native object identities for geometry reuse. `scripts/benchmark-layer-scrub.mjs` measures imported and edited-layer seeking against the native evaluator.

## Verification

- `node --test tests/layer-sheet.test.mjs tests/layer-movieclips.test.mjs`
- `node tests/layer-timeline.browser.mjs` with the local server running
- `node tests/layer-timeline-modern.browser.mjs`
- `node tests/timeline-polish.browser.mjs`
- `node tests/movieclip-commands.browser.mjs`
- `node --test tests/*.test.mjs`
- `node scripts/check.mjs`

The browser test performs real cell/keyboard interactions, mode switches, and binary STYK/PIV export-import comparisons. Model tests cover ownership, connected figures, blank spans, easing, history, clipboard assets, scene/camera editing, movieclip clocks and legacy import.

The browser also checks key and cross-layer dragging, layer reordering, rename, locks and compact layouts. Regression cases cover exact-cell inspector ranges, imported segment-style repair after rig edits, blank Camera/Scene cells, camera baking, and Stick Nodes projects containing nested movieclips.

The polish checks exercise the green sliders, multi-frame inbetweens, preset and custom easing, menu contents and keyboard dismissal, opening-frame insertion, cut, exact undo, and keeping the current scene frame selected when earlier timing changes.

Behavior references: [Adobe frames](https://helpx.adobe.com/animate/desktop/animation/frames-keyframes.html), [Pivot frames](https://www.pivotanimator.net/help5-2/animation_frame_controls.htm), [Stick Nodes movieclips](https://sticknodes.com/new-version-3-0-0-the-movieclip-update/).

## Timeline organization and compact layout

Advanced uses the existing transport header for Add Frame and a direct
Simple/Advanced segmented switch. Extra view commands live in the ruler context menu. There is no persistent bottom command/status bar.
A floating bottom-right zoom control serves both modes. Layer ordering remains
available by dragging rows and through the layer commands.
Audio clip controls open from the audio toolbar. Audio selection hides
frame-authoring controls; switching back to frame cells restores them.

Find layers filters user rows by case-insensitive words; Camera, camera motions
and Scene remain available. Focus selected layers retains a fixed set of user
rows until cleared. Both are view-only, do not change canvas visibility or undo,
and reset on document load. Escape clears search/focus; Ctrl/Cmd+F from the grid
focuses search. Selecting a filtered-out layer from another editor surface reveals
it by clearing the filter. New layers are revealed too. Frame operations use only
visible selected layer IDs; filtered-out rows are not implicit edit targets.

Layer context menus offer saved color tags, focus and rename. Colors use validated
optional layer metadata and sparse undoable commands; they never change rendering
or frame data. Dragging above/below a user row shows the corresponding insertion
edge. F2 renames a visible selected layer. The layer-name divider supports arrow
keys (Shift for larger steps), Home and double-click reset.

Ctrl/Cmd-wheel zooms around the pointer; slider zoom retains viewport center.
Timeline indexing creates lazy key descriptors. Filtering traverses lightweight
layer descriptors only; painting and row DOM remain viewport-bounded.

Checks: `node --test tests/timeline-organization.test.mjs` and
`node tests/timeline-organization.browser.mjs`, plus the existing layer timeline
and audio navigation browser regressions. Browser artifacts are written to
`artifacts/timeline-organization/`.

### Contextual easing and view navigation

Double-click an Advanced keyframe dot or Simple frame thumbnail to change easing.
Right-click > Change easing preserves multi-frame selection. Advanced applies the
curve to the selected layers' outgoing keys (including the exposure containing
the range start). Simple retains its whole-scene boundary isolation. Each apply
is one undo step. Both use the same preset/custom Bezier editor; locked selections
cannot apply changes. Advanced has no persistent easing selector; Simple also exposes easing in its
left sidebar.
Inbetween sliders remain duration controls, independent of easing.

Middle-button drag pans without changing selection or document data. The floating
zoom control changes Advanced time scale or Simple thumbnail width; Simple audio
uses that same variable frame-to-pixel mapping. Ctrl/Cmd-wheel zooms at the pointer.
Simple cards retain viewport eviction and fixed, bounded thumbnail resolution.
The contextual regression is `node tests/timeline-context.browser.mjs`.

### Onion range and thumbnail lifetime

Before/After are fixed output-frame distances from the playhead. Seeking,
pending scrubs, panning, zooming and document boundaries never change these
preferences. The ruler handles sit at `playhead - before` and `playhead + after`
and move with it. Their positions are not pinned to authored keys or document
edges. Only the visible projection clips at the timeline viewport. No additional
onion toolbar or row is inserted above the ruler.

Handles can be dragged outward to increase a distance or inward to decrease it.
The settings panel provides numeric fields, single-frame minus/plus buttons and
label scrubbing, including when a handle is outside the viewport. Both use eight
pointer pixels per output frame, or 32 with Shift held when the gesture starts.
Movement below one step does nothing. Timeline zoom and authored key spacing
never change sensitivity. Handles support arrow keys and Home (zero).

Sampling selects output frames or authored keys inside the requested range,
respecting sample spacing and available document poses. It never rounds outward
to a neighboring key. Only sample counts shrink near the document edges; the
stored values, displayed values and visual offsets stay fixed. Ranges have no
ten-frame cap. Simple mode uses the same settings panel without a ruler overlay.

`onion-range.mjs` owns the cached document index and range/sample calculations.
`onion-controller.mjs` owns the sole transient preference session. Ruler handles
and `onion-frame-field.mjs` share `onion-range-drag.mjs`: displacement is measured
from a fixed start, previews do not persist, and release commits once. Escape,
pointer cancellation, blur, seeking, document edits and view disposal clear the
session. A superseded view cannot commit another view's preview. Onion edits
never enter document history. Native slider cancellation also suppresses its
trailing release/change event.

`onionRangeBefore`/`onionRangeAfter` store output-frame spans. The controller
interprets legacy Before/After values as fixed distances (including their saved
spacing), independent of document/key spacing, and persists the explicit pair
on the first range/sampling edit.
Colors and other settings retain their values. The renderer and views share the
same range calculation; the geometry cache retains the active sample range or
its 24-entry warm budget, whichever is larger, and shrinks when the range
contracts. Eviction occurs after evaluating a batch so a large active range
cannot evict its own samples during opacity adjustment.

Verification: `node tests/onion-timeline-range.browser.mjs`,
`node tests/onion-controls.desktop.mjs`, and the `onion-controller`,
`onion-timeline-range`, `onion-skin`, `onion-layer-sheet`, and `onion-performance`
unit tests. Desktop coverage includes native 75%, 100%, 150%, and 200% UI scaling.

Audio tracks share the timeline's existing scroll area. Opening audio or adding
tracks preserves the user's timeline height; resizing remains a manual action.

Simple thumbnails retain up to 32 rendered canvases (7.5 MiB of pixel storage),
independent of the viewport's card DOM. Cache eviction releases canvas storage.
Returning to recent frames copies cached pixels without worker rendering. Pixel
changes conservatively invalidate the cache; audio and layer label/color/lock
changes do not. Cancellation retries use a 120 ms to 2 s bounded backoff and stop
when paused/disposed. A separate render target prevents late results from painting
stale cards. Document synchronization and rendering remain in ThumbnailRenderer's
single worker; the UI yields between results. See THUMBNAIL-PERFORMANCE.md.
