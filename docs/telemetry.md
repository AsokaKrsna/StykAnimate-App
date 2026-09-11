# StykAnimate profiling and analytics

The desktop collector, Cloudflare service and private dashboard use one versioned allowlist: `src/telemetry-schema.mjs`. There are no third-party analytics SDKs, session replay, advertising identifiers or paid analytics subscriptions.

## Architecture

```mermaid
flowchart LR
  Editor[Editor actions and sampled performance] --> Consent[Consent-gated in-memory accumulator]
  Consent -->|bounded deltas every15s| IPC[Trusted Electron IPC]
  IPC --> Main[Desktop cumulative daily summaries]
  Main -->|async atomic local save| Disk[Private profile; seven-day offline queue]
  Main -->|HTTPS; at most every15min| Worker[Cloudflare Worker; validation and budgets]
  Worker --> D1[EU D1; linked reports30days]
  D1 --> Admin[Authenticated analytics dashboard]
  Site[Static public website] --> Release[Validated release manifest]
  Site -->|deliberate restricted deep link| Editor
```

`src/telemetry-core.mjs` counts and aggregates in constant, bounded memory. It creates no extra animation loop. CPU submission timings are sampled once per30 rendered frames. A15-second activity sampler runs only with consent; it records an activity timestamp, never a key or pointer value. PerformanceObserver collects long tasks and slow input events only with diagnostics consent. `src/telemetry-measurements.mjs` groups observed interaction IDs in memory and distinguishes foreground playback from discontinuities. Neither module retains event targets or text; interaction IDs never enter a report.

`desktop/telemetry.cjs` owns the private random32-byte installation token, hashes it for report identity, revalidates IPC and merges deltas. It saves locally outside the render path, batches uploads, respects Retry-After, aborts pending uploads on withdrawal, keeps at most seven days of unsent summaries, and retries requested deletion. Disabled reporting has no sampling, upload or persistence timer. An acknowledged baseline for today prevents a same-day opt-out/re-opt-in from reducing previously accepted totals. Local first-observed milestones and coarse first-success results survive a longer absence. Release, build and traffic classification come from the trusted desktop process; renderer IPC cannot replace them.

`cloud/worker.mjs` enforces the same schema, derives identity from the bearer token, stores one cumulative installation/day snapshot with a monotonic sequence, and makes retries idempotent. The database never stores the private token. It rejects arbitrary fields, oversized JSON, invalid dates/metrics and deleted identities. A30-day hash-only deletion marker prevents delayed uploads from recreating erased reports. See `docs/analytics-service.md` for database budgets, authentication, retention and operational setup.

The public website, configuration and release manifest are static assets: normal visits execute no Worker code and access no D1 data. Only telemetry, feedback and administrator routes run Worker-first; unknown API routes return a Worker 404. Public pages contain no tracking code or third-party font requests. The dashboard uses a private server session in an HttpOnly cookie, same-origin mutation checks, login rate limits and no credentials in its client JavaScript. Secrets must never be placed in `desktop/service-config.json` or public assets.

Unchanged reports are not uploaded. Idle-only changes wait for the next useful report, and leaving the app idle across midnight does not create an idle-only installation-day. Resource sampling runs only while the app is foregrounded. Memory, file persistence and networking stay outside the renderer's frame path. A deliberate manual sync can upload deferred data immediately.

## Collection and metric interpretation

All currently supported counters, timings, maxima and dimensions are visible in the dashboard. A missing diagnostic is missing data, not a measured zero. Daily installation summaries identify installations, not people; opt-out users cannot be counted.

