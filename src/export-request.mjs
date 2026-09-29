/**
 * Export request: the export dialog's choices as one explicit value instead
 * of DOM ids and label visibility. Pure functions: no DOM and no I/O. The
 * export sheet (export-sheet.mjs, M6) renders a request and replaces it on
 * every edit (updateExportRequest); the export actions map it to exactly the
 * arguments today's app derives from the dialog (exportJob and the functions
 * it dispatches to). Capability probing, codecs, rendering and saving stay
 * with their owners (export-capabilities, VfwExportControls, the encoders).
 *
 *   {
 *     format: 'mp4',              // EXPORT_FORMATS id; category follows from it
 *     category: 'video',
 *     sizePreset: 'original',     // 'original' | '1080' | '720' | '2160' | 'custom'
 *     width: 960, height: 540,    // output pixels, Number() of what was typed
 *     lockRatio: true,
 *     from: 1, to: 48,            // first and last played frame (ticks), 1-based, inclusive
 *     jpegQuality: 94,            // percent; JPEG sequence only (below)
 *     smoothing: 'edges',         // export-sampling.mjs EXPORT_SMOOTHING
 *     dither: null,               // GIF; null: defaultGIFDither(report), as today
 *     videoQuality: 'recommended', bitrateMode: 'auto', bitrateMbps: 8,
 *     codecs: {mp4: 'h264', avi: 'mpeg4'},   // the codec each select shows (reconcileExportCodecs)
 *     audio: true,                // Include audio
 *     vfw: null,                  // {codecId, quality, keyframes, bitrateMbps, configurationId}
 *     repeat: null,               // GIF: 'forever' | 'once'; null follows the Loop setting, as today
 *     name: null,                 // file name without extension, trimmed; null: today's names
 *   }
 *
 * The sheet's flow:
 *   open    states = exportFormatStates({totalFrames, hasObject, movieclip, vfw});
 *           request = initialExportRequest({preferences, states, context: {canvasWidth, canvasHeight, totalFrames}})
 *   probe   on open and after every size or codec change: getExportCapabilities({width, height, fps, desktop}),
 *           dropping a result a newer probe superseded (today's capabilitySequence); then
 *           states = exportFormatStates({capabilities, ..., codecs: request.codecs});
 *           request = reconcileExportCodecs(request, states). Every exportFormatStates call is followed by
 *           reconcileExportCodecs, so the request exports the codec its select shows.
 *   edit    request = updateExportRequest(request, patch, {canvasWidth, canvasHeight, totalFrames});
 *           validateExportRequest(request, {states, totalFrames, fps, audioClips, audioSupported, deviceMemory})
 *   export  exportJob(request, jobContext) (see exportJob). A palette command run without the dialog
 *           exports buildExportRequest({format}, context), never the remembered preferences, so it keeps
 *           today's 0.94 quality, the artboard size and the whole animation.
 *
 * Resolved quirks (each kept byte-for-byte; tests/export-request.test.mjs
 * proves the equivalence against the verbatim legacy code):
 *
 * - Hidden quality field. Before 0.5.6 exportOptions() read "Lossy quality %"
 *   even while its field was hidden, so a value typed for a JPEG sequence
 *   (or an empty field) changed or blocked every later export. 0.5.6 made the
 *   label's visibility decide: hidden means 0.94. The field is shown for the
 *   JPEG sequence only, so the request decides by format instead: a JPEG
 *   sequence uses jpegQuality / 100, every other format 0.94
 *   (EXPORT_DEFAULT_QUALITY), whatever jpegQuality holds. A palette command
 *   run without the dialog also gets 0.94, as today.
 * - Manual bitrate hides the quality preset, but the preset still supplies
 *   the quality the encoder receives beside the bitrate (desktop VP9 turns it
 *   into its CRF). The request keeps videoQuality in manual mode, so the
 *   output is unchanged.
 * - Dither and smoothing are passed for every format, as today; only GIF
 *   encoders read dither, and SVG output replaces smoothing with 'edges'.
 * - GIF repeat follows the playback Loop setting unless the request says
 *   otherwise.
 * - Today's dialog opens on the first video type enabled before the capability
 *   probe returns (WebM: MP4, AVI and WMV wait for the probe) and keeps it.
 *   defaultExportFormat() applies the same rule to the states it is given, so
 *   pass the states known when the dialog opens to keep that default.
 * - From and To count played frames (ticks), as today, in Simple mode too;
 *   exportPlayedFramesNote() keeps today's sentence that relates them to the
 *   timeline's frames.
 *
 * Deliberate differences from today's dialog, in the sheet only:
 * - Project lists four types in revision 4's order (.piv, .stkz, .stk,
 *   .stykmov). Today's figure button wrote .stykmov for a movieclip; the sheet
 *   lists Movieclip itself, so the figure type is unavailable for a movieclip
 *   (with its reason). The export-stkz command still writes .stykmov for one.
 * - A remembered Custom size of another shape opens as Original, never as
 *   distorted pixels (today's dialog always opened at the artboard size).
 * - A command run after the dialog was closed exports today's defaults. Today's
 *   closed dialog left its fields in the page, so a palette export after it
 *   used the closed dialog's size, range and settings until another dialog
 *   replaced them; the sheet leaves nothing behind.
 */
import {EXPORT_MAX_PIXELS, EXPORT_SMOOTHING, normalizeExportSmoothing} from './export-sampling.mjs';
import {VIDEO_QUALITY_PRESETS, videoQualityOptions} from './export-video-quality.mjs';
import {exportMemoryPlan} from './export-memory.mjs';
import {exportTime} from './export-progress.mjs';

/** The quality every format but the JPEG sequence exports with (today's hidden-field value). */
export const EXPORT_DEFAULT_QUALITY = 0.94;
const NO_FRAMES = 'Add a frame to export an animation.';
const AUDIO_NEEDS_FFMPEG = 'Choose a desktop FFmpeg video format to include sound, or turn off Include audio for a silent export.';
const MAX_SIDE = 16384;

