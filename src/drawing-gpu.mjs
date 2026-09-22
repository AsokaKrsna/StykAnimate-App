import {TILE,TILE_BYTES,tileKey,TileStore} from './drawing-tiles.mjs';
import {hasDrawableVfx} from './vfx-canvas.mjs';
import {compactTile,DrawingStroke} from './drawing-pixels.mjs';

/** WebGPU residency for sparse drawing cels and the GPU brush.
 *
 * The CPU TileStore stays the only authoritative raster. This module mirrors
 * the tiles a frame needs into one GPU storage pool of 64×64 straight-alpha
 * RGBA8 slots and draws them directly: no scratch canvas, preview worker or
 * image upload sits between an edit and the screen. Reduced levels are exact
 * GPU box reductions of the level below, computed the way drawing-raster.mjs
 * computes CPU mips. Slots are an LRU cache bounded by the pool size; a slot
 * used by the frame being encoded or pinned by a stroke is never reused.
 *
 * A GPU stroke rasterizes dabs from the shared CPU path code into private
 * overlay slots, which the display reads instead of the committed tiles until
 * the stroke's read-back pixels are committed through the normal editor
 * transaction. */
export const GPU_NONE=0xffffffff;
const UNRESOLVED=0xfffffffe;
const TEXELS=TILE*TILE,WORDS=24,MAX_LEVEL=8,UPLOADS_PER_FRAME=2048,MAX_DISPATCH=65535;

const DISPLAY_SHADER=/* wgsl */`
struct Globals { row0: vec4f, row1: vec4f, viewport: vec4f, clip: vec4f }
struct Tile { m0: vec4f, m1: vec4f, coord: vec4i, s0: vec4u, s1: vec4u, s2: vec4u }
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> transforms: array<vec4f>;
@group(1) @binding(0) var<storage, read> pool: array<u32>;
@group(1) @binding(1) var<storage, read> tiles: array<Tile>;
struct Out { @builtin(position) position: vec4f, @location(0) local: vec2f, @location(1) @interpolate(flat) index: u32 }
@vertex fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Out {
  let tile = tiles[index];
  var corners = array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let uv = corners[vertex];
  // Shared corners come from the same integer inputs, so neighbours are watertight.
  let q = (vec2f(tile.coord.xy) + uv) * tile.m1.z;
  let transform = transforms[u32(tile.coord.z)];
  let world = vec2f(tile.m0.x * q.x + tile.m0.z * q.y + tile.m1.x, tile.m0.y * q.x + tile.m0.w * q.y + tile.m1.y) + transform.xy;
  let screen = vec2f(dot(globals.row0.xyz, vec3f(world, 1)), dot(globals.row1.xyz, vec3f(world, 1)));
  var out: Out;
  out.position = vec4f(screen.x / globals.viewport.x * 2.0 - 1.0, 1.0 - screen.y / globals.viewport.y * 2.0, 0, 1);
  out.local = uv * 64.0;
  out.index = index;
  return out;
}
fn slotAt(tile: Tile, n: i32) -> u32 {
  if (n < 4) { return tile.s0[n]; }
  if (n < 8) { return tile.s1[n - 4]; }
  return tile.s2.x;
}
fn texel(tile: Tile, x: i32, y: i32) -> vec4f {
  let nx = select(select(1, 2, x >= 64), 0, x < 0);
  let ny = select(select(1, 2, y >= 64), 0, y < 0);
  let slot = slotAt(tile, ny * 3 + nx);
  if (slot == 0xffffffffu) { return vec4f(0); }
  let lx = u32(x - (nx - 1) * 64);
  let ly = u32(y - (ny - 1) * 64);
  let c = unpack4x8unorm(pool[slot * 4096u + ly * 64u + lx]);
  return vec4f(c.rgb * c.a, c.a);
}
@fragment fn fs(input: Out) -> @location(0) vec4f {
  let tile = tiles[input.index];
  let transform = transforms[u32(tile.coord.z)];
  let point = input.position.xy / globals.viewport.z;
  let center = (globals.clip.xy + globals.clip.zw) * 0.5;
  let angle = globals.row1.w;
  let delta = point - center;
  let screen = center + vec2f(cos(angle) * delta.x + sin(angle) * delta.y, -sin(angle) * delta.x + cos(angle) * delta.y);
  let outside = screen.x < globals.clip.x || screen.y < globals.clip.y || screen.x > globals.clip.z || screen.y > globals.clip.w;
  if (transform.w < 0.5 || (outside && globals.viewport.w > 0.5)) { discard; }
  // Premultiplied bilinear filtering across tile borders through the 3×3
  // neighbourhood, so tile seams never show at any zoom or rotation.
  let t = input.local - 0.5;
  let base = floor(t);
  let f = t - base;
  let i = vec2i(base);
  let c = mix(mix(texel(tile, i.x, i.y), texel(tile, i.x + 1, i.y), f.x), mix(texel(tile, i.x, i.y + 1), texel(tile, i.x + 1, i.y + 1), f.x), f.y);
  let alpha = tile.m1.w * transform.z;
  if (c.a * alpha <= 0.0) { discard; }
  return c * alpha;
}`;

