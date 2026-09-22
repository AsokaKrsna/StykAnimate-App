import {encodePNGPortable} from './sticknodes/decoder/png-browser.mjs';
import {inflateZlib} from './drawing-inflate.mjs';
import {DRAWING_MAX_PIXELS} from './drawing-model.mjs';
import {crc32} from './sticknodes/decoder/archive.mjs';
import {base64ToBytes,bytesToBase64} from './base64.mjs';
export function drawingPNGBytes(url){
  if(typeof url!=='string'||!url.startsWith('data:image/png;base64,'))throw new Error('Drawing pixels need an embedded PNG.');
  return base64ToBytes(url.slice(22));
}
export function drawingPNGDataURL(bytes){return 'data:image/png;base64,'+bytesToBase64(bytes);}
export async function encodeDrawingPNG(pixels,width,height){return drawingPNGDataURL(await encodePNGPortable({width,height,channels:4},pixels));}
export function decodeDrawingPNG(url){return decodeDrawingPNGBytes(drawingPNGBytes(url));}
/** Decode our portable PNG without premultiplication, including filter modes
 * emitted by other conforming RGBA/RGB encoders. All allocations are bounded. */
const SYNC_INFLATE_BYTES=1024*1024;
const concatBytes=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;};
export async function decodeDrawingPNGBytes(bytes,{width:expectedWidth,height:expectedHeight}={}){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),signature=[137,80,78,71,13,10,26,10];if(!signature.every((n,i)=>bytes[i]===n))throw new Error('Invalid drawing PNG signature.');
  let width,height,channels;const parts=[];
  for(let pos=8;pos+12<=bytes.length;){const length=view.getUint32(pos),end=pos+12+length;if(end>bytes.length)throw new Error('Truncated drawing PNG.');const type=String.fromCharCode(...bytes.subarray(pos+4,pos+8)),data=bytes.subarray(pos+8,pos+8+length);
    if(crc32(bytes.subarray(pos+4,pos+8+length))!==view.getUint32(pos+8+length))throw new Error('Drawing PNG checksum mismatch.');
    if(type==='IHDR'){width=view.getUint32(pos+8);height=view.getUint32(pos+12);channels=data[9]===6?4:data[9]===2?3:0;if(!width||!height||width>8192||height>8192||width*height>DRAWING_MAX_PIXELS||data[8]!==8||!channels||data[12]!==0)throw new Error('Drawings require a bounded, non-interlaced 8-bit RGB/RGBA PNG.');if((expectedWidth!==undefined&&width!==expectedWidth)||(expectedHeight!==undefined&&height!==expectedHeight))throw new Error('Drawing PNG dimensions do not match its tile or clipboard.');}
    if(type==='IDAT')parts.push(data);if(type==='IEND')break;pos=end;
  }
  if(!channels||!parts.length)throw new Error('Drawing PNG is missing pixel data.');
  const stride=width*channels,expected=(stride+1)*height;let scan,offset=0;
  if(expected<=SYNC_INFLATE_BYTES){
    // Small images such as 64×64 tiles inflate in place: stream setup and
    // task hops would otherwise cost more than the decompression itself.
    const data=parts.length===1?parts[0]:concatBytes(parts);
    try{scan=inflateZlib(data,{maxOutput:expected});}catch(error){if(error.code==='INFLATE_BOUND')throw new Error('Drawing PNG expands beyond its declared dimensions.');throw error;}
    offset=scan.length;
  }else{
  scan=new Uint8Array(expected);const stream=new DecompressionStream('deflate'),reader=stream.readable.getReader(),writer=stream.writable.getWriter();let writeError;
  // IDAT already owns byte views. Feeding them directly avoids a Blob and its
  // asynchronous read pipeline per tile. Await backpressure and settle the
  // producer on every exit, including expansion-limit and corrupt-stream errors.
  const written=(async()=>{try{for(const part of parts)await writer.write(part);await writer.close();}catch(error){writeError=error;await writer.abort(error).catch(()=>{});}finally{writer.releaseLock();}})();
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(offset+value.length>expected)throw new Error('Drawing PNG expands beyond its declared dimensions.');scan.set(value,offset);offset+=value.length;}await written;if(writeError)throw writeError;}
  finally{await reader.cancel().catch(()=>{});await written;reader.releaseLock();}
  }
  if(offset!==expected)throw new Error('Drawing PNG has incomplete pixel data.');
  const output=new Uint8ClampedArray(width*height*4);
  const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
  for(let y=0;y<height;y++){
    const start=y*(stride+1)+1,filter=scan[start-1];if(filter>4)throw new Error('Invalid drawing PNG filter.');
    // Reconstruct filtered rows in the bounded scan buffer. Portable drawing
    // PNGs use filter zero: those RGBA rows need only a native byte copy.
    if(filter)for(let x=0;x<stride;x++){
      const left=x>=channels?scan[start+x-channels]:0,up=y?scan[start+x-stride-1]:0,corner=y&&x>=channels?scan[start+x-stride-1-channels]:0;
      scan[start+x]=(scan[start+x]+(filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner)))&255;
    }
    if(channels===4)output.set(scan.subarray(start,start+stride),y*stride);
    else for(let x=0;x<width;x++){const a=start+x*3,b=(y*width+x)*4;output[b]=scan[a];output[b+1]=scan[a+1];output[b+2]=scan[a+2];output[b+3]=255;}
  }
  return {width,height,pixels:output};
}
