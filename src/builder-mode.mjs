/** Builder mode controller: owns the bounded figure session and its chrome —
 * the outliner, the builder toolbar, selection bounding, and the exit flow.
 * Document work lives in BuilderSession; this module only coordinates UI. */
import {icon} from './icons.mjs';
import {BuilderSession} from './builder-session.mjs';
import {FigureOutliner} from './builder-outliner.mjs';

const esc = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const JOINT_COMMANDS = new Set(['split-segment', 'unsplit-segment', 'origin-segment', 'duplicate-segment',
  'duplicate-branch', 'mirror-segment', 'mirror-segment-vertical', 'mirror-branch', 'mirror-branch-vertical',
  'segment-order-front', 'segment-order-up', 'segment-order-down', 'segment-order-back',
  'delete-single-segment', 'delete-segment', 'segment-values']);
const FIGURE_COMMANDS = new Set(['add-sprite-segment']);
const TOGGLES = {'toggle-builder-branch': s => s.builderBranch || s.builderShiftHeld,
  'toggle-isolate': s => s.isolateMode,
  'builder-static-handles': s => s.settings.builderShowStaticHandles !== false,
  'builder-highlight': s => s.settings.builderHighlightSegment};
const ENTRY_TOOLS = new Set(['rig', 'line', 'circle', 'polygon', 'attach']);

