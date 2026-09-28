import {previewMemoryPlan} from './playback-budget.mjs';
/** Own editor textures independently of scene entries. Evict only at publication,
 * when the complete next layout is known, never while it is being assembled. */
export class EditorRasterCache {
  constructor({maxBytes = previewMemoryPlan().editorRasters, maxEntries = 1024, maxRecycledBytes} = {}) {
    this.maxBytes = Math.max(0, maxBytes);
    this.maxEntries = Math.max(0, maxEntries);
    // Scrubbing replaces animated artwork every tick; allocating and destroying
    // its textures stalled the GPU process on integrated graphics. Released
    // allocations of a recyclable class wait here, oldest first, for reuse.
    this.maxRecycledBytes = Math.max(0, maxRecycledBytes ?? Math.min(64 * 1024 * 1024, this.maxBytes / 2));
    this.recycled = []; this.recycledBytes = 0;
    this.variants = new WeakMap();
    this.history = new WeakMap();
    this.lru = new Map();
    this.bytes = 0;
    this.evictions = 0;
    this.leases = new Set();
  }
  get(artwork, resolution, generation, contentKey = '') {
    const resource = this.variants.get(artwork)?.get(`${generation}:${resolution}:${contentKey}`);
    if (!resource || resource.destroyed) return undefined;
    const entry = this.lru.get(resource);
    this.lru.delete(resource); this.lru.set(resource, entry);
    return resource;
  }
  previous(artwork) {
    const variants = this.variants.get(artwork);
    return variants?.size ? [...variants.values()].at(-1) : this.history.get(artwork);
  }
  set(artwork, resource) {
    let variants = this.variants.get(artwork);
    if (!variants) this.variants.set(artwork, variants = new Map());
    const key = `${resource.generation}:${resource.resolution}:${resource.contentKey??''}`;
    if (variants.has(key)) throw new Error('An editor raster variant already exists.');
    variants.set(key, resource);
    // Keep only diagnostic scalars after eviction, never a destroyed GPU handle.
    this.history.set(artwork, {resolution: resource.resolution, generation: resource.generation, destroyed: true});
    this.lru.set(resource, {variants, key});
    this.bytes += resource.bytes;
  }
  release(resource, entry) {
    this.recycle(resource); resource.destroyed = true;
    entry.variants.delete(entry.key); this.lru.delete(resource);
    this.bytes -= resource.bytes;
  }
  delete(resource) {
    const entry = this.lru.get(resource);
    if (!entry) return false;
    this.release(resource, entry); return true;
  }
  /** A new image batch cancels staged scenes through the renderer generation,
   * but only textures that read its changed URLs need new pixels. Unknown
   * dependencies and older generations retain conservative invalidation. */
  invalidateImages(urls, previousGeneration, generation) {
    for (const [resource, entry] of this.lru) {
      if (resource.generation !== previousGeneration || !resource.imageURLs || resource.imageURLs.some(url => urls.has(url))) {
        this.release(resource, entry); continue;
      }
      entry.variants.delete(entry.key);
      resource.generation = generation;
      entry.key = `${generation}:${resource.resolution}:${resource.contentKey??''}`;
      entry.variants.set(entry.key, resource);
    }
  }
  lease(resources=[]) {
    const retained=new Set(resources);this.leases.add(retained);
    return {add:resource=>{if(resource)retained.add(resource);},release:()=>this.leases.delete(retained)};
  }
  retain(active, generation) {
    const protectedResources=new Set(active);
    for(const lease of this.leases)for(const resource of lease)protectedResources.add(resource);
    for (const [resource, entry] of this.lru) {
      if (protectedResources.has(resource)) continue;
      if (resource.generation === generation && this.bytes <= this.maxBytes && this.lru.size <= this.maxEntries) continue;
      this.release(resource, entry); this.evictions++;
    }
    this.stats = {bytes: this.bytes, entries: this.lru.size, activeBytes: [...active].reduce((sum, r) => sum + (r.bytes || 0), 0),
      protectedBytes:[...protectedResources].reduce((sum,r)=>sum+(r.bytes||0),0),leases:this.leases.size,
      maxBytes: this.maxBytes, maxEntries: this.maxEntries, evictions: this.evictions, recycledBytes: this.recycledBytes, reused: this.reused || 0};
  }
  /** Keep a released allocation that declares a recycling class. Callers
   * rewrite every texel they sample before presenting it again. */
  recycle(resource) {
    const bytes = resource.bytes;
    if (!resource.poolClass || bytes > this.maxRecycledBytes) { resource.texture.destroy(); return; }
    while (this.recycled.length && this.recycledBytes + bytes > this.maxRecycledBytes) {
      const oldest = this.recycled.shift(); this.recycledBytes -= oldest.bytes; oldest.texture.destroy();
    }
    this.recycled.push({texture: resource.texture, bindGroup: resource.bindGroup, poolClass: resource.poolClass,
      width: resource.allocatedWidth, height: resource.allocatedHeight, bytes});
    this.recycledBytes += bytes;
  }
  /** The smallest released allocation of this class covering width × height
   * within twice its area, or undefined. */
  take(poolClass, width, height) {
    let best = -1;
    for (let i = 0; i < this.recycled.length; i++) {
      const item = this.recycled[i], area = item.width * item.height;
      if (item.poolClass === poolClass && item.width >= width && item.height >= height && area <= width * height * 2 &&
        (best < 0 || area < this.recycled[best].width * this.recycled[best].height)) best = i;
    }
    if (best < 0) return undefined;
    const [item] = this.recycled.splice(best, 1); this.recycledBytes -= item.bytes; this.reused = (this.reused || 0) + 1;
    return item;
  }
  clear() {
    for (const [resource, entry] of this.lru) this.release(resource, entry);
    for (const item of this.recycled) item.texture.destroy();
    this.recycled = []; this.recycledBytes = 0;
    this.variants = new WeakMap(); this.history = new WeakMap(); this.stats = undefined;
    this.leases.clear();
  }
}
