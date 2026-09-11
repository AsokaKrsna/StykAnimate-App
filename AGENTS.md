# StykAnimate agent guide

StykAnimate is a local stick animation program built on sound architecture and good performance. Preserve editable animation semantics, reliable saving, responsive interaction, and bounded memory as the software grows.

## Working agreement

- Inspect relevant source, configuration, documentation, and `git status --short` before editing. Preserve unrelated work; never reset a dirty workspace to simplify a task.
- Complete implementation and relevant verification. Make reasonable assumptions for routine reversible decisions. Ask only when missing information changes correctness, scope, or authorization; continue independent work meanwhile.
- Follow the user's latest correction without losing the original objective. Use applicable skills and inspect their instructions for conflicts or stale assumptions. Delegate only when requested or explicitly authorized by applicable instructions.
- Keep changes focused and use existing module boundaries. Fix the owning layer instead of duplicating state or adding a second implementation of the same behavior.
- Report the result, checks actually run, and remaining limitations concisely. Claims about builds, performance, or releases require evidence for the changed bytes.

## Where to look

| Concern | Start here |
| --- | --- |
| Architecture and setup | `docs/ARCHITECTURE.md`, `README.md`, `package.json` |
| Document, commands, undo | `src/editor.mjs`, `src/editor-*.mjs`, `src/pivot/`, `docs/SCENE-EDITING.md` |
| Timeline and animation modes | `src/layer-timeline.mjs`, `docs/TIMELINE.md`, `docs/animation-modes.md` |
| WebGPU, playback, memory | `src/renderer.mjs`, `src/playback*.mjs`, `docs/renderer.md`, `docs/ADAPTIVE-PREVIEW.md` |
| Import, formats, saving | `backend/README.md`, `codecs/`, `native/`, `docs/IMPORT-PIPELINE.md`, `docs/document-exports.md` |
| Desktop and packaging | `desktop/`, `scripts/before-pack.cjs`, `docs/DESKTOP-RELEASE.md` |
| Tests and measurements | `tests/`, `scripts/smoke-*.mjs`, `scripts/benchmark-*.mjs`, `artifacts/` |
| Release history and shipping | `CHANGELOG.md`, `docs/RELEASING.md`, `docs/UPDATES.md`, `.github/workflows/desktop-release.yml` |
| Public site and catalogue | `docs/website.md`, `website/`, `cloud/github-releases.mjs` |

Read the relevant contract before changing behavior. Current code and workflow configuration establish executable commands; older release reports certify only their original artifacts. Update documentation when its contract changes.

## Architecture and performance

- Keep document data, editor commands/history, worker preparation, rendering caches, and UI state separate. Preserve native IDs, topology, frame timing, file compatibility, and undo/redo.
- Keep expensive parsing, evaluation, rasterization, and encoding off the UI thread using existing workers and bounded transfers. Avoid full-document cloning or serialization on interactive paths.
- Bound queues and CPU/GPU caches; invalidate by document revision and resource lifetime. Preserve cancellation and release obsolete resources. Measure representative dense scenes when changing hot paths.
- Preserve staged/atomic file replacement, recovery, and save-before-close behavior. Failed or cancelled saves must preserve existing files and unsaved work.
- Keep Electron context isolation and narrow preload/IPC APIs. Use local codec and export paths; remote processing of user projects requires an explicit product requirement.

## Environment and verification

Use locked dependencies and the runtimes in `.github/workflows/desktop-release.yml` (currently Node 24.11.0 and Python 3.12.9 for releases). Use `npm ci`; avoid incidental upgrades. See `README.md` for source setup and `scripts/requirements-build.txt` for packaging prerequisites. Run commands from the repository root.

If PowerShell's `npm` launcher reports a missing `npm-cli.js`, try `npm.cmd` from the same Node installation; it is verified on this workstation. Do not change global tools or dependencies to work around a launcher issue without diagnosing it first.

Run `npm run check` after JavaScript changes and tests covering affected behavior. `npm test` covers root unit tests; desktop smoke scripts and browser tests are separate. Inspect rendered results for visual changes. Run relevant Python tests for backend/codec changes and representative benchmarks for performance changes. Rebuild native components when their source changes. Report missing prerequisites or unrelated failures accurately.

## Changelog and shipping

- `CHANGELOG.md` is the authored release history. Add completed changes only to its top `Unreleased` section during development. Keep future ideas in planning documents.
- Before completing a feature or fix, update its existing entry or add one concise entry. Read pending notes for equivalent wording; one change gets one entry, even across several tasks.
- For a release, follow `docs/RELEASING.md`: move pending entries into one new highest version, leave an empty `Unreleased` section, and align package versions. Subsequent work goes into `Unreleased`, never an older release.
- Run `npm run release:prepare` and `npm run changelog:check`. Commit the changelog, both package version files, and both generated note files together. Generate notes through the script; never append history to the current release payload.
- Published sections are immutable during ordinary work. Software fixes need a higher version. Review semantic duplicates manually; validation catches normalized text duplicates and structural errors, not equivalent meanings.
- Shipping includes exact-artifact verification and the history update. Implementing a feature alone does not authorize publishing. When shipping is authorized, complete the documented process without redundant approval. Tag pushes can publish immediately.

## Instruction maintenance

Keep this file a concise repository map with concrete requirements and completion checks. Put detailed procedures in linked documents. Wording follows OpenAI's [GPT-6 Astra guidance](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices) and [AGENTS.md guidance](https://developers.openai.com/codex/guides/agents-md), reviewed 2026-09-10. This file guides behavior; it does not select a model or override system/developer instructions.
