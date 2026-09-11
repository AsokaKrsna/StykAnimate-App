import test from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../src/editor.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';
import {isStatic} from '../src/pivot/geometry.mjs';
// Geometry uses float32 buffers; allow sub-pixel rounding at scene coordinates.
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);

test('New creates one clean Bubble frame and fresh independent rig data',()=>{
  const e=new Editor().newDocument();
  assert.equal(e.name,'Untitled animation');assert.equal(e.totalTicks,1);
  assert.equal(e.report.keyframes.length,1);assert.equal(e.frame.objects.length,1);
  assert.equal(e.report.figure_types.length,1);assert.equal(e.figure.name,'Bubble');
  assert.equal(e.dirty,false);assert.equal(e.canUndo,false);
  assert.equal(e.figure.segments.filter(s=>!isStatic(s)).length,10);
  assert(e.figure.segments.slice(10).every(isStatic));
  const other=createStartupDocument();e.figure.segments[0].color_rgb[0]=99;
  assert.equal(other.figure_types[0].segments[0].color_rgb[0],13);
});

test('Bubble limbs are symmetric and every posing joint carries its complete subtree rigidly',()=>{
  const e=new Editor({demo:false}).newDocument(),initial=e.geometry.objects.get(0);
  for(const [a,b] of [[3,5],[4,6],[7,9],[8,10]]) {
    near(initial.joints.get(a).y,initial.joints.get(b).y);
    near(initial.joints.get(a).x+initial.joints.get(b).x,960);
  }
  for(let index=0;index<10;index++) {
    const before=e.geometry.objects.get(0),joints=new Map([...before.joints].map(([id,p])=>[id,{...p}]));
    const selected=e.figure.segments[index],descendants=new Set([selected.segment_id]);
    for(const s of e.figure.segments)if(descendants.has(s.parent_id))descendants.add(s.segment_id);
    const pivot=joints.get(selected.parent_id),delta=.6;
    e.select(1,index);e.rotateJoint(delta);
    const after=e.geometry.objects.get(0);
    for(const [id,p] of joints) {
      const q=after.joints.get(id),dx=p.x-pivot.x,dy=p.y-pivot.y;
      near(q.x,descendants.has(id)?pivot.x+dx*Math.cos(delta)-dy*Math.sin(delta):p.x);
      near(q.y,descendants.has(id)?pivot.y+dx*Math.sin(delta)+dy*Math.cos(delta):p.y);
    }
    assert(e.undo());
  }
});
