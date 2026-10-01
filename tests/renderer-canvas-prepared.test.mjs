import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderer} from '../src/renderer.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {defaultFigure,createObject,createFrame} from '../src/demo.mjs';
import {createDrawingFigure} from '../src/drawing-model.mjs';

function canvas(){
  const calls=[],surface={width:1,height:1,clientWidth:640,clientHeight:480,addEventListener(){},removeEventListener(){}};
  const context={canvas:surface,setTransform(...args){calls.push(['transform',...args]);},clearRect(...args){calls.push(['clear',...args]);},
    drawImage(...args){calls.push(['draw',...args]);},save(){calls.push(['save']);},restore(){calls.push(['restore']);}};
  surface.getContext=()=>context;surface.ownerDocument={createElement:canvas};surface.calls=calls;return surface;
}

test('compatibility prepared surfaces borrow owned pixels and preserve caller state',async()=>{
  const surface=canvas(),renderer=await createRenderer(surface,{forceCanvas2D:true,asyncArtwork:false});
  const report={canvas_width:640,canvas_height:480},bitmap={width:320,height:240};
  try{
    assert.equal(renderer.prepareFrame({key:'1:2',softwareFrames:true,cameraEnabled:true,hiddenKey:'hidden',uids:Uint32Array.of(1),compatibility:[{bitmap}]},{report}),'1:2');
    const entry=renderer.prepared.get('1:2'),target=canvas(),context=target.getContext('2d');
    assert.equal(renderer.renderPreparedInto('1:2',{report,hiddenKey:'hidden',view:{x:3,y:5,scale:.5},target:{context,dpr:2,clear:false}}),true);
    assert.deepEqual(target.calls,[['save'],['transform',2,0,0,2,0,0],['draw',entry.canvas,3,5,320,240],['restore']]);
    assert.equal(entry.canvas.calls[0][1],bitmap,'The admitted entry owns a copy of packet pixels.');
    target.calls.length=0;
    for(const options of [{hiddenKey:'different'},{hiddenKey:'hidden',cameraEnabled:false},{hiddenKey:'hidden',report:{}},
      {hiddenKey:'hidden',hiddenUids:new Set([1])},{hiddenKey:'hidden',dragTranslations:new Map([[1,{x:1,y:2}]])}]){
      assert.equal(renderer.renderPreparedInto('1:2',{report,...options,target:{context}}),false);
    }
    assert.deepEqual(target.calls,[],'Rejected frames leave destination pixels and state intact.');
    renderer.clearPreparedFrames();assert.equal(entry.canvas.width,1);assert.equal(entry.canvas.height,1);
    assert.equal(renderer.renderPreparedInto('1:2',{report,hiddenKey:'hidden',target:{context}}),false);
  }finally{renderer.destroy();}
});

test('Canvas admission skips protected artwork and evicts later obsolete owners',async()=>{
  const renderer=await createRenderer(canvas(),{forceCanvas2D:true,asyncArtwork:false});
  const current={bytes:20,frame:2,canvas:canvas()},obsolete={bytes:10,frame:1,canvas:canvas()},a={},b={};
  try{
    renderer.artworkBudget=30;renderer.artworkFrame=2;renderer.artwork.set(a,current);renderer.artwork.set(b,obsolete);renderer.artworkBytes=30;
    assert.equal(renderer.admitArtwork(10),true);assert.equal(renderer.artwork.get(a),current);assert.equal(renderer.artwork.has(b),false);
    assert.equal(renderer.artworkBytes,20);assert.equal(obsolete.canvas.width,1);assert.equal(obsolete.canvas.height,1);assert.equal(renderer.admitArtwork(11),false);
  }finally{renderer.destroy();}
});

