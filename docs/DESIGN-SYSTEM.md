# Design system

`src/styles/legacy/45-design-system.css` defines the editor chrome's visual
language once. It loads after every component stylesheet and before
`legacy/46-theme.css`, which overrides the colour tokens for dark mode. Artwork,
paint swatches, joint colours and export previews keep their own colours.

## Stylesheets and cascade layers

`index.html` links one stylesheet, `src/styles/app.css`. It declares the cascade
layers once, lowest priority first, and then imports every sheet:

```css
@layer legacy, reset, tokens, base, layout, components, features, states, utilities;
```

- **`legacy`** holds the stylesheets that predate the layers, moved unchanged
  into `src/styles/legacy/`. Their number prefixes follow their previous
  cascade order, which is also their import order: `00-drawing.css` (formerly
  imported by the first line of `style.css`), `01-style.css`, `20-studio.css`,
  the other sheets `index.html` linked, and `99-settings.css`, which
  `settings.mjs` used to link at startup after all of them. Modules that inject
  a `<style>` block wrap its text in `@layer legacy { … }`, and the desktop
  feedback shell links `src/styles/support-bridge.css`, which imports
  `src/support-center.css` and `src/support-desktop.css` into `legacy`. Both are
  appended after `app.css`, so they still win on order as before.
  `src/support-center.css` is copied byte for byte to the website; never move or
  edit it for the editor.
- **Every later layer beats `legacy`** for normal declarations, whatever the
  specificity, so a rebuilt surface does not need heavier selectors. For
  `!important` the order inverts: a legacy `!important` rule beats every later
  layer, so delete the ones that touch a surface when you rebuild it.
- **New files** wrap themselves in one `@layer` block named after their folder
  (`base/*.css` in `base`, `components/*.css` in `components`, …). While the
  legacy layer exists, an unscoped rule in a later layer overrides every legacy
  rule, so scope new rules to the rebuilt region; only document-wide rules such
  as the `html` font may be unscoped.
- **Add styles by adding a file** and importing it from `app.css`, not with a
  new `<link>` or an unlayered `<style>` element, which would beat every layer.
  `tests/shell-contract.test.mjs` checks the single link and that every import
  resolves, with the legacy imports in `layer(legacy)`.
- **Keep the import count low.** Every import is a request that first paint
  waits for. In local measurements, splitting the legacy sheets into 48
  fragments delayed first paint by 45–100 ms, while the 21 whole sheets load
  within 2 ms of the old links. Measure startup before adding many files.

## Stylesheet lint

`npm run check` runs `scripts/check-css.mjs`. The rule ids appear in its
messages. Layered files, meaning everything under `src/styles/` except
`app.css`, `support-bridge.css` and `legacy/`, must:

- wrap all their rules in one `@layer` block named after their place:
  `base/` in `base` (except `base/reset.css`, in `reset`), `layout/`,
  `components/`, `features/`, `tokens.css` and `legacy-bridge.css` in
  `tokens`, `states.css` and `utilities.css`. `app.css` imports each file
  once, without `layer()`, and is the only file with `@import` (CSS01, CSS16).
- take colours from tokens. Hex, `rgb()`, `hsl()` and named colours appear only
  in `tokens.css`; system colours only inside `@media (forced-colors: active)`.
  Comment a declaration `/* artwork */` for checkerboards and other artwork
  (CSS02).
- use `!important` only in `base/reset.css`, `states.css` and `utilities.css`
  (CSS06).
- use no id selectors outside `:where()` (CSS07), and stay within the
  specificity budget, counted in classes, attributes and pseudo-classes: base 0
  (a lone `.ui-*` helper class 1), layout and components 2, features 3. Put
  state qualifiers inside `:where()` (CSS09).
- take `z-index` from `var(--z-*)` or a local 0–3 (CSS11).
- query the viewport size only in `layout/shell.css`; everything else follows
  the layout tier or a container query (CSS14).

The legacy layer is emptied and deleted rather than fixed, so the lint keeps a
ratchet instead. `scripts/check-css-baseline.json` lists the modules that still
create stylesheets at runtime (JS01) and every `!important` declaration in the
legacy layer, including the injected CSS text (`legacyImportant`). Both lists
may only shrink: a new entry fails the check, and so does an entry whose code
is gone until you run `node scripts/check-css.mjs --update-baseline`, which
refuses to record new entries. Only `support-desktop-ui.mjs` may link a
stylesheet at runtime (JS02).

