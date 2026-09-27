/**
 * Exporting (architecture.md §3.15): the export dialog (showExport, with
 * export-panel.mjs's mountExportFlow arranging its controls), every export
 * command, the export renderer's job and its progress dialog, and writing the
 * result (saveBlob, finishExport).
 *
 * The export commands register themselves in the app's `actions` map, before
 * app.mjs wraps every action (drawing barrier, polygon guard, telemetry).
 * Every export runs from an explicit ExportRequest (export-request.mjs): the
 * request holds the choices, and exportJob() derives the options, file name
 * and encoder arguments from it and the editor's state. Until the export sheet
 * holds the request, the request is read from the open dialog's fields
 * (legacyExportFields); a command run without the dialog exports today's
 * defaults. tests/export-request.test.mjs proves the derivation equals the
 * dialog-field code it replaced (tests/fixtures/export-legacy.mjs).
 *
 * DOM-free at import. ctx (from app.mjs): {editor, state, $, esc, actions,
 * desktop, importer, telemetry, audioEngine, exportJobs, playback,
 * editablePreparation, fail, status, toast, persistentFailure, showDialog,
 * closeDialog, finishCurrentEdit, pause, interruptRecovery,
 * runDocumentExport, writeNativeBlob, currentFrame, nameOf,
 * simpleFrameCount}.
 */
import { encodeWebM } from "./video-export.mjs";
import { encodeNativeVideo } from "./native-video-export.mjs";
import { encodeVfwVideo } from "./vfw-video-export.mjs";
import { VfwExportControls } from "./vfw-export-controls.mjs";
import { getExportCapabilities, exportFormat } from "./export-capabilities.mjs";
import { audioState, audibleClips } from "./audio-model.mjs";
import { workload } from "./telemetry-workload.mjs";
import { sizeBucket } from "./telemetry-schema.mjs";
import { openExportSink as openExportSinkRaw } from "./export-sink.mjs";
import { materializeSimpleFrameDraftForPivot } from "./pivot-frame-draft.mjs";
import { exportAnimation } from "./image-export.mjs";
import { defaultGIFDither } from "./gif-options.mjs";
import { ExportFrameRenderer } from "./export-frame-renderer.mjs";
import { exportProgressMarkup, mountExportProgress } from "./export-progress.mjs";
import { checkExportContext } from "./export-canvas.mjs";
import { EXPORT_SMOOTHING } from "./export-sampling.mjs";
import { buildExportRequest, exportJob, legacyExportFields } from "./export-request.mjs";
import { mountExportFlow } from "./export-panel.mjs";
import { isMovieclip } from "./movieclips.mjs";
import { icon } from "./icons.mjs";

