import test from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../src/editor.mjs';
import {buildContainerV2, decodeDocument} from '../src/native-container.mjs';
import {projectColors, paletteColors, paletteView, setPaletteView, rememberColor, recentColors, setRecentColors, subscribePalette, PROJECT_PALETTE_LIMIT} from '../src/color-palette.mjs';

test('project colors are one undoable edit each and never touch frames', () => {
  const editor = new Editor({layerTimeline: true}), frames = JSON.stringify(editor.report.keyframes), events = [];
  editor.addEventListener('change', event => events.push(event.detail));
  assert.equal(editor.addPaletteColor('#FF8800'), true);
  assert.equal(editor.addPaletteColor([255, 136, 0]), false, 'the same color is not added twice');
  editor.addPaletteColor('#102030'); editor.addPaletteColor('#abcdef');
  assert.deepEqual(projectColors(editor.report), ['#ff8800', '#102030', '#abcdef']);
  assert.ok(events.every(detail => detail.palette), 'palette edits say so, so the app keeps rendering caches');
  editor.movePaletteColor('#abcdef', 0);
  assert.deepEqual(projectColors(editor.report), ['#abcdef', '#ff8800', '#102030']);
  editor.removePaletteColor('#ff8800');
  assert.deepEqual(projectColors(editor.report), ['#abcdef', '#102030']);
  editor.undo(); assert.deepEqual(projectColors(editor.report), ['#abcdef', '#ff8800', '#102030']);
  editor.undo(); editor.undo(); editor.undo(); editor.undo();
  assert.equal(editor.report._styk.palette, undefined, 'undoing the first color leaves no empty palette behind');
  assert.equal(editor.dirty, false);
  editor.redo(); assert.deepEqual(projectColors(editor.report), ['#ff8800']);
  assert.equal(JSON.stringify(editor.report.keyframes), frames);
  assert.throws(() => editor.addPaletteColor('orange'), /HEX/);
});

test('the project palette is full at its limit and removing the last color deletes it', () => {
  const editor = new Editor({layerTimeline: true});
  for (let i = 0; i < PROJECT_PALETTE_LIMIT; i++) editor.addPaletteColor('#' + i.toString(16).padStart(6, '0'));
  assert.throws(() => editor.addPaletteColor('#ffffff'), /full/);
  const one = new Editor({layerTimeline: true}); one.addPaletteColor('#123456'); one.removePaletteColor('#123456');
  assert.equal(one.report._styk.palette, undefined);
});

test('project colors save and reopen with the project, and damaged entries are ignored', async () => {
  const editor = new Editor({layerTimeline: true}); editor.addPaletteColor('#ff0000'); editor.addPaletteColor('#00ff00');
  const {document} = await decodeDocument(await buildContainerV2(editor.report, 'styk'), 'styk');
  const reopened = new Editor({layerTimeline: true}); reopened.load(document);
  assert.deepEqual(projectColors(reopened.report), ['#ff0000', '#00ff00']);
  assert.deepEqual(projectColors({_styk: {palette: {colors: ['#FF0000', 'red', '#ff0000', 7, '#00ff00']}}}), ['#ff0000', '#00ff00']);
});

test('recent colors and the chosen view are shared, and the view follows the project until chosen', () => {
  let calls = 0; const stop = subscribePalette(() => calls++);
  setRecentColors([]);
  rememberColor('#AA0000'); rememberColor('#00aa00'); rememberColor('#aa0000'); rememberColor('nope');
  assert.deepEqual(recentColors(), ['#aa0000', '#00aa00']);
  assert.equal(paletteView([]), 'recent'); assert.equal(paletteView(['#ffffff']), 'project');
  const report = {_styk: {palette: {version: 1, colors: ['#ffffff']}}};
  assert.deepEqual(paletteColors(report), {view: 'project', colors: ['#ffffff'], project: ['#ffffff']});
  setPaletteView('recent');
  assert.equal(paletteColors(report).view, 'recent');
  assert.deepEqual(paletteColors(report).colors, ['#aa0000', '#00aa00']);
  assert.throws(() => setPaletteView('library'));
  stop(); assert.ok(calls >= 4);
});
