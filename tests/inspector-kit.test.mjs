import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {parse} from '../vendor/text/opentype.mjs';
import {Editor} from '../src/editor.mjs';
import {inspectorView} from '../src/inspector-view.mjs';
import {ikControlsView} from '../src/ik-view.mjs';
import {compileTextFigure} from '../src/text-authoring.mjs';
import {createImageFigure} from '../src/media-authoring.mjs';
import {lintCss} from '../scripts/check-css.mjs';
import {
  MAX_TITLE_ACTIONS, SCRUB_HINT, SectionMemory, attributes, escapeHTML, formatValueWithUnit, normalizeSectionMemory, renderButton,
  renderFooter, renderInspector, renderQuickSlot, renderRow, renderScope, renderSection, resolveSectionOpen, restDisplayPrecision,
  sectionBodyId, sliderFill,
} from '../src/inspector-kit.mjs';
import {
  brushInspector, cameraInspector, figureInspector, ikSection, jointInspector, layerInspector, sceneInspector,
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
function tag(html, where, label = JSON.stringify(where)) {
  const found = tags(html).find(entry => matches(entry, where));
  assert.ok(found, `no element with ${label}`);
  return found;
}
const pick = (entry, names) => Object.fromEntries(names.map(name => [name, entry.attrs[name] ?? null]));
/** The text of an element's options (a select's contract: value, selected, disabled, label). */
function options(html, where) {
  const select = tag(html, where), close = html.indexOf('</select>', select.end);
  return [...html.slice(select.end, close).matchAll(/<option((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*>([^<]*)<\/option>/g)].map(([, attrs, text]) => {
    const entry = {attrs: Object.fromEntries([...attrs.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, decode(value ?? '')]))};
    return {value: entry.attrs.value ?? null, selected: 'selected' in entry.attrs, disabled: 'disabled' in entry.attrs, text: decode(text)};
  });
}

const NUMBER = ['type', 'id', 'data-field', 'data-property', 'data-property-value', 'data-property-precision', 'data-property-display-precision',
  'data-property-step', 'value', 'step', 'aria-label', 'min', 'max', 'disabled'];
const SCRUB = ['data-property-scrub', 'tabindex', 'role', 'aria-label', 'title'];
/** A PropertyControls number: its row, its input and the scrub label inside the row are the same today and in the kit. */
function assertNumberParity(today, kit, key, names = NUMBER) {
  for (const [html, source] of [[today, 'today'], [kit, 'kit']]) tag(html, {'data-property-row': key}, `${source} data-property-row=${key}`);
  const expected = tag(today, {'data-property': key}), actual = tag(kit, {'data-property': key});
  assert.deepEqual(pick(actual, names), pick(expected, names), `${key} input`);
  const scrub = (html, row) => tags(html).find(entry => entry.index > row.index && 'data-property-scrub' in entry.attrs);
  const todayScrub = scrub(today, tag(today, {'data-property-row': key})), kitScrub = scrub(kit, tag(kit, {'data-property-row': key}));
  assert.deepEqual(pick(kitScrub, SCRUB), pick(todayScrub, SCRUB), `${key} scrub label`);
  assert.ok(kitScrub.index < actual.index, `${key}: the scrub label precedes its input inside the row`);
}
function assertParity(today, kit, where, names) {
  assert.deepEqual(pick(tag(kit, where, `kit ${JSON.stringify(where)}`), names), pick(tag(today, where, `today ${JSON.stringify(where)}`), names), JSON.stringify(where));
}
const assertOptions = (today, kit, where) => assert.deepEqual(options(kit, where), options(today, where), `${JSON.stringify(where)} options`);
const icon = (name, className) => `<svg class="${className}" data-icon="${name}"></svg>`;
const kitHTML = (descriptor, env = {}) => renderInspector(descriptor, {icon, ...env});
function assertNoKeyState(html) {
  for (const hook of ['data-property-key', 'data-property-nav', 'property-key-controls', 'ui-key', 'data-icon="diamond"'])
    assert.ok(!html.includes(hook), `the inspector shows no key state (${hook})`);
}

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
  const today = inspectorView({editor}), kit = kitHTML(figureInspector(editor));
  for (const key of ['root_x', 'root_y', 'scale', 'rotation', 'figure_opacity', 'figure_z_order']) assertNumberParity(today, kit, key);
  assert.equal(tag(kit, {'data-property': 'scale'}).attrs['data-field'], 'scale', 'legacy data-field stays');
  assert.equal(tag(kit, {'data-property': 'figure_opacity'}).attrs['data-field'], undefined, 'no data-field where today has none');
  assertParity(today, kit, {id: 'figure-color'}, ['type', 'value', 'aria-label']);
  assertParity(today, kit, {id: 'figure-name'}, ['value', 'aria-label', 'title']);
  assertParity(today, kit, {id: 'figure-layer'}, ['aria-label']);
  assertOptions(today, kit, {id: 'figure-layer'});
  for (const action of ['reset-color', 'layer-down', 'layer-up', 'join-figure'])
    assertParity(today, kit, {'data-action': action}, ['aria-label', 'data-action']);
  tag(kit, {'data-action': 'combine-figures'});
  const color = tag(today, {'data-palette-color': true}).attrs['data-palette-color'];
  assertParity(today, kit, {'data-palette-color': color}, ['data-paint-picker', 'aria-label']);
  // Today's exact attribute run, which string tests read.
  assert.ok(kit.includes('data-property-precision="3" data-property-display-precision="1"'));
  assertNoKeyState(kit);
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

  const image = new Editor({demo: false});
  image.importFigure(createImageFigure({dataUrl: PNG, width: 1, height: 1, name: 'Placed sprite'}));
  today = inspectorView({editor: image}); descriptor = figureInspector(image); kit = kitHTML(descriptor);
  assert.equal(descriptor.kind, 'image');
  for (const key of ['root_x', 'root_y', 'scale', 'rotation', 'figure_opacity']) assertNumberParity(today, kit, key);
  assertParity(today, kit, {id: 'figure-color'}, ['type', 'value', 'aria-label']);
  assertParity(today, kit, {id: 'figure-name'}, ['value']);
});

