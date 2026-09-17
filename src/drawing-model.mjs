import {createImageFigure} from './media-authoring.mjs';
import {TILE_BLOB_PREFIX} from './drawing-tile-codec.mjs';

export const DRAWING_TILE = 64;
export const DRAWING_MAX_PIXELS = 16 * 1024 * 1024;
export const EMPTY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
export const drawingMetadata = figure => figure?._styk?.drawing;
export const isDrawingLayer = layer => layer?.drawing?.version === 1;
export function drawingId() { return `cel-${globalThis.crypto.randomUUID()}`; }
/** v2 drawing cel: an ordinary image figure whose raster lives in the sparse
 * tile blob on image_assets[0].styk_tiles. The carrier PNG on data_url is a
 * derived, bounds-sized preview so legacy asset consumers keep working. */
export function createDrawingFigure({pixelsPerUnit=1,figureTypeId=1,celId=drawingId()}={}) {
  if (![1,2,4].includes(pixelsPerUnit)) throw new Error('Choose 1×, 2× or 4× drawing resolution.');
  const figure=createImageFigure({width:256,height:1,dataUrl:EMPTY_PNG,figureTypeId,name:'Drawing'});
  const a=figure.image_assets[0];
  Object.assign(a,{width:1,height:1,display_width:1,display_height:1,anchor_start:{x:0,y:0},anchor_end:{x:256,y:0},anchor_length:256,anchor_angle_rad:0,drawing_anchor:{x:0,y:0}});
  figure.segments[0].length=256;
  figure._styk.drawing={version:2,celId,pixelsPerUnit,revision:0,bounds:null};
  return figure;
}
export function copyDrawingFigure(figure,typeId,celId=drawingId()) {
  const result=structuredClone(figure);
  result.figure_type_id=typeId;result._styk.drawing={...result._styk.drawing,celId};
  return result;
}
/** v1 → v2 figure with identical anchors and segment geometry, so the same
 * object poses pixel space identically. Legacy surface pixel p sat at sprite
 * point p - anchor_start - crop; tiles keep those pixel coordinates, so the
 * migrated drawing_anchor is anchor_start + crop (scaled when the pixel space
 * itself was rescaled). The caller supplies the pixel-space bounds and the new
 * cel identity the entry is retargeted to. */
export function migrateDrawingFigure(figure,typeId,{celId=drawingId(),bounds=null,anchorScale=1}={}) {
  const old=drawingMetadata(figure);if(!old||old.version!==1)throw new Error('Only v1 drawings migrate.');
  const copy=structuredClone(figure),a=copy.image_assets[0];
  copy.figure_type_id=typeId;delete a.styk_tiles;
  const anchor={x:((a.anchor_start?.x??0)+old.crop.x)*anchorScale,y:((a.anchor_start?.y??0)+old.crop.y)*anchorScale};
  Object.assign(a,{data_url:EMPTY_PNG,width:1,height:1,display_width:1,display_height:1,drawing_anchor:anchor});
  copy._styk.drawing={version:2,celId,pixelsPerUnit:old.pixelsPerUnit,revision:0,bounds:bounds?{...bounds}:null};
  return copy;
}
/** Pixel-space artwork bounds for either drawing version, or null when empty. */
export function drawingPixelBounds(figure) {
  const d=drawingMetadata(figure);if(!d)return null;
  if(d.version===1)return{x:0,y:0,width:d.width,height:d.height};
  return d.bounds?{...d.bounds}:null;
}
/** Keep the carrier's placement fields consistent with the v2 bounds metadata
 * so the published PNG preview and bounds consumers stay correct. The derived
 * PNG covers only the bounds, so its anchor_start is the drawing_anchor
 * expressed in PNG coordinates: drawing_anchor - bounds origin. */
