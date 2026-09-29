// The touch interface (docs/TOUCH.md) in Chromium with touch emulation: the layouts
// of a phone and a tablet in both orientations, the gestures, the sheets and the
// modifiers, and the desktop interface unchanged at 1440×900.
//
//   node tests/touch.browser.mjs                      serve a fresh build of the site
//   STYK_URL=http://127.0.0.1:47831 node tests/...   test a running app instead
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from './support/playwright.mjs';
import { buildWeb } from '../scripts/build-web.mjs';
import { startWebServer } from '../scripts/serve-web.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'styk-touch-'));
const remote = process.env.STYK_URL;
const site = remote ? { origin: remote, close: async () => {} } : await startWebServer({ root: (await buildWeb({ output: path.join(temp, 'site') })).output });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [];
const check = (name, condition, detail) => { assert.ok(condition, detail ? `${name}: ${JSON.stringify(detail)}` : name); checks.push(name); console.log('PASS', name); };

/** Opens the editor at `size` with a finger (or a mouse) and the helpers the checks use. */
async function editor(size, { touch = true } = {}) {
  const [width, height] = size.split('x').map(Number);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/WebGPU/.test(message.text())) problems.push(message.text()); });
  await page.goto(site.origin, { waitUntil: 'load' });
  await page.waitForFunction(() => window.styk?.ready === true, undefined, { timeout: 60000 });
  await page.evaluate(() => { document.querySelector('.styk-privacy [data-decline]')?.click(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); window.styk.toasts?.clear?.(); });
  await page.waitForTimeout(300);
  const cdp = touch ? await context.newCDPSession(page) : null;
  const fingers = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const box = (selector) => page.evaluate((selector) => {
    const element = document.querySelector(selector);
    const rect = element?.getBoundingClientRect();
    return rect && rect.width ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 } : null;
  }, selector);
  const tap = async (x, y) => {
    if (typeof x === 'string') { const found = await box(x); assert.ok(found, `${x} is on screen`); ({ cx: x, cy: y } = found); }
    await fingers('touchStart', [[x, y]]); await fingers('touchEnd', []); await page.waitForTimeout(150);
  };
  const hold = async (x, y, ms = 750) => { await fingers('touchStart', [[x, y]]); await page.waitForTimeout(ms); await fingers('touchEnd', []); await page.waitForTimeout(200); };
  const drag = async (from, to, { steps = 10, before = 0 } = {}) => {
    await fingers('touchStart', [[from.x, from.y]]);
    if (before) await page.waitForTimeout(before);
    for (let step = 1; step <= steps; step++) { await fingers('touchMove', [[from.x + (to.x - from.x) * step / steps, from.y + (to.y - from.y) * step / steps]]); await page.waitForTimeout(16); }
    await fingers('touchEnd', []); await page.waitForTimeout(200);
  };
  /** Every shown button of the chrome that lies partly outside the window (never allowed). */
  const offscreen = () => page.evaluate(() => [...document.querySelectorAll('.titlebar button, .touch-tabbar button, .stage-head button, .timeline-toolbar button, .shell-rail button')]
    .filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
    .map((b) => ({ name: b.getAttribute('aria-label') || b.textContent.trim(), r: b.getBoundingClientRect() }))
    .filter(({ r, name }) => r.width && (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) && name)
    .map(({ name }) => name));
  /** The chrome's buttons smaller than `min` on either side. */
  const small = (min, selector) => page.evaluate(({ min, selector }) => [...document.querySelectorAll(selector)]
    .filter((b) => b.getClientRects().length).map((b) => ({ name: b.getAttribute('aria-label') || b.textContent.trim(), r: b.getBoundingClientRect() }))
    .filter(({ r }) => r.width && (r.width < min - 0.5 || r.height < min - 0.5)).map(({ name, r }) => `${name} ${Math.round(r.width)}×${Math.round(r.height)}`), { min, selector });
  const figure = () => page.evaluate(async () => {
    const { worldToScreen } = await import('/src/renderer.mjs');
    const { editor, state } = window.styk, rect = document.getElementById('overlay').getBoundingClientRect();
    editor.select(editor.frame.objects[0].unique_id, -1);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const g = editor.geometry.objects.get(editor.selectedSlot);
    const at = (p) => { const s = worldToScreen(p, { report: editor.report, frame: editor.frame, view: state.view, cameraEnabled: false }); return { x: rect.left + s.x, y: rect.top + s.y }; };
    return { root: at(g.root), joints: [...g.joints.values()].map(at) };
  });
  return { context, page, problems, box, tap, hold, drag, fingers, offscreen, small, figure, eval: (fn, arg) => page.evaluate(fn, arg) };
}

