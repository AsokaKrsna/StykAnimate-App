import { RasterSurfacePool } from "./raster-surfaces.mjs";
import { PlaybackRasterCache } from './playback-raster-cache.mjs';
import {PlaybackVectorCache} from './playback-vector-cache.mjs';
import {decodePreview, fitImage, imageInfo, imageBlob} from './preview-image.mjs';
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

const invertMatrix = ([a, b, c, d, e, f]) => {
  const det = a * d - b * c;
  return det ? [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det] : null;
};
const applyMatrix = ([a, b, c, d, e, f], x, y) => ({ x: a * x + c * y + e, y: b * x + d * y + f });
const unionRect = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};
const containsRect = (outer, inner) =>
  outer.x <= inner.x && outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
/** The source-pixel rectangle a decoded bitmap covers. Uncropped variants span
 * their logical (original) size, not their allocated pixel size. */
const bitmapSourceRect = bitmap => bitmap.srcW !== undefined
  ? { x: bitmap.srcX, y: bitmap.srcY, width: bitmap.srcW, height: bitmap.srcH }
  : { x: 0, y: 0, width: bitmap.naturalWidth || bitmap.width, height: bitmap.naturalHeight || bitmap.height };
const bitmapResolution = bitmap => bitmap.width / Math.max(1, bitmapSourceRect(bitmap).width);
/** One decoded variant serves a draw when it covers the needed source region
 * at the needed sampling density. Keeping larger variants avoids re-decoding
 * multi-megabyte sources on every zoom or pan direction change. */
const bitmapCovers = (bitmap, rect, resolution) =>
  bitmap && containsRect(bitmapSourceRect(bitmap), rect) && bitmapResolution(bitmap) >= resolution - 1e-6;

/** The source-pixel crop and sampling density one image item needs for a draw.
 * `view` is {matrix, width, height} (document→output pixels, as on export) or
 * {visible, scale} (document-space rect and output pixels per document unit,
 * as in playback). Returns null when the placement is unknown, {empty} when
 * the image cannot appear in the output, or {x,y,width,height,density}. */
