import {parallaxResolver,translatedPlan} from './layer-parallax.mjs';
import {drawParallaxGeometry} from './parallax-draw.mjs';
import { buildGeometry, drawGeometry, releaseGeometryResources } from "./pivot/geometry.mjs";
import { drawBackground, backgroundBounds } from "./pivot/background.mjs";
import { cameraMatrix, objectBounds } from "./renderer-geometry.mjs";
import { layerVisible } from "./layers.mjs";
import {checkExportContext} from './export-canvas.mjs';
import {downsampleExportPixels} from './export-sampling.mjs';
import {applySceneVfx, hasDrawableVfx} from './vfx-canvas.mjs';
import {vfxStack,vfxPadding} from './vfx.mjs';

/** Share one scheduling deadline across objects and tiles. A timer per object
 * incurs Chromium's nested-timer delay thousands of times on dense 4K frames. */
function exportYield() {
  let deadline = performance.now() + 8;
  return async () => {
    if (performance.now() < deadline) return;
    await new Promise(resolve => setTimeout(resolve, 0));
    deadline = performance.now() + 8;
  };
}

/** Frame-local groups: compute bounds once, keep painter order and whole opacity
 * groups. Unknown media dimensions and effect domains take the uncropped path. */
export function exportDrawGroups(geometry, resources) {
  const groups = [];
  for (const item of geometry.drawables) {
    let group = groups.at(-1);
    if (!group || group.slot !== item.slot) {group = {slot: item.slot, items: []}; groups.push(group);}
    group.items.push(item);
  }
  for (const group of groups) {
    const uncertain = group.items.some(item => hasDrawableVfx(item) ||
      // Without explicit display dimensions, actual decoded dimensions control
      // placement. Unverified asset metadata must never hide a visible image.
      (item.type === 'image' && (!(item.asset?.display_width > 0) || !(item.asset?.display_height > 0))));
    group.bounds = uncertain ? null : objectBounds(group.items, resources);
    // A rotated square cap extends farther on each axis than a round cap.
    // Keep an extra full stroke width instead of relying on preview bounds.
    if (group.bounds) {
      const pad = group.items.reduce((n,item) => {
        if (item.seg?.segment_kind !== 'squareLine') return n;
        const bits = item.fig?.segment_decode?.global_style?.u28;
        const outline = bits ? Math.abs(new Float32Array(new Uint32Array([bits]).buffer)[0] * Number(item.obj.scale ?? 1)) : 0;
        return Math.max(n,Math.abs(item.thickness || 0) + (Number.isFinite(outline) ? 2*outline : 0));
      },0);
      group.bounds = {x:group.bounds.x-pad,y:group.bounds.y-pad,width:group.bounds.width+2*pad,height:group.bounds.height+2*pad};
    }
  }
  return groups;
}

export function exportGroupOutside(bounds, plan) {
  if (!bounds) return false;
  const [a,b,c,d,e,f] = plan.matrix, {x,y,width,height} = bounds;
  const x0 = a*x+c*y+e, y0 = b*x+d*y+f;
  const xs = [x0,x0+a*width,x0+c*height,x0+a*width+c*height];
  const ys = [y0,y0+b*width,y0+d*height,y0+b*width+d*height];
  // Additional output-pixel coverage guard, including strongly minified paths.
  return Math.max(...xs) < -2 || Math.max(...ys) < -2 || Math.min(...xs) > plan.width+2 || Math.min(...ys) > plan.height+2;
}

/** Shared portable renderer used only by export; editor GPU state is untouched. */
export function exportFrameGeometry(report, frame) {
  const geometry = buildGeometry(report, frame);
  return {
    ...geometry,
    drawables: geometry.drawables.filter((item) =>
      layerVisible(report, item.obj.unique_id),
    ),
  };
}
export function drawExportScene(context, report, frame, geometry, resources) {
  const width = report.canvas_width,
    height = report.canvas_height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.save();
  try {
    context.scale(context.canvas.width / width, context.canvas.height / height);
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.transform(...cameraMatrix({ report, frame }));
    drawBackground(context, report, frame, width, height, {
      ...resources,
      bounds: backgroundBounds(frame, width, height, true, report),
    });
    drawParallaxGeometry(context, geometry, resources,parallaxResolver(report,frame));
  } finally {
    context.restore();
  }
  applySceneVfx(context,frame,{scale:context.canvas.width/width,outputSize:{width:context.canvas.width,height:context.canvas.height}});
}

/** Preserve painter order and native brush state while releasing each object's
 * decoded source before loading the next. Export never requests preview copies. */