export function createExportFlow(ctx) {
  const {
    editor, state, $, esc, actions, desktop, importer, telemetry, audioEngine, exportJobs, playback, editablePreparation,
    fail, status, toast, persistentFailure, showDialog, closeDialog, finishCurrentEdit, pause, interruptRecovery,
    runDocumentExport, writeNativeBlob, currentFrame, nameOf, simpleFrameCount,
  } = ctx;
  const exportTelemetry = new WeakMap();
  let vfwExportControls;
  async function openExportSink(options){
    const enabled=telemetry.consent.diagnostics,context=enabled?telemetry.performance.context():null,epoch=telemetry.epoch,started=enabled?performance.now():0;
    const onTiming=(metric,ms)=>{if(epoch===telemetry.epoch)telemetry.performance.record(metric,ms,context);};
    const sink=await openExportSinkRaw({...options,...(enabled?{onTiming}:{})});
    if(enabled)onTiming('dialog',performance.now()-started);
    return sink;
  }
  async function saveBlob(blob, filename, signal) {
    const measurement = signal && exportTelemetry.get(signal), writeStarted = performance.now();
    measurement?.onProgress?.({phase: 'saving'});
    measurement?.releaseRenderer?.();
    if (measurement) {
      measurement.context.size = sizeBucket(blob.size);
      telemetry.timing('export_ms', writeStarted - measurement.started);
      telemetry.operation({ ...measurement.context, operation: 'export', stage: 'encode', outcome: 'succeeded' }, writeStarted - measurement.started);
      measurement.stage = 'write';
    }
    let saved;
    if (desktop) {
      saved = await writeNativeBlob(desktop, blob, {
        signal,
        defaultPath: filename,
        filters: [
          {
            name: filename.split(".").at(-1).toUpperCase(),
            extensions: [filename.split(".").at(-1)],
          },
        ],
      });
    } else {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
      saved = true;
    }
    if (measurement) telemetry.operation({ ...measurement.context, operation: 'export', stage: 'write', outcome: saved ? 'succeeded' : 'cancelled' }, performance.now() - writeStarted);
    return saved;
  }
  /** Route an encoder result to its saved state: a Blob goes through the
   * classic save path; a sink finish() result is already on disk. */
  async function finishExport(output, filename, signal) {
    const blob = output instanceof Blob ? output : output?.blob;
    if (blob) return saveBlob(blob, filename, signal);
    const measurement = signal && exportTelemetry.get(signal), finished = performance.now();
    if (measurement) {
      measurement.context.size = sizeBucket(output?.size ?? 0);
      telemetry.timing('export_ms', finished - measurement.started);
      telemetry.performance.record('encode',finished-measurement.started);
      telemetry.operation({ ...measurement.context, operation: 'export', stage: 'encode', outcome: 'succeeded' }, finished - measurement.started);
      measurement.stage = 'write';
      measurement.releaseRenderer?.();
      telemetry.operation({ ...measurement.context, operation: 'export', stage: 'write', outcome: output?.saved ? 'succeeded' : 'cancelled' }, 0);
    }
    return Boolean(output?.saved);
  }
  /**
   * The choices of an export of `format` (an EXPORT_FORMATS id) as an
   * ExportRequest: the open export dialog's fields, until the export sheet
   * holds the request; with no dialog open, today's defaults (the artboard
   * size, the whole animation, 94% quality), as a palette command exports.
   */
  function currentRequest(format) {
    const fields = legacyExportFields($, format);
    // The codec settings chosen with Configure codec… belong to this choice.
    if (fields.vfw) fields.vfw.configurationId = vfwExportControls?.requestContext().configurationId;
    return buildExportRequest(fields, {
      canvasWidth: editor.report.canvas_width,
      canvasHeight: editor.report.canvas_height,
      totalFrames: editor.totalTicks,
    });
  }
  /** What exportJob() reads from the editor. `report` is the one played: in Simple mode, with its working frame materialized. */
  function jobContext(request, report = editor.report) {
    return {
      totalFrames: editor.totalTicks,
      fps: report.frame_delay_ms ? 1000 / report.frame_delay_ms : report.fps,
      defaultDither: defaultGIFDither(editor.report),
      // Browser WebM uses WebCodecs unless the capability probe chose FFmpeg for it.
      provider: document.querySelector('[data-action="export-video"]')?.dataset.provider,
      audioClips: audibleClips(audioState(report)),
      loop: state.loop,
      name: editor.name,
      objectName: nameOf(editor.object),
      tick: editor.tick,
      movieclip: isMovieclip(editor.figure),
      vfw: request.format === "vfw" ? (vfwExportControls?.requestContext() ?? { available: false }) : undefined,
    };
  }
  const playedReport = () =>
    state.settings.timelineMode === "simple"
      ? materializeSimpleFrameDraftForPivot(editor.report)
      : editor.report;
  /** An editable file: .piv, .stk, .stkz, or .stykmov (the figure type of a selected movieclip). */
  async function exportPivot(type = "piv") {
    finishCurrentEdit();
    interruptRecovery();
    const request = currentRequest(type),
      { format, filename } = exportJob(request, jobContext(request));
    status(`Writing .${format}…`, false, true);
    let saved;
    try {
      saved = await runDocumentExport(format, (blob, signal) =>
        saveBlob(blob, filename, signal),
      );
    } catch (error) {
      if (error.name === "AbortError") {
        status("Export cancelled");
        return;
      }
      throw error;
    }
    if (saved) {
      status(`Exported .${format}`);
      toast(
        `Your ${["stk", "stkz", "stykmov"].includes(format) ? "figure" : "animation"} was exported as .${format}.`,
      );
    }
    closeDialog();
  }
  /** Keep rendering off the UI thread and cancel the whole job if its document changes. */
  async function withExportRenderer(
    options,
    report,
    render,
    { frames = 1, title = "Exporting animation", format = 'unknown', fps, passes = 1, start = options.start ?? editor.tick } = {},
  ) {
    if ([...exportJobs].some(job => job.raster)) throw new Error('An export is already running. Wait for it to finish or cancel it.');
    pause();
    interruptRecovery();
    // Drop speculative playback pixels while keeping the editable document and
    // active scene. Workers reload their disposable cache when playback resumes.
    editablePreparation.cancel();
    state.editingPacket = null;
    playback.invalidate();
    state.renderer?.clearPreparedFrames?.();
    const controller = new AbortController(),
      job = { controller, recovery: false, raster: true },
      source = editor.report;
    exportJobs.add(job);
    const measurement = { started: performance.now(), stage: 'prepare', context: telemetry.consent.diagnostics ? workload({ format, report, fps }) : {} };
    telemetry.count('export_started'); exportTelemetry.set(controller.signal, measurement);
    let frameRenderer;
    showDialog(
      title,
      exportProgressMarkup,
    );
    const progress = $("export-progress"),
      dialog = $("dialog"),
      cancel = () => controller.abort();
    const onClose = () => {
      if (!dialog.open || !progress.isConnected) cancel();
    };
    const progressUI = mountExportProgress($("dialog-content"), {frames, passes, start}, cancel);
    measurement.onProgress = value => progressUI.update(value);
    measurement.releaseRenderer = () => frameRenderer?.dispose();
    dialog.addEventListener("close", onClose);
    try {
      frameRenderer = new ExportFrameRenderer({
        width: options.width,
        height: options.height,
        smoothing: options.smoothing,
        baseURL: importer.baseURL,
        token: importer.token,
        signal: controller.signal,
        onFrame: ({stage, tick}) => stage === 'rendering' ? progressUI.frameStarted(tick) : progressUI.frameRendered(),
        getRevision: () =>
          editor.report === source
            ? `${editor.revision}:${editor.frameDraftRevision}`
            : "replaced",
      });
      await frameRenderer.load(report);
      measurement.stage = 'encode';
      const saved = await render(
        frameRenderer,
        controller.signal,
        value => {
          progressUI.update(value);
          // Every consumer has acknowledged the last frame. Release raster pixels
          // and the worker's document before container assembly and file writing.
          if (value.completed === frames * passes) frameRenderer.dispose();
        },
      );
      telemetry.count(saved ? 'export_succeeded' : 'export_cancelled');
      telemetry.operation({ ...measurement.context, operation: 'export', stage: 'complete', outcome: saved ? 'succeeded' : 'cancelled' }, performance.now() - measurement.started);
      if (saved) telemetry.milestone('first_export');
      return saved;
    } catch (error) {
      telemetry.count(error.name === 'AbortError' ? 'export_cancelled' : 'export_failed');
      telemetry.operation({ ...measurement.context, operation: 'export', stage: 'complete', outcome: error.name === 'AbortError' ? 'cancelled' : 'failed' }, performance.now() - measurement.started);
      if (error.name !== 'AbortError') telemetry.error(error, 'export', { ...measurement.context, stage: measurement.stage });
      if (error.name === "AbortError") {
        status("Export cancelled");
        return false;
      }
      throw persistentFailure(error);
    } finally {
      frameRenderer?.dispose();
      progressUI.dispose();
      exportTelemetry.delete(controller.signal);
      exportJobs.delete(job);
      dialog.removeEventListener("close", onClose);
      if (progress.isConnected) closeDialog();
    }
  }
  async function exportPNG() {
    telemetry.count('export_png');
    finishCurrentEdit();
    const request = currentRequest("png"),
      { options, filename } = exportJob(request, jobContext(request)),
      frame = currentFrame();
    await withExportRenderer(
      options,
      editor.report,
      async (renderer, signal) => {
        const canvas = await renderer.renderFrame(frame);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        checkExportContext(renderer.context);
        if (!blob) throw new Error("PNG export failed.");
        if (signal.aborted)
          throw new DOMException("Export cancelled.", "AbortError");
        const saved = await saveBlob(blob, filename, signal);
        if (saved) status("PNG exported");
        return saved;
      },
      { title: "Exporting frame", format: 'png', start: editor.tick },
    );
  }
  async function exportSVGFrame() {
    telemetry.count('export_svg');
    finishCurrentEdit();
    // SVG keeps vector paths: its options say "edges" whatever the request's smoothing.
    const request = currentRequest("svg"),
      { options, filename } = exportJob(request, jobContext(request)),
      frame = currentFrame();
    await withExportRenderer(
      options,
      editor.report,
      async (renderer, signal) => {
        const blob = await renderer.renderSVGFrame(frame);
        const saved = await saveBlob(blob, filename, signal);
        if (saved) status("SVG exported");
        return saved;
      },
      { title: "Exporting vector frame", format: 'svg', start: editor.tick },
    );
  }
  async function exportImages(format) {
    telemetry.count(format.startsWith('svg') ? 'export_svg' : format.startsWith('gif') ? 'export_gif' : format.startsWith('jpeg') ? 'export_jpeg' : 'export_png');
    finishCurrentEdit();
    // The options, frame count, rate, name and GIF repeat (the Loop setting) come from the request.
    const request = currentRequest(format),
      report = playedReport(),
      { options, ticks, fps, filename, animation } = exportJob(request, jobContext(request, report));
    if ([...exportJobs].some(job => job.raster)) throw new Error('An export is already running. Wait for it to finish or cancel it.');
    // Streamed exports pick their destination up front, then write while encoding.
    const sink = await openExportSink({
      filename,
      mimeType: exportFormat(format)?.mimeType,
      desktop,
    });
    if (!sink) {
      telemetry.count('export_cancelled');
      return false;
    }
    try {
      return await withExportRenderer(
        options,
        report,
        async (renderer, signal, onProgress) => {
          sink.signal = signal;
          const output = await exportAnimation({
            ...animation,
            signal,
            onProgress,
            sink,
            renderFrame: (index) => renderer.renderTick(index + options.start),
            renderSVGFrame: (index) =>
              renderer.renderSVGTick(index + options.start),
          });
          const saved = await finishExport(output, filename, signal);
          if (saved) status("Animation exported");
          return saved;
        },
        { frames: ticks, format: format === 'apng' ? 'png' : format.split('-')[0], fps, passes: format === 'gif' ? 2 : 1 },
      );
    } catch (error) {
      await sink.abort().catch(() => {});
      throw error;
    }
  }
  async function exportVideo(format = "webm") {
    telemetry.count('export_video');
    finishCurrentEdit();
    // The request gives the encoder, codec, quality or bitrate, Windows codec
    // options, size, range and whether sound goes in; a request that cannot be
    // encoded (sound with a browser encoder, a VFW codec still being checked)
    // throws here with the reason, before a file is chosen.
    const request = currentRequest(format),
      report = playedReport(),
      plan = exportJob(request, jobContext(request, report)),
      { options, ticks, fps, extension, filename, includeAudio } = plan;
    const encode = { vfw: encodeVfwVideo, webcodecs: encodeWebM, native: encodeNativeVideo }[plan.encoder];
    // Native exports keep the encoded file on disk in the desktop process; a
    // direct save moves it without piping bytes through the renderer. Every
    // other path streams encoder output into the chosen file as it is produced.
    const saveMethod =
      encode === encodeNativeVideo
        ? "saveVideoExport"
        : encode === encodeVfwVideo
          ? "saveVfwExport"
          : null;
    const directSave =
      saveMethod && typeof desktop?.[saveMethod] === "function";
    if ([...exportJobs].some(job => job.raster)) throw new Error('An export is already running. Wait for it to finish or cancel it.');
    const sink = directSave
      ? null
      : await openExportSink({
          filename,
          mimeType: exportFormat(format === "vfw" ? "avi" : format)?.mimeType,
          desktop,
        });
    if (!directSave && !sink) {
      telemetry.count('export_cancelled');
      return false;
    }
    try {
      return await withExportRenderer(
        options,
        report,
        async (renderer, signal, onProgress) => {
          if (sink) sink.signal = signal;
          const output = await encode({
            audioChunks: includeAudio ? audioEngine.exportChunks(report, {start:options.start / fps,duration:ticks / fps,signal}) : undefined,
            ...plan.encode,
            desktop,
            signal,
            onProgress,
            sink,
            save: directSave
              ? {
                  defaultPath: filename,
                  filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
                }
              : undefined,
            renderFrame: (index) => renderer.renderTick(index + options.start),
            ...(encode === encodeNativeVideo ? {renderNativeFrame: index => renderer.renderNativeTick(index + options.start, {preserveAlpha: format === 'webm'})} : {}),
          });
          const saved = await finishExport(output, filename, signal);
          if (saved) status(`${extension.toUpperCase()} exported`);
          return saved;
        },
        { frames: ticks, format: 'video', fps },
      );
    } catch (error) {
      await sink?.abort().catch(() => {});
      throw error;
    }
  }
  function showExport() {
    finishCurrentEdit();
    vfwExportControls?.dispose();
    showDialog(
      "Export your animation",
      `<details class="export-settings"><summary>Render settings <span>${editor.report.canvas_width} × ${editor.report.canvas_height} · ${editor.totalTicks} frames</span></summary><div class="text-options"><label>Width<input id="export-width" type="number" min="1" value="${editor.report.canvas_width}"></label><label>Height<input id="export-height" type="number" min="1" value="${editor.report.canvas_height}"></label><label class="check-row"><input type="checkbox" id="export-aspect" checked>Lock ratio</label></div><div class="text-options"><label>First frame<input id="export-start" type="number" min="1" max="${editor.totalTicks}" value="1"></label><label>Last frame<input id="export-end" type="number" min="1" max="${editor.totalTicks}" value="${editor.totalTicks}"></label><label>Lossy quality %<input id="export-quality" type="number" min="1" max="100" value="94"></label></div></details><div class="export-grid"><button class="export-option" data-action="export-stkz" ${editor.object ? "" : "disabled"}>${icon("person")}<span><strong>${isMovieclip(editor.figure)?"StykAnimate movieclip":"StykAnimate figure"}</strong><small>${isMovieclip(editor.figure)?".stykmov":".stkz"}</small></span></button><button class="export-option" data-action="export-piv">${icon("file")}<span><strong>Pivot animation</strong><small>.piv · Editable animation and media</small></span></button><button class="export-option" data-action="export-stk" ${editor.object ? "" : "disabled"}>${icon("person")}<span><strong>Pivot figure</strong><small>.stk · Reusable Pivot figure</small></span></button><button class="export-option" data-action="export-png">${icon("frame")}<span><strong>PNG frame</strong><small>.png · Full canvas resolution</small></span></button><button class="export-option" data-action="export-svg">${icon("nodes")}<span><strong>SVG frame</strong><small>.svg · Editable paths and embedded media</small></span></button><button class="export-option" data-action="export-video">${icon("play")}<span><strong>WebM video</strong><small>.webm · Exact frame timing</small></span></button><button class="export-option" data-action="export-gif">${icon("loop")}<span><strong>Animated GIF</strong><small>.gif · Looping animation</small></span></button><button class="export-option" data-action="export-apng">${icon("frame")}<span><strong>Animated PNG</strong><small>.png · Lossless color and transparency</small></span></button><button class="export-option" data-action="export-png-sequence">${icon("duplicate")}<span><strong>PNG sequence</strong><small>.zip · Numbered lossless frames</small></span></button><button class="export-option" data-action="export-jpeg-sequence">${icon("duplicate")}<span><strong>JPEG sequence</strong><small>.zip · Numbered compact frames</small></span></button></div>`,
    );
    $("dialog-content")
      .querySelector(".export-settings")
      .insertAdjacentHTML(
        "beforeend",
        `<div class="text-options"><label>Smoothing<select id="export-smoothing" title="Pixel exports only. SVG keeps editable vector paths.">${EXPORT_SMOOTHING.map((option) => `<option value="${option.value}" title="${esc(option.description)}">${esc(option.label)}</option>`).join("")}</select></label><label class="check-row" title="Improve gradients and photographs in GIF exports."><input type="checkbox" id="export-gif-dither" ${defaultGIFDither(editor.report) ? "checked" : ""}>Dither (GIF)</label></div>`,
      );
    const grid = $("dialog-content").querySelector(".export-grid");
    grid.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="export-option" data-action="export-vfw" disabled>${icon("play")}<span><strong>Windows AVI</strong><small>Installed video codecs</small></span></button>`,
    );
    vfwExportControls = new VfwExportControls({
      container: $("dialog-content").querySelector(".export-settings"),
      button: grid.querySelector('[data-action="export-vfw"]'),
      dialog: $("dialog"),
      canExport: () => editor.totalTicks > 0,
      getDimensions: () => ({
        width: Number($("export-width").value),
        height: Number($("export-height").value),
      }),
      onError: fail,
    });
    if (
      editor.frameDraft?.mode === "add" &&
      editor.frameDraft.dirty &&
      editor.totalTicks > 0
    )
      grid.insertAdjacentHTML(
        "beforebegin",
        '<p class="property-note">Add the working pose as a frame to include it in animation exports. Your .styk project keeps the working pose.</p>',
      );
    $("dialog-content")
      .querySelector(".export-settings")
      .insertAdjacentHTML(
        "beforeend",
        `<div class="text-options export-codecs"><label>MP4 codec<select id="export-mp4-codec" aria-label="MP4 codec" disabled></select></label><label>AVI codec<select id="export-avi-codec" aria-label="AVI codec" disabled></select></label></div>`,
      );
    for (const [id, label, note] of [
      ["mp4", "MP4 video", "H.264 video"],
      ["avi", "AVI video", "MPEG-4 video"],
      ["wmv", "Windows Media video", "WMV video"],
      ["gif-sequence", "GIF sequence", "Numbered GIF frames"],
      ["svg-sequence", "SVG sequence", "Numbered vector frames"],
    ])
      grid.insertAdjacentHTML(
        "beforeend",
        `<button type="button" class="export-option" data-action="export-${id}" ${id.endsWith("sequence") ? "" : "disabled"}>${icon(id.endsWith("sequence") ? "duplicate" : "play")}<span><strong>${label}</strong><small>${note}</small></span></button>`,
      );
    const singleFrameActions = new Set([
      "export-piv",
      "export-stk",
      "export-stkz",
      "export-png",
      "export-svg",
    ]);
    if (editor.totalTicks === 0) {
      for (const id of ["export-start", "export-end"]) {
        $(id).value = "0";
        $(id).disabled = true;
      }
      for (const button of grid.querySelectorAll("[data-action]")) {
        if (!singleFrameActions.has(button.dataset.action)) {
          button.disabled = true;
          button.title = "Add a frame to export an animation.";
        }
      }
      grid.insertAdjacentHTML(
        "beforebegin",
        '<p class="property-note">Add a frame to export an animation.</p>',
      );
    }
    let capabilitySequence = 0;
    async function refreshCapabilities() {
      const sequence = ++capabilitySequence;
      try {
        const width = Number($("export-width")?.value),
          height = Number($("export-height")?.value);
        const capabilities = await getExportCapabilities({
          width,
          height,
          fps: editor.report.frame_delay_ms
            ? 1000 / editor.report.frame_delay_ms
            : editor.report.fps,
          desktop,
        });
        if (sequence !== capabilitySequence || !grid.isConnected) return;
        for (const format of capabilities.formats) {
          const button = grid.querySelector(
            `[data-action="export-${format.id === "webm" ? "video" : format.id}"]`,
          );
          if (!button) continue;
          const select = $(`export-${format.id}-codec`);
          if (select) {
            const selected = select.value || format.defaultCodec;
            select.innerHTML = (format.codecs || [])
              .map(
                (codec) =>
                  `<option value="${esc(codec.id)}" ${codec.supported ? "" : "disabled"}>${esc(codec.label)}${codec.lossless && !/lossless|uncompressed/i.test(codec.label) ? " · Lossless" : ""}</option>`,
              )
              .join("");
            select.disabled = !(format.codecs || []).some(
              (codec) => codec.supported,
            );
            if (
              [...select.options].some(
                (option) => option.value === selected && !option.disabled,
              )
            )
              select.value = selected;
            else
              select.value =
                [...select.options].find((option) => !option.disabled)?.value ||
                "";
          }
          const selectedCodec = format.codecs?.find(
            (codec) => codec.id === select?.value,
          );
          const encodedWidth = selectedCodec?.encodedWidth || format.encodedWidth,
            encodedHeight = selectedCodec?.encodedHeight || format.encodedHeight;
          button.dataset.provider = format.provider || "";
          button.disabled =
            !format.supported ||
            selectedCodec?.supported === false ||
            (editor.totalTicks === 0 &&
              !singleFrameActions.has(button.dataset.action));
          button.title =
            (editor.totalTicks === 0 &&
            !singleFrameActions.has(button.dataset.action)
              ? "Add a frame to export an animation."
              : "") ||
            format.reason ||
            (selectedCodec ? selectedCodec.notice : format.notice) ||
            "";
          if (format.kind === "video")
            button.querySelector("small").textContent = format.supported
              ? `.${format.extension} · ${selectedCodec?.label || format.codec || format.label}${encodedWidth && (encodedWidth !== width || encodedHeight !== height) ? ` · ${encodedWidth} × ${encodedHeight} (padded)` : ""}`
              : format.reason;
        }
      } catch (error) {
        for (const button of grid.querySelectorAll(
          '[data-action="export-video"],[data-action="export-mp4"],[data-action="export-avi"],[data-action="export-wmv"]',
        )) {
          button.disabled = true;
          button.title = error.message;
        }
      }
    }
    for (const id of ["export-width", "export-height"])
      $(id).oninput = () => {
        if ($("export-aspect").checked) {
          const value = Number($(id).value),
            ratio = editor.report.canvas_width / editor.report.canvas_height;
          if (value > 0)
            $(id === "export-width" ? "export-height" : "export-width").value =
              Math.max(
                1,
                Math.round(id === "export-width" ? value / ratio : value * ratio),
              );
        }
        void refreshCapabilities();
      };
    for (const id of ["export-mp4-codec", "export-avi-codec"])
      $(id).onchange = () => void refreshCapabilities();
    void refreshCapabilities();
    mountExportFlow($("dialog-content"), {audioClips:audibleClips(audioState(editor.report)),audioSupported:typeof desktop?.writeVideoAudioChunk==='function',width: editor.report.canvas_width, height: editor.report.canvas_height,
      totalFrames: editor.totalTicks, storedFrames: simpleFrameCount(), currentFrame: editor.tick + 1,
      fps: editor.report.frame_delay_ms ? 1000 / editor.report.frame_delay_ms : editor.report.fps});
  }
  Object.assign(actions, {
    export: showExport,
    "export-piv": () => exportPivot(),
    "export-stk": () => exportPivot("stk"),
    // A selected movieclip writes .stykmov (exportJob decides, as the figure type says).
    "export-stkz": () => exportPivot("stkz"),
    "export-stykmov": () => exportPivot("stykmov"),
    "export-png": exportPNG,
    "export-video": () => exportVideo(),
    "export-mp4": () => exportVideo("mp4"),
    "export-avi": () => exportVideo("avi"),
    "export-wmv": () => exportVideo("wmv"),
    "export-vfw": () => exportVideo("vfw"),
    "export-gif-sequence": () => exportImages("gif-sequence"),
    "export-svg-sequence": () => exportImages("svg-sequence"),
    "export-svg": exportSVGFrame,
    "export-gif": () => exportImages("gif"),
    "export-apng": () => exportImages("apng"),
    "export-png-sequence": () => exportImages("png-sequence"),
    "export-jpeg-sequence": () => exportImages("jpeg-sequence"),
  });
  return { showExport, exportPivot, saveBlob, finishExport };
}