try {
  // ---- A phone held upright ----
  {
    const t = await editor('390x780');
    const root = await t.eval(() => ({ ...document.documentElement.dataset }));
    check('A coarse pointer turns the touch interface on by itself', root.input === 'touch' && root.touchLayout === 'phone-portrait', root);
    check('Upright, the workspaces and Properties sit in a tab bar under the thumb',
      await t.eval(() => Boolean(document.querySelector('.touch-tabbar > .workspace-switch') && document.querySelector('.touch-tabbar > .shell-sheet-button'))));
    check('Upright, nothing in the chrome is cut off by the window', (await t.offscreen()).length === 0, await t.offscreen());
    check('Upright, the band, the tab bar and the timeline header have finger-sized targets',
      (await t.small(40, '.titlebar button:not(.ui-menubar-item), .touch-tabbar button, .timeline-toolbar > [data-slot] button')).length === 0,
      await t.small(40, '.titlebar button:not(.ui-menubar-item), .touch-tabbar button, .timeline-toolbar > [data-slot] button'));
    check('Upright, the tools lie along the stage’s bottom edge', await t.eval(() => document.querySelector('.workspace').dataset.railOrientation === 'horizontal'));
    const stage = await t.box('#viewport'), timeline = await t.box('#animation-timeline');
    check('Upright, the timeline’s frames stay docked under the stage', timeline && timeline.y >= stage.y + stage.height - 1 && timeline.height > 150);
    check('Upright, the stage header folds its view toggles into one View menu', Boolean(await t.box('.stage-view-menu')) && !(await t.box('#handles-button')));

    await t.tap('.shell-sheet-button');
    const sheet = await t.box('.shell-sheet:popover-open');
    const tabbar = await t.box('.touch-tabbar');
    check('Properties rises as a bottom sheet above the tab bar', sheet && Math.round(sheet.x) === 0 && Math.abs(sheet.y + sheet.height - tabbar.y) <= 1, { sheet, tabbar });
    await t.drag({ x: 195, y: sheet.y + 12 }, { x: 195, y: sheet.y - 200 });
    const taller = await t.box('.shell-sheet:popover-open');
    check('Its grip drags it taller, to a resting height', taller && taller.height > sheet.height + 100, { taller, sheet });
    await t.drag({ x: 195, y: taller.y + 12 }, { x: 195, y: taller.y + taller.height - 30 });
    check('A swipe down closes it', !(await t.box('.shell-sheet:popover-open')));

    await t.tap('.shell-mark');
    check('A menu opens as a sheet from the bottom edge', await t.eval(() => document.querySelector('.ui-menu:popover-open')?.dataset.present === 'sheet'));
    const file = await t.eval(() => { const b = [...document.querySelectorAll('.ui-menu:popover-open .ui-menu-item')].find((item) => item.textContent.trim().startsWith('File'))?.getBoundingClientRect(); return b && { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await t.tap(file.x, file.y);
    check('A submenu leads back with a Back row', await t.eval(() => Boolean(document.querySelector('.ui-menu:popover-open .ui-menu-back'))));
    await t.page.keyboard.press('Escape');
    await t.page.keyboard.press('Escape');
    check('No console or page errors upright', t.problems.length === 0, t.problems);
    await t.context.close();
  }

  // ---- A phone on its side: gestures, modifiers, the timeline ----
  {
    const t = await editor('844x390');
    check('On its side, the band is a wing down the right edge', await t.eval(() => { const b = document.querySelector('.titlebar').getBoundingClientRect(); return b.height > b.width && b.right >= innerWidth - 1; }));
    check('On its side, nothing in the chrome is cut off by the window', (await t.offscreen()).length === 0, await t.offscreen());
    await t.tap('.shell-mark');
    const menu = await t.box('.ui-menu:popover-open'), mark = await t.box('.shell-mark');
    check('Menus from the wing open beside it, toward the stage', menu && menu.x + menu.width <= mark.x && menu.y < 120, { menu, mark });
    await t.page.keyboard.press('Escape');

    const undo = await t.box('[data-action="undo"]');
    await t.fingers('touchStart', [[undo.cx, undo.cy]]);
    await t.page.waitForTimeout(750);
    const tip = await t.eval(() => document.querySelector('#ui-tooltip:popover-open .ui-tooltip-label')?.textContent);
    await t.fingers('touchEnd', []);
    await t.page.waitForTimeout(200);
    check('Holding a button shows its name, and lifting the finger does not press it', tip === 'Undo' && !(await t.eval(() => window.styk.editor.canRedo)), tip);

    let { joints } = await t.figure();
    const hand = joints.at(-1);
    await t.drag(hand, { x: hand.x + 30, y: hand.y - 20 }, { steps: 8 });
    check('One finger poses a joint', await t.eval(() => window.styk.editor.canUndo));
    const spare = { x: hand.x - 160, y: hand.y };
    await t.fingers('touchStart', [[spare.x, spare.y], [spare.x + 60, spare.y]]); await t.page.waitForTimeout(60); await t.fingers('touchEnd', []); await t.page.waitForTimeout(300);
    check('A two-finger tap undoes', await t.eval(() => !window.styk.editor.canUndo && window.styk.editor.canRedo));
    await t.fingers('touchStart', [[spare.x, spare.y], [spare.x + 60, spare.y], [spare.x + 30, spare.y + 50]]); await t.page.waitForTimeout(60); await t.fingers('touchEnd', []); await t.page.waitForTimeout(300);
    check('A three-finger tap redoes', await t.eval(() => window.styk.editor.canUndo));

    await t.tap('.touch-modifiers-toggle');
    await t.tap('.touch-modifier[data-modifier="bend"]');
    check('The modifiers offer Bend, and a tap latches it', (await t.eval(() => window.styk.touchModifiers.active)).includes('bend'));
    ({ joints } = await t.figure());
    const elbow = joints[Math.floor(joints.length / 2)];
    await t.fingers('touchStart', [[elbow.x, elbow.y]]);
    for (let step = 1; step <= 8; step++) { await t.fingers('touchMove', [[elbow.x + step * 5, elbow.y + step * 2]]); await t.page.waitForTimeout(16); }
    const kind = await t.eval(() => window.styk.state.drag?.kind);
    await t.fingers('touchEnd', []);
    await t.page.waitForTimeout(200);
    check('With Bend on, a finger bends the joint (the right button’s drag)', kind === 'bend', kind);
    await t.tap('.touch-modifier[data-modifier="bend"]');

    ({ joints } = await t.figure());
    await t.hold(joints[0].x, joints[0].y, 800);
    check('Holding still on a figure opens its menu', await t.eval(() => [...document.querySelectorAll('.ui-menu:popover-open .ui-menu-item')].some((item) => /Copy/.test(item.textContent))));
    await t.page.keyboard.press('Escape');

    // The timeline's body opens as a sheet over the stage on a phone on its side.
    await t.eval(() => window.styk.shell.toggleTimelineSheet());
    await t.page.waitForTimeout(300);
    for (let i = 0; i < 6; i++) await t.eval(() => window.styk.actions?.['add-frame']?.() ?? document.querySelector('.tl-add').click());
    await t.eval(() => window.styk.timeline.setZoom(36));
    const grid = await t.eval(() => { const x = window.styk.timeline, b = x.scroll.getBoundingClientRect(); return { x: b.left, y: b.top + x.layout.contentTop + 14, width: b.width }; });
    const before = await t.eval(() => ({ left: window.styk.timeline._offsetX(), start: window.styk.timeline.start }));
    await t.drag({ x: grid.x + grid.width - 20, y: grid.y }, { x: grid.x + 20, y: grid.y });
    const after = await t.eval(() => ({ left: window.styk.timeline._offsetX(), start: window.styk.timeline.start }));
    check('A swipe scrolls the timeline and selects nothing', after.left > before.left + 100 && after.start === before.start, { before, after });
    await t.eval(() => window.styk.timeline._scrollToX(0));
    await t.tap(grid.x + 36 * 2 + 10, grid.y);
    check('A tap on a cell goes to its frame', await t.eval(() => window.styk.timeline.start === 2 && Math.floor(window.styk.editor.tick) === 2));
    await t.drag({ x: grid.x + 36 * 1 + 10, y: grid.y }, { x: grid.x + 36 * 4 + 10, y: grid.y }, { steps: 8, before: 650 });
    check('Press, hold and drag selects frames', await t.eval(() => window.styk.timeline.start === 1 && window.styk.timeline.end === 4));
    check('No console or page errors on its side', t.problems.length === 0, t.problems);
    await t.context.close();
  }

  // ---- Draw with a finger ----
  {
    const t = await editor('844x390');
    await t.tap('.workspace-switch [data-workspace-mode="draw"]');
    await t.page.waitForTimeout(1200);
    const stage = await t.box('#viewport');
    const view = await t.eval(() => ({ ...window.styk.state.view }));
    await t.drag({ x: stage.x + stage.width * 0.55, y: stage.y + stage.height * 0.4 }, { x: stage.x + stage.width * 0.7, y: stage.y + stage.height * 0.6 }, { steps: 12 });
    await t.page.waitForTimeout(800);
    check('In Draw a finger draws a stroke (until a pen is used)', await t.eval((view) => window.styk.editor.canUndo && window.styk.state.view.x === view.x, view));
    check('Draw offers its own modifiers', (await t.eval(() => [...document.querySelectorAll('.touch-modifier')].map((b) => b.dataset.modifier))).join() === 'line,pick,size');
    await t.context.close();
  }

  // ---- Tablets ----
  for (const size of ['1180x820', '820x1180']) {
    const t = await editor(size);
    const root = await t.eval(() => ({ ...document.documentElement.dataset }));
    check(`A ${size} tablet is laid out as a tablet`, root.form === 'tablet', root);
    check(`On a ${size} tablet nothing in the chrome is cut off`, (await t.offscreen()).length === 0, await t.offscreen());
    const docked = await t.eval(() => window.styk.shell.presentation('properties'));
    check(`On a ${size} tablet the inspector ${size === '1180x820' ? 'stays docked' : 'opens as a sheet'}`, docked === (size === '1180x820' ? 'docked' : 'sheet'), docked);
    check(`On a ${size} tablet targets are at least 40px`, (await t.small(40, '.titlebar button:not(.ui-menubar-item), .shell-rail .tool')).length === 0,
      await t.small(40, '.titlebar button:not(.ui-menubar-item), .shell-rail .tool'));
    await t.context.close();
  }

  // ---- The desktop interface is unchanged ----
  {
    const t = await editor('1440x900', { touch: false });
    const root = await t.eval(() => ({ ...document.documentElement.dataset }));
    check('A mouse keeps the desktop interface', root.input === 'pointer' && !root.touchLayout, root);
    check('The desktop has no tab bar, no modifier buttons and its menubar', await t.eval(() => !document.querySelector('.touch-tabbar')
      && document.querySelector('.touch-modifiers').hidden && getComputedStyle(document.querySelector('.app-menubar')).display !== 'none'));
    check('The desktop band keeps its words and its height', await t.eval(() => document.querySelector('.titlebar').getBoundingClientRect().height <= 53
      && document.querySelector('.band-export .band-label').getClientRects().length > 0));
    check('The desktop inspector is docked', await t.eval(() => window.styk.shell.presentation('properties') === 'docked'));
    await t.context.close();
  }

  // ---- ?ui= overrides the setting for one page load ----
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${site.origin}/?ui=touch`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.styk?.ready === true, undefined, { timeout: 60000 });
    check('?ui=touch turns the touch interface on with a mouse', await page.evaluate(() => document.documentElement.dataset.input === 'touch'));
    await context.close();
  }

  console.log(`\n${checks.length} checks passed`);
} finally {
  await browser.close();
  await site.close();
  await rm(temp, { recursive: true, force: true });
}
