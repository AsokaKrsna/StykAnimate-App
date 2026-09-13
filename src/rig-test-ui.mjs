import {Editor} from './editor.mjs';
import {nativeFigureDocument} from './native-figure.mjs';
import {buildGeometry, drawGeometry, releaseGeometryResources} from './pivot/geometry.mjs';
import {RIG_EXAMPLES, rigExampleDocument} from './rig-examples.mjs';
import {icon} from './icons.mjs';
import {objectBounds} from './renderer-geometry.mjs';
let disposeTest;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** A bounded, detached editor exercises the real commands/evaluator. Neither
 * construction definitions, authored sources nor undo in the live editor change. */
export function openRigTest(host,document,{back,galleryPreview=false}={}) {
  disposeTest?.();host.finish?.();
  const source=document??nativeFigureDocument(host.editor.report,{figureUid:host.editor.selectedUid,tick:host.editor.tick,sourceFrame:host.editor.selectionFrame});
  const initial=structuredClone(source),test=new Editor({demo:false});test.load(initial);
  const figure=test.report.figure_types[0],object=test.frame.objects[0],
    selected=host.editor.figure?.segments[host.editor.selectedJoint]?.segment_id,
    control=(galleryPreview?figure._styk?.rigExample?.control:figure.segments.find(s=>s.segment_id===selected)?.segment_id)??figure.segments.find(s=>s.aux_code!==1)?.segment_id??figure.segments[0].segment_id;
  const example=galleryPreview&&RIG_EXAMPLES.some(r=>r.id===figure._styk?.rigExample?.id);
  test.select(object.unique_id,figure.segments.findIndex(s=>s.segment_id===control));
  host.showDialog(figure.name,`<canvas id="rig-test-canvas" class="rig-test-canvas" aria-label="Interactive rig test canvas" title="Drag to rotate. Ctrl-drag a control to stretch."></canvas>
    <div class="rig-test-toolbar"><label class="rig-select rig-test-joints">Joint<select id="rig-test-joint" class="inline-select" aria-label="Test joint">${figure.segments.filter(s=>s.aux_code!==1||s.segment_id===control).map(s=>`<option value="${s.segment_id}">${esc(s.name||`Joint ${s.segment_id}`)}</option>`).join('')}</select></label>
    <label class="field"><span id="rig-test-value-label">Length</span><input id="rig-test-value" type="number" step="any" aria-label="Test control value"></label>
    <label class="field"><span>Angle</span><input id="rig-test-angle" type="number" step="1" aria-label="Test control angle"><small>°</small></label>
    </div><div class="rig-test-utilities"><button class="button" id="rig-test-fit">${icon('fit')}Fit</button><button class="button" id="rig-test-reset">${icon('reset')}Reset</button></div>
    <p id="rig-test-status" class="property-note" role="status" hidden></p>
    <div class="dialog-actions">${back?'<button class="button" id="rig-test-back">Back</button>':`<button class="button" data-action="close-dialog">${host.builderActive?.()?'Return to builder':'Close'}</button>`}${example?'<button class="button primary" id="rig-test-add">Add to Animate</button>':''}</div>`);
  const canvas=window.document.getElementById('rig-test-canvas'),dialog=canvas.closest('dialog'),ctx=canvas.getContext('2d'),events=new AbortController(),on={signal:events.signal};
  const jointInput=window.document.getElementById('rig-test-joint'),valueInput=window.document.getElementById('rig-test-value'),angleInput=window.document.getElementById('rig-test-angle'),label=window.document.getElementById('rig-test-value-label'),status=window.document.getElementById('rig-test-status');
  let drag=false,view={scale:1,x:0,y:0}, scheduled=0,disposed=false;
  const error=e=>{status.hidden=false;status.textContent=e.message;};
  window.document.getElementById('rig-test-back')?.addEventListener('click',back,on);
  const guarded=fn=>e=>{try{status.hidden=true;status.textContent='';fn(e);}catch(err){error(err);}};
  function fit(){const g=test.geometry.objects.get(0),p=[...g.joints.values()],xs=p.map(p=>p.x),ys=p.map(p=>p.y),minX=Math.min(...xs)-45,maxX=Math.max(...xs)+45,minY=Math.min(...ys)-45,maxY=Math.max(...ys)+45;
    const scale=Math.min(canvas.clientWidth/Math.max(120,maxX-minX),canvas.clientHeight/Math.max(120,maxY-minY),2);
    view={scale,x:canvas.clientWidth/2-(minX+maxX)/2*scale,y:canvas.clientHeight/2-(minY+maxY)/2*scale};}
  function render(){scheduled=0;if(disposed)return;const d=window.devicePixelRatio||1,w=Math.round(canvas.clientWidth*d),h=Math.round(canvas.clientHeight*d);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
    ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);ctx.translate(view.x,view.y);ctx.scale(view.scale,view.scale);
    const g=test.geometry;drawGeometry(ctx,g,host.resources??{});const selected=test.figure.segments[test.selectedJoint];
    for(const s of g.objects.get(0).segments){if(s.seg.aux_code===1&&s.seg.segment_id!==selected.segment_id)continue;const p=s.handle??s.end;ctx.fillStyle=s.seg.segment_id===selected.segment_id?'#0d99ff':'#666';ctx.beginPath();ctx.arc(p.x,p.y,(s.seg.segment_id===selected.segment_id?6:4)/view.scale,0,Math.PI*2);ctx.fill();}
    jointInput.value=selected.segment_id;const o=test.object,v=o.len_flag?o.lengths[test.selectedJoint]:selected.length,c=selected._stykRig?.connector;
    valueInput.value=Math.round(v*(c?100:1)*1000)/1000;valueInput.min=0;valueInput.max=c?100:1e6;label.textContent=c?'Slide %':'Length';
    angleInput.disabled=Boolean(c||selected._stykRig?.angleLock);angleInput.value=Math.round((angleInput.disabled?g.objects.get(0).segments[test.selectedJoint].angle:o.angles[test.selectedJoint])*180/Math.PI*100)/100;
  }
  const schedule=()=>{if(!scheduled)scheduled=requestAnimationFrame(render);};
  const point=e=>{const b=canvas.getBoundingClientRect();return {x:(e.clientX-b.left-view.x)/view.scale,y:(e.clientY-b.top-view.y)/view.scale};};
  canvas.addEventListener('pointerdown',guarded(e=>{if(e.button!==0)return;const p=point(e),g=test.geometry.objects.get(0);let best=14/view.scale,id;
    for(const s of g.segments){if(s.seg.aux_code===1)continue;const q=s.handle??s.end,dist=Math.hypot(p.x-q.x,p.y-q.y);if(dist<best){best=dist;id=s.seg.segment_id;}}
    if(id===undefined)return;test.select(object.unique_id,figure.segments.findIndex(s=>s.segment_id===id));test.beginDrag('Test pose');drag=true;canvas.setPointerCapture(e.pointerId);schedule();}),on);
  canvas.addEventListener('pointermove',guarded(e=>{if(!drag)return;const p=point(e);test.poseJoint(p.x,p.y,{stretch:e.ctrlKey||e.metaKey,snap:false});schedule();}),on);
  canvas.addEventListener('pointerup',guarded(()=>{if(drag){test.commitDrag();drag=false;schedule();}}),on);
  canvas.addEventListener('pointercancel',()=>{if(drag){test.cancelDrag();drag=false;schedule();}},on);
  jointInput?.addEventListener('change',guarded(()=>{const index=figure.segments.findIndex(s=>s.segment_id===Number(jointInput.value));if(index<0)throw new Error('Choose an existing joint.');test.select(object.unique_id,index);schedule();}),on);
  valueInput?.addEventListener('change',guarded(()=>{const s=test.figure.segments[test.selectedJoint];if(s._stykRig?.connector)test.setConnectorPosition(valueInput.valueAsNumber/100);else test.updateSegment({length:valueInput.valueAsNumber});fit();schedule();}),on);
  angleInput?.addEventListener('change',guarded(()=>{test.updateSegment({angle_rad:angleInput.valueAsNumber*Math.PI/180});fit();schedule();}),on);
  window.document.getElementById('rig-test-fit').addEventListener('click',()=>{fit();schedule();},on);
  window.document.getElementById('rig-test-reset').addEventListener('click',()=>{test.load(structuredClone(source));test.select(object.unique_id,figure.segments.findIndex(s=>s.segment_id===control));drag=false;fit();schedule();},on);
  window.document.getElementById('rig-test-add')?.addEventListener('click',guarded(()=>{
    test.commitDrag();
    host.addToAnimate(nativeFigureDocument(test.report,{figureUid:object.unique_id,tick:test.tick,sourceFrame:test.selectionFrame}));
    host.closeDialog();
  }),on);
  const resize=new ResizeObserver(()=>{fit();schedule();});resize.observe(canvas);
  const observer=new MutationObserver(()=>{if(!canvas.isConnected)dispose();});observer.observe(dialog,{childList:true,subtree:true});
  function dispose(){if(disposed)return;disposed=true;events.abort();resize.disconnect();observer.disconnect();cancelAnimationFrame(scheduled);releaseGeometryResources(ctx);test._undo.length=0;test._redo.length=0;if(disposeTest===dispose)disposeTest=null;}
  disposeTest=dispose;dialog.addEventListener('close',dispose,on);fit();render();
  return {editor:test,dispose};
}
export function openRigExamples(host) {
  disposeTest?.();host.finish?.();host.showDialog('Rig examples',`<p id="rig-example-status" class="property-note" role="status" hidden></p><div class="rig-example-list">${RIG_EXAMPLES.map(r=>`<article class="rig-example-item"><button class="rig-example-preview" data-rig-preview="${r.id}" aria-label="Try ${esc(r.name)}"><canvas width="400" height="280" data-rig-thumbnail="${r.id}"></canvas></button><div class="rig-example-actions"><strong>${esc(r.name)}</strong><button class="button" data-rig-insert="${r.id}" aria-label="Add ${esc(r.name)} to Animate">${icon('plus')}Add</button></div></article>`).join('')}</div>`);
  const root=window.document.getElementById('dialog-content'),dialog=root.closest('dialog'),events=new AbortController(),on={signal:events.signal},queue=[];
  let scheduled=0,disposed=false;
  function paint(){scheduled=0;if(disposed)return;const canvas=queue.shift();if(!canvas)return;
    const report=rigExampleDocument(canvas.dataset.rigThumbnail),geometry=buildGeometry(report,report.keyframes[0]),ctx=canvas.getContext('2d'),bounds=objectBounds(geometry.drawables,host.resources??{}),scale=Math.min(canvas.width/(bounds.width+36),canvas.height/(bounds.height+36));
    ctx.translate(canvas.width/2-(bounds.x+bounds.width/2)*scale,canvas.height/2-(bounds.y+bounds.height/2)*scale);ctx.scale(scale,scale);drawGeometry(ctx,geometry,host.resources??{});releaseGeometryResources(ctx);canvas.dataset.ready='true';
    if(queue.length)scheduled=requestAnimationFrame(paint);
  }
  const visible=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){visible.unobserve(e.target);queue.push(e.target);}if(queue.length&&!scheduled)scheduled=requestAnimationFrame(paint);});
  root.querySelectorAll('[data-rig-thumbnail]').forEach(canvas=>visible.observe(canvas));
  root.addEventListener('click',e=>{
    const preview=e.target.closest('[data-rig-preview]'),insert=e.target.closest('[data-rig-insert]');
    if(preview)openRigTest(host,rigExampleDocument(preview.dataset.rigPreview),{back:()=>openRigExamples(host),galleryPreview:true});
    if(insert){try{host.addToAnimate(rigExampleDocument(insert.dataset.rigInsert));host.closeDialog();}catch(error){const status=root.querySelector('#rig-example-status');status.hidden=false;status.textContent=error.message;}}
  },on);
  const observer=new MutationObserver(()=>{if(!root.querySelector('.rig-example-list'))dispose();});observer.observe(root,{childList:true});
  function dispose(){if(disposed)return;disposed=true;events.abort();visible.disconnect();observer.disconnect();cancelAnimationFrame(scheduled);queue.length=0;if(disposeTest===dispose)disposeTest=null;}
  disposeTest=dispose;dialog.addEventListener('close',dispose,on);
}
