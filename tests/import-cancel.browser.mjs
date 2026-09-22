import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();await page.goto(process.env.STYK_URL||'http://127.0.0.1:47843');await page.waitForFunction(()=>window.styk?.ready);
  await page.evaluate(async()=>{
    const {emptyDocument}=await import('/src/demo.mjs'),{buildContainerV2}=await import('/src/native-container.mjs');
    const source=emptyDocument();source._styk={...source._styk,format:'StykAnimate',format_version:1};
    const bytes=await buildContainerV2(source,'styk');styk.telemetry.configure({analytics:true,diagnostics:true});
    styk.editor.updateProject({fps:31});window.beforeImport=styk.editor.report;
    window.cancelledImport=styk.importFiles([new File([bytes],'cancelled.styk')]);
  });
  await page.locator('#keep-editing').click();
  const result=await page.evaluate(async()=>({result:await window.cancelledImport,sameDocument:styk.editor.report===window.beforeImport,dirty:styk.editor.dirty,counters:styk.telemetry.data.counters,outcomes:styk.telemetry.data.operationContexts.filter(r=>r.operation==='import'&&r.stage==='complete').map(r=>r.outcome)}));
  assert.equal(result.result,false);assert.ok(result.sameDocument&&result.dirty);
  assert.equal(result.counters.import_started,1);assert.equal(result.counters.import_cancelled,1);assert.equal(result.counters.import_succeeded,undefined);assert.equal(result.counters.import_failed,undefined);assert.deepEqual(result.outcomes,['cancelled']);
  console.log('Cancelled native import preserves unsaved document and records exactly one cancellation.');
  // Dismissing the unsaved-changes prompt without a button also keeps the project;
  // the dialog close button previously left the import waiting forever.
  for(const dismiss of [()=>page.locator('#dialog [data-action="close-dialog"]').click(),()=>page.keyboard.press('Escape')]){
    await page.evaluate(async()=>{const {emptyDocument}=await import('/src/demo.mjs'),{buildContainerV2}=await import('/src/native-container.mjs');
      window.dismissedImport=styk.importFiles([new File([await buildContainerV2(emptyDocument(),'styk')],'dismissed.styk')]);});
    await page.locator('#keep-editing').waitFor();await dismiss();
    const dismissed=await page.evaluate(async()=>({result:await Promise.race([window.dismissedImport,new Promise(r=>setTimeout(()=>r('pending'),5000))]),sameDocument:styk.editor.report===window.beforeImport}));
    assert.deepEqual(dismissed,{result:false,sameDocument:true});
  }
  console.log('Closing or escaping the unsaved-changes prompt cancels the import.');
}finally{await browser.close();}
