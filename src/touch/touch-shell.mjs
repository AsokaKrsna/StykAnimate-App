/**
 * The touch interface's own chrome (docs/TOUCH.md). The stylesheets
 * (layout/touch.css, features/touch.css) arrange the editor's regions for
 * each touch layout; this module adds what they cannot:
 *
 * - The tab bar of a phone held upright: the workspace switch and the band's
 *   Properties button move into it, under the thumb, and back into the band
 *   in every other layout. They are moved, never copied, so their handlers,
 *   state and names stay the one implementation (a comment marks each one's
 *   home in the band).
 * - The stage header's view toggles folded into its View menu on a phone
 *   (stage-head.mjs setViewMenu).
 * - The page's own pinch kept off the editor (Safari's `gesture*` events).
 *   Double-tap zoom, pull to refresh and the rubber band are CSS
 *   (touch-action, overscroll-behavior).
 *
 * installTouchShell({touch}) follows the touch mode's changes; `destroy()`
 * puts everything back.
 */

const TABBAR_ITEMS = Object.freeze(['.band-center > .workspace-switch', '.shell-sheet-button']);

/** Moves nodes into a host and back to where they were, marking each home with a comment. */
function createMover(doc) {
  const homes = new Map();
  return {
    move(node, host) {
      if (!node || node.parentNode === host) return;
      if (!homes.has(node)) {
        const mark = doc.createComment(' touch: moved to the tab bar ');
        node.before(mark);
        homes.set(node, mark);
      }
      host.append(node);
    },
    restore() {
      for (const [node, mark] of homes) {
        if (mark.isConnected) mark.replaceWith(node);
      }
      homes.clear();
    },
  };
}

export function installTouchShell({touch, stageHead = null, document: doc = globalThis.document, window: win = globalThis.window} = {}) {
  const app = doc.getElementById('app');
  const workspace = app?.querySelector('.workspace');
  const abort = new AbortController(), signal = abort.signal;
  const mover = createMover(doc);
  let tabbar = null;

  const ensureTabbar = () => {
    if (tabbar) return tabbar;
    tabbar = doc.createElement('nav');
    tabbar.className = 'touch-tabbar';
    tabbar.setAttribute('aria-label', 'Workspaces and panels');
    return tabbar;
  };

  function apply(state) {
    const layout = state?.active ? state.layout : null;
    // A phone's stage header has no room for the view toggles: they fold into its View menu.
    stageHead?.setViewMenu?.(Boolean(state?.active && state.form === 'phone'));
    if (layout === 'phone-portrait') {
      const bar = ensureTabbar();
      if (!bar.isConnected) workspace.after(bar);
      for (const selector of TABBAR_ITEMS) mover.move(app.querySelector(selector), bar);
    } else {
      mover.restore();
      tabbar?.remove();
    }
  }

  // Safari pinches the page with its own gesture events; the canvas has its own pinch (canvas-pinch.mjs).
  const blockPageGesture = event => { if (touch?.active) event.preventDefault(); };
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(type, blockPageGesture, {signal, passive: false});
  // A quick second tap never zooms the page: the stylesheet sets `touch-action: manipulation` on the chrome, which
  // every touch browser honours; cancelling the second touch here would also cancel its click.

  const stop = touch?.on?.(state => apply(state));
  apply(touch?.state);

  return {
    get tabbar() { return tabbar; },
    destroy() {
      abort.abort();
      stop?.();
      mover.restore();
      tabbar?.remove();
    },
  };
}
