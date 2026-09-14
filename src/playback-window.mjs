/** Exact lookahead within a half-open playback range. Non-looping playback
 * drains its final packets without competing with a speculative next loop. */
export function playbackWindow(start,count,range,{loop=false,bidirectional=false}={}) {
  const ticks=[],span=range.end-range.start;
  if(span<=0||count<=0)return ticks;
  const behind=bidirectional?Math.min(4,Math.floor(count/4),Math.max(0,start-range.start)):0;
  for(let n=0;n<Math.min(count-behind,span);n++){
    const next=Math.max(start,range.start)+n;
    if(!loop&&next>=range.end)break;
    ticks.push(range.start+(next-range.start)%span);
  }
  for(let n=1;n<=behind;n++){
    const tick=start-n;
    if(tick>=range.start&&tick<range.end&&!ticks.includes(tick))ticks.push(tick);
  }
  return ticks;
}

export function playbackLookaheadSize(count, cores = 4) {
  return Math.max(Math.min(count, 8), Math.round(count * Math.min(1, cores / 8)));
}

/** Expensive cold preparation gets a quarter-second runway. Cheap vector
 * scenes keep the short startup, and neither mode waits beyond its queue. */
export function playbackStartupWindow(fps, compileMs, cores = 4) {
  const seconds = compileMs > 500 / fps ? .25 : .1;
  return Math.min(playbackLookaheadSize(24, cores), Math.max(2, Math.ceil(fps * seconds)));
}