test('joint inspector: pose fields, Static, IK and the segment style keep their contract', () => {
  const editor = new Editor();
  editor.select(1, 2);
  const today = inspectorView({editor}), kit = kitHTML(jointInspector(editor));
  for (const key of ['joint_angle', 'joint_length', 'joint_bend', 'thickness', 'segment_z_order', 'segment_opacity']) assertNumberParity(today, kit, key);
  for (const key of ['thickness', 'joint_angle', 'joint_length']) assert.equal(tag(kit, {'data-property': key}).attrs['data-field'], key);
  assertParity(today, kit, {id: 'static-joint'}, ['type', 'role', 'aria-label', 'checked']);
  assertParity(today, kit, {id: 'segment-shape'}, ['aria-label', 'disabled']);
  assertOptions(today, kit, {id: 'segment-shape'});
  assertParity(today, kit, {id: 'segment-color'}, ['type', 'data-paint-picker', 'aria-label']);
  assertParity(today, kit, {id: 'node-is-ik'}, ['type', 'role', 'aria-label', 'aria-controls', 'checked']);
  // The Static switch is a field switch in the Joint grid.
  assert.match(kit, /<label class="ui-field" data-switch-field><span class="ui-field-label">Static<\/span><input class="ui-switch" type="checkbox" role="switch" id="static-joint"/);
  assertNoKeyState(kit);
});

test('IK options keep their ids, the chain stepper and the native bend radios', () => {
  const ik = {enabled: true, pinned: true, allowStretch: false, bendDirection: 1, chainLength: 2, maxLength: 3, target: {rotation: 0.5}};
  const today = ikControlsView(ik), kit = renderSection(ikSection(ik), {icon, kind: 'joint'});
  for (const id of ['node-ik-pinned', 'node-ik-stretch']) assertParity(today, kit, {id}, ['type', 'role', 'aria-label', 'checked']);
  assertParity(today, kit, {id: 'node-ik-chain'}, ['type', 'min', 'max', 'step', 'value', 'aria-label']);
  assertParity(today, kit, {id: 'node-ik-rotation'}, ['type', 'step', 'value', 'aria-label']);
  for (const value of ['-1', '0', '1']) assertParity(today, kit, {name: 'node-ik-bend', value}, ['type', 'checked', 'aria-label']);
  // Plain step buttons: the kit applies them within the input's limits.
  assert.equal(tags(kit).filter(entry => 'data-kit-step' in entry.attrs).length, 2);
});

