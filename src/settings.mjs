import { icon } from "./icons.mjs";
import { PIVOT_HANDLE_COLORS } from "./canvas-interactions.mjs";
import { Localization, normalizeLocale, SUPPORTED_LOCALES } from "./localization.mjs";
import { DEFAULT_HOTKEYS, normalizeHotkeys } from './hotkeys.mjs';
import { HotkeySettings } from './hotkey-settings.mjs';
import { applyUIScale, normalizeUIScale, UI_SCALE } from './ui-scale.mjs';
import { applyEditorTheme, normalizeTheme } from './theme.mjs';
import {normalizePlaybackQuality, playbackQualityOptions} from './preview-quality.mjs';

export const EDITOR_SETTINGS_KEY = "stykanimate.editor.settings.v1";
export const DEFAULT_EDITOR_SETTINGS = Object.freeze({
  locale: "en",
  theme: "system",
  uiScale: 100,
  hotkeys: DEFAULT_HOTKEYS,
  timelineMode: "advanced",
  replaceKeyframesOnDrop: true,
  showHandles: true,
  showCamera: false,
  showUnselectedHandles: true,
  canvasGrid: false,
  canvasZoomGesture: "ctrl-scroll",
  marqueeSelection: "bounds",
  canvasGuideVertical: false,
  canvasGuideHorizontal: false,
  canvasGuidesLocked: false,
  canvasGridSpacing: 40,
  canvasGridOpacity: 0.18,
  canvasGuideX: 0.5,
  canvasGuideY: 0.75,
  motionPaths: false,
  motionPathRange: 0,
  motionPathLabels: true,
  motionPathDots: true,
  motionPathAllTargets: false,
  autoSizeHandles: true,
  outlineHandles: true,
  builderShowStaticHandles: true,
  builderSmartSnapping: true,
  builderHighlightSegment: false,
  builderCanvasColor: '#ffffff',
  useBuilderCanvasColor: false,
  builderOutlinerWidth: 236,
  handleSize: 5,
  onionCount: 0,
  onionAhead: true,
  onionJoined: true,
  onionOpacity: 0.14,
  onionBefore: 2,
  onionRangeBefore: null,
  onionRangeAfter: null,
  onionAfter: 1,
  onionStep: 1,
  onionFade: true,
  onionTint: true,
  onionBeforeColor: '#e76b70',
  onionAfterColor: '#549de7',
  onionScope: 'all',
  onionMode: 'keyframes',
  onionCamera: false,
  onionShowOnTop: false,
  loopPlayback: true,
  fitViewOnPlayback: true,
  playbackQuality: 'normal',
  rendererMode: "auto",
  autosaveSeconds: 2.5,
});
export function normalizeEditorSettings(value = {}) {
  const result = { ...DEFAULT_EDITOR_SETTINGS };
  result.locale = normalizeLocale(value?.locale);
  result.theme = normalizeTheme(value?.theme);
  result.uiScale = normalizeUIScale(value?.uiScale);
  result.hotkeys = normalizeHotkeys(value?.hotkeys);
  result.playbackQuality = normalizePlaybackQuality(value?.playbackQuality);
  if (['scroll', 'ctrl-scroll'].includes(value?.canvasZoomGesture))
    result.canvasZoomGesture = value.canvasZoomGesture;
  if (['bounds', 'origins'].includes(value?.marqueeSelection))
    result.marqueeSelection = value.marqueeSelection;
  if (value?.timelineMode === "simple" || value?.timelineMode === "advanced")
    result.timelineMode = value.timelineMode;
  for (const key of [
    "replaceKeyframesOnDrop",
    "showHandles",
    "showCamera",
    "showUnselectedHandles",
    "canvasGrid", "canvasGuideVertical", "canvasGuideHorizontal", "canvasGuidesLocked",
    "motionPaths",
    "motionPathLabels",
    "motionPathDots",
    "motionPathAllTargets",
    "autoSizeHandles",
    "outlineHandles",
    "builderShowStaticHandles",
    "builderSmartSnapping",
    "builderHighlightSegment",
    "useBuilderCanvasColor",
    "onionAhead",
    "onionJoined",
    "onionFade",
    "onionTint",
    "onionCamera",
    "onionShowOnTop",
    "loopPlayback",
    "fitViewOnPlayback",
  ])
    if (typeof value?.[key] === "boolean") result[key] = value[key];
  if (typeof value?.builderCanvasColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.builderCanvasColor))
    result.builderCanvasColor = value.builderCanvasColor.toLowerCase();
  for (const [key, min, max] of [
    ["canvasGridSpacing", 4, 1000], ["canvasGridOpacity", 0.05, 0.6],
    ["canvasGuideX", 0, 1], ["canvasGuideY", 0, 1],
    ["handleSize", 3, 10],
    ["onionCount", 0, 9],
    ["onionOpacity", 0, 1],
    ["onionBefore", 0, Number.MAX_SAFE_INTEGER],
    ["onionAfter", 0, Number.MAX_SAFE_INTEGER],
    ["onionStep", 1, 20],
    ["autosaveSeconds", 0, 300],
    ["builderOutlinerWidth", 160, 520],
    ["motionPathRange", 0, 4000],
  ])
    if (Number.isFinite(value?.[key]))
      result[key] = Math.max(min, Math.min(max, value[key]));
  for(const key of ['onionRangeBefore','onionRangeAfter'])
    if(Number.isFinite(value?.[key]))result[key]=Math.max(0,Math.min(10000000,Math.round(value[key])));
  result.onionCount = Math.round(result.onionCount);
  result.motionPathRange = Math.round(result.motionPathRange);
  for (const key of ['onionBefore','onionAfter','onionStep']) result[key] = Math.round(result[key]);
  for (const key of ['onionBeforeColor','onionAfterColor'])
    if (typeof value?.[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key])) result[key] = value[key].toLowerCase();
  if (['all','selected'].includes(value?.onionScope)) result.onionScope = value.onionScope;
  if (['keyframes','frames'].includes(value?.onionMode)) result.onionMode = value.onionMode;
  if (['auto','canvas','gpu'].includes(value?.rendererMode)) result.rendererMode = value.rendererMode;
  return result;
}
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export class EditorSettings {
  constructor({
    value,
    getValue,
    onChange = () => {},
    onPersist,
    onResetWorkspace,
    localization,
    onPrivacy,
    onFeedback,
    onDonate,
  } = {}) {
    if (value === undefined) {
      try {
        value = JSON.parse(localStorage.getItem(EDITOR_SETTINGS_KEY) || "null");
      } catch {
        value = {};
      }
    }
    this.value = normalizeEditorSettings(value);
    // Motion-path visibility is session-only; keep saved display options.
    this.value.motionPaths = false;
    applyEditorTheme(this.value.theme);
    applyUIScale(this.value.uiScale);
    this.localization = localization || new Localization({locale: this.value.locale});
    this.localization.setLocale(this.value.locale);
    this.getValue = getValue;
    this.onChange = onChange;
    this.onPersist =
      onPersist ||
      ((next) =>
        localStorage.setItem(EDITOR_SETTINGS_KEY, JSON.stringify(next)));
    this.onResetWorkspace = onResetWorkspace;
    this.onPrivacy = onPrivacy;
    this.onFeedback = onFeedback;
    this.onDonate = onDonate;
    this.tab = "interface";
    this.chain = Promise.resolve();
    this.pending = null;
    this.timer = null;
    this.error = null;
    this.style = document.createElement("link");
    this.style.rel = "stylesheet";
    this.style.href = new URL("./settings.css", import.meta.url).href;
    this.style.dataset.stykSettings = "";
    document.head.append(this.style);
    this.dialog = document.createElement("dialog");
    this.dialog.className = "styk-settings";
    this.dialog.setAttribute("aria-label", this.t("settings.editorLabel"));
    this.dialog.innerHTML = `<header class="styk-settings-head"><h2>${escape(this.t("settings.title"))}</h2><button type="button" aria-label="${escape(this.t("settings.close"))}">${icon("x")}</button></header><div class="styk-settings-layout"><aside class="styk-settings-sidebar"><nav class="styk-settings-tabs" role="tablist" aria-orientation="vertical" aria-label="${escape(this.t("settings.sections"))}">${[
      ["interface", "Interface", "sliders"],
      ["canvas", "Canvas", "frame"],
      ["animation", "Animation", "play"],
      ["shortcuts", "Shortcuts", "keyboard"],
      ...(onFeedback ? [["feedback", "Feedback", "message"]] : []),
    ]
      .map(
        ([id, name, symbol]) =>
          `<button type="button" role="tab" id="styk-settings-tab-${id}" data-tab="${id}" aria-controls="styk-settings-content">${icon(symbol)}<span data-settings-tab-label>${escape(this.t('settings.' + id))}</span></button>`,
      )
      .join(
        "",
      )}</nav><div class="styk-settings-actions"></div></aside><section id="styk-settings-content" class="styk-settings-content" role="tabpanel"></section></div>`;
    document.body.append(this.dialog);
    this.content = this.dialog.querySelector(".styk-settings-content");
    this.compactLayout = window.matchMedia('(max-width:620px)');
    this.syncTabOrientation = () => this.dialog.querySelector('[role=tablist]').setAttribute('aria-orientation', this.compactLayout.matches ? 'horizontal' : 'vertical');
    this.compactLayout.addEventListener('change', this.syncTabOrientation);
    this.syncTabOrientation();
    this.hotkeySettings = new HotkeySettings(this);
    if (onPrivacy) {
      const button = document.createElement('button'); button.type = 'button'; button.innerHTML = `${icon('settings')}<span>Privacy & diagnostics</span>`; button.dataset.settingsPrivacy = ''; button.setAttribute('aria-label', 'Privacy & diagnostics'); button.title = 'Privacy & diagnostics';
      button.onclick = () => { this.close(); void this.onPrivacy(); };
      this.dialog.querySelector('.styk-settings-actions').append(button);
    }
    if (onDonate) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.settingsDonate = '';
      button.innerHTML = `${icon('heart')}<span>${escape(this.t('settings.donate'))}</span>${icon('externalLink')}`;
      button.onclick = () => Promise.resolve().then(() => this.onDonate()).catch(error => this.showError(error));
      this.dialog.querySelector('.styk-settings-actions').append(button);
    }
    this.unsubscribeLocale = this.localization.subscribe(() => this.refreshLanguage());
    this.dialog.querySelector(".styk-settings-head button").onclick = () =>
      this.close();
    this.dialog.addEventListener("close", () => void this.flush());
    this.dialog.addEventListener("keydown", (event) => {
      event.stopPropagation();
      const tab = event.target.closest("[role=tab]");
      if (
        tab &&
        [
          "ArrowDown",
          "ArrowUp",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
        ].includes(event.key)
      ) {
        event.preventDefault();
        const tabs = [...this.dialog.querySelectorAll("[role=tab]")],
          index = tabs.indexOf(tab);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (index +
                  (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) +
                  tabs.length) %
                tabs.length;
        this.selectTab(tabs[next].dataset.tab);
        tabs[next].focus();
      }
    });
    this.dialog.addEventListener("click", (event) => {
      event.stopPropagation();
      const tab = event.target.closest("[role=tab]");
      if (tab) this.selectTab(tab.dataset.tab);
      const feedback = event.target.closest('[data-settings-feedback]');
      if (feedback) { this.close(); this.onFeedback?.({category: feedback.dataset.settingsFeedback}); }
      if (event.target.closest("[data-scale-reset]")) {
        this.commit({uiScale: 100});
        this.syncScaleControl();
      }
      if (event.target.closest("[data-settings-reset]"))
        Promise.resolve(this.onResetWorkspace?.()).catch((error) =>
          this.showError(error),
        );
    });
    this.dialog.addEventListener("change", (event) => {
      const input = event.target.closest("[data-setting]");
      if (!input) return;
      let value =
        input.type === "checkbox"
          ? input.checked
          : input.type === "number" || input.type === "range"
            ? Number(input.value)
            : input.value;
      if (input.dataset.setting === "onionOpacity") value /= 100;
      this.commit({ [input.dataset.setting]: value });
    });
    this.dialog.addEventListener("input", (event) => {
      if (event.target.dataset.setting === "uiScale") {
        this.commit({uiScale: Number(event.target.value)});
        this.syncScaleControl();
      }
      if (event.target.dataset.setting === "handleSize") {
        const size = Number(event.target.value);
        this.content
          .querySelector(".styk-settings-preview")
          ?.style.setProperty("--size", size);
        this.content.querySelector("[data-handle-value]").textContent =
          `${size}px`;
      }
    });
  }
  t(key, params) { return this.localization.t(key, params); }
  refreshLanguage() {
    this.value.locale = this.localization.locale;
    this.dialog.lang = this.localization.locale;
    this.dialog.setAttribute('aria-label', this.t('settings.editorLabel'));
    this.dialog.querySelector('.styk-settings-head h2').textContent = this.t('settings.title');
    this.dialog.querySelector('.styk-settings-head button').setAttribute('aria-label', this.t('settings.close'));
    this.dialog.querySelector('[role=tablist]').setAttribute('aria-label', this.t('settings.sections'));
    for (const button of this.dialog.querySelectorAll('[data-tab]'))
      button.querySelector('[data-settings-tab-label]').textContent = this.t('settings.' + button.dataset.tab);
    const donate = this.dialog.querySelector('[data-settings-donate] span');
    if (donate) donate.textContent = this.t('settings.donate');
    if (!this.dialog.open) return;
    const active = document.activeElement, setting = active?.dataset.setting;
    const draft = active?.value;
    const scrollTop = this.content.scrollTop;
    this.render();
    this.content.scrollTop = scrollTop;
    if (setting) {
      const candidates = [...this.content.querySelectorAll(`[data-setting="${setting}"]`)];
      const target = active.type === 'radio' ? candidates.find(input => input.value === draft) : candidates[0];
      if (target) {
        if (['number','range','text'].includes(target.type)) target.value = draft;
        target.focus({preventScroll:true});
      }
    }
  }
  setValue(value) {
    this.value = normalizeEditorSettings(value);
    applyEditorTheme(this.value.theme);
    applyUIScale(this.value.uiScale);
    const changed = this.localization.setLocale(this.value.locale);
    if (!changed && this.dialog.open) this.render();
  }
  open(tab = this.tab) {
    if (this.getValue) this.value = normalizeEditorSettings(this.getValue());
    applyEditorTheme(this.value.theme);
    applyUIScale(this.value.uiScale);
    this.localization.setLocale(this.value.locale);
    this.dialog.lang = this.localization.locale;
    this.selectTab(tab);
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector(`[data-tab="${this.tab}"]`).focus();
  }
  close() {
    this.dialog.close();
    void this.flush();
  }
  selectTab(tab) {
    this.tab = ["interface", "canvas", "animation", "shortcuts", ...(this.onFeedback ? ['feedback'] : [])].includes(tab)
      ? tab
      : "interface";
    for (const button of this.dialog.querySelectorAll("[role=tab]")) {
      const selected = button.dataset.tab === this.tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    this.hotkeySettings.cancel();
    this.hotkeySettings.conflict = null;
    this.dialog.dataset.tab = this.tab;
    this.content.setAttribute("aria-labelledby", `styk-settings-tab-${this.tab}`);
    this.render();
    this.content.scrollTop = 0;
  }
  checkbox(label, key) {
    return `<label class="styk-settings-row"><span>${label}</span><input type="checkbox" data-setting="${key}" ${this.value[key] ? "checked" : ""}></label>`;
  }
  number(label, key, min, max, unit = "", value = this.value[key]) {
    return `<label class="styk-settings-row"><span>${label}</span><span class="styk-settings-number"><input type="number" data-setting="${key}" min="${min}" max="${max}" value="${value}" aria-label="${label}"><small>${unit}</small></span></label>`;
  }
  syncScaleControl() {
    const input = this.content.querySelector('[data-setting="uiScale"]');
    if (!input) return;
    input.value = this.value.uiScale;
    input.setAttribute('aria-valuetext', `${this.value.uiScale}%`);
    this.content.querySelector('[data-scale-value]').value = `${this.value.uiScale}%`;
    this.content.querySelector('[data-scale-reset]').disabled = this.value.uiScale === 100 || !window.stykDesktop?.setUIScale;
  }
  scaleControl() {
    const available = typeof window.stykDesktop?.setUIScale === 'function';
    return `<div class="styk-settings-scale"><div class="styk-settings-row"><label for="styk-ui-scale">${escape(this.t('settings.uiScale'))}</label><div class="styk-settings-scale-value"><output for="styk-ui-scale" data-scale-value>${this.value.uiScale}%</output><button type="button" class="styk-settings-reset" data-scale-reset title="${escape(this.t('settings.resetScale'))}" aria-label="${escape(this.t('settings.resetScale'))}" ${this.value.uiScale === 100 || !available ? 'disabled' : ''}>${icon('undo')}</button></div></div><input id="styk-ui-scale" type="range" data-setting="uiScale" min="${UI_SCALE.min}" max="${UI_SCALE.max}" step="${UI_SCALE.step}" value="${this.value.uiScale}" aria-valuetext="${this.value.uiScale}%" ${available ? '' : 'disabled'}><div class="styk-settings-scale-limits"><span>${UI_SCALE.min}%</span><span>${UI_SCALE.max}%</span></div>${available ? '' : `<p class="styk-settings-note">${escape(this.t('settings.browserScale'))}</p>`}</div>`;
  }
  render() {
    const value = this.value;
    let html = "";
    if (this.tab === "interface")
      html = `<section class="styk-settings-group"><h3>${icon("sliders")}${escape(this.t("settings.appearance"))}</h3><div class="styk-settings-row"><span>${escape(this.t('settings.theme'))}</span><div class="styk-settings-theme" role="radiogroup" aria-label="${escape(this.t('settings.theme'))}">${['system', 'light', 'dark'].map(theme => `<label><input type="radio" name="editor-theme" data-setting="theme" value="${theme}" ${value.theme === theme ? 'checked' : ''}><span>${escape(this.t('settings.' + theme))}</span></label>`).join('')}</div></div><label class="styk-settings-row"><span>${escape(this.t('settings.language'))}</span><select data-setting="locale" aria-label="${escape(this.t('settings.language'))}">${SUPPORTED_LOCALES.map(locale => `<option value="${locale.id}" ${value.locale === locale.id ? 'selected' : ''}>${escape(locale.nativeName)}</option>`).join('')}</select></label>${value.locale !== 'en' ? `<p class="styk-settings-note" data-locale-coverage>${escape(this.t('settings.partialLanguage'))}</p>` : ''}${this.scaleControl()}</section><section class="styk-settings-group"><h3>${icon('layers')}${escape(this.t('timeline.title'))}</h3>${[
        ["advanced", this.t("timeline.advanced")],
        ["simple", this.t("timeline.simple")],
      ]
        .map(
          ([id, label]) =>
            `<label class="styk-settings-mode"><input type="radio" name="timeline-mode" data-setting="timelineMode" value="${id}" ${value.timelineMode === id ? "checked" : ""}><strong>${icon(id === "advanced" ? "layers" : "frame")}${escape(label)}</strong></label>`,
        )
        .join(
          "",
        )}</section>${this.onResetWorkspace ? `<section class="styk-settings-group"><h3>${escape(this.t('settings.workspace'))}</h3><button type="button" class="styk-settings-reset" data-settings-reset>${icon("undo")}${escape(this.t('settings.resetPanels'))}</button></section>` : ""}`;
    if (this.tab === "canvas")
      html = `<div class="settings-canvas">
        <section class="settings-card"><label class="styk-settings-row"><span>Zoom gesture</span><select data-setting="canvasZoomGesture" aria-label="Zoom gesture"><option value="ctrl-scroll" ${value.canvasZoomGesture === 'ctrl-scroll' ? 'selected' : ''}>Ctrl + scroll to zoom</option><option value="scroll" ${value.canvasZoomGesture === 'scroll' ? 'selected' : ''}>Scroll to zoom</option></select></label><label class="styk-settings-row"><span>Rectangle selects</span><select data-setting="marqueeSelection" aria-label="Rectangle selects"><option value="bounds" ${value.marqueeSelection === 'bounds' ? 'selected' : ''}>Figure bounds</option><option value="origins" ${value.marqueeSelection === 'origins' ? 'selected' : ''}>Figure origins</option></select></label></section>
        <section class="settings-card"><h3>${icon('nodes')}Joint handles</h3><div class="settings-control-grid">${this.checkbox('Show handles','showHandles')}${this.checkbox('Show unselected figures','showUnselectedHandles')}${this.checkbox('Automatic size','autoSizeHandles')}${this.checkbox('Outline handles','outlineHandles')}</div>
        <div class="settings-handle-size"><label class="styk-settings-row"><span>Handle radius</span><span class="styk-settings-number"><input type="range" data-setting="handleSize" min="3" max="10" step="1" value="${value.handleSize}" aria-label="Handle radius"><small data-handle-value>${value.handleSize}px</small></span></label><div class="styk-settings-preview" aria-label="Joint handle preview" style="--size:${value.handleSize};--node-outline:${value.outlineHandles ? '1px solid #000' : '0px solid transparent'}">${['segment','origin','unselected','joined','static'].map(kind => `<span class="styk-settings-node" title="${{segment:'Selected joint',origin:'Figure origin',unselected:'Unselected joint',joined:'Joined joint',static:'Static joint'}[kind]}" style="--node-color:${PIVOT_HANDLE_COLORS[kind]}"></span>`).join('')}</div></div></section>
        <section class="settings-card"><h3>${icon('eye')}Canvas overlays</h3><div class="settings-control-grid">${this.checkbox('Virtual camera','showCamera')}${this.checkbox('Motion paths','motionPaths')}</div></section>
        <section class="settings-card"><h3>${icon('person')}Figure builder</h3><div class="settings-control-grid">${this.checkbox('Static handles','builderShowStaticHandles')}${this.checkbox('Highlight segment','builderHighlightSegment')}${this.checkbox('Construction background','useBuilderCanvasColor')}<label class="styk-settings-row"><span>Background color</span><input type="color" data-setting="builderCanvasColor" value="${value.builderCanvasColor}" aria-label="Construction background color"></label></div></section>
        <section class="settings-card settings-renderer"><label for="settings-renderer">${icon('activity')}Graphics mode</label><select id="settings-renderer" data-setting="rendererMode" aria-label="Graphics mode">${[['auto','Automatic'],['canvas','Canvas 2D'],['gpu','WebGPU']].map(([id,label])=>`<option value="${id}" ${value.rendererMode===id?'selected':''}>${label}</option>`).join('')}</select></section>
      </div>`;
    if (this.tab === "animation")
      html = `<section class="styk-settings-group"><h3>${icon("frame")}Timeline</h3>${this.checkbox("Replace keyframes on drop", "replaceKeyframesOnDrop")}<p class="styk-settings-note">Dragging or Alt-dragging selected keys onto existing keys on the same layer replaces them. Turn off to block occupied destinations.</p></section><section class="styk-settings-group"><h3>${icon("play")}Playback</h3><label class="styk-settings-row"><span>Playback quality</span><select data-setting="playbackQuality" aria-label="Playback quality" aria-describedby="playback-quality-note">${playbackQualityOptions.map(option=>`<option value="${option.id}" ${value.playbackQuality===option.id?'selected':''}>${option.label}</option>`).join('')}</select></label><p id="playback-quality-note" class="styk-settings-note">Lower quality reduces preview resolution for smoother playback. Automatic adjusts it while playing. Editing and exports are unaffected.</p>${this.checkbox("Loop animation", "loopPlayback")}${this.checkbox("Fit view when playback starts", "fitViewOnPlayback")}<p class="styk-settings-note">Turn off to keep your current zoom and pan when starting playback.</p></section><section class="styk-settings-group"><h3>${icon("save")}Recovery</h3><label class="styk-settings-row"><span>Autosave interval</span><select data-setting="autosaveSeconds" aria-label="Autosave interval">${[[0, "Off"], [2.5, "2.5 seconds"], [5, "5 seconds"], [10, "10 seconds"], [30, "30 seconds"], [60, "1 minute"], ...([0, 2.5, 5, 10, 30, 60].includes(value.autosaveSeconds) ? [] : [[value.autosaveSeconds, `${value.autosaveSeconds} seconds`]])].map(([seconds, label]) => `<option value="${seconds}" ${value.autosaveSeconds === seconds ? "selected" : ""}>${label}</option>`).join("")}</select></label></section>`;
    if (this.tab === "shortcuts")
      html = `<section class="styk-settings-group settings-pen-gestures"><h3>${icon("brush")}Pen and tablet</h3><dl>${[
        ["Barrel button", "Context menu · drag a joint to bend"],
        ["Eraser end", "Erase in Draw"],
        ["Space + drag", "Pan"],
        ["Ctrl + Space + drag", "Zoom"],
        ["Shift + Space + drag", "Rotate the Draw view"],
      ].map(([gesture, result]) => `<div><dt>${gesture}</dt><dd>${result}</dd></div>`).join("")}</dl></section>` + this.hotkeySettings.html();
    if (this.tab === 'feedback')
      html = `<div class="settings-feedback-actions">${[['bug','bug','Report a bug'],['idea','lightbulb','Share an idea'],['other','message','Other feedback']].map(([category,symbol,label])=>`<button type="button" data-settings-feedback="${category}"><span class="settings-feedback-icon">${icon(symbol)}</span><span>${label}</span>${icon('chevronRight')}</button>`).join('')}</div>`;
    this.content.innerHTML = `${this.error ? `<div class="styk-settings-error" role="alert">${escape(this.error)}</div>` : ""}${html}`;
    if (this.tab === 'shortcuts') this.hotkeySettings.filter();
  }
  commit(patch) {
    if (patch.builderCanvasColor !== undefined) patch = {...patch,useBuilderCanvasColor:true};
    if (patch.autosaveSeconds !== undefined)
      patch.autosaveSeconds = Number(patch.autosaveSeconds);
    const previous = this.value;
    const next = normalizeEditorSettings({ ...previous, ...patch });
    this.value = next;
    if (patch.uiScale !== undefined) applyUIScale(next.uiScale);
    if (patch.theme !== undefined) applyEditorTheme(next.theme);
    if (patch.locale !== undefined) this.localization.setLocale(next.locale);
    const normalizedPatch = Object.fromEntries(
      Object.keys(patch)
        .filter((key) => key in next)
        .map((key) => [key, next[key]]),
    );
    try {
      Promise.resolve(this.onChange(normalizedPatch, { ...next })).catch(
        (error) => this.showError(error),
      );
    } catch (error) {
      this.value = previous;
      if (patch.uiScale !== undefined) { applyUIScale(previous.uiScale); this.syncScaleControl(); }
      if (patch.theme !== undefined) applyEditorTheme(previous.theme);
      if (patch.locale !== undefined) this.localization.setLocale(previous.locale);
      this.showError(error);
      return;
    }
    this.pending = { ...next };
    this.pendingRevision = (this.pendingRevision || 0) + 1;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 200);
    if (patch.timelineMode !== undefined) this.render();
    if (patch.builderCanvasColor !== undefined) {
      const toggle = this.content.querySelector('[data-setting="useBuilderCanvasColor"]');
      if (toggle) toggle.checked = next.useBuilderCanvasColor;
    }
    if (patch.outlineHandles !== undefined)
      this.content
        .querySelector(".styk-settings-preview")
        ?.style.setProperty(
          "--node-outline",
          next.outlineHandles ? "1px solid #000" : "0px solid transparent",
        );
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return this.chain;
    const snapshot = this.pending,
      revision = this.pendingRevision;
    this.pending = null;
    this.chain = this.chain.then(async () => {
      try {
        await this.onPersist(snapshot);
        this.error = null;
        this.content.querySelector(".styk-settings-error")?.remove();
        return true;
      } catch (error) {
        if (revision === this.pendingRevision && !this.pending)
          this.pending = snapshot;
        this.showError(error);
        return false;
      }
    });
    return this.chain;
  }
  showError(error) {
    this.error = error?.message || String(error);
    if (this.dialog.open) this.render();
  }
  async destroy() {
    await this.flush();
    this.unsubscribeLocale?.();
    this.compactLayout.removeEventListener('change', this.syncTabOrientation);
    this.dialog.remove();
    this.style.remove();
  }
}
