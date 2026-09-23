# StykAnimate 1.1.0

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

Free to create. Powered by your support.

StykAnimate is completely free. If it helps bring your ideas to life, a donation helps keep development moving. [Support development on Ko-fi](https://ko-fi.com/Q5Q41WY7QC).

Install the **Setup** version for automatic updates. Portable copies require manual updates.
