import { SupportCenter } from './support-center.mjs';
export class SupportDesktopUI {
  constructor(bridge) { this.bridge = bridge; }
  async open({ category } = {}) {
    if (!this.bridge?.supportRequest) return;
    if (!this.dialog) this.create();
    if (!this.dialog.open) this.dialog.showModal();
    if (!this.center) {
      if (!this.starting) this.starting = this.initialize().catch(() => { this.mount.textContent = 'Support could not be opened. Close this window and try again.'; }).finally(() => { this.starting = null; });
      await this.starting;
    }
    this.center?.setActive(true);
    if (category && !this.center?.thread && !this.center?.files?.length) this.center?.showCreate(category);
  }
  create() {
    if (!document.querySelector('[data-support-styles]')) {
      // The shared support-center.css and its desktop remap, in the legacy cascade layer.
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./styles/support-bridge.css', import.meta.url).href; link.dataset.supportStyles = ''; document.head.append(link);
    }
    this.dialog = document.createElement('dialog'); this.dialog.className = 'styk-feedback'; this.dialog.setAttribute('aria-label', 'Bug reports and feedback');
    this.dialog.innerHTML = '<header><h2>Feedback</h2><button type="button" aria-label="Close feedback">×</button></header><div><p>Opening your private inbox…</p></div>';
    this.mount = this.dialog.querySelector('div'); document.body.append(this.dialog);
    this.dialog.querySelector('header button').onclick = () => this.dialog.close();
    this.dialog.addEventListener('close', () => this.center?.setActive(false));
    for (const type of ['keydown','keyup','click','pointerdown']) this.dialog.addEventListener(type, event => event.stopPropagation());
  }
  async initialize() {
    const context = await this.bridge.getSupportContext();
    const namespace = value => 'stykanimate.support.drafts.' + value.inboxId;
    const values = new Map(); let activeContext = context, pending = Promise.resolve();
    const seed = value => { activeContext = value; values.set(namespace(value), JSON.stringify(value.drafts || {})); values.set(namespace(value) + '-last', value.lastThread || ''); };
    seed(context);
    const storage = {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => {
        values.set(key, value);
        const state = { inboxId: activeContext.inboxId, drafts: JSON.parse(values.get(namespace(activeContext)) || '{}'), lastThread: values.get(namespace(activeContext) + '-last') || '' };
        pending = pending.catch(() => {}).then(() => this.bridge.saveSupportState(state));
        pending.catch(() => this.center?.notice('Draft could not be saved on this device.', true));
      },
    };
    const api = async (path, options = {}) => {
      const input = { path, method: options.method || 'GET' };
      if (options.headers?.['X-Support-Auto'] === '1') input.automatic = true;
      if (options.body instanceof Blob) { input.bytes = new Uint8Array(await options.body.arrayBuffer()); input.fileName = decodeURIComponent(options.headers['X-File-Name']); }
      else if (options.body != null) input.body = options.body;
      const result = await this.bridge.supportRequest(input);
      if (!result.ok) { const error = new Error(result.error); error.code = result.error; error.status = result.status; throw error; }
      return options.raw ? new Blob([result.bytes], { type: result.type }) : result.value;
    };
    this.center = new SupportCenter(this.mount, { api, context, storage, storageKey: namespace(context),
      subscribeLive: async (id, event) => {
        const remove = this.bridge.onSupportLive(value => { if (value.threadId === id) event(value.type); });
        try {
          const result = await this.bridge.connectSupportLive(id);
          if (!result.available) { const error = new Error(result.error || 'live_unavailable'); error.code = result.error || 'live_unavailable'; error.status = result.status; throw error; }
          return () => { remove(); void this.bridge.disconnectSupportLive(result.connection); };
        } catch (error) { remove(); throw error; }
      },
      onThreadOpen: id => { try { storage?.setItem(this.center.storageKey + '-last', id); } catch { /* Session remains usable. */ } },
      copyAccess: () => this.bridge.copySupportAccess(), restoreAccess: async key => { await pending; await this.bridge.restoreSupportAccess(key); const restored = await this.bridge.getSupportContext(); seed(restored); this.center.storageKey = namespace(restored); },
      downloadFile: (threadId, fileId) => this.bridge.downloadSupportFile({ threadId, fileId }),
    });
    await this.center.start();
    let last; try { last = storage?.getItem(this.center.storageKey + '-last'); } catch { /* Storage unavailable. */ }
    if (!this.center.drafts.create?.title && !this.center.drafts.create?.description && this.center.items.some(item => item.id === last)) await this.center.openThread(last);
  }
}
