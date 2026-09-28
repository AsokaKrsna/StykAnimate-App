/**
 * Export presets: one click for where the animation is going (YouTube,
 * TikTok, a chat GIF…). Pure functions over the export request
 * (export-request.mjs): a preset is a patch of the request's own fields, so
 * choosing one is an ordinary edit and every setting it chose stays visible
 * and editable. No DOM and no I/O.
 *
 * A preset never changes the picture's shape. Export scales the canvas to the
 * output size, so a 9:16 size on a 16:9 canvas would stretch the animation;
 * the size presets (export-request.mjs) keep the canvas's shape and so do
 * these. exportPresetFit() says when the canvas's shape is not the one the
 * platform shows full screen, and where to change it.
 *
 *   applyExportPreset(preset, {board, states}) → the patch for updateExportRequest
 *   exportPresetHeld(preset, applied, request) → whether the request still is the preset
 *   exportPresetFit(preset, board, request)     → {fits, message}
 */
import {lockedSide, sizePresetChoices} from './export-request.mjs';

const preset = (id, label, detail, icon, fields) => Object.freeze({id, label, detail, icon, ...fields});
/**
 * `formats`: the types in order of preference; the first enabled one is used
 * (MP4 needs the desktop app's encoder, and YouTube, Shorts and TikTok also
 * take WebM). A platform that takes only MP4 lists only MP4, so the browser
 * shows why it cannot export rather than making a file the platform refuses.
 * `shapes`: the canvas shapes the platform shows full screen. `size`: a size
 * preset id, or `{shortSide}` for a smaller custom size (never larger than the
 * canvas). `quality`: the video quality preset. `ready`: the note once chosen, before the size.
 */
export const EXPORT_PRESETS = Object.freeze([
  preset('youtube', 'YouTube', '1080p · 16:9', 'export-youtube', {ready: 'Ready for YouTube', formats: ['mp4', 'webm'], size: '1080', quality: 'high', shapes: ['landscape'], wants: 'landscape (16:9)'}),
  preset('shorts', 'Shorts', '1080p · 9:16', 'export-shorts', {ready: 'Ready for YouTube Shorts', formats: ['mp4', 'webm'], size: '1080', quality: 'high', shapes: ['portrait', 'square'], wants: 'vertical (9:16)'}),
  preset('tiktok', 'TikTok', '1080p · 9:16', 'export-tiktok', {ready: 'Ready for TikTok', formats: ['mp4', 'webm'], size: '1080', quality: 'recommended', shapes: ['portrait'], wants: 'vertical (9:16)'}),
  preset('instagram', 'Instagram', 'Reels · 9:16', 'export-instagram', {ready: 'Ready for Instagram Reels', formats: ['mp4'], size: '1080', quality: 'recommended', shapes: ['portrait', 'square'], wants: 'vertical (9:16)'}),
  preset('x', 'X', '720p video', 'export-x', {ready: 'Ready for X', formats: ['mp4'], size: '720', quality: 'recommended', shapes: ['landscape', 'portrait', 'square']}),
  preset('gif', 'Chat GIF', 'Small loop', 'export-gif', {ready: 'Small enough to share in chats', formats: ['gif'], size: {shortSide: 480}, shapes: ['landscape', 'portrait', 'square']}),
  preset('transparent', 'Transparent', 'PNG frames', 'export-transparent', {ready: 'Every frame keeps its transparency, for video editors', formats: ['png-sequence'], size: 'original', shapes: ['landscape', 'portrait', 'square']}),
  preset('best', 'Best quality', '4K video', 'export-best', {ready: 'The sharpest copy to keep', formats: ['mp4', 'webm'], size: '2160', fallbackSize: '1080', quality: 'high', shapes: ['landscape', 'portrait', 'square']}),
]);
const PRESETS = new Map(EXPORT_PRESETS.map(entry => [entry.id, entry]));
export const exportPresetInfo = id => PRESETS.get(id) ?? null;

