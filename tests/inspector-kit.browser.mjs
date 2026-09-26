/**
 * The inspector kit in a real page: its markup through updateInspectorDOM(),
 * PropertyControls on kit number fields (scrub with Shift, arrow steps,
 * Escape rollback), titled sections that stay open across refreshes, plain
 * stepper buttons, slider readouts, the owned quick actions slot and the
 * one-time scrub hint. The kit's stylesheets are linked by hand until app.css
 * imports them. `--shot <file>` also saves a picture of the rendered sections.
 *
 *   node tests/inspector-kit.browser.mjs            (STYK_URL, default http://127.0.0.1:47832)
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const SHEETS = ['field', 'slider', 'select', 'stepper', 'switch', 'check', 'swatch', 'form', 'section', 'card', 'list-row']
  .map(name => `/src/styles/components/${name}.css`).concat('/src/styles/features/inspector.css');
const shotIndex = process.argv.indexOf('--shot'), shot = shotIndex > 0 ? process.argv[shotIndex + 1] : null;
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage({viewport: {width: 900, height: 1000}});
  await page.route('**/src/app.mjs', route => route.fulfill({contentType: 'text/javascript', body: ''}));
  await page.goto(process.env.STYK_URL || 'http://127.0.0.1:47832');
  await page.evaluate(async sheets => {
    await Promise.all(sheets.map(href => new Promise((resolve, reject) => {
      const link = Object.assign(document.createElement('link'), {rel: 'stylesheet', href});
      link.onload = resolve; link.onerror = () => reject(new Error(`${href} did not load`));
      document.head.append(link);
    })));
    document.documentElement.dataset.theme = 'light';
    document.documentElement.removeAttribute('data-theme-pending');
    document.getElementById('app')?.remove();
    const root = Object.assign(document.createElement('div'), {id: 'inspector'});
    root.setAttribute('data-ui', '');
    root.style.cssText = 'inline-size:256px;padding:12px 16px;background:var(--surface);position:absolute;inset:0 auto auto 0;display:block';
    document.body.append(root);
  }, SHEETS);

  const checks = await page.evaluate(async () => {
    const kit = await import('/src/inspector-kit.mjs'), {updateInspectorDOM} = await import('/src/inspector-dom.mjs');
    const {PropertyControls} = await import('/src/property-controls.mjs'), {icon} = await import('/src/icons.mjs');
    const root = document.getElementById('inspector'), checks = [], log = [];
    const check = (name, value) => { if (!value) throw new Error(name); checks.push(name); };
    const model = {root_x: 100, scale: 100, figure_z_order: 2, chain: 2, joined: false};
    const saved = [];
    const memory = new kit.SectionMemory({}, {onChange: value => saved.push(value)});
    const descriptor = () => ({
      kind: 'figure', quick: {context: 'figure', label: 'Figure actions'},
      sections: [
        {id: 'transform', title: 'Transform', rows: [{kind: 'grid', rows: [
          {kind: 'number', key: 'root_x', label: 'X', unit: 'px', value: model.root_x},
          {kind: 'number', key: 'scale', label: 'Scale', unit: '%', value: model.scale, min: 0.01},
        ]}]},
        {id: 'appearance', title: 'Appearance', actions: [{action: 'reset-color', icon: 'undo', label: 'Reset colours'}], rows: [{kind: 'grid', rows: [
          {kind: 'color', id: 'figure-color', label: 'Colour', value: '#0d99ff'},
          {kind: 'number', key: 'figure_opacity', field: false, label: 'Opacity', unit: '%', value: 100, min: 0, max: 100},
        ]}]},
        {id: 'arrange', title: 'Arrange', actions: [{action: 'join-figure', label: 'Join…', text: true}], rows: [{kind: 'grid', ratio: '3:2', stackNarrow: true, rows: [
          {kind: 'select', id: 'figure-layer', label: 'Layer', options: [{value: 'a', label: 'Bubble', selected: true}, {value: 'b', label: 'Rival'}]},
          {kind: 'stepper-field', key: 'figure_z_order', label: 'Order', description: 'Z-index', precision: 0, value: model.figure_z_order,
            down: {action: 'layer-down', label: 'Send backward', icon: 'chevron-left'}, up: {action: 'layer-up', label: 'Bring forward', icon: 'chevron-right'}},
        ]}]},
        {id: 'ik', title: 'IK', rows: [
          {kind: 'grid', rows: [{kind: 'field-switch', id: 'node-is-ik', label: 'Use IK', checked: true}, {kind: 'field-switch', id: 'pin-joint', label: 'Pin joint'}]},
          {kind: 'stepper', id: 'node-ik-chain', label: 'Chain', description: 'IK chain length', value: model.chain, min: 1, max: 3, step: 1},
          {kind: 'segmented', label: 'Bend', description: 'IK bend direction', name: 'node-ik-bend', value: 0, options: [[-1, 'Left'], [0, 'Both'], [1, 'Right']].map(([value, label]) => ({value, label}))},
        ]},
        {id: 'connection', title: 'Connection', place: 'titled', open: ctx => ctx.joined, rows: [{kind: 'actions', items: [{action: 'combine-figures', label: 'Combine connected', text: true, variant: 'outline'}]}]},
        {id: 'colours', title: 'Colours', place: 'titled', rows: [{kind: 'swatches', label: 'Figure colours', items: ['#0d99ff', '#13263a', '#ff6a2b'].map(value => ({value, picker: 'paint', label: `Replace ${value}`}))}]},
        {id: 'parallax', title: 'Parallax', place: 'titled', switch: {label: 'Enable parallax', checked: true}, rows: [
          {kind: 'slider', label: 'Movement', min: 0, max: 400, value: 100, unit: '%', data: {'parallax-field': 'movement'}},
          {kind: 'checkbox', id: 'inspector-layer-visible', label: 'Visible', checked: true},
        ]},
      ],
      footer: [{action: 'add-to-library', icon: 'layers', label: 'Add to library'}],
    });
    const render = () => updateInspectorDOM(root, kit.renderInspector(descriptor(), {icon, memory, ctx: {joined: model.joined}}));
    render();
    let hints = 0;
    const installed = kit.installInspectorKit(root, {memory, onScrubHint: text => { hints++; log.push(text); }});
    const controls = new PropertyControls(root, {
      begin: payload => payload.key, preview: payload => log.push(['preview', payload.key, payload.value]),
      commit: payload => { model[payload.key] = payload.value; log.push(['commit', payload.key, payload.value]); },
      cancel: payload => log.push(['cancel', payload.key, payload.initialValue]),
    });
    const changes = [];
    root.addEventListener('change', event => changes.push(event.target.id || event.target.dataset.property || event.target.name));

    // Titled sections: a click opens in place, the memory remembers, a refresh keeps it.
    const toggle = root.querySelector('[data-section-toggle="colours"]');
    check('Titled sections start closed', toggle.getAttribute('aria-expanded') === 'false' && root.querySelector('#inspector-section-figure-colours').hidden);
    toggle.click();
    check('A click opens the section in place', toggle.getAttribute('aria-expanded') === 'true' && !root.querySelector('#inspector-section-figure-colours').hidden &&
      toggle.closest('.ui-section').hasAttribute('data-open'));
    check('The memory saves the opened section', JSON.stringify(saved.at(-1)) === '{"figure":{"colours":true}}');
    render();
    check('A refresh keeps it open and keeps the node', root.querySelector('[data-section-toggle="colours"]') === toggle && toggle.getAttribute('aria-expanded') === 'true');
    model.joined = true; render();
    check('An auto-open section opens when its content matters', root.querySelector('[data-section-toggle="connection"]').getAttribute('aria-expanded') === 'true');
    root.querySelector('[data-section-toggle="connection"]').click(); render();
    check('Closing it holds while it still matters', root.querySelector('[data-section-toggle="connection"]').getAttribute('aria-expanded') === 'false');
    model.joined = false; render(); model.joined = true; render();
    check('It opens again the next time it matters', root.querySelector('[data-section-toggle="connection"]').getAttribute('aria-expanded') === 'true');

    // The quick actions slot is owned: its buttons survive refreshes.
    const quick = root.querySelector('.ui-quick[data-quick-context="figure"]');
    quick.innerHTML = '<button type="button" data-action="mirror">Flip</button>';
    render();
    check('The owned quick actions slot keeps its content', root.querySelector('.ui-quick') === quick && quick.textContent === 'Flip');

    // PropertyControls on kit fields.
    const x = root.querySelector('input[data-property="root_x"]');
    x.focus();
    check('The first focus of a scrub-able field shows the hint once', hints === 1 && log.includes(kit.SCRUB_HINT));
    x.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', shiftKey: true, bubbles: true}));
    x.dispatchEvent(new KeyboardEvent('keyup', {key: 'ArrowUp', bubbles: true}));
    check('Shift+ArrowUp steps by 0.1 and commits', Math.abs(model.root_x - 100.1) < 1e-9);
    x.value = '250'; x.dispatchEvent(new Event('input', {bubbles: true}));
    x.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    check('Escape rolls a typed value back', Math.abs(model.root_x - 100.1) < 1e-9 && log.some(entry => entry[0] === 'cancel' && entry[1] === 'root_x') && x.value === '100.1');
    x.blur();
    root.querySelector('#node-is-ik').focus(); root.querySelector('input[data-property="scale"]').focus();
    check('The hint shows only once', hints === 1);
    root.querySelector('input[data-property="scale"]').blur();

    // A plain stepper step reports an edit; a stepper field's buttons keep their commands.
    root.querySelector('.ui-stepper [data-kit-step="1"]').click();
    check('A plain step changes the value within its limits and reports it', root.querySelector('#node-ik-chain').value === '3' && changes.includes('node-ik-chain'));
    root.querySelector('.ui-stepper [data-kit-step="1"]').click();
    check('A step past the limit does nothing', root.querySelector('#node-ik-chain').value === '3' && changes.filter(id => id === 'node-ik-chain').length === 1);
    const order = root.querySelector('.ui-field[data-steps]');
    check('The stepper field reads Order, the step down, the value, the step up', (() => {
      const [label, down, input, up] = ['.ui-field-label', '[data-action="layer-down"]', 'input', '[data-action="layer-up"]'].map(selector => order.querySelector(selector).getBoundingClientRect().left);
      return label < down && down < input && input < up;
    })());

    // Slider readout.
    const slider = root.querySelector('.ui-slider');
    slider.value = '200'; slider.dispatchEvent(new Event('input', {bubbles: true}));
    check('A slider keeps its fill and readout with its value', slider.style.getPropertyValue('--_p') === '50%' &&
      slider.parentElement.querySelector('output').textContent === '200%' && slider.getAttribute('aria-valuetext') === '200%');

    // Styles: rest states from the tokens.
    const field = root.querySelector('.ui-field[data-property-row="root_x"]'), style = getComputedStyle(field);
    check('Fields are 32px sunken boxes with no ring at rest', style.blockSize === '32px' && style.boxShadow.startsWith('rgba(0, 0, 0, 0)') && style.backgroundColor !== 'rgba(0, 0, 0, 0)');
    const sw = getComputedStyle(root.querySelector('#node-is-ik'));
    check('A switch is 32×18', sw.inlineSize === '32px' && sw.blockSize === '18px');
    const suffix = root.querySelector('[data-property-row="root_x"] .ui-field-suffix').getBoundingClientRect(), value = x.getBoundingClientRect();
    check('The unit follows its value', suffix.left - value.right < 8 && suffix.left >= value.right - 1);
    installed.destroy(); controls.destroy();
    return checks;
  });
  console.log(checks.map(name => `PASS ${name}`).join('\n'));

  // Scrubbing with the pointer and Shift: a 20px drag moves the value 2 (×0.1).
  const label = page.locator('[data-property-row="scale"] .ui-field-label');
  await page.evaluate(async () => {
    const kit = await import('/src/inspector-kit.mjs'), {PropertyControls} = await import('/src/property-controls.mjs');
    const root = document.getElementById('inspector');
    window.kitScrub = [];
    kit.installInspectorKit(root, {});
    new PropertyControls(root, {begin: payload => payload.key, commit: payload => window.kitScrub.push([payload.key, payload.value])});
  });
  const box = await label.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  for (let dx = 4; dx <= 24; dx += 4) await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const scrub = await page.evaluate(() => window.kitScrub);
  assert.equal(scrub.length, 1, 'one committed scrub');
  assert.equal(scrub[0][0], 'scale');
  assert.ok(scrub[0][1] > 100 && scrub[0][1] <= 102.4 + 1e-9, `Shift scrubs finely: ${scrub[0][1]}`);
  console.log('PASS Scrubbing a label with Shift moves the value in tenths');
  if (shot) {
    await page.evaluate(() => { for (const toggle of document.querySelectorAll('#inspector .ui-section-toggle[aria-expanded="false"]')) toggle.click(); });
    await page.locator('#inspector').screenshot({path: shot});
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.locator('#inspector').screenshot({path: shot.replace(/(\.png)?$/i, '-dark.png')});
    console.log(`Saved ${shot} and its dark twin`);
  }
  assert.equal(checks.length, 19);
} finally { await browser.close(); }
