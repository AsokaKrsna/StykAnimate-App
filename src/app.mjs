import {drawingBarrier,drawingResourcesFor} from './drawing-resources.mjs';
import {drawingMetadata} from './drawing-model.mjs';
import {builderStrokeAppearance, setBuilderStroke, copyBuilderAppearance, pasteBuilderAppearance} from './builder-appearance.mjs';
import {rigControlChange, drawRigGuides, drawConnectorGuides} from './rig-controls.mjs';
import {displayedSegmentPaint,displayedColor} from './figure-colors.mjs';
import {openSurfaceReference,changeSurfaceSide} from './builder-surface-ui.mjs';
import {openRigTest, openRigExamples} from './rig-test-ui.mjs';
import {bucketRegion, pickFigureFill, drawFillHighlight} from './builder-fill.mjs';
import {figureJoinAction, joinTargetUids} from './figure-join-action.mjs';
import {duplicatePreview, drawDuplicatePreview} from './builder-duplicate-preview.mjs';
import {createConstruction, strokeSegments} from './builder-construction.mjs';
import {CameraMotionControls} from './camera-motion-ui.mjs';
import {installColorPickers} from './color-picker.mjs';
import {sampleCanvasRegion} from './canvas-color-sample.mjs';
import {installMovieclipUI} from './movieclip-ui.mjs';
import {isMovieclip} from './movieclips.mjs';
import {segmentPaint, parseColor, hexColor, backgroundPaint, paintBackground} from './paint.mjs';
import {resolveInstanceFigure, polygonIdentity} from './animation-style.mjs';
import { applicationMenuItems } from "./application-menu.mjs";
import { Editor } from "./editor.mjs";
import { createRenderer,worldToScreen,screenToWorld } from "./renderer.mjs";
import {DrawingController} from './drawing-controller.mjs';
import { Timeline } from "./layer-timeline.mjs";
import { SheetFilmstrip as SimpleTimeline } from "./sheet-filmstrip.mjs";
import { OnionSkinCache } from "./onion-skin.mjs";
import {hasPinnedIK} from './ik.mjs';
import { OnionControls } from "./onion-controls.mjs";
import { OnionController } from "./onion-controller.mjs";
import { ThumbnailRenderer } from "./thumbnail-renderer.mjs";
import { BackgroundDialog } from "./background-dialog.mjs";
import { ImportClient } from "./import-client.mjs";
import { encodeWebM } from "./video-export.mjs";
import { encodeNativeVideo } from "./native-video-export.mjs";
import { encodeVfwVideo } from "./vfw-video-export.mjs";
import { VfwExportControls } from "./vfw-export-controls.mjs";
import { getExportCapabilities, exportFormat } from "./export-capabilities.mjs";
import { videoQualityOptions } from "./export-video-quality.mjs";
import { PlaybackCache } from "./playback.mjs";
import {playbackWindow,playbackLookaheadSize,playbackStartupWindow} from './playback-window.mjs';
import {PlaybackUploadWarmup,PlaybackUploadAhead} from './playback-upload.mjs';
import {AudioEngine} from './audio-engine.mjs';
import {audioState, audioFps, audibleClips} from './audio-model.mjs';
import {PreviewImages} from './preview-images.mjs';
import {backgroundImageAssets,frameImageDrawables} from './scene-preparation.mjs';
import { PlaybackMetrics } from "./playback-metrics.mjs";
import {PlaybackCadence} from './playback-cadence.mjs';
import {previewQualityLevels, previewMsaaLevels, updatePreviewQuality, playbackQualityIndex} from './preview-quality.mjs';
import { DesktopTelemetryClient } from './telemetry-core.mjs';
import { workload, documentComplexity } from './telemetry-workload.mjs';
import { sizeBucket,complexityBucket,fpsBucket } from './telemetry-schema.mjs';
import { writeBrowserRecovery } from './browser-recovery.mjs';
import { openExportSink as openExportSinkRaw } from './export-sink.mjs';
import { PrivacyUI } from './privacy-ui.mjs';
import { FeedbackUI } from './feedback-ui.mjs';
import { UpdateUI } from './update-ui.mjs';
import { ReleaseSplash } from './support-ui.mjs';
import { EditableScenePreparation } from './editable-scene-preparation.mjs';
import { TextDialog } from "./text-dialog.mjs";
import { SegmentValuesDialog } from "./segment-values-dialog.mjs";
import { SpritePlacementDialog } from "./sprite-placement-dialog.mjs";
import { PolygonDraft } from "./polygon-draft.mjs";
import { polygonPreviewPoints } from "./polygon-preview.mjs";
import {
  isBuilderContext,
  builderBackgroundColor,
  builderShowsStaticHandles,
  drawBuilderHighlight,
} from "./builder-aids.mjs";
import { InsertInbetweenDialog } from "./insert-inbetween-dialog.mjs";
import { materializeSimpleFrameDraftForPivot } from "./pivot-frame-draft.mjs";
import { installNativeFrameClipboard } from "./frame-clipboard-storage.mjs";
import { ClipboardWorkerClient } from "./clipboard-worker-client.mjs";
import { exportAnimation } from "./image-export.mjs";
import { defaultGIFDither } from "./gif-options.mjs";
import { ExportFrameRenderer } from "./export-frame-renderer.mjs";
import { exportProgressMarkup, mountExportProgress } from "./export-progress.mjs";
import { checkExportContext } from "./export-canvas.mjs";
import {
  EXPORT_MAX_PIXELS,
  EXPORT_SMOOTHING,
  normalizeExportSmoothing,
} from "./export-sampling.mjs";
import { initWorkspaceLayout } from "./studio-layout.mjs";
import { initStudioShell, mountExportFlow } from "./studio-shell.mjs";
import { initBuilderMode } from "./builder-mode.mjs";
import { inspectorView } from "./inspector-view.mjs";
import { updateInspectorDOM } from "./inspector-dom.mjs";
import {syncCameraControls, drawCameraMonitor} from './camera-monitor.mjs';
import { AssetLibrary } from "./asset-library.mjs";
import { UserLibrary } from './user-library.mjs';
import { installLibraryDrag, installLibraryDrop } from './library-drag.mjs';
import { SharedClipboard } from './shared-clipboard.mjs';
import { PropertyControls } from "./property-controls.mjs";
import {VfxInspector} from './vfx-inspector.mjs';
import {VfxGizmos} from './vfx-gizmos.mjs';
import {
  canEditNativeProperty,
  beginNativePropertyEdit,
  previewNativePropertyEdit,
  commitNativePropertyEdit,
  cancelNativePropertyEdit,
  getNativePropertyValue,
} from "./native-property-edit.mjs";
import {
  getPivotHandles,
  PIVOT_HANDLE_COLORS,
  pickCanvasHandle,
  invalidatePivotHandleTopology,
} from "./canvas-interactions.mjs";
import {
  cameraViewport,
  pickCameraHandle,
  cameraDragDelta,
  cameraKeyboardDelta,
  cameraHandleCursor,
  drawCameraViewport,
  drawCameraOutline,
} from "./camera-overlay.mjs";
import { EditorSettings, normalizeEditorSettings } from "./settings.mjs";
import { HotkeyManager, isHotkeyInput } from "./hotkeys.mjs";
import { refreshHotkeyHints } from "./hotkey-hints.mjs";
import { runTimelineHotkey } from "./timeline-hotkeys.mjs";
import { AppLocalization } from "./localization-bindings.mjs";
import { layerIdForUid, layerVisible, layerLocked } from "./layers.mjs";
import { DocumentExporter } from "./document-export.mjs";
import { writeNativeBlob as writeNativeBlobRaw, readNativeRecovery } from "./native-files.mjs";
import { objectBounds } from "./renderer-geometry.mjs";
import {
  imageFileToFigure,
  imageFileToBackground,
} from "./media-authoring.mjs";
import { icon, hydrateIcons } from "./icons.mjs";
import { MotionPathCache, motionPathTargets, motionPathTargetKey, pickMotionPathPoint, drawMotionPath } from "./motion-path.mjs";
import { CanvasGuides } from "./canvas-guides.mjs";
import { MotionPathControls } from "./motion-path-controls.mjs";
import { TweenerControls } from "./tweener-controls.mjs";
import { buildGeometry, evaluatedFrame, shortest } from "./pivot/geometry.mjs";
import {
  cameraIsIdentity,
  gradientAngleFromBackground,
  inverseCameraScale,
} from "./pivot/background.mjs";

const $ = (id) => document.getElementById(id),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const editor = new Editor({ demo: false, propertyChannels: true, layerTimeline: true }).newDocument(),
  desktop = window.stykDesktop,
  importer = new ImportClient(),
  documentExporter = new DocumentExporter(),
  clipboardWorker = new ClipboardWorkerClient(),
  preparedScenes = new WeakMap(),
  exportJobs = new Set();
let documentActivation = Promise.resolve();
const audioEngine = new AudioEngine({desktop, onError: error => { pause(); fail(error); }});
let audioPreparation, audioScrubController, audioScrubAt = 0;
editor.setFrameClipboardWorker(clipboardWorker);
function interruptRecovery() {
  let aborted = false;
  for (const job of exportJobs) if (job.recovery) { job.controller.abort(); aborted = true; }
  // Every gesture that kills a running export restarts its serialization from
  // zero; on large documents that work can never finish while the user keeps
  // interacting. Back off so attempts spread out instead of churning forever.
  if (aborted) state.recoveryBackoff = Math.min(12, (state.recoveryBackoff || 1) * 2);
  clearTimeout(state.recoveryTimer);
  if (editor.dirty) scheduleRecovery();
}
async function runDocumentExport(format, consume, { recovery = false } = {}) {
  if (!recovery){finishCurrentEdit();await drawingController?.barrier();}
  const controller = new AbortController(),
    job = { controller, recovery };
  exportJobs.add(job);
  const metric = recovery ? 'recovery' : format === 'styk' ? 'save' : 'export';
  const started = performance.now();
  const context = telemetry.consent.diagnostics ? workload({ format, report: editor.report }) : {};
  let stage = 'serialize';
  telemetry.count(metric + '_started');
  try {
    const drawingRevision=editor.revision;await drawingBarrier(editor.report,{signal:controller.signal});if(drawingRevision!==editor.revision)throw new DOMException('The drawing changed during export.','AbortError');
    const blob = await documentExporter.export(recovery ? editor.movieclipProjectReport() : editor.report, {
      format,
      name: recovery ? editor._movieclipScopes?.[0]?.parent.name ?? editor.name : editor.name,
      sourceId: state.sourceId,
      figureTypeId: editor.object?.figure_type_id,
      figureUid: editor.selectedUid,
      tick: editor.tick,
      signal: controller.signal,
      getRevision: () => `${editor.revision}:${editor.frameDraftRevision}`,
    });
    context.size = sizeBucket(blob.size);
    telemetry.performance.record('serialize',performance.now()-started);
    telemetry.timing(metric + '_ms', performance.now() - started);
    telemetry.operation({ ...context, operation: metric, stage: 'serialize', outcome: 'succeeded' }, performance.now() - started);
    stage = 'write';
    const writeStarted = performance.now();
    const saved = await consume(blob, controller.signal);
    telemetry.operation({ ...context, operation: metric, stage: 'write', outcome: saved ? 'succeeded' : 'cancelled' }, performance.now() - writeStarted);
    telemetry.operation({ ...context, operation: metric, stage: 'complete', outcome: saved ? 'succeeded' : 'cancelled' }, performance.now() - started);
    if (recovery) telemetry.count(saved ? 'recovery_saved' : 'recovery_cancelled');
    else {
      telemetry.count(metric + (saved ? '_succeeded' : '_cancelled'));
      if (saved) { telemetry.milestone(metric === 'save' ? 'first_save' : 'first_export'); if (metric === 'export') telemetry.count(['piv', 'stk'].includes(format) ? 'export_pivot' : 'export_native'); }
    }
    return saved;
  } catch (error) {
    telemetry.count(metric + (error.name === 'AbortError' ? '_cancelled' : '_failed'));
    telemetry.operation({ ...context, operation: metric, stage: 'complete', outcome: error.name === 'AbortError' ? 'cancelled' : 'failed' }, performance.now() - started);
    if (error.name !== 'AbortError') telemetry.error(error, metric, { ...context, stage });
    throw error;
  } finally {
    exportJobs.delete(job);
    state.lastExport = documentExporter.lastTimings;
  }
}
const state = {
  renderer: null,
  view: { x: 0, y: 0, scale: 1 },
  playing: false,
  previewing: false,
  loop: true,
  onion: false,
  handles: true,
  tool: "select",
  rigMode: "move",
  builderBranch: false,
  builderShiftHeld: false,
  locked: new Set(),
  hidden: new Set(),
  sourceId: null,
  documentToken: null,
  dirtyRender: true,
  drag: null,
  space: false,
  importing: false,
  samples: [],
  search: "",
  activeTab: "layers",
  inspectorTab: "design",
  inspectorContext: "figure",
  selectedTrackId: "layer-1",
  settings: normalizeEditorSettings({}),
  lastImport: null,
  renderSamples: [],
  lastPresent: 0,
  drawCalls: 0,
  recoveryTimer: null,
  recoveryBackoff: 1,
  loadedName: null,
  playbackPacket: null,
  playbackRevision: null,
  playbackScale: null,
  playbackSoftware: false,
  playbackHiddenKey: "",
  previewGovernor: { index: 0 },
  loopRange: null,
  buffering: false,
  backgroundPending: null,
  rangeIndices: [],
  applyRange: false,
  scrubbing: false,
  cameraGuides: true,
  vfxEnabled: true,
  motionPaths: false,
  hoverPathPoint: null,
};
// A lost device usually returns once the browser's GPU process settles, so
// accelerated reconnects back off per consecutive loss; a renderer surviving
// the stable window restores the retry budget for the next transient loss.
const GPU_RECOVERY_DELAYS = [1000, 5000], GPU_STABLE_MS = 30000;
let canvas = $("scene"), rendererRecovery, gpuRecoveryTimer, gpuRecoveryAttempts = 0, gpuStableTimer;
const viewport = $("viewport"),
  overlay = $("overlay"),
  ctx = overlay.getContext("2d"),
  images = new PreviewImages({managedInvalidation:true,priorityURLs:playbackImagePriority,onReady: ({retained=false,resized=false}={}) => {
    // New lookahead backgrounds cannot change already-complete GPU frames.
    // Keep their uploads resident; live edits/resized variants still invalidate.
    if(state.playing&&retained&&!resized){requestRender();return;}
    const renderer = state.renderer;
    if (renderer) {
      renderer.generation++; renderer.lastGeometry = null;
      renderer.clearPreparedFrames?.();
      for (const entry of renderer.backgroundImages?.values() || []) entry.texture.destroy();
      renderer.backgroundImages?.clear(); renderer.backgroundKey = '';
      renderer.clearOnionArtwork?.();
      renderer.clearArtwork?.();
    }
    requestRender();
  }, onError: error => status(error.message, true)});
hydrateIcons();
let timelineUI,
  studioShell,
  builderMode,
  propertyControls, cameraMotionControls,
  vfxInspector,
  vfxGizmos,
  editorSettings,
  appLocalization,
  vfwExportControls,
  workspaceLayout,
  assetLibrary,
  toastTimer,
  raf = 0,
  playStart = 0,
  playTick = 0,
  lastUI = 0,
  importSequence = 0,
  canvasPointerId = null,
  inspectorDisclosureOwner = null,
  spritePlacementDialog,
  spriteImportController;
let warmTimer = null,
  playDeadline = 0,
  playStarted = false,
  playStartupFrames = 2,
  uiScheduled = 0;
const playbackMetrics = new PlaybackMetrics();
const playbackCadence = new PlaybackCadence();
let presentationDeadline = null;
async function openExportSink(options){
  const enabled=telemetry.consent.diagnostics,context=enabled?telemetry.performance.context():null,epoch=telemetry.epoch,started=enabled?performance.now():0;
  const onTiming=(metric,ms)=>{if(epoch===telemetry.epoch)telemetry.performance.record(metric,ms,context);};
  const sink=await openExportSinkRaw({...options,...(enabled?{onTiming}:{})});
  if(enabled)onTiming('dialog',performance.now()-started);
  return sink;
}
function writeNativeBlob(bridge,blob,options={}){
  const context=telemetry.consent.diagnostics?telemetry.performance.context():null,epoch=telemetry.epoch;
  return writeNativeBlobRaw(bridge,blob,{...options,...(context?{onTiming:(metric,ms)=>{if(epoch===telemetry.epoch)telemetry.performance.record(metric,ms,context);}}:{})});
}
const exportTelemetry = new WeakMap();
const telemetry = new DesktopTelemetryClient(desktop, { getContext: () => ({
  mode: state.settings.timelineMode, locale: state.settings.locale,
  playing: state.playing,
  pending:playback.stats.pendingFrames,cacheBytes:playback.stats.bytes,cache:playback.stats,
  performance:{
    backend:state.renderer?.stats?.backend==='WebGPU'?'webgpu':state.renderer?.softwarePlayback?'canvas2d':'unavailable',
    complexity:complexityBucket(state.renderer?.stats?.primitives),fps:fpsBucket(editor.report?.fps),
    pixels:canvas.width*canvas.height<1e6?'under-1mp':canvas.width*canvas.height<4e6?'1-4mp':'4mp-plus',
    phase:state.playing?'playing':'editing',quality:images.reduced||state.renderer?.stats?.previewReduced||state.previewGovernor?.index?'reduced':'full',
    features:(state.onion?1:0)|(state.inspectorContext==='camera'?2:0)|(state.vfxEnabled?4:0)|(state.motionPaths?8:0)|(state.renderer?.stats?.textureObjects?16:0),
  },
  backend: state.renderer?.stats?.backend === 'WebGPU' ? 'webgpu' : state.renderer?.stats?.backend === 'Canvas 2D fallback' ? 'canvas2d' : 'unavailable',
  gauges: { gpu_memory_mb: state.renderer?.stats?.gpuBytes / 1048576, draw_calls: state.renderer?.stats?.drawCalls,
    upload_kb: state.renderer?.stats?.uploadBytes / 1024, scene_figures: state.renderer?.stats?.objects,
    scene_primitives: state.renderer?.stats?.primitives, scene_frames: editor.totalTicks },
  gpuFamily: coarseGPUFamily(state.renderer?.stats?.adapter),
}) });
function recordPlaybackPresentation() {
  const now = performance.now();
  playbackMetrics.present(now);
  telemetry.playbackPresent(now, playbackMetrics.targetFps,{deadline:presentationDeadline,refreshMs:playbackCadence.interval});
}
function coarseGPUFamily(value = '') {
  return ['nvidia', 'amd', 'intel', 'apple', 'qualcomm', 'software'].find(name => String(value).toLowerCase().includes(name)) || 'unknown';
}
const feedbackUI = new FeedbackUI(desktop);
importer.diagnostics=telemetry.performance;
const privacyUI = new PrivacyUI(desktop, telemetry, feedbackUI);
const releaseSplash = new ReleaseSplash(desktop);
let updateNotice;
const telemetryInit = telemetry.init().catch(() => null);
globalThis.addEventListener('error', event => telemetry.error(event.error));
globalThis.addEventListener('unhandledrejection', event => telemetry.error(event.reason));
globalThis.addEventListener('pagehide', () => { telemetry.performance.finish();void telemetry.flush(); telemetry.dispose(); });
const editablePreparation = new EditableScenePreparation(editor, {
  diagnostics:telemetry.performance,
  onPending(pending) {
    state.editablePreparing=pending;
    thumbnailRenderer?.setPaused(pending||state.playing||state.scrubbing||editingGestureActive()||document.hidden);
    playback.setInteractionActive(pending||editingGestureActive()||state.scrubbing||document.hidden);
    if(!pending){
      timelineUI?.setPaused?.(state.playing||document.hidden);
      state.editablePreparationStats=editablePreparation.stats;
      if(!state.scrubbing)queueUI();
      requestRender();
    }
  },
  onReady(){state.editingPacket=null;status('Ready');warmPlayback();},
  onError:fail,
});
let lastFpsUI = 0;
function editingGestureActive(){return Boolean(state.drag||keyboardHandleGesture||editor._drag||editor._authoredPoseEdit||propertyControls?.active||vfxInspector?.active||vfxGizmos?.active);}
function queueUI() {
  if(state.editablePreparing)return;
  if (!uiScheduled)
    uiScheduled = requestAnimationFrame(() => {
      uiScheduled = 0;
      updateUI();
    });
}
const playback = new PlaybackCache({
  gpuIsolation: true,
  diagnostics:telemetry.performance,
  onReady: (packet) => {
    state.lastPacketBytes = packet.byteLength;
    state.renderer
      ?.prepareBackgrounds?.(editor.report, packet.frame)
      .catch(() => {});
    if (state.playing && state.buffering) requestRender();
  },
  onError: (error) => {
    if (state.playing) {
      pause();
      fail(error);
    }
  },
});
const playbackUploadWarmup = new PlaybackUploadWarmup(requestRender);
const playbackUploadAhead = new PlaybackUploadAhead();
let playbackImageTicks=[];
function playbackImagePriority() {
  if(!state.playing)return [];
  const urls=[];
  // Plain LRU evicts the next prefetched image before recently displayed past
  // frames. Refresh the bounded lookahead from farthest to nearest instead.
  for(let i=playbackImageTicks.length-1;i>=0;i--){
    const packet=playback.get(playbackImageTicks[i]);
    if(packet)for(const asset of backgroundImageAssets(editor.report,packet.frame))urls.push(assetUrl(asset));
  }
  for(const asset of backgroundImageAssets(editor.report,state.playbackPacket?.frame||editor.frame))urls.push(assetUrl(asset));
  return urls;
}
function playbackScale() {
  // Quantize only after applying the native camera in the worker. Rounding
  // both here and there can quadruple texture memory at an ordinary zoom.
  return (
    state.view.scale *
    (state.renderer?.dpr ||
      Math.max(0.5, Math.min(3, window.devicePixelRatio || 1)))
  );
}
const softwarePlayback = () => Boolean(state.renderer?.softwarePlayback);
// Software packets bake object visibility into the bitmap, so the packet cache
// observes the same inputs effectiveHidden() reads on the UI thread.
function playbackHiddenKey() {
  const layers = editor.report?._styk?.layers?.byId;
  const layerBits = layers ? Object.keys(layers).sort().map((id) => `${id}:${layers[id].visible === false ? 0 : 1}`).join(",") : "";
  return `${[...state.hidden].sort((a, b) => a - b).join(",")}|${layerBits}`;
}
function syncPlayback() {
  const scale = playbackScale(),
    cameraEnabled = !state.scrubbing,
    storedFrames = !editor.report._styk?.layerSheet && state.settings.timelineMode === "simple",
    softwareFrames = softwarePlayback(),
    hiddenUids = softwareFrames ? [...state.hidden] : undefined,
    hiddenKey = softwareFrames ? playbackHiddenKey() : "";
  if (
    state.playbackRevision !== editor.revision ||
    playback.report !== editor.report ||
    state.playbackScale !== scale ||
    state.playbackCameraEnabled !== cameraEnabled ||
    state.playbackStoredFrames !== storedFrames ||
    state.playbackSoftware !== softwareFrames ||
    state.playbackHiddenKey !== hiddenKey ||
    state.playbackDraftRevision !== editor.frameDraftRevision
  ) {
    // A density change changes cached pixels, not the current pose. Keep the
    // uploaded presentation until the replacement view is ready; CPU bitmap
    // invalidation cannot invalidate an independently owned GPU frame.
    const heldPacket = state.playing && state.playbackPacket &&
      state.playbackRevision === editor.revision && playback.report === editor.report &&
      state.playbackStoredFrames === storedFrames && state.playbackSoftware === softwareFrames &&
      state.playbackHiddenKey === hiddenKey && state.playbackDraftRevision === editor.frameDraftRevision &&
      state.playbackCameraEnabled === cameraEnabled && state.renderer?.hasPreparedFrame(state.playbackPacket.key)
      ? state.playbackPacket : null;
    // A camera-only toggle keeps prepared frames: packets carry their own crop
    // mode, so scrubbing does not cold-start the next playback.
    const cameraOnly =
      state.playbackRevision === editor.revision &&
      playback.report === editor.report &&
      state.playbackScale === scale &&
      state.playbackStoredFrames === storedFrames &&
      state.playbackSoftware === softwareFrames &&
      state.playbackHiddenKey === hiddenKey &&
      state.playbackDraftRevision === editor.frameDraftRevision &&
      state.playbackCameraEnabled !== cameraEnabled;
    if (
      state.playbackRevision !== editor.revision ||
      playback.report !== editor.report
    )
      playback.load(editor.report, {
        revision: editor.revision,
        scale,
        cameraEnabled,
        storedFrames,
        softwareFrames,
        hiddenUids,
        hiddenKey,
      });
    else if (state.playbackDraftRevision !== editor.frameDraftRevision)
      playback.updateDocument({
        revision: editor.revision,
        scale,
        cameraEnabled,
        storedFrames,
        softwareFrames,
        hiddenUids,
        hiddenKey,
        frameIndices: [],
      });
    else playback.updateView({ scale, cameraEnabled, storedFrames, softwareFrames, hiddenUids, hiddenKey });
    state.playbackRevision = editor.revision;
    state.playbackScale = scale;
    state.playbackCameraEnabled = cameraEnabled;
    state.playbackStoredFrames = storedFrames;
    state.playbackSoftware = softwareFrames;
    state.playbackHiddenKey = hiddenKey;
    state.playbackDraftRevision = editor.frameDraftRevision;
    state.playbackPacket = heldPacket;
    if (cameraOnly && state.renderer?.retainPreparedFrames)
      state.renderer.retainPreparedFrames(editor.report, playback.cache.values());
    else if (heldPacket && state.renderer?.retainPreparedFrames)
      state.renderer.retainPreparedFrames(editor.report, [heldPacket]);
    else state.renderer?.clearPreparedFrames?.();
  }
}
function playbackRange() {
  if(state.motionPreviewRange)return state.motionPreviewRange;
  return state.loopRange
    ? {
        start: Math.min(state.loopRange.startTick, editor.totalTicks - 1),
        end: Math.min(state.loopRange.endTick, editor.totalTicks),
      }
    : { start: 0, end: editor.totalTicks };
}
function prepareAhead(start = editor.tick, count = 48, {bidirectional = false} = {}) {
  if (state.drag || state.scrubbing || !editor.totalTicks) return;
  syncPlayback();
  // Preparation shares the CPU with the UI thread: shallow lookahead keeps
  // few-core machines responsive while deep buffers still cover fast cores.
  const cores = navigator.hardwareConcurrency || 4;
  count = playbackLookaheadSize(count, cores);
  const range = playbackRange();
  // PlaybackCache owns admission using unique bitmap footprints. Multiplying
  // one frame's size here double-counts shared artwork and starves lookahead
  // precisely when a scene changes from small vector frames to large rasters.
  const ticks=playbackWindow(start,count,range,{loop:state.loop,bidirectional});
  if(state.playing)playbackImageTicks=ticks;
  return playback.prepareRange(ticks, { replacePending: true }).catch((error) => {
    if (error.name !== "AbortError" && state.playing) {
      pause();
      fail(error);
    }
  });
}
let warmGeneration=0;
function warmPlayback({immediate = false} = {}) {
  const generation=++warmGeneration;
  if(state.editablePreparing)return;
  clearTimeout(warmTimer);
  const report=editor.report,revision=editor.revision,tick=editor.tick,draft=editor.frameDraftRevision,scale=state.view.scale;
  const current=()=>generation===warmGeneration&&editor.report===report&&editor.revision===revision&&editor.tick===tick&&editor.frameDraftRevision===draft&&state.view.scale===scale&&!state.playing&&!editingGestureActive()&&!state.scrubbing&&!state.editablePreparing&&!document.hidden;
  warmTimer = setTimeout(async () => {
    if(!current())return;
    // Learn the current frame's real footprint before widening the idle window.
    // User input owns the foreground; obsolete warm-up never chases the playhead.
    await prepareAhead(tick,2);
    if(current())await prepareAhead(tick,48,{bidirectional:true});
  }, immediate||playback.report!==report ? 0 : 150);
}
function previewScrub() {
  // Scrubbing is editing: render the current pose with selection and onions.
  requestRender();
}

let preparationDefinitions, preparationRevision, preparationSizes;
let preparationRequest=0;
function queueEditingFrame(){
  const request=++preparationRequest;
  // Simple mode updates its working-frame checkpoint in a nested change event.
  // Capture the final revision after every listener has finished that seek.
  queueMicrotask(()=>{if(request===preparationRequest)prepareEditingFrame();});
}
function prepareEditingFrame() {
  const renderer=state.renderer;
  if(state.playing||state.previewing||state.drag||propertyControls?.active||!renderer?.prepareSceneUpdate||renderer.activeReport!==editor.report)return;
  if(preparationDefinitions!==editor.report.figure_types||preparationRevision!==editor.definitionRevision){
    preparationDefinitions=editor.report.figure_types;preparationRevision=editor.definitionRevision;
    // A clip's one editable handle can contain thousands of drawing elements.
    // Prepare its nested scene cooperatively even when the outer frame is small.
    preparationSizes=new Map(preparationDefinitions.map(figure=>[figure.figure_type_id,figure._styk?.movieclip ? 2000 : figure.segments.length]));
  }
  const objects=editor.evaluatedFrame.objects;
  const dense=objects.length>=128||objects.reduce((count,object)=>count+(preparationSizes.get(object.figure_type_id)||0),0)>=2000;
  if(!dense)return;
  editablePreparation.start(renderer,geometry=>({
    frame:currentFrame(),view:{...state.view},getView:()=>({...state.view}),cameraEnabled:false,
    editorBackgroundColor:builderBackgroundColor(state.settings,state),onionFrames:onionSkins(),
    geometry,artworkRevision:editor.definitionRevision,
  }));
}

let nameRevision = -1,
  nameReport = null,
  nameMap = new Map();
function nameOf(o) {
  if (o?.name) return o.name;
  if (nameRevision !== editor.revision || nameReport !== editor.report) {
    nameRevision = editor.revision;
    nameReport = editor.report;
    nameMap = new Map(
      editor.report.figure_types.map((f) => [f.figure_type_id, f.name]),
    );
  }
  return nameMap.get(o?.figure_type_id) || `Figure ${o?.unique_id ?? ""}`;
}
const showStaticHandles = () =>
  builderShowsStaticHandles(state.settings, {
    tool: state.tool,
    handleEditHeld: state.handleEditHeld,
    connecting: Boolean(state.spritePlacement || state.duplicatePlacement),
    builderActive: Boolean(builderMode?.active),
  });
const usesBuilderBranch = (event) =>
  Boolean(
    editor.branchSelected ||
    event?.shiftKey ||
      ((isBuilderContext(state.tool) || builderMode?.active) &&
        (state.builderBranch || state.builderShiftHeld)),
  );
