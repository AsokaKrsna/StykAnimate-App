/**
 * The layout solver: fits a stored layout (layout-schema.mjs) into the
 * window. Pure and deterministic; the dock host applies its solution in one
 * commit and never writes a fitted size back to the stored layout.
 *
 * Input: the layout, the `#app` content box in CSS px after the UI scale
 * (the window, which nothing the solution changes can resize, so tiers never
 * oscillate), the workspace, and `bandMin`: the top band's measured
 * min-content width (a number for the compact band, or `{tier: px}` for
 * every band layout above minimal, measured in one pass), so a longer
 * language steps the width tier down before the window controls could
 * overflow.
 *
 * Two independent tiers: the width tier folds horizontal chrome only (the
 * docks, the rail's size at minimal), the height tier vertical chrome only
 * (the timeline body, the stage insets), so a short window keeps its docked
 * inspector and a narrow one keeps its timeline body.
 *
 * Collapse order, applied until the stage holds its minimum (360×200, or a
 * docked panel's own `stageMin`, such as Structure's 400):
 *   width:  the tier's folds (compact and minimal: the left dock becomes a
 *           strip, the right dock a sheet, floating panels sheets), then the
 *           left dock to a strip, the right dock to a strip, then to a sheet;
 *   height: the short tier caps the timeline at two content rows, the low tier
 *           folds it to its header (the body opens as a sheet); a timeline that
 *           would still leave the stage under its minimum height is compressed
 *           first and folded to its header only when even its minimum does not fit.
 * Geometry, tiers and folds are data (SHELL_METRICS, TIER_THRESHOLDS), so the
 * visual design can change them without touching the algorithm.
 *
 * The bottom dock is the timeline's region: its default height, its row
 * minimum and `timelineRows` follow SHELL_METRICS.timeline whichever panels
 * are docked there.
 */
import {PANEL_CATALOG, panelInMode} from './panel-registry.mjs';
import {normalizeLayout, normalizeMode, solvableArrangement} from './layout-schema.mjs';

export const WIDTH_TIERS = Object.freeze(['wide', 'regular', 'narrow', 'compact', 'minimal']);
export const HEIGHT_TIERS = Object.freeze(['tall', 'short', 'low']);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

/** A window at or below each value takes that tier (visual-system §11). */
export const TIER_THRESHOLDS = deepFreeze({
  width: {regular: 1366, narrow: 1180, compact: 900, minimal: 660},
  height: {short: 640, low: 568},
});

/**
 * Shell geometry in CSS px (visual-system §5, experience §1.1 and §1.11).
 * `width` rows are keyed by width tier, `height` rows by height tier.
 */
export const SHELL_METRICS = deepFreeze({
  band: 44,
  bandMargin: 24,
  gutter: 6,
  strip: 40,
  // The smallest island of a side (or of the bottom) that stacks two islands, along the split.
  islandMin: 120,
  stageMin: {width: 360, height: 200},
  rail: {width: 48, compact: 40},
  width: {
    wide: {padEnd: 8, columnGap: 6, inset: 28, dock: {left: 232, right: 288}},
    regular: {padEnd: 8, columnGap: 6, inset: 28, dock: {left: 232, right: 272}},
    narrow: {padEnd: 8, columnGap: 6, inset: 28, dock: {left: 232, right: 256}},
    compact: {padEnd: 8, columnGap: 0, inset: 20, dock: {left: 232, right: 256}, message: 'inset',
      fold: {left: 'strip', right: 'sheet', float: 'sheet'}},
    minimal: {padEnd: 4, columnGap: 0, inset: 10, dock: {left: 232, right: 256}, message: 'inset', compactRail: true,
      fold: {left: 'strip', right: 'sheet', float: 'sheet'}},
  },
  height: {
    tall: {padBottom: 8, rowGap: 6, insetTop: 40, insetBottom: 52, timeline: {pad: 8}},
    short: {padBottom: 8, rowGap: 6, insetTop: 20, insetBottom: 48, timeline: {pad: 0, maxContent: 2}},
    low: {padBottom: 4, rowGap: 4, insetTop: 8, insetBottom: 46, timeline: {pad: 0}, compactRail: true, fold: {bottom: 'strip'}},
  },
  // Timeline rows: its header, the label header (ruler), Camera and Scene pinned,
  // then content rows. The default is three content slots capped at 32% of the
  // window in whole rows, never fewer than two.
  timeline: {header: 40, labelHeader: 32, row: 32, pinned: 2, slots: 3, minSlots: 2, cap: 0.32},
  floating: {margin: 8, width: 288, height: 520, minHeight: 240, offset: 16, cascade: 24},
  // The zoom corner and the message slot share the stage's bottom inset.
  corner: {width: 96, inset: 10, gap: 16, messageInset: 8},
  collapse: {width: [['left', 'strip'], ['right', 'strip'], ['right', 'sheet'], ['left', 'sheet']]},
});

