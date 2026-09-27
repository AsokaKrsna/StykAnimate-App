/**
 * Tabs as the panels' handles (architecture §3.11.5, experience §1.5):
 *
 * - Drag a tab, a strip's icon or a floating panel's tab out of its place:
 *   past a 4px slop one calm drop target appears where the pointer is (a
 *   soft fill and a small label: Dock left, Dock right, Add as a tab, or
 *   Float here while Shift is held or the panel already floats). The tab
 *   follows the pointer and its origin dims; release docks it, Escape or a
 *   window blur cancels. There are no veils, tags or instructions.
 * - Right-click a tab or a strip icon (or Shift+F10 or the Menu key on it)
 *   for its menu: Dock left, Dock right, Float (VFX and Library), Fold to
 *   strip and Hide, as far as the panel may go there.
 *
 * Every change runs the dock host's workspace API, so a drag, the menu, the
 * Layout popover and Ctrl+Alt+M agree.
 */
const SLOP = 4;
const HANDLE = '.shell-tabs [role="tab"][data-panel], .shell-strip-button[data-panel]';
const LABELS = Object.freeze({left: 'Dock left', right: 'Dock right', tab: 'Add as a tab', float: 'Float here'});

const inside = (rect, x, y) => rect && rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
const box = (left, top, width, height) => ({left, top, width, height, right: left + width, bottom: top + height});

/**
 * `host` is the dock host; `openMenu(items, anchor, {label})` shows a menu
 * (anchor: an element, or {left, bottom, invoker} for a point) named
 * `label`; `announce(text)` speaks a short status.
 */
