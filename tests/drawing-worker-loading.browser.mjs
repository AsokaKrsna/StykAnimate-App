import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const output=process.env.STYK_LOADING_ARTIFACTS||'artifacts/drawing-preparation-reuse';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext(),page=await context.newPage(),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
const pattern='**/src/drawing-worker-operations.mjs';let loads=0,releaseLoad,startedLoad;
try{
 await context.route(pattern,route=>{loads++;return route.abort('failed');});
 await page.goto(process.env.STYK_URL||'http://127.0.0.1:47839');await page.waitForFunction(()=>window.styk?.ready);
 await page.evaluate(async()=>{
  const {DrawingResources}=await import('/src/drawing-resources.mjs');window.loadingOwner=new DrawingResources({figure_types:[]},{history:false});loadingOwner.busy=true;
  window.prepareSample=()=>loadingOwner.worker.request('prepare-tiles',{tiles:[{tx:0,ty:0,pixels:new Uint8ClampedArray([31,63,95,1]).buffer}]});
  window.encodeSample=options=>loadingOwner.worker.request('encode-tiles',{celId:'loading-test',keep:['0,0'],tiles:[{tx:0,ty:0,pixels:Uint8ClampedArray.from({length:16384},(_,i)=>[31,63,95,1][i%4]).buffer}]},options);
 });
 check('a cold preparation works without loading codecs or other pixel operations',await page.evaluate(async()=>{const r=await prepareSample();return r.tiles[0].pixels.byteLength===16384&&new Uint8Array(r.tiles[0].pixels).every((v,i)=>v===[31,63,95,1][i%4]);})&&loads===0);
 check('invalid preparation rejects only its request and the worker remains usable',await page.evaluate(async()=>{const worker=loadingOwner.worker.worker;const error=await loadingOwner.worker.request('prepare-tiles',{tiles:[{tx:0,ty:0,pixels:new ArrayBuffer(8)}]}).then(()=>null,e=>e.message);await prepareSample();return error?.includes('Invalid')&&loadingOwner.worker.worker===worker&&loadingOwner.worker.pending.size===0;}));
 check('failed lazy loading rejects every pending request and releases the failed worker',await page.evaluate(async()=>{window.failedLoadingWorker=loadingOwner.worker.worker;window.failedLoadingId=loadingOwner.worker.next;const results=await Promise.allSettled([encodeSample(),loadingOwner.worker.request('thumbnail',{tiles:[]})]);return results.every(r=>r.status==='rejected')&&!loadingOwner.worker.worker&&loadingOwner.worker.pending.size===0;})&&loads>0);
 await context.unroute(pattern);
 check('retry after a module failure publishes and decodes exact translucent pixels',await page.evaluate(async()=>{const encoded=await encodeSample(),decoded=await loadingOwner.worker.request('decode-tiles',{url:encoded.blobUrl});return decoded.tiles.length===1&&new Uint8Array(decoded.tiles[0].pixels).every((v,i)=>v===[31,63,95,1][i%4]);}));
 check('a late failure from a retired worker cannot close its replacement',await page.evaluate(()=>{const worker=loadingOwner.worker.worker;failedLoadingWorker.onmessage({data:{id:failedLoadingId,error:'Late module failure',fatal:true}});return loadingOwner.worker.worker===worker;}));
 check('the lazily loaded encoder keeps its tile cache across requests',await page.evaluate(async()=>{const result=await loadingOwner.worker.request('encode-tiles',{celId:'loading-test',keep:['0,0'],tiles:[]});return result.encoded===0&&result.reused===1;}));
 await page.evaluate(()=>loadingOwner.worker.dispose());
 const started=new Promise(resolve=>startedLoad=resolve);
 await context.route(pattern,async route=>{startedLoad();await new Promise(resolve=>releaseLoad=resolve);await route.continue().catch(()=>{});});
 await page.evaluate(()=>{window.loadingAbort=new AbortController();window.loadingPending=encodeSample({signal:loadingAbort.signal}).then(()=>null,e=>e.name);});await started;
 await page.evaluate(()=>loadingAbort.abort());releaseLoad();await context.unroute(pattern);
 check('cancellation during module loading releases the worker and pending request',await page.evaluate(async()=>await loadingPending==='AbortError'&&!loadingOwner.worker.worker&&loadingOwner.worker.pending.size===0));
 check('retry after cancelling module loading uses a fresh worker successfully',await page.evaluate(async()=>Boolean((await encodeSample()).blobUrl)));
 check('no uncaught browser errors',errors.length===0);
 await writeFile(output+'/worker-loading.json',JSON.stringify({checks,errors,browser:browser.version()},null,2));
}finally{releaseLoad?.();await page.evaluate(()=>loadingOwner?.dispose()).catch(()=>{});await browser.close();}
