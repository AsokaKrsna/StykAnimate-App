/**
 * Editor shell contract. index.html is static markup that src/ modules query at
 * load time without null checks, and that about 300 local browser tests drive.
 * Browser tests do not run in CI, so this unit test is the CI guard for the
 * markup: restyle and restructure freely, but keep every hook listed here.
 *
 * Remove or rename a hook only in the commit that changes its last reader, and
 * update this list in that commit. Comments name the readers of each group.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';

export const SHELL_CONTRACT = Object.freeze({
  // Static ids. Each must appear exactly once in index.html.
  ids: {
    // app.mjs (resize, worldPoint, pointer input, placeArtboard), builder-mode,
    // sprite-placement-dialog, tweener-controls. #scene is replaced by id on GPU recovery.
    canvas: ['viewport', 'scene', 'overlay', 'artboard'],
    // app.mjs; tests call setInputFiles on #file-input.
    inputs: ['file-input', 'media-input'],
    // app.mjs dialogs, menus and toasts; builder-mode, rig-test-ui, movieclip-ui and
    // studio-shell (insert dialog). The two titles are aria-labelledby targets.
    hosts: ['dialog', 'dialog-content', 'menu', 'toast', 'insert-dialog', 'insert-title',
      'insert-movieclip-title', 'asset-list', 'sample-list', 'close-insert'],
    // app.mjs, studio-shell, property-controls, drawing-controller, user-library,
    // vfx-inspector, layer-timeline, builder-mode (#builder-outliner).
    panels: ['inspector', 'inspector-context', 'object-actions', 'vfx-panel', 'timeline',
      'animation-timeline', 'builder-outliner'],
    // app.mjs, layer-timeline, audio-timeline, studio-layout, studio-shell and
    // localization-bindings (#fps, #timeline-zoom, #play-button, #loop-button).
    transport: ['play-button', 'loop-button', 'time-display', 'fps', 'timeline-zoom', 'range-edit',
      'onion-button', 'onion-settings-button', 'timeline-audio', 'expand-timeline',
      'timeline-workflow', 'timeline-summary', 'selection-summary'],
    // Controllers constructed with these elements in app.mjs; studio-shell (#open-insert);
    // localization-bindings (#zoom-label).
    canvasView: ['zoom-label', 'handles-button', 'paths-button', 'canvas-guides-button',
      'vfx-preview', 'tweener-button', 'open-insert'],
    // builder-mode and hotkey-hints (#builder-bar); popovertarget ids of the builder menus.
    builder: ['builder-bar', 'builder-title', 'builder-done', 'builder-menu-edit',
      'builder-menu-arrange', 'builder-menu-view'],
    // app.mjs; builder-construction (#chain-*); studio-shell and tweener-controls (#viewport-hint).
    stage: ['viewport-hint', 'canvas-empty', 'renderer-error', 'playback-fps', 'preview-quality',
      'preview-badge', 'chain-controls', 'chain-count', 'chain-finish', 'chain-cancel',
      'polygon-controls', 'polygon-count', 'finish-polygon'],
    // app.mjs and localization-bindings (#window-controls); base/document.css hides #app
    // while the theme is pending.
    status: ['app', 'project-name', 'dirty-dot', 'save-state', 'stage-size', 'status', 'status-dot',
      'renderer-label', 'render-time', 'object-count', 'window-controls'],
    // Reader-bound: read only by studio-shell.mjs (no null checks) and app.mjs.
    // They may be removed together with that reader.
    readerBound: ['leave-rig', 'tool-context', 'edit-scope', 'frame-badge'],
  },
  // data-action values in index.html. Each is a key of the actions map in
  // app.mjs, and the same names are hotkey ids (hotkeys.mjs), native menu
  // commands (desktop/main.cjs), telemetry buckets (telemetry-core.mjs),
  // localization menu keys and hotkey hints. Never rename one.
  actions: {
    titlebar: ['menu', 'rename', 'save', 'export', 'minimize', 'maximize', 'close'],
    rail: ['toggle-isolate', 'selection-front', 'selection-back', 'help', 'settings'],
    canvas: ['scene-settings', 'undo', 'redo', 'toggle-handles', 'toggle-motion-paths', 'zoom-menu',
      'finish-polygon', 'cancel-polygon'],
    builder: ['split-segment', 'duplicate-segment', 'mirror-segment', 'mirror-segment-vertical',
      'copy-builder-appearance', 'paste-builder-appearance', 'rig-connect', 'rig-examples',
      'unsplit-segment', 'origin-segment', 'segment-values', 'add-sprite-segment', 'edit-text',
      'delete-single-segment', 'delete-segment', 'segment-order-front', 'segment-order-up',
      'segment-order-down', 'segment-order-back', 'builder-static-handles', 'builder-highlight',
      'builder-canvas-color', 'toggle-builder-branch', 'rig-test'],
    transport: ['first-frame', 'previous-frame', 'play', 'next-frame', 'toggle-loop',
      'toggle-range-edit', 'toggle-onion'],
    insert: ['add-figure', 'add-text', 'import-sprite', 'import', 'movieclip-new', 'movieclip-create',
      'movieclip-range'],
    status: ['performance'],
  },
  // Shift-click routes to data-shift-action (app.mjs click delegation).
  shiftActions: ['duplicate-branch', 'mirror-branch', 'mirror-branch-vertical', 'selection-down',
    'selection-up'],
  // app.mjs setTool, studio-shell (.tool-dock [data-tool]), builder-mode, drawing-view, hotkey-hints.
  tools: ['select', 'rig', 'tweener', 'line', 'chain', 'circle', 'polygon', 'hand', 'drawing-brush',
    'drawing-eraser', 'drawing-fill', 'drawing-lasso', 'drawing-shape', 'drawing-transform'],
  // studio-shell binds every [data-workspace-mode] once at startup, including #builder-done.
  workspaceModes: ['animate', 'draw', 'rig'],
  // app.mjs queries [data-app-menu] once at module evaluation.
  appMenus: ['file', 'edit', 'view', 'editor', 'animation', 'help'],
  // studio-shell listens for [data-timeline-mode] clicks on #timeline-workflow.
  timelineModes: ['simple', 'advanced'],
  // Static accessible names that tests query with getByRole.
  accessibleNames: ['Onion skin settings', 'Audio', 'Timeline zoom', 'Undo', 'Redo', 'Play'],
  // Changing the policy is a security review, never a side effect of a redesign.
  csp: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'",
});

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// app.mjs owns the actions map and passes it to modules that register more.
const actionSources = readdirSync(new URL('../src/', import.meta.url), {recursive: true})
  .filter(file => file.endsWith('.mjs'))
  .map(file => readFileSync(new URL(`../src/${file.replaceAll('\\', '/')}`, import.meta.url), 'utf8'))
  .filter(source => /const actions = \{|Object\.assign\(actions,/.test(source));
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** A small tag-stack scanner: enough HTML for a static, well-formed shell. */
export function parseHtml(text) {
  const root = {tag: '#root', attrs: {}, children: [], parent: null};
  const all = [];
  let node = root, i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) { i = text.indexOf('-->', lt) + 3; continue; }
    if (text.startsWith('<!', lt)) { i = text.indexOf('>', lt) + 1; continue; }
    if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt), tag = text.slice(lt + 2, end).trim().toLowerCase();
      if (node.tag !== tag) throw new Error(`Unexpected </${tag}> inside <${node.tag}> at offset ${lt}`);
      node = node.parent; i = end + 1; continue;
    }
    const match = /^<([a-zA-Z][\w-]*)/.exec(text.slice(lt));
    if (!match) { i = lt + 1; continue; }
    const element = {tag: match[1].toLowerCase(), attrs: {}, children: [], parent: node, text: ''};
    const attr = /\s*([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?|\s*(\/?>)/y;
    attr.lastIndex = lt + match[0].length;
    let selfClosing = false;
    for (;;) {
      const part = attr.exec(text);
      if (!part) throw new Error(`Unterminated <${element.tag}> at offset ${lt}`);
      if (part[5]) { selfClosing = part[5] === '/>'; break; }
      element.attrs[part[1].toLowerCase()] = part[2] ?? part[3] ?? part[4] ?? '';
    }
    i = attr.lastIndex;
    node.children.push(element); all.push(element);
    if (element.tag === 'script' || element.tag === 'style') {
      const close = text.indexOf(`</${element.tag}`, i);
      element.text = text.slice(i, close);
      i = text.indexOf('>', close) + 1;
    } else if (!selfClosing && !VOID.has(element.tag)) node = element;
  }
  if (node !== root) throw new Error(`Unclosed <${node.tag}>`);
  return {root, all};
}

