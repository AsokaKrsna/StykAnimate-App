import {vectorVfxSource,rasterizeVectorVfx} from './renderer-vfx-vector.mjs';
import {connectedVfxGeometry} from './vfx-connected.mjs';
import {parallaxResolver} from './layer-parallax.mjs';
import {canvasPaint} from './paint.mjs';
import {GpuTiming,requestInstrumentedDevice} from './gpu-timing.mjs';
import {gpuStartupBudget} from './gpu-startup.mjs';
import {normalizeMsaaCount, viewportBackingSize} from './preview-quality.mjs';
import {ViewportVfx,hasSceneVfx} from './vfx-viewport.mjs';
import {CameraVfx} from './vfx-camera.mjs';
import {initVfxDevice,releaseVfxDevice} from './vfx-gpu.mjs';
import {hasDrawableVfx,vfxRasterScale} from './vfx-canvas.mjs';
import {vfxPreviewOptions,vfxPreviewGeometry} from './vfx-preview.mjs';
import { buildGeometry, buildGeometrySteps, drawGeometry, releaseGeometryResources } from './pivot/geometry.mjs';
import { drawBackground, backgroundBounds, sceneBackgroundColor, effectiveCamera } from './pivot/background.mjs';
import { SHAPE, SHAPE_BYTES, SHAPE_FLOATS, shapeRecord, compileVectorObject, compileVectorObjectSteps, requiresCompatibilityTexture, adoptPreparedVectors, objectBounds, cameraMatrix, argbFloats } from './renderer-geometry.mjs';
import { PreparedFrameCache } from './prepared-frames.mjs';
import { RasterSurfacePool } from './raster-surfaces.mjs';
import { EditorRasterCache } from './renderer-raster-cache.mjs';
import {previewMemoryPlan} from './playback-budget.mjs';
import { composeSceneGroups } from './scene-order.mjs';
import {OnionComposite} from './renderer-onion-composite.mjs';
import {OnionSurfaceCache, onionLayerEnd, onionLayerKeys} from './onion-surface-cache.mjs';
import { HandleRenderer } from './renderer-handles.mjs';
import {opacityArtwork} from './renderer-opacity.mjs';
import {rasterizeVectorGroup, supportsVectorIsolation} from './renderer-vector-raster.mjs';
import {meshOnlyItems, meshRasterSource, rasterizeMeshGroup} from './renderer-mesh-raster.mjs';
import { ArtworkRegistry } from './render-artwork.mjs';
import {glyphTextureDescriptor,drawGlyphMask,glyphTextureShape} from './renderer-glyphs.mjs';
import { uploadShapeLayoutSteps, SHAPE_UPLOAD_RECORDS } from './renderer-upload.mjs';
import { backgroundImageAssets, frameImageAssets, createSceneImages, consumeSceneSteps } from './scene-preparation.mjs';
import {drawingMatrix,drawingPixelMatrix,drawingMetadata} from './drawing-model.mjs';
import {DrawingGpu,gpuDrawingEligible} from './drawing-gpu.mjs';
import {GeneratorGpu} from './vfx-generator-gpu.mjs';
import {drawGeneratorDraws} from './vfx-generator-canvas.mjs';
import {generatorBatchFor,budgetedGeneratorBatch,offsetGeneratorBatch,generatorSchedule,scheduleWalker,SOFTWARE_PARTICLE_BUDGET,INTERACTIVE_SAMPLING_MS} from './vfx-generator-frame.mjs';
export { cameraMatrix, worldToScreen, screenToWorld } from './renderer-geometry.mjs';
// Compatibility rasters can contain several drawing cels or drawing effects.
// Track decoded/preview inputs, never hash tile blobs or invalidate unrelated artwork.
function drawingAlpha(item){
  let alpha=item.alpha*(item.opacity??1)*(item._movieclipOwner?.opacity??1);
  for(let inner=item._movieclipInner;inner;inner=inner.inner)alpha*=inner.owner.opacity;
  return alpha;
}
function drawingRasterInputs(items,resources){
  let inputs=null;
  for(const item of items)if(drawingMetadata(item.fig)){const entry=resources.drawing?.(item.fig);if(entry)(inputs??=[]).push({entry,stamp:entry.stamp,store:entry.store});}
  return inputs;
}
const changedDrawingRaster=inputs=>inputs?.some(({entry,stamp,store})=>entry.disposed||entry.stamp!==stamp||entry.store!==store);
const drawingRasterKey=inputs=>inputs?.map(({entry,stamp})=>entry.id+":"+stamp+":"+(entry.owner?.surfaceVersion??0)).join("|")??"";
function renderPreviewVfx(renderer,field,create,render) {
  if(performance.now()<renderer.vfxRetryAt)return false;
  try {
    const started=renderer.measureFrame?performance.now():0;
    renderer[field]??=create();render(renderer[field]);
    if(renderer.measureFrame)(renderer.telemetryStages??={}).vfx=performance.now()-started;
    if(renderer.vfxRetryAt){renderer.options.onRecovery?.('vfx','recovered');renderer.options.onStatus?.({backend:renderer.stats.backend,message:'Camera effects preview restored.'});}
    renderer.vfxRetryAt=0;return true;
  }
  catch(error){
    // The unfiltered scene is already visible. Release failed effect surfaces
    // and leave editing available while a later frame retries the preview.
    renderer.vfxRetryAt=performance.now()+1500;
    renderer.options.onRecovery?.('vfx','started');
    try {renderer[field]?.destroy();} catch { /* A lost device may already be released. */ }
    renderer[field]=null;renderer.stats.vfxFailures=(renderer.stats.vfxFailures||0)+1;
    const failure=error instanceof Error?error:new Error('The camera effects preview failed.');
    failure.telemetryStage??='prepare';
    renderer.options.onStatus?.({backend:renderer.stats.backend,message:'Camera effects preview unavailable. Showing the scene without camera effects while retrying.'});
    if(renderer.options.onError)renderer.options.onError(failure);else globalThis.reportError?.(failure);
    return false;
  }
}
function editorBackgroundColor(options) {
  const color=options.editorBackgroundColor;
  if(color===undefined||color===null)return undefined;
  if(!Number.isInteger(color)||color<0||color>0xffffffff)throw new Error('Editor background must be an ARGB color.');
  return color;
}

const SHADER = /* wgsl */ `
struct Globals { row0: vec4f, row1: vec4f, viewport: vec4f, clip: vec4f }
struct Shape { a: vec4f, b: vec4f, color: vec4f, color2: vec4f, gradient: vec4f, info: vec4f }
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> shapes: array<Shape>;
@group(0) @binding(2) var<storage, read> transforms: array<vec4f>;
@group(1) @binding(0) var imageSampler: sampler;
@group(1) @binding(1) var imageTexture: texture_2d<f32>;
struct VertexOut { @builtin(position) position: vec4f, @location(0) local: vec2f, @location(1) uv: vec2f, @location(2) @interpolate(flat) shapeIndex: u32 }
@vertex fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOut {
  let shape = shapes[instance];
  let transform = transforms[u32(shape.info.y)];
  var corners = array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let uv = corners[vertex];
  let kind = i32(shape.info.x);
  var p = vec2f(0);
  let aa = 1.1 / max(globals.row0.w * globals.viewport.z, 0.0001);
  if (kind == 0 || kind == 2) {
    let delta = shape.a.zw - shape.a.xy;
    let len = length(delta);
    let direction = select(vec2f(1,0), delta / max(len, 0.0001), len > 0.0001);
    let normal = vec2f(-direction.y, direction.x);
    let radius = shape.b.z + aa;
    p = shape.a.xy + direction * (uv.x * (len + 2.0 * radius) - radius) + normal * ((uv.y * 2.0 - 1.0) * radius);
  } else if (kind == 1) {
    p = shape.a.xy + (uv * 2.0 - 1.0) * (shape.b.z + aa);
  } else if (kind == 3) {
    p = shape.b.xy;
    if (vertex == 0u) { p = shape.a.xy; }
    if (vertex == 1u) { p = shape.a.zw; }
  } else if (kind == 7 || kind == 9) {
    p = shape.a.xy + shape.b.xy * uv.x + shape.b.zw * uv.y;
  } else {
    p = mix(shape.a.xy, shape.a.zw, uv);
  }
  let world = p + transform.xy;
  let screen = vec2f(dot(globals.row0.xyz, vec3f(world,1)), dot(globals.row1.xyz, vec3f(world,1)));
  var output: VertexOut;
  output.position = vec4f(screen.x / globals.viewport.x * 2.0 - 1.0, 1.0 - screen.y / globals.viewport.y * 2.0, 0, 1);
  output.local = p;
  output.uv = uv;
  output.shapeIndex = instance;
  return output;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let shape = shapes[input.shapeIndex];
  let transform = transforms[u32(shape.info.y)];
  let kind = i32(shape.info.x);
  let point = input.position.xy / globals.viewport.z;
  let center = (globals.clip.xy + globals.clip.zw) * 0.5;
  let angle = globals.row1.w;
  let delta = point - center;
  let screen = center + vec2f(cos(angle)*delta.x+sin(angle)*delta.y,-sin(angle)*delta.x+cos(angle)*delta.y);
  let outsideCanvas = screen.x < globals.clip.x || screen.y < globals.clip.y || screen.x > globals.clip.z || screen.y > globals.clip.w;
  // Backgrounds stay on the artboard; editor figures can extend into the workspace.
  if (kind < 0 || transform.w < 0.5 || (outsideCanvas && (globals.viewport.w > 0.5 || shape.info.w > 0.5))) { discard; }
  var coverage = 1.0;
  var distance = -1.0;
  if (kind == 0) {
    let delta = shape.a.zw - shape.a.xy;
    let norm = dot(delta, delta);
    let t = clamp(dot(input.local - shape.a.xy, delta) / max(norm, 0.000001), 0.0, 1.0);
    distance = length(input.local - shape.a.xy - delta * t) - shape.b.z;
  } else if (kind == 2) {
    let delta = shape.a.zw - shape.a.xy;
    let len = length(delta);
    let direction = select(vec2f(1,0), delta / max(len, 0.0001), len > 0.0001);
    let p = input.local - (shape.a.xy + shape.a.zw) * 0.5;
    let q = abs(vec2f(dot(p, direction), dot(p, vec2f(-direction.y, direction.x)))) - vec2f(len * 0.5 + shape.b.z, shape.b.z);
    distance = length(max(q, vec2f(0))) + min(max(q.x,q.y),0.0);
  } else if (kind == 1) {
    let radius = length(input.local - shape.a.xy);
    distance = radius - shape.b.z;
    if (shape.b.w > 0.0) { distance = max(distance, shape.b.w - radius); }
  }
  let edge = max(fwidth(distance), 0.00001);
  if (kind <= 2) { coverage = clamp(0.5 - distance / edge, 0.0, 1.0); }
  var t = clamp(dot(input.local - shape.gradient.xy, shape.gradient.zw), 0.0, 1.0);
  if (kind == 6) { t = clamp((length(input.local - shape.gradient.xy) - shape.gradient.z) / max(shape.gradient.w - shape.gradient.z, 0.0001), 0.0, 1.0); }
  var color = mix(shape.color, shape.color2, t);
  if (kind == 7) {
    let alpha = textureSampleLevel(imageTexture, imageSampler, input.uv, 0.0).a * color.a * transform.z;
    return vec4f(color.rgb * alpha, alpha);
  }
  if (kind == 4 || kind == 8 || kind == 9) {
    var uv = input.uv;
    if (kind == 8) { uv = (input.local - shape.gradient.xy) * shape.gradient.zw; }
    let texel = textureSampleLevel(imageTexture, imageSampler, clamp(uv, vec2f(0), vec2f(1)), 0.0);
    // copyExternalImageToTexture uses premultiplied textures; preserve that convention.
    return texel * (color.a * transform.z);
  }
  let alpha = color.a * coverage * transform.z;
  return vec4f(color.rgb * alpha, alpha);
}`;

const pow2 = n => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
const uidOf = g => g?.obj?.unique_id ?? g?.slot;
function createResources(options, invalidate) {
  const images = new Map(), watched = new WeakSet(),tints=new Map();let tintBytes=0;
  const watch = image => {
    if (image && !image.complete && !image.previewInvalidationManaged && !watched.has(image)) {
      watched.add(image); image.addEventListener('load', invalidate, { once: true }); image.addEventListener('error', invalidate, { once: true });
    }
    return image;
  };
  const resources = {
    drawing: options.resources?.drawing,
    tint(image,rgb,stamp=0){
      const key=rgb.join(',')+':'+stamp;let hit=tints.get(image);
      if(hit?.key===key)return hit.canvas;
      if(hit){tintBytes-=hit.bytes;tints.delete(image);hit.canvas.width=hit.canvas.height=1;}
      const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height,bytes=width*height*4;
      while(tints.size&&tintBytes+bytes>32*1024*1024){const [source,old]=tints.entries().next().value;tintBytes-=old.bytes;old.canvas.width=old.canvas.height=1;tints.delete(source);}
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle=`rgb(${rgb.join(',')})`;ctx.fillRect(0,0,width,height);
      canvas.complete=true;canvas.naturalWidth=width;canvas.naturalHeight=height;tints.set(image,{key,canvas,bytes});tintBytes+=bytes;return canvas;
    },
    url: options.resources?.url ?? (asset => asset?.asset_url || asset?.data_url || asset?.asset_path_relative || asset?.asset_path || null),
    image: options.resources?.image ? (url => watch(options.resources.image(url))) : (url => {
      if (!url) return null;
      if (images.has(url)) return images.get(url);
      const image = new Image(); image.decoding = 'async';
      images.set(url, image); image.src = url; return watch(image);
    }),
    clear: () => {images.clear();for(const t of tints.values())t.canvas.width=t.canvas.height=1;tints.clear();tintBytes=0;},
  };
  return resources;
}

