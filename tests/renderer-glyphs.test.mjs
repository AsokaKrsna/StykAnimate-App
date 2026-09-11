import {test} from 'node:test';
import assert from 'node:assert/strict';
import {glyphTextureDescriptor,glyphTextureKey,glyphTextureShape,glyphVisible} from '../src/renderer-glyphs.mjs';

function item() {
  return {type:'text',start:{x:10,y:80},end:{x:50,y:80},angle:0,rgb:[32,64,128],alpha:.8,opacity:.5,
    obj:{scale:2,color_override_raw:0},fig:{},seg:{},asset:{normalized_svg_path:'M0 0H20V30H0Z',
      bounds:{left:100,bottom:30,width:20},placements:[{visible:true,x:100,y:0,glyph_index:0}],
      glyphs:[{svg_path:'M0 0H20V30H0Z',bounds:{left:0,top:0,right:20,bottom:30}}]}};
}
test('glyph masks retain exact path identity across translation, tint, opacity, rotation and stretching',async()=>{
  const s=item(),first=glyphTextureDescriptor([s],1),key=await glyphTextureKey(first);
  const changed={...s,start:{x:210,y:180},end:{x:210,y:220},angle:Math.PI/2,rgb:[255,0,0],opacity:.25};
  const next=glyphTextureDescriptor([changed],1);
  assert.equal(await glyphTextureKey(next),key);assert.deepEqual(next.color,[1,0,0,.2]);
  assert.notDeepEqual(glyphTextureShape(first,s.start,1),glyphTextureShape(next,changed.start,1));
  assert.equal(first.mask,next.mask);
  s.asset.glyphs[0].svg_path='M0 0H10V30H0Z';
  assert.notEqual(await glyphTextureKey(glyphTextureDescriptor([s],1)),key);
});
test('glyph quad follows native reverse, mirror, signed vertical scale and root-local transforms',()=>{
  for(const reverse of[false,true])for(const mirror of[false,true])for(const scale of[2,-2]){
    const s=item();s.seg.extra_u8_a=+reverse;s.seg.extra_u8_b=+mirror;s.obj.scale=scale;s.angle=.43;
    s.end={x:s.start.x+40*Math.cos(s.angle),y:s.start.y+40*Math.sin(s.angle)};
    const g=glyphTextureDescriptor([s],2),record=glyphTextureShape(g,{x:5,y:7},9);
    // Independently map the actual top-left ink corner through the Canvas order.
    const angle=s.angle+(reverse?Math.PI:0)-(mirror?Math.PI:0),start=reverse?s.end:s.start;
    const px=0,py=-30*scale;
    const actual={x:g.x+g.axes[0]*2/g.width+g.axes[2]*2/g.height,y:g.y+g.axes[1]*2/g.width+g.axes[3]*2/g.height};
    assert.ok(Math.abs(actual.x-(start.x+px*Math.cos(angle)-py*Math.sin(angle)))<1e-10);
    assert.ok(Math.abs(actual.y-(start.y+px*Math.sin(angle)+py*Math.cos(angle)))<1e-10);
    assert.equal(record[21],9);assert.ok(Math.abs(record[0]-(g.x-5))<1e-4);
    assert.ok(glyphVisible(g,{x:-1000,y:-1000,width:2000,height:2000}));
    assert.equal(glyphVisible(g,{x:5000,y:5000,width:2,height:2}),false);
  }
});
test('unsupported compositing and undersampled huge glyphs use the complete painter',()=>{
  for(const mutate of[
    s=>{s.seg.paint={type:'solid',color:[0,1,2]};},s=>{s.seg.secondary={a:0,rgb:[1,2,3]};},
    s=>{s.fig.segment_decode={global_style:{u28:1}};},s=>{s._movieclipOwner={opacity:.5};},
    s=>{s.asset.placements.push({...s.asset.placements[0]});},s=>{s.asset.glyphs[0].bounds.right=NaN;},
    s=>{s.end.x=100000;},
  ]){const s=item();mutate(s);assert.equal(glyphTextureDescriptor([s],1),null);}
  const s=item();assert.equal(glyphTextureDescriptor([s,s],1),null);
  const g=glyphTextureDescriptor([s],2);assert.ok(g.width<=4096&&g.height<=4096);
  assert.ok(g.scaleX>=4&&g.scaleY>=4,'Mask preserves requested pixel density in both axes');
});
