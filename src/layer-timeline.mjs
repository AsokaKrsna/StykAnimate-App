import {installVfxTimeline,paintVfxRow} from './vfx-clip-timeline.mjs';
import {vfxIcon} from './vfx-icons.mjs';
import {vfxChannelLabel,vfxChannelRevision} from './vfx-key-channels.mjs';
import {mountTimelineNavigation} from './timeline-navigation.mjs';
import {showKeyframeEasingPopover} from './keyframe-easing-popover.mjs';
import {keyEasing} from './keyframe-easing.mjs';
import {LAYER_COLORS} from './layers.mjs';
import {organizeTimelineRows,timelineOrganizationMethods} from './timeline-organization.mjs';
import {motionRows,paintMotionRow,cameraMotionTimelineMethods} from './camera-motion-timeline.mjs';
import {attachTimelineHotkeys} from './timeline-hotkeys.mjs';
import {pasteSheetClipboard} from './shared-clipboard.mjs';
import {sheetKeyAt} from './layer-sheet.mjs';
import {initializeLayerSheet} from './editor-layer-sheet.mjs';
import {icon} from './icons.mjs';
import {showTimelineMenu} from './timeline-menu.mjs';
import {AudioTimeline} from './audio-timeline.mjs';

export const ROW=32,HEADER=32;
const MAX_SCROLL=8000000;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const element=(tag,parent,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;parent?.append(node);return node;};
/** Adobe-style exposure grid. Painting and DOM size depend only on viewport,
 * not the number of frames, layers, instances or nested clip frames. */
