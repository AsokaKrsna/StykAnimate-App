# StykAnimate 1.0.0

Expanded animation tools, refined editing, and smoother playback

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

Free to create. Powered by your support.

StykAnimate is completely free. If it helps bring your ideas to life, a donation helps keep development moving. [Support development on Ko-fi](https://ko-fi.com/Q5Q41WY7QC).

Install the **Setup** version for automatic updates. Portable copies require manual updates.
