/**
 * The timeline's own words (timeline-header.mjs and the layer list's header in
 * layer-timeline.mjs), in English. Components ask the app's localization first
 * (sayTimeline) and fall back to these, so the timeline reads the same with or
 * without a catalog that knows the keys.
 */
const TEXT = Object.freeze({
  'timeline.header': 'Timeline',
  'timeline.mode': 'Timeline mode',
  'timeline.addFrame': 'Add frame',
  'timeline.addFrameName': 'Add Frame',
  'timeline.blankFrame': 'Blank frame',
  'timeline.drawingFrames': 'Drawing frames',
  'timeline.nextCopy': 'Next copy',
  'timeline.nextCopyName': 'Next copied drawing',
  'timeline.nextCopyTip': 'Next copied drawing: the next frame starts as a copy of this drawing',
  'timeline.nextCopyMore': 'More drawing frame commands',
  'timeline.nextBlank': 'Next blank drawing',
  'timeline.blankDrawingHere': 'Blank drawing here',
  'timeline.copyDrawingHere': 'Copy drawing here',
  'timeline.extend': 'Extend',
  'timeline.editTogether': 'Edit together',
  'timeline.editTogetherIdle': 'Edit together: select two or more frames first, then edits on the canvas change all of them',
  'timeline.editTogetherReady': 'Edit together: edits on the canvas change all {count} selected frames',
  'timeline.editTogetherReason': 'Select two or more frames first',
  'timeline.menu': 'Timeline menu',
  'timeline.sheet': 'Timeline…',
  'timeline.firstFrame': 'First frame',
  'timeline.loop': 'Loop playback',
  'timeline.audio': 'Audio',
  'timeline.onion': 'Onion skin',
  'timeline.lastFrame': 'Last frame',
  'timeline.previousKey': 'Previous key',
  'timeline.nextKey': 'Next key',
  'timeline.defaultHeight': 'Default height',
  'timeline.readoutTip': 'Frame {frame} of {total} · Go to frame',
  'timeline.goToFrame': 'Go to frame',
  'timeline.goToFrameField': 'Frame',
  'timeline.goToFrameOf': 'of {total} · {seconds} s',
  'timeline.goToFrameGo': 'Go',
  'timeline.layers': 'Layers',
  'timeline.findLayers': 'Find layers',
  'timeline.clearFind': 'Clear layer search',
  'timeline.newLayer': 'New layer',
  'timeline.newDrawingLayer': 'New drawing layer',
  'timeline.moreLayerTypes': 'More layer types',
  'timeline.focusLayers': 'Focus selected layers',
  'timeline.showAllLayers': 'Show all layers',
  'timeline.zoomTools': 'Timeline zoom',
  'timeline.fit': 'Fit timeline',
  'timeline.fitTip': 'Fit timeline: the whole animation in view',
  'timeline.fitFilmstrip': 'Fit every frame',
  'timeline.tall': 'Tall timeline: more rows, a smaller stage (double-click the splitter for the default height)',
});
export default TEXT;

const fill = (text, params) => text.replace(/\{([A-Za-z]\w*)\}/g, (token, name) => (Object.hasOwn(params, name) ? String(params[name]) : token));

/** The text for `key`: `t(key, params)` when it knows the key, else the English above. */
export function sayTimeline(t, key, params = {}) {
  if (typeof t === 'function') {
    try {
      const text = t(key, params);
      if (typeof text === 'string' && text && text !== key) return fill(text, params);
    } catch { /* a missing translation falls back to English */ }
  }
  return fill(TEXT[key] ?? key, params);
}
