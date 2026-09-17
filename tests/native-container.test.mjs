/** Container v1/v2 codec tests: lossless round-trips, marker semantics,
 *  corruption rejection, and compatibility with the v1/legacy formats. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContainerV1, buildContainerV2, encodeContainerV2, decodeDocument, liftDocument,
  normalizeDecodedDocument, bytesToBase64, base64ToBytes} from '../src/native-container.mjs';

const floats = () => Array.from({length: 64}, (_, i) => Math.sin(i) * 180);

test('sectioned metadata has a separate bound while payload and aggregate limits remain enforced',async()=>{
  const bytes=await buildContainerV2({name:'small'},'styk');
  for(const [version,raw,message] of [[1,300*1024*1024,/uncompressed size/],
    [2,385*1024*1024,/uncompressed size/],[2,300*1024*1024,/invalid payload length/]]) {
    const malformed=bytes.slice(),view=new DataView(malformed.buffer);
    view.setUint8(4,version);view.setBigUint64(8,BigInt(raw),true);
    await assert.rejects(decodeDocument(malformed,'styk'),message);
  }
  await assert.rejects(encodeContainerV2({skeleton:{},sections:[{bytes:{byteLength:257*1024*1024}}]},'styk'),
    error=>error.code==='document_too_large');
  await assert.rejects(encodeContainerV2({skeleton:{},sections:[{bytes:{byteLength:200*1024*1024}},{bytes:{byteLength:200*1024*1024}}]},'styk'),
    error=>error.code==='document_too_large');
});

test('v2 round-trips a document losslessly', async () => {
  const shared = floats();
  const doc = {
    version: 5, fps: 12, canvas: {width: 640, height: 480},
    keyframes: [{duration_raw: 2, objects: [
      {figure_type_id: 1, angles: shared, lengths: Array(64).fill(12.5),
        bends: Array.from({length: 40}, (_, i) => i - 20), uids: [0, 255, 65536, 4294967295],
        neg: [-5, -3, 7, -2147483648], join: {target_object_slot: 1}},
      {figure_type_id: 2, angles: shared},
    ]}],
    figure_types: [{figure_type_id: 1, segments: [{kind: 'line'}]}],
    _stykSource: {kind: 'piv', version: 5,
      source_base64: bytesToBase64(new TextEncoder().encode('source bytes '.repeat(6000)))},
    media: [{name: 'a.png', data_url: 'data:image/png;base64,' + bytesToBase64(new TextEncoder().encode('PNG'.repeat(50000)))}],
    title: 'S2B:looks like a marker', alt: 'S2E:also escaped',
  };
  const container = await buildContainerV2(doc, 'styk');
  assert.equal(new TextDecoder().decode(container.subarray(0, 4)), 'STYK');
  assert.equal(container[4], 2);
  const {document: out} = await decodeDocument(container, 'styk');
  assert.deepEqual(out.keyframes[0].objects[0], doc.keyframes[0].objects[0]);
  assert.deepEqual(out.keyframes[0].objects[1], doc.keyframes[0].objects[1]);
  assert.equal(out._stykSource.source_base64, doc._stykSource.source_base64);
  assert.equal(out.media[0].data_url, doc.media[0].data_url);
  assert.equal(out.title, doc.title);
  assert.equal(out.alt, doc.alt);
  // Lifted shared arrays keep one identity through the cycle.
  assert.equal(out.keyframes[0].objects[0].angles, out.keyframes[0].objects[1].angles);
});

test('v2 integer arrays pick exact-width encodings', async () => {
  const doc = {a: Array(40).fill(200), b: Array(40).fill(70000),
    c: Array(40).fill(-7), d: Array(40).fill(5e9), e: Array(40).fill(1.5)};
  const {skeleton, sections} = liftDocument(doc);
  assert.match(skeleton.a, /^S2B:u8:/);
  assert.match(skeleton.b, /^S2B:u32:/);
  assert.match(skeleton.c, /^S2B:i32:/);
  assert.match(skeleton.d, /^S2B:f64:/);  // 5e9 exceeds u32 but stays exact
  assert.match(skeleton.e, /^S2B:f32:/);  // 1.5 round-trips through f32
  const out = await decodeDocument(await buildContainerV2(doc, 'styk'), 'styk');
  assert.deepEqual(out.document.d, doc.d);
  assert.deepEqual(out.document.e, doc.e);
});

test('v2 keeps non-liftable values inline', async () => {
  const doc = {mixed: [1, 'two', 3].concat(Array(40).fill(0)).slice(0, 43),
    small: [1, 2, 3], nested: {list: [[1.5, 2.5], [3.5]]},
    bools: Array(40).fill(true), objects: Array(40).fill({x: 1}),
    // Integers at/above 2^53 are not all f64-exact; they must stay inline.
    huge: Array(40).fill(2 ** 53 + 1), proto: JSON.parse('{"__proto__":{"x":7}}')};
  const {skeleton} = liftDocument(doc);
  assert.ok(Array.isArray(skeleton.huge));
  const out = await decodeDocument(await buildContainerV2(doc, 'styk'), 'styk');
  assert.deepEqual(out.document, doc);
  assert.equal(Object.hasOwn(out.document.proto, '__proto__'), true);
});

test('v2 rejects non-finite values embedded in binary sections', async () => {
  const {encodeContainerV2} = await import('../src/native-container.mjs');
  const bytes = new Uint8Array(new Float64Array([NaN, NaN, NaN, NaN]).buffer);
  const crafted = await encodeContainerV2({skeleton: {a: 'S2B:f64:0:0:4'},
    sections: [{kind: 1, bytes}, {kind: 2, bytes: new Uint8Array()}]}, 'styk');
  await assert.rejects(() => decodeDocument(crafted, 'styk'), /non-finite/);
});

test('v1 and legacy JSON stay readable', async () => {
  const doc = {version: 5, keyframes: [{objects: []}], marker: 'S2B:0:0:0:5'};
  const v1 = await buildContainerV1(JSON.stringify(doc), 'styk');
  const out = await decodeDocument(v1, 'styk');
  assert.equal(out.version, 1);
  assert.equal(out.document.marker, 'S2B:0:0:0:5'); // v1 never scans markers
  const legacy = new TextEncoder().encode('  {"version":5,"keyframes":[]}');
  const legacyOut = await decodeDocument(legacy, 'styk');
  assert.equal(legacyOut.document.version, 5);
});

test('v2 rejects corruption, truncation, and wrong kind', async () => {
  const doc = {version: 5, keyframes: [{objects: [{angles: floats()}]}]};
  const container = await buildContainerV2(doc, 'styk');
  for (const mutate of [
    c => { const b = c.slice(); b[b.length - 3] ^= 0xff; return b; },   // payload bit
    c => { const b = c.slice(); b[30] ^= 0xff; return b; },             // skeleton digest
    c => c.subarray(0, c.length - 2),                                   // truncation
    c => new Uint8Array([...c, 0, 0]),                                  // trailing data
    c => { const b = c.slice(); b[4] = 9; return b; },                  // future version
  ]) await assert.rejects(() => decodeDocument(mutate(container), 'styk'));
  await assert.rejects(() => decodeDocument(container, 'stkz'));
  // A crafted marker pointing outside a section is rejected.
  const bad = {a: 'S2B:f64:0:0:999999'};
  const forged = await buildContainerV2({wrap: bad}, 'styk');
  const {skeleton, sections} = liftDocument(bad);
  skeleton.a = 'S2B:f64:0:8:64'; // beyond the empty arrays section
  const {encodeContainerV2} = await import('../src/native-container.mjs');
  const crafted = await encodeContainerV2({skeleton, sections}, 'styk');
  await assert.rejects(() => decodeDocument(crafted, 'styk'), /section reference|damaged/);
});

test('normalizeDecodedDocument unwraps and validates like the service', async () => {
  const inner = {version: 5, keyframes: [], editable_paths: {}, _codec: {}, _stykWeb: {}};
  const unwrapped = normalizeDecodedDocument({format: 'stykanimate', version: 1, document: inner}, 'styk');
  assert.deepEqual(unwrapped, {version: 5, keyframes: []});
  assert.throws(() => normalizeDecodedDocument({format: 'stykanimate', version: 2, document: {}}, 'styk'), /project version/);
  assert.throws(() => normalizeDecodedDocument([1, 2], 'styk'), /JSON object/);
  const figure = {figure_types: [{figure_type_id: 1}],
    keyframes: [{objects: [{figure_type_id: 1, join: {target_object_slot: 0}}]}]};
  assert.ok(normalizeDecodedDocument(figure, 'stkz').figure_types.length === 1);
  assert.throws(() => normalizeDecodedDocument({figure_types: [], keyframes: []}, 'stkz'), /reusable figures/);
  assert.throws(() => normalizeDecodedDocument({...figure, keyframes: [{objects: [{figure_type_id: 9}]}]}, 'stkz'), /self-contained/);
  assert.throws(() => normalizeDecodedDocument(figure, 'stykmov'), /one movieclip/);
});
