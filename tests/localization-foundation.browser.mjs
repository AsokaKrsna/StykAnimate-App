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
