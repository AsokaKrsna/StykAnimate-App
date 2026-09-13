# Connectors and Smart Stretch

Native rig relationships are available in Build Figure. Animation uses the same
editable joints, frame channels, undo history and renderer as ordinary figures.

## Build and pose

**Connectors:** select a joint and choose **Connect joints** in Properties or
the builder Edit menu, then click the other anchor. Alternatively Shift-select
two joints and choose Connect joints. Escape cancels picking. The connector spans
both anchors, even when they belong to different branches. Its own joint is a
real sliding attachment: drag it or enter **Slide position** (0–100%). Draw parts
from that joint, join another figure to it, use it as another connector's anchor,
or include it in a polygon. Anchor Pick buttons reconnect an existing connector.
Curved connectors retain both anchors and slide along the curve.

The diamond handle selects **Slider** controls (position and Static). **Segment**
contains the connector artwork and rig setup. Selected sliders show dotted A/B
guides to their anchors in Builder and Animate. These are editor guides only;
colors and width still belong to the segment. Connecting an existing parent and
tip creates another segment that may overlap the original artwork.

**Smart Stretch:** build the attached parts, select their controlling joint and
check **Smart Stretch**. This enables the driver and binds its descendants in one
undo command, including subsequently drawn parts automatically. Another enabled
ordinary driver starts a separate scope. Select an affected detail and choose
**Keep rigid · pass through** to move it without changing its size.
Ordinary drags rotate at the current length. **Hold Ctrl while dragging to
stretch** (Command also works). Moving a figure preserves its pose.

Stretch settings contain rest length, minimum/maximum ratios and width response.
Affected parts expose a signed linear **Multiplier**, **Reset impulse here** to
restart the axis at that joint, and **Stop at this joint** to protect a branch.
Attachment settings retain explicit driver picking and legacy influence/orientation.
**Angle lock** supports Figure, Movable parent and World references, with a signed
rotation multiplier for the parent mode. Locked drags preserve the angle; edit
**Locked angle** to change it. These controls support projection and mechanical
constructions across branches.
Disabling a driver removes its follower bindings atomically; Undo restores them.

A connector's span is determined by its anchors. Its Smart Stretch source can be
**Anchor distance**, **Slide position**, or **Distance × slide**, combined with an
inherited impulse when present. Limits constrain attached parts and never disconnect
the endpoints. Its middle joint still slides. For new automatic drivers, curvature
alone does not change distance-driven stretch. Older span responses remain intact.

Setup controls and blue relationship guides are confined to Build Figure.
Animate retains ordinary handles and the selected connector's Slide field.
**Test rig** opens an isolated temporary editor: drag controls, select named
controls, enter angle/length/slide values, Fit view or Reset test. Closing the test
preserves the live definition, animation and undo history.

## Editable 3D constructions

Open **Library → Rig examples**, or **Build Figure → Edit → Rig examples**.
Click a preview to try its controls, or **Add** to insert it directly.
Add to Animate works from either workspace: it keeps current builder changes,
switches to Animate, adds an independent editable copy, selects its primary
control, opens Properties and frames the selection. One Undo removes the added
copy while retaining the previous construction. Locked or hidden destination
layers show an error before leaving the builder.

Library preview windows also offer **Add to Animate**, retaining the angle, length
and slider values tried in the temporary editor. Closing a test without adding
still leaves the live scene unchanged. Static construction details remain
editable in the builder; only useful controls appear in animation and testing.

| Rig | Live construction |
| --- | --- |
| Counter-rotating gears | Drive turns a second wheel through a −1 parent angle lock; both axles stay fixed |
| Folding fan | Open drives nine ribs through fractional rotation multipliers, with connected filled leaves |
| Accordion screen | Fold alternates panel directions; Depth projects the width vectors while uprights remain rigid |
| Expanding crate | Expand widens the front while −1 stretch and impulse resets retract the receding edges |
| Perspective conveyor | Travel drives connector slide stretch; negative multipliers and corner resets shrink the moving frame toward its vanishing point |
| Box, Cylinder, Wedge, Pyramid, Gem | Five opaque solids with full yaw rotation, depth compression, height and individual colored faces |
| Glass cube | Eight projected corners, connected faces and a bead sliding along a moving diagonal |
| Meridian globe | Latitude and meridian connectors sharing projected vertices, with a highlighted equator |
| Double helix | Two rotating strands, connected rungs and a sliding rung attachment |
| Perspective tunnel | Sliding cross-sections on a depth span, connected wall panels and a nested dolly attachment |
| Orbital gyroscope | Three independent projected hoops, rotation controls and rigid orbit markers |
| Turbine assembly | Eight rotating blade faces inside a fixed connected cylindrical housing |

