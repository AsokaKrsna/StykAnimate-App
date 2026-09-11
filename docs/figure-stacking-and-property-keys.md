# Figure stacking and property keys

The figure inspector exposes **Z-index** under Stacking. Higher values draw in
front within the same user layer. Equal values preserve the pose's native draw
order. Z-index is an integer from −1,000,000 to 1,000,000, defaults to zero, and
uses Constant interpolation: the order changes exactly at the next key.

Segment and polygon Order controls also belong to the current timeline pose.
Numeric edits, ordering buttons and branch ordering retain a combined drawing
sequence for that figure instance. Editing another frame does not rewrite the
shared figure definition or the order saved in earlier frames. Playback and
native export preserve these internal orders.

The canvas toolbar resolves the complete selection before choosing its order
scope. A selection spanning attached figures moves all selected instances within
their user layers, preserving their relative paint order and each figure's
internal artwork. A selected joint in a single-segment figure, or a branch
containing an entire figure, also moves the instance in scene order. A partial
segment or branch selection confined to one figure changes only its internal
order. Repeating a move at a boundary does not change scope or create history.
The inspector's explicit segment and polygon Order controls remain internal.

Blue diamonds indicate independent property animation. Filled diamonds mark a
key at the current frame; outlines indicate animation between keys. Values that
are only stored in pose keys have no inspector diamond or key-navigation controls.
Joint transforms have no separate keyframe controls. The inspector omits explanatory paragraphs,
key legends and subtitles.

In the app, editing an independently animatable property adds or updates its
own key at the current frame, including the first edit. Property-only edits do
not add Pose keys. Deleting the last authored key restores the native baseline;
the next property edit creates its channel again. Mixed pose gestures separate
changed properties from skeleton changes. See [Independent property channels](property-channels.md)
for the complete property list and compatibility behavior.

## Implementation

- `animation-properties.mjs` defines channel names, supported targets and
  discrete properties, shared by validation, sampling, easing and the timeline.
- `animation-property-state.mjs` derives inspector provenance without persisting
  synthetic scalar keys. It uses binary key lookup and weakly cached key facts.
- Z-index channels target stable figure UIDs. Composition writes `_stykZIndex`
  on an evaluated object using copy-on-write, retaining its geometry vectors.
  Captured poses/clipboard objects retain this small override.
- `applyLayerOrder` stably sorts depths within user layers after pose and scalar
  composition. Object slots and attachment references are never reordered.
- Authored order commands write Z-index keys directly, including tied depths,
  so independent figure poses cannot override them. Native-only editing retains
  native paint order. History and range edits remain atomic. The canvas toolbar
  provides Bring to front and Send to back for the current selection. Holding
  Shift while clicking moves the selection one step forward or backward instead.
- Worker playback and export use the same evaluator. Pivot materialization
  writes the resulting native draw order and removes the depth extension.

Regression coverage lives in `tests/figure-z-index.test.mjs` and
`tests/figure-z-index.browser.mjs`, alongside existing animation, property-control,
timeline, range-operation and clipboard checks.

`tests/selection-order.test.mjs` covers selection scope, joined groups, stable
ordering, history and reopening. `node tests/selection-order.browser.mjs` checks
actual joint double-clicks and toolbar clicks in Simple and Advanced, including
Shift moves, rendered order, unchanged poses/attachments and STYK/PIV round trips.
It also accepts the reported `Firing Range Bren MKII.piv` path as its argument;
the external project is read only and test exports stay in memory.
