import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {inflateZlib} from '../src/drawing-inflate.mjs';

let seed=11;const random=()=>((seed=Math.imul(seed^seed>>>15,2246822519)+0x6D2B79F5>>>0)/4294967296);
const samples=()=>{
  const tile=Buffer.alloc(64*257);for(let y=0;y<64;y++)for(let x=0;x<256;x++)tile[y*257+1+x]=(x>>3)*(y>>4)&255;
  const noise=Buffer.from(Array.from({length:20000},()=>random()*256|0));
  const sparse=Buffer.alloc(16448);for(let i=0;i<60;i++)sparse[random()*16448|0]=random()*256|0;
  const text=Buffer.from('drawing tiles '.repeat(900)+'a'.repeat(70000));
  return {empty:Buffer.alloc(0),one:Buffer.from([7]),tile,noise,sparse,text,literals:Buffer.from(Array.from({length:300},(_,i)=>i*7&255))};
};
const variants=[
  ...Array.from({length:10},(_,level)=>({level})),
  {level:9,strategy:zlib.constants.Z_FIXED},{level:6,strategy:zlib.constants.Z_RLE},
  {level:6,strategy:zlib.constants.Z_HUFFMAN_ONLY},{level:6,strategy:zlib.constants.Z_FILTERED},
  {level:9,memLevel:1,windowBits:9},
];

test('inflate matches zlib for every level, strategy and block type',()=>{
  for(const [name,data] of Object.entries(samples()))for(const options of variants){
    const compressed=zlib.deflateSync(data,options);
    const inflated=inflateZlib(new Uint8Array(compressed),{maxOutput:data.length});
    assert.deepEqual(Buffer.from(inflated),data,`${name} ${JSON.stringify(options)}`);
  }
});

test('inflate accepts streams flushed into several blocks',()=>{
  const data=samples().tile,deflate=zlib.createDeflate({level:6}),parts=[];
  deflate.on('data',part=>parts.push(part));
  deflate.write(data.subarray(0,5000));deflate.flush(zlib.constants.Z_FULL_FLUSH);
  deflate.write(data.subarray(5000));deflate.end();
  return new Promise(resolve=>deflate.on('end',()=>{
    assert.deepEqual(Buffer.from(inflateZlib(new Uint8Array(Buffer.concat(parts)),{maxOutput:data.length})),data);resolve();
  }));
});

/** Hand-assemble a final fixed-Huffman block: [0,literal] or [1,257,length,distance]. */
function fixedBlock(tokens){
  const bits=[];const put=(value,n)=>{for(let i=0;i<n;i++)bits.push(value>>i&1);};const code=(value,n)=>{for(let i=n-1;i>=0;i--)bits.push(value>>i&1);};
  put(1,1);put(1,2);
  for(const token of tokens){
    if(token[0]===0){const v=token[1];if(v<144)code(0x30+v,8);else code(0x190+v-144,9);continue;}
    code(token[1]-256,7);code(token[3]-1,5);
  }
  code(0,7);
  const bytes=[0x78,0x01];for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8&&i+j<bits.length;j++)b|=bits[i+j]<<j;bytes.push(b);}
  bytes.push(0,0,0,1);return new Uint8Array(bytes);
}

test('inflate rejects malformed, truncated, oversized and mismatched input',()=>{
  const data=samples().tile,good=new Uint8Array(zlib.deflateSync(data,{level:9}));
  const mutate=fn=>{const copy=good.slice();fn(copy);return copy;};
  assert.throws(()=>inflateZlib(good,{maxOutput:data.length-1}),error=>error.code==='INFLATE_BOUND');
  assert.throws(()=>inflateZlib(good.subarray(0,good.length-1),{maxOutput:data.length}),/checksum/);
  assert.throws(()=>inflateZlib(good.subarray(0,20),{maxOutput:data.length}),/truncated|invalid|distance/);
  assert.throws(()=>inflateZlib(new Uint8Array([...good,0]),{maxOutput:data.length}),/trailing/);
  assert.throws(()=>inflateZlib(mutate(c=>{c[c.length-1]^=1;}),{maxOutput:data.length}),/checksum/);
  assert.throws(()=>inflateZlib(mutate(c=>{c[0]=0x79;}),{maxOutput:data.length}),/header/);
  assert.throws(()=>inflateZlib(mutate(c=>{c[1]|=32;c[1]-=((c[0]<<8|c[1])%31);}),{maxOutput:data.length}),/header/);
  // Block type 3 is reserved.
  assert.throws(()=>inflateZlib(new Uint8Array([0x78,0x9c,0x07,0,0,0,0,0]),{maxOutput:10}),/block type/);
  // A stored block whose length complement does not match.
  assert.throws(()=>inflateZlib(new Uint8Array([0x78,0x01,0x01,0x05,0x00,0x00,0x00,1,2,3,4,5,0,0,0,0]),{maxOutput:10}),/stored/);
  // A stored block larger than the output bound.
  assert.throws(()=>inflateZlib(new Uint8Array(zlib.deflateSync(Buffer.from([1]),{level:0})),{maxOutput:0}),error=>error.code==='INFLATE_BOUND');
  // A fixed block copying from before the start: literal 'a', then length 3 at distance 2.
  assert.throws(()=>inflateZlib(fixedBlock([[0,0x61],[1,257,3,2]]),{maxOutput:10}),/distance before the start/);
  let rejected=0,accepted=0;
  for(let i=0;i<400;i++){
    const copy=good.slice(),at=2+(random()*(copy.length-6)|0);copy[at]^=1<<(random()*8|0);
    try{const out=inflateZlib(copy,{maxOutput:data.length});accepted++;assert.deepEqual(Buffer.from(out),data,'a mutation that passes the checksum must decode to the original');}
    catch(error){assert.match(error.message,/compressed drawing data/i);rejected++;}
  }
  assert.ok(rejected>350,`random corruptions are rejected (${rejected} of 400)`);
  void accepted;
});
