/** Builder context menus contain only commands applicable to the clicked part.
 * Page changes use the same app menu; no nested floating panels or duplicate
 * document implementations are needed. */
export function builderContextItems({kind, page = 'main', hasFigure, state}) {
  const branch = state.builderBranch || state.builderShiftHeld || state.builderBranchSelected;
  const back = ['builder-context-main', 'chevron-left', 'Back', ''];
  if (page === 'branch') return [back, null,
    ['builder-context-select-branch', 'builder-branch', 'Select branch', ''],
    ['duplicate-branch', 'duplicate', 'Duplicate branch', ''],
    ['builder-context-split-branch', 'builder-split', 'Split branch segments', ''], null,
    ['mirror-branch', 'flip', 'Flip branch horizontally', ''],
    ['mirror-branch-vertical', 'flip-vertical', 'Flip branch vertically', ''], null,
    ['delete-segment', 'trash', 'Delete branch', 'Shift Del']];
  if (page === 'arrange') return [back, null,
    ['segment-order-front', 'builder-front', 'Bring to front', ''],
    ['segment-order-up', 'arrow-up', 'Bring forward', ''],
    ['segment-order-down', 'arrow-down', 'Send backward', ''],
    ['segment-order-back', 'builder-back', 'Send to back', '']];
  if (page === 'view') return [back, null,
    ['builder-static-handles', 'diamond', state.settings.builderShowStaticHandles !== false ? 'Hide static handles' : 'Show static handles', 'F10'],
    ['builder-highlight', 'eye', state.settings.builderHighlightSegment ? 'Stop highlighting segment' : 'Highlight segment', 'F12'],
    ['toggle-isolate', 'detach', state.isolateMode ? 'Stop isolating joint' : 'Isolate joint', ''],
    ['builder-canvas-color', 'grid', 'Background color…', 'F9']];
  if (kind === 'joint') return [
    ['rig-connect', 'link', 'Connect to another joint…', ''],
    ['rig-test', 'play', 'Test rig…', ''],
    [branch ? 'builder-context-split-branch' : 'split-segment', 'builder-split', branch ? 'Split branch segments' : 'Split segment', ''],
    [branch ? 'duplicate-branch' : 'duplicate-segment', 'duplicate', branch ? 'Duplicate branch' : 'Duplicate segment', ''],
    ['segment-values', 'sliders', 'Exact values…', 'I'], null,
    ['mirror-segment', 'flip', 'Flip horizontally', ''],
    ['mirror-segment-vertical', 'flip-vertical', 'Flip vertically', ''],
    ['builder-context-branch', 'builder-branch', 'Branch…', ''],
    ['builder-context-arrange', 'layers', 'Arrange…', ''], null,
    ['origin-segment', 'origin', 'Set origin here', ''],
    ['unsplit-segment', 'builder-unsplit', 'Remove joint, keep endpoints', 'Ctrl Del'],
    ['delete-single-segment', 'builder-delete-joint', 'Delete joint only', '']];
  if (kind === 'polygon') return [
    ['builder-context-fill-front', 'builder-front', 'Bring fill to front', ''],
    ['builder-context-fill-back', 'builder-back', 'Send fill to back', ''], null,
    ['builder-context-delete-fill', 'trash', 'Delete fill', '']];
  return [
    ['builder-context-tool-rig', 'sliders', 'Edit joints', '', !hasFigure],
    ['builder-context-tool-line', 'line', 'Draw line', 'L'],
    ['builder-context-tool-chain', 'builder-chain', 'Chain pen', ''],
    ['builder-context-tool-circle', 'circle', 'Draw circle', 'C'],
    ['builder-context-tool-polygon', 'polygon', 'Create polygon', '', !hasFigure],
    ...(kind === 'figure' ? [['add-sprite-segment', 'image', 'Attach image…', '']] : []), null,
    ['zoom-selection', 'center', 'Fit figure', 'Shift 2', !hasFigure],
    ['zoom-reset', 'frame', 'Fit canvas', 'Shift 1'], null,
    ['builder-context-view', 'eye', 'Builder view…', ''],
    ['builder-context-timeline', 'panel-bottom', state.builderTimelineVisible ? 'Hide timeline' : 'Show timeline', '']];
}