export function syncDrawingAsset(figure) {
  const d=drawingMetadata(figure),a=figure?.image_assets?.[0];if(!a||d?.version!==2)return;
  const anchor=a.drawing_anchor??{x:0,y:0},b=d.bounds;
  const start=b?{x:anchor.x-b.x,y:anchor.y-b.y}:{x:anchor.x,y:anchor.y};
  Object.assign(a,{display_width:Math.max(1,b?.width??1),display_height:Math.max(1,b?.height??1),anchor_start:start,anchor_end:{x:start.x+a.anchor_length,y:start.y}});
}
const integerRect=r=>r&&[r.x,r.y,r.width,r.height].every(Number.isSafeInteger)&&r.width>0&&r.height>0&&r.width<=16384&&r.height<=16384&&r.width*r.height<=4*DRAWING_MAX_PIXELS;
export function validateDrawingFigure(figure) {
  const d=drawingMetadata(figure);if(d===undefined)return;
  const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  const identity=typeof d?.celId!=='string'||!/^cel-[a-zA-Z0-9-]{1,100}$/.test(d.celId)||![1,2,4].includes(d.pixelsPerUnit)||!Number.isSafeInteger(d.revision)||d.revision<0;
  if(d.version===1){
    if(identity||![d.width,d.height].every(n=>Number.isInteger(n)&&n>0&&n<=8192)||d.width*d.height>DRAWING_MAX_PIXELS||
      !point(d.origin)||!point(d.crop)||
      ![d.crop.x,d.crop.y,d.crop.width,d.crop.height].every(Number.isInteger)||d.crop.x<0||d.crop.y<0||d.crop.width<1||d.crop.height<1||
      d.crop.x+d.crop.width>d.width||d.crop.y+d.crop.height>d.height||typeof d.empty!=='boolean')
      throw new Error('Invalid drawing metadata or paint dimensions.');
  } else if(d.version===2){
    if(identity||!(d.bounds===null||integerRect(d.bounds)))throw new Error('Invalid drawing metadata.');
  } else throw new Error('Invalid drawing metadata or paint dimensions.');
  const a=figure.image_assets?.[0];
  if(figure.segments?.length!==1||figure.segments[0].segment_type!=='image'||figure.image_assets.length!==1||!a?.data_url?.startsWith('data:image/png;base64,')||
    (d.version===1&&!((a.width===d.crop.width&&a.height===d.crop.height)||(d.empty&&a.width===1&&a.height===1)))||
    (d.version===2&&!((a.width===1&&a.height===1)||(d.bounds&&a.width===d.bounds.width&&a.height===d.bounds.height))))
    throw new Error('A drawing needs one embedded PNG sprite matching its pixel dimensions.');
  if(a.data_url.length>96*1024*1024)throw new Error('Drawing PNG exceeds the asset limit.');
  if(d.version===2&&a.styk_tiles!==undefined&&(typeof a.styk_tiles!=='string'||!a.styk_tiles.startsWith(TILE_BLOB_PREFIX)||a.styk_tiles.length>TILE_BLOB_PREFIX.length+96*1024*1024))throw new Error('Invalid drawing tile blob.');
  let header;try{header=Uint8Array.from(atob(a.data_url.slice(22,66)),c=>c.charCodeAt(0));}catch{throw new Error('Invalid drawing PNG header.');}
  if(header.length<24||![137,80,78,71,13,10,26,10].every((v,i)=>header[i]===v))throw new Error('Invalid drawing PNG header.');
  const view=new DataView(header.buffer);if(view.getUint32(16)!==a.width||view.getUint32(20)!==a.height)throw new Error('Drawing PNG dimensions do not match its metadata.');
}
export function validateDrawings(report) {
  const ids=new Set();for(const figure of report.figure_types??[]) {
    validateDrawingFigure(figure);const d=drawingMetadata(figure);if(!d)continue;
    if(ids.has(d.celId))throw new Error('Drawing cel identities must be unique.');ids.add(d.celId);
  }
  const layers=report._styk?.layers,sheet=report._styk?.layerSheet;if(!layers||!sheet)return;
  const figures=new Map((report.figure_types??[]).map(f=>[f.figure_type_id,f])),frames=new Map((report.keyframes??[]).map(f=>[f._styk?.frameId,f]));
  for(const [id,layer] of Object.entries(layers.byId??{}))if(layer.drawing){
    for(const key of sheet.tracks[id]?.keys??[]){if(!key.value?.frameId)continue;const frame=report._styk.frameSources?.[key.value.frameId]??frames.get(key.value.frameId);if(!frame)continue;
      const objects=frame.objects.filter(o=>layers.assignments?.[o.unique_id]===id);
      if(objects.length>1||objects.some(o=>!drawingMetadata(figures.get(o.figure_type_id))))throw new Error('Drawing layers must contain one drawing cel per exposure.');
    }
  }
}

/** Sprite pixel → world affine, matching Pivot's image compositor exactly. The
 * optional anchor selects the sprite-space origin; v2 cels anchor placement at
 * the published bounds while tiles stay anchored at drawing_anchor. */
export function drawingMatrix(item,anchor) {
  const a=item.asset,reverse=Boolean(item.seg.extra_u8_a??item.seg.extra?.[1]),mirror=Boolean(item.seg.extra_u8_b??item.seg.extra?.[2])!==Boolean(item.obj.image_text_flags);
  anchor??=a.anchor_start;
  const start=reverse?item.end:item.start,angle=(mirror?item.angle+a.anchor_angle_rad-Math.PI:item.angle-a.anchor_angle_rad)+(reverse?Math.PI:0);
  const scale=Math.hypot(item.end.x-item.start.x,item.end.y-item.start.y)/a.anchor_length;
  const c=Math.cos(angle)*scale,s=Math.sin(angle)*scale,m=mirror?-1:1;
  return [c*m,s*m,-s,c,start.x-c*m*anchor.x+s*anchor.y,start.y-s*m*anchor.x-c*anchor.y];
}
/** Tile-pixel → world affine: the coordinate space strokes and stores use. */
export function drawingPixelMatrix(item) {return drawingMatrix(item,item.asset.drawing_anchor??item.asset.anchor_start);}
export function transformPoint(matrix,p) {const [a,b,c,d,e,f]=matrix;return {x:a*p.x+c*p.y+e,y:b*p.x+d*p.y+f};}
export function inversePoint(matrix,p) {const [a,b,c,d,e,f]=matrix,det=a*d-b*c;if(Math.abs(det)<1e-12)throw new Error('Set a nonzero drawing scale before painting.');return {x:(d*(p.x-e)-c*(p.y-f))/det,y:(a*(p.y-f)-b*(p.x-e))/det};}
