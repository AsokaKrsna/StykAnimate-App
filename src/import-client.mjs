/** File I/O boundary: bytes transfer to a worker; JSON parsing stays off the UI. */
import { applyDocumentChunk } from './document-transport.mjs';
import {materializeNativeFrames} from './import-wire.mjs';
export class ImportClient {
  // The desktop codec requires its per-launch token; the browser dev server has none.
  constructor({baseURL = globalThis.location?.origin, token = globalThis.stykDesktop?.apiToken || '', timeoutMs = 180000,
    workerURL = new URL('./import-worker.mjs', import.meta.url)} = {}) {
    if (!baseURL) throw new Error('The importer requires a local backend URL.');
    this.baseURL = new URL(baseURL, globalThis.location?.href).origin;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.cancelGeneration = 0;
    this.pending = new Map();
    this.disposed = false;
    this.failure = null;
    this.workerURL=workerURL;this._startWorker();
  }

  _startWorker() {
    const worker = new Worker(this.workerURL, {type: 'module', name: 'StykAnimate file importer'});
    this.worker=worker;this.failure=null;
    worker.addEventListener('message', event => {if(this.worker===worker)this._receive(event.data);});
    worker.addEventListener('messageerror', () => {if(this.worker===worker)this._fail(Object.assign(new Error('The imported project could not be transferred.'), { telemetryCode: 'snapshot_failed', telemetryStage: 'prepare' }));});
    worker.addEventListener('error', event => {
      event.preventDefault();
      if(this.worker===worker)this._fail(Object.assign(new Error(event.message || 'The file importer stopped unexpectedly.'), { telemetryCode: 'worker_failed', telemetryStage: 'decode' }));
    });
  }

  _receive(message) {
    const request = this.pending.get(message?.id);
    if (!request) return;
    if(message.progress){request.onProgress?.(message.progress);return;}
    if(message.ok && message.nativeFrames) {
      if(request.materializing) return;
      request.materializing=true;
      const {buffer,offset}=message.nativeFrames;
      const result=message.complete?{...message.result,document:request.document}:message.result;
      materializeNativeFrames(result,buffer,offset,{isCancelled:()=>this.pending.get(message.id)!==request}).then(result=>{
        if(this.pending.get(message.id)!==request) return;
        this.pending.delete(message.id);clearTimeout(request.timer);request.resolve(result);
      },error=>{
        if(this.pending.get(message.id)!==request) return;
        this.pending.delete(message.id);clearTimeout(request.timer);request.reject(error);
      });
      return;
    }
    if (message.chunk) {
      try {
        request.document = applyDocumentChunk(request.document, message.chunk);
        this.worker.postMessage({ operation: 'ack', id: message.id, sequence: message.sequence });
      } catch (error) {
        this.pending.delete(message.id); clearTimeout(request.timer); this.worker.postMessage({ operation: 'cancel', id: message.id }); request.reject(error);
      }
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.complete ? { ...message.result, document: request.document } : message.result);
    else {
      const error = new Error(message.error?.message || 'This file could not be imported.');
      if (message.error?.code) error.code = message.error.code;
      if (message.error?.status) error.status = message.error.status;
      error.telemetryCode = message.error?.telemetryCode; error.telemetryStage = message.error?.telemetryStage;
      error.telemetryFrames=message.error?.telemetryFrames;error.name=message.error?.name||'Error';
      request.reject(error);
    }
  }

  _fail(error) {
    if(!this.disposed)this.diagnostics?.recovery('import_worker','started');
    this.failure = error;
    this.worker.terminate();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  _request(operation, payload, transfer = [], onProgress) {
    if (this.disposed) return Promise.reject(new Error('The file importer has been disposed.'));
    // Retry only the user's next operation; never silently repeat a failed one.
    if(this.failure){try{this._startWorker();}catch(error){this.diagnostics?.recovery('import_worker','failed');return Promise.reject(error);}}
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = this.timeoutMs > 0 ? setTimeout(() => {
        const error = new Error('The file import timed out. Try opening a smaller project.');
        error.code = 'import_timeout';
        error.telemetryStage='decode';
        this._fail(error);
      }, this.timeoutMs) : null;
      const succeeded=value=>{this.diagnostics?.recovery('import_worker','recovered');resolve(value);};
      this.pending.set(id, {resolve:succeeded, reject, timer, onProgress});
      try {
        this.worker.postMessage({id, operation, baseURL: this.baseURL, token: this.token, ...payload}, transfer);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async importFile(file,{entryIndex,onProgress}={}) {
    if (this.disposed) throw new Error('The file importer has been disposed.');
    if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string') {
      throw new TypeError('Choose a StykAnimate, Pivot or Stick Nodes file.');
    }
    const native = /\.(styk|stkz|stykmov|json)$/i.test(file.name);
    const limit = (native ? 256 : 128) * 1024 * 1024;
    if (Number(file.size) > limit) throw Object.assign(new Error(`The file exceeds the ${limit / 1024 / 1024} MiB import limit.`), { telemetryCode: 'file_too_large', telemetryStage: 'prepare' });
    const generation=this.cancelGeneration,bytes = await file.arrayBuffer();
    if(generation!==this.cancelGeneration)throw new DOMException('Import superseded.','AbortError');
    // Transfer ownership rather than structured-cloning a second upload buffer.
    return this._request('import', {filename: file.name, bytes,entryIndex}, [bytes],onProgress);
  }

  cancelPending() {
    this.cancelGeneration++;
    for(const [id,request] of this.pending){clearTimeout(request.timer);this.worker.postMessage({operation:'cancel',id});request.reject(new DOMException('Import superseded.','AbortError'));}
    this.pending.clear();
  }

  importNative(file) {
    if (!/\.(styk|stkz|stykmov|json)$/i.test(file?.name || '')) {
      return Promise.reject(new Error('Choose a .styk project, .stkz figure, .stykmov movieclip, or .json file.'));
    }
    return this.importFile(file);
  }

  openSample(path) {
    if (typeof path !== 'string' || !path) return Promise.reject(new Error('Choose a project from the library.'));
    return this._request('open', {path});
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._fail(new Error('The file importer has been disposed.'));
  }
}
