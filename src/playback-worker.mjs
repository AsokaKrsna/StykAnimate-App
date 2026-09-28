import {vectorVfxSource} from './renderer-vfx-vector.mjs';
import {vfxRasterScale,hasDrawableVfx} from './vfx-canvas.mjs';
import {connectedVfxGeometry} from './vfx-connected.mjs';
import {cameraAtTime} from './camera-motion.mjs';
import {supportsVectorIsolation} from './renderer-vector-raster.mjs';
import {meshOnlyItems,meshRasterSource,meshRasterBytes,meshRasterBuffers} from './renderer-mesh-raster.mjs';
import {drawParallaxGeometry} from './parallax-draw.mjs';
import {parallaxResolver} from './layer-parallax.mjs';
import { PlaybackResources } from './playback-resources.mjs';
export { PlaybackResources } from './playback-resources.mjs';
import { evaluatedFrame, timeline, buildGeometry, drawGeometry, releaseGeometryResources, invalidateEvaluationCaches } from './pivot/geometry.mjs';
import { compileVectorObject, requiresCompatibilityTexture, objectBounds, cameraMatrix, shapeRecord, SHAPE, SHAPE_FLOATS, rasterResolution } from './renderer-geometry.mjs';
import { applyDocumentChunk } from './document-transport.mjs';
import {MAX_NATIVE_PLAYBACK_BYTES, NATIVE_PLAYBACK_CHUNK_BYTES, materializePlaybackSnapshot} from './playback-native.mjs';
import { applyPlaybackPatch } from './playback-patch.mjs';
import {PlaybackPlanningService} from './playback-planning.mjs';
import {storedFrameReport} from './pivot-frame-draft.mjs';
import { RasterSurfacePool } from './raster-surfaces.mjs';
import {ArtworkRegistry} from './render-artwork.mjs';
import {PlaybackGeometryCache} from './playback-geometry-cache.mjs';
import {PlaybackTweenCache} from './playback-tween-cache.mjs';
import {vfxPreviewGeometry} from './vfx-preview.mjs';
import {glyphTextureDescriptor,glyphTextureKey,drawGlyphMask,glyphTextureShape,glyphVisible,cropGlyphTexture} from './renderer-glyphs.mjs';
import { drawBackground, backgroundBounds } from './pivot/background.mjs';
import { layerVisible } from './layers.mjs';
import { activeVfx, vfxStack } from './vfx.mjs';
import { releaseVfxSurface } from './vfx-canvas.mjs';
import { CameraVfx } from './vfx-camera.mjs';
import {sceneVfxPlan} from './vfx-scene.mjs';
import {opacityArtwork} from './renderer-opacity.mjs';
import { backgroundImageAssets } from './scene-preparation.mjs';
import {generatorBatchFor,offsetGeneratorBatch,canvasGenerators,canvasGeneratorWalker,SOFTWARE_PARTICLE_BUDGET} from './vfx-generator-frame.mjs';

/** A transferable copy of a frame's generator batch with layer parallax applied. */
function packetGenerators(report, native, geometry, parallax, vfxEnabled) {
  const batch = vfxEnabled ? offsetGeneratorBatch(generatorBatchFor(report, native, geometry), parallax) : null;
  return batch ? {...batch, records: batch.records.slice(), table: batch.table.slice()} : null;
}
const fallbackRasterSurfaces = new RasterSurfacePool();
const yieldPlaybackTask = () => globalThis.scheduler?.yield ? scheduler.yield() : new Promise(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {channel.port1.close(); channel.port2.close(); resolve();};
  channel.port2.postMessage(null);
});

function refreshSampling(snapshot) {
  snapshot.sampleReport = snapshot.storedFrames ? storedFrameReport(snapshot.report) : snapshot.report;
  snapshot.entries = timeline(snapshot.sampleReport); return snapshot;
}

/** Exact native tick lookup, including disabled (zero-duration) keyframes. */
export function playbackLocation(entries, tick) {
  let low = 0, high = entries.length - 1;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (entries[mid].start <= tick) low = mid; else high = mid - 1; }
  const entry = entries[low];
  return { index: low, t: entry?.count > 1 ? (tick - entry.start) / entry.count : 0 };
}

/** Invert the artboard and effect sampling region into world space before
 * culling artwork or decoding image crops. */
export function playbackVisibleBounds(report, frame, cameraEnabled = true, effectScale = 1) {
  const [a, b, c, d, e, f] = cameraMatrix({ report, frame, cameraEnabled });
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || !determinant) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  // Raster crops and image decodes must retain the same neighbors as the
  // camera compositor. Use the smaller software preview cap conservatively.
  const density=Math.max(1/65536,Math.min(effectScale,1024/Math.max(report.canvas_width,report.canvas_height)));
  const pad=sceneVfxPlan(frame,report.canvas_width*density,report.canvas_height*density,undefined,density).pad/density;
  for (const [x, y] of [[0-pad, 0-pad], [report.canvas_width+pad, 0-pad], [0-pad, report.canvas_height+pad], [report.canvas_width+pad, report.canvas_height+pad]]) {
    const wx = (d * (x - e) - c * (y - f)) / determinant;
    const wy = (-b * (x - e) + a * (y - f)) / determinant;
    x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
  }
  if(!cameraEnabled&&activeVfx(vfxStack(frame)).length){
    const camera=playbackVisibleBounds(report,frame,true,effectScale);
    if(camera){x0=Math.min(x0,camera.x);y0=Math.min(y0,camera.y);x1=Math.max(x1,camera.x+camera.width);y1=Math.max(y1,camera.y+camera.height);}
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Retain the original object's pixel grid and resolution while allocating only
 * the visible subset. Two guard pixels preserve bilinear filtering and antialiasing. */
export function playbackRasterBounds(bounds, visible, resolution, maxTextureDimension = 8192) {
  const pixelScale = Math.min(resolution, maxTextureDimension / bounds.width, maxTextureDimension / bounds.height);
  const fullWidth = Math.max(1, Math.ceil(bounds.width * pixelScale)), fullHeight = Math.max(1, Math.ceil(bounds.height * pixelScale));
  const x0 = visible ? Math.max(0, Math.floor((visible.x - bounds.x) * pixelScale) - 2) : 0;
  const y0 = visible ? Math.max(0, Math.floor((visible.y - bounds.y) * pixelScale) - 2) : 0;
  const x1 = visible ? Math.min(fullWidth, Math.ceil((visible.x + visible.width - bounds.x) * pixelScale) + 2) : fullWidth;
  const y1 = visible ? Math.min(fullHeight, Math.ceil((visible.y + visible.height - bounds.y) * pixelScale) + 2) : fullHeight;
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: bounds.x + x0 / pixelScale, y: bounds.y + y0 / pixelScale,
    width: (x1 - x0) / pixelScale, height: (y1 - y0) / pixelScale,
    pixelWidth: x1 - x0, pixelHeight: y1 - y0, pixelScale, fullPixels: fullWidth * fullHeight };
}

