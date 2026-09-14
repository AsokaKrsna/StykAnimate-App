# Figure joining and static-node selection

In Animate, **J** and **Join figure / Unjoin figure** in the canvas context menu
or inspector invoke the same action. A selected node or branch resolves to its
owning figure. An independently selected group of multiple figures is ambiguous
and disables this action. A branch selection may include attached descendants;
the action still operates only on the branch's owning figure.

An unjoined figure enters parent-handle picking. Eligible handles appear white,
including static handles. The source and its descendants are excluded to prevent
cycles. Hidden and locked figures cannot be sources or targets. Clicking a target
attaches the source's origin; unjoining retains its visible position. Each edit
is one undo step, including an enabled timeline range. Escape or a second J
cancels picking. Selection, document, frame, playhead and revision changes cancel
stale gestures. Text inputs and the figure builder do not dispatch this command.

Clicking a hidden static endpoint selects its figure/node without moving its pose
or recording history. Shift-click toggles figure membership. Double-click on a
static endpoint selects its connected group, using the app's existing connected
selection rules. Dynamic-node double-click retains branch selection. Normal
visible handles take priority over hidden static targets. Static posing still
requires the existing explicit editing tools; ordinary static-node dragging
does not alter the pose.

**Shift+J** now controls handle visibility. Preferences migrate only the exact old
default J visibility binding when the new join command is absent. Custom bindings
and explicitly disabled commands survive normalization. Menus, tooltips, settings
and dispatch use the common shortcut catalog.

## Implementation

`figure-join-action.mjs` resolves the owning instance and builds the eligible
target set with an iterative traversal by native object slots. `app.mjs` owns the
temporary gesture, shared action and menu item. It calls the existing sparse
figure-range planner with an explicit source UID, at the playhead or captured
range ticks. This preserves native handles/IDs, authored membership, sparse
history and atomic range validation without a second join implementation.

`canvas-interactions.mjs` supplies descriptors for both drawing and picking.
Static selection targets are lazy, separate from painted handles, and cached by
geometry through weak maps. Hover retains the visible-handle path. Picking reuses
the spatial index; the target traversal runs once per join gesture, not once per
node. Temporary selection data is neither saved nor added to document history.

## Pivot evidence

The parent `tools/pivot_decoder.py` decodes static status from flag bit `0x0100`
(the low bit of the auxiliary byte in modern segments). The parent's
`tools/piv_document.py` writes joins as a target object slot and native handle ID,
resolving persistent UIDs before serialization. Origin handle zero is distinct
from a segment array index.

`python scripts/inspect-pivot-joining.py` uses the parent's Capstone/PE tools and
asserts seven instructions against the supplied Pivot 5.2.11 executable, SHA-256
`2c7911d3303cc28de2ac016c3f7575082aa47680e63a0fe8930ce8799de3df98`:

- J at `0xB1E0FD` calls the button handler `0xB24248`.
- That handler requires one selected figure and branches on its attachment flag.
- Mouse-up uses a separate soft figure hit at `0x948CB8`; repeated clicks call
  joined selection at `0x94C080`. This is distinct from draggable-handle picking.
- The existing `artifacts/native-static/joined-handle-routing.md` describes static
  drag filtering and suppression of attached origins.

This is static executable analysis, not a new interactive native Pivot capture.
Pivot's [joining reference](https://www.pivotanimator.net/help5-2/joining_figures.htm)
and [selection reference](https://www.pivotanimator.net/help5-2/multi_figure_selection.htm)
also describe origin attachment, static targets, single-figure joining and
double-click joined selection. The app retains its existing whole-connected-group
and dynamic-branch double-click semantics.

## Verification

- `npm run check`: 939 JavaScript files checked, zero syntax errors.
- `npm test`: all 2,046 unit tests passed on the first full run. The final run
  passed 2,045 with the existing midnight-sensitive telemetry case failing;
  feature tests passed. See the limitation below.
- `node tests/join-selection.browser.mjs`: 49 checks passed using real input,
  with Simple/Advanced joins, static selection, context/inspector parity, range
  undo, cancellation, custom shortcuts and no uncaught browser errors.
- `node tests/connected-selection.browser.mjs`: connected/branch selection and
  copy/paste regression passed. Its count now reads the displayed selection
  frame, which includes authored figures, rather than the native source frame.
- `node scripts/benchmark-node-selection.mjs`: a synthetic 30,000-segment rig
  (29,000 static nodes) took about 22 ms for cold selection descriptors, 9 ms
  for its first spatial index and 0.0084 ms at the 95th percentile of 1,000 warm
  picks on this workstation. These are Node hit-testing measurements, not an
  end-to-end frame-rate claim.

Screenshots, machine-readable checks and benchmark results are generated under
`artifacts/join-selection/`. One broader browser script,
`tests/hotkeys-timeline.browser.mjs`, still fails its existing duration-growth
assertion after rebinding Add Frame: the command runs and inserts a key at tick 1
without extending duration. This task's join rebinding checks pass. That separate
timeline behavior has not been changed.

The final unit run began after 23:40 UTC. `tests/telemetry.test.mjs:79` advances
its wall-clock fixture by 20 minutes and then assumes one day's idle counter is
present. It failed independently at the same boundary and passed in a temporary
copy with a fixed noon clock (all 11 telemetry cases passed). No telemetry source
or tests were changed. The final full-suite log retains the failure rather than
claiming a fully green rerun.