All sixteen examples use ordinary joint Angle, Length and connector Slide
properties, including in the gallery's isolated preview. There are no custom
sliders, artwork-drag rotation handlers or grouped color controls. Each face has
its own ordinary editable color. The city catalogue and assembled scenes remain
removed. Old preset control/shading metadata has no active behavior.

The five opaque solids now use Builder's general one-sided fill property, so all
their construction and appearance settings are available to user-created figures.
Preset identity is optional: removing it leaves evaluated geometry unchanged.
Joint names can be edited in Builder Properties. When drawing from overlapping
joints, the currently selected joint takes priority. Connect joints also accepts
the figure origin as its starting anchor through the Edit menu.

See [Build a rotating cube](ROTATING-CUBE.md) for an exact recipe using a blank
figure, two controls, four radii, eight corners, six fills and twelve connectors.

`node scripts/build-rig-collection.mjs` generates a reusable `.stkz` figure
and an animated `.styk` project per example in `artifacts/connector-3d-rigs/`. Projects are
73 ticks at 24 FPS, including a closing pose. These are editable 2D constructions
producing 3D-style projections. They do not add a mesh engine or depth sorting.

The rotating constructions transfer yaw through a connector whose sliding joint
is at its start. Attached radial vectors inherit that angle. A separate Smart
Stretch driver compresses their depth component. World-aligned vertical offsets
produce corners at `x = r cos(angle + yaw)`,
`y = height + depth × r sin(angle + yaw)`. Every visible edge connects two such
joints. Changing one control recomputes dependent edges and polygons; their poses
are not individually keyed or baked.

Select a fill in Build Figure to choose **Visible sides: Both / Front / Back**.
**Flip facing** reverses its visibility without changing vertex order or curved
edges. The first one-sided fill prompts for **Reference joints**: Origin, X and Y
form an independent, non-collinear triangle. For a rotating solid, ordinary
fixed guides attached to the figure origin provide that triangle. Subsequent
faces reuse the reference, with independent facing. Reference joints remain
editable through the fill's button. Invalid references fail before mutation;
deleting a guide used by surviving fills is rejected. Hidden faces stay available
in the Builder tree; canvas picking selects visible faces.

One-sided polygons store `_stykSurface: {basis: [origin, x, y], side: 'front' |
'back', flipped: boolean}`. Both removes this optional property. Older basis-only
records mean Front. Geometry uses signed area relative to the reference triangle,
preserving facing through mirrors and ID remapping. Collapsed references and
edge-on faces render hidden. No per-pose mesh state or depth sorting is retained;
this supports convex projected solids, not general intersecting 3D meshes.
Ordinary polygons remain double-sided. Native saving, Canvas, WebGPU, playback
and SVG share the same visibility decision. Pivot export rejects one-sided fills
instead of silently discarding them. Partial branch copies requiring outside
face references are rejected; copying the whole figure retains them.

Gallery thumbnails are generated lazily, one per animation frame, and their
geometry and rendering resources are released.

The solid regression suite checks 1,125 combinations of yaw, depth and height
against convex-hull coverage, plus reflection, whole-figure rotation, individual
face-color undo in both modes, native round trips, combined figures and invalid inputs.
`tests/builder-surfaces.test.mjs` additionally constructs a cube exclusively with
normal Builder commands and checks 1,083 projected poses. Its browser counterpart
creates a connector from Origin, draws from its overlapping attachment, and clicks
all six polygon cycles on the canvas. `tests/rig-solids.browser.mjs` covers ordinary
joint previews, face authoring, reference errors/reuse, reset, isolated previews,
insertion and compact/dark layouts. The renderer
suite compares editable WebGPU, prepared playback and SVG for every example.
The benchmark also compares 100 solid instances with and without surface
culling; see `artifacts/rig-constraints/benchmark.json` for measured CPU times.

## Data and evaluation contract

`src/rig-constraints.mjs` owns validation and evaluation. Segment `_stykRig`
metadata is optional; unconfigured figures retain the ordinary evaluation path.