function updateBuilderStyle(patch, event) {
  return editor.updateBuilderSegmentStyle(patch, {
    branch: usesBuilderBranch(event),
  });
}
const selection = () =>
  editor.selectedUids ||
  new Set(editor.selectedUid == null ? [] : [editor.selectedUid]);
const isSelected = (uid) => selection().has(uid);
const isHidden = (uid) =>
  state.hidden.has(uid) || !layerVisible(editor.report, uid);
// During a builder session only bound-figure instances are selectable or
// editable; every other object behaves as locked for picking and commands.
const isLocked = (uid) =>
  state.locked.has(uid) || layerLocked(editor.report, uid) ||
  Boolean(builderMode?.boundUids && !builderMode.boundUids.has(uid));
const renderHidden = { has: isHidden };
// A membership view avoids evaluating or scanning a worker-prepared scene.
function effectiveHidden() {
  return renderHidden;
}
function selectTrack(track) {
  if (track.kind === 'assembly') {
    pause(); propertyControls?.cancel();
    state.selectedTrackId = track.id;
    state.inspectorContext = 'figure'; state.inspectorTab = 'animation';
    queueUI(); return;
  }
  const trackUid = track.target?.uid ?? track.uid;
  if (builderMode?.active && trackUid !== undefined && !builderMode.boundUids.has(trackUid)) {
    toast('Finish the figure or return to Animate to select other figures.');
    return;
  }
  const target = track.target || track;
  if (target.kind === "segment") {
    // A scalar row selects one exact curve; branch controls select the rig.
    if (track.property) state.builderBranch = false;
    pause();
    propertyControls?.cancel();
    const object = editor.selectionFrame.objects.find(
      (object) => object.unique_id === target.uid,
    );
    if (
      target.figureTypeId !== undefined &&
      object?.figure_type_id !== target.figureTypeId
    ) {
      editor.select(null);
      state.selectedTrackId = track.id;
      state.inspectorContext = "frame";
      state.inspectorTab = "animation";
      queueUI();
      return;
    }
    editor.select(target.uid);
    const index =
      editor.figure?.segments?.findIndex(
        (segment) => Number(segment.segment_id) === target.handleId,
      ) ?? -1;
    if (index >= 0) editor.select(target.uid, index);
    state.selectedTrackId =
      track.id || `segment:${target.uid}:${target.handleId}`;
    state.inspectorContext = "figure";
    state.inspectorTab = "design";
    queueUI();
    return;
  }
  if (target.kind === "figure" || track.uid !== undefined) {
    pause();
    propertyControls?.cancel();
    editor.select(target.uid ?? track.uid);
    state.selectedTrackId = track.id || `figure:${target.uid ?? track.uid}`;
    queueUI();
    return;
  }
  const id = ["camera", "scene"].includes(target.kind)
    ? target.kind
    : target.id || track.id;
  pause();
  propertyControls?.cancel();
  if(editor.report._styk?.layerSheet&&target.kind==='layer'){if(editor._sheetSelection?.id!==id)editor.selectSheetLayer(id);}
  else if (id !== "camera") editor.select(null);
  if (editor.layers?.some((layer) => layer.id === id))
    editor.setActiveLayer(id);
  state.selectedTrackId = track.id || id;
  state.inspectorContext =
    id === "camera" ? "camera" : id === "scene" ? "scene" : "layer";
  if (id === "camera" && !state.settings.showCamera)
    editorSettings?.commit({ showCamera: true });
  state.inspectorTab = "design";
  queueUI();
}
function reconcileSelectedSegmentTrack(
  track = timelineUI?.trackById?.get(state.selectedTrackId),
) {
  if (state.playing || state.previewing) return;
  const target = track?.target;
  if (target?.kind !== "segment" || target.figureTypeId === undefined) return;
  const object = editor.selectionFrame.objects.find(
    (object) => object.unique_id === target.uid,
  );
  const figure = editor.report.figure_types.find(
    (figure) => figure.figure_type_id === target.figureTypeId,
  );
  const index =
    object?.figure_type_id === target.figureTypeId
      ? (figure?.segments?.findIndex(
          (segment) => Number(segment.segment_id) === target.handleId,
        ) ?? -1)
      : -1;
  if (index >= 0) {
    if (editor.selectedUid !== target.uid || editor.selectedJoint !== index)
      editor.select(target.uid, index);
    state.inspectorContext = "figure";
    state.inspectorTab = "design";
  } else {
    if (editor.selectedUid !== null) editor.select(null);
    state.inspectorContext = "frame";
    state.inspectorTab = "animation";
  }
  state.selectedTrackId = track.id;
}
function propertyChannel(key) {
  const camera = {
    camera_x: "x",
    camera_y: "y",
    camera_scale: "scale",
    camera_angle: "rotation",
  };
  const figure = {
    scale: "scale",
    figure_opacity: "opacity",
    figure_color: "color",
    figure_z_order: "zIndex",
  };
  const segment = {
    segment_opacity: "opacity",
    segment_gradient_opacity: "gradientOpacity",
    segment_color: "color",
    segment_paint: "paint",
    segment_gradient_color: "gradientColor",
    thickness: "thickness",
  };
  const scene = { scene_color: "color", scene_background: "backgroundId" };
  let target, property, options;
  const polygon=/^polygon_(\d+)_(color|opacity)$/.exec(key);
  if (polygon && editor.object && editor.figure?.polyfills?.[Number(polygon[1])]) {
    const index=Number(polygon[1]);target={kind:'polygon',uid:editor.object.unique_id,polygonId:polygonIdentity(editor.figure.polyfills[index],index),figureTypeId:editor.figure.figure_type_id};property=polygon[2];
  } else if (camera[key]) {
    target = { kind: "camera" };
    property = camera[key];
  } else if (scene[key]) {
    target = { kind: "scene" };
    property = scene[key];
  } else if (figure[key] && editor.object && selection().size === 1) {
    target = { kind: "figure", uid: editor.object.unique_id };
    property = figure[key];
  } else if (segment[key] && editor.object && selection().size === 1) {
    const selected = resolveInstanceFigure(editor.figure,editor.object)?.segments?.[editor.selectedJoint];
    if (
      !selected ||
      (key === "segment_gradient_opacity" && !selected.secondary)
    )
      return null;
    property = segment[key];
    const track = timelineUI?.trackById?.get(state.selectedTrackId);
    const persisted = track?.target;
    if (
      track?.property === property &&
      persisted?.kind === "segment" &&
      persisted.uid === editor.object.unique_id &&
      persisted.handleId === Number(selected.segment_id) &&
      (persisted.figureTypeId === undefined ||
        persisted.figureTypeId === editor.object.figure_type_id)
    ) {
      target = persisted;
      options = { exactTarget: true };
    } else
      target = editor.segmentAnimationTarget(
        editor.object.unique_id,
        Number(selected.segment_id),
        property,
      );
  } else return null;
  const factor =
    property === "rotation"
      ? 180 / Math.PI
      : ["scale", "opacity", "gradientOpacity"].includes(
            property,
          )
        ? 100
        : 1;
  return {
    target,
    property,
    options,
    fromUI: (value) =>
      property === "color" && typeof value === "string"
        ? (0xff000000 | parseInt(value.slice(1), 16)) >>> 0
        : value / factor,
    toUI: (value) =>
      value === null
        ? undefined
        : property === "color"
          ? "#" + (value & 0xffffff).toString(16).padStart(6, "0")
          : value * factor,
  };
}
function propertyState(key) {
  const binding = propertyChannel(key);
  if (!binding || !editor.animationChannel) return {};
  const value = editor.animationValue(
    binding.target,
    binding.property,
    editor.tick,
    binding.options,
  );
  return {value: value === undefined ? undefined : binding.toUI(value)};
}
function selectionBounds() {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const g of editor.geometry.objects.values()) {
    if (!g || !isSelected(g.obj.unique_id)) continue;
    const b = boundsOf(g);
    bounds.minX = Math.min(bounds.minX, b.minX);
    bounds.minY = Math.min(bounds.minY, b.minY);
    bounds.maxX = Math.max(bounds.maxX, b.maxX);
    bounds.maxY = Math.max(bounds.maxY, b.maxY);
  }
  return bounds;
}
function alignSelection(axis, edge) {
  if (rangeFrames())
    return editor.alignFiguresInFrames(axis, edge, rangeFrames(), { boundsOf });
  return editor.alignSelection(axis, edge, { boundsOf });
}
function orderSelection(direction) {
  pause();
  finishCurrentEdit();
  return editor.orderSelection(direction, {frameIndices: rangeFrames()});
}
function rangeFrames() {
  if(editor.report._styk?.layerSheet){if(!state.applyRange||timelineUI?.selectedTicks?.length<2)return undefined;const indices=[editor.frameIndex];indices.sheetTicks=[...new Set([...timelineUI.selectedTicks,editor.tick])];return indices;}
  if (editor.frameDraft?.mode === "add") return undefined;
  return state.applyRange && state.rangeIndices.length > 1
    ? [...new Set([...state.rangeIndices, editor.frameIndex])]
    : undefined;
}
function updateSelection(patch) {
  if (rangeFrames()) return editor.updateFiguresInFrames(patch, rangeFrames());
  if (selection().size < 2) return editor.updateObject(patch);
  return editor.updateFiguresInFrames(patch, [editor.frameIndex], {
    ticks: [editor.tick],
  });
}
function moveSelected(dx, dy) {
  if (rangeFrames())
    return editor.moveSelectionInFrames(dx, dy, rangeFrames());
  return editor.moveSelection(dx, dy);
}
const assetUrl = (a) =>
  a?.asset_url ||
  a?.data_url ||
  a?.url ||
  (a?.base64
    ? `data:${a.mime_type || "image/png"};base64,${a.base64}`
    : null) ||
  a?.asset_path_relative ||
  a?.asset_path ||
  a?.path;
function imageFor(url) {
  return images.image(url);
}
let drawingController;
const resources = { url: assetUrl, image: imageFor, drawing:figure=>drawingController?.resource(figure), drawingLoad:figure=>drawingMetadata(figure)?editor?.drawingResources.surface(figure):null };
function status(text, error = false, busy = false) {
  $("status").textContent = text;
  $("status-dot").className =
    `status-dot${error ? " error" : busy ? " busy" : ""}`;
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4400);
}
function fail(error) {
  telemetry.error(error);
  const message = error?.message || String(error);
  status(message, true);
  toast(message);
  console.error(error);
}
function guarded(fn) {
  return (...args) => {
    try {
      const value = fn(...args);
      if (value?.catch) value.catch(fail);
      return value;
    } catch (error) {
      fail(error);
    }
  };
}
let pendingColorSample;
function sampleCanvasColor(clientX,clientY,signal,radius=0) {
  if(signal.aborted)return Promise.reject(new Error('Color sampling cancelled.'));
  pendingColorSample?.finish(new Error('Color sampling superseded.'));
  return new Promise((resolve,reject)=>{
    const finish=(error,color)=>{
      clearTimeout(timeout);signal.removeEventListener('abort',cancel);
      if(pendingColorSample?.finish===finish)pendingColorSample=null;
      if(error)reject(error);else resolve(color);
    };
    const cancel=()=>finish(new Error('Color sampling cancelled.'));
    const timeout=setTimeout(()=>finish(new Error('Canvas is not ready. Try again.')),2000);
    signal.addEventListener('abort',cancel,{once:true});
    pendingColorSample={clientX,clientY,finish,radius};
    requestRender();
  });
}
function requestRender() {
  state.dirtyRender = true;
  if (!raf) raf = requestAnimationFrame(loop);
}
function currentFrame() {
  // Playback already evaluated this exact tick in the worker. Overlays need
  // its camera/scene metadata, not another evaluation of all figures on input.
  const packet = state.playing && state.playbackPacket;
  const motionPath = editor._drag?.motionPath;
  const frame = motionPath?.display?.frame ?? (packet?.tick === editor.tick ? packet.frame : editor.evaluatedFrame || editor.frame);
  return editor.report._styk?.layers?.fixed?.camera?.visible === false
    ? { ...frame, camera: null }
    : frame;
}
function previewPacket() {
  if (!state.previewing || state.scrubbing) return null;
  const packet = playback.has(editor.tick) ? playback.get(editor.tick) : null;
  return packet && packet.cameraEnabled !== false ? packet : null;
}
function screenPoint(p) {
  return worldToScreen(p,{report:editor.report,frame:currentFrame(),view:state.view,cameraEnabled:state.playing||state.previewing});
}
function worldPoint(event) {
  const r = viewport.getBoundingClientRect();
  return screenToWorld({x:(event.clientX-r.left)*viewport.clientWidth/r.width,y:(event.clientY-r.top)*viewport.clientHeight/r.height},{report:editor.report,frame:currentFrame(),view:state.view,cameraEnabled:state.playing||state.previewing});
}
function cameraSelected() {
  return state.inspectorContext === 'camera' && state.selectedTrackId === 'camera';
}
const pathCache = new MotionPathCache();
const PATH_COLORS = ['#0d99ff', '#e8590c', '#12b886', '#7048e8', '#e64980', '#f08c00', '#0ca678', '#1098ad'];
/** Every active trail: the camera, each selected figure, or every figure when
 * "all targets" is on. The primary selection keeps the first (accent) colour. */
function activeMotionPaths({sample = true} = {}) {
  if (!state.motionPaths || state.playing || state.previewing || state.editablePreparing || builderMode?.active) return [];
  if (!["select", "pose"].includes(state.tool)) return [];
  const camera = cameraSelected() && state.settings.showCamera;
  const range = Math.round(state.settings.motionPathRange) || 0;
  const session = editor._drag?.motionPath ? editor._drag : null;
  const deadline = performance.now() + pathCache.budgetMs;
  const out = [];
  const targets = camera ? [] : motionPathTargets(editor, {all: Boolean(state.settings.motionPathAllTargets)})
    .filter(target => !isHidden(target.uid) && !isLocked(target.uid));
  const maxPoints = Math.min(1600, Math.floor(6400 / Math.max(1, targets.length)));
  let pending = false;
  const collect = (target, color) => {
    const entry = sample ? pathCache.get(editor, target, {session, range, deadline, maxPoints}) : pathCache.peek(editor, target);
    if (!entry) return;
    pending ||= !entry.complete;
    out.push({target, entry, color});
  };
  if (camera) {
    const track = editor.report._styk?.layers?.fixed?.camera;
    if (track?.visible !== false && !track?.locked) collect({kind: 'camera'}, '#e8a13c');
  } else {
    for (const target of targets) {
      collect(target, PATH_COLORS[out.length % PATH_COLORS.length]);
    }
  }
  // Trail sampling continues across frames until every entry is complete.
  if (sample && pending) requestRender();
  return out;
}
function activeCameraHandle(point) {
  const track = editor.report._styk?.layers?.fixed?.camera;
  if (!cameraSelected() || !state.settings.showCamera || track?.visible === false || track?.locked)
    return null;
  return pickCameraHandle(
    cameraViewport(editor.report, currentFrame(), state.view),
    point,
    state.view,
  );
}
function placeArtboard() {
  const v = state.view,
    r = editor.report,
    a = $("artboard");
  Object.assign(a.style, {
    left: `${v.x}px`,
    top: `${v.y}px`,
    width: `${r.canvas_width * v.scale}px`,
    height: `${r.canvas_height * v.scale}px`,
  });
  $("zoom-label").textContent = `${Number((v.scale * 100).toFixed(v.scale < 0.01 ? 2 : v.scale < 0.1 ? 1 : 0))}% ⌄`;
}
function fittedView(r = editor.report) {
  const rect = viewport.getBoundingClientRect(),
    s = Math.max(
      0.01,
      Math.min(
        (rect.width - 64) / r.canvas_width,
        (rect.height - 72) / r.canvas_height,
        2,
      ),
    );
  return {
    scale: s,
    x: (rect.width - r.canvas_width * s) / 2,
    y: (rect.height - r.canvas_height * s) / 2 - 3,
  };
}
function fit() {
  state.view = fittedView();
  placeArtboard();
  requestRender();
}
// Sustained playback deficits lower the preview backing resolution and MSAA;
// recovered headroom restores full quality. The overlay stays at native DPR so
// handles and tool feedback remain crisp.
function previewRenderScale() {
  return previewQualityLevels[state.previewGovernor?.index ?? 0];
}
let pendingPreviewQuality = null;
function applyPreviewQuality(index) {
  pendingPreviewQuality = index;
  requestRender();
}
function commitPreviewQuality() {
  if (pendingPreviewQuality === null) return;
  const index = pendingPreviewQuality;
  pendingPreviewQuality = null;
  resize();
  const pending = state.renderer?.setMsaa?.(previewMsaaLevels[index]);
  pending?.catch(error => {
    telemetry.error(error, 'gpu');
    status('The previous antialiasing setting was retained after a graphics error.', true);
    requestRender();
  });
}
function resetPreviewQuality() {
  const governor = state.previewGovernor;
  state.previewGovernor = { index: 0 };
  if (governor?.index) applyPreviewQuality(0);
}
function selectPlaybackQuality() {
  const index = playbackQualityIndex(state.settings.playbackQuality);
  const previous = state.previewGovernor?.index ?? 0;
  state.previewGovernor = {index};
  if (index !== previous) applyPreviewQuality(index);
}
function adaptPreviewQuality(sample, now) {
  if (state.settings.playbackQuality !== 'auto') return;
  const governor = (state.previewGovernor ??= { index: 0 });
  if (updatePreviewQuality(governor, sample, now, state.buffering)) applyPreviewQuality(governor.index);
}
function resize() {
  const r = viewport.getBoundingClientRect(),
    d = window.devicePixelRatio || 1;
  overlay.width = Math.round(r.width * d);
  overlay.height = Math.round(r.height * d);
  state.renderer?.resize(r.width, r.height, d * previewRenderScale());
  timelineUI?.resize();
  placeArtboard();
  requestRender();
}
function zoom(factor, point) {
  const r = viewport.getBoundingClientRect(),
    px = point?.x ?? r.width / 2,
    py = point?.y ?? r.height / 2,
    v = state.view,
    s = Math.min(100, Math.max(0.001, v.scale * factor)),
    k = s / v.scale;
  state.view = { x: px - (px - v.x) * k, y: py - (py - v.y) * k, scale: s };
  placeArtboard();
  requestRender();
}
function fitSelection() {
  const b = selectionBounds();
  if (!Number.isFinite(b.minX)) return fit();
  const points = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map(screenPoint);
  const left = Math.min(...points.map((p) => p.x)),
    right = Math.max(...points.map((p) => p.x)),
    top = Math.min(...points.map((p) => p.y)),
    bottom = Math.max(...points.map((p) => p.y)),
    rect = viewport.getBoundingClientRect();
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  zoom(
    Math.min(
      (rect.width - 120) / Math.max(1, right - left),
      (rect.height - 150) / Math.max(1, bottom - top),
    ),
    center,
  );
  state.view.x += rect.width / 2 - center.x;
  state.view.y += rect.height / 2 - 15 - center.y;
  placeArtboard();
  requestRender();
}
const boundsCache = new WeakMap();
function boundsOf(g) {
  let b = boundsCache.get(g);
  if (!b) {
    const items = [
        ...g.segments.map((s) => ({
          ...s,
          type: s.seg.segment_type || "line",
        })),
        ...g.polys,
      ],
      r = objectBounds(items, resources);
    b = { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height };
    boundsCache.set(g, b);
  }
  return b;
}
let blueHandles = null;
// Keep one surface alive to avoid deferred GPU-context destruction on input.
const handleSurface = new OffscreenCanvas(1, 1),
  handleContext = handleSurface.getContext("2d");
let handleCache = null;
const handleDescriptors = {};
const selectionHandleCache = new WeakMap();
const selectionHandleDescriptors = {};
function canvasHandles(geometry, {selectStatic = false} = {}) {
  const frame = currentFrame(),
    settings = state.settings;
  const key = [
    builderMode?.active ? [...editor.selectedSegmentIds].join(',') : '',
    editor.layerRevision,
    showStaticHandles(),
    state.tool,
    state.figureJoin?.uid,
    state.handleEditHeld,
    usesBuilderBranch(),
    editor.selectedJoint,
    settings.showUnselectedHandles,
    settings.handleSize,
    settings.autoSizeHandles,
    settings.outlineHandles,
    state.view.scale,
    frame.camera?.scale,
    builderMode?.session?.typeId ?? "none",
    ...selection(),
    ...state.hidden,
    ...state.locked,
  ].join("|");
  const cached = selectStatic ? selectionHandleCache.get(geometry) : handleCache;
  if (cached?.key === key && (selectStatic || cached.geometry === geometry)) return cached.handles;
  const bound = builderMode?.boundUids;
  const hidden = effectiveHidden(frame),
    locked = new Set(state.locked);
  for (const object of frame.objects)
    if (layerLocked(editor.report, object.unique_id) || (bound && !bound.has(object.unique_id)))
      locked.add(object.unique_id);
  const handles = getPivotHandles(geometry, {
    descriptorCache: selectStatic ? selectionHandleDescriptors : handleDescriptors,
    selectStatic,
    joinTargetUids: state.figureJoin?.targets,
    frame,
    selectedUid: editor.selectedUid,
    selectedUids: selection(),
    hiddenUids: hidden,
    lockedUids: locked,
    showUnselected: settings.showUnselectedHandles,
    showStatic: showStaticHandles(),
    selectedJoint: editor.selectedJoint,
    selectedHandleIds: builderMode?.active ? editor.selectedSegmentIds : undefined,
    selectedBranch: usesBuilderBranch(),
    builder: isBuilderContext(state.tool),
    attaching: state.tool === "attach",
    allowStaticManipulation:
      state.tool === "rig" ||
      state.handleEditHeld,
    viewScale: state.view.scale,
    autoSize: settings.autoSizeHandles,
    maxDiameter: settings.handleSize * 2,
  });
  if (selectStatic) selectionHandleCache.set(geometry, {key, handles});
  else handleCache = { geometry, key, handles };
  return handles;
}
function paintHandle(context, handle, delta) {
  const point = delta
    ? { x: handle.point.x + delta.x, y: handle.point.y + delta.y }
    : handle.point;
  const p = screenPoint(point);
  context.beginPath();
  if(handle.connector){const r=handle.screenRadius;context.moveTo(p.x,p.y-r);context.lineTo(p.x+r,p.y);context.lineTo(p.x,p.y+r);context.lineTo(p.x-r,p.y);context.closePath();}
  else context.arc(p.x, p.y, handle.screenRadius, 0, Math.PI * 2);
  context.fillStyle = handle.color;
  context.strokeStyle = handle.ik ? '#0d99ff' : '#000000';
  context.lineWidth = 1;
  context.fill();
  if (state.settings.outlineHandles || handle.ik) context.stroke();
}
function gpuHandlesEnabled() {
  return Boolean(state.renderer?.handleRenderer) && !state.playing && !state.previewing &&
    !(!editor.branchSelected && (isBuilderContext(state.tool) || builderMode?.active) && state.settings.builderHighlightSegment);
}
function drawCanvasHandles(geometry) {
  const handles = canvasHandles(geometry),
    translations = state.drag?.translations;
  const d = window.devicePixelRatio || 1;
  const key = [
    handleCache.key,
    state.view.x,
    state.view.y,
    currentFrame().camera?.x,
    currentFrame().camera?.y,
    currentFrame().camera?.angle_rad,
    ...(translations?.keys() || []),
  ].join("|");
  if (
    !blueHandles ||
    blueHandles.handles !== handles ||
    blueHandles.key !== key ||
    handleSurface.width !== overlay.width ||
    handleSurface.height !== overlay.height
  ) {
    if (handleSurface.width !== overlay.width)
      handleSurface.width = overlay.width;
    if (handleSurface.height !== overlay.height)
      handleSurface.height = overlay.height;
    handleContext.setTransform(d, 0, 0, d, 0, 0);
    handleContext.clearRect(0, 0, overlay.width / d, overlay.height / d);
    for (const handle of handles)
      if (!translations?.has(handle.uid)) paintHandle(handleContext, handle);
    blueHandles = { handles, key };
  }
  ctx.drawImage(handleSurface, 0, 0, overlay.width / d, overlay.height / d);
  if (translations)
    for (const handle of handles) {
      const delta = translations.get(handle.uid);
      if (delta) paintHandle(ctx, handle, delta);
    }
}
const onionCache = new OnionSkinCache();
let onionControls;
const onionController = new OnionController({editor,
  getSettings: () => state.settings, getEnabled: () => state.onion,
  onCommit: patch => editorSettings.commit(patch),
  onToggle: () => actions["toggle-onion"](), onRender: () => requestRender(), onError: fail});