const entry = (id, action, category, label, short, extension, extra = {}) => Object.freeze({id, action, category, label, short, extension, ...extra});
/** Every export type, in the sheet's order within its category. `label` is today's button title. */
export const EXPORT_FORMATS = Object.freeze([
  entry('mp4', 'export-mp4', 'video', 'MP4 video', 'MP4', 'mp4', {codecKey: 'mp4'}),
  entry('webm', 'export-video', 'video', 'WebM video', 'WebM', 'webm'),
  entry('avi', 'export-avi', 'video', 'AVI video', 'AVI', 'avi', {codecKey: 'avi'}),
  entry('wmv', 'export-wmv', 'video', 'Windows Media video', 'WMV', 'wmv'),
  entry('vfw', 'export-vfw', 'video', 'Windows AVI', 'AVI', 'avi'),
  entry('gif', 'export-gif', 'animated', 'Animated GIF', 'GIF', 'gif'),
  entry('apng', 'export-apng', 'animated', 'Animated PNG', 'APNG', 'png'),
  entry('png', 'export-png', 'frames', 'PNG frame', 'PNG', 'png', {single: true}),
  entry('svg', 'export-svg', 'frames', 'SVG frame', 'SVG', 'svg', {single: true}),
  entry('png-sequence', 'export-png-sequence', 'frames', 'PNG sequence', 'PNG sequence', 'zip'),
  entry('jpeg-sequence', 'export-jpeg-sequence', 'frames', 'JPEG sequence', 'JPEG sequence', 'zip'),
  entry('gif-sequence', 'export-gif-sequence', 'frames', 'GIF sequence', 'GIF sequence', 'zip'),
  entry('svg-sequence', 'export-svg-sequence', 'frames', 'SVG sequence', 'SVG sequence', 'zip'),
  entry('piv', 'export-piv', 'editable', 'Pivot animation', 'PIV', 'piv'),
  entry('stkz', 'export-stkz', 'editable', 'StykAnimate figure', 'STKZ', 'stkz', {needsObject: true}),
  entry('stk', 'export-stk', 'editable', 'Pivot figure', 'STK', 'stk', {needsObject: true}),
  entry('stykmov', 'export-stykmov', 'editable', 'StykAnimate movieclip', 'STYKMOV', 'stykmov', {needsObject: true}),
]);
const FORMATS = new Map(EXPORT_FORMATS.map(format => [format.id, format]));
const BY_ACTION = new Map(EXPORT_FORMATS.map(format => [format.action, format.id]));
const SINGLE_FRAME_ACTIONS = new Set(['export-piv', 'export-stk', 'export-stkz', 'export-stykmov', 'export-png', 'export-svg']);

/** Today's categories (export-panel.mjs); `short` is the revision 4 segmented label. Project follows revision 4's order. */
export const EXPORT_CATEGORIES = Object.freeze([
  Object.freeze({id: 'video', label: 'Video', short: 'Video', formats: Object.freeze(['mp4', 'webm', 'avi', 'wmv', 'vfw'])}),
  Object.freeze({id: 'animated', label: 'Animated image', short: 'GIF', formats: Object.freeze(['gif', 'apng'])}),
  Object.freeze({id: 'frames', label: 'Frames & sequences', short: 'Frames', formats: Object.freeze(['png', 'svg', 'png-sequence', 'jpeg-sequence', 'gif-sequence', 'svg-sequence'])}),
  Object.freeze({id: 'editable', label: 'Editable file', short: 'Project', formats: Object.freeze(['piv', 'stkz', 'stk', 'stykmov'])}),
]);

/** What each type is for, in a sentence the dialog shows under Type: a person who does not know the formats chooses by it. */
const TYPE_HINTS = Object.freeze({
  mp4: 'Plays everywhere: phones, YouTube, social apps and video editors.',
  webm: 'An open video format for browsers and web pages.',
  avi: 'For older editing software. A lossless codec in Encoding keeps a perfect master copy.',
  wmv: 'For older Windows programs.',
  vfw: 'Encodes with a video codec installed in Windows.',
  gif: 'Loops in chats, forums and web pages. Up to 256 colours a frame.',
  apng: 'A looping image with full colour and smooth transparency. Plays in browsers.',
  png: 'The current frame as a picture that keeps transparency.',
  svg: 'The current frame as a vector drawing that stays sharp at any size.',
  'png-sequence': 'Every frame as a numbered PNG in a .zip, with transparency: for video editors and game engines.',
  'jpeg-sequence': 'Every frame as a numbered JPEG in a .zip: small files without transparency.',
  'gif-sequence': 'Every frame as a numbered GIF picture in a .zip.',
  'svg-sequence': 'Every frame as a numbered vector drawing in a .zip.',
  piv: 'The whole animation, to open in Pivot Animator.',
  stkz: 'The selected figure, to reuse in other StykAnimate projects.',
  stk: 'The selected figure, to use in Pivot Animator.',
  stykmov: 'The selected movieclip, to reuse in other StykAnimate projects.',
});
/** The Type row's sentence for a format ('' for none). A movieclip's figure entry writes .stykmov, so it is described as one. */
export const exportTypeHint = (format, {movieclip = false} = {}) => TYPE_HINTS[format === 'stkz' && movieclip ? 'stykmov' : format] ?? '';

/** Size presets scale the short side and keep the artboard's shape and orientation. */
export const EXPORT_SIZE_PRESETS = Object.freeze([
  Object.freeze({id: 'original', label: 'Original'}),
  Object.freeze({id: '1080', label: '1080p', shortSide: 1080}),
  Object.freeze({id: '720', label: '720p', shortSide: 720}),
  Object.freeze({id: '2160', label: '4K', shortSide: 2160}),
  Object.freeze({id: 'custom', label: 'Custom…'}),
]);
const SIZE_PRESETS = new Set(EXPORT_SIZE_PRESETS.map(preset => preset.id));

/**
 * The DOM ids of today's dialog fields by request field. legacyExportFields
 * reads them and the browser tests query them, so the sheet keeps them on the
 * controls that hold these values (From and To stay typed inputs: the tests
 * fill them; the trim handles point at them with aria-controls).
 */
export const EXPORT_FIELD_IDS = Object.freeze({sizePreset: 'export-resolution', width: 'export-width', height: 'export-height', lockRatio: 'export-aspect',
  from: 'export-start', to: 'export-end', jpegQuality: 'export-quality', smoothing: 'export-smoothing', dither: 'export-gif-dither',
  videoQuality: 'export-video-quality', bitrateMode: 'export-bitrate-mode', bitrateMbps: 'export-video-bitrate', mp4Codec: 'export-mp4-codec',
  aviCodec: 'export-avi-codec', audio: 'export-audio', vfwCodec: 'export-vfw-codec', vfwQuality: 'export-vfw-quality',
  vfwKeyframes: 'export-vfw-keyframes', vfwBitrate: 'export-vfw-bitrate'});
