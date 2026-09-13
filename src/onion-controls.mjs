import {icon} from './icons.mjs';
import {OnionFrameField} from './onion-frame-field.mjs';

/** Settings view. All previews and commits go through the shared controller. */
export class OnionControls {
  constructor({button,toggleButton,controller}){
    Object.assign(this,{button,toggleButton,controller});this.events=new AbortController();
    const panel=this.panel=document.createElement('div');panel.className='onion-popover';panel.id='onion-popover';panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Onion skin settings');
    const toggle=(key,label)=>`<label class="onion-check"><input type="checkbox" data-onion="${key}"><span>${label}</span></label>`;
    panel.innerHTML=`<header><strong>${icon('onion')}Onion skin</strong><button type="button" class="icon-button" data-onion-toggle aria-label="Enable onion skin"></button><button type="button" class="icon-button onion-close" aria-label="Close onion settings">${icon('close')}</button></header>
      <section class="onion-frame-section"><div class="onion-section-title">Range in output frames</div><div class="onion-frame-pair"></div><p class="onion-range-info"></p></section>
      <section><div class="onion-design-row"><span>Opacity</span><input class="onion-slider" type="range" data-onion="onionOpacity" min="0" max="100" step="1" aria-label="Onion opacity slider"><label class="onion-value"><input type="number" data-onion="onionOpacity" min="0" max="100" step="1" aria-label="Onion opacity"></label></div><div class="onion-design-row"><span>Colors</span><label class="onion-swatch" title="Previous pose color">${icon('chevron-left')}<input type="color" data-onion="onionBeforeColor" aria-label="Previous pose color"></label><label class="onion-swatch" title="Following pose color"><input type="color" data-onion="onionAfterColor" aria-label="Following pose color">${icon('chevron-right')}</label></div></section>
      <section><div class="onion-design-row"><span>Figures</span><select data-onion="onionScope" aria-label="Onion figures"><option value="all">All visible</option><option value="selected">Selected</option></select></div><div class="onion-design-row"><span>Sampling</span><select data-onion="onionMode" aria-label="Onion sampling"><option value="keyframes">Keyframes in range</option><option value="frames">Output frames in range</option></select></div><div class="onion-design-row"><span>Spacing</span><input class="onion-spacing" type="number" data-onion="onionStep" min="1" max="20" step="1" aria-label="Sample spacing"></div></section>
      <section class="onion-design-toggles">${toggle('onionTint','Tint colors')}${toggle('onionFade','Fade with distance')}${toggle('onionShowOnTop','Show on top')}${toggle('onionJoined','Joined figures')}${toggle('onionCamera','Camera outline')}</section>`;
    this.fields=['before','after'].map(direction=>{const field=new OnionFrameField(controller,direction);panel.querySelector('.onion-frame-pair').append(field.root);return field;});
    document.body.append(panel);button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
    const on=(target,type,fn)=>target.addEventListener(type,fn,{signal:this.events.signal});
    on(button,'click',event=>{event.stopPropagation();this.sync(true);panel.togglePopover();});
    on(panel,'toggle',event=>{button.setAttribute('aria-expanded',String(event.newState==='open'));if(event.newState==='open')this.position();});
    on(panel,'beforetoggle',event=>{if(event.newState==='closed'){controller.cancel(this);for(const field of this.fields)field.finish(false);}});
    on(panel,'keydown',event=>{event.stopPropagation();if(event.key!=='Escape')this.blockNative=false;if(event.key==='Escape'){event.preventDefault();const editing=controller.session;if(editing){controller.cancel();this.sync(true);}else{panel.hidePopover();button.focus();}}});
    on(panel,'click',event=>{event.stopPropagation();if(event.target.closest('[data-onion-toggle]'))controller.toggle();if(event.target.closest('.onion-close')){panel.hidePopover();button.focus();}});
    on(panel,'pointerdown',event=>{this.blockNative=false;if(event.target.matches('[data-onion][type=range]')){this.nativePointer=true;controller.begin(this);}});
    on(document,'pointerup',()=>{this.nativePointer=false;});
    on(panel,'input',event=>{
      const input=event.target.closest('[data-onion]');if(!input||input.type==='checkbox'||input.tagName==='SELECT')return;
      if(this.blockNative){this.sync(true);return;}
      const value=this.read(input);if(value===undefined)return;
      controller.begin(this);controller.preview(this,{[input.dataset.onion]:value});
    });
    on(panel,'change',event=>{
      const input=event.target.closest('[data-onion]');if(!input)return;
      if(this.blockNative){this.sync(true);return;}
      const value=this.read(input);
      if(value!==undefined){controller.begin(this);controller.preview(this,{[input.dataset.onion]:value});controller.commit(this);}
      else controller.cancel(this);
      this.sync(true);
    });
    on(panel,'pointercancel',()=>{controller.cancel(this);this.nativePointer=false;this.sync(true);});
    on(window,'blur',()=>{controller.cancel(this);this.sync(true);});
    on(window,'resize',()=>{if(panel.matches(':popover-open'))this.position();});
    this.unsubscribe=controller.subscribe(()=>{if(this.nativePointer&&controller.session?.owner!==this)this.blockNative=true;this.sync(this.blockNative);});this.sync();
  }
  read(input){
    if(input.type==='checkbox')return input.checked;
    if(input.type==='number'||input.type==='range'){
      if(!input.validity.valid||!Number.isFinite(input.valueAsNumber))return;
      return input.valueAsNumber/(input.dataset.onion==='onionOpacity'?100:1);
    }
    return input.value;
  }
  position(){const r=this.button.getBoundingClientRect(),panel=this.panel;panel.style.left=`${Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,r.right-panel.offsetWidth))}px`;panel.style.top=`${Math.max(8,Math.min(innerHeight-panel.offsetHeight-8,r.top-panel.offsetHeight-8))}px`;}
  sync(force=false){
    const settings=this.controller.settings,enabled=this.controller.getEnabled(),range=this.controller.snapshot();
    this.toggleButton.setAttribute('aria-pressed',String(enabled));this.toggleButton.classList.toggle('active',enabled);
    for(const input of this.panel.querySelectorAll('[data-onion]')){
      const value=settings[input.dataset.onion];if(input.type==='checkbox')input.checked=value;
      else if(force||document.activeElement!==input)input.value=input.dataset.onion==='onionOpacity'?Math.round(value*100):value;
    }
    this.panel.querySelector('.onion-slider').style.setProperty('--onion-progress',`${Math.round(settings.onionOpacity*100)}%`);
    this.panel.querySelector('.onion-range-info').textContent=`${range.before.count} previous · ${range.after.count} following poses`;
    const toggle=this.panel.querySelector('[data-onion-toggle]');toggle.innerHTML=icon(enabled?'eye':'eye-off');toggle.setAttribute('aria-pressed',String(enabled));toggle.title=enabled?'Disable onion skin':'Enable onion skin';
  }
  destroy(){this.controller.cancel(this);for(const field of this.fields)field.destroy();this.unsubscribe();this.events.abort();this.panel.remove();}
}
