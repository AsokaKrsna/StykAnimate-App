# StykAnimate changelog

The source of truth for release notes. Add completed work to Unreleased; move it into a new highest version when preparing a release. See docs/RELEASING.md for the format and checks.

History starts with existing 0.5.5 metadata, with overlapping feedback instructions consolidated. Earlier evidence remains in docs/RELEASE-0.2.0.md and docs/RELEASE-0.3.0.md; this file does not infer missing release history or publication dates.

## [Unreleased]

### Added

- Try experimental AI-assisted posing in a standalone playground with front, profile and angled views, trained body and limb guidance, automatic standing-foot support even after releasing pins, chest-led crouches, controlled depth-based limb shortening, stable limb lengths and bounded neck motion, supported native vector characters, persistent controls, undo, saved studies and editable StykAnimate export.
- Attach solid meshes to spatial rigs with continuous rotation and named forms, using existing posing controls, undo, native saving and rendered exports without adding a joint for every vertex.

- Attached head drawings can switch in discrete directions as a spatial rig turns or tilts, with one Form selector for transformations and no blending between drawings.

- Spatial rigs can preserve authored silhouettes during turns with four or eight smoothly connected reference views on solid shapes, using the existing rotation controls, animation and native saving.
- Animate close-up kicks and punches on spatial rigs with optional perspective, toward-camera limb controls, and adjustable part size, length, width and taper. Controls support pose keys, undo and native saving; perspective is available for single spatial figures.
- Pose spatial character rigs with ordinary joint dragging, three-axis rotation rings, a turn/tilt pad and named drawing or expression selectors. Form and view selectors share the posing panel's field styling and alignment. Rotate the entire character together with its planted targets, or plant feet as the hips move, steer planted knees and elbows directly, or rotate a limb to release its pin and carry its hand or foot. Free feet and hands follow their shin or forearm; direct joint shortcuts select each limb articulation. Joint dragging preserves depth and repeated target drags retain their bend plane. Poses use the existing timeline, IK, undo and native saving.
- Blend multiple rig anchors with editable weighted joints, so connected surfaces can share articulation controls and projected axes.
- Draw and animate on dedicated drawing layers backed by a sparse tiled raster engine: brush presets with pressure and textured pencil, erasing, fill, onion skin and pixel selection you can copy, cut and delete. Unchanged cels share tiles copy-on-write, strokes rasterize in workers, only visible tiles render with mip-level filtering, changed tiles publish incrementally, and older PNG drawings migrate on first edit. Pan while painting, create blank drawing frames with A, paint beyond the stage, and choose higher-resolution strokes using the shared timeline, undo, saving and export tools.
- Attached 3D heads and other solid meshes can keep a hand-tuned shape for each viewing direction, blending smoothly as the character turns, so a head holds its drawn look from the side and back as well as the front.
- Shape brushes like a real painting app: flat and angled tips that can follow the stroke or your pen's tilt, scatter and grain, pressure-controlled flow, blend modes (Behind, Multiply, Screen, Overlay, Color), a smudge brush that drags and mixes wet paint, and Lock alpha for recolouring line art. New Nib, Airbrush, Charcoal, Liner, Blender and Oil presets join Ink, Pencil, Soft and Marker.
- Select pixels with rectangles, ellipses and a magic wand as well as the lasso, add with Shift or subtract with Alt, and paint or fill only inside the selection. Drag selected pixels to move them, or drag the on-canvas corner and rotate handles to scale and turn them (Shift snaps to 15°). Select all, invert, deselect and fill the selection with Ctrl+A, Ctrl+Shift+I, Ctrl+Shift+A and Shift+Backspace.
- Draw lines, rectangles and ellipses outlined with the current brush or filled (U, Shift for 45° lines, squares and circles); shapes stay inside the selection.
- Blur, recolour (hue, saturation, lightness), adjust brightness and contrast, or invert a selection or a whole drawing, and flip selected pixels horizontally or vertically.
- Keep a second colour (X swaps), pick from recently used colour swatches, and save your own brushes; saved brushes and recent colours are remembered between sessions.
- Change brush size, opacity, flow and smoothing from a quick bar above the canvas, or right-click the canvas while painting for a pop-up palette of brushes, recent colours, size and opacity. Sliders can be dragged, scrolled or typed into, presets show a sample stroke, a readout confirms each change on the canvas, number keys set opacity (1 = 10%, 0 = 100%) and Shift+[ / ] soften or harden the brush.
- Draw faster with mirror painting, Shift-click straight lines from the last stroke, Alt-click colour picking, Ctrl-drag brush resizing, and M to flip the view while checking proportions.
- Pinch with two fingers on a touch-enabled pen display or tablet to zoom the drawing canvas.

