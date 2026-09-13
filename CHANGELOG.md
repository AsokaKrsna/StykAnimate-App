# StykAnimate changelog

The source of truth for release notes. Add completed work to Unreleased; move it into a new highest version when preparing a release. See docs/RELEASING.md for the format and checks.

History starts with existing 0.5.5 metadata, with overlapping feedback instructions consolidated. Earlier evidence remains in docs/RELEASE-0.2.0.md and docs/RELEASE-0.3.0.md; this file does not infer missing release history or publication dates.

## [Unreleased]

### Added

- Add a narrated 2:45 Advanced timeline tutorial with real ball-toss editing, editable After Effects motion graphics, and start/finished practice projects.

- Add prominent Discord community and YouTube channel links to the homepage hero and every public website footer.

- Add native two-anchor connectors with sliding attachment joints and Smart Stretch with automatic branch setup, signed multipliers, rigid/stop responses, impulse-axis resets and distance/slide drivers; add figure, parent and world angle locks, compact controls and Ctrl-to-stretch posing. Separate slider properties from segment appearance, with diamond slider handles and dotted endpoint guides. Add Builder one-sided fills with editable reference joints and reversible facing, joint naming and reliable drawing from overlapping attachments. All sixteen rig examples use authorable Builder features and ordinary joint previews; remove preset-only sliders and grouped shading. Add to Animate retains the tested pose and builder work, with editable figure/demo files, a tested rotating-cube recipe and matching native saving, playback and rendered exports.

- Refine both timelines with a direct mode switch, layer search/focus and saved colors, contextual easing and Simple sidebar easing, rebuilt onion controls with fixed Before/After distances and ruler handles that follow the playhead, deliberate zoom-independent scrubbing, corrected pending-playhead regression coverage, shared cancellable previews, exact range sampling without a ten-frame cap, and themed settings without an extra timeline bar, refined audio controls that preserve timeline height, panning and floating zoom; remove extra Advanced menus and bottom bars, and cache/retry Simple thumbnails with bounded worker scheduling.

- Add a remembered desktop UI scale slider (75%–200%) with live native scaling and one-click reset; refine Settings with grouped canvas controls, working shortcut search and rebinding, direct feedback actions, a sidebar Donate button, compact timeline choices, switches, icons, and a responsive layout.

- Add a colored toolbar Tweener with Breakdown, Blend to Neighbor, Push and Relax, direct canvas dragging, Shift precision, Escape/right-click cancellation, independent layer neighbors and one-step undo.

- Add a configurable canvas grid and vertical/horizontal guides with a compact icon-based panel, slidable numeric fields with fine adjustment and click-to-type editing, draggable edge handles, keyboard nudging, locking, and remembered editor preferences; keep aids out of playback and exports.

- Add a vertical launch Short with energetic narration, focused feature demonstrations, and five matching cover designs.

- Add editable camera shake, handheld motion, wobble, impact punches and zoom pulses with draggable inspector values, live motion graphs, collapsible timeline lanes and camera-key baking, plus layer parallax with linked axes and live preview; preserve their appearance across playback and exports.

- Expand optional performance diagnostics with sampled editing and rendering stages, asynchronous GPU timings, worker queue costs, workload and build attribution, memory lifecycle and recovery outcomes, bounded stall summaries, and dashboard comparisons; add a scoped analytics reset that prevents queued diagnostic totals from returning.

- Add editable audio through an optional timeline Audio tab, with integrated Advanced lanes sharing its ruler, scrolling and zoom, direct dragging between tracks, waveforms, trimming, splitting, volume and fade controls, synchronized playback, embedded project saving, and audio in desktop FFmpeg video exports.

- Add animatable per-effect strength and turbulent displacement, with bounded GPU filters, canvas controls, and matching playback/export paths.
- Rework Build figure with compact command menus, direct horizontal/vertical flip buttons, contextual right-click actions, a virtual hierarchy and collapsible timeline; add a chain pen with atomic undo, remembered spatial snapping with Alt bypass, and a visible cached branch-copy preview. Reduce append/rig history copies and retain unrelated scene geometry during construction edits. Preserve poses when deleting builder selections, support Shift-click node selection with shared width/color edits, and add direct fill selection plus Shift-click enclosed-outline filling.
- Add editable motion paths with compact range and scope settings, uncluttered trails and frame labels, offset-preserving drags and Shift axis constraints; keep sampling bounded, reuse cached hover data, and start hidden each session while retaining display options.

### Changed

- Simplify workspace chrome with a quiet mode header, a leaner tool rail, and canvas view controls with a VFX label, eye icon for joints, and an integrated motion-path settings chevron; make right-click menus contextual with distinct horizontal/vertical flip icons, and put stacking in a divided toolbar group with Shift-click for one-step moves, preserve multi-selection, use Shift + right-drag for bending joints, and add Edit in build mode at the bottom of figure action menus.

- Speed up high-resolution exports with off-tile drawing rejection, retained image reuse and direct worker-to-encoder frames; improve H.264 compression without raising quality targets or allowing encoder lookahead queues.

- Widen canvas zoom to 0.1%–10,000% and display fractional percentages at low zoom.

- Redesign movieclip Properties with live frame and duration values, compact controls, and keyframe-add feedback; retain stacking across added frames and create independent instances when pasting onto an existing clip.

- Improve the asset library with adaptive thumbnail contrast, animated movieclip hover previews, right-click actions, and drag-to-folder organization.

- Make the Properties inspector write whole layer keys in the exposure sheet — editing a held cell updates its key and editing inside a tween cuts a boundary at the playhead — and remove the separate per-property keyframe channel controls.
- Speed up native project save and open: `.styk`/`.stkz`/`.stykmov` 
- Remove the duplicated figure Outline section from the Design inspector; outline authoring lives in the VFX panel.
- Smooth rounded VFX outlines
- Scale memory allowances and export limits 
- Stream large exports straight to disk
- Reduce idle resource use

### Fixed

- Make horizontal and vertical flips respect selected figure segments and branches, including timeline ranges; selecting the root still flips the whole figure.

- Improve Advanced ruler scrubbing in dense scenes and movieclips by finishing one editable preview while coalescing pointer targets, deferring inspector refreshes and thumbnails, and seeking the exact final frame on release.

- Reduce movieclip creation time and undo memory with sparse range replacements that preserve surrounding curves, connected figures, and playback continuity.
- Keep Simple timeline thumbnails visible when returning to scrolled frames, release discarded card resources, and reveal the current frame after a hidden mount.
- Make Select All include figures added through layer-sheet keys.
- Reject Pivot exports of text-run gradient fills that native per-glyph gradients cannot reproduce.
- Recover failed camera previews, camera effects, temporary drawing surfaces, and stopped import workers without restarting the editor.
- Preserve worker error causes in diagnostics, prioritize failed-operation context, and distinguish completed file saves from optional metadata failures.
- Dragging an unselected timeline key selects a range; only an already selected range moves.
- Fix a duplicate undo step when confirming a numeric property with Enter.
- Fix recurring multi-second freezes while editing dense scenes, including figure/movieclip copy, paste and drag/drop, with sparse insertion history and retained gesture previews.
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
