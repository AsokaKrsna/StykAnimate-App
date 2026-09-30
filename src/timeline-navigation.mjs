import {OnionTimelineRange} from './onion-timeline-range.mjs';
import {installTimelineTouch} from './touch/timeline-touch.mjs';

/** Shared view gestures; panning and zooming never enter document history. The zoom slider and
 * Fit timeline are the header's ruler tools (timeline-header.mjs), which the gesture leaves alone. */
export function mountTimelineNavigation(host) {
  if(!host.strip)host.onionRange=new OnionTimelineRange(host);
  const surface=host.scroll??host.strip;
  const on=(target,type,fn,options={})=>target.addEventListener(type,fn,{...options,signal:host.events.signal});
  surface.title='Middle-drag to pan · Ctrl/Cmd-wheel to zoom';
  let pan=null;
  on(host.container,'pointerdown',event=>{
    if(event.button!==1||event.target.closest?.('.tl-ruler-tools'))return;
    event.preventDefault();event.stopImmediatePropagation();
    pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:host._offsetX?.()??surface.scrollLeft,top:surface.scrollTop};
    host.container.setPointerCapture(event.pointerId);host.container.classList.add('timeline-panning');
  },{capture:true});
  on(host.container,'pointermove',event=>{if(!pan||event.pointerId!==pan.id)return;event.preventDefault();event.stopImmediatePropagation();const x=pan.left+pan.x-event.clientX;
    if(host._scrollToX)host._scrollToX(x);else surface.scrollLeft=x;
    surface.scrollTop=pan.top+pan.y-event.clientY;
  },{capture:true});
  const end=()=>{pan=null;host.container.classList.remove('timeline-panning');};
  on(host.container,'pointerup',event=>{if(!pan)return;event.preventDefault();event.stopImmediatePropagation();end();if(host.container.hasPointerCapture(event.pointerId))host.container.releasePointerCapture(event.pointerId);},{capture:true});
  on(host.container,'pointercancel',end);on(host.container,'lostpointercapture',end);
  on(host.container,'auxclick',event=>{if(event.button===1)event.preventDefault();});
  // A finger scrolls, taps, holds and pinches the Advanced grid (docs/TOUCH.md); Simple's cards scroll natively.
  if(host.scroll&&host.touch)host.touchNavigation=installTimelineTouch(host,{touch:host.touch,signal:host.events.signal});
}
