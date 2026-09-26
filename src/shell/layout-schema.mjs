/**
 * Workspace layouts as versioned data (schema v2). Pure functions: no DOM and
 * no I/O; layout-store.mjs reads and writes, layout-solver.mjs fits a layout
 * into a window, and neither ever writes a fitted size back.
 *
 * Stored shape, inside the desktop's workspace-preferences.json (16 KiB file
 * cap) or the browser's localStorage:
 *
 *   {
 *     studioVersion: 1, right: 300, timeline: 240,   // v1 mirror, read by StykAnimate 1.1
 *     layoutVersion: 2,
 *     shared: {stamp, sizes: {left, right, bottom, structure, timelineLabels}},
 *     modes: {
 *       animate: {stamp, preset: 'animate'},          // compact: equal to its built-in preset
 *       draw: {stamp, preset: 'draw', rail: 'left', bottomSpan: 'full',
 *              panels: [{id: 'library', dock: 'left', order: 0}, …], focus: {…}},
 *       rig: {…},                                     // Build
 *     },
 *     saved: [{id: 'u…', name, mode, stamp, arrangement: {rail, bottomSpan, panels}}],
 *     tombstones: [{id, stamp}],
 *     …                                               // unknown keys are kept as they are
 *   }
 *
 * - Sizes are CSS px shared by every workspace (one timeline height, one
 *   inspector width); an absent size means the default, which the solver
 *   derives from the window and never stores.
 * - Arrangements are per workspace: one record per panel, `{id, dock, side,
 *   order, group?, size?, active?, rect?}`. `dock` is where the panel is now:
 *   `left`, `right`, `bottom`, `float`, `strip` or `hidden`; `side` is the
 *   dock side it belongs to (where a strip sits and where a hidden or floating
 *   panel returns); `order` is its tab order on that side; docked records of
 *   one side and `group` are one island's tabs, `active` marks the shown tab
 *   and `size` is the group's share (0–1) when a side stacks two islands;
 *   `rect` ({x, y, w, h}, relative to the stage) is where it floats.
 * - Downgrade safety: 1.1 reads the file as v1 and writes back
 *   `{...loaded, studioVersion: 1}`, so every v2 key survives, and a size it
 *   changed in the mirror is adopted on the next read (reconcileMirror).
 * - A newer layoutVersion is never rewritten: migrateLayout returns presets
 *   with `readOnly: true`.
 * - Unknown keys (at the top, in `shared`, `shared.sizes`, mode entries, saved
 *   layouts and records of unknown panels) survive normalization, so a newer
 *   2.x file keeps its data through an older 2.x app.
 */
import {DOCK_SIDES, PANEL_CATALOG, WORKSPACES, panelCanHide, panelInMode} from './panel-registry.mjs';

export const LAYOUT_VERSION = 2;
export const MODES = WORKSPACES;
export const DOCKS = Object.freeze([...DOCK_SIDES, 'float', 'strip', 'hidden']);
/** Soft target for the serialized layout; new saved layouts must fit under it. */
export const LAYOUT_BUDGET_BYTES = 12 * 1024;
/** The preferences file cap (desktop/preferences.cjs); writes above it are rejected. */
export const LAYOUT_FILE_LIMIT_BYTES = 16 * 1024;
export const MAX_SAVED_LAYOUTS = 8;
export const MAX_LAYOUT_NAME = 48;
export const MAX_TOMBSTONES = 16;
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_FLOATING = 2;
/** 1.1's default timeline height; a v1 file holding it was never customised. */
export const V1_DEFAULT_TIMELINE = 280;
/** The editor setting's default outliner width (settings.mjs builderOutlinerWidth). */
export const V1_DEFAULT_OUTLINER_WIDTH = 236;

const MAX_EXTENT = 4096;
const MAX_UNKNOWN_RECORDS = 8;
const EXTRA_SIZE_LIMITS = Object.freeze({timelineLabels: Object.freeze({min: 140, max: 420})});
const ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const SAVED_ID = /^u[a-z0-9]{1,15}$/;
const PRESET_REF = /^(?:user:u[a-z0-9]{1,15}|[a-z][a-z0-9-]{0,39})$/;
const SIZE_KEY = /^[a-zA-Z][a-zA-Z0-9-]{0,39}$/;
// Keys this schema reads at each level; everything else is carried through.
const TOP_KEYS = new Set(['studioVersion', 'right', 'timeline', 'left', 'floating', 'layoutVersion', 'shared', 'modes', 'saved', 'tombstones']);
const V2_KEYS = new Set(['layoutVersion', 'shared', 'modes', 'saved', 'tombstones']);
const SHARED_KEYS = new Set(['stamp', 'sizes']);
const ENTRY_KEYS = new Set(['stamp', 'preset', 'rail', 'bottomSpan', 'panels', 'focus']);
const SAVED_KEYS = new Set(['id', 'name', 'mode', 'stamp', 'arrangement']);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeKey = key => key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
const int = (value, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : null;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const stampOf = value => int(value, 0, Number.MAX_SAFE_INTEGER) ?? 0;
const sideIndex = side => {
  const index = DOCK_SIDES.indexOf(side);
  return index < 0 ? DOCK_SIDES.length : index;
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

/**
 * A deep copy holding only JSON values (finite numbers, strings, booleans,
 * null, arrays and plain objects), at most 12 levels deep; the preferences
 * IPC rejects anything else. Returns undefined for a value that cannot be kept.
 */
export function cloneJSON(value, depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || depth >= 12) return undefined;
  if (Array.isArray(value)) return value.map(item => cloneJSON(item, depth + 1)).filter(item => item !== undefined);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (!safeKey(key)) continue;
    const kept = cloneJSON(item, depth + 1);
    if (kept !== undefined) copy[key] = kept;
  }
  return copy;
}