/** A Canvas fallback is explicit and never advertised as hardware WebGPU rendering. */
class CanvasFallback {
  constructor(canvas, options, reason) {
    // Keep the compatibility surface independent of the failed GPU backend.
    this.canvas = canvas; this.context = canvas.getContext('2d', {willReadFrequently: true}); this.options = options;
    if (!this.context) throw new Error('The compatibility canvas is unavailable.');
    this.stats = { backend: 'Canvas 2D fallback', reason, drawCalls: 0, primitives: 0, frameMs: 0, objects: 0, textureObjects: 0 };
    this.onionArtwork = new Map(); this.onionArtworkBytes = 0;
    this.onionBudget = options.onionCache?.maxBytes ?? previewMemoryPlan().editorOnions;
    this.onionLayers = new OnionSurfaceCache({maxBytes: this.onionBudget / 2,
      maxEntries: options.onionCache?.maxEntries ?? 24,
      create: (w,h) => new OffscreenCanvas(w,h), dispose: canvas => {canvas.width=canvas.height=1;}});
    // Unchanged live objects rasterize once into a bounded bitmap cache instead
    // of re-stroking every primitive on each repaint, like the onion path.
    this.artwork = new Map(); this.artworkBytes = 0;
    // Software playback packets arrive as composited artboard bitmaps; copies
    // outlive CPU packet eviction so presentation is one drawImage per tick.
    this.softwarePlayback = true;
    this.prepared = new Map(); this.preparedBytes = 0;
    this.resources = createResources(options, () => { this.clearOnionArtwork(); this.clearArtwork(); if(this.vfxCamera)this.vfxCamera.frame=null; if (this.last) this.render(this.last); options.onInvalidate?.(); });
    this.onContextLost = () => { this.contextLost = true; this.clearOnionArtwork(); this.clearArtwork(); this.clearPreparedFrames(); };
    this.onContextRestored = () => {
      if (this.destroyed) return;
      this.contextLost = false;
      // Restoration clears the backing pixels. An idle editor has no pending
      // animation frame, so explicitly repaint the latest document and view.
      if (this.last) this.render(this.last);
      options.onInvalidate?.();
    };
    canvas.addEventListener?.('contextlost', this.onContextLost);
    canvas.addEventListener?.('contextrestored', this.onContextRestored);
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1, globalThis.devicePixelRatio || 1);
  }
  resize(width, height, dpr = 1) { this.width = Math.max(1, width); this.height = Math.max(1, height); this.dpr = dpr; this.canvas.width = Math.max(1, Math.round(this.width * dpr)); this.canvas.height = Math.max(1, Math.round(this.height * dpr)); }
  prepareInitialScene(options) { return prepareInitialScene(this, options); }
  activatePreparedScene(prepared, options) { return activatePreparedScene(this, prepared, options); }
  clearOnionArtwork() {
    for (const item of this.onionArtwork.values()) { item.canvas.width = 1; item.canvas.height = 1; }
    this.onionArtwork.clear(); this.onionArtworkBytes = 0;
    this.onionLayers.clear();
    for (const key of ['onionSurface','onionLayerScratch']) {
      if(this[key])this[key].width=this[key].height=1;
      this[key]=null;
    }
    this.stats.onionCacheBytes = this.stats.onionCompositeBytes = 0;
  }
  clearArtwork() {
    for (const item of this.artwork.values()) { item.canvas.width = 1; item.canvas.height = 1; }
    this.artwork.clear(); this.artworkBytes = 0;
  }
  // The bitmap inside a software packet belongs to the CPU packet pool; the
  // prepared entry owns a same-size copy so LRU eviction cannot close pixels
  // that a later tick still presents.
  prepareFrame(packet, { report } = {}) {
    if (this.destroyed || this.contextLost || this.context.isContextLost?.()) return null;
    const source = packet?.compatibility?.[0]?.bitmap;
    if (!packet?.softwareFrames || !source) return null;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(source.width, source.height) : this.canvas.ownerDocument.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    canvas.getContext('2d').drawImage(source, 0, 0);
    const entry = { canvas, report, cameraEnabled: packet.cameraEnabled !== false,
      hiddenKey: packet.hiddenKey || '', uids: packet.uids, bytes: source.width * source.height * 4 };
    const old = this.prepared.get(packet.key);
    if (old) { this.prepared.delete(packet.key); this.preparedBytes -= old.bytes; old.canvas.width = 1; old.canvas.height = 1; }
    this.prepared.set(packet.key, entry); this.preparedBytes += entry.bytes;
    while (this.prepared.size > 120 || this.preparedBytes > previewMemoryPlan().gpuFrames) {
      const key = this.prepared.keys().next().value, item = this.prepared.get(key);
      this.prepared.delete(key); this.preparedBytes -= item.bytes; item.canvas.width = 1; item.canvas.height = 1;
    }
    Object.assign(this.stats, { preparedFrames: this.prepared.size, preparedBytes: this.preparedBytes });
    return packet.key;
  }
  hasPreparedFrame(key) { return this.prepared.has(String(key)); }
  renderPrepared(key, { report, view = {}, hiddenUids, dragTranslations, cameraEnabled = true, hiddenKey = '' } = {}) {
    const entry = this.prepared.get(String(key));
    if (!entry || this.destroyed || this.contextLost || entry.report !== report) return false;
    if (entry.cameraEnabled !== (cameraEnabled !== false)) return false;
    // The bitmap baked a visibility signature. Any difference re-renders live.
    if (entry.hiddenKey !== (hiddenKey || '')) return false;
    if (hiddenUids?.has && entry.uids) for (const uid of entry.uids) if (hiddenUids.has(uid)) return false;
    if (dragTranslations?.size || (dragTranslations && Object.keys(dragTranslations).length)) return false;
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save(); ctx.scale(this.dpr, this.dpr);
    ctx.drawImage(entry.canvas, view.x || 0, view.y || 0,
      report.canvas_width * (view.scale || 1), report.canvas_height * (view.scale || 1));
    ctx.restore();
    this.prepared.delete(String(key)); this.prepared.set(String(key), entry);
    Object.assign(this.stats, { mode: 'prepared playback', frameMs: 0, drawCalls: 1, objects: 0, primitives: 0 });
    return true;
  }
  clearPreparedFrames() {
    for (const item of this.prepared.values()) { item.canvas.width = 1; item.canvas.height = 1; }
    this.prepared.clear(); this.preparedBytes = 0;
  }
  retainPreparedFrames(report, packets) {
    const keys = new Set();
    for (const packet of packets || []) keys.add(String(packet.key));
    for (const [key, item] of this.prepared) if (item.report !== report || !keys.has(key)) {
      this.prepared.delete(key); this.preparedBytes -= item.bytes; item.canvas.width = 1; item.canvas.height = 1;
    }
  }
  backgroundsReady() { return true; }
  async prepareBackgrounds() {}
  softwareRasterContext(canvas) {
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(context&&!context.isContextLost?.())return context;
    canvas.width=canvas.height=1;this.rasterRetryAt=performance.now()+1500;
    const error=Object.assign(new Error('A preview raster canvas is unavailable; drawing directly instead.'),{telemetryCode:'device_lost',telemetryStage:'prepare'});
    this.options.onError?.(error);
    if(!this.options.onError)globalThis.reportError?.(error);
    return null;
  }
  drawOnion(ctx, group, scale) {
    if(performance.now()<this.rasterRetryAt){drawGeometry(ctx,{drawables:group.items},this.resources);return;}
    const resolution = Math.max(.5, Math.min(8, 2 ** Math.ceil(Math.log2(scale || 1))));
    let cached = this.onionArtwork.get(group.g);
    if (cached?.resolution !== resolution || changedDrawingRaster(cached?.drawingInputs)) {
      if (cached) { this.onionArtwork.delete(group.g); this.onionArtworkBytes -= cached.bytes; cached.canvas.width = 1; cached.canvas.height = 1; }
      const bounds = objectBounds(group.items, this.resources);
      const pixelScale = vfxRasterScale(group.items,bounds,Math.min(resolution, 4096 / bounds.width, 4096 / bounds.height));
      const width = Math.max(1, Math.ceil(bounds.width * pixelScale)), height = Math.max(1, Math.ceil(bounds.height * pixelScale));
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : this.canvas.ownerDocument.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const temp = this.softwareRasterContext(canvas);
      if(!temp){drawGeometry(ctx,{drawables:group.items},this.resources);return;}
      temp.setTransform(pixelScale, 0, 0, pixelScale, -bounds.x * pixelScale, -bounds.y * pixelScale);
      const drawingInputs=drawingRasterInputs(group.items,this.resources);
      drawGeometry(temp, {drawables: group.items}, this.resources);
      releaseGeometryResources(temp);
      cached = {canvas, resolution, bounds, drawingInputs, width: width / pixelScale, height: height / pixelScale, bytes: width * height * 4};
      this.onionArtworkBytes += cached.bytes;
      this.stats.onionRasterizedObjects++;
    }
    this.onionArtwork.delete(group.g); this.onionArtwork.set(group.g, cached);
    ctx.drawImage(cached.canvas, cached.bounds.x, cached.bounds.y, cached.width, cached.height);
    this.trimOnionArtwork();
  }
  trimOnionArtwork() {
    // Bound raster memory independently of animation length and viewport size.
    while (this.onionArtwork.size > 4096 || this.onionArtworkBytes > this.onionBudget / 2) {
      const key = this.onionArtwork.keys().next().value, item = this.onionArtwork.get(key);
      this.onionArtwork.delete(key); this.onionArtworkBytes -= item.bytes;
      item.canvas.width = 1; item.canvas.height = 1;
    }
  }
  onionScratch(key) {
    const {width,height}=this.canvas;
    if(this[key]?.width!==width||this[key]?.height!==height){
      if(this[key])this[key].width=this[key].height=1;
      this[key]=new OffscreenCanvas(width,height);
    }
    return this[key];
  }
  drawOnionScene(ctx, groups, start, scale, hiddenUids, parallax) {
    const first = groups[start], matrix = ctx.getTransform();
    const end = onionLayerEnd(groups,start), cached = this.onionLayers.acquire(first.onionIndex);
    const valid=cached?.members?.length===end-start&&
      ['a','b','c','d','e','f'].every(k=>cached.matrix[k]===matrix[k])&&!changedDrawingRaster(cached.drawingInputs)&&
      cached.members.every((member,index)=>{const group=groups[start+index],uid=group.g.obj.unique_id,depth=parallax(uid);
        return member.g===group.g&&member.opacity===group.opacity&&member.onionIndex===group.onionIndex&&
          member.hidden===Boolean(hiddenUids?.has(uid))&&member.x===depth.x&&member.y===depth.y;});
    const canvas=cached?.surface??this.onionScratch('onionLayerScratch');
    if(!valid){
      const layer=this.softwareRasterContext(canvas), scratch=this.onionScratch('onionSurface'),temp=this.softwareRasterContext(scratch);
      if(!layer||!temp)return end;
      layer.resetTransform();layer.clearRect(0,0,canvas.width,canvas.height);
      const members=[],drawingInputs=[];
      for(let from=start;from<end;){
        let to=from+1;while(to<end&&groups[to].onionIndex===groups[from].onionIndex)to++;
        temp.resetTransform();temp.clearRect(0,0,scratch.width,scratch.height);temp.setTransform(matrix);
        for(let i=from;i<to;i++){
          const group=groups[i],uid=group.g.obj.unique_id,depth=parallax(uid),hidden=Boolean(hiddenUids?.has(uid));
          members.push({g:group.g,opacity:group.opacity,onionIndex:group.onionIndex,hidden,x:depth.x,y:depth.y});if(hidden)continue;
          const inputs=drawingRasterInputs(group.items,this.resources);if(inputs)drawingInputs.push(...inputs);
          temp.save();temp.translate(depth.x,depth.y);this.drawOnion(temp,group,scale);temp.restore();
        }
        layer.globalAlpha=groups[from].opacity;layer.drawImage(scratch,0,0);this.stats.onionRenderedFrames++;from=to;
      }
      layer.globalAlpha=1;
      if(cached)Object.assign(cached,{matrix,members,drawingInputs});
    } else {
      for(let i=start;i<end;i++)if(i===start||groups[i].onionIndex!==groups[i-1].onionIndex)this.stats.onionFrameHits++;
    }
    ctx.save();ctx.resetTransform();ctx.globalAlpha=1;ctx.drawImage(canvas,0,0);ctx.restore();
    this.stats.onionCacheBytes=this.onionArtworkBytes+this.onionLayers.bytes;
    this.stats.onionCompositeBytes=this.onionLayers.bytes+this.canvas.width*this.canvas.height*4*
      (Number(Boolean(this.onionSurface))+Number(Boolean(this.onionLayerScratch)));
    return end;
  }
  // Live objects reuse the same bounded raster strategy as onion skins. The
  // renderSource identity survives seeks and translation-only edits, so an
  // unchanged figure is one drawImage instead of re-stroking every primitive.
  drawObject(ctx, group, scale) {
    // Projected meshes change each pose. Reuse this renderer's depth surface
    // instead of creating and destroying a graphics context for every raster.
    if(group.items.some(item=>item.poly?._stykSurface?.depthTest)){drawGeometry(ctx,{drawables:group.items},this.resources);return;}
    if(group.items.length===1&&this.resources.drawing?.(group.items[0].fig)?.store){drawGeometry(ctx,{drawables:group.items},this.resources);return;}
    const artworkView=opacityArtwork(group.g,group.items),{source,items}=artworkView;
    if (group.items.length < 4 && !group.items.some(hasDrawableVfx) || typeof OffscreenCanvas === 'undefined' || performance.now()<this.rasterRetryAt) {
      drawGeometry(ctx, { drawables: group.items }, this.resources); return;
    }
    const resolution = Math.max(.5, Math.min(8, 2 ** Math.ceil(Math.log2(scale || 1))));
    let cached = this.artwork.get(source);
    if (cached?.resolution !== resolution || changedDrawingRaster(cached?.drawingInputs)) {
      if (cached) { this.artwork.delete(source); this.artworkBytes -= cached.bytes; cached.canvas.width = 1; cached.canvas.height = 1; }
      const bounds = objectBounds(items, this.resources);
      if (!(bounds.width > 0 && bounds.height > 0)) { drawGeometry(ctx, { drawables: group.items }, this.resources); return; }
      const pixelScale = vfxRasterScale(items,bounds,Math.min(resolution, 4096 / bounds.width, 4096 / bounds.height));
      const width = Math.max(1, Math.ceil(bounds.width * pixelScale)), height = Math.max(1, Math.ceil(bounds.height * pixelScale));
      const canvas = new OffscreenCanvas(width, height);
      const temp = this.softwareRasterContext(canvas);
      if(!temp){drawGeometry(ctx,{drawables:group.items},this.resources);return;}
      temp.setTransform(pixelScale, 0, 0, pixelScale, -bounds.x * pixelScale, -bounds.y * pixelScale);
      const drawingInputs=drawingRasterInputs(items,this.resources);
      drawGeometry(temp, { drawables: items }, this.resources);
      releaseGeometryResources(temp);
      cached = { canvas, resolution, bounds, drawingInputs, width: width / pixelScale, height: height / pixelScale, bytes: width * height * 4 };
      this.artworkBytes += cached.bytes;
      this.stats.rasterizedObjects = (this.stats.rasterizedObjects || 0) + 1;
    }
    this.artwork.delete(source); this.artwork.set(source, cached);
    ctx.save();ctx.globalAlpha*=artworkView.opacity;
    // Cached artwork remains at its source pose; compose it at the current
    // root after a translation without rasterizing the effects again.
    ctx.drawImage(cached.canvas, cached.bounds.x+group.g.root.x-source.root.x, cached.bounds.y+group.g.root.y-source.root.y, cached.width, cached.height);ctx.restore();
    while (this.artwork.size > 4096 || this.artworkBytes > previewMemoryPlan().editorRasters) {
      const key = this.artwork.keys().next().value, item = this.artwork.get(key);
      this.artwork.delete(key); this.artworkBytes -= item.bytes;
      item.canvas.width = 1; item.canvas.height = 1;
    }
  }
  render(options) {
    options=vfxPreviewOptions(options);
    if(options.vfxEnabled!==false&&options.frame&&options.report)options={...options,geometry:connectedVfxGeometry(options.geometry||buildGeometry(options.report,options.frame),options.frame,options.report,options.hiddenUids)};
    this.last = options; const start = performance.now(), ctx = this.context;
    if (this.destroyed || this.contextLost || !ctx || ctx.isContextLost?.()) return;
    const { report, frame, view = {}, geometry = frame && (options.vfxEnabled===false?vfxPreviewGeometry(buildGeometry(report,frame)):buildGeometry(report,frame)), hiddenUids, dragTranslations } = options;
    if (this.onionReport !== report) { this.clearOnionArtwork(); this.clearArtwork(); this.clearPreparedFrames(); this.onionReport = report; }
    this.stats.onionRasterizedObjects = 0;
    this.stats.onionRenderedFrames = this.stats.onionFrameHits = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!frame || !report) return;
    ctx.save(); ctx.scale(this.dpr, this.dpr);
    const clipArtboard = () => {const [a,b,c,d,e,f]=cameraMatrix({report,frame,view,cameraEnabled:false});ctx.beginPath();for(const [i,p] of [[0,0],[report.canvas_width,0],[report.canvas_width,report.canvas_height],[0,report.canvas_height]].entries()){const x=a*p[0]+c*p[1]+e,y=b*p[0]+d*p[1]+f;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.clip();};
    ctx.save(); clipArtboard(); ctx.transform(...cameraMatrix(options));
    const bounds=backgroundBounds(frame, report.canvas_width, report.canvas_height, options.cameraEnabled !== false, report),editorColor=editorBackgroundColor(options);
    if(editorColor===undefined)drawBackground(ctx, report, frame, report.canvas_width, report.canvas_height, { ...this.resources, bounds });
    else {const [r,g,b,a]=argbFloats(editorColor);ctx.fillStyle=`rgba(${r*255},${g*255},${b*255},${a})`;ctx.fillRect(bounds.x,bounds.y,bounds.width,bounds.height);}
    ctx.restore();
    if (options.clipToCanvas !== false) clipArtboard();
    ctx.transform(...cameraMatrix(options));
    const onions = (options.onionFrames || []).map(onion => ({geometry: options.vfxEnabled===false?vfxPreviewGeometry(onion.geometry||buildGeometry(report,onion.frame||onion)):connectedVfxGeometry(onion.geometry||buildGeometry(report,onion.frame||onion),onion.frame||onion,report,hiddenUids), opacity: onion.opacity, beforeUid: onion.beforeUid, showOnTop: onion.showOnTop}));
    const matrix = cameraMatrix(options), scale = Math.hypot(matrix[0], matrix[1]) * this.dpr;
    let primitives = 0; const parallax=parallaxResolver(report,frame,options.cameraEnabled!==false);
    // Software drawing thins dense effects to a preview budget; export does not.
    const generatorBatch=offsetGeneratorBatch(budgetedGeneratorBatch(report,frame,geometry,{enabled:options.vfxEnabled!==false,budget:SOFTWARE_PARTICLE_BUDGET,budgetMs:INTERACTIVE_SAMPLING_MS}),uid=>{const depth=parallax(uid),move=dragTranslations?.get?.(uid);return {x:depth.x+(move?.x||0),y:depth.y+(move?.y||0)};});
    const generatorPlan=generatorBatch&&generatorSchedule(generatorBatch,hiddenUids);
    const walker=generatorPlan&&!generatorPlan.empty?scheduleWalker(generatorPlan,draws=>{drawGeneratorDraws(ctx,generatorBatch,draws);}):null;
    walker?.begin();
    const groups = composeSceneGroups(geometry, onions, frame);
    if (!onions.length) this.clearOnionArtwork();
    else this.onionLayers.begin(onionLayerKeys(groups),this.canvas.width,this.canvas.height);
    for (let i=0;i<groups.length;i++) {
      const group=groups[i];
      if(group.isOnion){
        if(!hasSceneVfx(frame)){
          const end=this.drawOnionScene(ctx,groups,i,scale,hiddenUids,parallax);
          for(let j=i;j<end;j++)if(!hiddenUids?.has(groups[j].g.obj.unique_id))primitives+=groups[j].items.length;
          i=end-1;
        }
        continue;
      }
      const uid = group.g.obj.unique_id; if (hiddenUids?.has(uid)) continue;
      walker?.object(uid);
      const move = dragTranslations?.get(uid);
      ctx.save(); ctx.globalAlpha = group.opacity; if (move) ctx.translate(move.x, move.y);
      const depth=parallax(uid);ctx.translate(depth.x,depth.y);
      this.drawObject(ctx, group, scale);
      ctx.restore(); primitives += group.items.length;
    }
    walker?.end();
    if(generatorBatch?.incomplete)queueMicrotask(()=>this.options.onInvalidate?.());
    ctx.restore();
    if(hasSceneVfx(frame)){
      renderPreviewVfx(this,'vfxCamera',()=>new CameraVfx(),camera=>camera.render(ctx,{...options,geometry},this.dpr,this.resources));
      ctx.save();ctx.scale(this.dpr,this.dpr);if(options.clipToCanvas!==false)clipArtboard();ctx.transform(...matrix);
      for(let i=0;i<groups.length;i++)if(groups[i].isOnion)i=this.drawOnionScene(ctx,groups,i,scale,hiddenUids,parallax)-1;
      ctx.restore();
    }
    Object.assign(this.stats, { objects: geometry.objects.size, primitives, drawCalls: primitives, frameMs: performance.now() - start });
    return geometry;
  }
  destroy() {
    this.destroyed = true; this.last = null;
    this.vfxCamera?.destroy();
    this.canvas.removeEventListener?.('contextlost', this.onContextLost);
    this.canvas.removeEventListener?.('contextrestored', this.onContextRestored);
    this.clearOnionArtwork(); this.clearArtwork(); this.clearPreparedFrames(); releaseGeometryResources(this.context);
  }
}

