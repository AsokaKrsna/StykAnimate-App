import {SHAPE_BYTES, SHAPE_FLOATS, requiresCompatibilityTexture} from './renderer-geometry.mjs';

/** Subpixel strokes retain native Canvas coverage. Repeated translucent hairlines
 * amplify even small antialiasing differences in a composited effect. */
export function supportsVectorIsolation(items, resolution) {
  return !requiresCompatibilityTexture(items) && items.every(s => {
    if (s.type === 'line') return s.thickness <= 0 || s.thickness * resolution >= 2;
    if (s.type === 'circle') return Math.min(Math.abs(s.length), s.seg.segment_kind === 'circleFill' ? Infinity : s.thickness) * resolution >= 2;
    return true;
  });
}

/** Composite an opaque vector group before applying its figure opacity. The
 * result has the same lifetime as any other cached compatibility texture. */
export function rasterizeVectorGroup(renderer, {data, width, height, pixelScale, bounds, root}) {
  const device = renderer.device;
  if (!(data instanceof Float32Array) || data.length % SHAPE_FLOATS ||
    data.byteLength > device.limits.maxStorageBufferBindingSize || !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 || width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D ||
    !Number.isFinite(pixelScale) || pixelScale <= 0) throw new TypeError('Invalid isolated vector artwork.');
  let texture, msaa, uniform, shapes, transforms;
  try {
    texture = device.createTexture({label: 'Isolated vector artwork', size: [width, height], format: renderer.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT});
    const samples = renderer.isolationSamples;
    if (samples > 1) msaa = device.createTexture({label: 'Isolated vector antialiasing', size: [width, height], sampleCount: samples,
      format: renderer.format, usage: GPUTextureUsage.RENDER_ATTACHMENT});
    uniform = device.createBuffer({size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    shapes = device.createBuffer({size: Math.max(SHAPE_BYTES, data.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
    transforms = device.createBuffer({size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(uniform, 0, new Float32Array([
      pixelScale, 0, -(bounds.x-root.x)*pixelScale, pixelScale,
      0, pixelScale, -(bounds.y-root.y)*pixelScale, 0, width, height, 1, 1, 0, 0, width, height]));
    device.queue.writeBuffer(shapes, 0, data);
    device.queue.writeBuffer(transforms, 0, new Float32Array([0, 0, 1, 1]));
    const bindings = device.createBindGroup({layout: renderer.globalLayout, entries: [
      {binding: 0, resource: {buffer: uniform}}, {binding: 1, resource: {buffer: shapes}}, {binding: 2, resource: {buffer: transforms}}]});
    const encoder = device.createCommandEncoder({label: 'Composite isolated vector artwork'});
    const pass = encoder.beginRenderPass({colorAttachments: [{view: (msaa || texture).createView(),
      ...(msaa ? {resolveTarget: texture.createView()} : {}), clearValue: {r: 0, g: 0, b: 0, a: 0}, loadOp: 'clear', storeOp: msaa ? 'discard' : 'store'}]});
    pass.setPipeline(renderer.isolationPipeline); pass.setBindGroup(0, bindings); pass.setBindGroup(1, renderer.blankBindGroup);
    pass.draw(6, data.length / SHAPE_FLOATS); pass.end(); device.queue.submit([encoder.finish()]);
    return {texture, bindGroup: renderer.textureBindGroup(texture), width, height, bytes: width*height*4};
  } catch (error) {texture?.destroy(); throw error;}
  finally {
    // Submitted commands retain their resources until GPU execution completes.
    // No scratch allocation is kept in the editor or packet caches.
    msaa?.destroy(); uniform?.destroy(); shapes?.destroy(); transforms?.destroy();
  }
}
