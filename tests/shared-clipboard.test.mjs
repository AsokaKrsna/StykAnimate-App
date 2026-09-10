import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Editor, emptyDocument} from '../src/editor.mjs';
import {SharedClipboard, clipboardSnapshot, restoreClipboard, pasteSheetClipboard} from '../src/shared-clipboard.mjs';
import {librarySnapshot} from '../src/library-files.mjs';
import {libraryDragData, readLibraryDrag, LIBRARY_DRAG_TYPE} from '../src/library-drag.mjs';
const {SharedClipboard: NativeClipboard, FORMAT} = createRequire(import.meta.url)('../desktop/shared-clipboard.cjs');

function systemClipboard() {
  let content = new Map();
  return {availableFormats: () => [...content.keys()], readBuffer: type => content.get(type),
    writeBuffer: (type, value) => { content = new Map([[type, Buffer.from(value)]]); }, clear: () => content.clear()};
}
function instance(t, os) {
  const native = new NativeClipboard(os); t.after(() => native.dispose());
  const editor = new Editor({propertyChannels: true, layerTimeline: true});
  const desktop = Object.fromEntries([['beginSharedClipboardWrite','beginWrite'],['writeSharedClipboardChunk','write'],['finishSharedClipboardWrite','finish'],['beginSharedClipboardRead','beginRead'],['readSharedClipboardChunk','read'],['cancelSharedClipboardTransfer','cancel']].map(([name, method]) => [name, async (...args) => native[method](...args)]));
  return {editor, clipboard: new SharedClipboard(editor, desktop), native};
}

test('desktop clipboard keeps a movieclip ID when pasting back into its own document',async t=>{
  const {editor,clipboard}=instance(t,systemClipboard());editor.select(1);editor.createMovieclip({start:0,end:5});const uid=editor.selectedUid;
  await clipboard.copy('figures',()=>editor.copySelection());
  for(const tick of [8,12,8]){editor.seek(tick);await clipboard.paste('figures',()=>editor.pasteSelection());assert.equal(editor.selectedUid,uid);assert.equal(editor.evaluatedFrame.objects.filter(object=>object.unique_id===uid).length,1);}
  editor.seek(8);editor.select(uid);editor.deleteSelection();assert.ok(!editor.evaluatedFrame.objects.some(object=>object.unique_id===uid));
  await clipboard.paste('figures',()=>editor.pasteSelection());assert.equal(editor.selectedUid,uid);editor.serialize();
});

test('separate instances exchange figures and joins; latest copy wins and repeat paste retains offsets', async t => {
  const os = systemClipboard(), a = instance(t, os), b = instance(t, os);
  a.editor.select(1); const child = a.editor.duplicateFigure().unique_id; a.editor.joinTo(1, 3); a.editor.select(1, {add: true});
  await a.clipboard.copy('figures', () => a.editor.copySelection());
  b.editor.load(emptyDocument()); const before = b.editor.serialize();
  await b.clipboard.paste('figures', () => b.editor.pasteSelection());
  assert.equal(b.editor.selectedObjects.length, 2);
  const [parent, joined] = b.editor.selectedObjects;
  assert.equal(joined.join.target_unique_id, parent.unique_id);
  const after = b.editor.serialize(); b.editor.undo(); assert.deepEqual(b.editor.serialize(), before); b.editor.redo(); assert.deepEqual(b.editor.serialize(), after);
  const x = b.editor.selectedObjects[0].root_x;
  await b.clipboard.paste('figures', () => b.editor.pasteSelection());
  assert.equal(b.editor.selectedObjects[0].root_x, x + 24);
  b.editor.select(joined.unique_id); await b.clipboard.copy('figures', () => b.editor.copySelection());
  await a.clipboard.paste('figures', () => a.editor.pasteSelection());
  assert.equal(a.editor.selectedObjects.length, 1); assert.equal(a.editor.object.join, null); assert.notEqual(a.editor.object.unique_id, child);
});

