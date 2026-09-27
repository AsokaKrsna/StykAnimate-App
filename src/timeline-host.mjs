/**
 * The timeline island's host (architecture.md §3.14): mounts the Simple or
 * Advanced timeline into #timeline with the app's callbacks, wires the
 * header's own controls (the mode switch #timeline-workflow, the frame rate
 * #fps and the zoom #timeline-zoom), and writes what the header shows: the
 * transport's readouts (#time-display, the hidden #timeline-summary and
 * #frame-badge, #fps), the play button's state, Edit selected frames
 * (#range-edit) and which mode is pressed.
 *
 * The timeline components (layer-timeline.mjs, sheet-filmstrip.mjs) stay the
 * engines; this module is the one place that constructs them. DOM-free at
 * import: createTimelineHost() wires the header when it is called.
 *
 * ctx (from app.mjs): {editor, state, $, actions, guarded, audioEngine,
 * onionController, hotkeys, play, pause, finishKeyboardHandle, cancelDrag,
 * cancelPolygonDraft, interruptRecovery, cancelWarmPlayback, warmPlayback,
 * scheduleRecovery, requestRender, queueUI, renderInspector,
 * syncSelectionControls, rangeFrames(all), selectTrack, previewScrub,
 * scrubAudio(tick), stopAudioScrub(), changeFigureLayer,
 * runClipboardOperation, confirmDiscardFrame, simpleFrameCount, fail,
 * setTimelineMode(mode), onMount(timeline), and getters for what app.mjs
 * creates later: propertyControls(), cameraMotionControls(), drawing(),
 * builder(), sharedClipboard(), thumbnails(), localization()}.
 */
import {Timeline} from './layer-timeline.mjs';
import {SheetFilmstrip as SimpleTimeline} from './sheet-filmstrip.mjs';
import {InsertInbetweenDialog} from './insert-inbetween-dialog.mjs';
import {drawingResourcesFor} from './drawing-resources.mjs';
import {refreshHotkeyHints} from './hotkey-hints.mjs';
import {icon} from './icons.mjs';

