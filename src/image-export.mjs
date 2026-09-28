import { normalizeGIFDither } from "./gif-options.mjs";
import { EXPORT_MAX_PIXELS } from "./export-sampling.mjs";
/** Offline animated image and numbered image-sequence exports.
 * Each frame is snapshotted into a transferable ImageBitmap; palette creation,
 * LZW, PNG/JPEG compression, checksums, APNG and ZIP writing stay in a worker.
 * Animated GIF renders each index twice: first to collect one animation palette,
 * then to encode. renderFrame must return the same committed image in both passes.
 */
const MAX_BYTES = 512 * 1024 * 1024;
// Streamed exports are bounded by the destination disk, not renderer memory.
// ZIP32 stores 32-bit offsets, so sequences must stay under 4 GiB.
const STREAM_MAX_BYTES = 16 * 1024 * 1024 * 1024;
const ZIP_STREAM_MAX_BYTES = 0xfff00000;
const formats = new Set([
  "gif",
  "apng",
  "png-sequence",
  "jpeg-sequence",
  "gif-sequence",
  "svg-sequence",
]);
const abortError = () =>
  new DOMException("Image export cancelled.", "AbortError");

/**
 * @param {{format:'gif'|'apng'|'png-sequence'|'jpeg-sequence'|'gif-sequence'|'svg-sequence',width:number,height:number,
 * fps:number,totalFrames:number,renderFrame:(index:number)=>Promise<HTMLCanvasElement|OffscreenCanvas>|HTMLCanvasElement|OffscreenCanvas,
 * renderSVGFrame?:(index:number)=>Promise<Blob|string>|Blob|string,
 * onProgress?:(value:{phase:"palette"|"encode",completed:number,total:number,progress:number})=>void,
 * signal?:AbortSignal,loop?:boolean,quality?:number,dither?:boolean,maxBytes?:number,
 * sink?:{streamed:boolean,write(part:Blob)=>Promise<void>,finish()=>Promise<object>,abort()=>Promise<void>}}} options
 * @returns {Promise<Blob|{saved:boolean,path?:string,size?:number,blob?:Blob}>} GIF, APNG, or ZIP
 * containing numbered PNG/JPEG frames — a Blob, or the sink's finish() result.
 */
