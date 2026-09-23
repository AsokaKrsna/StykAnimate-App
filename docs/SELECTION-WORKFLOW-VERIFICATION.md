# Selection workflow verification

Date: 2026-09-23. Source version: 1.0.6 with Unreleased changes.

## Result

The selection controls and transform feedback are ready for a release candidate.
This is source verification, not certification of a new packaged release. No
version was changed, package built, tag pushed, or release published.

Implemented: saved Bounds/Origins rectangle selection; remappable selection and
range toggles; Ctrl/Cmd membership clicks without pose/history edits; preserved
Ctrl-drag constraints and stretch; a timeline range control sharing inspector
state; selected-handle priority for Alt transforms; a visible transform pivot.

Model ownership, native identities, frame timing and save formats are unchanged.
Selection uses the existing selection commands; range movement uses the existing
atomic editor command. No document clone, persistent cache, background job or
new dependency was added to selection hit testing or pivot feedback.

## Checks

| Check | Evidence |
| --- | --- |
| Full root unit suite | 2,880 passed, 1 skipped, 0 failed; artifacts/selection-workflow/unit-tests.log |
| Focused final unit checks | 119 passed: canvas interactions, shortcuts, selection, figure transforms, range operations, changelog |
| New pointer/UI acceptance | 37 checks; artifacts/selection-workflow/report.json |
| Existing figure range acceptance | 19 operations, atomic undo, unselected frames and worker output; artifacts/range-actions-app.json |
| Multi-figure transforms | 11 checks: modifiers, shared pivot, undo and cancellation; artifacts/multi-figure-transform/report.json |
| Joining and tablet interaction | Existing join-selection and pen-input browser suites passed; task logs under artifacts/selection-workflow |
| Desktop source smoke | Passed: WebGPU, isolation, native imports/save and save/cancel on close; desktop-smoke-final.log |
| Desktop update smoke | Passed: progress, restart/save protection and development status; desktop-updates-isolated.log |
| Update/release-asset unit checks | All 8 passed |
| Changelog | Ordering, duplicates, version alignment and generated notes passed |
| Render inspection | Initial, attached-pivot and compact 1100 px screenshots inspected |

The syntax-check result is recorded in artifacts/selection-workflow/syntax.log.
Application source hashes are recorded in source-hashes.json in that directory.

Electron initially crashed inside the filesystem sandbox. The same smoke scripts
passed when rerun outside it. These are source-app checks, not installer or
packaged-resource checks. Physical tablets and macOS/Linux execution were not
exercised by this task.

Older browser scripts failed against the unchanged app entry point too. Their
fixtures now use the existing Open shortcut and current stacking/unjoin controls,
assert displayed segment RGB instead of a superseded color-override field, and
expect group origins to orbit the shared pivot. No range/transform model behavior
was changed to accommodate those assertions.

## Performance

Node 24.11.0, baseline 7cd407da457653883ff859432c799c61203d8ced.
Run: node scripts/benchmark-selection-workflow.mjs <baseline-ref>.
Raw results: artifacts/selection-workflow/performance.json.

| Synthetic CPU workload | Before p95 | After p95 |
| --- | ---: | ---: |
| Bounds intersection, 5,000 figures with cached bounds | 2.110 ms | 0.215 ms |
| Origin intersection, same 5,000 figures | — | 0.202 ms |
| Warm indexed picking, 30,000 handles | 0.0064 ms | 0.0043 ms |

Bounds hits were checked for exact parity. Origin mode reads one evaluated root
per figure and never measures artwork. Bounds mode avoids the old temporary
point/map arrays. Picking retains the existing spatial index. Pivot feedback is
a constant-size overlay drawn only during a transform. These timings measure
hit testing, not complete interaction latency, GPU performance or other devices.

## Release readiness

Ready to begin release preparation once the intended release scope is settled.
The workspace also contains separate, uncommitted rig/autopose work that this
task did not edit or independently certify. Before publishing:

1. Review and freeze all changes intended for the release.
2. Choose a new version, move Unreleased notes, align package versions and
   generate notes with the documented release preparation script.
3. Build and verify the exact versioned package, run its packaged smoke tests,
   and verify installer/portable artifacts and the installed update path.

Follow RELEASING.md and DESKTOP-RELEASE.md. Passing source tests does not replace
the exact-artifact gates or authorize publication.