test('filmstrip paste creates missing layers and restores all animation in one undo', async t => {
  const os = systemClipboard(), a = instance(t, os), b = instance(t, os), e = a.editor;
  const extra = e.createLayer('Second character'); e.assignFiguresToLayer([3], extra.id);
  e.sheetAppendFrame(); e.select(1); e.moveSelection(60, 20);
  const ids = ['scene', 'camera', ...e.report._styk.layers.order];
  await a.clipboard.copy('sheet', () => e.sheetCopyFrames(ids, 0, e.totalTicks - 1));
  b.editor.load(emptyDocument()); const before = b.editor.serialize(), history = b.editor._undo.length;
  await b.clipboard.paste('sheet', () => pasteSheetClipboard(b.editor, ['scene', 'camera', ...b.editor.report._styk.layers.order], 0, {wholeScene: true, insert: true}));
  assert.equal(b.editor.report._styk.layers.order.length, 2); assert.equal(b.editor._undo.length, history + 1);
  const after = b.editor.serialize(); b.editor.undo(); assert.deepEqual(b.editor.serialize(), before); b.editor.redo(); assert.deepEqual(b.editor.serialize(), after);
});

test('wire transfers embedded media and movieclip definitions without dropping bytes', async t => {
  const os = systemClipboard(), a = instance(t, os), b = instance(t, os);
  a.editor.select(1); a.editor.createMovieclip({start: 0, end: 12});
  a.editor.figure._styk.testAsset = 'data:image/png;base64,' + 'ABCD'.repeat(90000);
  await a.clipboard.copy('figures', () => a.editor.copySelection());
  await b.clipboard.paste('figures', () => b.editor.pasteSelection());
  assert.equal(b.editor.figure._styk.movieclip.duration, 12);
  assert.equal(b.editor.figure._styk.testAsset, a.editor.figure._styk.testAsset);
});

test('whole-scene paste shifts surplus destination layers and keeps their artwork outside the inserted frames', async t => {
  const os = systemClipboard(), a = instance(t, os), b = instance(t, os);
  a.editor.load(emptyDocument()); a.editor.addFigure(1);
  await a.clipboard.copy('sheet', () => a.editor.sheetCopyFrames(['scene','camera','layer-1'], 0, 2));
  const layer = b.editor.createLayer('Existing artwork'); b.editor.assignFiguresToLayer([3], layer.id);
  const before = b.editor.serialize();
  await b.clipboard.paste('sheet', () => pasteSheetClipboard(b.editor, ['scene','camera',...b.editor.report._styk.layers.order], 0, {insert:true,wholeScene:true}));
  assert.ok(!b.editor.selectionFrame.objects.some(o => o.unique_id === 3));
  b.editor.seek(3); assert.ok(b.editor.selectionFrame.objects.some(o => o.unique_id === 3));
  b.editor.undo(); assert.deepEqual(b.editor.serialize(),before);
});

test('unrelated OS text and a mismatched clipboard never paste stale local figures', async t => {
  const os = systemClipboard(), a = instance(t, os); a.editor.select(1);
  await a.clipboard.copy('figures', () => a.editor.copySelection()); const before = a.editor.serialize();
  os.clear(); await assert.rejects(a.clipboard.paste('figures', () => a.editor.pasteSelection()), /Copy figures or frames/);
  await a.clipboard.copy('sheet', () => a.editor.sheetCopyFrames(['layer-1'], 0, 0));
  await assert.rejects(a.clipboard.paste('figures', () => a.editor.pasteSelection()), /timeline/);
  assert.deepEqual(a.editor.serialize(), before);
});

