/** Spatial articulation in the native rig dependency graph. Rotation still uses
 * ordinary angle channels; depth is derived, never a separate animated scene. */
const EPS=1e-9;
export const spatialBone=s=>Boolean(s?._stykRig?.spatial?.origin);
export const spatialSkin=s=>Boolean(s?._stykRig?.spatial?.bindings);
export const hasSpatialRig=figure=>Boolean(figure?.segments.some(s=>s._stykRig?.spatial));
const sameVector=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===3&&b.length===3&&a.every((v,i)=>v===b[i]);
export function sameSpatial(a,b){
  if(a===b)return true;if(!a||!b)return false;
  if(a.bindings||b.bindings)return Boolean(Array.isArray(a.bindings)&&Array.isArray(b.bindings)&&a.bindings.length===b.bindings.length&&sameVector(a.point,b.point)&&a.bindings.every((v,i)=>v?.joint===b.bindings[i]?.joint&&v?.weight===b.bindings[i]?.weight));
  return a.parent===b.parent&&a.turn===b.turn&&a.pitch===b.pitch&&sameVector(a.origin,b.origin)&&sameVector(a.tip,b.tip);
}
export function validateSpatial(s,reference,dependencies,segments,ids){
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6);
  if(!s||typeof s!=='object'||Array.isArray(s))throw new Error('Invalid spatial joint.');
  const ref=(id,label,bone=false)=>{reference(id,label,true);dependencies.add(id);if(id&&bone&&!spatialBone(segments[ids.get(id)]))throw new Error(`${label} must be an articulated spatial joint.`);};
  if(s.bindings){
    if(Object.keys(s).some(k=>!['point','bindings'].includes(k))||!vector(s.point)||!Array.isArray(s.bindings)||!s.bindings.length||s.bindings.length>4)throw new Error('A skin point needs a position and 1–4 joint bindings.');
    const seen=new Set();let sum=0;
    for(const b of s.bindings){if(!b||Object.keys(b).some(k=>!['joint','weight'].includes(k))||!Number.isFinite(b.weight)||b.weight<=0||b.weight>1||seen.has(b.joint))throw new Error('Skin weights must use distinct joints and positive weights.');ref(b.joint,'Skin binding',true);if(!b.joint)throw new Error('Bind skin to an articulated joint.');seen.add(b.joint);sum+=b.weight;}
    if(Math.abs(sum-1)>1e-6)throw new Error('Skin weights must add up to one.');
  }else{
    if(Object.keys(s).some(k=>!['parent','turn','pitch','origin','tip'].includes(k))||!vector(s.origin)||!vector(s.tip))throw new Error('An articulated joint needs a rest origin and tip.');
    ref(s.parent,'Spatial parent',true);ref(s.turn,'Turn control');ref(s.pitch,'Tilt control');
    if(!s.turn||!s.pitch||s.turn===s.pitch)throw new Error('Choose separate turn and tilt controls.');
  }
}
export function remapSpatial(s,map){return s.bindings?{point:[...s.point],bindings:s.bindings.map(b=>({...b,joint:map.get(b.joint)??b.joint}))}:{...s,origin:[...s.origin],tip:[...s.tip],...Object.fromEntries(['parent','turn','pitch'].map(k=>[k,map.get(s[k])??s[k]]))};}
export function quatMultiply(a,b){return[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
export function quatRotate(q,p){const[x,y,z,w]=q,[a,b,c]=p,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);return[a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];}
export function spatialQuaternion(bend,turn,pitch){
  const x=pitch/2,y=turn/2,z=bend/2,cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
  return[sx*cy*cz-cx*sy*sz,cx*sy*cz+sx*cy*sz,cx*cy*sz-sx*sy*cz,cx*cy*cz+sx*sy*sz];
}
export function spatialPoint(frame,point){
  let p=point;
  if(Math.abs(frame.stretch-1)>EPS){const v=frame.axis,d=(point[0]-frame.origin[0])*v[0]+(point[1]-frame.origin[1])*v[1]+(point[2]-frame.origin[2])*v[2];p=point.map((n,i)=>n+d*(frame.stretch-1)*v[i]);}
  const rotated=quatRotate(frame.q,p);for(let i=0;i<3;i++)rotated[i]+=frame.t[i];return rotated;
}
function skinPoint(s,get){
  if(s.bindings.length===1)return spatialPoint(get(s.bindings[0].joint).spatial,s.point);
  const first=get(s.bindings[0].joint).spatial.q;let x=0,y=0,z=0,w=0,dx=0,dy=0,dz=0,dw=0,stretch=false;
  // Skin is evaluated for every mesh vertex. Accumulate the dual quaternion
  // in scalars so the hot path allocates only its final point.
  for(const b of s.bindings){const f=get(b.joint).spatial,q=f.q,d=f.dual;stretch||=Math.abs(f.stretch-1)>EPS;
    const weight=b.weight*(q[0]*first[0]+q[1]*first[1]+q[2]*first[2]+q[3]*first[3]<0?-1:1);
    x+=q[0]*weight;y+=q[1]*weight;z+=q[2]*weight;w+=q[3]*weight;dx+=d[0]*weight;dy+=d[1]*weight;dz+=d[2]*weight;dw+=d[3]*weight;
  }
  if(stretch){const p=[0,0,0];for(const b of s.bindings){const v=spatialPoint(get(b.joint).spatial,s.point);for(let i=0;i<3;i++)p[i]+=v[i]*b.weight;}return p;}
  const norm=Math.hypot(x,y,z,w);x/=norm;y/=norm;z/=norm;w/=norm;dx/=norm;dy/=norm;dz/=norm;dw/=norm;
  const[a,b,c]=s.point,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
  return[a+w*tx+y*tz-z*ty+2*(-dw*x+dx*w-dy*z+dz*y),
    b+w*ty+z*tx-x*tz+2*(-dw*y+dx*z+dy*w-dz*x),
    c+w*tz+x*ty-y*tx+2*(-dw*z-dx*y+dy*x+dz*w)];
}
export function evaluateSpatial(s,{segment,input,get,root,scale,figureAngle,restAngle,referenceRest,mirror=false}){
  const cs=Math.cos(figureAngle),sn=Math.sin(figureAngle),sign=mirror?-1:1,project=p=>({x:root.x+(p[0]*cs-p[1]*sign*sn)*scale,y:root.y+(p[0]*sn+p[1]*sign*cs)*scale});
  let point,start=input.start,spatial;
  if(s.bindings)point=skinPoint(s,get);
  else{
    const parent=s.parent?get(s.parent).spatial:null,nativeBend=(input.angle-figureAngle)*sign-restAngle;
    const turn=(get(s.turn).authoredAngle-figureAngle)*sign-referenceRest(s.turn),pitch=(get(s.pitch).authoredAngle-figureAngle)*sign-referenceRest(s.pitch);
    const local=spatialQuaternion(nativeBend-(parent?.nativeBend??0),turn,pitch),q=parent?quatMultiply(parent.q,local):local;
    const origin=parent?spatialPoint(parent,s.origin):s.origin,v=s.tip.map((n,i)=>n-s.origin[i]),length=Math.hypot(...v),rotatedOrigin=quatRotate(q,s.origin),t=origin.map((n,i)=>n-rotatedOrigin[i]);
    const stretch=length>EPS&&Math.abs(scale)>EPS?input.length/scale/length:1,axis=length>EPS?v.map(n=>n/length):[0,1,0];
    spatial={q,t,dual:quatMultiply([...t,0],q).map(n=>n*.5),nativeBend,origin:s.origin,axis,stretch};
    point=spatialPoint(spatial,s.tip);start=project(origin);
  }
  const handle=project(point),dx=handle.x-start.x,dy=handle.y-start.y,angle=Math.hypot(dx,dy)<EPS?input.angle:Math.atan2(dy,dx);
  // Depth guides use the same figure rotation/scale as the surface reference X.
  const depthOffset={x:point[2]*scale*cs,y:point[2]*scale*sn};handle.depthOffset=depthOffset;
  return{start,handle,angle,authoredAngle:input.angle,restAngle:segment.angle_rad??0,length:Math.hypot(dx,dy),bend:0,width:1,rotation:angle-input.angle,ratio:1,impulseAngle:angle,depthOffset,spatial,space:{rotation:angle-input.angle,locked:Boolean(s.bindings),spatial:true}};
}

const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const normalize=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const axes=[[1,0,0],[0,1,0],[0,0,1]];
/** Choose the equivalent native Euler channels nearest the previous pose.
 * The manipulator itself rotates quaternions, including at Euler singularities. */
export function quaternionPose(q,previous){
 const [x,y,z,w]=normalize(q),sy=Math.max(-1,Math.min(1,2*(w*y-z*x))),turn=Math.asin(sy);
 let pitch,bend;
 if(Math.abs(sy)>1-1e-10){
  pitch=previous.pitch;
  const a=quatMultiply([x,y,z,w],[-Math.sin(pitch/2),0,0,Math.cos(pitch/2)]);
  bend=2*Math.atan2(a[2],a[3]);
 }else{
  pitch=Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y));
  bend=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z));
 }
 const candidates=[{pitch,turn,bend},{pitch:pitch+Math.PI,turn:Math.PI-turn,bend:bend+Math.PI}].map(p=>Object.fromEntries(Object.keys(p).map(k=>[k,previous[k]+wrap(p[k]-previous[k])])));
 return candidates.sort((a,b)=>Object.keys(a).reduce((s,k)=>s+(a[k]-previous[k])**2-(b[k]-previous[k])**2,0))[0];
}
export function betweenVectors(a,b){
 const d=dot(a,b);if(d<-.999999){const axis=normalize(cross(a,Math.abs(a[0])<.8?axes[0]:axes[1]));return [...axis,0];}
 return normalize([...cross(a,b),1+d]);
}
