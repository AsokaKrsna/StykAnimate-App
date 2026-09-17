import {createImageFigure} from './media-authoring.mjs';

export const DRAWING_TILE = 64;
export const DRAWING_MAX_PIXELS = 16 * 1024 * 1024;
export const DRAWING_BLEED = 32;
export const EMPTY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
export const drawingMetadata = figure => figure?._styk?.drawing;
export const isDrawingLayer = layer => layer?.drawing?.version === 1;
export function drawingId() { return `cel-${globalThis.crypto.randomUUID()}`; }
export function drawingDimensions(width,height,pixelsPerUnit=1) {
  if (![1,2,4].includes(pixelsPerUnit)) throw new Error('Choose 1×, 2× or 4× drawing resolution.');
  const w=Math.ceil((width+2*DRAWING_BLEED)*pixelsPerUnit),h=Math.ceil((height+2*DRAWING_BLEED)*pixelsPerUnit);
  if (![w,h].every(n=>Number.isInteger(n)&&n>0&&n<=8192)||w*h>DRAWING_MAX_PIXELS)
    throw new Error('The drawing exceeds the 16 megapixel paint area. Choose 1× or a smaller stage.');
  return {width:w,height:h,pixelsPerUnit,bytes:w*h*4};
}
export function createDrawingFigure({width,height,pixelsPerUnit=1,figureTypeId=1,celId=drawingId(),origin={x:-DRAWING_BLEED,y:-DRAWING_BLEED},dataUrl=EMPTY_PNG,empty=true}={}) {
  const figure=createImageFigure({width,height,dataUrl,figureTypeId,name:'Drawing'});
  figure._styk.drawing={version:1,celId,width,height,pixelsPerUnit,origin:{...origin},crop:{x:0,y:0,width,height},revision:0,empty};
  // A one-pixel transparent carrier is valid for an authored empty full surface.
  if(empty) {figure.image_assets[0].width=1;figure.image_assets[0].height=1;}
  figure.image_assets[0].display_width=width;figure.image_assets[0].display_height=height;
  return figure;
}
export function copyDrawingFigure(figure,typeId) {
  const result=structuredClone(figure);
  result.figure_type_id=typeId;result._styk.drawing={...result._styk.drawing,celId:drawingId()};
  return result;
}
/** Grow in pixel space without changing the object's world-space pose. */
export function drawingExpansion(figure,points,{empty=false,margin=32,maxPixels=DRAWING_MAX_PIXELS}={}) {
  const d=drawingMetadata(figure),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  if(!points.length||![...xs,...ys,margin].every(Number.isFinite))throw new Error('Invalid drawing bounds.');
  const left=Math.floor(Math.min(...xs)-margin),top=Math.floor(Math.min(...ys)-margin),right=Math.ceil(Math.max(...xs)+margin),bottom=Math.ceil(Math.max(...ys)+margin);
  if(left>=0&&top>=0&&right<=d.width&&bottom<=d.height)return null;
  const x=Math.floor((empty?left:Math.min(0,left))/64)*64,y=Math.floor((empty?top:Math.min(0,top))/64)*64;
  const width=Math.ceil(((empty?right:Math.max(d.width,right))-x)/64)*64,height=Math.ceil(((empty?bottom:Math.max(d.height,bottom))-y)/64)*64;
  if(width>8192||height>8192||width*height>Math.min(maxPixels,DRAWING_MAX_PIXELS))throw new Error('This drawing has reached its raster memory limit. Use another drawing layer for distant artwork or a lower resolution.');
  return {x,y,width,height,offsetX:-x,offsetY:-y};
}
export function expandedDrawingFigure(figure,bounds,typeId,dataUrl=EMPTY_PNG) {
  const d=drawingMetadata(figure),copy=copyDrawingFigure(figure,typeId),a=copy.image_assets[0];
  Object.assign(copy._styk.drawing,{width:bounds.width,height:bounds.height,origin:{x:d.origin.x+bounds.x/d.pixelsPerUnit,y:d.origin.y+bounds.y/d.pixelsPerUnit},crop:{x:0,y:0,width:bounds.width,height:bounds.height},empty:dataUrl===EMPTY_PNG,revision:0});
  Object.assign(a,{width:dataUrl===EMPTY_PNG?1:bounds.width,height:dataUrl===EMPTY_PNG?1:bounds.height,display_width:bounds.width,display_height:bounds.height,data_url:dataUrl});
  for(const key of ['anchor_start','anchor_end'])a[key]={x:a[key].x+bounds.offsetX,y:a[key].y+bounds.offsetY};
  return copy;
}
export function validateDrawingFigure(figure) {
  const d=drawingMetadata(figure);if(d===undefined)return;
  const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  if(!d||d.version!==1||typeof d.celId!=='string'||!/^cel-[a-zA-Z0-9-]{1,100}$/.test(d.celId)||
    ![d.width,d.height].every(n=>Number.isInteger(n)&&n>0&&n<=8192)||d.width*d.height>DRAWING_MAX_PIXELS||
    ![1,2,4].includes(d.pixelsPerUnit)||!point(d.origin)||!point(d.crop)||
    ![d.crop.x,d.crop.y,d.crop.width,d.crop.height].every(Number.isInteger)||d.crop.x<0||d.crop.y<0||d.crop.width<1||d.crop.height<1||
    d.crop.x+d.crop.width>d.width||d.crop.y+d.crop.height>d.height||!Number.isSafeInteger(d.revision)||d.revision<0||typeof d.empty!=='boolean')
    throw new Error('Invalid drawing metadata or paint dimensions.');
  const a=figure.image_assets?.[0];
  if(figure.segments?.length!==1||figure.segments[0].segment_type!=='image'||figure.image_assets.length!==1||!a?.data_url?.startsWith('data:image/png;base64,')||
    !((a.width===d.crop.width&&a.height===d.crop.height)||(d.empty&&a.width===1&&a.height===1)))
    throw new Error('A drawing needs one embedded PNG sprite matching its pixel dimensions.');
  if(a.data_url.length>96*1024*1024)throw new Error('Drawing PNG exceeds the asset limit.');
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

/** Sprite pixel → world affine, matching Pivot's image compositor exactly. */
export function drawingMatrix(item) {
  const a=item.asset,reverse=Boolean(item.seg.extra_u8_a??item.seg.extra?.[1]),mirror=Boolean(item.seg.extra_u8_b??item.seg.extra?.[2])!==Boolean(item.obj.image_text_flags);
  const start=reverse?item.end:item.start,angle=(mirror?item.angle+a.anchor_angle_rad-Math.PI:item.angle-a.anchor_angle_rad)+(reverse?Math.PI:0);
  const scale=Math.hypot(item.end.x-item.start.x,item.end.y-item.start.y)/a.anchor_length;
  const c=Math.cos(angle)*scale,s=Math.sin(angle)*scale,m=mirror?-1:1;
  return [c*m,s*m,-s,c,start.x-c*m*a.anchor_start.x+s*a.anchor_start.y,start.y-s*m*a.anchor_start.x-c*a.anchor_start.y];
}
export function transformPoint(matrix,p) {const [a,b,c,d,e,f]=matrix;return {x:a*p.x+c*p.y+e,y:b*p.x+d*p.y+f};}
export function inversePoint(matrix,p) {const [a,b,c,d,e,f]=matrix,det=a*d-b*c;if(Math.abs(det)<1e-12)throw new Error('Set a nonzero drawing scale before painting.');return {x:(d*(p.x-e)-c*(p.y-f))/det,y:(a*(p.y-f)-b*(p.x-e))/det};}
