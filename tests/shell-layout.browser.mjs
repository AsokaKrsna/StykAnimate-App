/**
 * The editor shell laid out by the layout solver (src/shell/dock-host.mjs):
 * the width and height tiers, the band's folds, #viewport's minimum and
 * ancestry, the stage floors, the controls that are never hidden, the rail's
 * constant place, the splitters' keyboard, tabs, sheets and strips, the
 * timeline's one default height, floating and docked panels that keep
 * Properties visible, Build's Structure and timeline, F6 and the keyboard
 * move, the Layout popover and saved presets, tab menus and drag to dock,
 * and persistence (architecture §3.11, M1).
 *
 * Serve the repository (STYK_PYTHON=py node scripts/serve.mjs --port 47911)
 * and run `node tests/shell-layout.browser.mjs`; STYK_URL overrides the
 * address. Every size starts from a fresh page with no stored layout.
 *
 * Transitional (until M3b replaces the canvas toolbar with the 40px stage
 * header and hides the 24px status bar into the activity log): at 500×340
 * the timeline is its header and #viewport is 360 wide but only about 180
 * tall; every larger size keeps 360×200. The stage floors are checked with
 * the status bar's height given back to #viewport, and in Animate only
 * (Draw's quick bar sits inside #viewport until M3b). Until M5's painter
 * draws 24px Camera and Scene rows and 28px short-tier rows, the default
 * timeline holds its promised rows at the painter's 32px (so today's layer
 * capacity holds), and the floors are checked with that extra height given
 * back too.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {BAND_FOLDS, stageFloor, timelineDefaultHeight} from '../src/shell/layout-solver.mjs';

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
/**
 * Controls that are drawn but cut off: outside the window, or clipped by an
 * ancestor that does not scroll to them. A control inside a scroller that
 * overflows (a list, the rail) is reachable by scrolling and not counted.
 */