/** The other ids the tests query: the Type select, the foot, the entire-animation action and progress. Categories use [data-category]. */
export const EXPORT_ELEMENT_IDS = Object.freeze({format: 'output-format', summarySize: 'export-summary-size', summaryTime: 'export-summary-time',
  validation: 'export-validation', allFrames: 'export-all-frames', submit: 'export-submit', progress: 'export-progress', cancel: 'cancel-export'});

export const exportFormatInfo = id => FORMATS.get(id) ?? null;
export const formatForAction = action => BY_ACTION.get(action) ?? null;
const isVector = id => id.includes('svg');
const isSequence = id => id.endsWith('-sequence');
/** Formats whose quality comes from export-video-quality.mjs (VFW has its own controls). */
const usesVideoQuality = id => FORMATS.get(id)?.category === 'video' && id !== 'vfw';
const codecOf = request => {const key = FORMATS.get(request.format)?.codecKey; return key ? request.codecs?.[key] || undefined : undefined;};
const isLossless = request => request.format === 'avi' && ['ffv1', 'rawvideo'].includes(codecOf(request));
const has = value => value !== undefined && value !== null;
const number = (value, fallback) => (has(value) ? Number(value) : fallback);
const rawText = (value, fallback) => (has(value) ? String(value) : fallback);
const size = (width, height) => `${width} × ${height}`;
/** The artboard size a size change needs; a missing one would silently give NaN. */
function artboard({canvasWidth, canvasHeight} = {}) {
  if (!(canvasWidth > 0 && canvasHeight > 0)) throw new TypeError('Size changes need the artboard size (context.canvasWidth and context.canvasHeight).');
  return {canvasWidth, canvasHeight};
}
const requireNumber = (context, key, who) => {if (!Number.isFinite(context[key])) throw new TypeError(`${who} needs context.${key}.`);};

/** Width and height for a size preset, as choosing it in today's Size select writes them. */
export function presetSize(preset, {canvasWidth, canvasHeight}, lockRatio = true) {
  const choice = EXPORT_SIZE_PRESETS.find(option => option.id === preset);
  if (!choice || choice.id === 'custom') throw new Error('Choose a size preset.');
  const short = Math.min(canvasWidth, canvasHeight), scale = (choice.shortSide ?? short) / short;
  const width = Math.round(canvasWidth * scale);
  let height = Math.round(canvasHeight * scale);
  // The preset writes Width and fires its input event; with Lock ratio on, Height is then derived from Width.
  if (lockRatio && width > 0) height = lockedSide('width', width, {canvasWidth, canvasHeight});
  return {width, height};
}

/** The other side while Lock ratio is on (today's width/height input handler); null leaves it unchanged. */
export function lockedSide(edited, value, {canvasWidth, canvasHeight}) {
  if (!(value > 0)) return null;
  const ratio = canvasWidth / canvasHeight;
  return Math.max(1, Math.round(edited === 'width' ? value / ratio : value * ratio));
}

/** Whether a size has the artboard's shape, within the rounding Lock ratio and the presets produce. */
export const sameShape = ({width, height}, {canvasWidth, canvasHeight}) =>
  width > 0 && height > 0 && Math.abs(width * canvasHeight - height * canvasWidth) <= Math.max(canvasWidth, canvasHeight) / 2;

/**
 * The Size select's choices for this artboard: the preset's label with the
 * pixels it gives, disabled with a reason when they exceed what an export
 * allows (4K on a tall artboard), rather than failing after it is chosen.
 */
export function sizePresetChoices(context, {lockRatio = true, maxPixels = EXPORT_MAX_PIXELS} = {}) {
  const board = artboard(context);
  return EXPORT_SIZE_PRESETS.map(preset => {
    if (preset.id === 'custom') return {id: preset.id, label: preset.label, width: null, height: null, disabled: false, reason: ''};
    const {width, height} = presetSize(preset.id, board, lockRatio);
    const fits = [width, height].every(side => side >= 1 && side <= MAX_SIDE) && width * height <= maxPixels;
    return {id: preset.id, label: `${preset.label} · ${size(width, height)}`, width, height, disabled: !fits,
      reason: fits ? '' : `${size(width, height)} px is larger than an export allows (${MAX_SIDE.toLocaleString()} px a side, ${Math.round(maxPixels / 1e6)} million pixels).`};
  });
}

/**
 * A request from field values (strings as inputs hold them, or numbers).
 * Absent fields take today's defaults: the artboard size, the whole
 * animation, 94%, Smooth edges, the content-based dither, Recommended.
 * Never throws for what a person typed; validateExportRequest reports it.
 * context: {canvasWidth, canvasHeight, totalFrames}
 */
export function buildExportRequest(fields = {}, context = {}) {
  const {canvasWidth = 1, canvasHeight = 1, totalFrames = 0} = context;
  const format = FORMATS.get(fields.format ?? formatForAction(fields.action));
  if (!format) throw new TypeError(`Unknown export format: ${fields.format ?? fields.action}`);
  const lockRatio = typeof fields.lockRatio === 'boolean' ? fields.lockRatio : true;
  const typed = has(fields.width) || has(fields.height);
  const sizePreset = SIZE_PRESETS.has(fields.sizePreset) ? fields.sizePreset : typed ? 'custom' : 'original';
  const preset = !typed && sizePreset !== 'original' && sizePreset !== 'custom' ? presetSize(sizePreset, {canvasWidth, canvasHeight}, lockRatio) : null;
  const vfw = fields.vfw ? {codecId: rawText(fields.vfw.codecId, ''), quality: rawText(fields.vfw.quality, '90'), keyframes: rawText(fields.vfw.keyframes, '0'),
    bitrateMbps: rawText(fields.vfw.bitrateMbps, '0'), configurationId: fields.vfw.configurationId ?? undefined} : null;
  return {
    format: format.id,
    category: format.category,
    sizePreset,
    width: preset?.width ?? number(fields.width, canvasWidth),
    height: preset?.height ?? number(fields.height, canvasHeight),
    lockRatio,
    from: number(fields.from, 1),
    to: number(fields.to, totalFrames),
    jpegQuality: number(fields.jpegQuality, 94),
    smoothing: rawText(fields.smoothing, 'edges'),
    dither: typeof fields.dither === 'boolean' ? fields.dither : null,
    videoQuality: fields.videoQuality || 'recommended',
    bitrateMode: fields.bitrateMode || 'auto',
    bitrateMbps: number(fields.bitrateMbps, 8),
    codecs: {mp4: fields.codecs?.mp4 || '', avi: fields.codecs?.avi || ''},
    audio: typeof fields.audio === 'boolean' ? fields.audio : true,
    vfw,
    repeat: fields.repeat === 'forever' || fields.repeat === 'once' ? fields.repeat : null,
    name: typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : null,
  };
}

