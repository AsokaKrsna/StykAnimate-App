import {icon} from './icons.mjs';
import {drawingMetadata,isDrawingLayer} from './drawing-model.mjs';
import {DrawingStroke} from './drawing-pixels.mjs';
import {TileStore} from './drawing-tiles.mjs';
import {sliderMarkup} from './drawing-sliders.mjs';

export const DRAWING_TOOLS = [
  ['brush','Brush','brush','Paint · B'], ['eraser','Eraser','eraser','Erase · E'],
  ['fill','Fill','paint-bucket','Fill · G'],
  ['lasso','Lasso','lasso','Select pixels · L'], ['shape','Shape','square','Line, rectangle and ellipse · U'],
  ['gradient','Gradient','sliders','Gradient · Shift+G'], ['transform','Transform','transform','Transform drawing · V'],
];
// Every preset defines the whole tip and its blend so switching presets is
// deterministic; alpha lock is a painting mode and persists.
const TIP={pressureFlow:false,roundness:1,angle:0,angleMode:'fixed',scatter:0,blend:'normal',smudgeLength:.8,colorRate:0,stabilization:0};
export const BRUSH_PRESETS = [
  {id:'ink',name:'Ink',description:'Crisp, pressure-sensitive lines',...TIP,size:8,hardness:1,flow:1,opacity:1,pressureSize:true,pressureOpacity:false,spacingRatio:.08,texture:0},
  {id:'pencil',name:'Pencil',description:'Fine lines for rough animation',...TIP,size:2,hardness:.85,flow:.7,opacity:1,pressureSize:true,pressureOpacity:true,spacingRatio:.05,texture:.6},
  {id:'soft',name:'Soft',description:'Soft edges for shading',...TIP,size:32,hardness:0,flow:.25,opacity:1,pressureSize:true,pressureOpacity:false,spacingRatio:.1,texture:0},
  {id:'marker',name:'Marker',description:'Even translucent strokes',...TIP,size:24,hardness:.95,flow:1,opacity:.35,pressureSize:false,pressureOpacity:false,spacingRatio:.12,texture:0},
  {id:'calligraphy',name:'Nib',description:'Flat calligraphy nib: thick and thin by stroke direction',...TIP,size:16,hardness:1,flow:1,opacity:1,pressureSize:true,pressureOpacity:false,spacingRatio:.03,texture:0,roundness:.2,angle:40},
  {id:'airbrush',name:'Airbrush',description:'Builds up soft paint with pen pressure',...TIP,size:72,hardness:0,flow:.06,opacity:1,pressureSize:false,pressureOpacity:false,pressureFlow:true,spacingRatio:.05,texture:0},
  {id:'charcoal',name:'Charcoal',description:'Grainy, scattered texture that follows the stroke',...TIP,size:20,hardness:.7,flow:.55,opacity:.9,pressureSize:true,pressureOpacity:true,spacingRatio:.06,texture:.85,scatter:.08,roundness:.6,angleMode:'direction'},
  {id:'liner',name:'Liner',description:'Smooth, stabilized clean-up lines',...TIP,size:5,hardness:1,flow:1,opacity:1,pressureSize:true,pressureOpacity:false,spacingRatio:.05,texture:0,stabilization:.45},
  {id:'blender',name:'Blender',description:'Smudges and blends existing paint',...TIP,blend:'smudge',size:36,hardness:.4,flow:1,opacity:.8,pressureSize:true,pressureOpacity:true,spacingRatio:.06,texture:0,smudgeLength:.85,colorRate:0},
  {id:'oil',name:'Oil',description:'Mixes the brush colour into wet paint',...TIP,blend:'smudge',size:28,hardness:.75,flow:1,opacity:1,pressureSize:true,pressureOpacity:false,spacingRatio:.05,texture:.2,smudgeLength:.6,colorRate:.35},
];
export const BRUSH_BLEND_LABELS=[['normal','Normal'],['behind','Behind'],['multiply','Multiply'],['screen','Screen'],['overlay','Overlay'],['color','Color'],['smudge','Smudge']];
const SELECT_SHAPES=[['lasso','Lasso'],['rect','Rectangle'],['ellipse','Ellipse'],['wand','Magic wand']];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

