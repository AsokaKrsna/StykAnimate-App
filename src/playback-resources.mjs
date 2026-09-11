import { RasterSurfacePool } from "./raster-surfaces.mjs";
import { PlaybackRasterCache } from './playback-raster-cache.mjs';
import {PlaybackVectorCache} from './playback-vector-cache.mjs';
import {decodePreview, fitImage, pngInfo, imageBlob} from './preview-image.mjs';
import {previewMemoryPlan} from './playback-budget.mjs';

export const assetURL = (a) =>
  a?.asset_url ||
  a?.data_url ||
  a?.url ||
  (a?.base64
    ? `data:${a.mime_type || "image/png"};base64,${a.base64}`
    : null) ||
  a?.asset_path_relative ||
  a?.asset_path ||
  a?.path;

/** Worker-owned decoded assets. Figure and background pixels never cross the UI thread to decode. */
export class PlaybackResources {
  constructor({
    baseURL = globalThis.location?.href,
    token = "",
    // Soft retention target: assets required together may exceed it at full resolution.
    maxBytes = 96 * 1024 * 1024,
    maxPacketBytes = 128 * 1024 * 1024,
    preview = false,
    hardMaxBytes = Infinity,
  } = {}) {
    Object.assign(this, { baseURL, token, maxBytes, preview, hardMaxBytes });
    this.images = new Map();
    this.bytes = 0;
    this.disposed = false;
    this.controller = new AbortController();
    this.sources = new Map(); this.sourceBytes = 0;
    this.reduced = false;
    this.rasterSurfaces = new RasterSurfacePool();
    // Isolate path rasterization from WebGPU presentation. Image compositing
    // keeps acceleration to avoid expensive GPU-to-CPU source readbacks.
    this.pathRasterSurfaces = preview ? new RasterSurfacePool({contextOptions:{willReadFrequently:true}}) : this.rasterSurfaces;
    // The hardware plan already reserves retained originals separately from
    // packet uploads. A per-packet limit is a ceiling, not another partition.
    this.artworkBitmaps = new PlaybackRasterCache({maxBytes: Math.min(previewMemoryPlan().workerRasters, maxPacketBytes)});
    this.geometryDescriptors = new WeakMap();
    this.vectors = new PlaybackVectorCache({maxBytes:Math.min(previewMemoryPlan().workerVectors,maxPacketBytes)});
  }
  rasterSurface(width,height,{hasImages=false}={}) {
    // Small path surfaces avoid GPU-service stalls. Large fills need GPU
    // throughput; image surfaces also avoid reading accelerated sources back.
    return !hasImages && width*height<=512*512 ? this.pathRasterSurfaces : this.rasterSurfaces;
  }
  url = assetURL;
  image = (url) => {
    const image = this.images.get(url);
    if (image) {
      this.images.delete(url);
      this.images.set(url, image);
    }
    return image;
  };
  trimImages(needed, incomingBytes = 0) {
    for (const [url, bitmap] of this.images) {
      if (this.bytes + incomingBytes <= this.maxBytes) break;
      if (needed.has(url)) continue;
      this.images.delete(url);
      this.bytes -= bitmap.width * bitmap.height * 4;
      bitmap.close();
    }
  }
  check = () => {
    if (this.disposed) throw new DOMException("Playback assets were invalidated.", "AbortError");
  };
  checkImageBudget(incomingBytes = 0) {
    if (this.bytes + incomingBytes > this.hardMaxBytes) {
      const error = new Error('This frame needs more image memory than the export allowance. Reduce the source image dimensions and try again. Your animation has not changed.');
      error.code = 'export_memory_limit'; throw error;
    }
  }
  async source(url) {
    this.check();
    if (this.sources.has(url)) return this.sources.get(url);
    const blob = await imageBlob(url, this.baseURL, this.token, this.controller.signal); this.check();
    const info = await pngInfo(blob); this.check();
    // Compressed copies are disposable too; source files remain in the document.
    while (this.sources.size && this.sourceBytes + blob.size > this.maxBytes / 2) {
      const [key, value] = this.sources.entries().next().value;
      this.sources.delete(key); this.sourceBytes -= value.blob.size;
    }
    const source = {blob, info};
    if (blob.size <= this.maxBytes / 2) { this.sources.set(url, source); this.sourceBytes += blob.size; }
    return source;
  }
  imageKey(items) {
    return [...new Set(items.filter(item => item.type === 'image').map(item => this.url(item.asset)))].map(url => {
      const image = this.images.get(url); return `${image?.width || 0}x${image?.height || 0}`;
    }).join(',');
  }
  async preload(items, {scale = 1, maxDimension = 4096} = {}) {
    if (this.disposed)
      throw new DOMException("Playback assets were invalidated.", "AbortError");
    const needed = new Set(
      items
        .filter((s) => s.type === "image")
        .map((s) => this.url(s.asset))
        .filter(Boolean),
    );
    if (this.preview) {
      const requests = new Map();
      // Metadata inspection does not decode pixels. Every simultaneous image gets
      // a share proportional to the pixels actually needed by this draw.
      for (const item of items) {
        if (item.type !== 'image') continue;
        const asset = item.asset, url = this.url(asset); if (!url) continue;
        let request = requests.get(url);
        if (!request) {
          const source = await this.source(url);
          const width = source.info?.width || asset.width || asset.pixel_width || 4096;
          const height = source.info?.height || asset.height || asset.pixel_height || 4096;
          request = {source, width, height, ratio: 0}; requests.set(url, request);
        }
        const objectScale = item.start && item.end && asset.anchor_length
          ? Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y) / asset.anchor_length : 1;
        const displayScale = Math.max((asset.display_width ?? request.width) / request.width, (asset.display_height ?? request.height) / request.height);
        const ratio = Math.min(1, 2 ** Math.ceil(Math.log2(Math.max(1 / 65536, objectScale * scale * displayScale))));
        request.ratio = Math.max(request.ratio, ratio);
      }
      let requestedPixels = 0;
      for (const request of requests.values()) {
        request.target = fitImage(request.width, request.height, request.width * request.height * request.ratio ** 2, maxDimension);
        requestedPixels += request.target.width * request.target.height;
      }
      const allowance = Math.max(1, Math.floor(this.maxBytes / 4)), ratio = Math.min(1, Math.sqrt(allowance / Math.max(1, requestedPixels)));
      const targets = new Map();
      for (const [url, request] of requests) {
        const width = Math.max(1, Math.floor(request.target.width * ratio)), height = Math.max(1, Math.floor(request.target.height * ratio));
        targets.set(url, {...request, width: request.width, height: request.height, pixels: width * height});
        const old = this.images.get(url);
        // Replace variants before allocating their successors, including zoom-out.
        if (old && (old.width * old.height > width * height * 1.05 || old.width < width || old.height < height)) {
          this.images.delete(url); this.bytes -= old.width * old.height * 4; old.close();
        }
      }
      this.trimImages(needed, [...targets].reduce((sum, [url, target]) => sum + (this.images.has(url) ? 0 : target.pixels * 4), 0));
      for (const [url, target] of targets) {
        if (!this.images.has(url)) {
          const bitmap = await decodePreview(target.source.blob, {...target, maxPixels: target.pixels, maxDimension, check: this.check});
          this.images.set(url, bitmap); this.bytes += bitmap.width * bitmap.height * 4;
        }
      }
      this.reduced = [...needed].some(url => {const image = this.images.get(url); return image && (image.width < image.naturalWidth || image.height < image.naturalHeight);});
      this.pressureReduced = ratio < 1;
      return;
    }
    // Release a previous oversized working set even when every new asset is cached.
    this.trimImages(needed);
    this.checkImageBudget();
    for (const url of needed) {
      if (this.images.has(url)) continue;
      const blob = await imageBlob(url, this.baseURL, this.token, this.controller.signal);
      const metadata = typeof blob?.arrayBuffer === 'function' ? await pngInfo(blob) : null;
      this.check();
      const asset = items.find(item => item.type === 'image' && this.url(item.asset) === url)?.asset;
      const expectedBytes = (metadata?.width || asset?.width || 0) * (metadata?.height || asset?.height || 0) * 4;
      this.trimImages(needed, expectedBytes);
      this.checkImageBudget(expectedBytes);
      const bitmap = await createImageBitmap(blob);
      if (this.disposed) {
        bitmap.close();
        throw new DOMException(
          "Playback assets were invalidated.",
          "AbortError",
        );
      }
      const decodedBytes = bitmap.width * bitmap.height * 4;
      // Evict unused assets, but never reject images required by the current draw.
      this.trimImages(needed, decodedBytes);
      try {this.checkImageBudget(decodedBytes);} catch (error) {bitmap.close(); throw error;}
      // Native drawGeometry deliberately accepts the same image contract in both contexts.
      bitmap.complete = true;
      bitmap.naturalWidth = bitmap.width;
      bitmap.naturalHeight = bitmap.height;
      this.images.set(url, bitmap);
      this.bytes += decodedBytes;
    }
  }
  dispose() {
    this.disposed = true;
    this.controller.abort(); this.sources.clear(); this.sourceBytes = 0;
    for (const image of this.images.values()) image.close();
    this.images.clear();
    this.bytes = 0;
    this.rasterSurfaces.dispose();
    if(this.pathRasterSurfaces!==this.rasterSurfaces)this.pathRasterSurfaces.dispose();
    this.artworkBitmaps.dispose();
    this.vectors.clear();
  }
}