export async function drawExportSceneSequential(context, report, frame, geometry, resources, viewport, yieldWork = exportYield(), groups = exportDrawGroups(geometry, resources)) {
  checkExportContext(context);
  const width = report.canvas_width, height = report.canvas_height;
  // The document→output matrix for this surface, including tile offsets.
  // Preloads use it to decode only the source region each draw samples.
  const camera = cameraMatrix({report, frame}),
    sx = (viewport?.width || context.canvas.width) / width,
    sy = (viewport?.height || context.canvas.height) / height,
    plan = {matrix: [sx * camera[0], sy * camera[1], sx * camera[2], sy * camera[3],
      sx * camera[4] - (viewport?.x || 0), sy * camera[5] - (viewport?.y || 0)],
      width: context.canvas.width, height: context.canvas.height};
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.save();
  try {
    if (viewport) context.translate(-viewport.x, -viewport.y);
    context.scale((viewport?.width || context.canvas.width) / width, (viewport?.height || context.canvas.height) / height);
    context.beginPath(); context.rect(0, 0, width, height); context.clip();
    context.transform(...camera);
    await resources.preload((report.backgrounds || []).filter(asset =>
      [frame.background_id, ...(frame.background_mix ? [frame.background_id_b] : [])].includes(asset.background_id) &&
      ![2,3,4].includes(asset.kind) && asset.color === undefined).map(asset => ({type: 'image', asset})), {plan});
    checkExportContext(context);
    drawBackground(context, report, frame, width, height, {...resources, bounds: backgroundBounds(frame, width, height, true, report)});
    const strokeState = {width: 1},parallax=parallaxResolver(report,frame);
    for (const {items,bounds} of groups) {
      const depth=parallax(items[0].obj.unique_id);
      const itemPlan = translatedPlan(plan,depth);
      const skipPaint = exportGroupOutside(bounds, itemPlan);
      if (!skipPaint) await resources.preload(items, {plan:itemPlan});
      checkExportContext(context);
      context.save();try{context.translate(depth.x,depth.y);drawGeometry(context, {drawables: items, strokeState, skipPaint}, resources);}finally{context.restore();}
      checkExportContext(context);
      await yieldWork();
    }
  } finally {context.restore(); releaseGeometryResources(context, {retainCanvases: true});}
  applySceneVfx(context,frame,{scale:(viewport?.width||context.canvas.width)/width,origin:{x:viewport?.x??0,y:viewport?.y??0},outputSize:{width:viewport?.width||context.canvas.width,height:viewport?.height||context.canvas.height}});
}

/** Keep opacity/outline scratch surfaces tile-sized for large exports. Guard
 * pixels keep antialiasing continuous across tile boundaries. The final output
 * canvas retains the requested dimensions and every tile samples originals. */
export async function drawExportSceneTiled(context, report, frame, geometry, resources, tileSize = 1024, tile, factor = 1) {
  checkExportContext(context);
  if (!Number.isInteger(tileSize) || tileSize < 1 || tileSize > 1024 || ![1, 2].includes(factor))
    throw new Error('Invalid export tile dimensions.');
  const width = context.canvas.width, height = context.canvas.height;
  const yieldWork = exportYield();
  const groups = exportDrawGroups(geometry, resources);
  if (factor === 1 && width <= tileSize && height <= tileSize) return drawExportSceneSequential(context, report, frame, geometry, resources);
  // Reuse the worker's tile and its opacity/outline contexts across frames.
  // Resizing releases pixels without accumulating thousands of GPU contexts.
  tile ??= new OffscreenCanvas(1, 1);
  const tileContext = tile.getContext('2d', {
    willReadFrequently: context.getContextAttributes?.().willReadFrequently === true,
  }), guard = 2 * factor + vfxPadding(vfxStack(frame),width*factor/report.canvas_width,Math.max(width,height)*factor);
  checkExportContext(tileContext);
  context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = factor > 1;
  context.imageSmoothingQuality = 'low';
  try {
    for (let y = 0; y < height; y += tileSize) for (let x = 0; x < width; x += tileSize) {
      const w = Math.min(tileSize, width - x), h = Math.min(tileSize, height - y);
      const left = x ? guard : 0, top = y ? guard : 0;
      tile.width = w * factor + left + (x + w < width ? guard : 0);
      tile.height = h * factor + top + (y + h < height ? guard : 0);
      await drawExportSceneSequential(tileContext, report, frame, geometry, resources,
        {width: width * factor, height: height * factor, x: x * factor - left, y: y * factor - top}, yieldWork, groups);
      checkExportContext(context); checkExportContext(tileContext);
      // Downsample each 2× tile directly with the same premultiplied box filter.
      // No full-size supersampled canvas is ever allocated.
      if (factor === 2) {
        const pixels = tileContext.getImageData(left, top, w * factor, h * factor).data;
        context.putImageData(new ImageData(downsampleExportPixels(pixels, w, h), w, h), x, y);
      } else context.drawImage(tile, left, top, w, h, x, y, w, h);
      await yieldWork();
    }
    checkExportContext(context);
  } finally {releaseGeometryResources(tileContext, {retainCanvases: true}); tile.width = tile.height = 1;}
}