```js
{
  connector: {start: 1, end: 2, restLength: 120},
  stretch: {restLength: 120, min: 0, max: 10, width: 'keep', branch: true},
  follow: {driver: 3, mode: 'stretch', influence: 1},
  response: {mode: 'stretch', multiplier: -1, reset: false},
  orientation: 'inherit'
}
```

Fields are optional. A connector cannot also be a follower. References name native
handle IDs (0 is the origin for connector anchors). Connector `length` and the
instance's corresponding length channel store the slide fraction 0–1. Actual
render length comes from its anchors. This retains native interpolation and
avoids a second pose channel or independent control map.

`stretch.branch` enables inheritance through the compiled hierarchy. Automatically
created `follow` entries carry `automatic: true`; their actual source resolves from
the current branch. New parts need no stored binding. Explicit older bindings
retain exponential `influence`; setting `response.multiplier` selects the new
linear response. `response.mode` is `stretch`, `rigid`, or `stop`. A reset redirects
the axis for the current part and descendants without discarding the ratio.

Connector `stretch.source` is `span` (default), `slide`, or `combined`; the latter
two store a nonzero `restPosition` in 0–1. Incoming impulses affect output, not
anchor geometry. `angleLock` stores `{mode, angle, multiplier}`; `figure` also
stores `restAngle`, while `parent` stores `reference`, `restAngle` and
`figureRestAngle`. The latter keeps whole-figure rotation outside the parent's
rotation multiplier. Older locks without this field retain their prior response. All
angles use radians. World locks ignore ancestor rotations; Figure locks use the
existing figure rotation channel. Parent references are captured from the nearest
movable ancestor at setup and remain stable native IDs.

The iterative dependency plan includes hierarchy, connector anchors and explicit
stretch drivers. Compilation is O(V + E), cached by definition, and yields during
cold validation/preparation. Cycles and missing references fail before publication.
Evaluation uses one state array per figure instance and carries no solver state
between frames. Collapsed/reversed spans, arbitrary seeks and undo are deterministic.
Widths and stretch influence are bounded. A fully compressed detail cannot be
directly inverse-posed until its driver expands.

`editor-rig-constraints.mjs` owns commands and sparse relationship history. Changes
invalidate affected figure instances. Duplicate/combine remap internal references
and retain external anchors as appropriate. Derived joints reject conflicting IK;
ordinary skeleton anchors can still be driven by IK. Shared geometry supplies
Canvas, WebGPU, prepared playback, polygons, joins and rendered exports.

Native `.styk`/`.stkz` saving preserves editable relationships. Pivot `.piv`/`.stk`
export rejects them with an actionable message rather than silently losing them.
Use native formats or rendered exports. Existing Stick Nodes imports remain
pose-only adaptations with their existing warnings; this implementation does not
claim to translate every imported Stick Nodes constraint. Setting a new figure
origin and splitting configured segments are guarded where their existing native
operations cannot preserve these relationships. Set the origin and split parts
before configuring them. Deleting an externally referenced anchor is rejected;
reconnect or remove its relationships first.

## Verification and measurements

The Builder surface update passed 126 focused rig/construction tests and the
full suite passed 1,997 of 1,998 tests. The existing scrub playhead-input test
still reports `''` instead of `'12'`; it is unrelated to this change. Syntax
checks passed for 914 JavaScript files. Browser checks passed for canvas face
creation, origin connectors, overlapping attachment selection, surface controls,
all sixteen example insertions, isolated tests, normal/Ctrl posing and compact
Builder menus. All nineteen sampled WebGPU/prepared renders matched exactly;
SVG stayed within the existing edge-antialiasing tolerance.

On Node 24.11.0 on this workstation, 100 solid instances evaluated in a median
13.38 ms with face visibility, versus 13.70 ms without it, reducing submitted
faces from 1,000 to 480. These are CPU geometry timings, not end-to-end frame
rates. The 20,000-connector case still takes about 53.6 ms synchronously and
needs prepared playback for responsive viewing. See the current benchmark JSON
and `artifacts/rig-solids/`, `artifacts/rig-insertion/` and `artifacts/rig-constraints/`
for this update's evidence. The reports below describe earlier revisions.

