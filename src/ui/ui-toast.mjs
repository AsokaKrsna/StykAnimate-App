/**
 * Messages: the stage's one message slot. A toast is a short white pill with
 * an optional action (Undo, Restore, Show) and a dismiss button when it
 * persists; a task toast shows progress and can be cancelled.
 *
 * One message is visible at a time. Priority decides which: error, recovery,
 * update, toast, then the first-run hint; a higher one takes the slot at once
 * and a persistent one it displaces waits. At most `max` wait; identical
 * messages are merged. Timeouts pause while the pointer or focus is on the
 * message. The host is a manual [popover] in the top layer, re-raised whenever
 * a modal opens, so a message is never hidden under a dialog (it is inert
 * while the modal is open). createMessageQueue() is the pure part.
 */
import {UserActionError} from '../user-action-error.mjs';

export const MESSAGE_PRIORITY = Object.freeze({hint: 0, toast: 1, update: 2, recovery: 3, error: 4});

/**
 * The slot's queue. push(message) returns {show, displaced, duplicate,
 * dropped}; next() moves the best waiting message into the slot. Messages are
 * {id, key, slot, persistent}: `key` identifies duplicates, `slot` is a
 * MESSAGE_PRIORITY name, persistent messages survive being displaced.
 */
export function createMessageQueue({max = 3} = {}) {
  let current = null;
  const waiting = [];
  const rank = message => MESSAGE_PRIORITY[message.slot] ?? MESSAGE_PRIORITY.toast;
  const insert = message => {
    const index = waiting.findIndex(other => rank(other) < rank(message));
    waiting.splice(index < 0 ? waiting.length : index, 0, message);
    // Over the limit, the lowest-priority, newest waiting message goes.
    return waiting.length > max ? waiting.pop() : null;
  };
  return {
    push(message) {
      const duplicate = [current, ...waiting].find(other => other && other.key === message.key);
      if (duplicate) return {show: null, displaced: null, duplicate, dropped: null};
      if (!current) { current = message; return {show: message, displaced: null, duplicate: null, dropped: null}; }
      if (rank(message) > rank(current)) {
        const displaced = current;
        current = message;
        const dropped = displaced.persistent ? insert(displaced) : displaced;
        return {show: message, displaced, duplicate: null, dropped};
      }
      return {show: null, displaced: null, duplicate: null, dropped: insert(message)};
    },
    /** Ends `id` (the current message or a waiting one); returns the message that now shows, if it changed. */
    remove(id) {
      const index = waiting.findIndex(message => message.id === id);
      if (index >= 0) { waiting.splice(index, 1); return null; }
      if (current?.id !== id) return null;
      current = waiting.shift() ?? null;
      return current;
    },
    get current() { return current; },
    get waiting() { return [...waiting]; },
  };
}

const TIMEOUTS = Object.freeze({info: 4000, success: 4000, warning: 6000, error: 0});
let toastCount = 0;

/**
 * createToasts({host, overlays, icon, area, document})
 *   host      the element that holds the message (the #toast compatibility
 *             host); created when absent
 *   overlays  the OverlayManager: the host re-raises above every modal it opens
 *   icon      (name) => SVG string or Node, for the dismiss and tone glyphs
 *   area      () => DOMRect of the stage: the message sits bottom-centre in it
 *   feedback  {label, run(error)}: the extra action on unexpected errors (desktop)
 * Returns {host, show(options), task(options), fail(error), dismiss(id), clear(), raise()}.
 */