test('failed publication restores the previous OS clipboard instead of misidentifying new local data', async t => {
  const os = systemClipboard(), a = instance(t, os); a.editor.select(1);
  await a.clipboard.copy('figures', () => a.editor.copySelection());
  a.clipboard.desktop.writeSharedClipboardChunk = async () => { throw new Error('Write failed'); };
  await assert.rejects(a.clipboard.copy('sheet', () => a.editor.sheetCopyFrames(['layer-1'],0,0)), /Write failed/);
  await a.clipboard.paste('figures', () => a.editor.pasteSelection());
  assert.equal(a.editor.selectedObjects.length,1); assert.equal(a.clipboard.kind,'figures'); assert.equal(a.native.jobs.size,0);
});

test('cancelled or malformed native transfers preserve the last completed copy', () => {
  const os = systemClipboard(), native = new NativeClipboard(os);
  try {
    const first = native.beginWrite(); native.write(first.token, new Uint8Array([1,2,3]).buffer); const saved = native.finish(first.token);
    const second = native.beginWrite(); native.write(second.token, new Uint8Array([4]).buffer); native.cancel(second.token);
    assert.equal(native.beginRead(saved.id).unchanged, true);
    const read = native.beginRead(); os.clear(); assert.deepEqual([...new Uint8Array(native.read(read.token).bytes)], [1,2,3]);
    const invalid = Buffer.concat([Buffer.from(saved.id), Buffer.from([255,255,255,255,1])]); os.writeBuffer(FORMAT, invalid);
    const transfer = native.beginRead(); assert.throws(() => native.read(transfer.token), /packet size/);
    assert.equal(native.jobs.size, 0);
  } finally { native.dispose(); }
});

test('document switch during a shared read does not modify the new clipboard or project', async t => {
  const os = systemClipboard(), a = instance(t, os), b = instance(t, os);
  a.editor.select(1); await a.clipboard.copy('figures', () => a.editor.copySelection());
  const read = b.clipboard.desktop.readSharedClipboardChunk;
  b.clipboard.desktop.readSharedClipboardChunk = async token => { b.editor.load(emptyDocument()); return read(token); };
  await assert.rejects(b.clipboard.paste('figures', () => b.editor.pasteSelection()), {name: 'AbortError'});
  assert.equal(b.editor._selectionClipboard, undefined); assert.equal(b.native.jobs.size, 0);
});

test('native frame snapshots still round trip into another editor', async () => {
  const a = new Editor(), b = new Editor(); a.copyFrames([0,1]);
  await restoreClipboard(b, structuredClone(clipboardSnapshot(a, 'frames')));
  assert.equal(b.clipboardFrameCount, 2); b.pasteFrames(); b.serialize();
});

for (const layers of [false, true]) test(`library drop placement preserves sets and one undo (layers=${layers})`, () => {
  const source = new Editor(); source.select(1); source.select(3, {add:true});
  const doc = librarySnapshot(source), editor = new Editor({propertyChannels:true, layerTimeline:layers});
  const before = editor.serialize(), history = editor._undo.length;
  editor.importFigure(doc, {position:{x:123,y:87}});
  const objects = editor.selectedObjects;
  assert.ok(Math.abs(objects.reduce((sum,o) => sum + o.root_x,0)/objects.length - 123) < 1e-8);
  assert.ok(Math.abs(objects.reduce((sum,o) => sum + o.root_y,0)/objects.length - 87) < 1e-8);
  assert.equal(editor._undo.length, history+1); editor.undo(); assert.deepEqual(editor.serialize(), before);
  assert.throws(() => editor.importFigure(doc, {position:{x:NaN,y:0}}), /position/);
});

test('library drag rejects folders and paths outside the library', () => {
  assert.equal(libraryDragData({kind:'folder'}), null);
  const item = {kind:'figure',path:'Characters/Hero.stkz',name:'Hero'};
  assert.equal(readLibraryDrag({getData:type => type === LIBRARY_DRAG_TYPE ? libraryDragData(item) : ''}).path, item.path);
  for (const path of ['../secret','C:/secret','/secret','foo/../secret']) assert.throws(() => readLibraryDrag({getData:() => libraryDragData({...item,path})}), /Invalid/);
});
