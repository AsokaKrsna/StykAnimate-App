# Motion paths

The path button (M) toggles trails. Its inset chevron opens display settings; Down Arrow on the path button opens them from the keyboard. Escape closes settings and returns focus. Settings stay open while editing and dismiss on an outside click. Display options persist; paths start hidden each session.

## Settings

- **Figures**: Selected (every selected figure) or All (every figure on the stage).
- **Joints**: Selected shows the primary figure's selected joint and the origin of every other figure. Hands & feet shows each figure's origin plus every *tip joint* — a segment end no other segment hangs from (hands, feet and head on a stick figure). No anatomical labels are assumed. The primary figure's selected joint always leads its group.
- **Frame range**: a ±12/24/48 frame window or Full. With a window selected, enter a custom radius up to 4,000 frames. Windows follow the playhead.
- **Frame numbers**, **In-between dots**: independent display options. In Hands & feet, frame numbers appear only on each figure's first trail; tip trails keep their key diamonds, and a hovered tip still shows its number.
- **Speed colours**: each segment is coloured by screen distance per frame against the trail's 90th-percentile speed, from cool (slow, holds) to warm (fast). The legend beside the switch uses the same palette (`MOTION_PATH_SPEED_COLORS`).
- **Relative to body**: every sample carries its component root's origin at that time (`rx`, `ry`). The trail is drawn shifted by *root at the playhead − root at the sample*, so a travelling character's limb arcs stay in place. A figure's own origin (and the camera) has no reference and is always drawn in world space.

The selected camera uses the same trail controls. Each figure keeps one colour for all of its trails; the primary selection takes the accent colour and a slightly heavier line.

## Reading and editing trails

Trails show a quieter past and stronger future, hollow key diamonds, a ring at the current frame, and a filled marker at the hovered or dragged frame. Screen-space spacing suppresses crowded markers; frame badges avoid one another and are capped at 48 per trail. Hovered/dragged frame numbers remain visible even when persistent numbers are off. Missing sampled poses split the line; samples that are still pending do not. Visual simplification never changes stored timing or keyframes.

Pointing at a trail point at another frame draws that frame's pose as a dashed outline (the *ghost*) of the target's joined component, and the canvas tooltip explains the gestures. Drag a trail point to edit its pose without seeking; the ghost follows the live edit. The grab offset is preserved; Shift constrains movement to the dominant axis, Ctrl/Command retains the editor's stretch behavior, and Escape cancels. A completed gesture creates one undo entry. Overlapping samples resolve toward the playhead. Relative display does not change editing: a drag moves the world position by the pointer's delta.

Double-clicking a trail point (two presses without movement within 450 ms) goes to its frame. In the Simple timeline, a point at a frame's start selects that frame.

## Ownership and limits

- `motion-path-controls.mjs` writes normalized editor preferences (`motionPathAllTargets`, `motionPathJoints`, `motionPathRange`, `motionPathLabels`, `motionPathDots`, `motionPathSpeed`, `motionPathRelative`); `styles/features/view-options.css` owns its presentation.
- `motion-path.mjs` owns targets, tick planning, revision-aware sample caches, ghost evaluation, screen projection, hit testing and screen-space layout. `editor-motion-path.mjs` owns editable pose semantics and history. `app.mjs` decides which trails are active and draws them in the overlay.
- Only overlay rendering advances sampling and evaluates ghosts. Pointer hover and pointer-down read prepared cache entries and their cached screen projections, never evaluate animation.
- All active trails sample together through `MotionPathCache.sample`: every trail needing a display tick is resolved from one evaluation of that tick, and geometry is built only for the join/IK components that hold the targets (the builder's draw order names only those slots). A trail sample therefore costs its own character, not the whole scene, and 48 limb-tip trails cost about the same as their figures' origins.
- Up to 48 targets share a 6 ms cooperative sampling deadline and a 6,400-point allowance, with at most 1,600 samples per target. The leading entry rotates so trails with distinct plans all refine. Dense plans preserve endpoints and the current tick, prioritize authored times, and subsample the remainder. Short windows include every tick. A single evaluator call cannot be preempted by this deadline.
- Range shifts reuse overlapping points and discard points outside the new plan. Live reports enqueue their changed window once; subsequent renders finish the queue. Cancellation queues restoration even under a one-sample budget.
- Projection: the view × camera transform is affine, so `affineProjection` recovers its matrix from three probes. `projectMotionPath` caches each entry's screen positions until its samples, the matrix or the relative anchor change; drawing and hit tests share them, and speed buckets are computed once per projection.
- The path store retains at most 64 entries and one ghost. Clearing paths also clears the bounded native tween cache; disabling paths releases both. Markers outside the viewport (plus a margin) are not laid out.

## Verification

Run from the repository root:

- `node --test tests/motion-path.test.mjs`
- `node tests/motion-path.browser.mjs` against the local app at port 47831 (`STYK_URL` overrides it).
- `node scripts/benchmark-motion-path.mjs` against that same local app.

Unit tests cover tip targeting, batched sampling agreeing with per-target sampling and a full-scene build, body references, relative projection and its hit testing, ghosts of joined components that exclude unrelated figures, and speed colouring. Browser checks cover scope, joints, range, speed and relative persistence, numeric input, keyboard opening and dismissal, synchronized toggles, remote dragging with grab offset and Shift, the hover tooltip, the drag ghost, Escape cancellation, double-click to go to a frame, and undo. Screenshots in `artifacts/motion-path-ux/` cover light, dark and compact layouts, limb tips with speed and relative display, and the drag ghost.

The benchmark compares the working modules against Git HEAD (recorded in its JSON). It measures canvas draw submission with fresh entries, sampling to completion with the real evaluator (24 native figures over 240 frames, with the app's point allowance), and hover hit testing through `worldToScreen`. It excludes GPU presentation and a packaged desktop build.

On this workstation against `94d0c90`: sampling 24 figure trails to completion fell from a median of 486 ms to 46 ms, and 48 limb-tip trails from 544 ms to 31 ms. Hover hit testing across 24 trails fell from 0.59 ms to 0.03 ms per pointer move. Drawing 24 trails fell from 9.2 ms to 5.2 ms, and one 1,600-sample trail from 1.8 ms to 1.3 ms. These are measurements on one machine, not a general frame-rate guarantee; exact values are in `artifacts/motion-path-ux/benchmark.json`.