/**
 * Artboard-zoom floors (experience §1.11): a window at least W×H never gets
 * less than Z% at fit with the default layout (each workspace's default
 * preset at default sizes). They never decrease as a window grows, so no
 * larger window gets a smaller artboard than a smaller one. What the user
 * chooses is theirs to trade: a stored size (a splitter, Tall timeline,
 * Timing) or an extra dock may take the artboard below its floor, while
 * #viewport keeps its 360×200 minimum in every layout.
 */
export const STAGE_FLOORS = deepFreeze([[500, 340, 35], [600, 441, 45], [800, 600, 50], [1024, 700, 60], [1280, 720, 65], [1440, 900, 90]]);
export const stageFloor = (width, height) => STAGE_FLOORS.reduce((floor, [w, h, zoom]) => (width >= w && height >= h ? Math.max(floor, zoom) : floor), 0);

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
const dimension = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const rect = (x, y, width, height) => ({x, y, width: Math.max(0, width), height: Math.max(0, height)});

export function widthTierFor(width, thresholds = TIER_THRESHOLDS) {
  let tier = WIDTH_TIERS[0];
  for (const name of WIDTH_TIERS.slice(1)) if (width <= thresholds.width[name]) tier = name;
  return tier;
}

export function heightTierFor(height, thresholds = TIER_THRESHOLDS) {
  let tier = HEIGHT_TIERS[0];
  for (const name of HEIGHT_TIERS.slice(1)) if (height <= thresholds.height[name]) tier = name;
  return tier;
}

/**
 * The width and height tiers. The width tier steps down while the band laid
 * out for it (`bandMin`, plus the 24px margin) is wider than the window; a
 * number is the compact band's width and bounds every tier above minimal.
 * A `{tier: px}` map must come from one pass that measures every band
 * layout above minimal: measuring only the current tier's band and
 * replacing the map would flip the tier near a threshold. A tier the map
 * lacks needs the widest width it holds, so a partial map can only step
 * the tier down, never let the band overflow.
 */
export function resolveTiers(width, height, {bandMin = 0, thresholds = TIER_THRESHOLDS, bandMargin = SHELL_METRICS.bandMargin} = {}) {
  const sized = widthTierFor(width, thresholds);
  const valid = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
  const widest = typeof bandMin === 'number' ? 0 : Math.max(0, ...WIDTH_TIERS.slice(0, -1).map(tier => valid(bandMin?.[tier])));
  const need = tier => {
    if (tier === 'minimal') return 0;
    if (typeof bandMin === 'number') return valid(bandMin);
    return valid(bandMin?.[tier]) || widest;
  };
  let index = WIDTH_TIERS.indexOf(sized);
  while (index < WIDTH_TIERS.length - 1 && need(WIDTH_TIERS[index]) > 0 && need(WIDTH_TIERS[index]) + bandMargin > width) index++;
  return {tier: WIDTH_TIERS[index], height: heightTierFor(height, thresholds), bandStep: index > WIDTH_TIERS.indexOf(sized)};
}

/** A docked timeline's height with `content` rows visible under the pinned ones. */
export function timelineHeightFor(content, heightTier = 'tall', metrics = SHELL_METRICS) {
  const t = metrics.timeline;
  return t.header + t.labelHeader + (t.pinned + content) * t.row + (metrics.height[heightTier]?.timeline?.pad ?? 0);
}

/**
 * The default timeline height: a function of the window height only (never
 * of the document, the workspace or the timeline mode), so a tab switch, a
 * mode switch or a new layer never moves the stage. It is derived again on
 * every solve and never stored, so it follows the window (240 at 900, 208 at
 * 720, 200 at the short tier, the 40px header at the low tier) until the user
 * stores a height.
 */
