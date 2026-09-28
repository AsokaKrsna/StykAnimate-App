import { icon } from "./icons.mjs";
import { PIVOT_HANDLE_COLORS } from "./canvas-interactions.mjs";
import { Localization, normalizeLocale, SUPPORTED_LOCALES } from "./localization.mjs";
import { DEFAULT_HOTKEYS, normalizeHotkeys } from './hotkeys.mjs';
import { HotkeySettings } from './hotkey-settings.mjs';
import { applyUIScale, autoUIScale, effectiveUIScale, normalizeUIScale, normalizeUIScaleMode, UI_SCALE } from './ui-scale.mjs';
import { applyEditorTheme, normalizeTheme } from './theme.mjs';
import {normalizePlaybackQuality, playbackQualityOptions} from './preview-quality.mjs';
import { normalizeSectionMemory } from './inspector-kit.mjs';
import {normalizeExportPreferences} from './export-request.mjs';
import { sayDialog } from './locales/en-dialogs.mjs';

export const EDITOR_SETTINGS_KEY = "stykanimate.editor.settings.v1";
export const DEFAULT_EDITOR_SETTINGS = Object.freeze({
  locale: "en",
  theme: "system",
  uiScale: 100,
  // Automatic follows the screen (ui-scale.mjs autoUIScale); moving the slider makes it Custom.
  uiScaleMode: "auto",
  hotkeys: DEFAULT_HOTKEYS,
  timelineMode: "advanced",
  replaceKeyframesOnDrop: true,
  showHandles: true,
  showCamera: false,
  showUnselectedHandles: true,
  canvasGrid: false,
  canvasZoomGesture: "ctrl-scroll",
  marqueeSelection: "origins",
  pasteDepth: "same",
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
  motionPathJoints: "selected",
  motionPathSpeed: false,
  motionPathRelative: false,
  motionPathFalloffRadius: 8,
  motionPathFalloffShape: "smooth",
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
  // The inspector's titled sections a person left open, per kind of selection: {figure: {colours: true}}.
  inspectorSections: Object.freeze({}),
  // The export dialog's remembered choices (export-request.mjs); null until the first export.
  exportPreferences: null,
});
export function normalizeEditorSettings(value = {}) {
  const result = { ...DEFAULT_EDITOR_SETTINGS };
  result.locale = normalizeLocale(value?.locale);
  result.theme = normalizeTheme(value?.theme);
  result.uiScale = normalizeUIScale(value?.uiScale);
  result.uiScaleMode = normalizeUIScaleMode(value?.uiScaleMode, value?.uiScale);
  result.hotkeys = normalizeHotkeys(value?.hotkeys);
  result.playbackQuality = normalizePlaybackQuality(value?.playbackQuality);
  if (['scroll', 'ctrl-scroll'].includes(value?.canvasZoomGesture))
    result.canvasZoomGesture = value.canvasZoomGesture;
  if (['bounds', 'origins'].includes(value?.marqueeSelection))
    result.marqueeSelection = value.marqueeSelection;
  if (['same', 'front'].includes(value?.pasteDepth)) result.pasteDepth = value.pasteDepth;
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
    "motionPathSpeed",
    "motionPathRelative",
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
    ["motionPathFalloffRadius", 1, 240],
  ])
    if (Number.isFinite(value?.[key]))
      result[key] = Math.max(min, Math.min(max, value[key]));
  for(const key of ['onionRangeBefore','onionRangeAfter'])
    if(Number.isFinite(value?.[key]))result[key]=Math.max(0,Math.min(10000000,Math.round(value[key])));
  result.onionCount = Math.round(result.onionCount);
  result.motionPathRange = Math.round(result.motionPathRange);
  result.motionPathFalloffRadius = Math.round(result.motionPathFalloffRadius);
  for (const key of ['onionBefore','onionAfter','onionStep']) result[key] = Math.round(result[key]);
  for (const key of ['onionBeforeColor','onionAfterColor'])
    if (typeof value?.[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key])) result[key] = value[key].toLowerCase();
  if (['selected','tips'].includes(value?.motionPathJoints)) result.motionPathJoints = value.motionPathJoints;
  if (['smooth','linear','sharp','flat'].includes(value?.motionPathFalloffShape)) result.motionPathFalloffShape = value.motionPathFalloffShape;
  if (['all','selected'].includes(value?.onionScope)) result.onionScope = value.onionScope;
  if (['keyframes','frames'].includes(value?.onionMode)) result.onionMode = value.onionMode;
  if (['auto','canvas','gpu'].includes(value?.rendererMode)) result.rendererMode = value.rendererMode;
  result.inspectorSections = normalizeSectionMemory(value?.inspectorSections);
  if (value?.exportPreferences && typeof value.exportPreferences === 'object') result.exportPreferences = normalizeExportPreferences(value.exportPreferences);
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