function unknownKeys(source, known, depth = 1) {
  const kept = {};
  for (const [key, value] of Object.entries(source)) {
    if (known.has(key) || !safeKey(key)) continue;
    const copy = cloneJSON(value, depth);
    if (copy !== undefined) kept[key] = copy;
  }
  return kept;
}

const encoder = new TextEncoder();
/** UTF-8 size of the JSON text, as the preferences file measures it. */
export const layoutBytes = value => encoder.encode(JSON.stringify(value)).length;

/** 'build' is Build's user-facing name; the workspace id is 'rig'. Anything else is Animate. */
export function normalizeMode(mode) {
  if (mode === 'build') return 'rig';
  return MODES.includes(mode) ? mode : 'animate';
}

/** Operations on one workspace refuse to guess it: a Build arrangement read as Animate would lose Structure. */
function requireMode(mode) {
  if (mode !== 'build' && !MODES.includes(mode)) throw new TypeError(`Unknown workspace: ${String(mode)}`);
  return normalizeMode(mode);
}

// ---------------------------------------------------------------------------
// Catalogue helpers (cached per catalogue array; catalogues are frozen)

const catalogCache = new WeakMap();
function catalogInfo(catalog) {
  let info = catalogCache.get(catalog);
  if (!info) {
    const limits = {...EXTRA_SIZE_LIMITS};
    for (const descriptor of catalog) {
      for (const key of descriptor.sizeKey ? [descriptor.sizeKey] : descriptor.docks) {
        const limit = limits[key] = {...(limits[key] ?? {min: Infinity, max: 0})};
        limit.min = Math.min(limit.min, descriptor.min ?? 0);
        limit.max = Math.max(limit.max, descriptor.max ?? MAX_EXTENT);
      }
    }
    info = {byId: new Map(catalog.map(descriptor => [descriptor.id, descriptor])), limits: deepFreeze(limits), presets: new Map()};
    catalogCache.set(catalog, info);
  }
  return info;
}

/** The clamp applied to each stored shared size: the widest limits of the panels that use it. */
export const sizeLimits = (catalog = PANEL_CATALOG) => catalogInfo(catalog).limits;
const limitOf = (catalog, key) => sizeLimits(catalog)[key] ?? {min: 0, max: MAX_EXTENT};

// ---------------------------------------------------------------------------
// Presets (data; the Layout popover draws each as a small dock map)

const inspectorTabs = (docks = {}) => ['properties', 'vfx', 'library'].map((id, order) => ({id, dock: docks[id] ?? 'right', side: 'right', order}));
const timelineRecord = dock => ({id: 'timeline', dock, side: 'bottom', order: 0});
const structureRecord = {id: 'structure', dock: 'left', side: 'left', order: 0};
const animateArrangement = {rail: 'left', bottomSpan: 'full', panels: [...inspectorTabs(), timelineRecord('bottom')]};

/**
 * Built-in presets per workspace. `sizes` are fractions of the workspace
 * height written to the shared sizes (Timing writes the one timeline height,
 * so it changes it in every workspace, like the splitter). Focus has no
 * arrangement: it folds the current one and restores it (toggleFocus).
 */
export const PRESETS = deepFreeze([
  {id: 'animate', title: 'Animate', titleKey: 'shell.preset.animate', modes: ['animate'], arrangement: animateArrangement},
  {id: 'timing', title: 'Timing', titleKey: 'shell.preset.timing', modes: ['animate'], sizes: {bottom: 0.4},
    arrangement: {rail: 'left', bottomSpan: 'full', panels: [...inspectorTabs({vfx: 'strip', library: 'strip'}), timelineRecord('bottom')]}},
  {id: 'focus', title: 'Focus', titleKey: 'shell.preset.focus', modes: [...MODES], toggle: 'focus'},
  {id: 'review', title: 'Review', titleKey: 'shell.preset.review', modes: ['animate'],
    arrangement: {rail: 'left', bottomSpan: 'full', panels: [...inspectorTabs({properties: 'hidden', vfx: 'hidden', library: 'hidden'}), timelineRecord('strip')]}},
  {id: 'draw', title: 'Draw', titleKey: 'shell.preset.draw', modes: ['draw'], arrangement: animateArrangement},
  {id: 'build', title: 'Build', titleKey: 'shell.preset.build', modes: ['rig'],
    arrangement: {rail: 'left', bottomSpan: 'full', panels: [structureRecord, ...inspectorTabs(), timelineRecord('hidden')]}},
  {id: 'build-timeline', title: 'Build + timeline', titleKey: 'shell.preset.buildTimeline', modes: ['rig'],
    arrangement: {rail: 'left', bottomSpan: 'full', panels: [structureRecord, ...inspectorTabs(), timelineRecord('bottom')]}},
]);
export const DEFAULT_PRESETS = Object.freeze({animate: 'animate', draw: 'draw', rig: 'build'});

