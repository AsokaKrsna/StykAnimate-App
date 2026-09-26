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
 *     codecs: {mp4: 'h264', avi: 'mpeg4'},   // the resolved codec of each select
 *     audio: true,                // Include audio
 *     vfw: null,                  // {codecId, quality, keyframes, bitrateMbps, configurationId}
 *     repeat: null,               // GIF: 'forever' | 'once'; null follows the Loop setting, as today
 *     name: null,                 // file name without extension; null: today's names
 *   }
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
 */
import {EXPORT_MAX_PIXELS, EXPORT_SMOOTHING, normalizeExportSmoothing} from './export-sampling.mjs';
import {VIDEO_QUALITY_PRESETS, videoQualityOptions} from './export-video-quality.mjs';
import {exportMemoryPlan} from './export-memory.mjs';
import {exportTime} from './export-progress.mjs';

/** The quality every format but the JPEG sequence exports with (today's hidden-field value). */
export const EXPORT_DEFAULT_QUALITY = 0.94;
const NO_FRAMES = 'Add a frame to export an animation.';
const AUDIO_NEEDS_FFMPEG = 'Choose a desktop FFmpeg video format to include sound, or turn off Include audio for a silent export.';

const entry = (id, action, category, label, short, extension, extra = {}) => Object.freeze({id, action, category, label, short, extension, ...extra});
/** Every export type, in today's order within its category. `label` is today's button title. */
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
  entry('stkz', 'export-stkz', 'editable', 'StykAnimate figure', 'STKZ', 'stkz', {needsObject: true}),
  entry('piv', 'export-piv', 'editable', 'Pivot animation', 'PIV', 'piv'),
  entry('stk', 'export-stk', 'editable', 'Pivot figure', 'STK', 'stk', {needsObject: true}),
  // Reached through its command (the movieclip menu); the dialog's figure type writes .stykmov for a movieclip.
  entry('stykmov', 'export-stykmov', 'editable', 'StykAnimate movieclip', 'STYKMOV', 'stykmov', {needsObject: true, listed: false}),
]);
const FORMATS = new Map(EXPORT_FORMATS.map(format => [format.id, format]));
const BY_ACTION = new Map(EXPORT_FORMATS.map(format => [format.action, format.id]));
const SINGLE_FRAME_ACTIONS = new Set(['export-piv', 'export-stk', 'export-stkz', 'export-png', 'export-svg']);

/** Today's categories (export-panel.mjs); `short` is the revision 4 segmented label. */
export const EXPORT_CATEGORIES = Object.freeze([
  Object.freeze({id: 'video', label: 'Video', short: 'Video', formats: Object.freeze(['mp4', 'webm', 'avi', 'wmv', 'vfw'])}),
  Object.freeze({id: 'animated', label: 'Animated image', short: 'GIF', formats: Object.freeze(['gif', 'apng'])}),
  Object.freeze({id: 'frames', label: 'Frames & sequences', short: 'Frames', formats: Object.freeze(['png', 'svg', 'png-sequence', 'jpeg-sequence', 'gif-sequence', 'svg-sequence'])}),
  Object.freeze({id: 'editable', label: 'Editable file', short: 'Project', formats: Object.freeze(['stkz', 'piv', 'stk'])}),
]);

/** Size presets scale the short side and keep the artboard's shape and orientation. */
export const EXPORT_SIZE_PRESETS = Object.freeze([
  Object.freeze({id: 'original', label: 'Original'}),
  Object.freeze({id: '1080', label: '1080p', shortSide: 1080}),
  Object.freeze({id: '720', label: '720p', shortSide: 720}),
  Object.freeze({id: '2160', label: '4K', shortSide: 2160}),
  Object.freeze({id: 'custom', label: 'Custom…'}),
]);
const SIZE_PRESETS = new Set(EXPORT_SIZE_PRESETS.map(preset => preset.id));

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
 * and switches Size to Custom; choosing a format sets its category.
 */