test('camera inspector: transform fields, the monitor and the pose commands keep their hooks', () => {
  const editor = new Editor();
  const today = inspectorView({editor, context: 'camera'}), kit = kitHTML(cameraInspector(editor));
  for (const key of ['camera_x', 'camera_y', 'camera_scale', 'camera_angle']) assertNumberParity(today, kit, key);
  assertParity(today, kit, {'data-camera-monitor': true}, ['aria-label']);
  tag(kit, {'data-camera-magnification': true});
  for (const tab of ['transform', 'motion']) assertParity(today, kit, {'data-camera-tab': tab}, ['role', 'aria-selected']);
  for (const action of ['camera-copy', 'camera-paste']) assertParity(today, kit, {'data-action': action}, ['aria-label', 'disabled']);
  // The monitor is drawn imperatively: its canvas is an owned host.
  assert.equal(tag(kit, {'data-camera-monitor': true}).attrs['data-inspector-owned'], 'camera-monitor');
  assertNoKeyState(kit);
});

test('scene inspector: canvas size, background colour and rate keep their hooks', () => {
  const editor = new Editor();
  const today = inspectorView({editor, context: 'scene'}), kit = kitHTML(sceneInspector(editor));
  for (const key of ['canvas_width', 'canvas_height', 'fps']) assertNumberParity(today, kit, key);
  assertParity(today, kit, {id: 'background-color'}, ['type', 'value', 'aria-label']);
  for (const action of ['background-style', 'import-background']) assertParity(today, kit, {'data-action': action}, ['aria-label']);
  assert.ok(kit.includes('data-property-precision="0" data-property-display-precision="0"'), 'integer properties edit without decimals');
});

test('drawing layer inspector: name, visibility, lock and parallax keep their hooks', () => {
  const editor = new Editor({layerTimeline: true, propertyChannels: true});
  const layer = editor.createDrawingLayer();
  const today = inspectorView({editor, context: 'layer'}), kit = kitHTML(layerInspector(editor));
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
});

test('drawing brush inspector: preview, recent colours, Blend and Lock alpha keep their hooks', () => {
  const editor = new Editor({layerTimeline: true, propertyChannels: true});
  editor.createDrawingLayer();
  const settings = {color: '#223344', color2: '#ffffff', blend: 'multiply', alphaLock: true, preset: 'ink', hardness: 0.5, roundness: 1, angle: 0, spacingRatio: 0.08,
    taperIn: 0, taperOut: 0, stabilizerMode: 'average', tip: 'round', angleMode: 'fixed', grain: 'noise', texture: 0, grainScale: 1, pressureSize: true,
    pressureOpacity: false, pressureFlow: false, sizeCurve: 1, opacityCurve: 1, sizeJitter: 0, opacityJitter: 0, angleJitter: 0, scatter: 0, mirrorY: false,
    resolution: 1, filter: 'smooth'};
  const drawing = {active: true, editor, tool: 'brush', settings, library: {recent: ['#ff0000', '#223344'], presets: []}, state: {view: {}}};
  const today = inspectorView({editor, drawing}), kit = kitHTML(brushInspector(drawing));
  assertParity(today, kit, {'data-brush-preview': true}, ['data-section', 'aria-label']);
  assert.ok('data-inspector-owned' in tag(kit, {'data-brush-preview': true}).attrs, 'the preview stays an owned host');
  assertParity(today, kit, {'data-draw-setting': 'blend'}, ['aria-label', 'data-draw-text']);
  assertOptions(today, kit, {'data-draw-setting': 'blend'});
  assertParity(today, kit, {id: 'draw-alphaLock'}, ['type', 'role', 'aria-label', 'checked', 'data-draw-setting']);
  for (const color of ['#ff0000', '#223344']) assertParity(today, kit, {'data-draw-color': color}, ['aria-label', 'title', 'aria-pressed']);
});

// ---------------------------------------------------------------------------
// Fields

