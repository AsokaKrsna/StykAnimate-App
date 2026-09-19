import {joinedDrawingSetsView} from './movieclip-drawings.mjs';
import {spatialControlsView} from './spatial-controls.mjs';
import {drawingInspector} from './drawing-view.mjs';
import {rigControlsView, connectorPositionView} from './rig-controls.mjs';
import {figureJoinAction} from './figure-join-action.mjs';
import {polygonSurfaceView} from './builder-surface-ui.mjs';
import {rigIKAllowed} from './rig-constraints.mjs';
import {cameraMotionView,parallaxView} from './camera-motion-ui.mjs';
import {paintCSS} from './paint.mjs';
import {figurePalette, displayedSegmentPaint, displayedColor} from './figure-colors.mjs';
import { icon } from "./icons.mjs";
import { isStatic } from "./pivot/geometry.mjs";
import { formatPropertyValue } from "./property-controls.mjs";
import { cameraActionsView } from "./camera-view.mjs";
import { cameraValues } from "./editor-camera.mjs";
import { builderDrawables } from './editor-builder-style.mjs';
import { isBuilderContext } from './builder-aids.mjs';
import {resolveInstanceFigure} from './animation-style.mjs';
import {ikControlsView} from './ik-view.mjs';
import {propertyToggle} from './property-toggle.mjs';
import {isMovieclip} from './movieclips.mjs';
import {movieclipInspector} from './movieclip-ui.mjs';
import {sheetKeyAt} from './layer-sheet.mjs';
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const hex = (rgb) =>
  "#" +
  (rgb || [43, 43, 43])
    .map((n) => Math.round(n).toString(16).padStart(2, "0"))
    .join("");
const num = (n) => Number(Number(n ?? 0).toFixed(2));
const animatedProperties = new Set([
  "scale",
  "figure_opacity",
  "figure_z_order",
  "thickness",
  "segment_opacity",
  "segment_gradient_opacity",
  "camera_x",
  "camera_y",
  "camera_scale",
  "camera_angle",
]);
const integerProperties = new Set([
  "fps",
  "canvas_width",
  "canvas_height",
  "duration",
]);
function numericField(
  label,
  key,
  value,
  unit = "",
  limits = "",
  state = {},
  options = {},
) {
  const animated = options.animated ?? animatedProperties.has(key),
    precision = integerProperties.has(key) || key.endsWith('_z_order') ? 0 : 3;
  value = state?.value ?? value;
  const description =
    options.description || `${label}${unit ? ` (${unit})` : ""}`;
  return `<div class="property-row${animated ? " is-animatable" : options.wide ? " is-wide" : ""}" data-property-row="${key}"><label class="field"><span class="property-scrub" data-property-scrub tabindex="0" role="button" aria-label="Scrub ${esc(description)}" title="Drag to adjust · Shift: fine · Alt: extra fine">${label}</span><input type="number" ${options.id ? `id="${options.id}"` : ""} ${options.legacyField === false ? "" : `data-field="${key}"`} data-property="${key}" data-property-value="${esc(value)}" data-property-precision="${precision}" data-property-step="1" value="${formatPropertyValue(value, precision)}" step="any" aria-label="${esc(description)}" ${limits}><small>${unit}</small></label></div>`;
}
const heading = (title, symbol) =>
  `<div class="property-context-heading"><span>${icon(symbol)}</span><div><strong>${esc(title)}</strong></div></div>`;
const button = (action, symbol, title, disabled = false) =>
  `<button class="icon-button" data-action="${action}" title="${title}" aria-label="${title}" ${disabled ? "disabled" : ""}>${icon(symbol)}</button>`;
const secondarySections = new Set(["Connections", "Polygons", "Canvas alignment", "Neighboring pose", "Color palette"]);
const group = (title, body, extra = "") => secondarySections.has(title)
  ? `<details class="inspector-section inspector-disclosure" data-section="${esc(title)}"><summary class="inspector-title"><span>${title}</span>${extra}</summary><div class="inspector-disclosure-body">${body}</div></details>`
  : `<section class="inspector-section"><div class="inspector-title"><span>${title}</span>${extra}</div>${body}</section>`;
