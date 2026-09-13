/** Optional single-sided native fills. A local reference triangle preserves
 * winding under reflection, rotation, joining and ID remapping. Ordinary
 * polygons remain double-sided. No sorting or mesh state is retained. */
export function surfaceCulled(poly, points, joints) {
  const basis=poly._stykSurface?.basis;if(!basis)return false;
  const o=joints.get(basis[0]),x=joints.get(basis[1]),y=joints.get(basis[2]);
  if(!o||!x||!y||points.length<3)return true;
  const parity=(x.x-o.x)*(y.y-o.y)-(x.y-o.y)*(y.x-o.x),p=points[0];
  let area=0,extent=0;
  for(let i=1;i<points.length;i++){
    const x=points[i].x-p.x,y=points[i].y-p.y;extent=Math.max(extent,x*x+y*y);
    if(i+1<points.length)area+=x*(points[i+1].y-p.y)-y*(points[i+1].x-p.x);
  }
  // Native pose channels use float32 angles. Treat subpixel slivers caused by
  // their rounding as edge-on; the tolerance scales with the actual surface.
  const facing=(poly._stykSurface.side==='back'?-1:1)*(poly._stykSurface.flipped?-1:1);
  return area*Math.sign(parity)*facing<=extent*2e-7;
}
export function surfaceHandles(poly) {return [...(poly.segment_ids??[]),...(poly._stykSurface?.basis??[])];}
export function documentHasSurfaces(document,seen=new Set()) {
  if(seen.has(document))return false;seen.add(document);
  return document.figure_types.some(f=>f.polyfills?.some(p=>p._stykSurface)||(f._styk?.movieclip&&documentHasSurfaces(f._styk.movieclip.document,seen)));
}
export function remapSurface(poly, remap) {
  if(poly._stykSurface)poly._stykSurface={...poly._stykSurface,basis:poly._stykSurface.basis.map(remap)};
}
export function validateSurface(poly, ids) {
  const s=poly._stykSurface;if(s===undefined)return;
  if(!s||!Array.isArray(s.basis)||s.basis.length!==3||new Set(s.basis).size!==3||s.basis.some(id=>!Number.isInteger(id)||!ids.has(id)))throw new Error('Face visibility needs three distinct existing reference joints.');
  if(s.side!==undefined&&!['front','back'].includes(s.side))throw new Error('Choose Front, Back or Both for face visibility.');
  if(s.flipped!==undefined&&typeof s.flipped!=='boolean')throw new Error('Face facing must be a boolean.');
}

/** Authoring validation is separate from pose evaluation: a valid reference may
 * temporarily flatten during animation, in which case its faces are hidden. */
export function editableSurface(surface, figure, joints) {
  validateSurface({_stykSurface:surface},new Set([0,...figure.segments.map(s=>s.segment_id)]));
  const [o,x,y]=surface.basis.map(id=>joints.get(id));
  const cross=o&&x&&y?(x.x-o.x)*(y.y-o.y)-(x.y-o.y)*(y.x-o.x):0;
  const scale=o&&x&&y?Math.hypot(x.x-o.x,x.y-o.y)*Math.hypot(y.x-o.x,y.y-o.y):0;
  if(!scale||Math.abs(cross)<=scale*1e-7)throw new Error('Reference joints must form a triangle. Choose a different X or Y joint.');
  return {basis:[...surface.basis],side:surface.side??'front',flipped:surface.flipped??false};
}

export function protectSurfaceReferences(figure, removed) {
  if((figure.polyfills??[]).some(p=>!p.segment_ids.some(id=>removed.has(id))&&p._stykSurface?.basis.some(id=>removed.has(id))))
    throw new Error('This joint controls face visibility. Change the fill reference joints before deleting it.');
}
