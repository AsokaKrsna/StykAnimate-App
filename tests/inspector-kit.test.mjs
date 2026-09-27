import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {parse} from '../vendor/text/opentype.mjs';
import {Editor} from '../src/editor.mjs';
import {emptyDocument, createFrame, createObject} from '../src/demo.mjs';
import {rigExampleDocument} from '../src/rig-examples.mjs';
import {rigIKAllowed} from '../src/rig-constraints.mjs';
import {inspectorView} from '../src/inspector-view.mjs';
import {ikControlsView} from '../src/ik-view.mjs';
import {compileTextFigure} from '../src/text-authoring.mjs';
import {createImageFigure} from '../src/media-authoring.mjs';
import english from '../src/locales/en.mjs';
import inspectorStrings from '../src/locales/en-inspector.mjs';
import {lintCss} from '../scripts/check-css.mjs';
import {
  INSPECTOR_BUDGET, MAX_TITLE_ACTIONS, ROW_PLACEHOLDER, SCRUB_HINT, SectionMemory, attributes, describeField, escapeHTML, formatValueWithUnit,
  hasMoreBelow, inspectorBudgetProblems, normalizeSectionMemory, renderButton, renderFooter, renderInspector, renderInspectorHead, renderQuickSlot,
  renderRow, renderScope, renderSection, resolveSectionOpen, restDisplayPrecision, rowControls, sectionBodyId, sliderFill, syncQuickHost,
} from '../src/inspector-kit.mjs';
import {
  brushInspector, cameraInspector, figureInspector, frameInspector, ikSection, jointInspector, layerInspector, sceneInspector, selectionInspector,
} from './helpers/inspector-kit-contexts.mjs';

// ---------------------------------------------------------------------------
// A start-tag reader for inspector markup (no comments, scripts or unquoted values).

