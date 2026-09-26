/**
 * The inspector kit: a context describes its inspector as data (sections of
 * rows) and the kit renders it to an HTML string with the .ui-* classes
 * (components.md §3-4, architecture.md §3.13). The string goes through
 * updateInspectorDOM() exactly as inspector-view.mjs's does today, so the kit
 * keeps its reconciliation contract: every control carries its identity (id,
 * data-property, data-section, data-inspector-owned), number fields carry the
 * PropertyControls hooks (data-property-row, data-property-scrub,
 * data-property-value, -precision, -display-precision, -step, plus the legacy
 * data-field) and imperative widgets live in data-inspector-owned hosts.
 * PropertyControls owns scrubbing (Shift ×0.1, Alt ×0.01), typing, arrow-key
 * steps and Escape rollback; the kit only emits the markup it reads.
 *
 * The inspector never shows key state: no diamonds, no data-property-key,
 * data-property-nav or key controls.
 *
 * Descriptors
 *   inspector  {kind, sections, scope, quick, footer}
 *   section    {id, title, place: 'core' | 'titled', open: boolean | (ctx) => boolean,
 *               actions: [button] (at most two, a title switch included),
 *               switch: {id, label, checked, disabled, data, attrs} (titled only),
 *               rows: [row], hidden}
 *   row        {kind, ...}: number, stepper-field, stepper, slider, select,
 *               switch, field-switch, checkbox, color, swatch, swatches,
 *               segmented, text, actions, list-row, card, owned, meta, grid
 *   button     {action, command, shiftAction, icon, label, text, variant, size,
 *               id, tip, disabled, pressed, expanded, data, attrs}
 *
 * Core sections are always open. Titled sections fold behind their title and
 * open when their auto-open rule says their content matters now, or when the
 * person opened them before in this kind of context (SectionMemory, persisted
 * by the owner as the inspectorSections setting). installInspectorKit() is
 * the thin DOM half: section toggles, stepper buttons, slider readouts and the
 * one-time scrub hint.
 *
 * Pure and DOM-free at import; strings are English with an optional
 * env.t(key, params) translator.
 */
import {icon as appIcon} from './icons.mjs';
import {formatPropertyValue} from './property-controls.mjs';

export const MAX_TITLE_ACTIONS = 2;
export const SECTION_PLACES = Object.freeze(['core', 'titled']);

const TEXT = Object.freeze({
  'inspector.scrubTip': 'Drag to adjust · Shift: fine · Alt: extra fine',
  'inspector.scrubLabel': 'Scrub {name}',
  'inspector.scrubHint': 'Drag a label to scrub · Shift ×0.1 · Alt ×0.01',
  'inspector.mixed': 'Mixed',
  'inspector.decrease': 'Decrease {name}',
  'inspector.increase': 'Increase {name}',
});
/** The one-time hint the message slot shows when a person first focuses a scrub-able field. */
export const SCRUB_HINT = TEXT['inspector.scrubHint'];

const fill = (text, params) => text.replace(/\{([A-Za-z]\w*)\}/g, (token, name) => (Object.hasOwn(params, name) ? String(params[name]) : token));
function say(env, key, params = {}) {
  if (typeof env?.t === 'function') {
    try {
      const text = env.t(key, params);
      if (typeof text === 'string' && text && text !== key) return text;
    } catch { /* a missing translation falls back to English */ }
  }
  return fill(TEXT[key] ?? key, params);
}

const ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
/** Text and attribute values are always escaped; the kit never interpolates raw markup except `html` on owned and card hosts. */
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ESCAPES[character]);

// Attributes a descriptor may add to a control through `attrs` and `data`.
// Event handler attributes and style never pass: inline style is limited to
// the custom properties the kit writes itself (--swatch, --_p, --level).
const ATTRIBUTE_NAME = /^(?:data-[a-z][a-z0-9-]*|aria-[a-z]+|role|title|tabindex|name|maxlength|minlength|placeholder|autocomplete|spellcheck|inputmode|pattern|for|form|accept|multiple|size)$/;
const DATA_NAME = /^[a-z][a-z0-9-]*$/;
const ID = /^[A-Za-z][\w:.-]*$/;
const SECTION_ID = /^[a-z][a-z0-9-]{0,39}$/;

/** ` name="value"` pairs in insertion order: true renders a bare attribute, false/null/undefined skip it. */
export function attributes(pairs) {
  let html = '';
  for (const [name, value] of Object.entries(pairs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    html += value === true ? ` ${name}` : ` ${name}="${escapeHTML(value)}"`;
  }
  return html;
}
/** A descriptor's extra `data` ({'draw-setting': 'blend'} → data-draw-setting) and `attrs`, validated. */
function extras(item) {
  const pairs = {};
  for (const [name, value] of Object.entries(item?.data ?? {})) {
    if (!DATA_NAME.test(name)) throw new TypeError(`Invalid data attribute: ${name}`);
    pairs[`data-${name}`] = value;
  }
  for (const [name, value] of Object.entries(item?.attrs ?? {})) {
    if (!ATTRIBUTE_NAME.test(name)) throw new TypeError(`Attribute ${name} is not allowed in inspector descriptors.`);
    pairs[name] = value;
  }
  return pairs;
}
const id = value => {
  if (value === undefined || value === null || value === '') return undefined;
  if (!ID.test(String(value))) throw new TypeError(`Invalid control id: ${value}`);
  return String(value);
};
const finite = value => (value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value));
const span = row => (row.span === 2 ? ' ui-span-2' : '');
const glyph = (env, name, cls) => (env?.icon ?? appIcon)(name, cls);

