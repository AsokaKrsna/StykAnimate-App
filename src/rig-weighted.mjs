/** A bounded affine attachment in the existing rig graph. Anchors are evaluated
 * by the normal dependency plan; no solver, per-frame cache or pose state. */
export function sameWeightedJoint(a,b) {
  return a===b||Boolean(a&&b&&a.origin===b.origin&&a.anchors?.length===b.anchors?.length&&
    a.anchors.every((v,i)=>v.joint===b.anchors[i].joint&&v.weight===b.anchors[i].weight));
}
export function validateWeightedJoint(value,reference,dependencies) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['origin','anchors'].includes(k))||
    !Array.isArray(value.anchors)||value.anchors.length<1||value.anchors.length>16)throw new Error('A weighted joint requires 1–16 anchors.');
  reference(value.origin,'Weighted origin',true);dependencies.add(value.origin);
  const seen=new Set();
  for(const anchor of value.anchors){
    if(!anchor||typeof anchor!=='object'||Array.isArray(anchor)||Object.keys(anchor).some(k=>!['joint','weight'].includes(k)))throw new Error('Invalid weighted anchor.');
    reference(anchor.joint,'Weighted anchor',true);dependencies.add(anchor.joint);
    if(seen.has(anchor.joint)||anchor.joint===value.origin)throw new Error('Choose distinct weighted anchors outside the origin.');
    seen.add(anchor.joint);
    if(!Number.isFinite(anchor.weight)||Math.abs(anchor.weight)>100)throw new Error('Anchor weight must be between −100 and 100.');
  }
}
export function weightedJoint(value,joints,root,inputAngle) {
  const start=joints.get(value.origin)??root;let dx=0,dy=0;
  for(const {joint,weight} of value.anchors){const p=joints.get(joint)??root;dx+=(p.x-start.x)*weight;dy+=(p.y-start.y)*weight;}
  const angle=Math.hypot(dx,dy)<1e-8?inputAngle:Math.atan2(dy,dx);
  return {start,angle,authoredAngle:angle,length:Math.hypot(dx,dy),bend:0,width:1,
    handle:{x:start.x+dx,y:start.y+dy},rotation:angle-inputAngle,ratio:1,impulseAngle:angle,
    space:{rotation:angle-inputAngle,locked:true}};
}
