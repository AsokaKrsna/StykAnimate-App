import {icon} from './icons.mjs';
import {drawingMetadata,isDrawingLayer} from './drawing-model.mjs';
import {DrawingStroke} from './drawing-pixels.mjs';
import {TileStore} from './drawing-tiles.mjs';
import {sliderMarkup} from './drawing-sliders.mjs';
import {canSaveToProject,paletteColors,PROJECT_PALETTE_LIMIT} from './color-palette.mjs';
import {BRUSH_DEFAULTS,BRUSH_KEYS,BRUSH_LENGTHS,LINEAR_PRESSURE} from './drawing-brush.mjs';
import {pressureCurveMarkup} from './drawing-pressure-curve.mjs';

export const DRAWING_TOOLS = [
  ['brush','Brush','brush','Paint · B'], ['eraser','Eraser','eraser','Erase · E'],
  ['fill','Fill','paint-bucket','Fill · G'],
  ['lasso','Lasso','lasso','Select pixels · L'], ['shape','Shape','square','Line, rectangle and ellipse · U'],
  ['transform','Transform','transform','Transform drawing · V'],
];
// Every preset defines the whole tip, dynamics and blend (starting from the
// brush defaults) so switching presets is deterministic; alpha lock is a
// painting mode and persists.
const TIP=Object.fromEntries(Object.entries(BRUSH_DEFAULTS).filter(([key])=>key!=='alphaLock'));
export const BRUSH_PRESETS = [
  {id:'ink',name:'Ink',description:'Crisp, pressure-sensitive lines',...TIP,size:8,spacingRatio:.08},
  {id:'brushpen',name:'Brush pen',description:'Tapered ink strokes, even with a mouse',...TIP,size:12,spacingRatio:.05,taperIn:24,taperOut:48},
  {id:'pencil',name:'Pencil',description:'Fine grainy lines for rough animation',...TIP,size:2,hardness:.85,flow:.7,pressureOpacity:true,spacingRatio:.05,texture:.5,grain:'paper',sizeJitter:.1},
  {id:'liner',name:'Liner',description:'Smooth, stabilized clean-up lines',...TIP,size:5,spacingRatio:.05,stabilization:.45,taperOut:12},
  {id:'calligraphy',name:'Nib',description:'Flat calligraphy nib: thick and thin by stroke direction',...TIP,size:16,spacingRatio:.03,roundness:.2,angle:40},
  {id:'marker',name:'Marker',description:'Even translucent strokes',...TIP,size:24,hardness:.95,opacity:.35,pressureSize:false,spacingRatio:.12},
  {id:'soft',name:'Soft',description:'Soft edges for shading',...TIP,size:32,hardness:0,flow:.25,spacingRatio:.1},
  {id:'airbrush',name:'Airbrush',description:'Builds up soft paint with pen pressure',...TIP,size:72,hardness:0,flow:.06,pressureSize:false,pressureFlow:true,spacingRatio:.05},
  {id:'charcoal',name:'Charcoal',description:'Rough chalky tip that catches the paper grain',...TIP,size:20,hardness:.8,flow:.6,opacity:.9,pressureOpacity:true,spacingRatio:.06,tip:'chalk',roundness:.75,angleMode:'direction',texture:.6,grain:'paper',scatter:.05,sizeJitter:.15},
  {id:'chalk',name:'Chalk',description:'Broad pastel strokes with a broken edge',...TIP,size:30,hardness:.8,flow:.8,pressureOpacity:true,spacingRatio:.08,tip:'chalk',angleJitter:1,sizeJitter:.2,texture:.5,grain:'paper'},
  {id:'drybrush',name:'Dry brush',description:'Bristle streaks that follow the stroke on canvas grain',...TIP,size:36,flow:.9,spacingRatio:.03,tip:'bristle',angleMode:'direction',texture:.3,grain:'canvas',taperOut:30},
  {id:'sponge',name:'Sponge',description:'Porous, broken texture for foliage and clouds',...TIP,size:44,hardness:.6,flow:.5,pressureSize:false,spacingRatio:.25,tip:'sponge',opacityJitter:.5,angleJitter:1,scatter:.25},
  {id:'blender',name:'Blender',description:'Smudges and blends existing paint',...TIP,blend:'smudge',size:36,hardness:.4,opacity:.8,pressureOpacity:true,spacingRatio:.06,smudgeLength:.85},
  {id:'oil',name:'Oil',description:'Mixes the brush colour into wet paint',...TIP,blend:'smudge',size:28,hardness:.75,spacingRatio:.05,smudgeLength:.6,colorRate:.35},
];
export const BRUSH_TIP_LABELS=[['round','Round'],['chalk','Chalk'],['bristle','Bristle'],['sponge','Sponge']];
export const BRUSH_GRAIN_LABELS=[['noise','Noise'],['paper','Paper'],['canvas','Canvas']];
export const BRUSH_BLEND_LABELS=[['normal','Normal'],['behind','Behind'],['multiply','Multiply'],['screen','Screen'],['overlay','Overlay'],['color','Color'],['smudge','Smudge']];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

