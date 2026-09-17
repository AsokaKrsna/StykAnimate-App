# Playback integrity review — September 16, 2026

The performance work preceding this review introduced GPU texture reuse and
multiple preparation workers. The user reported flickering, disappearing objects
and unexpected artwork. This review reproduces and fixes specific ownership and
identity failures. The follow-up adds user-selected playback quality and targets remaining stalls; full-quality, stall-free 60 fps is not established.

## Reproduced failures and fixes

1. A pool keyed only by dimensions reused RGBA bitmap targets as BGRA vector
   targets, and reused vector textures without COPY_DST for image uploads. The
   real GPU rejected those operations. `tests/playback-pool.browser.mjs` reproduced
   invalid render batches, invalid copies and changed pixels. Pool classes now
   separate format/usage contracts. Failed uploads destroy their failed leases.
2. Sampling a subrectangle of a recycled texture could filter against pixels
   belonging to the previous object. Subpixel-position tests found up to 52/255
   channel differences at borders. Reuse now requires the exact original size;
   padded textures and their UV remapping were removed. The fixture compares fresh allocations against
   recycled allocations, with strict equality and GPU validation scopes.
3. Worker-local registry counters produced identical fallback keys for unrelated
   artwork in different workers. Independent-module tests reproduced the alias.
   A unique realm namespace now scopes every local fallback identity.
4. Embedded-image identities trusted a 32-bit payload hash. Two different,
   equal-length payloads with the same hash reproduced incorrect sharing.
   Original strings now resolve local bucket collisions; transferable keys
   include SHA-256 payload digests. Payload digests are reused per immutable
   string without serializing the full image into each geometry signature.
5. Cached image signatures retained old placement metadata after the payload
   stayed unchanged. A display-width edit reproduced stale identity. Metadata
   is now resnapshotted while retaining only unchanged payload fingerprints.
6. GPU antialias and scratch pools had no retention bound. They now follow
   explicit allocations in the shared memory policy. Batches release/trim
   scratch only after submission or cancellation. Recycled targets have the
   same dimensions and reservation as fresh targets, preserving protected warm frames.
7. The preview governor resized the canvas after presentation, clearing that
   task's completed image. On the following advance, view synchronization also
   discarded the selected packet and triggered synchronous live rendering.
   Quality changes now commit before painting, and an uploaded current pose
   survives density-only invalidation until its replacement is ready. The
   desktop regression reproduces four unpainted resizes and five live draws
   with the earlier app; the fix passes all four transitions with authored
   frame colors, sequential ticks and no live fallback or GPU errors.
8. A concurrently introduced history optimization dropped `runtime_segments`
   from native topology snapshots, losing imported lengths/bends on undo. Its
   numeric-array replacement also changed serialization field order. Native
   history now explicitly preserves runtime records; clipboard snapshots retain
   their existing omission policy. Numeric arrays remain independent and use
   the fast copy while preserving field order. Six existing regressions failed
   before the correction and pass afterward, including native PIV/STK roundtrips.

## Evidence and scope

Input: `C:\Users\aleri\Desktop\uriel pivot\svr_uriel.piv`, 594 ticks at authored
21 fps, 700 × 400, 433 definitions and up to 792 objects. SHA-256:
`62cbfd3e5befc2ae45b1d85f6f8da1c7deb0c518b9b5eab84ad21c5ac7904a80`.
The source is read-only throughout the checks.

`scripts/verify-project-playback-sequence.mjs` compares every tick from three real
workers through a five-frame GPU LRU with independently evaluated frames and the
pre-pooling renderer captured in `artifacts/project-playback/perf-pool-30/sources`.
It exercises eviction, incremental uploads and cancellation while retaining the
previously displayed frame. GPU validation errors fail the test. Canvas snapshots
are taken in the submission task, before WebGPU may clear a presented swap-chain
surface; waiting before capture can create a false blank-frame failure.

