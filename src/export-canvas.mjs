/** A lost 2D context may accept no-op draws; never encode those as valid frames. */
const lostCanvases = new WeakSet(), watched = new WeakSet();
export function checkExportContext(context) {
  if (!context || lostCanvases.has(context.canvas) || context.isContextLost?.()) {
    const error = new Error('The export canvas became unavailable. Export stopped before saving an incomplete frame. Try a smaller export size.');
    error.code = 'export_canvas_lost'; throw error;
  }
  return context;
}
export function exportContext(canvas) {
  if (!watched.has(canvas)) {
    watched.add(canvas);
    canvas.addEventListener?.('contextlost', () => lostCanvases.add(canvas));
  }
  return checkExportContext(canvas.getContext('2d', {willReadFrequently: true}));
}