export class Timeline{
  constructor(container,editor,options={}){
    this.editor=editor;this.container=container;Object.assign(this,options);this.events=new AbortController();this.labels=[];this.pxPerTick=14;this.labelWidth=220;
    this.selectedLayers=new Set([editor.activeLayerId]);this.start=this.end=Math.max(0,Math.floor(editor.tick));this.selectedTrackId=editor.activeLayerId;
    if(!editor.report._styk.layerSheet){initializeLayerSheet(editor.report);editor._invalidate({timing:true});}
    attachTimelineHotkeys(this);
    this.root=element('div',container,'layer-timeline');this.dirty=true;
    this.main=element('div',this.root,'sheet-main');const head=element('div',this.main,'sheet-label-head');
    const search=element('label',head,'sheet-search');search.innerHTML=icon('search');
    this.layerSearch=element('input',search);this.layerSearch.type='search';this.layerSearch.placeholder='Find layers';this.layerSearch.setAttribute('aria-label','Find layers');
    this._on(this.layerSearch,'input',()=>this.setLayerFilter(this.layerSearch.value));
    this._on(this.layerSearch,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();this.setLayerFilter('',null);this.scroll.focus();}if(event.key==='Enter'){event.preventDefault();this.revealSelectedLayer();this.scroll.focus();}});
    this.clearSearch=this._button(search,'close','Clear layer search',()=>this.setLayerFilter(''));this.clearSearch.hidden=true;
    this.focusLayersButton=this._button(head,'layers','Focus selected layers',()=>this.focusSelectedLayers());this.focusLayersButton.setAttribute('aria-pressed','false');
    this.emptyLayers=element('div',this.main,'sheet-empty-layers','No matching layers');this.emptyLayers.hidden=true;
    this.labelViewport=element('div',this.main,'sheet-labels');this.scroll=element('div',this.main,'sheet-scroll');this.scroll.tabIndex=0;this.scroll.setAttribute('role','grid');this.scroll.setAttribute('aria-label','Layer frames');this.scroll.setAttribute('aria-multiselectable','true');
    this.spacer=element('div',this.scroll,'sheet-spacer');this.canvas=element('canvas',this.main,'sheet-canvas');
    const overlay=element('div',this.main,'sheet-playhead-clip');this.playhead=element('div',overlay,'sheet-playhead');this.playheadLabel=element('span',this.playhead);
    this.divider=element('div',this.main,'sheet-resize');this.divider.setAttribute('role','separator');this.divider.setAttribute('aria-label','Resize layer names');
    const toolbar=container.closest('.timeline-panel')?.querySelector('.timeline-toolbar');
    this.headerTools=element('div',toolbar??this.root,'sheet-header-tools');
    if(toolbar)toolbar.querySelector('#timeline-workflow')?.after(this.headerTools);
    this._button(head,'plus','New layer',()=>this.newLayer());
    const frameTools=element('div',this.headerTools,'sheet-frame-tools');
    this.keyButton=this._button(frameTools,'plus','Add Frame',()=>this.addFrame());this.keyButton.classList.add('sheet-add-button');element('span',this.keyButton,'','Add Frame');this.keyButton.dataset.hotkeyCommand='add-frame';
    this.copyDrawingButton=this._button(frameTools,'duplicate','Next copied drawing',()=>this._run(()=>editor.nextDrawing([editor.activeLayerId],{blank:false})));this.copyDrawingButton.hidden=true;
    this.zoomInput=element('input',null,'sheet-zoom');Object.assign(this.zoomInput,{type:'range',min:'1',max:'36',value:'14'});this.zoomInput.setAttribute('aria-label','Timeline zoom');this._on(this.zoomInput,'input',()=>this.setZoom(Number(this.zoomInput.value)));
    this.live=element('div',this.root,'sheet-live');this.live.setAttribute('role','status');this.live.setAttribute('aria-live','polite');
    this._on(this.scroll,'scroll',()=>this.update());this._on(this.scroll,'pointerdown',event=>this._pointerDown(event));this._on(this.scroll,'pointermove',event=>this._pointerMove(event));this._on(this.scroll,'pointerup',event=>this._pointerUp(event));this._on(this.scroll,'pointercancel',()=>this._cancelGesture());this._on(this.scroll,'lostpointercapture',()=>this._cancelGesture());
    this._on(this.scroll,'contextmenu',event=>{event.preventDefault();const hit=this._hit(event);if(hit.row<0||!this.tracks[hit.row])return this._menu(event,{view:true});if(this.tracks[hit.row]?.kind.startsWith('vfx')){this._selectVfxRow(this.tracks[hit.row]);return;}if(!this._contains(hit))this._selectCell(hit);this._menu(event);});
    this._on(this.scroll,'dblclick',event=>this._doubleClick(event));
    this._on(this.main,'pointerleave',()=>{if(!this.gesture){this.hover=null;this.update();}});
    this._on(this.scroll,'keydown',event=>this._keyDown(event));this._on(this.labelViewport,'wheel',event=>{event.preventDefault();this.scroll.scrollTop+=event.deltaY;},{passive:false});
    this._on(this.scroll,'wheel',event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();this.setZoom(clamp(this.pxPerTick*(event.deltaY<0?1.15:.87),1,36),event.clientX-this.scroll.getBoundingClientRect().left);}else if(event.shiftKey){event.preventDefault();this.scroll.scrollLeft+=event.deltaY||event.deltaX;}},{passive:false});
    this._on(this.divider,'pointerdown',event=>{this._columnDrag={x:event.clientX,width:this.labelWidth};this.divider.setPointerCapture(event.pointerId);});
    this._on(this.divider,'pointermove',event=>{if(this._columnDrag){this.labelWidth=clamp(this._columnDrag.width+event.clientX-this._columnDrag.x,140,420);this.root.style.setProperty('--sheet-label',`${this.labelWidth}px`);this.resize();}});this._on(this.divider,'pointerup',()=>{this._columnDrag=null;});
    this.divider.tabIndex=0;this.divider.setAttribute('aria-orientation','vertical');
    this._on(this.divider,'keydown',event=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();this.labelWidth=event.key==='Home'?220:clamp(this.labelWidth+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?40:10),140,420);this.root.style.setProperty('--sheet-label',`${this.labelWidth}px`);this.resize();});
    this._on(this.divider,'dblclick',()=>{this.labelWidth=220;this.root.style.setProperty('--sheet-label','220px');this.resize();});
    this._on(this.divider,'lostpointercapture',()=>{this._columnDrag=null;});
    this._on(editor,'change' ,event=>{const d=event.detail??{};if(d.kind==='document'){this.cameraMotionsCollapsed=false;this.layerQuery='';this.focusedLayerIds=null;this.layerSearch.value='';}
      if(d.kind==='vfx-channels'&&this.gesture?.kind.startsWith('vfx'))this._cancelGesture();
      if(d.kind==='vfx-selection'||d.kind==='vfx-target'||d.kind==='selection'&&editor._vfxTimelineVisible||d.kind==='document'||d.structural||d.layers||d.timing||d.layerSheet)this._reindex();
      else if(this.motionState!==editor.report._styk.cameraMotion)this._refreshMotionRows();
      if(d.kind==='selection'&&!d.sheetSelection&&editor.object){this.selectedTrackId=editor.layerForUid(editor.selectedUid);this.selectedLayers=new Set([this.selectedTrackId]);this.revealSelectedLayer();}
      if(d.kind==='seek'&&!this.gesture&&!this.selecting){this.start=this.end=Math.floor(editor.tick);}this.update(d.kind!=='seek'||!this.paused&&this.gesture?.kind!=='scrub');});
    this._on(window,'styk-theme-change',()=>this.resize());
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.root);this._reindex();this.resize();
    mountTimelineNavigation(this,{input:this.zoomInput,fit:()=>this.fitFrameRange()});
    this.audio=new AudioTimeline(container,editor,{...options,host:this,engine:options.audioEngine,mode:'advanced'});
    this._on(this.labelViewport,'pointerdown',()=>this.audio.clearSelection());
  }
  _on(target,name,fn,options={}){target.addEventListener(name,fn,{...options,signal:this.events.signal});}
  _button(parent,name,title,action){const button=element('button',parent,'icon-button');button.type='button';button.innerHTML=icon(name);button.title=title;button.setAttribute('aria-label',title);this._on(button,'click',event=>{this._run(()=>action(event));if(!this.menu&&!this.footer?.matches(':popover-open'))this.scroll?.focus({preventScroll:true});});return button;}
  _run(operation){const fail=error=>{this.live.textContent=error.message;this.onError?.(error);return false;};try{this.onSeek?.();const result=operation();return result?.then?result.catch(fail):result;}catch(error){return fail(error);}}
  get ids(){return [...this.selectedLayers].filter(id=>this.editor.getLayer(id)&&this.trackById?.has(id));}
  get selectedTicks(){return [...new Set([this.start,...this.ids.flatMap(id=>this.editor.layerFrameKeys(id).filter(k=>k.tick>this.start&&k.tick<=this.end).map(k=>k.tick))])].sort((a,b)=>a-b);}
  get selectedTimeRange(){return {start:this.start,end:this.end+1};}
  get selectedFrameIndices(){return this.editor.timeline.filter(row=>row.start>=this.start&&row.start<=this.end).map(row=>row.index);}
  get loopRange(){return this.end>this.start?{start:this.start,end:this.end+1}:null;}
  _reindex(){
    if(!this.editor.report._styk.layerSheet){initializeLayerSheet(this.editor.report);this.editor._invalidate({timing:true});}
    this.motionState=this.editor.report._styk.cameraMotion;
    this.tracks=organizeTimelineRows([this.editor.getLayer('camera'),...(this.cameraMotionsCollapsed?[]:motionRows(this.editor)),this.editor.getLayer('scene'),...this.editor.layers.filter(l=>l.kind==='layer').reverse()],this.layerQuery,this.focusedLayerIds);
    this.visibleLayerCount=this.tracks.reduce((count,row)=>count+(row.kind==='layer'?1:0),0);
    const editor=this.editor;
    this.trackById=new Map(this.tracks.map(layer=>[layer.id,{...layer,target:layer.kind==='layer'?{kind:'layer',id:layer.id}:{kind:layer.kind},get keys(){return layer.kind==='motion'?[]:editor.layerFrameKeys(layer.id);}}]));
    if(!this.editor.getLayer(this.selectedTrackId))this.selectedTrackId=this.editor.activeLayerId;
    this.selectedLayers=new Set([...this.selectedLayers].filter(id=>this.editor.getLayer(id)));if(!this.selectedLayers.size)this.selectedLayers.add(this.selectedTrackId);
    this.labelSignature=null;this.dirty=true;
    this.scroll.setAttribute('aria-rowcount',String(this.tracks.length));this.scroll.setAttribute('aria-colcount',String(this.editor.report._styk.layerSheet.duration));this._extent();
  }
  _extent(){
    if(!this.main)return;
    // Read geometry together before changing inherited CSS. A write between
    // these reads forces another layout for every timeline paint.
    const {clientWidth,clientHeight,offsetWidth,offsetHeight}=this.scroll;
    this.width=Math.max(1,clientWidth);this.height=Math.max(1,clientHeight);
    for(const [name,value] of [['--sheet-scrollbar-x',`${offsetHeight-clientHeight}px`],['--sheet-scrollbar-y',`${offsetWidth-clientWidth}px`]])
      if(this.root.style.getPropertyValue(name)!==value)this.root.style.setProperty(name,value);
    this.audioTop=HEADER+this.tracks.length*ROW;
    this.logicalWidth=Math.max(this.width,(Math.max(this.editor.totalTicks,this.end+1)+60)*this.pxPerTick);this.logicalHeight=Math.max(this.height,this.audioTop+(this.audio?.contentHeight??0));
    const width=`${Math.min(MAX_SCROLL,this.logicalWidth)}px`,height=`${Math.min(MAX_SCROLL,this.logicalHeight)}px`;
    if(this.spacer.style.width!==width)this.spacer.style.width=width;if(this.spacer.style.height!==height)this.spacer.style.height=height;
  }
  _offsetX(){const actual=Math.max(0,this.scroll.scrollWidth-this.scroll.clientWidth);return actual?this.scroll.scrollLeft/actual*Math.max(0,this.logicalWidth-this.scroll.clientWidth):0;}
  _offsetY(){return this.scroll.scrollTop;}
  _scrollToX(x){const max=this.logicalWidth-this.scroll.clientWidth;this.scroll.scrollLeft=max>0?clamp(x,0,max)/max*(this.scroll.scrollWidth-this.scroll.clientWidth):0;this.update();}
  _scrollToY(y){this.scroll.scrollTop=y;this.update();}
  resize(){
    this.audio?.update();
    this._extent();const ratio=window.devicePixelRatio||1,width=Math.round(this.width*ratio),height=Math.round(this.height*ratio);
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;this.canvas.style.width=`${this.width}px`;this.canvas.style.height=`${this.height}px`;}
    const css=getComputedStyle(this.root),color=name=>css.getPropertyValue(`--sheet-${name}`).trim();
    this.colors=Object.fromEntries(['surface','hover','line','ink','muted','accent','selected','span','tween','camera-accent','camera-tint','scene-accent','scene-tint'].map(name=>[name,color(name)]));this.font=css.fontFamily;
    this.update();
  }
  setZoom(value,anchor=this.width/2){const old=this.pxPerTick,center=(this._offsetX()+anchor)/old;this.pxPerTick=clamp(Number(value)||14,1,36);this.zoomInput.value=String(this.pxPerTick);this._extent();this._scrollToX(center*this.pxPerTick-anchor);this.audio?.update();}
  setPaused(value){const resumed=this.paused&&!value;this.paused=value;this.update(Boolean(resumed));}
  update(dirty=true){
    this.dirty||=dirty;if(this.disposed||this.raf)return;
    this.raf=requestAnimationFrame(()=>{this._flushScrub();if(this.dirty){this.dirty=false;this._paint();}this._syncPlayhead();this.raf=null;
      if(this.pendingScrub!=null)this.update(false);
    });
  }
  render(){this.update();}
  _syncPlayhead(){
    this.onionRange?.update();
    this.audio?.update(false);
    const tick=Math.floor(this.pendingScrub??this.editor.tick),x=(tick+.5)*this.pxPerTick-this._offsetX();this.playhead.style.transform=`translateX(${x}px)`;
    if(this.playheadLabel.textContent!==String(tick+1))this.playheadLabel.textContent=String(tick+1);

  }
  _paint(){
    this._syncOrganization();
    this.audio?.update();
    this._extent();const ctx=this.canvas.getContext('2d'),dpr=window.devicePixelRatio||1,step=this.pxPerTick,sx=this._offsetX(),sy=this._offsetY(),w=this.width,h=this.height,c=this.colors;
    if(!c)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle=c.surface;ctx.fillRect(0,0,w,h);
    const durationX=this.editor.totalTicks*step-sx;if(durationX<w){ctx.fillStyle=c.hover;ctx.fillRect(Math.max(0,durationX),HEADER,w-Math.max(0,durationX),h-HEADER);}
    const first=Math.floor(sx/step),last=Math.ceil((sx+w)/step),firstRow=clamp(Math.floor(sy/ROW),0,this.tracks.length),lastRow=clamp(Math.ceil((sy+h-HEADER)/ROW),firstRow,this.tracks.length),state=this.editor.report._styk.layerSheet;
    ctx.save();ctx.beginPath();ctx.rect(0,HEADER,w,h-HEADER);ctx.clip();
    for(let index=firstRow;index<lastRow;index++){
      const layer=this.tracks[index],track=state.tracks[layer.id],y=HEADER+index*ROW-sy,selected=this.selectedLayers.has(layer.id);
      if(layer.kind.startsWith('vfx')){paintVfxRow(this,ctx,layer,y);continue;}
      if(layer.kind==='motion'){paintMotionRow(this,ctx,layer,y);continue;}
      const rowAccent=layer.kind==='camera'?c['camera-accent']:layer.kind==='scene'?c['scene-accent']:LAYER_COLORS[layer.color]??(layer.drawing?c.accent:null);
      const rowTint=layer.kind==='camera'?c['camera-tint']:layer.kind==='scene'?c['scene-tint']:layer.drawing?c.selected:null;
      if(track)for(let i=Math.max(0,sheetKeyAt(track,first).index);i<track.keys.length;i++){
        const key=track.keys[i],next=track.keys[i+1],end=next?.tick??track.end;if(key.tick>last)break;if(end<=first)continue;
        const left=Math.max(-6,key.tick*step-sx+1),right=Math.min(w+6,end*step-sx-1),blank=key.empty??(key.value?.frameId===null),tween=next&&!blank&&!(next.empty??(next.value?.frameId===null))&&!['hold','constant'].includes(key.interpolation);
        ctx.beginPath();ctx.roundRect(left,y+5,Math.max(0,right-left),ROW-10,4);
        if(blank){ctx.strokeStyle=c.muted;ctx.globalAlpha=.5;ctx.stroke();ctx.globalAlpha=1;}
        else{ctx.fillStyle=rowTint??(tween?c.tween:c.span);ctx.fill();}
        if(tween&&right-left>32){ctx.strokeStyle=c.accent;ctx.globalAlpha=.55;ctx.beginPath();ctx.moveTo(left+13,y+ROW/2);ctx.lineTo(right-7,y+ROW/2);ctx.lineTo(right-11,y+ROW/2-3);ctx.moveTo(right-7,y+ROW/2);ctx.lineTo(right-11,y+ROW/2+3);ctx.stroke();ctx.globalAlpha=1;}
        if(layer.drawing&&!blank&&right-left>34){const source=key.value?.frameId&&this.editor.getFrameById(key.value.frameId),object=source?.objects.find(o=>this.editor.layerForUid(o.unique_id)===layer.id),figure=object&&this.editor.report.figure_types.find(f=>f.figure_type_id===object.figure_type_id);if(figure){const thumb=this.editor.drawingResources.thumbnail(figure,()=>{if(!this.disposed)this.update();});if(thumb){const width=Math.min(40,right-left-12);ctx.drawImage(thumb,left+8,y+7,width,ROW-14);}}}
        if(!blank&&end-key.tick>1){ctx.fillStyle=c.muted;ctx.globalAlpha=.55;ctx.fillRect(end*step-sx-4,y+12,2,8);ctx.globalAlpha=1;}
      }
      if(selected){ctx.fillStyle=rowTint??c.selected;ctx.globalAlpha=.65;ctx.fillRect(this.start*step-sx,y+1,(this.end-this.start+1)*step,ROW-2);ctx.globalAlpha=1;}
      if(this.hover?.row===index&&!this.gesture){ctx.fillStyle=c.accent;ctx.globalAlpha=.07;ctx.fillRect(this.hover.tick*step-sx,y+1,step,ROW-2);ctx.globalAlpha=1;}
      ctx.lineWidth=1;ctx.strokeStyle=c.line;ctx.beginPath();
      for(let tick=first;tick<=last;tick++){if(step<8&&tick%5!==0)continue;const x=Math.round(tick*step-sx)+.5;ctx.moveTo(x,y+3);ctx.lineTo(x,y+ROW-3);}ctx.moveTo(0,y+ROW-.5);ctx.lineTo(w,y+ROW-.5);ctx.stroke();
      if(track)for(let i=Math.max(0,sheetKeyAt(track,first).index);i<track.keys.length;i++){
        const key=track.keys[i];if(key.tick>last)break;if(key.tick<first)continue;const x=(key.tick+.5)*step-sx;
        ctx.beginPath();ctx.arc(x,y+ROW/2,Math.min(3.5,step/3),0,Math.PI*2);
        if(key.empty??(key.value?.frameId===null)){ctx.fillStyle=c.surface;ctx.fill();ctx.strokeStyle=rowAccent??c.ink;ctx.stroke();}
        else{ctx.fillStyle=rowAccent??c.ink;ctx.fill();}
      }
      if(selected){ctx.strokeStyle=rowAccent??c.accent;ctx.strokeRect(this.start*step-sx+.5,y+.5,(this.end-this.start+1)*step-1,ROW-1);}
      if(layer.locked){ctx.fillStyle=c.surface;ctx.globalAlpha=.45;ctx.fillRect(0,y,w,ROW);ctx.globalAlpha=1;}
    }
    const g=this.gesture;
    if(g?.kind==='move'&&(g.delta||g.rowDelta)||g?.kind==='resize'){
      ctx.strokeStyle=c.accent;ctx.lineWidth=2;ctx.setLineDash([4,3]);
      for(const id of this.ids){const row=this.tracks.findIndex(t=>t.id===id)+(g.rowDelta??0),start=g.kind==='resize'?g.span.start:this.start+(g.delta??0),end=g.kind==='resize'?g.span.end+g.delta:this.end+1+(g.delta??0);
        ctx.strokeRect(start*step-sx+1,HEADER+row*ROW-sy+1,(end-start)*step-2,ROW-2);}
      ctx.setLineDash([]);
    }
    ctx.restore();ctx.fillStyle=c.surface;ctx.fillRect(0,0,w,HEADER);ctx.strokeStyle=c.line;ctx.beginPath();ctx.moveTo(0,HEADER-.5);ctx.lineTo(w,HEADER-.5);ctx.stroke();
    ctx.font=`10px ${this.font}`;ctx.textAlign='center';ctx.textBaseline='middle';
    const interval=step<2?50:step<5?20:step<9?10:5;for(let tick=first;tick<=last;tick++){const x=(tick+.5)*step-sx;if(tick===0||(tick+1)%interval===0){ctx.fillStyle=c.muted;ctx.fillText(String(tick+1),x,14);ctx.fillStyle=c.line;ctx.fillRect(Math.round(x),25,1,4);}}
    this._paintLabels(firstRow,lastRow,sy);
    const active=this.editor.getLayer(this.editor.activeLayerId),drawing=Boolean(active?.drawing),locked=drawing?active.locked||!active.visible:this.ids.some(id=>this.editor.getLayer(id)?.locked),label=drawing?'Blank frame':'Add Frame';
    this.keyButton.disabled=locked||!this.ids.length;this.keyButton.lastChild.textContent=label;this.keyButton.dataset.hotkeyTitle=label;this.keyButton.setAttribute('aria-label',label);this.keyButton.title=label+(this.shortcut('add-frame')?' \u00b7 '+this.shortcut('add-frame'):'');this.copyDrawingButton.hidden=!drawing;this.copyDrawingButton.disabled=locked;
  }
  _paintLabels(first,last,sy){
    const signature=[first,last,sy,this.editor.layerRevision,this.editor.activeLayerId,this.editor._selectedCameraMotion,this.editor._selectedVfxClip,vfxChannelRevision(this.editor),...this.ids].join(':');if(signature===this.labelSignature)return;this.labelSignature=signature;
    for(let slot=0;slot<last-first;slot++){
      let node=this.labels[slot];if(!node){
        node=element('div',this.labelViewport,'sheet-layer');node.setAttribute('role','row');
        const disclosure=element('button',node,'icon-button sheet-camera-disclosure');disclosure.type='button';disclosure.innerHTML=icon('chevron-right');
        this._on(disclosure,'click',event=>{event.stopPropagation();this._setCameraMotionsCollapsed(!this.cameraMotionsCollapsed);});
        this._on(disclosure,'keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();this._setCameraMotionsCollapsed(event.key==='ArrowLeft');}});
        node._disclosure=disclosure;
        const name=this._button(node,'layers','Select layer',event=>this._selectLayer(node._id,event));name.classList.add('sheet-layer-name');element('span',name);
        const channels=element('button',node,'vfx-channel-trigger');channels.type='button';channels.innerHTML=icon('sliders');channels.setAttribute('aria-label','Visible effect keys');channels.setAttribute('aria-haspopup','dialog');element('span',channels);node._channels=channels;this._on(channels,'click',event=>{event.stopPropagation();this._run(()=>this._openVfxChannels(channels));});
        this._on(name,'dblclick',event=>{event.stopPropagation();this._renameLayer(node);});
        const eye=this._button(node,'eye','Toggle layer visibility',()=>{const row=this.tracks.find(t=>t.id===node._id);if(row?.kind.startsWith('vfx'))return;return row?.kind==='motion'?this.editor.setCameraMotion(row.id,{enabled:!row.visible}):this.editor.setLayerVisible(node._id,!row.visible);});eye.classList.add('sheet-layer-state');
        const lock=this._button(node,'lock','Toggle layer lock',()=>this.editor.setLayerLocked(node._id,!this.editor.getLayer(node._id).locked));lock.classList.add('sheet-layer-state');
        name.draggable=true;this._on(name,'dragstart',event=>{this.dragLayer=node._id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',node._id);});
        this._on(node,'dragover',event=>{if(this.dragLayer&&this.dragLayer!==node._id&&this.editor.getLayer(node._id)?.kind==='layer'){event.preventDefault();node.dataset.drop=event.clientY<node.getBoundingClientRect().top+ROW/2?'before':'after';}});this._on(node,'dragleave',()=>delete node.dataset.drop);
        this._on(node,'drop',event=>{event.preventDefault();const before=node.dataset.drop==='before';delete node.dataset.drop;const from=this.dragLayer;this.dragLayer=null;if(from&&from!==node._id&&this.editor.getLayer(node._id)?.kind==='layer')this._run(()=>{const order=this.editor.report._styk.layers.order.filter(id=>id!==from);this.editor.moveLayerTo(from,order.indexOf(node._id)+(before?1:0));});});
        this._on(name,'dragend',()=>{this.dragLayer=null;for(const label of this.labels)delete label.dataset.drop;});
        node._name=name;node._eye=eye;node._lock=lock;this._on(node,'contextmenu',event=>{event.preventDefault();this._selectLayer(node._id,event);if(this.tracks.find(t=>t.id===node._id)?.kind.startsWith('vfx'))return;this._menu(event,{layer:true});});this.labels.push(node);
      }
      const layer=this.tracks[first+slot];node.hidden=false;node._id=layer.id;node.dataset.layerId=layer.id;node.dataset.selected=String(layer.kind==='motion'?this.editor._selectedCameraMotion===layer.id:this.selectedLayers.has(layer.id));node.dataset.active=String(layer.id===this.editor.activeLayerId);node.style.transform=`translateY(${(first+slot)*ROW-sy}px)`;
      node.style.setProperty('--layer-color',LAYER_COLORS[layer.color]??'transparent');node.dataset.color=layer.color??'';node.dataset.kind=layer.kind;node.dataset.drawing=String(Boolean(layer.drawing));node.dataset.hidden=String(layer.visible===false);node.dataset.locked=String(Boolean(layer.locked));node.setAttribute('aria-selected',node.dataset.selected);
      const visualKind=layer.drawing?'drawing':layer.kind;if(node._kind!==visualKind){node._name.innerHTML=(layer.kind==='vfx'?vfxIcon('effects'):icon(layer.kind==='camera'?'camera':layer.kind==='scene'?'scene':layer.kind==='motion'?'activity':layer.drawing?'brush':'layers'))+'<span></span>';node._kind=visualKind;}
      node._name.draggable=layer.kind==='layer';node._lock.hidden=layer.kind==='motion'||layer.kind.startsWith('vfx');node._eye.hidden=layer.kind.startsWith('vfx');
      const clip=layer.kind==='vfx'&&layer.clips.find(c=>c.id===this.editor._selectedVfxClip);node._channels.hidden=!clip||!Object.values(clip.keys).some(keys=>keys.length);if(clip){const label=vfxChannelLabel(this.editor,clip);node._channels.lastChild.textContent=label;node._channels.title=`Visible effect keys · ${label}`;}
      node._disclosure.hidden=layer.kind!=='camera'||!this.editor.getCameraMotions().length;
      node._disclosure.setAttribute('aria-expanded',String(!this.cameraMotionsCollapsed));node._disclosure.title=`${this.cameraMotionsCollapsed?'Expand':'Collapse'} camera motions`;node._disclosure.setAttribute('aria-label',node._disclosure.title);
      node._name.lastChild.textContent=layer.name+(layer.kind==='camera'&&this.cameraMotionsCollapsed?` · ${this.editor.getCameraMotions().length}`:'')+(layer.parallax?.enabled?` · ${Math.round(layer.parallax.x*100)}%`:'');node._name.title=layer.name+(layer.drawing?' · Drawing layer':'');node._name.setAttribute('aria-label',`Select layer ${layer.name}`);
      node._eye.dataset.on=String(!layer.visible);node._eye.innerHTML=icon(layer.visible?'eye':'eye-off');node._eye.setAttribute('aria-label',`${layer.visible?'Hide':'Show'} ${layer.name}`);node._eye.title=`${layer.visible?'Hide':'Show'} ${layer.name}`;
      node._lock.dataset.on=String(layer.locked);node._lock.setAttribute('aria-label',`${layer.locked?'Unlock':'Lock'} ${layer.name}`);node._lock.title=`${layer.locked?'Unlock':'Lock'} ${layer.name}`;
    }
    for(let slot=last-first;slot<this.labels.length;slot++)this.labels[slot].hidden=true;
  }
  _selectLayer(id,event={}){
    if(typeof id==='object')id=id._id;
    if(this.tracks.find(t=>t.id===id)?.kind.startsWith('vfx'))return this._selectVfxRow(this.tracks.find(t=>t.id===id));
    this.editor._selectedVfxClip=null;
    if(this.tracks.find(t=>t.id===id)?.kind==='motion')return this._selectMotion(id);
    this.editor._selectedCameraMotion=null;
    if(event.shiftKey){const a=this.tracks.findIndex(t=>t.id===this.selectedTrackId),b=this.tracks.findIndex(t=>t.id===id);this.selectedLayers=new Set(this.tracks.slice(Math.min(a,b),Math.max(a,b)+1).map(t=>t.id));}
    else if(event.ctrlKey||event.metaKey){this.selectedLayers.has(id)?this.selectedLayers.delete(id):this.selectedLayers.add(id);if(!this.selectedLayers.size)this.selectedLayers.add(id);}
    else this.selectedLayers=new Set([id]);
    this.selectedTrackId=id;this.editor.selectSheetLayer(id,{contents:id!=='camera'});this.onTrackSelect?.(this.trackById.get(id));this.update();
  }
  selectTrack(id){if(id?.startsWith('figure:'))id=this.editor.layerForUid(Number(id.slice(7)));if(this.editor.getLayer(id)){this.selectedTrackId=id;this.selectedLayers=new Set([id]);this.revealSelectedLayer();this.update();}}
  _renameLayer(node){const layer=this.editor.getLayer(node._id);if(layer?.kind!=='layer')return;const input=element('input',node,'sheet-layer-rename');input.value=layer.name;node._name.hidden=true;input.focus();input.select();let done=false;
    const finish=save=>{if(done)return;done=true;if(save&&input.value!==layer.name)this._run(()=>this.editor.renameLayer(layer.id,input.value));input.remove();node._name.hidden=false;this.update();};input.addEventListener('blur',()=>finish(true),{once:true});input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter')finish(true);if(event.key==='Escape')finish(false);});}
  _hit(event){const rect=this.scroll.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;return {tick:clamp(Math.floor((x+this._offsetX())/this.pxPerTick),0,9999999),row:y<HEADER?-1:Math.floor((y-HEADER+this._offsetY())/ROW),x,y};}
  _contains(hit){return hit.row>=0&&this.selectedLayers.has(this.tracks[hit.row]?.id)&&hit.tick>=this.start&&hit.tick<=this.end;}
  _selectCell(hit,{extend=false,notify=true}={}){
    const layer=this.tracks[hit.row];if(!layer)return;if(layer.kind.startsWith('vfx'))return this._selectVfxRow(layer);if(layer.kind==='motion')return this._selectMotion(layer.id);this.editor._selectedCameraMotion=null;const changed=this.selectedTrackId!==layer.id,anchor=this.anchor??{tick:this.start,row:this.tracks.findIndex(l=>l.id===this.selectedTrackId)};
    if(extend){this.start=Math.min(anchor.tick,hit.tick);this.end=Math.max(anchor.tick,hit.tick);this.selectedLayers=new Set(this.tracks.slice(Math.min(anchor.row,hit.row),Math.max(anchor.row,hit.row)+1).map(l=>l.id));}
    else{this.start=this.end=hit.tick;this.selectedLayers=new Set([layer.id]);this.anchor={tick:hit.tick,row:hit.row};}
    this.selectedTrackId=layer.id;
    if(this.editor._sheetSelection?.id!==layer.id)this.editor.selectSheetLayer(layer.id,{contents:layer.id!=='camera'});
    this.selecting=true;try{if(this.editor.tick!==hit.tick)this.editor.seek(hit.tick,{allowBeyondEnd:true});}finally{this.selecting=false;}
    if(notify||changed)this.onTrackSelect?.(this.trackById.get(layer.id));this.live.textContent=`${layer.name}, frame ${this.start+1}${this.end>this.start?` to ${this.end+1}`:''}`;this.update();
  }
  _doubleClick(event){
    const hit=this._hit(event),layer=this.tracks[hit.row];if(!layer)return;if(layer.kind.startsWith('vfx'))return this._selectVfxRow(layer);if(layer.kind==='motion')return this._selectMotion(layer.id);
    const track=this.editor.report._styk.layerSheet.tracks[layer.id],{key,next}=sheetKeyAt(track,hit.tick);
    if(key?.tick!==hit.tick){this._selectCell(hit);this.addTrackKey();}
    else{if(!this._contains(hit))this._selectCell(hit);this.showEasingPopover(event);}
  }
  captureEasingSelection(){return this.ids.map(id=>({id,start:this.start,end:this.end}));}
  easingSettings(selection){return selection.flatMap(({id,start,end})=>{const track=this.editor.report._styk.layerSheet.tracks[id],first=sheetKeyAt(track,start).key;return (track?.keys??[]).filter(key=>key===first||key.tick>=start&&key.tick<=end).map(keyEasing);});}
  applyEasing(selection,easing){return this.editor.movieclipBatch('Change easing',()=>{for(const {id,start,end} of selection)this.editor.sheetSetEasing([id],start,end,easing);});}
  showEasingPopover(event){if(!this.ids.length||this.ids.some(id=>this.editor.getLayer(id)?.locked))return;const rect=this.scroll.getBoundingClientRect();this.easingAnchor={x:event?.clientX??rect.left+Math.min(this.width-16,Math.max(16,(this.start+.5)*this.pxPerTick-this._offsetX())),y:event?.clientY??rect.top+32};return showKeyframeEasingPopover.call(this);}
  _resizeHit(hit){
    if(!hit||this.ids.length!==1||!this.selectedLayers.has(this.tracks[hit.row]?.id)||this.tracks[hit.row]?.locked)return null;
    const id=this.tracks[hit.row].id,track=this.editor.report._styk.layerSheet.tracks[id],{key,next}=sheetKeyAt(track,this.start);
    if(!key)return null;const end=next?.tick??track.end;
    return Math.abs(hit.x+this._offsetX()-end*this.pxPerTick)<4?{id,start:key.tick,end}:null;
  }
  _flushScrub({force=false}={}){
    // Keep one editable preparation in flight. Repeated cancellation can starve
    // dense clips of any completed preview; pointer moves only replace the target.
    if(!force&&this.pendingScrub!=null&&this.canScrub?.()===false)return;
    const tick=this.pendingScrub;this.pendingScrub=null;
    if(tick!==undefined&&tick!==null&&tick!==this.editor.tick){this.editor.seek(tick,{evaluate:false,allowBeyondEnd:true});this.onScrub?.(tick);}
    if(this.pendingCell){const hit=this.pendingCell;this.pendingCell=null;this._selectCell(hit,{extend:true,notify:false});}
  }
  _pointerDown(event){
    const bounds=this.scroll.getBoundingClientRect();
    if(event.clientX>=bounds.left+this.scroll.clientWidth||event.clientY>=bounds.top+this.scroll.clientHeight)return;
    if(event.button!==0)return;this.onSeek?.();const hit=this._hit(event);if(hit.row>=this.tracks.length)return;
    this.scroll.setPointerCapture(event.pointerId);this.scroll.focus({preventScroll:true});
    if(hit.row<0){this.gesture={kind:'scrub',pointer:event.pointerId};this.onScrubStart?.();this.pendingScrub=hit.tick;this.update(false);event.preventDefault();return;}
    this.audio?.clearSelection();
    if(this._motionDown(event,hit))return;
    const selected=this._contains(hit),span=selected?this._resizeHit(hit):null,layer=this.tracks[hit.row];
    if(span&&!event.shiftKey&&!event.altKey){this.gesture={kind:'resize',span,hit,pointer:event.pointerId,x:event.clientX,y:event.clientY,delta:0};event.preventDefault();return;}
    const track=this.editor.report._styk.layerSheet.tracks[layer.id];
    // A preceding key does not expose cells beyond the track's exclusive end.
    // Explicit blank exposures still count as frames and remain draggable.
    const occupied=hit.tick<track?.end&&Boolean(sheetKeyAt(track,hit.tick).key);
    const move=!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!layer.locked&&selected&&occupied;
    this.gesture={kind:move?'move':'select',pointer:event.pointerId,hit,x:event.clientX,y:event.clientY,delta:0,rowDelta:0,copy:event.altKey};
    if(!selected||event.shiftKey)this._selectCell(hit,{extend:event.shiftKey});event.preventDefault();
  }
  _pointerMove(event){
    if(this._motionMove(event))return;
    const bounds=this.scroll.getBoundingClientRect();
    if(!this.gesture&&(event.clientX>=bounds.left+this.scroll.clientWidth||event.clientY>=bounds.top+this.scroll.clientHeight)){
      if(this.hover){this.hover=null;this.update();}return;
    }
    const hit=this._hit(event),g=this.gesture;
    if(!g){
      const resize=this._contains(hit)?this._resizeHit(hit):null;this.scroll.style.cursor=hit.row<0?'ew-resize':resize?'ew-resize':'default';
      if(this.hover?.tick!==hit.tick||this.hover?.row!==hit.row||Boolean(resize)!==this.hoverResize){this.hover=hit;this.hoverResize=Boolean(resize);this.update();}return;
    }
    if(g.kind==='scrub'){this.pendingScrub=hit.tick;this.update(false);}
    else if(g.kind==='select'){if(Math.abs(event.clientX-g.x)+Math.abs(event.clientY-g.y)>4){this.pendingCell={...hit,row:clamp(hit.row,0,this.tracks.length-1)};this.update();}}
    else if(g.kind==='resize'){g.delta=Math.max(g.span.start+1-g.span.end,Math.round((event.clientX-g.x)/this.pxPerTick));this.update();}
    else if(Math.abs(event.clientX-g.x)+Math.abs(event.clientY-g.y)>4){g.delta=Math.max(-this.start,hit.tick-g.hit.tick);g.rowDelta=clamp(hit.row,0,this.tracks.length-1)-g.hit.row;this.update();}
    const rect=this.scroll.getBoundingClientRect();if(event.clientX>rect.right-20)this.scroll.scrollLeft+=12;if(event.clientX<rect.left+20)this.scroll.scrollLeft-=12;
  }
  _pointerUp(event){
    if(this._motionUp())return;
    const g=this.gesture;if(!g)return;
    if(g.kind==='select'&&Math.abs(event.clientX-g.x)+Math.abs(event.clientY-g.y)>4){const hit=this._hit(event);this.pendingCell={...hit,row:clamp(hit.row,0,this.tracks.length-1)};}
    this._flushScrub({force:true});this.gesture=null;
    if(g.kind==='resize'&&g.delta)this._run(()=>this.editor.sheetSetDuration(g.span.end+g.delta-g.span.start,g.span.id,g.span.start));
    else if(g.kind==='move'&&(g.delta||g.rowDelta)){
      const destinations=this.ids.map(id=>this.tracks[this.tracks.findIndex(t=>t.id===id)+g.rowDelta]?.id);
      const done=this._run(()=>{
        if(destinations.some(id=>!id))throw new Error('Choose destination layers inside the timeline.');
        const containsKeys=this.ids.some(id=>this.editor.layerFrameKeys(id).some(k=>k.tick>=this.start&&k.tick<=this.end));
        return g.rowDelta||!containsKeys?this.editor.sheetTransferFrames(this.ids,destinations,this.start,this.end,this.start+g.delta,{copy:g.copy}):this.editor.sheetMoveFrames(this.ids,this.start,this.end,g.delta,{copy:g.copy,replace:this.getSettings?.().replaceKeyframesOnDrop!==false});
      });
      if(done){this.selectedLayers=new Set(destinations);this.selectedTrackId=destinations[0];this.start+=g.delta;this.end+=g.delta;this.editor.selectSheetLayer(destinations[0]);this.selecting=true;try{this.editor.seek(this.start,{allowBeyondEnd:true});}finally{this.selecting=false;}}
    }
    if(g.kind==='scrub'){this.start=this.end=Math.floor(this.editor.tick);this.onScrubEnd?.();}
    if(this.scroll.hasPointerCapture(event.pointerId))this.scroll.releasePointerCapture(event.pointerId);
    this.onRangeChange?.(this.selectedFrameIndices);this.update();
  }
  _cancelGesture(){if(this.gesture?.kind==='scrub')this.onScrubEnd?.();if(this.gesture?.kind==='camera-motion')this.onCameraMotionPreview?.(null);this.gesture=null;this.pendingScrub=null;this.pendingCell=null;this.update();}
  seek(tick){if(!Number.isInteger(tick)||tick<0)throw new Error('Choose a valid frame.');this.onSeek?.();this.start=this.end=tick;this.editor.seek(tick,{allowBeyondEnd:true});this.update();}
  revealPlayhead(){const x=this.editor.tick*this.pxPerTick,left=this._offsetX();if(x<left)this._scrollToX(x);else if(x>left+this.width-30)this._scrollToX(x-this.width+60);}
  jumpKey(direction){const keys=this.editor.layerFrameKeys(this.selectedTrackId),tick=direction<0?[...keys].reverse().find(k=>k.tick<this.editor.tick)?.tick:keys.find(k=>k.tick>this.editor.tick)?.tick;if(tick!==undefined){this.seek(tick);this.revealPlayhead();}}
  /** Add Frame inserts a key at the selected cell. When every selected layer
   * already holds a key there, it instead duplicates the current pose into the
   * following cell, shifting later keys. */
  addFrame(){return this.onAddFrame?this.onAddFrame():this.addFrameCell();}
  addFrameCell(){if(this.editor.getLayer(this.editor.activeLayerId)?.drawing)return this._run(()=>this.editor.addDrawingFrame(this.editor.activeLayerId,this.start));const onKey=this.ids.length>0&&this.ids.every(id=>this.editor.layerFrameKeys(id).some(key=>key.tick===this.start));return onKey?this.duplicateFrameAfter():this.addTrackKey();}
  addTrackKey(){return this._run(()=>this.editor.sheetInsertKey(this.ids,this.start));}
  duplicateFrameAfter(){return this._run(()=>{const result=this.editor.sheetDuplicateFrameAfter(this.ids);this.start=this.end=this.editor.tick;this.revealPlayhead();return result;});}
  insertFrames(){return this._run(()=>this.editor.sheetInsertFrames(this.ids,this.start,this.end-this.start+1));}
  extendKeyframe(){return this._run(()=>this.editor.movieclipBatch('Extend keyframe',()=>{for(const id of this.ids){const {start,end}=this.editor.sheetSpan(id,this.start);this.editor.sheetSetDuration(end-start+1,id,this.start);}}));}
  clearKeys(){if(this.editor._selectedCameraMotion)return this._run(()=>this.editor.deleteCameraMotion(this.editor._selectedCameraMotion));return this.end>0?this._run(()=>this.editor.sheetClearKeys(this.ids,Math.max(1,this.start),this.end)):false;}
  removeFrames(){return this._run(()=>this.editor.sheetRemoveFrames(this.ids,this.start,this.end));}
  copySelection(){if(this.editor._selectedCameraMotion)return this._copyMotion();this.editor._cameraMotionClipboard=null;const ids=this.ids,start=this.start,end=this.end;return this._clipboard('copy',()=>this.editor.sheetCopyFrames(ids,start,end));}
  cutSelection(){if(this.editor._selectedCameraMotion)return this._copyMotion(true);this.editor._cameraMotionClipboard=null;const ids=this.ids,start=this.start,end=this.end;return this._clipboard('copy',()=>{this.editor.sheetCopyFrames(ids,start,end);this.editor.sheetRemoveFrames(ids,start,end);return this.editor._sheetClipboard;});}
  pasteSelection(){const ids=this.ids,start=this.start,operation=kind=>{if(kind==='camera-motion'){const id=this.editor.pasteCameraMotion(Math.floor(this.editor.tick));this._selectMotion(id);return id;}if(kind&&kind!=='sheet')throw new Error('Paste the copied figures on the canvas.');return pasteSheetClipboard(this.editor,ids,start);};return this._run(()=>this.sharedClipboard?this.sharedClipboard.paste(null,operation):operation(this.editor._cameraMotionClipboard?'camera-motion':null));}
  _clipboard(action,operation){return this._run(()=>this.sharedClipboard?this.sharedClipboard[action]('sheet',operation):operation());}
  selectAll(){this.selectedLayers=new Set(this.tracks.filter(t=>t.kind!=='motion').map(t=>t.id));this.start=0;this.end=this.editor.totalTicks-1;this.update();}
  newLayer(){return this._run(()=>{const layer=this.editor.createLayer();this.setLayerFilter('',null);this._selectLayer(layer.id);this.revealSelectedLayer();return layer;});}
  deleteLayer(){return this._run(()=>this.onDeleteLayer?this.onDeleteLayer(this.selectedTrackId):this.editor.deleteLayerAsync(this.selectedTrackId));}
  reorderLayer(direction){const order=this.editor.report._styk.layers.order,index=order.indexOf(this.selectedTrackId);if(index>=0)return this._run(()=>this.editor.moveLayerTo(this.selectedTrackId,clamp(index-direction,0,order.length-1)));}
  _keyDown(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopPropagation();this.layerSearch.focus();this.layerSearch.select();return;}if(event.key==='F2'){event.preventDefault();const node=this.labels.find(node=>!node.hidden&&node._id===this.selectedTrackId);if(node)this._renameLayer(node);return;}if(this._motionKey(event))return;if(this.ownsHotkeys&&this.hotkeys.keydown(event,['timeline']))event.stopPropagation();}
  _menu(event,{layer=false,view=false}={}){
    const editor=this.editor,selected=editor.getLayer(this.selectedTrackId),locked=this.ids.some(id=>editor.getLayer(id)?.locked);
    if(view)return showTimelineMenu(this,event,[[
      {label:'Fit animation',symbol:'maximize',action:()=>this.fitFrameRange()},
      {label:'Fit selected frames',symbol:'maximize',action:()=>this.fitFrameRange(true)},
      {label:'Reveal playhead',symbol:'chevron-right',action:()=>this.revealPlayhead()},
      {label:'Find layers',symbol:'search',action:()=>{this.layerSearch.focus();this.layerSearch.select();}},
      {label:this.focusedLayerIds?'Show all layers':'Focus selected layers',symbol:'layers',action:()=>this.focusSelectedLayers()},
      {label:'Show all layers on canvas',symbol:'eye',action:()=>editor.movieclipBatch('Show all layers',()=>{for(const layer of editor.layers)if(layer.kind==='layer')editor.setLayerVisible(layer.id,true);})},
      {label:'Unlock all layers',symbol:'unlock',action:()=>editor.movieclipBatch('Unlock all layers',()=>{for(const layer of editor.layers)if(layer.kind==='layer')editor.setLayerLocked(layer.id,false);})},
    ],[
      {label:'Select Camera',symbol:'camera',action:()=>this._selectLayer('camera')},
      {label:'Select Scene',symbol:'scene',action:()=>this._selectLayer('scene')},
    ]]);
    const motion=editor.getCameraMotions().find(c=>c.id===editor._selectedCameraMotion);
    if(motion)return showTimelineMenu(this,event,[[
      !locked&&{label:motion.enabled?'Mute motion':'Enable motion',symbol:motion.enabled?'eye-off':'eye',action:()=>editor.setCameraMotion(motion.id,{enabled:!motion.enabled})},
      !locked&&{label:'Duplicate motion',symbol:'duplicate',action:()=>{editor._selectedCameraMotion=editor.duplicateCameraMotion(motion.id);}},
      !locked&&motion.enabled&&{label:'Bake clip range',symbol:'diamond',action:()=>editor.bakeCameraMotion({start:motion.start,end:motion.start+motion.duration})},
      locked&&{label:'Unlock Camera',symbol:'unlock',action:()=>editor.setLayerLocked('camera',false)},
    ],[!locked&&{label:'Delete motion',symbol:'trash',danger:true,action:()=>editor.deleteCameraMotion(motion.id)}]]);
    if(layer)return showTimelineMenu(this,event,[
      [selected?.kind==='layer'&&{label:'Focus this layer',symbol:'layers',action:()=>this.setLayerFilter('',new Set([selected.id]))},
       selected?.kind==='layer'&&{label:'Layer color',symbol:'layers',action:()=>showTimelineMenu(this,event,[[{label:'No color',symbol:'layers',checked:!selected.color,action:()=>editor.setLayerColor([selected.id],null)},...Object.keys(LAYER_COLORS).map(color=>({label:color[0].toUpperCase()+color.slice(1),symbol:'layers',checked:selected.color===color,action:()=>editor.setLayerColor([selected.id],color)}))]])},
       selected?.kind==='layer'&&{label:'Rename layer',symbol:'text',action:()=>{const node=this.labels.find(node=>node._id===selected.id);if(node)this._renameLayer(node);}},
       {label:selected?.visible===false?'Show layer':'Hide layer',symbol:selected?.visible===false?'eye':'eye-off',action:()=>editor.setLayerVisible(selected.id,selected.visible===false)},
       {label:selected?.locked?'Unlock layer':'Lock layer',symbol:selected?.locked?'unlock':'lock',action:()=>editor.setLayerLocked(selected.id,!selected.locked)}],
      [{label:'New layer',symbol:'plus',action:()=>this.newLayer()},
       {label:'New drawing layer',symbol:'brush',action:()=>{const layer=editor.createDrawingLayer();this._selectLayer(layer.id);}},
       selected?.kind==='layer'&&!selected.locked&&editor.report._styk.layers.order.length>1&&{label:'Delete layer',symbol:'trash',danger:true,action:()=>this.deleteLayer()}],
    ]);
    const hasKey=this.ids.some(id=>editor.layerFrameKeys(id).some(k=>k.tick>0&&k.tick>=this.start&&k.tick<=this.end)),
      hasFrames=this.ids.some(id=>this.start<(editor.report._styk.layerSheet.tracks[id]?.end??0)),
      clipboard=editor._sheetClipboard,order=editor.getLayers().filter(l=>l.kind==='layer').map(l=>l.id).reverse(),
      destinations=clipboard&&(this.ids.length===clipboard.rows.length?this.ids:this.ids.length===1?order.slice(order.indexOf(this.ids[0]),order.indexOf(this.ids[0])+clipboard.rows.length):[]),
      canPaste=this.sharedClipboard || destinations?.length===clipboard?.rows.length&&destinations?.every(id=>!editor.getLayer(id)?.locked);
    showTimelineMenu(this,event,[
      [!selected?.drawing&&!locked&&this.ids.length>0&&{label:'Change easing…',symbol:'sliders',action:()=>this.showEasingPopover(event)},!locked&&{label:'Add Frame',shortcut:this.shortcut('add-frame'),symbol:'plus',action:()=>this.addFrame()}],
      [selected?.drawing&&!locked&&{label:'Blank drawing here',shortcut:this.shortcut('insert-blank-key'),symbol:'frame',action:()=>editor.drawingKey(this.ids,this.start,{blank:true})},selected?.drawing&&!locked&&{label:'Copy drawing here',shortcut:this.shortcut('insert-copied-key'),symbol:'duplicate',action:()=>editor.drawingKey(this.ids,this.start)},hasFrames&&!locked&&{label:'Extend exposure',shortcut:this.shortcut('extend-keyframe'),symbol:'plus',action:()=>this.extendKeyframe()}],
      [hasFrames&&!locked&&{label:'Copy frames',shortcut:this.shortcut('copy'),symbol:'duplicate',action:()=>this.copySelection()},
       hasFrames&&!locked&&{label:'Cut frames',shortcut:this.shortcut('cut'),symbol:'cut',action:()=>this.cutSelection()},
       canPaste&&!locked&&{label:'Paste frames',shortcut:this.shortcut('paste'),symbol:'clipboard',action:()=>this.pasteSelection()}],
      [hasKey&&!locked&&{label:'Delete selected keys',shortcut:this.shortcut('delete'),symbol:'minus',action:()=>this.clearKeys()},
       hasFrames&&!locked&&{label:'Remove frames',shortcut:this.shortcut('remove-frames'),symbol:'trash',danger:true,action:()=>this.removeFrames()},
       locked&&{label:'Unlock layers',symbol:'unlock',action:()=>{for(const id of this.ids)editor.setLayerLocked(id,false);}}],
    ]);
  }
  destroy(){this.disposed=true;this.audio?.destroy();this._cancelGesture();this.events.abort();this.menuEvents?.abort();this.observer.disconnect();if(this.raf)cancelAnimationFrame(this.raf);this.menu?.remove();this.easingPopover?.hidePopover();this.headerTools.remove();this.onionRange.destroy();this.navigationOverlay.remove();this.root.remove();}
}

Object.assign(Timeline.prototype,cameraMotionTimelineMethods,timelineOrganizationMethods);

installVfxTimeline(Timeline);
