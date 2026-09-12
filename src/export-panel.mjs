import {exportMemoryPlan} from './export-memory.mjs';
import {EXPORT_MAX_PIXELS} from './export-sampling.mjs';
import {exportTime} from './export-progress.mjs';
import {VIDEO_QUALITY_PRESETS, videoQualityOptions} from './export-video-quality.mjs';

const categories = [
  ['video', 'Video', ['export-mp4', 'export-video', 'export-avi', 'export-wmv', 'export-vfw']],
  ['animated', 'Animated image', ['export-gif', 'export-apng']],
  ['frames', 'Frames & sequences', ['export-png', 'export-svg', 'export-png-sequence', 'export-jpeg-sequence', 'export-gif-sequence', 'export-svg-sequence']],
  ['editable', 'Editable file', ['export-stkz', 'export-piv', 'export-stk']],
];

/** Rearrange the existing command controls; capability and export logic remain
 * with their owners. No duplicate settings or independent export state. */
export function mountExportFlow(content, {width, height, totalFrames, currentFrame, fps, audioClips = [], audioSupported = false}) {
  const grid = content.querySelector('.export-grid'), settings = content.querySelector('.export-settings');
  if (!grid || !settings) return;
  const dialog = content.closest('dialog'), buttons = [...grid.querySelectorAll('[data-action]')];
  dialog.classList.add('studio-export-dialog');
  const input = id => content.querySelector(`#export-${id}`);
  const number = id => Number(input(id).value);
  for (const id of ['width', 'height', 'start', 'end', 'quality']) input(id).required = true;
  const header = document.createElement('div'); header.className = 'export-flow';
  header.innerHTML = `<div class="export-category" role="group" aria-label="Output type">${categories.map(([id, label]) => `<button type="button" data-category="${id}">${label}</button>`).join('')}</div>
    <div class="export-format-row"><label>File format<select id="output-format" aria-label="Export format"></select></label></div>`;
  settings.before(header); settings.open = true; grid.hidden = true;
  const section = (title, ids, extra = '') => {
    const element = document.createElement('section'); element.className = 'export-section';
    const heading = document.createElement('h3'); heading.textContent = title; element.append(heading);
    if (extra) element.insertAdjacentHTML('beforeend', extra);
    const row = document.createElement('div'); row.className = 'text-options';
    for (const id of ids) {const label = input(id)?.closest('label'); if (label) row.append(label);}
    element.append(row); settings.append(element); return element;
  };
  section('Output size', ['width', 'height', 'aspect'], `<label class="export-preset-label">Resolution<select id="export-resolution" aria-label="Resolution preset"><option value="original">Original · ${width} × ${height}</option><option value="720">HD · 720p</option><option value="1080">Full HD · 1080p</option><option value="2160">4K · 2160p</option><option value="custom">Custom size</option></select></label>`);
  const range = section('Frames', ['start', 'end'], '<button class="export-text-button" type="button" id="export-all-frames">Use entire animation</button>');
  const encoding = section('Quality', ['smoothing', 'quality', 'gif-dither']);
  const audio = document.createElement('section'); audio.className = 'export-section';
  audio.innerHTML = '<h3>Audio</h3><label class="check-row"><input type="checkbox" id="export-audio" checked>Include audio</label><p class="property-note">Mixes audible tracks, volume and fades. Sound requires a desktop FFmpeg video format. GIF, image and Pivot exports are silent.</p>';
  settings.append(audio);
  encoding.querySelector('.text-options').insertAdjacentHTML('afterbegin', `<label>Video quality<select id="export-video-quality">${VIDEO_QUALITY_PRESETS.map(option => `<option value="${option.value}">${option.label}</option>`).join('')}</select></label>`);
  const advanced = document.createElement('details'); advanced.className = 'export-advanced';
  advanced.innerHTML = `<summary>Advanced video settings</summary><div class="text-options">
    <label>Bitrate<select id="export-bitrate-mode"><option value="auto">Automatic (recommended)</option><option value="manual">Set manually</option></select></label>
    <label>Target bitrate · Mbit/s<input id="export-video-bitrate" type="number" min="0.1" max="200" step="any" value="8" required></label>
  </div>`;
  for (const id of ['mp4-codec', 'avi-codec']) advanced.querySelector('.text-options').append(input(id).closest('label'));
  settings.append(advanced);
  for (const row of settings.querySelectorAll(':scope > .text-options')) row.remove();
  const vfw = settings.querySelector('.vfw-export-controls'); if (vfw) settings.append(vfw);
  const footer = document.createElement('div'); footer.className = 'export-bottom';
  footer.innerHTML = `<div class="export-summary"><strong id="export-summary-size"></strong><span id="export-summary-time"></span></div>
    <p id="export-validation" role="status" aria-live="polite" hidden></p>
    <div class="export-flow-footer"><button type="button" class="button primary" id="export-submit">Export file</button></div>`;
  grid.after(footer);
  const select = header.querySelector('select'), submit = input('submit');
  let category = 'video';
  const chosen = () => buttons.find(button => button.dataset.action === select.value);
  function updateSettings() {
    const button = chosen(), action = select.value, editable = category === 'editable';
    const single = ['export-png', 'export-svg'].includes(action), vector = action.includes('svg');
    const video = category === 'video' && action !== 'export-vfw';
    audio.hidden = category !== 'video' || !audioClips.length;
    const lossless = action === 'export-avi' && ['ffv1', 'rawvideo'].includes(input('avi-codec').value);
    const manual = video && !lossless && input('bitrate-mode').value === 'manual';
    settings.hidden = editable;
    const visibility = {start: !single, end: !single, quality: action === 'export-jpeg-sequence',
      'gif-dither': ['export-gif', 'export-gif-sequence'].includes(action),
      'video-quality': video && !lossless && !manual, 'bitrate-mode': video && !lossless, 'video-bitrate': manual,
      'mp4-codec': action === 'export-mp4', 'avi-codec': action === 'export-avi', smoothing: !vector};
    for (const [id, visible] of Object.entries(visibility)) if (input(id)) input(id).closest('label').hidden = !visible;
    range.hidden = single; encoding.hidden = vector;
    advanced.hidden = !video;
    if (vfw) vfw.hidden = action !== 'export-vfw';
    const w = number('width'), h = number('height'), first = number('start'), last = number('end');
    const count = single ? 1 : last - first + 1;
    let error = '';
    for (const control of settings.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
    const invalid = (ids, message) => {for (const id of ids) input(id)?.setAttribute('aria-invalid', 'true'); error ||= message;};
    if (category === 'video' && input('audio').checked && audioClips.some(clip => clip.start < last / fps && clip.start + clip.duration > (first - 1) / fps) &&
      (!audioSupported || button?.dataset.provider !== 'FFmpeg' || action === 'export-vfw'))
      error = 'Choose a desktop FFmpeg video format to include sound, or turn off Include audio for a silent export.';
    if (!editable) {
      if (![w, h].every(n => Number.isInteger(n) && n >= 1 && n <= 16384) || w * h > EXPORT_MAX_PIXELS)
        invalid(['width', 'height'], `Enter whole-pixel dimensions, up to ${Math.round(EXPORT_MAX_PIXELS / 1e6)} million pixels per frame.`);
      if (!single && (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > totalFrames))
        invalid(['start', 'end'], `Choose a frame range from 1 to ${totalFrames}. The last frame must be at or after the first.`);
      if (!error && !vector) {
        try {exportMemoryPlan(w, h, input('smoothing').value);}
        catch (failure) {invalid(['width', 'height'], failure.message);}
      }
      for (const id of ['quality', 'video-bitrate']) {
        const control = input(id);
        if (!control.closest('label').hidden && !control.validity.valid) invalid([id], `Enter a value between ${control.min} and ${control.max}.`);
      }
      if (video) {
        try {videoQualityOptions({width: w, height: h, fps, preset: input('video-quality').value,
          provider: button?.dataset.provider || 'FFmpeg', mode: manual ? 'manual' : 'auto', manualMbps: input('video-bitrate').value, lossless});}
        catch (failure) {invalid(['video-bitrate'], failure.message);}
      }
      if (action === 'export-gif' && fps > 50) error ||= 'GIF supports up to 50 fps. Choose Animated PNG or Video for this animation.';
      const maxFrames = action.endsWith('sequence') ? 65534 : category === 'animated' ? 100000 : 1000000;
      if (!single && count > maxFrames) invalid(['start', 'end'], `This format supports up to ${maxFrames.toLocaleString()} frames. Choose a shorter range.`);
    }
    const notice = error || button?.title || '';
    input('validation').textContent = notice; input('validation').hidden = !notice;
    input('validation').dataset.error = String(Boolean(error || button?.disabled));
    submit.disabled = !button || button.disabled || Boolean(error);
    submit.textContent = editable ? 'Export editable file' : single ? 'Export frame' : 'Export animation';
    footer.querySelector('.export-summary').hidden = editable;
    input('summary-size').textContent = editable ? '' : `${Number.isFinite(w) ? w.toLocaleString() : '—'} × ${Number.isFinite(h) ? h.toLocaleString() : '—'} px`;
    input('summary-time').textContent = editable ? '' : single ? `Current frame · ${currentFrame}`
      : `${Number.isInteger(count) && count > 0 ? count.toLocaleString() : '—'} frames · ${count > 0 && count / fps < 10 ? `${Number((count / fps).toFixed(2))}s` : exportTime(count > 0 ? count / fps : NaN)} at ${Number(fps.toFixed(2))} fps`;
  }
  function renderFormats() {
    const old = select.value, actions = categories.find(([id]) => id === category)[2]; select.replaceChildren();
    for (const action of actions) {
      const button = buttons.find(button => button.dataset.action === action); if (!button || button.hidden) continue;
      const option = document.createElement('option'); option.value = action;
      option.textContent = `${button.querySelector('strong')?.textContent || action}${button.disabled ? ' · Unavailable' : ''}`;
      option.disabled = button.disabled; select.append(option);
    }
    const options = [...select.options];
    // Keep the chosen format even while its action is momentarily disabled
    // (capability refresh, codec configuration); an unavailable choice already
    // disables Export instead of silently switching formats.
    select.value = options.find(option => option.value === old)?.value || options.find(option => !option.disabled)?.value || options[0]?.value || '';
    header.querySelectorAll('[data-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
    updateSettings();
  }
  header.addEventListener('click', event => {const button = event.target.closest('[data-category]'); if (button) {category = button.dataset.category; renderFormats();}});
  select.addEventListener('change', updateSettings);
  input('resolution').addEventListener('change', () => {
    const preset = input('resolution').value; if (preset === 'custom') return;
    // HD presets preserve the document shape and orientation, including portrait.
    const shortSide = preset === 'original' ? Math.min(width, height) : Number(preset);
    const scale = shortSide / Math.min(width, height);
    input('width').value = Math.round(width * scale); input('height').value = Math.round(height * scale);
    input('width').dispatchEvent(new Event('input', {bubbles: true}));
    input('resolution').value = preset;
  });
  input('all-frames').onclick = () => {input('start').value = 1; input('end').value = totalFrames; updateSettings();};
  settings.addEventListener('input', event => {
    if (['export-width', 'export-height'].includes(event.target.id)) input('resolution').value = 'custom';
    updateSettings();
  });
  settings.addEventListener('change', updateSettings);
  submit.addEventListener('click', () => {updateSettings(); if (!submit.disabled) chosen()?.click();});
  const observer = new MutationObserver(renderFormats);
  observer.observe(grid, {subtree: true, attributes: true, attributeFilter: ['disabled', 'title', 'hidden'], childList: true, characterData: true});
  // showDialog can replace this panel without closing the shared dialog first.
  const lifetime = new MutationObserver(() => {if (!grid.isConnected) dispose();});
  lifetime.observe(content, {childList: true});
  function dispose() {observer.disconnect(); lifetime.disconnect(); dialog.removeEventListener('close', dispose); dialog.classList.remove('studio-export-dialog');}
  dialog.addEventListener('close', dispose, {once: true});
  renderFormats();
}
