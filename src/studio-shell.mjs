import {DRAWING_TOOLS} from './drawing-view.mjs';
import {setAttr, setFlag, setHidden, setProp, setText} from './ui/dom-write.mjs';
const names = {select: 'Select', pose: 'Pose joints', tweener: 'Tweener', rig: 'Edit shared rig', line: 'Draw a line', chain: 'Chain pen', circle: 'Draw a circle', polygon: 'Draw a polygon', hand: 'Pan canvas', attach: 'Attach figure'};
const builderTools = new Set(['select', 'rig', 'line', 'chain', 'circle', 'polygon', 'hand']);

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
  function changeMode(next) {
    pendingDraw=next==='draw';
    if(next==='draw'){if(builder?.active){builder.requestExit();if(builder.active)return;}pendingDraw=false;drawing?.enter();sync();return;}
    drawing?.exit();
    if (next === 'rig') builder?.enter();
    else builder?.requestExit();
    sync();
  }
  document.querySelectorAll('[data-workspace-mode]').forEach(button => button.addEventListener('click', () => changeMode(button.dataset.workspaceMode), options));
  document.getElementById('leave-rig').addEventListener('click', () => changeMode('animate'), options);
  document.getElementById('open-insert').addEventListener('click', () => {
    if(drawing?.active){drawing.run(()=>drawing.action('new'));return;}
    if (builder?.active) { toast?.('Finish the figure or return to Animate to insert figures.'); return; }
    state.activeTab = 'assets';
    dialog.showModal();
    renderAssets();
  }, options);
  document.getElementById('close-insert').addEventListener('click', () => dialog.close(), options);
  dialog.addEventListener('close', () => { state.activeTab = 'layers'; renderAssets(); }, options);
  // Close before the existing delegated action opens a native file or authoring dialog.
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-action],[data-sample]')) dialog.close();
  }, options);
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
      ...(!builder?.active && editor.object && !editor.figure?._styk?.movieclip ? [null,
        ['edit-in-build-mode', 'nodes', 'Edit in build mode', '', editor.selectedUids.size !== 1]] : []),
    ], event.currentTarget);
  }, options);
  // Every write compares first (ui/dom-write.mjs): sync runs on every chrome pass, so an unchanged
  // shell writes nothing. Values the drawing workspace overrides are decided before they are written.
  function sync() {
    if(pendingDraw&&!builder?.active){pendingDraw=false;drawing?.enter();}
    const current = mode(), drawingActive = Boolean(drawing?.active);
    setAttr(workspace, 'data-mode', drawingActive ? 'draw' : current);
    const insert = document.getElementById('open-insert'), insertLabel = current==='draw'?'New drawing layer':'Add to scene';
    setAttr(insert, 'aria-label', insertLabel);setAttr(insert, 'title', insertLabel);
    document.querySelectorAll('[data-workspace-mode]').forEach(button => setAttr(button, 'aria-pressed', String(button.dataset.workspaceMode === current)));
    document.querySelectorAll('.tool-dock [data-tool]').forEach(button => {
      const tool = button.dataset.tool;
      setHidden(button, current === 'draw' ? !['hand',...DRAWING_TOOLS.map(t=>'drawing-'+t[0])].includes(tool) : current === 'rig'
        ? !builderTools.has(tool)
        : !['select', 'pose', 'hand', 'tweener'].includes(tool));
      setAttr(button, 'aria-pressed', String(tool === state.tool));
      setFlag(button, 'active', tool === state.tool);
      if (!button.querySelector('.tool-label')) {
        const label = document.createElement('span');
        label.className = 'tool-label';
        label.textContent = {select:'Select', pose:'Pose', tweener:'Tween', rig:'Joints', line:'Line', chain:'Chain', circle:'Circle', polygon:'Polygon', hand:'Pan'}[tool];
        button.append(label);
      }
    });
    const isolate = document.querySelector('.tool-dock [data-action="toggle-isolate"]');
    if (isolate) setHidden(isolate, !['pose', 'rig'].includes(state.tool));
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
    const hint = document.getElementById('viewport-hint');
    if (!hint.textContent) hint.textContent = 'Drag to select · Shift-click to add · Drag a joint to pose';
    setHidden(hint, drawingActive || Boolean(state.playing || state.previewing || ['select', 'pose', 'hand'].includes(state.tool)));
    builder?.sync();
    if(drawingActive)drawing.sync();
  }
  sync();
  return {sync, destroy: () => controller.abort()};
}
