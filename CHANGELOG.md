# StykAnimate changelog

The source of truth for release notes. Add completed work to Unreleased; move it into a new highest version when preparing a release. See docs/RELEASING.md for the format and checks.

History starts with existing 0.5.5 metadata, with overlapping feedback instructions consolidated. Earlier evidence remains in docs/RELEASE-0.2.0.md and docs/RELEASE-0.3.0.md; this file does not infer missing release history or publication dates.

## [Unreleased]

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