test('number fields carry the PropertyControls hooks, the unit after the value and no key state', () => {
  const html = renderRow({kind: 'number', key: 'root_x', label: 'X', unit: 'px', value: 456.36396, min: -10, max: 1000}, {icon});
  assert.equal(html, '<label class="ui-field" data-property-row="root_x"><span class="ui-field-label" data-property-scrub tabindex="0" role="button" ' +
    'aria-label="Scrub X (px)" title="Drag to adjust · Shift: fine · Alt: extra fine">X</span><input class="ui-field-input" type="number" data-field="root_x" ' +
    'data-property="root_x" data-property-value="456.36396" data-property-precision="3" data-property-display-precision="1" data-property-step="1" value="456.4" ' +
    'step="any" aria-label="X (px)" min="-10" max="1000"><span class="ui-field-suffix" aria-hidden="true">px</span></label>');
  assert.match(renderRow({kind: 'number', key: 'scale', label: 'Scale', unit: '%', value: 100}), /<span class="ui-field-suffix" aria-hidden="true" data-glue>%<\/span>/);
  // Integers edit and show without decimals; a Mixed value keeps the model value for PropertyControls.
  const order = renderRow({kind: 'number', key: 'fps', label: 'Rate', unit: 'fps', precision: 0, value: 24});
  assert.match(order, /data-property-precision="0" data-property-display-precision="0"/);
  const mixed = renderRow({kind: 'number', key: 'group_x', label: 'X', value: 12, mixed: true});
  assert.match(mixed, /data-mixed/); assert.match(mixed, /data-property-value="12"/); assert.match(mixed, /value="" /); assert.match(mixed, /placeholder="Mixed"/);
  // Without a key: a plain number, no scrub hooks.
  const plain = renderRow({kind: 'number', id: 'node-ik-rotation', label: 'Rotation', unit: '°', value: 28.6479, precision: 2, step: 1});
  assert.doesNotMatch(plain, /data-property/);
  assert.match(plain, /value="28.65"/);
  assert.equal(restDisplayPrecision(3, 'px'), 1); assert.equal(restDisplayPrecision(3, ''), 2); assert.equal(restDisplayPrecision(0, 'px'), 0);
  assert.equal(renderRow({kind: 'number', key: 'x', label: 'X', value: 1, tip: 'Custom'}).includes('title="Custom"'), true);
  assert.equal(renderRow({kind: 'number', key: 'x', label: 'X', value: 1}, {t: key => (key === 'inspector.scrubTip' ? 'Ziehen' : key)}).includes('title="Ziehen"'), true);
});

test('the stepper field keeps its step buttons outside the property row', () => {
  const html = renderRow({kind: 'stepper-field', key: 'figure_z_order', label: 'Order', description: 'Z-index', precision: 0, value: 2,
    down: {action: 'layer-down', label: 'Send backward', icon: 'chevron-left'}, up: {action: 'layer-up', label: 'Bring forward', icon: 'chevron-right'}}, {icon});
  const core = html.match(/<span class="ui-field-core" data-property-row="figure_z_order">(.*?)<\/span><button/)?.[1];
  assert.ok(core, 'a property row wraps the label and value');
  assert.match(core, /data-property-scrub/); assert.match(core, /data-property="figure_z_order"/); assert.doesNotMatch(core, /<button/);
  assert.match(html, /^<div class="ui-field" data-steps role="group" aria-label="Z-index">/);
  assert.match(html, /data-action="layer-down" aria-label="Send backward"/);
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
  assert.match(bare, /^<label class="ui-field" data-select data-bare title="Layer"><select/);
  assert.doesNotMatch(bare, /ui-field-label|Mixed/);
  assert.match(bare, /data-icon="chevron-down"/);
});

