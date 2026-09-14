# Scene background editing

While the color picker is open, the pointer becomes an eyedropper over the editor canvas. A floating loupe enlarges an 11×11 pixel neighborhood, marks the center pixel and shows its HEX color. Click to copy the rendered RGB color into the solid color or selected gradient stop, preserving opacity. Sampling keeps the picker and canvas selection open; Escape or clicking another control closes the picker. The normal paint command supplies undo. Pixels are read immediately after a requested render, with GPU handles omitted for that sample, so idle WebGPU canvases and scaled preview buffers are supported. Hover requests are coalesced to at most 30 per second with one readback in flight, stop when the pointer is idle, and cancel on leaving the canvas or closing the picker. The loupe never intercepts canvas input or enters the sampled artwork.

`src/editor-scene.mjs` is installed on `Editor`. It supplies these commands:

| API | Behavior |
| --- | --- |
| `setSceneColor(argb, {indices})` | Set a 32-bit ARGB color absolutely at selected native frames or authored Scene keys. Numeric zero is transparent. |
| `setSceneBackground(id, {indices})` | Select an existing background; zero selects the default white background. Clear any active color override at the edited point. |
| `importSceneBackground(background, {indices})` | Import a decoded image, solid color or gradient, assign a fresh native ID, select it, and return the inserted asset. Import and selection form one undo command. |
| `renameSceneBackground(id, name)` | Change only a background's name. The image/gradient asset retains its identity and media bytes. |
| `sceneValuesAt(editor, index, tick)` | Sample only Scene fields, without composing or copying figure poses. |

Indices default to the current stored frame. Native changes snap to that frame's
start. A single authored edit uses the displayed tick; authored range changes use
the selected native frame start ticks. Hidden or locked Scene tracks reject edits
before changing the document.

Ordinary editing does not create scalar animation channels. Existing Scene color
or background channels receive keys on those channels. If a Scene pose track is
present instead, the command records a minimal Scene-only source and a pose key,
preserving unrelated animation tracks. Selecting a background writes a `null`
key to an existing color channel: null returns control to the background, whereas
ARGB zero remains a transparent color. Composition applies the background channel
before the color channel, independently of channel creation order.

Native undo snapshots contain only changed Scene fields and newly imported table
entries. Renaming snapshots only the previous and next names. They do not copy
existing figure arrays or unrelated images. Authored snapshots contain only
changed channels and small source frames; the standard source-history lifecycle
keeps required sources available through undo/redo and prunes unused captures.

`tests/editor-scene.test.mjs` passes 12 cases covering sparse ranges, authored
inbetween edits, null/transparent colors, atomic image import, name-only history,
source pruning, invalid/locked/hidden edits and real PIV writer/reimport. A 2 MB
unrelated image does not appear in color history; native color history stays below
5 KB, and renaming a 1 MB image stays below 2 KB.

Rendering uses the shared Scene override in Canvas, WebGPU, prepared playback and
SVG. `tests/scene-background.browser.mjs` previously passed 35 checks with all four
paths, transparent/translucent colors, Scene/Camera visibility and retained-cache
changes. The pixel report is in
[`artifacts/scene-background/report.json`](../artifacts/scene-background/report.json).
These checks cover the engine and rendering contracts; they do not claim the
separate background library dialog's UI workflow is complete.

## Joining and node selection

Joint Properties keeps Static in Transform and gives IK its own section. Enabling
IK reveals pinning, stretch, chain, rotation and bend direction controls nested
beneath its toggle. Appearance offers Secondary
color only for circle primitives (white, filled or clear), including selections
containing only circles; its color and opacity appear when enabled. Switching to
a non-circle hides those controls without discarding existing native color data.

See [figure joining and static-node selection](FIGURE-JOINING.md) for the shared
J/context-menu action, soft static selection, native evidence and verification.

## Figure colors

`src/figure-colors.mjs` reads displayed segment and fill colors and builds pure
recolor plans. `src/editor-colors.mjs` publishes them through the existing figure
range commands. The Properties palette counts a segment once for each color it
uses, including gradient stops; polygon uses are listed separately. Palette rows
are paged in groups of 32. Bitmap pixels and VFX colors are not palette entries.

Figure color assigns one RGB to every segment stop and fill. Palette replacement
changes only the matching stops/fills. Node edits preserve the other displayed
colors. These commands retain opacity, paint layout, geometry, IDs and shared
definitions, and form one history step. Reset colors restores definition colors.
An open palette picker retains its original segment/stop membership after colors
merge. Opacity-only edits do not recolor the figure.

Pivot 2–4 absolute COLORREF values and negative black differ from Pivot 5's mix
byte. On the first local color edit, an active legacy/modern figure override is
baked into per-instance `_stykStyle` colors before clearing it. Legacy instances
carry `_styk.colorMode: 'segments'`; resolution exposes the existing definition
color-mode contract without mutating shared definitions. Full native overrides
suppress secondary alpha as well as RGB, so baking preserves the displayed solid.
Clipboard conversion preserves the instance mode, and native export materializes
style variants and converts untouched legacy COLORREF values to Pivot 5 too.

Layer-sheet edits use the existing held-key/interpolated-boundary policy and range
history. Legacy scalar timelines keep independent color/paint channels and native
Simple working-copy behavior. Tests are in `tests/figure-colors.test.mjs` and
`tests/figure-colors.browser.mjs`; `scripts/verify-figure-colors.mjs` checks local
hands-pack STYK/PIV round trips and records command timings.

## Figure flips

Horizontal and vertical flip commands use the active selection in both current-pose
and timeline-range edits. A root selection flips the whole figure and its joined
descendants. A segment selection reflects only the selected segment angles and
bends around their parent joints; explicit branch selection includes descendants
and figures attached to that branch. Unselected segment poses stay unchanged,
and connected children follow their parent endpoints. Each command is one undo step.

## Alt-drag figure transforms

Alt-dragging a figure joint preserves an existing multiple-figure selection and
applies the same rotation delta and scale factor to every selected figure around
its own origin. The picked figure supplies the gesture reference. Joined descendants
follow their parent and transform once even if also selected. Ctrl locks scale;
Shift locks rotation. Release records one undo step, and Escape cancels the gesture.

## Motion paths

See [Motion paths](MOTION-PATHS.md) for display settings, remote pose gestures, cache ownership, sampling limits, and verification.
