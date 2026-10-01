import test from 'node:test';
import assert from 'node:assert/strict';
import {VfxGPU,releaseVfxGPU} from '../src/vfx-gpu.mjs';
import {withVfx} from '../src/vfx-canvas.mjs';
import {createVfx} from '../src/vfx.mjs';

/** A recording WebGL2 stand-in: every call succeeds and is listed. */
function graphics(events){
  const base={getParameter(){return 4096;},getShaderParameter(){return true;},getProgramParameter(){return true;},isContextLost(){return false;},getExtension(){return {loseContext(){}};}};
  return new Proxy(base,{get(target,key){return target[key]??((...args)=>{events.push({method:key,args});return {};});}});
}
function install(t,events,sizes){
  const previous=globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas=class {
    constructor(width,height){this._width=width;this._height=height;}
    get width(){return this._width;}set width(value){if(this.gl)sizes.push(['width',value]);this._width=value;}
    get height(){return this._height;}set height(value){if(this.gl)sizes.push(['height',value]);this._height=value;}
    getContext(kind){assert.equal(kind,'webgl2');return this.gl=graphics(events);}
  };
  t.after(()=>{releaseVfxGPU();globalThis.OffscreenCanvas=previous;});
}
const blur=()=>{const effect=createVfx('blur','blur');effect.params.radius=3;return effect;};

test('the pixel route reads the last pass once and never resizes the drawing buffer',t=>{
  const events=[],sizes=[];install(t,events,sizes);
  const gpu=new VfxGPU();
  try{
    const calls=method=>events.filter(event=>event.method===method);
    for(const [width,height] of [[640,512],[608,544],[700,96]]){
      events.length=0;
      const result=gpu.run({width,height},[blur()],{scale:1,pixels:true});
      assert.equal(result.straight,true);assert.equal(result.width,width);assert.equal(result.height,height);
      assert.equal(result.pixels.length,width*height*4);assert.ok(result.pixels instanceof Uint8ClampedArray);
      assert.equal(calls('readPixels').length,1);
      assert.deepEqual(calls('readPixels')[0].args.slice(0,4),[0,0,width,height]);
      // The default framebuffer is never a pass target on this route.
      assert.ok(calls('bindFramebuffer').every(event=>event.args[1]!==null));
    }
    assert.deepEqual(sizes,[],'Each drawing-buffer resize waits for the graphics process.');
    assert.ok(gpu.programs.has(28),'The last pass converts to straight alpha with the first image row first.');
  }finally{gpu.destroy();}
});

test('the canvas route keeps presenting on a drawing buffer of the surface size',t=>{
  const events=[],sizes=[];install(t,events,sizes);
  const gpu=new VfxGPU();
  try{
    const result=gpu.run({width:64,height:48},[blur()],{scale:1});
    assert.equal(result,gpu.canvas);assert.deepEqual(sizes,[['width',64],['height',48]]);
    assert.equal(events.filter(event=>event.method==='readPixels').length,0);
    assert.ok(!gpu.programs.has(28));
  }finally{gpu.destroy();}
});

test('small readbacks share one retained buffer; a large one is not kept between runs',t=>{
  const events=[],sizes=[];install(t,events,sizes);
  const gpu=new VfxGPU();
  try{
    const first=gpu.run({width:100,height:80},[blur()],{pixels:true}),buffer=first.pixels.buffer;
    assert.equal(gpu.run({width:90,height:60},[blur()],{pixels:true}).pixels.buffer,buffer);
    const large=gpu.run({width:2048,height:1024},[blur()],{pixels:true});
    assert.notEqual(large.pixels.buffer,buffer);assert.equal(large.pixels.length,2048*1024*4);
    assert.ok(gpu.readback.byteLength<=4*1024*1024,'Only a bounded buffer stays with the executor.');
    gpu.releasePixels();assert.equal(gpu.readback,null);
  }finally{gpu.destroy();}
});

test('effects painted for a destination in memory read pixels; other destinations keep the executor canvas',t=>{
  const events=[],sizes=[];install(t,events,sizes);
  const run=VfxGPU.prototype.run,requests=[];
  VfxGPU.prototype.run=function(source,stack,options){requests.push(options.pixels);return {width:source.width,height:source.height};};
  t.after(()=>{VfxGPU.prototype.run=run;});
  const destination=attributes=>{
    const context={canvas:{width:64,height:48},getContextAttributes:()=>attributes,getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),save(){},restore(){},setTransform(){},drawImage(){}};
    return context;
  };
  // The source surface of this fixture is the WebGL stand-in's canvas class.
  const sources=[];
  const Canvas=globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas=class extends Canvas{getContext(kind,options){if(kind==='webgl2')return super.getContext(kind);sources.push(options);return {setTransform(){},clearRect(){},canvas:this};}};
  t.after(()=>{globalThis.OffscreenCanvas=Canvas;});
  const bounds={x:8,y:8,width:20,height:16};
  withVfx(destination({willReadFrequently:true}),[blur()],()=>{},{bounds});
  withVfx(destination({willReadFrequently:false}),[blur()],()=>{},{bounds});
  withVfx(destination(undefined),[blur()],()=>{},{bounds});
  assert.deepEqual(requests,[true,false,false]);
  assert.deepEqual(sources,[{willReadFrequently:true},undefined,undefined],'The source follows the destination storage.');
});
