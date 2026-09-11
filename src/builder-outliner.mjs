/** Figure-hierarchy outliner for the builder.
 *
 * Shows one definition: an origin root, its segment tree in native order, then
 * the polygon fills. Selection stays two-way with the canvas — clicking a row
 * selects the joint; selecting a joint highlights and reveals the row. Rows are
 * rendered in a fixed-height virtual window so large figures stay cheap.
 */
import {icon} from './icons.mjs';

const ROW_HEIGHT = 26;
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const KIND_LABEL = {line: 'Line', squareLine: 'Square line', circle: 'Circle', circleFill: 'Circle fill', circleClear: 'Circle outline', image: 'Image', text: 'Text'};
const KIND_ICON = {line: 'line', squareLine: 'square', circle: 'circle', circleFill: 'circle', circleClear: 'circle', image: 'image', text: 'text'};
const SEGMENT_KIND = [ 'line', 'line', 'image', 'circleFill', 'circleClear', 'text', 'squareLine' ];
const segmentKind = segment => segment.segment_type && KIND_LABEL[segment.segment_type] ? segment.segment_type : SEGMENT_KIND[segment.primitive_code] ?? 'line';

export class FigureOutliner {
  constructor(container, {editor, onSelect, onBranch, onMenu, onRename} = {}) {
    this.editor = editor;
    this.onSelect = onSelect ?? (() => {});
    this.onBranch = onBranch ?? (() => {});
    this.onMenu = onMenu ?? (() => {});
    this.onRename = onRename ?? (() => {});
    this.container = container;
    this.rows = [];
    this.collapsed = new Set();
    this.focus = -1;
    this._signature = '';
    container.innerHTML = `
      <div class="builder-outliner-head">
        <span class="builder-outliner-icon">${icon('person')}</span>
        <input class="builder-name" aria-label="Figure name" spellcheck="false" maxlength="255">
        <span class="builder-outliner-count"></span>
      </div>
      <div class="builder-tree" role="tree" aria-label="Figure hierarchy" tabindex="0"></div>
      <div class="builder-outliner-empty" hidden></div>`;
    this.tree = container.querySelector('.builder-tree');
    this.nameInput = container.querySelector('.builder-name');
    this.tree.addEventListener('scroll', () => this.render());
    this.tree.addEventListener('click', event => {
      const row = event.target.closest('[data-row]');
      if (!row) return;
      const entry = this.rows[Number(row.dataset.row)];
      this.focus = Number(row.dataset.row);
      if (event.target.closest('.builder-twisty')) {
        if (entry?.kind === 'segment' && entry.hasChildren) {
          this.collapsed.has(entry.id) ? this.collapsed.delete(entry.id) : this.collapsed.add(entry.id);
          this._signature = '';
          this.update(this.session, {force: true});
        }
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
      const entry = row && this.rows[Number(row.dataset.row)];
      if (!entry) return;
      event.preventDefault();
      if (entry.kind === 'segment') this.activate(entry, event);
      this.onMenu(entry, event.clientX, event.clientY);
    });
    this.tree.addEventListener('keydown', event => this.keydown(event));
    this.nameInput.addEventListener('change', () => {
      const name = this.nameInput.value.trim();
      if (name && name !== this.session?.figure?.name) this.onRename(name);
      this.nameInput.value = this.session?.figure?.name ?? '';
    });
    this.nameInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); this.nameInput.blur(); }
      else if (event.key === 'Escape') { this.nameInput.value = this.session?.figure?.name ?? ''; this.nameInput.blur(); }
      event.stopPropagation();
    });
  }
  /** Rows: origin root, the segment forest in definition order, then fills. */
  buildRows(figure) {
    const rows = [];
    const children = new Map();
    figure.segments.forEach((segment, index) => {
      const parent = Number(segment.parent_id ?? 0);
      const list = children.get(parent) ?? [];
      list.push(index);
      children.set(parent, list);
    });
    const ids = new Set(figure.segments.map(segment => Number(segment.segment_id)));
    const roots = children.get(0) ?? [];
    const orphans = figure.segments.map((segment, index) => index)
      .filter(index => !ids.has(Number(figure.segments[index].parent_id)) && Number(figure.segments[index].parent_id) !== 0);
    const depthOf = index => {
      let depth = 1, cursor = index, seen = new Set();
      while (cursor !== undefined && !seen.has(cursor)) {
        seen.add(cursor);
        const parent = Number(figure.segments[cursor].parent_id ?? 0);
        if (!ids.has(parent)) break;
        cursor = figure.segments.findIndex(segment => Number(segment.segment_id) === parent);
        depth++;
      }
      return depth;
    };
    const visit = index => {
      const segment = figure.segments[index], id = Number(segment.segment_id);
      const kids = children.get(id) ?? [];
      const collapsed = this.collapsed.has(id);
      rows.push({kind: 'segment', index, id, depth: depthOf(index), hasChildren: kids.length > 0, collapsed});
      if (!collapsed) for (const child of kids) visit(child);
    };
    for (const index of [...roots, ...orphans]) visit(index);
    const fills = figure.polyfills ?? [];
    if (fills.length) {
      rows.push({kind: 'header', label: 'Polygons', count: fills.length});
      fills.forEach((polygon, index) => rows.push({kind: 'polygon', index, id: `p${polygon.polyfill_id ?? index + 1}`, depth: 1}));
    }
    return rows;
  }
  signature(figure, session) {
    return figure ? `${figure.figure_type_id}:${this.editor.revision}:${figure.segments.length}:${figure.polyfills?.length ?? 0}` : `none:${session?.mode ?? ''}`;
  }
  /** Rebuilds the row model when the definition or selection changed. */
  update(session, {force = false} = {}) {
    this.session = session;
    const figure = session?.figure ?? null;
    const signature = this.signature(figure, session);
    if (signature !== this._signature || force) {
      this._signature = signature;
      this.rows = figure ? this.buildRows(figure) : [];
      this.tree.style.height = '';
      const empty = this.container.querySelector('.builder-outliner-empty');
      empty.hidden = Boolean(figure);
      if (!figure)
        empty.textContent = session?.mode === 'create'
          ? 'Nothing drawn yet. Use the line or circle tool to create the first segment.'
          : 'The figure has no instance in this frame.';
      const count = this.container.querySelector('.builder-outliner-count');
      count.textContent = figure ? `${figure.segments.length} segment${figure.segments.length === 1 ? '' : 's'}` : '';
      if (document.activeElement !== this.nameInput) this.nameInput.value = figure?.name ?? '';
      this.nameInput.disabled = !figure;
      this.nameInput.placeholder = session?.mode === 'create' ? 'New figure' : 'Figure name';
      this.focus = -1;
    }
    this.render();
  }
  activate(entry, event) {
    if (!entry) return;
    if (entry.kind === 'segment') this.onSelect(entry.index, {shift: event.shiftKey});
    else if (entry.kind === 'polygon') this.onSelect?.(entry, {polygon: true});
  }
  rowHtml(entry, index) {
    const editor = this.editor;
    const selected = entry.kind === 'segment' && editor.selectedJoint === entry.index && this.session?.boundUids.has(editor.selectedUid);
    const style = `top:${index * ROW_HEIGHT}px;height:${ROW_HEIGHT}px`;
    if (entry.kind === 'header')
      return `<div class="builder-tree-header" style="${style}" role="presentation">${esc(entry.label)}<span>${entry.count}</span></div>`;
    if (entry.kind === 'polygon') {
      const polygon = this.session.figure.polyfills[entry.index];
      const color = polygon?.color_rgb ? `rgb(${polygon.color_rgb.join(',')})` : 'transparent';
      return `<div class="builder-tree-row" data-row="${index}" style="${style}" role="treeitem" data-depth="${entry.depth}">
        <span class="builder-indent" style="width:${entry.depth * 14}px"></span>
        <span class="builder-twisty"></span>
        <span class="builder-poly-swatch" style="background:${color}"></span>
        <span class="builder-row-label">Fill ${esc(polygon?.polyfill_id ?? entry.index + 1)}</span>
      </div>`;
    }
    const segment = this.session.figure.segments[entry.index], kind = segmentKind(segment);
    const badges = `${segment.static || segment.is_static ? '<b class="builder-badge" title="Static">S</b>' : ''}${segment.visible === false ? '<b class="builder-badge" title="Hidden">H</b>' : ''}`;
    return `<div class="builder-tree-row${selected ? ' selected' : ''}" data-row="${index}" style="${style}" role="treeitem" aria-selected="${selected}" data-depth="${entry.depth}">
      <span class="builder-indent" style="width:${entry.depth * 14}px"></span>
      <span class="builder-twisty${entry.hasChildren ? (entry.collapsed ? ' collapsed' : ' open') : ''}"></span>
      <span class="builder-row-icon">${icon(KIND_ICON[kind] ?? 'line')}</span>
      <span class="builder-row-label">${esc(segment.name || `${KIND_LABEL[kind] ?? 'Segment'} ${entry.id}`)}</span>
      ${badges}
    </div>`;
  }
  render() {
    if (!this.rows.length) { this.tree.innerHTML = ''; return; }
    const view = this.tree.clientHeight || 1, start = Math.max(0, Math.floor(this.tree.scrollTop / ROW_HEIGHT) - 4);
    const count = Math.min(this.rows.length - start, Math.ceil(view / ROW_HEIGHT) + 8);
    const rows = [];
    for (let i = start; i < start + count; i++) rows.push(this.rowHtml(this.rows[i], i));
    this.tree.innerHTML = `<div class="builder-tree-spacer" style="height:${this.rows.length * ROW_HEIGHT}px"></div>` + rows.join('');
  }
  keydown(event) {
    const keys = {ArrowDown: 1, ArrowUp: -1};
    if (event.key in keys) {
      event.preventDefault();
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
        }
      }
      event.preventDefault();
    } else if (event.key === 'Enter' || event.key === ' ') {
      const entry = this.rows[this.focus];
      if (entry) { event.preventDefault(); this.activate(entry, event); }
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
    const index = this.rows.findIndex(row => row.kind === 'segment' && row.index === joint);
    if (index >= 0) this.scrollToRow(index);
  }
}
