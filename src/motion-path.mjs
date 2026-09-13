/** Motion-path trails: a read-only projection of the evaluator onto the overlay.
 * Output-frame samples retain exact times; dense trails use bounded sampling.
 * Path data lives outside the document — edits write through ordinary editor
 * commands while a drag session supplies a virtual report for live resampling.
 */
import {evaluatedFrame, evaluatedNativeFrame, timeline, buildGeometry} from './pivot/geometry.mjs';
import {ikComponents} from './ik-joined.mjs';
import {sheetKeyAt, sheetTrack} from './layer-sheet.mjs';
import {layerIdForUid} from './layers.mjs';
import {animationChannels, animationChannelId, findAnimationChannel} from './animation-channels.mjs';
import {PlaybackTweenCache} from './playback-tween-cache.mjs';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const EMPTY_SCENE = {objects: new Map()};

/** The node or camera the overlay currently shows a path for. */
export function motionPathTarget(editor, {camera = false} = {}) {
  if (camera) return {kind: 'camera'};
  const uid = editor.selectedUid;
  if (uid === null || uid === undefined || editor.selectedUids?.size !== 1) return null;
  const object = editor.selectionFrame?.objects.find(o => o.unique_id === uid);
  if (!object) return null;
  const figure = editor.report.figure_types.find(f => f.figure_type_id === object.figure_type_id);
  if (!figure?.segments?.length) return null;
  const joint = editor.selectedJoint >= 0 && editor.selectedJoint < figure.segments.length ? editor.selectedJoint : -1;
  return {kind: 'node', uid, handleId: joint < 0 ? 0 : Number(figure.segments[joint].segment_id), joint};
}

export function motionPathTargetKey(target) {
  return target ? (target.kind === 'camera' ? 'camera' : `${target.uid}:${target.handleId}`) : '';
}

/** Every selected figure's trail target — the primary node's selected joint
 * resolves first so its colour stays stable across multi-selections. */
export function motionPathTargets(editor, {camera = false, all = false, maxTargets = 24} = {}) {
  if (camera) return [{kind: 'camera'}];
  const frame = editor.selectionFrame ?? editor.evaluatedFrame, out = [], seen = new Set();
  const push = (uid, joint) => {
    if (uid === null || uid === undefined || out.length >= maxTargets) return;
    const object = frame?.objects.find(o => o.unique_id === uid);
    if (!object) return;
    const figure = editor.report.figure_types.find(f => f.figure_type_id === object.figure_type_id);
    if (!figure?.segments?.length) return;
    const j = joint >= 0 && joint < figure.segments.length ? joint : -1;
    const target = {kind: 'node', uid, handleId: j < 0 ? 0 : Number(figure.segments[j].segment_id), joint: j};
    const key = motionPathTargetKey(target);
    if (!seen.has(key) && out.length < maxTargets) { seen.add(key); out.push(target); }
  };
  const selected = editor.selectedUids ?? new Set();
  if (all) {
    if (editor.selectedUid !== null && editor.selectedUid !== undefined)
      push(editor.selectedUid, editor.selectedJoint);
    for (const object of frame?.objects ?? []) { if (out.length >= maxTargets) break; push(object.unique_id, -1); }
  } else {
    if (selected.has(editor.selectedUid)) push(editor.selectedUid, editor.selectedJoint);
    for (const uid of selected) if (uid !== editor.selectedUid) push(uid, -1);
  }
  return out;
}

/** Display rows remain the single source of tick layout, including sheet clips.
 * `range` > 0 keeps only a ±window of ticks around the playhead. */
