/**
 * Browser test of the chrome kit on tests/fixtures/ui-chrome.html: the tool
 * options bar (src/ui/tool-options.mjs) measured, folded and keyboard-driven in
 * real layout, its More options popover, and the quick actions rows
 * (src/ui/quick-actions.mjs) over the command registry. Serve the repository
 * (node scripts/serve.mjs --port 47832) and run
 * `node tests/ui-chrome.browser.mjs`; STYK_URL overrides the address.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const base = `${process.env.STYK_URL || 'http://127.0.0.1:47832'}/tests/fixtures/ui-chrome.html`;
const browser = await chromium.launch({channel: 'chrome', headless: true});
const errors = [];
const step = async (name, run) => {
  try { await run(); console.log(`ok ${name}`); } catch (error) { console.log(`not ok ${name}`); throw error; }
};
const open = async theme => {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  page.on('pageerror', error => errors.push(`${theme}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${theme}: ${message.text()}`); });
  page.setDefaultTimeout(5000);
  await page.goto(`${base}?theme=${theme}`);
  await page.waitForFunction(() => window.fixture?.ready);
  // Two frames: the observers measure, then the plan applies.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page;
};
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
// Every shown control of a bar lies inside the bar: nothing is cut off at any width.
const clipped = (page, name) => page.evaluate(bar => {
  const element = fixture.bars[bar].element, box = element.getBoundingClientRect();
  return [...element.querySelectorAll('button, input, select, .ui-field-label, .ui-optbar-label')]
    .filter(control => control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden' && !control.closest('[data-overflowed]'))
    .filter(control => { const rect = control.getBoundingClientRect(); return rect.width > 1 && (rect.right > box.right + 0.5 || rect.left < box.left - 0.5); })
    .map(control => control.getAttribute('aria-label') || control.textContent.trim());
}, name);
const visible = (page, bar, option) => page.evaluate(([name, id]) => {
  const root = fixture.bars[name].element.querySelector(`[data-option="${id}"]`);
  return Boolean(root?.getClientRects().length) && !root.closest('[data-overflowed]');
}, [bar, option]);

try {
  const page = await open('light');

  await step('Brush folds in its declared order at three widths, and nothing is cut off', async () => {
    const folds = await page.evaluate(() => fixture.folds);
    assert.equal(folds['brush-wide'], undefined, '900px: everything shows, no fold reported');
    assert.deepEqual(folds['brush-medium'].twins, ['mirror-twin-brush'], '560px: Mirror is shown by its twin');
    assert.deepEqual(folds['brush-medium'].more, [], 'no More options while only twins and homes fold');
    assert.deepEqual(folds['brush-narrow'].more, ['flow', 'smooth']);
    assert.deepEqual(folds['brush-narrow'].homes.map(home => home.id), ['pressure', 'recent']);
    for (const bar of Object.keys(await page.evaluate(() => fixture.bars))) assert.deepEqual(await clipped(page, bar), [], `${bar} shows every control whole`);
    assert.equal(await visible(page, 'brush-narrow', 'size'), true);
    assert.equal(await visible(page, 'brush-narrow', 'flow'), false);
    assert.equal(await page.locator('[data-tool="brush-narrow"] .ui-optbar-more').isVisible(), true);
    assert.equal(await page.locator('[data-tool="brush-medium"] .ui-optbar-more').isVisible(), false);
  });

  await step('labels drop before anything folds and keep their accessible names', async () => {
    const narrow = await page.evaluate(() => fixture.folds['edit-joints-narrow']);
    assert.deepEqual(narrow.folded, [], 'the words go before Snapping would fold');
    assert.ok(narrow.dropped.includes('branch'), 'Whole branch shows its glyph first');
    if (narrow.dropped.includes('mode')) assert.ok(narrow.dropped.includes('snap'), '"Drag" goes after the toggles\' words');
    const branch = page.locator('[data-tool="edit-joints-narrow"] #builder-branch');
    assert.equal(await branch.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-tool="edit-joints-narrow"]').getByRole('button', {name: 'Whole branch', exact: true}).count(), 1,
      'the dropped word still names the button');
    const width = await branch.evaluate(element => element.getBoundingClientRect().width);
    assert.equal(width, 24, 'a labelled toggle without its word is a square glyph button');
  });

  await step('the bar refolds when its width changes', async () => {
    await page.evaluate(() => { fixture.bars['brush-wide'].element.closest('.stage-head').style.inlineSize = '380px'; });
    await settle(page);
    assert.deepEqual(await page.evaluate(() => fixture.folds['brush-wide'].more), ['flow', 'smooth']);
    await page.evaluate(() => { fixture.bars['brush-wide'].element.closest('.stage-head').style.inlineSize = '900px'; });
    await settle(page);
    assert.deepEqual(await page.evaluate(() => fixture.folds['brush-wide']), {dropped: [], folded: [], more: [], twins: [], homes: [], forced: []});
    assert.deepEqual(await clipped(page, 'brush-wide'), []);
  });

  await step('an item that grows (fonts, a translated label) is measured again without the owner asking', async () => {
    assert.deepEqual(await page.evaluate(() => fixture.folds['brush-medium'].more), []);
    await page.evaluate(() => fixture.bars['brush-medium'].element.querySelector('[data-option="size"]').style.setProperty('--_vch', '14'));
    await settle(page);
    await settle(page);
    assert.ok((await page.evaluate(() => fixture.folds['brush-medium'].more)).length > 0, 'the wider field pushes an option into More options');
    assert.deepEqual(await clipped(page, 'brush-medium'), []);
    await page.evaluate(() => fixture.bars['brush-medium'].element.querySelector('[data-option="size"]').style.setProperty('--_vch', '3'));
    await settle(page);
    await settle(page);
    assert.deepEqual(await page.evaluate(() => fixture.folds['brush-medium'].more), [], 'and back');
  });

  await step('More options shows the folded controls themselves, then puts them back', async () => {
    const more = page.locator('[data-tool="brush-narrow"] .ui-optbar-more');
    await more.click();
    const popover = page.locator('.ui-optbar-popover');
    await popover.waitFor();
    assert.equal(await more.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await popover.locator('input[data-property]').evaluateAll(inputs => inputs.map(input => input.dataset.property)),
      ['brushFlow', 'brushSmooth'], 'the same scrub fields, with their PropertyControls hooks');
    assert.equal(await popover.locator('input').first().evaluate(input => document.activeElement === input), true, 'focus moves into the popover');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.property), 'brushSmooth', 'every moved control is a tab stop');
    await page.keyboard.press('Escape');
    await popover.waitFor({state: 'hidden'});
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ui-optbar-more')), true, 'focus returns to More options');
    assert.equal(await visible(page, 'brush-narrow', 'flow'), false, 'back in the bar, still folded');
    assert.equal(await page.locator('[data-tool="brush-narrow"] [data-option="flow"]').count(), 1);
  });

  await step('the bar is one tab stop; arrows move along it and a field is entered by typing', async () => {
    const bar = page.locator('[data-tool="brush-wide"]');
    assert.equal(await bar.locator('[tabindex="0"]').count(), 1, 'one control is in the tab order');
    await bar.locator('.ui-optbar-pair').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Swap colors');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.property), 'brushSize');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.property), 'brushOpacity', 'an untouched field passes the arrows on');
    await page.keyboard.type('9');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.property), 'brushOpacity', 'typing enters the field: the arrows move the caret');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.property), 'brushSize', 'Escape hands the arrows back to the bar');
    await page.keyboard.press('End');
    assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /^Color #F5B400$/, 'End reaches the last control');
  });

  await step('controls with a command run through the app\'s delegation; the others report their value', async () => {
    await page.evaluate(() => { fixture.log.length = 0; fixture.changes.length = 0; });
    await page.locator('[data-tool="edit-joints"] #builder-branch').click();
    await page.locator('[data-tool="brush-wide"] [data-option-id="mirror-y"]').click();
    await page.locator('[data-tool="brush-wide"] [data-option-id="mirror-x"]').click();
    await page.locator('[data-tool="tweener"] [data-value="push"]').click();
    await page.locator('[data-tool="tweener"] [data-option-step="1"]').click();
    await page.locator('[data-tool="edit-joints"] #rig-mode').selectOption('branch');
    await page.locator('[data-tool="brush-wide"] [data-value="#0d99ff"]').click();
    assert.deepEqual(await page.evaluate(() => fixture.log), ['toggle-builder-branch', 'drawing-mirror']);
    assert.deepEqual(await page.evaluate(() => fixture.changes.map(({bar, id, value}) => [bar, id, value])), [
      ['brush-wide', 'mirror-y', true], ['tweener', 'blend', 'push'], ['tweener', 'steps', 4], ['edit-joints', 'mode', 'branch'], ['brush-wide', 'recent', '#0d99ff']]);
    assert.equal(await page.locator('[data-tool="brush-wide"] [data-option-id="mirror-y"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-tool="tweener"] [data-value="push"]').getAttribute('aria-checked'), 'true');
  });

  await step('update() writes state in place and keeps focus and contract ids', async () => {
    await page.locator('[data-tool="edit-joints"] #builder-snap').focus();
    const same = await page.evaluate(() => {
      const bar = fixture.bars['edit-joints'], before = bar.element.querySelector('#builder-snap');
      const descriptors = [
        {id: 'mode', kind: 'select', label: 'Drag', showLabel: true, labelFold: 3, elementId: 'rig-mode', value: 'branch',
          options: [{value: 'joint', label: 'Move joint'}, {value: 'branch', label: 'Rotate branch'}]},
        [{id: 'branch', kind: 'toggle', label: 'Whole branch', showLabel: true, accent: true, icon: 'builder-branch', pressed: false, labelFold: 1,
          elementId: 'builder-branch', command: 'toggle-builder-branch'},
        {id: 'snap', kind: 'toggle', label: 'Snapping', showLabel: true, icon: 'builder-snap', pressed: false, labelFold: 2, fold: 2, home: 'View › Build',
          elementId: 'builder-snap'}],
      ];
      bar.update(descriptors);
      return before === bar.element.querySelector('#builder-snap') && document.activeElement === before;
    });
    assert.equal(same, true);
    assert.equal(await page.locator('[data-tool="edit-joints"] #builder-snap').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('[data-tool="edit-joints"] #rig-mode').inputValue(), 'branch');
  });

  await step('quick actions: words where glyphs are ambiguous, Shift variants, pins and one tab stop', async () => {
    const row = page.getByRole('toolbar', {name: 'Figure actions'}).first();
    assert.deepEqual(await row.locator('button').evaluateAll(buttons => buttons.map(button => button.dataset.action)),
      ['mirror', 'layer-front', 'layer-back', 'duplicate', 'delete']);
    assert.deepEqual(await row.locator('button').evaluateAll(buttons => buttons.map(button => button.textContent.trim() || button.getAttribute('aria-label'))),
      ['Flip horizontally', 'To front', 'To back', 'Duplicate', 'Delete']);
    assert.equal(await row.locator('[data-action="layer-front"]').getAttribute('data-hotkey-hint'), 'Shift: one step');
    assert.equal(await row.locator('[data-action="mirror"]').getAttribute('aria-keyshortcuts'), 'Shift+H');
    await page.evaluate(() => { fixture.log.length = 0; });
    await row.locator('[data-action="layer-front"]').click({modifiers: ['Shift']});
    await row.locator('[data-action="layer-back"]').click();
    assert.deepEqual(await page.evaluate(() => fixture.log), ['layer-up', 'layer-back']);
    await row.locator('[data-action="mirror"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'layer-front');
    assert.equal(await row.locator('[tabindex="0"]').count(), 1);

    const pinned = page.getByRole('toolbar', {name: 'Figure actions'}).nth(1);
    const buttons = await pinned.locator('button').evaluateAll(list => list.map(button => [button.dataset.action, button.classList.contains('ui-quick-word')]));
    assert.deepEqual(buttons.slice(-2), [['reset-pose', false], ['rotate', true]], 'pins last; Rotate 15° draws like Reset pose, so it shows its word');
    assert.deepEqual(buttons.slice(0, -2).map(([action]) => action), ['mirror', 'layer-front', 'layer-back', 'duplicate', 'delete'].slice(0, buttons.length - 2),
      'the last defaults give up their places (they stay in the menu)');
    const displaced = await page.evaluate(() => fixture.rows.pinned.resolved.displaced);
    assert.ok(displaced.includes('delete') && displaced.length === 7 - buttons.length, `displaced ${displaced}`);
    const joint = page.getByRole('toolbar', {name: 'Joint actions'});
    assert.equal(await joint.getByRole('group', {name: 'Match'}).locator('button').count(), 2);
    assert.equal(await joint.locator('[data-action="toggle-isolate"]').getAttribute('aria-pressed'), 'true');
  });

  await step('the rows never wrap, scroll or cut a button, and refit when the inspector widens', async () => {
    const rows = () => page.locator('.ui-quick').evaluateAll(list => list.map(row => [Math.round(row.getBoundingClientRect().height), row.scrollWidth <= row.clientWidth]));
    for (const row of await rows()) assert.deepEqual(row, [28, true]);
    await page.evaluate(() => { document.getElementById('quick-rows').style.inlineSize = '400px'; });
    await settle(page);
    assert.deepEqual(await page.evaluate(() => fixture.rows.pinned.resolved.displaced), ['delete'], 'with room, only the second pin takes a default\'s place');
    for (const row of await rows()) assert.deepEqual(row, [28, true]);
  });

  await page.close();
  const dark = await open('dark');
  await step('the dark theme renders the same components without errors', async () => {
    assert.equal(await dark.evaluate(() => document.documentElement.dataset.theme), 'dark');
    for (const bar of Object.keys(await dark.evaluate(() => fixture.bars))) assert.deepEqual(await clipped(dark, bar), [], `${bar} in dark`);
    const pressed = await dark.locator('[data-tool="brush-wide"] [data-option="pressure"]').evaluate(button => getComputedStyle(button).backgroundColor);
    const quietOff = await dark.locator('[data-tool="brush-wide"] [data-option-id="mirror-x"]').evaluate(button => getComputedStyle(button).backgroundColor);
    assert.notEqual(pressed, quietOff, 'a quiet toggle that is on is a soft tile');
  });
  await dark.close();

  assert.deepEqual(errors, []);
  console.log('ui-chrome browser test passed');
} finally {
  await browser.close();
}
