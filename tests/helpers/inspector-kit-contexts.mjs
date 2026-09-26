/**
 * Inspector descriptors for today's contexts, built from the same editor
 * reads as src/inspector-view.mjs, for tests/inspector-kit.test.mjs's
 * parity cases. They cover each context's key controls (the ids, properties
 * and hooks that handlers and tests look up), laid out as the redesign's
 * sections (experience.md §5, architecture.md §3.13), so the tests show a
 * descriptor reproduces today's contract exactly. Not a complete port: M4
 * moves inspector-view.mjs itself to descriptors.
 */
import {figurePalette, displayedSegmentPaint} from '../../src/figure-colors.mjs';
import {paintCSS} from '../../src/paint.mjs';
import {cameraValues} from '../../src/editor-camera.mjs';
import {builderDrawables} from '../../src/editor-builder-style.mjs';
import {resolveInstanceFigure} from '../../src/animation-style.mjs';
import {BRUSH_BLEND_LABELS} from '../../src/drawing-view.mjs';
import {isStatic} from '../../src/pivot/geometry.mjs';

const degrees = radians => radians * 180 / Math.PI;
const hex = rgb => `#${(rgb || [43, 43, 43]).map(n => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
const opacity = raw => (1 - (raw || 0) / 255) * 100;

/** The figure's Layer select: today's #figure-layer with its Mixed placeholder and locked layers disabled. */
export function layerSelect(editor) {
  const ids = new Set([...editor.selectedUids].map(uid => editor.layerForUid(uid)));
  const current = ids.size === 1 ? [...ids][0] : undefined;
  return {
    kind: 'select', id: 'figure-layer', label: 'Layer', description: 'Figure layer', placeholder: 'Mixed', value: current,
    options: editor.layers.filter(layer => layer.kind === 'layer').reverse().map(layer => ({value: layer.id, label: layer.name, disabled: layer.locked})),
  };
}

/** A figure, text or image: Transform, Appearance, Arrange core sections; Colours titled. */
export function figureInspector(editor) {
  const object = editor.object, figure = resolveInstanceFigure(editor.figure, object);
  const own = figurePalette(editor.report, figure, object), palette = editor.figurePalette();
  const text = figure.segments.every(segment => segment.primitive_code === 5);
  const joined = Boolean(object.join);
  return {
    kind: text ? 'text' : figure.segments.every(segment => segment.primitive_code === 2) ? 'image' : 'figure',
    quick: {context: 'figure', label: 'Figure actions'},
    sections: [
      {id: 'name', rows: [{kind: 'text', id: 'figure-name', label: 'Name', description: 'Figure name', tip: 'Rename figure definition', value: figure.name || 'Figure'}]},
      text && {id: 'text', title: 'Text', rows: [{kind: 'actions', items: [{action: 'edit-text', icon: 'text', label: 'Edit text', text: true, variant: 'outline'}]}]},
      {id: 'transform', title: 'Transform', rows: [{kind: 'grid', rows: [
        {kind: 'number', key: 'root_x', label: 'X', unit: 'px', value: object.root_x},
        {kind: 'number', key: 'root_y', label: 'Y', unit: 'px', value: object.root_y},
        {kind: 'number', key: 'scale', label: 'Scale', unit: '%', value: object.scale * 100, min: 0.01},
        {kind: 'number', key: 'rotation', label: 'Angle', unit: '°', value: degrees((object.angles[0] ?? 0) - (figure.segments[0]?.angle_rad ?? 0))},
      ]}]},
      {id: 'appearance', title: 'Appearance', actions: [{action: 'reset-color', icon: 'undo', label: 'Reset colors'}], rows: [{kind: 'grid', rows: [
        {kind: 'color', id: 'figure-color', label: 'Colour', description: 'Recolor all segments', value: own[0]?.color ?? '#000000', caption: own.length > 1 ? 'Mixed' : undefined},
        {kind: 'number', key: 'figure_opacity', id: 'figure-opacity', field: false, label: 'Opacity', unit: '%', value: opacity(object.field28), min: 0, max: 100},
      ]}]},
      {id: 'arrange', title: 'Arrange', actions: [{action: 'join-figure', label: joined ? 'Unjoin figure' : 'Join figure', icon: joined ? 'detach' : 'link'}], rows: [
        {kind: 'grid', ratio: '3:2', stackNarrow: true, rows: [
          layerSelect(editor),
          {kind: 'stepper-field', key: 'figure_z_order', label: 'Order', description: 'Z-index', precision: 0, value: object._stykZIndex ?? 0, min: -1000000, max: 1000000,
            down: {action: 'layer-down', label: 'Send backward', icon: 'chevron-left'}, up: {action: 'layer-up', label: 'Bring forward', icon: 'chevron-right'}},
        ]},
      ]},
      {id: 'connection', title: 'Connection', place: 'titled', open: ctx => Boolean(ctx?.joined), rows: [
        {kind: 'actions', items: [{action: 'combine-figures', icon: 'combine', label: 'Combine connected', text: true, variant: 'outline', disabled: !joined}]},
      ]},
      {id: 'colours', title: 'Colours', place: 'titled', rows: [{kind: 'swatches', label: 'Figure color palette', items: palette.map(entry => ({
        picker: 'paint', value: entry.color, label: `Replace ${entry.color.toUpperCase()}, ${entry.segments.length} segments${entry.polygons.length ? `, ${entry.polygons.length} fills` : ''}`,
        data: {'palette-color': entry.color},
      }))}]},
    ].filter(Boolean),
    footer: [{action: 'add-to-library', icon: 'layers', label: 'Add to library'}],
  };
}

/** A joint: Joint (angle, length, bend, Static), IK, Style (width, order, shape, colour, opacity). */
export function jointInspector(editor, {ik = editor.getIKSettings(), ikAllowed = true} = {}) {
  const object = editor.object, figure = resolveInstanceFigure(editor.figure, object), joint = editor.selectedJoint, segment = figure.segments[joint];
  const lock = segment._stykRig?.angleLock;
  const angle = lock ? editor.geometry.objects.get(editor.selectedSlot)?.segments[joint]?.angle : object.angles[joint] ?? segment.angle_rad;
  const order = new Map(builderDrawables(figure).map((item, index) => [`${item.kind}:${item.index}`, index + 1]));
  const paint = displayedSegmentPaint(editor.report, figure, object, segment);
  const shape = ['line', 'circle', 'image', 'circleFill', 'circleClear', 'text', 'squareLine'][segment.primitive_code ?? 0];
  const fixed = ['image', 'text'].includes(shape);
  return {
    kind: 'joint',
    quick: {context: 'joint', label: 'Joint actions'},
    sections: [
      {id: 'joint', title: 'Joint', rows: [{kind: 'grid', rows: [
        {kind: 'number', key: 'joint_angle', label: 'Angle', unit: '°', value: degrees(angle), disabled: Boolean(lock)},
        {kind: 'number', key: 'joint_length', label: 'Length', unit: 'px', value: object.len_flag ? object.lengths[joint] : segment.length, min: 0},
        {kind: 'number', key: 'joint_bend', label: 'Bend', unit: '°', value: degrees(object.bend_flag ? object.bends[joint] : segment.bend_rad || 0)},
        {kind: 'field-switch', id: 'static-joint', label: 'Static', checked: isStatic(segment)},
      ]}]},
      ikAllowed && ikSection(ik),
      {id: 'style', title: 'Style', rows: [
        {kind: 'grid', rows: [
          {kind: 'number', key: 'thickness', label: 'Width', unit: 'px', value: segment.thickness, min: 0},
          {kind: 'number', key: 'segment_z_order', label: 'Order', precision: 0, value: order.get(`segment:${joint}`), min: 1, max: order.size},
          {kind: 'select', id: 'segment-shape', label: 'Shape', description: 'Segment shape', value: shape, disabled: fixed, span: 2, options: [
            ['line', 'Round line'], ['squareLine', 'Square line'], ['circle', 'White circle'], ['circleFill', 'Filled circle'], ['circleClear', 'Clear circle'],
            ...(fixed ? [[shape, shape]] : []),
          ].map(([value, label]) => ({value, label}))},
          {kind: 'color', picker: 'paint', id: 'segment-color', label: 'Colour', description: 'Segment color', value: paint.type === 'solid' ? hex(paint.stops[0].color) : undefined,
            paint: paintCSS(paint), caption: paint.type === 'solid' ? undefined : `${paint.type[0].toUpperCase()}${paint.type.slice(1)} gradient`},
          {kind: 'number', key: 'segment_opacity', id: 'segment-opacity', field: false, label: 'Opacity', description: 'Primary color opacity', unit: '%',
            value: opacity(segment.transparency), min: 0, max: 100},
        ]},
      ]},
    ].filter(Boolean),
  };
}

/** IK: Use IK switch; Pinned, Stretch, Chain, Rotation and the bend direction while IK is on (today's #node-ik-* controls). */
export function ikSection(ik) {
  return {
    id: 'ik', title: 'IK', rows: [
      {kind: 'grid', rows: [{kind: 'field-switch', id: 'node-is-ik', label: 'Use IK', description: 'IK', tip: 'Inverse kinematics', checked: ik.enabled, controls: 'node-ik-options'}]},
      ...(ik.enabled ? [
        {kind: 'grid', rows: [
          {kind: 'field-switch', id: 'node-ik-pinned', label: 'Pinned', checked: ik.pinned},
          {kind: 'field-switch', id: 'node-ik-stretch', label: 'Stretch', tip: 'Allow stretch', checked: ik.allowStretch},
        ]},
        {kind: 'stepper', id: 'node-ik-chain', label: 'Chain', description: 'IK chain length', value: ik.chainLength, min: 1, max: ik.maxLength, step: 1,
          down: {label: 'Shorter chain'}, up: {label: 'Longer chain'}},
        {kind: 'grid', rows: [{kind: 'number', id: 'node-ik-rotation', label: 'Rotation', description: 'IK target rotation', unit: '°', step: 1, precision: 2,
          value: Math.round(ik.target.rotation * 180 / Math.PI * 100) / 100}]},
        {kind: 'segmented', label: 'Bend', description: 'IK bend direction', name: 'node-ik-bend', value: ik.bendDirection, options: [[-1, 'Left'], [0, 'Both'], [1, 'Right']]
          .map(([value, label]) => ({value, label, description: `Bend ${label.toLowerCase()}`}))},
      ] : []),
    ],
  };
}

/** The camera: its Preview (the monitor) and Transform, and today's Transform │ Motion tabs. */
export function cameraInspector(editor) {
  const camera = cameraValues((editor.evaluatedFrame || editor.frame).camera), motion = editor._cameraInspectorTab === 'motion';
  return {
    kind: 'camera',
    quick: {context: 'camera', label: 'Camera actions'},
    sections: [
      {id: 'view', rows: [{kind: 'segmented', mode: 'tab', description: 'Camera controls', fill: true, value: motion ? 'motion' : 'transform',
        options: [['transform', 'Transform'], ['motion', 'Motion']].map(([value, label]) => ({value, label, data: {'camera-tab': value}}))}]},
      {id: 'preview', title: 'Preview', place: 'titled', open: true, rows: [{kind: 'card', media: {tag: 'canvas', key: 'camera-monitor', label: 'Live camera output', data: {'camera-monitor': true}},
        caption: [`${editor.report.canvas_width} × ${editor.report.canvas_height}`, {text: `${Number((100 / camera.scale).toFixed(2))}% zoom`, data: {'camera-magnification': true}}]}]},
      {id: 'transform', title: 'Transform', actions: [
        {action: 'camera-copy', icon: 'duplicate', label: 'Copy camera pose'},
        {action: 'camera-paste', icon: 'clipboard', label: 'Paste camera pose', disabled: !editor._cameraClipboard},
      ], rows: [{kind: 'grid', rows: [
        {kind: 'number', key: 'camera_x', label: 'X', unit: 'px', value: camera.x || 0},
        {kind: 'number', key: 'camera_y', label: 'Y', unit: 'px', value: camera.y || 0},
        {kind: 'number', key: 'camera_scale', label: 'Scale', unit: '%', value: (camera.scale || 1) * 100, min: 0.01},
        {kind: 'number', key: 'camera_angle', label: 'Rotation', unit: '°', value: degrees(camera.angle_rad || 0)},
      ]}]},
    ],
  };
}

/** The Scene: canvas size, background colour and its settings, the frame rate. */
export function sceneInspector(editor) {
  const report = editor.report, background = report.backgrounds?.find(b => b.background_id === editor.frame.background_id);
  const raw = background?.color ?? 0xffffffff, color = `#${(raw & 0xffffff).toString(16).padStart(6, '0')}`;
  return {
    kind: 'scene',
    sections: [
      {id: 'canvas', title: 'Canvas', rows: [{kind: 'grid', rows: [
        {kind: 'number', key: 'canvas_width', label: 'W', unit: 'px', precision: 0, value: report.canvas_width, min: 1, max: 16384},
        {kind: 'number', key: 'canvas_height', label: 'H', unit: 'px', precision: 0, value: report.canvas_height, min: 1, max: 16384},
      ]}]},
      {id: 'background', title: 'Background', actions: [
        {action: 'background-style', icon: 'sliders', label: 'Background settings'},
        {action: 'import-background', icon: 'image', label: 'Import background'},
      ], rows: [{kind: 'grid', rows: [{kind: 'color', id: 'background-color', label: 'Colour', description: 'Background color', value: color}]},
        {kind: 'meta', text: background?.name || 'White'}]},
      {id: 'playback', title: 'Playback', rows: [{kind: 'grid', rows: [
        {kind: 'number', key: 'fps', label: 'Rate', unit: 'fps', precision: 0, value: report.fps, min: 1, max: 120},
      ]}]},
    ],
  };
}

