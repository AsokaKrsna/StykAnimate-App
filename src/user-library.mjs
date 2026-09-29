import {drawingBarrier} from './drawing-resources.mjs';
import {icon} from './icons.mjs';
import {HotkeyManager} from './hotkeys.mjs';
import {librarySnapshot, libraryPreview, pngThumbnail, saveLibraryFile, readLibraryFile} from './library-files.mjs';
import {LibraryHoverPreview} from './library-hover-preview.mjs';
import {libraryPreviewMatte, LIBRARY_MATTES} from './library-preview-core.mjs';
import {canMoveLibraryItem} from './library-drag.mjs';
import {openMenu} from './ui/ui-menu.mjs';
import {setAttr, setProp, setText} from './ui/dom-write.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const folderIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const KINDS = {folder: 'Folder', movieclip: 'Movieclip', set: 'Figure set', figure: 'Figure'};
const label = item => KINDS[item.kind] ?? 'Figure';
const plural = (count, one, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const parentOf = path => path.split('/').slice(0, -1).join('/');
// Electron prefixes what the main process throws; the person only needs the sentence.
const plain = error => String(error?.message ?? error).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
const PUBLIC_PAGE = 'https://stykanimate.com/library/';
const SKELETONS = 6;

export class UserLibrary {
  /**
   * The Library panel's content. Its root, #user-library, is a static host in
   * index.html; the shell's dock host places it and shows it (a tab, a sheet
   * or a floating island) and calls panelVisible(). `activate(id)` asks the
   * shell to show a panel ('library' or 'properties'); this module never hides
   * another panel.
   *
   * Two sources share one grid: My library (the desktop library's folders,
   * desktop/library-store.cjs) and Community library (what people share on
   * stykanimate.com, desktop/public-library.cjs). Cards insert on double-click,
   * Enter or a drag to the stage; everything else is in a card's ⋯ menu.
   */
  constructor({editor, desktop, exporter, importer, pause, finishEdit, setTool, vfxInspector, activate, hotkeys = new HotkeyManager()}) {
    this.hotkeys = hotkeys;
    Object.assign(this, {editor, desktop, exporter, importer, pause, finishEdit, setTool, vfxInspector, activate});
    this.source = 'mine'; this.folder = ''; this.entries = []; this.selected = null; this.generation = 0; this.busy = false; this.thumbnails = new Map();
    this.publicCatalog = null; this.publicState = 'idle'; this.publicError = ''; this.publicSelected = null; this.publicGeneration = 0;
    this.filterValue = 'all'; this.background = 'auto'; this.menu = null;
    this.hoverPreview = new LibraryHoverPreview(desktop);
    this.container = document.getElementById('user-library');
    if (!this.container) { this.container = document.createElement('section'); this.container.id = 'user-library'; this.container.hidden = true; }
    // The kit's parts (features/library.css): the source switch, a search with the kind and the library menu, where
    // you are, the cards as one listbox, then a pinned foot with the status line and Add selection.
    this.container.dataset.source = 'mine'; this.container.dataset.background = 'auto';
    this.container.innerHTML = `<div class="library-head">
      <div class="library-source ui-segmented" data-size="sm" data-fill role="group" aria-label="Library source"><button type="button" class="ui-segmented-item" data-library-source="mine" aria-pressed="true">My library</button><button type="button" class="ui-segmented-item" data-library-source="public" aria-pressed="false">${icon('globe')}Community library</button></div>
      <div class="library-tools"><label class="library-search ui-field" data-size="sm">${icon('search')}<input class="ui-field-input" type="search" aria-label="Search library" placeholder="Search" spellcheck="false" autocomplete="off"></label><span class="ui-select library-kind-filter" data-size="sm"><select aria-label="Show"><option value="all">All</option><option value="figure">Figures</option><option value="movieclip">Movieclips</option></select>${icon('chevron-down')}</span><button type="button" class="ui-icon-button" data-size="sm" data-library-menu aria-haspopup="menu" aria-label="Library options" title="Library options">${icon('more')}</button></div>
      <div class="library-location"><nav class="library-breadcrumbs ui-crumb" aria-label="Library folders"></nav><span class="library-origin">${icon('globe')}<span>stykanimate.com</span></span><span class="library-count"></span><button type="button" class="ui-icon-button library-new-folder" data-size="sm" data-library-action="folder" aria-label="New library folder" title="New folder">${icon('folder-plus')}</button></div>
    </div>
    <div class="library-content"><div class="library-grid" role="listbox" aria-label="My library"></div><div class="library-empty ui-empty" hidden></div></div>
    <div class="library-foot"><p class="library-message" role="status" aria-live="polite"></p><button type="button" class="ui-button library-add" data-variant="outline" data-library-action="save">${icon('plus')}<span class="ui-label">Add selection</span></button><button type="button" class="ui-button library-website" data-variant="ghost" data-size="sm" data-library-action="website">${icon('link')}<span class="ui-label">Browse stykanimate.com/library</span></button></div>`;
    // Properties' footer: Add to library, shown with the Properties panel.
    this.propertySave = document.createElement('div'); this.propertySave.className = 'properties-library-save';
    this.propertySave.innerHTML = `<button type="button" class="button" data-library-action="save">${icon('plus')} Add to library</button>`;
    (document.getElementById('properties-panel') ?? this.container.parentElement)?.append(this.propertySave);
    this.roots = [this.container, this.propertySave];
    this.dialog = document.createElement('dialog'); this.dialog.className = 'library-dialog'; document.body.append(this.dialog);
    this.grid = this.container.querySelector('.library-grid'); this.message = this.container.querySelector('.library-message');
    this.content = this.container.querySelector('.library-content'); this.empty = this.container.querySelector('.library-empty');
    this.input = this.container.querySelector('input'); this.kindSelect = this.container.querySelector('.library-kind-filter select');

    this.container.querySelector('.library-source').onclick = event => { const button = event.target.closest('[data-library-source]'); if (button) this.run(() => this.setSource(button.dataset.librarySource)); };
    this.kindSelect.onchange = () => this.setFilter(this.kindSelect.value);
    const options = this.container.querySelector('[data-library-menu]');
    options.onclick = () => this.showMenu(null, {anchor: options, options: true});
    window.addEventListener('blur', () => { this.closeMenu(); this.hoverPreview.stop(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.closeMenu(); this.hoverPreview.stop(); } });
    this.content.addEventListener('scroll', () => { this.closeMenu(); this.hoverPreview.stop(); }, {passive: true});
    this.content.addEventListener('contextmenu', event => {
      if (event.target.closest('input, select')) return;
      event.preventDefault(); event.stopPropagation(); this.showMenu(this.cardFrom(event.target), {point: {x: event.clientX, y: event.clientY}});
    });
    this.grid.addEventListener('pointerover', event => {
      const card = event.target.closest('.library-card');
      if (!card || card.contains(event.relatedTarget) || event.buttons || this.busy || this.menu || this.dialog.open || card.querySelector('input')) return;
      const item = this.source === 'mine' ? this.entries.find(item => item.path === card.dataset.libraryPath) : null;
      if (item?.kind === 'movieclip') this.hoverPreview.start(card, item);
    });
    this.grid.addEventListener('pointerout', event => {
      const card = event.target.closest('.library-card'); if (card && !card.contains(event.relatedTarget)) this.hoverPreview.stop();
    });
    this.grid.addEventListener('focusin', event => { const card = this.cardFrom(event.target); if (card) this.select(this.keyOf(card)); });
    for (const root of this.roots) root.addEventListener('click', event => {
      const action = event.target.closest('[data-library-action]')?.dataset.libraryAction; if (!action) return;
      event.stopPropagation(); this.run(() => this.action(action));
    });
    this.input.oninput = () => this.render();
    this.empty.onclick = event => {
      if (event.target.closest('[data-library-clear]')) { this.input.value = ''; this.setFilter('all'); this.input.focus(); }
      const source = event.target.closest('[data-library-source-link]')?.dataset.librarySourceLink;
      if (source) this.run(() => this.setSource(source));
      if (event.target.closest('[data-library-retry]')) this.run(() => this.loadPublic({refresh: true}));
    };
    this.grid.onclick = event => {
      const card = this.cardFrom(event.target); if (!card || event.target.matches('input')) return;
      this.select(this.keyOf(card));
      if (event.target.closest('.library-more')) this.showMenu(card, {anchor: event.target.closest('.library-more')});
    };
    this.grid.ondblclick = event => { const card = this.cardFrom(event.target); if (card && !event.target.closest('input, button')) this.run(() => this.open(this.keyOf(card))); };
    this.grid.onkeydown = event => this.onKey(event);
    this.container.addEventListener('keydown', event => event.stopPropagation());
    this.dialog.addEventListener('keydown', event => event.stopPropagation());
    this.observer = new IntersectionObserver(items => {
      for (const item of items) if (item.isIntersecting) { this.observer.unobserve(item.target); this.loadThumbnail(item.target, this.generation); }
    }, {root: this.content, rootMargin: '150px'});
    window.addEventListener('focus', () => { if (this.visible && this.source === 'mine' && !this.busy && !this.grid.querySelector('input')) this.run(() => this.refresh()); });
    editor.addEventListener('change', () => this.syncSelection()); this.syncSelection();
    // stykanimate://library/<id> from the website: the main process keeps the link until it is taken.
    if (desktop?.takePublicLibraryLink) {
      const take = () => this.run(async () => { const id = await desktop.takePublicLibraryLink(); if (id !== null && id !== undefined) await this.openPublic(id); });
      desktop.onPublicLibraryLink?.(take); take();
    }
  }

  // ---- The model ----
  get publicItems() {
    const names = new Map((this.publicCatalog?.categories ?? []).map(category => [category.id, category.name]));
    return (this.publicCatalog?.items ?? []).map(item => ({...item, source: 'public', categoryName: names.get(item.category) ?? ''}));
  }
  cardFrom(target) { const card = target?.closest?.('.library-card'); return card && this.grid.contains(card) && !card.classList.contains('is-skeleton') ? card : null; }
  keyOf(card) { return card?.dataset.libraryPath ?? card?.dataset.publicId ?? null; }
  cardFor(key) { return [...this.grid.querySelectorAll('.library-card')].find(card => this.keyOf(card) === key) ?? null; }
  itemFor(key) { return key == null ? null : this.source === 'public' ? this.publicItems.find(item => item.id === key) ?? null : this.entries.find(item => item.path === key) ?? null; }
  get selectedKey() { return this.source === 'public' ? this.publicSelected : this.selected; }
  /** The asset a card drags (library-drag.mjs): an asset or, in My library, a folder. */
  assetFor(card) { return this.busy ? null : this.itemFor(this.keyOf(card)); }
  dragStarted(asset) { this.hoverPreview.stop(); this.closeMenu(); this.select(asset.path ?? asset.id); }
  visibleItems() {
    const query = this.input.value.trim().toLocaleLowerCase(), filter = this.filterValue;
    const kind = item => filter === 'all' || item.kind === filter || filter === 'figure' && item.kind === 'set';
    if (this.source === 'public') return this.publicItems.filter(item => kind(item) && `${item.name} ${item.categoryName} ${item.author} ${item.tags.join(' ')} ${item.description}`.toLocaleLowerCase().includes(query));
    return this.entries.filter(item => item.name.toLocaleLowerCase().includes(query) && (item.kind === 'folder' || kind(item)));
  }

  // ---- Showing ----
  async run(operation) { try { await operation(); } catch (error) { this.say(plain(error), true); } }
  say(text, error = false) {
    clearTimeout(this.messageTimer);
    this.message.textContent = text; this.message.dataset.error = String(error);
    // Success fades after a while; an error stays until the next action.
    if (text && !error) this.messageTimer = setTimeout(() => { if (this.message.textContent === text) this.message.textContent = ''; }, 6000);
  }
  show(visible = true) { this.showView(visible ? 'library' : 'properties'); }
  /** Asks the shell to show a panel: 'library', 'properties' or 'vfx'. */
  showView(view) { this.finishEdit?.(); this.activate?.(view); }
  /** The shell showed or hid the Library panel (panel registry onVisibility). */
  panelVisible(visible) {
    this.closeMenu(); this.hoverPreview.stop();
    this.visible = visible;
    if (visible) this.run(() => this.source === 'public' ? this.loadPublic() : this.refresh());
  }
  async setSource(source) {
    source = source === 'public' ? 'public' : 'mine';
    if (this.source !== source) {
      this.source = source; this.container.dataset.source = source; this.input.value = ''; this.say('');
      for (const button of this.container.querySelectorAll('[data-library-source]')) button.setAttribute('aria-pressed', String(button.dataset.librarySource === source));
      this.syncSelection();
    }
    return source === 'public' ? this.loadPublic() : this.refresh();
  }
  setFilter(value) { this.filterValue = value; this.kindSelect.value = value; this.render(); }
  setBackground(value) { this.background = value; this.container.dataset.background = value; }
  syncSelection() {
    const count = this.editor.selectedObjects.length, available = Boolean(this.desktop?.listLibrary);
    const saves = this.roots.flatMap(root => [...root.querySelectorAll('[data-library-action="save"]')]);
    // Runs on every editor change (each frame while playing): write only what changed.
    for (const button of saves) setProp(button, 'disabled', this.busy || !count || !available);
    // Properties' foot shows only when there is something to save (a figure or movieclip, in the desktop app).
    setProp(this.propertySave, 'hidden', !count || !available);
    setText(this.container.querySelector('.library-add .ui-label'), count > 1 ? `Add ${count} figures` : 'Add selection');
    for (const button of saves) setAttr(button, 'title', count ? `Save the selection in ${this.folder ? this.folder.split('/').at(-1) : 'My library'}` : 'Select figures or a movieclip to add them');
  }
  /** Empty grid: explain the library and offer the next action for this situation. */
  renderEmpty(filtered) {
    const selection = this.editor.selectedObjects.length, pub = this.source === 'public';
    // The kit's empty state: a title, one quiet line where it helps, then the next step.
    const card = (title, text, actions = '') => `<h3 class="ui-empty-title">${title}</h3>${text ? `<p class="ui-empty-text">${text}</p>` : ''}${actions ? `<div class="ui-empty-actions">${actions}</div>` : ''}`;
    const examples = '<button type="button" class="ui-button" data-variant="outline" data-size="sm" data-action="rig-examples">Rig examples</button>';
    const browse = '<button type="button" class="ui-button" data-variant="outline" data-size="sm" data-library-source-link="public">Browse the community library</button>';
    if (filtered) this.empty.innerHTML = card('No matches', '', '<button type="button" class="ui-button" data-size="sm" data-library-clear>Clear search</button>');
    else if (pub && !this.desktop?.listPublicLibrary) this.empty.innerHTML = card('Community library', 'Free figures and movieclips shared by the community, ready to drop into your scenes. Browse them on the website, or open them from the desktop app.', `<a class="ui-button" data-variant="outline" data-size="sm" href="${PUBLIC_PAGE}" target="_blank" rel="noopener noreferrer">Open stykanimate.com/library</a>`);
    else if (pub && this.publicState === 'error') this.empty.innerHTML = card('Community library is unavailable', esc(this.publicError), '<button type="button" class="ui-button" data-size="sm" data-library-retry>Try again</button>');
    else if (pub) this.empty.innerHTML = card('Nothing here yet', 'Figures and movieclips shared by the community appear here.');
    else if (!this.desktop?.listLibrary) this.empty.innerHTML = card('Library is available in the desktop app', 'Save figures and movieclips there to reuse them in any project.', examples);
    else if (this.folder) this.empty.innerHTML = card('Empty folder', 'Drag assets onto this folder’s name above, or add the selection here.', selection ? '' : examples);
    else this.empty.innerHTML = card('No saved assets yet', selection ? 'Add the selection below to reuse it in any project.' : 'Select figures or a movieclip and choose Add selection, or start from the community library.', `${selection ? '' : browse}${examples}`);
  }
  renderLocation(count) {
    const pub = this.source === 'public';
    setText(this.container.querySelector('.library-count'), pub ? plural(count, 'asset') : plural(count, 'item'));
  }

  // ---- My library ----
  async refresh(folder = this.folder) {
    if (this.source !== 'mine') return;
    if (!this.desktop?.listLibrary) { this.container.dataset.unavailable = 'true'; return this.render(); }
    delete this.container.dataset.unavailable;
    const generation = ++this.generation;
    this.closeMenu(); this.hoverPreview.stop();
    let result;
    try { result = await this.desktop.listLibrary(folder); }
    catch (error) { if (folder && /ENOENT/.test(error.message)) result = await this.desktop.listLibrary(''); else throw error; }
    if (generation !== this.generation || this.source !== 'mine') return;
    if (this.folder !== result.path) { this.selected = null; this.input.value = ''; }
    this.folder = result.path; this.entries = result.entries; this.root = result.root;
    const nav = this.container.querySelector('nav'); nav.replaceChildren();
    let current = ''; const parts = ['Library', ...this.folder.split('/').filter(Boolean)];
    for (const [i, part] of parts.entries()) {
      if (i) current += `${current ? '/' : ''}${part}`;
      if (i) { const sep = document.createElement('span'); sep.className = 'ui-crumb-sep'; sep.setAttribute('aria-hidden', 'true'); sep.textContent = '›'; nav.append(sep); }
      const path = current, button = document.createElement('button'); button.type = 'button'; button.className = 'ui-crumb-item'; button.textContent = part;
      button.title = i ? part : this.root; button.dataset.libraryFolder = path;
      if (i === parts.length - 1) button.setAttribute('aria-current', 'location');
      button.onclick = () => this.run(() => this.refresh(path));
      nav.append(button);
    }
    this.syncSelection();
    this.render();
  }

  // ---- Public library ----
  async loadPublic({refresh = false} = {}) {
    if (this.source !== 'public') return;
    if (!this.desktop?.listPublicLibrary) { this.publicState = 'unavailable'; return this.render(); }
    const generation = ++this.publicGeneration;
    if (!this.publicCatalog || refresh) { this.publicState = 'loading'; this.render(); }
    try {
      const catalog = await this.desktop.listPublicLibrary(refresh);
      if (generation !== this.publicGeneration) return;
      this.publicCatalog = catalog; this.publicState = 'ready'; this.publicError = '';
    } catch (error) {
      if (generation !== this.publicGeneration) return;
      this.publicError = plain(error);
      // A catalogue already shown stays usable; the failure is only reported.
      if (this.publicCatalog) { this.publicState = 'ready'; this.say(error.message, true); } else this.publicState = 'error';
    }
    if (this.source === 'public') this.render();
  }
  /** A stykanimate://library link: the Library opens on the public asset, selected and ready to insert. */
  async openPublic(id) {
    this.showView('library');
    await this.setSource('public');
    if (!id) return;
    let item = this.publicItems.find(item => item.id === id);
    if (!item && this.publicState === 'ready') { await this.loadPublic({refresh: true}); item = this.publicItems.find(item => item.id === id); }
    if (!item) { if (this.publicState === 'ready') this.say('That asset is no longer in the community library.', true); return; }
    if (!this.visibleItems().includes(item)) { this.input.value = ''; this.setFilter('all'); }
    this.publicSelected = id; this.render();
    const card = this.cardFor(id);
    card?.scrollIntoView({block: 'center'}); card?.focus({preventScroll: true});
    card?.classList.add('library-card-linked');
    this.say(`${item.name} is ready: drag it onto the canvas or double-click to insert it.`);
  }

  // ---- Cards ----
  render() {
    this.closeMenu(); this.hoverPreview.stop();
    this.observer.disconnect(); this.grid.replaceChildren();
    const pub = this.source === 'public', items = this.visibleItems();
    this.grid.setAttribute('aria-label', pub ? 'Community library' : 'My library');
    this.grid.removeAttribute('aria-busy');
    if (pub && this.publicState === 'loading') {
      this.grid.setAttribute('aria-busy', 'true'); this.empty.hidden = true; this.renderLocation(0);
      for (let i = 0; i < SKELETONS; i++) this.grid.insertAdjacentHTML('beforeend', '<div class="library-card is-skeleton" aria-hidden="true"><div class="library-thumbnail"></div><div class="library-card-info"><span class="library-name"></span><span class="library-kind"></span></div></div>');
      return;
    }
    this.renderLocation(items.length);
    this.empty.hidden = items.length > 0;
    const filtered = Boolean(this.input.value.trim() || this.filterValue !== 'all') && (pub ? this.publicItems.length : this.entries.length) > 0;
    if (!this.empty.hidden) this.renderEmpty(filtered);
    if (pub) {
      // Grouped by the website's categories, in its order.
      for (const category of this.publicCatalog?.categories ?? []) {
        const members = items.filter(item => item.category === category.id); if (!members.length) continue;
        const group = document.createElement('div'); group.className = 'library-group'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', category.name);
        group.innerHTML = `<div class="library-group-label"><span>${esc(category.name)}</span><span class="library-group-count">${members.length}</span></div>`;
        for (const item of members) group.append(this.card(item));
        this.grid.append(group);
      }
    } else for (const item of items) this.grid.append(this.card(item));
    for (const card of this.grid.querySelectorAll('.library-card')) if (!card.classList.contains('folder')) this.observer.observe(card);
    const key = this.selectedKey;
    this.select(items.some(item => (item.path ?? item.id) === key) ? key : null);
  }
  card(item) {
    const card = document.createElement('div'), pub = item.source === 'public';
    card.className = `library-card ${item.kind}`; card.tabIndex = -1;
    if (pub) card.dataset.publicId = item.id; else card.dataset.libraryPath = item.path;
    if (item.kind === 'folder') card.dataset.libraryFolder = item.path;
    card.setAttribute('role', 'option'); card.setAttribute('aria-selected', 'false'); card.setAttribute('aria-label', `${item.name}, ${label(item)}`);
    card.title = item.kind === 'folder' ? `${item.name}. Double-click to open, or drop assets here to move them.`
      : pub ? `${item.name}${item.author ? ` by ${item.author}` : ''}${item.description ? `: ${item.description}` : ''}\nDouble-click to insert, or drag onto the canvas.`
        : `${item.name}. Double-click to insert, or drag onto the canvas or a folder.${item.kind === 'movieclip' ? ' Hover to play.' : ''}`;
    const badge = ['movieclip', 'set'].includes(item.kind) ? `<span class="library-clip-badge" title="${label(item)}">${icon(item.kind === 'movieclip' ? 'play' : 'duplicate')}</span>` : '';
    const clip = item.kind === 'movieclip' && !pub ? '<span class="library-preview-hint">Hover to play</span><span class="library-preview-progress"></span>' : '';
    card.innerHTML = `<div class="library-thumbnail">${item.kind === 'folder' ? folderIcon : '<span class="library-preview-loading"></span>'}${badge}${clip}</div><div class="library-card-info"><span class="library-name">${esc(item.name)}</span><span class="library-kind">${label(item)}</span></div><button type="button" class="library-more" tabindex="-1" aria-label="Actions for ${esc(item.name)}" aria-haspopup="menu">${icon('more')}</button>`;
    return card;
  }
  async loadThumbnail(card, generation) {
    if (card.dataset.publicId) return this.loadPublicPreview(card, generation);
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
          if (generation === this.generation && card.isConnected) { item.kind = kind; card.setAttribute('aria-label',`${item.name}, ${label(item)}`); card.querySelector('.library-kind').textContent = label(item); }
          return thumbnail;
        };
        const pending = (this.previewChain ?? Promise.resolve()).then(generate); this.previewChain = pending.catch(() => {}); url = await pending;
      }
      if (generation !== this.generation || !card.isConnected) return;
      this.showThumbnail(card, key, url, item.name);
    } catch { if (card.isConnected) this.showThumbnail(card, key, null, item.name); }
  }
  async loadPublicPreview(card, generation) {
    const id = card.dataset.publicId, item = this.publicItems.find(item => item.id === id); if (!item) return;
    const key = `public:${id}:${item.sha256}`, current = () => this.source === 'public' && card.isConnected && generation === this.generation;
    try {
      const url = this.thumbnails.get(key) ?? await this.desktop.getPublicLibraryPreview(id);
      if (current()) this.showThumbnail(card, key, url, item.name);
    } catch { if (current()) this.showThumbnail(card, key, null, item.name); }
  }
  showThumbnail(card, key, url, name) {
    const target = card.querySelector('.library-thumbnail'); target.querySelector('.library-preview-loading')?.remove();
    if (!url) { target.insertAdjacentHTML('afterbegin', icon('person')); target.title = 'Preview unavailable for this file'; return; }
    this.thumbnails.delete(key); this.thumbnails.set(key, url); while (this.thumbnails.size > 160) this.thumbnails.delete(this.thumbnails.keys().next().value);
    const image = new Image(); image.alt = name; image.draggable = false; image.decoding = 'async';
    image.onload = () => {
      if (!card.isConnected) return;
      // The matte follows the artwork's own colours, so white and dark assets both read.
      const sample = document.createElement('canvas'); sample.width = sample.height = 40;
      const context = sample.getContext('2d', {willReadFrequently: true}); context.drawImage(image, 0, 0, 40, 40);
      const matte = LIBRARY_MATTES[libraryPreviewMatte(context.getImageData(0, 0, 40, 40).data)];
      card.dataset.matte = matte; if (!card.classList.contains('library-preview-playing')) card.style.setProperty('--library-matte', matte);
      card.classList.add('is-loaded');
    };
    image.src = url; target.prepend(image);
  }
  select(key) {
    if (this.source === 'public') this.publicSelected = key; else this.selected = key;
    const cards = [...this.grid.querySelectorAll('.library-card:not(.is-skeleton)')];
    let focusable = null;
    for (const card of cards) {
      const chosen = key != null && this.keyOf(card) === key;
      card.classList.toggle('selected', chosen); card.setAttribute('aria-selected', String(chosen));
      if (chosen) focusable = card;
    }
    // One tab stop for the whole grid: the selected card, else the first.
    focusable ??= cards[0];
    for (const card of cards) card.tabIndex = card === focusable ? 0 : -1;
  }
  /** Arrow keys move by what is on screen: across a row, or to the nearest card in the row above or below. */
  neighbour(card, key) {
    const cards = [...this.grid.querySelectorAll('.library-card:not(.is-skeleton)')], index = cards.indexOf(card);
    if (key === 'Home') return cards[0]; if (key === 'End') return cards.at(-1);
    if (key === 'ArrowLeft') return cards[Math.max(0, index - 1)]; if (key === 'ArrowRight') return cards[Math.min(cards.length - 1, index + 1)];
    const from = card.getBoundingClientRect(), down = key === 'ArrowDown', x = from.left + from.width / 2;
    let best = null, bestRow = Infinity, bestX = Infinity;
    for (const other of cards) {
      const rect = other.getBoundingClientRect(), row = down ? rect.top - from.top : from.top - rect.top;
      if (row < 4) continue;
      const dx = Math.abs(rect.left + rect.width / 2 - x);
      if (row < bestRow - 4 || Math.abs(row - bestRow) <= 4 && dx < bestX) { best = other; bestRow = row; bestX = dx; }
    }
    return best ?? card;
  }
  onKey(event) {
    if (event.target.matches('input')) return;
    if (event.target.closest('button') && ['Enter', ' '].includes(event.key)) return;
    const card = this.cardFrom(event.target);
    if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
      event.preventDefault(); if (card) { const rect = card.getBoundingClientRect(); this.showMenu(card, {point: {x: rect.left, y: rect.bottom}}); } return;
    }
    if (event.key === 'Delete') { event.preventDefault(); if (!event.repeat && this.source === 'mine') this.run(() => this.action('trash')); return; }
    const command = this.hotkeys.resolve(event, ['library']);
    if (command?.scope === 'library') {
      event.preventDefault();
      if (!event.repeat) this.run(() => command.id === 'library-open' ? this.open(this.selectedKey) : this.rename());
    }
    else if (card && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const next = this.neighbour(card, event.key);
      this.select(this.keyOf(next)); next.focus(); next.scrollIntoView({block: 'nearest'});
    }
  }

  // ---- Menus ----
  closeMenu() { const menu = this.menu; this.menu = null; menu?.close('api', {restore: false}); }
  /** A card's menu, or the library's own (the ⋯ button, a right-click on empty space). */
  showMenu(card, {anchor = null, point = null, options = false} = {}) {
    this.hoverPreview.stop(); this.closeMenu();
    if (card) this.select(this.keyOf(card));
    const item = card ? this.itemFor(this.keyOf(card)) : null, pub = this.source === 'public', mine = !pub && Boolean(this.desktop?.listLibrary);
    const run = operation => () => this.run(operation);
    let items;
    if (item && pub) items = [
      {label: 'Insert', icon: 'plus', shortcut: 'Enter', disabled: this.busy, run: run(() => this.insert(item))},
      {label: 'Save to My library', icon: 'library', disabled: this.busy || !this.desktop?.savePublicLibraryAsset, run: run(() => this.savePublic(item))},
      null,
      {label: 'View on stykanimate.com', icon: 'link', run: run(() => this.desktop.openPublicLibraryPage(item.id))},
    ];
    else if (item) items = [
      {label: item.kind === 'folder' ? 'Open' : 'Insert', icon: item.kind === 'folder' ? 'folder' : 'plus', shortcut: 'Enter', disabled: this.busy, run: run(() => this.open(item.path))},
      {label: 'Rename', icon: 'text', shortcut: 'F2', disabled: this.busy, run: run(() => this.rename())},
      {label: 'Move to…', icon: 'arrow-right', disabled: this.busy, run: run(() => this.move())},
      {label: 'Show in folder', icon: 'folder', run: run(() => this.desktop.revealLibrary(item.kind === 'folder' ? item.path : parentOf(item.path)))},
      null,
      {label: 'Move to Recycle Bin', icon: 'trash', shortcut: 'Del', danger: true, disabled: this.busy, run: run(() => this.trash())},
    ];
    else {
      items = pub ? [
        {label: 'Refresh', icon: 'rotate', disabled: !this.desktop?.listPublicLibrary, run: run(() => this.loadPublic({refresh: true}))},
        {label: 'Open stykanimate.com/library', icon: 'link', run: run(() => this.action('website'))},
      ] : [
        {label: 'New folder', icon: 'folder-plus', disabled: !mine || this.busy, run: run(() => this.newFolder())},
        {label: 'Add selection', icon: 'plus', disabled: !mine || this.busy || !this.editor.selectedObjects.length, run: run(() => this.save())},
        null,
        {label: 'Refresh', icon: 'rotate', disabled: !mine, run: run(() => this.refresh())},
        {label: 'Show in folder', icon: 'folder', disabled: !mine, run: run(() => this.desktop.revealLibrary(this.folder))},
      ];
      if (options) items.push(null,
        {label: 'Preview background', icon: 'image', submenu: [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([value, text]) =>
          ({label: text, radio: true, checked: this.background === value, run: () => this.setBackground(value)}))},
        {label: 'Rig examples…', icon: 'person', command: 'rig-examples'});
    }
    const invoker = card ?? (anchor || this.grid.querySelector('.library-card[tabindex="0"]') || this.input);
    const menu = this.menu = openMenu({items, ...(anchor ? {anchor} : {point}), icon: name => icon(name), label: options ? 'Library options' : 'Library actions', invoker,
      onClose: () => { if (this.menu === menu) this.menu = null; }});
  }

  // ---- Actions ----
  /** The panel's [data-library-action] buttons (Add selection, New folder, the website) and Delete. */
  async action(action) {
    if (action === 'website') return this.desktop?.openPublicLibraryPage ? this.desktop.openPublicLibraryPage('') : window.open(PUBLIC_PAGE, '_blank', 'noopener');
    if (this.busy) return;
    if (action === 'save') return this.save();
    if (action === 'folder') return this.newFolder();
    if (action === 'trash') return this.trash();
  }
  dragDestination(hit, item) {
    const target = hit?.closest('[data-library-folder]');
    if (!target || item?.source === 'public' || this.source !== 'mine' || !this.container.contains(target) || this.busy || !canMoveLibraryItem(item, target.dataset.libraryFolder)) return null;
    return {element: target, folder: target.dataset.libraryFolder, name: target.dataset.libraryFolder.split('/').at(-1) || 'Library'};
  }
  async moveItem(item, folder) {
    if (this.busy || !canMoveLibraryItem(item, folder)) return;
    this.busy = true; this.syncSelection(); this.hoverPreview.stop();
    try {
      await this.desktop.changeLibraryItem({path: item.path, folder}); this.selected = null;
      await this.refresh(); this.say(`${item.name} moved to ${folder || 'Library'}`);
    } finally { this.busy = false; this.syncSelection(); }
  }
  async save() {
    if (!this.editor.selectedObjects.length || this.busy) return;
    this.pause(); this.finishEdit();
    // Saving lands in My library's open folder: show it there.
    if (this.source !== 'mine') await this.setSource('mine');
    this.show(); this.busy = true; this.syncSelection();
    this.say('Saving artwork and preview…');
    const folder = this.folder;
    try {
      const revision=this.editor.revision;await drawingBarrier(this.editor.report);if(revision!==this.editor.revision)throw new Error('The selection changed before saving to the library. Try again.');
      const report = librarySnapshot(this.editor), format = report._styk.libraryKind === 'movieclip' ? 'stykmov' : 'stkz';
      const [thumbnail, blob] = await Promise.all([libraryPreview(report), this.exporter.export(report, {format, figureUids:report.keyframes[0].objects.map(o => o.unique_id)})]);
      let name = report._styk.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/^\.+|[. ]+$/g,'').slice(0,110).trim() || 'Untitled asset';
      if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `Asset ${name}`;
      const result = await saveLibraryFile(this.desktop, blob, {folder, name, kind:report._styk.libraryKind, extension:`.${format}`, thumbnail});
      this.input.value = ''; this.filterValue = 'all'; this.kindSelect.value = 'all'; await this.refresh(folder); this.select(result.path); this.say(`Saved to ${folder || 'My library'}`);
      this.cardFor(result.path)?.scrollIntoView({block:'nearest'});
    } finally { this.busy = false; this.syncSelection(); }
  }
  async savePublic(item) {
    if (this.busy) return;
    this.busy = true; this.syncSelection(); this.say(`Saving ${item.name} to My library…`);
    try {
      // The library keeps PNG previews; the website's posters are WebP, so the poster is converted here.
      const thumbnail = await pngThumbnail(this.thumbnails.get(`public:${item.id}:${item.sha256}`) ?? await this.desktop.getPublicLibraryPreview(item.id));
      const result = await this.desktop.savePublicLibraryAsset({id: item.id, folder: this.folder, thumbnail});
      this.say(`${item.name} saved to ${this.folder ? `My library › ${this.folder.split('/').join(' › ')}` : 'My library'}`);
      return result;
    } finally { this.busy = false; this.syncSelection(); }
  }
  async open(key) {
    const item = this.itemFor(key); if (!item || this.busy) return;
    if (item.kind === 'folder') return this.refresh(item.path);
    return this.insert(item);
  }
  async readAsset(item) {
    if (item.source !== 'public') return readLibraryFile(this.desktop, item.path);
    const {name, bytes} = await this.desktop.readPublicLibraryAsset(item.id);
    return new File([bytes], name);
  }
  async insert(item, position) {
    if (this.busy) return;
    this.hoverPreview.stop();
    this.busy = true; this.syncSelection(); this.say(`Inserting ${item.name}…`);
    try {
      this.pause(); this.finishEdit();
      const report = this.editor.report, tick = this.editor.tick, layer = this.editor.activeLayerId;
      const file = await this.readAsset(item), result = await this.importer.importFile(file);
      if (this.editor.report !== report || this.editor.tick !== tick || this.editor.activeLayerId !== layer) throw new Error('The document or insertion frame changed. Insert the asset again.');
      const document = result.document ?? result.report ?? result;
      if (document.figure_types?.length === 1) document.figure_types[0].name = item.name;
      if (this.editor.getLayer(layer)?.locked) throw new Error('Unlock the destination layer before inserting an asset.');
      this.editor.importFigure(document, {position}); this.setTool('select'); this.say(`${item.name} added to the scene`);
    } finally { this.busy = false; this.syncSelection(); }
  }
  rename() {
    this.hoverPreview.stop();
    const item = this.source === 'mine' ? this.entries.find(item => item.path === this.selected) : null; if (!item || this.busy) return;
    const card = this.cardFor(item.path), name = card?.querySelector('.library-name'); if (!name || card.querySelector('input')) return;
    const input = document.createElement('input'); input.className = 'library-rename'; input.value = item.name; input.maxLength = 120; input.setAttribute('aria-label','Asset name'); name.replaceWith(input); input.focus(); input.select();
    let done = false;
    const commit = async () => {
      if (done) return; done = true;
      try { const result = await this.desktop.changeLibraryItem({path:item.path, name:input.value}); this.selected = result.path; await this.refresh(); this.cardFor(result.path)?.focus({preventScroll: true}); }
      catch (error) { done = false; this.say(error.message, true); input.focus(); }
    };
    input.onkeydown = event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); commit(); } else if (event.key === 'Escape') { done = true; this.render(); this.cardFor(item.path)?.focus({preventScroll: true}); } };
    input.onblur = commit;
  }
  newFolder() {
    this.dialog.setAttribute('aria-label','New library folder');
    this.dialog.innerHTML = `<form><h2>New folder</h2><p>In ${esc(this.folder ? this.folder.split('/').join(' › ') : 'My library')}</p><label>Folder name<input name="name" aria-label="Folder name" value="New folder" maxlength="120" required></label><div class="library-dialog-error" role="alert"></div><footer><button class="ui-button" data-variant="ghost" type="button" data-cancel>Cancel</button><button class="ui-button" data-variant="primary" type="submit">Create folder</button></footer></form>`;
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
    this.dialog.innerHTML = `<h2>Move ${esc(item.name)}</h2><div class="library-move-location"></div><div class="library-move-folders"></div><div role="alert" class="library-dialog-error"></div><footer><button type="button" class="ui-button" data-variant="ghost" data-cancel>Cancel</button><button type="button" class="ui-button" data-variant="primary" data-move>Move here</button></footer>`;
    const browse = async folder => {
      const id = ++sequence, result = await this.desktop.listLibrary(folder); if (id !== sequence) return; destination = folder;
      this.dialog.querySelector('.library-move-location').textContent = `Library${folder ? ` › ${folder.replaceAll('/',' › ')}` : ''}`;
      const list = this.dialog.querySelector('.library-move-folders'); list.replaceChildren();
      // A row per place: the parent first (a back chevron), then each folder with its glyph.
      const add = (text, path, glyph) => { const button = document.createElement('button'); button.type = 'button'; button.innerHTML = icon(glyph); const words = document.createElement('span'); words.textContent = text; button.append(words); button.onclick = () => this.run(() => browse(path)); list.append(button); return button; };
      if (folder) add('Parent folder', parentOf(folder), 'chevron-left').dataset.parent = '';
      for (const child of result.entries.filter(child => child.kind === 'folder' && child.path !== item.path)) add(child.name, child.path, 'folder');
      if (!list.children.length) { const none = document.createElement('p'); none.className = 'library-move-none'; none.textContent = 'No folders here'; list.append(none); }
    };
    this.dialog.querySelector('[data-cancel]').onclick = () => this.dialog.close();
    this.dialog.querySelector('[data-move]').onclick = async event => {
      event.target.disabled = true;
      try { await this.desktop.changeLibraryItem({path:item.path, folder:destination}); this.dialog.close(); this.selected = null; await this.refresh(); this.say(`Moved to ${destination || 'Library'}`); }
      catch (error) { this.dialog.querySelector('[role="alert"]').textContent = error.message; } finally { event.target.disabled = false; }
    };
    await browse(''); this.dialog.showModal();
  }
  trash() {
    const item = this.source === 'mine' ? this.entries.find(item => item.path === this.selected) : null; if (!item) return;
    this.dialog.setAttribute('aria-label','Remove library item');
    this.dialog.innerHTML = `<h2>Remove ${esc(item.name)}?</h2><p>${item.kind === 'folder' ? 'This folder and its contents' : 'This asset and its preview'} will move to the Recycle Bin. Copies already in your scenes stay available.</p><div class="library-dialog-error" role="alert"></div><footer><button type="button" class="ui-button" data-variant="ghost" data-cancel>Cancel</button><button type="button" class="ui-button" data-variant="danger" data-remove>Move to Recycle Bin</button></footer>`;
    this.dialog.querySelector('[data-cancel]').onclick = () => this.dialog.close();
    this.dialog.querySelector('[data-remove]').onclick = async event => {
      event.target.disabled = true;
      try { await this.desktop.trashLibraryItem(item.path); this.dialog.close(); this.selected = null; await this.refresh(); this.say('Moved to Recycle Bin'); }
      catch (error) { this.dialog.querySelector('[role="alert"]').textContent = error.message; } finally { event.target.disabled = false; }
    };
    this.dialog.showModal(); this.dialog.querySelector('[data-cancel]').focus();
  }
}