/** A small stroke drawn by the real brush engine, cached per preset tip. Smudge
 * presets drag two colour bands so the thumbnail shows what they do. */
const thumbnails=new Map();
export function presetThumbnail(p){
  if(typeof document==='undefined')return '';
  const key=p.id+':'+JSON.stringify(BRUSH_KEYS.map(k=>p[k]));
  const hit=thumbnails.get(key);if(hit)return hit;
  const W=120,H=36,store=new TileStore(),size=Math.max(2.5,Math.min(10,p.size*.5))*2;
  if(p.blend==='smudge'){const band=new Uint8ClampedArray(W*H*4);for(let y=6;y<H-6;y++)for(let x=0;x<W;x++)band.set(x<W/2?[222,78,78,255]:[64,96,208,255],(y*W+x)*4);store.writeRect(0,0,W,H,band);}
  try{
    // Lengths scale with the thumbnail's capped tip size.
    const scale=size/Math.max(.5,p.size??BRUSH_DEFAULTS.size),tip={...BRUSH_DEFAULTS,...p};for(const k of BRUSH_LENGTHS)tip[k]*=scale;
    const stroke=new DrawingStroke(store,{...tip,color:[42,42,48],seed:11,pixelsPerUnit:scale});
    for(let i=0;i<=28;i++){const t=i/28;stroke.sample({x:10+t*(W-20),y:H/2+Math.sin(t*Math.PI*2)*H*.2,pressure:.25+.75*Math.sin(Math.PI*t),time:i*16});}
    stroke.finish();
    const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;canvas.getContext('2d').putImageData(new ImageData(store.readRect(0,0,W,H),W,H),0,0);
    const url=canvas.toDataURL('image/png');canvas.width=canvas.height=1;
    if(thumbnails.size>=96)thumbnails.delete(thumbnails.keys().next().value);thumbnails.set(key,url);return url;
  }catch{return '';}
}
const presetButton=(p,s)=>`<button class="drawing-preset" data-draw-preset="${escape(p.id)}" aria-pressed="${s.preset===p.id}" title="${escape(p.description)}"><img class="drawing-preset-thumb" src="${presetThumbnail(p)}" alt=""><span>${escape(p.name)}</span></button>`;
export const presetGrid=(drawing)=>{const s=drawing.settings,custom=drawing.library?.presets??[];return `<div class="drawing-presets" role="group" aria-label="Brush presets">${[...BRUSH_PRESETS,...custom].map(p=>presetButton(p,s)).join('')}</div>`;};
/** The colours Draw offers: the project's or the recent ones, whichever the
 * colour picker shows, so the rail and every picker agree. */
