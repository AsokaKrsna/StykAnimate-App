/**
 * The inspector's contexts are section descriptors rendered by the inspector
 * kit with the legacy skin (src/inspector-view.mjs, src/inspector-legacy.mjs).
 * Until they move to the kit's own sections, they must produce today's
 * markup: the same elements in the same order, with the same attributes and
 * text, for every context. tests/fixtures/inspector-legacy.mjs holds today's
 * code verbatim; attribute order and whitespace between elements, which
 * neither the page nor updateInspectorDOM() distinguishes, are ignored.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from '../vendor/text/opentype.mjs';
import {Editor} from '../src/editor.mjs';
import {emptyDocument, createFrame, createObject, defaultFigure} from '../src/demo.mjs';
import {rigExampleDocument} from '../src/rig-examples.mjs';
import {construction} from '../src/rig-examples-3d.mjs';
import {compileTextFigure} from '../src/text-authoring.mjs';
import {createImageFigure} from '../src/media-authoring.mjs';
import {movieclipFigure} from '../src/movieclips.mjs';
import {presencePlayback} from '../src/movieclip-presence.mjs';
import {inspectorDescriptor, inspectorView} from '../src/inspector-view.mjs';
import {ikControlsView, ikSection} from '../src/ik-view.mjs';
import {movieclipInspector} from '../src/movieclip-ui.mjs';
import {ROW_KINDS} from '../src/inspector-kit.mjs';
import {LEGACY_SKIN} from '../src/inspector-legacy.mjs';
import {legacyIkControlsView, legacyInspectorView} from './fixtures/inspector-legacy.mjs';

const ENTITIES = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"};
const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ENTITIES[entity]);
/** Start tags with sorted attributes (class names sorted), end tags, and non-blank text with its whitespace collapsed. */
function tokens(html) {
  const out = [];
  for (const [, close, name, attrs, text] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g)) {
    if (text !== undefined) {
      const value = decode(text).replace(/\s+/g, ' ');
      if (value.trim()) out.push(value);
      continue;
    }
    if (close) { out.push(`</${name}>`); continue; }
    const pairs = [...attrs.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map(([, key, value = '']) =>
      [key, key === 'class' ? decode(value).split(/\s+/).filter(Boolean).sort().join(' ') : decode(value)]);
    pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    out.push(`<${name}${pairs.map(([key, value]) => ` ${key}="${value}"`).join('')}>`);
  }
  return out;
}
function assertSameMarkup(actual, expected, label) {
  const a = tokens(actual), b = tokens(expected);
  const at = a.findIndex((token, index) => token !== b[index]);
  if (at < 0 && a.length === b.length) return;
  const index = at < 0 ? Math.min(a.length, b.length) : at;
  assert.fail(`${label}: markup differs at token ${index} of ${b.length}\n  now:   ${a.slice(Math.max(0, index - 2), index + 3).join(' ')}\n  today: ${b.slice(Math.max(0, index - 2), index + 3).join(' ')}`);
}
const same = (options, label) => assertSameMarkup(inspectorView(options), legacyInspectorView(options), label);

/** Every descriptor row's kind is one the kit or the legacy skin renders; section ids are unique and valid. */
function assertDescriptor(descriptor, label) {
  const kinds = new Set([...ROW_KINDS, ...Object.keys(LEGACY_SKIN.rows)]);
  assert.match(descriptor.kind, /^[a-z][a-z0-9-]*$/, `${label}: kind`);
  const ids = new Set();
  const visit = rows => {
    for (const row of rows ?? []) {
      if (!row) continue;
      assert.ok(kinds.has(row.kind), `${label}: row kind ${row.kind}`);
      if (row.rows) visit(row.rows);
    }
  };
  for (const section of descriptor.sections) {
    assert.match(section.id, /^[a-z][a-z0-9-]{0,39}$/, `${label}: section id ${section.id}`);
    assert.ok(!ids.has(section.id), `${label}: duplicate section ${section.id}`);
    ids.add(section.id);
    visit(section.rows);
  }
}
function check(options, label) {
  same(options, label);
  assertDescriptor(inspectorDescriptor(options), label);
}

