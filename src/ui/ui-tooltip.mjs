/**
 * The one tooltip: an ink pill with a control's name and, as plain text after
 * a middle dot, its shortcut ("Undo · Ctrl+Z"). It shows after a delay, then
 * instantly while moving between neighbours; it is never interactive, never
 * covers its invoker and is one element for the whole window.
 *
 * The name comes from data-tooltip, then data-hotkey-title, then aria-label;
 * the shortcut from the provided `shortcut(element)` (the command registry),
 * else data-hotkey-hint. Accessible names never include the shortcut; the
 * tooltip is linked with aria-describedby only while it is shown. On devices
 * without hover (touch) it appears for keyboard focus only.
 */
import {placeFloating} from './anchor-position.mjs';

export const TOOLTIP_SELECTOR = '[data-tooltip], [data-hotkey-title], button[aria-label], [role="button"][aria-label], [role="tab"][aria-label]';

/** The text a tooltip shows for `element`, or null when it would add nothing. */
export function tooltipContent(element, {shortcut = null} = {}) {
  if (!element || element.dataset?.tooltip === '') return null;
  const label = (element.dataset?.tooltip || element.dataset?.hotkeyTitle || element.getAttribute?.('aria-label') || '').trim();
  const keys = String(shortcut?.(element) ?? element.dataset?.hotkeyHint ?? '').trim();
  if (!label && !keys) return null;
  // A visible label that already says the name, with no shortcut to add: no tooltip.
  if (!keys && label === (element.textContent ?? '').trim()) return null;
  return {label, shortcut: keys};
}

/** How long to wait before showing: `delay`, or 0 right after another tooltip hid (moving between neighbours). */
export function tooltipDelay({now, lastHiddenAt = -Infinity, delay = 500, skipDelay = 300}) {
  return now - lastHiddenAt < skipDelay ? 0 : delay;
}

/**
 * Delegated tooltips for everything under `root` that matches `selector`.
 * Returns {element, show(target), hide()}; `signal` removes the listeners and
 * the element.
 */
export function installTooltips(root = globalThis.document, {selector = TOOLTIP_SELECTOR, delay = 500, skipDelay = 300, shortcut = null,
  topInset = 0, signal, now = () => globalThis.performance?.now() ?? Date.now(), hoverless = null} = {}) {
  const doc = root.ownerDocument ?? root, view = doc.defaultView ?? globalThis;
  const element = doc.createElement('div');
  element.id = 'ui-tooltip';
  element.className = 'ui-tooltip';
  element.setAttribute('role', 'tooltip');
  element.popover = 'hint';
  if (element.popover !== 'hint') element.popover = 'manual';   // before popover="hint" (Chromium 133)
  doc.body.append(element);
  const noHover = hoverless ?? view.matchMedia?.('(hover: none)');
  let target = null, timer = 0, lastHiddenAt = -Infinity, describedBy = null;

  const unlink = () => {
    if (!target) return;
    if (describedBy === null) target.removeAttribute('aria-describedby'); else target.setAttribute('aria-describedby', describedBy);
    describedBy = null;
  };
  const hide = () => {
    clearTimeout(timer);
    timer = 0;
    if (!target) return;
    unlink();
    target = null;
    lastHiddenAt = now();
    try { if (element.matches(':popover-open')) element.hidePopover(); } catch { /* already hidden */ }
  };
  const show = next => {
    const text = tooltipContent(next, {shortcut});
    if (!text || !next.isConnected) { hide(); return; }
    if (target && target !== next) { unlink(); }
    target = next;
    element.replaceChildren(doc.createTextNode(text.label || text.shortcut));
    if (text.label && text.shortcut) {
      const key = doc.createElement('span');
      key.className = 'ui-tooltip-key';
      key.textContent = text.shortcut;
      element.append(doc.createTextNode('·'), key);
    }
    try { if (!element.matches(':popover-open')) element.showPopover(); } catch { return; }
    placeFloating(element, next, {placement: 'top', offset: 6, fit: false, overlap: false, topInset});
    describedBy = next.getAttribute('aria-describedby');
    next.setAttribute('aria-describedby', [describedBy, element.id].filter(Boolean).join(' '));
  };
  const schedule = next => {
    clearTimeout(timer);
    const wait = tooltipDelay({now: now(), lastHiddenAt: target ? now() : lastHiddenAt, delay, skipDelay});
    if (!wait) { show(next); return; }
    timer = setTimeout(() => show(next), wait);
  };
  const matching = node => node?.closest?.(selector) ?? null;

  root.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch' || noHover?.matches) return;
    const next = matching(event.target);
    if (!next || next === target) return;
    if (!tooltipContent(next, {shortcut})) { hide(); return; }
    schedule(next);
  }, {signal});
  root.addEventListener('pointerout', event => {
    const current = target ?? matching(event.target);
    if (current && !current.contains(event.relatedTarget)) {
      if (target) hide(); else { clearTimeout(timer); timer = 0; }
    }
  }, {signal});
  root.addEventListener('focusin', event => {
    const next = matching(event.target);
    if (!next || !next.matches?.(':focus-visible')) return;
    schedule(next);
  }, {signal});
  root.addEventListener('focusout', () => hide(), {signal});
  root.addEventListener('pointerdown', () => hide(), {capture: true, signal});
  root.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); }, {capture: true, signal});
  doc.addEventListener('scroll', () => hide(), {capture: true, signal});
  signal?.addEventListener('abort', () => { hide(); element.remove(); }, {once: true});
  return {element, show, hide};
}
