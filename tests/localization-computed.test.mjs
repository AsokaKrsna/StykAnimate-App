import test from 'node:test';
import assert from 'node:assert/strict';
import english from '../src/locales/en.mjs';
import {interfaceLocalization} from '../src/localization.mjs';
import {Editor} from '../src/editor.mjs';
import {construction} from '../src/rig-examples-3d.mjs';
import {createObject,createFrame,emptyDocument} from '../src/demo.mjs';
import {spatialSections} from '../src/spatial-controls.mjs';
import {cameraMotionView} from '../src/camera-motion-ui.mjs';
import {motionRows} from '../src/camera-motion-timeline.mjs';
import {motionTypeMessages,motionParameterMessages,motionDescriptionMessages} from '../src/camera-motion-localization.mjs';
import {CAMERA_MOTION_TYPES,MOTION_PARAMETERS,createCameraMotion,motionParameterKeys,validateCameraMotion} from '../src/camera-motion.mjs';
import {presetSummary,presetTile} from '../src/vfx-preset-ui.mjs';
import {VFX_REGISTRY,vfxProperty,validateVfxValue} from '../src/vfx.mjs';
import {errorMessageData,restoreMessageError,messageError} from '../src/localized-error.mjs';
import {errorText} from '../src/error-presentation.mjs';
import {PlaybackPlanner} from '../src/playback-planning.mjs';

const fixture=()=>new Editor({demo:false}).load(emptyDocument());

test('camera fields and planning operation names retain scalar diagnostics while their display references survive transport',async()=>{
 const editor=fixture(),before=JSON.stringify(editor.serialize()),history=editor._undo.length,failures=[];
 assert.throws(()=>editor.setCameraValues({x:NaN}),error=>{failures.push(error);return error.message==='Camera x must be finite.';});
 assert.throws(()=>editor.alignCameraToView({x:0,y:0,scale:1,width:NaN,height:540}),error=>{failures.push(error);return error.message==='Canvas width must be finite.';});
 const planner=new PlaybackPlanner({report:null});
 for(const [operation,original]of [['planLayerMigration','layer migration'],['planInsertInbetweens','insert inbetween']])
  await assert.rejects(planner[operation]({}),error=>{failures.push(error);return error.message===`Load a document before ${original} planning.`;});
 interfaceLocalization.setPseudo('long');
 try{
  for(const error of failures){
   const restored=restoreMessageError(new Error(),structuredClone(errorMessageData(error)));
   assert.equal(restored.message,error.message);
   const value=restored.messageParams.label??restored.messageParams.value;
   assert.ok(errorText(restored).includes(interfaceLocalization.t(value.messageKey,value.messageParams)));
   if(value.messageParams)assert.ok(errorText(restored).includes(value.messageParams.field));
  }
 }finally{interfaceLocalization.setPseudo(null);}
 assert.equal(JSON.stringify(editor.serialize()),before);assert.equal(editor._undo.length,history);
});

test('camera and effect validation translate every parameter while keeping diagnostic identity through transport',()=>{
 const failures=[];
 for(const type of Object.keys(CAMERA_MOTION_TYPES))for(const parameter of motionParameterKeys(type)){
  const clip=createCameraMotion(type,'test',0,24,{targets:[{uid:1,weight:1}]});clip.params[parameter]=NaN;
  assert.throws(()=>validateCameraMotion({version:1,clips:[clip]}),error=>{failures.push(error);return error.message===`${MOTION_PARAMETERS[parameter][0]} must be between ${MOTION_PARAMETERS[parameter][1]} and ${MOTION_PARAMETERS[parameter][2]}.`;});
 }
 for(const [type,definition]of Object.entries(VFX_REGISTRY))for(const parameter of [...Object.keys(definition.params),'enabled'])
  assert.throws(()=>validateVfxValue(vfxProperty(type,'test',parameter),NaN),error=>{failures.push(error);return true;});
 assert.throws(()=>validateVfxValue('vfxScope',NaN),error=>{failures.push(error);return error.message==='Include attached parts must be between 0 and 1.';});
 interfaceLocalization.setPseudo('long');
 try{
  for(const error of failures){
   const label=error.messageParams.label;
   assert.ok(Object.hasOwn(english,label.messageKey),label.messageKey);
   assert.ok(error.message.startsWith(label.diagnosticValue));
   const restored=restoreMessageError(new RangeError(error.message),structuredClone(errorMessageData(error)));
   assert.ok(restored instanceof RangeError);assert.equal(restored.message,error.message);
   assert.equal(errorText(restored),interfaceLocalization.t(error.messageKey,error.messageParams));
   assert.ok(errorText(restored).includes(interfaceLocalization.t(label.messageKey)));
  }
 }finally{interfaceLocalization.setPseudo(null);}
 const ordinary=messageError(new Error(),'errors.cameraMotion.mustBeBetweenAnd',{label:{messageKey:'common.save'},min:0,max:1});
 assert.equal(ordinary.message,'[object Object] must be between 0 and 1.','ordinary non-scalar diagnostics retain their existing normalization');
});

