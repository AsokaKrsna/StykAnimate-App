# StykAnimate changelog

What's new in each version of StykAnimate.

<!-- Maintainers: follow the writing guide in docs/RELEASING.md before adding entries. -->

## [Unreleased]

### Added

- Command palette: press Ctrl+P or F1 to find any command, setting, layer, figure or frame.
- Custom layouts: dock, stack, group or float panels wherever you like, and switch between layouts such as Timing, Focus and Review from View → Layout (Ctrl+Alt+L).
- Keyboard navigation: F6 moves between areas of the editor, Ctrl+\ switches to Focus mode, and Ctrl+1 to Ctrl+4 show or hide the main panels.
- Particle effects: add explosions, auras, beams, smoke and steam from the VFX panel, mix them together, change their style, or design your own particles.
- Save your own effect presets and reuse them in any project.
- Color palettes in every color picker: keep your project's colors, reuse recent ones, and create named palettes you can use across projects.
- Public library: browse free rigs and 3D shapes from the Library panel or on stykanimate.com/library, and open them straight in the app.
- Richer brushes in Draw, with tapered strokes, chalk, bristle and sponge tips, paper grain, steadier lines, a pressure curve for your tablet and new presets.
- Moving parts for 3D props, like a pistol's slide or trigger. Projects that use them need this version or newer.
- Reshape a whole arc of motion at once: hold F and drag a point on a motion path, and the nearby frames follow smoothly.
- Hold Alt and drag a figure to duplicate it as you move it.
- Hold Shift and drag a figure's origin to move the whole figure along with its pinned IK joints.
- Press A while dragging a joint or figure to add frames without letting go.
- Right-drag to bend lines in Build, just like in Animate.
- A Canvas setting to choose whether pasted figures keep their original layering or appear in front.

### Changed

- A fresh new look, with the StykAnimate typeface, brighter colors, floating panels, and matching menus, buttons and dialogs throughout the app.
- More room for your animation: tools sit in a floating bar beside the canvas, view controls share one line above it, and small windows open panels only when you need them.
- The top bar keeps workspaces, Undo, Redo, Save and Export together and shows whether your project is saved.
- Redesigned timelines: the Simple timeline shows frames as cards you can stretch to hold longer, the Advanced timeline shows each pose as one clear bar, and both keep their controls in the same place.
- Redesigned motion paths: show the arcs of hands, feet and head together, color them by speed, and preview any frame's pose by pointing at its trail.
- Easier 3D posing: dragging a joint turns the part on screen, holding D moves it toward or away from you, and arms and legs bend with IK just like on a 2D figure.
- A clearer Export window with a live preview, easy trimming, size options and one-click presets for YouTube, Shorts, TikTok, Instagram, X and more.
- A simpler Properties panel, with the most used actions right under the selection's name.
- A simpler VFX panel that lists effects one per row, each with its own on/off switch.
- A clearer Build workspace that makes each part's actions and the figure's structure easier to find.
- A cleaner Library panel with search, filters and larger previews.
- Redesigned Settings, with a page for each section and a search box.
- Tidier menus, with named groups and submenus.
- Tooltips show each button's name and keyboard shortcut.
- The app picks a comfortable interface size for your screen, including 1440p and 4K displays. You can still set your own in Settings.
- Short hints tell you what to do next while joining figures, placing images, drawing shapes or using the Tweener.
- A clearer What's new screen that matches the website.
- New projects start with Blue, a simple 2D stick figure with balanced proportions and hand/foot IK for easy posing.

### Fixed

- Fixed selecting figures on the canvas while using the Tweener.
- Fixed onion skins looking patchy where parts of a figure overlap.
- Fixed Feedback sometimes opening on the wrong report type.
- Fixed the timeline and effect list jumping while selecting several frames.
- Fixed clicking a figure's artwork not selecting the figure.
- Fixed leaving Draw sometimes losing your previous layer and selection.
- Fixed error messages appearing behind open dialogs. Closing the Export window during an export now asks before stopping it.
- Fixed typing in a menu switching tools, and the Properties ⋯ menu not opening.
- Fixed What's new and the privacy prompt appearing on top of each other at startup.
- Fixed Enter not confirming a new project name.

### Performance

- Faster property adjustments in long animations and smoother refreshes in scenes with many images.
- 3D figures pose, scrub and play much more smoothly, use less memory and save to smaller files.
- Older Pivot animations open several times faster, and large ones scrub and zoom more smoothly.
- Smoother playback and editing in busy scenes, especially on laptops without a dedicated graphics card and in Compatibility mode.

## [1.1.0]

Drawing layers and smoother editing

### Added

- Drawing layers: draw and animate by hand on their own layers, right alongside your figures.

### Changed

- Better drawing tablet support: pen taps no longer nudge joints, holding the pen still no longer opens the right-click menu, and you can zoom or rotate the view with the pen.
- Scaling and rotating several figures at once now works like in Pivot, around the figure you drag.
- Frame counts now match between the Simple timeline, the Advanced timeline and Export.
- More compact onion skin settings and a clearer audio timeline.
- Adding and editing effects in the VFX panel is easier.
- Property labels you can drag to change a value are now marked. Hold Shift or Alt for finer steps.

### Fixed

- If the app stops unexpectedly, it now offers to recover your work instead of leaving a black window.
- Fixed right-click bending on the canvas.
- Fixed joined figures coming apart when breaking apart or baking a movieclip.
- Fixed movieclip Scale, Angle, Opacity and Z-index fields in Properties having no effect.

### Performance