/** The built-in presets offered in a workspace, in popover order. */
export const presetsFor = mode => PRESETS.filter(preset => preset.modes.includes(normalizeMode(mode)));

function builtInPreset(id, mode) {
  const preset = PRESETS.find(item => item.id === id);
  return preset && preset.modes.includes(mode) ? preset : null;
}

const defaultRecords = mode => PRESETS.find(preset => preset.id === DEFAULT_PRESETS[mode]).arrangement.panels;

/**
 * A preset's normalized arrangement for the workspace: built-in ids, or
 * `user:<id>` when `layout` holds that saved layout. Null for Focus, an
 * unknown id or a preset another workspace owns.
 */
export function presetArrangement(presetId, mode, {catalog = PANEL_CATALOG, layout} = {}) {
  mode = normalizeMode(mode);
  if (typeof presetId === 'string' && presetId.startsWith('user:')) {
    const saved = layout?.saved?.find(item => `user:${item.id}` === presetId);
    return saved ? normalizeArrangement(saved.arrangement, mode, {catalog}) : null;
  }
  const preset = builtInPreset(presetId, mode);
  if (!preset?.arrangement) return null;
  const cache = catalogInfo(catalog).presets, key = `${mode}:${preset.id}`;
  if (!cache.has(key)) cache.set(key, deepFreeze(normalizeArrangement(preset.arrangement, mode, {catalog, keepUnknown: false})));
  return cache.get(key);
}

/** The workspace's default arrangement (its default preset). */
export const defaultArrangement = (mode, options) => presetArrangement(DEFAULT_PRESETS[normalizeMode(mode)], mode, options);

// ---------------------------------------------------------------------------
// Arrangements

function normalizeRect(rect) {
  if (!isObject(rect)) return null;
  const x = int(rect.x, -MAX_EXTENT, MAX_EXTENT), y = int(rect.y, -MAX_EXTENT, MAX_EXTENT);
  const w = int(rect.w ?? rect.width, 1, MAX_EXTENT), h = int(rect.h ?? rect.height, 1, MAX_EXTENT);
  return x === null || y === null || w === null || h === null ? null : {x, y, w, h};
}

/** One stored record, placed where its descriptor allows in this workspace. */
function placeRecord(raw, descriptor, mode) {
  const home = descriptor.docks[0];
  let dock = DOCKS.includes(raw.dock) ? raw.dock : home;
  let side = descriptor.docks.includes(raw.side) ? raw.side : null;
  if (DOCK_SIDES.includes(dock)) {
    if (!descriptor.docks.includes(dock)) dock = home;   // a place the panel does not allow: back home
    side = dock;
  }
  side ??= home;
  if (dock === 'float' && !descriptor.floatable) dock = side;
  if (dock === 'hidden' && !panelCanHide(descriptor, mode)) {
    const fallback = descriptor.hiddenFallback;
    dock = fallback === 'strip' ? 'strip' : descriptor.docks.includes(fallback) ? fallback : side;
    if (DOCK_SIDES.includes(dock)) side = dock;
  }
  const record = {id: descriptor.id, dock, side, order: int(raw.order, 0, 999) ?? 999};
  const group = int(raw.group, 0, 1);
  if (group) record.group = group;
  if (positive(raw.size)) record.size = Math.min(1, Math.max(0.001, Math.round(raw.size * 1000) / 1000));
  if (raw.active === true) record.active = true;
  const rect = normalizeRect(raw.rect);
  if (rect) record.rect = rect;
  return record;
}

