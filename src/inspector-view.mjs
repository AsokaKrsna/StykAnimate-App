/**
 * The inspector's contexts as section descriptors (architecture.md §3.13,
 * experience.md §5.1). inspectorDescriptor(options) describes what the
 * Properties panel shows for the current selection and mode as
 * {kind, target, quick, scope, sections}: the scene, the camera, a frame or
 * keyframe, a layer, the drawing tools, several figures, one figure (a
 * figure, text or image; a movieclip instance; a 3D rig; a builder fill) or a
 * joint. inspectorView(options) renders the sections with src/inspector-kit.mjs
 * (the content of #inspector); the header (the target's name and menu, the
 * scope line and the quick actions) is src/inspector-header.mjs's, fed the
 * same descriptor through onInspectorRender().
 *
 * Revision 4: core sections are always open (at most two title actions each),
 * less used settings are titled sections that fold behind their title and
 * open when their content matters, and the selection's most used commands are
 * its quick actions (src/ui/quick-actions.mjs). The inspector never shows key
 * state. Sub-modules that still build HTML (the rig controls in Build, the
 * camera's motion, drawing, parallax, drawing sets, builder surfaces) enter as
 * markup rows until their milestones.
 */
import {joinedDrawingSetsView} from './movieclip-drawings.mjs';
import {spatialSections} from './spatial-controls.mjs';
import {drawingInspector, DRAWING_TOOLS} from './drawing-view.mjs';
import {rigControlsView} from './rig-controls.mjs';
import {figureJoinAction} from './figure-join-action.mjs';
import {polygonSurfaceView} from './builder-surface-ui.mjs';
import {rigIKAllowed} from './rig-constraints.mjs';
import {cameraMotionView, parallaxView} from './camera-motion-ui.mjs';
import {paintCSS} from './paint.mjs';
import {figurePalette, displayedSegmentPaint, displayedColor} from './figure-colors.mjs';
import {isStatic} from './pivot/geometry.mjs';
import {cameraValues} from './editor-camera.mjs';
import {builderDrawables} from './editor-builder-style.mjs';
import {isBuilderContext} from './builder-aids.mjs';
import {partName, partGlyph} from './builder-outliner.mjs';
import {resolveInstanceFigure} from './animation-style.mjs';
import {ikSection} from './ik-view.mjs';
import {propertyToggle} from './property-toggle.mjs';
import {isMovieclip} from './movieclips.mjs';
import {movieclipSections, movieclipTarget} from './movieclip-ui.mjs';
import {sheetKeyAt} from './layer-sheet.mjs';
import {iconNames} from './icons.mjs';
import {SectionMemory, renderInspector} from './inspector-kit.mjs';
import {esc, grid, group, heading, numericField, propertyPrecision} from './inspector-legacy.mjs';

