import {drawingSetsView} from './movieclip-drawings.mjs';
import {drawingBarrier} from './drawing-resources.mjs';
import {playbackSettings,movieclipAsset,movieclipTime} from './movieclips.mjs';
import {renderInspector} from './inspector-kit.mjs';

const inspectorStates=new WeakMap();
const seconds=value=>Number(Number(value).toFixed(3));
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
/** A movieclip instance's name line: the clip's name (double-click renames the definition) with the movieclip glyph. */
export const movieclipTarget=editor=>({name:editor.figure.name,glyph:'frame',
  rename:{description:'Movieclip name',tip:'Double-click to rename the movieclip',maxlength:120,data:{'movieclip-name':true}}});

/**
 * A movieclip instance's sections (experience.md §5.1): Playback (how it
 * plays: mode, start or hold frame, speed; where it is and how long it runs)
 * and Transform are open; Extend (adding it to the next keyframes), Bake and
 * export (Break apart frame, Bake to frames, Export clip…) and its drawing
 * sets are titled. Edit clip and Make unique are its quick actions.
 * `number(label, key, value, unit, extra)` builds a property row
 * (inspector-view.mjs passes one that reads live values); `layer` is the
 * figure's Layer select.
 */
export function movieclipSections(editor,{number=(label,key,value,unit='',extra={})=>({kind:'number',key,label,unit,value,...extra}),layer=null}={}){
  const object=editor.object,figure=editor.figure,p=playbackSettings(object),asset=movieclipAsset(figure),state=inspectorState(editor),remaining=nextKeys(editor);
  const sample=editor.evaluatedFrame.objects.find(value=>value.unique_id===object.unique_id)?._movieclipSample??movieclipTime(asset,p,editor.tick,editor.report.fps);
  const current=sample===null?null:Math.min(asset.duration,Math.floor(sample)+1),single=p.mode==='single';
  const feedback=state.feedback,message=feedback?.uid===object.unique_id&&feedback.tick===editor.tick&&feedback.revision===editor.revision?feedback.message:'';
  const scene=Math.floor(editor.tick)+1,sets=drawingSetsView(figure,object);
  const playback=(name,label,description,value,min,max,extra={})=>({kind:'number',label,description,value,min,max,step:'any',precision:3,
    attrs:{required:true},data:{'movieclip-field':name},...extra});
  return [
    {id:'playback',title:'Playback',rows:[
      {kind:'select',label:'Plays',description:'Movieclip playback',value:p.mode,data:{'movieclip-field':'mode'},span:2,
        options:[['loop','Loop'],['hold','Play once · hold'],['once','Play once · hide'],['single','Single frame']].map(([value,label])=>({value,label}))},
      {kind:'grid',rows:[
        playback('offset',single?'Hold':'Start',single?'Movieclip hold frame':'Movieclip start frame',p.offset+1,1,10000001),
        playback('speed','Speed','Movieclip speed',p.speed,.001,100,{unit:'×',disabled:single}),
      ]},
      {kind:'meta',parts:['Frame ',{tag:'output',text:`${current??'—'} / ${asset.duration}`,data:{'movieclip-current-frame':true},attrs:{'aria-label':'Current movieclip frame'}},
        ' · ',{text:`Scene ${scene}`,className:'movieclip-scene-frame',data:{tooltip:'Current scene frame'}}]},
      {kind:'meta',parts:[{text:[`${asset.duration} frames`,`${seconds(asset.duration/asset.document.fps)} s`,`${asset.document.fps} fps`].join(' · '),data:{'movieclip-duration':true}}]},
    ]},
    {id:'transform',title:'Transform',rows:[{kind:'grid',rows:[
      number('X','root_x',object.root_x,'px'),number('Y','root_y',object.root_y,'px'),
      number('Angle','rotation',((object.angles[0]??0)-(figure.segments[0]?.angle_rad??0))*180/Math.PI,'°'),number('Scale','scale',object.scale*100,'%',{min:.01}),
      number('Opacity','figure_opacity',(1-(object.field28??0)/255)*100,'%',{min:0,max:100}),
      number('Z-index','figure_z_order',object._stykZIndex??0,'',{min:-1000000,max:1000000}),
      layer&&{...layer,span:2},
    ]}]},
    {id:'extend',title:'Extend',place:'titled',rows:[
      {kind:'grid',rows:[
        {kind:'number',id:'movieclip-next-keys',label:'Next keys',description:'Next keyframes',value:state.nextKeys,min:1,max:1000000,step:1,precision:0,
          attrs:{required:true},data:{'movieclip-next-keys':true}},
        {kind:'actions',items:[{action:'movieclip-extend',icon:'plus',label:'Add',text:true,variant:'outline',disabled:!remaining,
          attrs:{'aria-label':'Add to next keyframes'},tip:'Add this clip to the next keyframes'}]},
      ]},
      {kind:'meta',parts:[`${remaining} ${remaining===1?'keyframe':'keyframes'} after this frame`]},
      {kind:'meta',parts:[{text:message||(!remaining?'No later keyframes.':''),data:{'movieclip-feedback':true},attrs:{role:'status','aria-live':'polite','aria-atomic':'true'}}]},
    ]},
    {id:'bake',title:'Bake and export',place:'titled',rows:[{kind:'actions',items:[
      {action:'movieclip-break',label:'Break apart frame',text:true,variant:'outline',tip:`Replace only scene frame ${scene}`},
      {action:'movieclip-bake',label:'Bake animation',text:true,variant:'outline',tip:'Bake the clip into the scene'},
      {action:'movieclip-export',label:'Export movieclip',text:true,variant:'outline',tip:'Export the clip (.stykmov)'},
    ]}]},
    {id:'drawing-sets',title:'Drawing sets',place:'titled',open:Boolean(sets),hidden:!sets,rows:[{kind:'markup',html:sets}]},
  ];
}
/** A movieclip instance's inspector HTML, without the Edit together switch and Layer select that inspector-view.mjs adds. */
export const movieclipInspector=editor=>renderInspector({kind:'movieclip',sections:movieclipSections(editor)});
/** mountBreadcrumb(element) places the session breadcrumb ("← Scene", the scope path, Cancel, Done); the app owns where the stage
 * shows it, and without it the breadcrumb is not shown. */
