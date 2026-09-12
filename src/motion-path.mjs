/** Motion-path trails: a read-only projection of the evaluator onto the overlay.
 * Every output-frame tick contributes one point; keyed times are emphasized.
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
    if (uid === null || uid === undefined) return;
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
    for (const object of frame?.objects ?? []) push(object.unique_id, -1);
  } else {
    if (selected.has(editor.selectedUid)) push(editor.selectedUid, editor.selectedJoint);
    for (const uid of selected) if (uid !== editor.selectedUid) push(uid, -1);
  }
  return out;
}

/** Display rows remain the single source of tick layout, including sheet clips.
 * `range` > 0 keeps only a ±window of ticks around the playhead. */
export function motionPathTicks(editor, {maxPoints = 1600, range = 0} = {}) {
  const total = editor.totalTicks;
  if (total <= 0) return {ticks: [], keyTicks: new Set(), stride: 1};
  const low = range > 0 ? Math.max(0, editor.tick - range) : 0;
  const high = range > 0 ? Math.min(total - 1, editor.tick + range) : total - 1;
  const count = Math.max(0, high - low + 1);
  const stride = Math.max(1, Math.ceil(count / maxPoints));
  const ticks = [];
  for (let tick = low; tick <= high; tick += stride) ticks.push(tick);
  if (high > 0 && ticks.at(-1) !== high) ticks.push(high);
  const keyTicks = keyTicksFor(editor);
  for (const tick of keyTicks) if (tick >= low && tick < high && !ticks.includes(tick)) ticks.push(tick);
  if (editor.tick >= low && editor.tick <= high && !ticks.includes(editor.tick)) ticks.push(editor.tick);
  ticks.sort((a, b) => a - b);
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

/** Revision-aware path store. One live session resamples only its edit window. */
export class MotionPathCache {
  constructor({maxPaths = 32} = {}) {
    this.maxPaths = maxPaths; this.paths = new Map(); this.tweenCache = new PlaybackTweenCache();
  }
  clear() { this.paths.clear(); }
  get(editor, target, {session, range = 0} = {}) {
    const key = motionPathTargetKey(target);
    if (!key) return null;
    let entry = this.paths.get(key);
    const report = session?.report ?? editor.report;
    const stale = !entry || entry.base !== editor.report || entry.revision !== editor.revision ||
      entry.totalTicks !== editor.totalTicks || entry.layerRevision !== editor.layerRevision ||
      entry.range !== range;
    if (stale) {
      const plan = motionPathTicks(editor, {range});
      entry = {key, base: editor.report, revision: editor.revision, layerRevision: editor.layerRevision,
        totalTicks: editor.totalTicks, range, ticks: plan.ticks, keyTicks: keyTicksForTarget(editor, target) ?? plan.keyTicks,
        points: new Map(), fresh: true, liveRange: null, tweenCache: this.tweenCache};
      this.paths.delete(key); this.paths.set(key, entry);
      while (this.paths.size > this.maxPaths) this.paths.delete(this.paths.keys().next().value);
    }
    const rows = timeline(report), authored = Boolean(report._styk?.layerSheet || animationChannels(report).length);
    const liveRange = session?.range;
    for (const tick of entry.ticks) {
      const live = liveRange && tick >= liveRange[0] && tick < liveRange[1];
      // A cancelled gesture leaves no revision bump; resample its window once.
      const staleLive = !session && entry.liveRange && tick >= entry.liveRange[0] && tick < entry.liveRange[1];
      if (entry.points.has(tick) && !entry.fresh && !live && !staleLive) continue;
      const value = samplePathPoint(report, target, tick, {rows, tweenCache: entry.tweenCache, authored});
      entry.points.set(tick, {tick, x: value?.x, y: value?.y, key: entry.keyTicks?.has(tick) ?? false, missing: !value});
    }
    entry.fresh = false;
    entry.liveRange = liveRange ?? null;
    entry.live = session ?? null;
    return entry;
  }
}

/** Ordered point list for drawing/hit-testing, skipping absent ticks. */
export function pathPoints(entry) {
  const out = [];
  for (const tick of entry.ticks) {
    const point = entry.points.get(tick);
    if (point && !point.missing) out.push(point);
  }
  return out;
}

export function pickMotionPathPoint(entry, point, {project, radius = 9, excludeTick} = {}) {
  let best = radius * radius, hit = null;
  for (const sample of pathPoints(entry)) {
    if (excludeTick !== undefined && sample.tick === excludeTick) continue;
    const p = project(sample);
    const distance = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (distance <= best) { best = distance; hit = sample; }
  }
  return hit ? {...hit, distance: Math.sqrt(best)} : null;
}

/** Trail polyline + per-tick dots; keys and the current tick are emphasized.
 * `labels` draws frame numbers next to the points. */
export function drawMotionPath(context, entry, project, {tick, hover, dragging, color = '#0d99ff',
  labels = false, faint = false} = {}) {
  const points = pathPoints(entry);
  if (!points.length) return;
  context.save();
  context.lineCap = 'round'; context.lineJoin = 'round';
  const alpha = faint ? 0.3 : 1;
  context.strokeStyle = color; context.globalAlpha = 0.55 * alpha; context.lineWidth = 1.5;
  context.beginPath();
  // Adjacent sampled ticks connect; missing entries split the trail so presence
  // and membership gaps never draw a false chord.
  let pen = false;
  for (const tick of entry.ticks) {
    const sample = entry.points.get(tick);
    if (!sample || sample.missing) { pen = false; continue; }
    const p = project(sample);
    if (pen) context.lineTo(p.x, p.y); else context.moveTo(p.x, p.y);
    pen = true;
  }
  context.stroke();
  for (const sample of points) {
    const p = project(sample), current = sample.tick === tick;
    const highlighted = dragging?.tick === sample.tick || hover?.tick === sample.tick;
    context.globalAlpha = (sample.key || current ? 0.95 : 0.7) * alpha;
    context.beginPath();
    if (sample.key || current) {
      const r = current ? 5.5 : 4.5;
      context.moveTo(p.x, p.y - r); context.lineTo(p.x + r, p.y); context.lineTo(p.x, p.y + r); context.lineTo(p.x - r, p.y);
      context.closePath();
    } else context.arc(p.x, p.y, highlighted ? 4.5 : 3, 0, Math.PI * 2);
    context.fillStyle = current || highlighted ? '#ffffff' : color;
    context.strokeStyle = color; context.lineWidth = highlighted || current ? 2 : 1;
    context.fill();
    if (sample.key || current || highlighted) context.stroke();
  }
  if (labels) {
    const sparse = points.length <= 32;
    context.font = '600 9px Inter, system-ui, sans-serif';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    for (const sample of points) {
      const highlighted = dragging?.tick === sample.tick || hover?.tick === sample.tick;
      if (!sample.key && sample.tick !== tick && !highlighted && !sparse) continue;
      const p = project(sample), text = String(sample.tick + 1);
      const width = context.measureText(text).width + 6;
      const x = p.x + 7, y = p.y - 9;
      context.globalAlpha = (sample.tick === tick || highlighted ? 0.95 : 0.8) * alpha;
      context.beginPath();
      context.roundRect(x, y - 6, width, 12, 6);
      context.fillStyle = 'rgba(255,255,255,0.88)';
      context.strokeStyle = color; context.lineWidth = 0.75;
      context.fill(); context.stroke();
      context.fillStyle = color;
      context.fillText(text, x + width / 2, y);
    }
  }
  context.restore();
}
