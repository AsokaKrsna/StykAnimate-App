import {icon} from './icons.mjs';

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
    panel.className = 'path-popover';
    panel.id = 'path-popover';
    panel.setAttribute('popover', 'auto');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Motion path settings');
    panel.innerHTML = `<header><strong>Motion paths</strong><button type="button" data-path-toggle aria-label="Show motion paths"></button></header>
<label class="path-row"><span>Show</span><select data-path="motionPathAllTargets" aria-label="Path targets"><option value="false">Selected figures</option><option value="true">All figures</option></select></label>
<fieldset><legend>Frame range</legend><div class="path-presets" role="group" aria-label="Frame range presets"><button type="button" data-range="12">±12</button><button type="button" data-range="24">±24</button><button type="button" data-range="48">±48</button><button type="button" data-range="0">Full</button></div>
<label class="path-row"><span>Around playhead</span><span class="path-number"><input type="number" data-path="motionPathRange" min="0" max="4000" step="1" aria-label="Frames either side of playhead" title="0 shows the full animation"><span>frames</span></span></label></fieldset>
<div class="path-display"><label class="path-row"><span>Frame numbers</span><input type="checkbox" data-path="motionPathLabels"></label><label class="path-row"><span>In-between dots</span><input type="checkbox" data-path="motionPathDots"></label></div>`;
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
      const preset = event.target.closest('[data-range]');
      if (preset) onChange({motionPathRange: Number(preset.dataset.range)});
      if (preset || event.target.closest('[data-path-toggle]')) this.sync();
    });
    panel.addEventListener('change', event => {
      const input = event.target.closest('[data-path]');
      if (!input) return;
      if (input.type === 'number' && (!input.value || !input.validity.valid)) { this.sync(); return; }
      const value = input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' ? input.value === 'true' : Number(input.value);
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
      if (input.type === 'checkbox') input.checked = value !== false; else input.value = String(value);
    }
    for (const preset of this.panel.querySelectorAll('[data-range]')) preset.setAttribute('aria-pressed', String(Number(preset.dataset.range) === settings.motionPathRange));
    const toggle = this.panel.querySelector('[data-path-toggle]');
    toggle.textContent = enabled ? 'On' : 'Off';
    toggle.setAttribute('aria-pressed', String(enabled));
    this.button.setAttribute('aria-pressed', String(enabled));
    this.button.setAttribute('aria-label', 'Motion paths');
  }
}