/** A small stroke drawn by the real brush engine, cached per preset tip. Smudge
 * presets drag two colour bands so the thumbnail shows what they do. */
const thumbnails=new Map();
export function presetThumbnail(p){
  if(typeof document==='undefined')return '';
  const key=p.id+':'+JSON.stringify([p.size,p.hardness,p.flow,p.opacity,p.texture,p.roundness,p.angle,p.angleMode,p.scatter,p.blend,p.smudgeLength,p.colorRate,p.spacingRatio,p.pressureSize,p.pressureOpacity,p.pressureFlow,p.stabilization]);
  const hit=thumbnails.get(key);if(hit)return hit;
  const W=120,H=36,store=new TileStore(),size=Math.max(2.5,Math.min(10,p.size*.5))*2;
  if(p.blend==='smudge'){const band=new Uint8ClampedArray(W*H*4);for(let y=6;y<H-6;y++)for(let x=0;x<W;x++)band.set(x<W/2?[222,78,78,255]:[64,96,208,255],(y*W+x)*4);store.writeRect(0,0,W,H,band);}
  try{
    const stroke=new DrawingStroke(store,{...p,size,color:[42,42,48],seed:11,pixelsPerUnit:size/Math.max(.5,p.size)});
    for(let i=0;i<=28;i++){const t=i/28;stroke.sample({x:10+t*(W-20),y:H/2+Math.sin(t*Math.PI*2)*H*.2,pressure:.25+.75*Math.sin(Math.PI*t),time:i*16});}
    stroke.finish();
    const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;canvas.getContext('2d').putImageData(new ImageData(store.readRect(0,0,W,H),W,H),0,0);
    const url=canvas.toDataURL('image/png');canvas.width=canvas.height=1;
    if(thumbnails.size>=96)thumbnails.delete(thumbnails.keys().next().value);thumbnails.set(key,url);return url;
  }catch{return '';}
}
const presetButton=(p,s)=>`<button class="drawing-preset" data-draw-preset="${escape(p.id)}" aria-pressed="${s.preset===p.id}" title="${escape(p.description)}"><img class="drawing-preset-thumb" src="${presetThumbnail(p)}" alt=""><span>${escape(p.name)}</span></button>`;
export const presetGrid=(drawing)=>{const s=drawing.settings,custom=drawing.library?.presets??[];return `<div class="drawing-presets" role="group" aria-label="Brush presets">${[...BRUSH_PRESETS,...custom].map(p=>presetButton(p,s)).join('')}</div>`;};
/** Main and second colour as an overlapping pair (X swaps), with the hex. */
export const colorPair=(s,{hex=true}={})=>`<div class="draw-colors"><div class="draw-color-pair"><input type="color" class="draw-color-primary" data-draw-setting="color" value="${s.color}" aria-label="Drawing color" title="Main color · Alt-click the canvas to pick"><input type="color" class="draw-color-secondary" data-draw-setting="color2" value="${s.color2??'#ffffff'}" aria-label="Second color" title="Second color"></div><button class="icon-button draw-color-swap" data-draw-action="swap-colors" title="Swap colors · X" aria-label="Swap colors">${icon('loop')}</button>${hex?`<span class="hex-label">${s.color.toUpperCase()}</span>`:''}</div>`;

