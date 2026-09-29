/**
 * The Advanced timeline's grid under a finger (docs/TOUCH.md). With a mouse a
 * press on the grid selects cells or picks up keys at once; a finger needs to
 * scroll it first. So for touch:
 *
 *   swipe                  scrolls the grid (with momentum)
 *   tap                    selects the cell and goes to its frame
 *   double tap             a double-click: adds a key, or edits a key's easing
 *   press, hold, drag      the mouse's drag: selects frames, or moves the
 *                          selected keys (a buzz says the hold took)
 *   press and hold, lift   the cell's menu
 *   the ruler              scrubs at once, as with a mouse
 *   two fingers            pinch to zoom, move to scroll
 *   the names column       a vertical swipe scrolls the rows
 *
 * The grid's own handlers stay the one implementation: a tap or a hold sends
 * them the press they would have had from a mouse (an untrusted copy at the
 * same point, for the same pointer), and every later event of that finger
 * reaches them untouched. Only trusted touch events are intercepted, in the
 * capture phase on the grid; pens and mice keep today's behaviour.
 *
 * `host` is the timeline (layer-timeline.mjs): scroll, labelViewport,
 * pxPerTick, setZoom(), _offsetX(), _scrollToX(), _hit(), _cancelGesture().
 */
import {HOLD_MS, SLOP, beyondSlop, isDoubleTap} from './touch-gestures.mjs';
import {haptic, swallowNextClick} from './long-press.mjs';

const FRICTION = 0.94, MIN_SPEED = 0.02;

