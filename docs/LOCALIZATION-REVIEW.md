# Language completion review

This development review covers the current 6,346 English message keys and 38 plural messages. Each language has one exclusive translator and a different reviewer who reads English/translated pairs and current owning UI or diagnostic context. These are AI language reviews, not native-speaker certification. Catalog completeness does not measure translation quality.

| Language | Locale | Coverage | Plural categories | Independent context review | Terminology to revisit with a native reviewer |
| --- | --- | --- | --- | --- | --- |
| Arabic | ar | 6,346/6,346 | zero, one, two, few, many, other | Complete | Skin: كسوة; Tweener: أداة التحريك البيني |
| German | de | 6,346/6,346 | one, other | Complete | Bildhaltezeit, Oberflächenbindungen, Animationsabhängigkeiten |
| French | fr | 6,346/6,346 | one, many, other | Complete | Peau, accélération and Pose intermédiaire retained after context review |
| Hebrew | he | 6,346/6,346 | one, two, other | Complete | התמרה and כלי תנוחות ביניים |
| Italian | it | 6,346/6,346 | one, many, other | Complete | Intercalazione principale, Allungamento intelligente and articolazioni di deformazione |
| Spanish | es | 6,346/6,346 | one, many, other | Complete | Articulated spatial joints, skin and warp terminology |
| Latin American Spanish | es-419 | 6,346/6,346 | one, many, other | Complete | Drawing cels, deformation bindings and specialist camera/VFX terms |
| Brazilian Portuguese | pt-BR | 6,346/6,346 | one, many, other | Complete | Quadro, estrutura de controle and specialist technical loans |
| Dutch | nl | 6,346/6,346 | one, other | Complete | Professional loans: mesh, skin, rig, easing and onion skin |

The original 6,312-message packs received a complete second pass. Reviewers added 30 missing preset/count, camera, spatial, export and dock messages and four final diagnostic-label messages; the integration agent independently inspected the additions and their enclosing sentences against the owning context. Camera strength-envelope captions were checked separately from speed easing. Reviews included all 447 computed VFX messages, mathematical diagnostics, animation timing, parameter grammar, preserved machine values and unintentional English copy. Existing accurate translations were retained; context errors were corrected.

All five translators and reviewers passed the read-only locale validator with `--strict` using Node 24.11.0: complete messages and all required plural forms, zero fallback. The coherent first-batch snapshot passed shared generation, `npm run check` and the full unit suite (3,799 passed, 25 skipped, one existing platform-specific TODO). A clipboard cancellation test failed in the initial concurrent run, then passed both alone and in the complete snapshot run; its implementation was unchanged. The initial inspector markup failure was resolved while preserving the existing accessibility contract.

The localization settings, application, native-menu, foundation, camera-follow, application-dialog and timeline-header browser suites passed. Each completed pack passed compact settings/export dialog checks; Arabic, German, French and Hebrew also passed narrow-window checks. Arabic and Hebrew settings and export dialogs were visually inspected, including RTL text with physical canvas/time/numeric direction preserved. Longer captions exposed timeline overflow, which is resolved by folding existing commands into the timeline menu. The Linux desktop preference/menu persistence smoke passed on retry after a startup timeout during concurrent tests. Additional model/transport checks passed 41 tests, covering original diagnostic identities, displayed parameter references, atomic camera edits, cancellation, stale replies and unpublished planning results. The retained-caption browser suite also passed after the computed-label fixes. These checks used Node 24.11.0, Python 3.12.9 and the local development application; final all-language results will be recorded after integration.

The second batch received complete independent English/translated context reviews, including all 38 plurals, 447 computed VFX entries and diagnostic composition. Corrections covered effect meanings, camera strength fades, frame timing, compositional action names, numeric constraints and saving terminology. Each translator and reviewer passed the pinned read-only strict validator with zero fallback. The integration agent independently checked the four final diagnostic labels and their enclosing sentences. Shared generation and `npm run check` passed in a coherent nine-pack snapshot; each of the four new packs passed all Settings tabs, export and timeline fit checks at 760px. Dutch editor and Settings captions were also visually inspected at 390px. Bokmål's complete authoring is awaiting completion of its independent review; it is not counted as reviewed here.

The onion controls now resolve translated before/after labels and frame plurals instead of inserting English fragments. Focused controller/range tests passed all 12 cases; the existing onion range and retained-caption browser suites passed, including preference values, drafts, gestures, sampling, cancellation and RTL updates.

The other 17 non-English packs are still in progress. No release, push, native-speaker review, or Windows/macOS packaged rendering is claimed.