| Category | What it measures | Important interpretation |
| --- | --- | --- |
| Product | Sessions observed, active/idle seconds, timeline-mode seconds, edit notifications, first observed launch/edit/save/export dates, time-to-first-success buckets | Active means focused and foreground with input in the last60seconds or playback running; short intervals and sleep are clamped. Idle-only reports are deferred. First launch means first launch observed after consent. First-success duration is elapsed wall-clock time from that observation, including inactive/offline time. |
| Features | Open/new, undo/redo, clipboard, duplicate/delete, keyframe, onion, camera, builder, IK controls, library and movieclip commands | Counts instrumented command attempts or committed edit notifications, not every mouse gesture. Cancelled edits can emit edit notifications. Never infer unique documents from these counters. |
| File operations | Start/success/failure/cancellation, broad import/export format families, contextual duration histograms by stage and outcome | A command’s format counter is an attempt; use successful operation totals to judge completion. Import batches count as one top-level operation; per-file context rows describe individual files. A decode and a complete row can describe the same file, so do not sum stages as distinct attempts. |
| Timings | Startup, imports/decoder, serialization, exports, recovery, frame submissions, slow input, long tasks, playback startup/intervals/buffering | Save/recovery/native-export timing measures serialization; render export timing ends before the save dialog. Import includes any confirmation delay. Frame timing is CPU submission time, not measured GPU execution. |
| Playback | Starts, elapsed playback seconds, presented frames, buffering events/time, streaming foreground interval histograms, observed intervals and missed deadlines | Version2 records actual scene presentation intervals without retaining a presentation history or creating another animation loop. Deadlines use the project's target FPS with10% scheduling tolerance. Background spans and discontinuities are separate. This is not a measurement of GPU completion or monitor display timing. |
| Resources | Once-per-minute aggregate Electron CPU and working set; sampled JS heap and renderer GPU allocation/draw/upload/object/primitive peaks | Peaks are maxima of samples, not continuous maxima. GPU allocation is the renderer’s tracked allocation, not total GPU memory. Electron process totals exclude the Python sidecar. |
| Compatibility | App release/channel, build fingerprint, external/internal/mixed/unknown traffic, broad OS/version/architecture, RAM/CPU buckets, coarse GPU vendor, rendering availability, language and latest timeline mode | No exact device model, hardware serial, display resolution or location. Mixed release/mode days belong to the latest snapshot; mode filters select whole days with observed mode use. Release/build labels on a day spanning an upgrade do not prove every earlier observation came from that build. Traffic classifications are conservative; see migration notes below. |
| Reliability | Caught/unhandled JavaScript errors, renderer exits/hangs, backend errors, GPU loss, prior unclean termination | Allowlisted error type, operation, safe error code, stage, format/complexity buckets, source module/line and hash; no raw messages, arguments or paths. An unclean exit may be a power loss or forced quit. No automatic full native crash dumps. |
| Feedback | Category, explicitly submitted message, release and platform, deletion identity | Separate from profiling consent; sent only by the form action. No automatic attachment. Contact is the published support email. |

Histograms use fixed upper bounds from1ms to one hour. p50/p95 are approximate bucket upper bounds capped by observed maximum. Out-of-range values are dropped. Error groups are capped at20per local day and are deduplicated when the same Error reaches multiple handlers. Network failure does not interrupt editing; the last15seconds of renderer deltas or60seconds of unpersisted main-process data may be lost on a sudden crash.

## Version2 measurements and compatibility

The shared schema accepts both versions1 and2. Older queued days remain version1; a version2 client upgrades its current day while preserving cumulative counters and legacy histograms. Existing uploads and historical measurements are not rewritten. Corrected measurements use separate keys: `interaction_ms` and its phases replace new writes to `input_latency_ms`, while `playback_foreground_interval_ms` replaces new writes to `playback_interval_ms`. The old keys remain available as legacy evidence. A current day upgraded partway through can still contain legacy recovery failures, so an unqualified whole-day recovery success rate would be misleading.

Slow input observations request a40ms browser reporting threshold. At most64pending interaction IDs and128recent IDs are held in memory to combine entries for the same interaction; observer batches are capped at100entries. Histograms contain one maximum observed duration per grouped interaction, plus input delay, processing and presentation phases when coherent timestamps exist. These are diagnostics for reported slow interactions, not INP and not a denominator for all user interactions. Regular foreground observations are limited to60seconds. Background, unattributed, dropped and discontinuous observations have separate counters. Long or suspicious spans that fit the one-hour transport bound are retained in anomaly histograms, keeping them out of regular responsiveness averages. Values beyond that bound can still increment the discontinuity counter without contributing an unbounded duration.

