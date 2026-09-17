/** StykAnimate native container codec (worker side).
 *
 * Container version 1: 56-byte header + zlib-compressed UTF-8 JSON document.
 * Container version 2: same 56-byte header (version=2; the size/digest fields
 * cover the JSON skeleton) + a u32 section count + 64-byte section records +
 * section payloads. Inside the skeleton, large values are replaced by string
 * markers resolved against the binary sections:
 *   "S2B:<t>:<s>:<o>:<n>"  numeric array, n elements of type t in section s
 *   "S2S:<s>:<o>:<n>"      string = base64 of the raw byte range
 *   "S2D:<s>:<o>:<n> <p>"  string = literal prefix p + base64 of the range
 *   "S2E:<rest>"           escape for a literal string that starts like a marker
 * Section record (64 bytes): <kind u8, codec u8, reserved u16, pad u32,
 * rawLen u64, storedLen u64, sha256(raw) 32, pad 8>. Kind 1 = numeric arrays,
 * kind 2 = decoded payload blobs.
 * Codec 0 = stored, 1 = zlib-wrapped deflate, 2 = zstd. The skeleton's codec
 * shares byte 5 of the header. A marker resolves to a fresh plain Array (or
 * string); markers with identical text resolve to the *same* array instance so
 * shared pose/key sequences keep their identity through a save/load cycle.
 */
const HEADER = 56, SECTION = 64, MAX_BYTES = 256 * 1024 * 1024;
// A sectioned scene's JSON metadata can exceed its compressed-file/section
// limit. Keep it below the engine string ceiling and retain the 1 GiB combined
// materialization budget; source uploads and individual sections stay bounded.
const MAX_SKELETON_BYTES = 384 * 1024 * 1024;
const MAGIC = {styk: 'STYK', stkz: 'STKZ', stykmov: 'STMV'};
const LIFT_MIN_ARRAY = 32, LIFT_MIN_STRING = 64 * 1024;
const B64_FIELDS = new Set(['data_base64', 'source_base64']);
const TYPES = {u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, i32: Int32Array, f32: Float32Array, f64: Float64Array};
const TYPE_BYTES = {u8: 1, u16: 2, u32: 4, i32: 4, f32: 4, f64: 8};
const MARKER_ARRAY = /^S2B:(u8|u16|u32|i32|f32|f64):(\d+):(\d+):(\d+)$/;
const MARKER_B64 = /^S2S:(\d+):(\d+):(\d+)$/;
const MARKER_DATA = /^S2D:(\d+):(\d+):(\d+):(.*)$/s;
const ESCAPABLE = /^S2[BSED]:/;

const encoder = new TextEncoder(), decoder = new TextDecoder();
const bytesToHex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

export async function sha256(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', view));
}

export function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function inflate(bytes, limit = MAX_BYTES) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buffer = await new Response(stream).arrayBuffer();
  if (buffer.byteLength > limit) throw new Error('The StykAnimate document exceeds the uncompressed size limit.');
  return new Uint8Array(buffer);
}

export async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let zstdModule = null, zstdFailed = false;
export async function zstd() {
  if (zstdModule || zstdFailed) return zstdModule;
  try { zstdModule = await import('../vendor/zstd/index.mjs'); await zstdModule.init(); }
  catch { zstdModule = null; zstdFailed = true; }
  return zstdModule;
}

/** Compress with the preferred available codec; returns {codec, bytes}. */
async function pack(bytes) {
  const z = await zstd();
  if (z) return {codec: 2, bytes: await z.compress(bytes, 3)};
  return {codec: 1, bytes: await deflate(bytes)};
}

