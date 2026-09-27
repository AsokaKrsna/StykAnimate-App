/**
 * Today's inspector markup. Two things live here until their contexts move
 * to the .ui-* sections (architecture.md §3.13):
 *
 * - The legacy skin (LEGACY_SKIN): renderers that turn inspector descriptors
 *   into the markup the inspector has always had (.inspector-section,
 *   .property-row, .field-grid…), so inspector-view.mjs describes every
 *   context as sections while the inspector looks and behaves exactly as
 *   before. Pass it as env.skin to renderInspector() (src/inspector-kit.mjs).
 *   Descriptors keep the kit's row kinds and fields; what only today's markup
 *   needs sits under a row's or section's `legacy` key (a class, a wrapper,
 *   a variant), plus one row kind of its own, `heading` (today's context
 *   heading; the name moves to inspector-header.mjs). The skin goes when the
 *   contexts render with the kit's own renderers (M4, "Keep less used
 *   settings in titled sections that remember being open").
 * - The primitives the sub-modules that still build HTML are handed
 *   (numericField, group, grid, heading, button, tools for drawing-view.mjs
 *   and camera-view.mjs), until those modules move to descriptors (M7b, M7e).
 *
 * Hidden rows and sections render nothing here, as today; regions (grid,
 * group) render with their hidden attribute, so an aria-controls keeps its
 * target (#node-ik-options, #segment-secondary-controls).
 */
import {icon} from './icons.mjs';
import {formatPropertyValue} from './property-controls.mjs';
import {propertyToggle} from './property-toggle.mjs';
import {attributes, escapeHTML as esc, renderRow} from './inspector-kit.mjs';

export {esc};

const animatedProperties = new Set([
  'scale', 'figure_opacity', 'figure_z_order', 'thickness', 'segment_opacity', 'segment_gradient_opacity',
  'camera_x', 'camera_y', 'camera_scale', 'camera_angle',
]);
const integerProperties = new Set(['fps', 'canvas_width', 'canvas_height', 'duration']);
/** The decimals a property edits with: none for counts, sizes, rates and draw orders, three otherwise. */
export const propertyPrecision = key => (integerProperties.has(key) || key.endsWith('_z_order') ? 0 : 3);

/** A PropertyControls number row in today's markup (the full-width row for animatable properties). */
export function numericField(label, key, value, unit = '', limits = '', state = {}, options = {}) {
  const animated = options.animated ?? animatedProperties.has(key),
    precision = propertyPrecision(key),
    // At rest, show readable values (456.4 px, 3.2°); focus reveals full precision.
    restPrecision = precision && (unit ? 1 : 2);
  value = state?.value ?? value;
  const description = options.description || `${label}${unit ? ` (${unit})` : ''}`;
  return `<div class="property-row${animated ? ' is-animatable' : options.wide ? ' is-wide' : ''}" data-property-row="${key}"><label class="field"><span class="property-scrub" data-property-scrub tabindex="0" role="button" aria-label="Scrub ${esc(description)}" title="Drag to adjust · Shift: fine · Alt: extra fine">${label}</span><input type="number" ${options.id ? `id="${options.id}"` : ''} ${options.legacyField === false ? '' : `data-field="${key}"`} data-property="${key}" data-property-value="${esc(value)}" data-property-precision="${precision}" data-property-display-precision="${restPrecision}" data-property-step="1" value="${formatPropertyValue(value, restPrecision)}" step="any" aria-label="${esc(description)}" ${limits}><small>${unit}</small></label></div>`;
}
export const heading = (title, symbol) =>
  `<div class="property-context-heading"><span>${icon(symbol)}</span><div><strong>${esc(title)}</strong></div></div>`;
export const button = (action, symbol, title, disabled = false) =>
  `<button class="icon-button" data-action="${action}" title="${title}" aria-label="${title}" ${disabled ? 'disabled' : ''}>${icon(symbol)}</button>`;
const secondarySections = new Set(['Connections', 'Polygons', 'Canvas alignment', 'Neighboring pose', 'Color palette']);
export const group = (title, body, extra = '') => secondarySections.has(title)
  ? `<details class="inspector-section inspector-disclosure" data-section="${esc(title)}"><summary class="inspector-title"><span>${title}</span>${extra}</summary><div class="inspector-disclosure-body">${body}</div></details>`
  : `<section class="inspector-section"><div class="inspector-title"><span>${title}</span>${extra}</div>${body}</section>`;
export const grid = body => `<div class="field-grid">${body}</div>`;
export const tools = body => `<div class="transform-actions">${body}</div>`;

