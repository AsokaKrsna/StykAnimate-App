import {messageError} from './localized-error.mjs';
// Recovery bytes and tiny display/capacity metadata have separate stores.
// Listing never materializes project bytes. Each tab owns one key; saves cannot
// clear another tab's work. Web Locks keep live copies out of recovery offers.
const NAME='stykanimate-recovery', STORE='documents', META='metadata', VERSION=2;
export const MAX_RECOVERY_COPIES=8, MAX_RECOVERY_BYTES=512*1024*1024;
const sizeOf=record=>record?.data instanceof ArrayBuffer ? record.data.byteLength : record?.blob?.size ?? 0;
const metadata=(record,id)=>({id,name:record.name,savedAt:record.savedAt,token:record.token,size:sizeOf(record)});

function open(database){
  return new Promise((resolve,reject)=>{
    if(!database){reject(messageError(new Error(''), "errors.browserRecovery.thisBrowserDoesNotAllowRecoveryCopies", {}));return;}
    let request,failed=false;
    try{request=database.open(NAME,VERSION);}catch(error){reject(error);return;}
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);
      if(!db.objectStoreNames.contains(META)){
        const entries=db.createObjectStore(META);
        // Upgrade the old singleton without copying or re-encoding its bytes.
        const cursor=request.transaction.objectStore(STORE).openCursor();
        cursor.onsuccess=()=>{const item=cursor.result;if(!item)return;entries.put(metadata(item.value,item.key),item.key);item.continue();};
      }
    };
    request.onsuccess=()=>{const db=request.result;if(failed){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};
    request.onerror=()=>reject(request.error??messageError(new Error(''), "errors.browserRecovery.recoveryStorageCouldNotBeOpened", {}));
    request.onblocked=()=>{failed=true;reject(messageError(new Error(''), "errors.browserRecovery.closeOlderStykanimateTabsToUpdateRecoveryStorage", {}));};
  });
}

async function within(database,mode,work,signal){
  if(signal?.aborted)return false;
  const db=await open(database);
  if(signal?.aborted){db.close();return false;}
  return new Promise((resolve,reject)=>{
    let tx,value,failure,finished=false;
    const finish=(error)=>{if(finished)return;finished=true;signal?.removeEventListener('abort',cancel);db.close();if(error)reject(error);else resolve(value);};
    const cancel=()=>{try{tx.abort();}catch{/* The commit already completed. */}};
    try{tx=db.transaction([STORE,META],mode);}catch(error){db.close();reject(error);return;}
    tx.oncomplete=()=>finish();
    tx.onabort=()=>{if(signal?.aborted){value=false;finish();}else finish(failure??tx.error??messageError(new Error(''), "errors.browserRecovery.recoveryTransactionAborted", {}));};
    tx.onerror=()=>finish(tx.error??messageError(new Error(''), "errors.browserRecovery.recoveryWriteFailed", {}));
    signal?.addEventListener('abort',cancel,{once:true});
    const fail=error=>{failure=error;cancel();};
    try{work(tx.objectStore(STORE),tx.objectStore(META),result=>{value=result;},fail);}catch(error){fail(error);}
  });
}

/** At most eight small metadata records, newest first; no project bytes. */
export function listBrowserRecovery(database=globalThis.indexedDB){
  return within(database,'readonly',(_files,entries,done)=>{
    const request=entries.getAll();request.onsuccess=()=>done(request.result.sort((a,b)=>b.savedAt-a.savedAt));
  }).then(records=>records??[],()=>[]);
}

/** Reads exactly one copy. The optional default keeps the older API usable. */
export async function readBrowserRecovery(database=globalThis.indexedDB,{id}={}){
  if(id===undefined)id=(await listBrowserRecovery(database))[0]?.id;
  if(id===undefined)return null;
  return within(database,'readonly',(files,_entries,done)=>{
    const request=files.get(id);request.onsuccess=()=>done(request.result??null);
  }).then(record=>{
    if(!record)return null;
    const blob=record.data instanceof ArrayBuffer ? new Blob([record.data],{type:'application/octet-stream'}) : record.blob;
    return blob ? {...metadata(record,id),blob} : null;
  },()=>null);
}

