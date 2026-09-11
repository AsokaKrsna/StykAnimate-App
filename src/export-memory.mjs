import {exportSamplingSize} from './export-sampling.mjs';

const MiB = 1024 * 1024;
/** A conservative allowance for export-owned pixels, not a measurement of free RAM. */
export function exportMemoryPlan(width, height, smoothing = 'edges', {
  deviceMemory = globalThis.navigator?.deviceMemory, maxWorkingBytes,
} = {}) {
  const sampling = exportSamplingSize(width, height, smoothing);
  const tier = Number.isFinite(deviceMemory) && deviceMemory > 0 ? deviceMemory : 4;
  const budget = maxWorkingBytes ?? Math.max(64, Math.min(512, tier * 64)) * MiB;
  if (!Number.isSafeInteger(budget) || budget < 8 * MiB || budget > 512 * MiB)
    throw new Error('Export memory allowance must be between 8 and 512 MiB.');
  const frameBytes = width * height * 4;
  // Output, transfer, encoding/readback and bounded video queue; crisp rendering
  // also needs WASM pixels and their straight-alpha copy.
  const frameWorkingBytes = frameBytes * (smoothing === 'none' ? 10 : 6);
  const scratchAllowance = Math.min(20 * MiB, budget / 8);
  let tileSize = 512;
  while ((tileSize * sampling.factor + 8) ** 2 * 4 * 4 > scratchAllowance && tileSize > 32) tileSize /= 2;
  const scratchBytes = (tileSize * sampling.factor + 8) ** 2 * 4 * 4;
  const assetBytes = Math.min(128 * MiB, Math.floor(budget - frameWorkingBytes - scratchBytes));
  if (assetBytes < 4 * MiB) {
    const error = new Error('This export size exceeds the safe memory allowance for this device. Choose smaller output dimensions. Your animation has not changed.');
    error.code = 'export_memory_limit'; throw error;
  }
  return {...sampling, maxWorkingBytes: budget, frameWorkingBytes, scratchBytes, assetBytes, tileSize};
}
