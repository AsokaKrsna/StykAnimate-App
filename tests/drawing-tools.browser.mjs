import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
// Krita-parity drawing tools: selection shapes and modes clip painting and
// fills, magic wand, fill selection, symmetry, straight lines, colour picking,
// brush resizing, view flipping, blend modes and alpha lock — driven through
// real pointer and keyboard input.
const output=path.resolve(process.env.STYK_TOOLS_ARTIFACTS||'artifacts/drawing-tools'),url=process.env.STYK_URL||'http://127.0.0.1:47839';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.stack));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
const settle=()=>page.waitForFunction(()=>!styk.drawing.gesture&&!styk.drawing.loading);
try{
  await page.goto(url);await page.waitForFunction(()=>window.styk?.ready);
  await page.evaluate(()=>{styk.state.settings.autosaveSeconds=0;});
  await page.locator('[data-workspace-mode="draw"]').click();
  await page.locator('[data-draw-action="new"]').first().click();
  const box=await page.locator('#viewport').boundingBox(),cx=box.x+box.width/2,cy=box.y+box.height/2;
  // Screen ↔ cel pixel helpers evaluated in the page.
  await page.evaluate(()=>{
    window.store=()=>styk.drawing.owner.entry(styk.editor.drawingTarget().figure).store;
    window.alphaAt=(clientX,clientY)=>{const d=styk.drawing,t=styk.editor.drawingTarget();if(!t.figure)return 0;const p=d.pixel({clientX,clientY},t);return store().pixel(Math.floor(p.x),Math.floor(p.y))[3];};
    window.rgbAt=(clientX,clientY)=>{const d=styk.drawing,t=styk.editor.drawingTarget(),p=d.pixel({clientX,clientY},t);return store().pixel(Math.floor(p.x),Math.floor(p.y));};
  });
  const stroke=async(points,{modifiers=[]}={})=>{for(const key of modifiers)await page.keyboard.down(key);await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();for(const p of points.slice(1))await page.mouse.move(p.x,p.y,{steps:4});await page.mouse.up();for(const key of modifiers)await page.keyboard.up(key);await settle();};
  const line=(x0,y0,x1,y1,n=12)=>Array.from({length:n+1},(_,i)=>({x:x0+(x1-x0)*i/n,y:y0+(y1-y0)*i/n}));

  // Presets and painting modes.
  await page.locator('[data-tool="drawing-brush"]').click();
  check('ten brush presets are offered',await page.locator('[data-draw-preset]').count()===10);
  await page.locator('[data-draw-preset="calligraphy"]').click();
  check('the nib preset sets a flat, angled tip',await page.evaluate(()=>styk.drawing.settings.roundness===.2&&styk.drawing.settings.angle===40));
  await page.locator('[data-draw-preset="ink"]').click();
  await page.locator('select[data-draw-setting="blend"]').selectOption('multiply');
  check('the blend mode select stores its named mode',await page.evaluate(()=>styk.drawing.settings.blend==='multiply'));
  await page.locator('select[data-draw-setting="blend"]').selectOption('normal');
  await page.evaluate(()=>Object.assign(styk.drawing.settings,{size:10,color:'#202020',opacity:1,flow:1,hardness:1,stabilization:0}));

  // Base artwork: a horizontal band.
  await stroke(line(cx-300,cy,cx+300,cy));
  check('the base stroke painted',await page.evaluate(({x,y})=>alphaAt(x,y)===255,{x:cx,y:cy}));

  // Rectangle selection clips painting.
  await page.locator('[data-tool="drawing-lasso"]').click();
  await page.locator('select[data-draw-setting="selectShape"]').selectOption('rect');
  await stroke([{x:cx-100,y:cy-120},{x:cx+100,y:cy+120}]);
  check('a rectangle selection creates an outline',await page.evaluate(()=>Boolean(styk.drawing.marquee)&&styk.drawing.marquee.mask.width>100));
  await page.locator('[data-tool="drawing-brush"]').click();
  check('switching tools keeps the untouched selection outline',await page.evaluate(()=>Boolean(styk.drawing.marquee)&&!styk.drawing.selection));
  await stroke(line(cx-250,cy-60,cx+250,cy-60));
  check('painting stays inside the selection',await page.evaluate(({cx,cy})=>alphaAt(cx,cy-60)===255&&alphaAt(cx-200,cy-60)===0&&alphaAt(cx+200,cy-60)===0,{cx,cy}));
  // Fill inside the selection stays inside it.
  await page.locator('[data-tool="drawing-fill"]').click();
  await page.evaluate(()=>{styk.drawing.settings.color='#3060d0';styk.drawing.settings.gap=0;});
  await page.mouse.click(cx+40,cy+80);await page.waitForFunction(()=>!styk.drawing.fillAbort);
  check('fill is clipped by the selection',await page.evaluate(({cx,cy})=>rgbAt(cx+40,cy+80)[2]>150&&alphaAt(cx+160,cy+80)===0,{cx,cy}));
  await page.keyboard.press('Control+z');

  // Select all, invert, deselect through the drawing shortcuts.
  await page.locator('#viewport').focus();
  await page.keyboard.press('Control+a');await page.waitForFunction(()=>Boolean(styk.drawing.marquee));
  const all=await page.evaluate(()=>styk.drawing.marquee.mask.width*styk.drawing.marquee.mask.height);
  await page.keyboard.press('Control+Shift+I');
  check('Ctrl+A selects everything and Ctrl+Shift+I inverts it to nothing',all>10000&&await page.evaluate(()=>!styk.drawing.marquee));
  await page.keyboard.press('Control+a');await page.keyboard.press('Control+Shift+A');
  check('Ctrl+Shift+A deselects',await page.evaluate(()=>!styk.drawing.marquee&&!styk.drawing.selection));

  // Add and subtract.
  await page.locator('[data-tool="drawing-lasso"]').click();
  await stroke([{x:cx-150,y:cy-40},{x:cx-50,y:cy+40}]);
  await stroke([{x:cx+50,y:cy-40},{x:cx+150,y:cy+40}],{modifiers:['Shift']});
  const added=await page.evaluate(()=>{const m=styk.drawing.marquee.mask;let n=0;for(const v of m.mask)n+=v;return {n,w:m.width};});
  await stroke([{x:cx-150,y:cy-40},{x:cx-50,y:cy+40}],{modifiers:['Alt']});
  const sub=await page.evaluate(()=>{const m=styk.drawing.marquee.mask;let n=0;for(const v of m.mask)n+=v;return n;});
  check('Shift adds a second region and Alt subtracts it again',added.w>250&&sub>0&&sub<added.n*.6);
  await page.keyboard.press('Control+Shift+A');

  // Magic wand selects the painted band.
  await page.locator('select[data-draw-setting="selectShape"]').selectOption('wand');
  await page.mouse.click(cx-280,cy);
  await page.waitForFunction(()=>Boolean(styk.drawing.marquee),null,{timeout:10000});
  const wand=await page.evaluate(({cx,cy})=>{const d=styk.drawing,t=styk.editor.drawingTarget(),inside=d.marqueeContains(d.pixel({clientX:cx,clientY:cy},t)),outside=d.marqueeContains(d.pixel({clientX:cx,clientY:cy-100},t));return {inside,outside};},{cx,cy});
  check('the magic wand selects the connected band only',wand.inside&&!wand.outside);
  // Fill selection recolours exactly the band, undoably.
  await page.evaluate(()=>{styk.drawing.settings.color='#10c040';});
  await page.keyboard.press('Shift+Backspace');await page.waitForFunction(()=>styk.editor.undoLabel==='Fill selection');
  check('Fill selection recolours the selected pixels',await page.evaluate(({cx,cy})=>rgbAt(cx,cy)[1]>150&&alphaAt(cx,cy-100)===0,{cx,cy}));
  await page.keyboard.press('Control+z');await page.keyboard.press('Control+Shift+A');
  check('undo restores the band colour',await page.evaluate(({cx,cy})=>rgbAt(cx,cy)[1]<60,{cx,cy}));

  // Symmetry mirrors a stroke across the stage centre.
  await page.locator('[data-tool="drawing-brush"]').click();
  await page.evaluate(()=>{styk.drawing.settings.mirrorX=true;styk.drawing.settings.color='#202020';});
  const axis=await page.evaluate(async()=>{const {worldToScreen}=await import('/src/renderer-geometry.mjs'),r=styk.editor.report,rect=styk.drawing.viewRect(),p=worldToScreen({x:r.canvas_width/2,y:r.canvas_height/2},{report:r,frame:styk.editor.evaluatedFrame,view:styk.state.view,cameraEnabled:false});return {x:rect.left+p.x*rect.width/rect.clientWidth,y:rect.top+p.y*rect.height/rect.clientHeight};});
  await stroke(line(axis.x-200,axis.y+150,axis.x-120,axis.y+190,6));
  check('mirror painting draws the reflected stroke',await page.evaluate(({x,y})=>alphaAt(x-160,y+170)===255&&alphaAt(x+160,y+170)===255,axis));
  await page.evaluate(()=>{styk.drawing.settings.mirrorX=false;});

  // Shift-click continues with a straight line from the last stroke's end.
  await stroke(line(cx-300,cy+250,cx-280,cy+250,2));
  await page.keyboard.down('Shift');await page.mouse.click(cx+100,cy+250);await page.keyboard.up('Shift');await settle();
  check('Shift-click draws a straight line from the previous stroke',await page.evaluate(({cx,cy})=>[-200,-100,0,50].every(dx=>alphaAt(cx+dx,cy+250)===255),{cx,cy}));

  // Alt-click picks the visible colour.
  await page.evaluate(()=>{styk.drawing.settings.color='#ff00ff';});
  await page.keyboard.down('Alt');await page.mouse.click(cx,cy);await page.keyboard.up('Alt');
  await page.waitForFunction(()=>styk.drawing.settings.color!=='#ff00ff',null,{timeout:5000});
  check('Alt-click picks the painted colour',await page.evaluate(()=>{const c=styk.drawing.settings.color;return parseInt(c.slice(1,3),16)<80&&parseInt(c.slice(3,5),16)<80;}));

  // Ctrl-drag resizes the brush.
  const before=await page.evaluate(()=>styk.drawing.settings.size);
  await page.keyboard.down('Control');await page.mouse.move(cx,cy-200);await page.mouse.down();await page.mouse.move(cx+120,cy-200,{steps:6});await page.mouse.up();await page.keyboard.up('Control');
  check('Ctrl-drag enlarges the brush without painting',await page.evaluate(({before,cx,cy})=>styk.drawing.settings.size>before*1.5&&alphaAt(cx+60,cy-200)===0,{before,cx,cy}));
  await page.evaluate(()=>{styk.drawing.settings.size=10;});

  // Flip view: pointer mapping stays exact while the view is mirrored.
  await page.keyboard.press('m');
  check('M flips the view',await page.evaluate(()=>styk.state.view.flip===true));
  await stroke(line(cx+200,cy-150,cx+260,cy-150,4));
  check('painting in a flipped view lands under the pointer',await page.evaluate(({cx,cy})=>alphaAt(cx+230,cy-150)===255,{cx,cy}));
  await page.screenshot({path:path.join(output,'flipped.png')});
  await page.keyboard.press('m');

  // Alpha lock recolours only existing pixels.
  await page.evaluate(()=>{Object.assign(styk.drawing.settings,{alphaLock:true,color:'#e02020',size:40});});
  await stroke(line(cx-50,cy-20,cx+50,cy+20,6));
  check('alpha lock recolours paint without covering empty pixels',await page.evaluate(({cx,cy})=>rgbAt(cx,cy)[0]>150&&alphaAt(cx,cy-15)===0,{cx,cy}));
  await page.evaluate(()=>{styk.drawing.settings.alphaLock=false;});

  // The Blender preset smudges existing paint across empty canvas.
  await page.locator('[data-draw-preset="blender"]').click();
  check('the Blender preset selects the smudge blend',await page.evaluate(()=>styk.drawing.settings.blend==='smudge'));
  const beforeSmudge=await page.evaluate(({cx,cy})=>alphaAt(cx+10,cy+45),{cx,cy});
  await stroke(line(cx+10,cy,cx+10,cy+60,10));
  check('smudging drags paint into empty pixels',await page.evaluate(({cx,cy})=>alphaAt(cx+10,cy+45),{cx,cy})>beforeSmudge+20);
  await page.locator('[data-draw-preset="ink"]').click();
  await page.screenshot({path:path.join(output,'tools.png')});
  check('no uncaught browser errors',errors.length===0);
  await writeFile(path.join(output,'tools.json'),JSON.stringify({checks,errors,browser:await browser.version()},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,errors,checks},null,2));throw error;}
finally{await browser.close();}