async function unpack(codec, bytes, rawLength) {
  if (codec === 0) {
    if (bytes.byteLength !== rawLength) throw new Error('The StykAnimate file is damaged (invalid payload length).');
    return bytes;
  }
  if (codec === 1) {
    const out = await inflate(bytes, rawLength);
    if (out.byteLength !== rawLength) throw new Error('The StykAnimate file is damaged (invalid payload length).');
    return out;
  }
  if (codec === 2) {
    const z = await zstd();
    if (!z) throw Object.assign(new Error('This project uses zstd compression this build cannot decode. Update the app to open this file.'), {code: 'codec_unavailable'});
    const out = await z.decompress(bytes, rawLength);
    if (out.byteLength !== rawLength) throw new Error('The StykAnimate file is damaged (invalid payload length).');
    return out;
  }
  throw new Error('Unsupported StykAnimate file version. Update the app to open this file.');
}

function parseHeader(bytes, kind) {
  if (bytes.byteLength < HEADER) throw new Error('The StykAnimate file is truncated or has an invalid header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (decoder.decode(bytes.subarray(0, 4)) !== MAGIC[kind])
    throw new Error('The StykAnimate file type does not match its extension.');
  const version = view.getUint8(4), codec = view.getUint8(5), flags = view.getUint16(6, true);
  if (flags !== 0) throw new Error('Unsupported StykAnimate file version. Update the app to open this file.');
  const raw = view.getBigUint64(8, true), stored = view.getBigUint64(16, true);
  if (raw <= 0n || raw > BigInt(version === 2 ? MAX_SKELETON_BYTES : MAX_BYTES) || stored > BigInt(MAX_BYTES))
    throw new Error('The native document exceeds the uncompressed size limit.');
  return {view, version, codec, raw: Number(raw), stored: Number(stored), digest: bytes.subarray(24, 56)};
}

const equalBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Read any supported container/legacy form. Returns
 *  {document, version, skeletonBytes} — for v2, `document` already has binary
 *  markers materialized; `skeletonBytes` is the raw JSON section payload. */
export async function decodeDocument(data, kind) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_BYTES) throw new Error('The native file exceeds the compressed size limit.');
  if (kind === 'styk') {
    let probe = bytes;
    // BOM/whitespace-tolerant plain JSON read compatibility.
    while (probe.length && (probe[0] === 0xef || probe[0] === 0xbb || probe[0] === 0xbf || probe[0] === 32 || probe[0] === 9 || probe[0] === 13 || probe[0] === 10)) probe = probe.subarray(1);
    if (probe[0] === 0x7b) return {document: JSON.parse(decoder.decode(bytes)), version: 0, skeletonBytes: bytes, materializedBytes: bytes.byteLength};
  }
  const header = parseHeader(bytes, kind);
  if (header.version === 1) {
    if (HEADER + header.stored !== bytes.byteLength)
      throw new Error('The StykAnimate file is truncated or has trailing data.');
    const payload = await unpack(header.codec, bytes.subarray(HEADER), header.raw);
    if (!(await sha256(payload)).every((b, i) => b === header.digest[i]))
      throw new Error('The StykAnimate file is damaged (checksum mismatch).');
    return {document: JSON.parse(decoder.decode(payload)), version: 1, skeletonBytes: payload, materializedBytes: payload.byteLength};
  }
  if (header.version !== 2)
    throw new Error('Unsupported StykAnimate file version. Update the app to open this file.');
  // Layout: header(56) | count u32 | compressed skeleton | N x 64B records | payloads.
  const count = header.view.getUint32(HEADER, true);
  const skeletonEnd = HEADER + 4 + header.stored;
  if (count > 64 || skeletonEnd + count * SECTION > bytes.byteLength)
    throw new Error('The StykAnimate file is truncated or has an invalid header.');
  const records = [];
  let pos = skeletonEnd + count * SECTION, expected = header.raw;
  for (let i = 0; i < count; i++) {
    const off = skeletonEnd + i * SECTION, view = header.view;
    const section = {kind: view.getUint8(off), codec: view.getUint8(off + 1),
      raw: Number(view.getBigUint64(off + 8, true)), stored: Number(view.getBigUint64(off + 16, true)),
      digest: bytes.subarray(off + 24, off + 56)};
    if (section.raw > MAX_BYTES || pos + section.stored > bytes.byteLength)
      throw new Error('The StykAnimate file is truncated or has an invalid section table.');
    expected += section.raw * 3; // materialized JSON upper bound (base64 growth)
    records.push({...section, offset: pos}); pos += section.stored;
  }
  if (pos !== bytes.byteLength) throw new Error('The StykAnimate file is truncated or has trailing data.');
  if (expected > MAX_BYTES * 4)
    throw new Error('The native document exceeds the uncompressed size limit.');
  const skeleton = await unpack(header.codec, bytes.subarray(HEADER + 4, skeletonEnd), header.raw);
  if (!(await sha256(skeleton)).every((b, i) => b === header.digest[i]))
    throw new Error('The StykAnimate file is damaged (checksum mismatch).');
  const sections = [];
  for (const section of records) {
    const raw = await unpack(section.codec, bytes.subarray(section.offset, section.offset + section.stored), section.raw);
    if (!(await sha256(raw)).every((b, i) => b === section.digest[i]))
      throw new Error('The StykAnimate file is damaged (checksum mismatch).');
    if (section.kind !== 1 && section.kind !== 2)
      throw new Error('The StykAnimate file has an unknown section kind.');
    sections.push({kind: section.kind, bytes: raw});
  }
  const document = JSON.parse(decoder.decode(skeleton));
  return {document: materializeMarkers(document, sections), version: 2, skeletonBytes: skeleton, materializedBytes: expected};
}

