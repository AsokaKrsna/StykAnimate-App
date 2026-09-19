import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const out='artifacts/spatial-controls';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STYK_URL??'http://127.0.0.1:47851');await page.waitForFunction(()=>window.styk?.ready);
 const doc=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):null;
 await page.evaluate(async document=>{
  const s=window.styk;for(const d of window.document.querySelectorAll('dialog[open]'))d.close();
  if(!document){
   const{construction}=await import('/src/rig-examples-3d.mjs'),{createObject,createFrame,emptyDocument}=await import('/src/demo.mjs');
   const q=construction();q.add(0,0,0,'Figure rotation');
   const bone=(parent,origin,tip,name)=>{const turn=q.add(0,0,0,'Turn'),pitch=q.add(0,0,0,'Tilt'),v=tip.map((n,i)=>n-origin[i]);return q.add(parent,Math.hypot(...v),Math.atan2(v[1],v[0]),name,{control:true,width:18,rig:{spatial:{parent,origin,tip,turn,pitch}}});};
   const a=bone(0,[0,0,0],[0,100,0],'Upper arm'),b=bone(a,[0,100,0],[0,180,0],'Forearm'),f={figure_type_id:1,segments:q.segments,polyfills:[],image_assets:[],text_assets:[]};
   document={...emptyDocument(),figure_types:[f],keyframes:[createFrame([createObject(f,1,400,200)])]};
  }
  s.editor.load(document);s.editor.select(1,-1);s.state.onion=false;s.state.settings.autosaveSeconds=0;s.fit();
 },doc);
 await page.getByRole('button',{name:'Rotate',exact:true}).click();
 assert.ok(await page.evaluate(()=>Boolean(styk.editor.getSpatialPose())),'Rotate selects the first articulation');
 await page.getByText('Exact angles',{exact:true}).click();
 const range=page.getByRole('slider',{name:'Turn',exact:true});await range.scrollIntoViewIfNeeded();const box=await range.boundingBox();
 const before=await page.evaluate(()=>({angles:[...styk.editor.object.angles],undo:styk.editor._undo.length}));
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.5,{steps:12});await page.mouse.up();
 let after=await page.evaluate(()=>({angles:[...styk.editor.object.angles],undo:styk.editor._undo.length,drag:styk.editor.dragging}));
 assert.notDeepEqual(after.angles,before.angles);assert.equal(after.undo,before.undo+1);assert.equal(after.drag,false);
 await page.evaluate(()=>styk.editor.undo());assert.deepEqual(await page.evaluate(()=>styk.editor.object.angles),before.angles);
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.5,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();
 assert.deepEqual(await page.evaluate(()=>styk.editor.object.angles),before.angles,'Escape restores the complete slider gesture');
 for(const label of ['Turn','Tilt','Bend']){const field=page.getByRole('spinbutton',{name:label+' degrees',exact:true});await field.fill('23');await field.press('Tab');}
 const pose=await page.evaluate(()=>styk.editor.getSpatialPose());for(const n of Object.values(pose))assert.ok(Math.abs(n-23*Math.PI/180)<1e-7);
 await page.getByRole('button',{name:'Reset pose',exact:true}).click();
 const point=await page.evaluate(()=>{const{editor:e,state}=styk,g=e.geometry.objects.get(0),p=g.segments[e.selectedJoint].start,r=document.getElementById('viewport').getBoundingClientRect();return{x:r.x+state.view.x+p.x*state.view.scale,y:r.y+state.view.y+p.y*state.view.scale};});
 const initial=await page.evaluate(()=>styk.editor.object.angles.slice());
 await page.mouse.move(point.x+3,point.y+3);await page.mouse.down();await page.mouse.move(point.x+35,point.y-15,{steps:10});
 assert.equal(await page.evaluate(()=>styk.state.drag?.kind),'spatial');assert.notDeepEqual(await page.evaluate(()=>styk.editor.object.angles),initial,'Free trackball changes the pose before cancellation');
 await page.keyboard.press('Escape');await page.mouse.up();
 assert.deepEqual(await page.evaluate(()=>styk.editor.object.angles),initial,'Escape restores the canvas rotation gesture');
 const undoCount=await page.evaluate(()=>styk.editor._undo.length);
 await page.mouse.move(point.x+3,point.y+3);await page.mouse.down();await page.mouse.move(point.x-21,point.y+17,{steps:10});await page.mouse.up();
 assert.equal(await page.evaluate(()=>styk.editor._undo.length),undoCount+1);assert.notDeepEqual(await page.evaluate(()=>styk.editor.object.angles),initial);await page.evaluate(()=>styk.editor.undo());assert.deepEqual(await page.evaluate(()=>styk.editor.object.angles),initial);
 await page.getByRole('button',{name:'Pose',exact:true}).click();await range.waitFor({state:'detached'});
 const ik=await page.evaluate(()=>{const e=styk.editor,i=e.figure.segments.findIndex(s=>e.object._stykIK?.[s.segment_id]?.enabled);if(i>=0)e.select(1,i);else{e.select(1,e.figure.segments.length-1);e.setNodeIK({enabled:true,chainLength:2,pinned:false});}const p=e.geometry.objects.get(0).segments[e.selectedJoint].end,r=document.getElementById('viewport').getBoundingClientRect(),v=styk.state.view;return{x:r.x+v.x+p.x*v.scale,y:r.y+v.y+p.y*v.scale,world:{...p},scale:v.scale};});
 await page.mouse.move(ik.x,ik.y);await page.mouse.down();await page.mouse.move(ik.x+12,ik.y-15,{steps:12});await page.mouse.up();
 const end=await page.evaluate(()=>{const e=styk.editor;return e.geometry.objects.get(0).segments[e.selectedJoint].end;});
 assert.ok(Math.hypot(end.x-ik.world.x-12/ik.scale,end.y-ik.world.y+15/ik.scale)<.5,'Pointer drag reaches the IK target');
 const plant=page.getByRole('button',{name:'Plant both feet',exact:true});
 if(await plant.count()){
  const beforePlant=await page.evaluate(()=>({doc:styk.editor.serialize(),undo:styk.editor._undo.length}));
  await plant.click();assert.equal(await page.evaluate(()=>styk.editor._undo.length),beforePlant.undo+1);
  await page.getByRole('button',{name:'Release feet',exact:true}).waitFor();
  await page.getByRole('button',{name:'Left foot',exact:true}).click();
  const swivel=page.getByRole('slider',{name:'Bend direction',exact:true});await swivel.scrollIntoViewIfNeeded();const rect=await swivel.boundingBox();
  const plantedBefore=await page.evaluate(()=>{const e=styk.editor,g=e.geometry.objects.get(0);return{end:g.segments[e.selectedJoint].end,undo:e._undo.length,angles:e.object.angles.slice()};});
  await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.5,{steps:8});await page.mouse.up();
  const plantedAfter=await page.evaluate(()=>{const e=styk.editor;return{end:e.geometry.objects.get(0).segments[e.selectedJoint].end,undo:e._undo.length,swivel:e.getIKSettings().spatialTarget.swivel};});
  assert.ok(plantedAfter.swivel>.3);assert.equal(plantedAfter.undo,plantedBefore.undo+1);assert.ok(Math.hypot(plantedAfter.end.x-plantedBefore.end.x,plantedAfter.end.y-plantedBefore.end.y)<.01);
  await page.evaluate(()=>styk.editor.undo());assert.deepEqual(await page.evaluate(()=>styk.editor.object.angles),plantedBefore.angles);
  const pole=await page.evaluate(async()=>{const{spatialPoleGizmo}=await import('/src/spatial-controls.mjs'),s=styk,p=spatialPoleGizmo(s.editor,p=>({x:p.x*s.state.view.scale+s.state.view.x,y:p.y*s.state.view.scale+s.state.view.y})),r=document.getElementById('viewport').getBoundingClientRect();return{x:p.screen.x+r.x,y:p.screen.y+r.y,doc:s.editor.serialize()};});
  await page.mouse.move(pole.x,pole.y);await page.mouse.down();await page.mouse.move(pole.x-45,pole.y-16,{steps:8});assert.equal(await page.evaluate(()=>styk.state.drag?.spatial?.kind),'pole');
  assert.ok(await page.evaluate(()=>styk.editor._drag?.changed),'Pole drag changes the live pose');await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await page.evaluate(()=>styk.editor.serialize()),pole.doc,'Escape restores the IK pole gesture');
  await page.mouse.move(pole.x,pole.y);await page.mouse.down();await page.mouse.move(pole.x-35,pole.y-10,{steps:8});await page.mouse.up();await page.evaluate(()=>styk.editor.undo());assert.deepEqual(await page.evaluate(()=>styk.editor.serialize()),pole.doc,'Pole dragging is one undo step');
  await page.getByRole('button',{name:'Release feet',exact:true}).click();await plant.waitFor();
 }
 const form=page.locator('[data-drawing-group]');if(await form.count()){
  const old=await page.evaluate(()=>styk.editor.selectionFrame.objects[1]._stykMovieclip.offset);await form.selectOption('1');await page.waitForTimeout(200);
  assert.notEqual(await page.evaluate(()=>styk.editor.selectionFrame.objects[1]._stykMovieclip.offset),old);assert.equal(await page.evaluate(()=>styk.editor.selectedUid),1);
  await page.evaluate(()=>styk.editor.undo());assert.equal(await page.evaluate(()=>styk.editor.selectionFrame.objects[1]._stykMovieclip.offset),old);
 }
 await page.screenshot({path:out+'/pose.png'});await page.getByRole('button',{name:'Rotate',exact:true}).click();await page.screenshot({path:out+'/rotate.png'});
 assert.deepEqual(errors,[]);await writeFile(out+'/report.json',JSON.stringify({passed:true,errors},null,2));console.log('Spatial controls: slider, numeric axes, one-step undo, slider/canvas cancellation, IK mouse drag and drawing selection passed.');
}finally{await browser.close();}
