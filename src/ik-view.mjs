import {renderInspector} from './inspector-kit.mjs';
import {legacyEnv} from './inspector-legacy.mjs';

/**
 * IK owns its section; dependent settings are nested beneath its master
 * switch, in #node-ik-options (rendered and hidden while IK is off, so the
 * switch's aria-controls keeps its target).
 */
export function ikSection(ik) {
  return {id: 'ik', legacy: {className: 'ik-settings', title: false, attrs: {'aria-label': 'Inverse kinematics'}}, rows: [
    {kind: 'switch', id: 'node-is-ik', label: 'IK', checked: ik.enabled, icon: 'nodes', tip: 'Inverse kinematics', controls: 'node-ik-options'},
    {kind: 'group', id: 'node-ik-options', hidden: !ik.enabled, legacy: {className: 'ik-options'}, rows: ik.enabled ? [
      {kind: 'group', legacy: {className: 'property-toggle-grid'}, rows: [
        {kind: 'switch', id: 'node-ik-pinned', label: 'Pinned', checked: ik.pinned, icon: 'pin'},
        {kind: 'switch', id: 'node-ik-stretch', label: 'Stretch', checked: ik.allowStretch, icon: 'stretch-horizontal', tip: 'Allow stretch'},
      ]},
      {kind: 'group', legacy: {className: 'ik-grid'}, rows: [
        {kind: 'number', id: 'node-ik-chain', label: 'Chain', description: 'IK chain length', value: ik.chainLength, min: 1, max: ik.maxLength, step: 1},
        {kind: 'number', id: 'node-ik-rotation', label: 'Rotation', description: 'IK target rotation', unit: '°', step: 1,
          value: Math.round(ik.target.rotation * 180 / Math.PI * 100) / 100},
      ]},
      {kind: 'segmented', mode: 'radio', name: 'node-ik-bend', label: 'Direction', description: 'IK bend direction', value: ik.bendDirection,
        options: [[-1, 'Left'], [0, 'Both'], [1, 'Right']].map(([value, label]) => ({value, label, description: `Bend ${label.toLowerCase()}`})),
        legacy: {className: 'ik-segments', rowClass: 'ik-bend-row'}},
    ] : []},
  ]};
}

/** The IK section's HTML (today's markup). */
export const ikControlsView = ik => renderInspector({kind: 'joint', sections: [ikSection(ik)]}, legacyEnv);
