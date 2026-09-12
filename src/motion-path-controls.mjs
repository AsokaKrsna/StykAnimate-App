/** Motion-path options popover for the toolbar toggle. It opens below the
 * button on hover and dismisses as soon as neither is hovered anymore. */
export class MotionPathControls {
  constructor({button, getSettings, getEnabled, onChange, onToggle}) {
    Object.assign(this, {button, getSettings, getEnabled, onChange, onToggle});
    const panel = this.panel = document.createElement('div');
    panel.className = 'onion-popover path-popover';
    panel.id = 'path-popover';
    panel.setAttribute('popover', 'auto');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Motion path settings');
    panel.innerHTML = `<header><strong>Motion paths</strong><button type="button" data-path-toggle></button></header>
<p>See where a node or the camera travels, and fix the pose at any trail point without leaving the current frame.</p>
<label>Window ± frames<input type="number" data-path="motionPathRange" min="0" max="4000" step="1" title="0 shows the whole animation"></label>
<label class="onion-check"><input type="checkbox" data-path="motionPathLabels">Frame numbers</label>
<label class="onion-check"><input type="checkbox" data-path="motionPathAllTargets">Every figure's path</label>
<footer>Drag a trail point to retime its pose · M toggles</footer>`;
    document.body.append(panel);
    button.setAttribute('aria-controls', panel.id);
    button.setAttribute('aria-haspopup', 'dialog');
    let openTimer = 0, closeTimer = 0;
    const open = () => {
      clearTimeout(closeTimer);
      if (!panel.matches(':popover-open')) { this.sync(); panel.showPopover(); }
    };
    const scheduleClose = () => {
      clearTimeout(openTimer);
      closeTimer = setTimeout(() => {
        if (!panel.matches(':hover') && !button.matches(':hover')
            && !panel.contains(document.activeElement) && !button.contains(document.activeElement))
          panel.hidePopover();
      }, 240);
    };
    button.addEventListener('mouseenter', () => { clearTimeout(closeTimer); openTimer = setTimeout(open, 160); });
    button.addEventListener('mouseleave', scheduleClose);
    panel.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    panel.addEventListener('mouseleave', scheduleClose);
    button.addEventListener('focus', open);
    button.addEventListener('blur', scheduleClose);
    panel.addEventListener('toggle', event => {
      if (event.newState === 'open') { this.sync(); this.position(); }
    });
    panel.addEventListener('keydown', event => event.stopPropagation());
    panel.addEventListener('click', event => {
      event.stopPropagation();
      if (event.target.closest('[data-path-toggle]')) { onToggle(); this.sync(); }
    });
    panel.addEventListener('input', event => {
      const input = event.target.closest('[data-path]');
      if (!input) return;
      const value = input.type === 'checkbox' ? input.checked : Number(input.value);
      if (input.type === 'number' && (!input.value || !input.validity.valid)) return;
      this.pending = {...this.pending, [input.dataset.path]: value};
      if (!this.raf) this.raf = requestAnimationFrame(() => {
        this.raf = 0; const patch = this.pending; this.pending = null; onChange(patch); this.sync();
      });
    });
    window.addEventListener('resize', () => { if (panel.matches(':popover-open')) this.position(); });
    this.sync();
  }
  position() {
    const r = this.button.getBoundingClientRect(), panel = this.panel;
    panel.style.left = `${Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, r.left + r.width / 2 - panel.offsetWidth / 2))}px`;
    panel.style.top = `${Math.max(8, Math.min(innerHeight - panel.offsetHeight - 8, r.bottom + 8))}px`;
  }
  sync() {
    const settings = this.getSettings(), enabled = this.getEnabled();
    for (const input of this.panel.querySelectorAll('[data-path]')) {
      if (document.activeElement === input) continue;
      const value = settings[input.dataset.path];
      if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = value;
    }
    const toggle = this.panel.querySelector('[data-path-toggle]');
    toggle.textContent = enabled ? 'On' : 'Off';
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('aria-label', 'Enable motion paths');
  }
}
