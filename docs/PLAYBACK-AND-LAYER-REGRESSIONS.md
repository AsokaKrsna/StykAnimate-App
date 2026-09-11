# Playback and layer insertion regressions

## Causes and changes

Layer-sheet evaluation can assemble objects in layer order. A structural edit normalizes their storage slots into UID order. The old pose comparison treated those slot changes as edits to unrelated layers. Capture then assigned every unregistered object to whichever changed layer was processed first. In the supplied movieclip project, Layer 1 captured an insertion intended for Layer 3; unrelated captured keys could also lose their movieclip patches.

Pose comparison now uses saved properties and attachment identities, excluding storage slots and transient geometry/movieclip samples. Layer-local draw order is compared separately. The commit resolves new-instance ownership before capturing any layer, honoring duplicate/paste hints and the selected user layer. Unchanged layers retain their keys and sources. Inserting beyond a short layer's end writes at the requested tick rather than editing an expired hold. Ownership, definitions and poses remain in the existing atomic history command and native save format.

The playback report exposed repeated raster-cache eviction around a large change in artwork. A frame's ordered raster working set could exceed the cache, causing ordinary LRU to evict each upcoming hit while processing earlier misses. The worker also capped its already-partitioned raster allocation at another quarter of the packet allowance, and reset definition/signature memoization every frame despite holding an unchanged document revision.

The worker now retains a bounded reusable subset across frame traversals. Misses that would displace current or previous-frame hits pass directly to the packet; stale entries become replaceable after a frame without use. Independent packet clones and disposal semantics remain intact. Raster retention uses the existing hardware allocation, capped by the packet limit. Definition memoization uses the worker revision. Finally, the UI delegates lookahead admission to `PlaybackCache`, which accounts for shared bitmap footprints, instead of limiting it again using one frame's full size. These changes do not alter raster resolution, drawing semantics, source files, or export data.

## Verification on 2026-09-10

- Generated layer regressions cover reversed layer order, materialized poses, locked unrelated layers, ordinary figures and movieclips at ticks 0/5/19, duplicate ownership, permanent-track fallback, rejection on locked destinations, undo/redo and reload. Seven cases fail with the original commit method and pass with the fix. Attachment signatures are also checked through slot normalization and runtime-cache getters.
- The supplied `Goofy running movieclips test.styk` accepts a movieclip on Layer 3 at tick 5, retains it after seeking and undo/redo, and preserves it through binary STYK export/import. The source file is not overwritten.
- A cold sequential worker pass through `Raven Demo Redone.piv`, at scale 1, measured ticks 188–229: mean preparation fell from **69.3 ms to 44.3 ms** (36%); median 65.4 to 40.6 ms; p95 106.3 to 69.4 ms. Raster hits increased from 4 to 492. These are worker preparation measurements, not a claim of a 36% improvement in display FPS.
- Actual browser playback presents all **295 exact ticks** from the beginning and all 120 ticks when starting at tick 175. The affected section averaged approximately 18.6 FPS from the beginning and 19.3 FPS from tick 175 in the final run, at a requested 20 FPS. Scene-transition submission spikes remain; this is not a claim of zero stalls on all hardware.
- The browser cache-pressure regression compares **1,110,720 color channels** against uncached rendering with zero differences, verifies retention stays within its explicit limit, checks unchanged definitions are not serialized again, and checks changed definitions invalidate and render fresh pixels.
- Final full unit run: **1,495 passed / 1,504 total**. Nine existing animation/keyframing/materialization failures reproduce with the original pose-commit method. The existing `tests/playback.browser.mjs` stage-cropping assertion also fails identically before and after these changes (8,332,800 differing channels). It remains a separate preview-rendering issue. No new unit-suite failures were observed.

## Reproduction

Run `node scripts/serve.mjs`, then:

```powershell
node --test tests/editor-layer-insertion.test.mjs tests/pose-snapshot-identity.test.mjs tests/playback-raster-cache.test.mjs
node tests/playback-cache-pressure.browser.mjs
node scripts/verify-imported-playback.mjs 'path/to/animation.piv' 'path/to/layered.styk'
```

