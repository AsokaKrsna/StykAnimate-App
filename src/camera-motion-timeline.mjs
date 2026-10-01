import {t as interfaceText} from './localization.mjs';
import {motionTypeMessages} from './camera-motion-localization.mjs';
/** Packs clips into lanes: in start order, each clip takes the first lane that is free at its start, so clips that
 * never play together share a row and the lane count is the most motions at once, not the number of clips. */
export function packMotionLanes(clips){
  const lanes=[];
  for(const clip of [...clips].sort((a,b)=>a.start-b.start)){
    let lane=lanes.find(l=>l.end<=clip.start);if(!lane){lane={end:0,clips:[]};lanes.push(lane);}
    lane.clips.push(clip);lane.end=clip.start+clip.duration;
  }
  return lanes.map(lane=>lane.clips);
}
/** The motion lanes under Camera, each with its clips as `motions` (an effect lane's `clips` are VFX clips). A lane is
 * named after its motion; one holding different motions reads "Motion". */
export function motionRows(editor){
  const locked=editor.getLayer('camera').locked;
  return packMotionLanes(editor.getCameraMotions()).map((clips,index)=>{
    const nameKey=clips.every(c=>c.type===clips[0].type)?motionTypeMessages[clips[0].type]:'inspectorView.motion';
    return {id:`motion/${index}`,kind:'motion',name:interfaceText(nameKey),nameKey,motions:clips,visible:clips.some(c=>c.enabled),locked};
  });
}
/** The clip of a motion lane under a pointer: the selected clip's trim edge first, then the clip over that frame, then
 * any clip's edge just outside it. */
function motionAt(host,row,hit){
  const x=hit.x+host._offsetX(),edge=c=>Math.abs(x-c.start*host.pxPerTick)<7||Math.abs(x-(c.start+c.duration)*host.pxPerTick)<7;
  return row.motions.find(c=>c.id===host.editor._selectedCameraMotion&&edge(c))??row.motions.find(c=>hit.tick>=c.start&&hit.tick<c.start+c.duration)??row.motions.find(edge);
}
/** A camera motion lane (`size` px tall, timeline-rows.mjs): each clip a neutral block with its name; the selected
 * one outlined in the accent with its two trim edges marked. */