/**
 * The request after one edit, with today's linked-field rules: a size preset
 * writes Width and Height; typing one side (Lock ratio on) derives the other
 * and switches Size to Custom. The result goes through buildExportRequest's
 * field rules, so the category follows the format, a blank name means the
 * default name and a value no control can hold falls back to its default.
 * context: {canvasWidth, canvasHeight, totalFrames}; size changes throw a
 * TypeError without the artboard size.
 */
export function updateExportRequest(request, patch = {}, context = {}) {
  const fields = {...request, ...patch, codecs: {...request.codecs, ...patch.codecs}, vfw: patch.vfw ? {...request.vfw, ...patch.vfw} : request.vfw};
  const lockRatio = typeof fields.lockRatio === 'boolean' ? fields.lockRatio : true;
  const width = 'width' in patch, height = 'height' in patch;
  if ('sizePreset' in patch && patch.sizePreset !== 'custom') Object.assign(fields, presetSize(patch.sizePreset, artboard(context), lockRatio));
  else if (width || height) {
    fields.sizePreset = 'custom';
    if (width !== height && lockRatio) {
      const edited = width ? 'width' : 'height', other = lockedSide(edited, Number(patch[edited]), artboard(context));
      if (other !== null) fields[width ? 'height' : 'width'] = other;
    }
  }
  return buildExportRequest(fields, context);
}

/**
 * The request with the codec each select shows (exportFormatStates' `codec`:
 * the one asked for, else the default, else the first supported). Call it
 * after every exportFormatStates call: the export must use the shown codec,
 * not a remembered or empty one the probe did not offer. A format the probe
 * has not described yet keeps its codec. Returns the same request when
 * nothing changes.
 */
export function reconcileExportCodecs(request, states) {
  const codecs = {...request.codecs};
  for (const key of ['mp4', 'avi']) {const shown = states?.get(key)?.codec; if (shown !== undefined) codecs[key] = shown;}
  return codecs.mp4 === request.codecs?.mp4 && codecs.avi === request.codecs?.avi ? request : {...request, codecs};
}

/**
 * Transition only, until the export sheet holds the request: today's dialog
 * fields by id. `lookup(id)` returns an element or null (app.mjs's `$`);
 * `format` is the type being exported (the action that runs). Label
 * visibility is not read: the format decides what applies.
 */
export function legacyExportFields(lookup, format) {
  const field = key => lookup(EXPORT_FIELD_IDS[key]) ?? null;
  const value = key => field(key)?.value, checked = key => field(key)?.checked;
  return {
    format, sizePreset: value('sizePreset'), width: value('width'), height: value('height'), lockRatio: checked('lockRatio'),
    from: value('from'), to: value('to'), jpegQuality: value('jpegQuality'), smoothing: value('smoothing'), dither: checked('dither'),
    videoQuality: value('videoQuality'), bitrateMode: value('bitrateMode'), bitrateMbps: value('bitrateMbps'),
    codecs: {mp4: value('mp4Codec'), avi: value('aviCodec')}, audio: checked('audio'),
    vfw: field('vfwCodec') ? {codecId: value('vfwCodec'), quality: value('vfwQuality'), keyframes: value('vfwKeyframes'), bitrateMbps: value('vfwBitrate')} : undefined,
  };
}

/** The encoder quality for pixel exports: JPEG's percentage, else 0.94 (see the header). */
export const exportQuality = request => (request.format === 'jpeg-sequence' ? request.jpegQuality / 100 : EXPORT_DEFAULT_QUALITY);

/**
 * Exactly the object today's exportOptions() derives from the dialog, with
 * its errors. context: {totalFrames (required for an animation),
 * defaultDither: defaultGIFDither(report), maxPixels}. `animation: false`
 * skips the frame range (PNG and SVG frames).
 */
export function exportOptionsFromRequest(request, context = {}, {animation = true} = {}) {
  const {totalFrames, defaultDither = false, maxPixels = EXPORT_MAX_PIXELS} = context;
  if (animation) requireNumber(context, 'totalFrames', 'An animation export');
  const options = {
    width: request.width,
    height: request.height,
    start: request.from - 1,
    end: request.to,
    quality: exportQuality(request),
    dither: request.dither ?? defaultDither,
    smoothing: normalizeExportSmoothing(request.smoothing || 'edges'),
  };
  if (!Number.isInteger(options.width) || !Number.isInteger(options.height) || options.width < 1 || options.height < 1 ||
    options.width > MAX_SIDE || options.height > MAX_SIDE || options.width * options.height > maxPixels)
    throw new Error(`Export size must be whole pixels, up to ${Math.round(maxPixels / 1e6)} million pixels per frame.`);
  if (animation && (!Number.isInteger(options.start) || !Number.isInteger(options.end) || options.start < 0 || options.start >= options.end || options.end > totalFrames))
    throw new Error('Choose a valid export frame range.');
  if (!Number.isFinite(options.quality) || options.quality < 0.01 || options.quality > 1) throw new Error('Quality must be between 1 and 100 percent.');
  return options;
}

const vfwNumber = (text, min, max, label, whole = false) => {
  if (!String(text ?? '').trim()) throw new Error(`Enter ${label.toLowerCase()}.`);
  const value = Number(text);
  if (!Number.isFinite(value) || value < min || value > max || (whole && !Number.isInteger(value))) throw new Error(`${label} must be ${whole ? 'a whole number ' : ''}from ${min} to ${max}.`);
  return value;
};
/**
 * The installed-codec options VfwExportControls.getOptions() returns.
 * `codec` is the chosen codec's capability ({id, supported, quality,
 * keyframes, dataRate}); `ready` is false while the codec check is stale or a
 * configuration dialog is open; `available` is false outside the Windows app.
 */
export function vfwEncodeOptions(vfw, {codec = null, ready = true, available = true} = {}) {
  if (!available) throw new Error('Installed Windows codecs are unavailable in this app.');
  if (!codec?.supported || codec.id !== vfw?.codecId || !ready) throw new Error('Wait for the installed codec check or choose a compatible codec.');
  return {codecId: codec.id, quality: codec.quality ? vfwNumber(vfw.quality, 0, 100, 'Quality') / 100 : 0.9,
    keyframeEvery: codec.keyframes ? vfwNumber(vfw.keyframes, 0, 1000000, 'Keyframe interval', true) : 0,
    bitrate: codec.dataRate ? Math.round(vfwNumber(vfw.bitrateMbps, 0, 200, 'Bitrate') * 1000000) : 0,
    configurationId: vfw.configurationId};
}