/** A layer (a drawing layer in the tests): name, Visible and Locked, and Parallax as a titled section with its switch. */
export function layerInspector(editor) {
  const layer = editor.getLayer(editor.activeLayerId), parallax = layer.parallax ?? {enabled: false, linked: true, x: 1, y: 1};
  const presets = [[0.15, 'Distant'], [0.45, 'Background'], [1, 'Normal'], [1.4, 'Foreground']];
  const custom = !parallax.linked || !presets.some(([value]) => value === parallax.x);
  const data = {'layer-id': layer.id};
  return {
    kind: 'layer',
    sections: [
      {id: 'layer', title: 'Layer', rows: [
        {kind: 'text', id: 'inspector-layer-name', label: 'Name', description: 'Layer name', value: layer.name, maxlength: 160, data},
        {kind: 'checkbox', id: 'inspector-layer-visible', label: 'Visible', checked: layer.visible, data},
        {kind: 'checkbox', id: 'inspector-layer-locked', label: 'Locked', checked: layer.locked, data},
      ]},
      {id: 'parallax', title: 'Parallax', place: 'titled', open: () => parallax.enabled, data: {'parallax-layer': layer.id},
        switch: {label: 'Enable parallax', checked: parallax.enabled, disabled: layer.locked, data: {'parallax-field': 'enabled'}},
        rows: [
          {kind: 'select', label: 'Preset', description: 'Parallax preset', data: {'parallax-field': 'preset'}, disabled: layer.locked,
            options: [...(custom ? [{value: 'custom', label: 'Custom', selected: true}] : []), ...presets.map(([value, label]) => ({value, label, selected: !custom && parallax.x === value}))]},
          {kind: 'slider', label: 'Movement', description: 'Parallax movement', min: 0, max: 400, value: parallax.x * 100, unit: '%', disabled: layer.locked, data: {'parallax-field': 'movement'}},
          {kind: 'grid', rows: ['x', 'y'].map(axis => ({kind: 'number', key: `parallax_${axis}`, field: false, label: axis.toUpperCase(), description: `Parallax ${axis.toUpperCase()}`,
            scrubLabel: `Scrub ${axis.toUpperCase()}`, unit: '%', value: parallax[axis] * 100, min: 0, max: 400, disabled: layer.locked, data: {'parallax-field': axis}}))},
        ]},
    ],
  };
}

