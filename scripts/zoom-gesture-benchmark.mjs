/** In-page paired benchmark. Call with the same evaluated scene/resources and
 * a frozen baseline renderer URL; no document data is saved by this module. */
export async function zoomGestureBenchmark({rendererURL='/src/renderer.mjs',forceCanvas2D=false,report,frame,geometry,resources,width=960,height=432,dpr=1,defer=false,steps=32,onProgress=()=>{}}) {
  const {createRenderer}=await import(rendererURL),renderer=await createRenderer(document.createElement('canvas'),{forceCanvas2D,resources});
  renderer.resize(width,height,dpr);
  const fitted=Math.min((width-128)/report.canvas_width,(height-16)/report.canvas_height),anchor={x:width/2,y:height/2};
  const viewAt=progress=>{const scale=fitted*Math.exp(2.4*progress);return {scale,x:anchor.x-report.canvas_width/2*scale,y:anchor.y-report.canvas_height/2*scale};};
  const base={report,frame,geometry,cameraEnabled:false,clipToCanvas:false},rows=[],errors=[];
  renderer.device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const submit=async(view,viewChanging,phase)=>{
    const before=renderer.stats.rasterizedObjects??0,start=performance.now();renderer.render({...base,view,viewChanging});
    const cpuMs=performance.now()-start;
    await renderer.device?.queue.onSubmittedWorkDone();
    const row={phase,scale:view.scale,cpuMs,completeMs:performance.now()-start,rasters:renderer.device?(renderer.stats.rasterizedObjects??0):(renderer.stats.rasterizedObjects??0)-before,
      uploadBytes:renderer.stats.uploadBytes??0,bytes:(renderer.stats.gpuBytes??renderer.artworkBytes??0)+(renderer.rasterCache?.recycledBytes??0),activeBytes:renderer.rasterCache?.stats.activeBytes??renderer.artworkBytes??0,preparation:renderer.stats.preparation};
    rows.push(row);return row;
  };
  try {
    await submit(viewAt(0),false,'initial');
    // A fixed input interval keeps an automation tab's background animation
    // throttling out of the renderer timing. Completion includes a queue fence;
    // this measures rendering work, not display cadence or input-to-screen time.
    for(let i=1;i<=steps;i++) {await submit(viewAt(i/steps),defer,'gesture');onProgress({step:i,steps,backend:renderer.stats.backend});await new Promise(resolve=>setTimeout(resolve,16));}
    await submit(viewAt(1),false,'settle');
    for(let i=0;i<16;i++)await submit(viewAt(1),false,'steady');
    const copy=new OffscreenCanvas(renderer.canvas.width,renderer.canvas.height),context=copy.getContext('2d',{willReadFrequently:true});context.drawImage(renderer.canvas,0,0);
    const pixels=context.getImageData(0,0,copy.width,copy.height).data;
    const percentile=values=>{const v=[...values].sort((a,b)=>a-b);return {p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],max:v.at(-1)};};
    const group=phase=>{const list=rows.filter(r=>r.phase===phase);return {cpuMs:percentile(list.map(r=>r.cpuMs)),completeMs:percentile(list.map(r=>r.completeMs)),rasters:list.reduce((n,r)=>n+r.rasters,0),uploadBytes:list.reduce((n,r)=>n+r.uploadBytes,0)};};
    return {backend:renderer.stats.backend,adapter:renderer.stats.adapter,width,height,dpr,steps,defer,objects:geometry.objects.size,drawables:geometry.drawables.length,errors,
      gesture:group('gesture'),settle:group('settle'),steady:group('steady'),peakBytes:Math.max(...rows.map(r=>r.bytes)),peakActiveBytes:Math.max(...rows.map(r=>r.activeBytes)),rows,pixels};
  }finally{renderer.destroy();}
}