`STYK_URL` can select another running local server. Browser probes use installed Chrome through Playwright. Reports and screenshots are written under `artifacts/imported-playback/`; cache-pressure results are in `artifacts/playback-cache-pressure.json`. Timings depend on hardware, browser scheduling, and other work on the host. Physical display latency and packaged-app performance were not measured.

## Follow-up: layer ownership audit

The broader audit reproduced additional failures outside the supplied project:

- Ordinary group paste retained the clipboard's source layers while single-figure paste used the selected layer. New group copies now use the selected user layer. Duplicate commands preserve original owners, and repeated appearances of the same movieclip identity retain their existing owner and clock.
- Range insertion could assign figures to Scene or Camera. Pose and range commits now share an ownership resolver, and publication validates the complete layer metadata before changing the document.
- Clip paste used an exposure patch even when the destination had no exposure, silently dropping the insertion. Insertion now creates an exposure when necessary. Extending a populated short layer also adds an explicit blank boundary at its old end, so expired figures stay absent before the requested insertion.
- Moving ownership rebuilt every affected track at a union of sparse boundaries, changing curves, gaps and movieclip phases. Equivalent tracks retain their original keys; a vacant destination can share a source's immutable poses and timing. Combining independently timed tracks samples the destination at integer output frames with hold keys. Source timing and curves remain unchanged. This may produce more destination keys, as required by the current complete-pose-per-layer model.
- Timeline paste could lose figures after their original identities moved elsewhere. Such copies now receive new destination identities without taking ownership away from the moved originals. Duplicate destination rows and incompatible permanent/user track combinations reject atomically.
- Sparse timeline copies now include a source layer's ending boundary. Paste reserves the complete copied duration before inserting its keys, preserving both the animation between keys and absence after a short source ends.
- Deletion could retain invalid historical assignments, bring deleted members into the fallback layer, or move children attached to a deleted parent. The deletion plan clears ownership references and preserves detached children's world geometry. It inspects sources used by surviving user tracks and only resamples tracks that depend on removed content; unrelated retained history assets do not trigger resampling.

Move and deletion planners share bounded sampling, source-memory and key-count checks. The inspector and timeline use cooperative async preparation with progress and cancellation. Cancellation, budget rejection or a concurrent document edit leaves the pending operation unpublished. Metadata, sources and poses publish together as one existing history command. Ordered key insertion avoids repeatedly scanning and sorting growing sampled tracks. The native file schema is unchanged.

Verification:

- **46 new ownership audit cases**, plus the existing insertion, layer, migration, clipboard, range and movieclip checks: **270/270 focused tests pass**. Coverage includes reversed layer order, empty/short/held/populated destinations, import, group paste, duplicate ownership, timeline clipboard reuse after moves, independent curves, attachment geometry, clip patches/continuations, locks, cancellation, budgets, undo/redo and reload.
- The current browser workflow passes inspector reassignment of an animated movieclip into an independently timed populated layer, keyboard undo/redo, new-layer insertion and timeline deletion. All **24 output ticks** and ownership survive binary STYK save/reload in the generated fixture.
- The supplied Goofy project accepts UID 8 on Layer 3 at tick 5. Undo/redo and a **1,990,622-byte binary STYK round trip** preserve all 20 output ticks and ownership. The input file is unchanged.
- The final full unit suite reports **1,551 passed / 1,560 total**. Its nine failures match the previously recorded animation/property/materialization baseline. JavaScript syntax checks report no errors. An intermittent clipboard decoder cancellation failure in an earlier parallel run passed both its isolated 10-test file and the final full run.
- Two older timeline browser scripts could not complete their current UI workflows: `layer-timeline.browser.mjs` assumes the former F6 behavior, and `layer-timeline-modern.browser.mjs` waits for the absent “Insert keyframe here” button. The new targeted browser test uses current controls. Those older scripts are not reported as passing.

```powershell
node --test tests/layer-ownership-audit.test.mjs tests/editor-layer-insertion.test.mjs
node tests/layer-ownership.browser.mjs
node tests/layer-ownership.browser.mjs 'C:/Users/aleri/Downloads/Goofy running movieclips test.styk'
```

Generated and supplied-file browser results are under `artifacts/layer-ownership-browser.*` and `artifacts/layer-ownership-supplied.*`. Focused and full test logs are `artifacts/layer-audit-focused.log` and `artifacts/layer-audit-full.log`.
