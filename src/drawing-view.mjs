import {icon} from './icons.mjs';
import {drawingMetadata,isDrawingLayer} from './drawing-model.mjs';

export const DRAWING_TOOLS = [
  ['brush','Brush','brush','Paint · B'], ['eraser','Eraser','eraser','Erase · E'],
  ['fill','Fill','paint-bucket','Fill · G'],
  ['lasso','Lasso','lasso','Select pixels · L'], ['transform','Transform','transform','Transform drawing · V'],
];
export const BRUSH_PRESETS = [
  {id:'ink',name:'Ink',description:'Crisp, pressure-sensitive lines',size:8,hardness:1,flow:1,opacity:1,pressureSize:true,pressureOpacity:false,spacingRatio:.08,texture:0},
  {id:'pencil',name:'Pencil',description:'Fine lines for rough animation',size:2,hardness:.85,flow:.7,opacity:1,pressureSize:true,pressureOpacity:true,spacingRatio:.05,texture:.6},
  {id:'soft',name:'Soft',description:'Soft edges for shading',size:32,hardness:0,flow:.25,opacity:1,pressureSize:true,pressureOpacity:false,spacingRatio:.1,texture:0},
  {id:'marker',name:'Marker',description:'Even translucent strokes',size:24,hardness:.95,flow:1,opacity:.35,pressureSize:false,pressureOpacity:false,spacingRatio:.12,texture:0},
];

/** Tool properties use the shared inspector fields; timing stays in the timeline. */
export function drawingInspector(drawing,{numericField,group,grid,heading,propertyToggle},poseView='') {
  const {editor,settings:s,tool}=drawing;
  const field=(label,key,value,unit='',limits='')=>numericField(label,'draw:'+key,value,unit,limits,{}, {legacyField:false});
  const button=(action,label,symbol='plus',disabled=false,title='')=>`<button class="button" data-draw-action="${action}" ${disabled?'disabled':''} title="${title}">${icon(symbol)}<span>${label}</span></button>`;
  const iconButton=(action,symbol,title,disabled=false)=>`<button class="icon-button" data-draw-action="${action}" title="${title}" aria-label="${title}" ${disabled?'disabled':''}>${icon(symbol)}</button>`;
  const toggle=(key,label,symbol)=>propertyToggle('draw-'+key,label,Boolean(s[key]),symbol,{attrs:`data-draw-setting="${key}"`});
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
    html+=details('Dynamics',grid(field('Flow','flow',s.flow*100,'%','min="0" max="100"'))+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('pressureSize','Size pressure','scale')}${toggle('pressureOpacity','Opacity pressure','circle')}</div>`+grid(field('Size curve','sizeCurve',s.sizeCurve,'','min="0.1" max="4"')+field('Opacity curve','opacityCurve',s.opacityCurve,'','min="0.1" max="4"')));
  }
  if(tool==='fill')html+=group('Fill',color+grid(field('Tolerance','tolerance',s.tolerance,'','min="0" max="255"')+field('Expand','expansion',s.expansion,'px','min="0" max="16"')+field('Close gaps','gap',s.gap,'px','min="0" max="8"'))+`<div class="property-toggle-grid drawing-toggle-grid">${toggle('sampleAll','Sample all layers','layers')}</div>`);
  if(tool==='lasso')html+=drawing.selection
    ?group('Selection',grid(field('Scale','selectionScale',drawing.selection.scale*100,'%','min="1" max="1000"')+field('Angle','selectionAngle',drawing.selection.angle,'°'))+`<div class="property-context-actions">${button('apply-selection','Apply','check')}${button('cancel-selection','Deselect','close')}${iconButton('copy-pixels','duplicate','Copy selected pixels · Ctrl+C')}${iconButton('cut-pixels','cut','Cut selected pixels · Ctrl+X')}${iconButton('delete-pixels','trash','Delete selected pixels · Delete')}</div>`)
    :group('Selection','<div class="drawing-empty">Drag on the canvas to select pixels.</div>');
  if(tool==='transform')html+=`<div class="drawing-pose">${poseView}</div>`;
  if(tool==='pan')html+=group('View',grid(field('Rotation','viewAngle',(drawing.state.view.rotation??0)*180/Math.PI,'°','min="-180" max="180"'))+`<div class="property-context-actions">${button('reset-rotation','Reset rotation','rotate')}</div>`);
  const filter=`<label class="drawing-resolution">Pixel filtering<select class="inline-select" data-draw-setting="filter" aria-label="Pixel filtering"><option value="smooth" ${s.filter!=='nearest'?'selected':''}>Smooth</option><option value="nearest" ${s.filter==='nearest'?'selected':''}>Nearest (pixel art)</option></select></label>`;
  const d=drawingMetadata(target?.figure),ratio=d?s.resolution/d.pixelsPerUnit:1,canResample=Boolean(d);
  html+=details('Resolution',`${filter}<label class="drawing-resolution">New drawings<select class="inline-select" data-draw-setting="resolution" aria-label="New drawing resolution">${[1,2,4].map(n=>`<option value="${n}" ${s.resolution===n?'selected':''}>${n}×</option>`).join('')}</select></label>${d?`<div class="drawing-resolution-info">Current: ${d.pixelsPerUnit}×</div>`:''}<div class="property-context-actions">${button('resample','Resample drawing','transform',!canResample||ratio===1,'Resize pixels to the selected resolution. Upscaling cannot recover missing detail.')}</div>`);
  return html;
}
