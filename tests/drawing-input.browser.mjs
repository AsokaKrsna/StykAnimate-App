// Tablet and touch input through Chrome's real input pipeline (DevTools Input
// domain): pen pressure drives the brush, the pen's eraser end erases, a
// palm touch right after pen use never paints or pans, and two fingers
// pinch-zoom around their midpoint. Physical drivers are outside this check.
import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';

const url=process.env.STYK_URL||'http://127.0.0.1:47839',checks=[],errors=[];
const check=(name,value,detail)=>{assert.ok(value,`${name}${detail===undefined?'':` ${JSON.stringify(detail)}`}`);checks.push(name);console.log('PASS',name);};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForFunction(()=>window.styk?.ready);
  await page.evaluate(()=>{styk.state.settings.autosaveSeconds=0;});
  await page.locator('[data-workspace-mode="draw"]').click();
  await page.locator('[data-draw-action="new"]').first().click();
  await page.locator('[data-tool="drawing-brush"]').click();
  await page.evaluate(()=>styk.state.renderer?.gpuDrawingReady);
  await page.evaluate(()=>{
    Object.assign(styk.drawing.settings,{preset:'ink',size:24,color:'#202020',opacity:1,flow:1,hardness:1,pressureSize:true,pressureOpacity:false,stabilization:0,texture:0,scatter:0,roundness:1,blend:'normal',alphaLock:false});
    window.alphaAt=(x,y)=>{const d=styk.drawing,t=styk.editor.drawingTarget();if(!t.figure)return 0;const p=d.pixel({clientX:x,clientY:y},t);return d.owner.entry(t.figure).store?.pixel(Math.floor(p.x),Math.floor(p.y))[3]??0;};
    // Ink thickness across a horizontal stroke at x: rows with visible alpha.
    window.thickness=(x,y)=>{let n=0;for(let dy=-40;dy<=40;dy++)if(alphaAt(x,y+dy)>100)n++;return n;};
  });
  const settle=()=>page.waitForFunction(()=>!styk.drawing.gesture&&!styk.drawing.operation&&!styk.drawing.loading,null,{timeout:30000});
  const cdp=await page.context().newCDPSession(page);
  const box=await page.locator('#viewport').boundingBox(),cx=box.x+box.width/2,cy=box.y+box.height/2;
  const pen=(type,x,y,{pressure=.5,buttons=1,button='left',tiltX=0,tiltY=0}={})=>cdp.send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'&&!buttons?'none':button,buttons,clickCount:type==='mouseMoved'?0:1,pointerType:'pen',force:pressure,tiltX,tiltY});
  const penStroke=async(x0,y,x1,{pressure,button='left',buttons=1}={})=>{
    await pen('mouseMoved',x0,y,{buttons:0,pressure:0});await pen('mousePressed',x0,y,{pressure:pressure(0),button,buttons});
    for(let i=1;i<=40;i++){const t=i/40;await pen('mouseMoved',x0+(x1-x0)*t,y,{pressure:pressure(t),button,buttons});}
    await pen('mouseReleased',x1,y,{pressure:0,button,buttons:0});await settle();
  };

  // Pressure: a stroke from light to firm grows along its length.
  await penStroke(cx-300,cy-150,cx+300,{pressure:t=>.1+.9*t});
  const widths=await page.evaluate(({cx,cy})=>[thickness(cx-250,cy-150),thickness(cx,cy-150),thickness(cx+250,cy-150)],{cx,cy});
  check('pen pressure widens the stroke from light to firm',widths[0]>0&&widths[0]<widths[1]&&widths[1]<widths[2],widths);
  check('the pen stroke commits as one brush command',await page.evaluate(()=>styk.editor.undoLabel==='Brush stroke'));

  // The eraser end reports button 5 and buttons bit 32. DevTools input cannot
  // emulate it, so these pointer events are dispatched directly; a synthetic
  // pointer cannot hold real capture, so capture calls are stubbed for it.
  await page.evaluate(async({cx,cy})=>{
    const overlay=document.getElementById('overlay'),real={set:overlay.setPointerCapture,has:overlay.hasPointerCapture,release:overlay.releasePointerCapture};let held=false;
    overlay.setPointerCapture=function(id){if(id===77){held=true;return;}return real.set.call(this,id);};overlay.hasPointerCapture=function(id){return id===77?held:real.has.call(this,id);};overlay.releasePointerCapture=function(id){if(id===77){held=false;return;}return real.release.call(this,id);};
    const send=(type,x,buttons)=>overlay.dispatchEvent(new PointerEvent(type,{pointerId:77,pointerType:'pen',isPrimary:true,bubbles:true,cancelable:true,clientX:x,clientY:cy-150,button:type==='pointermove'?-1:5,buttons,pressure:buttons?1:0}));
    send('pointerdown',cx-60,32);await new Promise(r=>setTimeout(r,50));for(let i=1;i<=24;i++)send('pointermove',cx-60+i*5,32);send('pointerup',cx+60,0);
    await new Promise(r=>{const wait=()=>styk.drawing.gesture?setTimeout(wait,10):r();wait();});Object.assign(overlay,{setPointerCapture:real.set,hasPointerCapture:real.has,releasePointerCapture:real.release});
  },{cx,cy});
  await settle();
  const erased=await page.evaluate(({cx,cy})=>({alpha:alphaAt(cx,cy-150),undo:styk.editor.undoLabel,tool:styk.drawing.tool}),{cx,cy});
  check('the pen eraser end erases while the brush tool is selected',erased.alpha===0&&erased.undo==='Erase stroke'&&erased.tool==='brush',erased);

  // Palm rejection: a touch within the pen's grace period neither paints nor pans.
  const revision=await page.evaluate(()=>styk.editor.revision),view=await page.evaluate(()=>({...styk.state.view}));
  await pen('mouseMoved',cx+200,cy+100,{buttons:0,pressure:0});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx+100,y:cy+100,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx+160,y:cy+140,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  check('a palm touch right after pen use neither paints nor pans',await page.evaluate(({revision,view})=>styk.editor.revision===revision&&styk.state.view.x===view.x&&styk.state.view.y===view.y,{revision,view}));

  // Two fingers pinch-zoom around their midpoint.
  await page.waitForTimeout(800);
  const before=await page.evaluate(()=>({...styk.state.view})),pinchRevision=await page.evaluate(()=>styk.editor.revision);
  const mid={x:cx+40,y:cy+60};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mid.x-50,y:mid.y,id:11}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mid.x-50,y:mid.y,id:11},{x:mid.x+50,y:mid.y,id:12}]});
  for(let i=1;i<=10;i++){const r=50+i*5;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mid.x-r,y:mid.y,id:11},{x:mid.x+r,y:mid.y,id:12}]});}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const after=await page.evaluate(()=>({...styk.state.view}));
  const ratio=after.scale/before.scale;
  // The world point under the midpoint stays under it: (m - x) / scale is unchanged.
  const local={x:mid.x-box.x,y:mid.y-box.y},drift=Math.hypot((local.x-after.x)/after.scale-(local.x-before.x)/before.scale,(local.y-after.y)/after.scale-(local.y-before.y)/before.scale);
  check('two fingers pinch-zoom by their change in distance',Math.abs(ratio-2)<.05,{ratio});
  check('the pinch keeps the artwork under the fingers\' midpoint',drift<1,{drift});
  check('pinching never paints',await page.evaluate(r=>styk.editor.revision===r,pinchRevision));
  check('no uncaught browser errors',errors.length===0,errors);
  console.log(`${checks.length} checks passed`);
}finally{await browser.close();}
