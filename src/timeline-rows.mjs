/**
 * The Advanced sheet's row geometry (experience.md §1.9 and §5.7, revision
 * 4.3), shared by the painters and hit tests of layer-timeline.mjs,
 * vfx-clip-timeline.mjs, camera-motion-timeline.mjs, timeline-organization.mjs
 * and the integrated audio lanes (audio-timeline.mjs). The shell sizes the
 * default timeline from the same numbers (shell/layout-solver.mjs
 * SHELL_METRICS: a 32px ruler, 24 at the short height tier; two 24px pinned
 * rows; 32px content rows, 28 at the short tier).
 *
 * Under the ruler come the system rows, the rows before the first content
 * layer: Camera and Scene at 24px, and the Camera's motion lanes and the
 * Scene's effect lanes at the row height. The content rows below them share
 * one height, so a content row's top is arithmetic. The system rows are
 * pinned under the ruler (the content rows scroll beneath them) while they
 * take at most half of the grid's height or leave room for three content
 * rows; a taller block (many camera motions playing at once in a short
 * timeline) scrolls with the content, so every row stays reachable.
 */
export const ROW = 32, HEADER = 32, SYSTEM_ROW = 24, SHORT_ROW = 28, SHORT_HEADER = 24;
/** The touch interface's rows (docs/TOUCH.md): a fingertip's height for every lane, a ruler a thumb can scrub. */
export const TOUCH_ROW = 48, TOUCH_HEADER = 44, TOUCH_SYSTEM_ROW = 44;

/** The short height tier (shell/dock-host.mjs writes data-height on the root). */
export function shortSheet(doc = globalThis.document) {
  const height = doc?.documentElement?.dataset?.height;
  return height === 'short' || height === 'low';
}

/**
 * The layout of `tracks` (the sheet's rows, in order) for a grid `viewport` px tall. Returns
 * {header, row, count, system, systemHeight, pinned, contentTop, height, top(i), size(i), at(y)}:
 * `top(i)` is row i's top below the ruler in the sheet's scrolled space and `size(i)` its height;
 * `contentTop` is where the scrolling rows start on screen (below the pinned block, if any);
 * `at(y)` is the row at y below the ruler in that space (-1 above it, `count` or more below the rows).
 * `touch`: the touch interface's rows (TOUCH_ROW, TOUCH_HEADER, TOUCH_SYSTEM_ROW), whatever the height tier.
 */
export function sheetRowLayout(tracks = [], {short = false, viewport = Infinity, touch = false} = {}) {
  const header = touch ? TOUCH_HEADER : short ? SHORT_HEADER : HEADER, row = touch ? TOUCH_ROW : short ? SHORT_ROW : ROW, tops = [], sizes = [];
  const systemRow = touch ? TOUCH_SYSTEM_ROW : SYSTEM_ROW;
  let system = 0, systemHeight = 0;
  while (system < tracks.length && !['layer', 'folder'].includes(tracks[system].kind)) {
    const size = tracks[system].kind === 'camera' || tracks[system].kind === 'scene' ? systemRow : row;
    tops.push(systemHeight); sizes.push(size); systemHeight += size; system++;
  }
  const count = tracks.length, room = Math.max(0, viewport - header), pinned = system > 0 && systemHeight <= Math.max(room / 2, room - 3 * row);
  return {
    header, row, count, system, systemHeight, pinned,
    contentTop: header + (pinned ? systemHeight : 0),
    height: systemHeight + (count - system) * row,
    top: index => (index < system ? tops[index] : systemHeight + (index - system) * row),
    size: index => (index < system ? sizes[index] : row),
    at(y) {
      if (y < 0) return -1;
      if (y >= systemHeight) return system + Math.floor((y - systemHeight) / row);
      let index = system - 1;
      while (index > 0 && tops[index] > y) index--;
      return index;
    },
  };
}
