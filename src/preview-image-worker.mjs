import {ImageResources} from './image-resources.mjs';

const moduleReadyMs = performance.now();
let resources;
self.onmessage = async ({data}) => {
  const images = []; let sent = false;
  const started = performance.now();
  try {
    resources ||= new ImageResources({baseURL: data.baseURL, maxBytes: data.maxBytes, preview: true});
    await resources.preload(data.items, data.options);
    const preloaded = performance.now();
    for (const url of new Set(data.items.map(item => resources.url(item.asset)).filter(Boolean))) {
      const source = resources.images.get(url);
      if (!source) continue;
      const bitmap = await createImageBitmap(source);
      // Clones drop expandos; the crop rectangle travels in the message instead.
      images.push({url, bitmap, width: source.naturalWidth, height: source.naturalHeight,
        ...(source.srcW !== undefined ? {srcX: source.srcX, srcY: source.srcY, srcW: source.srcW, srcH: source.srcH} : {})});
    }
    const timings = {moduleReadyMs, preloadMs: preloaded - started, bitmapCopyMs: performance.now() - preloaded,
      images: images.length, decodedBytes: resources.bytes};
    self.postMessage({id: data.id, images, reduced: resources.pressureReduced, timings}, images.map(image => image.bitmap));
    sent = true;
  } catch (error) { self.postMessage({id: data.id, error: error.message}); }
  finally {if (!sent) for (const image of images) image.bitmap.close();}
};