The imported-properties follow-up passed 101 focused rig tests, including native
file insertion for all sixteen examples and identical geometry at three poses
after removing each preset's identity and control metadata. The mechanism browser
suite checks preview-only sliders, ordinary imported properties and Test rig UI,
posed insertion, reversible native edits and compact/dark preview layouts.
The solid, rig-setup and insertion browser suites also passed, including normal
properties for opaque solids and preservation of builder work. The regenerated
ten mechanism asset/demo files passed decoding, inbetween and loop checks.

The earlier mechanism-asset follow-up passed 84 focused rig tests and the then-current
`tests/rig-mechanisms.browser.mjs` workflows: all five previews, live Animate
sliders, preview isolation, tested-pose insertion, exact gesture/insertion undo,
and compact/dark layouts. Existing rig setup and insertion browser suites also
passed. Nineteen sampled editable/prepared renders matched exactly; SVG stayed
within the existing antialiasing tolerance. Ten generated native asset/demo files
were decoded and checked at intermediate poses, with connected endpoints and
closed demo loops. Evidence is in `artifacts/rig-mechanisms/` and
`artifacts/rig-constraints/`. The full recorded run passed 1,988 of 1,989 tests;
the sole failure remains the existing scrub playhead-input assertion. Syntax,
changelog and whitespace checks passed.

The following reports describe the earlier connector and solid work.

`tests/rig-constraints.test.mjs` covers real sliding handles, curved/nested spans,
projection against an independent formula, collapse/reversal, record-order
independence, native container round trips, cooperative cancellation, joins,
combining, duplication, IK, sparse history and Ctrl-only stretch. The six advanced
rigs undergo repeated nonsequential poses, depth collapse and extreme slider poses.

`tests/rig-constraints.browser.mjs` exercises builder setup, actual normal/Ctrl
mouse drags, gesture undo, absence of blue rig pixels in Animate, temporary test
isolation, the gallery, file-input native imports, and compact/light/dark layouts.
`tests/rig-render.browser.mjs` compares editable WebGPU with prepared playback and
rasterized SVG. The six sampled poses produced identical editable/playback pixels;
SVG differs slightly at antialiased edges. Evidence is in `artifacts/rig-constraints/`.

`tests/rig-insertion.browser.mjs` adds all six examples through the Library UI,
checks selection and Animate mode, transfers a tested rotation and sliding pose,
and checks exact-document undo, retention of existing/new builder work and
locked-layer rejection. Its browser run passed with no page errors; screenshots
and a report are in `artifacts/rig-insertion/`. The insertion follow-up also
passed all 46 rig/builder-session unit tests and syntax checks for 898 JavaScript
files.

The preceding full feature unit run passed 1,917 of 1,918 tests. Its remaining failure is the
existing `tests/scrub-backpressure.test.mjs` playhead-input assertion (`''` versus
`'12'`), also reproduced independently. All 36 rig unit tests passed. The repository
syntax check passed for 896 JavaScript files, and the changelog check passed.

On this Windows workstation with Node 24.11.0, the final standalone geometry
benchmark measured median times of 2.04 ms for 1,000 connector segments, 7.95 ms
for 5,000 and 44.57 ms for 20,000. The six example rigs measured 0.11–0.84 ms
median (0.22–1.68 ms p95). These are geometry timings, not end-to-end frame rates.
20,000 constrained segments exceed a 60 FPS synchronous editing budget; prepared
playback retains the existing worker and bounded-cache path. GC heap differences
are reported as diagnostics, not a proof of leak absence. Reproduce with
`node --expose-gc scripts/benchmark-rig-constraints.mjs`.

## Reference behavior

See [the guide/video/APK study](STICK-NODES-RIGGING-RESEARCH.md) for the inspected
Stick Nodes formulas, behavioral differences, setup recipes and the latest
Smart Stretch/angle-lock verification, including 69 focused tests and 14 rendered
comparisons. Measurements above record the earlier connector work.

Stick Nodes' [connector update](https://sticknodes.com/new-version-4-2-0-the-connector-joint-update/)
establishes two-anchor connectors and their middle attachment joint. Its
[Smart Stretch update](https://sticknodes.com/new-version-2-4-8-the-one-stretchy-boi-update/comment-page-5/)
describes deformation of attached parts. StykAnimate uses its own native dependency
model and one-action setup, with explicit rigid exceptions and Ctrl-to-stretch
posing as requested.
