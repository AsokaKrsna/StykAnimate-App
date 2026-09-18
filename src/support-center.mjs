import { SUPPORT_LIMITS, SUPPORT_CATEGORIES, SUPPORT_STATUSES, SUPPORT_PRIORITIES, supportError, supportFileType } from './support-contract.mjs';
import { prepareSupportFile } from './support-media.mjs';
import { SupportLiveUpdates, subscribeWebSupport } from './support-live-client.mjs';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const optionHtml = values => Object.entries(values).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
const formatBytes = value => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;
const date = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const time = value => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const saveBlob = (blob, name) => { const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
function button(text, handler, className = '') { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', handler); return node; }
const statusLabel = (status, admin = false) => admin && status === 'waiting' ? 'Waiting for creator' : SUPPORT_STATUSES[status] || status;
function pill(status, admin = false) { const node = el('span', statusLabel(status, admin), 'sc-pill'); node.dataset.status = status; return node; }

/** One view and contract for the website, private moderation inbox, and Electron. */
export class SupportCenter {
  constructor(root, { api, admin = false, context = {}, copyAccess, restoreAccess, storageKey = 'styk-support-drafts', storage = null, downloadFile, onThreadOpen, subscribeLive } = {}) {
    Object.assign(this, { root, api, admin, context, copyAccess, restoreAccess, storageKey, storage, downloadFile, onThreadOpen });
    this.busy = false; this.thread = null; this.items = []; this.messages = new Map(); this.attachments = []; this.drafts = {}; this.previews = new Set(); this.generation = 0; this.lastActivity = Date.now(); this.active = true;
    try { this.drafts = JSON.parse(storage?.getItem(storageKey) || '{}'); } catch { /* Storage can be disabled. */ }
    this.mount();
    this.onActivity = () => { this.lastActivity = Date.now(); };
    this.live = new SupportLiveUpdates({ subscribe: subscribeLive || ((id, event) => subscribeWebSupport(this.api, id, event)), changed: () => { this.liveDirty = true; this.flushLive(); }, status: value => { const node = this.$('.sc-live'); if (node) node.textContent = value; } });
    this.onVisibility = () => this.schedule();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('focus', this.onVisibility);
    root.addEventListener('pointerdown', this.onActivity); root.addEventListener('keydown', this.onActivity);
    this.beforeUnload = event => { if (this.busy || this.pendingFiles.length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', this.beforeUnload);
  }
  $(selector) { return this.root.querySelector(selector); }
  /** Files are bound to the send they were queued with: a failed upload retries
   * its own list, never whatever happens to be selected in the form later. */
  get pendingFiles() { return this.pendingCreation?.queue ?? this.pendingMessage?.queue ?? (this.files ??= []); }
  mount() {
    this.root.classList.add('support-center');
    if (this.admin) { this.root.classList.add('sc-admin'); this.root.dataset.view = 'inbox'; this.mountAdmin(); return; }
    this.root.dataset.view = 'create';
    this.root.innerHTML = `<div class="sc-top"><nav class="sc-tabs" aria-label="Feedback" data-top-actions></nav><details class="sc-access"><summary>Inbox access</summary><div class="sc-access-actions"></div></details></div>
      <div class="sc-notice" role="status" aria-live="polite" hidden></div><div data-recovery hidden></div>
      <div class="sc-grid"><aside class="sc-inbox"><div class="sc-inbox-header"><strong>My reports</strong><button type="button" class="sc-refresh" data-refresh>Refresh</button></div><div data-filters></div><div class="sc-list" aria-label="Report conversations"></div><button type="button" class="sc-load" data-more hidden>Load more reports</button></aside><div class="sc-body" data-body></div></div><div data-capacity></div>`;
    this.$('[data-refresh]').onclick = () => void this.refresh();
    this.$('[data-more]').onclick = () => void this.loadList(true);
    const create = button('New report', () => this.showCreate()); create.dataset.navCreate = '';
    const inbox = button('My reports', () => this.showInbox()); inbox.dataset.navInbox = '';
    this.$('[data-top-actions]').append(create, inbox);
    if (this.copyAccess) this.$('.sc-access-actions').append(button('Save private access link', () => void this.accessPanel()));
    if (this.restoreAccess) this.$('.sc-access-actions').append(button('Open an existing inbox', () => this.restorePanel()));
    if (this.context.source === 'desktop') { this.$('.sc-access>summary').textContent = 'Other devices'; this.$('.sc-access-actions button').textContent = 'Copy access link'; }
  }
  /** Moderation workspace: queue rail, conversation list, and the open report with its properties. */
  mountAdmin() {
    this.root.innerHTML = `<div class="sc-notice" role="status" aria-live="polite" hidden></div><div data-recovery hidden></div>
      <div class="sc-workspace"><aside class="sc-nav" aria-label="Report queues and filters"><div class="sc-layout" role="group" aria-label="Layout"><button type="button" data-layout="list" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>List</button><button type="button" data-layout="board" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="5" height="16" rx="1.2"/><rect x="9.5" y="4" width="5" height="10" rx="1.2"/><rect x="15.5" y="4" width="5" height="13" rx="1.2"/></svg>Board</button></div><div class="sc-nav-section"><h3>Queues</h3><nav class="sc-queues" aria-label="Report queues"></nav></div><div class="sc-nav-section" data-filters></div><div class="sc-nav-foot" data-capacity></div></aside>
      <div class="sc-grid"><aside class="sc-inbox"><div class="sc-inbox-header"><strong>Inbox</strong><span class="sc-inbox-count" data-count hidden></span><button type="button" class="sc-refresh" data-refresh title="Refresh inbox" aria-label="Refresh inbox"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg></button></div><div data-search></div><div class="sc-list" aria-label="Report conversations"></div><button type="button" class="sc-load" data-more hidden>Load more reports</button></aside><div class="sc-body" data-body></div></div>
      <section class="sc-board" aria-label="Report board" hidden></section></div>`;
    this.$('[data-refresh]').onclick = () => void this.refresh();
    this.$('[data-more]').onclick = () => void this.loadList(true);
    this.root.querySelectorAll('[data-layout]').forEach(node => node.onclick = () => void this.setLayout(node.dataset.layout));
    this.filters();
    this.layout = 'list'; this.boardItems = [];
    let saved = null; try { saved = localStorage.getItem('styk-admin-layout'); } catch { /* Layout preference is optional. */ }
    if (saved === 'board') this.pendingLayout = 'board';
  }
  /** Board view: one column per status, cards move by drag or by the accessible status control. */
  static get BOARD_COLUMNS() { return [['new', 'New'], ['triaged', 'Under review'], ['waiting', 'Waiting for creator'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['closed', 'Closed']]; }
  async setLayout(layout) {
    if (!this.admin || this.layout === layout) return;
    this.hideCardPreview();
    if (layout === 'board' && (this.busy || this.pendingFiles.length || this.pendingMessage)) { this.notice('Finish sending or remove selected files before switching to the board.'); return; }
    this.layout = layout; this.root.dataset.layout = layout;
    try { localStorage.setItem('styk-admin-layout', layout); } catch { /* Preference stays in memory. */ }
    this.root.querySelectorAll('[data-layout]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.layout === layout)));
    const statusFilter = this.root.querySelector('[data-filters] [name=status]'); if (statusFilter) statusFilter.disabled = layout === 'board';
    this.$('.sc-grid').hidden = layout === 'board'; this.$('.sc-board').hidden = layout !== 'board';
    if (layout === 'board') { if (this.thread) { this.resetDetail(); this.thread = null; this.emptyDetail(); this.setView('inbox'); this.renderList(); } await this.loadBoard(); }
    else this.schedule();
  }
  async loadBoard() {
    if (this.boardBusy) return; this.boardBusy = true;
    const board = this.$('.sc-board'); board.setAttribute('aria-busy', 'true');
    try {
      const query = new URLSearchParams(this.query || {}); query.delete('status');
      const items = []; let cursor = null, pages = 0;
      // A bounded number of ordinary list pages; the board is a view of the same list, not a new query budget.
      do { if (cursor) query.set('cursor', cursor); const result = await this.api('/threads?' + query); if (this.disposed) return; items.push(...result.threads); cursor = result.nextCursor; pages++; } while (cursor && pages < 4);
      this.boardItems = items.filter((item, i, rows) => rows.findIndex(r => r.id === item.id) === i); this.boardTruncated = Boolean(cursor);
      this.renderBoard();
    } catch (error) { this.notice(supportError(error), true); }
    finally { this.boardBusy = false; board.removeAttribute('aria-busy'); }
  }
  renderBoard() {
    this.hideCardPreview();
    const board = this.$('.sc-board'); if (!board) return; board.replaceChildren();
    const today = new Date().toISOString().slice(0, 10), columns = el('div', null, 'sc-board-columns');
    for (const [status, name] of SupportCenter.BOARD_COLUMNS) {
      const rows = this.boardItems.filter(row => status === 'closed' ? ['closed', 'spam'].includes(row.status) : row.status === status);
      const column = el('section', null, 'sc-column'); column.dataset.status = status; column.setAttribute('aria-label', `${name}: ${rows.length} reports`);
      const head = el('header', null, 'sc-column-head'); head.append(el('h3', name), el('span', String(rows.length), 'sc-column-count')); column.append(head);
      const body = el('div', null, 'sc-column-body'); column.append(body);
      if (!rows.length) body.append(el('p', 'Nothing here', 'sc-column-empty'));
      for (const row of rows) body.append(this.boardCard(row, today));
      column.ondragover = event => { if (!this.dragging) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; column.classList.add('sc-drop'); };
      column.ondragleave = event => { if (!column.contains(event.relatedTarget)) column.classList.remove('sc-drop'); };
      column.ondrop = event => { event.preventDefault(); column.classList.remove('sc-drop'); const id = this.dragging || event.dataTransfer.getData('text/plain'); this.dragging = null; if (id) void this.moveCard(id, status); };
      columns.append(column);
    }
    board.append(columns);
    if (this.boardTruncated) board.append(el('p', `Showing the latest ${this.boardItems.length} reports. Narrow the queue or filters to see older ones.`, 'sc-small sc-board-note'));
  }
  boardCard(row, today) {
    const card = el('article', null, 'sc-card'); card.dataset.id = row.id; card.draggable = true;
    if (row.unread) card.classList.add('sc-unread');
    card.dataset.priority = row.priority || 'normal';
    const priority = el('span', SUPPORT_PRIORITIES[card.dataset.priority], 'sc-priority sc-card-priority'); priority.dataset.priority = card.dataset.priority;
    priority.setAttribute('aria-label', `${priority.textContent} priority`);
    const open = button(row.title, () => { void this.setLayout('list').then(() => this.openThread(row.id)); }, 'sc-card-title'); if (row.unread) { const dot = el('i', null, 'sc-dot'); dot.setAttribute('aria-label', 'Unread reply'); open.prepend(dot); }
    const meta = el('div', null, 'sc-card-meta'); meta.append(el('span', SUPPORT_CATEGORIES[row.category]), el('span', row.displayName || 'Creator'), el('time', date(row.createdAt)));
    const tags = el('div', null, 'sc-card-tags');
    if (row.status === 'spam') tags.append(pill('spam', true));
    if (row.followUp) { const due = el('span', `Follow up ${date(row.followUp + 'T00:00:00')}`, 'sc-item-followup'); if (row.followUp <= today) due.dataset.due = ''; tags.append(due); }
    if (row.assigned) tags.append(el('span', 'Me', 'sc-item-assignee'));
    if (row.tags) for (const tag of row.tags.split(',').map(value => value.trim()).filter(Boolean).slice(0, 3)) tags.append(el('span', tag, 'sc-card-tag'));
    const move = el('select', null, 'sc-card-move'); move.setAttribute('aria-label', `Move “${row.title}” to`); move.innerHTML = optionHtml({ ...SUPPORT_STATUSES, waiting: 'Waiting for creator' }); move.value = row.status;
    move.onchange = () => void this.moveCard(row.id, move.value);
    card.append(priority, open, meta, tags, move);
    const preview = () => { clearTimeout(this.previewTimer); this.previewTimer = setTimeout(() => this.showCardPreview(card, open, row), 250); };
    card.onpointerenter = event => { if (event.pointerType !== 'touch') preview(); };
    card.onpointerleave = () => this.deferHideCardPreview();
    open.onfocus = preview;
    open.onblur = () => this.deferHideCardPreview();
    card.onpointerdown = () => this.hideCardPreview();
    card.ondragstart = event => { this.hideCardPreview(); this.dragging = row.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', row.id); card.classList.add('sc-dragging'); };
    card.ondragend = () => { this.dragging = null; card.classList.remove('sc-dragging'); this.root.querySelectorAll('.sc-drop').forEach(node => node.classList.remove('sc-drop')); };
    return card;
  }
  deferHideCardPreview() {
    clearTimeout(this.previewTimer); clearTimeout(this.previewHideTimer);
    this.previewHideTimer = setTimeout(() => this.hideCardPreview(), 180);
  }
  hideCardPreview() {
    clearTimeout(this.previewTimer); clearTimeout(this.previewHideTimer);
    this.previewAnchor?.removeAttribute('aria-describedby'); this.previewAnchor = null;
    this.cardPreview?.remove(); this.cardPreview = null;
    document.removeEventListener('keydown', this.previewKey);
    document.removeEventListener('scroll', this.previewScroll, true);
    window.removeEventListener('resize', this.previewResize);
  }
  showCardPreview(card, anchor, row) {
    this.hideCardPreview();
    if (!row.description || !card.isConnected || this.dragging || this.disposed || !this.active || this.layout !== 'board') return;
    const preview = el('div', row.description, 'sc-card-preview');
    preview.id = `sc-preview-${row.id}`; preview.setAttribute('role', 'tooltip'); preview.setAttribute('popover', 'manual');
    this.cardPreview = preview; this.previewAnchor = anchor;
    this.root.append(preview); preview.showPopover(); anchor.setAttribute('aria-describedby', preview.id);
    const rect = card.getBoundingClientRect(), box = preview.getBoundingClientRect(), gap = 8;
    let left = rect.right + gap;
    if (left + box.width > innerWidth - gap) left = rect.left - box.width - gap;
    preview.style.left = `${Math.max(gap, Math.min(left, innerWidth - box.width - gap))}px`;
    preview.style.top = `${Math.max(gap, Math.min(rect.top, innerHeight - box.height - gap))}px`;
    preview.onpointerenter = () => clearTimeout(this.previewHideTimer);
    preview.onpointerleave = () => this.deferHideCardPreview();
    this.previewKey = event => { if (event.key === 'Escape') this.hideCardPreview(); };
    this.previewScroll = event => { if (!preview.contains(event.target)) this.hideCardPreview(); };
    this.previewResize = () => this.hideCardPreview();
    document.addEventListener('keydown', this.previewKey);
    document.addEventListener('scroll', this.previewScroll, true);
    window.addEventListener('resize', this.previewResize);
  }
  async moveCard(id, status) {
    const row = this.boardItems.find(item => item.id === id); if (!row || row.status === status || this.boardBusy) return;
    const previous = row.status; row.status = status; this.renderBoard();
    try {
      await this.api(`/threads/${id}`, { method: 'PATCH', body: { status, priority: row.priority || 'normal', tags: row.tags || '', assigned: Boolean(row.assigned), followUp: row.followUp || '', duplicateOf: row.duplicateOf || '', version: Number(row.version) } });
      this.notice(`Moved “${row.title}” to ${status === 'waiting' ? 'Waiting for creator' : SUPPORT_STATUSES[status]}.`);
      await this.loadBoard();
    } catch (error) { row.status = previous; this.renderBoard(); this.notice(supportError(error), true); if (error.code === 'stale_report') await this.loadBoard(); }
  }
  setView(view) {
    this.root.dataset.view = view;
    this.$('[data-nav-create]')?.setAttribute('aria-current', view === 'create' ? 'page' : 'false');
    this.$('[data-nav-inbox]')?.setAttribute('aria-current', view !== 'create' ? 'page' : 'false');
  }
  showInbox() {
    if (this.busy || this.pendingFiles.length || this.pendingCreation || this.pendingMessage) { this.notice('Finish sending or remove selected files before switching views.'); return; }
    this.resetDetail(); this.thread = null; this.setView('inbox'); if (this.admin) this.emptyDetail(); this.renderList(); void this.loadList();
  }
  async start() {
    try {
      const config = await this.api('/config'); if (this.disposed) return this; this.config = config;
      if (config.paused) this.notice('New reports are temporarily paused. Existing conversations are still available.');
      if (this.admin) { this.emptyDetail(); await this.loadCapacity(); } else this.showCreate();
      if (this.admin && this.pendingLayout === 'board') { this.pendingLayout = null; await this.setLayout('board'); } else await this.loadList();
      if (!this.admin && this.items.length && !this.drafts.create?.title && !this.drafts.create?.description) this.setView('inbox');
    } catch (error) { if (this.disposed) return this; this.notice(supportError(error), true); if (!this.admin && !this.$('form')) this.showCreate(); }
    this.schedule();
    return this;
  }
  notice(message, error = false) { const node = this.$('.sc-notice'); if (this.disposed || !node) return; node.textContent = message; node.hidden = !message; node.setAttribute('role', error ? 'alert' : 'status'); }
  saveDraft(key, data) {
    this.drafts[key] = data;
    // Bound browser storage and never persist File objects or admin notes.
    const entries = Object.entries(this.drafts).slice(-12); this.drafts = Object.fromEntries(entries);
    try { this.storage?.setItem(this.storageKey, JSON.stringify(this.drafts)); } catch { /* The in-memory draft remains. */ }
  }
  remember() {
    const form = this.$('[data-create]');
    if (form) { const draft = {}; for (const [key, value] of new FormData(form)) if (typeof value === 'string') draft[key] = value; draft.requestId = this.createId; this.saveDraft('create', draft); }
    const reply = this.$('[data-reply]'); if (reply && this.thread) this.saveDraft(this.thread.id, { message: reply.elements.message.value, requestId: this.replyId });
  }
  resetDetail(remember = true) {
    this.live?.stop(); this.liveDirty = false;
    if (remember) this.remember(); this.generation++; this.files = []; this.pendingMessage = null; this.pendingCreation = null; this.messages.clear();
    for (const url of this.previews) URL.revokeObjectURL(url); this.previews.clear();
    this.$('[data-body]').replaceChildren();
    delete this.$('[data-body]').dataset.threadView;
  }
  showCreate(category) {
    if (this.busy) { this.notice('Please wait for the current send to finish.'); return; }
    if (this.pendingCreation) { this.notice('Retry the remaining attachments or continue to the conversation first.'); return; }
    if (this.pendingFiles.length) { this.notice('Send or remove the selected files before switching views.'); return; }
    this.resetDetail(); this.thread = null; this.setView('create'); this.renderList();
    const draft = this.drafts.create || {}; this.createId = draft.requestId || crypto.randomUUID();
    const box = this.$('[data-body]');
    box.innerHTML = `<form data-create novalidate><div class="sc-steps" aria-label="Report steps"><button type="button" data-step-nav="1">1 <span>Report</span></button><span class="sc-step-line"></span><button type="button" data-step-nav="2">2 <span>Details</span></button></div>
      <div class="sc-fields" data-step="1">
      <label class="sc-full">Report type<select name="category">${optionHtml(SUPPORT_CATEGORIES)}</select></label>
      <label class="sc-full">Title<input name="title" required minlength="5" maxlength="120" placeholder="A short summary"></label>
      <label class="sc-full">Description<textarea name="description" required minlength="10" maxlength="4000" placeholder="What happened, or what would you like to change?"></textarea></label></div>
      <div class="sc-fields" data-step="2" hidden>
      <label class="sc-full" data-bug>Steps to reproduce<textarea name="steps" maxlength="2000" placeholder="1. Open a project&#10;2. …"></textarea></label>
      <label class="sc-full" data-bug>Expected result<textarea name="expected" maxlength="1000" placeholder="What should have happened?"></textarea></label>
      <details class="sc-extra sc-full"><summary>Additional details <span>Optional</span></summary><div class="sc-fields">
      <label>Your name<input name="displayName" maxlength="50" autocomplete="nickname"></label>
      <label data-bug>Frequency<select name="frequency"><option value="">Not sure</option><option>Every time</option><option>Sometimes</option><option>Only once</option></select></label>
      <label>App version<input name="version" maxlength="40" placeholder="e.g. 1.0.5"></label><label>Operating system<input name="platform" maxlength="80" placeholder="e.g. Windows 11"></label>
      <label class="sc-full" data-bug>Actual result<textarea name="actual" maxlength="1000"></textarea></label></div></details></div>
      <div class="sc-full sc-create-files" data-file-mount></div>
      <footer class="sc-form-footer"><span class="sc-small">Private · only you and the developer</span><div class="sc-actions"><button type="button" data-back hidden>Back</button><button type="button" class="sc-primary" data-next>Continue</button><button type="submit" class="sc-primary" hidden>Send report</button></div></footer>
      <details class="sc-retention"><summary>Privacy & limits</summary><p>Reports expire after 90 days; files after 30 days. Only submitted text and selected files are sent. Remove private information from attachments.</p></details></form>`;
    const form = this.$('[data-create]');
    for (const [name, value] of Object.entries({ version: this.context.version || '', platform: this.context.platform || '', ...draft })) if (form.elements.namedItem(name)) form.elements.namedItem(name).value = value;
    if (category && Object.hasOwn(SUPPORT_CATEGORIES, category)) form.elements.category.value = category;
    const update = () => { const bug = ['bug', 'performance'].includes(form.elements.category.value); this.root.querySelectorAll('[data-bug]').forEach(node => node.hidden = !bug); form.elements.steps.required = bug; form.elements.expected.required = bug; };
    update(); form.elements.category.onchange = update; form.addEventListener('input', () => this.remember());
    this.filePicker(this.$('[data-file-mount]'));
    if (this.config?.paused) { form.querySelector('[type=submit]').disabled = true; }
    this.formStep = 1;
    const changeStep = (step, validate = true) => {
      if (this.busy || this.pendingCreation) return;
      if (step === 2 && validate) { const invalid = [...form.querySelectorAll('[data-step="1"] input,[data-step="1"] textarea')].find(node => !node.checkValidity()); if (invalid) { invalid.reportValidity(); return; } }
      this.formStep = step;
      for (const node of form.querySelectorAll('[data-step]')) node.hidden = Number(node.dataset.step) !== step;
      for (const node of form.querySelectorAll('[data-step-nav]')) node.setAttribute('aria-current', Number(node.dataset.stepNav) === step ? 'step' : 'false');
      form.querySelector('[data-back]').hidden = step === 1; form.querySelector('[data-next]').hidden = step === 2; form.querySelector('[type=submit]').hidden = step === 1;
    };
    form.querySelector('[data-next]').onclick = () => changeStep(2); form.querySelector('[data-back]').onclick = () => changeStep(1);
    form.querySelectorAll('[data-step-nav]').forEach(node => node.onclick = () => changeStep(Number(node.dataset.stepNav)));
    changeStep(1, false);
    form.onsubmit = event => {
      event.preventDefault(); if (this.formStep === 1) { changeStep(2); return; }
      const invalid = [...form.elements].find(node => node.willValidate && !node.checkValidity());
      if (invalid) { changeStep(Number(invalid.closest('[data-step]').dataset.step), false); const details = invalid.closest('details'); if (details) details.open = true; invalid.reportValidity(); return; }
      void this.createReport(form);
    };
  }
  filePicker(mount) {
    mount.innerHTML = `<label class="sc-file-zone"><span class="sc-upload-button"><span aria-hidden="true">＋</span> Add images, videos or projects</span><p>Drop files or browse · 6 files / 24 MB · Media compressed locally</p><input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.mp4,.webm,.styk" aria-label="Attach images, videos or .styk projects"></label><div class="sc-preparing" role="status" hidden></div><div class="sc-files" data-pending-files></div>`;
    const input = mount.querySelector('input'), zone = mount.querySelector('label');
    if (this.config && !this.config.attachments) { input.disabled = true; zone.querySelector('p').textContent = 'Attachments are temporarily unavailable. You can still send a message.'; }
    input.onchange = () => { this.addFiles([...input.files]); input.value = ''; };
    zone.ondragover = event => { event.preventDefault(); if (!this.busy) zone.classList.add('sc-drag'); };
    zone.ondragleave = () => zone.classList.remove('sc-drag');
    zone.ondrop = event => { event.preventDefault(); zone.classList.remove('sc-drag'); this.addFiles([...event.dataTransfer.files]); };
    this.renderPendingFiles();
  }
  async addFiles(files) {
    if (this.busy || (this.config && !this.config.attachments) || (!this.admin && ['closed', 'spam'].includes(this.thread?.status))) return;
    if (this.pendingCreation || this.pendingMessage) { this.notice('Finish or cancel the current send before adding more files.', true); return; }
    const pending = this.pendingFiles, current = this.thread?.fileCount || 0, used = this.thread?.fileBytes || 0;
    this.setBusy(true, 'Preparing files…'); this.preparing = new AbortController();
    const status = this.$('.sc-preparing'), label = el('span'); status.hidden = false;
    status.replaceChildren(label, button('Cancel', () => this.preparing?.abort()));
    try {
      for (const original of files.slice(0, 6)) {
        if (current + pending.length >= 6) { this.notice('A conversation can hold up to 6 files and 24 MB.', true); break; }
        try {
          label.textContent = `Preparing ${original.name}…`;
          const file = await prepareSupportFile(original, { signal: this.preparing.signal, progress: percent => { label.textContent = `Compressing ${original.name} · ${percent}%`; } });
          if (used + pending.reduce((n, f) => n + f.file.size, 0) + file.size > SUPPORT_LIMITS.threadFileBytes) { this.notice('A conversation can hold up to 6 files and 24 MB. Remove a file before adding another.', true); break; }
          pending.push({ file, id: crypto.randomUUID(), originalBytes: original.size });
          this.renderPendingFiles();
        } catch (error) { if (error.name === 'AbortError') break; this.notice(supportError(error), true); }
      }
    } finally { status.hidden = true; this.preparing = null; this.setBusy(false); }
  }
  renderPendingFiles() {
    const mount = this.$('[data-pending-files]'); if (!mount) return;
    for (const media of mount.querySelectorAll('[src]')) { URL.revokeObjectURL(media.src); this.previews.delete(media.src); } mount.replaceChildren();
    this.pendingFiles.forEach((entry, index) => {
      const node = el('div', null, 'sc-file sc-attachment-card'), mime = supportFileType(entry.file.name);
      if (mime?.startsWith('image/') || mime?.startsWith('video/')) node.append(this.mediaPreview(entry.file, mime, entry.file.name));
      else node.append(el('div', 'STYK', 'sc-project-preview'));
      node.append(el('span', entry.file.name, 'sc-file-name'), el('span', formatBytes(entry.file.size) + (entry.originalBytes > entry.file.size ? ` · −${Math.round((1 - entry.file.size / entry.originalBytes) * 100)}%` : ''), 'sc-small'));
      const remove = button('×', () => { if (!this.busy) { this.pendingFiles.splice(index, 1); this.renderPendingFiles(); } }); remove.setAttribute('aria-label', `Remove ${entry.file.name}`); node.append(remove); mount.append(node);
    });
  }
  mediaPreview(blob, mime, name) {
    const video = mime.startsWith('video/'), media = el(video ? 'video' : 'img', null, 'sc-preview');
    if (video) { media.controls = true; media.preload = 'metadata'; media.playsInline = true; media.setAttribute('aria-label', name); }
    else media.alt = name;
    const url = URL.createObjectURL(blob); this.previews.add(url); media.src = url; return media;
  }
  setBusy(value, label = 'Sending…') {
    this.busy = value; this.root.setAttribute('aria-busy', String(value));
    this.root.querySelectorAll('[data-body] input,[data-body] select,[data-body] textarea,[data-body] button').forEach(node => node.disabled = value);
    const submit = this.$('[data-create] [type=submit]') || this.$('[data-reply] [type=submit]');
    if (submit) { if (value) { submit.dataset.previous = submit.textContent; submit.textContent = label; } else submit.textContent = submit.dataset.previous || 'Send message'; }
    if (!value) { this.syncComposerState(); this.flushLive(); }
  }
  async uploadPending(threadId, messageId, queue = this.files) {
    while (queue.length) {
      const entry = queue[0]; this.notice(`Uploading ${entry.file.name}…`);
      await this.api(`/threads/${threadId}/files?message=${messageId}&upload=${entry.id}`, { method: 'POST', body: entry.file, headers: { 'X-File-Name': encodeURIComponent(entry.file.name), 'Content-Type': 'application/octet-stream' } });
      queue.shift(); this.renderPendingFiles();
    }
  }
  async createReport(form) {
    if (this.busy || !form.reportValidity()) return;
    this.remember(); const payload = Object.fromEntries(new FormData(form)); payload.requestId = this.createId; payload.source = this.context.source || 'website';
    this.setBusy(true); let created;
    try {
      created = this.pendingCreation || await this.api('/threads', { method: 'POST', body: payload });
      if (!this.pendingCreation) created.queue = this.files; this.pendingCreation = created; this.files = [];
      await this.uploadPending(created.id, created.messageId, created.queue);
      this.pendingCreation = null; this.saveDraft('create', {}); this.createId = crypto.randomUUID(); form.reset(); this.setBusy(false);
      await this.loadList(); await this.openThread(created.id); this.notice('Report sent. Replies will appear here.');
    } catch (error) {
      this.notice(created ? `Your report was sent, but a file could not be uploaded. ${supportError(error)} Use “Retry attachments” or continue to your conversation.` : supportError(error), true);
      if (created) {
        const actions = el('div', null, 'sc-actions'); actions.dataset.retry = '';
        actions.append(button('Continue to conversation', async () => { this.pendingCreation = null; this.files = []; form.reset(); this.saveDraft('create', {}); await this.loadList(); await this.openThread(created.id); }));
        this.$('[data-retry]')?.remove(); form.append(actions);
      }
    } finally { this.setBusy(false); if (this.pendingCreation) { form.querySelector('[type=submit]').textContent = 'Retry attachments'; for (const node of form.querySelectorAll('input:not([type=file]),textarea')) node.readOnly = true; const fileInput = form.querySelector('[type=file]'); if (fileInput) fileInput.disabled = true; } }
  }
  async loadList(append = false) {
    if (this.listBusy) return; this.listBusy = true;
    const query = new URLSearchParams(this.query || {}); if (append && this.nextCursor) query.set('cursor', this.nextCursor);
    try { const result = await this.api('/threads?' + query); if (this.disposed) return; this.items = append ? [...this.items, ...result.threads].filter((item, i, rows) => rows.findIndex(r => r.id === item.id) === i) : result.threads; this.nextCursor = result.nextCursor; this.renderList(); }
    catch (error) { this.notice(supportError(error), true); }
    finally { this.listBusy = false; }
  }
  renderList() {
    const list = this.$('.sc-list'); list.replaceChildren();
    if (!this.items.length) { const empty = el('div', null, 'sc-empty'); empty.append(el('h3', this.admin ? 'No matching reports' : 'No reports yet')); if (!this.admin) empty.append(button('New report', () => this.showCreate(), 'sc-primary')); list.append(empty); }
    for (const row of this.items) {
      const node = button('', () => void this.openThread(row.id), 'sc-item'); node.setAttribute('aria-current', String(this.thread?.id === row.id));
      const title = el('span', row.title, 'sc-item-title'); if (row.unread) { const dot = el('i', null, 'sc-dot'); dot.setAttribute('aria-label', 'Unread reply'); title.prepend(dot); node.classList.add('sc-unread'); }
      if (this.admin) {
        const top = el('div', null, 'sc-item-row'); top.append(title, el('time', date(row.createdAt)));
        const meta = el('div', null, 'sc-item-meta'); meta.append(el('span', SUPPORT_CATEGORIES[row.category]), el('span', row.displayName || 'Creator'));
        if (row.source === 'desktop') meta.append(el('span', 'App'));
        const tags = el('div', null, 'sc-item-tags'); tags.append(pill(row.status, true));
        if (row.priority && row.priority !== 'normal') { const priority = el('span', SUPPORT_PRIORITIES[row.priority], 'sc-priority'); priority.dataset.priority = row.priority; tags.append(priority); }
        if (row.followUp) { const due = el('span', `Follow up ${date(row.followUp + 'T00:00:00')}`, 'sc-item-followup'); if (row.followUp <= new Date().toISOString().slice(0, 10)) due.dataset.due = ''; tags.append(due); }
        if (row.assigned) tags.append(el('span', 'Me', 'sc-item-assignee'));
        node.append(top, meta, tags);
      } else {
        const meta = el('div', null, 'sc-item-meta'); meta.append(el('span', SUPPORT_CATEGORIES[row.category]), el('time', date(row.createdAt)));
        node.append(meta, title, pill(row.status));
      }
      list.append(node);
    }
    this.$('[data-more]').hidden = !this.nextCursor;
    const count = this.$('[data-count]'); if (count) { count.textContent = `${this.items.length}${this.nextCursor ? '+' : ''}`; count.hidden = !this.items.length; }
    const inbox = this.$('[data-nav-inbox]'); if (inbox) inbox.textContent = `My reports${this.items.length ? ` (${this.items.length}${this.nextCursor ? '+' : ''})` : ''}`;
  }
  emptyDetail() {
    this.$('[data-body]').innerHTML = this.admin
      ? '<div class="sc-empty"><span class="sc-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/></svg></span><h3>Select a report</h3><p class="sc-small">Pick a conversation from the inbox to read it, reply, and set its status, priority and follow-up.</p></div>'
      : '<div class="sc-empty"><span class="sc-empty-icon" aria-hidden="true">☷</span><h3>Select a conversation</h3></div>';
  }
  async openThread(id) {
    if (this.busy) { this.notice('Please wait for the current send to finish.'); return; }
    if (this.pendingCreation) { this.notice('Retry the remaining attachments or continue to the conversation first.'); return; }
    if (this.pendingFiles.length || this.pendingMessage) { this.notice('Send or remove the selected files before switching conversations.'); return; }
    this.resetDetail(); this.setView('thread'); const generation = this.generation; this.thread = null;
    this.$('[data-body]').append(el('p', 'Opening conversation…', 'sc-small'));
    try {
      const data = await this.api(`/threads/${id}`); if (generation !== this.generation) return;
      this.thread = data.thread; this.attachments = data.files; this.messages = new Map(data.messages.map(m => [m.id, m])); this.nextBefore = data.nextBefore;
      this.renderThread(); this.renderList();
      this.lastActivity = Date.now(); this.livePaused = false;
      this.onThreadOpen?.(id);
      if (!this.admin) this.$('.sc-ticket-heading').scrollIntoView({ block: 'start', behavior: 'instant' });
      if (data.thread.unread && data.seen && !data.nextAfter) { await this.api(`/threads/${id}/seen`, { method: 'POST', body: { seq: data.seen } }); if (generation !== this.generation) return; const item = this.items.find(t => t.id === id); if (item) item.unread = false; this.renderList(); }
      this.schedule();
    } catch (error) { if (generation === this.generation) { this.emptyDetail(); this.notice(supportError(error), true); } }
  }
  renderThread() {
    const row = this.thread, body = this.$('[data-body]'); body.replaceChildren();
    body.dataset.threadView = '';
    const toolbar = el('div', null, 'sc-thread-toolbar');
    const back = button(this.admin ? '← Inbox' : '← My reports', () => this.showInbox(), 'sc-quiet'); if (this.admin) back.classList.add('sc-mobile-back'); toolbar.append(back);
    const live = el('span', 'Connecting…', 'sc-live'); live.title = 'Server-pushed updates; no idle polling';
    const check = button('Check for replies', () => void this.refreshThread(), 'sc-quiet');
    const actions = el('details', null, 'sc-report-menu'); actions.append(el('summary', this.admin ? 'Actions' : 'More'));
    const menu = el('div', null, 'sc-menu-actions');
    if (this.admin) menu.append(button('Copy report ID', () => this.copyId()));
    menu.append(button('Export conversation', () => void this.exportThread()), button('Delete report', () => this.confirmDelete(toolbar), 'sc-danger')); actions.append(menu);
    if (this.admin) toolbar.append(live, check, actions); else toolbar.append(check, live, actions);
    body.append(toolbar);
    const header = el('header', null, 'sc-ticket-heading'), top = el('div', null, 'sc-actions'); top.append(pill(row.status, this.admin), el('span', `#${row.id.slice(0, 8)} · ${SUPPORT_CATEGORIES[row.category]}`, 'sc-eyebrow'));
    header.append(top, el('h2', row.title));
    if (this.admin) {
      const facts = el('div', null, 'sc-ticket-facts');
      facts.append(el('span', row.displayName || 'Creator'), el('span', row.source === 'desktop' ? 'From the app' : 'From the website'), el('span', `Opened ${date(row.createdAt)}`));
      if (row.details?.version) facts.append(el('span', `v${row.details.version}`)); if (row.details?.platform) facts.append(el('span', row.details.platform));
      header.append(facts);
    }
    body.append(header);
    // The administrator reads and replies in one column while properties stay beside it.
    const main = this.admin ? el('div', null, 'sc-thread-main') : body; if (this.admin) { body.append(main); this.moderation(body); }
    const details = el('details', null, 'sc-details'), summary = el('summary', 'Report details'); details.append(summary); const dl = el('dl');
    const fields = [['steps','Steps'],['expected','Expected'],['actual','Actual'],['frequency','Frequency'],['version','App version'],['platform','System']].filter(([key]) => row.details?.[key]);
    if (this.admin) { summary.append(el('span', fields.length ? fields.map(([, label]) => label).join(' · ') : 'No reproduction details', 'sc-details-preview')); }
    else dl.append(el('dt', 'Opened'), el('dd', date(row.createdAt)), el('dt', 'Expires'), el('dd', date(row.expiresAt)));
    for (const [key, label] of fields) dl.append(el('dt', label), el('dd', row.details[key]));
    if (this.admin) dl.append(el('dt', 'Expires'), el('dd', date(row.expiresAt)));
    dl.append(el('dt', 'Sent from'), el('dd', row.source === 'desktop' ? 'StykAnimate app' : 'Website')); details.append(dl); main.append(details);
    const conversation = el('div', null, 'sc-conversation'); conversation.setAttribute('role', 'log'); conversation.setAttribute('aria-label', 'Report conversation'); conversation.setAttribute('aria-live', 'polite'); main.append(conversation); this.renderMessages();
    const more = button('Load earlier messages', () => void this.refreshThread(true), 'sc-load'); more.dataset.messagesMore = ''; more.hidden = !this.nextBefore; conversation.before(more);
    this.composer(main); this.syncComposerState();
    const generation = this.generation;
    requestAnimationFrame(() => { if (generation === this.generation && conversation.isConnected) conversation.scrollTop = conversation.scrollHeight; });
  }
  copyId() { void navigator.clipboard.writeText(this.thread.id).then(() => this.notice('Report ID copied.'), () => this.notice('Clipboard unavailable. The full ID is in the conversation export.', true)); }
  renderMessages() {
    const mount = this.$('.sc-conversation'); if (!mount) return;
    const nearEnd = mount.scrollHeight - mount.scrollTop - mount.clientHeight < 80;
    for (const msg of this.messages.values()) {
      let node = mount.querySelector(`[data-message="${msg.id}"]`);
      if (!node) {
        node = el('article', null, 'sc-message'); node.dataset.message = msg.id; node.dataset.role = msg.role; node.dataset.seq = msg.seq;
        const event = this.admin && msg.role === 'note' && msg.body.startsWith('Moderation: ');
        if (event) node.dataset.event = '';
        const header = el('header'), author = event ? 'Moderation change' : msg.role === 'note' ? (this.admin ? 'Private note' : 'Internal note · only you') : msg.role === 'developer' ? (this.admin ? 'You' : 'StykAnimate · Developer') : this.thread.displayName;
        if (this.admin) { const avatar = el('span', msg.role === 'note' ? '✎' : (msg.role === 'developer' ? 'S' : (this.thread.displayName || 'C')).slice(0, 1).toUpperCase(), 'sc-avatar'); avatar.dataset.role = msg.role; avatar.setAttribute('aria-hidden', 'true'); node.append(avatar); }
        header.append(el('strong', author), el('time', time(msg.createdAt))); node.append(header, el('p', event ? msg.body.slice('Moderation: '.length) : msg.body));
        const next = [...mount.children].find(child => Number(child.dataset.seq) > msg.seq); mount.insertBefore(node, next || null);
      }
      for (const file of this.attachments.filter(f => f.messageId === msg.id)) if (!node.querySelector(`[data-file="${file.id}"]`)) {
        const attachment = el('div', null, 'sc-file sc-attachment-card'); attachment.dataset.file = file.id;
        if (!file.mime.startsWith('image/') && !file.mime.startsWith('video/')) attachment.append(el('div', 'STYK', 'sc-project-preview'));
        attachment.append(el('span', file.name, 'sc-file-name'), el('span', formatBytes(file.bytes), 'sc-small'));
        attachment.append(button('Download', () => void this.getFile(file, false)));
        if (file.mime.startsWith('image/') || file.mime.startsWith('video/')) {
          attachment.prepend(el('div', 'Loading preview…', 'sc-preview-placeholder'));
          attachment.append(button('Preview', () => void this.getFile(file, true)));
          const generation = this.generation;
          this.previewQueue = (this.previewQueue || Promise.resolve()).catch(() => {}).then(() => { if (generation === this.generation && !this.disposed) return this.getFile(file, true); });
        }
        attachment.append(button('Remove', () => { if (!this.busy) this.confirmFileDelete(file, attachment); }, 'sc-quiet'));
        node.append(attachment);
      }
    }
    // A removed/expired attachment must disappear without replacing text or the reply draft.
    mount.querySelectorAll('[data-file]').forEach(node => { if (!this.attachments.some(f => f.id === node.dataset.file)) node.remove(); });
    mount.querySelectorAll('[data-preview-file]').forEach(node => { if (!this.attachments.some(f => f.id === node.dataset.previewFile)) { URL.revokeObjectURL(node.src); this.previews.delete(node.src); node.remove(); } });
    if (nearEnd) mount.scrollTop = mount.scrollHeight;
  }
  composer(body) {
    const form = el('form', null, 'sc-composer'); form.dataset.reply = '';
    const placeholder = this.admin ? `Reply to ${this.thread.displayName || 'the creator'}…` : 'Write a reply…';
    form.innerHTML = `<label>Reply<textarea name="message" maxlength="4000" required placeholder="${placeholder.replaceAll('"', '&quot;')}"></textarea></label><details class="sc-attach"><summary>Attach files</summary><div data-file-mount></div></details><footer><div>${this.admin ? '<label class="sc-check sc-switch"><input type="checkbox" name="internal"><span>Private note</span></label>' : ''}</div><button type="submit" class="sc-primary">Send message</button></footer>`;
    const draft = this.drafts[this.thread.id] || {}; this.replyId = draft.requestId || crypto.randomUUID(); form.elements.message.value = draft.message || '';
    body.append(form); this.filePicker(form.querySelector('[data-file-mount]'));
    form.addEventListener('input', () => this.remember());
    form.elements.message.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !this.busy) { event.preventDefault(); form.requestSubmit(); } });
    if (this.admin) form.elements.internal.onchange = () => { form.querySelector('.sc-attach').hidden = form.elements.internal.checked; form.classList.toggle('sc-note-mode', form.elements.internal.checked); form.querySelector('[type=submit]').textContent = form.elements.internal.checked ? 'Save private note' : 'Send message'; form.elements.message.placeholder = form.elements.internal.checked ? 'Write a note only you can see…' : placeholder; };
    form.onsubmit = event => { event.preventDefault(); void this.sendReply(form); };
  }
  syncComposerState() {
    const form = this.$('[data-reply]'); if (!form || this.admin || this.busy) return;
    const locked = ['closed', 'spam'].includes(this.thread?.status);
    form.elements.message.readOnly = locked || Boolean(this.pendingMessage);
    form.querySelector('[type=submit]').disabled = locked;
    form.querySelector('[type=file]').disabled = locked || this.config?.attachments === false;
    let notice = form.querySelector('[data-closed]');
    if (locked && !notice) { notice = el('p', 'This conversation is closed. Your draft stays here if the developer reopens it. You can still read, export, or delete the report.', 'sc-small'); notice.dataset.closed = ''; form.prepend(notice); }
    if (!locked) notice?.remove();
  }
  async sendReply(form) {
    if (this.busy || (!this.admin && ['closed', 'spam'].includes(this.thread?.status)) || !form.reportValidity()) return;
    const text = form.elements.message.value.trim(); if (!text) return;
    this.remember(); const id = this.thread.id, internal = form.elements.internal?.checked === true;
    this.setBusy(true);
    let optimistic;
    if (!this.pendingMessage) {
      optimistic = el('article', null, 'sc-message sc-sending'); optimistic.dataset.role = internal ? 'note' : this.admin ? 'developer' : 'creator';
      optimistic.append(el('header', internal ? 'Private note · Sending…' : 'Sending…'), el('p', text));
      const log = this.$('.sc-conversation'); log.append(optimistic); log.scrollTop = log.scrollHeight;
    }
    try {
      const sent = this.pendingMessage || await this.api(`/threads/${id}/messages`, { method: 'POST', body: { requestId: this.replyId, message: text, internal } });
      if (!this.pendingMessage && !internal) sent.queue = this.files; this.pendingMessage = sent; if (!internal) this.files = [];
      if (sent.message) { optimistic?.remove(); this.messages.set(sent.id, { ...sent.message, localReceipt: true }); this.renderMessages(); const log = this.$('.sc-conversation'); log.scrollTop = log.scrollHeight; }
      if (!internal) await this.uploadPending(id, sent.id, sent.queue);
      this.pendingMessage = null; this.files = []; form.elements.message.value = ''; this.replyId = crypto.randomUUID(); this.saveDraft(id, {});
      this.notice('');
      let status = form.querySelector('.sc-send-status'); if (!status) { status = el('span', null, 'sc-send-status'); status.setAttribute('role', 'status'); form.querySelector('footer>div').append(status); }
      status.textContent = internal ? 'Internal note saved.' : 'Message sent.';
      this.setBusy(false); await this.refreshThread();
      this.lastActivity = Date.now(); this.livePaused = false; this.schedule(); form.elements.message.focus();
    } catch (error) { this.notice(this.pendingMessage ? `Message sent; an attachment needs attention. ${supportError(error)} Retry or remove the remaining file.` : supportError(error), true); }
    finally { optimistic?.remove(); this.setBusy(false); form.elements.message.readOnly = Boolean(this.pendingMessage); if (this.pendingMessage) { form.querySelector('[type=submit]').textContent = 'Retry attachments'; const fileInput = form.querySelector('[type=file]'); if (fileInput) fileInput.disabled = true; } }
  }
  async refreshThread(more = false, automatic = false) {
    if (!this.thread || this.busy || this.detailBusy) return; this.detailBusy = true;
    const id = this.thread.id, generation = this.generation, after = Math.max(0, ...[...this.messages.values()].filter(m => !m.localReceipt).map(m => m.seq));
    const log = this.$('.sc-conversation'), oldHeight = log?.scrollHeight || 0, oldTop = log?.scrollTop || 0;
    try {
      const data = await this.api(`/threads/${id}?${more ? 'before=' + this.nextBefore : 'after=' + after}`, automatic ? { headers: { 'X-Support-Auto': '1' } } : {}); if (generation !== this.generation) return;
      const previous = this.thread.status; this.thread = data.thread; this.attachments = data.files; if (more) this.nextBefore = data.nextBefore;
      const moderation = this.$('[data-moderation]');
      if (moderation && !moderation.dataset.dirty) {
        for (const key of ['status','priority','tags','followUp','duplicateOf']) moderation.elements.namedItem(key).value = data.thread[key] || '';
        moderation.elements.assigned.checked = data.thread.assigned; moderation.dataset.version = data.thread.version;
      }
      data.messages.forEach(m => this.messages.set(m.id, m)); this.renderMessages();
      if (more && log) log.scrollTop = oldTop + log.scrollHeight - oldHeight;
      const moreButton = this.$('[data-messages-more]'); if (moreButton) moreButton.hidden = !this.nextBefore;
      if (previous !== data.thread.status) { const badge = this.$('.sc-ticket-heading .sc-pill'); badge.replaceWith(pill(data.thread.status, this.admin)); this.notice(`Report status: ${statusLabel(data.thread.status, this.admin)}.`); }
      this.syncComposerState();
      if (data.thread.unread && !data.nextAfter) await this.api(`/threads/${id}/seen`, { method: 'POST', body: { seq: data.seen }, ...(automatic ? { headers: { 'X-Support-Auto': '1' } } : {}) });
      if (generation !== this.generation) return;
      const item = this.items.find(item => item.id === id); if (item) Object.assign(item, data.thread, { unread: false }); this.renderList();
    } catch (error) {
      if (generation === this.generation) {
        if (automatic) { this.live.stop(); this.livePaused = true; const status = this.$('.sc-live'); if (status) status.textContent = 'Manual refresh'; }
        else this.notice(supportError(error), true);
        if (error.code === 'not_found') { this.resetDetail(); this.thread = null; this.items = this.items.filter(item => item.id !== id); this.renderList(); this.setView('inbox'); this.emptyDetail(); this.notice('This conversation is no longer available.'); }
      }
    } finally { this.detailBusy = false; this.flushLive(); }
  }
  async refresh() { if (this.busy) return; if (this.layout === 'board') await this.loadBoard(); else { await this.loadList(); if (this.thread) await this.refreshThread(); } if (this.admin) await this.loadCapacity(); }
  flushLive() {
    if (!this.liveDirty || this.busy || this.detailBusy || !this.thread || !this.active || document.hidden || this.livePaused) return;
    this.liveDirty = false; void this.refreshThread(false, true);
  }
  schedule() {
    if (this.disposed || !this.live) return;
    if (!this.active || document.hidden || !this.thread) { this.live.stop(); return; }
    if (this.config?.live === false || this.livePaused) { const status = this.$('.sc-live'); if (status) status.textContent = 'Manual refresh'; return; }
    this.live.start(this.thread.id);
  }
  filters() {
    // Search lives above the list; queue and filter controls live in the rail and share one form.
    const form = el('form', null, 'sc-filters'); form.id = 'sc-filters-' + crypto.randomUUID().slice(0, 8);
    form.innerHTML = `<div class="sc-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/></svg><input type="search" name="q" maxlength="120" placeholder="Search title or report ID" aria-label="Find a report"><input type="hidden" name="view"><button type="submit" aria-label="Search">Go</button></div>`;
    const rail = this.$('[data-filters]');
    rail.innerHTML = `<h3>Filter</h3><label>Type<select name="category" form="${form.id}"><option value="">All types</option>${optionHtml(SUPPORT_CATEGORIES)}</select></label><label>Status<select name="status" form="${form.id}"><option value="">Any status</option>${optionHtml({ ...SUPPORT_STATUSES, waiting: 'Waiting for creator' })}</select></label><label class="sc-priority-filter">Priority<select name="priority" form="${form.id}"><option value="">All priorities</option>${optionHtml(SUPPORT_PRIORITIES)}</select></label>`;
    form.onsubmit = event => { event.preventDefault(); this.query = Object.fromEntries(new FormData(form)); void (this.layout === 'board' ? this.loadBoard() : this.loadList()); };
    rail.querySelectorAll('select').forEach(select => select.onchange = () => form.requestSubmit());
    const queues = this.$('.sc-queues');
    for (const [name, view, status] of [['All reports','',''],['Needs reply','unread',''],['New','','new'],['In progress','','in_progress'],['Assigned to me','assigned',''],['Follow-up due','due',''],['Resolved','','resolved']]) {
      const tab = button(name, () => {
        if (this.busy) return;
        form.elements.view.value = view; form.elements.status.value = status;
        for (const sibling of queues.children) sibling.setAttribute('aria-pressed', String(sibling === tab));
        form.requestSubmit();
      }); tab.setAttribute('aria-pressed', String(name === 'All reports')); queues.append(tab);
    }
    this.$('[data-search]').append(form);
  }
  moderation(body) {
    const row = this.thread, form = el('form', null, 'sc-tools'); form.dataset.moderation = '';
    form.innerHTML = `<div class="sc-tools-head"><h3>Properties</h3><span class="sc-tools-state" data-dirty-label hidden>Unsaved</span></div>
      <label>Status<select name="status">${optionHtml({ ...SUPPORT_STATUSES, waiting: 'Waiting for creator' })}</select></label>
      <label>Priority<select name="priority">${optionHtml(SUPPORT_PRIORITIES)}</select></label>
      <label class="sc-check sc-switch"><input type="checkbox" name="assigned"><span>Assigned to me</span></label>
      <label>Follow up on<input name="followUp" type="date"></label>
      <label>Tags<input name="tags" maxlength="150" placeholder="playback, export…"></label>
      <button type="submit" class="sc-primary">Save changes</button>
      <details class="sc-organization"><summary>Duplicate &amp; identity</summary><div class="sc-fields"><label class="sc-full">Duplicate of report ID<input name="duplicateOf" maxlength="32" pattern="[a-f0-9]{32}" placeholder="32 hexadecimal characters"></label></div><div class="sc-actions"><button type="button" data-copy-id>Copy report ID</button></div></details>
      <dl class="sc-report-facts"><dt>Files</dt><dd>${row.fileCount} · ${formatBytes(row.fileBytes)}</dd><dt>Opened</dt><dd>${date(row.createdAt)}</dd><dt>Expires</dt><dd>${date(row.expiresAt)}</dd></dl>`;
    for (const key of ['status','priority','tags','followUp','duplicateOf']) form.elements.namedItem(key).value = row[key] || '';
    form.elements.assigned.checked = row.assigned; form.dataset.version = row.version;
    const dirty = () => { form.dataset.dirty = 'true'; form.querySelector('[data-dirty-label]').hidden = false; };
    form.addEventListener('input', dirty); form.addEventListener('change', dirty);
    form.querySelector('[data-copy-id]').onclick = () => this.copyId();
    form.onsubmit = async event => {
      event.preventDefault(); if (this.busy || !form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form)); values.assigned = form.elements.assigned.checked; values.version = Number(form.dataset.version);
      this.setBusy(true);
      try { await this.api(`/threads/${row.id}`, { method: 'PATCH', body: values }); this.setBusy(false); await this.openThread(row.id); await this.loadList(); this.notice('Changes saved.'); }
      catch (error) { this.notice(supportError(error), true); } finally { this.setBusy(false); }
    };
    body.append(form);
  }
  async loadCapacity() {
    try {
      const data = await this.api('/capacity'); if (this.disposed) return;
      const mount = this.$('[data-capacity]'), wasOpen = mount.querySelector('details')?.open; mount.replaceChildren();
      const box = el('details', null, 'sc-capacity'); box.open = Boolean(wasOpen);
      const summary = el('summary'), headline = el('span', null, 'sc-capacity-headline'); headline.append(el('span', 'Storage', 'sc-small'), el('strong', `${formatBytes(data.capacity.file_bytes)} of ${formatBytes(data.limits.storageBytes)}`));
      const usage = el('progress'); usage.max = data.limits.storageBytes || 1; usage.value = data.capacity.file_bytes; usage.setAttribute('aria-label', 'Attachment storage used');
      summary.append(headline, usage); if (data.capacity.paused) summary.append(el('span', 'Intake paused', 'sc-capacity-paused')); box.append(summary);
      const grid = el('div', null, 'sc-capacity-grid');
      for (const [name, value, maximum, format] of [['Files reserved', data.capacity.file_bytes, data.limits.storageBytes, formatBytes], ['Reports', data.capacity.thread_count, data.limits.threads, String], ['Creator requests today', data.budget?.requests || 0, data.limits.dailyRequests, String], ['Creator writes today', data.budget?.writes || 0, data.limits.dailyWrites, String]]) {
        const item = el('div'); item.append(el('span', name, 'sc-small'), el('strong', `${format(value)} / ${format(maximum)}`)); const bar = el('progress'); bar.max = maximum || 1; bar.value = value; bar.setAttribute('aria-label', name); item.append(bar); grid.append(item);
      }
      box.append(grid);
      box.append(button(data.capacity.paused ? 'Resume new reports' : 'Pause new reports', async event => { event.target.disabled = true; try { await this.api('/capacity', { method: 'PATCH', body: { paused: !data.capacity.paused } }); await this.loadCapacity(); } catch (error) { this.notice(supportError(error), true); event.target.disabled = false; } }, 'sc-capacity-toggle'));
      box.append(el('p', `${data.attachments ? 'Private attachments enabled.' : 'Attachment storage is not connected.'} Files expire after 30 days; conversations after 90 days. ${data.heldBytes ? `${formatBytes(data.heldBytes)} held for interrupted uploads. ` : ''}Service safeguards, not Cloudflare billing.`, 'sc-small')); mount.append(box);
    } catch (error) { this.notice(supportError(error), true); }
  }
  async getFile(file, preview) {
    if (this.busy || this.fileLoading) return;
    this.fileLoading = true;
    const id = this.thread.id, generation = this.generation;
    try {
      if (!preview && this.downloadFile) { await this.downloadFile(id, file.id); return; }
      const blob = await this.api(`/threads/${id}/files/${file.id}`, { raw: true });
      if (preview) {
        if (generation !== this.generation) return;
        const mount = this.root.querySelector(`[data-file="${file.id}"]`); if (!mount) return;
        if (mount.querySelector('.sc-preview')) return;
        mount.querySelector('.sc-preview-placeholder')?.remove();
        const media = this.mediaPreview(blob, file.mime, file.name); media.dataset.previewFile = file.id; mount.prepend(media);
        const preview = [...mount.querySelectorAll('button')].find(node => node.textContent === 'Preview'); if (preview) preview.hidden = true;
      } else saveBlob(blob, file.name);
    } catch (error) { this.notice(supportError(error), true); }
    finally { this.fileLoading = false; }
  }
  confirmFileDelete(file, mount) {
    if (mount.querySelector('[data-confirm]')) return;
    const confirm = button('Permanently remove?', async () => { confirm.disabled = true; try { await this.api(`/threads/${this.thread.id}/files/${file.id}`, { method: 'DELETE' }); await this.refreshThread(); this.notice('Attachment removed.'); } catch (error) { this.notice(supportError(error), true); confirm.disabled = false; } }, 'sc-danger'); confirm.dataset.confirm = ''; mount.append(confirm);
  }
  confirmDelete(mount) {
    if (this.$('.sc-delete-confirm')) return;
    const id = this.thread.id, box = el('div', null, 'sc-delete-confirm'); box.setAttribute('role', 'alert'); box.append(el('h3', 'Delete this conversation?'), el('p', `Messages and ${this.thread.fileCount} attached files (${formatBytes(this.thread.fileBytes)}) will be permanently removed for both sides. This cannot be undone.`));
    box.append(button('Permanently delete', async () => { if (this.busy) return; this.setBusy(true); try { const deleted = await this.api(`/threads/${id}`, { method: 'DELETE' }); this.setBusy(false); this.resetDetail(); this.thread = null; this.setView('inbox'); this.admin ? this.emptyDetail() : this.showCreate(); await this.loadList(); if (this.admin) await this.loadCapacity(); this.notice(deleted.cleanupPending ? 'Report deleted. File cleanup will retry automatically.' : 'Report deleted.'); } catch (error) { this.notice(supportError(error), true); } finally { this.setBusy(false); } }, 'sc-danger'), button('Cancel', () => box.remove())); mount.after(box);
  }
  async exportThread() {
    if (this.busy) return; this.setBusy(true, 'Exporting…');
    try {
      let after = 0, data, messages = [];
      do { data = await this.api(`/threads/${this.thread.id}?after=${after}`); messages.push(...data.messages); after = data.nextAfter; } while (after);
      saveBlob(new Blob([JSON.stringify({ thread: data.thread, messages, files: data.files }, null, 2)], { type: 'application/json' }), `StykAnimate-report-${this.thread.id.slice(0,8)}.json`); this.notice('Conversation exported. Attachments can be downloaded separately.');
    } catch (error) { this.notice(supportError(error), true); } finally { this.setBusy(false); }
  }
  async accessPanel() {
    this.$('.sc-access').open = false;
    const mount = this.$('[data-recovery]'); mount.hidden = false; mount.className = 'sc-recovery'; mount.replaceChildren();
    mount.append(el('h3', 'Save your inbox'), el('p', 'Anyone with this link can open your reports. Keep it private.', 'sc-small'));
    mount.append(button('Copy private access link', async () => { try { await this.copyAccess(); this.notice('Private access link copied. Keep it somewhere safe.'); } catch { this.notice('The link could not be copied. Please enable clipboard access and try again.', true); } }, 'sc-primary'), button('Done', () => mount.hidden = true, 'sc-quiet'));
  }
  restorePanel() {
    if (this.busy) return;
    this.$('.sc-access').open = false;
    const mount = this.$('[data-recovery]'); mount.hidden = false; mount.className = 'sc-recovery';
    mount.innerHTML = '<h3>Open an inbox</h3><p class="sc-small">Save your current access link before switching.</p><form><label>Private access link<input name="access" type="password" autocomplete="off" required placeholder="Paste your saved link"></label><div class="sc-actions"><button class="sc-primary" type="submit">Open inbox</button><button type="button" data-cancel>Cancel</button></div></form>';
    mount.querySelector('[data-cancel]').onclick = () => mount.hidden = true;
    mount.querySelector('form').onsubmit = async event => {
      event.preventDefault(); if (this.busy) return; const raw = event.target.elements.access.value.trim(); let key = raw;
      if (this.listBusy || this.detailBusy || this.fileLoading) { this.notice('Wait for the current inbox request to finish, then try again.'); return; }
      if (this.pendingFiles.length || this.pendingCreation || this.pendingMessage) { this.notice('Send or remove the selected files and finish any attachment retry before changing inboxes.'); return; }
      try {
        if (raw.includes('#')) key = new URLSearchParams(new URL(raw).hash.slice(1)).get('key');
        if (!/^[a-f0-9]{64}$/.test(key || '')) throw new Error();
        // Save under the old identity before changing the credential or draft namespace.
        this.remember(); this.setBusy(true, 'Opening inbox…'); this.generation++;
        await this.restoreAccess(key);
        this.resetDetail(false); this.thread = null; this.items = []; this.nextCursor = null; this.drafts = {};
        try { this.drafts = JSON.parse(this.storage?.getItem(this.storageKey) || '{}'); } catch { /* Keep the restored inbox usable without local storage. */ }
        mount.hidden = true; event.target.reset(); this.setBusy(false); this.showCreate(); await this.loadList(); this.notice('Private inbox opened.');
      }
      catch { this.notice('That access link could not be opened. Check the complete link and try again.', true); }
      finally { this.setBusy(false); }
    };
  }
  setActive(value) { if (!value) this.hideCardPreview(); this.active = value; if (!value) this.preparing?.abort(); this.schedule(); }
  dispose() { this.hideCardPreview(); this.live.stop(); this.disposed = true; this.generation++; clearTimeout(this.timer); this.preparing?.abort(); this.remember(); for (const url of this.previews) URL.revokeObjectURL(url); this.root.removeEventListener('pointerdown', this.onActivity); this.root.removeEventListener('keydown', this.onActivity); document.removeEventListener('visibilitychange', this.onVisibility); window.removeEventListener('focus', this.onVisibility); window.removeEventListener('beforeunload', this.beforeUnload); }
}

export function createWebSupportApi({ base = '/api/v1/support', getKey } = {}) {
  return async (path, options = {}) => {
    const rawBody = options.body instanceof Blob;
    const response = await fetch(base + path, { method: options.method || 'GET', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(rawBody ? 90000 : 20000),
      headers: { ...(getKey ? { Authorization: `Bearer ${getKey()}` } : {}), ...(options.body == null || rawBody ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
      ...(options.body == null ? {} : { body: rawBody ? options.body : JSON.stringify(options.body) }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); const error = new Error(data.error || 'service_unavailable'); error.code = data.error; error.status = response.status; throw error; }
    return options.raw ? response.blob() : response.json();
  };
}