### Changed

- The Draw colour picker changes the brush colour live as you drag, opens under the colour you clicked, offers your recent colours and keeps working when you pick again. The bar above the canvas names the active tool and keeps your recent colours one click away.
- Pose 3D characters without switching to Rotate: dragging a joint now swings it toward or away from the camera at its full length, Shift swings it behind the body, right-drag twists a part such as turning the head, and Shift-drag pushes a hand or foot toward or away from the camera. Grabbing beside a joint no longer makes it jump, and short parts like the chest and neck move with finer control.
- Avoid rebuilding unchanged image textures when revisiting animation frames.
- Reduce the delay before first playback of large, freshly imported Pivot animations.
- Reduce playback memory for large animations by adjusting background preparation to available memory and releasing cancelled work during editing.
- Avoid repeatedly repainting unchanged Advanced timeline frames while posing figures.
- Reduce delays before the next file operation after cancelling an import or export.
- Keep the editor and native project saving available while the file conversion service starts, or if it cannot start.
- Reduce the time needed to prepare images when opening a project.
- Preserve original Pivot keyframes and avoid slow rebaking when exporting unchanged imported animations.
- Reduce time and temporary memory needed to check large animations for Pivot export.
- Scale and rotate a multi-figure selection around the dragged figure's pivot like Pivot: Alt-drag now moves every selected figure's position toward or around the shared origin instead of resizing each figure in place, and Ctrl+Alt keeps rotating the group without scaling.
- Make frame counts agree between the Simple timeline, the Advanced timeline and Export: Simple shows "Frame 3 of 24 · plays as 47 frames", and Export explains that it counts every frame including inbetweens. Simple timeline thumbnails now grow to fill the timeline's height, and each frame shows its inbetweens as "+2".
- Start painting in Draw straight away: the first stroke creates a drawing layer, or switches to your existing one, instead of doing nothing until a layer is chosen.
- Give each Draw setting one home: colour, size, opacity, flow, smoothing, mirroring and tool modes live in the bar above the canvas, while Properties keeps presets, the stroke preview, recent colours and deeper brush options.
- Refresh the interface with consistent buttons, tabs, menus and pop-ups in light and dark themes, and stronger contrast for secondary text.
- Make onion skin settings compact: an on/off switch, Before and After ranges that each carry their own colour, opacity in percent, All figures or Selected, Tint and Fade toggles, and rarer options under More.
- Make the audio timeline clearer: scrubbing sound and keeping audio in sync with frame edits are explained switches under Options, the clip tools and Add track buttons say what they do, and an empty audio panel offers Import audio and Add empty track directly.
- Add and edit effects more easily in the VFX panel: Add effect and Presets sit at the top beside the "Apply to" target, a compact catalogue opens under the button with Effects and Presets tabs, every value has a visible slider beside its number, Plays chooses the whole animation or a frame range, and an empty panel offers one-click effects such as Glow, Outline or Neon.
- Tidy the Library: filter with All, Figures and Movieclips buttons, see the folder path and item count together, insert the selected asset with a clear Insert into scene button, and get a direct next action when the library, a folder or a search is empty.
- Show a ⇔ marker on scrubbable property labels and a hint in Transform sections that dragging a label adjusts its value, with Shift or Alt for finer steps.