const hex = rgb => `#${(rgb || [43, 43, 43]).map(n => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
const num = n => Number(Number(n ?? 0).toFixed(2));
const degrees = radians => (radians * 180) / Math.PI;
const opacity = raw => (1 - (raw || 0) / 255) * 100;
const polygonOpacity = polygon => (polygon.alpha_raw !== undefined ? 1 - polygon.alpha_raw / 255 : polygon.color_alpha ?? 1) * 100;
const pageText = (start, size, total) => `${start + 1}–${Math.min(start + size, total)} / ${total}`;
const plural = (count, one, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const known = new Set(iconNames);
/** The spec's glyph when icons.mjs has it (visual-system.md §10), else today's nearest drawing. */
const glyph = (name, fallback) => (known.has(name) ? name : fallback);
const STEP_DOWN = glyph('step-down', 'arrow-down'), STEP_UP = glyph('step-up', 'arrow-up');

/**
 * The titled sections' remembered state (SectionMemory): one per window,
 * shared by every render. configureInspectorSections() seeds it from the
 * inspectorSections setting and reports changes to the owner that saves it;
 * until an owner does, it remembers for this session.
 */
export const inspectorSections = new SectionMemory();
export function configureInspectorSections(saved, {onChange} = {}) {
  const memory = new SectionMemory(saved, {onChange});
  inspectorSections.saved = memory.saved;
  inspectorSections.onChange = memory.onChange;
  return inspectorSections;
}

let renderListener = null;
/**
 * `listener(descriptor, options)` runs after every inspectorView() render,
 * before the app writes the sections: the header (inspector-header.mjs)
 * writes the target, scope and quick actions from the same descriptor. One
 * listener; returns a function that removes it.
 */
export function onInspectorRender(listener) {
  renderListener = typeof listener === 'function' ? listener : null;
  return () => { if (renderListener === listener) renderListener = null; };
}

/** A figure's Layer select (Mixed across layers, locked layers disabled): "Layer Bubble ▾", or "Layer 1 ▾" when the name says it is a layer. */
function layerSelect(editor, extra = {}) {
  const ids = new Set([...editor.selectedUids].map(uid => editor.layerForUid(uid))), current = ids.size === 1 ? [...ids][0] : '';
  const layers = editor.layers.filter(layer => layer.kind === 'layer').reverse();
  const name = layers.find(layer => layer.id === current)?.name ?? '';
  return {
    kind: 'select', id: 'figure-layer', label: 'Layer', description: 'Figure layer', placeholder: 'Mixed', value: current || undefined,
    bare: /^layer\b/i.test(name), options: layers.map(layer => ({value: layer.id, label: layer.name, disabled: layer.locked})), ...extra,
  };
}

/** A builder order's four steps for one drawable. */
const orderActions = (kind, index, label) => ({kind: 'actions', label, items: [
  ['back', 'send-to-back', 'Send to back'], ['down', STEP_DOWN, 'Send backward'], ['up', STEP_UP, 'Bring forward'], ['front', 'bring-to-front', 'Bring to front'],
].map(([direction, icon, name]) => ({action: 'builder-order', icon, label: `${name} · ${kind}`, data: {kind, index, direction}}))});

/**
 * The scope line while Edit together is on: the frames an edit reaches
 * ("Editing frames 22–28 · Stop"). Ticks in a layer-sheet document, frame
 * indices in a classic one; a gap reads as a count.
 */
function scopeLine(editor, indices, applyRange) {
  if (!applyRange || indices.length < 2) return null;
  const frames = [...new Set(indices)].sort((a, b) => a - b), first = frames[0], last = frames.at(-1);
  const label = last - first + 1 === frames.length ? `Editing frames ${first + 1}–${last + 1}` : `Editing ${frames.length} frames`;
  return {label, stop: {action: 'toggle-range-edit', label: 'Stop', tip: 'Edit only this frame'}};
}

/** Edit together, as the checkbox that mirrors the timeline header's (#range-edit): shown while two or more frames are selected. */
const rangeSection = (indices, applyRange) => ({id: 'range', hidden: indices.length <= 1, rows: [{kind: 'grid', rows: [
  {kind: 'field-switch', id: 'apply-range-movement', label: `Edit ${indices.length} frames together`, checked: applyRange, span: 2,
    tip: 'Apply canvas moves and figure commands to every selected frame'},
]}]});

/**
 * The target's kind and label as the shell names them (#inspector-context,
 * #inspector[data-selection-kind]): Figure, Figures, Joint, Scene, Camera,
 * Layer, Timing or Drawing.
 */
function targetKind({editor, context = 'auto', drawing, tab = 'design'}) {
  if (drawing?.active) return {label: 'Drawing', selection: 'drawing'};
  const resolved = context === 'auto' ? (tab === 'animation' ? 'frame' : editor.object ? 'figure' : 'scene') : context;
  const count = editor.selectedUids?.size || 0, joint = editor.figure?.segments?.[editor.selectedJoint];
  if (!['camera', 'scene', 'layer', 'frame'].includes(resolved) && editor.object)
    return count > 1 ? {label: 'Figures', selection: 'figures'} : joint ? {label: 'Joint', selection: 'joint'} : {label: 'Figure', selection: 'figure'};
  const label = {camera: 'Camera', scene: 'Scene', layer: 'Layer', frame: 'Timing'}[resolved] ?? (count > 1 ? `${count} figures` : 'Scene');
  return {label, selection: resolved};
}

/**
 * The current context: {kind, target: {name, glyph, rename, label, selection},
 * quick: {context} | null, scope, sections}. Options are inspectorView()'s;
 * propertyState(key) may supply a live value ({value}) for a property while it
 * is being edited.
 */
export function inspectorDescriptor(options) {
  const descriptor = contextDescriptor(options);
  return {quick: null, scope: null, ...descriptor, target: {...targetKind(options), ...descriptor.target}};
}

function contextDescriptor({
  editor, tab = 'design', tool = 'select', rigMode = 'move', selectionCount = 1, bounds, rangeIndices = [], applyRange = false,
  polygonPage = 0, palettePage = 0, context = 'auto', propertyState, builderBranch = false, builder = false, drawing, hotkeyLabel,
}) {
  const number = (label, key, value, unit = '', extra = {}) =>
    ({kind: 'number', key, label, unit, value: propertyState?.(key)?.value ?? value, precision: propertyPrecision(key), ...extra});
  if (drawing?.active) return drawingDescriptor(editor, drawing, number, hotkeyLabel);
  const object = editor.object;
  const resolved = context === 'auto' ? (tab === 'animation' ? 'frame' : object ? 'figure' : 'scene') : context;
  if (resolved === 'camera') return cameraDescriptor(editor, number);
  if (resolved === 'layer') return layerDescriptor(editor);
  if (resolved === 'frame') return frameDescriptor(editor, number);
  if (resolved === 'scene' || !object) return sceneDescriptor(editor, number, propertyState);
  const scope = scopeLine(editor, rangeIndices, applyRange), range = rangeSection(rangeIndices, applyRange);
  if (selectionCount === 1 && isMovieclip(editor.figure)) {
    return {kind: 'movieclip', target: movieclipTarget(editor), quick: {context: 'movieclip'}, scope,
      sections: [range, ...movieclipSections(editor, {number, layer: layerSelect(editor)})]};
  }
  if (selectionCount > 1) return selectionDescriptor(editor, number, {bounds, selectionCount, range, scope});
  const figure = resolveInstanceFigure(editor.figure, object), joint = editor.selectedJoint;
  const drawingSets = drawingSetsSection(builder ? '' : joinedDrawingSetsView(editor));
  if (!builder && figure.segments.some(segment => segment._stykRig?.spatial?.origin)) {
    return {kind: 'spatial-rig', target: {name: figure.name || 'Figure', rename: figureRename}, quick: {context: 'figure'}, scope, sections: [
      range, drawingSets, ...spatialSections(editor),
      {id: 'placement', title: 'Placement', place: 'titled', open: true, hidden: joint >= 0, rows: [{kind: 'grid', rows: [
        number('X', 'root_x', object.root_x, 'px'), number('Y', 'root_y', object.root_y, 'px'), number('Scale', 'scale', object.scale * 100, '%', {min: 0.01}),
      ]}]},
    ]};
  }
  if (builder && editor.selectedPolygonIndex >= 0) return fillDescriptor(editor, figure, number);
  const segment = figure.segments[joint];
  const order = new Map(builderDrawables(figure).map((item, index) => [`${item.kind}:${item.index}`, index + 1]));
  const shared = {range, scope, drawingSets, spatial: builder ? [] : spatialSections(editor), order, tool, builder, builderBranch};
  // Pivot origins use -1; segment endpoint indices start at zero.
  return joint >= 0 && segment
    ? jointDescriptor(editor, figure, segment, number, shared)
    : figureDescriptor(editor, figure, number, {...shared, polygonPage, palettePage});
}

const figureRename = {id: 'figure-name', description: 'Figure name', tip: 'Double-click to rename the figure definition'};

/** Drawing sets of the drawing banks joined to the selected figure: a titled section, open while it has any. */
const drawingSetsSection = html => ({id: 'drawing-sets', title: 'Drawing sets', place: 'titled', open: Boolean(html), hidden: !html,
  rows: [{kind: 'markup', html}]});

/**
 * The Properties panel's sections for the current context (the only content
 * of #inspector, through updateInspectorDOM()). The header receives the same
 * descriptor through onInspectorRender().
 */
export function inspectorView(options) {
  const descriptor = inspectorDescriptor(options);
  const html = renderInspector(descriptor, {memory: inspectorSections});
  renderListener?.(descriptor, options);
  return html;
}

/** Draw keeps drawing-view's own markup, edge to edge, until its tools move to descriptors (M7b). */
function drawingDescriptor(editor, drawing, number, hotkeyLabel) {
  const o = editor.object, f = editor.figure;
  const field = (label, key, value, unit, limits = '') => numericField(label, key, number(label, key, value).value, unit, limits);
  const pose = drawing.tool === 'transform' && o ? `<section class="inspector-section"><div class="inspector-title"><span>Transform drawing</span></div>${grid(
    field('X', 'root_x', o.root_x, 'px') + field('Y', 'root_y', o.root_y, 'px') + field('Scale', 'scale', o.scale * 100, '%', 'min="0.01"') +
    field('Angle', 'rotation', ((o.angles[0] ?? 0) - (f.segments[0]?.angle_rad ?? 0)) * 180 / Math.PI, '°') +
    field('Opacity', 'figure_opacity', (1 - (o.field28 ?? 0) / 255) * 100, '%', 'min="0" max="100"'))}</section>` : '';
  const html = drawingInspector(drawing, {numericField, group, grid, heading, hotkeyLabel, esc, propertyToggle}, pose);
  // The panel's title names the tool ("Brush", "Fill"), with its glyph; drawing-view's own heading row steps aside.
  const [, name = 'Drawing', glyph = 'brush'] = DRAWING_TOOLS.find(entry => entry[0] === drawing.tool) ?? [];
  return {kind: 'drawing', target: {name, glyph}, sections: [{id: 'drawing', bare: true, rows: [{kind: 'markup', html}]}]};
}

function sceneDescriptor(editor, number, propertyState) {
  const report = editor.report, frame = editor.frame, colorState = propertyState?.('scene_color'), backgroundState = propertyState?.('scene_background');
  const background = report.backgrounds?.find(item => item.background_id === (backgroundState?.value ?? frame.background_id));
  const raw = colorState?.value ?? background?.color ?? 0xffffffff;
  const color = typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw : `#${(raw & 0xffffff).toString(16).padStart(6, '0')}`;
  const name = background?.name || 'White', figures = editor.frame.objects.length, frames = editor.totalTicks ?? report.keyframes.length;
  const scopes = editor._movieclipScopes ?? [];
  return {kind: 'scene', target: {name: scopes.length ? scopes.map(scope => scope.name).join(' › ') : 'Scene', glyph: scopes.length ? 'frame' : 'scene'}, sections: [
    {id: 'summary', rows: [{kind: 'meta', text: `${plural(figures, 'figure')} · ${plural(frames, 'frame')} · ${num(frames / report.fps)} s`}]},
    {id: 'canvas', title: 'Canvas', rows: [{kind: 'grid', rows: [
      number('Width', 'canvas_width', report.canvas_width, 'px', {min: 1, max: 16384}), number('Height', 'canvas_height', report.canvas_height, 'px', {min: 1, max: 16384}),
    ]}]},
    {id: 'background', title: 'Background', actions: [{action: 'import-background', icon: 'image', label: 'Import background', tip: 'Background image…'}], rows: [
      {kind: 'grid', rows: [
        {kind: 'color', id: 'background-color', label: 'Background color', value: color, caption: name, tip: name},
        {kind: 'actions', items: [{action: 'background-style', icon: 'sliders', label: 'Library…', text: true, variant: 'outline', tip: 'Background settings'}]},
      ]},
    ]},
    {id: 'playback', title: 'Playback', rows: [{kind: 'grid', rows: [number('Rate', 'fps', report.fps, 'fps', {min: 1, max: 120})]}]},
  ]};
}