const grid = (body) => `<div class="field-grid">${body}</div>`;
const scrubHint = `<p class="property-context-caption">Drag a label to scrub its value · Shift or Alt for finer steps</p>`;
const tools = (body) => `<div class="transform-actions">${body}</div>`;
const builderOrderButtons = (kind, index) => tools(
  [['back','send-to-back','Send to back'],['down','chevron-left','Send backward'],['up','chevron-right','Bring forward'],['front','bring-to-front','Bring to front']]
    .map(([direction,symbol,label]) => `<button type="button" class="icon-button" data-action="builder-order" data-kind="${kind}" data-index="${index}" data-direction="${direction}" title="${label} · ${kind}" aria-label="${label} · ${kind}">${icon(symbol)}</button>`).join(''),
);
const colorRow = (id, label, value, opacityId, opacity, caption = value.slice(1).toUpperCase()) =>
  `<div class="color-row"><input id="${id}" type="color" value="${value}" aria-label="${label}"><span class="hex-label">${esc(caption)}</span>${opacityId ? `<input id="${opacityId}" type="number" value="${num(opacity)}" min="0" max="100" aria-label="${label} opacity"><small>%</small>` : ""}</div>`;

function figureLayerField(editor){
  if(!editor.selectedUids.size)return '';
  const ids=new Set([...editor.selectedUids].map(uid=>editor.layerForUid(uid))),current=ids.size===1?[...ids][0]:'';
  return `<div class="figure-layer-field"><label for="figure-layer">${icon('layers')}Layer</label><select id="figure-layer" class="inline-select" aria-label="Figure layer">${!current?'<option value="" disabled selected>Mixed</option>':''}${editor.layers.filter(layer=>layer.kind==='layer').reverse().map(layer=>`<option value="${esc(layer.id)}" ${layer.id===current?'selected':''} ${layer.locked?'disabled':''}>${esc(layer.name)}</option>`).join('')}</select></div>`;
}

