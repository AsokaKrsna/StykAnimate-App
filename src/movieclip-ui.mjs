import {drawingSetsView} from './movieclip-drawings.mjs';
import {drawingBarrier} from './drawing-resources.mjs';
import {playbackSettings,movieclipAsset,movieclipTime} from './movieclips.mjs';
import {icon} from './icons.mjs';

const inspectorStates=new WeakMap();
const number=value=>Number(Number(value).toFixed(3));
function inspectorState(editor){
  let state=inspectorStates.get(editor);
  if(!state||state.token!==editor._documentToken){state={token:editor._documentToken,nextKeys:1};inspectorStates.set(editor,state);}
  return state;
}
function nextKeys(editor){
  const track=editor.report._styk?.layerSheet?.tracks[editor.layerForUid(editor.selectedUid)];
  return track?track.keys.filter(key=>!key.patchOnly&&key.tick>editor.tick&&key.tick<track.end).length:editor.timeline.filter(row=>row.start>editor.tick&&row.count>0).length;
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function movieclipInspector(editor,field){
  const object=editor.object,figure=editor.figure,p=playbackSettings(object),asset=movieclipAsset(figure),state=inspectorState(editor),remaining=nextKeys(editor);
  const sample=editor.evaluatedFrame.objects.find(value=>value.unique_id===object.unique_id)?._movieclipSample??movieclipTime(asset,p,editor.tick,editor.report.fps);
  const current=sample===null?null:Math.min(asset.duration,Math.floor(sample)+1);
  const feedback=state.feedback, message=feedback?.uid===object.unique_id&&feedback.tick===editor.tick&&feedback.revision===editor.revision?feedback.message:'';
  const input=(name,label,value,min,max,unit='',disabled=false)=>`<label class="movieclip-control"><span>${label}</span><div class="field"><input type="number" data-movieclip-field="${name}" aria-label="Movieclip ${label.toLowerCase()}" value="${esc(value)}" min="${min}" max="${max}" step="any" required ${disabled?'disabled':''}>${unit?`<small>${unit}</small>`:''}</div></label>`;
  return `<div class="movieclip-inspector">${drawingSetsView(figure,object)}<section class="inspector-section movieclip-header"><div class="object-heading"><span>${icon('frame')}</span><input class="figure-name" data-movieclip-name aria-label="Movieclip name" value="${esc(figure.name)}" maxlength="120"></div><div class="movieclip-actions"><button class="button primary" data-action="movieclip-edit">${icon('nodes')}Edit movieclip</button><button class="button" data-action="movieclip-unique">Make unique</button></div></section>
    <section class="inspector-section movieclip-playback"><div class="movieclip-position"><div><span>Viewing frame</span><output data-movieclip-current-frame aria-label="Current movieclip frame">${current??'—'} <small>/ ${asset.duration}</small></output></div><span class="movieclip-scene-frame" title="Current scene frame">Scene ${Math.floor(editor.tick)+1}</span></div><progress class="movieclip-progress" aria-label="Movieclip progress" max="${asset.duration}" value="${current??0}"></progress><div class="movieclip-duration" data-movieclip-duration>${asset.duration} frames <span>·</span> ${number(asset.duration/asset.document.fps)} s <span>·</span> ${asset.document.fps} fps</div>
    <label class="movieclip-mode"><span>Playback</span><select class="inline-select" data-movieclip-field="mode" aria-label="Movieclip playback">${[['loop','Loop'],['hold','Play once · hold'],['once','Play once · hide'],['single','Single frame']].map(([value,label])=>`<option value="${value}" ${p.mode===value?'selected':''}>${label}</option>`).join('')}</select></label><div class="field-grid movieclip-playback-fields">${input('offset',p.mode==='single'?'Hold frame':'Start frame',p.offset+1,1,10000001)}${input('speed','Speed',p.speed,.001,100,'×',p.mode==='single')}</div></section>
    <section class="inspector-section movieclip-transform"><div class="inspector-title">Transform</div><div class="field-grid">${field('X','root_x',object.root_x,'px')}${field('Y','root_y',object.root_y,'px')}${field('Scale','scale',object.scale*100,'%','min="0.01"')}${field('Angle','rotation',((object.angles[0]??0)-(figure.segments[0]?.angle_rad??0))*180/Math.PI,'°')}${field('Opacity','figure_opacity',(1-(object.field28??0)/255)*100,'%','min="0" max="100"')}${field('Z-index','figure_z_order',object._stykZIndex??0,'','min="-1000000" max="1000000"')}</div><p class="property-context-caption">Drag a label to scrub its value · Shift or Alt for finer steps</p></section>
    <section class="inspector-section movieclip-extend"><div class="movieclip-extend-heading"><label for="movieclip-next-keys">Next keyframes</label><span>${remaining} available</span></div><div class="movieclip-extend-controls"><label class="field"><input id="movieclip-next-keys" type="number" data-movieclip-next-keys aria-label="Next keyframes" value="${state.nextKeys}" min="1" max="1000000" step="1" required></label><button class="button" data-action="movieclip-extend" ${remaining?'':'disabled'}>${icon('plus')}Add to next keyframes</button></div><div class="movieclip-feedback" data-movieclip-feedback role="status" aria-live="polite" aria-atomic="true" ${message||!remaining?'':'hidden'}>${esc(message||(!remaining?'No later keyframes.':''))}</div></section>
    <details class="inspector-section inspector-disclosure movieclip-more" data-section="Movieclip actions"><summary class="inspector-title">More actions</summary><div class="movieclip-secondary-actions"><button class="button" data-action="movieclip-break" title="Replace only scene frame ${Math.floor(editor.tick)+1}">Break apart frame</button><button class="button" data-action="movieclip-bake">Bake animation</button><button class="button" data-action="movieclip-export">Export movieclip</button></div></details></div>`;
}
export function installMovieclipUI({editor,actions,pause,finishEdit,getTimeline,setTool,onError,queueUI,exportClip}){
  const breadcrumb=document.createElement('div');breadcrumb.className='movieclip-breadcrumb';breadcrumb.hidden=true;
  document.querySelector('.context-strip').before(breadcrumb);
  const dialog=document.createElement('dialog');dialog.className='movieclip-dialog';dialog.setAttribute('aria-label','Create movieclip');document.body.append(dialog);
  const style=document.createElement('style');style.textContent=`@layer legacy{.movieclip-breadcrumb{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--theme-subtle, #eef4ff);border-bottom:1px solid var(--theme-border, #dce6f4)}.movieclip-breadcrumb[hidden]{display:none}.movieclip-breadcrumb strong{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.movieclip-actions{display:flex;gap:6px;flex-wrap:wrap}.movieclip-actions .button{flex:1;white-space:nowrap}.movieclip-fields{margin:10px 0}.movieclip-dialog{width:min(400px,calc(100vw - 32px));padding:20px;border:1px solid var(--theme-border, #d8dde4);border-radius:10px;color:var(--theme-text, #252a31);background:var(--theme-panel, #fff)}.movieclip-dialog::backdrop{background:var(--theme-backdrop, #0005)}.movieclip-dialog form{display:grid;gap:16px}.movieclip-dialog h2{margin:0;font-size:17px}.movieclip-dialog label{display:grid;gap:6px;font-size:12px}.movieclip-dialog input,.movieclip-dialog select{width:100%;padding:8px;border:1px solid var(--theme-border, #d8dde4);border-radius:5px;background:var(--theme-panel, #fff);color:var(--theme-text, #252a31);font:inherit}.movieclip-dialog .movieclip-check{display:flex;align-items:center}.movieclip-dialog .movieclip-check input{width:auto}.movieclip-dialog .movieclip-error{color:var(--theme-danger, #b42318);font-size:12px}.movieclip-dialog footer{display:flex;justify-content:flex-end;gap:8px}.movieclip-count{font-variant-numeric:tabular-nums;color:var(--theme-muted, #697586);font-size:12px}}`;document.head.append(style);
  function open(mode){
    document.getElementById('insert-dialog')?.close();
    pause();finishEdit();
    const timelineView=getTimeline(),selection=timelineView?.selectedFrameIndices??[],rows=editor.timeline,timeRange=editor.report._styk?.layerSheet?timelineView?.selectedTimeRange:null;
    const start=mode==='range'&&timeRange?timeRange.start:mode==='range'&&selection.length?Math.min(...selection.map(i=>rows[i].start)):editor.tick;
    const end=mode==='range'&&timeRange?Math.min(editor.totalTicks,timeRange.end):mode==='range'&&selection.length?Math.max(...selection.map(i=>rows[i].start+rows[i].count)):start+1;
    const range=mode==='range'?`<div class="field-grid"><label>From frame<input name="start" type="number" min="1" max="${editor.totalTicks}" value="${start+1}" required></label><label>Through frame<input name="end" type="number" min="1" max="${editor.totalTicks}" value="${end}" required></label></div>`:`<input name="start" type="hidden" value="${start+1}">`;
    dialog.innerHTML=`<form><h2>${mode==='empty'?'New movieclip':'Create movieclip'}</h2>
      <label>Name<input name="name" aria-label="Movieclip name" required maxlength="120" value="${esc(editor.figure?.name?`${editor.figure.name} clip`:'Movieclip')}"></label>
      ${mode==='empty'?'':`${range}<label>Contents<select name="contents"><option value="selected" ${editor.selectedUids.size?'':'disabled'} ${editor.selectedUids.size?'selected':''}>Selected figures</option><option value="all" ${editor.selectedUids.size?'':'selected'}>All figures</option></select></label><label class="movieclip-check"><input name="replace" type="checkbox" checked>Replace selection</label>`}
      <div class="movieclip-error" role="alert" hidden></div><footer><button type="button" class="button" data-cancel>Cancel</button><button type="submit" class="button primary">Create</button></footer></form>`;
    dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,values=new FormData(form),name=String(values.get('name')).trim();if(!name)return;
      try{
        const revision=editor.revision;await drawingBarrier(editor.report);if(revision!==editor.revision)throw new Error('The scene changed. Try creating the movieclip again.');
        const figure=mode==='empty'?editor.createEmptyMovieclip(name):editor.createMovieclip({name,start:Number(values.get('start'))-1,...(mode==='range'?{end:Number(values.get('end'))}:{}),uids:values.get('contents')==='all'?[]:[...editor.selectedUids],replace:values.has('replace')});
        dialog.close();setTool('select');if(mode==='empty')editor.enterMovieclip(figure.figure_type_id);queueUI();
      }catch(error){const target=dialog.querySelector('[role="alert"]');target.hidden=false;target.textContent=error.message;}
    };
    dialog.showModal();dialog.querySelector('input').select();
  }
  Object.assign(actions,{
    'movieclip-new':()=>open('empty'),'movieclip-create':()=>open('selection'),'movieclip-range':()=>open('range'),
    'movieclip-edit':async()=>{pause();finishEdit();await drawingBarrier(editor.report);setTool('select');editor.enterMovieclip();},
    'movieclip-done':async()=>{pause();finishEdit();await drawingBarrier(editor.report);editor.leaveMovieclip();queueUI();},
    'movieclip-cancel':()=>{pause();editor.leaveMovieclip({save:false});queueUI();},
    'movieclip-unique':()=>editor.makeMovieclipUnique(),
    'movieclip-break':()=>editor.breakApartMovieclip(),'movieclip-export':()=>exportClip(),
    'movieclip-bake':()=>editor.bakeMovieclip(),
    'movieclip-extend':()=>{
      const input=document.querySelector('[data-movieclip-next-keys]');
      if(!input?.reportValidity())return;
      try{
        const count=Number(input.value),available=nextKeys(editor),state=inspectorState(editor);
        const added=editor.addMovieclipToNextKeyframes(count),skipped=Math.min(count,available)-added;
        state.nextKeys=count;
        const message=added?`Added to ${added} keyframe${added===1?'':'s'}${skipped?` · ${skipped} already present`:''}.`:available?'Already present in these keyframes.':'No later keyframes.';
        state.feedback={uid:editor.selectedUid,tick:editor.tick,revision:editor.revision,message};queueUI();
      }catch(error){onError(error);}
    },
  });
  document.addEventListener('movieclip-create-range',()=>open('range'));
  for(const name of Object.keys(actions).filter(name=>name.startsWith('movieclip-'))){const run=actions[name];actions[name]=(...args)=>{pause();finishEdit();return run(...args);};}
  document.addEventListener('change',event=>{
    if(event.target.matches('[data-movieclip-next-keys]')){if(event.target.checkValidity())inspectorState(editor).nextKeys=Number(event.target.value);return;}
    if(event.target.matches('[data-movieclip-name]')){try{pause();finishEdit();editor.renameMovieclip(event.target.value);}catch(error){onError(error);}queueUI();return;}
    const input=event.target.closest('[data-movieclip-field]');if(!input)return;
    if(!input.reportValidity()){queueUI();return;}
    try{pause();finishEdit();const key=input.dataset.movieclipField;if(!['mode','offset','speed'].includes(key))return;
      const value=key==='mode'?input.value:Number(input.value)-(key==='offset'?1:0);
      editor.setMovieclipPlayback({[key]:value},{allFrames:true});queueUI();
    }catch(error){onError(error);queueUI();}
  });
  function sync(){
    const scopes=editor._movieclipScopes??[];breadcrumb.hidden=!scopes.length;
    if(scopes.length)breadcrumb.innerHTML=`<button class="button" data-action="movieclip-done">← Scene</button><strong>${scopes.map(s=>esc(s.name)).join(' / ')}</strong><button class="button" data-action="movieclip-cancel">Cancel</button><button class="button primary" data-action="movieclip-done">Done</button>`;
  }
  editor.addEventListener('change',sync);sync();
  return {open,sync};
}
