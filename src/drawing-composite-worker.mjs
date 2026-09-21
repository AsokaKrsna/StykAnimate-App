import {applyDocumentChunk} from './document-transport.mjs';
import {captureDrawingComposite} from './drawing-composite.mjs';

let snapshot=null,bytes=0;
self.onmessage=async({data})=>{
  try{
    if(data.kind==='composite-chunk'){
      if(data.chunk.header){snapshot=null;bytes=0;}
      bytes+=data.chunk.estimatedBytes??64;
      if(bytes>data.maxBytes)throw new Error('The fill exceeds the drawing working memory limit.');
      snapshot=applyDocumentChunk(snapshot,data.chunk);
      self.postMessage({id:data.id});return;
    }
    if(data.kind!=='composite'||!snapshot)throw new Error('Missing drawing composite snapshot.');
    const source=await captureDrawingComposite(snapshot,{...data,snapshotBytes:bytes});snapshot=null;
    self.postMessage({id:data.id,source:source.buffer},[source.buffer]);
  }catch(error){snapshot=null;self.postMessage({id:data.id,error:error.message});}
};