test('native camera repaint preserves backing allocation while eviction and bitmap disposal end ownership',async()=>{
  const renderer=await createRenderer(canvas(),{forceCanvas2D:true,asyncArtwork:false}),camera={},native=canvas();
  const bytes=320*240*4;let releases=0,closes=0;
  native.width=320;native.height=240;
  const retain=extra=>{const entry={bytes,frame:0,release:()=>{releases++;},...extra};renderer.artwork.set(camera,entry);renderer.artworkBytes=bytes;return entry;};
  try{
    retain({canvas:native});renderer.releaseCameraArtwork(camera,{repaint:true});
    assert.equal(native.width,320);assert.equal(native.height,240);
    assert.equal(releases,0,'Immediate native repaint keeps the same warm root and child scratch.');
    assert.equal(renderer.artworkBytes,0);assert.equal(renderer.artwork.size,0);
    renderer.artworkBudget=bytes;renderer.artworkFrame=1;retain({canvas:native});
    assert.equal(renderer.admitArtwork(bytes),true);assert.equal(releases,1);
    assert.equal(native.width,1);assert.equal(native.height,1);
    retain({bitmap:{close(){closes++;}}});renderer.releaseCameraArtwork(camera);renderer.releaseCameraArtwork(camera);
    assert.equal(releases,2);assert.equal(closes,1);assert.equal(renderer.artworkBytes,0);
  }finally{renderer.destroy();}
});

test('Canvas protects the complete visible raster working set before new allocations',async()=>{
  const renderer=await createRenderer(canvas(),{forceCanvas2D:true,asyncArtwork:false}),figure=defaultFigure();
  const frame=createFrame([createObject(figure,1,180,220),createObject(figure,2,4000,4000)]),report={figure_types:[figure]};
  const geometry=buildGeometry(report,frame),groups=geometry.orderedObjects.map(g=>({g,items:g.drawables}));
  const visible={bytes:40,frame:1,canvas:canvas()},outside={bytes:60,frame:1,canvas:canvas()};
  try{
    renderer.artworkFrame=2;renderer.artwork.set(groups[0].g,visible);renderer.artwork.set(groups[1].g,outside);renderer.artworkBytes=100;
    renderer.protectVisibleArtwork(groups,{scale:1,parallax:()=>({x:0,y:0})},[1,0,0,1,0,0]);
    assert.equal(visible.frame,2);assert.equal(outside.frame,1);assert.equal(renderer.stats.activeArtworkBytes,40);
  }finally{renderer.destroy();}
});

test('removing scene effects releases obsolete camera pixels and scratch before further work',async()=>{
  const renderer=await createRenderer(canvas(),{forceCanvas2D:true,asyncArtwork:false}),source=canvas();
  const frame=createFrame([]),report={figure_types:[]},geometry=buildGeometry(report,frame),cancelled=[];
  let releases=0;
  const camera={destroy(){}},entry={canvas:source,bytes:320*240*4,release(){releases++;}};
  source.width=320;source.height=240;
  try{
    renderer.vfxCamera=camera;renderer.artwork.set(camera,entry);renderer.artworkBytes=entry.bytes;
    renderer.refinement={cancel(item){cancelled.push(item);},dispose(){}};
    // Ownership must end even if the destination cannot currently paint.
    renderer.contextLost=true;renderer.render({report,frame,geometry});
    assert.ok(cancelled.includes(entry));assert.equal(releases,1);
    assert.equal(renderer.artwork.size,0);assert.equal(renderer.artworkBytes,0);
    assert.equal(source.width,1);assert.equal(source.height,1);
    renderer.render({report,frame,geometry});assert.equal(releases,1);
  }finally{renderer.destroy();}
});

test('hidden drawing layer snapshots never request presenters and disposal drops dependency owners',async()=>{
  const renderer=await createRenderer(canvas(),{forceCanvas2D:true,asyncArtwork:false}),fig=createDrawingFigure({figureTypeId:2,celId:'cel-hidden'});
  const g={obj:{unique_id:2},fig},items=[{type:'image',fig}],report={},matrix=[1,0,0,1,0,0];
  const member={g,opacity:1,onionIndex:undefined,hidden:true,x:0,y:0,move:'',drawingInputs:null};
  try{
    renderer.resources.drawing=()=>{throw Error('Hidden drawing requested a decoded presenter.');};
    renderer.lastSceneGroups=[{g,hidden:true,drawingInputs:null}];
    renderer.sceneLayers={report,width:640,height:480,dpr:1,clip:true,matrix,margin:0,first:1,last:0,members:[member],below:{canvas:canvas(),bounds:{x:0,y:0,width:1,height:1}}};
    assert.ok(renderer.sceneLayerPlan([{g,items,opacity:1}],{report},matrix,{hiddenUids:new Set([2]),parallax:()=>({x:0,y:0})},()=>{}));
    renderer.clearArtwork();assert.equal(renderer.lastSceneGroups,null);assert.equal(renderer.sceneLayers,null);
  }finally{renderer.destroy();}
});