## Tokens

| Group | Tokens | Notes |
| --- | --- | --- |
| Surfaces | `--theme-workspace`, `--theme-field`, `--theme-subtle`, `--theme-panel`, `--theme-hover` | Back to front: stage surround, input fields, quiet bars, panels, hover. |
| Lines | `--theme-border`, `--theme-border-strong` | Strong borders mark hover on bordered controls and slider tracks. |
| Text | `--theme-text`, `--theme-secondary`, `--theme-muted` | Muted text keeps at least 4.5:1 on every light surface. |
| Interaction | `--theme-accent`, `--theme-action`, `--theme-action-hover`, `--theme-selected`, `--theme-selected-hover` | Both use the StykAnimate brand blue (#0d99ff); `--theme-action` fills primary buttons, accent marks focus, selection and active icons. |
| Status | `--theme-danger*`, `--theme-warning*`, `--theme-success*`, `--theme-violet*` | Each has a matching `-bg` tint. |
| Type | `--ds-text-xs` … `--ds-text-lg`, `--ds-weight-strong` | 10.5 / 11 / 12 / 13 / 15 px. |
| Space | `--ds-space-1` … `--ds-space-6` | 4 px grid. |
| Shape | `--ds-radius-sm`, `--ds-radius`, `--ds-radius-lg`, `--ds-radius-xl`, `--ds-control-sm`, `--ds-control`, `--ds-control-lg` | Controls are 26 / 30 / 34 px tall. |
| Elevation | `--ds-shadow-1` (resting), `--ds-shadow-2` (floating bars), `--ds-shadow-3` (menus, popovers, dialogs), `--ds-focus-ring` | Dark mode uses deeper shadows. |
| Motion | `--ds-fast`, `--ds-ease` | Disabled under `prefers-reduced-motion`. |

New component styles should use these tokens rather than literal colours. Older
stylesheets still carry literal fallbacks in `var(--token, #fallback)`; the
fallback is never used once this file loads.

## Shared components

- **Buttons**: `.button`, `.button.primary`, `.button.subtle`, `.button.small`,
  `.button.danger`, `.icon-button`. A disabled primary button renders neutral.
- **Segmented controls**: `.ds-segmented` (also applied to the inspector
  Properties/VFX/Library switch, the timeline Simple/Advanced switch, export
  categories and camera tabs). Mark the chosen button with `aria-pressed` or
  `aria-selected`.
- **Overlays**: menus, popovers and dialogs share border, radius and
  `--ds-shadow-3`.
- **Empty states**: `.ds-empty` with `.ds-empty-icon`, a `strong` title, a short
  `p` and `.ds-empty-actions`. Explain what the area is for and offer the next
  action; avoid bare "Nothing here" messages.
- **Switches**: `.ds-switch` wraps a checkbox and a label with an optional
  `small` explanation. Use them for behaviour settings that need a sentence of
  explanation. Give the input an explicit `aria-label` when the label has a hint.
- **Chips**: `.ds-chip` for one-click suggestions.
- **Section labels**: `.ds-section-label` for small uppercase group headings in
  popovers.

## Writing

Use sentence case and plain words. Prefer "Add track" to "Track", and name the
result of a setting, not its mechanism ("Keep audio in sync with frame edits"
rather than "Ripple"). Count words must agree with their numbers ("1 figure").
In the Simple timeline, a *frame* is a Pivot-style timeline frame; wherever
playback frames differ, say so ("plays as 47 frames").

## Changing the editor markup

Restyle and restructure freely, but keep the hooks that code and tests use:
static ids, `data-action`, `data-tool`, `data-workspace-mode` and the other
values listed in `tests/shell-contract.test.mjs`, which runs with `npm test`.
Remove a hook only in the commit that changes its last reader, and update the
list there.

Review visual changes with `node scripts/ui-snapshots.mjs --url <server> --label
<name>`. It captures Animate, Draw and Build, both timeline modes, the inspector,
menus, dialogs and the feedback shell in light and dark at four window sizes.
Add `--compare <earlier label>` to count changed pixels and write diff images; a
refactor that should not change the look must report 0 changed images.