export function createTimelineHost(ctx) {
  const {editor, state, $, actions} = ctx;
  let timeline = null, inbetweenDialog;

  // The header's own controls.
  $("fps").addEventListener(
    "change",
    ctx.guarded((e) => editor.setFPS(Number(e.target.value))),
  );
  $("timeline-zoom").addEventListener("input", (e) =>
    timeline?.setZoom?.(Number(e.target.value), undefined, true),
  );
  // Typing a frame rate or working in the timeline ends a polygon being drawn.
  for (const id of ["timeline", "fps"]) {
    $(id).addEventListener("focusin", ctx.cancelPolygonDraft);
    $(id).addEventListener("pointerdown", ctx.cancelPolygonDraft, true);
  }
  $("timeline-workflow").addEventListener("click", (event) => {
    const button = event.target.closest("[data-timeline-mode]");
    if (button) ctx.setTimelineMode(button.dataset.timelineMode);
  });

  const renderThumbnail = (index, canvas, options) =>
    ctx.thumbnails().renderThumbnail(index, canvas, {
      ...options,
      storedFrames: !editor.report._styk?.layerSheet && state.settings.timelineMode === "simple",
    });

  /** Replaces the timeline with a new one for the current mode; returns it. */
  function mount() {
    ctx.pause();
    ctx.finishKeyboardHandle();
    ctx.propertyControls()?.commit();
    if (editor._animationEdit) editor.commitAnimationEdit();
    if (editor.dragging) editor.commitDrag();
    if (state.settings.timelineMode === "advanced") editor.disableFrameDrafts();
    state.rangeIndices = [];
    state.applyRange = false;
    state.loopRange = null;
    timeline?.destroy();
    $("timeline").replaceChildren();
    const TimelineClass =
      state.settings.timelineMode === "simple" ? SimpleTimeline : Timeline;
    timeline = new TimelineClass($("timeline"), editor, {
      getSettings: () => state.settings,
      audioEngine: ctx.audioEngine,
      onCameraMotionPreview: clip => ctx.cameraMotionControls()?.previewTimeline(clip),
      onTogglePlay: ctx.play,
      onHistory: direction => actions[direction](),
      onCancel: () => ctx.drawing()?.cancel(),
      onionController: ctx.onionController,
      onAddFrame: () => actions["add-frame"](),
      onDeleteLayer: id => ctx.changeFigureLayer('Delete layer',options=>editor.deleteLayerAsync(id,options)),
      hotkeys: ctx.hotkeys,
      runClipboardOperation: ctx.runClipboardOperation,
      sharedClipboard: ctx.sharedClipboard(),
      confirmDiscardFrame: ctx.confirmDiscardFrame,
      onTrackSelect: ctx.selectTrack,
      onKeysChange: () => {
        state.inspectorTab = "animation";
        if (!["camera", "scene"].includes(state.inspectorContext))
          state.inspectorContext = "frame";
        ctx.queueUI();
      },
      renderThumbnail,
      onInsertInbetween: (indices) => {
        ctx.finishKeyboardHandle();
        ctx.pause();
        ctx.cancelDrag();
        ctx.propertyControls()?.cancel();
        inbetweenDialog ??= new InsertInbetweenDialog({
          editor,
          getSettings: () => state.settings,
          renderThumbnail,
          onApply: ctx.queueUI,
          onClose: ctx.queueUI,
          onError: ctx.fail,
        });
        inbetweenDialog.open(indices);
      },
      onUpdateFrame: () => {
        if (editor.dragging) editor.commitDrag();
        ctx.queueUI();
      },
      onSeek: () => ctx.pause(),
      beforeCommand: () => ctx.drawing()?.settle({selection:true}),
      // Wait for both preparation and its canvas submission before another seek.
      // The timeline retains only the latest pointer target during this interval.
      canScrub: () => !state.editablePreparing && !state.dirtyRender,
      onScrubStart: () => {
        ctx.pause();
        ctx.interruptRecovery();
        ctx.cancelWarmPlayback();
        state.scrubbing = true;
        const drawing=drawingResourcesFor(editor.report);if(drawing)drawing.busy=true;
        ctx.requestRender();
      },
      onScrub: tick => {
        ctx.previewScrub(tick);
        ctx.scrubAudio(tick);
      },
      onScrubEnd: () => {
        ctx.stopAudioScrub();
        state.scrubbing = false;
        const drawing=drawingResourcesFor(editor.report);if(drawing)drawing.busy=false;
        ctx.queueUI();
        ctx.requestRender();
        ctx.warmPlayback();
        if (editor.dirty) ctx.scheduleRecovery();
      },
      onError: ctx.fail,
      onRangeChange: (indices) => {
        state.rangeIndices = indices;
        if (!ctx.rangeFrames(true)) state.applyRange = false;
        ctx.syncSelectionControls();
        if (!state.scrubbing) ctx.renderInspector();
        $("selection-summary").textContent =
          `${indices.length} keyframe${indices.length === 1 ? "" : "s"} selected`;
      },
      onLoopRangeChange: (range) => {
        ctx.pause();
        state.loopRange = range;
        ctx.warmPlayback();
      },
    });
    ctx.onMount?.(timeline);
    // Zoom lives beside frame navigation in the advanced timeline itself.
    $("timeline-zoom").closest(".timeline-actions").hidden = true;
    $("timeline")
      .closest(".timeline-panel")
      .classList.toggle("simple-mode", state.settings.timelineMode === "simple");
    syncMode();
    refreshHotkeyHints(ctx.hotkeys);
    return timeline;
  }

  /** The timeline island in the shell: a shown timeline refits its body. */
  function attach(shell) {
    shell.define({
      id: "timeline",
      root: () => $("animation-timeline"),
      onVisibility: (visible) => { if (visible) timeline?.resize(); },
    });
  }

  /** The transport's readouts and the frame rate; the timeline updates its playhead. */
  function updateTransport() {
    const fps = editor.report.fps,
      tick = editor.tick;
    $("time-display").textContent =
      `${String(Math.floor(tick / fps / 60)).padStart(2, "0")}:${String(Math.floor(tick / fps) % 60).padStart(2, "0")}:${String(tick % fps).padStart(2, "0")}`;
    $("frame-badge").textContent = `FRAME ${String(tick + 1).padStart(2, "0")}`;
    // Simple mode counts Pivot-style timeline frames; playback, the ruler and
    // export count every frame including inbetweens. Name both explicitly.
    const stored = ctx.simpleFrameCount(), total = editor.totalTicks,
      seconds = `${(total / fps).toFixed(2)}s`;
    $("timeline-summary").textContent = stored !== null && stored !== total
      ? `${stored} ${stored === 1 ? "frame" : "frames"} · plays as ${total} with inbetweens · ${seconds}`
      : `${total} ${total === 1 ? "frame" : "frames"} · ${seconds}`;
    $("fps").value = fps;
    timeline?.update(state.settings.timelineMode !== 'advanced');
  }

  /** Play, Pause while playing, Stop while previewing one frame. */
  function syncPlayButton() {
    const [glyph, label] = state.previewing ? ["stop", "Stop preview"] : state.playing ? ["pause", "Pause"] : ["play", "Play"];
    $("play-button").innerHTML = icon(glyph);
    $("play-button").setAttribute("aria-label", label);
    ctx.localization()?.updatePlayback($("play-button"), state);
  }

  /** Edit selected frames: on only while two or more frames are selected, outside Build and Draw. */
  function syncRangeEdit() {
    const indices = ctx.rangeFrames(true), count = indices?.sheetTicks?.length ?? indices?.length ?? 0;
    const range = $('range-edit');
    if (count < 2) state.applyRange = false;
    range.disabled = count < 2 || Boolean(ctx.builder()?.active || ctx.drawing()?.active);
    range.setAttribute('aria-pressed', String(!range.disabled && state.applyRange));
    range.querySelector('.range-edit-count').textContent = count > 1 ? String(count) : '';
    range.dataset.hotkeyTitle = count > 1
      ? 'Move figures and edit their properties across ' + count + ' frames, including the current frame'
      : 'Select multiple frames to edit them together';
    refreshHotkeyHints(ctx.hotkeys, range.parentElement);
  }

  /** Which of Simple and Advanced is pressed. */
  function syncMode() {
    document.querySelectorAll('[data-timeline-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.timelineMode===state.settings.timelineMode)));
  }

  return {
    get timeline() { return timeline; },
    mount, attach, updateTransport, syncPlayButton, syncRangeEdit, syncMode,
  };
}
