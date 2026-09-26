/**
 * Stored workspace layouts (src/shell/layout-schema.mjs): migration from
 * 1.1's studio layout and the earlier splitter layout, the downgrade round
 * trip, normalization, presets, saved layouts and the size budget. Ports the
 * preference cases of tests/studio-layout.test.mjs and
 * tests/workspace-layout.test.mjs to schema v2.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRESETS, LAYOUT_BUDGET_BYTES, LAYOUT_FILE_LIMIT_BYTES, MAX_SAVED_LAYOUTS, TOMBSTONE_TTL_MS,
  activatePanel, applyPreset, canPlacePanel, canSavePreset, cleanLayoutName, defaultArrangement, defaultLayout,
  deletePreset, fitBudget, isFutureLayout, layoutBytes, migrateLayout, movePanel, normalizeArrangement,
  normalizeLayout, presetArrangement, presetsFor, renamePreset, resetLayout, resetMode, sameArrangement,
  savePreset, serializeLayout, setSharedSize, toggleFocus, updatePreset,
} from '../src/shell/layout-schema.mjs';
import {constrainStudioLayout} from '../src/studio-layout.mjs';
import {PANEL_CATALOG, normalizePanelDescriptor} from '../src/shell/panel-registry.mjs';

const NOW = 1_700_000_100_000;
const at = {now: NOW};

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
const records = arrangement => Object.fromEntries(arrangement.panels.map(record => [record.id, record]));
const place = (arrangement, id) => {
  const record = records(arrangement)[id];
  return record && `${record.dock}${record.dock === record.side ? '' : `@${record.side}`}`;
};

// Frozen fixtures: what 1.1 writes, what the splitter layout before it wrote, and a v2 file.
const V1_UNTOUCHED = deepFreeze({studioVersion: 1, right: 310, timeline: 280});
const V1_CUSTOM = deepFreeze({studioVersion: 1, right: 330, timeline: 236});
const LEGACY = deepFreeze({left: 310, right: 300, timeline: 250, source: 'kept', floating: {left: {x: 25, y: 48, width: 330, height: 440}}});
const FIGHT_PANELS = [
  {id: 'library', dock: 'left', order: 0},
  {id: 'properties', dock: 'right', order: 0},
  {id: 'vfx', dock: 'float', side: 'right', order: 1, rect: {x: 40, y: 30, w: 280, h: 360}},
  {id: 'timeline', dock: 'bottom', order: 0},
];
const V2 = deepFreeze({
  studioVersion: 1, right: 300, timeline: 260,
  layoutVersion: 2,
  shared: {stamp: 1_700_000_000_000, sizes: {right: 300, bottom: 260, structure: 250, audioRows: 3}, later: true},
  modes: {
    animate: {stamp: 1_700_000_000_100, preset: 'user:u1', rail: 'left', bottomSpan: 'full', panels: FIGHT_PANELS, zoomMemory: 2},
    draw: {stamp: 0, preset: 'draw'},
    rig: {stamp: 5, preset: 'build-timeline'},
    camera: {stamp: 9, preset: 'camera'},
  },
  saved: [{id: 'u1', name: 'Fight setup', mode: 'animate', stamp: 1_700_000_000_050, arrangement: {rail: 'left', bottomSpan: 'full', panels: FIGHT_PANELS}, colour: 'blue'}],
  tombstones: [{id: 'u0', stamp: 1_700_000_000_010}],
  futureKey: {hello: 'world'},
});

test('a v1 studio layout becomes v2 with its sizes; the untouched 280px timeline means the default height', () => {
  const untouched = migrateLayout(V1_UNTOUCHED, at);
  assert.equal(untouched.source, 'v1');
  assert.equal(untouched.readOnly, false);
  assert.deepEqual(untouched.layout.shared.sizes, {right: 310});
  const custom = migrateLayout(V1_CUSTOM, at).layout;
  assert.deepEqual(custom.shared.sizes, {right: 330, bottom: 236});
  for (const mode of ['animate', 'draw', 'rig']) {
    assert.equal(custom.modes[mode].preset, DEFAULT_PRESETS[mode]);
    assert.ok(sameArrangement(custom.modes[mode], defaultArrangement(mode)));
  }
  // A v1 inspector narrower than the v2 panels allow is clamped, never stored below their minimum.
  assert.equal(migrateLayout({studioVersion: 1, right: 230}, at).layout.shared.sizes.right, 256);
});

test('the earlier splitter layout keeps its sizes and drops its floating docks', () => {
  const {layout, source} = migrateLayout(LEGACY, at);
  assert.equal(source, 'legacy');
  assert.deepEqual(layout.shared.sizes, {left: 310, right: 300, bottom: 250});
  assert.equal('floating' in layout, false);
  assert.equal(layout.source, 'kept');
  assert.equal(place(layout.modes.animate, 'properties'), 'right');
  // Old sidebar and floating preferences cannot consume the stage: nothing is docked left.
  assert.ok(layout.modes.animate.panels.every(record => record.dock !== 'left'));
});

test('the editor setting builderOutlinerWidth seeds the Structure width once', () => {
  const legacy = {builderOutlinerWidth: 300};
  assert.equal(migrateLayout(V1_CUSTOM, {...at, legacy}).layout.shared.sizes.structure, 300);
  assert.equal(migrateLayout(null, {...at, legacy}).layout.shared.sizes.structure, 300);
  assert.equal(migrateLayout(V1_CUSTOM, {...at, legacy: {builderOutlinerWidth: 236}}).layout.shared.sizes.structure, undefined);
  assert.equal(migrateLayout(V1_CUSTOM, {...at, legacy: {builderOutlinerWidth: 900}}).layout.shared.sizes.structure, 360);
  // Once the file is v2 the stored width wins.
  assert.equal(migrateLayout(V2, {...at, legacy}).layout.shared.sizes.structure, 250);
});

test('v2 keys survive 1.1 reading the file and writing {...loaded, studioVersion: 1} back', () => {
  const written = serializeLayout(migrateLayout(V2, at).layout, at);
  // 1.1 reads the mirror as its v1 layout.
  assert.equal(written.studioVersion, 1);
  assert.deepEqual(constrainStudioLayout(written, 1440, 900), {right: 300, timeline: 260});
  // 1.1's persist() after the user drags its inspector and timeline.
  const replayed = {...written, right: 344, timeline: 300, studioVersion: 1};
  for (const key of ['layoutVersion', 'shared', 'modes', 'saved', 'tombstones', 'futureKey']) assert.deepEqual(replayed[key], written[key], key);
  const {layout, source} = migrateLayout(replayed, at);
  assert.equal(source, 'v2');
  assert.deepEqual(layout.shared.sizes, {right: 344, bottom: 300, structure: 250, audioRows: 3});
  assert.equal(layout.shared.stamp, V2.shared.stamp + 1, 'a mirror change wins merges');
  assert.equal(place(layout.modes.animate, 'library'), 'left');
  assert.equal(place(layout.modes.animate, 'vfx'), 'float@right');
  assert.deepEqual(records(layout.modes.animate).vfx.rect, {x: 40, y: 30, w: 280, h: 360});
  assert.equal(layout.saved[0].name, 'Fight setup');
  assert.deepEqual(layout.tombstones, [{id: 'u0', stamp: 1_700_000_000_010}]);
  assert.deepEqual(layout.futureKey, {hello: 'world'});
  assert.equal(layout.modes.animate.zoomMemory, 2);
  assert.deepEqual(layout.modes.camera, {stamp: 9, preset: 'camera'});
  assert.equal(layout.shared.later, true);
  assert.equal(layout.saved[0].colour, 'blue');
  // 1.1's splitter double-click deletes its key: the default comes back.
  const {timeline, ...reset} = replayed;
  assert.equal(migrateLayout(reset, at).layout.shared.sizes.bottom, undefined);
  // An unchanged mirror changes nothing.
  assert.equal(migrateLayout(written, at).layout.shared.stamp, V2.shared.stamp);
});

test('a layout from a newer version is used read-only with presets and left as it is', () => {
  const future = deepFreeze({...V2, layoutVersion: 3, modes: {animate: {something: 'new'}}});
  assert.equal(isFutureLayout(future), true);
  assert.equal(isFutureLayout(V2), false);
  const result = migrateLayout(future, at);
  assert.equal(result.source, 'future');
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.layout, defaultLayout(at));
});

test('invalid stored layouts do not prevent the editor from opening', () => {
  const defaults = defaultLayout(at);
  for (const value of [null, undefined, 'invalid', 42, [], {layoutVersion: 'two', modes: 5, shared: 'x'},
    {right: 'bad', timeline: 'bad', studioVersion: 1}, {layoutVersion: 2, modes: {animate: {panels: 'x', rail: 3}}, saved: 'x', shared: {sizes: []}}]) {
    const {layout} = migrateLayout(value, at);
    assert.deepEqual(layout.modes, defaults.modes, JSON.stringify(value));
    assert.deepEqual(layout.shared.sizes, {}, JSON.stringify(value));
    assert.deepEqual(layout.saved, []);
  }
  assert.equal(migrateLayout('invalid', at).source, 'invalid');
  assert.equal(migrateLayout({layoutVersion: 1.5}, at).source, 'invalid');
  assert.equal(migrateLayout(undefined, at).source, 'empty');
  assert.equal(migrateLayout({}, at).source, 'empty');
});

test('normalization keeps every panel in a place it allows', () => {
  const arrangement = normalizeArrangement({panels: [
    {id: 'timeline', dock: 'left', order: 0},
    {id: 'properties', dock: 'float', order: 4},
    {id: 'vfx', dock: 'float', side: 'left'},
    {id: 'library', dock: 'float'},
    {id: 'structure', dock: 'left'},
    {id: 'vfx', dock: 'right'},
  ]}, 'animate');
  assert.equal(place(arrangement, 'timeline'), 'bottom');
  assert.equal(place(arrangement, 'properties'), 'right', 'Properties never floats');
  assert.equal(place(arrangement, 'vfx'), 'float@left', 'the first record of an id wins');
  assert.equal(place(arrangement, 'library'), 'float@right');
  assert.equal(records(arrangement).structure, undefined, 'Structure exists only in Build');
  // A third floating panel docks back on its side.
  const catalog = [...PANEL_CATALOG, normalizePanelDescriptor({id: 'notes', docks: ['right'], floatable: true, min: 200, pref: 240, max: 300})];
  const three = normalizeArrangement({panels: ['vfx', 'library', 'notes'].map(id => ({id, dock: 'float'}))}, 'animate', {catalog});
  assert.deepEqual(three.panels.filter(record => record.dock === 'float').map(record => record.id), ['vfx', 'library']);
  assert.equal(place(three, 'notes'), 'right');
  // The timeline may be Hidden only in Build, where it is the default.
  assert.equal(place(normalizeArrangement({panels: [{id: 'timeline', dock: 'hidden'}]}, 'animate'), 'timeline'), 'strip@bottom');
  assert.equal(place(normalizeArrangement({panels: [{id: 'timeline', dock: 'hidden'}]}, 'rig'), 'timeline'), 'hidden@bottom');
  assert.equal(place(normalizeArrangement({}, 'rig'), 'timeline'), 'hidden@bottom');
  // Missing panels come back in the default preset's place; tab orders are consecutive; one active tab per island.
  const partial = normalizeArrangement({panels: [{id: 'library', dock: 'right', order: 7, active: true}, {id: 'vfx', dock: 'right', order: 3, active: true}]}, 'animate');
  assert.deepEqual(partial.panels.filter(record => record.side === 'right').map(record => [record.id, record.order, record.active ?? false]),
    [['properties', 0, false], ['vfx', 1, true], ['library', 2, false]]);
  assert.equal(place(partial, 'timeline'), 'bottom');
  const build = normalizeArrangement({panels: []}, 'build');
  assert.equal(place(build, 'structure'), 'left');
});

test('records of panels this version does not know are kept but bounded', () => {
  const arrangement = normalizeArrangement({panels: [
    {id: 'audio-mixer', dock: 'left', order: 1, extra: {deep: true}},
    {id: 'Bad Id', dock: 'left'},
    {id: 'notes', dock: 'nowhere'},
    ...Array.from({length: 12}, (_, index) => ({id: `extra-${index}`, dock: 'right'})),
  ]}, 'animate');
  const unknown = arrangement.panels.filter(record => !['properties', 'vfx', 'library', 'timeline'].includes(record.id));
  assert.equal(unknown[0].id, 'audio-mixer');
  assert.deepEqual(unknown[0].extra, {deep: true});
  assert.equal(unknown.length, 8);
  assert.ok(!unknown.some(record => record.id === 'Bad Id' || record.id === 'notes'));
  // Built-in presets never carry them.
  assert.equal(presetArrangement('animate', 'animate').panels.length, 4);
});

test('shared sizes are clamped integers; non-finite values fall back to the default', () => {
  const layout = normalizeLayout({shared: {sizes: {right: 99999.7, left: 10, bottom: 'x', structure: 250.4, timelineLabels: -5, audioRows: 3.6, top: Infinity, __proto__: 1}}}, at);
  assert.deepEqual(layout.shared.sizes, {right: 420, left: 256, structure: 250, timelineLabels: 140, audioRows: 4});
  assert.equal(Object.getPrototypeOf(layout.shared.sizes), Object.prototype);
  assert.deepEqual(setSharedSize(layout, 'bottom', 333.3, at).shared.sizes.bottom, 333);
  assert.equal(setSharedSize(layout, 'right', null, at).shared.sizes.right, undefined);
});

test('normalization is idempotent and never mutates its input', () => {
  const input = deepFreeze(structuredClone(V2));
  const once = normalizeLayout(input, at);
  assert.deepEqual(normalizeLayout(once, at), once);
  assert.deepEqual(normalizeLayout(serializeLayout(once, at), at), once);
  assert.deepEqual(input, V2);
  once.shared.sizes.right = 1;
  assert.equal(V2.shared.sizes.right, 300);
  // Nested unknown data keeps its depth through a save (the preferences file allows 16 levels).
  const deep = {a: {b: {c: {d: {e: {f: {g: {h: {i: {j: 1}}}}}}}}}};
  assert.deepEqual(serializeLayout(normalizeLayout({deep}, at), at).deep, deep);
  assert.equal(normalizeLayout({fn: () => 1, date: new Date(0), nan: NaN, list: [1, undefined, Infinity, 'x']}, at).list.length, 2);
});

test('each workspace offers its presets; Build keeps Structure left and the timeline hidden', () => {
  assert.deepEqual(presetsFor('animate').map(preset => preset.id), ['animate', 'timing', 'focus', 'review']);
  assert.deepEqual(presetsFor('draw').map(preset => preset.id), ['focus', 'draw']);
  assert.deepEqual(presetsFor('build').map(preset => preset.id), ['focus', 'build', 'build-timeline']);
  const animate = defaultArrangement('animate');
  assert.deepEqual(animate.panels.map(record => [record.id, record.dock, record.order, record.active ?? false]),
    [['properties', 'right', 0, true], ['vfx', 'right', 1, false], ['library', 'right', 2, false], ['timeline', 'bottom', 0, true]]);
  assert.equal(animate.rail, 'left');
  assert.equal(animate.bottomSpan, 'full');
  assert.ok(sameArrangement(defaultArrangement('draw'), animate));
  const build = defaultArrangement('rig');
  assert.equal(place(build, 'structure'), 'left');
  assert.equal(place(build, 'timeline'), 'hidden@bottom');
  assert.equal(place(presetArrangement('build-timeline', 'rig'), 'timeline'), 'bottom');
  const review = presetArrangement('review', 'animate');
  assert.deepEqual(['properties', 'vfx', 'library', 'timeline'].map(id => place(review, id)), ['hidden@right', 'hidden@right', 'hidden@right', 'strip@bottom']);
  assert.equal(presetArrangement('timing', 'draw'), null, 'Timing belongs to Animate');
  assert.equal(presetArrangement('focus', 'animate'), null, 'Focus is a toggle');
});

test('Timing writes 40% of the workspace to the one shared timeline height', () => {
  const layout = defaultLayout(at);
  const timing = applyPreset(layout, 'animate', 'timing', {...at, workspaceHeight: 856});
  assert.equal(timing.shared.sizes.bottom, 342);
  assert.equal(timing.modes.animate.preset, 'timing');
  assert.deepEqual(['properties', 'vfx', 'library'].map(id => place(timing.modes.animate, id)), ['right', 'strip@right', 'strip@right']);
  assert.deepEqual(timing.modes.draw, layout.modes.draw, 'other workspaces keep their arrangement');
  assert.equal(applyPreset(layout, 'draw', 'timing', at), layout, 'a preset of another workspace is ignored');
  assert.equal(applyPreset(layout, 'animate', 'nothing', at), layout);
  assert.throws(() => applyPreset(layout, 'studio', 'animate', at), TypeError);
  const back = applyPreset(timing, 'animate', 'animate', at);
  assert.ok(sameArrangement(back.modes.animate, defaultArrangement('animate')));
  assert.equal(back.shared.sizes.bottom, 342, 'the height is the user\'s until reset');
});

test('Focus folds docked and floating panels to strips and restores them', () => {
  const layout = normalizeLayout(V2, at);
  const focused = toggleFocus(layout, 'animate', at);
  const arrangement = focused.modes.animate;
  assert.deepEqual(['library', 'properties', 'vfx', 'timeline'].map(id => place(arrangement, id)), ['strip@left', 'strip@right', 'strip@right', 'strip@bottom']);
  assert.ok(sameArrangement(arrangement.focus, layout.modes.animate));
  assert.equal(toggleFocus(focused, 'animate', {...at, on: true}), focused);
  assert.deepEqual(applyPreset(layout, 'animate', 'focus', at), focused);
  // Focus survives a restart.
  assert.deepEqual(migrateLayout(serializeLayout(focused, at), at).layout.modes.animate, arrangement);
  const restored = toggleFocus(focused, 'animate', at).modes.animate;
  assert.ok(sameArrangement(restored, layout.modes.animate));
  assert.equal(restored.focus, null);
  // Build's timeline folds when shown and stays hidden when hidden.
  assert.equal(place(toggleFocus(layout, 'rig', at).modes.rig, 'timeline'), 'strip@bottom');
  assert.equal(place(toggleFocus(defaultLayout(at), 'rig', at).modes.rig, 'timeline'), 'hidden@bottom');
});

test('serialization writes the v1 mirror, compacts preset arrangements and stays JSON', () => {
  const defaults = serializeLayout(defaultLayout(at), at);
  assert.deepEqual(defaults, {studioVersion: 1, layoutVersion: 2, shared: {stamp: 0, sizes: {}},
    modes: {animate: {stamp: 0, preset: 'animate'}, draw: {stamp: 0, preset: 'draw'}, rig: {stamp: 0, preset: 'build'}}, saved: [], tombstones: []});
  const sized = serializeLayout(setSharedSize(defaultLayout(at), 'bottom', 300, at), at);
  assert.equal(sized.timeline, 300);
  assert.equal('right' in sized, false, 'a default size is not mirrored, so 1.1 keeps its own default');
  const moved = serializeLayout(normalizeLayout(V2, at), at);
  assert.deepEqual(moved.modes.animate.panels[0], {id: 'library', dock: 'left', order: 0, active: true});
  assert.deepEqual(moved.modes.animate.panels.find(record => record.id === 'vfx'), {id: 'vfx', dock: 'float', side: 'right', order: 1, rect: {x: 40, y: 30, w: 280, h: 360}});
  assert.deepEqual(moved.modes.rig, {stamp: 5, preset: 'build-timeline'});
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(moved))), JSON.stringify(moved));
  assert.ok(layoutBytes(moved) < 2048, `${layoutBytes(moved)} bytes`);
});

test('saved layouts: eight at most, clean names, rename, update and delete with a tombstone', () => {
  let layout = defaultLayout(at);
  assert.deepEqual(savePreset(layout, {name: '   ', mode: 'animate', ...at}).error, 'name');
  const first = savePreset(layout, {name: '  Fight\n setup  ', mode: 'animate', ...at});
  assert.equal(first.error, undefined);
  layout = first.layout;
  assert.equal(layout.saved[0].name, 'Fight setup');
  assert.equal(layout.saved[0].mode, 'animate');
  assert.equal(layout.modes.animate.preset, `user:${first.id}`);
  assert.equal(cleanLayoutName('x'.repeat(80)).length, 48);
  for (let index = 1; index < MAX_SAVED_LAYOUTS; index++) layout = savePreset(layout, {name: `Layout ${index}`, mode: 'draw', now: NOW + index}).layout;
  assert.equal(layout.saved.length, 8);
  assert.deepEqual(canSavePreset(layout, 'animate', at), {ok: false, reason: 'limit'});
  assert.equal(savePreset(layout, {name: 'Ninth', mode: 'animate', ...at}).error, 'limit');
  assert.equal(new Set(layout.saved.map(item => item.id)).size, 8);
  // Rename, update from the workspace, apply.
  const renamed = renamePreset(layout, first.id, 'Kick', at).layout;
  assert.equal(renamed.saved[0].name, 'Kick');
  assert.equal(renamePreset(layout, 'u404', 'x', at).error, 'missing');
  const docked = {...renamed, modes: {...renamed.modes, animate: {...renamed.modes.animate, ...movePanel(renamed.modes.animate, 'library', 'left', {mode: 'animate'})}}};
  const updated = updatePreset(docked, first.id, at).layout;
  assert.equal(place(updated.saved[0].arrangement, 'library'), 'left');
  const reset = resetMode(updated, 'animate', at);
  assert.equal(place(applyPreset(reset, 'animate', `user:${first.id}`, at).modes.animate, 'library'), 'left');
  // Delete leaves a tombstone; the workspace keeps its arrangement.
  const deleted = deletePreset(updated, first.id, {now: NOW + 100});
  assert.equal(deleted.saved.length, 7);
  assert.deepEqual(deleted.tombstones.find(item => item.id === first.id), {id: first.id, stamp: NOW + 100});
  assert.equal(deleted.modes.animate.preset, 'animate');
  assert.equal(place(deleted.modes.animate, 'library'), 'left');
  assert.deepEqual(canSavePreset(deleted, 'animate', at), {ok: true});
  // An older copy of a deleted layout does not come back.
  assert.equal(normalizeLayout({...deleted, saved: [...deleted.saved, updated.saved[0]]}, at).saved.length, 7);
});

test('saved layouts are capped and tombstones expire after 30 days', () => {
  const saved = Array.from({length: 11}, (_, index) => ({id: `u${index}`, name: `L${index}`, mode: 'animate', stamp: index}));
  const tombstones = [
    ...Array.from({length: 20}, (_, index) => ({id: `ut${index}`, stamp: NOW - index})),
    {id: 'uold', stamp: NOW - TOMBSTONE_TTL_MS - 1},
  ];
  const layout = normalizeLayout({saved: [...saved, {id: 'bad id', name: 'x', mode: 'animate'}, {id: 'u99', name: '', mode: 'animate'}], tombstones}, at);
  assert.deepEqual(layout.saved.map(item => item.id), ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7']);
  assert.equal(layout.tombstones.length, 16);
  assert.ok(!layout.tombstones.some(item => item.id === 'uold'));
  assert.equal(layout.tombstones[0].id, 'ut0', 'the newest are kept');
});

test('a layout that would pass the budget cannot be saved as a preset', () => {
  const base = layoutBytes(serializeLayout(defaultLayout(at), at));
  const bulky = normalizeLayout({padding: 'x'.repeat(LAYOUT_BUDGET_BYTES - base - 300)}, at);
  assert.ok(layoutBytes(serializeLayout(bulky, at)) <= LAYOUT_BUDGET_BYTES);
  assert.deepEqual(canSavePreset(bulky, 'animate', at), {ok: false, reason: 'budget'});
  assert.equal(savePreset(bulky, {name: 'Big', mode: 'animate', ...at}).error, 'budget');
});

test('trimming keeps a stored layout under the file limit, losing the least first', () => {
  const layout = normalizeLayout({...structuredClone(V2), tombstones: Array.from({length: 16}, (_, index) => ({id: `ut${index}`, stamp: NOW - index}))}, at);
  const small = fitBudget(serializeLayout(layout, at));
  assert.deepEqual(small.trimmed, []);
  assert.equal(small.ok, true);
  // Over the soft budget only tombstones go.
  const soft = fitBudget(serializeLayout({...layout, note: 'x'.repeat(LAYOUT_BUDGET_BYTES)}, at));
  assert.deepEqual(soft.trimmed, ['tombstones']);
  assert.ok(soft.bytes <= LAYOUT_FILE_LIMIT_BYTES);
  assert.equal(soft.value.saved.length, 1);
  // Over the file limit: focus snapshots, then old saved layouts, then the largest unknown keys.
  const focused = toggleFocus(layout, 'animate', at);
  const hard = fitBudget(serializeLayout({...focused, huge: 'y'.repeat(LAYOUT_FILE_LIMIT_BYTES), small: 1}, at));
  assert.equal(hard.ok, true);
  assert.ok(hard.bytes <= LAYOUT_FILE_LIMIT_BYTES);
  assert.deepEqual(hard.trimmed, ['tombstones', 'focus', 'saved:u1', 'key:huge']);
  assert.equal(hard.value.small, 1);
  assert.equal(hard.value.layoutVersion, 2);
  assert.equal(hard.value.studioVersion, 1);
});

test('moving panels follows each panel\'s allowed places', () => {
  const animate = defaultArrangement('animate');
  const left = movePanel(animate, 'library', 'left', {mode: 'animate'});
  assert.equal(place(left, 'library'), 'left');
  assert.equal(records(left).library.active, true);
  assert.equal(records(left).properties.active, true, 'Properties stays the right island\'s tab');
  const tab = movePanel(left, 'vfx', 'left', {mode: 'animate', index: 0});
  assert.deepEqual(tab.panels.filter(record => record.dock === 'left').map(record => [record.id, record.active ?? false]), [['vfx', true], ['library', false]]);
  assert.deepEqual(activatePanel(tab, 'library', {mode: 'animate'}).panels.filter(record => record.dock === 'left').map(record => record.active ?? false), [false, true]);
  const floated = movePanel(animate, 'vfx', 'float', {mode: 'animate', rect: {x: 1, y: 2, w: 300, h: 400}});
  assert.deepEqual(records(floated).vfx.rect, {x: 1, y: 2, w: 300, h: 400});
  assert.equal(place(floated, 'vfx'), 'float@right');
  const docked = movePanel(floated, 'vfx', 'docked', {mode: 'animate'});
  assert.equal(place(docked, 'vfx'), 'right');
  assert.equal(records(docked).vfx.active, true);
  // Refused moves return the arrangement unchanged.
  assert.equal(movePanel(animate, 'timeline', 'left', {mode: 'animate'}), animate);
  assert.equal(movePanel(animate, 'timeline', 'hidden', {mode: 'animate'}), animate);
  assert.equal(movePanel(animate, 'properties', 'float', {mode: 'animate'}), animate);
  assert.equal(movePanel(animate, 'structure', 'left', {mode: 'animate'}), animate);
  assert.throws(() => movePanel(animate, 'vfx', 'left', {}), TypeError, 'the workspace is required');
  assert.deepEqual(['left', 'right', 'bottom', 'float', 'strip', 'hidden'].filter(target => canPlacePanel('library', target, {mode: 'animate'})), ['left', 'right', 'float', 'strip', 'hidden']);
  assert.deepEqual(['left', 'right', 'bottom', 'float', 'strip', 'hidden'].filter(target => canPlacePanel('timeline', target, {mode: 'rig'})), ['bottom', 'strip', 'hidden']);
  assert.equal(canPlacePanel('library', 'left', {mode: 'nowhere'}), false);
});

test('reset returns workspaces and sizes to their defaults and keeps saved layouts', () => {
  const layout = normalizeLayout(V2, at);
  const one = resetMode(layout, 'animate', at);
  assert.ok(sameArrangement(one.modes.animate, defaultArrangement('animate')));
  assert.equal(one.modes.animate.zoomMemory, 2, 'unknown keys stay');
  assert.deepEqual(one.modes.rig, layout.modes.rig);
  const all = resetLayout(layout, at);
  assert.deepEqual(all.shared.sizes, {});
  assert.equal(all.shared.later, true);
  for (const mode of ['animate', 'draw', 'rig']) assert.ok(sameArrangement(all.modes[mode], defaultArrangement(mode)));
  assert.equal(all.saved.length, 1);
});