export function installMovieclipUI({editor,actions,pause,finishEdit,getTimeline,setTool,onError,queueUI,exportClip,mountBreadcrumb}){
  const breadcrumb=document.createElement('div');breadcrumb.className='movieclip-breadcrumb';breadcrumb.hidden=true;
  mountBreadcrumb?.(breadcrumb);
  const dialog=document.createElement('dialog');dialog.className='movieclip-dialog';dialog.setAttribute('aria-label','Create movieclip');document.body.append(dialog);
  const style=document.createElement('style');style.textContent=`@layer legacy{.movieclip-breadcrumb{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--theme-subtle, #eef4ff);border-bottom:1px solid var(--theme-border, #dce6f4)}.movieclip-breadcrumb[hidden]{display:none}.movieclip-breadcrumb strong{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.movieclip-fields{margin:10px 0}.movieclip-dialog{width:min(400px,calc(100vw - 32px));padding:20px;border:1px solid var(--theme-border, #d8dde4);border-radius:10px;color:var(--theme-text, #252a31);background:var(--theme-panel, #fff)}.movieclip-dialog::backdrop{background:var(--theme-backdrop, #0005)}.movieclip-dialog form{display:grid;gap:16px}.movieclip-dialog h2{margin:0;font-size:17px}.movieclip-dialog label{display:grid;gap:6px;font-size:12px}.movieclip-dialog input,.movieclip-dialog select{width:100%;padding:8px;border:1px solid var(--theme-border, #d8dde4);border-radius:5px;background:var(--theme-panel, #fff);color:var(--theme-text, #252a31);font:inherit}.movieclip-dialog .movieclip-check{display:flex;align-items:center}.movieclip-dialog .movieclip-check input{width:auto}.movieclip-dialog .movieclip-error{color:var(--theme-danger, #b42318);font-size:12px}.movieclip-dialog footer{display:flex;justify-content:flex-end;gap:8px}.movieclip-count{font-variant-numeric:tabular-nums;color:var(--theme-muted, #697586);font-size:12px}}`;document.head.append(style);
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
    const scopes=editor._movieclipScopes??[];if(breadcrumb.hidden!==!scopes.length)breadcrumb.hidden=!scopes.length;
    if(scopes.length)breadcrumb.innerHTML=`<button class="button" data-action="movieclip-done">← Scene</button><strong>${scopes.map(s=>esc(s.name)).join(' / ')}</strong><button class="button" data-action="movieclip-cancel">Cancel</button><button class="button primary" data-action="movieclip-done">Done</button>`;
  }
  editor.addEventListener('change',sync);sync();
  return {open,sync};
}
