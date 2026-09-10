import { HotkeyManager } from './hotkeys.mjs';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Shared timeline adapter also supports independently mounted timeline widgets. */
export function runTimelineHotkey(timeline, id, event = {}) {
  const filmstrip = Boolean(timeline.strip), extend = Boolean(event.shiftKey);
  if (id === 'cancel') { timeline._cancelGesture?.(); timeline.menu?.remove(); return true; }
  const methods = {copy:'copySelection', cut:'cutSelection', paste:'pasteSelection', 'select-all':'selectAll'};
  if (methods[id]) { timeline[methods[id]](); return true; }
  if (id === 'undo' || id === 'redo') { timeline._run(() => timeline.editor[id]()); return true; }
  if (id === 'delete') { filmstrip ? timeline.action('delete') : timeline.removeFrames(); return true; }
  if (id === 'add-frame') { filmstrip ? timeline.action('add') : timeline.addFrame(); return true; }
  const advanced = {'remove-frames':'removeFrames', 'clear-keys':'clearKeys'};
  if (!filmstrip && advanced[id]) { timeline[advanced[id]](); return true; }
  if (['previous-frame', 'next-frame', 'previous-exposure', 'next-exposure', 'timeline-layer-up', 'timeline-layer-down'].includes(id)) {
    const direction = id.startsWith('previous') ? -1 : 1;
    if (filmstrip) timeline.selectFrame(timeline.selectedIndex + direction, {extend});
    else {
      const row = timeline.tracks.findIndex(t => t.id === timeline.selectedTrackId);
      timeline._run(() => timeline._selectCell({row:clamp(row + (id === 'timeline-layer-up' ? -1 : id === 'timeline-layer-down' ? 1 : 0), 0, timeline.tracks.length - 1), tick:Math.max(0, timeline.editor.tick + (id.startsWith('timeline-layer-') ? 0 : direction))}, {extend}));
      timeline.revealPlayhead();
    }
    return true;
  }
  return false;
}
export function attachTimelineHotkeys(timeline) {
  timeline.ownsHotkeys = !timeline.hotkeys;
  if (!timeline.hotkeys) timeline.hotkeys = new HotkeyManager({run: (id, event, modifiers) => runTimelineHotkey(timeline, id, {shiftKey:modifiers.shift})});
  timeline.shortcut = id => timeline.hotkeys.label(id);
}
