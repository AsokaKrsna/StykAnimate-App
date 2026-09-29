/**
 * The timeline header (architecture.md §3.14, experience.md §5.6): one header
 * for Simple and Advanced in three clusters, laid out in the static slots of
 * `.timeline-toolbar` (index.html):
 *
 *   start      Simple │ Advanced, Add frame (one button for both modes), in
 *              Advanced on a drawing layer the Next copy split, and Edit
 *              together (#range-edit: shown with its word and count only while
 *              it can apply, the command palette reaches it any time; not on
 *              a one-frame file, and in Simple it is the frame bar's switch)
 *   transport  First frame, previous, Play, next, Loop, the readout (a click
 *              opens Go to frame) and the frame rate (#fps, an inline field)
 *   end        the view tools (the ruler-tools slot: #timeline-zoom, Fit
 *              timeline, #expand-timeline), then after a hairline Onion (a
 *              split button), Audio (a dot while the animation has sound) and
 *              Timeline ⋯ (#timeline-menu-button) with the rare rows
 *
 * so the Advanced grid and Simple's cards take the island's whole width.
 *
 * The clusters never touch: the grid keeps a gap between them and slides the
 * transport right into free space; when the header is still too narrow the
 * zoom slider folds, then the words, in this order: Edit together's, Next
 * copy's, and last Add frame's (never at the minimal tier, where the buttons
 * are glyphs anyway).
 * The fold measures the header only when its width or its words change,
 * never while playing. At the minimal tier First frame, Loop, Audio and Edit
 * together fold into Timeline ⋯, and Edit together never shows in Draw or
 * Build or on a one-frame file: the header hides them itself (`hidden`), so
 * the folds hold whichever stylesheets are loaded.
 *
 * Ids, element types and accessible names are the contracts tests use; the
 * controls keep their ids and actions and only change parent and look. The
 * look of index.html's own controls (the kit's classes) follows the timeline
 * stylesheet (features/timeline.css): until it loads they keep today's look,
 * so the header never mixes the kit's sizes with the legacy layout. The
 * timeline components (layer-timeline.mjs, sheet-filmstrip.mjs) tell the
 * header what it shows (setAddFrame, setNextCopy, setZoom); the header runs
 * its commands on the mounted component or through the app's actions.
 *
 * DOM-free at import: createTimelineHeader() wires the toolbar when called.
 */
import {icon} from './icons.mjs';
import {openMenu, menuFor} from './ui/ui-menu.mjs';
import {createPopover} from './ui/ui-popover.mjs';
import {setAttr, setHidden, setProp, setText, setVar} from './ui/dom-write.mjs';
import {setSharedSize} from './shell/layout-schema.mjs';
import {bandBottom} from './shell/topbar.mjs';
import {sayTimeline} from './locales/en-timeline.mjs';

/**
 * What folds, in order (experience.md §1.8, revision 4.3): the zoom slider (Ctrl + wheel and Fit still zoom), Edit
 * together's word, Next copy's word, Add frame's word, and last, where even the glyphs do not fit (a drawing layer
 * in a window about 500px wide), the Next copy split itself, whose commands then lead Timeline ⋯ (they are the
 * drawing rows' frame menu too).
 */
export const HEADER_FOLDS = Object.freeze(['zoom', 'together', 'cel', 'add', 'celmenu']);
const WORDS = 4;

/** Which folds a header applies: the first `count` of HEADER_FOLDS; at the minimal tier every word from the start. */
export function headerFolds(count, {tier = 'wide'} = {}) {
  return HEADER_FOLDS.slice(0, Math.max(0, tier === 'minimal' ? Math.max(WORDS, count) : count));
}

const element = (tag, parent, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
};

/**
 * ctx: the timeline host's context ({editor, state, $, actions, hotkeys, fail,
 * localization(), overlays?}); `host`: {timeline, goToFrame(number)}. The
 * shell arrives later through attach(). Returns the header's API.
 */