// ---------------------------------------------------------------------------
// The skin

const rows = (list, env) => (list ?? []).map(row => renderRow(row, env)).join('');
const cls = (...names) => names.filter(Boolean).join(' ') || undefined;
/** A descriptor's own hooks as attributes: `data` as data-*, then `attrs` as they are. */
const hooks = item => {
  const pairs = {};
  for (const [name, value] of Object.entries(item?.data ?? {})) pairs[`data-${name}`] = value;
  return {...pairs, ...item?.attrs};
};
const limits = row => [finiteAttr('min', row.min), finiteAttr('max', row.max), row.disabled && 'disabled'].filter(Boolean).join(' ');
const finiteAttr = (name, value) => (value === undefined || value === null ? '' : `${name}="${value}"`);

/**
 * One button in today's styles: `icon` (.icon-button named by its label,
 * titled with it unless `legacy.title` is false), `text` (.button, a glyph and
 * words; `variant: 'primary'`), `plain` (no class, a glyph and a <span>).
 */
function legacyButton(item) {
  const style = item.legacy?.style ?? (item.icon && !item.text ? 'icon' : 'text');
  const tip = item.tip ?? (style === 'icon' && item.legacy?.title !== false ? item.label : undefined);
  const attrs = attributes({
    type: item.legacy?.type,
    class: style === 'icon' ? 'icon-button' : style === 'text' ? cls('button', item.variant === 'primary' && 'primary') : undefined,
    id: item.id, 'data-action': item.action, ...hooks(item), title: tip,
    'aria-label': style === 'icon' ? item.label : undefined,
    'aria-pressed': item.pressed === undefined ? undefined : String(Boolean(item.pressed)),
    disabled: Boolean(item.disabled),
  });
  const glyph = item.icon ? icon(item.icon) : '';
  const content = style === 'icon' ? glyph : style === 'plain' ? `${glyph}<span>${esc(item.label)}</span>` : `${glyph}${esc(item.label)}`;
  return `<button${attrs}>${content}</button>`;
}

/** A number without a property key (IK's chain and rotation, a movieclip's playback): a plain input in a .field label. */
function plainNumber(row) {
  const input = `<input${attributes({
    id: row.id, type: 'number', ...hooks(row), 'aria-label': row.description ?? row.label, value: String(row.value ?? ''),
    min: row.min, max: row.max, step: row.step, required: Boolean(row.required), disabled: Boolean(row.disabled),
  })}>`;
  const unit = row.unit ? `<small>${esc(row.unit)}</small>` : '';
  const variant = row.legacy?.variant;
  if (variant === 'control') return `<label class="${row.legacy.className}"><span>${esc(row.label)}</span><div class="field">${input}${unit}</div></label>`;
  return `<label class="field">${variant === 'bare' ? '' : `<span>${esc(row.label)}</span>`}${input}${unit}</label>`;
}

function number(row) {
  if (!row.key) return plainNumber(row);
  return numericField(row.label, row.key, row.value, row.unit ?? '', limits(row), undefined, {
    id: row.id, legacyField: row.field !== false, animated: row.animated, wide: row.wide, description: row.description,
  });
}

const option = (value, label, {selected, disabled} = {}) =>
  `<option${attributes({value, selected: Boolean(selected), disabled: Boolean(disabled)})}>${esc(label ?? value)}</option>`;
/** A select: bare, in the figure's Layer field (`legacy.variant: 'field'`) or in a label (`legacy.labelClass`). */
function select(row) {
  const empty = row.value === undefined || row.value === null || row.value === '';
  const placeholder = row.placeholder && empty ? option('', row.placeholder, {selected: true, disabled: true}) : '';
  const body = (row.options ?? []).map(item => option(item.value, item.label, {selected: !empty && String(item.value) === String(row.value), disabled: item.disabled})).join('');
  const control = `<select${attributes({id: row.id, class: 'inline-select', ...hooks(row), 'aria-label': row.description ?? row.label, disabled: Boolean(row.disabled)})}>${placeholder}${body}</select>`;
  const legacy = row.legacy ?? {};
  if (legacy.variant === 'field') return `<div class="figure-layer-field"><label for="${esc(row.id)}">${icon(legacy.icon)}${esc(row.label)}</label>${control}</div>`;
  if (legacy.labelClass) return `<label class="${legacy.labelClass}"><span>${esc(row.label)}</span>${control}</label>`;
  return control;
}