export function inspectorView({
  editor,
  tab = "design",
  tool = "select",
  rigMode = "move",
  selectionCount = 1,
  bounds,
  rangeIndices = [],
  applyRange = false,
  polygonPage = 0,
  palettePage = 0,
  context = "auto",
  propertyState,
  builderBranch = false,
  builder = false,
  drawing,
  hotkeyLabel,
}) {
  if(drawing?.active){
    const o=editor.object,f=editor.figure,p=(label,key,value,unit='',limits='')=>numericField(label,key,value,unit,limits,propertyState?.(key));
    const poseView=drawing.tool==='transform'&&o?group('Transform drawing',grid(p('X','root_x',o.root_x,'px')+p('Y','root_y',o.root_y,'px')+p('Scale','scale',o.scale*100,'%','min="0.01"')+p('Angle','rotation',((o.angles[0]??0)-(f.segments[0]?.angle_rad??0))*180/Math.PI,'°')+p('Opacity','figure_opacity',(1-(o.field28??0)/255)*100,'%','min="0" max="100"'))):'';
    return drawingInspector(drawing,{numericField,group,grid,heading,hotkeyLabel,esc,propertyToggle},poseView);
  }
  const report = editor.report,
    frame = editor.frame,
    object = editor.object;
  const field = (label, key, value, unit = "", limits = "", options = {}) =>
    numericField(
      label,
      key,
      value,
      unit,
      limits,
      propertyState?.(key),
      options,
    );
  const resolvedContext =
    context === "auto"
      ? tab === "animation"
        ? "frame"
        : object
          ? "figure"
          : "scene"
      : context;
  if (resolvedContext === "camera") return cameraView(editor, field);
  if (resolvedContext === "layer") return layerView(editor);
  if (resolvedContext === "frame") return frameView(editor, field);
  if (resolvedContext === "scene" || !object)
    return sceneView(editor, field, propertyState);
  if (selectionCount===1 && isMovieclip(editor.figure)) return figureLayerField(editor)+movieclipInspector(editor,field);
  const range =
    rangeIndices.length > 1
      ? group(
          "Frame range",
          `<label class="check-row"><input id="apply-range-movement" type="checkbox" ${applyRange ? "checked" : ""}>Apply to ${rangeIndices.length} selected frames</label>`,
        )
      : "";
  if (selectionCount > 1) {
    const b = bounds;
    return (
      heading(`${selectionCount} figures`, "layers") + figureLayerField(editor) +
      group(
        "Selection",
        tools(
          button("duplicate", "duplicate", "Duplicate selection") +
            button("delete", "trash", "Delete selection"),
        ),
      ) +
      range +
      group(
        "Transform",
        grid(
          field("X", "group_x", b.minX, "px") +
            field("Y", "group_y", b.minY, "px") +
            field("W", "group_width", b.maxX - b.minX, "px", 'min="0.01"') +
            field("H", "group_height", b.maxY - b.minY, "px", 'min="0.01"'),
        ) + scrubHint +
          tools(
            button("mirror", "flip", "Flip horizontally") +
              button("rotate", "rotate", "Rotate 15°") +
              button("center", "center", "Center selection"),
          ),
      ) +
      group(
        "Align",
        tools(
          [
            ["left", "align-left"],
            ["center-x", "align-horizontal-center"],
            ["right", "align-right"],
            ["top", "align-top"],
            ["center-y", "align-vertical-center"],
            ["bottom", "align-bottom"],
          ]
            .map(([a, i]) =>
              button(`align-${a}`, i, `Align ${a.replace("-", " ")}`),
            )
            .join(""),
        ),
      ) +
      group(
        "Appearance",
        colorRow("figure-color", "Figure color", "#2b2b2b") +
          `<div class="field-grid property-opacity-grid">${field("Opacity", "figure_opacity", (1 - (object.field28 || 0) / 255) * 100, "%", 'min="0" max="100"', { id: "figure-opacity", legacyField: false, animated: false, wide: true })}</div>` +
          tools(
            button("reset-color", "undo", "Reset colors") +
              button("layer-down", "send-to-back", "Send backward") +
              button("layer-up", "bring-to-front", "Bring forward"),
          ),
      ) +
      group(
        "Connections",
        `<button class="button" data-action="combine-figures">${icon("combine")}Combine connected</button>`,
      )
    );
  }
  const figure = resolveInstanceFigure(editor.figure, object),
    joint = editor.selectedJoint,
    segment = figure.segments[joint];
  if(!builder&&figure.segments.some(s=>s._stykRig?.spatial?.origin)){
    return spatialControlsView(editor)+joinedDrawingSetsView(editor)+(joint<0?group('Placement',grid(field('X','root_x',object.root_x,'px')+field('Y','root_y',object.root_y,'px')+field('Scale','scale',object.scale*100,'%','min="0.01"'))):'');
  }
  if (builder && editor.selectedPolygonIndex >= 0) {
    const index=editor.selectedPolygonIndex, polygon=figure.polyfills[index];
    return group('Fill', `<div class="polygon-row"><input type="color" data-polygon-color="${index}" aria-label="Fill color" value="${hex(displayedColor(report,figure,object,polygon.color_rgb))}"><button class="icon-button" data-delete-polygon="${index}" aria-label="Delete fill">${icon('trash')}</button></div>` +
      field('Opacity',`polygon_${index}_opacity`,(polygon.alpha_raw!==undefined?1-polygon.alpha_raw/255:polygon.color_alpha??1)*100,'%', 'min="0" max="100"',{animated:Boolean(editor.propertyChannels)}) + polygonSurfaceView(editor,index) + builderOrderButtons('polygon',index));
  }
  const drawOrder = new Map(builderDrawables(figure).map((item,index)=>[`${item.kind}:${item.index}`,index+1]));
  const orderLimits = `min="1" max="${drawOrder.size}"`;
  const palette = joint < 0 ? editor.figurePalette() : [];
  const ownPalette = joint < 0 ? figurePalette(report,figure,object) : [];
  const fill = ownPalette[0]?.color ?? '#000000';
  const kind = figure.segments.every((s) => s.primitive_code === 5)
    ? "text"
    : figure.segments.every((s) => s.primitive_code === 2)
      ? "image"
      : "figure";
  const title = group(
    "",
    `<div class="object-heading"><span>${icon(kind === "text" ? "text" : kind === "image" ? "image" : "person")}</span><input id="figure-name" class="figure-name" value="${esc(figure.name || "Figure")}" aria-label="Figure name" title="Rename figure definition"></div>`,
  );
  // Pivot origins use -1; segment endpoint indices start at zero.
  const jointScope = joint >= 0 && Boolean(segment);
  let html = (jointScope ? "" : title) + figureLayerField(editor) + range + (!builder ? spatialControlsView(editor)+joinedDrawingSetsView(editor) : "");
  if (!jointScope) {
    if (object.join || frame.objects.some(part => part.join?.target_object_slot === object.object_slot)) {
      html += group('Connected figure',
        `<button type="button" class="button" data-action="combine-figures">${icon('combine')}Merge into one figure</button>`);
    }
    if (tool === "rig")
      html += group(
        "Edit rig",
        `<select id="rig-mode" class="inline-select" aria-label="Rig edit mode"><option value="move" ${rigMode === "move" ? "selected" : ""}>Move joint</option><option value="rotate" ${rigMode === "rotate" ? "selected" : ""}>Rotate branch</option></select><button type="button" class="button" data-action="add-sprite-segment">${icon('image')}Add sprite partâ€¦</button>`,
      );
    if (figure.text_assets?.some((asset) => asset.glyphs?.length))
      html += group(
        "Text",
        `<button class="button" data-action="edit-text">${icon("text")}Edit text</button>`,
      );
    html += group(
      "Transform",
      grid(
        field("X", "root_x", object.root_x, "px") +
          field("Y", "root_y", object.root_y, "px") +
          field("Scale", "scale", object.scale * 100, "%", 'min="0.01"') +
          field(
            "Angle",
            "rotation",
            (((object.angles[0] ?? 0) - (figure.segments[0]?.angle_rad ?? 0)) *
              180) /
              Math.PI,
            "°",
          ),
      ) + scrubHint,
    );
    html += group(
      "Appearance",
      `<div class="property-paint-row">${colorRow("figure-color", "Recolor all segments", fill,undefined,undefined,ownPalette.length>1?'Mixed':undefined)}${field("Opacity", "figure_opacity", (1 - (object.field28 || 0) / 255) * 100, "%", 'min="0" max="100"', { id: "figure-opacity", legacyField: false })}</div>`,
      button("reset-color", "undo", "Reset colors"),
    );
    html += group(
      "Stacking",
      grid(field('Z-index', 'figure_z_order', object._stykZIndex ?? 0, '', 'min="-1000000" max="1000000"')) +
      tools(button('layer-back', 'send-to-back', 'Send to back') + button('layer-down', 'chevron-left', 'Send backward') + button('layer-up', 'chevron-right', 'Bring forward') + button('layer-front', 'bring-to-front', 'Bring to front')),
    );
  }
  if (jointScope && segment) {
    const displayPaint=displayedSegmentPaint(report,figure,object,segment);
    const connector=segment._stykRig?.connector;
    const staticControl = propertyToggle('static-joint', 'Static', isStatic(segment), 'diamond');
    if(connector&&editor.selectedSegmentIds.size<=1){
      const scope=editor._connectorInspector,part=scope?.uid===editor.selectedUid&&scope?.id===segment.segment_id?scope.part:'slider';
      html+=heading(`Connector ${segment.segment_id}`,'link')+`<div class="connector-property-tabs" role="group" aria-label="Connector properties">${[['segment','Segment'],['slider','Slider']].map(([value,label])=>`<button type="button" data-connector-part="${value}" aria-pressed="${part===value}">${label}</button>`).join('')}</div>`;
      if(part==='slider')return html+group('Slider',connectorPositionView(editor)+`<div class="joint-settings">${staticControl}</div>`);
    }
    if(!connector||editor.selectedSegmentIds.size>1)html += heading(editor.selectedSegmentIds.size > 1 ? `${editor.selectedSegmentIds.size} segments` : `${editor.branchSelected ? 'Branch from joint' : 'Joint'} ${segment.segment_id}`, "nodes");
    if(builder)html+=group('',`<label class="rig-select"><span>Joint name</span><input id="builder-joint-name" class="inline-select" aria-label="Joint name" maxlength="120" value="${esc(segment.name??'')}"></label>`);
    const ik = editor.getIKSettings();
    const selectedSegmentIds = editor.selectedSegmentIds;
    const supportsSecondaryColor = [1, 3, 4].includes(segment.primitive_code) &&
      (selectedSegmentIds.size <= 1 || figure.segments.every(part =>
        !selectedSegmentIds.has(part.segment_id) || [1, 3, 4].includes(part.primitive_code)));
    const hasSecondaryColor = supportsSecondaryColor && Boolean(segment.secondary);
    const shape = [
      "line",
      "circle",
      "image",
      "circleFill",
      "circleClear",
      "text",
      "squareLine",
    ][segment.primitive_code ?? 0];
    html += group(
      "Transform",
      grid(
        (connector?'':field(
          "Angle",
          "joint_angle",
          ((segment._stykRig?.angleLock ? editor.geometry.objects.get(editor.selectedSlot)?.segments[joint]?.angle : object.angles[joint] ?? segment.angle_rad) * 180) / Math.PI,
          "°",
          segment._stykRig?.angleLock ? 'disabled' : '',
        )) +
          (connector ? '' : field(
            "Length",
            "joint_length",
            object.len_flag ? object.lengths[joint] : segment.length,
            "px",
            'min="0"',
          )) +
          field(
            "Bend",
            "joint_bend",
            ((object.bend_flag ? object.bends[joint] : segment.bend_rad || 0) *
              180) /
              Math.PI,
            "°",
        ),
      ) + (connector ? '' : `<div class="joint-settings">${staticControl}</div>`),
    );
    if (rigIKAllowed(figure,joint)) html += ikControlsView(ik);
    html += rigControlsView(editor,{builder});
    html += group("Appearance",
        grid(field("Width", "thickness", segment.thickness, "px", 'min="0"') +
        field('Order', 'segment_z_order', drawOrder.get(`segment:${joint}`), '', orderLimits, {animated:false})) +
        ((isBuilderContext(tool) || builder) && editor.selectedSegmentIds.size <= 1 ? `<label class="check-row"><input type="checkbox" id="builder-branch" ${builderBranch ? 'checked' : ''}>Apply to branch</label>` : '') +
        `<select id="segment-shape" class="inline-select" aria-label="Segment shape" ${["image", "text"].includes(shape) ? "disabled" : ""}>${[["line", "Round line"], ["squareLine", "Square line"], ["circle", "White circle"], ["circleFill", "Filled circle"], ["circleClear", "Clear circle"], ...(["image", "text"].includes(shape) ? [[shape, shape]] : [])].map(([v, n]) => `<option value="${v}" ${shape === v ? "selected" : ""}>${n}</option>`).join("")}</select>` +
        `<div class="property-paint-row"><button type="button" id="segment-color" data-paint-picker class="paint-trigger" aria-label="Segment color"><i style="background:${paintCSS(displayPaint)}"></i><span>${displayPaint.type === 'solid' ? hex(displayPaint.stops[0].color).toUpperCase() : displayPaint.type[0].toUpperCase()+displayPaint.type.slice(1)+' gradient'}</span></button>` +
        `${field(hasSecondaryColor ? "Primary opacity" : "Opacity", "segment_opacity", (1 - (segment.transparency || 0) / 255) * 100, "%", 'min="0" max="100"', { id: "segment-opacity", legacyField: false, description: "Primary color opacity" })}</div>` +
        (supportsSecondaryColor ? `<div class="secondary-color-settings">${propertyToggle('segment-gradient-enabled', 'Secondary color', hasSecondaryColor, 'circle', {controls:'segment-secondary-controls'})}<div id="segment-secondary-controls" ${hasSecondaryColor ? '' : 'hidden'}>${hasSecondaryColor ?
          `<div class="property-paint-row">${colorRow('segment-gradient-color', 'Secondary color', hex(displayedColor(report,figure,object,segment.secondary.rgb)))}${field("Secondary opacity", "segment_gradient_opacity", (1-(segment.secondary.a??0)/255)*100, "%", 'min="0" max="100"', {description:"Secondary color opacity"})}</div>` : ''}</div></div>` : ''),
    );
  }
  if (jointScope) return html;
  const parent = object.join
      ? frame.objects[object.join.target_object_slot]
      : null,
    parentName =
      parent &&
      (parent.name ||
        report.figure_types.find(
          (f) => f.figure_type_id === parent.figure_type_id,
        )?.name ||
        "Figure");
  html += group(
    "Connection",
    `<div class="connection-row"><span>${parent ? esc(parentName) + " · " + object.join.target_handle_id : "None"}</span>${button("join-figure", parent ? "detach" : "link", parent ? "Unjoin figure" : "Join figure", !figureJoinAction(editor))}${button("combine-figures", "combine", "Combine connected figures", !parent && !frame.objects.some((o) => o.join?.target_object_slot === object.object_slot))}</div>`,
  );
  const polygons = figure.polyfills || [],
    start = Math.min(
      Math.max(0, polygonPage) * 12,
      Math.max(0, Math.floor((polygons.length - 1) / 12) * 12),
    );
  if (polygons.length)
    html += group(
      "Polygons",
      polygons
        .slice(start, start + 12)
        .map(
          (p, i) =>
            `<div class="polygon-item"><div class="polygon-row"><span>Polygon ${start + i + 1}</span><input type="color" data-polygon-color="${start + i}" aria-label="Polygon ${start + i + 1} color" value="${hex(displayedColor(report,figure,object,p.color_rgb))}"><button class="icon-button" data-delete-polygon="${start + i}" aria-label="Delete polygon ${start + i + 1}">${icon("trash")}</button></div><details class="polygon-style-details" data-polygon-index="${start+i}"><summary>Opacity &amp; draw order</summary>${field('Opacity', `polygon_${start+i}_opacity`, (p.alpha_raw !== undefined ? 1-p.alpha_raw/255 : p.color_alpha ?? 1)*100, '%', 'min="0" max="100"', {animated:Boolean(editor.propertyChannels)})}${field('Order', `polygon_${start+i}_z_order`, drawOrder.get(`polygon:${start+i}`), '', orderLimits, {animated:false})}${builderOrderButtons('polygon',start+i)}</details></div>`,
        )
        .join("") +
        (polygons.length > 12
          ? `<div class="polygon-pagination">${button("polygons-previous", "chevron-left", "Previous polygons", start === 0)}<span>${start + 1}â€“${Math.min(start + 12, polygons.length)} / ${polygons.length}</span>${button("polygons-next", "chevron-right", "Next polygons", start + 12 >= polygons.length)}</div>`
          : ""),
      `<span>${polygons.length}</span>`,
    );
  const paletteStart=Math.min(Math.max(0,palettePage)*32,Math.max(0,Math.ceil(palette.length/32)-1)*32);
  html += group('Color palette',
      `<div class="figure-palette" aria-label="Figure color palette">`+
      palette.slice(paletteStart,paletteStart+32).map(entry=>`<button type="button" data-paint-picker data-palette-color="${entry.color}" class="figure-palette-row" aria-label="Replace ${entry.color.toUpperCase()}, ${entry.segments.length} segments${entry.polygons.length?`, ${entry.polygons.length} fills`:''}"><i style="background:${entry.color}"></i><span>${entry.color.toUpperCase()}</span></button>`).join('')+'</div>'+
      (palette.length>32?`<div class="polygon-pagination">${button('palette-previous','chevron-left','Previous colors',paletteStart===0)}<span>${paletteStart+1}–${Math.min(paletteStart+32,palette.length)} / ${palette.length}</span>${button('palette-next','chevron-right','Next colors',paletteStart+32>=palette.length)}</div>`:''),`<span>${palette.length} ${palette.length===1?'color':'colors'}</span>`);
  return html;
}