let pathControls;
let tweenerControls;
let canvasGuides;
function onionSkins() {
  if (!state.onion || state.playing || state.previewing) return [];
  return onionCache.get(editor, onionController.settings, {selected: selection(), hidden: effectiveHidden(), visibilityKey:[...state.hidden]});
}
function overlayRender(geometry) {
  const d = window.devicePixelRatio || 1;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, overlay.width / d, overlay.height / d);
  if (state.playing || state.previewing) return;
  if (
    !editor.branchSelected && (isBuilderContext(state.tool) || builderMode?.active) && state.settings.builderHighlightSegment &&
    !isHidden(editor.selectedUid)
  )
    drawBuilderHighlight(ctx, geometry, {
      uid: editor.selectedUid,
      jointIndex: editor.selectedJoint,
      report: editor.report,
      frame: currentFrame(),
      view: state.view,
      resources,
      dragTranslations: state.drag?.translations,
      cameraEnabled: false,
    });
  const motionPaths = activeMotionPaths();
  const dragPath = state.drag?.kind === "motion-path" ? state.drag : null;
  for (const motionPath of motionPaths) {
    const key = motionPathTargetKey(motionPath.target);
    drawMotionPath(ctx, motionPath.entry, screenPoint, {
      tick: editor.tick,
      hover: state.hoverPathPoint?.key === key ? state.hoverPathPoint : null,
      dragging: dragPath?.key === key ? {tick: dragPath.tick} : null,
      color: motionPath.color,
      labels: Boolean(state.settings.motionPathLabels),
      dots: state.settings.motionPathDots !== false,
      faint: motionPaths.length > 1 && state.hoverPathPoint && state.hoverPathPoint.key !== key,
    });
  }
  if ((state.handles || state.tool === 'attach') && !gpuHandlesEnabled()) drawCanvasHandles(geometry);
  if (
    cameraSelected() &&
    editor.report._styk?.layers?.fixed?.camera?.visible !== false &&
    (state.settings.showCamera || !cameraIsIdentity(currentFrame().camera))
  ) {
    if (state.onion && state.settings.onionCamera && editor.frameIndex > 0)
      drawCameraViewport(
        ctx,
        cameraViewport(
          editor.report,
          evaluatedFrame(editor.report, editor.frameIndex - 1),
          state.view,
        ),
        screenPoint,
        { active: false, onion: true },
      );
    drawCameraViewport(
      ctx,
      cameraViewport(editor.report, currentFrame(), state.view),
      screenPoint,
      {
        outline: false,
        active:
          state.settings.showCamera &&
          editor.report._styk?.layers?.fixed?.camera?.locked !== true,
        guides: state.cameraGuides,
        hover: state.hoverCameraHandle,
        dragging: state.drag?.kind === 'camera' ? state.drag.handle : null,
      },
    );
  }
  if (state.drag?.kind === "marquee") {
    const a = screenPoint(state.drag.start),
      b = screenPoint(state.drag.current);
    ctx.fillStyle = "#0d99ff14";
    ctx.strokeStyle = "#0d99ff";
    ctx.lineWidth = 1;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }
  if (state.polygon) {
    const g = [...geometry.objects.values()].find(
      (g) => g?.obj.unique_id === state.polygon.uid,
    );
    const markers = state.polygon.handles
      .map((id) => g?.joints.get(id))
      .filter(Boolean)
      .map(screenPoint);
    const pts = polygonPreviewPoints(g, state.polygon.handles, {
      closed: state.polygon.handles.length >= 3,
    }).map(screenPoint);
    if (pts.length) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (state.polygon.handles.length >= 3) ctx.closePath();
      ctx.strokeStyle = "#0d99ff";
      ctx.fillStyle = "#0d99ff18";
      ctx.lineWidth = 2;
      if (state.polygon.handles.length >= 3) ctx.fill();
      ctx.stroke();
      for (let index = 0; index < markers.length; index++) {
        const p = markers[index];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = PIVOT_HANDLE_COLORS.segment;
        ctx.fill();
        if (index === 0) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.3, 0, Math.PI * 2);
          ctx.fillStyle = "#000000";
          ctx.fill();
        }
      }
    }
  }
  if ((state.spritePlacement || state.duplicatePlacement)?.point) {
    const pending = state.spritePlacement || state.duplicatePlacement,
      target = pending.hover,
      point = screenPoint(target?.point || pending.point);
    drawDuplicatePreview(ctx,pending.preview,point,state.view.scale);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = target ? "#0d99ff" : "#888";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  construction?.draw(ctx);
  if (state.handles) drawConnectorGuides(ctx,geometry,editor,screenPoint);
  if (state.handles && builderMode?.active) drawRigGuides(ctx,geometry,editor,screenPoint);
  if(builderMode?.active) {
    const g=editor.geometry.objects.get(editor.selectedSlot);
    if(editor.selectedPolygonIndex>=0)drawFillHighlight(ctx,g?.polys.find(p=>p.index===editor.selectedPolygonIndex)?.points,screenPoint);
    if(state.tool==='polygon'&&state.builderShiftHeld)drawFillHighlight(ctx,state.bucketPreview?.points,screenPoint,{preview:true});
  }
  if (state.drag?.kind === "draw") {
    const p = screenPoint(state.drag.start),
      q = screenPoint(state.drag.current || state.drag.start);
    ctx.save();
    setBuilderStroke(ctx, state.drag.appearance, state.view.scale);
    ctx.beginPath();
    if (state.tool === "circle") {
      ctx.arc(
        (p.x + q.x) / 2,
        (p.y + q.y) / 2,
        Math.hypot(q.x - p.x, q.y - p.y) / 2,
        0,
        Math.PI * 2,
      );
    } else {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
function loop(now) {
  canvasGuides?.render();
  raf = 0;
  // Resizing clears the backing surface. Commit at the start of a paint task,
  // before drawing, never after publishing that task's completed frame.
  commitPreviewQuality();
  if (state.playing) syncPlayback();
  playback.setInteractionActive(Boolean(editingGestureActive()||state.scrubbing||state.editablePreparing||document.hidden));
  thumbnailRenderer?.setPaused(Boolean(editingGestureActive()||state.playing||state.scrubbing||state.editablePreparing||document.hidden));
  let advancedPlayback = false;
  if (!$("renderer-error").hidden) return;
  if (state.playing) {
    const fps = editor.report.frame_delay_ms
        ? 1000 / editor.report.frame_delay_ms
        : editor.report.fps,
      range = playbackRange(),
      interval = 1000 / fps;
    if(telemetry.consent.diagnostics&&telemetry.isForeground)playbackCadence.observe(now);else playbackCadence.reset();
    playbackMetrics.targetFps = fps;
    if (range.end <= range.start) {
      pause();
    } else if (state.audioReady !== false && !audioEngine.starting && (!playStarted || now >= playDeadline) &&
      (!audioEngine.running || audioEngine.position + .00001 >= (editor.tick + 1) / fps)) {
      let next = playStarted ? editor.tick + 1 : playTick;
      if (next >= range.end) {
        if (state.loop) next = range.start;
        else {
          pause();
          next = null;
        }
      }
      if (next !== null) {
        const packet = playback.get(next);
        const backgroundsReady =
          packet &&
          (state.renderer.backgroundsReady?.(editor.report, packet.frame) ??
            true);
        if (!playStarted) playStartupFrames = Math.max(playStartupFrames, playbackStartupWindow(fps,
          Math.max(playback.stats.lastCompileMs, playback.stats.compileMs / Math.max(1, playback.stats.preparedFrames)), navigator.hardwareConcurrency || 4));
        let startupReady=playStarted || playback.bufferedAhead(next,playStartupFrames,range.end);
        if(!playStarted&&startupReady&&backgroundsReady){
          const packets=[];
          for(let tick=next;tick<Math.min(range.end,next+playStartupFrames);tick++){
            const ready=playback.get(tick);if(!ready)break;packets.push(ready);
          }
          startupReady=playbackUploadWarmup.step(state.renderer,packets,{report:editor.report,view:state.view,cameraEnabled:state.playbackCameraEnabled});
        }
        if (packet && backgroundsReady && startupReady) {
          if (audioEngine.hasAudio && (!audioEngine.running || next < editor.tick || audioEngine.position > (next + 1.5) / fps))
            void audioEngine.start(next / fps, range.end / fps);
          editor.seek(next, { evaluate: false });
          state.playbackPacket = packet;
          advancedPlayback = true;
          presentationDeadline = playStarted ? playDeadline : null;
          playDeadline =
            !playStarted || state.buffering
              ? now + interval
              : Math.max(playDeadline + interval, now);
          playStarted = true;
          if (state.buffering) {
            state.buffering = false;
            status("Playing");
            $("preview-badge").textContent = "PLAYING";
          }
          prepareAhead(next + 1, 48);
          state.dirtyRender = true;
        } else {
          audioEngine.stop();
          state.buffering = true;
          $("preview-badge").textContent = "PREPARING";
          if (
            packet &&
            !backgroundsReady &&
            state.backgroundPending !== packet.key
          ) {
            state.backgroundPending = packet.key;
            state.renderer
              .prepareBackgrounds(editor.report, packet.frame)
              .then(() => {
                state.backgroundPending = null;
                requestRender();
              })
              .catch((error) => {
                state.backgroundPending = null;
                pause();
                fail(error);
              });
          }
          prepareAhead(next, 48);
        }
      }
    }
  }
  if (state.dirtyRender && state.renderer) {
    state.dirtyRender = false;
    const start = performance.now();
    const sampled=telemetry.isForeground&&telemetry.performance.sampleFrame(),stages=sampled?{}:null;
    state.renderer.measureFrame=sampled;state.renderer.telemetryStages=null;
    let stageStarted=sampled?performance.now():0;
    const packet = state.playing ? state.playbackPacket : previewPacket();
    let preparedPresented = false;
    if(state.editablePreparing){
      const held=state.editingPacket?.packet;
      if(held)state.renderer.renderPrepared(held.key,{report:editor.report,view:state.view,cameraEnabled:held.cameraEnabled,hiddenUids:effectiveHidden(),hiddenKey:state.playbackHiddenKey});
      preparedPresented = true;
    } else if (packet && state.renderer.renderPrepared && (packet.cameraEnabled ?? true) === !state.scrubbing) {
      if (!state.renderer.hasPreparedFrame(packet.key))
        state.renderer.prepareFrame(packet, {
          report: editor.report,
          view: state.view,
          cameraEnabled: !state.scrubbing,
        });
      // Software surfaces reject stale visibility or drag states; those ticks
      // continue into the live render below instead of showing a frozen frame.
      preparedPresented = state.renderer.renderPrepared(packet.key, {
        report: editor.report,
        view: state.view,
        cameraEnabled: !state.scrubbing,
        hiddenUids: effectiveHidden(),
        hiddenKey: state.playbackHiddenKey,
      }) === true;
      if (advancedPlayback && preparedPresented)
        recordPlaybackPresentation();
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
    if (!preparedPresented && !state.editablePreparing && (!state.playing || !state.buffering)) {
      const drawingPreview=drawingController?.renderPreview;
      const frame = drawingPreview?.frame??currentFrame(),
        geometry =
          drawingPreview?.geometry ||
          editor._drag?.motionPath?.display?.geometry ||
          state.drag?.geometry ||
          keyboardHandleGesture?.geometry ||
          editor.geometry;
      const onionFrames = onionSkins(),
        editing = state.editingPacket;
      if (geometry) void images.prepare([
        ...frameImageDrawables(geometry),
        ...onionFrames.flatMap(entry => frameImageDrawables(entry.geometry)),
        ...backgroundImageAssets(editor.report, frame).map(asset => ({type: 'image', asset})),
      ], {scale: Math.max(1 / 64, 2 ** Math.ceil(Math.log2(playbackScale() || 1))), maxDimension: 4096}).catch(() => {});
      state.editingPacket = null;
      state.renderer.render({
        vfxEnabled: state.vfxEnabled,
        preparedPacket:
          editing?.report === editor.report &&
          editing.revision === editor.revision &&
          editing.tick === editor.tick
            ? editing.packet
            : undefined,
        report: drawingPreview?.report??editor.report,
        frame,
        geometry,
        view: state.view,
        cameraEnabled: state.playing || state.previewing,
        editorBackgroundColor: builderBackgroundColor(state.settings, state),
        selectedUid: null,
        showHandles: false,
        liveEditing: Boolean(state.drag || keyboardHandleGesture),
        playing: state.playing,
        artworkRevision: editor.definitionRevision,
        canvasHandles: !pendingColorSample && (state.handles || state.tool === 'attach') && gpuHandlesEnabled() ? canvasHandles(geometry) : undefined,
        outlineHandles: state.settings.outlineHandles,
        onionFrames,
        hiddenUids: effectiveHidden(),
        clipToCanvas: false,
        dragTranslations: state.drag?.translations,
      });
      state.lastEditingPresentation = {tick:editor.tick,revision:editor.revision,at:performance.now(),
        sequence:(state.lastEditingPresentation?.sequence ?? 0)+1};
      if (advancedPlayback) recordPlaybackPresentation();
      overlayRender(geometry);
      drawingController?.overlayDraw(ctx);
      $('preview-quality').hidden = !(images.reduced || state.renderer.stats?.previewReduced || state.previewGovernor?.index);
    }
    if(pendingColorSample && !state.editablePreparing && (!state.playing || !state.buffering || preparedPresented)){
      const sample=pendingColorSample;
      try{
        const result=sampleCanvasRegion(canvas,sample.clientX,sample.clientY,sample.radius);
        sample.finish(null,sample.radius?result:result.color);
      }catch(error){sample.finish(error);}
      requestRender(); // Restore GPU handles after sampling the artwork before presentation.
    }
    if(sampled){stages.scene=performance.now()-stageStarted;stageStarted=performance.now();Object.assign(stages,state.renderer.telemetryStages);}
    // Final editor overlay pass: keep the actual camera above artwork and tool feedback.
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    drawCameraOutline(ctx, cameraViewport(editor.report, currentFrame(), state.view), screenPoint);
    vfxGizmos?.draw(ctx);
    if(sampled){stages.overlay=performance.now()-stageStarted;stageStarted=performance.now();}
    if (state.inspectorContext === 'camera') {
      const frame = currentFrame();
      syncCameraControls($('inspector'), frame, {activeKey:propertyControls?.activeKey,guides:state.cameraGuides});
      if (!state.editablePreparing) drawCameraMonitor($('inspector').querySelector('[data-camera-monitor]'), {
        onError:error=>telemetry.error(error,'renderer'),onInvalidate:requestRender,onRecovery:(kind,outcome)=>telemetry.performance.recovery(kind,outcome),
        report:editor.report,frame,geometry:state.playing?null:state.drag?.geometry || keyboardHandleGesture?.geometry || editor.geometry,
        resources:state.renderer.resources,hiddenUids:effectiveHidden(),
        prepared:packet?.key!==undefined&&state.renderer?.renderPreparedInto?{renderer:state.renderer,key:packet.key}:null,
      });
    }
    const elapsed = performance.now() - start;
    if(sampled)stages.camera=performance.now()-stageStarted;
    if(telemetry.isForeground&&!state.editablePreparing)telemetry.performance.frame(elapsed,stages||{},sampled);
    state.renderSamples.push(elapsed);
    if (telemetry.consent.diagnostics && state.drawCalls % 30 === 0) {
      telemetry.timing('frame_ms', elapsed);
      if (elapsed > 33) telemetry.count('slow_frames');
    }
    if (state.renderSamples.length > 300) state.renderSamples.shift();
    state.lastPresent = elapsed;
    state.drawCalls++;
    if (now - lastUI > 200) {
      updateTransport();
      $("render-time").textContent = `${elapsed.toFixed(1)} ms`;
      $("renderer-label").textContent =
        state.renderer.stats?.backend === "Canvas 2D fallback"
          ? "Compatibility mode"
          : state.renderer.stats?.backend || "WebGPU";
      lastUI = now;
    }
  }
  if (state.playing) {
    const measuredAt = performance.now();
    if(playStarted&&!state.buffering&&state.playbackPacket){
      const packets=[state.playbackPacket],range=playbackRange();
      for(const tick of playbackWindow(editor.tick+1,3,range,{loop:state.loop})){
        const packet=playback.get(tick);if(!packet)break;packets.push(packet);
      }
      playbackUploadAhead.update(state.renderer,packets,{report:editor.report,view:state.view,cameraEnabled:state.playbackCameraEnabled},
        packet=>state.playing&&!state.scrubbing&&playback.cache.get(packet.tick)===packet);
    }
    playbackMetrics.buffering(state.buffering, measuredAt);
    if (measuredAt - lastFpsUI >= 250) {
      const sample = playbackMetrics.snapshot(measuredAt), badge = $("playback-fps");
      badge.textContent = sample.fps === null ? "— fps" : `${sample.fps.toFixed(1)} fps`;
      badge.dataset.health = sample.coherent === null ? "pending" : sample.coherent ? "good" : "low";
      badge.title = `Scene target: ${sample.targetFps.toFixed(1)} fps`;
      $('preview-quality').hidden = !(state.playbackPacket?.previewQuality?.reduced || state.previewGovernor?.index);
      adaptPreviewQuality(sample, measuredAt);
      lastFpsUI = measuredAt;
    }
  }
  // A seek/edit event can request the next frame while this callback runs.
  // Keep that request instead of starting a second animation loop.
  if (!raf && (state.playing || state.dirtyRender)) raf = requestAnimationFrame(loop);
}
async function play() {
  if(!state.playing){try{await drawingController?.barrier();}catch(error){fail(error);return;}}
  if (!$("renderer-error").hidden) return;
  if (state.playing) return pause();
  if ([...exportJobs].some(job => job.raster)) return status('Finish or cancel the export before playing.');
  editablePreparation.cancel();
  state.previewing = false;
  if (editor.totalTicks < 1) return;
  cancelDrag();
  // Optionally fit once on transport start; subsequent zoom and pan remain user-controlled.
  if (state.settings.fitViewOnPlayback) fit();
  selectPlaybackQuality();
  const range = playbackRange();
  playTick =
    editor.tick >= range.end - 1 || editor.tick < range.start
      ? range.start
      : editor.tick;
  playStart = performance.now();
  playbackCadence.reset();presentationDeadline=null;
  telemetry.count('playback_started');
  playbackMetrics.reset(playStart, editor.report.frame_delay_ms
    ? 1000 / editor.report.frame_delay_ms : editor.report.fps);
  telemetry.playbackStart(telemetry.consent.diagnostics ? workload({ report: editor.report, fps: playbackMetrics.targetFps }) : {});
  lastFpsUI = playStart;
  $("playback-fps").textContent = "— fps";
  $("playback-fps").dataset.health = "pending";
  $("playback-fps").hidden = false;
  playStarted = false;
  playStartupFrames = 2;
  playbackUploadWarmup.reset();
  playDeadline = playStart;
  state.playbackPacket = null;
  // A changed density is committed with its repaint at the next animation task.
  // Avoid queuing obsolete full-size packets just before that transaction.
  if (pendingPreviewQuality === null) prepareAhead(playTick, 48);
  state.playing = true;
  audioScrubController?.abort();
  audioEngine.stop(); audioEngine.hasAudio = false;
  state.audioReady = !audibleClips(audioState(editor.report)).length;
  if (!state.audioReady) {
    audioPreparation?.abort(); const controller = audioPreparation = new AbortController();
    state.buffering = true;
    void audioEngine.unlock().then(() => audioEngine.prepare(editor.report, {start: range.start / audioFps(editor.report), end: range.end / audioFps(editor.report), signal: controller.signal}))
      .then(() => { if (!controller.signal.aborted) { state.audioReady = true; requestRender(); } })
      .catch(error => { if (!controller.signal.aborted) { pause(); fail(error); } });
  }
  thumbnailRenderer?.setPaused(true);
  timelineUI?.setPaused?.(true);
  $("preview-badge").hidden = false;
  $("play-button").innerHTML = icon("pause");
  $("play-button").setAttribute("aria-label", "Pause");
  appLocalization?.updatePlayback($("play-button"), state);
  requestRender();
}
function pause() {
  playbackUploadAhead.reset();
  playbackUploadWarmup.reset();
  state.motionPreviewRange=null;
  if(state.playing)telemetry.performance.resources('stopped');
  audioPreparation?.abort(); audioScrubController?.abort(); audioEngine.stop(); state.audioReady = true;
  const wasPlaying = state.playing || state.previewing;
  if (state.playing) {
    playbackMetrics.stop(performance.now());
    const summary = playbackMetrics.snapshot(performance.now());
    telemetry.count('playback_frames', summary.totalFrames);
    telemetry.count('playback_seconds', Math.round(summary.elapsedMs / 1000));
    telemetry.count('playback_buffering', summary.bufferingEvents);
    telemetry.timing('playback_startup_ms', summary.startupMs);
    telemetry.timing('playback_buffering_ms', summary.bufferingMs);
    telemetry.playbackStop();
  }
  $("playback-fps").hidden = true;
  $('preview-quality').hidden = true;
  if (wasPlaying && state.playbackPacket)
    state.editingPacket = {
      packet: state.playbackPacket,
      report: editor.report,
      revision: editor.revision,
      tick: editor.tick,
    };
  state.playing = false;
  state.previewing = false;
  resetPreviewQuality();
  if (editor.endFrameDraftPreview()) state.editingPacket = null;
  const prepareEditable=Boolean(wasPlaying&&state.editingPacket&&state.renderer?.prepareSceneUpdate);
  thumbnailRenderer?.setPaused(prepareEditable||document.hidden);
  timelineUI?.setPaused?.(prepareEditable||document.hidden);
  state.buffering = false;
  state.playbackPacket = null;
  $("preview-badge").hidden = true;
  $("play-button").innerHTML = icon("play");
  $("play-button").setAttribute("aria-label", "Play");
  appLocalization?.updatePlayback($("play-button"), state);
  if(prepareEditable){
    editablePreparation.start(state.renderer,geometry=>({
      frame:currentFrame(),view:{...state.view},getView:()=>({...state.view}),
      cameraEnabled:false,editorBackgroundColor:builderBackgroundColor(state.settings,state),
      onionFrames:onionSkins(),geometry,artworkRevision:editor.definitionRevision,
    }));
  }
  requestRender();
  if (wasPlaying) {
    reconcileSelectedSegmentTrack();
    queueUI();
    status(state.editablePreparing?'Preparing canvas':'Ready');
  }
}
function previewFrame() {
  pause();
  editablePreparation.cancel();
  cancelDrag();
  state.previewing = true;
  $("preview-badge").textContent = "PREVIEW";
  $("preview-badge").hidden = false;
  $("play-button").innerHTML = icon("stop");
  $("play-button").setAttribute("aria-label", "Stop preview");
  appLocalization?.updatePlayback($("play-button"), state);
  requestRender();
}
function updateTransport() {
  const fps = editor.report.fps,
    tick = editor.tick;
  $("time-display").textContent =
    `${String(Math.floor(tick / fps / 60)).padStart(2, "0")}:${String(Math.floor(tick / fps) % 60).padStart(2, "0")}:${String(tick % fps).padStart(2, "0")}`;
  $("frame-badge").textContent = `FRAME ${String(tick + 1).padStart(2, "0")}`;
  const storedSummary =
    state.settings.timelineMode === "simple"
      ? `${editor.report._styk?.layerSheet ? timelineUI?.frameCount ?? 0 : editor.frameDraft?.storedCount ?? editor.report.keyframes.length} keys · `
      : "";
  $("timeline-summary").textContent =
    `${storedSummary}${editor.totalTicks} frames · ${(editor.totalTicks / fps).toFixed(2)}s`;
  $("fps").value = fps;
  timelineUI?.update(state.settings.timelineMode !== 'advanced');
}
function updateTitle() {
  document.title = `${editor.dirty ? "• " : ""}${editor.name || "Untitled"} — StykAnimate`;
  $("project-name").textContent = editor.name || "Untitled";
  $("dirty-dot").classList.toggle("dirty", editor.dirty);
  $("save-state").textContent = editor.dirty ? "Unsaved changes" : "Saved";
  $("save-state").dataset.dirty = String(editor.dirty);
  desktop?.setDocumentState?.({
    name: editor.name || "Untitled",
    dirty: editor.dirty,
    revision: `${state.documentToken}:${editor.revision}:${editor.frameDraftRevision}`,
  });
}
function updateUI() {
  if(state.editablePreparing)return;
  updateTitle();
  updateTransport();
  renderLayers();
  renderInspector();
  $("stage-size").textContent =
    `${editor.report.canvas_width} × ${editor.report.canvas_height}`;
  $("object-count").textContent =
    `${editor.frame.objects.length.toLocaleString()} figures`;
  $("selection-summary").textContent =
    selection().size > 1
      ? `${selection().size} figures selected`
      : editor.object
        ? nameOf(editor.object)
        : "No figure selected";
  if (state.activeTab === "assets") renderAssets();
  studioShell?.sync();
  requestRender();
}
function renderLayers() {
  if ($("layer-count"))
    $("layer-count").textContent =
      editor.layers?.filter((layer) => !["scene", "camera"].includes(layer.id))
        .length || 1;
  timelineUI?.selectTrack?.(state.selectedTrackId);
}
function renderAssets() {
  const figures = editor.report.figure_types;
  assetLibrary?.setVisible(state.activeTab === "assets");
  assetLibrary?.update(figures, { selectedId: editor.object?.figure_type_id });
  $("sample-list").innerHTML = '<button class="sample-item" data-action="rig-examples"><span>Rig examples</span></button>' + (state.samples.length
    ? state.samples
        .map(
          (s) =>
            `<button class="sample-item" data-sample="${esc(s.path)}">${icon(s.kind === "stk" ? "person" : "file")}<span>${esc(s.name)}</span><small>${esc(s.kind?.toUpperCase() || "PIV")}</small></button>`,
        )
        .join("")
    : '<p class="property-note" style="padding:0 15px">Open StykAnimate, Pivot or Stick Nodes projects, figures and movie clips.</p>');
}
function renderInspector() {
  vfxInspector?.sync();
  if (cameraMotionControls?.active || propertyControls?.active || (state.drag && state.drag.kind !== "pan"))
    return;
  const disclosureOwner = {
    document: editor._documentToken,
    figureTypeId: editor.figure?.figure_type_id,
    polygonCount: editor.figure?.polyfills?.length,
  };
  const preserveDisclosure =
    inspectorDisclosureOwner &&
    Object.keys(disclosureOwner).every(
      (key) => disclosureOwner[key] === inspectorDisclosureOwner[key],
    );
  const disclosedSections = new Set([...$("inspector").querySelectorAll('details[data-section][open]')].map(el => el.dataset.section));
  const openPolygons = preserveDisclosure
    ? [
        ...$("inspector").querySelectorAll("details[data-polygon-index][open]"),
      ].map((element) => element.dataset.polygonIndex)
    : [];
  updateInspectorDOM($("inspector"), inspectorView({
    editor,
    tab: state.inspectorTab,
    drawing: drawingController,
    hotkeyLabel:id=>hotkeys.label(id),
    context: editor.branchSelected ? "figure" : state.inspectorContext,
    propertyState,
    tool: editor.branchSelected ? "rig" : state.tool,
    rigMode: state.rigMode,
    builderBranch: usesBuilderBranch(),
    builder: Boolean(builderMode?.active),
    selectionCount: editor.branchSelected ? 1 : selection().size,
    bounds: selection().size > 1 ? selectionBounds() : null,
    rangeIndices: editor.frameDraft?.mode === "add" ? [] : state.rangeIndices,
    applyRange: state.applyRange,
    polygonPage: state.polygonPage || 0,
    palettePage: state.palettePage || 0,
  }), {preserveDisclosure});
  cameraMotionControls?.sync();
  refreshHotkeyHints(hotkeys, $('inspector'));
  if (state.polygon) {
    for (const input of $("inspector").querySelectorAll(
      "input,select,textarea,button",
    )) {
      input.disabled = true;
      input.title = "Finish or cancel the polygon first.";
    }
  }
  for (const section of $("inspector").querySelectorAll('details[data-section]')) {
    if (preserveDisclosure && disclosedSections.has(section.dataset.section)) section.open = true;
  }
  studioShell?.sync();
  inspectorDisclosureOwner = disclosureOwner;
  for (const index of openPolygons)
    $("inspector")
      .querySelector(`details[data-polygon-index="${index}"]`)
      ?.setAttribute("open", "");
  document
    .querySelectorAll("[data-inspector]")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.inspector === state.inspectorTab,
      ),
    );
}

let construction;
function setTool(tool) {
  if(drawingController?.active){const name=tool==='hand'?'pan':tool==='select'?'transform':tool.replace('drawing-','');if(['brush','eraser','fill','lasso','transform','pan'].includes(name))return drawingController.setTool(name);return;}

  if (tool !== 'attach') state.figureJoin = null;
  if (state.tool !== tool) construction?.cancel();
  if (tool !== state.tool && ['rig', 'line', 'chain', 'circle', 'polygon'].includes(tool)) telemetry.count('builder');
  if (!builderMode?.active && isMovieclip(editor.figure) && ['rig','line','chain','circle','polygon'].includes(tool)) {
    editor.enterMovieclip();
  }
  // Choosing a construction tool outside the builder opens a bounded session —
  // on the selected figure when one is bound, or a new figure otherwise.
  if (!builderMode?.active && ['rig', 'line', 'chain', 'circle', 'polygon'].includes(tool)) builderMode?.enter();
  if (tool === "polygon" && state.tool === "polygon" && state.polygon) {
    finishPolygon();
    return;
  }
  if (state.drag) cancelDrag();
  if (state.tool !== tool) {
    state.bucketPreview = null;
    cancelSpritePlacement();
    state.polygon = null;
    $("polygon-controls").hidden = true;
  }
  state.tool = tool;
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  viewport.classList.toggle("panning", tool === "hand");
  viewport.classList.toggle(
    "drawing",
    ["line", "chain", "circle", "polygon"].includes(tool),
  );
  $("viewport-hint").textContent = {
    select: "Drag to select · Shift-click to add · Drag a joint to pose",
    pose: "Drag to pose · Ctrl-drag to stretch · Shift + right-drag to bend",
    rig: "Edit figure joints · Changes update every instance",
    hand: state.settings.canvasZoomGesture === 'scroll'
      ? "Drag to pan · Scroll to zoom"
      : "Drag or scroll to pan · Ctrl-scroll to zoom",
    chain: "Click to extend · Enter to finish · Backspace to remove · Esc to cancel",
    line: "Drag anywhere to draw · Start on a joint to extend a figure",
    circle: "Drag anywhere to draw · Start on a joint to extend a figure",
    polygon:
      "Click joints to trace · Shift-click an enclosed area to fill · Enter to finish",
    attach: "Click the parent joint · Esc to cancel",
    tweener: "Drag horizontally to tween · Shift for precision · Esc / right-click cancels",
  }[tool];
  if (["rig", "line", "chain", "circle", "polygon"].includes(tool)) {
    state.inspectorTab = "design";
    state.inspectorContext = editor.object ? "figure" : "scene";
  }
  document
    .querySelectorAll("[data-inspector]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.inspector === state.inspectorTab),
    );
  renderInspector();
  tweenerControls?.sync();
  requestRender();
}
function closestHandle(p, excludedUid = null, { uid } = {}) {
  const threshold = 10 / state.view.scale;
  let best = threshold * threshold,
    hit = null;
  for (const g of editor.geometry.objects.values()) {
    if (
      !g ||
      g.obj.unique_id === excludedUid ||
      (uid !== undefined && g.obj.unique_id !== uid) ||
      isHidden(g.obj.unique_id) ||
      isLocked(g.obj.unique_id)
    )
      continue;
    for (const [id, point] of g.joints) {
      const distance = (point.x - p.x) ** 2 + (point.y - p.y) ** 2;
      if (distance <= best) {
        best = distance;
        hit = { g, id, point };
      }
    }
  }
  return hit;
}
function cancelPolygonDraft() {
  if (!state.polygon) return;
  state.polygon = null;
  $("polygon-controls").hidden = true;
  queueUI();
  requestRender();
}
function refreshPolygonDraft() {
  if (!state.polygon) return;
  state.polygon.handles = state.polygon.draft.handles;
  $("polygon-controls").hidden = false;
  $("polygon-count").textContent = `${state.polygon.handles.length} joints`;
  $("finish-polygon").disabled = state.polygon.handles.length < 3;
  requestRender();
}
function polygonClick(p, event = {}) {
  if (event.shiftKey && builderMode?.active) {
    const g=editor.geometry.objects.get(editor.selectedSlot),existing=pickFigureFill(g,p);
    if(existing){cancelPolygonDraft();editor.selectPolygon(editor.selectedUid,existing.index);return;}
    const region=bucketRegion(g,p);
    if(!region)return toast('No closed region here. Close the outline at its joints first.');
    cancelPolygonDraft();
    const polygon=editor.addPolygon(region.ids,{color:g.segments[editor.selectedJoint]?.rgb??g.segments[0]?.rgb??[43,43,43]});
    editor.selectPolygon(editor.selectedUid,editor.figure.polyfills.indexOf(polygon));
    state.bucketPreview=null;status('Fill added');return;
  }
  if (!state.polygon && builderMode?.active && !pick(p)) {
    const fill=pickFigureFill(editor.geometry.objects.get(editor.selectedSlot),p);
    if(fill){editor.selectPolygon(editor.selectedUid,fill.index);return;}
  }
  let g = state.polygon
    ? [...editor.geometry.objects.values()].find(
        (g) => g.obj.unique_id === state.polygon.uid,
      )
    : pick(p)?.g;
  if (!g) {
    toast("Choose a figure joint to begin a polygon.");
    return;
  }
  const maxDistance = 10 / state.view.scale;
  let closest = null,
    best = Infinity;
  for (const [id, point] of g.joints) {
    const distance = (point.x - p.x) ** 2 + (point.y - p.y) ** 2;
    if (distance < best) {
      best = distance;
      closest = [id, point];
    }
  }
  if (
    !closest ||
    Math.hypot(closest[1].x - p.x, closest[1].y - p.y) > maxDistance
  ) {
    toast("Polygons attach to joints. Click a red, orange, or gray joint.");
    return;
  }
  if (!state.polygon) {
    editor.select(g.obj.unique_id);
    state.polygon = {
      uid: g.obj.unique_id,
      handles: [],
      draft: new PolygonDraft(g),
    };
  }
  state.polygon.draft.append(closest[0], {
    chain: Boolean(event.ctrlKey || event.metaKey),
  });
  refreshPolygonDraft();
  if (state.polygon.draft.complete) finishPolygon();
}
function finishPolygon() {
  if (!state.polygon || state.polygon.handles.length < 3) {
    toast("Choose at least three different joints.");
    return;
  }
  const draft = state.polygon;
  editor.select(draft.uid);
  editor.addPolygon(draft.handles, { color: [43, 43, 43] });
  state.polygon = null;
  $("polygon-controls").hidden = true;
  setTool("select");
  status("Polygon added");
}
function pick(p) {
  if (!state.handles) return null;
  const geometry = editor.geometry;
  const options = {
    project: screenPoint,
    projectionScale: !state.playing&&!state.previewing?state.view.scale:undefined,
    minRadius: 8,
    nearest: true,
  };
  const hit = pickCanvasHandle(geometry, p, {...options, handles: canvasHandles(geometry)});
  // Visible handles keep priority. Hidden static endpoints are selection-only
  // fallback targets, prepared lazily on clicks, never on pointer hover.
  if (hit || builderMode?.active || !['select', 'pose'].includes(state.tool)) return hit;
  return pickCanvasHandle(geometry, p, {...options, handles: canvasHandles(geometry, {selectStatic: true})});
}
overlay.addEventListener(
  "pointerdown",
  guarded((e) => {
    if (!$("renderer-error").hidden || !e.isPrimary) return;
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if (state.drag?.kind === 'tweener' && e.button === 2) {
      e.preventDefault();state.suppressContext = true;cancelDrag();return;
    }
    // A secondary click opens actions; Shift preserves the bend gesture.
    if (e.button === 2 && !e.shiftKey) {
      state.suppressContext = false;
      return;
    }
    if (e.button === 2) state.suppressContext = true;
    if (state.previewing) {
      pause();
      return;
    }
    finishKeyboardHandle();
    playback.setInteractionActive(true);
    interruptRecovery();
    $("toast").hidden = true;
    clearTimeout(toastTimer);
    pause();
    viewport.focus({ preventScroll: true });
    editablePreparation.cancel();
    overlay.setPointerCapture(e.pointerId);
    canvasPointerId = e.pointerId;
    if (e.button === 1 || state.space || state.tool === "hand") {
      if (state.space) state.spacePanned = true;
      state.drag = {
        kind: "pan",
        x: e.clientX,
        y: e.clientY,
        view: { ...state.view },
      };
      viewport.classList.add("dragging");
      return;
    }
    const p = worldPoint(e);
    if (state.tool === 'tweener') {
      if (e.button === 0 && tweenerControls.begin(e)) state.drag = {kind:'tweener'};
      else releaseCanvasPointer();
      return;
    }
    if (state.spritePlacement || state.duplicatePlacement) {
      releaseCanvasPointer();
      if (e.button !== 0) return;
      const duplicate = state.duplicatePlacement,
        pending = duplicate || state.spritePlacement,
        target = closestHandle(
          p,
          null,
          duplicate ? { uid: duplicate.uid } : {},
        );
      if (!target) {
        toast(
          duplicate
            ? "Choose a joint on the source figure."
            : "Choose an unlocked figure joint to attach the sprite.",
        );
        return;
      }
      if (pending.document !== editor._documentToken)
        return cancelSpritePlacement();
      if (duplicate) {
        editor.select(duplicate.uid);
        const sourceIndex = editor.figure?.segments.findIndex(
          (segment) => segment.segment_id === duplicate.handleId,
        );
        if (
          sourceIndex === undefined ||
          sourceIndex < 0 ||
          editor.figure.figure_type_id !== duplicate.figureTypeId
        ) {
          cancelSpritePlacement();
          return;
        }
        editor.select(duplicate.uid, sourceIndex);
        const added = editor.duplicateSegment({
          parentId: target.id,
          branch: duplicate.branch,
          flip: duplicate.flip,
        });
        cancelSpritePlacement();
        editor.select(
          duplicate.uid,
          editor.figure.segments.findIndex(
            (segment) => segment.segment_id === added.selectedHandleId,
          ),
        );
        status(duplicate.branch ? "Branch duplicated" : "Segment duplicated");
      } else {
        editor.select(target.g.obj.unique_id);
        const added = editor.addSpriteSegment(pending.figure, {
          parentId: target.id,
        });
        cancelSpritePlacement();
        editor.select(target.g.obj.unique_id, added.segmentIndex);
        status("Sprite attached");
      }
      queueUI();
      return;
    }
    const camera = activeCameraHandle(p);
    if (
      (e.button === 0 || e.button === 2) &&
      camera &&
      ["select", "pose"].includes(state.tool)
    ) {
      selectTrack({ id: "camera", kind: "camera" });
      renderInspector();
      const geometry = editor.geometry;
      editor.beginCameraDrag({
        indices: rangeFrames(),
        label: `${camera.kind === "position" ? "Move" : camera.kind === "rotation" ? "Rotate" : "Scale"} camera`,
      });
      state.drag = {
        kind: "camera",
        handle: camera,
        start: p,
        viewport: cameraViewport(editor.report, currentFrame(), state.view),
        constrain: undefined,
        axis: null,
        geometry,
      };
      if (e.button === 2) state.suppressContext = true;
      return;
    }
    if (
      e.button === 0 &&
      state.motionPaths &&
      ["select", "pose"].includes(state.tool) &&
      !builderMode?.active
    ) {
      const motionPaths = activeMotionPaths({sample: false});
      const screen = screenPoint(p);
      let pathHit = null, hitTarget = null;
      for (const motionPath of motionPaths) {
        const hit = pickMotionPathPoint(
          motionPath.entry,
          screen,
          { project: screenPoint, radius: 9, tick: editor.tick },
        );
        if (hit && (!pathHit || hit.distance < pathHit.distance)) { pathHit = hit; hitTarget = motionPath.target; }
      }
      if (pathHit && editor.beginMotionPathEdit(hitTarget, pathHit.tick)) {
        state.drag = {
          kind: "motion-path",
          key: motionPathTargetKey(hitTarget),
          tick: pathHit.tick,
          start: p,
          point: p,
          origin: {x: pathHit.x, y: pathHit.y},
          moved: false,
        };
        viewport.classList.add("dragging");
        requestRender();
        return;
      }
    }
    if (state.rigAnchorPick) {
      const pending=state.rigAnchorPick,target=closestHandle(p);
      releaseCanvasPointer();
      if(pending.token!==editor._documentToken||pending.uid!==editor.selectedUid){state.rigAnchorPick=null;return;}
      if(!target||target.g.obj.unique_id!==pending.uid){toast('Choose a joint on this figure. Escape cancels.');return;}
      if(pending.key==='driver')editor.bindStretchParts(target.id);
      else if(pending.key)editor.setRigBehavior({connector:{[pending.key]:target.id}});
      else editor.addConnector(pending.start,target.id);
      state.rigAnchorPick=null;toast(pending.key==='driver'?'Stretch driver connected.':pending.key?'Connector anchor updated.':'Connector added. Drag its middle joint to slide.');requestRender();return;
    }
    if (state.tool === "attach") {
      releaseCanvasPointer();
      const pending = state.figureJoin;
      if (!pending || selectedFigureJoinAction()?.uid !== pending.uid) {setTool('select'); return;}
      const target = pickCanvasHandle(editor.geometry, p, {handles: canvasHandles(editor.geometry),
        project: screenPoint, projectionScale: state.view.scale, minRadius: 8, nearest: true});
      if (!target || isHidden(target.uid) || isLocked(target.uid)) {
        toast("Click a joint on the parent figure.");
        return;
      }
      editor.joinFiguresInFrames(target.uid, target.id, pending.indices,
        {uids: [pending.uid], atPlayhead: !pending.indices});
      setTool("select");
      status("Figures attached");
      return;
    }
    if (state.tool === "chain") { releaseCanvasPointer(); if(e.button===0)construction.click(p,e); return; }
    if (state.tool === "polygon") {
      polygonClick(p, e);
      return;
    }
    if (state.tool === "line" || state.tool === "circle") {
      const hit = pick(p),
        threshold = 10 / state.view.scale;
      let parent = null;
      const selectedPoint=builderMode?.active?editor.geometry.objects.get(editor.selectedSlot)?.joints.get(editor.figure?.segments[editor.selectedJoint]?.segment_id??0):null;
      if (hit&&(!selectedPoint||Math.hypot(p.x-selectedPoint.x,p.y-selectedPoint.y)>threshold)) {
        let joint = -1,
          best = threshold * threshold;
        for (const [id, point] of hit.g.joints) {
          const distance = (point.x - p.x) ** 2 + (point.y - p.y) ** 2;
          if (distance < best) {
            best = distance;
            parent = point;
            joint =
              hit.g.fig?.segments?.findIndex((s) => s.segment_id === id) ??
              editor.report.figure_types
                .find((f) => f.figure_type_id === hit.g.obj.figure_type_id)
                .segments.findIndex((s) => s.segment_id === id);
          }
        }
        if (parent) editor.select(hit.g.obj.unique_id, joint);
      }
      // In the builder the bound figure stays selected: a stroke off-joint
      // attaches to the selected joint or the root instead of a new figure.
      if (!parent && !builderMode?.active) editor.select(null);
      state.drag = {
        kind: "draw",
        start: builderMode?.active ? construction.start(p).point : (parent ? {...parent} : p),
        current: p,
      };
      state.drag.appearance = builderStrokeAppearance(editor);
      requestRender();
      return;
    }
    const hit = pick(p);
    if (!hit && e.button === 0 && builderMode?.active && ['select','rig'].includes(state.tool)) {
      const polygon=pickFigureFill(editor.geometry.objects.get(editor.selectedSlot),p);
      if(polygon){releaseCanvasPointer();editor.selectPolygon(editor.selectedUid,polygon.index);return;}
    }
    if (e.button === 2 && (!hit || hit.joint < 0)) return;
    if (!hit) {
      const initial = e.shiftKey ? [...selection()] : [];
      if (!e.shiftKey) editor.select(null);
      state.drag = {
        kind: "marquee",
        start: p,
        current: p,
        initial,
        mode: e.shiftKey ? "toggle" : "replace",
      };
      requestRender();
      return;
    }
    if (e.button === 0 && e.shiftKey && !e.altKey) {
      if (builderMode?.active && hit.joint >= 0) editor.toggleSegment(hit.g.obj.unique_id, hit.joint);
      else editor.select(hit.g.obj.unique_id, -1, { toggle: true });
      releaseCanvasPointer();
      return;
    }
    if(hit.g.segments[hit.joint]?.connector)editor._connectorInspector=null;
    const handleEdit = state.handleEditHeld;
    const figureTransform = e.altKey && hit.joint >= 0 && !handleEdit;
    editor.select(hit.g.obj.unique_id, hit.joint, {
      add: (hit.joint < 0 || figureTransform) && isSelected(hit.g.obj.unique_id),
    });
    if (
      hit.action === 'select' && !figureTransform
    ) {
      releaseCanvasPointer();
      return;
    }
    if (e.button === 2) state.suppressContext = true;
    if (handleEdit) editor.beginHandleEditDrag({ bend: e.button === 2 });
    else if (figureTransform)
      editor.beginFigureHandleDrag(p.x, p.y, { rotate: true, scale: true, joint: hit.joint });
    else if (hit.joint >= 0 && state.tool === "rig")
      editor.beginRigDrag({ reposition: state.rigMode !== "rotate" });
    else if (hit.joint >= 0) editor.beginDrag("Pose joint");
    else editor.beginTranslationDrag("Move connected figures");
    state.drag = {
      kind: handleEdit
        ? "handle-edit"
        : figureTransform
          ? "figure-transform"
          : hit.joint >= 0
            ? state.tool === "rig"
              ? "rig"
              : e.button === 2
                ? "bend"
                : "pose"
            : "move",
      bend: e.button === 2,
      constrain: e.ctrlKey || e.metaKey,
      axis: null,
      start: p,
      root: { x: hit.g.obj.root_x, y: hit.g.obj.root_y },
      joint: hit.joint,
      moved: false,
    };
    if (state.drag.kind === "rig" && builderMode?.active) construction.beginRig();
    if (hit.joint < 0 && !handleEdit) {
      const uids = editor.resolveTranslationSelection().affectedUids;
      state.drag.ikLive = editor._drag.before.some(hasPinnedIK);
      if (!state.drag.ikLive) {
        state.drag.geometry = editor.geometry;
        state.drag.translations = new Map([...uids].map((uid) => [uid, { x: 0, y: 0 }]));
      }
    }
    requestRender();
  }),
);
overlay.addEventListener(
  "pointermove",
  guarded((e) => {
    const drag = state.drag;
    if (drag?.kind === 'tweener') {
      if (e.buttons & 2) {e.preventDefault();state.suppressContext=true;cancelDrag();}
      else tweenerControls.move(e);
      return;
    }
    if (!drag && state.tool === 'tweener' && !state.space) return;
    if(drag&&telemetry.isForeground)telemetry.performance.action(drag.kind==='pan'?'pan':'edit');
    if (!drag && state.tool === 'polygon' && builderMode?.active) {
      state.bucketPreview = e.shiftKey ? bucketRegion(editor.geometry.objects.get(editor.selectedSlot),worldPoint(e)) : null;
      overlay.style.cursor = e.shiftKey ? (state.bucketPreview ? 'copy' : 'not-allowed') : '';
      requestRender();return;
    }
    if (!drag && state.tool === "chain" && construction?.active) {construction.move(worldPoint(e),e);return;}
    if (!drag) {
      // Playback uses worker packets; hover must not materialize an editable
      // scene (and all its handles) for every mouse move between ticks.
      if (state.previewing || state.playing || state.editablePreparing) return;
      if (state.spritePlacement || state.duplicatePlacement) {
        const point = worldPoint(e),
          pending = state.spritePlacement || state.duplicatePlacement;
        pending.point = point;
        const snap = pending.preview?.index.nearest(point,10/state.view.scale,{jointsOnly:true});
        pending.hover = pending.preview ? (snap ? {point:snap,id:snap.id} : null) : closestHandle(point);
        if(state.duplicatePlacement)overlay.style.cursor="copy";
        requestRender();
        return;
      }
      const previousCameraHandle = state.hoverCameraHandle;
      state.hoverCameraHandle = activeCameraHandle(worldPoint(e));
      overlay.style.cursor = cameraHandleCursor(state.hoverCameraHandle, cameraViewport(editor.report,currentFrame(),state.view));
      if (previousCameraHandle?.index !== state.hoverCameraHandle?.index) requestRender();
      const previousPathPoint = state.hoverPathPoint;
      state.hoverPathPoint = null;
      if (state.motionPaths && !state.hoverCameraHandle && ["select", "pose"].includes(state.tool) && !builderMode?.active) {
        const motionPaths = activeMotionPaths({sample: false});
        const screen = screenPoint(worldPoint(e));
        let pathHit = null, hitTarget = null;
        for (const motionPath of motionPaths) {
          const hit = pickMotionPathPoint(motionPath.entry, screen, { project: screenPoint, radius: 9, tick: editor.tick });
          if (hit && (!pathHit || hit.distance < pathHit.distance)) { pathHit = hit; hitTarget = motionPath.target; }
        }
        if (pathHit) {
          state.hoverPathPoint = { key: motionPathTargetKey(hitTarget), tick: pathHit.tick };
          overlay.style.cursor = "grab";
          if (previousPathPoint?.tick !== pathHit.tick || previousPathPoint?.key !== state.hoverPathPoint.key) requestRender();
        }
        if (!state.hoverPathPoint && previousPathPoint !== undefined) requestRender();
      }
      const geometry = editor.geometry;
      const handle =
        state.handles && !state.hoverCameraHandle
          ? pickCanvasHandle(geometry, worldPoint(e), {
              handles: canvasHandles(geometry),
              project: screenPoint,
              projectionScale: !state.playing&&!state.previewing?state.view.scale:undefined,
              minRadius: 8,
              nearest: true,
            })
          : null;
      state.hoverHandle = handle
        ? {
            uid: handle.uid,
            joint: handle.joint,
            id: handle.id,
            static: handle.static,
          }
        : null;
      return;
    }
    if (drag.kind === "pan") {
      state.view.x = drag.view.x + e.clientX - drag.x;
      state.view.y = drag.view.y + e.clientY - drag.y;
      placeArtboard();
      requestRender();
      return;
    }
    const p = worldPoint(e);
    if (drag.kind === "camera") {
      if (
        (p.x === drag.lastPoint?.x && p.y === drag.lastPoint?.y) ||
        (!drag.lastPoint && p.x === drag.start.x && p.y === drag.start.y)
      )
        return;
      drag.constrain ??= e.ctrlKey || e.metaKey;
      drag.snap = e.shiftKey;
      drag.lastPoint = p;
      editor.updateCameraDrag(cameraDragDelta(drag, p));
      requestRender();
      return;
    }
    if (drag.kind === "draw" || drag.kind === "marquee") {
      drag.current = drag.kind === "draw" && builderMode?.active ? construction.snap(p,e,drag.start) : p;
      requestRender();
      return;
    }
    if (drag.kind === "motion-path") {
      if (p.x !== drag.point?.x || p.y !== drag.point?.y) {
        drag.point = p;
        drag.moved = true;
        const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        const constrained = e.shiftKey
          ? (Math.abs(dx) >= Math.abs(dy) ? {x: dx, y: 0} : {x: 0, y: dy})
          : {x: dx, y: dy};
        editor.updateMotionPathEdit({x: drag.origin.x + constrained.x, y: drag.origin.y + constrained.y}, {
          stretch: e.ctrlKey || e.metaKey,
          isolate: Boolean(state.isolateHeld || state.isolateMode),
        });
      }
      requestRender();
      return;
    }
    drag.moved = true;
    if (drag.kind === "move") {
      const dx = p.x - drag.start.x,
        dy = p.y - drag.start.y;
      if (drag.constrain && !drag.axis && Math.hypot(dx, dy) > 0.5)
        drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      const delta = {
        x: drag.axis === "y" ? 0 : dx,
        y: drag.axis === "x" ? 0 : dy,
      };
      if (drag.ikLive) { drag.delta = delta; editor.moveSelection(delta.x, delta.y, {fromStart: true}); }
      else for (const uid of drag.translations.keys()) drag.translations.set(uid, delta);
    } else if (drag.kind === "handle-edit")
      editor.editHandlePosition(p.x, p.y, { bend: drag.bend });
    else if (drag.kind === "figure-transform")
      editor.transformFigureHandle(p.x, p.y, {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      });
    else if (drag.kind === "rig") {
      const target = builderMode?.active ? construction.rigSnap(p,e) : p;
      editor.editRigJoint(target.x, target.y, {
        reposition: state.rigMode !== "rotate",
        stretch: e.ctrlKey || e.metaKey,
        isolate: Boolean(state.isolateHeld || state.isolateMode),
      });
    } else if (drag.kind === "bend")
      editor.bendJoint(p.x, p.y, {
        stretch: e.ctrlKey || e.metaKey,
        isolate: Boolean(state.isolateHeld || state.isolateMode),
        snapTolerance: 6 / state.view.scale,
      });
    else
      editor.poseJoint(p.x, p.y, {
        stretch: e.ctrlKey || e.metaKey,
        isolate: Boolean(state.isolateHeld || state.isolateMode),
        snapTolerance: 6 / state.view.scale,
      });
    requestRender();
  }),
);
function releaseCanvasPointer() {
  const id = canvasPointerId;
  canvasPointerId = null;
  if (id !== null && overlay.hasPointerCapture(id))
    overlay.releasePointerCapture(id);
}
function endDrag(event) {
  const drag = state.drag;
  if (drag?.kind === "draw" || drag?.kind === "rig") construction?.cancel();
  state.drag = null;
  releaseCanvasPointer();
  if (!drag) return;
  viewport.classList.remove("dragging");
  if (drag.kind === 'tweener') {
    tweenerControls.finish(true,event);
  } else if (drag.kind === "draw") {
    const p = drag.start,
      q = drag.current,
      length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length > 1) {
      if (!editor.addSegment)
        throw new Error("Segment authoring is unavailable.");
      editor.addSegment({
        ...strokeSegments([p,q],editor.object?.scale??1)[0],
        type: state.tool,
        start: p,
      });
      status("Segment added");
    }
  } else if (drag.kind === "marquee") {
    const a = screenPoint(drag.start),
      b = screenPoint(drag.current);
    const left = Math.min(a.x, b.x),
      right = Math.max(a.x, b.x),
      top = Math.min(a.y, b.y),
      bottom = Math.max(a.y, b.y);
    const uids = new Set();
    if (Math.hypot(right - left, bottom - top) > 3)
      for (const g of editor.geometry.objects.values()) {
        if (!g || isHidden(g.obj.unique_id) || isLocked(g.obj.unique_id))
          continue;
        const box = boundsOf(g),
          points = [
            screenPoint({ x: box.minX, y: box.minY }),
            screenPoint({ x: box.maxX, y: box.minY }),
            screenPoint({ x: box.maxX, y: box.maxY }),
            screenPoint({ x: box.minX, y: box.maxY }),
          ];
        if (
          Math.max(...points.map((p) => p.x)) >= left &&
          Math.min(...points.map((p) => p.x)) <= right &&
          Math.max(...points.map((p) => p.y)) >= top &&
          Math.min(...points.map((p) => p.y)) <= bottom
        )
          uids.add(g.obj.unique_id);
      }
    editor.selectMarquee([...uids], { mode: drag.mode, initial: drag.initial });
  } else if (drag.kind === "motion-path") {
    if (drag.moved) editor.commitMotionPathEdit();
    else editor.cancelMotionPathEdit();
  } else if (drag.kind === "camera") editor.commitCameraDrag();
  else if (drag.kind !== "pan") {
    if (drag.kind === "move" && drag.moved) {
      const delta = drag.ikLive ? drag.delta : drag.translations.get(editor.selectedUid);
      if (rangeFrames()) {
        editor.cancelDrag();
        moveSelected(delta.x, delta.y);
      } else if (!drag.ikLive) editor.moveSelection(delta.x, delta.y, { fromStart: true });
    }
    editor.commitDrag();
  }
  queueUI();
}
function cancelDrag() {
  if (state.drag?.kind === "draw" || state.drag?.kind === "rig") construction?.cancel();
  releaseCanvasPointer();
  cancelSpritePlacement();
  cancelPolygonDraft();
  if (!state.drag) return;
  if (state.drag.kind === 'tweener') tweenerControls.finish(false);
  if (state.drag.kind === "camera") editor.cancelCameraDrag();
  if (state.drag.kind === "motion-path") editor.cancelMotionPathEdit();
  if (
    ["move", "pose", "rig", "bend", "handle-edit", "figure-transform"].includes(
      state.drag.kind,
    )
  )
    editor.cancelDrag();
  state.drag = null;
  viewport.classList.remove("dragging");
  queueUI();
}
overlay.addEventListener("pointerup", guarded(endDrag));

overlay.addEventListener("dblclick", guarded((event) => {
  if (event.button === 0 && state.tool === "chain" && construction?.active) {event.preventDefault();construction.commit();return;}
  if (event.button !== 0 || state.space || state.playing || state.previewing ||
      state.spritePlacement || state.duplicatePlacement ||
      !["select", "pose", "rig"].includes(state.tool)) return;
  const hit = pick(worldPoint(event));
  if (!hit || isHidden(hit.uid) || isLocked(hit.uid)) return;
  event.preventDefault();
  if (hit.joint < 0 || hit.action === 'select') {
    state.builderBranch = false;
    editor.selectConnected(hit.uid, {add: event.shiftKey, candidates: editor.selectionFrame.objects
      .filter(o => !isHidden(o.unique_id) && !isLocked(o.unique_id)).map(o => o.unique_id)});
    status(`${editor.selectedUids.size} connected figures selected`);
  } else {
    editor.selectBranch(hit.uid, hit.joint);
    status("Branch selected — copy or edit the complete branch");
  }
  queueUI();
}));
overlay.addEventListener("pointercancel", cancelDrag);
overlay.addEventListener("lostpointercapture", (event) => {
  if (
    event.pointerId === canvasPointerId &&
    !overlay.hasPointerCapture(event.pointerId)
  )
    cancelDrag();
});
overlay.addEventListener("pointerleave", () => {
  if (state.spritePlacement || state.duplicatePlacement) {
    const pending = state.spritePlacement || state.duplicatePlacement;
    pending.point = null;
    pending.hover = null;
    requestRender();
  }
  state.hoverHandle = null;
  state.hoverCameraHandle = null;
  if (!state.drag) overlay.style.cursor = '';
  requestRender();
});
viewport.addEventListener(
  "wheel",
  (e) => {
    const shouldZoom = state.settings.canvasZoomGesture === 'scroll' || e.ctrlKey || e.metaKey;
    if(telemetry.isForeground)telemetry.performance.action(shouldZoom ? 'zoom' : 'pan');
    e.preventDefault();
    interruptRecovery();
    const r = viewport.getBoundingClientRect();
    if (!shouldZoom) {
      state.view.x -= e.shiftKey ? e.deltaY : e.deltaX;
      state.view.y -= e.shiftKey ? e.deltaX : e.deltaY;
      placeArtboard();
      requestRender();
    } else
      zoom(Math.exp(-e.deltaY * 0.005), {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      });
  },
  { passive: false },
);

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      message = data.error?.message || data.error || data.message || message;
    } catch {}
    throw new Error(message);
  }
  return response;
}
async function confirmReplace() {
  finishCurrentEdit();
  if (!editor.dirty) return true;
  return new Promise((resolve) => {
    showDialog(
      "Save your changes?",
      `<p>Your current project has unsaved changes. Save a StykAnimate project to keep editing it later.</p><div class="dialog-actions"><button class="button" id="keep-editing">Cancel</button><button class="button" id="discard-changes">Discard</button><button class="button primary" id="save-changes">Save project</button></div>`,
    );
    $("keep-editing").onclick = () => {
      closeDialog();
      resolve(false);
    };
    $("discard-changes").onclick = () => {
      closeDialog();
      resolve(true);
    };
    $("save-changes").onclick = guarded(async () => {
      const saved = await saveNative();
      if (saved) {
        closeDialog();
        resolve(true);
      }
    });
    $("dialog").addEventListener("cancel", () => resolve(false), {
      once: true,
    });
  });
}
async function acceptImport(
  result,
  name,
  { replaceApproved = false, openToken } = {},
) {
  let report = result.document ?? result.report ?? result;
  if (report.format === "stykanimate") report = report.document;
  const savedDraft = Boolean(report._styk?.simpleFrameDraft);
  const kind =
    result.kind ||
    ((name || result.filename || "").toLowerCase().endsWith(".stk")
      ? "stk"
      : "piv");
  if (kind === "stk" || kind === "stkz" || kind === "stykmov") {
    finishCurrentEdit();
    editor.importFigure(report);
    status(`Imported ${result.filename || name || "figure"}`);
  } else {
    const approvalCurrent =
      replaceApproved &&
      replaceApproved.report === editor.report &&
      replaceApproved.revision === editor.revision &&
      replaceApproved.draftRevision === editor.frameDraftRevision &&
      !editor._drag &&
      !editor._animationEdit;
    if (!approvalCurrent && !(await confirmReplace())) return false;
    let initialScene;
    try {
      await editor.loadAsync(
        report,
        (name || result.filename || "Untitled").replace(
          /\.(piv|stk|styk|stkz|stykmov|json|nodes|nodemc|stknds)$/i,
          "",
        ),
        {
          initialFrameIndex: kind === "piv" && !savedDraft ? "last" : 0,
          prepareScene: state.renderer?.prepareInitialScene
            ? async (incoming) => {
                const renderer = state.renderer;
                initialScene = await renderer.prepareInitialScene({
                  ...incoming,
                  view: fittedView(incoming.report),
                  getView: () => fittedView(incoming.report),
                  cameraEnabled: false,
                  editorBackgroundColor: builderBackgroundColor(
                    state.settings,
                    state,
                  ),
                  checkCurrent: () => {
                    incoming.checkCurrent();
                    if (state.renderer !== renderer)
                      throw new DOMException(
                        "The graphics device changed while importing.",
                        "AbortError",
                      );
                  },
                });
                preparedScenes.set(incoming.report, initialScene);
                return initialScene;
              }
            : undefined,
        },
      );
    } finally {
      if (initialScene) {
        preparedScenes.delete(initialScene.report);
        initialScene.dispose();
      }
    }
    state.sourceId = result.sourceId || null;
    if (!initialScene?.activated) {
      state.hidden.clear();
      state.locked.clear();
      images.clear();
      fit();
    }
    if (desktop?.activateDocument) {
      // A launch-time file open races init()'s document activation; the file's
      // activation must be the one that binds the native save target.
      await documentActivation;
      state.documentToken = (
        await desktop.activateDocument({ openToken })
      ).documentToken;
    }
  }
  state.lastImportWarnings = [...(result.warnings || report._styk?.sticknodes?.warnings || []), ...(report.import_warnings || [])];
  if(state.lastImportWarnings.length)showDialog(report.import_warnings?.length ? 'Pivot import notes' : 'Stick Nodes import notes',`<p>The asset is ready to edit. These source features may look or behave differently:</p><ul>${state.lastImportWarnings.map(w=>`<li>${esc(w.message)}</li>`).join('')}</ul>`);
  state.lastImport = result.timings || null;
  const ms = result.timings?.total_ms ?? result.timings?.decode_ms;
  status(
    `Opened ${result.filename || name || editor.name}${ms !== undefined ? ` · ${Math.round(ms)} ms${result.timings?.cache_hit ? " · cached" : ""}` : ""}`,
  );
  warmPlayback({immediate:true});
  return true;
}
function cancelSpritePlacement() {
  spriteImportController?.abort();
  spriteImportController = null;
  spritePlacementDialog?.cancel();
  const pending = state.spritePlacement || state.duplicatePlacement;
  if (!pending) return;
  $("viewport-hint").textContent = pending.previousHint;
  state.spritePlacement = null;
  state.duplicatePlacement = null;
  overlay.style.cursor = "";
  viewport.classList.remove("sprite-placement");
  requestRender();
}
function beginDuplicatePlacement({ branch = false, flip = false } = {}) {
  if (state.duplicatePlacement) {
    cancelSpritePlacement();
    return;
  }
  finishCurrentEdit();
  cancelSpritePlacement();
  const segment = editor.figure?.segments?.[editor.selectedJoint];
  if (!segment || !editor.object) return;
  setTool("rig");
  state.duplicatePlacement = {
    document: editor._documentToken,
    uid: editor.selectedUid,
    figureTypeId: editor.figure.figure_type_id,
    handleId: segment.segment_id,
    branch,
    flip,
    point: editor.geometry.objects.get(editor.object.object_slot)?.segments[editor.selectedJoint]?.start,
    preview: duplicatePreview(editor.geometry.objects.get(editor.object.object_slot),editor.selectedJoint,{branch,flip,scale:state.view.scale}),
    hover: null,
    previousHint: $("viewport-hint").textContent,
  };
  viewport.classList.add("sprite-placement");
  overlay.style.cursor = "copy";
  $("viewport-hint").textContent =
    "Choose a parent joint for the copy · Esc to cancel";
  viewport.focus({ preventScroll: true });
  requestRender();
}
async function beginSpritePlacement(file) {
  finishCurrentEdit();
  cancelSpritePlacement();
  const controller = new AbortController(),
    source = editor._documentToken,
    content = $("dialog-content"),
    originalContent = content.firstChild,
    dialog = $("dialog"),
    originalOpen = dialog.open;
  spriteImportController = controller;
  const changed = () => {
    if (editor._documentToken !== source) {
      controller.abort();
      spritePlacementDialog?.cancel();
    }
  };
  editor.addEventListener("change", changed);
  try {
    const sprite = await imageFileToFigure(file, { signal: controller.signal });
    if (
      controller.signal.aborted ||
      editor._documentToken !== source ||
      content.firstChild !== originalContent ||
      dialog.open !== originalOpen
    )
      return false;
    spritePlacementDialog ??= new SpritePlacementDialog({ dialog, content });
    const figure = await spritePlacementDialog.open(sprite);
    if (
      !figure ||
      controller.signal.aborted ||
      editor._documentToken !== source
    )
      return false;
    state.spritePlacement = {
      document: source,
      figure,
      image: imageFor(assetUrl(figure.image_assets[0])),
      point: null,
      hover: null,
      previousHint: $("viewport-hint").textContent,
    };
    viewport.classList.add("sprite-placement");
    $("viewport-hint").textContent =
      "Choose an attachment joint · Esc to cancel";
    viewport.focus({ preventScroll: true });
    requestRender();
    return true;
  } catch (error) {
    if (error.name === "AbortError") return false;
    throw error;
  } finally {
    editor.removeEventListener("change", changed);
    if (spriteImportController === controller) spriteImportController = null;
  }
}
async function importMediaFile(
  file,
  { background = false, isCurrent = () => true } = {},
) {
  finishCurrentEdit();
  const destination = editor.report,
    controller = new AbortController();
  const changed = () => {
    if (editor.report !== destination) controller.abort();
  };
  editor.addEventListener("change", changed);
  status("Importing image…", false, true);
  try {
    const media = await (
      background ? imageFileToBackground : imageFileToFigure
    )(file, { signal: controller.signal });
    if (
      controller.signal.aborted ||
      editor.report !== destination ||
      !isCurrent()
    )
      return false;
    finishCurrentEdit();
    if (editor.report !== destination) return false;
    if (background) editor.importBackground(media);
    else editor.importFigure(media);
    status(`Imported ${file.name}`);
    return true;
  } catch (error) {
    if (error.name === "AbortError") return false;
    throw error;
  } finally {
    editor.removeEventListener("change", changed);
  }
}
async function chooseSticknodesFile(file,isCurrent=()=>true) {
  const onProgress=p=>{if(isCurrent())status(`${p.phase || 'Importing'}…`,false,true);};
  let result=await importer.importFile(file,{onProgress});
  if(!isCurrent())return null;
  if(result.kind==='sticknodes-archive'){
    const index=await new Promise(resolve=>{
      showDialog('Choose a Stick Nodes asset',`<p>This pack contains ${result.entries.length} assets.</p><select id="sticknodes-archive-entry" style="width:100%" size="12">${result.entries.map(e=>`<option value="${e.index}">${esc(e.name)}</option>`).join('')}</select><div class="dialog-actions"><button id="sticknodes-archive-open" class="primary">Import selected asset</button></div>`);
      const dialog=$('dialog'),select=$('sticknodes-archive-entry');select.selectedIndex=0;
      const cancel=()=>{dialog.removeEventListener('close',cancel);resolve(null);};
      dialog.addEventListener('close',cancel,{once:true});
      $('sticknodes-archive-open').onclick=()=>{const index=Number(select.value);dialog.removeEventListener('close',cancel);dialog.close();resolve(index);};
    });
    if(index===null||!isCurrent())return null;
    result=await importer.importFile(file,{entryIndex:index,onProgress});
  }
  return isCurrent()?result:null;
}
async function importFiles(files) {
  telemetry.performance.resources('before_open');
  const started = performance.now(); telemetry.count('import_started');
  try {
    const result = await importFilesTracked(files);
    if(result!==false){telemetry.performance.closedAt=null;telemetry.performance.resources('opened');}
    telemetry.count(result === false ? 'import_cancelled' : 'import_succeeded');
    if (result !== false) telemetry.timing('import_ms', performance.now() - started);
    return result;
  } catch (error) { telemetry.count(error.name === 'AbortError' ? 'import_cancelled' : 'import_failed'); telemetry.error(error, 'import'); throw error; }
}
function recordImportKind(filename = '') {
  const extension = filename.split('.').at(-1)?.toLowerCase();
  telemetry.count(['piv', 'stk'].includes(extension) ? 'import_pivot' : ['nodes', 'nodemc', 'stknds', 'zip'].includes(extension) ? 'import_sticknodes' : ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(extension) ? 'import_media' : 'import_native');
}
async function importFilesTracked(files) {
  finishCurrentEdit();
  const seq = ++importSequence;
  importer.cancelPending();
  state.importing = true;
  status("Importing…", false, true);
  try {
    for (const file of files) {
      recordImportKind(file.name);
      const started = performance.now(), context = telemetry.consent.diagnostics ? workload({ format: file.name, bytes: file.size }) : {};
      let outcome = 'succeeded';
      try {
      if (/\.(png|jpe?g|gif|bmp|webp)$/i.test(file.name)) {
        if (
          !(await importMediaFile(file, {
            isCurrent: () => seq === importSequence,
          }))
        ) { outcome = 'cancelled'; return false; }
        continue;
      }
      const result = await chooseSticknodesFile(file,()=>seq===importSequence);
      if (!result || seq !== importSequence) { outcome = 'cancelled'; return false; }
      if (telemetry.consent.diagnostics) context.complexity = documentComplexity(result.document);
      telemetry.operation({ ...context, operation: 'import', stage: 'decode', outcome: 'succeeded' }, result.timings?.decode_ms);
      telemetry.performance.record('decode',result.timings?.decode_ms);
      if(await acceptImport(result, file.name)===false){outcome='cancelled';return false;}
      telemetry.timing('import_decode_ms', result.timings?.decode_ms);
      } catch (error) {
        outcome = error.name === 'AbortError' ? 'cancelled' : 'failed';
        if (outcome === 'failed') telemetry.error(error, 'import', { ...context, stage: 'decode' });
        throw error;
      } finally { telemetry.operation({ ...context, operation: 'import', stage: 'complete', outcome }, performance.now() - started); }
    }
  } catch(error) {
    if(error.name!=="AbortError")throw error;
    return false;
  } finally {
    if(seq===importSequence)state.importing = false;
  }
}
async function openFile() {
  pause();
  if (desktop) {
    status("Opening file…", false, true);
    const result = await desktop.openFile();
    if (result) await acceptNativeFile(result);
    else status("Ready");
  } else {
    $("file-input").value = "";
    $("file-input").click();
  }
}
async function acceptNativeFile(result) {
  const started = performance.now(); telemetry.count('import_started'); recordImportKind(result.filename);
  const context = telemetry.consent.diagnostics ? workload({ format: result.filename, bytes: result.bytes?.byteLength }) : {};
  try {
    const accepted = await acceptNativeFileTracked(result);
    if (telemetry.consent.diagnostics && accepted !== false) context.complexity = documentComplexity(editor.report);
    telemetry.operation({ ...context, operation: 'import', stage: 'complete', outcome: accepted === false ? 'cancelled' : 'succeeded' }, performance.now() - started);
    telemetry.count(accepted === false ? 'import_cancelled' : 'import_succeeded');
    if (accepted !== false) telemetry.timing('import_ms', performance.now() - started);
    if (accepted !== false) {
      telemetry.timing('import_decode_ms', state.lastImport?.decode_ms);
      telemetry.operation({ ...context, operation: 'import', stage: 'decode', outcome: 'succeeded' }, state.lastImport?.decode_ms);
    }
    return accepted;
  } catch (error) {
    telemetry.count(error.name === 'AbortError' ? 'import_cancelled' : 'import_failed');
    telemetry.operation({ ...context, operation: 'import', stage: 'complete', outcome: error.name === 'AbortError' ? 'cancelled' : 'failed' }, performance.now() - started);
    if (error.name !== 'AbortError') telemetry.error(error, 'import', { ...context, stage: 'decode' }); throw error;
  }
}
async function acceptNativeFileTracked(result) {
  pause();
  const decoded = result.bytes
    ? await chooseSticknodesFile(new File([result.bytes], result.filename))
    : result;
  if(!decoded)return false;
  decoded.timings = { ...decoded.timings, ...result.timings };
  return acceptImport(decoded, result.filename, {
    openToken: result.openToken,
  });
}
async function openSample(path) {
  pause();
  status("Decoding Pivot file…", false, true);
  await acceptImport(await importer.openSample(path));
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
async function saveNative({ saveAs = false } = {}) {
  finishCurrentEdit();await drawingController?.barrier();
  while(editor._movieclipScopes?.length){await drawingBarrier(editor.report);editor.leaveMovieclip();}
  interruptRecovery();
  status("Saving project…", false, true);
  const revision = editor.revision,
    draftRevision = editor.frameDraftRevision,
    report = editor.report,
    documentToken = state.documentToken,
    name = editor.name;
  let saved;
  try {
    saved = await runDocumentExport("styk", (blob, signal) =>
      desktop?.beginProjectWrite
        ? writeNativeBlob(desktop, blob, {
            signal,
            documentToken,
            saveAs,
            defaultPath: `${name || "Untitled"}.styk`,
            filters: [{ name: "StykAnimate project", extensions: ["styk"] }],
          })
        : saveBlob(blob, `${name || "Untitled"}.styk`, signal),
    );
  } catch (error) {
    if (error.name === "AbortError") {
      status("Save cancelled");
      return false;
    }
    throw error;
  }
  if (saved) {
    if (editor.report === report && state.documentToken === documentToken) {
      if (
        editor.revision === revision &&
        editor.frameDraftRevision === draftRevision
      ) {
        editor.markSaved();
        if (desktop?.deleteRecovery) await desktop.deleteRecovery();
      }
    }
    updateTitle();
    status(
      editor.dirty ? "Saved copy · Newer changes are unsaved" : "Project saved",
    );
  } else status("Save cancelled");
  return Boolean(
    saved &&
      editor.report === report &&
      state.documentToken === documentToken &&
      editor.revision === revision &&
      editor.frameDraftRevision === draftRevision &&
      !editor.dirty,
  );
}
async function exportPivot(format = "piv") {
  finishCurrentEdit();
  interruptRecovery();
  status(`Writing .${format}…`, false, true);
  const filename = `${["stk", "stkz", "stykmov"].includes(format) ? nameOf(editor.object) : editor.name || "Untitled"}.${format}`;
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
function exportOptions({ animation = true } = {}) {
  const number = (id, fallback) => ($(id) ? Number($(id).value) : fallback);
  const options = {
    width: number("export-width", editor.report.canvas_width),
    height: number("export-height", editor.report.canvas_height),
    start: number("export-start", 1) - 1,
    end: number("export-end", editor.totalTicks),
    quality: $("export-quality")?.closest('label').hidden ? 0.94 : number("export-quality", 94) / 100,
    dither: $("export-gif-dither")?.checked ?? defaultGIFDither(editor.report),
    smoothing: normalizeExportSmoothing(
      $("export-smoothing")?.value || "edges",
    ),
  };
  if (
    !Number.isInteger(options.width) ||
    !Number.isInteger(options.height) ||
    options.width < 1 ||
    options.height < 1 ||
    options.width > 16384 ||
    options.height > 16384 ||
    options.width * options.height > EXPORT_MAX_PIXELS
  )
    throw new Error(
      `Export size must be whole pixels, up to ${Math.round(EXPORT_MAX_PIXELS / 1e6)} million pixels per frame.`,
    );
  if (
    animation &&
    (!Number.isInteger(options.start) ||
      !Number.isInteger(options.end) ||
      options.start < 0 ||
      options.start >= options.end ||
      options.end > editor.totalTicks)
  )
    throw new Error("Choose a valid export frame range.");
  if (
    !Number.isFinite(options.quality) ||
    options.quality < 0.01 ||
    options.quality > 1
  )
    throw new Error("Quality must be between 1 and 100 percent.");
  return options;
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
    throw error;
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
  const options = exportOptions({ animation: false }),
    frame = currentFrame(),
    filename = `${editor.name}-frame-${editor.tick + 1}.png`;
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
  const options = {
      ...exportOptions({ animation: false }),
      smoothing: "edges",
    },
    frame = currentFrame(),
    filename = `${editor.name}-frame-${editor.tick + 1}.svg`;
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
  const options = exportOptions(),
    report =
      state.settings.timelineMode === "simple"
        ? materializeSimpleFrameDraftForPivot(editor.report)
        : editor.report,
    ticks = options.end - options.start,
    fps = report.frame_delay_ms ? 1000 / report.frame_delay_ms : report.fps,
    extension = format.endsWith("sequence")
      ? "zip"
      : format === "apng"
        ? "png"
        : "gif",
    filename = `${editor.name}${format.endsWith("sequence") ? "-" + format : ""}.${extension}`,
    loop = state.loop;
  if (format === "svg-sequence") options.smoothing = "edges";
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
          format,
          width: options.width,
          height: options.height,
          quality: options.quality,
          dither: options.dither,
          fps,
          totalFrames: ticks,
          loop,
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
  const vfw = format === "vfw" ? vfwExportControls.getOptions() : null;
  const codec = $(`export-${format}-codec`)?.value || undefined;
  const nativeWebm =
    format === "webm" &&
    document.querySelector('[data-action="export-video"]')?.dataset.provider ===
      "FFmpeg";
  const options = exportOptions(),
    report =
      state.settings.timelineMode === "simple"
        ? materializeSimpleFrameDraftForPivot(editor.report)
        : editor.report,
    ticks = options.end - options.start,
    fps = report.frame_delay_ms ? 1000 / report.frame_delay_ms : report.fps,
    extension = format === "vfw" ? "avi" : format,
    filename = `${editor.name}.${extension}`;
  const videoQuality = format === 'vfw' ? {} : videoQualityOptions({
    width: options.width, height: options.height, fps,
    preset: $('export-video-quality')?.value || 'recommended',
    provider: format === 'webm' && !nativeWebm ? 'WebCodecs' : 'FFmpeg',
    mode: $('export-bitrate-mode')?.value || 'auto',
    manualMbps: $('export-video-bitrate')?.value,
    lossless: format === 'avi' && ['ffv1', 'rawvideo'].includes(codec),
  });
  const encode =
    format === "vfw"
      ? encodeVfwVideo
      : format === "webm" && !nativeWebm
        ? encodeWebM
        : encodeNativeVideo;
  const includeAudio = ($('export-audio')?.checked ?? true) && audibleClips(audioState(report)).some(clip => clip.start < options.end / fps && clip.start + clip.duration > options.start / fps);
  if (includeAudio && encode !== encodeNativeVideo) throw new Error('Audio export requires a desktop FFmpeg video format. Choose MP4, WebM, AVI or WMV with FFmpeg, or turn off Include audio for a silent export.');
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
          format,
          codec,
          desktop,
          ...videoQuality,
          ...vfw,
          width: options.width,
          height: options.height,
          fps,
          totalFrames: ticks,
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
function showDialog(title, body) {
  $("dialog-content").innerHTML =
    `<div class="dialog-head"><h2>${esc(title)}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon("close")}</button></div><div class="dialog-body">${body}</div>`;
  if (!$("dialog").open) $("dialog").showModal();
}
let textDialog;
let segmentValuesDialog;
function showSegmentValues({ hover = false } = {}) {
  finishKeyboardHandle();
  pause();
  cancelDrag();
  if (hover && state.hoverCameraHandle) {
    selectTrack({ id: "camera", kind: "camera" });
    requestAnimationFrame(() =>
      $("inspector").querySelector('[data-field="camera_x"]')?.focus(),
    );
    return;
  }
  const handle = hover ? state.hoverHandle : null;
  if (handle) editor.select(handle.uid, handle.joint);
  if (editor.selectedJoint < 0 || editor.selectedUid == null) return;
  segmentValuesDialog ??= new SegmentValuesDialog({
    dialog: $("dialog"),
    content: $("dialog-content"),
    editor,
    clipboard:
      desktop?.readClipboardText && desktop?.writeClipboardText
        ? {
            readText: () => desktop.readClipboardText(),
            writeText: (text) => desktop.writeClipboardText(text),
          }
        : navigator.clipboard,
    onClose: queueUI,
    onError: fail,
  });
  segmentValuesDialog.open({
    editMode: state.handleEditHeld,
    isolate: Boolean(state.isolateHeld || state.isolateMode),
  });
}
function showTextDialog(editExisting = false) {
  pause();
  const report = editor.report,
    figure = editExisting ? editor.figure : null,
    typeId = figure?.figure_type_id;
  textDialog ??= new TextDialog({
    dialog: $("dialog"),
    content: $("dialog-content"),
    fontService:
      desktop?.listFonts && desktop?.readFont
        ? { listFonts: desktop.listFonts, readFont: desktop.readFont }
        : undefined,
  });
  const segment = figure?.segments?.[editor.selectedJoint];
  const initialOptions =
    segment?.primitive_code === 5
      ? { assetIndex: segment.extra_u16 ?? segment.extra?.[0] ?? 0 }
      : undefined;
  textDialog.open({
    figure,
    initialOptions,
    onApply: async (definition) => {
      if (editor.report !== report)
        throw new Error("The document changed. Open the text editor again.");
      if (editExisting)
        editor.replaceFigureDefinition(typeId, definition, {
          label: "Edit text",
        });
      else editor.importFigure(definition);
      status(editExisting ? "Text updated" : "Text added");
    },
  });
}
let backgroundDialog;
function showBackgroundDialog() {
  pause();
  backgroundDialog ??= new BackgroundDialog({
    dialog: $("dialog"),
    content: $("dialog-content"),
    resources,
    onError: fail,
  });
  const options = {
      indices: rangeFrames(),
    },
    report = editor.report;
  const apply = (operation) => {
    if (editor.report !== report)
      throw new Error("The document changed. Open background settings again.");
    return operation();
  };
  backgroundDialog.open({
    report: editor.report,
    frame: currentFrame(),
    onUse: (id) => apply(() => editor.setSceneBackground(id, options)),
    onCreate: (asset) =>
      apply(() => editor.importSceneBackground(asset, options)),
    onRename: (id, name) => apply(() => editor.renameSceneBackground(id, name)),
  });
}
function closeDialog() {
  $("dialog").close();
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
    `<button class="export-option" data-action="export-vfw" disabled>${icon("play")}<span><strong>Windows AVI</strong><small>Installed video codecs</small></span></button>`,
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
      `<button class="export-option" data-action="export-${id}" ${id.endsWith("sequence") ? "" : "disabled"}>${icon(id.endsWith("sequence") ? "duplicate" : "play")}<span><strong>${label}</strong><small>${note}</small></span></button>`,
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
    totalFrames: editor.totalTicks, currentFrame: editor.tick + 1,
    fps: editor.report.frame_delay_ms ? 1000 / editor.report.frame_delay_ms : editor.report.fps});
}

function showHelp() { editorSettings?.open("shortcuts"); }
function showPerformance() {
  const presentation = playbackMetrics.snapshot(performance.now());
  const sorted = [...state.renderSamples].sort((a, b) => a - b),
    p = (n) =>
      sorted[
        Math.min(sorted.length - 1, Math.floor(sorted.length * n))
      ]?.toFixed(2) || "—";
  showDialog(
    "Performance",
    `<table class="metric-table">${[
      ["Renderer", state.renderer?.stats?.backend || "Initializing"],
      ["Playback FPS / target", presentation.fps === null ? "—"
        : `${presentation.fps.toFixed(1)} / ${presentation.targetFps.toFixed(1)}`],
      ["Playback startup", presentation.startupMs === null ? "—" : `${presentation.startupMs.toFixed(1)} ms`],
      ["Playback buffering", `${presentation.bufferingMs.toFixed(1)} ms · ${presentation.bufferingEvents} waits`],
      ["Recent CPU frame p50", `${p(0.5)} ms`],
      ["Recent CPU frame p95", `${p(0.95)} ms`],
      ["Recent CPU frame p99", `${p(0.99)} ms`],
      ["Measured frames", sorted.length],
      ["Current scene figures", editor.frame.objects.length.toLocaleString()],
      [
        "Current scene segments",
        editor.frame.objects
          .reduce(
            (n, o) =>
              n +
              (editor.report.figure_types.find(
                (f) => f.figure_type_id === o.figure_type_id,
              )?.segments.length || 0),
            0,
          )
          .toLocaleString(),
      ],
      [
        "Import decode",
        state.lastImport?.decode_ms !== undefined
          ? `${state.lastImport.decode_ms.toFixed(1)} ms`
          : "—",
      ],
    ]
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
      .join(
        "",
      )}</table><p>CPU submission timings include geometry evaluation and selection overlays. They do not measure GPU completion or input-to-display latency. Performance varies with hardware, scene complexity, effects, and media.</p>`,
  );
}
function openAppMenu(anchor) {
  showCommandMenu(applicationMenuItems(anchor.dataset.appMenu, editor, desktop), anchor);
}
const menuButtons = [...document.querySelectorAll('[data-app-menu]')];
menuButtons.forEach((button, index) => {
  button.tabIndex = index === 0 ? 0 : -1;
  button.addEventListener('focus', () => menuButtons.forEach(item => { item.tabIndex = item === button ? 0 : -1; }));
  button.addEventListener('pointerenter', () => {
    if (!$('menu').hidden && menuButtons.some(item => item.getAttribute('aria-expanded') === 'true')) openAppMenu(button);
  });
  button.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      menuButtons[(index + (event.key === 'ArrowRight' ? 1 : -1) + menuButtons.length) % menuButtons.length].focus();
    } else if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); openAppMenu(button); }
  });
});
new MutationObserver(() => {
  if ($('menu').hidden) menuButtons.forEach(button => button.setAttribute('aria-expanded', 'false'));
}).observe($('menu'), {attributes: true, attributeFilter: ['hidden']});
function showMenu(anchor) {
  const items = [
    ["new", "plus", "New animation", "Ctrl N"],
    ["open", "folder", "Open project…", "Ctrl O"],
    ["open-recent", "clock", "Open recent…", "", !desktop?.listRecentFiles],
    ["save", "save", "Save", "Ctrl S"],
    ["save-as", "save", "Save as…", "Ctrl Shift S"],
    null,
    ["undo", "undo", "Undo", "Ctrl Z"],
    ["redo", "redo", "Redo", "Ctrl Shift Z"],
    null,
    ["import", "import", "Import figures…", ""],
    ["import-sprite", "frame", "Import sprite image…", ""],
    ["import-background", "frame", "Import background image…", ""],
    ["add-text", "text", "Create text…", "T"],
    ["export", "export", "Export…", ""],
    null,
    ["settings", "settings", "Settings…", "Ctrl ,"],
    ["help", "help", "Keyboard shortcuts", "?"],
    ["performance", "activity", "Performance", ""],
  ];
  showCommandMenu(items, anchor);
}
function showCommandMenu(items, anchor) {
  menuButtons.forEach(button => button.setAttribute('aria-expanded', String(button === anchor)));
  $('menu')._anchor = anchor;
  $("menu").innerHTML = items
    .map((i) =>
      i
        ? `<button class="menu-item" role="menuitem" data-action="${i[0]}" ${i[4] ? "disabled" : ""}>${icon(i[1])}<span>${i[2]}</span><kbd>${i[3] || ""}</kbd></button>`
        : '<div class="menu-separator"></div>',
    )
    .join("");
  appLocalization?.applyMenu($("menu"));
  refreshHotkeyHints(hotkeys, $("menu"));
  const r = anchor.getBoundingClientRect?.() || anchor;
  $("menu").hidden = false;
  const bounds = $("menu").getBoundingClientRect();
  $("menu").style.left =
    `${Math.max(8, Math.min(r.left, innerWidth - bounds.width - 8))}px`;
  $("menu").style.top =
    `${Math.max(8, Math.min(r.bottom + 5, innerHeight - bounds.height - 8))}px`;
  $("menu")
    .querySelector("button:not(:disabled)")
    ?.focus({ preventScroll: true });
}
$("menu").addEventListener("keydown", (e) => {
  const buttons = [...$("menu").querySelectorAll("button:not(:disabled)")],
    index = buttons.indexOf(document.activeElement);
  let next;
  if (e.key === "ArrowDown") next = (index + 1) % buttons.length;
  else if (e.key === "ArrowUp")
    next = (index + buttons.length - 1) % buttons.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = buttons.length - 1;
  else if (e.key === "Escape") {
    $("menu").hidden = true;
    ($("menu")._anchor?.focus ? $("menu")._anchor : viewport).focus({ preventScroll: true });
  } else if (["ArrowLeft", "ArrowRight"].includes(e.key) && menuButtons.includes($("menu")._anchor)) {
    const index = menuButtons.indexOf($("menu")._anchor);
    openAppMenu(menuButtons[(index + (e.key === "ArrowRight" ? 1 : -1) + menuButtons.length) % menuButtons.length]);
  } else if (e.key === " " || e.key === "Enter") {
    e.stopPropagation();
    return;
  } else return;
  e.preventDefault();
  e.stopPropagation();
  buttons[next]?.focus({ preventScroll: true });
});
function showZoomMenu(anchor) {
  showCommandMenu(
    [
      ["zoom-in", "plus", "Zoom in", "+"],
      ["zoom-out", "minus", "Zoom out", "−"],
      null,
      ["zoom-reset", "frame", "Fit canvas", "Shift 1"],
      ["zoom-selection", "center", "Fit selection", "Shift 2", !editor.object],
      null,
      ...[25, 50, 100, 200].map((n) => ["zoom-" + n, "zoom", n + "%", ""]),
    ],
    anchor,
  );
}
overlay.addEventListener(
  "contextmenu",
  guarded((e) => {
    e.preventDefault();
    if (state.drag?.kind === 'tweener') {cancelDrag();state.suppressContext=false;return;}
    if (state.suppressContext) {
      state.suppressContext = false;
      return;
    }
    if(construction?.active) {showCommandMenu([["chain-finish","check","Finish chain","Enter"],["chain-cancel","close","Cancel chain","Esc"]],{left:e.clientX,bottom:e.clientY});return;}
    pause();
    const hit = pick(worldPoint(e));
    if (builderMode?.active) {
      const fill = !hit && pickFigureFill(editor.geometry.objects.get(editor.selectedSlot),worldPoint(e));
      if(fill)editor.selectPolygon(editor.selectedUid,fill.index);
      return builderMode.showContextMenu({hit,entry:fill?{kind:'polygon',index:fill.index}:undefined,x:e.clientX,y:e.clientY});
    }
    if (hit && !isSelected(hit.g.obj.unique_id))
      editor.select(hit.g.obj.unique_id, hit.joint);
    if (hit && selection().size <= 1)
      editor.select(hit.g.obj.unique_id, hit.joint);
    const items = !hit ? [
      ["paste", "clipboard", "Paste", "Ctrl V"],
      ["paste-in-place", "clipboard", "Paste in place", "Ctrl Shift V"],
      ["paste-instance", "clipboard", "Paste instance"],
      ["paste-unique", "duplicate", "Paste unique copy"],
      ["select-all", "cursor", "Select all", "Ctrl A"],
      null,
      ["scene-settings", "frame", "Scene properties…"],
      ["zoom-reset", "frame", "Fit canvas", "Shift 1"],
    ] : [
      ["copy", "duplicate", "Copy", "Ctrl C"],
      ["paste", "clipboard", "Paste", "Ctrl V"],
      ["paste-in-place", "clipboard", "Paste in place", "Ctrl Shift V"],
      ["paste-instance", "clipboard", "Paste instance"],
      ["paste-unique", "duplicate", "Paste unique copy"],
      ["duplicate", "duplicate", "Duplicate", "Ctrl D"],
      null,
      ["mirror", "flip", "Flip horizontal", "Shift H"],
      ["mirror-vertical", "flip-vertical", "Flip vertical", "Shift V"],
      joinMenuItem(),
      null,
      ...(hit.joint >= 0 && !editor.figure?._styk?.movieclip && selection().size <= 1 ? [["segment-values", "sliders", "Segment values…", "I"]] : []),
      ["selection-more", "sliders", "More figure actions…"],
      ["delete", "trash", "Delete", "Delete"],
      ...(!builderMode?.active && !editor.figure?._styk?.movieclip ? [
        null,
        ["edit-in-build-mode", "nodes", "Edit in build mode", "", selection().size !== 1],
      ] : []),
    ];
    showCommandMenu(items, { left: e.clientX, bottom: e.clientY });
  }),
);
const rigHost=()=>({editor,showDialog,closeDialog,resources,finish:()=>{pause();finishCurrentEdit();},builderActive:()=>Boolean(builderMode?.active),
  addToAnimate:document=>{
    pause();finishCurrentEdit();
    const layer=editor.getLayer(editor.activeLayerId);
    if(layer?.locked)throw new Error('Unlock the destination layer before adding an asset.');
    if(layer?.visible===false)throw new Error('Choose a visible destination layer before adding an asset.');
    builderMode?.keepChangesAndLeave();
    const object=editor.importFigure(document),figure=editor.figure;
    const control=figure._styk?.rigExample?.control;
    setTool('select');state.inspectorContext='figure';
    editor.select(object.unique_id,figure.segments.findIndex(s=>s.segment_id===control));
    window.styk?.library?.showView('properties');
    fitSelection();queueUI();
    toast(`${figure.name} added to Animate.`);
    return object;
  }});
