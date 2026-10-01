# Layer folders

Advanced layer menus group folder commands and stacking commands under
**Organize**, with separate **Focus**, **Visibility and lock**, and **Add layer**
submenus. Ctrl/Cmd-click toggles individual layer rows; Shift-click extends or
shrinks a range from the original selected row, skipping folder and effect rows.
One selected layer remains active. The folder button beside Layers creates an
empty folder and opens its name for editing. Double-click a folder name to
rename it; its disclosure collapses its children. A layer name can be dragged
onto a folder. The Simple timeline's Layers popover shows the same folders and
supports the same modifier selection, can group selected layers, and offers
**New folder** with immediate naming. F2 renames a focused folder.

Folders contain user layers, including drawings. Scene and Camera remain fixed
tracks. Folders have one level, with no pose keys of their own. Collapsing a
folder only changes the list; it does not hide, lock, or alter the artwork.
Search finds folder names as well as layer names, expanding matching children
temporarily. Selecting a figure reveals its collapsed folder unless an unrelated
layer focus is active. **Ungroup folder** removes the container and keeps every
layer and frame.

Empty folders remain available while focusing layers and can be found by name.
Adding a new layer during focus includes it in the focused set; closing a search
keeps the focus and its temporary locks active.

**Filter layers** opens a searchable checklist of layers and folders in either
timeline mode. A folder checkbox controls all its children; a dash means some
children are shown. **Only selected** narrows the list to the selected layers,
and **Reset filter** restores all rows. Camera and Scene can also be filtered.
Filtering changes timeline rows only: saved visibility, locks, stacking, keys,
and undo history are untouched. Selecting excluded artwork on the canvas leaves
the filter in place. Focus can further restrict the list; the checklist shows
that restriction and offers **End focus** separately.

The filter survives switching timeline modes and resets when opening another
document. New layers are shown by default; children added to an unchecked folder
stay excluded. Deleting layers or folders prunes their filter entries. The view
session owns this state in `timeline-layer-view.mjs`; the shared checklist renders
only the visible row window and supports arrow keys, Home, End, and Space.

Folder names and membership save in STYK projects and undo through the existing
layer command history. Each folder is a contiguous block in the existing layer
stack. Grouping nonadjacent layers places them together at the frontmost selected
layer's position, preserving their relative order; this can change their order
relative to unselected artwork. Moving layers into an existing folder keeps that
folder's position. Reordering layers keeps folder members together. Native object
slots, figure identities, joins and exposures remain unchanged. Formats without
layer metadata retain the artwork's stacking but cannot retain the folders.

Implementation: `layer-folders.mjs` validates and projects optional layer metadata;
`editor-layer-folders.mjs` authors sparse layer history changes. Folder rows never
enter the exposure sheet or frame-editing commands. Collapse state belongs to
each timeline view and is reset when replacing the document.

Verification: `node --test tests/layer-folders.test.mjs` and
`node tests/layer-folders.browser.mjs` cover save/reload, undo, grouping order,
moving and ungrouping, invalid references, collapse, search, row geometry, menus,
and both timeline views.
`tests/timeline-layer-{selection,menu,filter}.browser.mjs` cover modifier
selection with real artwork, stable search during interface refreshes, keyboard
menus, checklist state, Simple grouping, naming and undo, mode switching, compact
themes, and a 2,000-layer checklist with a bounded number of row elements.
