/**
 * A part's rig in Build's Properties, as inspector sections (src/inspector-kit.mjs
 * descriptors), and the change handler for its controls. Every control keeps its
 * id or data-action; rigControlChange() applies a change by id.
 *
 * Rig reads top to bottom, one block per behaviour, and a behaviour's settings
 * show only while it is on:
 *   Link           Connect joints and Weighted joint (a connector: its anchors A and B, each picked on the canvas)
 *   Smart Stretch  its switch; while on: what drives it (a connector), rest length, limits, width, new parts
 *   Response       how this part answers a stretch that reaches it
 *   Angle lock     its choice; while on: the locked angle, when it applies and, for a movable parent, its
 *                  rotation and a second rotation
 * Attachment (the stretch driver and orientation) folds behind its own title. A
 * weighted joint and an angle-driven path show their own controls instead.
 */
import {rigConstraintPlan} from './rig-constraints.mjs';
import {canvasFont} from './ui/font-loading.mjs';

const degrees = radians => Math.round(radians * 180 / Math.PI * 100) / 100;
const num = (id, label, value, {unit = '', min, max, span, tip, description} = {}) => ({kind: 'number', id, label, value, unit, min, max, span, tip, description});
const choice = (id, label, value, options, extra = {}) => ({kind: 'select', id, label, value, span: 2, options: options.map(([key, text]) => ({value: key, label: text})), ...extra});
/** One behaviour's block; the section's CSS separates blocks with a hairline. */
const block = (name, rows, extra = {}) => ({kind: 'group', label: name, role: 'group', data: {'rig-block': name.toLowerCase().replace(/\s+/g, '-')}, rows, ...extra});
/** A block's head: the switch or choice that turns its behaviour on, as one full-width field. */
const head = row => ({kind: 'grid', rows: [{span: 2, ...row}]});
/** What a behaviour's head turns on: its settings, under a guide that ties them to the head. */
const settings = (rows, extra = {}) => ({kind: 'grid', rows, ...extra, data: {'rig-settings': true, ...extra.data}});

/** The Rig section's title: what the part's rig is (a weighted joint and an angle-driven path have their own controls). */
export function rigSectionTitle(segment) {
  const r = segment?._stykRig ?? {};
  return r.weighted ? 'Weighted joint' : r.anglePath ? 'Angle-driven path' : 'Rig';
}

/** A weighted joint's origin, anchor count and anchors (each a joint and its weight), under `prefix`. */
const anchorRows = (w, prefix) => [{kind: 'grid', rows: [
  num(`${prefix}origin`, 'Origin joint', w.origin, {min: 0, max: 65535}),
  num(`${prefix}count`, 'Anchors', w.anchors.length, {min: 1, max: 16, description: 'Number of anchors'}),
  ...w.anchors.flatMap((anchor, i) => [
    num(`${prefix}joint-${i}`, `Anchor ${i + 1}`, anchor.joint, {min: 0, max: 65535}),
    num(`${prefix}weight-${i}`, 'Weight', anchor.weight, {unit: '×', min: -100, max: 100, description: `Anchor ${i + 1} weight`}),
  ]),
]}];

/**
 * The part's rig sections, always three in this order (so the inspector's
 * positions stay put): Rig (titled, open while the part has a rig), Attachment
 * and an angle-driven path's Reference positions; each is hidden where it does
 * not apply, and all three while `hidden` (a connector's Slider part).
 */
