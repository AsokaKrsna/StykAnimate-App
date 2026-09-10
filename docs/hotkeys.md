# Keyboard shortcuts

Open **Settings → Shortcuts** (or **Help → Keyboard shortcuts**). Click a binding and press the desired combination. Use **+** for up to four alternatives, **×** to remove a binding, **Reset** for one command, or **Reset all**. Escape cancels recording; Tab retains normal focus navigation. Missing bindings display “Unassigned”. Conflicts within the same context require an explicit replacement; cancelling leaves both commands unchanged.

**A** duplicates the frame after the current frame in both timeline modes. Ctrl+Enter is unassigned. The existing simple-mode Space workflow still adds a frame; holding Space and dragging pans. These bindings can all be changed. Operating-system commands, pointer gesture modifiers, and standard navigation inside form controls and menus remain standard UI behavior.

## Architecture

- `src/hotkeys.mjs` is the command catalog and pure dispatcher. Stable command IDs connect labels, defaults, context, repetition and held-key behavior. Every supported binding is validated and normalized. `Mod` maps to Ctrl on Windows/Linux and Command on macOS; physical `KeyboardEvent.code` values keep bindings stable across Caps Lock and shifted punctuation.
- `src/app.mjs` provides the context and command adapter, retaining editing transactions, renderer recovery restrictions and polygon draft protections. `src/timeline-hotkeys.mjs` shares timeline behavior between the integrated app and standalone timeline widgets. Specific contexts override editor-wide bindings.
- `src/hotkey-settings.mjs` owns recording, search, conflict replacement and focus. `EditorSettings` owns normalization and persistence using the existing browser or desktop preference store. Absent command IDs inherit defaults; an empty array explicitly disables a command. Invalid preferences are repaired deterministically, with customized bindings taking precedence over conflicting defaults. Save errors remain visible and can be retried by closing Settings again.
- `src/hotkey-hints.mjs` derives menu badges and tooltips from active bindings; localization preserves those hints. Electron delegates editor shortcuts to the renderer, avoiding native accelerators that bypass settings or intercept typing.

Typing, composition/IME, AltGraph and open dialogs cannot trigger editor commands. Key release is captured even if a control stops event propagation. Focus loss, hidden documents, opening a dialog, cancellation and rebinding clear held keys without running tap actions.

To add a shortcut, add a stable catalog entry and implement its command in the editor adapter or relevant scoped widget. Declare repeat/hold behavior explicitly. Avoid adding independent key listeners for editor commands.

## Verification

- `npm run test:hotkeys` — normalization, dispatch, conflict handling, contexts, repetition and held-key cleanup.
- `npm run test:hotkeys:ui` — Settings interactions, persistence, menus, both timeline modes and actual scrollbar dragging. Requires `npm run serve`.
- `npm run test:hotkeys:desktop` — Electron dispatch, native menu interception and persistence across a process restart with an isolated profile and library.

The advanced timeline renders only within the scroll viewport's client dimensions. Native horizontal and vertical scrollbar gutters sit outside the canvas and playhead overlay. The filmstrip also has a visible horizontal scrollbar. Scrollbar gestures are excluded from frame selection and editing.

Add Frame (A) is the single frame creation command. Selecting a cell in the advanced timeline adds a key at that cell without shifting later keys. Working on the canvas adds a copy of the current pose immediately after the current frame and advances to it. The filmstrip adds after the current frame. Space plays or pauses in both modes.