function normalizePanels(list, mode, catalog, fallback, keepUnknown) {
  const {byId} = catalogInfo(catalog);
  const seen = new Set(), records = [], unknown = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!isObject(raw) || typeof raw.id !== 'string' || seen.has(raw.id)) continue;
    const descriptor = byId.get(raw.id);
    if (!descriptor) {
      // A panel this version does not know (a newer 2.x file): kept, never solved.
      if (!keepUnknown || unknown.length >= MAX_UNKNOWN_RECORDS || !ID_PATTERN.test(raw.id) || !DOCKS.includes(raw.dock)) continue;
      seen.add(raw.id);
      unknown.push(cloneJSON(raw, 3));
      continue;
    }
    seen.add(raw.id);
    if (panelInMode(descriptor, mode)) records.push(placeRecord(raw, descriptor, mode));
  }
  // Every panel of the workspace has a record: missing ones (a file from before
  // the panel existed, or a damaged one) take the default preset's place.
  for (const descriptor of catalog) {
    if (seen.has(descriptor.id) || !panelInMode(descriptor, mode)) continue;
    const template = fallback?.find(record => record.id === descriptor.id) ?? {dock: descriptor.docks[0]};
    records.push(placeRecord(template, descriptor, mode));
  }
  let floating = 0;
  for (const record of records) if (record.dock === 'float' && ++floating > MAX_FLOATING) record.dock = record.side;
  // Tab order: consecutive per side, keeping the stored order and then the input order.
  const position = new Map(records.map((record, index) => [record, index]));
  const byOrder = (a, b) => a.order - b.order || position.get(a) - position.get(b);
  for (const side of DOCK_SIDES) records.filter(record => record.side === side).sort(byOrder).forEach((record, index) => { record.order = index; });
  // Islands: docked groups renumbered 0.. per side; one active tab each.
  for (const side of DOCK_SIDES) {
    const docked = records.filter(record => record.dock === side).sort(byOrder);
    const groups = [...new Set(docked.map(record => record.group ?? 0))].sort((a, b) => a - b);
    for (const record of docked) {
      const group = groups.indexOf(record.group ?? 0);
      if (group) record.group = group; else delete record.group;
    }
    for (const group of groups.keys()) {
      const members = docked.filter(record => (record.group ?? 0) === group);
      const active = members.find(record => record.active) ?? members[0];
      for (const record of members) if (record === active) record.active = true; else delete record.active;
    }
  }
  for (const record of records) {
    if (record.dock !== record.side) { delete record.active; delete record.group; }
  }
  records.sort((a, b) => sideIndex(a.side) - sideIndex(b.side) || (a.group ?? 0) - (b.group ?? 0) || a.order - b.order);
  return [...records, ...unknown];
}

/**
 * Normalizes an arrangement `{rail, bottomSpan, panels}` for a workspace:
 * one record per panel of the workspace, each in a place its descriptor
 * allows (a timeline Hidden outside Build becomes a strip, a non-floatable
 * float docks, a third floating panel docks), tab orders consecutive and one
 * active tab per island. Missing panels take the default preset's place.
 */
export function normalizeArrangement(input, mode, {catalog = PANEL_CATALOG, keepUnknown = true} = {}) {
  mode = normalizeMode(mode);
  const source = isObject(input) ? input : {};
  return {
    rail: source.rail === 'right' ? 'right' : 'left',
    bottomSpan: source.bottomSpan === 'stage' ? 'stage' : 'full',
    panels: normalizePanels(source.panels, mode, catalog, defaultRecords(mode), keepUnknown),
  };
}

const arrangementKey = arrangement => JSON.stringify([arrangement.rail, arrangement.bottomSpan, arrangement.panels]);
/** True when two normalized arrangements place every panel alike. */
export const sameArrangement = (a, b) => Boolean(a && b) && arrangementKey(a) === arrangementKey(b);

function normalizeModeEntry(input, mode, catalog) {
  const source = isObject(input) ? input : {};
  const preset = typeof source.preset === 'string' && PRESET_REF.test(source.preset) ? source.preset : DEFAULT_PRESETS[mode];
  // A compact entry is its built-in preset's arrangement.
  const base = Array.isArray(source.panels) ? source
    : (builtInPreset(preset, mode)?.arrangement ?? builtInPreset(DEFAULT_PRESETS[mode], mode).arrangement);
  return {
    ...unknownKeys(source, ENTRY_KEYS),
    stamp: stampOf(source.stamp),
    preset,
    ...normalizeArrangement(base, mode, {catalog}),
    focus: isObject(source.focus) ? normalizeArrangement(source.focus, mode, {catalog}) : null,
  };
}

// ---------------------------------------------------------------------------
// The layout

/** Letters, digits, spaces and punctuation, at most 48 characters. */
export function cleanLayoutName(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, MAX_LAYOUT_NAME).join('').trim();
}

function normalizeShared(input, catalog) {
  const source = isObject(input) ? input : {};
  const sizes = {};
  if (isObject(source.sizes)) {
    for (const [key, value] of Object.entries(source.sizes)) {
      if (!SIZE_KEY.test(key) || !safeKey(key)) continue;
      const limit = limitOf(catalog, key);
      const size = int(value, limit.min, limit.max);
      if (size !== null) sizes[key] = size;
    }
  }
  return {...unknownKeys(source, SHARED_KEYS), stamp: stampOf(source.stamp), sizes};
}

function normalizeTombstones(list, now) {
  const newest = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!isObject(raw) || typeof raw.id !== 'string' || !SAVED_ID.test(raw.id)) continue;
    const stamp = stampOf(raw.stamp);
    if (now - stamp > TOMBSTONE_TTL_MS) continue;
    if ((newest.get(raw.id) ?? -1) < stamp) newest.set(raw.id, stamp);
  }
  return [...newest].map(([id, stamp]) => ({id, stamp})).sort((a, b) => b.stamp - a.stamp || (a.id < b.id ? -1 : 1)).slice(0, MAX_TOMBSTONES);
}