export function installTimelineTouch(host, {touch, signal, window: win = globalThis.window} = {}) {
  const grid = host.scroll, doc = grid.ownerDocument;
  const fingers = new Map();
  let press = null, pinch = null, lastTap = null, momentum = 0, syntheticDouble = -Infinity;

  const on = (target, type, fn, options = {}) => target.addEventListener(type, fn, {...options, signal});
  const ours = event => touch?.active && event.isTrusted && event.pointerType === 'touch';
  const take = event => { event.stopImmediatePropagation(); if (event.cancelable) event.preventDefault(); };
  const stopMomentum = () => { if (momentum) { win.cancelAnimationFrame(momentum); momentum = 0; } };
  const scrollBy = (dx, dy) => {
    if (dx) host._scrollToX(host._offsetX() + dx);
    if (dy) grid.scrollTop += dy;
  };
  /** A copy of `event` for the grid's own handlers: the mouse's left button at the finger. */
  const replay = (type, event, extra = {}) => {
    const init = {bubbles: true, cancelable: true, composed: true, view: win, clientX: event.clientX, clientY: event.clientY,
      screenX: event.screenX, screenY: event.screenY, pointerId: event.pointerId, pointerType: 'touch', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, ...extra};
    grid.dispatchEvent(type.startsWith('pointer') ? new win.PointerEvent(type, init) : new win.MouseEvent(type, init));
  };
  const clearPress = () => { if (press) clearTimeout(press.timer); press = null; };

  function glide(vx, vy) {
    stopMomentum();
    let last = win.performance.now();
    const step = now => {
      const dt = Math.min(48, now - last);
      last = now;
      scrollBy(vx * dt, vy * dt);
      vx *= FRICTION ** (dt / 16);
      vy *= FRICTION ** (dt / 16);
      momentum = Math.hypot(vx, vy) > MIN_SPEED ? win.requestAnimationFrame(step) : 0;
    };
    momentum = win.requestAnimationFrame(step);
  }

  on(grid, 'pointerdown', event => {
    if (!ours(event)) return;
    stopMomentum();
    fingers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (fingers.size === 2) {
      // A second finger: whatever the first began becomes a pinch.
      take(event);
      if (press?.mode === 'grid') host._cancelGesture?.();
      clearPress();
      const [a, b] = [...fingers.values()];
      const box = grid.getBoundingClientRect();
      pinch = {distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), zoom: host.pxPerTick, mid: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, left: box.left};
      return;
    }
    if (fingers.size > 2) { take(event); return; }
    // The ruler scrubs at once, as with a mouse.
    const hit = host._hit(event);
    if (hit.row < 0) return;
    take(event);
    press = {id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, mode: 'pending', event,
      samples: [{x: event.clientX, y: event.clientY, t: event.timeStamp}]};
    press.timer = setTimeout(() => {
      if (!press || press.mode !== 'pending') return;
      // The hold took: the grid gets the press a mouse would have given it.
      press.mode = 'grid';
      haptic(win);
      replay('pointerdown', press.event);
    }, HOLD_MS);
  }, {capture: true});

  on(grid, 'pointermove', event => {
    if (!ours(event)) return;
    if (fingers.has(event.pointerId)) fingers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (pinch) {
      take(event);
      if (fingers.size < 2) return;
      const [a, b] = [...fingers.values()];
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
      host.setZoom(pinch.zoom * distance / pinch.distance, mid.x - pinch.left);
      scrollBy(pinch.mid.x - mid.x, pinch.mid.y - mid.y);
      pinch.mid = mid;
      return;
    }
    if (press?.id !== event.pointerId) return;
    if (press.mode === 'grid') return;   // the grid's own drag
    take(event);
    if (press.mode === 'pending') {
      if (!beyondSlop(press, {x: event.clientX, y: event.clientY}, SLOP)) return;
      clearTimeout(press.timer);
      press.mode = 'pan';
      press.last = {x: event.clientX, y: event.clientY};
    }
    scrollBy(press.last.x - event.clientX, press.last.y - event.clientY);
    press.last = {x: event.clientX, y: event.clientY};
    press.samples.push({x: event.clientX, y: event.clientY, t: event.timeStamp});
    if (press.samples.length > 6) press.samples.shift();
  }, {capture: true});

  const lift = event => {
    if (!ours(event)) return;
    fingers.delete(event.pointerId);
    if (pinch) { take(event); if (!fingers.size) pinch = null; return; }
    if (press?.id !== event.pointerId) return;
    const current = press;
    clearPress();
    if (event.type === 'pointercancel') {
      if (current.mode === 'grid') return;   // the grid cancels its own gesture
      take(event);
      return;
    }
    if (current.mode === 'grid') {
      // A hold lifted where it began: the cell's menu (the grid has already had its press and release).
      if (!beyondSlop(current, {x: event.clientX, y: event.clientY}, SLOP)) {
        setTimeout(() => replay('contextmenu', event, {button: 2, buttons: 0}), 0);
        swallowNextClick(doc, {pointerId: event.pointerId});
      }
      return;
    }
    take(event);
    if (current.mode === 'pan') {
      const first = current.samples[0], last = current.samples.at(-1), dt = Math.max(1, last.t - first.t);
      if (event.timeStamp - last.t < 80) glide((first.x - last.x) / dt, (first.y - last.y) / dt);
      return;
    }
    // A tap: the grid's press and release at the finger; a second tap close by is a double-click.
    replay('pointerdown', current.event);
    replay('pointerup', event);
    const tap = {x: event.clientX, y: event.clientY, time: event.timeStamp};
    if (isDoubleTap(lastTap, tap)) {
      lastTap = null;
      syntheticDouble = win.performance.now();
      replay('dblclick', event, {detail: 2});
    } else lastTap = tap;
  };
  on(grid, 'pointerup', lift, {capture: true});
  on(grid, 'pointercancel', lift, {capture: true});
  // One double-click per double tap: the browser's own, when it sends one after ours, is dropped.
  on(grid, 'dblclick', event => {
    if (event.isTrusted && touch?.active && win.performance.now() - syntheticDouble < 450) event.stopImmediatePropagation();
  }, {capture: true});

  // The names column: a vertical swipe scrolls the rows; a tap stays a tap on the row's buttons.
  const labels = host.labelViewport;
  let rowPan = null;
  if (labels) {
    on(labels, 'pointerdown', event => {
      if (!ours(event) || event.target.closest('input')) return;
      stopMomentum();
      rowPan = {id: event.pointerId, y: event.clientY, x: event.clientX, top: grid.scrollTop, moved: false};
    }, {capture: true});
    on(labels, 'pointermove', event => {
      if (rowPan?.id !== event.pointerId) return;
      if (!rowPan.moved && !beyondSlop(rowPan, {x: event.clientX, y: event.clientY}, SLOP)) return;
      rowPan.moved = true;
      take(event);
      grid.scrollTop = rowPan.top + rowPan.y - event.clientY;
    }, {capture: true});
    const end = event => {
      if (rowPan?.id !== event.pointerId) return;
      if (rowPan.moved) { take(event); swallowNextClick(doc, {pointerId: event.pointerId}); }
      rowPan = null;
    };
    on(labels, 'pointerup', end, {capture: true});
    on(labels, 'pointercancel', end, {capture: true});
  }
  signal?.addEventListener('abort', () => { stopMomentum(); clearPress(); }, {once: true});

  return {
    /** The current gesture's mode for tests: 'pending', 'pan', 'grid', 'pinch' or null. */
    get mode() { return pinch ? 'pinch' : press?.mode ?? null; },
  };
}
