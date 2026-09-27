/**
 * The inspector's contexts as section descriptors (architecture.md §3.13).
 * inspectorDescriptor(options) describes what the Properties panel shows for
 * the current selection and mode as {kind, sections}: the scene, the camera,
 * a frame or keyframe, a layer, the drawing tools, several figures, one
 * figure (a figure, text or image; a movieclip instance; a 3D rig; a
 * builder fill) or a joint. inspectorView(options) renders it with
 * src/inspector-kit.mjs.
 *
 * The contexts still render with the legacy skin (src/inspector-legacy.mjs),
 * so the inspector keeps today's markup, look and behaviour while every
 * context is data. Sub-modules that still build HTML (rig controls, the
 * camera's actions and motion, drawing, parallax, drawing sets, the 3D rig's
 * controls, builder surfaces) enter as markup rows until their milestones.
 */
import {joinedDrawingSetsView} from './movieclip-drawings.mjs';
import {spatialControlsView} from './spatial-controls.mjs';
import {drawingInspector} from './drawing-view.mjs';
import {rigControlsView, connectorPositionView} from './rig-controls.mjs';
import {figureJoinAction} from './figure-join-action.mjs';
import {polygonSurfaceView} from './builder-surface-ui.mjs';
import {rigIKAllowed} from './rig-constraints.mjs';
import {cameraMotionView, parallaxView} from './camera-motion-ui.mjs';
import {paintCSS} from './paint.mjs';
import {figurePalette, displayedSegmentPaint, displayedColor} from './figure-colors.mjs';
import {isStatic} from './pivot/geometry.mjs';
import {cameraActionsView} from './camera-view.mjs';
import {cameraValues} from './editor-camera.mjs';
import {builderDrawables} from './editor-builder-style.mjs';
import {isBuilderContext} from './builder-aids.mjs';
import {resolveInstanceFigure} from './animation-style.mjs';
import {ikSection} from './ik-view.mjs';
import {propertyToggle} from './property-toggle.mjs';
import {isMovieclip} from './movieclips.mjs';
import {movieclipSections} from './movieclip-ui.mjs';
import {sheetKeyAt} from './layer-sheet.mjs';
import {renderInspector} from './inspector-kit.mjs';
import {button, esc, grid, group, heading, legacyEnv, numericField, propertyPrecision, tools} from './inspector-legacy.mjs';

