/** Transient builder menus. Commands still bubble to the shared app dispatcher;
 * this controller only owns focus, placement, dismissal and expanded state. */
export function bindBuilderToolbar(bar, {signal}) {
  const triggers = [...bar.querySelectorAll('[popovertarget]')];
  const pairs = triggers.map(trigger => [trigger, bar.querySelector(`#${trigger.getAttribute('popovertarget')}`)]);
  const close = (panel, trigger, restore = false) => {
    if (panel.matches(':popover-open')) panel.hidePopover();
    trigger.setAttribute('aria-expanded', 'false');
    if (restore) trigger.focus({preventScroll: true});
  };
  const closeAll = () => { for (const [trigger, panel] of pairs) close(panel, trigger); };
  const items = panel => [...panel.querySelectorAll('button:not(:disabled)')];
  let focusLast = false, typed = '', typedAt = 0;
  for (const [trigger, panel] of pairs) {
    panel.addEventListener('beforetoggle', event => {
      const open = event.newState === 'open';
      trigger.setAttribute('aria-expanded', String(open));
      if (!open) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(264, innerWidth - 16);
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.maxHeight = `${Math.max(80, innerHeight - rect.bottom - 14)}px`;
    }, {signal});
    panel.addEventListener('toggle', () => {
      if (panel.matches(':popover-open')) {
        const buttons = items(panel);
        buttons[focusLast ? buttons.length - 1 : 0]?.focus({preventScroll: true});
        focusLast = false; typed = '';
      }
    }, {signal});
    trigger.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      focusLast = event.key === 'ArrowUp';
      panel.showPopover();
    }, {signal});
    panel.addEventListener('click', event => {
      const item = event.target.closest('button[data-action]');
      if (!item || item.disabled) return;
      if (item.getAttribute('role') !== 'menuitemcheckbox') close(panel, trigger, true);
    }, {signal});
  }
  // Capture before app hotkeys: menu navigation must never edit the document,
  // seek frames, or let Escape cancel the enclosing builder session.
  document.addEventListener('keydown', event => {
    const pair = pairs.find(([, panel]) => panel.matches(':popover-open'));
    if (!pair) return;
    const [trigger, panel] = pair;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close(panel, trigger, true); return;
    }
    if (!panel.contains(event.target)) return;
    if (event.key === 'Tab') { event.stopImmediatePropagation(); close(panel, trigger, true); return; }
    const buttons = items(panel), index = buttons.indexOf(document.activeElement);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopImmediatePropagation();
      buttons[index]?.dispatchEvent(new MouseEvent('click', {bubbles: true, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey}));
      return;
    }
    const next = {ArrowDown: (index + 1) % buttons.length, ArrowUp: (index + buttons.length - 1) % buttons.length,
      Home: 0, End: buttons.length - 1}[event.key];
    if (next !== undefined) {
      event.preventDefault(); event.stopImmediatePropagation(); buttons[next]?.focus({preventScroll: true});
      return;
    }
    if (['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) return;
    event.stopImmediatePropagation();
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = performance.now();
      typed = now - typedAt < 700 ? typed + event.key.toLowerCase() : event.key.toLowerCase(); typedAt = now;
      const match = buttons.find(button => button.textContent.trim().toLowerCase().startsWith(typed));
      match?.focus({preventScroll: true});
    }
  }, {signal, capture: true});
  window.addEventListener('resize', closeAll, {signal});
  signal.addEventListener('abort', closeAll, {once: true});
}
