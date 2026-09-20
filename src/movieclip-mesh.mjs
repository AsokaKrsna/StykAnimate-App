/** Immutable, indexed meshes share the movieclip form/timing contract. Only
 * controls belong to the rig graph; vertices never become editable joints. */
import {animationRotation} from './animation-origin.mjs';
import {spatialPoint} from './rig-spatial.mjs';
import {projection,projectSpatial,projectSpatialFace} from './spatial-projection.mjs';

export function validateMovieclipMeshes(asset) {
  const meshes=asset.spatialMeshes;if(meshes===undefined)return;
  if(asset.drawingRotation||!Array.isArray(meshes)||meshes.length!==asset.duration||meshes.length>128)
    throw new Error('Spatial forms need one mesh per clip frame, up to 128 forms, without drawing rotation.');
  let total=0;
  for(const m of meshes){
    if(!m||!Array.isArray(m.positions)||m.positions.length<9||m.positions.length%3||m.positions.length>300000||m.positions.some(x=>!Number.isFinite(x)||Math.abs(x)>1e6)||
      !Array.isArray(m.indices)||!m.indices.length||m.indices.length%3||m.indices.length>600000||m.indices.some(i=>!Number.isInteger(i)||i<0||i>=m.positions.length/3)||
      !Array.isArray(m.colors)||!m.colors.length||m.colors.length>256||m.colors.some(c=>!Array.isArray(c)||c.length!==3||c.some(v=>!Number.isInteger(v)||v<0||v>255))||
      !Array.isArray(m.materials)||m.materials.length!==m.indices.length/3||m.materials.some(i=>!Number.isInteger(i)||i<0||i>=m.colors.length))
      throw new Error('Invalid indexed spatial mesh.');
    total+=m.positions.length+m.indices.length;if(total>6000000)throw new Error('Spatial mesh asset exceeds its geometry budget.');
  }
}

/** Same triangle/depth contract as native surfaces, including near clipping.
 * Immutable points may be shared with an unchanged incremental pose; no
 * previous geometry or independent pose cache is retained. */
