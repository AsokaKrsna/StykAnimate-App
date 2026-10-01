import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('artifacts/localization-foundation');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:800}}), errors=[], checks=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',message=>{if (/^(?:ReferenceError|TypeError|SyntaxError):/.test(message.text())) errors.push(message.text());});
const check=(name,condition)=>{assert.ok(condition,name);checks.push(name);console.log('PASS',name);};
try {
  await page.goto(process.env.STYK_TEST_URL||'http://127.0.0.1:47831');
  await page.waitForFunction(()=>window.styk?.ready);
  await page.waitForFunction(()=>styk.assets.count.getAttribute('data-i18n')==='counts.figures');
  check('Asset library connects its count after startup without swallowed binding errors',await page.evaluate(()=>styk.assets.count.getAttribute('data-i18n')==='counts.figures'&&styk.assets.count.textContent===styk.localization.t('counts.figures',{count:styk.assets.records.length})));

  await page.evaluate(()=>{
    styk.editor.newDocument();
    window.baseline={report:JSON.stringify(styk.editor.report),undo:styk.editor._undo.length,revision:styk.editor.revision,tick:styk.editor.tick,uid:styk.editor.selectedUid};
    window.savedButton=document.querySelector('.titlebar [data-action=save]');window.savedIcon=savedButton.querySelector('svg');
  });
  await page.evaluate(async()=>{
    const {createToasts}=await import('/src/ui/ui-toast.mjs');
    window.taskToasts=createToasts({document});
    window.localizedTask=taskToasts.task({title:'Preparing canvas',titleKey:'app.preparingCanvas',meta:'Camera effects preview restored.',metaKey:'rendererStatus.effectsRestored',delay:0});
  });
  await page.waitForSelector('.ui-toast-progress');
  await page.evaluate(()=>{window.retainedStatus=document.querySelector('#status');styk.localization.localization.setPseudo('long');});
  check('Retained background, motion-path group and tween-type captions resolve their current language',await page.evaluate(()=>
    document.querySelector('#crumb-background').getAttribute('aria-label').includes('［')
    &&document.querySelector('.motion-path-tool').getAttribute('aria-label').includes('［')
    &&document.querySelector('#tweener-button').getAttribute('aria-label')===styk.localization.t('tweenerControls.tweener',{label:{messageKey:'tweenerControls.breakdown'}})
    &&document.querySelector('[data-tween-type=breakdown] span').textContent===styk.localization.t('tweenerControls.breakdown')
    &&document.querySelector('.tweener-hud').firstElementChild.textContent===styk.localization.t('tweenerControls.breakdown')
    &&document.querySelector('[data-tween-type=breakdown] path').getAttribute('d')==='M12 3 20 12 12 21 4 12Z'));
  check('Retained activity, delayed task captions and progress accessibility follow the language',await page.evaluate(()=>retainedStatus===document.querySelector('#status')&&retainedStatus.textContent.includes('［')&&document.querySelector('.ui-toast-text b').textContent.includes('［')&&document.querySelector('.ui-toast-progress').getAttribute('aria-label').includes('［')));
  await page.evaluate(()=>{window.onionCaption=document.querySelector('#onion-popover [data-i18n="onionControls.opacity"]');window.onionCaptionNode=onionCaption.firstElementChild;});
  await page.evaluate(async()=>{
    const {OnionFrameField}=await import('/src/onion-frame-field.mjs');
    const {appendLocalized}=await import('/src/localization-bindings.mjs');
    window.onionProbe=new OnionFrameField(styk.onionController,'before');appendLocalized(document.body,onionProbe.root);
    window.onionDraft=onionProbe.input;onionDraft.focus();onionDraft.value='23';
    window.onionRangeBefore=styk.state.settings.onionRangeBefore;
    styk.localization.localization.setPseudo('rtl');
  });
  check('Onion controls translate directions and plural values while preserving drafts and canonical preferences',await page.evaluate(()=>{
    const t=(key,params)=>styk.localization.t(key,params),direction={messageKey:'onionFrameField.before'};
    const marker=document.querySelector('.onion-range-end.before'),count=styk.onionController.snapshot().before.span;
    return onionProbe.root.dataset.direction==='before'&&onionProbe.key==='onionRangeBefore'
      &&document.activeElement===onionDraft&&onionDraft.value==='23'&&styk.state.settings.onionRangeBefore===onionRangeBefore
      &&onionProbe.scrub.textContent===t('onionFrameField.before')
      &&onionProbe.scrub.getAttribute('aria-label')===t('onionFrameField.dragFrames',{direction})
      &&onionDraft.getAttribute('aria-label')===t('onionFrameField.frames',{direction})
      &&onionProbe.root.querySelector('[data-step="-1"]').getAttribute('aria-label')===t('onionFrameField.decreaseFrames',{direction})
      &&onionProbe.root.querySelector('[data-step="1"]').getAttribute('aria-label')===t('onionFrameField.increaseFrames',{direction})
      &&marker.getAttribute('aria-label')===t('onionTimelineRange.onionFrames',{direction})
      &&marker.getAttribute('aria-valuetext')===t('counts.frames',{count})
      &&marker.title===t('onionTimelineRange.dragToChange',{spanLabel:{messageKey:'counts.frames',params:{count}}});
  }));
  check('Nested retained captions update their original slot without leaving English or adding duplicate text',await page.evaluate(()=>{
    const p=document.querySelector('#onion-popover'),keys=['opacity','allFigures','selected','more','sample','poses','everyFrame','every'];
    return onionCaption.firstElementChild===onionCaptionNode&&onionCaption.children.length===1
      &&keys.every(name=>p.querySelector(`[data-i18n="onionControls.${name}"]`).textContent===styk.localization.t(`onionControls.${name}`));
  }));
  await page.evaluate(async()=>{
    const {localizedMarkup,appendLocalized}=await import('/src/localization-bindings.mjs');
    window.captionProbe=document.createElement('button');
    localizedMarkup(captionProbe, '<svg aria-hidden="true"><path d="M1 1h2"></path></svg><span data-i18n="chrome.vfx">VFX</span><kbd>Ctrl+V</kbd>');
    captionProbe.dataset.i18n='chrome.vfx';appendLocalized(document.body,captionProbe);
    window.captionNodes=[...captionProbe.children];
    for(let cycle=0;cycle<4;cycle++)for(const locale of ['en','ar','he','de']){
      styk.localization.localization.setPseudo(null);styk.localization.setLocale(locale);
      styk.localization.apply(captionProbe);styk.localization.apply(document.querySelector('#onion-popover'));
      if(captionProbe.textContent!==styk.localization.t('chrome.vfx')+'Ctrl+V'
        ||document.querySelector('.onion-more summary').textContent!==styk.localization.t('onionControls.more'))throw new Error('Repeated caption after '+locale);
    }
  });
  check('Repeated language changes and subtree registration keep one VFX and More caption with original icon and shortcut nodes',await page.evaluate(()=>
    captionProbe.children.length===captionNodes.length&&captionNodes.every((node,index)=>captionProbe.children[index]===node)
    &&captionProbe.querySelector('kbd').textContent==='Ctrl+V'));
  await page.evaluate(()=>{captionProbe.remove();styk.localization.setLocale('en');});
  await page.evaluate(()=>onionProbe.destroy());
  await page.evaluate(()=>{localizedTask.done();taskToasts.destroy();styk.localization.localization.setPseudo(null);});
  await page.evaluate(async()=>{
    const {createAppDialogs}=await import('/src/app-dialogs.mjs');
    const actions={}, state={renderSamples:[],renderer:null};
    createAppDialogs({editor:styk.editor,state,actions,overlays:styk.ui.overlays,playbackMetrics:{snapshot:()=>({fps:null,startupMs:null,bufferingMs:12.35,bufferingEvents:1})},guarded:fn=>fn,pause(){},finishCurrentEdit(){},localization:()=>styk.localization});
    actions.performance();
  });
  await page.locator('#performance-dialog[open]').waitFor();
  check('Performance buffering uses a complete singular message',await page.locator('.metric-table tr').nth(3).locator('td').nth(1).textContent()==='12.4 ms · 1 wait');
  await page.evaluate(()=>{window.metricNodes=[...document.querySelectorAll('.metric-table td')];styk.localization.localization.setPseudo('rtl');});
  check('Retained performance names, initializing status and buffering summary follow the language without rebuilding the table',await page.evaluate(()=>{
    const cells=[...document.querySelectorAll('.metric-table td')];
    return metricNodes.every((node,index)=>node===cells[index])&&cells[0].textContent===styk.localization.t('appDialogs.renderer')
      &&cells[1].textContent===styk.localization.t('appDialogs.initializing')
      &&cells[7].textContent===styk.localization.t('appDialogs.bufferingSummary',{milliseconds:{format:'number',value:12.35,options:{minimumFractionDigits:1,maximumFractionDigits:1}},count:1});
  }));
  await page.locator('#performance-dialog .ui-dialog-close').click();
  await page.evaluate(async()=>{
    const {sliderMarkup}=await import('/src/drawing-sliders.mjs');
    const {pressureCurveMarkup,refreshPressureCurve}=await import('/src/drawing-pressure-curve.mjs');
    const {localizedMarkup,appendLocalized}=await import('/src/localization-bindings.mjs');
    window.drawingCaptionProbe=document.createElement('section');localizedMarkup(drawingCaptionProbe,sliderMarkup('size',10)+pressureCurveMarkup([.1,.5,.4,.95]));appendLocalized(document.body,drawingCaptionProbe);
    window.curveHandle=drawingCaptionProbe.querySelector('[data-pressure-handle]');curveHandle.focus();window.curvePosition=[curveHandle.getAttribute('cx'),curveHandle.getAttribute('cy')];
    styk.localization.localization.setPseudo('long');
    refreshPressureCurve(drawingCaptionProbe,[.1,.5,.4,.95]);
  });
  check('Drawing slider hints and pressure accessibility translate in place while graph geometry and focus stay unchanged',await page.evaluate(()=>{
    const probe=drawingCaptionProbe,t=(key,params)=>styk.localization.t(key,params);
    return document.activeElement===curveHandle&&curvePosition.every((value,index)=>value===curveHandle.getAttribute(index?'cy':'cx'))
      &&probe.querySelector('.draw-slider').getAttribute('aria-label')===t('drawingSliders.size')
      &&probe.querySelector('.draw-slider').title===t('drawingSliders.interactionHint',{name:{messageKey:'drawingSliders.size'}})
      &&probe.querySelector('.draw-pressure-graph').getAttribute('aria-label')===t('drawingPressureCurve.graphDescription')
      &&curveHandle.getAttribute('aria-valuetext')===t('drawingPressureCurve.handleValue',{pressure:10,response:50});
  }));
  await page.evaluate(()=>{drawingCaptionProbe.remove();styk.localization.localization.setPseudo(null);});
  await page.evaluate(async()=>{
    const {quickBarMarkup,drawingInspector}=await import('/src/drawing-view.mjs');
    const legacy=await import('/src/inspector-legacy.mjs'),{propertyToggle}=await import('/src/property-toggle.mjs');
    const {localizedMarkup,appendLocalized}=await import('/src/localization-bindings.mjs');
    const drawing=Object.create(styk.drawing);Object.defineProperty(drawing,'tool',{value:'brush'});
    window.drawingOwnerProbe=document.createElement('section');
    localizedMarkup(drawingOwnerProbe,quickBarMarkup(drawing)+drawingInspector(drawing,{...legacy,propertyToggle})+legacy.numericField('Scale','localization-test-scale',12.5,'%','',{}, {labelKey:'inspectorView.scale',legacyField:false}));
    appendLocalized(document.body,drawingOwnerProbe);
    window.drawingDraft=drawingOwnerProbe.querySelector('[data-property="localization-test-scale"]');drawingDraft.value='37.25';drawingDraft.focus();
    window.drawingProbeNodes=[...drawingOwnerProbe.querySelectorAll('input,button')];
    styk.localization.localization.setPseudo('rtl');
  });
  check('Drawing tool, section, toggle, palette and numeric captions translate without replacing controls or editing their drafts',await page.evaluate(()=>{
    const probe=drawingOwnerProbe,t=(key,params)=>styk.localization.t(key,params),nodes=[...probe.querySelectorAll('input,button')];
    const add=probe.querySelector('.draw-quick-add');
    return document.activeElement===drawingDraft&&drawingDraft.value==='37.25'&&drawingProbeNodes.every((node,index)=>node===nodes[index])
      &&probe.querySelector('.draw-quick-tool span').textContent===t('drawingView.brush')
      &&probe.querySelector('[data-i18n="drawingView.preset"]').textContent===t('drawingView.preset')
      &&probe.querySelector('#draw-alphaLock').getAttribute('aria-label')===t('drawingView.lockAlpha')
      &&drawingDraft.getAttribute('aria-label')===t('inspector.withUnit',{label:{messageKey:'inspectorView.scale'},unit:'%'})
      &&(!add||add.getAttribute('aria-label')===t('drawingView.addTo',{value:styk.drawing.settings.color.toUpperCase(),where:{messageKey:'colorPicker.projectColors'}}));
  }));
  await page.evaluate(()=>{drawingOwnerProbe.remove();styk.localization.localization.setPseudo(null);});
  await page.evaluate(async()=>{
    const {HotkeySettings}=await import('/src/hotkey-settings.mjs'),{DEFAULT_HOTKEYS}=await import('/src/hotkeys.mjs');
    const {localizedMarkup,appendLocalized}=await import('/src/localization-bindings.mjs');
    window.hotkeyOwnerProbe=document.createElement('section');window.hotkeyProbeValues=structuredClone(DEFAULT_HOTKEYS);
    const settings={dialog:hotkeyOwnerProbe,content:hotkeyOwnerProbe,value:{hotkeys:hotkeyProbeValues},commit(patch){this.value={...this.value,...patch};},render(){localizedMarkup(hotkeyOwnerProbe,hotkeyProbe.html());}};
    window.hotkeyProbe=new HotkeySettings(settings);settings.render();appendLocalized(document.body,hotkeyOwnerProbe);
    window.hotkeyReset=hotkeyOwnerProbe.querySelector('[data-hotkey-id="save"] [data-hotkey-reset]');hotkeyReset.focus();
    hotkeyProbe.assign('save',[],true);hotkeyProbe.assign('redo',['Mod+KeyZ']);
    window.hotkeyBindingsBefore=JSON.stringify(settings.value.hotkeys);
    styk.localization.localization.setPseudo('long');
  });
  check('Shortcut captions, reset hints, assignment and conflict names follow the locale while physical bindings stay unchanged',await page.evaluate(()=>{
    const t=(key,params)=>styk.localization.t(key,params),probe=hotkeyOwnerProbe;
    return JSON.stringify(hotkeyProbe.settings.value.hotkeys)===hotkeyBindingsBefore
      &&probe.querySelector('[data-hotkey-id="save"] .hotkey-name span').textContent===t('hotkeyCaptions.command.save')
      &&probe.querySelector('[data-hotkey-id="save"] [data-hotkey-reset]').getAttribute('aria-label')===t('hotkeySettings.resetShortcut',{label:{messageKey:'hotkeyCaptions.command.save'}})
      &&probe.querySelector('.hotkey-status').textContent===t('hotkeySettings.assignmentSummary',{label:{messageKey:'hotkeyCaptions.command.save'},bindings:{messageKey:'hotkeySettings.unassigned'}})
      &&probe.querySelector('.hotkey-conflict p').textContent.includes(t('common.undo'))
      &&probe.querySelector('.hotkey-group h4').textContent===t('hotkeyCaptions.category.projectEditing');
  }));
  await page.evaluate(()=>{hotkeyOwnerProbe.remove();styk.localization.localization.setPseudo(null);});
  await page.evaluate(async()=>{
    const {UpdateUI}=await import('/src/update-ui.mjs');
    window.updateProbe=new UpdateUI({getUpdateState:async()=>({status:'idle'}),onUpdateState(){return()=>{};}});
    await Promise.resolve();updateProbe.render({status:'downloading',version:'1.2.3',currentVersion:'1.2.2',percent:35,total:2097152,transferred:1048576});
    window.updateProgress=updateProbe.progress;styk.localization.localization.setPseudo('rtl');
  });
  check('Update progress and version captions translate in place with unchanged download values',await page.evaluate(()=>updateProbe.progress===updateProgress&&updateProgress.value===35
    &&updateProbe.title.textContent===styk.localization.t('updateUi.downloadingVersion',{version:'1.2.3'})
    &&updateProbe.detail.textContent===styk.localization.t('updateUi.downloadingProgressWithSize',{percent:35,transferred:{format:'number',value:1,options:{minimumFractionDigits:1,maximumFractionDigits:1}},total:{format:'number',value:2,options:{minimumFractionDigits:1,maximumFractionDigits:1}}})));
  await page.evaluate(()=>{updateProbe.element.remove();updateProbe.unsubscribe?.();styk.localization.localization.setPseudo(null);});
  await page.evaluate(async()=>{
    const {showTimelineMenu}=await import('/src/timeline-menu.mjs');
    window.timelineCaptionHost={_run:fn=>fn(),scroll:document.createElement('div')};document.body.append(timelineCaptionHost.scroll);
    window.timelineCaptionActionRan=false;
    showTimelineMenu(timelineCaptionHost,{clientX:220,clientY:200},[[{heading:'Frames 2–4',headingKey:'layerTimeline.framesRange',headingParams:{first:2,last:4}},
      {label:'Remove frames',labelKey:'layerTimeline.removeFrames',shortcut:'Ctrl+Delete',action:()=>{timelineCaptionActionRan=true;}}]]);
    window.timelineCaptionRow=timelineCaptionHost.menu.element.querySelector('[role="menuitem"]');timelineCaptionRow.focus();
    styk.localization.localization.setPseudo('rtl');
  });
  check('Timeline menu headings and command captions retain their keys, parameters, focus and physical shortcut',await page.evaluate(()=>{
    const root=timelineCaptionHost.menu.element;
    return timelineCaptionRow===root.querySelector('[role="menuitem"]')&&document.activeElement===timelineCaptionRow
      &&root.querySelector('[data-i18n="layerTimeline.framesRange"]').textContent===styk.localization.t('layerTimeline.framesRange',{first:2,last:4})
      &&root.querySelector('[data-i18n="layerTimeline.removeFrames"]').textContent===styk.localization.t('layerTimeline.removeFrames')
      &&root.querySelector('kbd').textContent==='Ctrl+Delete';
  }));
  await page.evaluate(()=>timelineCaptionRow.click());
  check('Localized timeline menu commands retain their action',await page.evaluate(()=>timelineCaptionActionRan));
  await page.evaluate(()=>{timelineCaptionHost.scroll.remove();styk.localization.localization.setPseudo(null);});
  await page.locator('.brand[data-action=menu]').click();
  await page.locator('#menu [data-action=save]').focus();
  await page.evaluate(()=>{window.menuRow=document.activeElement;styk.localization.localization.setPseudo('long');});
  check('Open menu rows update long captions while retaining focus, row and shortcut nodes',await page.evaluate(()=>document.activeElement===menuRow&&menuRow.isConnected&&menuRow.querySelector('span').textContent.includes('［')&&menuRow.querySelector('kbd').textContent==='Ctrl+S'));
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
    const {createDialog}=await import('/src/ui/ui-dialog.mjs');
    const {messageError}=await import('/src/localized-error.mjs');
    const {localizedText}=await import('/src/localization-bindings.mjs');
    const body=document.createElement('div');body.style.cssText='max-height:180px;overflow:auto';
    const label=document.createElement('label');localizedText(label,'common.name');
    const input=document.createElement('input');input.type='text';input.dataset.localizationDraft='';input.value='Draft العربية 中文 123.45';input.autofocus=true;
    label.append(input);body.append(label);const spacer=document.createElement('div');spacer.style.height='400px';body.append(spacer);
    window.testDialog=createDialog({title:'Name',titleKey:'common.name',description:'Change name',descriptionKey:'app.renameProject',descriptionParams:{name:'My animation'},body,actions:[{label:'Cancel',labelKey:'common.cancel',cancel:true},{label:'Save',labelKey:'common.save',value:'save',variant:'primary'}]});
    window.ownedError=messageError(new RangeError(), 'errors.exportRequest.chooseASizePreset');
    testDialog.setError(ownedError);
    testDialog.showModal();window.draftInput=input;window.scrollBody=body;input.focus();input.setSelectionRange(2,7);body.scrollTop=33;
    window.dialogTitle=testDialog.element.querySelector('.ui-dialog-title');
  });
  await page.evaluate(()=>styk.localization.localization.setPseudo('rtl'));
  check('RTL changes retained dialog captions without losing draft, selection, focus or scroll',await page.evaluate(()=>document.activeElement===draftInput&&draftInput.value==='Draft العربية 中文 123.45'&&draftInput.selectionStart===2&&draftInput.selectionEnd===7&&scrollBody.scrollTop===33&&dialogTitle===testDialog.element.querySelector('.ui-dialog-title')&&dialogTitle.textContent.includes('اختبار')));
  check('Open dialog errors follow the language while diagnostics retain their English identity',await page.evaluate(()=>testDialog.element.querySelector('.ui-dialog-error').textContent.includes('اختبار')&&ownedError.message==='Choose a size preset.'));
  check('Interface follows RTL and physical canvas and timeline retain LTR coordinates',await page.evaluate(()=>document.documentElement.dir==='rtl'&&getComputedStyle(testDialog.element).direction==='rtl'&&getComputedStyle(document.querySelector('#viewport')).direction==='ltr'&&getComputedStyle(document.querySelector('#timeline')).direction==='ltr'));
  check('Locale changes leave document, undo, selection, animation tick and original chrome nodes intact',await page.evaluate(()=>{const e=styk.editor,b=baseline;return JSON.stringify(e.report)===b.report&&e._undo.length===b.undo&&e.revision===b.revision&&e.tick===b.tick&&e.selectedUid===b.uid&&savedButton===document.querySelector('.titlebar [data-action=save]')&&savedButton.querySelector('svg')===savedIcon;}));
  await page.screenshot({path:path.join(output,'rtl-desktop-dialog.png')});
  await page.setViewportSize({width:390,height:740});
  await page.evaluate(()=>styk.localization.localization.setPseudo('long'));
  check('Long dialog labels fit a narrow viewport without horizontal clipping',await page.evaluate(()=>{const d=testDialog.element,b=d.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&d.scrollWidth<=d.clientWidth+1&&[...d.querySelectorAll('.ui-dialog-foot button')].every(x=>x.scrollWidth<=x.clientWidth+1&&x.scrollHeight<=x.clientHeight+1);}));
  await page.screenshot({path:path.join(output,'long-narrow-dialog.png')});
  await page.evaluate(()=>styk.localization.localization.setPseudo(null));
  await page.locator('.ui-dialog-foot button').last().click();
  check('Localized action captions preserve the explicit result value',await page.evaluate(()=>testDialog.result.then(value=>value==='save')));
  await page.setViewportSize({width:1280,height:800});
  await page.evaluate(()=>styk.localization.localization.setPseudo('long'));
  check('Inspector numeric and quick-action captions connect to pseudolocalization',await page.evaluate(()=>document.querySelector('#inspector [data-i18n="inspectorView.scale"]')?.textContent.includes('［')&&![...document.querySelectorAll('[data-i18n]')].some(x=>/^(?:quick|drawing)\.[a-zA-Z]+$/.test(x.textContent.trim()))));
  await page.screenshot({path:path.join(output,'long-editor.png')});
  await page.setViewportSize({width:390,height:740});
  await page.locator('.brand[data-action=menu]').click();
  await page.locator('#menu [data-action=settings]').click();
  for (const pseudo of ['long','rtl']) {
    await page.evaluate(mode=>styk.localization.localization.setPseudo(mode),pseudo);
    check(`${pseudo}: Settings content fits a narrow window`,await page.locator('.styk-settings-content').evaluate(x=>x.scrollWidth<=x.clientWidth+1));
  }
  await page.evaluate(()=>{
    styk.ui.toasts.clear();
    styk.ui.toasts.show({titleKey:'app.restoreUnsavedWork',messageKey:'app.recoveryOffer',messageParams:{name:'My animation',time:{format:'date',value:Date.UTC(2026,0,1)}},timeout:0,actions:[{labelKey:'common.cancel',run(){}},{labelKey:'common.save',run(){}},{labelKey:'common.name',run(){}}]});
    styk.localization.localization.setPseudo('long');
  });
  check('Expanded notification text and actions fit a narrow dialog',await page.locator('.ui-toast').evaluate(x=>x.clientHeight<innerHeight/2&&x.scrollWidth<=x.clientWidth+1&&x.querySelector('.ui-toast-text').clientWidth>80));
  await page.screenshot({path:path.join(output,'long-narrow-settings-notification.png')});
  await page.evaluate(()=>styk.ui.toasts.clear());
  await page.locator('.styk-settings-close').click();
  await page.evaluate(()=>styk.localization.localization.setPseudo(null));
  await page.locator('.titlebar [data-action=export]').click();
  await page.locator('#export-dialog[open]').waitFor();
  await page.locator('#export-resolution').selectOption('custom');
  await page.locator('#export-width').fill('128.');
  await page.evaluate(()=>{window.exportDraft=document.querySelector('#export-width');window.exportName=document.querySelector('#export-name');exportDraft.setSelectionRange(1,3);window.exportScroll=document.querySelector('#export-dialog .ui-dialog-body');exportScroll.scrollTop=23;});
  for (const pseudo of ['long','rtl']) {
    await page.evaluate(mode=>styk.localization.localization.setPseudo(mode),pseudo);
    check(`${pseudo}: Export preserves numeric drafts, selection, control identity and scroll`,await page.evaluate(()=>document.activeElement===exportDraft&&exportDraft.value==='128.'&&exportDraft.selectionStart===1&&exportDraft.selectionEnd===3&&document.querySelector('#export-name')===exportName&&exportScroll.scrollTop===23));
    check(`${pseudo}: Export preset and category captions update and wrap in a narrow window`,await page.evaluate(()=>{const d=document.querySelector('#export-dialog');return d.scrollWidth<=d.clientWidth+1&&[...d.querySelectorAll('.export-preset-label')].every(x=>x.textContent.includes('［')&&getComputedStyle(x).whiteSpace==='normal')&&d.querySelector('[data-category=video]').textContent.includes('［')&&[...d.querySelectorAll('#export-format button')].every(x=>x.scrollWidth<=x.clientWidth+1&&x.scrollHeight<=x.clientHeight+1);}));
  }
  await page.screenshot({path:path.join(output,'rtl-narrow-export.png')});
  await page.locator('#export-dialog .ui-dialog-close').click();

  await page.setViewportSize({width:1280,height:800});
  const fontEvidence=await page.evaluate(async()=>{
    styk.localization.localization.setPseudo(null);
    const samples={ar:'العربية',he:'עברית','zh-Hans':'中文',ru:'Русский',it:'È già così'};
    const results=[];
    for(const [locale,text] of Object.entries(samples)){
      styk.localization.setLocale(locale);const sample=document.createElement('span');sample.textContent=text;sample.style.font='24px var(--font-ui)';document.body.append(sample);
      await document.fonts.ready;results.push({locale,text,font:getComputedStyle(sample).fontFamily,width:sample.getBoundingClientRect().width,loaded:document.fonts.check('24px '+getComputedStyle(sample).fontFamily,text)});sample.remove();
    }
    styk.localization.setLocale('en');return results;
  });
  check('Representative script samples have loaded fallback fonts and measurable glyphs',fontEvidence.every(x=>x.loaded&&x.width>0));
  await page.evaluate(async()=>{
    const {SupportCenter}=await import('/src/support-center.mjs');
    const {supportErrorMessage}=await import('/src/support-localization.mjs');
    window.supportRoot=document.createElement('section');supportRoot.style.cssText='position:fixed;inset:24px;z-index:9999;background:white;overflow:auto';document.body.append(supportRoot);
    window.supportProbe=new SupportCenter(supportRoot,{api:async path=>path==='/config'?{limits:{fileBytes:8388608}}:{threads:[],nextCursor:null}});
    await supportProbe.start();supportProbe.notice(supportErrorMessage({code:'invalid_message'}),true);
    window.supportDraft=supportRoot.querySelector('[name=title]');supportDraft.value='Unsent draft';supportDraft.focus();supportDraft.setSelectionRange(1,5);
    window.supportCategory=supportRoot.querySelector('[name=category]');supportCategory.value='idea';
    window.supportFrequency=supportRoot.querySelector('[name=frequency]');supportFrequency.value='Every time';
    styk.localization.localization.setPseudo('rtl');
  });
  check('Support notices and options update in place without changing drafts or service values',await page.evaluate(()=>document.activeElement===supportDraft&&supportDraft.value==='Unsent draft'&&supportDraft.selectionStart===1&&supportDraft.selectionEnd===5&&supportCategory.value==='idea'&&supportFrequency.value==='Every time'&&supportCategory.selectedOptions[0].textContent.includes('اختبار')&&supportRoot.querySelector('.sc-notice').textContent.includes('اختبار')));
  const supportBusy=await page.evaluate(()=>{
    const submit=supportRoot.querySelector('[data-create] [type=submit]');const key=submit.getAttribute('data-i18n');
    supportProbe.setBusy(true,{messageKey:'supportCenter.exporting'});styk.localization.localization.setPseudo('long');const changed=submit.textContent.includes('［');supportProbe.setBusy(false);
    return changed&&submit.getAttribute('data-i18n')===key&&submit.textContent.includes('［');
  });
  check('Support busy captions translate and restore the original submit action',supportBusy);
  await page.evaluate(()=>{supportProbe.dispose();supportRoot.remove();styk.localization.localization.setPseudo(null);});
  for (const soundCount of [0,1,3]) {
    await page.evaluate(async count=>{
      const {openExportSheet}=await import('/src/export-sheet.mjs');
      window.soundCountProbe=count;
      window.soundOwnerSheet=openExportSheet({context:{canvasWidth:640,canvasHeight:360,totalFrames:12,fps:24,name:'Sound fixture',soundNames:Array.from({length:count},(_,index)=>index?'Sound '+index:'My sound.wav'),audioClips:Array.from({length:count},()=>({start:0,duration:1})),audioSupported:true},onExport(){}});
      window.soundCaption=soundOwnerSheet.element.querySelector('#export-audio').previousElementSibling;
      window.soundFilename=soundOwnerSheet.element.querySelector('#export-name');soundFilename.focus();soundFilename.value='Artist file';soundFilename.dispatchEvent(new Event('input',{bubbles:true}));soundFilename.setSelectionRange(2,5);
      styk.localization.localization.setPseudo('long');
    },soundCount);
    check(`Export sound caption (${soundCount}) translates counts while retaining authored names and drafts`,await page.evaluate(()=>
      soundCaption===soundOwnerSheet.element.querySelector('#export-audio').previousElementSibling
      &&soundCaption.textContent===(soundCountProbe===1?'My sound.wav':styk.localization.t(soundCountProbe?'exportSheet.soundCount':'exportSheet.includeSound',{count:soundCountProbe}))
      &&document.activeElement===soundFilename&&soundFilename.value==='Artist file'&&soundFilename.selectionStart===2&&soundFilename.selectionEnd===5&&soundOwnerSheet.request.width===640
      &&soundOwnerSheet.element.querySelector('[for="export-width"]').textContent===styk.localization.t('exportSheet.width')));
    await page.evaluate(async()=>{soundOwnerSheet.close();await soundOwnerSheet.closed;styk.localization.localization.setPseudo(null);});
  }
  await page.evaluate(async()=>{
    const {UserLibrary}=await import('/src/user-library.mjs');
    const {appendLocalized}=await import('/src/localization-bindings.mjs');
    window.libraryData={id:'artist-asset',source:'public',kind:'figure',name:'My character.stkz',author:'Artist العربية',description:'An authored description'};
    window.libraryDataBefore=JSON.stringify(libraryData);
    window.publicCard=UserLibrary.prototype.card.call({},libraryData);
    window.localClipCard=UserLibrary.prototype.card.call({},{path:'My clip.stykmov',kind:'movieclip',name:'My clip.stykmov'});
    appendLocalized(document.body,publicCard);appendLocalized(document.body,localClipCard);
    window.libraryIcon=publicCard.querySelector('svg');publicCard.focus();
    styk.localization.localization.setPseudo('rtl');
  });
  check('Public library author grammar and movieclip hover instructions follow the locale while preserving authored data, focus and icons',await page.evaluate(()=>
    publicCard.title===styk.localization.t('userLibrary.publicAssetByAuthor',{name:libraryData.name,author:libraryData.author,description:': '+libraryData.description})
    &&localClipCard.title===styk.localization.t('userLibrary.nameDoubleClickToInsertOrDragOntoThe',{name:'My clip.stykmov',value1:{messageKey:'userLibrary.hoverToPlay2'}})
    &&publicCard.querySelector('.library-name').textContent==='My character.stkz'&&publicCard.dataset.publicId==='artist-asset'
    &&JSON.stringify(libraryData)===libraryDataBefore&&document.activeElement===publicCard&&publicCard.querySelector('svg')===libraryIcon));
  await page.evaluate(()=>{publicCard.remove();localClipCard.remove();styk.localization.localization.setPseudo(null);});
  await page.evaluate(async()=>{
    const {createDockKeyboard}=await import('/src/shell/dock-keyboard.mjs');
    window.dockMoves=[];window.dockSpeech=[];
    window.dockDraft=document.createElement('input');dockDraft.value='Panel draft';document.body.append(dockDraft);dockDraft.focus();dockDraft.setSelectionRange(1,4);
    window.dockProbe=createDockKeyboard({host:{registry:new Map([['properties',{title:'Properties',titleKey:'shell.panel.properties'}]]),canPlace:()=>true,presentation:()=> 'docked',solution:{panels:{properties:{side:'right'}}},workspace:{float:id=>dockMoves.push(['float',id]),dock:(id,target)=>dockMoves.push(['dock',id,target])},showPanel(){}},announce:text=>dockSpeech.push(text)});
    dockProbe.startMove('properties');window.dockCaption=document.querySelector('.shell-drop .ui-drop-label');
    styk.localization.localization.setPseudo('rtl');
  });
  check('Keyboard panel-move preview follows RTL in its original caption without moving the panel or disturbing focus and drafts',await page.evaluate(()=>
    dockCaption.textContent===styk.localization.t('dockKeyboard.floatHere')&&dockMoves.length===0
    &&document.activeElement===dockDraft&&dockDraft.value==='Panel draft'&&dockDraft.selectionStart===1&&dockDraft.selectionEnd===4));
  await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})));
  check('Keyboard movement keeps physical arrow choices and announces the current localized placement',await page.evaluate(()=>
    dockCaption===document.querySelector('.shell-drop .ui-drop-label')&&dockProbe.moving.target==='left'
    &&dockCaption.textContent===styk.localization.t('dockKeyboard.dockLeft')&&dockSpeech.at(-1)===styk.localization.t('dockKeyboard.dockLeft')));
  await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  check('Keyboard placement preserves the canonical panel and side while announcing its translated title',await page.evaluate(()=>
    JSON.stringify(dockMoves)===JSON.stringify([['dock','properties','left']])
    &&dockSpeech.at(-1)===styk.localization.t('dockKeyboard.panelLocation',{title:{messageKey:'shell.panel.properties'},place:{messageKey:'dockKeyboard.dockLeft'}})));
  await page.evaluate(()=>{dockProbe.destroy();dockDraft.remove();styk.localization.localization.setPseudo(null);});
  await page.evaluate(async()=>{
    const {VfwExportControls}=await import('/src/vfw-export-controls.mjs');const {appendLocalized}=await import('/src/localization-bindings.mjs');
    window.vfwDesktopBefore=window.stykDesktop;
    window.vfwCapabilities={platform:'win32',codecs:[{id:'vfw:x64:00000000',label:'Artist codec (64-bit)',fourcc:'DIB ',provider:'Windows VFW',supported:false,reason:'Original English capability reason',reasonKey:'vfwExportControls.codecDoesNotAcceptFrames',reasonParams:{width:160,height:90}}],reason:'Original English check reason',reasonKey:'vfwExportControls.codecCheckFailure',reasonParams:{details:{format:'list',value:[{messageKey:'vfwExportControls.invalidCodecTable',messageParams:{arch:'x86'}},'External driver detail'],options:{type:'unit'}}}};
    window.stykDesktop={getVfwCapabilities:async()=>structuredClone(vfwCapabilities)};
    window.vfwDialog=document.createElement('dialog');appendLocalized(document.body,vfwDialog);vfwDialog.showModal();
    window.vfwProbe=new VfwExportControls({container:vfwDialog,dialog:vfwDialog,getDimensions:()=>({width:160,height:90})});
  });
  await page.waitForFunction(()=>vfwProbe.loadedKey==='160:90'&&vfwProbe.status.getAttribute('data-i18n')==='vfwExportControls.codecCheckFailure');
  await page.evaluate(()=>{window.vfwStatus=vfwProbe.status;window.vfwOption=vfwProbe.select.options[0];styk.localization.localization.setPseudo('rtl');});
  check('Owned Windows codec reasons translate in retained controls while external driver details, codec names and IDs remain raw',await page.evaluate(()=>
    vfwStatus===vfwProbe.status&&vfwStatus.textContent===styk.localization.t(vfwCapabilities.reasonKey,vfwCapabilities.reasonParams)
    &&vfwStatus.textContent.includes('External driver detail')&&vfwOption===vfwProbe.select.options[0]
    &&vfwOption.title===styk.localization.t('vfwExportControls.codecDoesNotAcceptFrames',{width:160,height:90})
    &&vfwOption.textContent==='Artist codec (64-bit)'&&vfwOption.value==='vfw:x64:00000000'&&vfwOption.disabled));
  await page.evaluate(()=>{vfwProbe.dispose();vfwDialog.close();vfwDialog.remove();window.stykDesktop=vfwDesktopBefore;styk.localization.localization.setPseudo(null);});
  await page.evaluate(async()=>{
    const {Editor}=await import('/src/editor.mjs');const {emptyDocument}=await import('/src/demo.mjs');const {vfxProperty}=await import('/src/vfx.mjs');
    const {openVfxChannelMenu}=await import('/src/vfx-key-channel-menu.mjs');
    window.effectEditor=new Editor({demo:false}).load(emptyDocument());const id=effectEditor.addVfxClip({kind:'scene'},'glow');const clip=effectEditor.getVfxClips()[0],effect=clip.effects[0];
    for(const parameter of ['radius','intensity'])effectEditor.setVfxClipParameter(id,effect.id,parameter,1,{key:true,tick:0});
    window.effectBytes=JSON.stringify(effectEditor.report);window.effectUndo=effectEditor._undo.length;
    window.effectAnchor=document.createElement('button');effectAnchor.textContent='Effect keys';document.body.append(effectAnchor);window.closeEffects=openVfxChannelMenu(effectEditor,effectEditor.getVfxClips()[0],effectAnchor);
    window.effectInput=document.querySelector('.vfx-channel-menu [data-channel-property]');effectInput.focus();window.effectProperty=effectInput.dataset.channelProperty;styk.localization.localization.setPseudo('long');
  });
  check('Effect-channel picker retains focus, key IDs and document history while captions change',await page.evaluate(()=>document.activeElement===effectInput&&effectInput.dataset.channelProperty===effectProperty&&effectInput.closest('label').textContent.includes('［')&&JSON.stringify(effectEditor.report)===effectBytes&&effectEditor._undo.length===effectUndo));
  await page.evaluate(()=>{closeEffects();effectAnchor.remove();styk.localization.localization.setPseudo(null);});
  check('No uncaught errors in retained dialog, menu, RTL and pseudolocalization workflows',errors.length===0);
  await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,fontEvidence},null,2));
} catch(e){await page.screenshot({path:path.join(output,'failure.png')});await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,failure:e.message},null,2));throw e;}
finally{await browser.close();}
