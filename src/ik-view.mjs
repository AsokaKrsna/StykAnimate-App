import {propertyToggle} from './property-toggle.mjs';

/** IK owns its section; dependent settings are nested beneath its master toggle. */
export function ikControlsView(ik) {
  return `<section class="inspector-section ik-settings" aria-label="Inverse kinematics">${propertyToggle('node-is-ik', 'IK', ik.enabled, 'nodes', {title:'Inverse kinematics', controls:'node-ik-options'})}<div id="node-ik-options" class="ik-options" ${ik.enabled ? '' : 'hidden'}>${ik.enabled ?
    `<div class="property-toggle-grid">${propertyToggle('node-ik-pinned', 'Pinned', ik.pinned, 'pin')}${propertyToggle('node-ik-stretch', 'Stretch', ik.allowStretch, 'stretch-horizontal', {title:'Allow stretch'})}</div>` +
    `<div class="ik-grid"><label class="field"><span>Chain</span><input id="node-ik-chain" type="number" min="1" max="${ik.maxLength}" step="1" value="${ik.chainLength}" aria-label="IK chain length"></label>` +
    `<label class="field"><span>Rotation</span><input id="node-ik-rotation" type="number" step="1" value="${Math.round(ik.target.rotation * 180 / Math.PI * 100) / 100}" aria-label="IK target rotation"><small>°</small></label></div>` +
    `<div class="ik-bend-row"><span>Direction</span><div class="ik-segments" role="group" aria-label="IK bend direction">${[[-1, 'Left'], [0, 'Both'], [1, 'Right']].map(([value, label]) =>
      `<label><input type="radio" name="node-ik-bend" value="${value}" ${ik.bendDirection === value ? 'checked' : ''} aria-label="Bend ${label.toLowerCase()}"><span>${label}</span></label>`).join('')}</div></div>` : ''}</div></section>`;
}
