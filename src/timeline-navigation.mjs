import {OnionTimelineRange} from './onion-timeline-range.mjs';
import {icon} from './icons.mjs';

/** Shared view gestures; panning and zooming never enter document history. */
export function mountTimelineNavigation(host, {input, fit}) {
  if(!host.strip)host.onionRange=new OnionTimelineRange(host);
  const surface=host.scroll??host.strip, panel=document.createElement('div');
  panel.className='timeline-zoom-float';panel.setAttribute('aria-label','Timeline zoom controls');
  const symbol=document.createElement('span');symbol.innerHTML=icon('zoom');panel.append(symbol,input);
  const button=document.createElement('button');button.type='button';button.className='icon-button';button.innerHTML=icon('maximize');button.title='Fit timeline';button.setAttribute('aria-label','Fit timeline');panel.append(button);
  host.container.append(panel);host.navigationOverlay=panel;
  const on=(target,type,fn,options={})=>target.addEventListener(type,fn,{...options,signal:host.events.signal});
  on(button,'click',fit);
  surface.title='Middle-drag to pan · Ctrl/Cmd-wheel to zoom';
  let pan=null;
  on(host.container,'pointerdown',event=>{
    if(event.button!==1||panel.contains(event.target))return;
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
}
