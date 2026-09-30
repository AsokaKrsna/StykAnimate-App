import {presentError} from './error-presentation.mjs';
import {translatedElement, localizedMarkup, localizedAttribute, localizedText} from './localization-bindings.mjs';
import {messageError} from './localized-error.mjs';
import {t as interfaceText, messageText as sayTimeline} from './localization.mjs';

import {installVfxTimeline,paintVfxRow} from './vfx-clip-timeline.mjs';
import {setText} from './ui/dom-write.mjs';
import {vfxIcon} from './vfx-icons.mjs';
import {vfxChannelLabel,vfxChannelRevision,vfxChannelMessage} from './vfx-key-channels.mjs';
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
import {drawingMetadata} from './drawing-model.mjs';
import {icon} from './icons.mjs';
import {showTimelineMenu} from './timeline-menu.mjs';
import {AudioTimeline} from './audio-timeline.mjs';
import {onFontsReady} from './ui/font-loading.mjs';
import {openMenu,menuFor} from './ui/ui-menu.mjs';

import {ROW,HEADER,sheetRowLayout,shortSheet} from './timeline-rows.mjs';
import {TOUCH_ZOOM,timelineTouchMethods} from './touch/timeline-scrubber.mjs';

/** The tall tier's content row and ruler (timeline-rows.mjs holds the whole row geometry: 24px Camera and Scene,
 * 28px rows and a 24px ruler at the short tier). */
export {ROW,HEADER};
const MAX_SCROLL=8000000;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const element=(tag,parent,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;parent?.append(node);return node;};
/** Adobe-style exposure grid. Painting and DOM size depend only on viewport,
 * not the number of frames, layers, instances or nested clip frames. */
