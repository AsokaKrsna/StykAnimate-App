import { HOTKEY_COMMANDS, HOTKEY_BY_ID, HOTKEY_SCOPES, DEFAULT_HOTKEYS, eventBinding, formatBinding, findHotkeyConflicts } from './hotkeys.mjs';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

/** Shortcut editor owns only its draft and focus; EditorSettings owns persistence. */
export class HotkeySettings {
  constructor(settings) {
    this.settings = settings; this.query = ''; this.recording = null; this.conflict = null; this.message = '';
    settings.dialog.addEventListener('keydown', event => this.keydown(event), true);
    settings.dialog.addEventListener('close', () => this.cancel());
    settings.dialog.addEventListener('click', event => this.click(event));
    settings.dialog.addEventListener('input', event => {
      if (!event.target.matches('[data-hotkey-search]')) return;
      this.query = event.target.value;
      this.filter();
    });
    settings.dialog.addEventListener('focusout', event => {
      if (this.recording && event.target.matches('[data-hotkey-record]')) this.cancel();
    });
    const style = document.createElement('style');
    style.textContent = `
      .hotkey-toolbar{position:sticky;top:0;z-index:2;background:var(--theme-panel, white);display:flex;gap:8px;align-items:center;margin-bottom:12px;padding:4px 0}.hotkey-toolbar input{min-width:0;flex:1;height:30px;padding:0 8px;border:1px solid var(--theme-border, #ddd);border-radius:4px;font:inherit}
      .hotkey-row{display:grid;grid-template-columns:minmax(110px,1fr) minmax(130px,1fr);gap:9px;padding:10px 0;border-bottom:1px solid var(--theme-border, #eee);align-items:center;font-size:11px}.hotkey-row small{display:block;font-size:10px;color:var(--theme-muted, #767676);margin-top:4px}
      .hotkey-bindings{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:4px}.hotkey-binding{display:inline-flex;border:1px solid var(--theme-border, #ddd);border-radius:4px;overflow:hidden}.hotkey-binding button{min-height:27px;padding:3px 6px;font-size:10px}.hotkey-binding button+button{border-left:1px solid var(--theme-border, #ddd);color:var(--theme-muted, #777)}.hotkey-bindings>button{padding:4px;color:var(--theme-secondary, #666);font-size:10px}
      [data-hotkey-record][aria-pressed=true]{background:var(--theme-selected, #e5f4ff);color:var(--theme-accent, #007be5);outline:2px solid var(--theme-accent, #0d99ff);outline-offset:-2px}.hotkey-status{font-size:11px;line-height:1.5;margin:10px 0;color:var(--theme-secondary, #555)}.hotkey-conflict{padding:10px;border:1px solid var(--theme-danger, #f0cb83);background:var(--theme-field, #fff8e8);border-radius:5px}.hotkey-conflict button{padding:6px 8px;border:1px solid var(--theme-border, #ddd);border-radius:4px;margin:6px 6px 0 0;background:var(--theme-panel, white)}.hotkey-row[hidden],.hotkey-group[hidden]{display:none}
    `;
    settings.style.append(style.textContent);
  }
  cancel() {
    this.recording = null;
    for (const button of this.settings.content.querySelectorAll('[data-hotkey-record][aria-pressed=true]')) {
      button.setAttribute('aria-pressed', 'false'); button.textContent = button.dataset.label;
    }
  }
  html() {
    this.recording = null;
    const bindings = this.settings.value.hotkeys;
    return `<div class="hotkey-toolbar"><input type="search" data-hotkey-search aria-label="Search shortcuts" placeholder="Search shortcuts…" value="${escape(this.query)}"><button type="button" class="styk-settings-reset" data-hotkey-reset-all>Reset all</button></div>
      <p class="styk-settings-note">Click a key to change it, or + to add an alternative. Changes apply immediately and are saved automatically. Context shortcuts override editor shortcuts. Shift remains available for range selection and alignment. Keys use physical keyboard positions. Escape cancels recording; Tab moves focus.</p>
      <div class="hotkey-status" role="status" aria-live="polite">${escape(this.message)}</div>
      ${this.conflict ? `<div class="hotkey-conflict" role="alert">${escape(this.conflict.message)}<div><button type="button" data-hotkey-replace>Replace conflicting shortcuts</button><button type="button" data-hotkey-cancel>Cancel</button></div></div>` : ''}
      ${[...new Set(HOTKEY_COMMANDS.map(c => c.category))].map(category => `<section class="styk-settings-group hotkey-group"><h3>${escape(category)}</h3><div class="styk-settings-shortcuts-list">${HOTKEY_COMMANDS.filter(c => c.category === category).map(command => {
        const keys = bindings[command.id];
        return `<div class="hotkey-row" data-hotkey-id="${command.id}" data-search="${escape(`${command.label} ${category} ${HOTKEY_SCOPES[command.scope]} ${keys.map(k => formatBinding(k)).join(' ')}`.toLowerCase())}"><div>${escape(command.label)}<small>${HOTKEY_SCOPES[command.scope]}</small></div><div class="hotkey-bindings">${keys.map((key, index) => `<span class="hotkey-binding"><button type="button" data-hotkey-record="${index}" data-label="${escape(formatBinding(key))}" aria-pressed="false" aria-label="Change ${escape(command.label)}: ${escape(formatBinding(key))}">${escape(formatBinding(key))}</button><button type="button" data-hotkey-remove="${index}" aria-label="Remove ${escape(command.label)}: ${escape(formatBinding(key))}">×</button></span>`).join('')}${!keys.length ? '<small>Unassigned</small>' : ''}${keys.length < 4 ? `<button type="button" data-hotkey-record="${keys.length}" data-label="+" aria-pressed="false" aria-label="Add shortcut for ${escape(command.label)}">+</button>` : ''}<button type="button" data-hotkey-reset aria-label="Reset ${escape(command.label)}">Reset</button></div></div>`;
      }).join('')}</div></section>`).join('')}`;
  }
  render(focusId) {
    const top = this.settings.content.scrollTop;
    this.settings.render(); this.filter(); this.settings.content.scrollTop = top;
    if (focusId) this.settings.content.querySelector(`[data-hotkey-id="${focusId}"] [data-hotkey-record]`)?.focus({preventScroll: true});
  }
  filter() {
    const query = this.query.trim().toLowerCase();
    for (const row of this.settings.content.querySelectorAll('.hotkey-row')) row.hidden = !row.dataset.search.includes(query);
    for (const group of this.settings.content.querySelectorAll('.hotkey-group')) group.hidden = !group.querySelector('.hotkey-row:not([hidden])');
  }
  click(event) {
    const button = event.target.closest('button'); if (!button) return;
    const id = button.closest('[data-hotkey-id]')?.dataset.hotkeyId;
    if (button.hasAttribute('data-hotkey-record')) {
      this.cancel(); this.conflict = null;
      this.recording = {id, index: Number(button.dataset.hotkeyRecord)};
      button.setAttribute('aria-pressed', 'true'); button.textContent = 'Press keys…'; button.focus();
    } else if (button.hasAttribute('data-hotkey-remove')) {
      const keys = [...this.settings.value.hotkeys[id]]; keys.splice(Number(button.dataset.hotkeyRemove), 1); this.assign(id, keys);
    } else if (button.hasAttribute('data-hotkey-reset')) this.assign(id, [...DEFAULT_HOTKEYS[id]]);
    else if (button.hasAttribute('data-hotkey-reset-all')) { this.conflict = null; this.settings.commit({hotkeys: DEFAULT_HOTKEYS}); this.message = 'All shortcuts restored to defaults.'; this.render(); }
    else if (button.hasAttribute('data-hotkey-replace') && this.conflict) this.assign(this.conflict.id, this.conflict.keys, true);
    else if (button.hasAttribute('data-hotkey-cancel')) { this.conflict = null; this.render(); }
    else if (button.hasAttribute('data-tab')) { this.cancel(); this.conflict = null; }
  }
  keydown(event) {
    if (!this.recording) return;
    if (event.key === 'Tab') { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') { this.cancel(); return; }
    if (event.repeat) return;
    const binding = eventBinding(event); if (!binding) return;
    const {id, index} = this.recording, keys = [...this.settings.value.hotkeys[id]];
    keys[index] = binding; this.cancel(); this.assign(id, [...new Set(keys)]);
  }
  assign(id, keys, replace = false) {
    const next = {...this.settings.value.hotkeys};
    const conflicts = [...new Set(keys.flatMap(key => findHotkeyConflicts(next, id, key)))];
    if (conflicts.length && !replace) {
      this.conflict = {id, keys, message: `Already assigned in this context: ${conflicts.map(c => c.label).join(', ')}. Replace those bindings or cancel.`};
      this.render();
      this.settings.content.scrollTop = 0;
      this.settings.content.querySelector('[data-hotkey-cancel]')?.focus({preventScroll:true});
      return;
    }
    for (const command of conflicts) next[command.id] = next[command.id].filter(key => !keys.some(candidate => findHotkeyConflicts({[command.id]: [key]}, id, candidate).some(c => c.id === command.id)));
    next[id] = keys; this.conflict = null;
    this.settings.commit({hotkeys: next}); this.message = `${HOTKEY_BY_ID.get(id).label}: ${keys.length ? keys.map(k => formatBinding(k)).join(' / ') : 'unassigned'}.`;
    this.render(id);
  }
}
