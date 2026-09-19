/** Content identity for reusable object-local artwork. Native world geometry is
 * untouched. Coordinates must match exactly after subtracting each root; no
 * quantization or fast-hash-only equality can merge distinct poses or styles. */
const ignoredObjectKeys=new Set(['unique_id','object_slot','root_x','root_y','join','record_offset','record_end','runtime_segments']);
const numericFields=['index','version','angle','bend','length','z','thickness','alpha','opacity'];
const knownFields=new Set(['obj','fig','slot','start','end','points','seg','poly','asset','type','rgb','static','depthValues','culled',...numericFields]);
const types=['line','circle','image','text','poly'];
const hash=values=>{let n=2166136261;for(let i=0;i<values.length;i++)n=Math.imul(n^values[i],16777619);return n>>>0;};
const textHash=value=>{let n=2166136261;for(let i=0;i<value.length;i++)n=Math.imul(n^value.charCodeAt(i),16777619);return n>>>0;};
const equal=(a,b)=>{if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))return false;return true;};
let registrySerial=0;
// A worker has its own module counters. Local fallback keys cross that boundary
// with packets, so a realm identifier is necessary even when no digest is used.
const realmNamespace=globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`;
const encoder=new TextEncoder();
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');

/** Embedded media payloads are megabyte strings that would dominate every
 * signature. Each unique string is hashed once, then its object reference
 * keeps the fingerprint valid; all other fields stay in the signature. */
const PAYLOAD_LENGTH=512;
const assetScrubs=new WeakMap();
const samePayloads=(a,b)=>a.length===b.length&&a.every((value,index)=>value.text===b[index].text);
const payloadDigest=payload=>payload.digest??=digest(encoder.encode(payload.text));
function scrubbedAsset(asset,payloads){
  const cached=assetScrubs.get(asset),records=new Map(),value={...asset};
  for(const key in value){const text=value[key];
    if(typeof text!=='string'||text.length<=PAYLOAD_LENGTH)continue;
    const prior=cached?.get(key),record=prior?.text===text?prior:{text,key:`#${text.length}:${textHash(text)}`};
    records.set(key,record);payloads.push(record);value[key]=record.key;
  }
  assetScrubs.set(asset,records);
  // Payload digests can be retained, but placement/anchor/metadata values may
  // change in place. Always snapshot those current fields with the signature.
  return records.size?value:asset;
}
function scrubbedAssets(assets,payloads){
  return assets?.some(asset=>{for(const key in asset)if(typeof asset[key]==='string'&&asset[key].length>PAYLOAD_LENGTH)return true;return false;})
    ?assets.map(asset=>scrubbedAsset(asset,payloads)):assets;
}

// A sampled clip is rendered from its expanded drawables, never by traversing
// the stored animation here. Child drawing definitions enter the signature below.
function drawingDefinition(figure,payloads){
  const clip=figure._styk?.movieclip;
  let definition=figure;
  if(clip){const {document,...settings}=clip;definition={...figure,_styk:{...figure._styk,movieclip:settings}};}
  const image_assets=scrubbedAssets(definition.image_assets,payloads),text_assets=scrubbedAssets(definition.text_assets,payloads);
  if(image_assets===definition.image_assets&&text_assets===definition.text_assets)return definition;
  return {...definition,image_assets,text_assets};
}

