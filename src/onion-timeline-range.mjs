import {OnionRangeDrag} from './onion-range-drag.mjs';

/** How far a press on a range end moves before it drags the end (experience.md §5.9, revision 4.3). */
const SLOP=3;

/**
 * Ruler projection of fixed playhead-relative spans; never anchors to a key. Each end is a 24px target inside the
 * ruler. A press that does not move past SLOP passes through as a click on the ruler (it goes to that frame); only a
 * drag moves the end, through the shared OnionRangeDrag gesture.
 */
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
    // Hold a press on an end until it moves: then hand it to the end's drag, else treat it as a click on the ruler.
    this.overlay.addEventListener('pointerdown',event=>this._press(event),{capture:true,signal:this.events.signal});
    host.main.append(this.overlay);
    this.unsubscribe=this.controller?.subscribe(()=>this.update());this.update();
  }
  x(tick){return this.host.labelWidth+(tick+.5)*this.host.pxPerTick-this.host._offsetX();}
  _press(event){
    const end=event.target.closest?.('.onion-range-end');
    if(!end||this.passing||event.button!==0||!this.controller)return;
    event.stopPropagation();event.preventDefault();end.focus({preventScroll:true});
    const start={x:event.clientX,y:event.clientY,id:event.pointerId,type:event.pointerType,shift:event.shiftKey},events=new AbortController(),signal=events.signal;
    end.setPointerCapture?.(start.id);
    const finish=()=>{events.abort();if(end.hasPointerCapture?.(start.id))end.releasePointerCapture(start.id);};
    end.addEventListener('pointermove',move=>{
      if(Math.abs(move.clientX-start.x)<=SLOP)return;
      finish();
      // Past the slop: the end's own gesture takes the press from where it began, then follows the pointer.
      const init={bubbles:true,cancelable:true,composed:true,pointerId:start.id,pointerType:start.type,isPrimary:true,button:0,buttons:1,clientX:start.x,clientY:start.y,shiftKey:start.shift};
      this.passing=true;try{end.dispatchEvent(new PointerEvent('pointerdown',init));}finally{this.passing=false;}
      end.dispatchEvent(new PointerEvent('pointermove',{...init,button:-1,clientX:move.clientX,clientY:move.clientY,shiftKey:move.shiftKey}));
    },{signal});
    end.addEventListener('pointerup',up=>{finish();const tick=this.host._hit?.(up)?.tick;if(Number.isInteger(tick))this.host._run?.(()=>{this.host.seek(tick);});},{signal});
    end.addEventListener('pointercancel',finish,{signal});
    end.addEventListener('lostpointercapture',finish,{signal});
  }
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
      end.title=`${spanLabel} · Drag to adjust (a click goes to the frame) · Shift for precision`;
      this.overlay.style.setProperty(`--onion-${direction}`,range.settings[direction==='before'?'onionBeforeColor':'onionAfterColor']);
    }
  }
  destroy(){this.events.abort();for(const part of this.parts)part.gesture?.destroy();this.controller?.cancel(this);this.unsubscribe?.();this.overlay.remove();}
}