export function timelineDefaultHeight(height, heightTier = heightTierFor(height), metrics = SHELL_METRICS) {
  const t = metrics.timeline, row = metrics.height[heightTier] ?? {};
  if (row.fold?.bottom === 'strip') return t.header;
  const pad = row.timeline?.pad ?? 0;
  const fit = Math.floor((t.cap * height - t.header - t.labelHeader - pad) / t.row) - t.pinned;
  const slots = Math.max(t.minSlots, Math.min(t.slots, fit, row.timeline?.maxContent ?? Infinity));
  return timelineHeightFor(slots, heightTier, metrics);
}

/** The artboard zoom at fit (architecture §3.11.8), capped at `max`. */
export function fitZoom(viewport, insets, artboard = {width: 960, height: 540}, max = 2) {
  const width = viewport.width - insets.left - insets.right, height = viewport.height - insets.top - insets.bottom;
  if (!(artboard.width > 0 && artboard.height > 0)) return 0;
  return Math.max(0, Math.min(width / artboard.width, height / artboard.height, max));
}

function clampFloating(stored, descriptor, stage, metrics, index) {
  const f = metrics.floating;
  const margin = Math.min(f.margin, stage.width / 2, stage.height / 2);
  const maxWidth = Math.max(0, stage.width - margin * 2), maxHeight = Math.max(0, stage.height - margin * 2);
  const width = Math.round(clamp(stored?.w ?? descriptor.pref ?? f.width, Math.min(descriptor.min ?? 0, maxWidth), maxWidth));
  const height = Math.round(clamp(stored?.h ?? f.height, Math.min(f.minHeight, maxHeight), maxHeight));
  const cascade = index * f.cascade;
  const x = Math.round(clamp(stored?.x ?? stage.width - width - f.offset - cascade, margin, stage.width - width - margin));
  const y = Math.round(clamp(stored?.y ?? f.offset + cascade, margin, stage.height - height - margin));
  return {x, y, w: width, h: height};
}

/**
 * Solves the layout for a window. Returns:
 *   tier, height            width and height tiers (data-tier, data-height)
 *   rail                    {side, orientation: 'vertical', compact, width, rect}
 *   regions.left|right      {state: docked|strip|sheet|hidden, size, strip, sizeKey, reason, rect, stripRect, groups, panels}
 *   regions.bottom          {state: docked|strip|hidden, size, span, body: docked|sheet|null, reason, rect, groups, panels}
 *                           groups: the docked islands, [{tabs, active, rect}], stacked on a side and
 *                           side by side at the bottom; panels: {docked, strip, sheet} ids
 *   floating                [{panel, x, y, w, h}] relative to the stage
 *   stage                   the stage island's rect (#viewport is its content box)
 *   stageInsets             {top, right, bottom, left} for the artboard fit
 *   timelineRows            {pinned, content} visible before the rows scroll (content >= 2 when docked)
 *   messageSlot             {width}
 *   aria                    splitters' {min, max, now} (null where there is none): the docks'
 *                           `left`, `right`, `bottom`, and `left-islands`, `right-islands`,
 *                           `bottom-islands` between two islands (now: the first island's extent)
 *   panels                  {[id]: {presentation, side, dock, group, active, visible}}
 *   rects                   {band, workspace, rail, stage}
 *   zoom                    the artboard zoom at fit when `artboard` is given
 * Every rect is in the #app box's coordinates.
 */
