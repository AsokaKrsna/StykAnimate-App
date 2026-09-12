/** PNG previews decode scanlines instead of allocating the entire source image.
 * Source dimensions remain separate from the disposable preview's pixel dimensions. */
export async function pngInfo(blob) {
  const header = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
  if (header.length < 33 || ![137,80,78,71,13,10,26,10].every((n, i) => header[i] === n)) return null;
  const view = new DataView(header.buffer);
  const width = view.getUint32(16), height = view.getUint32(20), depth = header[24], color = header[25];
  return {width, height, depth, color, interlace: header[28]};
}

export async function imageBlob(url, baseURL, token = '', signal) {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(','), header = url.slice(5, comma), content = url.slice(comma + 1);
    if (comma < 0) throw new Error('Invalid embedded image.');
    const bytes = /;base64/i.test(header) ? atob(content) : decodeURIComponent(content);
    const parts = [];
    for (let i = 0; i < bytes.length; i += 32768) parts.push(Uint8Array.from(bytes.slice(i, i + 32768), char => char.charCodeAt(0)));
    return new Blob(parts, {type: header.split(';')[0] || 'image/png'});
  }
  const resolved = new URL(url, baseURL), headers = {};
  if (token && resolved.origin === new URL(baseURL).origin) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(resolved, {headers, signal});
  if (!response.ok) throw new Error(`Playback image could not load (${response.status}).`);
  return response.blob();
}

export function fitImage(width, height, maxPixels, maxDimension = 8192) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)), maxDimension / width, maxDimension / height);
  return {width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale))};
}

const paeth = (a, b, c) => {
  const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
};

/** Nearest-neighbour source sampling matches the editor's pixel-art image mode.
 * A crop at native size is also usable by export without a full decoded source. */
