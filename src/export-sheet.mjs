/**
 * The export dialog (experience.md §5.14, architecture.md §3.15): a kit
 * dialog (src/ui/ui-dialog.mjs, `lg`, variant `export`) with a preview pane
 * and the form. The preview shows the animation (the first exported frame, or
 * the range playing with ▶), the trim strip with its two ink ends and the
 * typed From and To fields beside "Frames". The form: Quick presets (tiles
 * for YouTube, TikTok, a chat GIF…, export-presets.mjs, that fill in the rows
 * below), Name, Format (Video, GIF, Frames, Project), the chosen format's Type
 * (a visible select; a Project lists its four types) with a line saying what
 * it is for, Size (Original, 1080p, 720p, 4K, Custom…),
 * then the type's own settings: Quality, Colours, Sound, Picture and, for
 * video, Encoding (a titled section that remembers being open). The foot
 * sums up the output and names the format on the one primary ("Export MP4").
 *
 * The dialog holds one ExportRequest (export-request.mjs) and replaces it on
 * every edit (updateExportRequest); what the rows show, the validation and the
 * primary are derived from it. Nothing is read back from the DOM. The export
 * itself belongs to the caller (`onExport(request)`, export-flow.mjs); while
 * it runs the dialog shows its progress in place (showProgress). Capability
 * probing, the installed Windows codecs and the preview's frames come from
 * the caller too, so this module owns no export, codec or render state.
 *
 * While an export runs, Escape and × ask "Stop exporting?" first (#export-stop:
 * Keep exporting, the focused default, or Stop exporting); Cancel export in
 * the progress stops at once.
 *
 * Test hooks are today's ids (export-request.mjs EXPORT_FIELD_IDS and
 * EXPORT_ELEMENT_IDS), `[data-category]` on the Format items, option values
 * that are today's export actions in #output-format, and #export-dialog.
 */
import {createDialog} from './ui/ui-dialog.mjs';
import {installRovingFocus} from './ui/roving-focus.mjs';
import {kitText} from './ui/ui-strings.mjs';
import {EXPORT_SMOOTHING} from './export-sampling.mjs';
import {
  EXPORT_CATEGORIES, EXPORT_FIELD_IDS as FIELD, EXPORT_ELEMENT_IDS as ELEMENT, exportFormatInfo, formatForAction,
  initialExportRequest, updateExportRequest, reconcileExportCodecs, exportFormatStates, formatChoices, resolveFormatChoice,
  exportFieldVisibility, validateExportRequest, exportPrimaryLabel, exportEncodingSummary, exportSummary, exportPlayedFramesNote,
  exportWorkingPoseNote, entireAnimationPatch, exportCodecChoices, sizePresetChoices, exportTransparency, defaultExportName,
  exportFileName, exportPreferencesFromRequest, normalizeExportPreferences, exportTypeHint,
} from './export-request.mjs';
import {EXPORT_PRESETS, applyExportPreset, exportPresetHeld, exportPresetFit, exportPresetInfo} from './export-presets.mjs';

export const EXPORT_DIALOG_ID = 'export-dialog';
/** Quality: today's three presets (export-video-quality.mjs), smallest first; `hint` is the line under the row. */
const QUALITY = Object.freeze([
  {value: 'small', label: 'Draft', tip: 'Smaller file', hint: 'The smallest file, for quick previews and drafts.'},
  {value: 'recommended', label: 'Great', tip: 'Recommended', hint: 'Sharp, with a sensible file size. Right for most uses.'},
  {value: 'high', label: 'Max', tip: 'Higher quality', hint: 'The most detail, with a larger file. For uploads and final copies.'},
]);
const STRIP_CELLS = 8;
const PROGRESS_TITLE = 'Exporting animation';

const element = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'htmlFor') node.htmlFor = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (typeof value === 'boolean') node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(child => child !== null && child !== undefined && child !== false));
  return node;
};
const glyph = (icon, name) => {
  const template = document.createElement('template');
  template.innerHTML = icon?.(name) ?? '';
  return template.content.firstElementChild;
};
/** A form row: the label column and its control. */
const row = (label, control, {id, htmlFor} = {}) => element('div', {className: 'ui-dialog-row', id},
  element(htmlFor ? 'label' : 'span', {className: 'ui-row-label', text: label, htmlFor}), control);
const select = (id, label, icon, options = []) => {
  const node = element('select', {id, 'aria-label': label});
  for (const option of options) node.append(element('option', {value: option.value, text: option.label, title: option.title}));
  return {node, wrap: element('span', {className: 'ui-select'}, node, glyph(icon, 'chevron-down'))};
};
const switchRow = (id, label, text) => {
  const input = element('input', {type: 'checkbox', role: 'switch', className: 'ui-switch', id, 'aria-label': label});
  const caption = element('span', {text});
  return {input, caption, wrap: element('label', {className: 'export-toggle'}, caption, input)};
};
/** A value in a pixel box `maxWidth × maxHeight` with the artboard's shape. */
function fitCanvas(canvas, {canvasWidth, canvasHeight}, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / canvasWidth, maxHeight / canvasHeight);
  canvas.width = Math.max(1, Math.min(512, Math.round(canvasWidth * scale)));
  canvas.height = Math.max(1, Math.min(512, Math.round(canvasHeight * scale)));
}
const clampFrame = (value, total) => Math.max(1, Math.min(total, Math.round(value)));

/**
 * "Stop exporting?": the question Escape and × ask while an export runs.
 * ask(running) resolves true when the dialog may close (nothing is running, or
 * the person chose Stop exporting); dismiss() withdraws an open question when
 * the export ends by itself.
 */
