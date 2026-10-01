import {chromium} from './support/playwright.mjs';
import backend from '../desktop/backend.cjs';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const output=path.resolve(process.env.STYK_ZOOM_GESTURE_OUTPUT??'artifacts/zoom-gesture');
const files=['src/renderer.mjs','src/renderer-geometry.mjs','src/renderer-raster-cache.mjs','src/raster-view.mjs','tests/renderer-zoom-gesture-fixture.mjs'];
const fingerprints=async()=>Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const sources=await fingerprints(),service=await backend.startBackend({appRoot:process.cwd()});
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.origin+'/api/health');
  const reports=await page.evaluate(async()=>{
    const {zoomGestureState,zoomGestureDrawing}=await import('/tests/renderer-zoom-gesture-fixture.mjs');
    const reports=[];
    for(const forceCanvas2D of [false,true]){
      reports.push(await zoomGestureState({forceCanvas2D}));
      reports.push(await zoomGestureDrawing({forceCanvas2D}));
    }
    return reports;
  });
  assert.deepEqual(errors,[]);
  assert.deepEqual(await fingerprints(),sources,'Measured files changed during verification; repeat with stable bytes.');
  await mkdir(output,{recursive:true});
  await writeFile(path.join(output,'quality.json'),JSON.stringify({measuredAt:new Date().toISOString(),node:process.version,browser:browser.version(),sources,reports,errors},null,2));
  console.log(JSON.stringify({output,checks:reports.reduce((count,report)=>count+report.checks.length,0),backends:[...new Set(reports.map(report=>report.backend))],errors}));
}finally{await browser?.close();service.stop();}