const hex = rgb => `#${(rgb || [43, 43, 43]).map(n => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
const num = n => Number(Number(n ?? 0).toFixed(2));
const polygonOpacity = polygon => (polygon.alpha_raw !== undefined ? 1 - polygon.alpha_raw / 255 : polygon.color_alpha ?? 1) * 100;
const pageText = (start, size, total) => `${start + 1}–${Math.min(start + size, total)} / ${total}`;
/** Today's caption under the Transform fields. */
const SCRUB_CAPTION = {kind: 'meta', text: 'Drag a label to scrub its value · Shift or Alt for finer steps'};
/** Today's context heading (a glyph and the context's name) as a section of its own. */
const headingSection = (title, icon) => ({id: 'heading', legacy: {bare: true}, rows: [{kind: 'heading', title, icon}]});

/** A figure's Layer select (Mixed across layers, locked layers disabled); nothing while no figure is selected. */
function layerSection(editor) {
  const ids = new Set([...editor.selectedUids].map(uid => editor.layerForUid(uid))), current = ids.size === 1 ? [...ids][0] : '';
  return {id: 'layer', legacy: {bare: true}, rows: [{
    kind: 'select', id: 'figure-layer', label: 'Layer', description: 'Figure layer', placeholder: 'Mixed', value: current, hidden: !editor.selectedUids.size,
    options: editor.layers.filter(layer => layer.kind === 'layer').reverse().map(layer => ({value: layer.id, label: layer.name, disabled: layer.locked})),
    legacy: {variant: 'field', icon: 'layers'},
  }]};
}

/** A builder order's four steps for one drawable. */
const orderActions = (kind, index) => ({kind: 'actions', items: [
  ['back', 'send-to-back', 'Send to back'], ['down', 'chevron-left', 'Send backward'], ['up', 'chevron-right', 'Bring forward'], ['front', 'bring-to-front', 'Bring to front'],
].map(([direction, icon, label]) => ({action: 'builder-order', icon, label: `${label} · ${kind}`, data: {kind, index, direction}, legacy: {type: 'button'}}))});

/**
 * The current context's sections. Options are inspectorView()'s; propertyState(key)
 * may supply a live value ({value}) for a property while it is being edited.
 */
export function inspectorDescriptor({
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
  if (selectionCount === 1 && isMovieclip(editor.figure)) return {kind: 'movieclip', sections: [layerSection(editor), ...movieclipSections(editor, {number})]};
  const range = {id: 'range', title: 'Frame range', hidden: rangeIndices.length <= 1, rows: [
    {kind: 'checkbox', id: 'apply-range-movement', label: `Apply to ${rangeIndices.length} selected frames`, checked: applyRange},
  ]};
  if (selectionCount > 1) return selectionDescriptor(editor, number, {bounds, selectionCount, range});
  const figure = resolveInstanceFigure(editor.figure, object), joint = editor.selectedJoint;
  if (!builder && figure.segments.some(segment => segment._stykRig?.spatial?.origin)) {
    return {kind: 'spatial-rig', sections: [
      {id: 'drawing-sets', legacy: {bare: true}, rows: [{kind: 'markup', html: joinedDrawingSetsView(editor)}]},
      {id: 'spatial', legacy: {bare: true}, rows: [{kind: 'markup', html: spatialControlsView(editor)}]},
      {id: 'placement', title: 'Placement', hidden: joint >= 0, rows: [{kind: 'grid', rows: [
        number('X', 'root_x', object.root_x, 'px'), number('Y', 'root_y', object.root_y, 'px'), number('Scale', 'scale', object.scale * 100, '%', {min: 0.01}),
      ]}]},
    ]};
  }
  if (builder && editor.selectedPolygonIndex >= 0) return fillDescriptor(editor, figure, number);
  const segment = figure.segments[joint];
  // Pivot origins use -1; segment endpoint indices start at zero.
  const scope = {layer: layerSection(editor), range, sheets: [
    {id: 'drawing-sets', hidden: builder, legacy: {bare: true}, rows: [{kind: 'markup', html: builder ? '' : joinedDrawingSetsView(editor)}]},
    {id: 'spatial', hidden: builder, legacy: {bare: true}, rows: [{kind: 'markup', html: builder ? '' : spatialControlsView(editor)}]},
  ]};
  const order = new Map(builderDrawables(figure).map((item, index) => [`${item.kind}:${item.index}`, index + 1]));
  return joint >= 0 && segment
    ? jointDescriptor(editor, figure, segment, number, {scope, order, tool, builder, builderBranch})
    : figureDescriptor(editor, figure, number, {scope, order, tool, rigMode, polygonPage, palettePage});
}

/** The Properties panel's HTML for the current context (the only content of #inspector, through updateInspectorDOM()). */
export function inspectorView(options) {
  return renderInspector(inspectorDescriptor(options), legacyEnv);
}

function drawingDescriptor(editor, drawing, number, hotkeyLabel) {
  const o = editor.object, f = editor.figure;
  const pose = drawing.tool === 'transform' && o ? renderInspector({kind: 'drawing', sections: [{id: 'transform-drawing', title: 'Transform drawing', rows: [{kind: 'grid', rows: [
    number('X', 'root_x', o.root_x, 'px'), number('Y', 'root_y', o.root_y, 'px'), number('Scale', 'scale', o.scale * 100, '%', {min: 0.01}),
    number('Angle', 'rotation', ((o.angles[0] ?? 0) - (f.segments[0]?.angle_rad ?? 0)) * 180 / Math.PI, '°'),
    number('Opacity', 'figure_opacity', (1 - (o.field28 ?? 0) / 255) * 100, '%', {min: 0, max: 100}),
  ]}]}]}, legacyEnv) : '';
  const html = drawingInspector(drawing, {numericField, group, grid, heading, hotkeyLabel, esc, propertyToggle}, pose);
  return {kind: 'drawing', sections: [{id: 'drawing', legacy: {bare: true}, rows: [{kind: 'markup', html}]}]};
}

function sceneDescriptor(editor, number, propertyState) {
  const report = editor.report, frame = editor.frame, colorState = propertyState?.('scene_color'), backgroundState = propertyState?.('scene_background');
  const background = report.backgrounds?.find(item => item.background_id === (backgroundState?.value ?? frame.background_id));
  const raw = colorState?.value ?? background?.color ?? 0xffffffff;
  const color = typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw : `#${(raw & 0xffffff).toString(16).padStart(6, '0')}`;
  const name = background?.name || 'White';
  return {kind: 'scene', sections: [
    headingSection('Scene', 'scene'),
    {id: 'canvas', title: 'Canvas', rows: [{kind: 'grid', rows: [
      number('W', 'canvas_width', report.canvas_width, 'px', {min: 1, max: 16384}), number('H', 'canvas_height', report.canvas_height, 'px', {min: 1, max: 16384}),
    ]}]},
    {id: 'background', title: 'Background', rows: [
      {kind: 'group', legacy: {className: 'property-row property-color-line'}, rows: [{kind: 'color', id: 'background-color', label: 'Background color', value: color}]},
      {kind: 'group', legacy: {className: 'property-row property-background-line'}, rows: [{kind: 'value', label: 'Background', text: name, tip: name, legacy: {className: 'property-background-name'}}]},
      {kind: 'actions', items: [{action: 'background-style', icon: 'sliders', label: 'Background settings'}, {action: 'import-background', icon: 'image', label: 'Import background'}]},
    ]},
    {id: 'playback', title: 'Playback', rows: [{kind: 'grid', rows: [number('Rate', 'fps', report.fps, 'fps', {min: 1, max: 120})]}]},
  ]};
}

