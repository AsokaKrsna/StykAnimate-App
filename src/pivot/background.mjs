import {cameraAtTime} from '../camera-motion.mjs';
import {canvasPaint} from '../paint.mjs';
// Backgrounds are native ARGB; figure COLORREF colors use a different byte order.
export function backgroundColor(raw) {
  const n = Number(raw) >>> 0;
  return `rgba(${(n >>> 16) & 255},${(n >>> 8) & 255},${n & 255},${(n >>> 24) / 255})`;
}

/** UI angle in normalized background coordinates, matching the fill editor. */
export function gradientAngleFromBackground(background, fallback = 90) {
  if (background?.kind !== 3) return fallback;
  const {x1, y1, x2, y2} = background;
  if (![x1, y1, x2, y2].every(value => typeof value === 'number' && Number.isFinite(value))) return fallback;
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return fallback;
  return (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
}

/** Scene color keys replace the native fill; hiding Scene makes it transparent. */
export function sceneBackgroundColor(report, frame) {
  if (report?._styk?.layers?.fixed?.scene?.visible === false) return 0;
  return frame?._stykBackgroundColor;
}

/** A hidden Camera track uses the untransformed animation viewport everywhere. */
export function effectiveCamera(report, frame, cameraEnabled = true) {
  return cameraEnabled && report?._styk?.layers?.fixed?.camera?.visible !== false ? cameraAtTime(report,frame) : null;
}

// Native rendering decides identity from the camera values after loading.
// Its scale/angle tolerances differ from its relative comparison to zero.
export function cameraIsIdentity(camera) {
  if (!camera || camera.is_default) return true;
  const zero = (value) => {
    const magnitude = Math.abs(Number(value ?? 0));
    const epsilon = Math.fround(magnitude * Math.fround(1.25e-6));
    return magnitude <= (epsilon || Math.fround(6.25e-37));
  };
  return (
    zero(camera.x) &&
    zero(camera.y) &&
    Math.abs(Number(camera.angle_rad ?? 0)) <= 1e-12 &&
    Math.abs(Number(camera.scale ?? 1) - 1) <= Math.fround(1e-4)
  );
}

export function inverseCameraScale(camera) {
  const inverse = Math.fround(1 / Math.fround(Number(camera?.scale ?? 1)));
  if (!Number.isFinite(inverse) || inverse <= 0)
    throw new Error("Camera scale exceeds the native rendering range.");
  return inverse;
}

// Nine source slices extend edge pixels without moving or stretching the artwork.
// Source dimensions may be a downscaled preview; placement uses logical dimensions.
export function backgroundImageTiles(width, height, imageWidth, imageHeight, bounds, sourceWidth = imageWidth, sourceHeight = imageHeight) {
  const scale = Math.max(width / imageWidth, height / imageHeight);
  const w = imageWidth * scale, h = imageHeight * scale;
  const axes = (size, source, low, high) => [
    [0, 1, low, Math.max(0, -low)],
    [0, source, 0, size],
    [source - 1, 1, size, Math.max(0, high - size)],
  ];
  const tiles = [];
  for (const [sx, sw, dx, dw] of axes(w, sourceWidth, Math.min(0, bounds.x), bounds.x + bounds.width))
    for (const [sy, sh, dy, dh] of axes(h, sourceHeight, Math.min(0, bounds.y), bounds.y + bounds.height))
      if (dw > 0 && dh > 0) tiles.push([sx, sy, sw, sh, dx, dy, dw, dh]);
  return tiles;
}

// Align slice boundaries to one raster grid, then transform the image once.
// This avoids both gaps and doubled alpha at rotated/subpixel slice corners.
export function backgroundImageRaster(width, height, imageWidth, imageHeight, bounds, sourceWidth = imageWidth, sourceHeight = imageHeight) {
  const scale = Math.max(width / imageWidth, height / imageHeight);
  const density = Math.min(sourceWidth / (imageWidth * scale), sourceHeight / (imageHeight * scale),
    16382 / bounds.width, 16382 / bounds.height, Math.sqrt(31 * 1024 * 1024 / (bounds.width * bounds.height)));
  const left = Math.floor(bounds.x * density), top = Math.floor(bounds.y * density);
  const pixelWidth = Math.max(1, Math.ceil((bounds.x + bounds.width) * density) - left);
  const pixelHeight = Math.max(1, Math.ceil((bounds.y + bounds.height) * density) - top);
  const rect = {x: left / density, y: top / density, width: pixelWidth / density, height: pixelHeight / density};
  const tiles = backgroundImageTiles(width, height, imageWidth, imageHeight, rect, sourceWidth, sourceHeight).map(
    ([sx,sy,sw,sh,dx,dy,dw,dh]) => {
      const x = Math.round(dx*density)-left, y = Math.round(dy*density)-top;
      return [sx,sy,sw,sh,x,y,Math.round((dx+dw)*density)-left-x,Math.round((dy+dh)*density)-top-y];
    }).filter(tile => tile[6] > 0 && tile[7] > 0);
  return {...rect, pixelWidth, pixelHeight, tiles};
}

const imageEdgeSurfaces = new WeakMap();
function drawImageTiles(context, image, width, height, bounds) {
  const sourceWidth = image.width || image.naturalWidth, sourceHeight = image.height || image.naturalHeight;
  const tiles = backgroundImageTiles(width,height,image.naturalWidth,image.naturalHeight,bounds,sourceWidth,sourceHeight);
  if (tiles.length === 1) {context.drawImage(image, ...tiles[0]); return;}
  let surface = imageEdgeSurfaces.get(context);
  if (!surface) {
    surface = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1)
      : context.canvas.ownerDocument.createElement('canvas');
    imageEdgeSurfaces.set(context, surface);
  }
  const raster = backgroundImageRaster(width,height,image.naturalWidth,image.naturalHeight,bounds,sourceWidth,sourceHeight);
  surface.width = raster.pixelWidth; surface.height = raster.pixelHeight;
  try {
    const target = surface.getContext('2d'); target.imageSmoothingEnabled = false;
    for (const tile of raster.tiles) target.drawImage(image, ...tile);
    context.drawImage(surface, raster.x, raster.y, raster.width, raster.height);
  } finally {surface.width = surface.height = 1;}
}