export async function exportAnimation({
  format,
  width,
  height,
  fps,
  totalFrames,
  renderFrame,
  renderSVGFrame,
  onProgress,
  signal,
  loop = true,
  quality = 0.94,
  dither = false,
  maxBytes,
  timeoutMs = 120000,
  sink,
}) {
  format =
    {
      "jpg-sequence": "jpeg-sequence",
      "png-zip": "png-sequence",
      "jpeg-zip": "jpeg-sequence",
      "jpg-zip": "jpeg-sequence",
    }[format] || format;
  if (!formats.has(format))
    throw new Error("Choose GIF, APNG, or a PNG, JPEG, GIF or SVG sequence.");
  const vector = format === "svg-sequence";
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    (!vector && width * height > EXPORT_MAX_PIXELS)
  ) {
    throw new Error(
      `Image exports support dimensions up to 16,384 pixels and ${Math.round(EXPORT_MAX_PIXELS / 1e6)} million pixels per frame.`,
    );
  }
  const maxFrames = format.endsWith("sequence") ? 65534 : 100000;
  if (
    !Number.isInteger(totalFrames) ||
    totalFrames < 1 ||
    totalFrames > maxFrames
  )
    throw new Error(
      `Choose between 1 and ${maxFrames.toLocaleString()} export frames.`,
    );
  if (
    !Number.isFinite(fps) ||
    fps < 1 ||
    fps > (format === "gif" ? 50 : 1000)
  ) {
    throw new Error(
      format === "gif"
        ? "GIF export supports 1–50 fps; choose APNG or video for higher frame rates."
        : "Choose an image frame rate between 1 and 1,000 fps.",
    );
  }
  if (typeof (vector ? renderSVGFrame : renderFrame) !== "function")
    throw new TypeError(
      vector
        ? "SVG sequence export needs a vector frame renderer."
        : "Image export needs a frame renderer.",
    );
  if (!Number.isFinite(quality) || quality < 0 || quality > 1)
    throw new Error("JPEG quality must be between zero and one.");
  const streamed = sink?.streamed === true;
  const maxBytesCap = streamed
    ? format.endsWith("sequence")
      ? ZIP_STREAM_MAX_BYTES
      : STREAM_MAX_BYTES
    : MAX_BYTES;
  maxBytes ??= maxBytesCap;
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > maxBytesCap)
    throw new Error(
      streamed
        ? "The streamed export size limit is invalid."
        : "Choose an export size limit between 1 KiB and 512 MiB.",
    );
  dither = normalizeGIFDither(dither);
  if (signal?.aborted) throw abortError();
  if (
    typeof Worker === "undefined" ||
    (!vector &&
      (typeof createImageBitmap === "undefined" ||
        typeof OffscreenCanvas === "undefined"))
  ) {
    throw new Error(
      "This browser cannot export images in a worker. Open the StykAnimate desktop app or a current Chromium browser.",
    );
  }
  const worker = new Worker(
    new URL("./image-export-worker.mjs", import.meta.url),
    { type: "module", name: "StykAnimate image export" },
  );
  let sequence = 0,
    pending = null,
    failure;
  const fail = (error) => {
    failure = error;
    clearTimeout(pending?.timer);
    pending?.reject(error);
    pending = null;
    worker.terminate();
  };
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    fail(new Error(event.message || "The image export worker stopped."));
  });
  worker.addEventListener("messageerror", () =>
    fail(new Error("An image frame could not be transferred.")),
  );
  worker.addEventListener("message", (event) => {
    if (!pending || pending.id !== event.data?.id) return;
    const request = pending;
    pending = null;
    clearTimeout(request.timer);
    event.data.ok
      ? request.resolve(event.data)
      : request.reject(new Error(event.data.error || "Image encoding failed."));
  });
  const check = () => {
    if (signal?.aborted) throw abortError();
    if (failure) throw failure;
  };
  const request = (operation, data = {}, transfer = []) => {
    check();
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => fail(new Error('Image encoding timed out. Export stopped; try again at a smaller size.')), timeoutMs);
      pending = { id, resolve, reject, timer };
      try {
        worker.postMessage({ id, operation, ...data }, transfer);
      } catch (error) {
        clearTimeout(timer);
        pending = null;
        reject(error);
      }
    });
  };
  const abort = () => fail(abortError());
  signal?.addEventListener("abort", abort, { once: true });
  let completed = false;
  const forward = async (response) => {
    if (sink && response?.output instanceof Blob) await sink.write(response.output);
  };
  try {
    await forward(
      await request("start", {
        config: {
          format,
          width,
          height,
          fps,
          totalFrames,
          loop,
          quality,
          dither,
          maxBytes,
          stream: Boolean(sink),
        },
      }),
    );
    const passes = format === "gif" ? 2 : 1,
      totalWork = totalFrames * passes;
    for (let pass = 0; pass < passes; pass++) {
      if (pass === 1) await forward(await request("encode"));
      for (let index = 0; index < totalFrames; index++) {
        check();
        if (vector) {
          const svg = await renderSVGFrame(index);
          check();
          if (!(svg instanceof Blob) && typeof svg !== "string")
            throw new Error(
              `Rendered SVG frame ${index + 1} must contain SVG text or a Blob.`,
            );
          await forward(await request("frame", { svg }));
          check();
          onProgress?.({
            phase: passes === 2 && pass === 0 ? "palette" : "encode",
            completed: pass * totalFrames + index + 1,
            total: totalWork,
            progress: (pass * totalFrames + index + 1) / totalWork,
          });
          continue;
        }
        const canvas = await renderFrame(index);
        check();
        if (!canvas || canvas.width !== width || canvas.height !== height)
          throw new Error(
            `Rendered image frame ${index + 1} has the wrong dimensions.`,
          );
        const bitmap = await createImageBitmap(canvas);
        try {
          check();
          // Backpressure: only one full-resolution frame is in flight at a time.
          await forward(await request("frame", { bitmap }, [bitmap]));
        } finally {
          bitmap.close();
        }
        check();
        onProgress?.({
          phase: passes === 2 && pass === 0 ? "palette" : "encode",
          completed: pass * totalFrames + index + 1,
          total: totalWork,
          progress: (pass * totalFrames + index + 1) / totalWork,
        });
      }
    }
    const response = await request("finish");
    check();
    if (sink) {
      await forward(response);
      const result = await sink.finish();
      completed = true;
      return result;
    }
    completed = true;
    return response.blob;
  } finally {
    clearTimeout(pending?.timer);
    signal?.removeEventListener("abort", abort);
    worker.terminate();
    if (sink && !completed) await sink.abort();
  }
}