export function updateExportRequest(request, patch = {}, context = {}) {
  const next = {...request, ...patch, codecs: {...request.codecs, ...patch.codecs}};
  if (patch.vfw) next.vfw = {...request.vfw, ...patch.vfw};
  if ('format' in patch) {
    const format = FORMATS.get(patch.format);
    if (!format) throw new TypeError(`Unknown export format: ${patch.format}`);
    next.category = format.category;
  }
  for (const key of ['from', 'to', 'jpegQuality', 'bitrateMbps']) if (key in patch) next[key] = Number(patch[key]);
  const width = 'width' in patch, height = 'height' in patch;
  if ('sizePreset' in patch && patch.sizePreset !== 'custom') Object.assign(next, presetSize(patch.sizePreset, context, next.lockRatio));
  else if (width || height) {
    next.sizePreset = 'custom';
    if (width) next.width = Number(patch.width);
    if (height) next.height = Number(patch.height);
    if (width !== height && next.lockRatio) {
      const edited = width ? 'width' : 'height', other = lockedSide(edited, next[edited], context);
      if (other !== null) next[width ? 'height' : 'width'] = other;
    }
  }
  return next;
}

/**
 * Transition only, until the export sheet holds the request: today's dialog
 * fields by id. `lookup(id)` returns an element or null (app.mjs's `$`);
 * `format` is the type being exported (the action that runs). Label
 * visibility is not read: the format decides what applies.
 */
export function legacyExportFields(lookup, format) {
  const field = id => lookup(`export-${id}`) ?? null;
  const value = id => field(id)?.value, checked = id => field(id)?.checked;
  return {
    format, sizePreset: value('resolution'), width: value('width'), height: value('height'), lockRatio: checked('aspect'),
    from: value('start'), to: value('end'), jpegQuality: value('quality'), smoothing: value('smoothing'), dither: checked('gif-dither'),
    videoQuality: value('video-quality'), bitrateMode: value('bitrate-mode'), bitrateMbps: value('video-bitrate'),
    codecs: {mp4: value('mp4-codec'), avi: value('avi-codec')}, audio: checked('audio'),
    vfw: field('vfw-codec') ? {codecId: value('vfw-codec'), quality: value('vfw-quality'), keyframes: value('vfw-keyframes'), bitrateMbps: value('vfw-bitrate')} : undefined,
  };
}

/** The encoder quality for pixel exports: JPEG's percentage, else 0.94 (see the header). */
export const exportQuality = request => (request.format === 'jpeg-sequence' ? request.jpegQuality / 100 : EXPORT_DEFAULT_QUALITY);

/**
 * Exactly the object today's exportOptions() derives from the dialog, with
 * its errors. context: {totalFrames, defaultDither: defaultGIFDither(report),
 * maxPixels}. `animation: false` skips the frame range (PNG and SVG frames).
 */
export function exportOptionsFromRequest(request, context = {}, {animation = true} = {}) {
  const {totalFrames, defaultDither = false, maxPixels = EXPORT_MAX_PIXELS} = context;
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
    options.width > 16384 || options.height > 16384 || options.width * options.height > maxPixels)
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

/** The project type the dialog's figure entry writes: a movieclip saves as .stykmov. */
const projectFormat = (request, {movieclip = false} = {}) => (request.format === 'stkz' && movieclip ? 'stykmov' : request.format);

/** The file name without its extension, as today names each export. The Name field starts with it. */
export function defaultExportName(request, {name = '', objectName = '', tick = 0, movieclip = false} = {}) {
  const format = FORMATS.get(request.format);
  if (format.category === 'editable') return ['stk', 'stkz', 'stykmov'].includes(projectFormat(request, {movieclip})) ? objectName : name || 'Untitled';
  if (format.single) return `${name}-frame-${tick + 1}`;
  if (format.category === 'video') return name;
  return `${name}${isSequence(format.id) ? `-${format.id}` : ''}`;
}
/** The saved file's name. context: {name: editor.name, objectName: nameOf(editor.object), tick: editor.tick, movieclip}. */
export function exportFileName(request, context = {}) {
  const format = FORMATS.get(request.format);
  const extension = format.category === 'editable' ? projectFormat(request, context) : format.id === 'vfw' ? 'avi' : format.extension;
  return `${request.name ?? defaultExportName(request, context)}.${extension}`;
}

