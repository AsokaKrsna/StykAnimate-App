/**
 * Browser test of the overlay kit (src/ui/): first on
 * tests/fixtures/ui-overlays.html, then wired into the app (app.mjs: the
 * menubar and every #menu menu, messages, the hotkey gate).
 * Serve the repository (node scripts/serve.mjs --port 47832) and run
 * `node tests/overlays.browser.mjs`; STYK_URL overrides the address.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.STYK_URL || 'http://127.0.0.1:47832';
const url = `${base}/tests/fixtures/ui-overlays.html`;
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

  await step('typeahead finds a row; Right opens a submenu on its first row; Left and Escape close only the submenu', async () => {
    const focused = () => page.evaluate(() => {
      const row = document.activeElement;
      return {label: row.querySelector(':scope > span')?.textContent ?? null, menu: row.closest('.ui-menu')?.getAttribute('aria-label') ?? null,
        expanded: row.getAttribute('aria-expanded')};
    });
    await page.click('[data-app-menu=edit]');
    await page.keyboard.press('p');
    assert.equal((await focused()).label, 'Paste');
    await page.keyboard.press('p');   // the same letter again cycles to the next row it starts
    assert.deepEqual(await focused(), {label: 'Paste special', menu: 'Edit', expanded: 'false'});
    await page.keyboard.press('ArrowRight');
    const inside = await focused();
    assert.equal(inside.menu, 'Paste special', 'focus moves to the submenu');
    assert.ok(inside.label, 'on its first row');
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await focused(), {label: 'Paste special', menu: 'Edit', expanded: 'false'});
    await page.keyboard.press('Enter');
    assert.equal((await focused()).menu, 'Paste special', 'Enter on a submenu row opens it');
    await page.keyboard.press('Escape');
    assert.deepEqual(await focused(), {label: 'Paste special', menu: 'Edit', expanded: 'false'}, 'Escape closes only the submenu');
    assert.equal(await page.locator('[data-app-menu=edit]').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.appMenu), 'edit');
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

  // ---------------------------------------------------------------------------
  // The app: the same kit wired into app.mjs.
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(`${base}/`);
  await page.waitForFunction(() => window.styk?.ready, null, {timeout: 60000});
  const menuOpen = () => page.evaluate(() => !document.getElementById('menu').hidden && document.getElementById('menu').matches(':popover-open'));
  const focusedLabel = () => page.evaluate(() => document.activeElement?.querySelector?.(':scope > span')?.textContent ?? null);
  const tool = () => page.evaluate(() => styk.state.tool);

  await step('app: letters typed into the open File menu never reach the tool hotkeys; typeahead, Left and Right, Escape', async () => {
    const before = await tool();
    await page.click('[data-app-menu=file]');
    assert.equal(await menuOpen(), true, 'the File menu renders into #menu');
    assert.equal(await page.evaluate(() => styk.ui.overlays.blocksHotkeys()), true);
    await page.keyboard.press('h');
    assert.equal(await tool(), before, 'H does not pick the Pan tool behind the File menu');
    await page.waitForTimeout(750);   // a new typeahead query
    await page.keyboard.press('s');
    assert.equal(await focusedLabel(), 'Save');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.querySelector('[data-app-menu][aria-expanded="true"]')?.dataset.appMenu), 'edit');
    assert.equal(await focusedLabel(), 'Undo');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => [document.getElementById('menu').hidden, document.activeElement.dataset.appMenu ?? null,
      styk.ui.overlays.blocksHotkeys()]), [true, 'edit', false], 'Escape closes the menu and returns focus to its button');
    await page.locator('#viewport').focus();
    await page.keyboard.press('h');
    assert.equal(await tool(), 'hand', 'with the menu closed, H picks the Pan tool again');
    await page.keyboard.press('v');
    assert.equal(await tool(), before);
  });

  await step('app: Space in an open menu runs the focused row and never arms the pan chord', async () => {
    await page.click('[data-app-menu=help]');
    assert.equal(await focusedLabel(), 'Keyboard shortcuts');
    await page.keyboard.down('Space');
    const held = await page.evaluate(() => [Boolean(styk.state.spaceHeld), Boolean(styk.state.space), document.querySelectorAll('dialog[open]').length]);
    await page.keyboard.up('Space');
    assert.deepEqual(held, [false, false, 1]);
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await page.evaluate(() => document.querySelectorAll('dialog[open]').length), 0);
  });

  await step('app: a message stays above a dialog that opens after it, and failures show as alerts that stay', async () => {
    await page.evaluate(() => styk.ui.toasts.show({message: 'Motion paths on', timeout: 30000}));
    const box = await page.locator('#toast .ui-toast').boundingBox();
    const clip = {x: box.x + 6, y: box.y + 6, width: box.width - 12, height: box.height - 12};
    const before = await page.screenshot({clip});
    await page.evaluate(() => styk.actions.performance());
    await page.waitForFunction(() => document.getElementById('dialog').open);
    await settle(150);
    assert.ok(before.equals(await page.screenshot({clip})), 'the dialog backdrop does not cover or dim the message');
    await page.evaluate(() => styk.ui.toasts.fail(new Error('The encoder stopped')));
    await settle(150);
    assert.deepEqual(await page.evaluate(() => ({
      text: document.querySelector('#toast .ui-toast-text')?.textContent, tone: document.querySelector('#toast .ui-toast')?.dataset.tone,
      said: document.querySelector('#dialog > .ui-toast-live[aria-live=assertive]')?.textContent,
    })), {text: 'The encoder stopped', tone: 'danger', said: 'The encoder stopped'}, 'an error takes the slot and is announced from inside the dialog');
    await page.keyboard.press('Escape');
    await settle();
    await page.evaluate(() => styk.ui.toasts.clear());
    // The app's own messages go through the same slot.
    await page.click('[data-workspace-mode=rig]');
    await page.evaluate(() => styk.actions.import());
    assert.equal(await page.locator('#toast .ui-toast-text').textContent(), 'Finish the figure or return to Animate to import figures.');
    await page.click('[data-workspace-mode=animate]');
    await page.waitForFunction(() => document.querySelector('.workspace').dataset.mode === 'animate');
    await page.evaluate(() => styk.ui.toasts.clear());
  });

  await step('app: a context menu opens above the pointer when there is more room there, and never under the band', async () => {
    await page.evaluate(() => { styk.state.view.y += 130; });   // bring the figure's feet near the bottom of the stage
    const joint = await page.evaluate(() => {
      const g = [...styk.editor.geometry.objects.values()][0], r = document.getElementById('viewport').getBoundingClientRect(), v = styk.state.view;
      return [...g.joints.values()].map(p => ({x: r.x + v.x + p.x * v.scale, y: r.y + v.y + p.y * v.scale})).sort((a, b) => b.y - a.y)[0];
    });
    const before = await tool();
    await page.mouse.click(joint.x, joint.y, {button: 'right'});
    const placed = await page.evaluate(() => ({menu: document.getElementById('menu').getBoundingClientRect().toJSON(), natural: document.getElementById('menu').scrollHeight,
      band: document.querySelector('.titlebar').getBoundingClientRect().bottom, height: innerHeight}));
    assert.ok(placed.height - 8 - joint.y < placed.natural, 'the menu does not fit below the pointer');
    assert.ok(placed.menu.bottom <= joint.y + 3 && placed.menu.top >= placed.band + 6 - 0.5, JSON.stringify({joint, ...placed}));
    await page.keyboard.press('h');
    assert.equal(await tool(), before, 'letters typed into a context menu never reach the tool hotkeys');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'viewport', 'Escape returns focus to the stage');
    await page.evaluate(() => styk.fit());

    await page.setViewportSize({width: 500, height: 340});
    await settle(200);
    // A point of the (tiny) stage that no floating control covers.
    const free = await page.evaluate(() => {
      const r = document.getElementById('viewport').getBoundingClientRect();
      for (let y = r.bottom - 4; y > r.top; y -= 4) for (let x = r.right - 4; x > r.left; x -= 8)
        if (document.elementFromPoint(x, y)?.id === 'overlay') return {x, y};
      return null;
    });
    assert.ok(free, 'part of the stage is free');
    await page.mouse.click(free.x, free.y, {button: 'right'});
    const small = await page.evaluate(() => ({...document.getElementById('menu').getBoundingClientRect().toJSON(),
      band: document.querySelector('.titlebar').getBoundingClientRect().bottom}));
    assert.ok(small.top >= small.band + 6 - 0.5 && small.bottom <= 340 && small.left >= 0 && small.right <= 500, JSON.stringify(small));
    await page.keyboard.press('Escape');
    await page.setViewportSize({width: 1440, height: 900});
    await settle(200);
  });

  await step('app: a menu opened from inside a dialog lives in it, and its rows can be clicked', async () => {
    await page.evaluate(() => styk.actions.performance());
    await page.evaluate(async () => {
      const {openMenu} = await import('/src/ui/ui-menu.mjs');
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'probe-menu-button';
      button.textContent = 'Options';
      document.querySelector('#dialog .dialog-body').append(button);
      button.addEventListener('click', () => openMenu({anchor: button, overlays: styk.ui.overlays, label: 'Options',
        items: [{label: 'Copy report', run: () => { window.probeMenuRan = true; }}]}));
    });
    await page.click('#probe-menu-button');
    assert.equal(await page.evaluate(() => document.querySelector('[role=menu][aria-label=Options]')?.closest('dialog')?.id), 'dialog');
    await page.getByRole('menuitem', {name: 'Copy report', exact: true}).click();
    assert.deepEqual(await page.evaluate(() => [window.probeMenuRan === true, document.getElementById('dialog').open, document.activeElement.id]),
      [true, true, 'probe-menu-button']);
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await page.evaluate(() => styk.ui.overlays.blocksHotkeys()), false);
  });

  await step('app: the Properties ⋯ button opens the selection menu; a second press closes it; Escape returns focus to it', async () => {
    await page.click('#object-actions');
    assert.equal(await menuOpen(), true, 'the click that opens the menu no longer closes it');
    assert.equal(await page.locator('#object-actions').getAttribute('aria-expanded'), 'true');
    const placed = await page.evaluate(() => ({menu: document.getElementById('menu').getBoundingClientRect().toJSON(),
      button: document.getElementById('object-actions').getBoundingClientRect().toJSON(), width: innerWidth}));
    assert.ok(placed.menu.top >= placed.button.bottom && placed.menu.right <= placed.width - 8 + 0.5, JSON.stringify(placed));
    await page.click('#object-actions');
    assert.equal(await menuOpen(), false, 'a second press closes it');
    assert.equal(await page.locator('#object-actions').getAttribute('aria-expanded'), 'false');
    await page.locator('#object-actions').focus();
    await page.keyboard.press('Enter');
    assert.equal(await menuOpen(), true);
    assert.equal(await focusedLabel(), 'Duplicate', 'the keyboard lands on the first row');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => [document.getElementById('menu').hidden, document.activeElement.id]), [true, 'object-actions']);
    const selected = () => page.evaluate(() => styk.editor.selectedUid);
    const before = await selected();
    await page.click('#object-actions');
    await page.click('#menu [data-action=duplicate]');
    const copy = await selected();
    assert.ok(copy !== null && copy !== before, 'its rows run their commands: the duplicate is selected');
    await page.locator('#viewport').focus();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(uid => !styk.editor.geometry.objects.has(uid) || styk.editor.selectedUid !== uid, copy, {timeout: 5000});
  });

  await step('app: the project name dialog starts in its field, Enter saves the name and Escape cancels', async () => {
    await page.click('.titlebar [data-action=rename]');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'rename-input', 'focus starts in the field, not on Close');
    await page.keyboard.type('Kick combo');   // the name is selected, so typing replaces it
    await page.keyboard.press('Enter');
    await settle();
    assert.deepEqual(await page.evaluate(() => [styk.editor.name, document.getElementById('project-name').textContent,
      document.querySelectorAll('dialog[open]').length, document.activeElement.dataset.action ?? null]), ['Kick combo', 'Kick combo', 0, 'rename']);
    await page.click('.titlebar [data-action=rename]');
    await page.keyboard.type('Something else');
    await page.keyboard.press('Escape');
    await settle();
    assert.deepEqual(await page.evaluate(() => [styk.editor.name, document.querySelectorAll('dialog[open]').length]), ['Kick combo', 0]);
  });

  await step('app: "Save your changes?" starts on Save project, without a ring after a pointer and with one after a key; Escape keeps editing', async () => {
    await page.evaluate(() => { styk.editor.dirty = true; });
    const focus = () => page.evaluate(() => [document.activeElement.id, document.activeElement.matches(':focus-visible')]);
    await page.click('[data-app-menu=file]');
    await page.click('#menu [data-action=new]');
    await page.locator('#save-changes').waitFor();
    assert.deepEqual(await focus(), ['save-changes', false], 'opened by a pointer: focused without the ring');
    await page.keyboard.press('Escape');
    await settle();
    assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('dialog[open]').length, styk.editor.dirty, styk.editor.name]), [0, true, 'Kick combo']);
    await page.locator('#viewport').focus();
    await page.keyboard.press('Control+n');
    await page.locator('#save-changes').waitFor();
    assert.deepEqual(await focus(), ['save-changes', true], 'opened from the keyboard: the ring shows');
    await page.keyboard.press('Escape');
    await settle();
    assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('dialog[open]').length, styk.editor.name, styk.ui.overlays.blocksHotkeys()]),
      [0, 'Kick combo', false]);
  });

  await step('app: a tooltip names the control and shows its shortcut from the registry, with no native title beside it', async () => {
    const tip = () => page.evaluate(() => {
      const element = document.getElementById('ui-tooltip');
      return element.matches(':popover-open') ? element.textContent : null;
    });
    const undo = page.locator('[data-action=undo]:visible').first();
    assert.deepEqual(await undo.evaluate(button => [button.getAttribute('title'), button.dataset.hotkeyTitle, button.dataset.hotkeyHint,
      button.getAttribute('aria-keyshortcuts')]), [null, 'Undo', 'Ctrl+Z', 'Control+Z']);
    assert.ok(await page.getByRole('button', {name: 'Undo', exact: true}).count() >= 1, 'the accessible name has no shortcut');
    await undo.hover();
    await page.waitForFunction(() => document.getElementById('ui-tooltip').matches(':popover-open'));
    assert.equal(await tip(), 'Undo·Ctrl+Z');
    assert.equal(await undo.getAttribute('aria-describedby'), 'ui-tooltip');
    // A control that took its name from its old title keeps that name, without the shortcut.
    assert.equal(await page.locator('[data-action=previous-frame]:visible').first().getAttribute('aria-label'), 'Previous frame');
    await page.mouse.move(700, 450);
    await settle(100);
    assert.equal(await tip(), null, 'it hides when the pointer leaves');

    // A rebinding shows at once; the tooltip reads the user's bindings, not text.
    await page.evaluate(() => styk.settingsUI.commit({hotkeys: {...styk.hotkeys.bindings, undo: ['Mod+KeyU']}}));
    assert.equal(await undo.getAttribute('data-hotkey-hint'), 'Ctrl+U');
    await page.evaluate(() => styk.ui.tooltips.show(document.querySelector('[data-action=undo]')));
    assert.equal(await tip(), 'Undo·Ctrl+U');
    await page.evaluate(() => { styk.ui.tooltips.hide(); styk.settingsUI.commit({hotkeys: undefined}); });
    assert.equal(await undo.getAttribute('data-hotkey-hint'), 'Ctrl+Z');

    // A workspace that claims a key takes it off the general command: M flips the view in Draw.
    await page.evaluate(() => styk.ui.tooltips.show(document.getElementById('paths-button')));
    assert.equal(await tip(), 'Motion paths·M');
    await page.click('[data-workspace-mode=draw]');
    await page.waitForFunction(() => document.querySelector('.workspace').dataset.mode === 'draw');
    await page.evaluate(() => styk.ui.tooltips.show(document.getElementById('paths-button')));
    assert.equal(await tip(), 'Motion paths');
    await page.evaluate(() => styk.ui.tooltips.show(document.querySelector('[data-tool=drawing-brush]')));
    assert.equal(await tip(), 'Brush·B', 'drawing tools show their shortcut from the bindings, not from their markup');
    await page.evaluate(() => styk.ui.tooltips.hide());
    await page.click('[data-workspace-mode=animate]');
    await page.waitForFunction(() => document.querySelector('.workspace').dataset.mode === 'animate');

    // Markup that still carries a native title keeps it, and gets no second tooltip.
    assert.equal(await page.evaluate(() => {
      const legacy = document.querySelector('[data-action=scene-settings][title]');
      styk.ui.tooltips.show(legacy);
      return [legacy.title, document.getElementById('ui-tooltip').matches(':popover-open')].join('|');
    }), 'Scene properties|false');
  });

  assert.deepEqual(errors, [], 'no page errors');
  console.log('overlays browser test passed');
} finally {
  await browser.close();
}
