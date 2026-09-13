/** Saved camera motion is small, immutable and sampled by timeline time only.
 * No renderer state, random generator state, or per-tick pose allocation lives here. */
export const CAMERA_MOTION_LIMIT = 256;
export const CAMERA_MOTION_TYPES = Object.freeze({shake:'Shake',handheld:'Handheld',wobble:'Wobble',impact:'Impact punch',pulse:'Zoom pulse'});
const defaults = Object.freeze({strength:1,moveX:12,moveY:12,roll:1,zoom:0,frequency:8,roughness:.5,direction:0,recovery:5,phase:0,fadeIn:2,fadeOut:4,seed:1});
export const MOTION_PARAMETERS = Object.freeze({
  strength:['Strength',0,2,.01,'%'],moveX:['Move X',0,2000,.5,'px'],moveY:['Move Y',0,2000,.5,'px'],
  roll:['Roll',0,90,.1,'°'],zoom:['Zoom',-0.8,4,.01,'%'],frequency:['Speed',.05,60,.05,'Hz'],
  roughness:['Roughness',0,1,.01,'%'],direction:['Direction',-180,180,1,'°'],recovery:['Recovery',.1,20,.1,''],
  phase:['Phase',-360,360,1,'°'],fadeIn:['Fade in',0,100000,1,'frames'],fadeOut:['Fade out',0,100000,1,'frames'],seed:['Seed',0,2147483647,1,''],
});
export function createCameraMotion(type,id,start=0,duration=24) {
  if(!Object.hasOwn(CAMERA_MOTION_TYPES,type))throw new Error('Choose a camera motion preset.');
  const preset=type==='handheld'?{moveX:3,moveY:2,roll:.3,frequency:.7}:type==='wobble'?{moveX:5,moveY:2,roll:2,frequency:1.5}:type==='impact'?{moveX:18,moveY:18,roll:1.5,zoom:.04,fadeIn:0,fadeOut:0,frequency:6}:type==='pulse'?{moveX:0,moveY:0,roll:0,zoom:.08,fadeIn:0,fadeOut:0}:{};
  return {id,type,start,duration,enabled:true,params:{...defaults,...preset}};
}
export function validateCameraMotion(state) {
  if(state===undefined)return;
  if(!state||state.version!==1||!Array.isArray(state.clips)||state.clips.length>CAMERA_MOTION_LIMIT)throw new Error('Invalid camera motion table (maximum 256 clips).');
  const ids=new Set();
  for(const clip of state.clips){
    if(!clip||typeof clip.id!=='string'||!/^[\w-]{1,80}$/.test(clip.id)||ids.has(clip.id)||!Object.hasOwn(CAMERA_MOTION_TYPES,clip.type)||typeof clip.enabled!=='boolean'||!Number.isInteger(clip.start)||clip.start<0||!Number.isInteger(clip.duration)||clip.duration<1||clip.start+clip.duration>10000000)throw new Error('Invalid camera motion clip.');
    ids.add(clip.id);
    if(clip.mutedRanges!==undefined&&(!Array.isArray(clip.mutedRanges)||clip.mutedRanges.length>1024||clip.mutedRanges.some(r=>!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<=r.start)))throw new Error('Invalid baked camera range.');
    if(!clip.params||Object.keys(clip.params).some(key=>!Object.hasOwn(defaults,key)))throw new Error('Invalid camera motion parameters.');
    for(const [key,[label,min,max]] of Object.entries(MOTION_PARAMETERS)){
      const value=clip.params[key];if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||['seed','fadeIn','fadeOut'].includes(key)&&!Number.isInteger(value))throw new Error(`${label} must be between ${min} and ${max}.`);
    }
  }
}
const smooth=t=>t*t*(3-2*t);
function hash(n,seed){let x=(n|0)^seed;x=Math.imul(x^(x>>>16),0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);return ((x^(x>>>16))>>>0)/2147483647.5-1;}
function noise(t,seed){const i=Math.floor(t);return hash(i,seed)+(hash(i+1,seed)-hash(i,seed))*smooth(t-i);}
export function sampleCameraMotion(state,tick,fps=24) {
  let x=0,y=0,rotation=0,logZoom=0;
  for(const clip of state?.clips??[]){
    const age=tick-clip.start;if(!clip.enabled||age<0||age>=clip.duration||clip.mutedRanges?.some(r=>tick>=r.start&&tick<r.end))continue;
    const p=clip.params,u=age/clip.duration,time=age/fps,phase=p.phase*Math.PI/180;
    const envelope=p.strength*Math.min(p.fadeIn?smooth(Math.min(1,age/p.fadeIn)):1,p.fadeOut?smooth(Math.min(1,(clip.duration-age)/p.fadeOut)):1);
    let nx,ny,nr,nz;
    if(clip.type==='impact'){
      // The final smooth taper returns exactly to neutral at the boundary.
      const kick=Math.cos(time*p.frequency*2*Math.PI)*Math.exp(-p.recovery*u)*(1-smooth(u));
      nx=kick*Math.cos(p.direction*Math.PI/180);ny=kick*Math.sin(p.direction*Math.PI/180);nr=kick;nz=kick;
    }else if(clip.type==='pulse'){nx=ny=nr=0;nz=Math.sin(Math.PI*u)**2;}
    else if(clip.type==='wobble'){const a=time*p.frequency*2*Math.PI+phase;nx=Math.sin(a);ny=Math.sin(a+Math.PI/2);nr=Math.sin(a);nz=Math.sin(a);}
    else {const a=time*p.frequency+phase/(2*Math.PI),sample=seed=>(noise(a,seed)+p.roughness*.5*noise(a*2.17,seed+91))/(1+p.roughness*.5);nx=sample(p.seed);ny=sample(p.seed+17);nr=sample(p.seed+43);nz=sample(p.seed+71);}
    x+=envelope*p.moveX*nx;y+=envelope*p.moveY*ny;rotation+=envelope*p.roll*Math.PI/180*nr;
    logZoom+=envelope*Math.log1p(p.zoom)*nz;
  }
  return {x,y,rotation,zoom:Math.exp(Math.max(-8,Math.min(8,logZoom)))};
}
export function cameraAtTime(report,frame) {
  const base=frame?.camera;
  if(frame?._cameraMotionTick===undefined||!report?._styk?.cameraMotion?.clips.length)return base;
  const d=sampleCameraMotion(report._styk.cameraMotion,frame._cameraMotionTick,report.fps),c=base?.is_default?{}:base??{};
  if(!d.x&&!d.y&&!d.rotation&&d.zoom===1)return base;
  const scale=(c.scale??1)/d.zoom,angle=(c.angle_rad??0)+d.rotation;
  // Output pixel displacement is converted through the final inverse camera.
  return {...c,is_default:false,scale,x:(c.x??0)+scale*(Math.cos(angle)*d.x-Math.sin(angle)*d.y),y:(c.y??0)+scale*(Math.sin(angle)*d.x+Math.cos(angle)*d.y),angle_rad:angle};
}
export function frameWithCameraTime(report,frame,tick){return report._styk?.cameraMotion?.clips.length?{...frame,_cameraMotionTick:tick}:frame;}
