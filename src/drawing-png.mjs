import {encodePNGPortable} from './sticknodes/decoder/png-browser.mjs';
import {DRAWING_MAX_PIXELS} from './drawing-model.mjs';
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(let i=0;i<bytes.length;i++)c=CRC_TABLE[(c^bytes[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;};
import {deflateZlib,inflateZlib} from './zlib-sync.mjs';
// Small images (every 64×64 tile) inflate/deflate synchronously: stream setup
// costs more than the work. Larger ones keep the native streams off-thread.
const SYNC_BYTES=1024*1024;
const chunk=(type,data)=>{const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);for(let i=0;i<4;i++)out[4+i]=type.charCodeAt(i);out.set(data,8);view.setUint32(out.length-4,crc32(out.subarray(4,-4)));return out;};
/** Filtered PNG scanlines: mode 0 keeps rows unfiltered; 'adaptive' picks
 * None, Sub or Up per row by the smallest absolute residual. */
function scanlines(pixels,width,height,mode){
  const stride=width*4,scan=new Uint8Array((stride+1)*height);
  for(let y=0;y<height;y++){
    const row=y*stride,o=y*(stride+1);let filter=0;
    if(mode==='adaptive'){let none=0,sub=0,up=0;for(let x=0;x<stride;x++){const v=pixels[row+x],a=x>=4?pixels[row+x-4]:0,b=y?pixels[row+x-stride]:0;none+=v<128?v:256-v;const s=(v-a)&255;sub+=s<128?s:256-s;const u=(v-b)&255;up+=u<128?u:256-u;}filter=sub<none&&sub<=up?1:up<none?2:0;}
    scan[o]=filter;
    if(!filter)scan.set(pixels.subarray(row,row+stride),o+1);
    else for(let x=0;x<stride;x++){const v=pixels[row+x];scan[o+1+x]=filter===1?(v-(x>=4?pixels[row+x-4]:0))&255:(v-(y?pixels[row+x-stride]:0))&255;}
  }
  return scan;
}
/** Bytes that differ from the byte one pixel earlier: positions LZ77 cannot
 * reuse, a cheap predictor of compressed size. */
const breaks=scan=>{let n=0;for(let i=4;i<scan.length;i++)if(scan[i]!==scan[i-4])n++;return n;};
/** Synchronous lossless RGBA PNG for small images. Line art compresses best
 * unfiltered and soft gradients with row filters; the scan LZ77 can reuse
 * more of is deflated (within a few percent of trying both). */
export function encodeRGBAPNG(pixels,width,height){
  const plain=scanlines(pixels,width,height,0),adaptive=scanlines(pixels,width,height,'adaptive'),data=deflateZlib(breaks(adaptive)<breaks(plain)?adaptive:plain);
  const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,width);view.setUint32(4,height);header[8]=8;header[9]=6;
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',data),chunk('IEND',new Uint8Array())];
  const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;
}
export function drawingPNGBytes(url){if(typeof url!=='string'||!url.startsWith('data:image/png;base64,'))throw new Error('Drawing pixels need an embedded PNG.');return Uint8Array.from(atob(url.slice(22)),c=>c.charCodeAt(0));}
export async function encodeDrawingPNG(pixels,width,height){const bytes=await encodePNGPortable({width,height,channels:4},pixels);let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return 'data:image/png;base64,'+btoa(text);}
export function decodeDrawingPNG(url){return decodeDrawingPNGBytes(drawingPNGBytes(url));}
/** Decode our portable PNG without premultiplication, including filter modes
 * emitted by other conforming RGBA/RGB encoders. All allocations are bounded. */
export async function decodeDrawingPNGBytes(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),signature=[137,80,78,71,13,10,26,10];if(!signature.every((n,i)=>bytes[i]===n))throw new Error('Invalid drawing PNG signature.');
  let width,height,channels;const parts=[];
  for(let pos=8;pos+12<=bytes.length;){const length=view.getUint32(pos),end=pos+12+length;if(end>bytes.length)throw new Error('Truncated drawing PNG.');const type=String.fromCharCode(...bytes.subarray(pos+4,pos+8)),data=bytes.subarray(pos+8,pos+8+length);
    if(crc32(bytes.subarray(pos+4,pos+8+length))!==view.getUint32(pos+8+length))throw new Error('Drawing PNG checksum mismatch.');
    if(type==='IHDR'){width=view.getUint32(pos+8);height=view.getUint32(pos+12);channels=data[9]===6?4:data[9]===2?3:0;if(!width||!height||width>8192||height>8192||width*height>DRAWING_MAX_PIXELS||data[8]!==8||!channels||data[12]!==0)throw new Error('Drawings require a bounded, non-interlaced 8-bit RGB/RGBA PNG.');}
    if(type==='IDAT')parts.push(data);if(type==='IEND')break;pos=end;
  }
  if(!channels||!parts.length)throw new Error('Drawing PNG is missing pixel data.');
  const stride=width*channels,expected=(stride+1)*height;let scan;
  if(expected<=SYNC_BYTES){
    const joined=parts.length===1?parts[0]:new Uint8Array(parts.reduce((n,p)=>n+p.length,0));if(parts.length>1){let o=0;for(const p of parts){joined.set(p,o);o+=p.length;}}
    try{scan=inflateZlib(joined,{expected});}catch(error){throw new Error(/expands/.test(error.message)?'Drawing PNG expands beyond its declared dimensions.':/size mismatch|Truncated/.test(error.message)?'Drawing PNG has incomplete pixel data.':'Drawing PNG pixel data is corrupt.');}
  }else{
    scan=new Uint8Array(expected);const reader=new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();let offset=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;if(offset+value.length>expected)throw new Error('Drawing PNG expands beyond its declared dimensions.');scan.set(value,offset);offset+=value.length;}}finally{await reader.cancel();}
    if(offset!==expected)throw new Error('Drawing PNG has incomplete pixel data.');
  }
  const output=new Uint8ClampedArray(width*height*4),row=new Uint8Array(stride),previous=new Uint8Array(stride);
  const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
  for(let y=0;y<height;y++){const filter=scan[y*(stride+1)],o=y*(stride+1)+1,c=channels;if(filter>4)throw new Error('Invalid drawing PNG filter.');
    // One tight loop per filter type.
    if(filter===0)row.set(scan.subarray(o,o+stride));
    else if(filter===1){for(let x=0;x<stride;x++)row[x]=(scan[o+x]+(x>=c?row[x-c]:0))&255;}
    else if(filter===2){for(let x=0;x<stride;x++)row[x]=(scan[o+x]+previous[x])&255;}
    else if(filter===3){for(let x=0;x<stride;x++)row[x]=(scan[o+x]+(((x>=c?row[x-c]:0)+previous[x])>>1))&255;}
    else for(let x=0;x<stride;x++){const left=x>=c?row[x-c]:0,up=previous[x],corner=x>=c?previous[x-c]:0;row[x]=(scan[o+x]+paeth(left,up,corner))&255;}if(channels===4)output.set(row,y*width*4);else for(let x=0;x<width;x++){const a=x*3,b=(y*width+x)*4;output[b]=row[a];output[b+1]=row[a+1];output[b+2]=row[a+2];output[b+3]=255;}previous.set(row);}
  return {width,height,pixels:output};
}
