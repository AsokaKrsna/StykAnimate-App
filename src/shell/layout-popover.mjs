/**
 * The Layout popover (View › Layout…, Ctrl+Alt+L; experience §1.5–1.7):
 * the workspace's presets as small dock maps (its built-in presets, then the
 * ones saved in this workspace), one position select per panel (Properties;
 * VFX and Library; the timeline's width; the tools' side), Reset and Save as
 * preset…. A saved preset's card has a menu (right-click, Shift+F10 or the
 * Menu key): Rename…, Update and Delete.
 *
 * Every control runs the dock host's workspace API; the popover keeps no
 * layout state of its own and follows every solve while it is open, so a
 * tab dragged elsewhere, a key or another window's change shows at once.
 */
import {createPopover} from '../ui/ui-popover.mjs';
import {installRovingFocus} from '../ui/roving-focus.mjs';
import {presetArrangement, presetsFor} from './layout-schema.mjs';

const POSITION = Object.freeze({left: 'Left', right: 'Right', with: 'With Properties', float: 'Floating', hidden: 'Hidden'});
const SAVE_REASONS = Object.freeze({limit: '8 presets saved. Delete one first.', budget: 'Preset storage is full. Delete one first.'});
/** Each workspace's presets, its default first (experience §1.6). */
const ORDER = Object.freeze({animate: ['animate', 'timing', 'focus', 'review'], draw: ['draw', 'focus'], rig: ['build', 'build-timeline', 'focus']});

/** Where each panel sits, ignoring which tab is shown: two arrangements that place every panel alike look the same. */
function placement(arrangement) {
  if (!arrangement) return '';
  const panels = [...arrangement.panels].sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(record => [record.id, record.dock, record.side, record.order, record.group ?? 0]);
  return JSON.stringify([arrangement.rail, arrangement.bottomSpan, panels]);
}

/**
 * The dock map of an arrangement: a small grid of the stage (lighter), the
 * docked sides and the timeline row; folded regions are thin.
 */
function dockMap(doc, arrangement, {focus = false} = {}) {
  const map = doc.createElement('span');
  map.className = 'ui-dock-map';
  map.setAttribute('aria-hidden', 'true');
  const panels = arrangement?.panels ?? [];
  const state = side => {
    const records = panels.filter(record => record.side === side && record.id !== 'timeline');
    if (focus) return records.length ? 'strip' : null;
    if (records.some(record => record.dock === side)) return 'docked';
    return records.some(record => record.dock === 'strip') ? 'strip' : null;
  };
  const timeline = panels.find(record => record.id === 'timeline');
  const bottom = focus ? 'strip' : timeline?.dock === 'bottom' ? 'docked' : timeline?.dock === 'strip' ? 'strip' : null;
  const sides = {left: state('left'), right: state('right')};
  const size = value => (value === 'docked' ? '1fr' : '0.35fr');
  const columns = [];
  if (sides.left) columns.push(['left', size(sides.left)]);
  columns.push(['stage', '3fr']);
  if (sides.right) columns.push(['right', size(sides.right)]);
  const tall = arrangement?.tall;
  map.style.gridTemplateColumns = columns.map(([, value]) => value).join(' ');
  map.style.gridTemplateRows = bottom ? `3fr ${bottom === 'docked' ? (tall ? '2fr' : '1fr') : '0.4fr'}` : '1fr';
  const cell = (name, column, row, span = 1) => {
    const item = doc.createElement('i');
    if (name === 'stage') item.dataset.stage = '';
    if ((name === 'left' ? sides.left : name === 'right' ? sides.right : name === 'bottom' ? bottom : null) === 'strip') item.dataset.folded = '';
    item.style.gridArea = `${row} / ${column} / ${row + 1} / ${column + span}`;
    map.append(item);
  };
  columns.forEach(([name], index) => cell(name, index + 1, 1));
  if (bottom) {
    const full = arrangement?.bottomSpan !== 'stage';
    const stageColumn = columns.findIndex(([name]) => name === 'stage') + 1;
    cell('bottom', full ? 1 : stageColumn, 2, full ? columns.length : 1);
  }
  return map;
}

/**
 * `host` is the dock host; `openMenu(items, anchor)` shows a menu (the app's
 * command menu); `prompt(options)` asks for a name (the kit's prompt);
 * `anchor()` returns the element the popover opens under; `notify(text)`
 * tells a person why something did not happen; `isToggleKey(event)` says
 * whether a key is the Layout… shortcut, which closes the popover from
 * inside it (its typing never reaches the editor's shortcuts).
 */
