import {previewMemoryPlan} from './playback-budget.mjs';
import {assetURL} from './playback-resources.mjs';
import {drawingMetadata} from './drawing-model.mjs';
/** One serial worker per image owner. Originals stay in the document; Map values
 * are disposable CanvasImageSources with original logical dimensions. */
export class PreviewImages extends Map {
  constructor({maxBytes = previewMemoryPlan().editorImages, onReady = () => {}, onError = () => {}, idleMs = 120000, managedInvalidation = false, priorityURLs = () => []} = {}) {
    super(); Object.assign(this, {maxBytes, onReady, onError, managedInvalidation, priorityURLs});
    this.sequence = 0; this.bytes = 0; this.waiters = new Map();
    this.pendingImages = new Map();
    this.identities = new Map(); this.idleMs = idleMs; this.idleTimer = null;
  }
  clear() {
    clearTimeout(this.idleTimer); this.idleTimer = null;
    this.worker?.terminate(); this.worker = null; this.busy = false; this.queued = null; this.signature = null;
    const error = new DOMException('Preview images were invalidated.', 'AbortError');
    for (const pending of this.waiters.values()) pending.reject(error);
    this.waiters.clear();
    for (const pending of this.pendingImages.values()) pending.reject(error);
    this.pendingImages.clear();
    for (const bitmap of this.values()) bitmap.close?.();
    super.clear(); this.bytes = 0; this.identities.clear(); this.current = null;
  }
  set(url, bitmap) {
    const old = super.get(url);
    if (old !== bitmap) old?.close?.();
    super.set(url, bitmap);
    this.bytes = [...this.values()].reduce((sum, item) => sum + (item.complete ? item.width * item.height * 4 : 0), 0);
    return this;
  }
  prepare(items, options = {}, {retain = false} = {}) {
    // v2 drawing cels render from their tile store through resources.drawing;
    // the 1×1 carrier PNG is never a decode target.
    const images = items.filter(item => item.type === 'image' && item.asset && drawingMetadata(item.fig)?.version !== 2);
    // Lazy background consumers wait for a particular URL. Keep those requests
    // in the coalesced batch until their pixels arrive, even when the viewport
    // replaces an unrelated queued preparation.
    const urls = new Set(images.map(item => assetURL(item.asset)));
    for (const url of this.pendingImages.keys()) if (!urls.has(url)) images.push({type:'image',asset:{url}});
    if (!images.length && !this.size && !this.busy) return Promise.resolve();
    const signature = JSON.stringify([images.map(item => {
      const url = assetURL(item.asset);
      if (!this.identities.has(url)) this.identities.set(url, this.identities.size + 1);
      const length = item.start && item.end && item.asset.anchor_length ? Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y) / item.asset.anchor_length : 1;
      return [this.identities.get(url), item.asset.display_width, item.asset.display_height, 2 ** Math.ceil(Math.log2(length || 1))];
    }), options, retain]);
    if (signature === this.signature) return this.current || Promise.resolve();
    this.signature = signature;
    const id = ++this.sequence;
    this.current = new Promise((resolve, reject) => this.waiters.set(id, {resolve, reject, retain}));
    // Lazy image consumers observe completion events rather than promises.
    this.current.catch(() => {});
    if (this.queued) {this.waiters.get(this.queued.id)?.resolve(); this.waiters.delete(this.queued.id);}
    this.queued = {id, items: images, options, baseURL: globalThis.location?.href, maxBytes: this.maxBytes / 2};
    this.drain(); return this.current;
  }
  drain() {
    if (this.busy || !this.queued) return;
    clearTimeout(this.idleTimer); this.idleTimer = null;
    if (!this.worker) {
      const worker = this.worker = new Worker(new URL('./preview-image-worker.mjs', import.meta.url), {type: 'module', name: 'StykAnimate preview images'});
      worker.onmessage = ({data}) => {
        if (this.worker !== worker) {for (const image of data.images || []) image.bitmap.close(); return;}
        this.busy = false;
        const pending = this.waiters.get(data.id); this.waiters.delete(data.id);
        if (data.error) {
          this.signature = null; const error = new Error(data.error); pending?.reject(error);
          this.rejectPendingImages(error); this.onError(error);
        }
        else {
          const keep = new Set(data.images.map(image => image.url)); let resized = false;
          if (!pending?.retain) for (const [url, bitmap] of this) if (!keep.has(url) && !this.pendingImages.has(url)) {bitmap.close?.(); super.delete(url);}
          for (const {url, bitmap, width, height, srcX, srcY, srcW, srcH} of data.images) {
            const previous = super.get(url);
            resized ||= Boolean(previous?.complete && (previous.width !== bitmap.width || previous.height !== bitmap.height ||
              previous.srcX !== srcX || previous.srcY !== srcY || previous.srcW !== srcW || previous.srcH !== srcH));
            bitmap.complete = true; bitmap.naturalWidth = width; bitmap.naturalHeight = height;
            if (srcW !== undefined) {bitmap.srcX = srcX; bitmap.srcY = srcY; bitmap.srcW = srcW; bitmap.srcH = srcH;}
            this.set(url, bitmap); previous?.dispatchEvent?.(new Event('load'));
            this.pendingImages.get(url)?.resolve(); this.pendingImages.delete(url);
          }
          this.bytes = [...this.values()].reduce((sum, item) => sum + (item.complete ? item.width * item.height * 4 : 0), 0);
          // Lazy lookahead adds only missing URLs. Retain recent decoded pixels
          // within the main-thread half of the image budget, without repeatedly
          // asking the worker to resize every previously visited background.
          if (pending?.retain) for (const url of this.priorityURLs()) if (super.has(url)) {
            const bitmap=super.get(url);super.delete(url);super.set(url,bitmap);
          }
          if (pending?.retain) for (const [url, bitmap] of this) {
            if (this.bytes <= this.maxBytes / 2) break;
            if (keep.has(url) || this.pendingImages.has(url)) continue;
            this.bytes -= bitmap.width * bitmap.height * 4; bitmap.close?.(); super.delete(url);
          }
          this.reduced = data.reduced; pending?.resolve(); this.onReady({retained:Boolean(pending?.retain),resized});
        }
        this.drain(); this._scheduleIdle();
      };
      worker.onerror = event => {
        if (this.worker !== worker) return;
        event.preventDefault(); const error = new Error(event.message || 'Preview image worker stopped.');
        for (const pending of this.waiters.values()) pending.reject(error);
        this.rejectPendingImages(error);
        this.waiters.clear(); worker.terminate(); this.worker = null; this.busy = false; this.signature = null; this.onError(error);
      };
    }
    const request = this.queued; this.queued = null; this.busy = true; this.worker.postMessage(request);
  }
  _scheduleIdle() {
    clearTimeout(this.idleTimer); this.idleTimer = null;
    if (!this.worker || this.busy || this.queued || this.idleMs <= 0) return;
    // Decoded bitmaps live in this Map; the worker is a disposable decoder that
    // respawns on the next prepare instead of idling in memory forever.
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.worker && !this.busy && !this.queued) { this.worker.terminate(); this.worker = null; }
    }, this.idleMs);
    this.idleTimer.unref?.();
  }
  image(url) {
    if (!url) return null;
    if (this.has(url)) {
      const image = this.get(url); super.delete(url); super.set(url, image); return image;
    }
    const pending = new EventTarget(); pending.complete = false;
    pending.previewInvalidationManaged = this.managedInvalidation;
    const decoded = new Promise((resolve,reject) => this.pendingImages.set(url,{resolve,reject}));
    decoded.catch(() => {}); pending.decode = () => decoded;
    super.set(url, pending);
    const items = [...this.pendingImages.keys()].map(url => ({type: 'image', asset: {url}}));
    void this.prepare(items, {maxDimension: 2048}, {retain:true});
    return pending;
  }
  rejectPendingImages(error) {
    for (const [url,pending] of this.pendingImages) {
      pending.reject(error); if (!super.get(url)?.complete) super.delete(url);
    }
    this.pendingImages.clear();
  }
}
