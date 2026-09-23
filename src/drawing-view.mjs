import {icon} from './icons.mjs';
import {drawingMetadata,isDrawingLayer} from './drawing-model.mjs';

export const DRAWING_TOOLS = [
  ['brush','Brush','brush','Paint · B'], ['eraser','Eraser','eraser','Erase · E'],
  ['fill','Fill','paint-bucket','Fill · G'],
  ['lasso','Lasso','lasso','Select pixels · L'], ['shape','Shape','square','Line, rectangle and ellipse · U'],
  ['gradient','Gradient','sliders','Gradient · Shift+G'], ['transform','Transform','transform','Transform drawing · V'],
];
// Every preset defines the whole tip and its blend so switching presets is
// deterministic; alpha lock is a painting mode and persists.
const TIP={pressureFlow:false,roundness:1,angle:0,angleMode:'fixed',scatter:0,blend:'normal',smudgeLength:.8,colorRate:0};
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

/** Tool properties use the shared inspector fields; timing stays in the timeline. */
export function drawingInspector(drawing,{numericField,group,grid,heading,propertyToggle},poseView='') {
  const {editor,settings:s,tool}=drawing;
  const field=(label,key,value,unit='',limits='')=>numericField(label,'draw:'+key,value,unit,limits,{}, {legacyField:false});
  const button=(action,label,symbol='plus',disabled=false,title='')=>`<button class="button" data-draw-action="${action}" ${disabled?'disabled':''} title="${title}">${icon(symbol)}<span>${label}</span></button>`;
  const iconButton=(action,symbol,title,disabled=false)=>`<button class="icon-button" data-draw-action="${action}" title="${title}" aria-label="${title}" ${disabled?'disabled':''}>${icon(symbol)}</button>`;
  const toggle=(key,label,symbol)=>propertyToggle('draw-'+key,label,Boolean(s[key]),symbol,{attrs:`data-draw-setting="${key}"`});
  const select=(key,label,options)=>`<label class="drawing-resolution">${label}<select class="inline-select" data-draw-setting="${key}" data-draw-text aria-label="${label}">${options.map(([value,text])=>`<option value="${value}" ${s[key]===value?'selected':''}>${text}</option>`).join('')}</select></label>`;
  const details=(label,body)=>`<details class="inspector-section inspector-disclosure" data-section="${label}"><summary class="inspector-title">${label}</summary><div class="inspector-disclosure-body">${body}</div></details>`;
  const color=`<div class="color-row"><input type="color" data-draw-setting="color" value="${s.color}" aria-label="Drawing color"><span class="hex-label">${s.color.toUpperCase()}</span></div>`;
  const preview=`<canvas class="drawing-preview" data-inspector-owned data-section="brush-preview" data-brush-preview aria-label="Brush stroke preview"></canvas>`;
  let target;try{target=editor.drawingTarget();}catch{}
  const layer=editor.getLayer(editor.activeLayerId),eligible=isDrawingLayer(layer)&&!layer.locked&&layer.visible;
  let html=heading(DRAWING_TOOLS.find(t=>t[0]===tool)?.[1]??'Hand',DRAWING_TOOLS.find(t=>t[0]===tool)?.[2]??'hand');
  if(!eligible)html+=group('',`<div class="drawing-empty">${isDrawingLayer(layer)?'Show and unlock this drawing layer.':'Select a drawing layer to paint.'}</div><div class="property-context-actions">${button('new','New drawing layer','brush')}</div>`);
  if(tool==='brush'||tool==='eraser') {
    if(tool==='brush')html+=group('Preset',`<div class="drawing-presets" role="group" aria-label="Brush presets">${BRUSH_PRESETS.map(p=>`<button class="drawing-preset" data-draw-preset="${p.id}" aria-pressed="${s.preset===p.id}" title="${p.description}">${p.name}</button>`).join('')}</div>`);
    html+=group('',preview+(tool==='brush'?color:'')+grid(field('Size','size',s.size,'px','min="0.5" max="2048"')+field('Opacity','opacity',s.opacity*100,'%','min="0" max="100"')+field('Hardness','hardness',s.hardness*100,'%','min="0" max="100"')+field('Smooth','stabilization',s.stabilization*100,'%','min="0" max="95"')));
    if(tool==='brush')html+=group('Painting',select('blend','Blend',BRUSH_BLEND_LABELS)+(s.blend==='smudge'?grid(field('Smudge length','smudgeLength',(s.smudgeLength??.8)*100,'%','min="0" max="100"')+field('Color mix','colorRate',(s.colorRate??0)*100,'%','min="0" max="100"')):'')+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('alphaLock','Lock alpha','lock')}</div>`);
    html+=details('Tip',grid(field('Roundness','roundness',(s.roundness??1)*100,'%','min="5" max="100"')+field('Angle','angle',s.angle??0,'°','min="0" max="360"')+field('Spacing','spacingRatio',(s.spacingRatio??.12)*100,'%','min="1" max="100"')+field('Scatter','scatter',(s.scatter??0)*100,'%','min="0" max="400"')+field('Grain','texture',(s.texture??0)*100,'%','min="0" max="100"'))+select('angleMode','Tip follows',[['fixed','Fixed angle'],['direction','Stroke direction'],['tilt','Pen tilt']]));
    html+=details('Dynamics',grid(field('Flow','flow',s.flow*100,'%','min="0" max="100"'))+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('pressureSize','Size pressure','scale')}${toggle('pressureOpacity','Opacity pressure','circle')}${toggle('pressureFlow','Flow pressure','activity')}</div>`+grid(field('Size curve','sizeCurve',s.sizeCurve,'','min="0.1" max="4"')+field('Opacity curve','opacityCurve',s.opacityCurve,'','min="0.1" max="4"')));
    html+=group('Assist',`<div class="property-toggle-grid drawing-toggle-grid">${toggle('mirrorX','Mirror horizontally','flip')}${toggle('mirrorY','Mirror vertically','flip')}</div><div class="drawing-hint">Shift-click draws a straight line from the last stroke. ${tool==='brush'?'Alt-click picks a colour. ':''}Ctrl-drag resizes the brush.</div>`);
  }
  if(tool==='fill')html+=group('Fill',color+`<div class="drawing-hint">Alt-click picks a colour. Fills stay inside the selection.</div>`+grid(field('Tolerance','tolerance',s.tolerance,'','min="0" max="255"')+field('Expand','expansion',s.expansion,'px','min="0" max="16"')+field('Close gaps','gap',s.gap,'px','min="0" max="8"'))+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('sampleAll','Sample all layers','layers')}</div>`);
  if(tool==='shape')html+=group('Shape',select('shapeKind','Shape',[['line','Line'],['rect','Rectangle'],['ellipse','Ellipse']])+color+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('shapeFill','Fill shape','paint-bucket')}</div>`+grid(field('Size','size',s.size,'px','min="0.5" max="2048"')+field('Opacity','opacity',s.opacity*100,'%','min="0" max="100"'))+`<div class="drawing-hint">Outlines use the current brush. Shift constrains to 45°, squares and circles.</div>`);
  if(tool==='gradient'){
    const second=`<div class="color-row"><input type="color" data-draw-setting="color2" value="${s.color2??'#ffffff'}" aria-label="Second gradient color"><span class="hex-label">${(s.color2??'#ffffff').toUpperCase()}</span></div>`;
    html+=group('Gradient',select('gradientType','Type',[['linear','Linear'],['radial','Radial']])+select('gradientEnd','Ends',[['transparent','Color to transparent'],['color','Color to second color']])+color+(s.gradientEnd==='color'?second:'')+grid(field('Opacity','opacity',s.opacity*100,'%','min="0" max="100"'))+`<div class="drawing-hint">Drag across the canvas. The gradient stays inside the selection.</div>`);
  }
  if(tool==='lasso'){
    html+=group('Select',select('selectShape','Shape',SELECT_SHAPES)+(s.selectShape==='wand'?grid(field('Tolerance','tolerance',s.tolerance,'','min="0" max="255"')+field('Close gaps','gap',s.gap,'px','min="0" max="8"'))+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('sampleAll','Sample all layers','layers')}</div>`:'')+`<div class="drawing-hint">Shift adds to the selection, Alt subtracts. Drag inside it to move pixels.</div>`);
    const selected=Boolean(drawing.selection||drawing.marquee),moved=Boolean(drawing.selection&&(drawing.selection.dx||drawing.selection.dy||drawing.selection.scale!==1||drawing.selection.angle));
    html+=selected
      ?group('Selection',grid(field('Scale','selectionScale',(drawing.selection?.scale??1)*100,'%','min="1" max="1000"')+field('Angle','selectionAngle',drawing.selection?.angle??0,'°'))+`<div class="property-context-actions">${moved?button('apply-selection','Apply','check'):''}${button('cancel-selection','Deselect','close')}${button('invert-selection','Invert','flip')}${button('fill-selection','Fill','paint-bucket')}${iconButton('copy-pixels','duplicate','Copy selected pixels · Ctrl+C')}${iconButton('cut-pixels','cut','Cut selected pixels · Ctrl+X')}${iconButton('delete-pixels','trash','Delete selected pixels · Delete')}</div>`)
      :group('Selection',`<div class="drawing-empty">Drag on the canvas to select pixels.</div><div class="property-context-actions">${button('select-all','Select all','square')}</div>`);
  }
  if(tool==='transform')html+=`<div class="drawing-pose">${poseView}</div>`;
  if(tool==='pan')html+=group('View',grid(field('Rotation','viewAngle',(drawing.state.view.rotation??0)*180/Math.PI,'°','min="-180" max="180"'))+`<div class="property-context-actions">${button('reset-rotation','Reset rotation','rotate')}<button class="button" data-draw-action="flip-view" aria-pressed="${Boolean(drawing.state.view.flip)}" title="Mirror the view to check proportions · M">${icon('flip')}<span>Flip view</span></button></div>`);
  const d=drawingMetadata(target?.figure),ratio=d?s.resolution/d.pixelsPerUnit:1,canResample=Boolean(d);
  html+=details('Resolution',`<label class="drawing-resolution">New drawings<select class="inline-select" data-draw-setting="resolution" aria-label="New drawing resolution">${[1,2,4].map(n=>`<option value="${n}" ${s.resolution===n?'selected':''}>${n}×</option>`).join('')}</select></label>${d?`<div class="drawing-resolution-info">Current: ${d.pixelsPerUnit}×</div>`:''}<div class="property-context-actions">${button('resample','Resample drawing','transform',!canResample||ratio===1,'Resize pixels to the selected resolution. Upscaling cannot recover missing detail.')}</div>`);
  return html;
}
