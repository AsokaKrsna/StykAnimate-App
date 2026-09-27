import {OnionRangeDrag} from './onion-range-drag.mjs';
import {setAttr, setProp} from './ui/dom-write.mjs';

/** A reusable frame-span editor: explicit typing, single-frame steps and scrub. */
export class OnionFrameField {
  constructor(controller,direction){
    this.controller=controller;this.direction=direction;this.key=direction==='before'?'onionRangeBefore':'onionRangeAfter';
    this.events=new AbortController();
    const label=direction==='before'?'Before':'After';
    this.root=document.createElement('div');this.root.className='onion-frame-field';this.root.dataset.direction=direction;
    this.root.innerHTML=`<button type="button" class="onion-scrub" aria-label="Drag frames ${direction}" title="Drag to adjust · 8 pixels per frame · Shift for precision">${label}</button><div class="onion-stepper"><button type="button" data-step="-1" aria-label="Decrease frames ${direction}">−</button><input type="number" min="0" step="1" aria-label="Frames ${direction}"><button type="button" data-step="1" aria-label="Increase frames ${direction}">+</button></div>`;
    this.input=this.root.querySelector('input');this.scrub=this.root.querySelector('.onion-scrub');
    const on=(target,type,fn,options={})=>target.addEventListener(type,fn,{...options,signal:this.events.signal});
    on(this.root,'keydown',event=>{
      event.stopPropagation();
      if(event.key==='Escape'){event.preventDefault();this.typed=false;this.finish(false);this.input.blur();}
      if(event.key==='Enter'&&event.target===this.input){event.preventDefault();this.saveInput();this.input.blur();}
    });
    on(this.root,'click',event=>{
      event.stopPropagation();const step=event.target.closest('[data-step]');
      if(step){const range=controller.snapshot()[direction];controller.change(this,{[this.key]:Math.max(0,Math.min(range.max,range.span+Number(step.dataset.step)))});}
    });
    on(this.input,'input',()=>{this.typed=true;});
    on(this.input,'change',()=>this.saveInput());
    on(this.input,'blur',()=>this.sync());
    this.gesture=new OnionRangeDrag(controller,direction,this.scrub);
    this.unsubscribe=controller.subscribe(()=>this.sync());this.sync();
  }
  saveInput(){
    const value=this.input.valueAsNumber,range=this.controller.snapshot()[this.direction];
    if(Number.isFinite(value)&&Number.isInteger(value)&&value>=0&&value<=range.max&&(this.typed||value!==range.span))this.controller.change(this,{[this.key]:value});
    this.typed=false;
    this.sync(true);
  }
  finish(commit){this.gesture.finish(commit);this.sync(true);}
  sync(force=false){
    const range=this.controller.snapshot()[this.direction];
    // Runs on every editor change (each frame while playing): write only what changed.
    setAttr(this.input,'max',String(range.max));
    if(force||document.activeElement!==this.input)setProp(this.input,'value',String(range.span));
    setProp(this.root.querySelector('[data-step="-1"]'),'disabled',range.span===0);
    setProp(this.root.querySelector('[data-step="1"]'),'disabled',range.span===range.max);
    setProp(this.scrub,'disabled',range.max===0);
  }
  destroy(){this.gesture.destroy();this.unsubscribe();this.events.abort();this.root.remove();}
}