function cameraDescriptor(editor, number) {
  const c = cameraValues((editor.evaluatedFrame || editor.frame).camera), motion = editor._cameraInspectorTab === 'motion';
  const panel = {key: 'camera', className: 'camera-inspector'}, transformPane = {key: 'transform', hidden: motion}, motionPane = {key: 'motion', hidden: !motion};
  const inPanel = {bare: true, wrap: [panel]}, inTransform = {bare: true, wrap: [panel, transformPane]};
  const plain = (action, icon, label, tip, extra = {}) => ({action, icon, label, tip, legacy: {style: 'plain'}, ...extra});
  return {kind: 'camera', sections: [
    {id: 'heading', legacy: inPanel, rows: [{kind: 'heading', title: 'Camera', icon: 'camera', badge: 'Live', legacy: {className: 'camera-heading'}}]},
    // The size's times sign is mis-encoded here as it has been ("Ã—"); the Preview section's port (M7e) writes "×".
    {id: 'preview', legacy: inPanel, rows: [{kind: 'preview', key: 'camera-monitor', label: 'Live camera output', media: {tag: 'canvas', data: {'camera-monitor': true}},
      caption: [`${editor.report.canvas_width} Ã— ${editor.report.canvas_height}`, {text: `${num(100 / c.scale)}% zoom`, data: {'camera-magnification': true}}],
      legacy: {className: 'camera-monitor', captionClass: 'camera-monitor-caption'}}]},
    {id: 'tabs', legacy: inPanel, rows: [{kind: 'segmented', mode: 'tab', description: 'Camera controls', value: motion ? 'motion' : 'transform', options: [
      {value: 'transform', label: 'Transform', data: {'camera-tab': 'transform'}}, {value: 'motion', label: 'Motion', data: {'camera-tab': 'motion'}},
    ], legacy: {className: 'camera-inspector-tabs'}}]},
    {id: 'pose', legacy: inTransform, rows: [{kind: 'actions', legacy: {className: 'camera-quick-actions'}, items: [
      plain('camera-guides', 'grid', 'Guides', 'Show composition guides', {pressed: true}),
      plain('camera-level', 'rotate', 'Level', 'Set camera rotation to zero'),
      plain('camera-reset', 'undo', 'Reset', 'Reset camera pose'),
    ]}]},
    {id: 'transform', title: 'Transform', legacy: {wrap: [panel, transformPane]}, rows: [{kind: 'grid', rows: [
      number('X', 'camera_x', c.x || 0, 'px'), number('Y', 'camera_y', c.y || 0, 'px'),
      number('Scale', 'camera_scale', (c.scale || 1) * 100, '%', {min: 0.01}), number('Rotation', 'camera_angle', ((c.angle_rad || 0) * 180) / Math.PI, '°'),
    ]}]},
    {id: 'camera-actions', legacy: inTransform, rows: [{kind: 'markup', html: cameraActionsView({editor, button, group, tools})}]},
    {id: 'motion', legacy: {bare: true, wrap: [panel, motionPane]}, rows: [{kind: 'markup', html: cameraMotionView(editor)}]},
  ]};
}