The complete sequence after the exact-size pool and image-identity fixes passed all 594 ticks,
6,825 intermediate upload slices and 25 cancellations, at full preview quality,
with no GPU errors, no held-frame changes and no interior mismatches. Differences
against the pre-pooling renderer remain on antialiased edges: 592 frames are byte
identical. Tick 175 has a maximum channel difference of 9/255 and mean
0.000324/255; tick 252 differs by 1/255 in one channel. This
does not establish universal pixel identity across all renderers or export modes.
Evidence: `artifacts/playback-integrity/sequence-exact-final/report.json`.
Source hashes were unchanged during this run.

All 17 browser regression suites passed after exact-size reuse, including GPU
pooling, staged/cancelled uploads, artwork and opacity, pressure limits, software
fallback, recovery, image formats, and export sampling/memory. The additional
quality-transition desktop check passed 68 sequential ticks at four density
changes. Evidence: `artifacts/playback-integrity/browser-regressions.json`,
`quality-baseline-report.json`, `quality-transition/report.json`.

The final full unit run passed 2,196 tests with no failures or skips
(`unit-tests-corrected.log`). Syntax validation checked 1,035 JavaScript files
with zero errors; changelog validation passed. The 1,000-figure desktop fixture retained geometry
identity, uploaded zero geometry bytes during translation, and committed the
expected position. Warm playback was 60.00 fps with zero skipped ticks and a
21.4 ms maximum interval. Pointer receipt to submission was 1.3 ms at p95 and
1.7 ms maximum. This simpler fixture does not substitute for the reference file.

## Performance remains incomplete

Full-animation Electron runs at a 60 fps target, 2200 × 1400 window, DPR 1:

| Source capture | Effective fps | Worst interval | 99th percentile | GPU errors |
| --- | ---: | ---: | ---: | ---: |
| `integrity-fixed-60` | 47.8 | 176.7 ms | 92.7 ms | 0 |
| `integrity-bounded-60` | 45.3 | 169.9 ms | 83.3 ms | 0 |
| `integrity-exact-full-60` | 38.5 | 220.3 ms | 96.6 ms | 0 |
| `integrity-transition-full-60` | 40.6 | 233.4 ms | 104.8 ms | 0 |

These runs preserve all 594 ticks at full quality. The bounded run removed the
observed main-thread task over 50 ms and limited foreground upload calls to
1.7 ms, but does not establish a throughput improvement. These runs precede the
additional embedded-image identity fixes. The exact-size run includes those
fixes and no source changes during the run; a diagnostic override fixes preview
quality at full resolution, recorded in the report and executed-app hash. It
had no main-thread tasks over 50 ms, but severe presentation gaps remain.
Performance figures are GPU submission
intervals, not physical display measurements. There is no claim of stable 60 fps,
zero stalls, perfect architecture or absence of all regressions.

The transition run includes the viewport transaction fix and has no live
fallback draws. Only a raster-helper comment changed during its immutable source
capture. A separate scratch-target pooling experiment retained reference pixels
across 66 dense ticks, but its full run reached only 41.6 fps with a 212.3 ms worst
gap. That small difference does not establish a reliable benefit; the experiment
remains in ignored artifacts and is not part of the app. Tracing still shows
long GPU raster flushes and substantial worker garbage-collection activity.

The automatic-quality run after the transaction fix
(`integrity-transition-adaptive-60`) presented all 594 ticks with zero live
fallback draws, zero GPU errors and no main-thread tasks over 50 ms. It averaged
50.7 fps with a 167.8 ms worst interval. Quality dropped at ticks 98 and 185;
this is explicitly not a full-quality performance result. Source hashes and the
input file remained unchanged during that run.

A diagnostic with one preparation worker and unchanged full-quality/cache
settings (`integrity-one-worker-full-60`) reached 42.7 fps, with 625 compiled
packets and a 146.3 ms worst interval. This points to contention and speculative
work as contributors, but does not meet the target or establish that one worker
is the best general policy. Production worker selection remains unchanged.

Further verification and profiling remain necessary for the complete goal,
including the final image-identity bytes, editing/export consistency and actual
presentation cadence under dense raster work. Do not trade source geometry,
visibility, authored timing or image identity for a higher benchmark number.


## Playback settings and stall investigation

