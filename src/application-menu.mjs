import {HOTKEY_BY_ID, shortcutLabel} from './hotkeys.mjs';
/** Classic application menus use the same commands as keyboard and canvas actions. Each is a few named groups
 * (separators between them), families in submenus (Import ▸, Duplicate ▸, Flip ▸, Arrange ▸) and what removes
 * something last; view toggles show a check while they are on (the command registry's toggle states). */
export function applicationMenuItems(name, editor, desktop) {
  const noFigure = !editor.object;
  const noJoint = noFigure || Boolean(editor.figure?._styk?.movieclip) || editor.selectedJoint < 0 || editor.selectedUids?.size > 1;
  const segment = (action, symbol, label, shortcut = '') => [action, symbol, label, shortcut, noJoint];
  const menus = {
    file: [
      ['new', 'plus', 'New animation', 'Ctrl N'],
      ['new-window', 'plus', 'New window', '', !desktop?.newWindow],
      ['open', 'folder', 'Open project…', 'Ctrl O'],
      ['open-recent', 'clock', 'Open recent…', '', !desktop?.listRecentFiles],
      null,
      ['save', 'save', 'Save', 'Ctrl S'],
      ['save-as', 'save', 'Save as…', 'Ctrl Shift S'],
      ['rename', 'file', 'Rename project…'],
      null,
      {label: 'Import', icon: 'import', submenu: [
        ['import', 'import', 'Import figures…'],
        ['import-sprite', 'image', 'Import sprite image…'],
        ['import-background', 'image', 'Import background…'],
      ]},
      ['export-stkz', 'person', 'Save figure…', '', noFigure],
      ['export', 'export', 'Export…'],
    ],
    edit: [
      ['undo', 'undo', 'Undo', 'Ctrl Z'], ['redo', 'redo', 'Redo', 'Ctrl Shift Z'], null,
      ['copy', 'duplicate', 'Copy', 'Ctrl C', noFigure], ['paste', 'clipboard', 'Paste', 'Ctrl V'],
      ['paste-in-place', 'clipboard', 'Paste in place', 'Ctrl Shift V'],
      ['duplicate', 'duplicate', 'Duplicate selection', 'Ctrl D', noFigure],
      ['delete', 'trash', 'Delete selection', 'Delete', noFigure], null,
      ['select-all', 'cursor', 'Select all', 'Ctrl A'], ['select-invert', 'cursor', 'Invert selection'], null,
      ['settings', 'settings', 'Preferences…', 'Ctrl ,'],
    ],
    view: [
      ['zoom-in', 'plus', 'Zoom in', '+'], ['zoom-out', 'minus', 'Zoom out', '−'],
      ['zoom-reset', 'frame', 'Fit canvas', 'Shift 1'], ['zoom-selection', 'center', 'Fit selection', 'Shift 2', noFigure], null,
      ['toggle-handles', 'joints', 'Joints', 'Shift J'],
      ['toggle-motion-paths', 'motion-path', 'Motion paths', 'M'],
      ['toggle-onion', 'onion', 'Onion skin', 'O'],
      ['toggle-grid', 'grid', 'Grid'], null,
      ['scene-settings', 'scene', 'Scene properties…'], null,
      ['layout-focus', 'maximize', 'Focus mode'],
      ['layout-menu', 'layout', 'Layout…'],
    ],
    // The Joint menu (data-app-menu="editor"): the selected joint's segment and branch.
    editor: [
      segment('segment-values', 'sliders', 'Exact values…', 'I'), null,
      segment('split-segment', 'split', 'Split segment'),
      segment('unsplit-segment', 'builder-unsplit', 'Remove joint, keep ends', 'Ctrl Delete'),
      segment('origin-segment', 'origin', 'Set as origin'), null,
      {label: 'Duplicate', icon: 'duplicate', disabled: noJoint, submenu: [
        segment('duplicate-segment', 'duplicate', 'Duplicate segment'),
        segment('duplicate-branch', 'duplicate', 'Duplicate branch'),
      ]},
      {label: 'Flip', icon: 'flip', disabled: noJoint, submenu: [
        segment('mirror-segment', 'flip', 'Flip segment horizontally'),
        segment('mirror-segment-vertical', 'flip-vertical', 'Flip segment vertically'),
        null,
        segment('mirror-branch', 'flip', 'Flip branch horizontally'),
        segment('mirror-branch-vertical', 'flip-vertical', 'Flip branch vertically'),
      ]},
      {label: 'Arrange', icon: 'layers', disabled: noJoint, submenu: [
        segment('segment-order-front', 'bring-to-front', 'Bring segment to front'),
        segment('segment-order-up', 'up', 'Bring segment forward'),
        segment('segment-order-down', 'down', 'Send segment backward'),
        segment('segment-order-back', 'send-to-back', 'Send segment to back'),
      ]},
      null,
      segment('delete-single-segment', 'trash', 'Delete segment', 'Delete'),
      segment('delete-segment', 'trash', 'Delete branch', 'Shift Delete'),
    ],
    animation: [
      ['play', 'play', 'Play / pause', 'Space'], ['toggle-loop', 'loop', 'Loop'], null,
      ['first-frame', 'first', 'First frame', 'Home'], ['previous-frame', 'previous', 'Previous frame', '←'],
      ['next-frame', 'next', 'Next frame', '→'], ['last-frame', 'last', 'Last frame', 'End'], null,
      ['add-frame', 'plus', 'Add Frame', 'A'], null,
      {label: 'Movieclip', icon: 'frame', submenu: [
        ['movieclip-new', 'frame', 'New movieclip…'],
        ['movieclip-create', 'frame', 'Movieclip from selection…', '', noFigure],
        ['movieclip-range', 'frame', 'Movieclip from frame range…'],
      ]},
      null,
      ['delete-frame', 'trash', 'Delete keyframe'],
    ],
    help: [['help', 'help', 'Keyboard shortcuts', '?'], ['performance', 'activity', 'Performance'], ...(desktop?.sendTelemetryFeedback ? [null, ['feedback', 'help', 'Send feedback / Report a bug…']] : []), ...(desktop?.getUpdateState ? [null, ['check-updates', 'import', 'Check for updates…'], ['release-notes', 'file', 'What’s new'], ['donate', 'help', 'Support development']] : []), ...(desktop?.getTelemetryState ? [null, ['privacy', 'settings', 'Privacy & diagnostics'], ['website', 'help', 'StykAnimate website']] : [])],
  };
  return (menus[name] || menus.file).map(item => item && HOTKEY_BY_ID.has(item[0]) ? [item[0], item[1], item[2], shortcutLabel(undefined, item[0]), item[4]] : item);
}