function frameDescriptor(editor, number) {
  if (editor.report._styk?.layerSheet) {
    const track = editor.report._styk.layerSheet.tracks[editor.activeLayerId], {key, next} = sheetKeyAt(track, editor.tick);
    return {kind: 'frame', sections: [
      headingSection(`Frame ${editor.tick + 1}`, 'diamond'),
      {id: 'exposure', title: editor.getLayer(editor.activeLayerId)?.name ?? 'Layer', rows: [{kind: 'grid', rows: [
        number('Exposure', 'duration', (next?.tick ?? track?.end ?? editor.tick + 1) - (key?.tick ?? editor.tick), 'frames', {min: 1, max: 65535}),
      ]}]},
      {id: 'frames', title: 'Frames', rows: [{kind: 'actions', items: [{action: 'add-frame', icon: 'diamond', label: 'Insert keyframe (F6)'}]}]},
    ]};
  }
  return {kind: 'keyframe', sections: [
    headingSection(`Keyframe ${(editor.frameIndex ?? 0) + 1}`, 'diamond'),
    {id: 'timing', title: 'Timing', rows: [{kind: 'grid', rows: [number('Duration', 'duration', editor.frame.duration_raw ?? 1, 'ticks', {min: 0, max: 65535})]}]},
  ]};
}

function layerDescriptor(editor) {
  const layer = editor.getLayer?.(editor.activeLayerId) ?? {id: 'layer-1', name: 'Layer', visible: true, locked: false, figureUids: []};
  const data = {'layer-id': layer.id};
  return {kind: 'layer', sections: [
    headingSection(layer.name, 'layers'),
    {id: 'layer', title: 'Layer', rows: [
      {kind: 'text', id: 'inspector-layer-name', label: 'Name', description: 'Layer name', value: layer.name, maxlength: 160, data, legacy: {variant: 'stacked', inputClass: 'property-layer-name'}},
      {kind: 'checkbox', id: 'inspector-layer-visible', label: 'Visible', checked: layer.visible, data},
      {kind: 'checkbox', id: 'inspector-layer-locked', label: 'Locked', checked: layer.locked, data},
    ]},
    {id: 'parallax', legacy: {bare: true}, rows: [{kind: 'markup', html: parallaxView(editor, layer.id)}]},
  ]};
}

function selectionDescriptor(editor, number, {bounds: b, selectionCount, range}) {
  const object = editor.object;
  const align = [['left', 'align-left'], ['center-x', 'align-horizontal-center'], ['right', 'align-right'], ['top', 'align-top'], ['center-y', 'align-vertical-center'], ['bottom', 'align-bottom']];
  return {kind: 'figures', sections: [
    headingSection(`${selectionCount} figures`, 'layers'),
    layerSection(editor),
    {id: 'selection', title: 'Selection', rows: [{kind: 'actions', items: [
      {action: 'duplicate', icon: 'duplicate', label: 'Duplicate selection'}, {action: 'delete', icon: 'trash', label: 'Delete selection'},
    ]}]},
    range,
    {id: 'transform', title: 'Transform', rows: [
      {kind: 'grid', rows: [
        number('X', 'group_x', b.minX, 'px'), number('Y', 'group_y', b.minY, 'px'),
        number('W', 'group_width', b.maxX - b.minX, 'px', {min: 0.01}), number('H', 'group_height', b.maxY - b.minY, 'px', {min: 0.01}),
      ]},
      SCRUB_CAPTION,
      {kind: 'actions', items: [
        {action: 'mirror', icon: 'flip', label: 'Flip horizontally'}, {action: 'rotate', icon: 'rotate', label: 'Rotate 15°'}, {action: 'center', icon: 'center', label: 'Center selection'},
      ]},
    ]},
    {id: 'align', title: 'Align', rows: [{kind: 'actions', items: align.map(([name, icon]) => ({action: `align-${name}`, icon, label: `Align ${name.replace('-', ' ')}`}))}]},
    {id: 'appearance', title: 'Appearance', rows: [
      {kind: 'color', id: 'figure-color', label: 'Figure color', value: '#2b2b2b'},
      {kind: 'grid', legacy: {className: 'property-opacity-grid'}, rows: [number('Opacity', 'figure_opacity', (1 - (object.field28 || 0) / 255) * 100, '%',
        {min: 0, max: 100, id: 'figure-opacity', field: false, animated: false, wide: true})]},
      {kind: 'actions', items: [
        {action: 'reset-color', icon: 'undo', label: 'Reset colors'}, {action: 'layer-down', icon: 'send-to-back', label: 'Send backward'}, {action: 'layer-up', icon: 'bring-to-front', label: 'Bring forward'},
      ]},
    ]},
    {id: 'connections', title: 'Connections', rows: [{kind: 'actions', legacy: {bare: true}, items: [{action: 'combine-figures', icon: 'combine', label: 'Combine connected', text: true}]}]},
  ]};
}

