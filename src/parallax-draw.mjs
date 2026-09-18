import {drawGeometry} from './pivot/geometry.mjs';
/** Preserve painter ordering and native stroke state without cloning artwork. */
export function drawParallaxGeometry(ctx,geometry,resources,offsetFor,outputRect){
  const strokeState={width:1};let slot,items=[];
  const draw=()=>{if(!items.length)return;const d=offsetFor(items[0].obj.unique_id);ctx.save();try{ctx.translate(d.x,d.y);drawGeometry(ctx,{drawables:items,strokeState,outputRect:outputRect&&{x:d.x+outputRect.x,y:d.y+outputRect.y,width:outputRect.width,height:outputRect.height}},resources);}finally{ctx.restore();}};
  for(const item of geometry.drawables){if(items.length&&item.slot!==slot){draw();items=[];}slot=item.slot;items.push(item);}draw();
}
