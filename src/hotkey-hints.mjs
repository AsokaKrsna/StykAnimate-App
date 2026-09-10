import { HOTKEY_BY_ID } from './hotkeys.mjs';

/** Derive hints from command IDs, never from a second list of bindings. */
export function refreshHotkeyHints(hotkeys, root = document) {
  for (const node of root.querySelectorAll('[data-action],[data-tool],[data-hotkey-command]')) {
    let id = node.dataset.hotkeyCommand || (node.id === 'play-button' ? 'play-pan' : node.dataset.tool ? `tool-${node.dataset.tool}` : node.dataset.action);
    if (id === 'delete-single-segment') id = 'delete';
    if (id === 'play' && !hotkeys.label('play')) id = 'play-pan';
    if (!HOTKEY_BY_ID.has(id)) continue;
    const label = hotkeys.label(id), kbd = node.querySelector('kbd');
    if (kbd) { kbd.textContent = label; continue; }
    if (!node.dataset.hotkeyTitle) node.dataset.hotkeyTitle = (node.title || node.getAttribute('aria-label') || HOTKEY_BY_ID.get(id).label).replace(/\s*(?:·.*|\([^)]*\))$/, '');
    node.title = node.dataset.hotkeyTitle + (label ? ` · ${label}` : '');
    node.dataset.hotkeyHint = label;
  }
}
