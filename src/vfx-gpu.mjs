import {activeVfx} from './vfx.mjs';
import {vfxPaint} from './vfx-paint.mjs';
import {vfxVertex as vertex,vfxFragment as fragment} from './vfx-shaders.mjs';
export class VfxGPU {
 constructor(){
  this.canvas=new OffscreenCanvas(1,1);const gl=this.gl=this.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});
  if(!gl)throw new Error('VFX require an available WebGL 2 graphics context.');
  this.compile=(type,code)=>{const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const reason=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(`VFX shader: ${reason}`);}return shader;};
  this.vertexShader=this.compile(gl.VERTEX_SHADER,vertex);this.programs=new Map();
  this.paintColors=new Float32Array(128);this.paintOffsets=new Float32Array(32);
  this.slots=[];this.framebuffer=gl.createFramebuffer();this.stats={passes:0,bytes:0,calls:0};
 }
 program(operation){
  if(!Number.isInteger(operation)||operation<0||operation>25)throw new RangeError('Unknown VFX graphics operation.');
  let entry=this.programs.get(operation);if(entry)return entry;
  const gl=this.gl,shader=this.compile(gl.FRAGMENT_SHADER,fragment.replace('uniform int operation,paintType,stopCount;',`const int operation=${operation}; uniform int paintType,stopCount;`)),program=gl.createProgram();gl.attachShader(program,this.vertexShader);gl.attachShader(program,shader);gl.linkProgram(program);gl.deleteShader(shader);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const reason=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw new Error(`VFX program: ${reason}`);}
  const uniforms=Object.fromEntries(['sourceImage','originalImage','maskImage','dimensions','origin','outputSize','p','q','paintType','paintAngle','stopCount','stops[0]','stopOffsets[0]'].map(name=>[name,gl.getUniformLocation(program,name)]));entry={program,uniforms};this.programs.set(operation,entry);return entry;
 }
 slot(index,width,height){
  const gl=this.gl;let slot=this.slots[index];if(!slot){const texture=gl.createTexture();slot={texture,width:0,height:0};this.slots[index]=slot;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
  gl.bindTexture(gl.TEXTURE_2D,slot.texture);if(slot.width!==width||slot.height!==height){slot.width=width;slot.height=height;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}return slot;
 }
 run(source,stack,{scale=1,origin={x:0,y:0},outputSize}={}){
  stack=activeVfx(stack);if(!stack.length)return source;
  const gl=this.gl,w=source.width,h=source.height;if(gl.isContextLost())throw new Error('The VFX graphics context was lost. Retry after reloading the document.');
  if(!w||!h||w*h>16777216||Math.max(w,h)>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error('The VFX surface exceeds the graphics budget. Reduce the render tile size.');
  if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
  gl.disable(gl.BLEND);gl.activeTexture(gl.TEXTURE0);const input=this.slot(0,w,h);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  this.stats.passes=0;let brushType=0,brushAngle=0,brushStops=1;
  let current=input;
  const pass=(operation,p=[0,0,0,0],q=[0,0,0,0],original=current,width=w,height=h,screen=false)=>{
    const {program,uniforms:u}=this.program(operation);gl.useProgram(program);
    gl.uniform1i(u.sourceImage,0);gl.uniform1i(u.originalImage,1);gl.uniform1i(u.maskImage,2);gl.uniform2f(u.origin,origin.x,origin.y);gl.uniform2f(u.outputSize,outputSize?.width??w,outputSize?.height??h);
    gl.uniform1i(u.paintType,brushType);gl.uniform1f(u.paintAngle,brushAngle);gl.uniform1i(u.stopCount,brushStops);gl.uniform4fv(u['stops[0]'],this.paintColors);gl.uniform1fv(u['stopOffsets[0]'],this.paintOffsets);
    const next=screen?null:this.slot([1,2,3].find(i=>this.slots[i]!==current&&this.slots[i]!==original),width,height);
    gl.bindFramebuffer(gl.FRAMEBUFFER,screen?null:this.framebuffer);if(next)gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,next.texture,0);
    gl.viewport(0,0,width,height);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,current.texture);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,original.texture);gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(u.dimensions,current.width,current.height);gl.uniform4fv(u.p,p);gl.uniform4fv(u.q,q);gl.drawArrays(gl.TRIANGLES,0,3);this.stats.passes++;if(next)current=next;
  };
  const blur=radius=>{if(radius<=0)return;const factor=Math.max(1,Math.ceil(radius/20)),ox=((origin.x%factor)+factor)%factor,oy=((origin.y%factor)+factor)%factor,bw=Math.max(1,Math.ceil((w+ox)/factor)),bh=Math.max(1,Math.ceil((h+oy)/factor));if(factor>1)pass(11,[factor,ox,oy,bh],undefined,current,bw,bh);const r=Math.min(128,Math.max(1,Math.round(radius/factor*.57735)));for(let i=0;i<3;i++){pass(3,[r,0,0,0],undefined,current,bw,bh);pass(4,[r,0,0,0],undefined,current,bw,bh);}if(factor>1)pass(12,[factor,ox,oy,h]);};
  const paint=value=>{const brush=vfxPaint(value);brushType=['solid','linear','radial','angular','diamond'].indexOf(brush.type);brushAngle=brush.angle*Math.PI/180;brushStops=brush.stops.length;brush.stops.forEach((s,i)=>{this.paintColors.set([...s.color.map(n=>n/255),s.opacity],i*4);this.paintOffsets[i]=s.offset;});};
  const save=(index=4)=>{const saved=this.slot(index,w,h);gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,current.texture,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,saved.texture);gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,w,h);return saved;};
  const morph=(radius,rounded=false)=>{radius=Math.ceil(radius);let step=1;while(radius>0){const amount=Math.min(rounded?step:128,radius);if(rounded)pass(14,[amount,0,0,0]);else{pass(5,[amount,0,0,0]);pass(6,[amount,0,0,0]);}radius-=amount;step*=2;}};
  for(const {type,params:p} of stack){
    if(p.color!==undefined)paint(p.color);
    if(type==='tint')pass(1,[p.mix,0,0,0]);
    else if(type==='grade')pass(2,[p.exposure,p.contrast,p.saturation,p.temperature],[p.tint,p.shadows,p.highlights,p.gamma]);
    else if(type==='blur'){if(!p.mode)blur(p.radius*scale);else pass(16,[p.radius*scale,p.mode,p.angle*Math.PI/180,0],[p.centerX,p.centerY,0,0]);}
    else if(type==='glow'||type==='shadow'){
      if(type==='glow'&&p.coreMix){paint(p.coreColor);pass(1,[p.coreMix,0,0,0]);paint(p.color);}
      for(const inner of p.mode===2?[true,false]:[p.mode===1]){const saved=save();if(inner)pass(13);morph(p.spread*scale,true);blur(p.radius*scale);pass(7,[p.intensity??p.opacity,p.falloff??1,Number(inner),p.blend??0],[(p.offsetX??0)*scale,(p.offsetY??0)*scale,0,0],saved);}
    }else if(type==='outline'){
      const saved=save(),width=p.width*scale*(p.mode===2?.5:1);
      if(p.mode===2){pass(13);morph(width,p.rounded);pass(15,[p.opacity,1,1,0],undefined,saved);const inner=save(5);current=saved;morph(width,p.rounded);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,inner.texture);gl.activeTexture(gl.TEXTURE0);pass(25,[p.opacity,p.only,0,0],undefined,saved);}
      else{if(p.mode===1)pass(13);morph(width,p.rounded);pass(15,[p.opacity,Number(p.mode===1),p.only,0],undefined,saved);}
    }else if(type==='pixelate')pass(8,[Math.max(1,p.size*scale),Math.max(1,(p.linked?p.size:p.sizeY)*scale),0,0],[p.offsetX*scale,p.offsetY*scale,0,0]);
    else if(type==='noise')pass(9,[p.amount,Math.max(1,p.size*scale),p.seed,Math.floor(p.phase*1024)],[p.colored,p.contrast,p.softness,p.pattern]);
    else if(type==='vignette')pass(10,[p.amount,p.softness,p.radius,0],[p.centerX,p.centerY,p.aspect,p.roundness]);
    else if(type==='dissolve')pass(17,[p.progress,p.size*scale,p.softness,p.seed],[p.edge,0,0,0]);
    else if(type==='rgbSplit')pass(18,[p.amount*scale,p.angle*Math.PI/180,0,0],[p.red,p.green,p.blue,0]);
    else if(type==='wave')pass(19,[p.strength*scale,p.wavelength*scale,p.angle*Math.PI/180,p.phase*Math.PI/180]);
    else if(type==='shockwave')pass(20,[p.radius*scale,p.thickness*scale,p.strength*scale,p.falloff],[p.centerX,p.centerY,0,0]);
    else if(type==='bloom'){const saved=save();pass(21,[p.threshold,p.softness,0,0]);blur(p.radius*scale);pass(22,[p.intensity,0,0,0],undefined,saved);}
    else if(type==='lightSweep')pass(23,[p.position,p.angle*Math.PI/180,p.width,p.softness],[p.intensity,0,0,0]);
    else if(type==='crt')pass(24,[p.amount,p.spacing*scale,p.curvature,p.chromatic*scale],[p.phase*scale,0,0,0]);
  }
  pass(0,undefined,undefined,current,w,h,true);gl.flush();this.stats.calls++;this.stats.bytes=(w*h+this.slots.reduce((n,s)=>n+s.width*s.height,0))*4;return this.canvas;
 }
 destroy(){for(const slot of this.slots)if(slot)this.gl.deleteTexture(slot.texture);this.slots=[];this.gl.deleteFramebuffer(this.framebuffer);for(const {program} of this.programs.values())this.gl.deleteProgram(program);this.programs.clear();this.gl.deleteShader(this.vertexShader);this.gl.getExtension('WEBGL_lose_context')?.loseContext();this.canvas.width=this.canvas.height=1;}
}
let executor,idleTimer,lastUse=0;
function releaseIdle(){const wait=30000-(performance.now()-lastUse);if(wait>0){idleTimer=setTimeout(releaseIdle,wait);return;}releaseVfxGPU();}
export function filterVfxCanvas(source,stack,options){if(!activeVfx(stack).length)return source;executor??=new VfxGPU();lastUse=performance.now();idleTimer??=setTimeout(releaseIdle,30000);return executor.run(source,stack,options);}
export function vfxGPUStats(){return executor?{...executor.stats}: {passes:0,bytes:0,calls:0};}
export function releaseVfxGPU(){clearTimeout(idleTimer);idleTimer=undefined;executor?.destroy();executor=null;}