function stopQuestion({overlays, icon, t}) {
  let prompt = null;
  return {
    async ask(running) {
      if (!running()) return true;
      if (prompt) return false;
      prompt = createDialog({size: 'sm', id: 'export-stop', title: 'Stop exporting?', description: 'The file will not be saved.', overlays, icon, t,
        actions: [{label: 'Keep exporting', cancel: true, variant: 'ghost', id: 'keep-exporting', autofocus: true},
          {label: 'Stop exporting', value: true, variant: 'danger', id: 'stop-export'}]});
      const answer = await prompt.showModal();
      prompt = null;
      return answer === true && running();
    },
    dismiss() { prompt?.close(null); prompt = null; },
  };
}

/**
 * Opens the export dialog. options:
 *   context      {canvasWidth, canvasHeight, totalFrames, fps, currentFrame (1-based), storedFrames
 *                 (simpleFrameCount(), null outside Simple), frameDraft, audioClips, audioSupported,
 *                 hasObject, movieclip, name, objectName, tick}
 *   preferences  the remembered exportPreferences (normalizeExportPreferences reads anything)
 *   defaultDither  defaultGIFDither(report): the Dither switch's start
 *   probe({width, height})   the export capabilities for a size (getExportCapabilities)
 *   createVfw({container, dialog, getDimensions, onChange})   the Windows AVI controls, or null
 *   preview      {render(tick, canvas, {signal}) → Promise<boolean>, dispose()} or null
 *   onExport(request)   runs the export (resolves when it ends or was not started)
 *   onPreferences(preferences)   stores the remembered choices
 *   overlays, icon, t   the overlay stack, the glyphs and the words
 * Returns the sheet: {element, request, states, open, closed (a promise), vfwContext(), showProgress(title), close()}.
 */