/** A fill picked in the builder: its colour, delete, opacity, surface and order. */
function fillDescriptor(editor, figure, number) {
  const index = editor.selectedPolygonIndex, polygon = figure.polyfills[index];
  return {kind: 'fill', sections: [{id: 'fill', title: 'Fill', rows: [
    {kind: 'group', legacy: {className: 'polygon-row'}, rows: [
      {kind: 'swatch', picker: 'native', label: 'Fill color', value: hex(displayedColor(editor.report, figure, editor.object, polygon.color_rgb)), data: {'polygon-color': index}},
      {kind: 'actions', legacy: {bare: true}, items: [{icon: 'trash', label: 'Delete fill', data: {'delete-polygon': index}, legacy: {title: false}}]},
    ]},
    number('Opacity', `polygon_${index}_opacity`, polygonOpacity(polygon), '%', {min: 0, max: 100, animated: Boolean(editor.propertyChannels)}),
    {kind: 'markup', html: polygonSurfaceView(editor, index)},
    orderActions('polygon', index),
  ]}]};
}

/** One figure, text or image: its name, placement, look, stacking, connection, fills and colours. */
function figureDescriptor(editor, figure, number, {scope, order, tool, rigMode, polygonPage, palettePage}) {
  const report = editor.report, frame = editor.frame, object = editor.object;
  // A joint index past the figure's segments shows the figure, without its colours.
  const whole = editor.selectedJoint < 0, palette = whole ? editor.figurePalette() : [], own = whole ? figurePalette(report, figure, object) : [];
  const kind = figure.segments.every(segment => segment.primitive_code === 5) ? 'text' : figure.segments.every(segment => segment.primitive_code === 2) ? 'image' : 'figure';
  const children = frame.objects.some(part => part.join?.target_object_slot === object.object_slot);
  const parent = object.join ? frame.objects[object.join.target_object_slot] : null;
  const parentName = parent && (parent.name || report.figure_types.find(type => type.figure_type_id === parent.figure_type_id)?.name || 'Figure');
  const polygons = figure.polyfills || [], start = Math.min(Math.max(0, polygonPage) * 12, Math.max(0, Math.floor((polygons.length - 1) / 12) * 12));
  const paletteStart = Math.min(Math.max(0, palettePage) * 32, Math.max(0, Math.ceil(palette.length / 32) - 1) * 32);
  const fill = index => ({kind: 'group', legacy: {className: 'polygon-item'}, rows: [
    {kind: 'group', legacy: {className: 'polygon-row'}, rows: [
      {kind: 'value', label: 'Fill', text: `Polygon ${index + 1}`},
      {kind: 'swatch', picker: 'native', label: `Polygon ${index + 1} color`, value: hex(displayedColor(report, figure, object, polygons[index].color_rgb)), data: {'polygon-color': index}},
      {kind: 'actions', legacy: {bare: true}, items: [{icon: 'trash', label: `Delete polygon ${index + 1}`, data: {'delete-polygon': index}, legacy: {title: false}}]},
    ]},
    {kind: 'group', data: {'polygon-index': index}, legacy: {tag: 'details', className: 'polygon-style-details', summary: 'Opacity & draw order'}, rows: [
      number('Opacity', `polygon_${index}_opacity`, polygonOpacity(polygons[index]), '%', {min: 0, max: 100, animated: Boolean(editor.propertyChannels)}),
      number('Order', `polygon_${index}_z_order`, order.get(`polygon:${index}`), '', {min: 1, max: order.size, animated: false}),
      orderActions('polygon', index),
    ]},
  ]});
  return {kind, sections: [
    {id: 'name', title: '', rows: [{kind: 'text', id: 'figure-name', label: 'Name', description: 'Figure name', tip: 'Rename figure definition', value: figure.name || 'Figure',
      legacy: {variant: 'heading', icon: kind === 'text' ? 'text' : kind === 'image' ? 'image' : 'person', inputClass: 'figure-name'}}]},
    scope.layer, scope.range, ...scope.sheets,
    {id: 'connected', title: 'Connected figure', hidden: !(object.join || children), rows: [{kind: 'actions', legacy: {bare: true}, items: [
      {action: 'combine-figures', icon: 'combine', label: 'Merge into one figure', text: true, legacy: {type: 'button'}},
    ]}]},
    {id: 'rig', title: 'Edit rig', hidden: tool !== 'rig', rows: [
      {kind: 'select', id: 'rig-mode', label: 'Mode', description: 'Rig edit mode', value: rigMode, options: [{value: 'move', label: 'Move joint'}, {value: 'rotate', label: 'Rotate branch'}]},
      {kind: 'actions', legacy: {bare: true}, items: [{action: 'add-sprite-segment', icon: 'image', label: 'Add sprite part…', text: true, legacy: {type: 'button'}}]},
    ]},
    {id: 'text', title: 'Text', hidden: !figure.text_assets?.some(asset => asset.glyphs?.length), rows: [{kind: 'actions', legacy: {bare: true}, items: [
      {action: 'edit-text', icon: 'text', label: 'Edit text', text: true},
    ]}]},
    {id: 'transform', title: 'Transform', rows: [
      {kind: 'grid', rows: [
        number('X', 'root_x', object.root_x, 'px'), number('Y', 'root_y', object.root_y, 'px'), number('Scale', 'scale', object.scale * 100, '%', {min: 0.01}),
        number('Angle', 'rotation', (((object.angles[0] ?? 0) - (figure.segments[0]?.angle_rad ?? 0)) * 180) / Math.PI, '°'),
      ]},
      SCRUB_CAPTION,
    ]},
    {id: 'appearance', title: 'Appearance', actions: [{action: 'reset-color', icon: 'undo', label: 'Reset colors'}], rows: [{kind: 'group', legacy: {className: 'property-paint-row'}, rows: [
      {kind: 'color', id: 'figure-color', label: 'Colour', description: 'Recolor all segments', value: own[0]?.color ?? '#000000', caption: own.length > 1 ? 'Mixed' : undefined},
      number('Opacity', 'figure_opacity', (1 - (object.field28 || 0) / 255) * 100, '%', {min: 0, max: 100, id: 'figure-opacity', field: false}),
    ]}]},
    {id: 'stacking', title: 'Stacking', rows: [
      {kind: 'grid', rows: [number('Z-index', 'figure_z_order', object._stykZIndex ?? 0, '', {min: -1000000, max: 1000000})]},
      {kind: 'actions', items: [
        {action: 'layer-back', icon: 'send-to-back', label: 'Send to back'}, {action: 'layer-down', icon: 'chevron-left', label: 'Send backward'},
        {action: 'layer-up', icon: 'chevron-right', label: 'Bring forward'}, {action: 'layer-front', icon: 'bring-to-front', label: 'Bring to front'},
      ]},
    ]},
    {id: 'connection', title: 'Connection', rows: [{kind: 'group', legacy: {className: 'connection-row'}, rows: [
      {kind: 'value', label: 'Joined to', text: parent ? `${parentName} · ${object.join.target_handle_id}` : 'None'},
      {kind: 'actions', legacy: {bare: true}, items: [
        {action: 'join-figure', icon: parent ? 'detach' : 'link', label: parent ? 'Unjoin figure' : 'Join figure', disabled: !figureJoinAction(editor)},
        {action: 'combine-figures', icon: 'combine', label: 'Combine connected figures', disabled: !parent && !children},
      ]},
    ]}]},
    {id: 'polygons', title: 'Polygons', hidden: !polygons.length, legacy: {count: polygons.length}, rows: [
      ...polygons.slice(start, start + 12).map((_, i) => fill(start + i)),
      polygons.length > 12 && {kind: 'pager', label: 'Polygon pages', text: pageText(start, 12, polygons.length),
        previous: {action: 'polygons-previous', icon: 'chevron-left', label: 'Previous polygons', disabled: start === 0},
        next: {action: 'polygons-next', icon: 'chevron-right', label: 'Next polygons', disabled: start + 12 >= polygons.length}},
    ]},
    {id: 'palette', title: 'Color palette', legacy: {count: `${palette.length} ${palette.length === 1 ? 'color' : 'colors'}`}, rows: [
      {kind: 'swatches', label: 'Figure color palette', items: palette.slice(paletteStart, paletteStart + 32).map(entry => ({
        picker: 'paint', value: entry.color, text: entry.color.toUpperCase(), data: {'palette-color': entry.color},
        label: `Replace ${entry.color.toUpperCase()}, ${entry.segments.length} segments${entry.polygons.length ? `, ${entry.polygons.length} fills` : ''}`,
      }))},
      palette.length > 32 && {kind: 'pager', label: 'Colour pages', text: pageText(paletteStart, 32, palette.length),
        previous: {action: 'palette-previous', icon: 'chevron-left', label: 'Previous colors', disabled: paletteStart === 0},
        next: {action: 'palette-next', icon: 'chevron-right', label: 'Next colors', disabled: paletteStart + 32 >= palette.length}},
    ]},
  ]};
}