/** The sections of the sidebar: id, glyph and the concept tint of its tile (tokens.css --tint-*). */
const TABS = [
  ["interface", "sliders", "select"],
  ["canvas", "frame", "library"],
  ["animation", "play", "time"],
  ["shortcuts", "keyboard", "camera"],
];
const FEEDBACK_TAB = ["feedback", "message", "draw"];
/** The tabs the sidebar search looks through (Shortcuts has its own search). */
const SEARCH_TABS = ["interface", "canvas", "animation"];
const SYMBOL_URL = new URL("../symbol.svg", import.meta.url).href;
const sliderPercent = (value, min, max) => Math.round(((value - min) / (max - min || 1)) * 1000) / 10;
/** Paints a .ui-slider's fill up to its value (components/slider.css reads --_p). */
const fillSlider = (input) => input.style.setProperty("--_p", `${sliderPercent(Number(input.value), Number(input.min), Number(input.max))}%`);

/** A small editor window, drawn in the light or dark theme's colours (the Theme tiles). */
const MINI_WINDOW = `<svg viewBox="0 0 120 76" aria-hidden="true" focusable="false"><rect class="m-field" width="120" height="76"/><rect class="m-panel" width="120" height="11"/><rect class="m-accent" x="5" y="4" width="4" height="4" rx="1"/><rect class="m-panel" x="5" y="16" width="10" height="55" rx="3"/><rect class="m-stage" x="20" y="16" width="68" height="55" rx="3"/><rect class="m-panel" x="93" y="16" width="22" height="55" rx="3"/><rect class="m-line" x="97" y="21" width="14" height="3" rx="1.5"/><rect class="m-line" x="97" y="28" width="10" height="3" rx="1.5"/><circle class="m-figure" cx="54" cy="29" r="4"/><path class="m-limb" d="M54 33v13m0 0-7 12m7-12 7 12M54 37l-8 5m8-5 8-5"/></svg>`;
const themeArt = (theme) =>
  theme === "system"
    ? `<span class="styk-settings-mini" data-mini="light">${MINI_WINDOW}</span><span class="styk-settings-mini" data-mini="dark" data-half>${MINI_WINDOW}</span>`
    : `<span class="styk-settings-mini" data-mini="${theme}">${MINI_WINDOW}</span>`;

