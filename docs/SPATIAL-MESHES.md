# Attached spatial meshes

A movieclip definition can store immutable indexed `spatialMeshes`, one per local
frame. Each mesh has flat XYZ `positions`, triangular `indices`, RGB `colors`, and
one palette index per triangle in `materials`. The existing single-frame playback
offset and named drawing groups select forms. `drawingRotation` is mutually
exclusive: turning a mesh never switches drawings or interpolates silhouettes.

An attachment to a spatial bone evaluates its vertices through that bone's
existing spatial frame, then applies figure transforms and perspective. Rotation,
tilt, roll, stretch and part proportions stay in the rig's existing pose channels.
Only the container handle belongs to the editable joint graph. Geometry is authored
offline; entering an empty movieclip editor is rejected with posing guidance.

The geometry evaluator emits the same depth-tested triangles used by native
surfaces. Near clipping, Canvas/WebGPU presentation, worker preparation and rendered
exports use the existing rendering path. Evaluation yields within dense meshes.
Incremental geometry retains projected arrays when the attachment transform is
unchanged, and rebinds appearance without retaining the previous geometry. A small
numeric transform key belongs to that pose; there is no second render cache.
Affine bone transforms are evaluated four times per mesh rather than once per
vertex; non-linear taper keeps the existing point evaluator. Palette colors
use the normal object color override. Immutable mesh arrays are shared by definition
snapshots, as clip documents are, rather than cloned into every history entry.

Native STYK/STKZ retain the indexed mesh. Explicit Break apart/Bake and legacy
materialization convert the evaluated visible faces into ordinary native fills
with depth guides; this is intentionally more expensive and loses 3D editability
for that baked pose. It is never used during dragging or prepared playback.

Validation bounds form count, coordinates, vertices, indices, palette entries and
total asset geometry. Mesh winding is outward in local XYZ; front-facing triangles
have positive screen area before reflection. Shapes and texture detail must be
authored and visually checked; format validation cannot establish reference likeness.

`tests/movieclip-mesh.test.mjs` covers invalid assets, reflection, perspective,
near clipping, both timeline modes, form undo/redo, native round trips, immutable
history sharing, and materialization. It compares incremental poses with fresh
evaluation throughout full turns and vertical tilts.