export class Timeline{
  constructor(container,editor,options={}){
    this.editor=editor;this.container=container;Object.assign(this,options);this.events=new AbortController();this.labels=[];this.pxPerTick=this._touch()?TOUCH_ZOOM.initial:14;this.labelWidth=220;
    this.selectedLayers=new Set([editor.activeLayerId]);this.start=this.end=Math.max(0,Math.floor(editor.tick));this.selectedTrackId=editor.activeLayerId;
    if(!editor.report._styk.layerSheet){initializeLayerSheet(editor.report);editor._invalidate({timing:true});}
    attachTimelineHotkeys(this);
    this.root=element('div',container,'layer-timeline');this.dirty=true;
    // The touch interface's timeline (docs/TOUCH.md): finger-tall rows, a centred playhead, the header's action bar.
    this.root.toggleAttribute('data-touch',this._touch());
    this.main=element('div',this.root,'sheet-main');
    // The layer list's header: its title (Find layers' field takes its place while it has focus or text),
    // Focus selected layers (from two layers), New layer (a split: + and the other kind) and Find layers.
    const head=this.labelHead=element('div',this.main,'sheet-label-head');
    this.labelTitle=translatedElement(element('span',head,'sheet-label-title',sayTimeline(null,'timeline.layers')), 'timeline.layers', {});
    const search=this.searchField=element('label',head,'sheet-search');localizedMarkup(search, icon('search'));search.hidden=true;
    this.layerSearch=element('input',search);this.layerSearch.type='search';localizedAttribute(this.layerSearch, "placeholder", 'timeline.findLayers', {});localizedAttribute(this.layerSearch, 'aria-label', 'timeline.findLayers', {});
    this._on(this.layerSearch,'input',()=>this.setLayerFilter(this.layerSearch.value));
    this._on(this.layerSearch,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();this.setLayerFilter('',null);this.scroll.focus();}if(event.key==='Enter'){event.preventDefault();this.revealSelectedLayer();this.scroll.focus();}});
    this._on(this.layerSearch,'blur',()=>this._syncOrganization());
    this.clearSearch=this._button(search,'close',sayTimeline(null,'timeline.clearFind'),()=>this.setLayerFilter(''));this.clearSearch.hidden=true;
    // Show all: a labelled chip while a focus is on (a layer's menu, the grid's menu and the palette focus layers).
    const focus=this.focusLayersButton=element('button',head,'ui-button sheet-focus');focus.type='button';focus.dataset.size='sm';localizedMarkup(focus, `${icon('layers')}<span class="ui-label"></span>`);focus.setAttribute('aria-pressed','false');focus.hidden=true;
    this._on(focus,'click',()=>{try{this.focusSelectedLayers();}catch(error){presentError(this.live, error);this.onError?.(error);}});
    const add=element('div',head,'ui-split sheet-new-layer');add.setAttribute('role','group');add.dataset.size='sm';localizedAttribute(add, 'aria-label', 'timeline.newLayer', {});
    this.newLayerButton=this._headButton(add,'plus',sayTimeline(null,'timeline.newLayer'),()=>this.newLayer(this._drawWorkspace()?'drawing':'layer'));
    this.newLayerMore=element('button',add,'ui-split-more');this.newLayerMore.type='button';localizedMarkup(this.newLayerMore, icon('chevron-down'));localizedAttribute(this.newLayerMore, 'aria-label', 'timeline.moreLayerTypes', {});this.newLayerMore.setAttribute('aria-haspopup','menu');this.newLayerMore.setAttribute('aria-expanded','false');
    this._on(this.newLayerMore,'click',()=>{const other=this._drawWorkspace()?'layer':'drawing';if(menuFor(this.newLayerMore))return menuFor(this.newLayerMore).close('toggle');
      openMenu({anchor:this.newLayerMore,overlays:this.overlays??null,icon:name=>icon(name),label:sayTimeline(null,'timeline.moreLayerTypes'), labelKey: 'timeline.moreLayerTypes', labelParams: {},
        items:[{label:sayTimeline(null,other==='drawing'?'timeline.newDrawingLayer':'timeline.newLayer'), labelKey: other==='drawing'?'timeline.newDrawingLayer':'timeline.newLayer', labelParams: {},icon:other==='drawing'?'brush':'plus',run:()=>this._run(()=>this.newLayer(other))}]});});
    this.findButton=this._headButton(head,'search',sayTimeline(null,'timeline.findLayers'),()=>this.openLayerSearch());this.findButton.setAttribute('aria-keyshortcuts','Control+F');this.findButton.dataset.tooltip=`${sayTimeline(null,'timeline.findLayers')} · Ctrl+F`;
    this.emptyLayers=translatedElement(element('div',this.main,'sheet-empty-layers',interfaceText("layerTimeline.noMatchingLayers")), "layerTimeline.noMatchingLayers", {});this.emptyLayers.hidden=true;
    this.labelViewport=element('div',this.main,'sheet-labels');this.scroll=element('div',this.main,'sheet-scroll');this.scroll.tabIndex=0;this.scroll.setAttribute('role','grid');localizedAttribute(this.scroll, 'aria-label', "layerTimeline.layerFrames", {});this.scroll.setAttribute('aria-multiselectable','true');
    this.spacer=element('div',this.scroll,'sheet-spacer');this.canvas=element('canvas',this.main,'sheet-canvas');
    const overlay=element('div',this.main,'sheet-playhead-clip');this.playhead=element('div',overlay,'sheet-playhead');this.playheadLabel=element('span',this.playhead);
    this.divider=element('div',this.main,'sheet-resize');this.divider.setAttribute('role','separator');localizedAttribute(this.divider, 'aria-label', "layerTimeline.resizeLayerNames", {});
    // Add frame and Next copy live in the shared header (timeline-header.mjs); an audio clip's selection hides them there, as it did here.
    this.headerTools=this.header?.frameTools??element('div',null,'sheet-header-tools');
    this.live=element('div',this.root,'sheet-live');this.live.setAttribute('role','status');this.live.setAttribute('aria-live','polite');
    this._on(this.scroll,'scroll',()=>{this._cachedOffsetX=undefined;this.update();});this._on(this.scroll,'pointerdown',event=>this._pointerDown(event));this._on(this.scroll,'pointermove',event=>this._pointerMove(event));this._on(this.scroll,'pointerup',event=>this._pointerUp(event));this._on(this.scroll,'pointercancel',()=>this._cancelGesture());this._on(this.scroll,'lostpointercapture',()=>{if(!this.gesture?.touch)this._cancelGesture();});
    this._on(this.scroll,'contextmenu',event=>{event.preventDefault();const hit=this._hit(event);if(hit.row<0||!this.tracks[hit.row])return this._menu(event,{view:true});if(this.tracks[hit.row]?.kind.startsWith('vfx')){this._selectVfxRow(this.tracks[hit.row]);return;}if(!this._contains(hit))this._selectCell(hit);this._menu(event);});
    this._on(this.scroll,'dblclick',event=>this._doubleClick(event));
    this._on(this.main,'pointerleave',()=>{if(!this.gesture){this.hover=null;this.update();}});
    this._on(this.scroll,'keydown',event=>this._keyDown(event));this._on(this.labelViewport,'wheel',event=>{event.preventDefault();this.scroll.scrollTop+=event.deltaY;},{passive:false});
    this._on(this.scroll,'wheel',event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();this.setZoom(clamp(this.pxPerTick*(event.deltaY<0?1.15:.87),1,36),event.clientX-this.scroll.getBoundingClientRect().left);}else if(event.shiftKey){event.preventDefault();this.scroll.scrollLeft+=event.deltaY||event.deltaX;}},{passive:false});
    this._on(this.divider,'pointerdown',event=>{this._columnDrag={x:event.clientX,width:this.labelViewport.getBoundingClientRect().width||this.labelWidth};this.divider.setPointerCapture(event.pointerId);});
    this._on(this.divider,'pointermove',event=>{if(this._columnDrag){this.labelWidth=clamp(this._columnDrag.width+event.clientX-this._columnDrag.x,140,420);this.root.style.setProperty('--sheet-label',`${this.labelWidth}px`);this.resize();}});this._on(this.divider,'pointerup',()=>{this._columnDrag=null;});
    this.divider.tabIndex=0;this.divider.setAttribute('aria-orientation','vertical');
    this._on(this.divider,'keydown',event=>{if(!["ArrowLeft","ArrowRight","Home"].includes(event.key))return;event.preventDefault();event.stopPropagation();this.labelWidth=event.key==='Home'?220:clamp(this.labelWidth+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?40:10),140,420);this.root.style.setProperty('--sheet-label',`${this.labelWidth}px`);this.resize();});
    this._on(this.divider,'dblclick',()=>{this.labelWidth=220;this.root.style.setProperty('--sheet-label','220px');this.resize();});
    this._on(this.divider,'lostpointercapture',()=>{this._columnDrag=null;});
    this._on(editor,'change' ,event=>{const d=event.detail??{};if(d.kind==='document'){this.cameraMotionsCollapsed=false;this.layerQuery='';this.focusedLayerIds=null;this.layerSearch.value='';}
      if(d.kind==='vfx-channels'&&this.gesture?.kind.startsWith('vfx'))this._cancelGesture();
      if(d.kind==='vfx-selection'||d.kind==='vfx-target'||d.kind==='selection'&&editor._vfxTimelineVisible||d.kind==='document'||d.structural||d.layers||d.timing||d.layerSheet)this._reindex();
      else if(this.motionState!==editor.report._styk.cameraMotion)this._refreshMotionRows();
      if(d.kind==='selection'&&!d.sheetSelection&&editor.object){this.selectedTrackId=editor.layerForUid(editor.selectedUid);this.selectedLayers=new Set([this.selectedTrackId]);this.revealSelectedLayer();}
      if(d.kind==='seek'&&!this.gesture&&!this.selecting){if(!this.touchRange)this.start=this.end=Math.floor(editor.tick);this._centerSoon();}this.update(this._changeNeedsPaint(d));});
    this._on(window,'styk-theme-change',()=>this.resize());onFontsReady(()=>this.update(),{signal:this.events.signal});
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.root);this._reindex();this.resize();
    mountTimelineNavigation(this);this.header?.setZoom(this.pxPerTick);
    if(this._touch()){this._mountTouchActions();requestAnimationFrame(()=>{this.revealSelectedLayer();this.centerTick();});}
    this.audio=new AudioTimeline(container,editor,{...options,host:this,engine:options.audioEngine,mode:'advanced'});
    this._on(this.labelViewport,'pointerdown',()=>this.audio.clearSelection());
  }
  _on(target,name,fn,options={}){target.addEventListener(name,fn,{...options,signal:this.events.signal});}
  _button(parent,name,title,action){const button=element('button',parent,'icon-button');button.type='button';localizedMarkup(button, icon(name));button.title=title;button.setAttribute('aria-label',title);this._on(button,'click',event=>{this._run(()=>action(event));if(!this.menu&&!this.footer?.matches(':popover-open'))this.scroll?.focus({preventScroll:true});});return button;}
  /** A 24px button in the layer list's header (the kit's icon button; the tooltip reads its name). */
  _headButton(parent,name,title,action){const button=element('button',parent,'ui-icon-button');button.type='button';button.dataset.size='sm';localizedMarkup(button, icon(name));button.setAttribute('aria-label',title);this._on(button,'click',event=>{try{action(event);}catch(error){presentError(this.live, error);this.onError?.(error);}});return button;}
  _drawWorkspace(){return this.container.closest('.workspace')?.dataset.mode==='draw';}
  _run(operation){const fail=error=>{presentError(this.live, error);this.onError?.(error);return false;};try{this.onSeek?.();const wait=this.beforeCommand?.(),result=wait?wait.then(operation):operation();return result?.then?result.catch(fail):result;}catch(error){return fail(error);}}
  get ids(){return [...this.selectedLayers].filter(id=>this.editor.getLayer(id)&&this.trackById?.has(id));}
  get selectedTicks(){return [...new Set([this.start,...this.ids.flatMap(id=>this.editor.layerFrameKeys(id).filter(k=>k.tick>this.start&&k.tick<=this.end).map(k=>k.tick))])].sort((a,b)=>a-b);}
  get selectedTimeRange(){return {start:this.start,end:this.end+1};}
  get selectedFrameIndices(){return this.editor.timeline.filter(row=>row.start>=this.start&&row.start<=this.end).map(row=>row.index);}
  get loopRange(){return this.end>this.start?{start:this.start,end:this.end+1}:null;}
  _reindex(){
    if(!this.editor.report._styk.layerSheet){initializeLayerSheet(this.editor.report);this.editor._invalidate({timing:true});}
    this.motionState=this.editor.report._styk.cameraMotion;
    this.tracks=organizeTimelineRows([this.editor.getLayer('camera'),...(this.cameraMotionsCollapsed?[]:motionRows(this.editor)),this.editor.getLayer('scene'),...this.editor.layers.filter(l=>l.kind==='layer').reverse()],this.layerQuery,this.focusedLayerIds);
    this.tracks=this._effectRows(this.tracks);
    this.visibleLayerCount=this.tracks.reduce((count,row)=>count+(row.kind==='layer'?1:0),0);
    const editor=this.editor;
    this.trackById=new Map(this.tracks.map(layer=>[layer.id,{...layer,target:layer.kind==='layer'?{kind:'layer',id:layer.id}:{kind:layer.kind},get keys(){return layer.kind==='motion'?[]:editor.layerFrameKeys(layer.id);}}]));
    if(!this.editor.getLayer(this.selectedTrackId))this.selectedTrackId=this.editor.activeLayerId;
    this.selectedLayers=new Set([...this.selectedLayers].filter(id=>this.editor.getLayer(id)));if(!this.selectedLayers.size)this.selectedLayers.add(this.selectedTrackId);
    this.labelSignature=null;this.dirty=true;
    this.scroll.setAttribute('aria-rowcount',String(this.tracks.length));this.scroll.setAttribute('aria-colcount',String(this.editor.report._styk.layerSheet.duration));this._extent();
  }
  _extent(){
    this._cachedOffsetX=undefined;
    if(!this.main)return;
    // Read geometry together before changing inherited CSS. A write between
    // these reads forces another layout for every timeline paint.
    const {clientWidth,clientHeight,offsetWidth,offsetHeight}=this.scroll;
    this.width=Math.max(1,clientWidth);this.height=Math.max(1,clientHeight);
    for(const [name,value] of [['--sheet-scrollbar-x',`${offsetHeight-clientHeight}px`],['--sheet-scrollbar-y',`${offsetWidth-clientWidth}px`]])
      if(this.root.style.getPropertyValue(name)!==value)this.root.style.setProperty(name,value);
    const layout=this._layoutRows();
    this.audioTop=layout.header+layout.height;
    // Touch: room before frame 1 and after the end, so the centred playhead reaches every frame (timeline-scrubber.mjs).
    this.logicalWidth=Math.max(this.width,(Math.max(this.editor.totalTicks,this.end+1)+(this._touch()?8:60))*this.pxPerTick)+2*this._pad();this.logicalHeight=Math.max(this.height,this.audioTop+(this.audio?.contentHeight??0));
    const width=`${Math.min(MAX_SCROLL,this.logicalWidth)}px`,height=`${Math.min(MAX_SCROLL,this.logicalHeight)}px`;
    if(this.spacer.style.width!==width)this.spacer.style.width=width;if(this.spacer.style.height!==height)this.spacer.style.height=height;
  }
  /** The rows' geometry for the tracks, the height tier and the grid's height (timeline-rows.mjs), recomputed only when
   * one of them changes. It writes the ruler's height and where the scrolling rows start as custom properties, which
   * the label column, the playhead's tab and the overlays read (features/timeline.css). */
  _layoutRows(){
    const short=shortSheet(),touch=this._touch(),tracks=this.tracks??[],viewport=this.height||Infinity,key=this._layoutKey;
    if(this.layout&&key?.tracks===tracks&&key.short===short&&key.viewport===viewport&&key.touch===touch)return this.layout;
    this._layoutKey={tracks,short,viewport,touch};const layout=this.layout=sheetRowLayout(tracks,{short,viewport,touch});this.labelSignature=null;
    for(const [name,value] of [['--sheet-ruler',`${layout.header}px`],['--sheet-body-top',`${layout.contentTop}px`]])
      if(this.root.style.getPropertyValue(name)!==value)this.root.style.setProperty(name,value);
    return layout;
  }
  /** Row `index`'s top in the grid (0 is the ruler's top): pinned rows stay put, the others scroll. */
  rowY(index){const layout=this.layout;return layout.header+layout.top(index)-(layout.pinned&&index<layout.system?0:this._offsetY());}
  /** Row `index`'s height: 24 for Camera and Scene, the row height for the others. */
  rowSize(index){return this.layout.size(index);}
  /** Where the scrolling rows start in the grid (below the ruler and the pinned rows). */
  get bodyTop(){return this.layout?.contentTop??HEADER;}
  /** The horizontal scroll offset, read from layout once until a scroll or resize
   * clears it: playhead and marker updates run every played frame, after other
   * widgets wrote to the DOM, where a fresh read forces a synchronous layout. */
  offsetX(){return this._cachedOffsetX??=this._offsetX();}
  _offsetX(){const actual=Math.max(0,this.scroll.scrollWidth-this.scroll.clientWidth);return (actual?this.scroll.scrollLeft/actual*Math.max(0,this.logicalWidth-this.scroll.clientWidth):0)-this._pad();}
  _offsetY(){return this.scroll.scrollTop;}
  _scrollToX(x){const max=this.logicalWidth-this.scroll.clientWidth;this.scroll.scrollLeft=max>0?clamp(x+this._pad(),0,max)/max*(this.scroll.scrollWidth-this.scroll.clientWidth):0;this.update();}
  _scrollToY(y){this.scroll.scrollTop=y;this.update();}
  resize(){
    this.audio?.update();
    this._extent();const ratio=window.devicePixelRatio||1,width=Math.round(this.width*ratio),height=Math.round(this.height*ratio);
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;this.canvas.style.width=`${this.width}px`;this.canvas.style.height=`${this.height}px`;}
    const css=getComputedStyle(this.root),token=name=>css.getPropertyValue(name).trim(),color=name=>token(`--sheet-${name}`);
    this.colors=Object.fromEntries(['surface','hover','line','ink','muted','accent','selected','span','tween','camera-accent','camera-tint','scene-accent','scene-tint',
      'key-outline','cel','cel-line','draw-line','fx','layer','row-alt','lane','end','tick','cell','cell-tween','cell-blank','cell-divider','cell-selected'].map(name=>[name,color(name)]));
    Object.assign(this.colors,{'accent-soft':token('--accent-soft')||this.colors.selected,'accent-line':token('--accent-line')||this.colors.accent,'accent-text':token('--accent-text')||this.colors.accent});
    this.colors.cel||=this.colors.span;this.colors['cel-line']||=this.colors.line;this.colors['draw-line']||=this.colors.accent;this.colors.fx||=this.colors.accent;this.colors['key-outline']||=this.colors.muted;
    this.colors.cell||=this.colors.hover;this.colors['cell-tween']||=this.colors.tween;this.colors['cell-blank']||=this.colors['cel-line'];this.colors['cell-divider']||=this.colors.surface;this.colors['cell-selected']||=this.colors['accent-soft'];
    this.colors.layer||=this.colors.ink;this.colors['row-alt']||=this.colors.hover;this.colors.lane||=this.colors.line;this.colors.end||=this.colors.muted;this.colors.tick||=this.colors.line;
    this.font=token('--font-ui')||css.fontFamily;
    this.update();
  }
  setZoom(value,anchor=this.width/2){const old=this.pxPerTick,center=(this._offsetX()+anchor)/old,range=this.zoomRange;this.pxPerTick=clamp(Number(value)||14,range.min,range.max);this.header?.setZoom(this.pxPerTick);this._extent();this._scrollToX(center*this.pxPerTick-anchor);this.audio?.update();}
  setPaused(value){const resumed=this.paused&&!value;this.paused=value;this.update(Boolean(resumed));if(resumed)this._centerSoon();}
  update(dirty=true){
    this.dirty||=dirty;if(this.disposed||this.raf)return;
    this.raf=requestAnimationFrame(()=>{this._flushScrub();if(this.dirty){this.dirty=false;this._paint();}this._syncPlayhead();this.raf=null;
      if(this.pendingScrub!=null)this.update(false);
    });
  }
  // A pose preview changes the canvas, not exposure cells. Legacy animation
  // keys and every timeline-bearing change keep their usual redraw path.
  _changeNeedsPaint(detail){
    if(detail.kind==='seek')return !this.paused&&this.gesture?.kind!=='scrub';
    return !(detail.kind==='edit'&&detail.live&&!detail.animation&&!detail.structural&&!detail.timing&&
      !detail.layers&&!detail.layerSheet&&!detail.definition&&!detail.audio&&!detail.drawing&&!detail.vfxClips&&
      !detail.camera&&!detail.motionPath);
  }
  render(){this.update();}
  _syncPlayhead(){
    this.onionRange?.update();
    this.audio?.update(false);
    // The offset changes only on scroll or when _extent resizes the content;
    // both clear this cache. Reading it after other widgets wrote to the DOM
    // would force a layout on every seek.
    const tick=Math.floor(this.pendingScrub??this.editor.tick),x=(tick+.5)*this.pxPerTick-this.offsetX();this.playhead.style.transform=`translateX(${x}px)`;
    setText(this.playheadLabel,String(tick+1));

  }
  /**
   * Paints the grid (experience.md §5.7) as a sheet of frame cells: every row is a lane with a hairline under it, every
   * frame a rounded cell (_paintRow), every 5th frame's column (every 10th, 20th or 50th zoomed out) softly shaded under
   * the ruler's number, and the area past the end grey behind a clear end line. The selected frames are filled
   * and outlined in blue, and the hovered cell is outlined. Drawing cels and effect clips are
   * neutral blocks with hollow keys. The scrolling rows are
   * painted clipped under the pinned Camera and Scene, then the ruler: a tick per frame, numbers on the shaded
   * columns (past the end in a lighter weight), and while keys are dragged their timing ("12 → 14").
   */
  _paint(){
    this._syncOrganization();
    this.audio?.update();
    this._extent();const ctx=this.canvas.getContext('2d'),dpr=window.devicePixelRatio||1,step=this.pxPerTick,sx=this._offsetX(),sy=this._offsetY(),w=this.width,h=this.height,c=this.colors,layout=this.layout;
    this._cachedOffsetX=sx;
    if(!c)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle=c.surface;ctx.fillRect(0,0,w,h);
    const ruler=layout.header,bodyTop=layout.contentTop,count=this.tracks.length,pinned=layout.pinned?layout.system:0;
    const first=Math.floor(sx/step),last=Math.ceil((sx+w)/step),interval=step<2?50:step<5?20:step<9?10:5;
    const firstRow=clamp(Math.max(layout.at(bodyTop-ruler+sy),pinned),0,count),lastRow=clamp(layout.at(h-ruler+sy)+1,firstRow,count);
    const endX=this.editor.totalTicks*step-sx;
    // The backdrop of a band of the grid: the shaded column under each of the ruler's numbers (every 5th frame; wider
    // apart zoomed out; in the ruler only, the bars' seams count frames below), and the quiet area past the end behind
    // a clear end line.
    const backdrop=(top,bottom)=>{
      ctx.fillStyle=c.surface;ctx.fillRect(0,top,w,bottom-top);
      ctx.fillStyle=c['row-alt'];const shade=Math.min(bottom,ruler)-top;
      if(shade>0)for(let tick=Math.max(0,first);tick<=last;tick++)if((tick+1)%interval===0)ctx.fillRect(Math.round(tick*step-sx),top,Math.max(1,Math.round(step)),shade);
      if(endX<w){const x=Math.max(0,endX);ctx.fillStyle=c.hover;ctx.fillRect(x,top,w-x,bottom-top);if(endX>0){ctx.fillStyle=c.end;ctx.fillRect(Math.round(endX)-1,top,1.5,bottom-top);}}
      // Touch: the room before frame 1, so the centred playhead can stand on it, reads as outside the animation.
      if(sx<0){ctx.fillStyle=c.hover;ctx.fillRect(0,top,Math.min(w,-sx),bottom-top);}
    };
    backdrop(0,h);
    const region=(top,bottom,from,to,offset)=>{
      if(bottom<=top||to<=from)return;
      ctx.save();ctx.beginPath();ctx.rect(0,top,w,bottom-top);ctx.clip();
      // A hairline under every lane.
      ctx.fillStyle=c.lane;
      for(let index=from;index<to;index++)ctx.fillRect(0,ruler+layout.top(index)-offset+layout.size(index)-1,w,1);
      for(let index=from;index<to;index++)this._paintRow(ctx,index,ruler+layout.top(index)-offset,layout.size(index),first,last,sx);
      ctx.restore();
    };
    this._grip=this._exposureGrip();
    region(bodyTop,h,firstRow,lastRow,sy);
    // The pinned rows over the scrolling ones; a hairline under them once rows have scrolled beneath.
    if(pinned){backdrop(ruler,bodyTop);region(ruler,bodyTop,0,pinned,0);if(sy>0){ctx.fillStyle=c.line;ctx.fillRect(0,bodyTop-1,w,1);}}
    const g=this.gesture;
    if(g?.kind==='move'&&(g.delta||g.rowDelta)||g?.kind==='resize'){
      ctx.save();ctx.beginPath();ctx.rect(0,ruler,w,h-ruler);ctx.clip();
      ctx.strokeStyle=c['accent-line'];ctx.lineWidth=1.5;ctx.setLineDash([4,3]);
      for(const id of this.ids){const row=this.tracks.findIndex(t=>t.id===id)+(g.rowDelta??0);if(row<0||row>=count)continue;
        const start=g.kind==='resize'?g.span.start:this.start+(g.delta??0),end=g.kind==='resize'?g.span.end+g.delta:this.end+1+(g.delta??0),y=this.rowY(row),size=layout.size(row);
        ctx.beginPath();ctx.roundRect(start*step-sx+1.5,y+3,(end-start)*step-3,size-6,6);ctx.stroke();}
      ctx.restore();
    }
    this._paintRuler(ctx,{first,last,interval,sx,w,ruler,endX});
    this._syncMoreRows(layout.at(h-ruler+sy),count);
    this._paintLabels(firstRow,lastRow,sy);
    // Rename on create: the new row opens its name once it is painted.
    if(this.pendingRename){const node=this.labels.find(label=>!label.hidden&&label._id===this.pendingRename);if(node){this.pendingRename=null;this._renameLayer(node);}}
    // The shared header shows Add frame (Blank frame on a drawing layer) and, on a drawing layer, Next copy.
    const active=this.editor.getLayer(this.editor.activeLayerId),drawing=Boolean(active?.drawing),locked=drawing?active.locked||!active.visible:this.ids.some(id=>this.editor.getLayer(id)?.locked);
    this.header?.setAddFrame({blank:drawing,disabled:locked||!this.ids.length});
    this.header?.setNextCopy({shown:drawing,disabled:locked});
    this._syncTouchActions();
  }
  /** Where a row's bars sit: inset from the lane so neighbouring rows never touch, 16px tall in Camera and Scene. */
  _cellBox(y,size){const inset=size<=24?4:size>=36?Math.round(size*.17):5;return {top:y+inset,height:size-inset*2};}
  /**
   * The selected frames on a selected row: one continuous blue wash over the range and one accent outline around it
   * (a single frame included), so what is selected reads at a glance. Drawn over the bars and under the keys; only the
   * frames themselves are marked, never the rest of the row.
   */
  _paintSelection(ctx,layer,y,size,sx){
    if(!this.selectedLayers.has(layer.id))return;
    const c=this.colors,step=this.pxPerTick,x=this.start*step-sx,width=(this.end-this.start+1)*step;
    if(x+width<-4||x>this.width+4)return;
    const {top,height}=this._cellBox(y,size),radius=Math.min(6,width/2,height/2);
    ctx.fillStyle=c['cell-selected'];ctx.beginPath();ctx.roundRect(x+1,top,Math.max(2,width-2),height,radius);
    if(layer.drawing)ctx.globalAlpha=.6;ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle=c['accent-line'];ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x,top-2,Math.max(2,width),height+4,Math.min(7,width/2));ctx.stroke();
    if(this._touch()&&layer.id===this.selectedTrackId&&(this.touchRange||this.end>this.start))this._paintTouchHandles(ctx,y,size,sx);
  }
  /**
   * A row's exposures and keys (the VFX and camera-motion lanes paint themselves). An exposure is one rounded bar from
   * its key to the next key, so a held pose reads as one piece: neutral for a hold, the time violet for a tween, a
   * dashed outline for a blank span; once a frame is 10px wide, thin seams inside the bar count its frames. Nothing is
   * drawn before a layer's first key. Keys are ink dots at the bar's start (Camera gold, Scene violet; blanks hollow).
   */
  _paintRow(ctx,index,y,size,first,last,sx){
    const layer=this.tracks[index],c=this.colors,step=this.pxPerTick,w=this.width;
    if(layer.kind.startsWith('vfx')){paintVfxRow(this,ctx,layer,y,size);return;}
    if(layer.kind==='motion'){paintMotionRow(this,ctx,layer,y,size);return;}
    const track=this.editor.report._styk.layerSheet.tracks[layer.id],cy=y+size/2;
    const color=layer.kind==='camera'?c['camera-accent']:layer.kind==='scene'?c['scene-accent']:c.ink;
    if(track){
      const from=Math.max(0,sheetKeyAt(track,first).index),blankOf=key=>key.empty??(key.value?.frameId===null);
      const {top,height}=this._cellBox(y,size);
      if(!layer.drawing){
        // One path per fill; bars are clipped a little past the view, so a long hold stays one cheap shape.
        const held=new Path2D(),tweened=new Path2D(),blank=new Path2D(),seams=new Path2D(),lo=-8,hi=w+8;
        for(let i=from;i<track.keys.length;i++){
          const key=track.keys[i],next=track.keys[i+1],end=next?.tick??track.end;if(key.tick>last+1)break;if(end<=first-1)continue;
          const x0=key.tick*step-sx+1,x1=end*step-sx-1;if(x1-x0<1)continue;
          const a=Math.max(lo,x0),b=Math.min(hi,x1),radius=Math.min(6,height/2,(x1-x0)/2);
          if(blankOf(key)){blank.roundRect(a+.5,top+.5,Math.max(0,b-a-1),height-1,radius);continue;}
          const tween=next&&!blankOf(next)&&!['hold','constant'].includes(key.interpolation);
          (tween?tweened:held).roundRect(a,top,Math.max(0,b-a),height,radius);
          if(step>=10)for(let tick=Math.max(key.tick+1,first);tick<end&&tick<=last+1;tick++)seams.rect(Math.round(tick*step-sx)-.5,top+4,1,height-8);
        }
        ctx.fillStyle=c.cell;ctx.fill(held);ctx.fillStyle=c['cell-tween'];ctx.fill(tweened);ctx.fillStyle=c['cell-divider'];ctx.fill(seams);
        ctx.setLineDash([3,3]);ctx.lineWidth=1;ctx.strokeStyle=c['cell-blank'];ctx.stroke(blank);ctx.setLineDash([]);
        this._paintSelection(ctx,layer,y,size,sx);
      }
      else{
        for(let i=from;i<track.keys.length;i++){
          const key=track.keys[i],next=track.keys[i+1],end=next?.tick??track.end;if(key.tick>last)break;if(end<=first)continue;
          const blank=blankOf(key);
          // A cel: a neutral block over its exposure (the one under the playhead outlined), its drawing inside when wide enough.
          const left=key.tick*step-sx+1.5,right=end*step-sx-1.5;if(right-left<1)continue;
          const current=!blank&&this.editor.tick>=key.tick&&this.editor.tick<end&&layer.id===this.editor.activeLayerId;
          ctx.beginPath();ctx.roundRect(Math.max(-6,left),top,Math.max(1,Math.min(w+6,right)-Math.max(-6,left)),height,5);
          if(!blank){ctx.fillStyle=c.cel;ctx.fill();}
          ctx.lineWidth=current?1.5:1;ctx.strokeStyle=current?c['accent-line']:c['cel-line'];ctx.stroke();
          if(!blank&&right-left>34){const source=key.value?.frameId&&this.editor.getFrameById(key.value.frameId),object=source?.objects.find(o=>this.editor.layerForUid(o.unique_id)===layer.id),figure=object&&this.editor.report.figure_types.find(f=>f.figure_type_id===object.figure_type_id);if(figure&&drawingMetadata(figure)){const thumb=this.editor.drawingResources.thumbnail(figure,()=>{if(!this.disposed)this.update();});if(thumb){const width=Math.min(40,right-left-24);if(width>8)ctx.drawImage(thumb,left+16,top+2,width,height-4);}}}
        }
        this._paintSelection(ctx,layer,y,size,sx);
      }
      // Keys: ink dots at the start of their bar (Camera gold, Scene violet); blank keys and cel starts hollow.
      const dot=this._touch()?Math.max(3,Math.min(size>=40?7:5.5,step*.3)):Math.max(2.5,Math.min(size<=24?3.5:4.5,step*.34)),rowSelected=this.selectedLayers.has(layer.id),picked=tick=>rowSelected&&tick>=this.start&&tick<=this.end;
      const filled=new Path2D(),hollow=new Path2D();
      for(let i=from;i<track.keys.length;i++){
        const key=track.keys[i];if(key.tick>last)break;if(key.tick<first)continue;const x=(key.tick+.5)*step-sx;
        if(layer.drawing||blankOf(key)){hollow.moveTo(x+dot*.85,cy);hollow.arc(x,cy,dot*.85,0,Math.PI*2);}
        else{filled.moveTo(x+dot,cy);filled.arc(x,cy,dot,0,Math.PI*2);}
      }
      ctx.fillStyle=color;ctx.fill(filled);
      ctx.lineWidth=1.5;ctx.fillStyle=c.surface;ctx.fill(hollow);ctx.strokeStyle=layer.drawing?c['draw-line']:color;ctx.stroke(hollow);
      // The hovered frame: an outline, so the frame a click lands on is plain (not over the selection, which has its own).
      const hover=this.hover;
      if(hover?.row===index&&!this.gesture&&hover.tick>=0&&hover.tick<this.editor.totalTicks&&!picked(hover.tick)){ctx.strokeStyle=c.muted;ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(hover.tick*step-sx+.75,top-1.25,step-1.5,height+2.5,Math.min(6,step/2));ctx.stroke();}
      // The selected exposure's end: a grip to drag, holding the pose longer or shorter (today's edge drag). It shows
      // while the pointer is on the row (or dragging it), so a still grid carries no stray marks.
      const grip=this._grip;
      if(grip?.id===layer.id&&(this.hover?.row===index||this.gesture?.kind==='resize')){const x=grip.end*step-sx;if(x>-4&&x<w+4){ctx.fillStyle=c['accent-line'];ctx.beginPath();ctx.roundRect(x-1.5,cy-7,3,14,1.5);ctx.fill();}}
    }
    if(layer.locked){ctx.fillStyle=c.surface;ctx.globalAlpha=.45;ctx.fillRect(0,y,w,size);ctx.globalAlpha=1;}
  }
  /**
   * The ruler: frame numbers every 5 frames across the visible span (past the end too, in a lighter weight), none
   * where the playhead's tab sits, and while keys are dragged their timing beside the tab ("12 → 14").
   */
  _paintRuler(ctx,{first,last,interval,sx,w,ruler,endX}){
    const c=this.colors,step=this.pxPerTick,playX=(Math.floor(this.pendingScrub??this.editor.tick)+.5)*step-sx;
    // The ruler shares the grid's backdrop (its numbers sit on the shaded columns); a tick at each frame's edge.
    ctx.fillStyle=c.line;ctx.fillRect(0,ruler-1,w,1);
    if(step>=6){ctx.fillStyle=c.tick;for(let tick=Math.max(1,first);tick<=last;tick++)ctx.fillRect(Math.round(tick*step-sx),ruler-5,1,4);}
    ctx.textAlign='center';ctx.textBaseline='middle';
    const total=this.editor.totalTicks,cy=ruler/2+.5;
    for(let tick=Math.max(0,first);tick<=last;tick++){
      if(tick!==0&&(tick+1)%interval!==0)continue;
      const x=(tick+.5)*step-sx,label=String(tick+1),half=label.length*3.3;
      if(Math.abs(x-playX)<15+half+2)continue;
      ctx.font=`${tick<total?500:400} 11px ${this.font}`;ctx.fillStyle=c.muted;ctx.fillText(label,x,cy);
    }
    const g=this.gesture;let timing=null;
    if(g?.kind==='move'&&g.delta)timing=`${this.start+1} → ${this.start+g.delta+1}`;
    else if(g?.kind==='resize'&&g.delta)timing=`${g.span.end} → ${g.span.end+g.delta}`;
    if(timing){
      ctx.font=`600 11px ${this.font}`;ctx.textAlign='left';
      const width=ctx.measureText(timing).width+12,x=Math.min(w-width-2,playX+19);
      ctx.fillStyle=c['accent-soft'];ctx.beginPath();ctx.roundRect(x,cy-10,width,20,6);ctx.fill();
      ctx.fillStyle=c['accent-text'];ctx.fillText(timing,x+6,cy);
    }
  }
  /** The selected exposure (one layer, unlocked): its layer, first frame and end, for the end grip and its drag. */
  _exposureGrip(){
    if(this.ids.length!==1||this.gesture&&this.gesture.kind!=='resize')return null;
    const id=this.ids[0],layer=this.editor.getLayer(id);if(!layer||layer.locked)return null;
    if(this.gesture?.kind==='resize')return {id,start:this.gesture.span.start,end:this.gesture.span.end+this.gesture.delta};
    const track=this.editor.report._styk.layerSheet.tracks[id],{key,next}=sheetKeyAt(track,this.start);
    return key?{id,start:key.tick,end:next?.tick??track.end}:null;
  }
  /** "N more" at the foot of the ruler tools' column while content rows are below the grid, and a fade over the rows. */
  _syncMoreRows(cut,count){
    const below=Math.max(0,count-Math.max(cut,this.layout.system));
    if(below===this.moreBelow)return;this.moreBelow=below;
    if(!this.moreRows){
      this.moreRows=element('button',this.main,'ui-button sheet-more-rows');this.moreRows.type='button';this.moreRows.dataset.size='sm';this.moreRows.dataset.variant='ghost';
      localizedMarkup(this.moreRows, `${icon('arrow-down')}<span class="ui-label"></span>`);
      this._on(this.moreRows,'click',()=>{this._scrollToY(this._offsetY()+Math.max(this.layout.row,this.height-this.bodyTop-this.layout.row));this.scroll.focus({preventScroll:true});});
    }
    this.moreRows.hidden=!below;this.root.toggleAttribute('data-more-below',below>0);
    if(below){localizedText(this.moreRows.lastChild, 'timeline.moreRows', {count:below});localizedAttribute(this.moreRows, 'aria-label', below===1?'timeline.moreRowsNameOne':'timeline.moreRowsName', {count:below});}
  }
  /** The label column's rows for the pinned rows and the visible ones (row nodes are reused slots, as the canvas). */
  _paintLabels(first,last,sy){
    const layout=this.layout,pinned=layout.pinned?layout.system:0;
    const signature=[first,last,sy,pinned,layout.header,layout.row,this.editor.layerRevision,this.editor.activeLayerId,this.editor._selectedCameraMotion,this.editor._selectedVfxClip,vfxChannelRevision(this.editor),...this.ids].join(':');if(signature===this.labelSignature)return;this.labelSignature=signature;
    const rows=[];for(let index=0;index<pinned;index++)rows.push(index);for(let index=Math.max(first,pinned);index<last;index++)rows.push(index);
    for(let slot=0;slot<rows.length;slot++){
      let node=this.labels[slot];if(!node){
        node=element('div',this.labelViewport,'sheet-layer');node.setAttribute('role','row');
        const disclosure=element('button',node,'icon-button sheet-camera-disclosure');disclosure.type='button';localizedMarkup(disclosure, icon('chevron-right'));
        this._on(disclosure,'click',event=>{event.stopPropagation();this._setCameraMotionsCollapsed(!this.cameraMotionsCollapsed);});
        this._on(disclosure,'keydown',event=>{if(["ArrowLeft","ArrowRight"].includes(event.key)){event.preventDefault();event.stopPropagation();this._setCameraMotionsCollapsed(event.key==='ArrowLeft');}});
        node._disclosure=disclosure;
        const name=this._button(node,'layers',interfaceText("layerTimeline.selectLayer2"),event=>this._selectLayer(node._id,event));name.classList.add('sheet-layer-name');element('span',name);
        const channels=element('button',node,'vfx-channel-trigger');channels.type='button';localizedMarkup(channels, icon('sliders'));localizedAttribute(channels, 'aria-label', "layerTimeline.visibleEffectKeys", {});channels.setAttribute('aria-haspopup','dialog');element('span',channels);node._channels=channels;this._on(channels,'click',event=>{event.stopPropagation();this._run(()=>this._openVfxChannels(channels));});
        this._on(name,'dblclick',event=>{event.stopPropagation();this._renameLayer(node);});
        const eye=this._button(node,'eye',interfaceText("layerTimeline.toggleLayerVisibility"),()=>{const row=this.tracks.find(t=>t.id===node._id);if(row?.kind.startsWith('vfx'))return;return row?.kind==='motion'?this.editor.setCameraMotion(row.id,{enabled:!row.visible}):this.editor.setLayerVisible(node._id,!row.visible);});eye.classList.add('sheet-layer-state');
        const lock=this._button(node,'lock',interfaceText("layerTimeline.toggleLayerLock"),()=>this.editor.setLayerLocked(node._id,!this.editor.getLayer(node._id).locked));lock.classList.add('sheet-layer-state');
        name.draggable=true;this._on(name,'dragstart',event=>{this.dragLayer=node._id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',node._id);});
        this._on(node,'dragover',event=>{if(this.dragLayer&&this.dragLayer!==node._id&&this.editor.getLayer(node._id)?.kind==='layer'){event.preventDefault();const box=node.getBoundingClientRect();node.dataset.drop=event.clientY<box.top+box.height/2?'before':'after';}});this._on(node,'dragleave',()=>delete node.dataset.drop);
        this._on(node,'drop',event=>{event.preventDefault();const before=node.dataset.drop==='before';delete node.dataset.drop;const from=this.dragLayer;this.dragLayer=null;if(from&&from!==node._id&&this.editor.getLayer(node._id)?.kind==='layer')this._run(()=>{const order=this.editor.report._styk.layers.order.filter(id=>id!==from);this.editor.moveLayerTo(from,order.indexOf(node._id)+(before?1:0));});});
        this._on(name,'dragend',()=>{this.dragLayer=null;for(const label of this.labels)delete label.dataset.drop;});
        node._name=name;node._eye=eye;node._lock=lock;this._on(node,'contextmenu',event=>{event.preventDefault();this._selectLayer(node._id,event);if(this.tracks.find(t=>t.id===node._id)?.kind.startsWith('vfx'))return;this._menu(event,{layer:true});});this.labels.push(node);
      }
      const index=rows[slot],layer=this.tracks[index],size=layout.size(index),still=index<pinned;node.hidden=false;node._id=layer.id;node.dataset.layerId=layer.id;node.dataset.selected=String(layer.kind==='motion'?this.editor._selectedCameraMotion===layer.id:this.selectedLayers.has(layer.id));node.dataset.active=String(layer.id===this.editor.activeLayerId);node.style.transform=`translateY(${layout.top(index)-(still?0:sy)}px)`;
      // Pinned rows stay over the rows that scroll beneath them; each row is as tall as the canvas draws it.
      if(node._size!==size){node._size=size;node.style.height=`${size}px`;}
      if(node._still!==still){node._still=still;node.toggleAttribute('data-pinned',still);}
      node.style.setProperty('--layer-color',LAYER_COLORS[layer.color]??'transparent');node.dataset.color=layer.color??'';node.dataset.kind=layer.kind;node.dataset.drawing=String(Boolean(layer.drawing));node.dataset.hidden=String(layer.visible===false);node.dataset.locked=String(Boolean(layer.locked));node.setAttribute('aria-selected',node.dataset.selected);
      // One marker per row: Camera's and Scene's type glyph, a motion or effect lane's glyph, a layer's colour dot (a
      // drawing layer adds a muted brush after its name).
      const visualKind=layer.drawing?'drawing':layer.kind;if(node._kind!==visualKind){const lead=layer.kind==='vfx'?vfxIcon('effects'):['camera','scene','motion'].includes(layer.kind)?icon(layer.kind==='motion'?'activity':layer.kind):'<span class="ui-dot sheet-layer-dot" aria-hidden="true"></span>';
        localizedMarkup(node._name, `${lead}<span class="sheet-layer-text"></span>${layer.drawing?icon('brush','sheet-layer-kind'):''}`);node._text=node._name.querySelector('.sheet-layer-text');node._dot=node._name.querySelector('.sheet-layer-dot');node._kind=visualKind;node._dotColor=null;}
      const dotColor=LAYER_COLORS[layer.color]??'var(--sheet-layer)';if(node._dot&&node._dotColor!==dotColor){node._dotColor=dotColor;node._dot.style.setProperty('--dot',dotColor);}
      node._name.draggable=layer.kind==='layer';node._lock.hidden=layer.kind==='motion'||layer.kind.startsWith('vfx');node._eye.hidden=layer.kind.startsWith('vfx');
      const clip=layer.kind==='vfx'&&layer.clips.find(c=>c.id===this.editor._selectedVfxClip);node._channels.hidden=!clip||!Object.values(clip.keys).some(keys=>keys.length);if(clip){const label=vfxChannelLabel(this.editor,clip);const caption=vfxChannelMessage(this.editor,clip);localizedText(node._channels.lastChild,caption.messageKey,caption.messageParams);localizedAttribute(node._channels, "title", "layerTimeline.visibleEffectKeys2", {label: caption});}
      node._disclosure.hidden=layer.kind!=='camera'||!this.editor.getCameraMotions().length;
      node._disclosure.setAttribute('aria-expanded',String(!this.cameraMotionsCollapsed));localizedAttribute(node._disclosure, "title", "layerTimeline.cameraMotions", {value: this.cameraMotionsCollapsed?{messageKey: "layerTimeline.expand"}:{messageKey: "layerTimeline.collapse"}});node._disclosure.setAttribute('aria-label',node._disclosure.title);
      const name = layer.kind === 'camera' ? {messageKey: 'layerTimeline.camera'} : layer.kind === 'scene' ? {messageKey: 'layerTimeline.scene'} : layer.kind === 'motion' ? {messageKey: layer.nameKey} : layer.name;
      const suffix = layer.kind === 'camera' && this.cameraMotionsCollapsed ? {messageKey: 'layerTimeline.motionCount', messageParams: {count: this.editor.getCameraMotions().length}}
        : layer.parallax?.enabled ? {messageKey: 'layerTimeline.parallaxPercent', messageParams: {percent: Math.round(layer.parallax.x * 100)}} : '';
      localizedText(node._text, 'layerTimeline.rowName', {name, suffix});
      localizedAttribute(node._name, 'title', 'layerTimeline.nameTitle', {name, suffix: layer.drawing ? {messageKey: 'layerTimeline.drawingLayer'} : ''});
      localizedAttribute(node._name, 'aria-label', 'layerTimeline.selectLayer', {name});
      // Eye and lock at rest on every row: quiet, and at full contrast while hidden or locked.
      if(node._eye.dataset.on!==String(!layer.visible)){node._eye.dataset.on=String(!layer.visible);localizedMarkup(node._eye, icon(layer.visible?'eye':'eye-off'));}
      for (const attribute of ['aria-label', 'title']) localizedAttribute(node._eye, attribute, layer.visible ? 'layerTimeline.hideName' : 'layerTimeline.showName', {name});
      if(node._lock.dataset.on!==String(Boolean(layer.locked))){node._lock.dataset.on=String(Boolean(layer.locked));localizedMarkup(node._lock, icon(layer.locked?'lock':'unlock'));}
      for (const attribute of ['aria-label', 'title']) localizedAttribute(node._lock, attribute, layer.locked ? 'layerTimeline.unlockName' : 'layerTimeline.lockName', {name});
    }
    for(let slot=rows.length;slot<this.labels.length;slot++)this.labels[slot].hidden=true;
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
  // The app re-applies its selected track on every interface update. When that
  // track is already the only selection there is nothing to reveal or repaint;
  // reading the scroll position then would force layout mid-update.
  selectTrack(id){if(id?.startsWith('figure:'))id=this.editor.layerForUid(Number(id.slice(7)));if(this.editor.getLayer(id)){if(this.selectedTrackId===id&&this.selectedLayers.size===1&&this.selectedLayers.has(id))return;this.selectedTrackId=id;this.selectedLayers=new Set([id]);this.revealSelectedLayer();this.update();}}
  _renameLayer(node){const layer=this.editor.getLayer(node._id);if(layer?.kind!=='layer')return;const input=element('input',null,'sheet-layer-rename');node._name.after(input);localizedAttribute(input, 'aria-label', "layerTimeline.rename", {name: layer.name});input.value=layer.name;node._name.hidden=true;input.focus();input.select();let done=false;
    const finish=save=>{if(done)return;done=true;if(save&&input.value!==layer.name)this._run(()=>this.editor.renameLayer(layer.id,input.value));input.remove();node._name.hidden=false;this.update();};input.addEventListener('blur',()=>finish(true),{once:true});input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter')finish(true);if(event.key==='Escape')finish(false);});}
  /** The cell under a pointer: its frame and row (-1 on the ruler; pinned rows do not scroll). */
  _hit(event){const rect=this.scroll.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,layout=this.layout;
    const row=y<layout.header?-1:layout.pinned&&y<layout.contentTop?layout.at(y-layout.header):layout.at(y-layout.header+this._offsetY());
    return {tick:clamp(Math.floor((x+this._offsetX())/this.pxPerTick),0,9999999),row,x,y};}
  _contains(hit){return hit.row>=0&&this.selectedLayers.has(this.tracks[hit.row]?.id)&&hit.tick>=this.start&&hit.tick<=this.end;}
  _selectCell(hit,{extend=false,notify=true}={}){
    const wait=this.beforeCommand?.();if(wait)return wait.then(()=>this._selectCell(hit,{extend,notify})).catch(error=>this.onError?.(error));
    const layer=this.tracks[hit.row];if(!layer)return;if(layer.kind.startsWith('vfx'))return this._selectVfxRow(layer);if(layer.kind==='motion')return this._selectMotion(layer.id);this.editor._selectedCameraMotion=null;const changed=this.selectedTrackId!==layer.id,anchor=this.anchor??{tick:this.start,row:this.tracks.findIndex(l=>l.id===this.selectedTrackId)};
    if(extend){this.start=Math.min(anchor.tick,hit.tick);this.end=Math.max(anchor.tick,hit.tick);this.selectedLayers=new Set(this.tracks.slice(Math.min(anchor.row,hit.row),Math.max(anchor.row,hit.row)+1).map(l=>l.id));}
    else{this.start=this.end=hit.tick;this.selectedLayers=new Set([layer.id]);this.anchor={tick:hit.tick,row:hit.row};}
    this.selectedTrackId=layer.id;
    if(this.editor._sheetSelection?.id!==layer.id)this.editor.selectSheetLayer(layer.id,{contents:layer.id!=='camera'});
    this.selecting=true;try{if(this.editor.tick!==hit.tick)this.editor.seek(hit.tick,{allowBeyondEnd:true});}finally{this.selecting=false;}
    if(notify||changed)this.onTrackSelect?.(this.trackById.get(layer.id));localizedText(this.live, "layerTimeline.frame", {name: layer.name, value: this.start+1, value2: this.end>this.start?` to ${this.end+1}`:''});this.update();
  }
  _doubleClick(event){
    const hit=this._hit(event),layer=this.tracks[hit.row];if(!layer)return;if(layer.kind.startsWith('vfx'))return this._selectVfxRow(layer);if(layer.kind==='motion')return this._selectMotion(layer.id);
    const track=this.editor.report._styk.layerSheet.tracks[layer.id],{key,next}=sheetKeyAt(track,hit.tick);
    if(key?.tick!==hit.tick){this._selectCell(hit);this.addTrackKey();}
    else{if(!this._contains(hit))this._selectCell(hit);this.showEasingPopover(event);}
  }
  captureEasingSelection(){return this.ids.map(id=>({id,start:this.start,end:this.end}));}
  easingSettings(selection){return selection.flatMap(({id,start,end})=>{const track=this.editor.report._styk.layerSheet.tracks[id],first=sheetKeyAt(track,start).key;return (track?.keys??[]).filter(key=>key===first||key.tick>=start&&key.tick<=end).map(keyEasing);});}
  applyEasing(selection,easing){return this.editor.movieclipBatch(interfaceText("layerTimeline.changeEasing2"),()=>{for(const {id,start,end} of selection)this.editor.sheetSetEasing([id],start,end,easing);});}
  showEasingPopover(event){if(!this.ids.length||this.ids.some(id=>this.editor.getLayer(id)?.locked))return;const rect=this.scroll.getBoundingClientRect();this.easingAnchor={x:event?.clientX??rect.left+Math.min(this.width-16,Math.max(16,(this.start+.5)*this.pxPerTick-this._offsetX())),y:event?.clientY??rect.top+32};return showKeyframeEasingPopover.call(this);}
  /** The selected exposure's end grip under the pointer: up to a 24px target, reaching further into the exposure than
   * past it, so the next key's cell stays easy to click (a press there that does not move still selects that cell).
   * It never reaches the exposure's middle: at a close zoom or on a one-frame exposure the key itself stays the target
   * for moving the selection, and the grip shrinks toward today's 4px edge. */
  _resizeHit(hit){
    const grip=this.gesture?null:this._exposureGrip();
    if(!hit||hit.row<0||!grip||this.tracks[hit.row]?.id!==grip.id)return null;
    const dx=hit.x+this._offsetX()-grip.end*this.pxPerTick;
    const inward=Math.max(4,Math.min(12,(grip.end-grip.start)*this.pxPerTick/2-1));
    return dx>=-inward&&dx<=Math.min(6,Math.max(4,this.pxPerTick/2-1))?grip:null;
  }
  _flushScrub({force=false}={}){
    if(this.pendingScrub==null&&!this.pendingCell)return;
    const wait=this.beforeCommand?.();
    if(wait){if(!this.waitingForEdit)this.waitingForEdit=wait.then(()=>{this.waitingForEdit=null;this._flushScrub({force:true});},error=>{this.waitingForEdit=null;this.onError?.(error);});return;}
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
    try{this.scroll.setPointerCapture(event.pointerId);}catch{/* a replayed tap's finger has already lifted (touch/timeline-touch.mjs) */}this.scroll.focus({preventScroll:true});
    if(hit.row<0){this.gesture={kind:'scrub',pointer:event.pointerId};this.onScrubStart?.();this.pendingScrub=hit.tick;this.update(false);event.preventDefault();return;}
    this.audio?.clearSelection();
    if(this._motionDown(event,hit))return;
    const selected=this._contains(hit),span=this._resizeHit(hit),layer=this.tracks[hit.row];
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
      const resize=this._resizeHit(hit);this.scroll.style.cursor=hit.row<0?'ew-resize':resize?'ew-resize':'default';
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
    else if(g.kind==='resize'&&Math.abs(event.clientX-g.x)<=4&&!this._contains(g.hit))this._selectCell(g.hit);
    else if(g.kind==='move'&&(g.delta||g.rowDelta)){
      const destinations=this.ids.map(id=>this.tracks[this.tracks.findIndex(t=>t.id===id)+g.rowDelta]?.id);
      const done=this._run(()=>{
        if(destinations.some(id=>!id))throw messageError(new Error(''), "errors.layerTimeline.chooseDestinationLayersInsideTheTimeline", {});
        const containsKeys=this.ids.some(id=>this.editor.layerFrameKeys(id).some(k=>k.tick>=this.start&&k.tick<=this.end));
        return g.rowDelta||!containsKeys?this.editor.sheetTransferFrames(this.ids,destinations,this.start,this.end,this.start+g.delta,{copy:g.copy}):this.editor.sheetMoveFrames(this.ids,this.start,this.end,g.delta,{copy:g.copy,replace:this.getSettings?.().replaceKeyframesOnDrop!==false});
      });
      if(done){this.selectedLayers=new Set(destinations);this.selectedTrackId=destinations[0];this.start+=g.delta;this.end+=g.delta;this.editor.selectSheetLayer(destinations[0]);this.selecting=true;try{this.editor.seek(this.start,{allowBeyondEnd:true});}finally{this.selecting=false;}}
    }
    if(g.kind==='scrub'){this.start=this.end=Math.floor(this.editor.tick);this.onScrubEnd?.();}
    if(this.scroll.hasPointerCapture(event.pointerId))this.scroll.releasePointerCapture(event.pointerId);
    this.onRangeChange?.(this.selectedFrameIndices);this.update();this._centerSoon();
  }
  _cancelGesture(){if(this.gesture?.kind==='scrub')this.onScrubEnd?.();if(this.gesture?.kind==='camera-motion')this.onCameraMotionPreview?.(null);this.gesture=null;this.pendingScrub=null;this.pendingCell=null;this.update();}
  seek(tick){if(!Number.isInteger(tick)||tick<0)throw messageError(new Error(''), "errors.layerTimeline.chooseAValidFrame", {});this.onSeek?.();this.start=this.end=tick;this.editor.seek(tick,{allowBeyondEnd:true});this.update();}
  revealPlayhead(){if(this._touch())return this.centerTick(undefined,{smooth:true});const x=this.editor.tick*this.pxPerTick,left=this._offsetX();if(x<left)this._scrollToX(x);else if(x>left+this.width-30)this._scrollToX(x-this.width+60);}
  jumpKey(direction){const keys=this.editor.layerFrameKeys(this.selectedTrackId),tick=direction<0?[...keys].reverse().find(k=>k.tick<this.editor.tick)?.tick:keys.find(k=>k.tick>this.editor.tick)?.tick;if(tick!==undefined){this.seek(tick);this.revealPlayhead();}}
  /** Add Frame inserts a key at the selected cell. When every selected layer
   * already holds a key there, it instead duplicates the current pose into the
   * following cell, shifting later keys. */
  addFrame(){return this.onAddFrame?this.onAddFrame():this.addFrameCell();}
  /** The header's Add frame: as the grid's own button did, the grid keeps the keyboard afterwards. */
  addFrameFromHeader(){const result=this._run(()=>this.addFrame());if(!this.menu)this.scroll?.focus({preventScroll:true});return result;}
  /** The header's Next copy split: the next drawing as a copy of this one, or blank. */
  nextDrawing(blank=false){return this._run(()=>this.editor.nextDrawing([this.editor.activeLayerId],{blank}));}
  /** A blank or copied drawing at the selected cell of the selected drawing rows. */
  drawingKeyHere(blank=false){return this._run(()=>this.editor.drawingKey(this.ids,this.start,{blank}));}
  /** Fit timeline: the whole animation in the grid's width. */
  fitAll(){return this.fitFrameRange();}
  get zoomRange(){return this._touch()?{min:TOUCH_ZOOM.min,max:TOUCH_ZOOM.max}:{min:1,max:36};}
  addFrameCell(){if(this.editor.getLayer(this.editor.activeLayerId)?.drawing)return this._run(()=>this.editor.addDrawingFrame(this.editor.activeLayerId,this.start));const onKey=this.ids.length>0&&this.ids.every(id=>this.editor.layerFrameKeys(id).some(key=>key.tick===this.start));return onKey?this.duplicateFrameAfter():this.addTrackKey();}
  addTrackKey(){return this._run(()=>this.editor.sheetInsertKey(this.ids,this.start));}
  duplicateFrameAfter(){return this._run(()=>{const result=this.editor.sheetDuplicateFrameAfter(this.ids);this.start=this.end=this.editor.tick;this.revealPlayhead();return result;});}
  insertFrames(){return this._run(()=>this.editor.sheetInsertFrames(this.ids,this.start,this.end-this.start+1));}
  extendKeyframe(){return this._run(()=>this.editor.movieclipBatch(interfaceText("layerTimeline.extendKeyframe"),()=>{for(const id of this.ids){const {start,end}=this.editor.sheetSpan(id,this.start);this.editor.sheetSetDuration(end-start+1,id,this.start);}}));}
  clearKeys(){if(this.editor._selectedCameraMotion)return this._run(()=>this.editor.deleteCameraMotion(this.editor._selectedCameraMotion));return this.end>0?this._run(()=>this.editor.sheetClearKeys(this.ids,Math.max(1,this.start),this.end)):false;}
  removeFrames(){return this._run(()=>this.editor.sheetRemoveFrames(this.ids,this.start,this.end));}
  copySelection(){if(this.editor._selectedCameraMotion)return this._copyMotion();this.editor._cameraMotionClipboard=null;const ids=this.ids,start=this.start,end=this.end;return this._clipboard('copy',()=>this.editor.sheetCopyFrames(ids,start,end));}
  cutSelection(){if(this.editor._selectedCameraMotion)return this._copyMotion(true);this.editor._cameraMotionClipboard=null;const ids=this.ids,start=this.start,end=this.end;return this._clipboard('copy',()=>{this.editor.sheetCopyFrames(ids,start,end);this.editor.sheetRemoveFrames(ids,start,end);return this.editor._sheetClipboard;});}
  pasteSelection(){const ids=this.ids,start=this.start,operation=kind=>{if(kind==='camera-motion'){const id=this.editor.pasteCameraMotion(Math.floor(this.editor.tick));this._selectMotion(id);return id;}if(kind&&kind!=='sheet')throw messageError(new Error(''), "errors.layerTimeline.pasteTheCopiedFiguresOnTheCanvas", {});return pasteSheetClipboard(this.editor,ids,start);};return this._run(()=>this.sharedClipboard?this.sharedClipboard.paste(null,operation):operation(this.editor._cameraMotionClipboard?'camera-motion':null));}
  _clipboard(action,operation){return this._run(()=>this.sharedClipboard?this.sharedClipboard[action]('sheet',operation):operation());}
  selectAll(){this.selectedLayers=new Set(this.tracks.filter(t=>t.kind!=='motion').map(t=>t.id));this.start=0;this.end=this.editor.totalTicks-1;this.update();}
  /** New layer (or a drawing layer): its row opens its name for typing once it is painted. */
  newLayer(kind='layer'){return this._run(()=>{const layer=kind==='drawing'?this.editor.createDrawingLayer():this.editor.createLayer();this.setLayerFilter('',null);this._selectLayer(layer.id);this.revealSelectedLayer();this.pendingRename=layer.id;this.update();return layer;});}
  /** Find layers: the field takes the title's place and the focus. */
  openLayerSearch(){this.searchField.hidden=false;this.labelTitle.hidden=true;this.layerSearch.focus();this.layerSearch.select();}
  deleteLayer(){return this._run(()=>this.onDeleteLayer?this.onDeleteLayer(this.selectedTrackId):this.editor.deleteLayerAsync(this.selectedTrackId));}
  reorderLayer(direction){const order=this.editor.report._styk.layers.order,index=order.indexOf(this.selectedTrackId);if(index>=0)return this._run(()=>this.editor.moveLayerTo(this.selectedTrackId,clamp(index-direction,0,order.length-1)));}
  _keyDown(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopPropagation();this.openLayerSearch();return;}if(event.key==='F2'){event.preventDefault();const node=this.labels.find(node=>!node.hidden&&node._id===this.selectedTrackId);if(node)this._renameLayer(node);return;}if(this._motionKey(event))return;if(this.ownsHotkeys&&this.hotkeys.keydown(event,['timeline']))event.stopPropagation();}
  _menu(event,{layer=false,view=false}={}){
    const editor=this.editor,selected=editor.getLayer(this.selectedTrackId),locked=this.ids.some(id=>editor.getLayer(id)?.locked);
    // The grid's own menu (the ruler, the empty rows): the view, then the layers, then Camera and Scene.
    if(view)return showTimelineMenu(this,event,[[
      {heading:interfaceText("layerTimeline.view")},
      {label:interfaceText("layerTimeline.fitAnimation"), labelKey: "layerTimeline.fitAnimation",symbol:'fit',action:()=>this.fitFrameRange()},
      {label:interfaceText("layerTimeline.fitSelectedFrames"), labelKey: "layerTimeline.fitSelectedFrames",symbol:'maximize',action:()=>this.fitFrameRange(true)},
      {label:interfaceText("layerTimeline.revealPlayhead"), labelKey: "layerTimeline.revealPlayhead",symbol:'chevron-right',action:()=>this.revealPlayhead()},
    ],[
      {heading:interfaceText("layerTimeline.layers")},
      {label:interfaceText("layerTimeline.findLayers"), labelKey: "layerTimeline.findLayers",symbol:'search',shortcut:'Ctrl+F',action:()=>this.openLayerSearch()},
      {label:this.focusedLayerIds?interfaceText("layerTimeline.showAllLayers"):interfaceText("layerTimeline.focusSelectedLayers"), labelKey: (this.focusedLayerIds ? "layerTimeline.showAllLayers" : "layerTimeline.focusSelectedLayers"), labelParams: (this.focusedLayerIds ? {} : {}),symbol:'layers',action:()=>this.focusSelectedLayers()},
      {label:interfaceText("layerTimeline.showAllLayersOnCanvas"), labelKey: "layerTimeline.showAllLayersOnCanvas",symbol:'eye',action:()=>editor.movieclipBatch(interfaceText("layerTimeline.showAllLayers"),()=>{for(const layer of editor.layers)if(layer.kind==='layer')editor.setLayerVisible(layer.id,true);})},
      {label:interfaceText("layerTimeline.unlockAllLayers"), labelKey: "layerTimeline.unlockAllLayers",symbol:'unlock',action:()=>editor.movieclipBatch(interfaceText("layerTimeline.unlockAllLayers"),()=>{for(const layer of editor.layers)if(layer.kind==='layer')editor.setLayerLocked(layer.id,false);})},
    ],[
      {label:interfaceText("layerTimeline.selectCamera"), labelKey: "layerTimeline.selectCamera",symbol:'camera',action:()=>this._selectLayer('camera')},
      {label:interfaceText("layerTimeline.selectScene"), labelKey: "layerTimeline.selectScene",symbol:'scene',action:()=>this._selectLayer('scene')},
    ]]);
    const motion=editor.getCameraMotions().find(c=>c.id===editor._selectedCameraMotion);
    if(motion)return showTimelineMenu(this,event,[[
      !locked&&{label:motion.enabled?interfaceText("layerTimeline.muteMotion"):interfaceText("layerTimeline.enableMotion"), labelKey: (motion.enabled ? "layerTimeline.muteMotion" : "layerTimeline.enableMotion"), labelParams: (motion.enabled ? {} : {}),symbol:motion.enabled?'eye-off':'eye',action:()=>editor.setCameraMotion(motion.id,{enabled:!motion.enabled})},
      !locked&&{label:interfaceText("layerTimeline.duplicateMotion"), labelKey: "layerTimeline.duplicateMotion",symbol:'duplicate',action:()=>{editor._selectedCameraMotion=editor.duplicateCameraMotion(motion.id);}},
      !locked&&motion.enabled&&{label:interfaceText("layerTimeline.bakeClipRange"), labelKey: "layerTimeline.bakeClipRange",symbol:'diamond',action:()=>editor.bakeCameraMotion({start:motion.start,end:motion.start+motion.duration})},
      locked&&{label:interfaceText("layerTimeline.unlockCamera"), labelKey: "layerTimeline.unlockCamera",symbol:'unlock',action:()=>editor.setLayerLocked('camera',false)},
    ],[!locked&&{label:interfaceText("layerTimeline.deleteMotion"), labelKey: "layerTimeline.deleteMotion",symbol:'trash',danger:true,action:()=>editor.deleteCameraMotion(motion.id)}]]);
    // A layer's menu: named after the layer; its colour a submenu; New layer; Delete last.
    const own=selected?.kind==='layer',several=this.ids.filter(id=>editor.getLayer(id)?.kind==='layer').length>1;
    if(layer)return showTimelineMenu(this,event,[
      [selected&&{heading:selected.name},
       own&&{label:interfaceText("layerTimeline.renameLayer"), labelKey: "layerTimeline.renameLayer",symbol:'text',shortcut:'F2',action:()=>{const node=this.labels.find(node=>node._id===selected.id);if(node)this._renameLayer(node);}},
       own&&{label:interfaceText("layerTimeline.layerColor"), labelKey: "layerTimeline.layerColor",symbol:'palette',submenu:[[{label:interfaceText("layerTimeline.noColor"), labelKey: "layerTimeline.noColor",swatch:'var(--sheet-layer)',checked:!selected.color,action:()=>editor.setLayerColor([selected.id],null)},...Object.keys(LAYER_COLORS).map(color=>({label:color[0].toUpperCase()+color.slice(1),swatch:LAYER_COLORS[color],checked:selected.color===color,action:()=>editor.setLayerColor([selected.id],color)}))]]},
       {label:selected?.visible===false?interfaceText("layerTimeline.showLayer"):interfaceText("layerTimeline.hideLayer"), labelKey: (selected?.visible===false ? "layerTimeline.showLayer" : "layerTimeline.hideLayer"), labelParams: (selected?.visible===false ? {} : {}),symbol:selected?.visible===false?'eye':'eye-off',action:()=>editor.setLayerVisible(selected.id,selected.visible===false)},
       {label:selected?.locked?interfaceText("layerTimeline.unlockLayer"):interfaceText("layerTimeline.lockLayer"), labelKey: (selected?.locked ? "layerTimeline.unlockLayer" : "layerTimeline.lockLayer"), labelParams: (selected?.locked ? {} : {}),symbol:selected?.locked?'unlock':'lock',action:()=>editor.setLayerLocked(selected.id,!selected.locked)},
       own&&{label:several?interfaceText("layerTimeline.focusSelectedLayers"):interfaceText("layerTimeline.focusThisLayer"), labelKey: (several ? "layerTimeline.focusSelectedLayers" : "layerTimeline.focusThisLayer"), labelParams: (several ? {} : {}),symbol:'layers',action:()=>several?this.focusSelectedLayers():this.setLayerFilter('',new Set([selected.id]))}],
      // Moving a layer in the stack without dragging its name (a finger, a keyboard): up is toward the top row.
      own?[{label:interfaceText("layerTimeline.moveLayerUp"), labelKey: "layerTimeline.moveLayerUp",symbol:'up',disabled:editor.report._styk.layers.order.at(-1)===selected.id,action:()=>this.reorderLayer(-1)},
       {label:interfaceText("layerTimeline.moveLayerDown"), labelKey: "layerTimeline.moveLayerDown",symbol:'down',disabled:editor.report._styk.layers.order[0]===selected.id,action:()=>this.reorderLayer(1)}]:null,
      [{label:interfaceText("layerTimeline.newLayer"), labelKey: "layerTimeline.newLayer",symbol:'plus',action:()=>this.newLayer()},
       {label:interfaceText("layerTimeline.newDrawingLayer"), labelKey: "layerTimeline.newDrawingLayer",symbol:'brush',action:()=>this.newLayer('drawing')}],
      [own&&!selected.locked&&editor.report._styk.layers.order.length>1&&{label:interfaceText("layerTimeline.deleteLayer"), labelKey: "layerTimeline.deleteLayer",symbol:'trash',danger:true,action:()=>this.deleteLayer()}],
    ]);
    const hasKey=this.ids.some(id=>editor.layerFrameKeys(id).some(k=>k.tick>0&&k.tick>=this.start&&k.tick<=this.end)),
      hasFrames=this.ids.some(id=>this.start<(editor.report._styk.layerSheet.tracks[id]?.end??0)),
      clipboard=editor._sheetClipboard,order=editor.getLayers().filter(l=>l.kind==='layer').map(l=>l.id).reverse(),
      destinations=clipboard&&(this.ids.length===clipboard.rows.length?this.ids:this.ids.length===1?order.slice(order.indexOf(this.ids[0]),order.indexOf(this.ids[0])+clipboard.rows.length):[]),
      canPaste=this.sharedClipboard || destinations?.length===clipboard?.rows.length&&destinations?.every(id=>!editor.getLayer(id)?.locked);
    // A cell's menu: named after the frames it acts on; frames, a drawing's cels, the clipboard, then what removes something.
    const frames=this.end-this.start+1;
    showTimelineMenu(this,event,[
      [{heading:frames>1?`Frames ${this.start+1}–${this.end+1}`:`Frame ${this.start+1}`},
       !locked&&{label:interfaceText("layerTimeline.addFrame"), labelKey: "layerTimeline.addFrame",shortcut:this.shortcut('add-frame'),symbol:'plus',action:()=>this.addFrame()},
       !selected?.drawing&&!locked&&this.ids.length>0&&{label:interfaceText("layerTimeline.changeEasing"), labelKey: "layerTimeline.changeEasing",symbol:'sliders',action:()=>this.showEasingPopover(event)},
       hasFrames&&!locked&&{label:interfaceText("layerTimeline.extendExposure"), labelKey: "layerTimeline.extendExposure",shortcut:this.shortcut('extend-keyframe'),symbol:'stretch-horizontal',action:()=>this.extendKeyframe()}],
      [selected?.drawing&&!locked&&{heading:interfaceText("layerTimeline.drawing")},
       selected?.drawing&&!locked&&{label:interfaceText("layerTimeline.blankDrawingHere"), labelKey: "layerTimeline.blankDrawingHere",shortcut:this.shortcut('insert-blank-key'),symbol:'frame',action:()=>this.drawingKeyHere(true)},
       selected?.drawing&&!locked&&{label:interfaceText("layerTimeline.copyDrawingHere"), labelKey: "layerTimeline.copyDrawingHere",shortcut:this.shortcut('insert-copied-key'),symbol:'duplicate',action:()=>this.drawingKeyHere(false)}],
      [hasFrames&&!locked&&{label:interfaceText("layerTimeline.copyFrames"), labelKey: "layerTimeline.copyFrames",shortcut:this.shortcut('copy'),symbol:'duplicate',action:()=>this.copySelection()},
       hasFrames&&!locked&&{label:interfaceText("layerTimeline.cutFrames"), labelKey: "layerTimeline.cutFrames",shortcut:this.shortcut('cut'),symbol:'cut',action:()=>this.cutSelection()},
       canPaste&&!locked&&{label:interfaceText("layerTimeline.pasteFrames"), labelKey: "layerTimeline.pasteFrames",shortcut:this.shortcut('paste'),symbol:'clipboard',action:()=>this.pasteSelection()}],
      [hasKey&&!locked&&{label:interfaceText("layerTimeline.deleteSelectedKeys"), labelKey: "layerTimeline.deleteSelectedKeys",shortcut:this.shortcut('delete'),symbol:'minus',action:()=>this.clearKeys()},
       hasFrames&&!locked&&{label:interfaceText("layerTimeline.removeFrames"), labelKey: "layerTimeline.removeFrames",shortcut:this.shortcut('remove-frames'),symbol:'trash',danger:true,action:()=>this.removeFrames()},
       locked&&{label:interfaceText("layerTimeline.unlockLayers"), labelKey: "layerTimeline.unlockLayers",symbol:'unlock',action:()=>{for(const id of this.ids)editor.setLayerLocked(id,false);}}],
    ]);
  }
  destroy(){this.disposed=true;this._unmountTouchActions();cancelAnimationFrame(this._centerFrame??0);this.audio?.destroy();this._cancelGesture();this.events.abort();this.menuEvents?.abort();this.observer.disconnect();if(this.raf)cancelAnimationFrame(this.raf);this.menu?.remove();this.easingPopover?.hidePopover();this.headerTools.classList.remove('audio-selection');this.onionRange.destroy();this.root.remove();}
}

Object.assign(Timeline.prototype,cameraMotionTimelineMethods,timelineOrganizationMethods,timelineTouchMethods);

installVfxTimeline(Timeline);
