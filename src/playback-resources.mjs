import { RasterSurfacePool } from "./raster-surfaces.mjs";
import { PlaybackRasterCache } from './playback-raster-cache.mjs';
import {PlaybackVectorCache} from './playback-vector-cache.mjs';
import {previewMemoryPlan} from './playback-budget.mjs';
import {drawingMetadata} from './drawing-model.mjs';
import {DrawingTileProvider} from './drawing-provider.mjs';

import {ImageResources} from './image-resources.mjs';
export {assetURL, imageDrawNeed} from './image-resources.mjs';

/** Rendering resources extend the shared image owner. Image-only workers import
 * ImageResources directly and do not load geometry, shaders or raster caches. */
export class PlaybackResources extends ImageResources {
  constructor(options = {}) {
    super(options);
    const {preview = false, maxPacketBytes = 128 * 1024 * 1024,
      maxRasterBytes = previewMemoryPlan().workerRasters, maxVectorBytes = previewMemoryPlan().workerVectors} = options;
    this.rasterSurfaces = new RasterSurfacePool();
    // Isolate path rasterization from WebGPU presentation. Image compositing
    // keeps acceleration to avoid expensive GPU-to-CPU source readbacks.
    this.pathRasterSurfaces = preview ? new RasterSurfacePool({contextOptions:{willReadFrequently:true}}) : this.rasterSurfaces;
    // The hardware plan already reserves retained originals separately from
    // packet uploads. A per-packet limit is a ceiling, not another partition.
    this.artworkBitmaps = new PlaybackRasterCache({maxBytes: Math.min(maxRasterBytes, maxPacketBytes)});
    this.geometryDescriptors = new WeakMap();
    this.vectors = new PlaybackVectorCache({maxBytes:Math.min(maxVectorBytes,maxPacketBytes)});
    this.drawingProvider = new DrawingTileProvider({budgetBytes: Math.min(96 * 1024 * 1024, Math.max(16 * 1024 * 1024, this.maxBytes))});
    // Onion tints over drawing scratch canvases, keyed by color+stamp+anchor.
    const tints = new Map(); let tintBytes = 0;
    this.tint = (image, rgb, stamp = 0) => {
      const key = rgb.join(',') + ':' + stamp; let hit = tints.get(image);
      if (hit?.key === key) return hit.canvas;
      if (hit) { tintBytes -= hit.bytes; tints.delete(image); hit.canvas.width = hit.canvas.height = 1; }
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height, bytes = width * height * 4;
      while (tints.size && tintBytes + bytes > 32 * 1024 * 1024) { const [source, old] = tints.entries().next().value; tintBytes -= old.bytes; old.canvas.width = old.canvas.height = 1; tints.delete(source); }
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), {width, height});
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = `rgb(${rgb.join(',')})`; ctx.fillRect(0, 0, width, height);
      canvas.complete = true; canvas.naturalWidth = width; canvas.naturalHeight = height; tints.set(image, {key, canvas, bytes}); tintBytes += bytes; return canvas;
    };
    this.tintCanvases = tints;
  }
  /** drawGeometry reads live drawing tiles through this hook, like the editor. */
  drawing = (figure) => this.drawingProvider.presenter(figure);
  cacheSnapshot() {
    let tintBytes = 0;
    for (const entry of this.tintCanvases.values()) tintBytes += entry.bytes;
    return {imageBytes: this.bytes, sourceBytes: this.sourceBytes,
      rasterBytes: this.artworkBitmaps.bytes, rasterEntries: this.artworkBitmaps.entries.size,
      vectorBytes: this.vectors.bytes, vectorEntries: this.vectors.lru.size,
      drawingBytes: this.drawingProvider.bytes, tintBytes};
  }
  rasterSurface(width,height,{hasImages=false}={}) {
    // Accelerated worker canvases all flush through the single GPU-service
    // thread that also presents frames; on integrated GPUs large path flushes
    // stalled playback for 100+ ms. CPU surfaces rasterize in parallel on the
    // worker threads instead. Image surfaces stay accelerated to avoid reading
    // accelerated sources back. Routing depends only on content, never size,
    // so an object keeps the same antialiasing as it grows or shrinks.
    return hasImages ? this.rasterSurfaces : this.pathRasterSurfaces;
  }
  async preload(items, options = {}) {
    this.check();
    await this.drawingProvider.prepare(items.filter(item => item.type === 'image' && drawingMetadata(item.fig)?.version === 2).map(item => item.fig));
    return super.preload(items, options);
  }
  dispose() {
    super.dispose();
    this.rasterSurfaces.dispose();
    if(this.pathRasterSurfaces!==this.rasterSurfaces)this.pathRasterSurfaces.dispose();
    this.artworkBitmaps.dispose();
    this.vectors.clear();
    this.drawingProvider.dispose();
    for (const t of this.tintCanvases.values()) t.canvas.width = t.canvas.height = 1;
    this.tintCanvases.clear();
  }
}
