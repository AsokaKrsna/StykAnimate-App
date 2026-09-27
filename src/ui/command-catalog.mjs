/**
 * Command metadata: one entry per user command, keyed by the ids that already
 * exist (the `actions` map in app.mjs and movieclip-ui.mjs, and HOTKEY_COMMANDS
 * in hotkeys.mjs). Ids are never renamed. Pure data: no DOM, no editor state.
 *
 * The catalog says what a command is called, which glyph and group it has and
 * how to find it. It does not say where a command is shown: menus, the palette,
 * the rail and tooltips pick commands by id or category from the registry
 * (command-registry.mjs), which adds the live parts (shortcut text from the
 * user's bindings, availability, checked state, translations).
 *
 * Entry fields:
 *   id        the action or hotkey id
 *   label     English label, sentence case (the translation fallback)
 *   icon      an icons.mjs glyph (one glyph per concept)
 *   category  one of COMMAND_CATEGORIES
 *   labelKey  a localization key; existing keys are reused so the native Pivot
 *             catalogs keep translating the same controls
 *   keywords  extra words the palette matches
 *   hotkey    the HOTKEY_COMMANDS id whose binding this command shows, when it
 *             differs from the id (a declared alias: Play shows Space)
 *   modes     workspace modes (data-workspace-mode) where it applies; absent = all
 *   requires  availability conditions the app evaluates (command-registry `requirements`;
 *             CATALOG_REQUIREMENTS lists every name the app must supply)
 *   toggle    the command flips a state, shown as a checked menu item
 *   danger    destructive
 *   aliasOf   the same command under another id; the palette lists the target only
 *   palette   false for internal entries and steps inside a flow
 */
export const COMMAND_CATEGORIES = Object.freeze([
  {id: 'file', label: 'File', labelKey: 'menu.file'},
  {id: 'edit', label: 'Edit', labelKey: 'menu.edit'},
  {id: 'view', label: 'View', labelKey: 'menu.view'},
  {id: 'animation', label: 'Animation', labelKey: 'overlays.category.animation'},
  {id: 'figure', label: 'Figure', labelKey: 'overlays.category.figure'},
  {id: 'build', label: 'Build', labelKey: 'overlays.category.build'},
  {id: 'camera', label: 'Camera', labelKey: 'overlays.category.camera'},
  {id: 'tools', label: 'Tools', labelKey: 'overlays.category.tools'},
  {id: 'drawing', label: 'Drawing', labelKey: 'overlays.category.drawing'},
  {id: 'canvas', label: 'Canvas', labelKey: 'overlays.category.canvas'},
  {id: 'export', label: 'Export', labelKey: 'overlays.category.export'},
  {id: 'help', label: 'Help', labelKey: 'menu.help'},
  {id: 'app', label: 'Application', labelKey: 'overlays.category.app'},
].map(category => Object.freeze(category)));

const entries = [];
function group(category, rows) {
  for (const [id, label, icon = null, options = {}] of rows) {
    const entry = {id, label, icon, category, ...options};
    for (const key of ['keywords', 'modes', 'requires']) if (entry[key]) entry[key] = Object.freeze([...entry[key]]);
    entries.push(Object.freeze(entry));
  }
}
const internal = {palette: false};
const build = {modes: ['rig']};
const draw = {modes: ['draw']};

