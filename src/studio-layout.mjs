/** Canvas-first layout. The old sidebar preferences never reduce the stage. */
const KEY = 'stykanimate.studio-layout.v1';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function constrainStudioLayout(preferences = {}, width = 1280, height = 640) {
  preferences = preferences && typeof preferences === 'object' ? preferences : {};
  const right = clamp(Number(preferences.right) || 292, 230, Math.max(230, Math.min(390, width - 460)));
  const timeline = clamp(Number(preferences.timeline) || 280, 200, Math.max(200, height - 210));
  return {right, timeline};
}

export function initWorkspaceLayout({preferences: nativePreferences, onPersist, onPersistError} = {}) {
  const workspace = document.querySelector('.workspace');
  const timeline = workspace.querySelector('.timeline-panel');
  // Give timeline its own full-width row, including the space below the inspector.
  workspace.append(timeline);
  const events = new AbortController();
  let preferences = {}, sizes, expanded = false, gesture = null, chain = Promise.resolve(true), accessoryHeight = 0, accessoryFocused = false;
  try {
    const saved = nativePreferences?.studioVersion === 1 ? nativePreferences : JSON.parse(localStorage.getItem(KEY) || '{}');
    preferences = saved && typeof saved === 'object' && !Array.isArray(saved) ? {...saved} : {};
  } catch { /* Optional layout storage. */ }
  const chromeHeight = () => [...timeline.children].filter(node => node.id !== 'timeline').reduce((sum, node) => sum + node.getBoundingClientRect().height, 2);
  const resizeAccessory = (value, commit = false) => timeline.dispatchEvent(new CustomEvent('styk-audio-panel-resize', {detail:{height:value - chromeHeight(), commit}}));
  function apply() {
    sizes = constrainStudioLayout(preferences, workspace.clientWidth, workspace.clientHeight);
    if (accessoryHeight) {
      sizes = constrainStudioLayout({...preferences,timeline:accessoryFocused ? accessoryHeight + chromeHeight() : sizes.timeline + accessoryHeight},workspace.clientWidth,workspace.clientHeight);
    }
    if (expanded) sizes.timeline = Math.max(sizes.timeline, Math.min(Math.round(workspace.clientHeight * .64), Math.max(200, workspace.clientHeight - 210)));
    workspace.style.setProperty('--studio-inspector', `${sizes.right}px`);
    workspace.style.setProperty('--studio-timeline', `${sizes.timeline}px`);
    for (const [name, splitter] of Object.entries(splitters)) {
      splitter.setAttribute('aria-valuenow', String(Math.round(sizes[name])));
      splitter.setAttribute('aria-valuemin', name === 'right' ? '230' : '200');
      splitter.setAttribute('aria-valuemax', String(name === 'right' ? 390 : Math.max(200, workspace.clientHeight - 210)));
    }
  }
  function persist() {
    const snapshot = {...preferences, studioVersion: 1};
    try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* Optional storage. */ }
    if (onPersist) chain = chain.then(async () => {
      try { await onPersist(snapshot); return true; }
      catch (error) { onPersistError?.(error); return false; }
    });
  }
  const splitters = {};
  for (const [name, label] of [['right', 'Resize properties panel'], ['timeline', 'Resize timeline']]) {
    const splitter = document.createElement('div');
    splitter.className = `studio-splitter studio-splitter-${name}`;
    splitter.tabIndex = 0;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-label', label);
    splitter.setAttribute('aria-orientation', name === 'right' ? 'vertical' : 'horizontal');
    splitter.title = `${label} · Drag or use arrow keys · Double-click to reset`;
    workspace.append(splitter);
    splitters[name] = splitter;
    splitter.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      gesture = {name, start: name === 'right' ? event.clientX : event.clientY, initial: sizes[name], before: {...preferences}, focused:accessoryFocused};
      if (name === 'timeline') {
        expanded = false;
        expandButton.setAttribute('aria-pressed', 'false');
        expandButton.setAttribute('aria-label', 'Expand timeline');
      }
      splitter.setPointerCapture(event.pointerId);
      splitter.dataset.dragging = 'true';
    }, {signal: events.signal});
    splitter.addEventListener('pointermove', event => {
      if (!gesture || gesture.name !== name) return;
      const coordinate = name === 'right' ? event.clientX : event.clientY;
      if (name === 'timeline' && gesture.focused) { resizeAccessory(gesture.initial + gesture.start - coordinate); return; }
      preferences[name] = gesture.initial + gesture.start - coordinate - (name === 'timeline' ? accessoryHeight : 0);
      apply();
    }, {signal: events.signal});
    const finish = (cancel = false) => {
      if (!gesture) return;
      if (cancel) preferences = gesture.before;
      if (name === 'timeline' && gesture.focused) resizeAccessory(cancel ? gesture.initial : sizes[name], !cancel);
      else if (!cancel) preferences[name] = sizes[name] - (name === 'timeline' ? accessoryHeight : 0);
      gesture = null;
      delete splitter.dataset.dragging;
      apply();
      if (!cancel) persist();
    };
    splitter.addEventListener('pointerup', () => finish(), {signal: events.signal});
    splitter.addEventListener('pointercancel', () => finish(true), {signal: events.signal});
    splitter.addEventListener('lostpointercapture', () => finish(true), {signal: events.signal});
    splitter.addEventListener('dblclick', () => { delete preferences[name]; apply(); persist(); }, {signal: events.signal});
    splitter.addEventListener('keydown', event => {
      if (event.key === 'Escape' && gesture) { finish(true); return; }
      const direction = name === 'right' ? {ArrowLeft: 1, ArrowRight: -1} : {ArrowUp: 1, ArrowDown: -1};
      if (name === 'timeline' && accessoryFocused && (direction[event.key] || event.key === 'Home')) {
        event.preventDefault(); resizeAccessory(event.key === 'Home' ? 450 : sizes.timeline + direction[event.key] * (event.shiftKey ? 40 : 12), true); return;
      }
      if (event.key === 'Home') delete preferences[name];
      else if (direction[event.key]) preferences[name] = sizes[name] + direction[event.key] * (event.shiftKey ? 40 : 12) - (name === 'timeline' ? accessoryHeight : 0);
      else return;
      event.preventDefault();
      if (name === 'timeline') { expanded = false; expandButton.setAttribute('aria-pressed', 'false'); expandButton.setAttribute('aria-label', 'Expand timeline'); }
      apply(); persist();
    }, {signal: events.signal});
  }
  const expandButton = document.getElementById('expand-timeline');
  expandButton.addEventListener('click', () => {
    expanded = !expanded;
    expandButton.setAttribute('aria-pressed', String(expanded));
    expandButton.setAttribute('aria-label', expanded ? 'Restore timeline height' : 'Expand timeline');
    apply();
  }, {signal: events.signal});
  const observer = new ResizeObserver(apply);
  observer.observe(workspace);
  apply();
  return {
    get sizes() { return {...sizes}; },
    get preferences() { return {...preferences}; },
    reset() { preferences = {}; expanded = false; expandButton.setAttribute('aria-pressed', 'false'); expandButton.setAttribute('aria-label', 'Expand timeline'); apply(); persist(); },
    resize: apply,
    setTimelineAccessoryHeight(value, focused = false) { const next = clamp(Number(value) || 0,0,560); if(next!==accessoryHeight || focused!==accessoryFocused){accessoryHeight=next;accessoryFocused=focused;apply();} },
    flushPreferences: () => chain,
    destroy() { events.abort(); observer.disconnect(); Object.values(splitters).forEach(el => el.remove()); },
  };
}
