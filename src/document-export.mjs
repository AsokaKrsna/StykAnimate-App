import {documentChunks} from './document-transport.mjs';
import {drawingBarrier} from './drawing-resources.mjs';
import {codecJob} from './codec-job.mjs';

function abortError(message = 'Document export cancelled.') { return new DOMException(message, 'AbortError'); }
async function yieldToInput() {
  if (globalThis.scheduler?.yield) await scheduler.yield();
  else await new Promise(resolve => setTimeout(resolve, 0));
}

/** Asynchronous, bounded snapshots + worker serialization and HTTP uploads.
 * Callers must abort on every document mutation, including uncommitted gestures.
 * getRevision catches committed edits between chunks and before returning data.
 */
export class DocumentExporter {
  constructor({baseURL = globalThis.location?.origin, token = globalThis.stykDesktop?.apiToken || '', targetRecords = 2000,
    targetBytes = 1024 * 1024, timeoutMs = 300000} = {}) {
    if (!baseURL) throw new Error('Document export requires the local file service URL.');
    this.baseURL = new URL(baseURL, globalThis.location?.href).origin;
    this.token = token;
    this.targetRecords = targetRecords;
    this.targetBytes = targetBytes;
    this.timeoutMs = timeoutMs;
    this.jobs = new Set();
    this.disposed = false;
    this.lastTimings = null;
  }

  /** @returns {Promise<Blob>} Native .styk/.stkz or Pivot .piv/.stk bytes. */
  async export(report, {sourceId, format = 'styk', name, figureTypeId, figureUid, figureUids, tick, signal, getRevision} = {}) {
    if (this.disposed) throw new Error('The document exporter has been disposed.');
    if (!report || typeof report !== 'object') throw new TypeError('Export requires an editable document.');
    if (!['piv', 'stk', 'styk', 'stkz', 'stykmov'].includes(format)) throw new Error('Choose a .piv, .stk, .styk, .stkz, or .stykmov export.');
    if (signal?.aborted) throw abortError();
    const originalRevision = getRevision?.(), started = performance.now();
    await drawingBarrier(report,{signal});
    if(signal?.aborted||getRevision&&getRevision()!==originalRevision)throw abortError('The document changed while preparing drawing pixels.');
    const worker = new Worker(new URL('./document-export-worker.mjs', import.meta.url), {type: 'module', name: 'StykAnimate document export'});
    const backendJob = codecJob(this.baseURL, this.token);
    let pending, sequence = 0, failure, count = 0, prepMax = 0, postMax = 0, mainWork = 0;
    const fail = error => { failure = error; backendJob.cancel(); pending?.reject(error); pending = null; worker.terminate(); };
    const job = {cancel: () => fail(abortError())};
    this.jobs.add(job);
    worker.addEventListener('error', event => { event.preventDefault(); fail(Object.assign(new Error(event.message || 'The document export worker stopped.'), { telemetryCode: 'worker_failed', telemetryStage: 'serialize' })); });
    worker.addEventListener('messageerror', () => fail(Object.assign(new Error('The document snapshot could not be transferred.'), { telemetryCode: 'snapshot_failed', telemetryStage: 'prepare' })));
    worker.addEventListener('message', event => {
      if (!pending || pending.id !== event.data?.id) return;
      const request = pending; pending = null;
      if (event.data.ok) request.resolve(event.data);
      else {
        const error = new Error(event.data.error?.message || 'Document export failed.');
        error.code = event.data.error?.code; error.status = event.data.error?.status;
        error.telemetryCode = event.data.error?.telemetryCode; error.telemetryStage = event.data.error?.telemetryStage;
        error.telemetryFrames=event.data.error?.telemetryFrames;error.name=event.data.error?.name||'Error';
        request.reject(error);
      }
    });
    const check = () => {
      if (signal?.aborted) throw abortError();
      if (failure) throw failure;
      if (getRevision && getRevision() !== originalRevision) throw abortError('The document changed during export.');
    };
    const request = (operation, data = {}) => {
      check();
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending = {id, resolve, reject};
        const before = performance.now();
        try { worker.postMessage({id, operation, ...data}); }
        catch (error) { pending = null; reject(error); }
        const elapsed = performance.now() - before;
        postMax = Math.max(postMax, elapsed); mainWork += elapsed;
      });
    };
    const abort = () => fail(abortError());
    signal?.addEventListener('abort', abort, {once: true});
    const timer = this.timeoutMs > 0 ? setTimeout(() => fail(Object.assign(new Error('Document export timed out.'), { telemetryCode: 'timeout', telemetryStage: 'serialize' })), this.timeoutMs) : null;
    try {
      await request('start', {options: {sourceId, format, name, figureTypeId, figureUid, figureUids, tick, baseURL: this.baseURL, token: this.token, jobId: backendJob.id}});
      const snapshotStarted = performance.now();
      const chunks = documentChunks(report, {maxRecords: this.targetRecords, maxBytes: this.targetBytes,
        timeBudgetMs: 3, omitRuntimeSegments: true});
      for (;;) {
        check();
        const before = performance.now(), next = chunks.next(), elapsed = performance.now() - before;
        prepMax = Math.max(prepMax, elapsed); mainWork += elapsed;
        if (next.done) break;
        check();
        await request('chunk', {chunk: next.value});
        count++;
        // ACK bounds memory, and yielding explicitly gives pending input/UI work
        // a turn even on browsers with aggressively scheduled MessagePort tasks.
        await yieldToInput();
      }
      check();
      const snapshotMs = performance.now() - snapshotStarted;
      const result = await request('export');
      check();
      if (!(result.blob instanceof Blob)) throw new Error('The file service returned no exported document.');
      this.lastTimings = {format, chunks: count, snapshot_ms: snapshotMs, max_chunk_prepare_ms: prepMax,
        max_chunk_post_ms: postMax, main_work_ms: mainWork, total_ms: performance.now() - started, ...result.timings};
      backendJob.finish();
      return result.blob;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      this.jobs.delete(job);
      backendJob.cancel();
      worker.terminate();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of this.jobs) job.cancel();
    this.jobs.clear();
  }
}