const fonts = await Promise.all(['Regular'].map(async style => {
  const bytes = readFileSync(new URL(`../vendor/text/NotoSans-${style}.ttf`, import.meta.url));
  return parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHk8AAAAASUVORK5CYII=';

test('scene, camera, keyframe and layer contexts render today\'s markup', () => {
  const editor = new Editor();
  for (const context of ['scene', 'camera', 'frame', 'layer']) check({editor, context}, context);
  check({editor, tab: 'animation'}, 'the animation tab');
  check({editor, context: 'camera', propertyState: key => (key === 'camera_x' ? {value: 12.123456789} : {})}, 'a live camera value');
  check({editor, context: 'scene', propertyState: key => ({scene_color: {value: '#123456'}}[key])}, 'a live scene colour');
  editor._cameraInspectorTab = 'motion';
  check({editor, context: 'camera'}, 'the camera motion tab');
  editor.select(null);
  check({editor}, 'nothing selected');

  const sheet = new Editor({layerTimeline: true, propertyChannels: true});
  check({editor: sheet, context: 'frame'}, 'an exposure');
  sheet.createDrawingLayer();
  check({editor: sheet, context: 'layer'}, 'a drawing layer with parallax');
});

test('figure contexts render today\'s markup: figure, joints, ranges, builder, rig tool', () => {
  const editor = new Editor();
  editor.select(1);
  check({editor}, 'figure');
  check({editor, rangeIndices: [0, 1, 2], applyRange: true}, 'figure with a frame range');
  check({editor, tool: 'rig', rigMode: 'rotate'}, 'the rig tool');
  check({editor, builder: true}, 'figure in the builder');
  check({editor, propertyState: key => (key === 'root_x' ? {value: 3.14159} : undefined)}, 'a live figure value');
  const joints = editor.figure.segments.length;
  for (let joint = 0; joint < joints; joint++) {
    editor.select(1, joint);
    check({editor}, `joint ${joint}`);
  }
  editor.select(1, 2);
  check({editor, builder: true, tool: 'rig', builderBranch: true}, 'joint in the builder');
  check({editor, rangeIndices: [0, 1], applyRange: false}, 'joint with a frame range');
  editor.selectBranch(1, 2);
  check({editor, context: 'figure', tool: 'rig'}, 'a branch');
  editor.select(1, joints + 3);
  check({editor}, 'a joint index past the figure');
});

test('several figures, joined figures and movieclips render today\'s markup', () => {
  const editor = new Editor();
  editor.selectMany([1, 2]);
  const bounds = {minX: 10, minY: 20, maxX: 110.5, maxY: 220};
  check({editor, selectionCount: 2, bounds}, 'two figures');
  check({editor, selectionCount: 2, bounds, rangeIndices: [1, 2], applyRange: true}, 'two figures over a range');
  const layer = editor.createLayer('Layer 2', {activate: false});
  editor.assignFiguresToLayer([2], layer.id);
  editor.selectMany([1, 2]);
  check({editor, selectionCount: 2, bounds}, 'two figures on two layers');

  const joined = new Editor();
  const [child, parent] = joined.frame.objects;
  child.join = {target_object_slot: parent.object_slot, target_unique_id: parent.unique_id, target_handle_id: 3};
  joined.select(child.unique_id);
  check({editor: joined}, 'a joined figure');
  joined.select(parent.unique_id);
  check({editor: joined}, 'a figure with a joined child');

  const clip = movieclipFigure(2, 'Walking clip', {...emptyDocument(), keyframes: Array.from({length: 8}, (_, i) => createFrame([createObject(defaultFigure(), 1, 200 + i * 9, 250)]))},
    {duration: 8, pivot: {x: 200, y: 250}});
  const report = {...emptyDocument(), fps: 24, figure_types: [defaultFigure(), clip]};
  report.keyframes = [createFrame([createObject(clip, 7, 300, 300, {_stykMovieclip: presencePlayback()})], 11), createFrame([createObject(clip, 7, 300, 300, {_stykMovieclip: presencePlayback()})])];
  const movie = new Editor({demo: false, layerTimeline: true});
  movie.load(report);
  movie.select(7);
  check({editor: movie}, 'a movieclip instance');
  // Without inspector-view.mjs, a clip's inspector is the same, less the Layer field that view puts first.
  const clipOnly = legacyInspectorView({editor: movie}).replace(/^<div class="figure-layer-field">.*?<\/select><\/div>/, '');
  assertSameMarkup(movieclipInspector(movie), clipOnly, 'movieclipInspector()');
  movie.setMovieclipPlayback({mode: 'single', offset: 3}, {allFrames: true});
  check({editor: movie}, 'a movieclip on a single frame');
});

test('text, image, connector, two-tone and IK joints render today\'s markup', () => {
  const text = new Editor({demo: false});
  text.importFigure(compileTextFigure({text: 'Hello', fontSize: 42, color: [70, 40, 170]}, fonts[0]));
  check({editor: text}, 'text');
  const image = new Editor({demo: false});
  image.importFigure(createImageFigure({dataUrl: PNG, width: 1, height: 1, name: 'Placed <sprite> & "co"'}));
  check({editor: image}, 'image');
  image.select(image.selectedUid, 0);
  check({editor: image}, 'an image segment');

  const rig = new Editor({demo: false});
  rig.load(rigExampleDocument('sliding-carriage'));
  rig.select(1, 2);
  check({editor: rig}, 'a connector (slider)');
  check({editor: rig, builder: true}, 'a connector in the builder');
  rig._connectorInspector = {uid: 1, id: 3, part: 'segment'};
  check({editor: rig}, 'a connector (segment)');
  rig.select(1, 0);
  check({editor: rig}, 'an anchor segment');

  const tone = new Editor({demo: false});
  tone.addFigure();
  tone.select(tone.selectedUid, 0);
  tone.updateSegmentStyle({color: '#f8356a', opacity: 0.7, gradient: {color: '#2cd876', opacity: 0.6}});
  for (const shape of ['circle', 'circleFill', 'circleClear', 'line', 'squareLine']) {
    tone.convertSegment(shape);
    check({editor: tone}, `a ${shape} segment`);
  }
  tone.convertSegment('circleFill');
  tone.figure.segments[0].secondary = null;
  check({editor: tone}, 'a circle without a second colour');

  const ik = new Editor();
  ik.select(1, 4);
  ik.setNodeIK({enabled: true});
  check({editor: ik}, 'an IK joint');
  for (const settings of [
    {enabled: false, pinned: false, allowStretch: false, bendDirection: 0, chainLength: 2, maxLength: 3, target: {rotation: 0}},
    {enabled: true, pinned: true, allowStretch: true, bendDirection: -1, chainLength: 3, maxLength: 3, target: {rotation: 0.5}},
  ]) {
    assertSameMarkup(ikControlsView(settings), legacyIkControlsView(settings), `IK ${settings.enabled ? 'on' : 'off'}`);
    assert.equal(ikSection(settings).id, 'ik');
  }
});

test('fills, long palettes, 3D rigs and the drawing tools render today\'s markup', () => {
  const report = emptyDocument(), figure = report.figure_types[0];
  figure.polyfills = Array.from({length: 40}, (_, i) => ({polyfill_id: i + 1, segment_ids: [0, 1, 2], color_rgb: [i * 6, 90, 250 - i * 5], color_alpha: 1 - i / 100, z_order: 1.5}));
  report.keyframes = [createFrame([createObject(figure, 1, 200, 200)], 10)];
  const editor = new Editor({demo: false}).load(report);
  editor.select(1);
  for (const [polygonPage, palettePage] of [[0, 0], [1, 1], [3, 9]]) check({editor, polygonPage, palettePage}, `fills page ${polygonPage}, colours page ${palettePage}`);
  editor.selectPolygon(1, 5);
  check({editor, builder: true}, 'a fill in the builder');
  const channels = new Editor({demo: false, propertyChannels: true}).load(structuredClone(report));
  channels.select(1);
  check({editor: channels}, 'fills with property channels');

  const q = construction();
  q.add(0, 0, 0, 'Figure rotation');
  const bone = (parent, origin, tip, name) => {
    const turn = q.add(0, 0, 0, 'Turn'), pitch = q.add(0, 0, 0, 'Tilt'), v = tip.map((n, i) => n - origin[i]);
    return q.add(parent, Math.hypot(...v), Math.atan2(v[1], v[0]), name, {control: true, width: 18, rig: {spatial: {parent, origin, tip, turn, pitch}}});
  };
  const arm = bone(0, [0, 0, 0], [0, 100, 0], 'Upper arm');
  bone(arm, [0, 100, 0], [0, 180, 0], 'Forearm');
  const spatial = {figure_type_id: 1, segments: q.segments, polyfills: [], image_assets: [], text_assets: []};
  const rig = new Editor({demo: false}).load({...emptyDocument(), figure_types: [spatial], keyframes: [createFrame([createObject(spatial, 1, 400, 200)])]});
  rig.select(1, -1);
  check({editor: rig}, 'a 3D rig');
  rig.select(1, spatial.segments.findIndex(segment => segment.name === 'Forearm'));
  check({editor: rig}, 'a 3D rig joint');
  check({editor: rig, builder: true}, 'a 3D rig in the builder');

  const drawing = new Editor({layerTimeline: true, propertyChannels: true});
  drawing.createDrawingLayer();
  const settings = {color: '#223344', color2: '#ffffff', blend: 'multiply', alphaLock: true, preset: 'ink', hardness: 0.5, roundness: 1, angle: 0, spacingRatio: 0.08,
    taperIn: 0, taperOut: 0, stabilizerMode: 'average', tip: 'round', angleMode: 'fixed', grain: 'noise', texture: 0, grainScale: 1, pressureSize: true,
    pressureOpacity: false, pressureFlow: false, sizeCurve: 1, opacityCurve: 1, sizeJitter: 0, opacityJitter: 0, angleJitter: 0, scatter: 0, mirrorY: false,
    resolution: 1, filter: 'smooth'};
  const session = {active: true, editor: drawing, tool: 'brush', settings, library: {recent: ['#ff0000', '#223344'], presets: []}, state: {view: {}}};
  check({editor: drawing, drawing: session, hotkeyLabel: id => id}, 'the brush');
  drawing.select(1);
  check({editor: drawing, drawing: {...session, tool: 'transform'}, hotkeyLabel: id => id}, 'transforming a drawing');
});