class WebGPURenderer {
  constructor(canvas, device, context, format, options) {
    Object.assign(this, { canvas, device, context, format, options });
    this.stats = { backend: 'WebGPU', adapter: options.adapterName || 'Hardware accelerated', drawCalls: 0, primitives: 0, objects: 0, textureObjects: 0, frameMs: 0, uploadBytes: 0, cachedObjects: 0, gpuBytes: 0, warnings: [] };
    this.entries = new Map(); this.rasterCache = new EditorRasterCache(options.editorRasterCache); this.vectorCache = new WeakMap(); this.compatibilityCache = new WeakMap(); this.generation = 0; this.lastGeometry = null; this.backgroundKey = ''; this.last = null;
    this.artworks = new ArtworkRegistry();
    this.artworkAliases = new WeakMap();
    this.preparedFrames = new PreparedFrameCache(this, options.preparedCache);
    this.rasterSurfaces = new RasterSurfacePool();
    // Live drawing scratch textures persist across layout changes; the LRU
    // budget evicts the oldest only when the cap is exceeded.
    this.drawingTextureBudget = options.drawingTextureBudget ?? 96 * 1024 * 1024;
    // Weak adapters lower MSAA through setMsaa; every render pass, pipeline and
    // offscreen target reads this.msaaCount so attachments always agree.
    this.msaaCount = normalizeMsaaCount(options.msaa);
    this.stats.preparedCache = this.preparedFrames.stats;
    this.resources = createResources(options, () => { this.generation++; this.lastGeometry = null; if (this.last) this.render(this.last); options.onInvalidate?.(); });
  }
  async initialize(startup) {
    const d = this.device;
    const module = d.createShaderModule({ code: SHADER, label: 'StykAnimate signed-distance vector shader' });
    const info = await startup.wait(module.getCompilationInfo());
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
    this.globalLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ] });
    this.textureLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ] });
    this.vectorModule = module;
    this.pipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [this.globalLayout, this.textureLayout] });
    this.pipeline = await startup.wait(this.createVectorPipeline());
    // Raster artwork keeps its original antialiasing when the viewport changes
    // MSAA level; the pipeline and sample count are an immutable pair.
    this.isolationPipeline = this.pipeline; this.isolationSamples = this.msaaCount;
    this.uniform = d.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.handleRenderer = new HandleRenderer(d,this.uniform);
    await startup.wait(this.handleRenderer.initialize(this.format, this.msaaCount));
    this.sampler = d.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    this.nearestSampler = d.createSampler({ minFilter: 'nearest', magFilter: 'nearest' });
    this.blankTexture = d.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    d.queue.writeTexture({ texture: this.blankTexture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.blankBindGroup = this.textureBindGroup(this.blankTexture);
    this.ensureBuffers(1, 1);
    // Claim the canvas only after asynchronous initialization succeeds, so
    // failures/timeouts can still acquire a 2D context on the same surface.
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) throw new Error('The canvas could not create a WebGPU context.');
    this.resize(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1, globalThis.devicePixelRatio || 1);
    this.device.lost.then(info => { if (!this.destroyed) { this.deviceLost = true; this.last = null; this.stats.reason = info.reason; this.stats.message = `Graphics device disconnected: ${info.message || info.reason}. Reinitialize the renderer to continue.`; this.stats.backend = 'WebGPU device lost'; this.options.onStatus?.(this.stats); } });
    this.device.addEventListener('uncapturederror', event => { if (this.destroyed || this.deviceLost) return; this.stats.warnings.push(event.error.message); this.options.onStatus?.(this.stats); });
    initVfxDevice(this.device);
    // Drawing cels display from GPU-resident tiles. Failure keeps the canvas
    // scratch path, which remains the Canvas 2D and fallback presenter.
    if (this.options.gpuDrawing !== false) this.enableGpuDrawing();
  }
  /** GPU drawing compiles in the background; until it is ready, cels use the
   * scratch presenter and the stroke worker. `gpuDrawingReady` settles with
   * whether it became active. */
  enableGpuDrawing() {
    if (this.drawingGpu || this.gpuDrawingPending) return this.gpuDrawingReady;
    const pending = this.gpuDrawingPending = DrawingGpu.create(this);
    this.gpuDrawingReady = pending.then(gpu => {
      if (this.gpuDrawingPending !== pending || this.destroyed || this.deviceLost) { gpu.destroy(); return false; }
      this.gpuDrawingPending = null; this.drawingGpu = gpu; this.lastGeometry = null; this.options.onInvalidate?.(); return true;
    }, error => {
      if (this.gpuDrawingPending === pending) this.gpuDrawingPending = null;
      this.stats.warnings.push(`GPU drawing unavailable: ${error.message}`); return false;
    });
    return this.gpuDrawingReady;
  }
  createVectorPipeline(count = this.msaaCount) {
    return this.device.createRenderPipelineAsync({ label: 'StykAnimate vector + asset compositor', layout: this.pipelineLayout,
      vertex: { module: this.vectorModule, entryPoint: 'vs' }, fragment: { module: this.vectorModule, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
      primitive: { topology: 'triangle-list' }, multisample: { count },
    });
  }
  /** Lower or restore MSAA at runtime. Pipelines, handle passes, VFX targets
   * and the antialias texture all derive from msaaCount, so one rebuild keeps
   * every attachment consistent. */
  async setMsaa(count) {
    count = normalizeMsaaCount(count);
    const request = this.msaaRequest = (this.msaaRequest || 0) + 1;
    // Even a return to the active count cancels a pending quality change.
    if (this.destroyed || this.deviceLost || count === this.msaaCount) return false;
    const stale = () => this.destroyed || this.deviceLost || request !== this.msaaRequest;
    let pipeline, handles;
    try {
      [pipeline, handles] = await Promise.all([
        this.createVectorPipeline(count), this.handleRenderer.createPipeline(this.format, count),
      ]);
    } catch (error) { if (stale()) return false; throw error; }
    if (stale()) return false;
    // Compile privately, then replace every viewport pass together. Resize and
    // rendering may continue with the old resources while compilation is pending.
    const msaa = this.createMsaaTexture(this.canvas.width, this.canvas.height, count);
    this.pipeline = pipeline;
    this.handleRenderer.setPipeline(handles);
    this.msaaCount = count;
    this.msaa?.destroy(); this.msaa = msaa;
    // The VFX compositor pipeline bakes its own sample count; rebuild lazily.
    this.vfxViewport?.destroy(); this.vfxViewport = null;
    this.drawingGpu?.compileDisplay(count).then(() => this.options.onInvalidate?.(), () => {});
    this.options.onInvalidate?.();
    return true;
  }
  createMsaaTexture(width, height, count = this.msaaCount) {
    return count > 1 ? this.device.createTexture({label: `${count}× antialias canvas`, size: [width, height],
      sampleCount: count, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT}) : null;
  }
  colorAttachment(view) {
    return this.msaa
      ? { view: this.msaa.createView(), resolveTarget: view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'discard' }
      : { view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' };
  }
  textureBindGroup(texture, sampler = this.sampler) { return this.device.createBindGroup({ layout: this.textureLayout, entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: texture.createView() }] }); }
  prepareInitialScene(options) { return prepareInitialScene(this, options); }
  activatePreparedScene(prepared, options) { return activatePreparedScene(this, prepared, options); }
  useReport(report) {
    if (this.activeReport === report) return;
    if (this.activeReport) {
      this.onionComposite?.destroy(); this.onionComposite=null;
      this.stats.onionCompositeBytes=this.stats.onionCacheBytes=0;
      for (const entry of this.backgroundImages?.values() || []) entry.texture.destroy();
      for (const texture of this.drawingTextures?.values() ?? []) texture.texture.destroy();
      this.drawingTextures?.clear();
      this.backgroundImages?.clear(); this.resources.clear(); this.preparedFrames.clear();
      this.rasterCache.clear();
      this.layout = []; this.entries.clear(); this.vectorCache = new WeakMap(); this.compatibilityCache = new WeakMap();
      this.artworks.clear();
      this.artworkAliases=new WeakMap();
      this.lastGeometry = null; this.lastReport = null; this.onionScenes = [];
    }
    this.activeReport = report;
  }
  hasPreparedFrame(key) { return this.preparedFrames.has(key); }
  prepareSceneUpdate(options) { return prepareSceneUpdate(this, options); }
  backgroundAssets(report, frame) {
    return backgroundImageAssets(report, frame);
  }
  backgroundsReady(report, frame) {
    return this.backgroundAssets(report, frame).every(asset => {
      const image = this.resources.image(this.resources.url(asset));
      if (image?.complete && !image.naturalWidth) throw new Error('An animation background image could not be decoded.');
      return Boolean(image?.complete && image.naturalWidth);
    });
  }
  async prepareBackgrounds(report, frame) {
    await Promise.all(this.backgroundAssets(report, frame).map(async asset => {
      let image = this.resources.image(this.resources.url(asset));
      if (!image) throw new Error('An animation background image has no readable asset.');
      if (!image.complete) { await image.decode(); image = this.resources.image(this.resources.url(asset)); }
      if (!image.naturalWidth) throw new Error('An animation background image could not be decoded.');
    }));
  }
  prepareFrame(packet, options) { if (this.destroyed || this.deviceLost) return null; this.useReport(options.report); return this.preparedFrames.prepare(packet, options); }
  renderPrepared(key, options) {
    if (this.destroyed || this.deviceLost) return false;
    const rendered = this.preparedFrames.render(key, options);
    if (rendered) { this.last = null; this.stats.primitiveUploadCalls = 0; }
    return rendered;
  }
  renderPreparedInto(key, options) {
    if (this.destroyed || this.deviceLost) return false;
    return this.preparedFrames.renderInto(key, options);
  }
  clearPreparedFrames() { this.preparedFrames.clear(); }
  retainPreparedFrames(report, packets) { this.preparedFrames.retainPackets(report, packets); }
  ensureBuffers(shapeCount, transformCount) {
    const shapeSize = pow2(shapeCount) * SHAPE_BYTES, transformSize = pow2(transformCount) * 16;
    let changed = false;
    if (!this.shapeBuffer || this.shapeBuffer.size < shapeSize) { this.shapeBuffer?.destroy(); this.shapeBuffer = this.device.createBuffer({ label: 'Retained figure primitives', size: shapeSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }); changed = true; }
    if (!this.transformBuffer || this.transformBuffer.size < transformSize) { this.transformBuffer?.destroy(); this.transformBuffer = this.device.createBuffer({ label: 'Figure translations + visibility', size: transformSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); changed = true; }
    if (changed) this.globalBindGroup = this.device.createBindGroup({ layout: this.globalLayout, entries: [{ binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: { buffer: this.shapeBuffer } }, { binding: 2, resource: { buffer: this.transformBuffer } }] });
    return changed;
  }
  resize(width, height, dpr = 1) {
    if (this.destroyed || this.deviceLost) return;
    const backing = viewportBackingSize(width, height, dpr, this.device.limits.maxTextureDimension2D);
    ({width, height, dpr} = backing);
    const {pw, ph} = backing;
    if (this.contextConfigured && this.canvas.width === pw && this.canvas.height === ph && (this.msaa || this.msaaCount <= 1)) { this.width = width; this.height = height; this.dpr = dpr; return; }
    this.width = width; this.height = height; this.dpr = dpr; this.canvas.width = pw; this.canvas.height = ph;
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    this.contextConfigured = true;
    this.msaa?.destroy();
    this.msaa = this.createMsaaTexture(pw, ph);
  }
  rasterObject(g, items, scale, artwork = g, cache = this.rasterCache, vector = false) {
    const bounds = this.geometryBounds(g,items), max = Math.min(8192, this.device.limits.maxTextureDimension2D);
    const desired = Math.max(.5, Math.min(8, 2 ** Math.ceil(Math.log2(scale || 1))));
    const workingBudget = cache.maxBytes > 0 ? cache.maxBytes : previewMemoryPlan().editorRasters;
    const resolution = Math.min(desired * (this.previewRasterScale || 1), Math.sqrt(workingBudget / 4 / Math.max(1, bounds.width * bounds.height)));
    const drawingInputs=drawingRasterInputs(items,this.resources),contentKey=drawingRasterKey(drawingInputs);
    const cached = cache.get(artwork, resolution, this.generation,contentKey);
    if (cached) return cached;
    const previous = cache.previous(artwork);
    const reason=!previous?'uncached':previous.destroyed?'released':previous.generation!==this.generation?'generation':'resolution';
    const misses=this.stats.rasterCacheMisses??={};misses[reason]=(misses[reason]||0)+1;
    const samples=this.stats.rasterCacheMissSamples??=[];
    if(samples.length<4)samples.push({reason,resolution,previousResolution:previous?.resolution,scale});
    this.stats.rasterizedObjects = (this.stats.rasterizedObjects || 0) + 1;
    const pixelScale = vfxRasterScale(items,bounds,Math.min(resolution, max / bounds.width, max / bounds.height),max);
    const width = Math.max(1, Math.ceil(bounds.width * pixelScale)), height = Math.max(1, Math.ceil(bounds.height * pixelScale));
    const gpuVfx=this.disableVectorVfx?null:vectorVfxSource(items,pixelScale);
    if(gpuVfx&&width*height<=16777216){
      const result={...rasterizeVectorVfx(this,gpuVfx,{width,height,pixelScale,bounds,root:g.root}),bounds:{...bounds,width:width/pixelScale,height:height/pixelScale},origin:{...g.root},generation:this.generation,resolution};
      this.stats.vectorVfxObjects=(this.stats.vectorVfxObjects??0)+1;cache.set(artwork,result);return result;
    }
    if (vector && supportsVectorIsolation(items, pixelScale)) {
      const data = compileVectorObject(items, g.root, 0);
      const result = {...rasterizeVectorGroup(this, {data, width, height, pixelScale, bounds, root: g.root}),
        bounds: {...bounds, width: width / pixelScale, height: height / pixelScale}, origin: {...g.root}, generation: this.generation, resolution};
      cache.set(artwork, result); return result;
    }
    if (meshOnlyItems(items) && !items.some(hasDrawableVfx)) {
      const {cleanup, ...raster} = rasterizeMeshGroup(this, {source: meshRasterSource(items), width, height, pixelScale, bounds, label: `Mesh object ${uidOf(g)}`});
      const result = {...raster, bounds: {...bounds, width: width / pixelScale, height: height / pixelScale}, origin: {...g.root}, generation: this.generation, resolution, contentKey, drawingInputs};
      this.stats.meshObjects = (this.stats.meshObjects ?? 0) + 1; cache.set(artwork, result); return result;
    }
    const {surface, context: ctx} = this.rasterSurfaces.acquire(width, height); let texture;
    try {
      ctx.setTransform(pixelScale, 0, 0, pixelScale, -bounds.x * pixelScale, -bounds.y * pixelScale);
      drawGeometry(ctx, { drawables: items }, this.resources);
      texture = this.device.createTexture({ label: `Compatibility object ${uidOf(g)}`, size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      this.device.queue.copyExternalImageToTexture({ source: surface }, { texture, premultipliedAlpha: true }, [width, height]);
      // Include the final partially used pixel rather than squeezing its raster.
      const rasterBounds = { ...bounds, width: width / pixelScale, height: height / pixelScale };
      const result = { bounds: rasterBounds, origin: {...g.root}, texture, bindGroup: this.textureBindGroup(texture), generation: this.generation, resolution, contentKey, drawingInputs, bytes: width * height * 4 };
      cache.set(artwork, result); return result;
    } catch (error) { texture?.destroy(); throw error; }
    finally { this.rasterSurfaces.release(); }
  }
  geometryBounds(g,items) {
    this.boundsCache??=new WeakMap();
    let entry=this.boundsCache.get(g);
    if(!entry||entry.items!==items||entry.generation!==this.generation){
      entry={items,generation:this.generation,bounds:objectBounds(items,this.resources)};
      this.boundsCache.set(g,entry);
    }
    return entry.bounds;
  }
  // A failed raster must not abort the whole scene build: reuse the slot's or
  // the artwork's previous texture, else the caller degrades to vector shapes.
  // The error still reaches telemetry through the microtask, deduped there.
  rasterFallback(error, artwork, prior) {
    if (error?.name === 'AbortError') throw error;
    this.stats.rasterFailures = (this.stats.rasterFailures || 0) + 1;
    this.stats.lastRasterError = error?.message || String(error);
    if (typeof window !== 'undefined') queueMicrotask(() => { throw error; });
    const candidates = [prior?.texture, this.rasterCache.previous(artwork)];
    return candidates.find(record => record && !record.destroyed) || null;
  }
  glyphTexture(glyph) {
    const cached=this.rasterCache.get(glyph.mask,glyph.variant,this.generation);
    if(cached)return cached;
    const {surface,context}=this.rasterSurfaces.acquire(glyph.width,glyph.height);let texture;
    try {
      drawGlyphMask(context,glyph);
      texture=this.device.createTexture({label:'Shared glyph mask',size:[glyph.width,glyph.height],format:'rgba8unorm',
        usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
      this.device.queue.copyExternalImageToTexture({source:surface},{texture,premultipliedAlpha:true},[glyph.width,glyph.height]);
      const result={texture,bindGroup:this.textureBindGroup(texture),generation:this.generation,resolution:glyph.variant,bytes:glyph.bytes};
      this.rasterCache.set(glyph.mask,result);this.stats.rasterizedObjects=(this.stats.rasterizedObjects||0)+1;return result;
    } catch(error){texture?.destroy();throw error;} finally {this.rasterSurfaces.release();}
  }
  // Descriptors defer GPU allocation so prepared frames can admit backgrounds
  // into their own bounded cache. Editable/staged layouts own separate textures.
  backgroundTexture(descriptor) {
    this.backgroundImages ??= new Map();
    const prior = this.backgroundImages.get(descriptor.key);
    if (prior && prior.signature === descriptor.signature) return prior;
    const resource = {...descriptor.create(), signature: descriptor.signature};
    this.backgroundImages.set(descriptor.key, resource);
    prior?.texture.destroy();
    return resource;
  }
  uploadBackground(source, width, height, label) {
    const texture = this.device.createTexture({label, size: [width, height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT});
    try {
      this.device.queue.copyExternalImageToTexture({source}, {texture, premultipliedAlpha: true}, [width, height]);
      return {texture, bindGroup: this.textureBindGroup(texture, this.nearestSampler), bytes: width * height * 4};
    } catch (error) {texture.destroy(); throw error;}
  }
  background(options, resolveTexture = descriptor => this.backgroundTexture(descriptor)) {
    const { report, frame } = options, w = report.canvas_width, h = report.canvas_height;
    const bounds = backgroundBounds(frame, w, h, options.cameraEnabled !== false, report), output = [];
    const override = editorBackgroundColor(options) ?? sceneBackgroundColor(report, frame);
    if (override !== undefined) return [{data: new Float32Array(shapeRecord({
      a: [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height],
      color: argbFloats(override), mode: SHAPE.RECT, clipToCanvas: true,
    })), texture: null}];
    const layer = (id, alpha = 1) => {
      const bg = report.backgrounds?.find(b => Number(b.background_id) === Number(id));
      const a = [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height];
      let color = argbFloats(bg?.color ?? 0xffffffff), color2 = color, gradient = [0, 0, 0, 0], mode = SHAPE.RECT;
      if (bg?.paint) {
        const signature = JSON.stringify([bg.paint, bounds, w, h]);
        const scale = Math.min(2, 2048 / Math.max(bounds.width, bounds.height));
        const cw = Math.max(1, Math.ceil(bounds.width * scale)), ch = Math.max(1, Math.ceil(bounds.height * scale));
        const cached = resolveTexture({key: bg, cacheKey: `background-paint:${signature}`, signature, bytes: cw * ch * 4,
          create: () => {
            const canvas = new OffscreenCanvas(cw, ch), ctx = canvas.getContext('2d');
            ctx.scale(scale, scale); ctx.translate(-bounds.x, -bounds.y);
            ctx.fillStyle = canvasPaint(ctx, bg.paint, {x: 0, y: h / 2}, {x: w, y: h / 2}, c => c, bounds);
            ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
            return this.uploadBackground(canvas, cw, ch, 'Background paint');
          }});
        output.push({data:new Float32Array(shapeRecord({a,mode:SHAPE.TEXTURE,color:[1,1,1,alpha],clipToCanvas:true})),texture:cached});return;
      }
      if (bg?.kind === 3) {
        color = argbFloats(bg.color_a); color2 = argbFloats(bg.color_b);
        const dx = (bg.x2 - bg.x1) * w, dy = (bg.y2 - bg.y1) * h, norm = dx * dx + dy * dy || 1;
        gradient = [bg.x1 * w, bg.y1 * h, dx / norm, dy / norm];
      } else if (bg?.kind === 4) {
        color = argbFloats(bg.color_b); color2 = argbFloats(bg.color_a); mode = SHAPE.RADIAL_RECT;
        const outer = bg.y2 * h; gradient = [bg.x1 * w, bg.y1 * h, Math.min(Math.max(0, bg.x2 * h), .99 * outer), Math.max(.0001, outer)];
        if (outer <= 0) { color = color2; mode = SHAPE.RECT; }
      } else if (bg && bg.kind !== 2 && bg.color === undefined) {
        const image = this.resources.image(this.resources.url(bg));
        if (!image?.complete || !image.naturalWidth) return;
        const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
        const cached = resolveTexture({key: image, cacheKey: image, bytes: width * height * 4,
          create: () => this.uploadBackground(image, width, height, 'Imported background asset')});
        const ratio = Math.max(w / image.naturalWidth, h / image.naturalHeight);
        output.push({ data: new Float32Array(shapeRecord({ a, mode: SHAPE.BACKGROUND_IMAGE,
          gradient: [0, 0, 1 / (image.naturalWidth * ratio), 1 / (image.naturalHeight * ratio)],
          color: [1, 1, 1, alpha], clipToCanvas: true })), texture: cached }); return;
      }
      color = [...color]; color2 = [...color2]; color[3] *= alpha; color2[3] *= alpha;
      output.push({ data: new Float32Array(shapeRecord({ a, mode, color, color2, gradient, clipToCanvas: true })), texture: null });
    };
    layer(frame.background_id); if (frame.background_mix) layer(frame.background_id_b, frame.background_mix / 255);
    return output;
  }
  objectEntry(g, items, opacity, key, index, scale, isOnion = false) {
    const steps=this.objectEntrySteps(g,items,opacity,key,index,scale,isOnion);
    for(;;){const step=steps.next();if(step.done)return step.value;}
  }
  *objectEntrySteps(g, items, opacity, key, index, scale, isOnion = false) {
    const artworkView = opacityArtwork(g,items);
    const {source,items:sourceItems} = artworkView;
    const uid = uidOf(g), prior = this.entries.get(key); let data, texture;
    const drawingMeta=sourceItems.length===1&&!isOnion?drawingMetadata(sourceItems[0].fig):null;
    const drawing=drawingMeta&&this.resources.drawing?.(sourceItems[0].fig);
    const drawingState=drawing?{drawing,drawingItems:items,drawingStamp:drawing.stamp,drawingCamera:this.activeCamera,drawingWidth:this.width,drawingHeight:this.height}:{};
    if(drawing&&this.drawingGpu&&!this.drawingGpu.destroyed&&(drawing.store||drawingMeta.version===2)&&gpuDrawingEligible(drawing,sourceItems[0])){
      // Tiles are resolved per frame in render(); the retained shape slot stays disabled.
      const item=sourceItems[0],matrix=drawingPixelMatrix(item),data=prior?.gpuDrawing&&prior.transform===index?prior.data:new Float32Array(shapeRecord({mode:SHAPE.DISABLED,transform:index}));
      return {...drawingState,key,uid,g,source,opacity,artworkOpacity:artworkView.opacity,isOnion,root:g.root,transform:index,data,count:data.length/SHAPE_FLOATS,texture:null,
        gpuDrawing:{absolute:matrix,matrix:[matrix[0],matrix[1],matrix[2],matrix[3],matrix[4]-source.root.x,matrix[5]-source.root.y],alpha:drawingAlpha(item)}};
    }
    if(drawing&&!drawing.store&&drawingMeta.version===2&&!hasDrawableVfx(sourceItems[0])){
      // An evicted v2 store re-decodes via the presenter; keep the last
      // retained texture until then and never fall back to the stale
      // published placeholder. v1 keeps the generic path below: its data URL
      // is the real PNG.
      const retained=prior?.texture?.drawing===drawing?prior:null;
      const data=retained?retained.data:new Float32Array(shapeRecord({mode:SHAPE.DISABLED,transform:index}));
      return {...drawingState,key,uid,g,source,opacity,artworkOpacity:artworkView.opacity,isOnion,root:g.root,transform:index,data,count:data.length/SHAPE_FLOATS,texture:retained?.texture??null};
    }
    if(drawing?.store&&!hasDrawableVfx(sourceItems[0])) {
      // Tile coverage widens in O(1) while painting; alpha bounds would rescan.
      const item=sourceItems[0],matrix=drawingPixelMatrix(item),bounds=drawing.store.tileBounds;
      // Visible pixel rect: viewport → world → cel pixel space.
      let rect=bounds?{...bounds}:null,cam=this.activeCamera;
      if(cam&&rect){
        const cd=cam[0]*cam[3]-cam[1]*cam[2],md=matrix[0]*matrix[3]-matrix[1]*matrix[2];
        if(Math.abs(cd)>1e-12&&Math.abs(md)>1e-12){
          const toWorld=p=>({x:(cam[3]*(p.x-cam[4])-cam[2]*(p.y-cam[5]))/cd,y:(cam[0]*(p.y-cam[5])-cam[1]*(p.x-cam[4]))/cd});
          const toPixel=p=>({x:(matrix[3]*(p.x-matrix[4])-matrix[2]*(p.y-matrix[5]))/md,y:(matrix[0]*(p.y-matrix[5])-matrix[1]*(p.x-matrix[4]))/md});
          const ps=[[0,0],[this.width,0],[this.width,this.height],[0,this.height]].map(([x,y])=>toPixel(toWorld({x,y})));
          const vx=Math.min(...ps.map(p=>p.x)),vy=Math.min(...ps.map(p=>p.y)),vx1=Math.max(...ps.map(p=>p.x)),vy1=Math.max(...ps.map(p=>p.y));
          rect={x:Math.max(rect.x,vx),y:Math.max(rect.y,vy),width:Math.min(rect.x+rect.width,vx1)-Math.max(rect.x,vx),height:Math.min(rect.y+rect.height,vy1)-Math.max(rect.y,vy)};
          if(rect.width<=0||rect.height<=0)rect=null;
        }
      }
      // Mip level from screen pixels per source pixel: at deviceScale < 1 a
      // downsampled level keeps the scratch inside the texture-size limit.
      // Levels escalate to 8 (256x) so even a drawing spanning megapixels of
      // coverage fits; `clamp` then guarantees a scratch by trimming the
      // painted band to the texture limit around the visible span. A drawing
      // is never rejected for size — rejection would blank the whole frame.
      const maxSide=this.device.limits.maxTextureDimension2D;
      const deviceScale=Math.max(1e-9,scale*Math.hypot(matrix[0],matrix[1]));
      let scratch=null,level=Math.max(0,Math.min(8,Math.floor(-Math.log2(deviceScale))));
      for(;rect&&level<=8;level++){
        const result=drawing.scratch?.(rect,{level,maxSide});
        if(result){scratch=result;break;}
      }
      if(rect&&!scratch){level=8;scratch=drawing.scratch?.(rect,{level,maxSide,clamp:true});}
      if(!scratch){
        // Only a visible, nonempty cover can be waiting for its next preview.
        // An empty or offscreen store must stop displaying the prior texture.
        if(rect&&drawing.owner?.previews&&prior?.drawing===drawing&&prior.texture)return {...prior,...drawingState};
        const data=new Float32Array(shapeRecord({mode:SHAPE.DISABLED,transform:index}));
        return {...drawingState,key,uid,g,source,opacity,artworkOpacity:artworkView.opacity,isOnion,root:g.root,transform:index,data,count:data.length/SHAPE_FLOATS,texture:null};
      }
      if(scratch){
        // Textures key to the scratch anchor, not just the cel: alternating
        // anchors keep independent canvases AND textures, so a deferred
        // upload can never read a canvas repainted for another anchor.
        this.drawingTextures??=new Map();
        const textureKey=`${drawing.id}|${scratch.anchorKey}`;texture=this.drawingTextures.get(textureKey);
        const w=scratch.canvas.width,h=scratch.canvas.height,rectKey=`${level}:${scratch.x},${scratch.y},${w},${h}`;
        if(!texture||texture.width!==w||texture.height!==h){
          texture?.texture.destroy();
          const gpu=this.device.createTexture({size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
          texture={texture:gpu,bindGroup:this.textureBindGroup(gpu),width:w,height:h,stamp:-1,rectKey:null,bytes:w*h*4};
        }
        // Most-recently-used ordering: the render loop evicts from the front.
        this.drawingTextures.delete(textureKey);this.drawingTextures.set(textureKey,texture);
        texture.drawing=drawing;texture.canvas=scratch.canvas;texture.dirty=scratch.dirty;texture.nextStamp=scratch.stamp;texture.nextRectKey=rectKey;
        const q=scratch.scale,ox=matrix[0]*scratch.x*q+matrix[2]*scratch.y*q+matrix[4],oy=matrix[1]*scratch.x*q+matrix[3]*scratch.y*q+matrix[5];
        data=new Float32Array(shapeRecord({a:[ox-source.root.x,oy-source.root.y,0,0],b:[matrix[0]*scratch.width*q,matrix[1]*scratch.width*q,matrix[2]*scratch.height*q,matrix[3]*scratch.height*q],mode:9,color:[1,1,1,drawingAlpha(sourceItems[0])],transform:index}));
        return {...drawingState,key,uid,g,source,opacity,artworkOpacity:artworkView.opacity,isOnion,root:g.root,transform:index,data,count:1,texture};
      }
    }
    let compatibility = this.compatibilityCache.get(source);
    if (compatibility === undefined) { compatibility = artworkView.isolated || requiresCompatibilityTexture(sourceItems); this.compatibilityCache.set(source, compatibility); }
    const desired=Math.max(.5,Math.min(8,2**Math.ceil(Math.log2(scale||1))))*(this.previewRasterScale||1);
    const glyph=this.options.sharedArtwork!==false && glyphTextureDescriptor(sourceItems,desired);
    if (glyph) {
      try { texture=this.glyphTexture(glyph); } catch (error) { texture=this.rasterFallback(error, glyph.mask, prior); }
      if (texture) { this.rasterLease?.add(texture); data=glyphTextureShape(glyph,source.root,index); }
    } else if (compatibility) {
      const artwork=this.artworkAliases.get(source) ?? (this.options.sharedArtwork===false||this.liveEditing?source:yield* this.artworks.getSteps(source,sourceItems));
      this.artworkAliases.set(g,artwork);
      try { texture = this.rasterObject(source, sourceItems, scale, artwork, this.rasterCache,
        this.options.gpuIsolation !== false && artworkView.isolated && supportsVectorIsolation(sourceItems, desired)); }
      catch (error) { texture = this.rasterFallback(error, artwork, prior); }
      if (texture) this.rasterLease?.add(texture);
      if (prior?.transform === index && prior.texture === texture) data = prior.data;
      else if (texture) { const b = texture.bounds, origin=texture.origin; data = new Float32Array(shapeRecord({ a: [b.x - origin.x, b.y - origin.y, b.x + b.width - origin.x, b.y + b.height - origin.y], color: [1, 1, 1, 1], mode: SHAPE.TEXTURE, transform: index })); }
    }
    if (!data) {
      let compiled = this.vectorCache.get(source);
      if (!compiled) { compiled = yield* compileVectorObjectSteps(sourceItems, source.root); this.vectorCache.set(source, compiled); this.stats.compiledObjects++; }
      // A textured prior's data is a TEXTURE shape; it is only reusable while the
      // entry still presents that texture. A staged layout also shares the data
      // of the layout it will replace; publication copies it on the GPU.
      const reusable = prior ?? this.predecessor?.entries.get(key);
      if (reusable?.source === source && reusable.transform === index && !reusable.drawing && !reusable.gpuDrawing && (!reusable.texture || reusable.texture === texture)) data = reusable.data;
      else { data = compiled.slice(); for (let j = 21; j < data.length; j += SHAPE_FLOATS) data[j] = index; }
    }
    return { key, uid, g, source, opacity, artworkOpacity:artworkView.opacity, isOnion, root: g.root, transform: index, data, count: data.length / SHAPE_FLOATS, texture };
  }
  /** Fill the entries a staged layout shares with `from`, the layout it
   * replaces: a GPU copy of the published primitives, or an upload when that
   * entry has changed since. Runs before `from` releases its buffer. */
  copySharedEntries(from) {
    const shared = this.sharedEntries; this.sharedEntries = null; this.stats.copiedBytes = 0;
    if (!shared) return;
    const published = new Map(from.layout?.map(entry => [entry.data, entry])); let encoder = null;
    for (const entry of shared) {
      const source = published.get(entry.data);
      if (from.shapeBuffer && source?.capacity >= entry.capacity) {
        // The published range holds the same data padded with disabled records.
        (encoder ??= this.device.createCommandEncoder()).copyBufferToBuffer(from.shapeBuffer, source.offset * SHAPE_BYTES, this.shapeBuffer, entry.offset * SHAPE_BYTES, entry.capacity * SHAPE_BYTES);
        this.stats.copiedBytes += entry.capacity * SHAPE_BYTES;
      } else { this.stats.uploadBytes += this.uploadEntry(entry); this.stats.primitiveUploadCalls++; }
    }
    if (encoder) this.device.queue.submit([encoder.finish()]);
  }
  uploadEntry(entry) {
    const padded = new Float32Array(entry.capacity * SHAPE_FLOATS); padded.set(entry.data);
    for (let j = entry.count; j < entry.capacity; j++) padded[j * SHAPE_FLOATS + 20] = SHAPE.DISABLED;
    this.device.queue.writeBuffer(this.shapeBuffer, entry.offset * SHAPE_BYTES, padded);
    return padded.byteLength;
  }
  updateGeometry(options, geometry) {
    const old = this.lastGeometry;
    if (!geometry.changedSlots || !old?.token || geometry.previousToken !== old.token || !this.entriesBySlot) return false;
    const ordered = geometry.orderedObjects, before = old.orderedObjects;
    if (!ordered || ordered.length !== before?.length || ordered.some((g, i) => g.slot !== before[i].slot || uidOf(g) !== uidOf(before[i]))) return false;
    const matrix = cameraMatrix(options), scale = Math.hypot(matrix[0], matrix[1]) * this.dpr, updates = [];
    this.activeCamera = matrix;
    this.artworks.begin(options.artworkRevision);
    this.stats.compiledObjects = 0; this.stats.rasterizedObjects = 0;
    for (const slot of geometry.changedSlots) {
      const g = geometry.objects.get(slot), previous = this.entriesBySlot.get(slot);
      if (!g?.drawables?.length && !previous) continue;
      if (!g || !previous) return false;
      const entry = this.objectEntry(g, g.drawables, previous.opacity, previous.key, previous.transform, scale);
      if (entry.count > previous.capacity) return false;
      entry.capacity = previous.capacity; entry.offset = previous.offset;
      updates.push({ previous, entry });
    }
    const replacements = new Map(updates.map(({previous, entry}) => [previous, entry]));
    const textures = new Set(this.layout.map(entry => (replacements.get(entry) || entry).texture).filter(Boolean));
    if ([...textures].reduce((sum, texture) => sum + (texture.bytes || 0), 0) > (this.rasterCache.maxBytes || previewMemoryPlan().editorRasters)) return false;
    let uploadBytes = 0, primitiveUploadCalls = 0;
    for (const { previous, entry } of updates) {
      if (entry.data !== previous.data) { uploadBytes += this.uploadEntry(entry); primitiveUploadCalls++; }
      this.stats.primitives += entry.count - previous.count;
      this.stats.textureObjects += Number(!!entry.texture) - Number(!!previous.texture);
      this.stats.gpuBytes += (entry.texture?.bytes || 0) - (previous.texture?.bytes || 0);
      // Retain layout/command references, replacing only the changed object's fields.
      Object.assign(previous, entry);
    }
    this.lastGeometry = geometry;
    this.artworkStats();
    Object.assign(this.stats, { uploadBytes, primitiveUploadCalls, updatedObjects: updates.length, cachedObjects: ordered.length - updates.length,
      preparation: 'incremental', warnings: geometry.warnings || [] });
    return true;
  }
  /** Drawing pixels change without a geometry change (a stroke in progress, a
   * decode landing) and panning moves which of their tiles are visible: re-run
   * just those drawing entries, so their scratch canvases repaint the changed
   * tiles and their textures upload only the dirty region, instead of
   * rebuilding the scene. Returns false when an entry outgrew its slot. */
  refreshDrawings(options) {
    if (!this.layout) return true;
    const matrix = cameraMatrix(options), scale = Math.hypot(matrix[0], matrix[1]) * this.dpr;
    const viewKey = `${matrix.join()}|${this.width}|${this.height}|${this.dpr}`, moved = viewKey !== this.drawingViewKey;
    this.drawingViewKey = viewKey;
    let refreshed = 0, uploadBytes = 0;
    for (const previous of this.layout) {
      if(changedDrawingRaster(previous.texture?.drawingInputs))return false;
      const drawing = previous.drawing;
      if (!drawing || !previous.g || (!moved && previous.drawingStamp === drawing.stamp)) continue;
      this.activeCamera = matrix;
      const entry = this.objectEntry(previous.g, previous.drawingItems, previous.opacity, previous.key, previous.transform, scale, previous.isOnion);
      if (entry.count > previous.capacity) return false;
      entry.capacity = previous.capacity; entry.offset = previous.offset;
      if (entry.data !== previous.data) uploadBytes += this.uploadEntry(entry);
      Object.assign(previous, entry); refreshed++;
    }
    if (refreshed) { this.stats.updatedObjects = refreshed; this.stats.uploadBytes += uploadBytes; this.stats.preparation = 'drawing'; }
    return true;
  }
  prepare(options, geometry) {
    const steps = this.prepareSteps(options, geometry);
    for (;;) { const step = steps.next(); if (step.done) return step.value; }
  }
  *prepareSteps(options, geometry) {
    geometry=options.vfxEnabled===false?vfxPreviewGeometry(geometry):connectedVfxGeometry(geometry,options.frame,options.report,options.hiddenUids);
    this.artworks.begin(options.artworkRevision);
    const matrix = cameraMatrix(options), scale = Math.hypot(matrix[0], matrix[1]) * this.dpr, next = [];
    this.activeCamera = matrix;
    this.stats.compiledObjects = 0; this.stats.rasterizedObjects = 0;
    const reuseOnions = this.lastGeneration === this.generation && (this.lastGeometry === geometry || geometry.previousToken === this.lastGeometry?.token);
    const previousOnions = reuseOnions ? this.onionScenes || [] : [], onionScenes = [];
    for (const [i, onion] of (options.onionFrames || []).entries()) {
      const frame = onion.frame || onion;
      const scene = onion.geometry || previousOnions.find(cached => cached.frame === frame)?.geometry || (yield* buildGeometrySteps(options.report, frame));
      onionScenes.push({frame, geometry: options.vfxEnabled===false?vfxPreviewGeometry(scene):connectedVfxGeometry(scene,frame,options.report,options.hiddenUids), opacity: onion.opacity, beforeUid: onion.beforeUid, showOnTop: onion.showOnTop});
    }
    this.onionScenes = onionScenes;
    const groups = composeSceneGroups(geometry, onionScenes, options.frame);
    // Plan the complete next set before allocating it. Aliases count repeated
    // artwork once; lower raster detail leaves editable vector geometry intact.
    const uniqueArtwork = new Set(), texturePlans = [];
    const desiredResolution = Math.max(.5, Math.min(8, 2 ** Math.ceil(Math.log2(scale || 1))));
    for (const {g, items, isOnion} of groups) {
      const artworkView = opacityArtwork(g,items), {source,items:sourceItems} = artworkView;
      let compatibility = this.compatibilityCache.get(source);
      if (compatibility === undefined) {compatibility = artworkView.isolated || requiresCompatibilityTexture(sourceItems); this.compatibilityCache.set(source, compatibility);}
      if (!compatibility) continue;
      // Live drawing cels present through their tile presenter. Hashing their
      // published tile blob as shared artwork would stall every relayout.
      if (this.liveDrawing(sourceItems, isOnion)) continue;
      const glyph=this.options.sharedArtwork!==false && glyphTextureDescriptor(sourceItems,desiredResolution);
      if(glyph){texturePlans.push({items:sourceItems});yield {phase:'Preview memory',completed:texturePlans.length,total:groups.length};continue;}
      const artwork = this.artworkAliases.get(source) ?? (this.options.sharedArtwork === false || this.liveEditing ? source : yield* this.artworks.getSteps(source, sourceItems));
      this.artworkAliases.set(source, artwork);
      if (uniqueArtwork.has(artwork)) continue; uniqueArtwork.add(artwork);
      texturePlans.push({items:sourceItems,bounds:this.geometryBounds(source,sourceItems)});
      yield {phase: 'Preview memory', completed: uniqueArtwork.size, total: groups.length};
    }
    const bytesAt = scale => {
      const masks=new Set();let bytes=0;
      for(const {items,bounds} of texturePlans){
        const glyph=this.options.sharedArtwork!==false&&glyphTextureDescriptor(items,desiredResolution*scale);
        if(glyph){
          const key=`${glyph.mask.id}:${glyph.variant}`;
          if(!masks.has(key)){masks.add(key);bytes+=glyph.bytes;}
        } else {
          const ratio=Math.min(desiredResolution*scale,4096/bounds.width,4096/bounds.height);
          bytes+=Math.max(1,Math.ceil(bounds.width*ratio))*Math.max(1,Math.ceil(bounds.height*ratio))*4;
        }
      }
      return bytes;
    };
    this.previewRasterScale = 1;
    const workingBudget = this.rasterCache.maxBytes || previewMemoryPlan().editorRasters;
    while (bytesAt(this.previewRasterScale) > workingBudget * .95 && this.previewRasterScale > 1 / 65536) this.previewRasterScale /= 2;
    this.stats.previewReduced = this.previewRasterScale < 1;
    let index = 1, shapeCount = 0, compatibilityCount = 0, cached = 0;
    for (const bg of this.background(options)) { next.push({ key: `background-${next.length}`, transform: 0, root: { x: 0, y: 0 }, count: bg.data.length / SHAPE_FLOATS, data: bg.data, texture: bg.texture }); }
    for (const { g, items, opacity, key, isOnion, onionIndex } of groups) {
      if (this.vectorCache.has(g)) cached++;
      const entry = yield* this.objectEntrySteps(g, items, isOnion ? 1 : opacity, key, index++, scale, isOnion);
      if(isOnion)entry.onionIndex=onionIndex;
      if (entry.texture) compatibilityCount++;
      next.push(entry);
      yield {phase: 'GPU primitives', completed: index - 1, total: groups.length};
    }
    let relayout = this.layout?.length !== next.length;
    for (let i = 0; i < next.length; i++) {
      const entry = next[i], previous = this.layout?.[i];
      entry.capacity = previous?.key === entry.key && previous.capacity >= entry.count ? previous.capacity : pow2(entry.count);
      entry.offset = shapeCount; shapeCount += entry.capacity;
      if (previous?.key !== entry.key || previous.capacity !== entry.capacity || previous.offset !== entry.offset) relayout = true;
    }
    if (this.ensureBuffers(shapeCount, index)) relayout = true;
    let uploadBytes = 0, primitiveUploadCalls = 0;
    // Entries unchanged from the predecessor's layout are copied from its
    // buffer when this stage is published instead of uploaded again.
    const shared = new Set(), predecessor = this.predecessor;
    if (relayout) {
      this.uploadStaging ??= new Float32Array(SHAPE_UPLOAD_RECORDS * SHAPE_FLOATS);
      const skip = predecessor && (entry => predecessor.entries.get(entry.key)?.data === entry.data && Boolean(shared.add(entry)));
      const uploaded = yield* uploadShapeLayoutSteps(this.device.queue, this.shapeBuffer, next, this.uploadStaging, skip);
      uploadBytes = uploaded.bytes; primitiveUploadCalls = uploaded.calls;
    } else {
      for (let i = 0; i < next.length; i++) {
        const entry = next[i], previous = this.layout?.[i];
        if (previous?.data !== entry.data) { uploadBytes += this.uploadEntry(entry); primitiveUploadCalls++; yield {phase: 'GPU upload', completed: i + 1, total: next.length}; }
        else if (this.sharedEntries?.has(previous)) shared.add(entry);
      }
    }
    this.sharedEntries = shared.size ? shared : null;
    this.layout = next; this.entries = new Map(next.filter(e => e.g).map(e => [e.key, e])); this.transformData = new Float32Array(index * 4);
    this.entriesBySlot = new Map(next.filter(e => e.g && e.key === e.uid).map(e => [e.g.slot, e]));
    this.transformData.set([0, 0, 1, 1]);
    this.shapeCount = shapeCount; this.lastGeometry = geometry; this.lastGeneration = this.generation;
    this.drawingViewKey = `${matrix.join()}|${this.width}|${this.height}|${this.dpr}`;
    this.stats.uploadBytes = uploadBytes; this.stats.primitiveUploadCalls = primitiveUploadCalls; this.stats.primitives = next.reduce((n, e) => n + e.count, 0); this.stats.objects = geometry.objects.size; this.stats.textureObjects = compatibilityCount; this.stats.cachedObjects = cached;
    this.artworkStats();
    this.stats.warnings = geometry.warnings || [];
    this.stats.preparation = 'layout'; this.stats.updatedObjects = groups.length;
  }
  artworkStats(){
    this.rasterCache.retain(new Set(this.layout?.filter(entry=>entry.g).map(entry=>entry.texture).filter(Boolean)), this.generation);
    this.stats.editorRasterCache={...this.rasterCache.stats};
    const textures=new Set(this.layout?.map(entry=>entry.texture).filter(Boolean));
    this.stats.gpuBytes=(this.shapeBuffer?.size||0)+(this.transformBuffer?.size||0)+this.rasterCache.bytes+[...(this.drawingTextures?.values()??[])].reduce((n,t)=>n+t.bytes,0);
    this.stats.uniqueTextures=textures.size;
    this.stats.sharedArtwork={...this.artworks.stats,entries:this.artworks.lru.size,bytes:this.artworks.bytes,definitionBytes:this.artworks.definitionBytes};
  }
  render(options) {
    if (this.destroyed || this.deviceLost) return;
    options=vfxPreviewOptions(options);
    if(options.vfxEnabled!==false&&options.frame&&options.report)options={...options,geometry:connectedVfxGeometry(options.geometry||buildGeometry(options.report,options.frame),options.frame,options.report,options.hiddenUids)};
    this.stats.rasterCacheMisses={};this.stats.rasterCacheMissSamples=[];
    this.liveEditing=Boolean(options.liveEditing);
    this.last = options.preparedPacket ? {...options, preparedPacket: undefined} : options; const start = performance.now();
    const { report, frame, view = {}, hiddenUids, dragTranslations } = options;
    if (!report || !frame) return;
    this.useReport(report);
    let measureAt=this.measureFrame?performance.now():0;
    const geometry = options.geometry || (options.vfxEnabled===false?vfxPreviewGeometry(buildGeometry(report,frame)):buildGeometry(report, frame));
    if(this.measureFrame){this.telemetryStages={geometry:performance.now()-measureAt};measureAt=performance.now();}
    this.stats.adoptedObjects = 0; this.stats.adoptedVectorBytes = 0;
    if (options.preparedPacket && (this.lastAdoptionToken !== geometry.token || this.lastAdoptionKey !== options.preparedPacket.key)) {
      const adopted = adoptPreparedVectors(options.preparedPacket, geometry, this.vectorCache, this.compatibilityCache);
      this.stats.adoptedObjects = adopted.objects; this.stats.adoptedVectorBytes = adopted.bytes;
      this.lastAdoptionToken = geometry.token; this.lastAdoptionKey = options.preparedPacket.key;
    }
    // Geometry identity is stable during view changes and direct object translation.
    const backgroundKey = JSON.stringify([frame.background_id, frame.background_id_b, frame.background_mix, editorBackgroundColor(options) ?? sceneBackgroundColor(report, frame), effectiveCamera(report, frame, options.cameraEnabled !== false)]);
    const onionFrames = options.onionFrames || [], onionChanged = this.onionFrameRefs?.length !== onionFrames.length || onionFrames.some((frame, i) => frame !== this.onionFrameRefs?.[i]);
    const camera = cameraMatrix(options), rasterResolution = Math.max(.5, Math.min(8, 2 ** Math.ceil(Math.log2(Math.hypot(camera[0], camera[1]) * this.dpr))));
    if (this.lastGeometry !== geometry || this.lastReport !== report || this.lastGeneration !== this.generation || this.backgroundKey !== backgroundKey || onionChanged || (this.stats.textureObjects && this.lastRasterResolution !== rasterResolution)) {
      const canUpdate = this.lastReport === report && this.lastGeneration === this.generation && this.backgroundKey === backgroundKey && !onionChanged && (!this.stats.textureObjects || this.lastRasterResolution === rasterResolution);
      // A failed build leaves the previous layout intact; drawing it beats
      // retrying the same doomed work every frame. Retry when the inputs
      // change, or after a pause for transient failures.
      const failed = this.prepareFailure;
      if (failed?.geometry === geometry && failed.generation === this.generation && failed.backgroundKey === backgroundKey && failed.rasterResolution === rasterResolution && performance.now() - failed.at < 1500) this.stats.preparation = 'failed';
      else {
        try {
          if (!canUpdate || !this.updateGeometry(options, geometry)) this.prepare(options, geometry);
          this.prepareFailure = null;
          this.lastReport = report; this.backgroundKey = backgroundKey; this.onionFrameRefs = [...onionFrames]; this.lastRasterResolution = rasterResolution;
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          this.prepareFailure = { geometry, generation: this.generation, backgroundKey, rasterResolution, at: performance.now() };
          this.stats.prepareFailures = (this.stats.prepareFailures || 0) + 1;
          this.stats.lastPrepareError = error?.message || String(error);
          this.stats.preparation = 'failed';
          if (typeof window !== 'undefined') queueMicrotask(() => { throw error; });
        }
      }
    } else {
      this.stats.uploadBytes = 0; this.stats.primitiveUploadCalls = 0; this.stats.updatedObjects = 0; this.stats.compiledObjects = 0; this.stats.rasterizedObjects = 0; this.stats.preparation = 'retained';
      try { if (!this.refreshDrawings(options)) this.prepare(options, geometry); }
      catch (error) {
        if (error?.name === 'AbortError') throw error;
        this.stats.lastPrepareError = error?.message || String(error);
        if (typeof window !== 'undefined') queueMicrotask(() => { throw error; });
      }
    }
    if (!this.layout) return geometry; // No build has ever succeeded; the canvas keeps its last frame.
    const liveTextures=new Set(this.layout.map(entry=>entry.texture));
    let drawingGpuBytes=0;
    for(const [id,texture] of this.drawingTextures??[]){
      const drawing=texture.drawing;
      drawingGpuBytes+=texture.bytes;
      if(!liveTextures.has(texture)||!drawing)continue;
      if(texture.stamp===texture.nextStamp&&texture.rectKey===texture.nextRectKey)continue;
      const canvas=texture.canvas;if(!canvas?.width||!canvas.height)continue;
      // A re-anchored scratch was repainted wholesale; only same-rect updates
      // can ship the dirty subregion.
      const dirty=texture.stamp<0||texture.rectKey!==texture.nextRectKey?null:texture.dirty;
      const r=dirty?{x:dirty.x,y:dirty.y,width:dirty.width,height:dirty.height}:{x:0,y:0,width:canvas.width,height:canvas.height};
      if(r.width>0&&r.height>0)this.device.queue.copyExternalImageToTexture({source:canvas,origin:[r.x,r.y]},{texture:texture.texture,origin:[r.x,r.y],premultipliedAlpha:true},[r.width,r.height]);
      texture.stamp=texture.nextStamp;texture.rectKey=texture.nextRectKey;
      drawing.presentedStamp=Math.max(drawing.presentedStamp??-1,texture.stamp);
    }
    // Retain textures past their layout slot; evict least-recently-used only
    // when the drawing texture budget is exceeded (Map order is MRU-last).
    if(drawingGpuBytes>this.drawingTextureBudget){
      for(const [id,texture] of this.drawingTextures){
        if(drawingGpuBytes<=this.drawingTextureBudget)break;
        if(liveTextures.has(texture))continue;
        texture.texture.destroy();this.drawingTextures.delete(id);drawingGpuBytes-=texture.bytes;
      }
    }
    const drawingGpu=this.drawingGpu;
    if(drawingGpu&&!drawingGpu.destroyed){
      drawingGpu.beginFrame();
      for(const entry of this.layout)entry.gpuDraw=entry.gpuDrawing?drawingGpu.prepare(entry.drawing,this.gpuDrawingView(entry,camera)):null;
      drawingGpuBytes+=drawingGpu.bytes;this.stats.drawingGpu={...drawingGpu.stats};
    }
    this.stats.drawingGpuBytes=drawingGpuBytes;
    if(this.measureFrame){this.telemetryStages.prepare=performance.now()-measureAt;measureAt=performance.now();}
    const matrix = cameraMatrix(options), zoom = Number(view.scale ?? 1), x = Number(view.x ?? 0), y = Number(view.y ?? 0);
    const uniform = new Float32Array([matrix[0], matrix[2], matrix[4], Math.hypot(matrix[0], matrix[1]), matrix[1], matrix[3], matrix[5], (view.flip ? -1 : 1) * (view.rotation??0), this.width, this.height, this.dpr, options.clipToCanvas === false ? 0 : 1, x, y, x + report.canvas_width * zoom, y + report.canvas_height * zoom]);
    this.device.queue.writeBuffer(this.uniform, 0, uniform);
    const parallax=parallaxResolver(report,frame,options.cameraEnabled!==false);
    for (const entry of this.layout) {
      if (!entry.g) continue;
      const depth=parallax(entry.uid);
      const delta = entry.isOnion ? null : dragTranslations?.get?.(entry.uid) || dragTranslations?.[entry.uid];
      this.transformData.set([entry.root.x + (delta?.x || 0)+depth.x, entry.root.y + (delta?.y || 0)+depth.y, entry.opacity * (entry.artworkOpacity ?? 1), hiddenUids?.has(entry.uid) ? 0 : 1], entry.transform * 4);
    }
    this.device.queue.writeBuffer(this.transformBuffer, 0, this.transformData);
    // Generated effects follow their target's parallax and live drag offsets.
    const generatorBatch=offsetGeneratorBatch(generatorBatchFor(report,frame,geometry,{enabled:options.vfxEnabled!==false,budgetMs:INTERACTIVE_SAMPLING_MS}),uid=>{const depth=parallax(uid),delta=dragTranslations?.get?.(uid)||dragTranslations?.[uid];return {x:depth.x+(delta?.x||0),y:depth.y+(delta?.y||0)};});
    this.lastGeneratorBatch=generatorBatch;
    const generatorPlan=generatorBatch&&generatorSchedule(generatorBatch,hiddenUids);
    if(generatorPlan&&!generatorPlan.empty)this.generatorGpu().upload(generatorBatch);
    const encoder = this.device.createCommandEncoder({ label: 'StykAnimate viewport frame' });
    if(drawingGpu&&!drawingGpu.destroyed)drawingGpu.encode(encoder);
    const timestampWrites=this.gpuTiming?.begin(this.measureFrame);
    this.stats.onionRenderedFrames=this.stats.onionFrameHits=0;
    const hasOnions=this.layout.some(entry=>entry.isOnion);
    const lastOnion=hasOnions&&!hasSceneVfx(frame)?this.layout.findLastIndex(entry=>entry.isOnion):-1;
    if(hasOnions){this.onionComposite??=new OnionComposite(this);this.onionComposite.prepare(uniform);}
    else if(this.onionComposite){this.onionComposite.destroy();this.onionComposite=null;this.stats.onionCompositeBytes=this.stats.onionCacheBytes=0;}
    const destination=this.context.getCurrentTexture().createView();
    const firstTimestamps=timestampWrites&&lastOnion>=0?{querySet:timestampWrites.querySet,beginningOfPassWriteIndex:timestampWrites.beginningOfPassWriteIndex}:timestampWrites;
    let pass = encoder.beginRenderPass({ colorAttachments: [{...this.colorAttachment(destination), ...(hasOnions?{storeOp:'store'}:{})}], ...(firstTimestamps?{timestampWrites:firstTimestamps}:{}) });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.globalBindGroup);
    let calls = 0, begin = -1, count = 0;
    const flush = () => { if (!count) return; pass.setBindGroup(1, this.blankBindGroup); pass.draw(6, count, 0, begin); calls++; begin = -1; count = 0; };
    const walker=generatorPlan&&!generatorPlan.empty?scheduleWalker(generatorPlan,draws=>{flush();this.generators.draw(pass,draws,this.msaaCount,p=>{p.setPipeline(this.pipeline);p.setBindGroup(0,this.globalBindGroup);});calls+=draws.length;}):null;
    let generatorsBegun=false;
    for (let i=0;i<this.layout.length;i++) {
      const entry=this.layout[i];
      if(entry.isOnion&&hasSceneVfx(frame)){flush();continue;}
      if(entry.isOnion){
        flush();const end=onionLayerEnd(this.layout,i);
        const finalTimestamps=timestampWrites&&end-1===lastOnion?{querySet:timestampWrites.querySet,endOfPassWriteIndex:timestampWrites.endOfPassWriteIndex}:undefined;
        const composite=this.onionComposite.draw(encoder,destination,pass,this.layout,i,end,finalTimestamps);pass=composite.pass;calls+=composite.calls;i=end-1;continue;
      }
      if(walker&&entry.g&&!entry.isOnion){if(!generatorsBegun){walker.begin();generatorsBegun=true;}walker.object(entry.uid);}
      if (entry.gpuDraw) { flush(); drawingGpu.draw(pass, entry.gpuDraw); pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.globalBindGroup); calls++; }
      else if (entry.texture) { flush(); pass.setBindGroup(1, entry.texture.bindGroup); pass.draw(6, entry.count, 0, entry.offset); calls++; }
      else { if (begin < 0) begin = entry.offset; count += entry.capacity; }
    }
    flush();
    if(walker){if(!generatorsBegun)walker.begin();walker.end();}
    // Trails still being sampled refine on the next frame.
    if(generatorBatch?.incomplete)queueMicrotask(()=>this.options.onInvalidate?.());
    this.stats.generatedParticles=generatorBatch?.particles??0;
    this.stats.handleCount=options.canvasHandles?.length||0;
    this.stats.handleUploadBytes=options.canvasHandles ? this.handleRenderer.update(options.canvasHandles,dragTranslations,options.outlineHandles) : 0;
    this.stats.handleDrawCalls=options.canvasHandles&&!hasSceneVfx(frame) ? this.handleRenderer.draw(pass) : 0;
    calls+=this.stats.handleDrawCalls;
    pass.end(); this.gpuTiming?.resolveInto(encoder,timestampWrites);this.device.queue.submit([encoder.finish()]);this.gpuTiming?.submitted(timestampWrites);
    if(this.measureFrame)this.telemetryStages.submit=performance.now()-measureAt;
    if(hasSceneVfx(frame))this.finishSceneVfx({...options,geometry,viewportUniforms:uniform});
    Object.assign(this.stats, { frameMs: performance.now() - start, drawCalls: calls, mode: 'retained editor', transformUploadBytes: this.transformData.byteLength,
      preparedBytes: this.preparedFrames.bytes, preparedFrames: this.preparedFrames.frames.size, workerCompileMs: null, packetUploadMs: null });
    return geometry;
  }
  finishSceneVfx(options){return renderPreviewVfx(this,'vfxViewport',()=>new ViewportVfx(this),viewport=>viewport.render(options));}
  /** Generated-effect pipelines share this device and the viewport globals. */
  generatorGpu(){return this.generators??=new GeneratorGpu(this.device,this.format,this.uniform);}
  /** Drawing cels that objectEntry presents from their tile presenter rather
   * than from a compatibility raster of the published image. */
  liveDrawing(items, isOnion) {
    const figure = items.length === 1 && !isOnion ? items[0].fig : null, meta = figure && drawingMetadata(figure);
    if (!meta || hasDrawableVfx(items[0])) return false;
    const drawing = this.resources.drawing?.(figure);
    return Boolean(drawing && (drawing.store || meta.version === 2));
  }
  /** Switch drawing cels between GPU-resident tiles and the canvas scratch
   * presenter (the Canvas 2D path). Used by diagnostics and fallback tests. */
  setGpuDrawing(enabled) {
    if (!enabled) { this.gpuDrawingPending = null; this.drawingGpu?.destroy(); this.drawingGpu = null; this.gpuDrawingReady = Promise.resolve(false); }
    else if (!this.destroyed && !this.deviceLost) this.enableGpuDrawing();
    this.lastGeometry = null; this.options.onInvalidate?.();
    return this.gpuDrawingReady;
  }
  /** Visible level-0 pixel rect and display level for a GPU drawing entry,
   * matching the scratch path's mip choice. */
  gpuDrawingView(entry,camera){
    const {absolute:m,matrix,alpha}=entry.gpuDrawing,cd=camera[0]*camera[3]-camera[1]*camera[2],md=m[0]*m[3]-m[1]*m[2];
    let rect=null;
    if(Math.abs(cd)>1e-12&&Math.abs(md)>1e-12){
      const toWorld=p=>({x:(camera[3]*(p.x-camera[4])-camera[2]*(p.y-camera[5]))/cd,y:(camera[0]*(p.y-camera[5])-camera[1]*(p.x-camera[4]))/cd});
      const toPixel=p=>({x:(m[3]*(p.x-m[4])-m[2]*(p.y-m[5]))/md,y:(m[0]*(p.y-m[5])-m[1]*(p.x-m[4]))/md});
      const ps=[[0,0],[this.width,0],[this.width,this.height],[0,this.height]].map(([x,y])=>toPixel(toWorld({x,y})));
      const x=Math.min(...ps.map(p=>p.x)),y=Math.min(...ps.map(p=>p.y));
      rect={x,y,width:Math.max(...ps.map(p=>p.x))-x,height:Math.max(...ps.map(p=>p.y))-y};
    }
    const deviceScale=Math.max(1e-9,Math.hypot(camera[0],camera[1])*this.dpr*Math.hypot(m[0],m[1]));
    return {matrix,alpha,rect,transform:entry.transform,level:Math.max(0,Math.min(8,Math.floor(-Math.log2(deviceScale))))};
  }
  destroy() {
    this.gpuTiming?.destroy();
    this.drawingGpu?.destroy();
    for(const texture of this.drawingTextures?.values()??[])texture.texture.destroy();this.drawingTextures?.clear();
    this.vfxViewport?.destroy();
    this.generators?.destroy(); this.generators = null;
    this.artworks.clear();
    this.destroyed = true; this.last = null; this.uploadStaging = null; this.onionScenes = []; this.onionComposite?.destroy(); this.preparedFrames.clear(); this.handleRenderer?.destroy(); this.msaa?.destroy(); this.shapeBuffer?.destroy(); this.transformBuffer?.destroy(); this.uniform?.destroy(); this.blankTexture?.destroy();
    this.rasterCache.clear();
    for (const entry of this.backgroundImages?.values() || []) entry.texture.destroy();
    this.rasterSurfaces.dispose(); releaseVfxDevice(this.device); this.context.unconfigure(); this.device.destroy();
  }
}

function preparedSceneKeys(options, dpr) {
  const {report, frame} = options, camera = cameraMatrix(options);
  return {
    backgroundKey: JSON.stringify([frame.background_id, frame.background_id_b, frame.background_mix, editorBackgroundColor(options) ?? sceneBackgroundColor(report, frame), effectiveCamera(report, frame, options.cameraEnabled !== false)]),
    rasterResolution: Math.max(.5, Math.min(8, 2 ** Math.ceil(Math.log2(Math.hypot(camera[0], camera[1]) * dpr)))),
  };
}

/** Build a replacement editor layout without changing live buffers. Existing
 * artwork stays owned by the renderer; leases protect both layouts until the
 * caller atomically publishes or cancels this preparation. */
async function prepareSceneUpdate(renderer, request) {
  const {report, frame, geometry, signal, sliceMs=4, yieldControl, getView}=request;
  if(renderer.activeReport!==report||!geometry)throw new Error('An editable scene update requires the active document and its geometry.');
  const generation=renderer.generation, liveGeometry=renderer.lastGeometry, started=performance.now();
  let stage, disposed=false, activated=false;
  const lease=renderer.rasterCache.lease(renderer.layout?.map(entry=>entry.texture).filter(Boolean));
  const check=()=>{
    if(disposed||signal?.aborted||renderer.destroyed||renderer.deviceLost||renderer.activeReport!==report||renderer.generation!==generation||renderer.lastGeometry!==liveGeometry||request.checkCurrent?.()===false)
      throw new DOMException('Editable scene preparation was superseded.', 'AbortError');
  };
  const dispose=()=>{
    if(disposed||activated)return;disposed=true;
    stage?.shapeBuffer?.destroy();stage?.transformBuffer?.destroy();stage?.rasterSurfaces.dispose();
    for(const entry of stage?.backgroundImages?.values()||[])entry.texture.destroy();
    stage?.backgroundImages?.clear();for(const texture of stage?.drawingTextures?.values()??[])texture.texture.destroy();
    lease.release();
    if(!renderer.destroyed)renderer.artworkStats();
  };
  try {
    check();
    stage=new WebGPURenderer(renderer.canvas,renderer.device,renderer.context,renderer.format,{...renderer.options,onInvalidate:undefined,onStatus:undefined});
    for(const key of ['pipeline','isolationPipeline','isolationSamples','globalLayout','textureLayout','uniform','sampler','nearestSampler','blankBindGroup','resources','rasterCache','vectorCache','compatibilityCache','artworks','artworkAliases','boundsCache'])stage[key]=renderer[key];
    // Planning records drawing transforms but does not upload or own GPU tiles.
    // Keep the live tile backend and viewport so held cels never prepare an
    // empty scratch against an undefined viewport.
    stage.drawingGpu=renderer.drawingGpu;
    stage.activeReport=report;stage.generation=generation;stage.rasterLease=lease;stage.predecessor=renderer;
    const timings={};let view={...(getView?.()||request.view||{})}, keys;
    for(;;){
      check();stage.dpr=renderer.dpr;stage.width=renderer.width;stage.height=renderer.height;
      const options={...request,report,frame,geometry,view};
      const built=await consumeSceneSteps(stage.prepareSteps(options,geometry),{signal,sliceMs,yieldControl,checkCurrent:check,onProgress:request.onProgress});
      timings.gpu=built.timings;check();
      // Uploads and the next draw use the same ordered GPU queue. Publication
      // needs no CPU readback, so a queue-wide fence only delays the playhead.
      check();
      keys=preparedSceneKeys(options,stage.dpr);
      view={...(getView?.()||view)};
      const fresh=preparedSceneKeys({...options,view},renderer.dpr);
      if(stage.stats.textureObjects&&keys.rasterResolution!==fresh.rasterResolution)continue;
      stage.lastReport=report;stage.backgroundKey=keys.backgroundKey;stage.onionFrameRefs=[...(request.onionFrames||[])];
      stage.lastRasterResolution=fresh.rasterResolution;break;
    }
    timings.elapsedMs=performance.now()-started;
    return {report,frame,geometry,view,timings,dispose,
      activate(){
        check();if(activated)throw new Error('The editable scene was already published.');
        const fresh=preparedSceneKeys({...request,view:getView?.()||view},renderer.dpr);
        if(fresh.backgroundKey!==keys.backgroundKey||(stage.stats.textureObjects&&fresh.rasterResolution!==stage.lastRasterResolution))
          throw new DOMException('The editable scene view changed before publication.', 'AbortError');
        stage.copySharedEntries(renderer);
        renderer.shapeBuffer?.destroy();renderer.transformBuffer?.destroy();renderer.rasterSurfaces.dispose();
        for(const entry of renderer.backgroundImages?.values()||[])entry.texture.destroy();
        for(const texture of renderer.drawingTextures?.values()??[])texture.texture.destroy();
        for(const key of ['drawingTextures','entries','layout','lastGeometry','lastGeneration','lastReport','backgroundKey','backgroundImages','onionScenes','onionFrameRefs','lastRasterResolution','shapeBuffer','transformBuffer','globalBindGroup','transformData','shapeCount','entriesBySlot','uploadStaging','rasterSurfaces'])renderer[key]=stage[key];
        renderer.previewRasterScale = stage.previewRasterScale;
        Object.assign(renderer.stats,stage.stats,{preparedCache:renderer.preparedFrames.stats,editablePreparation:timings});
        activated=true;lease.release();renderer.artworkStats();
        renderer.last=null;return geometry;
      }};
  }catch(error){dispose();throw error;}
}

/** Build an incoming scene without touching the live canvas, caches or buffers. */
async function prepareInitialScene(renderer, request) {
  const {report, frame, signal, sliceMs = 4, yieldControl, onProgress, getView} = request;
  const constructionColor = editorBackgroundColor(request);
  if (!report || !frame) throw new Error('An initial scene requires its report and evaluated frame.');
  if (renderer.activeReport === report || renderer.last?.report === report) throw new Error('Initial scene preparation requires a separate incoming document.');
  const started = performance.now(); let stage, transferred = false, imageFailure;
  const checkCurrent = () => {
    if (renderer.destroyed || signal?.aborted) throw new DOMException('Scene preparation cancelled.', 'AbortError');
    if (renderer.device && renderer.stats.backend !== 'WebGPU') throw new Error('The graphics device is unavailable.');
    request.checkCurrent?.(); if (imageFailure) throw imageFailure;
  };
  const media = createSceneImages({url: renderer.resources.url, signal, checkCurrent, imageFactory: request.imageFactory});
  const discard = () => {
    if (transferred) return;
    if (stage) {
      stage.destroyed = true; stage.shapeBuffer?.destroy(); stage.transformBuffer?.destroy();
      for (const entry of stage.backgroundImages?.values() || []) entry.texture.destroy();
      stage.backgroundImages?.clear(); stage.rasterCache.clear(); stage.rasterSurfaces.dispose(); stage.layout = []; stage.entries.clear();
    }
    media.dispose();
  };
  const backgroundLoad = media.load(backgroundImageAssets(report, frame)).catch(error => {imageFailure = error;});
  try {
    checkCurrent();
    const timings = {}, geometry = request.geometry || await (await import('./pivot/geometry.mjs')).buildGeometryAsync(report, frame, null, {
      signal, sliceMs, yieldControl, checkCurrent, onProgress, onTiming: value => {timings.geometry = value;},
    });
    await backgroundLoad; checkCurrent();
    timings.backgroundImages = media.images.lastPreparation;
    const imageStart = performance.now();
    await media.load(frameImageAssets(geometry)); checkCurrent();
    timings.figureImages = media.images.lastPreparation === timings.backgroundImages
      ? {reused: true} : media.images.lastPreparation;
    timings.figureImagesMs = performance.now() - imageStart;
    timings.mediaReadyMs = performance.now() - started;
    let view = {...(getView?.() || request.view || {})};
    if (renderer instanceof WebGPURenderer) {
      stage = new WebGPURenderer(renderer.canvas, renderer.device, renderer.context, renderer.format, {
        ...renderer.options, resources: media.resources, onInvalidate: undefined, onStatus: undefined,
      });
      for (const key of ['pipeline', 'isolationPipeline', 'isolationSamples', 'globalLayout', 'textureLayout', 'uniform', 'sampler', 'nearestSampler', 'blankBindGroup']) stage[key] = renderer[key];
      stage.activeReport = report;
      for (;;) {
        stage.dpr = renderer.dpr;stage.width = renderer.width;stage.height = renderer.height;
        const options = {report, frame, geometry, view, cameraEnabled: request.cameraEnabled !== false, editorBackgroundColor: constructionColor, onionFrames: []};
        const prepared = await consumeSceneSteps(stage.prepareSteps(options, geometry), {signal, sliceMs, yieldControl, checkCurrent, onProgress});
        timings.gpu = prepared.timings; checkCurrent();
        const queueStart = performance.now(); await renderer.device.queue.onSubmittedWorkDone();
        timings.gpuReadyMs = (timings.gpuReadyMs || 0) + performance.now() - queueStart; checkCurrent();
        const freshView = {...(getView?.() || view)}, keys = preparedSceneKeys(options, stage.dpr);
        const freshKeys = preparedSceneKeys({...options, view: freshView}, renderer.dpr);
        view = freshView;
        if (stage.stats.textureObjects && keys.rasterResolution !== freshKeys.rasterResolution) continue;
        stage.lastReport = report; stage.backgroundKey = keys.backgroundKey; stage.onionFrameRefs = [];
        stage.lastRasterResolution = freshKeys.rasterResolution; break;
      }
    }
    checkCurrent(); timings.elapsedMs = performance.now() - started;
    const prepared = {report, frame, geometry, images: media.images, view, timings, cameraEnabled: request.cameraEnabled !== false, editorBackgroundColor: constructionColor,
      renderer, stage, activated: false, disposed: false,
      dispose() {if (!this.activated && !this.disposed) {this.disposed = true; discard();}},
      transfer() {transferred = true; this.activated = true; media.detach?.();},
    };
    return prepared;
  } catch (error) {discard(); throw error;}
}

/** Publication is synchronous: all decoding, geometry and GPU allocation is done. */
function activatePreparedScene(renderer, prepared, options = {}) {
  const {report = prepared?.report, frame = prepared?.frame, geometry = prepared?.geometry, view = prepared?.view} = options;
  const constructionColor = Object.hasOwn(options, 'editorBackgroundColor') ? options.editorBackgroundColor : prepared?.editorBackgroundColor;
  if (!prepared || prepared.renderer !== renderer || prepared.activated || prepared.disposed || renderer.destroyed ||
      prepared.report !== report || prepared.frame !== frame || prepared.geometry !== geometry)
    throw new Error('The prepared initial scene no longer matches this document.');
  const stage = prepared.stage;
  if (stage) {
    const keys = preparedSceneKeys({report, frame, view, cameraEnabled: prepared.cameraEnabled, editorBackgroundColor: constructionColor}, renderer.dpr);
    if (keys.backgroundKey !== stage.backgroundKey)
      throw new Error('The construction background changed after scene preparation; prepare its background again.');
    if (stage.stats.textureObjects && keys.rasterResolution !== stage.lastRasterResolution)
      throw new Error('The viewport changed after scene preparation; prepare its raster scale again.');
    renderer.useReport(report);
    renderer.shapeBuffer?.destroy(); renderer.transformBuffer?.destroy(); renderer.rasterSurfaces.dispose();
    for (const key of ['entries', 'layout', 'rasterCache', 'vectorCache', 'compatibilityCache', 'artworks', 'artworkAliases', 'generation', 'lastGeometry', 'lastGeneration',
      'lastReport', 'backgroundKey', 'backgroundImages', 'onionScenes', 'onionFrameRefs', 'lastRasterResolution', 'shapeBuffer', 'transformBuffer',
      'globalBindGroup', 'transformData', 'shapeCount', 'entriesBySlot', 'uploadStaging', 'rasterSurfaces']) renderer[key] = stage[key];
    renderer.previewRasterScale = stage.previewRasterScale;
    Object.assign(renderer.stats, stage.stats, {preparedCache: renderer.preparedFrames.stats, initialPreparation: prepared.timings});
    prepared.stage = null;
  }
  renderer.last = null; prepared.view = {...view}; prepared.transfer(); return geometry;
}

/** A WebGPU adapter that rasterizes on the CPU. SwiftShader, llvmpipe and
 * WARP-style drivers are slower than the Canvas compatibility path for this
 * workload, so they route there unless explicitly allowed. */
async function softwareAdapter(adapter) {
  if (adapter?.isFallbackAdapter) return true;
  let info = adapter?.info;
  if (!info) { try { info = await adapter?.requestAdapterInfo?.(); } catch { info = null; } }
  if (!info) return false;
  const signature = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ');
  return /swiftshader|llvmpipe|lavapipe|basic render|software|\bwarp\b/i.test(signature);
}

/** WebGPU is preferred. Unsupported systems get a clearly labeled compatibility renderer. */
export async function createRenderer(canvas, options = {}) {
  let reason = options.fallbackReason || 'WebGPU is unavailable in this browser or graphics driver.';
  if (!options.forceCanvas2D && globalThis.navigator?.gpu) {
    let device, renderer;
    const startup = gpuStartupBudget();
    try {
      const adapter = await startup.wait(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }));
      if (!adapter) throw new Error('No compatible WebGPU adapter was found.');
      if (await startup.wait(softwareAdapter(adapter)) && !options.allowSoftwareAdapter)
        throw new Error('WebGPU resolved to a software adapter; the compatibility renderer is faster on this hardware.');
      device = await startup.wait(requestInstrumentedDevice(adapter), lateDevice => lateDevice.destroy());
      const info = adapter.info;
      renderer = new WebGPURenderer(canvas, device, null, navigator.gpu.getPreferredCanvasFormat(), { ...options, adapterName: [info?.vendor, info?.architecture, info?.device].filter(Boolean).join(' · ') });
      renderer.gpuTiming=new GpuTiming(device,{enabled:options.diagnosticsEnabled,onTiming:options.onGpuTiming,onSupport:options.onGpuTimingSupport,getContext:options.measurementContext});
      await renderer.initialize(startup); options.onStatus?.(renderer.stats); return renderer;
    } catch (error) {
      reason = error.message;
      if (renderer) { renderer.destroyed = true; renderer.gpuTiming?.destroy(); }
      device?.destroy();
      // A canvas cannot change its context type after WebGPU has been acquired.
      if (renderer?.context) { renderer.context.unconfigure(); throw new Error(`WebGPU initialization failed: ${reason}`); }
    }
  }
  const fallback = new CanvasFallback(canvas, options, reason); options.onStatus?.(fallback.stats); return fallback;
}