/** Arguments of today's exportVideo(format). context adds {fps, provider, audioClips, vfw} to exportOptionsFromRequest's. */
export function videoExportArguments(request, context = {}) {
  const format = request.format;
  if (FORMATS.get(format)?.category !== 'video') throw new Error('Choose a video format.');
  const vfw = format === 'vfw' ? vfwEncodeOptions(request.vfw, context.vfw) : null;
  const codec = codecOf(request);
  const nativeWebm = format === 'webm' && context.provider === 'FFmpeg';
  const options = exportOptionsFromRequest(request, context), fps = context.fps, ticks = options.end - options.start;
  const extension = format === 'vfw' ? 'avi' : format;
  const videoQuality = format === 'vfw' ? {} : videoQualityOptions({width: options.width, height: options.height, fps,
    preset: request.videoQuality || 'recommended', provider: format === 'webm' && !nativeWebm ? 'WebCodecs' : 'FFmpeg',
    mode: request.bitrateMode || 'auto', manualMbps: request.bitrateMbps, lossless: isLossless(request)});
  const encoder = format === 'vfw' ? 'vfw' : format === 'webm' && !nativeWebm ? 'webcodecs' : 'native';
  const includeAudio = request.audio && (context.audioClips ?? []).some(clip => clip.start < options.end / fps && clip.start + clip.duration > options.start / fps);
  if (includeAudio && encoder !== 'native') throw new Error('Audio export requires a desktop FFmpeg video format. Choose MP4, WebM, AVI or WMV with FFmpeg, or turn off Include audio for a silent export.');
  return {encoder, options, fps, ticks, codec, vfw, nativeWebm, videoQuality, includeAudio, extension, filename: exportFileName(request, context),
    encode: {format, codec, ...videoQuality, ...vfw, width: options.width, height: options.height, fps, totalFrames: ticks}};
}