### Fixed

- The lasso and other pixel selections no longer make the drawing disappear until you press Enter: the rest of the drawing stays on screen and selected pixels move, scale and rotate live.
- Keep the stage fully visible and centred when opening Build figure or resizing panels, show position, angle and scale fields with readable precision (full precision appears while editing), fix garbled text in rig controls, tidy the movieclip options in the Add dialog, and say "1 figure" or "1 frame" instead of "1 figures".
- Keep attached 3D heads on the neck when the torso or neck bends; they no longer turn twice and drift off the shoulders.
- Switch IK off and on for each 3D arm and leg from the rig panel. With IK off, dragging a hand or foot swings just the forearm or shin.
- Every brush paints under the pen as you draw and finishes almost immediately when you lift it, including smudge, textured, angled and blend-mode brushes and large brushes on detailed 4K drawings. Long strokes with fine brushes such as Pencil are no longer lost, and stabilized and smudge brushes such as Liner and Oil no longer freeze the canvas. Flipping and scrubbing between drawing frames shows each drawing without waiting for it to reload, and drawing on a frame that was unloaded to save memory starts sooner. Drawing lag no longer grows as artwork and frames accumulate, brush-cursor movement stays responsive, and artwork no longer disappears while previews start. Large drawing edits, undo, redo, loading and pixel pastes wait less, with smaller background tile updates. Fill regions up to 64 megapixels without changing behavior when zoomed out.

- Select, copy, paste, transform and resample large or widely spaced drawings without allocating empty space, keep lasso capture responsive in the background, preserve translucent colors and rotated or mirrored pixel pastes, and offer crisp pixel-art filtering. Failed or cancelled clipboard transfers keep cut artwork intact.

- Keep resampled artwork intact after undo, redo and saving; pending fills, shapes, filters, pastes and transforms finish before saving or accepting a new stroke.

- Preserve drawing strokes when advancing frames, keep copied drawings consistent after undo under memory pressure, reopen widely spaced artwork reliably, and keep light-pressure ink continuous.

- Keep hidden rig expressions invisible from every angle instead of leaving flattened eyes visible through a turned head.

- Keep drawing responsive at high zoom, with consistent brush smoothing and reliable fast strokes over existing paint. Live ink keeps advancing when preview rendering trails pointer input, and fully erased artwork disappears immediately.

- Fill enclosed areas even when artwork extends far beyond the stage, with lower memory use and reliable cancellation and undo. Sampling all layers keeps the interface responsive and works immediately after new ink is drawn.