const beginRigAnchorPick=key=>{
  const s=editor.figure?.segments[editor.selectedJoint];if(!editor.figure||(!s&&key))return toast('Select a joint first.');
  const ids=[...editor.selectedSegmentIds];
  if(!key&&ids.length===2){editor.addConnector(ids[0],ids[1]);toast('Connector added. Drag its middle joint to slide.');return;}
  setTool('rig');state.rigAnchorPick={key,start:s?.segment_id??0,uid:editor.selectedUid,token:editor._documentToken};
  toast(key==='driver'?'Click a Smart Stretch joint on this figure. Escape cancels.':key?'Click the new anchor on this figure. Escape cancels.':'Click the second joint to create a connector. Escape cancels.');
};
function pasteFigures(pasteMode = 'default', offset) {
  if (builderMode?.active) return toast("Finish the figure or return to Animate to paste.");
  return sharedClipboard.paste('figures', () => {
    finishCurrentEdit();
    const options = {pasteMode, offset};
    if (editor._selectionClipboard?.freshTypes?.size) return editor.pasteSelection(options);
    if (rangeFrames()) return editor.pasteFiguresInFrames(rangeFrames(), options);
    return editor.pasteSelection(options);
  });
}
function selectedFigureJoinAction() {
  const action = figureJoinAction(editor);
  return action && !builderMode?.active && !isHidden(action.uid) && !isLocked(action.uid) ? action : null;
}
function joinMenuItem() {
  const action = selectedFigureJoinAction();
  return ['join-figure', action?.kind === 'unjoin' ? 'detach' : 'link',
    state.figureJoin ? 'Cancel joining' : action?.kind === 'unjoin' ? 'Unjoin figure' : 'Join figure…',
    '', !action];
}
function toggleFigureJoin() {
  if (state.figureJoin) {setTool('select'); return;}
  pause(); finishCurrentEdit();
  const action = selectedFigureJoinAction();
  if (!action) return;
  const indices = rangeFrames();
  if (action.kind === 'unjoin') {
    editor.detachFiguresInFrames(indices, {uids: [action.uid], atPlayhead: !indices});
    status('Figure unjoined');
    return;
  }
  const targets = joinTargetUids(editor.selectionFrame, action.uid);
  for (const uid of targets) if (isHidden(uid) || isLocked(uid)) targets.delete(uid);
  if (!targets.size) {toast('Add or unlock another figure to join to.'); return;}
  state.figureJoin = {uid: action.uid, token: editor._documentToken, tick: editor.tick,
    frameIndex: editor.frameIndex, revision: editor.revision, indices, targets};
  setTool('attach');
  viewport.focus({preventScroll: true});
}
const actions = {
  'join-figure': toggleFigureJoin,
  'rig-connect':()=>beginRigAnchorPick(),
  'rig-pick-start':()=>beginRigAnchorPick('start'),
  'rig-pick-end':()=>beginRigAnchorPick('end'),
  'rig-pick-driver':()=>beginRigAnchorPick('driver'),
  'rig-bind-branch':()=>editor.bindStretchParts(editor.figure.segments[editor.selectedJoint].segment_id,{branch:true}),
  'rig-test':()=>openRigTest(rigHost()),
  'rig-examples':()=>openRigExamples(rigHost()),
  "edit-in-build-mode": () => {
    if (editor.object && selection().size === 1 && !editor.figure?._styk?.movieclip)
      builderMode?.enter();
  },
  "selection-more": () => showCommandMenu([
    ["add-to-library", "plus", "Add to library"],
    ["select-same", "person", "Select same figure"],
    ["select-invert", "cursor", "Invert selection"],
    null,
    joinMenuItem(),
    null,
    ["locate-previous", "chevron-left", "Match previous pose", "L"],
    ["locate-next", "chevron-right", "Match next pose", "Shift L"],
    ["zoom-selection", "center", "Fit selection", "Shift 2"],
  ], $('menu')._anchor || viewport),
  "open-recent": async () => {
    pause();
    const entries = await desktop.listRecentFiles();
    showDialog(
      "Recent files",
      `<div class="recent-files">${entries.length ? entries.map((entry) => `<button type="button" class="recent-file" data-recent-id="${esc(entry.id)}" ${entry.missing ? "disabled" : ""}><strong>${esc(entry.name)}</strong><small>${esc(entry.directory)}${entry.missing ? " · Unavailable" : ""}</small></button>`).join("") : "<p>No recent files.</p>"}</div>${entries.length ? '<div class="dialog-actions"><button class="button" id="clear-recent">Clear history</button></div>' : ""}`,
    );
    $("dialog-content")
      .querySelectorAll("[data-recent-id]")
      .forEach(
        (button) =>
          (button.onclick = guarded(async () => {
            const result = await desktop.openRecentFile(
              button.dataset.recentId,
            );
            closeDialog();
            await acceptNativeFile(result);
          })),
      );
    if ($("clear-recent"))
      $("clear-recent").onclick = guarded(async () => {
        await desktop.clearRecentFiles();
        await actions["open-recent"]();
      });
  },
  "segment-values": () => showSegmentValues(),
  menu: (e) =>
    showMenu(e?.closest?.("button") || document.querySelector(".brand")),
  open: openFile,
  'new-window': () => desktop?.newWindow(),
  import: () => {
    if (builderMode?.active) return toast("Finish the figure or return to Animate to import figures.");
    $("file-input").value = "";
    $("file-input").click();
  },
  save: () => saveNative(),
  "save-as": () => saveNative({ saveAs: true }),
  'check-updates': () => updateNotice?.check(),
  'release-notes': () => releaseSplash.open(),
  donate: () => desktop?.openDonate(),
  'restart-update': async () => {
    finishCurrentEdit();
    await workspaceLayout?.flushPreferences();
    await editorSettings?.flush();
    await nativeFrameClipboard?.flush();
    await desktop?.setDocumentState({ name: editor.name, dirty: editor.dirty, revision: `${state.documentToken}:${editor.revision}:${editor.frameDraftRevision}` });
    await desktop?.restartForUpdate();
  },
  'save-and-update': async () => { if (await saveNative()) await actions['restart-update'](); },
  "save-and-close": async () => {
    if (await saveNative()) {
      await workspaceLayout?.flushPreferences();
      await editorSettings?.flush();
      await nativeFrameClipboard?.flush();
      await desktop?.setDocumentState({ name: editor.name, dirty: false });
      await desktop?.close();
    }
  },
  export: showExport,
  "export-piv": () => exportPivot(),
  "export-stk": () => exportPivot("stk"),
  "export-stkz": () => exportPivot(isMovieclip(editor.figure)?"stykmov":"stkz"),
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
  new: async () => {
    if (await confirmReplace()) {
      pause();
      editor.newDocument();
      telemetry.performance.resources('closed');telemetry.performance.closedAt=performance.now();
      if (desktop?.activateDocument)
        state.documentToken = (
          await desktop.activateDocument({})
        ).documentToken;
      state.sourceId = null;
      fit();
    }
  },
  rename: () => {
    showDialog(
      "Name your project",
      `<input id="rename-input" aria-label="Project name" value="${esc(editor.name)}" maxlength="120"><div class="dialog-actions"><button class="button primary" id="rename-submit">Save name</button></div>`,
    );
    $("rename-submit").onclick = () => {
      editor.name = $("rename-input").value.trim() || "Untitled";
      editor.dirty = true;
      updateTitle();
      closeDialog();
    };
  },
  undo: () => {
    pause();
    if (state.polygon) {
      state.polygon.draft.undo();
      refreshPolygonDraft();
      return;
    }
    if (cameraMotionControls?.active) propertyControls?.cancel();
    cameraMotionControls?.cancel();
    vfxInspector?.finishForHistory();
    vfxGizmos?.up();
    editor.undo();
  },
  redo: () => {
    pause();
    if (state.polygon) {
      state.polygon.draft.redo();
      refreshPolygonDraft();
      return;
    }
    if (cameraMotionControls?.active) propertyControls?.cancel();
    cameraMotionControls?.cancel();
    vfxInspector?.finishForHistory();
    vfxGizmos?.up();
    editor.redo();
  },
  play: play,
  "first-frame": () => {
    pause();
    if (state.settings.timelineMode === "simple")
      return timelineUI.selectFrame(0);
    editor.seek(0);
  },
  "previous-frame": () => {
    pause();
    if (state.settings.timelineMode === "simple")
      return timelineUI.selectFrame(Math.max(0, timelineUI.selectedIndex - 1));
    editor.seek(Math.max(0, editor.tick - 1));
  },
  "next-frame": () => {
    pause();
    if (state.settings.timelineMode === "simple")
      return timelineUI.selectFrame(
        Math.min(timelineUI.frameCount - 1, timelineUI.selectedIndex + 1),
      );
    editor.seek(Math.min(editor.totalTicks - 1, editor.tick + 1));
  },
  "last-frame": () => {
    pause();
    if (state.settings.timelineMode === "simple")
      return timelineUI.selectFrame(timelineUI.frameCount - 1);
    editor.seek(Math.max(0, editor.totalTicks - 1));
  },
  "previous-keyframe": () => { pause(); runTimelineHotkey(timelineUI, 'previous-keyframe'); },
  "next-keyframe": () => { pause(); runTimelineHotkey(timelineUI, 'next-keyframe'); },
  "add-frame": () => {
    pause();finishCurrentEdit();
    if(editor.getLayer(editor.activeLayerId)?.drawing)return editor.addDrawingFrame();
    if(editor.report._styk?.layerSheet) {
      if(state.settings.timelineMode !== 'simple')
        return timelineUI.addFrameCell();
      const result=editor.sheetDuplicateFrameAfter(['scene','camera',...editor.report._styk.layers.order]);
      timelineUI.revealPlayhead();
      return result;
    }
    return editor.addFrame();
  },
  "extend-keyframe": () => {
    pause();finishCurrentEdit();
    if(drawingController?.active)return editor.extendDrawing(timelineUI?.ids?.length?timelineUI.ids:[editor.activeLayerId],drawingController.settings.length);
    if(editor.report._styk?.layerSheet) return timelineUI.extendKeyframe();
    return editor.setFrameDuration(editor.frame.duration_raw + 1);
  },
  "delete-frame": () => {
    pause();
    if(editor.report._styk?.layerSheet)return state.settings.timelineMode === "simple"?timelineUI.action("delete"):timelineUI.removeFrames();
    editor.deleteFrame();
  },
  "add-figure": () => {
    pause();
    if (builderMode?.active) return toast("Finish the figure or return to Animate to add figures.");
    if (rangeFrames()) editor.addFigureInFrames(undefined, rangeFrames());
    else editor.addFigure();
  },
  "add-text": () => {
    if (builderMode?.active) return toast("Finish the figure or return to Animate to add text.");
    showTextDialog();
  },
  "edit-text": () => showTextDialog(true),
  "attach-figure": toggleFigureJoin,
  "detach-figure": () => {if (selectedFigureJoinAction()?.kind === 'unjoin') toggleFigureJoin();},
  "combine-figures": () => {
    const roots = editor.resolveTranslationSelection().rootUids;
    if (roots.length !== 1)
      throw new Error("Select figures in one connected group.");
    editor.combineJoinedFigure(roots[0]);
  },
  "segment-order-back": (button, event) => actions["builder-order"]({dataset: {kind: 'segment', direction: 'back'}}, event),
  "segment-order-down": (button, event) => actions["builder-order"]({dataset: {kind: 'segment', direction: 'down'}}, event),
  "segment-order-up": (button, event) => actions["builder-order"]({dataset: {kind: 'segment', direction: 'up'}}, event),
  "segment-order-front": (button, event) => actions["builder-order"]({dataset: {kind: 'segment', direction: 'front'}}, event),
  "builder-order": (button, event) => {
    finishCurrentEdit();
    return editor.moveBuilderOrder(
      {
        kind: button.dataset.kind,
        index:
          button.dataset.index === undefined
            ? undefined
            : Number(button.dataset.index),
      },
      button.dataset.direction,
      { branch: usesBuilderBranch(event) },
    );
  },
  "polygons-previous": () => {
    state.polygonPage = Math.max(0, (state.polygonPage || 0) - 1);
    renderInspector();
  },
  "palette-previous": () => { state.palettePage=Math.max(0,(state.palettePage||0)-1);renderInspector(); },
  "palette-next": () => { state.palettePage=(state.palettePage||0)+1;renderInspector(); },
  "polygons-next": () => {
    state.polygonPage = (state.polygonPage || 0) + 1;
    renderInspector();
  },
  "background-style": showBackgroundDialog,
  "finish-polygon": finishPolygon,
  "cancel-polygon": cancelPolygonDraft,
  "split-segment": (button, event) =>
    editor.splitBuilderSegments({
      branch: usesBuilderBranch(event),
      fraction: 0.5,
    }),
  "copy-builder-appearance": () => {
    if (!builderMode?.active) return;
    state.builderAppearance = copyBuilderAppearance(editor);
    builderMode.sync();
    if (state.builderAppearance) status("Appearance copied");
  },
  "paste-builder-appearance": (button, event) => {
    if (!builderMode?.active) return;
    if (pasteBuilderAppearance(editor, state.builderAppearance, {branch:usesBuilderBranch(event)})) status("Appearance pasted");
  },
  "unsplit-segment": () => editor.unsplitSegment(),
  "delete-single-segment": () => editor.selectedSegmentIds.size > 1
    ? editor.deleteSegment({handleIds:editor.selectedSegmentIds,branch:false}) : editor.deleteSingleSegment(),
  "mirror-segment": () => editor.mirrorSegment("horizontal"),
  "mirror-segment-vertical": () => editor.mirrorSegment("vertical"),
  "mirror-branch": () => editor.mirrorSegmentBranch("horizontal"),
  "mirror-branch-vertical": () => editor.mirrorSegmentBranch("vertical"),
  "origin-segment": () => editor.setOrigin(),
  "duplicate-segment": (button, event) =>
    beginDuplicatePlacement({
      branch: usesBuilderBranch(event),
      flip: Boolean(event?.ctrlKey || event?.metaKey),
    }),
  "duplicate-branch": (button, event) =>
    beginDuplicatePlacement({
      branch: true,
      flip: Boolean(event?.ctrlKey || event?.metaKey),
    }),
  "delete-segment": () => editor.deleteSegment({handleIds:editor.selectedSegmentIds}),
  duplicate: () => {
    pause();
    if (editor.branchSelected) return editor.duplicateSelection();
    if (rangeFrames()) editor.duplicateInFrames(rangeFrames());
    else if (selection().size > 1) editor.duplicateSelection();
    else editor.duplicateFigure();
  },
  delete: () => {
    pause();
    // Builder scope belongs to the workspace, including Select-tool posing.
    // Removing its instance would cause the session to recreate a default pose.
    if (builderMode?.active && editor.selectedPolygonIndex >= 0) return editor.removePolygon(editor.selectedPolygonIndex);
    if (builderMode?.active || state.tool === 'rig') {
      if (editor.selectedJoint >= 0)
        return usesBuilderBranch() ? actions['delete-segment']() : actions['delete-single-segment']();
      if (builderMode?.active) return toast('Select a segment or branch to delete.');
    }
    if (editor.branchSelected) return editor.deleteSelection();
    if (rangeFrames()) editor.deleteFiguresInFrames(rangeFrames());
    else editor.deleteSelection();
  },
  mirror: () =>
    rangeFrames()
      ? editor.mirrorFiguresInFrames("horizontal", rangeFrames())
      : editor.mirrorFigure("horizontal"),
  "mirror-vertical": () =>
    rangeFrames()
      ? editor.mirrorFiguresInFrames("vertical", rangeFrames())
      : editor.mirrorFigure("vertical"),
  rotate: () =>
    rangeFrames()
      ? editor.rotateFiguresInFrames(Math.PI / 12, rangeFrames())
      : editor.rotateFigure(Math.PI / 12),
  center: () => {
    if (rangeFrames()) return editor.centerFiguresInFrames(rangeFrames());
    if (selection().size > 1) {
      const b = selectionBounds();
      editor.moveSelection(
        editor.report.canvas_width / 2 - (b.minX + b.maxX) / 2,
        editor.report.canvas_height / 2 - (b.minY + b.maxY) / 2,
      );
    } else editor.centerFigure();
  },
  "align-left": () => alignSelection("x", "start"),
  "align-center-x": () => alignSelection("x", "center"),
  "align-right": () => alignSelection("x", "end"),
  "align-top": () => alignSelection("y", "start"),
  "align-center-y": () => alignSelection("y", "center"),
  "align-bottom": () => alignSelection("y", "end"),
  "locate-previous": () => locateHovered(-1),
  "locate-next": () => locateHovered(1),
  "reset-pose": () =>
    rangeFrames()
      ? editor.resetPoseInFrames(rangeFrames())
      : editor.resetPose?.(),
  "reset-color": () => editor.resetFigureColors({indices:rangeFrames()}),
  "selection-up": () => orderSelection(1),
  "selection-down": () => orderSelection(-1),
  "selection-front": () => orderSelection("front"),
  "selection-back": () => orderSelection("back"),
  "layer-up": () =>
    rangeFrames()
      ? editor.orderFiguresInFrames(1, rangeFrames())
      : editor.moveSelectionLayer(1),
  "layer-down": () =>
    rangeFrames()
      ? editor.orderFiguresInFrames(-1, rangeFrames())
      : editor.moveSelectionLayer(-1),
  "layer-front": () =>
    rangeFrames()
      ? editor.orderFiguresInFrames("front", rangeFrames())
      : editor.bringToFront(),
  "layer-back": () =>
    rangeFrames()
      ? editor.orderFiguresInFrames("back", rangeFrames())
      : editor.sendToBack(),
  "select-same": () =>
    editor.selectSameDefinition({
      candidates: editor.selectionFrame.objects
        .filter((o) => !isHidden(o.unique_id) && !isLocked(o.unique_id))
        .map((o) => o.unique_id),
    }),
  "select-invert": () =>
    editor.invertSelection(
      editor.selectionFrame.objects
        .filter((o) => !isHidden(o.unique_id) && !isLocked(o.unique_id))
        .map((o) => o.unique_id),
    ),
  copy: () => {
    if (document.activeElement?.closest("#timeline"))
      return timelineUI.copySelection();
    return sharedClipboard.copy('figures', () => { finishCurrentEdit(); return editor.copySelection(); });
  },
  cut: () => {
    if (document.activeElement?.closest("#timeline"))
      return timelineUI.cutSelection();
    return sharedClipboard.copy('figures', () => {
      finishCurrentEdit();
      if (editor.branchSelected) return editor.cutSelection();
      if (rangeFrames()) {
        const count = editor.copySelection();
        if (count) { editor._selectionClipboard.offset = 0; editor.deleteFiguresInFrames(rangeFrames()); }
        return count;
      }
      return editor.cutSelection();
    });
  },
  paste: () => {
    if (document.activeElement?.closest("#timeline"))
      return timelineUI.pasteSelection();
    return pasteFigures();
  },
  'paste-in-place': () => {
    if (document.activeElement?.closest("#timeline"))
      return timelineUI.pasteSelection();
    return pasteFigures('default', 0);
  },
  'paste-instance': () => pasteFigures('instance'),
  'paste-unique': () => pasteFigures('unique'),
  "select-all": () => {
    if (document.activeElement?.closest("#timeline")) timelineUI.selectAll?.();
    else
      editor.selectMany(
        editor.selectionFrame.objects
          .filter((o) => !isHidden(o.unique_id) && !isLocked(o.unique_id))
          .map((o) => o.unique_id),
      );
  },
  "add-sprite-segment": () => {
    finishCurrentEdit();
    cancelSpritePlacement();
    setTool("rig");
    $("media-input").dataset.mode = "builder-sprite";
    $("media-input").click();
  },
  "import-sprite": () => {
    $("media-input").dataset.mode = "sprite";
    $("media-input").click();
  },
  "import-background": () => {
    $("media-input").dataset.mode = "background";
    $("media-input").click();
  },
  "toggle-onion": () => {
    state.onion = !state.onion;
    $("onion-button").classList.toggle("active", state.onion);
    onionController.sync();
    requestRender();
  },
  "toggle-isolate": () => {
    state.isolateMode = !state.isolateMode;
    document.querySelectorAll('[data-action="toggle-isolate"]').forEach((button) => {
      button.setAttribute("aria-pressed", String(state.isolateMode));
      button.classList.toggle("active", state.isolateMode);
    });
  },
  "toggle-builder-branch": () => {
    state.builderBranch = !state.builderBranch;
    document.querySelectorAll('[data-action="toggle-builder-branch"]').forEach((button) => {
      button.setAttribute("aria-pressed", String(state.builderBranch));
      button.classList.toggle("active", state.builderBranch);
    });
    renderInspector();
  },
  "toggle-unselected-handles": () =>
    editorSettings.commit({
      showUnselectedHandles: !state.settings.showUnselectedHandles,
    }),
  "toggle-handles": () => {
    editorSettings.commit({ showHandles: !state.handles });
    $("handles-button").classList.toggle("active", state.handles);
    requestRender();
  },
  "toggle-motion-paths": () => {
    editorSettings.commit({ motionPaths: !state.motionPaths });
    $("paths-button")?.classList.toggle("active", state.motionPaths);
    if (!state.motionPaths) state.hoverPathPoint = null;
    status(state.motionPaths ? "Motion paths on" : "Motion paths off");
    requestRender();
  },
  "toggle-loop": () => {
    editorSettings.commit({ loopPlayback: !state.loop });
    $("loop-button").classList.toggle("active", state.loop);
  },
  "zoom-in": () => zoom(1.2),
  "zoom-out": () => zoom(1 / 1.2),
  "zoom-reset": fit,
  "zoom-selection": fitSelection,
  "zoom-menu": showZoomMenu,
  ...Object.fromEntries(
    [25, 50, 100, 200].map((n) => [
      "zoom-" + n,
      () => zoom(n / 100 / state.view.scale),
    ]),
  ),
  "scene-settings": () => selectTrack({ id: "scene", kind: "scene" }),
  settings: () => editorSettings?.open(),
  privacy: () => privacyUI.open(),
  feedback: () => feedbackUI.open(),
  website: () => desktop?.openServicePage('home'),
  "builder-static-handles": () =>
    editorSettings.commit({
      builderShowStaticHandles: !state.settings.builderShowStaticHandles,
    }),
  "builder-highlight": () =>
    editorSettings.commit({
      builderHighlightSegment: !state.settings.builderHighlightSegment,
    }),
  "builder-canvas-color": () => {
    editorSettings.open("canvas");
    editorSettings.dialog
      .querySelector('[data-setting="builderCanvasColor"]')
      ?.focus();
  },
  "camera-copy": () => {
    editor.copyCamera();
    queueUI();
  },
  "toggle-camera": () => {
    if(!cameraSelected())selectTrack({id:'camera',kind:'camera'});
    else editorSettings?.commit({showCamera:!state.settings.showCamera});
  },
  "camera-paste": () => editor.pasteCamera(rangeFrames()),
  "camera-guides": () => {state.cameraGuides=!state.cameraGuides;$('inspector').querySelector('[data-action="camera-guides"]')?.setAttribute('aria-pressed',String(state.cameraGuides));requestRender();},
  "camera-level": () => editor.setCameraValues({angle_rad:0},rangeFrames()),
  "camera-reset": () => editor.resetCamera(rangeFrames()),
  "camera-center": () =>
    editor.centerCamera("both", rangeFrames(), { boundsOf }),
  "camera-center-x": () =>
    editor.centerCamera("x", rangeFrames(), { boundsOf }),
  "camera-center-y": () =>
    editor.centerCamera("y", rangeFrames(), { boundsOf }),
  "camera-align-view": () => {
    const rect = viewport.getBoundingClientRect();
    editor.alignCameraToView(
      { ...state.view, width: rect.width, height: rect.height },
      rangeFrames(),
    );
  },
  "camera-apply-figures": () => editor.applyCameraToFigures(rangeFrames()),
  "camera-locate-previous": () =>
    editor.locateCamera(-1, "pose", rangeFrames()),
  "camera-locate-next": () => editor.locateCamera(1, "pose", rangeFrames()),
  "close-dialog": closeDialog,
  help: showHelp,
  about: showHelp,
  performance: showPerformance,
  minimize: () => desktop?.minimize(),
  maximize: () => desktop?.maximize(),
  close: async () => {
    await workspaceLayout?.flushPreferences?.();
    await editorSettings?.flush();
    await nativeFrameClipboard?.flush();
    await desktop?.close();
  },
};
const polygonSafeActions = new Set([
  "menu",
  "settings",
  "privacy",
  "feedback",
  "check-updates",
  "release-notes",
  "donate",
  "website",
  "help",
  "about",
  "performance",
  "minimize",
  "maximize",
  "close",
  "new",
  "open",
  "open-recent",
  "undo",
  "redo",
  "finish-polygon",
  "cancel-polygon",
  "first-frame",
  "previous-frame",
  "next-frame",
  "last-frame",
  "builder-static-handles",
  "builder-highlight",
  "builder-canvas-color",
]);
for (const [name, action] of Object.entries(actions)) {
  actions[name] = (...args) => {
    if (state.polygon) {
      if (["new", "open", "open-recent", "close"].includes(name))
        cancelPolygonDraft();
      else if (
        !polygonSafeActions.has(name) &&
        !name.startsWith("zoom-") &&
        !name.startsWith("toggle-")
      ) {
        toast("Finish or cancel the polygon first.");
        return false;
      }
    }
    telemetry.action(name);
    return action(...args);
  };
}
for (const id of ["timeline", "fps"]) {
  $(id).addEventListener("focusin", cancelPolygonDraft);
  $(id).addEventListener("pointerdown", cancelPolygonDraft, true);
}
document.addEventListener("pointerdown", (event) => {
  if (!$("menu").contains(event.target) && !event.target.closest('[data-app-menu]'))
    $("menu").hidden = true;
}, true);
document.addEventListener(
  "click",
  guarded((e) => {
    const menuButton = e.target.closest('[data-app-menu]');
    if (menuButton) { openAppMenu(menuButton); return; }
    const action = e.target.closest("[data-action]");
    if (action) {
      if (action.dataset.action === "play" && !state.polygon) {
        if (state.previewing) return pause();
        if (e.ctrlKey || e.metaKey) return previewFrame();
      }
      if (action.dataset.action !== "menu") $("menu").hidden = true;
      const name = e.shiftKey ? action.dataset.shiftAction ?? action.dataset.action : action.dataset.action;
      if (name.startsWith('builder-context-')) return builderMode?.runContextCommand(name);
      return actions[name]?.(action, e);
    }
    if (!$("menu").contains(e.target)) $("menu").hidden = true;
    const tool = e.target.closest("[data-tool]");
    if (tool) setTool(tool.dataset.tool);
    const asset = e.target.closest("[data-figure]");
    if (asset) {
      if (builderMode?.active) return toast("Finish the figure or return to Animate to insert figures.");
      if (rangeFrames())
        editor.addFigureInFrames(Number(asset.dataset.figure), rangeFrames());
      else editor.addFigure(Number(asset.dataset.figure));
    }
    const sample = e.target.closest("[data-sample]");
    if (sample) {
      if (builderMode?.active) return toast("Finish the figure or return to Animate to open samples.");
      openSample(sample.dataset.sample).catch(fail);
    }
    const joint = e.target.closest("[data-joint]");
    if (joint) editor.select(editor.selectedUid, Number(joint.dataset.joint));
    const polygon = e.target.closest("[data-delete-polygon]");
    const connectorPart=e.target.closest('[data-connector-part]');
    if(connectorPart){const segment=editor.figure?.segments[editor.selectedJoint];if(segment?._stykRig?.connector){editor._connectorInspector={uid:editor.selectedUid,id:segment.segment_id,part:connectorPart.dataset.connectorPart};renderInspector();}return;}
    if (polygon) editor.removePolygon(Number(polygon.dataset.deletePolygon));
    const reference=e.target.closest('[data-polygon-reference]');
    if(reference&&builderMode?.active)openSurfaceReference(editor,Number(reference.dataset.polygonReference),{showDialog,closeDialog});
    const flip=e.target.closest('[data-polygon-flip]');
    if(flip&&builderMode?.active){const index=Number(flip.dataset.polygonFlip),surface=editor.figure.polyfills[index]._stykSurface;if(surface)editor.updatePolygon(index,{surface:{...surface,flipped:!surface.flipped}});}
  }),
);

