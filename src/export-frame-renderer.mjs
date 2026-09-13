import { documentChunks } from "./document-transport.mjs";
import { exportMemoryPlan } from "./export-memory.mjs";
import {exportContext, checkExportContext} from './export-canvas.mjs';

const abortError = (message = "Export rendering cancelled.") =>
  new DOMException(message, "AbortError");
/** One export session: bounded document transfer, worker scene evaluation and
 * rasterization, then a reusable output canvas consumed by any existing encoder.
 */
export class ExportFrameRenderer {
  constructor({
    width,
    height,
    smoothing = "edges",
    baseURL = globalThis.location?.origin,
    token = "",
    signal,
    getRevision,
    canvas,
    timeoutMs = 120000,
    maxWorkingBytes,
    onFrame,
  } = {}) {
    if (signal?.aborted) throw abortError();
    Object.assign(this, exportMemoryPlan(width, height, smoothing, {maxWorkingBytes}), {
      baseURL,
      token,
      signal,
      getRevision,
      timeoutMs,
      onFrame,
    });
    this.canvas = canvas ?? document.createElement("canvas");
    // Native video consumes worker PNGs directly; allocate presentation pixels
    // only if a canvas consumer actually requests them.
    this.canvas.width = this.canvas.height = 1;
    // Export frames are read by image/video encoders. Keep this large surface
    // CPU-backed instead of competing with the editor's WebGPU allocations.
    try {this.context = exportContext(this.canvas);} catch (error) {this.canvas.width = this.canvas.height = 1; throw error;}
    this.sequence = 0;
    this.disposed = false;
    this.loaded = false;
    this.busy = false;
    this.stats = {
      loadChunks: 0,
      maxChunkBytes: 0,
      maxMainSnapshotMs: 0,
      renderedFrames: 0,
    };
    try {this.worker = new Worker(
      new URL("./export-frame-worker.mjs", import.meta.url),
      { type: "module", name: "StykAnimate export rendering" },
    );} catch (error) {this.canvas.width = this.canvas.height = 1; throw error;}
    this.worker.addEventListener("message", ({ data }) => {
      const pending = this.pending;
      if (!pending || pending.id !== data.id) {
        data.bitmap?.close();
        return;
      }
      this.pending = null;
      clearTimeout(pending.timer);
      if (data.ok) pending.resolve(data);
      else {
        const error = Object.assign(new Error(data.error || "Export rendering failed."), {code: data.code,
          name:data.name||'Error',telemetryCode:data.telemetryCode,telemetryStage:data.telemetryStage,telemetryFrames:data.telemetryFrames});
        data.bitmap?.close(); this._fail(error); pending.reject(error);
      }
    });
    this.worker.addEventListener("error", (event) => {
      event.preventDefault();
      this._fail(Object.assign(new Error(event.message || "The export renderer stopped."),{telemetryCode:'worker_failed',telemetryStage:'encode'}));
    });
    this.worker.addEventListener("messageerror", () =>
      this._fail(Object.assign(new Error("An export frame could not be transferred."),{telemetryCode:'snapshot_failed',telemetryStage:'prepare'})),
    );
    this.abort = () => this._fail(abortError());
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }
  _check() {
    if (this.failure) throw this.failure;
    if (this.disposed || this.signal?.aborted) throw abortError();
    if (this.loaded && this.getRevision && this.getRevision() !== this.revision)
      throw abortError("The animation changed during export.");
  }
  _fail(error) {
    this.failure ??= error;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
    this.worker?.terminate();
    this.canvas.width = this.canvas.height = 1;
  }
  _request(operation, payload = {}) {
    this._check();
    if (this.pending)
      return Promise.reject(
        new Error("Export renderer requests must run sequentially."),
      );
    return new Promise((resolve, reject) => {
      const id = ++this.sequence,
        timer =
          this.timeoutMs > 0
            ? setTimeout(
                () => this._fail(Object.assign(new Error("Export rendering timed out."),{telemetryCode:'timeout',telemetryStage:operation==='render'?'encode':'prepare'})),
                this.timeoutMs,
              )
            : null;
      this.pending = { id, resolve, reject, timer };
      try {
        this.worker.postMessage({ id, operation, ...payload });
      } catch (error) {
        this._fail(error);
      }
    });
  }
  async _chunks(report, operation) {
    const chunks = documentChunks(report, {
      maxRecords: 128,
      maxBytes: 64 * 1024,
      timeBudgetMs: 2,
    });
    for (;;) {
      this._check();
      const started = performance.now(),
        next = chunks.next();
      this.stats.maxMainSnapshotMs = Math.max(
        this.stats.maxMainSnapshotMs,
        performance.now() - started,
      );
      if (next.done) return;
      await this._request(operation, { chunk: next.value });
      this.stats.loadChunks++;
      this.stats.maxChunkBytes = Math.max(
        this.stats.maxChunkBytes,
        next.value.estimatedBytes || 0,
      );
      if (this.getRevision && this.getRevision() !== this.revision)
        throw abortError("The animation changed during export.");
    }
  }
  async load(report) {
    this._check();
    if (this.busy) throw new Error("Wait for the current export frame.");
    this.busy = true;
    this.loaded = false;
    try {
      this.revision = this.getRevision?.();
      await this._request("start", {
        options: {
          width: this.width,
          height: this.height,
          smoothing: this.smoothing,
          baseURL: this.baseURL,
          token: this.token,
          maxWorkingBytes: this.maxWorkingBytes,
        },
      });
      const { _stykSource, ...renderReport } = report;
      if(renderReport._styk?.audio){const {audio,...metadata}=renderReport._styk;renderReport._styk=metadata;}
      await this._chunks(renderReport, "chunk");
      await this._request("loaded");
      this.loaded = true;
      return this;
    } catch (error) {this._fail(error); throw error;} finally {
      this.busy = false;
    }
  }
  _paint(result) {
    if (!result.bitmap)
      throw new Error("The export renderer returned no pixel frame.");
    try {
      this._check();
      if (this.canvas.width !== this.width) this.canvas.width = this.width;
      if (this.canvas.height !== this.height) this.canvas.height = this.height;
      checkExportContext(this.context);
      if (result.bitmap.width !== this.width || result.bitmap.height !== this.height)
        throw new Error('The export renderer returned an incomplete frame.');
      this.context.setTransform(1, 0, 0, 1, 0, 0);
      this.context.clearRect(0, 0, this.width, this.height);
      this.context.imageSmoothingEnabled = false;
      this.context.drawImage(result.bitmap, 0, 0);
      checkExportContext(this.context);
    } finally {
      result.bitmap.close();
    }
    Object.assign(this.stats, result.stats);
    this.stats.renderedFrames++;
    return this.canvas;
  }
  async _render({ tick, frame, svg = false, native = false, preserveAlpha = false }) {
    this._check();
    if (!this.loaded) throw new Error("Load the animation before exporting.");
    if (this.busy)
      throw new Error("Export frames must be rendered sequentially.");
    this.busy = true;
    try {
      this.onFrame?.({stage: 'rendering', tick});
      if (frame) {
        await this._request("frame-start");
        await this._chunks({ keyframes: [frame] }, "frame-chunk");
      }
      const result = await this._request("render", {
        tick,
        override: Boolean(frame),
        svg,
        native,
        preserveAlpha,
      });
      if (native) {
        this._check();
        const output = result.nativeFrame;
        if (!(output?.blob instanceof Blob) || output.blob.type !== 'image/png' || !output.blob.size ||
            output.width !== this.width || output.height !== this.height)
          throw new Error('The export renderer returned an incomplete native frame.');
        Object.assign(this.stats, result.stats);
        this.stats.renderedFrames++;
        this.onFrame?.({stage: 'rendered', tick});
        return output;
      }
      if (svg) {
        this._check();
        Object.assign(this.stats, result.stats);
        this.onFrame?.({stage: 'rendered', tick});
        return result.svg;
      }
      const canvas = this._paint(result);
      this.onFrame?.({stage: 'rendered', tick});
      return canvas;
    } catch (error) {this._fail(error); throw error;} finally {
      this.busy = false;
    }
  }
  renderTick(tick) {
    return this._render({ tick });
  }
  renderNativeTick(tick, {preserveAlpha = false} = {}) {
    return this._render({tick, native: true, preserveAlpha});
  }
  renderFrame(frame) {
    return this._render({ frame });
  }
  renderSVGTick(tick) {
    return this._render({ tick, svg: true });
  }
  renderSVGFrame(frame) {
    return this._render({ frame, svg: true });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.signal?.removeEventListener("abort", this.abort);
    this._fail(abortError());
    this.canvas.width = this.canvas.height = 1;
  }
}