/**
 * The camera: its preview (Guides as its title action), the Transform │
 * Motion switch, Transform (Copy and Paste as its title actions) and the
 * rarer framing commands in Framing. Level, Centre and Reset are its quick
 * actions. The Motion pane stays camera-motion-ui's until M7e.
 */
function cameraDescriptor(editor, number) {
  const c = cameraValues((editor.evaluatedFrame || editor.frame).camera), motion = editor._cameraInspectorTab === 'motion';
  const selected = Boolean(editor.selectedObjects?.length ?? editor.object);
  return {kind: 'camera', target: {name: 'Camera', glyph: 'camera'}, quick: {context: 'camera'}, sections: [
    {id: 'preview', title: 'Preview', actions: [{action: 'camera-guides', icon: 'grid', label: 'Guides', tip: 'Show composition guides', pressed: true}], rows: [
      {kind: 'preview', label: 'Live camera output', media: {tag: 'canvas', key: 'camera-monitor', label: 'Live camera output', data: {'camera-monitor': true}},
        caption: [`${editor.report.canvas_width} × ${editor.report.canvas_height}`, {text: `${num(100 / c.scale)}% zoom`, data: {'camera-magnification': true}}]},
    ]},
    {id: 'tabs', rows: [{kind: 'segmented', mode: 'tab', description: 'Camera controls', fill: true, value: motion ? 'motion' : 'transform', options: [
      {value: 'transform', label: 'Transform', data: {'camera-tab': 'transform'}}, {value: 'motion', label: 'Motion', data: {'camera-tab': 'motion'}},
    ]}]},
    {id: 'transform', title: 'Transform', hidden: motion, actions: [
      {action: 'camera-copy', icon: 'duplicate', label: 'Copy camera pose'},
      {action: 'camera-paste', icon: 'clipboard', label: 'Paste camera pose', disabled: !editor._cameraClipboard},
    ], rows: [{kind: 'grid', rows: [
      number('X', 'camera_x', c.x || 0, 'px'), number('Y', 'camera_y', c.y || 0, 'px'),
      number('Zoom', 'camera_scale', (c.scale || 1) * 100, '%', {min: 0.01, description: 'Scale (%)'}), number('Rotation', 'camera_angle', degrees(c.angle_rad || 0), '°'),
    ]}]},
    {id: 'framing', title: 'Framing', place: 'titled', hidden: motion, rows: [
      {kind: 'actions', label: 'Fit', items: [{action: 'camera-align-view', icon: 'fit', label: 'Fit view', text: true, variant: 'outline', tip: 'Fit camera to current canvas view'}]},
      {kind: 'actions', label: 'Centre on selection', items: [
        {action: 'camera-center-x', icon: 'align-horizontal-center', label: 'Center camera horizontally', disabled: !selected},
        {action: 'camera-center-y', icon: 'align-vertical-center', label: 'Center camera vertically', disabled: !selected},
        {action: 'camera-locate-previous', icon: 'chevron-left', label: 'Match previous camera pose', disabled: editor.frameIndex <= 0},
        {action: 'camera-locate-next', icon: 'chevron-right', label: 'Match next camera pose', disabled: editor.frameIndex >= editor.report.keyframes.length - 1},
        {action: 'camera-apply-figures', icon: 'check', label: 'Apply camera transform to figures'},
      ]},
    ]},
    {id: 'motion', bare: true, hidden: !motion, rows: [{kind: 'markup', html: cameraMotionView(editor)}]},
  ]};
}