export async function samplePNG(blob, info, width, height, {check = () => {}, crop} = {}) {
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[info.color];
  if (info.interlace || !channels || ![1,2,4,8,16].includes(info.depth) ||
      (info.color !== 0 && info.color !== 3 && info.depth < 8)) return null;
  const parts = []; let palette, alpha;
  for (let offset = 8; offset + 12 <= blob.size;) {
    check();
    const chunk = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
    const length = new DataView(chunk.buffer).getUint32(0), type = String.fromCharCode(...chunk.subarray(4));
    if (offset + length + 12 > blob.size) throw new Error('Truncated PNG image.');
    if (type === 'IDAT') parts.push(blob.slice(offset + 8, offset + 8 + length));
    if (type === 'PLTE') palette = new Uint8Array(await blob.slice(offset + 8, offset + 8 + length).arrayBuffer());
    if (type === 'tRNS') alpha = new Uint8Array(await blob.slice(offset + 8, offset + 8 + length).arrayBuffer());
    // Preserve embedded colour profiles through the browser's colour-managed decoder.
    if (type === 'iCCP' || type === 'cHRM' || type === 'gAMA') return null;
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (!parts.length || (info.color === 3 && !palette)) throw new Error('PNG image has no pixel data.');
  const rowBytes = Math.ceil(info.width * channels * info.depth / 8), stride = Math.max(1, Math.ceil(channels * info.depth / 8));
  const reader = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let chunk = new Uint8Array(), offset = 0, prior = new Uint8Array(rowBytes), row = new Uint8Array(rowBytes);
  const readInto = async target => {
    let written = 0;
    while (written < target.length) {
      check();
      if (offset === chunk.length) {
        const next = await reader.read();
        if (next.done) throw new Error('Truncated PNG scanline.');
        chunk = next.value; offset = 0;
      }
      const count = Math.min(target.length - written, chunk.length - offset);
      target.set(chunk.subarray(offset, offset + count), written); offset += count; written += count;
    }
  };
  const output = new Uint8ClampedArray(width * height * 4), filter = new Uint8Array(1);
  const area = crop || {x: 0, y: 0, width: info.width, height: info.height};
  const sourceY = y => Math.min(info.height - 1, area.y + Math.floor((y + .5) * area.height / height));
  const sample = index => info.depth === 16 ? row[index * 2] * 256 + row[index * 2 + 1]
    : info.depth === 8 ? row[index] : (row[Math.floor(index * info.depth / 8)] >> (8 - info.depth - index * info.depth % 8)) & ((1 << info.depth) - 1);
  const byte = value => Math.round(value * 255 / (2 ** info.depth - 1));
  const transparent = alpha && new DataView(alpha.buffer, alpha.byteOffset, alpha.byteLength);
  let targetY = 0;
  try {
    for (let y = 0; y < info.height && targetY < height; y++) {
      await readInto(filter); await readInto(row);
      if (filter[0] > 4) throw new Error('Invalid PNG scanline filter.');
      for (let i = 0; i < row.length; i++) {
        const a = i >= stride ? row[i - stride] : 0, b = prior[i], c = i >= stride ? prior[i - stride] : 0;
        row[i] += filter[0] === 1 ? a : filter[0] === 2 ? b : filter[0] === 3 ? Math.floor((a + b) / 2) : filter[0] === 4 ? paeth(a,b,c) : 0;
      }
      while (targetY < height && sourceY(targetY) === y) {
        for (let x = 0; x < width; x++) {
          const sx = Math.min(info.width - 1, area.x + Math.floor((x + .5) * area.width / width)), index = sx * channels, out = (targetY * width + x) * 4;
          const r = sample(index), g = channels >= 3 ? sample(index + 1) : r, b = channels >= 3 ? sample(index + 2) : r;
          if (info.color === 3) {
            output[out] = palette[r * 3]; output[out + 1] = palette[r * 3 + 1]; output[out + 2] = palette[r * 3 + 2]; output[out + 3] = alpha?.[r] ?? 255;
          } else {
            output[out] = byte(r); output[out + 1] = byte(g); output[out + 2] = byte(b);
            output[out + 3] = info.color === 4 || info.color === 6 ? byte(sample(index + channels - 1))
              : transparent && ((info.color === 0 && transparent.byteLength >= 2 && r === transparent.getUint16(0)) ||
                (info.color === 2 && transparent.byteLength >= 6 && r === transparent.getUint16(0) && g === transparent.getUint16(2) && b === transparent.getUint16(4))) ? 0 : 255;
          }
        }
        targetY++;
      }
      [prior, row] = [row, prior];
      if (y % 128 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(); }
    }
    // Finish the compressed stream to validate its end/checksum, without retaining
    // the remaining scanlines when only a crop was requested.
    while (!(await reader.read()).done) check();
    return output;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function decodePreview(blob, {width, height, maxPixels, maxDimension = 8192, crop, check = () => {}}) {
  check();
  const info = await pngInfo(blob);
  width = info?.width || width; height = info?.height || height;
  let originalWidth = width, originalHeight = height;
  // A crop requests only the source rectangle that can be sampled; decoded
  // bitmaps report it through srcX/srcY/srcW/srcH in source pixels.
  let area = null;
  if (crop && width > 0 && height > 0) {
    const x = Math.max(0, Math.min(width - 1, Math.floor(crop.x))), y = Math.max(0, Math.min(height - 1, Math.floor(crop.y)));
    area = {x, y, width: Math.max(1, Math.min(width, Math.ceil(crop.x + crop.width)) - x),
      height: Math.max(1, Math.min(height, Math.ceil(crop.y + crop.height)) - y)};
  }
  const sourceWidth = area?.width ?? width, sourceHeight = area?.height ?? height;
  let target = sourceWidth > 0 && sourceHeight > 0 ? fitImage(sourceWidth, sourceHeight, maxPixels, maxDimension) : null, bitmap;
  const cropped = area && (area.x > 0 || area.y > 0 || area.width < width || area.height < height);
  if (info && target && typeof DecompressionStream !== 'undefined' &&
      (cropped || info.width * info.height > maxPixels)) {
    const pixels = await samplePNG(blob, info, target.width, target.height, {check, crop: area});
    if (pixels) bitmap = await createImageBitmap(new ImageData(pixels, target.width, target.height));
  }
  if (!bitmap) {
    bitmap = area
      ? await createImageBitmap(blob, area.x, area.y, area.width, area.height,
          target ? {resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'pixelated'} : {})
      : await createImageBitmap(blob, target ? {resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'pixelated'} : {});
    // Unknown source dimensions are learned once; subsequent copies are bounded.
    originalWidth ||= bitmap.width; originalHeight ||= bitmap.height;
    const bounded = fitImage(bitmap.width, bitmap.height, maxPixels, maxDimension);
    if (bounded.width !== bitmap.width || bounded.height !== bitmap.height) {
      const source = bitmap;
      try { bitmap = await createImageBitmap(source, {resizeWidth: bounded.width, resizeHeight: bounded.height, resizeQuality: 'pixelated'}); }
      finally { source.close(); }
    }
  }
  try { check(); } catch (error) { bitmap.close(); throw error; }
  bitmap.complete = true; bitmap.naturalWidth = originalWidth; bitmap.naturalHeight = originalHeight;
  if (area) { bitmap.srcX = area.x; bitmap.srcY = area.y; bitmap.srcW = area.width; bitmap.srcH = area.height; }
  return bitmap;
}
