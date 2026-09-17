import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('console',message=>{if(message.text().startsWith('DRAWING BENCH'))console.log(message.text());});
try{
  await page.goto(process.env.STYK_URL||'http://127.0.0.1:47839');await page.waitForFunction(()=>window.styk?.ready);
  const result=await page.evaluate(async()=>{
    const {DrawingStroke}=await import('/src/drawing-pixels.mjs'),{DrawingResources}=await import('/src/drawing-resources.mjs'),{createDrawingFigure}=await import('/src/drawing-model.mjs'),{createFrame,createObject,emptyDocument}=await import('/src/demo.mjs');
    const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)];
    const summary=values=>({samples:values.length,p50:percentile(values,.5),p95:percentile(values,.95),max:Math.max(...values)});
    const brush=(width,height,size,hardness)=>{
      const pixels=new Uint8ClampedArray(width*height*4),times=[];let bytes=0;
      for(let pass=0;pass<5;pass++){const b=new DrawingStroke(pixels,width,height,{size,hardness,flow:hardness?1:.2,pressureSize:false});
        for(let i=0;i<120;i++){const start=performance.now();b.sample({x:64+i*(width-128)/120,y:height*.5+Math.sin(i/12)*height*.15});times.push(performance.now()-start);}bytes=Math.max(bytes,b.bytes);b.cancel();}
      return {width,height,size,hardness,processingMs:summary(times),undoBytes:bytes};
    };
    const brushes=[brush(704,544,8,1),brush(3968,2288,256,0),brush(1984,1144,512,0)];
    const report=emptyDocument(),owner=new DrawingResources(report),figures=[],frames=[],tile=new Uint8ClampedArray(64*64*4);
    for(let i=0;i<64;i++)for(let j=0;j<64;j++)if(Math.abs(i-j)<2)tile.set([25,35,45,255],(i*64+j)*4);
    console.log('DRAWING BENCH generating 500 independent 1080p line-art cels');
    const generationStart=performance.now();
    for(let i=0;i<500;i++){
      const {dataUrl}=await owner.worker.request('encode',{width:1984,height:1144,tiles:[{x:(i*13)%1850,y:(i*7)%1000,width:64,height:64,pixels:tile}]});
      const figure=createDrawingFigure({width:1984,height:1144,figureTypeId:i+1,dataUrl,empty:false});figures.push(figure);frames.push(createFrame([createObject(figure,1,960,540)],2));
      if(i%100===99)console.log('DRAWING BENCH generated '+(i+1));
    }
    report.figure_types=figures;report.keyframes=frames;report.canvas_width=1920;report.canvas_height=1080;
    const generationMs=performance.now()-generationStart,cold=[],warm=[],memory=[];
    for(let cycle=0;cycle<3;cycle++){
      for(let i=0;i<24;i++){const figure=figures[cycle*100+i];let start=performance.now();await owner.surface(figure);cold.push(performance.now()-start);start=performance.now();await owner.surface(figure);warm.push(performance.now()-start);}
      memory.push({...owner.stats});
    }
    console.log('DRAWING BENCH cache cycles complete');
    const f=figures[350],surface=await owner.surface(f),stroke=new DrawingStroke(surface.pixels,surface.width,surface.height,{size:32});stroke.sample({x:400,y:400});owner.apply(f,stroke.finish(),'after');
    const barrierStart=performance.now();await owner.flush();const barrierMs=performance.now()-barrierStart;
    const worker=owner.worker,start=performance.now(),filled=await worker.request('fill',{width:704,height:544,pixels:new Uint8ClampedArray(704*544*4).buffer,options:{x:0,y:0,color:[20,40,60,255]}}),fillMs=performance.now()-start;
    const output={brushes,fixture:{cels:figures.length,width:1920,height:1080,generationMs,pngCharacters:figures.reduce((n,f)=>n+f.image_assets[0].data_url.length,0)},coldFlipMs:summary(cold),warmFlipMs:summary(warm),memory,barrierMs,fillMs,fillBytes:filled.pixels.byteLength,budgets:{decoded:owner.decodedBudget,dirty:owner.dirtyBudget}};
    owner.dispose();output.afterDispose=owner.stats;
    const adapter=await navigator.gpu?.requestAdapter();output.gpu=adapter?.info?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null;
    return output;
  });
  result.environment={cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemory:os.totalmem(),platform:os.platform(),node:process.version,chrome:await browser.version(),headless:true,date:new Date().toISOString()};
  await mkdir('artifacts/drawing',{recursive:true});await writeFile('artifacts/drawing/performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
