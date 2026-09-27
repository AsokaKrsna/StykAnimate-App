/**
 * Surface-scoped chrome updates (architecture.md §3.2). The editor chrome is a
 * list of surfaces (the title, the transport, the inspector, …), each with the
 * reasons that make it stale and the function that brings it up to date.
 * invalidate(reason) marks the surfaces that listen for the reason ('all'
 * marks every one) and schedules one pass; the pass updates the marked
 * surfaces in the order they were declared.
 *
 *   const ui = createInvalidator({isPlaying: () => state.playing});
 *   ui.surface('title', {on: ['document', 'save'], update: updateTitle});
 *   ui.surface('transport', {on: ['tick'], playbackInterval: 200, update: updateTransport});
 *   ui.surface('inspector', {on: ['selection', 'revision'], quiet: true, update: renderInspector});
 *   ui.invalidate('selection');
 *
 * Playback stays quiet:
 *   quiet             the surface is not updated while playing; it stays
 *                     marked and updates in the first pass after playback
 *                     stops (the caller invalidates when it stops).
 *   playbackInterval  while playing, at most one update per this many ms
 *                     (the transport's readout: 200 ms, 5 Hz); a marked
 *                     surface waits for its time.
 *   visible           an optional () => boolean; a hidden surface stays
 *                     marked, and show(name) updates it when it shows.
 * isBlocked() (the canvas being prepared after playback) skips whole passes
 * and keeps every mark; the caller invalidates again when it unblocks.
 *
 * Surfaces write through dom-write.mjs, so an update that finds nothing
 * changed writes nothing. DOM-free at import: schedule and now are injected
 * (requestAnimationFrame and performance.now by default).
 */
export const UI_REASONS = Object.freeze(['tick', 'selection', 'revision', 'context', 'mode', 'range', 'view', 'settings',
  'document', 'save', 'objects', 'drag', 'playback']);

export function createInvalidator({
  schedule = callback => requestAnimationFrame(callback),
  now = () => performance.now(),
  isPlaying = () => false,
  isBlocked = () => false,
  afterPass = null,
  onError = error => { throw error; },
} = {}) {
  const surfaces = [], byName = new Map();
  let scheduled = false;

  const request = () => {
    if (scheduled) return;
    scheduled = true;
    schedule(pass);
  };
  /** Whether a surface may update now; `force` ignores quiet, visibility and the interval (a full update). */
  const ready = (surface, playing, time, force) => {
    if (force) return true;
    if (playing && surface.quiet) return false;
    if (surface.visible && !surface.visible()) return false;
    if (playing && surface.playbackInterval && time - surface.last < surface.playbackInterval) return 'later';
    return true;
  };
  const run = (surface, time) => {
    surface.dirty = false;
    surface.last = time;
    surface.updates++;
    try { surface.update(); } catch (error) { onError(error, surface.name); }
  };
  function pass({force = false} = {}) {
    scheduled = false;
    if (isBlocked()) return false;
    const playing = isPlaying(), time = now();
    let later = false;
    for (const surface of surfaces) {
      if (!surface.dirty && !force) continue;
      const state = ready(surface, playing, time, force);
      if (state === 'later') later = true;
      if (state === true) run(surface, time);
    }
    if (later) request();
    afterPass?.();
    return true;
  }

  return {
    /** Declares a surface; surfaces update in declaration order. */
    surface(name, {on = [], update, quiet = false, playbackInterval = 0, visible = null}) {
      if (byName.has(name)) throw new Error(`Surface ${name} is already declared.`);
      if (typeof update !== 'function') throw new TypeError(`Surface ${name} needs an update function.`);
      for (const reason of on) if (!UI_REASONS.includes(reason)) throw new TypeError(`Unknown invalidation reason: ${reason}`);
      const surface = {name, on: new Set(on), update, quiet, playbackInterval, visible, dirty: false, last: -Infinity, updates: 0};
      surfaces.push(surface);
      byName.set(name, surface);
      return this;
    },
    /** Marks the surfaces that listen for any of `reasons` ('all': every surface) and schedules a pass. */
    invalidate(...reasons) {
      let marked = false;
      for (const surface of surfaces) {
        if (reasons.includes('all') || reasons.some(reason => surface.on.has(reason))) { surface.dirty = true; marked = true; }
      }
      if (marked) request();
      return marked;
    },
    /**
     * Updates one surface now if it may (quiet, visibility, interval); otherwise it stays marked for a
     * later pass. A direct update is the caller's own timing (the render loop's readout), so isBlocked()
     * does not hold it back.
     */
    update(name) {
      const surface = byName.get(name);
      if (!surface) throw new Error(`Unknown surface: ${name}`);
      surface.dirty = true;
      const state = ready(surface, isPlaying(), now(), false);
      if (state === true) { run(surface, now()); return true; }
      request();
      return false;
    },
    /** Updates every surface now, marked or not, as one full refresh (startup, a restored document). */
    flushAll() { for (const surface of surfaces) surface.dirty = true; return pass({force: true}); },
    /** A surface that became visible updates now if it was marked while hidden. */
    show(name) {
      const surface = byName.get(name);
      if (surface?.dirty && !isBlocked() && ready(surface, isPlaying(), now(), false) === true) run(surface, now());
    },
    isDirty: name => Boolean(byName.get(name)?.dirty),
    /** How often each surface updated, for tests and diagnostics. */
    stats: () => Object.fromEntries(surfaces.map(surface => [surface.name, surface.updates])),
  };
}