// Exact integer form of drawing-raster.mjs downTile(): premultiplied 2×2 box,
// unpremultiplied with round-half-up.
const REDUCE_SHADER=/* wgsl */`
struct Params { count: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<storage, read_write> pool: array<u32>;
@group(0) @binding(1) var<storage, read> jobs: array<vec4u>;
@group(0) @binding(2) var<uniform> params: Params;
@compute @workgroup_size(256) fn reduce(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let index = wg.x + wg.y * ${MAX_DISPATCH}u;
  if (index >= params.count) { return; }
  let a = jobs[index * 2u];
  let b = jobs[index * 2u + 1u];
  var children = array<u32, 4>(a.y, a.z, a.w, b.x);
  for (var k = 0u; k < 16u; k++) {
    let q = li + k * 256u;
    let px = q % 64u;
    let py = q / 64u;
    let child = children[(py >> 5u) * 2u + (px >> 5u)];
    var out = 0u;
    if (child != 0xffffffffu) {
      var pa = 0u; var pr = 0u; var pg = 0u; var pb = 0u;
      for (var v = 0u; v < 2u; v++) {
        for (var u = 0u; u < 2u; u++) {
          let s = pool[child * 4096u + (2u * (py & 31u) + v) * 64u + 2u * (px & 31u) + u];
          let al = s >> 24u;
          pa += al; pr += (s & 255u) * al; pg += ((s >> 8u) & 255u) * al; pb += ((s >> 16u) & 255u) * al;
        }
      }
      if (pa > 0u) {
        out = ((2u * pr + pa) / (2u * pa)) | (((2u * pg + pa) / (2u * pa)) << 8u) | (((2u * pb + pa) / (2u * pa)) << 16u) | (((pa + 2u) / 4u) << 24u);
      }
    }
    pool[a.x * 4096u + q] = out;
  }
}`;

// Nonzero-alpha bounds per slot, matching drawing-tiles.mjs alphaBounds().
const BOUNDS_SHADER=/* wgsl */`
struct Params { count: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<storage, read> pool: array<u32>;
@group(0) @binding(1) var<storage, read> slots: array<u32>;
@group(0) @binding(2) var<storage, read_write> bounds: array<vec4u>;
@group(0) @binding(3) var<uniform> params: Params;
var<workgroup> low: array<atomic<u32>, 2>;
var<workgroup> high: array<atomic<u32>, 2>;
var<workgroup> found: atomic<u32>;
@compute @workgroup_size(256) fn alpha(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let index = wg.x + wg.y * ${MAX_DISPATCH}u;
  if (index >= params.count) { return; }
  if (li == 0u) { atomicStore(&low[0], 64u); atomicStore(&low[1], 64u); atomicStore(&high[0], 0u); atomicStore(&high[1], 0u); atomicStore(&found, 0u); }
  workgroupBarrier();
  let slot = slots[index];
  var lx = 64u; var ly = 64u; var hx = 0u; var hy = 0u; var any = false;
  for (var k = 0u; k < 16u; k++) {
    let q = li + k * 256u;
    if ((pool[slot * 4096u + q] >> 24u) != 0u) { let x = q % 64u; let y = q / 64u; lx = min(lx, x); ly = min(ly, y); hx = max(hx, x); hy = max(hy, y); any = true; }
  }
  if (any) { atomicMin(&low[0], lx); atomicMin(&low[1], ly); atomicMax(&high[0], hx); atomicMax(&high[1], hy); atomicStore(&found, 1u); }
  workgroupBarrier();
  if (li == 0u) {
    if (atomicLoad(&found) == 0u) { bounds[index] = vec4u(0xffffffffu); }
    else { bounds[index] = vec4u(atomicLoad(&low[0]), atomicLoad(&low[1]), atomicLoad(&high[0]), atomicLoad(&high[1])); }
  }
}`;

// The per-pixel brush of drawing-pixels.mjs DrawingStroke.dab(), evaluated
// per pixel over the ordered dabs touching each tile. Coverage accumulates in
// dab order exactly as the CPU loop does; only floating point width differs.
const STROKE_SHADER=/* wgsl */`
struct Params { color: vec4f, flow: f32, hardness: f32, texture: f32, erase: u32, seed: u32, originX: i32, originY: i32, count: u32 }
struct Job { tx: i32, ty: i32, before: u32, after: u32, coverage: u32, start: u32, count: u32, init: u32 }
@group(0) @binding(0) var<storage, read_write> pool: array<u32>;
@group(0) @binding(1) var<storage, read_write> coverage: array<f32>;
@group(0) @binding(2) var<storage, read> dabs: array<vec4f>;
@group(0) @binding(3) var<storage, read> jobs: array<Job>;
@group(0) @binding(4) var<storage, read> order: array<u32>;
@group(0) @binding(5) var<uniform> params: Params;
fn hashPixel(x: i32, y: i32, seed: u32) -> f32 {
  var h = (bitcast<u32>(x) * 374761393u) ^ (bitcast<u32>(y) * 668265263u) ^ (seed * 974711u);
  h = (h ^ (h >> 13u)) * 1274126177u;
  return f32(h ^ (h >> 16u)) / 4294967296.0;
}
@compute @workgroup_size(256) fn paint(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let index = wg.x + wg.y * ${MAX_DISPATCH}u;
  if (index >= params.count) { return; }
  let job = jobs[index];
  for (var k = 0u; k < 16u; k++) {
    let q = li + k * 256u;
    let ax = job.tx * 64 + i32(q % 64u);
    let ay = job.ty * 64 + i32(q / 64u);
    let fx = f32(ax - params.originX) + 0.5;
    let fy = f32(ay - params.originY) + 0.5;
    let ci = job.coverage * 4096u + q;
    var cov = 0.0;
    if (job.init == 0u) { cov = coverage[ci]; }
    var touched = false;
    for (var n = job.start; n < job.start + job.count; n++) {
      let dab = dabs[order[n]];
      let dx = fx - dab.x;
      let dy = fy - dab.y;
      let r = dab.z;
      let d2 = dx * dx + dy * dy;
      if (d2 >= r * r) { continue; }
      touched = true;
      let dist = sqrt(d2);
      var edge = 0.0;
      if (params.hardness >= 0.999) {
        if (d2 <= (r - 1.0) * (r - 1.0) && r >= 1.0) { edge = 1.0; } else { edge = clamp(r - dist, 0.0, 1.0); }
      } else {
        let t = clamp((1.0 - dist / r) / (1.0 - params.hardness), 0.0, 1.0);
        edge = t * t * (3.0 - 2.0 * t);
      }
      var grain = 1.0;
      if (params.texture > 0.0) { grain = 1.0 - params.texture * (1.0 - hashPixel(ax, ay, params.seed)); }
      cov = max(cov, cov + (dab.w - cov) * edge * params.flow * grain);
    }
    if (!touched && job.init == 0u) { continue; }
    coverage[ci] = cov;
    var before = 0u;
    if (job.before != 0xffffffffu) { before = pool[job.before * 4096u + q]; }
    let dst = job.after * 4096u + q;
    if (!touched) { pool[dst] = before; continue; }
    let ba = f32(before >> 24u) / 255.0;
    if (params.erase == 1u) {
      let a = min(255.0, floor(ba * (1.0 - cov) * 255.0 + 0.5));
      pool[dst] = (before & 0x00ffffffu) | (u32(a) << 24u);
      continue;
    }
    let o = cov + ba * (1.0 - cov);
    let a = min(255.0, floor(o * 255.0 + 0.5));
    var rgb = vec3f(0);
    if (o > 0.0) {
      let prior = vec3f(f32(before & 255u), f32((before >> 8u) & 255u), f32((before >> 16u) & 255u));
      rgb = min(vec3f(255.0), floor((params.color.rgb * cov + prior * ba * (1.0 - cov)) / o + 0.5));
    }
    pool[dst] = u32(rgb.x) | (u32(rgb.y) << 8u) | (u32(rgb.z) << 16u) | (u32(a) << 24u);
  }
}`;