/** Tool properties use the shared inspector sections; timing stays in the timeline. */
export function drawingInspector(drawing,{numericField,group,grid,heading,propertyToggle},poseView='') {
  const {editor,settings:s,tool}=drawing;
  const field=(label,key,value,unit='',limits='')=>numericField(label,'draw:'+key,value,unit,limits,{}, {legacyField:false});
  const sliders=(...keys)=>`<div class="draw-sliders">${keys.map(key=>sliderMarkup(key,s[key])).join('')}</div>`;
  const button=(action,label,symbol='plus',disabled=false,title='')=>`<button class="button" data-draw-action="${action}" ${disabled?'disabled':''} title="${title}">${icon(symbol)}<span>${label}</span></button>`;
  const iconButton=(action,symbol,title,disabled=false)=>`<button class="icon-button" data-draw-action="${action}" title="${title}" aria-label="${title}" ${disabled?'disabled':''}>${icon(symbol)}</button>`;
  const toggle=(key,label,symbol,title=label)=>propertyToggle('draw-'+key,label,Boolean(s[key]),symbol,{title,attrs:`data-draw-setting="${key}"`});
  const select=(key,label,options)=>`<label class="drawing-resolution">${label}<select class="inline-select" data-draw-setting="${key}" data-draw-text aria-label="${label}">${options.map(([value,text])=>`<option value="${value}" ${s[key]===value?'selected':''}>${text}</option>`).join('')}</select></label>`;
  const details=(label,body)=>`<details class="inspector-section inspector-disclosure" data-section="${label}"><summary class="inspector-title">${label}</summary><div class="inspector-disclosure-body">${body}</div></details>`;
  const recent=drawing.library?.recent??[];
  const swatches=recent.length?`<div class="drawing-swatches" role="group" aria-label="Recent colors">${recent.map(c=>`<button class="drawing-swatch" data-draw-color="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="Use ${c.toUpperCase()}" aria-pressed="${c===s.color.toLowerCase()}"></button>`).join('')}</div>`:'';
  const color=colorPair(s)+swatches;
  const preview=`<canvas class="drawing-preview" data-inspector-owned data-section="brush-preview" data-brush-preview aria-label="Brush stroke preview"></canvas>`;
  let target;try{target=editor.drawingTarget();}catch{}
  const layer=editor.getLayer(editor.activeLayerId),eligible=isDrawingLayer(layer)&&!layer.locked&&layer.visible;
  let html=heading(DRAWING_TOOLS.find(t=>t[0]===tool)?.[1]??'Hand',DRAWING_TOOLS.find(t=>t[0]===tool)?.[2]??'hand');
  if(!eligible)html+=group('',`<div class="drawing-empty">${isDrawingLayer(layer)?'Show and unlock this drawing layer.':'Select a drawing layer to paint.'}</div><div class="property-context-actions">${button('new','New drawing layer','brush')}</div>`);
  if(tool==='brush'||tool==='eraser') {
    const custom=drawing.library?.presets??[],isCustom=custom.some(p=>p.id===s.preset);
    if(tool==='brush')html+=group('Preset',presetGrid(drawing)+`<div class="property-context-actions">${button('save-preset','Save brush','plus')}${isCustom?button('delete-preset','Delete brush','trash'):''}</div>`);
    html+=group('',preview+(tool==='brush'?color:'')+sliders('size','opacity','flow','hardness','stabilization'));
    if(tool==='brush')html+=group('Painting',select('blend','Blend',BRUSH_BLEND_LABELS)+(s.blend==='smudge'?sliders('smudgeLength','colorRate'):'')+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('alphaLock','Lock alpha','lock')}</div>`);
    html+=details('Tip',sliders('roundness','angle','spacingRatio','scatter','texture')+select('angleMode','Tip follows',[['fixed','Fixed angle'],['direction','Stroke direction'],['tilt','Pen tilt']]));
    html+=details('Dynamics',`<div class="property-toggle-grid drawing-toggle-grid">${toggle('pressureSize','Size pressure','scale')}${toggle('pressureOpacity','Opacity pressure','circle')}${toggle('pressureFlow','Flow pressure','activity')}</div>`+sliders('sizeCurve','opacityCurve'));
    html+=group('Assist',`<div class="property-toggle-grid drawing-toggle-grid">${toggle('mirrorX','Mirror X','flip','Mirror painting across the vertical centre · Shift+M')}${toggle('mirrorY','Mirror Y','flip','Mirror painting across the horizontal centre')}</div><div class="drawing-hint">Shift-click: straight line · ${tool==='brush'?'Alt-click: pick colour · ':''}Ctrl-drag: size · [ ]: size · 1–0: opacity</div>`);
  }
  if(tool==='fill')html+=group('Fill',color+sliders('tolerance','expansion','gap')+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('sampleAll','Sample all layers','layers')}</div><div class="drawing-hint">Alt-click picks a colour. Fills stay inside the selection.</div>`);
  if(tool==='shape')html+=group('Shape',select('shapeKind','Shape',[['line','Line'],['rect','Rectangle'],['ellipse','Ellipse']])+color+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('shapeFill','Fill shape','paint-bucket')}</div>`+sliders('size','opacity')+`<div class="drawing-hint">Outlines use the current brush. Shift constrains to 45°, squares and circles.</div>`);
  if(tool==='gradient')html+=group('Gradient',select('gradientType','Type',[['linear','Linear'],['radial','Radial']])+select('gradientEnd','Ends',[['transparent','Color to transparent'],['color','Color to second color']])+color+sliders('opacity')+`<div class="drawing-hint">Drag across the canvas. The gradient stays inside the selection.</div>`);
  if(tool==='lasso'){
    html+=group('Select',select('selectShape','Shape',SELECT_SHAPES)+(s.selectShape==='wand'?sliders('tolerance','gap')+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('sampleAll','Sample all layers','layers')}</div>`:'')+`<div class="drawing-hint">Shift adds to the selection, Alt subtracts. Drag inside it to move pixels, a corner to scale or the top handle to rotate (Shift snaps to 15°).</div>`);
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

