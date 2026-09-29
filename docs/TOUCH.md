# The touch interface (phones and tablets)

StykAnimate has a second interface for fingers and pens. It is the same editor with the
same document, commands, panels, undo history, renderer, workers and file formats, laid
out and operated differently. Nothing about a project depends on which interface edited it.

The desktop interface (mouse, trackpad, keyboard) does not change. Every rule below is
scoped to `:root[data-input="touch"]`, and every script path checks the same state.

## When it is on

`src/touch/touch-mode.mjs` decides, and writes the result on the root element:

| Attribute | Values | From |
| --- | --- | --- |
| `data-input` | `touch` or `pointer` | Settings › Interface › Touch interface: *Automatic* (default), *On* or *Off*. Automatic is on where the primary pointer is coarse (`(pointer: coarse)`): phones, tablets, and an iPad with a keyboard attached. A laptop with a touch screen has a fine primary pointer and keeps the desktop interface. |
| `data-form` | `phone` or `tablet` | The window's shorter side: under 600 CSS px is a phone. |
| `data-orient` | `portrait` or `landscape` | The window: landscape when it is at least as wide as it is tall. |
| `data-touch-layout` | `phone-portrait`, `phone-landscape`, `tablet-portrait`, `tablet-landscape` | The two above, as one name the stylesheets use. |

`?ui=touch` or `?ui=desktop` in the address overrides the setting for that page load, for
trying the other interface on any device. `src/theme-bootstrap.js` writes the attributes
before the stylesheet loads, from the stored setting, so a phone never paints the desktop
layout first.

## Layouts

The editor keeps one set of elements. The dock host (`src/shell/dock-host.mjs`) still owns
which panel shows where; in touch mode the solver gets a `touch` input (`layout-solver.mjs`,
`TOUCH_METRICS`) that folds the side panels into sheets where a docked panel would leave the
stage too little room. The touch stylesheet (`src/styles/layout/touch.css`) arranges the
regions; `src/touch/touch-shell.mjs` adds the few controls only touch needs.

### Phone, landscape (the recommended way to animate on a phone)

```
┌──────────────────────────────────────────────┬────┐
│ stage header: tool options · view · zoom      │ ≡  │
│ ┌──┐                                          │ ●  │ Animate
│ │  │ tools        STAGE                       │ ●  │ Draw
│ │  │                                          │ ●  │ Build
│ └──┘                               (modifiers)│ ↶↷ │
│                                               │ ☰  │ Properties
│                                               │ ⤓  │ Export
├───────────────────────────────────────────────┴────┤
│ + Add  ◀ ▶ ▶  00:03  onion  ⋯           ⌃ Timeline │
└────────────────────────────────────────────────────┘
```

- The top band becomes a vertical wing on the right: the StykAnimate menu, the three
  workspaces, Undo and Redo, Properties and Export. The stage gets the whole height.
- The tools float on the stage's left, as on the desktop, at touch size.
- The timeline is its header. Its body (the frames, or the layers and keys) opens as a sheet
  from the header, over the stage, and closes with a swipe down.
- Properties, VFX and Library open as a sheet from the right edge.

### Phone, portrait

```
┌─────────────────────────────┐
│ ≡  Kick combo •    ↶ ↷  ⤓  │ top bar
├─────────────────────────────┤
│ tool options · view · zoom  │ stage header (scrolls sideways)
│ ┌──┐                        │
│ │  │      STAGE             │
│ └──┘             (modifiers)│
├─────────────────────────────┤
│ + ◀ ▶ ▶  00:03  onion  ⋯ ⌃ │ timeline header
│ [ frames ................ ] │ timeline body (drag the header's grip)
├─────────────────────────────┤
│ Animate  Draw  Build │ ☰    │ tab bar
└─────────────────────────────┘
```

- The workspaces and Properties move to a tab bar under the thumb.
- Properties, VFX and Library open as a bottom sheet with two heights (half and full).
  Drag its grip to change the height, or down to close it.

### Tablet

Portrait and landscape keep the desktop's arrangement at touch size: the band on top (its
menubar folded into the StykAnimate menu), the tools floating on the stage, the timeline
docked at the bottom. In landscape the inspector stays docked on the right while the stage
keeps at least 560px; otherwise it opens as a sheet from the right edge.

## Sizes

Touch targets are at least 44×44 px on phones and 40×40 px on tablets (the visible control
may be smaller; its hit area is not). The touch stylesheet raises the size tokens
(`--control-*`, `--icon-*`) under `:root[data-input="touch"]`, so every component of the kit
follows. Text fields use 16px text, so iOS never zooms the page when one takes focus.

The page respects the safe areas (`env(safe-area-inset-*)`): nothing interactive sits under a
notch, a camera cut-out or the home indicator.

## Gestures