/** A text field: a stacked label (a layer's name), the name line of a figure or clip (`heading`), or a labelled row. */
function text(row) {
  const legacy = row.legacy ?? {};
  const input = `<input${attributes({
    id: row.id, class: legacy.inputClass, ...hooks(row), value: row.value ?? '', 'aria-label': row.description ?? row.label,
    title: row.tip, maxlength: row.maxlength,
  })}>`;
  if (legacy.variant === 'stacked') return `<label class="field-label" for="${esc(row.id)}">${esc(row.label)}</label>${input}`;
  if (legacy.variant === 'heading') return `<div class="object-heading"><span>${icon(legacy.icon)}</span>${input}</div>`;
  return `<label class="${legacy.labelClass}"><span>${esc(row.label)}</span>${input}</label>`;
}

/** Today's colour row (a native picker and its hex) or, with `picker: 'paint'`, the paint trigger that shows gradients. */
function color(row) {
  if (row.picker === 'paint') {
    return `<button type="button" id="${esc(row.id)}" data-paint-picker class="paint-trigger" aria-label="${esc(row.description ?? row.label)}"><i style="background:${esc(row.paint)}"></i><span>${esc(row.caption ?? String(row.value).toUpperCase())}</span></button>`;
  }
  const caption = row.caption ?? row.value.slice(1).toUpperCase();
  return `<div class="color-row"><input id="${esc(row.id)}" type="color" value="${esc(row.value)}" aria-label="${esc(row.description ?? row.label)}"><span class="hex-label">${esc(caption)}</span></div>`;
}

const swatch = item => `<input${attributes({type: 'color', ...hooks(item), 'aria-label': item.label, value: item.value})}>`;

/** The figure's palette: one paint-picker row per colour. */
const swatches = row => `<div class="figure-palette" aria-label="${esc(row.label)}">${(row.items ?? []).map(item =>
  `<button${attributes({type: 'button', 'data-paint-picker': true, ...hooks(item), class: 'figure-palette-row', 'aria-label': item.label})}><i style="background:${esc(item.value)}"></i><span>${esc(item.text ?? String(item.value).toUpperCase())}</span></button>`).join('')}</div>`;

/** Tabs (the camera's), pressed buttons (a connector's parts) or native radios in a row (IK's bend direction). */
function segmented(row) {
  const legacy = row.legacy ?? {}, current = item => String(item.value) === String(row.value);
  if (row.mode === 'radio') {
    const items = row.options.map(item => `<label><input${attributes({
      type: 'radio', name: row.name, value: item.value, checked: current(item), 'aria-label': item.description,
    })}><span>${esc(item.label)}</span></label>`).join('');
    return `<div class="${legacy.rowClass}"><span>${esc(row.label)}</span><div class="${legacy.className}" role="group" aria-label="${esc(row.description)}">${items}</div></div>`;
  }
  const tab = row.mode === 'tab';
  const items = row.options.map(item => `<button${attributes({
    type: tab ? undefined : 'button', role: tab ? 'tab' : undefined, ...hooks(item),
    'aria-selected': tab ? String(current(item)) : undefined, 'aria-pressed': tab ? undefined : String(current(item)),
  })}>${esc(item.label)}</button>`).join('');
  return `<div class="${legacy.className}" role="${tab ? 'tablist' : 'group'}" aria-label="${esc(row.description)}">${items}</div>`;
}

const checkbox = row => `<label class="check-row"><input${attributes({id: row.id, ...hooks(row), type: 'checkbox', checked: Boolean(row.checked)})}>${esc(row.label)}</label>`;

const toggle = row => propertyToggle(row.id, row.label, Boolean(row.checked), row.icon, {title: row.tip ?? row.label, controls: row.controls});

/** A read-only value in its element (a <span> by default): `small` after the text, or `parts` between dots. */
function value(row) {
  const legacy = row.legacy ?? {}, tag = legacy.tag ?? 'span';
  const content = row.parts ? row.parts.map(esc).join(' <span>·</span> ') : `${esc(row.text)}${row.small === undefined ? '' : `<small>${esc(row.small)}</small>`}`;
  return `<${tag}${attributes({class: legacy.className, ...hooks(row), title: row.tip})}>${content}</${tag}>`;
}
/** A quiet line: today's caption paragraph. */
const meta = row => value({...row, legacy: {tag: 'p', className: 'property-context-caption', ...row.legacy}});

const pager = row => `<div class="polygon-pagination">${legacyButton(row.previous)}<span>${esc(row.text)}</span>${legacyButton(row.next)}</div>`;