/** Presenter entries the GPU path can display and paint: resident owner cels
 * without drawable effects. Transient selection previews keep their canvas
 * compositor. The renderer and the brush share this test. */
export function gpuDrawingEligible(presenter,item){
  return Boolean(presenter&&!presenter.transient&&presenter.owner&&(presenter.store||presenter.loading)&&item&&!hasDrawableVfx(item));
}
const workgroups=count=>[Math.min(count,MAX_DISPATCH),Math.ceil(count/MAX_DISPATCH)];
const levelKey=(k,tx,ty)=>`${k}|${tx},${ty}`;

/** Growable GPU buffer whose contents survive growth. */
class GrowableBuffer {
  constructor(device,label,usage){Object.assign(this,{device,label,usage,buffer:null,size:0,generation:0});}
  ensure(bytes,{preserve=false}={}){
    if(this.buffer&&this.size>=bytes)return false;
    let size=Math.max(256,this.size||256);while(size<bytes)size*=2;
    const next=this.device.createBuffer({label:this.label,size,usage:this.usage|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
    if(preserve&&this.buffer){const encoder=this.device.createCommandEncoder({label:`${this.label} growth`});encoder.copyBufferToBuffer(this.buffer,0,next,0,this.size);this.device.queue.submit([encoder.finish()]);}
    this.buffer?.destroy();this.buffer=next;this.size=size;this.generation++;return true;
  }
  destroy(){this.buffer?.destroy();this.buffer=null;this.size=0;}
}

export class DrawingGpu {
  constructor(renderer,{maxBytes=512*1024*1024,initialSlots=1024}={}){
    const device=renderer.device,limit=Math.min(device.limits.maxStorageBufferBindingSize,device.limits.maxBufferSize);
    Object.assign(this,{renderer,device,token:{},frame:0,capacity:0,free:[],lru:new Map(),tiles:new WeakMap(),states:new WeakMap(),sessions:new Set(),
      maxSlots:Math.max(64,Math.floor(Math.min(maxBytes,limit)/TILE_BYTES)),uploads:0,incomplete:false,reduce:Array.from({length:MAX_LEVEL+1},()=>[]),
      words:new Uint32Array(WORDS*256),instanceCount:0,stats:{slots:0,capacity:0,uploads:0,reductions:0,strokeDispatches:0,evictions:0}});
    this.floats=new Float32Array(this.words.buffer);this.ints=new Int32Array(this.words.buffer);
    this.pool=new GrowableBuffer(device,'Drawing tile pool',GPUBufferUsage.STORAGE);
    this.instances=new GrowableBuffer(device,'Drawing tile instances',GPUBufferUsage.STORAGE);
    this.jobBuffers=Array.from({length:MAX_LEVEL+1},(_,k)=>new GrowableBuffer(device,`Drawing level ${k} jobs`,GPUBufferUsage.STORAGE));
    this.reduceParams=Array.from({length:MAX_LEVEL+1},()=>device.createBuffer({label:'Drawing reduction parameters',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
    this.grow(Math.min(initialSlots,this.maxSlots));
    const display=device.createShaderModule({code:DISPLAY_SHADER,label:'Drawing tile display'});
    this.displayGlobals=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}]});
    this.displayTiles=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}]});
    this.displayModule=display;this.displayLayout=device.createPipelineLayout({bindGroupLayouts:[this.displayGlobals,this.displayTiles]});this.displayPipelines=new Map();
    this.reducePipeline=device.createComputePipeline({label:'Drawing level reduction',layout:'auto',compute:{module:device.createShaderModule({code:REDUCE_SHADER,label:'Drawing level reduction'}),entryPoint:'reduce'}});
    this.boundsPipeline=device.createComputePipeline({label:'Drawing alpha bounds',layout:'auto',compute:{module:device.createShaderModule({code:BOUNDS_SHADER,label:'Drawing alpha bounds'}),entryPoint:'alpha'}});
    this.strokePipeline=device.createComputePipeline({label:'Drawing brush',layout:'auto',compute:{module:device.createShaderModule({code:STROKE_SHADER,label:'Drawing brush'}),entryPoint:'paint'}});
  }
  get enabled(){return !this.destroyed;}
  grow(slots){
    slots=Math.min(this.maxSlots,slots);if(slots<=this.capacity)return false;
    this.pool.ensure(slots*TILE_BYTES,{preserve:true});
    // Growth rounds the buffer up; every byte of it is usable.
    const usable=Math.min(this.maxSlots,Math.floor(this.pool.size/TILE_BYTES));
    for(let slot=usable-1;slot>=this.capacity;slot--)this.free.push(slot);
    this.capacity=usable;this.stats.capacity=usable;return true;
  }
  displayPipeline(count){
    let pipeline=this.displayPipelines.get(count);
    if(!pipeline){
      const blend={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
      pipeline=this.device.createRenderPipeline({label:'Drawing tiles',layout:this.displayLayout,vertex:{module:this.displayModule,entryPoint:'vs'},fragment:{module:this.displayModule,entryPoint:'fs',targets:[{format:this.renderer.format,blend}]},primitive:{topology:'triangle-list'},multisample:{count}});
      this.displayPipelines.set(count,pipeline);
    }
    return pipeline;
  }
  /** Take a slot for `record`, reusing the least recently used slot that no
   * current frame or stroke depends on. Returns false when none is free. */
  allocate(record){
    let slot=this.free.pop();
    if(slot===undefined&&this.grow(this.capacity*2))slot=this.free.pop();
    if(slot===undefined)for(const owner of this.lru.values()){if(owner.used===this.frame)continue;this.evict(owner);slot=this.free.pop();break;}
    if(slot===undefined)return false;
    record.slot=slot;record.used=this.frame;if(!record.pinned)this.lru.set(slot,record);this.stats.slots=this.capacity-this.free.length;return true;
  }
  evict(record){if(record.slot==null||record.slot<0)return;this.lru.delete(record.slot);this.free.push(record.slot);record.slot=-1;record.onEvict?.();this.stats.evictions++;this.stats.slots=this.capacity-this.free.length;}
  touch(record){record.used=this.frame;if(record.pinned)return;this.lru.delete(record.slot);this.lru.set(record.slot,record);}
  pin(record){record.pinned=(record.pinned??0)+1;if(record.slot>=0)this.lru.delete(record.slot);}
  unpin(record){if(!record.pinned)return;record.pinned--;if(!record.pinned&&record.slot>=0)this.lru.set(record.slot,record);}
  /** Level-0 slot for a committed tile, uploaded when its version changed.
   * Copy-on-write forks share tile objects and therefore share slots. */
  tileSlot(tile,{force=false}={}){
    let record=this.tiles.get(tile);
    if(record?.slot>=0&&record.version===tile.version){this.touch(record);return record.slot;}
    if(!force&&this.uploads>=UPLOADS_PER_FRAME){this.incomplete=true;this.missing++;if(record?.slot>=0){this.touch(record);return record.slot;}return GPU_NONE;}
    if(!record){record={slot:-1,version:-1,kind:'tile'};this.tiles.set(tile,record);}
    if(record.slot<0&&!this.allocate(record)){this.incomplete=true;this.missing++;return GPU_NONE;}
    this.touch(record);this.device.queue.writeBuffer(this.pool.buffer,record.slot*TILE_BYTES,tile.pixels);
    record.version=tile.version;this.uploads++;this.stats.uploads++;return record.slot;
  }
  tileRecord(tile){return this.tiles.get(tile);}
  state(presenter){
    let state=this.states.get(presenter);
    if(!state){state={store:undefined,levels:new Map(),occupancy:[],overlay:null,overlayOccupancy:[],lastFrame:-1,retained:null};this.states.set(presenter,state);}
    const store=presenter.store;
    if(state.store!==store&&store){this.clearLevels(state);state.store=store;state.occupancy=[];store.changes(this.token).keys.clear();}
    else if(store){
      // Only reduced levels above tiles that actually changed go stale.
      const log=store.changes(this.token);
      if(log.overflow){this.clearLevels(state);log.overflow=false;}
      else if(log.keys.size){this.invalidateKeys(state,log.keys);log.keys.clear();}
    }
    return state;
  }
  clearLevels(state){for(const record of state.levels.values()){record.onEvict=null;if(record.slot>=0)this.evict(record);}state.levels.clear();}
  /** Mark the reduced ancestors of changed level-0 tile keys as stale. */
  invalidateKeys(state,keys){
    if(!state.levels.size)return;
    // Walk unique ancestors level by level; siblings share their parents.
    let parents=new Set();for(const key of keys){const [tx,ty]=key.split(',').map(Number);parents.add(tileKey(tx>>1,ty>>1));}
    for(let k=1;k<=MAX_LEVEL&&parents.size;k++){
      const next=new Set();
      for(const key of parents){const record=state.levels.get(`${k}|${key}`);if(record)record.valid=false;const [tx,ty]=key.split(',').map(Number);next.add(tileKey(tx>>1,ty>>1));}
      parents=next;
    }
  }
  /** Occupied tile keys at level k: committed tiles plus stroke overlay. */
  occupied(state,k){
    const store=state.store,revision=store?.revision??0;
    let entry=state.occupancy[k];
    if(!entry||entry.revision!==revision||entry.store!==store){
      let keys;
      if(k===0)keys=null;
      else{const below=k===1?null:this.occupied(state,k-1).keys;keys=new Set();
        if(below)for(const key of below){const [tx,ty]=key.split(',').map(Number);keys.add(tileKey(tx>>1,ty>>1));}
        else for(const tile of store??[])keys.add(tileKey(tile.tx>>1,tile.ty>>1));}
      entry=state.occupancy[k]={revision,store,keys};
    }
    return entry;
  }
  hasTile(state,k,tx,ty){
    if(k===0)return Boolean(state.store?.has(tx,ty)||state.overlay?.has(tileKey(tx,ty)));
    if(this.occupied(state,k).keys.has(tileKey(tx,ty)))return true;
    return Boolean(state.overlayOccupancy[k]?.has(tileKey(tx,ty)));
  }
  /** Slot holding level-k tile (tx,ty) for this frame, or GPU_NONE. Stale
   * content is drawn when the per-frame upload budget runs out. */
  resolve(state,k,tx,ty,memo){
    const key=levelKey(k,tx,ty);if(memo.has(key))return memo.get(key);
    let slot=GPU_NONE;
    if(k===0){
      const overlay=state.overlay?.get(tileKey(tx,ty));
      if(overlay){this.touch(overlay);slot=overlay.slot;}
      else{const tile=state.store?.get(tx,ty);if(tile)slot=this.tileSlot(tile);}
    }else if(this.hasTile(state,k,tx,ty)){
      let record=state.levels.get(key);
      if(record?.slot>=0&&record.valid)this.touch(record);
      else{
        const missing=this.missing;
        const children=[this.resolve(state,k-1,2*tx,2*ty,memo),this.resolve(state,k-1,2*tx+1,2*ty,memo),this.resolve(state,k-1,2*tx,2*ty+1,memo),this.resolve(state,k-1,2*tx+1,2*ty+1,memo)];
        const complete=this.missing===missing;
        if(!record){record={slot:-1,valid:false,kind:'level'};record.onEvict=()=>state.levels.delete(key);state.levels.set(key,record);}
        // Incomplete children leave an older reduction on screen and retry
        // next frame; a first reduction still shows what is available.
        if(!complete&&record.slot>=0){this.touch(record);this.missing++;memo.set(key,record.slot);return record.slot;}
        if(record.slot<0&&!this.allocate(record)){this.incomplete=true;this.missing++;memo.set(key,GPU_NONE);return GPU_NONE;}
        this.touch(record);this.reduce[k].push(record.slot,...children);record.valid=complete;if(!complete)this.missing++;this.stats.reductions++;
      }
      slot=record.slot;
    }
    memo.set(key,slot);return slot;
  }
  beginFrame(){
    this.frame++;this.uploads=0;this.missing=0;this.incomplete=false;this.instanceCount=0;for(const jobs of this.reduce)jobs.length=0;
    for(const session of this.sessions)session.plan();
  }
  /** Build tile instances for one displayed cel. `view` carries the cel's
   * pixel→world matrix relative to its root, transform slot, alpha, visible
   * level-0 pixel rect and display level. */
  prepare(presenter,view){
    const state=this.state(presenter);state.lastFrame=this.frame;
    if(!presenter.store){
      // An evicted store re-decodes; keep drawing the last resident tiles.
      const retained=state.retained;if(!retained)return null;
      if(retained.records.some(record=>record.slot<0))return null;
      for(const record of retained.records)this.touch(record);
      return this.appendInstances(retained.words);
    }
    const {matrix,level,transform,alpha}=view,rect=intersect(view.rect,unionRect(presenter.store.bounds,state.overlay?state.overlayRect:null));
    if(!rect){state.retained=null;return null;}
    const span=TILE<<level,tx0=Math.floor(rect.x/span)-1,ty0=Math.floor(rect.y/span)-1,tx1=Math.floor((rect.x+rect.width-1)/span)+1,ty1=Math.floor((rect.y+rect.height-1)/span)+1;
    // Tile coordinates relative to the first visible tile keep f32 small.
    const baseX=tx0*span,baseY=ty0*span,m=[matrix[0],matrix[1],matrix[2],matrix[3],matrix[4]+matrix[0]*baseX+matrix[2]*baseY,matrix[5]+matrix[1]*baseX+matrix[3]*baseY];
    const candidates=[],width=tx1-tx0+1,height=ty1-ty0+1;
    if(level===0&&!state.overlay&&state.store.size<width*height){for(const tile of state.store)if(tile.tx>=tx0&&tile.tx<=tx1&&tile.ty>=ty0&&tile.ty<=ty1)candidates.push([tile.tx,tile.ty]);}
    else for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++)if(this.hasTile(state,level,tx,ty))candidates.push([tx,ty]);
    // Include transparent neighbours so bilinear filtering fades past the
    // artwork's last tile instead of stopping at a tile edge.
    const gw=width+2,gh=height+2,grid=gw*gh<=262144?new Uint32Array(gw*gh).fill(UNRESOLVED):null,memo=new Map();
    const slotAt=(x,y)=>{
      if(!grid)return this.resolve(state,level,x,y,memo);
      const i=(y-ty0+1)*gw+(x-tx0+1);let slot=grid[i];
      if(slot===UNRESOLVED)slot=grid[i]=this.resolve(state,level,x,y,memo);
      return slot;
    };
    // Every occupied tile and its transparent neighbours inside the window.
    const drawn=grid?new Uint8Array(gw*gh):new Set();
    for(const [tx,ty] of candidates)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=tx+dx,y=ty+dy;if(x<tx0||x>tx1||y<ty0||y>ty1)continue;if(grid)drawn[(y-ty0+1)*gw+(x-tx0+1)]=1;else drawn.add(tileKey(x,y));}
    const cells=[];
    if(grid){for(let y=ty0;y<=ty1;y++)for(let x=tx0;x<=tx1;x++)if(drawn[(y-ty0+1)*gw+(x-tx0+1)])cells.push(x,y);}
    else for(const key of drawn){const [x,y]=key.split(',').map(Number);cells.push(x,y);}
    const words=new Uint32Array(cells.length/2*WORDS),floats=new Float32Array(words.buffer),ints=new Int32Array(words.buffer),records=new Set(),slots=new Uint32Array(9);let n=0;
    for(let c=0;c<cells.length;c+=2){
      const tx=cells[c],ty=cells[c+1];let any=false;
      for(let dy=-1,s=0;dy<=1;dy++)for(let dx=-1;dx<=1;dx++,s++){const slot=slotAt(tx+dx,ty+dy);slots[s]=slot;if(slot!==GPU_NONE)any=true;}
      if(!any)continue;
      const o=n*WORDS;n++;
      floats[o]=m[0];floats[o+1]=m[1];floats[o+2]=m[2];floats[o+3]=m[3];floats[o+4]=m[4];floats[o+5]=m[5];floats[o+6]=span;floats[o+7]=alpha;
      ints[o+8]=tx-tx0;ints[o+9]=ty-ty0;ints[o+10]=transform;ints[o+11]=0;
      words.set(slots,o+12);words[o+21]=words[o+22]=words[o+23]=0;
      for(const slot of slots)if(slot!==GPU_NONE){const record=this.lru.get(slot);if(record)records.add(record);}
    }
    const used=words.subarray(0,n*WORDS);
    state.retained={words:used,records:[...records]};
    return this.appendInstances(used);
  }
  appendInstances(words){
    if(!words.length)return null;
    const first=this.instanceCount,count=words.length/WORDS;
    if((first+count)*WORDS>this.words.length){const next=new Uint32Array(Math.max((first+count)*WORDS,this.words.length*2));next.set(this.words);this.words=next;this.floats=new Float32Array(next.buffer);this.ints=new Int32Array(next.buffer);}
    this.words.set(words,first*WORDS);this.instanceCount+=count;return {first,count};
  }
  displayed(presenter){return this.states.get(presenter)?.lastFrame>=this.frame-1;}
  /** Record all GPU work that must precede this frame's render pass. */
  encode(encoder){
    for(const session of this.sessions)session.encode(encoder);
    const levels=[];for(let k=1;k<=MAX_LEVEL;k++)if(this.reduce[k].length)levels.push(k);
    if(levels.length){
      const pass=encoder.beginComputePass({label:'Drawing level reductions'});pass.setPipeline(this.reducePipeline);
      for(const k of levels){
        const jobs=this.reduce[k],count=jobs.length/5,data=new Uint32Array(count*8);
        for(let i=0;i<count;i++)data.set(jobs.slice(i*5,i*5+5),i*8);
        const buffer=this.jobBuffers[k];buffer.ensure(data.byteLength);this.device.queue.writeBuffer(buffer.buffer,0,data);
        this.device.queue.writeBuffer(this.reduceParams[k],0,new Uint32Array([count,0,0,0]));
        pass.setBindGroup(0,this.device.createBindGroup({layout:this.reducePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.pool.buffer}},{binding:1,resource:{buffer:buffer.buffer,size:data.byteLength}},{binding:2,resource:{buffer:this.reduceParams[k]}}]}));
        pass.dispatchWorkgroups(...workgroups(count));
      }
      pass.end();
    }
    if(this.instanceCount){
      const bytes=this.instanceCount*WORDS*4;
      if(this.instances.ensure(bytes))this.tileBindGroup=null;
      this.device.queue.writeBuffer(this.instances.buffer,0,this.words,0,this.instanceCount*WORDS);
    }
    if(this.incomplete)queueMicrotask(()=>this.renderer.options.onInvalidate?.());
  }
  draw(pass,{first,count}){
    const r=this.renderer;
    if(this.globalsKey!==r.transformBuffer){this.globalsKey=r.transformBuffer;this.globalsBindGroup=this.device.createBindGroup({layout:this.displayGlobals,entries:[{binding:0,resource:{buffer:r.uniform}},{binding:1,resource:{buffer:r.transformBuffer}}]});}
    if(!this.tileBindGroup||this.tileBindGroupPool!==this.pool.buffer){this.tileBindGroupPool=this.pool.buffer;this.tileBindGroup=this.device.createBindGroup({layout:this.displayTiles,entries:[{binding:0,resource:{buffer:this.pool.buffer}},{binding:1,resource:{buffer:this.instances.buffer}}]});}
    pass.setPipeline(this.displayPipeline(r.msaaCount));pass.setBindGroup(0,this.globalsBindGroup);pass.setBindGroup(1,this.tileBindGroup);pass.draw(6,count,0,first);
  }
  get bytes(){return this.pool.size+this.instances.size;}
  destroy(){
    this.destroyed=true;for(const session of this.sessions)session.fail(new Error('The graphics device closed during the stroke.'));this.sessions.clear();
    this.pool.destroy();this.instances.destroy();for(const buffer of this.jobBuffers)buffer.destroy();for(const buffer of this.reduceParams)buffer.destroy();
    this.lru.clear();this.free=[];
  }
}