group('file', [
  ['new', 'New animation', 'new-file', {labelKey: 'menu.newAnimation', keywords: ['create', 'blank', 'project']}],
  ['new-window', 'New window', 'plus', {requires: ['desktop:newWindow']}],
  ['open', 'Open project…', 'folder', {labelKey: 'menu.openProject', keywords: ['load', 'piv', 'stk']}],
  ['open-recent', 'Open recent…', 'clock', {labelKey: 'menu.openRecent', requires: ['desktop:recentFiles']}],
  ['save', 'Save', 'save', {labelKey: 'common.save'}],
  ['save-as', 'Save as…', 'save', {labelKey: 'common.saveAs', keywords: ['copy', 'duplicate project']}],
  ['rename', 'Rename project…', 'file', {keywords: ['name', 'title']}],
  ['import', 'Import figures…', 'import', {labelKey: 'menu.importFigures', keywords: ['stk', 'stkz', 'load figure']}],
  ['import-sprite', 'Import sprite image…', 'image', {labelKey: 'menu.importSprite', keywords: ['picture', 'png', 'sprite']}],
  ['import-background', 'Import background image…', 'image', {labelKey: 'menu.importBackground', keywords: ['backdrop', 'picture']}],
  ['save-and-close', 'Save and close', 'save', internal],
  ['save-and-update', 'Save and restart to update', 'save', internal],
]);
group('export', [
  ['export', 'Export…', 'export', {labelKey: 'common.export', keywords: ['render', 'video', 'gif', 'mp4']}],
  ['export-stkz', 'Save figure…', 'person', {requires: ['figure'], keywords: ['stkz', 'export figure', 'movieclip']}],
  ['export-piv', 'Export Pivot animation (.piv)', 'export', {keywords: ['piv', 'pivot']}],
  ['export-stk', 'Export Pivot figure (.stk)', 'export', {requires: ['figure'], keywords: ['stk']}],
  ['export-stykmov', 'Export movieclip (.stykmov)', 'export', {requires: ['figure'], keywords: ['stykmov']}],
  ['export-video', 'Export video', 'export', {keywords: ['movie', 'render']}],
  ['export-mp4', 'Export MP4', 'export', {keywords: ['video', 'h264']}],
  ['export-avi', 'Export AVI', 'export', {keywords: ['video']}],
  ['export-wmv', 'Export WMV', 'export', {keywords: ['video', 'windows media']}],
  ['export-vfw', 'Export AVI with a system codec', 'export', {keywords: ['video', 'vfw', 'codec']}],
  ['export-gif', 'Export GIF', 'export', {keywords: ['animated', 'image']}],
  ['export-apng', 'Export APNG', 'export', {keywords: ['animated', 'png']}],
  ['export-png', 'Export frame as PNG', 'image', {keywords: ['still', 'picture', 'snapshot']}],
  ['export-svg', 'Export frame as SVG', 'image', {keywords: ['vector', 'still']}],
  ['export-png-sequence', 'Export PNG sequence', 'image', {keywords: ['frames', 'images']}],
  ['export-jpeg-sequence', 'Export JPEG sequence', 'image', {keywords: ['frames', 'images', 'jpg']}],
  ['export-gif-sequence', 'Export GIF sequence', 'image', {keywords: ['frames', 'images']}],
  ['export-svg-sequence', 'Export SVG sequence', 'image', {keywords: ['frames', 'vector']}],
]);
group('edit', [
  ['undo', 'Undo', 'undo', {labelKey: 'common.undo'}],
  ['redo', 'Redo', 'redo', {labelKey: 'common.redo'}],
  ['cut', 'Cut', 'cut', {labelKey: 'common.cut'}],
  ['copy', 'Copy', 'duplicate', {labelKey: 'common.copy'}],
  ['paste', 'Paste', 'clipboard', {labelKey: 'common.paste'}],
  ['paste-in-place', 'Paste in place', 'clipboard'],
  ['paste-instance', 'Paste instance', 'clipboard', {keywords: ['linked', 'movieclip']}],
  ['paste-unique', 'Paste unique copy', 'clipboard', {keywords: ['independent']}],
  ['duplicate', 'Duplicate', 'duplicate', {labelKey: 'common.duplicate', keywords: ['clone']}],
  ['delete', 'Delete', 'trash', {labelKey: 'common.delete', danger: true, keywords: ['remove']}],
  ['select-all', 'Select all', 'cursor'],
  ['select-invert', 'Invert selection', 'cursor'],
  ['select-same', 'Select same figure', 'person', {requires: ['figure']}],
  ['cancel', 'Cancel current gesture', 'close', internal],
]);
group('view', [
  ['zoom-in', 'Zoom in', 'zoom-in'],
  ['zoom-out', 'Zoom out', 'zoom-out'],
  ['zoom-reset', 'Fit canvas', 'fit', {keywords: ['zoom', 'reset view']}],
  ['zoom-selection', 'Fit selection', 'center', {requires: ['figure'], keywords: ['zoom']}],
  ['zoom-menu', 'Zoom options', 'zoom', internal],
  // The zoom menu's presets (app.mjs builds these actions at run time).
  ...[25, 50, 100, 200].map(n => [`zoom-${n}`, `Zoom to ${n}%`, 'zoom', {keywords: ['zoom', 'percent', 'magnify']}]),
  ['toggle-handles', 'Joints', 'nodes', {toggle: true, keywords: ['handles', 'show', 'hide']}],
  ['toggle-unselected-handles', 'Other figures’ joints', 'nodes', {toggle: true, keywords: ['handles', 'unselected']}],
  ['toggle-motion-paths', 'Motion paths', 'route', {toggle: true, keywords: ['trajectory', 'path']}],
  ['toggle-camera', 'Camera frame', 'camera', {toggle: true, keywords: ['virtual camera', 'show', 'hide']}],
  ['toggle-selection-origins', 'Box selects figure origins', 'cursor', {toggle: true, keywords: ['marquee', 'rectangle']}],
  ['scene-settings', 'Scene properties…', 'scene', {keywords: ['canvas size', 'background', 'frame rate']}],
  ['builder-highlight', 'Highlight part', 'eye', {...build, toggle: true}],
  ['builder-static-handles', 'Static handles', 'nodes', {...build, toggle: true}],
  ['builder-canvas-color', 'Construction background color…', 'settings', {...build, keywords: ['colour']}],
]);
group('animation', [
  ['play', 'Play / pause', 'play', {hotkey: 'play-pan', keywords: ['preview', 'stop']}],
  ['play-pan', 'Play / pause; hold to pan', 'play', {aliasOf: 'play', palette: false}],
  ['first-frame', 'First frame', 'first'],
  ['previous-frame', 'Previous frame', 'previous'],
  ['next-frame', 'Next frame', 'next'],
  ['last-frame', 'Last frame', 'last'],
  ['previous-keyframe', 'Previous key', 'previous', {keywords: ['keyframe', 'jump']}],
  ['next-keyframe', 'Next key', 'next', {keywords: ['keyframe', 'jump']}],
  ['add-frame', 'Add frame', 'plus', {labelKey: 'timeline.addFrame', keywords: ['keyframe', 'new frame']}],
  ['extend-keyframe', 'Extend', 'stretch-horizontal', {keywords: ['hold', 'exposure', 'keyframe']}],
  ['delete-frame', 'Delete frames', 'trash', {danger: true, keywords: ['remove', 'keyframe']}],
  ['insert-blank-key', 'Insert blank key', 'frame', {keywords: ['keyframe', 'drawing']}],
  ['insert-copied-key', 'Insert copied key', 'clipboard', {keywords: ['keyframe', 'paste']}],
  ['remove-frames', 'Remove frames', 'trash', {palette: false, danger: true}],
  ['clear-keys', 'Remove keyframes', 'trash', {palette: false, danger: true}],
  ['toggle-loop', 'Loop playback', 'loop', {toggle: true, keywords: ['repeat']}],
  ['toggle-onion', 'Onion skin', 'onion', {toggle: true, keywords: ['ghost', 'previous frames']}],
  ['toggle-range-edit', 'Edit selected frames', 'frame', {toggle: true, keywords: ['range', 'apply to frames']}],
  ['timeline-layer-up', 'Select layer above', 'up', internal],
  ['timeline-layer-down', 'Select layer below', 'down', internal],
  ['previous-exposure', 'Previous exposure', 'previous', internal],
  ['next-exposure', 'Next exposure', 'next', internal],
  ['movieclip-new', 'New movieclip…', 'frame', {keywords: ['clip', 'symbol']}],
  ['movieclip-create', 'Make movieclip from selection…', 'frame', {requires: ['figure'], keywords: ['clip', 'symbol']}],
  ['movieclip-range', 'Make movieclip from frames…', 'frame', {keywords: ['clip', 'range']}],
  ['movieclip-edit', 'Edit movieclip', 'frame', {requires: ['movieclip']}],
  ['movieclip-done', 'Finish editing movieclip', 'check', {requires: ['movieclip-session']}],
  ['movieclip-cancel', 'Cancel movieclip editing', 'close', {requires: ['movieclip-session']}],
  ['movieclip-unique', 'Make movieclip unique', 'duplicate', {requires: ['movieclip']}],
  ['movieclip-break', 'Break apart frame', 'split', {requires: ['movieclip']}],
  ['movieclip-bake', 'Bake movieclip to frames', 'layers', {requires: ['movieclip']}],
  ['movieclip-export', 'Export movieclip…', 'export', {requires: ['movieclip']}],
  ['movieclip-extend', 'Add movieclip to next keys', 'plus', internal],
]);
group('figure', [
  ['add-figure', 'Add stick figure', 'person', {keywords: ['new figure', 'insert']}],
  ['add-text', 'Create text…', 'text', {labelKey: 'menu.createText', keywords: ['type', 'caption', 'insert']}],
  ['edit-text', 'Edit text…', 'text', {requires: ['text']}],
  ['mirror', 'Flip horizontally', 'flip', {requires: ['figure'], keywords: ['mirror']}],
  ['mirror-vertical', 'Flip vertically', 'flip-vertical', {requires: ['figure'], keywords: ['mirror']}],
  ['rotate', 'Rotate 15°', 'rotate', {requires: ['figure']}],
  ['center', 'Center selection', 'center', {requires: ['figure'], keywords: ['centre', 'middle']}],
  ['reset-pose', 'Reset pose', 'reset', {requires: ['figure']}],
  ['reset-color', 'Reset colors', 'reset', {requires: ['figure'], keywords: ['colours']}],
  ['layer-front', 'Bring to front', 'bring-to-front', {requires: ['figure'], keywords: ['arrange', 'order']}],
  ['layer-up', 'Bring forward', 'up', {requires: ['figure'], keywords: ['arrange', 'order']}],
  ['layer-down', 'Send backward', 'down', {requires: ['figure'], keywords: ['arrange', 'order']}],
  ['layer-back', 'Send to back', 'send-to-back', {requires: ['figure'], keywords: ['arrange', 'order']}],
  ['selection-front', 'Bring part to front', 'bring-to-front', {requires: ['joint'], keywords: ['arrange', 'segment']}],
  ['selection-up', 'Bring part forward', 'up', {requires: ['joint'], keywords: ['arrange', 'segment']}],
  ['selection-down', 'Send part backward', 'down', {requires: ['joint'], keywords: ['arrange', 'segment']}],
  ['selection-back', 'Send part to back', 'send-to-back', {requires: ['joint'], keywords: ['arrange', 'segment']}],
  ['align-left', 'Align left', 'align-left', {requires: ['figures']}],
  ['align-center-x', 'Align center', 'align-horizontal-center', {requires: ['figures'], keywords: ['centre']}],
  ['align-right', 'Align right', 'align-right', {requires: ['figures']}],
  ['align-top', 'Align top', 'align-top', {requires: ['figures']}],
  ['align-center-y', 'Align middle', 'align-vertical-center', {requires: ['figures']}],
  ['align-bottom', 'Align bottom', 'align-bottom', {requires: ['figures']}],
  ['join-figure', 'Join to figure', 'link', {requires: ['figure'], keywords: ['attach', 'unjoin', 'detach', 'connect']}],
  ['attach-figure', 'Join to figure', 'link', {aliasOf: 'join-figure', palette: false}],
  ['detach-figure', 'Unjoin figure', 'detach', {aliasOf: 'join-figure', palette: false}],
  ['combine-figures', 'Combine connected figures', 'combine', {requires: ['figure'], keywords: ['merge']}],
  ['add-to-library', 'Add to library', 'layers', {requires: ['figure'], keywords: ['save', 'asset']}],
  ['edit-in-build-mode', 'Edit figure', 'nodes', {requires: ['figure'], keywords: ['build', 'rig', 'builder']}],
  ['selection-more', 'Selection actions', 'more', internal],
  ['locate-previous', 'Match previous pose', 'chevron-left', {keywords: ['locate', 'copy pose']}],
  ['locate-next', 'Match next pose', 'chevron-right', {keywords: ['locate', 'copy pose']}],
  ['segment-values', 'Exact values…', 'sliders', {requires: ['joint'], keywords: ['segment editor', 'angle', 'length']}],
  ['toggle-isolate', 'Isolate joint', 'eye', {toggle: true, keywords: ['solo', 'focus']}],
  ['previous-figure', 'Select previous figure', 'previous', internal],
  ['next-figure', 'Select next figure', 'next', internal],
  ['palette-previous', 'Previous colors', 'chevron-left', internal],
  ['palette-next', 'Next colors', 'chevron-right', internal],
  ['polygons-previous', 'Previous fills', 'chevron-left', internal],
  ['polygons-next', 'Next fills', 'chevron-right', internal],
  ['background-style', 'Background…', 'image', {keywords: ['backdrop', 'color', 'colour']}],
  ['finish-polygon', 'Finish polygon', 'check', internal],
  ['cancel-polygon', 'Cancel polygon', 'close', internal],
  ['chain-finish', 'Finish chain', 'check', internal],
  ['chain-cancel', 'Cancel chain', 'close', internal],
]);
group('build', [
  ['split-segment', 'Split', 'split', {...build, requires: ['joint'], keywords: ['segment', 'part']}],
  ['unsplit-segment', 'Remove joint, keep ends', 'builder-unsplit', {...build, requires: ['joint'], keywords: ['merge', 'segment']}],
  ['delete-single-segment', 'Delete part', 'trash', {...build, hotkey: 'delete', requires: ['joint'], danger: true, keywords: ['segment']}],
  ['delete-segment', 'Delete branch', 'trash', {...build, requires: ['joint'], danger: true}],
  ['mirror-segment', 'Flip part horizontally', 'flip', {...build, hotkey: 'mirror', requires: ['joint'], keywords: ['mirror', 'segment']}],
  ['mirror-segment-vertical', 'Flip part vertically', 'flip-vertical', {...build, hotkey: 'mirror-vertical', requires: ['joint'], keywords: ['mirror', 'segment']}],
  ['mirror-branch', 'Flip branch horizontally', 'flip', {...build, requires: ['joint'], keywords: ['mirror']}],
  ['mirror-branch-vertical', 'Flip branch vertically', 'flip-vertical', {...build, requires: ['joint'], keywords: ['mirror']}],
  ['origin-segment', 'Set as origin', 'origin', {...build, requires: ['joint'], keywords: ['root', 'pivot']}],
  ['duplicate-segment', 'Duplicate part', 'duplicate', {...build, hotkey: 'duplicate', requires: ['joint'], keywords: ['segment', 'copy']}],
  ['duplicate-branch', 'Duplicate branch', 'duplicate', {...build, requires: ['joint']}],
  ['segment-order-front', 'Bring part to front', 'bring-to-front', {...build, requires: ['joint'], keywords: ['arrange', 'order']}],
  ['segment-order-up', 'Bring part forward', 'up', {...build, requires: ['joint'], keywords: ['arrange', 'order']}],
  ['segment-order-down', 'Send part backward', 'down', {...build, requires: ['joint'], keywords: ['arrange', 'order']}],
  ['segment-order-back', 'Send part to back', 'send-to-back', {...build, requires: ['joint'], keywords: ['arrange', 'order']}],
  ['builder-order', 'Arrange part', 'layers', internal],
  ['copy-builder-appearance', 'Copy appearance', 'duplicate', {...build, requires: ['joint'], keywords: ['style', 'color', 'colour']}],
  ['paste-builder-appearance', 'Paste appearance', 'clipboard', {...build, requires: ['joint'], keywords: ['style', 'color', 'colour']}],
  ['toggle-builder-branch', 'Edit whole branch', 'builder-branch', {...build, toggle: true}],
  ['add-sprite-segment', 'Attach image…', 'image', {...build, keywords: ['sprite', 'picture']}],
  ['rig-connect', 'Connect joints…', 'link', {...build, requires: ['joint'], keywords: ['rig', 'anchor']}],
  ['rig-weighted', 'Add weighted joint', 'nodes', {...build, requires: ['joint'], keywords: ['rig']}],
  ['rig-pick-start', 'Pick start joint', 'cursor', {...build, palette: false}],
  ['rig-pick-end', 'Pick end joint', 'cursor', {...build, palette: false}],
  ['rig-pick-driver', 'Pick stretch driver', 'cursor', {...build, palette: false}],
  ['rig-bind-branch', 'Bind branch to stretch', 'stretch-horizontal', {...build, requires: ['joint'], keywords: ['rig', 'smart stretch']}],
  ['rig-test', 'Test rig', 'play', {...build, keywords: ['preview', 'rig']}],
  ['rig-examples', 'Rig examples', 'layers', {keywords: ['samples', 'library']}],
]);
group('camera', [
  ['camera-copy', 'Copy camera', 'duplicate'],
  ['camera-paste', 'Paste camera', 'clipboard'],
  ['camera-reset', 'Reset camera', 'reset'],
  ['camera-center', 'Center camera', 'center', {keywords: ['centre', 'frame figures']}],
  ['camera-center-x', 'Center camera horizontally', 'align-horizontal-center', {keywords: ['centre']}],
  ['camera-center-y', 'Center camera vertically', 'align-vertical-center', {keywords: ['centre']}],
  ['camera-align-view', 'Fit camera to view', 'fit', {keywords: ['align', 'match view']}],
  ['camera-level', 'Level camera', 'rotate', {keywords: ['straighten', 'angle']}],
  ['camera-locate-previous', 'Match previous camera', 'chevron-left'],
  ['camera-locate-next', 'Match next camera', 'chevron-right'],
  ['camera-apply-figures', 'Apply camera to figures', 'person', {keywords: ['bake']}],
  ['camera-guides', 'Camera guides', 'grid', {toggle: true, keywords: ['safe area', 'thirds']}],
]);
group('tools', [
  ['tool-select', 'Select and pose', 'cursor', {keywords: ['select tool', 'pose']}],
  ['tool-pose', 'Pose tool', 'cursor', {aliasOf: 'tool-select', palette: false}],
  ['tool-hand', 'Pan', 'hand', {keywords: ['hand', 'scroll']}],
  ['tool-line', 'Line', 'line', {...build}],
  ['tool-circle', 'Circle', 'circle', {...build}],
  ['tool-polygon', 'Polygon', 'polygon', {...build, keywords: ['fill', 'shape']}],
  ['tool-rig', 'Edit shared rig', 'nodes', {...build}],
  ['handle-edit-hold', 'Hold to edit handles', 'nodes', internal],
  ['isolate-hold', 'Hold to isolate joint', 'eye', {aliasOf: 'toggle-isolate', palette: false}],
]);
group('drawing', [
  ['drawing-brush', 'Brush', 'brush', draw],
  ['drawing-eraser', 'Eraser', 'eraser', draw],
  ['drawing-fill', 'Fill', 'paint-bucket', {...draw, keywords: ['bucket', 'paint']}],
  ['drawing-lasso', 'Select pixels', 'lasso', {...draw, keywords: ['lasso', 'marquee']}],
  ['drawing-shape', 'Shapes', 'polygon', {...draw, keywords: ['rectangle', 'ellipse']}],
  ['drawing-smaller', 'Smaller brush', 'minus', draw],
  ['drawing-larger', 'Larger brush', 'plus', draw],
  ['drawing-softer', 'Softer brush', 'minus', draw],
  ['drawing-harder', 'Harder brush', 'plus', draw],
  ...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(n => [`drawing-opacity-${n}`, `Brush opacity ${n}%`, 'sliders', {...draw, palette: false}]),
  ['drawing-apply', 'Apply pixel selection', 'check', {...draw, requires: ['pixels']}],
  ['drawing-select-all', 'Select all pixels', 'lasso', draw],
  ['drawing-deselect', 'Deselect pixels', 'close', {...draw, requires: ['pixels']}],
  ['drawing-invert-selection', 'Invert pixel selection', 'lasso', {...draw, requires: ['pixels']}],
  ['drawing-fill-selection', 'Fill pixel selection', 'paint-bucket', {...draw, requires: ['pixels']}],
  ['drawing-mirror', 'Mirror painting', 'flip', {...draw, toggle: true, keywords: ['symmetry']}],
  ['drawing-swap-colors', 'Swap colors', 'reset', {...draw, keywords: ['colours', 'foreground', 'background']}],
  ['drawing-flip-view', 'Flip view', 'flip', {...draw, toggle: true, keywords: ['mirror canvas']}],
]);
group('canvas', [
  ...['left', 'right', 'up', 'down'].map(direction => [`handle-${direction}`, `Nudge handle ${direction}`, `arrow-${direction}`, internal]),
  ...['left', 'right', 'up', 'down'].map(direction => [`move-${direction}`, `Move selection ${direction}`, `arrow-${direction}`, internal]),
  ['library-open', 'Insert library item', 'import', internal],
  ['library-rename', 'Rename library item', 'file', internal],
]);
group('help', [
  ['help', 'Keyboard shortcuts', 'keyboard', {labelKey: 'menu.shortcuts', keywords: ['hotkeys', 'keys']}],
  ['about', 'About StykAnimate', 'help'],
  ['release-notes', 'What’s new', 'file', {requires: ['desktop:updates'], keywords: ['release notes', 'changelog']}],
  ['check-updates', 'Check for updates…', 'import', {requires: ['desktop:updates']}],
  ['restart-update', 'Restart to update', 'import', {requires: ['update-ready']}],
  ['feedback', 'Report a bug or share an idea…', 'message', {requires: ['desktop:feedback'], keywords: ['feedback', 'support', 'bug']}],
  ['performance', 'Performance', 'activity', {labelKey: 'menu.performance', keywords: ['fps', 'renderer', 'diagnostics']}],
  ['privacy', 'Privacy and diagnostics', 'lock', {requires: ['desktop:telemetry'], keywords: ['telemetry']}],
  ['donate', 'Support development', 'heart', {requires: ['desktop:updates'], keywords: ['donate']}],
  ['website', 'StykAnimate website', 'link', {requires: ['desktop:telemetry']}],
]);
group('app', [
  ['menu', 'Main menu', 'more', internal],
  // Opens the palette; the palette does not list itself.
  ['command-palette', 'Search commands…', 'search', {labelKey: 'overlays.palette.open', keywords: ['command palette', 'find', 'run'], palette: false}],
  ['settings', 'Settings…', 'settings', {labelKey: 'menu.settings', keywords: ['preferences', 'options', 'theme', 'language']}],
  ['minimize', 'Minimize window', 'minimize', {requires: ['desktop']}],
  ['maximize', 'Maximize window', 'maximize', {requires: ['desktop']}],
  ['close', 'Quit', 'close', {requires: ['desktop'], keywords: ['exit', 'close window']}],
  ['close-dialog', 'Close dialog', 'close', internal],
]);

/** Every entry, in declaration order; indexes order them by COMMAND_CATEGORIES, then by this order. */
export const COMMAND_CATALOG = Object.freeze(entries);
export const COMMAND_BY_ID = new Map(entries.map(entry => [entry.id, entry]));
/** Every `requires` name the catalog uses: the app's `requirements` must answer each (a missing one reads as unavailable). */
export const CATALOG_REQUIREMENTS = Object.freeze([...new Set(entries.flatMap(entry => entry.requires ?? []))].sort());
