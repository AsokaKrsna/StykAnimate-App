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

/** Partition retained pixel caches from one hardware policy. These are app-owned
 * cache targets, not a claim about total process RAM (document data, decoding
 * internals, output canvases and transient GPU uploads also consume memory). */
export function previewMemoryPlan(deviceMemory = deviceMemoryHint()) {
  const base = playbackMemoryBudget(deviceMemory), mib = 1024 * 1024;
  const plan = {cpuFrames: base, gpuFrames: base, workerImages: Math.min(64 * mib, base / 4),
    workerRasters: Math.min(128 * mib, base / 4), workerVectors: Math.min(32 * mib, base / 8), editorImages: Math.min(64 * mib, base / 4),
    editorRasters: Math.min(128 * mib, base / 2), thumbnails: Math.min(24 * mib, base / 8), library: 8 * mib};
  return {...plan, retainedBytes: Object.values(plan).reduce((sum, bytes) => sum + bytes, 0)};
}