function frameDescriptor(editor, number) {
  if (editor.report._styk?.layerSheet) {
    const track = editor.report._styk.layerSheet.tracks[editor.activeLayerId], {key, next} = sheetKeyAt(track, editor.tick);
    return {kind: 'frame', target: {name: `Frame ${editor.tick + 1}`}, sections: [
      {id: 'exposure', title: editor.getLayer(editor.activeLayerId)?.name ?? 'Layer',
        actions: [{action: 'add-frame', icon: glyph('frame-plus', 'plus'), label: 'Insert keyframe (F6)', tip: 'Add frame'}], rows: [{kind: 'grid', rows: [
          number('Exposure', 'duration', (next?.tick ?? track?.end ?? editor.tick + 1) - (key?.tick ?? editor.tick), 'frames', {min: 1, max: 65535}),
        ]}]},
    ]};
  }
  return {kind: 'keyframe', target: {name: `Keyframe ${(editor.frameIndex ?? 0) + 1}`}, sections: [
    {id: 'timing', title: 'Timing', rows: [{kind: 'grid', rows: [number('Duration', 'duration', editor.frame.duration_raw ?? 1, 'ticks', {min: 0, max: 65535})]}]},
  ]};
}

/** A layer: its name and, from camera-motion-ui, its Parallax (the row's eye and lock show and lock it). */
function layerDescriptor(editor) {
  const layer = editor.getLayer?.(editor.activeLayerId) ?? {id: 'layer-1', name: 'Layer', visible: true, locked: false, figureUids: []};
  const data = {'layer-id': layer.id};
  return {kind: 'layer', target: {name: layer.name, glyph: 'layers'}, sections: [
    {id: 'layer', title: 'Layer', rows: [{kind: 'grid', rows: [
      {kind: 'text', id: 'inspector-layer-name', label: 'Name', description: 'Layer name', value: layer.name, maxlength: 160, data, span: 2},
    ]}]},
    {id: 'parallax', bare: true, rows: [{kind: 'markup', html: parallaxView(editor, layer.id)}]},
  ]};
}