export function initBuilderMode({editor, state, host}) {
  const workspace = document.querySelector('.workspace');
  const bar = document.getElementById('builder-bar');
  const outlinerHost = document.getElementById('builder-outliner');
  if (!bar || !outlinerHost)
    return {enter: () => false, requestExit: () => {}, leave: () => {}, sync: () => {},
      get active() { return false; }, get session() { return null; }, get boundUids() { return null; },
      get mode() { return 'animate'; }};
  let session = null, events = null;
  /** Translates an outliner drop into a parent/sibling insert plan. 'before'
   * and 'after' keep the target's parent; 'child' reparents onto the target
   * (as first child so the drop point matches the row under the pointer). */
  function dropPlan(draggedId, target, zone) {
    const figure = session?.figure;
    if (!figure) return null;
    if (zone === 'child') {
      const firstChild = figure.segments.find(segment =>
        Number(segment.parent_id) === target.id && Number(segment.segment_id) !== draggedId);
      return {parentId: target.id, beforeId: firstChild ? Number(firstChild.segment_id) : null};
    }
    const parentId = target.parent;
    if (zone === 'before') return {parentId, beforeId: target.id};
    const siblings = figure.segments.filter(segment =>
      Number(segment.parent_id ?? 0) === parentId && Number(segment.segment_id) !== draggedId);
    const at = siblings.findIndex(segment => Number(segment.segment_id) === target.id);
    return {parentId, beforeId: at >= 0 && at + 1 < siblings.length ? Number(siblings[at + 1].segment_id) : null};
  }
  const outliner = new FigureOutliner(outlinerHost, {
    editor,
    settings: state.settings,
    onMove: (draggedId, target, zone) => {
      const plan = dropPlan(draggedId, target, zone);
      if (!plan) return;
      try { editor.moveBuilderSegment(draggedId, plan); } catch (error) { host.fail?.(error); }
    },
    onResize: width => host.commitSettings?.({builderOutlinerWidth: width}),
    onSelect: (entry, options = {}) => {
      const uid = session?.preferredUid;
      if (uid == null) return;
      if (options.polygon) {
        const ids = session.figure?.polyfills?.[entry.index]?.segment_ids ?? [];
        const joint = session.figure?.segments.findIndex(segment => segment.segment_id === ids[0]) ?? -1;
        editor.select(uid, joint);
        return;
      }
      editor.select(uid, entry);
    },
    onBranch: index => { const uid = session?.preferredUid; if (uid != null) editor.selectBranch(uid, index); },
    onMenu: (entry, x, y) => {
      if (entry?.kind !== 'segment') return;
      host.showCommandMenu?.([
        ['split-segment', 'split', 'Split segment', ''],
        ['unsplit-segment', 'combine', 'Remove joint, keep endpoints', 'Ctrl Del'],
        ['origin-segment', 'origin', 'Set origin here', ''],
        null,
        ['duplicate-segment', 'duplicate', 'Duplicate segment', ''],
        ['duplicate-branch', 'duplicate', 'Duplicate branch', ''],
        ['mirror-segment', 'flip', 'Flip segment horizontally', ''],
        ['mirror-branch', 'flip', 'Flip branch horizontally', ''],
        null,
        ['delete-single-segment', 'close', 'Delete joint', ''],
        ['delete-segment', 'trash', 'Delete branch', 'Shift Del'],
      ], {left: x, top: y, right: x, bottom: y, width: 0, height: 0});
    },
    onRename: name => { try { editor.updateFigureStyle({name}); } catch (error) { host.fail?.(error); } },
  });
  /** Selection may only contain bound instances; an empty selection reselects
   * the preferred instance so builder commands always have a figure. */
  function enforceSelection() {
    if (!session || session.stale) return;
    const bound = session.boundUids;
    if (editor._branchSelection && bound.has(editor._branchSelection.uid)) return;
    const selected = [...editor.selectedUids];
    if (selected.every(uid => bound.has(uid))) {
      if (!selected.length && bound.size) editor.select(session.preferredUid);
      return;
    }
    const keep = selected.filter(uid => bound.has(uid));
    if (keep.length) editor.selectMany(keep);
    else if (bound.size) editor.select(session.preferredUid);
    else if (selected.length || editor.selectedUid !== null) editor.select(null);
  }
  function onEditorChange() {
    if (!session) return;
    session.sync();
    if (session.stale) { leave(); return; }
    // Keep a bound instance on the current frame: the figure under
    // construction is always editable, even on frames where it is absent.
    if (session.typeId !== null && session.figure && !session.boundUids.size && !editor.dragging) {
      try { editor.addFigure(session.typeId); } catch { /* stays unbound */ return; }
      return;
    }
    enforceSelection();
    outliner.update(session);
    if (session.mode === 'create' && session.figure && state.inspectorContext === 'scene') {
      state.inspectorContext = 'figure';
      host.queueUI?.();
    }
    sync();
  }
  /** Toolbar and outliner refresh: joint-gated commands, toggles, title. */
  function sync() {
    if (!session) return;
    const figure = session.figure;
    const boundSelected = editor.selectedUid !== null && session.boundUids.has(editor.selectedUid);
    const hasJoint = Boolean(figure) && boundSelected && editor.selectedJoint >= 0;
    bar.querySelectorAll('[data-action]').forEach(button => {
      const name = button.dataset.action;
      if (JOINT_COMMANDS.has(name)) button.disabled = !hasJoint;
      else if (FIGURE_COMMANDS.has(name)) button.disabled = !figure || !session.boundUids.size;
      else if (name === 'edit-text') button.disabled = !(hasJoint && figure.segments[editor.selectedJoint]?.primitive_code === 5);
    });
    bar.querySelectorAll('[data-tool]').forEach(button =>
      button.classList.toggle('active', button.dataset.tool === state.tool));
    for (const [name, get] of Object.entries(TOGGLES)) {
      const pressed = Boolean(get(state));
      bar.querySelectorAll(`[data-action="${name}"]`).forEach(button => {
        button.setAttribute('aria-pressed', String(pressed));
        button.classList.toggle('active', pressed);
      });
    }
    const title = bar.querySelector('#builder-title');
    if (title) title.textContent = session.mode === 'edit' ? (figure?.name || 'Figure') : 'New figure';
  }
  function enter() {
    if (session) return true;
    host.pause?.(); host.finishCurrentEdit?.(); host.cancelDrag?.(); host.cancelPolygonDraft?.();
    const insertDialog = document.getElementById('insert-dialog');
    if (insertDialog?.open) insertDialog.close();
    session = new BuilderSession(editor).begin();
    session.entryTool = state.tool;
    events = new AbortController();
    editor.addEventListener('change', onEditorChange, {signal: events.signal});
    workspace.dataset.mode = 'rig';
    bar.hidden = false;
    outlinerHost.hidden = false;
    state.builderActive = true;
    state.inspectorContext = session.mode === 'edit' ? 'figure' : 'scene';
    state.inspectorTab = 'design';
    host.setTool(session.figure ? 'rig' : 'line');
    onEditorChange();
    host.onModeChange?.();
    host.status?.(session.mode === 'edit'
      ? `Building ${session.figure?.name || 'figure'} — changes stay scoped to it`
      : 'New figure — draw a line or circle to start');
    return true;
  }
  /** Ends the session after applying the exit choice to the document. */
  function leave() {
    events?.abort(); events = null;
    const entryTool = session?.entryTool;
    session = null;
    state.builderActive = false;
    state.spritePlacement = null;
    state.duplicatePlacement = null;
    outliner.update(null);
    bar.hidden = true;
    outlinerHost.hidden = true;
    workspace.dataset.mode = 'animate';
    host.setTool(entryTool && !ENTRY_TOOLS.has(entryTool) ? entryTool : 'select');
    host.onModeChange?.();
    host.queueUI?.();
  }
  /** Animate button while building: silent exit when nothing changed, else the
   * update / import-new / discard or import / discard confirmation modal. */
  function requestExit() {
    if (!session) return;
    if (session.stale) return leave();
    host.finishCurrentEdit?.();
    if (!session.changed) { session.resolve(session.mode === 'edit' ? 'update' : 'import'); return leave(); }
    if (document.querySelector('#dialog')?.open) host.closeDialog?.();
    const edit = session.mode === 'edit', name = session.figure?.name || 'the figure';
    host.showDialog(edit ? `Keep changes to ${esc(name)}?` : 'Add the new figure to the scene?',
      `<div class="builder-exit-options">${
        edit ? `<button class="builder-exit-option primary" id="builder-exit-update">${icon('check')}<span><strong>Update figure</strong><small>Apply the changes — every instance of ${esc(name)} in the animation updates.</small></span></button>
        <button class="builder-exit-option" id="builder-exit-import-new">${icon('duplicate')}<span><strong>Import as new figure</strong><small>Keep ${esc(name)} unchanged and add the edited figure to the scene.</small></span></button>`
        : `<button class="builder-exit-option primary" id="builder-exit-import">${icon('check')}<span><strong>Import into scene</strong><small>Add the figure to the current frame.</small></span></button>`}
        <button class="builder-exit-option" id="builder-exit-discard">${icon('reset')}<span><strong>Discard changes</strong><small>Undo everything done in the builder.</small></span></button>
      </div><div class="dialog-actions"><button class="button" id="builder-exit-cancel">Keep editing</button></div>`);
    const choose = choice => {
      let imported;
      try {
        host.cancelPolygonDraft?.();
        imported = session.resolve(choice);
      } catch (error) { host.fail?.(error); return; }
      host.closeDialog?.();
      leave();
      if (imported) editor.select(imported.unique_id);
      host.status?.(choice === 'discard' ? 'Builder changes discarded'
        : choice === 'import-new' ? 'Imported as a new figure' : 'Figure updated');
    };
    document.getElementById('builder-exit-update')?.addEventListener('click', () => choose('update'));
    document.getElementById('builder-exit-import-new')?.addEventListener('click', () => choose('import-new'));
    document.getElementById('builder-exit-import')?.addEventListener('click', () => choose('import'));
    document.getElementById('builder-exit-discard')?.addEventListener('click', () => choose('discard'));
    document.getElementById('builder-exit-cancel')?.addEventListener('click', () => host.closeDialog?.());
  }
  return {
    enter, requestExit, leave, sync,
    get active() { return Boolean(session); },
    get session() { return session; },
    get boundUids() { return session?.boundUids ?? null; },
    get mode() { return session ? 'rig' : 'animate'; },
  };
}
