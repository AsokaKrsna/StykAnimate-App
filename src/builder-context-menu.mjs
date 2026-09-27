/** Build's right-click menus: only the commands that apply to what was clicked, grouped under names, the
 * families (Arrange, Branch, Rig, View) in submenus, and what removes something last. Rows are the app's menu
 * tuples ([command, glyph, label, shortcut, disabled]), group names ({label}) and submenus ({label, icon,
 * submenu}); every command runs through the app's one dispatcher. `page` keeps the old flat pages reachable
 * ('branch', 'arrange', 'view') for a caller that still asks for one. */
export function builderContextItems({kind, page = 'main', hasFigure, state, name = ''}) {
  const branch = state.builderBranch || state.builderShiftHeld || state.builderBranchSelected;
  const arrange = [
    ['segment-order-front', 'bring-to-front', 'Bring to front', ''],
    ['segment-order-up', 'up', 'Bring forward', ''],
    ['segment-order-down', 'down', 'Send backward', ''],
    ['segment-order-back', 'send-to-back', 'Send to back', '']];
  const branchRows = [
    ['builder-context-select-branch', 'builder-branch', 'Select branch', ''],
    ['duplicate-branch', 'duplicate', 'Duplicate branch', ''],
    ['builder-context-split-branch', 'builder-split', 'Split branch parts', ''], null,
    ['mirror-branch', 'flip', 'Flip branch horizontally', ''],
    ['mirror-branch-vertical', 'flip-vertical', 'Flip branch vertically', ''], null,
    ['delete-segment', 'trash', 'Delete branch', 'Shift Del']];
  const view = [
    {command: 'builder-static-handles', icon: 'pin', label: 'Static handles', shortcut: 'F10', checked: state.settings.builderShowStaticHandles !== false},
    {command: 'builder-highlight', icon: 'highlight', label: 'Highlight part', shortcut: 'F12', checked: Boolean(state.settings.builderHighlightSegment)},
    {command: 'toggle-isolate', icon: 'detach', label: 'Isolate joint', shortcut: 'Caps Lock', checked: Boolean(state.isolateMode)}, null,
    ['builder-canvas-color', 'palette', 'Construction background…', 'F9']];
  if (page === 'branch') return branchRows;
  if (page === 'arrange') return arrange;
  if (page === 'view') return view;
  if (kind === 'joint') return [
    ...(name ? [{label: name}] : []),
    [branch ? 'builder-context-split-branch' : 'split-segment', 'builder-split', branch ? 'Split branch parts' : 'Split', ''],
    [branch ? 'duplicate-branch' : 'duplicate-segment', 'duplicate', branch ? 'Duplicate branch' : 'Duplicate', ''],
    [branch ? 'mirror-branch' : 'mirror-segment', 'flip', 'Flip horizontally', ''],
    [branch ? 'mirror-branch-vertical' : 'mirror-segment-vertical', 'flip-vertical', 'Flip vertically', ''],
    ['segment-values', 'sliders', 'Exact values…', 'I'],
    null,
    ['copy-builder-appearance', 'duplicate', 'Copy appearance', ''],
    ['paste-builder-appearance', 'clipboard', branch ? 'Paste appearance to branch' : 'Paste appearance', '', !state.builderAppearance],
    null,
    {label: 'Arrange', icon: 'layers', submenu: arrange},
    {label: 'Branch', icon: 'builder-branch', submenu: branchRows},
    {label: 'Rig', icon: 'link', submenu: [
      ['rig-connect', 'link', 'Connect to another joint…', ''],
      ['rig-weighted', 'nodes', 'Add weighted joint', ''],
      ['rig-test', 'play', 'Test rig…', '']]},
    ['origin-segment', 'origin', 'Set as origin', ''],
    null,
    ['unsplit-segment', 'builder-unsplit', 'Remove joint, keep ends', ''],
    ['delete-single-segment', 'trash', 'Delete part', '']];
  if (kind === 'polygon') return [
    ['builder-context-fill-front', 'bring-to-front', 'Bring fill to front', ''],
    ['builder-context-fill-back', 'send-to-back', 'Send fill to back', ''], null,
    ['builder-context-delete-fill', 'trash', 'Delete fill', '']];
  return [
    {label: 'Draw'},
    ['builder-context-tool-line', 'line', 'Line', 'L'],
    ['builder-context-tool-chain', 'builder-chain', 'Chain of lines', ''],
    ['builder-context-tool-circle', 'circle', 'Circle', 'C'],
    ['builder-context-tool-polygon', 'polygon', 'Fill shape', '', !hasFigure],
    ...(kind === 'figure' ? [['add-sprite-segment', 'image', 'Attach image…', '']] : []),
    ['builder-context-tool-rig', 'nodes', 'Edit joints', '', !hasFigure],
    null,
    ['zoom-selection', 'center', 'Fit figure', 'Shift 2', !hasFigure],
    ['zoom-reset', 'fit', 'Fit canvas', 'Shift 1'],
    {label: 'View', icon: 'eye', submenu: view},
    ['builder-context-timeline', 'panel-bottom', state.builderTimelineVisible ? 'Hide timeline' : 'Show timeline', '']];
}