export function imageDrawNeed(item, sourceWidth, sourceHeight, view) {
  const a = item.asset;
  if (!view || !item.start || !item.end) return null;
  // drawGeometry skips segments without an anchor entirely.
  if (!a?.anchor_length) return { empty: true };
  let visible, outScale;
  if (view.matrix) {
    const inverse = invertMatrix(view.matrix);
    if (!inverse) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of [[0, 0], [view.width, 0], [0, view.height], [view.width, view.height]]) {
      const p = applyMatrix(inverse, px, py);
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    visible = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    outScale = Math.max(Math.hypot(view.matrix[0], view.matrix[1]), Math.hypot(view.matrix[2], view.matrix[3]));
  } else { visible = view.visible; outScale = view.scale; }
  if (!visible || !(outScale > 0) || !(sourceWidth > 0 && sourceHeight > 0)) return null;
  const displayWidth = a.display_width ?? sourceWidth, displayHeight = a.display_height ?? sourceHeight;
  if (!(displayWidth > 0 && displayHeight > 0)) return null;
  const kx = displayWidth / sourceWidth, ky = displayHeight / sourceHeight;
  const reverse = Boolean(item.seg?.extra_u8_a ?? item.seg?.extra?.[1]);
  const mirror = Boolean(item.seg?.extra_u8_b ?? item.seg?.extra?.[2]) !== Boolean(item.obj?.image_text_flags);
  const start = reverse ? item.end : item.start;
  const scale = Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y) / a.anchor_length;
  if (!(scale > 0)) return null;
  const angle = (mirror ? item.angle + a.anchor_angle_rad - Math.PI : item.angle - a.anchor_angle_rad) + (reverse ? Math.PI : 0);
  const cos = Math.cos(angle), sin = Math.sin(angle), mx = mirror ? -1 : 1, anchor = a.anchor_start || { x: 0, y: 0 };
  // Matches drawGeometry: translate(start)·rotate(angle)·scale(±s,s)·translate(-anchor)·display-stretch.
  const matrix = [mx * scale * kx * cos, mx * scale * kx * sin, -scale * ky * sin, scale * ky * cos,
    start.x - mx * scale * cos * anchor.x + scale * sin * anchor.y,
    start.y - mx * scale * sin * anchor.x - scale * cos * anchor.y];
  const inverse = invertMatrix(matrix);
  if (!inverse) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, py] of [[visible.x, visible.y], [visible.x + visible.width, visible.y],
    [visible.x, visible.y + visible.height], [visible.x + visible.width, visible.y + visible.height]]) {
    const p = applyMatrix(inverse, px, py);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  // Guard pixels keep nearest-neighbour sampling exact along the crop edges.
  const cx0 = Math.max(0, Math.floor(x0 - 2)), cy0 = Math.max(0, Math.floor(y0 - 2));
  const cx1 = Math.min(sourceWidth, Math.ceil(x1 + 2)), cy1 = Math.min(sourceHeight, Math.ceil(y1 + 2));
  if (cx1 <= cx0 || cy1 <= cy0) return { empty: true };
  return { x: cx0, y: cy0, width: cx1 - cx0, height: cy1 - cy0, density: outScale * scale * Math.max(kx, ky) };
}

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
    const info = await imageInfo(blob); this.check();
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
      const image = this.images.get(url), source = image && bitmapSourceRect(image);
      return image ? `${image.width}x${image.height}@${source.x},${source.y},${source.width}x${source.height}` : '0x0';
    }).join(',');
  }
  /** Merge every item's source-space requirement for one URL: 'whole' when any
   * draw needs the complete image, 'none' when none can appear, or a crop
   * rectangle with the maximum required density. */
  urlNeed(items, url, sourceWidth, sourceHeight, view) {
    let merged = null, density = 0, whole = !view;
    for (const item of items) {
      if (item.type !== 'image' || this.url(item.asset) !== url) continue;
      const need = imageDrawNeed(item, sourceWidth, sourceHeight, view);
      if (need?.empty) continue;
      if (!need) { whole = true; continue; }
      density = Math.max(density, need.density);
      merged = merged ? unionRect(merged, need) : { x: need.x, y: need.y, width: need.width, height: need.height };
    }
    if (whole || !merged) return whole ? 'whole' : 'none';
    merged.density = density;
    return merged;
  }
  /** Decode one asset variant: only the needed source crop at the needed
   * sampling density when that is known, the complete source otherwise. */
  async decodeVariant(blob, need, maxDimension, sourceWidth, sourceHeight) {
    if (need !== 'whole' && need !== 'none' && typeof blob?.arrayBuffer === 'function') {
      const resolution = Math.min(1, need.density);
      const bitmap = await decodePreview(blob, {
        width: sourceWidth, height: sourceHeight, maxPixels: Math.max(1, Math.ceil(need.width * resolution) * Math.ceil(need.height * resolution)),
        maxDimension, crop: need, check: this.check});
      return bitmap;
    }
    return createImageBitmap(blob);
  }
  async preload(items, {scale = 1, maxDimension = 4096, visible, plan} = {}) {
    if (this.disposed)
      throw new DOMException("Playback assets were invalidated.", "AbortError");
    const view = plan ? {matrix: plan.matrix, width: plan.width, height: plan.height}
      : visible ? {visible, scale} : null;
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
          request = {source, width, height, density: 0, crop: null, whole: false}; requests.set(url, request);
        }
        const need = imageDrawNeed(item, request.width, request.height, view);
        if (need?.empty) continue;
        if (!need) {
          request.whole = true;
          const objectScale = item.start && item.end && asset.anchor_length
            ? Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y) / asset.anchor_length : 1;
          const displayScale = Math.max((asset.display_width ?? request.width) / request.width, (asset.display_height ?? request.height) / request.height);
          request.density = Math.max(request.density, 2 ** Math.ceil(Math.log2(Math.max(1 / 65536, objectScale * scale * displayScale))));
          continue;
        }
        request.crop = request.crop ? unionRect(request.crop, need) : {x: need.x, y: need.y, width: need.width, height: need.height};
        request.density = Math.max(request.density, 2 ** Math.ceil(Math.log2(Math.max(1 / 65536, Math.min(1, need.density)))));
      }
      let requestedPixels = 0;
      for (const request of requests.values()) {
        if (!request.whole && !request.crop) {request.target = null; continue;}
        const crop = request.whole || !request.crop ? {x: 0, y: 0, width: request.width, height: request.height} : request.crop;
        request.crop = crop;
        request.target = fitImage(crop.width, crop.height, crop.width * crop.height * Math.min(1, request.density) ** 2, maxDimension);
        requestedPixels += request.target.width * request.target.height;
      }
      const allowance = Math.max(1, Math.floor(this.maxBytes / 4)), ratio = Math.min(1, Math.sqrt(allowance / Math.max(1, requestedPixels)));
      const targets = new Map();
      for (const [url, request] of requests) {
        if (!request.target) continue;
        const width = Math.max(1, Math.floor(request.target.width * ratio)), height = Math.max(1, Math.floor(request.target.height * ratio));
        const old = this.images.get(url);
        // Larger covering variants are kept to avoid churn, except under pixel
        // pressure where they would keep this draw over its allowance.
        if (bitmapCovers(old, request.crop, width / request.crop.width) &&
            !(ratio < 1 && old.width * old.height > width * height * 1.05)) continue;
        // Coverage grows toward the union of the retained variant while it
        // stays inside the allowance, so pans decode larger regions rarely.
        let crop = request.crop, resolution = width / request.crop.width;
        if (old && ratio >= 1) {
          const union = unionRect(crop, bitmapSourceRect(old)), grown = Math.min(1, Math.max(resolution, bitmapResolution(old)));
          if (union.width * union.height * grown ** 2 <= allowance) {crop = union; resolution = grown;}
        }
        targets.set(url, {...request, crop, resolution, pixels: Math.max(1, Math.ceil(crop.width * resolution) * Math.ceil(crop.height * resolution))});
      }
      this.trimImages(needed, [...targets.values()].reduce((sum, target) => sum + target.pixels * 4, 0));
      for (const [url, target] of targets) {
        const old = this.images.get(url);
        if (old) { this.images.delete(url); this.bytes -= old.width * old.height * 4; old.close(); }
        const bitmap = await decodePreview(target.source.blob, {
          width: target.width, height: target.height, maxPixels: target.pixels, maxDimension,
          crop: target.crop, check: this.check});
        this.images.set(url, bitmap); this.bytes += bitmap.width * bitmap.height * 4;
      }
      this.reduced = [...needed].some(url => {
        const image = this.images.get(url), request = requests.get(url);
        return request?.target && image && (image.width + 1 < request.target.width || image.height + 1 < request.target.height);
      });
      this.pressureReduced = ratio < 1;
      return;
    }
    // Release a previous oversized working set even when every new asset is cached.
    this.trimImages(needed);
    this.checkImageBudget();
    for (const url of needed) {
      const retained = this.images.get(url);
      if (retained) {
        const width = retained.naturalWidth || retained.width, height = retained.naturalHeight || retained.height;
        const need = this.urlNeed(items, url, width, height, view);
        if (need === 'none' || bitmapCovers(retained, need === 'whole' ? {x:0,y:0,width,height} : need,
            need === 'whole' ? 1 : Math.min(1,need.density))) continue;
      }
      const blob = await imageBlob(url, this.baseURL, this.token, this.controller.signal);
      const metadata = typeof blob?.arrayBuffer === 'function' ? await imageInfo(blob) : null;
      this.check();
      const asset = items.find(item => item.type === 'image' && this.url(item.asset) === url)?.asset;
      const sourceWidth = metadata?.width || asset?.width || 0, sourceHeight = metadata?.height || asset?.height || 0;
      const need = this.urlNeed(items, url, sourceWidth, sourceHeight, view);
      const resolution = need === 'whole' || need === 'none' ? 1 : Math.min(1, need.density);
      const expectedPixels = need === 'none' ? 0 : need === 'whole' ? sourceWidth * sourceHeight
        : Math.ceil(need.width * resolution) * Math.ceil(need.height * resolution);
      this.trimImages(needed, expectedPixels * 4);
      this.checkImageBudget(expectedPixels * 4);
      const old = this.images.get(url);
      if (need === 'none' || bitmapCovers(old, need === 'whole' ? {x: 0, y: 0, width: sourceWidth, height: sourceHeight} : need, resolution)) continue;
      // Tiles and frames that overlap the retained variant decode their union
      // once instead of re-decoding every time the needed region moves.
      let target = need;
      if (old && need !== 'whole' && need !== 'none') {
        const union = unionRect(need, bitmapSourceRect(old)), grown = Math.min(1, Math.max(resolution, bitmapResolution(old)));
        const grownPixels = Math.ceil(union.width * grown) * Math.ceil(union.height * grown);
        if (grownPixels * 4 <= Math.min(this.hardMaxBytes, Math.max(this.maxBytes, 1)) - (this.bytes - old.width * old.height * 4))
          target = {...union, density: grown};
      }
      const bitmap = await this.decodeVariant(blob, target, maxDimension, sourceWidth, sourceHeight);
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
      bitmap.naturalWidth = sourceWidth || bitmap.width;
      bitmap.naturalHeight = sourceHeight || bitmap.height;
      if (old) { this.images.delete(url); this.bytes -= old.width * old.height * 4; old.close(); }
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
