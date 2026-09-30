import {t as interfaceText} from './localization.mjs';
import {icon} from './icons.mjs';
import {openMenu} from './ui/ui-menu.mjs';

/**
 * The timelines' right-click and ⋯ menus (the Advanced sheet, Simple's cards, audio clips, effect clips) on the
 * shared menu kit (ui/ui-menu.mjs), so they look and work like every other menu: named groups, submenus, checks,
 * red rows for what removes something, type-ahead and the arrow keys.
 *
 * `groups` is a list of groups (separators between them); a group is a list of rows, false and null skipped:
 *   {label, symbol, shortcut, action, checked, danger, disabled}   a command (`action` runs through host._run)
 *   {heading: 'Frames'}                                             the group's name
 *   {label, symbol, submenu: groups}                                a family in a submenu
 * The menu opens at the pointer (or under `event.currentTarget` from a button), closes on a document change or a
 * scroll of the timeline, and gives the focus back to the timeline.
 */
export function showTimelineMenu(host, event, groups) {
  host.menuEvents?.abort();
  host.menu?.remove();
  const events = host.menuEvents = new AbortController();
  const focusTarget = host.scroll ?? host.strip ?? host.lanes ?? null;
  const items = toItems(host, groups);
  if (!items.some(item => item && (item.run || item.submenu))) { events.abort(); return; }
  const anchor = event?.currentTarget?.nodeType === 1 && !event.clientX && !event.clientY ? event.currentTarget : null;
  const menu = openMenu({
    items,
    ...(anchor ? {anchor} : {point: {x: event?.clientX ?? 0, y: event?.clientY ?? 0}}),
    overlays: host.overlays ?? null,
    icon: name => icon(name),
    label: interfaceText("timelineMenu.timeline"), labelKey: "timelineMenu.timeline",
    invoker: focusTarget ?? document.activeElement,
    onClose: () => {
      events.abort();
      if (host.menu === handle) host.menu = null;
    },
  });
  const handle = host.menu = {element: menu.element, remove: () => menu.close('api', {restore: false}), close: reason => menu.close(reason)};
  focusTarget?.addEventListener('scroll', () => handle.remove(), {signal: events.signal});
  host.editor?.addEventListener('change', () => handle.remove(), {signal: events.signal});
  return handle;
}

/** Groups of timeline rows → the kit's menu items (separators between groups, submenus converted). */
function toItems(host, groups) {
  const items = [];
  for (const group of (groups ?? []).map(rows => (rows ?? []).filter(Boolean)).filter(rows => rows.length)) {
    if (items.length) items.push(null);
    for (const row of group) {
      if (row.heading) { items.push({label: row.heading}); continue; }
      // A menu shows one key per row (the first binding); Settings lists them all.
      const item = {label: row.label, icon: row.symbol ?? row.icon ?? null, shortcut: String(row.shortcut || '').split(' / ')[0] || false,
        danger: Boolean(row.danger), disabled: Boolean(row.disabled), swatch: row.swatch};
      if (row.checked !== undefined) item.checked = Boolean(row.checked);
      if (row.submenu) item.submenu = toItems(host, row.submenu);
      else item.run = () => host._run(row.action);
      items.push(item);
    }
  }
  return items;
}