/** Replace v2 marker strings with plain arrays/strings. Identical markers
 * resolve to one shared array instance (pose/key sequences rely on identity). */
export function materializeMarkers(node, sections) {
  const shared = new Map();
  const resolve = value => {
    let match = MARKER_ARRAY.exec(value);
    if (match) {
      const cached = shared.get(value);
      if (cached) return cached;
      const s = +match[2], offset = +match[3], count = +match[4], type = match[1];
      const section = sections[s];
      if (!section || section.kind !== 1 || offset % TYPE_BYTES[type] || offset + count * TYPE_BYTES[type] > section.bytes.byteLength)
        throw new Error('The StykAnimate file is damaged (invalid array section reference).');
      const view = new TYPES[type](section.bytes.buffer, section.bytes.byteOffset + offset, count);
      const array = Array.prototype.slice.call(view);
      // Binary sections can encode NaN/Infinity, which JSON cannot express;
      // the service-side document validation rejects non-finite values.
      for (const item of array) if (!Number.isFinite(item)) throw new Error('The StykAnimate document contains non-finite numbers.');
      shared.set(value, array);
      return array;
    }
    if ((match = MARKER_B64.exec(value)) || (match = MARKER_DATA.exec(value))) {
      const s = +match[1], offset = +match[2], count = +match[3], section = sections[s];
      if (!section || section.kind !== 2 || offset + count > section.bytes.byteLength)
        throw new Error('The StykAnimate file is damaged (invalid payload section reference).');
      const encoded = bytesToBase64(section.bytes.subarray(offset, offset + count));
      return match[0][2] === 'S' ? encoded : match[4] + encoded;
    }
    if (value.startsWith('S2E:')) return value.slice(4);
    if (value.startsWith('S2B:') || value.startsWith('S2S:') || value.startsWith('S2D:'))
      throw new Error('The StykAnimate file is damaged (malformed section marker).');
    return value;
  };
  const walk = value => {
    if (typeof value === 'string') return value.length > 3 && value.charCodeAt(0) === 83 ? resolve(value) : value;
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) value[i] = walk(value[i]); return value; }
    if (value && typeof value === 'object')
      for (const key of Object.keys(value)) {
        const walked = walk(value[key]);
        if (walked === value[key]) continue;
        if (key === '__proto__') Object.defineProperty(value, key, {value: walked, writable: true, configurable: true, enumerable: true});
        else value[key] = walked;
      }
    return value;
  };
  return walk(node);
}

