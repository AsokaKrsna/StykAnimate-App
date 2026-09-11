import {PlaybackResources} from './playback-resources.mjs';

let resources;
self.onmessage = async ({data}) => {
  const images = []; let sent = false;
  try {
    resources ||= new PlaybackResources({baseURL: data.baseURL, maxBytes: data.maxBytes, preview: true});
    await resources.preload(data.items, data.options);
    for (const url of new Set(data.items.map(item => resources.url(item.asset)).filter(Boolean))) {
      const source = resources.images.get(url);
      const bitmap = await createImageBitmap(source);
      images.push({url, bitmap, width: source.naturalWidth, height: source.naturalHeight});
    }
    self.postMessage({id: data.id, images, reduced: resources.pressureReduced}, images.map(image => image.bitmap));
    sent = true;
  } catch (error) { self.postMessage({id: data.id, error: error.message}); }
  finally {if (!sent) for (const image of images) image.bitmap.close();}
};