/** A compact immutable render packet. No scene graph is sent for vector figures. */
export async function compilePlaybackPacket(report, tick, options = {}) {
  let quality = options.resources?.previewScale || 1;
  let rasterizeVectors = false;
  let rasterRetry = false;
  const frameBudget=options.maxPacketBytes??128*1024*1024;
  const started = performance.now();
  for (;;) {
    if (options.cancelled?.()) throw new DOMException('Playback preparation was superseded.', 'AbortError');
    const recovering=!options.softwareFrames&&options.resources?.previewPressureScale<quality;
    const maxPacketBytes=recovering?frameBudget/4:frameBudget;
    try {
      const packet = options.softwareFrames
        ? await compileSoftwarePacket(report, tick, {...options, quality})
        : await compilePacketAttempt(report, tick, {...options, maxPacketBytes, quality, rasterizeVectors});
      const rasterScale = packet.compatibility.length ? quality : 1;
      packet.previewQuality = {scale: rasterScale, reduced: rasterScale < 1 || rasterizeVectors || Boolean(packet.previewQuality?.reduced)};
      packet.compileMs = performance.now() - started;
      if(options.resources){
        const resources=options.resources,budget=frameBudget;
        // Recover one level only after eight consecutive lightweight packets.
        // Fourfold pixel growth must still leave room for several future frames,
        // otherwise sharper packets can drain the lookahead and cause stalls.
        const headroom=!options.softwareFrames&&!rasterRetry&&!rasterizeVectors&&quality<1&&packet.byteLength*4<=budget/4;
        const prior=resources.previewRecovery;
        const count=headroom?(prior?.tick===tick-1?prior.count+1:1):0;
        resources.previewScale=count>=8?Math.min(1,quality*2):quality;
        resources.previewRecovery={tick,count:count>=8?0:count};
      }
      return packet;
    } catch (error) {
      if (!['playback_frame_budget','vfx_surface_budget'].includes(error.code) || typeof OffscreenCanvas === 'undefined' || quality <= 1 / 4096) throw error;
      // Pixel pressure must not turn a cheap vector scene into hundreds of
      // separately rasterized images. Only compress vectors if their records
      // alone cannot fit, independent of bitmap resolution. Software packets
      // are a single bitmap already, so pressure only lowers its resolution.
      if (!options.softwareFrames && !rasterizeVectors && (error.vectorOverflow || error.fixedBytes > (options.maxPacketBytes ?? 128 * 1024 * 1024))) rasterizeVectors = true;
      else quality /= 2;
      if(options.resources&&!recovering&&!options.softwareFrames)options.resources.previewPressureScale=quality;
      // Failed packet clones were closed by the attempt. A rejected allocation
      // plan can keep bounded originals; drawing failures release them before
      // allocating a lower-resolution replacement.
      if(!error.preflight){rasterRetry=true;options.resources?.artworkBitmaps?.clear();}
      await yieldPlaybackTask();
    }
  }
}

