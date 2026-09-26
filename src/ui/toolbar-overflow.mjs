/**
 * Priority-plus toolbars: controls that do not fit move into a "More" menu, so
 * nothing is ever cut off or lost. computeOverflow() is pure (measured widths
 * in, the split out); installToolbarOverflow() measures with a ResizeObserver
 * and hides or shows the items. Nothing here decides which controls exist: the
 * toolbar's markup and its data-overflow-* attributes do.
 *
 *   data-overflow-priority="n"  higher stays visible longer (default 0)
 *   data-overflow-pinned        never moves into the menu
 */

/**
 * items      [{width, priority = 0, pinned = false}] in visual order
 * available  the toolbar's inner width
 * gap        space between neighbouring items
 * moreWidth  the More button's width (it takes one more gap)
 *
 * Returns {visible, overflow, width, fits}: item indices in visual order, the
 * width the visible row takes, and whether it fits. The lowest priority goes
 * first; among equals, the last item in the row. Pinned items always stay.
 */
export function computeOverflow({items, available, gap = 0, moreWidth = 0}) {
  const count = items.length;
  const hidden = new Set();
  const used = () => {
    let width = 0, shown = 0;
    for (let index = 0; index < count; index++) if (!hidden.has(index)) { width += items[index].width; shown++; }
    width += Math.max(0, shown - 1) * gap;
    if (hidden.size) width += (shown ? gap : 0) + moreWidth;
    return width;
  };
  const order = items.map((item, index) => index).filter(index => !items[index].pinned)
    .sort((a, b) => (items[a].priority ?? 0) - (items[b].priority ?? 0) || b - a);
  for (const index of order) {
    if (used() <= available) break;
    hidden.add(index);
  }
  const all = items.map((item, index) => index);
  return {visible: all.filter(index => !hidden.has(index)), overflow: all.filter(index => hidden.has(index)), width: used(), fits: used() <= available};
}

/** Menu items for overflowed controls: each runs by clicking the original control, so its data-action path stays the one path. */
export function overflowMenuItems(elements) {
  return elements.map(element => {
    const pressed = element.getAttribute('aria-pressed');
    return {
      label: element.getAttribute('aria-label') || element.dataset.tooltip || element.textContent.trim(),
      disabled: element.disabled || element.getAttribute('aria-disabled') === 'true',
      ...(pressed === 'true' || pressed === 'false' ? {checked: pressed === 'true'} : {}),
      run: event => element.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, shiftKey: event?.shiftKey,
        ctrlKey: event?.ctrlKey, metaKey: event?.metaKey, altKey: event?.altKey})),
    };
  });
}

/**
 * Keeps `toolbar` (sized by its container, never by its content) inside its
 * width. `items()` returns the controls in visual order; `more` is the More
 * button, shown only while something overflows. onChange(overflowed) runs
 * after every change, for example to rebuild the More menu. Items hidden by
 * their owner (the `hidden` attribute set by someone else) are left alone.
 */
export function installToolbarOverflow(toolbar, {items, more, gap = null, signal, onChange = null,
  priority = element => Number(element.dataset.overflowPriority) || 0,
  pinned = element => element.hasAttribute('data-overflow-pinned'),
  Observer = globalThis.ResizeObserver} = {}) {
  const ours = new Set(), widths = new WeakMap();
  let overflowed = [], frame = 0;
  const measure = element => {
    if (!element.hidden) widths.set(element, element.getBoundingClientRect().width);
    return widths.get(element) ?? 0;
  };
  const update = () => {
    frame = 0;
    if (!toolbar.getClientRects().length) return;   // not rendered: nothing to measure
    const all = [...items()].filter(element => !element.hidden || ours.has(element));
    // Items we hid before their width was known (or after invalidate()) are measured once, visible.
    for (const element of all) if (ours.has(element) && !widths.has(element)) element.hidden = false;
    for (const element of all) measure(element);
    const style = toolbar.ownerDocument.defaultView?.getComputedStyle?.(toolbar);
    const spacing = gap ?? (Number.parseFloat(style?.columnGap) || 0);
    const padding = (Number.parseFloat(style?.paddingLeft) || 0) + (Number.parseFloat(style?.paddingRight) || 0);
    const available = toolbar.clientWidth - padding;
    const moreWidth = more ? (more.hidden ? widths.get(more) ?? 32 : measure(more)) : 0;
    const {overflow} = computeOverflow({items: all.map(element => ({width: widths.get(element) ?? 0, priority: priority(element), pinned: pinned(element)})),
      available, gap: spacing, moreWidth});
    const next = overflow.map(index => all[index]);
    for (const element of all) {
      const hide = next.includes(element);
      if (hide && !element.hidden) { element.hidden = true; ours.add(element); }
      else if (!hide && ours.has(element)) { element.hidden = false; ours.delete(element); }
    }
    if (more) more.hidden = next.length === 0;
    if (next.length !== overflowed.length || next.some((element, index) => element !== overflowed[index])) {
      overflowed = next;
      onChange?.(overflowed);
    }
  };
  const schedule = () => { frame ||= requestAnimationFrame(update); };
  const observer = Observer ? new Observer(schedule) : null;
  observer?.observe(toolbar);
  signal?.addEventListener('abort', () => {
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    for (const element of ours) element.hidden = false;
    ours.clear();
    if (more) more.hidden = true;
  }, {once: true});
  schedule();
  return {
    update,
    /** Forget measured widths, for example after the language changed the labels. */
    invalidate() { for (const element of items()) widths.delete(element); schedule(); },
    get overflowed() { return [...overflowed]; },
  };
}
