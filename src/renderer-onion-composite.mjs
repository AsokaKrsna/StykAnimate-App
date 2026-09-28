const shader = `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<storage, read> opacities: array<f32>;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) opacity: f32 };
@vertex fn vertex(@builtin(vertex_index) i:u32, @builtin(instance_index) frame:u32)->Out {
  let p=vec2f(f32((i<<1u)&2u),f32(i&2u));
  return Out(vec4f(p*2.-1.,0.,1.),vec2f(p.x,1.-p.y),opacities[frame]);
}
@fragment fn fragment(v:Out)->@location(0) vec4f {
  return textureSampleLevel(source,sourceSampler,v.uv,0.)*v.opacity;
}`;

/** One reusable viewport surface, regardless of ghost count or scene bounds.
 * Existing retained vectors/textures paint at their own opacity; only the
 * completed frame receives the onion opacity. No readback or pose snapshots. */
export class OnionComposite {
  constructor(renderer) { this.renderer = renderer; }
  prepare() {
    const r = this.renderer, d = r.device, w = r.canvas.width, h = r.canvas.height;
    if (this.samples !== r.msaaCount) {
      this.destroy(); this.samples = r.msaaCount;
      const module = d.createShaderModule({code: shader, label: 'Onion frame opacity'});
      this.pipeline = d.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: 'vertex'},
        fragment: {module, entryPoint: 'fragment', targets: [{format: r.format, blend: {
          color: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'},
          alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'},
        }}]}, multisample: {count: r.msaaCount}});
    }
    const count = Math.max(1, r.onionScenes.length);
    if (this.width !== w || this.height !== h) {
      this.texture?.destroy(); this.msaa?.destroy();
      this.width = w; this.height = h;
      this.texture = d.createTexture({label: 'Onion frame', size: [w,h], format: r.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING});
      this.msaa = r.createMsaaTexture(w,h);
      this.bindGroup = null;
    }
    if (this.count !== count) {
      this.opacityBuffer?.destroy(); this.count = count;
      this.opacityBuffer = d.createBuffer({size: count*4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
      this.bindGroup = null;
    }
    d.queue.writeBuffer(this.opacityBuffer, 0, Float32Array.from(r.onionScenes, frame => frame.opacity ?? .14));
    this.bindGroup ??= d.createBindGroup({layout: this.pipeline.getBindGroupLayout(0), entries: [
      {binding: 0, resource: this.texture.createView()}, {binding: 1, resource: r.sampler},
      {binding: 2, resource: {buffer: this.opacityBuffer}},
    ]});
    r.stats.onionCompositeBytes = w*h*4*(1+r.msaaCount*(this.msaa?1:0))+count*4;
  }
  draw(encoder, destination, pass, entries, start, end, timestampWrites) {
    const r = this.renderer;
    pass.end();
    const view = this.texture.createView();
    const ghost = encoder.beginRenderPass({colorAttachments: [{view: this.msaa?.createView() ?? view,
      ...(this.msaa ? {resolveTarget: view} : {}), clearValue: {r:0,g:0,b:0,a:0}, loadOp: 'clear', storeOp: this.msaa ? 'discard' : 'store'}]});
    ghost.setPipeline(r.pipeline); ghost.setBindGroup(0,r.globalBindGroup);
    let begin=-1,count=0,calls=0;
    const flush=()=>{if(!count)return;ghost.setBindGroup(1,r.blankBindGroup);ghost.draw(6,count,0,begin);calls++;begin=-1;count=0;};
    for (let i=start;i<end;i++) {
      const entry=entries[i];
      if(entry.texture){flush();ghost.setBindGroup(1,entry.texture.bindGroup);ghost.draw(6,entry.count,0,entry.offset);calls++;}
      else{if(begin<0)begin=entry.offset;count+=entry.capacity;}
    }
    flush();
    ghost.end();
    pass = encoder.beginRenderPass({colorAttachments: [{...r.colorAttachment(destination), loadOp: 'load', storeOp: 'store'}], ...(timestampWrites?{timestampWrites}:{})});
    pass.setPipeline(this.pipeline); pass.setBindGroup(0,this.bindGroup);
    pass.draw(3,1,0,entries[start].onionIndex);
    pass.setPipeline(r.pipeline); pass.setBindGroup(0,r.globalBindGroup);
    return {pass,calls:calls+1};
  }
  destroy() {
    this.texture?.destroy(); this.msaa?.destroy(); this.opacityBuffer?.destroy();
    this.texture = this.msaa = this.opacityBuffer = this.bindGroup = this.pipeline = null;
    this.width = this.height = this.count = this.samples = 0;
  }
}