/** The camera's live monitor: a canvas and its one-line caption. */
function preview(row) {
  const legacy = row.legacy ?? {};
  const caption = (row.caption ?? []).map(part => (typeof part === 'string' ? `<span>${esc(part)}</span>` : `<span${attributes(hooks(part))}>${esc(part.text)}</span>`)).join('');
  return `<div class="${legacy.className}"><canvas${attributes({...hooks(row.media), 'aria-label': row.label})}></canvas><div class="${legacy.captionClass}">${caption}</div></div>`;
}

/** Buttons in today's action row (`legacy.className`, default .transform-actions) or, with `legacy.bare`, on their own. */
function actions(row) {
  const buttons = (row.items ?? []).map(legacyButton).join('');
  return row.legacy?.bare ? buttons : `<div class="${row.legacy?.className ?? 'transform-actions'}">${buttons}</div>`;
}

const gridRow = (row, env) => `<div class="${cls('field-grid', row.legacy?.className)}">${rows(row.rows, env)}</div>`;

/** A region or a wrapper: a <div> (or `legacy.tag`, such as a fill's <details> with its `legacy.summary`). */
function groupRow(row, env) {
  const legacy = row.legacy ?? {}, tag = legacy.tag ?? 'div';
  const summary = legacy.summary === undefined ? '' : `<summary>${esc(legacy.summary)}</summary>`;
  return `<${tag}${attributes({id: row.id, class: legacy.className, ...hooks(row), hidden: Boolean(row.hidden)})}>${summary}${rows(row.rows, env)}</${tag}>`;
}

/** Today's context heading (a glyph and the context's name), or the camera's with its "Live" badge. */
function headingRow(row) {
  if (row.legacy?.className) return `<div class="${row.legacy.className}"><span>${icon(row.icon)}</span><div><strong>${esc(row.title)}</strong></div>${row.badge ? `<span class="camera-live">${esc(row.badge)}</span>` : ''}</div>`;
  return heading(row.title, row.icon);
}

/**
 * One section in today's markup: group() (a secondary title becomes a
 * <details>), or with `legacy` a section with its own class and title style
 * (`title: 'plain' | false`), the movieclip's "More actions" disclosure, or
 * `bare` (its rows with no section around them: headings, sub-module views).
 */
function section(item, env) {
  if (!item || item.hidden) return '';
  const legacy = item.legacy ?? {}, body = rows(item.rows, env);
  if (legacy.bare) return body;
  const title = esc(item.title ?? '');
  const extra = (item.actions ?? []).map(legacyButton).join('') + (legacy.count === undefined ? '' : `<span>${esc(legacy.count)}</span>`);
  if (legacy.disclosure) {
    return `<details class="${cls('inspector-section inspector-disclosure', legacy.className)}" data-section="${esc(legacy.disclosure)}"><summary class="inspector-title">${title}</summary>${body}</details>`;
  }
  if (!legacy.className && legacy.title === undefined && !legacy.attrs) return group(title, body, extra);
  const head = legacy.title === false ? '' : legacy.title === 'plain' ? `<div class="inspector-title">${title}</div>` : `<div class="inspector-title"><span>${title}</span>${extra}</div>`;
  return `<section${attributes({class: cls('inspector-section', legacy.className), ...legacy.attrs})}>${head}${body}</section>`;
}

/**
 * The sections in order. Sections that share `legacy.wrap` (a list of
 * wrappers, outermost first: {key, className, hidden}) render inside the
 * same wrapper elements, as the camera's and the movieclip's panels do.
 */
function sections(list, env) {
  let html = '';
  const open = [];
  for (const item of list ?? []) {
    const wraps = item?.legacy?.wrap ?? [];
    let shared = 0;
    while (shared < open.length && shared < wraps.length && open[shared] === wraps[shared].key) shared++;
    while (open.length > shared) { html += '</div>'; open.pop(); }
    for (const wrap of wraps.slice(shared)) {
      html += `<div${attributes({class: wrap.className, hidden: Boolean(wrap.hidden)})}>`;
      open.push(wrap.key);
    }
    html += section(item, env);
  }
  return html + '</div>'.repeat(open.length);
}

export const LEGACY_SKIN = Object.freeze({
  placeholder: '',
  sections,
  rows: Object.freeze({
    number, select, text, color, swatch, swatches, segmented, checkbox, switch: toggle, value, meta, pager, preview, actions,
    grid: gridRow, group: groupRow, heading: headingRow,
  }),
});

/** Renders rows or a section list with the legacy skin, for the sub-modules that embed a piece in their own HTML. */
export const legacyEnv = Object.freeze({skin: LEGACY_SKIN});