function normalizeSaved(list, catalog, tombstones) {
  const saved = [], seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (saved.length >= MAX_SAVED_LAYOUTS) break;
    if (!isObject(raw)) continue;
    const id = typeof raw.id === 'string' && SAVED_ID.test(raw.id) ? raw.id : null;
    const name = cleanLayoutName(raw.name);
    const mode = raw.mode === 'build' ? 'rig' : MODES.includes(raw.mode) ? raw.mode : null;
    if (!id || !name || !mode || seen.has(id)) continue;
    const stamp = stampOf(raw.stamp);
    if (tombstones.some(tombstone => tombstone.id === id && tombstone.stamp >= stamp)) continue;
    seen.add(id);
    saved.push({...unknownKeys(raw, SAVED_KEYS), id, name, mode, stamp, arrangement: normalizeArrangement(raw.arrangement, mode, {catalog})});
  }
  return saved;
}

/**
 * The in-memory layout: the stored shape without the v1 mirror, with every
 * workspace's arrangement expanded. Idempotent; never mutates its input.
 * Invalid parts fall back to presets and defaults.
 */
export function normalizeLayout(input, {catalog = PANEL_CATALOG, now = Date.now()} = {}) {
  const source = isObject(input) ? input : {};
  const layout = unknownKeys(source, TOP_KEYS);
  layout.layoutVersion = LAYOUT_VERSION;
  layout.shared = normalizeShared(source.shared, catalog);
  const modes = isObject(source.modes) ? source.modes : {};
  layout.modes = {};
  for (const mode of MODES) layout.modes[mode] = normalizeModeEntry(modes[mode], mode, catalog);
  Object.assign(layout.modes, unknownKeys(modes, new Set(MODES), 2));
  layout.tombstones = normalizeTombstones(source.tombstones, now);
  layout.saved = normalizeSaved(source.saved, catalog, layout.tombstones);
  return layout;
}

/** A layout with every workspace at its default preset and default sizes. */
export const defaultLayout = options => normalizeLayout(null, options);

/**
 * 1.1 edits only the mirror keys. The v2 writer keeps them equal to the
 * shared sizes, so a difference means an older app changed the size since:
 * it wins, and the shared stamp moves so merges prefer it.
 */
function reconcileMirror(layout, raw, catalog) {
  const sizes = layout.shared.sizes;
  let changed = false;
  for (const [mirror, key] of [['right', 'right'], ['timeline', 'bottom']]) {
    const limit = limitOf(catalog, key);
    const value = positive(raw[mirror]) ? int(raw[mirror], limit.min, limit.max) : undefined;
    if (value === sizes[key]) continue;
    if (value === undefined) delete sizes[key]; else sizes[key] = value;
    changed = true;
  }
  if (changed) layout.shared.stamp += 1;
}

/**
 * Reads anything found in storage. Returns `{layout, source, readOnly}`:
 * - `v2`: normalized, with sizes an older app changed in the mirror adopted;
 * - `v1` (`{studioVersion: 1, right, timeline}`, 1.1's studio layout) and
 *   `legacy` (the earlier `{left, right, timeline, floating}` splitter blob):
 *   presets with the old sizes (1.1's untouched default timeline, 280, and
 *   the editor setting's default outliner width mean "default");
 * - `future`: a newer layoutVersion; presets, `readOnly` so it is never rewritten;
 * - `empty` or `invalid`: presets.
 * `legacy.builderOutlinerWidth` (the editor setting) seeds the Structure width
 * once, when the file is not yet v2.
 */
export function migrateLayout(raw, {catalog = PANEL_CATALOG, now = Date.now(), legacy} = {}) {
  const options = {catalog, now};
  if (!isObject(raw)) return {...fromOlder({}, options, legacy), source: raw == null ? 'empty' : 'invalid'};
  if (raw.layoutVersion === LAYOUT_VERSION) {
    const layout = normalizeLayout(raw, options);
    reconcileMirror(layout, raw, catalog);
    return {layout, source: 'v2', readOnly: false};
  }
  if (Number.isSafeInteger(raw.layoutVersion) && raw.layoutVersion > LAYOUT_VERSION) {
    return {layout: normalizeLayout(null, options), source: 'future', readOnly: true};
  }
  return fromOlder(raw, options, legacy);
}

/** Not v2: keep the unknown keys, ignore any invalid v2 data, and take the old sizes. */
function fromOlder(raw, options, legacy) {
  const {catalog} = options;
  const layout = normalizeLayout(Object.fromEntries(Object.entries(raw).filter(([key]) => !V2_KEYS.has(key))), options);
  const sizes = layout.shared.sizes;
  const put = (key, value) => {
    const {min, max} = limitOf(catalog, key);
    const size = positive(value) ? int(value, min, max) : null;
    if (size !== null) sizes[key] = size;
  };
  let source = raw.layoutVersion === undefined ? 'empty' : 'invalid';
  if (raw.studioVersion === 1) {
    source = 'v1';
    put('right', raw.right);
    if (raw.timeline !== V1_DEFAULT_TIMELINE) put('bottom', raw.timeline);
  } else if (['left', 'right', 'timeline', 'floating'].some(key => key in raw)) {
    source = 'legacy';
    put('left', raw.left);
    put('right', raw.right);
    put('bottom', raw.timeline);
  }
  const outliner = legacy?.builderOutlinerWidth;
  if (outliner !== V1_DEFAULT_OUTLINER_WIDTH) put('structure', outliner);
  return {layout, source, readOnly: false};
}