async function compilePacketAttempt(report, tick, { revision = 1, scale = 1, quality = 1, rasterizeVectors = false, gpuIsolation = false, entries, sampleReport, resources, maxTextureDimension = 8192, maxPacketBytes = 128 * 1024 * 1024, cameraEnabled = true, vfxEnabled = true, storedFrames = false, sharedArtwork = true, artworkRegistry, geometryCache, tweenCache, cancelled = () => false } = {}) {
  resources?.artworkBitmaps?.beginFrame();
  if (typeof cameraEnabled !== 'boolean') throw new TypeError('Playback camera mode must be a boolean.');
  if (typeof storedFrames !== 'boolean') throw new TypeError('Playback stored-frame mode must be a boolean.');
  report = sampleReport || (storedFrames ? storedFrameReport(report) : report); entries ??= timeline(report);
  const started = performance.now(), location = playbackLocation(entries, tick);
  const native = evaluatedFrame(report, location.index, location.t, tick, {tweenCache}), evaluated = performance.now();
  if (!native) throw new Error('The playback tick has no native frame.');
  const sourceGeometry=geometryCache?geometryCache.get(report,native,revision):buildGeometry(report,native),geometry=vfxEnabled?connectedVfxGeometry(sourceGeometry,native,report):vfxPreviewGeometry(sourceGeometry),geometrized=performance.now();
  const frame = { camera: cameraAtTime(report,native), background_id: native.background_id, background_id_b: native.background_id_b, background_mix: native.background_mix, duration_raw: native.duration_raw,
    ...(vfxEnabled&&vfxStack(native).length ? {_stykVfx:{figure:vfxStack(native)}} : {}),
    ...(native._stykBackgroundColor !== undefined ? {_stykBackgroundColor: native._stykBackgroundColor} : {}) };
  const groups = [], compatibility = [], chunks = [], rasterJobs = [], keyJobs = [], transforms = [0, 0, 1, 1], uids = [0];
  const matrix = cameraMatrix({ report, frame, cameraEnabled, view: { scale } });
  const resolution = rasterResolution(Math.hypot(matrix[0], matrix[1]) || 1) * quality;
  const sceneVisibleBounds = playbackVisibleBounds(report, frame, cameraEnabled,scale*quality),parallax=parallaxResolver(report,native,cameraEnabled);
  const clipping = { culledObjects: 0, culledPrimitives: 0, originalPixels: 0, retainedPixels: 0 };
  // Each unique bitmap has one packet owner and one transferable, even when
  // several ordered instances draw it. Camera crops are part of its identity.
  const artworks=sharedArtwork?(artworkRegistry||new ArtworkRegistry()):null,rasters=new Map();
  // The worker mirror is immutable for a revision. Keep definition/signature
  // memoization across its frames, including embedded image payloads.
  artworks?.begin(revision);
  const sharing={reusedInstances:0,savedBitmapBytes:0,rasterCacheHits:0,rasterCacheMisses:0,reusedVectorObjects:0};
  const initialRasterHits=resources?.artworkBitmaps?.hits||0,initialRasterMisses=resources?.artworkBitmaps?.misses||0;
  const initialVectorHits=resources?.vectors?.hits||0;
  let shapeCount = 0, bitmapBytes = 0;
  let reducedImages = false;
  const requireBudget = bytes => {
    // Below WebGPU's minimum 128 MiB storage binding limit, with room for the
    // background records appended by the GPU cache. Bitmaps have their own
    // textures and are constrained by total packet residency instead.
    const vectorOverflow = shapeCount * SHAPE_FLOATS * 4 > 64 * 1024 * 1024;
    if (bytes > maxPacketBytes || vectorOverflow) {
      const error = new Error('A playback frame exceeds its preparation memory budget.');
      error.code = 'playback_frame_budget'; error.vectorOverflow = vectorOverflow; error.preflight = true;
      error.fixedBytes = shapeCount * SHAPE_FLOATS * 4 + (groups.length + 1) * 84; throw error;
    }
  };
  // buildGeometry emits every object's primitives contiguously in native painter order.
  let priorSlot, items = [];
  const append = async () => {
    if (!items.length) return;
    if (cancelled()) throw new DOMException('Playback preparation was superseded.', 'AbortError');
    const g = geometry.objects.get(priorSlot), transformIndex = uids.length;
    if (!g) return;
    if(g.drawables.every(item=>item.opacity<=0)){clipping.culledObjects++;return;}
    // Native object groups are contiguous. Keep the object's immutable array
    // identity so unchanged geometry also retains its exact artwork signature.
    const artworkView = opacityArtwork(g);
    const source = artworkView.source;
    items=artworkView.items;
    const uid = g.obj.unique_id ?? g.slot,depth=parallax(uid);
    const visibleBounds=sceneVisibleBounds?{...sceneVisibleBounds,x:sceneVisibleBounds.x-depth.x,y:sceneVisibleBounds.y-depth.y}:null;
    const group = { firstInstance: shapeCount, instanceCount: 0, transformIndex, uid, slot: priorSlot };
    let data;
    let descriptor=resources?.geometryDescriptors?.get(source);
    if(!descriptor){descriptor={compatibility:artworkView.isolated||requiresCompatibilityTexture(items),hasImages:items.some(item=>item.type==='image')};resources?.geometryDescriptors?.set(source,descriptor);}
    let glyph = sharedArtwork && typeof OffscreenCanvas !== 'undefined' && glyphTextureDescriptor(items,resolution,maxTextureDimension);
    if (glyph) {
      if (!glyph.color[3] || !glyphVisible(glyph,visibleBounds)) {clipping.culledObjects++; return;}
      clipping.originalPixels+=glyph.width*glyph.height;
      glyph=cropGlyphTexture(glyph,visibleBounds);
      if(!glyph){clipping.culledObjects++;return;}
      clipping.retainedPixels+=glyph.width*glyph.height;
      // Separate imported definitions can contain identical glyph paths. Use
      // the same content identity as packet/GPU ownership before admission,
      // otherwise duplicate masks can falsely trigger a quality reduction.
      const rasterKey=await glyphTextureKey(glyph),shared=rasters.get(rasterKey);
      if(cancelled())throw new DOMException('Playback preparation was superseded.', 'AbortError');
      if (shared !== undefined) {
        group.compatibilityIndex=shared; sharing.reusedInstances++; sharing.savedBitmapBytes+=glyph.bytes;
      } else {
        requireBudget(bitmapBytes+glyph.bytes+(shapeCount+1)*SHAPE_FLOATS*4+(groups.length+1)*84);
        const pool=resources?.rasterSurface?.(glyph.width,glyph.height) || resources?.rasterSurfaces || fallbackRasterSurfaces;
        const rasterize=()=>{const {surface,context}=pool.acquire(glyph.width,glyph.height);
          try {drawGlyphMask(context,glyph);return surface.transferToImageBitmap();} finally {pool.release();}};
        group.compatibilityIndex=compatibility.length;
        const entry={uid,artworkKey:rasterKey,glyphMask:true};compatibility.push(entry);bitmapBytes+=glyph.bytes;
        rasterJobs.push(async()=>{entry.bitmap=resources?.artworkBitmaps?await resources.artworkBitmaps.packetBitmap(rasterKey,rasterize):rasterize();});
        rasters.set(rasterKey,group.compatibilityIndex);
      }
      data=glyphTextureShape(glyph,g.root,transformIndex);
    } else if (descriptor.compatibility || rasterizeVectors) {
      descriptor.bounds??=objectBounds(items,resources);
      const rasterResolution=vfxRasterScale(items,descriptor.bounds,resolution,maxTextureDimension);
      reducedImages ||= rasterResolution<resolution;
      let vectorIsolation = gpuIsolation && artworkView.isolated && supportsVectorIsolation(items, resolution), isolationBounds;
      if (vectorIsolation) {
        descriptor.bounds ??= objectBounds(items, resources);
        isolationBounds = playbackRasterBounds(descriptor.bounds, visibleBounds, rasterResolution, maxTextureDimension);
        if (!isolationBounds) {clipping.culledObjects++; return;}
        vectorIsolation = supportsVectorIsolation(items, isolationBounds.pixelScale);
      }
      let vectorVfx=gpuIsolation?vectorVfxSource(items,resolution):null;
      if(vectorVfx){descriptor.bounds??=objectBounds(items,resources);const full=playbackRasterBounds(descriptor.bounds,null,rasterResolution,maxTextureDimension);
        if(full.fullPixels<=16777216&&full.fullPixels*4<maxPacketBytes/2&&vectorVfxSource(items,full.pixelScale)){isolationBounds=full;}else vectorVfx=null;}
      if (items.every(item => item.opacity <= 0)) { clipping.culledObjects++; return; }
      group.compatibilityIndex = compatibility.length;
      if (vectorVfx || vectorIsolation || typeof OffscreenCanvas !== 'undefined') {
        if(descriptor.hasImages) {
          await resources?.preload(items, {scale: resolution, maxDimension: maxTextureDimension, visible: visibleBounds});
          reducedImages ||= Boolean(resources?.pressureReduced);
        }
        if(!descriptor.bounds)descriptor.bounds=objectBounds(items,resources);
        const bounds = isolationBounds || playbackRasterBounds(descriptor.bounds, visibleBounds, rasterResolution, maxTextureDimension);
        if (!bounds) { clipping.culledObjects++; return; }
        const { pixelScale, pixelWidth: width, pixelHeight: height } = bounds;
        clipping.originalPixels += bounds.fullPixels; clipping.retainedPixels += width * height;
        const artwork=artworks?.get(source,items),cropKey=JSON.stringify([bounds.x-source.root.x,bounds.y-source.root.y,width,height,pixelScale,descriptor.hasImages ? resources?.imageKey?.(items) : '']);
        const variants=artwork&&rasters.get(artwork),shared=variants?.get(cropKey);
        if(shared!==undefined){
          group.compatibilityIndex=shared;sharing.reusedInstances++;sharing.savedBitmapBytes+=width*height*4;
        }else{
        requireBudget(bitmapBytes + width * height * 4 + (shapeCount + 1) * SHAPE_FLOATS * 4 + (groups.length + 1) * 84);
        // A depth-tested mesh can ship its evaluated faces instead of pixels.
        const meshRaster=gpuIsolation&&!vectorVfx&&!vectorIsolation&&meshOnlyItems(items)&&!items.some(hasDrawableVfx);
        // Content digests run on the crypto thread; start them eagerly and
        // resolve every key together after traversal instead of serializing a
        // worker event-loop hop for every compatibility object.
        const keyJob=artwork?{promise:artworks.contentKey(artwork).then(key=>`${vectorVfx?'vfx-vector:':vectorIsolation?'vector:':meshRaster?'mesh:':''}${key}:${cropKey}`),key:undefined,entry:null}:null;
        if(keyJob)keyJobs.push(keyJob);
        const pendingKey=async()=>keyJob?(keyJob.key??await keyJob.promise):undefined;
        const actualBounds = { x: bounds.x, y: bounds.y, width: width / pixelScale, height: height / pixelScale };
        if(vectorVfx){const data=compileVectorObject(vectorVfx.items,source.root,0);bitmapBytes+=width*height*4+data.byteLength;
          const entry={vectorRaster:{data,width,height},vfx:{stack:vectorVfx.stack,scale:vectorVfx.scale,domain:vectorVfx.domain??objectBounds(vectorVfx.items,{...resources,vfxBounds:false})},bounds:actualBounds,root:source.root,resolution,pixelScale,uid};
          compatibility.push(entry);if(keyJob)keyJob.entry=entry;
        }else if (meshRaster) {
          const mesh=meshRasterSource(items);bitmapBytes+=width*height*4+meshRasterBytes(mesh);
          const entry={meshRaster:{...mesh,width,height},bounds:actualBounds,root:source.root,resolution,pixelScale,uid};
          compatibility.push(entry);if(keyJob)keyJob.entry=entry;
        }else if (vectorIsolation) {
          // The transfer owns a copy; retained vector cache buffers stay attached.
          const compile = () => compileVectorObject(items, source.root, 0);
          const data = resources?.vectors ? resources.vectors.get(source, 0, compile).slice() : compile();
          // Reserve the eventual texture as well as CPU vectors. This deliberately
          // overestimates shared GPU artwork in CPU admission to bound both caches.
          bitmapBytes += width * height * 4 + data.byteLength;
          const entry={vectorRaster: {data, width, height}, bounds: actualBounds, root: source.root, resolution, pixelScale, uid};
          compatibility.push(entry);if(keyJob)keyJob.entry=entry;
        } else {
        const pool = resources?.rasterSurface?.(width,height,{hasImages:descriptor.hasImages}) || resources?.rasterSurfaces || fallbackRasterSurfaces;
        const rasterItems=items;
        const rasterize=()=>{
        const {surface, context: ctx} = pool.acquire(width, height);
        try {
          ctx.setTransform(pixelScale, 0, 0, pixelScale, -bounds.x * pixelScale, -bounds.y * pixelScale);
          drawGeometry(ctx, { drawables: rasterItems,
            ...(rasterItems.length >= 64 && width*height < bounds.fullPixels
              ? {clipBounds:{...actualBounds,guard:2/pixelScale,stats:clipping}} : {}) }, resources);
          return surface.transferToImageBitmap();
        } finally { pool.release(); }
        };
        bitmapBytes += width * height * 4;
        // Ownership supplies its epoch in bitmapKey(); this key describes pixels
        // alone so unchanged artwork can share across retained frame revisions.
        const entry={bounds:actualBounds,root:g.root,resolution,pixelScale,uid};compatibility.push(entry);
        if(keyJob)keyJob.entry=entry;
        const capture=async()=>{const rasterKey=await pendingKey();entry.bitmap=resources?.artworkBitmaps?await resources.artworkBitmaps.packetBitmap(rasterKey,rasterize):rasterize();};
        // Image decodes are a bounded moving working set. Consume them before
        // another object's preload can replace the variant used in this key.
        if(descriptor.hasImages)await capture();else rasterJobs.push(capture);
        }
        if(artwork){const next=variants||new Map();next.set(cropKey,group.compatibilityIndex);rasters.set(artwork,next);}
        }
        const raster=compatibility[group.compatibilityIndex],b=raster.bounds,origin=raster.root;
        data = new Float32Array(shapeRecord({ a: [b.x-origin.x,b.y-origin.y,b.x+b.width-origin.x,b.y+b.height-origin.y], mode: SHAPE.TEXTURE, color: [1, 1, 1, 1], transform: transformIndex }));
      } else {
        // Explicit compatibility path for runtimes without worker OffscreenCanvas.
        compatibility.push({ g, items, root: g.root, resolution, uid });
        data = new Float32Array(shapeRecord({ mode: SHAPE.TEXTURE, color: [1, 1, 1, 1], transform: transformIndex }));
      }
    } else {
      const compile=()=>compileVectorObject(items,g.root,transformIndex);
      data=resources?.vectors?resources.vectors.get(g,transformIndex,compile):compile();
    }
    group.instanceCount = data.length / SHAPE_FLOATS; shapeCount += group.instanceCount;
    requireBudget(bitmapBytes + shapeCount * SHAPE_FLOATS * 4 + (groups.length + 1) * 84);
    chunks.push(data); groups.push(group); transforms.push(g.root.x+depth.x, g.root.y+depth.y, artworkView.opacity, 1); uids.push(uid);
  };
  try {
    for (const g of geometry.orderedObjects) {
      await append(); items = g.drawables; priorSlot = g.slot;
      if (groups.length && groups.length % 16 === 0) await yieldPlaybackTask();
    }
    await append();
    const shapes = new Float32Array(shapeCount * SHAPE_FLOATS); let offset = 0;
    for (const chunk of chunks) { shapes.set(chunk, offset); offset += chunk.length; }
    const transformData = new Float32Array(transforms), uidData = new Uint32Array(uids);
    const fallbackEntries = compatibility.filter(entry => entry.items);
    const fallbackBytes = fallbackEntries.length ? JSON.stringify(fallbackEntries).length * 2 : 0;
    requireBudget(shapes.byteLength + transformData.byteLength + uidData.byteLength + bitmapBytes + fallbackBytes + groups.length * 64);
    if(keyJobs.length){
      if(cancelled())throw new DOMException('Playback preparation was superseded.', 'AbortError');
      // One event-loop turn resolves every pending digest; image captures that
      // already awaited their own key observe the settled job below.
      await Promise.all(keyJobs.map(job=>job.promise.then(key=>{job.key=key;if(job.entry)job.entry.artworkKey=key||undefined;})));
    }
    // Admit the complete packet before capturing path/glyph rasters. Images
    // consume their currently decoded variant during traversal above.
    for(let i=0;i<rasterJobs.length;i++){
      if(cancelled())throw new DOMException('Playback preparation was superseded.', 'AbortError');
      await rasterJobs[i]();if((i+1)%16===0)await yieldPlaybackTask();
    }
    const ended = performance.now();
    sharing.rasterCacheHits=(resources?.artworkBitmaps?.hits||0)-initialRasterHits;
    sharing.rasterCacheMisses=(resources?.artworkBitmaps?.misses||0)-initialRasterMisses;
    sharing.reusedVectorObjects=(resources?.vectors?.hits||0)-initialVectorHits;
    const generators = packetGenerators(report, native, geometry, parallax, vfxEnabled);
    return { key: `${revision}:${tick}`, revision, tick, frameIndex: location.index, frame, shapes, transforms: transformData, uids: uidData, groups, compatibility, generators,
      previewQuality: {reduced: reducedImages},
      connectedVfxUids:geometry.connectedVfxUids, objectCount: geometry.objects.size, shapeCount, warnings: geometry.warnings, scale, resolution, clipping, sharing, reusedGeometryObjects:geometryCache?.reusedObjects||0, cameraEnabled, storedFrames,
      workerCache: {...resources?.cacheSnapshot?.(),
        alternateDrawables:geometryCache?.alternateDrawables||0,tweenEntries:tweenCache?.entries.size||0},
      byteLength: shapes.byteLength + transformData.byteLength + uidData.byteLength + bitmapBytes + fallbackBytes + groups.length * 64 + (generators ? generators.records.byteLength + generators.table.byteLength : 0),
      compileMs: ended - started, timings: { evaluateMs: evaluated - started, geometryMs: geometrized - evaluated, compileMs: ended - geometrized } };
  } catch (error) { for (const entry of compatibility) entry.bitmap?.close(); throw error; }
}