/** The project type the figure entry writes: a movieclip saves as .stykmov (the export-stkz command, as today). */
const projectFormat = (request, {movieclip = false} = {}) => (request.format === 'stkz' && movieclip ? 'stykmov' : request.format);

const ILLEGAL_NAME = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|(?:com|lpt)[0-9¹²³])\s*(?:\.|$)/i;
/** Why a typed file name cannot be saved ('' when it can). null means the default name. */
export function exportNameError(name) {
  if (name === null || name === undefined) return '';
  if (typeof name !== 'string' || !name.trim()) return 'Enter a file name.';
  if (ILLEGAL_NAME.test(name)) return 'File names cannot contain \\ / : * ? " < > |.';
  if (/[. ]$/.test(name)) return 'File names cannot end with a dot or a space.';
  if (RESERVED_NAME.test(name)) return 'Windows reserves this name. Choose another name.';
  return '';
}

/** The file name without its extension, as today names each export. The Name field starts with it. */
export function defaultExportName(request, {name = '', objectName = '', tick = 0, movieclip = false} = {}) {
  const format = FORMATS.get(request.format);
  if (format.category === 'editable') return ['stk', 'stkz', 'stykmov'].includes(projectFormat(request, {movieclip})) ? objectName : name || 'Untitled';
  if (format.single) return `${name}-frame-${tick + 1}`;
  if (format.category === 'video') return name;
  return `${name}${isSequence(format.id) ? `-${format.id}` : ''}`;
}
/**
 * The saved file's name. context: {name: editor.name, objectName:
 * nameOf(editor.object), tick: editor.tick, movieclip}. Throws when the typed
 * name cannot be saved (exportNameError).
 */
export function exportFileName(request, context = {}) {
  const format = FORMATS.get(request.format);
  const problem = exportNameError(request.name);
  if (problem) throw new Error(problem);
  const extension = format.category === 'editable' ? projectFormat(request, context) : format.id === 'vfw' ? 'avi' : format.extension;
  return `${request.name ?? defaultExportName(request, context)}.${extension}`;
}

/** Arguments of today's exportVideo(format). context adds {fps (required), provider, audioClips, vfw} to exportOptionsFromRequest's. */
export function videoExportArguments(request, context = {}) {
  const format = request.format;
  if (FORMATS.get(format)?.category !== 'video') throw new Error('Choose a video format.');
  requireNumber(context, 'fps', 'A video export');
  const vfw = format === 'vfw' ? vfwEncodeOptions(request.vfw, context.vfw) : null;
  const codec = codecOf(request);
  const nativeWebm = format === 'webm' && context.provider === 'FFmpeg';
  // Browser video (WebM, or MP4 where there is no desktop encoder) is encoded by WebCodecs.
  const webcodecs = (format === 'webm' && !nativeWebm) || (format === 'mp4' && context.provider === 'WebCodecs');
  const options = exportOptionsFromRequest(request, context), fps = context.fps, ticks = options.end - options.start;
  const extension = format === 'vfw' ? 'avi' : format;
  const videoQuality = format === 'vfw' ? {} : videoQualityOptions({width: options.width, height: options.height, fps,
    preset: request.videoQuality || 'recommended', provider: webcodecs ? 'WebCodecs' : 'FFmpeg',
    mode: request.bitrateMode || 'auto', manualMbps: request.bitrateMbps, lossless: isLossless(request)});
  const encoder = format === 'vfw' ? 'vfw' : webcodecs ? 'webcodecs' : 'native';
  const includeAudio = request.audio && (context.audioClips ?? []).some(clip => clip.start < options.end / fps && clip.start + clip.duration > options.start / fps);
  // Browser video takes sound when its encoder reported it (context.browserAudio); the desktop's FFmpeg always can.
  if (includeAudio && encoder !== 'native' && !(encoder === 'webcodecs' && context.browserAudio)) throw new Error('Audio export requires a desktop FFmpeg video format. Choose MP4, WebM, AVI or WMV with FFmpeg, or turn off Include audio for a silent export.');
  return {encoder, options, fps, ticks, codec, vfw, nativeWebm, videoQuality, includeAudio, extension, filename: exportFileName(request, context),
    encode: {format, codec, ...videoQuality, ...vfw, width: options.width, height: options.height, fps, totalFrames: ticks}};
}

/** Arguments of today's exportImages(format) (GIF, APNG and the sequences). context adds {fps (required), loop}. */
export function imageExportArguments(request, context = {}) {
  const format = request.format, info = FORMATS.get(format);
  if (!info || info.single || !['animated', 'frames'].includes(info.category)) throw new Error('Choose an animated image or a sequence.');
  requireNumber(context, 'fps', 'An image export');
  const options = exportOptionsFromRequest(request, context), fps = context.fps, ticks = options.end - options.start;
  const extension = isSequence(format) ? 'zip' : format === 'apng' ? 'png' : 'gif';
  const loop = request.repeat === null ? context.loop : request.repeat === 'forever';
  if (format === 'svg-sequence') options.smoothing = 'edges';
  return {options, fps, ticks, extension, loop, filename: exportFileName(request, context),
    animation: {format, width: options.width, height: options.height, quality: options.quality, dither: options.dither, fps, totalFrames: ticks, loop}};
}

/** Arguments of today's exportPNG() and exportSVGFrame(): the current frame. */
export function frameExportArguments(request, context = {}) {
  if (!FORMATS.get(request.format)?.single) throw new Error('Choose PNG or SVG frame.');
  const options = exportOptionsFromRequest(request, context, {animation: false});
  return {options: request.format === 'svg' ? {...options, smoothing: 'edges'} : options, filename: exportFileName(request, context)};
}

/**
 * Everything one export needs: the action to run and the arguments it
 * derives today. context, from the same state today's export functions read
 * (fps and audioClips after Simple mode's materialization):
 *   {totalFrames: editor.totalTicks, fps, defaultDither: defaultGIFDither(report), maxPixels,
 *    provider: the chosen format's provider (the state's), audioClips: audibleClips(audioState(report)),
 *    loop: state.loop, name: editor.name, objectName: nameOf(editor.object), tick: editor.tick,
 *    movieclip: isMovieclip(editor.figure), vfw: {codec, ready, available} from VfwExportControls}
 * and request.vfw.configurationId is the VFW configuration for the current size.
 */
