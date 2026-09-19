/** Projection adapter for the existing IK solver. Only dependencies of the
 * driven bones participate in iterative evaluation; surface vertices are never
 * rebuilt during a solve. Authored angles remain the animation channels. */
import {spatialBone} from './rig-spatial.mjs';
import {createRigEvaluation,rigConstraintPlan} from './rig-constraints.mjs';

export function rigIKContext(figure,object,root,handles,angles,lengths) {
 const plan=rigConstraintPlan(figure),needed=new Set(),queue=handles.map(id=>plan.ids.get(Number(id))).filter(i=>i!==undefined);
 for(let q=0;q<queue.length;q++){
  const i=queue[q];if(needed.has(i))continue;needed.add(i);
  for(const dependency of plan.dependencies[i])queue.push(dependency);
 }
 const order=plan.order.filter(i=>needed.has(i)),sourcePlans=new Map();
 function evaluate(all=false){
  const current=lengths(),points=new Map([[0,root]]),states=[],contexts=new Map();
  const evaluation=figure._rigSources?null:createRigEvaluation(figure,object,root,plan,states);
  for(const i of all?plan.order:order){
   const s=figure.segments[i],start=points.get(s.parent_id)??root,bend=object.bend_flag?object.bends[i]:s.bend_rad??0;
   const length=(current?.[i]??(object.len_flag?object.lengths[i]:s.length))*object.scale;
   let p;
   const source=figure._rigSources?.[i];
   if(source){
    let context=contexts.get(source.group);
    if(!context){
     const g=source.group,origin=points.get(g.rootId)??root;
     if(!sourcePlans.has(g))sourcePlans.set(g,rigConstraintPlan(g.figure));
     context={evaluation:createRigEvaluation(g.figure,g.object,origin,sourcePlans.get(g),[]),joints:{get:id=>points.get(id?g.ids.get(id):g.rootId)}};
     contexts.set(g,context);
    }
    p=context.evaluation.evaluate(source.index,{start,angle:angles[i],length,bend},context.joints);states[i]=p;
   }else p=evaluation.evaluate(i,{start,angle:angles[i],length,bend},points);
   const b=p.bend;
   const span=p.length*(Math.abs(b)<1e-8?1:2*Math.sin(b/2)/b),a=p.angle+b/2;
   points.set(s.segment_id,p.handle??{x:p.start.x+Math.cos(a)*span,y:p.start.y+Math.sin(a)*span});
  }
  return {points,states};
 }
 function refine(chain,target,{iterations=40,tolerance=1e-4}={}){
  const endpoint=figure.segments[chain.at(-1)].segment_id;
  const variables=[...new Set(chain.flatMap(i=>spatialBone(figure.segments[i])?[i,plan.ids.get(figure.segments[i]._stykRig.spatial.turn),plan.ids.get(figure.segments[i]._stykRig.spatial.pitch)]:[i]))];
  let sample=evaluate(),p=sample.points.get(endpoint),error=Math.hypot(target.x-p.x,target.y-p.y),used=0;
  for(;used<iterations&&error>tolerance;used++){
   const dx=target.x-p.x,dy=target.y-p.y,jacobian=[];let xx=1e-5,xy=0,yy=1e-5;
   for(const i of variables){
    const angle=angles[i],step=1e-4;angles[i]=angle+step;const plus=evaluate().points.get(endpoint);angles[i]=angle-step;const minus=evaluate().points.get(endpoint);angles[i]=angle;
    const x=(plus.x-minus.x)/(2*step),y=(plus.y-minus.y)/(2*step);jacobian.push([x,y]);xx+=x*x;xy+=x*y;yy+=y*y;
   }
   const determinant=xx*yy-xy*xy;if(!Number.isFinite(determinant)||determinant<1e-14)break;
   const ux=(yy*dx-xy*dy)/determinant,uy=(xx*dy-xy*dx)/determinant;
   const delta=jacobian.map(([x,y])=>Math.max(-.35,Math.min(.35,x*ux+y*uy))),baseline=variables.map(i=>angles[i]);
   let accepted=false;
   for(const factor of [1,.5,.25,.125]){
    variables.forEach((i,j)=>{angles[i]=baseline[j]+factor*delta[j];});const next=evaluate(),point=next.points.get(endpoint),distance=Math.hypot(target.x-point.x,target.y-point.y);
    if(distance<error-1e-9){sample=next;p=point;error=distance;accepted=true;break;}
   }
   if(!accepted){
    variables.forEach((i,j)=>{angles[i]=baseline[j];});
    // A straight limb pulled inward has zero first-order shortening. Explore
    // bounded null-space bends, preserving the endpoint's tangent direction,
    // instead of getting stuck or choosing a random screen-space knee flip.
    if(variables.length>chain.length)for(let j=0;j<variables.length;j++){
     const[x,y]=jacobian[j],vx=(yy*x-xy*y)/determinant,vy=(xx*y-xy*x)/determinant;
     const direction=jacobian.map(([a,b],k)=>(k===j?1:0)-a*vx-b*vy),norm=Math.max(...direction.map(Math.abs));
     if(norm<1e-5)continue;
     for(const sign of [1,-1]){
      variables.forEach((i,k)=>{angles[i]=baseline[k]+direction[k]/norm*.18*sign;});
      const next=evaluate(),point=next.points.get(endpoint),distance=Math.hypot(target.x-point.x,target.y-point.y);
      if(distance<error-1e-7){sample=next;p=point;error=distance;accepted=true;break;}
     }
     if(accepted)break;
    }
    if(!accepted){variables.forEach((i,j)=>{angles[i]=baseline[j];});break;}
   }
  }
  return {sample,error,iterations:used};
 }
 return {evaluate,refine,dependencyCount:order.length};
}