export function createLayoutPopover({host, document: doc = globalThis.document, window: win = globalThis.window, overlays = null, icon = null, t = null, prompt, openMenu,
  anchor = () => null, notify = () => {}, isToggleKey = () => false, onError = error => globalThis.reportError?.(error)} = {}) {
  const workspace = host.workspace;
  const presets = doc.createElement('div');
  presets.className = 'shell-layout-presets';
  presets.setAttribute('role', 'radiogroup');
  presets.setAttribute('aria-label', 'Layout presets');
  const rows = doc.createElement('div');
  rows.className = 'shell-layout-rows';
  const note = doc.createElement('p');
  note.className = 'shell-layout-note';
  note.hidden = true;
  const body = doc.createDocumentFragment();
  body.append(presets, rows, note);

  const button = (label, variant, run) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.className = 'ui-button';
    element.dataset.variant = variant;
    element.dataset.size = 'sm';
    element.textContent = label;
    element.addEventListener('click', () => guard(run));
    return element;
  };
  const reset = button('Reset', 'ghost', () => workspace.resetWorkspace());
  reset.setAttribute('aria-label', 'Reset layout');
  const glyph = icon?.('reset');
  if (typeof glyph === 'string') reset.insertAdjacentHTML('afterbegin', glyph);
  const save = button('Save as preset…', 'outline', () => saveAs());
  const foot = doc.createDocumentFragment();
  const spacer = doc.createElement('span');
  spacer.className = 'shell-layout-spacer';
  foot.append(reset, spacer, save);

  // Under the band, not under the menu button inside it: the anchor's box reaches down to the band's bottom.
  const target = {getBoundingClientRect: () => {
    const box = (anchor() ?? doc.body).getBoundingClientRect(), edge = doc.querySelector('.titlebar')?.getBoundingClientRect().bottom ?? box.bottom;
    return new DOMRect(box.left, box.top, box.width, Math.max(box.bottom, edge) - box.top);
  }};
  const popover = createPopover({anchor: target, title: 'Layout', closeLabel: 'Close layout', body, foot, overlays, icon, t,
    // Typing belongs to the popover (a preset card's "h" never picks the Hand tool); it opens 6px under the band, as menus do.
    className: 'shell-layout', placement: 'bottom-start', keyboardScope: true, topInset: () => (doc.querySelector('.titlebar')?.getBoundingClientRect().bottom ?? 0) + 6,
    onOpen: () => { render(); (presets.querySelector('[aria-checked="true"]') ?? presets.firstElementChild)?.focus({preventScroll: true}); }, onClose: () => { unsubscribe?.(); unsubscribe = null; }, document: doc});
  popover.element.id = 'layout-popover';
  popover.element.addEventListener('keydown', event => {
    if (!event.defaultPrevented && isToggleKey(event)) { event.preventDefault(); popover.hide('toggle'); }
  });
  let unsubscribe = null;
  installRovingFocus(presets, {items: () => presets.querySelectorAll('[role="radio"]'), orientation: 'horizontal'});

  function guard(run) {
    try { return run(); } catch (error) { notify(error?.message ?? String(error)); }
    return undefined;
  }

  // -------------------------------------------------------------------
  // Presets

  const entry = () => workspace.layout.modes[host.mode];
  const savedPresets = () => workspace.layout.saved.filter(item => item.mode === host.mode);

  function presetCards() {
    const mode = host.mode, layout = workspace.layout, current = entry();
    const now = current.focus ? null : placement(current);
    const rank = id => { const index = (ORDER[mode] ?? []).indexOf(id); return index < 0 ? Infinity : index; };
    const cards = [...presetsFor(mode)].sort((a, b) => rank(a.id) - rank(b.id)).map(preset => {
      const arrangement = preset.id === 'focus' ? current.focus ?? current : presetArrangement(preset.id, mode, {layout});
      return {id: preset.id, title: preset.title, arrangement: preset.sizes ? {...arrangement, tall: true} : arrangement,
        focus: preset.id === 'focus', checked: preset.id === 'focus' ? Boolean(current.focus) : placement(arrangement) === now};
    });
    for (const item of savedPresets()) {
      const arrangement = presetArrangement(`user:${item.id}`, mode, {layout});
      cards.push({id: `user:${item.id}`, saved: item, title: item.name, arrangement, checked: placement(arrangement) === now});
    }
    return cards;
  }

  function renderPresets() {
    const cards = presetCards();
    const key = JSON.stringify(cards.map(card => [card.id, card.title, placement(card.arrangement), card.focus]));
    if (presets.dataset.key !== key) {
      presets.dataset.key = key;
      const focused = presets.contains(doc.activeElement) ? doc.activeElement.dataset.preset : null;
      presets.replaceChildren(...cards.map(card => {
        const choice = doc.createElement('button');
        choice.type = 'button';
        choice.className = 'ui-choice';
        choice.setAttribute('role', 'radio');
        choice.dataset.preset = card.id;
        const label = doc.createElement('span');
        label.className = 'ui-choice-label';
        label.textContent = card.title;
        choice.append(dockMap(doc, card.arrangement, {focus: card.focus}), label);
        if (card.saved) { choice.setAttribute('aria-haspopup', 'menu'); choice.title = card.title; }
        return choice;
      }));
      if (focused) presets.querySelector(`[data-preset="${CSS.escape(focused)}"]`)?.focus({preventScroll: true});
    }
    let tabbable = null;
    for (const card of cards) {
      const choice = presets.querySelector(`[data-preset="${CSS.escape(card.id)}"]`);
      choice.setAttribute('aria-checked', String(card.checked));
      if (card.checked && !tabbable) tabbable = choice;
    }
    // One tab stop: the checked card, else the first (roving focus moves it).
    const stop = presets.contains(doc.activeElement) ? doc.activeElement : tabbable ?? presets.firstElementChild;
    for (const choice of presets.children) choice.tabIndex = choice === stop ? 0 : -1;
  }

  presets.addEventListener('click', event => {
    const choice = event.target.closest?.('[data-preset]');
    if (!choice) return;
    const id = choice.dataset.preset;
    guard(() => (id === 'focus' ? workspace.focus() : workspace.setPreset(id)));
  });
  // After a card's menu closes, focus stays in the popover (on the shown preset when the card is gone).
  const refocus = () => win.setTimeout(() => {
    if (popover.isOpen && !popover.element.contains(doc.activeElement)) presets.querySelector('[tabindex="0"]')?.focus({preventScroll: true});
  }, 0);
  const savedMenu = (choice, at) => {
    const item = savedPresets().find(saved => `user:${saved.id}` === choice.dataset.preset);
    if (!item) return;
    openMenu([
      {label: 'Rename…', icon: 'file', run: () => renameSaved(item)},
      {label: 'Update', icon: 'save', run: () => { guard(() => workspace.updateLayout(item.id)); refocus(); }},
      null,
      {label: 'Delete', icon: 'trash', danger: true, run: () => { guard(() => workspace.deleteLayout(item.id)); refocus(); }},
    ], at ?? choice);
  };
  presets.addEventListener('contextmenu', event => {
    const choice = event.target.closest?.('[data-preset^="user:"]');
    if (!choice) return;
    event.preventDefault();
    savedMenu(choice, event.button === 0 && !event.clientX ? choice : {left: event.clientX, bottom: event.clientY, invoker: choice});
  });
  presets.addEventListener('keydown', event => {
    const choice = event.target.closest?.('[data-preset^="user:"]');
    if (!choice || !((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu')) return;
    event.preventDefault();
    event.stopPropagation();
    savedMenu(choice, choice);
  });

  async function renameSaved(item) {
    const name = await prompt({title: 'Rename preset', label: 'Name', value: item.name, confirmLabel: 'Rename', maxLength: 48,
      validate: value => (value.trim() ? null : 'Name the preset first.')});
    if (typeof name === 'string') guard(() => workspace.renameLayout(item.id, name));
  }

  async function saveAs() {
    const allowed = workspace.canSaveLayout();
    if (!allowed.ok) { notify(SAVE_REASONS[allowed.reason]); return; }
    popover.hide('replace');
    const name = await prompt({title: 'Save layout as preset', label: 'Name', placeholder: 'Fight setup', confirmLabel: 'Save preset', maxLength: 48,
      validate: value => (value.trim() ? null : 'Name the preset first.')});
    if (typeof name !== 'string') return;
    if (guard(() => workspace.saveLayout(name))) show();
  }

  // -------------------------------------------------------------------
  // Positions

  const selects = {};
  function selectRow(key, label, name, onChange) {
    const row = doc.createElement('div');
    row.className = 'ui-row';
    const caption = doc.createElement('span');
    caption.className = 'ui-row-label';
    caption.textContent = label;
    const wrap = doc.createElement('span');
    wrap.className = 'ui-select';
    wrap.dataset.size = 'sm';
    const select = doc.createElement('select');
    select.setAttribute('aria-label', name);
    select.dataset.layoutPosition = key;
    select.addEventListener('change', () => guard(() => onChange(select.value)));
    wrap.append(select);
    const chevron = icon?.('chevron-down');
    if (typeof chevron === 'string') wrap.insertAdjacentHTML('beforeend', chevron);
    row.append(caption, wrap);
    rows.append(row);
    selects[key] = {row, select};
  }
  const setOptions = (select, options, value) => {
    const key = options.map(([id, text]) => `${id}:${text}`).join('|');
    if (select.dataset.options !== key) {
      select.dataset.options = key;
      select.replaceChildren(...options.map(([id, text]) => new Option(text, id)));
    }
    if (select.value !== value) select.value = value;
  };
  const record = id => entry().panels.find(item => item.id === id);
  const propertiesSide = () => record('properties')?.side ?? 'right';
  const place = (id, value) => {
    if (value === 'hidden') return workspace.hide(id);
    if (value === 'float') return workspace.float(id);
    if (value === 'with') return workspace.dock(id, propertiesSide(), {tabInto: 'properties'});
    return workspace.dock(id, value);
  };
  selectRow('properties', 'Properties', 'Properties position', value => place('properties', value));
  selectRow('vfx', 'VFX', 'VFX position', value => place('vfx', value));
  selectRow('library', 'Library', 'Library position', value => place('library', value));
  selectRow('timeline', 'Timeline', 'Timeline width', value => workspace.setTimelineSpan(value));
  selectRow('rail', 'Tools', 'Tools side', value => workspace.setRail(value));

  function renderRows() {
    const current = entry();
    const can = (id, target) => host.canPlace(id, target);
    const properties = record('properties');
    const sideOf = item => (item?.dock === 'hidden' ? 'hidden' : item?.dock === 'float' ? 'float' : item?.side ?? 'right');
    setOptions(selects.properties.select, ['right', 'left', ...(can('properties', 'hidden') ? ['hidden'] : [])].map(id => [id, POSITION[id]]),
      sideOf(properties));
    for (const id of ['vfx', 'library']) {
      const item = record(id);
      const {row, select} = selects[id];
      row.hidden = !item || !can(id, 'right') && !can(id, 'left');
      if (row.hidden) continue;
      const other = propertiesSide() === 'right' ? 'left' : 'right';
      const options = ['with', other, ...(can(id, 'float') ? ['float'] : []), ...(can(id, 'hidden') ? ['hidden'] : [])];
      const where = sideOf(item);
      setOptions(select, options.map(value => [value, POSITION[value]]), where === propertiesSide() ? 'with' : where);
    }
    setOptions(selects.timeline.select, [['full', 'Full width'], ['stage', 'Under stage']], current.bottomSpan ?? 'full');
    setOptions(selects.rail.select, [['left', 'Left'], ['right', 'Right']], current.rail ?? 'left');
    const allowed = workspace.canSaveLayout();
    save.setAttribute('aria-disabled', String(!allowed.ok));
    note.hidden = allowed.ok;
    note.textContent = allowed.ok ? '' : SAVE_REASONS[allowed.reason];
    if (!allowed.ok) save.setAttribute('aria-describedby', note.id || (note.id = 'layout-popover-note'));
    else save.removeAttribute('aria-describedby');
  }

  function render() {
    renderPresets();
    renderRows();
    unsubscribe ??= host.onSolve(() => { if (popover.isOpen) { renderPresets(); renderRows(); } });
    popover.update();
  }

  function show() {
    // Built before it opens, so focus lands on the shown preset.
    renderPresets();
    renderRows();
    try { popover.show(); } catch (error) { onError(error); }
  }

  return {
    element: popover.element,
    show,
    hide: () => popover.hide('hide'),
    toggle: () => (popover.isOpen ? popover.hide('toggle') : show()),
    get isOpen() { return popover.isOpen; },
  };
}