/** Arguments of today's exportImages(format) (GIF, APNG and the sequences). context adds {fps, loop}. */
export function imageExportArguments(request, context = {}) {
  const format = request.format, info = FORMATS.get(format);
  if (!info || info.single || !['animated', 'frames'].includes(info.category)) throw new Error('Choose an animated image or a sequence.');
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

/** Everything one export needs: the action to run and the arguments it derives today. */
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
 * `provider` is the format's encoder ('FFmpeg' or 'WebCodecs' for WebM).
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
 * Each format's state, as today's dialog enables its buttons: Map id →
 * {id, label, listed, disabled, reason, provider, codec}.
 * context: {capabilities: getExportCapabilities() result, or null while it
 * runs; capabilityError; totalFrames; hasObject: Boolean(editor.object);
 * movieclip; vfw: {listed, ready} from VfwExportControls; codecs: the
 * request's codecs}.
 */
export function exportFormatStates({capabilities = null, capabilityError = null, totalFrames = 0, hasObject = false, movieclip = false, vfw = null, codecs = {}} = {}) {
  const states = new Map();
  for (const format of EXPORT_FORMATS) {
    const empty = totalFrames === 0 && !SINGLE_FRAME_ACTIONS.has(format.action);
    states.set(format.id, {id: format.id, label: format.id === 'stkz' && movieclip ? 'StykAnimate movieclip' : format.label,
      listed: format.id === 'vfw' ? Boolean(vfw?.listed) : format.listed !== false,
      // Before the probe returns only MP4, AVI and WMV wait; VFW waits for its codec check.
      disabled: empty || (format.needsObject && !hasObject) || ['mp4', 'avi', 'wmv'].includes(format.id) || (format.id === 'vfw' && !vfw?.ready),
      reason: empty ? NO_FRAMES : '', provider: undefined, codec: undefined});
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
    Object.assign(state, {provider: format.provider || '', codec,
      disabled: !format.supported || selected?.supported === false || empty,
      reason: (empty ? NO_FRAMES : '') || format.reason || (selected ? selected.notice : format.notice) || ''});
  }
  return states;
}

/** The Type choices of a category: listed formats in today's order, "· Unavailable" on disabled ones. */
export function formatChoices(category, states) {
  const formats = EXPORT_CATEGORIES.find(entry => entry.id === category)?.formats ?? [];
  return formats.map(id => states.get(id)).filter(state => state?.listed)
    .map(state => ({id: state.id, label: `${state.label}${state.disabled ? ' · Unavailable' : ''}`, disabled: state.disabled}));
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
const ILLEGAL_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

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
  if (info.category === 'video' && request.audio && audioClips.some(clip => clip.start < last / fps && clip.start + clip.duration > (first - 1) / fps) &&
    (!audioSupported || state?.provider !== 'FFmpeg' || format === 'vfw')) error = AUDIO_NEEDS_FFMPEG;
  if (request.name !== null && ILLEGAL_NAME.test(request.name)) mark(['name'], 'File names cannot contain \\ / : * ? " < > |.');
  if (!editable) {
    if (![w, h].every(n => Number.isInteger(n) && n >= 1 && n <= 16384) || w * h > maxPixels)
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

/** Today's foot summary: output pixels, then the frame count, duration and rate (or the current frame). */
export function exportSummary(request, {fps = 24, currentFrame = 1} = {}) {
  const info = FORMATS.get(request.format);
  if (info.category === 'editable') return {size: '', time: ''};
  const {width: w, height: h} = request, count = info.single ? 1 : request.to - request.from + 1;
  const size = `${Number.isFinite(w) ? w.toLocaleString() : '—'} × ${Number.isFinite(h) ? h.toLocaleString() : '—'} px`;
  if (info.single) return {size, time: `Current frame · ${currentFrame}`};
  const duration = count > 0 && count / fps < 10 ? `${Number((count / fps).toFixed(2))}s` : exportTime(count > 0 ? count / fps : NaN);
  return {size, time: `${Number.isInteger(count) && count > 0 ? count.toLocaleString() : '—'} ${count === 1 ? 'frame' : 'frames'} · ${duration} at ${Number(fps.toFixed(2))} fps`};
}

/**
 * Remembered choices (the editor setting `exportPreferences`). The first
 * open uses today's defaults; the frame range, the content-based dither,
 * Include audio and the GIF repeat are never remembered.
 */
export const DEFAULT_EXPORT_PREFERENCES = Object.freeze({format: null, sizePreset: 'original', width: null, height: null, lockRatio: true, smoothing: 'edges',
  jpegQuality: 94, videoQuality: 'recommended', bitrateMode: 'auto', bitrateMbps: 8, codecs: Object.freeze({mp4: '', avi: ''}), encodingOpen: false});
const pixels = value => (Number.isInteger(value) && value >= 1 && value <= 16384 ? value : null);
const codecId = value => (typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,31}$/i.test(value) ? value : '');
export function normalizeExportPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {...DEFAULT_EXPORT_PREFERENCES, codecs: {...DEFAULT_EXPORT_PREFERENCES.codecs}};
  if (FORMATS.has(source.format) && FORMATS.get(source.format).listed !== false) result.format = source.format;
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
 * disables Export with its reason rather than switching silently).
 */
export function initialExportRequest({preferences, states = exportFormatStates(), context = {}} = {}) {
  const remembered = normalizeExportPreferences(preferences), {canvasWidth = 1, canvasHeight = 1, totalFrames = 0} = context;
  const format = remembered.format && states.get(remembered.format)?.listed ? remembered.format : defaultExportFormat(states);
  const custom = remembered.sizePreset === 'custom';
  const size = custom ? {width: remembered.width ?? canvasWidth, height: remembered.height ?? canvasHeight}
    : remembered.sizePreset === 'original' ? {width: canvasWidth, height: canvasHeight} : presetSize(remembered.sizePreset, {canvasWidth, canvasHeight}, remembered.lockRatio);
  return buildExportRequest({format: format || 'webm', sizePreset: remembered.sizePreset, ...size, lockRatio: remembered.lockRatio,
    from: totalFrames === 0 ? 0 : 1, to: totalFrames, jpegQuality: remembered.jpegQuality, smoothing: remembered.smoothing,
    videoQuality: remembered.videoQuality, bitrateMode: remembered.bitrateMode, bitrateMbps: remembered.bitrateMbps, codecs: remembered.codecs}, context);
}
