import base64
import hashlib
import json
import unittest
import zlib

import native_format as native


class NativeFormatTests(unittest.TestCase):
    def setUp(self):
        self.payload = json.dumps({'name': 'Scène 日本語', 'poses': [[0.125, 1, None, True]] * 10000}).encode()

    def test_lossless_compact_deterministic_both_kinds(self):
        for kind in ('styk', 'stkz', 'stykmov'):
            encoded = native.encode(self.payload, kind)
            self.assertEqual(encoded[:4], native.MAGIC[kind])
            self.assertEqual(native.decode(encoded, kind), self.payload)
            self.assertEqual(encoded, native.encode(self.payload, kind))
            self.assertLess(len(encoded), len(self.payload) / 20)

    def test_old_json_and_wrapper_remain_readable(self):
        for data in (self.payload, b'\xef\xbb\xbf \n' + self.payload, b'{"format":"stykanimate","version":1,"document":{}}'):
            self.assertEqual(native.decode(data), data)
            with self.assertRaises(ValueError):
                native.decode(data, 'stkz')

    def test_corruption_truncation_wrong_kind_and_future_version(self):
        valid = native.encode(self.payload, 'styk')
        for damaged in (b'', valid[:20], valid[:-1], valid + b'x',
                        valid[:4] + b'\x02' + valid[5:], valid[:5] + b'\x02' + valid[6:],
                        valid[:6] + b'\x01' + valid[7:],
                        valid[:24] + bytes([valid[24] ^ 1]) + valid[25:],
                        valid[:-1] + bytes([valid[-1] ^ 1])):
            with self.subTest(size=len(damaged)), self.assertRaises(ValueError):
                native.decode(damaged)
        with self.assertRaisesRegex(ValueError, 'extension'):
            native.decode(valid, 'stkz')

    def test_inflation_is_bounded_by_declared_and_absolute_sizes(self):
        packed = zlib.compress(self.payload)
        for size in (1, native.MAX_BYTES + 1):
            data = native.HEADER.pack(b'STYK', 1, 1, 0, size, len(packed), hashlib.sha256(self.payload).digest()) + packed
            with self.assertRaises(ValueError):
                native.decode(data)
        with self.assertRaises(ValueError):
            native.encode(self.payload, 'styk', max_bytes=100)

    def test_rejects_concatenated_compressed_streams(self):
        packed = zlib.compress(self.payload) + zlib.compress(b'{}')
        data = native.HEADER.pack(b'STYK', 1, 1, 0, len(self.payload), len(packed), hashlib.sha256(self.payload).digest()) + packed
        with self.assertRaises(ValueError):
            native.decode(data)


class NativeFormatV2Tests(unittest.TestCase):
    def test_sectioned_metadata_and_file_limits_are_independent_and_bounded(self):
        document = {'metadata': 'x' * 1500}
        encoded = native.encode_v2(document, 'styk', max_bytes=1024, max_skeleton_bytes=2048)
        self.assertLess(len(encoded), 1024)
        self.assertEqual(json.loads(native.decode(encoded, max_bytes=1024, max_skeleton_bytes=2048)), document)
        with self.assertRaisesRegex(ValueError, 'uncompressed size'):
            native.decode(encoded, max_bytes=1024, max_skeleton_bytes=1000)
        with self.assertRaisesRegex(ValueError, 'uncompressed size'):
            native.encode_v2(document, 'styk', max_bytes=1024, max_skeleton_bytes=1000)
        with self.assertRaisesRegex(ValueError, 'uncompressed size'):
            native.encode_v2({'array': [float(i) + .1 for i in range(200)]}, 'styk', max_bytes=1024)

    def setUp(self):
        shared = [i * 0.125 for i in range(64)]
        self.document = {
            'version': 5, 'fps': 12, 'canvas': {'width': 640, 'height': 480},
            'keyframes': [{'duration_raw': 2, 'objects': [
                {'figure_type_id': 1, 'angles': shared, 'lengths': [12.5] * 64,
                 'uids': [0, 255, 65536, 4294967295] * 12, 'neg': [-5, -3, 7] * 16,
                 'huge': [2 ** 60] * 40, 'join': {'target_object_slot': 1}},
                {'figure_type_id': 2, 'angles': shared}]}],
            'figure_types': [{'figure_type_id': 1, 'segments': [{'kind': 'line'}]}],
            '_stykSource': {'kind': 'piv', 'version': 5,
                'source_base64': base64.b64encode(b'original source bytes ' * 8000).decode('ascii')},
            'media': [{'name': 'a.png',
                'data_url': 'data:image/png;base64,' + base64.b64encode(b'PNGDATA' * 30000).decode('ascii')}],
            'title': 'S2B:looks like a marker', 'alt': 'S2E:already escaped',
        }

    def test_v2_round_trip_lossless_and_shared_identity(self):
        encoded = native.encode_v2(self.document, 'styk')
        self.assertEqual(encoded[:4], b'STYK')
        self.assertEqual(encoded[4], 2)
        decoded = json.loads(native.decode(encoded, 'styk'))
        self.assertEqual(decoded, self.document)

    def test_v2_marker_materialization_and_integrity(self):
        encoded = native.encode_v2(self.document, 'styk')
        # Skeleton resolves to the exact original values through markers.
        decoded = json.loads(native.decode(encoded, 'styk'))
        self.assertEqual(decoded['keyframes'][0]['objects'][0]['uids'][7], 4294967295)
        self.assertEqual(decoded['keyframes'][0]['objects'][0]['huge'], [2 ** 60] * 40)
        # Trailing data, truncation, and payload/section-table bit flips reject.
        mid = len(encoded) // 2
        for damaged in (encoded[:-1], encoded + b'x', encoded[:20],
                        encoded[:mid] + bytes([encoded[mid] ^ 1]) + encoded[mid + 1:]):
            with self.assertRaises(ValueError):
                native.decode(damaged, 'styk')
        with self.assertRaisesRegex(ValueError, 'extension'):
            native.decode(encoded, 'stkz')
        # v1 containers of the same document still decode identically.
        payload = json.dumps(self.document, separators=(',', ':')).encode()
        self.assertEqual(json.loads(native.decode(native.encode(payload, 'styk'))), self.document)

    def test_v2_size_beats_v1_on_numeric_documents(self):
        encoded_v2 = native.encode_v2(self.document, 'styk')
        payload = json.dumps(self.document, separators=(',', ':')).encode()
        encoded_v1 = native.encode(payload, 'styk')
        self.assertLess(len(encoded_v2), len(encoded_v1))


if __name__ == '__main__':
    unittest.main()
