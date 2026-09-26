# Motion paths

The path button (M) toggles trails. Its inset chevron opens display settings; Down Arrow on the path button opens them from the keyboard. Escape closes settings and returns focus. Settings stay open while editing and dismiss on an outside click. Display options persist; paths start hidden each session.

Choose selected figures or all figures, a ±12/24/48 frame window, or Full. With a window selected, enter a custom radius up to 4,000 frames. Windows follow the playhead. Frame numbers and in-between dots are independent display options. The selected camera uses the same trail controls.

Trails show a quieter past and stronger future, hollow key diamonds, and a ring at the current or hovered frame. Screen-space spacing suppresses crowded markers; frame badges avoid one another and are capped at 48 per trail. Hovered/dragged frame numbers remain visible even when persistent numbers are off. Missing sampled poses split the line. Visual simplification never changes stored timing or keyframes.

Drag a trail point to edit its pose without seeking. The grab offset is preserved; Shift constrains movement to the dominant axis, Ctrl/Command retains the editor's stretch behavior, and Escape cancels. A completed gesture creates one undo entry. Overlapping samples resolve toward the playhead.

## Ownership and limits

- `motion-path-controls.mjs` writes normalized editor preferences; `styles/legacy/32-motion-path.css` owns its presentation.
- `motion-path.mjs` owns tick planning, revision-aware sample caches, hit testing, and screen-space layout. `editor-motion-path.mjs` owns editable pose semantics and history.
- Only overlay rendering advances sampling. Pointer hover and pointer-down read prepared cache entries, never evaluate animation.
- Up to 24 targets share a 6 ms cooperative sampling deadline and a 6,400-point allowance, with at most 1,600 samples per target. Dense plans preserve endpoints and the current tick, prioritize authored times, and subsample the remainder. Short windows include every tick. A single evaluator call cannot be preempted by this deadline.
- Range shifts reuse overlapping points and discard points outside the new plan. Live reports enqueue their changed window once; subsequent renders finish the queue. Cancellation queues restoration even under a one-sample budget.
- The path store retains at most 32 entries. Clearing paths also clears the bounded native tween cache; disabling paths releases both. Ordered points are reused between hit tests.

## Verification

Run from the repository root:

- `node --test tests/motion-path.test.mjs`
- `node tests/motion-path.browser.mjs` against the local app at port 47831 (`STYK_URL` overrides it).
- `node scripts/benchmark-motion-path.mjs` against that same local app.

Browser checks cover range/scope persistence, numeric input, keyboard opening and dismissal, synchronized toggles, remote dragging with grab offset and Shift, and undo. Screenshots in `artifacts/motion-path-ux/` cover light, dark, and compact layouts.

The synthetic benchmark compares draw submission against the Git HEAD baseline (recorded in its JSON), using 1,600 samples and 400 keyed markers per trail. It also measures the app's shared allowance, which reduces 24 simultaneous trails to 266 samples each. It drains the raster queue before each measurement; it does not measure evaluator latency, GPU presentation, or a packaged desktop build.

On this workstation, the 24-trail median decreased from 133.3 ms to 37.7 ms at equal sample counts, and to 10.1 ms with the app allowance. A single dense trail increased from 1.7 ms to 2.2 ms with the additional collision-aware layout and contrast treatment. These are synthetic measurements, not a general frame-rate guarantee. Exact measurements and the baseline revision are in `artifacts/motion-path-ux/benchmark.json`.