function sceneView(editor, field, propertyState) {
  const r = editor.report,
    f = editor.frame,
    colorState = propertyState?.("scene_color"),
    backgroundState = propertyState?.("scene_background"),
    bg = r.backgrounds?.find(
      (b) => b.background_id === (backgroundState?.value ?? f.background_id),
    );
  const rawColor = colorState?.value ?? bg?.color ?? 0xffffffff;
  const color =
    typeof rawColor === "string" && /^#[0-9a-f]{6}$/i.test(rawColor)
      ? rawColor
      : "#" + (rawColor & 0xffffff).toString(16).padStart(6, "0");
  return (
    heading(
      "Scene",
      "scene",
    ) +
    group(
      "Canvas",
      grid(
        field(
          "W",
          "canvas_width",
          r.canvas_width,
          "px",
          'min="1" max="16384"',
        ) +
          field(
            "H",
            "canvas_height",
            r.canvas_height,
            "px",
            'min="1" max="16384"',
          ),
      ),
    ) +
    group(
      "Background",
      `<div class="property-row property-color-line">${colorRow("background-color", "Background color", color)}</div>` +
        `<div class="property-row property-background-line"><span class="property-background-name" title="${esc(bg?.name || "White")}">${esc(bg?.name || "White")}</span></div>` +
        tools(
          button("background-style", "sliders", "Background settings") +
            button("import-background", "image", "Import background"),
        ),
    ) +
    group(
      "Playback",
      grid(field("Rate", "fps", r.fps, "fps", 'min="1" max="120"')),
    )
  );
}

