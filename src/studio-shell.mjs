import {setAttr, setHidden, setProp, setText} from './ui/dom-write.mjs';
import {syncRail} from './shell/rail.mjs';
const names = {select: 'Select', pose: 'Pose joints', tweener: 'Tweener', rig: 'Edit shared rig', line: 'Draw a line', chain: 'Chain pen', circle: 'Draw a circle', polygon: 'Draw a polygon', hand: 'Pan canvas', attach: 'Attach figure'};

/** Presentation only: all editing still uses the existing document commands.
 * `builder` is the bounded builder-session controller from builder-mode.mjs;
 * it owns rig-mode entry, exit confirmation and the figure scope. */
export function initStudioShell({editor, state, setTool, renderAssets, showCommandMenu, builder, drawing, toast}) {
  const dialog = document.getElementById('insert-dialog');
  const workspace = document.querySelector('.workspace');
  const controller = new AbortController();
  const options = {signal: controller.signal};
  const mode = () => drawing?.active ? 'draw' : builder?.active ? 'rig' : 'animate';
  let pendingDraw=false;
  let modeRequest = 0, drawingExit = null;
  async function changeMode(next) {
    const request = ++modeRequest;
    pendingDraw=next==='draw';
    // Pixel operations may still own the drawing selection. Finish Draw before
    // Build binds a figure or sets its tool; only the latest workspace wins.
    if (next !== 'draw' || drawingExit) {
      const wait = drawingExit ?? drawing?.exit();
      if (wait?.then) {
        drawingExit = wait;
        try { await wait; }
        catch { return; } // DrawingController reports the error and keeps Draw active.
        finally { if (drawingExit === wait) drawingExit = null; }
        if (request !== modeRequest) return;
      }
    }
    if(next==='draw'){if(builder?.active){builder.requestExit();if(builder.active)return;}pendingDraw=false;drawing?.enter();sync();return;}
    if (next === 'rig') builder?.enter();
    else builder?.requestExit();
    sync();
  }
  document.querySelectorAll('[data-workspace-mode]').forEach(button => button.addEventListener('click', () => changeMode(button.dataset.workspaceMode), options));
  document.getElementById('leave-rig').addEventListener('click', () => changeMode('animate'), options);
  /** Today's Insert dialog, now the Add menu's "All in this project…": the project's figures with search and previews. */
  function showInsertDialog() {
    if (builder?.active) { toast?.('Finish the figure or return to Animate to insert figures.'); return; }
    state.activeTab = 'assets';
    dialog.showModal();
    renderAssets();
  }
  document.getElementById('close-insert').addEventListener('click', () => dialog.close(), options);
  dialog.addEventListener('close', () => { state.activeTab = 'layers'; renderAssets(); }, options);
  // Close before the existing delegated action opens a native file or authoring dialog.
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-action],[data-sample]')) dialog.close();
  }, options);
  document.getElementById('object-actions').addEventListener('click', event => {
    showCommandMenu(objectMenuItems(), event.currentTarget, {label: 'More actions'});
  }, options);
  /**
   * Properties ⋯ (experience.md §5.1): the selection's less frequent commands, grouped under names, families in
   * submenus, and whatever removes something last. The quick tiles above keep the everyday ones one click away.
   */
  function objectMenuItems() {
    const object = editor.object, none = !object;
    const segment = editor.figure?.segments?.[editor.selectedJoint];
    if (builder?.active && segment) return [
      ['segment-values', 'sliders', 'Exact values…', 'I'],
      ['origin-segment', 'origin', 'Set as origin'],
      null,
      {label: 'Appearance'},
      ['copy-builder-appearance', 'duplicate', 'Copy appearance'],
      ['paste-builder-appearance', 'clipboard', 'Paste appearance', '', !state.builderAppearance],
      null,
      {label: 'Arrange', icon: 'layers', submenu: [
        ['segment-order-front', 'bring-to-front', 'Bring to front'],
        ['segment-order-up', 'up', 'Bring forward'],
        ['segment-order-down', 'down', 'Send backward'],
        ['segment-order-back', 'send-to-back', 'Send to back'],
      ]},
      {label: 'Branch', icon: 'builder-branch', submenu: [
        ['duplicate-branch', 'duplicate', 'Duplicate branch'],
        ['mirror-branch', 'flip', 'Flip branch horizontally'],
        ['mirror-branch-vertical', 'flip-vertical', 'Flip branch vertically'],
        null,
        ['delete-segment', 'trash', 'Delete branch', 'Shift Del'],
      ]},
      {label: 'Rig', icon: 'link', submenu: [
        ['rig-connect', 'link', 'Connect joints…'],
        ['rig-weighted', 'nodes', 'Add weighted joint'],
        ['rig-bind-branch', 'stretch-horizontal', 'Bind branch to stretch'],
      ]},
      null,
      ['add-sprite-segment', 'image', 'Attach image…'],
      ...(segment.primitive_code === 5 ? [['edit-text', 'text', 'Edit text…']] : []),
      null,
      ['unsplit-segment', 'builder-unsplit', 'Remove joint, keep ends', 'Ctrl Del'],
      ['delete-single-segment', 'trash', 'Delete part', 'Del'],
    ];
    if (builder?.active) return [
      ['add-sprite-segment', 'image', 'Attach image…', '', none],
      ['rig-connect', 'link', 'Connect joints…', '', none],
      ['rig-examples', 'layers', 'Rig examples…'],
      null,
      ['zoom-selection', 'center', 'Fit figure', 'Shift 2', none],
      ['rig-test', 'play', 'Test rig'],
    ];
    const clip = Boolean(editor.figure?._styk?.movieclip);
    return [
      {label: 'Edit'},
      ['duplicate', 'duplicate', 'Duplicate', 'Ctrl D', none],
      ['mirror', 'flip', 'Flip horizontally', '', none],
      ['rotate', 'rotate', 'Rotate 15°', '', none],
      ['center', 'center', 'Center', '', none],
      ['reset-pose', 'undo', 'Reset pose', '', none],
      ['toggle-isolate', 'detach', state.isolateMode ? 'Stop isolating joint' : 'Isolate joint', 'Caps Lock', none],
      null,
      {label: 'Arrange'},
      ['selection-up', 'bring-to-front', 'Bring forward', '', none],
      ['selection-down', 'send-to-back', 'Send backward', '', none],
      null,
      {label: 'Movieclip', icon: 'frame', submenu: [
        ['movieclip-create', 'frame', 'Create movieclip', '', none],
        ['movieclip-edit', 'frame', 'Edit movieclip', '', !clip],
        ['movieclip-range', 'frame', 'Movieclip from frames…'],
      ]},
      ['add-to-library', 'plus', 'Add to library', '', none],
      ...(object && !clip ? [['edit-in-build-mode', 'nodes', 'Edit in Build', '', editor.selectedUids.size !== 1]] : []),
      null,
      ['delete', 'trash', 'Delete', 'Delete', none],
    ];
  }
  // Every write compares first (ui/dom-write.mjs): sync runs on every chrome pass, so an unchanged
  // shell writes nothing. Values the drawing workspace overrides are decided before they are written.
  function sync() {
    if(pendingDraw&&!builder?.active){pendingDraw=false;drawing?.enter();}
    const current = mode(), drawingActive = Boolean(drawing?.active);
    setAttr(workspace, 'data-mode', drawingActive ? 'draw' : current);
    // The band's switch shows the current workspace; Build's Done (#builder-done) also names a workspace but is no toggle.
    document.querySelectorAll('.workspace-switch [data-workspace-mode]').forEach(button => setAttr(button, 'aria-pressed', String(button.dataset.workspaceMode === current)));
    // The rail: this workspace's tools, their names and the active one (src/shell/rail.mjs).
    syncRail(document.querySelector('.studio-rail'), {mode: drawingActive ? 'draw' : current, tool: state.tool});
    setText(document.getElementById('tool-context'), drawingActive ? 'Draw · '+drawing.tool : names[state.tool] || 'Select');
    const context = state.inspectorContext;
    const figureName = editor.figure?.name || builder?.session?.figure?.name || 'Figure';
    const count = editor.selectedUids?.size || 0;
    document.querySelectorAll('[data-selection-order]').forEach(button => { setProp(button, 'disabled', !editor.selectedObjects.length); });
    let scope = context === 'camera' ? 'Camera' : context === 'scene' ? 'Scene' : context === 'layer' ? 'Layer' : context === 'frame' ? 'Timing' : count > 1 ? `${count} figures` : editor.object ? figureName : 'Scene';
    const joint = editor.figure?.segments?.[editor.selectedJoint];
    const inspectingFigure = !['camera', 'scene', 'layer', 'frame'].includes(context) && editor.object;
    setText(document.getElementById('inspector-context'), drawingActive ? 'Drawing' : inspectingFigure ? count > 1 ? 'Figures' : joint ? 'Joint' : 'Figure' : scope);
    setAttr(document.getElementById('inspector'), 'data-selection-kind', inspectingFigure ? count > 1 ? 'figures' : joint ? 'joint' : 'figure' : context);
    const scopeText = state.tool === 'hand' ? 'View only · Your animation stays unchanged' : current === 'rig' ? (editor.object ? `${figureName} · Shared definition — changes affect every instance` : 'Draw a line or circle to create a figure')
      : state.applyRange && state.rangeIndices?.length > 1 ? `${scope} · ${state.rangeIndices.length} selected frames`
      : `${scope} · Frame ${editor.tick + 1}${editor.frameDraft?.dirty ? ' · Working pose' : ''}`;
    setText(document.getElementById('edit-scope'), drawingActive ? drawing.exposureLabel : scopeText);
    setHidden(document.getElementById('leave-rig'), current !== 'rig');
    setText(document.getElementById('selection-summary'), scopeText);
    // #viewport-hint stays hidden: a tool's instruction is the stage header's mode message (app.mjs modeMessage).
    builder?.sync();
    if(drawingActive)drawing.sync();
  }
  sync();
  return {sync, changeMode, showInsertDialog, destroy: () => controller.abort()};
}