export function paintMotionRow(host,ctx,layer,y,size=32){
  const g=host.gesture,c=host.colors,first=host._offsetX()/host.pxPerTick,last=first+host.width/host.pxPerTick;
  for(const clip of layer.motions){
    const selected=host.editor._selectedCameraMotion===clip.id;
    let start=clip.start,duration=clip.duration;
    if(g?.kind==='camera-motion'&&g.id===clip.id){start=g.start;duration=g.duration;}
    if(start>last||start+duration<first)continue;
    const left=start*host.pxPerTick-host._offsetX(),width=duration*host.pxPerTick,top=y+5,height=size-10;
    ctx.globalAlpha=clip.enabled?1:.4;ctx.beginPath();ctx.roundRect(left+1.5,top,Math.max(2,width-3),height,5);
    ctx.fillStyle=selected?c['accent-soft']??c.selected:c.cel??c['camera-tint'];ctx.fill();ctx.lineWidth=selected?1.5:1;ctx.strokeStyle=selected?c['accent-line']??c.accent:c['cel-line']??c.accent;ctx.stroke();
    ctx.save();ctx.beginPath();ctx.rect(left+5,top,Math.max(0,width-10),height);ctx.clip();ctx.font=`500 11px ${host.font}`;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle=c.ink;ctx.fillText(interfaceText(motionTypeMessages[clip.type]),left+9,y+size/2+.5);ctx.restore();ctx.globalAlpha=1;
    if(selected){ctx.fillStyle=c['accent-line']??c.accent;ctx.fillRect(left+3,y+size/2-4,2,8);ctx.fillRect(left+width-5,y+size/2-4,2,8);}
  }
}
export const cameraMotionTimelineMethods={
  /** After a motion edit: the lanes keep their rows while every clip stays in its lane; a clip that changed lane
   * (moved over another, added, removed) rebuilds the rows. */
  _refreshMotionRows(){
    const rows=this.tracks.filter(t=>t.kind==='motion'),next=this.cameraMotionsCollapsed?[]:motionRows(this.editor);
    if(rows.length!==next.length||rows.some((row,i)=>row.motions.length!==next[i].motions.length||row.motions.some((clip,j)=>clip.id!==next[i].motions[j].id)))return this._reindex();
    rows.forEach((row,i)=>{const {motions,visible,name,nameKey}=next[i];Object.assign(row,{motions,visible,name,nameKey});Object.assign(this.trackById.get(row.id),{motions,visible,name,nameKey});});
    this.motionState=this.editor.report._styk.cameraMotion;this.labelSignature=null;
  },
  _setCameraMotionsCollapsed(collapsed){
    if(Boolean(this.cameraMotionsCollapsed)===collapsed)return;
    const count=motionRows(this.editor).length,scroll=this._offsetY();
    this._cancelGesture();this.cameraMotionsCollapsed=collapsed;
    if(collapsed&&this.editor._selectedCameraMotion){this.editor._selectedCameraMotion=null;this.selectedTrackId='camera';this.selectedLayers=new Set(['camera']);}
    this.anchor=null;this.hover=null;this._reindex();
    // Pinned lanes do not move the scrolled rows; a system block too tall to pin scrolls with them (timeline-rows.mjs).
    if(!this.layout?.pinned&&scroll>0)this.scroll.scrollTop=Math.max(0,scroll+(collapsed?-1:1)*count*(this.layout?.row??32));
    this.update();
  },
  _copyMotion(cut=false){const editor=this.editor,id=editor._selectedCameraMotion,operation=()=>{if(!editor.copyCameraMotion(id))return false;if(cut)editor.deleteCameraMotion(id);return true;};return this._run(()=>this.sharedClipboard?this.sharedClipboard.copy('camera-motion',operation):operation());},
  _selectMotion(id){
    const clip=this.editor.getCameraMotions().find(c=>c.id===id);if(!clip)return;
    if(this.cameraMotionsCollapsed)this._setCameraMotionsCollapsed(false);
    this._selectLayer('camera');this.editor._selectedCameraMotion=id;
    this.editor._cameraInspectorTab='motion';this.onTrackSelect?.(this.trackById.get('camera'));this.update();
  },
  /** A lane's name or an empty stretch of it: the clip over `tick` (the playhead from the name, where the lane's
   * first clip stands in when none plays there); an empty stretch of the grid clears the motion selection. */
  _selectMotionRow(row,tick){
    const at=tick??Math.floor(this.editor.tick),clip=row.motions.find(c=>at>=c.start&&at<c.start+c.duration)??(tick===undefined?row.motions[0]:null);
    if(clip)return this._selectMotion(clip.id);
    this.editor._selectedCameraMotion=null;this._selectLayer('camera');
  },
  /** A lane's eye mutes or enables all its clips in one step (a clip's own menu mutes it alone). */
  _toggleMotionLane(row){
    const enabled=!row.visible,clips=row.motions.filter(c=>c.enabled!==enabled);
    if(clips.length===1)return this.editor.setCameraMotion(clips[0].id,{enabled});
    return this.editor.movieclipBatch(interfaceText(enabled?'layerTimeline.enableMotion':'layerTimeline.muteMotion'),()=>{for(const clip of clips)this.editor.setCameraMotion(clip.id,{enabled});});
  },
  _motionDown(event,hit){const row=this.tracks[hit.row];if(row?.kind!=='motion')return false;
    const c=motionAt(this,row,hit);event.preventDefault();
    if(!c){this._selectMotionRow(row,hit.tick);return true;}
    this._selectMotion(c.id);
    if(!row.locked){const position=hit.x+this._offsetX(),edge=Math.abs(position-(c.start+c.duration)*this.pxPerTick)<7?'right':Math.abs(position-c.start*this.pxPerTick)<7?'left':'move';
      this.gesture={kind:'camera-motion',id:c.id,edge,original:c,x:event.clientX,start:c.start,duration:c.duration,copy:event.altKey};}
    return true;
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
