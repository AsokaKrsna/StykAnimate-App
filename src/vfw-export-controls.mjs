import {getVfwCapabilities, configureVfwCodec} from './vfw-video-export.mjs';
import {EXPORT_MAX_PIXELS} from './export-sampling.mjs';
import {icon} from './icons.mjs';

/* The export dialog's Encoding rows for Windows AVI (installed codecs): Codec
 * with Configure…, Quality, Keyframes and Rate, in the dialog kit's rows
 * (features/export.css). Shown only in the Windows app. */
const markup = `<div class="ui-dialog-row"><label class="ui-row-label" for="export-vfw-codec">Codec</label><span class="export-inline"><span class="ui-select"><select id="export-vfw-codec" aria-label="Installed Windows AVI codec" disabled><option>Checking installed codecs…</option></select>${icon('chevron-down')}</span><button id="export-vfw-configure" class="ui-button" data-variant="outline" data-size="sm" type="button" aria-haspopup="dialog" disabled>Configure…</button></span></div>
<div class="ui-dialog-row"><label class="ui-row-label" for="export-vfw-quality">Quality</label><span class="ui-field"><input class="ui-field-input" id="export-vfw-quality" type="number" min="0" max="100" step="1" value="90" disabled><span class="ui-field-unit">%</span></span></div>
<div class="ui-dialog-row"><label class="ui-row-label" for="export-vfw-keyframes">Keyframes</label><span class="ui-field" title="0 uses the codec default"><span class="ui-field-label">Every</span><input class="ui-field-input" id="export-vfw-keyframes" type="number" min="0" max="1000000" step="1" value="0" disabled><span class="ui-field-unit">frames</span></span></div>
<div class="ui-dialog-row"><label class="ui-row-label" for="export-vfw-bitrate">Rate</label><span class="ui-field" title="0 uses the codec default"><input class="ui-field-input" id="export-vfw-bitrate" type="number" min="0" max="200" step="0.1" value="0" disabled><span class="ui-field-unit">Mbit/s</span></span></div>
<p class="export-note vfw-status" role="status"><span class="vfw-status-text"></span> <span class="vfw-config-state"></span></p>`;
const numeric = (element, min, max, label, whole = false) => {
  if (!element.value.trim()) throw new Error(`Enter ${label.toLowerCase()}.`);
  const value = Number(element.value); if (!Number.isFinite(value) || value < min || value > max || (whole && !Number.isInteger(value))) throw new Error(`${label} must be ${whole ? 'a whole number ' : ''}from ${min} to ${max}.`); return value;
};

/**
 * Dialog-local controls. No observers, polling, or listeners survive dispose.
 * `listed` says whether installed codecs exist here (the Windows app);
 * `ready` whether the chosen codec was checked for the current size and no
 * codec settings dialog is open, with `reason` saying why not. `onChange`
 * runs whenever those change. A `button` (optional) mirrors them the way
 * today's export tile did: hidden when not listed, disabled when not ready or
 * when `canExport()` is false.
 */