The follow-up adds **Settings → Animation → Playback quality**: Normal (100%,
default), Medium (75%), Low (50%), Draft (25%), and opt-in Automatic. Draft is
explicitly selected; the automatic governor retains its 50% floor. Fixed modes keep their
selected density rather than oscillating with FPS samples. They reuse the existing
quality transaction, cache invalidation and renderer; stopping restores editing
resolution. The preference is persisted independently of the document and is not
read by export. No whole-animation preparation phase or completed-frame cache was
added. The lossless finished-preview prototype is archived under ignored artifacts;
it is not part of the application.

The retained-geometry planner now passes only the object map and generation token
into incremental geometry preparation. Spreading the previous geometry evaluated
its lazy `drawables` getter and unnecessarily flattened the entire previous scene.
A regression test makes that getter throw while checking valid geometry reuse.

Two additional stall experiments were rejected. Increasing CPU path rasterization
from 262,144 to 1,048,576 pixels reduced Low-quality presentation gaps, but the
complete pixel comparison exposed coverage/blending differences in layered art.
It is **not shipped**. The original fixed raster routing remains intact. GPU
upload fencing increased foreground upload work without a clear cadence benefit
and was also removed. The measured performance gains of either experiment must
not be attributed to the final application.

The source inspection identifies these examples (frame numbers are one-based;
source timing is 21 fps):

| Frame / source time | Contents |
| --- | --- |
| 49 / 2.29 s | 80 figures, 4,022 line segments; several large overlapping vector rasters. |
| 130 / 6.14 s | 384 figures, including 336 instances of `SmartSmear3`; 27,442 line segments. |
| 163 / 7.71 s | 105 figures, 3,926 line segments; full-quality packet about 78 MiB, dominated by large overlapping vector rasters. |
| 176 / 8.33 s | 184 figures, 8,701 lines and five image segments. |
| 203 / 9.62 s | 382 figures, 364 `SmartSmear3` instances and two 2,562-segment figures; 29,631 lines. |
| 483 / 22.95 s | 123 figures, 115 `SmartSmear3` instances, 9,866 lines and a text mask. |

The displayed frame alone does not explain every gap: in the low-quality baseline,
frame 130's packet was ready about 920 ms before presentation. Background raster
work and GPU contention also delay presentation. Packet contents and timestamps are
recorded in the benchmark reports, rather than attributing all stalls to parsing.

### Performance experiment results

Ryzen 5 5500, NVIDIA Lovelace, DPR 1, 2200 × 1400 window. Runs request 60 fps in
memory, present all 594 ticks in order, and leave the input PIV unchanged. These
are submission cadence measurements, not physical-display timings.

| Captured source | Effective fps | P99 interval | Worst interval | Disposition |
| --- | ---: | ---: | ---: | --- |
| `quality-low-before-fence` / Low | 56.4 | 43.3 ms | 166.9 ms | Original raster path, retained |
| `quality-low-fence` / Low¹ | 55.2 | 52.6 ms | 164.6 ms | Repeat baseline |
| `quality-low-paced-uploads` / Low | 56.3 | 51.2 ms | 158.2 ms | GPU pacing rejected |
| `quality-low-bounded-paths` / Low | 57.3 | 41.4 ms | 67.1 ms | CPU raster change rejected for pixel differences |
| `quality-normal-final` / Normal² | 41.9 | 88.6 ms | 205.6 ms | CPU raster candidate, subsequently rejected |
| `quality-medium-final` / Medium² | 44.9 | 73.5 ms | 169.8 ms | CPU raster candidate, subsequently rejected |
| `quality-low-desktop-final` / Low, 1600 × 1000² | 59.5 | 31.0 ms | 79.2 ms | CPU raster candidate, subsequently rejected |

¹ The label predates the experiment: this immutable source capture still contains
the original upload behavior. The actual pacing run is `quality-low-paced-uploads`.
² Despite those artifact labels, they are not measurements of the final reviewed
source; the subsequent pixel checks rejected the rasterization change.