/** The canvas's shape: square within 10%, else landscape or portrait. */
export function artboardShape({canvasWidth, canvasHeight}) {
  const ratio = canvasWidth / canvasHeight;
  return ratio > 1.1 ? 'landscape' : ratio < 1 / 1.1 ? 'portrait' : 'square';
}

/**
 * The first of the preset's types that can export or is still being checked (so the desktop app's MP4 is chosen
 * before its encoder check returns; the sheet re-applies the preset if it proves unavailable); else the first listed.
 */
function presetFormat(entry, states) {
  const listed = entry.formats.filter(id => states?.get(id)?.listed ?? true);
  const usable = id => !states?.get(id)?.disabled || /^Checking\b/.test(states?.get(id)?.reason ?? '');
  return listed.find(usable) ?? listed[0] ?? entry.formats[0];
}

/** The size fields for a preset: a size preset that fits the export limits, or a custom size scaled down to `shortSide`. */
function presetSizeFields(entry, board) {
  if (typeof entry.size === 'object') {
    const short = Math.min(board.canvasWidth, board.canvasHeight);
    if (short <= entry.size.shortSide) return {sizePreset: 'original'};
    const width = Math.max(1, Math.round(board.canvasWidth * entry.size.shortSide / short));
    return {sizePreset: 'custom', width, height: lockedSide('width', width, board), lockRatio: true};
  }
  if (entry.size === 'original') return {sizePreset: 'original'};
  const choices = sizePresetChoices(board), usable = id => choices.some(choice => choice.id === id && !choice.disabled);
  return {sizePreset: usable(entry.size) || !entry.fallbackSize ? entry.size : entry.fallbackSize};
}

/**
 * The request patch a preset applies. context: {board: {canvasWidth,
 * canvasHeight}, states: exportFormatStates()}. Video presets use H.264 for
 * MP4 (what the platforms expect) and automatic bitrate, so Quality decides.
 */
export function applyExportPreset(id, {board, states} = {}) {
  const entry = PRESETS.get(id);
  if (!entry) throw new TypeError(`Unknown export preset: ${id}`);
  const format = presetFormat(entry, states);
  const patch = {format, ...presetSizeFields(entry, board)};
  if (entry.quality) Object.assign(patch, {videoQuality: entry.quality, bitrateMode: 'auto'});
  if (format === 'mp4') patch.codecs = {mp4: 'h264'};
  return patch;
}

const HELD = ['format', 'sizePreset', 'width', 'height', 'videoQuality', 'bitrateMode'];
/**
 * Whether `request` still is what choosing the preset gave (`applied`): an
 * edit to any field the preset chose leaves it (the preset shows unchosen);
 * the name, the range, sound and the other settings do not. A codec the
 * capability check replaced (H.264 unavailable) leaves it too.
 */
export function exportPresetHeld(id, applied, request) {
  const entry = PRESETS.get(id);
  if (!entry || !applied || !request) return false;
  if (!HELD.every(key => Object.is(applied[key], request[key]))) return false;
  return request.format !== 'mp4' || request.codecs?.mp4 === 'h264' || !request.codecs?.mp4;
}

/**
 * Whether the canvas's shape is one the platform shows full screen, with a
 * sentence for the dialog: what the export will be, or why it will show with
 * bars and where the canvas size is changed.
 */
export function exportPresetFit(id, board, request) {
  const entry = PRESETS.get(id);
  if (!entry) return {fits: true, message: ''};
  const shape = artboardShape(board), fits = entry.shapes.includes(shape);
  if (!fits) return {fits, message: `${entry.label} shows ${entry.wants} video full screen. This canvas is ${shape}, so the video will play with bars. To fill the screen, change Canvas size in the scene's properties.`};
  const size = Number.isFinite(request?.width) && Number.isFinite(request?.height) ? `${request.width} × ${request.height}` : '';
  return {fits, message: size ? `${entry.ready}: ${size}.` : `${entry.ready}.`};
}
