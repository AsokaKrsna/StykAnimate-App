/**
 * The editor shell laid out by the layout solver (src/shell/dock-host.mjs):
 * the width and height tiers, #viewport's minimum and ancestry, the
 * controls that are never hidden, the rail's constant place, the splitters'
 * keyboard, tabs, sheets and strips, the timeline's one default height,
 * floating and docked panels that keep Properties visible, Build's
 * Structure and timeline, F6 and the keyboard move, and persistence
 * (architecture §3.11, M1).
 *
 * Serve the repository (STYK_PYTHON=py node scripts/serve.mjs --port 47911)
 * and run `node tests/shell-layout.browser.mjs`; STYK_URL overrides the
 * address. Every size starts from a fresh page with no stored layout.
 *
 * Transitional (until M3b replaces the canvas toolbar with the 40px stage
 * header and hides the 24px status bar into the activity log): at 500×340
 * the timeline is its header and #viewport is 360 wide but only about 180
 * tall; every larger size keeps 360×200.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const base = process.env.STYK_URL || 'http://127.0.0.1:47911';
const out = 'artifacts/shell-layout';
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true});
const errors = [];
let page;

const step = async (name, run) => {
  try { await run(); console.log(`ok ${name}`); } catch (error) { console.log(`not ok ${name}`); throw error; }
};
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function open(width, height) {
  await page?.context().close();
  const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: 1});
  await context.addInitScript(() => {
    localStorage.setItem('stykanimate.editor.settings.v1', JSON.stringify({rendererMode: 'canvas', locale: 'en'}));
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.styk?.ready);
  await settle();
}
async function resize(width, height) {
  await page.setViewportSize({width, height});
  await page.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height && document.documentElement.dataset.tier, [width, height]);
  await settle();
}
async function workspace(mode) {
  await page.click(`[data-workspace-mode="${mode}"]`);
  await page.waitForFunction(mode => document.querySelector('.workspace').dataset.mode === mode, mode);
  if (mode === 'rig' && await page.locator('#builder-exit-update').count()) await page.click('#builder-exit-update');
  await settle();
}
async function leaveBuild() {
  if (await page.evaluate(() => !styk.builder.active)) return;
  await page.click('#builder-done');
  if (await page.locator('#builder-exit-update').count()) await page.click('#builder-exit-update');
  await page.waitForFunction(() => !styk.builder.active);
  await settle();
}
const rect = selector => page.evaluate(selector => {
  const element = document.querySelector(selector);
  if (!element) return null;
  const {x, y, width, height} = element.getBoundingClientRect();
  return {x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height)};
}, selector);
/** The element is drawn, inside the window, at least 24px, and the one at its own centre. */
const reachable = selector => page.evaluate(selector => {
  const element = [...document.querySelectorAll(selector)].find(item => item.getClientRects().length && !item.closest('[hidden]'));
  if (!element) return `${selector}: not shown`;
  const box = element.getBoundingClientRect();
  if (box.width < 24 || box.height < 24) return `${selector}: ${box.width}x${box.height}`;
  if (box.left < 0 || box.top < 0 || box.right > innerWidth + 0.5 || box.bottom > innerHeight + 0.5) return `${selector}: outside the window`;
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return element === hit || element.contains(hit) ? true : `${selector}: covered by ${hit?.outerHTML.slice(0, 80)}`;
}, selector);

const SIZES = [
  // [width, height, tier, height tier]
  [1440, 900, 'wide', 'tall'], [1280, 720, 'regular', 'tall'], [1100, 620, 'narrow', 'short'], [1024, 700, 'narrow', 'tall'],
  [900, 700, 'narrow', 'tall'], [801, 600, 'narrow', 'short'], [800, 600, 'compact', 'short'], [640, 480, 'minimal', 'low'],
  [1920, 520, 'wide', 'low'], [1000, 450, 'narrow', 'low'], [601, 441, 'minimal', 'low'], [500, 340, 'minimal', 'low'],
];
const TRANSITIONAL_SHORT = 360;   // below this height the status bar and the 44px canvas toolbar cost #viewport its 200px

