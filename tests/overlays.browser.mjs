/**
 * Browser test of the overlay kit (src/ui/) on tests/fixtures/ui-overlays.html.
 * Serve the repository (node scripts/serve.mjs --port 47832) and run
 * `node tests/overlays.browser.mjs`; STYK_URL overrides the address.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const url = `${process.env.STYK_URL || 'http://127.0.0.1:47832'}/tests/fixtures/ui-overlays.html`;
const browser = await chromium.launch({channel: 'chrome', headless: true});
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.setDefaultTimeout(5000);

const log = () => page.evaluate(() => [...fixture.log]);
const clearLog = () => page.evaluate(() => { fixture.log.length = 0; });
const activeId = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.localName);
const settle = (ms = 60) => page.waitForTimeout(ms);
const hotkeysReachEditor = async () => {
  await clearLog();
  await page.evaluate(() => document.getElementById('fixture-stage').focus());
  await page.keyboard.press('h');
  return (await log()).includes('hotkey:tool-hand');
};
const step = async (name, run) => {
  try { await run(); console.log(`ok ${name}`); } catch (error) { console.log(`not ok ${name}`); throw error; }
};

try {
  await page.goto(url);
  await page.waitForFunction(() => window.fixture?.ready);

  await step('an open menu takes every key; Escape returns focus to its button', async () => {
    await page.click('[data-app-menu=file]');
    assert.equal(await page.evaluate(() => fixture.overlays.blocksHotkeys()), true);
    await clearLog();
    await page.keyboard.press('h');
    assert.ok(!(await log()).some(entry => entry.startsWith('hotkey')), 'H does not pick the Pan tool behind the File menu');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.appMenu), 'file');
    assert.equal(await page.locator('[data-app-menu=file]').getAttribute('aria-expanded'), 'false');
    assert.equal(await hotkeysReachEditor(), true);
  });

  await step('menu items are named by their label; shortcuts are aria-keyshortcuts; group labels name a group', async () => {
    await page.click('[data-app-menu=file]');
    const save = page.getByRole('menuitem', {name: 'Save', exact: true});
    assert.equal(await save.getAttribute('aria-keyshortcuts'), 'Control+S');
    assert.equal(await save.locator('kbd').textContent(), 'Ctrl+S');
    await page.keyboard.press('Escape');
    await page.click('[data-app-menu=view]');
    const canvas = page.getByRole('group', {name: 'Canvas'});
    assert.equal(await canvas.getByRole('menuitemcheckbox', {name: 'Joints', exact: true}).getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Escape');
  });

  await step('the #menu host gets back its own class and name after each menu', async () => {
    const state = await page.evaluate(async () => {
      const {openMenu} = await import('/src/ui/ui-menu.mjs');
      const host = document.getElementById('menu'), anchor = document.getElementById('open-menu-host');
      const timeline = openMenu({host, anchor, className: 'sheet-menu', label: 'Timeline', items: [{label: 'Insert key', run() {}}], overlays: fixture.overlays});
      const during = [host.className, host.getAttribute('aria-label'), anchor.getAttribute('aria-expanded'), anchor.getAttribute('aria-controls')];
      const plain = openMenu({host, anchor, items: [{label: 'Paste', run() {}}], overlays: fixture.overlays});
      const next = [host.className, host.getAttribute('aria-label'), timeline.isOpen];
      plain.close();
      return {during, next, after: [host.className, host.getAttribute('aria-label'), host.hidden, host.hasAttribute('data-side'), anchor.getAttribute('aria-expanded')]};
    });
    assert.deepEqual(state.during, ['menu ui-menu sheet-menu', 'Timeline', 'true', 'menu']);
    assert.deepEqual(state.next, ['menu ui-menu', null, false], 'no timeline class or name leaks into the next menu');
    assert.deepEqual(state.after, ['menu', null, true, false, 'false']);
  });

  await step('a context menu stays inside a 500 × 340 window, below the band', async () => {
    await page.setViewportSize({width: 500, height: 340});
    const box = await page.locator('#context-area').boundingBox();
    await page.mouse.click(Math.min(490, box.x + box.width - 12), Math.min(330, box.y + box.height - 12), {button: 'right'});
    const rect = await page.evaluate(() => ({...document.getElementById('menu').getBoundingClientRect().toJSON(),
      band: document.querySelector('.fixture-band').getBoundingClientRect().bottom}));
    assert.ok(rect.top >= rect.band + 6 - 0.5 && rect.bottom <= 340 && rect.left >= 0 && rect.right <= 500, JSON.stringify(rect));
    await page.keyboard.press('Escape');
    await page.setViewportSize({width: 1280, height: 720});
  });

  await step('closing a dialog closes the menu and manual popover inside it, and the hotkeys come back', async () => {
    for (const close of ['code', 'close-button']) {
      await page.click('#open-modal');
      await page.click('#modal-popover-button');
      await page.click('#modal-menu-button');
      const open = await page.evaluate(() => fixture.overlays.list().map(handle => handle.kind));
      assert.deepEqual(open, ['dialog', 'popover', 'menu'], `${close}: a dialog with a popover and a menu inside`);
      if (close === 'code') await page.evaluate(() => fixture.modal.close('done'));
      else {
        await page.keyboard.press('Escape');   // the menu first
        await page.click('dialog .ui-dialog-close');
      }
      await settle();
      assert.deepEqual(await page.evaluate(() => [fixture.overlays.list().length, fixture.overlays.blocksHotkeys()]), [0, false], close);
      assert.equal(await hotkeysReachEditor(), true, `${close}: H reaches the hotkeys`);
    }
  });

  await step('focus returns to the popover anchor after a dialog opened from inside the popover', async () => {
    await clearLog();
    await page.click('#open-popover');
    await page.click('#popover-rename');
    assert.equal(await page.evaluate(() => document.activeElement.closest('dialog')?.open), true);
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await activeId(), 'open-popover', 'not the hidden Rename button, and not the body');
    assert.deepEqual(await log(), ['popover-prompt:null']);
  });

  await step('a tooltip after one at the right edge is centred 6px above its button', async () => {
    await page.hover('#edge-tip');
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => document.getElementById('ui-tooltip').matches(':popover-open')), true);
    await page.hover('[data-command=undo]');
    await settle(120);
    const tip = await page.evaluate(() => {
      const element = document.getElementById('ui-tooltip'), button = document.querySelector('[data-command=undo]');
      const box = element.getBoundingClientRect(), anchor = button.getBoundingClientRect();
      const [label, dot, key] = [...element.children].map(child => child.getBoundingClientRect());
      return {text: element.textContent, dx: box.left + box.width / 2 - (anchor.left + anchor.width / 2), gap: anchor.top - box.bottom,
        spaced: dot.left - label.right > 2 && key.left - dot.right > 2, described: button.getAttribute('aria-describedby')};
    });
    assert.ok(Math.abs(tip.dx) <= 1, `centred (${tip.dx})`);
    assert.ok(Math.abs(tip.gap - 6) <= 1, `6px above (${tip.gap})`);
    assert.equal(tip.text, 'Undo·Ctrl+Z');
    assert.equal(tip.spaced, true, '"Undo · Ctrl+Z": the dot is spaced on both sides');
    assert.equal(tip.described, 'ui-tooltip');
    const restored = await page.evaluate(() => {
      const button = document.querySelector('[data-command=redo]');
      button.setAttribute('aria-describedby', 'redo-help');
      fixture.tooltips.show(button);
      fixture.tooltips.show(button);   // hovered, then focused
      const shown = button.getAttribute('aria-describedby');
      fixture.tooltips.hide();
      return [shown, button.getAttribute('aria-describedby')];
    });
    assert.deepEqual(restored, ['redo-help ui-tooltip', 'redo-help']);
    await page.mouse.move(5, 700);
  });

  await step('the palette is a modal dialog: Escape and a press outside close it', async () => {
    await page.evaluate(() => document.getElementById('fixture-stage').focus());
    await page.keyboard.press('Control+p');
    assert.deepEqual(await page.evaluate(() => [fixture.palette.element.matches(':modal'), document.activeElement.getAttribute('role')]), [true, 'combobox']);
    await clearLog();
    await page.keyboard.type('12');
    await page.keyboard.press('Enter');
    assert.deepEqual(await log(), ['frame:12']);
    await page.keyboard.press('Control+p');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => [fixture.palette.isOpen, document.activeElement.id]), [false, 'fixture-stage']);
    await page.keyboard.press('Control+p');
    await page.mouse.click(20, 700);
    await settle();
    assert.equal(await page.evaluate(() => fixture.palette.isOpen), false);
  });

  await step('messages are announced once from a live region, inside the modal when one is open', async () => {
    await page.click('#toast-error');
    await settle(150);
    const outside = await page.evaluate(() => ({
      roles: [...document.querySelectorAll('#toast .ui-toast')].map(node => node.getAttribute('role')),
      live: document.getElementById('toast').getAttribute('aria-live'),
      said: [...document.querySelectorAll('body > .ui-toast-live')].map(region => region.textContent),
    }));
    assert.deepEqual(outside, {roles: [null], live: null, said: ['', 'Could not open whoosh.wav, it is in use']});
    await page.evaluate(() => fixture.toasts.clear());
    await page.click('#toast-over-modal');
    await settle(150);
    assert.equal(await page.evaluate(() => document.querySelector('dialog.ui-dialog[open] > .ui-toast-live[aria-live=assertive]')?.textContent),
      'The encoder stopped', 'under a modal the rest of the page is inert: the dialog announces it');
    await page.keyboard.press('Escape');
    await page.evaluate(() => fixture.toasts.clear());
  });

  await step('clear({tones}) keeps other messages; task text survives being displaced; aborted signals end tasks', async () => {
    const state = await page.evaluate(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const {toasts} = fixture;
      toasts.show({message: 'Motion paths on'});
      toasts.clear({tones: ['info']});
      const cleared = document.getElementById('toast').hidden;
      const task = toasts.task({title: 'Copying 3 figures', delay: 0});
      await wait(30);
      const error = toasts.show({message: 'Disk full', tone: 'error'});
      task.update({title: 'Copying 2 figures'});
      error.dismiss();
      const text = document.querySelector('#toast .ui-toast-text')?.textContent;
      task.done();
      const aborted = new AbortController();
      aborted.abort();
      toasts.task({title: 'Never shown', delay: 0, signal: aborted.signal});
      await wait(30);
      return {cleared, text, never: document.getElementById('toast').textContent.includes('Never shown')};
    });
    assert.deepEqual(state, {cleared: true, text: 'Copying 2 figures', never: false});
  });

  await step('the #dialog compatibility instance: form, focus rule, Enter runs the primary, joins the stack', async () => {
    const state = await page.evaluate(async () => {
      const {showLegacyDialog} = await import('/src/ui/ui-dialog.mjs');
      const dialog = document.createElement('dialog'), content = document.createElement('div');
      dialog.id = 'dialog';
      content.id = 'dialog-content';
      dialog.append(content);
      document.body.append(dialog);
      showLegacyDialog('Rename', '<label>Name <input id="legacy-name" value="Bubble"></label><button class="primary">Rename</button><button data-action="undo">Undo</button>',
        {dialog, overlays: fixture.overlays, pointer: false});
      content.querySelector('.primary').addEventListener('click', () => fixture.log.push('legacy-primary'));
      return {focused: document.activeElement.id, close: content.querySelector('[data-action=close-dialog]').getAttribute('aria-label'),
        types: [...content.querySelectorAll('.dialog-body button')].map(button => button.type), stack: fixture.overlays.list().map(handle => handle.kind)};
    });
    assert.deepEqual(state, {focused: 'legacy-name', close: 'Close dialog', types: ['button', 'button'], stack: ['dialog']});
    await clearLog();
    await page.keyboard.press('Enter');
    await page.click('#dialog [data-action=undo]');
    assert.deepEqual(await log(), ['legacy-primary', 'undo'], 'Enter runs the primary; body buttons keep their data-action and never submit');
    assert.equal(await page.evaluate(() => document.getElementById('dialog').open), true);
    await page.evaluate(() => document.getElementById('dialog').close());
    await settle();
    assert.deepEqual(await page.evaluate(() => [fixture.overlays.list().length, fixture.overlays.blocksHotkeys()]), [0, false]);
    await page.evaluate(() => document.getElementById('dialog').remove());
  });

  await step('toolbar overflow leaves `hidden` to the owners and places controls they show or add', async () => {
    await page.setViewportSize({width: 700, height: 600});
    await settle(200);
    const overflowed = await page.evaluate(() => [...document.querySelectorAll('#toolbar [data-overflowed]')].map(button => button.dataset.action));
    assert.ok(overflowed.length > 0 && !overflowed.includes('undo'), JSON.stringify(overflowed));
    const owned = overflowed[0];
    await page.evaluate(action => { document.querySelector(`#toolbar [data-action="${action}"]`).hidden = true; }, owned);
    await page.setViewportSize({width: 1280, height: 720});
    await settle(200);
    const wide = await page.evaluate(action => ({hidden: document.querySelector(`#toolbar [data-action="${action}"]`).hidden,
      overflowed: document.querySelectorAll('#toolbar [data-overflowed]').length, more: document.getElementById('toolbar-more').hidden}), owned);
    assert.deepEqual(wide, {hidden: true, overflowed: 0, more: true}, 'a control its owner hid stays hidden when the toolbar widens');
    await page.evaluate(action => {
      const toolbar = document.getElementById('toolbar');
      toolbar.querySelector(`[data-action="${action}"]`).hidden = false;
      for (const label of ['Insert blank key', 'Insert copied key', 'Extend key', 'Delete frames']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.action = 'copy';
        button.className = 'added';
        button.textContent = label;
        toolbar.insertBefore(button, document.getElementById('toolbar-more'));
      }
    }, owned);
    await settle(200);
    const added = await page.evaluate(() => {
      const toolbar = document.getElementById('toolbar');
      return {fits: toolbar.scrollWidth <= toolbar.clientWidth + 1, more: !document.getElementById('toolbar-more').hidden};
    });
    assert.deepEqual(added, {fits: true, more: true}, 'controls added at the same width go to More instead of being clipped');
    await page.evaluate(() => { for (const button of document.querySelectorAll('#toolbar .added')) button.remove(); });
  });

  assert.deepEqual(errors, [], 'no page errors');
  console.log('overlays browser test passed');
} finally {
  await browser.close();
}