- Large animations open, play and edit faster and use less memory, especially freshly imported Pivot files.
- Posing detailed figures is smoother.
- Cancelling an import or export no longer delays the next one.

## [1.0.6]

Private feedback and playback quality options

### Added

- Send bug reports and feedback privately from the app or the website, with attachments and replies from the developer.
- Playback quality options in Animation settings, from Normal down to Draft, plus an Automatic mode.
- A setting to fit the view when playback starts, turned on by default.
- Press Ctrl+Shift+V to paste figures in their original position.

### Fixed

- Fixed importing Build changes as a new figure losing edits or changing the original figures.
- Fixed the selected effect being deselected when moving between frames with the keyboard.
- Fixed black bands and cut-off edges on scene effects in playback and exports.
- Imported sprites now keep their original colors and transparency.
- Transparent areas of the scene now show a checkerboard while editing.

### Performance

- Fewer pauses and less memory use in large and detailed animations.

## [1.0.5]

Effects with their own timing, and editing refinements

### Added

- Effects now have their own clips on the timeline, with timing, keyframes and fades separate from your poses.
- Copy and paste the look of parts in Build.

### Changed

- Duplicate and Flip in Build now respect whether you selected a single part or a whole branch. New S and B shortcuts split a part and switch branch mode.
- A Canvas setting to zoom with the scroll wheel alone, or with Ctrl + scroll as before.
- Comma and period now go to the previous and next frame, and Shift+comma and Shift+period jump between keyframes. Your custom shortcuts are kept.
- A new Extend keyframe shortcut, Shift+A by default.
- Effects now apply across connected figures.
- Pick colors from the canvas with the color picker's Eyedropper button. Clicking outside the picker now closes it.

### Fixed

- Fixed dragging empty timeline cells creating blank frames.
- Dragging keyframes onto other keyframes now replaces them.
- New lines in Build now take the color and thickness of the part they grow from.
- Fixed Pivot projects with damaged or missing images failing to import.
- Fixed figures with very long hidden parts looking blurry.
- Fixed empty edges showing around background images when the camera moves.

## [1.0.1]

A cleaner workspace

### Changed

- The figure color palette moved to a compact section at the bottom of Properties.
- Parallax settings only show for selected layers.
- A simpler welcome screen, with recent release notes in the same window.

## [1.0.0]

New animation tools, refined editing and smoother playback

### Added

- Audio: add sound to the timeline, with waveforms, trimming, splitting, volume and fades.
- Tweener tool with Breakdown, Blend to Neighbor, Push and Relax.
- Camera shake, handheld motion, wobble, impacts and zoom pulses.
- Editable motion paths.
- Connectors that link two points, with sliding joints and Smart Stretch.
- Join and unjoin figures with J, just like in Pivot. Showing handles moved to Shift+J.
- A redesigned Figure builder: what you select is what you edit, with new tools to go with it.
- A color palette for the selected figure that lets you replace colors in bulk.
- An eyedropper with a magnified preview to pick colors from the canvas.
- Canvas grid and guides.
- Layer parallax.
- Animated strength and wavy distortion for effects.
- Alt-drag to rotate and scale every selected figure together.
- An interface size slider in the desktop app, from 75% to 200%.
- Refined timelines, with a quick mode switch, layer search and colors, easing controls and new onion skin controls.

### Changed

- A refined Properties panel and simpler canvas controls.
- Zoom now goes from 0.1% to 10,000%.
- Redesigned movieclip properties. Pasting onto an existing movieclip now creates an independent copy.
- A better asset library, with animated previews, right-click actions and drag-and-drop into folders.
- Figure outlines are now set up in the VFX panel, and rounded outlines look smoother.

### Fixed

- Fixed freezes lasting several seconds when editing, copying, pasting or dragging in busy scenes.
- Fixed Flip ignoring the selected parts and branches.
- Fixed Simple timeline thumbnails.
- Fixed Add Frame in the Advanced timeline adding the key on the wrong frame.
- Figures keep their colors when copied between projects or Pivot versions.
- Double-clicking a StykAnimate, Pivot or Stick Nodes file now opens it in the app.
- The app now recovers when the graphics driver resets, and exports keep going.

### Performance

- Faster playback, scrubbing and editing, especially in busy scenes and on older computers.
- Faster camera playback, high-resolution exports, and saving and opening projects.
- Large exports and big images use much less memory.
- Creating movieclips is faster.
- Lower resource use when the app is idle.

## [0.5.6]

Effects, dark mode and smoother animation

### Added

- Visual effects for joints, figures, movieclips and the camera, with 16 effects, gradients and presets.
- Dark mode, which follows your system setting by default.
- Add a movieclip to several upcoming keyframes at once.

### Changed

- Selected joints and branches are highlighted in a lighter red.
- The view fits the scene when playback starts, and you can still zoom and pan while playing.
- The camera frame stays visible as a subtle dotted outline.
- The app and new projects start with one frame starring Jonh Styk.
- Simpler export options, with automatic video quality and a progress counter.

### Fixed

- Fixed playback slowing down badly after running low on memory.
- Fixed the canvas going blank after a graphics reset or when replaying after edits.
- Fixed arranging figures from the toolbar for single-part figures and selected branches.
- Advanced timeline: dragging now selects keys, clicking keeps your selection, and deleting keys no longer shifts later frames.
- More reliable Pivot imports.
- Various other bug fixes.

### Performance

- Smoother playback and editing, and faster high-resolution exports.

## [0.5.5]

Welcome to the first beta of StykAnimate!

### Added

- Have fun! Share bug reports and ideas on Discord, or from Help → Send feedback in the app.