/** Several figures: Selection (Rotate 15° and Centre as its actions), Align's six, Appearance, and Arrange's layer and one-step order. */
function selectionDescriptor(editor, number, {bounds: b, selectionCount, range, scope}) {
  const objects = editor.selectedObjects ?? [editor.object], object = editor.object;
  const opacities = new Set(objects.map(item => item.field28 || 0));
  const figureOf = item => resolveInstanceFigure(editor.report.figure_types.find(type => type.figure_type_id === item.figure_type_id), item);
  const colours = new Set(objects.flatMap(item => figurePalette(editor.report, figureOf(item), item).map(entry => entry.color)));
  const joined = objects.some(item => item.join) || editor.frame.objects.some(part => part.join && objects.some(item => item.object_slot === part.join.target_object_slot));
  const align = [['left', 'align-left', 'Align left'], ['center-x', 'align-horizontal-center', 'Align center'], ['right', 'align-right', 'Align right'],
    ['top', 'align-top', 'Align top'], ['center-y', 'align-vertical-center', 'Align middle'], ['bottom', 'align-bottom', 'Align bottom']];
  return {kind: 'figures', target: {name: `${selectionCount} figures`}, quick: {context: 'figures'}, scope, sections: [
    range,
    {id: 'selection', title: 'Selection', actions: [
      {action: 'rotate', label: 'Rotate 15°', text: true, tip: 'Rotate the selection 15°'}, {action: 'center', label: 'Center', text: true, tip: 'Center selection'},
    ], rows: [{kind: 'grid', rows: [
      number('X', 'group_x', b.minX, 'px'), number('Y', 'group_y', b.minY, 'px'),
      number('W', 'group_width', b.maxX - b.minX, 'px', {min: 0.01, description: 'Width (px)'}), number('H', 'group_height', b.maxY - b.minY, 'px', {min: 0.01, description: 'Height (px)'}),
    ]}]},
    {id: 'align', title: 'Align', rows: [{kind: 'actions', label: 'Align', items: align.map(([name, icon, label]) => ({action: `align-${name}`, icon, label}))}]},
    {id: 'appearance', title: 'Appearance', actions: [{action: 'reset-color', icon: 'reset', label: 'Reset colors'}], rows: [{kind: 'grid', rows: [
      {kind: 'color', id: 'figure-color', label: 'Colour', description: 'Figure color', value: colours.size === 1 ? [...colours][0] : '#2b2b2b', mixed: colours.size > 1},
      number('Opacity', 'figure_opacity', opacity(object.field28), '%', {min: 0, max: 100, id: 'figure-opacity', field: false, mixed: opacities.size > 1}),
    ]}]},
    {id: 'arrange', title: 'Arrange', rows: [{kind: 'grid', ratio: '3:2', rows: [
      layerSelect(editor),
      {kind: 'actions', label: 'One step', items: [
        {action: 'layer-down', icon: STEP_DOWN, label: 'Send backward'}, {action: 'layer-up', icon: STEP_UP, label: 'Bring forward'},
      ]},
    ]}]},
    {id: 'connection', title: 'Connection', place: 'titled', hidden: !joined, rows: [{kind: 'actions', items: [
      {action: 'combine-figures', icon: 'combine', label: 'Combine connected', text: true, variant: 'outline'},
    ]}]},
  ]};
}

/** A fill picked in the builder: its colour, delete, opacity, surface and order. */
function fillDescriptor(editor, figure, number) {
  const index = editor.selectedPolygonIndex, polygon = figure.polyfills[index];
  return {kind: 'fill', target: {name: `Fill ${index + 1}`, glyph: 'polygon'}, sections: [{id: 'fill', title: 'Fill', rows: [
    {kind: 'list-row', label: `Polygon ${index + 1}`, lead: 'polygon', actions: [
      {kind: 'swatch', picker: 'native', label: 'Fill color', value: hex(displayedColor(editor.report, figure, editor.object, polygon.color_rgb)), data: {'polygon-color': index}},
      {icon: 'trash', label: 'Delete fill', data: {'delete-polygon': index}},
    ]},
    {kind: 'grid', rows: [number('Opacity', `polygon_${index}_opacity`, polygonOpacity(polygon), '%', {min: 0, max: 100})]},
    {kind: 'markup', html: polygonSurfaceView(editor, index)},
    orderActions('polygon', index, 'Fill order'),
  ]}]};
}

