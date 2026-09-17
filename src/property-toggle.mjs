import {icon} from './icons.mjs';

/** Native, keyboard-operable toggles with a full-row pointer target.
 * Labels and attributes are supplied by the inspector, never document data. */
export function propertyToggle(id, label, checked, symbol, {title = label, controls, attrs = ''} = {}) {
  return `<label class="property-toggle" title="${title}"><input type="checkbox" role="switch" id="${id}" aria-label="${label}" ${checked ? 'checked' : ''}${controls ? ` aria-controls="${controls}"` : ''}${attrs ? ` ${attrs}` : ''}><span class="property-toggle-label">${icon(symbol)}<span>${label}</span>${controls ? `<span class="property-toggle-disclosure" aria-hidden="true">${icon('chevron-right')}</span>` : ''}</span><span class="property-toggle-track" aria-hidden="true"></span></label>`;
}
