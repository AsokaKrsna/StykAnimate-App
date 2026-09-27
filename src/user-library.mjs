import {drawingBarrier} from './drawing-resources.mjs';
import {icon} from './icons.mjs';
import {HotkeyManager} from './hotkeys.mjs';
import {librarySnapshot, libraryPreview, saveLibraryFile, readLibraryFile} from './library-files.mjs';
import {LibraryHoverPreview} from './library-hover-preview.mjs';
import {libraryPreviewMatte, LIBRARY_MATTES} from './library-preview-core.mjs';
import {canMoveLibraryItem} from './library-drag.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const folderIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const label = item => item.kind === 'folder' ? 'Folder' : item.kind === 'movieclip' ? 'Movieclip' : item.kind === 'set' ? 'Figure set' : 'Figure';

export class UserLibrary {
  /**
   * The Library panel's content. Its root, #user-library, is a static host in
   * index.html; the shell's dock host places it and shows it (a tab, a sheet
   * or a floating island) and calls panelVisible(). `activate(id)` asks the
   * shell to show a panel ('library' or 'properties'); this module never hides
   * another panel.
   */
  constructor({editor, desktop, exporter, importer, pause, finishEdit, setTool, vfxInspector, activate, hotkeys = new HotkeyManager()}) {
    this.hotkeys = hotkeys;
    Object.assign(this, {editor, desktop, exporter, importer, pause, finishEdit, setTool, vfxInspector, activate});
    this.folder = ''; this.entries = []; this.selected = null; this.generation = 0; this.busy = false; this.thumbnails = new Map();
    this.hoverPreview = new LibraryHoverPreview(desktop);
    this.container = document.getElementById('user-library');
    if (!this.container) { this.container = document.createElement('section'); this.container.id = 'user-library'; this.container.hidden = true; }
    this.container.innerHTML = `<div class="library-tools"><label class="library-search">${icon('search')}<input type="search" aria-label="Search library" placeholder="Search" spellcheck="false"></label><button type="button" class="icon-button" data-library-action="refresh" aria-label="Refresh library" title="Refresh">${icon('rotate')}</button><button type="button" class="icon-button" data-library-action="folder" aria-label="New library folder" title="New folder">${icon('plus')}</button><button type="button" class="icon-button" data-library-action="reveal" aria-label="Open library folder" title="Open folder in Explorer">${folderIcon}</button></div>
      <div class="library-location"><nav class="library-breadcrumbs" aria-label="Library folders"></nav><span class="library-count"></span></div><div class="library-filter ds-segmented" role="group" aria-label="Filter library assets"><button type="button" data-library-filter="all" aria-pressed="true">All</button><button type="button" data-library-filter="figure" aria-pressed="false">Figures</button><button type="button" data-library-filter="movieclip" aria-pressed="false">Movieclips</button></div>
      <div class="library-content"><div class="library-grid" role="list" aria-label="Saved assets"></div><div class="library-empty ds-empty"></div></div>
      <div class="library-item-actions" hidden><button type="button" data-library-action="insert">Insert</button><button type="button" data-library-action="rename">Rename</button><button type="button" data-library-action="move">Move to…</button><button type="button" class="library-trash" data-library-action="trash" aria-label="Remove library item" title="Move to Recycle Bin">${icon('trash')}</button></div>
      <div class="library-message" role="status" aria-live="polite"></div><div class="library-save"><button type="button" class="button primary" data-library-action="save">${icon('plus')}<span>Add to library</span></button><div class="library-footer-row"><button type="button" class="library-link rig-library-examples" data-action="rig-examples">${icon('person')}Rig examples</button><label class="library-preview-controls" title="Background behind asset previews">Preview<select aria-label="Preview background"><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div></div>`;
    // Properties' footer: Add to library, shown with the Properties panel.
    this.propertySave = document.createElement('div'); this.propertySave.className = 'properties-library-save';
    this.propertySave.innerHTML = `<button type="button" class="button" data-library-action="save">${icon('plus')} Add to library</button>`;
    (document.getElementById('properties-panel') ?? this.container.parentElement)?.append(this.propertySave);
    this.roots = [this.container, this.propertySave];
    this.dialog = document.createElement('dialog'); this.dialog.className = 'library-dialog'; document.body.append(this.dialog);
    this.grid = this.container.querySelector('.library-grid'); this.message = this.container.querySelector('.library-message');
    this.input = this.container.querySelector('input'); this.filterValue = 'all';
    this.container.querySelector('.library-filter').onclick = event => { const button = event.target.closest('[data-library-filter]'); if (button) this.setFilter(button.dataset.libraryFilter); };
    this.container.querySelector('[aria-label="Preview background"]').onchange = event => { this.container.dataset.background = event.target.value; };
    this.menu = document.createElement('div'); this.menu.className = 'library-context-menu'; this.menu.hidden = true;
    this.menu.setAttribute('role', 'menu'); this.menu.setAttribute('aria-label', 'Library actions'); document.body.append(this.menu);
    this.menu.onclick = event => {
      const button = event.target.closest('[data-library-action]'); if (!button || button.disabled) return;
      const action = button.dataset.libraryAction; this.closeMenu(true); this.run(() => this.action(action));
    };
    this.menu.onkeydown = event => {
      event.stopPropagation();
      const buttons = [...this.menu.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape' || event.key === 'Tab') { this.closeMenu(event.key === 'Escape'); if (event.key === 'Escape') event.preventDefault(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length; buttons[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', event => { if (!this.menu.contains(event.target)) this.closeMenu(); }, true);
    window.addEventListener('blur', () => { this.closeMenu(); this.hoverPreview.stop(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.closeMenu(); this.hoverPreview.stop(); } });
    this.container.querySelector('.library-content').addEventListener('scroll', () => { this.closeMenu(); this.hoverPreview.stop(); }, {passive: true});
    this.container.addEventListener('contextmenu', event => {
      if (event.target.closest('input, select')) return;
      event.preventDefault(); event.stopPropagation(); this.showMenu(event.target.closest('[data-library-path]'), event.clientX, event.clientY);
    });
    this.grid.addEventListener('pointerover', event => {
      const card = event.target.closest('.library-card');
      if (!card || card.contains(event.relatedTarget) || event.buttons || this.busy || !this.menu.hidden || this.dialog.open || card.querySelector('input')) return;
      const item = this.entries.find(item => item.path === card.dataset.libraryPath);
      if (item?.kind === 'movieclip') this.hoverPreview.start(card, item);
    });
    this.grid.addEventListener('pointerout', event => {
      const card = event.target.closest('.library-card'); if (card && !card.contains(event.relatedTarget)) this.hoverPreview.stop();
    });
    this.grid.addEventListener('focusin', event => { const card = event.target.closest('[data-library-path]'); if (card) this.select(card.dataset.libraryPath); });
    for (const root of this.roots) root.addEventListener('click', event => {
      const action = event.target.closest('[data-library-action]')?.dataset.libraryAction; if (!action) return;
      event.stopPropagation(); this.run(() => this.action(action));
    });
    this.input.oninput = () => this.render();
    this.container.querySelector('.library-empty').onclick = event => { if (event.target.closest('[data-library-clear]')) { this.input.value = ''; this.setFilter('all'); this.input.focus(); } };
    this.grid.onclick = event => {
      const card = event.target.closest('[data-library-path]'); if (!card || event.target.matches('input')) return;
      this.select(card.dataset.libraryPath);
      if (event.target.closest('.library-more')) { const rect = card.getBoundingClientRect(); this.showMenu(card, rect.right, rect.top + 24); }
    };
    this.grid.ondblclick = event => { const card = event.target.closest('[data-library-path]'); if (card && !event.target.closest('input, button')) this.run(() => this.open(card.dataset.libraryPath)); };
    this.grid.onkeydown = event => {
      if (event.target.matches('input')) return;
      if (event.target.closest('button') && ['Enter', ' '].includes(event.key)) return;
      if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
        event.preventDefault(); const card = event.target.closest('[data-library-path]'); if (card) { const rect = card.getBoundingClientRect(); this.showMenu(card, rect.left, rect.bottom); } return;
      }
      if (event.key === 'Delete') { event.preventDefault(); if (!event.repeat) this.run(() => this.action('trash')); return; }
      const command = this.hotkeys.resolve(event, ['library']);
      if (command?.scope === 'library') {
        event.preventDefault();
        if (!event.repeat) this.run(() => command.id === 'library-open' ? this.open(this.selected) : this.rename());
      }
      else if (event.key.startsWith('Arrow')) {
        event.preventDefault(); const cards = [...this.grid.querySelectorAll('[data-library-path]')], index = cards.indexOf(event.target.closest('[data-library-path]'));
        const columns = Math.max(1, getComputedStyle(this.grid).gridTemplateColumns.split(' ').length);
        const step = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}[event.key]; const card = cards[Math.max(0, Math.min(cards.length-1,index+step))];
        if (card) { this.select(card.dataset.libraryPath); card.focus(); }
      }
    };
    this.container.addEventListener('keydown', event => event.stopPropagation());
    this.dialog.addEventListener('keydown', event => event.stopPropagation());
    this.observer = new IntersectionObserver(items => {
      for (const item of items) if (item.isIntersecting) { this.observer.unobserve(item.target); this.loadThumbnail(item.target, this.generation); }
    }, {root:this.container.querySelector('.library-content'), rootMargin:'150px'});
    window.addEventListener('focus', () => { if (this.visible && !this.busy && !this.grid.querySelector('input')) this.run(() => this.refresh()); });
    editor.addEventListener('change', () => this.syncSelection()); this.syncSelection();
  }
  setFilter(value) { this.filterValue = value; for (const button of this.container.querySelectorAll('[data-library-filter]')) button.setAttribute('aria-pressed', String(button.dataset.libraryFilter === value)); this.render(); }
  /** Empty grid: explain the library and offer the next action for this situation. */
  renderEmpty(filtered) {
    const empty = this.container.querySelector('.library-empty'), selection = this.editor.selectedObjects.length, desktop = Boolean(this.desktop?.listLibrary);
    const card = (title, actions = '') => `<strong>${title}</strong>${actions ? `<div class="ds-empty-actions">${actions}</div>` : ''}`;
    const examples = '<button type="button" class="button small" data-action="rig-examples">Rig examples</button>';
    if (!desktop) empty.innerHTML = card('Library is available in the desktop app', examples);
    else if (filtered) empty.innerHTML = card('No matches', '<button type="button" class="button small" data-library-clear>Clear search</button>');
    else empty.innerHTML = card(this.folder ? 'Empty folder' : 'No saved assets', `${selection ? `<button type="button" class="button primary small" data-library-action="save">${selection > 1 ? `Add ${selection} figures` : 'Add selection'}</button>` : ''}${examples}`);
  }
  async run(operation) { try { await operation(); } catch (error) { this.message.textContent = error.message; this.message.dataset.error = 'true'; } }
  show(visible = true) {
    this.showView(visible?'library':'properties');
  }
  /** Asks the shell to show a panel: 'library', 'properties' or 'vfx'. */
  showView(view) {
    this.finishEdit?.();
    this.activate?.(view);
  }
  /** The shell showed or hid the Library panel (panel registry onVisibility). */
  panelVisible(visible) {
    this.closeMenu(); this.hoverPreview.stop();
    this.visible = visible;
    if (visible) this.run(() => this.refresh());
  }
  syncSelection() {
    const count = this.editor.selectedObjects.length, available = Boolean(this.desktop?.listLibrary);
    const saves = this.roots.flatMap(root => [...root.querySelectorAll('[data-library-action="save"]')]);
    for (const button of saves) button.disabled = this.busy || !count || !available;
    this.container.querySelector('[data-library-action="save"] span').textContent = count > 1 ? `Add ${count} figures to library` : 'Add to library';
    for (const button of saves) button.title = count ? `Save selection in ${this.folder || 'Library'}` : 'Select figures or a movieclip';
  }
  async refresh(folder = this.folder) {
    if (!this.desktop?.listLibrary) { this.container.dataset.unavailable = 'true'; this.container.querySelector('.library-empty').hidden = false; this.renderEmpty(false); return; }
    const generation = ++this.generation;
    this.closeMenu(); this.hoverPreview.stop();
    let result;
    try { result = await this.desktop.listLibrary(folder); }
    catch (error) { if (folder && /ENOENT/.test(error.message)) result = await this.desktop.listLibrary(''); else throw error; }
    if (generation !== this.generation) return;
    if (this.folder !== result.path) { this.selected = null; this.input.value = ''; }
    this.folder = result.path; this.entries = result.entries; this.root = result.root;
    const nav = this.container.querySelector('nav'); nav.replaceChildren();
    let current = ''; for (const [i, part] of ['Library', ...this.folder.split('/').filter(Boolean)].entries()) {
      if (i) current += `${current ? '/' : ''}${part}`;
      const path = current, button = document.createElement('button'); button.type = 'button'; button.textContent = part; button.title = i ? part : this.root;
      button.dataset.libraryFolder = path;
      button.onclick = () => this.run(() => this.refresh(path)); nav.append(button);
    }
    this.render();
  }
  render() {
    this.closeMenu(); this.hoverPreview.stop();
    this.observer.disconnect(); this.grid.replaceChildren();
    const filter = this.filterValue, query = this.input.value.trim().toLocaleLowerCase(), items = this.entries.filter(item => item.name.toLocaleLowerCase().includes(query) && (filter === 'all' || item.kind === 'folder' || item.kind === filter || filter === 'figure' && item.kind === 'set'));
    this.container.querySelector('.library-count').textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
    const empty = this.container.querySelector('.library-empty'); empty.hidden = items.length > 0;
    if (!empty.hidden) this.renderEmpty(Boolean(query || filter !== 'all'));
    for (const item of items) {
      const card = document.createElement('div'); card.className = `library-card ${item.kind}`; card.dataset.libraryPath = item.path; card.tabIndex = 0; card.setAttribute('role','listitem'); card.setAttribute('aria-label',`${item.name}, ${label(item)}`); card.title = `Double-click to ${item.kind === 'folder' ? 'open' : 'insert'} ${item.name}`;
      card.draggable = false;
      card.title = item.kind === 'folder' ? `Double-click to open ${item.name}. Drag onto a folder to move.` : `${item.name}. Drag to canvas to insert, or onto a folder to move. Right-click for actions.${item.kind === 'movieclip' ? ' Hover to play.' : ''}`;
      if (item.kind === 'folder') card.dataset.libraryFolder = item.path;
      card.innerHTML = `<div class="library-thumbnail">${item.kind === 'folder' ? folderIcon : '<span class="library-preview-loading"></span>'}${['movieclip','set'].includes(item.kind) ? `<span class="library-clip-badge" title="${label(item)}">${icon(item.kind === 'movieclip' ? 'play' : 'duplicate')}</span>` : ''}<button type="button" class="library-more" aria-label="Actions for ${esc(item.name)}" aria-haspopup="menu">···</button>${item.kind === 'movieclip' ? '<span class="library-preview-hint">Hover to play</span><span class="library-preview-progress"></span>' : ''}</div><div class="library-card-info"><span class="library-name">${esc(item.name)}</span><span class="library-kind">${label(item)}</span></div>`;
      this.grid.append(card); if (item.kind !== 'folder') this.observer.observe(card);
    }
    this.select(items.some(item => item.path === this.selected) ? this.selected : null);
  }
  async loadThumbnail(card, generation) {
    const path = card.dataset.libraryPath, item = this.entries.find(item => item.path === path); if (!item) return;
    const key = `${path}:${item.modified}`;
    try {
      let url = this.thumbnails.get(key) ?? await this.desktop.getLibraryThumbnail(path);
      if (!url) {
        // Missing previews (for files copied in Explorer) are repaired one at a time.
        const generate = async () => {
          if (generation !== this.generation || !card.isConnected) return null;
          const file = await readLibraryFile(this.desktop,path), result = await this.importer.importFile(file), report = result.document ?? result.report ?? result;
          const thumbnail = await libraryPreview(report), kind = report.keyframes[0].objects.length > 1 ? 'set' : item.kind;
          await this.desktop.cacheLibraryThumbnail({path, thumbnail, modified:item.modified, kind});
          if (generation === this.generation && card.isConnected) { item.kind = kind; card.setAttribute('aria-label',`${item.name}, ${label(item)}`); }
          return thumbnail;
        };
        const pending = (this.previewChain ?? Promise.resolve()).then(generate); this.previewChain = pending.catch(() => {}); url = await pending;
      }
      if (generation !== this.generation || !card.isConnected) return;
      const target = card.querySelector('.library-thumbnail'); target.querySelector('.library-preview-loading')?.remove();
      if (url) {
        this.thumbnails.delete(key); this.thumbnails.set(key, url); while (this.thumbnails.size > 128) this.thumbnails.delete(this.thumbnails.keys().next().value);
        const image = new Image(); image.alt = item.name; image.draggable = false;
        image.onload = () => {
          if (!card.isConnected) return;
          const sample = document.createElement('canvas'); sample.width = sample.height = 40;
          const context = sample.getContext('2d', {willReadFrequently: true}); context.drawImage(image, 0, 0, 40, 40);
          const matte = LIBRARY_MATTES[libraryPreviewMatte(context.getImageData(0, 0, 40, 40).data)];
          card.dataset.matte = matte; if (!card.classList.contains('library-preview-playing')) card.style.setProperty('--library-matte', matte);
        };
        image.src = url; target.prepend(image);
      } else { target.insertAdjacentHTML('afterbegin', icon('person')); target.title = 'Preview unavailable for this file'; }
    } catch { if (card.isConnected) { card.querySelector('.library-preview-loading')?.remove(); card.querySelector('.library-thumbnail').insertAdjacentHTML('afterbegin', icon('person')); } }
  }
  select(path) {
    this.selected = path; for (const card of this.grid.children) card.classList.toggle('selected', card.dataset.libraryPath === path);
    const item = this.entries.find(item => item.path === path); this.container.querySelector('.library-item-actions').hidden = !item;
    this.container.querySelector('[data-library-action="insert"]').textContent = item?.kind === 'folder' ? 'Open folder' : 'Insert into scene';
  }
  async action(action) {
    if (this.busy) return;
    if (action === 'save') return this.save();
    if (action === 'refresh') return this.refresh();
    if (action === 'reveal') return this.desktop.revealLibrary(this.folder);
    if (action === 'folder') return this.newFolder();
    if (action === 'rename') return this.rename();
    if (action === 'move') return this.move();
    if (action === 'trash') return this.trash();
    if (action === 'insert') return this.open(this.selected);
  }
  closeMenu(restoreFocus = false) {
    this.menu.hidden = true; if (restoreFocus) this.menuAnchor?.focus({preventScroll: true});
  }
  showMenu(card, x, y) {
    this.hoverPreview.stop(); this.select(card?.dataset.libraryPath ?? null); this.menuAnchor = card ?? this.input;
    const item = this.entries.find(item => item.path === this.selected);
    const actions = item ? [
      ['insert', item.kind === 'folder' ? 'Open folder' : 'Insert into scene', 'Enter'],
      ['rename', 'Rename', 'F2'], ['move', 'Move to…', ''], null,
      ['trash', 'Move to Recycle Bin', 'Del'],
    ] : [['folder', 'New folder', ''], ['save', 'Add selection to library', ''], null, ['refresh', 'Refresh', ''], ['reveal', 'Open folder in Explorer', '']];
    this.menu.innerHTML = actions.map(action => action ? `<button type="button" role="menuitem" data-library-action="${action[0]}" ${this.busy || !this.desktop?.listLibrary || action[0] === 'save' && !this.editor.selectedObjects.length ? 'disabled' : ''}><span>${action[1]}</span><kbd>${action[2]}</kbd></button>` : '<div role="separator"></div>').join('');
    this.menu.hidden = false; const rect = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    this.menu.querySelector('button:not(:disabled)')?.focus({preventScroll: true});
  }
  dragDestination(hit, item) {
    const target = hit?.closest('[data-library-folder]');
    if (!target || !this.container.contains(target) || this.busy || !canMoveLibraryItem(item, target.dataset.libraryFolder)) return null;
    return {element: target, folder: target.dataset.libraryFolder, name: target.dataset.libraryFolder.split('/').at(-1) || 'Library'};
  }
  async moveItem(item, folder) {
    if (this.busy || !canMoveLibraryItem(item, folder)) return;
    this.busy = true; this.syncSelection(); this.hoverPreview.stop();
    try {
      await this.desktop.changeLibraryItem({path: item.path, folder}); this.selected = null;
      await this.refresh(); this.message.dataset.error = 'false'; this.message.textContent = `${item.name} moved to ${folder || 'Library'}`;
    } finally { this.busy = false; this.syncSelection(); }
  }
  async save() {
    if (!this.editor.selectedObjects.length || this.busy) return;
    this.pause(); this.finishEdit(); this.show(); this.busy = true; this.syncSelection();
    this.message.dataset.error = 'false'; this.message.textContent = 'Saving artwork and preview…';
    const folder = this.folder;
    try {
      const revision=this.editor.revision;await drawingBarrier(this.editor.report);if(revision!==this.editor.revision)throw new Error('The selection changed before saving to the library. Try again.');
      const report = librarySnapshot(this.editor), format = report._styk.libraryKind === 'movieclip' ? 'stykmov' : 'stkz';
      const [thumbnail, blob] = await Promise.all([libraryPreview(report), this.exporter.export(report, {format, figureUids:report.keyframes[0].objects.map(o => o.unique_id)})]);
      let name = report._styk.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/^\.+|[. ]+$/g,'').slice(0,110).trim() || 'Untitled asset';
      if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `Asset ${name}`;
      const result = await saveLibraryFile(this.desktop, blob, {folder, name, kind:report._styk.libraryKind, extension:`.${format}`, thumbnail});
      this.input.value = ''; this.setFilter('all'); await this.refresh(folder); this.select(result.path); this.message.textContent = `Saved to ${folder || 'Library'}`;
      [...this.grid.children].find(card => card.dataset.libraryPath === result.path)?.scrollIntoView({block:'nearest'});
    } finally { this.busy = false; this.syncSelection(); }
  }
  async open(path) {
    const item = this.entries.find(item => item.path === path); if (!item || this.busy) return;
    if (item.kind === 'folder') return this.refresh(path);
    return this.insert(item);
  }
  async insert(item, position) {
    if (this.busy) return;
    this.hoverPreview.stop();
    this.busy = true; this.syncSelection(); this.message.dataset.error = 'false'; this.message.textContent = `Inserting ${item.name}…`;
    try {
      this.pause(); this.finishEdit();
      const report = this.editor.report, tick = this.editor.tick, layer = this.editor.activeLayerId;
      const file = await readLibraryFile(this.desktop, item.path), result = await this.importer.importFile(file);
      if (this.editor.report !== report || this.editor.tick !== tick || this.editor.activeLayerId !== layer) throw new Error('The document or insertion frame changed. Insert the asset again.');
      const document = result.document ?? result.report ?? result;
      if (document.figure_types?.length === 1) document.figure_types[0].name = item.name;
      if (this.editor.getLayer(layer)?.locked) throw new Error('Unlock the destination layer before inserting an asset.');
      this.editor.importFigure(document, {position}); this.setTool('select'); this.message.textContent = `${item.name} added to the scene`;
    } finally { this.busy = false; this.syncSelection(); }
  }
  rename() {
    this.hoverPreview.stop();
    const item = this.entries.find(item => item.path === this.selected); if (!item || this.busy) return;
    const card = [...this.grid.children].find(card => card.dataset.libraryPath === item.path), name = card?.querySelector('.library-name'); if (!name || card.querySelector('input')) return;
    const input = document.createElement('input'); input.className = 'library-rename'; input.value = item.name; input.maxLength = 120; input.setAttribute('aria-label','Asset name'); name.replaceWith(input); input.focus(); input.select();
    let done = false;
    const commit = async () => {
      if (done) return; done = true;
      try { const result = await this.desktop.changeLibraryItem({path:item.path, name:input.value}); this.selected = result.path; await this.refresh(); }
      catch (error) { done = false; this.message.textContent = error.message; this.message.dataset.error = 'true'; input.focus(); }
    };
    input.onkeydown = event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); commit(); } else if (event.key === 'Escape') { done = true; this.render(); } };
    input.onblur = commit;
  }
  newFolder() {
    this.dialog.setAttribute('aria-label','New library folder');
    this.dialog.innerHTML = '<form><h2>New folder</h2><label>Folder name<input name="name" aria-label="Folder name" value="New folder" maxlength="120" required></label><div class="library-dialog-error" role="alert"></div><footer><button class="button" type="button" data-cancel>Cancel</button><button class="button primary" type="submit">Create folder</button></footer></form>';
    this.dialog.querySelector('[data-cancel]').onclick = () => this.dialog.close();
    this.dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const submit = event.submitter; submit.disabled = true;
      try { const result = await this.desktop.createLibraryFolder({folder:this.folder, name:this.dialog.querySelector('input').value}); this.dialog.close(); this.selected = result.path; await this.refresh(); }
      catch (error) { this.dialog.querySelector('[role="alert"]').textContent = error.message; } finally { submit.disabled = false; }
    };
    this.dialog.showModal(); this.dialog.querySelector('input').select();
  }
  async move() {
    const item = this.entries.find(item => item.path === this.selected); if (!item) return;
    this.dialog.setAttribute('aria-label','Move library item'); let destination = ''; let sequence = 0;
    this.dialog.innerHTML = `<h2>Move ${esc(item.name)}</h2><div class="library-move-location"></div><div class="library-move-folders"></div><div role="alert" class="library-dialog-error"></div><footer><button type="button" class="button" data-cancel>Cancel</button><button type="button" class="button primary" data-move>Move here</button></footer>`;
    const browse = async folder => {
      const id = ++sequence, result = await this.desktop.listLibrary(folder); if (id !== sequence) return; destination = folder;
      this.dialog.querySelector('.library-move-location').textContent = `Library${folder ? ` / ${folder.replaceAll('/',' / ')}` : ''}`;
      const list = this.dialog.querySelector('.library-move-folders'); list.replaceChildren();
      const add = (text, path) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = () => this.run(() => browse(path)); list.append(button); };
      if (folder) add('← Parent folder', folder.split('/').slice(0,-1).join('/'));
      for (const child of result.entries.filter(child => child.kind === 'folder' && child.path !== item.path)) add(`▱ ${child.name}`, child.path);
    };
    this.dialog.querySelector('[data-cancel]').onclick = () => this.dialog.close();
    this.dialog.querySelector('[data-move]').onclick = async event => {
      event.target.disabled = true;
      try { await this.desktop.changeLibraryItem({path:item.path, folder:destination}); this.dialog.close(); this.selected = null; await this.refresh(); this.message.textContent = `Moved to ${destination || 'Library'}`; }
      catch (error) { this.dialog.querySelector('[role="alert"]').textContent = error.message; } finally { event.target.disabled = false; }
    };
    await browse(''); this.dialog.showModal();
  }
  trash() {
    const item = this.entries.find(item => item.path === this.selected); if (!item) return;
    this.dialog.setAttribute('aria-label','Remove library item');
    this.dialog.innerHTML = `<h2>Remove ${esc(item.name)}?</h2><p>${item.kind === 'folder' ? 'This folder and its contents' : 'This asset and its preview'} will move to the Recycle Bin. Copies already in your scenes stay available.</p><div class="library-dialog-error" role="alert"></div><footer><button type="button" class="button" data-cancel>Cancel</button><button type="button" class="button primary" data-remove>Move to Recycle Bin</button></footer>`;
    this.dialog.querySelector('[data-cancel]').onclick = () => this.dialog.close();
    this.dialog.querySelector('[data-remove]').onclick = async event => {
      event.target.disabled = true;
      try { await this.desktop.trashLibraryItem(item.path); this.dialog.close(); this.selected = null; await this.refresh(); this.message.textContent = 'Moved to Recycle Bin'; }
      catch (error) { this.dialog.querySelector('[role="alert"]').textContent = error.message; } finally { event.target.disabled = false; }
    };
    this.dialog.showModal(); this.dialog.querySelector('[data-cancel]').focus();
  }
}