export function exportJob(request, context = {}) {
  const info = FORMATS.get(request.format);
  if (!info) throw new TypeError(`Unknown export format: ${request.format}`);
  if (info.category === 'editable') return {kind: 'project', action: info.action, format: projectFormat(request, context), filename: exportFileName(request, context)};
  if (info.single) return {kind: 'frame', action: info.action, ...frameExportArguments(request, context)};
  if (info.category === 'video') return {kind: 'video', action: info.action, ...videoExportArguments(request, context)};
  return {kind: 'image', action: info.action, ...imageExportArguments(request, context)};
}

/**
 * Whether the output keeps transparent areas. Nothing here changes the
 * output: the sheet shows it (Picture › Transparent) with the reason.
 * `provider` is the format's encoder ('FFmpeg' or 'WebCodecs' for WebM and the browser's MP4).
 */
export function exportTransparency(format, {provider} = {}) {
  const info = FORMATS.get(format);
  if (!info || info.category === 'editable') return null;
  if (['png', 'apng', 'png-sequence', 'svg', 'svg-sequence'].includes(format)) return {transparent: true, alpha: 'full'};
  if (format === 'gif' || format === 'gif-sequence') return {transparent: true, alpha: 'binary'};
  if (format === 'webm' && provider === 'FFmpeg') return {transparent: true, alpha: 'full'};
  if (format === 'webm') return {transparent: false, alpha: 'none', reason: 'Browser WebM exports do not preserve transparency.'};
  if (format === 'jpeg-sequence') return {transparent: false, alpha: 'none', matte: 'white', reason: 'JPEG has no transparency: transparent areas become white.'};
  return {transparent: false, alpha: 'none', matte: 'black', reason: `${info.short} has no transparency: transparent areas become black.`};
}

/** The codec a format's select shows: the one asked for (else the default) while supported, else the first supported. */
export function resolveExportCodec(capability, requested) {
  const codecs = capability?.codecs ?? [], wanted = requested || capability?.defaultCodec;
  if (codecs.some(codec => codec.id === wanted && codec.supported)) return wanted;
  return codecs.find(codec => codec.supported)?.id ?? '';
}

/**
 * A format's Codec select, as today's refreshCapabilities() fills it: every
 * codec the probe reports, " · Lossless" after a lossless one whose label
 * does not say so, unsupported ones disabled, and the whole select disabled
 * when none is supported. The value is resolveExportCodec's.
 */
export function exportCodecChoices(capability) {
  const codecs = capability?.codecs ?? [];
  return {disabled: !codecs.some(codec => codec.supported), options: codecs.map(codec => {
    const label = codec.label ?? codec.id;
    return {id: codec.id, label: `${label}${codec.lossless && !/lossless|uncompressed/i.test(label) ? ' · Lossless' : ''}`, disabled: !codec.supported};
  })};
}

/**
 * Each format's state, as today's dialog enables its buttons: Map id →
 * {id, label, listed, disabled, reason, provider, codec, codecLabel, padded}.
 * A disabled format always says why. context: {capabilities:
 * getExportCapabilities() result, or null while it runs; capabilityError;
 * totalFrames; hasObject: Boolean(editor.object); movieclip:
 * isMovieclip(editor.figure); vfw: {listed, ready, reason} from
 * VfwExportControls (reason: its status while not ready); codecs: the
 * request's codecs}. Follow every call with reconcileExportCodecs.
 */
export function exportFormatStates({capabilities = null, capabilityError = null, totalFrames = 0, hasObject = false, movieclip = false, vfw = null, codecs = {}} = {}) {
  const states = new Map();
  for (const format of EXPORT_FORMATS) {
    const empty = totalFrames === 0 && !SINGLE_FRAME_ACTIONS.has(format.action);
    const object = format.needsObject && !hasObject ? 'Select a figure to export it.'
      : format.id === 'stykmov' && !movieclip ? 'Select a movieclip to export it.'
        : format.id === 'stkz' && movieclip ? 'A movieclip exports as .stykmov.' : '';
    // Before the probe returns only MP4, AVI and WMV wait; VFW waits for its codec check.
    const waiting = ['mp4', 'avi', 'wmv'].includes(format.id) ? 'Checking video encoders…'
      : format.id === 'vfw' && !vfw?.ready ? vfw?.reason || 'Checking installed codecs…' : '';
    states.set(format.id, {id: format.id, label: format.label, listed: format.id === 'vfw' ? Boolean(vfw?.listed) : true,
      disabled: empty || Boolean(object) || Boolean(waiting), reason: empty ? NO_FRAMES : object || waiting,
      provider: undefined, codec: undefined, codecLabel: '', padded: null});
  }
  if (capabilityError) {
    for (const id of ['webm', 'mp4', 'avi', 'wmv']) Object.assign(states.get(id), {disabled: true, reason: capabilityError.message ?? String(capabilityError)});
    return states;
  }
  for (const format of capabilities?.formats ?? []) {
    const state = states.get(format.id);
    if (!state) continue;
    const empty = totalFrames === 0 && !SINGLE_FRAME_ACTIONS.has(FORMATS.get(format.id).action);
    const codec = FORMATS.get(format.id).codecKey ? resolveExportCodec(format, codecs[format.id]) : undefined;
    const selected = format.codecs?.find(option => option.id === codec);
    const encodedWidth = selected?.encodedWidth || format.encodedWidth, encodedHeight = selected?.encodedHeight || format.encodedHeight;
    Object.assign(state, {provider: format.provider || '', codec, codecLabel: selected?.label || format.codec || '', ...(format.audio === true ? {audio: true} : {}),
      // Today's "960 × 544 (padded)": the encoder pads odd sizes.
      padded: format.supported && encodedWidth && (encodedWidth !== capabilities.width || encodedHeight !== capabilities.height) ? {width: encodedWidth, height: encodedHeight} : null,
      disabled: !format.supported || selected?.supported === false || empty,
      reason: (empty ? NO_FRAMES : '') || format.reason || (selected ? selected.notice : format.notice) || ''});
  }
  return states;
}

/** The Type select's words for a format (revision 4: "MP4 (.mp4)"). */
const typeName = format => `${['video', 'animated'].includes(format.category) && format.id !== 'vfw' ? format.short : format.label} (.${format.extension})`;
/**
 * The Type choices of a category: listed formats in order. `label` is
 * today's option text ("MP4 video · Unavailable"), `type` revision 4's
 * ("MP4 (.mp4) · Unavailable"); `reason` explains a disabled one.
 */
