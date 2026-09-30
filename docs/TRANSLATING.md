# Translating StykAnimate

Each language owns one `src/locales/packs/<BCP-47 ID>.json` file. Its `locale`
metadata contains `id`, English `name`, `nativeName`, `direction` (`ltr` or `rtl`),
and optional explicit `aliases`. Its `messages` object uses the stable semantic
keys in `src/locales/en.mjs`, composed from English feature files. Keys describe
intent, not English spelling or an element's location. Read the owning component
for context; preserve distinctions between a figure definition, its instances,
joints, frames, keyframes, inbetweens, layers and movieclips. Build edits figures;
Animate poses them; Draw edits pixels. Keep terminology consistent within a pack.

Translate plain text only. Do not add HTML. Preserve named `{placeholders}` exactly;
reorder them to suit the language. Numbers are formatted for the selected locale.
Plural messages are objects with the categories returned by
`new Intl.PluralRules(id).resolvedOptions().pluralCategories`; every supplied form
must preserve the placeholders in English `other`. Keep `other`. Missing messages
and missing categories deliberately use English. Shortcuts, IDs, extensions, units,
filenames, user names and authored animation text are separate from interface copy.

To add a language, create its JSON file (an empty `messages` object is a valid
starting point), use a canonical ID, and specify the direction. Use explicit script
IDs such as `zh-Hant` and region IDs such as `pt-PT` when their vocabulary differs.
Exact IDs take precedence; language packs serve regional preferences, script packs
serve only that script, and region packs need explicit aliases. Never map a different
script or region just to increase coverage. No UI edit is needed.

Run `npm run locales:build`, then `npm run locales:check` and `npm run check`.
Validation reports exact missing-message counts and incomplete plural categories;
malformed messages, unknown keys and altered placeholders fail. Use
`node scripts/build-locales.mjs --check --strict` to require complete coverage.
Review captions in the app in narrow windows and dialogs. Native speakers should
review meaning, terminology, grammar, plural categories and fit before merging.

For parallel translation, assign one pack file per subagent, for example:
“Translate `src/locales/packs/fr.json` only, using docs/TRANSLATING.md. Preserve
existing translations and all placeholders. Report uncertain terminology. Do not
edit generated files, English catalogs or UI code.” Disjoint pack files can merge
independently. The integration agent owns English keys, UI bindings, shared code,
`src/locales/locale-packs.mjs` (generated), scripts, tests and documentation. It merges
pack edits, regenerates once, validates, runs relevant UI checks and commits the
reviewed result. Do not edit `native-catalogs.mjs`: it records the original imported
Pivot captions, while the independent packs own current translations.

Development layout checks can call `styk.localization.localization.setPseudo('long')`
or `setPseudo('rtl')`, then `setPseudo(null)` to restore normal text. These modes
are never production languages or saved preferences. Check focus, numeric drafts,
selection, scroll, history and playback while changing languages; check Arabic,
Hebrew, Chinese, Cyrillic and accented Latin fonts on each shipping platform.