/** Paints one stroke on the GPU. Dabs come from the shared CPU path code, so
 * spacing, smoothing, pressure and jitter match the CPU brush exactly. */
export class GpuStroke {
  constructor(gpu,presenter,{size,color,opacity,flow,hardness,erase,texture,seed,workingBytes=768*1024*1024}){
    Object.assign(this,{gpu,presenter,device:gpu.device,state:gpu.state(presenter),params:{color,flow,hardness,erase:Boolean(erase),texture,seed:seed>>>0},workingBytes,
      tiles:new Map(),pending:[],origin:null,coverageCount:0,closed:false,failed:null,planned:null});
    this.state.overlay=new Map();this.state.overlayOccupancy=[];this.state.overlayRect=null;
    this.coverage=new GrowableBuffer(this.device,'Drawing brush coverage',GPUBufferUsage.STORAGE);
    this.dabBuffer=new GrowableBuffer(this.device,'Drawing brush dabs',GPUBufferUsage.STORAGE);
    this.jobBuffer=new GrowableBuffer(this.device,'Drawing brush jobs',GPUBufferUsage.STORAGE);
    this.orderBuffer=new GrowableBuffer(this.device,'Drawing brush order',GPUBufferUsage.STORAGE);
    this.paramBuffer=this.device.createBuffer({label:'Drawing brush parameters',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    gpu.sessions.add(this);
  }
  /** Queue dabs {x,y,radius,opacity} in cel pixel space. */
  add(dabs){if(this.closed)throw new Error('The stroke has already ended.');if(this.failed)throw this.failed;for(const dab of dabs)this.pending.push(dab);}
  /** Convert queued dabs into per-tile jobs and claim their slots. Runs on
   * the UI thread per frame; the work is proportional to touched tiles. */
  plan(){
    if(!this.pending.length||this.failed||this.planned)return;
    const dabs=this.pending;this.pending=[];
    this.origin??={x:Math.floor(dabs[0].x),y:Math.floor(dabs[0].y)};
    const lists=new Map(),order=[];
    try{
      dabs.forEach((dab,index)=>{
        const r=dab.radius,left=Math.floor(dab.x-r),top=Math.floor(dab.y-r),right=Math.ceil(dab.x+r),bottom=Math.ceil(dab.y+r);
        for(let ty=Math.floor(top/TILE);ty*TILE<bottom;ty++)for(let tx=Math.floor(left/TILE);tx*TILE<right;tx++){
          const key=tileKey(tx,ty);let list=lists.get(key);if(!list){list=[];lists.set(key,list);this.tile(tx,ty,key);}list.push(index);
        }
      });
    }catch(error){this.fail(error);return;}
    const jobs=new Int32Array(lists.size*8),words=new Uint32Array(jobs.buffer);let i=0;
    for(const [key,list] of lists){
      const tile=this.tiles.get(key),o=i*8;
      jobs[o]=tile.tx;jobs[o+1]=tile.ty;words[o+2]=tile.before?.slot>=0?tile.before.slot:GPU_NONE;words[o+3]=tile.after.slot;words[o+4]=tile.coverage;
      words[o+5]=order.length;words[o+6]=list.length;words[o+7]=tile.initialized?0:1;tile.initialized=true;
      for(const index of list)order.push(index);i++;
    }
    const dabData=new Float32Array(dabs.length*4);
    dabs.forEach((dab,index)=>dabData.set([dab.x-this.origin.x,dab.y-this.origin.y,dab.radius,dab.opacity],index*4));
    this.planned={count:lists.size,jobs,dabData,order:new Uint32Array(order)};
    // Reduced display levels over the touched tiles are now stale.
    this.gpu.invalidateKeys(this.state,lists.keys());
  }
  tile(tx,ty,key){
    let tile=this.tiles.get(key);if(tile)return tile;
    if((this.tiles.size+1)*TILE_BYTES*5>this.workingBytes)throw new Error('The stroke exceeds the drawing working memory limit.');
    const source=this.presenter.store?.get(tx,ty)??null,gpu=this.gpu;
    let before=null;
    if(source){gpu.tileSlot(source,{force:true});before=gpu.tileRecord(source);if(!(before?.slot>=0))throw new Error('Drawing graphics memory is full. Finish the stroke or reduce the drawing size.');gpu.pin(before);}
    const after={slot:-1,kind:'stroke'};gpu.pin(after);
    if(!gpu.allocate(after)){if(before)gpu.unpin(before);throw new Error('Drawing graphics memory is full. Finish the stroke or reduce the drawing size.');}
    tile={tx,ty,before,after,source,coverage:this.coverageCount++,initialized:false};this.tiles.set(key,tile);
    this.coverage.ensure(this.coverageCount*TILE_BYTES,{preserve:true});
    this.state.overlay.set(key,after);this.state.overlayRect=unionRect(this.state.overlayRect,{x:tx*TILE,y:ty*TILE,width:TILE,height:TILE});
    for(let k=1;k<=MAX_LEVEL;k++)(this.state.overlayOccupancy[k]??=new Set()).add(tileKey(tx>>k,ty>>k));
    return tile;
  }
  encode(encoder){
    const planned=this.planned;if(!planned)return;this.planned=null;
    const {count,jobs,dabData,order}=planned,queue=this.device.queue;
    const growth=[this.dabBuffer.ensure(dabData.byteLength),this.jobBuffer.ensure(jobs.byteLength),this.orderBuffer.ensure(Math.max(4,order.byteLength))];
    if(growth.some(Boolean))this.bindGroup=null;
    queue.writeBuffer(this.dabBuffer.buffer,0,dabData);queue.writeBuffer(this.jobBuffer.buffer,0,jobs);if(order.length)queue.writeBuffer(this.orderBuffer.buffer,0,order);
    const p=this.params,params=new ArrayBuffer(48),f=new Float32Array(params),u=new Uint32Array(params),s=new Int32Array(params);
    f.set([p.color[0],p.color[1],p.color[2],0,p.flow,p.hardness,p.texture]);u[7]=p.erase?1:0;u[8]=p.seed;s[9]=this.origin.x;s[10]=this.origin.y;u[11]=count;
    queue.writeBuffer(this.paramBuffer,0,params);
    const key=`${this.gpu.pool.generation}|${this.coverage.generation}|${this.dabBuffer.generation}|${this.jobBuffer.generation}|${this.orderBuffer.generation}`;
    if(!this.bindGroup||this.bindGroupKey!==key){this.bindGroupKey=key;this.bindGroup=this.device.createBindGroup({layout:this.gpu.strokePipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:this.gpu.pool.buffer}},{binding:1,resource:{buffer:this.coverage.buffer}},{binding:2,resource:{buffer:this.dabBuffer.buffer}},
      {binding:3,resource:{buffer:this.jobBuffer.buffer}},{binding:4,resource:{buffer:this.orderBuffer.buffer}},{binding:5,resource:{buffer:this.paramBuffer}}]});}
    const pass=encoder.beginComputePass({label:'Drawing brush dabs'});pass.setPipeline(this.gpu.strokePipeline);pass.setBindGroup(0,this.bindGroup);pass.dispatchWorkgroups(...workgroups(count));pass.end();
    this.gpu.stats.strokeDispatches++;
  }
  /** Flush remaining dabs and read back every touched tile. Resolves to
   * tile-change records in the DrawingStroke.finish() format. */
  async finish(){
    if(this.failed)throw this.failed;
    this.closed=true;
    do{this.plan();if(this.failed)throw this.failed;if(!this.planned)break;const batch=this.device.createCommandEncoder({label:'Drawing brush dabs'});this.encode(batch);this.device.queue.submit([batch.finish()]);}while(this.pending.length);
    const tiles=[...this.tiles.values()],count=tiles.length,device=this.device;
    if(!count){this.readBack=true;return {changes:[],tiles:[]};}
    const pixelBytes=count*TILE_BYTES,slots=new Uint32Array(tiles.map(tile=>tile.after.slot));
    const slotBuffer=device.createBuffer({label:'Drawing read-back slots',size:Math.max(16,slots.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    const boundsBuffer=device.createBuffer({label:'Drawing alpha bounds',size:count*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const params=device.createBuffer({label:'Drawing alpha bounds parameters',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const readback=device.createBuffer({label:'Drawing brush read-back',size:pixelBytes+count*16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    try{
      device.queue.writeBuffer(slotBuffer,0,slots);device.queue.writeBuffer(params,0,new Uint32Array([count,0,0,0]));
      const encoder=device.createCommandEncoder({label:'Drawing brush completion'}),pass=encoder.beginComputePass({label:'Drawing alpha bounds'});
      pass.setPipeline(this.gpu.boundsPipeline);
      pass.setBindGroup(0,device.createBindGroup({layout:this.gpu.boundsPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.gpu.pool.buffer}},{binding:1,resource:{buffer:slotBuffer}},{binding:2,resource:{buffer:boundsBuffer}},{binding:3,resource:{buffer:params}}]}));
      pass.dispatchWorkgroups(...workgroups(count));pass.end();
      tiles.forEach((tile,i)=>encoder.copyBufferToBuffer(this.gpu.pool.buffer,tile.after.slot*TILE_BYTES,readback,i*TILE_BYTES,TILE_BYTES));
      encoder.copyBufferToBuffer(boundsBuffer,0,readback,pixelBytes,count*16);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const mapped=readback.getMappedRange(),bounds=new Uint32Array(mapped,pixelBytes,count*4),changes=[],prepared=[];
      let slice=performance.now();
      for(let i=0;i<count;i++){
        // Long read-backs yield in 8 ms slices so input and rendering keep running.
        if(performance.now()-slice>8){await yieldToInput();slice=performance.now();}
        if(this.failed)throw this.failed;if(this.released)throw new DOMException('Stroke released.','AbortError');
        const tile=tiles[i],view=new Uint8ClampedArray(mapped,i*TILE_BYTES,TILE_BYTES),before=tile.source?.pixels??null;
        if(before&&sameBytes(before,view))continue;
        const after=view.slice(),afterSide=normalizeSide(compactTile(after)),beforeSide=normalizeSide(compactTile(before));
        if(beforeSide===null&&afterSide===null)continue;
        const b=bounds.subarray(i*4,i*4+4),visible=b[0]!==GPU_NONE;
        changes.push({tx:tile.tx,ty:tile.ty,before:beforeSide,after:afterSide});
        // History and the committed store never share a mutable buffer.
        prepared.push({tx:tile.tx,ty:tile.ty,pixels:visible?(afterSide===after?after.slice():after):null,alphaBounds:visible?{x:b[0],y:b[1],width:b[2]-b[0]+1,height:b[3]-b[1]+1}:null});
      }
      readback.unmap();this.readBack=true;return {changes,tiles:prepared};
    }finally{readback.destroy();slotBuffer.destroy();boundsBuffer.destroy();params.destroy();}
  }
  fail(error){if(this.failed)return;this.failed=error;}
  /** Stop displaying the overlay. After a successful commit, tiles that the
   * commit replaced adopt the overlay slot that already holds their bytes;
   * every other overlay slot returns to the pool. */
  release({committed=false}={}){
    if(this.released)return;this.released=true;this.closed=true;this.pending=[];this.planned=null;
    const gpu=this.gpu,store=this.presenter.store;gpu.sessions.delete(this);
    for(const tile of this.tiles.values()){
      const current=committed&&this.readBack?store?.get(tile.tx,tile.ty):null;
      gpu.unpin(tile.after);
      if(current&&current!==tile.source&&tile.after.slot>=0&&!gpu.tiles.has(current)){Object.assign(tile.after,{kind:'tile',version:current.version});gpu.tiles.set(current,tile.after);gpu.touch(tile.after);}
      else if(tile.after.slot>=0)gpu.evict(tile.after);
      if(tile.before)gpu.unpin(tile.before);
    }
    if(this.state.overlay){this.state.overlay=null;this.state.overlayOccupancy=[];}
    // Every tile's reduced ancestors must rebuild from committed pixels.
    gpu.invalidateKeys(this.state,this.tiles.keys());
    this.coverage.destroy();this.dabBuffer.destroy();this.jobBuffer.destroy();this.orderBuffer.destroy();this.paramBuffer.destroy();this.tiles.clear();
  }
}
/** Records the dabs DrawingStroke would rasterize: the same smoothing, curve
 * sampling, spacing and jitter code runs; only per-pixel work moves to the GPU. */
export class DabRecorder extends DrawingStroke {
  constructor(settings){super(new TileStore(),settings);this.dabs=[];}
  dab(p){this.dabs.push(this.dabShape(p));this.lastDab={x:p.x,y:p.y};}
  take(){const dabs=this.dabs;this.dabs=[];return dabs;}
}
function sameBytes(a,b){if(a.length!==b.length)return false;const x=new Uint32Array(a.buffer,a.byteOffset,a.length>>2),y=new Uint32Array(b.buffer,b.byteOffset,b.length>>2);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;return true;}
const normalizeSide=v=>v&&v.byteLength===4&&v[3]===0?null:v;
const yieldToInput=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,0));
function unionRect(a,b){if(!a)return b?{...b}:null;if(!b)return{...a};const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return{x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};}
function intersect(a,b){if(!a||!b)return null;const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),width=Math.min(a.x+a.width,b.x+b.width)-x,height=Math.min(a.y+a.height,b.y+b.height)-y;return width>0&&height>0?{x,y,width,height}:null;}