/** Pick the smallest exact binary encoding for a plain numeric array.
 *  Integers stay exact; floats use f32 only when every value round-trips. */
function arrayType(values) {
  let ints = true, min = Infinity, max = -Infinity, f32 = true;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    if (Number.isInteger(v)) {
      if (Math.abs(v) >= 2 ** 53) return null; // JSON ints may exceed f64
      if (v < min) min = v; if (v > max) max = v;
    } else ints = false;
    if (f32 && Math.fround(v) !== v) f32 = false;
  }
  if (ints) {
    if (min >= 0) {
      if (max <= 0xff) return 'u8';
      if (max <= 0xffff) return 'u16';
      if (max <= 0xffffffff) return 'u32';
    } else if (min >= -0x80000000 && max <= 0x7fffffff) return 'i32';
    return 'f64';
  }
  return f32 ? 'f32' : 'f64';
}

/** Walk an editable document and produce the v2 skeleton + binary sections.
 *  Returns {skeleton, sections:[{kind, bytes}], blobOffsets}. The input is
 *  never mutated; shared array/blob content is deduplicated to one section
 *  range so its identity survives the round-trip through identical marker
 *  text. `preBlobs` reserves leading ranges in the payload section for bytes
 *  supplied by the caller (e.g. a fetched original source); blobOffsets[i]
 *  gives each one's offset for use in a caller-written S2S marker. */
export function liftDocument(document, {preBlobs = []} = {}) {
  const arrays = [], blobs = [], seenArrays = new Map(), seenBlobs = new Map();
  let arraysLength = 0, blobsLength = 0;
  const blobOffsets = preBlobs.map(bytes => { const o = blobsLength; blobs.push(bytes); blobsLength += bytes.byteLength; return o; });
  const align = (length, type) => length + ((TYPE_BYTES[type] - (length % TYPE_BYTES[type])) % TYPE_BYTES[type]);
  const lift = (value, key) => {
    if (typeof value === 'string') {
      if (value.length >= LIFT_MIN_STRING) {
        let base64 = null, prefix = '';
        if (B64_FIELDS.has(key)) base64 = value;
        else if ((key === 'data_url' || key === 'styk_tiles') && value.startsWith('data:')) {
          const comma = value.indexOf(',');
          if (comma > 5 && value.slice(0, comma).endsWith(';base64')) { base64 = value.slice(comma + 1); prefix = value.slice(0, comma + 1); }
        }
        if (base64 !== null) {
          const hit = seenBlobs.get(base64);
          if (hit) return prefix ? `S2D:${hit.s}:${hit.o}:${hit.n}:${prefix}` : `S2S:${hit.s}:${hit.o}:${hit.n}`;
          try {
            const bytes = base64ToBytes(base64);
            if (bytesToBase64(bytes) !== base64) return ESCAPABLE.test(value) ? 'S2E:' + value : value;
            const s = 1, o = blobsLength, n = bytes.byteLength;
            blobs.push(bytes); blobsLength += n; seenBlobs.set(base64, {s, o, n});
            return prefix ? `S2D:${s}:${o}:${n}:${prefix}` : `S2S:${s}:${o}:${n}`;
          } catch { return ESCAPABLE.test(value) ? 'S2E:' + value : value; }
        }
      }
      return ESCAPABLE.test(value) ? 'S2E:' + value : value;
    }
    if (Array.isArray(value)) {
      const type = value.length >= LIFT_MIN_ARRAY ? arrayType(value) : null;
      if (type) {
        const hit = seenArrays.get(value);
        if (hit) return hit;
        const offset = align(arraysLength, type);
        arraysLength = offset + value.length * TYPE_BYTES[type];
        const marker = `S2B:${type}:0:${offset}:${value.length}`;
        arrays.push({type, value, offset});
        seenArrays.set(value, marker);
        return marker;
      }
      return value.map(item => lift(item, ''));
    }
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value)) {
        const lifted = lift(value[key], key);
        // A literal "__proto__" key survives JSON and the transport; assigning
        // it normally would invoke the prototype setter and drop the field.
        if (key === '__proto__') Object.defineProperty(out, key, {value: lifted, writable: true, configurable: true, enumerable: true});
        else out[key] = lifted;
      }
      return out;
    }
    return value;
  };
  const skeleton = lift(document, '');
  const arraysBytes = new Uint8Array(arraysLength);
  for (const entry of arrays)
    new TYPES[entry.type](arraysBytes.buffer, entry.offset, entry.value.length).set(entry.value);
  const blobsBytes = new Uint8Array(blobsLength);
  let offset = 0;
  for (const bytes of blobs) { blobsBytes.set(bytes, offset); offset += bytes.byteLength; }
  return {skeleton, sections: [
    {kind: 1, bytes: arraysBytes}, {kind: 2, bytes: blobsBytes}], blobOffsets};
}

