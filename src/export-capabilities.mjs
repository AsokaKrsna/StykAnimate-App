/** Export choices describe actual encoders; container extensions are never aliases. */
import {videoQualityOptions} from './export-video-quality.mjs';
import {EXPORT_MAX_PIXELS} from './export-sampling.mjs';
import {avcCodedSize} from './video-export.mjs';
import {avcCodecStrings} from './mp4-muxer.mjs';
const descriptions = [
  {id: 'webm', label: 'WebM video', extension: 'webm', mimeType: 'video/webm', kind: 'video', quality: 'bitrate'},
  {id: 'mp4', label: 'MP4 video', extension: 'mp4', mimeType: 'video/mp4', kind: 'video', quality: 'video'},
  {id: 'avi', label: 'AVI video', extension: 'avi', mimeType: 'video/x-msvideo', kind: 'video', quality: 'video'},
  {id: 'wmv', label: 'Windows Media video', extension: 'wmv', mimeType: 'video/x-ms-wmv', kind: 'video', quality: 'video'},
  {id: 'gif', label: 'Animated GIF', extension: 'gif', mimeType: 'image/gif', kind: 'animation', quality: null},
  {id: 'apng', label: 'Animated PNG', extension: 'png', mimeType: 'image/apng', kind: 'animation', quality: null},
  {id: 'png-sequence', label: 'PNG sequence', extension: 'zip', mimeType: 'application/zip', kind: 'sequence', quality: null},
  {id: 'jpeg-sequence', label: 'JPEG sequence', extension: 'zip', mimeType: 'application/zip', kind: 'sequence', quality: 'jpeg'},
  {id: 'gif-sequence', label: 'GIF sequence', extension: 'zip', mimeType: 'application/zip', kind: 'sequence', quality: null},
  {id: 'svg-sequence', label: 'SVG sequence', extension: 'zip', mimeType: 'application/zip', kind: 'sequence', quality: null},
];

async function portableVideo(environment, {width, height, fps}) {
  if (!environment.VideoEncoder || !environment.VideoFrame) return {supported: false, reason: 'WebCodecs video encoding is unavailable in this browser.'};
  for (const codec of ['vp8', 'vp09.00.51.08']) {
    try {
      const response = await environment.VideoEncoder.isConfigSupported({codec, width, height, framerate: fps,
        bitrate: videoQualityOptions({width, height, fps, provider: 'WebCodecs'}).bitrate,
        latencyMode: 'quality', hardwareAcceleration: 'prefer-software', alpha: 'discard'});
      if (response.supported) return {supported: true, codec: codec === 'vp8' ? 'VP8' : 'VP9', provider: 'WebCodecs'};
    } catch { /* Try the next supported WebM encoder. */ }
  }
  return {supported: false, reason: 'No WebM encoder supports these export dimensions and frame rate.'};
}

/** H.264 in an MP4 from WebCodecs, the browser's MP4 (the desktop encodes MP4 with FFmpeg). */
async function portableMp4(environment, {width, height, fps}) {
  if (!environment.VideoEncoder || !environment.VideoFrame) return {supported: false, reason: 'WebCodecs video encoding is unavailable in this browser.'};
  const coded = avcCodedSize(width, height);
  for (const codec of avcCodecStrings(coded.width, coded.height, fps)) {
    try {
      const response = await environment.VideoEncoder.isConfigSupported({codec, ...coded, framerate: fps,
        bitrate: videoQualityOptions({width, height, fps, provider: 'WebCodecs'}).bitrate, latencyMode: 'quality', avc: {format: 'avc'}});
      if (response.supported) return {supported: true, codec: 'H.264', provider: 'WebCodecs', encodedWidth: coded.width, encodedHeight: coded.height,
        codecs: [{id: 'h264', label: 'H.264', supported: true}], defaultCodec: 'h264'};
    } catch { /* Try the next H.264 profile before reporting unavailable support. */ }
  }
  return {supported: false, reason: 'This browser cannot encode H.264 at these dimensions and frame rate. The desktop app exports MP4, or choose WebM.'};
}

/** Query again after changing export dimensions/rate. Unsupported choices retain a reason for the UI. */
export async function getExportCapabilities({width = 640, height = 480, fps = 24,
  environment = globalThis, desktop = environment.stykDesktop} = {}) {
  const valid = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 16384 && height <= 16384 && Number.isFinite(fps) && fps >= 1 && fps <= 1000;
  if (!valid) throw new Error('Choose valid export dimensions and a frame rate between 1 and 1,000 fps.');
  const desktopEncoder = typeof desktop?.getVideoCapabilities === 'function';
  const [webm, mp4, native] = await Promise.all([
    portableVideo(environment, {width, height, fps}),
    desktopEncoder ? null : portableMp4(environment, {width, height, fps}),
    desktopEncoder
      ? desktop.getVideoCapabilities({width, height, fps}).catch(error => ({formats: [], reason: error?.message || 'The native encoder could not be queried.'}))
      : Promise.resolve({formats: [], reason: 'Available in the desktop app with its native video encoder.'}),
  ]);
  const worker = Boolean(environment.Worker), raster = worker && Boolean(environment.OffscreenCanvas && environment.createImageBitmap);
  const formats = descriptions.map(description => {
    let availability;
    if (description.id === 'webm' && !native.formats?.some(format=>format.id==='webm'&&format.supported)) availability = {...webm,alpha:false,notice:webm.supported?'Browser WebM exports do not preserve transparency.':undefined};
    else if (description.id === 'mp4' && mp4) availability = {...mp4, alpha: false, matte: 'black'};
    else if (description.kind === 'video') {
      const capability = native.formats?.find(format => format.id === description.id);
      availability = capability ? {supported: Boolean(capability.supported), reason: capability.reason, codec: capability.codec, provider: 'FFmpeg',
        encodedWidth: capability.encodedWidth, encodedHeight: capability.encodedHeight, notice: capability.notice, alpha:Boolean(capability.alpha), matte:capability.matte,
        defaultCodec: capability.defaultCodec, codecs: capability.codecs?.map(codec => ({...codec}))}
        : {supported: false, reason: native.reason || 'This native video encoder is unavailable.'};
      if (availability.supported && !raster) availability = {...availability, supported: false, reason: 'Native video export requires worker canvas support.'};
      if (availability.supported && width * height > EXPORT_MAX_PIXELS) availability = {...availability, supported: false, reason: `Native video is limited to ${Math.round(EXPORT_MAX_PIXELS / 1e6)} million pixels per frame.`};
    } else if (description.id === 'svg-sequence') availability = {supported: worker, reason: worker ? undefined : 'SVG sequence export requires worker support.'};
    else if (!raster) availability = {supported: false, reason: 'Image export requires a browser with worker canvas encoding.'};
    else if (width * height > EXPORT_MAX_PIXELS) availability = {supported: false, reason: `Raster image exports are limited to ${Math.round(EXPORT_MAX_PIXELS / 1e6)} million pixels per frame.`};
    else if (description.id === 'gif' && fps > 50) availability = {supported: false, reason: 'Animated GIF supports 1–50 fps. Choose APNG or video for this frame rate.'};
    else availability = {supported: true, provider: 'Portable worker'};
    return {...description, ...availability};
  });
  return {formats, width, height, fps, nativeVersion: native.version ?? null};
}

export function exportFormat(id) { const entry = descriptions.find(format => format.id === id); return entry ? {...entry} : null; }
