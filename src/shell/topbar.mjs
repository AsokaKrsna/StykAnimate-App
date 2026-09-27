/**
 * The top band's measurement for the layout solver (architecture §3.11.4).
 *
 * The band folds its labels and spacing in a fixed order (the solver's
 * BAND_FOLDS) before the menubar folds into the mark, and the menubar folds
 * only where even the last step does not fit (the minimal tier). Each step
 * is a token of the band's `data-band` attribute that the band's stylesheet
 * (styles/layout/topbar.css) turns into a fold; `menus` folds the menubar.
 *
 * measureBand() reads the band's max-content width with no step, then after
 * each step that makes it narrower (a step the band has no rule for, or one
 * that frees nothing, such as the window controls in a browser, is left
 * out), once with the menubar docked and once folded. It changes only the
 * band's own attribute and inline size and restores both before it returns,
 * so the page never paints a measuring state. The widths do not depend on
 * the window, so the band is measured again only when its content changes
 * (a name, the save state, a language, a session's buttons, the window
 * controls), never on a resize.
 */
import {BAND_FOLDS} from './layout-solver.mjs';

/** The band token that folds the menubar into the mark (the minimal tier). */
export const MENUBAR_FOLD = 'menus';

/**
 * The solver's `bandMin` from a width function: `width(tokens)` is the
 * band's width with those `data-band` tokens applied. Pure, so the fold
 * logic is testable without a DOM.
 */
export function collectBandWidths(width, steps = BAND_FOLDS) {
  const run = base => {
    const applied = [...base];
    const widths = {none: width(applied)};
    let last = widths.none;
    for (const step of steps) {
      const after = width([...applied, step]);
      if (!(after < last)) continue;
      applied.push(step);
      widths[step] = last = after;
    }
    return widths;
  };
  return {...run([]), minimal: run([MENUBAR_FOLD])};
}

/** Measures `band` (the `.titlebar`) for the solver; see the module comment. */
export function measureBand(band, {steps = BAND_FOLDS} = {}) {
  const live = band.getAttribute('data-band'), inline = band.style.inlineSize;
  const width = tokens => {
    if (tokens.length) band.setAttribute('data-band', tokens.join(' '));
    else band.removeAttribute('data-band');
    return Math.ceil(band.getBoundingClientRect().width);
  };
  band.style.inlineSize = 'max-content';
  try {
    return collectBandWidths(width, steps);
  } finally {
    band.style.inlineSize = inline;
    if (live === null) band.removeAttribute('data-band');
    else band.setAttribute('data-band', live);
  }
}

/** A cheap fingerprint of what can change the band's width: its text and which parts show. */
function signature(band) {
  let text = band.textContent;
  for (const element of band.querySelectorAll('*')) text += `|${element.hidden ? 1 : 0}${element.getAttribute('class') ?? ''}`;
  return text;
}

/**
 * Keeps the band's measurement current: `current` is the latest `bandMin`;
 * `onChange()` runs after a change that alters it. It measures again after
 * the band's text or parts change (once per frame at most, and only when
 * the fingerprint differs) and once the fonts have loaded.
 */
export function watchBand(band, {window: win = globalThis.window, document: doc = band.ownerDocument, onChange = () => {}} = {}) {
  let current = null, key = '', printed = '', frame = 0, stopped = false;
  const measure = () => {
    frame = 0;
    if (stopped || !band.isConnected) return;
    printed = signature(band);
    const next = measureBand(band);
    const nextKey = JSON.stringify(next);
    if (nextKey === key) return;
    const first = current === null;
    current = next;
    key = nextKey;
    if (!first) onChange(current);
  };
  const schedule = () => { if (!frame && !stopped) frame = win.requestAnimationFrame(measure); };
  const observer = new win.MutationObserver(() => { if (signature(band) !== printed) schedule(); });
  observer.observe(band, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class']});
  const fonts = doc.fonts;
  const refit = () => { printed = ''; schedule(); };
  fonts?.addEventListener?.('loadingdone', refit);
  fonts?.ready?.then(refit, () => {});
  measure();
  return {
    get current() { return current; },
    /** Measures now (a language or scale change the fingerprint cannot see). */
    refresh() { if (frame) win.cancelAnimationFrame(frame); measure(); },
    stop() {
      stopped = true;
      observer.disconnect();
      fonts?.removeEventListener?.('loadingdone', refit);
      if (frame) win.cancelAnimationFrame(frame);
    },
  };
}
