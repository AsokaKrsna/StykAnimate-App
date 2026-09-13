import {execFileSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
await mkdir('artifacts/motion-path-ux',{recursive:true});
await mkdir('tmp',{recursive:true});
const before=execFileSync('git',['show','HEAD:src/motion-path.mjs'],{encoding:'utf8'}).replaceAll("from './","from '../src/");
await writeFile('tmp/motion-path-before.mjs',before);
const baseline=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
const page=await browser.newPage();await page.goto(process.env.STYK_URL||'http://127.0.0.1:47831');
const result=await page.evaluate(async()=>{
 const old=await import('/tmp/motion-path-before.mjs'),now=await import('/src/motion-path.mjs');
 const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=1000;
 const ctx=canvas.getContext('2d'),points=Array.from({length:1600},(_,tick)=>({tick,x:60+(tick%400)*3,y:150+Math.floor(tick/400)*160+Math.sin(tick*.03)*60,key:tick%4===0}));
 const rows=[];
 for (const paths of [1,24]) for (const [name,module] of [['before',old],['after',now],['after-app-budget',now]]) {
   const limit=name==='after-app-budget'?Math.min(1600,Math.floor(6400/paths)):1600;
   const selected=Array.from({length:limit},(_,i)=>points[Math.round(i*(points.length-1)/(limit-1))]);
   const input={ticks:selected.map(p=>p.tick),points:new Map(selected.map(p=>[p.tick,p]))};
   const samples=[];
   for(let run=0;run<14;run++){ctx.getImageData(0,0,1,1);ctx.clearRect(0,0,1440,1000);const start=performance.now();for(let i=0;i<paths;i++)module.drawMotionPath(ctx,input,p=>({x:p.x,y:p.y+i*.3}),{tick:800,labels:true});const time=performance.now()-start;if(run>=4)samples.push(time);}
   samples.sort((a,b)=>a-b);rows.push({name,paths,samplesPerPath:limit,medianMs:samples[5],p90Ms:samples[8]});
 }
 return {description:'Synthetic dense canvas draw submission, 1600 points per trail, 400 keys, labels enabled; 4 warmups + 10 measurements; raster queue drained before each run. Excludes evaluator and GPU presentation.',rows};
});
await writeFile('artifacts/motion-path-ux/benchmark.json',JSON.stringify({...result,baseline},null,2));console.log(JSON.stringify({...result,baseline},null,2));
} finally {await browser.close();}
