import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {COMMAND_BY_ID, COMMAND_CATALOG, COMMAND_CATEGORIES} from '../src/ui/command-catalog.mjs';
import {CommandRegistry, fuzzyMatch, humanizeId} from '../src/ui/command-registry.mjs';
import {DEFAULT_HOTKEYS, HOTKEY_BY_ID, HOTKEY_COMMANDS, findHotkeyConflicts, formatBinding} from '../src/hotkeys.mjs';
import {iconNames} from '../src/icons.mjs';
import english from '../src/locales/en.mjs';
// The shell contract's scanner for the actions map (app.mjs and the modules it passes the map to). Importing
// the module also registers its tests in this run; they are fast, and one parser beats two.
import {actionKeys} from './shell-contract.test.mjs';

const actionSources = readdirSync(new URL('../src/', import.meta.url), {recursive: true})
  .filter(file => file.endsWith('.mjs'))
  .map(file => readFileSync(new URL(`../src/${file.replaceAll('\\', '/')}`, import.meta.url), 'utf8'))
  .filter(source => /const actions = \{|Object\.assign\(actions,/.test(source));
const ACTIONS = actionKeys(actionSources);
const hotkeyOf = entry => entry.hotkey ?? (HOTKEY_BY_ID.has(entry.id) ? entry.id : null);

test('every catalog id is an existing action or hotkey command, listed once', t => {
  assert.ok(ACTIONS.size > 150, `the actions map was scanned (${ACTIONS.size} keys)`);
  const ids = COMMAND_CATALOG.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'catalog ids are unique');
  for (const id of ids) assert.ok(ACTIONS.has(id) || HOTKEY_BY_ID.has(id), `${id} is an actions key or a HOTKEY_COMMANDS id`);
  const missing = [...new Set([...ACTIONS, ...HOTKEY_BY_ID.keys()])].filter(id => !COMMAND_BY_ID.has(id));
  if (missing.length) t.diagnostic(`commands without catalog metadata (the registry falls back to hotkey labels): ${missing.join(', ')}`);
});

test('catalog metadata is well formed', () => {
  const categories = new Set(COMMAND_CATEGORIES.map(category => category.id)), icons = new Set(iconNames);
  for (const entry of COMMAND_CATALOG) {
    assert.ok(categories.has(entry.category), `${entry.id}: category ${entry.category}`);
    assert.ok(entry.label && entry.label === entry.label.trim(), `${entry.id}: label`);
    if (entry.icon) assert.ok(icons.has(entry.icon), `${entry.id}: glyph ${entry.icon} exists in icons.mjs`);
    if (entry.labelKey) assert.equal(english[entry.labelKey], entry.label, `${entry.id}: ${entry.labelKey} is the English label`);
    if (entry.hotkey) assert.ok(HOTKEY_BY_ID.has(entry.hotkey), `${entry.id}: hotkey alias ${entry.hotkey} exists`);
    if (entry.aliasOf) assert.ok(COMMAND_BY_ID.has(entry.aliasOf) && !COMMAND_BY_ID.get(entry.aliasOf).aliasOf, `${entry.id}: aliasOf ${entry.aliasOf}`);
    for (const mode of entry.modes ?? []) assert.ok(['animate', 'draw', 'rig'].includes(mode), `${entry.id}: mode ${mode}`);
    assert.ok(Object.isFrozen(entry), `${entry.id} is frozen`);
  }
  for (const category of COMMAND_CATEGORIES) if (category.labelKey) assert.equal(english[category.labelKey], category.label);
});

test('no two commands claim the same shortcut', () => {
  // Within a scope, the default bindings the catalog shows never collide.
  const shown = new Set(COMMAND_CATALOG.map(hotkeyOf).filter(Boolean));
  for (const id of shown)
    for (const binding of DEFAULT_HOTKEYS[id])
      assert.deepEqual(findHotkeyConflicts(DEFAULT_HOTKEYS, id, binding, false).map(command => command.id), [], `${binding} (${id}) is unique in its scope`);
  // Each hotkey is shown by one command; others may show it only as a declared alias (hotkey: …).
  const owners = new Map();
  for (const entry of COMMAND_CATALOG) {
    const hotkey = hotkeyOf(entry);
    if (!hotkey || entry.hotkey) continue;
    assert.ok(!owners.has(hotkey), `${hotkey} is shown by ${owners.get(hotkey)} and ${entry.id}`);
    owners.set(hotkey, entry.id);
  }
});

const actions = () => Object.fromEntries(['undo', 'redo', 'mirror', 'mirror-vertical', 'toggle-handles', 'delete-single-segment', 'save', 'export', 'zoom-25', 'play']
  .map(id => [id, () => id]));

test('get() describes a command from the catalog, the bindings and the context', () => {
  const registry = new CommandRegistry({actions: actions(), hotkeys: {bindings: {undo: ['Mod+KeyU'], redo: []}}, formatBinding: binding => formatBinding(binding, false)});
  const undo = registry.get('undo');
  assert.equal(undo.label, 'Undo');
  assert.equal(undo.icon, 'undo');
  assert.equal(undo.category, 'edit');
  assert.equal(undo.shortcut, 'Ctrl+U', 'the user binding, not the default');
  assert.deepEqual(registry.get('redo').shortcutParts, [], 'an unbound command shows no shortcut');
  assert.equal(registry.get('mirror').shortcut, 'Shift+H', 'default bindings when the user has none');
  assert.equal(registry.get('play').shortcut, 'Space', 'the declared hotkey alias');
  assert.equal(registry.get('zoom-25').label, 'Zoom 25', 'runtime ids without metadata still get a label');
  assert.equal(registry.get('new').enabled, false, 'a command without an implementation is not available');
  assert.equal(humanizeId('export-png-sequence'), 'Export png sequence');
});

test('availability: requirements, modes, hooks and toggles', () => {
  let context = {mode: 'animate', figure: false, handles: true};
  const registry = new CommandRegistry({
    actions: actions(), context: () => context,
    requirements: {figure: ctx => ctx.figure || 'Select a figure first'},
    availability: (id, ctx) => (id === 'save' && ctx.saving ? {enabled: false, reason: 'Saving…'} : null),
    checked: (id, ctx) => (id === 'toggle-handles' ? ctx.handles : undefined),
  });
  assert.deepEqual([registry.get('mirror').enabled, registry.get('mirror').reason], [false, 'Select a figure first']);
  context = {...context, figure: true};
  assert.equal(registry.get('mirror').enabled, true);
  const part = registry.get('delete-single-segment');
  assert.deepEqual([part.hidden, part.enabled, part.reason, part.mode], [true, false, 'In Build', 'rig'], 'Build-only commands are hidden elsewhere');
  assert.equal(registry.get('delete-single-segment', {mode: 'rig', figure: true}).hidden, false);
  assert.equal(registry.get('toggle-handles').checked, true);
  assert.equal(registry.get('toggle-handles', {handles: false}).checked, false);
  assert.equal(registry.get('undo').checked, undefined, 'plain commands have no checked state');
  context = {...context, saving: true};
  assert.deepEqual([registry.get('save').enabled, registry.get('save').reason], [false, 'Saving…']);
  registry.define('export', {when: () => ({hidden: true})});
  assert.equal(registry.get('export').hidden, true, 'define() adds a per-command hook');
});

test('labels translate through existing catalog keys', () => {
  const registry = new CommandRegistry({actions: actions(), localization: {t: key => (key === 'common.undo' ? 'Annulla' : key)}});
  assert.equal(registry.label('undo'), 'Annulla');
  assert.equal(registry.label('redo'), 'Redo', 'an untranslated key falls back to the English label');
});

test('run() goes through the app dispatch wrapper and records recents', () => {
  const calls = [];
  const registry = new CommandRegistry({
    actions: actions(), requirements: {figure: () => false},
    dispatch: (id, element, event) => { calls.push(['dispatch', id, element, event]); return id; },
    runHotkey: (id, event) => { calls.push(['hotkey', id, event]); },
  });
  const event = {type: 'keydown'};
  assert.deepEqual(registry.run('undo', {event, element: 'button', source: 'menu'}), {ran: true, reason: '', result: 'undo'});
  assert.deepEqual(registry.run('mirror'), {ran: false, reason: ''}, 'an unavailable command does not run');
  registry.run('tool-hand', {event, source: 'palette'});
  registry.run('redo', {source: 'hotkey'});
  registry.define('command-palette', {label: 'Search commands…', run: () => calls.push(['defined'])});
  registry.run('command-palette');
  assert.deepEqual(calls, [['dispatch', 'undo', 'button', event], ['hotkey', 'tool-hand', event], ['dispatch', 'redo', null, null], ['defined']]);
  assert.deepEqual(registry.recent(), ['command-palette', 'tool-hand', 'undo'], 'hotkey runs are not recents');
  registry.setRecent(['nope', 'save', 'save']);
  assert.deepEqual(registry.recent(), ['save']);
});

test('list() ranks palette rows: matches first, recents early, internal and alias ids left out', () => {
  const all = Object.fromEntries([...ACTIONS, 'zoom-25'].map(id => [id, () => {}]));   // zoom-25 is built at run time
  const registry = new CommandRegistry({actions: all, runHotkey: () => {}, context: () => ({mode: 'animate'})});
  const flip = registry.list({query: 'flip vert'});
  assert.equal(flip[0].id, 'mirror-vertical');
  assert.deepEqual(flip[0].match.ranges, [[0, 4], [5, 9]]);
  assert.equal(registry.list({query: 'fh'})[0].id, 'mirror', 'word-start abbreviations match');
  assert.equal(registry.list({query: 'mirror'})[0].id, 'mirror', 'keywords find renamed commands, and runnable ones rank first');
  const ids = registry.list().map(row => row.id);
  for (const hidden of ['close-dialog', 'builder-order', 'attach-figure', 'play-pan', 'handle-left', 'drawing-opacity-50'])
    assert.ok(!ids.includes(hidden), `${hidden} is not a palette row`);
  assert.ok(ids.includes('zoom-25'), 'runtime actions are listed');
  const split = registry.list({query: 'split'}).find(row => row.id === 'split-segment');
  assert.deepEqual([split.enabled, split.reason], [false, 'In Build'], 'other workspaces stay findable, with a reason');
  registry.recordRecent('export');
  assert.equal(registry.list()[0].id, 'export', 'recents lead the empty query');
  assert.equal(registry.list({query: 'e'}).length > 10, true);
});

test('items() turns a menu model into resolved menu items', () => {
  const registry = new CommandRegistry({actions: actions(), context: () => ({mode: 'animate'}), checked: () => true});
  const items = registry.items(['undo', null, {label: 'Canvas'}, 'toggle-handles', 'delete-single-segment', {command: 'save', label: 'Save now'},
    {label: 'More', submenu: ['redo']}]);
  assert.equal(items.length, 6, 'the Build-only command is left out');
  assert.deepEqual(items[0], {command: 'undo', label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z', danger: false, disabled: false, reason: ''});
  assert.equal(items[1], null);
  assert.deepEqual(items[2], {label: 'Canvas'});
  assert.equal(items[3].checked, true);
  assert.equal(items[4].label, 'Save now', 'model overrides win');
  assert.equal(items[5].submenu[0].command, 'redo');
});

test('fuzzyMatch() is case and accent insensitive and reports ranges', () => {
  assert.deepEqual(fuzzyMatch('SAVE', 'Save as…').ranges, [[0, 4]]);
  assert.deepEqual(fuzzyMatch('colour', 'Reset colours').ranges, [[6, 12]]);
  assert.ok(fuzzyMatch('modifica', 'Modificà'));
  assert.equal(fuzzyMatch('xyz', 'Undo'), null);
  assert.equal(fuzzyMatch('ud', 'Send backward'), null, 'scattered letters do not match');
  assert.ok(fuzzyMatch('undo', 'Undo').score > fuzzyMatch('undo', 'Undo history').score, 'an exact label wins');
});