$("inspector").addEventListener(
  "change",
  guarded(async (e) => {
    const target = e.target,
      key = target.dataset.field;
    pause();
    if(target.id==='figure-layer'){
      finishCurrentEdit();const id=target.value,uids=[...editor.selectedUids];
      const changed=await changeFigureLayer('Move figures to layer',options=>editor.assignFiguresToLayerAsync(uids,id,options));
      if(changed){editor.setActiveLayer(id);state.selectedTrackId=id;timelineUI?.selectTrack?.(id);}queueUI();requestRender();return;
    }
    if (target.id === "builder-branch") {
      state.builderBranch = target.checked;
      if (!target.checked && editor.branchSelected) {
        const uid = editor.selectedUid, joint = editor.selectedJoint;
        editor._branchSelection = null; editor.select(uid, joint);
      }
      if (target.checked && editor.selectedUid != null) {
        state.selectedTrackId = layerIdForUid(
          editor.report,
          editor.selectedUid,
        );
        state.inspectorContext = "figure";
        state.inspectorTab = "design";
      }
      queueUI();
      requestRender();
      return;
    }
    if (target.id === "inspector-layer-name") {
      editor.renameLayer(
        target.dataset.layerId || editor.activeLayerId,
        target.value,
      );
      return;
    }
    if (target.id === "inspector-layer-visible") {
      editor.setLayerVisible(
        target.dataset.layerId || editor.activeLayerId,
        target.checked,
      );
      return;
    }
    if (target.id === "inspector-layer-locked") {
      editor.setLayerLocked(
        target.dataset.layerId || editor.activeLayerId,
        target.checked,
      );
      return;
    }
    if (target.id === "rig-mode") {
      state.rigMode = target.value;
      return;
    }
    if (rigControlChange(editor,target)) return;
    if(target.dataset.polygonSide!==undefined&&builderMode?.active){const index=Number(target.dataset.polygonSide),side=target.value;target.value=editor.figure.polyfills[index]._stykSurface?.side??(editor.figure.polyfills[index]._stykSurface?'front':'both');changeSurfaceSide(editor,index,side,{showDialog,closeDialog});return;}
    if (target.id === 'node-is-ik') { editor.setNodeIK({enabled: target.checked}); return; }
    if (target.id === 'node-ik-pinned') { telemetry.count('ik'); editor.setNodeIK({pinned: target.checked}); return; }
    if (target.id === 'node-ik-chain') { editor.setNodeIK({chainLength: target.valueAsNumber}); return; }
    if (target.id === 'node-ik-rotation') { editor.rotateIKTarget(target.valueAsNumber * Math.PI / 180); return; }
    if (target.id === 'node-ik-stretch') { editor.setNodeIK({allowStretch: target.checked}); return; }
    if (target.name === 'node-ik-bend') { editor.setNodeIK({bendDirection: Number(target.value)}); return; }
    if (target.id === "apply-range-movement") {
      state.applyRange = target.checked;
      return;
    }
    if (target.id === "figure-name") {
      editor.updateFigureStyle({ name: target.value });
      return;
    }
    if(target.id==='builder-joint-name'&&builderMode?.active){editor.updateSegment({name:target.value.trim().slice(0,120)});return;}
    if (target.id === "segment-gradient-enabled") {
      updateBuilderStyle(
        {
          gradient: target.checked ? { color: "#ffffff" } : null,
        },
        e,
      );
      return;
    }
    if (target.id === "segment-gradient-color") {
      updateBuilderStyle({ gradient: { color: target.value } }, e);
      return;
    }
    if (target.id === "segment-shape") {
      if (usesBuilderBranch(e) && ["line", "squareLine"].includes(target.value))
        editor.setBranchCaps(target.value === "squareLine");
      else if (
        usesBuilderBranch(e) &&
        [1, 3, 4].includes(
          editor.figure?.segments[editor.selectedJoint]?.primitive_code,
        )
      )
        editor.setBranchFill(target.value);
      else editor.convertSegment(target.value);
      return;
    }
    if (target.id === "segment-color") {
      updateBuilderStyle({ color: target.value }, e);
      return;
    }
    if (target.id === "segment-opacity") {
      updateBuilderStyle({ opacity: Number(target.value) / 100 }, e);
      return;
    }
    if (target.dataset.polygonColor !== undefined) {
      editor.updatePolygon(Number(target.dataset.polygonColor), {
        color: target.value,
      });
      return;
    }
    if (key) {
      const value = Number(target.value);
      if (!Number.isFinite(value)) throw new Error("Enter a finite number.");
      if (key === "fps") editor.setFPS(value);
      else if (key === "duration") editor.setFrameDuration(value);
      else if (key.startsWith("group_")) {
        const b = selectionBounds();
        if (key === "group_x") moveSelected(value - b.minX, 0);
        else if (key === "group_y") moveSelected(0, value - b.minY);
        else {
          const old = key === "group_width" ? b.maxX - b.minX : b.maxY - b.minY;
          if (value <= 0 || old <= 0)
            throw new Error("Selection size must be greater than zero.");
          editor.scaleSelection(value / old);
        }
      } else if (key === "rotation")
        editor.rotateFigure(
          shortest(
            (value * Math.PI) / 180 -
              ((editor.object.angles[0] ?? 0) -
                (editor.figure.segments[0]?.angle_rad ?? 0)),
          ),
        );
      else if (key === "scale") editor.updateObject({ scale: value / 100 });
      else if (["root_x", "root_y"].includes(key)) {
        if (rangeFrames())
          moveSelected(
            key === "root_x" ? value - editor.object.root_x : 0,
            key === "root_y" ? value - editor.object.root_y : 0,
          );
        else editor.updateObject({ [key]: value });
      } else if (key === "thickness")
        updateBuilderStyle({ thickness: value }, e);
      else if (key === "joint_angle") {
        const angle = (value * Math.PI) / 180,
          obj = editor.object,
          delta = shortest(angle - obj.angles[editor.selectedJoint]);
        editor.rotateJoint?.(delta);
        if (!editor.rotateJoint)
          editor.transaction("Joint angle", () => {
            obj.angles[editor.selectedJoint] = angle;
          });
      } else if (key === "joint_length" || key === "joint_bend") {
        editor.updateSegment(
          key === "joint_length"
            ? { length: value }
            : { bend_rad: (value * Math.PI) / 180 },
        );
      } else if (key.startsWith("camera_")) {
        editor.transaction("Camera", (frame) => {
          frame.camera = {
            x: 0,
            y: 0,
            scale: 1,
            angle_rad: 0,
            ...frame.camera,
            is_default: false,
          };
          frame.camera[key === "camera_angle" ? "angle_rad" : key.slice(7)] =
            key === "camera_scale"
              ? value / 100
              : key === "camera_angle"
                ? (value * Math.PI) / 180
                : value;
        });
      } else if (key === "canvas_width" || key === "canvas_height") {
        if (value < 1 || value > 16384 || !Number.isInteger(value))
          throw new Error(
            "Canvas dimensions must be whole pixels between 1 and 16,384.",
          );
        if (editor.updateProject) editor.updateProject({ [key]: value });
        else
          editor.transaction(
            "Canvas size",
            (_, report) => (report[key] = value),
          );
        fit();
      } else if (key === "join_handle")
        editor.transaction("Join handle", () => {
          const parent =
              editor.frame.objects[editor.object.join.target_object_slot],
            fig = editor.report.figure_types.find(
              (f) => f.figure_type_id === parent.figure_type_id,
            );
          if (value !== 0 && !fig.segments.some((s) => s.segment_id === value))
            throw new Error("That parent joint does not exist.");
          editor.object.join.target_handle_id = value;
        });
      return;
    }
    if (target.id === "figure-color") {
      editor.setFigureColor(target.value,{indices:rangeFrames()});
    } else if (target.id === "figure-opacity")
      updateSelection({
        field28: Math.round(
          (1 - Math.max(0, Math.min(100, Number(target.value))) / 100) * 255,
        ),
      });
    else if (target.id === "static-joint") {
      updateBuilderStyle({ static: target.checked }, e);

    } else if (target.id === "background-color") {
      const raw = (0xff000000 | parseInt(target.value.slice(1), 16)) >>> 0;
      if (editor.setSceneColor)
        editor.setSceneColor(raw, {
          indices: rangeFrames(),
        });
      else
        editor.transaction("Background color", (f, r) => {
          const id =
            Math.max(0, ...(r.backgrounds || []).map((b) => b.background_id)) +
            1;
          r.backgrounds = [
            ...(r.backgrounds || []),
            { background_id: id, kind: 2, color: raw },
          ];
          f.background_id = id;
        });
    } else if (target.id === "join-target") {
      if (rangeFrames()) {
        if (target.value)
          editor.joinFiguresInFrames(Number(target.value), 0, rangeFrames());
        else editor.detachFiguresInFrames(rangeFrames());
      } else if (editor.joinFigure) {
        editor.joinFigure(target.value ? Number(target.value) : null, 0);
      } else {
        editor.transaction("Attach figure", () => {
          const o = editor.object,
            parent = editor.frame.objects.find(
              (p) => p.unique_id === Number(target.value),
            );
          if (!parent) {
            const g = editor.geometry.objects.get(o.object_slot);
            o.root_x = g.root.x;
            o.root_y = g.root.y;
            o.join = null;
            return;
          }
          let p = parent,
            seen = new Set([o.unique_id]);
          while (p) {
            if (seen.has(p.unique_id))
              throw new Error("This attachment would create a cycle.");
            seen.add(p.unique_id);
            p = p.join ? editor.frame.objects[p.join.target_object_slot] : null;
          }
          o.join = {
            target_object_slot: parent.object_slot,
            target_unique_id: parent.unique_id,
            target_handle_id: 0,
          };
        });
      }
    }
  }),
);
$("fps").addEventListener(
  "change",
  guarded((e) => editor.setFPS(Number(e.target.value))),
);
$("timeline-zoom").addEventListener("input", (e) =>
  timelineUI?.setZoom?.(Number(e.target.value)),
);
$("file-input").addEventListener(
  "change",
  guarded((e) => importFiles([...e.target.files])),
);
$("media-input").addEventListener(
  "change",
  guarded(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const mode = e.target.dataset.mode;
    e.target.value = "";
    if (mode === "builder-sprite") await beginSpritePlacement(file);
    else await importMediaFile(file, { background: mode === "background" });
  }),
);
document.addEventListener("dragover", (e) => {
  if (e.defaultPrevented) { $("canvas-empty").hidden = true; return; }
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    $("canvas-empty").hidden = false;
  }
});
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) $("canvas-empty").hidden = true;
});
document.addEventListener(
  "drop",
  guarded((e) => {
    const handled = e.defaultPrevented;
    e.preventDefault();
    $("canvas-empty").hidden = true;
    if (!handled && e.dataTransfer.files.length)
      return importFiles([...e.dataTransfer.files]);
  }),
);
const heldArrows = new Set();
let keyboardHandleGesture = null;
function finishKeyboardHandle() {
  if (!keyboardHandleGesture) return;
  if (keyboardHandleGesture.ownsDrag) editor.commitDrag();
  keyboardHandleGesture = null;
  heldArrows.clear();
  queueUI();
}
function finishCurrentEdit() {
  drawingController?.finish();
  pause();
  finishKeyboardHandle();
  endDrag();
  propertyControls?.commit();
  vfxInspector?.commit();
  if(cameraMotionControls?.active)cameraMotionControls.commit(cameraMotionControls.active.input);
  vfxGizmos?.up();
  editor.commitDrag();
  editor.commitAnimationEdit();
}
function cycleFigure(direction) {
  const objects = editor.selectionFrame.objects,
    order = editor.selectionFrame.object_draw_order || objects.map((_, i) => i);
  const candidates = order
    .map((slot) => objects[slot])
    .filter(
      (object) =>
        object && !isHidden(object.unique_id) && !isLocked(object.unique_id),
    );
  if (!candidates.length) return;
  const index = candidates.findIndex(
    (object) => object.unique_id === editor.selectedUid,
  );
  editor.select(
    candidates[(index + direction + candidates.length) % candidates.length]
      .unique_id,
  );
}
function keyboardHandle(event, key) {
  if (
    keyboardHandleGesture?.camera ||
    (cameraSelected() && state.settings.showCamera &&
      (state.hoverCameraHandle || state.inspectorContext === "camera"))
  ) {
    if (
      editor.report._styk?.layers?.fixed?.camera?.locked ||
      editor.report._styk?.layers?.fixed?.camera?.visible === false
    )
      return;
    const target = keyboardHandleGesture?.target ||
      state.hoverCameraHandle || { kind: "position", index: 4 };
    if (!keyboardHandleGesture) {
      pause();
      interruptRecovery();
      const geometry = editor.geometry;
      editor.beginCameraDrag({ indices: rangeFrames(), label: "Nudge camera" });
      keyboardHandleGesture = {
        camera: true,
        target,
        ownsDrag: true,
        geometry,
      };
    }
    heldArrows.add(key);
    editor.updateCameraDrag(
      cameraKeyboardDelta(
        cameraViewport(editor.report, currentFrame(), state.view),
        target,
        key === "arrowleft" ? -1 : key === "arrowright" ? 1 : 0,
        key === "arrowup" ? -1 : key === "arrowdown" ? 1 : 0,
      ),
      { fromStart: false },
    );
    requestRender();
    return;
  }
  const target = keyboardHandleGesture?.target ||
    state.hoverHandle || { uid: editor.selectedUid, joint: -1 };
  const editMode = state.handleEditHeld;
  if (
    target.uid == null ||
    isHidden(target.uid) ||
    isLocked(target.uid) ||
    (target.static && !editMode)
  )
    return;
  if (event.shiftKey && target.joint < 0) return;
  if (!keyboardHandleGesture) {
    pause();
    interruptRecovery();
    editor.select(target.uid, target.joint, {
      add: target.joint < 0 && selection().has(target.uid),
    });
    const ownsDrag = !editor.dragging;
    if (ownsDrag) {
      if (editMode) editor.beginHandleEditDrag();
      else if (target.joint < 0) editor.beginTranslationDrag("Nudge figures");
      else editor.beginDrag("Adjust joint");
    }
    keyboardHandleGesture = { target, ownsDrag };
  }
  heldArrows.add(key);
  const options = {
    uid: target.uid,
    jointIndex: target.joint,
    view: state.view,
    cameraEnabled: false,
    editMode,
    isolate: Boolean(state.isolateHeld || state.isolateMode),
    bend: state.drag?.kind === "bend",
  };
  if (event.shiftKey)
    editor.alignHandle(
      Number(heldArrows.has("arrowright")) -
        Number(heldArrows.has("arrowleft")),
      Number(heldArrows.has("arrowdown")) - Number(heldArrows.has("arrowup")),
      options,
    );
  else
    editor.nudgeHandle(
      key === "arrowleft" ? -1 : key === "arrowright" ? 1 : 0,
      key === "arrowup" ? -1 : key === "arrowdown" ? 1 : 0,
      options,
    );
  requestRender();
}
function locateHovered(direction) {
  finishKeyboardHandle();
  pause();
  if (state.hoverCameraHandle)
    return editor.locateCamera(
      direction,
      state.hoverCameraHandle.kind,
      rangeFrames(),
    );
  if (state.inspectorContext === "camera")
    return editor.locateCamera(direction, "pose", rangeFrames());
  const target = state.hoverHandle || {
    uid: editor.selectedUid,
    joint: editor.selectedJoint,
  };
  if (target.uid == null || isHidden(target.uid) || isLocked(target.uid))
    return;
  editor.locateHandle(direction, {
    uid: target.uid,
    jointIndex: target.joint,
    editMode: state.handleEditHeld,
  });
}
function hotkeyScopes(event) {
  const scopes = [];
  if(drawingController?.active&&!event.target.closest?.('.layer-timeline,.sheet-filmstrip'))scopes.push('drawing');
  if (state.polygon) scopes.push('polygon');
  if (event.target.closest?.('#viewport')) {
    if (state.hoverHandle || state.hoverCameraHandle) scopes.push('hover');
    scopes.push('canvas');
  }
  if (isBuilderContext(state.tool) || builderMode?.active) scopes.push('builder');
  if (event.target.closest?.('.layer-timeline')) scopes.push('timeline');
  if (state.settings.timelineMode === 'simple') scopes.push('simple');
  return scopes;
}
function cancelKeyboardCommand() {
  if(drawingController?.active){drawingController.cancel();drawingController.cancelSelection();}
  state.rigAnchorPick = null;
  if (keyboardHandleGesture) {
    if (keyboardHandleGesture.ownsDrag) editor.cancelDrag();
    keyboardHandleGesture = null; heldArrows.clear();
  }
  hotkeys.releaseAll();
  timelineUI?._cancelGesture?.();
  cancelDrag();
  // Pointer-up may already have cleared the UI gesture before its commit failed.
  if (editor._drag) editor.cancelDrag();
  if (state.tool === 'attach') setTool('select');
  $('menu').hidden = true;
}
function runKeyboardCommand(id, event, modifiers = {shift: event.shiftKey}) {
  editablePreparation.cancel();
  if(drawingController?.active){
    if(id==='play-pan')drawingController.finish();
    if(id.startsWith('drawing-')){drawingController.finish();const tool=id.slice(8);if(['brush','eraser','fill','lasso'].includes(tool))drawingController.tool=tool;else if(tool==='apply')drawingController.applySelection();else{drawingController.settings.size=Math.max(.5,Math.min(2048,drawingController.settings.size*(tool==='smaller'?.8:1.25)));queueUI();}drawingController.sync();return;}
    if(['copy','cut','paste'].includes(id)&&!event.target.closest?.('.layer-timeline,.sheet-filmstrip')&&(drawingController.selection||id==='paste'&&drawingController.pixelClipboard))return drawingController.action(id+'-pixels');
    if(id!=='cancel'&&id!=='play-pan')drawingController.finish();if(['previous-frame','next-frame','previous-keyframe','next-keyframe','first-frame','last-frame'].includes(id))drawingController.applySelection();
  }
  if(['insert-copied-key','insert-blank-key'].includes(id)){
    finishCurrentEdit();const ids=event.target.closest?.('.layer-timeline')?timelineUI.ids:[editor.activeLayerId];
    return editor.sheetInsertKey(ids,editor.tick,{blank:id==='insert-blank-key'});
  }
  if (builderMode?.active) {
    // Shortcut modifiers identify commands; only an extra Shift on Split
    // extends its scope. Ctrl+D must not create a mirrored copy, and the
    // Shift in Shift+H/V must not implicitly select descendants.
    const branch = Boolean(editor.branchSelected || state.builderBranch);
    if (id === 'duplicate') return beginDuplicatePlacement({branch});
    if (id === 'mirror' || id === 'mirror-vertical') {
      finishCurrentEdit();
      return editor.mirrorSegment(id === 'mirror' ? 'horizontal' : 'vertical', {branch});
    }
    if (id === 'split-segment') {
      finishCurrentEdit();
      return editor.splitBuilderSegments({branch: branch || modifiers.shift, fraction: .5});
    }
  }
  if (id === 'cancel') return cancelKeyboardCommand();
  if (id === 'handle-edit-hold') { state.handleEditHeld = true; requestRender(); return; }
  if (id === 'isolate-hold') { state.isolateHeld = true; return; }
  if (id === 'play-pan') {
    state.space = true; state.spacePanned = false; viewport.classList.add('panning'); return;
  }
  if (id.startsWith('handle-')) return keyboardHandle({shiftKey:modifiers.shift}, 'arrow' + id.slice(7));
  if (id.startsWith('move-')) {
    const direction = id.slice(5), step = modifiers.shift ? 10 : 1;
    return moveSelected(direction === 'left' ? -step : direction === 'right' ? step : 0,
      direction === 'up' ? -step : direction === 'down' ? step : 0);
  }
  if (id === 'previous-figure' || id === 'next-figure') {
    finishKeyboardHandle(); return cycleFigure(id === 'previous-figure' ? -1 : 1);
  }
  if (id.startsWith('tool-')) {
    return setTool(id.slice(5));
  }
  if (id === 'segment-values') return showSegmentValues({hover: true});
  if (id === 'previous-exposure' || id === 'next-exposure')
    return timelineUI.selectFrame(timelineUI.selectedIndex + (id === 'previous-exposure' ? -1 : 1), {extend: modifiers.shift});
  if (event.target.closest?.('.layer-timeline,.sheet-filmstrip') && runTimelineHotkey(timelineUI, id, {shiftKey:modifiers.shift})) return;
  return actions[id]?.();
}
function releaseKeyboardCommand(id, event) {
  if (id === 'handle-edit-hold') { state.handleEditHeld = false; requestRender(); }
  else if (id === 'isolate-hold') state.isolateHeld = false;
  else if (id.startsWith('handle-')) {
    heldArrows.delete('arrow' + id.slice(7));
    if (!heldArrows.size) finishKeyboardHandle();
  } else if (id === 'play-pan') {
    const active = state.space;
    state.space = false; viewport.classList.toggle('panning', state.tool === 'hand');
    if (active && !event.cancelled && !state.spacePanned && !state.polygon && !document.querySelector('dialog[open]') && !isHotkeyInput(event.target)) {
      play();
    }
    state.spacePanned = false;
  }
}
const hotkeys = new HotkeyManager({run: guarded(runKeyboardCommand), release: guarded(releaseKeyboardCommand)});
const polygonCommands = new Set(['undo','redo','open','new','save','save-as','settings','help','cancel','finish-polygon','play-pan',
  'tool-select','tool-pose','tool-hand','tool-line','tool-circle','tool-polygon','zoom-in','zoom-out','zoom-reset','zoom-selection','toggle-onion','toggle-handles','isolate-hold']);