/** Action names registered on the `actions` map: the `const actions = {…}`
 * literal in app.mjs, `Object.assign(actions, {…})` in any module it passes the
 * map to, and `actions["x"] =` assignments. Keys built at runtime (zoom-25 …)
 * are not found; index.html uses none of them. */
export function actionKeys(sources) {
  const keys = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/const actions = \{|Object\.assign\(actions,\s*\{/g))
      for (const key of objectKeys(source, match.index + match[0].length - 1)) keys.add(key);
    for (const match of source.matchAll(/\bactions(?:\[\s*(['"])([^'"]+)\1\s*\]|\.([A-Za-z_$][\w$]*))\s*=(?!=)/g))
      keys.add(match[2] ?? match[3]);
  }
  return keys;
}

/** Top-level property names of the object literal whose `{` is at `open`.
 * Aware of strings, template literals, comments and regular expressions. */
export function objectKeys(source, open) {
  const keys = new Set(), stack = [];
  const KEY = /^(?:async\s+)?(?:([A-Za-z_$][\w$]*)|'([^'\\]*)'|"([^"\\]*)")\s*[:(,}]/;
  let i = open, expectKey = false, last = '';
  // Skips the quoted string or regular expression that starts at `from`.
  const skipLiteral = (from, close) => {
    let inClass = false;
    for (let j = from + 1; j < source.length; j++) {
      if (source[j] === '\\') j++;
      else if (close === '/' && source[j] === '[') inClass = true;
      else if (close === '/' && source[j] === ']') inClass = false;
      else if (source[j] === close && !inClass) return j + 1;
    }
    throw new Error(`Unterminated literal at offset ${from} of an actions source`);
  };
  while (i < source.length) {
    const ch = source[i];
    if (stack.at(-1) === '`') {
      // Template text: only an escape, `${` or the closing backtick matter.
      if (ch === '\\') i += 2;
      else if (ch === '`') { stack.pop(); i++; last = 'x'; }
      else if (source.startsWith('${', i)) { stack.push('${'); i += 2; last = '{'; }
      else i++;
      continue;
    }
    if (/\s/.test(ch)) { i++; continue; }
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i); continue; }
    if (source.startsWith('/*', i)) { i = source.indexOf('*/', i) + 2; continue; }
    if (expectKey) {
      expectKey = false;
      const key = KEY.exec(source.slice(i, i + 200));
      if (key) keys.add(key[1] ?? key[2] ?? key[3]);
    }
    if (ch === '"' || ch === "'") { i = skipLiteral(i, ch); last = 'x'; continue; }
    if (ch === '/' && !/[\w$)\]]/.test(last)) { i = skipLiteral(i, '/'); last = 'x'; continue; }
    i++;
    if (ch === '`' || '{[('.includes(ch)) {
      stack.push(ch);
      if (ch === '{' && stack.length === 1) expectKey = true;
    } else if ('}])'.includes(ch)) {
      stack.pop();
      if (!stack.length) break;
    } else if (ch === ',' && stack.length === 1) expectKey = true;
    last = ch;
  }
  return keys;
}

const {root, all} = parseHtml(html);
const byId = new Map();
for (const element of all) if ('id' in element.attrs) byId.set(element.attrs.id, [...(byId.get(element.attrs.id) || []), element]);
const values = name => all.filter(element => name in element.attrs).map(element => element.attrs[name]);
const classes = element => (element.attrs.class || '').split(/\s+/).filter(Boolean);
// Supports `#id`, `.class` and `[name="value"]`, which is all this contract needs.
const matches = (element, selector) => {
  if (selector.startsWith('#')) return element.attrs.id === selector.slice(1);
  if (selector.startsWith('.')) return classes(element).includes(selector.slice(1));
  const [, name, value] = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
  return element.attrs[name] === value;
};
const find = (selector, scope = root) => {
  const found = [];
  const walk = node => { for (const child of node.children) { if (matches(child, selector)) found.push(child); walk(child); } };
  walk(scope);
  return found;
};
const one = (selector, scope) => {
  const found = find(selector, scope);
  assert.equal(found.length, 1, `${selector} appears exactly once${scope ? ' in its container' : ''}`);
  return found[0];
};
const flat = groups => Object.values(groups).flat();

test('Every shell id appears exactly once and ids stay unique', () => {
  const ids = flat(SHELL_CONTRACT.ids);
  assert.equal(new Set(ids).size, ids.length, 'contract ids are listed once');
  for (const id of ids) assert.equal(byId.get(id)?.length, 1, `#${id} appears exactly once in index.html`);
  for (const [id, elements] of byId) assert.equal(elements.length, 1, `#${id} is unique`);
});

test('Every data-action in the shell is a registered action and none disappeared', () => {
  const keys = actionKeys(actionSources);
  assert.ok(keys.size > 100, `actions map was scanned (${keys.size} keys)`);
  const present = new Set(values('data-action'));
  for (const action of flat(SHELL_CONTRACT.actions)) assert.ok(present.has(action), `[data-action="${action}"] is still in index.html`);
  for (const action of present) assert.ok(keys.has(action), `[data-action="${action}"] has an actions entry in app.mjs`);
  for (const action of new Set(values('data-shift-action'))) assert.ok(keys.has(action), `[data-shift-action="${action}"] has an actions entry in app.mjs`);
});

test('Tool, mode, menu and timeline values are unchanged', () => {
  const same = (name, expected) => assert.deepEqual([...new Set(values(name))].sort(), [...expected].sort(), `${name} values`);
  same('data-shift-action', SHELL_CONTRACT.shiftActions);
  same('data-workspace-mode', SHELL_CONTRACT.workspaceModes);
  same('data-app-menu', SHELL_CONTRACT.appMenus);
  same('data-timeline-mode', SHELL_CONTRACT.timelineModes);
  const dock = one('.tool-dock');
  for (const tool of SHELL_CONTRACT.tools) assert.equal(find(`[data-tool="${tool}"]`, dock).length, 1, `.tool-dock has [data-tool="${tool}"]`);
  assert.deepEqual([...new Set(values('data-tool'))].sort(), [...SHELL_CONTRACT.tools].sort());
  assert.equal(one('#builder-done').attrs['data-workspace-mode'], 'animate');
  const workflow = one('#timeline-workflow');
  for (const mode of SHELL_CONTRACT.timelineModes) assert.equal(find(`[data-timeline-mode="${mode}"]`, workflow).length, 1, `#timeline-workflow has ${mode}`);
});

test('Structural hooks that modules dereference without null checks are intact', () => {
  const viewport = one('#viewport');
  for (const id of ['scene', 'overlay']) {
    assert.equal(byId.get(id)[0].parent, viewport, `#${id} is a direct child of #viewport`);
    assert.equal(byId.get(id)[0].tag, 'canvas', `#${id} is a canvas`);
  }
  // localization-bindings binds `.titlebar > [data-action=save|export]` and the window controls.
  const titlebar = one('.titlebar');
  for (const action of ['save', 'export']) assert.ok(titlebar.children.some(child => child.attrs['data-action'] === action), `.titlebar > [data-action="${action}"]`);
  const controls = one('#window-controls', titlebar);
  for (const action of ['minimize', 'maximize', 'close']) one(`[data-action="${action}"]`, controls);
  assert.ok(classes(one('[data-action="menu"]')).includes('brand'), '.brand[data-action="menu"] anchors the main menu');
  // studio-shell, builder-mode, builder-outliner, settings and studio-layout read .workspace;
  // studio-layout moves .timeline-panel; fittedView measures .studio-rail; user-library
  // injects its tabs into .right-panel and toggles .inspector-header; movieclip-ui
  // anchors its breadcrumb before .context-strip.
  const workspace = one('.workspace');
  for (const selector of ['.center', '.studio-rail', '.right-panel', '.context-strip']) one(selector, workspace);
  const panel = one('.timeline-panel', workspace);
  assert.equal(panel.attrs.id, 'animation-timeline');
  for (const selector of ['.timeline-toolbar', '.timeline-title', '#timeline']) one(selector, panel);
  // app.mjs hides $("timeline-zoom").closest(".timeline-actions").
  one('#timeline-zoom', one('.timeline-actions', panel));
  const inspectorPanel = one('.right-panel');
  for (const selector of ['.inspector-header', '#inspector', '#vfx-panel']) one(selector, inspectorPanel);
  one('[data-action="toggle-isolate"]', one('.tool-dock'));
  assert.equal(find('[data-action="selection-front"]')[0].attrs['data-selection-order'], '');
  assert.equal(find('[data-action="selection-back"]')[0].attrs['data-selection-order'], '');
  // Tests still select these toolbar containers; they change together with those tests.
  for (const selector of ['.canvas-toolbar', '.canvas-options', '.canvas-view-controls', '.workspace-switch']) one(selector);
  one('#zoom-label', one('.canvas-view-controls'));
  // builder-mode disables [popovertarget="builder-menu-arrange"]; the menus use the popover API.
  for (const id of ['builder-menu-edit', 'builder-menu-arrange', 'builder-menu-view']) {
    one(`[popovertarget="${id}"]`, one('#builder-bar'));
    assert.ok('popover' in byId.get(id)[0].attrs, `#${id} is a popover`);
  }
  // Modals are native dialogs: hotkeys and startup prompts key off dialog[open].
  for (const id of ['dialog', 'insert-dialog']) assert.equal(byId.get(id)[0].tag, 'dialog', `#${id} is a <dialog>`);
  assert.equal(byId.get('dialog-content')[0].parent, byId.get('dialog')[0]);
  const menu = byId.get('menu')[0], toast = byId.get('toast')[0];
  assert.ok(menu.attrs.role === 'menu' && 'hidden' in menu.attrs, '#menu is a hidden role=menu host');
  assert.ok(toast.attrs.role === 'status' && 'hidden' in toast.attrs, '#toast is a hidden status host');
  for (const id of ['file-input', 'media-input']) assert.equal(byId.get(id)[0].attrs.type, 'file');
  assert.equal(byId.get('fps')[0].attrs.type, 'number');
  assert.equal(byId.get('timeline-zoom')[0].attrs.type, 'range');
});

test('The static accessible names that tests query still exist', () => {
  const labels = new Set(values('aria-label'));
  for (const name of SHELL_CONTRACT.accessibleNames) assert.ok(labels.has(name), `aria-label="${name}"`);
});

test('The content security policy is unchanged and the markup needs no inline code', () => {
  const csp = all.filter(element => element.tag === 'meta' && element.attrs['http-equiv']?.toLowerCase() === 'content-security-policy');
  assert.equal(csp.length, 1);
  assert.equal(csp[0].attrs.content, SHELL_CONTRACT.csp);
  assert.equal(all.filter(element => element.tag === 'style').length, 0, 'no <style> element');
  for (const script of all.filter(element => element.tag === 'script')) {
    assert.ok(script.attrs.src, 'scripts are external');
    assert.equal(script.text.trim(), '', 'no inline script body');
  }
  for (const element of all)
    for (const name of Object.keys(element.attrs)) assert.ok(!/^on/.test(name), `<${element.tag} ${name}> has no inline handler`);
  for (const element of all.filter(element => 'style' in element.attrs))
    assert.match(element.attrs.style, /^(\s*--[\w-]+\s*:[^;]*;?)*\s*$/, 'inline styles hold only custom properties');
});

test('index.html links one layered stylesheet whose imports all resolve', () => {
  const links = all.filter(element => element.tag === 'link' && element.attrs.rel === 'stylesheet').map(element => element.attrs.href);
  assert.deepEqual(links, ['./src/styles/app.css'], 'src/styles/app.css imports every other sheet');
  // A sheet imported without layer() would be unlayered and beat every layer.
  for (const sheet of ['src/styles/app.css', 'src/styles/support-bridge.css']) {
    const base = new URL(`../${sheet}`, import.meta.url);
    const css = readFileSync(base, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const imports = [...css.matchAll(/@import\s+url\("([^"]+)"\)\s*([^;]*);/g)];
    assert.ok(imports.length > 1 && imports.length === (css.match(/@import/g) ?? []).length, `${sheet}: every @import uses url("…")`);
    for (const [, href, layer] of imports) {
      assert.ok(existsSync(new URL(href, base)), `${sheet} imports ${href}, which exists`);
      if (sheet.endsWith('support-bridge.css') || href.startsWith('./legacy/')) assert.equal(layer.trim(), 'layer(legacy)', `${href} loads into the legacy layer`);
    }
    if (sheet.endsWith('app.css'))
      assert.match(css.trimStart(), /^@layer legacy, reset, tokens, base, layout, components, features, states, utilities;/, 'the layer order is declared before any import');
  }
});

test('Every local stylesheet, script and image resolves inside the served web root', () => {
  // desktop/web-host.cjs serves src/, vendor/ and assets/, plus root .html/.css/.svg/.png/.ico files.
  const references = all.flatMap(element => ['href', 'src'].filter(name => element.attrs[name]).map(name => element.attrs[name]))
    .filter(reference => !/^[a-z]+:/i.test(reference) && !reference.startsWith('#'));
  assert.ok(references.length > 3);
  for (const reference of references) {
    const relative = reference.replace(/^\.\//, '');
    const parts = relative.split('/');
    assert.ok(parts.length === 1 ? /\.(html|css|svg|png|ico)$/i.test(relative) : ['src', 'vendor', 'assets'].includes(parts[0]),
      `${reference} is inside a served location`);
    assert.ok(existsSync(new URL(`../${relative}`, import.meta.url)), `${reference} exists`);
  }
});