/** One fill of the figure: its row (colour, delete), its opacity and order, and the four order steps; keyed by data-polygon-index. */
function fillGroup(editor, figure, object, index, order) {
  const polygon = figure.polyfills[index], name = `Polygon ${index + 1}`;
  return {kind: 'group', label: name, data: {'polygon-index': index}, rows: [
    {kind: 'list-row', label: name, lead: 'polygon', actions: [
      {kind: 'swatch', picker: 'native', value: hex(displayedColor(editor.report, figure, object, polygon.color_rgb)), label: `${name} color`, data: {'polygon-color': index}},
      {icon: 'trash', label: `Delete polygon ${index + 1}`, data: {'delete-polygon': index}},
    ]},
    {kind: 'grid', rows: [
      {kind: 'number', key: `polygon_${index}_opacity`, label: 'Opacity', unit: '%', value: polygonOpacity(polygon), min: 0, max: 100, precision: 3},
      {kind: 'number', key: `polygon_${index}_z_order`, label: 'Order', precision: 0, value: order.get(`polygon:${index}`), min: 1, max: order.size},
    ]},
    orderActions('polygon', index, `${name} order`),
  ]};
}

/**
 * One figure, text or image: Transform, Appearance (Reset colours) and
 * Arrange (Layer, the Order stepper; Join… as its action) are open; the
 * connection, the used colours and fills and the drawing sets are titled.
 */
function figureDescriptor(editor, figure, number, {range, scope, drawingSets, spatial, order, builder, polygonPage, palettePage}) {
  const report = editor.report, frame = editor.frame, object = editor.object;
  // A joint index past the figure's segments shows the figure, without its colours.
  const whole = editor.selectedJoint < 0, palette = whole ? editor.figurePalette() : [], own = whole ? figurePalette(report, figure, object) : [];
  const kind = figure.segments.every(segment => segment.primitive_code === 5) ? 'text' : figure.segments.every(segment => segment.primitive_code === 2) ? 'image' : 'figure';
  const children = frame.objects.some(part => part.join?.target_object_slot === object.object_slot);
  const parent = object.join ? frame.objects[object.join.target_object_slot] : null;
  const parentName = parent && (parent.name || report.figure_types.find(type => type.figure_type_id === parent.figure_type_id)?.name || 'Figure');
  const polygons = figure.polyfills || [], start = Math.min(Math.max(0, polygonPage) * 12, Math.max(0, Math.floor((polygons.length - 1) / 12) * 12));
  const paletteStart = Math.min(Math.max(0, palettePage) * 32, Math.max(0, Math.ceil(palette.length / 32) - 1) * 32);
  const joinLabel = parent ? 'Unjoin figure' : 'Join to figure';
  // In Build the figure's tiles add parts and fit it (its placement in the scene stays Animate's); the rig tool's
  // Drag mode is its option in the stage header.
  return {kind, target: {name: figure.name || 'Figure', glyph: kind === 'text' ? 'text' : kind === 'image' ? 'image' : null, rename: figureRename},
    quick: {context: builder ? 'build' : kind}, scope, sections: [
      range, drawingSets, ...spatial,
      {id: 'text', title: 'Text', hidden: kind !== 'text' && !figure.text_assets?.some(asset => asset.glyphs?.length), rows: [{kind: 'actions', items: [
        {action: 'edit-text', icon: 'text', label: 'Edit text…', text: true, variant: 'outline', tip: 'Edit text'},
      ]}]},
      {id: 'transform', title: 'Transform', rows: [{kind: 'grid', rows: [
        number('X', 'root_x', object.root_x, 'px'), number('Y', 'root_y', object.root_y, 'px'),
        number('Angle', 'rotation', degrees((object.angles[0] ?? 0) - (figure.segments[0]?.angle_rad ?? 0)), '°'),
        number('Scale', 'scale', object.scale * 100, '%', {min: 0.01}),
      ]}]},
      {id: 'appearance', title: 'Appearance', actions: [{action: 'reset-color', icon: 'reset', label: 'Reset colors'}], rows: [{kind: 'grid', rows: [
        {kind: 'color', id: 'figure-color', label: 'Colour', description: 'Recolor all segments', value: own[0]?.color ?? '#000000', caption: own.length > 1 ? 'Mixed' : undefined},
        number('Opacity', 'figure_opacity', opacity(object.field28), '%', {min: 0, max: 100, id: 'figure-opacity', field: false}),
      ]}]},
      {id: 'arrange', title: 'Arrange', place: kind === 'text' ? 'titled' : 'core', actions: [
        {action: 'join-figure', label: parent ? 'Unjoin' : 'Join…', text: true, tip: joinLabel, data: {'hotkey-title': joinLabel}, disabled: !figureJoinAction(editor)},
      ], rows: [{kind: 'grid', ratio: '3:2', rows: [
        layerSelect(editor),
        {kind: 'stepper-field', key: 'figure_z_order', label: 'Order', description: 'Z-index', groupLabel: 'Order and one-step order', value: object._stykZIndex ?? 0,
          precision: 0, min: -1000000, max: 1000000,
          down: {action: 'layer-down', label: 'Send backward', icon: STEP_DOWN}, up: {action: 'layer-up', label: 'Bring forward', icon: STEP_UP}},
      ]}]},
      {id: 'connection', title: 'Connection', place: 'titled', open: Boolean(parent), hidden: !parent && !children, rows: [
        {kind: 'value', label: 'Joined to', text: parent ? `${parentName} · ${object.join.target_handle_id}` : 'None'},
        {kind: 'actions', items: [{action: 'combine-figures', icon: 'combine', label: 'Combine connected', text: true, variant: 'outline', tip: 'Merge the connected figures into one'}]},
      ]},
      {id: 'colours', title: 'Colours', place: 'titled', hidden: !whole, rows: [
        {kind: 'swatches', label: 'Figure color palette', hidden: !palette.length, items: palette.slice(paletteStart, paletteStart + 32).map(entry => ({
          picker: 'paint', value: entry.color, tip: entry.color.toUpperCase(), data: {'palette-color': entry.color},
          label: `Replace ${entry.color.toUpperCase()}, ${entry.segments.length} segments${entry.polygons.length ? `, ${entry.polygons.length} fills` : ''}`,
        }))},
        palette.length > 32 && {kind: 'pager', label: 'Colour pages', text: pageText(paletteStart, 32, palette.length),
          previous: {action: 'palette-previous', icon: 'chevron-left', label: 'Previous colors', disabled: paletteStart === 0},
          next: {action: 'palette-next', icon: 'chevron-right', label: 'Next colors', disabled: paletteStart + 32 >= palette.length}},
        {kind: 'value', label: 'Fills', text: polygons.length ? plural(polygons.length, 'fill') : 'No fills'},
        ...polygons.slice(start, start + 12).map((_, i) => fillGroup(editor, figure, object, start + i, order)),
        polygons.length > 12 && {kind: 'pager', label: 'Fill pages', text: pageText(start, 12, polygons.length),
          previous: {action: 'polygons-previous', icon: 'chevron-left', label: 'Previous polygons', disabled: start === 0},
          next: {action: 'polygons-next', icon: 'chevron-right', label: 'Next polygons', disabled: start + 12 >= polygons.length}},
      ]},
    ]};
}

