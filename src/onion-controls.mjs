import {icon} from './icons.mjs';
import {OnionFrameField} from './onion-frame-field.mjs';
import {setAttr, setFlag, setProp, setVar} from './ui/dom-write.mjs';
import {placeFloating} from './ui/anchor-position.mjs';

/** Settings view. All previews and commits go through the shared controller. */
export class OnionControls {
  constructor({button,toggleButton,controller}){
    Object.assign(this,{button,toggleButton,controller});this.events=new AbortController();
    const panel=this.panel=document.createElement('div');panel.className='onion-popover';panel.id='onion-popover';panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Onion skin settings');
    // The kit's popover (components/popover.css): the title with its on/off switch; the range (each side's
    // colour, name and stepper), how strong and for whom; the look as switch rows. Sampling and drawing order
    // stay folded under "More".
    const toggle=(key,label,hint)=>`<label class="ui-switch-row onion-check"${hint?` title="${hint}"`:''}><span>${label}</span><input type="checkbox" class="ui-switch" role="switch" data-onion="${key}" aria-label="${label}"></label>`;
    panel.classList.add('ui-popover');
    panel.innerHTML=`<header class="ui-popover-head"><strong class="ui-popover-title">${icon('onion')}Onion skin</strong><input type="checkbox" class="ui-switch onion-power" data-onion-toggle role="switch" aria-label="Show onion skin"><button type="button" class="ui-popover-close onion-close" aria-label="Close onion settings">${icon('close')}</button></header>
      <div class="ui-popover-body onion-body"><div class="onion-frame-pair"></div>
      <div class="ui-slider-row onion-opacity"><span class="ui-slider-label">Opacity</span><input class="ui-slider onion-slider" type="range" data-onion="onionOpacity" min="0" max="100" step="1" aria-label="Onion opacity slider"><label class="onion-value"><input type="number" data-onion="onionOpacity" min="0" max="100" step="1" aria-label="Onion opacity"><small>%</small></label></div>
      <div class="ui-segmented onion-scope" data-size="sm" data-fill role="group" aria-label="Onion figures"><button type="button" class="ui-segmented-item" data-onion-scope="all">All figures</button><button type="button" class="ui-segmented-item" data-onion-scope="selected">Selected</button></div>
      <div class="onion-looks">${toggle('onionTint','Tint','Tint earlier and later poses with their colors')}${toggle('onionFade','Fade','Fade poses further from the current frame')}</div>
      <details class="onion-more"><summary>More</summary><div class="onion-more-body"><div class="ui-row onion-row"><span class="ui-row-label">Sample</span><span class="ui-select" data-size="sm"><select data-onion="onionMode" aria-label="Onion sampling"><option value="keyframes">Poses</option><option value="frames">Every frame</option></select>${icon('chevron-down')}</span></div><div class="ui-row onion-row"><span class="ui-row-label">Every</span><label class="onion-value"><input class="onion-spacing" type="number" data-onion="onionStep" min="1" max="20" step="1" aria-label="Sample spacing"></label></div>
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
    // A right-click, or a press and hold on a touch screen (src/touch/long-press.mjs), on Onion opens its settings.
    on(toggleButton,'contextmenu',event=>{event.preventDefault();event.stopPropagation();this.sync(true);if(!panel.matches(':popover-open'))panel.showPopover();});
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
  /** Above the settings button, or above Onion where the header folds the button away (a phone's touch interface). */
  position(){const anchor=this.button.getClientRects().length?this.button:this.toggleButton;placeFloating(this.panel,anchor,{placement:'top-end',offset:8,overlap:true});}
  sync(force=false){
    const settings=this.controller.settings,enabled=this.controller.getEnabled(),range=this.controller.snapshot();
    // Runs on every editor change (each frame while playing): write only what changed.
    setAttr(this.toggleButton,'aria-pressed',String(enabled));setFlag(this.toggleButton,'active',enabled);
    for(const input of this.panel.querySelectorAll('[data-onion]')){
      const value=settings[input.dataset.onion];if(input.type==='checkbox')setProp(input,'checked',value);
      else if(force||document.activeElement!==input)setProp(input,'value',String(input.dataset.onion==='onionOpacity'?Math.round(value*100):value));
    }
    setVar(this.panel.querySelector('.onion-slider'),'--_p',`${Math.round(settings.onionOpacity*100)}%`);
    const unit=settings.onionMode==='frames'?'frames':'poses';
    // The count follows the playhead; it is read only while the popover shows, and opening it syncs first.
    if(force||this.panel.matches(':popover-open'))setAttr(this.panel,'title',`${range.before.count} earlier and ${range.after.count} later ${unit} shown at this frame`);
    for(const button of this.panel.querySelectorAll('[data-onion-scope]'))setAttr(button,'aria-pressed',String(button.dataset.onionScope===settings.onionScope));
    setVar(this.panel,'--onion-before',settings.onionBeforeColor);setVar(this.panel,'--onion-after',settings.onionAfterColor);
    setAttr(this.panel,'data-enabled',String(enabled));
    const toggle=this.panel.querySelector('[data-onion-toggle]');setProp(toggle,'checked',enabled);setAttr(toggle,'title',enabled?'Hide onion skin · O':'Show onion skin · O');
  }
  destroy(){this.controller.cancel(this);for(const field of this.fields)field.destroy();this.unsubscribe();this.events.abort();this.panel.remove();}
}