/** Assemble a lifted document into container v2 bytes. */
export async function encodeContainerV2(lifted, kind) {
  const skeletonBytes = encoder.encode(JSON.stringify(lifted.skeleton));
  if (skeletonBytes.byteLength > MAX_SKELETON_BYTES ||
      lifted.sections.some(section => section.bytes.byteLength > MAX_BYTES) ||
      skeletonBytes.byteLength + lifted.sections.reduce((sum, section) => sum + section.bytes.byteLength * 3, 0) > MAX_BYTES * 4)
    throw Object.assign(new Error('The StykAnimate document exceeds the uncompressed size limit.'), {code:'document_too_large'});
  const jsonPacked = await pack(skeletonBytes);
  const packed = [];
  for (const section of lifted.sections) {
    const result = await pack(section.bytes);
    packed.push({kind: section.kind, codec: result.codec, raw: section.bytes, stored: result.bytes,
      digest: await sha256(section.bytes)});
  }
  let total = HEADER + 4 + jsonPacked.bytes.byteLength + packed.length * SECTION;
  for (const section of packed) total += section.stored.byteLength;
  if (total > MAX_BYTES) throw Object.assign(new Error('The native file exceeds the compressed size limit.'), {code:'document_too_large'});
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  out.set(encoder.encode(MAGIC[kind]), 0);
  view.setUint8(4, 2); view.setUint8(5, jsonPacked.codec); view.setUint16(6, 0, true);
  view.setBigUint64(8, BigInt(skeletonBytes.byteLength), true);
  view.setBigUint64(16, BigInt(jsonPacked.bytes.byteLength), true);
  out.set(await sha256(skeletonBytes), 24);
  view.setUint32(HEADER, packed.length, true);
  out.set(jsonPacked.bytes, HEADER + 4);
  let pos = HEADER + 4 + jsonPacked.bytes.byteLength;
  for (const section of packed) {
    view.setUint8(pos, section.kind); view.setUint8(pos + 1, section.codec); view.setUint16(pos + 2, 0, true);
    view.setBigUint64(pos + 8, BigInt(section.raw.byteLength), true);
    view.setBigUint64(pos + 16, BigInt(section.stored.byteLength), true);
    out.set(section.digest, pos + 24);
    pos += SECTION;
  }
  for (const section of packed) { out.set(section.stored, pos); pos += section.stored.byteLength; }
  return out;
}

/** Lift + assemble in one step. */
export async function buildContainerV2(document, kind, options) {
  return encodeContainerV2(liftDocument(document, options), kind);
}

