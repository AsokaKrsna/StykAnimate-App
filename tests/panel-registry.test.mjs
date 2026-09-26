/**
 * The panel registry (src/shell/panel-registry.mjs): descriptors, late roots,
 * visibility with onVisibility callbacks, and the constraint data the layout
 * schema and solver read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PANEL_CATALOG, createPanelRegistry, normalizePanelDescriptor, panelCanHide, panelInMode} from '../src/shell/panel-registry.mjs';
import {defaultLayout} from '../src/shell/layout-schema.mjs';
import {solveLayout} from '../src/shell/layout-solver.mjs';

test('the catalogue describes today\'s panels with their limits and places', () => {
  assert.deepEqual(PANEL_CATALOG.map(panel => [panel.id, panel.docks, panel.floatable, panel.min, panel.pref, panel.max]), [
    ['properties', ['right', 'left'], false, 256, 288, 360],
    ['vfx', ['right', 'left'], true, 256, 288, 360],
    ['library', ['right', 'left'], true, 256, 288, 420],
    ['structure', ['left', 'right'], false, 200, 232, 360],
    ['timeline', ['bottom'], false, 120, null, null],
  ]);
  const byId = Object.fromEntries(PANEL_CATALOG.map(panel => [panel.id, panel]));
  assert.equal(panelInMode(byId.structure, 'rig'), true);
  assert.equal(panelInMode(byId.structure, 'animate'), false);
  assert.equal(panelCanHide(byId.timeline, 'rig'), true);
  assert.equal(panelCanHide(byId.timeline, 'draw'), false);
  assert.equal(panelCanHide(byId.properties, 'animate'), true);
  assert.equal(byId.timeline.maxFraction, 0.6);
  assert.equal(byId.structure.stageMin, 400);
  assert.ok(Object.isFrozen(PANEL_CATALOG) && PANEL_CATALOG.every(Object.isFrozen));
});

test('descriptors are validated', () => {
  for (const bad of [null, {}, {id: 'Bad'}, {id: 'x'}, {id: 'x', docks: ['top']}, {id: 'x', docks: ['left'], modes: ['studio']}]) {
    assert.throws(() => normalizePanelDescriptor(bad), TypeError, JSON.stringify(bad));
  }
  const panel = normalizePanelDescriptor({id: 'notes', regions: ['left', 'left'], min: 300, pref: 100, max: 200, canHide: ['draw', 'nope']});
  assert.deepEqual([panel.docks, panel.min, panel.pref, panel.max, panel.canHide, panel.floatable], [['left'], 300, 300, 300, ['draw'], false]);
});

test('late roots complete a catalogue panel and re-announce it', () => {
  const registry = createPanelRegistry();
  const defined = [];
  registry.on('define', event => defined.push(event.id));
  const before = registry.constraints();
  assert.equal(registry.root('library'), null);
  const root = {id: 'user-library'};
  const descriptor = registry.define({id: 'library', root: () => root});
  assert.equal(registry.root('library'), root);
  assert.equal(descriptor.max, 420, 'the catalogue limits are kept');
  assert.deepEqual(defined, ['library']);
  assert.notEqual(registry.constraints(), before, 'the constraint snapshot is rebuilt');
  assert.equal(registry.constraints(), registry.constraints());
  // A new panel is solved like any other.
  registry.define({id: 'notes', title: 'Notes', docks: ['left'], min: 220, pref: 240, max: 320, modes: ['animate']});
  assert.deepEqual(registry.list({mode: 'rig'}).map(panel => panel.id), ['properties', 'vfx', 'library', 'structure', 'timeline']);
  const solution = solveLayout(defaultLayout(), {width: 1440, height: 900, mode: 'animate', panels: registry.constraints()});
  assert.equal(solution.panels.notes.presentation, 'docked');
  assert.equal(solution.regions.left.size, 232);
  assert.throws(() => registry.define(null), TypeError);
  assert.throws(() => registry.on('nope', () => {}), TypeError);
});

test('visibility changes call onVisibility once per change', () => {
  const registry = createPanelRegistry();
  const calls = [];
  registry.define({id: 'vfx', onVisibility: (visible, id) => calls.push(['descriptor', id, visible])});
  const controller = new AbortController();
  registry.onVisibility('vfx', visible => calls.push(['watcher', visible]), {signal: controller.signal});
  const events = [];
  registry.on('visibility', event => events.push(event.changed));
  assert.equal(registry.isVisible('vfx'), false);
  assert.deepEqual(registry.setVisibility({vfx: true, properties: true, nothing: true}), ['vfx', 'properties']);
  assert.deepEqual(registry.setVisibility('vfx', true), []);
  controller.abort();
  registry.setVisibility('vfx', false);
  assert.deepEqual(calls, [['descriptor', 'vfx', true], ['watcher', true], ['descriptor', 'vfx', false]]);
  assert.deepEqual(events, [['vfx', 'properties'], ['vfx']]);
  // A failing callback does not stop the others.
  const reported = [];
  const original = globalThis.reportError;
  globalThis.reportError = error => reported.push(error.message);
  try {
    registry.onVisibility('library', () => { throw new Error('boom'); });
    registry.onVisibility('library', visible => calls.push(['after', visible]));
    registry.setVisibility('library', true);
  } finally {
    globalThis.reportError = original;
  }
  assert.deepEqual(reported, ['boom']);
  assert.deepEqual(calls.at(-1), ['after', true]);
});

test('a solution drives visibility; activate asks the dock host', () => {
  const registry = createPanelRegistry();
  const solution = solveLayout(defaultLayout(), {width: 1440, height: 900, mode: 'animate'});
  assert.deepEqual(registry.applySolution(solution).sort(), ['properties', 'timeline']);
  assert.equal(registry.isVisible('vfx'), false);
  const low = solveLayout(defaultLayout(), {width: 1440, height: 500, mode: 'animate'});
  assert.deepEqual(registry.applySolution(low), ['timeline']);
  const activated = [];
  registry.on('activate', event => activated.push(event.id));
  assert.equal(registry.activate('library'), true);
  assert.equal(registry.activate('nothing'), false);
  assert.deepEqual(activated, ['library']);
});
