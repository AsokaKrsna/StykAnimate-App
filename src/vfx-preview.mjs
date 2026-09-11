/** Copy-on-write render views. Bypass is editor state, never document data. */
const views=new WeakMap(),owners=new WeakMap(),objects=new WeakMap(),groups=new WeakMap();
const object=o=>{if(!o?._stykVfx)return o;let next=objects.get(o);if(!next){next={...o,_stykVfx:undefined};objects.set(o,next);}return next;};
const owner=o=>{if(!o)return o;let next=owners.get(o);if(!next){next={...o,effects:[],sceneEffects:[]};owners.set(o,next);}return next;};
const inner=o=>o?{...o,owner:owner(o.owner),inner:inner(o.inner)}:o;
function group(g){let next=groups.get(g);if(next)return next;next={...g,obj:object(g.obj),renderSource:g.renderSource?group(g.renderSource):undefined,drawables:(g.drawables??[]).map(item=>({...item,obj:object(item.obj),_movieclipOwner:owner(item._movieclipOwner),_movieclipInner:inner(item._movieclipInner)}))};groups.set(g,next);return next;}
export function vfxPreviewGeometry(geometry){if(!geometry)return geometry;let next=views.get(geometry);if(!next){const orderedObjects=geometry.orderedObjects.map(group);next={...geometry,token:{},previousToken:undefined,objects:new Map([...geometry.objects].map(([id,g])=>[id,group(g)])),orderedObjects,drawables:orderedObjects.flatMap(g=>g.drawables)};views.set(geometry,next);}return next;}
export const vfxPreviewFrame=frame=>frame?._stykVfx?{...frame,_stykVfx:undefined}:frame;
export function vfxPreviewOptions(options){if(options.vfxEnabled!==false)return options;return {...options,frame:vfxPreviewFrame(options.frame),geometry:vfxPreviewGeometry(options.geometry),preparedPacket:undefined,onionFrames:options.onionFrames?.map(entry=>({...entry,geometry:vfxPreviewGeometry(entry.geometry)}))};}