/** One CameraVfx per worker: its scratch surface is resized per packet anyway.
 * Lazily constructed so Node test workers without OffscreenCanvas still load. */
let softwareCameraVfx = null;

/** Software playback packets carry one composited artboard bitmap instead of
 * shape records. The compatibility canvas blits it in a single draw call, so
 * low-end machines never re-evaluate or re-rasterize the scene on the UI thread. */
async function compileSoftwarePacket(report, tick, { revision = 1, scale = 1, quality = 1, entries, sampleReport, resources, maxPacketBytes = 128 * 1024 * 1024, cameraEnabled = true, vfxEnabled = true, storedFrames = false, hiddenUids, hiddenKey = '', geometryCache, tweenCache, cancelled = () => false, maxTextureDimension = 8192 } = {}) {
  resources?.artworkBitmaps?.beginFrame();
  if (typeof cameraEnabled !== 'boolean') throw new TypeError('Playback camera mode must be a boolean.');
  if (typeof storedFrames !== 'boolean') throw new TypeError('Playback stored-frame mode must be a boolean.');
  report = sampleReport || (storedFrames ? storedFrameReport(report) : report); entries ??= timeline(report);
  const started = performance.now(), location = playbackLocation(entries, tick);
  const native = evaluatedFrame(report, location.index, location.t, tick, {tweenCache}), evaluated = performance.now();
  if (!native) throw new Error('The playback tick has no native frame.');
  const sourceGeometry = geometryCache ? geometryCache.get(report, native, revision) : buildGeometry(report, native);
  const geometry = vfxEnabled ? connectedVfxGeometry(sourceGeometry,native,report,hiddenUids instanceof Set?hiddenUids:new Set(hiddenUids||[])) : vfxPreviewGeometry(sourceGeometry), geometrized = performance.now();
  const frame = { camera: cameraAtTime(report,native), background_id: native.background_id, background_id_b: native.background_id_b, background_mix: native.background_mix, duration_raw: native.duration_raw,
    ...(vfxEnabled && vfxStack(native).length ? {_stykVfx:{figure:vfxStack(native)}} : {}),
    ...(native._stykBackgroundColor !== undefined ? {_stykBackgroundColor: native._stykBackgroundColor} : {}) };
  // Visibility is baked into the bitmap: session-hidden and layer-hidden
  // figures are excluded here, matching the live hiddenUids membership view.
  const hiddenSet = hiddenUids instanceof Set ? hiddenUids : new Set(hiddenUids || []);
  const drawables = geometry.drawables.filter(item => layerVisible(report, item.obj.unique_id) && !hiddenSet.has(item.obj.unique_id));
  const uidSet = new Set(); for (const item of drawables) uidSet.add(item.obj.unique_id ?? item.slot);
  const matrix = cameraMatrix({ report, frame, cameraEnabled, view: { scale } });
  const hypot = Math.hypot(matrix[0], matrix[1]) || 1;
  const resolution = rasterResolution(hypot) * quality;
  // The bitmap covers the on-screen artboard: document pixels at view density
  // times the same resolution ratio compatibility textures would use.
  const pixelScale = Math.min(scale * resolution / hypot, maxTextureDimension / report.canvas_width, maxTextureDimension / report.canvas_height);
  const pixelWidth = Math.max(1, Math.ceil(report.canvas_width * pixelScale)), pixelHeight = Math.max(1, Math.ceil(report.canvas_height * pixelScale));
  const bitmapBytes = pixelWidth * pixelHeight * 4;
  if (bitmapBytes + 128 > maxPacketBytes) {
    const error = new Error('A playback frame exceeds its preparation memory budget.');
    error.code = 'playback_frame_budget'; error.fixedBytes = bitmapBytes + 128; throw error;
  }
  const imageItems = drawables.filter(item => item.type === 'image' && item.asset);
  const backgroundItems = backgroundImageAssets(report, frame).map(asset => ({ type: 'image', asset }));
  let reducedImages = false;
  if (resources && (imageItems.length || backgroundItems.length)) {
    const visible=playbackVisibleBounds(report,frame,cameraEnabled,scale*quality),depth=parallaxResolver(report,native,cameraEnabled),groups=new Map();
    for(const item of imageItems){const offset=depth(item.obj.unique_id),key=`${offset.x}:${offset.y}`;let group=groups.get(key);if(!group)groups.set(key,group={items:[],offset});group.items.push(item);}
    for(const {items,offset} of groups.values()){await resources.preload(items,{scale:resolution,maxDimension:maxTextureDimension,visible:visible?{...visible,x:visible.x-offset.x,y:visible.y-offset.y}:undefined});reducedImages||=Boolean(resources.pressureReduced);}
    if(backgroundItems.length){await resources.preload(backgroundItems,{scale:resolution,maxDimension:maxTextureDimension});reducedImages||=Boolean(resources.pressureReduced);}
  }
  if (cancelled()) throw new DOMException('Playback preparation was superseded.', 'AbortError');
  let bitmap = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    // Compatibility frames rasterize on this worker's CPU, like the live
    // compatibility canvas. An accelerated worker canvas flushed the whole
    // scene through the GPU-service thread that presents frames, stalling
    // editing and playback for hundreds of milliseconds on integrated GPUs.
    const canvas = new OffscreenCanvas(pixelWidth, pixelHeight), ctx = canvas.getContext('2d', {willReadFrequently: true});
    const scene = { ...geometry, drawables };
    try {
      // The artboard is the whole bitmap: document edges crop world content,
      // exactly like the clip rect the live canvas path applies on screen.
      ctx.setTransform(matrix[0] * resolution / hypot, matrix[1] * resolution / hypot,
        matrix[2] * resolution / hypot, matrix[3] * resolution / hypot,
        matrix[4] * resolution / hypot, matrix[5] * resolution / hypot);
      drawBackground(ctx, report, frame, report.canvas_width, report.canvas_height,
        { ...resources, bounds: backgroundBounds(frame, report.canvas_width, report.canvas_height, cameraEnabled, report) });
      const depth = parallaxResolver(report,native,cameraEnabled);
      const generators = vfxEnabled ? canvasGenerators(report, native, geometry, depth, {hidden: {has: uid => hiddenSet.has(uid) || !layerVisible(report, uid)}, budget: SOFTWARE_PARTICLE_BUDGET}) : null;
      drawParallaxGeometry(ctx, { drawables }, resources, depth, undefined, canvasGeneratorWalker(generators, ctx));
    } finally { releaseGeometryResources(ctx); }
    if (activeVfx(vfxStack(frame)).length) {
      // Mirror the live pass: camera-space scene, effects, then projection.
      // view scale 1 with the bitmap density as dpr lands the artboard at 0,0.
      softwareCameraVfx ??= new CameraVfx();
      softwareCameraVfx.render(ctx, { report, frame: native, view: { x: 0, y: 0, scale: 1 }, geometry: scene,
        cameraEnabled, playing: true, vfxEnabled, resourceRevision: revision }, pixelScale, resources);
      releaseVfxSurface(ctx);
    }
    bitmap = typeof canvas.transferToImageBitmap === 'function' ? canvas.transferToImageBitmap() : await createImageBitmap(canvas);
  }
  const ended = performance.now();
  return { key: `${revision}:${tick}`, revision, tick, frameIndex: location.index, frame,
    softwareFrames: true, hiddenKey,
    shapes: new Float32Array(0), transforms: new Float32Array([0, 0, 1, 1]), uids: Uint32Array.from(uidSet), groups: [],
    compatibility: bitmap ? [{ bitmap, uid: 0, software: true }] : [],
    previewQuality: { reduced: reducedImages },
    objectCount: geometry.objects.size, shapeCount: 0, warnings: geometry.warnings, scale, resolution, cameraEnabled, storedFrames,
    workerCache: { ...resources?.cacheSnapshot?.(),
      alternateDrawables: geometryCache?.alternateDrawables || 0, tweenEntries: tweenCache?.entries.size || 0 },
    byteLength: bitmapBytes + 128,
    compileMs: ended - started, timings: { evaluateMs: evaluated - started, geometryMs: geometrized - evaluated, compileMs: ended - geometrized } };
}

