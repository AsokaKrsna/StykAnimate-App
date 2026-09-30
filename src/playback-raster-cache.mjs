import {messageError} from './localized-error.mjs';
/** Worker-owned raster originals. Packets receive independent transferable clones.
 * Keys include exact artwork content, crop and resolution; document assets own
 * this cache's lifetime so frame-only revisions can safely keep unchanged pixels. */
export class PlaybackRasterCache {
  constructor({maxBytes = 128 * 1024 * 1024, clone = bitmap => createImageBitmap(bitmap)} = {}) {
    Object.assign(this, {maxBytes, clone});
    this.entries = new Map(); this.bytes = 0; this.disposed = false;
    this.hits = 0; this.misses = 0;
    this.frameKeys = null; this.protectedKeys = new Set(); this.protectedBytes = 0;
  }
  /** Keep the reusable subset of the previous frame through one traversal.
   * Plain LRU evicts every upcoming hit when a frame is larger than the cache. */
  beginFrame() {
    this.protectedKeys = new Set(); this.protectedBytes = 0;
    for (const key of this.frameKeys ?? []) {
      const bitmap = this.entries.get(key);
      if (bitmap) { this.protectedKeys.add(key); this.protectedBytes += bitmap.width * bitmap.height * 4; }
    }
    this.frameKeys = new Set();
  }
  _use(key, bitmap) {
    if (!this.frameKeys) return;
    this.frameKeys.add(key);
    if (!this.protectedKeys.has(key)) { this.protectedKeys.add(key); this.protectedBytes += bitmap.width * bitmap.height * 4; }
  }
  async packetBitmap(key, rasterize) {
    if (this.disposed) throw messageError(new DOMException('', 'AbortError'), "errors.playbackRasterCache.playbackRastersWereInvalidated", {});
    let original = key && this.entries.get(key);
    if (original) {
      this.hits++; this.entries.delete(key); this.entries.set(key, original);
    } else {
      this.misses++; original = rasterize();
      const bytes = original.width * original.height * 4;
      if (!key || bytes > this.maxBytes || this.protectedBytes + bytes > this.maxBytes) return original;
      for (const [oldKey, old] of this.entries) {
        if (this.bytes + bytes <= this.maxBytes) break;
        if (this.protectedKeys.has(oldKey)) continue;
        this.entries.delete(oldKey); this.bytes -= old.width * old.height * 4; old.close();
      }
      this.entries.set(key, original); this.bytes += bytes;
    }
    this._use(key, original);
    const packet = await this.clone(original);
    if (this.disposed) { packet.close(); throw messageError(new DOMException('', 'AbortError'), "errors.playbackRasterCache.playbackRastersWereInvalidated", {}); }
    return packet;
  }
  clear() {
    for (const bitmap of this.entries.values()) bitmap.close();
    this.entries.clear(); this.bytes = 0;
    this.frameKeys = null; this.protectedKeys.clear(); this.protectedBytes = 0;
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
}
