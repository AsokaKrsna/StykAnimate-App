'use strict';

const {createHash} = require('node:crypto');

// The public library is a static catalogue on the website: /library/catalog.json
// lists curated assets, and each asset's file and preview sit beside it at a
// fixed path derived from its id. Only that one site is contacted, every
// response is size-bounded, and a file reaches the app only after its size and
// SHA-256 match the catalogue. Nothing about the user or their projects is sent.
const SITE = 'https://stykanimate.com';
const LIMITS = Object.freeze({catalog: 512 * 1024, preview: 1024 * 1024, asset: 8 * 1024 * 1024});
const CATALOG_TTL = 10 * 60 * 1000;
const MAX_PREVIEWS = 160;
const MAX_FILE_CACHE_BYTES = 32 * 1024 * 1024;
const ID = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const KINDS = new Set(['figure', 'set', 'movieclip']);
const MATTES = new Set(['light', 'neutral', 'dark']);
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
const extensionOf = kind => kind === 'movieclip' ? 'stykmov' : 'stkz';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isPublicId = value => typeof value === 'string' && ID.test(value);

/** Tests and local previews may point at a loopback server; the product only talks to the website. */
function siteFrom(value) {
  if (!value) return SITE;
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password)
    throw new Error('The public library address can only be overridden with a loopback server.');
  return url.origin;
}

/** Validates the catalogue strictly and keeps only what the app can use. */
function parseCatalog(source) {
  const value = JSON.parse(source);
  if (value?.format !== 'stykanimate-public-library' || !Array.isArray(value.packs) || !Array.isArray(value.items))
    throw new Error('The public library could not be read.');
  if (value.version !== 1) throw new Error('Update StykAnimate to browse the current public library.');
  const packs = [], packIds = new Set();
  for (const pack of value.packs.slice(0, 64)) {
    const name = text(pack?.name, 80);
    if (!isPublicId(pack?.id) || !name || packIds.has(pack.id)) continue;
    packIds.add(pack.id);
    packs.push({id: pack.id, name, description: text(pack.description, 400) ?? ''});
  }
  const items = [], ids = new Set();
  for (const item of value.items.slice(0, 2000)) {
    const name = text(item?.name, 120);
    if (!isPublicId(item?.id) || ids.has(item.id) || !name || !KINDS.has(item.kind) || !packIds.has(item.pack)) continue;
    if (!Number.isSafeInteger(item.size) || item.size <= 0 || item.size > LIMITS.asset || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) continue;
    if (item.file !== `files/${item.id}.${extensionOf(item.kind)}` || item.preview !== `previews/${item.id}.png`) continue;
    ids.add(item.id);
    items.push({id: item.id, name, kind: item.kind, pack: item.pack, description: text(item.description, 400) ?? '',
      size: item.size, sha256: item.sha256, matte: MATTES.has(item.matte) ? item.matte : null});
  }
  return {packs: packs.filter(pack => items.some(item => item.pack === pack.id)), items};
}

async function readBounded(response, limit) {
  if (!response.ok || !response.body) throw new Error(response.status === 404 ? 'This asset is no longer in the public library.' : 'The public library is unavailable right now.');
  if (Number(response.headers.get('content-length')) > limit) throw new Error('The public library sent an unexpectedly large file.');
  const reader = response.body.getReader(), parts = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new Error('The public library sent an unexpectedly large file.');
      parts.push(Buffer.from(part.value.buffer, part.value.byteOffset, part.value.byteLength));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts, size);
}

class PublicLibrary {
  constructor({site, fetcher = globalThis.fetch, now = Date.now} = {}) {
    this.site = siteFrom(site);
    this.page = `${this.site}/library/`;
    this.fetcher = fetcher; this.now = now;
    this.cached = null; this.expires = 0; this.pending = null; this.byId = new Map();
    this.previews = new Map(); this.files = new Map(); this.fileBytes = 0; this.inflight = new Map();
  }
  async request(path, limit) {
    let response;
    try { response = await this.fetcher(`${this.page}${path}`, {signal: AbortSignal.timeout(15000), redirect: 'error'}); }
    catch { throw new Error('Could not reach the public library. Check your connection and try again.'); }
    return readBounded(response, limit);
  }
  /** One shared request; the catalogue is reused for ten minutes unless refreshed. */
  async catalog({refresh = false} = {}) {
    if (!refresh && this.cached && this.now() < this.expires) return this.cached;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const parsed = parseCatalog((await this.request('catalog.json', LIMITS.catalog)).toString('utf8'));
      this.byId = new Map(parsed.items.map(item => [item.id, item]));
      // Previews and files of items that changed or left the catalogue are released.
      for (const key of this.previews.keys()) if (this.byId.get(key.split(':')[0])?.sha256 !== key.split(':')[1]) this.previews.delete(key);
      for (const [hash, bytes] of this.files) if (!parsed.items.some(item => item.sha256 === hash)) { this.files.delete(hash); this.fileBytes -= bytes.length; }
      this.cached = {page: this.page, ...parsed}; this.expires = this.now() + CATALOG_TTL;
      return this.cached;
    })();
    try { return await this.pending; } finally { this.pending = null; }
  }
  async item(id) {
    if (!isPublicId(id)) throw new Error('Unknown public library asset.');
    await this.catalog();
    const item = this.byId.get(id);
    if (!item) throw new Error('This asset is no longer in the public library.');
    return item;
  }
  once(key, operation) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const result = operation().finally(() => this.inflight.delete(key));
    this.inflight.set(key, result);
    return result;
  }
  /** The asset's 320 × 320 transparent PNG as a data URL (the renderer's CSP allows no remote images). */
  async preview(id) {
    const item = await this.item(id), key = `${id}:${item.sha256}`;
    const cached = this.previews.get(key);
    if (cached) { this.previews.delete(key); this.previews.set(key, cached); return cached; }
    return this.once(`preview:${key}`, async () => {
      const png = await this.request(`previews/${id}.png`, LIMITS.preview);
      if (!png.subarray(0, 8).equals(PNG)) throw new Error('The asset preview is not a PNG image.');
      const url = `data:image/png;base64,${png.toString('base64')}`;
      this.previews.set(key, url);
      while (this.previews.size > MAX_PREVIEWS) this.previews.delete(this.previews.keys().next().value);
      return url;
    });
  }
  /** The verified native file: {item, name, extension, bytes}. */
  async asset(id) {
    const item = await this.item(id), extension = extensionOf(item.kind);
    let bytes = this.files.get(item.sha256);
    if (bytes) { this.files.delete(item.sha256); this.files.set(item.sha256, bytes); }
    else bytes = await this.once(`file:${item.sha256}`, async () => {
      const downloaded = await this.request(`files/${id}.${extension}`, item.size);
      if (downloaded.length !== item.size || sha256(downloaded) !== item.sha256) throw new Error('The downloaded asset did not match the public library. Try again later.');
      this.files.set(item.sha256, downloaded); this.fileBytes += downloaded.length;
      while (this.fileBytes > MAX_FILE_CACHE_BYTES && this.files.size > 1) {
        const [oldest, value] = this.files.entries().next().value; this.files.delete(oldest); this.fileBytes -= value.length;
      }
      return downloaded;
    });
    return {item, name: `${item.name}.${extension}`, extension: `.${extension}`, bytes};
  }
  /** The website's page for the library, or for one asset. */
  pageFor(id) { return isPublicId(id) ? `${this.page}#${id}` : this.page; }
}

module.exports = {PublicLibrary, parseCatalog, isPublicId, siteFrom, LIMITS};