test('switches, checkboxes, colours, segmented controls and sliders render their component patterns', () => {
  assert.equal(renderRow({kind: 'field-switch', id: 'pin-joint', label: 'Pin joint', checked: false, tip: 'Hold this joint still'}),
    '<label class="ui-field" data-switch-field title="Hold this joint still"><span class="ui-field-label">Pin joint</span><input class="ui-switch" type="checkbox" role="switch" id="pin-joint" aria-label="Pin joint"></label>');
  assert.equal(renderRow({kind: 'switch', label: 'Sample all layers', checked: true, data: {'draw-setting': 'sampleAll'}}),
    '<label class="ui-switch-row"><span>Sample all layers</span><input class="ui-switch" type="checkbox" role="switch" aria-label="Sample all layers" checked data-draw-setting="sampleAll"></label>');
  assert.equal(renderRow({kind: 'checkbox', id: 'apply-range-movement', label: 'Apply to 3 selected frames', checked: true}),
    '<label class="ui-check-row"><input class="ui-checkbox" type="checkbox" id="apply-range-movement" checked><span>Apply to 3 selected frames</span></label>');
  // A paint swatch shows gradients; a solid paint is a plain --swatch colour.
  const gradient = renderRow({kind: 'color', picker: 'paint', id: 'segment-color', label: 'Segment color', paint: 'linear-gradient(90deg,rgba(1,2,3,1) 0%,rgba(4,5,6,0.5) 100%)', caption: 'Linear gradient'});
  assert.match(gradient, /style="--swatch-paint:linear-gradient\(90deg,rgba\(1,2,3,1\) 0%,rgba\(4,5,6,0.5\) 100%\)"/);
  assert.match(renderRow({kind: 'color', picker: 'paint', id: 'c', label: 'C', paint: 'rgba(43,43,43,1)'}), /style="--swatch:rgba\(43,43,43,1\)"/);
  assert.match(renderRow({kind: 'color', id: 'figure-color', label: 'Colour', value: '#0D99FF'}), /value="#0d99ff" aria-label="Colour"><span class="ui-field-hex">0D99FF<\/span>/);
  assert.match(renderRow({kind: 'color', id: 'figure-color', label: 'Colour', value: 'red'}), /value="#000000"/);
  const pressed = renderRow({kind: 'segmented', mode: 'pressed', description: 'Connector properties', value: 'slider',
    options: [{value: 'segment', label: 'Segment', data: {'connector-part': 'segment'}}, {value: 'slider', label: 'Slider', data: {'connector-part': 'slider'}}]});
  assert.match(pressed, /aria-pressed="false" data-connector-part="segment"/); assert.match(pressed, /aria-pressed="true" data-connector-part="slider"/);
  assert.throws(() => renderRow({kind: 'segmented', options: [{value: 1, label: 'One'}]}), /2-4 options/);
  assert.throws(() => renderRow({kind: 'segmented', options: [1, 2, 3, 4, 5].map(value => ({value, label: String(value)}))}), /use a select/);
  const slider = renderRow({kind: 'slider', key: 'roundness', label: 'Roundness', min: 5, max: 100, value: 52.5, unit: '%'});
  assert.match(slider, /data-property-row="roundness"/); assert.match(slider, /type="range" data-property="roundness"/);
  assert.match(slider, /aria-valuetext="53%"/); assert.match(slider, /style="--_p:50%"/); assert.match(slider, /<output class="ui-slider-value" aria-hidden="true">53%<\/output>/);
  assert.match(renderRow({kind: 'slider', label: 'Size', min: 0, max: 64, value: 8, unit: 'px'}), /aria-valuetext="8 px"/);
});

