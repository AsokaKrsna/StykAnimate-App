import {attachTimelineHotkeys} from './timeline-hotkeys.mjs';
import {pasteSheetClipboard} from './shared-clipboard.mjs';
import {sheetKeyTimes, sheetKeyAt} from './layer-sheet.mjs';
import {icon} from './icons.mjs';
import {keyEasing, EASING_MODES} from './keyframe-easing.mjs';
import {showKeyframeEasingPopover} from './keyframe-easing-popover.mjs';
import {showTimelineMenu} from './timeline-menu.mjs';
import {AudioTimeline} from './audio-timeline.mjs';

const WIDTH = 112;
const el = (tag, parent, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
};

/** Whole-scene filmstrip over the same layer poses used by the canvas. */
export class SheetFilmstrip {
  constructor(container, editor, options = {}) {
    this.editor = editor;
    this.container = container;
    Object.assign(this, options);
    attachTimelineHotkeys(this);
    this.events = new AbortController();
    this.cards = new Map();
    this.previews = new Map();
    this.queue = [];
    this.generation = 0;
    this.times = sheetKeyTimes(editor.report);
    this.selected = new Set([this.selectedIndex]);
    this.anchor = this.selectedIndex;
    this.revealPending = true;
    this.root = el('div', container, 'sheet-filmstrip');
    this.controls = el('div', this.root, 'sheet-filmstrip-controls');
    this.counter = el('div', this.controls, 'sheet-filmstrip-counter');
    const label = el('label', this.controls, 'sheet-filmstrip-field', 'Inbetweens');
    this.duration = el('input', label);
    Object.assign(this.duration, {type: 'number', min: '0', max: '65534', step: '1'});
    this.duration.setAttribute('aria-label', 'Frame inbetweens');
    const tweening = el('div', this.controls, 'sheet-filmstrip-field');
    el('span', tweening, '', 'Tweening');
    this.easingButton = this.button(tweening, 'Frame easing', () => this.showEasingPopover());
    this.easingButton.className = 'sheet-easing-button';
    this.easingLabel = el('span', this.easingButton);
    this.easingButton.insertAdjacentHTML('beforeend', icon('chevron-down'));
    this.easingButton.setAttribute('aria-haspopup', 'dialog');
    this.mainButton = this.button(this.controls, 'Add Frame', () => this.action('add'));
    this.mainButton.className = 'sheet-add-frame';
    this.mainButton.innerHTML = `${icon('plus')}<span>Add Frame</span>`;
    const actions = el('div', this.controls, 'sheet-filmstrip-actions');
    this.copyButton = this.button(actions, 'Copy frames', () => this.copySelection(), 'duplicate');
    this.pasteButton = this.button(actions, 'Paste frames', () => this.pasteSelection(), 'clipboard');
    this.copyButton.dataset.hotkeyCommand = 'copy';
    this.pasteButton.dataset.hotkeyCommand = 'paste';
    this.mainButton.dataset.hotkeyCommand = 'add-frame';
    this.deleteButton = this.button(actions, 'Delete frames', () => this.action('delete'), 'trash');
    this.strip = el('div', this.root, 'sheet-filmstrip-scroll');
    this.strip.tabIndex = 0;
    this.strip.setAttribute('role', 'listbox');
    this.strip.setAttribute('aria-label', 'Animation frames');
    this.strip.setAttribute('aria-multiselectable', 'true');
    this.spacer = el('div', this.strip, 'sheet-filmstrip-spacer');
    this._on(this.strip, 'scroll', () => this.update());
    this._on(this.strip, 'wheel', event => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      this.strip.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    }, {passive: false});
    this._on(this.strip, 'keydown', event => this.keydown(event));
    this._on(this.duration, 'keydown', event => event.stopPropagation());
    this._on(this.duration, 'change', () => this._run(() => this.setDuration(this.selectedFrameIndices, Number(this.duration.value))));
    this._on(editor, 'change', event => {
      const detail = event.detail ?? {};
      if (detail.kind === 'document' || detail.structural || detail.timing || detail.kind === 'history' && !detail.audio) {
        this.times = sheetKeyTimes(editor.report);
        this.generation++;
        this.previews.clear();
        this.queue = [];
        this.selected = new Set([...this.selected].filter(index => index < this.times.length));
        if (!this.selected.size || detail.kind === 'document') this.selected = new Set([this.selectedIndex]);
        if (detail.kind === 'document') this.revealPending = true;
      }
      if (detail.kind === 'seek' && !this.selecting) {
        this.selected = new Set([this.selectedIndex]);
        this.anchor = this.selectedIndex;
        this.revealPending = true;
      }
      this.update();
    });
    this.observer = new ResizeObserver(() => this.update());
    this.observer.observe(this.root);
    this.render();
    this.audio = new AudioTimeline(container, editor, {...options, host:this, engine:options.audioEngine, mode:'simple'});
  }
  _on(target, name, fn, options = {}) { target.addEventListener(name, fn, {signal: this.events.signal, ...options}); }
  _run(operation) {
    try { this.onSeek?.(); const result = operation(); this.update();
      if (result?.then) return result.catch(error => { this.onError?.(error); return false; }).finally(() => this.update());
      return result; }
    catch (error) { this.onError?.(error); this.update(); return false; }
  }
  button(parent, title, action, symbol) {
    const button = el('button', parent, 'icon-button');
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    if (symbol) button.innerHTML = icon(symbol);
    this._on(button, 'click', () => this._run(action));
    return button;
  }
  get ids() { return ['scene', 'camera', ...this.editor.report._styk.layers.order]; }
  get locked() { return this.ids.some(id => this.editor.getLayer(id)?.locked); }
  get selectedIndex() { return Math.max(0, this.times.findLastIndex(tick => tick <= this.editor.tick)); }
  get selectedFrameIndices() { return [...this.selected].sort((a, b) => a - b); }
  get selectedTicks() { return this.selectedFrameIndices.map(i => this.times[i]).filter(Number.isFinite); }
  get selectedTimeRange() {
    const times = this.selectedTicks, index = this.times.indexOf(times.at(-1));
    return {start: times[0] ?? this.editor.tick, end: this.times[index + 1] ?? this.editor.totalTicks};
  }
  get frameCount() { return this.times.length; }
  get stats() { return {rows: this.cards.size, cachedPreviews: this.previews.size, queuedPreviews: this.queue.length}; }
  ranges(indices = this.selectedFrameIndices) {
    return indices.filter(i => Number.isInteger(i) && i >= 0 && i < this.times.length)
      .map(i => ({index: i, start: this.times[i], end: this.times[i + 1] ?? this.editor.totalTicks}));
  }
  selectFrame(index, {extend = false} = {}) {
    index = Math.max(0, Math.min(this.times.length - 1, index));
    if (extend) this.selected = new Set(Array.from({length: Math.abs(index - this.anchor) + 1}, (_, i) => Math.min(index, this.anchor) + i));
    else { this.selected = new Set([index]); this.anchor = index; }
    this.onSeek?.();
    this.selecting = true;
    try { this.editor.seek(this.times[index]); } finally { this.selecting = false; }
    this.ensureVisible(index);
    this.onRangeChange?.(this.selectedFrameIndices);
    this.update();
  }
  ensureVisible(index) {
    if (!this.strip.clientWidth) { this.revealPending = true; return; }
    const x = index * WIDTH;
    if (x < this.strip.scrollLeft) this.strip.scrollLeft = x;
    else if (x + WIDTH > this.strip.scrollLeft + this.strip.clientWidth) this.strip.scrollLeft = x + WIDTH - this.strip.clientWidth;
  }
  setDuration(indices, inbetweens) {
    if (!Number.isInteger(inbetweens) || inbetweens < 0 || inbetweens > 65534) throw new Error('Inbetweens must be 0–65,534.');
    const ranges = this.ranges(indices).sort((a, b) => b.start - a.start);
    const active = this.selectedIndex, offset = this.editor.tick - this.times[active];
    const result = this.editor.movieclipBatch('Set frame inbetweens', () => {
      for (const {start, end} of ranges) {
        const delta = inbetweens + 1 - (end - start);
        if (delta > 0) this.editor.sheetInsertFrames(this.ids, end, delta);
        else if (delta < 0) this.editor.sheetRemoveFrames(this.ids, start + inbetweens + 1, end - 1);
      }
    });
    const start = this.times[active], end = this.times[active + 1] ?? this.editor.totalTicks;
    this.selecting = true;
    try { this.editor.seek(start + Math.min(offset, end - start - 1)); }
    finally { this.selecting = false; }
    this.onRangeChange?.(this.selectedFrameIndices);
    return result;
  }
  easingSettings(indices = this.selectedFrameIndices) {
    return this.ranges(indices).flatMap(({start}) => this.ids.flatMap(id => {
      const key = sheetKeyAt(this.editor.report._styk.layerSheet.tracks[id], start).key;
      return key && !key.empty && key.value?.frameId !== null ? [keyEasing(key)] : [];
    }));
  }
  applyEasing(indices, easing) {
    const ranges = this.ranges(indices);
    return this.editor.movieclipBatch('Set scene frame easing', () => {
      for (const {start, end} of ranges) {
        // A filmstrip cell can begin inside another layer's exposure. Establish
        // its boundaries before changing easing so adjacent scene frames retain theirs.
        for (const tick of [start, end]) if (tick < this.editor.totalTicks) {
          const missing = this.ids.filter(id => !this.editor.layerFrameKeys(id).some(key => key.tick === tick));
          if (missing.length) this.editor.sheetInsertKey(missing, tick);
        }
        this.editor.sheetSetEasing(this.ids, start, end - 1, easing);
      }
    });
  }
  showEasingPopover() { if (!this.locked) return showKeyframeEasingPopover.call(this); }
  render() {
    if (this.disposed) return;
    const width = `${this.times.length * WIDTH}px`;
    if (this.spacer.style.width !== width) this.spacer.style.width = width;
    if (!this.strip.clientWidth) return;
    // A hidden mount cannot scroll yet. Reveal once layout exists, then leave
    // deliberate scrolling alone until the playhead is explicitly moved.
    if (this.revealPending && this.strip.clientWidth) {
      this.revealPending = false;
      this.ensureVisible(this.selectedIndex);
    }
    const first = Math.max(0, Math.floor(this.strip.scrollLeft / WIDTH) - 1);
    const last = Math.min(this.times.length, first + Math.ceil(this.strip.clientWidth / WIDTH) + 3);
    const active = this.selectedIndex, locked = this.locked;
    this.counter.textContent = `Frame ${active + 1} / ${this.times.length}`;
    const amounts = this.ranges().map(({start, end}) => end - start - 1);
    if (document.activeElement !== this.duration) this.duration.value = amounts.every(n => n === amounts[0]) ? String(amounts[0] ?? 0) : '';
    this.duration.placeholder = 'Mixed';
    const settings = this.easingSettings(), mode = settings[0]?.interpolation;
    this.easingLabel.textContent = settings.every(value => JSON.stringify(value) === JSON.stringify(settings[0])) ?
      mode === 'constant' ? 'None' : EASING_MODES.find(item => item.id === mode)?.label ?? 'None' : 'Mixed';
    this.duration.disabled = this.easingButton.disabled = this.mainButton.disabled = this.deleteButton.disabled = this.copyButton.disabled = locked;
    this.pasteButton.disabled = locked || (!this.sharedClipboard && !this.editor._sheetClipboard);
    for (const [index, card] of this.cards) if (index < first || index >= last) {
      card._events.abort(); card.remove(); this.cards.delete(index); this.previews.delete(index);
    }
    this.queue = this.queue.filter(item => this.cards.get(item.index) === item.card && item.generation === this.generation);
    for (let index = first; index < last; index++) {
      let card = this.cards.get(index);
      if (!card) {
        card = el('div', this.spacer, 'sheet-filmstrip-card');
        card._events = new AbortController();
        const listen = (target, name, fn) => this._on(target, name, fn, {signal: card._events.signal});
        card.dataset.frame = index;
        card.style.left = `${index * WIDTH}px`;
        el('span', card, 'sheet-frame-number', String(index + 1));
        const preview = el('button', card, 'sheet-preview');
        preview.type = 'button';
        preview.setAttribute('role', 'option');
        preview.setAttribute('aria-label', `Frame ${index + 1}`);
        preview.title = 'Double-click for easing';
        const canvas = el('canvas', preview);
        canvas.width = 100; canvas.height = 60;
        const amount = el('label', card, 'sheet-inbetweens');
        amount.title = 'Inbetweens after this frame';
        const slider = el('input', amount);
        Object.assign(slider, {type: 'range', min: '0', step: '1'});
        slider.setAttribute('aria-label', `Frame ${index + 1} inbetweens`);
        const value = el('span', amount);
        listen(slider, 'input', () => { value.textContent = slider.value; slider.setAttribute('aria-valuetext', `${slider.value} inbetweens`); });
        listen(slider, 'change', () => this._run(() => this.setDuration([index], Number(slider.value))));
        listen(preview, 'click', event => this.selectFrame(index, {extend: event.shiftKey}));
        listen(preview, 'dblclick', () => this._run(() => this.showEasingPopover()));
        listen(card, 'contextmenu', event => { event.preventDefault(); if (!this.selected.has(index)) this.selectFrame(index); this._menu(event); });
        Object.assign(card, {_button: preview, _canvas: canvas, _slider: slider, _amount: value});
        this.cards.set(index, card);
      }
      card.dataset.current = String(active === index);
      card.dataset.selected = String(this.selected.has(index));
      card._button.setAttribute('aria-selected', String(this.selected.has(index)));
      const amount = (this.times[index + 1] ?? this.editor.totalTicks) - this.times[index] - 1;
      if (document.activeElement !== card._slider) {
        card._slider.max = String(Math.max(20, amount));
        card._slider.value = String(amount);
        card._amount.textContent = String(amount);
        card._slider.setAttribute('aria-valuetext', `${amount} inbetweens`);
      }
      card._slider.disabled = locked;
      if (this.previews.get(index) !== this.generation && !this.queue.some(item => item.index === index)) this.queue.push({index, card, generation: this.generation});
    }
    this._drain();
  }
  async _drain() {
    if (this.busy || this.paused || this.disposed || !this.strip.clientWidth) return;
    this.busy = true;
    try {
      while (this.queue.length && !this.paused && !this.disposed && this.strip.clientWidth) {
        const item = this.queue.shift();
        if (item.generation !== this.generation || !item.card.isConnected) continue;
        const tick = this.times[item.index], rows = this.editor.timeline, index = Math.max(0, rows.findLastIndex(row => row.start <= tick));
        try {
          const done = await this.renderThumbnail?.(index, item.card._canvas, {tick, storedFrames: false});
          if (done !== false && item.generation === this.generation && this.cards.get(item.index) === item.card) this.previews.set(item.index, item.generation);
        } catch (error) { if (error.name !== 'AbortError') this.onError?.(error); }
      }
    } finally { this.busy = false; }
  }
  copySelection() { const {start, end} = this.selectedTimeRange, ids = this.ids; return this._clipboard('copy', () => this.editor.sheetCopyFrames(ids, start, end - 1)); }
  cutSelection() { return this._clipboard('copy', () => { this.editor.sheetCopyFrames(this.ids, this.selectedTimeRange.start, this.selectedTimeRange.end - 1); this.action('delete'); return this.editor._sheetClipboard; }); }
  pasteSelection(atEnd = false) { const tick = atEnd ? this.editor.totalTicks : this.times[this.selectedIndex], ids = this.ids; return this._clipboard('paste', () => pasteSheetClipboard(this.editor, ids, tick, {insert: true, wholeScene: true})); }
  _clipboard(action, operation) { return this._run(() => this.sharedClipboard ? this.sharedClipboard[action]('sheet', operation) : operation()); }
  selectAll() { this.selected = new Set(this.times.map((_, i) => i)); this.onRangeChange?.(this.selectedFrameIndices); this.update(); }
  action(command) {
    return this._run(() => {
      if (['add', 'add-frame', 'duplicate'].includes(command)) return this.onAddFrame ? this.onAddFrame() : this.editor.sheetDuplicateFrameAfter(this.ids);
      if (command === 'duplicate-after') return this.editor.sheetDuplicateFrameAfter(this.ids);
      if (command === 'copy') return this.copySelection();
      if (command === 'paste' || command === 'paste-end') return this.pasteSelection(command === 'paste-end');
      if (command === 'delete') {
        const ranges = this.ranges().sort((a, b) => b.start - a.start);
        return this.editor.movieclipBatch('Remove scene frames', () => {
          for (const {start, end} of ranges) this.editor.sheetRemoveFrames(this.ids, start, end - 1);
        });
      }
      if (command === 'insert') {
        const clipboard = this.editor._sheetClipboard, start = this.times[this.selectedIndex];
        try { this.editor.sheetCopyFrames(this.ids, start, start); return this.editor.sheetPasteFrames(this.ids, start, {insert: true}); }
        finally { this.editor._sheetClipboard = clipboard; }
      }
    });
  }
  keydown(event) {
    if (event.target.matches('input,select,textarea')) { event.stopPropagation(); return; }
    if (this.ownsHotkeys && this.hotkeys.keydown(event, ['simple'])) event.stopPropagation();
  }
  _menu(event) {
    const locked = this.locked, canPaste = !locked && (this.sharedClipboard || this.editor._sheetClipboard);
    showTimelineMenu(this, event, [
      [!locked && {label: 'Frame easing…', symbol: 'sliders', action: () => this.showEasingPopover()},
       !locked && {label: 'Add Frame', shortcut: this.shortcut('add-frame'), symbol: 'plus', action: () => this.action('add')}],
      [!locked && {label: 'Copy frames', shortcut: this.shortcut('copy'), symbol: 'duplicate', action: () => this.copySelection()},
       !locked && {label: 'Cut frames', shortcut: this.shortcut('cut'), symbol: 'cut', action: () => this.cutSelection()},
       canPaste && {label: 'Paste frames', shortcut: this.shortcut('paste'), symbol: 'clipboard', action: () => this.pasteSelection()}],
      [!locked && {label: 'Delete frames', shortcut: this.shortcut('delete'), symbol: 'trash', danger: true, action: () => this.action('delete')},
       locked && {label: 'Unlock layers', symbol: 'unlock', action: () => { for (const id of this.ids) this.editor.setLayerLocked(id, false); }}],
    ]);
  }
  setPaused(value) { this.paused = value; if (!value) this._drain(); }
  update() { if (this.disposed || this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = null; this.render(); }); }
  resize() { this.update(); }
  setZoom() {}
  revealPlayhead() { this.ensureVisible(this.selectedIndex); this.update(); }
  destroy() {
    this.audio?.destroy();
    this.disposed = true; this.generation++;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.events.abort(); this.menuEvents?.abort(); this.observer.disconnect();
    for (const card of this.cards.values()) card._events.abort();
    this.cards.clear(); this.previews.clear(); this.queue = [];
    this.menu?.remove(); this.easingPopover?.hidePopover(); this.root.remove();
  }
}
