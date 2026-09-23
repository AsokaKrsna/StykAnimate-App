import {icon} from './icons.mjs';
import {OnionFrameField} from './onion-frame-field.mjs';

/** Settings view. All previews and commits go through the shared controller. */
export class OnionControls {
  constructor({button,toggleButton,controller}){
    Object.assign(this,{button,toggleButton,controller});this.events=new AbortController();
    const panel=this.panel=document.createElement('div');panel.className='onion-popover';panel.id='onion-popover';panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Onion skin settings');
    // Compact: each range row carries its own colour; look and scope sit on one
    // line each; sampling and drawing order stay folded under "More".
    const pill=(key,label,title)=>`<label class="onion-pill" title="${title}"><input type="checkbox" data-onion="${key}" aria-label="${label}"><span>${label}</span></label>`;
    const toggle=(key,label)=>`<label class="ds-switch onion-check"><input type="checkbox" data-onion="${key}" aria-label="${label}"><span aria-hidden="true">${label}</span></label>`;
    panel.innerHTML=`<header><strong>${icon('onion')}Onion skin</strong><button type="button" class="onion-power" data-onion-toggle role="switch" aria-checked="false" aria-label="Show onion skin"><i></i></button><button type="button" class="icon-button onion-close" aria-label="Close onion settings">${icon('close')}</button></header>
      <div class="onion-body"><div class="onion-frame-pair"></div>
      <div class="onion-row"><span>Opacity</span><input class="onion-slider" type="range" data-onion="onionOpacity" min="0" max="100" step="1" aria-label="Onion opacity slider"><label class="onion-value"><input type="number" data-onion="onionOpacity" min="0" max="100" step="1" aria-label="Onion opacity"><small>%</small></label></div>
      <div class="onion-row"><div class="ds-segmented onion-scope" role="group" aria-label="Onion figures"><button type="button" data-onion-scope="all">All figures</button><button type="button" data-onion-scope="selected">Selected</button></div></div>
      <div class="onion-row onion-pills">${pill('onionTint','Tint','Tint earlier and later poses with their colors')}${pill('onionFade','Fade','Fade poses further from the current frame')}</div>
      <details class="onion-more"><summary>More</summary><div class="onion-more-body"><div class="onion-row"><span>Sample</span><select data-onion="onionMode" aria-label="Onion sampling"><option value="keyframes">Poses</option><option value="frames">Every frame</option></select></div><div class="onion-row"><span>Every</span><label class="onion-value"><input class="onion-spacing" type="number" data-onion="onionStep" min="1" max="20" step="1" aria-label="Sample spacing"></label></div>
        ${toggle('onionShowOnTop','Show on top')}${toggle('onionJoined','Joined figures')}${toggle('onionCamera','Camera outline')}</div></details></div>`;
    this.fields=['before','after'].map(direction=>{
      const field=new OnionFrameField(controller,direction),key=direction==='before'?'onionBeforeColor':'onionAfterColor';
      // The colour dot is the colour picker for its side of the range.
      field.root.insertAdjacentHTML('afterbegin',`<label class="onion-color" title="${direction==='before'?'Color for earlier poses':'Color for later poses'}"><input type="color" data-onion="${key}" aria-label="${direction==='before'?'Previous':'Following'} pose color"></label>`);
      panel.querySelector('.onion-frame-pair').append(field.root);return field;
    });
    document.body.append(panel);button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
    const on=(target,type,fn)=>target.addEventListener(type,fn,{signal:this.events.signal});
    on(button,'click',event=>{event.stopPropagation();this.sync(true);panel.togglePopover();});
    on(panel,'toggle',event=>{button.setAttribute('aria-expanded',String(event.newState==='open'));if(event.newState==='open')this.position();});
    on(panel,'beforetoggle',event=>{if(event.newState==='closed'){controller.cancel(this);for(const field of this.fields)field.finish(false);}});
    on(panel,'keydown',event=>{event.stopPropagation();if(event.key!=='Escape')this.blockNative=false;if(event.key==='Escape'){event.preventDefault();const editing=controller.session;if(editing){controller.cancel();this.sync(true);}else{panel.hidePopover();button.focus();}}});
    on(panel,'click',event=>{event.stopPropagation();const scope=event.target.closest('[data-onion-scope]');if(scope)controller.change(this,{onionScope:scope.dataset.onionScope});if(event.target.closest('[data-onion-toggle]'))controller.toggle();if(event.target.closest('.onion-close')){panel.hidePopover();button.focus();}});
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
    const unit=settings.onionMode==='frames'?'frames':'poses';
    this.panel.title=`${range.before.count} earlier and ${range.after.count} later ${unit} shown at this frame`;
    for(const button of this.panel.querySelectorAll('[data-onion-scope]'))button.setAttribute('aria-pressed',String(button.dataset.onionScope===settings.onionScope));
    this.panel.style.setProperty('--onion-before',settings.onionBeforeColor);this.panel.style.setProperty('--onion-after',settings.onionAfterColor);
    this.panel.dataset.enabled=String(enabled);
    const toggle=this.panel.querySelector('[data-onion-toggle]');toggle.setAttribute('aria-checked',String(enabled));toggle.title=enabled?'Hide onion skin · O':'Show onion skin · O';
  }
  destroy(){this.controller.cancel(this);for(const field of this.fields)field.destroy();this.unsubscribe();this.events.abort();this.panel.remove();}
}