export class ArtworkRegistry {
  constructor({maxBytes=64*1024*1024,maxEntries=512}={}){
    this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.namespace=`${realmNamespace}:${++registrySerial}`;this.artworkSerial=0;this.clear();
  }
  clear(){this.buckets=new Map();this.lru=new Map();this.definitions=new Map();this.byGeometry=new WeakMap();this.figureCache=new WeakMap();this.bytes=0;this.definitionBytes=0;this.serial=0;this.stats={hits:0,misses:0,evictions:0};}
  // Definitions may be edited in place. The editor supplies an explicit
  // definition revision; callers without one re-snapshot on every prepare.
  begin(revision){
    if(revision===undefined||this.definitionRevision!==revision){this.figureCache=new WeakMap();this.byGeometry=new WeakMap();this.definitionRevision=revision;}
  }
  /** Stable cross-packet identity survives eviction of the large comparison
   * records. Local lookup still compares full content after its fast hash.
   * SHA-256 addresses the complete, unquantized signature, not the fast hash. */
  contentKey(artwork){
    if(!artwork.data||!artwork.definition.text||!globalThis.crypto?.subtle)return Promise.resolve(`local:${this.namespace}:${artwork.id}`);
    return artwork.contentKeyPromise??=(async()=>{
      const definition=artwork.definition;
      const definitionKey=await (definition.contentDigest??=(async()=>digest(encoder.encode(JSON.stringify([
        definition.text,await Promise.all(definition.payloads.map(payloadDigest))]))))());
      const payloadKeys=await Promise.all(artwork.payloads.map(payloadDigest));
      const header=encoder.encode(JSON.stringify(['styk-artwork-v2',definitionKey,artwork.metadata,payloadKeys,artwork.data.byteLength]));
      const bytes=new Uint8Array(4+header.byteLength+artwork.data.byteLength);
      new DataView(bytes.buffer).setUint32(0,header.byteLength,true);bytes.set(header,4);
      bytes.set(new Uint8Array(artwork.data.buffer,artwork.data.byteOffset,artwork.data.byteLength),4+header.byteLength);
      return `sha256:${await digest(bytes)}`;
    })();
  }
  definition(figure){
    let value=this.figureCache.get(figure);if(value)return value;
    const payloads=[],text=JSON.stringify(drawingDefinition(figure,payloads));
    if(text.length*2>this.maxBytes/4){value={id:++this.serial,unshared:true,payloads};this.figureCache.set(figure,value);return value;}
    let bucket=this.definitions.get(text)||[];
    value=bucket.find(entry=>samePayloads(entry.payloads,payloads));
    if(!value){
      if(this.definitionBytes+text.length*2>this.maxBytes/4){this.clear();bucket=[];}
      value={id:++this.serial,text,payloads};bucket.push(value);this.definitions.set(text,bucket);this.definitionBytes+=text.length*2;
    }
    this.figureCache.set(figure,value);return value;
  }
  get(g,items){
    const steps=this.getSteps(g,items);
    for(;;){const step=steps.next();if(step.done)return step.value;}
  }
  *getSteps(g,items){
    const definition=this.definition(g.fig),previous=this.byGeometry.get(g);
    if(previous?.items===items&&previous.artwork.definition===definition)return previous.artwork;
    if(definition.unshared){const artwork={definition,id:++this.artworkSerial};this.byGeometry.set(g,{items,artwork});return artwork;}
    // The exact geometry signature already contains the evaluated runtime
    // segments. Write it once into its final buffer, avoiding a large growing
    // JS array plus a second copy on every dense-scene frame change.
    let count=0;
    for(const item of items)count+=8+numericFields.length+(item.rgb?.length??0)+(item.depthValues?.length??0)+
      2*(Number(Boolean(item.start))+Number(Boolean(item.end))+(item.points?.length??0));
    const data=new Float64Array(count),extra=[],payloads=[],childFigures=new Map(),childDefinitions=[],effectOwners=new Set();let cursor=0;
    const point=p=>{data[cursor++]=p.x-g.root.x;data[cursor++]=p.y-g.root.y;};
    for(let i=0;i<items.length;i++){
      if(i && (i & 127)===0)yield {phase:'artwork signature',completed:i,total:items.length};
      const item=items[i],{start,end,points,seg,poly,asset}=item,type=types.indexOf(item.type);
      if(item.obj!==g.obj&&item.obj?._stykVfx&&!effectOwners.has(item.obj)){effectOwners.add(item.obj);extra.push([i,'childEffects',item.obj._stykVfx]);}
      data[cursor++]=type;data[cursor++]=Number(Boolean(start));data[cursor++]=Number(Boolean(end));
      data[cursor++]=points?.length??-1;data[cursor++]=Number(Boolean(item.static));
      for(const field of numericFields){
        const value=item[field];data[cursor++]=value===undefined?NaN:value===null?Infinity:value;
        // Preserve distinctions that Float64 conversion would otherwise erase.
        if(value!==undefined&&value!==null&&(typeof value!=='number'||!Number.isFinite(value)))extra.push([i,field,typeof value,String(value)]);
      }
      const rgb=item.rgb;data[cursor++]=rgb?.length??-1;if(rgb)for(const n of rgb)data[cursor++]=n;
      const depth=item.depthValues;data[cursor++]=depth?.length??-1;if(depth)for(const n of depth)data[cursor++]=n;
      data[cursor++]=item.culled===undefined?0:item.culled===false?1:item.culled===true?2:3;
      if(item.culled!==undefined&&typeof item.culled!=='boolean')extra.push([i,'culled',item.culled]);
      if(depth!==undefined&&(!Array.isArray(depth)||depth.some(n=>typeof n!=='number'||!Number.isFinite(n))))extra.push([i,'depthValues',depth]);
      if(start)point(start);if(end)point(end);if(points)for(const p of points)point(p);
      // Most records reference the definition directly. Styled/generated
      // records and future drawing attributes remain part of exact identity.
      if(type<0)extra.push([i,'type',item.type]);
      if(seg&&seg!==g.fig.segments?.[item.index])extra.push([i,'seg',seg]);
      if(poly&&poly!==g.fig.polyfills?.[item.index])extra.push([i,'poly',poly]);
      if(asset)extra.push([i,'asset',scrubbedAsset(asset,payloads)]);
      if(item.fig&&item.fig!==g.fig){
        let index=childFigures.get(item.fig);
        if(index===undefined){index=childDefinitions.length;childFigures.set(item.fig,index);const child=this.definition(item.fig);
          if(child.text!==undefined){childDefinitions.push(child.text);payloads.push(...child.payloads);}
          else childDefinitions.push(JSON.stringify(drawingDefinition(item.fig,payloads)));}
        extra.push([i,'figure',index]);
      }
      for(const key in item)if(Object.hasOwn(item,key)&&!knownFields.has(key))extra.push([i,key,item[key]]);
    }
    const object=Object.fromEntries(Object.entries(g.obj).filter(([key])=>!ignoredObjectKeys.has(key)));
    const metadata=JSON.stringify(childDefinitions.length?[object,extra,childDefinitions]:[object,extra]);
    const words=new Uint32Array(data.buffer);
    const key=`${definition.id}:${textHash(metadata)}:${hash(words)}:${data.length}`;
    const bucket=this.buckets.get(key)||[];
    let artwork=bucket.find(entry=>entry.definition===definition&&entry.metadata===metadata&&samePayloads(entry.payloads,payloads)&&equal(entry.data,data));
    if(artwork){this.stats.hits++;this.lru.delete(artwork);this.lru.set(artwork,true);}
    else{
      this.stats.misses++;
      artwork={definition,metadata,data,payloads,key,id:++this.artworkSerial,bytes:data.byteLength+metadata.length*2+payloads.length*8};
      if(artwork.bytes<=this.maxBytes){
        bucket.push(artwork);this.buckets.set(key,bucket);this.lru.set(artwork,true);this.bytes+=artwork.bytes;
        while(this.bytes>this.maxBytes||this.lru.size>this.maxEntries){
          const oldest=this.lru.keys().next().value;this.lru.delete(oldest);this.bytes-=oldest.bytes;this.stats.evictions++;
          const entries=this.buckets.get(oldest.key);entries.splice(entries.indexOf(oldest),1);if(!entries.length)this.buckets.delete(oldest.key);
        }
      }
      else artwork={definition,id:artwork.id};
    }
    this.byGeometry.set(g,{items,artwork});return artwork;
  }
}