export class VfwExportControls {
  constructor({container, button = null, dialog, getDimensions, canExport = () => true, onError = () => {}, onChange = () => {}}) {
    this.container = container; this.button = button; this.dialog = dialog; this.getDimensions = getDimensions; this.canExport = canExport; this.onError = onError; this.onChangeCallback = onChange;
    this.generation = 0; this.disposed = false; this.configurations = new Map(); this.codecs = []; this.loadedKey = null;
    this.ready = false; this.reason = '';
    this.element = document.createElement('div'); this.element.className = 'vfw-export-controls'; container.append(this.element);
    this.listed = Boolean(globalThis.stykDesktop?.getVfwCapabilities); this.element.hidden = !this.listed;
    if (this.button) this.button.hidden = !this.listed;
    if (!this.listed) return;
    this.element.innerHTML = markup;
    this.select = this.element.querySelector('#export-vfw-codec'); this.quality = this.element.querySelector('#export-vfw-quality'); this.keyframes = this.element.querySelector('#export-vfw-keyframes'); this.bitrate = this.element.querySelector('#export-vfw-bitrate'); this.configureButton = this.element.querySelector('#export-vfw-configure'); this.status = this.element.querySelector('.vfw-status-text'); this.configStatus = this.element.querySelector('.vfw-config-state');
    this.onChange = () => this._selection(); this.onConfigure = () => this.configure().catch(error => { if (!this.disposed) this.onError(error); });
    this.onInput = () => this.sizeChanged();
    this.onClose = () => { if (!dialog.open || !this.element.isConnected) this.dispose(); };
    this.select.addEventListener('change', this.onChange); this.configureButton.addEventListener('click', this.onConfigure); dialog.addEventListener('input', this.onInput); dialog.addEventListener('close', this.onClose);
    this.refresh();
  }
  /** The export size may have changed (typed, or a size preset): check the codecs again once it settles. */
  sizeChanged() {
    if (this.disposed || !this.listed) return;
    const key = this._currentKey(); clearTimeout(this.timer);
    if (key === this.requestedKey) { this._selection(); return; }
    this._setReady(false, 'Checking installed Windows codecs…'); this.configureButton.disabled = true; this.timer = setTimeout(() => this.refresh(), 150);
  }
  _setReady(ready, reason = this.reason) {
    this.ready = ready; this.reason = ready ? '' : reason;
    if (this.button) this.button.disabled = !ready || !this.canExport();
    this.onChangeCallback();
  }
  _setStatus(text) { this.status.textContent = text; this.reason = text; }
  _size() {
    const size = this.getDimensions();
    if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1 || size.width > 16384 || size.height > 16384 || size.width * size.height > EXPORT_MAX_PIXELS) throw new Error(`Choose valid video dimensions up to ${Math.round(EXPORT_MAX_PIXELS / 1e6)} million pixels.`);
    return {width: size.width, height: size.height};
  }
  _currentKey() { try { const size = this._size(); return `${size.width}:${size.height}`; } catch { return null; } }
  _configurationKey() { return `${this.select?.value}|${this.loadedKey}`; }
  async refresh() {
    if (this.disposed || this.element.hidden) return;
    clearTimeout(this.timer); const generation = ++this.generation; let size;
    this.select.disabled = true; this.configureButton.disabled = true; this._setStatus('Checking installed Windows codecs…'); this._setReady(false);
    try {
      size = this._size(); this.requestedKey = `${size.width}:${size.height}`;
      const key = this.requestedKey, previous = this.select.value, result = await getVfwCapabilities(size);
      if (this.disposed || generation !== this.generation || this._currentKey() !== key) return;
      if (result.platform && result.platform !== 'win32') { this.element.hidden = true; this.listed = false; if (this.button) this.button.hidden = true; this._setReady(false, 'Installed Windows codecs are unavailable in this app.'); return; }
      this.loadedKey = key; this.codecs = result.codecs ?? []; this.select.replaceChildren();
      for (const codec of this.codecs) { const option = document.createElement('option'); option.value = codec.id; option.textContent = codec.label; option.disabled = !codec.supported; option.title = codec.reason || `${codec.fourcc} · ${codec.provider}`; this.select.append(option); }
      const selected = this.codecs.find(codec => codec.id === previous && codec.supported) ?? this.codecs.find(codec => codec.supported && codec.kind === 'installed') ?? this.codecs.find(codec => codec.supported);
      if (!selected) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No compatible codec'; this.select.append(option); this.select.value = ''; this._setStatus(result.reason || 'No installed codec accepts this canvas size.'); this._setReady(false); return; }
      this.select.value = selected.id; this.select.disabled = false; this._selection();
    } catch (error) { if (!this.disposed && generation === this.generation) { this.loadedKey = null; this._setStatus(error.message); this._setReady(false); } }
  }
  _selection() {
    if (this.disposed) return; const codec = this.codecs.find(codec => codec.id === this.select.value), ready = Boolean(codec?.supported && this.loadedKey === this._currentKey());
    this.configureButton.disabled = !ready || !codec?.configure || this.configuring;
    this.quality.disabled = !ready || !codec?.quality; this.keyframes.disabled = !ready || !codec?.keyframes; this.bitrate.disabled = !ready || !codec?.dataRate;
    this.configStatus.textContent = this.configurations.has(this._configurationKey()) ? 'Custom codec settings' : '';
    if (ready) this._setStatus(`${codec.fourcc} · ${codec.arch === 'x86' ? '32-bit' : '64-bit'} ${codec.kind === 'uncompressed' ? 'native uncompressed AVI' : 'installed Windows codec'}. ${this.loadedKey.replace(':', ' × ')} px. Transparent areas become black.`);
    const reason = this.configuring ? 'Codec settings are open…' : codec?.reason || 'Wait for the installed codec check or choose a compatible codec.';
    this._setReady(ready && !this.configuring, reason);
  }
  /** The chosen codec's label ("Cinepak"), for the Encoding summary; '' before the check. */
  get codecLabel() { return this.codecs.find(codec => codec.id === this.select?.value)?.label ?? ''; }
  /** The typed values, as an ExportRequest's `vfw` (export-request.mjs). */
  fields() {
    if (!this.listed || this.disposed) return null;
    return {codecId: this.select.value, quality: this.quality.value, keyframes: this.keyframes.value, bitrateMbps: this.bitrate.value, configurationId: this.configurations.get(this._configurationKey())};
  }
  getOptions() {
    if (this.disposed || this.element.hidden) throw new Error('Installed Windows codecs are unavailable in this app.');
    const codec = this.codecs.find(codec => codec.id === this.select.value);
    if (!codec?.supported || this.loadedKey !== this._currentKey() || this.configuring) throw new Error('Wait for the installed codec check or choose a compatible codec.');
    return {codecId: codec.id, quality: codec.quality ? numeric(this.quality, 0, 100, 'Quality') / 100 : .9,
      keyframeEvery: codec.keyframes ? numeric(this.keyframes, 0, 1000000, 'Keyframe interval', true) : 0,
      bitrate: codec.dataRate ? Math.round(numeric(this.bitrate, 0, 200, 'Bitrate') * 1000000) : 0,
      configurationId: this.configurations.get(this._configurationKey())};
  }
  /**
   * What an ExportRequest's Windows AVI export needs (export-request.mjs
   * vfwEncodeOptions, which derives exactly what getOptions returns): whether
   * installed codecs are available here, the chosen codec's capability,
   * whether it is ready (checked for the current size, no codec settings
   * dialog open) and the settings chosen with Configure codec… for this size.
   */
  requestContext() {
    if (this.disposed || this.element.hidden) return {available: false};
    return {available: true, codec: this.codecs.find(codec => codec.id === this.select.value) ?? null,
      ready: this.loadedKey === this._currentKey() && !this.configuring, configurationId: this.configurations.get(this._configurationKey())};
  }
  async configure() {
    const options = this.getOptions(), size = this._size(), key = this._configurationKey(), codec = this.codecs.find(codec => codec.id === options.codecId);
    if (!codec?.configure) return;
    this.configuring = true; this._selection(); this.configStatus.textContent = 'Codec settings are open…';
    try {
      const result = await configureVfwCodec({codecId: options.codecId, ...size, configurationId: options.configurationId});
      if (!this.disposed && result?.configurationId) this.configurations.set(key, result.configurationId);
    } finally { this.configuring = false; if (!this.disposed) this._selection(); }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.generation++; clearTimeout(this.timer);
    this.select?.removeEventListener('change', this.onChange); this.configureButton?.removeEventListener('click', this.onConfigure); this.dialog.removeEventListener('input', this.onInput); this.dialog.removeEventListener('close', this.onClose); this.configurations.clear();
  }
}