document.addEventListener('keydown', guarded(event => {
  state.builderShiftHeld = event.shiftKey;
  const scopes = hotkeyScopes(event), command = hotkeys.resolve(event, scopes);
  const builderCheckbox = command?.scope === 'builder' && command.id.startsWith('builder-') && event.target.matches?.('input[type=checkbox],input[type=radio]');
  const effectHistory = ['undo','redo'].includes(command?.id) && vfxInspector?.ownsHistoryTarget(event.target);
  if (document.querySelector('dialog[open]') || (isHotkeyInput(event.target) && !builderCheckbox && !effectHistory)) return;
  hotkeys.keydown(event, scopes, command => {
    if (state.polygon && !polygonCommands.has(command.id)) return false;
    if (!$('renderer-error').hidden && !['save','save-as','open','new','cancel','settings','help'].includes(command.id)) return false;
    return true;
  });
}));
// Release at capture phase: controls and dialogs can stop bubbling after a held
// key starts. Matching uses the pressed physical key, even if modifiers change.
document.addEventListener('keyup', guarded(event => {
  state.builderShiftHeld = event.shiftKey;
  if(!event.shiftKey && state.tool==='polygon'){state.bucketPreview=null;overlay.style.cursor='';requestRender();}
  hotkeys.keyup(event);
}), true);
window.addEventListener('blur', () => {
  hotkeys.releaseAll(); finishKeyboardHandle();
  if (state.drag) cancelDrag();
  state.builderShiftHeld = false;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hotkeys.releaseAll();
    // A hidden page cannot present anything; park speculative preparation the
    // same way a long canvas drag does. Exports keep their own workers.
    playback.setInteractionActive(true);
    thumbnailRenderer?.setPaused(true);
    timelineUI?.setPaused?.(true);
    return;
  }
  playback.setInteractionActive(Boolean(editingGestureActive()||state.scrubbing||state.editablePreparing));
  thumbnailRenderer?.setPaused(Boolean(editingGestureActive()||state.playing||state.editablePreparing));
  timelineUI?.setPaused?.(Boolean(state.playing||state.editablePreparing));
  // A warm-up skipped while hidden still owes the playhead its neighbors.
  warmPlayback();
});
new MutationObserver(() => { if (document.querySelector('dialog[open]')) hotkeys.releaseAll(); })
  .observe(document.body, {subtree:true, attributes:true, attributeFilter:['open']});
