import {icon} from './icons.mjs';
import {MOTION_PATH_SPEED_COLORS} from './motion-path.mjs';

/** Explicit display settings; values belong to editor preferences. */
export class MotionPathControls {
  constructor({button, getSettings, getEnabled, onChange, onToggle}) {
    Object.assign(this, {button, getSettings, getEnabled, onChange, onToggle});
    const trigger = this.trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'path-options-button ui-split-more';
    trigger.innerHTML = icon('chevron-down');
    trigger.title = 'Motion path settings';
    trigger.setAttribute('aria-label', 'Motion path settings');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', 'path-popover');
    trigger.setAttribute('aria-expanded', 'false');
    const tool = document.createElement('div');
    tool.className = 'motion-path-tool ui-split';
    tool.setAttribute('role', 'group');
    tool.setAttribute('aria-label', 'Motion paths');
    button.before(tool);
    tool.append(button, trigger);
    const panel = this.panel = document.createElement('div');
    panel.className = 'path-popover ui-popover';
    panel.id = 'path-popover';
    panel.setAttribute('popover', 'auto');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Motion path settings');
    // The kit's popover (features/view-options.css): the title with its on/off switch (a pressed button drawn as
    // the kit's switch); what the trails follow; the frame range with its exact count; then how trails look.
    const choice = (key, label, options) => `<div class="ui-row path-row"><span class="ui-row-label">${label}</span><div class="ui-segmented path-choice" data-size="sm" data-fill role="group" aria-label="${label}">${
      options.map(([value, text, tip]) => `<button type="button" class="ui-segmented-item" data-choice="${key}" data-value="${value}" title="${tip}">${text}</button>`).join('')}</div></div>`;
    const toggle = (key, label, tip, extra = '') => `<label class="ui-switch-row path-row" title="${tip}"><span>${label}${extra}</span><input type="checkbox" class="ui-switch" role="switch" data-path="${key}"></label>`;
    const legend = `<span class="path-speed-legend" aria-hidden="true"><span style="background:linear-gradient(90deg,${MOTION_PATH_SPEED_COLORS.join(',')})"></span>slow → fast</span>`;
    panel.innerHTML = `<header class="ui-popover-head"><strong class="ui-popover-title">${icon('motion-path')}Motion paths</strong><button type="button" class="path-switch" data-path-toggle aria-label="Show motion paths"></button></header>
<div class="ui-popover-body path-body">${choice('motionPathAllTargets', 'Figures', [['false', 'Selected', 'Trails for the selected figures'], ['true', 'All', 'Trails for every figure on the stage']])}
${choice('motionPathJoints', 'Joints', [['selected', 'Selected', 'The selected joint, or each figure’s origin'], ['tips', 'Hands & feet', 'Every limb tip (hands, feet, head) and the origin of each figure']])}
<fieldset class="path-range"><legend>Frame range</legend><div class="path-presets ui-segmented" data-size="sm" data-fill role="group" aria-label="Frame range presets"><button type="button" class="ui-segmented-item" data-range="12">±12</button><button type="button" class="ui-segmented-item" data-range="24">±24</button><button type="button" class="ui-segmented-item" data-range="48">±48</button><button type="button" class="ui-segmented-item" data-range="0">Full</button></div>
<label class="ui-row path-row"><span class="ui-row-label">Around playhead</span><span class="path-number"><input type="number" data-path="motionPathRange" min="0" max="4000" step="1" aria-label="Frames either side of playhead" title="0 shows the full animation"><span>frames</span></span></label></fieldset>
<div class="path-display">${toggle('motionPathLabels', 'Frame numbers', 'Number the keys, the ends and the current frame')}${toggle('motionPathDots', 'In-between dots', 'A dot for every in-between; their spacing shows easing')}${toggle('motionPathSpeed', 'Speed colours', 'Colour trails by speed: cool where motion is slow, warm where it is fast', legend)}${toggle('motionPathRelative', 'Relative to body', 'Keep a travelling figure in place so its limb arcs are easy to compare')}</div></div>`;
    document.body.append(panel);
    const open = () => { this.sync(); panel.showPopover(); this.position(); };
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      if (panel.matches(':popover-open')) panel.hidePopover(); else open();
    });
    button.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); open(); panel.querySelector('button').focus(); }
    });
    panel.addEventListener('toggle', event => trigger.setAttribute('aria-expanded', String(event.newState === 'open')));
    panel.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); panel.hidePopover(); trigger.focus(); }
    });
    panel.addEventListener('click', event => {
      event.stopPropagation();
      if (event.target.closest('[data-path-toggle]')) onToggle();
      const preset = event.target.closest('[data-range]'), picked = event.target.closest('[data-choice]');
      if (preset) onChange({motionPathRange: Number(preset.dataset.range)});
      if (picked) onChange({[picked.dataset.choice]: picked.dataset.choice === 'motionPathAllTargets' ? picked.dataset.value === 'true' : picked.dataset.value});
      if (preset || picked || event.target.closest('[data-path-toggle]')) this.sync();
    });
    panel.addEventListener('change', event => {
      const input = event.target.closest('[data-path]');
      if (!input) return;
      if (input.type === 'number' && (!input.value || !input.validity.valid)) { this.sync(); return; }
      const value = input.type === 'checkbox' ? input.checked : Number(input.value);
      onChange({[input.dataset.path]: value});
      this.sync();
    });
    window.addEventListener('resize', () => { if (panel.matches(':popover-open')) this.position(); });
    this.sync();
  }
  position() {
    const r = this.trigger.getBoundingClientRect(), panel = this.panel;
    panel.style.left = `${Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, r.right - panel.offsetWidth))}px`;
    panel.style.top = `${Math.max(8, Math.min(innerHeight - panel.offsetHeight - 8, r.bottom + 8))}px`;
  }
  sync() {
    const settings = this.getSettings(), enabled = this.getEnabled();
    this.panel.querySelector('.path-number').closest('label').hidden = settings.motionPathRange === 0;
    for (const input of this.panel.querySelectorAll('[data-path]')) {
      const value = settings[input.dataset.path];
      if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = String(value);
    }
    for (const option of this.panel.querySelectorAll('[data-choice]'))
      option.setAttribute('aria-pressed', String(String(settings[option.dataset.choice]) === option.dataset.value));
    for (const preset of this.panel.querySelectorAll('[data-range]')) preset.setAttribute('aria-pressed', String(Number(preset.dataset.range) === settings.motionPathRange));
    const toggle = this.panel.querySelector('[data-path-toggle]');
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.title = enabled ? 'Hide motion paths' : 'Show motion paths';
    this.button.setAttribute('aria-pressed', String(enabled));
    this.button.setAttribute('aria-label', 'Motion paths');
  }
}