function cameraView(editor, field) {
  const c = cameraValues((editor.evaluatedFrame || editor.frame).camera);
  const motion=editor._cameraInspectorTab==='motion';
  return (
    '<div class="camera-inspector">' +
    `<div class="camera-heading"><span>${icon('camera')}</span><div><strong>Camera</strong></div><span class="camera-live">Live</span></div>` +
    `<div class="camera-monitor"><canvas data-camera-monitor aria-label="Live camera output"></canvas><div class="camera-monitor-caption"><span>${editor.report.canvas_width} Ã— ${editor.report.canvas_height}</span><span data-camera-magnification>${num(100/c.scale)}% zoom</span></div></div>` +
    `<div class="camera-inspector-tabs" role="tablist" aria-label="Camera controls"><button role="tab" data-camera-tab="transform" aria-selected="${!motion}">Transform</button><button role="tab" data-camera-tab="motion" aria-selected="${motion}">Motion</button></div><div ${motion?'hidden':''}>` +
    `<div class="camera-quick-actions"><button data-action="camera-guides" aria-pressed="true" title="Show composition guides">${icon('grid')}<span>Guides</span></button><button data-action="camera-level" title="Set camera rotation to zero">${icon('rotate')}<span>Level</span></button><button data-action="camera-reset" title="Reset camera pose">${icon('undo')}<span>Reset</span></button></div>` +
    group(
      "Transform",
      grid(
        field("X", "camera_x", c.x || 0, "px") +
          field("Y", "camera_y", c.y || 0, "px") +
          field(
            "Scale",
            "camera_scale",
            (c.scale || 1) * 100,
            "%",
            'min="0.01"',
          ) +
          field(
            "Rotation",
            "camera_angle",
            ((c.angle_rad || 0) * 180) / Math.PI,
            "°",
          ),
      ),
    ) +
    cameraActionsView({ editor, button, group, tools }) + `</div><div ${motion?'':'hidden'}>` + cameraMotionView(editor) + '</div></div>'
  );
}

