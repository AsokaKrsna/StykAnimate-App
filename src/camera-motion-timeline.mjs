import {CAMERA_MOTION_TYPES} from './camera-motion.mjs';
export function motionRows(editor){return editor.getCameraMotions().map(clip=>({id:clip.id,kind:'motion',name:CAMERA_MOTION_TYPES[clip.type],clip,visible:clip.enabled,locked:editor.getLayer('camera').locked}));}
export function paintMotionRow(host,ctx,layer,y){
  const {clip}=layer,g=host.gesture,selected=host.editor._selectedCameraMotion===clip.id;
  let start=clip.start,duration=clip.duration;
  if(g?.kind==='camera-motion'&&g.id===clip.id){start=g.start;duration=g.duration;}
  const left=start*host.pxPerTick-host._offsetX(),width=duration*host.pxPerTick;
  ctx.fillStyle=host.colors.line;ctx.fillRect(0,y+31,host.width,1);
  ctx.globalAlpha=clip.enabled?1:.4;ctx.beginPath();ctx.roundRect(left+1,y+6,Math.max(2,width-2),20,5);
  ctx.fillStyle=selected?host.colors.selected:host.colors['camera-tint'];ctx.fill();ctx.strokeStyle=host.colors.accent;ctx.stroke();
  ctx.save();ctx.beginPath();ctx.rect(left+5,y+6,Math.max(0,width-10),20);ctx.clip();ctx.font=`11px ${host.font}`;ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle=host.colors.ink;ctx.fillText(CAMERA_MOTION_TYPES[clip.type],left+9,y+20);ctx.restore();ctx.globalAlpha=1;
  if(selected){ctx.fillStyle=host.colors.accent;ctx.fillRect(left+3,y+12,2,8);ctx.fillRect(left+width-5,y+12,2,8);}
}
export const cameraMotionTimelineMethods={
  _refreshMotionRows(){
    const clips=new Map(this.editor.getCameraMotions().map(c=>[c.id,c]));
    if(!this.cameraMotionsCollapsed&&this.tracks.filter(t=>t.kind==='motion').length!==clips.size)return this._reindex();
    for(const row of this.tracks)if(row.kind==='motion'){
      const clip=clips.get(row.id);if(!clip)return this._reindex();
      row.clip=clip;row.visible=clip.enabled;
      Object.assign(this.trackById.get(row.id),{clip,visible:clip.enabled});
    }
    this.motionState=this.editor.report._styk.cameraMotion;this.labelSignature=null;
  },
  _setCameraMotionsCollapsed(collapsed){
    if(Boolean(this.cameraMotionsCollapsed)===collapsed)return;
    const count=this.editor.getCameraMotions().length,scroll=this._offsetY();
    this._cancelGesture();this.cameraMotionsCollapsed=collapsed;
    if(collapsed&&this.editor._selectedCameraMotion){this.editor._selectedCameraMotion=null;this.selectedTrackId='camera';this.selectedLayers=new Set(['camera']);}
    this.anchor=null;this.hover=null;this._reindex();
    if(scroll>32)this.scroll.scrollTop=Math.max(0,scroll+(collapsed?-1:1)*count*32);
    this.update();
  },
  _copyMotion(cut=false){const editor=this.editor,id=editor._selectedCameraMotion,operation=()=>{if(!editor.copyCameraMotion(id))return false;if(cut)editor.deleteCameraMotion(id);return true;};return this._run(()=>this.sharedClipboard?this.sharedClipboard.copy('camera-motion',operation):operation());},
  _selectMotion(id){
    const clip=this.editor.getCameraMotions().find(c=>c.id===id);if(!clip)return;
    if(this.cameraMotionsCollapsed)this._setCameraMotionsCollapsed(false);
    this._selectLayer('camera');this.editor._selectedCameraMotion=id;
    this.editor._cameraInspectorTab='motion';this.onTrackSelect?.(this.trackById.get('camera'));this.update();
  },
  _motionDown(event,hit){const row=this.tracks[hit.row];if(row?.kind!=='motion')return false;
    this._selectMotion(row.id);const c=row.clip,inside=hit.tick>=c.start&&hit.tick<c.start+c.duration;
    if(inside&&!row.locked){const position=hit.x+this._offsetX(),edge=Math.abs(position-(c.start+c.duration)*this.pxPerTick)<7?'right':Math.abs(position-c.start*this.pxPerTick)<7?'left':'move';
      this.gesture={kind:'camera-motion',id:c.id,edge,original:c,x:event.clientX,start:c.start,duration:c.duration,copy:event.altKey};}
    event.preventDefault();return true;
  },
  _motionMove(event){const g=this.gesture;if(g?.kind!=='camera-motion')return false;const delta=Math.round((event.clientX-g.x)/this.pxPerTick),c=g.original,previousStart=g.start,previousDuration=g.duration;
    if(g.edge==='right')g.duration=Math.max(1,c.duration+delta);
    else if(g.edge==='left'){g.start=Math.max(0,Math.min(c.start+c.duration-1,c.start+delta));g.duration=c.start+c.duration-g.start;}
    else g.start=Math.max(0,c.start+delta);
    if(g.start!==previousStart||g.duration!==previousDuration)this.onCameraMotionPreview?.({...c,start:g.start,duration:g.duration});this.update();return true;
  },
  _motionUp(){const g=this.gesture;if(g?.kind!=='camera-motion')return false;this.gesture=null;
    if(g.start!==g.original.start||g.duration!==g.original.duration)this._run(()=>g.copy?this.editor.movieclipBatch('Duplicate camera motion',()=>{const id=this.editor.duplicateCameraMotion(g.id,g.start);this.editor.setCameraMotion(id,{duration:g.duration});this.editor._selectedCameraMotion=id;}):this.editor.setCameraMotion(g.id,{start:g.start,duration:g.duration}));
    this.onCameraMotionPreview?.(null);
    this.update();return true;
  },
  _motionKey(event){const id=this.editor._selectedCameraMotion,c=this.editor.getCameraMotions().find(c=>c.id===id);if(!c)return false;
    let action;if(event.key==='Delete'||event.key==='Backspace')action=()=>this.editor.deleteCameraMotion(id);
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d')action=()=>{this.editor._selectedCameraMotion=this.editor.duplicateCameraMotion(id);};
    else if(['ArrowLeft','ArrowRight'].includes(event.key))action=()=>this.editor.setCameraMotion(id,{start:Math.max(0,c.start+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?10:1))});
    else if(event.key==='Escape')action=()=>{this.editor._selectedCameraMotion=null;this._cancelGesture();};
    if(!action)return false;event.preventDefault();event.stopPropagation();this._run(action);return true;
  },
};