/** True for a stored layout this version must not rewrite. */
export const isFutureLayout = raw => isObject(raw) && Number.isSafeInteger(raw.layoutVersion) && raw.layoutVersion > LAYOUT_VERSION;

const compactRecord = record => {
  if (record.dock !== record.side) return record;
  const {side, ...rest} = record;
  return rest;
};
const compactArrangement = arrangement => ({rail: arrangement.rail, bottomSpan: arrangement.bottomSpan, panels: arrangement.panels.map(compactRecord)});

function compactModeEntry(entry, mode, catalog) {
  const kept = {...unknownKeys(entry, ENTRY_KEYS), stamp: entry.stamp, preset: entry.preset};
  if (!entry.focus && sameArrangement(entry, presetArrangement(entry.preset, mode, {catalog}))) return kept;
  const full = {...kept, ...compactArrangement(entry)};
  if (entry.focus) full.focus = compactArrangement(entry.focus);
  return full;
}

/**
 * The JSON object to store: the v1 mirror (`studioVersion: 1`, `right`,
 * `timeline`), the v2 keys with preset-equal arrangements compacted to
 * `{stamp, preset}`, and every unknown key. Default sizes are left out.
 */
export function serializeLayout(layout, {catalog = PANEL_CATALOG, now = Date.now()} = {}) {
  const model = normalizeLayout(layout, {catalog, now});
  const stored = {};
  for (const [key, value] of Object.entries(model)) if (!V2_KEYS.has(key)) stored[key] = value;
  stored.studioVersion = 1;
  if (model.shared.sizes.right !== undefined) stored.right = model.shared.sizes.right;
  if (model.shared.sizes.bottom !== undefined) stored.timeline = model.shared.sizes.bottom;
  stored.layoutVersion = LAYOUT_VERSION;
  stored.shared = model.shared;
  stored.modes = Object.fromEntries(Object.entries(model.modes).map(([mode, entry]) => [mode, MODES.includes(mode) ? compactModeEntry(entry, mode, catalog) : entry]));
  stored.saved = model.saved.map(item => ({...item, arrangement: compactArrangement(item.arrangement)}));
  stored.tombstones = model.tombstones;
  // Every part is already JSON; the round trip only detaches the result from the model.
  return JSON.parse(JSON.stringify(stored));
}

/**
 * Keeps a serialized layout within the budget. Over the 12 KiB soft budget
 * only the oldest tombstones go (they only guard merges). Over the 16 KiB
 * file limit, which the preferences store would reject outright, focus
 * snapshots, then the oldest saved layouts, then the largest unknown keys go.
 * Returns `{value, bytes, trimmed, ok}`; `ok` is false if it still does not fit.
 */
export function fitBudget(value, {budget = LAYOUT_BUDGET_BYTES, limit = LAYOUT_FILE_LIMIT_BYTES} = {}) {
  let current = value, bytes = layoutBytes(current);
  const trimmed = [];
  const note = item => { if (!trimmed.includes(item)) trimmed.push(item); };
  while (bytes > budget && current.tombstones?.length) {
    current = {...current, tombstones: current.tombstones.slice(0, -1)};
    note('tombstones');
    bytes = layoutBytes(current);
  }
  const steps = [
    () => {
      const modes = current.modes ?? {};
      if (!Object.values(modes).some(entry => isObject(entry) && 'focus' in entry)) return false;
      current = {...current, modes: Object.fromEntries(Object.entries(modes).map(([mode, entry]) => {
        if (!isObject(entry)) return [mode, entry];
        const {focus, ...rest} = entry;
        return [mode, rest];
      }))};
      note('focus');
      return true;
    },
    () => {
      if (!current.saved?.length) return false;
      const oldest = current.saved.reduce((a, b) => (b.stamp < a.stamp ? b : a));
      current = {...current, saved: current.saved.filter(item => item !== oldest)};
      note(`saved:${oldest.id}`);
      return true;
    },
    () => {
      const extra = Object.keys(current).filter(key => !V2_KEYS.has(key) && !['studioVersion', 'right', 'timeline'].includes(key));
      if (!extra.length) return false;
      const largest = extra.reduce((a, b) => (JSON.stringify(current[b]).length > JSON.stringify(current[a]).length ? b : a));
      const {[largest]: removed, ...rest} = current;
      current = rest;
      note(`key:${largest}`);
      return true;
    },
  ];
  for (const step of steps) {
    while (bytes > limit && step()) bytes = layoutBytes(current);
  }
  return {value: current, bytes, trimmed, ok: bytes <= limit};
}

// ---------------------------------------------------------------------------
// Operations (pure; the store stamps what changed)

const withMode = (layout, mode, entry, {catalog, now}) => normalizeLayout({...layout, modes: {...layout.modes, [mode]: entry}}, {catalog, now});
const pickArrangement = entry => ({rail: entry.rail, bottomSpan: entry.bottomSpan, panels: entry.panels});

