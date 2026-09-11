import { buildGeometry, drawGeometry, releaseGeometryResources } from "./pivot/geometry.mjs";
import { drawBackground, backgroundBounds } from "./pivot/background.mjs";
import { cameraMatrix } from "./renderer-geometry.mjs";
import { layerVisible } from "./layers.mjs";
import {checkExportContext} from './export-canvas.mjs';
import {downsampleExportPixels} from './export-sampling.mjs';
import {applySceneVfx} from './vfx-canvas.mjs';
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
    drawGeometry(context, geometry, resources);
  } finally {
    context.restore();
  }
  applySceneVfx(context,frame,{scale:context.canvas.width/width,outputSize:{width:context.canvas.width,height:context.canvas.height}});
}

/** Preserve painter order and native brush state while releasing each object's
 * decoded source before loading the next. Export never requests preview copies. */
export async function drawExportSceneSequential(context, report, frame, geometry, resources, viewport, yieldWork = exportYield()) {
  checkExportContext(context);
  const width = report.canvas_width, height = report.canvas_height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.save();
  try {
    if (viewport) context.translate(-viewport.x, -viewport.y);
    context.scale((viewport?.width || context.canvas.width) / width, (viewport?.height || context.canvas.height) / height);
    context.beginPath(); context.rect(0, 0, width, height); context.clip();
    context.transform(...cameraMatrix({report, frame}));
    await resources.preload((report.backgrounds || []).filter(asset =>
      [frame.background_id, ...(frame.background_mix ? [frame.background_id_b] : [])].includes(asset.background_id) &&
      ![2,3,4].includes(asset.kind) && asset.color === undefined).map(asset => ({type: 'image', asset})));
    checkExportContext(context);
    drawBackground(context, report, frame, width, height, {...resources, bounds: backgroundBounds(frame, width, height, true, report)});
    const strokeState = {width: 1}; let items = [], slot;
    const draw = async () => {
      if (!items.length) return;
      await resources.preload(items);
      checkExportContext(context);
      drawGeometry(context, {drawables: items, strokeState}, resources);
      checkExportContext(context);
    };
    for (const item of geometry.drawables) {
      if (items.length && item.slot !== slot) {await draw(); items = []; await yieldWork();}
      items.push(item); slot = item.slot;
    }
    await draw();
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
        {width: width * factor, height: height * factor, x: x * factor - left, y: y * factor - top}, yieldWork);
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