function frameView(editor, field) {
  if(editor.report._styk?.layerSheet){const track=editor.report._styk.layerSheet.tracks[editor.activeLayerId],{key,next}=sheetKeyAt(track,editor.tick);
    return heading(`Frame ${editor.tick+1}`,'diamond')+group(editor.getLayer(editor.activeLayerId)?.name??'Layer',
      grid(field('Exposure','duration',(next?.tick??track?.end??editor.tick+1)-(key?.tick??editor.tick),'frames','min="1" max="65535"')))+group('Frames',tools(button('add-frame','diamond','Insert keyframe (F6)')));}
  const frame = editor.frame,
    index = editor.frameIndex ?? 0;
  return (
    heading(
      `Keyframe ${index + 1}`,
      "diamond",
    ) +
    group(
      "Timing",
      grid(
        field(
          "Duration",
          "duration",
          frame.duration_raw ?? 1,
          "ticks",
          'min="0" max="65535"',
        ),
      ),
    )
  );
}

function layerView(editor) {
  const layer = editor.getLayer?.(editor.activeLayerId) ?? {
    id: "layer-1",
    name: "Layer",
    visible: true,
    locked: false,
    figureUids: [],
  };
  return (
    heading(
      layer.name,
      "layers",
    ) +
    group(
      "Layer",
      `<label class="field-label" for="inspector-layer-name">Name</label><input id="inspector-layer-name" class="property-layer-name" data-layer-id="${esc(layer.id)}" value="${esc(layer.name)}" aria-label="Layer name" maxlength="160"><label class="check-row"><input id="inspector-layer-visible" data-layer-id="${esc(layer.id)}" type="checkbox" ${layer.visible ? "checked" : ""}>Visible</label><label class="check-row"><input id="inspector-layer-locked" data-layer-id="${esc(layer.id)}" type="checkbox" ${layer.locked ? "checked" : ""}>Locked</label>`,
    ) + parallaxView(editor,layer.id)
  );
}
