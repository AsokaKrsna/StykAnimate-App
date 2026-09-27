# StykAnimate changelog

The source of truth for release notes. Add completed work to Unreleased; move it into a new highest version when preparing a release. See docs/RELEASING.md for the format and checks.

History starts with existing 0.5.5 metadata, with overlapping feedback instructions consolidated. Earlier evidence remains in docs/releases/RELEASE-0.2.0.md and docs/releases/RELEASE-0.3.0.md; this file does not infer missing release history or publication dates.

## [Unreleased]

### Added

- Add particle effects from the VFX panel: explosions (fireball, cartoon, plasma, smoke bomb, mushroom cloud, fireworks, electric, magic, dust and pixel), auras (fire, electric, shadow, holy, ice, wind, cartoon and spirit), beams (energy, laser, cartoon, spiral, lightning and fire breath), and rising smoke and steam, each shown with a preview. Combine effects in one clip and give each a start delay to build your own sequences. Choose a Style to change an effect's look, press Shuffle for a new variation, or build your own with Particles using flames, smoke puffs, stars, leaves, snowflakes and other textured looks, with outlines, glow, motion trails, swirl and wind. Effects start at the playhead, follow the figure or node they are attached to, leave trails behind moving figures, suit both light and dark scenes, work inside movieclips, and look the same in preview, playback and export. Aim a beam by picking any node on the stage.
- Give 3D props parts that slide or hinge along a fixed track, like a pistol's slide, trigger and magazine: drag them in Pose, or set how far they have moved in the rig panel. Opening files with these parts requires this version.
- Find any command with the command palette: press Ctrl+P, Ctrl+Shift+P or F1, or choose Search commands… in the StykAnimate menu. Type to run a command, select a layer or figure, open a setting, or go to a frame by its number.
- Arrange the panels your way: choose Layout… in the View menu (Ctrl+Alt+L) to switch between layouts such as Timing, Focus and Review, place Properties, VFX, Library, the timeline and the tools, and save your own layouts for each workspace. You can also drag a panel's tab to dock it on either side or float it over the stage (hold Shift), or right-click the tab to dock, float, fold or hide the panel.
- Move around the editor from the keyboard: F6 and Ctrl+F6 jump between areas, Ctrl+\ hides the side panels and the timeline for Focus mode, Ctrl+Alt+M moves the focused panel, and in the desktop app Ctrl+1 to Ctrl+4 show or fold Properties, VFX, Library and the timeline.
- Paint with richer brushes: strokes can taper to a point at the start and end (even with a mouse), brushes can use Chalk, Bristle and Sponge tips, paper or canvas grain, and size, opacity and angle jitter, a Pulled string smoothing mode keeps lines steady, a pen pressure curve tunes how your tablet responds, and new Brush pen, Chalk, Dry brush and Sponge presets show them off.

### Changed