export function rigSections(editor, {hidden = false} = {}) {
  const segment = editor.figure?.segments[editor.selectedJoint];
  const r = segment?._stykRig ?? {};
  const none = id => ({id, hidden: true});
  if (hidden || !segment) return [none('rig-controls'), none('rig-attachment'), none('rig-path-keys')];
  const rigged = Boolean(r.connector || r.stretch || r.follow || r.response || r.angleLock || r.weighted || r.anglePath || r.orientation);
  const rig = {id: 'rig-controls', title: rigSectionTitle(segment), place: 'titled', open: rigged};
  if (r.weighted) {
    const w = r.weighted;
    return [{...rig, rows: [
      ...anchorRows(w, 'rig-weighted-'),
      {kind: 'switch', id: 'rig-weighted-depth-enabled', label: 'Include surface depth', checked: Boolean(w.depth)},
      w.depth && block('Depth anchors', anchorRows(w.depth, 'rig-weighted-depth-'), {title: 'Depth anchors'}),
      {kind: 'meta', text: 'Offsets from the origin are multiplied by their weights and added. Pose the anchors to move this joint.'},
    ]}, none('rig-attachment'), none('rig-path-keys')];
  }
  if (r.anglePath) {
    const path = r.anglePath, depth = path.source !== undefined;
    return [{...rig, rows: [{kind: 'grid', rows: depth ? [num('rig-path-source', 'Depth source joint', path.source, {min: 1, max: 65535, span: 2})] : [
      num('rig-path-driver', 'Turn joint', path.driver, {min: 1, max: 65535}),
      num('rig-path-pitch', 'Nod joint', path.pitch ?? 0, {min: 0, max: 65535, tip: '0 turns nodding off', description: 'Nod joint (0 = off)'}),
    ]}]}, none('rig-attachment'), {id: 'rig-path-keys', title: 'Reference positions', place: 'titled', hidden: depth, rows: depth ? [] : path.keys.map((key, i) => {
      const at = `${degrees(key[0])}°`;
      return block(`At ${at}`, [{kind: 'grid', rows: ['X', 'Y', 'Depth'].map((axis, j) =>
        num(`rig-path-key-${i}-${j + 1}`, axis, key[j + 1], {unit: 'px', min: -1e6, max: 1e6, description: `${axis} at ${at}`}))}], {title: `At ${at}`});
    })}];
  }
  const plan = rigConstraintPlan(editor.figure), source = plan.inputs[editor.selectedJoint];
  const c = r.connector, d = r.stretch, f = r.follow, response = r.response ?? {}, lock = r.angleLock;
  const name = id => (id === 0 ? 'Origin' : editor.figure.segments[plan.ids.get(id)]?.name || `Joint ${id}`);
  const pick = (action, label) => ({icon: 'origin', label, action});
  const link = c
    ? block('Anchors', ['start', 'end'].map((key, i) => ({kind: 'list-row', label: `Anchor ${i ? 'B' : 'A'}`, meta: name(c[key]),
      actions: [pick(`rig-pick-${key}`, `Pick anchor ${i ? 'B' : 'A'} on canvas`)]})))
    : {kind: 'actions', label: 'Link', fill: true, items: [
      {action: 'rig-connect', icon: 'link', label: 'Connect', text: true, variant: 'outline', tip: 'Connect joints: link this joint to another with a sliding connector'},
      {action: 'rig-weighted', icon: 'nodes', label: 'Weighted', text: true, variant: 'outline', tip: 'Weighted joint: add a joint that follows a weighted blend of other joints'},
    ]};
  const slide = c && d?.source && d.source !== 'span';
  const stretch = block('Smart Stretch', [
    head({kind: 'field-switch', id: 'rig-stretch-enabled', label: 'Smart Stretch', checked: Boolean(d), tip: 'Hold Ctrl while dragging to stretch. New attached parts follow automatically.'}),
    d && settings([
      c && choice('rig-source', 'Driven by', d.source ?? 'span', [['span', 'Anchor distance'], ['slide', 'Slide position'], ['combined', 'Distance × slide']]),
      num('rig-rest', 'Rest length', d.restLength, {unit: 'px', min: 0.0001, max: 1e6, span: slide ? undefined : 2}),
      slide && num('rig-rest-position', 'Rest slide', d.restPosition * 100, {unit: '%', min: 0.01, max: 100}),
      num('rig-min', 'Minimum', d.min * 100, {unit: '%', min: 0, max: 10000}),
      num('rig-max', 'Maximum', d.max * 100, {unit: '%', min: 1, max: 10000}),
      choice('rig-width', 'Width', d.width, [['keep', 'Keep width'], ['inverse', 'Thicken on compression'], ['scale', 'Scale with length']], {description: 'Width response'}),
      !d.branch && {kind: 'field-switch', id: 'rig-auto-branch', label: 'Include new parts', checked: false, span: 2, tip: 'New parts attached below stretch with this one'},
    ]),
  ]);
  const mode = response.mode ?? f?.mode ?? 'stretch';
  const respond = (source || f || r.response) && block('Stretch response', [
    head(choice('rig-response', 'Stretch response', mode, [['stretch', 'Stretch'], ['rigid', 'Keep rigid · pass through'], ['stop', 'Stop at this joint']],
      {tip: 'How this part answers a stretch that reaches it'})),
    mode !== 'stop' && settings([
      mode === 'stretch' && num('rig-multiplier', 'Multiplier', response.multiplier ?? 1, {unit: '×', min: -10, max: 10, span: 2}),
      {kind: 'field-switch', id: 'rig-reset-impulse', label: 'Reset impulse here', checked: Boolean(response.reset), span: 2,
        tip: 'Restart the stretch axis at this joint and its children.'},
    ]),
  ]);
  const parent = lock?.mode === 'parent', second = parent ? lock.secondary : null;
  const angle = !c && block('Angle lock', [
    head(choice('rig-angle-lock', 'Angle lock', lock?.mode ?? 'off', [['off', 'Off'], ['figure', 'Figure'], ['parent', 'Movable parent'], ['world', 'World']],
      {tip: 'Keep this part at one angle while what it hangs from turns'})),
    lock && settings([
      num('rig-lock-angle', 'Angle', degrees(lock.angle), {unit: '°', min: -36000, max: 36000, span: parent ? undefined : 2, description: 'Locked angle'}),
      parent && num('rig-lock-multiplier', 'Rotation', lock.multiplier, {unit: '×', min: -10, max: 10, description: 'Parent rotation'}),
      choice('rig-lock-space', 'Applies', lock.space ?? 'rendered', [['rendered', 'After stretch'], ['authored', 'Before stretch']], {description: 'Apply angle lock'}),
    ]),
    // A movable parent's lock can add a second joint's rotation: its own settings, named.
    parent && block('Second rotation', [settings([
      num('rig-lock-secondary', 'Joint', second?.reference ?? 0, {min: 0, max: 65535, span: 2, tip: 'Add the rotation of a second joint · 0 turns it off', description: 'Second joint (0 = off)'}),
      second && num('rig-lock-secondary-multiplier', 'Rotation', second.multiplier, {unit: '×', min: -10, max: 10, description: 'Second rotation'}),
      second && num('rig-lock-secondary-rest', 'Rest angle', second.restAngle * 180 / Math.PI, {unit: '°', min: -36000, max: 36000, description: 'Second rest angle'}),
    ])], {title: 'Second rotation'}),
  ]);
  const custom = r.orientation === 'world' || Boolean(f && !f.automatic);
  const attachment = {id: 'rig-attachment', title: 'Attachment', place: 'titled', open: custom, hidden: Boolean(c), rows: c ? [] : [
    {kind: 'list-row', label: 'Stretch driver', meta: source ? name(editor.figure.segments[source.driver].segment_id) : 'Automatic',
      actions: [pick('rig-pick-driver', 'Pick stretch driver on canvas')]},
    {kind: 'grid', rows: [
      choice('rig-orientation', 'Orientation', r.orientation ?? 'inherit', [['inherit', 'Follow connector'], ['world', 'Keep authored angle']], {description: 'Attachment orientation'}),
      f && !f.automatic && response.multiplier === undefined && num('rig-influence', 'Legacy influence', f.influence, {unit: '×', min: -4, max: 4, span: 2}),
    ]},
  ]};
  // Test rig is the band's (beside Done) and the figure's ⋯ menu's, so the section carries no second play button.
  return [{...rig, rows: [link, stretch, respond, angle]}, attachment, none('rig-path-keys')];
}
export function rigControlChange(editor,target) {
  const id=target.id;if(!id.startsWith('rig-')||id==='rig-mode')return false;
  const value=target.valueAsNumber;
  if(id.startsWith('rig-weighted-')){
    const weighted=structuredClone(editor.figure.segments[editor.selectedJoint]._stykRig.weighted);
    if(id==='rig-weighted-depth-enabled'){
      if(target.checked)weighted.depth={origin:weighted.origin,anchors:weighted.anchors.map(a=>({...a,weight:0}))};else weighted.depth=undefined;
    }else{
      const depth=id.startsWith('rig-weighted-depth-'),w=depth?weighted.depth:weighted,prefix=depth?'rig-weighted-depth-':'rig-weighted-',key=id.slice(prefix.length),match=/^(joint|weight)-(\d+)$/.exec(key);
      if(match)w.anchors[Number(match[2])][match[1]]=value;
      else if(key==='origin')w.origin=value;
      else if(key==='count'){
        if(!Number.isInteger(value)||value<1||value>16)throw new Error('Choose 1-16 anchors.');
        const used=new Set([w.origin,editor.figure.segments[editor.selectedJoint].segment_id,...w.anchors.map(a=>a.joint)]);
        const available=[0,...editor.figure.segments.map(s=>s.segment_id)].filter(id=>!used.has(id));
        while(w.anchors.length<value){const joint=available.shift();if(joint===undefined)throw new Error('Add another anchor joint first.');w.anchors.push({joint,weight:0});}
        w.anchors.length=value;
      }else return false;
    }
    editor.setRigBehavior({weighted});
  }
  else if(id.startsWith('rig-path-')){
    const path=structuredClone(editor.figure.segments[editor.selectedJoint]._stykRig.anglePath),match=/^rig-path-key-(\d+)-([123])$/.exec(id);
    if(match)path.keys[Number(match[1])][Number(match[2])]=value;
    else if(id==='rig-path-pitch')path.pitch=value||undefined;
    else if(id==='rig-path-driver')path.driver=value;
    else if(id==='rig-path-source')path.source=value;
    else return false;
    editor.setRigBehavior({anglePath:path});
  }
  else if(id==='rig-position')editor.setConnectorPosition(value/100);
  else if(id==='rig-stretch-enabled')editor.enableSmartStretch(target.checked);
  else if(id==='rig-rest')editor.setRigBehavior({stretch:{restLength:value}});
  else if(id==='rig-min')editor.setRigBehavior({stretch:{min:value/100}});
  else if(id==='rig-max')editor.setRigBehavior({stretch:{max:value/100}});
  else if(id==='rig-width')editor.setRigBehavior({stretch:{width:target.value}});
  else if(id==='rig-auto-branch')editor.enableSmartStretch(true);
  else if(id==='rig-source'){
    const seg=editor.figure.segments[editor.selectedJoint],position=editor.object.len_flag?editor.object.lengths[editor.selectedJoint]:seg.length;
    editor.setRigBehavior({stretch:{source:target.value,restPosition:seg._stykRig.stretch.restPosition??Math.max(.0001,position)}});
  }
  else if(id==='rig-rest-position')editor.setRigBehavior({stretch:{restPosition:value/100}});
  else if(id==='rig-response')editor.setRigBehavior({response:{mode:target.value}});
  else if(id==='rig-multiplier')editor.setRigBehavior({response:{multiplier:value}});
  else if(id==='rig-reset-impulse')editor.setRigBehavior({response:{reset:target.checked}});
  else if(id==='rig-angle-lock')editor.setAngleLock(target.value);
  else if(id==='rig-lock-angle')editor.setRigBehavior({angleLock:{angle:value*Math.PI/180}});
  else if(id==='rig-lock-multiplier')editor.setRigBehavior({angleLock:{multiplier:value}});
  else if(id==='rig-lock-space')editor.setRigBehavior({angleLock:{space:target.value}});
  else if(id==='rig-lock-secondary')editor.setSecondaryAngleReference(value);
  else if(id==='rig-lock-secondary-multiplier')editor.setRigBehavior({angleLock:{secondary:{...editor.figure.segments[editor.selectedJoint]._stykRig.angleLock.secondary,multiplier:value}}});
  else if(id==='rig-lock-secondary-rest')editor.setRigBehavior({angleLock:{secondary:{...editor.figure.segments[editor.selectedJoint]._stykRig.angleLock.secondary,restAngle:value*Math.PI/180}}});
  else if(id==='rig-orientation')editor.setRigBehavior({orientation:target.value});
  else if(id==='rig-follow-driver')editor.bindStretchParts(value);
  else if(id==='rig-follow-mode')editor.setRigBehavior({follow:{mode:target.value}});
  else if(id==='rig-follow-rigid')editor.setRigBehavior({response:{mode:target.checked?'rigid':'stretch'}});
  else if(id==='rig-influence')editor.setRigBehavior({follow:{influence:value}});
  else if(id.startsWith('rig-anchor-'))editor.setRigBehavior({connector:{[id.slice(11)]:value}});
  else return false;
  return true;
}
/** Only the selected slider gets endpoint guides; never document artwork. */
export function drawConnectorGuides(ctx,geometry,editor,project) {
  const s=geometry.objects.get(editor.selectedSlot)?.segments[editor.selectedJoint];
  if(!s?.connector)return;
  const h=project(s.handle),a=project(s.start),b=project(s.end);
  ctx.save();ctx.lineWidth=1;ctx.strokeStyle='#808080';ctx.setLineDash([2,4]);
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(h.x,h.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
  ctx.font=canvasFont('10px');ctx.fillStyle='#808080';
  ctx.fillText('A',a.x+9,a.y-9);ctx.fillText('B',b.x+9,b.y-9);ctx.restore();
}
export function drawRigGuides(ctx,geometry,editor,project) {
  const g=geometry.objects.get(editor.selectedSlot),s=g?.segments[editor.selectedJoint];if(!s)return;
  const rig=s.seg._stykRig;if(!rig)return;
  ctx.save();ctx.strokeStyle='#0d99ff';ctx.fillStyle='#0d99ff';ctx.lineWidth=1.5;
  const ring=p=>{const q=project(p);ctx.beginPath();ctx.arc(q.x,q.y,9,0,Math.PI*2);ctx.stroke();};
  if(rig.follow){const p=g.joints.get(rig.follow.driver);if(p)ring(p);}
  if(rig.stretch){const plan=rigConstraintPlan(editor.figure);for(const part of g.segments)if(plan.inputs[part.index]?.driver===s.index){ctx.globalAlpha=.5;ctx.lineWidth=3;ctx.beginPath();part.points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();}}
  ctx.restore();
}
