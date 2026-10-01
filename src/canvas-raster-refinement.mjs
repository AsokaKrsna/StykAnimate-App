import {DrawingWorker} from './drawing-worker-client.mjs';
import {sendDrawingComposite} from './drawing-composite-transport.mjs';
import {yieldSceneTask} from './scene-preparation.mjs';

/** Serial, disposable work for existing Canvas artwork owners. The queue holds
 * immutable inputs only; the renderer admits and owns every completed bitmap. */
export class CanvasRasterRefinement {
  constructor({worker=new DrawingWorker(new URL('./drawing-composite-worker.mjs',import.meta.url),{maxPending:1}),onInvalidate=()=>{},onError=()=>{},maxJobs=4096}={}) {
    Object.assign(this,{worker,onInvalidate,onError,maxJobs});this.jobs=new Map();this.stats={pending:0,bytes:0,completed:0,cancelled:0,failed:0};
  }
  get pending(){return this.jobs.size>0;}
  whenReady(){return this.completion??Promise.resolve();}
  request(key,description){
    if(this.closed)return false;
    const previous=this.jobs.get(key);
    if(previous?.signature===description.signature)return true;
    if(!previous&&this.jobs.size>=this.maxJobs)return false;
    if(previous&&previous===this.running){previous.controller.abort();}
    this.jobs.set(key,{...description,key,controller:new AbortController()});this.stats.pending=this.jobs.size;
    if(!this.completion)this.completion=new Promise(resolve=>{this.resolve=resolve;});
    if(!this.pumping){this.pumping=true;void this.pump();}
    return true;
  }
  cancel(key){
    if(arguments.length){
      const job=this.jobs.get(key);if(!job)return;
      this.jobs.delete(key);this.stats.cancelled++;this.stats.pending=this.jobs.size;
      if(job===this.running){job.controller.abort();this.worker.dispose();this.stats.bytes=0;}
      return;
    }
    if(!this.jobs.size)return;
    this.stats.cancelled+=this.jobs.size;this.jobs.clear();this.stats.pending=0;this.running?.controller.abort();
    // Cancellation terminates the worker before interactive painting can use
    // the reservation again. A late transferred bitmap is still closed below.
    if(this.running)this.worker.dispose();this.stats.bytes=0;
  }
  releaseWorkingMemory(){
    const job=this.running;
    if(!job||this.jobs.get(job.key)!==job)return;
    job.controller.abort();this.worker.dispose();this.stats.bytes=0;
    this.jobs.set(job.key,{...job,controller:new AbortController()});
  }
  async pump(){
    await yieldSceneTask();
    try{
      while(this.jobs.size&&!this.closed){
        const job=this.jobs.values().next().value;this.running=job;
        let bitmap;
        try{
          if(!job.valid())continue;
          const maxBytes=job.allowance();
          if(!(maxBytes>=job.bytes))throw Object.assign(new RangeError('Preview refinement exceeds the existing artwork allowance.'),{code:'preview_raster_budget'});
          this.stats.bytes=maxBytes;
          const check=()=>{if(job.controller.signal.aborted||this.jobs.get(job.key)!==job||!job.valid())throw new DOMException('Artwork refinement superseded.','AbortError');};
          await sendDrawingComposite(this.worker,job.items,{signal:job.controller.signal,check,maxBytes});check();
          const result=await this.worker.request('preview-raster',{...job.capture,maxBytes},{signal:job.controller.signal});bitmap=result.bitmap;check();
          if(!bitmap||bitmap.width!==job.capture.width||bitmap.height!==job.capture.height)throw new Error('Invalid preview refinement bitmap.');
          // Capture releases scratch and effect executors before replying.
          // Move its bitmap out of the working reservation and into the
          // renderer's existing artwork accounting before repainting.
          this.stats.bytes=0;
          if(job.install(bitmap)){
            bitmap=null;this.stats.completed++;
            if(this.jobs.get(job.key)===job)this.jobs.delete(job.key);
            this.stats.pending=this.jobs.size;this.onInvalidate();
          }
        }catch(error){
          // Recovery can synchronously paint replacement artwork. Rejected
          // incoming pixels must be closed before that callback allocates.
          bitmap?.close();bitmap=null;
          if(error.name!=='AbortError'&&this.jobs.get(job.key)===job){
            if(job.retries>0&&!['preview_raster_budget','vfx_surface_budget'].includes(error.code)){
              this.worker.dispose();this.jobs.set(job.key,{...job,retries:job.retries-1,controller:new AbortController()});
            }else{this.stats.failed++;job.failed?.(error);this.onError(error);}
          }
        }finally{
          bitmap?.close();
          if(this.jobs.get(job.key)===job)this.jobs.delete(job.key);
          this.running=null;this.stats.bytes=0;this.stats.pending=this.jobs.size;
        }
        await yieldSceneTask();
      }
    }finally{
      this.pumping=false;this.resolve?.();this.resolve=null;this.completion=null;
      if(this.jobs.size&&!this.closed){this.completion=new Promise(resolve=>{this.resolve=resolve;});this.pumping=true;void this.pump();}
    }
  }
  dispose(){this.closed=true;this.cancel();this.worker.dispose();}
}