export function motionPathTicks(editor, {maxPoints = 1600, range = 0, target} = {}) {
  const total = editor.totalTicks;
  if (total <= 0) return {ticks: [], keyTicks: new Set(), stride: 1};
  const center = clamp(editor.tick, 0, total - 1);
  const low = range > 0 ? Math.max(0, center - range) : 0;
  const high = range > 0 ? Math.min(total - 1, center + range) : total - 1;
  const count = Math.max(0, high - low + 1), budget = Math.max(3, Math.floor(maxPoints));
  const keyTicks = (target && keyTicksForTarget(editor, target)) ?? keyTicksFor(editor);
  const included = new Set([low, high]);
  if (editor.tick >= low && editor.tick <= high) included.add(editor.tick);
  // Key-heavy documents must obey the same bound as long interpolated spans.
  const keys = [...keyTicks].filter(t => t > low && t < high).sort((a, b) => a - b);
  const keyBudget = Math.min(keys.length, Math.floor((budget - included.size) / 2));
  for (let i = 0; i < keyBudget; i++) included.add(keys[Math.floor(i * keys.length / keyBudget)]);
  const stride = count <= budget ? 1 : Math.max(1, Math.ceil(count / Math.max(1, budget - included.size)));
  for (let t = low; t <= high && included.size < budget; t += stride) included.add(t);
  const ticks = [...included].sort((a, b) => a - b);
  return {ticks, keyTicks, stride};
}

/** Times that own an authored or stored pose for this target. */
function keyTicksFor(editor) {
  const report = editor.report, ticks = new Set(), sheet = report._styk?.layerSheet;
  if (sheet) {
    const track = sheetTrack(report, editor.selectedUid != null ? layerIdForUid(report, editor.selectedUid) : 'camera');
    for (const key of track?.keys ?? []) if (!key.patchOnly && key.tick < sheet.duration) ticks.add(key.tick);
    return ticks;
  }
  if (animationChannels(report).length) {
    for (const channel of animationChannels(report)) {
      if (channel.target.kind === 'scene') continue;
      for (const key of channel.keys) if (!key.hidden) ticks.add(key.tick);
    }
    return ticks;
  }
  const rows = timeline(report);
  for (const row of rows) if (row.count > 0) ticks.add(row.start);
  return ticks;
}

/** Per-target keyed times, used only for the emphasized markers. */
export function keyTicksForTarget(editor, target) {
  const report = editor.report, sheet = report._styk?.layerSheet, ticks = new Set();
  if (sheet) {
    const id = target.kind === 'camera' ? 'camera' : layerIdForUid(report, target.uid);
    for (const key of sheetTrack(report, id)?.keys ?? []) if (!key.patchOnly && key.tick < sheet.duration) ticks.add(key.tick);
    return ticks;
  }
  const channels = animationChannels(report);
  if (!channels.length) return null;
  const figureChannel = target.kind === 'node' ? findAnimationChannel(report, {kind: 'figure', uid: target.uid}, 'pose') : null;
  const layerId = target.kind === 'node' ? layerIdForUid(report, target.uid) : null;
  for (const channel of channels) {
    const t = channel.target;
    const owns = target.kind === 'camera'
      ? t.kind === 'camera'
      : (t.kind === 'figure' && t.uid === target.uid) || (t.kind === 'layer' && t.id === layerId && !figureChannel && channel.property === 'pose');
    if (!owns) continue;
    for (const key of channel.keys) if (!key.hidden) ticks.add(key.tick);
  }
  return ticks;
}

/** Join-connected uids on both endpoint frames of a native span. */
function nativeComponentUids(report, index, uid) {
  const needed = new Set();
  for (const frame of [report.keyframes[index], report.keyframes[index + 1]]) {
    if (!frame) continue;
    const objects = frame.objects, slot = objects.findIndex(o => o.unique_id === uid);
    if (slot < 0) continue;
    const slots = new Set([slot]), queue = [slot];
    let s = slot;
    while (objects[s]?.join) { s = objects[s].join.target_object_slot; if (slots.has(s) || !objects[s]) break; slots.add(s); queue.push(s); }
    for (let q = 0; q < queue.length; q++)
      for (const [i, child] of objects.entries())
        if (child.join && slots.has(child.join.target_object_slot) && !slots.has(i)) { slots.add(i); queue.push(i); }
    for (const i of slots) needed.add(objects[i].unique_id);
  }
  return needed;
}

function rowAt(rows, tick) {
  let low = 0, high = rows.length - 1;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (rows[mid].start <= tick) low = mid; else high = mid - 1; }
  return low;
}

