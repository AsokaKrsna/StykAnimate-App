/** Colour palettes shared by every colour picker and Draw's colour rail.
 *
 * Two sources:
 * - Project colours belong to the document (`_styk.palette`). They change
 *   only through editor commands, so they undo and save with the project.
 * - Recent colours belong to this app: the last colours painted or chosen,
 *   kept in local storage.
 *
 * The chosen view (project or recent) is also local and shared, so the
 * picker and the rail always show the same palette. Until someone chooses,
 * the view follows the project: its colours once it has any, recent before. */

export const PROJECT_PALETTE_LIMIT = 64;
export const RECENT_LIMIT = 12;
const STORE_KEY = 'stykanimate.colors.v1';
// Draw kept its recent colours with the brushes before palettes were shared.
const LEGACY_BRUSH_KEY = 'stykanimate.drawing-brushes.v1';
const HEX = /^#[0-9a-f]{6}$/;

/** Lower-case #rrggbb, or null for anything else. */
export const paletteHex = value => typeof value === 'string' && HEX.test(value.toLowerCase()) ? value.toLowerCase() : null;
const cleanList = (list, limit) => {
  const out = [];
  if (Array.isArray(list)) for (const value of list) { const hex = paletteHex(value); if (hex && !out.includes(hex)) out.push(hex); if (out.length >= limit) break; }
  return out;
};

/** The project's colours in their saved order; tolerant of damaged files. */
export const projectColors = report => cleanList(report?._styk?.palette?.colors, PROJECT_PALETTE_LIMIT);

/** Validates the colours a palette command stores. */
export function validateProjectColors(colors) {
  if (!Array.isArray(colors) || colors.length > PROJECT_PALETTE_LIMIT) throw new Error(`A project palette holds up to ${PROJECT_PALETTE_LIMIT} colors.`);
  if (colors.some(color => paletteHex(color) !== color) || new Set(colors).size !== colors.length) throw new Error('Palette colors must be unique #rrggbb values.');
  return colors;
}

let store;
const listeners = new Set();
function load() {
  if (store) return store;
  let saved = {};
  try { saved = JSON.parse(globalThis.localStorage?.getItem(STORE_KEY) || '{}') ?? {}; } catch { /* Palette storage is optional. */ }
  let recent = cleanList(saved.recent, RECENT_LIMIT);
  if (!Array.isArray(saved.recent)) try { recent = cleanList(JSON.parse(globalThis.localStorage?.getItem(LEGACY_BRUSH_KEY) || '{}')?.recent, RECENT_LIMIT); } catch { /* Nothing to migrate. */ }
  store = {recent, view: ['project', 'recent'].includes(saved.view) ? saved.view : null};
  return store;
}
function save() {
  try { globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* Palette storage is optional. */ }
  for (const listener of listeners) listener();
}

export const recentColors = () => load().recent;
/** Replaces the recent colours (tests, and Draw's library property). */
export function setRecentColors(colors) { load().recent = cleanList(colors, RECENT_LIMIT); save(); }
/** Moves a colour to the front of the recent colours. */
export function rememberColor(value) {
  const hex = paletteHex(value), state = load(); if (!hex || state.recent[0] === hex) return;
  state.recent = [hex, ...state.recent.filter(color => color !== hex)].slice(0, RECENT_LIMIT); save();
}
/** 'project' or 'recent': the palette the picker and the rail show. */
export const paletteView = project => load().view ?? (project.length ? 'project' : 'recent');
/** Saving to the project is offered in its view and, until a view is chosen,
 * while the project has no colours: the first colour saved switches to it. */
export const canSaveToProject = project => paletteView(project) === 'project' || (!load().view && !project.length);
export function setPaletteView(view) { if (!['project', 'recent'].includes(view)) throw new Error('Choose the project or recent colors.'); if (load().view !== view) { store.view = view; save(); } }
/** Called when recent colours or the view change. Returns the unsubscribe. */
export function subscribePalette(listener) { listeners.add(listener); return () => listeners.delete(listener); }

/** The colours of the current view, with its name. */
export function paletteColors(report) {
  const project = projectColors(report), view = paletteView(project);
  return {view, colors: view === 'project' ? project : recentColors(), project};
}

/** Project colours, the editor's own document and commands:
 * {colors(), add(hex), remove(hex), move(hex, index), subscribe(listener)}.
 * The picker is installed before the editor exists, so app.mjs binds them here. */
let projectSource = null;
export function bindProjectPalette(source) { projectSource = source; }
export const projectPalette = () => projectSource;