test('lists, cards, owned hosts, text fields and action rows', () => {
  const row = renderRow({kind: 'list-row', label: 'Polygon 1', lead: 'polygon', meta: '40%', level: 2, data: {'polygon-index': 0}, actions: [
    {kind: 'swatch', picker: 'native', value: '#aabbcc', label: 'Polygon 1 color', data: {'polygon-color': 0}},
    {icon: 'trash', label: 'Delete polygon 1', data: {'delete-polygon': 0}},
  ]}, {icon});
  assert.match(row, /^<div class="ui-list-row" style="--level:2" data-polygon-index="0"><span class="ui-list-row-lead">/);
  assert.match(row, /<input class="ui-swatch" type="color" value="#aabbcc" aria-label="Polygon 1 color" data-polygon-color="0">/);
  assert.match(row, /<button type="button" class="ui-icon-button" data-size="sm" aria-label="Delete polygon 1" title="Delete polygon 1" data-delete-polygon="0">/);
  const card = renderRow({kind: 'card', media: {tag: 'canvas', key: 'camera-monitor', label: 'Live camera output', data: {'camera-monitor': true}}, caption: ['960 × 540', {text: '100% zoom', data: {'camera-magnification': true}}]});
  assert.equal(card, '<div class="ui-card"><canvas class="ui-card-media" data-inspector-owned="camera-monitor" aria-label="Live camera output" data-camera-monitor></canvas>' +
    '<div class="ui-card-caption"><span>960 × 540</span><span data-camera-magnification>100% zoom</span></div></div>');
  assert.equal(renderRow({kind: 'owned', key: 'motion-graph', label: 'Motion graph', role: 'img', html: '<svg></svg>'}),
    '<div data-inspector-owned="motion-graph" role="img" aria-label="Motion graph"><svg></svg></div>');
  assert.throws(() => renderRow({kind: 'owned'}), /needs a key/);
  assert.equal(renderRow({kind: 'text', id: 'builder-joint-name', label: 'Name', description: 'Joint name', value: 'Neck', maxlength: 120}),
    '<label class="ui-field" data-text><span class="ui-field-label">Name</span><input class="ui-field-input" type="text" id="builder-joint-name" value="Neck" aria-label="Joint name" maxlength="120"></label>');
  const actions = renderRow({kind: 'actions', label: 'Align', items: [{action: 'align-left', icon: 'align-left', label: 'Align left'}, {action: 'add-effect', label: 'Add effect', text: true, variant: 'outline'}]}, {icon});
  assert.match(actions, /^<div class="ui-action-row" role="group" aria-label="Align">/);
  assert.match(actions, /<button type="button" class="ui-button" data-variant="outline" data-action="add-effect"><span class="ui-label">Add effect<\/span><\/button>/);
  assert.equal(renderRow({kind: 'meta', text: '960 × 540 · 24 fps'}), '<p class="inspector-meta">960 × 540 · 24 fps</p>');
  assert.equal(renderRow({kind: 'grid', ratio: '3:2', stackNarrow: true, rows: []}), '<div class="ui-field-grid" data-ratio="3:2" data-stack-narrow></div>');
  assert.equal(renderRow({kind: 'number', key: 'x', label: 'X', value: 1, hidden: true}), '');
});

// ---------------------------------------------------------------------------
// Sections