editor.addEventListener("change", (e) => {
  const kind = e.detail?.kind;
  const joining = state.figureJoin;
  if (joining && (joining.token !== editor._documentToken || joining.uid !== editor.selectedUid ||
      joining.frameIndex !== editor.frameIndex || joining.tick !== editor.tick ||
      joining.revision !== editor.revision || !selectedFigureJoinAction() ||
      ['history', 'document', 'frame-draft'].includes(kind))) setTool('select');
  if (e.detail?.audio && !e.detail?.timing) {
    pause();
    for (const job of exportJobs) job.controller.abort();
    // Audio metadata cannot invalidate any prepared animation pixels.
    if (playback.report === editor.report) { playback.documentRevision = editor.revision; state.playbackRevision = editor.revision; }
    queueUI(); if (editor.dirty) scheduleRecovery(); return;
  }
  if (['edit','history','document'].includes(kind) && !e.detail?.live) { audioPreparation?.abort(); audioScrubController?.abort(); audioEngine.stop(); }
  if (kind === 'document') void audioEngine.clear().catch(fail);
  if(kind==='seek'&&!state.playing&&telemetry.isForeground)telemetry.performance.action('seek');
  if (kind === 'edit' && !e.detail?.live) { telemetry.count('edits'); telemetry.milestone('first_edit'); }
  if(['edit','history','document','preview','frame-draft','seek'].includes(kind))editablePreparation.cancel();
  const selectedTrack = ["seek", "history", "frame-draft"].includes(kind)
    ? timelineUI?.trackById?.get(state.selectedTrackId)
    : null;
  if (
    kind === "document" ||
    (state.duplicatePlacement &&
      ["edit", "history", "frame-draft"].includes(kind))
  )
    cancelSpritePlacement();
  if (
    kind === "document" ||
    kind === "seek" ||
    (kind === "selection" &&
      state.polygon &&
      editor.selectedUid !== state.polygon.uid)
  )
    cancelPolygonDraft();
  if (kind === "document" && e.detail?.scenePrepared) {
    const prepared = preparedScenes.get(editor.report);
    if (prepared) {
      state.hidden.clear();
      state.locked.clear();
      images.clear();
      for (const [url, image] of prepared.images) images.set(url, image);
      state.view = prepared.view;
      state.renderer.activatePreparedScene(prepared, {
        report: editor.report,
        frame: editor.evaluatedFrame,
        geometry: editor.geometry,
        view: state.view,
      });
      preparedScenes.delete(editor.report);
      placeArtboard();
      requestRender();
    }
  }
  if (kind === "document" || kind === "seek") {
    keyboardHandleGesture = null;
    heldArrows.clear();
    state.hoverHandle = null;
    state.hoverCameraHandle = null;
  }
  if (["edit", "history", "document", "preview", "frame-draft"].includes(kind))
    state.editingPacket = null;
  if (
    (kind === "selection" || (e.detail?.structural &&
      !(e.detail?.layerSheet && ['camera','scene'].includes(state.inspectorContext)))) &&
    editor.selectedUid != null
  ) {
    state.inspectorContext = "figure";
    state.inspectorTab = "design";
    state.selectedTrackId = layerIdForUid(editor.report, editor.selectedUid);
  }
  if (kind === "document") {
    state.inspectorContext = editor.selectedUid == null ? "scene" : "figure";
    state.selectedTrackId = editor.activeLayerId;
  }
  if (selectedTrack) reconcileSelectedSegmentTrack(selectedTrack);
  if (!cameraSelected()) {
    state.hoverCameraHandle=null;
    overlay.style.cursor='';
  }
  if (
    e.detail?.definition ||
    e.detail?.structural ||
    (kind === "history" && !e.detail?.animation) ||
    kind === "document"
  ) {
    invalidatePivotHandleTopology();
    handleCache = null;
    blueHandles = null;
    assetLibrary?.invalidate();
  }
  if (["edit", "history", "document", "frame-draft"].includes(kind))
    for (const job of exportJobs) job.controller.abort();
  if (
    (kind === "edit" || kind === "frame-draft" || (kind === "history" && (e.detail.layerSheet || (e.detail.frameIndices || e.detail.animation) && !e.detail.structural))) &&
    !e.detail?.live &&
    playback.report === editor.report &&
    (state.playbackRevision !== editor.revision ||
      state.playbackDraftRevision !== editor.frameDraftRevision)
  ) {
    const metadataOnly = Boolean(
      kind === "frame-draft" || e.detail.animation || e.detail.cameraMotion || e.detail.layerMetadata || e.detail.layerSheet,
    );
    const frameIndices =
      e.detail.frameIndices ??
      e.detail.changedFrames ??
      (metadataOnly ? [] : [editor.frameIndex]);
    playback.updateDocument({
      revision: editor.revision,
      frameIndices,
      sourceIds: e.detail.sourceIds || [],
      definition: Boolean(e.detail.definition),
      structural: Boolean(e.detail.structural && !metadataOnly),
    });
    state.playbackRevision = editor.revision;
    state.playbackDraftRevision = editor.frameDraftRevision;
    state.playbackPacket = null;
    if (state.renderer?.retainPreparedFrames)
      state.renderer.retainPreparedFrames(editor.report, playback.cache.values());
    else state.renderer?.clearPreparedFrames?.();
  }
  if (kind === "seek") interruptRecovery();
  if (kind === "seek") {
    queueEditingFrame();
    requestRender();
    if (!state.playing && !state.scrubbing) {
      queueUI();
      warmPlayback();
    }
    return;
  }
  if (kind === "preview" || e.detail?.live || state.drag || state.scrubbing) {
    requestRender();
    return;
  }
  // A shared definition commit (and its undo/redo) invalidates every instance.
  // Use the same bounded staging as a seek before panels or rendering force a
  // synchronous rebuild. The previous canvas remains visible until activation.
  if (e.detail?.definition || kind === 'history' && e.detail?.structural)
    queueEditingFrame();
  queueUI();
  if (["edit", "history", "document", "frame-draft"].includes(kind))
    warmPlayback();
  if (
    kind === "edit" ||
    kind === "history" ||
    (kind === "frame-draft" && editor.dirty)
  )
    scheduleRecovery();
});
function scheduleRecovery() {
  clearTimeout(state.recoveryTimer);
  if (!state.settings.autosaveSeconds) return;
  state.recoveryTimer = setTimeout(async () => {
    if (
      state.playing ||
      state.drag ||
      propertyControls?.active ||
      state.scrubbing ||
      exportJobs.size
    ) {
      scheduleRecovery();
      return;
    }
    if (!editor.dirty) return;
    const report = editor.report,
      name = editor._movieclipScopes?.[0]?.parent.name ?? editor.name;
    try {
      const saved = await runDocumentExport(
        "styk",
        async (blob, signal) => {
          if (
            editor.report !== report ||
            !editor.dirty ||
            state.drag ||
            state.playing ||
            signal.aborted
          )
            return;
          if (desktop) {
            return await writeNativeBlob(desktop, blob, {
              recovery: true,
              name,
              signal,
            });
          }
          return writeBrowserRecovery(blob, name, signal);
        },
        { recovery: true },
      );
      if (saved) state.recoveryBackoff = 1;
    } catch (error) {
      if (error.name !== "AbortError")
        status(`Recovery copy could not be written: ${error.message}`, true);
    }
  }, state.settings.autosaveSeconds * 1000 * (state.recoveryBackoff || 1));
}
function offerRecovery() {
  if (desktop?.getRecoveryInfo) {
    desktop
      .getRecoveryInfo()
      .then((record) => {
        if (!record) return;
        showRecovery({
          ...record,
          native: true,
        });
      })
      .catch((error) =>
        status(`Recovery could not be read: ${error.message}`, true),
      );
    return;
  }
  const req = indexedDB.open("stykanimate-recovery", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("documents");
  req.onsuccess = () => {
    const db = req.result,
      tx = db.transaction("documents"),
      get = tx.objectStore("documents").get("latest");
    get.onsuccess = () => {
      const record = get.result;
      showRecovery(record);
    };
    tx.oncomplete = () => db.close();
  };
}
function showRecovery(record) {
  if (!record) return;
  const banner = document.createElement("div");
  banner.className = "recovery-banner";
  banner.innerHTML = `<span>Recovered project: ${esc(record.name)}</span><button class="button small" id="restore-recovery">Restore</button><button class="icon-button" id="dismiss-recovery" aria-label="Dismiss recovery">${icon("close")}</button>`;
  viewport.append(banner);
  $("restore-recovery").onclick = guarded(async () => {
    if (await confirmReplace()) {
      const replaceApproved = {
        report: editor.report,
        revision: editor.revision,
        draftRevision: editor.frameDraftRevision,
      };
      if (record.native) {
        const native = await readNativeRecovery(desktop);
        if (!native)
          throw new Error("The recovery file is no longer available.");
        record = { ...record, ...native };
      }
      if (record.blob) {
        const restored = await importer.importNative(
          new File([record.blob], `${record.name}.styk`),
        );
        await acceptImport(restored, record.name, {
          replaceApproved,
        });
      } else {
        if (
          (replaceApproved.report !== editor.report ||
            replaceApproved.revision !== editor.revision ||
            replaceApproved.draftRevision !== editor.frameDraftRevision ||
            editor._drag ||
            editor._animationEdit) &&
          !(await confirmReplace())
        )
          return;
        await editor.loadAsync(record.document, record.name);
        if (desktop?.activateDocument)
          state.documentToken = (
            await desktop.activateDocument({})
          ).documentToken;
        state.sourceId = null;
      }
      editor.dirty = true;
      fit();
      updateUI();
      telemetry.count('recovery_restored');
      banner.remove();
    }
  });
  $("dismiss-recovery").onclick = () => banner.remove();
}
if (desktop) {
  if (desktop.platform !== "darwin") $("window-controls").hidden = false;
  else document.querySelector(".titlebar").style.paddingLeft = "84px";
  desktop.onMenuAction?.(
    guarded((action) => {
      if (['undo','redo'].includes(action) && vfxInspector?.ownsHistoryTarget(document.activeElement) && !$("dialog").open) return actions[action]();
      if (
        document.activeElement?.matches(
          "input,textarea,[contenteditable=true]",
        ) &&
        [
          "cut",
          "copy",
          "paste",
          "select-all",
          "undo",
          "redo",
          "delete",
        ].includes(action)
      ) {
        document.execCommand(action === "select-all" ? "selectAll" : action);
        return;
      }
      if (!$("dialog").open) return actions[action]?.();
    }),
  );
  desktop.onOpenFile?.(guarded(acceptNativeFile));
  desktop.onBackendError?.(fail);
}
window.addEventListener("pagehide", () => clipboardWorker.dispose());
window.addEventListener("beforeunload", (e) => {
  if (editor.dirty && !desktop) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.styk = {
  audioEngine,
  editor,
  state,
  actions,
  importFiles,
  acceptImport,
  fit,
  drawingResourcesFor,
  performance: () => ({
    editingPresentation:state.lastEditingPresentation,
    editablePreparation:{pending:editablePreparation.pending,...editablePreparation.stats},
    samples: [...state.renderSamples],
    renderer: state.renderer?.stats,
    import: state.lastImport,
    playback: { ...playback.stats },
    presentation: playbackMetrics.snapshot(performance.now()),
  }),
  ready: false,
};
let thumbnailRenderer, nativeFrameClipboard, sharedClipboard;
let inbetweenDialog;
async function changeFigureLayer(label, operation) {
  pause();
  finishKeyboardHandle();
  cancelDrag();
  interruptRecovery();
  const controller = new AbortController();
  let dialogShown = false,
    latest;
  const originalDialogContent = $("dialog-content").firstChild,
    originalDialogOpen = $("dialog").open;
  const cancel = () => controller.abort();
  let progressElement;
  const refresh = () => {
    if (
      !dialogShown ||
      !latest ||
      !progressElement?.isConnected ||
      controller.signal.aborted
    )
      return;
    $("layer-progress-label").textContent =
      latest.phase === "staging"
        ? "Applying layer changes"
        : "Preserving animation";
    const progress = progressElement;
    if (Number.isFinite(latest.total) && latest.total > 0) {
      progress.max = latest.total;
      progress.value = latest.completed || 0;
    } else progress.removeAttribute("value");
  };
  const timer = setTimeout(() => {
    if (
      $("dialog-content").firstChild !== originalDialogContent ||
      $("dialog").open !== originalDialogOpen
    ) {
      controller.abort();
      return;
    }
    dialogShown = true;
    showDialog(
      label,
      '<p id="layer-progress-label">Preserving animation</p><progress id="layer-progress" style="width:100%;accent-color:#0d99ff"></progress><div class="dialog-actions"><button class="button" id="cancel-layer-change">Cancel</button></div>',
    );
    progressElement = $("layer-progress");
    $("cancel-layer-change").onclick = cancel;
    $("dialog").addEventListener("close", cancel, { once: true });
    refresh();
  }, 150);
  try {
    return await operation({
      signal: controller.signal,
      onProgress: (progress) => {
        latest = progress;
        refresh();
      },
    });
  } catch (error) {
    if (error.name !== "AbortError") throw error;
    status("Layer change cancelled");
    return false;
  } finally {
    clearTimeout(timer);
    if (dialogShown) {
      $("dialog").removeEventListener("close", cancel);
      if (progressElement?.isConnected) closeDialog();
    }
    queueUI();
  }
}
let clipboardOperationTail = Promise.resolve();
function runClipboardOperation(kind, execute) {
  const source = editor._documentToken;
  const operation = clipboardOperationTail.then(() => {
    if (editor._documentToken !== source) return 0;
    return performClipboardOperation(kind, execute);
  });
  clipboardOperationTail = operation.catch(() => {});
  return operation;
}
async function performClipboardOperation(kind, execute) {
  finishCurrentEdit();
  interruptRecovery();
  const controller = new AbortController(),
    source = editor._documentToken,
    dialog = $("dialog"),
    originalContent = $("dialog-content").firstChild,
    originalOpen = dialog.open;
  const labels = {
    copy: "Copying frames",
    cut: "Cutting frames",
    paste: "Pasting frames",
  };
  let progressElement, latest;
  const cancel = () => controller.abort();
  const changed = () => {
    if (editor._documentToken !== source) cancel();
  };
  const onClose = () => {
    if (!dialog.open || !progressElement?.isConnected) cancel();
  };
  const refresh = () => {
    if (!progressElement?.isConnected || !latest) return;
    if (Number.isFinite(latest.total) && latest.total > 0) {
      progressElement.max = latest.total;
      progressElement.value = latest.completed || 0;
    } else progressElement.removeAttribute("value");
  };
  editor.addEventListener("change", changed);
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    if (
      $("dialog-content").firstChild !== originalContent ||
      dialog.open !== originalOpen
    ) {
      cancel();
      return;
    }
    showDialog(
      labels[kind] || "Updating frames",
      '<progress id="clipboard-progress" style="width:100%;accent-color:#0d99ff"></progress><div class="dialog-actions"><button class="button" id="cancel-clipboard">Cancel</button></div>',
    );
    progressElement = $("clipboard-progress");
    $("cancel-clipboard").onclick = cancel;
    dialog.addEventListener("close", onClose);
    refresh();
  }, 150);
  try {
    const count = await execute({
      signal: controller.signal,
      onProgress: (progress) => {
        latest = progress;
        refresh();
      },
    });
    if (count && kind === "copy")
      status(`${count} frame${count === 1 ? "" : "s"} copied`);
    return count;
  } catch (error) {
    if (error.name !== "AbortError") throw error;
    status("Clipboard operation cancelled");
    return 0;
  } finally {
    clearTimeout(timer);
    editor.removeEventListener("change", changed);
    dialog.removeEventListener("close", onClose);
    if (progressElement?.isConnected) closeDialog();
    queueUI();
  }
}
function mountTimeline() {
  pause();
  finishKeyboardHandle();
  propertyControls?.commit();
  if (editor._animationEdit) editor.commitAnimationEdit();
  if (editor.dragging) editor.commitDrag();
  if (state.settings.timelineMode === "advanced") editor.disableFrameDrafts();
  state.rangeIndices = [];
  state.loopRange = null;
  timelineUI?.destroy();
  $("timeline").replaceChildren();
  const TimelineClass =
    state.settings.timelineMode === "simple" ? SimpleTimeline : Timeline;
  timelineUI = new TimelineClass($("timeline"), editor, {
    getSettings: () => state.settings,
    audioEngine,
    onCameraMotionPreview: clip => cameraMotionControls?.previewTimeline(clip),
    onTogglePlay: play,
    onionController,
    onAddFrame: () => actions["add-frame"](),
    onDeleteLayer: id => changeFigureLayer('Delete layer',options=>editor.deleteLayerAsync(id,options)),
    hotkeys,
    runClipboardOperation,
    sharedClipboard,
    confirmDiscardFrame: () =>
      new Promise((resolve) => {
        showDialog(
          "Discard frame changes?",
          '<p>Restore the frame to its saved pose? You can undo this change.</p><div class="dialog-actions"><button class="button" id="keep-frame-draft">Keep changes</button><button class="button primary" id="discard-frame-draft">Discard</button></div>',
        );
        const cancel = () => resolve(false);
        $("dialog").addEventListener("close", cancel, { once: true });
        $("keep-frame-draft").onclick = () => closeDialog();
        $("discard-frame-draft").onclick = () => {
          resolve(true);
          closeDialog();
        };
      }),
    onTrackSelect: selectTrack,
    onKeysChange: () => {
      state.inspectorTab = "animation";
      if (!["camera", "scene"].includes(state.inspectorContext))
        state.inspectorContext = "frame";
      queueUI();
    },
    renderThumbnail: (index, canvas, options) =>
      thumbnailRenderer.renderThumbnail(index, canvas, {
        ...options,
        storedFrames: !editor.report._styk?.layerSheet && state.settings.timelineMode === "simple",
      }),
    onInsertInbetween: (indices) => {
      finishKeyboardHandle();
      pause();
      cancelDrag();
      propertyControls?.cancel();
      inbetweenDialog ??= new InsertInbetweenDialog({
        editor,
        getSettings: () => state.settings,
        renderThumbnail: (index, canvas, options) =>
          thumbnailRenderer.renderThumbnail(index, canvas, {
            ...options,
            storedFrames: !editor.report._styk?.layerSheet && state.settings.timelineMode === "simple",
          }),
        onApply: queueUI,
        onClose: queueUI,
        onError: fail,
      });
      inbetweenDialog.open(indices);
    },
    onUpdateFrame: () => {
      if (editor.dragging) editor.commitDrag();
      queueUI();
    },
    onSeek: () => pause(),
    // Wait for both preparation and its canvas submission before another seek.
    // The timeline retains only the latest pointer target during this interval.
    canScrub: () => !state.editablePreparing && !state.dirtyRender,
    onScrubStart: () => {
      pause();
      interruptRecovery();
      clearTimeout(warmTimer);
      state.scrubbing = true;
      const drawing=drawingResourcesFor(editor.report);if(drawing)drawing.busy=true;
      requestRender();
    },
    onScrub: tick => {
      previewScrub(tick);
      if (timelineUI?.audio?.scrub.checked && performance.now() - audioScrubAt > 100) {
        audioScrubAt = performance.now(); audioScrubController?.abort(); const controller = audioScrubController = new AbortController();
        const time = tick / audioFps(editor.report);
        void audioEngine.unlock().then(() => audioEngine.prepare(editor.report, {start:time, end:time+.08, signal:controller.signal}))
          .then(() => { if (!controller.signal.aborted) return audioEngine.start(time,time+.08); })
          .catch(error => { if (!controller.signal.aborted) fail(error); });
      }
    },
    onScrubEnd: () => {
      audioScrubController?.abort(); audioEngine.stop();
      state.scrubbing = false;
      const drawing=drawingResourcesFor(editor.report);if(drawing)drawing.busy=false;
      queueUI();
      requestRender();
      warmPlayback();
      if (editor.dirty) scheduleRecovery();
    },
    onError: fail,
    onRangeChange: (indices) => {
      state.rangeIndices = indices;
      if (!state.scrubbing) renderInspector();
      $("selection-summary").textContent =
        `${indices.length} keyframe${indices.length === 1 ? "" : "s"} selected`;
    },
    onLoopRangeChange: (range) => {
      pause();
      state.loopRange = range;
      warmPlayback();
    },
  });
  // Zoom lives beside frame navigation in the advanced timeline itself.
  $("timeline-zoom").closest(".timeline-actions").hidden = true;
  $("timeline")
    .closest(".timeline-panel")
    .classList.toggle("simple-mode", state.settings.timelineMode === "simple");
  window.styk.timeline = timelineUI;
  refreshHotkeyHints(hotkeys);
}
async function init() {
  if (desktop?.activateDocument) {
    const activation = desktop.activateDocument({});
    documentActivation = activation.catch(() => {});
    state.documentToken = (await activation).documentToken;
  }
  const settingsValue = window.stykInitialEditorSettings
    ? await window.stykInitialEditorSettings
    : desktop?.getEditorSettings
    ? await desktop.getEditorSettings()
    : undefined;
  appLocalization = new AppLocalization({ locale: settingsValue?.locale });
  editorSettings = new EditorSettings({
    value: settingsValue,
    localization: appLocalization.localization,
    onChange: (patch, next) => {
      const previousMode = state.settings.timelineMode;
      const previousSettings = state.settings;
      state.settings = next;
      try { if (previousMode !== next.timelineMode) mountTimeline(); }
      catch (error) { state.settings = previousSettings; throw error; }
      if (patch.rendererMode !== undefined && state.renderer) void recoverCanvas(true);
      if (patch.playbackQuality !== undefined && state.playing) selectPlaybackQuality();
      if (patch.hotkeys) { hotkeys.setBindings(next.hotkeys); refreshHotkeyHints(hotkeys); }
      onionController.sync();
      if (patch.motionPathRange !== undefined || patch.motionPathAllTargets !== undefined) pathCache.clear();
      state.handles = drawingController?.active ? false : next.showHandles;
      state.loop = next.loopPlayback;
      state.motionPaths = next.motionPaths;
      pathControls?.sync();
      canvasGuides?.sync();
      $("paths-button")?.classList.toggle("active", state.motionPaths);
      if (!state.motionPaths) { state.hoverPathPoint = null; pathCache.clear(); }
      appLocalization.setLocale(next.locale);
      blueHandles = null;
      scheduleRecovery();
      requestRender();
      queueUI();
    },
    onPersist: desktop?.setEditorSettings
      ? (value) => desktop.setEditorSettings(value)
      : undefined,
    onResetWorkspace: () => workspaceLayout?.reset(),
    onPrivacy: desktop?.getTelemetryState ? () => privacyUI.open() : undefined,
    onFeedback: desktop?.sendTelemetryFeedback ? options => feedbackUI.open(options) : undefined,
    onDonate: desktop?.openDonate ? () => desktop.openDonate() : undefined,
  });
  state.settings = editorSettings.value;
  hotkeys.setBindings(state.settings.hotkeys);
  window.styk.hotkeys = hotkeys;
  appLocalization.bindChrome();
  refreshHotkeyHints(hotkeys);
  appLocalization.updatePlayback($("play-button"), state);
  window.styk.localization = appLocalization;
  state.handles = state.settings.showHandles;
  state.loop = state.settings.loopPlayback;
  state.motionPaths = state.settings.motionPaths;
  window.styk.settingsUI = editorSettings;
  onionControls = new OnionControls({button: $("onion-settings-button"), toggleButton: $("onion-button"), controller: onionController});
  window.styk.onionController = onionController;
  pathControls = new MotionPathControls({button: $("paths-button"),
    getSettings: () => state.settings, getEnabled: () => state.motionPaths,
    onChange: patch => editorSettings.commit(patch), onToggle: () => actions["toggle-motion-paths"]()});
  window.styk.tweener = tweenerControls = new TweenerControls({button: $('tweener-button'), editor, viewport,
    getTool: () => state.tool, onSelect: () => setTool('tweener'),
    beforeEdit: () => propertyControls?.commit(), onError: fail});
  canvasGuides = new CanvasGuides({button: $('canvas-guides-button'), viewport,
    getState: () => ({settings: state.settings, view: state.view, report: editor.report,
      hidden: state.playing || state.previewing}),
    onChange: patch => editorSettings.commit(patch)});
  window.styk.onionCache = onionCache;
  const preferences = desktop?.getWorkspacePreferences
    ? await desktop.getWorkspacePreferences()
    : undefined;
  workspaceLayout = initWorkspaceLayout({
    preferences,
    onPersist: desktop?.setWorkspacePreferences
      ? (snapshot) => desktop.setWorkspacePreferences(snapshot)
      : undefined,
    onPersistError: (error) => status(error.message, true),
  });
  window.styk.workspace = workspaceLayout;
  editor.setLayerMigrationPlanner((params, options) => {
    syncPlayback();
    return playback.planLayerMigration(params, options);
  });
  editor.setInbetweenPlanner((params, options) => {
    syncPlayback();
    return playback.planInsertInbetweens(params, options);
  });
  cameraMotionControls = new CameraMotionControls($('inspector'),editor,{onError:fail,onRender:()=>{queueUI();requestRender();},beforeEdit:()=>{pause();interruptRecovery();propertyControls?.commit();},onPreview:clip=>{pause();editor.seek(clip.start);state.motionPreviewRange={start:clip.start,end:Math.min(editor.totalTicks,clip.start+clip.duration)};play();},getResources:()=>state.renderer?.resources});
  propertyControls = new PropertyControls($("inspector"), {
    canHandle: (key, input) =>
      (drawingController?.active&&key.startsWith('draw:')) || cameraMotionControls.handlesProperty(input) || Boolean(propertyChannel(key)) || canEditNativeProperty(editor, key),
    getValue: (key, input) => {
      if(key.startsWith('draw:'))return drawingController.propertyValue(key);
      if (cameraMotionControls.handlesProperty(input)) return cameraMotionControls.propertyValue(input);
      const value = propertyState(key).value;
      return (
        value ??
        getNativePropertyValue(editor, key, { bounds: selectionBounds })
      );
    },
    begin: ({ key, element }) => {
      if(key.startsWith('draw:')){drawingController.finish();return {drawing:key,initial:drawingController.propertyValue(key)};}
      pause();
      interruptRecovery();
      if (cameraMotionControls.handlesProperty(element)) return { cameraMotion: cameraMotionControls.beginProperty(element) };
      const branch = usesBuilderBranch() || editor.selectedSegmentIds.size > 1;
      const binding =
        branch && ["thickness", "segment_opacity", "segment_gradient_opacity"].includes(key)
          ? null
          : propertyChannel(key);
      if (binding && (editor.propertyChannels || binding.property === 'zIndex')) {
        editor.beginAnimationEdit(
          binding.target,
          binding.property,
          binding.options,
        );
        const indices=rangeFrames();return { binding, indices, ticks:indices?.sheetTicks };
      }
      return {
        native: beginNativePropertyEdit(editor, key, {
          bounds: selectionBounds,
          indices: rangeFrames(),
          rangeMode: "absolute",
          branch,
        }),
      };
    },
    preview: ({ value, token }) => {
      if(token.drawing)return drawingController.propertySet(token.drawing,value);
      if (token.cameraMotion) return cameraMotionControls.previewProperty(token.cameraMotion, value);
      if (token.binding)
        editor.previewAnimationEdit(token.binding.fromUI(value));
      else previewNativePropertyEdit(token.native, value);
      requestRender();
    },
    commit: ({ token, value }) => {
      if(token.drawing){drawingController.propertySet(token.drawing,value);queueUI();return;}
      if (token.cameraMotion) return cameraMotionControls.commitProperty(token.cameraMotion, value);
      if(token.binding&&token.ticks){editor.cancelAnimationEdit();editor.addAnimationKeys(token.ticks.map(tick=>({target:token.binding.target,property:token.binding.property,tick,value:token.binding.fromUI(value),...token.binding.options})));
      } else if (token.binding && token.indices?.length > 1) {
        editor.cancelAnimationEdit();editor.addAnimationKeys(token.indices.map(index=>({target:token.binding.target,property:token.binding.property,
          tick:editor.timeline[index].start,value:token.binding.fromUI(value),...token.binding.options})));
      } else if (token.binding) editor.commitAnimationEdit();
      else commitNativePropertyEdit(token.native);
      queueUI();
    },
    cancel: ({ token }) => {
      if(token?.drawing){drawingController.propertySet(token.drawing,token.initial);queueUI();return;}
      if (token?.cameraMotion) cameraMotionControls.cancelProperty(token.cameraMotion);
      else if (token?.binding) editor.cancelAnimationEdit();
      else if (token?.native) cancelNativePropertyEdit(token.native);
      queueUI();
      requestRender();
    },
    onError: fail,
  });
  window.styk.properties = propertyControls;
  vfxInspector=new VfxInspector({editor,root:$('vfx-panel'),properties:$('inspector'),context:()=>state.inspectorContext,beforeEdit:()=>{pause();interruptRecovery();propertyControls?.commit();},onChange:()=>{queueUI();requestRender();},onError:fail});
  window.styk.vfx=vfxInspector;
  vfxGizmos=new VfxGizmos({canvas:overlay,inspector:vfxInspector,editor,pickNativeHandle:event=>pick(worldPoint(event)),getOptions:()=>({report:editor.report,frame:currentFrame(),geometry:state.playing?null:editor.geometry,view:state.view,cameraEnabled:state.playing||state.previewing,playing:state.playing,vfxEnabled:state.vfxEnabled,resources:state.renderer?.resources}),onChange:()=>{queueUI();requestRender();},onError:fail});
  window.styk.vfxGizmos=vfxGizmos;
  $('vfx-preview').addEventListener('click',()=>{finishCurrentEdit();pause();state.vfxEnabled=!state.vfxEnabled;playback.setVfxEnabled(state.vfxEnabled);state.playbackPacket=null;state.editingPacket=null;state.renderer?.clearPreparedFrames?.();state.renderer.lastGeometry=null;$('vfx-preview').setAttribute('aria-pressed',String(state.vfxEnabled));requestRender();queueUI();});
  assetLibrary = new AssetLibrary($("asset-list"), {
    onAdd: (id) => {
      pause();
      if (builderMode?.active) return toast("Finish the figure or return to Animate to insert figures.");
      if (rangeFrames()) editor.addFigureInFrames(id, rangeFrames());
      else editor.addFigure(id);
      $("insert-dialog").close();
      setTool("select");
    },
    onError: fail,
    resources,
  });
  window.styk.assets = assetLibrary;
  window.styk.library = new UserLibrary({editor, desktop, exporter:documentExporter, importer, pause, finishEdit:finishCurrentEdit, setTool, vfxInspector, hotkeys});
  const libraryInsert = (asset, point) =>
    builderMode?.active ? toast("Finish the figure or return to Animate to insert figures.") : window.styk.library.insert(asset, point);
  installLibraryDrop(viewport, {position: worldPoint, insert: libraryInsert, onError: fail});
  installLibraryDrag(window.styk.library.grid, viewport, {
    getAsset: card => !window.styk.library.busy && window.styk.library.entries.find(item => item.path === card.dataset.libraryPath),
    onStart: asset => { window.styk.library.hoverPreview.stop(); window.styk.library.closeMenu(); window.styk.library.select(asset.path); },
    getDestination: (hit, asset) => window.styk.library.dragDestination(hit, asset),
    moveItem: (asset, folder) => window.styk.library.moveItem(asset, folder),
    position: worldPoint, insert: libraryInsert, onError: fail,
  });
  $('library-tab')?.addEventListener('click', () => telemetry.count('library'));
  actions['add-to-library'] = () => { telemetry.count('library'); return window.styk.library.run(() => window.styk.library.save()); };
  window.styk.movieclips = installMovieclipUI({editor,actions,pause,finishEdit:finishCurrentEdit,
    getTimeline:()=>timelineUI,setTool,onError:fail,queueUI,exportClip:()=>exportPivot('stykmov')});
  for (const [name, action] of Object.entries(actions)) if (name.startsWith('movieclip-')) actions[name] = (...args) => { telemetry.count('movieclip'); return action(...args); };
  editor.addEventListener('change',event=>{
    if(event.detail?.kind==='movieclip-scope' || event.detail?.movieclipScope) {
      mountTimeline(); state.inspectorContext=editor.object?'figure':'scene';state.inspectorTab='design';queueUI();
    }
  });
  builderMode = initBuilderMode({
    editor, state,
    host: {
      setTool, pause, finishCurrentEdit, cancelDrag, cancelPolygonDraft,
      cancelConstruction: () => construction?.cancel(),
      showDialog, closeDialog, toast, status, fail, queueUI, requestRender,
      showCommandMenu,
      commitSettings: patch => editorSettings.commit(patch),
      onModeChange: () => studioShell?.sync(),
    },
  });
  construction = createConstruction({editor,state,active:()=>Boolean(builderMode?.active),render:requestRender,project:screenPoint,onError:fail,commitSettings:patch=>editorSettings.commit(patch)});
  actions['chain-finish'] = () => construction.commit();
  actions['chain-cancel'] = () => construction.cancel();
  window.styk.builder = builderMode;
  drawingController=new DrawingController({editor,state,overlay,viewport,onRender:requestRender,onUI:queueUI,onError:fail,onStatus:toast,beforeEdit:()=>{finishCurrentEdit();interruptRecovery();},getResources:()=>resources,getTimeline:()=>timelineUI,getClipboard:()=>sharedClipboard});
  window.styk.drawing=drawingController;
  studioShell = initStudioShell({editor, state, setTool, renderAssets, renderInspector, showCommandMenu,
    actions, setTimelineMode: mode => editorSettings.commit({timelineMode:mode}), getTimeline: () => timelineUI,
    builder: builderMode, drawing:drawingController, toast});
  window.styk.studio = studioShell;
  if (desktop?.beginClipboardRead)
    nativeFrameClipboard = installNativeFrameClipboard(editor, desktop, {
      onError: fail,
      onRestored: queueUI,
    });
  thumbnailRenderer = new ThumbnailRenderer(editor, { onError: fail });
  sharedClipboard = new SharedClipboard(editor, desktop);
  window.styk.clipboard = sharedClipboard;
  window.styk.thumbnails = thumbnailRenderer;
  mountTimeline();
  try {
    state.renderer = await createRenderer(canvas, rendererOptions());
  } catch (error) {
    // A failure during context configuration leaves this canvas GPU-only.
    const replacement = canvas.cloneNode(false);
    canvas.replaceWith(replacement); canvas = replacement;
    state.renderer = await createRenderer(canvas, {...rendererOptions(), forceCanvas2D: true, fallbackReason: error.message});
  }
  new ResizeObserver(resize).observe(viewport);
  resize();
  fit();
  updateUI();
  status("Ready");
  window.styk.ready = true;
  window.styk.telemetry = telemetry;
  window.styk.privacyUI = privacyUI;
  updateNotice = new UpdateUI(desktop, { onRestart: () => actions['restart-update']() });
  void releaseSplash.open({ startup: true }).catch(console.warn);
  void telemetryInit.then(info => {
    telemetry.timing('startup_ms', performance.now());
    if (info && !info.decided) {
      const offer = () => { if (document.querySelector('dialog[open]')) return; document.removeEventListener('close', offer, true); void privacyUI.open({ firstRun: true }).catch(() => {}); };
      document.addEventListener('close', offer, true); setTimeout(offer, 300);
    }
  });
  warmPlayback();
  offerRecovery();
  try {
    const data = await (await api("/api/samples")).json();
    state.samples = data.samples || [];
    renderAssets();
  } catch (error) {
    status("Editor ready · File service unavailable", true);
    console.warn(error);
  }
}
function scheduleGpuRecovery() {
  if (gpuRecoveryTimer !== undefined) return;
  // Two accelerated attempts; exhausting them selects software immediately.
  // Count the fallback too, so recovery does not confuse it with the last retry.
  const delay = GPU_RECOVERY_DELAYS[gpuRecoveryAttempts++] ?? 0;
  gpuRecoveryTimer = setTimeout(() => {
    gpuRecoveryTimer = undefined;
    recoverCanvas().catch(error => {
      $("renderer-error").querySelector('p').textContent = 'The canvas could not reconnect. Your animation is still here and can be saved.';
      status(error.message, true);
    });
  }, delay);
}
function recoverCanvas(refreshGpuBudget) {
  // Queue behind an in-flight recovery so a device lost mid-reconnect retries.
  if (rendererRecovery) return rendererRecovery.finally(() => recoverCanvas(refreshGpuBudget));
  clearTimeout(gpuRecoveryTimer); gpuRecoveryTimer = undefined;
  if (refreshGpuBudget) gpuRecoveryAttempts = 0;
  rendererRecovery = (async () => {
    // A canvas cannot switch context types. Replace only the scene surface;
    // document/history and pointer handlers on the overlay remain available.
    editablePreparation.cancel();
    state.editingPacket = null;
    playback.invalidate();
    state.renderer?.destroy();
    const replaceCanvas = () => {
      const replacement = canvas.cloneNode(false);
      canvas.replaceWith(replacement); canvas = replacement;
    };
    replaceCanvas();
    // An exhausted retry budget takes the software path until the renderer
    // stays healthy or explicit user action refreshes the budget.
    const forceCanvas2D = gpuRecoveryAttempts > GPU_RECOVERY_DELAYS.length || state.settings.rendererMode === "canvas";
    try {
      state.renderer = await createRenderer(canvas, {...rendererOptions(), forceCanvas2D});
    } catch (error) {
      // Initialization may fail after acquiring a WebGPU canvas context.
      replaceCanvas();
      state.renderer = await createRenderer(canvas, {...rendererOptions(), forceCanvas2D: true,
        fallbackReason: `Graphics reconnection failed: ${error.message}`});
    }
    clearTimeout(gpuStableTimer);
    telemetry.performance.recovery('gpu','recovered');
    gpuStableTimer = setTimeout(() => { gpuRecoveryAttempts = 0; }, GPU_STABLE_MS);
    $("renderer-error").hidden = true;
    resize(); requestRender();
  })().finally(() => {rendererRecovery = null;});
  return rendererRecovery;
}
function rendererOptions() {
  return {
    diagnosticsEnabled:()=>telemetry.consent.diagnostics&&telemetry.isForeground,
    measurementContext:()=>({...telemetry.performance.context(),epoch:telemetry.epoch}),
    onGpuTiming:(ms,context)=>{if(context.epoch===telemetry.epoch)telemetry.performance.record('gpu',ms,context);},
    onGpuTimingSupport:supported=>telemetry.performance.supported('gpu',supported),
    onRecovery:(kind,outcome)=>telemetry.performance.recovery(kind,outcome),
    resources,
    forceCanvas2D: state.settings.rendererMode === "canvas",
    allowSoftwareAdapter: state.settings.rendererMode === "gpu",
    onInvalidate: requestRender,
    onStatus: (message) => {
      const compatibility = message.backend === "Canvas 2D fallback";
      $("renderer-label").classList.toggle("compatibility", compatibility);
      $("renderer-label").textContent = compatibility
        ? "Compatibility mode"
        : message.backend || "WebGPU";
      $("renderer-label").title = compatibility
        ? `${message.reason || "WebGPU is unavailable."} Canvas compatibility rendering is active.`
        : "";
      status(
        typeof message === "string" ? message : message.message || "Ready",
      );
      if (message.backend === "WebGPU device lost") {
        telemetry.performance.recovery('gpu','started');telemetry.performance.incident('gpu');
        telemetry.count('gpu_errors');
        telemetry.error(Object.assign(new Error('The graphics device was lost.'), { name: 'GPUError', telemetryCode: 'device_lost' }), 'gpu');
        pause();
        propertyControls?.cancel();
        cancelDrag();
        editor.cancelDrag();
        editor.cancelAnimationEdit();
        keyboardHandleGesture = null;
        heldArrows.clear();
        state.handleEditHeld = false;
        state.space = false;
        state.spacePanned = false;
        state.isolateHeld = false;
        state.hoverHandle = null;
        state.hoverCameraHandle = null;
        viewport.classList.toggle("panning", state.tool === "hand");
        $("renderer-error").hidden = false;
        $("renderer-error").innerHTML =
          '<p>The graphics device was reset. Reconnecting your canvas…</p><button class="button" id="retry-renderer">Reconnect canvas</button>';
        $("retry-renderer").onclick = guarded(() => recoverCanvas(true));
        scheduleGpuRecovery();
      }
    },
  };
}
init().catch((error) => {
  $("renderer-error").hidden = false;
  $("renderer-error").textContent = error.message;
  fail(error);
});

installColorPickers((input, event) => {
  if(input.dataset.paletteColor!==undefined){
    const uid=editor.selectedUid,figure=editor.figure,report=editor.report,tick=editor.tick;
    const entry=editor.figurePalette().find(entry=>entry.color===input.dataset.paletteColor);
    if(!entry)return false;
    return {anchor:input,paint:{type:'solid',stops:[{offset:0,color:parseColor(entry.color).color,opacity:1}]},gradients:false,alpha:false,onChange:paint=>{
      if(editor.report!==report||editor.selectedUid!==uid||editor.figure!==figure||editor.tick!==tick)throw new Error('Selection changed. Reopen the palette.');
      pause();editor.replaceFigureColor(entry.color,paint.stops[0].color,{targets:entry,indices:rangeFrames()});
    }};
  }
  if(input.id==='figure-color'){
    const report=editor.report,tick=editor.tick,uids=[...editor.selectedUids].join(',');let previous=input.value,previousOpacity=1-(editor.object.field28??0)/255;
    return {anchor:input,paint:{type:'solid',stops:[{offset:0,color:parseColor(input.value).color,opacity:1-(editor.object.field28??0)/255}]},gradients:false,onChange:paint=>{
      if(editor.report!==report||editor.tick!==tick||[...editor.selectedUids].join(',')!==uids)throw new Error('Selection changed. Reopen the color picker.');
      const value=hexColor(paint.stops[0].color),opacity=paint.stops[0].opacity;pause();editor.setFigureColor(value===previous&&opacity!==previousOpacity?undefined:value,{indices:rangeFrames(),opacity});previous=value;previousOpacity=opacity;
    }};
  }
  if (input.id === 'segment-color') {
    const uid=editor.selectedUid, joint=editor.selectedJoint, figure=editor.figure;
    return {anchor:input, paint:displayedSegmentPaint(editor.report,figure,editor.object,resolveInstanceFigure(figure,editor.object).segments[joint]), onChange:paint=>{
      if(editor.selectedUid!==uid || editor.selectedJoint!==joint || editor.figure!==figure) throw new Error('Selection changed. Reopen the color picker.');
      pause(); updateBuilderStyle({paint},event);
    }};
  }
  if(input.id==='background-color'){
    const bg=editor.report.backgrounds?.find(b=>b.background_id===editor.frame.background_id),override=editor.frame._stykBackgroundColor;
    return {anchor:input,paint:backgroundPaint(override===undefined?bg:{kind:2,color:override}),onChange:paint=>{
      if(paint.type==='solid')editor.setSceneColor(paintBackground(paint).color,{indices:rangeFrames()});
      else editor.importSceneBackground({...paintBackground(paint),name:paint.type+' gradient'},{indices:rangeFrames()});
    }};
  }
  if(input.dataset.polygonColor!==undefined){const index=Number(input.dataset.polygonColor),p=resolveInstanceFigure(editor.figure,editor.object).polyfills[index];return {anchor:input,gradients:false,paint:{type:'solid',stops:[{offset:0,color:displayedColor(editor.report,editor.figure,editor.object,p.color_rgb),opacity:p.alpha_raw!==undefined?1-p.alpha_raw/255:p.color_alpha??1}]},onChange:paint=>editor.updatePolygon(index,{color:paint.stops[0].color,opacity:paint.stops[0].opacity})};}
  const pairs = {'background-first':'background-alpha','background-second':'background-alpha-b','text-color':'text-opacity','figure-color':'figure-opacity'};
  const opacityId=pairs[input.id], opacity=opacityId && document.getElementById(opacityId);
  if(opacity) return {anchor:input,paint:{type:'solid',stops:[{offset:0,color:parseColor(input.value).color,opacity:Number(opacity.value)/100}]},gradients:false,onChange:paint=>{
    const current=document.getElementById(input.id); if(!current)return;
    current.value=hexColor(paint.stops[0].color); current.dispatchEvent(new Event('input',{bubbles:true}));current.dispatchEvent(new Event('change',{bubbles:true}));
    const field=document.getElementById(opacityId);if(field){field.value=paint.stops[0].opacity*100;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}
  }};
}, {surface:()=>overlay,sample:sampleCanvasColor});
