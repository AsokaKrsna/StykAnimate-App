import {encodePNGPortable} from './sticknodes/decoder/png-browser.mjs';
import {DRAWING_MAX_PIXELS} from './drawing-model.mjs';
import {crc32} from './sticknodes/decoder/archive.mjs';
export function drawingPNGBytes(url){if(typeof url!=='string'||!url.startsWith('data:image/png;base64,'))throw new Error('Drawing pixels need an embedded PNG.');return Uint8Array.from(atob(url.slice(22)),c=>c.charCodeAt(0));}
export function drawingPNGDataURL(bytes){let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return 'data:image/png;base64,'+btoa(text);}
export async function encodeDrawingPNG(pixels,width,height){return drawingPNGDataURL(await encodePNGPortable({width,height,channels:4},pixels));}
export function decodeDrawingPNG(url){return decodeDrawingPNGBytes(drawingPNGBytes(url));}
/** Decode our portable PNG without premultiplication, including filter modes
 * emitted by other conforming RGBA/RGB encoders. All allocations are bounded. */
export async function decodeDrawingPNGBytes(bytes,{width:expectedWidth,height:expectedHeight}={}){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),signature=[137,80,78,71,13,10,26,10];if(!signature.every((n,i)=>bytes[i]===n))throw new Error('Invalid drawing PNG signature.');
  let width,height,channels;const parts=[];
  for(let pos=8;pos+12<=bytes.length;){const length=view.getUint32(pos),end=pos+12+length;if(end>bytes.length)throw new Error('Truncated drawing PNG.');const type=String.fromCharCode(...bytes.subarray(pos+4,pos+8)),data=bytes.subarray(pos+8,pos+8+length);
    if(crc32(bytes.subarray(pos+4,pos+8+length))!==view.getUint32(pos+8+length))throw new Error('Drawing PNG checksum mismatch.');
    if(type==='IHDR'){width=view.getUint32(pos+8);height=view.getUint32(pos+12);channels=data[9]===6?4:data[9]===2?3:0;if(!width||!height||width>8192||height>8192||width*height>DRAWING_MAX_PIXELS||data[8]!==8||!channels||data[12]!==0)throw new Error('Drawings require a bounded, non-interlaced 8-bit RGB/RGBA PNG.');if((expectedWidth!==undefined&&width!==expectedWidth)||(expectedHeight!==undefined&&height!==expectedHeight))throw new Error('Drawing PNG dimensions do not match its tile or clipboard.');}
    if(type==='IDAT')parts.push(data);if(type==='IEND')break;pos=end;
  }
  if(!channels||!parts.length)throw new Error('Drawing PNG is missing pixel data.');
  const stride=width*channels,expected=(stride+1)*height,scan=new Uint8Array(expected),reader=new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();let offset=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(offset+value.length>expected)throw new Error('Drawing PNG expands beyond its declared dimensions.');scan.set(value,offset);offset+=value.length;}}finally{await reader.cancel();}
  if(offset!==expected)throw new Error('Drawing PNG has incomplete pixel data.');
  const output=new Uint8ClampedArray(width*height*4),row=new Uint8Array(stride),previous=new Uint8Array(stride);
  const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
  for(let y=0;y<height;y++){const filter=scan[y*(stride+1)];if(filter>4)throw new Error('Invalid drawing PNG filter.');for(let x=0;x<stride;x++){const left=x>=channels?row[x-channels]:0,up=previous[x],corner=x>=channels?previous[x-channels]:0;row[x]=(scan[y*(stride+1)+1+x]+(filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner)))&255;}for(let x=0;x<width;x++){const a=x*channels,b=(y*width+x)*4;output[b]=row[a];output[b+1]=row[a+1];output[b+2]=row[a+2];output[b+3]=channels===4?row[a+3]:255;}previous.set(row);}
  return {width,height,pixels:output};
}