// Solids and gradients are world-aligned infinite backgrounds. Their brush
// coordinates stay fixed while their painted bounds cover the camera viewport.
export function backgroundBounds(frame, width, height, cameraEnabled = true, report, viewport={x:0,y:0,width,height}) {
  const camera = effectiveCamera(report, frame, cameraEnabled);
  if (cameraIsIdentity(camera))
    return { ...viewport, clearRaster: false };
  const s = Number(camera.scale ?? 1),
    a = Number(camera.angle_rad ?? 0),
    cos = Math.cos(a),
    sin = Math.sin(a);
  const points = [
    [viewport.x, viewport.y],
    [viewport.x+viewport.width, viewport.y],
    [viewport.x+viewport.width, viewport.y+viewport.height],
    [viewport.x, viewport.y+viewport.height],
  ].map(([x, y]) => {
    const dx = (x - width / 2) * s,
      dy = (y - height / 2) * s;
    return {
      x: Math.fround(dx * cos - dy * sin + width / 2 + Number(camera.x ?? 0)),
      y: Math.fround(dx * sin + dy * cos + height / 2 + Number(camera.y ?? 0)),
    };
  });
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    padding = 2 * s;
  return {
    x: Math.min(...xs) - padding,
    y: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + 2 * padding,
    height: Math.max(...ys) - Math.min(...ys) + 2 * padding,
    // The native image clear is conditional on viewport containment, before
    // adding the paint padding. A contained zoom keeps the previous layer.
    clearRaster:
      Math.min(...xs) < 0 ||
      Math.min(...ys) < 0 ||
      Math.max(...xs) > width ||
      Math.max(...ys) > height,
  };
}