export function formatChoices(category, states) {
  const formats = EXPORT_CATEGORIES.find(entry => entry.id === category)?.formats ?? [];
  return formats.map(id => states.get(id)).filter(state => state?.listed).map(state => {
    const suffix = state.disabled ? ' · Unavailable' : '';
    return {id: state.id, label: `${state.label}${suffix}`, type: `${typeName(FORMATS.get(state.id))}${suffix}`, extension: FORMATS.get(state.id).extension,
      disabled: state.disabled, reason: state.reason};
  });
}
/** Today's Type selection rule: keep the chosen format while it is listed (even while momentarily disabled), else the first enabled, else the first. */
export function resolveFormatChoice(current, category, states) {
  const choices = formatChoices(category, states);
  return choices.find(choice => choice.id === current)?.id ?? choices.find(choice => !choice.disabled)?.id ?? choices[0]?.id ?? '';
}
export const defaultExportFormat = states => resolveFormatChoice(null, 'video', states);

/** Which rows today's dialog shows for a request (export-panel.mjs updateSettings). */
export function exportFieldVisibility(request, {audioClips = []} = {}) {
  const info = FORMATS.get(request.format), format = info.id, editable = info.category === 'editable';
  const video = usesVideoQuality(format), lossless = isLossless(request), manual = video && !lossless && request.bitrateMode === 'manual';
  return {settings: !editable, size: !editable, range: !editable && !info.single, smoothing: !editable && !isVector(format), jpegQuality: format === 'jpeg-sequence',
    dither: format === 'gif' || format === 'gif-sequence', videoQuality: video && !lossless && !manual, bitrateMode: video && !lossless,
    bitrateMbps: manual, mp4Codec: format === 'mp4', aviCodec: format === 'avi', encoding: video, vfw: format === 'vfw',
    audio: info.category === 'video' && audioClips.length > 0};
}

const numberFieldValid = (value, min, max, step) => Number.isFinite(value) && value >= min && value <= max && (step === undefined || Number.isInteger((value - min) / step));

/**
 * Today's inline validation (export-panel.mjs updateSettings), in its order:
 * the first error wins, every failing field is marked.
 * context: {states: exportFormatStates(), totalFrames, fps, audioClips,
 * audioSupported, deviceMemory, maxPixels}. Returns {error, notice,
 * invalid: field names, canExport}.
 */
export function validateExportRequest(request, context = {}) {
  const {states = exportFormatStates(), totalFrames = 0, fps = 24, audioClips = [], audioSupported = false, deviceMemory, maxPixels = EXPORT_MAX_PIXELS} = context;
  const info = FORMATS.get(request.format), format = info.id, state = states.get(format);
  const editable = info.category === 'editable', single = Boolean(info.single), vector = isVector(format);
  const video = usesVideoQuality(format), lossless = isLossless(request), manual = video && !lossless && request.bitrateMode === 'manual';
  const {width: w, height: h, from: first, to: last} = request, count = single ? 1 : last - first + 1;
  let error = '';
  const invalid = new Set(), mark = (fields, message) => {for (const field of fields) invalid.add(field); error ||= message;};
  // Sound goes in through the desktop's FFmpeg, or through a browser encoder that reported it can encode it.
  const soundEncoder = format !== 'vfw' && (state?.provider === 'FFmpeg' ? audioSupported : state?.provider === 'WebCodecs' && state.audio === true);
  if (info.category === 'video' && request.audio && audioClips.some(clip => clip.start < last / fps && clip.start + clip.duration > (first - 1) / fps) &&
    !soundEncoder) error = AUDIO_NEEDS_FFMPEG;
  const nameError = exportNameError(request.name);
  if (nameError) mark(['name'], nameError);
  if (!editable) {
    if (![w, h].every(n => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE) || w * h > maxPixels)
      mark(['width', 'height'], `Enter whole-pixel dimensions, up to ${Math.round(maxPixels / 1e6)} million pixels per frame.`);
    if (!single && (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > totalFrames))
      mark(['from', 'to'], `Choose a frame range from 1 to ${totalFrames}. The last frame must be at or after the first.`);
    if (!error && !vector) {
      try {exportMemoryPlan(w, h, request.smoothing, {deviceMemory});}
      catch (failure) {mark(['width', 'height'], failure.message);}
    }
    if (format === 'jpeg-sequence' && !numberFieldValid(request.jpegQuality, 1, 100, 1)) mark(['jpegQuality'], 'Enter a value between 1 and 100.');
    if (manual && !numberFieldValid(request.bitrateMbps, 0.1, 200)) mark(['bitrateMbps'], 'Enter a value between 0.1 and 200.');
    if (video) {
      try {videoQualityOptions({width: w, height: h, fps, preset: request.videoQuality, provider: state?.provider || 'FFmpeg', mode: manual ? 'manual' : 'auto', manualMbps: request.bitrateMbps, lossless});}
      catch (failure) {mark(['bitrateMbps'], failure.message);}
    }
    if (format === 'gif' && fps > 50) error ||= 'GIF supports up to 50 fps. Choose Animated PNG or Video for this animation.';
    const maxFrames = isSequence(format) ? 65534 : info.category === 'animated' ? 100000 : 1000000;
    if (!single && count > maxFrames) mark(['from', 'to'], `This format supports up to ${maxFrames.toLocaleString()} frames. Choose a shorter range.`);
  }
  return {error, notice: error || state?.reason || '', invalid: [...invalid], canExport: Boolean(state?.listed) && !state.disabled && !error};
}

/** The primary's words: it names the format ("Export MP4"). */
export function exportPrimaryLabel(request, {movieclip = false} = {}) {
  return `Export ${request.format === 'stkz' && movieclip ? 'STYKMOV' : FORMATS.get(request.format).short}`;
}

/**
 * The Encoding section title's summary ("H.264 · automatic bitrate"): the
 * shown codec, then the rate (none for a lossless codec), then today's
 * padding note. VFW names its installed codec (vfwCodec: the chosen one's
 * capability). '' for formats without Encoding.
 */
export function exportEncodingSummary(request, states, {vfwCodec = null} = {}) {
  if (request.format === 'vfw') return vfwCodec?.label ?? '';
  if (!usesVideoQuality(request.format)) return '';
  const state = states?.get(request.format), padded = state?.padded;
  const rate = isLossless(request) ? ''
    : request.bitrateMode === 'manual' ? `${Number.isFinite(request.bitrateMbps) ? request.bitrateMbps.toLocaleString() : '—'} Mbit/s` : 'automatic bitrate';
  return [state?.codecLabel, rate, padded ? `${size(padded.width, padded.height)} (padded)` : ''].filter(Boolean).join(' · ');
}