export function createTimelineHeader(ctx, host) {
  const {$} = ctx;
  const toolbar = document.querySelector('#animation-timeline > .timeline-toolbar');
  const say = (key, params) => sayTimeline(ctx.localization?.()?.t ? (k, p) => ctx.localization().t(k, p) : null, key, params);
  const run = (fn) => { try { const result = fn(); if (result?.catch) result.catch(error => ctx.fail?.(error)); } catch (error) { ctx.fail?.(error); } };
  const slot = name => toolbar.querySelector(`:scope > [data-slot="${name}"]`);
  const start = slot('start'), transport = slot('transport'), end = slot('end'), rulerTools = slot('ruler-tools');
  const iconButton = (parent, name, label, {size} = {}) => {
    const button = element('button', parent, 'ui-icon-button');
    button.type = 'button';
    if (size) button.dataset.size = size;
    button.innerHTML = icon(name);
    button.setAttribute('aria-label', label);
    return button;
  };
  // The kit's look for index.html's controls needs the timeline stylesheet's layout (it defines --timeline-kit).
  const styled = getComputedStyle(toolbar).getPropertyValue('--timeline-kit').trim() !== '';
  const kit = (node, classes = [], data = {}) => {
    if (!styled || !node) return;
    node.classList.add(...classes);
    Object.assign(node.dataset, data);
  };
  toolbar.classList.add('tl-head');
  start.classList.add('tl-start');
  transport.classList.add('tl-transport');
  end.classList.add('tl-end');
  // The view tools (zoom, Fit, Tall) lead the end cluster, so the grid and the cards take the island's whole width.
  rulerTools.classList.add('tl-ruler-tools');
  end.prepend(rulerTools);
  rulerTools.setAttribute('role', 'group');
  rulerTools.setAttribute('aria-label', say('timeline.zoomTools'));

  // ---- Start: the mode switch, Add frame, Next copy and Edit together ----
  const modes = $('timeline-workflow');
  modes.classList.add('tl-mode');
  kit(modes, ['ui-segmented'], {size: 'sm'});
  for (const item of modes.querySelectorAll('[data-timeline-mode]')) kit(item, ['ui-segmented-item']);
  // .sheet-header-tools > .sheet-frame-tools: the hooks tests and hotkey hints find Add frame by, and
  // the class an audio clip's selection sets to hide the frame commands (layer-timeline's headerTools).
  const frameWrap = element('div', null, 'sheet-header-tools tl-frame-wrap');
  const frameTools = element('div', frameWrap, 'sheet-frame-tools tl-frame-tools');
  modes.after(frameWrap);
  const addFrame = element('button', frameTools, 'ui-button sheet-add-button sheet-add-frame tl-add');
  addFrame.type = 'button';
  addFrame.dataset.variant = 'ghost';
  addFrame.dataset.hotkeyCommand = 'add-frame';
  addFrame.innerHTML = `${icon('plus')}<span class="ui-label">${say('timeline.addFrame')}</span>`;
  addFrame.setAttribute('aria-label', say('timeline.addFrameName'));
  addFrame.dataset.hotkeyTitle = say('timeline.addFrame');
  addFrame.addEventListener('click', () => run(() => host.timeline?.addFrameFromHeader?.()));
  const addWord = addFrame.lastChild;

  const cel = element('div', frameTools, 'ui-split tl-cel');
  cel.setAttribute('role', 'group');
  cel.setAttribute('aria-label', say('timeline.drawingFrames'));
  cel.hidden = true;
  const celMain = element('button', cel, 'ui-button tl-cel-main');
  celMain.type = 'button';
  celMain.dataset.variant = 'ghost';
  celMain.innerHTML = `${icon('duplicate')}<span class="ui-label">${say('timeline.nextCopy')}</span>`;
  celMain.setAttribute('aria-label', say('timeline.nextCopyName'));
  celMain.dataset.tooltip = say('timeline.nextCopyTip');
  celMain.addEventListener('click', () => run(() => host.timeline?.nextDrawing?.(false)));
  const celMore = element('button', cel, 'ui-split-more');
  celMore.type = 'button';
  celMore.innerHTML = icon('chevron-down');
  celMore.setAttribute('aria-label', say('timeline.nextCopyMore'));
  celMore.setAttribute('aria-haspopup', 'menu');
  celMore.setAttribute('aria-expanded', 'false');
  celMore.addEventListener('click', () => toggleMenu(celMore, () => celItems(), say('timeline.drawingFrames')));

  // Edit together (#range-edit) joins the start cluster; timeline-host.mjs keeps writing its state.
  const range = $('range-edit');
  frameWrap.after(range);
  range.classList.add('tl-together');
  if (styled) range.classList.remove('button', 'subtle', 'small');
  kit(range, ['ui-button'], {variant: 'ghost'});
  range.setAttribute('aria-label', say('timeline.editTogether'));
  const rangeLabel = range.querySelector('.range-edit-label');
  rangeLabel.classList.add('ui-label');
  rangeLabel.textContent = say('timeline.editTogether');

  // ---- Transport: First frame, the steps, Play, Loop, the readout and the frame rate ----
  const controls = transport.querySelector('.playback-controls');
  controls.classList.add('tl-controls');
  for (const button of controls.querySelectorAll(':scope > .icon-button')) kit(button, ['ui-icon-button']);
  const names = {'first-frame': 'timeline.firstFrame', 'previous-frame': null, 'next-frame': null};
  for (const [action, key] of Object.entries(names)) {
    const button = controls.querySelector(`[data-action="${action}"]`);
    if (key && button && !button.hasAttribute('aria-label')) button.setAttribute('aria-label', say(key));
  }
  controls.querySelector('[data-action="first-frame"]')?.classList.add('tl-first');
  const play = $('play-button');
  play.classList.add('tl-play');
  kit(play, ['ui-icon-button'], {shape: 'round', variant: 'soft'});
  const loop = $('loop-button');
  loop.classList.add('tl-loop');
  kit(loop, [], {quiet: ''});
  if (!loop.hasAttribute('aria-label')) loop.setAttribute('aria-label', say('timeline.loop'));
  // The readout is a button that opens Go to frame; its text stays #time-display's.
  const time = $('time-display');
  const readout = element('button', null, 'tl-readout');
  readout.type = 'button';
  readout.setAttribute('aria-haspopup', 'dialog');
  readout.setAttribute('aria-expanded', 'false');
  readout.setAttribute('aria-description', say('timeline.goToFrame'));
  time.before(readout);
  readout.append(time);
  // The tooltip names the frame; it is written when it is about to show, never while the readout ticks.
  const readoutTip = () => {
    const timeline = host.timeline, simple = Boolean(timeline?.strip);
    const frame = simple ? (timeline.selectedIndex ?? 0) + 1 : Math.floor(ctx.editor.tick) + 1;
    const total = simple ? timeline.frameCount : ctx.editor.totalTicks;
    setAttr(readout, 'data-tooltip', say('timeline.readoutTip', {frame, total}));
  };
  readout.addEventListener('pointerenter', readoutTip);
  readout.addEventListener('focus', readoutTip);
  readout.addEventListener('click', () => (goTo?.isOpen ? goTo.hide('toggle') : openGoToFrame()));
  controls.querySelector(':scope > .fps-control')?.classList.add('tl-fps');

  // ---- End: Onion, Audio, Timeline… (a folded timeline) and Timeline ⋯ ----
  const onion = end.querySelector('.timeline-onion-controls');
  onion.classList.add('tl-onion');
  kit(onion, ['ui-split']);
  onion.setAttribute('role', 'group');
  onion.setAttribute('aria-label', say('timeline.onion'));
  const onionButton = $('onion-button');
  kit(onionButton, ['ui-icon-button'], {quiet: ''});
  kit($('onion-settings-button'), ['ui-split-more']);
  const audio = $('timeline-audio');
  audio.classList.add('tl-audio');
  kit(audio, ['ui-icon-button'], {quiet: ''});
  const sheetButton = toolbar.querySelector(':scope > .shell-timeline-sheet');
  if (sheetButton) { kit(sheetButton, ['ui-icon-button']); end.append(sheetButton); }
  const menuButton = iconButton(end, 'more', say('timeline.menu'));
  menuButton.id = 'timeline-menu-button';
  menuButton.setAttribute('aria-haspopup', 'menu');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.addEventListener('click', () => toggleMenu(menuButton, () => timelineMenuItems(), say('timeline.menu')));

  // ---- The ruler's tools: zoom, Fit timeline, Tall timeline ----
  const zoomTools = rulerTools.querySelector('.timeline-actions');
  zoomTools.hidden = false;
  zoomTools.classList.add('tl-zoom');
  // The zoom glyph (index.html's [data-icon="zoom"], hydrated into an <svg> in its <span>).
  const zoomGlyph = zoomTools.querySelector(':scope > span');
  if (zoomGlyph) { zoomGlyph.innerHTML = icon('zoom-out'); zoomGlyph.classList.add('tl-zoom-glyph'); zoomGlyph.setAttribute('aria-hidden', 'true'); }
  const zoom = $('timeline-zoom');
  zoom.classList.add('sheet-zoom');
  kit(zoom, ['ui-slider'], {quiet: ''});
  const fit = iconButton(rulerTools, 'fit', say('timeline.fit'), {size: 'sm'});
  fit.classList.add('tl-fit');
  fit.addEventListener('click', () => run(() => host.timeline?.fitAll?.()));
  const tall = $('expand-timeline');
  tall.classList.add('tl-tall');
  kit(tall, ['ui-icon-button'], {size: 'sm', quiet: ''});
  tall.removeAttribute('title');
  tall.dataset.tooltip = say('timeline.tall');
  tall.innerHTML = icon('panel-bottom');
  rulerTools.append(tall);

  // ---- Menus ----
  const menuOptions = () => ({
    overlays: ctx.overlays ?? null,
    icon: (name) => icon(name),
    t: ctx.localization?.()?.t ? (key) => ctx.localization().t(key) : null,
    topInset: () => bandBottom(document) + 6,
  });
  function toggleMenu(anchor, items, label) {
    const open = menuFor(anchor);
    if (open) { open.close('toggle'); return; }
    openMenu({...menuOptions(), anchor, items, label, placement: 'bottom-end'});
  }
  const shortcut = id => ctx.hotkeys?.label?.(id) || false;
  const action = name => () => run(() => ctx.actions[name]?.());
  function timelineMenuItems() {
    const tier = document.documentElement.dataset.tier;
    const items = [];
    // A phone's touch interface folds Simple │ Advanced and Onion's settings into this menu (features/touch.css).
    const root = document.documentElement.dataset;
    if (root.input === 'touch' && root.form === 'phone') {
      const current = modes.querySelector('[aria-pressed="true"]')?.dataset.timelineMode;
      for (const item of modes.querySelectorAll('[data-timeline-mode]'))
        items.push({label: item.textContent.trim(), icon: item.dataset.timelineMode === 'simple' ? 'frame' : 'timeline', radio: true, group: 'timeline-mode',
          checked: item.dataset.timelineMode === current, run: () => item.click()});
      items.push(null, {label: say('timeline.onionSettings'), icon: 'onion', run: () => $('onion-settings-button').click()}, null);
    }
    const phone = root.input === 'touch' && root.form === 'phone';
    if (sheetButton && !sheetButton.hidden)
      items.push({label: say('timeline.sheet'), icon: 'timeline', run: action('timeline-sheet')}, null);
    if (!cel.hidden && (toolbar.dataset.fold ?? '').split(' ').includes('celmenu'))
      items.push({label: say('timeline.nextCopyName'), icon: 'duplicate', disabled: celMain.disabled, run: () => run(() => host.timeline?.nextDrawing?.(false))},
        ...celItems().map(item => item && {...item, disabled: celMain.disabled}), null);
    if (tier !== 'minimal' && root.touchLayout === 'tablet-portrait')
      items.push({label: say('timeline.firstFrame'), icon: 'first', shortcut: shortcut('first-frame'), run: action('first-frame')}, null);
    // At the minimal width, and on a phone's touch timeline, the header's rarer buttons are rows here.
    if (tier === 'minimal' || phone) {
      const mode = document.querySelector('.workspace')?.dataset.mode;
      items.push(
        {label: fit.getAttribute('aria-label'), icon: 'fit', run: () => run(() => host.timeline?.fitAll?.())},
        {label: say('timeline.firstFrame'), icon: 'first', shortcut: shortcut('first-frame'), run: action('first-frame')},
        {label: say('timeline.loop'), icon: 'loop', checked: Boolean(ctx.state.loop), run: action('toggle-loop')},
        {label: say('timeline.audio'), icon: 'music', checked: audio.getAttribute('aria-pressed') === 'true', run: action('toggle-audio')},
        {label: say('timeline.editTogether'), icon: 'frame', checked: range.getAttribute('aria-pressed') === 'true',
          disabled: range.disabled, reason: say('timeline.editTogetherReason'), hidden: mode !== 'animate' || oneFrame,
          run: action('toggle-range-edit')},
        null);
    }
    items.push(
      {label: say('timeline.lastFrame'), icon: 'last', shortcut: shortcut('last-frame'), run: action('last-frame')},
      {label: say('timeline.previousKey'), icon: 'chevron-left', shortcut: shortcut('previous-keyframe'), run: action('previous-keyframe')},
      {label: say('timeline.nextKey'), icon: 'chevron-right', shortcut: shortcut('next-keyframe'), run: action('next-keyframe')},
      null,
      {label: say('timeline.defaultHeight'), icon: 'reset', disabled: !shell, run: () => run(defaultHeight)},
    );
    return items;
  }
  function celItems() {
    const timeline = host.timeline;
    return [
      {label: say('timeline.nextBlank'), icon: 'frame', run: () => run(() => timeline?.nextDrawing?.(true))},
      null,
      {label: say('timeline.blankDrawingHere'), icon: 'frame', shortcut: shortcut('insert-blank-key'), run: () => run(() => timeline?.drawingKeyHere?.(true))},
      {label: say('timeline.copyDrawingHere'), icon: 'duplicate', shortcut: shortcut('insert-copied-key'), run: () => run(() => timeline?.drawingKeyHere?.(false))},
      {label: say('timeline.extend'), icon: 'stretch-horizontal', shortcut: shortcut('extend-keyframe'), run: () => run(() => timeline?.extendKeyframe?.())},
    ];
  }
  let shell = null;
  /** Timeline ⋯ › Default height: the stored height is cleared, so the default applies again (the splitter's double-click). */
  function defaultHeight() {
    if (!shell?.store) return;
    shell.store.update(layout => setSharedSize(layout, 'bottom', null));
    shell.commit?.();
  }

  // ---- Go to frame (the readout's popover) ----
  let goTo = null, goField = null, goMeta = null;
  function openGoToFrame() {
    const timeline = host.timeline;
    if (!timeline) return;
    const simple = Boolean(timeline.strip);
    const total = Math.max(1, simple ? timeline.frameCount : ctx.editor.totalTicks);
    const current = simple ? (timeline.selectedIndex ?? 0) + 1 : Math.floor(ctx.editor.tick) + 1;
    const fps = ctx.editor.report.frame_delay_ms ? 1000 / ctx.editor.report.frame_delay_ms : ctx.editor.report.fps || 24;
    if (!goTo) {
      const form = element('form', null, 'tl-goto');
      const field = element('label', form, 'ui-field tl-goto-field');
      element('span', field, 'ui-field-label', say('timeline.goToFrameField'));
      goField = element('input', field, 'ui-field-input');
      Object.assign(goField, {type: 'number', min: '1', step: '1', required: true});
      goField.setAttribute('aria-label', say('timeline.goToFrame'));
      goMeta = element('span', form, 'tl-goto-meta');
      const submit = element('button', form, 'ui-button', say('timeline.goToFrameGo'));
      submit.type = 'submit';
      submit.dataset.size = 'sm';
      form.addEventListener('submit', event => {
        event.preventDefault();
        const number = Math.round(Number(goField.value));
        if (!Number.isFinite(number)) return;
        goTo.hide('submit');
        run(() => host.goToFrame(number));
      });
      goTo = createPopover({...menuOptions(), anchor: readout, placement: 'top-start', title: say('timeline.goToFrame'), body: form,
        keyboardScope: true, className: 'tl-goto-popover'});
    }
    goField.max = String(total);
    goField.value = String(current);
    setText(goMeta, say('timeline.goToFrameOf', {total, seconds: (ctx.editor.totalTicks / fps).toFixed(2)}));
    goTo.show();
    goField.select();
  }

  // ---- Tier and workspace folds (the header's buttons carry the kit's display, so it hides them itself) ----
  const first = controls.querySelector('[data-action="first-frame"]');
  const workspace = document.querySelector('.workspace');
  let oneFrame = false, simple = false;
  function syncFolds() {
    const minimal = document.documentElement.dataset.tier === 'minimal', mode = workspace?.dataset.mode;
    for (const button of [first, loop, audio]) setHidden(button, minimal);
    // Without the timeline stylesheet the header keeps today's sizes, which leave no room for Timeline ⋯ at the
    // minimal width; its rows are the Animation menu's there (Last frame, the key jumps, and the folded buttons).
    setHidden(menuButton, minimal && !styled);
    // In Simple, Edit together is the frame bar's switch (sheet-filmstrip.mjs), the same command and state.
    if (setHidden(range, simple || minimal || oneFrame || mode === 'rig' || mode === 'draw')) requestFold();
  }

  // ---- Folding ----
  let foldFrame = 0;
  function requestFold() {
    if (!foldFrame) foldFrame = requestAnimationFrame(fold);
  }
  function overflowing() { return toolbar.scrollWidth > toolbar.clientWidth + 0.5; }
  /** The fewest folded words that keep the three clusters apart (reads layout only on a resize or a change of words). */
  function fold() {
    foldFrame = 0;
    if (!toolbar.isConnected || !toolbar.clientWidth) return;
    const tier = document.documentElement.dataset.tier ?? 'wide';
    let count = 0;
    const apply = () => setAttr(toolbar, 'data-fold', headerFolds(count, {tier}).join(' ') || null);
    apply();
    while (overflowing() && count < HEADER_FOLDS.length) { count++; apply(); }
  }
  const resize = new ResizeObserver(() => requestFold());
  resize.observe(toolbar);
  // A tier change folds or restores controls without resizing the header.
  const tiers = new MutationObserver(() => { syncFolds(); requestFold(); });
  tiers.observe(document.documentElement, {attributes: true, attributeFilter: ['data-tier']});
  if (workspace) tiers.observe(workspace, {attributes: true, attributeFilter: ['data-mode']});
  syncFolds();

  function setSimple(value) { if (value !== simple) { simple = value; syncFolds(); } }

  // ---- The touch timeline's action bar (touch/timeline-scrubber.mjs): a slot of its own in the header ----
  const actionsSlot = element('div', null, 'tl-actions');
  actionsSlot.dataset.slot = 'actions';
  actionsSlot.hidden = true;
  end.before(actionsSlot);
  let actions = null;

  // ---- What the components and the host tell the header ----
  let shownCel = false, shownReady = null;
  return {
    /** The mounted timeline's action bar (the touch interface's), or null to take it away. */
    setActions(node) {
      actions = node ?? null;
      actionsSlot.replaceChildren(...(actions ? [actions] : []));
      actionsSlot.hidden = !actions;
      toolbar.toggleAttribute('data-actions', Boolean(actions));
      requestFold();
    },
    get actions() { return actions; },
    /** Add frame's and Next copy's wrapper: an audio clip's selection hides them (audio-timeline.mjs). */
    frameTools: frameWrap,
    /** The zoom range and Fit's name for the mounted component (Advanced's frames or Simple's cards). */
    mount(timeline) {
      const simple = Boolean(timeline.strip);
      const range = timeline.zoomRange ?? {min: 1, max: 36};
      setProp(zoom, 'min', String(range.min));
      setProp(zoom, 'max', String(range.max));
      this.setZoom(simple ? timeline.cardWidth : timeline.pxPerTick);
      setAttr(rulerTools, 'data-mode', simple ? 'simple' : 'advanced');
      setAttr(fit, 'aria-label', say(simple ? 'timeline.fitFilmstrip' : 'timeline.fit'));
      setAttr(fit, 'data-tooltip', simple ? say('timeline.fitFilmstrip') : say('timeline.fitTip'));
      if (simple) this.setNextCopy({shown: false});
      setSimple(simple);
      requestFold();
    },
    /** Add frame's state from the component: Blank frame on a drawing layer (Advanced), disabled on locked layers. */
    setAddFrame({blank = false, disabled = false} = {}) {
      const word = say(blank ? 'timeline.blankFrame' : 'timeline.addFrame');
      if (setText(addWord, word)) requestFold();
      setAttr(addFrame, 'aria-label', blank ? word : say('timeline.addFrameName'));
      setAttr(addFrame, 'data-hotkey-title', word);
      setProp(addFrame, 'disabled', Boolean(disabled));
    },
    /** Next copy shows on a drawing layer in Advanced, as today's Next copied drawing. */
    setNextCopy({shown = false, disabled = false} = {}) {
      setHidden(cel, !shown);
      setProp(celMain, 'disabled', Boolean(disabled));
      setProp(celMore, 'disabled', Boolean(disabled));
      if (shown !== shownCel) { shownCel = shown; requestFold(); }
    },
    /** The zoom slider follows the component's zoom (its fill too). */
    setZoom(value) {
      setProp(zoom, 'value', String(value));
      const min = Number(zoom.min) || 0, max = Number(zoom.max) || 100;
      setVar(zoom, '--_p', `${Math.round((Number(zoom.value) - min) / Math.max(1, max - min) * 1000) / 10}%`);
    },
    /** State the header shows from the app (the transport surface): Loop's pressed state. Writes nothing unchanged. */
    sync() {
      setAttr(loop, 'aria-pressed', String(Boolean(ctx.state.loop)));
    },
    /** Edit together (#range-edit): never on a one-frame file; its word shows while it applies, so the fold may change. */
    setEditTogether({oneFrame: single = false, ready = false} = {}) {
      if (single !== oneFrame) { oneFrame = single; syncFolds(); }
      if (ready !== shownReady) { shownReady = ready; requestFold(); }
    },
    /** The shell (dock-host.mjs), for Timeline ⋯ › Default height. */
    attach(value) { shell = value; },
    /** Go to frame, from the readout or a command. */
    openGoToFrame,
  };
}
