# Reported lag beyond ten seconds at 18 fps

**Follow-up:** The user subsequently supplied `Randombattle.styk`. See
[the project-specific investigation](RANDOMBATTLE-PERFORMANCE-2026-09-15.md).
That project has no authored VFX stacks; the VFX lead below does not explain it.

Investigated September 15, 2026. Reported hardware: 32 GB RAM and 4 GB VRAM.
The user's app version, CPU/GPU models, project, and whether the lag affects
editing or playback were not supplied.

## Conclusion

No general 180-frame performance cliff reproduced. The strongest production
lead is repeated VFX surface-budget failures in **1.0.1**, including on 32 GB
machines. This is a confirmed production problem, but it is **not yet a confirmed
explanation for this particular user's report**.

No application changes or deployments were made for this investigation. Existing
workspace changes were preserved. Other source edits were occurring during the
investigation; these browser measurements describe the local development app,
not an exact released executable.

## Cloudflare evidence

Read-only queries against the production `stykanimate-analytics` D1 database,
covering September 14–15 UTC. Performance/error comparisons filter the
**observation's** provenance to external traffic and use its release rather than
the installation-day's last release. No installation IDs or project contents
were exported.

- Diagnostic generation 2 was reset at **2026-09-14 00:42:13 UTC**. Earlier usage
  totals do not provide a comparable diagnostic baseline.
- At the final query: 168 external reporting installations, 210 installation-days,
  and 146 days containing detailed performance rows. Live totals may change.
- **11,815 `out_of_memory` occurrences across 13 installations**, all attributed
  to 1.0.1. Five installations reporting 32 GB RAM account for 3,279 occurrences.
  These are repeated error counters, not distinct crashes or users.
- All those occurrences point first to `vfx-canvas.mjs:20` (7,344) or
  `vfx-webgpu.mjs:111` (4,471) in the 1.0.1 source.
- Separate `device_lost` counters: 1.0.0 had 2 occurrences on one installation;
  1.0.1 had 37 on six; 1.0.5 had 3 on one. These cannot identify this user.
- For observed 1.0.1 WebGPU activity, sampled edit latency averaged 2.42 ms but
  peaked at 1,136.5 ms; seeking averaged 15.98 ms and peaked at 3,271.1 ms.
  This supports intermittent stalls, not universal sustained slowness.

### What the memory error actually means

Inspected the historical 1.0.1 source at commit `b8bbe6c`:

- `withVfx()` rejects a drawing region over **16,777,216 pixels** before creating
  its canvas, and assigns `telemetryCode: 'out_of_memory'`.
- The VFX WebGPU executor likewise guards its effect surface size.
- A synthetic 5,000 × 5,000 region with glow triggered the historical Canvas
  guard using a mock context, with **zero pixel allocations and no animation**.

Consequently, this telemetry label does not establish actual RAM/VRAM exhaustion.
Large artwork, effect padding, zoom, and nested effects can exceed the app's
surface policy regardless of installed memory. Repeated attempts to draw that
scene can repeatedly fail. The 1.0.5 source already adds VFX tiling, preview-scale
planning, and worker retries at lower detail for `vfx_surface_budget`; that is a
relevant mitigation to check against the reporter's version, not proof every
affected project is fixed.

## Local reproduction

Node 24.11.0; full-app Chrome/WebGPU on an NVIDIA Lovelace adapter, viewport
1,280 × 900. Fixtures use ordinary vectors, no images, movieclips, audio, or
effects. Browser playback runs lasted approximately 14 seconds each at 18 fps.
The 360-frame documents have 20 seconds of content and were played past tick 180.

| Frames | Figures/frame | CPU throttle | Final measured fps | Buffering after initial startup | Worker cache evictions |
| --- | --- | --- | --- | --- | --- |
| 90, looping | 3 | None | 18 | 0 ms | 0 |
| 360 | 3 | None | 18 | 0 ms | 158 |
| 360 | 40 | None | 18 | 0 ms | 159 |
| 360 | 40 | 4× | 18 | 0 ms | 158 |

All four runs produced no browser page errors. Startup ranged from 46–138 ms.
The 40-figure GPU frame cache occupied about 4.92 MiB. Browser screenshots were
inspected and showed rendered figures and 18 fps playback. CPU throttling is
not an emulation of the reporter's GPU, VRAM, or complete computer.

A separate editor-only sweep covered 90, 180, 360, and 720 frames with both
3 and 40 figures, in Simple and Advanced modes. Median Add Working Frame times
were 0.85–2.79 ms; the largest measured pose-commit time was 2.35 ms. These
model timings exclude UI/rendering and are not input-to-display measurements.

Evidence: `artifacts/lag-investigation/benchmark.mjs`, `browser-results.json`,
and screenshots in that directory. Run the benchmark against
`node scripts/serve.mjs --port 47835`.

## Relevant architecture and measurement limits

- CPU and GPU playback caches retain at most 120 frames by default; preparation
  normally looks ahead 8–24 ticks. Longer animations depend on continuous worker
  preparation. At 18 fps, each new frame has approximately 55.6 ms. Exceeding the
  cache length can expose expensive preparation, but ordinary cache eviction
  did not cause lag in these tests. There is no 180-frame cutoff in these paths.
- `playback-budget.mjs` sizes retention from system RAM, not dedicated VRAM.
  A 32 GB host receives a target of 1 GiB each for CPU and GPU frame caches.
  Other graphics resources and driver allocations are additional. The supplied
  hardware capacities alone therefore neither establish nor rule out pressure.
- Analytics records daily maximum frame counts, coarse RAM/GPU family and FPS
  buckets. It lacks exact project duration at each sample, exact target FPS,
  GPU model/VRAM capacity, and an identifier for this specific report.
- The legacy missed-deadline test uses `interval > target * 1.1`. At 18 fps on a
  60 Hz display, an on-schedule 66.7 ms presentation interval can exceed that
  threshold. Do not interpret that counter as a true dropped-frame percentage.
  No external `playback_lateness` observations were returned in the queried data.
- Detailed diagnostics are sampled and capped; missing metrics do not prove an
  absence of stalls. Pooled intervals from different FPS targets cannot establish
  achieved fps for a particular project.

## Next discriminating check

Obtain the exact app version and project, and establish whether lag means editing,
seeking, or playback. On that same project, compare playback from the start and
near the reported point, then compare VFX enabled/disabled and fitted/zoomed-in
view. Capture the app performance panel's worker preparation, buffering, renderer
backend, and cache data. If the project has no VFX, the production VFX finding
does not explain it and worker/renderer profiling remains necessary.

Verification run: 23 tests passed across `vfx-surface`, `playback-window`,
`playback-budget`, and `telemetry-measurements`.