/** Evaluate one display tick against `report` and resolve the target point. */
export function samplePathPoint(report, target, tick, {rows, tweenCache, geometry, authored} = {}) {
  rows ??= timeline(report);
  authored ??= Boolean(report._styk?.layerSheet || animationChannels(report).length);
  const index = rowAt(rows, tick), row = rows[index];
  const t = row?.count > 0 ? clamp((tick - row.start) / row.count, 0, 1) : 0;
  const frame = authored
    ? evaluatedFrame(report, index, t, tick)
    : evaluatedNativeFrame(report, index, t, tweenCache,
        target.kind === 'node' ? nativeComponentUids(report, index, target.uid) : undefined);
  if (target.kind === 'camera') {
    const camera = frame?.camera;
    return {x: report.canvas_width / 2 + Number(camera?.x ?? 0), y: report.canvas_height / 2 + Number(camera?.y ?? 0)};
  }
  const slot = frame?.objects.findIndex(o => o.unique_id === target.uid);
  if (slot === undefined || slot < 0) return null;
  let dirty = [slot];
  for (const group of ikComponents(frame)) if (group.includes(slot)) { dirty = group; break; }
  const scene = buildGeometry(report, frame, {previous: geometry ?? EMPTY_SCENE, dirtySlots: new Set(dirty)});
  const point = scene.objects.get(slot)?.joints.get(target.handleId);
  return point ? {x: point.x, y: point.y} : null;
}

/** Sampled trail for one target: compact point records keyed by display tick. */
export function sampleMotionPath(report, editor, target, {ticks, keyTicks, tweenCache} = {}) {
  ticks ??= motionPathTicks(editor).ticks;
  keyTicks ??= keyTicksForTarget(editor, target) ?? keyTicksFor(editor);
  const rows = timeline(report), authored = Boolean(report._styk?.layerSheet || animationChannels(report).length);
  const points = [];
  for (const tick of ticks) {
    const point = samplePathPoint(report, target, tick, {rows, tweenCache, authored});
    points.push({tick, x: point?.x, y: point?.y, key: keyTicks?.has(tick) ?? false, missing: !point});
  }
  return {target, points};
}

/** Revision-aware path store. One live session resamples only its edit window.
 * Sampling is time-budgeted: each get() works until a shared deadline so a dense
 * scene refines progressively over frames instead of blocking input for seconds.
 * Entries carry `complete` — callers should schedule another frame while false. */