/**
 * A joint (or a branch, or several segments): Joint (angle, length, bend,
 * Static), IK, Style and its figure's Layer are open; the second colour and a
 * connector's parts are titled. A connector's Slider part shows only the
 * slide and Static. In Build, the joint's name and the rig controls too.
 */
function jointDescriptor(editor, figure, segment, number, {range, scope, drawingSets, spatial, order, tool, builder, builderBranch}) {
  const report = editor.report, object = editor.object, joint = editor.selectedJoint, selected = editor.selectedSegmentIds;
  const connector = segment._stykRig?.connector, single = selected.size <= 1;
  const connectorScope = editor._connectorInspector;
  const part = connector && single ? (connectorScope?.uid === editor.selectedUid && connectorScope?.id === segment.segment_id ? connectorScope.part : 'slider') : null;
  const slider = part === 'slider';
  const paint = displayedSegmentPaint(report, figure, object, segment);
  const twoTone = [1, 3, 4].includes(segment.primitive_code) &&
    (single || figure.segments.every(item => !selected.has(item.segment_id) || [1, 3, 4].includes(item.primitive_code)));
  const secondary = twoTone && Boolean(segment.secondary);
  const shape = ['line', 'circle', 'image', 'circleFill', 'circleClear', 'text', 'squareLine'][segment.primitive_code ?? 0];
  const fixed = ['image', 'text'].includes(shape), lock = segment._stykRig?.angleLock;
  const solid = paint.type === 'solid';
  const position = object.len_flag ? object.lengths[joint] : segment.length;
  // In Build a joint is a part, named as Structure names it ("Line 4"); in Animate it is a joint.
  const own = builder ? partName(segment) : segment.name || `Joint ${segment.segment_id}`;
  const title = selected.size > 1 ? `${selected.size} ${builder ? 'parts' : 'segments'}` : editor.branchSelected ? `Branch from ${own}` : own;
  const staticSwitch = {kind: 'field-switch', id: 'static-joint', label: 'Static', checked: isStatic(segment), tip: 'Does not turn with its parent'};
  return {kind: 'joint', target: {name: title, glyph: part ? 'link' : builder ? partGlyph(segment) : null}, quick: {context: builder ? 'part' : 'joint'}, scope, sections: [
    range, drawingSets, ...spatial,
    {id: 'connector', title: `Connector ${segment.segment_id}`, place: 'titled', open: true, hidden: !part, rows: [
      {kind: 'segmented', mode: 'pressed', description: 'Connector properties', value: part, fill: true, options: [
        {value: 'segment', label: 'Segment', data: {'connector-part': 'segment'}}, {value: 'slider', label: 'Slider', data: {'connector-part': 'slider'}},
      ]},
    ]},
    {id: 'slider', title: 'Slider', hidden: !slider, rows: [{kind: 'grid', rows: [
      {kind: 'number', id: 'rig-position', label: 'Position', description: 'Slide position', unit: '%', value: Math.round(position * 10000) / 100, min: 0, max: 100, precision: 2},
      staticSwitch,
    ]}]},
    // Build: the part's name and whether edits reach the whole branch under it (or hold Shift).
    {id: 'joint-name', hidden: slider || !builder, rows: [{kind: 'grid', rows: [
      {kind: 'text', id: 'builder-joint-name', label: 'Name', description: 'Part name', value: segment.name ?? '', placeholder: partName(segment), maxlength: 120, span: 2},
      {kind: 'field-switch', id: 'builder-branch', label: 'Edit the whole branch', checked: builderBranch, span: 2, hidden: !single,
        tip: 'Edits reach this part and every part attached below it · or hold Shift'},
    ]}]},
    {id: 'joint', title: 'Joint', hidden: slider, rows: [{kind: 'grid', rows: [
      !connector && number('Angle', 'joint_angle', degrees(lock ? editor.geometry.objects.get(editor.selectedSlot)?.segments[joint]?.angle : object.angles[joint] ?? segment.angle_rad), '°',
        {disabled: Boolean(lock)}),
      !connector && number('Length', 'joint_length', position, 'px', {min: 0}),
      number('Bend', 'joint_bend', degrees(object.bend_flag ? object.bends[joint] : segment.bend_rad || 0), '°'),
      !connector && staticSwitch,
    ]}]},
    rigIKAllowed(figure, joint) && !slider ? ikSection(editor.getIKSettings()) : {id: 'ik', hidden: true},
    {id: 'rig-controls', bare: true, hidden: slider || !builder, rows: [{kind: 'markup', html: slider || !builder ? '' : rigControlsView(editor, {builder})}]},
    {id: 'style', title: 'Style', hidden: slider, rows: [
      {kind: 'grid', rows: [
        number('Width', 'thickness', segment.thickness, 'px', {min: 0}),
        {kind: 'color', picker: 'paint', id: 'segment-color', label: 'Colour', description: 'Segment color', value: solid ? hex(paint.stops[0].color) : undefined, paint: paintCSS(paint),
          caption: solid ? undefined : `${paint.type[0].toUpperCase()}${paint.type.slice(1)} gradient`},
        number(secondary ? 'Primary opacity' : 'Opacity', 'segment_opacity', opacity(segment.transparency), '%',
          {min: 0, max: 100, id: 'segment-opacity', field: false, description: 'Primary color opacity'}),
        builder ? {kind: 'stepper-field', key: 'segment_z_order', label: 'Order', description: 'Draw order', groupLabel: 'Draw order and one-step order',
          value: order.get(`segment:${joint}`), precision: 0, min: 1, max: order.size,
          down: {action: 'segment-order-down', label: 'Send part backward', icon: STEP_DOWN}, up: {action: 'segment-order-up', label: 'Bring part forward', icon: STEP_UP}}
          : number('Order', 'segment_z_order', order.get(`segment:${joint}`), '', {min: 1, max: order.size, description: 'Draw order'}),
        {kind: 'select', id: 'segment-shape', label: 'Shape', description: 'Segment shape', value: shape, disabled: fixed, span: 2, options: [
          ['line', 'Round line'], ['squareLine', 'Square line'], ['circle', 'White circle'], ['circleFill', 'Filled circle'], ['circleClear', 'Clear circle'],
          ...(fixed ? [[shape, shape]] : []),
        ].map(([value, label]) => ({value, label}))},
        {kind: 'field-switch', id: 'builder-branch', label: 'Apply to branch', checked: builderBranch, span: 2, hidden: builder || !(isBuilderContext(tool) && single)},
      ]},
    ]},
    {id: 'second-colour', title: 'Second colour', place: 'titled', open: secondary, hidden: !twoTone || slider,
      switch: {id: 'segment-gradient-enabled', label: 'Secondary color', checked: secondary, controls: 'segment-secondary-controls'},
      rows: [{kind: 'grid', id: 'segment-secondary-controls', hidden: !secondary, rows: secondary ? [
        {kind: 'color', id: 'segment-gradient-color', label: 'Colour', description: 'Secondary color', value: hex(displayedColor(report, figure, object, segment.secondary.rgb))},
        number('Secondary opacity', 'segment_gradient_opacity', (1 - (segment.secondary.a ?? 0) / 255) * 100, '%', {min: 0, max: 100, description: 'Secondary color opacity'}),
      ] : []}]},
    {id: 'figure', title: 'Figure', rows: [{kind: 'grid', rows: [layerSelect(editor, {span: 2})]}]},
  ]};
}