export function openExportSheet({context, preferences = null, defaultDither = false, probe, createVfw = null, preview = null,
  onExport, onPreferences = () => {}, overlays = null, icon = null, t = null}) {
  const {canvasWidth, canvasHeight, totalFrames, fps, currentFrame = 1, storedFrames = null, frameDraft = null,
    audioClips = [], audioSupported = false, hasObject = false, movieclip = false} = context;
  const board = {canvasWidth, canvasHeight, totalFrames};
  const nameContext = {name: context.name, objectName: context.objectName, tick: context.tick, movieclip};
  let remembered = normalizeExportPreferences(preferences);
  let vfw = null, capabilities = null, capabilityError = null, probeSequence = 0, probeTimer = null, closed = false;
  let request = null, states = null, exporting = null, onClosed = null, nameEdited = false;
  /** The chosen quick preset: {id, applied: the request choosing it gave}, until a setting it chose changes. */
  let preset = null;
  const lastType = new Map();

  // ---- The preview pane: the stage, the trim strip and its caption.
  const stageCanvas = element('canvas', {'aria-hidden': 'true'});
  fitCanvas(stageCanvas, board, 512, 288);
  const stage = element('div', {className: 'ui-export-stage', role: 'img', 'aria-label': 'Preview'}, stageCanvas);
  const cells = [];
  const cellCount = totalFrames > 1 ? Math.min(STRIP_CELLS, totalFrames) : 0;
  for (let index = 0; index < cellCount; index++) {
    const canvas = element('canvas', {'aria-hidden': 'true'});
    fitCanvas(canvas, board, 96, 60);
    const tick = cellCount === 1 ? 0 : Math.round(index * (totalFrames - 1) / (cellCount - 1));
    cells.push({tick, cell: element('i', {}, canvas), canvas});
  }
  const handle = edge => element('button', {type: 'button', className: 'ui-range-handle', role: 'slider', dataset: {edge, tooltip: 'Drag to trim'},
    'aria-label': edge === 'start' ? 'First exported frame' : 'Last exported frame', 'aria-controls': edge === 'start' ? FIELD.from : FIELD.to,
    'aria-valuemin': '1', 'aria-valuemax': String(Math.max(1, totalFrames))});
  const startHandle = handle('start'), endHandle = handle('end');
  const strip = element('div', {className: 'ui-range-strip', role: 'group', 'aria-label': 'Frames to export'}, ...cells.map(entry => entry.cell), startHandle, endHandle);
  const playButton = element('button', {type: 'button', className: 'ui-icon-button', id: 'export-play', dataset: {variant: 'soft', size: 'sm', shape: 'round'},
    'aria-label': 'Play preview', 'aria-pressed': 'false'}, glyph(icon, 'play'));
  const frameField = (id, label, text) => {
    const input = element('input', {className: 'ui-field-input', id, type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': label});
    return {input, wrap: element('span', {className: 'ui-field export-frame-field', dataset: {size: 'sm'}}, element('label', {className: 'ui-field-label', htmlFor: id, text}), input)};
  };
  const fromField = frameField(FIELD.from, 'First frame', 'From'), toField = frameField(FIELD.to, 'Last frame', 'To');
  const allFrames = element('button', {type: 'button', className: 'ui-button', id: ELEMENT.allFrames, dataset: {variant: 'ghost', size: 'sm', tooltip: 'Use the entire animation'}, text: 'All'});
  const captionLabel = element('span', {className: 'export-caption-label', text: 'Frames'});
  const range = element('span', {className: 'export-caption-range'}, fromField.wrap, toField.wrap, allFrames);
  const caption = element('div', {className: 'ui-export-caption'}, playButton, captionLabel, range);
  const note = element('p', {className: 'export-note export-preview-note'});
  const previewPane = element('div', {className: 'ui-export-preview'}, stage, strip, caption, note);

  // ---- Quick presets: where the animation is going. A preset is an edit of the request (export-presets.mjs); it shows
  // chosen until a setting it chose is changed. The note under it says what the export will be, or why it will show with bars.
  const presetList = element('div', {className: 'export-presets', role: 'radiogroup', 'aria-labelledby': 'export-presets-label', id: 'export-presets'},
    ...EXPORT_PRESETS.map(entry => element('button', {type: 'button', className: 'export-preset', role: 'radio', 'aria-checked': 'false',
      dataset: {preset: entry.id}, 'aria-label': `${entry.label}: ${entry.detail}`},
    glyph(icon, entry.icon), element('span', {className: 'export-preset-label', text: entry.label}), element('span', {className: 'export-preset-detail', text: entry.detail}))));
  const presetNote = element('p', {className: 'export-preset-note', id: 'export-preset-note', role: 'status', 'aria-live': 'polite', hidden: true});
  const presets = element('section', {className: 'export-preset-section', 'aria-labelledby': 'export-presets-label'},
    element('h3', {className: 'export-section-label', id: 'export-presets-label', text: 'Quick presets'}), presetList, presetNote);

  // ---- The form rows.
  const name = element('input', {className: 'ui-field-input', id: 'export-name', type: 'text', autocomplete: 'off', spellcheck: false, maxLength: 200, 'aria-label': 'File name'});
  const extension = element('span', {className: 'ui-field-unit export-extension'});
  const nameRow = row('Name', element('span', {className: 'ui-field'}, name, extension), {htmlFor: 'export-name'});
  const categories = element('div', {className: 'ui-segmented', role: 'radiogroup', 'aria-label': 'Format', id: 'export-format', dataset: {fill: ''}},
    ...EXPORT_CATEGORIES.map(category => element('button', {type: 'button', className: 'ui-segmented-item', role: 'radio', 'aria-checked': 'false',
      dataset: {category: category.id, tooltip: category.label}, text: category.short})));
  const formatRow = row('Format', categories);
  const type = select(ELEMENT.format, 'Export format', icon);
  const typeRow = row('Type', type.wrap, {htmlFor: ELEMENT.format});
  const projectList = element('div', {className: 'export-types', role: 'radiogroup', 'aria-label': 'Project type', id: 'export-project-type'});
  const projectRow = row('Type', projectList);
  projectRow.classList.add('export-row-list');
  const sizeChoices = sizePresetChoices(board);
  const size = select(FIELD.sizePreset, 'Size', icon, sizeChoices.map(choice => ({value: choice.id, label: choice.label, title: choice.reason || undefined})));
  sizeChoices.forEach((choice, index) => { size.node.options[index].disabled = choice.disabled; });
  const sizeRow = row('Size', size.wrap, {htmlFor: FIELD.sizePreset});
  const pixelField = (id, label, text) => {
    const input = element('input', {className: 'ui-field-input', id, type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': label});
    return {input, wrap: element('span', {className: 'ui-field'}, element('label', {className: 'ui-field-label', htmlFor: id, text}), input)};
  };
  const widthField = pixelField(FIELD.width, 'Export width (px)', 'Width'), heightField = pixelField(FIELD.height, 'Export height (px)', 'Height');
  const lock = element('input', {type: 'checkbox', id: FIELD.lockRatio, className: 'export-lock-input', 'aria-label': 'Lock ratio'});
  const lockToggle = element('label', {className: 'ui-icon-button export-lock', dataset: {size: 'sm', tooltip: 'Lock ratio: width and height change together'}}, glyph(icon, 'link'), lock);
  const customRow = row('', element('span', {className: 'export-size-custom'}, widthField.wrap, lockToggle, heightField.wrap));
  const quality = element('div', {className: 'ui-segmented', role: 'radiogroup', 'aria-label': 'Quality', id: FIELD.videoQuality, dataset: {fill: ''}},
    ...QUALITY.map(option => element('button', {type: 'button', className: 'ui-segmented-item', role: 'radio', 'aria-checked': 'false',
      dataset: {value: option.value, tooltip: option.tip}, text: option.label})));
  const qualityRow = row('Quality', quality);
  // What the chosen type and quality are for, under their rows (a person who does not know the formats chooses by these).
  const typeHint = element('p', {className: 'export-hint', id: 'export-type-hint'});
  const qualityHint = element('p', {className: 'export-hint', id: 'export-quality-hint'});
  type.node.setAttribute('aria-describedby', typeHint.id);
  projectList.setAttribute('aria-describedby', typeHint.id);
  quality.setAttribute('aria-describedby', qualityHint.id);
  const jpeg = element('input', {className: 'ui-field-input', id: FIELD.jpegQuality, type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'JPEG quality (%)'});
  const jpegRow = row('Quality', element('span', {className: 'ui-field'}, jpeg, element('span', {className: 'ui-field-unit', text: '%'})), {htmlFor: FIELD.jpegQuality});
  const dither = switchRow(FIELD.dither, 'Dither (GIF)', 'Dither');
  dither.wrap.dataset.tooltip = 'Smoother gradients and photographs, a larger file';
  const colourRow = row('Colours', dither.wrap);
  const soundNames = context.soundNames ?? [];
  const sound = switchRow(FIELD.audio, 'Include sound', soundNames.length === 1 ? soundNames[0] : soundNames.length ? `${soundNames.length} sounds` : 'Include sound');
  const soundRow = row('Sound', sound.wrap);
  const smoothing = select(FIELD.smoothing, 'Edges', icon, EXPORT_SMOOTHING.map(option => ({value: option.value, label: option.label, title: option.description})));
  const transparent = switchRow('export-transparent', 'Transparent background', 'Transparent');
  transparent.input.disabled = true;
  const transparentReason = element('p', {className: 'export-reason', id: 'export-transparent-reason'});
  transparent.input.setAttribute('aria-describedby', transparentReason.id);
  const pictureRow = row('Picture', element('span', {className: 'export-inline'}, smoothing.wrap, transparent.wrap));
  pictureRow.append(transparentReason);

  const mp4Codec = select(FIELD.mp4Codec, 'MP4 codec', icon), aviCodec = select(FIELD.aviCodec, 'AVI codec', icon);
  const bitrateMode = select(FIELD.bitrateMode, 'Bitrate', icon, [{value: 'auto', label: 'Automatic (recommended)'}, {value: 'manual', label: 'Set manually'}]);
  const bitrate = element('input', {className: 'ui-field-input', id: FIELD.bitrateMbps, type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Target bitrate (Mbit/s)'});
  const mp4Row = row('Codec', mp4Codec.wrap, {htmlFor: FIELD.mp4Codec}), aviRow = row('Codec', aviCodec.wrap, {htmlFor: FIELD.aviCodec});
  const bitrateModeRow = row('Bitrate', bitrateMode.wrap, {htmlFor: FIELD.bitrateMode});
  const bitrateRow = row('Target', element('span', {className: 'ui-field'}, bitrate, element('span', {className: 'ui-field-unit', text: 'Mbit/s'})), {htmlFor: FIELD.bitrateMbps});
  const vfwHost = element('div', {className: 'export-vfw'});
  const encodingBody = element('div', {className: 'ui-section-body', id: 'export-encoding', hidden: true}, mp4Row, aviRow, bitrateModeRow, bitrateRow, vfwHost);
  const encodingSummary = element('span', {className: 'export-encoding-summary'});
  const chevron = glyph(icon, 'chevron-right'); chevron?.classList.add('ui-section-chev');
  const encodingToggle = element('button', {type: 'button', className: 'ui-section-toggle', id: 'export-encoding-toggle', 'aria-expanded': 'false', 'aria-controls': encodingBody.id},
    element('span', {className: 'ui-section-title', text: 'Encoding'}), encodingSummary, chevron);
  const encoding = element('section', {className: 'ui-section export-encoding', dataset: {section: 'export-encoding', collapsible: ''}},
    element('div', {className: 'ui-section-head'}, encodingToggle), encodingBody);

  const validation = element('p', {className: 'export-validation', id: ELEMENT.validation, role: 'status', 'aria-live': 'polite', hidden: true});
  const summarySize = element('span', {id: ELEMENT.summarySize}), summaryTime = element('span', {id: ELEMENT.summaryTime});

  const stop = stopQuestion({overlays, icon, t});
  const dialog = createDialog({size: 'lg', variant: 'export', id: EXPORT_DIALOG_ID, title: 'Export', overlays, icon, t, closeLabel: 'Close export',
    actions: [{label: kitText(t, 'common.cancel'), cancel: true, variant: 'ghost'}, {label: 'Export', id: ELEMENT.submit, variant: 'primary', value: 'export'}],
    beforeClose: () => stop.ask(() => Boolean(exporting) && !closed),
    onSubmit: () => { void start(); return false; }});
  const {element: root, form, body} = dialog;
  const foot = form.querySelector('.ui-dialog-foot'), meta = foot.querySelector('.ui-dialog-meta'), submit = foot.querySelector(`#${ELEMENT.submit}`);
  const titleNode = form.querySelector('.ui-dialog-title');
  form.classList.add('ui-export-form');
  form.prepend(previewPane);
  body.classList.add('export-body');
  body.prepend(presets, nameRow, formatRow, typeRow, projectRow, typeHint, sizeRow, customRow, qualityRow, qualityHint, jpegRow, colourRow, soundRow, pictureRow, encoding);
  meta.append(summarySize, element('span', {className: 'export-summary-sep', text: ' · ', 'aria-hidden': 'true'}), summaryTime);
  foot.prepend(validation);
  name.autofocus = true;

  // ---- The request and what it is exported with. The Windows AVI controls check their codecs for the request's size.
  vfw = createVfw?.({container: vfwHost, dialog: root, getDimensions: () => (request ? {width: request.width, height: request.height} : {width: canvasWidth, height: canvasHeight}),
    onChange: () => { if (request) refreshStates(); }}) ?? null;
  const vfwState = () => (vfw ? {listed: vfw.listed, ready: vfw.ready, reason: vfw.reason} : null);
  const baseStates = codecs => exportFormatStates({capabilities, capabilityError, totalFrames, hasObject, movieclip, vfw: vfwState(), codecs});
  states = baseStates({});
  request = initialExportRequest({preferences: remembered, states, context: board});
  let validity = {error: '', notice: '', invalid: [], canExport: false};
  let encodingOpen = remembered.encodingOpen;

  function refreshStates() {
    states = baseStates(request.codecs);
    request = reconcileExportCodecs(request, states);
    // A preset chosen while the video encoders were being checked moves to its next type if its first proved unavailable (MP4 in the browser).
    if (preset && exportPresetHeld(preset.id, preset.applied, request) && applyExportPreset(preset.id, {board, states}).format !== request.format) choosePreset(preset.id);
    else render();
  }
  function edit(patch, source = null) {
    const previous = request;
    request = updateExportRequest(request, patch, board);
    if (patch.format || patch.category) lastType.set(request.category, request.format);
    const resized = previous.width !== request.width || previous.height !== request.height;
    if (resized) { vfw?.sizeChanged(); scheduleProbe(); }
    render(source);
  }
  function scheduleProbe(delay = 150) {
    clearTimeout(probeTimer);
    probeTimer = setTimeout(() => void refreshCapabilities(), delay);
  }
  async function refreshCapabilities() {
    clearTimeout(probeTimer);
    const sequence = ++probeSequence;
    try {
      const result = await probe({width: request.width, height: request.height});
      if (closed || sequence !== probeSequence) return;
      capabilities = result; capabilityError = null;
    } catch (error) {
      if (closed || sequence !== probeSequence) return;
      capabilities = null; capabilityError = error;
    }
    fillCodecs();
    refreshStates();
  }
  /** Today's codec selects: every codec the probe reports, unsupported ones disabled; the value is the one the request exports. */
  function fillCodecs() {
    for (const [key, control] of [['mp4', mp4Codec.node], ['avi', aviCodec.node]]) {
      const choices = exportCodecChoices(capabilities?.formats?.find(format => format.id === key));
      control.replaceChildren(...choices.options.map(option => element('option', {value: option.id, text: option.label, disabled: option.disabled})));
      control.disabled = choices.disabled;
    }
  }

  // ---- Rendering: every row from the request.
  const show = (node, visible) => { if (node.hidden === visible) node.hidden = !visible; };
  // A field being typed in keeps what was typed ("0." on the way to "0.25"); only the fields it derives are written.
  const setValue = (input, value, source) => {
    const text = value === null || value === undefined || Number.isNaN(value) ? '' : String(value);
    if (input !== source && input !== document.activeElement && input.value !== text) input.value = text;
  };
  const setChecked = (items, checked) => { for (const item of items) item.setAttribute('aria-checked', String(checked(item))); };
  const fieldInputs = {name, width: widthField.input, height: heightField.input, from: fromField.input, to: toField.input, jpegQuality: jpeg, bitrateMbps: bitrate};

  function render(source = null) {
    if (closed || exporting) return;
    const info = exportFormatInfo(request.format), visible = exportFieldVisibility(request, {audioClips});
    const editable = info.category === 'editable', single = Boolean(info.single), rangeShown = visible.range && totalFrames > 0;
    show(strip, rangeShown && totalFrames > 1);
    setChecked(categories.children, item => item.dataset.category === request.category);
    for (const item of categories.children) item.tabIndex = item.dataset.category === request.category ? 0 : -1;
    show(typeRow, !editable); show(projectRow, editable);
    if (!editable) renderTypes(); else renderProjectTypes();
    show(sizeRow, visible.size); show(customRow, visible.size && request.sizePreset === 'custom');
    if (size.node.value !== request.sizePreset) size.node.value = request.sizePreset;
    setValue(widthField.input, request.width, source); setValue(heightField.input, request.height, source);
    lock.checked = request.lockRatio;
    show(qualityRow, visible.videoQuality);
    setChecked(quality.children, item => item.dataset.value === request.videoQuality);
    for (const item of quality.children) item.tabIndex = item.dataset.value === request.videoQuality ? 0 : -1;
    quality.dataset.value = request.videoQuality;
    const typeText = exportTypeHint(request.format, {movieclip});
    typeHint.textContent = typeText; show(typeHint, Boolean(typeText));
    qualityHint.textContent = QUALITY.find(option => option.value === request.videoQuality)?.hint ?? '';
    show(qualityHint, visible.videoQuality);
    renderPresets();
    show(jpegRow, visible.jpegQuality); setValue(jpeg, request.jpegQuality, source);
    show(colourRow, visible.dither); dither.input.checked = request.dither ?? defaultDither;
    show(soundRow, visible.audio); sound.input.checked = request.audio;
    show(pictureRow, visible.settings); show(smoothing.wrap, visible.smoothing);
    if (smoothing.node.value !== request.smoothing) smoothing.node.value = request.smoothing;
    const alpha = exportTransparency(request.format, {provider: states.get(request.format)?.provider});
    transparent.input.checked = Boolean(alpha?.transparent);
    transparentReason.textContent = alpha?.reason ?? '';
    show(transparentReason, visible.settings && Boolean(alpha?.reason));
    renderEncoding(visible, source);
    // The preview pane: the range, its caption and the notes.
    show(range, rangeShown); show(playButton, !single && totalFrames > 1);
    captionLabel.textContent = single ? `Current frame · ${currentFrame}` : editable ? `Whole animation · ${totalFrames} ${totalFrames === 1 ? 'frame' : 'frames'}` : 'Frames';
    setValue(fromField.input, request.from, source); setValue(toField.input, request.to, source);
    show(allFrames, rangeShown && (request.from !== 1 || request.to !== totalFrames));
    placeHandles();
    const notes = [!editable && !single ? exportPlayedFramesNote(storedFrames, totalFrames) : '', !editable ? exportWorkingPoseNote(frameDraft, totalFrames) : ''].filter(Boolean);
    note.textContent = notes.join(' '); show(note, notes.length > 0);
    // The name: today's name for the chosen type until one is typed (a cleared field shows it and exports with it).
    const fallback = defaultExportName({...request, name: null}, nameContext);
    name.placeholder = fallback;
    if (!nameEdited && name.value !== fallback) name.value = fallback;
    extension.textContent = `.${exportFileName({...request, name: null}, nameContext).split('.').at(-1)}`;
    // Validation, the summary and the primary.
    validity = validateExportRequest(request, {states, totalFrames, fps, audioClips, audioSupported, deviceMemory: globalThis.navigator?.deviceMemory});
    for (const [key, input] of Object.entries(fieldInputs)) {
      if (validity.invalid.includes(key)) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }
    // A note the Picture row already gives (browser WebM keeps no transparency) is not repeated.
    const notice = !validity.error && validity.notice === transparentReason.textContent ? '' : validity.notice;
    validation.textContent = notice;
    validation.hidden = !notice;
    validation.dataset.error = String(Boolean(validity.error || states.get(request.format)?.disabled));
    const {size: pixels, time} = exportSummary(request, {fps, currentFrame});
    summarySize.textContent = pixels; summaryTime.textContent = time;
    show(meta, Boolean(pixels || time));
    submit.textContent = exportPrimaryLabel(request, {movieclip});
    submit.disabled = !validity.canExport;
    scheduleStage();
    updateFade();
  }
  function renderPresets() {
    if (preset && !exportPresetHeld(preset.id, preset.applied, request)) preset = null;
    const items = [...presetList.children];
    for (const item of items) item.setAttribute('aria-checked', String(item.dataset.preset === preset?.id));
    for (const [index, item] of items.entries()) item.tabIndex = (preset ? item.dataset.preset === preset.id : index === 0) ? 0 : -1;
    const fit = preset ? exportPresetFit(preset.id, board, request) : null;
    // A vertical platform's preview takes its screen's shape, so the bars the note warns of show before exporting.
    const frame = preset && exportPresetInfo(preset.id).shapes[0] === 'portrait' ? 'portrait' : '';
    if ((stage.dataset.frame ?? '') !== frame) { if (frame) stage.dataset.frame = frame; else delete stage.dataset.frame; }
    presetNote.textContent = fit?.message ?? '';
    presetNote.dataset.fits = String(fit?.fits ?? true);
    show(presetNote, Boolean(fit?.message));
  }
  function choosePreset(id) {
    preset = null;
    edit(applyExportPreset(id, {board, states}));
    preset = {id, applied: request};
    render();
  }
  function renderTypes() {
    const choices = formatChoices(request.category, states), action = exportFormatInfo(request.format).action;
    const provider = choice => states.get(choice.id)?.provider ?? '';
    const same = type.node.options.length === choices.length && choices.every((choice, index) => {
      const option = type.node.options[index];
      return option.value === exportFormatInfo(choice.id).action && option.textContent === choice.type && option.disabled === choice.disabled &&
        option.title === choice.reason && option.dataset.provider === provider(choice);
    });
    // Each option names its encoder (data-provider: FFmpeg or WebCodecs) once the capability check has run.
    if (!same) type.node.replaceChildren(...choices.map(choice => element('option', {value: exportFormatInfo(choice.id).action, text: choice.type,
      disabled: choice.disabled, title: choice.reason, dataset: {provider: provider(choice)}})));
    if (type.node.value !== action) type.node.value = action;
  }
  function renderProjectTypes() {
    const choices = formatChoices('editable', states);
    if (projectList.children.length !== choices.length) {
      projectList.replaceChildren(...choices.map(choice => element('button', {type: 'button', className: 'export-type', role: 'radio', dataset: {format: choice.id}},
        element('span', {text: exportFormatInfo(choice.id).label === 'StykAnimate movieclip' ? 'Movieclip' : exportFormatInfo(choice.id).label}),
        element('span', {className: 'export-type-extension', text: `.${choice.extension}`}))));
      projectRoving.refresh();
    }
    for (const [index, choice] of choices.entries()) {
      const item = projectList.children[index];
      item.setAttribute('aria-checked', String(choice.id === request.format));
      if (choice.disabled) { item.setAttribute('aria-disabled', 'true'); item.dataset.tooltip = choice.reason; }
      else { item.removeAttribute('aria-disabled'); delete item.dataset.tooltip; }
      item.tabIndex = choice.id === request.format ? 0 : -1;
    }
  }
  function renderEncoding(visible, source) {
    // Encoding holds the video codecs and bitrate, and the installed Windows codecs (the Windows AVI type).
    show(encoding, visible.encoding || (visible.vfw && Boolean(vfw?.listed)));
    encodingToggle.setAttribute('aria-expanded', String(encodingOpen));
    encoding.toggleAttribute('data-open', encodingOpen);
    show(encodingBody, encodingOpen);
    encodingSummary.textContent = exportEncodingSummary(request, states, {vfwCodec: vfw ? {label: vfw.codecLabel} : null});
    show(mp4Row, visible.mp4Codec); show(aviRow, visible.aviCodec); show(bitrateModeRow, visible.bitrateMode); show(bitrateRow, visible.bitrateMbps);
    if (request.codecs.mp4 && mp4Codec.node.value !== request.codecs.mp4) mp4Codec.node.value = request.codecs.mp4;
    if (request.codecs.avi && aviCodec.node.value !== request.codecs.avi) aviCodec.node.value = request.codecs.avi;
    if (bitrateMode.node.value !== request.bitrateMode) bitrateMode.node.value = request.bitrateMode;
    setValue(bitrate, request.bitrateMbps, source);
    show(vfwHost, visible.vfw && Boolean(vfw?.listed));
  }
  /** The form column fades at its foot while rows wait below. */
  function updateFade() {
    body.toggleAttribute('data-more-below', body.scrollHeight - body.scrollTop - body.clientHeight > 1);
  }

  // ---- The trim strip: the ends sit over the thumbnails' extent and write From and To.
  const validRange = () => {
    const from = Number.isInteger(request.from) ? clampFrame(request.from, totalFrames) : 1, to = Number.isInteger(request.to) ? clampFrame(request.to, totalFrames) : totalFrames;
    return from <= to ? {from, to} : {from: 1, to: totalFrames};
  };
  const ratio = frame => (totalFrames > 1 ? (frame - 1) / (totalFrames - 1) : 0);
  function placeHandles() {
    const {from, to} = {from: Number.isFinite(request.from) ? clampFrame(request.from, totalFrames) : 1, to: Number.isFinite(request.to) ? clampFrame(request.to, totalFrames) : totalFrames};
    strip.style.setProperty('--start', `calc(var(--space-3) + (100% - 2 * var(--space-3)) * ${ratio(from)})`);
    strip.style.setProperty('--end', `calc(var(--space-3) + (100% - 2 * var(--space-3)) * ${ratio(to)})`);
    for (const [control, frame] of [[startHandle, from], [endHandle, to]]) {
      control.setAttribute('aria-valuenow', String(frame));
      control.setAttribute('aria-valuetext', `Frame ${frame}`);
    }
    for (const entry of cells) entry.cell.toggleAttribute('data-out', entry.tick + 1 < from || entry.tick + 1 > to);
  }
  function setEdge(edge, frame) {
    const {from, to} = validRange(), value = clampFrame(frame, totalFrames);
    const patch = edge === 'start' ? {from: Math.min(value, to)} : {to: Math.max(value, from)};
    edit(patch);
    showStage((edge === 'start' ? request.from : request.to) - 1);
  }
  const frameAt = clientX => {
    const box = strip.getBoundingClientRect(), inset = parseFloat(getComputedStyle(strip).paddingInlineStart) || 0;
    const width = Math.max(1, box.width - inset * 2), position = (clientX - box.left - inset) / width;
    return 1 + Math.round(Math.max(0, Math.min(1, position)) * (totalFrames - 1));
  };
  for (const control of [startHandle, endHandle]) {
    const edge = control.dataset.edge;
    control.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); control.focus({preventScroll: true}); control.setPointerCapture(event.pointerId);
      const move = moveEvent => setEdge(edge, frameAt(moveEvent.clientX));
      const end = () => { control.removeEventListener('pointermove', move); control.removeEventListener('pointerup', end); control.removeEventListener('pointercancel', end); };
      control.addEventListener('pointermove', move); control.addEventListener('pointerup', end); control.addEventListener('pointercancel', end);
    });
    control.addEventListener('keydown', event => {
      const {from, to} = validRange(), current = edge === 'start' ? from : to, step = event.shiftKey ? 10 : 1;
      const next = {ArrowLeft: current - step, ArrowDown: current - step, ArrowRight: current + step, ArrowUp: current + step,
        PageDown: current - 10, PageUp: current + 10, Home: edge === 'start' ? 1 : from, End: edge === 'end' ? totalFrames : to}[event.key];
      if (next === undefined) return;
      event.preventDefault();
      setEdge(edge, next);
    });
  }

  // ---- The preview's frames: one render at a time, dropped when the dialog closes or the export starts.
  const previewAbort = new AbortController();
  let stageWanted = null, stageShown = null, stageBusy = false, playing = null;
  const idleTick = () => {
    const info = exportFormatInfo(request.format);
    return info.single || info.category === 'editable' ? Math.max(0, currentFrame - 1) : validRange().from - 1;
  };
  function scheduleStage() { if (!playing) showStage(idleTick()); }
  function showStage(tick) {
    if (!preview || totalFrames < 1 || previewAbort.signal.aborted) return;
    stageWanted = Math.max(0, Math.min(totalFrames - 1, tick));
    void drainStage();
  }
  async function drainStage() {
    if (stageBusy) return;
    stageBusy = true;
    try {
      while (stageWanted !== null && stageWanted !== stageShown && !previewAbort.signal.aborted) {
        const tick = stageWanted;
        const drawn = await preview.render(tick, stageCanvas, {signal: previewAbort.signal}).catch(() => false);
        if (!drawn) break;
        stageShown = tick;
      }
    } finally { stageBusy = false; }
  }
  async function renderStrip() {
    for (const entry of cells) {
      if (previewAbort.signal.aborted) return;
      await preview.render(entry.tick, entry.canvas, {signal: previewAbort.signal}).catch(() => false);
    }
  }
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  async function play(token) {
    const started = performance.now();
    while (playing === token && !previewAbort.signal.aborted) {
      const {from, to} = validRange(), count = to - from + 1;
      const tick = from - 1 + Math.floor((performance.now() - started) / 1000 * fps) % count;
      const drawn = await preview.render(tick, stageCanvas, {signal: previewAbort.signal}).catch(() => false);
      if (drawn) stageShown = tick;
      else await new Promise(resolve => setTimeout(resolve, 100));
      await nextFrame();
    }
  }
  function setPlaying(on) {
    if (Boolean(playing) === on) return;
    playing = on ? {} : null;
    playButton.setAttribute('aria-pressed', String(on));
    playButton.setAttribute('aria-label', on ? 'Pause preview' : 'Play preview');
    playButton.replaceChildren(glyph(icon, on ? 'pause' : 'play'));
    if (playing) void play(playing); else scheduleStage();
  }
  function stopPreview() {
    setPlaying(false);
    previewAbort.abort();
    preview?.dispose();
  }

  // ---- Edits. Every control edits on `input`, which comes before `change`: a render the same input causes further up
  // (the Windows codec controls follow the dialog's input events) must not reset a select or a switch before it is read.
  presetList.addEventListener('click', event => {
    const item = event.target.closest('[data-preset]');
    if (item && item.dataset.preset !== preset?.id) choosePreset(item.dataset.preset);
  });
  installRovingFocus(presetList, {items: '[data-preset]', orientation: 'both', onMove: item => choosePreset(item.dataset.preset)});
  categories.addEventListener('click', event => {
    const item = event.target.closest('[data-category]');
    if (!item || item.dataset.category === request.category) return;
    chooseCategory(item.dataset.category);
  });
  function chooseCategory(category) {
    const format = resolveFormatChoice(lastType.get(category) ?? null, category, states);
    if (format) edit({format});
  }
  installRovingFocus(categories, {items: '[data-category]', onMove: item => chooseCategory(item.dataset.category)});
  const projectRoving = installRovingFocus(projectList, {items: '.export-type', orientation: 'both', onMove: item => chooseProject(item)});
  function chooseProject(item) {
    if (!item || item.getAttribute('aria-disabled') === 'true') return;
    edit({format: item.dataset.format});
  }
  projectList.addEventListener('click', event => chooseProject(event.target.closest('.export-type')));
  type.node.addEventListener('input', () => edit({format: formatForAction(type.node.value)}));
  size.node.addEventListener('input', () => edit({sizePreset: size.node.value}));
  for (const [key, input] of [['width', widthField.input], ['height', heightField.input]]) input.addEventListener('input', () => edit({[key]: input.value}, input));
  lock.addEventListener('input', () => edit({lockRatio: lock.checked}));
  for (const [key, input] of [['from', fromField.input], ['to', toField.input]]) input.addEventListener('input', () => edit({[key]: input.value}, input));
  allFrames.addEventListener('click', () => edit(entireAnimationPatch(totalFrames)));
  quality.addEventListener('click', event => { const item = event.target.closest('[data-value]'); if (item) edit({videoQuality: item.dataset.value}); });
  installRovingFocus(quality, {items: '[data-value]', onMove: item => edit({videoQuality: item.dataset.value})});
  jpeg.addEventListener('input', () => edit({jpegQuality: jpeg.value}, jpeg));
  dither.input.addEventListener('input', () => edit({dither: dither.input.checked}));
  sound.input.addEventListener('input', () => edit({audio: sound.input.checked}));
  smoothing.node.addEventListener('input', () => edit({smoothing: smoothing.node.value}));
  name.addEventListener('input', () => { nameEdited = true; edit({name: name.value}, name); });
  mp4Codec.node.addEventListener('input', () => { edit({codecs: {mp4: mp4Codec.node.value}}); scheduleProbe(0); });
  aviCodec.node.addEventListener('input', () => { edit({codecs: {avi: aviCodec.node.value}}); scheduleProbe(0); });
  bitrateMode.node.addEventListener('input', () => edit({bitrateMode: bitrateMode.node.value}));
  bitrate.addEventListener('input', () => edit({bitrateMbps: bitrate.value}, bitrate));
  encodingToggle.addEventListener('click', () => {
    encodingOpen = !encodingOpen;
    remembered = {...remembered, encodingOpen};
    onPreferences(normalizeExportPreferences(remembered));
    render();
    if (encodingOpen) encoding.scrollIntoView({block: 'nearest'});
  });
  playButton.addEventListener('click', () => setPlaying(!playing));
  body.addEventListener('scroll', updateFade, {passive: true});
  const bodySize = typeof ResizeObserver === 'function' ? new ResizeObserver(updateFade) : null;
  bodySize?.observe(body);

  /** The request to export: the dialog's, with the Windows AVI fields the controls hold. */
  const currentRequest = () => (request.format === 'vfw' && vfw ? {...request, vfw: vfw.fields()} : request);
  async function start() {
    render();
    if (!validity.canExport || exporting || closed) return;
    remembered = exportPreferencesFromRequest(request, remembered);
    onPreferences(remembered);
    setPlaying(false);
    dialog.setBusy(true);
    try { await onExport(currentRequest()); }
    catch (error) { globalThis.reportError?.(error); }
    finally {
      if (!closed && !exporting) { dialog.setBusy(false); render(); }
    }
  }

  /** Settles once the dialog has closed and let go of its previews, probes and codec controls. */
  const closedPromise = dialog.result.then(() => {
    closed = true;
    stop.dismiss();
    bodySize?.disconnect();
    clearTimeout(probeTimer);
    probeSequence++;
    stopPreview();
    vfw?.dispose();
    const callback = onClosed; onClosed = null;
    callback?.();
  });
  const sheet = {
    element: root,
    closed: closedPromise,
    get request() { return currentRequest(); },
    get states() { return states; },
    get open() { return !closed; },
    /** What exportJob() needs from the Windows AVI controls. */
    vfwContext: () => vfw?.requestContext() ?? {available: false},
    /**
     * Swaps the settings for the export's progress (export-progress.mjs's
     * markup goes in `content`) and keeps the dialog open until the export
     * ends. `onClose(callback)` runs once when the dialog closes.
     */
    showProgress(title = PROGRESS_TITLE) {
      stopPreview();
      exporting = element('div', {className: 'export-progress-host'});
      titleNode.textContent = title;
      body.hidden = true; foot.hidden = true;
      previewPane.inert = true;
      root.dataset.exporting = '';
      form.insertBefore(exporting, foot);
      return {content: exporting, close: () => sheet.close(), onClose: callback => { onClosed = callback; }};
    },
    close() { dialog.close(null); },
  };

  lastType.set(request.category, request.format);
  fillCodecs();
  render();
  dialog.showModal();
  requestAnimationFrame(updateFade);
  void refreshCapabilities();
  if (preview && totalFrames > 0) void (async () => { await drainStage(); await renderStrip(); })();
  return sheet;
}

/**
 * The progress of an export run without the export dialog (a palette
 * command): the same view in its own dialog. Returns the progress host of
 * showProgress().
 */
export function openExportProgress({title = PROGRESS_TITLE, overlays = null, icon = null, t = null} = {}) {
  const content = element('div', {className: 'export-progress-host'});
  let onClosed = null, done = false;
  const stop = stopQuestion({overlays, icon, t});
  const dialog = createDialog({size: 'md', variant: 'export-progress', id: EXPORT_DIALOG_ID, title, body: content, overlays, icon, t, closeLabel: 'Close export',
    beforeClose: () => stop.ask(() => !done)});
  dialog.result.then(() => { done = true; stop.dismiss(); const callback = onClosed; onClosed = null; callback?.(); });
  dialog.element.querySelector('.ui-dialog-foot').hidden = true;
  dialog.element.dataset.exporting = '';
  dialog.showModal();
  return {content, close: () => dialog.close(null), onClose: callback => { onClosed = callback; }};
}