export class MotionPathCache {
  constructor({maxPaths = 32, budgetMs = 6} = {}) {
    this.maxPaths = maxPaths; this.budgetMs = budgetMs;
    this.paths = new Map(); this.tweenCache = new PlaybackTweenCache();
  }
  clear() { this.paths.clear(); this.tweenCache.clear(); }
  /** Pointer input reads prepared data; it never evaluates the animation. */
  peek(editor, target) {
    const entry = this.paths.get(motionPathTargetKey(target));
    return entry?.base === editor.report && entry.revision === editor.revision &&
      entry.layerRevision === editor.layerRevision ? entry : null;
  }
  get(editor, target, {session, range = 0, deadline, maxPoints = 1600} = {}) {
    const key = motionPathTargetKey(target);
    if (!key) return null;
    let entry = this.paths.get(key);
    const report = session?.report ?? editor.report;
    const stale = !entry || entry.base !== editor.report || entry.revision !== editor.revision ||
      entry.totalTicks !== editor.totalTicks || entry.layerRevision !== editor.layerRevision ||
      entry.range !== range || entry.maxPoints !== maxPoints || (range > 0 && entry.center !== editor.tick) ||
      (editor.tick < editor.totalTicks && !entry.tickSet.has(editor.tick));
    if (stale) {
      const plan = motionPathTicks(editor, {range, maxPoints, target});
      // Keep the previous trail while it resamples so edits morph it instead of
      // clearing and re-growing it; a replaced document or a retimed scene must
      // start empty because its ticks no longer mean the same thing.
      const sameDocument = entry?.base === editor.report && entry.totalTicks === editor.totalTicks;
      const reusable = sameDocument && entry.revision === editor.revision && entry.layerRevision === editor.layerRevision && !entry.liveRange;
      const keep = sameDocument ? new Map(plan.ticks.filter(t => entry.points.has(t)).map(t => [t, entry.points.get(t)])) : new Map();
      // The playhead's surroundings matter most — sample nearest ticks first.
      const todo = plan.ticks.filter(t => !reusable || !keep.has(t)).sort((a, b) => Math.abs(a - editor.tick) - Math.abs(b - editor.tick));
      entry = {key, base: editor.report, revision: editor.revision, layerRevision: editor.layerRevision,
        totalTicks: editor.totalTicks, range, maxPoints, center: editor.tick, ticks: plan.ticks, tickSet: new Set(plan.ticks), keyTicks: plan.keyTicks,
        points: keep, todo: new Set(todo), liveRange: entry?.liveRange ?? null,
        tweenCache: this.tweenCache, complete: false};
      this.paths.delete(key); this.paths.set(key, entry);
      while (this.paths.size > this.maxPaths) this.paths.delete(this.paths.keys().next().value);
    }
    if (entry.rowsFor !== report) { entry.rows = timeline(report); entry.rowsFor = report; }
    const rows = entry.rows, authored = Boolean(report._styk?.layerSheet || animationChannels(report).length);
    const liveRange = session?.range;
    const staleRange = !session && entry.liveRange ? entry.liveRange : null;
    // Each virtual report is immutable for one pointer update. Queue its window
    // once, then let later renders finish it instead of restarting at its center.
    if (staleRange || (liveRange && entry.sampledReport !== report)) {
      const urgent = entry.ticks.filter(t =>
        (liveRange && t >= liveRange[0] && t < liveRange[1]) ||
        (staleRange && t >= staleRange[0] && t < staleRange[1]));
      const center = session?.tick ?? editor.tick;
      urgent.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
      entry.todo = new Set([...urgent, ...entry.todo]);
    }
    entry.sampledReport = report;
    const until = deadline ?? performance.now() + this.budgetMs;
    let started = false;
    const take = tick => {
      // Always sample at least once per call so a zero budget still progresses.
      if ((started || deadline !== undefined) && performance.now() > until) return false;
      started = true;
      const value = samplePathPoint(report, target, tick, {rows, tweenCache: entry.tweenCache, authored});
      entry.points.set(tick, {tick, x: value?.x, y: value?.y, key: entry.keyTicks?.has(tick) ?? false, missing: !value});
      entry.todo.delete(tick);
      entry.orderedPoints = null;
      return true;
    };
    for (const tick of entry.todo) if (!take(tick)) break;
    entry.complete = !entry.todo.size;
    entry.liveRange = liveRange ?? null;
    entry.live = session ?? null;
    return entry;
  }
}

/** Ordered point list for drawing/hit-testing, skipping absent ticks. */
export function pathPoints(entry) {
  if (entry.orderedPoints) return entry.orderedPoints;
  const out = [];
  for (const tick of entry.ticks) {
    const point = entry.points.get(tick);
    if (point && !point.missing) out.push(point);
  }
  entry.orderedPoints = out;
  return out;
}

export function pickMotionPathPoint(entry, point, {project, radius = 9, excludeTick, tick} = {}) {
  let best = radius * radius, hit = null;
  for (const sample of pathPoints(entry)) {
    if (excludeTick !== undefined && sample.tick === excludeTick) continue;
    const p = project(sample);
    const distance = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (distance < best || (distance === best && (!hit ||
        (tick !== undefined && Math.abs(sample.tick - tick) < Math.abs(hit.tick - tick))))) {
      best = distance; hit = sample;
    }
  }
  return hit ? {...hit, distance: Math.sqrt(best)} : null;
}

/**
 * Screen-space layout keeps dense/held paths legible without changing their
 * editable samples. Projection happens once per sample per draw.
 */
