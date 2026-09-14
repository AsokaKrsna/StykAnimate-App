/** Upload the bounded startup window one packet per animation frame. Playback
 * begins after those uploads finish on the GPU; packet compilation alone does
 * not mean a large texture is ready to display. */
export class PlaybackUploadWarmup {
  constructor(onReady = () => {}) {this.onReady=onReady;this.reset();}
  reset() {this.fence=null;}
  step(renderer, packets, options) {
    const cache=renderer.preparedFrames;
    if(!packets.length || !cache?.canWarm || !renderer.device?.queue.onSubmittedWorkDone)return true;
    const warmed=[];
    for(const packet of packets) {
      if(!renderer.hasPreparedFrame(packet.key)) {
        if(!renderer.backgroundsReady(options.report,packet.frame))return false;
        // Never evict the first presentation or retained sibling uploads merely
        // to warm a larger window. Ordinary rendering owns cache eviction.
        if(warmed.length&&!cache.canWarm(packet,options))break;
        renderer.prepareFrame(packet,options);this.reset();return false;
      }
      warmed.push(packet.key);
    }
    if(!warmed.length)return false;
    const key=warmed.join('|');
    if(this.fence?.renderer===renderer&&this.fence.key===key)return this.fence.ready;
    const fence=this.fence={renderer,key,ready:false};
    renderer.device.queue.onSubmittedWorkDone().then(()=>{
      if(this.fence!==fence)return;fence.ready=true;this.onReady();
    },()=>{if(this.fence===fence){this.reset();this.onReady();}});
    return false;
  }
}
