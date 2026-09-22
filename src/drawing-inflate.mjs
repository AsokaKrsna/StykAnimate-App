/** Synchronous zlib (RFC 1950) / deflate (RFC 1951) decoding for small
 * streams such as 64×64 drawing tile PNGs. A tile's compressed data is a few
 * hundred bytes, so the per-stream setup and task hops of DecompressionStream
 * dominate its cost; decoding in place removes them. Every malformed input —
 * bad header, invalid or over-subscribed codes, distances before the start,
 * truncation, trailing bytes, output beyond `maxOutput` or a checksum
 * mismatch — throws. Structure follows zlib's reference decoder, puff.c. */
const LENGTH_BASE=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LENGTH_EXTRA=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DISTANCE_BASE=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DISTANCE_EXTRA=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const CODE_ORDER=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
const fail=message=>{throw new Error(`Invalid compressed drawing data: ${message}.`);};
/** Output beyond the caller's bound: `code` lets callers keep their own message. */
const overflow=()=>{throw Object.assign(new Error('Compressed drawing data expands beyond its bound.'),{code:'INFLATE_BOUND'});};

/** Canonical Huffman decoding table. `left` > 0 marks an incomplete code.
 * `lookup` maps the next FAST_BITS input bits (least significant first) to
 * symbol << 4 | length for every code no longer than FAST_BITS. */
const FAST_BITS=10,FAST_MASK=(1<<FAST_BITS)-1;
function huffman(lengths,lookup=new Int32Array(1<<FAST_BITS)){
  const count=new Uint16Array(16),symbol=new Uint16Array(lengths.length),offsets=new Uint16Array(16);
  for(let i=0;i<lengths.length;i++)count[lengths[i]]++;
  let left=1;
  for(let length=1;length<16;length++){left=left*2-count[length];if(left<0)fail('over-subscribed code');}
  for(let length=1;length<15;length++)offsets[length+1]=offsets[length]+count[length];
  for(let i=0;i<lengths.length;i++)if(lengths[i])symbol[offsets[lengths[i]]++]=i;
  lookup.fill(-1);
  for(let length=1,code=0,index=0;length<16;length++,code<<=1)for(let i=0;i<count[length];i++,code++,index++){
    if(length>FAST_BITS)continue;
    let reversed=0;for(let bit=0;bit<length;bit++)reversed|=(code>>bit&1)<<(length-1-bit);
    for(let fill=reversed;fill<=FAST_MASK;fill+=1<<length)lookup[fill]=symbol[index]<<4|length;
  }
  return {count,symbol,left,lookup};
}
// Dynamic blocks rebuild their lookups into these; decoding is synchronous.
const dynamicLookups=[new Int32Array(1<<FAST_BITS),new Int32Array(1<<FAST_BITS)];
let fixed=null;
function fixedTables(){
  if(!fixed){
    const lengths=new Uint8Array(288);lengths.fill(8,0,144);lengths.fill(9,144,256);lengths.fill(7,256,280);lengths.fill(8,280,288);
    fixed=[huffman(lengths),huffman(new Uint8Array(30).fill(5))];
  }
  return fixed;
}
function adler32(bytes,end){
  let a=1,b=0;
  for(let i=0;i<end;){const stop=Math.min(end,i+5552);for(;i<stop;i++){a+=bytes[i];b+=a;}a%=65521;b%=65521;}
  return (b<<16|a)>>>0;
}

