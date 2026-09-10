# Asset library

Switch between **Properties** and **Library** in the right panel. Select one or more figures, or a movieclip, and click **Add to library**. The same command is in the canvas context menu and Selection actions. Assets are saved in the folder currently open in Library.

- Drag a figure, set, or movieclip from Library onto the canvas to insert it at the pointer. Double-click or Insert places it at the scene center. Undo removes the insertion in one step. Folders stay in the library.
- Use + to create a folder, breadcrumbs to navigate, Search and the type filter to narrow the current folder.
- Select an item and use Rename (or F2), Move to, or the Recycle Bin button. Renaming preserves the native extension. The folder icon opens the current directory in Explorer.
- Figure sets preserve their relative positions, pose, internal attachments, and draw order. A selected child without its parent is saved detached at its displayed position. Movieclips retain their nested editable animation and start playing at the insertion frame.

The desktop library is in the OS Documents folder at `StykAnimate/library`, including redirected Documents/OneDrive folders. The Windows setup creates that folder for the current user; first launch also creates it for portable installs and other users. Updates and uninstall retain the user's library.

Single figures and sets use native, compressed `.stkz` files; movieclips use `.stykmov`. Each file has a transparent 320 × 320 PNG sidecar (`name.stkz.png`) and small optional metadata (`name.stkz.json`). Rename and Move carry the sidecars along. Files copied into the library without previews have their previews generated when visible. Refresh, switching to Library, or returning focus to the app detects external changes. Copy the sidecars too to avoid regenerating previews.

Version 0.4.0 extends `.stkz` to contain a set of figures in one pose. Earlier app versions can still open single-figure files but do not support sets.

Preview rendering and native export run in workers. Native transfers use acknowledged 256 KiB chunks and commit complete files exclusively without overwriting another asset. Colliding names gain a numeric suffix. Library IPC accepts only paths inside the library, rejects links and traversal, and never accepts renderer-selected absolute filesystem paths.

Verification: `npm run test:library`, `npm run test:library:desktop`, and `node scripts/smoke-library.mjs --packaged`. `STYK_LIBRARY_DIR` and `STYK_USER_DATA_DIR` isolate automated test storage. `STYK_PACKAGED_EXECUTABLE` selects a versioned release for packaged tests.

## Copy between projects

Use **File → New window**, or launch StykAnimate again, to keep another project open. Copy or cut selected figures on the canvas, switch windows, and paste on the destination canvas. Copy frames in either timeline and paste in the destination timeline. The usual Ctrl+C, Ctrl+X, and Ctrl+V shortcuts (Command on macOS), timeline buttons, and context menus use the shared desktop clipboard.

Copies include figure definitions, embedded media, internal attachments, and movieclip animation. Timeline transfers preserve exposures, easing, scene/camera data when selected, and create missing destination layers. Paste is one undoable action. Copying text in another application replaces the shared clipboard normally. Each open desktop workspace has separate recovery data.

Verify native cross-window transfers and mouse drag placement with `node scripts/smoke-shared-clipboard.mjs`; model and bounded native transfer tests are in `tests/shared-clipboard.test.mjs`.