`operationContexts` retains at most12first-observed combinations per installation-day. The fixed dimensions are operation, stage, format family, file-size bucket, complexity bucket, target-FPS bucket and outcome. Identical combinations merge into duration histograms; additional combinations increment `dropped_operation_contexts`. This bounded sample describes covered contexts and must not be presented as complete coverage when drops are nonzero. File-size buckets are under1MiB,1–10MiB,10–50MiB and50MiB-plus. Complexity uses an estimate of authored segments in the first frame, grouped as under100,100–999,1,000–9,999 and10,000-plus; bounded traversal stops after2,048entities and larger definition tables produce unknown. It is neither a document fingerprint nor an exact renderer workload. FPS buckets are up to24,25–30,31–60 and over60. Unknown is explicit when a dimension is unavailable. No filenames, exact file sizes or document contents enter this context.

`firstSuccess.save` and `firstSuccess.export` contain one of six coarse elapsed-time buckets: under1minute,1–5minutes,5–30minutes,30minutes–2hours,2–24hours and over24hours. A new consented first-launch timestamp is persisted locally; it never appears in preview or uploads. Renderer milestone delivery can add up to the15-second batch interval. Existing installations without that original timestamp remain unmeasured; upgrades never fabricate a start time. Withdrawing analytics clears the local timestamp and unsent first-success results, and deleting data removes them. Restoring already acknowledged same-day totals does not begin an invented replacement timer.

Context timing stages have specific boundaries: save/recovery `serialize` covers producing the output Blob through the document worker and local backend; raster/video `encode` covers job preparation, rendering and encoding until that Blob is ready. `write` includes any save-dialog wait and the file transfer. `complete` measures the whole attempt, including user confirmation time, so it is not a disk-speed or pure CPU metric. Desktop success requires the file writer to finish. Browser recovery success requires IndexedDB transaction completion; an ordinary browser download can only confirm handing the file to the browser. Playback contexts marked `succeeded` represent observed presentation intervals, not completed export-style operations.

Unpackaged development runs are internal. A trusted packaged test-build setting can also classify a build as internal. Ordinary packaged builds are external; switching between internal and external activity in one day produces mixed, which remains mixed for that day. Older beta records lack reliable provenance and remain unknown on a same-day upgrade. Metadata updates keep the latest release/channel/build without falsely converting prior internal or unknown activity into external beta usage. These labels distinguish execution settings, not verified people; manually testing an ordinary public build remains external unless the trusted internal setting is supplied.

Packaging runs `scripts/build-telemetry-info.cjs` through `before-pack.cjs` to create the ignored `desktop/telemetry-build.json`. Its deterministic source fingerprint identifies code, never an installation or document. Set `STYK_INTERNAL_BUILD=1` only when packaging a test build; normal release builds should omit it. The main process supplies this metadata and rejects renderer overrides.

All additions use the existing consent categories,32KiB report ceiling, seven-day local queue and15-minute upload schedule. Cumulative histograms and counts are bounded at the privileged boundary, and saturation or context overflow is counted. No new automatic raw traces, replay, paid service or extra upload cadence is introduced.

Activation and repeat-creation metrics disclose their eligible populations and observation windows in the dashboard. Today is incomplete. Offline delivery, consent, deletion, rate limits, seven-day local expiry and30-day server retention bias estimates. Do not present participation metrics as the total audience or a crash-free-session percentage.

## Privacy UX

First run shows a compact Accept/Reject prompt. Accept explicitly enables both optional categories; Reject leaves both off. Expanded details offer independent choices and the full notice. Closing the prompt leaves collection off. Controls are available in Preferences → Privacy & diagnostics and Help → Privacy & diagnostics.

Reports exclude animation contents, document and asset names, paths, text, clipboard contents, keys, pointer coordinates, screenshots, recordings and raw exception messages. The publisher name is StykAnimate; contact is ale.ripreso@gmail.com, as requested. Linked reports are retained30days, feedback90days, and thresholded identifier-free daily statistics up to365days. The local private deletion token authenticates requests and is excluded from JSON previews/exports. Withdrawal stops future collection; deletion also erases retained linked data and rotates the identity. The notice distinguishes hosting-provider network processing from application analytics storage.

