import {renderInspector} from './inspector-kit.mjs';

/**
 * The joint's IK section: Use IK, and while it is on its options in
 * #node-ik-options (rendered and hidden while IK is off, so the switch's
 * aria-controls keeps its target): the pin and stretch switches, the chain
 * stepper, the bend direction (native radios, whose change handler sets it)
 * and the target's rotation.
 */
export function ikSection(ik) {
  return {id: 'ik', title: 'IK', rows: [
    {kind: 'grid', rows: [
      {kind: 'field-switch', id: 'node-is-ik', label: 'Use IK', tip: 'Drag the joint to move its whole chain', checked: ik.enabled, controls: 'node-ik-options'},
    ]},
    {kind: 'group', id: 'node-ik-options', label: 'IK options', hidden: !ik.enabled, rows: ik.enabled ? [
      {kind: 'grid', rows: [
        {kind: 'field-switch', id: 'node-ik-pinned', label: 'Pinned', checked: ik.pinned, tip: 'Keep the joint where it is when the body moves'},
        {kind: 'field-switch', id: 'node-ik-stretch', label: 'Stretch', checked: ik.allowStretch, tip: 'Allow stretch'},
      ]},
      {kind: 'stepper', id: 'node-ik-chain', label: 'Chain', description: 'IK chain length', value: ik.chainLength, min: 1, max: ik.maxLength, step: 1,
        down: {label: 'Shorter chain'}, up: {label: 'Longer chain'}},
      {kind: 'segmented', mode: 'radio', name: 'node-ik-bend', label: 'Direction', description: 'IK bend direction', value: ik.bendDirection,
        options: [[-1, 'Left'], [0, 'Both'], [1, 'Right']].map(([value, label]) => ({value, label, description: `Bend ${label.toLowerCase()}`}))},
      {kind: 'grid', rows: [
        {kind: 'number', id: 'node-ik-rotation', label: 'Rotation', description: 'IK target rotation', unit: '°', step: 1, precision: 2,
          value: Math.round(ik.target.rotation * 180 / Math.PI * 100) / 100},
      ]},
    ] : []},
  ]};
}

/** The IK section's HTML, as the inspector renders it. */
export const ikControlsView = ik => renderInspector({kind: 'joint', sections: [ikSection(ik)]});
