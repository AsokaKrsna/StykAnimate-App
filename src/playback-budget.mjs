/** Best available device-RAM hint in gigabytes. The desktop preload exposes
 * real system memory; browsers only report the privacy-bucketed
 * navigator.deviceMemory tier (8 GB maximum), which understates large hosts. */
export function deviceMemoryHint(environment = globalThis) {
  const bytes = environment.stykDesktop?.memoryBytes;
  return Number.isFinite(bytes) && bytes > 0 ? bytes / 1073741824 : environment.navigator?.deviceMemory;
}

/** Resident bytes per CPU/GPU cache. Keep the conservative legacy budget when
 * the runtime has no memory hint. Cap each cache at 1/16 of the reported RAM
 * tier and 1 GiB; explicit constructor budgets always take precedence.
 * Packet sharing makes this a working-set budget, not a per-frame multiplier. */
export function playbackMemoryBudget(deviceMemory=deviceMemoryHint()){
  const mib=1024*1024;
  return typeof deviceMemory==='number'&&Number.isFinite(deviceMemory)&&deviceMemory>0
    ? Math.max(32,Math.min(1024,deviceMemory*64))*mib : 128*mib;
}

/** Free GPU allocations retained for reuse after a frame/batch releases them.
 * Active frame textures remain accounted by gpuFrames; active raster scratch
 * may temporarily exceed these retention targets for one bounded batch. */
export function playbackReuseMemoryPlan(frameBytes=playbackMemoryBudget()) {
  const mib=1024*1024;
  return {gpuRecycled:Math.min(128*mib,frameBytes/4),gpuMsaa:Math.min(64*mib,frameBytes/8),gpuScratch:Math.min(16*mib,frameBytes/16)};
}

/** Partition retained pixel caches from one hardware policy. These are app-owned
 * cache targets, not a claim about total process RAM (document data, decoding
 * internals, output canvases and transient GPU uploads also consume memory). */
export function previewMemoryPlan(deviceMemory = deviceMemoryHint()) {
  const base = playbackMemoryBudget(deviceMemory), mib = 1024 * 1024;
  const plan = {cpuFrames: base, gpuFrames: base, workerImages: Math.min(64 * mib, base / 4),
    workerRasters: Math.min(128 * mib, base / 4), workerVectors: Math.min(32 * mib, base / 8), editorImages: Math.min(64 * mib, base / 4),
    editorRasters: Math.min(128 * mib, base / 2), thumbnails: Math.min(24 * mib, base / 8), library: 8 * mib,...playbackReuseMemoryPlan(base)};
  return {...plan, retainedBytes: Object.values(plan).reduce((sum, bytes) => sum + bytes, 0)};
}

/** Parallel packet-preparation workers. Every worker mirrors the document and
 * owns private image/raster/vector caches, so the count follows real RAM when
 * the hint is honest; the browser's capped 8 GB tier keeps the safe default.
 * Workers still share the machine with the UI thread, compositor and GPU
 * process, so a quarter of the hardware threads is the ceiling, not the goal. */
export function playbackWorkerCount(cores = globalThis.navigator?.hardwareConcurrency, deviceMemory = deviceMemoryHint()) {
  const threads = Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 4;
  const byCores = Math.max(1, Math.min(3, Math.floor(threads / 4)));
  if (typeof deviceMemory === 'number' && Number.isFinite(deviceMemory) && deviceMemory > 0)
    return Math.min(byCores, deviceMemory >= 16 ? 3 : deviceMemory >= 8 ? 2 : 1);
  return Math.min(byCores, 2);
}