const cutOff = () => page.evaluate(() => {
  const found = [];
  const clip = element => {
    const box = element.getBoundingClientRect();
    let left = box.left, top = box.top, right = box.right, bottom = box.bottom;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowX + style.overflowY) && (parent.scrollHeight > parent.clientHeight + 1 || parent.scrollWidth > parent.clientWidth + 1)) return null;
      const edge = parent.getBoundingClientRect();
      if (style.overflowX !== 'visible') { left = Math.max(left, edge.left); right = Math.min(right, edge.right); }
      if (style.overflowY !== 'visible') { top = Math.max(top, edge.top); bottom = Math.min(bottom, edge.bottom); }
      if (style.position === 'fixed') break;
    }
    return {left: Math.max(left, 0), top: Math.max(top, 0), right: Math.min(right, innerWidth), bottom: Math.min(bottom, innerHeight)};
  };
  for (const element of document.querySelectorAll('button, input, select, [role="tab"], [role="menuitem"]')) {
    if (!element.checkVisibility({visibilityProperty: true, opacityProperty: true})) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const shown = clip(element);
    if (!shown) continue;
    if (shown.right - shown.left < box.width - 1 || shown.bottom - shown.top < box.height - 1)
      found.push(`${element.id ? '#' + element.id : element.getAttribute('aria-label') || element.dataset.action || element.textContent.trim().slice(0, 20)} ${Math.round(shown.right - shown.left)}x${Math.round(shown.bottom - shown.top)} of ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  return found;
});
const showWindowControls = () => page.evaluate(() => { document.getElementById('window-controls').hidden = false; });

const SIZES = [
  // [width, height, tier, height tier]
  [1440, 900, 'wide', 'tall'], [1280, 720, 'regular', 'tall'], [1152, 720, 'narrow', 'tall'], [1100, 620, 'narrow', 'short'],
  [1024, 700, 'narrow', 'tall'], [900, 700, 'narrow', 'tall'], [900, 640, 'narrow', 'short'], [801, 600, 'narrow', 'short'],
  [800, 600, 'compact', 'short'], [661, 700, 'compact', 'tall'], [640, 480, 'minimal', 'low'], [1920, 520, 'wide', 'low'],
  [1000, 450, 'narrow', 'low'], [601, 441, 'minimal', 'low'], [500, 340, 'minimal', 'low'],
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
        // Build's Structure stays docked (232, then 200) wherever #viewport keeps 360px, else it is a strip.
        if (mode === 'rig' && (width >= 900 || width <= 801))
          assert.equal(await page.evaluate(() => document.documentElement.dataset.left), width >= 900 ? 'docked' : 'strip', `${label}: Structure`);
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

  await step('the artboard fits #viewport with the solver’s insets and reaches its floor once the transitional heights are given back', async () => {
    for (const [width, height] of SIZES) {
      await resize(width, height);
      const specTimeline = timelineDefaultHeight(height);
      const fit = await page.evaluate(specTimeline => {
        const viewport = document.getElementById('viewport').getBoundingClientRect();
        const inset = styk.workspace.stageInsets, report = styk.editor.report;
        const footer = document.querySelector('.statusbar').offsetHeight;
        // The painter's 32px Camera, Scene and short-tier rows (until M5) cost this much over the spec's default.
        const rows = Math.max(0, styk.workspace.solution.regions.bottom.size - specTimeline);
        const zoom = extra => Math.min((viewport.width - inset.left - inset.right) / report.canvas_width,
          (viewport.height + extra - inset.top - inset.bottom) / report.canvas_height, 2);
        return {scale: styk.state.view.scale, expected: zoom(0), floor: zoom(footer + rows)};
      }, specTimeline);
      const label = `${width}x${height}: ${JSON.stringify(fit)}`;
      assert.ok(Math.abs(fit.scale - fit.expected) < 0.005, `${label}: fitted with the solver's insets`);
      assert.ok(fit.floor * 100 >= stageFloor(width, height) - 0.5, `${label}: at least ${stageFloor(width, height)}%`);
    }
    await resize(1440, 900);
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

  await step('with the desktop window controls the band fits and nothing is cut off in Animate, Draw and Build', async () => {
    await showWindowControls();
    for (const mode of ['animate', 'draw', 'rig']) {
      for (const [width, height] of SIZES) {
        await resize(width, height);
        if (await page.evaluate(() => document.querySelector('.workspace').dataset.mode) !== mode) await workspace(mode);
        const label = `${mode} ${width}x${height}`;
        const band = await page.evaluate(() => { const band = document.querySelector('.titlebar'); return {fits: band.scrollWidth <= band.clientWidth, steps: band.dataset.band ?? ''}; });
        assert.ok(band.fits, `${label}: the band fits (${band.steps})`);
        for (const action of ['minimize', 'maximize', 'close']) assert.equal(await reachable(`#window-controls [data-action="${action}"]`), true, label);
        assert.deepEqual(await cutOff(), [], `${label}: no control is cut off`);
      }
      await resize(1440, 900);
      if (mode === 'rig') await leaveBuild();
    }
    await workspace('animate');
  });

  await step('the band folds its words in order, and the menubar folds into the mark only at the minimal tier', async () => {
    const read = () => page.evaluate(() => ({
      steps: (document.querySelector('.titlebar').dataset.band ?? '').split(' ').filter(Boolean),
      menubar: document.querySelector('.app-menubar').checkVisibility(),
      save: document.querySelector('.titlebar [data-action="save"]').checkVisibility(),
      tier: document.documentElement.dataset.tier,
    }));
    await resize(1440, 900);
    assert.deepEqual(await read(), {steps: [], menubar: true, save: true, tier: 'wide'}, 'a wide band folds nothing: Save stays beside Export');
    let previous = [];
    for (const width of [1280, 1100, 1024, 900, 801, 720, 661]) {
      await resize(width, 700);
      const band = await read();
      assert.equal(band.menubar, true, `${width}: the menubar stays docked while the band fits`);
      assert.ok(!band.steps.includes('menus'), `${width}: ${band.steps}`);
      const order = band.steps.map(item => BAND_FOLDS.indexOf(item));
      assert.deepEqual(order, [...order].sort((a, b) => a - b), `${width}: the fold order (${band.steps})`);
      assert.ok(previous.every(item => band.steps.includes(item)), `${width}: folds only accumulate (${previous} then ${band.steps})`);
      previous = band.steps;
    }
    await resize(640, 480);
    const minimal = await read();
    assert.equal(minimal.tier, 'minimal');
    assert.equal(minimal.menubar, false, 'the menubar folds into the mark');
    assert.equal(minimal.steps[0], 'menus');
    await page.click('.brand');
    for (const name of ['File', 'Edit', 'View', 'Animation', 'Help'])
      assert.equal(await page.getByRole('menuitem', {name, exact: true}).getAttribute('aria-haspopup'), 'menu', `the mark's menu lists ${name}`);
    await page.getByRole('menuitem', {name: 'Animation', exact: true}).click();
    await page.getByRole('menuitemcheckbox', {name: 'Audio'}).click();
    assert.equal(await page.locator('#timeline-audio').getAttribute('aria-expanded'), 'true', 'a folded menu runs its command (the header folds Audio here)');
    await page.evaluate(() => document.getElementById('timeline-audio').click());
    await resize(1440, 900);
    assert.deepEqual((await read()).steps, []);
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
    assert.deepEqual([before.right, before.timeline], [288, 280]);
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
    assert.equal((await sizes()).timeline, 292);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal((await sizes()).timeline, 268);
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
    assert.equal((await rect('.timeline-panel')).height, 280);
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

  await step('Tall timeline stores 60% of the window and a second press restores the height it had', async () => {
    const expand = async pressed => {
      await page.click('#expand-timeline');
      await settle();
      assert.equal(await page.locator('#expand-timeline').getAttribute('aria-pressed'), String(pressed));
    };
    await expand(true);
    assert.equal((await rect('.timeline-panel')).height, 540);
    assert.equal(await page.evaluate(() => styk.workspace.layout.shared.sizes.bottom), 540);
    await expand(false);
    assert.equal((await rect('.timeline-panel')).height, 280, 'the default comes back');
    assert.equal(await page.evaluate(() => styk.workspace.layout.shared.sizes.bottom), undefined, 'still the default, not a stored size');
    // A height of the user's own survives Expand and back.
    await page.getByRole('separator', {name: 'Resize timeline'}).focus();
    for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowUp');
    await settle();
    assert.equal((await rect('.timeline-panel')).height, 388);
    await expand(true);
    assert.equal((await rect('.timeline-panel')).height, 540);
    await expand(false);
    assert.equal((await rect('.timeline-panel')).height, 388, 'the custom height comes back');
    assert.equal(await page.evaluate(() => styk.workspace.layout.shared.sizes.bottom), 388);
    await page.evaluate(() => styk.workspace.reset());
    await settle();
  });

  await step('the default Advanced timeline shows at least today’s layer rows under Camera and Scene', async () => {
    // Today (1.1) the timeline shows 4.38 content rows at every size; the default keeps 4½ above 800px tall and four whole rows below.
    for (const [width, height, least] of [[1440, 900, 4.38], [1280, 720, 4], [1024, 700, 4], [900, 700, 4], [960, 600, 4]]) {
      await resize(width, height);
      const rows = await page.evaluate(() => (styk.timeline.height - 32 - 2 * 32) / 32);
      assert.ok(rows >= least, `${width}x${height}: ${rows} content rows`);
    }
    await resize(1440, 900);
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
    assert.deepEqual(await page.evaluate(() => {
      const body = document.getElementById('timeline');
      return {display: getComputedStyle(body).display, shown: [...body.querySelectorAll('button, input, [tabindex="0"]')].some(item => item.checkVisibility())};
    }), {display: 'none', shown: false}, 'the folded body takes no room and no focus');
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
    assert.equal((await rect('.timeline-panel')).height, 280);
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

  const panelsOf = () => page.evaluate(() => Object.fromEntries(styk.workspace.layout.modes[styk.shell.mode].panels.map(record => [record.id, `${record.dock}/${record.side}`])));
  const cards = () => page.locator('#layout-popover [role="radio"]').evaluateAll(list => list.map(card => `${card.dataset.preset}${card.getAttribute('aria-checked') === 'true' ? '*' : ''}`));
  const layoutOpen = () => page.locator('#layout-popover').evaluate(element => element.matches(':popover-open'));
  const openLayout = async () => {
    await page.click('[data-app-menu="view"]');
    await page.getByRole('menuitem', {name: /^Layout…/}).click();
    await page.waitForFunction(() => document.getElementById('layout-popover')?.matches(':popover-open'));
    await settle();
  };

  await step('the Layout popover opens from View and Ctrl+Alt+L and applies presets, positions and Reset', async () => {
    await page.evaluate(() => styk.workspace.reset());
    await settle();
    await openLayout();
    assert.deepEqual(await cards(), ['animate*', 'timing', 'focus', 'review']);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.preset), 'animate', 'focus starts on the shown preset');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await settle();
    assert.deepEqual(await cards(), ['animate', 'timing*', 'focus', 'review'], 'arrow keys and Enter pick a preset');
    assert.deepEqual([(await panelsOf()).vfx, (await panelsOf()).library], ['strip/right', 'strip/right'], 'Timing shows Properties only');
    await page.click('#layout-popover [data-preset="review"]');
    await settle();
    assert.equal((await panelsOf()).properties, 'hidden/right');
    assert.equal(await page.evaluate(() => document.getElementById('animation-timeline').dataset.state), 'strip');
    await page.click('#layout-popover [data-preset="focus"]');
    await settle();
    assert.deepEqual(await cards(), ['animate', 'timing', 'focus*', 'review']);
    await page.click('#layout-popover [data-preset="focus"]');
    await settle();
    assert.deepEqual(await cards(), ['animate', 'timing', 'focus', 'review*'], 'Focus restores what it folded');
    await page.click('#layout-popover .ui-popover-foot .ui-button[data-variant="ghost"]');
    await settle();
    assert.deepEqual(await cards(), ['animate*', 'timing', 'focus', 'review'], 'Reset');
    const choose = async (name, value) => { await page.selectOption(`#layout-popover select[aria-label="${name}"]`, value); await settle(); };
    await choose('Properties position', 'left');
    assert.equal(await page.evaluate(() => Boolean(document.getElementById('properties-panel').closest('.shell-left'))), true, 'Properties docks left');
    assert.ok((await rect('#viewport')).width >= 360);
    await choose('Properties position', 'right');
    await choose('VFX position', 'float');
    assert.deepEqual(await page.evaluate(() => styk.workspace.floating.map(item => item.panel)), ['vfx']);
    assert.equal(await page.locator('#properties-panel').isVisible(), true, 'Properties stays visible');
    await choose('Library position', 'left');
    assert.equal(await page.evaluate(() => Boolean(document.getElementById('user-library').closest('.shell-left'))), true);
    await choose('Timeline width', 'stage');
    await choose('Tools side', 'right');
    const placed = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      return {span: document.querySelector('.workspace').dataset.bottomSpan, rail: document.querySelector('.workspace').dataset.rail,
        railRight: box('.shell-rail').right > box('.shell-stage').right, timeline: box('.timeline-panel').right <= box('.shell-stage').right + 1};
    });
    assert.deepEqual(placed, {span: 'stage', rail: 'right', railRight: true, timeline: true});
    assert.deepEqual(await page.locator('#layout-popover select').evaluateAll(list => list.map(select => select.value)), ['right', 'float', 'left', 'stage', 'right'],
      'the selects show where each panel is');
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await layoutOpen(), false);
    await page.locator('#viewport').focus();
    await page.keyboard.press('Control+Alt+KeyL');
    await settle();
    assert.equal(await layoutOpen(), true, 'Ctrl+Alt+L opens it');
    await page.click('#layout-popover .ui-popover-foot .ui-button[data-variant="ghost"]');
    await settle();
    assert.deepEqual(await cards(), ['animate*', 'timing', 'focus', 'review']);
    await page.keyboard.press('Control+Alt+KeyL');
    await settle();
    assert.equal(await layoutOpen(), false, 'and closes it');
  });

  await step('a layout saved as a preset can be applied, renamed, updated and deleted', async () => {
    await openLayout();
    await page.click('#layout-popover [data-preset="timing"]');
    await page.getByRole('button', {name: 'Save as preset…'}).click();
    await page.getByRole('textbox', {name: 'Name'}).fill('Fight setup');
    await page.getByRole('button', {name: 'Save preset'}).click();
    await page.waitForFunction(() => document.getElementById('layout-popover')?.matches(':popover-open'));
    await settle();
    const savedId = await page.evaluate(() => `user:${styk.workspace.layouts[0].id}`);
    assert.deepEqual(await cards(), ['animate', 'timing*', 'focus', 'review', `${savedId}*`]);
    const saved = page.locator('#layout-popover [data-preset^="user:"]');
    assert.equal(await saved.textContent(), 'Fight setup');
    await page.click('#layout-popover [data-preset="animate"]');
    await saved.click();
    await settle();
    assert.equal((await panelsOf()).vfx, 'strip/right', 'the saved preset applies its arrangement');
    await saved.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', {name: 'Rename…'}).click();
    await page.getByRole('textbox', {name: 'Name'}).fill('Fight 2');
    await page.getByRole('button', {name: 'Rename'}).click();
    await settle();
    assert.deepEqual(await page.evaluate(() => styk.workspace.layouts.map(item => item.name)), ['Fight 2']);
    if (!await layoutOpen()) await openLayout();
    await page.click('#layout-popover [data-preset="animate"]');
    await settle();
    await page.locator('#layout-popover [data-preset^="user:"]').click({button: 'right'});
    await page.getByRole('menuitem', {name: 'Update'}).click();
    await settle();
    assert.deepEqual(await cards(), ['animate*', 'timing', 'focus', 'review', `${savedId}*`], 'Update takes the current arrangement');
    await page.locator('#layout-popover [data-preset^="user:"]').click({button: 'right'});
    await page.getByRole('menuitem', {name: 'Delete'}).click();
    await settle();
    assert.deepEqual(await page.evaluate(() => styk.workspace.layouts), []);
    assert.equal(await page.locator('#layout-popover [data-preset^="user:"]').count(), 0);
    await page.keyboard.press('Escape');
    // Build offers its own presets.
    await workspace('rig');
    await openLayout();
    assert.deepEqual(await cards(), ['build*', 'build-timeline', 'focus'], 'the default preset leads');
    await page.click('#layout-popover [data-preset="build-timeline"]');
    await settle();
    assert.equal(await page.locator('.timeline-panel').isVisible(), true, 'Build + timeline shows the timeline');
    await page.click('#layout-popover [data-preset="build"]');
    await page.keyboard.press('Escape');
    await leaveBuild();
    await page.evaluate(() => styk.workspace.reset());
    await settle();
  });

  await step('a tab menu and a dragged tab dock, float and fold panels where they may go', async () => {
    await page.click('#vfx-tab', {button: 'right'});
    assert.deepEqual((await page.locator('#menu [role^="menuitem"]').allTextContents()).map(text => text.trim()),
      ['Dock left', 'Float', 'Fold to strip', 'Hide']);
    await page.getByRole('menuitem', {name: 'Dock left'}).click();
    await settle();
    const viaMenu = (await panelsOf()).vfx;
    assert.equal(viaMenu, 'left/left');
    await page.evaluate(() => styk.workspace.reset());
    await openLayout();
    await page.selectOption('#layout-popover select[aria-label="VFX position"]', 'left');
    await settle();
    assert.equal((await panelsOf()).vfx, viaMenu, 'the tab menu and the Layout popover agree');
    await page.keyboard.press('Escape');
    await page.evaluate(() => styk.workspace.reset());
    await settle();
    await page.locator('#library-tab').focus();
    await page.keyboard.press('Shift+F10');
    assert.equal(await page.getByRole('menuitem', {name: 'Fold to strip'}).isVisible(), true, 'Shift+F10 opens the tab menu');
    await page.getByRole('menuitem', {name: 'Fold to strip'}).click();
    await settle();
    assert.equal((await panelsOf()).library, 'strip/right');
    await page.evaluate(() => styk.workspace.reset());
    await settle();
    const zone = () => page.evaluate(() => { const element = document.querySelector('.shell-drag-zone'); return element && !element.hidden ? element.textContent : null; });
    const center = async selector => { const box = await page.locator(selector).boundingBox(); return [box.x + box.width / 2, box.y + box.height / 2]; };
    const stage = await rect('#viewport');
    // Drag Library to the stage's left edge.
    await page.mouse.move(...await center('#library-tab'));
    await page.mouse.down();
    await page.mouse.move(stage.x + 40, stage.y + stage.height / 2, {steps: 10});
    assert.equal(await zone(), 'Dock left', 'one target names the place');
    assert.equal(await page.locator('#library-tab').getAttribute('data-dragging'), 'true', 'the origin tab dims');
    await page.mouse.up();
    await settle();
    assert.equal((await panelsOf()).library, 'left/left');
    assert.equal(await zone(), null);
    // Back into the right island as a tab.
    const head = await rect('.shell-right .shell-tabs');
    await page.mouse.move(...await center('#library-tab'));
    await page.mouse.down();
    await page.mouse.move(head.x + head.width - 24, head.y + head.height / 2, {steps: 10});
    assert.equal(await zone(), 'Add as a tab');
    await page.mouse.up();
    await settle();
    assert.equal((await panelsOf()).library, 'right/right');
    // Shift floats; dragging a floating panel's tab moves it; Escape cancels.
    await page.mouse.move(...await center('#vfx-tab'));
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2, {steps: 10});
    assert.equal(await zone(), 'Float here');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settle();
    const first = await page.evaluate(() => styk.workspace.floating);
    assert.deepEqual(first.map(item => item.panel), ['vfx']);
    await page.mouse.move(...await center('#vfx-tab'));
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width / 2 - 120, stage.y + stage.height / 2, {steps: 10});
    assert.equal(await zone(), 'Float here', 'a floating panel moves by its tab');
    await page.mouse.up();
    await settle();
    const moved = await page.evaluate(() => styk.workspace.floating);
    assert.ok(moved[0].x < first[0].x, 'it moved');
    await page.mouse.move(...await center('#vfx-tab'));
    await page.mouse.down();
    await page.mouse.move(stage.x + 30, stage.y + 60, {steps: 10});
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle();
    assert.deepEqual(await page.evaluate(() => styk.workspace.floating), moved, 'Escape cancels a drag');
    assert.equal(await zone(), null);
    // A click on a tab still shows it.
    await page.click('#library-tab');
    assert.equal(await page.locator('#user-library').isVisible(), true);
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
  console.log('PASS shell layout: tiers, the band, #viewport minimum and ancestry, floors, never-hidden controls, the header line, the rail, splitters, the default timeline, Tall timeline, floating and docked panels, compact sheet, Build Structure and timeline, the low-tier timeline sheet, F6, the keyboard move, the Layout popover, saved presets, tab menus, drag to dock and persistence.');
} finally {
  await browser.close();
}