export function drawingPalette(drawing){
  const {view,project}=paletteColors(drawing.editor?.report);
  return {view,project,colors:view==='project'?project:drawing.library?.recent??[]};
}
// The swatch group for Properties and the pop-up palette.
const paletteSwatches=drawing=>{
  const {view,colors}=drawingPalette(drawing),current=drawing.settings.color.toLowerCase();
  return colors.length?`<div class="drawing-swatches" role="group" aria-label="${view==='project'?'Project colors':'Recent colors'}">${colors.map(c=>`<button class="drawing-swatch" data-draw-color="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="Use ${c.toUpperCase()}" aria-pressed="${c===current}"></button>`).join('')}</div>`:'';
};
// The rail shows this many colours; +N opens the picker with the rest.
const RAIL_COLORS=8;
/** Main and second colour as an overlapping pair (X swaps), with the hex. */
export const colorPair=(s,{hex=true}={})=>`<div class="draw-colors"><div class="draw-color-pair"><input type="color" class="draw-color-primary" data-draw-setting="color" value="${s.color}" aria-label="Drawing color" title="Main color · Alt-click the canvas to pick"><input type="color" class="draw-color-secondary" data-draw-setting="color2" value="${s.color2??'#ffffff'}" aria-label="Second color" title="Second color"></div><button class="icon-button draw-color-swap" data-draw-action="swap-colors" title="Swap colors · X" aria-label="Swap colors">${icon('loop')}</button>${hex?`<span class="hex-label">${s.color.toUpperCase()}</span>`:''}</div>`;

/** Tool properties use the shared inspector sections; timing stays in the timeline.
 * The canvas quick bar owns everyday settings (colour, size, opacity, flow,
 * smoothing, mirror and tool modes); Properties holds only what it lacks, so
 * each control has exactly one home. */