export function solveLayout(layout, env = {}) {
  const catalog = env.panels ?? PANEL_CATALOG;
  const metrics = env.metrics ?? SHELL_METRICS;
  const width = dimension(env.width), height = dimension(env.height);
  const mode = normalizeMode(env.mode);
  const model = normalizeLayout({shared: layout?.shared, modes: {[mode]: layout?.modes?.[mode]}}, {catalog, now: 0});
  const entry = solvableArrangement(model.modes[mode], mode, {catalog}), sizes = model.shared.sizes;
  const byId = new Map(catalog.map(descriptor => [descriptor.id, descriptor]));
  const records = entry.panels.filter(record => byId.has(record.id) && panelInMode(byId.get(record.id), mode));
  const describe = record => byId.get(record.id);

  const {tier, height: heightTier} = resolveTiers(width, height, {bandMin: env.bandMin, thresholds: env.tiers ?? TIER_THRESHOLDS, bandMargin: metrics.bandMargin});
  const across = metrics.width[tier], down = metrics.height[heightTier];
  const gap = across.columnGap, padEnd = across.padEnd, padBottom = down.padBottom, rowGap = down.rowGap;
  const railCompact = Boolean(across.compactRail || down.compactRail);
  const railWidth = Math.min(railCompact ? metrics.rail.compact : metrics.rail.width, width);

  // Side docks.
  const sides = {};
  for (const side of ['left', 'right']) {
    const docked = records.filter(record => record.dock === side);
    const strip = records.filter(record => record.dock === 'strip' && record.side === side);
    sides[side] = {docked, strip, sheet: [], state: docked.length ? 'docked' : strip.length ? 'strip' : 'hidden', reason: null};
  }
  const fold = (side, to, reason) => {
    const s = sides[side];
    if (to === 'strip' && s.state === 'docked') {
      Object.assign(s, {strip: [...s.docked, ...s.strip].sort((a, b) => a.order - b.order), docked: [], state: 'strip', reason});
      return true;
    }
    if (to === 'sheet' && (s.state === 'docked' || s.state === 'strip')) {
      Object.assign(s, {sheet: [...s.docked, ...s.strip].sort((a, b) => a.order - b.order), docked: [], strip: [], state: 'sheet', reason});
      return true;
    }
    return false;
  };
  for (const [side, to] of Object.entries(across.fold ?? {})) if (sides[side]) fold(side, to, 'tier');
  for (const side of ['left', 'right']) {
    const s = sides[side];
    if (s.state !== 'docked') continue;
    // A panel that owns its width (Structure) sizes its side; otherwise the side's shared size.
    const owner = s.docked.find(record => describe(record).sizeKey);
    s.sizeKey = owner ? describe(owner).sizeKey : side;
    const fallback = owner ? describe(owner).pref : across.dock?.[side];
    s.min = Math.max(...s.docked.map(record => describe(record).min ?? 0));
    s.max = Math.max(s.min, Math.min(...s.docked.map(record => describe(record).max ?? Infinity)));
    s.size = Math.round(clamp(sizes[s.sizeKey] ?? fallback ?? s.min, s.min, s.max));
  }
  const extent = side => {
    const s = sides[side];
    if (s.state === 'docked') return s.size + (s.strip.length ? gap + metrics.strip : 0);
    return s.state === 'strip' ? metrics.strip : 0;
  };
  const stageWidth = () => {
    const parts = [railWidth, extent('left'), extent('right')].filter(part => part > 0);
    return Math.max(0, width - padEnd - parts.reduce((sum, part) => sum + part, 0) - parts.length * gap);
  };
  const requirement = () => Math.max(metrics.stageMin.width,
    ...['left', 'right'].flatMap(side => sides[side].state === 'docked' ? sides[side].docked.map(record => describe(record).stageMin ?? 0) : []));
  for (const [side, to] of metrics.collapse?.width ?? []) {
    if (stageWidth() >= requirement()) break;
    fold(side, to, 'stage');
  }

  // Bottom dock: compress the rows, then fold to the header.
  const band = Math.min(metrics.band, height);
  const workspaceHeight = Math.max(0, height - band);
  const t = metrics.timeline;
  const bottomDocked = records.filter(record => record.dock === 'bottom');
  const bottomStrip = records.filter(record => record.dock === 'strip' && record.side === 'bottom');
  const bottom = {state: bottomDocked.length ? 'docked' : bottomStrip.length ? 'strip' : 'hidden', size: 0, span: entry.bottomSpan, reason: null};
  let bottomLimits = null;
  if (bottom.state === 'docked' && down.fold?.bottom === 'strip') Object.assign(bottom, {state: 'strip', reason: 'tier'});
  if (bottom.state === 'docked') {
    // Never shorter than the pinned rows plus the minimum content rows at this tier.
    const min = Math.max(timelineHeightFor(t.minSlots, heightTier, metrics), ...bottomDocked.map(record => describe(record).min ?? 0));
    const fraction = Math.min(...bottomDocked.map(record => describe(record).maxFraction ?? 1));
    const cap = down.timeline?.maxContent != null ? timelineHeightFor(down.timeline.maxContent, heightTier, metrics) : Infinity;
    const room = workspaceHeight - padBottom - rowGap - metrics.stageMin.height;
    const max = Math.min(Math.floor(fraction * height), cap, room);
    let size = sizes.bottom ?? timelineDefaultHeight(height, heightTier, metrics);
    if (size > cap) { size = cap; bottom.reason = 'tier'; }
    if (size > room) { size = room; bottom.reason = 'stage'; }
    if (max < min) Object.assign(bottom, {state: 'strip', reason: 'stage'});
    else {
      bottom.size = Math.round(clamp(size, min, max));
      bottomLimits = {min, max};
    }
  }
  if (bottom.state === 'strip') bottom.size = t.header;
  bottom.size = Math.min(bottom.size, Math.max(0, workspaceHeight - padBottom - rowGap));
  bottom.body = bottom.state === 'docked' ? 'docked' : bottom.state === 'strip' ? 'sheet' : null;
  const mainHeight = Math.max(0, workspaceHeight - padBottom - (bottom.state === 'hidden' ? 0 : bottom.size + rowGap));
  const fullHeight = Math.max(0, workspaceHeight - padBottom);

  // Columns in visual order; the rail sits against the window edge on its side.
  const railLeft = entry.rail !== 'right';
  const columns = [];
  if (railLeft) columns.push({key: 'rail', width: railWidth});
  if (sides.left.state === 'strip' || sides.left.strip.length) columns.push({key: 'left-strip', width: metrics.strip});
  if (sides.left.state === 'docked') columns.push({key: 'left', width: sides.left.size});
  columns.push({key: 'stage', width: stageWidth()});
  if (sides.right.state === 'docked') columns.push({key: 'right', width: sides.right.size});
  if (sides.right.state === 'strip' || sides.right.strip.length) columns.push({key: 'right-strip', width: metrics.strip});
  if (!railLeft) columns.push({key: 'rail', width: railWidth});
  const rects = {band: rect(0, 0, width, band), workspace: rect(0, band, width, workspaceHeight)};
  let x = railLeft ? 0 : padEnd;
  for (const column of columns) {
    const tall = column.key === 'rail' || (bottom.span === 'stage' && column.key !== 'stage');
    rects[column.key] = rect(x, band, column.width, tall ? fullHeight : mainHeight);
    x += column.width + gap;
  }
  const stage = rects.stage;
  if (bottom.state !== 'hidden') {
    const spanned = bottom.span === 'stage' ? [stage] : columns.filter(column => column.key !== 'rail').map(column => rects[column.key]);
    const left = Math.min(...spanned.map(item => item.x)), right = Math.max(...spanned.map(item => item.x + item.width));
    bottom.rect = rect(left, band + mainHeight + rowGap, right - left, bottom.size);
  } else bottom.rect = null;

  // A docked region's islands by group: stacked on a side, side by side at the
  // bottom, sharing its extent by the arrangement's weights, none under islandMin.
  const islandsOf = (docked, area, weights, across) => {
    const groups = [];
    for (const record of docked) (groups[record.group ?? 0] ??= []).push(record);
    const list = groups.filter(Boolean);
    const available = Math.max(0, (across ? area.width : area.height) - (list.length - 1) * metrics.gutter);
    const shares = Array.isArray(weights) && weights.length === list.length ? weights : list.map(() => 1 / list.length);
    const least = Math.min(metrics.islandMin, Math.floor(available / list.length));
    let start = across ? area.x : area.y, used = 0;
    const islands = list.map((group, index) => {
      const later = list.length - 1 - index;
      const size = later ? Math.round(clamp(available * shares[index], least, available - used - later * least)) : available - used;
      const box = across ? rect(start, area.y, size, area.height) : rect(area.x, start, area.width, size);
      used += size;
      start += size + metrics.gutter;
      return {tabs: group.map(record => record.id), active: (group.find(record => record.active) ?? group[0]).id, rect: box};
    });
    const split = list.length === 2 ? {min: least, max: available - least, now: across ? islands[0].rect.width : islands[0].rect.height} : null;
    return {islands, split};
  };
  const requirementNow = requirement();
  const aria = {left: null, right: null, bottom: null, 'left-islands': null, 'right-islands': null, 'bottom-islands': null};
  const byOrder = (a, b) => a.order - b.order;
  const bottomIslands = bottom.state === 'docked' ? islandsOf(bottomDocked, bottom.rect, entry.weights?.bottom, true) : null;
  Object.assign(bottom, {
    groups: bottomIslands?.islands ?? [],
    panels: {
      docked: bottom.state === 'docked' ? bottomDocked.map(record => record.id) : [],
      strip: (bottom.state === 'strip' ? [...bottomDocked, ...bottomStrip].sort(byOrder) : bottomStrip).map(record => record.id),
      sheet: [],
    },
  });
  aria['bottom-islands'] = bottomIslands?.split ?? null;
  const regions = {bottom};
  for (const side of ['left', 'right']) {
    const s = sides[side];
    const docked = s.state === 'docked';
    const islands = docked ? islandsOf(s.docked, rects[side], entry.weights?.[side], false) : null;
    regions[side] = {
      state: s.state,
      size: docked ? s.size : 0,
      strip: s.state === 'strip' || s.strip.length ? metrics.strip : 0,
      sizeKey: docked ? s.sizeKey : null,
      reason: s.reason,
      rect: rects[side] ?? null,
      stripRect: rects[`${side}-strip`] ?? null,
      groups: islands?.islands ?? [],
      panels: {docked: s.docked.map(record => record.id), strip: s.strip.map(record => record.id), sheet: s.sheet.map(record => record.id)},
    };
    if (docked) aria[side] = {min: s.min, max: Math.round(clamp(s.size + stage.width - requirementNow, s.min, s.max)), now: s.size};
    aria[`${side}-islands`] = islands?.split ?? null;
  }
  if (bottomLimits) aria.bottom = {min: bottomLimits.min, max: bottomLimits.max, now: bottom.size};

  // Floating panels: kept inside the stage (never over the band or the transport).
  const floatSheet = across.fold?.float === 'sheet';
  const floating = floatSheet ? [] : records.filter(record => record.dock === 'float')
    .map((record, index) => ({panel: record.id, ...clampFloating(record.rect, describe(record), stage, metrics, index)}));

  const panels = {};
  for (const descriptor of catalog) {
    const record = records.find(item => item.id === descriptor.id);
    if (!record) { panels[descriptor.id] = {presentation: 'unavailable', side: null, dock: null, group: 0, active: false, visible: false}; continue; }
    let presentation;
    if (record.dock === 'hidden') presentation = 'hidden';
    else if (record.dock === 'float') presentation = floatSheet ? 'sheet' : 'float';
    else if (record.side === 'bottom') presentation = record.dock === 'bottom' && bottom.state === 'docked' ? 'docked' : 'strip';
    else presentation = sides[record.side].sheet.includes(record) ? 'sheet' : sides[record.side].strip.includes(record) ? 'strip' : 'docked';
    const active = presentation === 'docked' && record.active === true;
    panels[descriptor.id] = {presentation, side: record.side, dock: record.dock, group: record.group ?? 0, active, visible: active || presentation === 'float'};
  }

  const stageInsets = {top: down.insetTop, right: across.inset, bottom: down.insetBottom, left: across.inset};
  const corner = metrics.corner, cornerWidth = env.cornerWidth ?? corner.width;
  const messageSlot = {width: Math.max(0, across.message === 'inset'
    ? stage.width - 2 * corner.messageInset
    : stage.width - 2 * (cornerWidth + corner.inset + corner.gap))};
  const bodyRows = size => {
    const body = size - t.header - t.labelHeader - (down.timeline?.pad ?? 0);
    const pinned = clamp(Math.floor(body / t.row), 0, t.pinned);
    return {pinned, content: Math.max(0, Math.floor((body - pinned * t.row) / t.row))};
  };
  const solution = {
    mode, tier, height: heightTier,
    rail: {side: railLeft ? 'left' : 'right', orientation: 'vertical', compact: railCompact, width: railWidth, rect: rects.rail},
    regions, floating, stage, stageInsets,
    timelineRows: bottom.state === 'docked' ? bodyRows(bottom.size) : {pinned: 0, content: 0},
    messageSlot, aria, panels,
    rects: {band: rects.band, workspace: rects.workspace, rail: rects.rail, stage},
  };
  if (env.artboard) solution.zoom = fitZoom(stage, stageInsets, env.artboard);
  return solution;
}

