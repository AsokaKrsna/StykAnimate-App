import test from 'node:test';
import assert from 'node:assert/strict';
import {OVERLAY_KINDS, OverlayManager, overlayMount} from '../src/ui/overlay-manager.mjs';

/** A document with just what the manager reads: activeElement, body and dialog[open]. */
function fakeDocument() {
  const doc = {openDialogs: 0, focused: [], querySelector: selector => (selector === 'dialog[open]' && doc.openDialogs ? {} : null)};
  doc.element = (name, {children = []} = {}) => ({
    name, isConnected: true, disabled: false, children,
    contains(node) { return node === this || children.includes(node); },
    closest: () => null,
    focus() { doc.activeElement = this; doc.focused.push(name); },
  });
  doc.body = doc.element('body');
  doc.activeElement = doc.body;
  return doc;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(options = {}) {
  const doc = fakeDocument(), released = [], errors = [];
  const stage = doc.element('stage');
  const manager = new OverlayManager({document: doc, hotkeys: {releaseAll: () => released.push(true)}, fallbackFocus: () => stage,
    onError: error => errors.push(error), ...options});
  return {doc, manager, released, errors, stage};
}

test('menus, the palette, modal dialogs and keyboard-scoped popovers block hotkeys; the rest do not', () => {
  const {doc, manager, released} = setup(), changes = [];
  manager.addEventListener('blocking-change', event => changes.push(event.detail.blocking));
  assert.deepEqual(OVERLAY_KINDS, ['dialog', 'menu', 'popover', 'palette', 'sheet', 'toast', 'tooltip']);
  const toast = manager.register(doc.element('toast'), {kind: 'toast'});
  const popover = manager.register(doc.element('onion'), {kind: 'popover'});
  const sheet = manager.register(doc.element('sheet'), {kind: 'sheet'});
  assert.equal(manager.blocksHotkeys(), false, 'toasts, plain popovers and sheets leave typing to the editor');
  const menu = manager.register(doc.element('menu'), {kind: 'menu'});
  assert.equal(manager.blocksHotkeys(), true);
  assert.deepEqual(released, [true], 'held keys are released when typing moves to an overlay');
  menu.close();
  const scoped = manager.register(doc.element('go-to-frame'), {kind: 'popover', keyboardScope: true});
  assert.equal(manager.blocksHotkeys(), true);
  scoped.close();
  for (const kind of ['palette', 'dialog']) {
    const handle = manager.register(doc.element(kind), {kind, modal: kind === 'dialog'});
    assert.equal(manager.blocksHotkeys(), true, kind);
    handle.close();
  }
  doc.openDialogs = 1;
  assert.equal(manager.blocksHotkeys(), true, 'any open <dialog>, even one the manager does not know, still blocks');
  doc.openDialogs = 0;
  assert.deepEqual(changes, [true, false, true, false, true, false, true, false]);
  assert.equal(manager.top()?.element.name, 'sheet', 'top() skips toasts and tooltips');
  assert.equal(manager.top(['toast'])?.element.name, 'toast');
  for (const handle of [toast, popover, sheet]) handle.close();
  assert.equal(manager.list().length, 0);
  assert.throws(() => manager.register(doc.element('x'), {kind: 'drawer'}), /Unknown overlay kind/);
});

test('close guards may veto, synchronously or later', async () => {
  const {doc, manager} = setup();
  let allow = false;
  const exporting = manager.register(doc.element('export'), {kind: 'dialog', modal: true, beforeClose: reason => (reason === 'escape' ? allow : true)});
  assert.equal(await exporting.requestClose('escape'), false, '"Stop exporting?" answered no');
  assert.equal(exporting.open, true);
  const confirm = manager.register(doc.element('confirm'), {kind: 'dialog', modal: true, beforeClose: () => new Promise(resolve => setTimeout(() => resolve(false), 1))});
  assert.equal(await manager.closeAll('close-all'), false, 'closeAll stops at the first veto, top first');
  assert.equal(confirm.open, true);
  assert.equal(exporting.open, true, 'nothing below the veto closed');
  confirm.close('done');
  assert.equal(await confirm.result, 'done', 'close(value) resolves the handle');
  allow = true;
  assert.equal(await exporting.requestClose('escape'), true);
  assert.equal(await exporting.result, undefined);
  const failing = manager.register(doc.element('failing'), {kind: 'popover', beforeClose: () => { throw new Error('guard failed'); }});
  assert.equal(await failing.requestClose(), false, 'a failing guard keeps the overlay open');
  failing.close();
});

test('focus returns to the invoker, else the stage, unless the user moved it', () => {
  const {doc, manager, stage} = setup();
  const button = doc.element('file-menu-button'), item = doc.element('item');
  const menu = doc.element('menu', {children: [item]});
  button.focus();
  const handle = manager.register(menu, {kind: 'menu'});
  assert.equal(handle.invoker, button, 'the focused element is the default invoker');
  item.focus();
  handle.close();
  assert.equal(doc.activeElement, button, 'focus inside the overlay goes back to the invoker');

  const gone = doc.element('removed');
  gone.isConnected = false;
  const orphan = manager.register(menu, {kind: 'menu', invoker: gone});
  item.focus();
  orphan.close();
  assert.equal(doc.activeElement, stage, 'a removed invoker falls back to the stage');

  const other = doc.element('timeline');
  const popover = manager.register(menu, {kind: 'popover', invoker: button});
  other.focus();
  popover.close();
  assert.equal(doc.activeElement, other, 'a click elsewhere keeps its focus');

  item.focus();
  manager.register(menu, {kind: 'menu', invoker: button, returnFocus: false}).close();
  assert.equal(doc.activeElement, item, 'returnFocus: false leaves focus alone');
});

test('onClose hides the overlay once, the handle signal aborts and an outer signal closes it', () => {
  const {doc, manager} = setup(), closed = [];
  const outer = new AbortController();
  const handle = manager.register(doc.element('sheet'), {kind: 'sheet', signal: outer.signal, onClose: (value, reason) => closed.push(reason)});
  let aborted = false;
  handle.signal.addEventListener('abort', () => { aborted = true; });
  outer.abort();
  handle.close();
  assert.deepEqual(closed, ['abort']);
  assert.equal(aborted, true);
  assert.equal(manager.handleFor(handle.element), null);
});

test('startup prompts open one at a time after the first frame, by priority, never over a blocking overlay', async () => {
  const {doc, manager} = setup(), opened = [], finish = {};
  const prompt = (id, priority, extra = {}) => manager.enqueuePrompt({id, priority, ...extra,
    open: () => { opened.push(id); return new Promise(resolve => { finish[id] = resolve; }); }});
  assert.equal(prompt('release-notes', 3), true);
  assert.equal(prompt('privacy', 2), true);
  assert.equal(prompt('release-notes', 3), false, 'one entry per prompt id');
  let updateReady = false;
  prompt('update', 1, {ready: () => updateReady});
  prompt('hint', 0);
  await settle();
  assert.deepEqual(opened, [], 'nothing opens before the first rendered frame');

  const menu = manager.register(doc.element('menu'), {kind: 'menu'});
  manager.markReady();
  await settle();
  assert.deepEqual(opened, [], 'an open menu holds the queue');
  menu.close();
  await settle();
  assert.deepEqual(opened, ['release-notes'], 'release notes first, then the privacy first run');
  assert.equal(manager.activePrompt, 'release-notes');
  assert.equal(manager.pumpPrompts(), null, 'one prompt at a time');
  finish['release-notes']();
  await settle();
  assert.deepEqual(opened, ['release-notes', 'privacy']);
  finish.privacy();
  await settle();
  assert.deepEqual(opened, ['release-notes', 'privacy', 'hint'], 'a prompt that is not ready waits; lower ones go ahead');
  assert.deepEqual(manager.pendingPrompts(), ['update']);
  updateReady = true;
  finish.hint();
  await settle();
  assert.deepEqual(opened, ['release-notes', 'privacy', 'hint', 'update']);
  finish.update();
  await settle();
  assert.equal(manager.activePrompt, null);
});

test('a failing prompt does not stall the queue; prompts can be cancelled', async () => {
  const {manager, errors} = setup(), opened = [];
  manager.enqueuePrompt({id: 'broken', priority: 2, open: () => { throw new Error('no splash'); }});
  manager.enqueuePrompt({id: 'rejected', priority: 1, open: () => Promise.reject(new Error('closed early'))});
  manager.enqueuePrompt({id: 'cancelled', priority: 0, open: () => opened.push('cancelled')});
  manager.enqueuePrompt({id: 'last', priority: -1, open: () => { opened.push('last'); }});
  assert.equal(manager.cancelPrompt('cancelled'), true);
  assert.equal(manager.cancelPrompt('cancelled'), false);
  manager.markReady();
  for (let i = 0; i < 4; i++) await settle();
  assert.deepEqual(opened, ['last']);
  assert.deepEqual(errors.map(error => error.message), ['no splash', 'closed early']);
});

test('overlays opened from inside a modal dialog or an open popover mount in it', () => {
  const host = {}, body = {}, queried = [];
  const inside = {closest: selector => { queried.push(selector); return host; }, ownerDocument: {body}};
  const outside = {closest: () => null, ownerDocument: {body}};
  assert.equal(overlayMount(inside), host);
  assert.deepEqual(queried, ['dialog[open], [popover]:popover-open'], 'the nearest open dialog or popover');
  assert.equal(overlayMount(outside), body);
  assert.equal(overlayMount(null, {body}), body);
  const older = {closest: selector => { if (selector.includes(':popover-open')) throw new SyntaxError('unknown pseudo-class'); return host; }, ownerDocument: {body}};
  assert.equal(overlayMount(older), host, 'without :popover-open support the dialog rule still holds');
});