export function drawingInspector(drawing,{numericField,group,grid,heading,propertyToggle},poseView='') {
  const {editor,settings:s,tool}=drawing;
  const field=(label,key,value,unit='',limits='')=>numericField(label,'draw:'+key,value,unit,limits,{}, {legacyField:false});
  const sliders=(...keys)=>`<div class="draw-sliders">${keys.map(key=>sliderMarkup(key,s[key])).join('')}</div>`;
  const button=(action,label,symbol='plus',disabled=false,title='')=>`<button class="button" data-draw-action="${action}" ${disabled?'disabled':''} title="${title}">${icon(symbol)}<span>${label}</span></button>`;
  const iconButton=(action,symbol,title,disabled=false)=>`<button class="icon-button" data-draw-action="${action}" title="${title}" aria-label="${title}" ${disabled?'disabled':''}>${icon(symbol)}</button>`;
  const toggle=(key,label,symbol,title=label)=>propertyToggle('draw-'+key,label,Boolean(s[key]),symbol,{title,attrs:`data-draw-setting="${key}"`});
  const select=(key,label,options)=>`<label class="drawing-resolution">${label}<select class="inline-select" data-draw-setting="${key}" data-draw-text aria-label="${label}">${options.map(([value,text])=>`<option value="${value}" ${s[key]===value?'selected':''}>${text}</option>`).join('')}</select></label>`;
  const details=(label,body)=>`<details class="inspector-section inspector-disclosure" data-section="${label}"><summary class="inspector-title">${label}</summary><div class="inspector-disclosure-body">${body}</div></details>`;
  const swatches=paletteSwatches(drawing);
  const quickHint=`<p class="drawing-hint drawing-quick-note">${icon('sliders')}Color, size and opacity are in the bar above the canvas.</p>`;
  const preview=`<canvas class="drawing-preview" data-inspector-owned data-section="brush-preview" data-brush-preview aria-label="Brush stroke preview"></canvas>`;
  let target;try{target=editor.drawingTarget();}catch{}
  const layer=editor.getLayer(editor.activeLayerId),eligible=isDrawingLayer(layer)&&!layer.locked&&layer.visible;
  let html=heading(DRAWING_TOOLS.find(t=>t[0]===tool)?.[1]??'Hand',DRAWING_TOOLS.find(t=>t[0]===tool)?.[2]??'hand');
  if(!eligible)html+=group('',`<div class="drawing-empty">${isDrawingLayer(layer)?'Show and unlock this drawing layer.':'Paint on the canvas to start — a drawing layer is created for you, or choose one in the timeline.'}</div><div class="property-context-actions">${button('new','New drawing layer','brush')}</div>`);
  if(tool==='brush'||tool==='eraser') {
    const custom=drawing.library?.presets??[],isCustom=custom.some(p=>p.id===s.preset);
    if(tool==='brush')html+=group('Preset',presetGrid(drawing)+`<div class="property-context-actions">${button('save-preset','Save brush','plus')}${isCustom?button('delete-preset','Delete brush','trash'):''}</div>`);
    html+=group('',preview+(tool==='brush'?swatches:'')+sliders('hardness')+quickHint);
    if(tool==='brush')html+=group('Painting',select('blend','Blend',BRUSH_BLEND_LABELS)+(s.blend==='smudge'?sliders('smudgeLength','colorRate'):'')+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('alphaLock','Lock alpha','lock')}</div>`);
    const smudge=s.blend==='smudge'&&tool==='brush';
    html+=details('Tip',(smudge?'':select('tip','Shape',BRUSH_TIP_LABELS))+sliders('roundness','angle','spacingRatio')+select('angleMode','Tip follows',[['fixed','Fixed angle'],['direction','Stroke direction'],['tilt','Pen tilt']]));
    html+=details('Stroke',sliders('taperIn',...(smudge?[]:['taperOut']))+select('stabilizerMode','Smoothing',[['average','Average'],['string','Pulled string']])+`<div class="drawing-hint">Tapers thin the start and end of every stroke. A pulled string moves the tip only once the pointer pulls it; smoothing strength is in the bar above the canvas.</div>`);
    if(!smudge)html+=details('Texture',select('grain','Grain',BRUSH_GRAIN_LABELS)+sliders('texture','grainScale'));
    html+=details('Dynamics',`<div class="property-toggle-grid drawing-toggle-grid">${toggle('pressureSize','Size pressure','scale')}${toggle('pressureOpacity','Opacity pressure','circle')}${toggle('pressureFlow','Flow pressure','activity')}</div>`+sliders('sizeCurve','opacityCurve','sizeJitter','opacityJitter','angleJitter','scatter'));
    html+=details('Pen pressure',pressureCurveMarkup(drawing.library?.pressureCurve??LINEAR_PRESSURE)+`<div class="drawing-hint">Applies to every brush. Drag the handles: above the diagonal, light pressure paints heavier.</div>`);
    html+=group('Assist',`<div class="property-toggle-grid drawing-toggle-grid">${toggle('mirrorY','Mirror vertically','flip','Mirror painting across the horizontal centre. Horizontal mirroring is in the canvas bar · Shift+M')}</div><div class="drawing-hint">Shift-click: straight line · ${tool==='brush'?'Alt-click: pick colour · ':''}Ctrl-drag: size · [ ]: size · 1–0: opacity</div>`);
  }
  if(tool==='fill')html+=group('Fill',swatches+quickHint+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('sampleAll','Sample all layers','layers')}</div><div class="drawing-hint">Alt-click picks a colour. Fills stay inside the selection.</div>`);
  if(tool==='shape')html+=group('Shape',swatches+quickHint+`<div class="drawing-hint">Outlines use the current brush. Shift constrains to 45°, squares and circles.</div>`);
  if(tool==='lasso'){
    html+=group('Select',(s.selectShape==='wand'?sliders('gap')+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('sampleAll','Sample all layers','layers')}</div>`:'')+`<div class="drawing-hint">Shift adds to the selection, Alt subtracts. Drag inside it to move pixels, a corner to scale or the top handle to rotate (Shift snaps to 15°).</div>`);
    const sel=drawing.selection,selected=Boolean(sel||drawing.marquee),moved=Boolean(sel&&(sel.dx||sel.dy||sel.scale!==1||sel.angle||(sel.fx??1)!==1||(sel.fy??1)!==1));
    html+=selected
      ?group('Selection',grid(field('Scale','selectionScale',(drawing.selection?.scale??1)*100,'%','min="1" max="1000"')+field('Angle','selectionAngle',drawing.selection?.angle??0,'°'))+`<div class="property-context-actions">${moved?button('apply-selection','Apply','check'):''}${button('cancel-selection','Deselect','close')}${button('invert-selection','Invert','flip')}${button('fill-selection','Fill','paint-bucket')}</div><div class="property-context-actions">${iconButton('flip-selection-x','flip','Flip selected pixels horizontally')}${iconButton('flip-selection-y','rotate','Flip selected pixels vertically')}${iconButton('copy-pixels','duplicate','Copy selected pixels · Ctrl+C')}${iconButton('cut-pixels','cut','Cut selected pixels · Ctrl+X')}${iconButton('delete-pixels','trash','Delete selected pixels · Delete')}</div>`)
      :group('Selection',`<div class="drawing-empty">Drag on the canvas to select pixels.</div><div class="property-context-actions">${button('select-all','Select all','square')}</div>`);
  }
  if(tool==='lasso'||tool==='transform')html+=details('Filters',`<div class="drawing-hint">Applies to the selection, or to the whole drawing when nothing is selected.</div>`+sliders('filterRadius')+`<div class="property-context-actions">${button('filter-blur','Blur','circle')}${button('filter-invert','Invert colors','flip')}</div>`+sliders('hue','saturation','lightness')+`<div class="property-context-actions">${button('filter-hsl','Apply color','check')}</div>`+sliders('brightness','contrast')+`<div class="property-context-actions">${button('filter-brightness','Apply tone','check')}</div>`);
  if(tool==='transform')html+=`<div class="drawing-pose">${poseView}</div>`;
  if(tool==='pan')html+=group('View',grid(field('Rotation','viewAngle',(drawing.state.view.rotation??0)*180/Math.PI,'°','min="-180" max="180"'))+`<div class="property-context-actions">${button('reset-rotation','Reset rotation','rotate')}<button class="button" data-draw-action="flip-view" aria-pressed="${Boolean(drawing.state.view.flip)}" title="Mirror the view to check proportions · M">${icon('flip')}<span>Flip view</span></button></div>`);
  const filter=`<label class="drawing-resolution">Pixel filtering<select class="inline-select" data-draw-setting="filter" aria-label="Pixel filtering"><option value="smooth" ${s.filter!=='nearest'?'selected':''}>Smooth</option><option value="nearest" ${s.filter==='nearest'?'selected':''}>Nearest (pixel art)</option></select></label>`;
  const d=drawingMetadata(target?.figure),ratio=d?s.resolution/d.pixelsPerUnit:1,canResample=Boolean(d);
  html+=details('Resolution',`${filter}<label class="drawing-resolution">New drawings<select class="inline-select" data-draw-setting="resolution" aria-label="New drawing resolution">${[1,2,4].map(n=>`<option value="${n}" ${s.resolution===n?'selected':''}>${n}×</option>`).join('')}</select></label>${d?`<div class="drawing-resolution-info">Current: ${d.pixelsPerUnit}×</div>`:''}<div class="property-context-actions">${button('resample','Resample drawing','transform',!canResample||ratio===1,'Resize pixels to the selected resolution. Upscaling cannot recover missing detail.')}</div>`);
  return html;
}

/** The pop-up palette (right-click): presets, the palette's colours, the
 * colour pair and the two sliders painters reach for most. */
export function paletteMarkup(drawing){
  const s=drawing.settings;
  return `${colorPair(s)}${paletteSwatches(drawing)}${drawing.tool==='brush'||drawing.tool==='eraser'?presetGrid(drawing):''}<div class="draw-sliders">${sliderMarkup('size',s.size)}${sliderMarkup('opacity',s.opacity)}</div>`;
}
/** The canvas quick bar: the settings a painter changes constantly, next to
 * the work instead of in the inspector. Choice buttons carry
 * data-draw-choice="setting" and data-value. */
export function quickBarMarkup(drawing){
  const s=drawing.settings,tool=drawing.tool;
  const choice=(key,value,label,title=label)=>`<button type="button" class="draw-quick-choice" data-draw-choice="${key}" data-value="${value}" aria-pressed="${s[key]===value}" title="${title}">${label}</button>`;
  const toggleButton=(key,symbol,title)=>`<button type="button" class="icon-button draw-quick-toggle" data-draw-choice="${key}" data-value="toggle" aria-pressed="${Boolean(s[key])}" title="${title}" aria-label="${title}">${icon(symbol)}</button>`;
  const slider=(key,label)=>sliderMarkup(key,s[key],{compact:true,label});
  const divider='<span class="draw-quick-divider" aria-hidden="true"></span>';
  // The bar names its tool, and painting tools keep the palette one click away
  // next to the colour pair: its first colours, +N for the rest (the picker)
  // and + to save the brush colour to the project (color-palette.mjs's canSaveToProject).
  const [,toolName,toolIcon]=DRAWING_TOOLS.find(t=>t[0]===tool)??['pan','Hand','hand'];
  const palette=drawingPalette(drawing),current=s.color.toLowerCase(),shown=palette.colors.slice(0,RAIL_COLORS),more=palette.colors.length-shown.length;
  const canAdd=canSaveToProject(palette.project)&&!palette.project.includes(current)&&palette.project.length<PROJECT_PALETTE_LIMIT;
  const rail=shown.map(c=>`<button type="button" class="draw-quick-swatch" data-draw-color="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="Use ${c.toUpperCase()}" aria-pressed="${c===current}"></button>`).join('')
    +(more?`<button type="button" class="draw-quick-more" data-draw-action="open-colors" title="All ${palette.colors.length} colors" aria-label="Show all ${palette.colors.length} colors">+${more}</button>`:'')
    +(canAdd?`<button type="button" class="draw-quick-add" data-draw-action="add-palette-color" title="Add ${current.toUpperCase()} to the project colors" aria-label="Add ${current.toUpperCase()} to the project colors">${icon('plus')}</button>`:'');
  const colors=()=>colorPair(s,{hex:false})+(rail?`<div class="draw-quick-swatches" role="group" aria-label="${palette.view==='project'?'Project colors':'Recent colors'}">${rail}</div>`:'');
  let body=`<span class="draw-quick-tool" title="${escape(toolName)}">${icon(toolIcon)}<span>${escape(toolName)}</span></span>`+divider;
  if(tool==='brush'||tool==='eraser'){
    const preset=[...BRUSH_PRESETS,...(drawing.library?.presets??[])].find(p=>p.id===s.preset);
    if(tool==='brush')body+=`<button type="button" class="draw-quick-preset" data-draw-action="toggle-quick-presets" aria-expanded="${Boolean(drawing.quickPresets)}" title="Brush presets">${preset?`<img src="${presetThumbnail(preset)}" alt="">`:icon('brush')}<span>${escape(preset?.name??'Custom')}</span></button>`+colors()+divider;
    body+=slider('size','Size')+slider('opacity','Opacity')+slider('flow','Flow')+slider('stabilization','Smooth')+divider+toggleButton('mirrorX','flip','Mirror painting · Shift+M');
  }else if(tool==='fill')body+=colors()+divider+slider('tolerance','Tolerance')+slider('gap','Gaps')+slider('expansion','Expand');
  else if(tool==='lasso')body+=choice('selectShape','lasso','Lasso')+choice('selectShape','rect','Rectangle')+choice('selectShape','ellipse','Ellipse')+choice('selectShape','wand','Wand')+(s.selectShape==='wand'?divider+slider('tolerance','Tolerance'):'');
  else if(tool==='shape')body+=choice('shapeKind','line','Line')+choice('shapeKind','rect','Rectangle')+choice('shapeKind','ellipse','Ellipse')+divider+`<button type="button" class="draw-quick-choice" data-draw-choice="shapeFill" data-value="toggle" aria-pressed="${Boolean(s.shapeFill)}" title="Fill the shape instead of outlining it">${icon('paint-bucket')}Fill</button>`+colors()+divider+slider('size','Size')+slider('opacity','Opacity');
  else body+=`<button type="button" class="draw-quick-choice" data-draw-action="flip-view" aria-pressed="${Boolean(drawing.state.view.flip)}" title="Mirror the view · M">Flip view</button><button type="button" class="draw-quick-choice" data-draw-action="reset-rotation" title="Reset view rotation">Reset rotation</button>`;
  const presets=tool==='brush'&&drawing.quickPresets?`<div class="draw-quick-presets">${presetGrid(drawing)}</div>`:'';
  return `<div class="draw-quick-row">${body}</div>${presets}`;
}
