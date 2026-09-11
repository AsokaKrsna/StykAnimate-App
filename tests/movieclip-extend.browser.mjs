import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 await page.goto('http://127.0.0.1:47831');await page.waitForFunction(()=>window.styk?.ready);
 await page.evaluate(async()=>{
 const {emptyDocument,createFrame,createObject,defaultFigure}=await import('/src/demo.mjs');
 const {movieclipFigure}=await import('/src/movieclips.mjs');const {presencePlayback}=await import('/src/movieclip-presence.mjs');
 const f=defaultFigure(),child=emptyDocument();child.keyframes=[createFrame([createObject(f,1,50,60)],20)];
 const clip=movieclipFigure(2,'Walking clip',child,{duration:20,pivot:{x:50,y:60}}),report=emptyDocument();report.figure_types=[f,clip];
 report.keyframes=[0,1,2,3].map(n=>createFrame([createObject(f,1,200+n*20,300),...(n===0?[createObject(clip,7,420,300,{_stykMovieclip:presencePlayback()})]:[])],3));
 styk.editor.load(report);styk.editor.select(7);
 });
 const input=page.getByRole('spinbutton',{name:'Next keyframes',exact:true});await input.fill('2');
 await page.getByRole('button',{name:'Add to next keyframes',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>{const e=styk.editor;return [3,6,9].map(t=>{e.seek(t);return e.evaluatedFrame.objects.some(o=>o.unique_id===7);});}),[true,true,false]);
 await page.evaluate(()=>{styk.editor.seek(0);styk.editor.select(7);});
 await input.waitFor({state:'visible'});await mkdir('artifacts/movieclip-extend',{recursive:true});await page.screenshot({path:'artifacts/movieclip-extend/inspector.png'});
 console.log('PASS inspector action adds only the next two existing keys');
}finally{await browser.close();}