export function createToasts({host = null, overlays = null, icon = null, area = null, feedback = null, max = 3,
  document: doc = host?.ownerDocument ?? globalThis.document, setTimer = setTimeout, clearTimer = clearTimeout,
  now = () => globalThis.performance?.now() ?? Date.now()} = {}) {
  const element = host ?? doc.createElement('div');
  if (!host) doc.body.append(element);
  element.classList.add('ui-toast-host');
  if (!element.hasAttribute('popover')) element.popover = 'manual';
  element.setAttribute('aria-live', 'polite');
  const queue = createMessageQueue({max});
  const records = new Map();
  let visible = null;

  const glyph = (parent, name, className) => {
    const value = icon?.(name);
    if (!value) return;
    if (typeof value === 'string') { parent.insertAdjacentHTML('beforeend', value); parent.lastElementChild?.classList.add(...className.split(' ')); }
    else { value.classList?.add(...className.split(' ')); parent.append(value); }
  };
  const place = () => {
    const rect = area?.(), view = doc.defaultView ?? globalThis;
    if (!rect) { element.style.removeProperty('--toast-x'); element.style.removeProperty('--toast-bottom'); return; }
    element.style.setProperty('--toast-x', `${Math.round(rect.left + rect.width / 2)}px`);
    element.style.setProperty('--toast-bottom', `${Math.round(view.innerHeight - rect.bottom + 8)}px`);
  };
  const openHost = () => {
    element.removeAttribute('hidden');
    place();
    try { if (!element.matches(':popover-open')) element.showPopover(); } catch { /* not connected */ }
  };
  const closeHost = () => {
    try { if (element.matches(':popover-open')) element.hidePopover(); } catch { /* already hidden */ }
    element.setAttribute('hidden', '');
    element.replaceChildren();
  };
  /** Moves the host to the top of the top layer (after a modal opened). */
  const raise = () => {
    if (!element.matches?.(':popover-open')) return;
    element.hidePopover();
    element.showPopover();
  };
  overlays?.addEventListener('open', event => { if (event.detail.modal || event.detail.kind === 'dialog') raise(); });

  // The verb or subject in bold, then the rest: "<b>Restore unsaved work</b> from 12:04?"
  const writeText = (node, title, message) => {
    node.replaceChildren();
    if (title) { const strong = doc.createElement('b'); strong.textContent = title; node.append(strong); }
    if (message) node.append(doc.createTextNode(title ? ` ${message}` : message));
  };
  const render = record => {
    const node = doc.createElement('div');
    node.className = 'ui-toast';
    node.setAttribute('role', record.tone === 'error' ? 'alert' : 'status');
    if (record.tone === 'success') node.dataset.tone = 'success';
    if (record.tone === 'error') node.dataset.tone = 'danger';
    if (record.tone === 'warning') node.dataset.tone = 'warning';
    if (record.task) node.dataset.variant = 'task';
    if (record.slot === 'hint') { const dot = doc.createElement('span'); dot.className = 'ui-toast-dot'; node.append(dot); }
    else if (record.icon) glyph(node, record.icon, 'ui-icon ui-toast-icon');
    const text = doc.createElement('span');
    text.className = 'ui-toast-text';
    writeText(text, record.title, record.message);
    node.append(text);
    if (record.task) {
      const bar = doc.createElement('div');
      bar.className = 'ui-toast-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', record.title || record.message);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      node.append(bar);
      record.bar = bar;
      paintProgress(record);
    }
    for (const action of record.actions) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ui-button ui-toast-action';
      button.dataset.variant = action.variant ?? 'ghost';
      button.dataset.size = 'sm';
      if (action.command) button.dataset.action = action.command;
      button.textContent = action.label;
      button.addEventListener('click', event => {
        if (!action.command) event.stopPropagation();
        try { action.run?.(event); } finally { if (action.dismiss !== false) dismiss(record.id); }
      });
      node.append(button);
    }
    if (record.dismissible) {
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = 'ui-icon-button ui-toast-close';
      close.dataset.size = 'sm';
      close.setAttribute('aria-label', record.dismissLabel);
      glyph(close, 'close', 'ui-icon');
      if (!close.firstChild) close.textContent = '×';
      close.addEventListener('click', event => { event.stopPropagation(); dismiss(record.id); });
      node.append(close);
    }
    // Hover and focus pause the timeout; leaving resumes it with the time left.
    const pause = () => { if (record.timer) { clearTimer(record.timer); record.timer = 0; record.remaining = Math.max(0, record.deadline - now()); } };
    const resume = () => { if (!record.timer && record.remaining > 0 && !node.matches(':hover') && !node.contains(doc.activeElement)) arm(record, record.remaining); };
    node.addEventListener('pointerenter', pause);
    node.addEventListener('focusin', pause);
    node.addEventListener('pointerleave', resume);
    node.addEventListener('focusout', () => setTimer(resume, 0));
    record.node = node;
    return node;
  };
  const arm = (record, ms) => {
    clearTimer(record.timer);
    record.timer = 0;
    if (!(ms > 0)) return;
    record.deadline = now() + ms;
    record.remaining = ms;
    record.timer = setTimer(() => dismiss(record.id), ms);
  };
  const present = record => {
    if (visible && visible !== record) { clearTimer(visible.timer); visible.timer = 0; visible.remaining = Math.max(0, (visible.deadline ?? 0) - now()); }
    visible = record;
    element.replaceChildren(render(record));
    openHost();
    arm(record, record.remaining ?? record.timeout);
  };
  const dismiss = id => {
    const record = records.get(id);
    if (!record) return;
    records.delete(id);
    clearTimer(record.timer);
    record.onDismiss?.();
    const next = queue.remove(id);
    if (visible === record) {
      visible = null;
      if (next) present(records.get(next.id)); else closeHost();
    }
  };

  function show({message = '', title = '', tone = 'info', slot = null, action = null, actions = null, timeout = null, dismissible = null,
    icon: iconName = null, key = null, dismissLabel = 'Dismiss', onDismiss = null, task = false} = {}) {
    const list = actions ?? (action ? [action] : []);
    const record = {
      id: `toast-${++toastCount}`, message: String(message), title: String(title), tone, task, actions: list, onDismiss, dismissLabel,
      slot: slot ?? (tone === 'error' ? 'error' : 'toast'),
      // Errors and tasks stay until dismissed or done; an action earns a message more time to be read.
      timeout: timeout ?? (task || tone === 'error' ? 0 : Math.max(list.length ? 8000 : 0, TIMEOUTS[tone] ?? 4000)),
      icon: iconName ?? (tone === 'success' ? 'check' : null),
      progress: null, timer: 0, remaining: null,
    };
    record.key = key ?? `${tone}|${record.title}|${record.message}`;
    record.dismissible = dismissible ?? (record.timeout === 0 && !task);
    record.persistent = record.timeout === 0;
    const outcome = queue.push(record);
    if (outcome.duplicate) {
      const existing = records.get(outcome.duplicate.id) ?? outcome.duplicate;
      if (existing === visible) arm(existing, existing.timeout);   // the same message again: show it for longer
      return handleFor(existing);
    }
    records.set(record.id, record);
    if (outcome.dropped) { records.delete(outcome.dropped.id); outcome.dropped.onDismiss?.(); }
    if (outcome.show) present(record);
    return handleFor(record);
  }

  function handleFor(record) {
    return {
      id: record.id,
      dismiss: () => dismiss(record.id),
      get visible() { return visible === record; },
    };
  }

  function paintProgress(record) {
    const bar = record.bar;
    if (!bar) return;
    if (record.progress === null) { bar.dataset.indeterminate = ''; bar.removeAttribute('aria-valuenow'); bar.style.removeProperty('--_p'); return; }
    delete bar.dataset.indeterminate;
    const percent = Math.round(Math.min(1, Math.max(0, record.progress)) * 100);
    bar.setAttribute('aria-valuenow', String(percent));
    bar.style.setProperty('--_p', `${percent}%`);
  }

  /**
   * A task message that appears only if the work is still running after
   * `delay` ms. Returns {signal, progress(0..1 | null), update({title, meta}),
   * done({message, tone}), fail(error), cancel()}; `signal` aborts on cancel.
   * `confirmCancel()` may return false (or a promise of it) to keep going.
   */
  function task({title = '', meta = '', cancellable = true, cancelLabel = 'Cancel', confirmCancel = null, onCancel = null, signal = null, delay = 150} = {}) {
    const controller = new AbortController();
    let record = null, progress = null, finished = false, text = {title, meta};
    const cancel = async () => {
      if (finished) return;
      if (confirmCancel && (await confirmCancel()) === false) return;
      if (finished) return;
      finished = true;
      clearTimer(timer);
      if (record) dismiss(record.id);
      controller.abort(new DOMException('Cancelled', 'AbortError'));
      onCancel?.();
    };
    const timer = setTimer(() => {
      if (finished) return;
      const handle = show({title: text.title, message: text.meta, task: true, key: `task-${++toastCount}`,
        actions: cancellable ? [{label: cancelLabel, run: () => { cancel(); }, dismiss: false}] : []});
      record = records.get(handle.id);
      if (record) { record.progress = progress; paintProgress(record); }
    }, delay);
    signal?.addEventListener('abort', () => { finished = true; clearTimer(timer); if (record) dismiss(record.id); }, {once: true, signal: controller.signal});
    const end = () => {
      finished = true;
      clearTimer(timer);
      if (record) dismiss(record.id);
    };
    return {
      signal: controller.signal,
      progress(value) {
        progress = value === null || value === undefined ? null : Number(value);
        if (record) { record.progress = progress; paintProgress(record); }
      },
      update({title: nextTitle = text.title, meta: nextMeta = text.meta} = {}) {
        text = {title: nextTitle, meta: nextMeta};
        const node = record?.node?.querySelector('.ui-toast-text');
        if (node) writeText(node, nextTitle, nextMeta);
      },
      done({message = '', tone = 'success', ...rest} = {}) { if (finished) return; end(); if (message) show({message, tone, ...rest}); },
      fail(error) { if (finished) return; end(); fail(error); },
      cancel,
    };
  }

  /** Shows an error the way the app reports failures: aborts are silent, user preconditions are warnings. */
  function fail(error, options = {}) {
    if (error?.name === 'AbortError') return null;
    const message = error?.message || String(error);
    if (error instanceof UserActionError) return show({message, tone: 'warning', ...options});
    const actions = feedback ? [{label: feedback.label, run: () => feedback.run(error), variant: 'ghost'}] : [];
    return show({message, tone: 'error', actions, ...options});
  }

  return {
    host: element, show, task, fail, raise, dismiss,
    clear() { for (const id of [...records.keys()]) dismiss(id); },
    get current() { return visible ? handleFor(visible) : null; },
  };
}