/** Applies a built-in (`animate`, `timing`, …), `focus` or saved (`user:<id>`) preset to a workspace. */
export function applyPreset(layout, mode, presetId, {catalog = PANEL_CATALOG, now = Date.now(), workspaceHeight} = {}) {
  mode = requireMode(mode);
  if (presetId === 'focus') return toggleFocus(layout, mode, {on: true, catalog, now});
  const arrangement = presetArrangement(presetId, mode, {catalog, layout});
  if (!arrangement) return layout;
  let {shared} = layout;
  const fractions = builtInPreset(presetId, mode)?.sizes;
  if (fractions && positive(workspaceHeight)) {
    const sizes = {...shared.sizes};
    for (const [key, fraction] of Object.entries(fractions)) sizes[key] = Math.round(fraction * workspaceHeight);
    shared = {...shared, sizes};
  }
  const entry = {...layout.modes[mode], preset: presetId, ...arrangement, focus: null};
  return normalizeLayout({...layout, shared, modes: {...layout.modes, [mode]: entry}}, {catalog, now});
}

/**
 * Focus: snapshots the arrangement and folds every docked or floating panel
 * to a strip on its side; turning it off restores the snapshot. `on` forces a state.
 */
export function toggleFocus(layout, mode, {on, catalog = PANEL_CATALOG, now = Date.now()} = {}) {
  mode = requireMode(mode);
  const entry = layout.modes[mode];
  const active = Boolean(entry.focus);
  if ((on ?? !active) === active) return layout;
  if (active) return withMode(layout, mode, {...entry, ...entry.focus, focus: null}, {catalog, now});
  const {byId} = catalogInfo(catalog);
  const panels = entry.panels.map(record => byId.has(record.id) && (record.dock === record.side || record.dock === 'float') ? {...record, dock: 'strip'} : record);
  return withMode(layout, mode, {...entry, panels, focus: pickArrangement(entry)}, {catalog, now});
}

/** Returns the workspace to its default preset. */
export function resetMode(layout, mode, {catalog = PANEL_CATALOG, now = Date.now()} = {}) {
  mode = requireMode(mode);
  return withMode(layout, mode, {...layout.modes[mode], preset: DEFAULT_PRESETS[mode], panels: undefined, focus: null}, {catalog, now});
}

/** Every workspace at its default and the shared sizes cleared; saved layouts stay. */
export function resetLayout(layout, {catalog = PANEL_CATALOG, now = Date.now()} = {}) {
  const modes = {...layout.modes};
  for (const mode of MODES) modes[mode] = {...modes[mode], preset: DEFAULT_PRESETS[mode], panels: undefined, focus: null};
  return normalizeLayout({...layout, shared: {...layout.shared, sizes: {}}, modes}, {catalog, now});
}

/** Sets one shared size (null: the default). */
export function setSharedSize(layout, key, value, {catalog = PANEL_CATALOG, now = Date.now()} = {}) {
  const sizes = {...layout.shared.sizes};
  if (value == null) delete sizes[key]; else sizes[key] = value;
  return normalizeLayout({...layout, shared: {...layout.shared, sizes}}, {catalog, now});
}

/**
 * True when a panel may go to `target` in the workspace: a side it allows,
 * `float` when floatable, `hidden` where it may hide, `strip` or `docked`
 * (back to its side).
 */
export function canPlacePanel(id, target, {mode, catalog = PANEL_CATALOG} = {}) {
  if (mode !== 'build' && !MODES.includes(mode)) return false;
  mode = normalizeMode(mode);
  const descriptor = catalogInfo(catalog).byId.get(id);
  if (!descriptor || !panelInMode(descriptor, mode)) return false;
  if (DOCK_SIDES.includes(target)) return descriptor.docks.includes(target);
  if (target === 'float') return descriptor.floatable;
  if (target === 'hidden') return panelCanHide(descriptor, mode);
  return target === 'strip' || target === 'docked';
}

/**
 * Moves a panel within an arrangement and returns the normalized arrangement
 * (unchanged when the move is not allowed). Docking adds the panel as the
 * active tab at `index` of `group` on that side; floating a third panel
 * docks the one that floated first.
 */
export function movePanel(arrangement, id, target, {mode, catalog = PANEL_CATALOG, index, group, rect} = {}) {
  mode = requireMode(mode);
  if (!canPlacePanel(id, target, {mode, catalog})) return arrangement;
  const panels = arrangement.panels.map(record => ({...record}));
  const record = panels.find(item => item.id === id);
  if (!record) return arrangement;
  if (target === 'docked' || DOCK_SIDES.includes(target)) {
    const side = target === 'docked' ? record.side : target;
    const island = Number.isInteger(group) ? group : target === 'docked' ? record.group ?? 0 : 0;
    const siblings = panels.filter(item => item !== record && item.side === side).sort((a, b) => a.order - b.order);
    siblings.splice(Math.max(0, Math.min(siblings.length, Number.isInteger(index) ? index : siblings.length)), 0, record);
    siblings.forEach((item, order) => { item.order = order; });
    for (const item of panels) if (item.dock === side && (item.group ?? 0) === island) delete item.active;
    Object.assign(record, {dock: side, side, group: island, active: true});
  } else {
    if (target === 'float') {
      const others = panels.filter(item => item !== record && item.dock === 'float');
      for (const item of others.slice(0, Math.max(0, others.length - MAX_FLOATING + 1))) item.dock = item.side;
      const kept = normalizeRect(rect);
      if (kept) record.rect = kept;
    }
    record.dock = target;
  }
  return normalizeArrangement({...arrangement, panels}, mode, {catalog});
}

