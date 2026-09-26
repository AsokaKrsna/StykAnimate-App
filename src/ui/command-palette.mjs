/**
 * The command palette: type to find any command (or anything a feature
 * provides: figures, layers, tutorials, settings) and run it with Enter. It is
 * an index of the registry, never a home of its own. Keyboard first: a
 * combobox with a listbox driven by aria-activedescendant. It opens as a
 * manual [popover] in the top layer (non-modal), registered as a palette, so
 * the editor's hotkeys stay off while it is open.
 *
 * paletteGroups() is the pure part: the rows for a query. Recent commands come
 * first when the query is empty; typing a number offers "Go to frame N".
 */
import {showPopoverFrom} from './overlay-manager.mjs';

/** Metadata for the action that opens the palette; the app registers it with commands.define(). */
export const PALETTE_COMMAND = Object.freeze({id: 'command-palette', label: 'Search commands…', icon: 'search', category: 'app',
  keywords: Object.freeze(['command palette', 'find', 'run']), palette: false});

/**
 * The palette's groups for `query`: [{id, label, rows}] where a row is
 * {key, id, label, icon, meta, enabled, reason, ranges, run}. Providers are
 * {id, label, search(query, context) => rows}; `frameJump(n)` enables
 * "Go to frame N" for numeric queries.
 */
export function paletteGroups({commands, query = '', context, providers = [], frameJump = null, limit = 60, recentLabel = 'Recent',
  commandsLabel = 'Commands'} = {}) {
  const text = String(query).trim(), groups = [];
  if (frameJump && /^\d{1,6}$/.test(text)) {
    const frame = Number(text);
    groups.push({id: 'goto', label: 'Go to', rows: [{key: `frame:${frame}`, id: null, label: `Go to frame ${frame}`, icon: 'frame', meta: '', enabled: true,
      reason: '', ranges: [], run: () => frameJump(frame)}]});
  }
  const toRow = command => ({key: `command:${command.id}`, id: command.id, label: command.label, icon: command.icon,
    meta: command.enabled ? command.shortcut : command.reason, enabled: command.enabled, reason: command.reason, ranges: command.match?.ranges ?? [], run: null});
  if (!text) {
    const recent = commands.recent().map(id => commands.get(id, context)).filter(command => command.palette && !command.hidden);
    if (recent.length) groups.push({id: 'recent', label: recentLabel, rows: recent.map(toRow)});
    const seen = new Set(recent.map(command => command.id));
    groups.push({id: 'commands', label: commandsLabel, rows: commands.list({context, limit: limit + seen.size}).filter(command => !seen.has(command.id)).slice(0, limit).map(toRow)});
  } else {
    const rows = commands.list({query: text, context, limit}).map(toRow);
    if (rows.length) groups.push({id: 'commands', label: commandsLabel, rows});
  }
  for (const provider of providers) {
    let found = [];
    try { found = text ? provider.search(text, context) ?? [] : []; } catch (error) { globalThis.reportError?.(error); }
    if (found.length) groups.push({id: provider.id, label: provider.label, rows: found.slice(0, limit).map((row, index) => ({key: `${provider.id}:${row.id ?? index}`,
      id: row.id ?? null, label: row.label, icon: row.icon ?? null, meta: row.meta ?? '', enabled: row.enabled !== false && !row.disabled,
      reason: row.reason ?? '', ranges: row.ranges ?? [], run: row.run}))});
  }
  return groups.filter(group => group.rows.length);
}

let paletteCount = 0;

/**
 * createCommandPalette({commands, overlays, providers, frameJump, icon,
 * context, topInset, placeholder, label, document})
 * Returns {element, open({invoker}), close(), toggle(), isOpen, addProvider, removeProvider, refresh}.
 */
