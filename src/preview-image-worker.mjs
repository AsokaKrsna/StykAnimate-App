import {PlaybackResources} from './playback-resources.mjs';

let resources;
self.onmessage = async ({data}) => {
  const images = []; let sent = false;
  try {
    resources ||= new PlaybackResources({baseURL: data.baseURL, maxBytes: data.maxBytes, preview: true});
    await resources.preload(data.items, data.options);
    for (const url of new Set(data.items.map(item => resources.url(item.asset)).filter(Boolean))) {
      const source = resources.images.get(url);
      if (!source) continue;
      const bitmap = await createImageBitmap(source);
      // Clones drop expandos; the crop rectangle travels in the message instead.
      images.push({url, bitmap, width: source.naturalWidth, height: source.naturalHeight,
        ...(source.srcW !== undefined ? {srcX: source.srcX, srcY: source.srcY, srcW: source.srcW, srcH: source.srcH} : {})});
    }
    self.postMessage({id: data.id, images, reduced: resources.pressureReduced}, images.map(image => image.bitmap));
    sent = true;
  } catch (error) { self.postMessage({id: data.id, error: error.message}); }
  finally {if (!sent) for (const image of images) image.bitmap.close();}
};
