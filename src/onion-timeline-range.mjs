import {OnionRangeDrag} from './onion-range-drag.mjs';

/** Ruler projection of fixed playhead-relative spans; never anchors to a key. */
export class OnionTimelineRange {
  constructor(host){
    this.host=host;this.controller=host.onionController;this.events=new AbortController();
    this.overlay=document.createElement('div');this.overlay.className='onion-range-overlay';
    this.parts=['before','after'].map(direction=>{
      const band=document.createElement('div');band.className=`onion-range-band ${direction}`;
      const end=document.createElement('button');end.type='button';end.className=`onion-range-end ${direction}`;
      end.setAttribute('role','slider');end.setAttribute('aria-label',`Onion frames ${direction}`);end.setAttribute('aria-orientation','horizontal');
      this.overlay.append(band,end);
      const sign=direction==='before'?-1:1;
      const gesture=this.controller?new OnionRangeDrag(this.controller,direction,end,sign):null;
      end.addEventListener('keydown',event=>{
        event.stopPropagation();
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)||!this.controller)return;
        event.preventDefault();gesture.finish(false);
        const range=this.controller.snapshot()[direction];
        const delta=event.key==='ArrowLeft'?-sign:event.key==='ArrowRight'?sign:event.key==='ArrowUp'?1:-1;
        this.controller.change(this,{[range.key]:event.key==='Home'?0:Math.max(0,Math.min(range.max,range.span+delta))});
      },{signal:this.events.signal});
      return {direction,band,end,gesture};
    });
    host.main.append(this.overlay);
    this.unsubscribe=this.controller?.subscribe(()=>this.update());this.update();
  }
  x(tick){return this.host.labelWidth+(tick+.5)*this.host.pxPerTick-this.host._offsetX();}
  update(){
    const enabled=Boolean(this.controller?.getEnabled());if(this.overlay.hidden!==!enabled)this.overlay.hidden=!enabled;
    if(!enabled){for(const part of this.parts)part.gesture?.finish(false);return;}
    const range=this.controller.snapshot(this.host.pendingScrub??undefined),center=this.x(range.tick);
    // The bands show over the grid only: from the label column to the grid's end (the ruler tools' column follows it).
    const clip=`xywh(${this.host.labelWidth}px 0 ${Math.max(0,this.host.width??0)}px 100%)`;if(clip!==this.clip){this.clip=clip;this.overlay.style.clipPath=clip;}
    for(const {direction,band,end} of this.parts){
      const value=range[direction],x=this.x(value.endpoint);
      band.style.left=`${Math.min(x,center)}px`;band.style.width=`${Math.abs(x-center)}px`;
      end.style.left=`${x}px`;
      end.setAttribute('aria-valuemin','0');end.setAttribute('aria-valuemax',String(value.max));end.setAttribute('aria-valuenow',String(value.span));
      const spanLabel=`${value.span} ${value.span===1?'frame':'frames'} ${direction}`;
      end.setAttribute('aria-valuetext',spanLabel);
      end.title=`${spanLabel} · Drag to adjust · Shift for precision`;
      this.overlay.style.setProperty(`--onion-${direction}`,range.settings[direction==='before'?'onionBeforeColor':'onionAfterColor']);
    }
  }
  destroy(){this.events.abort();for(const part of this.parts)part.gesture?.destroy();this.controller?.cancel(this);this.unsubscribe?.();this.overlay.remove();}
}
