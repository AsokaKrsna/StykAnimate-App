/** Wet ink: the part of a stroke the worker has not yet rasterized onto the
 * screen, drawn the moment input arrives on a low-latency (desynchronized)
 * canvas between the scene and the overlay. The worker's exact pixels replace
 * it segment by segment once they are presented, so the pen never waits for a
 * worker round trip or a frame. It is a preview only: nothing here reaches
 * document data, history or exports. */
export class WetInk {
  constructor(viewport, before) {
    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'drawing-wet-ink';
    canvas.setAttribute('aria-hidden', 'true');
    viewport.insertBefore(canvas, before);
    // desynchronized lets strokes reach the screen without waiting for the
    // compositor frame; browsers without it return an ordinary context.
    this.ctx = canvas.getContext('2d', {desynchronized: true}) ?? canvas.getContext('2d');
    this.box = null;
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.observer?.observe(viewport);
    this.resize();
  }
  resize() {
    const rect = this.canvas.parentElement?.getBoundingClientRect(), dpr = globalThis.devicePixelRatio || 1;
    if (!rect) return;
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; this.box = null; }
    this.dpr = dpr;
  }
  /** Draw polylines of {x, y, r} in viewport CSS pixels (r: radius). Opacity
   * and softness apply to the whole layer, so overlapping round segments never
   * darken where they meet. */
  draw(paths, {color, opacity = 1, blur = 0}) {
    const ctx = this.ctx, dpr = this.dpr;
    this.clearBox();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = ctx.fillStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const path of paths) {
      for (let i = 0; i < path.length; i++) {
        const p = path[i], q = path[i + 1] ?? null;
        x0 = Math.min(x0, p.x - p.r); y0 = Math.min(y0, p.y - p.r); x1 = Math.max(x1, p.x + p.r); y1 = Math.max(y1, p.y + p.r);
        if (!q) { if (path.length === 1) { ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(.5, p.r), 0, Math.PI * 2); ctx.fill(); } break; }
        ctx.lineWidth = Math.max(1, p.r + q.r);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
    const style = this.canvas.style, filter = blur > .3 ? `blur(${blur.toFixed(1)}px)` : '';
    if (style.opacity !== String(opacity)) style.opacity = String(opacity);
    if (style.filter !== filter) style.filter = filter;
    const pad = 2 + Math.ceil(blur * 3);
    this.box = x1 >= x0 ? {x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad} : null;
  }
  /** Erase only what the last draw touched. */
  clearBox() {
    const box = this.box, dpr = this.dpr;
    if (!box) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(Math.floor(box.x * dpr), Math.floor(box.y * dpr), Math.ceil(box.width * dpr) + 2, Math.ceil(box.height * dpr) + 2);
    this.box = null;
  }
  clear() { this.clearBox(); }
  dispose() { this.observer?.disconnect(); this.canvas.remove(); }
}
