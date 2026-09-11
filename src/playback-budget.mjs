/** Resident bytes per CPU/GPU cache. Keep the conservative legacy budget when
 * the runtime has no memory hint. Cap each cache at 1/16 of the reported RAM
 * tier and 512 MiB; explicit constructor budgets always take precedence.
 * Packet sharing makes this a working-set budget, not a per-frame multiplier. */
export function playbackMemoryBudget(deviceMemory=globalThis.navigator?.deviceMemory){
  const mib=1024*1024;
  return typeof deviceMemory==='number'&&Number.isFinite(deviceMemory)&&deviceMemory>0
    ? Math.max(32,Math.min(512,deviceMemory*64))*mib : 128*mib;
}

/** Partition retained pixel caches from one hardware policy. These are app-owned
 * cache targets, not a claim about total process RAM (document data, decoding
 * internals, output canvases and transient GPU uploads also consume memory). */
export function previewMemoryPlan(deviceMemory = globalThis.navigator?.deviceMemory) {
  const base = playbackMemoryBudget(deviceMemory), mib = 1024 * 1024;
  const plan = {cpuFrames: base, gpuFrames: base, workerImages: Math.min(32 * mib, base / 4),
    workerRasters: Math.min(128 * mib, base / 4), workerVectors: Math.min(32 * mib, base / 8), editorImages: Math.min(32 * mib, base / 4),
    editorRasters: Math.min(128 * mib, base / 2), thumbnails: Math.min(24 * mib, base / 8), library: 8 * mib};
  return {...plan, retainedBytes: Object.values(plan).reduce((sum, bytes) => sum + bytes, 0)};
}