This implements technical consent and data controls. Whether a trade name alone sufficiently identifies the controller, age-related requirements, and the publisher’s specific legal obligations depend on how the beta is offered; code cannot certify legal compliance. Relevant references: [EDPB consent guidance](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en), [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), [Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/).

## Detailed local profiling

Preferences → Privacy & diagnostics → details → performance trace records30seconds of bounded Chromium timeline/V8 profiling data. The privacy modal closes so the user can reproduce the issue; a small non-modal recording indicator remains. The user chooses whether and where to save the trace. Nothing uploads automatically. Traces can contain URLs and local paths, so the UI instructs users to inspect them before sharing. Temporary recording overhead is expected. Open the saved JSON in Chrome tracing or Perfetto. This is not continuous profiling or a Python/native process profiler.

## Website and release integration

`desktop/service-config.json` contains only the public site origin, publisher/contact and release channel. A development run can use `STYK_SITE_URL=http://127.0.0.1:PORT`; production accepts HTTPS only. Main process networking avoids broadening renderer privileges or exposing tokens. `stykanimate://open` opens/focuses the installed application; `stykanimate://privacy` opens its privacy panel. All other routes, parameters, paths and credentials are rejected. The protocol never opens downloaded files or executes commands.

The download page reads the validated release manifest. Publish a current, tested installer/portable artifact on a suitable download host and supply HTTPS URL, version, size and SHA-256 in `LATEST_RELEASE_JSON`. Then regenerate and deploy the public API assets together with the Worker. Until a release is configured, the download page honestly shows that the beta is not yet published. Existing Windows installers are larger than Cloudflare’s25MiB static-asset limit; they must use a separate release/download host.

The production origin is https://stykanimate.com, with www.stykanimate.com bound to the same Worker. The private dashboard is /admin/. Its initial login key is in the ignored local file `artifacts/stykanimate-admin-key.txt`; it is never bundled into the app or public assets. `scripts/verify-cloudflare-live.mjs` checks HTTPS pages, security headers, static public API delivery and authenticated production D1 reads without submitting synthetic telemetry.

## Verification

Commands from the repository root:

```text
node --test tests/telemetry.test.mjs
node --test tests/telemetry-v2-service.test.mjs
node --test tests/telemetry-measurements.test.mjs
node --test tests/telemetry-build-provenance.test.mjs
node scripts/benchmark-telemetry.mjs
node scripts/benchmark-telemetry-measurements.mjs
node scripts/benchmark-telemetry-desktop.mjs
node scripts/smoke-telemetry.mjs
node --test cloud/tests/*.test.mjs
node cloud/tests/runtime.mjs
node cloud/tests/dashboard.browser.mjs
node scripts/check.mjs
```

The Electron smoke test uses an isolated profile and local Worker routes backed by real SQLite. It exercises no-consent behavior, acceptance, actual edit/playback/native-save summaries, error redaction, administrator login and dashboard rendering, explicit feedback, Chromium trace capture/discard, deletion and rejected late replay. Synthetic fixtures stay local. Windows may require normal process access for Chromium’s GPU subprocess; the sandbox’s missing-DLL termination is not an application crash regression.

Evidence lives under ignored `artifacts/telemetry/`, `artifacts/privacy-ui/`, `artifacts/public-site/` and `artifacts/telemetry-performance.json`. The collector microbenchmark isolates counter/histogram work; it does not establish a universal end-to-end performance percentage.

The 2026-09-10, 20:05 UTC native-GPU Electron comparison used 1,000 figures, 24 animation keys and four disabled/enabled/enabled/disabled rounds. Each sustained approximately 60 FPS with renderer CPU p95 of 0.20 ms. The broader editor render-work p95 was 0.20 ms disabled and 0.30 ms enabled. Enabled summary IPC measured 0.8–2.2 ms of asynchronous wall time, and exactly one 1,838-byte loopback upload occurred. Enabled rounds recorded 1,076 and 1,070 foreground intervals with matching histogram/context counts. A benchmark-only foreground override exercised these paths in a nonfocusable window; actual-focus resource sampling was outside this comparison. No practical playback slowdown was observed in this bounded test. It does not establish performance across all hardware, documents or packaged builds; full measurements and limitations are in `artifacts/telemetry/desktop-performance-summary.md`.
