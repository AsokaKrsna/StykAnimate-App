/** Figure-hierarchy outliner for the builder.
 *
 * Shows one definition: its segment forest in native order (depth from the
 * parent chain), then the polygon fills. Selection stays two-way with the
 * canvas — clicking a row selects the joint; selecting a joint highlights and
 * reveals the row. Rows render in a fixed-height virtual window so large
 * figures stay cheap, matching the LayerPanel pattern.
 */
import {icon} from './icons.mjs';

const ROW_HEIGHT = 30;
const STYLE = `
.builder-outliner{position:relative;grid-column:1;grid-row:1;display:none;flex-direction:column;min-width:0;min-height:0;border-right:1px solid var(--theme-border,#e5e5e5);background:var(--theme-panel,#fff);font-size:11px;color:var(--theme-text,#2c2c2c)}
.workspace[data-mode=rig] .builder-outliner{display:flex}
.builder-outliner-resize{position:absolute;top:0;right:-4px;bottom:0;width:8px;z-index:6;cursor:col-resize;touch-action:none}
.builder-outliner-resize:hover,.builder-outliner-resize[data-dragging]{background:var(--theme-action-hover,#369af860)}
.builder-tree.dragging,.builder-tree.dragging *{cursor:grabbing!important;user-select:none}
.builder-drop{position:absolute;left:4px;right:4px;height:2px;background:var(--theme-accent,#0d99ff);border-radius:1px;pointer-events:none;z-index:2}
.builder-drop.child{box-shadow:inset 0 0 0 1.5px var(--theme-accent,#0d99ff);background:var(--theme-selected,#e5f4ff);border-radius:4px;height:auto}
.builder-outliner-head{display:flex;align-items:center;gap:7px;height:38px;min-height:38px;padding:0 10px;border-bottom:1px solid var(--theme-border,#e5e5e5)}
.builder-outliner-icon{display:flex;color:var(--theme-muted,#767676);flex-shrink:0}.builder-outliner-icon .icon{width:16px;height:16px}
.builder-name{flex:1;min-width:0;height:26px;padding:0 6px;border:1px solid transparent;border-radius:5px;background:transparent;font:600 12px inherit;color:var(--theme-text,#2c2c2c);outline:none}
.builder-name:hover{border-color:var(--theme-border,#e5e5e5)}.builder-name:focus{border-color:var(--theme-accent,#0d99ff);background:var(--theme-panel,#fff)}
.builder-outliner-count{font-size:10px;color:var(--theme-muted,#767676);white-space:nowrap}
.builder-tree{position:relative;flex:1;min-height:0;overflow:auto;contain:strict;overscroll-behavior:contain;outline-offset:-2px;scrollbar-width:thin}
.builder-tree-spacer{position:relative;min-height:100%}
.builder-tree-row,.builder-tree-header{position:absolute;left:0;right:0;display:flex;align-items:center;gap:4px;padding:0 6px 0 8px;outline-offset:-2px;user-select:none;cursor:default;border-left:2px solid transparent}
.builder-tree-row:hover{background:var(--theme-hover,#f5f5f5)}
.builder-tree-row[aria-selected=true]{background:var(--theme-selected,#e5f4ff);border-left-color:var(--theme-accent,#0d99ff)}
.builder-tree-header{font-size:9.5px;font-weight:650;letter-spacing:.6px;text-transform:uppercase;color:var(--theme-muted,#767676);background:var(--theme-subtle,#fafafa);border-bottom:1px solid var(--theme-border,#e5e5e5)}
.builder-tree-header span{margin-left:auto;font-weight:400;letter-spacing:0}
.builder-twisty{width:13px;height:13px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--theme-muted,#767676)}
.builder-twisty.open::before{content:"▾";font-size:9px}.builder-twisty.collapsed::before{content:"▸";font-size:9px}
.builder-row-icon{display:flex;align-items:center;flex-shrink:0;color:var(--theme-muted,#767676)}.builder-row-icon .icon{width:13px;height:13px}
.builder-tree-row[aria-selected=true] .builder-row-icon{color:var(--theme-accent,#0d99ff)}
.builder-row-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.builder-badge{font-size:8px;font-weight:700;color:var(--theme-muted,#767676);border:1px solid var(--theme-border,#d5d5d5);border-radius:3px;padding:0 2px;line-height:1.3}
.builder-poly-swatch{width:11px;height:11px;flex-shrink:0;border-radius:3px;border:1px solid var(--theme-border,#c9c9c9);margin:0 2px}
.builder-outliner-empty{position:absolute;top:12px;left:12px;right:12px;color:var(--theme-muted,#858585);line-height:1.5;font-size:11px;pointer-events:none}
`;
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const KIND_LABEL = {line: 'Line', squareLine: 'Square line', circle: 'Circle', circleFill: 'Circle fill', circleClear: 'Circle outline', image: 'Image', text: 'Text'};
const KIND_ICON = {line: 'line', squareLine: 'square', circle: 'circle', circleFill: 'circle', circleClear: 'circle', image: 'image', text: 'text'};
const SEGMENT_KIND = ['line', 'circle', 'image', 'circleFill', 'circleClear', 'text', 'squareLine'];
const segmentKind = segment => {
  const kind = segment.segment_kind ?? segment.segment_type ?? SEGMENT_KIND[segment.primitive_code] ?? 'line';
  return KIND_LABEL[kind] ? kind : 'line';
};