export function* buildMovieclipMeshSteps(fig,obj,root,slot,parent,objectColor,previous) {
  const asset=fig._styk.movieclip,local=obj._movieclipSample===null?null:obj._movieclipSample??obj._stykMovieclip?.offset??0;
  const joint=parent?.segments.find(s=>s.seg.segment_id===obj.join?.target_handle_id),frame=joint?.spatialFrame;
  const localAngle=Number(obj.angles?.[0]??0),lc=Math.cos(localAngle),ls=Math.sin(localAngle),
    angle=frame?animationRotation(parent.fig,parent.obj):localAngle,cs=Math.cos(angle),sn=Math.sin(angle),
    scale=Number(obj.scale??1),mirror=(obj.image_text_flags?-1:1)*(frame&&parent.obj.image_text_flags?-1:1),
    camera=frame?projection(parent.obj,parent.root):null;
  if(frame)root={...joint.start};
  const end={x:root.x+40*scale*cs,y:root.y+40*scale*sn},handle={seg:fig.segments[0],obj,fig,slot,index:0,start:root,end,points:[root,end],angle,length:40*scale,bend:0,thickness:0,opacity:1,alpha:1,rgb:[0,0,0]},
    geometry={obj,fig,slot,root,joints:new Map([[0,root],[1,end]]),segments:[handle],polys:[],drawables:[],meshAttachment:true};
  if(local===null)return geometry;
  const mesh=asset.spatialMeshes[Math.max(0,Math.min(asset.spatialMeshes.length-1,Math.floor(local)))];
  const parentScale=Number(parent?.obj.scale??1),ratio=frame&&Math.abs(parentScale)>1e-12?scale/parentScale:0;
  const pose=[localAngle,angle,scale,mirror,obj.image_text_flags,parent?.obj.image_text_flags,asset.pivot.x,asset.pivot.y,root.x,root.y,parentScale,parent?.root.x,parent?.root.y,camera?.k,camera?.scale,camera?.root.x,camera?.root.y,
    ...(frame?[...frame.q,...frame.t,...frame.origin,...frame.axis,frame.stretch,frame.choiceScale,frame.shape?.width,frame.shape?.taper,frame.restLength]:[])];
  const colors=mesh.colors.map(c=>objectColor?objectColor(c,obj):c),opacity=1-Number(obj.field28??0)/255;
  geometry.meshPose={mesh,pose};
  const old=previous?.meshPose;
  if(old?.mesh===mesh&&previous.fig===fig&&old.pose.length===pose.length&&pose.every((v,i)=>v===old.pose[i])){
    // Retain only arrays from this pose, never a link to an earlier geometry.
    geometry.drawables=previous.drawables.map(item=>{const rgb=colors[mesh.materials[item.index]];return {...item,obj,fig,slot,opacity,rgb,poly:rgb===item.rgb?item.poly:{...item.poly,color_rgb:rgb}};});
    return geometry;
  }
  const points=new Array(mesh.positions.length/3),depth=new Float64Array(points.length);
  // Most attachments are affine. Evaluate the bone four times instead of
  // allocating quaternion/stretch intermediates for every mesh vertex.
  let affine;
  if(frame&&!frame.shape?.taper){const o=spatialPoint(frame,frame.origin);affine=[o,...[0,1,2].map(i=>{const p=frame.origin.slice();p[i]++;return spatialPoint(frame,p).map((v,j)=>v-o[j]);})];}
  for(let i=0;i<points.length;i++){
    const at=i*3,p=[mesh.positions[at]-asset.pivot.x,(mesh.positions[at+1]-asset.pivot.y)*(obj.image_text_flags?-1:1),mesh.positions[at+2]];
    if(frame){const x=p[0],y=p[1];p[0]=x*lc-y*ls;p[1]=x*ls+y*lc;}
    let raw;
    if(frame){const v=affine?[0,1,2].map(j=>affine[0][j]+ratio*(p[0]*affine[1][j]+p[1]*affine[2][j]+p[2]*affine[3][j])):spatialPoint(frame,p.map((x,j)=>frame.origin[j]+x*ratio)),flip=parent.obj.image_text_flags?-1:1;
      raw=[parent.root.x+(v[0]*cs-v[1]*flip*sn)*parentScale,parent.root.y+(v[0]*sn+v[1]*flip*cs)*parentScale,v[2]*parentScale];
    }else raw=[root.x+(p[0]*cs-p[1]*sn)*scale,root.y+(p[0]*sn+p[1]*cs)*scale,p[2]*scale];
    points[i]=projectSpatial(raw,camera);points[i].rawPoint=raw;
    depth[i]=raw[2]/(camera?Math.max(.05,1-camera.k*raw[2])*camera.scale:Math.max(1e-12,Math.abs(scale)));
    if((i&255)===255)yield {phase:'geometry',stage:'mesh vertices',slot,completed:i+1,total:points.length};
  }
  for(let i=0;i<mesh.indices.length;i+=3){
    const ids=mesh.indices.slice(i,i+3),triangle=ids.map(id=>points[id]),projected=projectSpatialFace(triangle,camera),ps=projected?.points??triangle;
    if(ps.length<3)continue;
    // Closed meshes use outward winding. Screen coordinates have Y down.
    const a=ps[0],b=ps[1],c=ps[2],area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    if(area*mirror<=1e-10)continue;
    const values=projected?.depthValues??ids.map(id=>depth[id]),rgb=colors[mesh.materials[i/3]],poly={color_rgb:rgb,color_alpha:1,_stykSurface:{depthTest:true}};
    geometry.drawables.push({type:'poly',poly,obj,fig,slot,index:i/3,points:ps,depthValues:values,z:values.reduce((s,z)=>s+z,0)/values.length,rgb,alpha:1,opacity});
    if((i&255)===0)yield {phase:'geometry',stage:'mesh faces',slot,completed:i/3,total:mesh.materials.length};
  }
  geometry.drawables.sort((a,b)=>a.z-b.z||a.index-b.index);
  return geometry;
}
