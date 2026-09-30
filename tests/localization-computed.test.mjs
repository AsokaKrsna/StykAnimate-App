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
import {CAMERA_MOTION_TYPES,MOTION_PARAMETERS} from '../src/camera-motion.mjs';
import {presetSummary,presetTile} from '../src/vfx-preset-ui.mjs';

const fixture=()=>new Editor({demo:false}).load(emptyDocument());

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