const ENTITIES = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"};
const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ENTITIES[entity]);
function tags(html) {
  return [...html.matchAll(/<([a-z][a-z0-9-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/gi)].map(match => ({
    tag: match[1].toLowerCase(), index: match.index, end: match.index + match[0].length,
    attrs: Object.fromEntries([...match[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, decode(value ?? '')])),
  }));
}
const matches = (entry, where) => Object.entries(where).every(([name, value]) => (value === true ? name in entry.attrs : entry.attrs[name] === String(value)));
const find = (html, where) => tags(html).find(entry => matches(entry, where));
function tag(html, where, label = JSON.stringify(where)) {
  const found = find(html, where);
  assert.ok(found, `no element with ${label}`);
  return found;
}
const pick = (entry, names) => Object.fromEntries(names.map(name => [name, entry.attrs[name] ?? null]));
/** Today's accessible names with the unit written out, as components.md §3 asks ("Angle (degrees)"): a deliberate change. */
const human = values => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, name === 'aria-label' && value ? value.replace(/\(°\)/g, '(degrees)') : value]));
/** The text of an element's options (a select's contract: value, selected, disabled, label). */
function options(html, where) {
  const select = tag(html, where), close = html.indexOf('</select>', select.end);
  return [...html.slice(select.end, close).matchAll(/<option((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*>([^<]*)<\/option>/g)].map(([, attrs, text]) => {
    const entry = {attrs: Object.fromEntries([...attrs.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, decode(value ?? '')]))};
    return {value: entry.attrs.value ?? null, selected: 'selected' in entry.attrs, disabled: 'disabled' in entry.attrs, text: decode(text)};
  });
}
/** A control's accessible name: aria-label, else the text of the <label> that wraps it up to the control. */
function nameOf(html, where) {
  const entry = tag(html, where);
  if (entry.attrs['aria-label']) return entry.attrs['aria-label'];
  const before = html.slice(0, entry.index);
  return [...before.slice(before.lastIndexOf('<label')).matchAll(/>([^<]+)</g)].map(match => decode(match[1])).join('').trim();
}

const NUMBER = ['type', 'id', 'data-field', 'data-property', 'data-property-value', 'data-property-precision', 'data-property-display-precision',
  'data-property-step', 'value', 'step', 'aria-label', 'min', 'max', 'disabled'];
const SCRUB = ['data-property-scrub', 'tabindex', 'role', 'aria-label'];
/**
 * A PropertyControls number: its row, its input and the scrub label inside the
 * row are the same today and in the kit, except that the scrub tip is the one
 * tooltip (data-tooltip) instead of a native title.
 */
function assertNumberParity(today, kit, key, names = NUMBER) {
  for (const [html, source] of [[today, 'today'], [kit, 'kit']]) tag(html, {'data-property-row': key}, `${source} data-property-row=${key}`);
  const expected = tag(today, {'data-property': key}), actual = tag(kit, {'data-property': key});
  assert.deepEqual(pick(actual, names), human(pick(expected, names)), `${key} input`);
  const scrub = (html, row) => tags(html).find(entry => entry.index > row.index && 'data-property-scrub' in entry.attrs);
  const todayScrub = scrub(today, tag(today, {'data-property-row': key})), kitScrub = scrub(kit, tag(kit, {'data-property-row': key}));
  assert.deepEqual(pick(kitScrub, SCRUB), human(pick(todayScrub, SCRUB)), `${key} scrub label`);
  assert.equal(kitScrub.attrs['data-tooltip'], todayScrub.attrs.title, `${key}: the scrub tip is the tooltip`);
  assert.ok(!('title' in kitScrub.attrs), `${key}: no native title beside the tooltip`);
  assert.ok(kitScrub.index < actual.index, `${key}: the scrub label precedes its input inside the row`);
}
function assertParity(today, kit, where, names) {
  assert.deepEqual(pick(tag(kit, where, `kit ${JSON.stringify(where)}`), names), human(pick(tag(today, where, `today ${JSON.stringify(where)}`), names)), JSON.stringify(where));
}
/** A switch: the same state and hooks, and a visible name that contains today's (label in name, WCAG 2.5.3). */
function assertSwitchParity(today, kit, where, names = ['type', 'role', 'checked']) {
  assertParity(today, kit, where, names);
  const before = nameOf(today, where), after = nameOf(kit, where);
  assert.ok(after.includes(before), `${JSON.stringify(where)}: "${after}" names "${before}"`);
}
const assertOptions = (today, kit, where) => assert.deepEqual(options(kit, where), options(today, where), `${JSON.stringify(where)} options`);
const icon = (name, className) => `<svg class="${className}" data-icon="${name}"></svg>`;
const kitHTML = (descriptor, env = {}, parts) => renderInspector(descriptor, {icon, ...env}, parts);
function assertNoKeyState(html) {
  for (const hook of ['data-property-key', 'data-property-nav', 'property-key-controls', 'ui-key', 'data-icon="diamond"'])
    assert.ok(!html.includes(hook), `the inspector shows no key state (${hook})`);
}
/** Only controls whose browser tests still read `title` keep one (legacyTitle); everything else uses the one tooltip. */
function assertNoTitles(html, allowed = []) {
  const titled = tags(html).filter(entry => 'title' in entry.attrs).map(entry => entry.attrs['data-action'] ?? entry.attrs.id ?? entry.tag);
  assert.deepEqual(titled, allowed, 'no native titles beside the tooltip');
}
const HEADER = 7;   // the header's menu button and a full quick actions row (five defaults and a pin)
const assertBudget = (descriptor, options = {}) => assert.deepEqual(inspectorBudgetProblems(descriptor, {headerControls: HEADER, ...options}), [], `${descriptor.kind} fits the budget`);

const fonts = await Promise.all(['Regular'].map(async style => {
  const bytes = readFileSync(new URL(`../vendor/text/NotoSans-${style}.ttf`, import.meta.url));
  return parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHk8AAAAASUVORK5CYII=';

// ---------------------------------------------------------------------------
// Parity: today's inspectors' key controls, reproduced by descriptors.

test('figure inspector: transform, appearance, arrange and palette keep their ids and property hooks', () => {
  const editor = new Editor();
  editor.select(1);
  const descriptor = figureInspector(editor), today = inspectorView({editor}), kit = kitHTML(descriptor);
  for (const key of ['root_x', 'root_y', 'scale', 'rotation', 'figure_opacity', 'figure_z_order']) assertNumberParity(today, kit, key);
  assert.equal(tag(kit, {'data-property': 'scale'}).attrs['data-field'], 'scale', 'legacy data-field stays');
  assert.equal(tag(kit, {'data-property': 'figure_opacity'}).attrs['data-field'], undefined, 'no data-field where today has none');
  assert.equal(tag(kit, {'data-property': 'rotation'}).attrs['aria-label'], 'Angle (degrees)', 'units are words in accessible names');
  assertParity(today, kit, {id: 'figure-color'}, ['type', 'value', 'aria-label']);
  assertParity(today, kit, {id: 'figure-name'}, ['value', 'aria-label']);
  assert.equal(tag(kit, {id: 'figure-name'}).attrs['data-tooltip'], tag(today, {id: 'figure-name'}).attrs.title, 'the rename tip is the tooltip');
  assertParity(today, kit, {id: 'figure-layer'}, ['aria-label']);
  assertOptions(today, kit, {id: 'figure-layer'});
  for (const action of ['reset-color', 'layer-down', 'layer-up']) assertParity(today, kit, {'data-action': action}, ['aria-label', 'data-action']);
  // join-selection.browser reads the Join button's title until the M2 test migration.
  assertParity(today, kit, {'data-action': 'join-figure'}, ['aria-label', 'data-action', 'title']);
  assertNoTitles(kit, ['join-figure']);
  tag(kit, {'data-action': 'combine-figures'});
  const color = tag(today, {'data-palette-color': true}).attrs['data-palette-color'];
  assertParity(today, kit, {'data-palette-color': color}, ['data-paint-picker', 'aria-label']);
  // The spec's glyphs: plain one-step arrows, never the chevrons.
  assert.match(kit, /data-action="layer-down"[^>]*><svg class="ui-icon" data-icon="step-down">/);
  assert.match(kit, /data-action="layer-up"[^>]*><svg class="ui-icon" data-icon="step-up">/);
  // Today's exact attribute run, which string tests read.
  assert.ok(kit.includes('data-property-precision="3" data-property-display-precision="1"'));
  // Connection names the figure it is joined to, read-only, as today's row does.
  assert.match(kit, /<div class="ui-row"><span class="ui-row-label">Joined to<\/span><span class="ui-row-value">None<\/span><\/div>/);
  assertNoKeyState(kit);
  assertBudget(descriptor);
});

test('text and image figures keep their transform fields and their own commands', () => {
  const text = compileTextFigure({text: 'Hello', fontSize: 42, color: [70, 40, 170]}, fonts[0]);
  const editor = new Editor({demo: false});
  editor.importFigure(text);
  let today = inspectorView({editor}), descriptor = figureInspector(editor), kit = kitHTML(descriptor);
  assert.equal(descriptor.kind, 'text');
  for (const key of ['root_x', 'root_y', 'scale', 'rotation']) assertNumberParity(today, kit, key);
  assertParity(today, kit, {'data-action': 'edit-text'}, ['data-action']);
  assertParity(today, kit, {id: 'figure-name'}, ['value', 'aria-label']);
  assertNoKeyState(kit);
  assertBudget(descriptor);

  const image = new Editor({demo: false});
  image.importFigure(createImageFigure({dataUrl: PNG, width: 1, height: 1, name: 'Placed sprite'}));
  today = inspectorView({editor: image}); descriptor = figureInspector(image); kit = kitHTML(descriptor);
  assert.equal(descriptor.kind, 'image');
  for (const key of ['root_x', 'root_y', 'scale', 'rotation', 'figure_opacity']) assertNumberParity(today, kit, key);
  assertParity(today, kit, {id: 'figure-color'}, ['type', 'value', 'aria-label']);
  assertParity(today, kit, {id: 'figure-name'}, ['value']);
  // A figure without text leaves the Text section's placeholder, so the sections after it keep their places.
  assert.ok(kit.includes('<section class="ui-section" data-section="text" hidden></section>'));
  assertBudget(descriptor);
});

test('several figures: Selection, Align and Appearance keep their hooks; values that differ read Mixed', () => {
  const editor = new Editor();
  editor.selectMany([1, 2]);
  const bounds = {minX: 10, minY: 20, maxX: 110.5, maxY: 220};
  const today = inspectorView({editor, selectionCount: 2, bounds}), descriptor = selectionInspector(editor, bounds), kit = kitHTML(descriptor);
  for (const key of ['group_x', 'group_y', 'group_width', 'group_height', 'figure_opacity']) assertNumberParity(today, kit, key);
  const align = ['align-left', 'align-center-x', 'align-right', 'align-top', 'align-center-y', 'align-bottom'];
  for (const action of ['rotate', 'center', 'reset-color', ...align]) assertParity(today, kit, {'data-action': action}, ['aria-label', 'data-action']);
  assertParity(today, kit, {id: 'figure-color'}, ['type', 'aria-label']);
  assertParity(today, kit, {id: 'figure-layer'}, ['aria-label']);
  assertOptions(today, kit, {id: 'figure-layer'});
  assertNoTitles(kit);
  assertBudget(descriptor);

  // Figures on two layers: the Layer select reads Mixed, as today's.
  const layer = editor.createLayer('Layer 2', {activate: false});
  editor.assignFiguresToLayer([2], layer.id);
  editor.selectMany([1, 2]);
  assertOptions(inspectorView({editor, selectionCount: 2, bounds}), kitHTML(selectionInspector(editor, bounds)), {id: 'figure-layer'});
  assert.equal(options(kitHTML(selectionInspector(editor, bounds)), {id: 'figure-layer'})[0].text, 'Mixed');

  // Opacities that differ: the field is empty with a Mixed placeholder and keeps the model value it edits from.
  editor.selectedObjects[0].field28 = 128;
  const mixed = kitHTML(selectionInspector(editor, bounds)), input = tag(mixed, {'data-property': 'figure_opacity'});
  assert.equal(input.attrs.value, '');
  assert.equal(input.attrs.placeholder, 'Mixed');
  assert.equal(input.attrs['data-mixed'], input.attrs['data-property-value']);
  assert.ok('data-mixed' in tag(mixed, {'data-property-row': 'figure_opacity'}).attrs);
});

test('joint inspector: pose fields, Static, IK and the segment style keep their contract', () => {
  const editor = new Editor();
  editor.select(1, 2);
  const descriptor = jointInspector(editor), today = inspectorView({editor}), kit = kitHTML(descriptor);
  for (const key of ['joint_angle', 'joint_length', 'joint_bend', 'thickness', 'segment_z_order', 'segment_opacity']) assertNumberParity(today, kit, key);
  for (const key of ['thickness', 'joint_angle', 'joint_length']) assert.equal(tag(kit, {'data-property': key}).attrs['data-field'], key);
  assertSwitchParity(today, kit, {id: 'static-joint'});
  assertParity(today, kit, {id: 'segment-shape'}, ['aria-label', 'disabled']);
  assertOptions(today, kit, {id: 'segment-shape'});
  assertParity(today, kit, {id: 'segment-color'}, ['type', 'data-paint-picker', 'aria-label']);
  assertSwitchParity(today, kit, {id: 'node-is-ik'}, ['type', 'role', 'aria-controls', 'checked']);
  // Use IK controls a rendered region even while IK is off (today's #node-ik-options, hidden).
  const region = tag(kit, {id: 'node-ik-options'});
  assert.ok('hidden' in region.attrs && 'hidden' in tag(today, {id: 'node-ik-options'}).attrs);
  // The field switch is named by its label: no aria-label that could drift from the visible text.
  assert.match(kit, /<label class="ui-field" data-switch-field><span class="ui-field-label">Static<\/span><input class="ui-switch" type="checkbox" role="switch" id="static-joint"/);
  assert.equal(nameOf(kit, {id: 'node-is-ik'}), 'Use IK');
  assertNoTitles(kit);
  assertNoKeyState(kit);
  assertBudget(descriptor);
});

test('IK options keep their ids, the chain stepper and the native bend radios', () => {
  const ik = {enabled: true, pinned: true, allowStretch: false, bendDirection: 1, chainLength: 2, maxLength: 3, target: {rotation: 0.5}};
  const today = ikControlsView(ik), kit = renderSection(ikSection(ik), {icon, kind: 'joint'});
  for (const id of ['node-ik-pinned', 'node-ik-stretch']) assertSwitchParity(today, kit, {id});
  assertParity(today, kit, {id: 'node-ik-chain'}, ['type', 'min', 'max', 'step', 'value', 'aria-label']);
  assertParity(today, kit, {id: 'node-ik-rotation'}, ['type', 'step', 'value', 'aria-label']);
  for (const value of ['-1', '0', '1']) assertParity(today, kit, {name: 'node-ik-bend', value}, ['type', 'checked', 'aria-label']);
  assert.ok(!('hidden' in tag(kit, {id: 'node-ik-options'}).attrs));
  assert.match(kit, /<div class="ui-segmented" role="radiogroup" aria-label="IK bend direction"/);
  // Plain step buttons: the kit applies them within the input's limits, out of the tab order.
  const steps = tags(kit).filter(entry => 'data-kit-step' in entry.attrs);
  assert.equal(steps.length, 2);
  assert.ok(steps.every(entry => entry.attrs.tabindex === '-1'));
  assert.equal(tag(kit, {id: 'node-ik-chain'}).attrs['data-precision'], '0');
});

test('connector joints: Segment │ Slider and the slide position keep their hooks', () => {
  const editor = new Editor({demo: false});
  editor.load(rigExampleDocument('sliding-carriage'));
  editor.select(1, 2);
  const allowed = () => rigIKAllowed(editor.figure, editor.selectedJoint);
  let today = inspectorView({editor}), descriptor = jointInspector(editor, {ikAllowed: allowed()}), kit = kitHTML(descriptor);
  assertParity(today, kit, {id: 'rig-position'}, ['type', 'min', 'max', 'step', 'aria-label']);
  assert.equal(Number(tag(kit, {id: 'rig-position'}).attrs.value), Number(tag(today, {id: 'rig-position'}).attrs.value));
  for (const part of ['segment', 'slider']) assertParity(today, kit, {'data-connector-part': part}, ['aria-pressed']);
  assertSwitchParity(today, kit, {id: 'static-joint'});
  for (const html of [today, kit]) assert.doesNotMatch(html, /id="segment-color"|data-property="thickness"/);
  assert.ok('data-open' in tag(kit, {'data-section': 'connector'}).attrs, 'the Connector section opens on a connector joint');
  assertBudget(descriptor);

  editor._connectorInspector = {uid: 1, id: 3, part: 'segment'};
  today = inspectorView({editor}); kit = kitHTML(jointInspector(editor, {ikAllowed: allowed()}));
  for (const part of ['segment', 'slider']) assertParity(today, kit, {'data-connector-part': part}, ['aria-pressed']);
  assertParity(today, kit, {id: 'segment-color'}, ['type', 'aria-label']);
  assertNumberParity(today, kit, 'thickness');
  for (const html of [today, kit]) assert.doesNotMatch(html, /id="rig-position"|id="static-joint"|data-property="joint_angle"/);
});

test('second colour: its switch, its region and its fields keep their hooks on circles only', () => {
  const editor = new Editor({demo: false});
  editor.addFigure();
  editor.select(editor.selectedUid, 0);
  editor.updateSegmentStyle({color: '#f8356a', opacity: 0.7, gradient: {color: '#2cd876', opacity: 0.6}});
  editor.convertSegment('circle');
  let today = inspectorView({editor}), kit = kitHTML(jointInspector(editor));
  assertSwitchParity(today, kit, {id: 'segment-gradient-enabled'}, ['type', 'role', 'checked', 'aria-controls']);
  assert.ok(!('hidden' in tag(kit, {id: 'segment-secondary-controls'}).attrs));
  assertParity(today, kit, {id: 'segment-gradient-color'}, ['type', 'value', 'aria-label']);
  assertNumberParity(today, kit, 'segment_gradient_opacity');
  assertNumberParity(today, kit, 'segment_opacity');
  assert.ok('data-open' in tag(kit, {'data-section': 'second-colour'}).attrs, 'it opens while the second colour is on');

  editor.figure.segments[0].secondary = null;
  today = inspectorView({editor}); kit = kitHTML(jointInspector(editor));
  assertSwitchParity(today, kit, {id: 'segment-gradient-enabled'}, ['type', 'role', 'checked', 'aria-controls']);
  for (const html of [today, kit]) {
    assert.ok('hidden' in tag(html, {id: 'segment-secondary-controls'}).attrs, 'the region stays, hidden');
    assert.doesNotMatch(html, /id="segment-gradient-color"/);
  }
  editor.convertSegment('line');
  kit = kitHTML(jointInspector(editor));
  assert.doesNotMatch(kit, /segment-gradient-enabled/);
  assert.ok(kit.includes('<section class="ui-section" data-section="second-colour" hidden></section>'));
});

test('camera inspector: transform fields, the monitor and the pose commands keep their hooks', () => {
  const editor = new Editor();
  const descriptor = cameraInspector(editor), today = inspectorView({editor, context: 'camera'}), kit = kitHTML(descriptor);
  for (const key of ['camera_x', 'camera_y', 'camera_scale', 'camera_angle']) assertNumberParity(today, kit, key);
  assertParity(today, kit, {'data-camera-monitor': true}, ['aria-label']);
  tag(kit, {'data-camera-magnification': true});
  for (const tab of ['transform', 'motion']) assertParity(today, kit, {'data-camera-tab': tab}, ['role', 'aria-selected']);
  for (const action of ['camera-copy', 'camera-paste']) assertParity(today, kit, {'data-action': action}, ['aria-label', 'disabled']);
  assertParity(today, kit, {'data-action': 'camera-guides'}, ['aria-pressed']);
  // The monitor is drawn imperatively: its canvas is an owned host in the Preview section, a plain element (no card).
  const monitor = tag(kit, {'data-camera-monitor': true});
  assert.equal(monitor.attrs['data-inspector-owned'], 'camera-monitor');
  assert.equal(monitor.attrs.class, 'inspector-preview-media');
  assert.doesNotMatch(kit, /ui-card/);
  assert.match(kit, /data-action="camera-copy"[^>]*><svg class="ui-icon" data-icon="copy">/);
  assertNoTitles(kit);
  assertNoKeyState(kit);
  assertBudget(descriptor);
});

test('scene inspector: its meta line, canvas size, background colour and rate keep their hooks', () => {
  const editor = new Editor();
  const descriptor = sceneInspector(editor), today = inspectorView({editor, context: 'scene'}), kit = kitHTML(descriptor);
  for (const key of ['canvas_width', 'canvas_height', 'fps']) assertNumberParity(today, kit, key);
  assertParity(today, kit, {id: 'background-color'}, ['type', 'value', 'aria-label']);
  for (const action of ['background-style', 'import-background']) assertParity(today, kit, {'data-action': action}, ['aria-label']);
  assert.ok(kit.includes('data-property-precision="0" data-property-display-precision="0"'), 'integer properties edit without decimals');
  // The meta line is a quiet line of facts, never a paragraph (the audit counts <p> at rest as noise).
  assert.match(kit, /<div class="inspector-meta">3 figures · \d+ frames · [\d.]+ s<\/div>/);
  assert.doesNotMatch(kit, /<p[\s>]/);
  assertBudget(descriptor, {headerControls: 1});
});

test('keyframe and exposure inspectors keep the duration field and Add frame', () => {
  const editor = new Editor();
  let today = inspectorView({editor, context: 'frame'}), descriptor = frameInspector(editor), kit = kitHTML(descriptor);
  assert.equal(descriptor.kind, 'keyframe');
  assertNumberParity(today, kit, 'duration');
  assertBudget(descriptor, {headerControls: 1});
  const sheet = new Editor({layerTimeline: true, propertyChannels: true});
  today = inspectorView({editor: sheet, context: 'frame'}); descriptor = frameInspector(sheet); kit = kitHTML(descriptor);
  assert.equal(descriptor.kind, 'frame');
  assertNumberParity(today, kit, 'duration');
  assertParity(today, kit, {'data-action': 'add-frame'}, ['aria-label']);
  assertNoKeyState(kit);
});

test('fills: each keeps its identity, colour, delete, opacity, order and order steps; long lists page as today', () => {
  const report = emptyDocument(), figure = report.figure_types[0];
  figure.polyfills = Array.from({length: 40}, (_, i) => ({polyfill_id: i + 1, segment_ids: [0, 1, 2], color_rgb: [i * 6, 90, 250 - i * 5], color_alpha: 1 - i / 100, z_order: 1.5}));
  report.keyframes = [createFrame([createObject(figure, 1, 200, 200)], 10)];
  const editor = new Editor({demo: false}).load(report);
  editor.select(1);
  const view = {tool: 'rig', rigMode: 'rotate', polygonPage: 1, palettePage: 1};
  const today = inspectorView({editor, ...view}), descriptor = figureInspector(editor, view), kit = kitHTML(descriptor);
  // Edit rig, while the rig tool is active.
  assertParity(today, kit, {id: 'rig-mode'}, ['aria-label']);
  assertOptions(today, kit, {id: 'rig-mode'});
  tag(kit, {'data-action': 'add-sprite-segment'});
  for (const index of [12, 23]) {
    for (const html of [today, kit]) tag(html, {'data-polygon-index': index});
    assertParity(today, kit, {'data-polygon-color': index}, ['type', 'value', 'aria-label']);
    assertParity(today, kit, {'data-delete-polygon': index}, ['aria-label']);
    for (const key of [`polygon_${index}_opacity`, `polygon_${index}_z_order`]) assertNumberParity(today, kit, key);
    for (const direction of ['back', 'down', 'up', 'front'])
      assertParity(today, kit, {'data-action': 'builder-order', 'data-index': index, 'data-direction': direction}, ['aria-label', 'data-kind']);
  }
  assert.equal(find(kit, {'data-polygon-index': 11}), undefined, 'only the current page');
  for (const action of ['polygons-previous', 'polygons-next', 'palette-previous', 'palette-next']) assertParity(today, kit, {'data-action': action}, ['aria-label', 'disabled']);
  const colour = tags(today).filter(entry => 'data-palette-color' in entry.attrs)[0].attrs['data-palette-color'];
  assertParity(today, kit, {'data-palette-color': colour}, ['aria-label']);
  // The palette is one collection: one tab stop, the arrow keys inside.
  const grid = tag(kit, {class: 'ui-swatch-grid'});
  assert.ok('data-count-one' in grid.attrs);
  assert.deepEqual(tags(kit).filter(entry => 'data-palette-color' in entry.attrs).map(entry => entry.attrs.tabindex).filter(value => value === '0'), ['0']);
  // At rest the fills and colours are one closed line each; the rig tool's section opens while it is active.
  assertBudget(figureInspector(editor));
  assert.ok('data-open' in tag(kit, {'data-section': 'rig'}).attrs);
  assert.ok(!('data-open' in tag(kit, {'data-section': 'fills'}).attrs));
});

test('drawing layer inspector: name, visibility, lock and parallax keep their hooks', () => {
  const editor = new Editor({layerTimeline: true, propertyChannels: true});
  const layer = editor.createDrawingLayer();
  const descriptor = layerInspector(editor), today = inspectorView({editor, context: 'layer'}), kit = kitHTML(descriptor);
  assertParity(today, kit, {id: 'inspector-layer-name'}, ['value', 'aria-label', 'maxlength', 'data-layer-id']);
  for (const id of ['inspector-layer-visible', 'inspector-layer-locked']) assertParity(today, kit, {id}, ['type', 'checked', 'data-layer-id']);
  tag(kit, {'data-parallax-layer': layer.id});
  assertParity(today, kit, {'data-parallax-field': 'enabled'}, ['type', 'aria-label', 'checked', 'disabled']);
  assertParity(today, kit, {'data-parallax-field': 'preset'}, ['aria-label', 'disabled']);
  assertOptions(today, kit, {'data-parallax-field': 'preset'});
  assertParity(today, kit, {'data-parallax-field': 'movement'}, ['type', 'min', 'max', 'value', 'aria-label']);
  for (const key of ['parallax_x', 'parallax_y'])
    assertNumberParity(today, kit, key, ['type', 'data-property', 'data-property-value', 'data-property-step', 'data-property-precision', 'data-parallax-field', 'min', 'max', 'aria-label']);
  // Parallax is a titled section with its switch after the title; closed while parallax is off.
  const section = tag(kit, {'data-section': 'parallax'});
  assert.ok('data-collapsible' in section.attrs && !('data-open' in section.attrs));
  assert.match(kit, /<div class="ui-section-head" data-switch>/);
  assert.equal(tag(kit, {'data-parallax-field': 'enabled'}).attrs['aria-label'], 'Enable parallax', 'the title switch has no visible label of its own');
  assertBudget(descriptor, {headerControls: 4});
});

test('drawing brush inspector: preview, recent colours, Blend and Lock alpha keep their hooks', () => {
  const editor = new Editor({layerTimeline: true, propertyChannels: true});
  editor.createDrawingLayer();
  const settings = {color: '#223344', color2: '#ffffff', blend: 'multiply', alphaLock: true, preset: 'ink', hardness: 0.5, roundness: 1, angle: 0, spacingRatio: 0.08,
    taperIn: 0, taperOut: 0, stabilizerMode: 'average', tip: 'round', angleMode: 'fixed', grain: 'noise', texture: 0, grainScale: 1, pressureSize: true,
    pressureOpacity: false, pressureFlow: false, sizeCurve: 1, opacityCurve: 1, sizeJitter: 0, opacityJitter: 0, angleJitter: 0, scatter: 0, mirrorY: false,
    resolution: 1, filter: 'smooth'};
  const drawing = {active: true, editor, tool: 'brush', settings, library: {recent: ['#ff0000', '#223344'], presets: []}, state: {view: {}}};
  const descriptor = brushInspector(drawing), today = inspectorView({editor, drawing}), kit = kitHTML(descriptor);
  assertParity(today, kit, {'data-brush-preview': true}, ['data-section', 'aria-label']);
  assert.ok('data-inspector-owned' in tag(kit, {'data-brush-preview': true}).attrs, 'the preview stays an owned host');
  assertParity(today, kit, {'data-draw-setting': 'blend'}, ['aria-label', 'data-draw-text']);
  assertOptions(today, kit, {'data-draw-setting': 'blend'});
  assertSwitchParity(today, kit, {id: 'draw-alphaLock'}, ['type', 'role', 'checked', 'data-draw-setting']);
  for (const color of ['#ff0000', '#223344']) {
    assertParity(today, kit, {'data-draw-color': color}, ['aria-label', 'aria-pressed']);
    assert.equal(tag(kit, {'data-draw-color': color}).attrs['data-tooltip'], tag(today, {'data-draw-color': color}).attrs.title);
  }
  // Recent colours are one tab stop: the current colour holds it.
  assert.equal(tag(kit, {'data-draw-color': '#223344'}).attrs.tabindex, '0');
  assert.equal(tag(kit, {'data-draw-color': '#ff0000'}).attrs.tabindex, '-1');
  assertBudget(descriptor, {headerControls: 1});
});

// ---------------------------------------------------------------------------
// Fields

test('number fields carry the PropertyControls hooks, the unit after the value and no key state', () => {
  const html = renderRow({kind: 'number', key: 'root_x', label: 'X', unit: 'px', value: 456.36396, min: -10, max: 1000}, {icon});
  assert.equal(html, '<label class="ui-field" data-property-row="root_x"><span class="ui-field-label" data-property-scrub tabindex="0" role="button" ' +
    'aria-label="Scrub X (px)" data-tooltip="Drag to adjust · Shift: fine · Alt: extra fine">X</span><input class="ui-field-input" type="number" data-field="root_x" ' +
    'data-property="root_x" data-property-value="456.36396" data-property-precision="3" data-property-display-precision="1" data-property-step="1" value="456.4" ' +
    'step="any" aria-label="X (px)" min="-10" max="1000"><span class="ui-field-suffix" aria-hidden="true">px</span></label>');
  assert.match(renderRow({kind: 'number', key: 'scale', label: 'Scale', unit: '%', value: 100}), /<span class="ui-field-suffix" aria-hidden="true" data-glue>%<\/span>/);
  // Integers edit and show without decimals; a Mixed value keeps the model value for PropertyControls.
  const order = renderRow({kind: 'number', key: 'fps', label: 'Rate', unit: 'fps', precision: 0, value: 24});
  assert.match(order, /data-property-precision="0" data-property-display-precision="0"/);
  const mixed = renderRow({kind: 'number', key: 'group_x', label: 'X', value: 12, mixed: true});
  assert.match(mixed, /data-property-value="12"/); assert.match(mixed, /value="" /); assert.match(mixed, /placeholder="Mixed" data-mixed="12"/);
  // Without a key: a plain number, no scrub hooks.
  const plain = renderRow({kind: 'number', id: 'node-ik-rotation', label: 'Rotation', unit: '°', value: 28.6479, precision: 2, step: 1});
  assert.doesNotMatch(plain, /data-property/);
  assert.match(plain, /value="28.65"/);
  assert.match(plain, /aria-label="Rotation \(degrees\)"/);
  assert.equal(restDisplayPrecision(3, 'px'), 1); assert.equal(restDisplayPrecision(3, ''), 2); assert.equal(restDisplayPrecision(0, 'px'), 0);
  assert.equal(renderRow({kind: 'number', key: 'x', label: 'X', value: 1, tip: 'Custom'}).includes('data-tooltip="Custom"'), true);
  assert.equal(renderRow({kind: 'number', key: 'x', label: 'X', value: 1}, {t: key => (key === 'inspector.scrubTip' ? 'Ziehen' : key)}).includes('data-tooltip="Ziehen"'), true);
});

test('the stepper field keeps its step buttons outside the property row, out of the tab order and off at their limits', () => {
  const row = {kind: 'stepper-field', key: 'figure_z_order', label: 'Order', description: 'Z-index', precision: 0, value: 2, min: -3, max: 2,
    down: {action: 'layer-down', label: 'Send backward', icon: 'step-down'}, up: {action: 'layer-up', label: 'Bring forward', icon: 'step-up'}};
  const html = renderRow(row, {icon});
  const core = html.match(/<span class="ui-field-core" data-property-row="figure_z_order">(.*?)<\/span><button/)?.[1];
  assert.ok(core, 'a property row wraps the label and value');
  assert.match(core, /data-property-scrub/); assert.match(core, /data-property="figure_z_order"/); assert.doesNotMatch(core, /<button/);
  assert.match(html, /^<div class="ui-field" data-steps role="group" aria-label="Z-index">/);
  // The value is the keyboard target (DOM order label, value, down, up; drawn label, down, value, up).
  const down = tag(html, {'data-action': 'layer-down'}), up = tag(html, {'data-action': 'layer-up'});
  assert.equal(down.attrs['aria-label'], 'Send backward'); assert.equal(down.attrs.tabindex, '-1'); assert.equal(up.attrs.tabindex, '-1');
  assert.ok(!('disabled' in down.attrs) && 'disabled' in up.attrs, 'at its maximum the value cannot step up');
  const disabled = renderRow({...row, value: 0, disabled: true}, {icon});
  assert.ok(['layer-down', 'layer-up'].every(action => 'disabled' in tag(disabled, {'data-action': action}).attrs), 'a disabled row disables its steps');
  // Without a command, a step is the kit's own.
  const plain = renderRow({kind: 'stepper-field', key: 'k', label: 'K', value: 1}, {icon});
  assert.deepEqual(tags(plain).filter(entry => 'data-kit-step' in entry.attrs).map(entry => entry.attrs['data-kit-step']), ['-1', '1']);
  assert.match(plain, /aria-label="Decrease K"/);
});

test('selects carry their label inside, or drop it when bare; a placeholder shows while none is chosen', () => {
  const layer = renderRow({kind: 'select', id: 'figure-layer', label: 'Layer', description: 'Figure layer', placeholder: 'Mixed',
    options: [{value: 'a', label: 'Bubble'}, {value: 'b', label: 'Rival', disabled: true}]}, {icon});
  assert.match(layer, /^<label class="ui-field" data-select><span class="ui-field-label">Layer<\/span><select class="ui-field-input" id="figure-layer" aria-label="Figure layer">/);
  assert.deepEqual(options(layer, {id: 'figure-layer'}).map(option => [option.value, option.selected, option.disabled]), [['', true, true], ['a', false, false], ['b', false, true]]);
  const bare = renderRow({kind: 'select', label: 'Layer', bare: true, value: 'a', placeholder: 'Mixed', options: [{value: 'a', label: 'Layer 1'}]}, {icon});
  assert.match(bare, /^<label class="ui-field" data-select data-bare data-tooltip="Layer"><select/);
  assert.doesNotMatch(bare, /ui-field-label|Mixed/);
  assert.match(bare, /data-icon="chevron-down"/);
});

test('switches, checkboxes, colours, segmented controls and sliders render their component patterns', () => {
  assert.equal(renderRow({kind: 'field-switch', id: 'pin-joint', label: 'Pin joint', checked: false, tip: 'Hold this joint still'}),
    '<label class="ui-field" data-switch-field data-tooltip="Hold this joint still"><span class="ui-field-label">Pin joint</span><input class="ui-switch" type="checkbox" role="switch" id="pin-joint"></label>');
  // A description that adds to the visible label becomes the name; one that repeats it is dropped.
  assert.match(renderRow({kind: 'field-switch', id: 's', label: 'Static', description: 'Static joint'}), /role="switch" id="s" aria-label="Static joint"/);
  assert.doesNotMatch(renderRow({kind: 'field-switch', id: 's', label: 'Static', description: 'Static'}), /aria-label/);
  assert.equal(renderRow({kind: 'switch', label: 'Sample all layers', checked: true, data: {'draw-setting': 'sampleAll'}}),
    '<label class="ui-switch-row"><span>Sample all layers</span><input class="ui-switch" type="checkbox" role="switch" checked data-draw-setting="sampleAll"></label>');
  assert.equal(renderRow({kind: 'checkbox', id: 'apply-range-movement', label: 'Apply to 3 selected frames', checked: true}),
    '<label class="ui-check-row"><input class="ui-checkbox" type="checkbox" id="apply-range-movement" checked><span>Apply to 3 selected frames</span></label>');
  // A paint swatch shows gradients; a solid paint is a plain --swatch colour.
  const gradient = renderRow({kind: 'color', picker: 'paint', id: 'segment-color', label: 'Segment color', paint: 'linear-gradient(90deg,rgba(1,2,3,1) 0%,rgba(4,5,6,0.5) 100%)', caption: 'Linear gradient'});
  assert.match(gradient, /style="--swatch-paint:linear-gradient\(90deg,rgba\(1,2,3,1\) 0%,rgba\(4,5,6,0.5\) 100%\)"/);
  assert.match(renderRow({kind: 'color', picker: 'paint', id: 'c', label: 'C', paint: 'rgba(43,43,43,1)'}), /style="--swatch:rgba\(43,43,43,1\)"/);
  assert.match(renderRow({kind: 'color', id: 'figure-color', label: 'Colour', value: '#0D99FF'}), /value="#0d99ff" aria-label="Colour"><span class="ui-field-hex">0D99FF<\/span>/);
  assert.match(renderRow({kind: 'color', id: 'figure-color', label: 'Colour', value: 'red'}), /value="#000000"/);
  assert.match(renderRow({kind: 'color', id: 'figure-color', label: 'Colour', value: '#0d99ff', mixed: true}), /data-mixed><span class="ui-field-hex">Mixed<\/span>/);
  const pressed = renderRow({kind: 'segmented', mode: 'pressed', description: 'Connector properties', value: 'slider',
    options: [{value: 'segment', label: 'Segment', data: {'connector-part': 'segment'}}, {value: 'slider', label: 'Slider', data: {'connector-part': 'slider'}}]});
  assert.match(pressed, /role="group"/);
  assert.match(pressed, /aria-pressed="false" data-connector-part="segment"/); assert.match(pressed, /aria-pressed="true" data-connector-part="slider"/);
  assert.throws(() => renderRow({kind: 'segmented', name: 'n', options: [{value: 1, label: 'One'}]}), /2-4 options/);
  assert.throws(() => renderRow({kind: 'segmented', name: 'n', options: [1, 2, 3, 4, 5].map(value => ({value, label: String(value)}))}), /use a select/);
  assert.throws(() => renderRow({kind: 'segmented', label: 'Bend', options: [1, 2].map(value => ({value, label: String(value)}))}), /needs a name/);
  const slider = renderRow({kind: 'slider', key: 'roundness', label: 'Roundness', min: 5, max: 100, value: 52.5, unit: '%'});
  assert.match(slider, /data-property-row="roundness"/); assert.match(slider, /type="range" data-property="roundness"/);
  assert.match(slider, /aria-valuetext="53%"/); assert.match(slider, /style="--_p:50%"/); assert.match(slider, /<output class="ui-slider-value" aria-hidden="true">53%<\/output>/);
  assert.match(renderRow({kind: 'slider', label: 'Size', min: 0, max: 64, value: 8, unit: 'px'}), /aria-valuetext="8 px"/);
  // A custom readout is kept for the value it names.
  assert.match(renderRow({kind: 'slider', label: 'Depth', min: 0, max: 4, value: 1, valueText: 'Normal'}), /aria-valuetext="Normal"[^>]*data-value-text="Normal" data-value-at="1"/);
});

test('lists, pagers, previews, owned hosts, text fields, action rows, values, groups and grids', () => {
  const row = renderRow({kind: 'list-row', label: 'Polygon 1', lead: 'polygon', meta: '40%', level: 2, data: {'polygon-index': 0}, actions: [
    {kind: 'swatch', picker: 'native', value: '#aabbcc', label: 'Polygon 1 color', data: {'polygon-color': 0}},
    {icon: 'trash', label: 'Delete polygon 1', data: {'delete-polygon': 0}},
  ]}, {icon});
  assert.match(row, /^<div class="ui-list-row" style="--level:2" data-polygon-index="0"><span class="ui-list-row-lead">/);
  assert.match(row, /<input class="ui-swatch" type="color" value="#aabbcc" aria-label="Polygon 1 color" data-polygon-color="0">/);
  assert.match(row, /<button type="button" class="ui-icon-button" data-size="sm" aria-label="Delete polygon 1" data-delete-polygon="0">/);
  const preview = renderRow({kind: 'preview', media: {tag: 'canvas', key: 'camera-monitor', label: 'Live camera output', data: {'camera-monitor': true}}, caption: ['960 × 540', {text: '100% zoom', data: {'camera-magnification': true}}]});
  assert.equal(preview, '<div class="inspector-preview"><canvas class="inspector-preview-media" data-inspector-owned="camera-monitor" aria-label="Live camera output" data-camera-monitor></canvas>' +
    '<div class="inspector-preview-caption"><span>960 × 540</span><span data-camera-magnification>100% zoom</span></div></div>');
  assert.throws(() => renderRow({kind: 'card', media: {key: 'x'}}), /Unknown inspector row kind: card/, 'the retired card is not a row kind');
  assert.equal(renderRow({kind: 'owned', key: 'motion-graph', label: 'Motion graph', role: 'img', html: '<svg></svg>'}),
    '<div data-inspector-owned="motion-graph" role="img" aria-label="Motion graph"><svg></svg></div>');
  assert.throws(() => renderRow({kind: 'owned'}), /needs a key/);
  assert.equal(renderRow({kind: 'text', id: 'builder-joint-name', label: 'Name', description: 'Joint name', value: 'Neck', maxlength: 120}),
    '<label class="ui-field" data-text><span class="ui-field-label">Name</span><input class="ui-field-input" type="text" id="builder-joint-name" value="Neck" aria-label="Joint name" maxlength="120"></label>');
  const actions = renderRow({kind: 'actions', label: 'Align', items: [{action: 'align-left', icon: 'align-left', label: 'Align left'}, {action: 'add-effect', label: 'Add effect', text: true, variant: 'outline'}]}, {icon});
  assert.match(actions, /^<div class="ui-action-row" role="group" aria-label="Align">/);
  assert.match(actions, /<button type="button" class="ui-button" data-variant="outline" data-action="add-effect"><span class="ui-label">Add effect<\/span><\/button>/);
  assert.equal(renderRow({kind: 'meta', text: '960 × 540 · 24 fps'}), '<div class="inspector-meta">960 × 540 · 24 fps</div>');
  assert.equal(renderRow({kind: 'value', label: 'Joined to', text: 'Rival · Left hand'}),
    '<div class="ui-row"><span class="ui-row-label">Joined to</span><span class="ui-row-value">Rival · Left hand</span></div>');
  const pager = renderRow({kind: 'pager', label: 'Fill pages', text: '1–12 / 14', previous: {action: 'polygons-previous', icon: 'chevron-left', label: 'Previous polygons', disabled: true},
    next: {action: 'polygons-next', icon: 'chevron-right', label: 'Next polygons'}}, {icon});
  assert.match(pager, /^<div class="inspector-pager" role="group" aria-label="Fill pages"><button[^>]*data-action="polygons-previous"[^>]*disabled>/);
  assert.match(pager, /<span class="inspector-pager-text">1–12 \/ 14<\/span>/);
  assert.equal(renderRow({kind: 'grid', ratio: '3:2', stackNarrow: true, rows: []}), '<div class="ui-field-grid" data-ratio="3:2" data-stack-narrow></div>');
  // Regions keep their id while hidden, so a switch's aria-controls always has its target.
  assert.equal(renderRow({kind: 'grid', id: 'segment-secondary-controls', hidden: true, rows: []}), '<div class="ui-field-grid" id="segment-secondary-controls" hidden></div>');
  assert.equal(renderRow({kind: 'group', id: 'node-ik-options', label: 'IK options', hidden: true, rows: []}), '<div class="inspector-group" id="node-ik-options" aria-label="IK options" hidden></div>');
  // Any other hidden or absent row leaves an empty placeholder in its place.
  assert.equal(renderRow({kind: 'number', key: 'x', label: 'X', value: 1, hidden: true}), ROW_PLACEHOLDER);
  assert.equal(renderRow(false), ROW_PLACEHOLDER);
});

// ---------------------------------------------------------------------------
// Sections

test('core sections are open with at most two title actions; titled sections fold with their own ids', () => {
  const core = renderSection({id: 'appearance', title: 'Appearance', actions: [{action: 'reset-color', icon: 'undo', label: 'Reset colours'}], rows: []}, {icon});
  assert.equal(core, '<section class="ui-section" data-section="appearance"><div class="ui-section-head"><h3 class="ui-section-title">Appearance</h3>' +
    '<button type="button" class="ui-icon-button ui-section-action" data-size="sm" data-action="reset-color" aria-label="Reset colours"><svg class="ui-icon" data-icon="undo"></svg></button></div>' +
    '<div class="ui-section-body"></div></section>');
  const two = renderSection({id: 'selection', title: 'Selection', actions: [{action: 'rotate', icon: 'rotate', label: 'Rotate 15°'}, {action: 'center', icon: 'center', label: 'Centre'}], rows: []}, {icon});
  assert.match(two, /<div class="ui-section-actions"><button[^>]*data-action="rotate"[\s\S]*data-action="center"/);
  const text = renderSection({id: 'arrange', title: 'Arrange', actions: [{action: 'join-figure', label: 'Join…', text: true}], rows: []}, {icon});
  assert.match(text, /<button type="button" class="ui-button ui-section-action" data-variant="ghost" data-size="sm" data-action="join-figure"><span class="ui-label">Join…<\/span><\/button>/);
  assert.equal(MAX_TITLE_ACTIONS, 2);
  assert.throws(() => renderSection({id: 'x', title: 'X', actions: [1, 2, 3].map(n => ({action: `a${n}`, icon: 'plus', label: `A${n}`}))}), /at most 2/);
  assert.throws(() => renderSection({id: 'x', title: 'X', place: 'titled', switch: {label: 'On'}, actions: [1, 2].map(n => ({action: `a${n}`, icon: 'plus', label: `A${n}`}))}), /3 title actions/);
  assert.throws(() => renderSection({id: 'x', title: 'X', switch: {label: 'On'}}), /make it titled/);
  assert.throws(() => renderSection({id: 'x', place: 'titled'}), /needs a title/);
  assert.throws(() => renderSection({id: 'x', place: 'more'}), /unknown place/);
  assert.throws(() => renderSection({id: 'Canvas alignment'}), /Invalid section id/);

  const titled = renderSection({id: 'colours', title: 'Colours', place: 'titled', rows: [{kind: 'value', label: 'Fills', text: 'No fills'}]}, {icon, kind: 'figure'});
  const body = sectionBodyId('figure', 'colours');
  assert.equal(body, 'inspector-section-figure-colours');
  assert.equal(titled, '<section class="ui-section" data-section="colours" data-collapsible><div class="ui-section-head">' +
    `<button type="button" class="ui-section-toggle" aria-expanded="false" aria-controls="${body}" data-section-toggle="colours" data-section-kind="figure">` +
    '<span class="ui-section-title">Colours</span><svg class="ui-icon ui-section-chev" data-icon="chevron-right"></svg></button></div>' +
    `<div class="ui-section-body" id="${body}" hidden><div class="ui-row"><span class="ui-row-label">Fills</span><span class="ui-row-value">No fills</span></div></div></section>`);
  // The title switch has no visible label of its own: it is named, and its tooltip says what it does.
  const parallax = renderSection({id: 'parallax', title: 'Parallax', place: 'titled', switch: {label: 'Enable parallax', checked: true}, rows: []}, {icon, kind: 'layer'});
  assert.match(parallax, /<label class="ui-section-switch" data-tooltip="Enable parallax"><input class="ui-switch" type="checkbox" role="switch" aria-label="Enable parallax" checked><\/label>/);
});

test('titled sections open by their auto-open rule, remember a person per context kind, and reopen when their content matters again', () => {
  const saved = [];
  const memory = new SectionMemory({figure: {colours: true, bogus: 'yes'}, 'Bad kind': {x: true}}, {onChange: value => saved.push(value)});
  const colours = {id: 'colours', title: 'Colours', place: 'titled'};
  const connection = {id: 'connection', title: 'Connection', place: 'titled', open: ctx => ctx.joined};
  assert.deepEqual(memory.toJSON(), {figure: {colours: true}}, 'the saved setting is cleaned');
  assert.equal(resolveSectionOpen(colours, {kind: 'figure', memory}), true, 'remembered open');
  assert.equal(resolveSectionOpen(colours, {kind: 'text', memory}), false, 'per context kind');
  assert.equal(resolveSectionOpen({...colours, place: 'core'}, {kind: 'text', memory}), true, 'core sections are always open');
  assert.equal(resolveSectionOpen(connection, {kind: 'figure', ctx: {joined: true}, memory}), true, 'opens while its content matters');
  assert.equal(resolveSectionOpen(connection, {kind: 'figure', ctx: {joined: false}, memory}), false);
  assert.equal(resolveSectionOpen(connection, {kind: 'figure', ctx: {joined: true}}), true, 'the rule alone without a memory');

  // Closing an auto-opened section dismisses it only until the rule stops holding.
  memory.toggle('figure', 'connection', false, {auto: true});
  assert.equal(memory.isOpen('figure', connection, {joined: true}), false);
  assert.equal(memory.isOpen('figure', connection, {joined: false}), false);
  assert.equal(memory.isOpen('figure', connection, {joined: true}), true, 'the next time it matters it opens again');
  assert.equal(saved.length, 0, 'dismissals are not saved');

  assert.equal(memory.toggle('figure', 'colours', false), true);
  assert.equal(memory.toggle('figure', 'colours', false), false, 'no change, no save');
  assert.equal(memory.toggle('joint', 'ik-defaults', true), true);
  assert.deepEqual(saved, [{}, {joint: {'ik-defaults': true}}]);
  assert.equal(memory.toggle('joint', 'Bad id', true), false);

  const html = renderSection(connection, {icon, kind: 'figure', ctx: {joined: true}, memory});
  assert.match(html, /data-collapsible data-open>/); assert.match(html, /aria-expanded="true"[^>]*data-auto>/); assert.doesNotMatch(html, / hidden>/);

  const many = Object.fromEntries(Array.from({length: 80}, (_, i) => [`kind-${i}`, Object.fromEntries(Array.from({length: 90}, (_, j) => [`s-${j}`, true]))]));
  const bounded = normalizeSectionMemory(many);
  assert.equal(Object.keys(bounded).length, 48); assert.equal(Object.keys(bounded['kind-0']).length, 64);
  assert.deepEqual(normalizeSectionMemory(null), {}); assert.deepEqual(normalizeSectionMemory([1]), {});
});

test('closing a section while its rule holds also forgets that the person had opened it', () => {
  const saved = [];
  const memory = new SectionMemory({layer: {parallax: true}}, {onChange: value => saved.push(value)});
  const parallax = {id: 'parallax', title: 'Parallax', place: 'titled', open: ctx => ctx.on};
  assert.equal(memory.isOpen('layer', parallax, {on: false}), true, 'opened by the person before');
  memory.toggle('layer', 'parallax', false, {auto: true});
  assert.equal(memory.isOpen('layer', parallax, {on: true}), false, 'closed while it matters');
  assert.equal(memory.isOpen('layer', parallax, {on: false}), false, 'the last explicit action wins when the rule stops holding');
  assert.deepEqual(memory.toJSON(), {});
  assert.deepEqual(saved, [{}]);
  assert.equal(memory.isOpen('layer', parallax, {on: true}), true, 'and it opens again the next time it matters');
});

test('the sections are the inspector body; the head (scope slot, quick actions) and the foot render for their own hosts', () => {
  const editor = new Editor();
  editor.select(1);
  const descriptor = {...figureInspector(editor), scope: {label: 'Editing frames 22–28', stop: {command: 'toggle-range-edit', tip: 'Edit only this frame'}}};
  const body = kitHTML(descriptor, {ctx: {joined: false}, memory: new SectionMemory()});
  assert.ok(body.startsWith('<section class="ui-section" data-section="name">'), 'the body holds only sections by default');
  assert.doesNotMatch(body, /ui-scope|ui-quick|inspector-foot/);
  const head = renderInspectorHead(descriptor, {icon});
  assert.equal(head, '<div class="ui-scope" id="inspector-scope" role="status"><span class="ui-dot" data-tint="select" aria-hidden="true"></span><span>Editing frames 22–28</span>' +
    '<button type="button" class="ui-button" data-variant="ghost" data-size="sm" data-command="toggle-range-edit" data-tooltip="Edit only this frame"><span class="ui-label">Stop</span></button></div>' +
    '<div class="ui-quick" role="toolbar" aria-label="Figure actions" data-quick-context="figure" data-inspector-owned="quick-figure"></div>');
  assert.equal(renderFooter(descriptor.footer, {icon}), '<div class="inspector-foot" id="inspector-foot"><button type="button" class="ui-button" data-variant="ghost" data-size="sm" data-action="add-to-library">' +
    '<svg class="ui-icon" data-icon="library"></svg><span class="ui-label">Add to library</span></button></div>');
  const whole = kitHTML(descriptor, {ctx: {joined: false}, memory: new SectionMemory()}, {head: true, foot: true});
  assert.equal(whole, head + body + renderFooter(descriptor.footer, {icon}));
  const ids = tags(whole).map(entry => entry.attrs.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, `ids are unique: ${ids}`);
  for (const section of tags(whole).filter(entry => entry.tag === 'section')) assert.ok(section.attrs['data-section'], 'every section has its identity');
  for (const owned of tags(whole).filter(entry => 'data-inspector-owned' in entry.attrs)) assert.ok(owned.attrs['data-inspector-owned'], 'owned hosts are keyed');
  for (const toggle of tags(whole).filter(entry => entry.attrs['aria-controls'])) assert.ok(ids.includes(toggle.attrs['aria-controls']), 'toggles control a rendered region');
  assert.equal(renderQuickSlot(), ''); assert.equal(renderFooter([]), '');
  assert.equal(renderQuickSlot({context: 'joint'}, {t: key => (key === 'inspector.actions' ? 'Azioni' : key)}).includes('aria-label="Azioni"'), true);
  assert.throws(() => renderQuickSlot({context: 'Figure!'}), /Invalid quick actions context/);
  assert.throws(() => kitHTML({kind: 'figure', sections: [{id: 'a'}, {id: 'a', hidden: true}]}), /Duplicate section id: a/);
  assert.throws(() => kitHTML({kind: 'figure', sections: [{id: 'a', rows: [{kind: 'diamond'}]}]}), /Unknown inspector row kind: diamond/);
  assertNoKeyState(whole);
});

test('optional content never shifts what follows it: the scope slot, hidden sections and absent rows keep their places', () => {
  // The scope slot is always the head's first node, empty and hidden while no edit reaches beyond the selection.
  assert.equal(renderScope(null), '<div id="inspector-scope" role="status" hidden></div>');
  const off = renderInspectorHead({quick: {context: 'figure'}}), on = renderInspectorHead({quick: {context: 'figure'}, scope: {label: 'Editing frames 2–4'}});
  const quickAt = html => tags(html).findIndex(entry => entry.attrs['data-quick-context']);
  assert.equal(quickAt(off), 1); assert.ok(quickAt(on) > 0 && tags(on)[quickAt(on)].attrs['data-inspector-owned'] === 'quick-figure');
  // A context whose sections and rows come and go: the top-level identities after them stay at their indexes.
  const context = shown => ({kind: 'figure', sections: [
    {id: 'text', title: 'Text', hidden: !shown, rows: [{kind: 'actions', items: [{action: 'edit-text', label: 'Edit text', text: true}]}]},
    shown && {id: 'extra', title: 'Extra', rows: []},
    {id: 'transform', title: 'Transform', rows: [{kind: 'grid', rows: [
      shown && {kind: 'number', key: 'a', label: 'A', value: 1},
      {kind: 'number', key: 'root_x', label: 'X', value: 1},
    ]}]},
  ]});
  const top = html => {
    let depth = 0;
    const out = [];
    for (const match of html.matchAll(/<(\/?)section\b([^>]*)>/g)) {
      if (!match[1] && depth++ === 0) out.push(/data-section="([^"]*)"/.exec(match[2])?.[1] ?? '');
      if (match[1]) depth--;
    }
    return out;
  };
  assert.deepEqual(top(kitHTML(context(false))), ['text', '', 'transform']);
  assert.deepEqual(top(kitHTML(context(true))), ['text', 'extra', 'transform']);
  for (const shown of [false, true]) {
    const html = kitHTML(context(shown)), grid = html.slice(html.indexOf('<div class="ui-field-grid">'));
    assert.equal(grid.indexOf('data-property-row="root_x"') > grid.indexOf(shown ? 'data-property-row="a"' : ROW_PLACEHOLDER), true);
  }
});

test('a skin renders the kinds, placeholder and section list it names; the kit renders the rest, sub-module markup as it is', () => {
  const skin = {placeholder: '', rows: {number: row => `<i>${row.key}</i>`}, sections: (list, env) => list.map(section => renderRow(section.rows[0], env)).join('|')};
  assert.equal(renderRow({kind: 'number', key: 'root_x'}, {skin}), '<i>root_x</i>');
  assert.equal(renderRow({kind: 'number', key: 'root_x', hidden: true}, {skin}), '', 'the skin\'s placeholder');
  assert.equal(renderRow(null, {skin}), '');
  assert.equal(renderRow({kind: 'markup', html: '<section class="rig">Rig</section>'}), '<section class="rig">Rig</section>');
  assert.equal(renderRow({kind: 'meta', text: 'Facts'}, {skin}), '<div class="inspector-meta">Facts</div>', 'kinds the skin leaves fall back to the kit');
  assert.equal(renderInspector({kind: 'figure', sections: [{id: 'a', rows: [{kind: 'number', key: 'x'}]}, {id: 'b', rows: [{kind: 'markup', html: '<b>m</b>'}]}]}, {skin}), '<i>x</i>|<b>m</b>');
  assert.throws(() => renderInspector({kind: 'figure', sections: [{id: 'a', rows: []}, {id: 'a', rows: []}]}, {skin}), /Duplicate section id/);
  assert.equal(rowControls({kind: 'markup', html: '<button></button>'}), 0, 'a markup row counts only the controls it declares');
  assert.equal(rowControls({kind: 'markup', html: '', controls: 3}), 3);
});

test('buttons, fields and swatches use the one tooltip, never a native title (unless a test still reads it)', () => {
  assert.equal(renderButton({action: 'add', icon: 'plus', label: 'Add'}, {icon}), '<button type="button" class="ui-icon-button" data-action="add" aria-label="Add"><svg class="ui-icon" data-icon="plus"></svg></button>',
    'an icon button needs nothing more: its aria-label feeds the tooltip');
  assert.match(renderButton({action: 'add', icon: 'plus', label: 'Add', tip: 'Add a key'}, {icon}), /aria-label="Add" data-tooltip="Add a key">/);
  assert.match(renderButton({action: 'join-figure', icon: 'link', label: 'Join figure', legacyTitle: true}, {icon}), /aria-label="Join figure" title="Join figure">/);
  assert.match(renderRow({kind: 'swatches', label: 'Recent', items: [{value: '#ffffff', label: 'Use #FFFFFF', tip: '#FFFFFF'}]}), /aria-label="Use #FFFFFF" data-tooltip="#FFFFFF" tabindex="0"/);
  const every = kitHTML(figureInspector((() => { const editor = new Editor(); editor.select(1); return editor; })()), {}, {head: true, foot: true}) +
    renderSection(ikSection({enabled: true, pinned: false, allowStretch: true, bendDirection: 0, chainLength: 1, maxLength: 2, target: {rotation: 0}}), {icon});
  assertNoTitles(every, ['join-figure']);
});

test('every context fits the inspector budget at rest, and the budget counts what the audit counts', () => {
  assert.deepEqual(INSPECTOR_BUDGET, {controls: 30, openSections: 5, titledSections: 8, coreSections: 3});
  assert.equal(rowControls({kind: 'number', key: 'x'}), 2, 'a keyed field and its scrub label');
  assert.equal(rowControls({kind: 'number', id: 'x'}), 1);
  assert.equal(rowControls({kind: 'stepper-field', key: 'x'}), 4);
  assert.equal(rowControls({kind: 'swatches', items: [{}, {}, {}]}), 1, 'a collection counts once');
  assert.equal(rowControls({kind: 'segmented', options: [{}, {}, {}]}), 3);
  assert.equal(rowControls({kind: 'grid', rows: [{kind: 'select'}, {kind: 'number', key: 'x', hidden: true}, false]}), 1);
  assert.equal(rowControls({kind: 'group', hidden: true, rows: [{kind: 'select'}]}), 0);
  for (const kind of ['meta', 'value', 'preview']) assert.equal(rowControls({kind}), 0);
  const many = {kind: 'crowded', sections: Array.from({length: 6}, (_, i) => ({id: `s${i}`, title: `S${i}`, rows: [{kind: 'grid', rows: [{kind: 'number', key: `k${i}`}, {kind: 'number', key: `j${i}`}, {kind: 'number', key: `h${i}`}]}]}))};
  assert.deepEqual(inspectorBudgetProblems(many), ['crowded: 36 controls > 30', 'crowded: 6 open sections > 5', 'crowded: 6 titled core sections > 3']);
  const titled = {kind: 'folded', sections: Array.from({length: 9}, (_, i) => ({id: `t${i}`, title: `T${i}`, place: 'titled', rows: []}))};
  assert.deepEqual(inspectorBudgetProblems(titled), ['folded: 9 titled sections > 8']);
  // A remembered section is not at rest: the memory decides what is open.
  const memory = new SectionMemory({folded: {t0: true}});
  assert.equal(inspectorBudgetProblems({...titled, sections: titled.sections.slice(0, 2)}, {memory}).length, 0);
});

test('syncQuickHost keeps one quick-actions controller bound to the rendered row', () => {
  const figure = {dataset: {quickContext: 'figure'}}, joint = {dataset: {quickContext: 'joint'}};
  let current = figure;
  const root = {querySelector: selector => (selector === '.ui-quick[data-quick-context]' ? current : null)};
  const made = [];
  const create = options => { const controller = {element: options.host, options, destroyed: 0, destroy() { this.destroyed++; }}; made.push(controller); return controller; };
  const first = syncQuickHost(root, null, {create, registry: 'registry', pins: ['mirror']});
  assert.equal(first.element, figure);
  assert.equal(first.options.context, 'figure');
  assert.equal(first.options.registry, 'registry');
  assert.deepEqual(first.options.pins, ['mirror']);
  assert.equal(syncQuickHost(root, first, {create}), first, 'the same host keeps its controller');
  current = joint;
  const second = syncQuickHost(root, first, {create});
  assert.equal(first.destroyed, 1, 'a replaced host releases the old controller');
  assert.equal(second.element, joint); assert.equal(second.options.context, 'joint');
  current = null;
  assert.equal(syncQuickHost(root, second, {create}), null);
  assert.equal(second.destroyed, 1);
  assert.equal(made.length, 2);
});

test('descriptors are escaped and cannot add handlers, styles or raw ids', () => {
  const hostile = '"><img src=x onerror=alert(1)>';
  const html = renderRow({kind: 'select', label: hostile, options: [{value: hostile, label: hostile}]}, {icon}) +
    renderRow({kind: 'number', key: 'k', label: hostile, value: 1, description: hostile}) + renderButton({action: hostile, label: hostile, text: true});
  assert.doesNotMatch(html, /<img/);
  assert.equal(escapeHTML(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(attributes({a: 1, b: true, c: false, d: null, e: undefined, f: 0}), ' a="1" b f="0"');
  assert.throws(() => renderRow({kind: 'switch', label: 'x', attrs: {onclick: 'alert(1)'}}), /not allowed/);
  assert.throws(() => renderRow({kind: 'switch', label: 'x', attrs: {style: 'color:red'}}), /not allowed/);
  assert.throws(() => renderRow({kind: 'switch', label: 'x', data: {'Bad Name': 1}}), /Invalid data attribute/);
  assert.throws(() => renderRow({kind: 'switch', id: 'a b', label: 'x'}), /Invalid control id/);
  assert.throws(() => renderRow({kind: 'group', id: 'a b', rows: []}), /Invalid control id/);
  assert.throws(() => renderButton({action: 'x'}), /needs a label/);
  // Swatch paints cannot break out of their custom property.
  for (const paint of ['red;background:url(x)', 'url(javascript:alert(1))', 'linear-gradient(red,blue)}body{color:red', 'expression(alert(1))"'])
    assert.doesNotMatch(renderRow({kind: 'color', picker: 'paint', id: 'c', label: 'C', paint}), /style=/, paint);
  assert.doesNotMatch(renderRow({kind: 'swatches', label: 'S', items: [{value: '#fff;x:y', label: 'S'}]}), /style=/);
});

test('value helpers: slider fill, units, accessible names, the fade and the scrub hint', () => {
  assert.equal(sliderFill(50, 0, 200), '25%'); assert.equal(sliderFill(-5, 0, 10), '0%'); assert.equal(sliderFill(99, 0, 10), '100%');
  assert.equal(sliderFill(1, 1, 1), '0%'); assert.equal(sliderFill('x', 0, 1), '0%');
  assert.equal(formatValueWithUnit(100, {unit: '%'}), '100%'); assert.equal(formatValueWithUnit(172.04, {unit: '°', precision: 1}), '172°');
  assert.equal(formatValueWithUnit(8, {unit: 'px'}), '8 px'); assert.equal(formatValueWithUnit(24, {unit: 'fps'}), '24 fps');
  assert.equal(formatValueWithUnit(Infinity, {unit: 'px'}), '');
  assert.equal(describeField('X', 'px'), 'X (px)'); assert.equal(describeField('Angle', '°'), 'Angle (degrees)'); assert.equal(describeField('Order'), 'Order');
  assert.equal(describeField('Angle', '°', {t: key => ({'inspector.unit.degrees': 'gradi', 'inspector.withUnit': '{label} ({unit})'})[key] ?? key}), 'Angle (gradi)');
  assert.equal(hasMoreBelow({scrollTop: 0, clientHeight: 100, scrollHeight: 300}), true);
  assert.equal(hasMoreBelow({scrollTop: 200, clientHeight: 100, scrollHeight: 300.5}), false);
  assert.equal(SCRUB_HINT, 'Drag a label to scrub · Shift ×0.1 · Alt ×0.01');
});

test('the kit\'s own words live in their catalog fragment and translate', () => {
  for (const key of Object.keys(inspectorStrings)) {
    assert.ok(key.startsWith('inspector.'), `${key} is in the inspector namespace`);
    assert.ok(!Object.hasOwn(english, key), `${key} is defined once, in en-inspector.mjs`);
  }
  const source = readFileSync(new URL('../src/inspector-kit.mjs', import.meta.url), 'utf8');
  for (const [, key] of source.matchAll(/say\([^,]+, '([\w.]+)'/g)) assert.ok(Object.hasOwn(inspectorStrings, key), `${key} has an English text`);
  const t = key => ({'inspector.stop': 'Ferma', 'inspector.mixed': 'Misto', 'inspector.scrubLabel': 'Trascina {name}'})[key] ?? key;
  assert.match(renderScope({label: 'x', stop: {command: 'c'}}, {t}), /<span class="ui-label">Ferma<\/span>/);
  assert.match(renderRow({kind: 'number', key: 'k', label: 'K', value: 1, mixed: true}, {t}), /aria-label="Trascina K"[\s\S]*placeholder="Misto"/);
});

// ---------------------------------------------------------------------------
// Stylesheets: each passes the layered-CSS lint where app.css will import it,
// and reads only tokens tokens.css defines (or a private/data property). A
// fallback in var() is for data properties only (components.md §0.3: no
// colour fallbacks); PENDING lists the spec tokens tokens.css must add before
// app.css imports these sheets.

const SHEETS = ['components/field.css', 'components/slider.css', 'components/select.css', 'components/stepper.css', 'components/switch.css',
  'components/check.css', 'components/swatch.css', 'components/form.css', 'components/section.css', 'components/list-row.css', 'features/inspector.css'];
const PENDING_TOKENS = Object.freeze(['--type-value', '--space-3-5']);
test('the kit stylesheets pass the stylesheet lint and read defined tokens', () => {
  const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  const DATA = new Set(['--swatch', '--swatch-paint', '--level', '--_p', '--_vch']);
  assert.ok(!existsSync(new URL('../src/styles/components/card.css', import.meta.url)), 'the retired card has no stylesheet');
  for (const sheet of SHEETS) {
    const file = new URL(`../src/styles/${sheet}`, import.meta.url);
    assert.ok(existsSync(file), `${sheet} exists`);
    const css = readFileSync(file, 'utf8');
    assert.deepEqual(lintCss(css, `src/styles/${sheet}`), [], `${sheet} lint`);
    const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
    for (const [, name, fallback] of css.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
      const own = name.startsWith('--_') || DATA.has(name) || declared.has(name);
      assert.ok(own || defined.has(name) || PENDING_TOKENS.includes(name), `${sheet}: ${name} is not a token`);
      assert.ok(!fallback || own, `${sheet}: ${name} has a fallback; tokens have none`);
    }
    assert.doesNotMatch(css, /ui-key|diamond|ui-card/i, `${sheet}: no key state, no card`);
  }
});