/** Today's foot summary: output pixels, then the frame count, duration and rate (or the current frame). */
export function exportSummary(request, {fps = 24, currentFrame = 1} = {}) {
  const info = FORMATS.get(request.format);
  if (info.category === 'editable') return {size: '', time: ''};
  const {width: w, height: h} = request, count = info.single ? 1 : request.to - request.from + 1;
  const pixels = `${Number.isFinite(w) ? w.toLocaleString() : '—'} × ${Number.isFinite(h) ? h.toLocaleString() : '—'} px`;
  if (info.single) return {size: pixels, time: `Current frame · ${currentFrame}`};
  const duration = count > 0 && count / fps < 10 ? `${Number((count / fps).toFixed(2))}s` : exportTime(count > 0 ? count / fps : NaN);
  return {size: pixels, time: `${Number.isInteger(count) && count > 0 ? count.toLocaleString() : '—'} ${count === 1 ? 'frame' : 'frames'} · ${duration} at ${Number(fps.toFixed(2))} fps`};
}

/**
 * Today's Frames note in Simple mode (export-panel.mjs): From and To count
 * played frames, so it relates them to the timeline's. storedFrames:
 * simpleFrameCount() (null outside Simple). '' when they are the same.
 */
export function exportPlayedFramesNote(storedFrames, totalFrames) {
  if (!Number.isInteger(storedFrames) || storedFrames === totalFrames) return '';
  return `Export counts every frame that plays. Your ${storedFrames} timeline ${storedFrames === 1 ? 'frame plays' : 'frames play'} as ${totalFrames} with inbetweens.`;
}
/** Today's working-pose note: an unsaved pose being added as a frame is not exported. frameDraft: editor.frameDraft. */
export function exportWorkingPoseNote(frameDraft, totalFrames) {
  return frameDraft?.mode === 'add' && frameDraft.dirty && totalFrames > 0
    ? 'Add the working pose as a frame to include it in animation exports. Your .styk project keeps the working pose.' : '';
}
/** Today's "Use entire animation" (#export-all-frames): the patch it applies. */
export const entireAnimationPatch = totalFrames => ({from: 1, to: totalFrames});

/**
 * Remembered choices (the editor setting `exportPreferences`). The first
 * open uses today's defaults; the frame range, the content-based dither,
 * Include audio, the GIF repeat and the name are never remembered.
 */
export const DEFAULT_EXPORT_PREFERENCES = Object.freeze({format: null, sizePreset: 'original', width: null, height: null, lockRatio: true, smoothing: 'edges',
  jpegQuality: 94, videoQuality: 'recommended', bitrateMode: 'auto', bitrateMbps: 8, codecs: Object.freeze({mp4: '', avi: ''}), encodingOpen: false});
const pixels = value => (Number.isInteger(value) && value >= 1 && value <= MAX_SIDE ? value : null);
const codecId = value => (typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,31}$/i.test(value) ? value : '');
export function normalizeExportPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {...DEFAULT_EXPORT_PREFERENCES, codecs: {...DEFAULT_EXPORT_PREFERENCES.codecs}};
  if (FORMATS.has(source.format)) result.format = source.format;
  if (SIZE_PRESETS.has(source.sizePreset)) result.sizePreset = source.sizePreset;
  if (result.sizePreset === 'custom') {result.width = pixels(source.width); result.height = pixels(source.height);}
  for (const key of ['lockRatio', 'encodingOpen']) if (typeof source[key] === 'boolean') result[key] = source[key];
  if (EXPORT_SMOOTHING.some(option => option.value === source.smoothing)) result.smoothing = source.smoothing;
  if (Number.isInteger(source.jpegQuality) && source.jpegQuality >= 1 && source.jpegQuality <= 100) result.jpegQuality = source.jpegQuality;
  if (VIDEO_QUALITY_PRESETS.some(option => option.value === source.videoQuality)) result.videoQuality = source.videoQuality;
  if (source.bitrateMode === 'auto' || source.bitrateMode === 'manual') result.bitrateMode = source.bitrateMode;
  if (Number.isFinite(source.bitrateMbps) && source.bitrateMbps >= 0.1 && source.bitrateMbps <= 200) result.bitrateMbps = source.bitrateMbps;
  for (const key of ['mp4', 'avi']) result.codecs[key] = codecId(source.codecs?.[key]);
  return result;
}
/** The preferences to store after an export: the request's remembered fields, invalid values dropped. */
export function exportPreferencesFromRequest(request, previous) {
  const {encodingOpen} = normalizeExportPreferences(previous);
  return normalizeExportPreferences({format: request.format, sizePreset: request.sizePreset, width: request.width, height: request.height,
    lockRatio: request.lockRatio, smoothing: request.smoothing, jpegQuality: request.jpegQuality, videoQuality: request.videoQuality,
    bitrateMode: request.bitrateMode, bitrateMbps: request.bitrateMbps, codecs: request.codecs, encodingOpen});
}

/**
 * The request a new export dialog starts with. context: {canvasWidth,
 * canvasHeight, totalFrames}; states: exportFormatStates() when it opens.
 * A remembered format is kept while it is listed (an unavailable one
 * disables Export with its reason rather than switching silently). A
 * remembered Custom size is kept only on an artboard of its shape; on any
 * other it opens as Original, so the export is never squashed.
 */
export function initialExportRequest({preferences, states = exportFormatStates(), context = {}} = {}) {
  const remembered = normalizeExportPreferences(preferences), {canvasWidth = 1, canvasHeight = 1, totalFrames = 0} = context;
  const format = remembered.format && states.get(remembered.format)?.listed ? remembered.format : defaultExportFormat(states);
  const board = {canvasWidth, canvasHeight};
  const sizePreset = remembered.sizePreset === 'custom' && !sameShape(remembered, board) ? 'original' : remembered.sizePreset;
  const chosen = sizePreset === 'custom' ? {width: remembered.width, height: remembered.height}
    : sizePreset === 'original' ? {width: canvasWidth, height: canvasHeight} : presetSize(sizePreset, board, remembered.lockRatio);
  return reconcileExportCodecs(buildExportRequest({format: format || 'webm', sizePreset, ...chosen, lockRatio: remembered.lockRatio,
    from: totalFrames === 0 ? 0 : 1, to: totalFrames, jpegQuality: remembered.jpegQuality, smoothing: remembered.smoothing,
    videoQuality: remembered.videoQuality, bitrateMode: remembered.bitrateMode, bitrateMbps: remembered.bitrateMbps, codecs: remembered.codecs}, context), states);
}