/** Inflate a complete zlib stream into at most `maxOutput` bytes. */
export function inflateZlib(input,{maxOutput}){
  if(!(input instanceof Uint8Array)||!Number.isInteger(maxOutput)||maxOutput<0)throw new Error('Inflate needs bytes and an output bound.');
  if(input.length<6)fail('truncated stream');
  const method=input[0],flags=input[1];
  if((method&15)!==8||method>>4>7||((method<<8)|flags)%31||flags&32)fail('unsupported zlib header');
  const out=new Uint8Array(maxOutput);
  let pos=2,buffer=0,available=0,size=0;
  const bits=n=>{
    while(available<n){if(pos>=input.length)fail('truncated stream');buffer|=input[pos++]<<available;available+=8;}
    const value=buffer&((1<<n)-1);buffer>>>=n;available-=n;return value;
  };
  // Bytes prefetched for table lookups return to the input at byte alignment.
  const align=()=>{pos-=available>>3;buffer=0;available=0;};
  const decode=table=>{
    while(available<16&&pos<input.length){buffer|=input[pos++]<<available;available+=8;}
    const entry=table.lookup[buffer&FAST_MASK];
    if(entry>=0){const length=entry&15;if(length>available)fail('truncated stream');buffer>>>=length;available-=length;return entry>>4;}
    let code=0,first=0,index=0;
    for(let length=1;length<16;length++){
      code|=bits(1);const count=table.count[length];
      if(code-count<first)return table.symbol[index+(code-first)];
      index+=count;first=(first+count)<<1;code<<=1;
    }
    fail('invalid code');
  };
  const inflateCodes=(literals,distances)=>{
    for(;;){
      let symbol=decode(literals);
      if(symbol<256){if(size>=maxOutput)overflow();out[size++]=symbol;continue;}
      if(symbol===256)return;
      symbol-=257;if(symbol>=29)fail('invalid length symbol');
      const length=LENGTH_BASE[symbol]+bits(LENGTH_EXTRA[symbol]),distanceSymbol=decode(distances);
      if(distanceSymbol>=30)fail('invalid distance symbol');
      const distance=DISTANCE_BASE[distanceSymbol]+bits(DISTANCE_EXTRA[distanceSymbol]);
      if(distance>size)fail('distance before the start');
      if(size+length>maxOutput)overflow();
      if(length<32)for(let end=size+length;size<end;size++)out[size]=out[size-distance];
      else if(distance>=length){out.copyWithin(size,size-distance,size-distance+length);size+=length;}
      else{
        // An overlapping match repeats its last `distance` bytes: copy one
        // period, then double the copied span until the length is reached.
        out.copyWithin(size,size-distance,size);let done=distance;
        while(done<length){const n=Math.min(done,length-done);out.copyWithin(size+done,size,size+n);done+=n;}
        size+=length;
      }
    }
  };
  let last=0;
  do{
    last=bits(1);const type=bits(2);
    if(type===0){
      // Stored blocks start at the next byte; any buffered bits are padding.
      align();
      if(pos+4>input.length)fail('truncated stored block');
      const length=input[pos]|input[pos+1]<<8,complement=input[pos+2]|input[pos+3]<<8;pos+=4;
      if(length!==(~complement&0xffff))fail('stored length mismatch');
      if(pos+length>input.length)fail('truncated stored block');
      if(size+length>maxOutput)overflow();
      out.set(input.subarray(pos,pos+length),size);size+=length;pos+=length;
    }else if(type===1){const [literals,distances]=fixedTables();inflateCodes(literals,distances);}
    else if(type===2){
      const literalCount=bits(5)+257,distanceCount=bits(5)+1,codeCount=bits(4)+4;
      if(literalCount>286||distanceCount>30)fail('too many codes');
      const codeLengths=new Uint8Array(19);for(let i=0;i<codeCount;i++)codeLengths[CODE_ORDER[i]]=bits(3);
      const lengthCode=huffman(codeLengths);if(lengthCode.left)fail('incomplete code-length code');
      const lengths=new Uint8Array(literalCount+distanceCount);
      for(let index=0;index<lengths.length;){
        const symbol=decode(lengthCode);
        if(symbol<16){lengths[index++]=symbol;continue;}
        let value=0,repeat;
        if(symbol===16){if(!index)fail('repeat without a length');value=lengths[index-1];repeat=3+bits(2);}
        else if(symbol===17)repeat=3+bits(3);else repeat=11+bits(7);
        if(index+repeat>lengths.length)fail('too many lengths');
        lengths.fill(value,index,index+repeat);index+=repeat;
      }
      if(!lengths[256])fail('missing end-of-block code');
      const literals=huffman(lengths.subarray(0,literalCount),dynamicLookups[0]),distances=huffman(lengths.subarray(literalCount),dynamicLookups[1]);
      // As in zlib, an incomplete code may hold at most one one-bit code
      // (none at all for literal-only data).
      const nonzero=table=>table.count.reduce((n,c,i)=>i?n+c:n,0);
      if(literals.left&&nonzero(literals)!==literals.count[1])fail('incomplete literal code');
      if(distances.left&&nonzero(distances)!==distances.count[1])fail('incomplete distance code');
      inflateCodes(literals,distances);
    }else fail('invalid block type');
  }while(!last);
  align();
  if(pos+4!==input.length)fail(pos+4>input.length?'missing checksum':'trailing bytes');
  const expected=((input[pos]<<24)|(input[pos+1]<<16)|(input[pos+2]<<8)|input[pos+3])>>>0;
  if(adler32(out,size)!==expected)fail('checksum mismatch');
  return out.subarray(0,size);
}
