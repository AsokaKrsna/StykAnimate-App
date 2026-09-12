# StykAnimate changelog

The source of truth for release notes. Add completed work to Unreleased; move it into a new highest version when preparing a release. See docs/RELEASING.md for the format and checks.

History starts with existing 0.5.5 metadata, with overlapping feedback instructions consolidated. Earlier evidence remains in docs/RELEASE-0.2.0.md and docs/RELEASE-0.3.0.md; this file does not infer missing release history or publication dates.

## [Unreleased]

### Added

- Add an editable HyperFrames launch video with synchronized app recordings, narration, motion graphics, and an original music bed.
- Rework Build figure into a bounded builder editor: a figure-hierarchy outliner with drag reordering and reparenting, a surfaced toolbar with structure, duplicate/flip, draw-order, media, and aid controls, and an exit dialog that updates the shared figure, imports it as a new figure, or discards the session.
- Add Blender-style motion paths: a toolbar/menu toggle (M) draws trajectories as sampled curves with per-tick points, emphasized keys, and frame-number labels; dragging any point rewrites the pose at that point's animation time without moving the playhead, with IK-aware solving, joined-figure propagation, authored-channel and layer-timeline support, and a single undoable commit. A hover settings popover on the toolbar icon exposes a ±N frame window around the playhead, frame labels, and a multi-target overlay for every selected figure in a distinct colour.

### Changed

- Remove the duplicated figure Outline section from the Design inspector; outline authoring lives in the VFX panel.
- Smooth rounded VFX outlines by widening the dilation kernel from 8 to 16 directions.
- Keep the construction background, static handles, and segment highlighting active for every tool while building, keep the tool rail visible beside a resizable outliner, expose a segment's secondary color in the joint inspector, and switch pressed tool buttons to a readable accent tint instead of a solid block.

### Fixed

- Fix Add Frame in the Advanced timeline: pressing A off a keyframe inserts a key at the playhead instead of the following frame, and frames added on figure-less layers now appear as visible blank cells.
- Open associated files on launch: double-clicking a .styk, .stkz, .stykmov, .piv, .stk, .stknds, .nodes, or .nodemc file now loads it in the desktop app instead of starting with an empty project, and native projects keep their save target so Save writes back in place.
- Speed up camera playback and preview: the inspector output monitor reuses the prepared GPU frame instead of re-evaluating the scene each frame, camera previews render prepared packets when available, prepared packets survive camera-view toggles such as timeline scrubbing, and the software camera-effects path halves its working resolution during interaction and playback.

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