export function tweenBackground(start, end, t) {
  let a = start.background_id ?? 0,
    b = start.background_id_b || 0,
    m = start.background_mix || 0;
  const c = end.background_id ?? 0,
    d = end.background_id_b || 0,
    n = end.background_mix || 0;
  const result = () => ({
    background_id: a,
    background_id_b: b,
    background_mix: m,
  });
  if (a === c && b === d && m === n) return result();
  const duration = start.duration_raw || 1;
  let j = t * duration;
  if (Math.abs(j - Math.round(j)) < 1e-9) j = Math.round(j);
  const lerp = (x, y) => x + Math.trunc((j * (y - x)) / duration);
  let fallback = false;
  if (m && n) {
    if (a === c && b === d) m = lerp(m, n);
    else if (a === d && b === c) m = lerp(m, 255 - n);
    else fallback = true;
  } else if (m) {
    if (c === a) m = lerp(m, 0);
    else if (c === b) m = lerp(m, 255);
    else fallback = true;
  } else if (n) {
    if (a === c) {
      b = d;
      m = lerp(0, n);
    } else if (a === d) {
      a = c;
      b = d;
      m = lerp(255, n);
    } else fallback = true;
  } else {
    b = c;
    m = Math.floor((255 * j) / duration);
  }
  if (fallback) {
    a =
      start.background_mix >= 128 ? start.background_id_b : start.background_id;
    b = end.background_mix >= 128 ? end.background_id_b : end.background_id;
    if (a === b) {
      b = 0;
      m = 0;
    } else m = Math.floor((255 * j) / duration);
  }
  if (m >= 254) {
    a = b;
    b = 0;
    m = 0;
  }
  return result();
}

export function drawBackground(
  context,
  report,
  frame,
  width,
  height,
  resources = {},
) {
  const bounds = resources.bounds || { x: 0, y: 0, width, height };
  const fill = () =>
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  const override = sceneBackgroundColor(report, frame);
  if (override !== undefined) {
    context.save(); context.fillStyle = backgroundColor(override); fill(); context.restore();
    return;
  }
  function layer(id, alpha = 1) {
    const bg = report.backgrounds?.find(
      (b) => Number(b.background_id) === Number(id),
    );
    context.save();
    context.globalAlpha = alpha;
    if (!bg) {
      context.fillStyle = "#fff";
      fill();
    } else if (bg.paint) {
      context.fillStyle=canvasPaint(context,bg.paint,{x:0,y:height/2},{x:width,y:height/2},c=>c,resources.paintBounds||bounds);
      context.fillRect(bounds.x,bounds.y,bounds.width,bounds.height);
    } else if (bg.kind === 3 || bg.kind === 4) {
      let gradient;
      if (bg.kind === 4) {
        const x = bg.x1 * width,
          y = bg.y1 * height,
          outer = bg.y2 * height;
        // Native FMX keeps at least a 1% transition band, even when the
        // stored inner radius equals or exceeds the outer radius.
        if (outer <= 0) {
          context.fillStyle = backgroundColor(bg.color_a);
          fill();
          context.restore();
          return;
        }
        gradient = context.createRadialGradient(
          x,
          y,
          Math.min(Math.max(0, bg.x2 * height), 0.99 * outer),
          x,
          y,
          outer,
        );
        gradient.addColorStop(0, backgroundColor(bg.color_b));
        gradient.addColorStop(1, backgroundColor(bg.color_a));
      } else {
        gradient = context.createLinearGradient(
          bg.x1 * width,
          bg.y1 * height,
          bg.x2 * width,
          bg.y2 * height,
        );
        gradient.addColorStop(0, backgroundColor(bg.color_a));
        gradient.addColorStop(1, backgroundColor(bg.color_b));
      }
      context.fillStyle = gradient;
      fill();
    } else if (bg.kind === 2 || bg.color !== undefined) {
      context.fillStyle = backgroundColor(bg.color);
      fill();
    } else {
      const img = resources.image?.(resources.url?.(bg));
      if (img?.complete && img.naturalWidth) {
        context.imageSmoothingEnabled = false;
        drawImageTiles(context, img, width, height, bounds);
      }
    }
    context.restore();
  }
  layer(frame.background_id);
  if (frame.background_mix)
    layer(frame.background_id_b, frame.background_mix / 255);
}
