# Design system

`src/design-system.css` defines the editor chrome's visual language once. It
loads after every component stylesheet and before `src/theme.css`, which
overrides the colour tokens for dark mode. Artwork, paint swatches, joint
colours and export previews keep their own colours.

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