/** Three layer rows with keys and a playhead (Advanced), or a strip of poses (Simple). */
const TIMELINE_ART = {
  advanced: `<svg viewBox="0 0 160 64" aria-hidden="true" focusable="false">${[6, 25, 44]
    .map(
      (y, row) =>
        `<rect class="t-track" x="0" y="${y}" width="160" height="14" rx="4"/>${[
          [18, 62, 118],
          [30, 92, 140],
          [18, 78],
        ][row]
          .map((x) => `<path class="t-key" d="M${x} ${y + 2}l5 5-5 5-5-5z"/>`)
          .join("")}`,
    )
    .join("")}<path class="t-head" d="M70 2v60"/><rect class="t-head-cap" x="66" y="0" width="8" height="5" rx="1.5"/></svg>`,
  simple: `<svg viewBox="0 0 160 64" aria-hidden="true" focusable="false">${[
    "M17 27l-6 10m6-10 6 10M17 19l-7 3m7-3 7-3",
    "M17 27l-8 8m8-8 3 11M17 19l-8-2m8 2 7 4",
    "M17 27l-2 11m2-11 8 7M17 19l-6 6m6-6 5-7",
    "M17 27l-6 10m6-10 6 10M17 19l-7-5m7 5 7-5",
  ]
    .map(
      (limbs, index) =>
        `<g transform="translate(${4 + index * 39} 8)"><rect class="t-frame${index === 1 ? " is-current" : ""}" width="34" height="48" rx="5"/><circle class="t-figure" cx="17" cy="12" r="3.2"/><path class="t-limb" d="M17 15v12${limbs}"/></g>`,
    )
    .join("")}</svg>`,
};

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
    this.appliedScale = applyUIScale(effectiveUIScale(this.value));
    // Automatic follows the screen: a window moved to another display takes that display's scale.
    window.addEventListener('resize', () => this.followScreen());
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
    this.query = "";
    this.chain = Promise.resolve();
    this.pending = null;
    this.timer = null;
    this.error = null;
    this.tabs = onFeedback ? [...TABS, FEEDBACK_TAB] : TABS;
    this.dialog = document.createElement("dialog");
    this.dialog.className = "styk-settings";
    this.dialog.setAttribute("aria-label", this.t("settings.editorLabel"));
    this.dialog.innerHTML = `<header class="styk-settings-head"><img class="styk-settings-mark" src="${SYMBOL_URL}" alt=""><h2>${escape(this.t("settings.title"))}</h2><label class="styk-settings-search">${icon("search")}<input type="search" data-settings-search autocomplete="off" spellcheck="false"></label><button type="button" class="styk-settings-close" aria-label="${escape(this.t("settings.close"))}">${icon("x")}</button></header><div class="styk-settings-layout"><aside class="styk-settings-sidebar"><nav class="styk-settings-tabs" role="tablist" aria-orientation="vertical" aria-label="${escape(this.t("settings.sections"))}">${this.tabs
      .map(
        ([id, symbol, tint]) =>
          `<button type="button" role="tab" id="styk-settings-tab-${id}" data-tab="${id}" aria-controls="styk-settings-content"><span class="styk-settings-tab-icon" data-tint="${tint}">${icon(symbol)}</span><span data-settings-tab-label>${escape(this.t('settings.' + id))}</span></button>`,
      )
      .join("")}</nav><div class="styk-settings-actions"></div></aside><section id="styk-settings-content" class="styk-settings-content" role="tabpanel"></section></div>`;
    document.body.append(this.dialog);
    this.content = this.dialog.querySelector(".styk-settings-content");
    this.search = this.dialog.querySelector("[data-settings-search]");
    this.labelSearch();
    this.compactLayout = window.matchMedia('(max-width:620px)');
    this.syncTabOrientation = () => this.dialog.querySelector('[role=tablist]').setAttribute('aria-orientation', this.compactLayout.matches ? 'horizontal' : 'vertical');
    this.compactLayout.addEventListener('change', this.syncTabOrientation);
    this.syncTabOrientation();
    this.hotkeySettings = new HotkeySettings(this);
    const actions = this.dialog.querySelector('.styk-settings-actions');
    if (onPrivacy) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'styk-settings-privacy'; button.dataset.settingsPrivacy = '';
      button.innerHTML = `${icon('lock')}<span>${escape(this.say('settings.privacy'))}</span>`;
      button.title = this.say('settings.privacy'); button.setAttribute('aria-label', button.title);
      button.onclick = () => { this.close(); void this.onPrivacy(); };
      actions.append(button);
    }
    if (onDonate) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'styk-settings-donate'; button.dataset.settingsDonate = '';
      button.innerHTML = `<span class="styk-settings-donate-badge">${icon('heart')}</span><span class="styk-settings-donate-text"><strong>${escape(this.t('settings.donate'))}</strong><small>${escape(this.say('settings.donateNote'))}</small></span>${icon('externalLink')}`;
      button.setAttribute('aria-label', this.t('settings.donate'));
      button.onclick = () => Promise.resolve().then(() => this.onDonate()).catch(error => this.showError(error));
      actions.append(button);
    }
    this.unsubscribeLocale = this.localization.subscribe(() => this.refreshLanguage());
    this.dialog.querySelector(".styk-settings-close").onclick = () =>
      this.close();
    this.dialog.addEventListener("close", () => void this.flush());
    this.dialog.addEventListener("keydown", (event) => {
      event.stopPropagation();
      // Escape in the search clears it first; the next one closes Settings.
      if (event.key === "Escape" && event.target === this.search && this.search.value) {
        event.preventDefault();
        this.setQuery("");
        return;
      }
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
      if (feedback) { this.close(); this.onFeedback?.(feedback.dataset.settingsFeedback === 'inbox' ? {view: 'inbox'} : {category: feedback.dataset.settingsFeedback}); }
      if (event.target.closest("[data-scale-reset]")) {
        this.commit({uiScaleMode: 'auto', uiScale: 100});
        this.syncScaleControl();
      }
      const mode = event.target.closest("[data-scale-mode]");
      if (mode) {
        // Custom starts from the scale shown now, so choosing it changes nothing until the slider moves.
        this.commit(mode.dataset.scaleMode === 'auto' ? {uiScaleMode: 'auto'} : {uiScaleMode: 'manual', uiScale: effectiveUIScale(this.value)});
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
      if (event.target === this.search) {
        this.setQuery(this.search.value);
        return;
      }
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
        fillSlider(event.target);
      }
    });
  }
  t(key, params) { return this.localization.t(key, params); }
  /** Dialog words that not every catalog has yet: the localization's text, else English (en-dialogs.mjs). */
  say(key, params) { return sayDialog((name, values) => this.t(name, values), key, params); }
  labelSearch() {
    const label = this.say('settings.search');
    this.search.placeholder = `${label}…`;
    this.search.setAttribute('aria-label', label);
  }
  refreshLanguage() {
    this.value.locale = this.localization.locale;
    this.dialog.lang = this.localization.locale;
    this.dialog.setAttribute('aria-label', this.t('settings.editorLabel'));
    this.dialog.querySelector('.styk-settings-head h2').textContent = this.t('settings.title');
    this.dialog.querySelector('.styk-settings-close').setAttribute('aria-label', this.t('settings.close'));
    this.dialog.querySelector('[role=tablist]').setAttribute('aria-label', this.t('settings.sections'));
    this.labelSearch();
    for (const button of this.dialog.querySelectorAll('[data-tab]'))
      button.querySelector('[data-settings-tab-label]').textContent = this.t('settings.' + button.dataset.tab);
    const privacy = this.dialog.querySelector('[data-settings-privacy]');
    if (privacy) {
      privacy.querySelector('span').textContent = privacy.title = this.say('settings.privacy');
      privacy.setAttribute('aria-label', privacy.title);
    }
    const donate = this.dialog.querySelector('[data-settings-donate]');
    if (donate) {
      donate.querySelector('strong').textContent = this.t('settings.donate');
      donate.setAttribute('aria-label', this.t('settings.donate'));
      donate.querySelector('small').textContent = this.say('settings.donateNote');
    }
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
  /** Automatic's scale for the window's current screen, applied only when it changes. */
  followScreen() {
    if (this.value.uiScaleMode !== 'auto') return;
    const next = effectiveUIScale(this.value);
    if (next !== this.appliedScale) { this.appliedScale = applyUIScale(next); this.syncScaleControl(); }
  }
  setValue(value) {
    this.value = normalizeEditorSettings(value);
    applyEditorTheme(this.value.theme);
    this.appliedScale = applyUIScale(effectiveUIScale(this.value));
    const changed = this.localization.setLocale(this.value.locale);
    if (!changed && this.dialog.open) this.render();
  }
  /** Opens Settings on `tab`; with `setting`, focused on that field (the command palette's Settings rows). */
  open(tab = this.tab, {setting} = {}) {
    if (this.getValue) this.value = normalizeEditorSettings(this.getValue());
    applyEditorTheme(this.value.theme);
    this.appliedScale = applyUIScale(effectiveUIScale(this.value));
    this.localization.setLocale(this.value.locale);
    this.dialog.lang = this.localization.locale;
    this.selectTab(tab);
    if (!this.dialog.open) this.dialog.showModal();
    const field = setting && (this.content.querySelector(`[data-setting="${setting}"]:checked`) ?? this.content.querySelector(`[data-setting="${setting}"]`));
    if (field) { field.focus(); field.scrollIntoView?.({block: 'nearest'}); }
    else this.dialog.querySelector(`[data-tab="${this.tab}"]`).focus();
  }
  close() {
    this.dialog.close();
    void this.flush();
  }
  selectTab(tab) {
    this.tab = this.tabs.some(([id]) => id === tab) ? tab : "interface";
    this.query = "";
    this.search.value = "";
    this.dialog.removeAttribute("data-searching");
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
  /** Searches Interface, Canvas and Animation together; an empty query shows the selected tab again. */
  setQuery(query) {
    this.query = query;
    if (this.search.value !== query) this.search.value = query;
    this.hotkeySettings.cancel();
    this.dialog.toggleAttribute("data-searching", Boolean(query.trim()));
    this.render();
    this.content.scrollTop = 0;
  }

  /* ---- Row builders: one pattern in every tab ---- */

  /** A setting's words: its label and, below it, an optional hint. */
  text(label, hint, hintId) {
    return `<span class="styk-settings-text"><span class="styk-settings-label">${escape(label)}</span>${hint ? `<small class="styk-settings-hint"${hintId ? ` id="${hintId}"` : ""}>${escape(hint)}</small>` : ""}</span>`;
  }
  checkbox(label, key, hint) {
    return `<label class="styk-settings-row">${this.text(label, hint)}<input type="checkbox" role="switch" class="ui-switch" data-setting="${key}" aria-label="${escape(label)}" ${this.value[key] ? "checked" : ""}></label>`;
  }
  select(label, key, options, hint) {
    const hintId = hint ? `styk-settings-hint-${key}` : "";
    return `<label class="styk-settings-row">${this.text(label, hint, hintId)}<span class="ui-select" data-size="sm"><select data-setting="${key}" aria-label="${escape(label)}"${hintId ? ` aria-describedby="${hintId}"` : ""}>${options.map(([id, name]) => `<option value="${escape(id)}" ${String(this.value[key]) === String(id) ? "selected" : ""}>${escape(name)}</option>`).join("")}</select>${icon("chevronDown")}</span></label>`;
  }
  /** A titled card of rows. */
  group(title, rows, className = "") {
    return `<section class="styk-settings-group${className ? " " + className : ""}"><h4>${escape(title)}</h4><div class="styk-settings-card">${rows}</div></section>`;
  }
  page(tab) {
    return `<header class="styk-settings-page"><h3>${escape(this.t("settings." + tab))}</h3><p>${escape(this.say(`settings.${tab}Lede`))}</p></header>`;
  }
  syncScaleControl() {
    const input = this.content.querySelector('[data-setting="uiScale"]');
    if (!input) return;
    const shown = effectiveUIScale(this.value), auto = this.value.uiScaleMode === 'auto';
    input.value = shown;
    input.setAttribute('aria-valuetext', `${shown}%`);
    fillSlider(input);
    this.content.querySelector('[data-scale-value]').value = `${shown}%`;
    this.content.querySelector('[data-scale-reset]').disabled = auto || !window.stykDesktop?.setUIScale;
    for (const button of this.content.querySelectorAll('[data-scale-mode]'))
      button.setAttribute('aria-pressed', String((button.dataset.scaleMode === 'auto') === auto));
    const note = this.content.querySelector('[data-scale-auto-note]');
    if (note) { note.hidden = !auto; note.textContent = this.t('settings.autoScaleNote').replace('{scale}', `${autoUIScale()}%`); }
  }
  /**
   * UI scale: Automatic (the screen's size picks 100–150%) or Custom (the slider, 75–200%). The slider shows the
   * scale in use and moving it makes the scale Custom; Reset returns to Automatic.
   */
  scaleControl() {
    const available = typeof window.stykDesktop?.setUIScale === 'function';
    const shown = effectiveUIScale(this.value), auto = this.value.uiScaleMode === 'auto';
    const mode = (value, label) => `<button type="button" class="ui-segmented-item" data-scale-mode="${value}" aria-pressed="${(value === 'auto') === auto}" ${available ? '' : 'disabled'}>${escape(label)}</button>`;
    const note = available
      ? `<small class="styk-settings-hint" data-scale-auto-note ${auto ? '' : 'hidden'}>${escape(this.t('settings.autoScaleNote').replace('{scale}', `${autoUIScale()}%`))}</small>`
      : `<small class="styk-settings-hint">${escape(this.t('settings.browserScale'))}</small>`;
    return `<div class="styk-settings-row styk-settings-scale"><span class="styk-settings-text"><label class="styk-settings-label" for="styk-ui-scale">${escape(this.t('settings.uiScale'))}</label>${note}</span><div class="ui-segmented" data-size="sm" role="group" aria-label="${escape(this.t('settings.uiScale'))}">${mode('auto', this.t('settings.autoScale'))}${mode('manual', this.t('settings.customScale'))}</div><div class="styk-settings-slider"><input id="styk-ui-scale" class="ui-slider" type="range" data-setting="uiScale" min="${UI_SCALE.min}" max="${UI_SCALE.max}" step="${UI_SCALE.step}" value="${shown}" aria-valuetext="${shown}%" style="--_p:${sliderPercent(shown, UI_SCALE.min, UI_SCALE.max)}%" ${available ? '' : 'disabled'}><output for="styk-ui-scale" data-scale-value>${shown}%</output><button type="button" class="styk-settings-icon-button" data-scale-reset title="${escape(this.t('settings.resetScale'))}" aria-label="${escape(this.t('settings.resetScale'))}" ${auto || !available ? 'disabled' : ''}>${icon('undo')}</button></div></div>`;
  }
  render() {
    const html = this.query.trim() ? this.resultsHTML(this.query) : this.page(this.tab) + this.tabHTML(this.tab);
    this.content.innerHTML = `${this.error ? `<div class="styk-settings-error" role="alert">${icon('alert')}<span>${escape(this.error)}</span></div>` : ""}${html}`;
    if (!this.query.trim() && this.tab === 'shortcuts') this.hotkeySettings.filter();
  }
  /**
   * Every searchable tab at once, keeping only the rows whose words match `query` (a section's title matches all
   * of its rows). The rows are the tabs' own markup, so they change settings exactly as in their tab.
   */
  resultsHTML(query) {
    const needle = query.trim().toLocaleLowerCase(), template = document.createElement('template');
    const words = node => node.textContent.replace(/\s+/g, ' ').toLocaleLowerCase();
    template.innerHTML = SEARCH_TABS.map(tab => `<div class="styk-settings-results" data-results-tab="${tab}"><p class="styk-settings-eyebrow">${escape(this.t('settings.' + tab))}</p>${this.tabHTML(tab)}</div>`).join('');
    for (const group of template.content.querySelectorAll('.styk-settings-group')) {
      if (words(group.querySelector('h4')).includes(needle)) continue;
      for (const row of group.querySelectorAll('.styk-settings-card > *'))
        if (!words(row).includes(needle)) row.remove();
      if (!group.querySelector('.styk-settings-card > *')) group.remove();
    }
    for (const tab of template.content.querySelectorAll('[data-results-tab]'))
      if (!tab.querySelector('.styk-settings-group')) tab.remove();
    const found = template.content.querySelector('.styk-settings-group');
    const heading = `<header class="styk-settings-page"><h3>${escape(this.say('settings.searchResults', {query: query.trim()}))}</h3></header>`;
    if (!found) return `${heading}<div class="styk-settings-empty">${icon('search')}<p>${escape(this.say('settings.noResults', {query: query.trim()}))}</p></div>`;
    const holder = document.createElement('div'); holder.append(template.content);
    return heading + holder.innerHTML;
  }
  /** The markup of one tab's sections (render() adds its title). */
  tabHTML(tab) {
    const value = this.value, say = (key, params) => this.say(key, params);
    if (tab === "interface") {
      const themes = `<div class="styk-settings-row styk-settings-block"><span class="styk-settings-label">${escape(this.t('settings.theme'))}</span><div class="styk-settings-tiles" data-columns="3" role="radiogroup" aria-label="${escape(this.t('settings.theme'))}">${['system', 'light', 'dark'].map(theme => `<label class="styk-settings-tile"><input type="radio" name="editor-theme" data-setting="theme" value="${theme}" ${value.theme === theme ? 'checked' : ''}><span class="styk-settings-art styk-settings-theme-art">${themeArt(theme)}</span><span class="styk-settings-tile-name">${escape(this.t('settings.' + theme))}</span></label>`).join('')}</div></div>`;
      const language = this.select(this.t('settings.language'), 'locale', SUPPORTED_LOCALES.map(locale => [locale.id, locale.nativeName]));
      const coverage = value.locale !== 'en' ? `<p class="styk-settings-note">${icon('alert')}<span data-locale-coverage>${escape(this.t('settings.partialLanguage'))}</span></p>` : '';
      const timeline = `<div class="styk-settings-row styk-settings-block"><div class="styk-settings-tiles" data-columns="2" role="radiogroup" aria-label="${escape(this.t('settings.timelineMode'))}">${[
        ["advanced", this.t("timeline.advanced"), this.t("settings.advancedDescription")],
        ["simple", this.t("timeline.simple"), this.t("settings.simpleDescription")],
      ].map(([id, label, description]) => `<label class="styk-settings-tile styk-settings-mode"><input type="radio" name="timeline-mode" data-setting="timelineMode" value="${id}" ${value.timelineMode === id ? "checked" : ""}><span class="styk-settings-art styk-settings-timeline-art" data-art="${id}">${TIMELINE_ART[id]}</span><strong class="styk-settings-tile-name">${escape(label)}</strong><small class="styk-settings-hint">${escape(description)}</small></label>`).join("")}</div></div>`;
      const workspace = this.onResetWorkspace
        ? this.group(this.t('settings.workspace'), `<div class="styk-settings-row">${this.text(say('settings.panelLayouts'), say('settings.panelLayoutsNote'))}<button type="button" class="ui-button" data-size="sm" data-settings-reset>${icon("undo")}${escape(this.t('settings.resetPanels'))}</button></div>`)
        : "";
      return this.group(this.t("settings.appearance"), themes + language + coverage + this.scaleControl())
        + this.group(this.t('timeline.title'), timeline)
        + workspace;
    }
    if (tab === "canvas") {
      const nodes = ['segment', 'origin', 'unselected', 'joined', 'static'];
      const handleSize = `<div class="styk-settings-row styk-settings-block"><span class="styk-settings-handle-head">${this.text(say('settings.handleRadius'))}<span class="styk-settings-slider"><input type="range" class="ui-slider" data-setting="handleSize" min="3" max="10" step="1" value="${value.handleSize}" aria-label="${escape(say('settings.handleRadius'))}" style="--_p:${sliderPercent(value.handleSize, 3, 10)}%"><output data-handle-value>${value.handleSize}px</output></span></span><div class="styk-settings-preview" role="img" aria-label="${escape(say('settings.handlePreview'))}" style="--size:${value.handleSize};--node-outline:${value.outlineHandles ? '1px solid #000' : '0px solid transparent'}">${nodes.map(kind => `<span class="styk-settings-node-cell"><span class="styk-settings-node" style="--node-color:${PIVOT_HANDLE_COLORS[kind]}"></span><small>${escape(say('settings.handle.' + kind))}</small></span>`).join('')}</div></div>`;
      return this.group(say('settings.navigation'),
          this.select(say('settings.zoomGesture'), 'canvasZoomGesture', [['ctrl-scroll', say('settings.zoomCtrlScroll')], ['scroll', say('settings.zoomScroll')]])
          + this.select(say('settings.boxSelection'), 'marqueeSelection', [['bounds', say('settings.boxBounds')], ['origins', say('settings.boxOrigins')]]))
        + this.group('Pasting', this.select('Pasted figure depth', 'pasteDepth', [['same', 'Same Z-index (default)'], ['front', 'In front']], 'Choose whether pasted figures keep their copied depth or appear in front of other figures on the destination layer.'))
        + this.group(say('settings.jointHandles'),
          this.checkbox(say('settings.showHandles'), 'showHandles')
          + this.checkbox(say('settings.showUnselected'), 'showUnselectedHandles')
          + this.checkbox(say('settings.autoSize'), 'autoSizeHandles')
          + this.checkbox(say('settings.outline'), 'outlineHandles')
          + handleSize)
        + this.group(say('settings.overlays'),
          this.checkbox(say('settings.virtualCamera'), 'showCamera')
          + this.checkbox(say('settings.motionPaths'), 'motionPaths'))
        + this.group(say('settings.builder'),
          this.checkbox(say('settings.staticHandles'), 'builderShowStaticHandles')
          + this.checkbox(say('settings.highlightSegment'), 'builderHighlightSegment')
          + this.checkbox(say('settings.construction'), 'useBuilderCanvasColor')
          + `<label class="styk-settings-row">${this.text(say('settings.constructionColorShort'))}<span class="styk-settings-color"><input type="color" data-setting="builderCanvasColor" value="${value.builderCanvasColor}" aria-label="${escape(say('settings.constructionColor'))}"></span></label>`)
        + this.group(say('settings.graphics'),
          this.select(say('settings.graphicsMode'), 'rendererMode', [['auto', say('settings.graphicsAuto')], ['canvas', 'Canvas 2D'], ['gpu', 'WebGPU']]));
    }
    if (tab === "animation") {
      const presets = [0, 2.5, 5, 10, 30, 60];
      const autosave = [[0, say('settings.autosaveOff')], ...presets.slice(1, -1).map(seconds => [seconds, say('settings.seconds', {count: seconds})]), [60, say('settings.minute')],
        ...(presets.includes(value.autosaveSeconds) ? [] : [[value.autosaveSeconds, say('settings.seconds', {count: value.autosaveSeconds})]])];
      return this.group(say('settings.keyframes'), this.checkbox(say('settings.replaceOnDrop'), 'replaceKeyframesOnDrop', say('settings.replaceOnDropNote')))
        + this.group(say('settings.playback'),
          this.select(say('settings.playbackQuality'), 'playbackQuality', playbackQualityOptions.map(option => [option.id, option.label]), say('settings.playbackQualityNote'))
          + this.checkbox(say('settings.loop'), 'loopPlayback')
          + this.checkbox(say('settings.fitView'), 'fitViewOnPlayback', say('settings.fitViewNote')))
        + this.group(say('settings.recovery'), this.select(say('settings.autosaveInterval'), 'autosaveSeconds', autosave, say('settings.autosaveNote')));
    }
    if (tab === "shortcuts")
      return this.hotkeySettings.html() + this.group(say('settings.gestures'), `<dl class="styk-settings-gestures">${[
        ['barrel', 'barrelResult'],
        ['eraserEnd', 'eraserEndResult'],
        ['spaceDrag', 'spaceDragResult'],
        ['ctrlSpaceDrag', 'ctrlSpaceDragResult'],
        ['shiftSpaceDrag', 'shiftSpaceDragResult'],
      ].map(([gesture, result]) => `<div class="styk-settings-row"><dt>${escape(say('settings.gesture.' + gesture))}</dt><dd>${escape(say('settings.gesture.' + result))}</dd></div>`).join("")}</dl>`, 'settings-pen-gestures');
    if (tab === 'feedback')
      return `<div class="settings-feedback-actions">${[
        ['bug', 'bug', 'draw'],
        ['idea', 'lightbulb', 'time'],
        ['other', 'message', 'select'],
      ].map(([category, symbol, tint]) => `<button type="button" class="settings-feedback-tile" data-settings-feedback="${category}" data-tint="${tint}"><span class="settings-feedback-art"><span class="settings-feedback-icon">${icon(symbol)}</span></span><span class="settings-feedback-body"><strong>${escape(say('settings.feedback.' + category))}</strong><small>${escape(say(`settings.feedback.${category}Note`))}</small><span class="settings-feedback-go">${escape(say('settings.feedback.start'))}${icon('chevronRight')}</span></span></button>`).join('')}</div>`
        + `<div class="styk-settings-card settings-feedback-private"><span class="settings-feedback-lock">${icon('lock')}</span>${this.text(say('settings.feedback.private'), say('settings.feedback.privateNote'))}<button type="button" class="ui-button" data-size="sm" data-settings-feedback="inbox">${escape(say('settings.feedback.myReports'))}</button></div>`;
    return "";
  }
  /**
   * Every setting's name and tab, for the command palette:
   * [{tab, tabLabel, setting, label}], one per data-setting (a radio group is one).
   */
  searchIndex() {
    const entries = [], seen = new Set(), template = document.createElement('template');
    const text = node => node?.textContent?.replace(/\s+/g, ' ').trim() || '';
    for (const tab of SEARCH_TABS) {
      template.innerHTML = this.tabHTML(tab);
      for (const field of template.content.querySelectorAll('[data-setting]')) {
        const setting = field.dataset.setting;
        if (seen.has(setting)) continue;
        seen.add(setting);
        const label = field.getAttribute('aria-label') || field.closest('[role=radiogroup]')?.getAttribute('aria-label')
          || (field.id && text(template.content.querySelector(`label[for="${field.id}"]`)))
          || text(field.closest('.styk-settings-row')?.querySelector('.styk-settings-label'));
        if (label) entries.push({tab, tabLabel: this.t('settings.' + tab), setting, label});
      }
    }
    return entries;
  }
  commit(patch) {
    if (patch.builderCanvasColor !== undefined) patch = {...patch,useBuilderCanvasColor:true};
    // Moving the slider chooses a Custom scale.
    if (patch.uiScale !== undefined && patch.uiScaleMode === undefined) patch = {...patch, uiScaleMode: 'manual'};
    if (patch.autosaveSeconds !== undefined)
      patch.autosaveSeconds = Number(patch.autosaveSeconds);
    const previous = this.value;
    const next = normalizeEditorSettings({ ...previous, ...patch });
    this.value = next;
    if (patch.uiScale !== undefined || patch.uiScaleMode !== undefined) this.appliedScale = applyUIScale(effectiveUIScale(next));
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
      if (patch.uiScale !== undefined || patch.uiScaleMode !== undefined) { this.appliedScale = applyUIScale(effectiveUIScale(previous)); this.syncScaleControl(); }
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
  }
}
