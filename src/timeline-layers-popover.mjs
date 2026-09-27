/**
 * The Simple timeline's Layers popover (experience.md §5.6, reference/42): the
 * frame bar's "Layer ● Bubble ▾" (#layers-button) opens it. It lists the
 * animation's layers top first, as the Advanced layer list does, each with its
 * colour dot, its name (a drawing layer adds a brush glyph), and its eye and
 * lock at rest (quiet glyphs, full contrast while hidden or locked). Clicking a
 * row makes that layer the one Simple edits (its figures are selected, as a row
 * click in Advanced does); the foot adds a layer or a drawing layer.
 *
 * The rows are rebuilt only while the popover is open, from editor changes that
 * touch layers; nothing here runs during playback.
 */
import {createPopover} from './ui/ui-popover.mjs';
import {icon} from './icons.mjs';
import {LAYER_COLORS} from './layers.mjs';
import {sayTimeline} from './locales/en-timeline.mjs';

const element = (tag, parent, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
};

/**
 * anchor: the frame bar's layer button; editor; run(fn): runs a command and reports its error;
 * overlays, t, topInset: as the other timeline popovers. Returns {toggle(), hide(), isOpen, destroy()}.
 */
export function createLayersPopover({anchor, editor, run, overlays = null, t = null, topInset = 0}) {
  const say = (key, params) => sayTimeline(t, key, params);
  const events = new AbortController();
  const list = element('div', null, 'tl-layers-list');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', say('layers.list'));
  const foot = element('div', null, 'tl-layers-foot');
  const footButton = (glyph, label, action) => {
    const button = element('button', foot, 'ui-button');
    button.type = 'button';
    button.dataset.size = 'sm';
    button.dataset.variant = 'ghost';
    button.innerHTML = `${glyph ? icon(glyph) : ''}<span class="ui-label">${label}</span>`;
    button.addEventListener('click', () => run(action), {signal: events.signal});
    return button;
  };
  footButton('plus', say('layers.newLayer'), () => editor.selectSheetLayer(editor.createLayer().id));
  footButton('brush', say('layers.drawingLayer'), () => editor.selectSheetLayer(editor.createDrawingLayer().id));

  let changes = null;
  const popover = createPopover({
    anchor, placement: 'top-start', title: say('layers.title'), closeLabel: say('layers.close'), body: list, foot,
    overlays, t, topInset, className: 'tl-layers-popover', icon: name => icon(name),
    onOpen() {
      changes = new AbortController();
      editor.addEventListener('change', event => {
        const detail = event.detail ?? {};
        if (detail.kind === 'document' || detail.layers || detail.layerSelection || detail.structural || detail.kind === 'history') render();
      }, {signal: changes.signal});
    },
    onClose() { changes?.abort(); changes = null; },
  });

  function iconButton(parent, glyph, label, on, action) {
    const button = element('button', parent, 'ui-icon-button');
    button.type = 'button';
    button.dataset.size = 'sm';
    button.dataset.on = String(on);
    button.innerHTML = icon(glyph);
    button.setAttribute('aria-label', label);
    button.dataset.tooltip = label;
    button.addEventListener('click', event => { event.stopPropagation(); run(action); });
    return button;
  }
  /** One row per content layer, top first; the active layer is current. */
  function render() {
    const active = editor.activeLayerId, focused = list.contains(document.activeElement) ? document.activeElement : null;
    const refocus = focused && {id: focused.closest('[data-layer-id]')?.dataset.layerId, index: [...focused.parentElement.children].indexOf(focused),
      pick: focused.matches('.tl-layers-pick')};
    const rows = editor.getLayers().filter(layer => layer.kind === 'layer').reverse().map(layer => {
      const row = element('div', null, 'ui-list-row tl-layers-row');
      row.setAttribute('role', 'listitem');
      row.dataset.layerId = layer.id;
      row.dataset.hidden = String(layer.visible === false);
      row.setAttribute('aria-current', String(layer.id === active));
      const pick = element('button', row, 'tl-layers-pick');
      pick.type = 'button';
      pick.setAttribute('aria-pressed', String(layer.id === active));
      pick.setAttribute('aria-description', say('layers.choose', {name: layer.name}));
      const dot = element('span', pick, 'ui-dot');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.setProperty('--dot', LAYER_COLORS[layer.color] ?? 'var(--sheet-layer)');
      element('span', pick, 'ui-list-row-label', layer.name);
      if (layer.drawing) pick.insertAdjacentHTML('beforeend', icon('brush', 'tl-layers-kind'));
      pick.addEventListener('click', () => run(() => editor.selectSheetLayer(layer.id)));
      const actions = element('span', row, 'ui-list-row-actions');
      const hidden = layer.visible === false;
      iconButton(actions, hidden ? 'eye-off' : 'eye', say(hidden ? 'layers.show' : 'layers.hide', {name: layer.name}), hidden,
        () => editor.setLayerVisible(layer.id, hidden));
      iconButton(actions, layer.locked ? 'lock' : 'unlock', say(layer.locked ? 'layers.unlock' : 'layers.lock', {name: layer.name}), Boolean(layer.locked),
        () => editor.setLayerLocked(layer.id, !layer.locked));
      return row;
    });
    list.replaceChildren(...rows);
    // A row rebuilt under the keyboard keeps the focus on the same control.
    if (refocus) {
      const row = list.querySelector(`[data-layer-id="${CSS.escape(refocus.id ?? '')}"]`);
      (refocus.pick ? row?.querySelector('.tl-layers-pick') : row?.querySelector('.ui-list-row-actions')?.children[refocus.index])?.focus({preventScroll: true});
    }
  }

  return {
    toggle() { if (!popover.isOpen) render(); popover.toggle(); },
    hide() { popover.hide('close'); },
    get isOpen() { return popover.isOpen; },
    destroy() { popover.hide('destroy'); changes?.abort(); events.abort(); popover.element.remove(); },
  };
}
