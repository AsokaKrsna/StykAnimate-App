'use strict';

// Chromium switches that decide whether the editor gets a hardware WebGPU
// adapter. Windows and macOS need none: Chromium enables WebGPU through D3D12
// and Metal. Electron's Chromium does not enable Linux WebGPU by default, so the
// renderer would silently fall back to the Canvas 2D compatibility path even on
// a capable GPU (or land on SwiftShader, which the renderer rejects). Vulkan
// plus the WebGPU opt-in reaches the real device on Mesa and NVIDIA drivers.
//
// The renderer keeps its own safety net: no adapter, or a software adapter,
// selects the compatibility renderer, so a driver that cannot do WebGPU still
// edits and plays back correctly.
//
// STYK_GPU_UNSAFE=1 forces the opt-in on any platform; STYK_GPU_UNSAFE=0 leaves
// Chromium's own driver allowlist untouched everywhere (useful when diagnosing
// a driver problem).

const LINUX_FEATURES = ['Vulkan'];

function gpuSwitches({ platform = process.platform, env = process.env } = {}) {
  const forced = env.STYK_GPU_UNSAFE;
  if (forced === '0') return { switches: [], features: [] };
  const enable = forced === '1' || platform === 'linux';
  return {
    switches: enable ? ['enable-unsafe-webgpu'] : [],
    features: platform === 'linux' ? [...LINUX_FEATURES] : [],
  };
}

// `commandLine` is Electron's app.commandLine. A --enable-features the user
// passed on the command line is merged, never replaced.
function applyGpuSwitches(commandLine, options) {
  const { switches, features } = gpuSwitches(options);
  for (const name of switches) commandLine.appendSwitch(name);
  if (features.length) {
    const existing = commandLine.hasSwitch('enable-features') ? commandLine.getSwitchValue('enable-features').split(',') : [];
    const merged = [...new Set([...existing, ...features].filter(Boolean))];
    commandLine.appendSwitch('enable-features', merged.join(','));
  }
  return { switches, features };
}

module.exports = { gpuSwitches, applyGpuSwitches };
