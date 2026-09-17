import {writeTile,floodPixels,pixelChanges} from './drawing-pixels.mjs';
import {DRAWING_MAX_PIXELS} from './drawing-model.mjs';
import {encodeDrawingPNG,decodeDrawingPNG} from './drawing-png.mjs';

self.onmessage=async({data})=>{
  const {id,kind,width,height}=data;
  try {
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||width*height>DRAWING_MAX_PIXELS)throw new Error('Drawing surface exceeds the pixel limit.');
    if(kind==='expand'){
      const old=data.source;
      if(!old||![old.width,old.height].every(n=>Number.isInteger(n)&&n>0&&n<=8192)||old.width*old.height>DRAWING_MAX_PIXELS||![data.offsetX,data.offsetY].every(Number.isSafeInteger))throw new Error('Invalid drawing expansion source.');
      const pixels=new Uint8ClampedArray(old.width*old.height*4),base=await decodeDrawingPNG(old.base);
      if(base.width===old.width&&base.height===old.height)pixels.set(base.pixels);
      else if(base.width!==1||base.height!==1||base.pixels.some(Boolean))throw new Error('Drawing source dimensions changed.');
      for(const tile of old.tiles??[])writeTile(pixels,old.width,tile,new Uint8ClampedArray(tile.pixels));
      const output=new Uint8ClampedArray(width*height*4);
      for(let y=0;y<old.height;y++){const dy=y+data.offsetY;if(dy<0||dy>=height)continue;const x=Math.max(0,-data.offsetX),end=Math.min(old.width,width-data.offsetX);if(end>x)output.set(pixels.subarray((y*old.width+x)*4,(y*old.width+end)*4),(dy*width+x+data.offsetX)*4);}
      const dataUrl=await encodeDrawingPNG(output,width,height);self.postMessage({id,dataUrl,pixels:output.buffer},[output.buffer]);return;
    }
    if(kind==='fill'){
      const before=data.tileHistory?new Uint8ClampedArray(data.pixels).slice():null,pixels=floodPixels(new Uint8ClampedArray(data.pixels),width,height,{...data.options,source:data.source?new Uint8ClampedArray(data.source):undefined});
      if(data.tileHistory){const tiles=pixelChanges(before,pixels,width,height,data.maxBytes);self.postMessage({id,tiles},tiles.flatMap(t=>[t.before.buffer,t.after.buffer]));}else self.postMessage({id,pixels:pixels.buffer},[pixels.buffer]);return;
    }
    if(kind==='resample'){
      const base=await decodeDrawingPNG(data.base),source=new OffscreenCanvas(base.width,base.height);source.getContext('2d').putImageData(new ImageData(base.pixels,base.width,base.height),0,0);
      const output=new OffscreenCanvas(width,height),ctx=output.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,width,height);
      const dataUrl=await encodeDrawingPNG(ctx.getImageData(0,0,width,height).data,width,height);self.postMessage({id,dataUrl});return;
    }
    const pixels=new Uint8ClampedArray(width*height*4);
    if(data.base){const base=await decodeDrawingPNG(data.base);if(base.width!==width||base.height!==height){if(base.width!==1||base.height!==1||base.pixels.some(Boolean))throw new Error('Drawing PNG dimensions changed unexpectedly.');}else pixels.set(base.pixels);}
    for(const tile of data.tiles??[])writeTile(pixels,width,tile,new Uint8ClampedArray(tile.pixels));
    if(kind==='paste'){
      const source=await decodeDrawingPNG(data.clip.base),before=pixels.slice(),{x,y,ratio}=data;
      if(source.width!==data.clip.width||source.height!==data.clip.height||![x,y,ratio].every(Number.isFinite)||ratio<=0)throw new Error('Invalid drawing paste.');
      let after=pixels;
      if(ratio===1&&Number.isInteger(x)&&Number.isInteger(y)){
        for(let sy=0;sy<source.height;sy++){const dy=sy+y;if(dy<0||dy>=height)continue;
          for(let sx=Math.max(0,-x);sx<Math.min(source.width,width-x);sx++){
            const i=(sy*source.width+sx)*4,j=(dy*width+sx+x)*4,alpha=source.pixels[i+3]/255;
            if(!pixels[j+3]||alpha===1){for(let c=0;c<4;c++)pixels[j+c]=source.pixels[i+c];continue;}if(!alpha)continue;
            const base=pixels[j+3]/255,out=alpha+base*(1-alpha);
            for(let c=0;c<3;c++)pixels[j+c]=Math.round((source.pixels[i+c]*alpha+pixels[j+c]*base*(1-alpha))/out);
            pixels[j+3]=Math.round(out*255);
          }
        }
      }else{
        const input=new OffscreenCanvas(source.width,source.height),output=new OffscreenCanvas(width,height),ctx=output.getContext('2d');
        input.getContext('2d').putImageData(new ImageData(source.pixels,source.width,source.height),0,0);ctx.putImageData(new ImageData(pixels,width,height),0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(input,x,y,source.width*ratio,source.height*ratio);after=ctx.getImageData(0,0,width,height).data;
      }
      const tiles=pixelChanges(before,after,width,height,data.maxBytes);self.postMessage({id,tiles},tiles.flatMap(t=>[t.before.buffer,t.after.buffer]));return;
    }
    if(kind==='thumbnail'){const source=new OffscreenCanvas(width,height);source.getContext('2d').putImageData(new ImageData(pixels,width,height),0,0);const ratio=Math.min(64/width,32/height),w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio)),out=new OffscreenCanvas(w,h),ctx=out.getContext('2d');ctx.drawImage(source,0,0,w,h);const rgba=ctx.getImageData(0,0,w,h).data;self.postMessage({id,width:w,height:h,pixels:rgba.buffer},[rgba.buffer]);return;}
    if(kind==='decode'){
      self.postMessage({id,pixels:pixels.buffer},[pixels.buffer]);return;
    }
    if(kind!=='encode')throw new Error('Unknown drawing worker operation.');
    const dataUrl=await encodeDrawingPNG(pixels,width,height);
    self.postMessage({id,dataUrl});
  } catch(error){self.postMessage({id,error:error.message});}
};