export function installDockTabs({host, document: doc = globalThis.document, window: win = globalThis.window, openMenu, announce = () => {}} = {}) {
  const workspaceElement = doc.querySelector('.workspace');
  const abort = new AbortController(), signal = abort.signal;
  const workspace = host.workspace;
  const title = id => host.registry.get(id)?.title ?? id;
  let press = null, drag = null, suppressClick = false;

  // -------------------------------------------------------------------
  // The tab menu

  /** The places a panel may go from where it is, as menu items. */
  function menuItems(id) {
    const presentation = host.presentation(id), side = host.solution?.panels[id]?.side;
    const docked = presentation === 'docked' || presentation === 'sheet';
    const items = [];
    for (const target of ['left', 'right']) {
      if (host.canPlace(id, target) && !(docked && side === target))
        items.push({label: LABELS[target], icon: target === 'left' ? 'panel-left' : 'panel-right', run: () => move(id, target)});
    }
    if (host.canPlace(id, 'float') && presentation !== 'float') items.push({label: 'Float', icon: 'layout', run: () => move(id, 'float')});
    if (presentation === 'strip') items.push({label: 'Show', icon: 'maximize', run: () => host.showPanel(id)});
    else if (host.canPlace(id, 'strip')) items.push({label: 'Fold to strip', icon: 'minimize', run: () => move(id, 'strip')});
    if (host.canPlace(id, 'hidden')) items.push(null, {label: 'Hide', icon: 'eye-off', run: () => move(id, 'hidden')});
    return items;
  }

  function move(id, target, options = {}) {
    if (target === 'float') workspace.float(id, options.rect);
    else if (target === 'strip') workspace.fold(id);
    else if (target === 'hidden') workspace.hide(id);
    else workspace.dock(id, target, options);
    announce(`${title(id)}: ${target === 'strip' ? 'folded' : target === 'hidden' ? 'hidden' : target === 'float' ? 'floating' : LABELS[target] ?? target}`);
    if (target !== 'strip' && target !== 'hidden') host.showPanel(id, {focus: false});
  }

  /**
   * Opens a tab's (or strip icon's) menu at a point under it, with the handle
   * as its invoker: the menu never writes its own aria-expanded or
   * aria-controls onto a tab (whose aria-controls names its panel) or a strip
   * icon (whose aria-expanded is its sheet's).
   */
  function showMenu(handle, at) {
    const id = handle.dataset.panel;
    if (!host.registry.has(id)) return;
    const box = handle.getBoundingClientRect();
    const point = at && at.nodeType !== 1 ? at : {left: box.left, bottom: box.bottom, invoker: handle};
    openMenu(menuItems(id), point, {label: `${title(id)} panel`});
  }

  workspaceElement.addEventListener('contextmenu', event => {
    const handle = event.target.closest?.(HANDLE);
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    const keyboard = !event.clientX && !event.clientY;
    showMenu(handle, keyboard ? null : {left: event.clientX, bottom: event.clientY, invoker: handle});
  }, {signal});
  workspaceElement.addEventListener('keydown', event => {
    const handle = event.target.closest?.(HANDLE);
    if (!handle || !((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu')) return;
    event.preventDefault();
    event.stopPropagation();
    showMenu(handle);
  }, {signal, capture: true});

  // -------------------------------------------------------------------
  // Drag to dock

  const zone = doc.createElement('div');
  zone.className = 'ui-drop-zone shell-drag-zone';
  zone.hidden = true;
  const zoneLabel = doc.createElement('span');
  zoneLabel.className = 'ui-drop-label';
  zone.append(zoneLabel);
  const ghost = doc.createElement('div');
  ghost.className = 'shell-drag-ghost';
  ghost.hidden = true;
  ghost.setAttribute('aria-hidden', 'true');

  /** The docked island (not a sheet, not floating) of a side under the pointer's tab row. */
  function islandAt(x, y) {
    for (const island of workspaceElement.querySelectorAll('.shell-dock > .shell-island:not(.shell-sheet)')) {
      if (island.hidden || !island.getClientRects().length) continue;
      const rect = island.getBoundingClientRect();
      if (!inside(rect, x, y)) continue;
      const tabs = island.querySelector(':scope > .shell-tabs');
      const head = tabs && !tabs.hidden ? tabs.getBoundingClientRect() : box(rect.left, rect.top, rect.width, 40);
      return {island, rect, inHead: y <= head.bottom, side: island.closest('.shell-dock')?.dataset.region};
    }
    return null;
  }

  /** The one place a release at (x, y) puts the panel, with the rect its target shows. */
  function targetAt(x, y, shift) {
    const id = drag.id;
    const {hosts, stage} = host.regions();
    const stageRect = stage.getBoundingClientRect();
    const floating = host.presentation(id) === 'float';
    const floatable = host.canPlace(id, 'float');
    const island = islandAt(x, y);
    if (island && !shift) {
      const panels = (island.island.dataset.panels ?? '').split(' ').filter(Boolean);
      if (island.inHead && !panels.includes(id) && host.canPlace(id, island.side))
        return {kind: 'tab', side: island.side, tabInto: panels[0], rect: island.rect};
      if (host.canPlace(id, island.side) && !(panels.includes(id) && panels.length === 1))
        return {kind: island.side, rect: hosts[island.side].getBoundingClientRect()};
      return null;
    }
    if ((shift || floating) && floatable && inside(stageRect, x, y)) {
      const descriptor = host.registry.get(id);
      const width = Math.min(descriptor?.pref ?? 288, stageRect.width - 16), height = Math.min(520, stageRect.height - 56);
      const left = Math.min(Math.max(x - width / 2, stageRect.left + 8), stageRect.right - width - 8);
      const top = Math.min(Math.max(y - 20, stageRect.top + 48), stageRect.bottom - height - 8);
      return {kind: 'float', rect: box(left, top, width, height), stage: stageRect};
    }
    const edge = Math.min(160, stageRect.width * 0.25);
    for (const side of ['left', 'right']) {
      const dock = hosts[side];
      const dockRect = dock && !dock.hidden && dock.getClientRects().length ? dock.getBoundingClientRect() : null;
      const nearStage = inside(stageRect, x, y) && (side === 'left' ? x <= stageRect.left + edge : x >= stageRect.right - edge);
      if (!(inside(dockRect, x, y) || nearStage) || !host.canPlace(id, side)) continue;
      const width = Math.min(side === 'left' ? 232 : 288, stageRect.width * 0.4);
      const rect = dockRect && dockRect.width > 40 ? dockRect
        : box(side === 'left' ? stageRect.left : stageRect.right - width, stageRect.top, width, stageRect.height);
      return {kind: side, rect};
    }
    return null;
  }

  function showTarget(target) {
    drag.target = target;
    if (!target) { zone.hidden = true; return; }
    // Under the dragged tab's pill, which stays on top.
    if (zone.parentElement !== doc.body) doc.body.insertBefore(zone, ghost.parentElement === doc.body ? ghost : null);
    Object.assign(zone.style, {left: `${Math.round(target.rect.left)}px`, top: `${Math.round(target.rect.top)}px`,
      width: `${Math.round(target.rect.width)}px`, height: `${Math.round(target.rect.height)}px`});
    zone.dataset.target = target.kind;
    if (zoneLabel.textContent !== LABELS[target.kind]) { zoneLabel.textContent = LABELS[target.kind]; announce(LABELS[target.kind]); }
    zone.hidden = false;
  }

  function begin(event) {
    const {handle, id, pointerId} = press;
    drag = {handle, id, pointerId, target: null, shift: event.shiftKey};
    press = null;
    try { handle.setPointerCapture(pointerId); } catch { /* the pointer is gone */ }
    handle.dataset.dragging = 'true';
    ghost.textContent = title(id);
    if (ghost.parentElement !== doc.body) doc.body.append(ghost);
    ghost.hidden = false;
    follow(event);
    win.addEventListener('keydown', onKey, {capture: true, signal});
  }

  function follow(event) {
    ghost.style.translate = `${Math.round(event.clientX + 12)}px ${Math.round(event.clientY + 12)}px`;
    drag.x = event.clientX;
    drag.y = event.clientY;
    showTarget(targetAt(event.clientX, event.clientY, event.shiftKey || drag.shift));
  }

  function end(commit) {
    if (!drag) return;
    const {handle, id, pointerId, target} = drag;
    drag = null;
    delete handle.dataset.dragging;
    zone.hidden = true;
    ghost.hidden = true;
    win.removeEventListener('keydown', onKey, {capture: true});
    try { if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId); } catch { /* released */ }
    suppressClick = true;
    win.setTimeout(() => { suppressClick = false; }, 0);
    if (!commit || !target) { if (!commit) announce('Move cancelled'); return; }
    if (target.kind === 'float') {
      const {rect, stage} = target;
      move(id, 'float', {rect: {x: Math.round(rect.left - stage.left), y: Math.round(rect.top - stage.top), w: Math.round(rect.width), h: Math.round(rect.height)}});
    } else if (target.kind === 'tab') move(id, target.side, {tabInto: target.tabInto});
    else move(id, target.kind);
  }

  function onKey(event) {
    if (!drag) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); end(false); return; }
    if (event.key === 'Shift') { drag.shift = true; showTarget(targetAt(drag.x, drag.y, true)); }
  }

  workspaceElement.addEventListener('pointerdown', event => {
    const handle = event.target.closest?.(HANDLE);
    if (!handle || event.button !== 0 || drag || !host.registry.has(handle.dataset.panel)) return;
    press = {handle, id: handle.dataset.panel, pointerId: event.pointerId, x: event.clientX, y: event.clientY};
  }, {signal});
  win.addEventListener('pointermove', event => {
    if (drag?.pointerId === event.pointerId) { follow(event); return; }
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= SLOP) begin(event);
  }, {signal});
  win.addEventListener('pointerup', event => {
    if (drag?.pointerId === event.pointerId) end(true);
    if (press?.pointerId === event.pointerId) press = null;
  }, {signal});
  win.addEventListener('pointercancel', () => { press = null; end(false); }, {signal});
  win.addEventListener('blur', () => { press = null; end(false); }, {signal});
  win.addEventListener('keyup', event => {
    if (drag && event.key === 'Shift') { drag.shift = false; showTarget(targetAt(drag.x, drag.y, false)); }
  }, {signal});
  // The click that ends a drag is not a tab press.
  workspaceElement.addEventListener('click', event => {
    if (suppressClick && event.target.closest?.(HANDLE)) { event.stopImmediatePropagation(); event.preventDefault(); }
  }, {signal, capture: true});

  return {
    menuItems,
    showMenu,
    get dragging() { return drag ? {id: drag.id, target: drag.target?.kind ?? null} : null; },
    destroy() { end(false); abort.abort(); zone.remove(); ghost.remove(); },
  };
}