export class FigureOutliner {
  constructor(container, {editor, settings, onSelect, onBranch, onMenu, onRename, onMove, onResize} = {}) {
    this.editor = editor;
    this.onSelect = onSelect ?? (() => {});
    this.onBranch = onBranch ?? (() => {});
    this.onMenu = onMenu ?? (() => {});
    this.onRename = onRename ?? (() => {});
    this.onMove = onMove ?? (() => {});
    this.onResize = onResize ?? (() => {});
    this.container = container;
    this.rows = [];
    this.collapsed = new Set();
    this.focus = -1;
    this._signature = '';
    this.session = null;
    this.style = document.createElement('style');
    this.style.dataset.builderOutliner = '';
    this.style.textContent = STYLE;
    document.head.append(this.style);
    container.innerHTML = `
      <div class="builder-outliner-head">
        <span class="builder-outliner-icon">${icon('person')}</span>
        <input class="builder-name" aria-label="Figure name" spellcheck="false" maxlength="255">
        <span class="builder-outliner-count"></span>
      </div>
      <div class="builder-tree" role="tree" aria-multiselectable="true" aria-label="Figure hierarchy" tabindex="0"><div class="builder-tree-spacer"></div><div class="builder-drop" hidden></div><div class="builder-outliner-empty" hidden></div></div>
      <div class="builder-footer">
        <button id="builder-snap" aria-pressed="true" aria-label="Smart snapping" title="Smart snapping · Alt to bypass">${icon('builder-snap')}</button>
        <button id="builder-timeline-toggle" aria-expanded="false" aria-controls="animation-timeline" title="Show animation timeline">${icon('frame')}<span>Timeline</span></button>
        <button data-action="zoom-selection" title="Fit figure · Shift 2" aria-label="Fit figure">${icon('center')}</button>
      </div>
      <div class="builder-outliner-resize" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize figure structure" aria-valuemin="160" aria-valuemax="520" title="Drag or use arrow keys to resize · Home to reset"></div>
      `;
    this.tree = container.querySelector('.builder-tree');
    this.spacer = container.querySelector('.builder-tree-spacer');
    this.nameInput = container.querySelector('.builder-name');
    this.drop = container.querySelector('.builder-drop');
    const workspace = container.closest('.workspace');
    if (workspace && Number.isFinite(settings?.builderOutlinerWidth))
      workspace.style.setProperty('--builder-outliner-w', `${Math.max(160, Math.min(520, settings.builderOutlinerWidth))}px`);
    const resize = container.querySelector('.builder-outliner-resize');
    resize.setAttribute('aria-valuenow', String(Math.max(160, Math.min(520, settings?.builderOutlinerWidth ?? 236))));
    resize.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const width = event.key === 'Home' ? 236 : Math.max(160, Math.min(520,
        container.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 10)));
      workspace?.style.setProperty('--builder-outliner-w', `${width}px`);
      resize.setAttribute('aria-valuenow', String(width));
      this.onResize(width);
    });
    resize.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      resize.setPointerCapture(event.pointerId);
      resize.dataset.dragging = '';
      const startX = event.clientX, startWidth = container.getBoundingClientRect().width;
      const move = moveEvent => {
        const width = Math.max(160, Math.min(520, startWidth + moveEvent.clientX - startX));
        workspace?.style.setProperty('--builder-outliner-w', `${width}px`);
        resize.setAttribute('aria-valuenow', String(Math.round(width)));
        this._width = width;
      };
      const up = upEvent => {
        resize.removeEventListener('pointermove', move);
        resize.removeEventListener('pointerup', up);
        resize.removeEventListener('pointercancel', up);
        delete resize.dataset.dragging;
        if (upEvent.type !== 'pointercancel' && this._width) this.onResize(Math.round(this._width));
      };
      resize.addEventListener('pointermove', move);
      resize.addEventListener('pointerup', up);
      resize.addEventListener('pointercancel', up);
    });
    this.tree.addEventListener('scroll', () => this.render(), {passive: true});
    this.resizeObserver = new ResizeObserver(() => { if (this.session) this.render(); });
    this.resizeObserver.observe(this.tree);
    this.tree.addEventListener('click', event => {
      if (this._suppressClick) { this._suppressClick = false; return; }
      const row = event.target.closest('[data-row]');
      if (!row) return;
      const entry = this.rows[Number(row.dataset.row)];
      this.focus = Number(row.dataset.row);
      if (event.target.closest('.builder-twisty') && entry?.kind === 'segment' && entry.hasChildren) {
        this.collapsed.has(entry.id) ? this.collapsed.delete(entry.id) : this.collapsed.add(entry.id);
        this._signature = '';
        this.update(this.session, {force: true});
        return;
      }
      this.activate(entry, event);
    });
    this.tree.addEventListener('dblclick', event => {
      const row = event.target.closest('[data-row]');
      const entry = row && this.rows[Number(row.dataset.row)];
      if (entry?.kind === 'segment') this.onBranch(entry.index);
    });
    this.tree.addEventListener('contextmenu', event => {
      const row = event.target.closest('[data-row]');
      const keyboard = event.clientX === 0 && event.clientY === 0;
      const entry = row ? this.rows[Number(row.dataset.row)] : keyboard ? this.rows[this.focus] : null;
      event.preventDefault();
      event.stopPropagation();
      if (entry?.kind === 'segment') this.activate(entry, event);
      const rect = keyboard ? (this.tree.querySelector('[aria-selected=true]') || this.tree).getBoundingClientRect() : null;
      this.onMenu(entry, rect ? rect.left + 24 : event.clientX, rect ? rect.bottom : event.clientY);
    });
    // Drag-reorder: armed on pointerdown over a segment row (twisty excluded),
    // begins past a 5px threshold, and resolves on release into a reparent
    // (drop on a row) or sibling reorder (drop on a row edge). The indicator
    // lives in tree coordinates so virtualization re-renders cannot wipe it.
    this.tree.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const row = event.target.closest('[data-row]');
      const entry = row && this.rows[Number(row.dataset.row)];
      if (entry?.kind !== 'segment' || event.target.closest('.builder-twisty')) return;
      this._pendingDrag = {x: event.clientX, y: event.clientY, entry};
    });
    this.tree.addEventListener('pointermove', event => {
      const pending = this._pendingDrag;
      if (pending && !this._dragging && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 5) {
        this._dragging = pending.entry;
        this._dragBlock = this.descendants(pending.entry.id);
        this.tree.setPointerCapture(event.pointerId);
        this.tree.classList.add('dragging');
      }
      if (!this._dragging) return;
      const y = event.clientY - this.tree.getBoundingClientRect().top + this.tree.scrollTop;
      const index = Math.max(0, Math.min(this.rows.length - 1, Math.floor(y / ROW_HEIGHT)));
      const target = this.rows[index], fraction = (y - index * ROW_HEIGHT) / ROW_HEIGHT;
      const zone = target?.kind === 'segment' && !this._dragBlock.has(target.id)
        ? fraction < 0.3 ? 'before' : fraction > 0.7 ? 'after' : 'child'
        : null;
      this._dropTarget = zone ? {entry: target, zone} : null;
      this.showDrop(index, zone);
    });
    const endDrag = event => {
      const target = this._dropTarget, dragged = this._dragging;
      this._pendingDrag = null; this._dropTarget = null;
      this.drop.hidden = true;
      this.tree.classList.remove('dragging');
      if (dragged) {
        this._dragging = null;
        this._suppressClick = true;
        if (target && event.type !== 'pointercancel') this.onMove(dragged.id, target.entry, target.zone);
      }
    };
    this.tree.addEventListener('pointerup', endDrag);
    this.tree.addEventListener('pointercancel', endDrag);
    this.tree.addEventListener('keydown', event => this.keydown(event));
    this.nameInput.addEventListener('change', () => {
      const name = this.nameInput.value.trim();
      if (name && name !== this.session?.figure?.name) this.onRename(name);
      this.nameInput.value = this.session?.figure?.name ?? '';
    });
    this.nameInput.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') this.nameInput.blur();
      else if (event.key === 'Escape') { this.nameInput.value = this.session?.figure?.name ?? ''; this.nameInput.blur(); }
    });
  }
  /** Rows: the segment forest in definition order (parent_id chains), then a
   * flat Polygons section. Orphaned parents degrade to roots defensively. */
  buildRows(figure) {
    const rows = [];
    const children = new Map(), ids = new Set();
    figure.segments.forEach((segment, index) => {
      ids.add(Number(segment.segment_id));
      const parent = Number(segment.parent_id ?? 0);
      const list = children.get(parent) ?? [];
      list.push(index);
      children.set(parent, list);
    });
    const roots = [...(children.get(0) ?? []),
      ...figure.segments.map((_, index) => index).filter(index => {
        const parent = Number(figure.segments[index].parent_id ?? 0);
        return parent !== 0 && !ids.has(parent);
      })];
    // Iterative traversal is linear and safe for long imported joint chains.
    const visited = new Set(), stack = roots.reverse().map(index => ({index, depth: 0}));
    while (stack.length) {
      const {index, depth} = stack.pop();
      if (visited.has(index)) continue;
      visited.add(index);
      const segment = figure.segments[index], id = Number(segment.segment_id);
      const kids = children.get(id) ?? [];
      const collapsed = this.collapsed.has(id);
      rows.push({kind: 'segment', index, id, parent: Number(segment.parent_id ?? 0), depth, hasChildren: kids.length > 0, collapsed});
      if (!collapsed) for (let i = kids.length - 1; i >= 0; i--) stack.push({index: kids[i], depth: depth + 1});
    }
    const fills = figure.polyfills ?? [];
    if (fills.length) {
      rows.push({kind: 'header', label: 'Polygons', count: fills.length});
      fills.forEach((polygon, index) => rows.push({kind: 'polygon', index, id: `p${polygon.polyfill_id ?? index + 1}`, depth: 1}));
    }
    return rows;
  }
  signature(figure) {
    return figure ? `${figure.figure_type_id}:${this.editor.revision}:${figure.segments.length}:${figure.polyfills?.length ?? 0}` : 'none';
  }
  /** Rebuilds the row model when the definition or revision changed; selection
   * highlight re-renders every call. */
  update(session, {force = false} = {}) {
    this.session = session;
    const figure = session?.figure ?? null;
    const signature = this.signature(figure);
    if (signature !== this._signature || force) {
      this._signature = signature;
      this.rows = figure ? this.buildRows(figure) : [];
      const empty = this.container.querySelector('.builder-outliner-empty');
      empty.hidden = Boolean(figure);
      if (!figure)
        empty.textContent = session?.mode === 'create'
          ? 'Draw a line or circle to start.'
          : 'No instance in this frame.';
      this.container.querySelector('.builder-outliner-count').textContent =
        figure ? `${figure.segments.length} segment${figure.segments.length === 1 ? '' : 's'}` : '';
      if (document.activeElement !== this.nameInput) this.nameInput.value = figure?.name ?? '';
      this.nameInput.disabled = !figure;
      this.nameInput.placeholder = session?.mode === 'create' ? 'New figure' : 'Figure name';
      this.focus = this.rows.findIndex(row => row.kind === 'segment' && row.index === this.editor.selectedJoint);
    }
    this.render();
    if (session && this.editor.selectedJoint !== this._lastJoint) {
      this._lastJoint = this.editor.selectedJoint;
      this.revealSelected();
    }
  }
  /** Segment ids inside a joint's branch — drops onto any of them are rejected. */
  descendants(rootId) {
    const out = new Set([rootId]), figure = this.session?.figure;
    if (!figure) return out;
    const children = new Map();
    for (const segment of figure.segments) {
      const parent = Number(segment.parent_id ?? 0), list = children.get(parent) ?? [];
      list.push(Number(segment.segment_id)); children.set(parent, list);
    }
    for (const id of out) for (const child of children.get(id) ?? []) if (!out.has(child)) out.add(child);
    return out;
  }
  showDrop(index, zone) {
    if (!zone) { this.drop.hidden = true; return; }
    this.drop.hidden = false;
    this.drop.classList.toggle('child', zone === 'child');
    this.drop.style.top = `${(index + (zone === 'after' ? 1 : 0)) * ROW_HEIGHT - (zone === 'child' ? 0 : 1)}px`;
    this.drop.style.height = zone === 'child' ? `${ROW_HEIGHT}px` : '2px';
  }
  activate(entry, event) {
    if (!entry) return;
    if (entry.kind === 'segment') this.onSelect(entry.index, {shift: event?.shiftKey});
    else if (entry.kind === 'polygon') this.onSelect(entry, {polygon: true});
  }
  rowHtml(entry, index) {
    const editor = this.editor;
    const selected = entry.kind === 'segment' && editor.selectedSegmentIds.has(entry.id) &&
      this.session?.boundUids.has(editor.selectedUid);
    const style = `top:${index * ROW_HEIGHT}px;height:${ROW_HEIGHT}px`;
    if (entry.kind === 'header')
      return `<div class="builder-tree-header" style="${style}" role="presentation">${esc(entry.label)}<span>${entry.count}</span></div>`;
    if (entry.kind === 'polygon') {
      const polygon = this.session.figure.polyfills[entry.index];
      const color = polygon?.color_rgb ? `rgb(${polygon.color_rgb.join(',')})` : 'transparent';
      return `<div class="builder-tree-row" id="builder-fill-${entry.index}" data-row="${index}" style="${style}" role="treeitem" aria-selected="${editor.selectedPolygonIndex === entry.index}">
        <span class="builder-indent" style="width:${entry.depth * 14}px"></span>
        <span class="builder-twisty"></span>
        <span class="builder-poly-swatch" style="background:${color}"></span>
        <span class="builder-row-label">Fill ${esc(polygon?.polyfill_id ?? entry.index + 1)}</span>
      </div>`;
    }
    const segment = this.session.figure.segments[entry.index], kind = segmentKind(segment);
    const badges = `${segment._stykRig?.connector ? '<b class="builder-badge" title="Connector · sliding attachment joint">C</b>' : ''}${segment._stykRig?.stretch ? '<b class="builder-badge" title="Smart Stretch driver">↔</b>' : ''}${segment._stykRig?.follow ? '<b class="builder-badge" title="Stretch follower">F</b>' : ''}${segment.static || segment.is_static ? '<b class="builder-badge" title="Static joint">S</b>' : ''}${segment.visible === false ? '<b class="builder-badge" title="Hidden">H</b>' : ''}`;
    return `<div class="builder-tree-row" id="builder-joint-${entry.id}" data-row="${index}" style="${style}" role="treeitem" aria-level="${entry.depth + 1}" ${entry.hasChildren ? `aria-expanded="${!entry.collapsed}"` : ''} aria-selected="${selected}">
      <span class="builder-indent" style="width:${entry.depth * 14}px"></span>
      <span class="builder-twisty${entry.hasChildren ? (entry.collapsed ? ' collapsed' : ' open') : ''}"></span>
      <span class="builder-row-icon">${icon(KIND_ICON[kind] ?? 'line')}</span>
      <span class="builder-row-label">${esc(segment.name || `${KIND_LABEL[kind] ?? 'Segment'} ${entry.id}`)}</span>
      ${badges}
    </div>`;
  }
  render() {
    if (!this.rows.length) {
      this.spacer.innerHTML = ''; this._rendered = ''; this.spacer.style.height = '0px';
      this.tree.removeAttribute('aria-activedescendant'); return;
    }
    const view = this.tree.clientHeight || 1, start = Math.max(0, Math.floor(this.tree.scrollTop / ROW_HEIGHT) - 4);
    const count = Math.min(this.rows.length - start, Math.ceil(view / ROW_HEIGHT) + 8);
    const rows = [];
    for (let i = start; i < start + count; i++) rows.push(this.rowHtml(this.rows[i], i));
    this.spacer.style.height = `${this.rows.length * ROW_HEIGHT}px`;
    const html = rows.join('');
    if (this._rendered !== html) { this.spacer.innerHTML = html; this._rendered = html; }
    const selected = this.spacer.querySelector('[aria-selected=true]');
    if (selected) this.tree.setAttribute('aria-activedescendant', selected.id);
    else this.tree.removeAttribute('aria-activedescendant');
  }
  keydown(event) {
    const keys = {ArrowDown: 1, ArrowUp: -1};
    if (event.key in keys) {
      event.preventDefault(); event.stopPropagation();
      const segments = this.rows.map((row, index) => row.kind === 'segment' ? index : -1).filter(index => index >= 0);
      if (!segments.length) return;
      const current = segments.indexOf(this.focus);
      const next = segments[Math.max(0, Math.min(segments.length - 1, current + keys[event.key]))];
      this.focus = next;
      this.activate(this.rows[next], event);
      this.scrollToRow(next);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const entry = this.rows[this.focus];
      if (entry?.kind === 'segment' && entry.hasChildren) {
        const collapsed = this.collapsed.has(entry.id);
        if ((event.key === 'ArrowRight') === collapsed) {
          this.collapsed[event.key === 'ArrowRight' ? 'delete' : 'add'](entry.id);
          this._signature = '';
          this.update(this.session, {force: true});
          this.focus = this.rows.findIndex(row => row.kind === 'segment' && row.id === entry.id);
        }
      }
      event.preventDefault(); event.stopPropagation();
    } else if (event.key === 'Enter' || event.key === ' ') {
      const entry = this.rows[this.focus];
      if (entry) { event.preventDefault(); event.stopPropagation(); this.activate(entry, event); }
    }
  }
  scrollToRow(index) {
    const top = index * ROW_HEIGHT;
    if (top < this.tree.scrollTop || top + ROW_HEIGHT > this.tree.scrollTop + this.tree.clientHeight)
      this.tree.scrollTop = top - this.tree.clientHeight / 2;
  }
  /** Reveal the canvas-selected joint after external selection changes. */
  revealSelected() {
    const joint = this.editor.selectedJoint;
    if (joint < 0) return;
    let index = this.rows.findIndex(row => row.kind === 'segment' && row.index === joint);
    if (index < 0 && this.session?.figure) {
      const figure = this.session.figure, parents = new Map(figure.segments.map(s => [Number(s.segment_id), Number(s.parent_id)]));
      const seen = new Set();
      let id = parents.get(Number(figure.segments[joint]?.segment_id));
      while (id && !seen.has(id)) { seen.add(id); this.collapsed.delete(id); id = parents.get(id); }
      this.rows = this.buildRows(figure);
      index = this.rows.findIndex(row => row.kind === 'segment' && row.index === joint);
    }
    if (index >= 0) { this.focus = index; this.scrollToRow(index); this.render(); }
  }
}
