import {drawingMetadata,isDrawingLayer,createDrawingFigure,copyDrawingFigure,migrateDrawingFigure,EMPTY_PNG} from './drawing-model.mjs';
import {drawingSheetPlan,drawingSheetPublish} from './editor-layer-sheet.mjs';
import {sheetKeyAt,MAX_SHEET_TICKS} from './layer-sheet.mjs';
import {createFrame,createObject} from './demo.mjs';
import {pixelChangeBytes} from './drawing-pixels.mjs';

export function assertDrawingTargets(editor,ids) {
  if(!ids.length)throw new Error('Choose a drawing layer.');
  for(const id of ids){const layer=editor.getLayer(id);if(!isDrawingLayer(layer))throw new Error('Choose a drawing layer or create a new drawing layer.');if(layer.locked||!layer.visible)throw new Error(`Show and unlock ${layer.name} before drawing.`);}
}
export function applyDrawingCommand(editor,command,direction) {
  if(command.kind!=='drawing-pixels')return false;
  const figure=editor.report.figure_types.find(f=>drawingMetadata(f)?.celId===command.celId);
  if(!figure)throw new Error('The drawing history references a missing cel.');
  editor.drawingResources.apply(figure,command.tiles,direction);
  const d=drawingMetadata(figure);
  if(d.version===2)d.bounds=command[direction==='before'?'beforeBounds':'afterBounds']??null;
  editor._revision=command[`${direction}Revision`];editor._invalidate({timing:false});
  editor._emit('history',{label:command.label,definition:true,drawing:true});return true;
}
export const editorDrawingMethods={
  addDrawingFrame(id=this.activeLayerId,tick=this.tick) {
    assertDrawingTargets(this,[id]);
    const track=this.report._styk.layerSheet.tracks[id],onKey=track.keys.some(key=>key.tick===tick);
    if(onKey&&tick<track.end)return this.nextDrawing([id],{blank:true,length:1,tick});
    return this.drawingKey([id],tick,{blank:true});
  },
  createDrawingLayer(name='Drawing') {
    return this.movieclipBatch('New drawing layer',()=>{
      const layer=this.createLayer(name,{drawing:true});this.drawingKey([layer.id],0,{blank:true});return this.getLayer(layer.id);
    });
  },
  drawingTarget(id=this.activeLayerId,tick=this.tick) {
    assertDrawingTargets(this,[id]);const track=this.report._styk.layerSheet.tracks[id],{key,next}=sheetKeyAt(track,tick);
    if(!key||tick>=track.end)throw new Error('Insert a Blank drawing or Copy drawing here before painting.');
    const frame=key.value?.frameId?this.getFrameById(key.value.frameId):null;
    const object=frame?.objects.find(o=>this.layerForUid(o.unique_id)===id),figure=object&&this.report.figure_types.find(f=>f.figure_type_id===object.figure_type_id);
    if(figure&&!drawingMetadata(figure))throw new Error('Convert this image to a drawing before painting.');
    return {id,key,end:next?.tick??track.end,object,figure};
  },
  drawingKey(ids=[this.activeLayerId],tick=this.tick,{blank=false}={}) {
    assertDrawingTargets(this,ids);const plan=drawingSheetPlan(this,ids),added=[],forks=[];let type=this.report.figure_types.reduce((n,f)=>Math.max(n,f.figure_type_id+1),1),changed=false;
    for(const id of ids){const track=plan.get(id),{key}=sheetKeyAt(track,tick);if(!blank&&key?.tick===tick)continue;
      const sourceKey=sheetKeyAt(track,Math.min(tick,track.end-1)).key,source=sourceKey?.value?.frameId?this.getFrameById(sourceKey.value.frameId):null;
      const frame=source?structuredClone(source):createFrame();
      if(!blank)for(const object of frame.objects){const old=this.report.figure_types.find(f=>f.figure_type_id===object.figure_type_id),copy=copyDrawingFigure(old,type++);object.figure_type_id=copy.figure_type_id;added.push(copy);forks.push([old,copy]);}
      plan.definitions=[...this.report.figure_types,...added];
      if(!track.keys.length&&tick>0)plan.write(id,0,createFrame(),{blank:true,easing:{interpolation:'constant'}});
      plan.write(id,tick,frame,{blank,easing:{interpolation:'constant'}});changed=true;
    }
    if(!changed)return false;
    if(forks.length){this.drawingResources.checkForks(forks.map(([old])=>old));}
    const result=drawingSheetPublish(this,plan,blank?'Blank drawing':'Copy drawing',{assets:added.length?{figure_types:{added}}:undefined});
    for(const [old,copy] of forks)this.drawingResources.fork(old,copy);return result;
  },
  nextDrawing(ids=[this.activeLayerId],{blank=true,length=1,tick=this.tick}={}) {
    assertDrawingTargets(this,ids);if(!Number.isInteger(length)||length<1||length>65535)throw new Error('Choose an exposure length of 1–65,535 frames.');
    const spans=ids.map(id=>({id,...this.sheetSpan(id,tick)}));
    for(const {id,end} of spans)if(Math.max(end,this.report._styk.layerSheet.tracks[id].end)+length>MAX_SHEET_TICKS)throw new Error('This exposure exceeds the timeline limit.');
    return this.movieclipBatch(blank?'Next blank drawing':'Next copied drawing',()=>{
      for(const {id,end} of spans){
        // Split before shifting: copying at an existing next key must use the
        // preceding cel, not the next exposure's content.
        this.sheetInsertFrames([id],end,length);this.drawingKey([id],end,{blank});
      }
      this.seek(spans[0].end);return true;
    });
  },
  extendDrawing(ids=[this.activeLayerId],count=1) {
    assertDrawingTargets(this,ids);if(!Number.isInteger(count)||count<1||count>65535)throw new Error('Choose a positive exposure extension.');
    const spans=ids.map(id=>({id,...this.drawingTarget(id)}));
    for(const {id} of spans)if(this.report._styk.layerSheet.tracks[id].end+count>MAX_SHEET_TICKS)throw new Error('This exposure exceeds the timeline limit.');
    return this.movieclipBatch('Extend drawing exposure',()=>{for(const {id,end} of spans)this.sheetInsertFrames([id],end,count);return true;});
  },
  prepareDrawingCel({pixelsPerUnit=1,world={x:0,y:0}}={}) {
    const target=this.drawingTarget();if(target.figure)return target;
    const figure=createDrawingFigure({pixelsPerUnit,figureTypeId:this.report.figure_types.reduce((n,f)=>Math.max(n,f.figure_type_id+1),1)});
    const uid=this.getLayerFigureUids(target.id)[0]??this._nextUid;
    const object=createObject(figure,uid,world.x,world.y,{scale:1/pixelsPerUnit});
    return {...target,figure,object,created:true};
  },
  /** Publish a resampled cel: the tile list and bounds come from the worker;
   * pixel (0,0) stays fixed so anchors and the segment scale with the ratio. */
  resampleDrawing(target,{pixelsPerUnit,tiles,bounds}) {
    assertDrawingTargets(this,[target.id]);const current=this.drawingTarget(target.id);
    if(current.key.id!==target.key.id||current.figure!==target.figure)throw new Error('The drawing changed before resampling.');
    const old=drawingMetadata(target.figure),ratio=pixelsPerUnit/old.pixelsPerUnit,typeId=this.report.figure_types.reduce((n,f)=>Math.max(n,f.figure_type_id+1),1);
    const figure=old.version===1?migrateDrawingFigure(target.figure,typeId,{bounds,anchorScale:ratio}):copyDrawingFigure(target.figure,typeId),asset=figure.image_assets[0];
    const fd=drawingMetadata(figure);fd.pixelsPerUnit=pixelsPerUnit;fd.bounds=bounds?{...bounds}:null;fd.revision=0;
    // Anchors sit in pixel space: rescaling pixels rescales them. anchor_start
    // stays pinned to drawing_anchor and anchor_end keeps its direction.
    const direction=asset.anchor_length?{x:(asset.anchor_end.x-asset.anchor_start.x)/asset.anchor_length,y:(asset.anchor_end.y-asset.anchor_start.y)/asset.anchor_length}:{x:1,y:0};
    if(old.version===2){const anchor={x:(asset.drawing_anchor?.x??0)*ratio,y:(asset.drawing_anchor?.y??0)*ratio};asset.anchor_start={...anchor};asset.drawing_anchor=anchor;}
    asset.anchor_length*=ratio;asset.anchor_end={x:asset.anchor_start.x+direction.x*asset.anchor_length,y:asset.anchor_start.y+direction.y*asset.anchor_length};figure.segments[0].length*=ratio;
    delete asset.styk_tiles;asset.data_url=EMPTY_PNG;asset.width=asset.height=asset.display_width=asset.display_height=1;
    const object=structuredClone(target.object);object.figure_type_id=figure.figure_type_id;object.scale*=old.pixelsPerUnit/pixelsPerUnit;if(object.len_flag)object.lengths=object.lengths.map(n=>n*ratio);
    const plan=drawingSheetPlan(this,[target.id]);plan.definitions=[...this.report.figure_types,figure];plan.write(target.id,target.key.tick,createFrame([object]),{easing:{interpolation:'constant'}});
    const result=drawingSheetPublish(this,plan,'Resample drawing',{assets:{figure_types:{added:[figure]}}});
    this.drawingResources.install(figure,tiles);return result;
  },
  commitDrawingPixels(target,tiles,label='Brush stroke') {
    if(!tiles.length)return false;assertDrawingTargets(this,[target.id]);
    const current=this.drawingTarget(target.id);
    if(current.key.id!==target.key.id)throw new Error('The drawing exposure changed before the edit finished.');
    const bytes=pixelChangeBytes(tiles);if(bytes>this.historyBytes)throw new Error('This pixel edit exceeds the undo budget. Use a smaller area or shorter stroke.');
    const celId=drawingMetadata(target.figure).celId,beforeBounds=drawingMetadata(target.figure).bounds??null;
    this.drawingResources.checkHistory({kind:'drawing-pixels',celId,tiles},'after');
    const commit=()=>{
      if(target.created||target.migratedFrom){
        const plan=drawingSheetPlan(this,[target.id]);plan.layers.assignments[target.object.unique_id]=target.id;plan.definitions=[...this.report.figure_types,target.figure];
        plan.write(target.id,target.key.tick,createFrame([target.object]),{easing:{interpolation:'constant'}});
        drawingSheetPublish(this,plan,target.created?'Create drawing cel':'Migrate drawing',{assets:{figure_types:{added:[target.figure]}},nextUid:Math.max(this._nextUid,(target.object.unique_id??0)+1)});
      }
      if(target.migratedFrom)this.drawingResources.retarget(target.migratedFrom,target.figure);
      const figure=this.report.figure_types.find(f=>drawingMetadata(f)?.celId===celId);
      this.drawingResources.apply(figure,tiles,'after');
      this._record({kind:'drawing-pixels',celId,tiles,label,beforeBounds,afterBounds:drawingMetadata(figure).bounds??null,precomputedBytes:bytes});
      this.selectSheetLayer(target.id);this._invalidate({timing:false});this._emit('edit',{label,definition:true,drawing:true});return true;
    };
    // Cel creation and migration change sheet structure. Subsequent strokes are
    // pixel commands and must not rebuild timing or invalidate timeline rows.
    return (target.created||target.migratedFrom)?this.movieclipBatch(label,commit):commit();
  },
};