export function layoutMotionPath(entry, project, {tick, hover, dragging, dots = true, labels = false} = {}) {
  const projected = entry.ticks.map(t => {
    const sample = entry.points.get(t);
    return !sample || sample.missing ? null : {...sample, ...project(sample)};
  });
  const visible = projected.filter(Boolean);
  const priority = p => p.tick === dragging?.tick ? 4 : p.tick === hover?.tick ? 3 : p.tick === tick ? 2 : p.key ? 1 : 0;
  // Stable priority makes the current/hovered point win at overlapping positions.
  const candidates = [...visible].sort((a, b) => priority(b) - priority(a) || a.tick - b.tick);
  const cells = new Map(), markers = [], badges = [];
  const overlaps = (grid, x, y, distance) => {
    const cx = Math.floor(x / 12), cy = Math.floor(y / 12);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const p of grid.get((cx + dx) + ':' + (cy + dy)) ?? [])
        if ((x - p.x) ** 2 + (y - p.y) ** 2 < distance ** 2) return true;
    return false;
  };
  for (const p of candidates) {
    const rank = priority(p);
    if (!rank && !dots) continue;
    if (overlaps(cells, p.x, p.y, rank ? 7 : 9)) continue;
    const key = Math.floor(p.x / 12) + ':' + Math.floor(p.y / 12);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p);
    markers.push({...p, rank});
    if (badges.length >= 48 || !(rank >= 3 || (labels && (rank >= 2 || p.key || p === visible[0] || p === visible.at(-1))))) continue;
    const text = String(p.tick + 1), width = text.length * 6.5 + 12;
    const box = {x: p.x + 9, y: p.y - 23, width, height: 18, text, rank};
    if (badges.some(b => box.x < b.x + b.width + 5 && box.x + width + 5 > b.x && box.y < b.y + b.height + 4 && box.y + box.height + 4 > b.y)) continue;
    badges.push(box);
  }
  return {projected, markers, badges};
}

/** Neutral contrast halo, quieter past, crisp keys, and collision-free labels. */
export function drawMotionPath(context, entry, project, options = {}) {
  const {tick, color = '#0d99ff', faint = false} = options;
  const {projected, markers, badges} = layoutMotionPath(entry, project, options);
  if (!markers.length && !projected.some(Boolean)) return;
  const alpha = faint ? 0.25 : 1;
  context.save();
  context.lineCap = 'round'; context.lineJoin = 'round';
  const stroke = (width, style, opacity, side) => {
    context.beginPath();
    let previous = null, pen = false;
    for (const p of projected) {
      if (p && previous && (side === undefined || (side === 'past' ? p.tick <= tick : p.tick > tick))) {
        if (!pen) context.moveTo(previous.x, previous.y);
        context.lineTo(p.x, p.y); pen = true;
      } else pen = false;
      previous = p;
    }
    context.lineWidth = width; context.strokeStyle = style; context.globalAlpha = opacity * alpha; context.stroke();
  };
  stroke(4, '#ffffff', 0.65);
  stroke(1.6, color, 0.38, 'past');
  stroke(1.6, color, 0.85, 'future');
  // Batch small dots into a single fill instead of a canvas call per frame.
  context.beginPath();
  for (const p of markers) if (!p.rank) { context.moveTo(p.x + 2, p.y); context.arc(p.x, p.y, 2, 0, Math.PI * 2); }
  context.globalAlpha = 0.65 * alpha; context.fillStyle = color; context.fill();
  context.beginPath();
  for (const p of markers) if (p.rank === 1) {
    const r = 3.5;
    context.moveTo(p.x, p.y - r); context.lineTo(p.x + r, p.y);
    context.lineTo(p.x, p.y + r); context.lineTo(p.x - r, p.y); context.closePath();
  }
  context.globalAlpha = alpha; context.fillStyle = '#ffffff'; context.fill();
  context.strokeStyle = color; context.lineWidth = 1.5; context.stroke();
  for (const p of [...markers].reverse()) {
    if (p.rank < 2) continue;
    context.beginPath(); context.arc(p.x, p.y, 9, 0, Math.PI * 2);
    context.globalAlpha = 0.15 * alpha; context.fillStyle = color; context.fill();
    context.beginPath();
    context.arc(p.x, p.y, 5, 0, Math.PI * 2);
    context.globalAlpha = alpha; context.fillStyle = '#ffffff'; context.fill();
    context.strokeStyle = color; context.lineWidth = 2; context.stroke();
  }
  context.font = '600 10px Inter, system-ui, sans-serif';
  context.textAlign = 'center'; context.textBaseline = 'middle';
  for (const b of badges) {
    context.globalAlpha = (b.rank >= 2 ? 1 : 0.82) * alpha;
    context.beginPath(); context.roundRect(b.x, b.y, b.width, b.height, 5);
    context.fillStyle = '#263445'; context.fill();
    context.fillStyle = '#ffffff'; context.fillText(b.text, b.x + b.width / 2, b.y + b.height / 2);
  }
  context.restore();
}