- Reduce lag and memory pressure when posing dense figures: pose input is coalesced to the latest position per frame, unchanged spatial branches, fills, topology plans and drawing order are reused, and dragging releases superseded geometry. Dense 360 surfaces reuse bounded upload buffers during editing, playback preparation and export.
- Keep projected rig controls usable in edge-on views, combine two joint rotations before projection, and let triangular fills use depth guides to resolve intersecting surfaces as articulated figures turn.
- Offer recovery and reopening when the desktop editor stops unexpectedly, instead of leaving a black window that cannot save or close normally.
- Restore right-click bending on the canvas: releasing a stationary right press opens the context menu while dragging with the button held bends the node under the pointer, matching Pivot-style gestures.
- Keep connected figures joined when using Break apart frame or Bake animation on a movieclip, so expanded figures stay attached to their parents instead of separating.
- Apply movieclip Transform edits from the inspector: Scale, Angle, Opacity and Z-index fields now update the placed instance instead of leaving it unchanged.
- Keep feedback attachments bound to the report or reply they were chosen for: a failed upload no longer attaches later file picks to the already-sent conversation.
- Keep locked IK ancestors unchanged when posing attached figures on another layer, and clear rejected pose edits so saving, tools, and timeline navigation remain available.
- Keep exports from failing on demanding animations: legal output sizes like 4K now render even when effect halos, large images, or dense drawing layers exceed surface and memory budgets. The exporter filters each oversized effect region once per frame instead of per tile, retries at smaller tiles, rebuilds lost canvases, and falls back to exact software filtering — never lowering resolution or dropping effects.
- Retain more large drawing edits in undo history with disk backing, and leave artwork unchanged if an undo read or memory reservation fails.
- Keep drawings visible after their tiles are evicted under memory pressure: cels re-decode on demand instead of disappearing or showing stale placeholders.
- Count shared copy-on-write tiles once in drawing memory accounting, and free rebuildable caches before rejecting edits that exceed the tile budget.
- Stop zooming and alternating render paths from repainting shared scratch canvases, removing flicker and unnecessary tile redraws while panning.
- Smooth strokes without dead zones or gaps: stabilized drawing follows the path continuously, and unstabilized strokes curve through sharp corners and always end on the final sample.
- Stop animations that contain drawings from redrawing continuously while nothing changes, which kept the processor and graphics card busy and drained battery even when idle.
- Fill large areas and close gaps in line art several times faster.
- Save and reopen large drawings much faster, flip through heavy drawing frames with less waiting, and keep huge soft brushes responsive instead of lagging seconds behind the pen. Drawing memory now adapts to the computer and is released after saving.
- Ink appears under the pen the moment you draw: strokes show instantly while the exact brush pixels land a moment later, and the finished stroke reaches the canvas about twice as fast as before.
- Paint large and soft brushes without hitches: big drawings no longer slow down each stroke frame, and finishing a stroke no longer pauses the app while it is saved into the drawing.
- Stop fast or stabilized brush strokes from erasing square patches of existing artwork. The lost patches could not be restored with undo; strokes now keep every pixel they don't paint, and undo restores the drawing exactly.
- Render drawings of any span without failing: mip levels now escalate to 256× and the scratch clamps to the texture limit around the visible span instead of throwing and blanking the whole frame.
- Keep playback and export in sync with the canvas: the last stroke of a drawing now appears when playing, and an extended final drawing exposure shows its artwork across the whole hold instead of staying blank until another frame follows. Incremental playback updates no longer render stale tile data or clip freshly painted regions into blank rectangles.
- Keep prepared playback frames warm through layer-timeline edits and undo/redo: a localized change only rebuilds the spans it actually touches instead of recompiling the whole timeline.
- Recover playback after a background preparation error instead of leaving playback unavailable until the app restarts.
- Only StykAnimate itself can now use its built-in file converter; other programs and local web pages on your computer are refused.
- Closing the "Save your changes?" prompt with its close button now cancels opening or creating a project instead of leaving it stuck.

## [1.0.6]

Private feedback conversations and playback refinements

### Added

- Add saved Normal, Medium, Low, Draft and Automatic playback quality options in Animation settings, with Normal as the default and full-resolution editing restored on pause.
- Add private bug-report and feedback conversations in the app and on the website, with attachments and developer replies.
- Add a saved Animation setting to fit the view when playback starts, enabled by default; turn it off to preserve zoom and pan.
- Add Ctrl+Shift+V to paste figures in their original position, alongside Ctrl+V with its existing offset.

### Fixed

- Preserve the edited pose and appearance when importing builder changes as a new figure, keeping original instances unchanged after deleting parts.
- Reduce dense-animation stalls and image allocations.
- Retain the selected VFX clip when using frame-navigation shortcuts in the timeline.
- Reduce long-project editing overhead by transferring only changed thumbnail poses, retaining unchanged inspector icons, and avoiding redundant timeline layout work.
- Render the artwork surrounding the camera before applying scene VFX, preventing black shockwave bands and clipped filter edges in exports, playback, and thumbnails; preserve bounded sampling surfaces and tiny-blur guards.
- Preserve original sprite image colors and transparency on import instead of automatically erasing pixels matching the bottom-left corner.
- Show a checkerboard behind transparent scene areas during editing and playback.

## [1.0.5]

Independent VFX animation and refined editing

### Added

- Add builder appearance copy and paste for selected segments and branches.