All runs above had zero GPU validation errors, zero live-render fallback frames,
and zero main-thread long tasks over 50 ms. Normal and Medium still encounter
substantial GPU-bound intervals. Cold worker snapshot loading also remains
measurable: the benchmark changes FPS immediately before Play, invalidating the
existing worker revision. There is no claim that cold startup is instantaneous,
that all stalls were removed, or that full-quality 60 fps is achieved.


### Final fidelity checks after rejecting the experiment

`sequence-reviewed-low` compared all 594 ticks at the same lower sampling density
and single-sample viewport against independently evaluated frames and the original
pre-pooling renderer: **594 byte-identical frames**, zero GPU errors, zero held-frame
failures, 6,701 staged upload slices and 25 intentional cancellations. The input
hash and all source hashes remained unchanged during the run. This verifies fidelity
at the selected quality, not equivalence to full-resolution output.

The Settings desktop regression checks the actual controls, saved preferences,
fixed modes under forced low-FPS samples, changing quality while playing, returning
to full-resolution editing on pause, unchanged document revision/history, sequential
ticks and authored background pixels. Its four runs presented 20, 20, 20 and 32
frames without wrong pixels or GPU errors. The Play handler returned in 0.5–0.7 ms
on that small fixture; that is handler latency, not a cold-project startup claim.


### Reviewed presets and final verification

After rejecting the CPU raster experiment, the reviewed fixed presets measured
as follows at 1600 × 1000, DPR 1, targeting 60 fps:

| Preset / captured report | Effective fps | P99 interval | Worst interval |
| --- | ---: | ---: | ---: |
| Normal / `reviewed-normal-desktop` | 49.1 | 63.7 ms | 183.7 ms |
| Low / `reviewed-low-desktop` | 58.3 | 38.8 ms | 213.3 ms |
| Draft / `reviewed-draft-desktop` | 59.4 | 29.6 ms | 63.3 ms |

All presented every tick with no live fallback, GPU errors or main-thread tasks
over 50 ms. Draft reduces pixel workload explicitly to 25% backing dimensions,
using the original rasterizer and object semantics. Automatic continues to stop
at 50%; it never chooses Draft. Normal remains the default. The Draft run captured
its executed source; the only source drift during the run was an explanatory
comment added to `preview-quality.mjs`. A subsequent software-canvas guard ensures
quarter-resolution backing dimensions never round to zero.

`sequence-reviewed-draft` also compared all 594 frames byte for byte against the
independent reference at the same sampling density: 594 exact matches, zero GPU
errors or held-frame corruption, 6,649 staged upload slices and 25 cancellations.
Its input and source hashes remained unchanged. This is in addition to the 594
exact matches in `sequence-reviewed-low`.

The final Settings fixture covers four fixed presets (20 frames each), changes
presets while playing (40 sequential frames), persistence, unchanged document
revision and history, and the minimum-size software surface. The Automatic
transition fixture exercised 69 sequential frames and all four quality transitions
without an unpainted resize, live fallback or incorrect pixel. All 17 browser
regression suites passed, including rendering, image formats, preview pressure,
software playback, renderer recovery and export sampling/memory.

The complete goal of stall-free full-quality 60 fps remains unproven. The settings
provide a measured quality/performance tradeoff while the verified ownership,
identity and frame-presentation fixes preserve artwork. The report distinguishes
rejected experiments from code retained in the application.


Final unit verification: 2,199/2,199 tests passed in the full TAP rerun; `npm run
check` checked 1,036 JavaScript files with zero syntax errors, and
`npm run changelog:check` passed. One preceding full run terminated the existing
clipboard async worker fixture without a reported assertion; its isolated 16-test
rerun and the complete rerun both passed without code changes to clipboard handling.
The logs retain that transient failure rather than presenting every run as clean.


The final runtime-transition comparisons (`sequence-runtime-low` and
`sequence-runtime-draft`) initialize normal object antialiasing and then switch
viewport sampling exactly as the app does. **Both runs produced 594 byte-identical
frames**, with zero GPU errors, zero held-frame failures and unchanged input/source
hashes. This supplements the cold-initialization comparisons above and verifies
the actual mixed object/viewport sampling contract used during playback.