/** Serialize a JSON payload as container v1 (compatibility/testing). */
export async function buildContainerV1(payload, kind) {
  const bytes = payload instanceof Uint8Array ? payload : encoder.encode(payload);
  const stored = await deflate(bytes);
  const out = new Uint8Array(HEADER + stored.byteLength), view = new DataView(out.buffer);
  out.set(encoder.encode(MAGIC[kind]), 0);
  view.setUint8(4, 1); view.setUint8(5, 1); view.setUint16(6, 0, true);
  view.setBigUint64(8, BigInt(bytes.byteLength), true);
  view.setBigUint64(16, BigInt(stored.byteLength), true);
  out.set(await sha256(bytes), 24);
  out.set(stored, HEADER);
  return out;
}

/** The self-contained figure shape the file service enforces for .stkz/.stykmov. */
export function validateNativeFigure(document, kind = 'stkz') {
  const figures = document?.figure_types, frames = document?.keyframes;
  if (!Array.isArray(figures) || !figures.length || figures.some(f => !f || typeof f !== 'object') ||
      !Array.isArray(frames) || frames.length !== 1 || !frames[0] || typeof frames[0] !== 'object' ||
      !Array.isArray(frames[0].objects) || !frames[0].objects.length ||
      frames[0].objects.some(o => !o || typeof o !== 'object'))
    throw Object.assign(new Error(`A .${kind} file must contain reusable figures and one pose.`), {code: 'invalid_native_figure'});
  const objects = frames[0].objects, ids = new Set(figures.map(f => f.figure_type_id)), meta = document._styk || {};
  if (typeof meta !== 'object' || objects.some(o => !ids.has(o.figure_type_id)) ||
      document.backgrounds?.length || meta.animation || meta.simpleFrameDraft || meta.layerSheet)
    throw Object.assign(new Error(`The .${kind} figure must be self-contained.`), {code: 'invalid_native_figure'});
  for (const pose of objects) {
    const join = pose.join;
    if (join != null && (typeof join !== 'object' || !Number.isInteger(join.target_object_slot) ||
        join.target_object_slot < 0 || join.target_object_slot >= objects.length))
      throw Object.assign(new Error('Figure set joins must stay inside the saved set.'), {code: 'invalid_native_figure'});
  }
  if (kind === 'stykmov' && (figures.length !== 1 || objects.length !== 1 || objects[0].join != null ||
      !figures[0]._styk?.movieclip))
    throw Object.assign(new Error('A .stykmov file must contain one movieclip.'), {code: 'invalid_movieclip'});
}

/** Verify the embedded original source the way the service's source_bytes does:
 *  strict base64, size bound, and the recorded fingerprint. */
export async function verifyEmbeddedSource(document) {
  const metadata = document?._stykSource;
  if (!metadata) return;
  const encoded = metadata.source_base64;
  if (typeof encoded !== 'string' || encoded.length > 256 * 1024 * 1024 * 4 / 3 + 8)
    throw new Error('Invalid embedded original source');
  let bytes;
  try { bytes = base64ToBytes(encoded); } catch { throw new Error('Corrupted embedded original source'); }
  if (bytesToBase64(bytes) !== encoded) throw new Error('Corrupted embedded original source');
  const digest = await sha256(bytes);
  if (bytesToHex(digest) !== metadata.sha256)
    throw new Error('Embedded original source fingerprint does not match');
}

/** Apply the decode-time document normalization the file service performs:
 *  wrapper unwrap, native-figure shape check, browser-field removal. */
export function normalizeDecodedDocument(document, kind) {
  if (kind === 'styk' && document && document.format === 'stykanimate') {
    if (document.version !== 1 || !document.document || typeof document.document !== 'object' || Array.isArray(document.document))
      throw Object.assign(new Error('Unsupported StykAnimate project version.'), {code: 'invalid_native_version'});
    document = document.document;
  }
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw Object.assign(new Error('Project data must be a JSON object.'), {code: 'invalid_document'});
  if (kind === 'stkz' || kind === 'stykmov') validateNativeFigure(document, kind);
  const cleaned = {...document};
  delete cleaned.editable_paths; delete cleaned._codec; delete cleaned._stykWeb;
  return cleaned;
}




