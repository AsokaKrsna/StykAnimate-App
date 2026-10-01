import {drawingMetadata} from './drawing-model.mjs';

/** Snapshot live presenters without hashing or copying their pixels. Retained
 * geometry can stay identical while a decode, stroke or preview completes. */
export function drawingRasterInputs(items,resources){
  let inputs=null;
  for(const item of items)if(drawingMetadata(item.fig)){
    const entry=resources.drawing?.(item.fig);
    if(entry)(inputs??=[]).push({entry,stamp:entry.stamp,store:entry.store,owner:entry.owner});
  }
  return inputs;
}
export const drawingRasterKey=inputs=>inputs?.map(({entry,stamp})=>entry.id+":"+stamp+":"+(entry.owner?.surfaceVersion??0)).join("|")??"";
export const changedDrawingRaster=inputs=>inputs?.some(({entry,stamp,store,owner})=>entry.disposed||entry.stamp!==stamp||entry.store!==store||entry.owner!==owner);
export function sameDrawingRaster(a,b){
  return (a?.length??0)===(b?.length??0)&&!changedDrawingRaster(a)&&
    (a??[]).every((input,index)=>input.entry===b[index].entry&&input.stamp===b[index].stamp&&input.store===b[index].store&&input.owner===b[index].owner);
}
