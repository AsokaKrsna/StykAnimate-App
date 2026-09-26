import test from 'node:test';
import assert from 'node:assert/strict';
import {computeOverflow, overflowMenuItems} from '../src/ui/toolbar-overflow.mjs';

const row = (...widths) => widths.map(width => (typeof width === 'number' ? {width} : width));

test('everything stays when the row fits, including the exact width', () => {
  assert.deepEqual(computeOverflow({items: row(40, 40, 40), available: 136, gap: 8, moreWidth: 28}),
    {visible: [0, 1, 2], overflow: [], width: 136, fits: true});
});

test('items leave from the end, and the More button takes its room and a gap', () => {
  // 3 × 40 + 2 × 8 = 136 > 120. Hiding the last leaves 40 + 8 + 40 + 8 + 28 = 124 > 120, so two go.
  const result = computeOverflow({items: row(40, 40, 40), available: 120, gap: 8, moreWidth: 28});
  assert.deepEqual(result, {visible: [0], overflow: [1, 2], width: 76, fits: true});
});

test('the lowest priority leaves first; pinned items never leave', () => {
  const items = row({width: 50, pinned: true}, {width: 50, priority: 2}, {width: 50, priority: 0}, {width: 50, priority: 1});
  assert.deepEqual(computeOverflow({items, available: 170, gap: 0, moreWidth: 20}).overflow, [2], 'priority 0 goes before the later priority 1');
  assert.deepEqual(computeOverflow({items, available: 125, gap: 0, moreWidth: 20}).overflow, [2, 3]);
  const tight = computeOverflow({items, available: 10, gap: 0, moreWidth: 20});
  assert.deepEqual([tight.visible, tight.fits], [[0], false], 'a pinned item stays even when nothing fits');
});

test('the overflow list keeps visual order for the More menu', () => {
  const items = row({width: 30, priority: 1}, {width: 30}, {width: 30, priority: 2}, {width: 30});
  assert.deepEqual(computeOverflow({items, available: 60, moreWidth: 30}).overflow, [0, 1, 3]);
  assert.deepEqual(computeOverflow({items: [], available: 0}), {visible: [], overflow: [], width: 0, fits: true});
});

test('overflowed controls become menu items that click the original control', () => {
  const events = [];
  globalThis.MouseEvent ??= class MouseEvent { constructor(type, init) { Object.assign(this, {type}, init); } };
  const control = (attributes, text = '') => ({
    textContent: text, disabled: false, dataset: {},
    getAttribute: name => attributes[name] ?? null,
    dispatchEvent: event => events.push([attributes['aria-label'] ?? text, event.type, event.shiftKey]),
  });
  const [onion, loop, audio] = overflowMenuItems([control({'aria-label': 'Onion skin', 'aria-pressed': 'true'}), control({'aria-pressed': 'false'}, ' Loop '),
    control({'aria-label': 'Audio', 'aria-disabled': 'true'})]);
  assert.deepEqual([onion.label, onion.checked, onion.disabled], ['Onion skin', true, false]);
  assert.deepEqual([loop.label, loop.checked], ['Loop', false]);
  assert.deepEqual([audio.disabled, 'checked' in audio], [true, false]);
  onion.run({shiftKey: true});
  assert.deepEqual(events, [['Onion skin', 'click', true]], 'modifiers pass through to the original control');
});