test('computed camera copy is complete and resolves after language changes without changing saved motion',()=>{
 assert.deepEqual(Object.keys(motionTypeMessages),Object.keys(CAMERA_MOTION_TYPES));
 assert.deepEqual(Object.keys(motionParameterMessages),Object.keys(MOTION_PARAMETERS));
 for(const key of [...Object.values(motionTypeMessages),...Object.values(motionParameterMessages),...Object.values(motionDescriptionMessages)])assert.ok(Object.hasOwn(english,key),key);
 const editor=fixture(),id=editor.addCameraMotion('shake');editor._selectedCameraMotion=id;
 const bytes=JSON.stringify(editor.serialize()),history=editor._undo.length;
 interfaceLocalization.setPseudo('long');
 try{
  const view=cameraMotionView(editor);
  assert.ok(view.includes(interfaceLocalization.t('cameraMotionUi.presetShake')));
  assert.match(view,/data-i18n="cameraMotionUi.roughness"/);
  assert.match(view,/data-i18n-aria-label="cameraMotionUi.disableMove"/);
  assert.equal(motionRows(editor)[0].name,interfaceLocalization.t('cameraMotionUi.presetShake'));
  assert.equal(JSON.stringify(editor.serialize()),bytes);assert.equal(editor._undo.length,history);
 }finally{interfaceLocalization.setPseudo(null);}
 assert.equal(motionRows(editor)[0].name,'Shake');
});

test('preset summaries translate effect names, counts and animation while glyph categories stay canonical',()=>{
 const preset={effects:[{type:'glow'}],keys:{}};
 interfaceLocalization.setPseudo('long');
 try{
  assert.equal(presetSummary(preset),interfaceLocalization.t('vfxCatalog.effect.glow'));
  const group={effects:[{type:'glow'},{type:'blur'}],keys:{radius:[]}};
  assert.equal(presetSummary(group),interfaceLocalization.t('vfxPresetUi.animatedSummary',{count:2,summary:{messageKey:'counts.effects',messageParams:{count:2}}}));
  assert.match(presetTile(group),/vfx-tile/);
  assert.equal(JSON.stringify(preset),'\{"effects":[\{"type":"glow"\}],"keys":\{\}\}');
 }finally{interfaceLocalization.setPseudo(null);}
});

test('canonical skeleton names keep secondary part controls and localized depth notes in every language',()=>{
 const q=construction();q.add(0,0,0,'Figure rotation');
 const bone=(parent,origin,tip,name)=>{
  const turn=q.add(0,0,0,name+' turn'),pitch=q.add(0,0,0,name+' tilt'),v=tip.map((n,i)=>n-origin[i]);
  return q.add(parent,Math.hypot(...v),Math.atan2(v[1],v[0]),name,{control:true,rig:{spatial:{parent,origin,tip,turn,pitch}}});
 };
 const chest=bone(0,[0,0,0],[0,40,0],'Chest');bone(chest,[0,40,0],[10,60,0],'My hair');
 const figure={figure_type_id:1,segments:q.segments,polyfills:[],image_assets:[],text_assets:[]};
 const editor=new Editor({demo:false}).load({...emptyDocument(),figure_types:[figure],keyframes:[createFrame([createObject(figure,1,200,100)])]});
 editor.select(1,-1);const bytes=JSON.stringify(editor.serialize());
 interfaceLocalization.setPseudo('long');
 try{
  const sections=spatialSections(editor,{hotkeyLabel:()=> 'D / F'});
  assert.ok(sections.find(section=>section.id==='rig-body').rows[0].html.includes('My hair'));
  const meta=sections.find(section=>section.id==='rig-pose').rows.find(row=>row.kind==='meta');
  assert.equal(meta.textParams.value.messageKey,'spatialControls.depthHint');
  assert.equal(meta.textParams.value.messageParams.key,'D');
  assert.ok(meta.text.includes(interfaceLocalization.t('spatialControls.depthHint',{key:'D'})));
  assert.equal(JSON.stringify(editor.serialize()),bytes);
 }finally{interfaceLocalization.setPseudo(null);}
});