### Changed

- Make Build-mode Duplicate and Flip shortcuts respect segment/branch scope, and add configurable S to split and B to toggle Branch.
- Add a saved Canvas setting for Scroll to zoom or Ctrl + scroll to zoom, keeping Ctrl + scroll as the default.
- Default previous/next frame shortcuts to comma/period and add configurable Shift+comma/period keyframe jumps, preserving custom assignments.
- Add a configurable Extend keyframe shortcut, defaulting to Shift+A.
- Add persistent VFX clips with independent timing, parameter keys and fades, so effects can be animated without changing pose frames.
- Apply effects across connected figures while preserving their drawing order and editable parts.
- Make color picker canvas sampling opt-in through an Eyedropper button, allowing ordinary outside clicks to dismiss the panel.

### Fixed

- Prevent dragging selected empty timeline cells from creating blank frames.
- Allow dragged layer keyframes to replace destination keys, including Alt-drag copies and overlapping selections, with one-step undo and a saved Animation setting enabled by default.
- Make new builder lines and chain links inherit their parent segment’s colour and thickness, including per-instance style edits.
- Import Pivot projects with padded JPEG resources or recoverable missing image records, preserving animation and original-source exports while reporting absent artwork.
- Keep figures sharp when invisible construction segments extend far beyond their visible artwork, without enlarging raster memory budgets.
- Extend image background edges during camera motion to prevent exposed white or black margins in previews, playback, and exports.

## [1.0.1]

A cleaner workspace

### Changed

- Move the figure color palette to a compact, collapsed section at the bottom of Properties and show parallax only for selected layers.
- Simplify the welcome screen with Donate at the top, grouped changes in a scrollable reading area, and recent release changelogs in the same window.

## [1.0.0]

Expanded animation tools, refined editing, and smoother playback

### Added

- Add a selected-figure color palette with segment counts and bulk color replacement; fix conflicts between figure and node colors in legacy Pivot files, preserving gradients, undo, saving and native export.

- Add automatic canvas eyedropper sampling while the color picker is open, with a magnified pixel preview

- Add Pivot-style J join/unjoin from figure, node and branch selections, shared canvas-menu and inspector actions, static-node click/Shift-click/double-click selection, valid parent-handle highlighting, cancellation and sparse range undo; move handle visibility to Shift+J while preserving custom shortcuts.

- Preserve figure colors when copying between projects and app instances using different Pivot versions, including legacy black and modern multicolor figures.

- Extend Alt-drag rotation and scaling to all selected figures, preserving each origin and joined descendants, modifier locks, cancellation, and one-step undo.

- Add native two-anchor connectors with sliding attachment joints and Smart Stretch with automatic branch setup

- Refine both timelines with a direct mode switch, layer search/focus and saved colors, contextual easing and Simple sidebar easing, rebuilt onion controls with fixed Before/After distances and ruler handles that follow the playhead

- Add a remembered desktop UI scale slider (75%–200%) with live native scaling and one-click reset

- Add a colored toolbar Tweener with Breakdown, Blend to Neighbor, Push and Relax, direct canvas dragging, Shift precision, Escape/right-click cancellation, independent layer neighbors and one-step undo.

- Add a configurable canvas grid and vertical/horizontal guides with a compact icon-based panel, slidable numeric fields with fine adjustment and click-to-type editing

- Add editable camera shake, handheld motion, wobble, impact punches and zoom pulses with draggable inspector values and live motion graphs.

- Add layer parallax values

- Add editable audio through an optional timeline Audio tab, with integrated Advanced lanes sharing its ruler, scrolling and zoom, direct dragging between tracks, waveforms, trimming, splitting, volume and fade controls.

- Add animatable per-effect strength and turbulent displacement, with bounded GPU filters, canvas controls, and matching playback/export paths.

- Rework Figure builder. Now contextual, what you select is what you edit, if you don't select anything you create a new feature. Contextual controls and new tools added with better interface

