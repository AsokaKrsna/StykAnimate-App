# Layer folders

Advanced layer menus offer **Group selected layers in folder**, **Move to folder**,
and **Remove from folder**. Ctrl/Cmd-click or Shift-click selects several rows.
The Layers menu can also create an empty folder. Double-click a folder name to
rename it; its disclosure collapses its children. A layer name can be dragged
onto a folder. The Simple timeline's Layers popover shows the same folders and
can group the active layer.

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
