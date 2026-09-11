/** Pivot's three pixel-export sampling choices. */
export const EXPORT_SMOOTHING = Object.freeze([
  Object.freeze({
    value: "edges",
    label: "Smooth edges",
    description:
      "Smooth figure edges while keeping sharp sprite pixels.",
  }),
  Object.freeze({
    value: "none",
    label: "No smoothing",
    description: "Aliased figure edges and unfiltered sprite pixels.",
  }),
  Object.freeze({
    value: "sprites",
    label: "Smooth sprites",
    description:
      "Render at twice the size, then downsample for smoother sprites.",
  }),
]);
export function normalizeExportSmoothing(value = "edges") {
  if (!EXPORT_SMOOTHING.some((option) => option.value === value))
    throw new Error("Choose Smooth edges, No smoothing, or Smooth sprites.");
  return value;
}
export function exportSamplingSize(width, height, smoothing = "edges") {
  smoothing = normalizeExportSmoothing(smoothing);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 16777216
  )
    throw new Error(
      "Export dimensions must be whole pixels, up to 16,384 per side and 16 million pixels per frame.",
    );
  const factor = smoothing === "sprites" ? 2 : 1;
  if (width * factor > 16384 || height * factor > 16384)
    throw new Error(
      "Smooth sprites supports output dimensions up to 8,192 pixels per side.",
    );
  return {
    width,
    height,
    smoothing,
    factor,
    renderWidth: width * factor,
    renderHeight: height * factor,
  };
}

/** Exact 2× box filter, averaging premultiplied colors to preserve transparent edges. */
export function downsampleExportPixels(source, width, height) {
  if (source.length !== width * height * 16) throw new Error('Invalid supersampled export tile.');
  const output = new Uint8ClampedArray(width * height * 4), stride = width * 8;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = y * stride * 2 + x * 8, b = a + 4, c = a + stride, d = c + 4;
    const alpha = source[a+3] + source[b+3] + source[c+3] + source[d+3], at = (y * width + x) * 4;
    output[at+3] = Math.round(alpha / 4);
    if (alpha) for (let channel = 0; channel < 3; channel++)
      output[at+channel] = Math.round((source[a+channel]*source[a+3] + source[b+channel]*source[b+3] +
        source[c+channel]*source[c+3] + source[d+channel]*source[d+3]) / alpha);
  }
  return output;
}