/** Values at rest show fewer decimals than they edit with (inspector-view.mjs: 1 with a unit, 2 without, 0 for integers). */
export const restDisplayPrecision = (precision = 3, unit = '') => (precision ? (unit ? 1 : 2) : 0);

const GLUED_UNITS = new Set(['%', '°', '×']);
/** A value with its unit as a person reads it: "100%", "172°", "8 px", "24 fps". */
export function formatValueWithUnit(value, {unit = '', precision = 2} = {}) {
  const text = formatPropertyValue(value, precision);
  if (!unit || text === '') return text;
  return GLUED_UNITS.has(unit) ? `${text}${unit}` : `${text} ${unit}`;
}

/** Where a slider's fill ends, as a CSS percentage (0% to 100%). */
export function sliderFill(value, min = 0, max = 100) {
  const low = Number(min), high = Number(max), current = Number(value);
  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(current) || high <= low) return '0%';
  return `${Number((Math.max(0, Math.min(1, (current - low) / (high - low))) * 100).toFixed(2))}%`;
}

const HEX = /^#[0-9a-f]{6}$/i;
const PAINT = /^[\w\s#%.,()+-]+$/;
/** A colour for --swatch: #rrggbb, #rrggbbaa or a plain rgb()/hsl() function; anything else is refused. */
function swatchColor(value) {
  const text = String(value ?? '').trim();
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) || /^(?:rgb|hsl)a?\([\d\s.,%/-]+\)$/i.test(text) ? text : null;
}
/** A paint for --swatch-paint (paintCSS output: a colour or a gradient); declarations cannot break out of the property. */
function swatchPaint(value) {
  const text = String(value ?? '').trim();
  return text && !/[;{}\\<>"'@!]|url\(/i.test(text) && PAINT.test(text) ? text : null;
}
const swatchStyle = ({color, paint}) => {
  const vars = [];
  // A solid paint is a colour: --swatch; only gradients need their own layer.
  const solid = swatchColor(paint) ?? swatchColor(color), gradient = swatchColor(paint) ? null : swatchPaint(paint);
  if (solid) vars.push(`--swatch:${solid}`);
  if (gradient) vars.push(`--swatch-paint:${gradient}`);
  return vars.length ? vars.join(';') : undefined;
};

// ---------------------------------------------------------------------------
// Buttons: title actions, action rows, stepper steps, list-row actions, footer.

/**
 * One button. An icon without `text` is a .ui-icon-button named by aria-label
 * (its tooltip is `tip`, else the label); otherwise a .ui-button with an
 * optional leading glyph. Behaviour comes from data-action / data-command /
 * data-shift-action, which the app's delegated handlers already own.
 */
export function renderButton(item, env = {}, {className = '', size} = {}) {
  if (!item?.label) throw new TypeError('A button needs a label (its accessible name).');
  const iconOnly = Boolean(item.icon) && !item.text;
  const classes = [iconOnly ? 'ui-icon-button' : 'ui-button', className].filter(Boolean).join(' ');
  const attrs = attributes({
    type: 'button', class: classes, id: id(item.id),
    'data-variant': iconOnly ? item.variant === 'soft' ? 'soft' : undefined : item.variant,
    'data-size': item.size ?? size,
    'data-action': item.action, 'data-shift-action': item.shiftAction, 'data-command': item.command,
    'aria-label': iconOnly ? item.label : undefined,
    'aria-pressed': item.pressed === undefined ? undefined : String(Boolean(item.pressed)),
    'aria-expanded': item.expanded === undefined ? undefined : String(Boolean(item.expanded)),
    'aria-haspopup': item.menu ? 'menu' : undefined,
    title: item.tip ?? (iconOnly ? item.label : undefined),
    disabled: Boolean(item.disabled),
    ...extras(item),
  });
  const lead = item.icon ? glyph(env, item.icon, 'ui-icon') : '';
  return `<button${attrs}>${lead}${iconOnly ? '' : `<span class="ui-label">${escapeHTML(item.label)}</span>`}</button>`;
}

// ---------------------------------------------------------------------------
// Rows

/** The shared input attributes of a PropertyControls number (inspector-view.mjs's numericField order, kept for string tests). */
function numberInput(row, env, className) {
  const {key, label, unit = ''} = row;
  if (!key) throw new TypeError(`Number field ${label ?? ''} needs a property key.`);
  const precision = row.precision ?? 3, display = row.displayPrecision ?? restDisplayPrecision(precision, unit);
  const value = finite(row.value) ?? 0;
  const description = row.description ?? (unit ? `${label} (${unit})` : label);
  const legacy = row.field === false ? undefined : (row.field ?? key);
  const mixed = Boolean(row.mixed);
  const input = `<input${attributes({
    class: className, type: 'number', id: id(row.id), 'data-field': legacy, 'data-property': key,
    'data-property-value': value, 'data-property-precision': precision, 'data-property-display-precision': display,
    'data-property-step': row.step ?? 1, value: mixed ? '' : formatPropertyValue(value, display), step: 'any',
    'aria-label': description, min: finite(row.min), max: finite(row.max), disabled: Boolean(row.disabled),
    placeholder: mixed ? say(env, 'inspector.mixed') : undefined, ...extras(row),
  })}>`;
  const scrub = `<span${attributes({
    class: 'ui-field-label', 'data-property-scrub': true, tabindex: 0, role: 'button',
    'aria-label': row.scrubLabel ?? say(env, 'inspector.scrubLabel', {name: description}), title: row.tip ?? say(env, 'inspector.scrubTip'),
  })}>${escapeHTML(label)}</span>`;
  return {input, scrub, description};
}

/**
 * A number field: the inline label scrubs (PropertyControls) and the unit
 * follows the value. A <label>, as today's, so a click anywhere in the field
 * focuses the value. Without `key` it is a plain number input (IK's target rotation).
 */
function numberField(row, env) {
  const glue = GLUED_UNITS.has(row.unit) ? ' data-glue' : '';
  const suffix = row.unit ? `<span class="ui-field-suffix" aria-hidden="true"${glue}>${escapeHTML(row.unit)}</span>` : '';
  if (!row.key) {
    const input = `<input${attributes({
      class: 'ui-field-input', type: 'number', id: id(row.id), step: row.step ?? 'any', value: formatPropertyValue(finite(row.value) ?? 0, row.precision ?? 3),
      'aria-label': row.description ?? (row.unit ? `${row.label} (${row.unit})` : row.label), min: finite(row.min), max: finite(row.max),
      disabled: Boolean(row.disabled), ...extras(row),
    })}>`;
    return `<label class="ui-field${span(row)}"><span class="ui-field-label">${escapeHTML(row.label)}</span>${input}${suffix}</label>`;
  }
  const {input, scrub} = numberInput(row, env, 'ui-field-input');
  return `<label${attributes({class: `ui-field${span(row)}`, 'data-property-row': row.key, 'data-mixed': Boolean(row.mixed)})}>${scrub}${input}${suffix}</label>`;
}

/** A step button of a stepper: a registered command (data-action) or a plain step the installer applies. */
function stepButton(step, direction, name, env) {
  const fallback = {label: say(env, direction < 0 ? 'inspector.decrease' : 'inspector.increase', {name}), icon: direction < 0 ? 'minus' : 'plus'};
  const item = {...fallback, ...step};
  if (!item.action && !item.command) item.data = {...item.data, 'kit-step': direction};
  return renderButton(item, env, {size: 'sm'});
}

/**
 * The stepper field (revision 4.2/4.3): an inline label and a value between two
 * step buttons, "Order ↓ 2 ↑". The label and input share a display:contents
 * property row, so PropertyControls finds the input from the label while the
 * step buttons stay outside it (Enter on a button activates the button).
 */
function stepperField(row, env) {
  const {input, scrub, description} = numberInput(row, env, 'ui-field-input');
  const core = `<span class="ui-field-core" data-property-row="${escapeHTML(row.key)}">${scrub}${input}</span>`;
  return `<div${attributes({class: `ui-field${span(row)}`, 'data-steps': true, role: 'group', 'aria-label': row.groupLabel ?? description})}>` +
    `${core}${stepButton(row.down, -1, description, env)}${stepButton(row.up, 1, description, env)}</div>`;
}

/** A stepper with a row label (Inbetweens, IK chain): −, a typeable value, +. */
function stepper(row, env) {
  const name = row.description ?? row.label;
  let value;
  if (row.key) value = `<span class="ui-field-core" data-property-row="${escapeHTML(row.key)}">${numberInput({...row, description: name}, env, 'ui-stepper-input').input}</span>`;
  else value = `<input${attributes({
    class: 'ui-stepper-input', type: 'number', id: id(row.id), min: finite(row.min), max: finite(row.max), step: row.step ?? 1,
    value: formatPropertyValue(finite(row.value) ?? 0, row.precision ?? 0), 'aria-label': name, disabled: Boolean(row.disabled), ...extras(row),
  })}>`;
  const control = `<div class="ui-stepper" role="group"${attributes({'aria-label': name})}>${stepButton(row.down, -1, name, env)}${value}${stepButton(row.up, 1, name, env)}</div>`;
  return row.label ? `<div class="ui-row"><span class="ui-row-label" aria-hidden="true">${escapeHTML(row.label)}</span>${control}</div>` : control;
}

/** A bounded value on a track: label, slider, readout. With `key` the range input is a PropertyControls property. */
function slider(row, env) {
  const min = finite(row.min) ?? 0, max = finite(row.max) ?? 100, value = finite(row.value) ?? min;
  const precision = row.precision ?? 0, unit = row.unit ?? '';
  const text = row.valueText ?? formatValueWithUnit(value, {unit, precision});
  const property = row.key ? {
    'data-property': row.key, 'data-property-value': value, 'data-property-precision': precision, 'data-property-step': row.step ?? 1,
  } : {};
  const input = `<input${attributes({
    class: 'ui-slider', type: 'range', id: id(row.id), ...property, min, max, step: row.step ?? 'any', value,
    'aria-label': row.description ?? row.label, 'aria-valuetext': text, disabled: Boolean(row.disabled),
    'data-unit': unit || undefined, 'data-precision': precision, style: `--_p:${sliderFill(value, min, max)}`, ...extras(row),
  })}>`;
  return `<div${attributes({class: 'ui-slider-row', 'data-property-row': row.key})}><span class="ui-slider-label" aria-hidden="true">${escapeHTML(row.label)}</span>${input}<output class="ui-slider-value" aria-hidden="true">${escapeHTML(text)}</output></div>`;
}

/**
 * A select carries its label inside (revision 4.1: "Layer Bubble ▾"); `bare`
 * drops the visible label when the value already names its kind ("Layer 1"),
 * keeping it as the tooltip. `placeholder` shows while no option is selected ("Mixed").
 */
function select(row, env) {
  const options = row.options ?? [];
  const selected = row.value === undefined ? options.some(option => option.selected) : options.some(option => String(option.value) === String(row.value));
  const placeholder = row.placeholder && !selected ? `<option value="" disabled selected>${escapeHTML(row.placeholder)}</option>` : '';
  const body = options.map(option => `<option${attributes({
    value: option.value, selected: row.value === undefined ? Boolean(option.selected) : String(option.value) === String(row.value),
    disabled: Boolean(option.disabled), ...extras(option),
  })}>${escapeHTML(option.label ?? option.value)}</option>`).join('');
  const control = `<select${attributes({
    class: 'ui-field-input', id: id(row.id), 'aria-label': row.description ?? row.label, disabled: Boolean(row.disabled), ...extras(row),
  })}>${placeholder}${body}</select>`;
  const label = row.bare ? '' : `<span class="ui-field-label">${escapeHTML(row.label)}</span>`;
  return `<label${attributes({class: `ui-field${span(row)}`, 'data-select': true, 'data-bare': Boolean(row.bare), title: row.bare ? row.tip ?? row.label : row.tip})}>` +
    `${label}${control}${glyph(env, 'chevron-down', 'ui-icon ui-field-chev')}</label>`;
}

const switchInput = (item, className = 'ui-switch') => `<input${attributes({
  class: className, type: 'checkbox', role: 'switch', id: id(item.id), 'aria-label': item.description ?? item.label,
  checked: Boolean(item.checked), 'aria-controls': item.controls, disabled: Boolean(item.disabled), ...extras(item),
})}>`;

/** The field switch (revision 4.2): the one switch pattern in inspector sections, laid out in the field grid. */
const fieldSwitch = row => `<label${attributes({class: `ui-field${span(row)}`, 'data-switch-field': true, title: row.tip})}><span class="ui-field-label">${escapeHTML(row.label)}</span>${switchInput(row)}</label>`;
/** The switch row of popovers and dialogs: the label left, the switch right, the whole row the target. */
const switchRow = row => `<label${attributes({class: 'ui-switch-row', title: row.tip})}><span>${escapeHTML(row.label)}</span>${switchInput(row)}</label>`;

const checkbox = row => `<label${attributes({class: 'ui-check-row', title: row.tip})}><input${attributes({
  class: 'ui-checkbox', type: 'checkbox', id: id(row.id), checked: Boolean(row.checked), 'aria-label': row.description,
  'aria-checked': row.mixed ? 'mixed' : undefined, disabled: Boolean(row.disabled), ...extras(row),
})}><span>${escapeHTML(row.label)}</span></label>`;

const hexCaption = value => (HEX.test(String(value ?? '')) ? String(value).slice(1).toUpperCase() : '');

/**
 * A colour field: a swatch and its hex. `picker: 'native'` keeps an
 * <input type=color> (today's #figure-color and #background-color, read by
 * their change handlers); `picker: 'paint'` is a button with data-paint-picker
 * (today's #segment-color) whose swatch can show a gradient (`paint`).
 * color-picker.mjs opens its popover for both.
 */
function color(row) {
  const caption = escapeHTML(row.caption ?? hexCaption(row.value));
  if (row.picker === 'paint') {
    const swatch = `<span${attributes({class: 'ui-swatch', 'data-size': 'sm', 'data-mixed': Boolean(row.mixed), style: swatchStyle({color: row.value, paint: row.paint})})}></span>`;
    return `<button${attributes({
      type: 'button', class: `ui-field${span(row)}`, 'data-color': true, id: id(row.id), 'data-paint-picker': true,
      'aria-label': row.description ?? row.label, title: row.tip, disabled: Boolean(row.disabled), ...extras(row),
    })}>${swatch}<span class="ui-field-hex">${caption}</span></button>`;
  }
  const value = HEX.test(String(row.value ?? '')) ? String(row.value).toLowerCase() : '#000000';
  return `<label${attributes({class: `ui-field${span(row)}`, 'data-color': true, title: row.tip})}><input${attributes({
    class: 'ui-swatch', type: 'color', id: id(row.id), value, 'aria-label': row.description ?? row.label, disabled: Boolean(row.disabled),
    'data-mixed': Boolean(row.mixed), ...extras(row),
  })}><span class="ui-field-hex">${caption}</span></label>`;
}

/** One swatch on its own (a list row's colour, a palette entry): a native colour input or a paint-picker button. */
function swatch(item) {
  if (item.picker === 'native') {
    const value = HEX.test(String(item.value ?? '')) ? String(item.value).toLowerCase() : '#000000';
    return `<input${attributes({
      class: 'ui-swatch', type: 'color', id: id(item.id), value, 'data-size': item.size, 'aria-label': item.label,
      disabled: Boolean(item.disabled), ...extras(item),
    })}>`;
  }
  return `<button${attributes({
    type: 'button', class: 'ui-swatch', id: id(item.id), 'data-size': item.size, 'data-paint-picker': item.picker === 'paint' ? true : undefined,
    style: swatchStyle({color: item.value, paint: item.paint}), 'aria-label': item.label, title: item.tip ?? item.label,
    'aria-pressed': item.pressed === undefined ? undefined : String(Boolean(item.pressed)), disabled: Boolean(item.disabled), ...extras(item),
  })}></button>`;
}
/** A collection of swatches: one group, 24px targets (the figure's palette, recent colours). */
const swatches = row => `<div${attributes({class: 'ui-swatch-grid', role: 'group', 'aria-label': row.label, ...extras(row)})}>${(row.items ?? []).map(swatch).join('')}</div>`;

/**
 * A segmented control, 2-4 options. `mode`: 'radio' keeps native radio inputs
 * (their change handlers, as IK's bend direction), 'pressed' renders
 * aria-pressed buttons (tested button groups), 'tab' role=tab buttons.
 */
function segmented(row, env) {
  const mode = row.mode ?? 'radio', options = row.options ?? [];
  if (options.length < 2 || options.length > 4) throw new TypeError(`Segmented ${row.label ?? row.name} needs 2-4 options; use a select for more.`);
  const current = option => String(option.value) === String(row.value);
  const items = options.map(option => {
    const lead = option.icon ? glyph(env, option.icon, 'ui-icon') : '';
    const text = option.iconOnly ? '' : `<span class="ui-label">${escapeHTML(option.label)}</span>`;
    if (mode === 'radio') {
      return `<label${attributes({class: 'ui-segmented-item', title: option.tip})}><input${attributes({
        class: 'ui-segmented-input', type: 'radio', name: row.name, value: option.value, checked: current(option),
        'aria-label': option.description ?? (option.iconOnly ? option.label : undefined), disabled: Boolean(row.disabled || option.disabled), ...extras(option),
      })}>${lead}${text}</label>`;
    }
    return `<button${attributes({
      type: 'button', class: 'ui-segmented-item', id: id(option.id), role: mode === 'tab' ? 'tab' : undefined,
      'aria-selected': mode === 'tab' ? String(current(option)) : undefined, 'aria-pressed': mode === 'pressed' ? String(current(option)) : undefined,
      'aria-label': option.iconOnly ? option.label : undefined, title: option.tip ?? (option.iconOnly ? option.label : undefined),
      'data-action': option.action, disabled: Boolean(row.disabled || option.disabled), ...extras(option),
    })}>${lead}${text}</button>`;
  }).join('');
  const role = mode === 'tab' ? 'tablist' : 'group';
  const control = `<div${attributes({
    class: 'ui-segmented', role, 'aria-label': row.description ?? row.label, 'data-size': row.size ?? 'sm', 'data-fill': Boolean(row.fill), ...extras(row),
  })}>${items}</div>`;
  return row.label && !row.inline ? `<div class="ui-row"><span class="ui-row-label" aria-hidden="true">${escapeHTML(row.label)}</span>${control}</div>` : control;
}

/** A text field (names): the inline label pattern, or `stacked` for the rare form row. */
function text(row) {
  const input = `<input${attributes({
    class: 'ui-field-input', type: 'text', id: id(row.id), value: row.value ?? '', 'aria-label': row.description ?? row.label,
    maxlength: finite(row.maxlength), placeholder: row.placeholder, title: row.tip, disabled: Boolean(row.disabled),
    spellcheck: row.spellcheck === undefined ? undefined : String(Boolean(row.spellcheck)), ...extras(row),
  })}>`;
  if (row.stacked) return `<div class="ui-form-row${span(row)}"><span class="ui-form-label" aria-hidden="true">${escapeHTML(row.label)}</span><div class="ui-field">${input}</div></div>`;
  return `<label class="ui-field${span(row)}" data-text><span class="ui-field-label">${escapeHTML(row.label)}</span>${input}</label>`;
}

/** An action row: a few buttons that act on the selection (Align's six, Fit view…). */
const actions = (row, env) => `<div${attributes({class: 'ui-action-row', role: 'group', 'aria-label': row.label, 'data-fill': Boolean(row.fill), ...extras(row)})}>${(row.items ?? []).map(item => renderButton(item, env, {size: row.size})).join('')}</div>`;

/** A list row: lead glyph, name, meta, and its actions in their own column (eye, lock, a swatch, delete). */
function listRow(row, env) {
  const controls = (row.actions ?? []).map(item => (item.kind === 'swatch' ? swatch(item) : renderButton(item, env, {size: 'sm'}))).join('');
  const level = Math.max(0, Math.min(16, Math.round(finite(row.level) ?? 0)));
  return `<div${attributes({
    class: 'ui-list-row', id: id(row.id), role: row.role, tabindex: row.tabindex,
    'aria-selected': row.selected === undefined ? undefined : String(Boolean(row.selected)),
    'aria-current': row.current ? 'true' : undefined, 'data-hidden': row.muted ? 'true' : undefined,
    style: level ? `--level:${level}` : undefined, ...extras(row),
  })}>${row.lead ? `<span class="ui-list-row-lead">${glyph(env, row.lead, 'ui-icon')}</span>` : ''}` +
    `<span class="ui-list-row-label">${escapeHTML(row.label)}</span>` +
    `${row.meta === undefined ? '' : `<span class="ui-list-row-meta">${escapeHTML(row.meta)}</span>`}` +
    `${controls ? `<span class="ui-list-row-actions">${controls}</span>` : ''}</div>`;
}

/** An owned host: imperative widgets (graphs, curves, monitors) keep their live content across renders. */
function owned(row) {
  if (!row.key || !DATA_NAME.test(row.key)) throw new TypeError('An owned host needs a key (its data-inspector-owned value).');
  const tag = row.tag === 'canvas' ? 'canvas' : 'div';
  const attrs = attributes({
    class: row.className, 'data-inspector-owned': row.key, 'data-section': row.section, role: row.role, 'aria-label': row.label, ...extras(row),
  });
  return tag === 'canvas' ? `<canvas${attrs}></canvas>` : `<div${attrs}>${row.html ?? ''}</div>`;
}

/**
 * A preview well: an owned canvas or widget in a flat sunken frame with an
 * optional one-line caption (the camera monitor with its size and zoom, the
 * brush preview). Never raised, never a summary; the only card the calm rules
 * keep (visual-system §2.2 retired decorative cards).
 */
function card(row) {
  const media = owned({...row.media, key: row.media?.key ?? row.key, className: `ui-card-media${row.media?.className ? ` ${row.media.className}` : ''}`});
  const caption = (row.caption ?? []).map(part => (typeof part === 'string'
    ? `<span>${escapeHTML(part)}</span>` : `<span${attributes(extras(part))}>${escapeHTML(part.text)}</span>`)).join('');
  return `<div${attributes({class: `ui-card${span(row)}`, 'data-section': row.section, ...extras(row)})}>${media}${caption ? `<div class="ui-card-caption">${caption}</div>` : ''}</div>`;
}

const meta = row => `<p${attributes({class: 'inspector-meta', title: row.tip, ...extras(row)})}>${escapeHTML(row.text)}</p>`;

function grid(row, env) {
  return `<div${attributes({class: 'ui-field-grid', 'data-ratio': row.ratio, 'data-stack-narrow': Boolean(row.stackNarrow)})}>${renderRows(row.rows, env)}</div>`;
}

const RENDERERS = {
  number: numberField, 'stepper-field': stepperField, stepper, slider, select, switch: switchRow, 'field-switch': fieldSwitch,
  checkbox, color, swatch, swatches, segmented, text, actions, 'list-row': listRow, card, owned, meta, grid,
};
/** The row kinds a descriptor may use. */
export const ROW_KINDS = Object.freeze(Object.keys(RENDERERS));

/** One row of a section body. Unknown kinds throw: a silently dropped control would be a lost function. */
export function renderRow(row, env = {}) {
  if (!row || row.hidden) return '';
  const render = RENDERERS[row.kind];
  if (!render) throw new TypeError(`Unknown inspector row kind: ${row?.kind}`);
  return render(row, env);
}
const renderRows = (rows, env) => (rows ?? []).map(row => renderRow(row, env)).join('');

// ---------------------------------------------------------------------------
// Sections and their remembered state

const MEMORY_KINDS = 48, MEMORY_SECTIONS = 64;
/** The inspectorSections setting, cleaned: {kind: {sectionId: true}} for the titled sections a person left open. */
export function normalizeSectionMemory(saved) {
  const result = {};
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return result;
  for (const [kind, sections] of Object.entries(saved).slice(0, MEMORY_KINDS)) {
    if (!SECTION_ID.test(kind) || !sections || typeof sections !== 'object' || Array.isArray(sections)) continue;
    const open = Object.entries(sections).filter(([section, value]) => SECTION_ID.test(section) && value === true).slice(0, MEMORY_SECTIONS);
    if (open.length) result[kind] = Object.fromEntries(open);
  }
  return result;
}

/** A titled section's auto-open rule for this render: `open` as a boolean or a function of the context. */
export function autoOpen(section, ctx) {
  return typeof section?.open === 'function' ? Boolean(section.open(ctx)) : section?.open === true;
}

/**
 * Which titled sections are open. Per context kind, a section a person opened
 * stays open (remembered and saved through onChange). A section also opens by
 * itself while its auto-open rule holds (Connection while joined, Parallax
 * while on); closing it then dismisses it only until the rule stops holding,
 * so the next time its content matters it opens again. Dismissals are not saved.
 */
export class SectionMemory {
  constructor(saved = {}, {onChange} = {}) {
    this.saved = normalizeSectionMemory(saved);
    this.dismissed = new Set();
    this.onChange = typeof onChange === 'function' ? onChange : null;
  }
  isOpen(kind, section, ctx) {
    if ((section?.place ?? 'core') !== 'titled') return true;
    const key = `${kind}\u0000${section.id}`;
    if (autoOpen(section, ctx)) return !this.dismissed.has(key);
    this.dismissed.delete(key);
    return this.saved[kind]?.[section.id] === true;
  }
  /** Records a person's toggle. `auto` is whether the section's rule held when they toggled it. */
  toggle(kind, sectionId, open, {auto = false} = {}) {
    if (!SECTION_ID.test(String(kind)) || !SECTION_ID.test(String(sectionId))) return false;
    const key = `${kind}\u0000${sectionId}`;
    if (auto) {
      if (open) this.dismissed.delete(key); else this.dismissed.add(key);
      return true;
    }
    const sections = {...this.saved[kind]};
    if (open) sections[sectionId] = true; else delete sections[sectionId];
    const next = {...this.saved};
    if (Object.keys(sections).length) next[kind] = sections; else delete next[kind];
    const normalized = normalizeSectionMemory(next);
    if (JSON.stringify(normalized) === JSON.stringify(this.saved)) return false;
    this.saved = normalized;
    this.onChange?.(this.toJSON());
    return true;
  }
  toJSON() { return structuredClone(this.saved); }
}

/** Open state for one render: core sections always; titled ones from the memory, else their auto-open rule. */
export function resolveSectionOpen(section, {kind = 'default', ctx, memory} = {}) {
  if ((section?.place ?? 'core') !== 'titled') return true;
  return memory ? memory.isOpen(kind, section, ctx) : autoOpen(section, ctx);
}

/** The body id a titled section's toggle controls, unique per context kind. */
export const sectionBodyId = (kind, sectionId) => `inspector-section-${String(kind).replace(/[^a-z0-9-]/gi, '-')}-${sectionId}`;

function titleActions(section, env) {
  const list = [...(section.actions ?? [])];
  const count = list.length + (section.switch ? 1 : 0);
  if (count > MAX_TITLE_ACTIONS) throw new TypeError(`Section ${section.id} has ${count} title actions; at most ${MAX_TITLE_ACTIONS}.`);
  const buttons = list.map(item => renderButton({...item, variant: item.icon && !item.text ? item.variant : item.variant ?? 'ghost'}, env, {className: 'ui-section-action', size: 'sm'})).join('');
  return list.length > 1 ? `<div class="ui-section-actions">${buttons}</div>` : buttons;
}

/** One section: a quiet title with at most two title actions and its rows. */
export function renderSection(section, env = {}) {
  if (!section || section.hidden) return '';
  if (!SECTION_ID.test(String(section.id))) throw new TypeError(`Invalid section id: ${section.id}`);
  const place = section.place ?? 'core';
  if (!SECTION_PLACES.includes(place)) throw new TypeError(`Section ${section.id} has an unknown place: ${place}`);
  const kind = env.kind ?? 'default', rows = renderRows(section.rows, env), actions = titleActions(section, env);
  // Hooks a feature reads from the section (data-parallax-layer, data-motion-id).
  const hooks = attributes(extras(section));
  if (place === 'core') {
    if (section.switch) throw new TypeError(`Core section ${section.id} cannot carry a title switch; make it titled.`);
    const head = section.title || actions ? `<div class="ui-section-head">${section.title ? `<h3 class="ui-section-title">${escapeHTML(section.title)}</h3>` : ''}${actions}</div>` : '';
    return `<section class="ui-section" data-section="${section.id}"${hooks}>${head}<div class="ui-section-body">${rows}</div></section>`;
  }
  if (!section.title) throw new TypeError(`Titled section ${section.id} needs a title that says what is inside.`);
  const auto = autoOpen(section, env.ctx), open = resolveSectionOpen(section, env), body = sectionBodyId(kind, section.id);
  const toggle = `<button${attributes({
    type: 'button', class: 'ui-section-toggle', 'aria-expanded': String(open), 'aria-controls': body,
    'data-section-toggle': section.id, 'data-section-kind': kind, 'data-auto': auto,
  })}><span class="ui-section-title">${escapeHTML(section.title)}</span>${glyph(env, 'chevron-right', 'ui-icon ui-section-chev')}</button>`;
  const titleSwitch = section.switch ? `<span class="ui-section-sizer" aria-hidden="true">${escapeHTML(section.title)}</span>` +
    `<label${attributes({class: 'ui-section-switch', title: section.switch.tip ?? section.switch.label})}>${switchInput(section.switch)}</label>` : '';
  const head = `<div${attributes({class: 'ui-section-head', 'data-switch': Boolean(section.switch)})}>${toggle}${titleSwitch}${actions}</div>`;
  return `<section class="ui-section" data-section="${section.id}" data-collapsible${open ? ' data-open' : ''}${hooks}>${head}` +
    `<div class="ui-section-body" id="${body}"${open ? '' : ' hidden'}>${rows}</div></section>`;
}

// ---------------------------------------------------------------------------
// Scope line, quick actions slot, footer, and the whole inspector

/**
 * The scope line (revision 4): shown only while an edit reaches beyond the
 * selection ("Editing frames 22–28 · Stop"). Text, not chrome.
 */
export function renderScope(scope, env = {}) {
  if (!scope?.label) return '';
  const stop = scope.stop ? renderButton({variant: 'ghost', ...scope.stop, label: scope.stop.label ?? 'Stop'}, env, {size: 'sm'}) : '';
  return `<div class="ui-scope" id="inspector-scope" role="status"><span class="ui-dot" data-tint="select" aria-hidden="true"></span><span>${escapeHTML(scope.label)}</span>${stop}</div>`;
}

/**
 * The quick actions row's host under the target's name. quick-actions.mjs fills
 * it from the command registry (pins included), so the host is owned: an
 * inspector refresh never touches its buttons. Keyed by context, so moving to
 * another kind of selection replaces the row.
 */
export function renderQuickSlot(quick) {
  if (!quick?.context) return '';
  if (!SECTION_ID.test(quick.context)) throw new TypeError(`Invalid quick actions context: ${quick.context}`);
  return `<div${attributes({
    class: 'ui-quick', role: 'toolbar', 'aria-label': quick.label ?? 'Actions', 'data-quick-context': quick.context,
    'data-inspector-owned': `quick-${quick.context}`,
  })}></div>`;
}

/** The inspector's foot: one quiet row of commands for the whole context (the figure's "Add to library"). */
export function renderFooter(items, env = {}) {
  if (!items?.length) return '';
  return `<div class="inspector-foot" id="inspector-foot">${items.map(item => renderButton({variant: 'ghost', text: true, ...item}, env, {size: 'sm'})).join('')}</div>`;
}

/**
 * A whole context: scope line, quick actions slot, sections, foot. env: {ctx,
 * memory (SectionMemory), icon(name, className), t(key, params)}; the context
 * kind names the memory's bucket. Section ids must be unique.
 */
export function renderInspector(inspector, env = {}) {
  const kind = inspector?.kind ?? env.kind ?? 'default';
  if (!SECTION_ID.test(kind)) throw new TypeError(`Invalid inspector kind: ${kind}`);
  const seen = new Set();
  for (const section of inspector?.sections ?? []) {
    if (!section || section.hidden) continue;
    if (seen.has(section.id)) throw new TypeError(`Duplicate section id: ${section.id}`);
    seen.add(section.id);
  }
  const scoped = {...env, kind};
  return renderScope(inspector?.scope, scoped) + renderQuickSlot(inspector?.quick) +
    (inspector?.sections ?? []).map(section => renderSection(section, scoped)).join('') + renderFooter(inspector?.footer, scoped);
}

// ---------------------------------------------------------------------------
// The thin DOM half

/** Sets a titled section's open state in place (the next render emits the same state from the memory). */
export function setSectionOpen(toggle, open) {
  const section = toggle.closest('.ui-section');
  const body = toggle.ownerDocument.getElementById(toggle.getAttribute('aria-controls'));
  toggle.setAttribute('aria-expanded', String(open));
  section?.toggleAttribute('data-open', open);
  body?.toggleAttribute('hidden', !open);
}

/** Steps a stepper's input by one step within its limits, then reports it as a person's edit (input, change). */
function stepInput(button) {
  const host = button.closest('.ui-stepper, .ui-field[data-steps]');
  const input = host?.querySelector('input[type=number]');
  if (!input || input.disabled) return;
  const before = input.value, direction = Number(button.dataset.kitStep) < 0 ? -1 : 1;
  const step = Number(input.dataset.propertyStep) || (Number(input.step) > 0 ? Number(input.step) : 1);
  const min = input.min === '' ? -Infinity : Number(input.min), max = input.max === '' ? Infinity : Number(input.max);
  const current = Number(input.dataset.propertyValue ?? input.value) || 0;
  const next = Math.max(min, Math.min(max, current + direction * step));
  input.value = formatPropertyValue(next, Number(input.dataset.propertyPrecision ?? 3));
  if (input.value === before) return;
  const {Event} = input.ownerDocument.defaultView;
  input.dispatchEvent(new Event('input', {bubbles: true}));
  input.dispatchEvent(new Event('change', {bubbles: true}));
}

/** Keeps a slider's fill and readout with its value while it is dragged. */
function syncSlider(input) {
  input.style.setProperty('--_p', sliderFill(input.value, input.min === '' ? 0 : input.min, input.max === '' ? 100 : input.max));
  const text = formatValueWithUnit(input.value, {unit: input.dataset.unit ?? '', precision: Number(input.dataset.precision ?? 0)});
  input.setAttribute('aria-valuetext', text);
  const output = input.parentElement?.querySelector('.ui-slider-value');
  if (output && output.textContent !== text) output.textContent = text;
}

/**
 * Wires the kit's own behaviour on the inspector root: section toggles (the
 * memory, then onToggle({kind, id, open, auto})), plain stepper buttons,
 * slider readouts, and onScrubHint(text) once on the first focus of a
 * scrub-able field. Everything else stays with the
 * app's delegated handlers and PropertyControls. Returns {destroy}.
 */
export function installInspectorKit(root, {memory, onToggle, onScrubHint} = {}) {
  if (!root?.addEventListener) throw new TypeError('The inspector kit needs a root element.');
  const doc = root.ownerDocument, abort = new AbortController(), {signal} = abort;
  let hinted = typeof onScrubHint !== 'function';
  root.addEventListener('click', event => {
    const toggle = event.target.closest?.('.ui-section-toggle[data-section-toggle]');
    if (toggle && root.contains(toggle)) {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      setSectionOpen(toggle, open);
      const kind = toggle.dataset.sectionKind, id = toggle.dataset.sectionToggle, auto = toggle.hasAttribute('data-auto');
      memory?.toggle(kind, id, open, {auto});
      onToggle?.({kind, id, open, auto});
      return;
    }
    const step = event.target.closest?.('[data-kit-step]');
    if (step && root.contains(step) && !step.disabled) stepInput(step);
  }, {signal});
  // Capture on the document runs before PropertyControls' capture listener on
  // the root, which stops input events for the properties it handles.
  doc.addEventListener('input', event => {
    const input = event.target;
    if (input?.classList?.contains('ui-slider') && root.contains(input)) syncSlider(input);
  }, {capture: true, signal});
  root.addEventListener('focusin', event => {
    if (hinted) return;
    const row = event.target.closest?.('[data-property-row]');
    if (!row || !root.contains(row) || !row.querySelector('[data-property-scrub]')) return;
    hinted = true;
    onScrubHint(SCRUB_HINT);
  }, {signal});
  return {destroy: () => abort.abort()};
}