| Where | Gesture | Does |
| --- | --- | --- |
| Stage | One finger | The current tool, as the mouse's left button |
| Stage | Two fingers | Pan and zoom (`src/canvas-pinch.mjs`); the first finger's edit is cancelled |
| Stage | Two-finger tap | Undo |
| Stage | Three-finger tap | Redo |
| Stage | Press and hold | The context menu of what is under the finger (the right-click menu) |
| Stage | Hold a modifier, then drag | See [Modifiers](#modifiers) |
| Any button | Press and hold | Its name (the tooltip); lifting the finger does not press it |
| Lists, menus, rows | Press and hold | The row's menu (the right-click menu) |
| Advanced timeline | Swipe | Scrolls the grid |
| Advanced timeline | Tap | Selects the cell and goes to its frame |
| Advanced timeline | Double-tap | As a double-click: adds a key, or edits a key's easing |
| Advanced timeline | Press, hold, then drag | Selects frames, or moves the selected keys (as a mouse drag) |
| Advanced timeline | Press and hold, then lift | The cell's menu |
| Advanced timeline | Drag the ruler | Scrubs |
| Advanced timeline | Pinch | Zooms the timeline |
| Simple frames | Swipe, tap, hold | Scroll, select, the frame's menu |
| Sheets | Drag the grip or swipe toward the edge | Resize or close |

`src/touch/long-press.mjs` turns a press and hold into the platform's `contextmenu` event,
so every existing right-click menu works without a second implementation. It stands aside
where the browser already sends one (Android) so a menu never opens twice.

### Modifiers

The desktop editor uses the right mouse button and the Shift, Ctrl and Alt keys during a drag
(bending a joint, stretching it, adding to the selection, transforming or duplicating a
figure). `src/touch/modifier-dock.mjs` puts them on the stage as a small column of labelled
buttons in the corner under the thumb, named for what they do in the current workspace and
tool:

| Workspace | Buttons |
| --- | --- |
| Animate | Bend (the right button) · Stretch (Ctrl) · Add (Shift) · Transform (Alt) · Handles (hold R) |
| Build | Bend · Stretch · Add |
| Draw | Straight (Shift) · Alt |

Tap a button to latch it (it stays on, highlighted, until tapped again or the tool changes);
hold it with one thumb while the other finger drags for a one-off. While any is on, the next
touches on the stage reach the editor as if the button or key were held, so bending, stretching
and the rest run through the same code as on the desktop.

### Drawing with a finger

In Draw, a finger draws until the device's pen is used; after that the pen draws and a finger
pans, as in drawing apps. Settings › Interface › *Draw with a finger* chooses *Automatic*,
*Always* or *Never*.

## Menus, sheets and dialogs

- On a phone, menus open as action sheets from the bottom edge: full width, 48px rows, a
  backdrop, and a Back row for a submenu. On a tablet they stay anchored to their button
  with 44px rows.
- Sheets (Properties, VFX, Library, Structure, the timeline body) have a grip, move with the
  finger and close with a swipe toward their edge or a tap on the stage.
- On a phone every dialog fills the window, with its actions at the bottom within reach.
- The StykAnimate menu lists File, Edit, View, the workspace's menu and Help as submenus, and
  starts with *Search commands…*: every command the keyboard reaches has a place a finger can
  reach.

## The page

In touch mode the page does not scroll, bounce, zoom or reload itself: `touch-action`,
`overscroll-behavior: none` and (Safari) the `gesture*` events keep the browser's own
gestures off the editor, so a pull down never reloads it and a pinch zooms the canvas, not
the page. Text in the chrome cannot be selected by a long press, and the grey tap highlight
is off; text fields keep both.

## Files

| File | Owns |
| --- | --- |
| `src/touch/touch-mode.mjs` | The decision, the form factor, the root attributes, change events |
| `src/touch/touch-shell.mjs` | The touch-only chrome (tab bar, wing), sheet grips and gestures, the page hygiene |
| `src/touch/long-press.mjs` | Press and hold: context menus and button names |
| `src/touch/touch-gestures.mjs` | Pure gesture classification (tap, double-tap, hold, swipe, multi-finger tap) |
| `src/touch/modifier-dock.mjs` | The stage's modifier buttons and the events they shape |
| `src/touch/timeline-touch.mjs` | The Advanced grid's touch adapter |
| `src/styles/layout/touch.css` | The layouts, sizes and safe areas |
| `src/styles/features/touch.css` | Touch presentation of menus, sheets, dialogs and panels |

## Verification

- `node --test tests/touch-*.test.mjs`: the decision, the form factors, the gesture classifier
  and the solver's touch profile.
- `node tests/touch.browser.mjs`: the built site in Chromium with touch emulation at phone and
  tablet sizes in both orientations: every layout's regions are on screen and not overlapping,
  targets are at least 44px on phones, the long press opens menus, the modifiers bend a joint,
  two-finger tap undoes, the sheets open and close, and the desktop layout is unchanged at
  1440×900.

Real devices are not part of the automated checks: performance, Safari's own behaviour and a
real pen need a phone and a tablet in hand.