/** Draw's brush: the preview well, recent colours, and the Painting section (Blend, Lock alpha). */
export function brushInspector(drawing) {
  const settings = drawing.settings, recent = drawing.library?.recent ?? [];
  return {
    kind: 'draw-brush',
    sections: [
      {id: 'brush', title: 'Brush', rows: [
        {kind: 'card', media: {tag: 'canvas', key: 'brush-preview', section: 'brush-preview', className: 'drawing-preview', label: 'Brush stroke preview', data: {'brush-preview': true}}},
        recent.length && {kind: 'swatches', label: 'Recent colors', items: recent.map(color => ({
          value: color, label: `Use ${color.toUpperCase()}`, tip: color.toUpperCase(), pressed: color === settings.color.toLowerCase(), data: {'draw-color': color},
        }))},
      ].filter(Boolean)},
      {id: 'painting', title: 'Painting', rows: [{kind: 'grid', rows: [
        {kind: 'select', label: 'Blend', data: {'draw-setting': 'blend', 'draw-text': true}, value: settings.blend,
          options: BRUSH_BLEND_LABELS.map(([value, label]) => ({value, label}))},
        {kind: 'field-switch', id: 'draw-alphaLock', label: 'Lock alpha', checked: Boolean(settings.alphaLock), data: {'draw-setting': 'alphaLock'}},
      ]}]},
    ],
  };
}