test('core sections are open with at most two title actions; titled sections fold with their own ids', () => {
  const core = renderSection({id: 'appearance', title: 'Appearance', actions: [{action: 'reset-color', icon: 'undo', label: 'Reset colours'}], rows: []}, {icon});
  assert.equal(core, '<section class="ui-section" data-section="appearance"><div class="ui-section-head"><h3 class="ui-section-title">Appearance</h3>' +
    '<button type="button" class="ui-icon-button ui-section-action" data-size="sm" data-action="reset-color" aria-label="Reset colours" title="Reset colours"><svg class="ui-icon" data-icon="undo"></svg></button></div>' +
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

  const titled = renderSection({id: 'colours', title: 'Colours', place: 'titled', rows: [{kind: 'meta', text: 'No fills'}]}, {icon, kind: 'figure'});
  const body = sectionBodyId('figure', 'colours');
  assert.equal(body, 'inspector-section-figure-colours');
  assert.equal(titled, '<section class="ui-section" data-section="colours" data-collapsible><div class="ui-section-head">' +
    `<button type="button" class="ui-section-toggle" aria-expanded="false" aria-controls="${body}" data-section-toggle="colours" data-section-kind="figure">` +
    '<span class="ui-section-title">Colours</span><svg class="ui-icon ui-section-chev" data-icon="chevron-right"></svg></button></div>' +
    `<div class="ui-section-body" id="${body}" hidden><p class="inspector-meta">No fills</p></div></section>`);
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

test('a whole context: scope line, owned quick actions slot, sections and foot, with unique ids', () => {
  const editor = new Editor();
  editor.select(1);
  const descriptor = {...figureInspector(editor), scope: {label: 'Editing frames 22–28', stop: {command: 'toggle-range-edit', label: 'Stop', tip: 'Edit only this frame'}}};
  const html = kitHTML(descriptor, {ctx: {joined: false}, memory: new SectionMemory()});
  assert.ok(html.startsWith('<div class="ui-scope" id="inspector-scope" role="status"><span class="ui-dot" data-tint="select" aria-hidden="true"></span><span>Editing frames 22–28</span>' +
    '<button type="button" class="ui-button" data-variant="ghost" data-size="sm" data-command="toggle-range-edit" title="Edit only this frame"><span class="ui-label">Stop</span></button></div>' +
    '<div class="ui-quick" role="toolbar" aria-label="Figure actions" data-quick-context="figure" data-inspector-owned="quick-figure"></div>'));
  assert.ok(html.endsWith('<div class="inspector-foot" id="inspector-foot"><button type="button" class="ui-button" data-variant="ghost" data-size="sm" data-action="add-to-library">' +
    '<svg class="ui-icon" data-icon="layers"></svg><span class="ui-label">Add to library</span></button></div>'));
  const ids = tags(html).map(entry => entry.attrs.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, `ids are unique: ${ids}`);
  for (const section of tags(html).filter(entry => entry.tag === 'section')) assert.ok(section.attrs['data-section'], 'every section has its identity');
  for (const owned of tags(html).filter(entry => 'data-inspector-owned' in entry.attrs)) assert.ok(owned.attrs['data-inspector-owned'], 'owned hosts are keyed');
  for (const toggle of tags(html).filter(entry => entry.attrs['aria-controls'])) assert.ok(ids.includes(toggle.attrs['aria-controls']), 'toggles control a rendered body');
  assert.equal(renderScope(null), ''); assert.equal(renderQuickSlot(), ''); assert.equal(renderFooter([]), '');
  assert.throws(() => renderQuickSlot({context: 'Figure!'}), /Invalid quick actions context/);
  assert.throws(() => kitHTML({kind: 'figure', sections: [{id: 'a'}, {id: 'a'}]}), /Duplicate section id: a/);
  assert.throws(() => kitHTML({kind: 'figure', sections: [{id: 'a', rows: [{kind: 'diamond'}]}]}), /Unknown inspector row kind: diamond/);
  assertNoKeyState(html);
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
  assert.throws(() => renderButton({action: 'x'}), /needs a label/);
  // Swatch paints cannot break out of their custom property.
  for (const paint of ['red;background:url(x)', 'url(javascript:alert(1))', 'linear-gradient(red,blue)}body{color:red', 'expression(alert(1))"'])
    assert.doesNotMatch(renderRow({kind: 'color', picker: 'paint', id: 'c', label: 'C', paint}), /style=/, paint);
  assert.doesNotMatch(renderRow({kind: 'swatches', label: 'S', items: [{value: '#fff;x:y', label: 'S'}]}), /style=/);
});

test('value helpers: slider fill, units and the scrub hint', () => {
  assert.equal(sliderFill(50, 0, 200), '25%'); assert.equal(sliderFill(-5, 0, 10), '0%'); assert.equal(sliderFill(99, 0, 10), '100%');
  assert.equal(sliderFill(1, 1, 1), '0%'); assert.equal(sliderFill('x', 0, 1), '0%');
  assert.equal(formatValueWithUnit(100, {unit: '%'}), '100%'); assert.equal(formatValueWithUnit(172.04, {unit: '°', precision: 1}), '172°');
  assert.equal(formatValueWithUnit(8, {unit: 'px'}), '8 px'); assert.equal(formatValueWithUnit(24, {unit: 'fps'}), '24 fps');
  assert.equal(formatValueWithUnit(Infinity, {unit: 'px'}), '');
  assert.equal(SCRUB_HINT, 'Drag a label to scrub · Shift ×0.1 · Alt ×0.01');
});

// ---------------------------------------------------------------------------
// Stylesheets: each passes the layered-CSS lint where app.css will import it,
// and reads only tokens tokens.css defines (or a private/data property, or a
// future token behind a fallback).

const SHEETS = ['components/field.css', 'components/slider.css', 'components/select.css', 'components/stepper.css', 'components/switch.css',
  'components/check.css', 'components/swatch.css', 'components/form.css', 'components/section.css', 'components/card.css',
  'components/list-row.css', 'features/inspector.css'];
test('the kit stylesheets pass the stylesheet lint and read defined tokens', () => {
  const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  const DATA = new Set(['--swatch', '--swatch-paint', '--level', '--_p', '--_vch', '--slider-fill']);
  for (const sheet of SHEETS) {
    const file = new URL(`../src/styles/${sheet}`, import.meta.url);
    assert.ok(existsSync(file), `${sheet} exists`);
    const css = readFileSync(file, 'utf8');
    assert.deepEqual(lintCss(css, `src/styles/${sheet}`), [], `${sheet} lint`);
    const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
    for (const [, name, fallback] of css.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g))
      assert.ok(defined.has(name) || declared.has(name) || name.startsWith('--_') || DATA.has(name) || fallback, `${sheet}: ${name} is not a token`);
    assert.doesNotMatch(css, /ui-key|diamond/i, `${sheet}: no key state`);
  }
});