/** The pop-up palette (right-click): presets, recent colours, the colour pair
 * and the two sliders painters reach for most. */
export function paletteMarkup(drawing){
  const s=drawing.settings,recent=drawing.library?.recent??[];
  const swatches=recent.length?`<div class="drawing-swatches" role="group" aria-label="Recent colors">${recent.map(c=>`<button class="drawing-swatch" data-draw-color="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="Use ${c.toUpperCase()}" aria-pressed="${c===s.color.toLowerCase()}"></button>`).join('')}</div>`:'';
  return `${colorPair(s)}${swatches}${drawing.tool==='brush'||drawing.tool==='eraser'?presetGrid(drawing):''}<div class="draw-sliders">${sliderMarkup('size',s.size)}${sliderMarkup('opacity',s.opacity)}</div>`;
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
  let body='';
  if(tool==='brush'||tool==='eraser'){
    const preset=[...BRUSH_PRESETS,...(drawing.library?.presets??[])].find(p=>p.id===s.preset);
    if(tool==='brush')body+=`<button type="button" class="draw-quick-preset" data-draw-action="toggle-quick-presets" aria-expanded="${Boolean(drawing.quickPresets)}" title="Brush presets">${preset?`<img src="${presetThumbnail(preset)}" alt="">`:icon('brush')}<span>${escape(preset?.name??'Custom')}</span></button>`+colorPair(s,{hex:false})+divider;
    body+=slider('size','Size')+slider('opacity','Opacity')+slider('flow','Flow')+slider('stabilization','Smooth')+divider+toggleButton('mirrorX','flip','Mirror painting · Shift+M');
  }else if(tool==='fill')body+=colorPair(s,{hex:false})+divider+slider('tolerance','Tolerance')+slider('gap','Gaps')+slider('expansion','Expand');
  else if(tool==='lasso')body+=choice('selectShape','lasso','Lasso')+choice('selectShape','rect','Rectangle')+choice('selectShape','ellipse','Ellipse')+choice('selectShape','wand','Wand')+(s.selectShape==='wand'?divider+slider('tolerance','Tolerance'):'');
  else if(tool==='shape')body+=choice('shapeKind','line','Line')+choice('shapeKind','rect','Rectangle')+choice('shapeKind','ellipse','Ellipse')+divider+toggleButton('shapeFill','paint-bucket','Fill shape')+colorPair(s,{hex:false})+divider+slider('size','Size')+slider('opacity','Opacity');
  else if(tool==='gradient')body+=choice('gradientType','linear','Linear')+choice('gradientType','radial','Radial')+divider+choice('gradientEnd','transparent','To transparent')+choice('gradientEnd','color','To second color')+colorPair(s,{hex:false})+divider+slider('opacity','Opacity');
  else body+=`<button type="button" class="draw-quick-choice" data-draw-action="flip-view" aria-pressed="${Boolean(drawing.state.view.flip)}" title="Mirror the view · M">Flip view</button><button type="button" class="draw-quick-choice" data-draw-action="reset-rotation" title="Reset view rotation">Reset rotation</button>`;
  const presets=tool==='brush'&&drawing.quickPresets?`<div class="draw-quick-presets">${presetGrid(drawing)}</div>`:'';
  return `<div class="draw-quick-row">${body}</div>${presets}`;
}
