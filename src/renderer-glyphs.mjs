import {hasDrawableVfx} from './vfx-canvas.mjs';
import {SHAPE, shapeRecord} from './renderer-geometry.mjs';

// A mask describes immutable glyph pixels, not an object pose or camera crop.
// Pixel ownership stays in the existing bounded worker/editor/GPU caches.
const masks = new WeakMap();
let serial = 0;
function maskFor(glyph) {
  const b = glyph?.bounds, path = glyph?.svg_path;
  if (!path || !b || ![b.left,b.top,b.right,b.bottom].every(Number.isFinite) || b.right <= b.left || b.bottom <= b.top) return null;
  const signature = `${b.left},${b.top},${b.right},${b.bottom}`;
  let mask = masks.get(glyph);
  if (!mask || mask.source !== path || mask.signature !== signature) {
    mask = {id: ++serial, source: path, signature, bounds: {...b}};
    masks.set(glyph, mask);
  }
  return mask;
}

/** Single solid glyphs can tint/fade after isolation. Compound figures, effects,
 * outlines and gradients retain the complete Canvas painter implementation. */
export function glyphTextureDescriptor(items, resolution, maxDimension = 4096) {
  if (items.length !== 1) return null;
  const s = items[0], asset = s.asset;
  if (s.type !== 'text' || !asset?.normalized_svg_path || !asset.bounds?.width || s._movieclipOwner ||
      hasDrawableVfx(s) || s.fig?.segment_decode?.global_style?.u28 ||
      ((s.seg?.paint || s.seg?.secondary) && Number(s.obj.color_override_raw) >>> 24 !== 255)) return null;
  let placement;
  for (const p of asset.placements || []) if (p.visible) { if (placement) return null; placement = p; }
  if (!placement) return null;
  const mask = maskFor(asset.glyphs?.[placement.glyph_index]);
  if (!mask) return null;
  const reverse = Boolean(s.seg.extra_u8_a ?? s.seg.extra?.[1]);
  const mirror = Boolean(s.seg.extra_u8_b ?? s.seg.extra?.[2]) !== Boolean(s.obj.image_text_flags);
  const start = reverse ? s.end : s.start, angle = s.angle + (reverse ? Math.PI : 0) - (mirror ? Math.PI : 0);
  const xs = Math.hypot(s.end.x-s.start.x,s.end.y-s.start.y) / asset.bounds.width * (mirror ? -1 : 1), ys = Number(s.obj.scale ?? 1);
  const spanX = mask.bounds.right-mask.bounds.left, spanY = mask.bounds.bottom-mask.bounds.top;
  if (![xs,ys,angle,resolution,placement.x,placement.y,asset.bounds.left,asset.bounds.bottom].every(Number.isFinite) || !xs || !ys || resolution <= 0) return null;
  // Quantized dimensions allow camera motion and stretching to reuse masks.
  // Extra sampling detail limits filtering under rotation; never admit a mask
  // below the requested density just to fit a very large glyph.
  const requiredX = spanX*Math.abs(xs)*resolution+4, requiredY = spanY*Math.abs(ys)*resolution+4;
  if (requiredX > maxDimension || requiredY > maxDimension) return null;
  const dimension = required => Math.min(maxDimension, 2 ** Math.ceil(Math.log2(Math.max(8,(required-4)*1.25+4))));
  const width=dimension(requiredX), height=dimension(requiredY), scaleX=(width-4)/spanX, scaleY=(height-4)/spanY;
  const left=mask.bounds.left-2/scaleX, top=mask.bounds.top-2/scaleY;
  const cos=Math.cos(angle), sin=Math.sin(angle), px=(placement.x-asset.bounds.left+left)*xs, py=(placement.y-asset.bounds.bottom+top)*ys;
  const x=start.x+px*cos-py*sin, y=start.y+px*sin+py*cos;
  const axes=[width/scaleX*xs*cos,width/scaleX*xs*sin,-height/scaleY*ys*sin,height/scaleY*ys*cos];
  return {mask,width,height,scaleX,scaleY,left,top,x,y,axes,variant:`${width}x${height}`,bytes:width*height*4,
    color:[...s.rgb.map(n=>n/255),Math.max(0,Math.min(1,s.alpha))*Math.max(0,Math.min(1,s.opacity))]};
}

export async function glyphTextureKey({mask,variant}) {
  mask.digest ??= crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['styk-glyph-mask-v1',mask.source,mask.signature])))
    .then(bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''));
  return `glyph:${await mask.digest}:${variant}`;
}

export function drawGlyphMask(ctx, glyph) {
  const {mask,scaleX,scaleY,left,top}=glyph;
  mask.path ??= new Path2D(mask.source);
  ctx.setTransform(scaleX,0,0,scaleY,-left*scaleX,-top*scaleY);
  ctx.fillStyle='#fff'; ctx.fill(mask.path,'evenodd');
}

export function glyphTextureShape(glyph, root, transform) {
  return new Float32Array(shapeRecord({a:[glyph.x-root.x,glyph.y-root.y,0,0],b:glyph.axes,
    color:glyph.color,mode:SHAPE.GLYPH,transform}));
}

export function glyphVisible(glyph, visible) {
  if (!visible) return true;
  const {x,y,axes:[ax,ay,bx,by]}=glyph;
  return Math.max(x,x+ax,x+bx,x+ax+bx)>=visible.x && Math.min(x,x+ax,x+bx,x+ax+bx)<=visible.x+visible.width &&
    Math.max(y,y+ay,y+by,y+ay+by)>=visible.y && Math.min(y,y+ay,y+by,y+ay+by)<=visible.y+visible.height;
}
