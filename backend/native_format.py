"""Versioned, lossless STYK/STKZ/STMV containers, independent of the Pivot codec.

Version 1 stores UTF-8 JSON compressed with zlib at level 3. Version 2 keeps the
same 56-byte header (its size/digest fields cover a JSON skeleton) and adds a
u32 section count plus 64-byte section records after the compressed skeleton.
Inside the skeleton, large values become string markers resolved against the
binary sections:

    "S2B:<t>:<s>:<o>:<n>"  numeric array, n elements of type t in section s
    "S2S:<s>:<o>:<n>"      string = base64 of the raw byte range
    "S2D:<s>:<o>:<n>:<p>"  string = literal prefix p + base64 of the range
    "S2E:<rest>"           escape for a literal string that starts like a marker

Element types are u8/u16/u32/i32/f32/f64; every encoding round-trips the exact
JSON number. Section record: <kind u8, codec u8, reserved u16, pad u32,
rawLen u64, storedLen u64, sha256(raw) 32, pad 8>. Kind 1 = numeric arrays,
kind 2 = decoded payload blobs. Codec 0 = stored, 1 = zlib, 2 = zstd (when the
optional zstandard module is available). Identical markers resolve to one
shared list, preserving array identity through a save/load cycle.
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import re
import struct
import zlib

try:
    import zstandard as _zstd
except ImportError:
    _zstd = None

HEADER = struct.Struct('<4sBBHQQ32s')
SECTION = struct.Struct('<BBHIQQ32s8x')
VERSION = 1
MAX_BYTES = 256 * 1024 * 1024
MAGIC = {'styk': b'STYK', 'stkz': b'STKZ', 'stykmov': b'STMV'}
LIFT_MIN_ARRAY = 32
LIFT_MIN_STRING = 64 * 1024
B64_FIELDS = frozenset(('data_base64', 'source_base64'))
MARKER_ARRAY = re.compile(r'^S2B:(u8|u16|u32|i32|f32|f64):(\d+):(\d+):(\d+)$')
MARKER_B64 = re.compile(r'^S2S:(\d+):(\d+):(\d+)$')
MARKER_DATA = re.compile(r'^S2D:(\d+):(\d+):(\d+):(.*)$', re.S)
ESCAPABLE = re.compile(r'^S2[BSED]:')
TYPE_BYTES = {'u8': 1, 'u16': 2, 'u32': 4, 'i32': 4, 'f32': 4, 'f64': 8}
TYPE_FORMAT = {'u8': 'B', 'u16': 'H', 'u32': 'I', 'i32': 'i', 'f32': 'f', 'f64': 'd'}
F64_INT_LIMIT = 1 << 53


def _pack(data: bytes) -> tuple[int, bytes]:
    if _zstd is not None:
        return 2, _zstd.ZstdCompressor(level=3).compress(data)
    return 1, zlib.compress(data, level=3)


def _unpack(codec: int, data: bytes, raw_length: int) -> bytes:
    if codec == 0:
        out = data
    elif codec == 1:
        try:
            out = zlib.decompress(data)
        except zlib.error as error:
            raise ValueError('The StykAnimate file is damaged (invalid compressed data).') from error
    elif codec == 2:
        if _zstd is None:
            raise ValueError('This project uses zstd compression this build cannot decode. Update the app to open this file.')
        try:
            out = _zstd.ZstdDecompressor().decompress(data, max_output_size=raw_length + 1)
        except _zstd.ZstdError as error:
            raise ValueError('The StykAnimate file is damaged (invalid compressed data).') from error
    else:
        raise ValueError('Unsupported StykAnimate file version. Update the app to open this file.')
    if len(out) != raw_length:
        raise ValueError('The StykAnimate file is damaged (invalid payload length).')
    return out


def encode(payload: bytes, kind: str, *, max_bytes=MAX_BYTES) -> bytes:
    if kind not in MAGIC:
        raise ValueError('Unknown StykAnimate file kind.')
    if not payload or len(payload) > max_bytes:
        raise ValueError('The native document exceeds the uncompressed size limit.')
    compressed = zlib.compress(payload, level=3)
    header = HEADER.pack(MAGIC[kind], VERSION, 1, 0, len(payload), len(compressed), hashlib.sha256(payload).digest())
    if len(header) + len(compressed) > max_bytes:
        raise ValueError('The native file exceeds the compressed size limit.')
    return header + compressed


def _array_type(values: list) -> str | None:
    """Smallest exact binary encoding for a numeric list, or None."""
    ints, f32 = True, True
    low, high = 0, -1
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or (
                isinstance(value, float) and not math.isfinite(value)):
            return None
        if isinstance(value, int):
            if value < low: low = value
            if value > high: high = value
            if abs(value) >= F64_INT_LIMIT: return None  # JSON ints may exceed f64
        else:
            ints = False
        if f32 and struct.unpack('<f', struct.pack('<f', value))[0] != value:
            f32 = False
    if ints:
        if low >= 0:
            if high <= 0xff: return 'u8'
            if high <= 0xffff: return 'u16'
            if high <= 0xffffffff: return 'u32'
        elif low >= -0x80000000 and high <= 0x7fffffff:
            return 'i32'
        return 'f64'
    return 'f32' if f32 else 'f64'


def _lift(document):
    """Document -> (skeleton, sections[(kind, bytes)]); the input is not mutated."""
    arrays, blobs = bytearray(), bytearray()
    seen_arrays: dict[int, str] = {}
    seen_blobs: dict[str, tuple[int, int]] = {}

    def lift(value, key):
        if isinstance(value, str):
            if len(value) >= LIFT_MIN_STRING:
                payload, prefix = None, ''
                if key in B64_FIELDS:
                    payload = value
                elif key == 'data_url' and value.startswith('data:'):
                    comma = value.find(',')
                    if comma > 5 and value[:comma].endswith(';base64'):
                        payload, prefix = value[comma + 1:], value[:comma + 1]
                if payload is not None:
                    hit = seen_blobs.get(payload)
                    if hit is None:
                        try:
                            raw = base64.b64decode(payload, validate=True)
                        except ValueError:
                            raw = None
                        if raw is not None and base64.b64encode(raw).decode('ascii') == payload:
                            hit = (len(blobs), len(raw))
                            blobs.extend(raw)
                            seen_blobs[payload] = hit
                    if hit is not None:
                        marker = f'1:{hit[0]}:{hit[1]}'
                        return f'S2D:{marker}:{prefix}' if prefix else f'S2S:{marker}'
            return 'S2E:' + value if ESCAPABLE.match(value) else value
        if isinstance(value, list):
            element_type = _array_type(value) if len(value) >= LIFT_MIN_ARRAY else None
            if element_type is not None:
                hit = seen_arrays.get(id(value))
                if hit is not None:
                    return hit
                size = TYPE_BYTES[element_type]
                offset = len(arrays) + (-len(arrays) % size)
                arrays.extend(b'\0' * (offset - len(arrays)))
                arrays.extend(struct.pack(f'<{len(value)}{TYPE_FORMAT[element_type]}', *value))
                marker = f'S2B:{element_type}:0:{offset}:{len(value)}'
                seen_arrays[id(value)] = marker
                return marker
            return [lift(item, '') for item in value]
        if isinstance(value, dict):
            return {item_key: lift(item, item_key) for item_key, item in value.items()}
        return value

    skeleton = lift(document, '')
    return skeleton, [(1, bytes(arrays)), (2, bytes(blobs))]


def _materialize(node, sections):
    """Replace marker strings in a parsed skeleton; identical markers share one list."""
    shared: dict[str, list] = {}

    def resolve(value):
        match = MARKER_ARRAY.match(value)
        if match:
            hit = shared.get(value)
            if hit is not None:
                return hit
            element_type, index, offset, count = match[1], int(match[2]), int(match[3]), int(match[4])
            section = sections[index] if index < len(sections) else None
            size = TYPE_BYTES[element_type]
            if section is None or section[0] != 1 or offset % size or offset + count * size > len(section[1]):
                raise ValueError('The StykAnimate file is damaged (invalid array section reference).')
            out = list(struct.unpack_from(f'<{count}{TYPE_FORMAT[element_type]}', section[1], offset))
            shared[value] = out
            return out
        match = MARKER_B64.match(value) or MARKER_DATA.match(value)
        if match:
            index, offset, count = int(match[1]), int(match[2]), int(match[3])
            section = sections[index] if index < len(sections) else None
            if section is None or section[0] != 2 or offset + count > len(section[1]):
                raise ValueError('The StykAnimate file is damaged (invalid payload section reference).')
            encoded = base64.b64encode(section[1][offset:offset + count]).decode('ascii')
            return encoded if value[2] == 'S' else match[4] + encoded
        if value.startswith('S2E:'):
            return value[4:]
        if value.startswith(('S2B:', 'S2S:', 'S2D:')):
            raise ValueError('The StykAnimate file is damaged (malformed section marker).')
        return value

    def walk(value):
        if isinstance(value, str):
            return resolve(value) if value[:3] in ('S2B', 'S2S', 'S2D', 'S2E') else value
        if isinstance(value, list):
            for index, item in enumerate(value):
                value[index] = walk(item)
            return value
        if isinstance(value, dict):
            for item_key, item in value.items():
                value[item_key] = walk(item)
            return value
        return value

    return walk(node)


def encode_v2(document: dict, kind: str, *, max_bytes=MAX_BYTES) -> bytes:
    """Serialize an editable document dict as a sectioned container v2."""
    if kind not in MAGIC:
        raise ValueError('Unknown StykAnimate file kind.')
    skeleton, sections = _lift(document)
    payload = json.dumps(skeleton, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    if not payload or len(payload) > max_bytes:
        raise ValueError('The native document exceeds the uncompressed size limit.')
    codec, packed_payload = _pack(payload)
    records = bytearray()
    payloads = []
    for section_kind, raw in sections:
        section_codec, stored = _pack(raw)
        records += SECTION.pack(section_kind, section_codec, 0, 0, len(raw), len(stored), hashlib.sha256(raw).digest())
        payloads.append(stored)
    header = HEADER.pack(MAGIC[kind], 2, codec, 0, len(payload), len(packed_payload), hashlib.sha256(payload).digest())
    out = header + struct.pack('<I', len(sections)) + packed_payload + bytes(records) + b''.join(payloads)
    if len(out) > max_bytes:
        raise ValueError('The native file exceeds the compressed size limit.')
    return out


def _decode_v2(data: bytes, kind: str, header_fields, max_bytes: int) -> bytes:
    _, _, compression, _, size, packed_size, digest = header_fields
    if len(data) < HEADER.size + 4:
        raise ValueError('The StykAnimate file is truncated or has an invalid header.')
    count = struct.unpack_from('<I', data, HEADER.size)[0]
    skeleton_end = HEADER.size + 4 + packed_size
    if count > 64 or skeleton_end + count * SECTION.size > len(data):
        raise ValueError('The StykAnimate file is truncated or has an invalid header.')
    records, pos, expected = [], skeleton_end + count * SECTION.size, size
    for index in range(count):
        offset = skeleton_end + index * SECTION.size
        section_kind, codec, _, _, raw, stored, section_digest = SECTION.unpack_from(data, offset)
        if raw > max_bytes or pos + stored > len(data):
            raise ValueError('The StykAnimate file is truncated or has an invalid section table.')
        expected += raw * 3  # materialized JSON upper bound (base64 growth)
        records.append((section_kind, codec, raw, stored, section_digest, pos))
        pos += stored
    if pos != len(data):
        raise ValueError('The StykAnimate file is truncated or has trailing data.')
    if expected > max_bytes * 4:
        raise ValueError('The native document exceeds the uncompressed size limit.')
    payload = _unpack(compression, data[HEADER.size + 4:skeleton_end], size)
    if hashlib.sha256(payload).digest() != digest:
        raise ValueError('The StykAnimate file is damaged (checksum mismatch).')
    sections = []
    for section_kind, codec, raw, stored, section_digest, offset in records:
        section = _unpack(codec, data[offset:offset + stored], raw)
        if hashlib.sha256(section).digest() != section_digest:
            raise ValueError('The StykAnimate file is damaged (checksum mismatch).')
        if section_kind not in (1, 2):
            raise ValueError('The StykAnimate file has an unknown section kind.')
        sections.append((section_kind, section))
    document = _materialize(json.loads(payload), sections)
    return json.dumps(document, ensure_ascii=True, allow_nan=False, separators=(',', ':')).encode('ascii')


def decode(data: bytes, kind='styk', *, max_bytes=MAX_BYTES) -> bytes:
    if kind not in MAGIC:
        raise ValueError('Unknown StykAnimate file kind.')
    if len(data) > max_bytes:
        raise ValueError('The native file exceeds the compressed size limit.')
    # Read compatibility for both original plain JSON and the early wrapper.
    if kind == 'styk' and data.lstrip(b'\xef\xbb\xbf \t\r\n').startswith(b'{'):
        return data
    if len(data) < HEADER.size:
        raise ValueError('The StykAnimate file is truncated or has an invalid header.')
    fields = HEADER.unpack_from(data)
    magic, version, compression, flags, size, packed_size, digest = fields
    if magic != MAGIC[kind]:
        raise ValueError('The StykAnimate file type does not match its extension.')
    if version not in (1, 2) or compression not in (0, 1, 2) or flags != 0:
        raise ValueError('Unsupported StykAnimate file version. Update the app to open this file.')
    if not 0 < size <= max_bytes:
        raise ValueError('The native document exceeds the uncompressed size limit.')
    if version == 2:
        return _decode_v2(data, kind, fields, max_bytes)
    if compression != 1:
        raise ValueError('Unsupported StykAnimate file version. Update the app to open this file.')
    if packed_size != len(data) - HEADER.size:
        raise ValueError('The StykAnimate file is truncated or has trailing data.')
    decoder = zlib.decompressobj()
    try:
        payload = decoder.decompress(data[HEADER.size:], size + 1)
    except zlib.error as error:
        raise ValueError('The StykAnimate file is damaged (invalid compressed data).') from error
    if len(payload) != size or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError('The StykAnimate file is damaged (invalid payload length).')
    if hashlib.sha256(payload).digest() != digest:
        raise ValueError('The StykAnimate file is damaged (checksum mismatch).')
    return payload