export function packetTransferables(packet) {
  return [packet.shapes.buffer, packet.transforms.buffer, packet.uids.buffer, ...(packet.generators ? [packet.generators.records.buffer, packet.generators.table.buffer] : []), ...packet.compatibility.flatMap(entry => entry.meshRaster ? meshRasterBuffers(entry.meshRaster) : [entry.bitmap || entry.vectorRaster?.data.buffer]).filter(Boolean)];
}

/** Shared endpoint is also exercised with a real Node worker in regression tests. */
export function createPlaybackWorkerEndpoint(postMessage) {
  let current = null, incoming = null, incomingFrames = null, incomingPatch = null, serial = 0, latestRevision = 0, running = false, suspended = false;
  const queue = [];
  let delivery = null, deliverySerial = 0;
  const releaseDelivery = () => { const prior = delivery; delivery = null; prior?.resolve(); };
  const artworkRegistry=new ArtworkRegistry();
  const geometryCache=new PlaybackGeometryCache();
  const tweenCache=new PlaybackTweenCache();
  const planning = new PlaybackPlanningService({snapshot: () => current, postMessage, onIdle: () => {void drain();}});
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length && !planning.busy && !suspended) {
        const request = queue.shift(), snapshot = current, generation = serial;
        if (!snapshot || request.revision !== snapshot.revision) continue;
        const started=request.queuedAt!==undefined?performance.now():null;
        try {
          const cancelled=()=>serial!==generation||suspended;
          const packet = await compilePlaybackPacket(snapshot.report, request.tick, { ...snapshot, artworkRegistry, geometryCache, tweenCache, cancelled });
          if (serial === generation && !suspended) {
            // Bound current-revision unadmitted packets to one. The controller
            // sends retention changes before ACK, avoiding speculative bursts
            // while its thread is delayed by presentation or memory pressure.
            const deliveryId = snapshot.acknowledgePackets ? ++deliverySerial : undefined;
            const accepted = deliveryId && new Promise(resolve => { delivery = {revision:snapshot.revision, deliveryId, resolve}; });
            try {
              postMessage({type:'packet', revision:snapshot.revision, tick:request.tick, packet, ...(deliveryId ? {deliveryId} : {}),
                ...(started!==null?{measurement:{queueMs:started-request.queuedAt,computeMs:performance.now()-started}}:{})}, packetTransferables(packet));
              if (accepted) await accepted;
            } catch (error) { releaseDelivery(); for (const entry of packet.compatibility) entry.bitmap?.close(); throw error; }
          }
          else {for (const entry of packet.compatibility) entry.bitmap?.close();if(serial===generation)queue.unshift(request);}
        } catch (error) {
          if (serial === generation) {
            if(suspended)queue.unshift(request);
            else postMessage({ type: 'error', revision: snapshot.revision, tick: request.tick, message: error.message, code: error.code });
          }
        }
        // Let load/invalidate/cancel messages interrupt between ticks, never halfway through a native pose.
        await yieldPlaybackTask();
      }
    } finally { running = false; }
  }
  return message => {
    if (message.type === 'packet-ack') {
      if (delivery?.revision === message.revision && delivery.deliveryId === message.deliveryId) releaseDelivery();
      return;
    }
    if(message.type==='interaction'){suspended=Boolean(message.active);if(!suspended)void drain();return;}
    if (planning.receive(message)) return;
    if (message.type === 'patch-chunk') {
      if (message.revision < latestRevision) return;
      try {
        if (current?.revision !== message.revision) throw new Error('Playback patches require a complete document snapshot.');
        if (message.chunk.header) incomingPatch = {revision: message.revision, patch: applyDocumentChunk(null, message.chunk)};
        else {
          if (incomingPatch?.revision !== message.revision) throw new Error('Playback patch chunks arrived before their header.');
          applyDocumentChunk(incomingPatch.patch, message.chunk);
        }
        postMessage({type: 'load-ack', revision: message.revision, sequence: message.sequence});
      } catch (error) { postMessage({type: 'load-error', revision: message.revision, message: error.message}); }
    } else if (message.type === 'patch-complete') {
      if (incomingPatch?.revision !== message.revision || current?.revision !== message.revision) return;
      try {
        applyPlaybackPatch(current.report, incomingPatch.patch);
        // Retained geometry drawables still reference the superseded figure
        // objects; force their slots to rebuild against the patched table.
        const dirty = new Set();
        for (const entry of incomingPatch.patch.figureUpdates ?? []) dirty.add(entry.figure?.figure_type_id);
        for (const figure of incomingPatch.patch.figure_types ?? []) dirty.add(figure?.figure_type_id);
        dirty.delete(undefined);
        if (dirty.size) geometryCache.markFiguresDirty(dirty);
        invalidateEvaluationCaches(current.report); refreshSampling(current); incomingPatch = null;
        postMessage({type: 'loaded', revision: message.revision, sequence: message.sequence});
      } catch (error) { postMessage({type: 'load-error', revision: message.revision, message: error.message}); }
    } else if (message.type === 'frame-chunk') {
      if (message.revision < latestRevision) return;
      try {
        if (current?.revision !== message.revision) throw new Error('Playback frame updates require a complete document snapshot.');
        if (message.chunk.header) incomingFrames = { revision: message.revision, report: applyDocumentChunk(null, message.chunk) };
        else {
          if (incomingFrames?.revision !== message.revision) throw new Error('Playback frame chunks arrived before their header.');
          applyDocumentChunk(incomingFrames.report, message.chunk);
        }
        postMessage({ type: 'load-ack', revision: message.revision, sequence: message.sequence });
      } catch (error) { postMessage({ type: 'load-error', revision: message.revision, message: error.message }); }
    } else if (message.type === 'frame-complete') {
      if (incomingFrames?.revision !== message.revision || current?.revision !== message.revision) return;
      try {
        const updates = incomingFrames.report.frames;
        if (!Array.isArray(updates) || updates.some(entry => !Number.isInteger(entry.index) || entry.index < 0 || entry.index >= current.report.keyframes.length || !Array.isArray(entry.frame?.objects)))
          throw new Error('Playback frame update targets are invalid.');
        for (const { index, frame } of updates) current.report.keyframes[index] = frame;
        invalidateEvaluationCaches(current.report);
        refreshSampling(current); incomingFrames = null;
        postMessage({ type: 'loaded', revision: message.revision, sequence: message.sequence });
      } catch (error) { postMessage({ type: 'load-error', revision: message.revision, message: error.message }); }
    } else if (message.type === 'load-chunk') {
      if (message.revision < latestRevision) return;
      latestRevision = message.revision;
      try {
        if (message.chunk.header) {
          planning.cancel();
          tweenCache.clear();
          serial++; releaseDelivery(); queue.length = 0; current?.resources.dispose(); current = null;
          incoming = { ...message.options, revision: message.revision, report: applyDocumentChunk(null, message.chunk) };
        } else {
          if (incoming?.revision !== message.revision) throw new Error('Playback snapshot chunks arrived before their header.');
          applyDocumentChunk(incoming.report, message.chunk);
        }
        postMessage({ type: 'load-ack', revision: message.revision, sequence: message.sequence });
      } catch (error) { postMessage({ type: 'load-error', revision: message.revision, message: error.message }); }
    } else if (message.type === 'load-native-chunk') {
      if(message.revision < latestRevision) return;
      try {
        if(incoming?.revision !== message.revision || incoming.completing) throw new Error('Native frames require a pending snapshot.');
        const {buffer,position,meta}=message;
        if(!(buffer instanceof ArrayBuffer) || !buffer.byteLength || buffer.byteLength>NATIVE_PLAYBACK_CHUNK_BYTES ||
          !Number.isSafeInteger(position) || position<0) throw new Error('Invalid native snapshot chunk.');
        if(meta) {
          if(position!==0 || incoming.native || meta.version!==1 || !Number.isSafeInteger(meta.byteLength) ||
            meta.byteLength<4 || meta.byteLength>MAX_NATIVE_PLAYBACK_BYTES || !Number.isSafeInteger(meta.sourceOffset) || meta.sourceOffset<0)
            throw new Error('Invalid native snapshot extent.');
          incoming.native={bytes:new Uint8Array(meta.byteLength),meta,position:0};
        }
        const target=incoming.native;
        if(!target || position!==target.position || position+buffer.byteLength>target.bytes.byteLength)
          throw new Error('Native snapshot chunks arrived out of order.');
        target.bytes.set(new Uint8Array(buffer),position);target.position+=buffer.byteLength;
        postMessage({type:'load-ack',revision:message.revision,sequence:message.sequence});
      } catch(error) {
        incoming=null;
        postMessage({type:'load-error',revision:message.revision,message:error.message});
      }
    } else if (message.type === 'load-complete') {
      if (message.revision !== incoming?.revision || message.revision < latestRevision) return;
      if(incoming.completing) return;
      const snapshot=incoming,generation=serial; snapshot.completing=true;
      // Decoding yields cooperatively. Only this exact incoming owner can be
      // published; invalidation/replacement cancels it before the next slice.
      void (async()=>{
        try {
          if(snapshot.native) {
            await materializePlaybackSnapshot(snapshot.report,snapshot.native,
              {isCancelled:()=>incoming!==snapshot || serial!==generation});
            delete snapshot.native;
          }
          if(incoming!==snapshot || serial!==generation) return;
          delete snapshot.completing;
          current = refreshSampling({ ...snapshot, resources: new PlaybackResources({...snapshot, preview: true, maxBytes: snapshot.maxAssetBytes || (snapshot.maxPacketBytes || 128 * 1024 * 1024) / 4}) }); incoming = null;
          postMessage({ type: 'loaded', revision: message.revision, sequence: message.sequence });
        } catch(error) {
          if(incoming!==snapshot || serial!==generation) return;
          incoming=null;
          postMessage({type:'load-error',revision:message.revision,message:error.message});
        }
      })();
    } else if (message.type === 'load') {
      planning.cancel();
      tweenCache.clear();
      serial++; releaseDelivery(); queue.length = 0; current?.resources.dispose();
      latestRevision = message.revision; incoming = null;
      current = refreshSampling({ ...message, resources: new PlaybackResources({...message, preview: true, maxBytes: message.maxAssetBytes || (message.maxPacketBytes || 128 * 1024 * 1024) / 4}) });
      postMessage({ type: 'loaded', revision: message.revision });
    } else if (message.type === 'invalidate') {
      planning.cancel();
      serial++; releaseDelivery(); latestRevision = message.revision; queue.length = 0; incoming = null; incomingFrames = null; incomingPatch = null;
      tweenCache.clear();
      if (message.retainDocument && current) { current.resources.previewScale = 1; current.resources.previewPressureScale = undefined; current.resources.previewRecovery = null; geometryCache.retainRevision(message.revision);invalidateEvaluationCaches(current.report); current = refreshSampling({ ...current, ...message.options, revision: message.revision }); }
      else { geometryCache.clear();artworkRegistry.clear();current?.resources.dispose(); current = null; }
    } else if (message.type === 'retain' && message.revision === current?.revision) {
      const keep = new Set(message.ticks);
      for (let i = queue.length - 1; i >= 0; i--) if (!keep.has(queue[i].tick)) queue.splice(i, 1);
    } else if (message.type === 'prepare' && message.revision === current?.revision) {
      const measured=new Set((message.measuredTicks||[]).slice(0,120));
      for (const tick of message.ticks) if (!queue.some(entry => entry.tick === tick)) queue.push({ revision: message.revision, tick,...(measured.has(tick)?{queuedAt:performance.now()}:{}) });
      void drain();
    }
  };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && !globalThis.document) {
  const receive = createPlaybackWorkerEndpoint((message, transfer) => self.postMessage(message, transfer));
  self.addEventListener('message', event => receive(event.data));
}