- Pose, scrub and play 3D figures far more smoothly, even on slower computers, with much less memory in long animations and smaller saved files.
- Open older Pivot animations much faster, especially ones with many sprite images: a large Pivot 4 race animation now opens in about 8 seconds instead of 30.
- Seek, scrub and zoom large Pivot animations more smoothly. Frames are prepared faster, and detailed figures with overlapping fill shapes now draw as sharp vectors instead of textures, so zooming no longer pauses and uses far less graphics memory.
- Refresh the editor with the StykAnimate typeface and colours. The typeface now ships with the app, so text looks the same on every computer, including Greek, Cyrillic and Vietnamese, and main buttons, highlighted tools, small blue labels and brush preset previews are easier to see in both light and dark mode.
- Hover or focus a button to see its name and keyboard shortcut in one quick tooltip. It shows the shortcuts you set in Settings.
- Get a larger stage in a calmer layout: the tools sit in their own column, and the stage, the Properties panel and the timeline are separate panels that keep their place in every workspace. In small or short windows the Properties panel, Build's figure structure and the timeline open over the stage when you need them instead of squeezing the canvas, the top bar shortens its labels before anything is hidden (in the narrowest windows the menus move into the StykAnimate menu), so nothing is cut off at the window's edge, and each workspace remembers its own panel layout.
- Play animations more smoothly: the panels no longer redraw during playback, and Properties catches up with the current frame when playback stops. The Simple timeline stays still while playing, with a thin line showing where playback is.
- Find the timeline's controls in the same place in Simple and Advanced: Add frame, Edit together, the playback controls, Onion and Audio sit in one header, the time readout opens Go to frame, and a Timeline ⋯ menu holds Last frame, the key jumps and Default height. The layer list's header adds, finds and focuses layers (a new layer opens its name for typing), and the timeline zoom, Fit timeline and Tall timeline sit at the ruler's end, clear of your frames.
- Find the workspaces, Undo, Redo, Save and Export together in the top bar, next to your project's name and whether it is saved ("Edited", "Saved 12:04"). While you build a figure, edit a movieclip or adjust the camera, Done sits beside a quiet Export, with Test rig in Build and Cancel in a movieclip.
- See only the tools of the workspace you are in on the left rail, always in the same place. The + opens one Add menu with a stick figure, text, images, figures from files, movieclips, more copies of figures already in your project and the examples; in Draw the + still starts a new drawing layer, and its small corner mark opens the same menu. Select pixels and Shapes show a corner mark too: click it, right-click or press and hold the tool to choose a lasso, rectangle, ellipse or wand selection, or a line, rectangle or ellipse.

### Fixed

- Show error messages above open dialogs instead of behind them, where you can close them, and keep them clear of the canvas's view buttons. A failed save, export or import stays until you close it; other messages go on their own.
- Stop menus from switching tools while you type in them: letters now jump to the matching command. The Properties ⋯ menu opens again.
- Show What's new and the first-run privacy choice one after the other at startup, never on top of an open menu or dialog.
- Press Enter to confirm a new project name. Prompts such as "Save changes?" start on their main field or button instead of Close, open over another dialog without replacing it, and let you pick a recent file or a Stick Nodes asset with the arrow keys and Enter.

## [1.1.0]

Drawing layers and animation editing improvements

### Added

- Draw and animate on dedicated drawing layers backed by a sparse tiled raster engine timeline

### Changed

- Work more naturally with a drawing tablet: tapping a joint or figure with the pen no longer nudges it, holding the pen still no longer pops up the context menu (the barrel button still does), and Ctrl+Space or Shift+Space with a pen drag zooms, or rotates the Draw view, without a scroll wheel. Settings → Shortcuts lists the pen gestures.
- Avoid rebuilding unchanged image textures when revisiting animation frames.
- Reduce the delay before first playback of large, freshly imported Pivot animations.
- Reduce playback memory for large animations by adjusting background preparation to available memory and releasing cancelled work during editing.
- Avoid repeatedly repainting unchanged Advanced timeline frames while posing figures.
- Reduce delays before the next file operation after cancelling an import or export.
- Reduce the time needed to prepare images when opening a project.
- Scale and rotate a multi-figure selection around the dragged figure's pivot like Pivot: Alt-drag now moves every selected figure's position toward or around the shared origin instead of resizing each figure in place, and Ctrl+Alt keeps rotating the group without scaling.
- Make frame counts agree between the Simple timeline, the Advanced timeline and Export
- Make onion skin settings compact
- Make the audio timeline clearer
- Add and edit effects more easily in the VFX panel
- Show a ⇔ marker on scrubbable property labels and a hint in Transform sections that dragging a label adjusts its value, with Shift or Alt for finer steps.

### Fixed

- Reduce lag and memory pressure when posing dense figures
- Offer recovery and reopening when the desktop editor stops unexpectedly, instead of leaving a black window that cannot save or close normally.
- Restore right-click bending on the canvas
- Keep connected figures joined when using Break apart frame or Bake animation on a movieclip, so expanded figures stay attached to their parents instead of separating.
- Apply movieclip Transform edits from the inspector: Scale, Angle, Opacity and Z-index fields now update the placed instance instead of leaving it unchanged.

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