export function createCommandPalette({commands, overlays = null, providers = [], frameJump = null, icon = null, context = null, topInset = 0,
  placeholder = 'Search commands', label = 'Command palette', emptyLabel = 'No results', document: doc = globalThis.document} = {}) {
  const id = `ui-palette-${++paletteCount}`;
  const element = doc.createElement('div');
  element.id = id;
  element.className = 'ui-palette';
  element.popover = 'manual';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'false');
  element.setAttribute('aria-label', label);
  const search = doc.createElement('div');
  search.className = 'ui-palette-search';
  const glyph = icon?.('search');
  if (typeof glyph === 'string') search.insertAdjacentHTML('beforeend', glyph); else if (glyph) search.append(glyph);
  search.firstElementChild?.classList.add('ui-icon');
  const input = doc.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', placeholder);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', `${id}-list`);
  search.append(input);
  const list = doc.createElement('div');
  list.className = 'ui-palette-list';
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label);
  element.append(search, list);

  const sources = [...providers];
  let open = false, rows = [], active = -1, controller = null, handle = null, invoker = null;
  const currentContext = () => { try { return context?.(); } catch { return undefined; } };

  const highlight = (target, text, ranges) => {
    const characters = Array.from(text);
    let at = 0;
    for (const [start, end] of ranges) {
      if (start > at) target.append(doc.createTextNode(characters.slice(at, start).join('')));
      const mark = doc.createElement('mark');
      mark.textContent = characters.slice(start, end).join('');
      target.append(mark);
      at = end;
    }
    if (at < characters.length) target.append(doc.createTextNode(characters.slice(at).join('')));
  };

  function render() {
    const groups = paletteGroups({commands, query: input.value, context: currentContext(), providers: sources, frameJump});
    rows = [];
    list.replaceChildren();
    groups.forEach((group, groupIndex) => {
      const section = doc.createElement('div'), heading = doc.createElement('div');
      section.setAttribute('role', 'group');
      heading.className = 'ui-palette-group';
      heading.id = `${id}-group-${groupIndex}`;
      heading.textContent = group.label;
      section.setAttribute('aria-labelledby', heading.id);
      section.append(heading);
      for (const row of group.rows) {
        const option = doc.createElement('div');
        option.className = 'ui-palette-row';
        option.id = `${id}-option-${rows.length}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        if (!row.enabled) option.setAttribute('aria-disabled', 'true');
        if (row.id) option.dataset.command = row.id;
        const rowGlyph = row.icon && icon?.(row.icon);
        if (typeof rowGlyph === 'string') option.insertAdjacentHTML('beforeend', rowGlyph); else if (rowGlyph) option.append(rowGlyph);
        option.firstElementChild?.classList.add('ui-icon');
        if (!rowGlyph) { const pad = doc.createElement('i'); pad.className = 'ui-palette-pad'; pad.setAttribute('aria-hidden', 'true'); option.append(pad); }
        const name = doc.createElement('span');
        name.className = 'ui-palette-label';
        highlight(name, row.label, row.ranges);
        option.append(name);
        if (row.meta) {
          const meta = doc.createElement(row.enabled && row.id && row.meta === commands.shortcut?.(row.id) ? 'kbd' : 'span');
          meta.className = 'ui-palette-meta';
          meta.textContent = row.meta;
          option.append(meta);
        }
        const index = rows.length;
        option.addEventListener('pointermove', () => { if (active !== index) setActive(index, false); });
        option.addEventListener('click', () => { setActive(index, false); runActive(); });
        rows.push({...row, option});
        section.append(option);
      }
      list.append(section);
    });
    if (!rows.length) {
      const empty = doc.createElement('div');
      empty.className = 'ui-palette-empty';
      empty.textContent = emptyLabel;
      list.append(empty);
    }
    setActive(rows.length ? 0 : -1);
  }

  function setActive(index, scroll = true) {
    rows[active]?.option.setAttribute('aria-selected', 'false');
    active = index;
    const row = rows[active];
    if (!row) { input.removeAttribute('aria-activedescendant'); return; }
    row.option.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', row.option.id);
    if (scroll) row.option.scrollIntoView?.({block: 'nearest'});
  }

  function runActive() {
    const row = rows[active];
    if (!row || !row.enabled) return;
    close({restore: true});
    if (row.run) row.run();
    else commands.run(row.id, {source: 'palette'});
  }

  function onKeydown(event) {
    event.stopPropagation();
    if (event.isComposing) return;
    const count = rows.length;
    const move = {ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8}[event.key];
    if (move !== undefined) {
      event.preventDefault();
      if (count) setActive(Math.min(count - 1, Math.max(0, (active < 0 ? (move > 0 ? -1 : count) : active) + move)));
    } else if (event.key === 'Enter') { event.preventDefault(); runActive(); }
    else if (event.key === 'Escape') { event.preventDefault(); close({restore: true}); }
    else if (event.key === 'Tab') event.preventDefault();
  }

  function show({invoker: from = doc.activeElement} = {}) {
    if (open) { input.select(); return; }
    invoker = from;
    if (element.parentElement !== doc.body) doc.body.append(element);
    const view = doc.defaultView ?? globalThis;
    const inset = typeof topInset === 'function' ? topInset() : topInset;
    element.style.setProperty('--palette-top', `${Math.round(Math.max(inset + 8, view.innerHeight * 0.12))}px`);
    showPopoverFrom(element, null);
    open = true;
    controller = new AbortController();
    const {signal} = controller;
    input.addEventListener('input', render, {signal});
    element.addEventListener('keydown', onKeydown, {signal});
    doc.addEventListener('pointerdown', event => { if (!element.contains(event.target)) close({restore: false}); }, {capture: true, signal});
    view.addEventListener('blur', () => close({restore: false}), {signal});
    handle = overlays?.register(element, {kind: 'palette', keyboardScope: true, invoker, returnFocus: false, closeOnEscape: false,
      onClose: () => close({restore: false})}) ?? null;
    input.value = '';
    render();
    input.focus({preventScroll: true});
  }

  function close({restore = true} = {}) {
    if (!open) return;
    open = false;
    controller.abort();
    try { if (element.matches(':popover-open')) element.hidePopover(); } catch { /* already hidden */ }
    handle?.close(undefined, 'close');
    handle = null;
    const target = [invoker, overlays?.fallbackFocus?.()].find(node => node?.isConnected && typeof node.focus === 'function');
    if (restore || doc.activeElement === doc.body || !doc.activeElement) target?.focus({preventScroll: true});
  }

  return {
    element, input,
    open: show, close,
    toggle(options) { if (open) close(); else show(options); },
    refresh() { if (open) render(); },
    addProvider(provider) { sources.push(provider); },
    removeProvider(provider) { const index = sources.indexOf(provider); if (index >= 0) sources.splice(index, 1); },
    get isOpen() { return open; },
  };
}
