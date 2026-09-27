import {audioState, audioFps, audioEnd} from './audio-model.mjs';
import {icon} from './icons.mjs';
import {showTimelineMenu} from './timeline-menu.mjs';
import {onFontsReady} from './ui/font-loading.mjs';
const ROW = 64, RULER = 22, DROP = 38, TOOLBAR = 36;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const afterTime = (times, time) => { let low = 0, high = times.length; while (low < high) { const mid = (low + high) >>> 1; if (times[mid] <= time) low = mid + 1; else high = mid; } return low; };
const el = (tag, parent, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; parent?.append(node); return node; };

/** Shared audio lanes aligned to each timeline's actual time-to-pixel mapping. */
export class AudioTimeline {
  constructor(container, editor, {host, engine, mode = 'advanced', onError, onSeek, onScrubStart, onScrub, onScrubEnd, onTogglePlay, onHistory, beforeCommand, onCancel} = {}) {
    Object.assign(this, {editor, host, engine, mode, onError, onSeek, onScrubStart, onScrub, onScrubEnd, onTogglePlay, onHistory, beforeCommand, onCancel});
    this.events = new AbortController(); this.nodes = new Map(); this.labels = new Map();
    this.integrated = mode === 'advanced'; this.open = Boolean(editor.audioPanelOpen);
    Object.assign(this, editor.audioSelection ?? {});
    this.container = container; container.classList.add('has-audio-timeline');
    this.root = el('section', this.integrated ? host.main : container, `audio-timeline ${this.integrated ? 'audio-integrated' : 'audio-tab'}`);
    this.root.id = 'timeline-audio-panel'; this.root.hidden = !this.open; this.root.setAttribute('aria-label', 'Audio timeline');
    this.launcher = document.getElementById('timeline-audio');
    if (this.launcher) this.on(this.launcher, 'click', () => this.setOpen(!this.open, {focus:true}));
    this.toolbar = el('div', this.root, 'audio-toolbar');
    el('span', this.toolbar, 'audio-heading-icon').innerHTML = icon('music');
    this.title = el('strong', this.toolbar, '', 'Audio');
    this.importButton = this.button(this.toolbar, 'Import audio', () => this.file.click(), 'plus'); el('span', this.importButton, '', 'Import audio');
    this.cancelImportButton=this.button(this.toolbar,'Cancel audio import',()=>this.importController?.abort(),'close');this.cancelImportButton.hidden=true;
    el('span', this.cancelImportButton, '', 'Cancel');
    this.newTrackButton = this.button(this.toolbar, 'New audio track', () => this.addTrack(), 'plus'); el('span', this.newTrackButton, '', 'Add track');
    this.extendButton = this.button(this.toolbar, 'Extend animation to audio', () => this.extend(), 'chevron-right');
    el('span',this.extendButton,'','Fit animation');
    this.hint = el('span', this.toolbar, 'audio-hint', 'Drop music, dialogue or sound effects');
    // Behaviour switches are explained in an Options popover instead of two
    // bare checkboxes ("Scrub sound", "Ripple") in the toolbar.
    this.optionsButton = this.button(this.toolbar, 'Audio options', () => { if (this.options.matches(':popover-open')) this.options.hidePopover(); else { this.options.showPopover(); this.positionPopover(this.options, this.optionsButton); } }, 'settings');
    this.optionsButton.viewAction = true; el('span', this.optionsButton, '', 'Options'); this.optionsButton.setAttribute('aria-haspopup', 'dialog'); this.optionsButton.classList.add('audio-options-button');
    this.options = el('div', this.root, 'audio-options'); this.options.setAttribute('popover', 'auto'); this.options.setAttribute('role', 'dialog'); this.options.setAttribute('aria-label', 'Audio options');
    const option = (label, hint, name) => { const row = el('label', this.options, 'ds-switch'), input = el('input', row), text = el('span', row, '', label); input.type = 'checkbox'; input.setAttribute('aria-label', name); el('small', text, '', hint); return input; };
    this.scrub = option('Hear audio while scrubbing', 'Play short snippets as you drag the playhead.', 'Hear audio while scrubbing');
    this.scrub.checked = Boolean(editor.audioScrub); this.on(this.scrub, 'change', () => { editor.audioScrub = this.scrub.checked; });
    this.ripple = option('Keep audio in sync with frame edits', 'When frames are inserted or removed on every layer, audio after that point moves (or splits) with them.', 'Ripple audio with scene frames');
    this.ripple.checked = Boolean(editor.audioRipple); this.on(this.ripple, 'change', () => { editor.audioRipple = this.ripple.checked; });
    this.on(this.options, 'toggle', () => this.optionsButton.setAttribute('aria-expanded', String(this.options.matches(':popover-open'))));
    this.on(this.options, 'keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); this.options.hidePopover(); this.optionsButton.focus(); } });
    this.closeButton = this.button(this.toolbar, 'Close audio', () => this.setOpen(false, {focus:true}), 'close');
    this.closeButton.viewAction = true;
    this.file = el('input', this.root); this.file.type = 'file'; this.file.accept = '.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.aif,.aiff,audio/*'; this.file.hidden = true; this.file.setAttribute('aria-label', 'Choose audio recording');
    this.on(this.file, 'change', () => { const file = this.file.files[0]; this.file.value = ''; if (file) void this.importFile(file); });
    this.body = el('div', this.root, 'audio-body'); this.body.tabIndex = 0; this.body.setAttribute('role', 'region'); this.body.setAttribute('aria-label', 'Audio clips'); this.scroll = this.body;
    this.ruler = el('div', this.body, 'audio-ruler'); el('span', this.ruler, '', 'TRACK / VOLUME'); this.rulerCanvas = el('canvas', this.ruler);
    this.ruler.hidden = this.integrated;
    this.labelColumn = el('div', this.body, 'audio-labels'); this.lanes = el('div', this.body, 'audio-lanes'); this.canvas = el('canvas', this.lanes);
    this.clipLayer = el('div', this.lanes, 'audio-clips'); this.playhead = el('div', this.lanes, 'audio-playhead');
    this.snapLine = el('div', this.lanes, 'audio-snap-line'); this.snapLine.hidden = true;
    this.dropRow = el('div', this.lanes, 'audio-new-lane', '+ Drop a clip here to create a track');
    this.on(this.dropRow, 'dblclick', () => this.addTrack());
    this.empty = el('div', this.body, 'audio-empty'); el('span', this.empty, 'audio-empty-icon').innerHTML = icon('music');
    const emptyText = el('div', this.empty); el('strong', emptyText, '', 'Add music, dialogue or sound effects'); el('p', emptyText, '', 'Drop an audio file here, or import one. Clips line up with your frames and play with the animation.');
    const emptyActions = el('div', emptyText, 'audio-empty-actions');
    const emptyImport = el('button', emptyActions, 'button primary small', 'Import audio…'); emptyImport.type = 'button'; this.on(emptyImport, 'click', () => this.file.click());
    const emptyTrack = el('button', emptyActions, 'button small', 'Add empty track'); emptyTrack.type = 'button'; this.on(emptyTrack, 'click', () => this._run(() => this.addTrack()));
    if (!this.integrated) {
      this.horizontal = el('div', this.root, 'audio-horizontal'); this.horizontal.tabIndex = 0; this.horizontal.setAttribute('role', 'region'); this.horizontal.setAttribute('aria-label', 'Audio timeline position');
      this.horizontalSpacer = el('div', this.horizontal);
      this.on(this.horizontal, 'scroll', () => { if (this.open && this.horizontal.clientWidth) host.strip.scrollLeft = this.horizontal.scrollLeft; });
      this.on(this.horizontal, 'keydown', event => { event.stopPropagation(); const direction = {ArrowLeft:-1, ArrowRight:1}[event.key]; if (direction || ['Home','End'].includes(event.key)) { event.preventDefault(); host.strip.scrollLeft = direction ? host.strip.scrollLeft + direction * (event.shiftKey ? this.horizontal.clientWidth : 40) : event.key === 'Home' ? 0 : host.strip.scrollWidth; this.update(); } });
    }
    this.footer = el('div', this.root, 'audio-editbar');
    this.selectionInfo = el('div', this.footer, 'audio-selection-info');
    this.selectionName = el('strong', this.selectionInfo); this.selectionTime = el('span', this.selectionInfo);
    this.clipControls = el('div', this.footer, 'audio-clip-controls');
    const volume = el('label', this.clipControls, 'audio-volume', 'Volume'); this.clipVolume = el('input', volume); Object.assign(this.clipVolume, {type:'range', min:'0', max:'400', step:'1'}); this.clipVolume.setAttribute('aria-label', 'Selected clip volume'); this.clipVolumeValue = el('output', volume);
    this.on(this.clipVolume, 'input', () => { this.clipVolumeValue.textContent = `${this.clipVolume.value}%`; });
    this.on(this.clipVolume, 'change', () => this._run(() => this.editor.setAudioClip(this.selected, {gain: Number(this.clipVolume.value) / 100})));
    this.splitButton = this.button(this.clipControls, 'Split audio at playhead (S)', () => { this.selected = editor.splitAudioClip(this.selected); }, 'cut'); el('span', this.splitButton, '', 'Split');
    this.duplicateButton = this.button(this.clipControls, 'Duplicate audio clip', () => { this.selected = editor.duplicateAudioClip(this.selected); }, 'duplicate'); el('span', this.duplicateButton, '', 'Duplicate');
    this.deleteButton = this.button(this.clipControls, 'Delete audio clip', () => { editor.deleteAudioClip(this.selected); this.selected = null; }, 'trash');
    this.propertiesButton = this.button(this.clipControls, 'Audio clip properties', () => this.properties(), 'sliders'); el('span', this.propertiesButton, '', 'Details');
    this.footer.classList.add('audio-clip-popover');this.footer.setAttribute('popover','auto');this.footer.setAttribute('role','dialog');this.footer.setAttribute('aria-label','Audio clip controls');
    this.clipToolsButton=this.button(this.toolbar,'Audio clip controls',()=>{if(this.footer.matches(':popover-open'))this.footer.hidePopover();else{this.footer.showPopover();this.positionClipTools();}},'sliders');this.clipToolsButton.viewAction=true;el('span',this.clipToolsButton,'','Clip');this.clipToolsButton.title='Selected clip: volume, split, duplicate and details';this.optionsButton.before(this.clipToolsButton);this.clipToolsButton.setAttribute('aria-haspopup','dialog');
    this.on(this.footer,'toggle',()=>{this.clipToolsButton.setAttribute('aria-expanded',String(this.footer.matches(':popover-open')));});
    this.on(this.footer,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.footer.hidePopover();this.clipToolsButton.focus();}else this.keydown(event);});
    this.on(window,'resize',()=>{if(this.footer.matches(':popover-open'))this.positionClipTools();});
    this.live = el('div', this.root, 'audio-live'); this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite');
    this.on(this.root, 'keydown', event => this.keydown(event));
    this.on(this.body, 'scroll', () => this.update()); this.on(host.scroll ?? host.strip, 'scroll', () => this.update());
    this.on(this.lanes, 'pointerdown', event => this.down(event)); this.on(this.lanes, 'pointermove', event => this.move(event));
    this.on(this.lanes, 'pointerup', event => this.up(event)); this.on(this.lanes, 'pointercancel', () => this.cancel()); this.on(this.lanes, 'lostpointercapture', () => this.cancel());
    this.on(this.lanes, 'dblclick', event => { if (event.target.closest('[data-clip]')) this.properties(); else if (!event.target.closest('.audio-new-lane')) { this.trackId = this.trackAt(event.clientY)?.id; this.file.click(); } });
    this.on(this.lanes, 'focusin', event => { const node = event.target.closest('[data-clip]'); if (node) { this.selected = node.dataset.clip; this.trackId = this.found().track?.id; this.update(); } });
    this.on(this.lanes, 'contextmenu', event => { const node = event.target.closest('[data-clip]'); if (!node) return; event.preventDefault(); this.selected = node.dataset.clip; this.update(); showTimelineMenu(this,event,[[
      {label:'Audio clip properties',symbol:'sliders',action:()=>this.properties()},
      {label:'Copy audio clip',symbol:'duplicate',action:()=>this.editor.copyAudioClip(this.selected)},
      {label:'Cut audio clip',symbol:'cut',action:()=>{this.editor.cutAudioClip(this.selected);this.selected=null;}},
      this.editor._audioClipboard&&{label:'Paste audio at playhead',symbol:'clipboard',action:()=>{this.selected=this.editor.pasteAudioClip(this.trackId);}},
      {label:'Split at playhead',symbol:'cut',action:()=>{this.selected=this.editor.splitAudioClip(this.selected);}},
      {label:'Duplicate audio clip',symbol:'duplicate',action:()=>{this.selected=this.editor.duplicateAudioClip(this.selected);}},
      {label:'Delete audio clip',symbol:'trash',danger:true,action:()=>{this.editor.deleteAudioClip(this.selected);this.selected=null;}},
    ]]); });
    this.on(this.root, 'dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; this.root.dataset.drop = 'true'; this.fileDropTrack = this.trackAt(event.clientY)?.id ?? 'new'; this.update(); } });
    this.on(this.root, 'dragleave', event => { if (!this.root.contains(event.relatedTarget)) { delete this.root.dataset.drop; this.fileDropTrack = null; this.update(); } });
    this.on(this.root, 'drop', event => {
      event.preventDefault(); delete this.root.dataset.drop; this.fileDropTrack = null; const file = event.dataTransfer.files[0];
      const rect = this.lanes.getBoundingClientRect(), inLanes = event.clientX >= rect.left && event.clientY >= rect.top && event.clientY < rect.bottom;
      if (file) void this.importFile(file, inLanes ? {trackId: this.trackAt(event.clientY)?.id, start: clamp(Math.round(this.xTick(event.clientX - rect.left)) / this.fps, 0, 3600)} : undefined);
    });
    this.on(this.root, 'wheel', event => {
      if (this.integrated && (event.ctrlKey || event.metaKey)) { event.preventDefault(); host.setZoom(host.pxPerTick * (event.deltaY < 0 ? 1.15 : .87)); }
      else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) { event.preventDefault(); (host.scroll ?? host.strip).scrollLeft += event.deltaX || event.deltaY; }
      else if (this.integrated) { event.preventDefault(); host.scroll.scrollTop += event.deltaY; }
    }, {passive: false});
    this.on(editor, 'change', event => { const d = event.detail; if (d.kind === 'document') { this.importController?.abort(); this.selected = null; this.trackId = null; this.closeProperties(); this.setOpen(false); } if (d.kind === 'history' || d.kind === 'document') this.resetVolumes = true; if (d.audio || d.kind === 'document') this.cancel(); if (!this.found().clip) this.selected = null; this.update(d.kind !== 'seek'); });
    this.observer = new ResizeObserver(() => this.update()); this.observer.observe(container); this.observer.observe(this.body);
    this.on(window, 'styk-theme-change', () => this.update()); onFontsReady(() => this.update(), {signal: this.events.signal});
    this.on(window, 'blur', () => this.cancel()); this.update();
  }
  on(target, type, callback, options = {}) { target.addEventListener(type, callback, {...options, signal: target.closest?.('.audio-track,.audio-properties')?.events?.signal ?? this.events.signal}); }
  _run(action) { try { this.onSeek?.(); const wait=this.beforeCommand?.(),result=wait?wait.then(action):action(); if (result?.then) result.then(()=>this.update(),error => {if(error.name!=='AbortError')this.error(error);}); this.update(); return result; } catch (error) { this.error(error); } }
  error(error) { this.live.textContent = error.message; this.onError?.(error); }
  button(parent, title, action, symbol) { const node = el('button', parent, 'audio-button'); node.type = 'button'; node.title = title; node.setAttribute('aria-label', title); node.innerHTML = icon(symbol); this.on(node, 'click', () => node.viewAction ? action() : this._run(action)); return node; }
  get rulerHeight() { return this.integrated ? 0 : RULER; }
  /** Where the integrated lanes may show in the Advanced grid: below its ruler and pinned rows (timeline-rows.mjs). */
  get bodyTop() { return this.host?.bodyTop ?? 32; }
  get bodyHeight() { const count = audioState(this.editor.report).tracks.length; return count ? this.rulerHeight + count * ROW + DROP : 112; }
  get contentHeight() { return this.open ? TOOLBAR + this.bodyHeight : 0; }
  get verticalScroll() { return this.integrated ? this.host.scroll : this.body; }
  setOpen(value, {focus = false} = {}) {
    const wasOpen = this.open; this.open = this.editor.audioPanelOpen = Boolean(value); this.cancel();
    if (!this.open) { this.closeProperties(); this.menuEvents?.abort(); this.menu?.remove(); this.menu = null; }
    this.root.hidden = !this.open;
    if (this.integrated) {
      if (this.open && !wasOpen) { this.returnScroll = this.host.scroll.scrollTop; this.revealGroup = true; }
      this.host._extent();
      if (!this.open && wasOpen) this.host.scroll.scrollTop = this.returnScroll ?? 0;
    }
    this.host.update();
    if (focus) this.focusPending = true;
    this.update();
  }
  clearSelection() { if (this.selected) { this.selected = null; this.update(); } }
  addTrack() {
    this.trackId = this.editor.addAudioTrack(`Audio ${audioState(this.editor.report).tracks.length + 1}`); this.selected = null; this.setOpen(true);
    this.revealTrack(this.trackId); this.update();
  }
  revealTrack(id) {
    const index = audioState(this.editor.report).tracks.findIndex(track => track.id === id);
    if (index < 0) return;
    this.revealId = id; this.update();
  }
  trackAt(y) { return audioState(this.editor.report).tracks[Math.floor((y - this.lanes.getBoundingClientRect().top - this.rulerHeight) / ROW)]; }
  get fps() { return audioFps(this.editor.report); }
  tickX(tick) {
    if (this.mode === 'advanced') return tick * this.host.pxPerTick - this.host._offsetX();
    const times = this.host.times, index = Math.max(0, afterTime(times, tick) - 1), start = times[index] ?? 0, end = times[index + 1] ?? this.editor.totalTicks;
    return (index + (tick - start) / Math.max(1, end - start)) * this.host.cardWidth - this.host.strip.scrollLeft;
  }
  xTick(x) {
    if (this.mode === 'advanced') return (x + this.host._offsetX()) / this.host.pxPerTick;
    const position = (x + this.host.strip.scrollLeft) / this.host.cardWidth, index = clamp(Math.floor(position), 0, this.host.times.length - 1), start = this.host.times[index] ?? 0, end = this.host.times[index + 1] ?? this.editor.totalTicks;
    return start + (position - index) * Math.max(1, end - start);
  }
  positionPopover(panel,anchor){const rect=anchor.getBoundingClientRect();panel.style.left=`${Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,rect.right-panel.offsetWidth))}px`;panel.style.top=`${Math.max(8,Math.min(innerHeight-panel.offsetHeight-8,rect.top-panel.offsetHeight-6))}px`;}
  positionClipTools(){const rect=this.clipToolsButton.getBoundingClientRect(),panel=this.footer;panel.style.left=`${Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,rect.right-panel.offsetWidth))}px`;panel.style.top=`${Math.max(8,Math.min(innerHeight-panel.offsetHeight-8,rect.top-panel.offsetHeight-6))}px`;}
  found() { const state = audioState(this.editor.report); for (const track of state.tracks) { const clip = track.clips.find(clip => clip.id === this.selected); if (clip) return {track, clip, asset: state.assets[clip.assetId]}; } return {}; }
  update(dirty = true) { this.dirty ||= dirty; if (this.disposed || this.raf || !this.open && !this.dirty) return; this.raf = requestAnimationFrame(() => { this.raf = null; if (this.dirty) { this.dirty = false; this.paint(); } if (!this.open) return; if (!this.integrated) this.playhead.style.transform = `translateX(${this.tickX(this.editor.tick)}px)`; const {clip} = this.found(), time = this.editor.tick / this.fps; this.splitButton.disabled = !clip || time <= clip.start || time >= clip.start + clip.duration; }); }
  paint() {
    const state = audioState(this.editor.report), {clip, asset, track: owner} = this.found(), time = this.editor.tick / this.fps;
    this.root.hidden = !this.open;
    this.launcher?.setAttribute('aria-expanded', String(this.open)); this.launcher?.setAttribute('aria-pressed', String(this.open));
    if (this.launcher) { this.launcher.dataset.hasAudio = String(state.tracks.some(track => track.clips.length)); this.launcher.title = `${this.open ? 'Hide' : 'Show'} audio${state.tracks.length ? ` · ${state.tracks.length} tracks` : ''}`; }
    this.container.classList.toggle('audio-tab-open', this.open && !this.integrated);
    if (this.integrated) { this.host.headerTools.classList.toggle('audio-selection', this.open && Boolean(clip)); this.host.root.classList.toggle('audio-visible', this.open); }
    this.clipToolsButton.disabled=!clip;
    if((!this.open||!clip)&&this.footer.matches(':popover-open'))this.footer.hidePopover();
    if (this.focusPending) { this.focusPending = false; (this.open ? this.importButton : this.launcher)?.focus({preventScroll:true}); }
    if (!this.open) return;
    this.splitButton.disabled = !clip || time <= clip.start || time >= clip.start + clip.duration;
    this.propertiesButton.disabled = this.duplicateButton.disabled = this.deleteButton.disabled = !clip;
    this.clipControls.hidden = !clip;
    const preview = clip && this.gesture?.clip?.id === clip.id ? {...clip, ...this.gesture.patch} : clip;
    this.selectionName.textContent = asset?.name ?? 'Drag clips between tracks';
    this.selectionTime.textContent = preview ? `${preview.start.toFixed(2)}s – ${(preview.start + preview.duration).toFixed(2)}s · ${preview.duration.toFixed(2)}s${this.gesture?.moved ? ` · ${state.tracks.find(row => row.id === this.gesture.target)?.name ?? 'New track'}` : ` · ${owner.name}`}` : 'Drag edges to trim · Double-click for details · Shift-drag keeps timing';
    if (clip && (document.activeElement !== this.clipVolume || this.resetVolumes)) { this.clipVolume.value = String(Math.round(clip.gain * 100)); this.clipVolumeValue.textContent = `${Math.round(clip.gain * 100)}%`; }
    this.extendButton.disabled = audioEnd(state) <= this.editor.totalTicks / this.fps;
    this.extendButton.hidden = this.extendButton.disabled;
    this.title.textContent = state.tracks.length ? `Audio · ${state.tracks.length}` : 'Audio'; this.hint.hidden = Boolean(state.tracks.length) && !this.importController;
    this.empty.hidden = Boolean(state.tracks.length); this.labelColumn.hidden = this.lanes.hidden = !state.tracks.length; this.ruler.hidden = this.integrated || !state.tracks.length;
    const width = this.mode === 'advanced' ? this.host.labelWidth : this.host.controls.offsetWidth; this.root.style.setProperty('--audio-label', `${width}px`);
    const height = this.bodyHeight;
    if (this.integrated) {
      this.host._extent(); this.body.style.height = `${height}px`;
      if (this.revealGroup) { this.revealGroup = false; const bottom = this.host.audioTop + TOOLBAR + Math.min(height, ROW + DROP); if (bottom > this.host.scroll.scrollTop + this.host.height) this.host.scroll.scrollTop = Math.max(0, bottom - this.host.height); }
      this.positionIntegrated();
    } else this.body.style.height = `${Math.max(48, this.container.clientHeight - TOOLBAR - (state.tracks.length?14:0))}px`;
    if (this.horizontal) {
      const range = Math.max(0, this.host.strip.scrollWidth - this.host.strip.clientWidth);
      this.horizontal.hidden = range <= 1 || !state.tracks.length;
      this.horizontalSpacer.style.width = `${this.horizontal.clientWidth + range}px`; this.horizontal.scrollLeft = this.host.strip.scrollLeft;
    }
    const w = Math.max(1, this.lanes.clientWidth);
    this.lanes.style.height = this.labelColumn.style.height = `${height}px`; this.clipLayer.style.height = `${height}px`;
    this.dropRow.style.top = `${height - DROP}px`; this.dropRow.dataset.active = String(this.gesture?.target === 'new' || this.fileDropTrack === 'new');
    this.dropRow.textContent = this.gesture?.target === 'new' ? `Release to create a track · ${asset?.name ?? 'Audio'}` : '+ Drop a clip here to create a track';
    if (this.revealId) {
      const top = this.rulerHeight + state.tracks.findIndex(row => row.id === this.revealId) * ROW + (this.integrated ? this.host.audioTop + TOOLBAR : 0), scroll = this.verticalScroll, viewport = this.integrated ? this.host.height : this.body.clientHeight, margin = this.integrated ? this.bodyTop + TOOLBAR : RULER;
      if (top < scroll.scrollTop + margin) scroll.scrollTop = Math.max(0, top - margin);
      else if (top + ROW > scroll.scrollTop + viewport) scroll.scrollTop = top + ROW - viewport;
      this.revealId = null;
      if (this.integrated) this.positionIntegrated();
    }
    const sy = this.integrated ? Math.max(0, this.host.scroll.scrollTop + this.bodyTop - this.host.audioTop) : this.body.scrollTop;
    const visibleHeight = this.integrated ? Math.max(0, Math.min(height - sy, this.host.height - Math.max(this.bodyTop + TOOLBAR, this.host.audioTop + TOOLBAR - this.host.scroll.scrollTop))) : Math.max(1, this.body.clientHeight);
    const dpr = window.devicePixelRatio || 1; this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(visibleHeight * dpr); this.canvas.style.width = `${w}px`; this.canvas.style.height = `${visibleHeight}px`; this.canvas.style.top = `${sy}px`;
    const ctx = this.canvas.getContext('2d'), css = getComputedStyle(this.root), ink = css.getPropertyValue('--audio-ink').trim(), fill = css.getPropertyValue('--audio-fill').trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, visibleHeight); ctx.font = `10px ${css.fontFamily}`; ctx.fillStyle = css.color;
    const start = Math.max(0, this.xTick(0) / this.fps), end = this.xTick(w) / this.fps, interval = Math.max(.1, 10 ** Math.ceil(Math.log10(Math.max(.001, (end - start) / 10))));
    if (this.integrated) {
      ctx.globalAlpha = .08;
      for (let tick = Math.ceil(this.xTick(0)); tick < this.xTick(w); tick++) ctx.fillRect(Math.round(this.tickX(tick)), 0, 1, visibleHeight);
    } else {
      this.rulerCanvas.width = Math.round(w * dpr); this.rulerCanvas.height = RULER * dpr; this.rulerCanvas.style.width = `${w}px`;
      const ruler = this.rulerCanvas.getContext('2d'); ruler.setTransform(dpr,0,0,dpr,0,0); ruler.font = `10px ${css.fontFamily}`; ruler.fillStyle = css.color; ruler.globalAlpha = .65;
      for (let time = Math.ceil(start / interval) * interval; time < end; time += interval) { const x = this.tickX(time * this.fps); ruler.fillText(`${Number(time.toFixed(2))}s`, x + 4, 14); ctx.globalAlpha = .12; ctx.fillRect(x, this.rulerHeight - sy, 1, visibleHeight); }
    }
    ctx.globalAlpha = 1;
    const visible = new Set(), visibleTracks = new Set();
    for (let index = Math.max(0, Math.floor((sy - this.rulerHeight) / ROW)); visibleHeight > 0 && index < Math.min(state.tracks.length, Math.ceil((sy + visibleHeight - this.rulerHeight) / ROW)); index++) {
      const track = state.tracks[index], top = this.rulerHeight + index * ROW; visibleTracks.add(track.id);
      let label = this.labels.get(track.id); if (!label) {
        label = el('div', this.labelColumn, 'audio-track'); label.events = new AbortController(); label.dataset.track = track.id; const name = el('input', label, 'audio-track-name'); name.setAttribute('aria-label', 'Audio track name'); name.maxLength = 120;
        this.on(label, 'pointerdown', () => { this.trackId = track.id; this.update(); });
        this.on(name, 'focus', () => { this.trackId = track.id; }); this.on(name, 'change', () => this._run(() => this.editor.setAudioTrack(track.id, {name: name.value.trim()})));
        label.mute = this.button(label, `Mute ${track.name}`, () => this.editor.setAudioTrack(track.id, {mute: !audioState(this.editor.report).tracks.find(row => row.id === track.id).mute}), 'minus'); label.mute.textContent = 'M';
        label.solo = this.button(label, `Solo ${track.name}`, () => this.editor.setAudioTrack(track.id, {solo: !audioState(this.editor.report).tracks.find(row => row.id === track.id).solo}), 'person'); label.solo.textContent = 'S';
        const gain = el('label', label, 'audio-track-volume'); label.gain = el('input', gain); Object.assign(label.gain, {type:'range', min:'0', max:'400', step:'1'}); label.level = el('output', gain);
        this.on(label.gain, 'input', () => { label.level.textContent = `${label.gain.value}%`; });
        this.on(label.gain, 'change', () => this._run(() => this.editor.setAudioTrack(track.id, {gain:Number(label.gain.value) / 100})));
        const menu = event => { event.preventDefault(); this.trackId = track.id; showTimelineMenu(this, event, [[{label: 'Import audio here', symbol: 'plus', action: () => this.file.click()}, {label: 'Delete audio track', symbol: 'trash', danger: true, action: () => this.editor.deleteAudioTrack(track.id)}]]); };
        label.menu = this.button(label, `Options for ${track.name}`, () => {}, 'more'); this.on(label.menu, 'click', menu); this.on(label, 'contextmenu', menu);
        this.labels.set(track.id, label);
      }
      label.style.top = `${top}px`; if (document.activeElement !== label.firstChild) label.firstChild.value = track.name;
      label.dataset.selected = String(this.trackId === track.id); label.dataset.drop = String(this.gesture?.target === track.id && this.gesture.moved || this.fileDropTrack === track.id);
      label.gain.setAttribute('aria-label', `Volume for ${track.name}`); label.menu.setAttribute('aria-label', `Options for ${track.name}`);
      if (document.activeElement !== label.gain || this.resetVolumes) { label.gain.value = String(Math.round(track.gain * 100)); label.level.textContent = `${Math.round(track.gain * 100)}%`; }
      for (const key of ['mute', 'solo']) { label[key].setAttribute('aria-pressed', String(track[key])); label[key].setAttribute('aria-label', `${key === 'mute' ? 'Mute' : 'Solo'} ${track.name}`); label[key].title = `${key === 'mute' ? 'Mute' : 'Solo'} ${track.name}`; }
      const muted = track.mute || state.tracks.some(row => row.solo) && !track.solo;
      ctx.fillStyle = ink; ctx.globalAlpha = label.dataset.drop === 'true' ? .12 : this.trackId === track.id ? .04 : 0; ctx.fillRect(0, top - sy, w, ROW); ctx.globalAlpha = .12; ctx.fillRect(0, top + ROW - 1 - sy, w, 1); ctx.globalAlpha = 1;
      const moving = this.gesture?.kind === 'move' && this.gesture.moved ? this.gesture : null;
      const clips = moving ? track.clips.filter(value => value.id !== moving.clip.id) : track.clips;
      if (moving?.target === track.id) clips.push(moving.clip);
      if (!clips.length) { ctx.fillStyle = css.color; ctx.globalAlpha = .4; ctx.fillText('Drop audio here', 14, top + 36 - sy); ctx.globalAlpha = 1; }
      for (const original of clips) {
        const value = this.gesture?.clip?.id === original.id ? {...original, ...this.gesture.patch} : original, left = this.tickX(value.start * this.fps), right = this.tickX((value.start + value.duration) * this.fps);
        if (right < 0 || left > w) continue; visible.add(value.id); const asset = state.assets[value.assetId], a = Math.max(0, left), b = Math.min(w, right);
        ctx.globalAlpha = muted ? .3 : 1; ctx.fillStyle = fill; ctx.fillRect(a, top + 3 - sy, b - a, ROW - 6); ctx.fillStyle = ink;
        for (let x = a; x < b; x += 2) { const local = this.xTick(x) / this.fps - value.start, source = value.offset + local, bin = clamp(Math.floor(source / asset.duration * asset.peaks.length), 0, asset.peaks.length - 1); const fade = Math.min(1, value.fadeIn ? Math.max(0, local) / value.fadeIn : 1, value.fadeOut ? Math.max(0, value.duration - local) / value.fadeOut : 1); const peak = Math.max(1, asset.peaks[bin] * 32 * Math.min(value.gain * track.gain, 2) * fade); ctx.fillRect(x, top + 40 - peak / 2 - sy, 1, peak); }
        const fadeInX = this.tickX((value.start + value.fadeIn) * this.fps), fadeOutX = this.tickX((value.start + value.duration - value.fadeOut) * this.fps);
        ctx.strokeStyle = ink; ctx.globalAlpha = .45; ctx.beginPath(); ctx.moveTo(left, top + ROW - 5 - sy); ctx.lineTo(fadeInX, top + 20 - sy); ctx.moveTo(fadeOutX, top + 20 - sy); ctx.lineTo(right, top + ROW - 5 - sy); ctx.stroke();
        ctx.globalAlpha = 1;
        let node = this.nodes.get(value.id); if (!node) { node = el('button', this.clipLayer, 'audio-clip'); node.type = 'button'; node.dataset.clip = value.id; el('span', node, 'audio-trim audio-trim-left').dataset.edge = 'left'; el('span', node, 'audio-clip-title'); el('span', node, 'audio-trim audio-trim-right').dataset.edge = 'right';
          for (const key of ['fadeIn', 'fadeOut']) { const handle = el('span', node, `audio-fade audio-${key}`); handle.dataset.edge = key; handle.title = key === 'fadeIn' ? 'Drag to fade in' : 'Drag to fade out'; }
          this.nodes.set(value.id, node); }
        node.style.left = `${a}px`; node.style.width = `${Math.max(2, b - a)}px`; node.style.top = `${top + 3}px`; node.dataset.selected = String(value.id === this.selected); node.dataset.muted = String(muted); node.setAttribute('aria-pressed', String(value.id === this.selected)); node.setAttribute('aria-label', `${asset.name}, ${value.start.toFixed(2)} seconds, duration ${value.duration.toFixed(2)} seconds`); node.children[1].textContent = asset.name; node.children[0].hidden = left < 0; node.children[2].hidden = right > w;
        node.dataset.dragging = String(this.gesture?.clip?.id === value.id && this.gesture.moved); node.title = `${asset.name} · Drag to move between tracks · Edges trim · Top handles fade · Double-click for details`;
        node.dataset.compact = String(b - a < 32);
        for (const [child, x] of [[node.children[3], fadeInX], [node.children[4], fadeOutX]]) { child.hidden = b - a < 42 || x < a || x > b; child.style.left = `${clamp(x - a, 12, b - a - 12)}px`; }
      }
    }
    for (const [id, node] of this.nodes) if (!visible.has(id)) { node.remove(); this.nodes.delete(id); }
    for (const [id, node] of this.labels) if (!visibleTracks.has(id)) { node.events.abort(); node.remove(); this.labels.delete(id); }
    this.resetVolumes = false;
    this.snapLine.hidden = this.gesture?.snap == null;
    if (!this.snapLine.hidden) this.snapLine.style.left = `${this.tickX(this.gesture.snap * this.fps)}px`;
  }
  positionIntegrated() {
    const top = this.host.audioTop - this.host.scroll.scrollTop;
    this.root.style.top = `${top}px`; this.root.style.right = `${this.host.scroll.offsetWidth - this.host.scroll.clientWidth}px`;
    this.toolbar.style.transform = `translateY(${Math.max(0, this.bodyTop - top)}px)`;
    this.host.root.style.setProperty('--audio-toolbar-top', `${Math.max(this.bodyTop, top)}px`);
    this.host.root.style.setProperty('--audio-toolbar-bottom', `${Math.max(this.bodyTop, top) + TOOLBAR}px`);
    this.root.style.clipPath = `inset(${Math.max(0, this.bodyTop - top)}px 0 ${Math.max(0, top + this.contentHeight - this.host.height)}px 0)`;
  }
  down(event) {
    if (event.button !== 0) return; this.onSeek?.(); const node = event.target.closest('[data-clip]'), rect = this.lanes.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (node) {
      this.selected = node.dataset.clip; const found = this.found(); this.trackId = found.track.id;
      const snapPoints = [0, this.editor.tick / this.fps, this.editor.totalTicks / this.fps];
      for (const track of audioState(this.editor.report).tracks) for (const clip of track.clips) if (clip.id !== found.clip.id) snapPoints.push(clip.start, clip.start + clip.duration);
      snapPoints.sort((a, b) => a - b);
      this.gesture = {kind: event.target.dataset.edge ?? 'move', clip: found.clip, source: found.track.id, target: found.track.id, tick: this.xTick(x), x:event.clientX, y:event.clientY, patch: {}, snapPoints, pointer: event.pointerId}; node.focus({preventScroll: true});
    }
    else {
      this.selected = null; this.trackId = this.trackAt(event.clientY)?.id;
      if (event.target.closest('.audio-new-lane')) { this.update(); return; }
      this.gesture = {kind: 'scrub', pointer: event.pointerId}; this.onScrubStart?.(); this.seek(x);
    }
    this.lanes.setPointerCapture(event.pointerId); event.preventDefault(); this.update();
  }
  seek(x) { const tick = clamp(Math.round(this.xTick(x)), 0, this.editor.totalTicks - 1); this.editor.seek(tick, {evaluate: false}); this.onScrub?.(tick); }
  move(event) {
    const gesture = this.gesture; if (!gesture) return; const x = event.clientX - this.lanes.getBoundingClientRect().left;
    if (gesture.kind === 'scrub') { this.pendingSeek = x; if (!this.scrubRaf) this.scrubRaf = requestAnimationFrame(() => { this.scrubRaf = null; if (this.gesture?.kind === 'scrub') this.seek(this.pendingSeek); }); return; }
    gesture.point = {clientX:event.clientX, clientY:event.clientY, altKey:event.altKey, shiftKey:event.shiftKey};
    if (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) return;
    gesture.moved = true; gesture.snap = null;
    const clip = gesture.clip; let delta = (event.altKey ? this.xTick(x) - gesture.tick : Math.round(this.xTick(x) - gesture.tick)) / this.fps;
    if (gesture.kind === 'move') {
      let start = clamp(clip.start + delta, 0, 3600 - clip.duration);
      if (event.shiftKey) start = clip.start;
      else if (!event.altKey) {
        let distance = 7;
        for (const edge of [0, clip.duration]) {
          const index = afterTime(gesture.snapPoints, start + edge), x = this.tickX((start + edge) * this.fps);
          for (const point of [gesture.snapPoints[index - 1], gesture.snapPoints[index]]) {
            if (point == null) continue;
            const next = point - edge, pixels = Math.abs(x - this.tickX(point * this.fps));
            if (next >= 0 && next + clip.duration <= 3600 && pixels < distance) { distance = pixels; gesture.snap = point; delta = next; }
          }
        }
        if (gesture.snap != null) start = delta;
      }
      gesture.patch = {start};
      const row = Math.floor((event.clientY - this.lanes.getBoundingClientRect().top - this.rulerHeight) / ROW), tracks = audioState(this.editor.report).tracks;
      gesture.target = row >= tracks.length ? 'new' : tracks[Math.max(0, row)]?.id ?? gesture.source;
    }
    else if (gesture.kind === 'left') { const shift = clamp(delta, -Math.min(clip.start, clip.offset), clip.duration - Math.min(clip.duration, 1 / this.fps)); gesture.patch = {start: clip.start + shift, offset: clip.offset + shift, duration: clip.duration - shift}; }
    else if (gesture.kind === 'right') { const asset = audioState(this.editor.report).assets[clip.assetId]; gesture.patch = {duration: clamp(clip.duration + delta, Math.min(clip.duration, 1 / this.fps), Math.min(asset.duration - clip.offset, 3600 - clip.start))}; }
    else if (gesture.kind === 'fadeIn') gesture.patch = {fadeIn:clamp(clip.fadeIn + delta, 0, clip.duration)};
    else if (gesture.kind === 'fadeOut') gesture.patch = {fadeOut:clamp(clip.fadeOut - delta, 0, clip.duration)};
    if (!this.dragRaf) this.dragRaf = requestAnimationFrame(() => this.autoScroll());
    this.update();
  }
  autoScroll() {
    this.dragRaf = null; const gesture = this.gesture; if (!gesture?.point || !gesture.moved) return;
    const rect = this.integrated ? this.host.scroll.getBoundingClientRect() : this.body.getBoundingClientRect(), lanes = this.lanes.getBoundingClientRect(), point = gesture.point, scroll = this.host.scroll ?? this.host.strip, vertical = this.verticalScroll;
    const speed = (value, low, high) => value < low + 24 ? -Math.min(18, (low + 24 - value) / 3) : value > high - 24 ? Math.min(18, (value - high + 24) / 3) : 0;
    const beforeX = scroll.scrollLeft, beforeY = vertical.scrollTop;
    scroll.scrollLeft += speed(point.clientX, lanes.left, lanes.right);
    if (gesture.kind === 'move') vertical.scrollTop += speed(point.clientY, rect.top + (this.integrated ? this.bodyTop + TOOLBAR : 0), rect.top + (this.integrated ? this.host.height : rect.height));
    if (scroll.scrollLeft !== beforeX || vertical.scrollTop !== beforeY) { if (this.integrated) this.positionIntegrated(); this.move(point); }
  }
  up(event) {
    const gesture = this.gesture; if (!gesture) return;
    if (gesture.kind === 'scrub') { this.seek(event.clientX - this.lanes.getBoundingClientRect().left); this.cancel(); return; }
    this.cancel();
    const changed = gesture.target !== gesture.source || Object.keys(gesture.patch).some(key => Math.abs(gesture.patch[key] - gesture.clip[key]) > 1e-9);
    if (changed) this._run(() => {
      const commit = () => {
        const target = gesture.target === 'new' ? this.editor.addAudioTrack(`Audio ${audioState(this.editor.report).tracks.length + 1}`) : gesture.target;
        this.editor.setAudioClip(gesture.clip.id, gesture.patch, target); this.trackId = target; this.revealTrack(target);
      };
      if (gesture.target === 'new') this.editor.movieclipBatch('Move audio to new track', commit); else commit();
      this.selected = gesture.clip.id; this.live.textContent = `Audio moved to ${this.found().track.name}, ${this.found().clip.start.toFixed(2)} seconds.`;
    });
    if (this.lanes.hasPointerCapture(event.pointerId)) this.lanes.releasePointerCapture(event.pointerId); this.update();
  }
  cancel() { const gesture = this.gesture; this.gesture = null; if (this.scrubRaf) cancelAnimationFrame(this.scrubRaf); this.scrubRaf = null; if (this.dragRaf) cancelAnimationFrame(this.dragRaf); this.dragRaf = null; if (gesture && this.lanes.hasPointerCapture(gesture.pointer)) this.lanes.releasePointerCapture(gesture.pointer); if (gesture?.kind === 'scrub') { this.editor.seek(this.editor.tick); this.onScrubEnd?.(); } this.update(); }
  keydown(event) {
    const ctrl = event.ctrlKey || event.metaKey; let action;
    if (event.target.closest('button:not([data-clip])') && ['Enter', ' '].includes(event.key)) { event.stopPropagation(); return; }
    if (event.target.matches('input,select,textarea') && !(event.target.matches('input[type=range]') && ctrl && ['z', 'y'].includes(event.key.toLowerCase()))) { event.stopPropagation(); return; }
    if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();this.onCancel?.();this.cancel();this.closeProperties();return; }
    else if (ctrl && event.key.toLowerCase() === 'z') action = () => this.onHistory?this.onHistory(event.shiftKey?'redo':'undo'):this.editor[event.shiftKey?'redo':'undo']();
    else if (ctrl && event.key.toLowerCase() === 'y') action = () => this.onHistory?this.onHistory('redo'):this.editor.redo();
    else if (this.selected && ctrl && event.key.toLowerCase() === 'c') action = () => this.editor.copyAudioClip(this.selected);
    else if (this.selected && ctrl && event.key.toLowerCase() === 'x') action = () => { this.editor.cutAudioClip(this.selected); this.selected=null; };
    else if (ctrl && event.key.toLowerCase() === 'v') action = () => { this.selected=this.editor.pasteAudioClip(this.trackId)||null; };
    else if (this.selected && ['Delete', 'Backspace'].includes(event.key)) action = () => { this.editor.deleteAudioClip(this.selected); this.selected = null; };
    else if (this.selected && ctrl && event.key.toLowerCase() === 'd') action = () => { this.selected = this.editor.duplicateAudioClip(this.selected); };
    else if (this.selected && event.key.toLowerCase() === 's' && !ctrl) action = () => { this.selected = this.editor.splitAudioClip(this.selected); };
    else if (this.selected && ['ArrowLeft', 'ArrowRight'].includes(event.key)) action = () => { const {clip} = this.found(); if (clip) this.editor.setAudioClip(clip.id, {start: Math.max(0, clip.start + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1) / this.fps)}); };
    else if (this.selected && ['ArrowUp', 'ArrowDown'].includes(event.key)) action = () => {
      const {clip, track} = this.found(), tracks = audioState(this.editor.report).tracks, destination = tracks[tracks.findIndex(row => row.id === track.id) + (event.key === 'ArrowUp' ? -1 : 1)];
      if (destination) { this.editor.setAudioClip(clip.id, {}, destination.id); this.trackId = destination.id; this.revealTrack(destination.id); }
    };
    else if (event.key === 'Enter' && this.selected) action = () => this.properties();
    else if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); this.onTogglePlay?.(); return; }
    if (action) { event.preventDefault(); this._run(action); }
    // Frame shortcuts must never delete/move animation behind focused audio.
    if (!['Tab'].includes(event.key)) event.stopPropagation();
  }
  async importFile(file, placement = {trackId:this.trackId, start:this.editor.tick / this.fps}) {
    if (!this.engine || this.importController) return;
    if (!this.open) this.setOpen(true);
    this.onSeek?.(); const report = this.editor.report, start = placement.start, controller = this.importController = new AbortController(); this.importButton.disabled = true; this.importButton.lastChild.textContent = 'Importing…'; this.importButton.setAttribute('aria-busy', 'true'); this.cancelImportButton.hidden=false;
    try {
      const asset = await this.engine.import(file, {signal: controller.signal, onProgress: text => { this.live.textContent = text; this.hint.textContent = text; this.hint.hidden = false; }});
      if (controller.signal.aborted || this.editor.report !== report) return;
      const ids=['scene','camera',...this.editor.report._styk.layers.order], extend=start+asset.duration>this.editor.totalTicks/this.fps&&ids.every(id=>!this.editor.getLayer(id)?.locked);
      const commit=()=>{this.selected=this.editor.importAudio(asset,{trackId:placement.trackId,start});if(extend)this.extend();};
      if(extend)this.editor.movieclipBatch('Import audio and extend animation',commit);else commit();
      this.trackId = this.found().track.id;
      this.revealTrack(this.trackId);
      this.live.textContent = `Imported ${asset.name}${extend?' and extended the animation':''}. Drag to move, drag an edge to trim.`;
    } catch (error) { if (error.name !== 'AbortError'&&!controller.signal.aborted) this.error(error); }
    finally { this.importController = null; this.importButton.disabled = false; this.importButton.lastChild.textContent = 'Import audio'; this.importButton.removeAttribute('aria-busy'); this.cancelImportButton.hidden=true; this.hint.textContent = 'Drop music, dialogue or sound effects'; this.update(); }
  }
  extend() {
    const count = Math.ceil(audioEnd(audioState(this.editor.report)) * this.fps) - this.editor.totalTicks;
    if (count > 0) { const ripple = this.editor.audioRipple; this.editor.audioRipple = false; try { this.editor.sheetInsertFrames(['scene', 'camera', ...this.editor.report._styk.layers.order], this.editor.totalTicks, count); } finally { this.editor.audioRipple = ripple; } }
  }
  closeProperties() { this.popover?.events.abort(); this.popover?.remove(); this.popover = null; }
  properties() {
    this.closeProperties(); const {clip, track, asset} = this.found(); if (!clip) return;
    const popover = this.popover = el('div', document.body, 'audio-properties'); popover.events = new AbortController(); popover.setAttribute('popover', 'auto'); popover.setAttribute('role', 'dialog'); popover.setAttribute('aria-label', 'Audio clip properties');
    const title = el('div', popover, 'audio-properties-title'); el('strong', title, '', asset.name); this.button(title, 'Close audio properties', () => this.closeProperties(), 'close');
    const fields = el('div', popover, 'audio-properties-fields');
    for (const [key, name, value, max] of [['start', 'Start · seconds', clip.start, 3600], ['offset', 'Source in · seconds', clip.offset, asset.duration], ['duration', 'Duration · seconds', clip.duration, asset.duration], ['gain', 'Clip volume · %', clip.gain * 100, 400], ['fadeIn', 'Fade in · seconds', clip.fadeIn, clip.duration], ['fadeOut', 'Fade out · seconds', clip.fadeOut, clip.duration]]) {
      const label = el('label', fields, '', name), input = el('input', label); Object.assign(input, {type: 'number', min: key === 'duration' ? '0.000021' : '0', max: String(max), step: key === 'gain' ? '1' : '0.001', value: String(Number(value.toFixed(6)))}); input.setAttribute('aria-label', name);
      this.on(input, 'change', () => { const patch = {[key]: Number(input.value) / (key === 'gain' ? 100 : 1)}; this._run(() => this.editor.setAudioClip(clip.id, patch)); const current = this.found().clip; if (current) input.value = String(current[key] * (key === 'gain' ? 100 : 1)); });
    }
    const trackLabel = el('label', fields, '', 'Track'), select = el('select', trackLabel); select.setAttribute('aria-label', 'Audio clip track');
    for (const row of audioState(this.editor.report).tracks) { const option = el('option', select, '', row.name); option.value = row.id; } select.value = track.id;
    this.on(select, 'change', () => this._run(() => { this.editor.setAudioClip(clip.id, {}, select.value); this.trackId = select.value; this.revealTrack(select.value); gain.value = String(this.found().track.gain * 100); }));
    const gainLabel = el('label', fields, '', 'Track volume · %'), gain = el('input', gainLabel); Object.assign(gain, {type: 'number', min: '0', max: '400', step: '1', value: String(track.gain * 100)}); gain.setAttribute('aria-label', 'Track volume · %'); this.on(gain, 'change', () => this._run(() => this.editor.setAudioTrack(select.value, {gain: Number(gain.value) / 100})));
    const actions = el('div', popover, 'audio-properties-actions'); this.button(actions, 'Duplicate audio clip', () => { this.selected = this.editor.duplicateAudioClip(clip.id); this.closeProperties(); }, 'duplicate'); this.button(actions, 'Delete audio clip', () => { this.editor.deleteAudioClip(clip.id); this.selected = null; this.closeProperties(); }, 'trash');
    el('p', popover, '', 'Drag between tracks to move. Shift keeps timing; Alt turns off snapping. Drag the top clip handles to fade.'); this.on(popover, 'keydown', event => { if (event.key === 'Escape') this.closeProperties(); event.stopPropagation(); });
    popover.showPopover();
  }
  destroy() { this.disposed = true; this.editor.audioSelection = {selected:this.selected, trackId:this.trackId}; this.container.classList.remove('audio-tab-open'); this.importController?.abort(); this.cancel(); this.events.abort(); for(const label of this.labels.values())label.events.abort(); this.menuEvents?.abort(); this.menu?.remove(); this.observer.disconnect(); if (this.raf) cancelAnimationFrame(this.raf); this.closeProperties(); this.footer.hidePopover();this.footer.remove(); if (this.options.matches(':popover-open')) this.options.hidePopover(); this.root.remove(); }
}