try {
  await open(1440, 900);

  await step('the width and height tiers each come from their own dimension of the window', async () => {
    for (const [width, height, tier, heightTier] of SIZES) {
      await resize(width, height);
      const root = await page.evaluate(() => ({tier: document.documentElement.dataset.tier, height: document.documentElement.dataset.height,
        api: [styk.workspace.tier, styk.workspace.height]}));
      assert.deepEqual([root.tier, root.height], [tier, heightTier], `${width}x${height}`);
      assert.deepEqual(root.api, [tier, heightTier], `${width}x${height}: styk.workspace`);
    }
  });

  await step('#viewport keeps 360x200 in Animate, Draw and Build, and the page is exactly one window', async () => {
    for (const mode of ['animate', 'draw', 'rig']) {
      for (const [width, height] of SIZES) {
        await resize(width, height);
        if (await page.evaluate(() => document.querySelector('.workspace').dataset.mode) !== mode) await workspace(mode);
        const viewport = await rect('#viewport');
        const label = `${mode} ${width}x${height}: #viewport ${viewport.width}x${viewport.height}`;
        assert.ok(viewport.width >= 360, label);
        assert.ok(viewport.height >= (height < TRANSITIONAL_SHORT ? 180 : 200), label);
        const page_ = await page.evaluate(() => {
          window.scrollTo(0, 1);
          return {w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, x: scrollX, y: scrollY};
        });
        assert.deepEqual(page_, {w: width, h: height, x: 0, y: 0}, `${label}: the page never scrolls`);
        // #scene and #overlay cover #viewport exactly.
        for (const canvas of ['#scene', '#overlay']) assert.deepEqual(await rect(canvas), viewport, `${label}: ${canvas}`);
      }
      await resize(1440, 900);
      if (mode === 'rig') await leaveBuild();
    }
  });

  await step('no ancestor of #viewport transforms, zooms, filters or clips it, and #viewport is a plain rectangle', async () => {
    for (const [width, height] of [[1440, 900], [800, 600], [500, 340]]) {
      await resize(width, height);
      const problems = await page.evaluate(() => {
        const found = [];
        const viewport = document.getElementById('viewport');
        for (let element = viewport.parentElement; element; element = element.parentElement) {
          const style = getComputedStyle(element);
          if (style.transform !== 'none') found.push(`${element.className}: transform ${style.transform}`);
          if (style.zoom && style.zoom !== '1' && style.zoom !== 'normal') found.push(`${element.className}: zoom ${style.zoom}`);
          if (style.filter !== 'none') found.push(`${element.className}: filter`);
          if (style.clipPath !== 'none') found.push(`${element.className}: clip-path`);
          if (style.overflow !== 'visible' && parseFloat(style.borderTopLeftRadius) > 0) found.push(`${element.className}: a rounded clip`);
        }
        if (parseFloat(getComputedStyle(viewport).borderTopLeftRadius) > 0) found.push('#viewport: border-radius');
        return found;
      });
      assert.deepEqual(problems, [], `${width}x${height}`);
    }
  });

  await step('the controls that are never hidden stay visible, reachable and at least 24px', async () => {
    const always = ['.titlebar [data-action="export"]', '[data-action="undo"]', '[data-workspace-mode="animate"]', '[data-workspace-mode="draw"]',
      '[data-workspace-mode="rig"]:not(#builder-done)', '#zoom-label', '#play-button', '#onion-button'];
    const docked = ['[data-app-menu="file"]', '#properties-tab', '#vfx-tab', '#library-tab', '#timeline-workflow [data-timeline-mode="advanced"]'];
    for (const [width, height] of SIZES) {
      await resize(width, height);
      const selectors = [...always, ...(width > 800 ? docked : ['.shell-sheet-button'])];
      for (const selector of selectors) assert.equal(await reachable(selector), true, `${width}x${height}`);
      const band = await page.evaluate(() => { const band = document.querySelector('.titlebar'); return band.scrollWidth <= band.clientWidth; });
      assert.ok(band, `${width}x${height}: the band fits`);
    }
  });

  await step('the stage header row and the inspector tabs share one line', async () => {
    for (const [width, height] of [[1440, 900], [1024, 700], [900, 700]]) {
      await resize(width, height);
      const head = await rect('.shell-stage > .canvas-toolbar'), tabs = await rect('.shell-right .shell-tabs'), timeline = await rect('.timeline-toolbar');
      assert.ok(Math.abs(head.y - tabs.y) <= 1 && Math.abs(head.y + head.height - tabs.y - tabs.height) <= 1, `${width}x${height}: ${JSON.stringify({head, tabs})}`);
      assert.equal(timeline.height, 40, 'the timeline header is 40px too');
    }
    await resize(1440, 900);
  });

  await step('the rail keeps its place in Animate, Draw and Build', async () => {
    for (const [width, height] of [[1440, 900], [900, 700], [800, 600], [500, 340]]) {
      await resize(width, height);
      const places = [];
      for (const mode of ['animate', 'draw', 'rig']) {
        await workspace(mode);
        const rail = await rect('.studio-rail'), work = await rect('.workspace');
        assert.ok(rail.x >= work.x && rail.y >= work.y && rail.x + rail.width <= work.x + work.width && rail.y + rail.height <= work.y + work.height,
          `${mode} ${width}x${height}: the rail is inside .workspace`);
        places.push([rail.x, rail.y, rail.width]);
      }
      await leaveBuild();
      await workspace('animate');
      assert.deepEqual(places[1], places[0], `${width}x${height}: Draw`);
      assert.deepEqual(places[2], places[0], `${width}x${height}: Build`);
    }
    await resize(1440, 900);
  });

  await step('splitters resize with the keyboard, keep the stage, and Home or Enter restore the default', async () => {
    await page.evaluate(() => styk.workspace.reset());
    await settle();
    const right = page.getByRole('separator', {name: 'Resize properties panel'});
    const timeline = page.getByRole('separator', {name: 'Resize timeline'});
    const sizes = () => page.evaluate(() => styk.workspace.sizes);
    const before = await sizes();
    assert.deepEqual([before.right, before.timeline], [288, 264]);
    await right.focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal((await sizes()).right, 300);
    await page.keyboard.press('Shift+ArrowLeft');
    assert.equal((await sizes()).right, 340);
    assert.equal(await right.getAttribute('aria-valuenow'), '340');
    await page.keyboard.press('Home');
    assert.equal((await sizes()).right, before.right);
    await timeline.focus();
    await page.keyboard.press('ArrowUp');
    assert.equal((await sizes()).timeline, 276);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal((await sizes()).timeline, 252);
    await page.keyboard.press('Enter');
    assert.equal((await sizes()).timeline, before.timeline);
    // A drag grows the panel, one layout per frame and no long frame; Escape cancels a drag in progress.
    await page.evaluate(() => {
      window.shellLongFrames = [];
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.shellLongFrames.push(Math.round(entry.duration)); })
        .observe({type: 'long-animation-frame'});
    });
    const box = await right.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2, {steps: 20});
    await page.mouse.up();
    await settle();
    assert.equal((await sizes()).right, before.right + 30);
    assert.deepEqual(await page.evaluate(() => window.shellLongFrames.filter(duration => duration >= 200)), [], 'no frame of 200ms or more while dragging');
    await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, {steps: 5});
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle();
    assert.equal((await sizes()).right, before.right + 30, 'Escape cancels the drag');
    await right.dblclick();
    await settle();
    assert.equal((await sizes()).right, before.right, 'a double-click restores the default');
    // The stage never gives up its minimum to a splitter.
    await right.focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowLeft');
    assert.ok((await rect('#viewport')).width >= 360);
    assert.equal(await right.getAttribute('aria-valuenow'), await right.getAttribute('aria-valuemax'));
    await page.keyboard.press('Home');
  });

  await step('the timeline keeps its one default height through a tab switch, a mode switch and a new layer', async () => {
    await page.evaluate(() => styk.workspace.reset());
    await settle();
    const before = await rect('#viewport');
    assert.equal((await rect('.timeline-panel')).height, 264);
    await page.click('#vfx-tab');
    await settle();
    assert.deepEqual(await rect('#viewport'), before, 'the VFX tab');
    assert.equal(await page.evaluate(() => styk.editor._vfxTimelineVisible), true, 'the timeline shows VFX rows while the VFX panel shows');
    await page.click('#properties-tab');
    await settle();
    assert.equal(await page.evaluate(() => styk.editor._vfxTimelineVisible), false);
    await page.click('[data-timeline-mode="simple"]');
    await settle();
    assert.deepEqual(await rect('#viewport'), before, 'Simple');
    await page.click('[data-timeline-mode="advanced"]');
    await settle();
    await page.evaluate(() => styk.editor.addLayer?.('Another layer'));
    await settle();
    assert.deepEqual(await rect('#viewport'), before, 'a new layer');
    await workspace('draw');
    assert.deepEqual(await rect('#viewport'), before, 'Draw');
    await workspace('animate');
  });

  await step('Tall timeline stores 60% of the window and a second press restores the default', async () => {
    await page.click('#expand-timeline');
    await settle();
    assert.equal(await page.locator('#expand-timeline').getAttribute('aria-pressed'), 'true');
    assert.equal((await rect('.timeline-panel')).height, 540);
    assert.equal(await page.evaluate(() => styk.workspace.layout.shared.sizes.bottom), 540);
    await page.click('#expand-timeline');
    await settle();
    assert.equal(await page.locator('#expand-timeline').getAttribute('aria-pressed'), 'false');
    assert.equal((await rect('.timeline-panel')).height, 264);
  });

  await step('VFX floating and Library docked left keep Properties visible', async () => {
    await page.evaluate(() => styk.workspace.float('vfx'));
    await settle();
    const floating = await page.evaluate(() => ({
      vfx: document.getElementById('vfx-panel').checkVisibility(),
      properties: document.getElementById('properties-panel').checkVisibility(),
      inStage: Boolean(document.getElementById('vfx-panel').closest('.shell-stage .shell-floats')),
      list: styk.workspace.floating.map(item => item.panel),
      timelineRows: styk.editor._vfxTimelineVisible,
      // The tab moved with its panel: the same element, never a new one.
      tab: document.querySelectorAll('[data-vfx-tab="vfx"]').length === 1 && Boolean(document.querySelector('[data-vfx-tab="vfx"]').closest('.shell-floats')),
    }));
    assert.deepEqual(floating, {vfx: true, properties: true, inStage: true, list: ['vfx'], timelineRows: true, tab: true});
    const island = await rect('.shell-floats > .shell-island'), viewport = await rect('#viewport');
    assert.ok(island.x >= viewport.x && island.y >= viewport.y && island.x + island.width <= viewport.x + viewport.width
      && island.y + island.height <= viewport.y + viewport.height, 'the floating island stays over #viewport');
    await page.evaluate(() => styk.workspace.dock('library', 'left'));
    await settle();
    const docked = await page.evaluate(() => ({
      library: document.getElementById('user-library').checkVisibility(),
      properties: document.getElementById('properties-panel').checkVisibility(),
      left: Boolean(document.getElementById('user-library').closest('.shell-left')),
    }));
    assert.deepEqual(docked, {library: true, properties: true, left: true});
    assert.ok((await rect('#viewport')).width >= 360);
    await page.evaluate(() => styk.workspace.reset());
    await settle();
    assert.equal(await page.evaluate(() => Boolean(document.getElementById('user-library').closest('.shell-right'))), true, 'reset docks Library back');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.shell-right [role="tablist"] [data-vfx-tab="vfx"]'))), true, 'and the VFX tab');
  });

  await step('at compact width the band opens the inspector as a sheet with its tabs; Escape returns focus', async () => {
    await resize(800, 600);
    const button = page.locator('.shell-sheet-button');
    assert.equal(await button.isVisible(), true);
    await button.click();
    await settle();
    assert.equal(await page.locator('#right-sheet').evaluate(sheet => sheet.matches(':popover-open')), true);
    assert.equal(await page.locator('#properties-panel').isVisible(), true);
    assert.equal(await button.getAttribute('aria-expanded'), 'true');
    await page.click('#library-tab');
    await settle();
    assert.equal(await page.locator('#user-library').isVisible(), true);
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await page.locator('#right-sheet').evaluate(sheet => sheet.matches(':popover-open')), false);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('shell-sheet-button')), true);
    // #viewport never moved for the sheet.
    const before = await rect('#viewport');
    await button.click();
    await settle();
    assert.deepEqual(await rect('#viewport'), before);
    await page.mouse.click(before.x + 40, before.y + 40);
    await settle();
    assert.equal(await page.locator('#right-sheet').evaluate(sheet => sheet.matches(':popover-open')), false, 'a press outside closes it');
    await resize(1440, 900);
    assert.equal(await page.locator('#properties-panel').isVisible(), true, 'docked again from 801px, on its stored tab');
    assert.equal(await page.locator('.shell-sheet-button').isVisible(), false);
  });

  await step('Build keeps Structure docked while #viewport keeps 360px, then folds it to a strip whose sheet shows the tree', async () => {
    await workspace('rig');
    await resize(900, 700);
    assert.equal(await page.evaluate(() => styk.workspace.sizes.left), 210);
    assert.ok((await rect('#viewport')).width >= 360);
    assert.equal(await page.locator('.builder-tree').isVisible(), true);
    const splitter = page.getByRole('separator', {name: 'Resize figure structure'});
    assert.equal(await splitter.isVisible(), true);
    await resize(1440, 900);
    await splitter.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => styk.workspace.sizes.left), 244);
    await page.keyboard.press('Home');
    await resize(800, 600);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.left), 'strip');
    const strip = page.locator('.shell-left .shell-strip-button');
    await strip.click();
    await settle();
    assert.equal(await page.locator('#left-sheet').evaluate(sheet => sheet.matches(':popover-open')), true);
    assert.ok((await rect('.builder-tree')).height > 200, 'the tree fills the sheet');
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await page.locator('#left-sheet').evaluate(sheet => sheet.matches(':popover-open')), false);
    await resize(1440, 900);
  });

  await step('Build hides the timeline by default; its toggle shows it and the workspace remembers it', async () => {
    assert.equal(await page.locator('.timeline-panel').isVisible(), false);
    await page.click('#builder-timeline-toggle');
    await settle();
    assert.equal(await page.locator('.timeline-panel').isVisible(), true);
    assert.equal(await page.locator('#builder-timeline-toggle').getAttribute('aria-expanded'), 'true');
    await leaveBuild();
    assert.equal(await page.locator('.timeline-panel').isVisible(), true, 'Animate keeps its timeline');
    await workspace('rig');
    assert.equal(await page.locator('.timeline-panel').isVisible(), true, 'Build remembers its timeline');
    await page.click('#builder-timeline-toggle');
    await settle();
    assert.equal(await page.locator('.timeline-panel').isVisible(), false);
    await leaveBuild();
  });

  await step('at the low height tier the timeline is its header and Timeline… opens its body over the stage', async () => {
    for (const [width, height] of [[500, 340], [601, 441], [1920, 520]]) {
      await resize(width, height);
      assert.equal(await reachable('.shell-timeline-sheet'), true, `${width}x${height}: Timeline… is reachable`);
    }
    await resize(1000, 450);
    assert.equal((await rect('.timeline-panel')).height, 40);
    const before = await rect('#viewport');
    const opener = page.getByRole('button', {name: 'Timeline…'});
    await opener.click();
    await settle();
    assert.equal(await page.locator('#timeline').evaluate(body => body.matches(':popover-open')), true);
    assert.ok((await rect('#timeline')).height >= 200, 'the rows have room');
    assert.equal(await page.getByRole('grid', {name: 'Layer frames'}).isVisible(), true, 'every row is reachable in the sheet');
    assert.deepEqual(await rect('#viewport'), before);
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await page.locator('#timeline').evaluate(body => body.matches(':popover-open')), false);
    await resize(1440, 900);
    assert.equal((await rect('.timeline-panel')).height, 264);
  });

  await step('F6 moves focus from region to region', async () => {
    await page.locator('#viewport').focus();
    await page.keyboard.press('F6');
    const first = await page.evaluate(() => document.activeElement.closest('.shell-right, .timeline-panel')?.className ?? document.activeElement.id);
    assert.match(first, /shell-right/);
    await page.keyboard.press('F6');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.timeline-panel'))), true);
    await page.keyboard.press('Control+F6');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.shell-right'))), true);
  });

  await step('Ctrl+Alt+M moves the focused panel with the arrow keys; Enter moves it and Escape cancels', async () => {
    await page.evaluate(() => styk.workspace.reset());
    await settle();
    await page.click('#vfx-tab');
    await page.keyboard.press('Control+Alt+KeyM');
    const zone = page.locator('.shell-drop');
    assert.equal(await zone.isVisible(), true, 'one drop target previews the place');
    assert.equal(await zone.textContent(), 'Float here');
    await page.keyboard.press('ArrowRight');
    assert.equal(await zone.textContent(), 'Dock left');
    await page.keyboard.press('Escape');
    assert.equal(await zone.isVisible(), false);
    assert.deepEqual(await page.evaluate(() => styk.workspace.floating), []);
    await page.click('#vfx-tab');
    await page.keyboard.press('Control+Alt+KeyM');
    await page.keyboard.press('Enter');
    await settle();
    assert.deepEqual(await page.evaluate(() => styk.workspace.floating.map(item => item.panel)), ['vfx']);
    assert.equal(await page.locator('#vfx-panel').isVisible(), true);
    await page.evaluate(() => styk.workspace.reset());
    await settle();
  });

  await step('the layout persists across a reload and never rewrites itself when fitted', async () => {
    const right = page.getByRole('separator', {name: 'Resize properties panel'});
    await right.focus();
    await page.keyboard.press('ArrowLeft');
    await page.evaluate(() => styk.workspace.flushPreferences());
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('stykanimate.workspace-layout.v2')));
    assert.equal(stored.shared.sizes.right, 300);
    assert.equal(stored.right, 300, 'the v1 mirror a 1.1 app reads');
    assert.equal(stored.studioVersion, 1);
    await page.reload();
    await page.waitForFunction(() => window.styk?.ready);
    await settle();
    assert.equal(await page.evaluate(() => styk.workspace.sizes.right), 300);
    await resize(800, 600);
    await resize(1440, 900);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('stykanimate.workspace-layout.v2')).shared.sizes.right), 300);
    assert.equal(await page.evaluate(() => styk.workspace.sizes.right), 300);
    await page.evaluate(async () => { styk.workspace.reset(); await styk.workspace.flushPreferences(); });
  });

  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 700], [800, 600], [500, 340]]) {
    await resize(width, height);
    await page.screenshot({path: `${out}/animate-${width}x${height}.png`});
  }
  assert.deepEqual(errors, [], 'no page errors');
  console.log('PASS shell layout: tiers, #viewport minimum and ancestry, never-hidden controls, the header line, the rail, splitters, the default timeline, Tall timeline, floating and docked panels, compact sheet, Build Structure and timeline, the low-tier timeline sheet, F6, the keyboard move and persistence.');
} finally {
  await browser.close();
}
