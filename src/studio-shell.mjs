const construction = new Set(['rig', 'line', 'circle', 'polygon']);
const names = {select: 'Select', pose: 'Pose joints', 'handle-edit': 'Edit handles', rig: 'Edit shared rig', line: 'Draw a line', circle: 'Draw a circle', polygon: 'Draw a polygon', hand: 'Pan canvas', attach: 'Attach figure'};

/** Presentation only: all editing still uses the existing document commands. */
export function initStudioShell({editor, state, setTool, renderAssets, showCommandMenu, openTimelineSettings}) {
  const dialog = document.getElementById('insert-dialog');
  const workspace = document.querySelector('.workspace');
  let mode = 'animate';
  const controller = new AbortController();
  const options = {signal: controller.signal};
  function changeMode(next) {
    mode = next;
    setTool(next === 'rig' ? 'rig' : 'select');
    sync();
  }
  document.querySelectorAll('[data-workspace-mode]').forEach(button => button.addEventListener('click', () => changeMode(button.dataset.workspaceMode), options));
  document.getElementById('leave-rig').addEventListener('click', () => changeMode('animate'), options);
  document.getElementById('open-insert').addEventListener('click', () => {
    state.activeTab = 'assets';
    dialog.showModal();
    renderAssets();
  }, options);
  document.getElementById('close-insert').addEventListener('click', () => dialog.close(), options);
  dialog.addEventListener('close', () => { state.activeTab = 'layers'; renderAssets(); }, options);
  // Close before the existing delegated action opens a native file or authoring dialog.
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-action],[data-sample]')) { dialog.close(); changeMode('animate'); }
  }, options);
  document.getElementById('timeline-workflow').addEventListener('click', openTimelineSettings, options);
  document.getElementById('object-actions').addEventListener('click', event => {
    showCommandMenu([
      ['duplicate', 'duplicate', 'Duplicate selection', 'Ctrl D', !editor.object],
      ['add-to-library', 'plus', 'Add to library', '', !editor.object],
      ['mirror', 'flip', 'Flip horizontally', '', !editor.object],
      ['rotate', 'rotate', 'Rotate 15°', '', !editor.object],
      ['center', 'center', 'Center selection', '', !editor.object],
      ['reset-pose', 'undo', 'Reset pose', '', !editor.object],
      ['movieclip-create', 'frame', 'Create movieclip', '', !editor.object],
      ['movieclip-edit', 'frame', 'Edit movieclip', '', !editor.figure?._styk?.movieclip],
      ['movieclip-range', 'frame', 'Movieclip from frame range', ''],
      ['toggle-isolate', 'detach', state.isolateMode ? 'Disable joint isolation' : 'Isolate joint', 'Caps Lock', !editor.object],
      ['selection-up', 'bring-to-front', 'Bring forward', '', !editor.object],
      ['selection-down', 'send-to-back', 'Send backward', '', !editor.object],
      null,
      ['delete', 'trash', 'Delete selection', 'Delete', !editor.object],
      null,
      ['scene-settings', 'frame', 'Scene properties', ''],
    ], event.currentTarget);
  }, options);
  function sync() {
    if (construction.has(state.tool)) mode = 'rig';
    else if (['select', 'pose', 'handle-edit', 'attach'].includes(state.tool)) mode = 'animate';
    workspace.dataset.mode = mode;
    document.querySelectorAll('[data-workspace-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === mode)));
    document.querySelectorAll('.tool-dock [data-tool]').forEach(button => {
      const tool = button.dataset.tool;
      button.hidden = construction.has(tool) ? mode !== 'rig' : tool === 'handle-edit' ? !['pose', 'handle-edit'].includes(state.tool) : tool === 'pose' ? mode !== 'animate' : false;
      button.setAttribute('aria-pressed', String(tool === state.tool));
      button.classList.toggle('active', tool === state.tool);
      if (!button.querySelector('.tool-label')) {
        const label = document.createElement('span');
        label.className = 'tool-label';
        label.textContent = {select:'Select', pose:'Pose', 'handle-edit':'Handles', rig:'Joints', line:'Line', circle:'Circle', polygon:'Polygon', hand:'Pan'}[tool];
        button.append(label);
      }
    });
    const isolate = document.querySelector('.tool-dock [data-action="toggle-isolate"]');
    if (isolate) isolate.hidden = !['pose', 'handle-edit', 'rig'].includes(state.tool);
    document.getElementById('tool-context').textContent = names[state.tool] || 'Select';
    const context = state.inspectorContext;
    const figureName = editor.figure?.name || 'Figure';
    const count = editor.selectedUids?.size || 0;
    document.querySelectorAll('[data-selection-order]').forEach(button => { button.disabled = !editor.selectedObjects.length; });
    let scope = context === 'camera' ? 'Camera' : context === 'scene' ? 'Scene' : context === 'layer' ? 'Layer' : context === 'frame' ? 'Timing' : count > 1 ? `${count} figures` : editor.object ? figureName : 'Scene';
    const joint = editor.figure?.segments?.[editor.selectedJoint];
    const inspectingFigure = !['camera', 'scene', 'layer', 'frame'].includes(context) && editor.object;
    document.getElementById('inspector-context').textContent = inspectingFigure ? count > 1 ? 'Figures' : joint ? 'Joint' : 'Figure' : scope;
    document.getElementById('inspector').dataset.selectionKind = inspectingFigure ? count > 1 ? 'figures' : joint ? 'joint' : 'figure' : context;
    const scopeText = state.tool === 'hand' ? 'View only · Your animation stays unchanged' : mode === 'rig' ? (editor.object ? `${figureName} · Shared definition — changes affect every instance` : 'Draw a line or circle to create a figure')
      : state.applyRange && state.rangeIndices?.length > 1 ? `${scope} · ${state.rangeIndices.length} selected frames`
      : `${scope} · Frame ${editor.tick + 1}${editor.frameDraft?.dirty ? ' · Working pose' : ''}`;
    document.getElementById('edit-scope').textContent = scopeText;
    document.getElementById('leave-rig').hidden = mode !== 'rig';
    document.getElementById('selection-summary').textContent = scopeText;
    document.getElementById('timeline-workflow').textContent = state.settings.timelineMode === 'simple' ? 'Frame-by-frame ⌄' : 'Layers & Frames ⌄';
    const hint = document.getElementById('viewport-hint');
    if (!hint.textContent) hint.textContent = 'Drag to select · Shift-click to add · Drag a joint to pose';
    hint.hidden = Boolean(state.playing || state.previewing || ['select', 'pose', 'hand'].includes(state.tool));
  }
  sync();
  return {sync, destroy: () => controller.abort()};
}

export {mountExportFlow} from './export-panel.mjs';