/** Clear only the owner's key; optional timestamp protects stale picker actions. */
export function clearBrowserRecovery(database=globalThis.indexedDB,{id='latest',savedAt,token}={}){
  return within(database,'readwrite',(files,entries,done)=>{
    const request=entries.get(id);request.onsuccess=()=>{
      if(savedAt!==undefined&&request.result?.savedAt!==savedAt||token!==undefined&&request.result?.token!==token){done(false);return;}
      files.delete(id);entries.delete(id);done(true);
    };
  }).then(Boolean,()=>false);
}

/** Capacity rejection leaves every existing copy intact; never evict live work. */
export function writeBrowserRecovery(blob,name,signal,database=globalThis.indexedDB,{id='latest'}={}){
  const record={name,savedAt:Date.now(),token:crypto.randomUUID(),...(blob instanceof ArrayBuffer ? {data:blob} : {blob})};
  return within(database,'readwrite',(files,entries,done,fail)=>{
    const request=entries.getAll();request.onsuccess=()=>{
      const others=request.result.filter(entry=>entry.id!==id),size=sizeOf(record);
      if(others.length>=MAX_RECOVERY_COPIES||size+others.reduce((sum,entry)=>sum+entry.size,0)>MAX_RECOVERY_BYTES){
        fail(messageError(new Error(''), "errors.browserRecovery.recoveryStorageIsFullSaveAProjectOr", {}));return;
      }
      try{files.put(record,id);entries.put(metadata(record,id),id);done(true);}catch(error){fail(error);}
    };
  },signal);
}

/** Page lifetime ownership, independent of editable document data/history. */
export class BrowserRecoverySession{
  constructor({locks=globalThis.navigator?.locks,database=globalThis.indexedDB}={}){
    this.locks=locks;this.database=database;this.id=crypto.randomUUID();this.pending=new Set();this.disposed=false;
    this.ready=this.claim(this.id).catch(()=>{this.locks=null;return ()=>{};}).then(release=>{this.release=release;});
  }
  claim(id){
    if(!this.locks?.request)return Promise.resolve(()=>{});
    return new Promise((resolve,reject)=>{
      this.locks.request('stykanimate-recovery:'+id,{ifAvailable:true},lock=>{
        if(!lock){resolve(null);return;}
        return new Promise(release=>resolve(release));
      }).catch(reject);
    });
  }
  async list(){
    await this.ready;
    const records=await listBrowserRecovery(this.database),available=[];
    for(const record of records){
      if(record.id===this.id){available.push(record);continue;}
      const release=await this.claim(record.id);
      if(release){release();available.push(record);}
    }
    return available;
  }
  async write(blob,name,signal){
    await this.ready;if(this.disposed)return false;
    // Store ArrayBuffers for WebKit compatibility; reject oversized snapshots
    // before allocating a second copy of their bytes on the UI thread.
    if(blob instanceof Blob){
      if(blob.size>MAX_RECOVERY_BYTES)throw messageError(new Error(''), "errors.browserRecovery.recoveryStorageIsFullSaveAProjectOr", {});
      blob=await blob.arrayBuffer();
      if(this.disposed||signal?.aborted)return false;
    }
    const write=writeBrowserRecovery(blob,name,signal,this.database,{id:this.id});this.pending.add(write);
    try{return await write;}finally{this.pending.delete(write);}
  }
  async clear(){await this.ready;return clearBrowserRecovery(this.database,{id:this.id});}
  /** Reserve an abandoned copy before decoding it; publication adopts its key. */
  async reserve(record){
    await this.ready;
    if(record.id===this.id)return {commit:()=>{},release:()=>{}};
    const release=await this.claim(record.id);
    if(!release)return null;
    // Without Web Locks, never adopt a key another page could still own. The
    // source remains available until explicitly discarded in the recovery list.
    return {commit:async()=>{if(this.locks?.request){await this.clear();this.release?.();this.id=record.id;this.release=release;}else release();},release};
  }
  async discard(record){
    await this.ready;
    const release=record.id===this.id ? ()=>{} : await this.claim(record.id);
    if(!release)return false;
    try{return await clearBrowserRecovery(this.database,record);}finally{release();}
  }
  dispose(){
    this.disposed=true;
    // A page can finish an already-submitted transaction during navigation.
    // Keep its lease until that write settles; no new writes enter afterwards.
    this.ready.then(()=>Promise.allSettled([...this.pending])).then(()=>{this.release?.();this.release=null;});
  }
}