/**
 * A joint (or a branch, or several segments): its connector parts, its name
 * in the builder, angle, length, bend and Static, IK, the rig controls and its
 * look. A connector's Slider part shows only the slide and Static.
 */
function jointDescriptor(editor, figure, segment, number, {scope, order, tool, builder, builderBranch}) {
  const report = editor.report, object = editor.object, joint = editor.selectedJoint, selected = editor.selectedSegmentIds;
  const connector = segment._stykRig?.connector, single = selected.size <= 1;
  const connectorScope = editor._connectorInspector;
  const part = connector && single ? (connectorScope?.uid === editor.selectedUid && connectorScope?.id === segment.segment_id ? connectorScope.part : 'slider') : null;
  const slider = part === 'slider';
  const staticSwitch = {kind: 'switch', id: 'static-joint', label: 'Static', checked: isStatic(segment), icon: 'diamond'};
  const sections = [
    scope.layer, scope.range, ...scope.sheets,
    {id: 'connector', hidden: !part, legacy: {bare: true}, rows: [
      {kind: 'heading', title: `Connector ${segment.segment_id}`, icon: 'link'},
      {kind: 'segmented', mode: 'pressed', description: 'Connector properties', value: part, options: [
        {value: 'segment', label: 'Segment', data: {'connector-part': 'segment'}}, {value: 'slider', label: 'Slider', data: {'connector-part': 'slider'}},
      ], legacy: {className: 'connector-property-tabs'}},
    ]},
    {id: 'slider', title: 'Slider', hidden: !slider, rows: [
      {kind: 'markup', html: slider ? connectorPositionView(editor) : ''},
      {kind: 'group', legacy: {className: 'joint-settings'}, rows: [staticSwitch]},
    ]},
  ];
  if (slider) return {kind: 'joint', sections};
  const paint = displayedSegmentPaint(report, figure, object, segment);
  const twoTone = [1, 3, 4].includes(segment.primitive_code) &&
    (single || figure.segments.every(item => !selected.has(item.segment_id) || [1, 3, 4].includes(item.primitive_code)));
  const secondary = twoTone && Boolean(segment.secondary);
  const shape = ['line', 'circle', 'image', 'circleFill', 'circleClear', 'text', 'squareLine'][segment.primitive_code ?? 0];
  const fixed = ['image', 'text'].includes(shape), lock = segment._stykRig?.angleLock;
  const solid = paint.type === 'solid';
  sections.push(
    {id: 'joint-heading', hidden: Boolean(part), legacy: {bare: true}, rows: [{kind: 'heading', icon: 'nodes',
      title: selected.size > 1 ? `${selected.size} segments` : `${editor.branchSelected ? 'Branch from joint' : 'Joint'} ${segment.segment_id}`}]},
    {id: 'joint-name', title: '', hidden: !builder, rows: [{kind: 'text', id: 'builder-joint-name', label: 'Joint name', description: 'Joint name', value: segment.name ?? '',
      maxlength: 120, legacy: {labelClass: 'rig-select', inputClass: 'inline-select'}}]},
    {id: 'joint', title: 'Transform', rows: [
      {kind: 'grid', rows: [
        !connector && number('Angle', 'joint_angle',
          ((lock ? editor.geometry.objects.get(editor.selectedSlot)?.segments[joint]?.angle : object.angles[joint] ?? segment.angle_rad) * 180) / Math.PI, '°', {disabled: Boolean(lock)}),
        !connector && number('Length', 'joint_length', object.len_flag ? object.lengths[joint] : segment.length, 'px', {min: 0}),
        number('Bend', 'joint_bend', ((object.bend_flag ? object.bends[joint] : segment.bend_rad || 0) * 180) / Math.PI, '°'),
      ]},
      !connector && {kind: 'group', legacy: {className: 'joint-settings'}, rows: [staticSwitch]},
    ]},
    rigIKAllowed(figure, joint) ? ikSection(editor.getIKSettings()) : {id: 'ik', hidden: true},
    {id: 'rig-controls', legacy: {bare: true}, rows: [{kind: 'markup', html: rigControlsView(editor, {builder})}]},
    {id: 'appearance', title: 'Appearance', rows: [
      {kind: 'grid', rows: [
        number('Width', 'thickness', segment.thickness, 'px', {min: 0}),
        number('Order', 'segment_z_order', order.get(`segment:${joint}`), '', {min: 1, max: order.size, animated: false}),
      ]},
      {kind: 'checkbox', id: 'builder-branch', label: 'Apply to branch', checked: builderBranch, hidden: !((isBuilderContext(tool) || builder) && single)},
      {kind: 'select', id: 'segment-shape', label: 'Shape', description: 'Segment shape', value: shape, disabled: fixed, options: [
        ['line', 'Round line'], ['squareLine', 'Square line'], ['circle', 'White circle'], ['circleFill', 'Filled circle'], ['circleClear', 'Clear circle'],
        ...(fixed ? [[shape, shape]] : []),
      ].map(([value, label]) => ({value, label}))},
      {kind: 'group', legacy: {className: 'property-paint-row'}, rows: [
        {kind: 'color', picker: 'paint', id: 'segment-color', label: 'Colour', description: 'Segment color', value: solid ? hex(paint.stops[0].color) : undefined, paint: paintCSS(paint),
          caption: solid ? hex(paint.stops[0].color).toUpperCase() : `${paint.type[0].toUpperCase()}${paint.type.slice(1)} gradient`},
        number(secondary ? 'Primary opacity' : 'Opacity', 'segment_opacity', (1 - (segment.transparency || 0) / 255) * 100, '%',
          {min: 0, max: 100, id: 'segment-opacity', field: false, description: 'Primary color opacity'}),
      ]},
      twoTone && {kind: 'group', legacy: {className: 'secondary-color-settings'}, rows: [
        {kind: 'switch', id: 'segment-gradient-enabled', label: 'Secondary color', checked: secondary, icon: 'circle', controls: 'segment-secondary-controls'},
        {kind: 'group', id: 'segment-secondary-controls', hidden: !secondary, rows: secondary ? [{kind: 'group', legacy: {className: 'property-paint-row'}, rows: [
          {kind: 'color', id: 'segment-gradient-color', label: 'Colour', description: 'Secondary color', value: hex(displayedColor(report, figure, object, segment.secondary.rgb))},
          number('Secondary opacity', 'segment_gradient_opacity', (1 - (segment.secondary.a ?? 0) / 255) * 100, '%', {min: 0, max: 100, description: 'Secondary color opacity'}),
        ]}] : []},
      ]},
    ]},
  );
  return {kind: 'joint', sections};
}
