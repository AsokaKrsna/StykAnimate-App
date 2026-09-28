import test from 'node:test';
import assert from 'node:assert/strict';
import gpu from '../desktop/gpu-switches.cjs';

const {gpuSwitches, applyGpuSwitches} = gpu;

function commandLine(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    hasSwitch: name => values.has(name),
    getSwitchValue: name => values.get(name) ?? '',
    appendSwitch: (name, value = '') => { values.set(name, value); },
  };
}

test('Linux opts in to WebGPU through Vulkan without any environment variable', () => {
  assert.deepEqual(gpuSwitches({platform: 'linux', env: {}}), {switches: ['enable-unsafe-webgpu'], features: ['Vulkan']});
});

test('Windows and macOS keep Chromium defaults', () => {
  for (const platform of ['win32', 'darwin']) assert.deepEqual(gpuSwitches({platform, env: {}}), {switches: [], features: []});
});

test('STYK_GPU_UNSAFE=1 still forces the opt-in on every platform', () => {
  assert.deepEqual(gpuSwitches({platform: 'win32', env: {STYK_GPU_UNSAFE: '1'}}), {switches: ['enable-unsafe-webgpu'], features: []});
  assert.deepEqual(gpuSwitches({platform: 'darwin', env: {STYK_GPU_UNSAFE: '1'}}).switches, ['enable-unsafe-webgpu']);
});

test('STYK_GPU_UNSAFE=0 leaves the driver allowlist untouched, even on Linux', () => {
  assert.deepEqual(gpuSwitches({platform: 'linux', env: {STYK_GPU_UNSAFE: '0'}}), {switches: [], features: []});
});

test('the command line receives the switches and merges user features instead of replacing them', () => {
  const plain = commandLine();
  applyGpuSwitches(plain, {platform: 'linux', env: {}});
  assert.equal(plain.values.has('enable-unsafe-webgpu'), true);
  assert.equal(plain.values.get('enable-features'), 'Vulkan');

  const user = commandLine({'enable-features': 'UseOzonePlatform,Vulkan'});
  applyGpuSwitches(user, {platform: 'linux', env: {}});
  assert.equal(user.values.get('enable-features'), 'UseOzonePlatform,Vulkan');

  const other = commandLine({'enable-features': 'VaapiVideoDecoder'});
  applyGpuSwitches(other, {platform: 'linux', env: {}});
  assert.equal(other.values.get('enable-features'), 'VaapiVideoDecoder,Vulkan');
});

test('nothing is appended where no switch is needed', () => {
  const windows = commandLine();
  applyGpuSwitches(windows, {platform: 'win32', env: {}});
  assert.equal(windows.values.size, 0);
});