/** Makes a docked panel its island's shown tab. */
export function activatePanel(arrangement, id, {mode, catalog = PANEL_CATALOG} = {}) {
  mode = requireMode(mode);
  const record = arrangement.panels.find(item => item.id === id);
  if (!record || record.dock !== record.side) return arrangement;
  const panels = arrangement.panels.map(item => {
    if (item.dock !== record.side || (item.group ?? 0) !== (record.group ?? 0)) return item;
    const {active, ...rest} = item;
    return item.id === id ? {...rest, active: true} : rest;
  });
  return normalizeArrangement({...arrangement, panels}, mode, {catalog});
}

// ---------------------------------------------------------------------------
// Saved layouts

function uniqueSavedId(layout, now) {
  const base = `u${Math.max(0, Math.floor(now)).toString(36)}`.slice(0, 13);
  const taken = new Set([...layout.saved.map(item => item.id), ...layout.tombstones.map(item => item.id)]);
  let id = base;
  for (let n = 0; taken.has(id); n++) id = `${base}${n.toString(36)}`;
  return id;
}

/**
 * Whether the workspace's arrangement can be saved as a new layout:
 * `{ok: true}`, or `{ok: false, reason: 'limit'}` with 8 saved and
 * `{ok: false, reason: 'budget'}` when it would pass the 12 KiB budget.
 */
export function canSavePreset(layout, mode, {catalog = PANEL_CATALOG, now = Date.now()} = {}) {
  if (layout.saved.length >= MAX_SAVED_LAYOUTS) return {ok: false, reason: 'limit'};
  const trial = savePreset(layout, {name: 'x'.repeat(MAX_LAYOUT_NAME), mode, catalog, now, check: false});
  return layoutBytes(serializeLayout(trial.layout, {catalog, now})) > LAYOUT_BUDGET_BYTES ? {ok: false, reason: 'budget'} : {ok: true};
}

/**
 * Saves the workspace's arrangement as a named layout for that workspace.
 * Returns `{layout, id}`, or the unchanged layout with `error`: `name`
 * (empty), `limit` or `budget` (canSavePreset).
 */
export function savePreset(layout, {name, mode, catalog = PANEL_CATALOG, now = Date.now(), check = true} = {}) {
  mode = requireMode(mode);
  const clean = cleanLayoutName(name);
  if (!clean) return {layout, error: 'name'};
  if (layout.saved.length >= MAX_SAVED_LAYOUTS) return {layout, error: 'limit'};
  const entry = layout.modes[mode];
  const id = uniqueSavedId(layout, now);
  const next = normalizeLayout({
    ...layout,
    saved: [...layout.saved, {id, name: clean, mode, stamp: Math.floor(now), arrangement: pickArrangement(entry)}],
    modes: {...layout.modes, [mode]: {...entry, preset: `user:${id}`}},
  }, {catalog, now});
  if (check && layoutBytes(serializeLayout(next, {catalog, now})) > LAYOUT_BUDGET_BYTES) return {layout, error: 'budget'};
  return {layout: next, id};
}

/** Renames a saved layout; `{layout, error: 'name' | 'missing'}` when it cannot. */
export function renamePreset(layout, id, name, {catalog = PANEL_CATALOG, now = Date.now()} = {}) {
  const clean = cleanLayoutName(name);
  if (!clean) return {layout, error: 'name'};
  if (!layout.saved.some(item => item.id === id)) return {layout, error: 'missing'};
  return {layout: normalizeLayout({...layout, saved: layout.saved.map(item => item.id === id ? {...item, name: clean} : item)}, {catalog, now})};
}

/** Replaces a saved layout's arrangement with its workspace's current one. */
export function updatePreset(layout, id, {catalog = PANEL_CATALOG, now = Date.now()} = {}) {
  const item = layout.saved.find(saved => saved.id === id);
  if (!item) return {layout, error: 'missing'};
  const arrangement = pickArrangement(layout.modes[item.mode]);
  return {layout: normalizeLayout({...layout, saved: layout.saved.map(saved => saved === item ? {...saved, arrangement} : saved)}, {catalog, now})};
}

/**
 * Deletes a saved layout and records a tombstone, so a merge with another
 * window's older copy does not bring it back. Workspaces that came from it
 * keep their arrangement.
 */
export function deletePreset(layout, id, {catalog = PANEL_CATALOG, now = Date.now()} = {}) {
  const item = layout.saved.find(saved => saved.id === id);
  if (!item) return layout;
  const modes = {...layout.modes};
  for (const mode of MODES) if (modes[mode].preset === `user:${id}`) modes[mode] = {...modes[mode], preset: DEFAULT_PRESETS[mode]};
  return normalizeLayout({
    ...layout,
    modes,
    saved: layout.saved.filter(saved => saved !== item),
    tombstones: [...layout.tombstones, {id, stamp: Math.max(Math.floor(now), item.stamp + 1)}],
  }, {catalog, now});
}