- Add editable motion paths with compact range and scope settings, uncluttered trails and frame labels

### Changed

- Refine Properties UI

- Improve dense-scene playback, scrubbing and node editing performance

- Simplify and improve canvas controls

- Speed up high-resolution exports

- Widen canvas zoom to 0.1%–10,000% and display fractional percentages at low zoom.

- Redesign movieclip Properties with live frame and duration values, compact controls, and keyframe-add feedback; retain stacking across added frames and create independent instances when pasting onto an existing clip.

- Improve the asset library with adaptive thumbnail contrast, animated movieclip hover previews, right-click actions, and drag-to-folder organization.

- Speed up native project save and open: `.styk`/`.stkz`/`.stykmov` 
- Remove the duplicated figure Outline section from the Design inspector; outline authoring lives in the VFX panel.
- Smooth rounded VFX outlines
- Scale memory allowances and export limits 
- Stream large exports straight to disk
- Reduce idle resource use

### Fixed

- Make horizontal and vertical flips respect selected figure segments and branches, including timeline ranges; selecting the root still flips the whole figure.

- Reduce movieclip creation time and undo memory

- Fix simple timeline thumbnail previews

- Fix recurring multi-second freezes while editing dense scenes, including figure/movieclip copy, paste and drag/drop

- Fix Add Frame in the Advanced timeline: pressing A off a keyframe inserts a key at the playhead instead of the following frame

- Open associated files on launch: double-clicking a .styk, .stkz, .stykmov, .piv, .stk, .stknds, .nodes, or .nodemc file now loads it in the desktop app

- Speed up camera playback and preview
- Speed up playback and editing on low-end hardware
- Make oversized embedded images lightweight
- Recover from repeated GPU device disconnections and keep disconnected rendering inert before reading scene data, so independent software exports can continue through recovery.

## [0.5.6]

VFX, dark mode, and smoother animation workflows

### Added

- Add editable VFX stacks for nodes, figures, movieclips and the camera view, with 16 effects, gradient colors, centered searchable effect and preset popups, draggable cards, canvas controls, preview bypass, GPU rendering, and native save/export support.
- Implement dark mode, defaulting to System to follow the operating system’s appearance.
- Add a movieclip to the next X existing keyframes at the same position, preserving other content and frame timing.

### Changed

- Improve playback and editing with shared glyph masks, bounded vector-command reuse, workload-based worker rasterization, and foreground interaction priority.
- Tint selected nodes and branches a lighter red so they stand out within a figure.
- Fit the scene to the viewport when playback starts, while allowing zoom and pan during playback.
- Keep the camera boundary visible above the scene with a subtle dotted red outline, including when unselected and during playback.
- Start the app and new projects with one frame containing jonh styk.

### Fixed

- Fix severe playback slowdowns after preview memory pressure by retaining vector rendering and using the available texture budget; reuse prepared frames for overlays and reconnect acceleration after a transient GPU reset.
- Correct regression fixtures to request linear interpolation explicitly and distinguish native exposures from authored Hold easing during export.
- Fix toolbar stacking for single-segment figures and selected branches with attached figures, preserving the selection's relative order and undo/redo.
- Keep compatibility rendering on a software-oriented canvas and repaint the scene after Canvas context restoration, preventing an idle viewport from staying blank after a graphics reset.
- Prevent a blank canvas when replaying after edits, including movieclip insertion, by keeping cached playback backgrounds alive across pauses and camera changes within the GPU cache budget.
- Make Advanced timeline drags select unselected keys, preserve selected ranges on click, and delete keys without shifting later animation.
- Improve PIV importer stability.
- Simplify export controls with automatic video quality and frame progress, speed up dense high-resolution rendering, and bound encoder memory use.
- Fix miscellaneous bugs.

## [0.5.5]

WELCOME TO THE FIRST BETA VERSION OF STYKANIMATE!

### Added

- Have fun! Send bug reports and ideas on Discord, through Help → Send feedback / Report a bug, or through Settings → Feedback.
